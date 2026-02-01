/**
 * streamingQuery.ts - Cursor-Based Pagination and Query Streaming
 *
 * yo this handles MASSIVE result sets without blowing up memory
 * cursor-based pagination, streaming responses fr fr
 * handles millions of rows like a CHAMP
 *
 * Issue #41 fix - query result streaming
 */
import { logger } from '../utils/logger.js';
import { retryQuery, QUICK_RETRY_CONFIG } from '../utils/retryHelper.js';
import { Readable, Transform } from 'stream';
/**
 * Column selection presets for different use cases
 * Avoids fetching large content/embedding columns when not needed
 */
export const COLUMN_PRESETS = {
    /** Minimal columns for listings - just IDs and metadata */
    MINIMAL: ['id', 'created_at', 'importance', 'memory_type'],
    /** Summary columns for search results - includes truncated content */
    SUMMARY: ['id', 'created_at', 'updated_at', 'importance', 'memory_type', 'tags', 'expires_at'],
    /** Full columns - use sparingly, includes large fields */
    FULL: ['*'],
};
/**
 * CursorPaginator - handles cursor-based pagination
 *
 * Benefits over OFFSET/LIMIT:
 * - Consistent results even with concurrent inserts/deletes
 * - O(1) performance regardless of page number
 * - No "skipped rows" problem
 *
 * IMPORTANT: Project Isolation
 * Callers MUST include 'project_path = $N' in their WHERE clauses.
 * This paginator does NOT automatically filter by project.
 * Use getProjectPathForInsert() from services/ProjectContext.js
 */
export class CursorPaginator {
    pool;
    tableName;
    cursorColumn;
    constructor(pool, tableName, cursorColumn = 'id') {
        this.pool = pool;
        this.tableName = tableName;
        this.cursorColumn = cursorColumn;
    }
    /**
     * Get a page of results using cursor pagination
     */
    async getPage(options, whereClause, whereParams, orderBy) {
        const { pageSize, cursor, direction = 'forward', cursorColumn = this.cursorColumn, columns = 'SUMMARY' } = options;
        // Resolve columns - can be preset name or explicit array
        const resolvedColumns = typeof columns === 'string' && columns in COLUMN_PRESETS
            ? COLUMN_PRESETS[columns]
            : columns;
        // Build column list - ensure cursor column is always included
        const columnList = resolvedColumns[0] === '*'
            ? '*'
            : [...new Set([...resolvedColumns, cursorColumn])].join(', ');
        const params = [...(whereParams || [])];
        let whereConditions = whereClause ? [whereClause] : [];
        // Add cursor condition
        if (cursor) {
            const paramIndex = params.length + 1;
            if (direction === 'forward') {
                whereConditions.push(`${cursorColumn} > $${paramIndex}`);
            }
            else {
                whereConditions.push(`${cursorColumn} < $${paramIndex}`);
            }
            params.push(cursor);
        }
        const whereStr = whereConditions.length > 0
            ? `WHERE ${whereConditions.join(' AND ')}`
            : '';
        const order = orderBy || `${cursorColumn} ${direction === 'forward' ? 'ASC' : 'DESC'}`;
        // Fetch one extra to check if there are more results
        const limitWithExtra = pageSize + 1;
        params.push(limitWithExtra);
        const query = `
      SELECT ${columnList}
      FROM ${this.tableName}
      ${whereStr}
      ORDER BY ${order}
      LIMIT $${params.length}
    `;
        try {
            // retryQuery wraps with exponential backoff for transient failures
            const result = await retryQuery(this.pool, query, params, QUICK_RETRY_CONFIG);
            const rows = result.rows;
            const hasMore = rows.length > pageSize;
            const items = hasMore ? rows.slice(0, pageSize) : rows;
            // Calculate cursors
            let nextCursor = null;
            let prevCursor = null;
            if (items.length > 0) {
                const lastItem = items[items.length - 1];
                const firstItem = items[0];
                if (hasMore && lastItem) {
                    nextCursor = String(lastItem[cursorColumn]);
                }
                if (cursor && firstItem) {
                    prevCursor = String(firstItem[cursorColumn]);
                }
            }
            // Get total estimate (for UI purposes)
            const countQuery = `
        SELECT reltuples::bigint AS estimate
        FROM pg_class
        WHERE relname = $1
      `;
            const countResult = await retryQuery(this.pool, countQuery, [this.tableName], QUICK_RETRY_CONFIG);
            const totalEstimate = countResult.rows[0]?.estimate ?? undefined;
            return {
                items,
                pageSize,
                hasMore,
                nextCursor,
                prevCursor,
                totalEstimate: totalEstimate ? Number(totalEstimate) : undefined
            };
        }
        catch (error) {
            logger.error({ error, query, params }, 'cursor pagination query failed');
            throw error;
        }
    }
    /**
     * Encode cursor value for URL safety
     */
    static encodeCursor(value) {
        const str = value instanceof Date ? value.toISOString() : String(value);
        return Buffer.from(str).toString('base64url');
    }
    /**
     * Decode cursor value from URL-safe format
     */
    static decodeCursor(encoded) {
        return Buffer.from(encoded, 'base64url').toString('utf8');
    }
}
/**
 * QueryStreamer - streams large result sets
 *
 * Uses PostgreSQL cursors for true streaming without loading
 * all results into memory at once.
 *
 * IMPORTANT: Project Isolation
 * Callers MUST include 'project_path = $N' in their query WHERE clauses.
 * This streamer does NOT automatically filter by project.
 * Use getProjectPathForInsert() from services/ProjectContext.js
 */
