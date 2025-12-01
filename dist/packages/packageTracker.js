// yooo tracking package.json changes without indexing node_modules
// this is the BIG BRAIN move fr fr
// we watch package.json and track dependency history
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger.js';
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
export class PackageTracker {
    snapshots = new Map();
    /**
     * readPackageJson - reads and parses a package.json file
     */
    async readPackageJson(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const parsed = JSON.parse(content);
            return parsed;
        }
        catch (err) {
            logger.warn({ filePath, err }, 'failed to read package.json - skipping');
            return null;
        }
    }
    /**
     * createSnapshot - creates a snapshot from package.json
     */
    async createSnapshot(filePath) {
        const packageJson = await this.readPackageJson(filePath);
        if (!packageJson) {
            return null;
        }
        const snapshot = {
            filePath,
            projectName: packageJson.name,
            projectVersion: packageJson.version,
            dependencies: packageJson.dependencies ?? {},
            devDependencies: packageJson.devDependencies ?? {},
            peerDependencies: packageJson.peerDependencies ?? {},
            optionalDependencies: packageJson.optionalDependencies ?? {},
            timestamp: new Date()
        };
        return snapshot;
    }
    /**
     * diffSnapshots - compares two snapshots and finds changes
     * returns list of changes that occurred
     */
    diffSnapshots(oldSnapshot, newSnapshot) {
        const changes = [];
        const timestamp = new Date();
        // if no old snapshot, everything is "added"
        if (!oldSnapshot) {
            // regular dependencies
            for (const [pkg, version] of Object.entries(newSnapshot.dependencies)) {
                changes.push({
                    packageName: pkg,
                    eventType: 'added',
                    packageType: 'dependency',
                    newVersion: version,
                    timestamp
                });
            }
            // dev dependencies
            for (const [pkg, version] of Object.entries(newSnapshot.devDependencies)) {
                changes.push({
                    packageName: pkg,
                    eventType: 'added',
                    packageType: 'devDependency',
                    newVersion: version,
                    timestamp
                });
            }
            // peer dependencies
            for (const [pkg, version] of Object.entries(newSnapshot.peerDependencies)) {
                changes.push({
                    packageName: pkg,
                    eventType: 'added',
                    packageType: 'peerDependency',
                    newVersion: version,
                    timestamp
                });
            }
            // optional dependencies
            for (const [pkg, version] of Object.entries(newSnapshot.optionalDependencies)) {
                changes.push({
                    packageName: pkg,
                    eventType: 'added',
                    packageType: 'optionalDependency',
                    newVersion: version,
                    timestamp
                });
            }
            return changes;
        }
        // compare dependencies
        this.diffDependencyType('dependency', oldSnapshot.dependencies, newSnapshot.dependencies, changes, timestamp);
        // compare devDependencies
        this.diffDependencyType('devDependency', oldSnapshot.devDependencies, newSnapshot.devDependencies, changes, timestamp);
        // compare peerDependencies
        this.diffDependencyType('peerDependency', oldSnapshot.peerDependencies, newSnapshot.peerDependencies, changes, timestamp);
        // compare optionalDependencies
        this.diffDependencyType('optionalDependency', oldSnapshot.optionalDependencies, newSnapshot.optionalDependencies, changes, timestamp);
        return changes;
    }
    /**
     * diffDependencyType - compares a specific type of dependencies
     */
    diffDependencyType(packageType, oldDeps, newDeps, changes, timestamp) {
        const allPackages = new Set([...Object.keys(oldDeps), ...Object.keys(newDeps)]);
        for (const pkg of allPackages) {
            const oldVersion = oldDeps[pkg];
            const newVersion = newDeps[pkg];
            if (oldVersion && !newVersion) {
                // package was removed
                changes.push({
                    packageName: pkg,
                    eventType: 'removed',
                    packageType,
                    oldVersion,
                    timestamp
                });
            }
            else if (!oldVersion && newVersion) {
                // package was added
                changes.push({
                    packageName: pkg,
                    eventType: 'added',
                    packageType,
                    newVersion,
                    timestamp
                });
            }
            else if (oldVersion !== newVersion) {
                // package version was updated
                changes.push({
                    packageName: pkg,
                    eventType: 'updated',
                    packageType,
                    oldVersion,
                    newVersion,
                    timestamp
                });
            }
        }
    }
    /**
     * trackPackageChanges - tracks changes in a package.json file
     * returns the list of changes detected
     */
    async trackPackageChanges(filePath) {
        logger.debug({ filePath }, 'tracking package.json changes');
        const newSnapshot = await this.createSnapshot(filePath);
        if (!newSnapshot) {
            logger.warn({ filePath }, 'could not create snapshot - skipping');
            return [];
        }
        const oldSnapshot = this.snapshots.get(filePath) ?? null;
        const changes = this.diffSnapshots(oldSnapshot, newSnapshot);
        // update snapshot cache
        this.snapshots.set(filePath, newSnapshot);
        if (changes.length > 0) {
            logger.info({ filePath, changeCount: changes.length }, 'detected package changes - tracking the node modules vibes');
        }
        return changes;
    }
    /**
     * getSnapshot - gets the current snapshot for a file
     */
    getSnapshot(filePath) {
        return this.snapshots.get(filePath);
    }
    /**
     * getAllSnapshots - returns all tracked snapshots
     */
    getAllSnapshots() {
        return new Map(this.snapshots);
    }
    /**
     * clearSnapshot - removes a snapshot from cache
     */
    clearSnapshot(filePath) {
        return this.snapshots.delete(filePath);
    }
    /**
     * clearAllSnapshots - clears all cached snapshots
     */
    clearAllSnapshots() {
        this.snapshots.clear();
    }
    /**
     * findPackageJsonFiles - recursively finds all package.json files
     * useful for monorepos
     */
    async findPackageJsonFiles(rootPath, maxDepth = 5) {
        const results = [];
        async function scan(dirPath, depth) {
            if (depth > maxDepth)
                return;
            try {
                const entries = await fs.readdir(dirPath, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dirPath, entry.name);
                    // skip node_modules and other excluded directories
                    if (entry.isDirectory()) {
                        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') {
                            continue;
                        }
                        await scan(fullPath, depth + 1);
                    }
                    else if (entry.isFile() && entry.name === 'package.json') {
                        results.push(fullPath);
                    }
                }
            }
            catch (err) {
                // ignore permission errors and other scan issues
                logger.debug({ dirPath, err }, 'failed to scan directory');
            }
        }
        await scan(rootPath, 0);
        logger.debug({ rootPath, count: results.length }, 'found package.json files');
        return results;
    }
    /**
     * getLockFileType - detects which lock file is used
     */
    async getLockFileType(packageJsonPath) {
        const dir = path.dirname(packageJsonPath);
        try {
            const files = await fs.readdir(dir);
            if (files.includes('pnpm-lock.yaml')) {
                return 'pnpm';
            }
            else if (files.includes('yarn.lock')) {
                return 'yarn';
            }
            else if (files.includes('package-lock.json')) {
                return 'npm';
            }
        }
        catch (e) {
            // Directory not readable - return none, this is fine
            // logger.debug({ dir, error: e }, 'couldnt read dir for package manager detection');
        }
        return 'none';
    }
}
// singleton instance for convenience
let trackerInstance = null;
export function getPackageTracker() {
    if (!trackerInstance) {
        trackerInstance = new PackageTracker();
    }
    return trackerInstance;
}
export function resetPackageTracker() {
    trackerInstance = null;
}
//# sourceMappingURL=packageTracker.js.map