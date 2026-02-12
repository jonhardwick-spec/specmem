/**
 * packageWatcher - integrates package tracking with file watcher
 *
 * yooo this hooks into the file watcher to auto-track package.json changes
 * whenever a package.json file changes, we detect and record the changes
 */
import { FileChangeEvent } from '../watcher/fileWatcher.js';
import { PackageTracker } from './packageTracker.js';
import { DependencyHistoryManager } from './dependencyHistory.js';
/**
 * PackageChangeWatcher - watches for package.json changes and tracks them
 *
 * features that SLAP:
 * - detects package.json file changes
 * - automatically tracks dependency changes
 * - stores history in database
 * - handles both package.json and package-lock.json
 */
export declare class PackageChangeWatcher {
    private tracker;
    private historyManager;
    private stats;
    constructor(tracker?: PackageTracker, historyManager?: DependencyHistoryManager);
    /**
     * handleFileChange - processes a file change event
     * returns true if it was a package.json change
     */
    handleFileChange(event: FileChangeEvent): Promise<boolean>;
    /**
     * trackPackageJsonChange - tracks changes in a package.json file
     */
    private trackPackageJsonChange;
    /**
     * isPackageFile - checks if a file path is package.json or package-lock.json
     */
    static isPackageFile(filePath: string): boolean;
    /**
     * shouldTrackFile - determines if we should track this file
     */
    shouldTrackFile(filePath: string): boolean;
    /**
     * getStats - returns statistics
     */
    getStats(): {
        packageJsonChanges: number;
        dependenciesTracked: number;
        errors: number;
    };
    /**
     * resetStats - clears statistics
     */
    resetStats(): void;
}
export declare function getPackageChangeWatcher(): PackageChangeWatcher;
export declare function resetPackageChangeWatcher(): void;
/**
 * createPackageChangeHandler - creates a file change handler for package.json
 *
 * use this to integrate with the file watcher system
 */
export declare function createPackageChangeHandler(): (event: FileChangeEvent) => Promise<void>;
//# sourceMappingURL=packageWatcher.d.ts.map