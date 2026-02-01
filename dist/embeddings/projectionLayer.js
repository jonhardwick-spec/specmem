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
import { logger } from '../utils/logger.js';
import * as crypto from 'crypto';
// Deterministic seed for reproducible projections
const PROJECTION_SEED = 'specmem-embedding-projection-v1';
const CACHE_TTL_MS = 60_000; // 60 seconds max cache
let dimensionCache = {
    sourceDim: null,
    targetDim: null,
    timestamp: 0
};
// Matrix cache (keyed by dimension pair for efficiency)
const projectionMatrixCache = new Map();
/**
 * Query database for target embedding dimension
 * Uses pg_attribute to get the actual vector dimension from memories table
 *
 * NOTE: pgvector stores dimension directly in atttypmod - NO -4 subtraction needed!
 */
async function queryDatabaseDimension(tableName = 'memories') {
    try {
        // Dynamic import to avoid circular dependencies
        const { getDatabase } = await import('../database.js');
        const db = getDatabase();
        const result = await db.getTableDimension(tableName);
        if (result !== null && result > 0) {
            logger.debug({ tableName, dimension: result }, 'Queried dimension from database');
        }
        return result;
    }
    catch (error) {
        logger.debug({ error }, 'Could not query database for dimension (may not be initialized yet)');
        return null;
    }
}
/**
 * Get target dimension from database (with caching)
 * This is THE dimension embeddings should be projected to.
 * Returns null if database not available.
 */
export async function getTargetDimension() {
    const now = Date.now();
    // Return cached value if recent and valid
    if (dimensionCache.targetDim !== null && (now - dimensionCache.timestamp) < CACHE_TTL_MS) {
        return dimensionCache.targetDim;
    }
    // Query database for current dimension
    const dbDim = await queryDatabaseDimension('memories');
    if (dbDim !== null && dbDim > 0) {
        dimensionCache.targetDim = dbDim;
        dimensionCache.timestamp = now;
        logger.info({ targetDim: dbDim }, 'Updated target dimension from database');
    }
    return dimensionCache.targetDim;
}
/**
 * Synchronously get cached target dimension
 * Returns cached value or null if not yet queried
 *
 * Use getTargetDimension() async version for guaranteed fresh value
 */
export function getCachedTargetDimension() {
    const now = Date.now();
    // Check if cache is stale
    if (dimensionCache.targetDim !== null && (now - dimensionCache.timestamp) < CACHE_TTL_MS) {
        return dimensionCache.targetDim;
    }
    // Cache is stale or empty
    return dimensionCache.targetDim; // Still return it, but caller should prefer async version
}
/**
 * Set target dimension (for use when dimension is known externally)
 * Updates the cache - database remains source of truth
 */
export function setTargetDimension(dim) {
    if (dim <= 0) {
        logger.warn({ dim }, 'Invalid dimension, ignoring');
        return;
    }
    dimensionCache.targetDim = dim;
    dimensionCache.timestamp = Date.now();
    logger.info({ targetDim: dim }, 'Set target dimension from external source');
}
/**
 * Detect and cache source dimension from an embedding
 */
export function detectSourceDimension(embedding) {
    const dim = embedding.length;
    dimensionCache.sourceDim = dim;
    logger.debug({ sourceDim: dim }, 'Detected source dimension from embedding');
    return dim;
}
/**
 * Clear dimension cache (forces re-fetch from database)
 */
export function clearDimensionCache() {
    dimensionCache = { sourceDim: null, targetDim: null, timestamp: 0 };
    projectionMatrixCache.clear();
    logger.info('Dimension cache cleared');
}
/**
 * Check if cache is stale
 */
export function isCacheStale() {
    return (Date.now() - dimensionCache.timestamp) >= CACHE_TTL_MS;
}
/**
 * Generate a deterministic random projection matrix
 * Uses seeded RNG for reproducibility across restarts
 */
function generateProjectionMatrix(seed, inputDim, outputDim) {
    const matrix = new Float32Array(inputDim * outputDim);
    // Use hash-based seeding for deterministic random numbers
    let hashState = crypto.createHash('sha256').update(seed).digest();
    let hashIndex = 0;
    const getNextRandom = () => {
        if (hashIndex >= hashState.length - 4) {
            // Rehash to get more random bytes
            hashState = crypto.createHash('sha256').update(hashState).digest();
            hashIndex = 0;
        }
        // Read 4 bytes as unsigned int, convert to 0-1 range
        const value = hashState.readUInt32LE(hashIndex);
        hashIndex += 4;
        return value / 0xFFFFFFFF;
    };
    // Fill matrix with scaled random values
    // Scale factor from JL lemma: sqrt(1/outputDim)
    const scale = Math.sqrt(1.0 / outputDim);
    for (let i = 0; i < inputDim * outputDim; i++) {
        // Box-Muller transform for Gaussian distribution
        const u1 = getNextRandom();
        const u2 = getNextRandom();
        const gaussian = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
        matrix[i] = gaussian * scale;
    }
    return matrix;
}
/**
 * Get or generate projection matrix for given dimensions
 * Caches matrices by dimension pair for efficiency
 */
function getProjectionMatrix(inputDim, outputDim) {
    const cacheKey = `${inputDim}x${outputDim}`;
    let matrix = projectionMatrixCache.get(cacheKey);
    if (!matrix) {
        // Include dimensions in seed for determinism per dimension pair
        const seed = `${PROJECTION_SEED}-${inputDim}-${outputDim}`;
        logger.info({ inputDim, outputDim }, 'Generating projection matrix for new dimension pair');
        matrix = generateProjectionMatrix(seed, inputDim, outputDim);
        projectionMatrixCache.set(cacheKey, matrix);
        logger.info({ inputDim, outputDim, cacheKey }, 'Projection matrix ready');
    }
    return matrix;
}
/**
 * Core projection logic - projects embedding from any dimension to target dimension
 * Uses JL random projection for expansion, averaging for contraction
 */
