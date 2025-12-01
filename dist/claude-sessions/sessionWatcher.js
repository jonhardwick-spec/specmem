/**
 * sessionWatcher.ts - Watches Claude Code session files for new entries
 *
 * Features:
 * - Watches ~/.claude/history.jsonl and project session files
 * - On init: Chunked DB loading with ACK verification
 * - Rate limited at 100MB/s via QOMS
 * - Hash-based deduplication (session_id + timestamp)
 * - Extracts USER messages, CLAUDE responses, and THINKING blocks
 * - Tags: role:user, role:assistant, has-thinking
 * - Content format: [USER] or [CLAUDE][THINKING] prefixes
 *
 * USER/CLAUDE PAIRING SUPPORT:
 * Each saved memory includes metadata fields for pairing:
 * - metadata.sessionId: Same for all messages in a session
 * - metadata.timestamp: ISO string from JSONL entry
 * - metadata.timestampMs: Numeric ms since epoch for efficient ordering
 * - metadata.role: 'user' or 'assistant'
 *
 * find_memory uses these to pair user prompts with claude responses by:
 * 1. Matching sessionId (same conversation)
 * 2. Finding closest opposite-role message by timestamp
 */
import chokidar from 'chokidar';
import { join } from 'path';
import * as os from 'os';
import { logger, serializeError } from '../utils/logger.js';
import debounce from 'debounce';
import { ClaudeSessionParser } from './sessionParser.js';
import { qoms } from '../utils/qoms.js';
import { runStartupExtraction as extractContextRestorations } from './contextRestorationParser.js';
import { getProjectPathForInsert, getCurrentProjectPath } from '../services/ProjectContext.js';
/**
 * isSessionFromCurrentProject - checks if a session belongs to the current project
 *
 * yooo fr fr this is the KEY filter for project-scoped session watching
 * prevents one SpecMem instance from ingesting another project's sessions
 *
 * @param session - ParsedSession with project field (cwd from session file)
 * @returns true if session belongs to current project, false otherwise
 */
function isSessionFromCurrentProject(session) {
    const currentProject = getCurrentProjectPath();
    // session.project comes from cwd/project field in the session file
    // it's the directory where Claude Code was running when the session was created
    const sessionProject = session.project;
    // Skip sessions without project info (shouldn't happen but be safe)
    if (!sessionProject || sessionProject === 'unknown') {
        logger.debug({ sessionProject, currentProject }, 'session has no project info, skipping');
        return false;
    }
    // Exact match is the most common case
    if (sessionProject === currentProject) {
        return true;
    }
    // Also accept sessions from subdirectories of current project
    // (e.g., if cwd was /specmem/src but project is /specmem)
    if (sessionProject.startsWith(currentProject + '/')) {
        return true;
    }
    // Also accept if current project is a subdirectory of session's project
    // (rare, but handles cases where session was in parent directory)
    if (currentProject.startsWith(sessionProject + '/')) {
        return true;
    }
    logger.debug({
        sessionProject,
        currentProject,
        reason: 'project mismatch'
    }, 'filtering out session from different project');
    return false;
}
/**
 * ClaudeSessionWatcher - watches and auto-extracts Claude sessions
 *
 * nah bruh this is THE watcher for Claude sessions
 * auto-updates specmem whenever you chat with Claude
 *
 * PROJECT-SCOPED: Only processes sessions belonging to the current project!
 * Sessions from other projects are filtered out to prevent cross-project pollution.
 */
