/**
 * liveSessionStream.ts - LIVE  Code Session Streaming API
 *
 * Team Member 2's MASTERPIECE - Real-time streaming of  Code sessions!
 *
 * This watches the history.jsonl file for changes and streams new entries
 * via SSE (Server-Sent Events) to the Console Live Viewer.
 *
 * Features:
 * - File watcher for history.jsonl - detects new entries in real-time
 * - SSE endpoint for live streaming
 * - Clean formatting - transforms JSON to human-readable format
 * - Extracts thinking blocks from responses
 * - Auto-scroll to latest content
 */
// @ts-ignore - express types
import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../../utils/logger.js';
const CLAUDE_HISTORY_PATH = process.env.CLAUDE_HISTORY_PATH || path.join(os.homedir(), '.claude', 'history.jsonl');
const sseClients = new Map();
let fileWatcher = null;
let lastFileSize = 0;
let isWatching = false;
/**
 * Format a raw history entry into a clean, readable format
 */
function formatEntry(raw) {
    let type = 'system';
    let role = 'system';
    let content = '';
    let thinking = [];
    // Determine type and role
    if (raw.type === 'user' || raw.role === 'user') {
        type = 'user';
        role = 'user';
    }
    else if (raw.type === 'assistant' || raw.role === 'assistant') {
        type = 'assistant';
        role = 'assistant';
    }
    else if (raw.type === 'tool_use') {
        type = 'tool_use';
        role = 'tool';
    }
    else if (raw.type === 'tool_result') {
        type = 'tool_result';
        role = 'tool';
    }
    // Handle message wrapper (common in  API responses)
    if (raw.message) {
        if (raw.message.role === 'user') {
            type = 'user';
            role = 'user';
        }
        else if (raw.message.role === 'assistant') {
            type = 'assistant';
            role = 'assistant';
        }
        // Extract content from message
        if (typeof raw.message.content === 'string') {
            content = raw.message.content;
        }
        else if (Array.isArray(raw.message.content)) {
            for (const block of raw.message.content) {
                if (block.type === 'text' && block.text) {
                    content += block.text;
                }
                else if (block.type === 'thinking' && block.thinking) {
                    thinking.push(block.thinking);
                }
            }
        }
    }
    // Extract content from various fields
    if (!content) {
        if (raw.display) {
            content = raw.display;
        }
        else if (typeof raw.content === 'string') {
            content = raw.content;
        }
        else if (Array.isArray(raw.content)) {
            for (const block of raw.content) {
                if (block.type === 'text' && block.text) {
                    content += block.text;
                }
                else if (block.type === 'thinking' && block.thinking) {
                    thinking.push(block.thinking);
                }
            }
        }
        else if (raw.input) {
            content = typeof raw.input === 'string'
                ? raw.input
                : JSON.stringify(raw.input, null, 2);
        }
        else if (raw.output) {
            content = typeof raw.output === 'string'
                ? raw.output
                : JSON.stringify(raw.output, null, 2);
        }
    }
    // Clean up content - remove excessive whitespace but preserve structure
    content = content.trim();
    return {
        type,
        role,
        content,
        thinking: thinking.length > 0 ? thinking : undefined,
        timestamp: raw.timestamp || new Date().toISOString(),
        sessionId: raw.sessionId || raw.uuid || 'unknown',
        toolName: raw.toolName,
        model: raw.model || raw.message?.model,
        raw
    };
}
/**
 * Read new entries from the history file since the last known position
 */
async function readNewEntries(fromSize) {
    const entries = [];
    try {
        const stats = fs.statSync(CLAUDE_HISTORY_PATH);
        if (stats.size <= fromSize) {
            return entries; // No new data
        }
        // Read only the new portion of the file
        const buffer = Buffer.alloc(stats.size - fromSize);
        const fd = fs.openSync(CLAUDE_HISTORY_PATH, 'r');
        try {
            fs.readSync(fd, buffer, 0, buffer.length, fromSize);
        }
        finally {
            fs.closeSync(fd);
        }
        const newContent = buffer.toString('utf-8');
        const lines = newContent.split('\n').filter(line => line.trim());
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line);
                const formatted = formatEntry(parsed);
                entries.push(formatted);
            }
            catch (e) {
                // Skip malformed lines
                logger.debug({ line: line.substring(0, 100) }, 'Skipped malformed line');
            }
        }
        // Update last file size
        lastFileSize = stats.size;
    }
    catch (error) {
        logger.error({ error }, 'Error reading new entries from history file');
    }
    return entries;
}
/**
 * Broadcast new entries to all connected SSE clients
 */
