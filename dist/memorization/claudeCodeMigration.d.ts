/**
 * claudeCodeMigration.ts - Database migrations for  code tracking
 *
 * yooo this migration lets  REMEMBER what it wrote
 * no more massive explores because  will KNOW
 * what code it created and WHY
 *
 * EMBEDDING DIMENSION NOTE:
 * DEPRECATED: SPECMEM_EMBEDDING_DIMENSIONS is no longer used.
 * Embedding dimensions are AUTO-DETECTED from the database pgvector column.
 * The system auto-migrates when dimension mismatch is detected at startup.
 */
import pg from 'pg';
/**
 * Migration to create claude_code_history table
 *
 * fr fr tracking everything  writes so it never forgets
 */
export declare const claudeCodeHistoryMigration: {
    version: number;
    name: string;
    up: string;
    down: string;
    checksum: string;
};
/**
 * Run the migration using a connection pool
 */
export declare function runCodeMigration(client: pg.PoolClient): Promise<void>;
/**
 * Check if migration has been applied
 */
export declare function isCodeMigrationApplied(client: pg.PoolClient): Promise<boolean>;
//# sourceMappingURL=claudeCodeMigration.d.ts.map