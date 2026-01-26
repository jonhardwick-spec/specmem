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
import { WatcherManager } from '../watcher/index.js';
import { EmbeddingProvider } from '../tools/index.js';
/**
 * initializeWatcher - sets up the file watcher system
 *
 * PROJECT-SCOPED: Only watches the current project directory
 * Uses SPECMEM_PROJECT_PATH to determine watch scope
 *
 * This prevents RAM bloat from watching all files across all  sessions.
 * Each SpecMem instance only watches its own project.
 */
export declare function initializeWatcher(embeddingProvider: EmbeddingProvider): Promise<WatcherManager | null>;
/**
 * getWatcherManager - returns the watcher manager for current project
 * Uses per-project state so each project is isolated
 */
export declare function getWatcherManager(): WatcherManager | null;
/**
 * shutdownWatcher - gracefully shuts down the watcher for current project
 * Cleans up all resources and resets state for this specific project
 */
export declare function shutdownWatcher(): Promise<void>;
/**
 * addWatchPath - dynamically add a path to watch
 * Path MUST be within the current project scope
 *
 * @param targetPath - path to add to watcher
 * @returns true if path was added, false if rejected (outside project or already watched)
 */
export declare function addWatchPath(targetPath: string): Promise<boolean>;
/**
 * removeWatchPath - dynamically remove a path from watcher
 *
 * @param targetPath - path to remove from watcher
 * @returns true if path was removed
 */
export declare function removeWatchPath(targetPath: string): Promise<boolean>;
/**
 * getWatchedPaths - returns all currently watched paths for current project
 */
export declare function getWatchedPaths(): string[];
/**
 * getWatcherStatus - returns comprehensive watcher status for current project
 * Useful for debugging and monitoring
 */
export declare function getWatcherStatus(): {
    isRunning: boolean;
    projectPath: string;
    watchedPaths: string[];
    watcherStats: ReturnType<WatcherManager['getStatus']> | null;
};
/**
 * isWatcherForProject - check if watcher is initialized for a specific project
 * Useful to avoid conflicts when multiple  sessions are running
 */
export declare function isWatcherForProject(targetProjectPath: string): boolean;
/**
 * registerCleanupHandlers - register process exit handlers for cleanup
 * Should be called once during initialization
 */
export declare function registerCleanupHandlers(): void;
//# sourceMappingURL=watcherIntegration.d.ts.map