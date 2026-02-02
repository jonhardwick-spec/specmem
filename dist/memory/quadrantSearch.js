/**
 * quadrantSearch.ts - SPATIAL/SEMANTIC QUADRANT PARTITIONING
 *
 * Large codebases and memory stores become unwieldy with flat search.
 * This module implements quadrant-based partitioning for:
 *
 * 1. SPATIAL QUADRANTS - Group memories by "semantic space"
 *    - Each quadrant represents a conceptual domain
 *    - Queries first identify relevant quadrants, then search within
 *
 * 2. HIERARCHICAL INDEXING - Multi-level organization
 *    - L0: Global index (all quadrants)
 *    - L1: Domain quadrants (code, docs, conversations, etc.)
 *    - L2: Sub-domain quadrants (by language, project, topic)
 *    - L3: Leaf clusters (fine-grained groups)
 *
 * 3. ADAPTIVE PARTITIONING - Quadrants split/merge based on:
 *    - Memory count (too many = split)
 *    - Semantic dispersion (too varied = split)
 *    - Access patterns (rarely accessed quadrants merge)
 *
 * This dramatically speeds up search for large memory stores by
 * reducing the search space before expensive vector comparisons.
 */
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { getDimensionService } from '../services/DimensionService.js';
/**
 * QuadrantSearchSystem - Hierarchical Semantic Partitioning
 *
 * The core idea: Instead of searching ALL memories, first find
 * relevant quadrants, then search within those quadrants only.
 *
 * For a 1M memory store:
 * - Flat search: Compare query to all 1M embeddings
 * - Quadrant search: Compare to ~50 quadrants, then ~1000 memories
 *
 * This provides 100-1000x speedup for large stores.
 */
