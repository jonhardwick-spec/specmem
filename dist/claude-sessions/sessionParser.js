/**
 * sessionParser.ts -  Code Session File Parser
 *
 * Parses  Code session files to extract conversations:
 * - Reads from ~/.claude/history.jsonl (user prompts with metadata)
 * - Reads from ~/.claude/projects/ directories (full conversations)
 *
 * Features:
 * - Parses both history.jsonl and project session files (JSONL format)
 * - Extracts USER messages and ASSISTANT messages
 * - Extracts thinking blocks from 's responses
 * - Extracts tool_use blocks for context
 * - Tags messages properly: role:user, role:assistant, has-thinking
 * - Formats content: [USER] prefix or [CLAUDE] prefix with [THINKING] blocks
 * - Hash-based deduplication using session_id + timestamp
 * - Chunked loading with ACK verification
 *
 * DEDUPLICATION STRATEGY (FIX MED-44):
 * All entry points use standardized deduplication:
 * - generateEntryHash: sessionId + timestamp (for session-level dedup)
 * - generateContentHash: role + content (for content-level dedup)
 * - CASE-SENSITIVE: Do NOT lowercase content (FIX MED-28)
 *
 * USER/CLAUDE PAIRING METADATA:
 * convertToMemoryParams() sets these fields for find_memory pairing:
 * - sessionId: Same for all messages in a session (enables grouping)
 * - timestamp: ISO string from JSONL entry (when message was sent)
 * - timestampMs: Numeric ms since epoch (efficient comparison/ordering)
 * - role: 'user' or 'assistant' (message direction)
 * - messageId: Unique ID for this message (from uuid field in JSONL)
 */
import { promises as fs } from 'fs';
import { statSync } from 'fs';
import { join, basename } from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { logger } from '../utils/logger.js';
/**
 * Generate hash for deduplication based on session_id + timestamp
 * LEGACY: Used for backwards compatibility with existing hashes
 */
export function generateEntryHash(sessionId, timestamp) {
    const ts = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp;
    // FIX HIGH-31: Validate timestamp to prevent NaN hash collisions
    if (isNaN(ts)) {
        throw new Error(`Invalid timestamp value: ${timestamp} - cannot generate hash for session ${sessionId}`);
    }
    return createHash('sha256')
        .update(`${sessionId}:${ts}`)
        .digest('hex')
        .slice(0, 16); // 16 char hash is sufficient
}
/**
 * Generate content hash for deduplication based on actual content
 * This prevents storing the same message multiple times even if from different sources
 *
 * FIX MED-28: Removed .toLowerCase() - case normalization caused false deduplication
 * where "Fix bug" and "FIX BUG" would be treated as the same message.
 * We still normalize whitespace and remove prefixes but preserve case.
 */
export function generateContentHash(content, role) {
    // Normalize content: trim whitespace, remove common prefixes
    // FIX MED-28: Do NOT lowercase - case differences are meaningful!
    const normalized = content
        .trim()
        .replace(/^\[user\]\s*/i, '')
        .replace(/^\[claude\]\s*/i, '');
    return createHash('sha256')
        .update(`${role}:${normalized}`)
        .digest('hex')
        .slice(0, 16);
}
const DEFAULT_CHUNKING_CONFIG = {
    targetBytesPerSecond: 104857600, // 100MB/s
    chunkDelayMs: 10, // 10ms delay between chunks
    batchSize: 100 // 100 entries per batch
};
/**
 * SessionParser - parses  Code session files
 *
 * Reads from:
 * - ~/.claude/history.jsonl (user prompts)
 * - ~/.claude/projects/ directories (full conversations with assistant responses)
 *
 * PROJECT FILTERING (FIX Task #13):
 * When projectPathFilter is provided, only parses session files that match the project.
 * This prevents wasted parsing of sessions from other projects.
 */
