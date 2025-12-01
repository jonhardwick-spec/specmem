/**
 * postgresAutoSetup.ts - Auto-install and configure PostgreSQL + pgvector
 *
 * Handles:
 * - Detecting if postgres is installed
 * - Installing postgres if missing (apt-get)
 * - Installing pgvector extension
 * - Creating specmem database and user
 * - Setting up required schemas
 *
 * @author hardwicksoftwareservices
 */
interface PostgresStatus {
    installed: boolean;
    running: boolean;
    version?: string;
    pgvectorInstalled: boolean;
    specmemDbExists: boolean;
    specmemUserExists: boolean;
}
interface SetupResult {
    success: boolean;
    message: string;
    status: PostgresStatus;
}
/**
 * Get full postgres status
 */
export declare function getPostgresStatus(): PostgresStatus;
/**
 * Auto-setup PostgreSQL + pgvector + specmem database
 *
 * This function will:
 * 1. Check if postgres is installed, install if not
 * 2. Check if postgres is running, start if not
 * 3. Check if pgvector is installed, install if not
 * 4. Create specmem database and user if not exists
 * 5. Configure authentication
 */
export declare function autoSetupPostgres(options?: {
    dbName?: string;
    userName?: string;
    password?: string;
    skipInstall?: boolean;
}): Promise<SetupResult>;
/**
 * Quick check if postgres is ready for specmem
 */
export declare function isPostgresReady(): boolean;
/**
 * Ensure postgres is ready, auto-setup if needed
 */
export declare function ensurePostgresReady(): Promise<boolean>;
export {};
//# sourceMappingURL=postgresAutoSetup.d.ts.map