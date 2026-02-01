import { ConnectionPoolGoBrrr } from '../db/connectionPoolGoBrrr.js';
import { DependencyChange } from './packageTracker.js';
/**
 * DependencyHistoryRecord - a single history entry in the database
 */
export interface DependencyHistoryRecord {
    id: string;
    packageName: string;
    version: string | null;
    eventType: 'added' | 'updated' | 'removed';
    packageType: 'dependency' | 'devDependency' | 'peerDependency' | 'optionalDependency';
    timestamp: Date;
    packageJsonPath: string;
    projectName?: string;
    metadata?: Record<string, unknown>;
}
/**
 * PackageHistoryQuery - query options for searching history
 */
export interface PackageHistoryQuery {
    packageName?: string;
    eventType?: 'added' | 'updated' | 'removed';
    packageType?: 'dependency' | 'devDependency' | 'peerDependency' | 'optionalDependency';
    packageJsonPath?: string;
    projectName?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
}
/**
 * CurrentDependency - represents a currently installed package
 */
export interface CurrentDependency {
    packageName: string;
    version: string;
    packageType: 'dependency' | 'devDependency' | 'peerDependency' | 'optionalDependency';
    packageJsonPath: string;
    projectName?: string;
    addedAt: Date;
}
/**
 * DependencyHistoryManager - manages dependency history in the database
 *
 * features that SLAP:
 * - stores all package changes
 * - queries by package name, event type, date range
 * - tracks current dependencies
 * - aggregates stats on package usage
 */
export declare class DependencyHistoryManager {
    private pool;
    private stats;
    constructor(pool: ConnectionPoolGoBrrr);
    /**
     * storeDependencyChange - stores a single dependency change
     */
    storeDependencyChange(change: DependencyChange, packageJsonPath: string, projectName?: string): Promise<string>;
    /**
     * storeDependencyChanges - stores multiple changes in a batch
     */
    storeDependencyChanges(changes: DependencyChange[], packageJsonPath: string, projectName?: string): Promise<number>;
    /**
     * getPackageHistory - gets history for a specific package
     */
    getPackageHistory(packageName: string, limit?: number): Promise<DependencyHistoryRecord[]>;
    /**
     * queryHistory - flexible query for dependency history
     */
    queryHistory(query: PackageHistoryQuery): Promise<DependencyHistoryRecord[]>;
    /**
     * getRecentChanges - gets recent dependency changes across all projects
     */
    getRecentChanges(days?: number, limit?: number): Promise<DependencyHistoryRecord[]>;
    /**
     * whenWasPackageAdded - finds when a package was first added
     */
    whenWasPackageAdded(packageName: string, packageJsonPath?: string): Promise<Date | null>;
    /**
     * getCurrentDependencies - gets all currently installed packages
     * this looks at the most recent state of each package.json
     */
    getCurrentDependencies(packageJsonPath?: string): Promise<CurrentDependency[]>;
    /**
     * getPackageStats - gets aggregated stats about package usage
     */
    getPackageStats(): Promise<{
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
    /**
     * getStats - returns manager statistics
     */
    getStats(): {
        recordsStored: number;
        queriesExecuted: number;
        errors: number;
    };
    /**
     * resetStats - clears statistics
     */
    resetStats(): void;
}
export declare function getDependencyHistoryManager(pool: ConnectionPoolGoBrrr): DependencyHistoryManager;
export declare function resetDependencyHistoryManager(): void;
//# sourceMappingURL=dependencyHistory.d.ts.map