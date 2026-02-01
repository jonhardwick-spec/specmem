/**
 * Project Namespacing Migration
 *
 * Adds project_id column to all data tables for multi-project isolation.
 * Uses UPSERT pattern for race-condition-free project registration.
 *
 * Enhanced with SCHEMA-PER-PROJECT isolation:
 * - Each project gets its own PostgreSQL schema: specmem_{8-char-hash}
 * - All tables are created within the project schema
 * - Queries use SET search_path for automatic table resolution
 *
 * Migration version: 29.1
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { logger } from '../utils/logger.js';
// MED-17 FIX: Thread-safe mutex for search_path hook registration
// Prevents race condition where multiple concurrent calls could register duplicate hooks
const searchPathHookLocks = new Map();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ============================================================================
// SCHEMA-PER-PROJECT ISOLATION (READABLE!)
// ============================================================================
/**
 * Validate schema name matches expected pattern to prevent SQL injection.
 * Schema names must be specmem_ followed by alphanumeric/underscore chars.
 * HIGH-32 FIX: Strict validation before any DDL operations
 */
function validateSchemaName(schemaName) {
    if (!/^specmem_[a-z0-9_]+$/i.test(schemaName)) {
        throw new Error('Invalid schema name format - must be specmem_ followed by alphanumeric/underscore chars');
    }
    if (schemaName.length > 63) {
        throw new Error('Schema name too long - PostgreSQL limit is 63 characters');
    }
}
/**
 * Validate table name matches expected pattern to prevent SQL injection.
 * Table names must be alphanumeric/underscore only.
 * HIGH-32 FIX: Strict validation before any DDL operations
 */
function validateTableName(tableName) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(tableName)) {
        throw new Error('Invalid table name format - must start with letter/underscore, contain only alphanumeric/underscore');
    }
    if (tableName.length > 63) {
        throw new Error('Table name too long - PostgreSQL limit is 63 characters');
    }
}
/**
 * Get the sanitized project directory name for schema naming.
 * Uses SPECMEM_PROJECT_DIR_NAME env var (set by bootstrap.cjs),
 * or derives from project path if not set.
 * This is MUCH more readable than hashes! e.g., "myproject" not "a1b2c3d4"
 */
function getProjectDirName(projectPath) {
    // Use pre-computed dir name from bootstrap.cjs if available
    const envDirName = process.env['SPECMEM_PROJECT_DIR_NAME'];
    if (envDirName && !projectPath) {
        return envDirName;
    }
    const pathToUse = projectPath || process.env['SPECMEM_PROJECT_PATH'] || '/';
    // Handle default/fallback case
    if (pathToUse === '/' || pathToUse === '') {
        return 'default';
    }
    // Derive from path - sanitize to PostgreSQL-safe name
    const dirName = path.basename(pathToUse)
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_') // PostgreSQL identifiers use underscores
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '') || 'default';
    return dirName;
}
/**
 * Generate the PostgreSQL schema name for a project.
 * Uses SPECMEM_PROJECT_DIR_NAME env var (set by bootstrap.cjs),
 * or derives from project path if not set.
 *
 * Format: specmem_{dirname} (READABLE!)
 * Example: specmem_myproject
 *
 * @param projectPath - The project path (or undefined for default)
 * @returns Schema name string
 */
export function getProjectSchema(projectPath) {
    const dirName = getProjectDirName(projectPath);
    return `specmem_${dirName}`;
}
/**
 * Generate the full hash for a project path.
 * Used for detailed logging and debugging.
 *
 * @param projectPath - The project path
 * @returns Full SHA256 hash (64 chars)
 */
export function getProjectHashFull(projectPath) {
    const normalizedPath = projectPath.replace(/\/+$/, '').toLowerCase();
    return createHash('sha256').update(normalizedPath).digest('hex');
}
/**
 * Create a project schema if it doesn't exist.
 * Also sets up the search_path to include the new schema.
 *
 * @param db - DatabaseManager instance
 * @param schemaName - Schema name to create (from getProjectSchema)
 * @returns True if schema was created, false if already existed
 */
