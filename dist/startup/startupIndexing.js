/**
 * startupIndexing.ts - Automatic Indexing on MCP Server Startup
 *
 * FIXES THE PROBLEM: When MCP server starts, it doesn't automatically index
 * the codebase or extract sessions. This module provides:
 *
 * 1. Check if codebase is indexed (or stale)
 * 2. Check if sessions are extracted (or new ones exist)
 * 3. Trigger background indexing/extraction when needed
 * 4. Report progress in server logs
 *
 * Everything is ready when Claude starts, not on-demand!
 */
import { logger } from '../utils/logger.js';
import { getDatabase } from '../database.js';
import { getCodebaseIndexer } from '../codebase/codebaseIndexer.js';
import { createSessionParser } from '../claude-sessions/sessionParser.js';
import { getProjectContext, getProjectPathForInsert } from '../services/ProjectContext.js';
import { loadCodebaseConfig } from '../config.js';
const indexingStateByProject = new Map();
function getIndexingState(projectPath) {
    const key = projectPath || process.env['SPECMEM_PROJECT_PATH'] || '/';
    if (!indexingStateByProject.has(key)) {
        indexingStateByProject.set(key, {
            indexingInProgress: false,
            sessionExtractionInProgress: false,
            lastIndexingCheck: null,
            lastSessionExtractionCheck: null,
            codebaseRetryCount: 0,
            sessionRetryCount: 0
        });
    }
    return indexingStateByProject.get(key);
}
// HIGH-24 FIX: Retry configuration for background indexing
const RETRY_CONFIG = {
    maxRetries: 3,
    initialDelayMs: 1000, // 1 second
    maxDelayMs: 30000, // 30 seconds
    backoffMultiplier: 2
};
/**
 * HIGH-24 FIX: Execute with exponential backoff retry
 * Prevents silent failures and provides proper retry mechanism
 */
