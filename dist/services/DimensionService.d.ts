/**
 * DimensionService - SINGLE SOURCE OF TRUTH for Embedding Dimensions
 *
 * Provides centralized dimension lookup from the database.
 * NO hardcoded dimension values - always queries actual DB state.
 *
 * Features:
 * - Get expected dimension from database tables (NOT config)
 * - Validate query vectors match table dimensions
 * - Re-embed content when dimensions mismatch
 * - Scale embeddings when re-embedding isn't possible
 * - Sync check across all embedding tables
 * - Brief caching (60s TTL) with forced refresh option
 * - Singleton pattern for efficiency
 *
 * Usage:
 *   const dimService = getDimensionService(db, embeddingProvider);
 *   const dimension = await dimService.getEmbeddingDimension(); // From memories table
 *   const validation = await dimService.validateDimension(embedding);
 *   const syncResult = await dimService.syncTableDimensions();
 */
import type { DatabaseManager } from '../database.js';
import type { EmbeddingProvider } from '../types/index.js';
/**
 * Result of dimension validation (detailed)
 */
export interface DimensionValidationResult {
    isValid: boolean;
    queryDimension: number;
    tableDimension: number | null;
    action: 'proceed' | 'reembed' | 'scale' | 'error';
    error?: string;
}
/**
 * Result of simple dimension validation
 */
export interface SimpleDimensionValidation {
    valid: boolean;
    expectedDimension: number | null;
    actualDimension: number;
    message: string;
}
/**
 * Result of sync operation
 */
export interface DimensionSyncResult {
    success: boolean;
    canonicalDimension: number;
    tablesChecked: string[];
    inconsistencies: Array<{
        tableName: string;
        dimension: number | null;
        expectedDimension: number;
    }>;
    message: string;
}
/**
 * Result of validateAndPrepare operation
 */
export interface PreparedEmbedding {
    embedding: number[];
    wasModified: boolean;
    action: 'proceed' | 'reembedded' | 'scaled';
}
/**
 * Service for dynamic embedding dimension management.
 * All dimension lookups go through the database - no hardcoded values.
 */
