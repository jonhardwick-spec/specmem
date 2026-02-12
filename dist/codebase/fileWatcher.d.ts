import { EventEmitter } from 'events';
/**
 * FileChangeEvent - what happened to a file
 */
export interface FileChangeEvent {
    type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
    filePath: string;
    absolutePath: string;
    timestamp: Date;
}
/**
 * WatcherOptions - configuration for the file watcher
 */
export interface WatcherOptions {
    rootPath: string;
    debounceMs?: number;
    ignoreInitial?: boolean;
    persistent?: boolean;
    depth?: number;
    additionalExclusions?: string[];
}
/**
 * WatcherStats - statistics about watcher activity
 */
export interface WatcherStats {
    isWatching: boolean;
    rootPath: string;
    eventsReceived: number;
    eventsProcessed: number;
    lastEventTime: Date | null;
    watchedPaths: number;
    errors: number;
}
/**
 * FileWatcherGoBrrr - watches for file system changes
 *
 * features:
 * - recursive directory watching
 * - debouncing for batch changes
 * - exclusion pattern support
 * - event batching for efficiency
 * - automatic reconnection on errors
 */
export declare class FileWatcherGoBrrr extends EventEmitter {
    private options;
    private exclusionHandler;
    private watcher;
    private isWatching;
    private pendingEvents;
    private debounceTimer;
    private watchedPaths;
    private stats;
    constructor(options: WatcherOptions);
    /**
     * start - begin watching for file changes
     */
    start(): Promise<void>;
    /**
     * stop - stop watching for changes
     */
    stop(): void;
    /**
     * getStats - get watcher statistics
     */
    getStats(): WatcherStats;
    /**
     * isActive - check if watcher is running
     */
    isActive(): boolean;
    private handleFsEvent;
    private flushPendingEvents;
    private handleWatcherError;
}
/**
 * CodebaseChangeHandler - handles file change events for codebase sync
 *
 * this is what connects the file watcher to the ingestion system
 * when files change, we update our memories
 */
export interface CodebaseChangeHandler {
    onFileAdded(event: FileChangeEvent): Promise<void>;
    onFileChanged(event: FileChangeEvent): Promise<void>;
    onFileDeleted(event: FileChangeEvent): Promise<void>;
    onBatchChanges(events: FileChangeEvent[]): Promise<void>;
}
/**
 * createWatcherWithHandler - convenience function to create a watcher with a change handler
 */
export declare function createWatcherWithHandler(options: WatcherOptions, handler: Partial<CodebaseChangeHandler>): FileWatcherGoBrrr;
/**
 * WatcherEventTypes - for TypeScript event type safety
 */
export interface WatcherEvents {
    ready: () => void;
    close: () => void;
    error: (error: Error) => void;
    add: (event: FileChangeEvent) => void;
    change: (event: FileChangeEvent) => void;
    unlink: (event: FileChangeEvent) => void;
    addDir: (event: FileChangeEvent) => void;
    unlinkDir: (event: FileChangeEvent) => void;
    batch: (data: {
        events: FileChangeEvent[];
        adds: FileChangeEvent[];
        changes: FileChangeEvent[];
        deletes: FileChangeEvent[];
        addDirs: FileChangeEvent[];
        deleteDirs: FileChangeEvent[];
    }) => void;
    all: (events: FileChangeEvent[]) => void;
}
/**
 * Get or create a watcher for a specific project.
 * Each project gets its own watcher instance.
 *
 * @param options - Watcher options (must include rootPath)
 * @returns The watcher for this project, or null if no options provided
 */
export declare function getFileWatcher(options?: WatcherOptions): FileWatcherGoBrrr | null;
/**
 * Reset (stop and remove) the watcher for a specific project.
 * Only affects the watcher for that project - other projects' watchers are untouched.
 *
 * @param projectPath - The project path to reset. If not provided, resets all watchers.
 */
export declare function resetFileWatcher(projectPath?: string): void;
/**
 * Check if a watcher exists for a specific project.
 */
export declare function hasWatcherForProject(projectPath: string): boolean;
/**
 * Get all currently watched project paths.
 */
export declare function getWatchedProjectPaths(): string[];
//# sourceMappingURL=fileWatcher.d.ts.map