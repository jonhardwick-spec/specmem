/**
 * showMeTheStats - get memory system statistics
 *
 * shows you what you working with fr fr
 * includes distributions, time series, and performance metrics
 */
import { logger } from '../../utils/logger.js';
import { _EMBEDDING_CACHE } from '../../mcp/toolRegistry.js';
import { _SERVER_CACHE } from '../../mcp/specMemServer.js';
import { getCompressionStats } from '../../utils/tokenCompressor.js';
import { getCompressionMetrics } from '../../services/ResponseCompactor.js';
import { getMemoryManager } from '../../utils/memoryManager.js';
import { getEmbeddingServerManager } from '../../mcp/embeddingServerManager.js';
import { getProjectPathForInsert } from '../../services/ProjectContext.js';
import { formatHumanReadable } from '../../utils/humanReadableOutput.js';
/**
 * ShowMeTheStats - statistics tool
 *
 * gives you the full picture of your memory system
 * distributions, performance, and more
 */
export class ShowMeTheStats {
    db;
    name = 'show_me_the_stats';
    description = 'get memory system statistics and distributions - shows total counts, type/importance distributions, cache performance, and more';
    inputSchema = {
        type: 'object',
        properties: {
            includeTagDistribution: {
                type: 'boolean',
                default: false,
                description: 'include tag usage distribution'
            },
            includeTypeDistribution: {
                type: 'boolean',
                default: true,
                description: 'include memory type distribution'
            },
            includeImportanceDistribution: {
                type: 'boolean',
                default: true,
                description: 'include importance level distribution'
            },
            includeTimeSeriesData: {
                type: 'boolean',
                default: false,
                description: 'include time series data'
            },
            timeSeriesGranularity: {
                type: 'string',
                enum: ['hour', 'day', 'week', 'month'],
                default: 'day',
                description: 'granularity for time series data'
            },
            includeRelationshipStats: {
                type: 'boolean',
                default: false,
                description: 'include memory relationship statistics'
            },
            includeCacheStats: {
                type: 'boolean',
                default: true,
                description: 'include cache performance stats'
            },
            includeInstanceStats: {
                type: 'boolean',
                default: true,
                description: 'include per-instance RAM usage tracking'
            },
            includeAllInstances: {
                type: 'boolean',
                default: false,
                description: 'include stats from all running SpecMem instances (cross-process)'
            },
            includeEmbeddingServerStatus: {
                type: 'boolean',
                default: true,
                description: 'include embedding server health status'
            }
        }
    };
    constructor(db) {
        this.db = db;
    }
    async execute(params) {
        logger.debug({ params }, 'getting stats');
        try {
            // get base stats
            const baseStats = await this.getBaseStats();
            const stats = {
                ...baseStats
            };
            // add optional distributions
            if (params.includeTypeDistribution !== false) {
                stats.typeDistribution = await this.getTypeDistribution();
            }
            if (params.includeImportanceDistribution !== false) {
                stats.importanceDistribution = await this.getImportanceDistribution();
            }
            if (params.includeTagDistribution) {
                stats.tagDistribution = await this.getTagDistribution();
            }
            if (params.includeTimeSeriesData) {
                stats.timeSeriesData = await this.getTimeSeriesData(params.timeSeriesGranularity ?? 'day');
            }
            if (params.includeRelationshipStats) {
                stats.relationshipStats = await this.getRelationshipStats();
            }
            if (params.includeCacheStats !== false) {
                stats.cacheStats = this.getCacheStats();
                stats.databaseStats = await this.getDatabaseStats();
                // Include Chinese Compactor (compression) stats
                const compStats = getCompressionStats();
                stats.compressionStats = {
                    enabled: compStats.enabled,
                    termCount: compStats.termCount,
                    minLength: compStats.config.minLength,
                    threshold: compStats.config.threshold
                };
                // Include response compaction metrics (tracking token savings)
                const compMetrics = getCompressionMetrics();
                stats.responseCompactionMetrics = {
                    totalCompressed: compMetrics.totalCompressed,
                    bytesSaved: compMetrics.totalOriginalBytes - compMetrics.totalCompressedBytes,
                    averageRatio: compMetrics.averageRatio,
                    byContext: compMetrics.byContext
                };
            }
            // Include per-instance RAM usage tracking
            if (params.includeInstanceStats !== false) {
                stats.instanceStats = await this.getInstanceStats(params.includeAllInstances ?? false);
            }
            // Include embedding server health status
            if (params.includeEmbeddingServerStatus !== false) {
                stats.embeddingServerStatus = this.getEmbeddingServerStatus();
            }
            logger.info({ totalMemories: stats.totalMemories }, 'stats retrieved');
            // Build human-readable stats output
            const statsLines = [];
            // Memory stats (always included)
            statsLines.push(`Total: ${stats.totalMemories || 0} | Size: ${stats.totalSize || 0}B | Images: ${stats.memoriesWithImages || 0} | Expired: ${stats.expiredMemories || 0} | Consolidated: ${stats.consolidatedMemories || 0}`);
            // Type distribution (if included)
            if (stats.typeDistribution) {
                const types = `procedural:${stats.typeDistribution.procedural} semantic:${stats.typeDistribution.semantic} episodic:${stats.typeDistribution.episodic} working:${stats.typeDistribution.working} consolidated:${stats.typeDistribution.consolidated}`;
                statsLines.push(`Types: ${types}`);
            }
            // Importance distribution (if included)
            if (stats.importanceDistribution) {
                const importance = `critical:${stats.importanceDistribution.critical} high:${stats.importanceDistribution.high} medium:${stats.importanceDistribution.medium} low:${stats.importanceDistribution.low} trivial:${stats.importanceDistribution.trivial}`;
                statsLines.push(`Importance: ${importance}`);
            }
            // Cache stats (if included)
            if (stats.cacheStats) {
                const cache = `size:${stats.cacheStats.embeddingCacheSize} embeddingHit:${Math.round(stats.cacheStats.embeddingCacheHitRate * 100)}% serverHit:${Math.round(stats.cacheStats.serverCacheHitRate * 100)}%`;
                statsLines.push(`Cache: ${cache}`);
            }
            // Database stats (if included)
            if (stats.databaseStats) {
                const db = `total:${stats.databaseStats.totalConnections} idle:${stats.databaseStats.idleConnections} waiting:${stats.databaseStats.waitingConnections}`;
                statsLines.push(`DB Connections: ${db}`);
            }
            // Instance stats (if included)
            if (stats.instanceStats?.currentInstance) {
                const inst = stats.instanceStats.currentInstance;
                const instance = `heap:${inst.heapUsedMB}/${inst.heapTotalMB}MB rss:${inst.rssMB}MB usage:${inst.usagePercent}% pressure:${inst.pressureLevel} gc:${inst.autoGCCount} uptime:${inst.uptimeSeconds}s`;
                statsLines.push(`Instance (${inst.instanceId}): ${instance}`);
            }
            // Compression stats (if included)
            if (stats.compressionStats) {
                const compression = `enabled:${stats.compressionStats.enabled} terms:${stats.compressionStats.termCount} minLen:${stats.compressionStats.minLength} threshold:${stats.compressionStats.threshold}`;
                statsLines.push(`Compression: ${compression}`);
            }
            // Response compaction metrics (if included)
            if (stats.responseCompactionMetrics) {
                const compaction = `total:${stats.responseCompactionMetrics.totalCompressed} saved:${stats.responseCompactionMetrics.bytesSaved}B ratio:${Math.round(stats.responseCompactionMetrics.averageRatio * 100)}%`;
                statsLines.push(`Compaction: ${compaction}`);
            }
            // Embedding server status (if included)
            if (stats.embeddingServerStatus) {
                const status = stats.embeddingServerStatus;
                const embedding = `running:${status.running} healthy:${status.healthy} pid:${status.pid || 'N/A'} failures:${status.consecutiveFailures} restarts:${status.restartCount} uptime:${status.uptimeSeconds || 'N/A'}s socket:${status.socketExists}`;
                statsLines.push(`Embedding Server: ${embedding}`);
            }
            const humanReadableData = [{
                    id: 'stats',
                    similarity: 1.0,
                    content: `[STATS] ${statsLines.join(' | ')}`,
                }];
            return formatHumanReadable('show_me_the_stats', humanReadableData, {
                grey: true,
                maxContentLength: 1000
            });
        }
        catch (error) {
            logger.error({ error }, 'failed to get stats');
            throw error;
        }
    }
    /**
     * Get embedding server health status
     */
    getEmbeddingServerStatus() {
        try {
            const manager = getEmbeddingServerManager();
            const status = manager.getStatus();
            return {
                running: status.running,
                healthy: status.healthy,
                pid: status.pid,
                consecutiveFailures: status.consecutiveFailures,
                restartCount: status.restartCount,
                uptimeSeconds: status.uptime ? Math.round(status.uptime / 1000) : null,
                lastHealthCheck: status.lastHealthCheck,
                socketPath: status.socketPath,
                socketExists: status.socketExists,
            };
        }
        catch (error) {
            logger.debug({ error }, 'Failed to get embedding server status');
            return undefined;
        }
    }
    /**
     * Get per-instance RAM usage statistics
     */
    async getInstanceStats(includeAllInstances) {
        try {
            const memoryManager = getMemoryManager();
            const currentStats = memoryManager.getStats();
            const instanceStats = {
                currentInstance: {
                    instanceId: currentStats.instanceId ?? 'unknown',
                    projectPath: currentStats.projectPath ?? process.cwd(),
                    heapUsedMB: Math.round(currentStats.heapUsed / 1024 / 1024 * 100) / 100,
                    heapTotalMB: Math.round(currentStats.heapTotal / 1024 / 1024 * 100) / 100,
                    rssMB: Math.round(currentStats.rss / 1024 / 1024 * 100) / 100,
                    usagePercent: Math.round(currentStats.usagePercent * 10000) / 100, // 2 decimal places
                    pressureLevel: currentStats.pressureLevel,
                    autoGCCount: currentStats.autoGCCount ?? 0,
                    uptimeSeconds: Math.round(currentStats.uptime / 1000)
                }
            };
            // Optionally include all instances across processes
            if (includeAllInstances) {
                instanceStats.globalStats = await memoryManager.getGlobalInstanceStats();
                // Convert byte values to MB for readability
                if (instanceStats.globalStats) {
                    instanceStats.globalStats.totalHeapUsed = Math.round(instanceStats.globalStats.totalHeapUsed / 1024 / 1024 * 100) / 100;
                    instanceStats.globalStats.totalRss = Math.round(instanceStats.globalStats.totalRss / 1024 / 1024 * 100) / 100;
                    instanceStats.globalStats.averageUsagePercent = Math.round(instanceStats.globalStats.averageUsagePercent * 10000) / 100;
                    // Convert instance snapshots to MB as well
                    instanceStats.globalStats.instances = instanceStats.globalStats.instances.map(inst => ({
                        ...inst,
                        heapUsed: Math.round(inst.heapUsed / 1024 / 1024 * 100) / 100,
                        heapTotal: Math.round(inst.heapTotal / 1024 / 1024 * 100) / 100,
                        rss: Math.round(inst.rss / 1024 / 1024 * 100) / 100,
                        usagePercent: Math.round(inst.usagePercent * 10000) / 100
                    }));
                }
            }
            return instanceStats;
        }
        catch (error) {
            logger.debug({ error }, 'Failed to get instance stats');
            return undefined;
        }
    }
    /**
     * get base memory statistics
     */
    async getBaseStats() {
        const projectPath = getProjectPathForInsert();
        const query = `
      SELECT
        COUNT(*) as total_memories,
        COALESCE(SUM(LENGTH(content)), 0) as total_size,
        MIN(created_at) as oldest_memory,
        MAX(created_at) as newest_memory,
        COALESCE(AVG(access_count), 0) as avg_access_count,
        COUNT(*) FILTER (WHERE image_data IS NOT NULL) as memories_with_images,
        COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at <= NOW()) as expired_memories,
        COUNT(*) FILTER (WHERE memory_type = 'consolidated') as consolidated_memories
      FROM memories
      WHERE project_path = $1
    `;
        const result = await this.db.query(query, [projectPath]);
        const row = result.rows[0];
        return {
            totalMemories: parseInt(row.total_memories, 10),
            totalSize: parseInt(row.total_size, 10),
            oldestMemory: row.oldest_memory,
            newestMemory: row.newest_memory,
            averageAccessCount: parseFloat(row.avg_access_count),
            memoriesWithImages: parseInt(row.memories_with_images, 10),
            expiredMemories: parseInt(row.expired_memories, 10),
            consolidatedMemories: parseInt(row.consolidated_memories, 10)
        };
    }
    /**
     * get memory type distribution
     */
    async getTypeDistribution() {
        const projectPath = getProjectPathForInsert();
        const query = `
      SELECT memory_type, COUNT(*) as count
      FROM memories
      WHERE project_path = $1
      GROUP BY memory_type
    `;
        const result = await this.db.query(query, [projectPath]);
        const distribution = {
            episodic: 0,
            semantic: 0,
            procedural: 0,
            working: 0,
            consolidated: 0
        };
        for (const row of result.rows) {
            distribution[row.memory_type] = parseInt(row.count, 10);
        }
        return distribution;
    }
    /**
     * get importance level distribution
     */
    async getImportanceDistribution() {
        const projectPath = getProjectPathForInsert();
        const query = `
      SELECT importance, COUNT(*) as count
      FROM memories
      WHERE project_path = $1
      GROUP BY importance
    `;
        const result = await this.db.query(query, [projectPath]);
        const distribution = {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            trivial: 0
        };
        for (const row of result.rows) {
            distribution[row.importance] = parseInt(row.count, 10);
        }
        return distribution;
    }
    /**
     * get tag usage distribution
     */
    async getTagDistribution() {
        const projectPath = getProjectPathForInsert();
        const query = `
      SELECT tag, COUNT(*) as count
      FROM memories, unnest(tags) as tag
      WHERE project_path = $1
      GROUP BY tag
      ORDER BY count DESC
      LIMIT 50
    `;
        const result = await this.db.query(query, [projectPath]);
        const distribution = {};
        for (const row of result.rows) {
            distribution[row.tag] = parseInt(row.count, 10);
        }
        return distribution;
    }
    /**
     * get time series data for memory creation
     */
    async getTimeSeriesData(granularity) {
        const projectPath = getProjectPathForInsert();
        const truncFunction = granularity === 'hour' ? 'hour'
            : granularity === 'week' ? 'week'
                : granularity === 'month' ? 'month'
                    : 'day';
        const query = `
      SELECT
        date_trunc('${truncFunction}', created_at) as period,
        COUNT(*) as count,
        AVG(CASE importance
          WHEN 'critical' THEN 5
          WHEN 'high' THEN 4
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 2
          WHEN 'trivial' THEN 1
        END) as avg_importance
      FROM memories
      WHERE project_path = $1
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY date_trunc('${truncFunction}', created_at)
      ORDER BY period DESC
      LIMIT 100
    `;
        const result = await this.db.query(query, [projectPath]);
        return result.rows.map((row) => ({
            period: row.period.toISOString(),
            count: parseInt(row.count, 10),
            avgImportance: parseFloat(row.avg_importance)
        }));
    }
    /**
     * get relationship statistics
     */
    async getRelationshipStats() {
        const projectPath = getProjectPathForInsert();
        // total relations - join to memories to filter by project_path
        const totalResult = await this.db.query(`SELECT COUNT(*) as count
       FROM memory_relations mr
       JOIN memories m ON mr.source_id = m.id
       WHERE m.project_path = $1`, [projectPath]);
        const totalRelations = parseInt(totalResult.rows[0]?.count ?? '0', 10);
        // average connections per memory - filter by project_path
        const avgResult = await this.db.query(`SELECT AVG(connection_count) as avg
       FROM (
         SELECT mr.source_id, COUNT(*) as connection_count
         FROM memory_relations mr
         JOIN memories m ON mr.source_id = m.id
         WHERE m.project_path = $1
         GROUP BY mr.source_id
       ) subquery`, [projectPath]);
        const avgConnections = parseFloat(avgResult.rows[0]?.avg ?? '0');
        // most connected memories - filter by project_path
        const topResult = await this.db.query(`SELECT mr.source_id as id, COUNT(*) as connections
       FROM memory_relations mr
       JOIN memories m ON mr.source_id = m.id
       WHERE m.project_path = $1
       GROUP BY mr.source_id
       ORDER BY connections DESC
       LIMIT 10`, [projectPath]);
        const mostConnected = topResult.rows.map((row) => ({
            id: row.id,
            connections: parseInt(row.connections, 10)
        }));
        return {
            totalRelations,
            avgConnectionsPerMemory: avgConnections,
            mostConnectedMemories: mostConnected
        };
    }
    /**
     * get cache statistics
     */
    getCacheStats() {
        const totalServerAccess = _SERVER_CACHE.hitCount + _SERVER_CACHE.missCount;
        const serverHitRate = totalServerAccess > 0
            ? _SERVER_CACHE.hitCount / totalServerAccess
            : 0;
        return {
            embeddingCacheSize: _EMBEDDING_CACHE.size,
            embeddingCacheHitRate: 0.9, // estimated from doobidoo metrics
            serverCacheHitRate: serverHitRate
        };
    }
    /**
     * get database connection stats
     */
    async getDatabaseStats() {
        const stats = await this.db.getStats();
        return {
            totalConnections: stats.total,
            idleConnections: stats.idle,
            waitingConnections: stats.waiting
        };
    }
    /**
     * get storage size breakdown
     */
    async getStorageBreakdown() {
        const query = `
      SELECT
        COALESCE(SUM(LENGTH(content)), 0) as content_size,
        COALESCE(SUM(LENGTH(embedding::text)), 0) as embeddings_size,
        COALESCE(SUM(LENGTH(image_data)), 0) as images_size,
        COALESCE(SUM(LENGTH(metadata::text)), 0) as metadata_size
      FROM memories
    `;
        const result = await this.db.query(query);
        const row = result.rows[0];
        const contentSize = parseInt(row.content_size, 10);
        const embeddingsSize = parseInt(row.embeddings_size, 10);
        const imagesSize = parseInt(row.images_size, 10);
        const metadataSize = parseInt(row.metadata_size, 10);
        return {
            contentSize,
            embeddingsSize,
            imagesSize,
            metadataSize,
            totalSize: contentSize + embeddingsSize + imagesSize + metadataSize
        };
    }
    /**
     * get health check status
     */
    async healthCheck() {
        const checks = {};
        // database connection check
        try {
            await this.db.query('SELECT 1');
            checks['database'] = { status: true, message: 'connected' };
        }
        catch (error) {
            checks['database'] = {
                status: false,
                message: error instanceof Error ? error.message : 'connection failed'
            };
        }
        // pgvector extension check
        try {
            await this.db.query("SELECT 'test'::vector(3)");
            checks['pgvector'] = { status: true, message: 'extension loaded' };
        }
        catch (error) {
            checks['pgvector'] = { status: false, message: 'extension not available' };
        }
        // memory table check
        try {
            const result = await this.db.query('SELECT COUNT(*) as count FROM memories');
            checks['memories_table'] = {
                status: true,
                message: `${result.rows[0]?.count ?? 0} memories`
            };
        }
        catch (error) {
            checks['memories_table'] = { status: false, message: 'table not accessible' };
        }
        // determine overall status
        const allPassing = Object.values(checks).every(c => c.status);
        const somePassing = Object.values(checks).some(c => c.status);
        const status = allPassing ? 'healthy'
            : somePassing ? 'degraded'
                : 'unhealthy';
        return { status, checks };
    }
}
//# sourceMappingURL=showMeTheStats.js.map