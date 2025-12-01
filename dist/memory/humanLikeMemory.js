/**
 * humanLikeMemory.ts - HUMAN-LIKE MEMORY EVOLUTION SYSTEM
 *
 * This module implements human-inspired memory patterns:
 * 1. Forgetting curves (Ebbinghaus-inspired decay)
 * 2. Associative recall (memories trigger related memories)
 * 3. Memory chains (sequential reasoning paths)
 * 4. Memory strength (reinforced by access)
 * 5. Consolidation during "sleep" (background processing)
 *
 * The goal is to make Claude's memory more natural and intelligent,
 * not just a flat database but a living, evolving knowledge store.
 */
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { getDimensionService } from '../services/DimensionService.js';
import { getProjectContext } from '../services/ProjectContext.js';
/**
 * HumanLikeMemorySystem - The brain of SpecMem
 *
 * This system makes memory more intelligent by:
 * 1. Tracking memory strength and decay
 * 2. Building associative networks
 * 3. Preserving reasoning chains
 * 4. Adapting context based on relevance
 */
export class HumanLikeMemorySystem {
    db;
    embeddingProvider;
    // Cache for frequently accessed strength data
    strengthCache = new Map();
    cacheTimeout = 5 * 60 * 1000; // 5 minutes
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
    }
    // ============================================================
    // FORGETTING CURVE IMPLEMENTATION
    // ============================================================
    /**
     * Calculate current retrievability based on Ebbinghaus curve
     *
     * R(t) = e^(-t/S) where:
     * - R is retrievability (0-1)
     * - t is time since last review (days)
     * - S is stability (higher = slower decay)
     */
    calculateRetrievability(lastReview, stability, importance) {
        const now = new Date();
        const daysSinceReview = (now.getTime() - lastReview.getTime()) / (1000 * 60 * 60 * 24);
        // Importance modifier (critical memories decay slower)
        const importanceMultiplier = {
            critical: 2.0,
            high: 1.5,
            medium: 1.0,
            low: 0.7,
            trivial: 0.4
        }[importance];
        const effectiveStability = stability * importanceMultiplier;
        // Ebbinghaus formula
        const retrievability = Math.exp(-daysSinceReview / effectiveStability);
        return Math.max(0, Math.min(1, retrievability));
    }
    /**
     * Update memory strength after access (spaced repetition)
     *
     * When a memory is accessed:
     * 1. Retrievability is reset to 1.0
     * 2. Stability increases based on interval
     * 3. Next optimal interval is calculated
     */
    async updateMemoryStrength(memoryId, wasSuccessfulRecall, importance) {
        // Get existing strength or create new
        let strength = await this.getMemoryStrength(memoryId);
        if (!strength) {
            strength = this.createInitialStrength(memoryId, importance);
        }
        const now = new Date();
        const daysSinceReview = (now.getTime() - strength.lastReview.getTime()) / (1000 * 60 * 60 * 24);
        if (wasSuccessfulRecall) {
            // Successful recall increases stability (SM-2 inspired)
            strength.easeFactor = Math.max(1.3, strength.easeFactor + 0.1);
            // Stability increases more for longer intervals
            const intervalBonus = Math.log2(Math.max(1, daysSinceReview) + 1);
            strength.stability = Math.min(100, strength.stability + (5 * intervalBonus));
            // Calculate next optimal interval
            strength.intervalDays = Math.max(1, strength.intervalDays * strength.easeFactor);
        }
        else {
            // Failed recall decreases stability
            strength.easeFactor = Math.max(1.3, strength.easeFactor - 0.2);
            strength.stability = Math.max(1, strength.stability * 0.8);
            strength.intervalDays = 1; // Reset to minimum
        }
        strength.lastReview = now;
        strength.reviewCount++;
        strength.retrievability = 1.0; // Reset after access
        // Persist to database
        await this.saveMemoryStrength(strength);
        // Update cache
        this.strengthCache.set(memoryId, strength);
        return strength;
    }
    /**
     * Create initial strength for new memory
     */
    createInitialStrength(memoryId, importance) {
        // Initial stability based on importance
        const baseStability = {
            critical: 30,
            high: 20,
            medium: 10,
            low: 5,
            trivial: 2
        }[importance];
        return {
            memoryId,
            stability: baseStability,
            retrievability: 1.0,
            lastReview: new Date(),
            reviewCount: 1,
            intervalDays: 1,
            easeFactor: 2.0 // Medium ease
        };
    }
    /**
     * Get memories that are "fading" (low retrievability)
     * These should be reviewed or consolidated
     */
    async getFadingMemories(threshold = 0.3, limit = 50) {
        // PROJECT NAMESPACING: Filter by current project
        const projectPath = getProjectContext().getProjectPath();
        const query = `
      SELECT
        m.*,
        ms.stability,
        ms.retrievability,
        ms.last_review,
        ms.review_count,
        ms.interval_days,
        ms.ease_factor
      FROM memories m
      LEFT JOIN memory_strength ms ON m.id = ms.memory_id
      WHERE
        (ms.retrievability IS NULL OR ms.retrievability < $1)
        AND (m.expires_at IS NULL OR m.expires_at > NOW())
        AND m.importance IN ('critical', 'high', 'medium')
        AND m.project_path = $3
      ORDER BY
        COALESCE(ms.retrievability, 0) ASC,
        m.importance DESC
      LIMIT $2
    `;
        const result = await this.db.query(query, [threshold, limit, projectPath]);
        return result.rows.map((row) => ({
            memory: this.rowToMemory(row),
            strength: row.stability ? {
                memoryId: row.id,
                stability: row.stability,
                retrievability: row.retrievability,
                lastReview: row.last_review,
                reviewCount: row.review_count,
                intervalDays: row.interval_days,
                easeFactor: row.ease_factor
            } : this.createInitialStrength(row.id, row.importance)
        }));
    }
    // ============================================================
    // ASSOCIATIVE RECALL IMPLEMENTATION
    // ============================================================
    /**
     * Build associative links when memories are accessed together
     *
     * When memory A is accessed in context of memory B:
     * - Create or strengthen A -> B link
     * - Co-activation count increases
     * - Link strength increases
     */
    async recordCoActivation(memoryIds, linkType = 'contextual') {
        if (memoryIds.length < 2)
            return;
        const now = new Date();
        // Create links between all pairs
        for (let i = 0; i < memoryIds.length; i++) {
            for (let j = i + 1; j < memoryIds.length; j++) {
                await this.strengthenLink(memoryIds[i], memoryIds[j], linkType, now);
            }
        }
    }
    /**
     * Strengthen (or create) an associative link
     */
    async strengthenLink(sourceId, targetId, linkType, timestamp) {
        // Use UPSERT to create or update
        const query = `
      INSERT INTO memory_associations (
        source_id, target_id, link_type, strength,
        co_activation_count, last_co_activation, decay_rate
      ) VALUES ($1, $2, $3, 0.3, 1, $4, 0.1)
      ON CONFLICT (source_id, target_id)
      DO UPDATE SET
        strength = LEAST(1.0, memory_associations.strength + 0.1),
        co_activation_count = memory_associations.co_activation_count + 1,
        last_co_activation = $4
      RETURNING *
    `;
        try {
            await this.db.query(query, [sourceId, targetId, linkType, timestamp]);
        }
        catch (error) {
            logger.warn({ error, sourceId, targetId }, 'failed to strengthen link');
        }
    }
    /**
     * Get associated memories through link traversal
     *
     * Uses spreading activation: stronger links activate targets more
     */
    async getAssociatedMemories(memoryId, depth = 2, minStrength = 0.3, limit = 20) {
        // Recursive CTE for graph traversal with strength accumulation
        const query = `
      WITH RECURSIVE association_path AS (
        -- Base case: direct associations
        SELECT
          ma.target_id as memory_id,
          ARRAY[ma.source_id, ma.target_id] as path,
          ma.strength as total_strength,
          1 as depth
        FROM memory_associations ma
        WHERE ma.source_id = $1
          AND ma.strength >= $2

        UNION ALL

        -- Recursive case: follow associations
        SELECT
          ma.target_id,
          ap.path || ma.target_id,
          ap.total_strength * ma.strength,
          ap.depth + 1
        FROM association_path ap
        JOIN memory_associations ma ON ma.source_id = ap.memory_id
        WHERE ap.depth < $3
          AND ma.strength >= $2
          AND NOT ma.target_id = ANY(ap.path)  -- Prevent cycles
      )
      SELECT DISTINCT ON (m.id)
        m.*,
        ap.path,
        ap.total_strength
      FROM association_path ap
      JOIN memories m ON m.id = ap.memory_id
      WHERE (m.expires_at IS NULL OR m.expires_at > NOW())
      ORDER BY m.id, ap.total_strength DESC
      LIMIT $4
    `;
        const result = await this.db.query(query, [memoryId, minStrength, depth, limit]);
        return result.rows.map((row) => ({
            memory: this.rowToMemory(row),
            path: row.path,
            totalStrength: row.total_strength
        }));
    }
    /**
     * Decay old association links (run periodically)
     *
     * Links that aren't reinforced will gradually weaken
     */
    async decayAssociations(decayDays = 30) {
        const query = `
      UPDATE memory_associations
      SET strength = strength * (1 - decay_rate)
      WHERE last_co_activation < NOW() - INTERVAL '1 day' * $1

      -- Also delete very weak links
      DELETE FROM memory_associations WHERE strength < 0.05

      RETURNING id
    `;
        const result = await this.db.query(query, [decayDays]);
        return result.rowCount || 0;
    }
    // ============================================================
    // MEMORY CHAINS IMPLEMENTATION
    // ============================================================
    /**
     * Create a new memory chain (reasoning path)
     */
    async createChain(name, description, memoryIds, chainType, importance) {
        const chain = {
            id: uuidv4(),
            name,
            description,
            memoryIds,
            chainType,
            importance,
            createdAt: new Date(),
            lastAccessedAt: new Date(),
            accessCount: 1,
            metadata: {}
        };
        const query = `
      INSERT INTO memory_chains (
        id, name, description, memory_ids, chain_type,
        importance, created_at, last_accessed_at, access_count, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;
        await this.db.query(query, [
            chain.id,
            chain.name,
            chain.description,
            chain.memoryIds,
            chain.chainType,
            chain.importance,
            chain.createdAt,
            chain.lastAccessedAt,
            chain.accessCount,
            chain.metadata
        ]);
        // Create sequential links between chain memories
        for (let i = 0; i < memoryIds.length - 1; i++) {
            await this.strengthenLink(memoryIds[i], memoryIds[i + 1], 'causal', chain.createdAt);
        }
        logger.info({ chainId: chain.id, length: memoryIds.length }, 'memory chain created');
        return chain;
    }
    /**
     * Extend an existing chain with new memories
     */
    async extendChain(chainId, newMemoryIds) {
        const query = `
      UPDATE memory_chains
      SET
        memory_ids = memory_ids || $2,
        last_accessed_at = NOW(),
        access_count = access_count + 1
      WHERE id = $1
      RETURNING *
    `;
        const result = await this.db.query(query, [chainId, newMemoryIds]);
        if (result.rows.length === 0) {
            throw new Error(`Chain ${chainId} not found`);
        }
        const row = result.rows[0];
        // Link new memories to each other and to the last existing memory
        const existingIds = row.memory_ids;
        if (existingIds.length > 0 && newMemoryIds.length > 0) {
            const lastExisting = existingIds[existingIds.length - newMemoryIds.length - 1];
            await this.strengthenLink(lastExisting, newMemoryIds[0], 'causal', new Date());
        }
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            memoryIds: row.memory_ids,
            chainType: row.chain_type,
            importance: row.importance,
            createdAt: row.created_at,
            lastAccessedAt: row.last_accessed_at,
            accessCount: row.access_count,
            metadata: row.metadata
        };
    }
    /**
     * Find chains that contain a specific memory
     */
    async findChainsContaining(memoryId) {
        const query = `
      SELECT * FROM memory_chains
      WHERE $1 = ANY(memory_ids)
      ORDER BY last_accessed_at DESC
    `;
        const result = await this.db.query(query, [memoryId]);
        return result.rows.map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            memoryIds: row.memory_ids,
            chainType: row.chain_type,
            importance: row.importance,
            createdAt: row.created_at,
            lastAccessedAt: row.last_accessed_at,
            accessCount: row.access_count,
            metadata: row.metadata
        }));
    }
    // ============================================================
    // ADAPTIVE CONTEXT WINDOWS
    // ============================================================
    /**
     * Build an adaptive context window for a query
     *
     * The context window expands based on:
     * - Query complexity
     * - Number of relevant memories found
     * - Strength of associations
     * - Available token budget
     */
    async buildContextWindow(query, embedding, options = {}) {
        const { maxTokens = 8000, minRelevance = 0.6, includeAssociations = true, includeChains = true, maxAssociationDepth = 2 } = options;
        // Validate and prepare embedding for the memories table (dynamic dimension)
        const dimService = getDimensionService(this.db, this.embeddingProvider);
        const prepared = await dimService.validateAndPrepare('memories', embedding, query);
        const validatedEmbedding = prepared.embedding;
        if (prepared.wasModified) {
            logger.info({ action: prepared.action }, 'Adjusted embedding dimension for buildContextWindow');
        }
        // PROJECT NAMESPACING: Filter by current project
        const projectPath = getProjectContext().getProjectPath();
        // Phase 1: Get core memories by semantic similarity
        const coreQuery = `
      SELECT m.*, 1 - (m.embedding <=> $1::vector) as similarity
      FROM memories m
      WHERE
        m.embedding IS NOT NULL
        AND (m.expires_at IS NULL OR m.expires_at > NOW())
        AND 1 - (m.embedding <=> $1::vector) >= $2
        AND m.project_path = $3
      ORDER BY similarity DESC
      LIMIT 20
    `;
        const coreResult = await this.db.query(coreQuery, [
            `[${validatedEmbedding.join(',')}]`,
            minRelevance,
            projectPath
        ]);
        const coreMemories = coreResult.rows.map((row) => this.rowToMemory(row));
        let totalTokens = this.estimateTokens(coreMemories);
        // Phase 2: Get associated memories (spreading activation)
        let associatedMemories = [];
        if (includeAssociations && coreMemories.length > 0 && totalTokens < maxTokens * 0.7) {
            const associatedIds = new Set();
            for (const core of coreMemories.slice(0, 5)) { // Top 5 core memories
                const associated = await this.getAssociatedMemories(core.id, maxAssociationDepth, 0.4, 10);
                for (const { memory } of associated) {
                    if (!associatedIds.has(memory.id) &&
                        !coreMemories.some(c => c.id === memory.id)) {
                        associatedIds.add(memory.id);
                        associatedMemories.push(memory);
                    }
                }
            }
            totalTokens += this.estimateTokens(associatedMemories);
        }
        // Phase 3: Get chain memories
        let chainMemories = [];
        if (includeChains && totalTokens < maxTokens * 0.85) {
            const chainIds = new Set();
            for (const core of coreMemories.slice(0, 3)) { // Top 3 core memories
                const chains = await this.findChainsContaining(core.id);
                for (const chain of chains.slice(0, 2)) { // Top 2 chains per memory
                    for (const memId of chain.memoryIds) {
                        if (!chainIds.has(memId) &&
                            !coreMemories.some(c => c.id === memId) &&
                            !associatedMemories.some(a => a.id === memId)) {
                            chainIds.add(memId);
                        }
                    }
                }
            }
            if (chainIds.size > 0) {
                const chainQuery = `
          SELECT * FROM memories
          WHERE id = ANY($1)
            AND (expires_at IS NULL OR expires_at > NOW())
            AND project_path = $2
        `;
                const chainResult = await this.db.query(chainQuery, [Array.from(chainIds), projectPath]);
                chainMemories = chainResult.rows.map((row) => this.rowToMemory(row));
                totalTokens += this.estimateTokens(chainMemories);
            }
        }
        // Phase 4: Add contextual memories if we have token budget
        let contextualMemories = [];
        if (totalTokens < maxTokens * 0.95) {
            const contextQuery = `
        SELECT m.*, 1 - (m.embedding <=> $1::vector) as similarity
        FROM memories m
        WHERE
          m.embedding IS NOT NULL
          AND (m.expires_at IS NULL OR m.expires_at > NOW())
          AND m.id NOT IN (SELECT unnest($2::uuid[]))
          AND 1 - (m.embedding <=> $1::vector) >= $3
          AND m.project_path = $4
        ORDER BY similarity DESC
        LIMIT 10
      `;
            const existingIds = [
                ...coreMemories.map(m => m.id),
                ...associatedMemories.map(m => m.id),
                ...chainMemories.map(m => m.id)
            ];
            // Use the already validated embedding (consistent dimension)
            const contextResult = await this.db.query(contextQuery, [
                `[${validatedEmbedding.join(',')}]`,
                existingIds,
                minRelevance * 0.8, // Slightly lower threshold
                projectPath
            ]);
            contextualMemories = contextResult.rows.map((row) => this.rowToMemory(row));
        }
        // Record co-activations for all memories in context
        const allIds = [
            ...coreMemories.map(m => m.id),
            ...associatedMemories.map(m => m.id).slice(0, 5),
            ...chainMemories.map(m => m.id).slice(0, 5)
        ];
        await this.recordCoActivation(allIds, 'contextual');
        return {
            coreMemories,
            associatedMemories,
            chainMemories,
            contextualMemories,
            totalTokenEstimate: totalTokens + this.estimateTokens(contextualMemories),
            relevanceThreshold: minRelevance,
            maxDepth: maxAssociationDepth
        };
    }
    /**
     * Estimate tokens for a list of memories
     */
    estimateTokens(memories) {
        // Rough estimate: ~4 characters per token
        return memories.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
    }
    // ============================================================
    // HELPER METHODS
    // ============================================================
    async getMemoryStrength(memoryId) {
        // Check cache first
        const cached = this.strengthCache.get(memoryId);
        if (cached)
            return cached;
        const query = `
      SELECT * FROM memory_strength WHERE memory_id = $1
    `;
        const result = await this.db.query(query, [memoryId]);
        if (result.rows.length === 0)
            return null;
        const row = result.rows[0];
        const strength = {
            memoryId: row.memory_id,
            stability: row.stability,
            retrievability: row.retrievability,
            lastReview: row.last_review,
            reviewCount: row.review_count,
            intervalDays: row.interval_days,
            easeFactor: row.ease_factor
        };
        this.strengthCache.set(memoryId, strength);
        return strength;
    }
    async saveMemoryStrength(strength) {
        const query = `
      INSERT INTO memory_strength (
        memory_id, stability, retrievability, last_review,
        review_count, interval_days, ease_factor
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (memory_id)
      DO UPDATE SET
        stability = $2,
        retrievability = $3,
        last_review = $4,
        review_count = $5,
        interval_days = $6,
        ease_factor = $7
    `;
        await this.db.query(query, [
            strength.memoryId,
            strength.stability,
            strength.retrievability,
            strength.lastReview,
            strength.reviewCount,
            strength.intervalDays,
            strength.easeFactor
        ]);
    }
    rowToMemory(row) {
        return {
            id: row.id,
            content: row.content,
            memoryType: row.memory_type,
            importance: row.importance,
            tags: row.tags || [],
            metadata: row.metadata || {},
            embedding: row.embedding ? this.parseEmbedding(row.embedding) : undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            accessCount: row.access_count || 0,
            lastAccessedAt: row.last_accessed_at,
            expiresAt: row.expires_at,
            consolidatedFrom: row.consolidated_from
        };
    }
    parseEmbedding(embeddingStr) {
        if (Array.isArray(embeddingStr))
            return embeddingStr;
        const cleaned = embeddingStr.replace(/[\[\]]/g, '');
        return cleaned.split(',').map(Number);
    }
}
export default HumanLikeMemorySystem;
//# sourceMappingURL=humanLikeMemory.js.map