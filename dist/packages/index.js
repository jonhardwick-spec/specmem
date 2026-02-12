// yooo this is the MAIN EXPORT for the package tracking layer
// tracking node_modules history without indexing all the files
// the BIG BRAIN move fr fr
// package tracker - tracks changes in package.json files
export { PackageTracker, getPackageTracker, resetPackageTracker } from './packageTracker.js';
// dependency history - database operations for package history
export { DependencyHistoryManager, getDependencyHistoryManager, resetDependencyHistoryManager } from './dependencyHistory.js';
// package tools - MCP tools for querying package history
export { GetPackageHistory, GetRecentPackageChanges, GetCurrentDependencies, WhenWasPackageAdded, QueryPackageHistory, GetPackageStats, PACKAGE_TOOLS, createPackageTools } from './packageTools.js';
// package watcher - integrates with file watcher system
export { PackageChangeWatcher, getPackageChangeWatcher, resetPackageChangeWatcher, createPackageChangeHandler } from './packageWatcher.js';
/**
 * trackTheNodeModulesVibes - convenience function to track package.json changes
 *
 * this is the main entry point for tracking package changes
 * call this when you detect a package.json file has changed
 */
import { getPackageTracker } from './packageTracker.js';
import { getDependencyHistoryManager } from './dependencyHistory.js';
import { getThePool } from '../db/connectionPoolGoBrrr.js';
import { logger } from '../utils/logger.js';
export async function trackTheNodeModulesVibes(packageJsonPath, projectName) {
    try {
        const tracker = getPackageTracker();
        const pool = getThePool();
        const historyManager = getDependencyHistoryManager(pool);
        // track changes
        const changes = await tracker.trackPackageChanges(packageJsonPath);
        // store in database
        if (changes.length > 0) {
            await historyManager.storeDependencyChanges(changes, packageJsonPath, projectName);
            logger.info({ packageJsonPath, changeCount: changes.length }, 'package changes tracked and stored - trackTheNodeModulesVibes');
        }
        return changes.length;
    }
    catch (err) {
        logger.error({ err, packageJsonPath }, 'failed to track package changes');
        throw err;
    }
}
/**
 * whenDidWeAddThisPackage - finds when a package was first added
 */
export async function whenDidWeAddThisPackage(packageName, packageJsonPath) {
    const pool = getThePool();
    const historyManager = getDependencyHistoryManager(pool);
    return historyManager.whenWasPackageAdded(packageName, packageJsonPath);
}
/**
 * whatPackagesDoWeHave - gets all currently installed packages
 */
export async function whatPackagesDoWeHave(packageJsonPath) {
    const pool = getThePool();
    const historyManager = getDependencyHistoryManager(pool);
    return historyManager.getCurrentDependencies(packageJsonPath);
}
/**
 * packageHistoryGoCrazy - gets full package statistics
 */
export async function packageHistoryGoCrazy() {
    const pool = getThePool();
    const historyManager = getDependencyHistoryManager(pool);
    return historyManager.getPackageStats();
}
//# sourceMappingURL=index.js.map