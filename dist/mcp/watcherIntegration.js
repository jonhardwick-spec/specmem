/**
 * watcherIntegration.ts - Integrates File Watcher with SpecMem Server
 *
 * yooo connecting the file watcher to the MCP server
 * this makes everything auto-update when code changes
 *
 * PROJECT-SCOPED WATCHING: Watches ONLY the current project directory
 * Uses SPECMEM_PROJECT_PATH to determine scope - NO global watching!
 * This prevents RAM bloat from watching all files across all sessions.
 *
 * Dynamic path management:
 * - addWatchPath() - add additional paths within project scope
 * - removeWatchPath() - remove a watched path
 * - getWatchedPaths() - list all currently watched paths
 */
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { WatcherManager } from '../watcher/index.js';
import { getDbContext } from '../db/index.js';
import { getDatabase } from '../database.js';
import { getProjectContext } from '../services/ProjectContext.js';
import * as path from 'path';
/** Map of projectPath -> WatcherState - each project isolated */
const watcherStateByProject = new Map();
/**
 * Initialization lock per project - prevents double watcher initialization (Issue #12).
 * Maps projectPath -> Promise that resolves when initialization completes.
 * If init is already in progress, subsequent calls await the existing promise.
 */
const initializationLockByProject = new Map();
/**
 * getWatcherState - get or create watcher state for a project
 * This is the key to per-project isolation - no more cross-pollution!
 */
function getWatcherState(projectPath) {
    if (!watcherStateByProject.has(projectPath)) {
        watcherStateByProject.set(projectPath, {
            manager: null,
            watchedPaths: new Set()
        });
    }
    return watcherStateByProject.get(projectPath);
}
/**
 * Get the project path for this instance
 * Uses SPECMEM_PROJECT_PATH or falls back to cwd
 */
function getProjectPath() {
    return getProjectContext().getProjectPath();
}
/**
 * Check if a path is within the project scope
 * Prevents watching paths outside the current project
 */
function isPathWithinProject(targetPath, projectPath) {
    const normalizedTarget = path.resolve(targetPath);
    const normalizedProject = path.resolve(projectPath);
    // Path must be within project directory or be the project directory itself
    return normalizedTarget === normalizedProject ||
        normalizedTarget.startsWith(normalizedProject + path.sep);
}
/**
 * Fetch active watched paths from database - PROJECT SCOPED
 * Only returns paths that are within the current project
 */
async function getWatchedPathsFromDb() {
    try {
        const db = getDatabase();
        if (!db)
            return [];
        const projectPath = getProjectPath();
        // Filter watched_paths to only those within our project scope
        const result = await db.query(`SELECT path FROM watched_paths
       WHERE is_active = true
       AND watch_for_changes = true
       AND (path = $1 OR path LIKE $2)`, [projectPath, projectPath + '/%']);
        // Double-check paths are within project (belt and suspenders)
        const validPaths = result.rows
            .map(r => r.path)
            .filter(p => isPathWithinProject(p, projectPath));
        logger.debug({
            projectPath,
            dbPaths: result.rows.length,
            validPaths: validPaths.length
        }, 'filtered watched_paths to project scope');
        return validPaths;
    }
    catch (error) {
        logger.warn({ error }, 'Failed to fetch watched_paths from database');
        return [];
    }
}
/**
 * initializeWatcher - sets up the file watcher system
 *
 * PROJECT-SCOPED: Only watches the current project directory
 * Uses SPECMEM_PROJECT_PATH to determine watch scope
 *
 * This prevents RAM bloat from watching all files across all  sessions.
 * Each SpecMem instance only watches its own project.
 */
