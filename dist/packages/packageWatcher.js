/**
 * packageWatcher - integrates package tracking with file watcher
 *
 * yooo this hooks into the file watcher to auto-track package.json changes
 * whenever a package.json file changes, we detect and record the changes
 */
import { getPackageTracker } from './packageTracker.js';
import { getDependencyHistoryManager } from './dependencyHistory.js';
import { getThePool } from '../db/connectionPoolGoBrrr.js';
import { logger } from '../utils/logger.js';
import * as path from 'path';
/**
 * PackageChangeWatcher - watches for package.json changes and tracks them
 *
 * features that SLAP:
 * - detects package.json file changes
 * - automatically tracks dependency changes
 * - stores history in database
 * - handles both package.json and package-lock.json
 */
export class PackageChangeWatcher {
    tracker;
    historyManager;
    // stats
    stats = {
        packageJsonChanges: 0,
        dependenciesTracked: 0,
        errors: 0
    };
    constructor(tracker, historyManager) {
        this.tracker = tracker ?? getPackageTracker();
        this.historyManager = historyManager ?? getDependencyHistoryManager(getThePool());
    }
    /**
     * handleFileChange - processes a file change event
     * returns true if it was a package.json change
     */
    async handleFileChange(event) {
        // only care about package.json files
        const fileName = path.basename(event.path);
        if (fileName !== 'package.json') {
            return false;
        }
        // skip deletes - we'll track removal when we see the new package.json
        if (event.type === 'unlink') {
            logger.debug({ path: event.path }, 'package.json deleted - skipping for now');
            return true;
        }
        // only process add/change events
        if (event.type !== 'add' && event.type !== 'change') {
            return false;
        }
        try {
            await this.trackPackageJsonChange(event.path);
            this.stats.packageJsonChanges++;
            return true;
        }
        catch (err) {
            this.stats.errors++;
            logger.error({ err, path: event.path }, 'failed to track package.json change');
            return false;
        }
    }
    /**
     * trackPackageJsonChange - tracks changes in a package.json file
     */
    async trackPackageJsonChange(packageJsonPath) {
        logger.info({ packageJsonPath }, 'tracking package.json changes - trackTheNodeModulesVibes');
        // track changes using tracker
        const changes = await this.tracker.trackPackageChanges(packageJsonPath);
        if (changes.length === 0) {
            logger.debug({ packageJsonPath }, 'no dependency changes detected');
            return;
        }
        // get project name from package.json
        const snapshot = this.tracker.getSnapshot(packageJsonPath);
        const projectName = snapshot?.projectName;
        // store changes in database
        const stored = await this.historyManager.storeDependencyChanges(changes, packageJsonPath, projectName);
        this.stats.dependenciesTracked += stored;
        logger.info({
            packageJsonPath,
            projectName,
            changeCount: changes.length,
            stored
        }, 'package changes tracked and stored - fr fr tracking those vibes');
    }
    /**
     * isPackageFile - checks if a file path is package.json or package-lock.json
     */
    static isPackageFile(filePath) {
        const fileName = path.basename(filePath);
        return fileName === 'package.json' ||
            fileName === 'package-lock.json' ||
            fileName === 'yarn.lock' ||
            fileName === 'pnpm-lock.yaml';
    }
    /**
     * shouldTrackFile - determines if we should track this file
     */
    shouldTrackFile(filePath) {
        // nah bruh we only tracking package.json
        // lock files are excluded by default but we use them for detection
        return path.basename(filePath) === 'package.json';
    }
    /**
     * getStats - returns statistics
     */
    getStats() {
        return { ...this.stats };
    }
    /**
     * resetStats - clears statistics
     */
    resetStats() {
        this.stats.packageJsonChanges = 0;
        this.stats.dependenciesTracked = 0;
        this.stats.errors = 0;
    }
}
// singleton instance
let watcherInstance = null;
export function getPackageChangeWatcher() {
    if (!watcherInstance) {
        watcherInstance = new PackageChangeWatcher();
    }
    return watcherInstance;
}
export function resetPackageChangeWatcher() {
    watcherInstance = null;
}
/**
 * createPackageChangeHandler - creates a file change handler for package.json
 *
 * use this to integrate with the file watcher system
 */
export function createPackageChangeHandler() {
    const watcher = getPackageChangeWatcher();
    return async (event) => {
        // yooo checking if this is a package.json change
        if (PackageChangeWatcher.isPackageFile(event.path)) {
            await watcher.handleFileChange(event);
        }
    };
}
//# sourceMappingURL=packageWatcher.js.map