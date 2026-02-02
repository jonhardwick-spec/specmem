// yooo storing and querying dependency history fr fr
// this is how we track what packages got added/removed/updated
// without bloating the database with node_modules files
import { logger } from '../utils/logger.js';
/**
 * DependencyHistoryManager - manages dependency history in the database
 *
 * features that SLAP:
 * - stores all package changes
 * - queries by package name, event type, date range
 * - tracks current dependencies
 * - aggregates stats on package usage
 */
export class DependencyHistoryManager {
    pool;
    // stats tracking
    stats = {
        recordsStored: 0,
        queriesExecuted: 0,
        errors: 0
    };
    constructor(pool) {
        this.pool = pool;
    }
    /**
     * storeDependencyChange - stores a single dependency change
     */
    async storeDependencyChange(change, packageJsonPath, projectName) {
        try {
            const result = await this.pool.queryWithSwag(`INSERT INTO dependency_history (
          package_name,
          version,
          event_type,
          package_type,
          timestamp,
          package_json_path,
          project_name,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`, [
                change.packageName,
                change.newVersion ?? change.oldVersion ?? null,
                change.eventType,
                change.packageType,
                change.timestamp,
                packageJsonPath,
                projectName ?? null,
                JSON.stringify({
                    oldVersion: change.oldVersion,
                    newVersion: change.newVersion
                })
            ]);
            this.stats.recordsStored++;
            const id = result.rows[0]?.id ?? '';
            logger.debug({
                packageName: change.packageName,
                eventType: change.eventType,
                id
            }, 'stored dependency change');
            return id;
        }
        catch (err) {
            this.stats.errors++;
            logger.error({ err, change }, 'failed to store dependency change');
            throw err;
        }
    }
    /**
     * storeDependencyChanges - stores multiple changes in a batch
     */
    async storeDependencyChanges(changes, packageJsonPath, projectName) {
        if (changes.length === 0) {
            return 0;
        }
        logger.info({ changeCount: changes.length, packageJsonPath }, 'storing dependency changes - packageHistoryGoCrazy');
        let stored = 0;
        // use a transaction for batch insert
        await this.pool.transactionGang(async (client) => {
            for (const change of changes) {
                await client.query(`INSERT INTO dependency_history (
            package_name,
            version,
            event_type,
            package_type,
            timestamp,
            package_json_path,
            project_name,
            metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
                    change.packageName,
                    change.newVersion ?? change.oldVersion ?? null,
                    change.eventType,
                    change.packageType,
                    change.timestamp,
                    packageJsonPath,
                    projectName ?? null,
                    JSON.stringify({
                        oldVersion: change.oldVersion,
                        newVersion: change.newVersion
                    })
                ]);
                stored++;
            }
        });
        this.stats.recordsStored += stored;
        logger.info({ stored }, 'dependency changes stored successfully');
        return stored;
    }
    /**
     * getPackageHistory - gets history for a specific package
     */
    async getPackageHistory(packageName, limit = 100) {
        this.stats.queriesExecuted++;
        try {
            const result = await this.pool.queryWithSwag(`SELECT * FROM dependency_history
         WHERE package_name = $1
         ORDER BY timestamp DESC
         LIMIT $2`, [packageName, limit]);
            return result.rows.map((row) => ({
                id: row.id,
                packageName: row.package_name,
                version: row.version,
                eventType: row.event_type,
                packageType: row.package_type,
                timestamp: row.timestamp,
                packageJsonPath: row.package_json_path,
                projectName: row.project_name ?? undefined,
                metadata: row.metadata ? JSON.parse(row.metadata) : undefined
            }));
        }
        catch (err) {
            this.stats.errors++;
            logger.error({ err, packageName }, 'failed to get package history');
            throw err;
        }
    }
    /**
     * queryHistory - flexible query for dependency history
     */
    async queryHistory(query) {
        this.stats.queriesExecuted++;
        const conditions = [];
        const params = [];
        let paramIndex = 1;
        if (query.packageName) {
            conditions.push(`package_name = $${paramIndex++}`);
            params.push(query.packageName);
        }
        if (query.eventType) {
            conditions.push(`event_type = $${paramIndex++}`);
            params.push(query.eventType);
        }
        if (query.packageType) {
            conditions.push(`package_type = $${paramIndex++}`);
            params.push(query.packageType);
        }
        if (query.packageJsonPath) {
            conditions.push(`package_json_path = $${paramIndex++}`);
            params.push(query.packageJsonPath);
        }
        if (query.projectName) {
            conditions.push(`project_name = $${paramIndex++}`);
            params.push(query.projectName);
        }
        if (query.fromDate) {
            conditions.push(`timestamp >= $${paramIndex++}`);
            params.push(query.fromDate);
        }
        if (query.toDate) {
            conditions.push(`timestamp <= $${paramIndex++}`);
            params.push(query.toDate);
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = query.limit ?? 100;
        try {
            const result = await this.pool.queryWithSwag(`SELECT * FROM dependency_history
         ${whereClause}
         ORDER BY timestamp DESC
         LIMIT $${paramIndex}`, [...params, limit]);
            return result.rows.map((row) => ({
                id: row.id,
                packageName: row.package_name,
                version: row.version,
                eventType: row.event_type,
                packageType: row.package_type,
                timestamp: row.timestamp,
                packageJsonPath: row.package_json_path,
                projectName: row.project_name ?? undefined,
                metadata: row.metadata ? JSON.parse(row.metadata) : undefined
            }));
        }
        catch (err) {
            this.stats.errors++;
            logger.error({ err, query }, 'failed to query dependency history');
            throw err;
        }
    }
    /**
     * getRecentChanges - gets recent dependency changes across all projects
     */
    async getRecentChanges(days = 7, limit = 50) {
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - days);
        return this.queryHistory({ fromDate, limit });
    }
    /**
     * whenWasPackageAdded - finds when a package was first added
     */
    async whenWasPackageAdded(packageName, packageJsonPath) {
        this.stats.queriesExecuted++;
        try {
            const conditions = ['package_name = $1', "event_type = 'added'"];
            const params = [packageName];
            if (packageJsonPath) {
                conditions.push('package_json_path = $2');
                params.push(packageJsonPath);
            }
            const result = await this.pool.queryWithSwag(`SELECT timestamp FROM dependency_history
         WHERE ${conditions.join(' AND ')}
         ORDER BY timestamp ASC
         LIMIT 1`, params);
            return result.rows[0]?.timestamp ?? null;
        }
        catch (err) {
            this.stats.errors++;
            logger.error({ err, packageName }, 'failed to find package addition date');
            throw err;
        }
    }
    /**
     * getCurrentDependencies - gets all currently installed packages
     * this looks at the most recent state of each package.json
     */
    async getCurrentDependencies(packageJsonPath) {
        this.stats.queriesExecuted++;
        try {
            // get the latest state for each package
            // we do this by finding packages where the last event wasn't 'removed'
            const whereClause = packageJsonPath ? 'WHERE package_json_path = $1' : '';
            const params = packageJsonPath ? [packageJsonPath] : [];
            const result = await this.pool.queryWithSwag(`WITH latest_events AS (
          SELECT DISTINCT ON (package_name, package_json_path)
            package_name,
            version,
            event_type,
            package_type,
            package_json_path,
            project_name,
            timestamp
          FROM dependency_history
          ${whereClause}
          ORDER BY package_name, package_json_path, timestamp DESC
        ),
        first_added AS (
          SELECT package_name, package_json_path, MIN(timestamp) as added_at
          FROM dependency_history
          WHERE event_type = 'added'
          ${whereClause}
          GROUP BY package_name, package_json_path
        )
        SELECT
          le.package_name,
          le.version,
          le.package_type,
          le.package_json_path,
          le.project_name,
          fa.added_at
        FROM latest_events le
        LEFT JOIN first_added fa
          ON le.package_name = fa.package_name
          AND le.package_json_path = fa.package_json_path
        WHERE le.event_type != 'removed'
        ORDER BY le.package_name`, params);
            return result.rows.map((row) => ({
                packageName: row.package_name,
                version: row.version ?? 'unknown',
                packageType: row.package_type,
                packageJsonPath: row.package_json_path,
                projectName: row.project_name ?? undefined,
                addedAt: row.added_at ?? new Date()
            }));
        }
        catch (err) {
            this.stats.errors++;
            logger.error({ err, packageJsonPath }, 'failed to get current dependencies');
            throw err;
        }
    }
    /**
     * getPackageStats - gets aggregated stats about package usage
     */
    async getPackageStats() {
        this.stats.queriesExecuted++;
        try {
            // total unique packages
            const totalResult = await this.pool.queryWithSwag('SELECT COUNT(DISTINCT package_name) as count FROM dependency_history');
            const totalPackages = parseInt(totalResult.rows[0]?.count ?? '0');
            // total changes
            const changesResult = await this.pool.queryWithSwag('SELECT COUNT(*) as count FROM dependency_history');
            const totalChanges = parseInt(changesResult.rows[0]?.count ?? '0');
            // most changed packages
            const mostChangedResult = await this.pool.queryWithSwag(`SELECT package_name, COUNT(*) as change_count
         FROM dependency_history
         GROUP BY package_name
         ORDER BY change_count DESC
         LIMIT 10`);
            const mostChangedPackages = mostChangedResult.rows.map((row) => ({
                packageName: row.package_name,
                changeCount: parseInt(row.change_count)
            }));
            // recently added packages
            const recentlyAddedResult = await this.pool.queryWithSwag(`SELECT DISTINCT ON (package_name) package_name, timestamp as added_at
         FROM dependency_history
         WHERE event_type = 'added'
         ORDER BY package_name, timestamp DESC
         LIMIT 10`);
            const recentlyAdded = recentlyAddedResult.rows.map((row) => ({
                packageName: row.package_name,
                addedAt: row.timestamp
            }));
            return {
                totalPackages,
                totalChanges,
                mostChangedPackages,
                recentlyAdded
            };
        }
        catch (err) {
            this.stats.errors++;
            logger.error({ err }, 'failed to get package stats');
            throw err;
        }
    }
    /**
     * getStats - returns manager statistics
     */
    getStats() {
        return { ...this.stats };
    }
    /**
     * resetStats - clears statistics
     */
    resetStats() {
        this.stats.recordsStored = 0;
        this.stats.queriesExecuted = 0;
        this.stats.errors = 0;
    }
}
// singleton instance
let managerInstance = null;
export function getDependencyHistoryManager(pool) {
    if (!managerInstance) {
        managerInstance = new DependencyHistoryManager(pool);
    }
    return managerInstance;
}
export function resetDependencyHistoryManager() {
    managerInstance = null;
}
//# sourceMappingURL=dependencyHistory.js.map