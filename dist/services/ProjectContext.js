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
import { createHash } from 'crypto';
import { logger } from '../utils/logger.js';
/**
 * SQL for creating the projects registry table.
 * Exported for use in migrations (I1's task).
 * Uses gen_random_uuid() for UUID generation.
 */
export const PROJECTS_TABLE_SQL = `
-- Projects registry table for project namespacing
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path VARCHAR(500) NOT NULL UNIQUE,
  name VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast path lookups
CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);

-- Trigger to update updated_at on modification
CREATE OR REPLACE FUNCTION update_projects_modified_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_projects_modified_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`;
/**
 * PROJECT-SCOPED ProjectContext for managing project namespacing
 * Each project gets its own instance to prevent cross-project data pollution
 */
export class ProjectContext {
    // Project-keyed instances instead of single static instance
    static instancesByProject = new Map();
    db = null;
    projectPath;
    projectId = null;
    isInitialized = false;
    constructor(projectPath) {
        // Store the project path for this instance
        this.projectPath = projectPath;
    }
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
    static getInstance() {
        // MULTI-PROJECT ISOLATION: Use ONLY env var, NOT marker file!
        // Each MCP server instance has SPECMEM_PROJECT_PATH set at startup.
        // Marker file removed to fix race condition with simultaneous projects.
        const envPath = process.env['SPECMEM_PROJECT_PATH'];
        const projectPath = (envPath && envPath.trim().length > 0) ? envPath : (process.cwd() || '/');
        if (!ProjectContext.instancesByProject.has(projectPath)) {
            const newInstance = new ProjectContext(projectPath);
            // REMOVED: Cross-project DB propagation - THIS CAUSED DATA POLLUTION!
            // Each project MUST get its own database connection via setDatabase()
            // The DatabaseManager is now per-project (Map<projectPath, DatabaseManager>)
            // So copying from another project's instance would use the WRONG database!
            // nah fr this was the bug - we were sharing DB connections across projects
            ProjectContext.instancesByProject.set(projectPath, newInstance);
            logger.debug({ projectPath }, 'ProjectContext: Created NEW isolated instance (no DB propagation)');
        }
        return ProjectContext.instancesByProject.get(projectPath);
    }
    /**
     * Get instance for a specific project path (explicit override)
     * Use this when you know the exact project path and don't want env var lookup
     */
    static getInstanceForProject(projectPath) {
        if (!ProjectContext.instancesByProject.has(projectPath)) {
            const newInstance = new ProjectContext(projectPath);
            // REMOVED: Cross-project DB propagation - THIS CAUSED DATA POLLUTION!
            // Each project needs its own database connection from the per-project DatabaseManager
            // bruh don't copy DB from other projects, that's how you get cross-project pollution
            ProjectContext.instancesByProject.set(projectPath, newInstance);
            logger.debug({ projectPath }, 'ProjectContext: Created NEW isolated instance for explicit path');
        }
        return ProjectContext.instancesByProject.get(projectPath);
    }
    /**
     * Reset current project's instance (for testing)
     */
    static reset() {
        const envPath = process.env['SPECMEM_PROJECT_PATH'];
        const projectPath = (envPath && envPath.trim().length > 0) ? envPath : (process.cwd() || '/');
        ProjectContext.instancesByProject.delete(projectPath);
    }
    /**
     * Reset ALL project instances (for testing/cleanup)
     */
    static resetAll() {
        ProjectContext.instancesByProject.clear();
    }
    /**
     * Set the database manager (called during app initialization)
     */
    setDatabase(db) {
        this.db = db;
    }
    /**
     * Get current project path
     */
    getProjectPath() {
        return this.projectPath;
    }
    /**
     * Get the PostgreSQL schema name for the current project.
     * Format: specmem_{12-char-hash} or specmem_default for root project.
     *
     * This is the PRIMARY isolation mechanism for multi-instance support.
     */
    getSchemaName() {
        if (this.projectPath === '/' || this.projectPath === '') {
            return 'specmem_default';
        }
        // Normalize path (remove trailing slashes, lowercase)
        const normalizedPath = this.projectPath.replace(/\/+$/, '').toLowerCase();
        // Generate 12-char SHA256 hash (consistent with bootstrap.cjs and src/constants.ts)
        const hash = createHash('sha256')
            .update(normalizedPath)
            .digest('hex')
            .slice(0, 12);
        return `specmem_${hash}`;
    }
    /**
     * Get full hash of project path for debugging/logging.
     */
    getProjectHash() {
        const normalizedPath = this.projectPath.replace(/\/+$/, '').toLowerCase();
        return createHash('sha256').update(normalizedPath).digest('hex');
    }
    /**
     * Get short 12-char hash of project path (matches schema name suffix).
     */
    getProjectHashShort() {
        return this.getProjectHash().slice(0, 12);
    }
    /**
     * Set project path manually (useful for testing or multi-project scenarios)
     */
    setProjectPath(path) {
        if (path !== this.projectPath) {
            this.projectPath = path;
            this.projectId = null; // Reset cached project ID
            this.isInitialized = false;
        }
    }
    /**
     * Initialize the project context - ensures project is registered in database
     */
    async initialize() {
        if (this.isInitialized && this.projectId) {
            return;
        }
        // registerProject now handles ensureProjectsTable internally
        this.projectId = await this.registerProject(this.projectPath);
        this.isInitialized = true;
        logger.info({ projectPath: this.projectPath, projectId: this.projectId }, 'ProjectContext initialized');
    }
    /**
     * Ensure the projects registry table exists
     */
    async ensureProjectsTable() {
        if (!this.db) {
            throw new Error('ProjectContext: Database not set. Call setDatabase() first.');
        }
        await this.db.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        path VARCHAR(500) NOT NULL UNIQUE,
        name VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
        await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path)
    `);
    }
    /**
     * Register a project and return its UUID.
     * Uses UPSERT to prevent race conditions - if two processes try to
     * register the same path simultaneously, both will get the same UUID.
     *
     * @param path - The project path to register (defaults to current project path)
     * @returns Promise<string> - The project UUID
     */
    async registerProject(path) {
        if (!this.db) {
            throw new Error('ProjectContext: Database not set. Call setDatabase() first.');
        }
        await this.ensureProjectsTable();
        const targetPath = path || this.projectPath;
        // Extract project name from path (last directory component)
        const pathParts = targetPath.split('/').filter(p => p.length > 0);
        const projectName = pathParts.length > 0 ? pathParts[pathParts.length - 1] : 'root';
        // Race-condition-free UPSERT:
        // INSERT ... ON CONFLICT (path) DO UPDATE SET path = EXCLUDED.path RETURNING id
        // The DO UPDATE ensures RETURNING works even on conflict
        const result = await this.db.query(`INSERT INTO projects (path, name)
       VALUES ($1, $2)
       ON CONFLICT (path) DO UPDATE SET
         path = EXCLUDED.path,
         updated_at = NOW()
       RETURNING id`, [targetPath, projectName]);
        if (result.rows.length === 0) {
            throw new Error(`ProjectContext: Failed to register project at ${targetPath}`);
        }
        const projectId = result.rows[0].id;
        logger.debug({ projectPath: targetPath, projectId }, 'ProjectContext: Registered project');
        return projectId;
    }
    /**
     * Get the current project ID. Initializes if needed.
     */
    async getProjectId() {
        if (!this.projectId) {
            await this.initialize();
        }
        return this.projectId;
    }
    /**
     * Check if project context has been initialized
     */
    hasProjectId() {
        return this.projectId !== null;
    }
    /**
     * Execute a function in the context of a specific project
     */
    async withProject(projectPath, fn) {
        const originalPath = this.projectPath;
        const originalId = this.projectId;
        const originalInit = this.isInitialized;
        try {
            this.projectPath = projectPath;
            this.projectId = null;
            this.isInitialized = false;
            await this.initialize();
            return await fn();
        }
        finally {
            this.projectPath = originalPath;
            this.projectId = originalId;
            this.isInitialized = originalInit;
        }
    }
    /**
     * Get all registered projects
     */
    async getAllProjects() {
        if (!this.db) {
            throw new Error('ProjectContext: Database not set. Call setDatabase() first.');
        }
        const result = await this.db.query(`SELECT id, path, created_at FROM projects ORDER BY created_at DESC`);
        return result.rows.map(row => ({
            id: row.id,
            path: row.path,
            createdAt: row.created_at
        }));
    }
}
/**
 * Get the ProjectContext singleton
 */
export function getProjectContext() {
    return ProjectContext.getInstance();
}
/**
 * Reset the ProjectContext singleton (for testing)
 */
export function resetProjectContext() {
    ProjectContext.reset();
}
/**
 * Initialize ProjectContext with a database manager.
 * Should be called during application startup.
 *
 * @param db - DatabaseManager instance
 * @returns ProjectContext singleton instance
 */
export function initializeProjectContext(db) {
    const ctx = getProjectContext();
    ctx.setDatabase(db);
    return ctx;
}
/**
 * Quick helper to get the current project ID.
 * Requires ProjectContext to be initialized with a database.
 *
 * @returns Promise<string> - The project UUID
 */
export async function getCurrentProjectId() {
    return getProjectContext().getProjectId();
}
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
export function getCurrentProjectPath() {
    // PRIORITY 1: Environment variable (set per MCP server instance)
    if (process.env['SPECMEM_PROJECT_PATH']) {
        return process.env['SPECMEM_PROJECT_PATH'];
    }
    // PRIORITY 2: Current working directory
    return process.cwd() || '/';
}
/**
 * Create a new query builder with project filter pre-applied
 *
 * Uses dynamic project detection via marker file (hooks write, MCP reads)
 *
 * @param columnName - The project_path column name (default: 'project_path')
 * @returns A new ProjectQueryBuilder with project filter
 */
export function createProjectQuery(columnName = 'project_path') {
    // Use dynamic project detection
    const projectPath = getCurrentProjectPath();
    return {
        conditions: [`${columnName} = $1`],
        params: [projectPath],
        paramIndex: 2
    };
}
/**
 * Add project filter to an existing query context
 *
 * Uses dynamic project detection via marker file (hooks write, MCP reads)
 *
 * @param ctx - The query context to modify
 * @param columnName - The project_path column name (default: 'project_path')
 * @returns The modified context with project filter added
 */
export function addProjectFilter(ctx, columnName = 'project_path') {
    // Use dynamic project detection
    const projectPath = getCurrentProjectPath();
    ctx.conditions.push(`${columnName} = $${ctx.paramIndex}`);
    ctx.params.push(projectPath);
    ctx.paramIndex++;
    return ctx;
}
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
export function getProjectPathForInsert() {
    // Use dynamic project detection
    return getCurrentProjectPath();
}
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
export function buildProjectWhereClause(paramIndex, columnName = 'project_path') {
    // Use dynamic project detection
    const projectPath = getCurrentProjectPath();
    return {
        sql: `${columnName} = $${paramIndex}`,
        param: projectPath,
        nextIndex: paramIndex + 1
    };
}
/**
 * PROJECT-SCOPED Cache for column detection results to avoid repeated schema queries.
 * Key: project path -> Map(tableName, detected column name or null)
 * Prevents cross-project cache pollution
 */
const columnDetectionCacheByProject = new Map();
/**
 * Get current project path for cache scoping
 */
function getCacheProjectPath() {
    const envPath = process.env['SPECMEM_PROJECT_PATH'];
    return (envPath && envPath.trim().length > 0) ? envPath : process.cwd();
}
/**
 * Get project-scoped column detection cache
 */
function getColumnDetectionCache() {
    const projectPath = getCacheProjectPath();
    if (!columnDetectionCacheByProject.has(projectPath)) {
        columnDetectionCacheByProject.set(projectPath, new Map());
    }
    return columnDetectionCacheByProject.get(projectPath);
}
// Legacy reference for backwards compatibility
const columnDetectionCache = {
    get(key) { return getColumnDetectionCache().get(key); },
    set(key, value) { getColumnDetectionCache().set(key, value); },
    clear() { getColumnDetectionCache().clear(); },
    has(key) { return getColumnDetectionCache().has(key); }
};
/**
 * Clear the column detection cache.
 * Useful when schema changes during runtime (e.g., migrations).
 */
export function clearColumnDetectionCache() {
    getColumnDetectionCache().clear();
    logger.debug('Cleared column detection cache');
}
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
export async function getProjectColumnName(db, tableName) {
    // Check cache first
    if (columnDetectionCache.has(tableName)) {
        const cached = columnDetectionCache.get(tableName);
        logger.debug({ tableName, cached }, 'Using cached column detection result');
        return cached;
    }
    try {
        // Get current project schema name
        const schemaName = db.getProjectSchemaName();
        // Query information_schema to find which columns exist
        // Check for both project_path and project_id in a single query
        const result = await db.query(`SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name = $2
         AND column_name IN ('project_path', 'project_id')
       ORDER BY
         CASE column_name
           WHEN 'project_path' THEN 1
           WHEN 'project_id' THEN 2
         END`, [schemaName, tableName]);
        let detected = null;
        if (result.rows.length > 0) {
            // Prefer project_path for simpler queries (it comes first due to ORDER BY)
            const firstColumn = result.rows[0].column_name;
            if (firstColumn === 'project_path' || firstColumn === 'project_id') {
                detected = firstColumn;
            }
        }
        // Cache the result
        columnDetectionCache.set(tableName, detected);
        logger.debug({
            tableName,
            detected,
            allColumns: result.rows.map(r => r.column_name)
        }, 'Detected project column');
        return detected;
    }
    catch (error) {
        logger.error({ error, tableName }, 'Failed to detect project column');
        // On error, don't cache - allow retry
        return null;
    }
}
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
export async function buildDynamicProjectFilter(db, tableName, paramIndex) {
    const columnName = await getProjectColumnName(db, tableName);
    if (!columnName) {
        // No project column - return empty filter
        logger.debug({ tableName }, 'No project column found, returning empty filter');
        return {
            sql: '',
            param: null,
            nextIndex: paramIndex
        };
    }
    if (columnName === 'project_path') {
        // Use dynamic project detection via marker file
        const projectPath = getCurrentProjectPath();
        return {
            sql: `${columnName} = $${paramIndex}`,
            param: projectPath,
            nextIndex: paramIndex + 1
        };
    }
    else if (columnName === 'project_id') {
        // Need project UUID - this requires the DB to be set on ProjectContext
        // Note: project_id lookups still use ProjectContext since they need DB access
        try {
            const projectContext = getProjectContext();
            projectContext.setDatabase(db);
            const projectId = await projectContext.getProjectId();
            return {
                sql: `${columnName} = $${paramIndex}`,
                param: projectId,
                nextIndex: paramIndex + 1
            };
        }
        catch (error) {
            logger.warn({ error, tableName }, 'Failed to get project ID, returning empty filter');
            return {
                sql: '',
                param: null,
                nextIndex: paramIndex
            };
        }
    }
    // Fallback (shouldn't reach here)
    return {
        sql: '',
        param: null,
        nextIndex: paramIndex
    };
}
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
export async function buildWhereWithProjectFilter(db, tableName, existingConditions = [], existingParams = []) {
    const nextParamIndex = existingParams.length + 1;
    const filter = await buildDynamicProjectFilter(db, tableName, nextParamIndex);
    const allConditions = [...existingConditions];
    const allParams = [...existingParams];
    if (filter.sql) {
        allConditions.push(filter.sql);
        allParams.push(filter.param);
    }
    const whereClause = allConditions.length > 0
        ? `WHERE ${allConditions.join(' AND ')}`
        : '';
    return {
        whereClause,
        params: allParams,
        nextIndex: filter.nextIndex
    };
}
//# sourceMappingURL=ProjectContext.js.map