async function broadcastNewEntries() {
    if (sseClients.size === 0)
        return;
    try {
        const entries = await readNewEntries(lastFileSize);
        if (entries.length === 0)
            return;
        logger.debug({ count: entries.length, clients: sseClients.size }, 'Broadcasting new entries');
        for (const entry of entries) {
            const eventData = JSON.stringify(entry);
            // Send to all clients
            for (const [id, client] of sseClients) {
                try {
                    // Determine event type based on entry type
                    let eventType = 'entry';
                    if (entry.type === 'user')
                        eventType = 'userMessage';
                    else if (entry.type === 'assistant')
                        eventType = 'assistantMessage';
                    else if (entry.thinking && entry.thinking.length > 0)
                        eventType = 'thinking';
                    else if (entry.type === 'tool_use')
                        eventType = 'toolUse';
                    else if (entry.type === 'tool_result')
                        eventType = 'toolResult';
                    client.res.write(`event: ${eventType}\n`);
                    client.res.write(`data: ${eventData}\n\n`);
                    // Also send thinking blocks separately if present
                    if (entry.thinking && entry.thinking.length > 0) {
                        for (const thought of entry.thinking) {
                            client.res.write(`event: thinking\n`);
                            client.res.write(`data: ${JSON.stringify({ content: thought, timestamp: entry.timestamp })}\n\n`);
                        }
                    }
                }
                catch (e) {
                    // Client probably disconnected
                    logger.debug({ clientId: id }, 'Removing disconnected SSE client');
                    sseClients.delete(id);
                }
            }
        }
    }
    catch (error) {
        logger.error({ error }, 'Error broadcasting new entries');
    }
}
/**
 * Start watching the history file for changes
 */
function startFileWatcher() {
    if (isWatching)
        return;
    if (!fs.existsSync(CLAUDE_HISTORY_PATH)) {
        logger.warn({ path: CLAUDE_HISTORY_PATH }, 'History file not found, watcher not started');
        return;
    }
    try {
        // Get initial file size
        const stats = fs.statSync(CLAUDE_HISTORY_PATH);
        lastFileSize = stats.size;
        // Watch for changes
        fileWatcher = fs.watch(CLAUDE_HISTORY_PATH, { persistent: false }, async (eventType) => {
            if (eventType === 'change') {
                await broadcastNewEntries();
            }
        });
        fileWatcher.on('error', (error) => {
            logger.error({ error }, 'File watcher error');
            stopFileWatcher();
            // Try to restart after a delay
            setTimeout(() => {
                if (sseClients.size > 0) {
                    startFileWatcher();
                }
            }, 5000);
        });
        isWatching = true;
        logger.info({ path: CLAUDE_HISTORY_PATH }, 'Started watching history file for live updates');
    }
    catch (error) {
        logger.error({ error }, 'Failed to start file watcher');
    }
}
/**
 * Stop watching the history file
 */