export class ClaudeSessionWatcher {
    config;
    watcher = null;
    parser;
    isWatching = false;
    embeddingProvider;
    db;
    // stats tracking
    stats = {
        totalProcessed: 0,
        errors: 0,
        lastProcessedTime: null,
        lastCheckTimestamp: 0
    };
    // debounced extraction handler
    debouncedExtract = null;
    // Heartbeat interval for periodic extraction (safety net when file events are missed)
    heartbeatInterval = null;
    // Track last file event time for health monitoring
    lastFileEventTime = Date.now();
    // FIX MED-46: Track file modification times to avoid redundant heartbeat extraction
    lastFileModTimes = new Map();
    lastHeartbeatCheck = 0;
    // FIX MED-45: Track signal handlers for cleanup on process termination
    signalHandlersBound = false;
    boundSignalHandler = null;
    // FIX TRIPLE-EXTRACTION: Track if initial catch-up has completed
    // Prevents duplicate extraction from chokidar 'add' events and early heartbeats
    initialCatchUpDone = false;
    initialCatchUpTimestamp = 0;
    constructor(embeddingProvider, db, config = {}) {
        this.embeddingProvider = embeddingProvider;
        this.db = db;
        // setup config with defaults
        const claudeDir = config.claudeDir ?? join(os.homedir(), '.claude');
        this.config = {
            claudeDir,
            debounceMs: config.debounceMs ?? 2000,
            autoStart: config.autoStart ?? false,
            verbose: config.verbose ?? false,
            importance: config.importance ?? 'medium',
            additionalTags: config.additionalTags ?? []
        };
        // FIX Task #13: Initialize parser with project filter for early filtering
        // This prevents wasteful parsing of sessions from other projects
        const currentProject = getCurrentProjectPath();
        this.parser = new ClaudeSessionParser(claudeDir, currentProject);
        logger.debug({ projectFilter: currentProject }, 'Task #13: session parser initialized with project filter');
        if (this.config.autoStart) {
            this.startWatching().catch(error => {
                logger.error({ error }, 'failed to auto-start session watcher');
            });
        }
    }
    /**
     * startWatching - starts watching Claude history and project session files
     *
     * Watches:
     * - ~/.claude/history.jsonl (user prompts)
     * - ~/.claude/projects/ directories (full conversations)
     */
    async startWatching() {
        if (this.isWatching) {
            logger.warn('session watcher already running');
            return;
        }
        const historyPath = join(this.config.claudeDir, 'history.jsonl');
        const projectsPath = join(this.config.claudeDir, 'projects');
        logger.info({ historyPath, projectsPath }, 'starting Claude session watcher');
        try {
            // get last processed timestamp from database
            this.stats.lastCheckTimestamp = await this.parser.getLastProcessedTimestamp(this.db);
            logger.info({
                lastCheck: new Date(this.stats.lastCheckTimestamp)
            }, 'loaded last processed timestamp');
            // Run catch-up for any missing sessions (chunked with ACK verification)
            // FIX TRIPLE-EXTRACTION: Mark when catch-up completes to prevent duplicate extraction
            await this.catchUpMissingSessions();
            this.initialCatchUpDone = true;
            this.initialCatchUpTimestamp = Date.now();
            logger.debug('TRIPLE-FIX: Initial catch-up complete, marking done to prevent duplicate extraction');
            // Extract individual interactions from context restorations
            // (chunked with QOMS, ACK verification, hash-based deduplication)
            // IMPORTANT: Pass embeddingProvider so extracted memories have embeddings for semantic search!
            await extractContextRestorations(this.db, this.embeddingProvider);
            // create debounced extraction handler
            this.debouncedExtract = debounce(async () => {
                await this.extractNewSessions();
            }, this.config.debounceMs);
            // Watch patterns: history.jsonl and all project session files
            const watchPatterns = [
                historyPath,
                join(projectsPath, '**', '*.jsonl')
            ];
            // setup file watcher for both history and project files
            // FIX: Enable polling mode for reliable file change detection
            // inotify can miss events on some Linux systems (NFS, containers, high activity)
            // FIX TRIPLE-EXTRACTION: Set ignoreInitial: true because catchUpMissingSessions already
            // handled all existing files. Without this, chokidar fires 'add' events for every
            // existing file, triggering extractNewSessions() redundantly.
            this.watcher = chokidar.watch(watchPatterns, {
                persistent: true,
                ignoreInitial: true, // FIX TRIPLE-EXTRACTION: catch-up already handled existing files
                usePolling: true, // FIX: Enable polling for reliable detection
                interval: 1000, // Poll every 1 second
                binaryInterval: 1000, // Same for binary files
                awaitWriteFinish: {
                    stabilityThreshold: 500,
                    pollInterval: 100
                },
                ignored: /(^|[\/\\])\../ // ignore hidden files
            });
            // setup event handlers
            this.watcher.on('add', (path) => {
                this.lastFileEventTime = Date.now();
                if (this.config.verbose) {
                    logger.debug({ path }, 'session file detected');
                }
                if (this.debouncedExtract) {
                    this.debouncedExtract();
                }
            });
            this.watcher.on('change', (path) => {
                this.lastFileEventTime = Date.now();
                if (this.config.verbose) {
                    logger.debug({ path }, 'session file changed');
                }
                if (this.debouncedExtract) {
                    this.debouncedExtract();
                }
            });
            this.watcher.on('error', (error) => {
                this.stats.errors++;
                logger.error({ error }, 'session watcher error');
            });
            this.isWatching = true;
            // FIX: Add heartbeat interval for periodic extraction (safety net)
            // Ensures sessions are captured even if file events are missed
            const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds
            const STALE_THRESHOLD_MS = 300000; // 5 minutes without events = stale warning
            this.heartbeatInterval = setInterval(async () => {
                try {
                    // FIX TRIPLE-EXTRACTION: Skip heartbeat extraction if catch-up completed recently
                    // This prevents the heartbeat from triggering redundant extraction right after startup
                    const timeSinceCatchUp = Date.now() - this.initialCatchUpTimestamp;
                    const CATCHUP_GRACE_PERIOD_MS = 60000; // 60 seconds grace period after catch-up
                    if (this.initialCatchUpDone && timeSinceCatchUp < CATCHUP_GRACE_PERIOD_MS) {
                        if (this.config.verbose) {
                            logger.debug({
                                timeSinceCatchUp,
                                gracePeriod: CATCHUP_GRACE_PERIOD_MS
                            }, 'TRIPLE-FIX: Skipping heartbeat extraction - catch-up completed recently');
                        }
                        return;
                    }
                    // Health check: warn if no events received in a while
                    const timeSinceLastEvent = Date.now() - this.lastFileEventTime;
                    if (timeSinceLastEvent > STALE_THRESHOLD_MS) {
                        logger.warn({
                            timeSinceLastEvent,
                            lastEventTime: new Date(this.lastFileEventTime).toISOString()
                        }, 'session watcher heartbeat: no file events received in 5 minutes - checking for new sessions anyway');
                    }
                    // FIX MED-46: Check file modification times BEFORE extraction to avoid N queries for N sessions
                    // Only run extraction if files have actually changed since last heartbeat
                    const filesChanged = await this.checkFilesModified();
                    if (!filesChanged) {
                        if (this.config.verbose) {
                            logger.debug({
                                totalProcessed: this.stats.totalProcessed,
                                lastHeartbeatCheck: this.lastHeartbeatCheck
                            }, 'session watcher heartbeat: no file changes, skipping extraction');
                        }
                        return;
                    }
                    // Run extraction only when files have changed
                    await this.extractNewSessions();
                    this.lastHeartbeatCheck = Date.now();
                    if (this.config.verbose) {
                        logger.debug({
                            totalProcessed: this.stats.totalProcessed,
                            lastCheckTimestamp: this.stats.lastCheckTimestamp
                        }, 'session watcher heartbeat extraction complete');
                    }
                }
                catch (error) {
                    logger.warn({ error: serializeError(error) }, 'session watcher heartbeat extraction failed');
                }
            }, HEARTBEAT_INTERVAL_MS);
            // FIX MED-45: Register signal handlers to clean up heartbeat on process termination
            // This prevents memory leaks when the process is killed
            if (!this.signalHandlersBound) {
                this.boundSignalHandler = () => {
                    logger.info('[MED-45] Received termination signal, cleaning up session watcher...');
                    this.stopWatching().catch(err => {
                        logger.warn({ error: err }, '[MED-45] Error during signal cleanup');
                    });
                };
                process.on('SIGTERM', this.boundSignalHandler);
                process.on('SIGINT', this.boundSignalHandler);
                this.signalHandlersBound = true;
                logger.debug('[MED-45] Signal handlers registered for session watcher cleanup');
            }
            logger.info({ watchPatterns, heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS }, 'Claude session watcher started successfully with heartbeat');
        }
        catch (error) {
            logger.error({ error }, 'failed to start session watcher');
            throw error;
        }
    }
    /**
     * stopWatching - stops watching the history file
     */
    async stopWatching() {
        if (!this.isWatching) {
            logger.warn('session watcher not running');
            return;
        }
        logger.info('stopping Claude session watcher');
        // Clear heartbeat interval
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        // FIX MED-45: Remove signal handlers to prevent memory leaks and duplicate handlers
        if (this.signalHandlersBound && this.boundSignalHandler) {
            process.removeListener('SIGTERM', this.boundSignalHandler);
            process.removeListener('SIGINT', this.boundSignalHandler);
            this.signalHandlersBound = false;
            this.boundSignalHandler = null;
            logger.debug('[MED-45] Signal handlers removed during cleanup');
        }
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
        }
        this.debouncedExtract = null;
        this.isWatching = false;
        logger.info({ stats: this.stats }, 'session watcher stopped');
    }
    /**
     * catchUpMissingSessions - streams and imports any missing sessions on init
     *
     * Features:
     * - Chunked loading with 100MB/s rate limiting via QOMS
     * - Hash-based deduplication (session_id + timestamp)
     * - ACK verification for each batch insert
     * - Logs SKIP for existing entries, INSERT with ACK for new entries
     *
     * PAIRING SUPPORT (for find_memory user/claude pairs):
     * Batch inserts preserve metadata with sessionId, timestamp, timestampMs, role
     * which enables find_memory to pair user prompts with claude responses later
     */
    async catchUpMissingSessions() {
        logger.info('starting session catch-up (chunked mode with ACK verification)');
        try {
            // Get all existing hashes in ONE query for deduplication
            const existingResult = await this.db.query(`
        SELECT metadata->>'hash' as hash
        FROM memories
        WHERE 'claude-session' = ANY(tags)
        AND metadata->>'hash' IS NOT NULL
      `);
            const existingHashes = new Set(existingResult.rows.map((r) => r.hash).filter((h) => Boolean(h)));
            logger.info({ existingCount: existingHashes.size }, 'loaded existing session hashes for deduplication');
            // Track stats with ACK counts
            let totalStored = 0;
            let totalFailed = 0;
            let totalAckSuccess = 0;
            let totalAckFailed = 0;
            // Stream process sessions with batch callback using QOMS for rate limiting
            // PROJECT ISOLATION: Filter callback only processes sessions from current project!
            const stats = await this.parser.streamAllSessions(existingHashes, async (batch) => {
                // CRITICAL: Filter batch to only include sessions from current project
                // This prevents cross-project pollution in multi-instance setups
                const filteredBatch = batch.filter(isSessionFromCurrentProject);
                if (filteredBatch.length === 0) {
                    logger.debug({ originalSize: batch.length }, 'batch filtered to 0 sessions (all from other projects)');
                    return;
                }
                if (filteredBatch.length < batch.length) {
                    logger.debug({
                        original: batch.length,
                        filtered: filteredBatch.length,
                        dropped: batch.length - filteredBatch.length
                    }, 'filtered out sessions from other projects');
                }
                // Replace batch with filtered version for processing
                batch = filteredBatch;
                // Use QOMS to manage resource usage during batch processing
                await qoms.medium(async () => {
                    try {
                        // Convert batch to memory params (uses formattedContent with prefixes)
                        const memoryParams = this.parser.convertToMemoryParams(batch, {
                            importance: this.config.importance,
                            additionalTags: this.config.additionalTags
                        });
                        // FIX MED-29: Use Promise.allSettled instead of Promise.all
                        // This prevents a single embedding failure from failing the entire batch
                        const embeddingResults = await Promise.allSettled(memoryParams.map(p => qoms.medium(() => this.embeddingProvider.generateEmbedding(p.content))));
                        // Filter out failed embeddings and their corresponding params
                        const successfulEmbeddings = [];
                        for (let idx = 0; idx < embeddingResults.length; idx++) {
                            const result = embeddingResults[idx];
                            if (result.status === 'fulfilled') {
                                successfulEmbeddings.push({ idx, embedding: result.value });
                            }
                            else {
                                logger.warn({
                                    error: result.reason instanceof Error ? result.reason.message : String(result.reason),
                                    contentLength: memoryParams[idx]?.content.length
                                }, 'MED-29: embedding generation failed for single item, continuing with others');
                            }
                        }
                        // Use only successful embeddings
                        const embeddings = successfulEmbeddings.map(s => s.embedding);
                        const filteredParams = successfulEmbeddings.map(s => memoryParams[s.idx]);
                        // Build multi-row INSERT with RETURNING for ACK verification
                        // PROJECT ISOLATION: Get fresh project path at call time
                        const projectPath = getProjectPathForInsert();
                        const values = [];
                        const placeholders = [];
                        let paramIdx = 1;
                        // FIX MED-29: Use filteredParams (only those with successful embeddings)
                        for (let j = 0; j < filteredParams.length; j++) {
                            const params = filteredParams[j];
                            const embedding = embeddings[j];
                            placeholders.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6})`);
                            values.push(params.content, params.memoryType, params.importance, params.tags, params.metadata, `[${embedding.join(',')}]`, projectPath);
                            paramIdx += 7;
                        }
                        if (placeholders.length > 0) {
                            // Task #38 FIX: Wrap batch insert in transaction for atomicity
                            // Either all memories in batch are stored or none (prevents partial failures)
                            const insertResult = await this.db.transaction(async (client) => {
                                const result = await client.query('INSERT INTO memories (content, memory_type, importance, tags, metadata, embedding, project_path) VALUES ' + placeholders.join(', ') + ' RETURNING id, metadata->>\'hash\' as hash', values);
                                return result;
                            });
                            // ACK verification: check each row was inserted
                            for (const row of insertResult.rows) {
                                if (row.id) {
                                    totalAckSuccess++;
                                    logger.debug({ id: row.id, hash: row.hash }, 'ACK INSERT: write verified');
                                }
                                else {
                                    totalAckFailed++;
                                    logger.warn({ hash: row.hash }, 'ACK FAILED: insert returned no id');
                                }
                            }
                            totalStored += insertResult.rows.length;
                        }
                    }
                    catch (error) {
                        totalFailed += batch.length;
                        totalAckFailed += batch.length;
                        logger.warn({
                            error: error.message,
                            batchSize: batch.length
                        }, 'ACK FAILED: batch insert error - transaction rolled back');
                    }
                });
            }, 100 // batch size for chunked loading
            );
            logger.info({
                total: stats.total,
                processed: stats.processed,
                skipped: stats.skipped,
                stored: totalStored,
                failed: totalFailed,
                ackSuccess: totalAckSuccess,
                ackFailed: totalAckFailed,
                bytesProcessed: stats.bytesProcessed,
                earlyExitFiles: stats.earlyExitFiles
            }, 'session catch-up complete with ACK verification (newest first)');
            this.stats.totalProcessed += totalStored;
        }
        catch (error) {
            logger.error({ error }, 'session catch-up failed');
            // Don't throw - let watcher continue even if catch-up fails
        }
    }
    /**
     * extractNewSessions - extracts and stores new sessions
     *
     * Features:
     * - Hash-based deduplication (session_id + timestamp)
     * - ACK verification for each insert
     * - Stores with [USER] or [CLAUDE][THINKING] formatted content
     *
     * PAIRING SUPPORT (for find_memory user/claude pairs):
     * Each saved memory includes metadata with:
     * - sessionId: groups all messages in a conversation
     * - timestamp/timestampMs: when the message was sent (from JSONL entry)
     * - role: 'user' or 'assistant'
     *
     * find_memory uses these to pair user prompts with claude responses
     * by matching sessionId + finding closest opposite-role message by timestamp
     */
    async extractNewSessions() {
        // FIX TRIPLE-EXTRACTION: Skip if called during the startup grace period
        // This catches any edge cases where extraction is triggered before catch-up marks complete
        const timeSinceCatchUp = Date.now() - this.initialCatchUpTimestamp;
        const STARTUP_GRACE_PERIOD_MS = 5000; // 5 second grace period
        if (this.initialCatchUpDone && timeSinceCatchUp < STARTUP_GRACE_PERIOD_MS) {
            logger.debug({
                timeSinceCatchUp,
                gracePeriod: STARTUP_GRACE_PERIOD_MS
            }, 'TRIPLE-FIX: Skipping extractNewSessions - within startup grace period');
            return;
        }
        logger.info('extracting new Claude sessions');
        try {
            // parse new entries since last check
            const allNewSessions = await this.parser.parseNewEntries(this.stats.lastCheckTimestamp);
            if (allNewSessions.length === 0) {
                logger.debug('no new sessions found');
                return;
            }
            // PROJECT ISOLATION: Filter to only sessions from current project!
            // This is critical to prevent cross-project pollution
            const newSessions = allNewSessions.filter(isSessionFromCurrentProject);
            if (newSessions.length === 0) {
                logger.debug({
                    total: allNewSessions.length,
                    filtered: 0,
                    currentProject: getCurrentProjectPath()
                }, 'no new sessions from current project');
                return;
            }
            if (newSessions.length < allNewSessions.length) {
                logger.info({
                    total: allNewSessions.length,
                    fromCurrentProject: newSessions.length,
                    dropped: allNewSessions.length - newSessions.length,
                    currentProject: getCurrentProjectPath()
                }, 'filtered out sessions from other projects');
            }
            logger.info({ count: newSessions.length }, 'found new sessions to process from current project');
            // FIX N+1: Load ALL existing hashes in ONE query for O(1) deduplication
            // Same pattern as catchUpMissingSessions() - batch query instead of per-session lookup
            const existingResult = await this.db.query(`
        SELECT metadata->>'hash' as hash
        FROM memories
        WHERE 'claude-session' = ANY(tags)
        AND metadata->>'hash' IS NOT NULL
      `);
            const existingHashes = new Set(existingResult.rows.map((r) => r.hash).filter((h) => Boolean(h)));
            logger.debug({ existingCount: existingHashes.size }, 'loaded existing hashes for deduplication (batch query)');
            // Filter out sessions that already exist BEFORE processing
            const sessionsToProcess = newSessions.filter(s => !existingHashes.has(s.hash));
            const skipped = newSessions.length - sessionsToProcess.length;
            if (skipped > 0) {
                logger.debug({ skipped }, 'skipped sessions that already exist (batch check)');
            }
            if (sessionsToProcess.length === 0) {
                logger.debug('all sessions already exist, nothing to insert');
                return;
            }
            // convert to memory params (uses formattedContent with prefixes)
            const memoryParams = this.parser.convertToMemoryParams(sessionsToProcess, {
                importance: this.config.importance,
                additionalTags: this.config.additionalTags
            });
            // store each session as a memory with ACK verification
            let stored = 0;
            let failed = 0;
            for (let i = 0; i < memoryParams.length; i++) {
                const params = memoryParams[i];
                const session = sessionsToProcess[i];
                try {
                    // generate embedding using QOMS for resource management
                    const embedding = await qoms.medium(() => this.embeddingProvider.generateEmbedding(params.content));
                    // PROJECT ISOLATION: Get fresh project path at call time
                    const projectPath = getProjectPathForInsert();
                    // store in database with ACK verification (RETURNING id confirms write)
                    const result = await this.db.query(`
            INSERT INTO memories (
              content, memory_type, importance, tags, metadata, embedding, project_path
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, metadata->>'hash' as hash
          `, [
                        params.content,
                        params.memoryType,
                        params.importance,
                        params.tags,
                        params.metadata,
                        `[${embedding.join(',')}]`,
                        projectPath
                    ]);
                    // ACK verification
                    if (result.rows.length > 0 && result.rows[0].id) {
                        stored++;
                        logger.debug({
                            id: result.rows[0].id,
                            hash: result.rows[0].hash,
                            role: session.role
                        }, 'ACK INSERT: write verified');
                    }
                    else {
                        failed++;
                        logger.warn({ hash: session.hash }, 'ACK FAILED: insert returned no id');
                    }
                }
                catch (error) {
                    failed++;
                    logger.warn({
                        error: serializeError(error),
                        hash: session.hash,
                        role: session.role,
                        contentLength: params.content.length
                    }, 'ACK FAILED: insert error');
                }
            }
            // update stats
            this.stats.totalProcessed += stored;
            this.stats.lastProcessedTime = new Date();
            // update last check timestamp to newest session
            if (newSessions.length > 0) {
                const newest = Math.max(...newSessions.map(s => s.timestamp.getTime()));
                this.stats.lastCheckTimestamp = newest;
            }
            logger.info({
                stored,
                failed,
                skipped,
                total: this.stats.totalProcessed
            }, 'session extraction complete with ACK verification');
        }
        catch (error) {
            this.stats.errors++;
            logger.error({ error: serializeError(error) }, 'failed to extract sessions');
        }
    }
    /**
     * manualExtract - manually trigger extraction (for testing/debugging)
     *
     * yo fr fr force an extraction right now
     */
    async manualExtract() {
        logger.info('manual session extraction triggered');
        const beforeCount = this.stats.totalProcessed;
        await this.extractNewSessions();
        const extracted = this.stats.totalProcessed - beforeCount;
        logger.info({ extracted }, 'manual extraction complete');
        return extracted;
    }
    /**
     * getStats - returns current watcher statistics
     */
    getStats() {
        return {
            isWatching: this.isWatching,
            totalProcessed: this.stats.totalProcessed,
            lastProcessedTime: this.stats.lastProcessedTime,
            errors: this.stats.errors,
            historyPath: join(this.config.claudeDir, 'history.jsonl'),
            lastCheckTimestamp: this.stats.lastCheckTimestamp
        };
    }
    /**
     * isActive - checks if watcher is currently running
     */
    isActive() {
        return this.isWatching;
    }
    /**
     * FIX MED-46: checkFilesModified - checks if session files have changed since last heartbeat
     *
     * Compares file modification times against cached values to avoid redundant extraction.
     * Returns true if any file has been modified or is new since last check.
     */
    async checkFilesModified() {
        const historyPath = join(this.config.claudeDir, 'history.jsonl');
        const projectsPath = join(this.config.claudeDir, 'projects');
        try {
            // Check history.jsonl modification time
            try {
                const { statSync } = await import('fs');
                const stat = statSync(historyPath);
                const lastMtime = this.lastFileModTimes.get(historyPath) || 0;
                if (stat.mtimeMs > lastMtime) {
                    this.lastFileModTimes.set(historyPath, stat.mtimeMs);
                    logger.debug({ historyPath, mtime: stat.mtimeMs }, 'MED-46: history.jsonl modified');
                    return true;
                }
            }
            catch {
                // history.jsonl doesn't exist - that's fine
            }
            // Check project session files
            const { readdirSync } = await import('fs');
            try {
                const projectDirs = readdirSync(projectsPath, { withFileTypes: true })
                    .filter(entry => entry.isDirectory())
                    .map(entry => join(projectsPath, entry.name));
                for (const projectDir of projectDirs) {
                    try {
                        const files = readdirSync(projectDir)
                            .filter(f => f.endsWith('.jsonl'))
                            .map(f => join(projectDir, f));
                        for (const filePath of files) {
                            try {
                                const { statSync } = await import('fs');
                                const stat = statSync(filePath);
                                const lastMtime = this.lastFileModTimes.get(filePath) || 0;
                                if (stat.mtimeMs > lastMtime) {
                                    this.lastFileModTimes.set(filePath, stat.mtimeMs);
                                    logger.debug({ filePath, mtime: stat.mtimeMs }, 'MED-46: session file modified');
                                    return true;
                                }
                            }
                            catch {
                                // Skip unreadable files
                            }
                        }
                    }
                    catch {
                        // Skip inaccessible directories
                    }
                }
            }
            catch {
                // projects directory doesn't exist - that's fine
            }
            // No files modified
            return false;
        }
        catch (error) {
            // On error, be safe and run extraction anyway
            logger.warn({ error }, 'MED-46: error checking file modifications, running extraction anyway');
            return true;
        }
    }
}
/**
 * Helper function to create watcher with default config
 */
export function createSessionWatcher(embeddingProvider, db, config) {
    return new ClaudeSessionWatcher(embeddingProvider, db, config);
}
//# sourceMappingURL=sessionWatcher.js.map