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
import { DatabaseManager } from '../database.js';
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
export declare function getProjectSchema(projectPath?: string): string;
/**
 * Generate the full hash for a project path.
 * Used for detailed logging and debugging.
 *
 * @param projectPath - The project path
 * @returns Full SHA256 hash (64 chars)
 */
export declare function getProjectHashFull(projectPath: string): string;
/**
 * Create a project schema if it doesn't exist.
 * Also sets up the search_path to include the new schema.
 *
 * @param db - DatabaseManager instance
 * @param schemaName - Schema name to create (from getProjectSchema)
 * @returns True if schema was created, false if already existed
 */
export declare function createProjectSchema(db: DatabaseManager, schemaName: string): Promise<boolean>;
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
export declare function setProjectSearchPath(db: DatabaseManager, schemaName: string): Promise<void>;
/**
 * Initialize project schema with all required tables.
 * Creates the schema and runs table creation within that schema context.
 *
 * @param db - DatabaseManager instance
 * @param projectPath - Project path (uses env var if not provided)
 * @returns Schema name that was initialized
 */
export declare function initializeProjectSchema(db: DatabaseManager, projectPath?: string): Promise<string>;
/**
 * Check if schema exists in the database.
 * Pure existence check - no creation, no side effects.
 *
 * @param db - DatabaseManager instance
 * @param schemaName - Schema name to check
 * @returns True if schema exists, false otherwise
 */
export declare function schemaExists(db: DatabaseManager, schemaName: string): Promise<boolean>;
/**
 * Check if a table exists in the specified schema.
 * Pure existence check - no creation, no side effects.
 *
 * @param db - DatabaseManager instance
 * @param schemaName - Schema name
 * @param tableName - Table name to check
 * @returns True if table exists, false otherwise
 */
export declare function tableExists(db: DatabaseManager, schemaName: string, tableName: string): Promise<boolean>;
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
export declare function ensureSchemaReady(db: DatabaseManager, projectPath?: string): Promise<void>;
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
export declare function ensureSchemaInitialized(db: DatabaseManager, projectPath?: string): Promise<string>;
/**
 * Invalidate schema cache for a project.
 * Call after schema changes (drop, recreate, etc).
 *
 * @param projectPath - Optional project path, invalidates all if not provided
 */
export declare function invalidateSchemaCache(projectPath?: string): void;
/**
 * Check if schema is cached as ready (without DB check).
 * Useful for fast checks in hot paths.
 *
 * @param projectPath - Optional project path
 * @returns True if cached as ready, false otherwise
 */
export declare function isSchemaReadyCached(projectPath?: string): boolean;
/**
 * Get all project schemas in the database.
 * Useful for cleanup, debugging, and multi-project management.
 *
 * @param db - DatabaseManager instance
 * @returns Array of schema names matching specmem_* pattern
 */
export declare function listProjectSchemas(db: DatabaseManager): Promise<string[]>;
/**
 * Drop a project schema and all its contents.
 * CAUTION: This is destructive and cannot be undone!
 *
 * @param db - DatabaseManager instance
 * @param schemaName - Schema to drop
 * @param confirm - Must be true to actually drop
 */
export declare function dropProjectSchema(db: DatabaseManager, schemaName: string, confirm?: boolean): Promise<void>;
export declare const DEFAULT_PROJECT_ID = "00000000-0000-0000-0000-000000000000";
export declare const DEFAULT_PROJECT_PATH = "/";
/**
 * Project record from database
 */
export interface Project {
    id: string;
    path: string;
    name: string | null;
    createdAt: Date;
    lastAccessedAt: Date;
}
/**
 * Backfill result for a single table
 */
export interface BackfillResult {
    tableName: string;
    rowsUpdated: number;
}
/**
 * Migration result summary
 */
export interface MigrationResult {
    success: boolean;
    projectsTableCreated: boolean;
    columnsAdded: string[];
    indexesCreated: string[];
    backfillResults: BackfillResult[];
    errors: string[];
    durationMs: number;
}
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
export declare function runProjectNamespacingMigration(db: DatabaseManager): Promise<MigrationResult>;
/**
 * Run migration by reading individual SQL statements.
 * Use this if the full script execution fails.
 *
 * @param db - DatabaseManager instance
 */
export declare function runProjectNamespacingMigrationStepwise(db: DatabaseManager): Promise<MigrationResult>;
/**
 * Register a project using the UPSERT pattern.
 * Race-condition-free: multiple concurrent calls with same path will all succeed.
 *
 * @param db - DatabaseManager instance
 * @param projectPath - The project path to register
 * @param projectName - Optional friendly name
 * @returns The project UUID
 */
export declare function registerProject(db: DatabaseManager, projectPath: string, projectName?: string): Promise<string>;
/**
 * Get project ID by path, or register if not exists.
 *
 * @param db - DatabaseManager instance
 * @param projectPath - The project path to lookup
 * @returns The project UUID
 */
export declare function getOrCreateProjectId(db: DatabaseManager, projectPath: string): Promise<string>;
/**
 * Get all registered projects.
 *
 * @param db - DatabaseManager instance
 * @returns Array of project records
 */
export declare function getAllProjects(db: DatabaseManager): Promise<Project[]>;
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
export declare function isProjectNamespacingEnabled(db: DatabaseManager): Promise<boolean>;
declare const _default: {
    getProjectSchema: typeof getProjectSchema;
    getProjectHashFull: typeof getProjectHashFull;
    createProjectSchema: typeof createProjectSchema;
    setProjectSearchPath: typeof setProjectSearchPath;
    initializeProjectSchema: typeof initializeProjectSchema;
    listProjectSchemas: typeof listProjectSchemas;
    dropProjectSchema: typeof dropProjectSchema;
    schemaExists: typeof schemaExists;
    tableExists: typeof tableExists;
    ensureSchemaReady: typeof ensureSchemaReady;
    ensureSchemaInitialized: typeof ensureSchemaInitialized;
    invalidateSchemaCache: typeof invalidateSchemaCache;
    isSchemaReadyCached: typeof isSchemaReadyCached;
    runProjectNamespacingMigration: typeof runProjectNamespacingMigration;
    runProjectNamespacingMigrationStepwise: typeof runProjectNamespacingMigrationStepwise;
    registerProject: typeof registerProject;
    getOrCreateProjectId: typeof getOrCreateProjectId;
    getAllProjects: typeof getAllProjects;
    isProjectNamespacingEnabled: typeof isProjectNamespacingEnabled;
    DEFAULT_PROJECT_ID: string;
    DEFAULT_PROJECT_PATH: string;
};
export default _default;
//# sourceMappingURL=projectNamespacing.d.ts.map