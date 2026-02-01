/**
 * Database Auto-Setup Module
 *
 * yo this handles automatic database creation and configuration
 * creates users, databases, enables extensions, all that good stuff
 */
import pg from 'pg';
export interface DbSetupConfig {
    host: string;
    port: number;
    adminUser: string;
    adminPassword: string;
    targetDb: string;
    targetUser: string;
    targetPassword?: string;
}
export interface DbSetupResult {
    success: boolean;
    dbExists: boolean;
    dbCreated: boolean;
    userExists: boolean;
    userCreated: boolean;
    pgvectorEnabled: boolean;
    connectionString: string;
    password?: string;
    error?: string;
}
/**
 * Test connection to PostgreSQL
 */
export declare function testPostgresConnection(host: string, port: number, user: string, password: string, database?: string): Promise<{
    connected: boolean;
    version?: string;
    error?: string;
}>;
/**
 * Detect PostgreSQL admin credentials
 */
export declare function detectAdminCredentials(host: string, port: number): Promise<{
    user: string;
    password: string;
    found: boolean;
}>;
/**
 * Check if database exists
 */
export declare function checkDatabaseExists(client: pg.Client, dbName: string): Promise<boolean>;
/**
 * Check if user/role exists
 */
export declare function checkUserExists(client: pg.Client, userName: string): Promise<boolean>;
/**
 * Create database
 */
export declare function createDatabase(client: pg.Client, dbName: string): Promise<boolean>;
/**
 * Create user/role
 */
export declare function createUser(client: pg.Client, userName: string, password: string): Promise<boolean>;
/**
 * Update user password
 */
export declare function updateUserPassword(client: pg.Client, userName: string, password: string): Promise<boolean>;
/**
 * Grant privileges on database to user
 */
export declare function grantPrivileges(client: pg.Client, dbName: string, userName: string): Promise<boolean>;
/**
 * Enable pgvector extension
 */
export declare function enablePgvector(client: pg.Client): Promise<boolean>;
/**
 * Grant schema privileges (needed for pgvector)
 */
export declare function grantSchemaPrivileges(client: pg.Client, userName: string, schemaName?: string): Promise<boolean>;
/**
 * Auto-setup database - full orchestration
 */
export declare function autoSetupDatabase(config: DbSetupConfig): Promise<DbSetupResult>;
/**
 * Quick database setup with auto-detection
 */
export declare function quickSetupDatabase(host?: string, port?: number, targetDb?: string, targetUser?: string): Promise<DbSetupResult>;
//# sourceMappingURL=dbSetup.d.ts.map