export async function createProjectSchema(db, schemaName) {
    // HIGH-32 FIX: Validate schema name before any SQL operations
    validateSchemaName(schemaName);
    logger.info({ schemaName }, 'Creating project schema if not exists');
    try {
        // Check if schema exists
        const checkResult = await db.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name = $1
    `, [schemaName]);
        if (checkResult.rows.length > 0) {
            logger.debug({ schemaName }, 'Schema already exists');
            return false;
        }
        // HIGH-32 FIX: Use format() with %I for safe identifier quoting
        const formatResult = await db.query(`SELECT format('CREATE SCHEMA IF NOT EXISTS %I', $1) as sql`, [schemaName]);
        await db.query(formatResult.rows[0].sql);
        logger.info({ schemaName }, 'Created new project schema');
        return true;
    }
    catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error({ error: errMsg, schemaName }, 'Failed to create project schema');
        throw error;
    }
}
/**
 * Set the search_path POOL-WIDE for a database connection to use a project schema.
 * The search_path is set to: specmem_{dirname}, public
 *
 * POOL-WIDE APPROACH:
 * - Sets search_path on the current connection
 * - Registers a connect hook on the pool so NEW connections also get the search_path
 * - This ensures ALL pool connections use the same project schema
 *
 * This ensures:
 * 1. Tables are looked up first in the project schema
 * 2. Falls back to public schema for shared tables/extensions
 * 3. Works for all connections in the pool (not just one!)
 *
 * @param db - DatabaseManager instance
 * @param schemaName - Schema name to set as primary
 */
export async function setProjectSearchPath(db, schemaName) {
    // HIGH-32 FIX: Validate schema name before any SQL operations
    validateSchemaName(schemaName);
    const pool = db.getPool();
    // HIGH-19 FIX: Wrap initial query in try-catch with proper pool cleanup on failure
    // If search_path fails, we MUST clean up the pool to prevent lingering connections
    try {
        // HIGH-32 FIX: Use format() with %I for safe identifier quoting
        // Cast $1 to text explicitly so PostgreSQL knows the type
        const formatResult = await db.query(`SELECT format('SET search_path TO %I, public', $1::text) as sql`, [schemaName]);
        await db.query(formatResult.rows[0].sql);
    }
    catch (error) {
        // nah fr this is cooked - clean up the pool before re-throwing
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error({ error: errMsg, schemaName }, 'search_path query failed - cleaning up pool to prevent lingering connections');
        try {
            await pool.end();
            logger.info({ schemaName }, 'Pool ended after search_path failure');
        }
        catch (endErr) {
            logger.warn({ endErr }, 'pool.end() also failed but we tried fr');
        }
        throw error;
    }
    // MED-17 FIX: Thread-safe hook registration using async mutex pattern
    // Wait for any existing registration to complete first
    const existingLock = searchPathHookLocks.get(pool);
    if (existingLock) {
        await existingLock;
    }
    // nah fr we need to make sure this only runs once per pool
    // Check if we already registered by looking for our marker
    const hookMarker = '_specmemSearchPathHookRegistered';
    // MED-17 FIX: Synchronous marker check + set to prevent race window
    // The issue was: check -> (race) -> set. Now it's atomic read-then-write
    if (!pool[hookMarker]) {
        // Set marker IMMEDIATELY before async work to prevent duplicate registration
        pool[hookMarker] = schemaName;
        // Create a lock promise for concurrent calls
        let resolveLock;
        const lockPromise = new Promise((resolve) => {
            resolveLock = resolve;
        });
        searchPathHookLocks.set(pool, lockPromise);
        try {
            pool.on('connect', async (client) => {
                // Set search_path on every new connection
                try {
                    // HIGH-32 FIX: Use format() with %I for safe identifier quoting
                    const formatResult = await client.query(`SELECT format('SET search_path TO %I, public', $1) as sql`, [schemaName]);
                    await client.query(formatResult.rows[0].sql);
                    logger.debug({ schemaName }, 'Set search_path on new pool connection');
                }
                catch (error) {
                    // HIGH-19 FIX: Log error with more context but don't crash
                    // The connection is managed by the pool - it will handle release
                    const errMsg = error instanceof Error ? error.message : String(error);
                    logger.warn({ error: errMsg, schemaName }, 'Failed to set search_path on new pool connection - connection will be reused but may have wrong schema');
                }
            });
            logger.info({ schemaName }, 'Registered POOL-WIDE search_path hook for project schema');
        }
        finally {
            // Release the lock
            resolveLock();
            searchPathHookLocks.delete(pool);
        }
    }
    else {
        // Hook already registered - verify it's for the same schema
        const registeredSchema = pool[hookMarker];
        if (registeredSchema !== schemaName) {
            logger.warn({
                currentSchema: schemaName,
                registeredSchema
            }, 'search_path hook registered for different schema - may cause isolation issues');
        }
    }
    logger.debug({ schemaName }, 'Set search_path for project schema (pool-wide)');
}
/**
 * Initialize project schema with all required tables.
 * Creates the schema and runs table creation within that schema context.
 *
 * @param db - DatabaseManager instance
 * @param projectPath - Project path (uses env var if not provided)
 * @returns Schema name that was initialized
 */
export async function initializeProjectSchema(db, projectPath) {
    const schemaName = getProjectSchema(projectPath);
    logger.info({
        schemaName,
        projectPath: projectPath || process.env['SPECMEM_PROJECT_PATH'] || 'default'
    }, 'Initializing project schema');
    // Create schema if needed
    await createProjectSchema(db, schemaName);
    // Set search path for subsequent operations
    await setProjectSearchPath(db, schemaName);
    // Run schema initialization SQL - CRITICAL for table creation
    const sqlPath = path.join(__dirname, 'projectSchemaInit.sql');
    try {
        const schemaInitSql = await fs.readFile(sqlPath, 'utf-8');
        await db.query(schemaInitSql);
        logger.info({ schemaName, sqlPath }, 'Project schema tables initialized from SQL file');
    }
    catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        // Only ignore ENOENT (file not found) if tables already exist
        if (errMsg.includes('ENOENT')) {
            logger.warn({ sqlPath, error: errMsg }, 'Schema init SQL not found - verify build copied SQL files to dist/');
        }
        else {
            // Re-throw actual SQL errors
            logger.error({ error: errMsg, sqlPath }, 'Failed to initialize schema tables');
            throw error;
        }
    }
    return schemaName;
}
// ============================================================================
// MED-42 FIX: Schema Validation Before Operations
// ============================================================================
// Track schema readiness per-project to avoid redundant DB checks
// goated O(1) lookup for whether schema/tables are ready
const schemaReadyCache = new Map();
/**
 * Check if schema exists in the database.
 * Pure existence check - no creation, no side effects.
 *
 * @param db - DatabaseManager instance
 * @param schemaName - Schema name to check
 * @returns True if schema exists, false otherwise
 */
export async function schemaExists(db, schemaName) {
    try {
        const checkResult = await db.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name = $1
    `, [schemaName]);
        return checkResult.rows.length > 0;
    }
    catch (error) {
        logger.warn({ error, schemaName }, 'schemaExists check failed');
        return false;
    }
}
/**
 * Check if a table exists in the specified schema.
 * Pure existence check - no creation, no side effects.
 *
 * @param db - DatabaseManager instance
 * @param schemaName - Schema name
 * @param tableName - Table name to check
 * @returns True if table exists, false otherwise
 */
