/**
 * spatialMemory.ts - SPATIAL MEMORY ENGINE
 *
 * Makes 's memory ACTUALLY INTELLIGENT through spatial organization.
 * This is where memories become self-organizing semantic neighborhoods.
 *
 * Features:
 * - Quadrant-based memory organization (like spatial indexes)
 * - Automatic clustering of related memories
 * - Region-based searching (find all memories in a semantic region)
 * - Cluster auto-labeling from content themes
 * - Self-balancing when quadrants get too full
 *
 * The goal:  should think about memories like physical locations,
 * where related concepts are "near" each other in semantic space.
 */
import { logger } from '../utils/logger.js';
import { getDimensionService } from '../services/DimensionService.js';
import { getCurrentProjectPath } from '../services/ProjectContext.js';
// =============================================================================
// SPATIAL MEMORY ENGINE
// =============================================================================
export class SpatialMemoryEngine {
    pool;
    dimensionService = null;
    cachedDimension = null;
    constructor(pool) {
        this.pool = pool;
        try {
            this.dimensionService = getDimensionService(pool);
        }
        catch {
            // Will initialize when needed
        }
    }
    /**
     * Get DimensionService (lazy initialization)
     */
    getDimService() {
        if (!this.dimensionService) {
            this.dimensionService = getDimensionService(this.pool);
        }
        return this.dimensionService;
    }
    /**
     * Get the embedding dimension from database
     */
    async getEmbeddingDimension() {
        if (this.cachedDimension)
            return this.cachedDimension;
        try {
            const dimService = this.getDimService();
            const dim = await dimService.getTableDimension('memories');
            if (dim) {
                this.cachedDimension = dim;
                return dim;
            }
        }
        catch {
            // Fall through to default
        }
        return 384; // Fallback
    }
    /**
     * Validate and scale an embedding to match expected dimension
     */
    async prepareEmbedding(embedding) {
        const expectedDim = await this.getEmbeddingDimension();
        if (embedding.length === expectedDim)
            return embedding;
        // Scale to match
        const dimService = this.getDimService();
        return dimService.scaleEmbedding(embedding, expectedDim);
    }
    // ===========================================================================
    // QUADRANT OPERATIONS
    // ===========================================================================
    /**
     * Create a new semantic quadrant
     */
    async createQuadrant(opts) {
        const start = Date.now();
        // Calculate depth based on parent
        let depth = 0;
        if (opts.parentQuadrantId) {
            const parent = await this.getQuadrant(opts.parentQuadrantId);
            if (parent) {
                depth = parent.depth + 1;
            }
        }
        const centroidStr = opts.centroid ? `[${opts.centroid.join(',')}]` : null;
        const result = await this.pool.queryWithSwag(`INSERT INTO semantic_quadrants (
        name, description, quadrant_code, centroid,
        min_x, max_x, min_y, max_y,
        parent_quadrant_id, depth, tags, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`, [
            opts.name,
            opts.description ?? null,
            opts.quadrantCode,
            centroidStr,
            opts.bounds?.minX ?? null,
            opts.bounds?.maxX ?? null,
            opts.bounds?.minY ?? null,
            opts.bounds?.maxY ?? null,
            opts.parentQuadrantId ?? null,
            depth,
            opts.tags ?? [],
            opts.metadata ?? {}
        ]);
        const duration = Date.now() - start;
        logger.debug({ quadrantCode: opts.quadrantCode, duration }, 'quadrant created');
        return this.rowToQuadrant(result.rows[0]);
    }
    /**
     * Get quadrant by ID
     */
    async getQuadrant(id) {
        const result = await this.pool.queryWithSwag('SELECT * FROM semantic_quadrants WHERE id = $1', [id]);
        return result.rows[0] ? this.rowToQuadrant(result.rows[0]) : null;
    }
    /**
     * Get quadrant by code
     */
    async getQuadrantByCode(code) {
        const result = await this.pool.queryWithSwag('SELECT * FROM semantic_quadrants WHERE quadrant_code = $1', [code]);
        return result.rows[0] ? this.rowToQuadrant(result.rows[0]) : null;
    }
    /**
     * List all quadrants with optional filtering
     */
    async listQuadrants(opts) {
        const conditions = [];
        const values = [];
        let paramIndex = 1;
        if (opts?.parentId !== undefined) {
            conditions.push(`parent_quadrant_id = $${paramIndex}`);
            values.push(opts.parentId);
            paramIndex++;
        }
        if (opts?.depth !== undefined) {
            conditions.push(`depth = $${paramIndex}`);
            values.push(opts.depth);
            paramIndex++;
        }
        if (opts?.minMemoryCount !== undefined) {
            conditions.push(`memory_count >= $${paramIndex}`);
            values.push(opts.minMemoryCount);
            paramIndex++;
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await this.pool.queryWithSwag(`SELECT * FROM semantic_quadrants ${whereClause} ORDER BY depth, quadrant_code`, values);
        return result.rows.map((row) => this.rowToQuadrant(row));
    }
    /**
     * Assign a memory to a quadrant
     */
    async assignToQuadrant(memoryId, quadrantId, opts) {
        await this.pool.queryWithSwag(`INSERT INTO memory_quadrant_assignments (
        memory_id, quadrant_id, pos_x, pos_y, distance_from_centroid, assignment_method
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (memory_id, quadrant_id) DO UPDATE SET
        pos_x = EXCLUDED.pos_x,
        pos_y = EXCLUDED.pos_y,
        distance_from_centroid = EXCLUDED.distance_from_centroid,
        assigned_at = NOW()`, [
            memoryId,
            quadrantId,
            opts?.posX ?? null,
            opts?.posY ?? null,
            opts?.distanceFromCentroid ?? null,
            opts?.method ?? 'auto'
        ]);
    }
    /**
     * Get memories in a specific quadrant
     */
    async getMemoriesInQuadrant(quadrantId, limit = 100) {
        const result = await this.pool.queryWithSwag(`SELECT
        m.id, m.content, m.memory_type, m.importance, m.tags, m.metadata,
        m.embedding, m.created_at, m.updated_at, m.access_count,
        m.last_accessed_at, m.expires_at, m.consolidated_from,
        m.image_data, m.image_mime_type,
        mqa.pos_x, mqa.pos_y, mqa.distance_from_centroid
      FROM memories m
      JOIN memory_quadrant_assignments mqa ON m.id = mqa.memory_id
      WHERE mqa.quadrant_id = $1
      ORDER BY mqa.distance_from_centroid ASC NULLS LAST
      LIMIT $2`, [quadrantId, limit]);
        return result.rows.map((row) => ({
            memory: this.rowToMemory(row),
            position: { x: row.pos_x, y: row.pos_y }
        }));
    }
    /**
     * Find the best quadrant for a memory based on its embedding
     */
    async findBestQuadrant(embedding) {
        const embeddingStr = `[${embedding.join(',')}]`;
        // Find quadrant with closest centroid
        const result = await this.pool.queryWithSwag(`SELECT *, 1 - (centroid <=> $1::vector) as similarity
       FROM semantic_quadrants
       WHERE centroid IS NOT NULL
       ORDER BY centroid <=> $1::vector
       LIMIT 1`, [embeddingStr]);
        if (result.rows.length === 0)
            return null;
        return this.rowToQuadrant(result.rows[0]);
    }
    /**
     * Auto-assign a memory to the best quadrant
     */
    async autoAssignToQuadrant(memoryId, embedding) {
        const quadrant = await this.findBestQuadrant(embedding);
        if (!quadrant)
            return null;
        // Calculate distance from centroid
        if (quadrant.centroid) {
            const distance = this.cosineSimilarity(embedding, quadrant.centroid);
            await this.assignToQuadrant(memoryId, quadrant.id, {
                distanceFromCentroid: 1 - distance,
                method: 'auto'
            });
        }
        else {
            await this.assignToQuadrant(memoryId, quadrant.id, { method: 'auto' });
        }
        return quadrant;
    }
    /**
     * Check if quadrant needs splitting (over capacity)
     */
    async checkQuadrantCapacity(quadrantId) {
        const quadrant = await this.getQuadrant(quadrantId);
        if (!quadrant) {
            return { needsSplit: false, currentCount: 0, maxCapacity: 0 };
        }
        return {
            needsSplit: quadrant.memoryCount > quadrant.maxCapacity,
            currentCount: quadrant.memoryCount,
            maxCapacity: quadrant.maxCapacity
        };
    }
    // ===========================================================================
    // CLUSTER OPERATIONS
    // ===========================================================================
    /**
     * Create a new memory cluster
     */
    async createCluster(opts) {
        // Calculate depth based on parent
        let depth = 0;
        if (opts.parentClusterId) {
            const parent = await this.getCluster(opts.parentClusterId);
            if (parent) {
                depth = parent.depth + 1;
            }
        }
        const centroidStr = opts.centroid ? `[${opts.centroid.join(',')}]` : null;
        const result = await this.pool.queryWithSwag(`INSERT INTO memory_clusters (
        name, description, cluster_type, centroid,
        top_tags, top_terms, parent_cluster_id, depth, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`, [
            opts.name ?? null,
            opts.description ?? null,
            opts.clusterType ?? 'semantic',
            centroidStr,
            opts.topTags ?? [],
            opts.topTerms ?? [],
            opts.parentClusterId ?? null,
            depth,
            opts.metadata ?? {}
        ]);
        logger.debug({ clusterId: result.rows[0].id }, 'cluster created');
        return this.rowToCluster(result.rows[0]);
    }
    /**
     * Get cluster by ID
     */
    async getCluster(id) {
        const result = await this.pool.queryWithSwag('SELECT * FROM memory_clusters WHERE id = $1', [id]);
        return result.rows[0] ? this.rowToCluster(result.rows[0]) : null;
    }
    /**
     * List clusters with optional filtering
     */
    async listClusters(opts) {
        const conditions = [];
        const values = [];
        let paramIndex = 1;
        if (opts?.clusterType) {
            conditions.push(`cluster_type = $${paramIndex}`);
            values.push(opts.clusterType);
            paramIndex++;
        }
        if (opts?.parentId !== undefined) {
            conditions.push(`parent_cluster_id = $${paramIndex}`);
            values.push(opts.parentId);
            paramIndex++;
        }
        if (opts?.minMemoryCount !== undefined) {
            conditions.push(`memory_count >= $${paramIndex}`);
            values.push(opts.minMemoryCount);
            paramIndex++;
        }
        if (opts?.minCoherence !== undefined) {
            conditions.push(`coherence_score >= $${paramIndex}`);
            values.push(opts.minCoherence);
            paramIndex++;
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await this.pool.queryWithSwag(`SELECT * FROM memory_clusters ${whereClause}
       ORDER BY memory_count DESC, coherence_score DESC NULLS LAST`, values);
        return result.rows.map((row) => this.rowToCluster(row));
    }
    /**
     * Assign a memory to a cluster
     */
    async assignToCluster(memoryId, clusterId, opts) {
        await this.pool.queryWithSwag(`INSERT INTO memory_cluster_assignments (
        memory_id, cluster_id, membership_score, distance_to_centroid, assignment_method
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (memory_id, cluster_id) DO UPDATE SET
        membership_score = EXCLUDED.membership_score,
        distance_to_centroid = EXCLUDED.distance_to_centroid,
        assigned_at = NOW()`, [
            memoryId,
            clusterId,
            opts?.membershipScore ?? 1.0,
            opts?.distanceToCentroid ?? null,
            opts?.method ?? 'auto'
        ]);
    }
    /**
     * Get memories in a cluster
     */
    async getMemoriesInCluster(clusterId, limit = 100) {
        const result = await this.pool.queryWithSwag(`SELECT
        m.id, m.content, m.memory_type, m.importance, m.tags, m.metadata,
        m.embedding, m.created_at, m.updated_at, m.access_count,
        m.last_accessed_at, m.expires_at, m.consolidated_from,
        m.image_data, m.image_mime_type,
        mca.membership_score
      FROM memories m
      JOIN memory_cluster_assignments mca ON m.id = mca.memory_id
      WHERE mca.cluster_id = $1
      ORDER BY mca.membership_score DESC
      LIMIT $2`, [clusterId, limit]);
        return result.rows.map((row) => ({
            memory: this.rowToMemory(row),
            membershipScore: row.membership_score
        }));
    }
    /**
     * Find the best cluster for a memory based on its embedding
     */
    async findBestCluster(embedding) {
        const embeddingStr = `[${embedding.join(',')}]`;
        const result = await this.pool.queryWithSwag(`SELECT *, 1 - (centroid <=> $1::vector) as similarity
       FROM memory_clusters
       WHERE centroid IS NOT NULL
       ORDER BY centroid <=> $1::vector
       LIMIT 1`, [embeddingStr]);
        if (result.rows.length === 0)
            return null;
        return this.rowToCluster(result.rows[0]);
    }
    /**
     * Auto-assign a memory to the best cluster
     */
    async autoAssignToCluster(memoryId, embedding) {
        const cluster = await this.findBestCluster(embedding);
        if (!cluster)
            return null;
        // Calculate membership score based on similarity to centroid
        let membershipScore = 1.0;
        if (cluster.centroid) {
            membershipScore = this.cosineSimilarity(embedding, cluster.centroid);
        }
        await this.assignToCluster(memoryId, cluster.id, {
            membershipScore,
            method: 'auto'
        });
        return cluster;
    }
    /**
     * Update cluster centroid based on current members
     */
    async updateClusterCentroid(clusterId) {
        // Get all embeddings in cluster
        const result = await this.pool.queryWithSwag(`SELECT m.embedding
       FROM memories m
       JOIN memory_cluster_assignments mca ON m.id = mca.memory_id
       WHERE mca.cluster_id = $1 AND m.embedding IS NOT NULL`, [clusterId]);
        if (result.rows.length === 0)
            return;
        // Calculate mean embedding
        const embeddings = result.rows.map((r) => this.parseEmbedding(r.embedding));
        const centroid = this.calculateCentroid(embeddings);
        const centroidStr = `[${centroid.join(',')}]`;
        await this.pool.queryWithSwag(`UPDATE memory_clusters
       SET centroid = $1, last_updated_at = NOW()
       WHERE id = $2`, [centroidStr, clusterId]);
    }
    /**
     * Auto-label a cluster based on its contents
     */
    async autoLabelCluster(clusterId) {
        // Get top tags from cluster members
        const tagResult = await this.pool.queryWithSwag(`SELECT unnest(m.tags) as tag, COUNT(*) as cnt
       FROM memories m
       JOIN memory_cluster_assignments mca ON m.id = mca.memory_id
       WHERE mca.cluster_id = $1
       GROUP BY tag
       ORDER BY cnt DESC
       LIMIT 5`, [clusterId]);
        const topTags = tagResult.rows.map((r) => r.tag);
        // Generate name from top tags
        const name = topTags.length > 0
            ? topTags.slice(0, 3).join('-')
            : `cluster-${clusterId}`;
        // Update cluster
        await this.pool.queryWithSwag(`UPDATE memory_clusters
       SET name = $1, top_tags = $2, last_updated_at = NOW()
       WHERE id = $3`, [name, topTags, clusterId]);
        return { name, topTags };
    }
    // ===========================================================================
    // SPATIAL SEARCH
    // ===========================================================================
    /**
     * Search memories within a spatial region
     */
    async searchSpatial(opts) {
        const conditions = [];
        const values = [];
        let paramIndex = 1;
        // Build join based on search type
        let joinClause = '';
        if (opts.quadrantCode || opts.quadrantId !== undefined) {
            joinClause = 'JOIN memory_quadrant_assignments mqa ON m.id = mqa.memory_id';
            if (opts.quadrantCode) {
                joinClause += ' JOIN semantic_quadrants sq ON mqa.quadrant_id = sq.id';
                conditions.push(`sq.quadrant_code = $${paramIndex}`);
                values.push(opts.quadrantCode);
                paramIndex++;
            }
            else if (opts.quadrantId !== undefined) {
                conditions.push(`mqa.quadrant_id = $${paramIndex}`);
                values.push(opts.quadrantId);
                paramIndex++;
            }
        }
        if (opts.clusterId !== undefined || opts.clusterName) {
            if (!joinClause) {
                joinClause = 'JOIN memory_cluster_assignments mca ON m.id = mca.memory_id';
            }
            else {
                joinClause += ' JOIN memory_cluster_assignments mca ON m.id = mca.memory_id';
            }
            if (opts.clusterName) {
                joinClause += ' JOIN memory_clusters mc ON mca.cluster_id = mc.id';
                conditions.push(`mc.name ILIKE $${paramIndex}`);
                values.push(`%${opts.clusterName}%`);
                paramIndex++;
            }
            else if (opts.clusterId !== undefined) {
                conditions.push(`mca.cluster_id = $${paramIndex}`);
                values.push(opts.clusterId);
                paramIndex++;
            }
        }
        if (opts.withinBounds) {
            joinClause = joinClause || 'JOIN memory_quadrant_assignments mqa ON m.id = mqa.memory_id';
            conditions.push(`mqa.pos_x BETWEEN $${paramIndex} AND $${paramIndex + 1}`);
            values.push(opts.withinBounds.minX, opts.withinBounds.maxX);
            paramIndex += 2;
            conditions.push(`mqa.pos_y BETWEEN $${paramIndex} AND $${paramIndex + 1}`);
            values.push(opts.withinBounds.minY, opts.withinBounds.maxY);
            paramIndex += 2;
        }
        // Always exclude expired
        conditions.push('(m.expires_at IS NULL OR m.expires_at > NOW())');
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = opts.limit ?? 50;
        values.push(limit);
        const query = `
      SELECT DISTINCT
        m.id, m.content, m.memory_type, m.importance, m.tags, m.metadata,
        m.embedding, m.created_at, m.updated_at, m.access_count,
        m.last_accessed_at, m.expires_at, m.consolidated_from,
        m.image_data, m.image_mime_type
      FROM memories m
      ${joinClause}
      ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT $${paramIndex}
    `;
        const result = await this.pool.queryWithSwag(query, values);
        return result.rows.map((row) => this.rowToMemory(row));
    }
    /**
     * Find neighboring quadrants/clusters
     */
    async findNeighboringQuadrants(quadrantId, limit = 5) {
        const quadrant = await this.getQuadrant(quadrantId);
        if (!quadrant || !quadrant.centroid)
            return [];
        const centroidStr = `[${quadrant.centroid.join(',')}]`;
        const result = await this.pool.queryWithSwag(`SELECT *, 1 - (centroid <=> $1::vector) as similarity
       FROM semantic_quadrants
       WHERE id != $2 AND centroid IS NOT NULL
       ORDER BY centroid <=> $1::vector
       LIMIT $3`, [centroidStr, quadrantId, limit]);
        return result.rows.map((row) => this.rowToQuadrant(row));
    }
    /**
     * Find related clusters based on shared memories
     */
    async findRelatedClusters(clusterId, limit = 5) {
        const result = await this.pool.queryWithSwag(`SELECT mc.*, COUNT(mca2.memory_id) as shared_count
       FROM memory_clusters mc
       JOIN memory_cluster_assignments mca2 ON mc.id = mca2.cluster_id
       WHERE mca2.memory_id IN (
         SELECT memory_id FROM memory_cluster_assignments WHERE cluster_id = $1
       )
       AND mc.id != $1
       GROUP BY mc.id
       ORDER BY shared_count DESC
       LIMIT $2`, [clusterId, limit]);
        return result.rows.map((row) => ({
            cluster: this.rowToCluster(row),
            sharedCount: parseInt(row.shared_count, 10)
        }));
    }
    // ===========================================================================
    // BULK OPERATIONS FOR INITIAL ORGANIZATION
    // ===========================================================================
    /**
     * Initialize default quadrants (4 quadrants based on content themes)
     */
    async initializeDefaultQuadrants() {
        const defaultQuadrants = [
            { name: 'Technical', code: 'Q1-TECH', description: 'Code, architecture, technical decisions' },
            { name: 'Conceptual', code: 'Q2-CONCEPT', description: 'Ideas, concepts, abstract knowledge' },
            { name: 'Procedural', code: 'Q3-PROC', description: 'How-to, processes, workflows' },
            { name: 'Contextual', code: 'Q4-CONTEXT', description: 'Conversations, sessions, context' }
        ];
        const created = [];
        for (const q of defaultQuadrants) {
            const existing = await this.getQuadrantByCode(q.code);
            if (!existing) {
                const quadrant = await this.createQuadrant({
                    name: q.name,
                    quadrantCode: q.code,
                    description: q.description
                });
                created.push(quadrant);
            }
        }
        logger.info({ count: created.length }, 'initialized default quadrants');
        return created;
    }
    /**
     * Bulk assign memories to quadrants based on embeddings
     */
    async bulkAssignToQuadrants(limit = 1000) {
        // Get unassigned memories with embeddings
        const result = await this.pool.queryWithSwag(`SELECT m.id, m.embedding
       FROM memories m
       WHERE m.embedding IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM memory_quadrant_assignments mqa WHERE mqa.memory_id = m.id
       )
       LIMIT $1`, [limit]);
        let assigned = 0;
        for (const row of result.rows) {
            const embedding = this.parseEmbedding(row.embedding);
            const quadrant = await this.autoAssignToQuadrant(row.id, embedding);
            if (quadrant)
                assigned++;
        }
        logger.info({ assigned, total: result.rows.length }, 'bulk quadrant assignment complete');
        return assigned;
    }
    /**
     * Run simple k-means-style clustering on unassigned memories
     */
    async runSimpleClustering(opts = {}) {
        const numClusters = opts.numClusters ?? 10;
        const minClusterSize = opts.minClusterSize ?? 5;
        // Get memories with embeddings that aren't in any cluster
        const result = await this.pool.queryWithSwag(`SELECT m.id, m.embedding, m.tags
       FROM memories m
       WHERE m.embedding IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM memory_cluster_assignments mca WHERE mca.memory_id = m.id
       )
       LIMIT 1000`);
        if (result.rows.length < minClusterSize) {
            logger.info('not enough unassigned memories for clustering');
            return 0;
        }
        // Simple k-means initialization: pick k random memories as initial centroids
        const memories = result.rows.map((r) => ({
            id: r.id,
            embedding: this.parseEmbedding(r.embedding),
            tags: r.tags
        }));
        // Random initial centroids
        const shuffled = [...memories].sort(() => Math.random() - 0.5);
        const initialCentroids = shuffled.slice(0, numClusters).map(m => m.embedding);
        // Assign memories to nearest centroid
        const assignments = new Map();
        for (let i = 0; i < numClusters; i++) {
            assignments.set(i, []);
        }
        for (const mem of memories) {
            let bestCluster = 0;
            let bestSimilarity = -1;
            for (let i = 0; i < initialCentroids.length; i++) {
                const sim = this.cosineSimilarity(mem.embedding, initialCentroids[i]);
                if (sim > bestSimilarity) {
                    bestSimilarity = sim;
                    bestCluster = i;
                }
            }
            assignments.get(bestCluster).push(mem);
        }
        // Create clusters and assign memories
        let clustersCreated = 0;
        for (const [idx, members] of assignments.entries()) {
            if (members.length < minClusterSize)
                continue;
            // Calculate centroid
            const centroid = this.calculateCentroid(members.map(m => m.embedding));
            // Get top tags
            const tagCounts = new Map();
            for (const mem of members) {
                for (const tag of mem.tags) {
                    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
                }
            }
            const topTags = [...tagCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([tag]) => tag);
            // Create cluster
            const cluster = await this.createCluster({
                name: topTags.length > 0 ? topTags.slice(0, 3).join('-') : `auto-cluster-${idx}`,
                clusterType: 'semantic',
                centroid,
                topTags
            });
            // Assign members
            for (const mem of members) {
                const similarity = this.cosineSimilarity(mem.embedding, centroid);
                await this.assignToCluster(mem.id, cluster.id, {
                    membershipScore: similarity,
                    method: 'kmeans'
                });
            }
            clustersCreated++;
        }
        logger.info({ clustersCreated, memoriesProcessed: memories.length }, 'simple clustering complete');
        return clustersCreated;
    }
    // ===========================================================================
    // STATS
    // ===========================================================================
    /**
     * Get spatial memory statistics
     */
    async getStats() {
        const result = await this.pool.queryWithSwag(`
      SELECT
        (SELECT COUNT(*) FROM semantic_quadrants) as total_quadrants,
        (SELECT COUNT(*) FROM memory_clusters) as total_clusters,
        (SELECT COUNT(DISTINCT memory_id) FROM memory_quadrant_assignments) as assigned_quadrant,
        (SELECT COUNT(DISTINCT memory_id) FROM memory_cluster_assignments) as assigned_cluster,
        (SELECT COALESCE(AVG(memory_count), 0) FROM semantic_quadrants) as avg_quadrant,
        (SELECT COALESCE(AVG(memory_count), 0) FROM memory_clusters) as avg_cluster
    `);
        const row = result.rows[0];
        return {
            totalQuadrants: parseInt(row.total_quadrants, 10),
            totalClusters: parseInt(row.total_clusters, 10),
            assignedToQuadrant: parseInt(row.assigned_quadrant, 10),
            assignedToCluster: parseInt(row.assigned_cluster, 10),
            avgMemoriesPerQuadrant: parseFloat(row.avg_quadrant),
            avgMemoriesPerCluster: parseFloat(row.avg_cluster)
        };
    }
    // ===========================================================================
    // HELPERS
    // ===========================================================================
    rowToQuadrant(row) {
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            quadrantCode: row.quadrant_code,
            centroid: row.centroid ? this.parseEmbedding(row.centroid) : null,
            bounds: {
                minX: row.min_x,
                maxX: row.max_x,
                minY: row.min_y,
                maxY: row.max_y
            },
            parentQuadrantId: row.parent_quadrant_id,
            depth: row.depth,
            memoryCount: row.memory_count,
            maxCapacity: row.max_capacity,
            avgSimilarity: row.avg_similarity,
            tags: row.tags ?? [],
            metadata: row.metadata ?? {},
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    rowToCluster(row) {
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            clusterType: row.cluster_type,
            centroid: row.centroid ? this.parseEmbedding(row.centroid) : null,
            memoryCount: row.memory_count,
            coherenceScore: row.coherence_score,
            silhouetteScore: row.silhouette_score,
            topTags: row.top_tags ?? [],
            topTerms: row.top_terms ?? [],
            parentClusterId: row.parent_cluster_id,
            depth: row.depth,
            isStable: row.is_stable,
            metadata: row.metadata ?? {},
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
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
    cosineSimilarity(a, b) {
        if (a.length !== b.length)
            return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom === 0 ? 0 : dotProduct / denom;
    }
    calculateCentroid(embeddings) {
        if (embeddings.length === 0)
            return [];
        const dims = embeddings[0].length;
        const centroid = new Array(dims).fill(0);
        for (const emb of embeddings) {
            for (let i = 0; i < dims; i++) {
                centroid[i] += emb[i];
            }
        }
        for (let i = 0; i < dims; i++) {
            centroid[i] /= embeddings.length;
        }
        return centroid;
    }
}
// Per-project instance management (Map pattern for project isolation)
// SCHEMA ISOLATION FIX: Previous global singleton caused cross-project pollution
const spatialEnginesByProject = new Map();
export function getSpatialEngine(pool, projectPath) {
    const targetProject = projectPath || getCurrentProjectPath();
    if (!spatialEnginesByProject.has(targetProject) && !pool) {
        throw new Error('spatial engine not initialized for project ' + targetProject + ' - pass pool first');
    }
    if (!spatialEnginesByProject.has(targetProject) && pool) {
        spatialEnginesByProject.set(targetProject, new SpatialMemoryEngine(pool));
        logger.debug({ projectPath: targetProject }, 'created new SpatialMemoryEngine for project');
    }
    return spatialEnginesByProject.get(targetProject);
}
export function resetSpatialEngine(projectPath) {
    if (projectPath) {
        spatialEnginesByProject.delete(projectPath);
    }
    else {
        // Reset all if no project specified (for testing)
        spatialEnginesByProject.clear();
    }
}
//# sourceMappingURL=spatialMemory.js.map