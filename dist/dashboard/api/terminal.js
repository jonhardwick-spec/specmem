/**
 * terminal.ts - Terminal Output API for SpecMem Dashboard
 *
 * Provides REST endpoints for terminal history management and
 * webhook endpoint for hook-based output capture.
 *
 * Phase 5 Implementation - Live Terminal Output Streaming
 */
// @ts-ignore - express types
import { Router } from 'express';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../../utils/logger.js';
import { getTerminalStreamManager } from '../websocket/terminalStream.js';
// ============================================================================
// Configuration
// ============================================================================
// FIX LOW-22: Use secure temp directory instead of hardcoded /tmp
// os.tmpdir() returns platform-appropriate temp directory with proper permissions
function getSecureTempLogPath() {
    const envPath = process.env.SPECMEM_TERMINAL_LOG;
    if (envPath)
        return envPath;
    // Use os.tmpdir() for secure cross-platform temp directory
    const tempDir = os.tmpdir();
    return path.join(tempDir, 'specmem', 'claude-code-output.log');
}
const LOG_FILE = getSecureTempLogPath();
const MAX_LINES = 30;
const MAX_LINE_LENGTH = 2000;
// ============================================================================
// Zod Validation Schemas
// ============================================================================
const TerminalHistoryQuerySchema = z.object({
    lines: z.coerce.number().int().min(1).max(100).default(30)
});
const WebhookPayloadSchema = z.object({
    timestamp: z.string().optional(),
    line: z.string().max(MAX_LINE_LENGTH),
    hookType: z.string().optional(),
    toolName: z.string().optional(),
    event: z.enum(['user_prompt_submit', 'tool_output', 'claude_response', 'notification', 'other']).optional()
});
// ============================================================================
// Terminal API Router
// ============================================================================
export function createTerminalRouter(requireAuth) {
    const router = Router();
    /**
     * GET /api/terminal/history - Get last N lines of terminal output
     */
    router.get('/history', requireAuth, async (req, res) => {
        try {
            const parseResult = TerminalHistoryQuerySchema.safeParse(req.query);
            if (!parseResult.success) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid query parameters',
                    details: parseResult.error.issues.map(i => ({
                        path: i.path.join('.'),
                        message: i.message
                    }))
                });
                return;
            }
            const { lines: requestedLines } = parseResult.data;
            const lines = await getLastNLines(LOG_FILE, requestedLines);
            res.json({
                success: true,
                lines: lines.map(sanitizeLine),
                count: lines.length,
                logFile: LOG_FILE,
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching terminal history');
            res.status(500).json({
                success: false,
                error: 'Failed to fetch terminal history'
            });
        }
    });
    /**
     * POST /api/terminal/clear - Clear terminal output buffer
     */
    router.post('/clear', requireAuth, async (req, res) => {
        try {
            // Clear the log file
            await clearLogFile(LOG_FILE);
            // Also notify the stream manager to broadcast the clear
            const manager = getTerminalStreamManager();
            manager.clearLog();
            logger.info('Terminal buffer cleared via API');
            res.json({
                success: true,
                message: 'Terminal buffer cleared',
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            logger.error({ error }, 'Error clearing terminal buffer');
            res.status(500).json({
                success: false,
                error: 'Failed to clear terminal buffer'
            });
        }
    });
    /**
     * POST /api/terminal/hook - Webhook endpoint for Claude Code hooks
     *
     * Alternative to file-based capture - hooks can POST directly to this endpoint
     */
    router.post('/hook', async (req, res) => {
        try {
            // LOW-39 FIX: Require webhook secret in production
            const webhookSecret = process.env.SPECMEM_TERMINAL_WEBHOOK_SECRET;
            const isProduction = process.env.NODE_ENV === 'production';
            if (isProduction && !webhookSecret) {
                logger.error('SPECMEM_TERMINAL_WEBHOOK_SECRET is required in production mode');
                res.status(500).json({
                    success: false,
                    error: 'Webhook secret not configured - required in production'
                });
                return;
            }
            // Validate webhook secret if configured (always in production, optional in dev)
            if (webhookSecret) {
                const providedSecret = req.headers['x-webhook-secret'] || req.query.secret;
                if (providedSecret !== webhookSecret) {
                    res.status(401).json({
                        success: false,
                        error: 'Invalid webhook secret'
                    });
                    return;
                }
            }
            // Parse and validate payload
            const parseResult = WebhookPayloadSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid webhook payload',
                    details: parseResult.error.issues.map(i => ({
                        path: i.path.join('.'),
                        message: i.message
                    }))
                });
                return;
            }
            const { timestamp, line, hookType, toolName, event } = parseResult.data;
            // Sanitize the line
            const sanitizedLine = sanitizeLine(line);
            // Build the log line
            const logTimestamp = timestamp || new Date().toISOString();
            const prefix = toolName ? `[${toolName}] ` : '';
            const fullLine = `[${logTimestamp}] ${prefix}${sanitizedLine}`;
            // Append to log file
            await appendToLogFile(LOG_FILE, fullLine);
            // Broadcast via WebSocket
            const manager = getTerminalStreamManager();
            // The manager will pick up the change from the file
            logger.debug({
                hookType,
                event,
                lineLength: sanitizedLine.length
            }, 'Received terminal webhook');
            res.json({
                success: true,
                message: 'Output captured',
                timestamp: logTimestamp
            });
        }
        catch (error) {
            logger.error({ error }, 'Error processing terminal webhook');
            res.status(500).json({
                success: false,
                error: 'Failed to process webhook'
            });
        }
    });
    /**
     * GET /api/terminal/status - Get terminal stream status
     */
    router.get('/status', requireAuth, async (req, res) => {
        try {
            const manager = getTerminalStreamManager();
            // Check if log file exists
            const logFileExists = fs.existsSync(LOG_FILE);
            let logFileSize = 0;
            let logFileModified = null;
            if (logFileExists) {
                const stats = fs.statSync(LOG_FILE);
                logFileSize = stats.size;
                logFileModified = stats.mtime;
            }
            res.json({
                success: true,
                status: {
                    streaming: true,
                    connectedClients: manager.getClientCount(),
                    logFile: {
                        path: LOG_FILE,
                        exists: logFileExists,
                        size: logFileSize,
                        lastModified: logFileModified?.toISOString() || null
                    },
                    maxHistoryLines: MAX_LINES
                },
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            logger.error({ error }, 'Error getting terminal status');
            res.status(500).json({
                success: false,
                error: 'Failed to get terminal status'
            });
        }
    });
    /**
     * POST /api/terminal/write - Write a line to terminal (for testing)
     */
    router.post('/write', requireAuth, async (req, res) => {
        try {
            const { line } = req.body;
            if (!line || typeof line !== 'string') {
                res.status(400).json({
                    success: false,
                    error: 'Line is required'
                });
                return;
            }
            const sanitizedLine = sanitizeLine(line);
            const timestamp = new Date().toISOString();
            const fullLine = `[${timestamp}] [test] ${sanitizedLine}`;
            await appendToLogFile(LOG_FILE, fullLine);
            res.json({
                success: true,
                message: 'Line written to terminal log',
                line: fullLine,
                timestamp
            });
        }
        catch (error) {
            logger.error({ error }, 'Error writing to terminal');
            res.status(500).json({
                success: false,
                error: 'Failed to write to terminal'
            });
        }
    });
    return router;
}
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Get the last N lines from a file
 */
async function getLastNLines(filePath, n) {
    try {
        if (!fs.existsSync(filePath)) {
            return [];
        }
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        return lines.slice(-n);
    }
    catch (error) {
        logger.error({ error, filePath }, 'Error reading file');
        return [];
    }
}
/**
 * Append a line to the log file
 */
async function appendToLogFile(filePath, line) {
    try {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }
        // Append line
        await fs.promises.appendFile(filePath, line + '\n', { mode: 0o644 });
        // Rotate if needed
        await rotateLogFile(filePath, MAX_LINES);
    }
    catch (error) {
        logger.error({ error, filePath }, 'Error appending to log file');
        throw error;
    }
}
/**
 * Rotate log file to keep only the last N lines
 */
