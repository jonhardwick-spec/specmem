/**
 * terminalStream.ts - WebSocket Server for Terminal Output Streaming
 *
 * Watches the Claude Code output log file and broadcasts changes
 * to connected WebSocket clients in real-time.
 *
 * Phase 5 Implementation - Live Terminal Output Streaming
 */
import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger.js';
import { getProjectPath } from '../../config.js';
// ============================================================================
// Configuration
// ============================================================================
const LOG_FILE = process.env.SPECMEM_TERMINAL_LOG || '/tmp/claude-code-output.log';
const MAX_HISTORY_LINES = 30;
const BROADCAST_DEBOUNCE_MS = 100;
const FILE_CHECK_INTERVAL_MS = 500;
// ============================================================================
// Terminal Stream Manager
// ============================================================================
export class TerminalStreamManager {
    logFilePath;
    maxHistoryLines;
    broadcastDebounceMs;
    connectedClients = new Set();
    lastPosition = 0;
    fileWatcher = null;
    checkInterval = null;
    broadcastTimeout = null;
    pendingLines = [];
    isRunning = false;
    // MED-33 FIX: Add restart lock and pending restart timeout to prevent race conditions
    isRestartingWatcher = false;
    pendingRestartTimeout = null;
    constructor(config = {}) {
        this.logFilePath = config.logFilePath || LOG_FILE;
        this.maxHistoryLines = config.maxHistoryLines || MAX_HISTORY_LINES;
        this.broadcastDebounceMs = config.broadcastDebounceMs || BROADCAST_DEBOUNCE_MS;
    }
    /**
     * Start the terminal stream manager
     */
    start() {
        if (this.isRunning) {
            logger.warn('Terminal stream manager already running');
            return;
        }
        this.isRunning = true;
        this.ensureLogFile();
        this.startFileWatching();
        logger.info({ logFilePath: this.logFilePath }, 'Terminal stream manager started');
    }
    /**
     * Stop the terminal stream manager
     */
    stop() {
        this.isRunning = false;
        if (this.fileWatcher) {
            this.fileWatcher.close();
            this.fileWatcher = null;
        }
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        if (this.broadcastTimeout) {
            clearTimeout(this.broadcastTimeout);
            this.broadcastTimeout = null;
        }
        // MED-33 FIX: Clear pending restart timeout on stop
        if (this.pendingRestartTimeout) {
            clearTimeout(this.pendingRestartTimeout);
            this.pendingRestartTimeout = null;
        }
        this.isRestartingWatcher = false;
        // Close all client connections
        for (const client of Array.from(this.connectedClients)) {
            client.close(1001, 'Server shutting down');
        }
        this.connectedClients.clear();
        logger.info('Terminal stream manager stopped');
    }
    /**
     * Add a WebSocket client to the broadcast list
     */
    addClient(ws) {
        this.connectedClients.add(ws);
        logger.debug('Terminal stream client connected');
        // Send history to new client
        this.sendHistory(ws);
        // Send current status
        this.sendStatus(ws);
        // Setup client event handlers
        ws.on('close', () => {
            this.connectedClients.delete(ws);
            logger.debug('Terminal stream client disconnected');
        });
        ws.on('error', (error) => {
            logger.error({ error }, 'Terminal stream client error');
            this.connectedClients.delete(ws);
        });
        ws.on('message', (data) => {
            this.handleClientMessage(ws, data.toString());
        });
    }
    /**
     * Handle incoming client messages
     */
    handleClientMessage(ws, message) {
        try {
            const data = JSON.parse(message);
            switch (data.type) {
                case 'get_history':
                    this.sendHistory(ws);
                    break;
                case 'clear':
                    this.clearLog();
                    break;
                case 'pause':
                    // Remove from broadcast list temporarily
                    this.connectedClients.delete(ws);
                    ws.send(JSON.stringify({ type: 'terminal_status', status: 'paused', timestamp: new Date().toISOString() }));
                    break;
                case 'resume':
                    // Add back to broadcast list
                    this.connectedClients.add(ws);
                    this.sendHistory(ws);
                    ws.send(JSON.stringify({ type: 'terminal_status', status: 'streaming', timestamp: new Date().toISOString() }));
                    break;
                default:
                    logger.debug({ messageType: data.type }, 'Unknown terminal message type');
            }
        }
        catch (error) {
            logger.warn({ error, message }, 'Failed to parse terminal client message');
        }
    }
    /**
     * Ensure the log file exists
     */
    ensureLogFile() {
        try {
            const dir = path.dirname(this.logFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            if (!fs.existsSync(this.logFilePath)) {
                fs.writeFileSync(this.logFilePath, '', { mode: 0o644 });
            }
            // Initialize last position
            const stats = fs.statSync(this.logFilePath);
            this.lastPosition = stats.size;
        }
        catch (error) {
            logger.error({ error, logFilePath: this.logFilePath }, 'Failed to ensure log file exists');
        }
    }
    /**
     * Start watching the log file for changes
     */
    startFileWatching() {
        try {
            // Use fs.watch for immediate notifications
            this.fileWatcher = fs.watch(this.logFilePath, (eventType) => {
                if (eventType === 'change') {
                    this.readNewContent();
                }
            });
            this.fileWatcher.on('error', (error) => {
                logger.error({ error }, 'File watcher error');
                this.restartFileWatching();
            });
            // Also poll periodically as backup (fs.watch can be unreliable)
            this.checkInterval = setInterval(() => {
                this.readNewContent();
            }, FILE_CHECK_INTERVAL_MS);
        }
        catch (error) {
            logger.error({ error }, 'Failed to start file watching');
            // Fall back to polling only
            this.checkInterval = setInterval(() => {
                this.readNewContent();
            }, FILE_CHECK_INTERVAL_MS);
        }
    }
    /**
     * Restart file watching (e.g., after file rotation)
     * MED-33 FIX: Added debounce and lock to prevent race conditions from rapid restarts
     */
    restartFileWatching() {
        // MED-33 FIX: If already restarting, just debounce - don't create duplicate watchers
        if (this.isRestartingWatcher) {
            logger.debug('File watcher restart already in progress, debouncing');
            // Clear any pending restart and schedule a new one
            if (this.pendingRestartTimeout) {
                clearTimeout(this.pendingRestartTimeout);
            }
            this.pendingRestartTimeout = setTimeout(() => {
                this.pendingRestartTimeout = null;
                if (this.isRunning && !this.isRestartingWatcher) {
                    this.restartFileWatching();
                }
            }, 1000);
            return;
        }
        // Set the lock
        this.isRestartingWatcher = true;
        if (this.fileWatcher) {
            this.fileWatcher.close();
            this.fileWatcher = null;
        }
        setTimeout(() => {
            try {
                if (this.isRunning) {
                    this.ensureLogFile();
                    this.startFileWatching();
                }
            }
            finally {
                // MED-33 FIX: Always release the lock
                this.isRestartingWatcher = false;
            }
        }, 1000);
    }
    /**
     * Read new content from the log file
     */
    readNewContent() {
        try {
            const stats = fs.statSync(this.logFilePath);
            // Check if file was truncated (log rotation)
            if (stats.size < this.lastPosition) {
                this.lastPosition = 0;
            }
            // No new content
            if (stats.size === this.lastPosition) {
                return;
            }
            // Read new content
            const fd = fs.openSync(this.logFilePath, 'r');
            const buffer = Buffer.alloc(stats.size - this.lastPosition);
            fs.readSync(fd, buffer, 0, buffer.length, this.lastPosition);
            fs.closeSync(fd);
            this.lastPosition = stats.size;
            // Process new lines
            const newContent = buffer.toString('utf-8');
            const newLines = newContent.split('\n').filter(line => line.trim());
            if (newLines.length > 0) {
                this.pendingLines.push(...newLines);
                this.scheduleBroadcast();
            }
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                // File was deleted, try to recreate
                this.ensureLogFile();
                this.lastPosition = 0;
            }
            else {
                logger.error({ error }, 'Error reading log file');
            }
        }
    }
    /**
     * Schedule a debounced broadcast
     */
    scheduleBroadcast() {
        if (this.broadcastTimeout) {
            return;
        }
        this.broadcastTimeout = setTimeout(() => {
            this.broadcastTimeout = null;
            if (this.pendingLines.length > 0) {
                // Sanitize and broadcast lines
                const linesToBroadcast = this.pendingLines.splice(0, this.pendingLines.length);
                for (const line of linesToBroadcast) {
                    const sanitizedLine = this.sanitizeLine(line);
                    this.broadcast({
                        type: 'terminal_output',
                        timestamp: new Date().toISOString(),
                        line: sanitizedLine
                    });
                }
            }
        }, this.broadcastDebounceMs);
    }
    /**
     * Sanitize a line for safe display
     */
    sanitizeLine(line) {
        // Remove ANSI escape codes
        let sanitized = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
        // Remove other control characters
        sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
        // Truncate very long lines
        if (sanitized.length > 2000) {
            sanitized = sanitized.substring(0, 2000) + '... (truncated)';
        }
        return sanitized;
    }
    /**
     * Broadcast a message to all connected clients
     */
    broadcast(message) {
        const payload = JSON.stringify(message);
        for (const client of Array.from(this.connectedClients)) {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(payload);
                }
                catch (error) {
                    logger.warn({ error }, 'Failed to send to terminal client');
                    this.connectedClients.delete(client);
                }
            }
        }
    }
    /**
     * Send history to a specific client
     */
    sendHistory(ws) {
        try {
            const lines = this.getLastNLines(this.maxHistoryLines);
            const sanitizedLines = lines.map(line => this.sanitizeLine(line));
            ws.send(JSON.stringify({
                type: 'terminal_history',
                timestamp: new Date().toISOString(),
                lines: sanitizedLines
            }));
        }
        catch (error) {
            logger.error({ error }, 'Failed to send terminal history');
            ws.send(JSON.stringify({
                type: 'terminal_error',
                timestamp: new Date().toISOString(),
                error: 'Failed to load history'
            }));
        }
    }
    /**
     * Send current status to a client
     */
    sendStatus(ws) {
        ws.send(JSON.stringify({
            type: 'terminal_status',
            timestamp: new Date().toISOString(),
            status: 'streaming'
        }));
    }
    /**
     * Get the last N lines from the log file
     */
    getLastNLines(n) {
        try {
            if (!fs.existsSync(this.logFilePath)) {
                return [];
            }
            const content = fs.readFileSync(this.logFilePath, 'utf-8');
            const lines = content.split('\n').filter(line => line.trim());
            return lines.slice(-n);
        }
        catch (error) {
            logger.error({ error }, 'Failed to read last N lines');
            return [];
        }
    }
    /**
     * Clear the log file
     */
    clearLog() {
        try {
            fs.writeFileSync(this.logFilePath, '', { mode: 0o644 });
            this.lastPosition = 0;
            // Notify all clients
            this.broadcast({
                type: 'terminal_history',
                timestamp: new Date().toISOString(),
                lines: []
            });
            logger.info('Terminal log cleared');
        }
        catch (error) {
            logger.error({ error }, 'Failed to clear log file');
        }
    }
    /**
     * Get the number of connected clients
     */
    getClientCount() {
        return this.connectedClients.size;
    }
    /**
     * Get the log file path
     */
    getLogFilePath() {
        return this.logFilePath;
    }
}
// ============================================================================
// Per-Project Terminal Stream Manager Map
// ============================================================================
// Per-project terminal stream manager Map - prevents cross-project pollution
const terminalStreamsByProject = new Map();
/**
 * Get or create the terminal stream manager for current/specified project
 */
