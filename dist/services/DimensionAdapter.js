/**
 * DimensionAdapter - Centralized Dimension Detection and Adaptation System
 *
 * This module provides a complete solution for handling embedding dimension mismatches
 * across all vector columns in the database. It:
 *
 * 1. Detects dimensions from ALL tables with vector columns (not just memories)
 * 2. Provides transparent adapters for INSERT and SELECT operations
 * 3. Caches dimension info to avoid repeated queries
 * 4. Integrates with the projection layer for dimension transformation
 *
 * Single Source of Truth: Database pg_attribute table
 *
 * @author specmem team
 */
import { logger } from '../utils/logger.js';
import { projectEmbedding, setTargetDimension, clearDimensionCache as clearProjectionCache, getProjectionInfo } from '../embeddings/projectionLayer.js';
// ============================================================================
// DimensionAdapter Class
// ============================================================================
/**
 * Centralized adapter for embedding dimension management.
 *
 * Features:
 * - Auto-detection of all vector columns in database
 * - Transparent dimension adaptation for INSERT/SELECT
 * - Caching with configurable TTL
 * - Integration with projection layer
 * - Logging of all dimension mismatches
 */
export class DimensionAdapter {
    db;
    embeddingProvider = null;
    dimensionCache = new Map();
    canonicalDimension = null;
    canonicalDimensionTimestamp = 0;
    CACHE_TTL_MS;
    initialized = false;
    /**
     * Known tables with embedding columns.
     * This list is used as a hint but actual detection queries all tables.
     */
    static KNOWN_EMBEDDING_TABLES = [
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
        'processed_training',
        'code_explanations',
        'saved_prompts',
        'code_traces',
        'bug_patterns',
        'search_pattern_cache'
    ];
    constructor(db, embeddingProvider, cacheTTLMs = 60000) {
        this.db = db;
        this.embeddingProvider = embeddingProvider || null;
        this.CACHE_TTL_MS = cacheTTLMs;
    }
    /**
     * Set/update the embedding provider
     */
    setEmbeddingProvider(provider) {
        this.embeddingProvider = provider;
    }
    // ==========================================================================
    // Initialization and Detection
    // ==========================================================================
    /**
     * Initialize the adapter by detecting all dimensions.
     * Should be called after database is ready.
     */
    async initialize() {
        logger.info('DimensionAdapter: Initializing and detecting all vector dimensions...');
        const result = await this.detectAllDimensions();
        if (result.canonicalDimension !== null) {
            this.canonicalDimension = result.canonicalDimension;
            this.canonicalDimensionTimestamp = Date.now();
            // Sync with projection layer
            setTargetDimension(result.canonicalDimension);
            logger.info({
                canonicalDimension: result.canonicalDimension,
                tablesDetected: result.tables.length,
                inconsistencies: result.inconsistencies.length
            }, 'DimensionAdapter: Initialization complete');
        }
        else {
            logger.warn('DimensionAdapter: Could not detect canonical dimension (memories table may not exist yet)');
        }
        this.initialized = true;
        return result;
    }
    /**
     * Detect dimensions from ALL tables with vector columns.
     * Queries pg_attribute for comprehensive detection.
     */
    async detectAllDimensions() {
        const tables = [];
        const inconsistencies = [];
        try {
            // Query ALL vector columns from pg_attribute
            const result = await this.db.query(`
        SELECT
          c.relname as table_name,
          a.attname as column_name,
          a.atttypmod as dimension,
          EXISTS (
            SELECT 1 FROM pg_index i
            JOIN pg_class ic ON i.indexrelid = ic.oid
            WHERE i.indrelid = c.oid
              AND a.attnum = ANY(i.indkey)
          ) as has_index
        FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
        JOIN pg_type t ON a.atttypid = t.oid
        WHERE t.typname = 'vector'
          AND c.relkind = 'r'  -- Regular tables only
          AND NOT c.relname LIKE 'pg_%'  -- Exclude system tables
          AND a.attnum > 0  -- Exclude system columns
        ORDER BY c.relname, a.attname
      `);
            for (const row of result.rows) {
                const info = {
                    tableName: row.table_name,
                    columnName: row.column_name,
                    dimension: row.dimension > 0 ? row.dimension : null,
                    hasIndex: row.has_index
                };
                // Try to detect index type
                if (info.hasIndex) {
                    info.indexType = await this.detectIndexType(row.table_name, row.column_name);
                }
                tables.push(info);
                // Cache the result
                const cacheKey = `${row.table_name}.${row.column_name}`;
                this.dimensionCache.set(cacheKey, {
                    dimension: info.dimension,
                    hasIndex: info.hasIndex,
                    indexType: info.indexType,
                    timestamp: Date.now()
                });
            }
            // Determine canonical dimension from memories table
            const memoriesTable = tables.find(t => t.tableName === 'memories' && t.columnName === 'embedding');
            const canonicalDimension = memoriesTable?.dimension ?? null;
            // Find inconsistencies (tables with different dimensions than canonical)
            if (canonicalDimension !== null) {
                for (const table of tables) {
                    if (table.dimension !== null && table.dimension !== canonicalDimension) {
                        inconsistencies.push({
                            table: table.tableName,
                            column: table.columnName,
                            dimension: table.dimension,
                            expected: canonicalDimension
                        });
                    }
                }
            }
            return {
                success: true,
                canonicalDimension,
                tables,
                inconsistencies,
                detectedAt: new Date()
            };
        }
        catch (error) {
            logger.error({ error }, 'DimensionAdapter: Failed to detect dimensions');
            return {
                success: false,
                canonicalDimension: null,
                tables: [],
                inconsistencies: [],
                detectedAt: new Date()
            };
        }
    }
    /**
     * Detect the index type for a vector column
     */
    async detectIndexType(tableName, columnName) {
        try {
            const result = await this.db.query(`
        SELECT am.amname as index_type
        FROM pg_index i
        JOIN pg_class ic ON i.indexrelid = ic.oid
        JOIN pg_class c ON i.indrelid = c.oid
        JOIN pg_am am ON ic.relam = am.oid
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
        WHERE c.relname = $1 AND a.attname = $2
        LIMIT 1
      `, [tableName, columnName]);
            if (result.rows.length > 0) {
                const amname = result.rows[0].index_type;
                if (amname === 'ivfflat')
                    return 'ivfflat';
                if (amname === 'hnsw')
                    return 'hnsw';
                if (amname === 'btree')
                    return 'btree';
                return 'other';
            }
        }
        catch (error) {
            logger.debug({ error, tableName, columnName }, 'Could not detect index type');
        }
        return undefined;
    }
    // ==========================================================================
    // Dimension Queries (Cached)
    // ==========================================================================
    /**
     * Get the canonical dimension (from memories table).
     * Uses cache with TTL.
     */
    async getCanonicalDimension(forceRefresh = false) {
        const now = Date.now();
        // Return cached if fresh
        if (!forceRefresh && this.canonicalDimension !== null &&
            (now - this.canonicalDimensionTimestamp) < this.CACHE_TTL_MS) {
            return this.canonicalDimension;
        }
        // Query database
        const dimension = await this.getTableDimension('memories', 'embedding');
        if (dimension !== null) {
            this.canonicalDimension = dimension;
            this.canonicalDimensionTimestamp = now;
            // Sync with projection layer
            setTargetDimension(dimension);
        }
        return this.canonicalDimension;
    }
    /**
     * Get dimension for a specific table/column.
     * Uses cache with TTL.
     */
    async getTableDimension(tableName, columnName = 'embedding') {
        const cacheKey = `${tableName}.${columnName}`;
        const cached = this.dimensionCache.get(cacheKey);
        // Return cached if fresh
        if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL_MS) {
            return cached.dimension;
        }
        try {
            const result = await this.db.query(`SELECT atttypmod FROM pg_attribute
         WHERE attrelid = $1::regclass AND attname = $2`, [tableName, columnName]);
            if (result.rows.length === 0) {
                return null;
            }
            const dimension = result.rows[0].atttypmod > 0 ? result.rows[0].atttypmod : null;
            // Update cache
            this.dimensionCache.set(cacheKey, {
                dimension,
                hasIndex: cached?.hasIndex ?? false,
                indexType: cached?.indexType,
                timestamp: Date.now()
            });
            return dimension;
        }
        catch (error) {
            logger.debug({ error, tableName, columnName }, 'Could not get table dimension');
            return null;
        }
    }
    // ==========================================================================
    // Embedding Adaptation (INSERT Operations)
    // ==========================================================================
    /**
     * Adapt an embedding for insertion into a specific table.
     * Automatically detects dimension mismatch and applies projection.
     *
     * @param embedding - The embedding to adapt
     * @param tableName - Target table name
     * @param columnName - Target column name (default: 'embedding')
     * @param originalText - Original text for re-embedding if available
     * @returns Adapted embedding with metadata
     */
    async adaptForInsert(embedding, tableName, columnName = 'embedding', originalText) {
        const targetDimension = await this.getTableDimension(tableName, columnName);
        const originalDimension = embedding.length;
        // No target dimension known - return as-is (table may set dimension from this)
        if (targetDimension === null) {
            logger.debug({ tableName, columnName, dimension: originalDimension }, 'No target dimension - using embedding as-is');
            return {
                embedding,
                originalDimension,
                targetDimension: originalDimension,
                wasAdapted: false,
                adaptationMethod: 'none'
            };
        }
        // Dimensions match - no adaptation needed
        if (originalDimension === targetDimension) {
            return {
                embedding,
                originalDimension,
                targetDimension,
                wasAdapted: false,
                adaptationMethod: 'none'
            };
        }
        // Dimension mismatch - need to adapt
        logger.info({
            tableName,
            columnName,
            originalDimension,
            targetDimension
        }, 'DimensionAdapter: Adapting embedding for INSERT');
        // Try re-embedding first if we have text and provider
        if (originalText && this.embeddingProvider) {
            try {
                const newEmbedding = await this.embeddingProvider.generateEmbedding(originalText);
                if (newEmbedding.length === targetDimension) {
                    return {
                        embedding: newEmbedding,
                        originalDimension,
                        targetDimension,
                        wasAdapted: true,
                        adaptationMethod: 'reembedding'
                    };
                }
                // Re-embedding didn't match either - fall through to projection
            }
            catch (error) {
                logger.warn({ error }, 'Re-embedding failed, falling back to projection');
            }
        }
        // Use projection layer for adaptation
        const projected = projectEmbedding(embedding, targetDimension);
        return {
            embedding: projected,
            originalDimension,
            targetDimension,
            wasAdapted: true,
            adaptationMethod: 'projection'
        };
    }
    /**
     * Adapt an embedding for a SELECT/search operation.
     * Query embeddings must match the table's dimension.
     *
     * @param queryEmbedding - The query embedding
     * @param tableName - Table to search
     * @param columnName - Column to search (default: 'embedding')
     * @returns Adapted embedding
     */
    async adaptForSelect(queryEmbedding, tableName, columnName = 'embedding') {
        const targetDimension = await this.getTableDimension(tableName, columnName);
        const originalDimension = queryEmbedding.length;
        // No target dimension - return as-is
        if (targetDimension === null) {
            return {
                embedding: queryEmbedding,
                originalDimension,
                targetDimension: originalDimension,
                wasAdapted: false,
                adaptationMethod: 'none'
            };
        }
        // Dimensions match
        if (originalDimension === targetDimension) {
            return {
                embedding: queryEmbedding,
                originalDimension,
                targetDimension,
                wasAdapted: false,
                adaptationMethod: 'none'
            };
        }
        // Dimension mismatch - project
        logger.debug({
            tableName,
            originalDimension,
            targetDimension
        }, 'DimensionAdapter: Adapting query embedding for SELECT');
        const projected = projectEmbedding(queryEmbedding, targetDimension);
        return {
            embedding: projected,
            originalDimension,
            targetDimension,
            wasAdapted: true,
            adaptationMethod: 'projection'
        };
    }
    /**
     * Format an adapted embedding for PostgreSQL insertion.
     * Returns the string format: '[0.1,0.2,...]'
     */
    async formatForPostgres(embedding, tableName, columnName = 'embedding', originalText) {
        const adapted = await this.adaptForInsert(embedding, tableName, columnName, originalText);
        return `[${adapted.embedding.join(',')}]`;
    }
    // ==========================================================================
    // Batch Operations
    // ==========================================================================
    /**
     * Adapt multiple embeddings for batch insertion.
     */
    async adaptBatchForInsert(embeddings, tableName, columnName = 'embedding') {
        if (embeddings.length === 0)
            return [];
        // Get target dimension once
        const targetDimension = await this.getTableDimension(tableName, columnName);
        return embeddings.map(embedding => {
            const originalDimension = embedding.length;
            if (targetDimension === null || originalDimension === targetDimension) {
                return {
                    embedding,
                    originalDimension,
                    targetDimension: targetDimension ?? originalDimension,
                    wasAdapted: false,
                    adaptationMethod: 'none'
                };
            }
            const projected = projectEmbedding(embedding, targetDimension);
            return {
                embedding: projected,
                originalDimension,
                targetDimension,
                wasAdapted: true,
                adaptationMethod: 'projection'
            };
        });
    }
    // ==========================================================================
    // Cache Management
    // ==========================================================================
    /**
     * Clear all cached dimension info.
     */
    clearCache() {
        this.dimensionCache.clear();
        this.canonicalDimension = null;
        this.canonicalDimensionTimestamp = 0;
        clearProjectionCache();
        logger.debug('DimensionAdapter: Cache cleared');
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
        // Also invalidate canonical if memories table
        if (tableName === 'memories') {
            this.canonicalDimension = null;
            this.canonicalDimensionTimestamp = 0;
        }
        logger.debug({ tableName, invalidatedKeys: keysToDelete.length }, 'DimensionAdapter: Table cache invalidated');
    }
    /**
     * Get cache statistics for debugging.
     */
    getCacheStats() {
        const now = Date.now();
        const entries = [];
        this.dimensionCache.forEach((entry, key) => {
            entries.push({
                key,
                dimension: entry.dimension,
                age: now - entry.timestamp
            });
        });
        return {
            cacheSize: this.dimensionCache.size,
            canonicalDimension: this.canonicalDimension,
            canonicalAge: this.canonicalDimensionTimestamp > 0 ? now - this.canonicalDimensionTimestamp : -1,
            entries
        };
    }
    // ==========================================================================
    // Utility Methods
    // ==========================================================================
    /**
     * Check if the adapter is initialized.
     */
    isInitialized() {
        return this.initialized;
    }
    /**
     * Get adapter status for health checks.
     */
    getStatus() {
        return {
            initialized: this.initialized,
            canonicalDimension: this.canonicalDimension,
            cacheSize: this.dimensionCache.size,
            projectionLayerInfo: getProjectionInfo()
        };
    }
}
// ============================================================================
// Singleton Management
// ============================================================================
let dimensionAdapterInstance = null;
/**
 * Get the singleton DimensionAdapter instance.
 * Must be initialized with a DatabaseManager first.
 */