export async function initializeWatcher(embeddingProvider) {
    // check if watcher is EXPLICITLY disabled in config
    // Default is ENABLED (true) - only skip if user explicitly set SPECMEM_WATCHER_ENABLED=false
    const watcherEnabled = config.watcher?.enabled ?? true;
    const envOverride = process.env['SPECMEM_WATCHER_ENABLED'];
    // Only disable if explicitly set to 'false' - empty string, undefined, 'true' all mean enabled
    if (envOverride === 'false' || (envOverride === undefined && watcherEnabled === false)) {
        logger.info('file watcher EXPLICITLY disabled via SPECMEM_WATCHER_ENABLED=false - skipping initialization');
        return null;
    }
    const projectPath = getProjectPath();
    const state = getWatcherState(projectPath);
    // Issue #12 Fix: Check if watcher is already fully initialized for this project
    if (state.manager) {
        logger.info({ projectPath }, 'watcher already initialized for this project - returning existing manager');
        return state.manager;
    }
    // Issue #12 Fix: Promise-based initialization lock prevents double init race condition.
    // If init is already in progress from another code path (MCP tool call, startup, reconnection),
    // subsequent calls await the existing init promise instead of creating a second watcher.
    if (initializationLockByProject.has(projectPath)) {
        logger.warn({ projectPath }, 'watcher initialization already in progress - awaiting existing init (preventing double init race condition)');
        return await initializationLockByProject.get(projectPath);
    }
    // Create the initialization promise and store it as the lock
    const initPromise = _doInitializeWatcher(embeddingProvider, projectPath, state);
    initializationLockByProject.set(projectPath, initPromise);
    try {
        const result = await initPromise;
        return result;
    }
    finally {
        // Always release the lock when init completes (success or failure)
        initializationLockByProject.delete(projectPath);
    }
}
/**
 * _doInitializeWatcher - internal init logic, called once per project under lock
 *
 * Separated from initializeWatcher to keep the lock logic clean.
 * This function does the actual work of creating and starting the watcher.
 */
async function _doInitializeWatcher(embeddingProvider, projectPath, state) {
    logger.info({ projectPath }, 'initializing PROJECT-SCOPED file watcher...');
    try {
        // get database context - check if it's initialized first
        let dbContext;
        try {
            dbContext = getDbContext();
        }
        catch (error) {
            logger.warn('database context not initialized yet - file watcher will be disabled');
            logger.debug({ error }, 'database context error details');
            return null;
        }
        // Get paths from database - ALREADY FILTERED to project scope
        const dbPaths = await getWatchedPathsFromDb();
        // CRITICAL: Always use project path as primary, never config.watcher.rootPath
        // config.watcher.rootPath could be a global path that wastes resources
        const primaryPath = projectPath;
        // Additional paths from DB (already validated to be within project)
        const additionalPaths = dbPaths.filter(p => p !== primaryPath);
        // Build final watch paths list
        const watchPaths = [primaryPath, ...additionalPaths];
        // Track what we're watching - using per-project state
        state.watchedPaths = new Set(watchPaths);
        logger.info({
            projectPath,
            pathCount: watchPaths.length,
            paths: watchPaths,
            source: dbPaths.length > 0 ? 'database (project-scoped)' : 'project path only'
        }, 'resolved PROJECT-SCOPED watch paths');
        // Issue #12 Fix: Watcher event debounce is configurable via SPECMEM_WATCHER_DEBOUNCE_MS
        // Default is 1000ms. This prevents excessive processing of rapid file change events.
        const debounceMs = parseInt(process.env['SPECMEM_WATCHER_DEBOUNCE_MS'] || String(config.watcher.debounceMs || 1000), 10);
        logger.info({ debounceMs }, 'using configurable watcher debounce delay');
        // build watcher config
        const watcherConfig = {
            watcher: {
                rootPath: primaryPath,
                additionalPaths: additionalPaths,
                ignorePath: config.watcher.ignorePath,
                debounceMs: debounceMs,
                autoRestart: config.watcher.autoRestart,
                maxRestarts: config.watcher.maxRestarts,
                verbose: config.logging.level === 'debug' || config.logging.level === 'trace'
            },
            handler: {
                rootPath: primaryPath,
                embeddingProvider,
                yeeter: dbContext.yeeter,
                search: dbContext.search,
                nuker: dbContext.nuker,
                pool: dbContext.pool,
                maxFileSizeBytes: config.watcher.maxFileSizeBytes,
                autoDetectMetadata: config.watcher.autoDetectMetadata
            },
            queue: {
                maxQueueSize: config.watcher.queueMaxSize,
                batchSize: config.watcher.queueBatchSize,
                processingIntervalMs: config.watcher.queueProcessingIntervalMs,
                enableDeduplication: true
            },
            syncChecker: {
                rootPath: primaryPath,
                search: dbContext.search,
                changeHandler: null, // set by WatcherManager constructor
                maxFileSizeBytes: config.watcher.maxFileSizeBytes
            }
        };
        // create watcher manager - stored in per-project state
        state.manager = new WatcherManager(watcherConfig);
        // start the watcher if auto-start is enabled
        await state.manager.start(config.watcher.syncCheckIntervalMinutes);
        // DRAIN EMBEDDING QUEUE: Process any pending embedding requests that failed during startup
        // This ensures files that were queued due to embedding service being unavailable get processed
        try {
            const { getEmbeddingQueue } = await import('../services/EmbeddingQueue.js');
            const { getDatabase } = await import('../database.js');
            const embeddingQueue = getEmbeddingQueue(getDatabase().getPool(), projectPath);
            const pendingCount = await embeddingQueue.getPendingCount();
            if (pendingCount > 0) {
                logger.info({ pendingCount, projectPath }, 'Draining embedding queue for file watcher on startup');
                const drained = await embeddingQueue.drainQueue(async (text) => {
                    return await embeddingProvider.generateEmbedding(text);
                });
                logger.info({ drained, projectPath }, 'Embedding queue drained successfully');
            }
        }
        catch (queueErr) {
            logger.warn({ error: queueErr, projectPath }, 'Failed to drain embedding queue on startup (non-fatal)');
        }
        // CRITICAL: Verify watcher actually started - dont just trust the call succeeded
        // This fixes the bug where "Complete" was shown even when watchers failed to start
        const status = state.manager.getStatus();
        if (!status.isRunning) {
            logger.error({
                projectPath,
                status
            }, 'watcher manager created but failed to start - isRunning is false');
            // cleanup the failed manager
            state.manager = null;
            state.watchedPaths.clear();
            return null;
        }
        // also verify the underlying file watcher is active
        if (!status.watcher.isWatching) {
            logger.error({
                projectPath,
                watcherStats: status.watcher
            }, 'watcher manager running but file watcher not watching - something is cooked');
            // try to stop and cleanup
            try {
                await state.manager.stop();
            }
            catch (stopError) {
                logger.warn({ stopError }, 'failed to stop partially-started watcher');
            }
            state.manager = null;
            state.watchedPaths.clear();
            return null;
        }
        logger.info({
            projectPath,
            paths: watchPaths,
            syncCheckIntervalMinutes: config.watcher.syncCheckIntervalMinutes,
            debounceMs: debounceMs,
            filesWatched: status.watcher.filesWatched
        }, 'PROJECT-SCOPED file watcher initialized and VERIFIED running');
        return state.manager;
    }
    catch (error) {
        logger.error({ error, projectPath }, 'failed to initialize project-scoped file watcher');
        // Clean up state on failure so a retry can succeed
        state.manager = null;
        state.watchedPaths.clear();
        return null;
    }
}
/**
 * getWatcherManager - returns the watcher manager for current project
 * Uses per-project state so each project is isolated
 */
