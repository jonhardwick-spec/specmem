/**
 * ptyStreamer.ts - PTY Output Streaming System
 *
 * Captures raw terminal output from GNU Screen sessions and streams it
 * via WebSocket to the dashboard. Preserves ANSI escape sequences for colors,
 * formatting, cursor positioning, etc.
 *
 * STREAMING APPROACHES (in order of preference):
 *
 * 1. SCREEN PIPE MODE (Best - Direct PTY streaming)
 *    - Uses `screen -x session -p 0 -X hardcopy -h /dev/stdout` for snapshots
 *    - Uses hidden screen attachment for live streaming
 *    - Full ANSI support, real-time, no file I/O overhead
 *
 * 2. LOG FILE STREAMING (Fallback - Current approach)
 *    - Uses `tail -f` on screen log files
 *    - Requires screen logging to be enabled (-L flag)
 *    - Works well but depends on log file existence
 *
 * 3. HARDCOPY POLLING (Emergency fallback)
 *    - Periodically runs `screen -X hardcopy` to capture screen state
 *    - No logging required, but higher latency
 *
 * INPUT METHODS:
 * - screen -S session -X stuff "text\r" (sends text + Enter)
 * - screen -S session -X stuff "text"   (sends text only)
 * - Supports full keyboard input including special keys
 */
import { EventEmitter } from 'events';
import { spawn, execSync, exec } from 'child_process';
import * as fs from 'fs';
import { logger } from '../utils/logger.js';
import { getSpawnEnv } from '../utils/index.js';
import { getProjectPath } from '../config.js';
// ============================================================================
// PTY Streamer Class
// ============================================================================
/**
 * PTY Streamer - Streams output from GNU Screen sessions
 *
 * Emits:
 * - 'data' (Buffer): Raw terminal output data
 * - 'error' (Error): Streaming errors
 * - 'end': Stream ended
 * - 'mode-change' (StreamingMode): Streaming mode changed
 */
