/**
 * ProjectContext - Singleton Service for Project Namespacing
 *
 * Provides the current project context for database operations.
 * Handles project path detection and project_id lookup/registration.
 *
 * ISOLATION STRATEGIES:
 *   1. SCHEMA-PER-PROJECT (Primary): Each project gets PostgreSQL schema specmem_{hash}
 *   2. PROJECT_ID COLUMN (Legacy): Adds project_id column for backward compatibility
 *
 * Usage:
 *   const projectContext = getProjectContext();
 *   const projectId = await projectContext.getProjectId();
 *   const projectPath = projectContext.getProjectPath();
 *   const schemaName = projectContext.getSchemaName();  // NEW: Get project schema
 *
 * Project Detection Order:
 *   1. SPECMEM_PROJECT_PATH environment variable
 *   2. Current working directory (process.cwd())
 *   3. Falls back to '/' as root project
 *
 * Race Condition Prevention:
 *   Uses UPSERT (INSERT ... ON CONFLICT DO UPDATE RETURNING id) to ensure
 *   that concurrent processes registering the same project path will all
 *   receive the same UUID without race conditions.
 */
import type { DatabaseManager } from '../database.js';
/**
 * SQL for creating the projects registry table.
 * Exported for use in migrations (I1's task).
 * Uses gen_random_uuid() for UUID generation.
 */
export declare const PROJECTS_TABLE_SQL = "\n-- Projects registry table for project namespacing\nCREATE TABLE IF NOT EXISTS projects (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  path VARCHAR(500) NOT NULL UNIQUE,\n  name VARCHAR(255),\n  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n\n-- Index for fast path lookups\nCREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);\n\n-- Trigger to update updated_at on modification\nCREATE OR REPLACE FUNCTION update_projects_modified_column()\nRETURNS TRIGGER AS $$\nBEGIN\n  NEW.updated_at = NOW();\n  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;\n\nDO $$ BEGIN\n  CREATE TRIGGER projects_updated_at\n    BEFORE UPDATE ON projects\n    FOR EACH ROW\n    EXECUTE FUNCTION update_projects_modified_column();\nEXCEPTION WHEN duplicate_object THEN NULL;\nEND $$;\n";
/**
 * Project registration result
 */
export interface ProjectInfo {
    id: string;
    path: string;
    createdAt: Date;
}
/**
 * PROJECT-SCOPED ProjectContext for managing project namespacing
 * Each project gets its own instance to prevent cross-project data pollution
 */
export declare class ProjectContext {
    private static instancesByProject;
    private db;
    private projectPath;
    private projectId;
    private isInitialized;
    private constructor();
    /**
     * Get the project-scoped instance
     * Each project path gets its own isolated ProjectContext
     *
     * DYNAMIC PATH RESOLUTION:
     * Re-reads SPECMEM_PROJECT_PATH on each call to support MCP servers
     * that need to handle multiple projects without restart.
     *
     * IMPORTANT: When a new project path is encountered, a new instance is created.
     * The database connection is propagated from an existing instance if available.
     */
    static getInstance(): ProjectContext;
    /**
     * Get instance for a specific project path (explicit override)
     * Use this when you know the exact project path and don't want env var lookup
     */
    static getInstanceForProject(projectPath: string): ProjectContext;
    /**
     * Reset current project's instance (for testing)
     */
    static reset(): void;
    /**
     * Reset ALL project instances (for testing/cleanup)
     */
    static resetAll(): void;
    /**
     * Set the database manager (called during app initialization)
     */
    setDatabase(db: DatabaseManager): void;
    /**
     * Get current project path
     */
    getProjectPath(): string;
    /**
     * Get the PostgreSQL schema name for the current project.
     * Format: specmem_{12-char-hash} or specmem_default for root project.
     *
     * This is the PRIMARY isolation mechanism for multi-instance support.
     */
    getSchemaName(): string;
    /**
     * Get full hash of project path for debugging/logging.
     */
    getProjectHash(): string;
    /**
     * Get short 12-char hash of project path (matches schema name suffix).
     */
    getProjectHashShort(): string;
    /**
     * Set project path manually (useful for testing or multi-project scenarios)
     */
    setProjectPath(path: string): void;
    /**
     * Initialize the project context - ensures project is registered in database
     */
    initialize(): Promise<void>;
    /**
     * Ensure the projects registry table exists
     */
    private ensureProjectsTable;
    /**
     * Register a project and return its UUID.
     * Uses UPSERT to prevent race conditions - if two processes try to
     * register the same path simultaneously, both will get the same UUID.
     *
     * @param path - The project path to register (defaults to current project path)
     * @returns Promise<string> - The project UUID
     */
    registerProject(path?: string): Promise<string>;
    /**
     * Get the current project ID. Initializes if needed.
     */
    getProjectId(): Promise<string>;
    /**
     * Check if project context has been initialized
     */
    hasProjectId(): boolean;
    /**
     * Execute a function in the context of a specific project
     */
    withProject<T>(projectPath: string, fn: () => Promise<T>): Promise<T>;
    /**
     * Get all registered projects
     */
    getAllProjects(): Promise<ProjectInfo[]>;
}
/**
 * Get the ProjectContext singleton
 */
