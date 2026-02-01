/**
 * DimensionService - Centralized embedding dimension management
 *
 * DEPRECATED: This service is now largely obsolete.
 *
 * Embedding dimensions are now AUTO-DETECTED from the database pgvector column.
 * The SPECMEM_EMBEDDING_DIMENSIONS environment variable is DEPRECATED and ignored.
 * The database pg_attribute table is the single source of truth for dimensions.
 *
 * The Frankenstein embedding model outputs 384-dim embeddings, and the system
 * dynamically detects this from the actual embeddings and the database schema.
 *
 * This service remains for backwards compatibility but should NOT be used for
 * new code. Use the projectionLayer.ts getTargetDimension() function instead.
 *
 * @author specmem team
 * @deprecated Use projectionLayer.ts for dimension detection
 */
/**
 * DimensionService provides centralized management of embedding vector dimensions.
 *
 * DEPRECATED: This service is now largely obsolete.
 * Dimensions are auto-detected from the database pg_attribute table.
 * Use projectionLayer.ts getTargetDimension() for new code.
 *
 * @deprecated
 */
export declare class DimensionService {
    private static cachedDimension;
    /**
     * Get the configured embedding dimension.
     *
     * DEPRECATED: Dimensions are now auto-detected from the database.
     * This method only provides a fallback value for legacy compatibility.
     *
     * The database pg_attribute table is the single source of truth.
     * Use projectionLayer.ts getTargetDimension() for new code.
     *
     * Common dimensions (for reference only):
     * - 384: all-MiniLM-L6-v2 (Frankenstein)
     * - 768: all-mpnet-base-v2
     * - 1024: Cohere embed-english-v3.0
     * - 1536: OpenAI text-embedding-3-small, Ada-002
     * - 3072: OpenAI text-embedding-3-large
     *
     * @deprecated Use projectionLayer.ts getTargetDimension()
     */
    static getDimension(): number;
    /**
     * Get the SQL column definition for a vector column.
     * Use this in CREATE TABLE statements.
     *
     * @example
     * const sql = `CREATE TABLE foo (
     *   embedding ${DimensionService.getVectorColumnDef()}
     * )`;
     */
    static getVectorColumnDef(): string;
    /**
     * Get the SQL column definition with NOT NULL constraint.
     */
    static getVectorColumnDefNotNull(): string;
    /**
     * Generate SQL to alter a table's embedding column dimension.
     *
     * WARNING: This requires dropping and recreating the column,
     * which means data loss. Use syncTableDimensionSafe for production.
     *
     * @param tableName Table name
     * @param columnName Column name (default: 'embedding')
     */
    static getAlterDimensionSQL(tableName: string, columnName?: string): string;
    /**
     * Sync a table's embedding column to the configured dimension.
     * This is a DESTRUCTIVE operation that clears existing embeddings.
     *
     * @param db Database manager instance
     * @param tableName Table to sync
     * @param columnName Column name (default: 'embedding')
     * @returns true if altered, false if already correct dimension
     */
    static syncTableDimension(db: {
        query: (sql: string, params?: unknown[]) => Promise<{
            rows: any[];
        }>;
    }, tableName: string, columnName?: string): Promise<{
        altered: boolean;
        previousDim?: number;
        newDim: number;
    }>;
    /**
     * Get all tables with embedding columns and their current dimensions.
     * Useful for debugging and migration planning.
     */
    static getTableDimensions(db: {
        query: (sql: string) => Promise<{
            rows: any[];
        }>;
    }): Promise<Array<{
        table: string;
        column: string;
        dimension: number;
    }>>;
    /**
     * Sync ALL tables to the configured dimension.
     * This is a DESTRUCTIVE operation - use with caution!
     *
     * @param db Database manager
     * @returns Summary of changes
     */
    static syncAllTables(db: {
        query: (sql: string, params?: unknown[]) => Promise<{
            rows: any[];
        }>;
    }): Promise<{
        total: number;
        altered: number;
        skipped: number;
        errors: Array<{
            table: string;
            error: string;
        }>;
    }>;
    /**
     * Clear the cached dimension.
     * Useful for testing or when config changes at runtime.
     */
    static clearCache(): void;
    /**
     * Generate a comment for SQL files explaining the dynamic dimension.
     * Add this to all SQL files with vector columns.
     *
     * DEPRECATED: Dimensions are now auto-detected from the database.
     */
    static getSQLComment(): string;
}
export declare const getDimension: () => number;
export declare const getVectorColumnDef: () => string;
export default DimensionService;
//# sourceMappingURL=dimensionService.d.ts.map