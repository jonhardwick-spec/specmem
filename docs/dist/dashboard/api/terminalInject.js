/**
 * terminalInject.ts - Terminal Prompt Injection API
 *
 * Injects prompts directly into the running Claude Code terminal session.
 *
 * Features:
 * - STY-based session detection (reliable current session identification)
 * - screen -X stuff injection with Enter key support
 * - Auto-discovery of Claude process PID and TTY
 *
 * Primary method: Use STY env var + screen -X stuff
 * Fallback: TIOCSTI ioctl (when not in screen session)
 */
// @ts-ignore - express types
import { Router } from 'express';
import { execSync } from 'child_process';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { getCurrentScreenSession, injectToSession, listScreenSessions } from '../../utils/sessionInjector.js';
// ============================================================================
// Zod Validation Schemas
// ============================================================================
const InjectPromptSchema = z.object({
    prompt: z.string().min(1).max(10000),
    autoSubmit: z.boolean().optional().default(false), // NOW WORKS! Uses $'\r' for Enter
    clearFirst: z.boolean().optional().default(false), // Clear input before injecting
    sessionName: z.string().optional() // Override session detection
});
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Find the current Claude Code process PID and TTY
 * Returns the NEWEST Claude instance (highest PID)
 */
function findClaudeProcess() {
    try {
        // Find Claude process (not SCREEN, not grep) - get the NEWEST one (last line = highest PID)
        const psOutput = execSync(`ps aux | grep "^root.*claude$" | grep -v grep | grep -v SCREEN | tail -1`, { encoding: 'utf-8' }).trim();
        if (!psOutput) {
            return null;
        }
        const parts = psOutput.split(/\s+/);
        const pid = parseInt(parts[1], 10);
        if (isNaN(pid)) {
            return null;
        }
        // Get the TTY for this process
        const ttyOutput = execSync(`ls -l /proc/${pid}/fd/0 | awk '{print $NF}'`, { encoding: 'utf-8' }).trim();
        if (!ttyOutput || !ttyOutput.startsWith('/dev/pts/')) {
            return null;
        }
        return { pid, tty: ttyOutput };
    }
    catch (error) {
        logger.error({ error }, 'Failed to find Claude process');
        return null;
    }
}
/**
 * Inject prompt into terminal using TIOCSTI
 */
