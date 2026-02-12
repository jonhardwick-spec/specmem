/**
 * FULLY DYNAMIC Embedding Projection Layer
 *
 * Projects embeddings between ANY dimensions - NO HARDCODED VALUES!
 * ALL dimensions are fetched from database (pgvector table metadata).
 *
 * Uses random projection (Johnson-Lindenstrauss lemma) - no GPU needed!
 *
 * Why this works:
 * - JL lemma proves random projections preserve pairwise distances
 * - Higher dimensions = better separation for cosine similarity
 * - Pre-computed matrix = zero training, instant deployment
 *
 * DATABASE IS THE SINGLE SOURCE OF TRUTH:
 * - Source dimension: detected from input embedding vector
 * - Target dimension: queried from memories table (pg_attribute.atttypmod)
 *
 * NO dimension constants, NO config file dimensions, NO hardcoded values!
 *
 * Performance: ~0.5ms per embedding on CPU
 */
/**
 * Get target dimension from database (with caching)
 * This is THE dimension embeddings should be projected to.
 * Returns null if database not available.
 */
export declare function getTargetDimension(): Promise<number | null>;
/**
 * Synchronously get cached target dimension
 * Returns cached value or null if not yet queried
 *
 * Use getTargetDimension() async version for guaranteed fresh value
 */
export declare function getCachedTargetDimension(): number | null;
/**
 * Set target dimension (for use when dimension is known externally)
 * Updates the cache - database remains source of truth
 */
export declare function setTargetDimension(dim: number): void;
/**
 * Detect and cache source dimension from an embedding
 */
export declare function detectSourceDimension(embedding: number[]): number;
/**
 * Clear dimension cache (forces re-fetch from database)
 */
export declare function clearDimensionCache(): void;
/**
 * Check if cache is stale
 */
export declare function isCacheStale(): boolean;
/**
 * Project embedding to target dimension (SYNC version)
 * Uses cached target dimension or explicit dimension
 *
 * @param embedding - Input embedding vector (any dimension)
 * @param targetDim - Optional explicit target dimension. If not provided, uses cached DB dimension.
 * @returns Projected embedding at target dimension
 */
export declare function projectEmbedding(embedding: number[], targetDim?: number): number[];
/**
 * Project embedding to target dimension (ASYNC version)
 * Queries database for target dimension if not cached
 *
 * @param embedding - Input embedding vector (any dimension)
 * @returns Projected embedding at database target dimension
 */
export declare function projectEmbeddingAsync(embedding: number[]): Promise<number[]>;
/**
 * Validate embedding matches expected dimension
 * Returns true if valid, false if dimension mismatch
 */
export declare function validateEmbeddingDimension(embedding: number[], expectedDim?: number): boolean;
/**
 * Batch project multiple embeddings (SYNC version)
 */
export declare function projectEmbeddingBatch(embeddings: number[][], targetDim?: number): number[][];
/**
 * Batch project multiple embeddings (ASYNC version)
 * Queries database once for dimension, applies to all embeddings
 */
export declare function projectEmbeddingBatchAsync(embeddings: number[][]): Promise<number[][]>;
/**
 * Get projection layer info (FULLY DYNAMIC)
 * All dimensions come from runtime - no hardcoded values!
 */
export declare function getProjectionInfo(): {
    sourceDim: number | null;
    targetDim: number | null;
    method: string;
    isDynamic: boolean;
    cacheAgeMs: number;
    isCacheStale: boolean;
    matrixCacheSize: number;
};
/**
 * Get projection info (ASYNC version that queries database)
 */
export declare function getProjectionInfoAsync(): Promise<{
    sourceDim: number | null;
    targetDim: number | null;
    method: string;
    isDynamic: boolean;
    fromDatabase: boolean;
}>;
/**
 * Pre-warm the dimension cache from database
 * Call this after database is ready for optimal performance
 */
export declare function warmDimensionCache(): Promise<{
    sourceDim: number | null;
    targetDim: number | null;
}>;
//# sourceMappingURL=projectionLayer.d.ts.map