export async function tableExists(db, schemaName, tableName) {
    try {
        const result = await db.query(`
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = $2
    `, [schemaName, tableName]);
        return result.rows.length > 0;
    }
    catch (error) {
        logger.warn({ error, schemaName, tableName }, 'tableExists check failed');
        return false;
    }
}
/**
 * Ensure schema and core tables are ready for operations.
 * This is the VALIDATION function - call before ops that need the schema.
 *
 * MED-42 FIX: Does NOT create anything - just validates and throws if not ready.
 * Use ensureSchemaInitialized() if you need auto-creation.
 *
 * @param db - DatabaseManager instance
 * @param projectPath - Optional project path, uses env var if not provided
 * @throws Error if schema or required tables don't exist
 */
export async function ensureSchemaReady(db, projectPath) {
    const schemaName = getProjectSchema(projectPath);
    // O(1) cache check first - avoids redundant DB queries
    if (schemaReadyCache.get(schemaName)) {
        return;
    }
    const exists = await schemaExists(db, schemaName);
    if (!exists) {
        throw new Error(`Schema '${schemaName}' does not exist. Initialize database first.`);
    }
    // Check core table exists (memories is the primary table)
    const hasMemories = await tableExists(db, schemaName, 'memories');
    if (!hasMemories) {
        throw new Error(`Table 'memories' does not exist in schema '${schemaName}'. Run migrations first.`);
    }
    // Cache the ready state so we dont hit DB every time
    schemaReadyCache.set(schemaName, true);
    logger.debug({ schemaName }, 'Schema validated and cached as ready');
}
/**
 * Ensure schema and tables are initialized - creates if missing.
 * This is the AUTO-CREATION function - use when you want schema setup.
 *
 * MED-42 FIX: Validates first, creates if needed, then validates again.
 *
 * @param db - DatabaseManager instance
 * @param projectPath - Optional project path
 * @returns Schema name that was initialized
 */