export function getWatcherManager() {
    const projectPath = getProjectPath();
    const state = getWatcherState(projectPath);
    return state.manager;
}
/**
 * shutdownWatcher - gracefully shuts down the watcher for current project
 * Cleans up all resources and resets state for this specific project
 */
export async function shutdownWatcher() {
    const projectPath = getProjectPath();
    const state = getWatcherState(projectPath);
    if (!state.manager) {
        logger.debug({ projectPath }, 'no watcher to shutdown for this project');
        return;
    }
    logger.info({ projectPath }, 'shutting down project-scoped file watcher...');
    try {
        await state.manager.stop();
        state.manager = null;
        state.watchedPaths.clear();
        logger.info({ projectPath }, 'file watcher shutdown complete - resources cleaned up');
    }
    catch (error) {
        logger.error({ error, projectPath }, 'error during watcher shutdown');
    }
}
// ============================================================================
// DYNAMIC PATH MANAGEMENT
// These functions allow runtime modification of watched paths
// ============================================================================
/**
 * addWatchPath - dynamically add a path to watch
 * Path MUST be within the current project scope
 *
 * @param targetPath - path to add to watcher
 * @returns true if path was added, false if rejected (outside project or already watched)
 */
export async function addWatchPath(targetPath) {
    const projectPath = getProjectPath();
    const state = getWatcherState(projectPath);
    // Validate path is within project scope
    if (!isPathWithinProject(targetPath, projectPath)) {
        logger.warn({
            targetPath,
            projectPath
        }, 'rejected addWatchPath - path is outside project scope');
        return false;
    }
    // Check if already watching
    if (state.watchedPaths.has(targetPath)) {
        logger.debug({ targetPath }, 'path already being watched');
        return true;
    }
    // Add to our tracking set (per-project)
    state.watchedPaths.add(targetPath);
    // If watcher is running, we need to restart it with new paths
    // (chokidar doesn't support dynamic path addition easily)
    if (state.manager) {
        logger.info({ targetPath }, 'path added - watcher restart required');
        // Note: Full restart would be done by re-calling initializeWatcher
        // For now, just track it - next restart will pick it up
    }
    logger.info({
        targetPath,
        totalWatchedPaths: state.watchedPaths.size
    }, 'added watch path within project scope');
    return true;
}
/**
 * removeWatchPath - dynamically remove a path from watcher
 *
 * @param targetPath - path to remove from watcher
 * @returns true if path was removed
 */
