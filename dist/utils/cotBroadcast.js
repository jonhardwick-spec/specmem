/**
 * COT Broadcast - Bridge between MCP tools and Dashboard
 * ========================================================
 *
 * MCP tools generate COT (Chain of Thought) reasoning via MiniCOTScorer,
 * but the dashboard reads 's terminal - two disconnected systems.
 *
 * This utility bridges them by:
 * 1. Writing COT to a log file that dashboard tails
 * 2. Providing structured COT messages for display
 *
 * Usage in MCP tools:
 *   import { broadcastCOT } from '../utils/cotBroadcast.js';
 *   broadcastCOT('find_memory', 'Analyzing query: authentication patterns', { confidence: 0.85 });
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { logger } from './logger.js';
// ============================================================================
// CONFIG
// ============================================================================
const COT_LOG_FILENAME = 'cot-stream.log';
const MAX_LOG_LINES = 1000; // Rotate after this many lines
const MAX_MESSAGE_LENGTH = 200; // Truncate long messages
// ============================================================================
// UTILITIES
// ============================================================================
/**
 * Get path to COT log file
 */
function getCotLogPath() {
    const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
    return join(projectPath, 'specmem', 'sockets', COT_LOG_FILENAME);
}
/**
 * Ensure COT log directory exists
 */
function ensureLogDir() {
    const logPath = getCotLogPath();
    const dir = dirname(logPath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}
/**
 * Rotate log if too large
 */
function rotateIfNeeded() {
    const logPath = getCotLogPath();
    if (!existsSync(logPath))
        return;
    try {
        const content = readFileSync(logPath, 'utf8');
        const lines = content.split('\n');
        if (lines.length > MAX_LOG_LINES) {
            // Keep last half
            const keepLines = lines.slice(-Math.floor(MAX_LOG_LINES / 2));
            writeFileSync(logPath, keepLines.join('\n'));
            logger.debug({ rotatedFrom: lines.length, rotatedTo: keepLines.length }, '[COT] Log rotated');
        }
    }
    catch (e) {
        // Ignore rotation errors
    }
}
/**
 * Format COT message for log file
 */
function formatCotLine(msg) {
    const time = msg.timestamp.split('T')[1]?.substring(0, 8) || '??:??:??';
    const tool = msg.tool.toUpperCase().replace(/[^A-Z0-9_]/g, '');
    let line = `[${time}] [${tool}] ${msg.message}`;
    // Add metadata if present
    if (msg.metadata?.confidence !== undefined) {
        line += ` (${Math.round(msg.metadata.confidence * 100)}%)`;
    }
    if (msg.metadata?.resultCount !== undefined) {
        line += ` → ${msg.metadata.resultCount} results`;
    }
    if (msg.metadata?.phase) {
        line += ` | ${msg.metadata.phase}`;
    }
    return line;
}
// ============================================================================
// PUBLIC API
// ============================================================================
/**
 * Broadcast COT message to dashboard
 *
 * @param tool - Name of the MCP tool (e.g., 'find_memory', 'find_code_pointers')
 * @param message - Human-readable COT message
 * @param metadata - Optional metadata (confidence, resultCount, etc.)
 */
export function broadcastCOT(tool, message, metadata) {
    try {
        ensureLogDir();
        rotateIfNeeded();
        // Truncate long messages
        const truncatedMessage = message.length > MAX_MESSAGE_LENGTH
            ? message.substring(0, MAX_MESSAGE_LENGTH - 3) + '...'
            : message;
        const cotMsg = {
            timestamp: new Date().toISOString(),
            tool,
            message: truncatedMessage,
            metadata
        };
        const line = formatCotLine(cotMsg);
        const logPath = getCotLogPath();
        appendFileSync(logPath, line + '\n');
        logger.debug({ tool, message: truncatedMessage }, '[COT] Broadcast');
    }
    catch (error) {
        // Don't let COT errors break MCP tools
        logger.warn({ error }, '[COT] Failed to broadcast');
    }
}
/**
 * Broadcast COT start phase
 */
export function cotStart(tool, query) {
    broadcastCOT(tool, `Starting: ${query}`, { phase: 'start', query });
}
/**
 * Broadcast COT analysis phase
 */
export function cotAnalyze(tool, what, confidence) {
    broadcastCOT(tool, `Analyzing: ${what}`, { phase: 'analyze', confidence });
}
/**
 * Broadcast COT result phase
 */
export function cotResult(tool, summary, resultCount, confidence) {
    broadcastCOT(tool, summary, { phase: 'result', resultCount, confidence });
}
/**
 * Broadcast COT error
 */
export function cotError(tool, error) {
    broadcastCOT(tool, `Error: ${error}`, { phase: 'error' });
}
/**
 * Clear COT log (for testing/reset)
 */
export function clearCotLog() {
    try {
        const logPath = getCotLogPath();
        if (existsSync(logPath)) {
            writeFileSync(logPath, '');
        }
    }
    catch (e) {
        // Ignore
    }
}
//# sourceMappingURL=cotBroadcast.js.map