export async function ensureSchemaInitialized(db, projectPath) {
    const schemaName = getProjectSchema(projectPath);
    // Quick cache check
    if (schemaReadyCache.get(schemaName)) {
        return schemaName;
    }
    // Check if schema exists
    const exists = await schemaExists(db, schemaName);
    if (!exists) {
        logger.info({ schemaName }, 'Schema missing - creating...');
        await createProjectSchema(db, schemaName);
    }
    // Set search path so tables are created in the right schema
    await setProjectSearchPath(db, schemaName);
    // Check if tables exist
    const hasMemories = await tableExists(db, schemaName, 'memories');
    if (!hasMemories) {
        logger.info({ schemaName }, 'Tables missing - initializing...');
        await initializeProjectSchema(db, projectPath);
    }
    // Mark as ready
    schemaReadyCache.set(schemaName, true);
    logger.info({ schemaName }, 'Schema validated/initialized and ready');
    return schemaName;
}
/**
 * Invalidate schema cache for a project.
 * Call after schema changes (drop, recreate, etc).
 *
 * @param projectPath - Optional project path, invalidates all if not provided
 */
export function invalidateSchemaCache(projectPath) {
    if (projectPath) {
        const schemaName = getProjectSchema(projectPath);
        schemaReadyCache.delete(schemaName);
        logger.debug({ schemaName }, 'Schema cache invalidated');
    }
    else {
        schemaReadyCache.clear();
        logger.debug('All schema caches invalidated');
    }
}
/**
 * Check if schema is cached as ready (without DB check).
 * Useful for fast checks in hot paths.
 *
 * @param projectPath - Optional project path
 * @returns True if cached as ready, false otherwise
 */
export function isSchemaReadyCached(projectPath) {
    const schemaName = getProjectSchema(projectPath);
    return schemaReadyCache.get(schemaName) ?? false;
}
// ============================================================================
// END MED-42 FIX
// ============================================================================
/**
 * Get all project schemas in the database.
 * Useful for cleanup, debugging, and multi-project management.
 *
 * @param db - DatabaseManager instance
 * @returns Array of schema names matching specmem_* pattern
 */