export function getTerminalStreamManager(config, projectPath) {
    const targetProject = projectPath || getProjectPath();
    if (!terminalStreamsByProject.has(targetProject)) {
        terminalStreamsByProject.set(targetProject, new TerminalStreamManager(config));
        logger.debug({ projectPath: targetProject }, 'Created new terminal stream manager for project');
    }
    return terminalStreamsByProject.get(targetProject);
}
/**
 * Reset the terminal stream manager for current/specified project (for testing)
 */
export function resetTerminalStreamManager(projectPath) {
    const targetProject = projectPath || getProjectPath();
    const manager = terminalStreamsByProject.get(targetProject);
    if (manager) {
        manager.stop();
        terminalStreamsByProject.delete(targetProject);
        logger.debug({ projectPath: targetProject }, 'Reset terminal stream manager for project');
    }
}
/**
 * Reset all terminal stream managers across all projects
 */
export function resetAllTerminalStreamManagers() {
    for (const [projectPath, manager] of terminalStreamsByProject) {
        manager.stop();
        logger.debug({ projectPath }, 'Reset terminal stream manager for project');
    }
    terminalStreamsByProject.clear();
}
/**
 * Integration function for WebSocket server
 */
export function setupTerminalWebSocket(wss, path = '/ws/terminal') {
    const manager = getTerminalStreamManager();
    manager.start();
    // Note: The actual path routing should be handled by the main WebSocket setup
    // This function is called when a client connects to the terminal WebSocket path
    return manager;
}
export default {
    TerminalStreamManager,
    getTerminalStreamManager,
    resetTerminalStreamManager,
    setupTerminalWebSocket
};
//# sourceMappingURL=terminalStream.js.map