export class QuadrantSearchSystem {
    db;
    embeddingProvider;
    dimensionService = null;
    // In-memory quadrant cache for fast lookups
    quadrantCache = new Map();
    rootQuadrantId = null;
    // Dynamic dimension - detected from DB or embedding provider
    detectedDimension = null;
    // Configuration
    config = {
        maxMemoriesPerQuadrant: 1000,
        minMemoriesPerQuadrant: 50,
        maxRadiusForSplit: 0.5, // Cosine distance threshold
        defaultSearchQuadrants: 5, // How many quadrants to search by default
        centroidUpdateBatchSize: 100, // Batch size for centroid updates
        cacheTimeout: 5 * 60 * 1000 // 5 minutes
    };
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
        // Initialize dimension service lazily
        try {
            this.dimensionService = getDimensionService(db, embeddingProvider);
        }
        catch {
            // Will be initialized later when needed
        }
    }
    /**
     * Get the DimensionService (lazy initialization)
     */
    getDimService() {
        if (!this.dimensionService) {
            this.dimensionService = getDimensionService(this.db, this.embeddingProvider);
        }
        return this.dimensionService;
    }
    /**
     * Validate and prepare an embedding for database operations.
     * Uses DimensionService to handle dimension mismatches.
     */
    async prepareEmbedding(embedding, tableName = 'memories', originalText, columnName = 'embedding') {
        const dimService = this.getDimService();
        const prepared = await dimService.validateAndPrepare(tableName, embedding, originalText, columnName);
        if (prepared.wasModified) {
            logger.debug({ action: prepared.action, tableName }, 'Adjusted embedding dimension');
        }
        return prepared.embedding;
    }
    /**
     * Get the current embedding dimension from DB or provider
     * DYNAMIC - no hardcoded values!
     */
    async getDimension() {
        if (this.detectedDimension) {
            return this.detectedDimension;
        }
        // Strategy 1: Query DB for actual dimension
        try {
            const result = await this.db.query(`
        SELECT atttypmod FROM pg_attribute
        WHERE attrelid = 'memories'::regclass AND attname = 'embedding'
      `);
            if (result.rows.length > 0 && result.rows[0].atttypmod > 0) {
                this.detectedDimension = result.rows[0].atttypmod;
                logger.info({ dimension: this.detectedDimension }, 'QuadrantSearch: detected dimension from database');
                return this.detectedDimension;
            }
        }
        catch (err) {
            logger.debug({ error: err }, 'QuadrantSearch: could not query DB for dimension');
        }
        // Strategy 2: Ask embedding provider
        if (this.embeddingProvider.getEmbeddingDimension) {
            try {
                this.detectedDimension = await this.embeddingProvider.getEmbeddingDimension();
                logger.info({ dimension: this.detectedDimension }, 'QuadrantSearch: detected dimension from embedding provider');
                return this.detectedDimension;
            }
            catch (err) {
                logger.debug({ error: err }, 'QuadrantSearch: could not get dimension from provider');
            }
        }
        // Strategy 3: Generate test embedding to detect dimension
        try {
            const testEmbedding = await this.embeddingProvider.generateEmbedding('dimension detection test');
            this.detectedDimension = testEmbedding.length;
            logger.info({ dimension: this.detectedDimension }, 'QuadrantSearch: detected dimension from test embedding');
            return this.detectedDimension;
        }
        catch (err) {
            logger.error({ error: err }, 'QuadrantSearch: failed to detect dimension');
            throw new Error('Cannot determine embedding dimension - required for quadrant operations');
        }
    }
    /**
     * Create a zero vector with the correct dimension
     */
    async createZeroCentroid() {
        const dim = await this.getDimension();
        return new Array(dim).fill(0);
    }
    // ============================================================
    // QUADRANT MANAGEMENT
    // ============================================================
    /**
     * Initialize the quadrant system with root quadrant
     */
    async initialize() {
        // Pre-detect dimension before any operations
        await this.getDimension();
        // Check if root quadrant exists
        const rootQuery = `
      SELECT * FROM memory_quadrants WHERE level = 0 LIMIT 1
    `;
        const result = await this.db.query(rootQuery);
        if (result.rows.length === 0) {
            // Create root quadrant with proper zero centroid
            const zeroCentroid = await this.createZeroCentroid();
            const root = await this.createQuadrant('root', 'Global Memory Space', 0, null, zeroCentroid, ['all']);
            this.rootQuadrantId = root.id;
            logger.info({ quadrantId: root.id, dimension: this.detectedDimension }, 'root quadrant created with dynamic dimension');
        }
        else {
            this.rootQuadrantId = result.rows[0].id;
            // Validate existing quadrant's centroid dimension
            const existingCentroid = this.parseEmbedding(result.rows[0].centroid || '');
            if (existingCentroid.length > 0 && existingCentroid.length !== this.detectedDimension) {
                logger.warn({
                    quadrantId: this.rootQuadrantId,
                    storedDim: existingCentroid.length,
                    expectedDim: this.detectedDimension
                }, 'Root quadrant centroid dimension mismatch - will update on next memory assignment');
            }
        }
        // Load quadrants into cache
        await this.loadQuadrantsIntoCache();
        logger.info({
            rootId: this.rootQuadrantId,
            cachedQuadrants: this.quadrantCache.size,
            dimension: this.detectedDimension
        }, 'quadrant system initialized with dynamic dimension');
    }
    /**
     * Create a new quadrant
     */
    async createQuadrant(name, description, level, parentId, centroid, keywords) {
        const quadrant = {
            id: uuidv4(),
            name,
            level,
            parentId,
            childIds: [],
            centroid,
            radius: 0,
            keywords,
            memoryCount: 0,
            totalAccessCount: 0,
            lastAccessedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
            maxMemories: this.config.maxMemoriesPerQuadrant,
            minMemories: this.config.minMemoriesPerQuadrant,
            maxRadius: this.config.maxRadiusForSplit,
            memoryTypes: [],
            tags: keywords,
            metadata: { description }
        };
        const query = `
      INSERT INTO memory_quadrants (
        id, name, level, parent_id, child_ids,
        centroid, radius, keywords,
        memory_count, total_access_count, last_accessed_at,
        created_at, updated_at,
        max_memories, min_memories, max_radius,
        memory_types, tags, metadata
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11,
        $12, $13,
        $14, $15, $16,
        $17, $18, $19
      )
    `;
        await this.db.query(query, [
            quadrant.id,
            quadrant.name,
            quadrant.level,
            quadrant.parentId,
            quadrant.childIds,
            centroid.length > 0 ? `[${centroid.join(',')}]` : null,
            quadrant.radius,
            quadrant.keywords,
            quadrant.memoryCount,
            quadrant.totalAccessCount,
            quadrant.lastAccessedAt,
            quadrant.createdAt,
            quadrant.updatedAt,
            quadrant.maxMemories,
            quadrant.minMemories,
            quadrant.maxRadius,
            quadrant.memoryTypes,
            quadrant.tags,
            quadrant.metadata
        ]);
        // Update parent's child list
        if (parentId) {
            await this.db.query(`
        UPDATE memory_quadrants
        SET child_ids = array_append(child_ids, $1)
        WHERE id = $2
      `, [quadrant.id, parentId]);
        }
        // Add to cache
        this.quadrantCache.set(quadrant.id, quadrant);
        return quadrant;
    }
    /**
     * Assign a memory to the best quadrant
     */
    async assignMemory(memory, embedding) {
        // Validate and project embedding dimension if needed
        const expectedDim = await this.getDimension();
        let validEmbedding = embedding;
        if (embedding.length !== expectedDim) {
            // Use DimensionService to project embedding to correct dimension
            validEmbedding = await this.prepareEmbedding(embedding, 'memories', memory.content);
            logger.debug({
                originalDim: embedding.length,
                newDim: validEmbedding.length,
                expectedDim
            }, 'QuadrantSearch: projected embedding to correct dimension');
        }
        // Find the best leaf quadrant for this memory
        const bestQuadrant = await this.findBestQuadrant(validEmbedding);
        // Calculate distance - handle case where centroid might have wrong dimension
        let distanceToCentroid = 0;
        if (bestQuadrant.centroid.length === expectedDim) {
            distanceToCentroid = this.cosineDistance(validEmbedding, bestQuadrant.centroid);
        }
        // Create assignment
        const assignment = {
            memoryId: memory.id,
            quadrantId: bestQuadrant.id,
            distanceToCentroid,
            assignedAt: new Date()
        };
        // Insert assignment
        await this.db.query(`
      INSERT INTO quadrant_assignments (memory_id, quadrant_id, distance_to_centroid, assigned_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (memory_id) DO UPDATE SET
        quadrant_id = $2,
        distance_to_centroid = $3,
        assigned_at = $4
    `, [assignment.memoryId, assignment.quadrantId, assignment.distanceToCentroid, assignment.assignedAt]);
        // Update quadrant statistics
        await this.updateQuadrantStats(bestQuadrant.id, memory, embedding);
        // Check if quadrant needs splitting
        const quadrant = this.quadrantCache.get(bestQuadrant.id);
        if (quadrant && quadrant.memoryCount > quadrant.maxMemories) {
            await this.splitQuadrant(quadrant.id);
        }
        return assignment;
    }
    /**
     * Find the best quadrant for a given embedding
     * Dimension-agnostic traversal - skips quadrants with mismatched dimensions
     */
    async findBestQuadrant(embedding) {
        const expectedDim = await this.getDimension();
        // Start from root and traverse down
        let currentId = this.rootQuadrantId;
        let current = this.quadrantCache.get(currentId);
        if (!current) {
            throw new Error('Root quadrant not found');
        }
        // Traverse down the tree
        while (current.childIds.length > 0) {
            let bestChildId = current.childIds[0];
            let bestDistance = Infinity;
            for (const childId of current.childIds) {
                const child = this.quadrantCache.get(childId);
                // Only consider children with matching dimension centroids
                if (child && child.centroid.length === expectedDim) {
                    const distance = this.cosineDistance(embedding, child.centroid);
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        bestChildId = childId;
                    }
                }
            }
            const bestChild = this.quadrantCache.get(bestChildId);
            if (!bestChild)
                break;
            current = bestChild;
            currentId = bestChildId;
        }
        return current;
    }
    // ============================================================
    // QUADRANT SEARCH
    // ============================================================
    /**
     * Search for relevant quadrants given a query embedding
     *
     * This is the key optimization: instead of searching all memories,
     * we first identify the most relevant quadrants, then search within them.
     * Uses DimensionService to handle dimension mismatches gracefully.
     */
    async searchQuadrants(queryEmbedding, options = {}) {
        // Validate and prepare embedding dimension using DimensionService
        // This handles dimension mismatches gracefully (re-embed or scale)
        const validatedEmbedding = await this.prepareEmbedding(queryEmbedding, 'memory_quadrants', options.originalQuery, 'centroid');
        const { maxQuadrants = this.config.defaultSearchQuadrants, minRelevance = 0.3, level = null, includeChildren = true } = options;
        // Query quadrants with centroid similarity
        const query = `
      SELECT
        q.*,
        1 - (q.centroid <=> $1::vector) as similarity
      FROM memory_quadrants q
      WHERE
        q.centroid IS NOT NULL
        ${level !== null ? 'AND q.level = $2' : ''}
        AND q.memory_count > 0
      ORDER BY q.centroid <=> $1::vector
      LIMIT $${level !== null ? '3' : '2'}
    `;
        const params = level !== null
            ? [`[${validatedEmbedding.join(',')}]`, level, maxQuadrants * 2]
            : [`[${validatedEmbedding.join(',')}]`, maxQuadrants * 2];
        const result = await this.db.query(query, params);
        const results = result.rows
            .filter((row) => row.similarity >= minRelevance)
            .slice(0, maxQuadrants)
            .map((row) => ({
            quadrant: this.rowToQuadrant(row),
            distance: 1 - row.similarity,
            estimatedRelevance: row.similarity,
            memoryCount: row.memory_count
        }));
        // Optionally include children of top quadrants
        // Only include children with matching dimension centroids
        if (includeChildren && results.length > 0) {
            // Use the validated embedding's dimension as the expected dimension
            const expectedDim = validatedEmbedding.length;
            for (const result of results.slice(0, 3)) {
                for (const childId of result.quadrant.childIds) {
                    const child = this.quadrantCache.get(childId);
                    // Only consider children with matching dimension
                    if (child && child.centroid.length === expectedDim) {
                        const similarity = this.cosineSimilarity(validatedEmbedding, child.centroid);
                        if (similarity >= minRelevance) {
                            results.push({
                                quadrant: child,
                                distance: 1 - similarity,
                                estimatedRelevance: similarity,
                                memoryCount: child.memoryCount
                            });
                        }
                    }
                }
            }
        }
        // Sort by relevance and dedupe
        const seen = new Set();
        return results
            .sort((a, b) => b.estimatedRelevance - a.estimatedRelevance)
            .filter(r => {
            if (seen.has(r.quadrant.id))
                return false;
            seen.add(r.quadrant.id);
            return true;
        })
            .slice(0, maxQuadrants);
    }
    /**
     * Search memories within specific quadrants
     *
     * This is called AFTER searchQuadrants to get actual memories
     * from the most relevant quadrants.
     * Uses DimensionService to handle dimension mismatches gracefully.
     */
    async searchWithinQuadrants(queryEmbedding, quadrantIds, options = {}) {
        // Validate and prepare embedding dimension using DimensionService
        const validatedEmbedding = await this.prepareEmbedding(queryEmbedding, 'memories', options.originalQuery, 'embedding');
        const { limit = 20, threshold = 0.6 } = options;
        if (quadrantIds.length === 0)
            return [];
        const query = `
      SELECT
        m.*,
        qa.quadrant_id,
        1 - (m.embedding <=> $1::vector) as similarity
      FROM memories m
      JOIN quadrant_assignments qa ON qa.memory_id = m.id
      WHERE
        qa.quadrant_id = ANY($2)
        AND m.embedding IS NOT NULL
        AND (m.expires_at IS NULL OR m.expires_at > NOW())
        AND 1 - (m.embedding <=> $1::vector) >= $3
      ORDER BY m.embedding <=> $1::vector
      LIMIT $4
    `;
        const result = await this.db.query(query, [
            `[${validatedEmbedding.join(',')}]`,
            quadrantIds,
            threshold,
            limit
        ]);
        return result.rows.map((row) => ({
            memory: this.rowToMemory(row),
            similarity: row.similarity,
            quadrantId: row.quadrant_id
        }));
    }
    /**
     * Full quadrant-aware search: find quadrants, then search within
     * Uses DimensionService to handle dimension mismatches gracefully.
     */
    async smartSearch(queryEmbedding, options = {}) {
        // Validate and prepare embedding upfront (reuse same validated embedding)
        const validatedEmbedding = await this.prepareEmbedding(queryEmbedding, 'memories', options.originalQuery, 'embedding');
        const { limit = 20, threshold = 0.6, maxQuadrants = 5 } = options;
        // Phase 1: Find relevant quadrants (using validated embedding)
        const relevantQuadrants = await this.searchQuadrants(validatedEmbedding, {
            maxQuadrants,
            minRelevance: 0.3,
            originalQuery: options.originalQuery
        });
        if (relevantQuadrants.length === 0) {
            logger.debug('no relevant quadrants found, falling back to global search');
            // Fallback to global search
            return this.globalSearch(validatedEmbedding, { limit, threshold });
        }
        const quadrantIds = relevantQuadrants.map(r => r.quadrant.id);
        logger.debug({
            quadrantsSearched: quadrantIds.length,
            topQuadrant: relevantQuadrants[0]?.quadrant.name,
            topRelevance: relevantQuadrants[0]?.estimatedRelevance
        }, 'quadrant search phase complete');
        // Phase 2: Search within relevant quadrants (using same validated embedding)
        return this.searchWithinQuadrants(validatedEmbedding, quadrantIds, { limit, threshold });
    }
    /**
     * Global search fallback (searches all memories)
     * Assumes embedding is already validated by caller.
     */
    async globalSearch(queryEmbedding, options) {
        // If embedding wasn't validated by caller, validate it here
        const validatedEmbedding = await this.prepareEmbedding(queryEmbedding, 'memories', options.originalQuery, 'embedding');
        const { limit = 20, threshold = 0.6 } = options;
        const query = `
      SELECT
        m.*,
        1 - (m.embedding <=> $1::vector) as similarity
      FROM memories m
      WHERE
        m.embedding IS NOT NULL
        AND (m.expires_at IS NULL OR m.expires_at > NOW())
        AND 1 - (m.embedding <=> $1::vector) >= $2
      ORDER BY m.embedding <=> $1::vector
      LIMIT $3
    `;
        const result = await this.db.query(query, [
            `[${validatedEmbedding.join(',')}]`,
            threshold,
            limit
        ]);
        return result.rows.map((row) => ({
            memory: this.rowToMemory(row),
            similarity: row.similarity,
            quadrantId: this.rootQuadrantId || ''
        }));
    }
    // ============================================================
    // QUADRANT MAINTENANCE (Split/Merge)
    // ============================================================
    /**
     * Split a quadrant that has grown too large or dispersed
     * Dimension-agnostic - validates and filters embeddings during split.
     */
    async splitQuadrant(quadrantId) {
        const quadrant = this.quadrantCache.get(quadrantId);
        if (!quadrant)
            throw new Error(`Quadrant ${quadrantId} not found`);
        const expectedDim = await this.getDimension();
        logger.info({
            quadrantId,
            memoryCount: quadrant.memoryCount,
            dimension: expectedDim
        }, 'splitting quadrant');
        // Get all memories in this quadrant
        const memoriesQuery = `
      SELECT m.*, qa.distance_to_centroid
      FROM memories m
      JOIN quadrant_assignments qa ON qa.memory_id = m.id
      WHERE qa.quadrant_id = $1
    `;
        const memoriesResult = await this.db.query(memoriesQuery, [quadrantId]);
        const memories = memoriesResult.rows;
        if (memories.length < 2)
            return [];
        // Use k-means to split into 2-4 clusters
        const numClusters = Math.min(4, Math.ceil(memories.length / this.config.minMemoriesPerQuadrant));
        const clusters = await this.kMeansClustering(memories, numClusters, expectedDim);
        const newQuadrants = [];
        for (let i = 0; i < clusters.length; i++) {
            const cluster = clusters[i];
            if (cluster.members.length < this.config.minMemoriesPerQuadrant)
                continue;
            // Validate cluster centroid dimension
            if (cluster.centroid.length !== expectedDim) {
                logger.warn({
                    clusterId: i,
                    centroidDim: cluster.centroid.length,
                    expectedDim
                }, 'QuadrantSearch: skipping cluster with wrong centroid dimension');
                continue;
            }
            // Create new child quadrant
            const keywords = this.extractKeywords(cluster.members.map(m => m.content));
            const newQuadrant = await this.createQuadrant(`${quadrant.name}-${i}`, `Sub-quadrant of ${quadrant.name}`, quadrant.level + 1, quadrant.id, cluster.centroid, keywords);
            // Reassign memories to new quadrant
            for (const member of cluster.members) {
                const memberEmbedding = this.parseEmbedding(member.embedding);
                // Only compute distance if embedding dimension matches
                const distance = memberEmbedding.length === expectedDim
                    ? this.cosineDistance(memberEmbedding, cluster.centroid)
                    : 0;
                await this.db.query(`
          UPDATE quadrant_assignments
          SET quadrant_id = $1, distance_to_centroid = $2
          WHERE memory_id = $3
        `, [
                    newQuadrant.id,
                    distance,
                    member.id
                ]);
            }
            // Update quadrant stats
            newQuadrant.memoryCount = cluster.members.length;
            this.quadrantCache.set(newQuadrant.id, newQuadrant);
            newQuadrants.push(newQuadrant);
        }
        // Update original quadrant's memory count
        quadrant.memoryCount = 0;
        quadrant.childIds = [...quadrant.childIds, ...newQuadrants.map(q => q.id)];
        this.quadrantCache.set(quadrant.id, quadrant);
        await this.db.query(`
      UPDATE memory_quadrants
      SET memory_count = 0, child_ids = $1
      WHERE id = $2
    `, [quadrant.childIds, quadrant.id]);
        logger.info({
            originalQuadrant: quadrantId,
            newQuadrants: newQuadrants.length,
            dimension: expectedDim
        }, 'quadrant split complete');
        return newQuadrants;
    }
    /**
     * Simple k-means clustering for quadrant splitting
     * Dimension-agnostic - filters embeddings by expected dimension.
     */
    async kMeansClustering(memories, k, expectedDim) {
        // Filter memories with valid embeddings that match expected dimension
        const validMemories = memories.filter(m => {
            if (!m.embedding)
                return false;
            const embedding = this.parseEmbedding(m.embedding);
            // If expectedDim is provided, filter by dimension
            if (expectedDim && embedding.length !== expectedDim) {
                return false;
            }
            return embedding.length > 0;
        });
        if (validMemories.length < k)
            k = validMemories.length;
        if (k < 1)
            return [];
        // Initialize centroids randomly
        const centroids = [];
        const indices = new Set();
        while (indices.size < k) {
            indices.add(Math.floor(Math.random() * validMemories.length));
        }
        for (const idx of indices) {
            centroids.push(this.parseEmbedding(validMemories[idx].embedding));
        }
        // Run k-means iterations
        const maxIterations = 10;
        let clusters = [];
        for (let iter = 0; iter < maxIterations; iter++) {
            // Assign memories to nearest centroid
            clusters = centroids.map(c => ({ centroid: c, members: [] }));
            for (const memory of validMemories) {
                const embedding = this.parseEmbedding(memory.embedding);
                let bestCluster = 0;
                let bestDistance = Infinity;
                for (let i = 0; i < centroids.length; i++) {
                    // Only compute distance if dimensions match
                    if (embedding.length === centroids[i].length) {
                        const distance = this.cosineDistance(embedding, centroids[i]);
                        if (distance < bestDistance) {
                            bestDistance = distance;
                            bestCluster = i;
                        }
                    }
                }
                clusters[bestCluster].members.push(memory);
            }
            // Update centroids
            for (let i = 0; i < clusters.length; i++) {
                if (clusters[i].members.length > 0) {
                    const newCentroid = this.averageEmbeddings(clusters[i].members.map(m => this.parseEmbedding(m.embedding)));
                    if (newCentroid.length > 0) {
                        centroids[i] = newCentroid;
                        clusters[i].centroid = centroids[i];
                    }
                }
            }
        }
        return clusters.filter(c => c.members.length > 0 && c.centroid.length > 0);
    }
    // ============================================================
    // HELPER METHODS
    // ============================================================
    async loadQuadrantsIntoCache() {
        const query = `SELECT * FROM memory_quadrants`;
        const result = await this.db.query(query);
        this.quadrantCache.clear();
        for (const row of result.rows) {
            const quadrant = this.rowToQuadrant(row);
            this.quadrantCache.set(quadrant.id, quadrant);
        }
    }
    async updateQuadrantStats(quadrantId, memory, embedding) {
        const quadrant = this.quadrantCache.get(quadrantId);
        if (!quadrant)
            return;
        // Get expected dimension
        const expectedDim = await this.getDimension();
        // Validate incoming embedding dimension
        if (embedding.length !== expectedDim) {
            logger.warn({
                quadrantId,
                embeddingDim: embedding.length,
                expectedDim
            }, 'QuadrantSearch: embedding dimension mismatch in updateQuadrantStats');
            return; // Skip update with mismatched dimension
        }
        // Update memory count
        quadrant.memoryCount++;
        quadrant.lastAccessedAt = new Date();
        // Update centroid (incremental average)
        // Handle dimension mismatch: reset centroid if wrong dimension
        if (quadrant.centroid.length === 0 || quadrant.centroid.length !== expectedDim) {
            if (quadrant.centroid.length > 0 && quadrant.centroid.length !== expectedDim) {
                logger.info({
                    quadrantId,
                    oldDim: quadrant.centroid.length,
                    newDim: expectedDim
                }, 'QuadrantSearch: resetting centroid due to dimension change');
            }
            quadrant.centroid = [...embedding]; // Copy the embedding as new centroid
        }
        else {
            // Dimension matches, do incremental average
            const n = quadrant.memoryCount;
            quadrant.centroid = quadrant.centroid.map((val, i) => (val * (n - 1) + embedding[i]) / n);
        }
        // Update radius
        const distance = this.cosineDistance(embedding, quadrant.centroid);
        if (distance > quadrant.radius) {
            quadrant.radius = distance;
        }
        // Update memory types
        if (!quadrant.memoryTypes.includes(memory.memoryType)) {
            quadrant.memoryTypes.push(memory.memoryType);
        }
        // Persist updates
        await this.db.query(`
      UPDATE memory_quadrants
      SET
        memory_count = $1,
        centroid = $2,
        radius = $3,
        memory_types = $4,
        last_accessed_at = $5,
        updated_at = NOW()
      WHERE id = $6
    `, [
            quadrant.memoryCount,
            `[${quadrant.centroid.join(',')}]`,
            quadrant.radius,
            quadrant.memoryTypes,
            quadrant.lastAccessedAt,
            quadrantId
        ]);
        this.quadrantCache.set(quadrantId, quadrant);
    }
    cosineDistance(a, b) {
        return 1 - this.cosineSimilarity(a, b);
    }
    /**
     * Compute cosine similarity between two vectors
     * Works with any dimension - no hardcoded values
     */
    cosineSimilarity(a, b) {
        // Handle dimension mismatch gracefully
        if (a.length !== b.length) {
            logger.debug({
                dimA: a.length,
                dimB: b.length
            }, 'QuadrantSearch: dimension mismatch in cosineSimilarity');
            return 0;
        }
        if (a.length === 0)
            return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        // Dimension-agnostic loop - works with any vector size
        for (let i = 0; i < a.length; i++) {
            dotProduct += (a[i] * b[i]);
            normA += (a[i] ** 2);
            normB += (b[i] ** 2);
        }
        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator === 0 ? 0 : dotProduct / denominator;
    }
    /**
     * Compute average of multiple embeddings
     * Dimension-agnostic - uses first embedding's dimension, validates all others match
     */
    averageEmbeddings(embeddings) {
        if (embeddings.length === 0)
            return [];
        // Filter out any empty or mismatched embeddings
        const firstDim = embeddings[0].length;
        const validEmbeddings = embeddings.filter(e => e.length === firstDim);
        if (validEmbeddings.length === 0)
            return [];
        if (validEmbeddings.length !== embeddings.length) {
            logger.debug({
                total: embeddings.length,
                valid: validEmbeddings.length,
                expectedDim: firstDim
            }, 'QuadrantSearch: filtered out embeddings with wrong dimension in averageEmbeddings');
        }
        // Dimension-agnostic averaging
        const dimensions = firstDim;
        const result = new Array(dimensions).fill(0);
        for (const embedding of validEmbeddings) {
            for (let i = 0; i < dimensions; i++) {
                result[i] += embedding[i] / validEmbeddings.length;
            }
        }
        return result;
    }
    extractKeywords(contents) {
        // Simple keyword extraction based on word frequency
        const wordCounts = new Map();
        for (const content of contents) {
            const words = content
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length > 3);
            for (const word of words) {
                wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
            }
        }
        // Sort by frequency and take top 10
        return Array.from(wordCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([word]) => word);
    }
    parseEmbedding(embeddingStr) {
        if (Array.isArray(embeddingStr))
            return embeddingStr;
        if (!embeddingStr)
            return [];
        const cleaned = embeddingStr.replace(/[\[\]]/g, '');
        return cleaned.split(',').map(Number);
    }
    rowToQuadrant(row) {
        return {
            id: row.id,
            name: row.name,
            level: row.level,
            parentId: row.parent_id,
            childIds: row.child_ids || [],
            centroid: this.parseEmbedding(row.centroid || ''),
            radius: row.radius || 0,
            keywords: row.keywords || [],
            memoryCount: row.memory_count || 0,
            totalAccessCount: row.total_access_count || 0,
            lastAccessedAt: row.last_accessed_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            maxMemories: row.max_memories || this.config.maxMemoriesPerQuadrant,
            minMemories: row.min_memories || this.config.minMemoriesPerQuadrant,
            maxRadius: row.max_radius || this.config.maxRadiusForSplit,
            memoryTypes: row.memory_types || [],
            tags: row.tags || [],
            metadata: row.metadata || {}
        };
    }
    rowToMemory(row) {
        return {
            id: row.id,
            content: row.content,
            memoryType: row.memory_type,
            importance: row.importance,
            tags: row.tags || [],
            metadata: row.metadata || {},
            embedding: this.parseEmbedding(row.embedding || ''),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            accessCount: row.access_count || 0,
            lastAccessedAt: row.last_accessed_at,
            expiresAt: row.expires_at,
            consolidatedFrom: row.consolidated_from
        };
    }
    // ============================================================
    // PUBLIC DIMENSION API
    // ============================================================
    /**
     * Get the current detected embedding dimension
     * Returns null if not yet detected
     */
    getDetectedDimension() {
        return this.detectedDimension;
    }
    /**
     * Force re-detection of embedding dimension
     * Useful when database schema changes
     */
    async refreshDimension() {
        this.detectedDimension = null;
        return this.getDimension();
    }
    /**
     * Validate that an embedding has the correct dimension
     */
    async validateEmbeddingDimension(embedding) {
        const expectedDim = await this.getDimension();
        return embedding.length === expectedDim;
    }
}
export default QuadrantSearchSystem;
//# sourceMappingURL=quadrantSearch.js.map