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
import { logger } from '../utils/logger.js';
/**
 * Tables known to have embedding columns
 * Used by syncTableDimensions() to check consistency
 */
const EMBEDDING_TABLES = [
    'memories',
    'embedding_cache',
    'embedding_cache_overflow',
    'codebase_files',
    'code_pointers',
    'memorization_patterns',
    'semantic_quadrants',
    'semantic_clusters',
    'trace_patterns',
    'trace_solutions',
    'trace_contexts',
    'processed_training'
];
/**
 * Service for dynamic embedding dimension management.
 * All dimension lookups go through the database - no hardcoded values.
 *
 * Issue #15 FIX: Cache TTL is now configurable via SPECMEM_DIMENSION_CACHE_TTL_MS (default 300000 = 5min).
 * Stale cache entries are kept as fallback on fetch failure but logged as warnings.
 * Dimension override via SPECMEM_EMBEDDING_DIMENSIONS env var.
 * invalidateCache() method for embedding service restart coordination.
 */
export class DimensionService {
    db;
    embeddingProvider = null;
    dimensionCache = new Map();
    // Issue #15 FIX: Cache TTL is env-var configurable (default 5 minutes)
    CACHE_TTL_MS = parseInt(process.env['SPECMEM_DIMENSION_CACHE_TTL_MS'] || '300000', 10);
    // Issue #15 FIX: Track last successful verification timestamp
    lastVerified = null;
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider || null;
        logger.info({
            cacheTtlMs: this.CACHE_TTL_MS,
            dimensionOverride: process.env['SPECMEM_EMBEDDING_DIMENSIONS'] || 'auto-detect'
        }, 'DimensionService initialized with configurable cache TTL (Issue #15 fix)');
    }
    /**
     * Set the embedding provider (for lazy initialization)
     */
    setEmbeddingProvider(provider) {
        this.embeddingProvider = provider;
    }
    /**
     * Get the embedding dimension for a table's vector column.
     * Queries pg_attribute directly - no hardcoded fallbacks.
     *
     * @param tableName - Table to query (e.g., 'memories')
     * @param columnName - Vector column name (default: 'embedding')
     * @returns The dimension, or null if table/column doesn't exist
     */
    async getTableDimension(tableName, columnName = 'embedding') {
        // Issue #15 FIX: Check for dimension override via env var (skip DB entirely)
        const dimensionOverride = parseInt(process.env['SPECMEM_EMBEDDING_DIMENSIONS'] || '0', 10);
        if (dimensionOverride > 0) {
            logger.debug({ dimensionOverride, tableName }, 'Using SPECMEM_EMBEDDING_DIMENSIONS override');
            return dimensionOverride;
        }
        // Check cache first - Issue #15 FIX: Use configurable TTL
        const cacheKey = `${tableName}.${columnName}`;
        const cached = this.dimensionCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
            return cached.dimension;
        }
        // Issue #15 FIX: If cache expired, log it for debugging stale cache issues
        if (cached) {
            const ageMs = Date.now() - cached.timestamp;
            logger.debug({ cacheKey, ageMs, ttl: this.CACHE_TTL_MS }, 'Dimension cache expired, re-fetching from database');
        }
        try {
            const result = await this.db.query(`SELECT atttypmod FROM pg_attribute
         WHERE attrelid = $1::regclass AND attname = $2`, [tableName, columnName]);
            if (result.rows.length === 0) {
                logger.warn({ tableName, columnName }, 'Vector column not found');
                return null;
            }
            const dimension = result.rows[0].atttypmod;
            // Cache the result with timestamp for TTL and lastVerified tracking
            this.dimensionCache.set(cacheKey, { dimension, timestamp: Date.now() });
            this.lastVerified = Date.now();
            logger.debug({ tableName, columnName, dimension }, 'Retrieved vector dimension from database');
            return dimension;
        }
        catch (error) {
            // Issue #15 FIX: If fetch fails but we have a stale cached value, use it
            // and log a warning. This prevents dimension mismatch errors during transient DB issues.
            if (cached) {
                logger.warn({
                    error: error instanceof Error ? error.message : String(error),
                    tableName,
                    columnName,
                    staleDimension: cached.dimension,
                    staleAgeMs: Date.now() - cached.timestamp
                }, 'Failed to refresh dimension from DB - using stale cached value. Will retry on next access.');
                // Do NOT update the timestamp - keep it stale so next access retries
                return cached.dimension;
            }
            // Table might not exist yet and no cache to fall back on
            logger.debug({ error, tableName, columnName }, 'Failed to get dimension (table may not exist, no cache fallback)');
            return null;
        }
    }
    /**
     * Get dimension for the main memories table.
     * This is the primary table used for memory storage.
     */
    async getMemoriesTableDimension() {
        return this.getTableDimension('memories', 'embedding');
    }
    /**
     * Get the current embedding dimension from the memories table.
     * This is the canonical source of truth for embedding dimensions.
     *
     * @param forceRefresh - Skip cache and query database directly
     * @returns The dimension (throws if cannot be determined)
     */
    async getEmbeddingDimension(forceRefresh = false) {
        if (forceRefresh) {
            this.invalidateTable('memories');
        }
        const dimension = await this.getMemoriesTableDimension();
        if (dimension === null) {
            throw new Error('Cannot determine embedding dimension: memories table does not exist or has no embedding column');
        }
        return dimension;
    }
    /**
     * Simple validation that an embedding matches the expected dimension.
     * Returns a structured result with detailed information.
     *
     * @param embedding - The embedding array to validate
     * @param tableName - Optional table name to validate against (defaults to 'memories')
     * @returns SimpleDimensionValidation with validity and details
     */
    async checkDimension(embedding, tableName = 'memories') {
        const actualDimension = embedding.length;
        const expectedDimension = await this.getTableDimension(tableName);
        if (expectedDimension === null) {
            return {
                valid: false,
                expectedDimension: null,
                actualDimension,
                message: `Cannot validate: table '${tableName}' has no embedding column`
            };
        }
        const valid = actualDimension === expectedDimension;
        return {
            valid,
            expectedDimension,
            actualDimension,
            message: valid
                ? `Embedding dimension ${actualDimension} matches expected ${expectedDimension}`
                : `Dimension mismatch: got ${actualDimension}, expected ${expectedDimension}`
        };
    }
    /**
     * Ensure all embedding tables have consistent dimensions.
     * Checks all known embedding tables against the memories table dimension.
     * Does NOT automatically fix inconsistencies (that requires migration).
     *
     * @param forceRefresh - Skip cache and query database directly
     * @returns DimensionSyncResult with details about any inconsistencies
     */
    async syncTableDimensions(forceRefresh = false) {
        // Get the canonical dimension from memories table
        let canonicalDimension;
        try {
            canonicalDimension = await this.getEmbeddingDimension(forceRefresh);
        }
        catch (error) {
            return {
                success: false,
                canonicalDimension: 0,
                tablesChecked: [],
                inconsistencies: [],
                message: 'Cannot sync: failed to get canonical dimension from memories table'
            };
        }
        const tablesChecked = [];
        const inconsistencies = [];
        // Check each known embedding table
        for (const tableName of EMBEDDING_TABLES) {
            if (tableName === 'memories')
                continue; // Skip canonical source
            if (forceRefresh) {
                this.invalidateTable(tableName);
            }
            const dimension = await this.getTableDimension(tableName);
            tablesChecked.push(tableName);
            // null means table doesn't exist (yet) - that's OK
            if (dimension !== null && dimension !== canonicalDimension) {
                inconsistencies.push({
                    tableName,
                    dimension,
                    expectedDimension: canonicalDimension
                });
            }
        }
        const success = inconsistencies.length === 0;
        const message = success
            ? `All ${tablesChecked.length} tables have consistent dimension: ${canonicalDimension}`
            : `Found ${inconsistencies.length} dimension inconsistencies across ${tablesChecked.length} tables`;
        if (!success) {
            logger.warn({
                canonicalDimension,
                inconsistencies,
                tablesChecked: tablesChecked.length
            }, 'Dimension inconsistencies detected');
        }
        else {
            logger.info({
                canonicalDimension,
                tablesChecked: tablesChecked.length
            }, 'All embedding tables have consistent dimensions');
        }
        return {
            success,
            canonicalDimension,
            tablesChecked,
            inconsistencies,
            message
        };
    }
    /**
     * Get all table dimensions at once.
     *
     * @param forceRefresh - Skip cache and query database directly
     * @returns Map of table name to dimension (null if table doesn't have embedding column)
     */
    async getAllTableDimensions(forceRefresh = false) {
        const dimensions = new Map();
        for (const tableName of EMBEDDING_TABLES) {
            if (forceRefresh) {
                this.invalidateTable(tableName);
            }
            const dimension = await this.getTableDimension(tableName);
            dimensions.set(tableName, dimension);
        }
        return dimensions;
    }
    /**
     * Check if a table exists and has an embedding column.
     */
    async hasEmbeddingColumn(tableName) {
        const dimension = await this.getTableDimension(tableName);
        return dimension !== null;
    }
    /**
     * Get cache statistics for debugging.
     * Issue #15 FIX: Now includes lastVerified, TTL, and stale entry info.
     */
    getCacheStats() {
        const entries = [];
        const now = Date.now();
        let staleCount = 0;
        this.dimensionCache.forEach((entry, key) => {
            const age = now - entry.timestamp;
            const isStale = age >= this.CACHE_TTL_MS;
            if (isStale) staleCount++;
            entries.push({
                key,
                age,
                isStale,
                dimension: entry.dimension
            });
        });
        return {
            size: this.dimensionCache.size,
            staleCount,
            cacheTtlMs: this.CACHE_TTL_MS,
            lastVerified: this.lastVerified,
            lastVerifiedAge: this.lastVerified ? now - this.lastVerified : null,
            dimensionOverride: parseInt(process.env['SPECMEM_EMBEDDING_DIMENSIONS'] || '0', 10) || null,
            entries
        };
    }
    /**
     * Validate that an embedding matches the expected dimension for a table.
     *
     * @param embedding - The embedding vector to validate
     * @param tableName - Table to check against
     * @returns true if dimensions match, false otherwise
     * @throws Error if table dimension cannot be determined
     */
    async validateEmbeddingDimension(embedding, tableName = 'memories') {
        const tableDim = await this.getTableDimension(tableName);
        if (tableDim === null) {
            throw new Error(`Cannot validate embedding: table '${tableName}' has no embedding column or doesn't exist`);
        }
        const isValid = embedding.length === tableDim;
        if (!isValid) {
            logger.warn({
                embeddingDim: embedding.length,
                tableDim,
                tableName
            }, 'Embedding dimension mismatch');
        }
        return isValid;
    }
    /**
     * Get the SQL type string for creating a vector column with dynamic dimension.
     *
     * @param tableName - Table to base dimension on (queries existing dimension)
     * @param fallbackDimension - Dimension to use if table doesn't exist yet
     * @returns SQL type string like 'vector(1536)'
     */
    async getVectorTypeSQL(tableName = 'memories', fallbackDimension) {
        const dim = await this.getTableDimension(tableName);
        if (dim !== null) {
            return `vector(${dim})`;
        }
        if (fallbackDimension !== undefined) {
            return `vector(${fallbackDimension})`;
        }
        // If no dimension can be determined, we need one from the embedding provider
        throw new Error(`Cannot determine vector dimension for table '${tableName}' - provide fallbackDimension`);
    }
    /**
     * Clear the dimension cache.
     * Call this after altering vector columns.
     */
    clearCache() {
        this.dimensionCache.clear();
    }
    /**
     * Invalidate cache for a specific table.
     */
    invalidateTable(tableName) {
        const keysToDelete = [];
        this.dimensionCache.forEach((_, key) => {
            if (key.startsWith(`${tableName}.`)) {
                keysToDelete.push(key);
            }
        });
        keysToDelete.forEach(key => this.dimensionCache.delete(key));
    }
    /**
     * Issue #15 FIX: Invalidate ALL cached dimensions.
     * Call this when the embedding service restarts or the model changes.
     * The next dimension request will re-fetch from the database.
     */
    invalidateCache() {
        const cacheSize = this.dimensionCache.size;
        this.dimensionCache.clear();
        this.lastVerified = null;
        logger.info({ clearedEntries: cacheSize }, 'DimensionService cache invalidated (embedding service restart or model change)');
    }
    /**
     * Issue #15 FIX: Get the timestamp of the last successful dimension verification.
     * Returns null if no verification has occurred since startup/last invalidation.
     */
    getLastVerified() {
        return this.lastVerified;
    }
    /**
     * Validate a query embedding against a table's expected dimension.
     *
     * @param tableName - The table to search
     * @param queryEmbedding - The embedding to validate
     * @param columnName - The embedding column name
     * @returns Validation result with action recommendation
     */
    async validateDimension(tableName, queryEmbedding, columnName = 'embedding') {
        const tableDimension = await this.getTableDimension(tableName, columnName);
        if (tableDimension === null) {
            // Table doesn't exist or no embedding column - proceed anyway, let DB handle it
            return {
                isValid: true,
                queryDimension: queryEmbedding.length,
                tableDimension: null,
                action: 'proceed'
            };
        }
        if (queryEmbedding.length === tableDimension) {
            return {
                isValid: true,
                queryDimension: queryEmbedding.length,
                tableDimension,
                action: 'proceed'
            };
        }
        // Dimension mismatch!
        logger.warn({
            queryDimension: queryEmbedding.length,
            tableDimension,
            tableName
        }, 'Embedding dimension mismatch detected');
        // Determine action based on whether we can re-embed
        if (this.embeddingProvider) {
            return {
                isValid: false,
                queryDimension: queryEmbedding.length,
                tableDimension,
                action: 'reembed'
            };
        }
        // No embedding provider - try scaling as fallback
        return {
            isValid: false,
            queryDimension: queryEmbedding.length,
            tableDimension,
            action: 'scale'
        };
    }
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
    async validateAndPrepare(tableName, queryEmbedding, originalText, columnName = 'embedding') {
        const validation = await this.validateDimension(tableName, queryEmbedding, columnName);
        if (validation.isValid) {
            return {
                embedding: queryEmbedding,
                wasModified: false,
                action: 'proceed'
            };
        }
        const tableDimension = validation.tableDimension;
        // Try re-embedding first if we have the original text
        if (validation.action === 'reembed' && originalText && this.embeddingProvider) {
            try {
                logger.info({ tableName, targetDim: tableDimension }, 'Re-embedding to match table dimension');
                const newEmbedding = await this.embeddingProvider.generateEmbedding(originalText);
                // Check if the new embedding matches
                if (newEmbedding.length === tableDimension) {
                    return {
                        embedding: newEmbedding,
                        wasModified: true,
                        action: 'reembedded'
                    };
                }
                // Still doesn't match - fall through to scaling
                logger.warn({
                    newDim: newEmbedding.length,
                    tableDim: tableDimension
                }, 'Re-embedded embedding still has wrong dimension, scaling');
            }
            catch (error) {
                logger.warn({ error }, 'Re-embedding failed, falling back to scaling');
            }
        }
        // Scale the embedding to match the table dimension
        const scaled = this.scaleEmbedding(queryEmbedding, tableDimension);
        return {
            embedding: scaled,
            wasModified: true,
            action: 'scaled'
        };
    }
    /**
     * Scale an embedding to a target dimension.
     * Uses interpolation for downscaling, linear interpolation for upscaling.
     * Normalizes result to maintain unit length for cosine similarity.
     *
     * @param embedding - The source embedding
     * @param targetDim - The target dimension
     * @returns Scaled embedding
     */
    scaleEmbedding(embedding, targetDim) {
        const srcDim = embedding.length;
        if (srcDim === targetDim)
            return embedding;
        logger.debug({ from: srcDim, to: targetDim }, 'Scaling embedding');
        const result = new Array(targetDim);
        if (targetDim < srcDim) {
            // DOWNSCALE: Average neighboring values
            const ratio = srcDim / targetDim;
            for (let i = 0; i < targetDim; i++) {
                const start = Math.floor(i * ratio);
                const end = Math.floor((i + 1) * ratio);
                let sum = 0;
                for (let j = start; j < end; j++) {
                    sum += embedding[j];
                }
                result[i] = sum / (end - start);
            }
        }
        else {
            // UPSCALE: Linear interpolation
            const ratio = (srcDim - 1) / (targetDim - 1);
            for (let i = 0; i < targetDim; i++) {
                const srcIdx = i * ratio;
                const low = Math.floor(srcIdx);
                const high = Math.min(low + 1, srcDim - 1);
                const frac = srcIdx - low;
                result[i] = embedding[low] * (1 - frac) + embedding[high] * frac;
            }
        }
        // Normalize to maintain unit length (important for cosine similarity)
        const magnitude = Math.sqrt(result.reduce((sum, val) => sum + val * val, 0));
        if (magnitude > 0) {
            for (let i = 0; i < targetDim; i++) {
                result[i] = result[i] / magnitude;
            }
        }
        return result;
    }
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
    async formatForPostgres(embedding, tableName, originalText, columnName = 'embedding') {
        let finalEmbedding = embedding;
        // Validate and scale/reembed if a table is specified
        if (tableName) {
            const result = await this.validateAndPrepare(tableName, embedding, originalText, columnName);
            finalEmbedding = result.embedding;
        }
        return `[${finalEmbedding.join(',')}]`;
    }
}
// Singleton instance
let dimensionServiceInstance = null;
/**
 * Get the singleton DimensionService instance.
 * Must be initialized with a DatabaseManager first.
 *
 * @param db - DatabaseManager (required on first call)
 * @param embeddingProvider - Optional EmbeddingProvider for re-embedding support
 */