function stopFileWatcher() {
    if (fileWatcher) {
        fileWatcher.close();
        fileWatcher = null;
    }
    isWatching = false;
    logger.info('Stopped watching history file');
}
// ============================================================================
// Router
// ============================================================================
export function createLiveSessionRouter(requireAuth) {
    const router = Router();
    /**
     * GET /api/live/stream - SSE endpoint for live session streaming
     *
     * Streams new  Code session entries in real-time.
     * Connect with EventSource in the browser.
     */
    router.get('/stream', requireAuth, (req, res) => {
        const clientId = `sse-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        logger.info({ clientId }, 'New SSE client connected for live session streaming');
        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
        res.flushHeaders();
        // Send initial connection event
        res.write(`event: connected\n`);
        res.write(`data: ${JSON.stringify({
            clientId,
            historyPath: CLAUDE_HISTORY_PATH,
            timestamp: new Date().toISOString(),
            message: 'Connected to live session stream'
        })}\n\n`);
        // Register client
        sseClients.set(clientId, {
            id: clientId,
            res,
            lastLineNumber: 0
        });
        // Start file watcher if not already running
        if (!isWatching) {
            startFileWatcher();
        }
        // Send heartbeat every 30 seconds to keep connection alive
        const heartbeatInterval = setInterval(() => {
            try {
                res.write(`event: heartbeat\n`);
                res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
            }
            catch (e) {
                clearInterval(heartbeatInterval);
            }
        }, 30000);
        // Handle client disconnect
        req.on('close', () => {
            logger.info({ clientId }, 'SSE client disconnected');
            clearInterval(heartbeatInterval);
            sseClients.delete(clientId);
            // Stop watcher if no more clients
            if (sseClients.size === 0) {
                stopFileWatcher();
            }
        });
    });
    /**
     * GET /api/live/recent - Get recent entries (initial load for live viewer)
     *
     * Returns the last N entries in formatted form.
     */
    router.get('/recent', requireAuth, async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 50, 200);
            if (!fs.existsSync(CLAUDE_HISTORY_PATH)) {
                res.json({
                    success: true,
                    entries: [],
                    count: 0,
                    message: 'History file not found'
                });
                return;
            }
            // Read the entire file and get the last N entries
            const content = fs.readFileSync(CLAUDE_HISTORY_PATH, 'utf-8');
            const lines = content.split('\n').filter(line => line.trim());
            const lastLines = lines.slice(-limit);
            const entries = [];
            for (const line of lastLines) {
                try {
                    const parsed = JSON.parse(line);
                    entries.push(formatEntry(parsed));
                }
                catch (e) {
                    // Skip malformed lines
                }
            }
            res.json({
                success: true,
                entries,
                count: entries.length,
                total: lines.length,
                historyPath: CLAUDE_HISTORY_PATH,
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching recent entries');
            res.status(500).json({
                success: false,
                error: 'Failed to fetch recent entries'
            });
        }
    });
    /**
     * GET /api/live/status - Get live stream status
     */
    router.get('/status', requireAuth, (req, res) => {
        res.json({
            success: true,
            isWatching,
            connectedClients: sseClients.size,
            historyPath: CLAUDE_HISTORY_PATH,
            historyExists: fs.existsSync(CLAUDE_HISTORY_PATH),
            lastFileSize,
            timestamp: new Date().toISOString()
        });
    });
    /**
     * GET /api/live/thinking - Get the thinking stream endpoint
     *
     * SSE endpoint specifically for thinking blocks - shows 's reasoning
     */
    router.get('/thinking', requireAuth, (req, res) => {
        const clientId = `thinking-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        logger.info({ clientId }, 'New thinking stream client connected');
        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        // Send initial connection
        res.write(`event: connected\n`);
        res.write(`data: ${JSON.stringify({
            clientId,
            type: 'thinking_stream',
            timestamp: new Date().toISOString()
        })}\n\n`);
        // For now, this shares the same client pool
        // Thinking-specific filtering happens in broadcastNewEntries
        sseClients.set(clientId, {
            id: clientId,
            res,
            lastLineNumber: 0
        });
        if (!isWatching) {
            startFileWatcher();
        }
        const heartbeatInterval = setInterval(() => {
            try {
                res.write(`:heartbeat\n\n`);
            }
            catch (e) {
                clearInterval(heartbeatInterval);
            }
        }, 30000);
        req.on('close', () => {
            logger.info({ clientId }, 'Thinking stream client disconnected');
            clearInterval(heartbeatInterval);
            sseClients.delete(clientId);
            if (sseClients.size === 0) {
                stopFileWatcher();
            }
        });
    });
    return router;
}
export default createLiveSessionRouter;
//# sourceMappingURL=liveSessionStream.js.map