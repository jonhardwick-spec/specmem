import { logger } from '../utils/logger.js';
import { toonFormat } from './toonFormat.js';
const DEFAULT_TTL_DAYS = 30;
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_MAX_ENTRIES = 10000;
export class OverflowStorage {
    pool;
    tableName;
    defaultTtlDays;
    cleanupIntervalMs;
    maxEntries;
    compressionEnabled;
    cleanupTimer = null;
    isInitialized = false;
    constructor(pool, config = {}) {
        this.pool = pool;
        this.tableName = config.tableName ?? 'overflow_storage';
        this.defaultTtlDays = config.defaultTtlDays ?? DEFAULT_TTL_DAYS;
        this.cleanupIntervalMs = config.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
        this.maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
        this.compressionEnabled = config.compressionEnabled ?? true;
    }
    async initialize() {
        if (this.isInitialized) {
            logger.debug('overflow storage already initialized');
            return;
        }
        await this.createTable();
        this.startCleanupLoop();
        this.isInitialized = true;
        logger.info({
            tableName: this.tableName,
            defaultTtlDays: this.defaultTtlDays,
            maxEntries: this.maxEntries
        }, 'overflow storage initialized');
    }
    async createTable() {
        const query = `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key VARCHAR(255) PRIMARY KEY,
        data_toon BYTEA NOT NULL,
        original_size INTEGER NOT NULL,
        compressed_size INTEGER NOT NULL,
        compression_ratio REAL NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        access_count INTEGER NOT NULL DEFAULT 0,
        ttl_days INTEGER NOT NULL DEFAULT ${this.defaultTtlDays},
        expires_at TIMESTAMPTZ GENERATED ALWAYS AS (created_at + (ttl_days || ' days')::INTERVAL) STORED,
        metadata JSONB DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_expires
        ON ${this.tableName}(expires_at);

      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_accessed
        ON ${this.tableName}(accessed_at DESC);

      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_created
        ON ${this.tableName}(created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_access_count
        ON ${this.tableName}(access_count ASC);
    `;
        try {
            await this.pool.query(query);
            logger.debug('overflow storage table created or verified');
        }
        catch (err) {
            logger.error({ err }, 'failed to create overflow storage table');
            throw err;
        }
    }
    async store(key, data, options = {}) {
        const ttlDays = options.ttlDays ?? this.defaultTtlDays;
        const metadata = options.metadata ?? {};
        const { buffer, stats } = await toonFormat.serialize(data, {
            compress: this.compressionEnabled,
            metadata: { ...metadata, key }
        });
        const query = `
      INSERT INTO ${this.tableName}
        (key, data_toon, original_size, compressed_size, compression_ratio, ttl_days, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (key) DO UPDATE SET
        data_toon = EXCLUDED.data_toon,
        original_size = EXCLUDED.original_size,
        compressed_size = EXCLUDED.compressed_size,
        compression_ratio = EXCLUDED.compression_ratio,
        ttl_days = EXCLUDED.ttl_days,
        metadata = EXCLUDED.metadata,
        accessed_at = NOW(),
        access_count = ${this.tableName}.access_count + 1
      RETURNING access_count
    `;
        try {
            await this.pool.query(query, [
                key,
                buffer,
                stats.originalSize,
                stats.compressedSize,
                stats.compressionRatio,
                ttlDays,
                JSON.stringify(metadata)
            ]);
            logger.debug({
                key,
                originalSize: stats.originalSize,
                compressedSize: stats.compressedSize,
                ratio: stats.compressionRatio.toFixed(2)
            }, 'stored data in overflow storage');
            return {
                stored: true,
                stats: {
                    originalSize: stats.originalSize,
                    compressedSize: stats.compressedSize
                }
            };
        }
        catch (err) {
            logger.error({ err, key }, 'failed to store in overflow storage');
            throw err;
        }
    }
    async retrieve(key) {
        const query = `
      UPDATE ${this.tableName}
      SET accessed_at = NOW(), access_count = access_count + 1
      WHERE key = $1 AND expires_at > NOW()
      RETURNING data_toon
    `;
        try {
            const result = await this.pool.query(query, [key]);
            if (result.rows.length === 0) {
                logger.debug({ key }, 'key not found or expired in overflow storage');
                return null;
            }
            const buffer = result.rows[0].data_toon;
            const { payload } = await toonFormat.deserialize(buffer);
            logger.debug({ key }, 'retrieved data from overflow storage');
            return payload;
        }
        catch (err) {
            logger.error({ err, key }, 'failed to retrieve from overflow storage');
            throw err;
        }
    }
    async delete(key) {
        const query = `
      DELETE FROM ${this.tableName}
      WHERE key = $1
      RETURNING key
    `;
        try {
            const result = await this.pool.query(query, [key]);
            const deleted = result.rowCount !== null && result.rowCount > 0;
            if (deleted) {
                logger.debug({ key }, 'deleted entry from overflow storage');
            }
            return deleted;
        }
        catch (err) {
            logger.error({ err, key }, 'failed to delete from overflow storage');
            throw err;
        }
    }
    async deleteMany(keys) {
        if (keys.length === 0)
            return 0;
        const query = `
      DELETE FROM ${this.tableName}
      WHERE key = ANY($1)
    `;
        try {
            const result = await this.pool.query(query, [keys]);
            const deletedCount = result.rowCount ?? 0;
            logger.debug({ deletedCount, requestedCount: keys.length }, 'bulk deleted from overflow storage');
            return deletedCount;
        }
        catch (err) {
            logger.error({ err, keyCount: keys.length }, 'failed bulk delete from overflow storage');
            throw err;
        }
    }
    async exists(key) {
        const query = `
      SELECT 1 FROM ${this.tableName}
      WHERE key = $1 AND expires_at > NOW()
      LIMIT 1
    `;
        try {
            const result = await this.pool.query(query, [key]);
            return result.rows.length > 0;
        }
        catch (err) {
            logger.error({ err, key }, 'failed to check existence in overflow storage');
            throw err;
        }
    }
    async getMetadata(key) {
        const query = `
      SELECT data_toon, access_count, created_at, accessed_at
      FROM ${this.tableName}
      WHERE key = $1 AND expires_at > NOW()
    `;
        try {
            const result = await this.pool.query(query, [key]);
            if (result.rows.length === 0) {
                return null;
            }
            const row = result.rows[0];
            const header = toonFormat.getHeaderOnly(row.data_toon);
            if (!header) {
                return null;
            }
            return {
                header,
                accessCount: row.access_count,
                createdAt: row.created_at,
                accessedAt: row.accessed_at
            };
        }
        catch (err) {
            logger.error({ err, key }, 'failed to get metadata from overflow storage');
            throw err;
        }
    }
    async cleanupExpired() {
        const query = `
      DELETE FROM ${this.tableName}
      WHERE expires_at <= NOW()
    `;
        try {
            const result = await this.pool.query(query);
            const deletedCount = result.rowCount ?? 0;
            if (deletedCount > 0) {
                logger.info({ deletedCount }, 'cleaned up expired entries from overflow storage');
            }
            return deletedCount;
        }
        catch (err) {
            logger.error({ err }, 'failed to cleanup expired entries');
            throw err;
        }
    }
    async getLeastUsedKeys(limit) {
        const query = `
      SELECT key FROM ${this.tableName}
      WHERE expires_at > NOW()
      ORDER BY access_count ASC, accessed_at ASC
      LIMIT $1
    `;
        try {
            const result = await this.pool.query(query, [limit]);
            return result.rows.map((row) => row.key);
        }
        catch (err) {
            logger.error({ err }, 'failed to get least used keys');
            throw err;
        }
    }
    async getMostUsedKeys(limit) {
        const query = `
      SELECT key FROM ${this.tableName}
      WHERE expires_at > NOW()
      ORDER BY access_count DESC, accessed_at DESC
      LIMIT $1
    `;
        try {
            const result = await this.pool.query(query, [limit]);
            return result.rows.map((row) => row.key);
        }
        catch (err) {
            logger.error({ err }, 'failed to get most used keys');
            throw err;
        }
    }
    async getStats() {
        const query = `
      SELECT
        COUNT(*) as total_entries,
        COALESCE(SUM(compressed_size), 0) as total_size,
        COALESCE(AVG(compression_ratio), 1) as avg_compression,
        MIN(created_at) as oldest_entry,
        MAX(created_at) as newest_entry,
        COUNT(*) FILTER (WHERE expires_at <= NOW()) as expired_count
      FROM ${this.tableName}
    `;
        try {
            const result = await this.pool.query(query);
            const row = result.rows[0];
            return {
                totalEntries: parseInt(row.total_entries, 10),
                totalSizeBytes: parseInt(row.total_size, 10),
                avgCompressionRatio: parseFloat(row.avg_compression),
                oldestEntry: row.oldest_entry ? new Date(row.oldest_entry) : null,
                newestEntry: row.newest_entry ? new Date(row.newest_entry) : null,
                expiredCount: parseInt(row.expired_count, 10)
            };
        }
        catch (err) {
            logger.error({ err }, 'failed to get overflow storage stats');
            throw err;
        }
    }
    async enforceMaxEntries() {
        const statsQuery = `SELECT COUNT(*) as count FROM ${this.tableName}`;
        const result = await this.pool.query(statsQuery);
        const currentCount = parseInt(result.rows[0].count, 10);
        if (currentCount <= this.maxEntries) {
            return 0;
        }
        const excessCount = currentCount - this.maxEntries;
        const deleteQuery = `
      DELETE FROM ${this.tableName}
      WHERE key IN (
        SELECT key FROM ${this.tableName}
        ORDER BY access_count ASC, accessed_at ASC
        LIMIT $1
      )
    `;
        try {
            const deleteResult = await this.pool.query(deleteQuery, [excessCount]);
            const deletedCount = deleteResult.rowCount ?? 0;
            logger.info({
                deletedCount,
                currentCount,
                maxEntries: this.maxEntries
            }, 'enforced max entries limit in overflow storage');
            return deletedCount;
        }
        catch (err) {
            logger.error({ err }, 'failed to enforce max entries');
            throw err;
        }
    }
    startCleanupLoop() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
        this.cleanupTimer = setInterval(async () => {
            try {
                await this.cleanupExpired();
                await this.enforceMaxEntries();
            }
            catch (err) {
                logger.error({ err }, 'cleanup loop error');
            }
        }, this.cleanupIntervalMs);
        logger.debug({ intervalMs: this.cleanupIntervalMs }, 'started overflow storage cleanup loop');
    }
    async shutdown() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        this.isInitialized = false;
        logger.info('overflow storage shut down');
    }
}
let overflowInstance = null;
export function getOverflowStorage(pool, config) {
    if (!overflowInstance && !pool) {
        throw new Error('overflow storage not initialized - provide pool on first call');
    }
    if (!overflowInstance && pool) {
        overflowInstance = new OverflowStorage(pool, config);
    }
    return overflowInstance;
}
export function resetOverflowStorage() {
    if (overflowInstance) {
        overflowInstance.shutdown().catch(err => {
            logger.warn({ err }, 'error shutting down overflow storage');
        });
        overflowInstance = null;
    }
}
//# sourceMappingURL=overflowStorage.js.map