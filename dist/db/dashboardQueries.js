/**
 * dashboardQueries.ts - Optimized Dashboard Database Queries
 *
 * This module provides highly optimized queries specifically for the SpecMem dashboard.
 * All queries are designed for minimal latency and efficient resource usage.
 *
 * Key optimizations:
 * - Uses materialized views for stats
 * - Cursor-based pagination (no OFFSET)
 * - Efficient aggregation queries
 * - Pre-computed summaries where possible
 * - Approximate counts for large tables
 */
import { logger } from '../utils/logger.js';
import { getProjectPath } from '../config.js';
import { getProjectSchema } from './projectNamespacing.js';
/**
 * DashboardQueryEngine - Optimized queries for the SpecMem dashboard
 *
 * Performance characteristics:
 * - Stats query: <10ms (from materialized view)
 * - Memory list: <50ms with cursor pagination
 * - Search: <100ms with HNSW index
 * - Time series: <20ms with date_trunc aggregation
 */
export class DashboardQueryEngine {
    pool;
    statsRefreshInterval = null;
    lastStatsRefresh = null;
    // Stats cache to avoid full table scans every 60s
    statsCache = null;
    storageStatsCache = null;
    statsCacheTtlMs = 5 * 60 * 1000; // 5 min cache TTL
    constructor(pool) {
        this.pool = pool;
    }
    /**
     * Set cache TTL for stats (default 5 min)
     */
    setStatsCacheTtl(ttlMs) {
        this.statsCacheTtlMs = ttlMs;
    }
    /**
     * Get dashboard statistics (from materialized view for speed)
     * Falls back to real-time query if view doesn't exist
     */
    async getStats(forceRefresh = false) {
        const start = Date.now();
        // Try materialized view first (super fast)
        try {
            if (forceRefresh) {
                await this.refreshStatsView();
            }
            const result = await this.pool.queryWithSwag('SELECT * FROM memory_stats LIMIT 1');
            if (result.rows.length > 0) {
                const row = result.rows[0];
                const computedAt = new Date(row.computed_at);
                const isStale = Date.now() - computedAt.getTime() > 5 * 60 * 1000; // 5 min
                // Get approximate count for very fast total
                // FIX: Must filter by schema namespace to get project-specific count
                const schemaName = getProjectSchema();
                const approxResult = await this.pool.queryWithSwag(`SELECT reltuples::bigint AS estimate FROM pg_class c
           JOIN pg_namespace n ON c.relnamespace = n.oid
           WHERE c.relname = 'memories' AND n.nspname = $1`, [schemaName]);
                const duration = Date.now() - start;
                logger.debug({ duration, source: 'materialized_view' }, 'dashboard stats fetched');
                return {
                    totalMemories: row.total_memories,
                    totalMemoriesApprox: approxResult.rows[0]?.estimate ?? row.total_memories,
                    typeDistribution: {
                        episodic: row.episodic_count,
                        semantic: row.semantic_count,
                        procedural: row.procedural_count,
                        working: row.working_count,
                        consolidated: row.consolidated_count
                    },
                    importanceDistribution: {
                        critical: row.critical_count,
                        high: row.high_count,
                        medium: row.total_memories - row.critical_count - row.high_count, // Compute remainder
                        low: 0, // Would need separate query
                        trivial: 0
                    },
                    recentActivityCount: 0, // Filled by separate query if needed
                    memoriesWithEmbeddings: row.with_embeddings,
                    memoriesWithImages: row.with_images,
                    expiredMemories: row.expired_count,
                    avgAccessCount: row.avg_access_count || 0,
                    avgContentLength: row.avg_content_length || 0,
                    oldestMemory: row.oldest_memory,
                    newestMemory: row.newest_memory,
                    computedAt,
                    isStale
                };
            }
        }
        catch (err) {
            logger.warn({ err }, 'materialized view not available, using real-time query');
        }
        // Fallback to real-time aggregation query
        return this.getStatsRealtime();
    }
    /**
     * Real-time stats query - uses approximate counts + sampling to avoid full table scan
     * Caches results for statsCacheTtlMs (default 5 min)
     */
    async getStatsRealtime(forceRefresh = false) {
        // Return cached stats if available and not stale
        const now = Date.now();
        if (!forceRefresh && this.statsCache && (now - this.statsCache.timestamp) < this.statsCacheTtlMs) {
            logger.debug({ cacheAge: now - this.statsCache.timestamp, source: 'cache' }, 'returning cached stats');
            return this.statsCache.data;
        }
        const start = Date.now();
        // Use pg_class for fast approximate total count (no table scan)
        // FIX: Must filter by schema namespace to get project-specific count
        const schemaName = getProjectSchema();
        const approxResult = await this.pool.queryWithSwag(`SELECT GREATEST(reltuples::bigint, 0) AS estimate FROM pg_class c
       JOIN pg_namespace n ON c.relnamespace = n.oid
       WHERE c.relname = 'memories' AND n.nspname = $1`, [schemaName]);
        const approxTotal = approxResult.rows[0]?.estimate ?? 0;
        // For small tables, do exact count (fast anyway)
        // For large tables, use TABLESAMPLE for distribution estimates
        const useExactCounts = approxTotal < 10000;
        let stats;
        if (useExactCounts) {
            // Small table - exact counts are fast enough
            const result = await this.pool.queryWithSwag(`
        SELECT
          COUNT(*)::text as total,
          COUNT(*) FILTER (WHERE memory_type = 'episodic')::text as episodic,
          COUNT(*) FILTER (WHERE memory_type = 'semantic')::text as semantic,
          COUNT(*) FILTER (WHERE memory_type = 'procedural')::text as procedural,
          COUNT(*) FILTER (WHERE memory_type = 'working')::text as working,
          COUNT(*) FILTER (WHERE memory_type = 'consolidated')::text as consolidated,
          COUNT(*) FILTER (WHERE importance = 'critical')::text as critical,
          COUNT(*) FILTER (WHERE importance = 'high')::text as high,
          COUNT(*) FILTER (WHERE importance = 'medium')::text as medium,
          COUNT(*) FILTER (WHERE importance = 'low')::text as low,
          COUNT(*) FILTER (WHERE importance = 'trivial')::text as trivial,
          COUNT(*) FILTER (WHERE embedding IS NOT NULL)::text as with_embeddings,
          COUNT(*) FILTER (WHERE image_data IS NOT NULL)::text as with_images,
          COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < NOW())::text as expired,
          COALESCE(AVG(access_count), 0)::float as avg_access,
          COALESCE(AVG(length(content)), 0)::float as avg_length,
          MIN(created_at) as oldest,
          MAX(created_at) as newest,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::text as recent_24h
        FROM memories
      `);
            const row = result.rows[0];
            stats = {
                totalMemories: parseInt(row.total, 10),
                totalMemoriesApprox: parseInt(row.total, 10),
                typeDistribution: {
                    episodic: parseInt(row.episodic, 10),
                    semantic: parseInt(row.semantic, 10),
                    procedural: parseInt(row.procedural, 10),
                    working: parseInt(row.working, 10),
                    consolidated: parseInt(row.consolidated, 10)
                },
                importanceDistribution: {
                    critical: parseInt(row.critical, 10),
                    high: parseInt(row.high, 10),
                    medium: parseInt(row.medium, 10),
                    low: parseInt(row.low, 10),
                    trivial: parseInt(row.trivial, 10)
                },
                recentActivityCount: parseInt(row.recent_24h, 10),
                memoriesWithEmbeddings: parseInt(row.with_embeddings, 10),
                memoriesWithImages: parseInt(row.with_images, 10),
                expiredMemories: parseInt(row.expired, 10),
                avgAccessCount: row.avg_access,
                avgContentLength: row.avg_length,
                oldestMemory: row.oldest,
                newestMemory: row.newest,
                computedAt: new Date(),
                isStale: false
            };
        }
        else {
            // Large table - use TABLESAMPLE SYSTEM for distribution estimates (scans ~1% of pages)
            // Scale factor to extrapolate from sample to full table
            const samplePercent = 1; // 1% sample
            const scaleFactor = 100 / samplePercent;
            const sampleResult = await this.pool.queryWithSwag(`
        SELECT
          COUNT(*)::text as sample_count,
          COUNT(*) FILTER (WHERE memory_type = 'episodic')::text as episodic,
          COUNT(*) FILTER (WHERE memory_type = 'semantic')::text as semantic,
          COUNT(*) FILTER (WHERE memory_type = 'procedural')::text as procedural,
          COUNT(*) FILTER (WHERE memory_type = 'working')::text as working,
          COUNT(*) FILTER (WHERE memory_type = 'consolidated')::text as consolidated,
          COUNT(*) FILTER (WHERE importance = 'critical')::text as critical,
          COUNT(*) FILTER (WHERE importance = 'high')::text as high,
          COUNT(*) FILTER (WHERE importance = 'medium')::text as medium,
          COUNT(*) FILTER (WHERE importance = 'low')::text as low,
          COUNT(*) FILTER (WHERE importance = 'trivial')::text as trivial,
          COUNT(*) FILTER (WHERE embedding IS NOT NULL)::text as with_embeddings,
          COUNT(*) FILTER (WHERE image_data IS NOT NULL)::text as with_images,
          COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < NOW())::text as expired,
          COALESCE(AVG(access_count), 0)::float as avg_access,
          COALESCE(AVG(length(content)), 0)::float as avg_length
        FROM memories TABLESAMPLE SYSTEM(${samplePercent})
      `);
            // Get min/max dates with index scan (fast)
            const dateResult = await this.pool.queryWithSwag(`
        SELECT
          (SELECT created_at FROM memories ORDER BY created_at ASC LIMIT 1) as oldest,
          (SELECT created_at FROM memories ORDER BY created_at DESC LIMIT 1) as newest,
          (SELECT COUNT(*)::text FROM memories WHERE created_at > NOW() - INTERVAL '24 hours') as recent_24h
      `);
            const sampleRow = sampleResult.rows[0];
            const dateRow = dateResult.rows[0];
            // Scale sample counts to estimated full table counts
            const scale = (val) => Math.round(parseInt(val, 10) * scaleFactor);
            stats = {
                totalMemories: approxTotal,
                totalMemoriesApprox: approxTotal,
                typeDistribution: {
                    episodic: scale(sampleRow.episodic),
                    semantic: scale(sampleRow.semantic),
                    procedural: scale(sampleRow.procedural),
                    working: scale(sampleRow.working),
                    consolidated: scale(sampleRow.consolidated)
                },
                importanceDistribution: {
                    critical: scale(sampleRow.critical),
                    high: scale(sampleRow.high),
                    medium: scale(sampleRow.medium),
                    low: scale(sampleRow.low),
                    trivial: scale(sampleRow.trivial)
                },
                recentActivityCount: parseInt(dateRow.recent_24h || '0', 10),
                memoriesWithEmbeddings: scale(sampleRow.with_embeddings),
                memoriesWithImages: scale(sampleRow.with_images),
                expiredMemories: scale(sampleRow.expired),
                avgAccessCount: sampleRow.avg_access,
                avgContentLength: sampleRow.avg_length,
                oldestMemory: dateRow.oldest,
                newestMemory: dateRow.newest,
                computedAt: new Date(),
                isStale: false
            };
        }
        const duration = Date.now() - start;
        logger.debug({ duration, source: useExactCounts ? 'realtime-exact' : 'realtime-sampled', approxTotal }, 'dashboard stats fetched');
        // Cache the stats
        this.statsCache = { data: stats, timestamp: now };
        return stats;
    }
    /**
     * Invalidate stats cache (call after bulk operations)
     */
    invalidateStatsCache() {
        this.statsCache = null;
        this.storageStatsCache = null;
    }
    /**
     * Refresh the materialized view (call periodically)
     */
    async refreshStatsView() {
        const start = Date.now();
        try {
            await this.pool.queryWithSwag('SELECT refresh_memory_stats()');
            this.lastStatsRefresh = new Date();
            const duration = Date.now() - start;
            logger.debug({ duration }, 'stats view refreshed');
        }
        catch (err) {
            logger.warn({ err }, 'failed to refresh stats view');
        }
    }
    /**
     * Get paginated memories list with cursor-based pagination
     * Much faster than OFFSET for large tables
     */
    async getMemoriesList(filters = {}, pageSize = 50, cursor, sortBy = 'created_at', sortDir = 'desc') {
        const start = Date.now();
        const conditions = [];
        const values = [];
        let paramIndex = 1;
        // Build filter conditions
        if (filters.memoryTypes?.length) {
            conditions.push(`memory_type = ANY($${paramIndex}::memory_type[])`);
            values.push(filters.memoryTypes);
            paramIndex++;
        }
        if (filters.importance?.length) {
            conditions.push(`importance = ANY($${paramIndex}::importance_level[])`);
            values.push(filters.importance);
            paramIndex++;
        }
        if (filters.tags?.length) {
            conditions.push(`tags && $${paramIndex}`);
            values.push(filters.tags);
            paramIndex++;
        }
        if (filters.hasEmbedding !== undefined) {
            conditions.push(filters.hasEmbedding ? 'embedding IS NOT NULL' : 'embedding IS NULL');
        }
        if (filters.hasImage !== undefined) {
            conditions.push(filters.hasImage ? 'image_data IS NOT NULL' : 'image_data IS NULL');
        }
        if (filters.dateFrom) {
            conditions.push(`created_at >= $${paramIndex}`);
            values.push(filters.dateFrom);
            paramIndex++;
        }
        if (filters.dateTo) {
            conditions.push(`created_at <= $${paramIndex}`);
            values.push(filters.dateTo);
            paramIndex++;
        }
        if (!filters.includeExpired) {
            conditions.push('(expires_at IS NULL OR expires_at > NOW())');
        }
        // Add cursor condition for pagination
        if (cursor) {
            const cursorOp = sortDir === 'desc' ? '<' : '>';
            conditions.push(`${sortBy} ${cursorOp} $${paramIndex}`);
            values.push(cursor);
            paramIndex++;
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        // Fetch one extra to check for more results
        values.push(pageSize + 1);
        const limitParam = paramIndex;
        const query = `
      SELECT
        id,
        LEFT(content, 200) as content_preview,
        content,
        memory_type,
        importance,
        tags,
        embedding IS NOT NULL as has_embedding,
        image_data IS NOT NULL as has_image,
        created_at,
        updated_at,
        access_count,
        expires_at
      FROM memories
      ${whereClause}
      ORDER BY ${sortBy} ${sortDir.toUpperCase()}
      LIMIT $${limitParam}
    `;
        const result = await this.pool.queryWithSwag(query, values);
        const hasMore = result.rows.length > pageSize;
        const items = hasMore ? result.rows.slice(0, pageSize) : result.rows;
        const mappedItems = items.map(row => ({
            id: row.id,
            content: row.content,
            contentPreview: row.content_preview,
            memoryType: row.memory_type,
            importance: row.importance,
            tags: row.tags,
            hasEmbedding: row.has_embedding,
            hasImage: row.has_image,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            accessCount: row.access_count,
            expiresAt: row.expires_at
        }));
        // Calculate cursors
        let nextCursor = null;
        let prevCursor = null;
        if (mappedItems.length > 0) {
            const lastItem = mappedItems[mappedItems.length - 1];
            const firstItem = mappedItems[0];
            if (hasMore) {
                nextCursor = String(lastItem[sortBy === 'created_at' ? 'createdAt' : sortBy === 'updated_at' ? 'updatedAt' : 'accessCount']);
            }
            if (cursor) {
                prevCursor = String(firstItem[sortBy === 'created_at' ? 'createdAt' : sortBy === 'updated_at' ? 'updatedAt' : 'accessCount']);
            }
        }
        const duration = Date.now() - start;
        logger.debug({ duration, resultCount: mappedItems.length, hasMore }, 'memories list fetched');
        return {
            items: mappedItems,
            pageSize,
            hasMore,
            nextCursor,
            prevCursor
        };
    }
    /**
     * Get time series data for charts
     */
    async getTimeSeries(granularity = 'day', daysBack = 30, memoryType) {
        const start = Date.now();
        const interval = {
            hour: '1 hour',
            day: '1 day',
            week: '1 week',
            month: '1 month'
        }[granularity];
        const dateFormat = {
            hour: 'YYYY-MM-DD HH24:00',
            day: 'YYYY-MM-DD',
            week: 'IYYY-IW',
            month: 'YYYY-MM'
        }[granularity];
        const conditions = [`created_at > NOW() - INTERVAL '${daysBack} days'`];
        const values = [];
        let paramIndex = 1;
        if (memoryType) {
            conditions.push(`memory_type = $${paramIndex}`);
            values.push(memoryType);
            paramIndex++;
        }
        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        const query = `
      SELECT
        date_trunc('${granularity}', created_at) as timestamp,
        COUNT(*) as count,
        to_char(date_trunc('${granularity}', created_at), '${dateFormat}') as label
      FROM memories
      ${whereClause}
      GROUP BY date_trunc('${granularity}', created_at)
      ORDER BY timestamp ASC
    `;
        const result = await this.pool.queryWithSwag(query, values);
        const duration = Date.now() - start;
        logger.debug({ duration, dataPoints: result.rows.length, granularity }, 'time series data fetched');
        return result.rows.map(row => ({
            timestamp: row.timestamp,
            count: parseInt(row.count, 10),
            label: row.label
        }));
    }
    /**
     * Get top tags with usage counts
     */
    async getTopTags(limit = 50) {
        const start = Date.now();
        const result = await this.pool.queryWithSwag(`
      SELECT name, usage_count, created_at
      FROM tags
      ORDER BY usage_count DESC
      LIMIT $1
    `, [limit]);
        const duration = Date.now() - start;
        logger.debug({ duration, tagCount: result.rows.length }, 'top tags fetched');
        return result.rows.map(row => ({
            name: row.name,
            count: row.usage_count,
            lastUsed: row.created_at
        }));
    }
    /**
     * Get memory type distribution over time (for stacked charts)
     */
    async getTypeDistributionOverTime(granularity = 'day', daysBack = 30) {
        const start = Date.now();
        const query = `
      SELECT
        date_trunc('${granularity}', created_at) as timestamp,
        COUNT(*) FILTER (WHERE memory_type = 'episodic') as episodic,
        COUNT(*) FILTER (WHERE memory_type = 'semantic') as semantic,
        COUNT(*) FILTER (WHERE memory_type = 'procedural') as procedural,
        COUNT(*) FILTER (WHERE memory_type = 'working') as working,
        COUNT(*) FILTER (WHERE memory_type = 'consolidated') as consolidated
      FROM memories
      WHERE created_at > NOW() - INTERVAL '${daysBack} days'
      GROUP BY date_trunc('${granularity}', created_at)
      ORDER BY timestamp ASC
    `;
        const result = await this.pool.queryWithSwag(query);
        const duration = Date.now() - start;
        logger.debug({ duration, dataPoints: result.rows.length }, 'type distribution over time fetched');
        return result.rows.map(row => ({
            timestamp: row.timestamp,
            episodic: parseInt(row.episodic, 10),
            semantic: parseInt(row.semantic, 10),
            procedural: parseInt(row.procedural, 10),
            working: parseInt(row.working, 10),
            consolidated: parseInt(row.consolidated, 10)
        }));
    }
    /**
     * Get recent activity feed (last N memories)
     */
    async getRecentActivity(limit = 20) {
        const start = Date.now();
        const result = await this.pool.queryWithSwag(`
      SELECT
        id,
        LEFT(content, 200) as content,
        memory_type,
        importance,
        tags,
        embedding IS NOT NULL as has_embedding,
        image_data IS NOT NULL as has_image,
        created_at,
        updated_at,
        access_count,
        expires_at
      FROM memories
      WHERE expires_at IS NULL OR expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
        const duration = Date.now() - start;
        logger.debug({ duration, count: result.rows.length }, 'recent activity fetched');
        return result.rows.map(row => ({
            id: row.id,
            content: row.content,
            contentPreview: row.content,
            memoryType: row.memory_type,
            importance: row.importance,
            tags: row.tags,
            hasEmbedding: row.has_embedding,
            hasImage: row.has_image,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            accessCount: row.access_count,
            expiresAt: row.expires_at
        }));
    }
    /**
     * Get storage usage statistics - uses pg_class for fast estimates, caches results
     */
    async getStorageStats(forceRefresh = false) {
        // Return cached storage stats if available and not stale
        const now = Date.now();
        if (!forceRefresh && this.storageStatsCache && (now - this.storageStatsCache.timestamp) < this.statsCacheTtlMs) {
            logger.debug({ cacheAge: now - this.storageStatsCache.timestamp, source: 'cache' }, 'returning cached storage stats');
            return this.storageStatsCache.data;
        }
        const start = Date.now();
        // FIX: Use schema-qualified table name for correct project isolation
        const schemaName = getProjectSchema();
        const qualifiedTable = `"${schemaName}"."memories"`;
        // Get table/index sizes - these are fast (no table scan)
        const result = await this.pool.queryWithSwag(`
      SELECT
        pg_total_relation_size($1)::text as total_size,
        pg_table_size($1)::text as table_size,
        pg_indexes_size($1)::text as index_size
    `, [qualifiedTable]);
        const row = result.rows[0];
        // Get approximate counts from pg_class (no table scan)
        // FIX: Must filter by schema namespace to get project-specific count
        const approxResult = await this.pool.queryWithSwag(`SELECT GREATEST(reltuples::bigint, 0) AS estimate FROM pg_class c
       JOIN pg_namespace n ON c.relnamespace = n.oid
       WHERE c.relname = 'memories' AND n.nspname = $1`, [schemaName]);
        const approxTotal = approxResult.rows[0]?.estimate ?? 0;
        // For small tables, do exact count. For large, use sampling.
        let embeddingCount;
        let imageCount;
        let contentSize;
        if (approxTotal < 10000) {
            // Small table - exact counts are fast
            const sizeResult = await this.pool.queryWithSwag(`
        SELECT
          COALESCE(SUM(length(content)), 0)::text as content_size,
          COUNT(*) FILTER (WHERE embedding IS NOT NULL)::text as embedding_count,
          COUNT(*) FILTER (WHERE image_data IS NOT NULL)::text as image_count
        FROM memories
      `);
            const sizeRow = sizeResult.rows[0];
            embeddingCount = parseInt(sizeRow.embedding_count, 10);
            imageCount = parseInt(sizeRow.image_count, 10);
            contentSize = parseInt(sizeRow.content_size || '0', 10);
        }
        else {
            // Large table - use TABLESAMPLE for estimates
            const samplePercent = 1;
            const scaleFactor = 100 / samplePercent;
            const sampleResult = await this.pool.queryWithSwag(`
        SELECT
          COALESCE(AVG(length(content)), 0)::float as avg_content_length,
          COALESCE(AVG(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END), 0)::float as embedding_ratio,
          COALESCE(AVG(CASE WHEN image_data IS NOT NULL THEN 1 ELSE 0 END), 0)::float as image_ratio
        FROM memories TABLESAMPLE SYSTEM(${samplePercent})
      `);
            const sampleRow = sampleResult.rows[0];
            embeddingCount = Math.round(approxTotal * sampleRow.embedding_ratio);
            imageCount = Math.round(approxTotal * sampleRow.image_ratio);
            contentSize = Math.round(approxTotal * sampleRow.avg_content_length);
        }
        // Estimate sizes (1536 floats * 4 bytes per embedding, avg 50KB per image)
        const embeddingSize = embeddingCount * 1536 * 4;
        const imageSize = imageCount * 50000;
        const duration = Date.now() - start;
        logger.debug({ duration, approxTotal }, 'storage stats fetched');
        const stats = {
            totalSize: parseInt(row.total_size, 10),
            contentSize,
            embeddingSize,
            imageSize,
            indexSize: parseInt(row.index_size, 10),
            tableCount: approxTotal
        };
        // Cache the result
        this.storageStatsCache = { data: stats, timestamp: now };
        return stats;
    }
    /**
     * Search memories with text query (uses GIN index)
     */
    async searchMemories(query, filters = {}, limit = 50) {
        const start = Date.now();
        const conditions = [];
        const values = [];
        let paramIndex = 1;
        // Text search condition
        values.push(query);
        conditions.push(`content_tsv @@ plainto_tsquery('english', $${paramIndex})`);
        paramIndex++;
        // Apply filters
        if (filters.memoryTypes?.length) {
            conditions.push(`memory_type = ANY($${paramIndex}::memory_type[])`);
            values.push(filters.memoryTypes);
            paramIndex++;
        }
        if (filters.importance?.length) {
            conditions.push(`importance = ANY($${paramIndex}::importance_level[])`);
            values.push(filters.importance);
            paramIndex++;
        }
        if (!filters.includeExpired) {
            conditions.push('(expires_at IS NULL OR expires_at > NOW())');
        }
        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        values.push(limit);
        const limitParam = paramIndex;
        const searchQuery = `
      SELECT
        id,
        LEFT(content, 200) as content,
        content as full_content,
        memory_type,
        importance,
        tags,
        embedding IS NOT NULL as has_embedding,
        image_data IS NOT NULL as has_image,
        created_at,
        updated_at,
        access_count,
        expires_at,
        ts_rank(content_tsv, plainto_tsquery('english', $1)) as rank
      FROM memories
      ${whereClause}
      ORDER BY rank DESC, created_at DESC
      LIMIT $${limitParam}
    `;
        const result = await this.pool.queryWithSwag(searchQuery, values);
        const duration = Date.now() - start;
        logger.debug({ duration, resultCount: result.rows.length, query }, 'text search completed');
        return result.rows.map(row => ({
            id: row.id,
            content: row.full_content,
            contentPreview: row.content,
            memoryType: row.memory_type,
            importance: row.importance,
            tags: row.tags,
            hasEmbedding: row.has_embedding,
            hasImage: row.has_image,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            accessCount: row.access_count,
            expiresAt: row.expires_at,
            rank: row.rank
        }));
    }
    /**
     * Get relationship graph data for visualization
     */
    async getRelationshipGraph(centerMemoryId, maxNodes = 100, maxDepth = 2) {
        const start = Date.now();
        let query;
        const values = [];
        if (centerMemoryId) {
            // Get graph centered on a specific memory
            values.push(centerMemoryId, maxNodes);
            query = `
        WITH RECURSIVE related AS (
          -- Start with center node
          SELECT target_id as id, 1 as depth, strength, relation_type
          FROM memory_relations
          WHERE source_id = $1

          UNION

          -- Traverse relationships
          SELECT r.target_id, rel.depth + 1, r.strength, r.relation_type
          FROM memory_relations r
          JOIN related rel ON r.source_id = rel.id
          WHERE rel.depth < ${maxDepth}
        )
        SELECT DISTINCT
          m.id,
          m.memory_type,
          m.importance,
          LEFT(m.content, 50) as label
        FROM related r
        JOIN memories m ON m.id = r.id
        LIMIT $2
      `;
        }
        else {
            // Get overall graph (most connected memories)
            values.push(maxNodes);
            query = `
        WITH connected AS (
          SELECT source_id as id, COUNT(*) as connections
          FROM memory_relations
          GROUP BY source_id
          ORDER BY connections DESC
          LIMIT $1
        )
        SELECT
          m.id,
          m.memory_type,
          m.importance,
          LEFT(m.content, 50) as label
        FROM connected c
        JOIN memories m ON m.id = c.id
      `;
        }
        const nodesResult = await this.pool.queryWithSwag(query, values);
        // Get edges for these nodes
        const nodeIds = nodesResult.rows.map(r => r.id);
        const edgesResult = await this.pool.queryWithSwag(`
      SELECT source_id, target_id, relation_type, strength
      FROM memory_relations
      WHERE source_id = ANY($1) AND target_id = ANY($1)
    `, [nodeIds]);
        const duration = Date.now() - start;
        logger.debug({
            duration,
            nodeCount: nodesResult.rows.length,
            edgeCount: edgesResult.rows.length
        }, 'relationship graph fetched');
        return {
            nodes: nodesResult.rows.map(row => ({
                id: row.id,
                type: row.memory_type,
                importance: row.importance,
                label: row.label
            })),
            edges: edgesResult.rows.map(row => ({
                source: row.source_id,
                target: row.target_id,
                type: row.relation_type,
                strength: row.strength
            }))
        };
    }
    /**
     * Start automatic stats refresh (call on server startup)
     * Uses cached stats most of the time, only refreshes materialized view every 5 minutes
     */
    startAutoRefresh(intervalMs = 60000) {
        if (this.statsRefreshInterval) {
            clearInterval(this.statsRefreshInterval);
        }
        // Track refresh count to do full materialized view refresh less frequently
        let refreshCount = 0;
        const fullRefreshEveryN = 5; // Full refresh every 5 intervals (5 min at 60s intervals)
        this.statsRefreshInterval = setInterval(async () => {
            try {
                refreshCount++;
                if (refreshCount >= fullRefreshEveryN) {
                    // Every 5th refresh, update the materialized view
                    await this.refreshStatsView();
                    this.invalidateStatsCache(); // Force cache refresh on next query
                    refreshCount = 0;
                }
                else {
                    // Otherwise just refresh the cache using fast sampled/cached query
                    await this.getStatsRealtime(true);
                }
            }
            catch (err) {
                logger.warn({ err }, 'auto stats refresh failed');
            }
        }, intervalMs);
        logger.info({ intervalMs, fullRefreshIntervalMs: intervalMs * fullRefreshEveryN }, 'dashboard auto-refresh started');
    }
    /**
     * Stop automatic stats refresh
     */
    stopAutoRefresh() {
        if (this.statsRefreshInterval) {
            clearInterval(this.statsRefreshInterval);
            this.statsRefreshInterval = null;
            logger.info('dashboard auto-refresh stopped');
        }
    }
}
// Per-project dashboard engines
const dashboardByProject = new Map();
export function getDashboardEngine(pool, projectPath) {
    const targetProject = projectPath || getProjectPath();
    if (!dashboardByProject.has(targetProject) && !pool) {
        throw new Error(`dashboard engine not initialized for project ${targetProject} - pass pool first`);
    }
    if (!dashboardByProject.has(targetProject) && pool) {
        dashboardByProject.set(targetProject, new DashboardQueryEngine(pool));
    }
    return dashboardByProject.get(targetProject);
}
export function resetDashboardEngine(projectPath) {
    const targetProject = projectPath || getProjectPath();
    const engine = dashboardByProject.get(targetProject);
    if (engine) {
        engine.stopAutoRefresh();
    }
    dashboardByProject.delete(targetProject);
}
export function resetAllDashboardEngines() {
    for (const [project, engine] of dashboardByProject) {
        engine.stopAutoRefresh();
    }
    dashboardByProject.clear();
}
//# sourceMappingURL=dashboardQueries.js.map