export async function listProjectSchemas(db) {
    const result = await db.query(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'specmem_%'
    ORDER BY schema_name
  `);
    return result.rows.map((row) => row.schema_name);
}
/**
 * Drop a project schema and all its contents.
 * CAUTION: This is destructive and cannot be undone!
 *
 * @param db - DatabaseManager instance
 * @param schemaName - Schema to drop
 * @param confirm - Must be true to actually drop
 */
export async function dropProjectSchema(db, schemaName, confirm = false) {
    if (!confirm) {
        throw new Error('Must set confirm=true to drop a project schema');
    }
    // HIGH-32 FIX: Validate schema name before any SQL operations
    validateSchemaName(schemaName);
    logger.warn({ schemaName }, 'Dropping project schema and all contents');
    // HIGH-32 FIX: Use format() with %I for safe identifier quoting
    const formatResult = await db.query(`SELECT format('DROP SCHEMA IF EXISTS %I CASCADE', $1) as sql`, [schemaName]);
    await db.query(formatResult.rows[0].sql);
    // MED-42 FIX: Invalidate cache since schema is gone
    schemaReadyCache.delete(schemaName);
    logger.info({ schemaName }, 'Project schema dropped');
}
// Default project UUID for backfilling existing data
export const DEFAULT_PROJECT_ID = '00000000-0000-0000-0000-000000000000';
export const DEFAULT_PROJECT_PATH = '/';
/**
 * Run the project namespacing migration.
 *
 * This migration:
 * 1. Creates the `projects` registry table
 * 2. Adds `project_id` column to all data tables
 * 3. Creates indexes for efficient project-scoped queries
 * 4. Backfills existing data to the default project
 *
 * Safe to run multiple times (idempotent).
 *
 * @param db - DatabaseManager instance
 * @returns Migration result summary
 */
export async function runProjectNamespacingMigration(db) {
    const startTime = Date.now();
    const result = {
        success: false,
        projectsTableCreated: false,
        columnsAdded: [],
        indexesCreated: [],
        backfillResults: [],
        errors: [],
        durationMs: 0
    };
    logger.info('Starting project namespacing migration (version 29)');
    try {
        // Read and execute the SQL migration file
        const sqlPath = path.join(__dirname, 'projectNamespacing.sql');
        const sql = await fs.readFile(sqlPath, 'utf-8');
        // Execute the full SQL script
        await db.query(sql);
        logger.info('SQL migration executed successfully');
        result.projectsTableCreated = true;
        // Verify tables were modified by checking for project_id columns
        const verifyResult = await verifyMigration(db);
        result.columnsAdded = verifyResult.tablesWithProjectId;
        result.indexesCreated = verifyResult.indexes;
        // Get backfill results
        result.backfillResults = await getBackfillStats(db);
        result.success = true;
        logger.info({
            columnsAdded: result.columnsAdded.length,
            indexesCreated: result.indexesCreated.length,
            backfillResults: result.backfillResults
        }, 'Project namespacing migration completed successfully');
    }
    catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(errMsg);
        logger.error({ error: errMsg }, 'Project namespacing migration failed');
    }
    result.durationMs = Date.now() - startTime;
    return result;
}
/**
 * Run migration by reading individual SQL statements.
 * Use this if the full script execution fails.
 *
 * @param db - DatabaseManager instance
 */
export async function runProjectNamespacingMigrationStepwise(db) {
    const startTime = Date.now();
    const result = {
        success: false,
        projectsTableCreated: false,
        columnsAdded: [],
        indexesCreated: [],
        backfillResults: [],
        errors: [],
        durationMs: 0
    };
    logger.info('Starting stepwise project namespacing migration');
    try {
        // Step 1: Create projects table
        await createProjectsTable(db);
        result.projectsTableCreated = true;
        // Step 2: Insert default project
        await insertDefaultProject(db);
        // Step 3: Add project_id to each table
        const tables = [
            'memories',
            'codebase_files',
            'code_definitions',
            'code_dependencies',
            'codebase_pointers',
            'team_messages',
            'task_claims',
            'team_channels'
        ];
        for (const table of tables) {
            try {
                await addProjectIdColumn(db, table);
                result.columnsAdded.push(table);
            }
            catch (error) {
                // Table might not exist (e.g., team_channels)
                const errMsg = error instanceof Error ? error.message : String(error);
                if (!errMsg.includes('does not exist') && !errMsg.includes('undefined_table')) {
                    result.errors.push(`${table}: ${errMsg}`);
                }
            }
        }
        // Step 4: Create indexes
        const indexResults = await createProjectIndexes(db);
        result.indexesCreated = indexResults;
        // Step 5: Create helper functions
        await createHelperFunctions(db);
        // Step 6: Run backfill
        result.backfillResults = await runBackfill(db);
        result.success = result.errors.length === 0;
        logger.info({
            columnsAdded: result.columnsAdded,
            errors: result.errors
        }, 'Stepwise migration completed');
    }
    catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(errMsg);
        logger.error({ error: errMsg }, 'Stepwise migration failed');
    }
    result.durationMs = Date.now() - startTime;
    return result;
}
/**
 * Create the projects registry table.
 */
async function createProjectsTable(db) {
    await db.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      path VARCHAR(500) NOT NULL UNIQUE,
      name VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at)`);
}
/**
 * Insert the default project for backfilling.
 */
