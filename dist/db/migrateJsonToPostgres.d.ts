import { ConnectionPoolGoBrrr } from './connectionPoolGoBrrr.js';
interface MigrationResult {
    endpoints: {
        migrated: number;
        failed: number;
    };
    bans: {
        migrated: number;
        failed: number;
    };
    autobanConfig: boolean;
    securityEvents: {
        migrated: number;
        failed: number;
    };
    oauthProviders: {
        migrated: number;
        failed: number;
    };
    adminSessions: {
        migrated: number;
        failed: number;
    };
    governmentFacilities: {
        migrated: number;
        failed: number;
    };
    errors: string[];
}
/**
 * Main migration function - runs all migrations
 */
export declare function migrateAllJsonToPostgres(pool: ConnectionPoolGoBrrr): Promise<MigrationResult>;
/**
 * Check if migration is needed
 */
export declare function checkMigrationNeeded(): Promise<boolean>;
/**
 * Backup JSON files before migration
 */
export declare function backupJsonFiles(): string;
export {};
//# sourceMappingURL=migrateJsonToPostgres.d.ts.map