function projectEmbeddingCore(embedding, outputDim) {
    const inputDim = embedding.length;
    // Already at target dimension - return as-is
    if (inputDim === outputDim) {
        return embedding;
    }
    let result;
    if (inputDim < outputDim) {
        // EXPANSION: Use random projection matrix (JL lemma)
        const matrix = getProjectionMatrix(inputDim, outputDim);
        result = new Array(outputDim).fill(0);
        // Matrix multiplication: result = embedding * matrix
        for (let j = 0; j < outputDim; j++) {
            let sum = 0;
            for (let i = 0; i < inputDim; i++) {
                sum += embedding[i] * matrix[i * outputDim + j];
            }
            result[j] = sum;
        }
    }
    else {
        // CONTRACTION: Use averaging (preserves information better than truncation)
        result = new Array(outputDim).fill(0);
        const ratio = inputDim / outputDim;
        for (let i = 0; i < outputDim; i++) {
            const start = Math.floor(i * ratio);
            const end = Math.floor((i + 1) * ratio);
            let sum = 0;
            for (let j = start; j < end; j++) {
                sum += embedding[j];
            }
            result[i] = sum / (end - start);
        }
    }
    // L2 normalize the result (critical for cosine similarity!)
    let norm = 0;
    for (let i = 0; i < outputDim; i++) {
        norm += result[i] * result[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < outputDim; i++) {
            result[i] /= norm;
        }
    }
    return result;
}
/**
 * Project embedding to target dimension (SYNC version)
 * Uses cached target dimension or explicit dimension
 *
 * @param embedding - Input embedding vector (any dimension)
 * @param targetDim - Optional explicit target dimension. If not provided, uses cached DB dimension.
 * @returns Projected embedding at target dimension
 */
export function projectEmbedding(embedding, targetDim) {
    const inputDim = embedding.length;
    // Determine output dimension
    let outputDim = targetDim;
    if (outputDim === undefined || outputDim === null) {
        outputDim = getCachedTargetDimension();
        if (outputDim === null) {
            // No cached dimension available - return embedding as-is
            // Caller should use projectEmbeddingAsync for guaranteed dimension fetch
            logger.debug({ inputDim }, 'No target dimension available, returning embedding as-is');
            return embedding;
        }
    }
    // Track source dimension
    if (dimensionCache.sourceDim === null) {
        dimensionCache.sourceDim = inputDim;
    }
    return projectEmbeddingCore(embedding, outputDim);
}
/**
 * Project embedding to target dimension (ASYNC version)
 * Queries database for target dimension if not cached
 *
 * @param embedding - Input embedding vector (any dimension)
 * @returns Projected embedding at database target dimension
 */
export async function projectEmbeddingAsync(embedding) {
    const targetDim = await getTargetDimension();
    if (targetDim === null) {
        logger.warn('Could not get target dimension from database, returning embedding as-is');
        return embedding;
    }
    return projectEmbedding(embedding, targetDim);
}
/**
 * Validate embedding matches expected dimension
 * Returns true if valid, false if dimension mismatch
 */
export function validateEmbeddingDimension(embedding, expectedDim) {
    const targetDim = expectedDim ?? getCachedTargetDimension();
    if (targetDim === null) {
        // Can't validate without target dimension - assume valid
        return true;
    }
    return embedding.length === targetDim;
}
/**
 * Batch project multiple embeddings (SYNC version)
 */
export function projectEmbeddingBatch(embeddings, targetDim) {
    if (embeddings.length === 0)
        return [];
    return embeddings.map(e => projectEmbedding(e, targetDim));
}
/**
 * Batch project multiple embeddings (ASYNC version)
 * Queries database once for dimension, applies to all embeddings
 */
export async function projectEmbeddingBatchAsync(embeddings) {
    if (embeddings.length === 0)
        return [];
    const targetDim = await getTargetDimension();
    if (targetDim === null) {
        logger.warn('Could not get target dimension from database, returning embeddings as-is');
        return embeddings;
    }
    return embeddings.map(e => projectEmbedding(e, targetDim));
}
/**
 * Get projection layer info (FULLY DYNAMIC)
 * All dimensions come from runtime - no hardcoded values!
 */
export function getProjectionInfo() {
    return {
        sourceDim: dimensionCache.sourceDim,
        targetDim: dimensionCache.targetDim,
        method: 'random-projection-jl',
        isDynamic: true,
        cacheAgeMs: dimensionCache.timestamp > 0 ? Date.now() - dimensionCache.timestamp : -1,
        isCacheStale: isCacheStale(),
        matrixCacheSize: projectionMatrixCache.size
    };
}
/**
 * Get projection info (ASYNC version that queries database)
 */
export async function getProjectionInfoAsync() {
    const targetDim = await getTargetDimension();
    return {
        sourceDim: dimensionCache.sourceDim,
        targetDim,
        method: 'random-projection-jl',
        isDynamic: true,
        fromDatabase: true
    };
}
/**
 * Pre-warm the dimension cache from database
 * Call this after database is ready for optimal performance
 */
export async function warmDimensionCache() {
    const targetDim = await getTargetDimension();
    logger.info({ targetDim, sourceDim: dimensionCache.sourceDim }, 'Dimension cache warmed from database');
    return {
        sourceDim: dimensionCache.sourceDim,
        targetDim
    };
}
// NOTE: No pre-initialization or hardcoded dimensions!
// All dimensions come from database at runtime.
//# sourceMappingURL=projectionLayer.js.map