async function insertDefaultProject(db) {
    await db.query(`
    INSERT INTO projects (id, path, name, created_at, last_accessed_at)
    VALUES ($1, $2, $3, NOW(), NOW())
    ON CONFLICT (path) DO NOTHING
  `, [DEFAULT_PROJECT_ID, DEFAULT_PROJECT_PATH, 'Default Project']);
}
/**
 * Add project_id column to a table with foreign key constraint.
 */
async function addProjectIdColumn(db, tableName) {
    // HIGH-32 FIX: Validate table name before any SQL operations
    validateTableName(tableName);
    // HIGH-32 FIX: Use format() with %I for safe identifier quoting
    // Add column
    const addColResult = await db.query(`SELECT format(
      'DO $$ BEGIN ALTER TABLE %I ADD COLUMN IF NOT EXISTS project_id UUID DEFAULT %L::uuid; EXCEPTION WHEN duplicate_column THEN NULL; END $$',
      $1, $2
    ) as sql`, [tableName, DEFAULT_PROJECT_ID]);
    await db.query(addColResult.rows[0].sql);
    // Add foreign key (if not exists)
    const constraintName = 'fk_' + tableName + '_project_id';
    const addFkResult = await db.query(`SELECT format(
      'DO $$ BEGIN ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET DEFAULT; EXCEPTION WHEN duplicate_object THEN NULL; END $$',
      $1, $2
    ) as sql`, [tableName, constraintName]);
    await db.query(addFkResult.rows[0].sql);
}
/**
 * Create indexes for project_id columns.
 */
async function createProjectIndexes(db) {
    const indexes = [];
    const indexStatements = [
        { name: 'idx_memories_project_id', sql: 'CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id)' },
        { name: 'idx_memories_project_created', sql: 'CREATE INDEX IF NOT EXISTS idx_memories_project_created ON memories(project_id, created_at DESC)' },
        { name: 'idx_memories_project_importance', sql: 'CREATE INDEX IF NOT EXISTS idx_memories_project_importance ON memories(project_id, importance)' },
        { name: 'idx_codebase_files_project_id', sql: 'CREATE INDEX IF NOT EXISTS idx_codebase_files_project_id ON codebase_files(project_id)' },
        { name: 'idx_codebase_files_project_path', sql: 'CREATE INDEX IF NOT EXISTS idx_codebase_files_project_path ON codebase_files(project_id, file_path)' },
        { name: 'idx_code_definitions_project_id', sql: 'CREATE INDEX IF NOT EXISTS idx_code_definitions_project_id ON code_definitions(project_id)' },
        { name: 'idx_code_definitions_project_name', sql: 'CREATE INDEX IF NOT EXISTS idx_code_definitions_project_name ON code_definitions(project_id, name)' },
        { name: 'idx_code_dependencies_project_id', sql: 'CREATE INDEX IF NOT EXISTS idx_code_dependencies_project_id ON code_dependencies(project_id)' },
        { name: 'idx_codebase_pointers_project_id', sql: 'CREATE INDEX IF NOT EXISTS idx_codebase_pointers_project_id ON codebase_pointers(project_id)' },
        { name: 'idx_team_messages_project_id', sql: 'CREATE INDEX IF NOT EXISTS idx_team_messages_project_id ON team_messages(project_id)' },
        { name: 'idx_team_messages_project_channel', sql: 'CREATE INDEX IF NOT EXISTS idx_team_messages_project_channel ON team_messages(project_id, channel_id, created_at DESC)' },
        { name: 'idx_task_claims_project_id', sql: 'CREATE INDEX IF NOT EXISTS idx_task_claims_project_id ON task_claims(project_id)' },
        { name: 'idx_task_claims_project_status', sql: 'CREATE INDEX IF NOT EXISTS idx_task_claims_project_status ON task_claims(project_id, status)' }
    ];
    for (const { name, sql } of indexStatements) {
        try {
            await db.query(sql);
            indexes.push(name);
        }
        catch (error) {
            // Index might fail if table doesn't exist, that's ok
            logger.debug({ index: name, error }, 'Index creation skipped');
        }
    }
    return indexes;
}
/**
 * Create helper SQL functions for project registration.
 */
