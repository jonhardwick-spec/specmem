/**
 * watcher/index.ts - File Watcher System Exports
 *
 * yooo exporting all the watcher components
 */
export { WatchForChangesNoCap, WatcherConfig, FileChangeEvent, FileChangeHandler } from './fileWatcher.js';
export { AutoUpdateTheMemories, ChangeHandlerConfig, FileMetadata } from './changeHandler.js';
export { QueueTheChangesUp, QueueConfig, QueuedChange, QueueStats } from './changeQueue.js';
export { AreWeStillInSync, SyncCheckerConfig, DriftReport, ResyncResult } from './syncChecker.js';
export { TypeScriptCompiler, TypeScriptCompilerConfig, CompileResult, tsCompiler } from './tsCompiler.js';
/**
 * WatcherManager - orchestrates all watcher components
 *
 * fr fr this is the main watcher controller
 */
import { WatchForChangesNoCap, WatcherConfig } from './fileWatcher.js';
import { AutoUpdateTheMemories, ChangeHandlerConfig } from './changeHandler.js';
import { QueueTheChangesUp, QueueConfig } from './changeQueue.js';
import { AreWeStillInSync, SyncCheckerConfig } from './syncChecker.js';
export interface WatcherManagerConfig {
    watcher: WatcherConfig;
    handler: ChangeHandlerConfig;
    queue: QueueConfig;
    syncChecker: SyncCheckerConfig;
}
export declare class WatcherManager {
    private watcher;
    private handler;
    private queue;
    private syncChecker;
    private isRunning;
    private syncInterval;
    constructor(config: WatcherManagerConfig);
    /**
     * start - starts the entire watcher system
     *
     * yooo firing up the watcher system
     * NON-BLOCKING: Returns immediately, sync check runs in background
     */
    start(syncCheckIntervalMinutes?: number): Promise<void>;
    /**
     * runBackgroundSyncCheck - runs sync check in background without blocking
     *
     * fr fr scanning files without blocking the main thread
     */
    private runBackgroundSyncCheck;
    /**
     * stop - stops the entire watcher system
     */
    stop(): Promise<void>;
    /**
     * getStatus - returns comprehensive status
     */
    getStatus(): {
        isRunning: boolean;
        watcher: ReturnType<WatchForChangesNoCap['getStats']>;
        handler: ReturnType<AutoUpdateTheMemories['getStats']>;
        queue: ReturnType<QueueTheChangesUp['getStats']>;
        lastSyncCheck: Date | null;
    };
    /**
     * checkSync - manually trigger sync check
     */
    checkSync(): Promise<import("./syncChecker.js").DriftReport>;
    /**
     * resync - manually trigger full resync
     */
    resync(): Promise<import("./syncChecker.js").ResyncResult>;
    /**
     * flush - flush all pending changes
     */
    flush(): Promise<void>;
    /**
     * getComponents - returns individual components (for advanced use)
     */
    getComponents(): {
        watcher: WatchForChangesNoCap;
        handler: AutoUpdateTheMemories;
        queue: QueueTheChangesUp;
        syncChecker: AreWeStillInSync;
    };
    /**
     * scanExistingFiles - indexes all existing watched files
     *
     * call this after start() to queue existing files for indexing
     * since ignoreInitial:true means they dont fire events automatically
     */
    scanExistingFiles(): Promise<{
        scanned: number;
        skipped: number;
        errors: number;
    }>;
}
//# sourceMappingURL=index.d.ts.map