export function getDimensionAdapter(db, embeddingProvider) {
    if (!dimensionAdapterInstance && !db) {
        throw new Error('DimensionAdapter not initialized. Provide DatabaseManager on first call.');
    }
    if (!dimensionAdapterInstance && db) {
        dimensionAdapterInstance = new DimensionAdapter(db, embeddingProvider);
    }
    if (embeddingProvider && dimensionAdapterInstance) {
        dimensionAdapterInstance.setEmbeddingProvider(embeddingProvider);
    }
    return dimensionAdapterInstance;
}
/**
 * Reset the singleton (for testing).
 */
export function resetDimensionAdapter() {
    if (dimensionAdapterInstance) {
        dimensionAdapterInstance.clearCache();
    }
    dimensionAdapterInstance = null;
}
// ============================================================================
// Convenience Functions
// ============================================================================
/**
 * Initialize the dimension adapter and detect all dimensions.
 * Should be called after database initialization.
 */
export async function initializeDimensionAdapter(db, embeddingProvider) {
    const adapter = getDimensionAdapter(db, embeddingProvider);
    return adapter.initialize();
}
/**
 * Quick helper to adapt an embedding for any table.
 */
export async function adaptEmbedding(embedding, tableName, operation = 'insert', originalText) {
    const adapter = getDimensionAdapter();
    if (operation === 'insert') {
        const result = await adapter.adaptForInsert(embedding, tableName, 'embedding', originalText);
        return result.embedding;
    }
    else {
        const result = await adapter.adaptForSelect(embedding, tableName);
        return result.embedding;
    }
}
/**
 * Get the current canonical dimension.
 */
export async function getCanonicalDimension() {
    const adapter = getDimensionAdapter();
    return adapter.getCanonicalDimension();
}
export default DimensionAdapter;
//# sourceMappingURL=DimensionAdapter.js.map