async function createHelperFunctions(db) {
    // register_project function with UPSERT
    await db.query(`
    CREATE OR REPLACE FUNCTION register_project(
      p_path VARCHAR(500),
      p_name VARCHAR(255) DEFAULT NULL
    )
    RETURNS UUID AS $$
    DECLARE
      v_project_id UUID;
    BEGIN
      INSERT INTO projects (path, name)
      VALUES (p_path, COALESCE(p_name, p_path))
      ON CONFLICT (path) DO UPDATE SET
        last_accessed_at = NOW(),
        name = COALESCE(EXCLUDED.name, projects.name)
      RETURNING id INTO v_project_id;

      RETURN v_project_id;
    END;
    $$ LANGUAGE plpgsql
  `);
    // get_project_id function
    await db.query(`
    CREATE OR REPLACE FUNCTION get_project_id(p_path VARCHAR(500))
    RETURNS UUID AS $$
    DECLARE
      v_project_id UUID;
    BEGIN
      SELECT id INTO v_project_id
      FROM projects
      WHERE path = p_path;

      IF v_project_id IS NULL THEN
        v_project_id := register_project(p_path);
      ELSE
        UPDATE projects SET last_accessed_at = NOW() WHERE id = v_project_id;
      END IF;

      RETURN v_project_id;
    END;
    $$ LANGUAGE plpgsql
  `);
}
/**
 * Run backfill to assign existing data to default project.
 */
async function runBackfill(db) {
    const results = [];
    const tables = [
        'memories',
        'codebase_files',
        'code_definitions',
        'code_dependencies',
        'codebase_pointers',
        'team_messages',
        'task_claims',
        'team_channels'
    ];
    for (const table of tables) {
        try {
            // HIGH-32 FIX: Validate table name before any SQL operations
            validateTableName(table);
            // HIGH-32 FIX: Use format() with %I for safe identifier quoting
            const formatResult = await db.query(`SELECT format('UPDATE %I SET project_id = $1 WHERE project_id IS NULL', $1) as sql`, [table]);
            const result = await db.query(formatResult.rows[0].sql, [DEFAULT_PROJECT_ID]);
            results.push({
                tableName: table,
                rowsUpdated: result.rowCount ?? 0
            });
        }
        catch (error) {
            // Table might not exist
            logger.debug({ table, error }, 'Backfill skipped for table');
        }
    }
    return results;
}
/**
 * Verify migration by checking for project_id columns.
 */
