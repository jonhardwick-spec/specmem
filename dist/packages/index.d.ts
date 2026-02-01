export { PackageTracker, getPackageTracker, resetPackageTracker, type PackageJson, type DependencyChange, type PackageSnapshot } from './packageTracker.js';
export { DependencyHistoryManager, getDependencyHistoryManager, resetDependencyHistoryManager, type DependencyHistoryRecord, type PackageHistoryQuery, type CurrentDependency } from './dependencyHistory.js';
export { GetPackageHistory, GetRecentPackageChanges, GetCurrentDependencies, WhenWasPackageAdded, QueryPackageHistory, GetPackageStats, PACKAGE_TOOLS, createPackageTools } from './packageTools.js';
export { PackageChangeWatcher, getPackageChangeWatcher, resetPackageChangeWatcher, createPackageChangeHandler } from './packageWatcher.js';
import { type CurrentDependency } from './dependencyHistory.js';
export declare function trackTheNodeModulesVibes(packageJsonPath: string, projectName?: string): Promise<number>;
/**
 * whenDidWeAddThisPackage - finds when a package was first added
 */
export declare function whenDidWeAddThisPackage(packageName: string, packageJsonPath?: string): Promise<Date | null>;
/**
 * whatPackagesDoWeHave - gets all currently installed packages
 */
export declare function whatPackagesDoWeHave(packageJsonPath?: string): Promise<CurrentDependency[]>;
/**
 * packageHistoryGoCrazy - gets full package statistics
 */
export declare function packageHistoryGoCrazy(): Promise<{
    totalPackages: number;
    totalChanges: number;
    mostChangedPackages: Array<{
        packageName: string;
        changeCount: number;
    }>;
    recentlyAdded: Array<{
        packageName: string;
        addedAt: Date;
    }>;
}>;
//# sourceMappingURL=index.d.ts.map