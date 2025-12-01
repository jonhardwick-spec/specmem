import pg from 'pg';
import { DatabaseConfig, Memory } from './types/index.js';
import { DimensionService } from './services/DimensionService.js';
import { ProjectContext } from './services/ProjectContext.js';
interface PoolStats {
    total: number;
    idle: number;
    waiting: number;
}
/**
 * High-performance PostgreSQL connection manager with intelligent pooling,
 * automatic reconnection, and health monitoring.
 *
 * Now integrated with LWJEB event bus for db:query:start, db:query:complete events
 */
export declare class DatabaseManager {
    private pool;
    private readonly config;
    private isInitialized;
    private healthCheckInterval;
    private queryCounter;
    private dimensionService;
    private currentSchema;
    constructor(config: DatabaseConfig);
    /**
     * TASK #21 FIX: Validate database credentials before attempting connection.
     * Fail fast with clear error message if credentials are invalid.
     */
    private validateCredentialsOrThrow;
    /**
     * Get the current project schema name.
     * Returns null if schema isolation hasn't been initialized yet.
     */
    getCurrentSchema(): string | null;
    /**
     * Get the project schema name for the current project path.
     * Uses SPECMEM_PROJECT_PATH env var or defaults to 'specmem_default'.
     */
    getProjectSchemaName(): string;
    /**
     * Get the DimensionService for this database manager.
     * Lazily initializes the service on first access.
     */
    getDimensionService(): DimensionService;
    /**
     * Get the underlying pg.Pool for direct access
     * Used by team comms and other services that need raw pool access
     */
    getPool(): pg.Pool;
    /**
     * Generate unique query ID for event tracking
     */
    private generateQueryId;
    /**
     * Detect query type from SQL text
     */
    private detectQueryType;
    /**
     * Extract table name from SQL (basic heuristic)
     */
    private extractTableName;
    private createPool;
    private setupPoolEvents;
    initialize(): Promise<void>;
    /**
     * Attempt to automatically fix database permissions.
     * Uses sudo to grant necessary privileges via postgres superuser.
     *
     * This handles the case where specmem was installed but permissions
     * weren't properly set up, or when running multi-project isolation
     * for the first time.
     */
    private autoFixDatabasePermissions;
    /**
     * Initialize project schema isolation.
     * Creates the project-specific schema and sets search_path.
     *
     * This enables multi-instance support where each project has its own
     * isolated set of tables within a PostgreSQL schema.
     */
    private initializeProjectSchemaIsolation;
    /**
     * Ensure search_path is set for a specific connection.
     * CRITICAL: Call this when you need to GUARANTEE schema isolation for a query.
     * The pool.on('connect') handler is fire-and-forget, so this must be called
     * explicitly before any query that requires the correct schema.
     *
     * @param client - Optional pg.PoolClient to set path on, uses pool if not provided
     */
    ensureSearchPath(client?: pg.PoolClient): Promise<void>;
    /**
     * Check if database has been initialized
     * Used by startup timing to avoid double-init
     */
    isConnected(): boolean;
    private ensureExtensions;
    private ensureSchema;
    private startHealthCheck;
    query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
    /**
     * Execute query with GUARANTEED schema isolation.
     * Use this for queries where schema isolation is critical and cannot risk the
     * pool.on('connect') race condition.
     *
     * This acquires a dedicated client, sets search_path, runs the query, and releases.
     * Slightly more expensive than query() but guarantees correct schema.
     */
    safeQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
    transaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T>;
    batchInsert(memories: Array<Omit<Memory, 'id' | 'createdAt' | 'updatedAt' | 'accessCount'>>): Promise<string[]>;
    /**
     * Alter a vector column's dimension dynamically.
     * This will fail if there are existing embeddings with different dimensions.
     *
     * @param tableName - Table containing the vector column
     * @param columnName - Name of the vector column
     * @param dimension - New dimension to set
     */
    alterVectorColumnDimension(tableName: string, columnName: string, dimension: number): Promise<void>;
    getStats(): Promise<PoolStats>;
    /**
     * Get detailed pool metrics for /api/metrics/database endpoint
     */
    getDetailedMetrics(): Promise<{
        pool: PoolStats;
        config: {
            maxConnections: number;
            idleTimeout: number;
            connectionTimeout: number;
        };
        health: {
            isInitialized: boolean;
            queryCount: number;
        };
    }>;
    /**
     * Get the embedding vector dimension for a table.
     * Returns the actual dimension from pg_attribute (atttypmod for pgvector).
     * Returns null if table doesn't exist or doesn't have an embedding column.
     */
    getTableDimension(tableName: string): Promise<number | null>;
    close(): Promise<void>;
    /**
     * Get the ProjectContext singleton for this database manager.
     * Initializes the connection on first access.
     */
    getProjectContext(): ProjectContext;
    /**
     * Execute a query with automatic project_id filtering.
     *
     * Automatically adds project_id filter to WHERE clause:
     * - If SQL has WHERE, adds "AND project_id = $N"
     * - If SQL has no WHERE, adds "WHERE project_id = $N"
     *
     * @param sql - The SQL query (SELECT, UPDATE, or DELETE)
     * @param params - Query parameters (project_id will be appended)
     * @returns Query result with rows filtered by current project
     *
     * @example
     * // Instead of:
     * db.query('SELECT * FROM memories WHERE tags @> $1', [['important']]);
     * // Use:
     * db.queryWithProject('SELECT * FROM memories WHERE tags @> $1', [['important']]);
     * // Becomes: SELECT * FROM memories WHERE tags @> $1 AND project_id = $2
     */
    queryWithProject<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
    /**
     * Insert a record with automatic project_id inclusion.
     *
     * Automatically adds project_id to the insert data.
     *
     * @param table - Table name to insert into
     * @param data - Record data (project_id will be added automatically)
     * @returns The inserted record with generated fields (id, created_at, etc.)
     *
     * @example
     * // Instead of:
     * db.query('INSERT INTO memories (content, tags, project_id) VALUES ($1, $2, $3)', [content, tags, projectId]);
     * // Use:
     * db.insertWithProject('memories', { content, tags });
     */
    insertWithProject<T extends pg.QueryResultRow = pg.QueryResultRow>(table: string, data: Record<string, unknown>): Promise<T>;
    /**
     * Update records with automatic project_id filtering.
     *
     * Ensures updates only affect records in the current project.
     *
     * @param table - Table name to update
     * @param data - Fields to update
     * @param whereClause - Additional WHERE conditions (e.g., "id = $1")
     * @param whereParams - Parameters for the WHERE clause
     * @returns Number of rows affected
     *
     * @example
     * db.updateWithProject('memories', { importance: 'high' }, 'id = $1', [memoryId]);
     */
    updateWithProject(table: string, data: Record<string, unknown>, whereClause: string, whereParams?: unknown[]): Promise<number>;
    /**
     * Delete records with automatic project_id filtering.
     *
     * Ensures deletes only affect records in the current project.
     *
     * @param table - Table name to delete from
     * @param whereClause - WHERE conditions (e.g., "id = $1")
     * @param whereParams - Parameters for the WHERE clause
     * @returns Number of rows deleted
     *
     * @example
     * db.deleteWithProject('memories', 'id = $1', [memoryId]);
     */
    deleteWithProject(table: string, whereClause: string, whereParams?: unknown[]): Promise<number>;
    /**
     * Add project_id filter to a SQL query.
     * Handles both queries with and without existing WHERE clause.
     *
     * @param sql - Original SQL query
     * @param paramIndex - Parameter index to use for project_id
     * @returns Modified SQL with project_id filter
     */
    private addProjectFilter;
}
/**
 * Get the DatabaseManager for the current project.
 *
 * MULTI-PROJECT ISOLATION: Each project gets its own DatabaseManager instance.
 * This prevents cross-project data pollution and ensures proper schema isolation.
 *
 * @param config - DatabaseConfig, required on first call for a project
 * @param projectPath - Optional explicit project path override (mainly for testing)
 * @returns DatabaseManager instance for the current/specified project
 */
export declare function getDatabase(config?: DatabaseConfig, projectPath?: string): DatabaseManager;
/**
 * Reset database instance for the current project.
 * Use for testing or when project context changes.
 *
 * @param projectPath - Optional explicit project path, defaults to current project
 */
export declare function resetDatabase(projectPath?: string): void;
/**
 * Reset ALL database instances across all projects.
 * Use ONLY for testing or complete shutdown scenarios.
 */
export declare function resetAllDatabases(): void;
/**
 * Get count of active database instances.
 * Useful for debugging multi-project scenarios.
 */
export declare function getDatabaseInstanceCount(): number;
/**
 * Get all active project paths with database instances.
 * Useful for debugging and monitoring.
 */
export declare function getActiveDbProjectPaths(): string[];
export {};
//# sourceMappingURL=database.d.ts.map