export function getDimensionService(db, embeddingProvider) {
    if (!dimensionServiceInstance && !db) {
        throw new Error('DimensionService not initialized. Provide DatabaseManager on first call.');
    }
    if (!dimensionServiceInstance && db) {
        dimensionServiceInstance = new DimensionService(db, embeddingProvider);
    }
    // Update embedding provider if provided (allows lazy initialization)
    if (embeddingProvider && dimensionServiceInstance) {
        dimensionServiceInstance.setEmbeddingProvider(embeddingProvider);
    }
    return dimensionServiceInstance;
}
/**
 * Reset the singleton (for testing)
 */
export function resetDimensionService() {
    dimensionServiceInstance = null;
}
// ============ Convenience Functions ============
/**
 * Quick helper to get the current embedding dimension from the memories table.
 * Throws if dimension cannot be determined.
 *
 * @param forceRefresh - Skip cache and query database directly
 * @returns The dimension from the memories table
 */
export async function getEmbeddingDimension(forceRefresh = false) {
    const service = getDimensionService();
    return service.getEmbeddingDimension(forceRefresh);
}
/**
 * Quick helper to validate an embedding dimension.
 *
 * @param embedding - The embedding to validate
 * @param tableName - Table to validate against (defaults to 'memories')
 * @returns SimpleDimensionValidation result
 */
