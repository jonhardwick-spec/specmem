/**
 * SpecMem Deployment Bootstrap
 *
 * Auto-creates database users, databases, and schemas on first run.
 * Handles the "cold start" problem where SpecMem needs to set up its own infrastructure.
 *
 * This runs BEFORE the main database initialization and ensures:
 * 1. The database user exists (creates if not)
 * 2. The database exists (creates if not)
 * 3. pgvector extension is installed
 * 4. Schema is ready for table creation
 */
export interface BootstrapResult {
    success: boolean;
    userCreated: boolean;
    databaseCreated: boolean;
    extensionsCreated: boolean;
    errors: string[];
    config: {
        database: string;
        user: string;
        host: string;
        port: number;
    };
}
/**
 * Main bootstrap function - ensures database infrastructure is ready.
 *
 * Call this BEFORE creating the DatabaseManager.
 * It will:
 * 1. Connect as superuser
 * 2. Create the SpecMem user if needed
 * 3. Create the SpecMem database if needed
 * 4. Install required extensions
 * 5. Fix any vector dimension issues
 */
export declare function bootstrapDatabase(): Promise<BootstrapResult>;
/**
 * Quick check if bootstrap is needed.
 * Returns true if we can't connect with configured credentials.
 */
export declare function needsBootstrap(): Promise<boolean>;
//# sourceMappingURL=deploymentBootstrap.d.ts.map