export class QueryStreamer {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    /**
     * Stream query results using a PostgreSQL cursor
     */
    async *streamQuery(query, params = [], batchSize = 100) {
        const client = await this.pool.connect();
        try {
            // Start a transaction for the cursor
            await client.query('BEGIN');
            // Create a cursor
            const cursorName = `cursor_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            await client.query(`DECLARE ${cursorName} CURSOR FOR ${query}`, params);
            // Fetch batches
            while (true) {
                const result = await client.query(`FETCH ${batchSize} FROM ${cursorName}`);
                if (result.rows.length === 0) {
                    break;
                }
                yield result.rows;
                if (result.rows.length < batchSize) {
                    break; // Last batch
                }
            }
            // Close cursor and commit
            await client.query(`CLOSE ${cursorName}`);
            await client.query('COMMIT');
        }
        catch (error) {
            await client.query('ROLLBACK');
            logger.error({ error, query }, 'stream query failed');
            throw error;
        }
        finally {
            client.release();
        }
    }
    /**
     * Create a readable stream from a query
     */
    createReadableStream(query, params = [], options = { batchSize: 100 }) {
        const self = this;
        const { batchSize, transform, highWaterMark = 1000 } = options;
        let generator = null;
        return new Readable({
            objectMode: true,
            highWaterMark,
            async read() {
                try {
                    if (!generator) {
                        generator = self.streamQuery(query, params, batchSize);
                    }
                    const { value, done } = await generator.next();
                    if (done || !value) {
                        this.push(null);
                        return;
                    }
                    // Push each row individually
                    for (const row of value) {
                        const transformed = transform ? transform(row) : row;
                        if (!this.push(transformed)) {
                            // Backpressure - wait before reading more
                            break;
                        }
                    }
                }
                catch (error) {
                    this.destroy(error);
                }
            }
        });
    }
    /**
     * Stream results as NDJSON (newline-delimited JSON)
     */
    createNdjsonStream(query, params = [], options = { batchSize: 100 }) {
        const objectStream = this.createReadableStream(query, params, {
            ...options,
            transform: (row) => row
        });
        const ndjsonTransform = new Transform({
            objectMode: true,
            transform(chunk, _encoding, callback) {
                try {
                    const json = JSON.stringify(chunk);
                    callback(null, json + '\n');
                }
                catch (error) {
                    callback(error);
                }
            }
        });
        return objectStream.pipe(ndjsonTransform);
    }
    /**
     * Export query results to a file stream
     */
    async exportToStream(query, params = [], outputStream, format = 'ndjson') {
        let rowCount = 0;
        return new Promise((resolve, reject) => {
            let stream;
            if (format === 'ndjson') {
                stream = this.createNdjsonStream(query, params);
            }
            else if (format === 'json') {
                // JSON array format
                const objectStream = this.createReadableStream(query, params);
                let first = true;
                const jsonTransform = new Transform({
                    objectMode: true,
                    transform(chunk, _encoding, callback) {
                        try {
                            const prefix = first ? '[' : ',';
                            first = false;
                            callback(null, prefix + JSON.stringify(chunk));
                        }
                        catch (error) {
                            callback(error);
                        }
                    },
                    flush(callback) {
                        callback(null, first ? '[]' : ']');
                    }
                });
                stream = objectStream.pipe(jsonTransform);
            }
            else {
                // CSV format
                const objectStream = this.createReadableStream(query, params);
                let headerWritten = false;
                const csvTransform = new Transform({
                    objectMode: true,
                    transform(chunk, _encoding, callback) {
                        try {
                            const obj = chunk;
                            const keys = Object.keys(obj);
                            if (!headerWritten) {
                                headerWritten = true;
                                callback(null, keys.join(',') + '\n' + Object.values(obj).map(escapeCSV).join(',') + '\n');
                            }
                            else {
                                callback(null, Object.values(obj).map(escapeCSV).join(',') + '\n');
                            }
                        }
                        catch (error) {
                            callback(error);
                        }
                    }
                });
                stream = objectStream.pipe(csvTransform);
            }
            stream.on('data', () => {
                rowCount++;
            });
            stream.on('error', reject);
            stream.pipe(outputStream)
                .on('finish', () => resolve({ rowCount }))
                .on('error', reject);
        });
    }
}
/**
 * Escape a value for CSV output
 */
function escapeCSV(value) {
    if (value === null || value === undefined) {
        return '';
    }
    const str = String(value);
    // Escape quotes and wrap in quotes if contains comma, quote, or newline
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}
/**
 * Create a paginated response helper
 */
export function createPaginatedResponse(result, baseUrl) {
    return {
        data: result.items,
        pagination: {
            pageSize: result.pageSize,
            hasMore: result.hasMore,
            nextUrl: result.nextCursor
                ? `${baseUrl}?cursor=${CursorPaginator.encodeCursor(result.nextCursor)}&limit=${result.pageSize}`
                : null,
            prevUrl: result.prevCursor
                ? `${baseUrl}?cursor=${CursorPaginator.encodeCursor(result.prevCursor)}&limit=${result.pageSize}&direction=backward`
                : null,
            totalEstimate: result.totalEstimate
        }
    };
}
//# sourceMappingURL=streamingQuery.js.map