export declare function getProjectContext(): ProjectContext;
/**
 * Reset the ProjectContext singleton (for testing)
 */
export declare function resetProjectContext(): void;
/**
 * Initialize ProjectContext with a database manager.
 * Should be called during application startup.
 *
 * @param db - DatabaseManager instance
 * @returns ProjectContext singleton instance
 */
export declare function initializeProjectContext(db: DatabaseManager): ProjectContext;
/**
 * Quick helper to get the current project ID.
 * Requires ProjectContext to be initialized with a database.
 *
 * @returns Promise<string> - The project UUID
 */
export declare function getCurrentProjectId(): Promise<string>;
/**
 * MULTI-PROJECT ISOLATION FIX
 *
 * REMOVED: Marker file /tmp/specmem-current-project.txt
 *
 * The marker file approach caused a race condition when multiple projects
 * ran simultaneously - whichever project's hooks wrote last would "win",
 * causing other projects to read the wrong project path.
 *
 * NOW: Each MCP server instance uses ONLY its SPECMEM_PROJECT_PATH env var,
 * which is set at server startup by bootstrap.cjs and never changes.
 * This ensures TRUE multi-project simultaneous isolation.
 */
/**
 * Quick helper to get the current project path.
 *
 * PROJECT ISOLATION (priority order):
 * 1. SPECMEM_PROJECT_PATH environment variable (set at MCP server start by bootstrap.cjs)
 * 2. process.cwd() as last fallback
 *
 * NOTE: Marker file removed to fix multi-project race condition.
 * Each MCP server instance has its own SPECMEM_PROJECT_PATH set at startup.
 *
 * @returns string - The project path
 */
export declare function getCurrentProjectPath(): string;
/**
 * Helper type for building project-scoped queries
 */
export interface ProjectQueryBuilder {
    conditions: string[];
    params: unknown[];
    paramIndex: number;
}
/**
 * Create a new query builder with project filter pre-applied
 *
 * Uses dynamic project detection via marker file (hooks write, MCP reads)
 *
 * @param columnName - The project_path column name (default: 'project_path')
 * @returns A new ProjectQueryBuilder with project filter
 */
export declare function createProjectQuery(columnName?: string): ProjectQueryBuilder;
/**
 * Add project filter to an existing query context
 *
 * Uses dynamic project detection via marker file (hooks write, MCP reads)
 *
 * @param ctx - The query context to modify
 * @param columnName - The project_path column name (default: 'project_path')
 * @returns The modified context with project filter added
 */
export declare function addProjectFilter(ctx: ProjectQueryBuilder, columnName?: string): ProjectQueryBuilder;
/**
 * Get the project_path value for INSERT operations
 *
 * Uses dynamic project detection via marker file:
 * 1. Hooks receive cwd from Claude Code and write to /tmp/specmem-current-project.txt
 * 2. MCP server reads from marker file to know the CURRENT project
 * 3. This allows TRUE multi-project support without MCP server restart
 *
 * @returns The current project path string (dynamic from marker file or fallback)
 */
export declare function getProjectPathForInsert(): string;
/**
 * Build a WHERE clause fragment for project filtering
 * Use this when you need to inject project filter into existing queries
 *
 * Uses dynamic project detection via marker file (hooks write, MCP reads)
 *
 * @param paramIndex - The parameter index to use ($N)
 * @param columnName - The column name (default: 'project_path')
 * @returns Object with sql fragment, param value, and next index
 */