export class SessionParser {
    claudeDir;
    projectsDir;
    historyPath;
    projectPathFilter;
    constructor(claudeDir = join(os.homedir(), '.claude'), projectPathFilter = null) {
        this.claudeDir = claudeDir;
        this.projectsDir = join(claudeDir, 'projects');
        this.historyPath = join(claudeDir, 'history.jsonl');
        this.projectPathFilter = projectPathFilter;
    }
    /**
     * FIX Task #13: Set project path filter after construction
     * Allows updating the filter for existing parser instances
     */
    setProjectPathFilter(projectPath) {
        this.projectPathFilter = projectPath;
    }
    /**
     * Get all project directories containing session files
     *
     * FIX Task #13: When projectPathFilter is set, only returns directories
     * that match the current project path (encoded in directory name).
     * This enables early filtering BEFORE parsing files.
     */
    async getProjectDirectories() {
        const dirs = [];
        try {
            await fs.access(this.projectsDir);
            const entries = await fs.readdir(this.projectsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const dirPath = join(this.projectsDir, entry.name);
                    // FIX Task #13: Early filtering by project path if filter is set
                    if (this.projectPathFilter) {
                        //  encodes project paths in directory names by replacing / with -
                        // e.g., /specmem becomes -specmem or specmem
                        // Check if this directory could belong to our project
                        const encodedFilter = this.projectPathFilter.replace(/\//g, '-').replace(/^-/, '');
                        const dirName = entry.name;
                        // Match if dir name starts with or contains the encoded project path
                        const couldMatch = dirName.includes(encodedFilter) ||
                            encodedFilter.includes(dirName) ||
                            dirName.startsWith(encodedFilter.slice(0, 20)); // prefix match for long paths
                        if (!couldMatch) {
                            logger.debug({
                                skippedDir: dirName,
                                projectFilter: this.projectPathFilter
                            }, 'Task #13: skipping project dir (does not match filter)');
                            continue;
                        }
                    }
                    dirs.push(dirPath);
                }
            }
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                logger.warn({ error, path: this.projectsDir }, 'failed to read projects directory');
            }
        }
        return dirs;
    }
    /**
     * Get all session files from all project directories
     * SORTED BY MODIFICATION TIME (newest first) for efficient catch-up
     */
    async getAllSessionFiles() {
        const filesWithMtime = [];
        // Add history.jsonl if it exists
        try {
            await fs.access(this.historyPath);
            const stat = statSync(this.historyPath);
            filesWithMtime.push({ path: this.historyPath, mtime: stat.mtimeMs });
        }
        catch {
            // history.jsonl doesn't exist, skip
        }
        // Get all project directories and their session files
        const projectDirs = await this.getProjectDirectories();
        for (const dir of projectDirs) {
            try {
                const dirFiles = await fs.readdir(dir);
                for (const file of dirFiles) {
                    if (file.endsWith('.jsonl')) {
                        const filePath = join(dir, file);
                        try {
                            const stat = statSync(filePath);
                            filesWithMtime.push({ path: filePath, mtime: stat.mtimeMs });
                        }
                        catch {
                            // Skip if can't stat
                        }
                    }
                }
            }
            catch {
                // Skip inaccessible directories
            }
        }
        // Sort by modification time DESCENDING (newest first)
        filesWithMtime.sort((a, b) => b.mtime - a.mtime);
        logger.debug({
            fileCount: filesWithMtime.length,
            newestFile: filesWithMtime[0]?.path,
            oldestFile: filesWithMtime[filesWithMtime.length - 1]?.path
        }, 'session files sorted by mtime (newest first)');
        return filesWithMtime.map(f => f.path);
    }
    /**
     * parseAllSessions - reads ALL session files from history.jsonl and project directories
     *
     * Reads both user prompts and 's responses including thinking blocks
     */
    async parseAllSessions() {
        logger.info({ historyPath: this.historyPath, projectsDir: this.projectsDir }, 'parsing  session files');
        try {
            const allFiles = await this.getAllSessionFiles();
            logger.info({ fileCount: allFiles.length }, 'found session files');
            const allSessions = [];
            for (const filePath of allFiles) {
                // Determine if this is history.jsonl or a project session file
                const isHistoryFile = filePath === this.historyPath;
                const sessions = isHistoryFile
                    ? await this.parseHistoryJsonl(filePath)
                    : await this.parseSessionFile(filePath);
                allSessions.push(...sessions);
            }
            logger.info({ totalMessages: allSessions.length }, 'session parsing complete');
            return allSessions;
        }
        catch (error) {
            logger.error({ error }, 'failed to parse session files');
            throw error;
        }
    }
    /**
     * parseHistoryJsonl - parses the history.jsonl file (user prompts only)
     *
     * FIX HIGH-30: Added parse error stats and warning logs instead of silent skip
     * FIX Task #13: Added early project filtering at entry level
     */
    async parseHistoryJsonl(filePath) {
        const sessions = [];
        // FIX HIGH-30: Track parse error stats
        let parseErrors = 0;
        let totalLines = 0;
        let projectFiltered = 0;
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n').filter(line => line.trim());
            totalLines = lines.length;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                try {
                    const entry = JSON.parse(line);
                    // FIX Task #13: Early project filtering at entry level
                    if (this.projectPathFilter && entry.project) {
                        if (!this.matchesProjectFilter(entry.project)) {
                            projectFiltered++;
                            continue;
                        }
                    }
                    const parsed = this.convertHistoryEntry(entry);
                    if (parsed) {
                        sessions.push(parsed);
                    }
                }
                catch (parseError) {
                    // FIX HIGH-30: Log warning instead of silent skip
                    parseErrors++;
                    if (parseErrors <= 5) {
                        // Only log first 5 errors to avoid spam
                        logger.warn({
                            filePath,
                            lineNumber: i + 1,
                            error: parseError instanceof Error ? parseError.message : String(parseError),
                            linePreview: line.substring(0, 100) + (line.length > 100 ? '...' : '')
                        }, 'HIGH-30: Failed to parse JSON line in history.jsonl');
                    }
                }
            }
            // FIX Task #13: Log if we filtered entries
            if (projectFiltered > 0) {
                logger.debug({
                    filePath: basename(filePath),
                    projectFiltered,
                    kept: sessions.length,
                    projectFilter: this.projectPathFilter
                }, 'Task #13: filtered history entries by project path');
            }
            // FIX HIGH-30: Log summary if there were parse errors
            if (parseErrors > 0) {
                logger.warn({
                    filePath,
                    parseErrors,
                    totalLines,
                    successRate: ((totalLines - parseErrors) / totalLines * 100).toFixed(1) + '%'
                }, 'HIGH-30: JSON parse errors in history.jsonl');
            }
        }
        catch (error) {
            logger.warn({ error, filePath }, 'failed to parse history.jsonl');
        }
        return sessions;
    }
    /**
     * convertHistoryEntry - converts a history.jsonl entry to ParsedSession
     */
    convertHistoryEntry(entry) {
        if (!entry.display || !entry.display.trim() || !entry.sessionId || !entry.timestamp) {
            return null;
        }
        const hash = generateEntryHash(entry.sessionId, entry.timestamp);
        const content = entry.display.trim();
        const formattedContent = `[USER] ${content}`;
        // Detect context restoration summaries
        const contextRestoration = isContextRestoration(content);
        return {
            id: `${entry.sessionId}-${entry.timestamp}-user`,
            hash,
            content,
            formattedContent,
            role: 'user',
            timestamp: new Date(entry.timestamp),
            project: entry.project || 'unknown',
            sessionId: entry.sessionId,
            pastedContent: entry.pastedContents,
            isContextRestoration: contextRestoration,
        };
    }
    /**
     * parseSessionFile - reads and parses a single session file
     *
     * FIX HIGH-30: Added parse error stats and warning logs instead of silent skip
     * FIX Task #13: Added early project filtering at entry level
     */
    async parseSessionFile(filePath) {
        const sessions = [];
        // FIX HIGH-30: Track parse error stats
        let parseErrors = 0;
        let totalLines = 0;
        let projectFiltered = 0;
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n').filter(line => line.trim());
            totalLines = lines.length;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                try {
                    const entry = JSON.parse(line);
                    // skip file-history-snapshot entries
                    if (entry.type === 'file-history-snapshot')
                        continue;
                    // FIX Task #13: Early project filtering at entry level
                    if (this.projectPathFilter) {
                        const entryProject = entry.cwd || entry.project;
                        if (entryProject && !this.matchesProjectFilter(entryProject)) {
                            projectFiltered++;
                            continue;
                        }
                    }
                    const parsed = this.convertMessageEntry(entry);
                    if (parsed) {
                        sessions.push(parsed);
                    }
                }
                catch (parseError) {
                    // FIX HIGH-30: Log warning instead of silent skip
                    parseErrors++;
                    if (parseErrors <= 3) {
                        // Only log first 3 errors per file to avoid spam
                        logger.debug({
                            filePath,
                            lineNumber: i + 1,
                            error: parseError instanceof Error ? parseError.message : String(parseError),
                            linePreview: line.substring(0, 80) + (line.length > 80 ? '...' : '')
                        }, 'HIGH-30: Failed to parse JSON line in session file');
                    }
                }
            }
            // FIX Task #13: Log if we filtered entries
            if (projectFiltered > 0) {
                logger.debug({
                    filePath: basename(filePath),
                    projectFiltered,
                    kept: sessions.length,
                    projectFilter: this.projectPathFilter
                }, 'Task #13: filtered entries by project path');
            }
            // FIX HIGH-30: Log summary if there were significant parse errors
            if (parseErrors > 0 && parseErrors > totalLines * 0.1) {
                // Only warn if more than 10% of lines failed
                logger.warn({
                    filePath,
                    parseErrors,
                    totalLines,
                    successRate: ((totalLines - parseErrors) / totalLines * 100).toFixed(1) + '%'
                }, 'HIGH-30: Significant JSON parse errors in session file');
            }
        }
        catch (error) {
            logger.warn({ error, filePath }, 'failed to parse session file');
        }
        return sessions;
    }
    /**
     * FIX Task #13: Check if a project path matches the filter
     * Handles exact match, subdirectory match, and parent directory match
     */
    matchesProjectFilter(projectPath) {
        if (!this.projectPathFilter)
            return true;
        // Exact match
        if (projectPath === this.projectPathFilter)
            return true;
        // Session from subdirectory of current project
        if (projectPath.startsWith(this.projectPathFilter + '/'))
            return true;
        // Current project is subdirectory of session's project
        if (this.projectPathFilter.startsWith(projectPath + '/'))
            return true;
        return false;
    }
    /**
     * streamAllSessions - streams all session files with chunked loading and rate limiting
     *
     * Features:
     * - NEWEST FIRST: Files sorted by mtime, entries reversed within each file
     * - Memory-efficient: processes files in chunks
     * - Rate limited: 100MB/s throughput via QOMS
     * - Hash-based deduplication: skips entries with matching session_id + timestamp hash
     * - EARLY EXIT: Stops processing a file after N consecutive duplicates (already indexed)
     * - ACK logging: logs SKIP or INSERT for each entry
     */
    async streamAllSessions(existingHashes, onBatch, batchSize = 100, config = DEFAULT_CHUNKING_CONFIG) {
        // FIX HIGH-30: Added parseErrors to stats tracking
        const stats = { total: 0, processed: 0, skipped: 0, bytesProcessed: 0, earlyExitFiles: 0, parseErrors: 0 };
        const startTime = Date.now();
        // Early exit threshold: if we hit this many consecutive duplicates, stop processing file
        const EARLY_EXIT_THRESHOLD = 50;
        try {
            const allFiles = await this.getAllSessionFiles();
            logger.info({ fileCount: allFiles.length }, 'streaming session files for catch-up (newest first)');
            let batch = [];
            let chunkBytes = 0;
            let lastThrottleTime = Date.now();
            for (const filePath of allFiles) {
                const isHistoryFile = filePath === this.historyPath;
                // Get file size for rate limiting calculations
                let fileSize = 0;
                try {
                    const stat = statSync(filePath);
                    fileSize = stat.size;
                }
                catch {
                    // Skip if can't stat
                    continue;
                }
                // Read entire file and reverse entries (so newest come first)
                // This is more memory-intensive but ensures newest-first processing
                let fileLines;
                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    fileLines = content.split('\n').filter(line => line.trim());
                    // REVERSE: Process newest entries first (last line = newest)
                    fileLines.reverse();
                    stats.bytesProcessed += Buffer.byteLength(content, 'utf-8');
                }
                catch {
                    continue;
                }
                // Track consecutive duplicates for early exit
                let consecutiveDuplicates = 0;
                let earlyExited = false;
                for (const line of fileLines) {
                    if (!line.trim())
                        continue;
                    stats.total++;
                    chunkBytes += Buffer.byteLength(line, 'utf-8');
                    try {
                        let parsed = null;
                        if (isHistoryFile) {
                            // Parse history.jsonl format
                            const entry = JSON.parse(line);
                            parsed = this.convertHistoryEntry(entry);
                        }
                        else {
                            // Parse project session file format
                            const entry = JSON.parse(line);
                            if (entry.type === 'file-history-snapshot')
                                continue;
                            parsed = this.convertMessageEntry(entry);
                        }
                        if (!parsed)
                            continue;
                        // Check if hash already exists (deduplication + ACK verification)
                        if (existingHashes.has(parsed.hash)) {
                            stats.skipped++;
                            consecutiveDuplicates++;
                            logger.debug({ hash: parsed.hash, role: parsed.role, consecutive: consecutiveDuplicates }, 'ACK SKIP: entry already exists');
                            // EARLY EXIT: If we've hit N consecutive duplicates, assume rest of file is indexed
                            if (consecutiveDuplicates >= EARLY_EXIT_THRESHOLD) {
                                logger.info({
                                    filePath: basename(filePath),
                                    consecutiveDuplicates,
                                    remainingLines: fileLines.length - stats.total
                                }, 'EARLY EXIT: file already indexed, skipping rest');
                                stats.earlyExitFiles++;
                                earlyExited = true;
                                break;
                            }
                            continue;
                        }
                        // Reset consecutive counter on new entry
                        consecutiveDuplicates = 0;
                        batch.push(parsed);
                        stats.processed++;
                        // Process batch when full
                        if (batch.length >= batchSize) {
                            await onBatch(batch);
                            batch = [];
                            // Rate limiting: throttle based on bytes processed
                            const elapsed = Date.now() - lastThrottleTime;
                            const targetTime = (chunkBytes / config.targetBytesPerSecond) * 1000;
                            if (elapsed < targetTime) {
                                await new Promise(resolve => setTimeout(resolve, config.chunkDelayMs));
                            }
                            chunkBytes = 0;
                            lastThrottleTime = Date.now();
                            // Log progress every 10 batches
                            if (stats.processed % (batchSize * 10) === 0) {
                                const mbProcessed = (stats.bytesProcessed / 1024 / 1024).toFixed(2);
                                const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
                                logger.info({
                                    processed: stats.processed,
                                    skipped: stats.skipped,
                                    earlyExitFiles: stats.earlyExitFiles,
                                    mbProcessed,
                                    elapsedSec
                                }, 'catch-up progress (newest first)');
                            }
                        }
                    }
                    catch (parseError) {
                        // FIX HIGH-30: Track parse errors instead of silent skip
                        stats.parseErrors++;
                        if (stats.parseErrors <= 10) {
                            // Only log first 10 errors across all files to avoid spam
                            logger.debug({
                                filePath: basename(filePath),
                                error: parseError instanceof Error ? parseError.message : String(parseError),
                                linePreview: line.substring(0, 60) + (line.length > 60 ? '...' : '')
                            }, 'HIGH-30: Failed to parse JSON line during streaming');
                        }
                    }
                }
                // Log if file was fully processed vs early-exited
                if (!earlyExited && fileLines.length > 100) {
                    logger.debug({ filePath: basename(filePath), entriesProcessed: fileLines.length }, 'file fully processed');
                }
            }
            // Process remaining batch
            if (batch.length > 0) {
                await onBatch(batch);
            }
            const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            const mbTotal = (stats.bytesProcessed / 1024 / 1024).toFixed(2);
            logger.info({
                ...stats,
                mbTotal,
                elapsedSec: totalElapsed,
                throughputMBps: (stats.bytesProcessed / 1024 / 1024 / parseFloat(totalElapsed)).toFixed(2)
            }, 'streaming session catch-up complete (newest first with early exit)');
            return stats;
        }
        catch (error) {
            logger.error({ error }, 'streaming catch-up failed');
            throw error;
        }
    }
    /**
     * convertMessageEntry - converts a session entry to ParsedSession
     */
    convertMessageEntry(entry) {
        // must have type and timestamp
        if (!entry.type || !entry.timestamp || !entry.sessionId) {
            return null;
        }
        // CRITICAL: Skip subagent/team member outputs - they pollute the memory database
        // These are internal  Code agent responses, not user conversations
        if (entry.teamMemberId) {
            return null;
        }
        const hash = generateEntryHash(entry.sessionId, entry.timestamp);
        // user messages
        if (entry.type === 'user') {
            // user messages can have content as string OR array
            let content = '';
            const msgContent = entry.message?.content;
            if (typeof msgContent === 'string') {
                content = msgContent;
            }
            else if (Array.isArray(msgContent) && msgContent[0]?.text) {
                content = msgContent[0].text;
            }
            else {
                content = entry.display || '';
            }
            if (!content.trim())
                return null;
            const cleanContent = content.trim();
            const formattedContent = `[USER] ${cleanContent}`;
            // Detect context restoration summaries - these should be tagged differently
            const contextRestoration = isContextRestoration(cleanContent);
            return {
                id: `${entry.sessionId}-${entry.timestamp}-user`,
                hash,
                content: cleanContent,
                formattedContent,
                role: 'user',
                timestamp: new Date(entry.timestamp),
                project: entry.cwd || entry.project || 'unknown',
                sessionId: entry.sessionId,
                messageId: entry.uuid,
                isContextRestoration: contextRestoration,
            };
        }
        // assistant messages
        if (entry.type === 'assistant' && entry.message) {
            const msg = entry.message;
            // extract text content, thinking, and tool calls
            let textContent = '';
            let thinking = '';
            const toolCalls = [];
            if (msg.content && Array.isArray(msg.content)) {
                for (const block of msg.content) {
                    if (block.type === 'text' && block.text) {
                        textContent += block.text + '\n';
                    }
                    else if (block.type === 'thinking' && block.thinking) {
                        thinking = block.thinking;
                    }
                    else if (block.type === 'tool_use' && block.name) {
                        toolCalls.push({ name: block.name, input: block.input });
                    }
                }
            }
            textContent = textContent.trim();
            // skip if no actual content at all
            if (!textContent && toolCalls.length === 0 && !thinking)
                return null;
            // SKIP tool-only responses - they pollute the memory database
            // These are just tool call metadata, not meaningful content to remember
            if (!textContent && toolCalls.length > 0) {
                return null;
            }
            // SKIP thinking-only responses - they pollute the memory database
            // These are internal reasoning, not meaningful content to remember
            if (!textContent && thinking) {
                return null;
            }
            // Final validation - skip if content is still empty or garbage
            if (!textContent || !textContent.trim())
                return null;
            // Skip if content is essentially just "undefined" or similar garbage
            const cleanCheck = textContent.replace(/[\[\]:\s]/g, '');
            if (cleanCheck === 'Tools' || cleanCheck === 'undefined' || cleanCheck.length < 5)
                return null;
            // CRITICAL: Skip Task agent outputs - they pollute the memory database
            // These are subagent responses that shouldn't be stored as memories
            if (textContent.includes('Task tool') ||
                textContent.includes('subagent') ||
                textContent.startsWith('Agent ') ||
                textContent.includes('agent completed') ||
                textContent.includes('agent returned')) {
                return null;
            }
            // Build formatted content with [CLAUDE] prefix and [THINKING] block
            let formattedContent = `[CLAUDE] ${textContent}`;
            if (thinking) {
                formattedContent += ` [THINKING] ${thinking}`;
            }
            return {
                id: `${entry.sessionId}-${entry.timestamp}-assistant`,
                hash,
                content: textContent,
                formattedContent,
                role: 'assistant',
                timestamp: new Date(entry.timestamp),
                project: entry.cwd || 'unknown',
                sessionId: entry.sessionId,
                messageId: entry.uuid || msg.id,
                model: msg.model,
                thinking: thinking || undefined,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined
            };
        }
        return null;
    }
    /**
     * parseHistoryFile - LEGACY: reads history.jsonl for backwards compatibility
     * Now uses convertHistoryEntry for consistent formatting
     */
    async parseHistoryFile() {
        logger.info({ path: this.historyPath }, 'parsing legacy history.jsonl');
        try {
            await fs.access(this.historyPath);
            const content = await fs.readFile(this.historyPath, 'utf-8');
            const lines = content.split('\n').filter(line => line.trim());
            const sessions = [];
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line);
                    const parsed = this.convertHistoryEntry(entry);
                    if (parsed) {
                        sessions.push(parsed);
                    }
                }
                catch {
                    // skip invalid
                }
            }
            return sessions;
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }
    /**
     * parseNewEntries - reads only new entries since a given timestamp
     *
     * FIX MED-47: Optimized to only parse files modified after sinceTimestamp
     * Uses file mtime filtering + streaming with early exit to avoid re-parsing all sessions
     */
    async parseNewEntries(sinceTimestamp) {
        logger.info({ sinceTimestamp: new Date(sinceTimestamp) }, 'parsing new session entries (optimized)');
        const newSessions = [];
        try {
            // FIX MED-47: Get files with modification times, filter to only those modified since sinceTimestamp
            const filesWithMtime = [];
            // Check history.jsonl
            try {
                await fs.access(this.historyPath);
                const stat = statSync(this.historyPath);
                if (stat.mtimeMs > sinceTimestamp) {
                    filesWithMtime.push({ path: this.historyPath, mtime: stat.mtimeMs });
                }
            }
            catch {
                // history.jsonl doesn't exist, skip
            }
            // Check project session files
            const projectDirs = await this.getProjectDirectories();
            for (const dir of projectDirs) {
                try {
                    const dirFiles = await fs.readdir(dir);
                    for (const file of dirFiles) {
                        if (file.endsWith('.jsonl')) {
                            const filePath = join(dir, file);
                            try {
                                const stat = statSync(filePath);
                                // Only include files modified after sinceTimestamp
                                if (stat.mtimeMs > sinceTimestamp) {
                                    filesWithMtime.push({ path: filePath, mtime: stat.mtimeMs });
                                }
                            }
                            catch {
                                // Skip if can't stat
                            }
                        }
                    }
                }
                catch {
                    // Skip inaccessible directories
                }
            }
            // Sort by modification time DESCENDING (newest first) for early exit
            filesWithMtime.sort((a, b) => b.mtime - a.mtime);
            logger.debug({
                totalFiles: filesWithMtime.length,
                sinceTimestamp: new Date(sinceTimestamp).toISOString()
            }, 'MED-47: only parsing files modified since timestamp');
            // Parse only the modified files
            for (const { path: filePath } of filesWithMtime) {
                const isHistoryFile = filePath === this.historyPath;
                const sessions = isHistoryFile
                    ? await this.parseHistoryJsonl(filePath)
                    : await this.parseSessionFile(filePath);
                // Filter to entries after sinceTimestamp (file mtime is not exact, entries could be older)
                for (const session of sessions) {
                    if (session.timestamp.getTime() > sinceTimestamp) {
                        newSessions.push(session);
                    }
                }
            }
            logger.info({ newCount: newSessions.length, filesChecked: filesWithMtime.length }, 'found new session entries (optimized)');
            return newSessions;
        }
        catch (error) {
            logger.warn({ error }, 'MED-47: optimized parseNewEntries failed, falling back to full scan');
            // Fallback to full scan on error
            const allSessions = await this.parseAllSessions();
            return allSessions.filter(session => session.timestamp.getTime() > sinceTimestamp);
        }
    }
    /**
     * getSessionStats - analyzes session files and returns stats
     */
    async getSessionStats() {
        const sessions = await this.parseAllSessions();
        const stats = {
            totalEntries: sessions.length,
            validEntries: sessions.length,
            invalidEntries: 0,
            uniqueSessions: new Set(sessions.map(s => s.sessionId)).size,
            userMessages: sessions.filter(s => s.role === 'user').length,
            assistantMessages: sessions.filter(s => s.role === 'assistant').length,
            oldestEntry: null,
            newestEntry: null,
            projectsFound: new Set(sessions.map(s => s.project))
        };
        if (sessions.length > 0) {
            const sorted = [...sessions].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
            stats.oldestEntry = sorted[0].timestamp;
            stats.newestEntry = sorted[sorted.length - 1].timestamp;
        }
        return stats;
    }
    /**
     * convertToMemoryParams - converts parsed sessions to memory storage params
     *
     * Uses formattedContent which includes:
     * - [USER] prefix for user messages
     * - [CLAUDE] prefix for assistant messages with [THINKING] blocks
     *
     * Tags include:
     * - role:user or role:assistant
     * - has-thinking for messages with thinking blocks
     */
    convertToMemoryParams(sessions, options = {}) {
        const { importance = 'medium', memoryType = 'episodic', additionalTags = [] } = options;
        // Filter out sessions with tool/thinking content BEFORE conversion
        const filteredSessions = sessions.filter(session => {
            // Check both content and formattedContent for tool/thinking patterns
            if (isToolOrThinkingContent(session.content))
                return false;
            if (isToolOrThinkingContent(session.formattedContent))
                return false;
            return true;
        });
        return filteredSessions.map(session => {
            // create tags from metadata - includes role!
            const tags = [
                'claude-session',
                'conversation',
                `role:${session.role}`,
                `session:${session.sessionId.slice(0, 8)}`,
                ...additionalTags
            ];
            // add specific tags based on role
            if (session.role === 'user') {
                if (session.isContextRestoration) {
                    // Context restorations are system-generated summaries, NOT real user prompts
                    // Tag them separately so find_memory can exclude them from "what did the user say" searches
                    tags.push('context-restoration');
                }
                else {
                    tags.push('user-prompt');
                }
            }
            else {
                tags.push('claude-response');
                if (session.model) {
                    tags.push(`model:${session.model.split('-').slice(0, 2).join('-')}`);
                }
                if (session.thinking) {
                    tags.push('has-thinking');
                }
                if (session.toolCalls && session.toolCalls.length > 0) {
                    tags.push('has-tool-calls');
                    // add tool-specific tags
                    for (const tc of session.toolCalls.slice(0, 3)) { // limit to 3
                        tags.push(`tool:${tc.name}`);
                    }
                }
            }
            // add project tag
            if (session.project && session.project !== 'unknown') {
                const projectName = session.project.split('/').pop() || 'unknown';
                tags.push(`project:${projectName}`);
            }
            // build metadata - include hash for deduplication verification
            // project_path is used for namespacing/filtering, project is the original project identifier
            //
            // PAIRING FIELDS (for find_memory user/claude pairing):
            // - sessionId: same for all messages in a session, used to group related messages
            // - timestamp: ISO string of when the message was sent (from JSONL entry)
            // - timestampMs: numeric milliseconds since epoch (for efficient comparison/ordering)
            // - role: 'user' or 'assistant' - determines message direction
            // - messageId: unique ID for this specific message in the session
            //
            // Pairing works by: same sessionId + close timestamps + opposite roles
            const metadata = {
                sessionId: session.sessionId,
                hash: session.hash, // Hash for deduplication
                project: session.project,
                project_path: session.project, // For project namespacing filtering
                timestamp: session.timestamp.toISOString(),
                timestampMs: session.timestamp.getTime(), // Numeric timestamp for efficient pairing queries
                source: 'claude-code',
                entryId: session.id,
                role: session.role,
                messageId: session.messageId
            };
            // include additional data for assistant messages
            if (session.role === 'assistant') {
                if (session.model)
                    metadata.model = session.model;
                if (session.thinking)
                    metadata.hasThinking = true;
                if (session.toolCalls)
                    metadata.toolCalls = session.toolCalls.map(t => t.name);
            }
            // Mark context restorations in metadata for easy filtering
            if (session.isContextRestoration) {
                metadata.isContextRestoration = true;
            }
            // include pasted content if present
            if (session.pastedContent && Object.keys(session.pastedContent).length > 0) {
                metadata.pastedContent = session.pastedContent;
                tags.push('has-pasted-content');
            }
            return {
                // Use formattedContent with [USER] or [CLAUDE][THINKING] prefixes
                content: session.formattedContent,
                memoryType,
                importance,
                tags,
                metadata
            };
        });
    }
    /**
     * getLastProcessedTimestamp - helper to get the last processed timestamp from DB
     */
    async getLastProcessedTimestamp(db) {
        try {
            const result = await db.query(`
        SELECT metadata->>'timestamp' as last_timestamp
        FROM memories
        WHERE tags @> ARRAY['claude-session']
        ORDER BY (metadata->>'timestamp')::timestamp DESC
        LIMIT 1
      `);
            if (result.rows.length > 0 && result.rows[0].last_timestamp) {
                return new Date(result.rows[0].last_timestamp).getTime();
            }
            return 0;
        }
        catch (error) {
            logger.warn({ error }, 'failed to get last processed timestamp');
            return 0;
        }
    }
    isValidLegacyEntry(entry) {
        if (!entry.display || typeof entry.display !== 'string' || !entry.display.trim()) {
            return false;
        }
        if (!entry.timestamp || typeof entry.timestamp !== 'number') {
            return false;
        }
        if (!entry.sessionId || typeof entry.sessionId !== 'string') {
            return false;
        }
        return true;
    }
}
/**
 * Helper function to create parser with default config
 *
 * FIX Task #13: Now accepts optional projectPathFilter for early filtering.
 * When provided, the parser will only process session files from directories
 * that could match the specified project path, avoiding wasteful parsing.
 */
