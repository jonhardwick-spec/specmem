/**
 * embeddingOverflow.ts - PostgreSQL Overflow for Embedding Cache
 *
 * Handles persistence of embedding cache to PostgreSQL when memory pressure
 * requires overflow. Implements the OverflowHandler interface.
 *
 * @author hardwicksoftwareservices
 */
import { logger } from '../utils/logger.js';
import { getDimensionService } from '../services/DimensionService.js';
// ============================================================================
// Overflow Handler Implementation
// ============================================================================
/**
 * PostgreSQL-based overflow handler for embedding cache
 */
export class EmbeddingOverflowHandler {
    db;
    initialized = false;
    dimensionService = null;
    constructor(db) {
        this.db = db;
        // Initialize dimension service
        try {
            this.dimensionService = getDimensionService(db);
        }
        catch {
            // Will be initialized when needed
        }
    }
    /**
     * Get the DimensionService (lazy initialization)
     */
    getDimService() {
        if (!this.dimensionService) {
            try {
                this.dimensionService = getDimensionService(this.db);
            }
            catch {
                // Service not available
            }
        }
        return this.dimensionService;
    }
    /**
     * Get vector column definition dynamically from database
     */
    async getVectorColumnDef() {
        const dimService = this.getDimService();
        if (!dimService) {
            // Fallback to unbounded vector if no dimension service
            return 'vector';
        }
        try {
            const dimension = await dimService.getMemoriesTableDimension();
            if (dimension !== null && dimension > 0) {
                return `vector(${dimension})`;
            }
            // Return unbounded vector if dimension not yet set
            return 'vector';
        }
        catch (error) {
            logger.debug({ error }, 'Could not get dimension for overflow table, using unbounded vector');
            return 'vector';
        }
    }
    /**
     * Prepare embedding for storage - validates and projects dimension if needed
     */
    async prepareEmbedding(embedding) {
        const dimService = this.getDimService();
        if (!dimService) {
            return `[${embedding.join(',')}]`;
        }
        try {
            const prepared = await dimService.validateAndPrepare('embedding_cache_overflow', embedding);
            if (prepared.wasModified) {
                logger.debug({
                    action: prepared.action,
                    originalDim: embedding.length,
                    newDim: prepared.embedding.length
                }, 'Projected overflow embedding to target dimension');
            }
            return `[${prepared.embedding.join(',')}]`;
        }
        catch (error) {
            // Table may not exist yet - just return as-is
            return `[${embedding.join(',')}]`;
        }
    }
    /**
     * Initialize the overflow table in PostgreSQL
     */
    async initialize() {
        if (this.initialized)
            return;
        try {
            // Create overflow table for embedding cache
            // NOTE: Dimension is auto-detected from memories table
            const vectorDef = await this.getVectorColumnDef();
            await this.db.query(`
        CREATE TABLE IF NOT EXISTS embedding_cache_overflow (
          key TEXT PRIMARY KEY,
          embedding ${vectorDef},
          access_count INTEGER DEFAULT 1,
          last_accessed TIMESTAMPTZ DEFAULT NOW(),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          size_bytes INTEGER DEFAULT 0,
          metadata JSONB DEFAULT '{}'
        )
      `);
            // Create index for access pattern (for LRU retrieval)
            await this.db.query(`
        CREATE INDEX IF NOT EXISTS idx_embedding_overflow_access
        ON embedding_cache_overflow(last_accessed DESC)
      `);
            // Create index for cleanup (oldest entries)
            await this.db.query(`
        CREATE INDEX IF NOT EXISTS idx_embedding_overflow_created
        ON embedding_cache_overflow(created_at ASC)
      `);
            // Cleanup old overflow entries (older than 7 days)
            const cleanupResult = await this.db.query(`
        DELETE FROM embedding_cache_overflow
        WHERE last_accessed < NOW() - INTERVAL '7 days'
        RETURNING key
      `);
            if (cleanupResult.rows.length > 0) {
                logger.info({ cleaned: cleanupResult.rows.length }, 'cleaned old overflow entries on init');
            }
            this.initialized = true;
            logger.info('Embedding overflow table initialized');
        }
        catch (error) {
            logger.error({ error }, 'Failed to initialize embedding overflow table');
            throw error;
        }
    }
    /**
     * Move embedding entries to PostgreSQL
     */
    async moveToPostgres(entries) {
        if (entries.length === 0)
            return 0;
        await this.initialize();
        let movedCount = 0;
        try {
            // Use transaction for batch insert
            await this.db.transaction(async (client) => {
                for (const entry of entries) {
                    try {
                        // Use prepareEmbedding to validate and project dimension
                        const embeddingStr = await this.prepareEmbedding(entry.value);
                        // Upsert - update if exists, insert if not
                        await client.query(`
              INSERT INTO embedding_cache_overflow
                (key, embedding, access_count, last_accessed, created_at, size_bytes)
              VALUES ($1, $2::vector, $3, to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0), $6)
              ON CONFLICT (key) DO UPDATE SET
                embedding = EXCLUDED.embedding,
                access_count = embedding_cache_overflow.access_count + EXCLUDED.access_count,
                last_accessed = GREATEST(embedding_cache_overflow.last_accessed, EXCLUDED.last_accessed),
                size_bytes = EXCLUDED.size_bytes
            `, [
                            entry.key,
                            embeddingStr,
                            entry.accessCount,
                            entry.lastAccessed,
                            entry.createdAt,
                            entry.size
                        ]);
                        movedCount++;
                    }
                    catch (error) {
                        logger.warn({ error, key: entry.key }, 'Failed to move single entry');
                    }
                }
            });
            logger.info({ movedCount, requested: entries.length }, 'Moved entries to PostgreSQL overflow');
        }
        catch (error) {
            logger.error({ error }, 'Failed to move entries to PostgreSQL');
            throw error;
        }
        return movedCount;
    }
    /**
     * Load embeddings from PostgreSQL overflow
     */
    async loadFromPostgres(keys) {
        if (keys.length === 0)
            return new Map();
        await this.initialize();
        const result = new Map();
        try {
            const queryResult = await this.db.query(`
        SELECT key, embedding
        FROM embedding_cache_overflow
        WHERE key = ANY($1)
      `, [keys]);
            for (const row of queryResult.rows) {
                if (row.embedding) {
                    // Parse embedding from PostgreSQL vector format
                    const embedding = this.parseEmbedding(row.embedding);
                    if (embedding) {
                        result.set(row.key, embedding);
                    }
                }
            }
            // Update last accessed time for retrieved entries
            if (result.size > 0) {
                await this.db.query(`
          UPDATE embedding_cache_overflow
          SET last_accessed = NOW(), access_count = access_count + 1
          WHERE key = ANY($1)
        `, [Array.from(result.keys())]);
            }
            logger.debug({ requested: keys.length, found: result.size }, 'Loaded from overflow');
        }
        catch (error) {
            logger.error({ error }, 'Failed to load from PostgreSQL overflow');
        }
        return result;
    }
    /**
     * Clear all overflow data
     */
    async clearOverflow() {
        await this.initialize();
        try {
            const result = await this.db.query('DELETE FROM embedding_cache_overflow');
            logger.info({ deleted: result.rowCount }, 'Cleared overflow table');
        }
        catch (error) {
            logger.error({ error }, 'Failed to clear overflow table');
            throw error;
        }
    }
    /**
     * Get overflow statistics
     */
    async getStats() {
        await this.initialize();
        try {
            const result = await this.db.query(`
        SELECT
          COUNT(*) as total_entries,
          COALESCE(SUM(size_bytes), 0) as total_size,
          MIN(created_at) as oldest_entry,
          MAX(created_at) as newest_entry
        FROM embedding_cache_overflow
      `);
            const row = result.rows[0];
            return {
                totalEntries: parseInt(row?.total_entries || '0', 10),
                totalSize: parseInt(row?.total_size || '0', 10),
                oldestEntry: row?.oldest_entry ? new Date(row.oldest_entry) : null,
                newestEntry: row?.newest_entry ? new Date(row.newest_entry) : null
            };
        }
        catch (error) {
            logger.error({ error }, 'Failed to get overflow stats');
            return {
                totalEntries: 0,
                totalSize: 0,
                oldestEntry: null,
                newestEntry: null
            };
        }
    }
    /**
     * Cleanup old overflow entries (LRU eviction from overflow)
     */
    async cleanup(maxEntries = 10000) {
        await this.initialize();
        try {
            // Get count of entries
            const countResult = await this.db.query('SELECT COUNT(*) as count FROM embedding_cache_overflow');
            const count = parseInt(countResult.rows[0]?.count || '0', 10);
            if (count <= maxEntries)
                return 0;
            // Delete oldest entries beyond max
            const toDelete = count - maxEntries;
            const result = await this.db.query(`
        DELETE FROM embedding_cache_overflow
        WHERE key IN (
          SELECT key FROM embedding_cache_overflow
          ORDER BY last_accessed ASC
          LIMIT $1
        )
      `, [toDelete]);
            const deleted = result.rowCount ?? 0;
            logger.info({ deleted, maxEntries }, 'Cleaned up overflow entries');
            return deleted;
        }
        catch (error) {
            logger.error({ error }, 'Failed to cleanup overflow');
            return 0;
        }
    }
    /**
     * Parse embedding from PostgreSQL vector format
     */
    parseEmbedding(value) {
        if (Array.isArray(value)) {
            return value.map(Number);
        }
        if (typeof value === 'string') {
            try {
                // Handle PostgreSQL vector format: [1,2,3] or (1,2,3)
                const cleaned = value.replace(/[\[\]\(\)]/g, '');
                return cleaned.split(',').map(Number);
            }
            catch (e) {
                // Parsing failed - vector format probably corrupted, return null safely
                logger.debug({ error: e, value: value.slice(0, 50) }, 'vector parsing failed ngl');
                return null;
            }
        }
        return null;
    }
}
// ============================================================================
// Factory Function
// ============================================================================
/**
 * Create an embedding overflow handler
 */
export function createEmbeddingOverflowHandler(db) {
    return new EmbeddingOverflowHandler(db);
}
//# sourceMappingURL=embeddingOverflow.js.map