async function verifyMigration(db) {
    // Get current project schema name
    const schemaName = db.getProjectSchemaName();
    // Check which tables have project_id column in the project schema
    const columnCheck = await db.query(`
    SELECT table_name
    FROM information_schema.columns
    WHERE column_name = 'project_id'
    AND table_schema = $1
    ORDER BY table_name
  `, [schemaName]);
    const tablesWithProjectId = columnCheck.rows.map((row) => row.table_name);
    // Check for project-related indexes in the project schema
    const indexCheck = await db.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE indexname LIKE '%project%'
    AND schemaname = $1
    ORDER BY indexname
  `, [schemaName]);
    const indexes = indexCheck.rows.map((row) => row.indexname);
    return { tablesWithProjectId, indexes };
}
/**
 * Get current backfill statistics (how many rows per table have default project).
 */
async function getBackfillStats(db) {
    const results = [];
    const tables = [
        'memories',
        'codebase_files',
        'code_definitions',
        'code_dependencies',
        'codebase_pointers',
        'team_messages',
        'task_claims'
    ];
    for (const table of tables) {
        try {
            // HIGH-32 FIX: Validate table name before any SQL operations
            validateTableName(table);
            // HIGH-32 FIX: Use format() with %I for safe identifier quoting
            const formatResult = await db.query(`SELECT format('SELECT COUNT(*) as count FROM %I WHERE project_id = $1', $1) as sql`, [table]);
            const result = await db.query(formatResult.rows[0].sql, [DEFAULT_PROJECT_ID]);
            results.push({
                tableName: table,
                rowsUpdated: parseInt(result.rows[0]?.count ?? '0', 10)
            });
        }
        catch (error) {
            // Table might not exist or column might not be added yet
            logger.debug({ table, error }, 'Stats check skipped');
        }
    }
    return results;
}
/**
 * Register a project using the UPSERT pattern.
 * Race-condition-free: multiple concurrent calls with same path will all succeed.
 *
 * @param db - DatabaseManager instance
 * @param projectPath - The project path to register
 * @param projectName - Optional friendly name
 * @returns The project UUID
 */
export async function registerProject(db, projectPath, projectName) {
    const result = await db.query(`
    INSERT INTO projects (path, name)
    VALUES ($1, COALESCE($2, $1))
    ON CONFLICT (path) DO UPDATE SET
      last_accessed_at = NOW(),
      name = COALESCE(EXCLUDED.name, projects.name)
    RETURNING id
  `, [projectPath, projectName]);
    return result.rows[0].id;
}
/**
 * Get project ID by path, or register if not exists.
 *
 * @param db - DatabaseManager instance
 * @param projectPath - The project path to lookup
 * @returns The project UUID
 */
export async function getOrCreateProjectId(db, projectPath) {
    // First try to get existing
    const existing = await db.query(`
    SELECT id FROM projects WHERE path = $1
  `, [projectPath]);
    if (existing.rows.length > 0) {
        // Update last_accessed
        await db.query(`
      UPDATE projects SET last_accessed_at = NOW() WHERE path = $1
    `, [projectPath]);
        return existing.rows[0].id;
    }
    // Register new project
    return registerProject(db, projectPath);
}
/**
 * Get all registered projects.
 *
 * @param db - DatabaseManager instance
 * @returns Array of project records
 */
export async function getAllProjects(db) {
    const result = await db.query(`
    SELECT id, path, name, created_at, last_accessed_at
    FROM projects
    ORDER BY last_accessed_at DESC
  `);
    return result.rows.map((row) => ({
        id: row.id,
        path: row.path,
        name: row.name,
        createdAt: row.created_at,
        lastAccessedAt: row.last_accessed_at
    }));
}
/**
 * Check if project namespacing migration has been run.
 *
 * NOTE: The projects table is intentionally in the 'public' schema as it's a
 * global registry that tracks all projects across all schemas. This is correct
 * design - do not change it to use per-project schema.
 *
 * @param db - DatabaseManager instance
 * @returns True if projects table exists with data
 */
export async function isProjectNamespacingEnabled(db) {
    try {
        // projects table is deliberately in public schema as it's a global registry
        const result = await db.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'projects'
      ) as exists
    `);
        return result.rows[0]?.exists ?? false;
    }
    catch (error) {
        return false;
    }
}
export default {
    // Schema-per-project isolation (new)
    getProjectSchema,
    getProjectHashFull,
    createProjectSchema,
    setProjectSearchPath,
    initializeProjectSchema,
    listProjectSchemas,
    dropProjectSchema,
    // MED-42 FIX: Schema validation before operations
    schemaExists,
    tableExists,
    ensureSchemaReady,
    ensureSchemaInitialized,
    invalidateSchemaCache,
    isSchemaReadyCached,
    // Legacy project_id column approach
    runProjectNamespacingMigration,
    runProjectNamespacingMigrationStepwise,
    registerProject,
    getOrCreateProjectId,
    getAllProjects,
    isProjectNamespacingEnabled,
    DEFAULT_PROJECT_ID,
    DEFAULT_PROJECT_PATH
};
//# sourceMappingURL=projectNamespacing.js.map