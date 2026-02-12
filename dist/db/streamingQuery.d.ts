/**
 * streamingQuery.ts - Cursor-Based Pagination and Query Streaming
 *
 * yo this handles MASSIVE result sets without blowing up memory
 * cursor-based pagination, streaming responses fr fr
 * handles millions of rows like a CHAMP
 *
 * Issue #41 fix - query result streaming
 */
import { Pool, QueryResultRow } from 'pg';
import { Readable } from 'stream';
/**
 * Column selection presets for different use cases
 * Avoids fetching large content/embedding columns when not needed
 */
export declare const COLUMN_PRESETS: {
    /** Minimal columns for listings - just IDs and metadata */
    readonly MINIMAL: readonly ["id", "created_at", "importance", "memory_type"];
    /** Summary columns for search results - includes truncated content */
    readonly SUMMARY: readonly ["id", "created_at", "updated_at", "importance", "memory_type", "tags", "expires_at"];
    /** Full columns - use sparingly, includes large fields */
    readonly FULL: readonly ["*"];
};
export type ColumnPreset = keyof typeof COLUMN_PRESETS;
/**
 * Cursor pagination options
 */
export interface CursorPaginationOptions {
    /** Number of items per page */
    pageSize: number;
    /** Cursor value (usually an ID or timestamp) */
    cursor?: string;
    /** Direction: 'forward' or 'backward' */
    direction?: 'forward' | 'backward';
    /** Column to use for cursor (default: 'id') */
    cursorColumn?: string;
    /**
     * Columns to select - avoids fetching large content/embedding fields
     * Can be: array of column names, a preset name, or undefined for SUMMARY preset
     * Use COLUMN_PRESETS.FULL or ['*'] only when you need content/embedding
     */
    columns?: readonly string[] | ColumnPreset;
}
/**
 * Paginated result
 */
export interface PaginatedResult<T> {
    items: T[];
    pageSize: number;
    hasMore: boolean;
    nextCursor: string | null;
    prevCursor: string | null;
    totalEstimate?: number;
}
/**
 * Stream options
 */
export interface StreamOptions {
    /** Batch size for streaming */
    batchSize: number;
    /** Transform function for each row */
    transform?: (row: QueryResultRow) => unknown;
    /** High water mark for stream backpressure */
    highWaterMark?: number;
}
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
export declare class CursorPaginator<T extends QueryResultRow> {
    private pool;
    private tableName;
    private cursorColumn;
    constructor(pool: Pool, tableName: string, cursorColumn?: string);
    /**
     * Get a page of results using cursor pagination
     */
    getPage(options: CursorPaginationOptions, whereClause?: string, whereParams?: unknown[], orderBy?: string): Promise<PaginatedResult<T>>;
    /**
     * Encode cursor value for URL safety
     */
    static encodeCursor(value: string | number | Date): string;
    /**
     * Decode cursor value from URL-safe format
     */
    static decodeCursor(encoded: string): string;
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
export declare class QueryStreamer {
    private pool;
    constructor(pool: Pool);
    /**
     * Stream query results using a PostgreSQL cursor
     */
    streamQuery<T extends QueryResultRow>(query: string, params?: unknown[], batchSize?: number): AsyncGenerator<T[], void, unknown>;
    /**
     * Create a readable stream from a query
     */
    createReadableStream<T extends QueryResultRow>(query: string, params?: unknown[], options?: StreamOptions): Readable;
    /**
     * Stream results as NDJSON (newline-delimited JSON)
     */
    createNdjsonStream<T extends QueryResultRow>(query: string, params?: unknown[], options?: Omit<StreamOptions, 'transform'>): Readable;
    /**
     * Export query results to a file stream
     */
    exportToStream<T extends QueryResultRow>(query: string, params: unknown[], outputStream: NodeJS.WritableStream, format?: 'json' | 'ndjson' | 'csv'): Promise<{
        rowCount: number;
    }>;
}
/**
 * Create a paginated response helper
 */
export declare function createPaginatedResponse<T>(result: PaginatedResult<T>, baseUrl: string): {
    data: T[];
    pagination: {
        pageSize: number;
        hasMore: boolean;
        nextUrl: string | null;
        prevUrl: string | null;
        totalEstimate?: number;
    };
};
//# sourceMappingURL=streamingQuery.d.ts.map