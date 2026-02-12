/**
 * batchOperations.ts - Batch Database Operations
 *
 * yo this makes sure we use batch inserts EVERYWHERE
 * no more loop-based one-at-a-time inserts fr fr
 * maximum performance for bulk operations
 *
 * Issue #40 fix - batch insert not used everywhere
 */
import { logger } from '../utils/logger.js';
import { withRetry, isTransientDbError } from '../utils/retryHelper.js';
import { getProjectSchema } from './projectNamespacing.js';
/**
 * SCHEMA ISOLATION FIX: Set search_path on a client after BEGIN.
 *
 * The pool.on('connect') hook is ASYNC, but pool.connect() returns immediately.
 * This causes a race where BEGIN can execute before search_path is set.
 *
 * This function MUST be called right after BEGIN to ensure correct schema isolation.
 */
async function setClientSearchPath(client) {
    const schemaName = getProjectSchema();
    // Use format() with %I for safe identifier quoting
    const formatResult = await client.query(`SELECT format('SET search_path TO %I, public', $1::text) as sql`, [schemaName]);
    await client.query(formatResult.rows[0].sql);
    logger.debug({ schemaName }, 'Set search_path inside transaction');
}
const DEFAULT_BATCH_OPTIONS = {
    batchSize: 100,
    useTransaction: true,
    continueOnError: false,
    maxRetries: 3,
    retryDelayMs: 100
};
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
export class BatchInsertBuilder {
    tableName;
    columns;
    conflictTarget;
    conflictAction;
    updateColumns;
    constructor(tableName, columns) {
        this.tableName = tableName;
        this.columns = columns;
    }
    /**
     * Add ON CONFLICT DO NOTHING clause
     */
    onConflictDoNothing(target) {
        this.conflictTarget = target;
        this.conflictAction = 'DO NOTHING';
        return this;
    }
    /**
     * Add ON CONFLICT DO UPDATE clause
     */
    onConflictDoUpdate(target, updateColumns) {
        this.conflictTarget = target;
        this.conflictAction = 'DO UPDATE SET';
        this.updateColumns = updateColumns;
        return this;
    }
    /**
     * Build the INSERT query and parameters for a batch
     */
    build(items) {
        if (items.length === 0) {
            throw new Error('Cannot build INSERT for empty items array');
        }
        const params = [];
        const valueRows = [];
        for (const item of items) {
            const rowParams = [];
            for (const column of this.columns) {
                params.push(item[column]);
                rowParams.push(`$${params.length}`);
            }
            valueRows.push(`(${rowParams.join(', ')})`);
        }
        let query = `
      INSERT INTO ${this.tableName} (${this.columns.join(', ')})
      VALUES ${valueRows.join(',\n')}
    `;
        // Add conflict clause if specified
        if (this.conflictTarget && this.conflictAction) {
            query += `\nON CONFLICT (${this.conflictTarget.join(', ')}) ${this.conflictAction}`;
            if (this.conflictAction === 'DO UPDATE SET' && this.updateColumns) {
                const updates = this.updateColumns.map(col => `${col} = EXCLUDED.${col}`);
                query += ` ${updates.join(', ')}`;
            }
        }
        query += '\nRETURNING *';
        return { query, params };
    }
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
export class BatchUpdateBuilder {
    tableName;
    keyColumn;
    updateColumns;
    constructor(tableName, keyColumn, updateColumns) {
        this.tableName = tableName;
        this.keyColumn = keyColumn;
        this.updateColumns = updateColumns;
    }
    /**
     * Build the UPDATE query and parameters for a batch
     */
    build(items) {
        if (items.length === 0) {
            throw new Error('Cannot build UPDATE for empty items array');
        }
        const params = [];
        const valueRows = [];
        // Build type casting for VALUES
        const firstItem = items[0];
        const typeCasts = [];
        // Key column first
        params.push(firstItem[this.keyColumn]);
        typeCasts.push(this.getTypeCast(firstItem[this.keyColumn], this.keyColumn));
        let paramIndex = 1;
        // Then update columns
        for (const column of this.updateColumns) {
            params.push(firstItem[column]);
            typeCasts.push(this.getTypeCast(firstItem[column], column));
            paramIndex++;
        }
        valueRows.push(`($${Array.from({ length: paramIndex }, (_, i) => i + 1).join(', $')})`);
        // Add remaining rows
        for (let i = 1; i < items.length; i++) {
            const item = items[i];
            const rowParams = [];
            params.push(item[this.keyColumn]);
            rowParams.push(params.length);
            for (const column of this.updateColumns) {
                params.push(item[column]);
                rowParams.push(params.length);
            }
            valueRows.push(`($${rowParams.join(', $')})`);
        }
        const allColumns = [this.keyColumn, ...this.updateColumns];
        const setClause = this.updateColumns.map(col => `${col} = v.${col}`).join(', ');
        const query = `
      UPDATE ${this.tableName} AS t
      SET ${setClause}
      FROM (VALUES ${valueRows.join(',\n')}) AS v(${allColumns.join(', ')})
      WHERE t.${this.keyColumn} = v.${this.keyColumn}
      RETURNING t.*
    `;
        return { query, params };
    }
    getTypeCast(value, column) {
        // Determine PostgreSQL type from value
        if (typeof value === 'number') {
            return Number.isInteger(value) ? 'integer' : 'numeric';
        }
        if (typeof value === 'boolean') {
            return 'boolean';
        }
        if (value instanceof Date) {
            return 'timestamptz';
        }
        if (Array.isArray(value)) {
            return 'text[]';
        }
        if (typeof value === 'object' && value !== null) {
            return 'jsonb';
        }
        return 'text';
    }
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
export class BatchOperations {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    /**
     * Execute a batch insert operation
     */
    async batchInsert(tableName, columns, items, options = {}) {
        const opts = { ...DEFAULT_BATCH_OPTIONS, ...options };
        const startTime = Date.now();
        const result = {
            totalProcessed: 0,
            successful: 0,
            failed: 0,
            errors: [],
            durationMs: 0
        };
        if (items.length === 0) {
            result.durationMs = Date.now() - startTime;
            return result;
        }
        const builder = new BatchInsertBuilder(tableName, columns);
        const batches = this.chunkArray(items, opts.batchSize);
        const client = opts.useTransaction ? await this.pool.connect() : null;
        try {
            if (client) {
                await client.query('BEGIN');
                // SCHEMA ISOLATION FIX: Set search_path inside transaction to avoid race condition
                await setClientSearchPath(client);
            }
            for (const batch of batches) {
                try {
                    const { query, params } = builder.build(batch);
                    const executor = client || this.pool;
                    // wrap with retry for transient failures (exponential backoff)
                    await withRetry(() => executor.query(query, params), {
                        maxRetries: opts.maxRetries,
                        baseDelayMs: opts.retryDelayMs,
                        isRetryable: isTransientDbError
                    }, 'batchInsert');
                    result.successful += batch.length;
                    result.totalProcessed += batch.length;
                }
                catch (error) {
                    result.failed += batch.length;
                    result.totalProcessed += batch.length;
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    result.errors.push({
                        item: batch,
                        error: errorMessage
                    });
                    if (!opts.continueOnError) {
                        throw error;
                    }
                    logger.warn({ error: errorMessage, batchSize: batch.length }, 'batch insert failed');
                }
            }
            if (client) {
                await client.query('COMMIT');
            }
        }
        catch (error) {
            if (client) {
                await client.query('ROLLBACK');
            }
            throw error;
        }
        finally {
            if (client) {
                client.release();
            }
        }
        result.durationMs = Date.now() - startTime;
        logger.debug({
            tableName,
            totalProcessed: result.totalProcessed,
            successful: result.successful,
            failed: result.failed,
            durationMs: result.durationMs
        }, 'batch insert completed');
        return result;
    }
    /**
     * Execute a batch update operation
     */
    async batchUpdate(tableName, keyColumn, updateColumns, items, options = {}) {
        const opts = { ...DEFAULT_BATCH_OPTIONS, ...options };
        const startTime = Date.now();
        const result = {
            totalProcessed: 0,
            successful: 0,
            failed: 0,
            errors: [],
            durationMs: 0
        };
        if (items.length === 0) {
            result.durationMs = Date.now() - startTime;
            return result;
        }
        const builder = new BatchUpdateBuilder(tableName, keyColumn, updateColumns);
        const batches = this.chunkArray(items, opts.batchSize);
        const client = opts.useTransaction ? await this.pool.connect() : null;
        try {
            if (client) {
                await client.query('BEGIN');
                // SCHEMA ISOLATION FIX: Set search_path inside transaction to avoid race condition
                await setClientSearchPath(client);
            }
            for (const batch of batches) {
                try {
                    const { query, params } = builder.build(batch);
                    const executor = client || this.pool;
                    // wrap with retry for transient failures
                    await withRetry(() => executor.query(query, params), {
                        maxRetries: opts.maxRetries,
                        baseDelayMs: opts.retryDelayMs,
                        isRetryable: isTransientDbError
                    }, 'batchUpdate');
                    result.successful += batch.length;
                    result.totalProcessed += batch.length;
                }
                catch (error) {
                    result.failed += batch.length;
                    result.totalProcessed += batch.length;
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    result.errors.push({
                        item: batch,
                        error: errorMessage
                    });
                    if (!opts.continueOnError) {
                        throw error;
                    }
                }
            }
            if (client) {
                await client.query('COMMIT');
            }
        }
        catch (error) {
            if (client) {
                await client.query('ROLLBACK');
            }
            throw error;
        }
        finally {
            if (client) {
                client.release();
            }
        }
        result.durationMs = Date.now() - startTime;
        return result;
    }
    /**
     * Execute a batch delete operation
     */
    async batchDelete(tableName, keyColumn, keys, options = {}) {
        const opts = { ...DEFAULT_BATCH_OPTIONS, ...options };
        const startTime = Date.now();
        const result = {
            totalProcessed: 0,
            successful: 0,
            failed: 0,
            errors: [],
            durationMs: 0
        };
        if (keys.length === 0) {
            result.durationMs = Date.now() - startTime;
            return result;
        }
        const batches = this.chunkArray(keys, opts.batchSize);
        const client = opts.useTransaction ? await this.pool.connect() : null;
        try {
            if (client) {
                await client.query('BEGIN');
                // SCHEMA ISOLATION FIX: Set search_path inside transaction to avoid race condition
                await setClientSearchPath(client);
            }
            for (const batch of batches) {
                try {
                    const placeholders = batch.map((_, i) => `$${i + 1}`).join(', ');
                    const query = `DELETE FROM ${tableName} WHERE ${keyColumn} IN (${placeholders}) RETURNING ${keyColumn}`;
                    const executor = client || this.pool;
                    // wrap with retry for transient failures
                    const deleteResult = await withRetry(() => executor.query(query, batch), {
                        maxRetries: opts.maxRetries,
                        baseDelayMs: opts.retryDelayMs,
                        isRetryable: isTransientDbError
                    }, 'batchDelete');
                    result.successful += deleteResult?.rowCount ?? 0;
                    result.totalProcessed += batch.length;
                }
                catch (error) {
                    result.failed += batch.length;
                    result.totalProcessed += batch.length;
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    result.errors.push({
                        item: batch,
                        error: errorMessage
                    });
                    if (!opts.continueOnError) {
                        throw error;
                    }
                }
            }
            if (client) {
                await client.query('COMMIT');
            }
        }
        catch (error) {
            if (client) {
                await client.query('ROLLBACK');
            }
            throw error;
        }
        finally {
            if (client) {
                client.release();
            }
        }
        result.durationMs = Date.now() - startTime;
        return result;
    }
    /**
     * Execute a batch upsert (INSERT ON CONFLICT UPDATE)
     */
    async batchUpsert(tableName, columns, conflictColumns, updateColumns, items, options = {}) {
        const opts = { ...DEFAULT_BATCH_OPTIONS, ...options };
        const startTime = Date.now();
        const result = {
            totalProcessed: 0,
            successful: 0,
            failed: 0,
            errors: [],
            durationMs: 0
        };
        if (items.length === 0) {
            result.durationMs = Date.now() - startTime;
            return result;
        }
        const builder = new BatchInsertBuilder(tableName, columns)
            .onConflictDoUpdate(conflictColumns, updateColumns);
        const batches = this.chunkArray(items, opts.batchSize);
        const client = opts.useTransaction ? await this.pool.connect() : null;
        try {
            if (client) {
                await client.query('BEGIN');
                // SCHEMA ISOLATION FIX: Set search_path inside transaction to avoid race condition
                await setClientSearchPath(client);
            }
            for (const batch of batches) {
                try {
                    const { query, params } = builder.build(batch);
                    const executor = client || this.pool;
                    // wrap with retry for transient failures
                    await withRetry(() => executor.query(query, params), {
                        maxRetries: opts.maxRetries,
                        baseDelayMs: opts.retryDelayMs,
                        isRetryable: isTransientDbError
                    }, 'batchUpsert');
                    result.successful += batch.length;
                    result.totalProcessed += batch.length;
                }
                catch (error) {
                    result.failed += batch.length;
                    result.totalProcessed += batch.length;
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    result.errors.push({
                        item: batch,
                        error: errorMessage
                    });
                    if (!opts.continueOnError) {
                        throw error;
                    }
                }
            }
            if (client) {
                await client.query('COMMIT');
            }
        }
        catch (error) {
            if (client) {
                await client.query('ROLLBACK');
            }
            throw error;
        }
        finally {
            if (client) {
                client.release();
            }
        }
        result.durationMs = Date.now() - startTime;
        return result;
    }
    /**
     * Split array into chunks
     */
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
}
/**
 * Create a batch operations instance
 */
export function createBatchOperations(pool) {
    return new BatchOperations(pool);
}
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
export async function processBatchesWithConcurrency(items, batchSize, concurrencyLimit, processBatch) {
    if (items.length === 0)
        return [];
    // chunk into batches
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize));
    }
    const results = [];
    let activeCount = 0;
    let nextBatchIndex = 0;
    return new Promise((resolve, reject) => {
        const startNext = () => {
            while (activeCount < concurrencyLimit && nextBatchIndex < batches.length) {
                const batchIndex = nextBatchIndex++;
                const batch = batches[batchIndex];
                activeCount++;
                processBatch(batch, batchIndex)
                    .then((result) => {
                    results[batchIndex] = result;
                    activeCount--;
                    if (nextBatchIndex >= batches.length && activeCount === 0) {
                        resolve(results);
                    }
                    else {
                        startNext();
                    }
                })
                    .catch((error) => {
                    reject(error);
                });
            }
        };
        startNext();
    });
}
/**
 * DEFAULT_CONCURRENCY_LIMIT - safe default for parallel batch operations
 * 5 is a good balance between speed and not overwhelming the DB
 */
export const DEFAULT_CONCURRENCY_LIMIT = 10;
//# sourceMappingURL=batchOperations.js.map