export async function removeWatchPath(targetPath) {
    const projectPath = getProjectPath();
    const state = getWatcherState(projectPath);
    // Can't remove the main project path
    if (targetPath === projectPath) {
        logger.warn({ targetPath }, 'cannot remove main project path from watcher');
        return false;
    }
    // Remove from tracking (per-project)
    const wasRemoved = state.watchedPaths.delete(targetPath);
    if (wasRemoved) {
        logger.info({
            targetPath,
            remainingPaths: state.watchedPaths.size
        }, 'removed watch path');
    }
    return wasRemoved;
}
/**
 * getWatchedPaths - returns all currently watched paths for current project
 */
export function getWatchedPaths() {
    const projectPath = getProjectPath();
    const state = getWatcherState(projectPath);
    return Array.from(state.watchedPaths);
}
/**
 * getWatcherStatus - returns comprehensive watcher status for current project
 * Useful for debugging and monitoring
 */
export function getWatcherStatus() {
    const projectPath = getProjectPath();
    const state = getWatcherState(projectPath);
    return {
        isRunning: state.manager !== null,
        projectPath: projectPath,
        watchedPaths: Array.from(state.watchedPaths),
        watcherStats: state.manager?.getStatus() ?? null
    };
}
/**
 * isWatcherForProject - check if watcher is initialized for a specific project
 * Useful to avoid conflicts when multiple  sessions are running
 */
export function isWatcherForProject(targetProjectPath) {
    const state = getWatcherState(targetProjectPath);
    return state.manager !== null;
}
// ============================================================================
// CLEANUP ON PROCESS EXIT
// Ensures all project watchers are properly shutdown when the process terminates
// ============================================================================
let cleanupRegistered = false;
/**
 * shutdownAllWatchers - shutdown watchers for ALL projects
 * Used during process exit to clean up everything
 */
async function shutdownAllWatchers() {
    const projectPaths = Array.from(watcherStateByProject.keys());
    if (projectPaths.length === 0) {
        logger.debug('no watchers to shutdown');
        return;
    }
    logger.info({ projectCount: projectPaths.length }, 'shutting down all project watchers...');
    for (const projectPath of projectPaths) {
        const state = watcherStateByProject.get(projectPath);
        if (state?.manager) {
            try {
                await state.manager.stop();
                state.manager = null;
                state.watchedPaths.clear();
                logger.debug({ projectPath }, 'watcher shutdown for project');
            }
            catch (error) {
                logger.error({ error, projectPath }, 'error shutting down watcher for project');
            }
        }
    }
    // Clear the entire map after shutdown
    watcherStateByProject.clear();
    logger.info('all project watchers shutdown complete');
}
/**
 * registerCleanupHandlers - register process exit handlers for cleanup
 * Should be called once during initialization
 */
export function registerCleanupHandlers() {
    if (cleanupRegistered)
        return;
    const cleanup = async (signal) => {
        logger.info({ signal }, 'received shutdown signal - cleaning up all watchers');
        await shutdownAllWatchers();
    };
    // Handle various termination signals
    process.on('SIGINT', () => cleanup('SIGINT'));
    process.on('SIGTERM', () => cleanup('SIGTERM'));
    process.on('SIGHUP', () => cleanup('SIGHUP'));
    // Handle uncaught exceptions - try to cleanup before crashing
    process.on('uncaughtException', async (error) => {
        logger.error({ error }, 'uncaught exception - attempting watcher cleanup');
        try {
            await shutdownAllWatchers();
        }
        catch (e) {
            // Ignore cleanup errors during crash
        }
        process.exit(1);
    });
    cleanupRegistered = true;
    logger.debug('registered process cleanup handlers for watcher');
}
//# sourceMappingURL=watcherIntegration.js.map