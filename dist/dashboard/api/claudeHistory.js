// @ts-ignore - express types
import { Router } from 'express';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as os from 'os';
import { logger } from '../../utils/logger.js';
const CLAUDE_HISTORY_PATH = process.env.CLAUDE_HISTORY_PATH || path.join(os.homedir(), '.claude', 'history.jsonl');
const DEFAULT_LINE_COUNT = 50;
const MAX_LINE_COUNT = 100;
const HistoryQuerySchema = z.object({
    lines: z.coerce.number().int().min(1).max(MAX_LINE_COUNT).default(DEFAULT_LINE_COUNT),
    offset: z.coerce.number().int().min(0).default(0),
    filter: z.enum(['all', 'user', 'assistant', 'system', 'tool_use', 'tool_result']).optional(),
    search: z.string().max(500).optional()
});
export function createHistoryRouter(requireAuth) {
    const router = Router();
    router.get('/history', requireAuth, async (req, res) => {
        try {
            const parseResult = HistoryQuerySchema.safeParse(req.query);
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
            const { lines: requestedLines, offset, filter, search } = parseResult.data;
            if (!fs.existsSync(CLAUDE_HISTORY_PATH)) {
                res.json({
                    success: true,
                    entries: [],
                    total: 0,
                    historyPath: CLAUDE_HISTORY_PATH,
                    message: 'History file not found -  Code may not have been used yet'
                });
                return;
            }
            const allEntries = await readHistoryFile(CLAUDE_HISTORY_PATH);
            let filteredEntries = allEntries;
            if (filter && filter !== 'all') {
                filteredEntries = filteredEntries.filter(entry => {
                    if (filter === 'user')
                        return entry.role === 'user';
                    if (filter === 'assistant')
                        return entry.role === 'assistant';
                    if (filter === 'system')
                        return entry.type === 'system';
                    if (filter === 'tool_use')
                        return entry.type === 'tool_use';
                    if (filter === 'tool_result')
                        return entry.type === 'tool_result';
                    return true;
                });
            }
            if (search) {
                const searchLower = search.toLowerCase();
                filteredEntries = filteredEntries.filter(entry => entry.content.toLowerCase().includes(searchLower) ||
                    (entry.toolName && entry.toolName.toLowerCase().includes(searchLower)));
            }
            const totalEntries = filteredEntries.length;
            const paginatedEntries = filteredEntries
                .slice(Math.max(0, totalEntries - offset - requestedLines), totalEntries - offset)
                .reverse();
            res.json({
                success: true,
                entries: paginatedEntries,
                total: totalEntries,
                limit: requestedLines,
                offset,
                filter: filter || 'all',
                historyPath: CLAUDE_HISTORY_PATH
            });
        }
        catch (error) {
            logger.error({ error }, 'Error reading claude history');
            res.status(500).json({
                success: false,
                error: 'Failed to read claude history'
            });
        }
    });
    router.get('/history/tail', requireAuth, async (req, res) => {
        try {
            const linesParam = parseInt(req.query.lines) || DEFAULT_LINE_COUNT;
            const lineCount = Math.min(Math.max(1, linesParam), MAX_LINE_COUNT);
            if (!fs.existsSync(CLAUDE_HISTORY_PATH)) {
                res.json({
                    success: true,
                    entries: [],
                    count: 0,
                    historyPath: CLAUDE_HISTORY_PATH
                });
                return;
            }
            const entries = await tailHistoryFile(CLAUDE_HISTORY_PATH, lineCount);
            res.json({
                success: true,
                entries,
                count: entries.length,
                timestamp: new Date().toISOString(),
                historyPath: CLAUDE_HISTORY_PATH
            });
        }
        catch (error) {
            logger.error({ error }, 'Error tailing claude history');
            res.status(500).json({
                success: false,
                error: 'Failed to tail claude history'
            });
        }
    });
    router.get('/history/stats', requireAuth, async (req, res) => {
        try {
            if (!fs.existsSync(CLAUDE_HISTORY_PATH)) {
                res.json({
                    success: true,
                    stats: {
                        exists: false,
                        totalEntries: 0,
                        fileSizeBytes: 0
                    }
                });
                return;
            }
            const fileStats = fs.statSync(CLAUDE_HISTORY_PATH);
            const allEntries = await readHistoryFile(CLAUDE_HISTORY_PATH);
            const roleCountMap = new Map();
            const typeCountMap = new Map();
            const sessionCountMap = new Map();
            for (const entry of allEntries) {
                roleCountMap.set(entry.role, (roleCountMap.get(entry.role) || 0) + 1);
                typeCountMap.set(entry.type, (typeCountMap.get(entry.type) || 0) + 1);
                if (entry.sessionId) {
                    sessionCountMap.set(entry.sessionId, (sessionCountMap.get(entry.sessionId) || 0) + 1);
                }
            }
            const roleBreakdown = Object.fromEntries(roleCountMap);
            const typeBreakdown = Object.fromEntries(typeCountMap);
            res.json({
                success: true,
                stats: {
                    exists: true,
                    totalEntries: allEntries.length,
                    fileSizeBytes: fileStats.size,
                    fileSizeMB: (fileStats.size / 1024 / 1024).toFixed(2),
                    lastModified: fileStats.mtime.toISOString(),
                    roleBreakdown,
                    typeBreakdown,
                    uniqueSessions: sessionCountMap.size,
                    historyPath: CLAUDE_HISTORY_PATH
                }
            });
        }
        catch (error) {
            logger.error({ error }, 'Error getting claude history stats');
            res.status(500).json({
                success: false,
                error: 'Failed to get claude history stats'
            });
        }
    });
    router.get('/history/sessions', requireAuth, async (req, res) => {
        try {
            if (!fs.existsSync(CLAUDE_HISTORY_PATH)) {
                res.json({
                    success: true,
                    sessions: []
                });
                return;
            }
            const allEntries = await readHistoryFile(CLAUDE_HISTORY_PATH);
            const sessionMap = new Map();
            for (const entry of allEntries) {
                const sessionId = entry.sessionId || 'unknown';
                const existing = sessionMap.get(sessionId);
                if (existing) {
                    existing.lastSeen = entry.timestamp;
                    existing.entryCount++;
                    if (entry.role === 'user')
                        existing.userMessages++;
                    if (entry.role === 'assistant')
                        existing.assistantMessages++;
                }
                else {
                    sessionMap.set(sessionId, {
                        sessionId,
                        firstSeen: entry.timestamp,
                        lastSeen: entry.timestamp,
                        entryCount: 1,
                        userMessages: entry.role === 'user' ? 1 : 0,
                        assistantMessages: entry.role === 'assistant' ? 1 : 0
                    });
                }
            }
            const sessionsArray = Array.from(sessionMap.values())
                .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
            res.json({
                success: true,
                sessions: sessionsArray,
                totalSessions: sessionsArray.length
            });
        }
        catch (error) {
            logger.error({ error }, 'Error getting claude sessions');
            res.status(500).json({
                success: false,
                error: 'Failed to get claude sessions'
            });
        }
    });
    return router;
}
async function readHistoryFile(filePath) {
    const entries = [];
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });
    let lineNumber = 0;
    for await (const line of rl) {
        lineNumber++;
        if (!line.trim())
            continue;
        try {
            const parsed = JSON.parse(line);
            entries.push(parseHistoryEntry(parsed, lineNumber));
        }
        catch (parseError) {
            logger.debug({ lineNumber, parseError }, 'Failed to parse history line');
        }
    }
    return entries;
}
async function tailHistoryFile(filePath, lineCount) {
    const fileStats = fs.statSync(filePath);
    const fileSize = fileStats.size;
    const estimatedBytesPerLine = 500;
    const bufferSize = Math.min(fileSize, lineCount * estimatedBytesPerLine * 2);
    const buffer = Buffer.alloc(bufferSize);
    const fileHandle = fs.openSync(filePath, 'r');
    const readStart = Math.max(0, fileSize - bufferSize);
    try {
        fs.readSync(fileHandle, buffer, 0, bufferSize, readStart);
    }
    finally {
        fs.closeSync(fileHandle);
    }
    const content = buffer.toString('utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    if (readStart > 0 && lines.length > 0) {
        lines.shift();
    }
    const lastLines = lines.slice(-lineCount);
    const entries = [];
    let lineNumber = 0;
    for (const line of lastLines) {
        lineNumber++;
        try {
            const parsed = JSON.parse(line);
            entries.push(parseHistoryEntry(parsed, lineNumber));
        }
        catch (parseError) {
            logger.debug({ lineNumber, parseError }, 'Failed to parse tail line');
        }
    }
    return entries;
}
function parseHistoryEntry(entry, lineNumber) {
    let contentText = '';
    let entryType = entry.type || 'unknown';
    let entryRole = entry.role || 'system';
    if (entry.content) {
        if (typeof entry.content === 'string') {
            contentText = entry.content;
        }
        else if (Array.isArray(entry.content)) {
            contentText = entry.content
                .map(block => block.text || JSON.stringify(block))
                .join('\n');
        }
        else {
            contentText = JSON.stringify(entry.content);
        }
    }
    if (entry.input) {
        contentText = contentText || JSON.stringify(entry.input, null, 2);
        entryType = 'tool_use';
    }
    if (entry.output) {
        contentText = contentText || JSON.stringify(entry.output, null, 2);
        entryType = 'tool_result';
    }
    return {
        lineNumber,
        timestamp: entry.timestamp || new Date().toISOString(),
        type: entryType,
        role: entryRole,
        content: truncateContent(contentText, 5000),
        sessionId: entry.sessionId || 'unknown',
        model: entry.model,
        toolName: entry.toolName,
        raw: entry
    };
}
function truncateContent(content, maxLength) {
    if (content.length <= maxLength)
        return content;
    return content.substring(0, maxLength) + '... [truncated]';
}
export default createHistoryRouter;
//# sourceMappingURL=claudeHistory.js.map