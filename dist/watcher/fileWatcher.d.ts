/**
 * fileWatcher.ts - File System Watcher for Auto-Updating MCP Memories
 *
 * yooo watching for file changes lets goooo
 * monitors the entire codebase and auto-updates MCP when files change
 *
 * Features:
 * - Uses chokidar for reliable cross-platform watching
 * - Respects .specmemignore exclusions
 * - Debounces rapid changes (like during compilation)
 * - Auto-restarts on crashes (because watcher crashes are NOT it)
 * - Handles mass operations (git checkout, build, etc.)
 */
export interface WatcherConfig {
    rootPath: string;
    additionalPaths?: string[];
    ignorePath?: string;
    debounceMs?: number;
    autoRestart?: boolean;
    maxRestarts?: number;
    verbose?: boolean;
}
export interface FileChangeEvent {
    type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
    path: string;
    relativePath: string;
    timestamp: Date;
    stats?: {
        size: number;
        mtime: Date;
    };
}
export type FileChangeHandler = (event: FileChangeEvent) => Promise<void>;
/**
 * watchForChangesNoCap - main file watcher class
 *
 * fr fr this is the GOAT of file watchers
 * handles everything from rapid changes to mass git operations
 */
export declare class WatchForChangesNoCap {
    private config;
    private watcher;
    private isWatching;
    private restartCount;
    private ignorePatterns;
    private changeHandler;
    private debouncedHandlers;
    private pendingEventData;
    private stats;
    constructor(config: WatcherConfig);
    /**
     * startWatching - fires up the file watcher
     *
     * yooo lets get this watcher rolling
     */
    startWatching(handler: FileChangeHandler): Promise<void>;
    /**
     * stopWatching - gracefully shuts down the watcher
     */
    stopWatching(): Promise<void>;
    /**
     * setupEventHandlers - wires up all the chokidar events
     *
     * nah bruh handling ALL the file events
     */
    private setupEventHandlers;
    /**
     * handleEvent - processes a single file change event
     *
     * fr fr auto-updating this file rn
     */
    private handleEvent;
    /**
     * skipTheBoringShit - checks if file should be ignored
     *
     * nah bruh excluded file getting skipped
     */
    private skipTheBoringShit;
    /**
     * matchPattern - simple glob-style pattern matching
     */
    private matchPattern;
    /**
     * loadIgnorePatterns - loads patterns from .specmemignore
     */
    private loadIgnorePatterns;
    /**
     * restartWatcher - attempts to restart after crash
     *
     * skids editing files while were processing lmao
     */
    private restartWatcher;
    /**
     * getStats - returns watcher statistics
     */
    getStats(): typeof this.stats & {
        isWatching: boolean;
        rootPath: string;
        additionalPaths: string[];
    };
    /**
     * scanExistingFiles - queues all existing watched files for indexing
     *
     * ignoreInitial:true means existing files dont fire events on startup
     * call this after watcher starts to index everything thats already there
     */
    scanExistingFiles(): Promise<{
        scanned: number;
        skipped: number;
        errors: number;
    }>;
    /**
     * isActive - checks if watcher is currently running
     */
    isActive(): boolean;
    /**
     * reloadIgnorePatterns - reloads .specmemignore without restart
     */
    reloadIgnorePatterns(): Promise<void>;
}
//# sourceMappingURL=fileWatcher.d.ts.map