async function rotateLogFile(filePath, maxLines) {
    try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        if (lines.length > maxLines) {
            const trimmedContent = lines.slice(-maxLines).join('\n') + '\n';
            await fs.promises.writeFile(filePath, trimmedContent, { mode: 0o644 });
        }
    }
    catch (error) {
        logger.error({ error, filePath }, 'Error rotating log file');
    }
}
/**
 * Clear the log file
 */
async function clearLogFile(filePath) {
    try {
        await fs.promises.writeFile(filePath, '', { mode: 0o644 });
    }
    catch (error) {
        logger.error({ error, filePath }, 'Error clearing log file');
        throw error;
    }
}
/**
 * Sanitize a line for safe display
 */
function sanitizeLine(line) {
    // Remove ANSI escape codes
    let sanitized = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    // Remove other control characters (except newline and tab)
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    // Truncate very long lines
    if (sanitized.length > MAX_LINE_LENGTH) {
        sanitized = sanitized.substring(0, MAX_LINE_LENGTH) + '... (truncated)';
    }
    // Filter sensitive patterns
    sanitized = sanitized
        .replace(/(password|secret|token|key|api_key|apikey|auth)([=:]["']?)([^"'\s]+)/gi, '$1$2[REDACTED]')
        .replace(/Bearer [A-Za-z0-9._-]+/g, 'Bearer [REDACTED]');
    return sanitized;
}
export default createTerminalRouter;
//# sourceMappingURL=terminal.js.map