/**
 * PackageJson - the structure we care about
 */
export interface PackageJson {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
}
/**
 * DependencyChange - represents a change in dependencies
 */
export interface DependencyChange {
    packageName: string;
    eventType: 'added' | 'updated' | 'removed';
    packageType: 'dependency' | 'devDependency' | 'peerDependency' | 'optionalDependency';
    oldVersion?: string;
    newVersion?: string;
    timestamp: Date;
}
/**
 * PackageSnapshot - a snapshot of package.json at a point in time
 */
export interface PackageSnapshot {
    filePath: string;
    projectName?: string;
    projectVersion?: string;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
    optionalDependencies: Record<string, string>;
    timestamp: Date;
}
/**
 * PackageTracker - tracks changes in package.json files
 *
 * features that GO HARD:
 * - reads package.json and package-lock.json
 * - diffs dependencies between versions
 * - detects added/updated/removed packages
 * - handles monorepos with multiple package.json files
 * - supports npm, yarn, pnpm
 */
export declare class PackageTracker {
    private snapshots;
    /**
     * readPackageJson - reads and parses a package.json file
     */
    readPackageJson(filePath: string): Promise<PackageJson | null>;
    /**
     * createSnapshot - creates a snapshot from package.json
     */
    createSnapshot(filePath: string): Promise<PackageSnapshot | null>;
    /**
     * diffSnapshots - compares two snapshots and finds changes
     * returns list of changes that occurred
     */
    diffSnapshots(oldSnapshot: PackageSnapshot | null, newSnapshot: PackageSnapshot): DependencyChange[];
    /**
     * diffDependencyType - compares a specific type of dependencies
     */
    private diffDependencyType;
    /**
     * trackPackageChanges - tracks changes in a package.json file
     * returns the list of changes detected
     */
    trackPackageChanges(filePath: string): Promise<DependencyChange[]>;
    /**
     * getSnapshot - gets the current snapshot for a file
     */
    getSnapshot(filePath: string): PackageSnapshot | undefined;
    /**
     * getAllSnapshots - returns all tracked snapshots
     */
    getAllSnapshots(): Map<string, PackageSnapshot>;
    /**
     * clearSnapshot - removes a snapshot from cache
     */
    clearSnapshot(filePath: string): boolean;
    /**
     * clearAllSnapshots - clears all cached snapshots
     */
    clearAllSnapshots(): void;
    /**
     * findPackageJsonFiles - recursively finds all package.json files
     * useful for monorepos
     */
    findPackageJsonFiles(rootPath: string, maxDepth?: number): Promise<string[]>;
    /**
     * getLockFileType - detects which lock file is used
     */
    getLockFileType(packageJsonPath: string): Promise<'npm' | 'yarn' | 'pnpm' | 'none'>;
}
export declare function getPackageTracker(): PackageTracker;
export declare function resetPackageTracker(): void;
//# sourceMappingURL=packageTracker.d.ts.map