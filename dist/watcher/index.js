/**
 * watcher/index.ts - File Watcher System Exports
 *
 * yooo exporting all the watcher components
 */
export { WatchForChangesNoCap } from './fileWatcher.js';
export { AutoUpdateTheMemories } from './changeHandler.js';
export { QueueTheChangesUp } from './changeQueue.js';
export { AreWeStillInSync } from './syncChecker.js';
export { TypeScriptCompiler, tsCompiler } from './tsCompiler.js';
/**
 * WatcherManager - orchestrates all watcher components
 *
 * fr fr this is the main watcher controller
 */
import { WatchForChangesNoCap } from './fileWatcher.js';
import { AutoUpdateTheMemories } from './changeHandler.js';
import { QueueTheChangesUp } from './changeQueue.js';
import { AreWeStillInSync } from './syncChecker.js';
import { logger } from '../utils/logger.js';
export class WatcherManager {
    watcher;
    handler;
    queue;
    syncChecker;
    isRunning = false;
    syncInterval = null;
    constructor(config) {
        // Create handler first - it's the core component
        this.handler = new AutoUpdateTheMemories(config.handler);
        // CRITICAL FIX: Wire the handler to syncChecker config
        // The comment in watcherIntegration.ts said "will be set by WatcherManager" - now it is!
        // Without this, resyncEverythingFrFr() crashes because changeHandler is null
        config.syncChecker.changeHandler = this.handler;
        this.queue = new QueueTheChangesUp(this.handler, config.queue);
        this.watcher = new WatchForChangesNoCap(config.watcher);
        this.syncChecker = new AreWeStillInSync(config.syncChecker);
    }
    /**
     * start - starts the entire watcher system
     *
     * yooo firing up the watcher system
     * NON-BLOCKING: Returns immediately, sync check runs in background
     */
    async start(syncCheckIntervalMinutes = 60) {
        if (this.isRunning) {
            logger.warn('watcher manager already running');
            return;
        }
        logger.info('starting watcher manager (non-blocking)...');
        try {
            // 1. start queue processing
            this.queue.startProcessing();
            // 2. start file watcher with queue handler - this is fast, just sets up chokidar
            await this.watcher.startWatching(async (event) => {
                this.queue.enqueue(event);
            });
            // Mark as running IMMEDIATELY - don't wait for sync
            this.isRunning = true;
            // 3. start periodic sync checking (this is cheap, just sets up interval)
            this.syncInterval = setInterval(async () => {
                try {
                    const report = await this.syncChecker.checkSync();
                    if (!report.inSync) {
                        logger.warn({
                            driftPercentage: report.driftPercentage,
                            missingFromMcp: report.missingFromMcp.length,
                            contentMismatch: report.contentMismatch.length
                        }, 'drift detected during periodic check');
                    }
                }
                catch (error) {
                    logger.error({ error }, 'periodic sync check failed');
                }
            }, syncCheckIntervalMinutes * 60 * 1000);
            logger.info('watcher manager started - ready for changes');
            // 4. BACKGROUND sync check - does NOT block startup
            // Runs the full filesystem scan in background so  becomes responsive immediately
            // Uses setImmediate to yield to event loop first
            setImmediate(() => {
                this.runBackgroundSyncCheck().catch(err => {
                    logger.warn({ error: err }, 'background sync check failed - will retry on periodic check');
                });
            });
        }
        catch (error) {
            logger.error({ error }, 'failed to start watcher manager');
            throw error;
        }
    }
    /**
     * runBackgroundSyncCheck - runs sync check in background without blocking
     *
     * fr fr scanning files without blocking the main thread
     */
    async runBackgroundSyncCheck() {
        logger.info('starting background sync check...');
        try {
            const initialReport = await this.syncChecker.checkSync();
            if (!initialReport.inSync) {
                logger.warn({
                    driftPercentage: initialReport.driftPercentage,
                    missingFromMcp: initialReport.missingFromMcp.length,
                    contentMismatch: initialReport.contentMismatch.length,
                    missingFromDisk: initialReport.missingFromDisk.length
                }, 'drift detected on startup - files changed since last sync');
                // if significant drift, trigger resync to catch up
                if (initialReport.missingFromMcp.length > 0 || initialReport.contentMismatch.length > 0) {
                    logger.info('triggering background resync to catch up with filesystem changes...');
                    const resyncResult = await this.syncChecker.resyncEverythingFrFr();
                    logger.info({
                        filesAdded: resyncResult.filesAdded,
                        filesUpdated: resyncResult.filesUpdated,
                        errors: resyncResult.errors.length
                    }, 'background resync complete - watcher now in sync');
                }
            }
            else {
                logger.info({ syncScore: initialReport.syncScore }, 'watcher in sync with filesystem');
            }
        }
        catch (syncError) {
            logger.warn({ error: syncError }, 'background sync check failed - watcher will rely on periodic checks');
        }
    }
    /**
     * stop - stops the entire watcher system
     */
    async stop() {
        if (!this.isRunning) {
            logger.warn('watcher manager not running');
            return;
        }
        logger.info('stopping watcher manager...');
        // stop sync checking
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        // stop file watcher
        await this.watcher.stopWatching();
        // stop queue processing
        this.queue.stopProcessing();
        this.isRunning = false;
        logger.info('watcher manager stopped');
    }
    /**
     * getStatus - returns comprehensive status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            watcher: this.watcher.getStats(),
            handler: this.handler.getStats(),
            queue: this.queue.getStats(),
            lastSyncCheck: this.syncChecker.getLastSyncCheck()
        };
    }
    /**
     * checkSync - manually trigger sync check
     */
    async checkSync() {
        return await this.syncChecker.checkSync();
    }
    /**
     * resync - manually trigger full resync
     */
    async resync() {
        return await this.syncChecker.resyncEverythingFrFr();
    }
    /**
     * flush - flush all pending changes
     */
    async flush() {
        await this.queue.flush();
    }
    /**
     * getComponents - returns individual components (for advanced use)
     */
    getComponents() {
        return {
            watcher: this.watcher,
            handler: this.handler,
            queue: this.queue,
            syncChecker: this.syncChecker
        };
    }
    /**
     * scanExistingFiles - indexes all existing watched files
     *
     * call this after start() to queue existing files for indexing
     * since ignoreInitial:true means they dont fire events automatically
     */
    async scanExistingFiles() {
        return await this.watcher.scanExistingFiles();
    }
}
//# sourceMappingURL=index.js.map