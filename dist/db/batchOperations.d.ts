/**
 * batchOperations.ts - Batch Database Operations
 *
 * yo this makes sure we use batch inserts EVERYWHERE
 * no more loop-based one-at-a-time inserts fr fr
 * maximum performance for bulk operations
 *
 * Issue #40 fix - batch insert not used everywhere
 */
import { Pool } from 'pg';
/**
 * Batch operation options
 */
export interface BatchOptions {
    /** Maximum items per batch */
    batchSize: number;
    /** Whether to use a transaction for the entire operation */
    useTransaction: boolean;
    /** Whether to continue on error (skip failed items) */
    continueOnError: boolean;
    /** Maximum retries per batch */
    maxRetries: number;
    /** Delay between retries in ms */
    retryDelayMs: number;
}
/**
 * Batch operation result
 */
export interface BatchResult {
    totalProcessed: number;
    successful: number;
    failed: number;
    errors: Array<{
        item: unknown;
        error: string;
    }>;
    durationMs: number;
}
/**
 * BatchInsertBuilder - builds efficient batch INSERT statements
 *
 * Generates PostgreSQL VALUES clauses with proper parameter indexing.
 * Handles conflicts with ON CONFLICT clauses.
 *
 * IMPORTANT: Project Isolation
 * Callers MUST include 'project_path' in their data objects.
 * This builder does NOT automatically inject project_path.
 * Use getProjectPathForInsert() from services/ProjectContext.js
 */
export declare class BatchInsertBuilder<T extends Record<string, unknown>> {
    private tableName;
    private columns;
    private conflictTarget?;
    private conflictAction?;
    private updateColumns?;
    constructor(tableName: string, columns: string[]);
    /**
     * Add ON CONFLICT DO NOTHING clause
     */
    onConflictDoNothing(target: string[]): this;
    /**
     * Add ON CONFLICT DO UPDATE clause
     */
    onConflictDoUpdate(target: string[], updateColumns: string[]): this;
    /**
     * Build the INSERT query and parameters for a batch
     */
    build(items: T[]): {
        query: string;
        params: unknown[];
    };
}
/**
 * BatchUpdateBuilder - builds efficient batch UPDATE statements
 *
 * Uses VALUES to update multiple rows in a single query.
 *
 * IMPORTANT: Project Isolation
 * Callers MUST include 'project_path' in their WHERE conditions or data.
 * This builder does NOT automatically filter by project_path.
 * Use getProjectPathForInsert() from services/ProjectContext.js
 */
export declare class BatchUpdateBuilder<T extends Record<string, unknown>> {
    private tableName;
    private keyColumn;
    private updateColumns;
    constructor(tableName: string, keyColumn: string, updateColumns: string[]);
    /**
     * Build the UPDATE query and parameters for a batch
     */
    build(items: Array<T & {
        [key: string]: unknown;
    }>): {
        query: string;
        params: unknown[];
    };
    private getTypeCast;
}
/**
 * BatchOperations - execute batch database operations
 *
 * IMPORTANT: Project Isolation
 * Callers MUST include 'project_path' in their data objects for inserts/upserts,
 * or in WHERE conditions for updates/deletes.
 * This class does NOT automatically inject or filter by project_path.
 * Use getProjectPathForInsert() from services/ProjectContext.js
 */
export declare class BatchOperations {
    private pool;
    constructor(pool: Pool);
    /**
     * Execute a batch insert operation
     */
    batchInsert<T extends Record<string, unknown>>(tableName: string, columns: string[], items: T[], options?: Partial<BatchOptions>): Promise<BatchResult>;
    /**
     * Execute a batch update operation
     */
    batchUpdate<T extends Record<string, unknown>>(tableName: string, keyColumn: string, updateColumns: string[], items: T[], options?: Partial<BatchOptions>): Promise<BatchResult>;
    /**
     * Execute a batch delete operation
     */
    batchDelete(tableName: string, keyColumn: string, keys: (string | number)[], options?: Partial<BatchOptions>): Promise<BatchResult>;
    /**
     * Execute a batch upsert (INSERT ON CONFLICT UPDATE)
     */
    batchUpsert<T extends Record<string, unknown>>(tableName: string, columns: string[], conflictColumns: string[], updateColumns: string[], items: T[], options?: Partial<BatchOptions>): Promise<BatchResult>;
    /**
     * Split array into chunks
     */
    private chunkArray;
}
/**
 * Create a batch operations instance
 */
export declare function createBatchOperations(pool: Pool): BatchOperations;
/**
 * processBatchesWithConcurrency - run batch operations in parallel with concurrency limit
 *
 * FIXES Task #37 - sequential batch processing was slow af
 * Now runs multiple batches concurrently while respecting a max limit
 *
 * @param items - array of items to process
 * @param batchSize - items per batch
 * @param concurrencyLimit - max parallel batches (default 5)
 * @param processBatch - async function to process each batch
 * @returns aggregated results
 */
export declare function processBatchesWithConcurrency<T, R>(items: T[], batchSize: number, concurrencyLimit: number, processBatch: (batch: T[], batchIndex: number) => Promise<R>): Promise<R[]>;
/**
 * DEFAULT_CONCURRENCY_LIMIT - safe default for parallel batch operations
 * 5 is a good balance between speed and not overwhelming the DB
 */
export declare const DEFAULT_CONCURRENCY_LIMIT = 5;
//# sourceMappingURL=batchOperations.d.ts.map