export declare function buildProjectWhereClause(paramIndex: number, columnName?: string): {
    sql: string;
    param: string;
    nextIndex: number;
};
/**
 * Result type for dynamic project filter building
 */
export interface DynamicProjectFilter {
    /** SQL fragment (e.g., "project_path = $1" or empty string) */
    sql: string;
    /** Parameter value to use (project path, project UUID, or null) */
    param: string | null;
    /** Next available parameter index */
    nextIndex: number;
}
/**
 * Clear the column detection cache.
 * Useful when schema changes during runtime (e.g., migrations).
 */
export declare function clearColumnDetectionCache(): void;
/**
 * Dynamically detect which project column exists in a table.
 *
 * This allows queries to adapt to tables that may have:
 * - project_path (VARCHAR): Simple string path for direct filtering
 * - project_id (UUID): Foreign key reference to projects table
 * - Neither: No project scoping (global table)
 *
 * Results are cached to avoid repeated information_schema queries.
 *
 * @param db - DatabaseManager instance
 * @param tableName - Name of the table to check
 * @returns 'project_path' | 'project_id' | null
 *
 * @example
 * const columnName = await getProjectColumnName(db, 'memories');
 * if (columnName === 'project_path') {
 *   // Use project path directly
 * } else if (columnName === 'project_id') {
 *   // Need to lookup project UUID first
 * } else {
 *   // Table has no project scoping
 * }
 */
export declare function getProjectColumnName(db: DatabaseManager, tableName: string): Promise<'project_path' | 'project_id' | null>;
/**
 * Build a dynamic project filter based on the actual table schema.
 *
 * This function:
 * 1. Detects which project column exists (project_path or project_id)
 * 2. Returns the appropriate SQL fragment and parameter
 * 3. Handles the case where neither column exists (returns empty filter)
 *
 * @param db - DatabaseManager instance
 * @param tableName - Name of the table to query
 * @param paramIndex - Starting parameter index (e.g., 1 for $1)
 * @returns DynamicProjectFilter with sql, param, and nextIndex
 *
 * @example
 * // Building a SELECT query with dynamic project filter
 * const filter = await buildDynamicProjectFilter(db, 'memories', 1);
 *
 * if (filter.sql) {
 *   const sql = `SELECT * FROM memories WHERE ${filter.sql}`;
 *   const result = await db.query(sql, [filter.param]);
 * } else {
 *   // No project filtering needed
 *   const sql = `SELECT * FROM memories`;
 *   const result = await db.query(sql);
 * }
 *
 * @example
 * // Adding to existing WHERE conditions
 * const filter = await buildDynamicProjectFilter(db, 'memories', 3);
 * const sql = `SELECT * FROM memories WHERE importance = $1 AND tags @> $2${filter.sql ? ` AND ${filter.sql}` : ''}`;
 * const params = ['high', ['work'], ...(filter.param ? [filter.param] : [])];
 */
export declare function buildDynamicProjectFilter(db: DatabaseManager, tableName: string, paramIndex: number): Promise<DynamicProjectFilter>;
/**
 * Build a complete WHERE clause with dynamic project filter.
 *
 * Convenience function that handles the common pattern of building
 * a WHERE clause that may or may not need project filtering.
 *
 * @param db - DatabaseManager instance
 * @param tableName - Name of the table to query
 * @param existingConditions - Array of existing WHERE conditions
 * @param existingParams - Array of existing parameters
 * @returns Object with complete whereClause, params array, and nextIndex
 *
 * @example
 * const { whereClause, params, nextIndex } = await buildWhereWithProjectFilter(
 *   db,
 *   'memories',
 *   ['importance = $1', 'memory_type = $2'],
 *   ['high', 'semantic']
 * );
 * const sql = `SELECT * FROM memories ${whereClause}`;
 * // whereClause might be: "WHERE importance = $1 AND memory_type = $2 AND project_path = $3"
 */
export declare function buildWhereWithProjectFilter(db: DatabaseManager, tableName: string, existingConditions?: string[], existingParams?: unknown[]): Promise<{
    whereClause: string;
    params: unknown[];
    nextIndex: number;
}>;
//# sourceMappingURL=ProjectContext.d.ts.map