function injectPrompt(tty, prompt) {
    try {
        // Write prompt to temp file to avoid shell escaping issues
        const fs = require('fs');
        const tmpFile = `/tmp/inject-${Date.now()}.txt`;
        fs.writeFileSync(tmpFile, prompt, 'utf-8');
        // Use our working injection tool with file input
        execSync(`/tmp/inject_tty "${tty}" "$(cat ${tmpFile})"`, {
            encoding: 'utf-8'
        });
        // Clean up temp file
        fs.unlinkSync(tmpFile);
        logger.info({ tty, promptLength: prompt.length }, 'Prompt injected successfully');
        return true;
    }
    catch (error) {
        logger.error({ error, tty }, 'Failed to inject prompt');
        return false;
    }
}
// ============================================================================
// Terminal Inject Router
// ============================================================================
export function createTerminalInjectRouter(requireAuth) {
    const router = Router();
    /**
     * POST /api/terminal/inject - Inject prompt into Claude Code terminal
     *
     * NOW SUPPORTS autoSubmit=true to automatically press Enter after injection!
     * Uses STY environment variable for reliable session detection.
     */
    router.post('/inject', requireAuth, async (req, res) => {
        try {
            // Validate request
            const parseResult = InjectPromptSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid request body',
                    details: parseResult.error.issues.map(i => ({
                        path: i.path.join('.'),
                        message: i.message
                    }))
                });
                return;
            }
            const { prompt, autoSubmit, clearFirst, sessionName: requestedSession } = parseResult.data;
            // Determine which session to use
            let targetSession = requestedSession;
            if (!targetSession) {
                // Try STY env var first (most reliable)
                targetSession = getCurrentScreenSession() || undefined;
                // Fallback: list sessions and pick newest
                if (!targetSession) {
                    const sessions = listScreenSessions();
                    if (sessions.length > 0) {
                        // Sort by PID descending (newest first)
                        sessions.sort((a, b) => b.pid - a.pid);
                        targetSession = sessions[0].name;
                    }
                }
            }
            if (!targetSession) {
                // Last resort: try TIOCSTI approach
                const claudeProcess = findClaudeProcess();
                if (!claudeProcess) {
                    res.status(404).json({
                        success: false,
                        error: 'No Claude session found',
                        message: 'No screen session or Claude process found'
                    });
                    return;
                }
                // Use TIOCSTI fallback (doesn't support autoSubmit)
                const injected = injectPrompt(claudeProcess.tty, prompt);
                res.json({
                    success: injected,
                    message: injected ? 'Prompt injected via TIOCSTI' : 'TIOCSTI injection failed',
                    method: 'tiocsti',
                    autoSubmit: false,
                    note: 'TIOCSTI does not support auto-submit - user must press Enter'
                });
                return;
            }
            // Use screen -X stuff method (supports autoSubmit!)
            try {
                // Clear input first if requested (Ctrl+U)
                if (clearFirst) {
                    execSync(`screen -S "${targetSession}" -p 0 -X stuff $'\\x15'`, { encoding: 'utf-8' });
                    execSync('sleep 0.05');
                }
                // Inject the prompt and optionally submit
                const injected = injectToSession(targetSession, prompt, autoSubmit);
                res.json({
                    success: injected,
                    message: injected
                        ? `Prompt injected${autoSubmit ? ' and submitted' : ''}`
                        : 'Injection failed',
                    method: 'screen-stuff',
                    session: targetSession,
                    autoSubmit: autoSubmit,
                    note: autoSubmit ? 'Enter key was sent automatically' : 'User must press Enter to submit'
                });
            }
            catch (screenError) {
                logger.error({ error: screenError, session: targetSession }, 'Screen injection failed');
                res.status(500).json({
                    success: false,
                    error: 'Screen injection failed',
                    message: screenError instanceof Error ? screenError.message : 'Unknown error'
                });
            }
        }
        catch (error) {
            logger.error({ error }, 'Error injecting prompt');
            res.status(500).json({
                success: false,
                error: 'Failed to inject prompt',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });
    /**
     * GET /api/terminal/status - Check Claude Code terminal status
     * Returns screen session info and process info
     */
    router.get('/status', requireAuth, async (req, res) => {
        try {
            // Get screen sessions
            const sessions = listScreenSessions();
            const currentSession = getCurrentScreenSession();
            // Get Claude process info (fallback)
            const claudeProcess = findClaudeProcess();
            if (sessions.length === 0 && !claudeProcess) {
                res.json({
                    success: true,
                    running: false,
                    message: 'No Claude sessions found'
                });
                return;
            }
            res.json({
                success: true,
                running: true,
                currentSession: currentSession || null,
                sessions: sessions,
                claudeProcess: claudeProcess ? {
                    pid: claudeProcess.pid,
                    tty: claudeProcess.tty
                } : null,
                autoSubmitSupported: sessions.length > 0
            });
        }
        catch (error) {
            logger.error({ error }, 'Error checking terminal status');
            res.status(500).json({
                success: false,
                error: 'Failed to check terminal status'
            });
        }
    });
    /**
     * POST /api/terminal/new-instance - Start a new Claude Code screen session
     */
    router.post('/new-instance', requireAuth, async (req, res) => {
        try {
            const timestamp = Date.now();
            const sessionName = `claude_${timestamp}`;
            const logFile = `/tmp/screen-${sessionName}.log`;
            // Create session with screen's built-in logging (-L = enable logging, -Logfile = log path)
            // This safely captures ALL output without crashing the instance
            const startCommand = `screen -L -Logfile ${logFile} -dmS ${sessionName} claude`;
            execSync(startCommand, { encoding: 'utf-8' });
            logger.info({ sessionName, logFile }, 'New Claude instance started with logging');
            setTimeout(() => {
                try {
                    const checkCommand = `screen -list | grep ${sessionName}`;
                    const screenList = execSync(checkCommand, { encoding: 'utf-8' }).trim();
                    const match = screenList.match(/(\d+)\./);
                    const pid = match ? parseInt(match[1], 10) : null;
                    res.json({
                        success: true,
                        message: 'New Claude instance started with logging',
                        sessionName: sessionName,
                        logFile: logFile,
                        pid: pid
                    });
                }
                catch (error) {
                    res.json({
                        success: true,
                        message: 'Claude instance started but PID not yet available',
                        sessionName: sessionName,
                        logFile: logFile
                    });
                }
            }, 1000);
        }
        catch (error) {
            logger.error({ error }, 'Failed to start new Claude instance');
            res.status(500).json({
                success: false,
                error: 'Failed to start new instance',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });
    return router;
}
export default createTerminalInjectRouter;
//# sourceMappingURL=terminalInject.js.map