export async function validateEmbeddingDimension(embedding, tableName = 'memories') {
    const service = getDimensionService();
    return service.checkDimension(embedding, tableName);
}
/**
 * Quick helper to get a specific table's dimension.
 *
 * @param tableName - Table name to query
 * @param forceRefresh - Skip cache and query database directly
 * @returns Dimension or null if table doesn't have embedding column
 */
export async function getTableEmbeddingDimension(tableName, forceRefresh = false) {
    const service = getDimensionService();
    if (forceRefresh) {
        service.invalidateTable(tableName);
    }
    return service.getTableDimension(tableName);
}
/**
 * Quick helper to check dimension consistency across all embedding tables.
 *
 * @param forceRefresh - Skip cache and query database directly
 * @returns DimensionSyncResult with details about any inconsistencies
 */
export async function syncEmbeddingDimensions(forceRefresh = false) {
    const service = getDimensionService();
    return service.syncTableDimensions(forceRefresh);
}
// ============ Re-export DimensionAdapter ============
// The DimensionAdapter is the recommended way for new code to handle dimension adaptation.
// DimensionService is kept for backwards compatibility.
export { DimensionAdapter, getDimensionAdapter, resetDimensionAdapter, initializeDimensionAdapter, adaptEmbedding, getCanonicalDimension } from './DimensionAdapter.js';
//# sourceMappingURL=DimensionService.js.map