export declare class DimensionService {
    private db;
    private embeddingProvider;
    private dimensionCache;
    private readonly CACHE_TTL_MS;
    constructor(db: DatabaseManager, embeddingProvider?: EmbeddingProvider);
    /**
     * Set the embedding provider (for lazy initialization)
     */
    setEmbeddingProvider(provider: EmbeddingProvider): void;
    /**
     * Get the embedding dimension for a table's vector column.
     * Queries pg_attribute directly - no hardcoded fallbacks.
     *
     * @param tableName - Table to query (e.g., 'memories')
     * @param columnName - Vector column name (default: 'embedding')
     * @returns The dimension, or null if table/column doesn't exist
     */
    getTableDimension(tableName: string, columnName?: string): Promise<number | null>;
    /**
     * Get dimension for the main memories table.
     * This is the primary table used for memory storage.
     */
    getMemoriesTableDimension(): Promise<number | null>;
    /**
     * Get the current embedding dimension from the memories table.
     * This is the canonical source of truth for embedding dimensions.
     *
     * @param forceRefresh - Skip cache and query database directly
     * @returns The dimension (throws if cannot be determined)
     */
    getEmbeddingDimension(forceRefresh?: boolean): Promise<number>;
    /**
     * Simple validation that an embedding matches the expected dimension.
     * Returns a structured result with detailed information.
     *
     * @param embedding - The embedding array to validate
     * @param tableName - Optional table name to validate against (defaults to 'memories')
     * @returns SimpleDimensionValidation with validity and details
     */
    checkDimension(embedding: number[], tableName?: string): Promise<SimpleDimensionValidation>;
    /**
     * Ensure all embedding tables have consistent dimensions.
     * Checks all known embedding tables against the memories table dimension.
     * Does NOT automatically fix inconsistencies (that requires migration).
     *
     * @param forceRefresh - Skip cache and query database directly
     * @returns DimensionSyncResult with details about any inconsistencies
     */
    syncTableDimensions(forceRefresh?: boolean): Promise<DimensionSyncResult>;
    /**
     * Get all table dimensions at once.
     *
     * @param forceRefresh - Skip cache and query database directly
     * @returns Map of table name to dimension (null if table doesn't have embedding column)
     */
    getAllTableDimensions(forceRefresh?: boolean): Promise<Map<string, number | null>>;
    /**
     * Check if a table exists and has an embedding column.
     */
    hasEmbeddingColumn(tableName: string): Promise<boolean>;
    /**
     * Get cache statistics for debugging.
     */
    getCacheStats(): {
        size: number;
        entries: Array<{
            key: string;
            age: number;
        }>;
    };
    /**
     * Validate that an embedding matches the expected dimension for a table.
     *
     * @param embedding - The embedding vector to validate
     * @param tableName - Table to check against
     * @returns true if dimensions match, false otherwise
     * @throws Error if table dimension cannot be determined
     */
    validateEmbeddingDimension(embedding: number[], tableName?: string): Promise<boolean>;
    /**
     * Get the SQL type string for creating a vector column with dynamic dimension.
     *
     * @param tableName - Table to base dimension on (queries existing dimension)
     * @param fallbackDimension - Dimension to use if table doesn't exist yet
     * @returns SQL type string like 'vector(1536)'
     */
    getVectorTypeSQL(tableName?: string, fallbackDimension?: number): Promise<string>;
    /**
     * Clear the dimension cache.
     * Call this after altering vector columns.
     */
    clearCache(): void;
    /**
     * Invalidate cache for a specific table.
     */
    invalidateTable(tableName: string): void;
    /**
     * Validate a query embedding against a table's expected dimension.
     *
     * @param tableName - The table to search
     * @param queryEmbedding - The embedding to validate
     * @param columnName - The embedding column name
     * @returns Validation result with action recommendation
     */
    validateDimension(tableName: string, queryEmbedding: number[], columnName?: string): Promise<DimensionValidationResult>;
    /**
     * Validate and prepare an embedding for search.
     * If dimension mismatch, will re-embed or scale as needed.
     *
     * @param tableName - The table to search
     * @param queryEmbedding - The original embedding
     * @param originalText - The original text (for re-embedding if needed)
     * @param columnName - The embedding column name
     * @returns The corrected embedding or original if valid
     */
    validateAndPrepare(tableName: string, queryEmbedding: number[], originalText?: string, columnName?: string): Promise<PreparedEmbedding>;
    /**
     * Scale an embedding to a target dimension.
     * Uses interpolation for downscaling, linear interpolation for upscaling.
     * Normalizes result to maintain unit length for cosine similarity.
     *
     * @param embedding - The source embedding
     * @param targetDim - The target dimension
     * @returns Scaled embedding
     */
    scaleEmbedding(embedding: number[], targetDim: number): number[];
    /**
     * Format an embedding for PostgreSQL vector insertion.
     * Validates dimension before formatting.
     *
     * @param embedding - The embedding array
     * @param tableName - The target table (for dimension validation)
     * @param originalText - Original text for re-embedding if needed
     * @param columnName - The embedding column name
     * @returns Formatted string for PostgreSQL (e.g., "[0.1,0.2,...]")
     */
    formatForPostgres(embedding: number[], tableName?: string, originalText?: string, columnName?: string): Promise<string>;
}
/**
 * Get the singleton DimensionService instance.
 * Must be initialized with a DatabaseManager first.
 *
 * @param db - DatabaseManager (required on first call)
 * @param embeddingProvider - Optional EmbeddingProvider for re-embedding support
 */
export declare function getDimensionService(db?: DatabaseManager, embeddingProvider?: EmbeddingProvider): DimensionService;
/**
 * Reset the singleton (for testing)
 */
export declare function resetDimensionService(): void;
/**
 * Quick helper to get the current embedding dimension from the memories table.
 * Throws if dimension cannot be determined.
 *
 * @param forceRefresh - Skip cache and query database directly
 * @returns The dimension from the memories table
 */
export declare function getEmbeddingDimension(forceRefresh?: boolean): Promise<number>;
/**
 * Quick helper to validate an embedding dimension.
 *
 * @param embedding - The embedding to validate
 * @param tableName - Table to validate against (defaults to 'memories')
 * @returns SimpleDimensionValidation result
 */
export declare function validateEmbeddingDimension(embedding: number[], tableName?: string): Promise<SimpleDimensionValidation>;
/**
 * Quick helper to get a specific table's dimension.
 *
 * @param tableName - Table name to query
 * @param forceRefresh - Skip cache and query database directly
 * @returns Dimension or null if table doesn't have embedding column
 */
export declare function getTableEmbeddingDimension(tableName: string, forceRefresh?: boolean): Promise<number | null>;
/**
 * Quick helper to check dimension consistency across all embedding tables.
 *
 * @param forceRefresh - Skip cache and query database directly
 * @returns DimensionSyncResult with details about any inconsistencies
 */
export declare function syncEmbeddingDimensions(forceRefresh?: boolean): Promise<DimensionSyncResult>;
export { DimensionAdapter, getDimensionAdapter, resetDimensionAdapter, initializeDimensionAdapter, adaptEmbedding, getCanonicalDimension, type VectorColumnInfo, type DimensionDetectionResult, type AdaptedEmbedding } from './DimensionAdapter.js';
//# sourceMappingURL=DimensionService.d.ts.map