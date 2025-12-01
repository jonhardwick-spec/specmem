/**
 * spatialSearch.ts - SPATIAL MEMORY SEARCH TOOL
 *
 * MCP tool for searching memories using spatial/quadrant organization.
 * Enables Claude to search memories like navigating a map - by region,
 * cluster, or following hot paths.
 *
 * This is how Claude's memory becomes truly intelligent - not just
 * searching text, but understanding the landscape of knowledge.
 *
 * Use cases:
 * - "Find all memories in the technical quadrant"
 * - "Get memories in the cluster about API design"
 * - "What memories are frequently accessed with this one?"
 * - "Show me the neighborhood around this memory"
 */
import { logger } from '../../utils/logger.js';
import { getSpatialEngine } from '../../db/spatialMemory.js';
import { getHotPathManager } from '../../db/hotPathManager.js';
// =============================================================================
// SPATIAL SEARCH TOOL
// =============================================================================
export class SpatialSearch {
    name = 'spatial_search';
    description = `Search memories using spatial/semantic organization.
Modes:
- quadrant: Search within a semantic quadrant (Q1-TECH, Q2-CONCEPT, Q3-PROC, Q4-CONTEXT)
- cluster: Search within a memory cluster by ID or name
- neighborhood: Find memories near a specific memory in semantic space
- hot_path: Get memories along a frequently accessed path
- predict: Predict next likely memories based on current context`;
    inputSchema = {
        type: 'object',
        properties: {
            mode: {
                type: 'string',
                enum: ['quadrant', 'cluster', 'neighborhood', 'hot_path', 'predict'],
                description: 'Search mode to use'
            },
            quadrantCode: {
                type: 'string',
                description: 'Quadrant code for quadrant search (e.g., Q1-TECH, Q2-CONCEPT)'
            },
            quadrantId: {
                type: 'number',
                description: 'Quadrant ID for quadrant search'
            },
            clusterId: {
                type: 'number',
                description: 'Cluster ID for cluster search'
            },
            clusterName: {
                type: 'string',
                description: 'Cluster name pattern for cluster search'
            },
            memoryId: {
                type: 'string',
                format: 'uuid',
                description: 'Memory ID for neighborhood search'
            },
            neighborhoodRadius: {
                type: 'number',
                default: 5,
                description: 'Number of neighboring memories to find'
            },
            hotPathId: {
                type: 'number',
                description: 'Hot path ID to retrieve'
            },
            startMemoryId: {
                type: 'string',
                format: 'uuid',
                description: 'Starting memory ID for hot path discovery'
            },
            currentMemoryId: {
                type: 'string',
                format: 'uuid',
                description: 'Current memory ID for prediction'
            },
            limit: {
                type: 'number',
                default: 20,
                minimum: 1,
                maximum: 100,
                description: 'Maximum number of results'
            },
            includeStats: {
                type: 'boolean',
                default: false,
                description: 'Include statistics in response'
            }
        },
        required: ['mode']
    };
    db;
    spatialEngine;
    hotPathManager;
    constructor(db) {
        this.db = db;
    }
    ensureEngines() {
        // Lazy initialization - engines need pool from db
        if (!this.spatialEngine) {
            this.spatialEngine = getSpatialEngine(this.db.pool);
        }
        if (!this.hotPathManager) {
            this.hotPathManager = getHotPathManager(this.db.pool);
        }
    }
    async execute(params) {
        this.ensureEngines();
        const start = Date.now();
        logger.debug({ params }, 'spatial search started');
        try {
            switch (params.mode) {
                case 'quadrant':
                    return await this.searchQuadrant(params, start);
                case 'cluster':
                    return await this.searchCluster(params, start);
                case 'neighborhood':
                    return await this.searchNeighborhood(params, start);
                case 'hot_path':
                    return await this.searchHotPath(params, start);
                case 'predict':
                    return await this.predictNext(params, start);
                default:
                    return {
                        memories: [],
                        message: `Unknown search mode: ${params.mode}`
                    };
            }
        }
        catch (error) {
            logger.error({ error, params }, 'spatial search failed');
            return {
                memories: [],
                message: `Search failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    // ===========================================================================
    // SEARCH MODES
    // ===========================================================================
    async searchQuadrant(params, startTime) {
        // Get quadrant
        let quadrant = null;
        if (params.quadrantCode) {
            quadrant = await this.spatialEngine.getQuadrantByCode(params.quadrantCode);
        }
        else if (params.quadrantId !== undefined) {
            quadrant = await this.spatialEngine.getQuadrant(params.quadrantId);
        }
        if (!quadrant) {
            // List available quadrants
            const quadrants = await this.spatialEngine.listQuadrants();
            const codes = quadrants.map(q => q.quadrantCode).join(', ');
            return {
                memories: [],
                message: `Quadrant not found. Available quadrants: ${codes || 'none - run initialization first'}`
            };
        }
        // Search within quadrant
        const results = await this.spatialEngine.getMemoriesInQuadrant(quadrant.id, params.limit ?? 20);
        const memories = results.map(r => r.memory);
        return {
            memories,
            quadrant,
            stats: params.includeStats ? {
                totalInRegion: quadrant.memoryCount,
                avgSimilarity: quadrant.avgSimilarity ?? undefined,
                searchDurationMs: Date.now() - startTime
            } : undefined,
            message: `Found ${memories.length} memories in quadrant "${quadrant.name}" (${quadrant.quadrantCode})`
        };
    }
    async searchCluster(params, startTime) {
        let cluster = null;
        if (params.clusterId !== undefined) {
            cluster = await this.spatialEngine.getCluster(params.clusterId);
        }
        else if (params.clusterName) {
            // Search by name
            const clusters = await this.spatialEngine.listClusters();
            cluster = clusters.find(c => c.name?.toLowerCase().includes(params.clusterName.toLowerCase())) ?? null;
        }
        if (!cluster) {
            // List available clusters
            const clusters = await this.spatialEngine.listClusters({ minMemoryCount: 1 });
            const names = clusters.slice(0, 10).map(c => c.name || `cluster-${c.id}`).join(', ');
            return {
                memories: [],
                message: `Cluster not found. Sample clusters: ${names || 'none - run clustering first'}`
            };
        }
        // Get memories in cluster
        const results = await this.spatialEngine.getMemoriesInCluster(cluster.id, params.limit ?? 20);
        const memories = results.map(r => r.memory);
        return {
            memories,
            cluster,
            stats: params.includeStats ? {
                totalInRegion: cluster.memoryCount,
                avgSimilarity: cluster.coherenceScore ?? undefined,
                searchDurationMs: Date.now() - startTime
            } : undefined,
            message: `Found ${memories.length} memories in cluster "${cluster.name}" (type: ${cluster.clusterType})`
        };
    }
    async searchNeighborhood(params, startTime) {
        if (!params.memoryId) {
            return {
                memories: [],
                message: 'memoryId required for neighborhood search'
            };
        }
        // Get the memory's embedding
        const memoryResult = await this.db.query('SELECT * FROM memories WHERE id = $1', [params.memoryId]);
        if (memoryResult.rows.length === 0) {
            return {
                memories: [],
                message: `Memory ${params.memoryId} not found`
            };
        }
        const memory = memoryResult.rows[0];
        if (!memory.embedding) {
            return {
                memories: [],
                message: 'Memory has no embedding - cannot find neighbors'
            };
        }
        // Find similar memories using vector search
        const limit = params.neighborhoodRadius ?? params.limit ?? 10;
        const neighbors = await this.db.query(`SELECT *, 1 - (embedding <=> $1::vector) as similarity
       FROM memories
       WHERE id != $2
       AND embedding IS NOT NULL
       AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY embedding <=> $1::vector
       LIMIT $3`, [memory.embedding, params.memoryId, limit]);
        const memories = neighbors.rows.map((row) => this.rowToMemory(row));
        // Also get any explicit relations
        const related = await this.db.query(`SELECT m.*, mr.relation_type, mr.strength
       FROM memories m
       JOIN memory_relations mr ON (
         (mr.source_id = $1 AND mr.target_id = m.id) OR
         (mr.target_id = $1 AND mr.source_id = m.id)
       )
       WHERE (m.expires_at IS NULL OR m.expires_at > NOW())
       LIMIT 10`, [params.memoryId]);
        const relatedMemories = related.rows.map((row) => this.rowToMemory(row));
        // Combine and deduplicate
        const seen = new Set();
        const combined = [];
        for (const mem of [...relatedMemories, ...memories]) {
            if (!seen.has(mem.id)) {
                seen.add(mem.id);
                combined.push(mem);
            }
        }
        return {
            memories: combined.slice(0, limit),
            stats: params.includeStats ? {
                totalInRegion: combined.length,
                searchDurationMs: Date.now() - startTime
            } : undefined,
            message: `Found ${combined.length} memories in neighborhood (${relatedMemories.length} explicit relations, ${memories.length} semantic neighbors)`
        };
    }
    async searchHotPath(params, startTime) {
        let hotPath = null;
        if (params.hotPathId !== undefined) {
            hotPath = await this.hotPathManager.getHotPath(params.hotPathId);
        }
        else if (params.startMemoryId) {
            // Find hot paths starting with this memory
            const paths = await this.hotPathManager.findMatchingHotPaths(params.startMemoryId);
            hotPath = paths[0] ?? null;
        }
        if (!hotPath) {
            // List available hot paths
            const paths = await this.hotPathManager.listHotPaths({ limit: 10 });
            const names = paths.map(p => p.pathName || `path-${p.id}`).join(', ');
            return {
                memories: [],
                message: `Hot path not found. Available paths: ${names || 'none - use the system to build access patterns'}`
            };
        }
        // Get memories in the hot path
        const memories = await this.hotPathManager.getHotPathMemories(hotPath.id);
        return {
            memories,
            hotPath,
            stats: params.includeStats ? {
                totalInRegion: hotPath.memoryCount,
                searchDurationMs: Date.now() - startTime
            } : undefined,
            message: `Hot path "${hotPath.pathName}" (heat: ${hotPath.heatScore.toFixed(2)}, accesses: ${hotPath.accessCount})`
        };
    }
    async predictNext(params, startTime) {
        if (!params.currentMemoryId) {
            return {
                memories: [],
                message: 'currentMemoryId required for prediction'
            };
        }
        // Get predictions with details
        const predictions = await this.hotPathManager.predictNextWithDetails(params.currentMemoryId, params.limit ?? 5);
        if (predictions.length === 0) {
            return {
                memories: [],
                predictions: [],
                message: 'No predictions available - not enough access history'
            };
        }
        const memories = predictions
            .filter(p => p.memory)
            .map(p => p.memory);
        return {
            memories,
            predictions: predictions.map(p => ({
                memoryId: p.memoryId,
                probability: p.probability,
                memory: p.memory
            })),
            stats: params.includeStats ? {
                searchDurationMs: Date.now() - startTime
            } : undefined,
            message: `Predicted ${predictions.length} likely next memories based on access patterns`
        };
    }
    // ===========================================================================
    // HELPERS
    // ===========================================================================
    rowToMemory(row) {
        return {
            id: row.id,
            content: row.content,
            memoryType: row.memory_type,
            importance: row.importance,
            tags: row.tags ?? [],
            metadata: row.metadata ?? {},
            embedding: row.embedding ? this.parseEmbedding(row.embedding) : undefined,
            imageData: row.image_data?.toString('base64'),
            imageMimeType: row.image_mime_type ?? undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            accessCount: row.access_count,
            lastAccessedAt: row.last_accessed_at ?? undefined,
            expiresAt: row.expires_at ?? undefined,
            consolidatedFrom: row.consolidated_from ?? undefined
        };
    }
    parseEmbedding(embeddingStr) {
        const cleaned = embeddingStr.replace(/[\[\]]/g, '');
        return cleaned.split(',').map(Number);
    }
}
export class SpatialManage {
    name = 'spatial_manage';
    description = `Manage spatial memory organization.
Actions:
- init_quadrants: Initialize default semantic quadrants
- run_clustering: Run automatic clustering on unassigned memories
- list_quadrants: List all quadrants
- list_clusters: List all clusters
- assign_memory: Assign a memory to a quadrant/cluster
- get_stats: Get spatial organization statistics
- decay_heat: Decay hot path heat scores
- label_clusters: Auto-generate labels for clusters`;
    inputSchema = {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['init_quadrants', 'run_clustering', 'list_quadrants', 'list_clusters',
                    'assign_memory', 'get_stats', 'decay_heat', 'label_clusters'],
                description: 'Management action to perform'
            },
            memoryId: {
                type: 'string',
                format: 'uuid',
                description: 'Memory ID for assignment'
            },
            quadrantId: {
                type: 'number',
                description: 'Quadrant ID for assignment'
            },
            clusterId: {
                type: 'number',
                description: 'Cluster ID for assignment'
            },
            numClusters: {
                type: 'number',
                default: 10,
                description: 'Number of clusters for clustering'
            },
            minClusterSize: {
                type: 'number',
                default: 5,
                description: 'Minimum cluster size'
            },
            limit: {
                type: 'number',
                default: 50,
                description: 'Limit for list operations'
            }
        },
        required: ['action']
    };
    db;
    spatialEngine;
    hotPathManager;
    constructor(db) {
        this.db = db;
    }
    ensureEngines() {
        if (!this.spatialEngine) {
            this.spatialEngine = getSpatialEngine(this.db.pool);
        }
        if (!this.hotPathManager) {
            this.hotPathManager = getHotPathManager(this.db.pool);
        }
    }
    async execute(params) {
        this.ensureEngines();
        try {
            switch (params.action) {
                case 'init_quadrants': {
                    const quadrants = await this.spatialEngine.initializeDefaultQuadrants();
                    return {
                        success: true,
                        message: `Initialized ${quadrants.length} quadrants`,
                        data: { quadrants }
                    };
                }
                case 'run_clustering': {
                    const created = await this.spatialEngine.runSimpleClustering({
                        numClusters: params.numClusters ?? 10,
                        minClusterSize: params.minClusterSize ?? 5
                    });
                    return {
                        success: true,
                        message: `Created ${created} clusters`,
                        data: { clustersCreated: created }
                    };
                }
                case 'list_quadrants': {
                    const quadrants = await this.spatialEngine.listQuadrants();
                    return {
                        success: true,
                        message: `Found ${quadrants.length} quadrants`,
                        data: { quadrants }
                    };
                }
                case 'list_clusters': {
                    const clusters = await this.spatialEngine.listClusters({
                        minMemoryCount: 1
                    });
                    return {
                        success: true,
                        message: `Found ${clusters.length} clusters with memories`,
                        data: {
                            clusters: clusters.slice(0, params.limit ?? 50)
                        }
                    };
                }
                case 'assign_memory': {
                    if (!params.memoryId) {
                        return { success: false, message: 'memoryId required' };
                    }
                    // Get memory embedding
                    const result = await this.db.query('SELECT embedding FROM memories WHERE id = $1', [params.memoryId]);
                    if (result.rows.length === 0) {
                        return { success: false, message: 'Memory not found' };
                    }
                    const embedding = result.rows[0].embedding;
                    if (params.quadrantId !== undefined) {
                        await this.spatialEngine.assignToQuadrant(params.memoryId, params.quadrantId);
                        return { success: true, message: `Assigned to quadrant ${params.quadrantId}` };
                    }
                    if (params.clusterId !== undefined) {
                        await this.spatialEngine.assignToCluster(params.memoryId, params.clusterId);
                        return { success: true, message: `Assigned to cluster ${params.clusterId}` };
                    }
                    // Auto-assign
                    if (embedding) {
                        const embeddingArray = this.parseEmbedding(embedding);
                        const quadrant = await this.spatialEngine.autoAssignToQuadrant(params.memoryId, embeddingArray);
                        const cluster = await this.spatialEngine.autoAssignToCluster(params.memoryId, embeddingArray);
                        return {
                            success: true,
                            message: `Auto-assigned to quadrant "${quadrant?.name}" and cluster "${cluster?.name}"`,
                            data: { quadrant, cluster }
                        };
                    }
                    return { success: false, message: 'Memory has no embedding for auto-assignment' };
                }
                case 'get_stats': {
                    const spatialStats = await this.spatialEngine.getStats();
                    const hotPathStats = await this.hotPathManager.getHotPathStats();
                    const transitionStats = await this.hotPathManager.getTransitionStats();
                    return {
                        success: true,
                        message: 'Spatial memory statistics',
                        data: {
                            spatial: spatialStats,
                            hotPaths: hotPathStats,
                            transitions: transitionStats
                        }
                    };
                }
                case 'decay_heat': {
                    const decayed = await this.hotPathManager.decayHeatScores();
                    return {
                        success: true,
                        message: `Decayed heat scores for ${decayed} hot paths`
                    };
                }
                case 'label_clusters': {
                    const clusters = await this.spatialEngine.listClusters();
                    let labeled = 0;
                    for (const cluster of clusters) {
                        if (!cluster.name || cluster.name.startsWith('auto-cluster-')) {
                            await this.spatialEngine.autoLabelCluster(cluster.id);
                            labeled++;
                        }
                    }
                    return {
                        success: true,
                        message: `Auto-labeled ${labeled} clusters`
                    };
                }
                default:
                    return { success: false, message: `Unknown action: ${params.action}` };
            }
        }
        catch (error) {
            logger.error({ error, params }, 'spatial manage failed');
            return {
                success: false,
                message: `Failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    parseEmbedding(embeddingStr) {
        const cleaned = embeddingStr.replace(/[\[\]]/g, '');
        return cleaned.split(',').map(Number);
    }
}
//# sourceMappingURL=spatialSearch.js.map