async function executeWithRetry(operation, operationName, retryCountRef, maxRetries = RETRY_CONFIG.maxRetries) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            retryCountRef.count = attempt;
            if (attempt > 0) {
                const delay = Math.min(RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt - 1), RETRY_CONFIG.maxDelayMs);
                logger.info({ attempt, delay, operationName }, `Retry attempt ${attempt}/${maxRetries} after ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            const result = await operation();
            if (attempt > 0) {
                logger.info({ attempt, operationName }, `${operationName} succeeded after ${attempt} retries`);
            }
            retryCountRef.count = 0;
            return result;
        }
        catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            logger.warn({ err: lastError, attempt, maxRetries, operationName }, `${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1})`);
        }
    }
    logger.error({ err: lastError, operationName, attempts: maxRetries + 1 }, `${operationName} failed after ${maxRetries + 1} attempts`);
    retryCountRef.count = 0;
    return null;
}
/**
 * Check if codebase has been indexed for this project
 * Returns stats about the current index state
 */
export async function checkCodebaseIndexStatus(db) {
    const projectPath = getProjectContext().getProjectPath();
    try {
        // Count indexed files for this project
        const result = await db.query(`SELECT COUNT(*)::TEXT as count, MAX(last_indexed) as max_indexed
       FROM codebase_files
       WHERE project_path = $1`, [projectPath]);
        const fileCount = parseInt(result.rows[0]?.count || '0', 10);
        const lastIndexed = result.rows[0]?.max_indexed || null;
        // Check if index is stale (older than 24 hours)
        const isStale = lastIndexed
            ? (Date.now() - new Date(lastIndexed).getTime()) > 24 * 60 * 60 * 1000
            : true;
        const isIndexed = fileCount > 0;
        const needsReindex = !isIndexed || isStale;
        logger.info({
            projectPath,
            fileCount,
            lastIndexed: lastIndexed?.toISOString() || 'never',
            isIndexed,
            isStale,
            needsReindex
        }, 'Codebase index status check');
        return { isIndexed, fileCount, lastIndexed, needsReindex };
    }
    catch (error) {
        logger.warn({ error, projectPath }, 'Failed to check codebase index status');
        return { isIndexed: false, fileCount: 0, lastIndexed: null, needsReindex: true };
    }
}
/**
 * Check if Claude sessions have been extracted
 * Returns stats about extracted sessions
 */
export async function checkSessionExtractionStatus(db) {
    const projectPath = getProjectContext().getProjectPath();
    try {
        // Count sessions for this project with claude-session tag
        const result = await db.query(`SELECT COUNT(*)::TEXT as count, MAX(created_at) as max_created
       FROM memories
       WHERE 'claude-session' = ANY(tags)
         AND project_path = $1`, [projectPath]);
        const sessionCount = parseInt(result.rows[0]?.count || '0', 10);
        const lastExtraction = result.rows[0]?.max_created || null;
        // Check if extraction is stale (older than 1 hour) or never done
        const isStale = lastExtraction
            ? (Date.now() - new Date(lastExtraction).getTime()) > 60 * 60 * 1000
            : true;
        const hasExtractedSessions = sessionCount > 0;
        const needsExtraction = !hasExtractedSessions || isStale;
        logger.info({
            projectPath,
            sessionCount,
            lastExtraction: lastExtraction?.toISOString() || 'never',
            hasExtractedSessions,
            isStale,
            needsExtraction
        }, 'Session extraction status check');
        return { hasExtractedSessions, sessionCount, lastExtraction, needsExtraction };
    }
    catch (error) {
        logger.warn({ error, projectPath }, 'Failed to check session extraction status');
        return { hasExtractedSessions: false, sessionCount: 0, lastExtraction: null, needsExtraction: true };
    }
}
/**
 * Trigger background codebase indexing
 * Runs asynchronously and logs progress
 */
export async function triggerBackgroundIndexing(embeddingProvider, options = {}) {
    const state = getIndexingState();
    if (state.indexingInProgress) {
        logger.info('Background indexing already in progress, skipping');
        return;
    }
    const codebaseConfig = loadCodebaseConfig();
    if (!codebaseConfig.enabled) {
        logger.debug('Codebase indexer disabled, skipping background indexing');
        return;
    }
    state.indexingInProgress = true;
    state.lastIndexingCheck = new Date();
    try {
        const db = getDatabase();
        // Check if indexing is needed
        if (!options.force) {
            const status = await checkCodebaseIndexStatus(db);
            if (!status.needsReindex) {
                logger.info({
                    fileCount: status.fileCount,
                    lastIndexed: status.lastIndexed
                }, 'Codebase already indexed and up-to-date, skipping background indexing');
                state.indexingInProgress = false;
                return;
            }
        }
        if (!options.silent) {
            logger.info('Starting background codebase indexing...');
            // Write to stderr for visibility in Claude Code CLI
            process.stderr.write('[SpecMem] Starting background codebase indexing...\n');
        }
        // Import caching provider to wrap embedding provider
        const { CachingEmbeddingProvider } = await import('../mcp/toolRegistry.js');
        const cachingProvider = new CachingEmbeddingProvider(embeddingProvider);
        // Get or create indexer
        const indexer = getCodebaseIndexer({
            codebasePath: codebaseConfig.codebasePath,
            excludePatterns: codebaseConfig.excludePatterns,
            watchForChanges: false, // Don't start watcher during background indexing
            generateEmbeddings: true
        }, cachingProvider, db);
        // Run the parallel scan (optimized for speed)
        const startTime = Date.now();
        const stats = await indexer.initialize();
        const duration = Date.now() - startTime;
        if (!options.silent) {
            const msg = `[SpecMem] Codebase indexed: ${stats.totalFiles} files, ${stats.totalLines} lines in ${Math.round(duration / 1000)}s`;
            logger.info({
                totalFiles: stats.totalFiles,
                totalLines: stats.totalLines,
                durationMs: duration,
                filesWithEmbeddings: stats.filesWithEmbeddings
            }, 'Background codebase indexing complete');
            process.stderr.write(msg + '\n');
        }
    }
    catch (error) {
        logger.error({ error }, 'Background codebase indexing failed');
        if (!options.silent) {
            process.stderr.write(`[SpecMem] Codebase indexing failed: ${error instanceof Error ? error.message : String(error)}\n`);
        }
    }
    finally {
        state.indexingInProgress = false;
    }
}
/**
 * Trigger background session extraction
 * Extracts Claude Code sessions asynchronously
 */
export async function triggerBackgroundSessionExtraction(embeddingProvider, options = {}) {
    const state = getIndexingState();
    if (state.sessionExtractionInProgress) {
        logger.info('Session extraction already in progress, skipping');
        return;
    }
    // Check if session watcher is enabled
    const sessionWatcherEnabled = process.env['SPECMEM_SESSION_WATCHER_ENABLED'] !== 'false' &&
        process.env['SPECMEM_SESSION_WATCHER_ENABLED'] !== '0';
    if (!sessionWatcherEnabled) {
        logger.debug('Session watcher disabled, skipping background extraction');
        return;
    }
    state.sessionExtractionInProgress = true;
    state.lastSessionExtractionCheck = new Date();
    try {
        const db = getDatabase();
        // Check if extraction is needed
        if (!options.force) {
            const status = await checkSessionExtractionStatus(db);
            if (!status.needsExtraction) {
                logger.info({
                    sessionCount: status.sessionCount,
                    lastExtraction: status.lastExtraction
                }, 'Sessions already extracted and recent, skipping background extraction');
                state.sessionExtractionInProgress = false;
                return;
            }
        }
        if (!options.silent) {
            logger.info('Starting background session extraction...');
            process.stderr.write('[SpecMem] Starting background session extraction...\n');
        }
        const startTime = Date.now();
        const mode = options.mode || 'new';
        // Create session parser
        const parser = createSessionParser();
        // Get sessions based on mode
        let sessions;
        if (mode === 'all' || options.force) {
            sessions = await parser.parseAllSessions();
        }
        else {
            const lastTimestamp = await parser.getLastProcessedTimestamp(db);
            sessions = await parser.parseNewEntries(lastTimestamp);
        }
        if (sessions.length === 0) {
            if (!options.silent) {
                logger.info('No new sessions to extract');
                process.stderr.write('[SpecMem] No new sessions to extract\n');
            }
            state.sessionExtractionInProgress = false;
            return;
        }
        // Convert to memory params
        const memoryParams = parser.convertToMemoryParams(sessions, {
            importance: 'medium',
            additionalTags: []
        });
        // Get existing entryIds to avoid duplicates
        const existingResult = await db.query(`SELECT metadata->>'entryId' as entry_id
       FROM memories
       WHERE 'claude-session' = ANY(tags)`);
        const existingIds = new Set(existingResult.rows.map(r => r.entry_id).filter(Boolean));
        // Filter out already-extracted entries
        const newMemories = memoryParams.filter(m => {
            const entryId = m.metadata?.entryId;
            return !entryId || !existingIds.has(entryId);
        });
        if (newMemories.length === 0) {
            if (!options.silent) {
                logger.info('All sessions already extracted');
                process.stderr.write('[SpecMem] All sessions already extracted\n');
            }
            state.sessionExtractionInProgress = false;
            return;
        }
        // Store memories in batches - larger batches with batch embedding API
        // Task #38 FIX: Wrap batch operations in transactions to prevent partial failures
        const BATCH_SIZE = 100;
        let stored = 0;
        let failed = 0;
        for (let i = 0; i < newMemories.length; i += BATCH_SIZE) {
            const batch = newMemories.slice(i, i + BATCH_SIZE);
            const texts = batch.map(m => m.content);
            // Generate embeddings using BATCH API - 5-10x faster!
            // FIX: Add timeout to prevent hanging if embedding server isn't ready
            // FIX: Increased from 30s to 60s to allow time for model loading on first request
            const EMBEDDING_TIMEOUT_MS = 60000; // 60 second timeout per batch
            let embeddings;
            try {
                const embeddingPromise = embeddingProvider.generateEmbeddingsBatch
                    ? embeddingProvider.generateEmbeddingsBatch(texts)
                    : Promise.all(texts.map(t => embeddingProvider.generateEmbedding(t)));
                // Race against timeout
                embeddings = await Promise.race([
                    embeddingPromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Embedding timeout - server may not be ready')), EMBEDDING_TIMEOUT_MS))
                ]);
            }
            catch (batchError) {
                const isTimeout = batchError instanceof Error && batchError.message.includes('timeout');
                if (isTimeout) {
                    // Embedding server not ready - skip this batch but don't fail silently
                    logger.warn({ batchIndex: Math.floor(i / BATCH_SIZE), batchSize: batch.length }, 'Embedding timeout - server not ready, skipping batch. Will retry on next startup.');
                    failed += batch.length;
                    continue; // Skip to next batch instead of blocking forever
                }
                logger.warn({ error: batchError }, 'Batch embedding failed, trying individual with timeout');
                try {
                    // Try individual calls with timeout
                    embeddings = await Promise.race([
                        Promise.all(texts.map(t => embeddingProvider.generateEmbedding(t))),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Individual embedding timeout')), EMBEDDING_TIMEOUT_MS * 2))
                    ]);
                }
                catch (individualError) {
                    logger.warn({ error: individualError }, 'Individual embedding also failed/timed out, skipping batch');
                    failed += batch.length;
                    continue;
                }
            }
            // Task #38 FIX: Insert memories with embeddings inside a transaction
            // This ensures either ALL memories in the batch are stored or NONE (atomic)
            const projectPathForInsert = getProjectPathForInsert();
            try {
                const batchStored = await db.transaction(async (client) => {
                    let batchCount = 0;
                    for (let j = 0; j < batch.length; j++) {
                        const memory = batch[j];
                        const embedding = embeddings[j];
                        await client.query(`INSERT INTO memories (
                id, content, embedding, memory_type, importance, tags, metadata,
                project_path, created_at, updated_at
              ) VALUES (
                gen_random_uuid(), $1, $2, $3, $4, $5, $6,
                $7, NOW(), NOW()
              )`, [
                            memory.content,
                            JSON.stringify(embedding),
                            memory.memoryType || 'episodic',
                            memory.importance || 'medium',
                            memory.tags || [],
                            JSON.stringify(memory.metadata || {}),
                            projectPathForInsert
                        ]);
                        batchCount++;
                    }
                    return batchCount;
                });
                stored += batchStored;
            }
            catch (error) {
                // Entire batch failed - transaction rolled back, DB is consistent
                logger.warn({ error, batchSize: batch.length, batchIndex: Math.floor(i / BATCH_SIZE) }, 'Failed to store session memory batch - transaction rolled back');
                failed += batch.length;
            }
            // Progress update
            const progress = Math.min(i + BATCH_SIZE, newMemories.length);
            if (!options.silent && progress % 100 === 0) {
                process.stderr.write('[SpecMem] Session extraction progress: ' + progress + '/' + newMemories.length + '\n');
            }
        }
        const duration = Date.now() - startTime;
        if (!options.silent) {
            const msg = `[SpecMem] Sessions extracted: ${stored} stored, ${failed} failed in ${Math.round(duration / 1000)}s`;
            logger.info({
                stored,
                failed,
                total: newMemories.length,
                durationMs: duration
            }, 'Background session extraction complete');
            process.stderr.write(msg + '\n');
        }
    }
    catch (error) {
        logger.error({ error }, 'Background session extraction failed');
        if (!options.silent) {
            process.stderr.write(`[SpecMem] Session extraction failed: ${error instanceof Error ? error.message : String(error)}\n`);
        }
    }
    finally {
        state.sessionExtractionInProgress = false;
    }
}
/**
 * Run startup indexing checks and trigger background tasks
 * This is called from main() after MCP connection is established
 */
export async function runStartupIndexing(embeddingProvider, options = {}) {
    logger.info('Running startup indexing checks...');
    process.stderr.write('[SpecMem] Checking if indexing needed...\n');
    const db = getDatabase();
    const result = {
        codebaseStatus: { wasIndexed: false, triggeredIndexing: false },
        sessionStatus: { wasExtracted: false, triggeredExtraction: false }
    };
    // Check and trigger codebase indexing
    if (!options.skipCodebase) {
        const codebaseStatus = await checkCodebaseIndexStatus(db);
        result.codebaseStatus.wasIndexed = codebaseStatus.isIndexed;
        if (codebaseStatus.needsReindex || options.force) {
            result.codebaseStatus.triggeredIndexing = true;
            // HIGH-24 FIX: Run in background with retry mechanism instead of fire-and-forget
            // Use setImmediate to not block the startup flow, but track with retry
            setImmediate(() => {
                const retryRef = { count: 0 };
                executeWithRetry(() => triggerBackgroundIndexing(embeddingProvider, { force: options.force }), 'Background codebase indexing', retryRef).catch(err => {
                    logger.error({ err }, 'Background codebase indexing failed after all retries');
                });
            });
        }
    }
    // Check and trigger session extraction
    if (!options.skipSessions) {
        const sessionStatus = await checkSessionExtractionStatus(db);
        result.sessionStatus.wasExtracted = sessionStatus.hasExtractedSessions;
        if (sessionStatus.needsExtraction || options.force) {
            result.sessionStatus.triggeredExtraction = true;
            // HIGH-24 FIX: Run in background with retry mechanism instead of fire-and-forget
            // Use setImmediate to not block the startup flow, but track with retry
            setImmediate(() => {
                const retryRef = { count: 0 };
                executeWithRetry(() => triggerBackgroundSessionExtraction(embeddingProvider, { force: options.force }), 'Background session extraction', retryRef).catch(err => {
                    logger.error({ err }, 'Background session extraction failed after all retries');
                });
            });
        }
    }
    logger.info({
        codebase: result.codebaseStatus,
        sessions: result.sessionStatus
    }, 'Startup indexing checks complete');
    return result;
}
/**
 * Get current indexing status for dashboard/status queries
 */
export function getIndexingStatus(projectPath) {
    const state = getIndexingState(projectPath);
    return {
        codebaseIndexing: state.indexingInProgress,
        sessionExtraction: state.sessionExtractionInProgress,
        lastCodebaseCheck: state.lastIndexingCheck,
        lastSessionCheck: state.lastSessionExtractionCheck
    };
}
//# sourceMappingURL=startupIndexing.js.map