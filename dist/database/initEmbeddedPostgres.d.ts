/**
 * Embedded PostgreSQL Auto-Initialization Module
 *
 * Handles automatic initialization of an embedded PostgreSQL instance:
 * 1. Initialize data directory with initdb
 * 2. Start PostgreSQL server
 * 3. Create database and user
 * 4. Install pgvector extension
 * 5. Run all SpecMem migrations
 *
 * This module is designed for zero-config deployment where PostgreSQL
 * is bundled with SpecMem rather than relying on a system-wide installation.
 */
export interface EmbeddedPostgresConfig {
    /** Base directory for PostgreSQL data and binaries */
    baseDir: string;
    /** Port to run PostgreSQL on */
    port: number;
    /** Database name to create */
    database: string;
    /** Username to create */
    user: string;
    /** Password for the user (auto-generated if not provided) */
    password?: string;
    /** Path to initdb binary (auto-detected if not provided) */
    initdbPath?: string;
    /** Path to pg_ctl binary (auto-detected if not provided) */
    pgCtlPath?: string;
    /** Path to postgres binary (auto-detected if not provided) */
    postgresPath?: string;
    /** Connection timeout in milliseconds */
    connectionTimeout?: number;
    /** Maximum retry attempts for connection */
    maxRetries?: number;
    /** Delay between retries in milliseconds */
    retryDelay?: number;
}
export interface InitResult {
    success: boolean;
    isFirstRun: boolean;
    dataDirectory: string;
    port: number;
    database: string;
    user: string;
    password: string;
    connectionString: string;
    postgresVersion?: string;
    pgvectorEnabled: boolean;
    migrationsRun: boolean;
    error?: string;
    warnings: string[];
}
/**
 * Get the default base directory for embedded PostgreSQL
 */
export declare function getDefaultBaseDir(): string;
/**
 * Initialize the database - create database and user if they don't exist
 */
export declare function initializeDatabase(host: string, port: number, adminUser: string, adminPassword: string, targetDatabase: string, targetUser: string, targetPassword: string): Promise<{
    success: boolean;
    dbCreated: boolean;
    userCreated: boolean;
    error?: string;
}>;
/**
 * Install required PostgreSQL extensions (pgvector, pg_trgm, etc.)
 */
export declare function installExtensions(host: string, port: number, user: string, password: string, database: string): Promise<{
    success: boolean;
    extensions: string[];
    error?: string;
}>;
/**
 * Run all SpecMem database migrations
 */
export declare function runMigrations(host: string, port: number, database: string, user: string, password: string): Promise<{
    success: boolean;
    migrationsRun: number;
    error?: string;
}>;
/**
 * Verify database is ready and all components are working
 */
export declare function verifyDatabase(host: string, port: number, database: string, user: string, password: string): Promise<{
    success: boolean;
    checks: {
        connection: boolean;
        pgvector: boolean;
        memoriesTable: boolean;
        migrationsTable: boolean;
    };
    error?: string;
}>;
/**
 * Main initialization function - orchestrates the entire embedded PostgreSQL setup
 *
 * This function handles:
 * 1. Detecting/setting up PostgreSQL binaries
 * 2. Initializing data directory if needed (first run)
 * 3. Starting PostgreSQL server
 * 4. Creating database and user
 * 5. Installing extensions (pgvector, etc.)
 * 6. Running all migrations
 * 7. Verifying everything is ready
 */
export declare function initializeEmbeddedPostgres(config?: Partial<EmbeddedPostgresConfig>): Promise<InitResult>;
/**
 * Stop embedded PostgreSQL server
 */
export declare function stopEmbeddedPostgres(baseDir?: string): Promise<{
    success: boolean;
    error?: string;
}>;
/**
 * Get status of embedded PostgreSQL
 */
export declare function getEmbeddedPostgresStatus(baseDir?: string): Promise<{
    initialized: boolean;
    running: boolean;
    dataDirectory: string;
    version?: string;
}>;
//# sourceMappingURL=initEmbeddedPostgres.d.ts.map