export function createSessionParser(claudeDir, projectPathFilter) {
    return new SessionParser(claudeDir, projectPathFilter ?? null);
}
/**
 * isToolOrThinkingContent - checks if content is a tool call
 * These should be SKIPPED from memory storage as they pollute the database
 *
 * Patterns to skip:
 * - [Tools: ...] - tool call descriptions
 * - [Tool: ...] - individual tool patterns
 *
 * NOTE: We KEEP thinking blocks - they contain valuable reasoning!
 */
export function isToolOrThinkingContent(content) {
    if (!content || typeof content !== 'string')
        return false;
    const trimmed = content.trim();
    // Check for tool call patterns ONLY
    if (trimmed.startsWith('[Tools:'))
        return true;
    if (trimmed.startsWith('[Tool:'))
        return true;
    // Check for [CLAUDE] prefixed tool versions
    if (trimmed.startsWith('[CLAUDE] [Tools:'))
        return true;
    if (trimmed.startsWith('[CLAUDE] [Tool:'))
        return true;
    return false;
}
/**
 * isContextRestoration - detects context restoration summaries
 *
 * Context restorations are injected when 's context window overflows.
 * They look like user messages but are actually system-generated summaries.
 *
 * These should be tagged differently so they don't pollute find_memory results
 * for actual user prompts.
 */
export function isContextRestoration(content) {
    if (!content || typeof content !== 'string')
        return false;
    // These are the key markers  Code uses for context restorations
    const markers = [
        'This session is being continued from a previous conversation',
        'conversation is summarized below',
        'previous conversation that ran out of context',
        'Context Restore',
        'session continued from',
    ];
    return markers.some(marker => content.includes(marker));
}
//# sourceMappingURL=sessionParser.js.map