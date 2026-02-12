/**
 * memoryHealthCheck.ts - MEMORY SYSTEM HEALTH AND MAINTENANCE
 *
 * This tool provides:
 * 1. Memory health overview (fading memories, association strength)
 * 2. Maintenance operations (decay associations, clean up)
 * 3. Memory strength updates (reinforce important memories)
 * 4. System statistics (quadrants, chains, associations)
 *
 * Think of this as the "memory doctor" - it keeps the memory system healthy.
 */
import { HumanLikeMemorySystem } from '../../memory/humanLikeMemory.js';
import { logger } from '../../utils/logger.js';
import { formatHumanReadable } from '../../utils/humanReadableOutput.js';
/**
 * MemoryHealthCheck - System Health and Maintenance Tool
 *
 * Use this to:
 * 1. Monitor overall memory system health
 * 2. Find memories that are "fading" and need reinforcement
 * 3. Run maintenance tasks (decay old associations)
 * 4. Manually reinforce important memories
 */
export class MemoryHealthCheck {
    db;
    embeddingProvider;
    name = 'memory_health_check';
    description = 'Monitor and maintain memory system health - find fading memories, decay old associations, reinforce important memories';
    inputSchema = {
        type: 'object',
        properties: {
            operation: {
                type: 'string',
                enum: ['overview', 'fading_memories', 'decay_associations', 'reinforce_memory', 'stats', 'regenerate_embeddings'],
                description: 'What operation to perform - regenerate_embeddings fixes memories with NULL or missing embeddings'
            },
            fadingThreshold: {
                type: 'number',
                default: 0.3,
                minimum: 0,
                maximum: 1,
                description: 'Retrievability threshold below which memories are considered "fading"'
            },
            limit: {
                type: 'number',
                default: 20,
                description: 'Maximum number of fading memories to return'
            },
            memoryId: {
                type: 'string',
                format: 'uuid',
                description: 'Memory ID to reinforce (for reinforce_memory operation)'
            },
            wasSuccessfulRecall: {
                type: 'boolean',
                default: true,
                description: 'Whether the recall was successful (for reinforce_memory)'
            },
            importance: {
                type: 'string',
                enum: ['critical', 'high', 'medium', 'low', 'trivial'],
                default: 'medium',
                description: 'Importance level (for reinforce_memory)'
            },
            dryRun: {
                type: 'boolean',
                default: false,
                description: 'For regenerate_embeddings: preview what would be fixed without making changes'
            },
            batchSize: {
                type: 'number',
                default: 50,
                minimum: 1,
                maximum: 500,
                description: 'For regenerate_embeddings: how many memories to process at once'
            }
        },
        required: ['operation']
    };
    memorySystem;
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
        this.memorySystem = new HumanLikeMemorySystem(db, embeddingProvider);
    }
    async execute(params) {
        logger.debug({ operation: params.operation }, 'memory health check');
        try {
            switch (params.operation) {
                case 'overview':
                    return this.getOverview();
                case 'fading_memories':
                    return this.getFadingMemories(params.fadingThreshold ?? 0.3, params.limit ?? 20);
                case 'decay_associations':
                    return this.decayAssociations();
                case 'reinforce_memory':
                    return this.reinforceMemory(params.memoryId, params.wasSuccessfulRecall ?? true, params.importance ?? 'medium');
                case 'stats':
                    return this.getDetailedStats();
                case 'regenerate_embeddings':
                    return this.regenerateEmbeddings(params.dryRun ?? false, params.batchSize ?? 50);
                default:
                    return {
                        success: false,
                        data: {},
                        message: `Unknown operation: ${params.operation}`
                    };
            }
        }
        catch (error) {
            logger.error({ error, operation: params.operation }, 'health check failed');
            return {
                success: false,
                data: {},
                message: error instanceof Error ? error.message : 'Health check failed'
            };
        }
    }
    /**
     * Get overall memory system health overview
     */
    async getOverview() {
        // Try to use the view first, fall back to direct queries
        let data = {};
        try {
            const viewResult = await this.db.query('SELECT * FROM memory_health_overview');
            if (viewResult.rows.length > 0) {
                const row = viewResult.rows[0];
                data = {
                    totalMemories: parseInt(row.total_memories || '0'),
                    strongMemories: parseInt(row.strong_memories || '0'),
                    fadingMemories: parseInt(row.fading_memories || '0'),
                    totalAssociations: parseInt(row.total_associations || '0'),
                    totalChains: parseInt(row.total_chains || '0'),
                    totalQuadrants: parseInt(row.total_quadrants || '0'),
                    avgRetrievability: parseFloat(row.avg_retrievability || '0'),
                    avgStability: parseFloat(row.avg_stability || '0')
                };
            }
        }
        catch (error) {
            // View might not exist yet, use fallback queries
            logger.debug('health view not available, using fallback queries');
            const memoriesResult = await this.db.query(`
        SELECT COUNT(*) as count FROM memories
        WHERE expires_at IS NULL OR expires_at > NOW()
      `);
            data.totalMemories = parseInt(memoriesResult.rows[0]?.count || '0');
            try {
                const strengthResult = await this.db.query(`
          SELECT
            COUNT(*) FILTER (WHERE retrievability > 0.7) as strong,
            COUNT(*) FILTER (WHERE retrievability < 0.3) as fading,
            AVG(retrievability) as avg_ret,
            AVG(stability) as avg_stab
          FROM memory_strength
        `);
                if (strengthResult.rows[0]) {
                    data.strongMemories = parseInt(strengthResult.rows[0].strong || '0');
                    data.fadingMemories = parseInt(strengthResult.rows[0].fading || '0');
                    data.avgRetrievability = parseFloat(strengthResult.rows[0].avg_ret || '0');
                    data.avgStability = parseFloat(strengthResult.rows[0].avg_stab || '0');
                }
            }
            catch (e) {
                // Tables might not exist yet
                data.strongMemories = 0;
                data.fadingMemories = 0;
            }
        }
        // Format as human-readable summary
        const avgRet = typeof data.avgRetrievability === 'number' ? data.avgRetrievability.toFixed(2) : 'N/A';
        const summaryLine = [
            `Total: ${data.totalMemories || 0}`,
            `Strong: ${data.strongMemories || 0}`,
            `Fading: ${data.fadingMemories || 0}`,
            `Avg Retrievability: ${avgRet}`
        ].join(' | ');
        const humanReadableData = [{
                id: 'health-overview',
                similarity: 1.0,
                content: `[HEALTH] ${summaryLine}. Memory system health check complete.`
            }];
        return formatHumanReadable('memory_health_check', humanReadableData, {
            grey: true,
            maxContentLength: 800
        });
    }
    /**
     * Get list of fading memories that need attention
     */
    async getFadingMemories(threshold, limit) {
        const fadingMemories = await this.memorySystem.getFadingMemories(threshold, limit);
        const fadingList = fadingMemories.map(({ memory, strength }) => ({
            memoryId: memory.id,
            content: memory.content.substring(0, 200) + (memory.content.length > 200 ? '...' : ''),
            importance: memory.importance,
            retrievability: strength.retrievability,
            stability: strength.stability,
            daysSinceAccess: Math.floor((Date.now() - strength.lastReview.getTime()) / (1000 * 60 * 60 * 24))
        }));
        // Format as human-readable list
        const humanReadableData = fadingList.map((item, idx) => ({
            id: item.memoryId,
            similarity: 1.0 - (idx / fadingList.length * 0.3),
            content: `[FADING] ${item.content} | R=${item.retrievability.toFixed(2)} S=${item.stability.toFixed(2)} Days=${item.daysSinceAccess}`
        }));
        if (humanReadableData.length === 0) {
            humanReadableData.push({
                id: 'no-fading',
                similarity: 1.0,
                content: `[HEALTH] No fading memories found (threshold: ${threshold})`
            });
        }
        return formatHumanReadable('memory_health_check', humanReadableData, {
            grey: true,
            maxContentLength: 800
        });
    }
    /**
     * Decay old associations (maintenance task)
     */
    async decayAssociations() {
        const decayedCount = await this.memorySystem.decayAssociations(30);
        return {
            success: true,
            data: {
                associationsDecayed: decayedCount
            },
            message: `Decayed ${decayedCount} weak associations`
        };
    }
    /**
     * Manually reinforce a memory's strength
     */
    async reinforceMemory(memoryId, wasSuccessfulRecall, importance) {
        if (!memoryId) {
            return {
                success: false,
                data: {},
                message: 'memoryId is required for reinforce_memory operation'
            };
        }
        const updatedStrength = await this.memorySystem.updateMemoryStrength(memoryId, wasSuccessfulRecall, importance);
        return {
            success: true,
            data: {
                updatedStrength
            },
            message: `Memory ${memoryId} reinforced: retrievability=${updatedStrength.retrievability.toFixed(2)}, stability=${updatedStrength.stability.toFixed(1)}`
        };
    }
    /**
     * Get detailed system statistics
     */
    async getDetailedStats() {
        const stats = {};
        // Memory counts by type
        try {
            const typeResult = await this.db.query(`
        SELECT memory_type, COUNT(*) as count
        FROM memories
        WHERE expires_at IS NULL OR expires_at > NOW()
        GROUP BY memory_type
      `);
            stats.memoryTypeDistribution = typeResult.rows.reduce((acc, row) => {
                acc[row.memory_type] = parseInt(row.count);
                return acc;
            }, {});
        }
        catch (e) {
            stats.memoryTypeDistribution = {};
        }
        // Memory counts by importance
        try {
            const impResult = await this.db.query(`
        SELECT importance, COUNT(*) as count
        FROM memories
        WHERE expires_at IS NULL OR expires_at > NOW()
        GROUP BY importance
      `);
            stats.importanceDistribution = impResult.rows.reduce((acc, row) => {
                acc[row.importance] = parseInt(row.count);
                return acc;
            }, {});
        }
        catch (e) {
            stats.importanceDistribution = {};
        }
        // Association stats
        try {
            const assocResult = await this.db.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE strength > 0.7) as strong,
          COUNT(*) FILTER (WHERE strength < 0.3) as weak,
          AVG(strength) as avg_strength
        FROM memory_associations
      `);
            if (assocResult.rows[0]) {
                stats.associations = {
                    total: parseInt(assocResult.rows[0].total || '0'),
                    strong: parseInt(assocResult.rows[0].strong || '0'),
                    weak: parseInt(assocResult.rows[0].weak || '0'),
                    avgStrength: parseFloat(assocResult.rows[0].avg_strength || '0')
                };
            }
        }
        catch (e) {
            stats.associations = { total: 0, strong: 0, weak: 0, avgStrength: 0 };
        }
        // Chain stats
        try {
            const chainResult = await this.db.query(`
        SELECT
          COUNT(*) as total,
          chain_type,
          AVG(array_length(memory_ids, 1)) as avg_length
        FROM memory_chains
        GROUP BY chain_type
      `);
            stats.chains = chainResult.rows;
        }
        catch (e) {
            stats.chains = [];
        }
        // Quadrant stats
        try {
            const quadResult = await this.db.query(`
        SELECT
          COUNT(*) as total,
          SUM(memory_count) as total_assigned,
          AVG(memory_count) as avg_per_quadrant
        FROM memory_quadrants
      `);
            if (quadResult.rows[0]) {
                stats.quadrants = {
                    total: parseInt(quadResult.rows[0].total || '0'),
                    totalAssigned: parseInt(quadResult.rows[0].total_assigned || '0'),
                    avgPerQuadrant: parseFloat(quadResult.rows[0].avg_per_quadrant || '0')
                };
            }
        }
        catch (e) {
            stats.quadrants = { total: 0, totalAssigned: 0, avgPerQuadrant: 0 };
        }
        // Format as human-readable stats summary
        const assocStats = stats.associations || { total: 0, strong: 0, weak: 0, avgStrength: 0 };
        const quadStats = stats.quadrants || { total: 0, totalAssigned: 0 };
        const summaryLine = [
            `Associations: ${assocStats.total} (${assocStats.strong} strong, ${assocStats.weak} weak)`,
            `Quadrants: ${quadStats.total} (${quadStats.totalAssigned} assigned)`,
            `Chains: ${stats.chains?.length || 0}`
        ].join(' | ');
        const humanReadableData = [{
                id: 'detailed-stats',
                similarity: 1.0,
                content: `[STATS] ${summaryLine}. Detailed statistics retrieved.`
            }];
        return formatHumanReadable('memory_health_check', humanReadableData, {
            grey: true,
            maxContentLength: 800
        });
    }
    /**
     * REGENERATE EMBEDDINGS - Fix memories with NULL or missing embeddings
     *
     * This operation:
     * 1. Finds all memories with NULL embeddings
     * 2. Generates proper ML embeddings using the embedding provider
     * 3. Updates the database with the new embeddings
     *
     * IMPORTANT: This uses the ML embedding provider (NOT hash fallback!)
     * Hash embeddings are in a different vector space and would corrupt search.
     *
     * Use dryRun=true to see what would be fixed without making changes.
     */
    async regenerateEmbeddings(dryRun, batchSize) {
        logger.info({ dryRun, batchSize }, '[HealthCheck] Starting embedding regeneration');
        // Find memories with NULL embeddings
        const nullResult = await this.db.query(`
      SELECT id, content, created_at
      FROM memories
      WHERE embedding IS NULL
      ORDER BY created_at DESC
      LIMIT $1
    `, [batchSize]);
        const nullEmbeddings = nullResult.rows.length;
        if (nullEmbeddings === 0) {
            const humanReadableData = [{
                    id: 'regenerate-embeddings',
                    similarity: 1.0,
                    content: '[EMBEDDINGS] All memories have embeddings - nothing to regenerate!'
                }];
            return formatHumanReadable('memory_health_check', humanReadableData, {
                grey: true,
                maxContentLength: 800
            });
        }
        if (dryRun) {
            const humanReadableData = [{
                    id: 'regenerate-embeddings-dry',
                    similarity: 1.0,
                    content: `[EMBEDDINGS] DRY RUN: Found ${nullEmbeddings} memories with NULL embeddings that would be regenerated`
                }];
            return formatHumanReadable('memory_health_check', humanReadableData, {
                grey: true,
                maxContentLength: 800
            });
        }
        // Actually regenerate embeddings
        let regenerated = 0;
        let failed = 0;
        const failedIds = [];
        for (const row of nullResult.rows) {
            try {
                // Generate embedding using ML provider (NOT hash fallback!)
                const embedding = await this.embeddingProvider.generateEmbedding(row.content);
                // Update the database
                await this.db.query(`UPDATE memories SET embedding = $1::vector WHERE id = $2`, [`[${embedding.join(',')}]`, row.id]);
                regenerated++;
                logger.debug({ memoryId: row.id }, '[HealthCheck] Regenerated embedding');
            }
            catch (error) {
                failed++;
                failedIds.push(row.id);
                logger.warn({ error, memoryId: row.id }, '[HealthCheck] Failed to regenerate embedding');
            }
        }
        const summaryLine = `Regenerated ${regenerated}/${nullEmbeddings} embeddings${failed > 0 ? `. ${failed} failed` : ''}`;
        const humanReadableData = [{
                id: 'regenerate-embeddings-result',
                similarity: 1.0,
                content: `[EMBEDDINGS] ${summaryLine}${failedIds.length > 0 ? ` | Failed IDs: ${failedIds.slice(0, 5).join(', ')}` : ''}`
            }];
        return formatHumanReadable('memory_health_check', humanReadableData, {
            grey: true,
            maxContentLength: 800
        });
    }
}
export default MemoryHealthCheck;
//# sourceMappingURL=memoryHealthCheck.js.map