export class PTYStreamer extends EventEmitter {
    currentMode = 'none';
    currentSession = null;
    streamProcess = null;
    pollInterval = null;
    lastHardcopy = '';
    bytesStreamed = 0;
    startedAt = null;
    // ============================================================================
    // Session Discovery
    // ============================================================================
    /**
     * Find all screen sessions on the system
     */
    findAllInstances() {
        logger.info('[PTY-STREAMER] findAllInstances called');
        try {
            // Use screen -list to get all sessions
            // Note: screen -list returns exit code 1 when sessions exist but are detached
            let screenList;
            try {
                screenList = execSync('screen -list 2>&1', { encoding: 'utf-8' });
            }
            catch (error) {
                // screen -list often returns exit code 1 even with valid sessions
                screenList = error.stdout?.toString() || error.message || '';
            }
            if (screenList.includes('No Sockets found')) {
                logger.info('[PTY-STREAMER] No screen sessions found');
                return [];
            }
            const instances = [];
            const lines = screenList.split('\n');
            for (const line of lines) {
                // Match patterns like:
                // "353784.pts-6.srv815833	(12/06/25 19:09:13)	(Multi, attached)"
                // "352501.pts-6.srv815833	(12/06/25 19:03:51)	(Detached)"
                const match = line.match(/(\d+)\.([^\s]+)\s+.*\((Multi, )?(Attached|Detached)\)/i);
                if (!match)
                    continue;
                const pid = parseInt(match[1], 10);
                const screenName = match[2];
                const multiuser = !!match[3];
                const attached = match[4].toLowerCase() === 'attached';
                logger.debug({ pid, screenName, multiuser, attached }, '[PTY-STREAMER] Found screen session');
                // Try to get additional session info
                let tty = '';
                let windowCount = 1;
                try {
                    // Get window list using screen -Q
                    const windows = execSync(`screen -S ${pid}.${screenName} -Q windows 2>/dev/null`, { encoding: 'utf-8' }).trim();
                    windowCount = (windows.match(/\d+/g) || []).length || 1;
                }
                catch {
                    // Ignore - query might fail if not attached
                }
                // Try to find the PTY device for the child process
                try {
                    const childInfo = execSync(`ps --ppid ${pid} -o tty= 2>/dev/null`, { encoding: 'utf-8' }).trim();
                    if (childInfo && childInfo !== '?') {
                        tty = `/dev/${childInfo}`;
                    }
                }
                catch {
                    // Ignore
                }
                // Check for log files (multiple naming conventions)
                const logPatterns = [
                    `/tmp/screen-${screenName.replace(/[^a-zA-Z0-9_-]/g, '_')}.log`,
                    `/tmp/screenlog.0`,
                    `/tmp/claude-display.log`,
                    `/tmp/claude-${pid}.log`
                ];
                const logFile = logPatterns.find(p => fs.existsSync(p)) || '';
                instances.push({
                    pid,
                    tty,
                    screenName,
                    logFile,
                    attached,
                    multiuser,
                    windowCount
                });
            }
            logger.info({
                count: instances.length,
                sessions: instances.map(i => `${i.pid}.${i.screenName}`)
            }, '[PTY-STREAMER] Found screen sessions');
            return instances;
        }
        catch (error) {
            logger.error({ error: error.message }, '[PTY-STREAMER] Error finding screen sessions');
            return [];
        }
    }
    /**
     * Get the newest (highest PID) instance
     */
    getNewestInstance() {
        const instances = this.findAllInstances();
        if (instances.length === 0)
            return null;
        return instances.reduce((newest, current) => current.pid > newest.pid ? current : newest);
    }
    /**
     * Get instance by session name or PID
     */
    getInstance(identifier) {
        const instances = this.findAllInstances();
        if (typeof identifier === 'number') {
            return instances.find(i => i.pid === identifier) || null;
        }
        return instances.find(i => i.screenName === identifier || `${i.pid}.${i.screenName}` === identifier) || null;
    }
    // ============================================================================
    // Streaming Control
    // ============================================================================
    /**
     * Start streaming from a screen session
     * Automatically selects the best available streaming mode
     */
    startStreaming(sessionOrLog = '') {
        logger.info({ sessionOrLog }, '[PTY-STREAMER] startStreaming called');
        if (this.isActive()) {
            logger.warn('[PTY-STREAMER] Already streaming, stop first');
            return false;
        }
        // If a log file path is provided, use log-tail mode
        if (sessionOrLog.startsWith('/') && fs.existsSync(sessionOrLog)) {
            return this.startLogTailMode(sessionOrLog);
        }
        // Try to find a session
        let instance = null;
        if (sessionOrLog) {
            instance = this.getInstance(sessionOrLog);
        }
        if (!instance) {
            instance = this.getNewestInstance();
        }
        if (!instance) {
            logger.error('[PTY-STREAMER] No screen session found');
            return false;
        }
        const sessionName = `${instance.pid}.${instance.screenName}`;
        // Try streaming modes in order of preference
        // 1. Try screen pipe mode (best)
        if (this.startScreenPipeMode(sessionName)) {
            return true;
        }
        // 2. Try log file mode (if log exists)
        if (instance.logFile && this.startLogTailMode(instance.logFile)) {
            return true;
        }
        // 3. Fall back to hardcopy polling
        return this.startHardcopyPollMode(sessionName);
    }
    /**
     * Mode 1: Screen Pipe Mode - Direct PTY streaming via screen
     *
     * Uses a hidden screen attachment to stream output directly.
     * This is the most efficient method as it:
     * - Reads directly from the PTY
     * - Preserves all ANSI codes
     * - Has minimal latency
     */
    startScreenPipeMode(sessionName) {
        logger.info({ sessionName }, '[PTY-STREAMER] Attempting screen-pipe mode');
        try {
            // First, enable multiuser mode so we can attach without detaching
            try {
                execSync(`screen -S ${sessionName} -X multiuser on 2>/dev/null`, { encoding: 'utf-8' });
                logger.info({ sessionName }, '[PTY-STREAMER] Enabled multiuser mode');
            }
            catch {
                // Might already be enabled or we don't have permission
            }
            // Use script + screen to capture output to a pipe
            // The -x flag allows multiple attachments
            // We use cat to read screen's log output
            // bruh ALWAYS use getSpawnEnv for project isolation
            const proc = spawn('script', [
                '-q', // Quiet mode
                '-c', `screen -x ${sessionName} -p 0`, // Command to run
                '/dev/null' // Discard timing file
            ], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...getSpawnEnv(), TERM: 'xterm-256color' }
            });
            if (!proc.pid) {
                logger.error('[PTY-STREAMER] Failed to spawn screen-pipe process');
                return false;
            }
            proc.stdout?.on('data', (chunk) => {
                this.bytesStreamed += chunk.length;
                logger.debug({ bytes: chunk.length }, '[PTY-STREAMER] screen-pipe data');
                this.emit('data', chunk);
            });
            proc.stderr?.on('data', (chunk) => {
                logger.warn({ stderr: chunk.toString() }, '[PTY-STREAMER] screen-pipe stderr');
            });
            proc.on('error', (error) => {
                logger.error({ error: error.message }, '[PTY-STREAMER] screen-pipe error');
                this.emit('error', error);
                this.stopStreaming();
            });
            proc.on('exit', (code, signal) => {
                logger.info({ code, signal }, '[PTY-STREAMER] screen-pipe exited');
                if (this.currentMode === 'screen-pipe') {
                    this.emit('end');
                    this.resetState();
                }
            });
            this.streamProcess = proc;
            this.currentMode = 'screen-pipe';
            this.currentSession = sessionName;
            this.startedAt = new Date();
            this.emit('mode-change', 'screen-pipe');
            logger.info({ sessionName, pid: proc.pid }, '[PTY-STREAMER] Started screen-pipe mode');
            return true;
        }
        catch (error) {
            logger.error({ error: error.message }, '[PTY-STREAMER] screen-pipe mode failed');
            return false;
        }
    }
    /**
     * Mode 2: Log Tail Mode - Stream from screen log file
     *
     * Uses tail -f to stream the screen session log.
     * Requires screen logging to be enabled.
     */
    startLogTailMode(logPath) {
        logger.info({ logPath }, '[PTY-STREAMER] Attempting log-tail mode');
        if (!fs.existsSync(logPath)) {
            logger.error({ logPath }, '[PTY-STREAMER] Log file does not exist');
            return false;
        }
        try {
            const stats = fs.statSync(logPath);
            logger.info({ logPath, size: stats.size }, '[PTY-STREAMER] Log file found');
            // Start tail -f with last 1000 lines of history
            // Task #26 fix: add getSpawnEnv for project isolation
            const proc = spawn('tail', ['-f', '-n', '1000', logPath], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: getSpawnEnv(),
            });
            if (!proc.pid) {
                logger.error('[PTY-STREAMER] Failed to spawn tail process');
                return false;
            }
            proc.stdout?.on('data', (chunk) => {
                this.bytesStreamed += chunk.length;
                logger.debug({ bytes: chunk.length }, '[PTY-STREAMER] log-tail data');
                this.emit('data', chunk);
            });
            proc.stderr?.on('data', (chunk) => {
                logger.warn({ stderr: chunk.toString() }, '[PTY-STREAMER] tail stderr');
            });
            proc.on('error', (error) => {
                logger.error({ error: error.message }, '[PTY-STREAMER] tail error');
                this.emit('error', error);
                this.stopStreaming();
            });
            proc.on('exit', (code, signal) => {
                logger.info({ code, signal }, '[PTY-STREAMER] tail exited');
                if (this.currentMode === 'log-tail') {
                    this.emit('end');
                    this.resetState();
                }
            });
            this.streamProcess = proc;
            this.currentMode = 'log-tail';
            this.currentSession = logPath;
            this.startedAt = new Date();
            this.emit('mode-change', 'log-tail');
            logger.info({ logPath, pid: proc.pid }, '[PTY-STREAMER] Started log-tail mode');
            return true;
        }
        catch (error) {
            logger.error({ error: error.message }, '[PTY-STREAMER] log-tail mode failed');
            return false;
        }
    }
    /**
     * Mode 3: Hardcopy Poll Mode - Periodic screen snapshots
     *
     * Uses screen -X hardcopy to capture screen state periodically.
     * Does not require logging, works with any screen session.
     * Higher latency but more compatible.
     */
    startHardcopyPollMode(sessionName, intervalMs = 500) {
        logger.info({ sessionName, intervalMs }, '[PTY-STREAMER] Attempting hardcopy-poll mode');
        try {
            // Test that hardcopy works
            const testFile = `/tmp/.screen-hardcopy-test-${process.pid}`;
            execSync(`screen -S ${sessionName} -p 0 -X hardcopy -h ${testFile} 2>/dev/null`);
            if (!fs.existsSync(testFile)) {
                logger.error('[PTY-STREAMER] Hardcopy test failed - file not created');
                return false;
            }
            fs.unlinkSync(testFile);
            // Start polling
            this.pollInterval = setInterval(() => {
                this.captureHardcopy(sessionName);
            }, intervalMs);
            this.currentMode = 'hardcopy-poll';
            this.currentSession = sessionName;
            this.startedAt = new Date();
            this.emit('mode-change', 'hardcopy-poll');
            // Capture initial state
            this.captureHardcopy(sessionName);
            logger.info({ sessionName, intervalMs }, '[PTY-STREAMER] Started hardcopy-poll mode');
            return true;
        }
        catch (error) {
            logger.error({ error: error.message }, '[PTY-STREAMER] hardcopy-poll mode failed');
            return false;
        }
    }
    /**
     * Capture a hardcopy and emit changes - NON-BLOCKING
     */
    captureHardcopy(sessionName) {
        const tmpFile = `/tmp/.screen-hardcopy-${process.pid}`;
        // Use async exec to not block the event loop
        exec(`screen -S ${sessionName} -p 0 -X hardcopy -h ${tmpFile} 2>/dev/null`, (err) => {
            if (err)
                return;
            fs.readFile(tmpFile, 'utf-8', (readErr, content) => {
                if (readErr || !content)
                    return;
                fs.unlink(tmpFile, () => { }); // fire and forget cleanup
                // Only emit if content changed
                if (content !== this.lastHardcopy) {
                    const newContent = this.findNewContent(this.lastHardcopy, content);
                    if (newContent) {
                        const buffer = Buffer.from(newContent, 'utf-8');
                        this.bytesStreamed += buffer.length;
                        this.emit('data', buffer);
                    }
                    this.lastHardcopy = content;
                }
            });
        });
    }
    /**
     * Find new content between old and new hardcopy
     */
    findNewContent(oldContent, newContent) {
        if (!oldContent)
            return newContent;
        // Simple diff: if new content is longer, emit the difference
        // This is a simplification - real implementation might use proper diff
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');
        // Find first differing line
        let firstDiff = 0;
        while (firstDiff < oldLines.length && firstDiff < newLines.length && oldLines[firstDiff] === newLines[firstDiff]) {
            firstDiff++;
        }
        // Return new lines from the diff point
        if (firstDiff < newLines.length) {
            return newLines.slice(firstDiff).join('\n') + '\n';
        }
        return '';
    }
    /**
     * Stop all streaming
     */
    stopStreaming() {
        logger.info({ mode: this.currentMode }, '[PTY-STREAMER] Stopping streaming');
        if (this.streamProcess) {
            try {
                this.streamProcess.kill('SIGTERM');
                setTimeout(() => {
                    if (this.streamProcess) {
                        this.streamProcess.kill('SIGKILL');
                    }
                }, 1000);
            }
            catch {
                // Ignore
            }
            this.streamProcess = null;
        }
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.resetState();
        logger.info('[PTY-STREAMER] Streaming stopped');
    }
    /**
     * Reset internal state
     */
    resetState() {
        this.currentMode = 'none';
        this.currentSession = null;
        this.startedAt = null;
        this.lastHardcopy = '';
    }
    // ============================================================================
    // Input Methods
    // ============================================================================
    /**
     * Send input to a screen session
     *
     * @param sessionName - Screen session name (e.g., "353784.pts-6.srv815833")
     * @param data - Text to send
     * @param addNewline - Whether to add a carriage return (default: false)
     */
    writeToTerminal(sessionName, data, addNewline = false) {
        try {
            // Escape special characters for shell
            const escapedData = data
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"')
                .replace(/\$/g, '\\$')
                .replace(/`/g, '\\`');
            // Build the command
            let stuffCmd = `screen -S ${sessionName} -p 0 -X stuff "${escapedData}`;
            if (addNewline) {
                stuffCmd += `$(printf '\\r')`;
            }
            stuffCmd += '"';
            execSync(stuffCmd, { encoding: 'utf-8' });
            logger.info({
                session: sessionName,
                dataLen: data.length,
                addNewline
            }, '[PTY-STREAMER] Sent input to screen');
            return true;
        }
        catch (error) {
            logger.error({
                error: error.message,
                session: sessionName
            }, '[PTY-STREAMER] Failed to send input');
            return false;
        }
    }
    /**
     * Send special key sequences to screen
     */
    sendSpecialKey(sessionName, key) {
        const keyMap = {
            'enter': '\\r',
            'tab': '\\t',
            'escape': '\\e',
            'backspace': '\\b',
            'up': '\\e[A',
            'down': '\\e[B',
            'right': '\\e[C',
            'left': '\\e[D',
            'home': '\\e[H',
            'end': '\\e[F',
            'pageup': '\\e[5~',
            'pagedown': '\\e[6~',
            'delete': '\\e[3~',
            'insert': '\\e[2~',
            'ctrl-c': '\\x03',
            'ctrl-d': '\\x04',
            'ctrl-z': '\\x1a',
            'ctrl-l': '\\x0c'
        };
        const sequence = keyMap[key.toLowerCase()];
        if (!sequence) {
            logger.warn({ key }, '[PTY-STREAMER] Unknown special key');
            return false;
        }
        try {
            execSync(`screen -S ${sessionName} -p 0 -X stuff $'${sequence}'`, { encoding: 'utf-8' });
            logger.debug({ session: sessionName, key }, '[PTY-STREAMER] Sent special key');
            return true;
        }
        catch (error) {
            logger.error({ error: error.message, key }, '[PTY-STREAMER] Failed to send special key');
            return false;
        }
    }
    // ============================================================================
    // Screen Control Commands
    // ============================================================================
    /**
     * Enable multiuser mode on a session
     */
    enableMultiuser(sessionName) {
        try {
            execSync(`screen -S ${sessionName} -X multiuser on`, { encoding: 'utf-8' });
            logger.info({ session: sessionName }, '[PTY-STREAMER] Enabled multiuser mode');
            return true;
        }
        catch (error) {
            logger.error({ error: error.message }, '[PTY-STREAMER] Failed to enable multiuser');
            return false;
        }
    }
    /**
     * Get current screen content (hardcopy)
     */
    getScreenContent(sessionName, includeScrollback = true) {
        try {
            const tmpFile = `/tmp/.screen-content-${process.pid}`;
            const hFlag = includeScrollback ? '-h' : '';
            execSync(`screen -S ${sessionName} -p 0 -X hardcopy ${hFlag} ${tmpFile} 2>/dev/null`);
            if (!fs.existsSync(tmpFile))
                return null;
            const content = fs.readFileSync(tmpFile, 'utf-8');
            fs.unlinkSync(tmpFile);
            return content;
        }
        catch {
            return null;
        }
    }
    /**
     * Enable logging for a screen session
     */
    enableLogging(sessionName, logFile) {
        try {
            // Set log file path
            execSync(`screen -S ${sessionName} -X logfile ${logFile}`, { encoding: 'utf-8' });
            // Enable logging
            execSync(`screen -S ${sessionName} -X log on`, { encoding: 'utf-8' });
            // Set flush to immediate
            execSync(`screen -S ${sessionName} -X logfile flush 0`, { encoding: 'utf-8' });
            logger.info({ session: sessionName, logFile }, '[PTY-STREAMER] Enabled logging');
            return true;
        }
        catch (error) {
            logger.error({ error: error.message }, '[PTY-STREAMER] Failed to enable logging');
            return false;
        }
    }
    // ============================================================================
    // Status Methods
    // ============================================================================
    /**
     * Check if currently streaming
     */
    isActive() {
        return this.currentMode !== 'none';
    }
    /**
     * Get detailed streaming status
     */
    getStatus() {
        return {
            mode: this.currentMode,
            sessionName: this.currentSession,
            isActive: this.isActive(),
            startedAt: this.startedAt,
            bytesStreamed: this.bytesStreamed
        };
    }
    /**
     * Get the current streaming mode
     */
    getMode() {
        return this.currentMode;
    }
    /**
     * Get the currently streaming instance
     */
    getCurrentStreamingInstance() {
        if (!this.currentSession) {
            return null;
        }
        const instances = this.findAllInstances();
        // currentSession can be either a screen session name or a log file path
        // Try to match by screen name first, then by log file path
        return instances.find(i => i.screenName === this.currentSession ||
            i.logFile === this.currentSession) || null;
    }
}
// ============================================================================
// Per-Project PTY Streamer Map
// ============================================================================
// Per-project PTY streamer Map - prevents cross-project pollution
const ptyStreamersByProject = new Map();
export function getPtyStreamer(projectPath) {
    const targetProject = projectPath || getProjectPath();
    if (!ptyStreamersByProject.has(targetProject)) {
        ptyStreamersByProject.set(targetProject, new PTYStreamer());
        logger.debug({ projectPath: targetProject }, '[PTY-STREAMER] Created new instance for project');
    }
    return ptyStreamersByProject.get(targetProject);
}
/**
 * Stop streaming and reset the PTY streamer for current/specified project to prevent memory leaks
 */
export function shutdownPtyStreamer(projectPath) {
    const targetProject = projectPath || getProjectPath();
    const streamer = ptyStreamersByProject.get(targetProject);
    if (streamer) {
        streamer.stopStreaming();
        streamer.removeAllListeners();
        ptyStreamersByProject.delete(targetProject);
        logger.debug({ projectPath: targetProject }, '[PTY-STREAMER] Shutdown instance for project');
    }
}
/**
 * Stop streaming and reset all PTY streamers across all projects
 */
export function shutdownAllPtyStreamers() {
    for (const [projectPath, streamer] of ptyStreamersByProject) {
        streamer.stopStreaming();
        streamer.removeAllListeners();
        logger.debug({ projectPath }, '[PTY-STREAMER] Shutdown instance for project');
    }
    ptyStreamersByProject.clear();
}
// Legacy export for backwards compatibility (uses current project)
export const ptyStreamer = getPtyStreamer();
//# sourceMappingURL=ptyStreamer.js.map