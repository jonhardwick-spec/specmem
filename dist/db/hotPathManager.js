/**
 * hotPathManager.ts - HOT PATH ACCELERATION ENGINE
 *
 * Tracks frequently accessed memory chains and optimizes retrieval.
 * When memories are accessed together often, they become a "hot path"
 * that gets cached and pre-fetched for faster recall.
 *
 * Think of it like how your brain gets faster at recalling related memories
 * the more you think about them together.
 *
 * Features:
 * - Tracks memory access transitions (A -> B -> C)
 * - Detects frequently used access patterns
 * - Creates and caches hot paths for fast retrieval
 * - Decays unused paths over time
 * - Predicts next memories based on current context
 */
import { createHash } from 'crypto';
import { logger } from '../utils/logger.js';
import { getCurrentProjectPath } from '../services/ProjectContext.js';
// =============================================================================
// HOT PATH MANAGER
// =============================================================================
export class HotPathManager {
    pool;
    // In-memory tracking for current session
    lastAccessedMemoryId = null;
    currentSessionId = null;
    accessBuffer = [];
    constructor(pool) {
        this.pool = pool;
    }
    // ===========================================================================
    // SESSION MANAGEMENT
    // ===========================================================================
    /**
     * Start tracking a new session
     */
    startSession(sessionId) {
        this.currentSessionId = sessionId ?? this.generateSessionId();
        this.accessBuffer = [];
        this.lastAccessedMemoryId = null;
        logger.debug({ sessionId: this.currentSessionId }, 'hot path session started');
        return this.currentSessionId;
    }
    /**
     * End current session and process access patterns
     */
    async endSession() {
        if (this.accessBuffer.length >= 2) {
            await this.processAccessBuffer();
        }
        this.currentSessionId = null;
        this.accessBuffer = [];
        this.lastAccessedMemoryId = null;
    }
    generateSessionId() {
        return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    // ===========================================================================
    // ACCESS TRACKING
    // ===========================================================================
    /**
     * Record a memory access - call this whenever a memory is retrieved
     */
    async recordAccess(memoryId) {
        const now = new Date();
        // Add to buffer
        this.accessBuffer.push({ memoryId, timestamp: now });
        // Record transition if we have a previous memory
        if (this.lastAccessedMemoryId && this.lastAccessedMemoryId !== memoryId) {
            const timeBetween = this.accessBuffer.length >= 2
                ? now.getTime() - this.accessBuffer[this.accessBuffer.length - 2].timestamp.getTime()
                : null;
            await this.recordTransition(this.lastAccessedMemoryId, memoryId, this.currentSessionId, timeBetween);
        }
        this.lastAccessedMemoryId = memoryId;
        // Process buffer if it gets too long
        if (this.accessBuffer.length >= 10) {
            await this.processAccessBuffer();
            // Keep last few items for continuity
            this.accessBuffer = this.accessBuffer.slice(-3);
        }
    }
    /**
     * Record a transition between two memories
     */
    async recordTransition(fromId, toId, sessionId, timeBetweenMs) {
        await this.pool.queryWithSwag(`INSERT INTO memory_access_transitions (
        from_memory_id, to_memory_id, session_id, time_between_ms, transition_count
      ) VALUES ($1, $2, $3, $4, 1)
      ON CONFLICT (from_memory_id, to_memory_id) DO UPDATE SET
        transition_count = memory_access_transitions.transition_count + 1,
        last_transition_at = NOW(),
        time_between_ms = COALESCE(
          (memory_access_transitions.time_between_ms * memory_access_transitions.transition_count + COALESCE($4, 0)) /
          (memory_access_transitions.transition_count + 1),
          $4
        )`, [fromId, toId, sessionId ?? this.currentSessionId, timeBetweenMs]);
    }
    /**
     * Process access buffer to detect potential hot paths
     */
    async processAccessBuffer() {
        if (this.accessBuffer.length < 3)
            return;
        // Extract sequences of 3+ memories
        const memoryIds = this.accessBuffer.map(a => a.memoryId);
        // Check for existing hot path
        const pathHash = this.computePathHash(memoryIds);
        const existing = await this.getHotPathByHash(pathHash);
        if (existing) {
            // Increment access count
            await this.incrementHotPathAccess(existing.id);
        }
        else {
            // Check if this pattern appears frequently enough to create a hot path
            const frequency = await this.checkPatternFrequency(memoryIds);
            if (frequency >= 3) {
                await this.createHotPath(memoryIds);
            }
        }
    }
    /**
     * Check how often a memory sequence appears in transitions
     * OPTIMIZED: Single batch query instead of N-1 queries
     */
    async checkPatternFrequency(memoryIds) {
        if (memoryIds.length < 2)
            return 0;
        // Build all transition pairs we need to check
        const pairs = [];
        for (let i = 0; i < memoryIds.length - 1; i++) {
            pairs.push([memoryIds[i], memoryIds[i + 1]]);
        }
        // Single batch query for ALL transitions at once
        const allIds = [...new Set(memoryIds)];
        const result = await this.pool.queryWithSwag(`SELECT from_memory_id, to_memory_id, transition_count
       FROM memory_access_transitions
       WHERE from_memory_id = ANY($1) AND to_memory_id = ANY($1)`, [allIds]);
        // Build lookup map for O(1) access
        const transitionMap = new Map(result.rows.map((r) => [`${r.from_memory_id}-${r.to_memory_id}`, r.transition_count]));
        // Find minimum count across all pairs
        let minCount = Infinity;
        for (const [fromId, toId] of pairs) {
            const count = transitionMap.get(`${fromId}-${toId}`) ?? 0;
            if (count < minCount)
                minCount = count;
        }
        return minCount === Infinity ? 0 : minCount;
    }
    // ===========================================================================
    // HOT PATH CRUD
    // ===========================================================================
    /**
     * Create a new hot path
     */
    async createHotPath(memoryIds, name) {
        const pathHash = this.computePathHash(memoryIds);
        // Get dominant tags from the memories
        const tagsResult = await this.pool.queryWithSwag(`SELECT unnest(tags) as tag, COUNT(*) as cnt
       FROM memories
       WHERE id = ANY($1)
       GROUP BY tag
       ORDER BY cnt DESC
       LIMIT 5`, [memoryIds]);
        const dominantTags = tagsResult.rows.map((r) => r.tag);
        const result = await this.pool.queryWithSwag(`INSERT INTO memory_hot_paths (
        path_name, path_hash, memory_ids, memory_count,
        access_count, heat_score, dominant_tags
      ) VALUES ($1, $2, $3, $4, 1, 1.0, $5)
      ON CONFLICT (path_hash) DO UPDATE SET
        access_count = memory_hot_paths.access_count + 1,
        heat_score = memory_hot_paths.heat_score + 0.5,
        last_accessed_at = NOW()
      RETURNING *`, [
            name ?? dominantTags.slice(0, 3).join('-') ?? `path-${Date.now()}`,
            pathHash,
            memoryIds,
            memoryIds.length,
            dominantTags
        ]);
        logger.debug({ pathHash, memoryCount: memoryIds.length }, 'hot path created/updated');
        return this.rowToHotPath(result.rows[0]);
    }
    /**
     * Get hot path by hash
     */
    async getHotPathByHash(hash) {
        const result = await this.pool.queryWithSwag('SELECT * FROM memory_hot_paths WHERE path_hash = $1', [hash]);
        return result.rows[0] ? this.rowToHotPath(result.rows[0]) : null;
    }
    /**
     * Get hot path by ID
     */
    async getHotPath(id) {
        const result = await this.pool.queryWithSwag('SELECT * FROM memory_hot_paths WHERE id = $1', [id]);
        return result.rows[0] ? this.rowToHotPath(result.rows[0]) : null;
    }
    /**
     * List hot paths by heat score
     */
    async listHotPaths(opts) {
        const conditions = [];
        const values = [];
        let paramIndex = 1;
        if (opts?.minHeatScore !== undefined) {
            conditions.push(`heat_score >= $${paramIndex}`);
            values.push(opts.minHeatScore);
            paramIndex++;
        }
        if (opts?.cachedOnly) {
            conditions.push('is_cached = true');
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = opts?.limit ?? 50;
        values.push(limit);
        const result = await this.pool.queryWithSwag(`SELECT * FROM memory_hot_paths ${whereClause}
       ORDER BY heat_score DESC
       LIMIT $${paramIndex}`, values);
        return result.rows.map((row) => this.rowToHotPath(row));
    }
    /**
     * Increment hot path access count and heat
     */
    async incrementHotPathAccess(pathId) {
        await this.pool.queryWithSwag(`UPDATE memory_hot_paths
       SET access_count = access_count + 1,
           heat_score = LEAST(heat_score + 0.5, 100),
           peak_heat_score = GREATEST(peak_heat_score, heat_score + 0.5),
           last_accessed_at = NOW()
       WHERE id = $1`, [pathId]);
    }
    /**
     * Mark a hot path as cached
     */
    async cacheHotPath(pathId) {
        await this.pool.queryWithSwag(`UPDATE memory_hot_paths
       SET is_cached = true, cached_at = NOW()
       WHERE id = $1`, [pathId]);
    }
    /**
     * Increment cache hit count
     */
    async recordCacheHit(pathId) {
        await this.pool.queryWithSwag(`UPDATE memory_hot_paths
       SET cache_hits = cache_hits + 1, last_accessed_at = NOW()
       WHERE id = $1`, [pathId]);
    }
    /**
     * Get memories in a hot path
     * PROJECT ISOLATION: Filters by project_path to ensure only current project's memories are returned
     */
    async getHotPathMemories(pathId) {
        const path = await this.getHotPath(pathId);
        if (!path)
            return [];
        const projectPath = getCurrentProjectPath();
        const result = await this.pool.queryWithSwag(`SELECT * FROM memories WHERE id = ANY($1) AND project_path = $2`, [path.memoryIds, projectPath]);
        // Maintain order from path
        const memoryMap = new Map(result.rows.map((r) => [r.id, r]));
        return path.memoryIds
            .map(id => memoryMap.get(id))
            .filter(Boolean)
            .map((row) => this.rowToMemory(row));
    }
    // ===========================================================================
    // PREDICTION
    // ===========================================================================
    /**
     * Predict next likely memories based on current context
     */
    async predictNextMemories(currentMemoryId, limit = 5) {
        // Get transition probabilities
        const result = await this.pool.queryWithSwag(`SELECT
        mat.to_memory_id,
        mat.transition_count,
        mat.transition_count::FLOAT / (
          SELECT SUM(transition_count)
          FROM memory_access_transitions
          WHERE from_memory_id = $1
        ) as probability
       FROM memory_access_transitions mat
       WHERE mat.from_memory_id = $1
       ORDER BY mat.transition_count DESC
       LIMIT $2`, [currentMemoryId, limit]);
        return result.rows.map((row) => ({
            memoryId: row.to_memory_id,
            probability: parseFloat(row.probability) || 0,
            transitionCount: row.transition_count
        }));
    }
    /**
     * Predict next memories with full memory objects
     * PROJECT ISOLATION: Filters by project_path to ensure only current project's memories are returned
     */
    async predictNextWithDetails(currentMemoryId, limit = 5) {
        const predictions = await this.predictNextMemories(currentMemoryId, limit);
        if (predictions.length === 0)
            return predictions;
        // Fetch memory details
        const projectPath = getCurrentProjectPath();
        const memoryIds = predictions.map(p => p.memoryId);
        const result = await this.pool.queryWithSwag(`SELECT * FROM memories WHERE id = ANY($1) AND project_path = $2`, [memoryIds, projectPath]);
        const memoryMap = new Map(result.rows.map((r) => [r.id, this.rowToMemory(r)]));
        return predictions.map(p => ({
            ...p,
            memory: memoryMap.get(p.memoryId)
        }));
    }
    /**
     * Check if there's a hot path starting from current memory
     */
    async findMatchingHotPaths(startMemoryId) {
        const result = await this.pool.queryWithSwag(`SELECT * FROM memory_hot_paths
       WHERE memory_ids[1] = $1
       ORDER BY heat_score DESC
       LIMIT 5`, [startMemoryId]);
        return result.rows.map((row) => this.rowToHotPath(row));
    }
    /**
     * Check if we're on a known hot path and prefetch remaining memories
     */
    async checkAndPrefetch(currentSequence) {
        if (currentSequence.length < 2)
            return null;
        // Find hot paths that start with our sequence
        const result = await this.pool.queryWithSwag(`SELECT * FROM memory_hot_paths
       WHERE memory_ids[1:$2] = $1::uuid[]
       AND array_length(memory_ids, 1) > $2
       ORDER BY heat_score DESC
       LIMIT 1`, [currentSequence, currentSequence.length]);
        if (result.rows.length === 0)
            return null;
        const path = this.rowToHotPath(result.rows[0]);
        // Get the remaining memories to prefetch
        // PROJECT ISOLATION: Filter by project_path
        const projectPath = getCurrentProjectPath();
        const remainingIds = path.memoryIds.slice(currentSequence.length);
        const memoriesResult = await this.pool.queryWithSwag(`SELECT * FROM memories WHERE id = ANY($1) AND project_path = $2`, [remainingIds, projectPath]);
        // Record cache hit
        await this.recordCacheHit(path.id);
        return memoriesResult.rows.map((row) => this.rowToMemory(row));
    }
    // ===========================================================================
    // MAINTENANCE
    // ===========================================================================
    /**
     * Decay heat scores for all hot paths
     */
    async decayHeatScores() {
        const result = await this.pool.queryWithSwag(`SELECT decay_hot_path_heat() as count`);
        const count = result.rows[0]?.count ?? 0;
        logger.info({ decayed: count }, 'heat scores decayed');
        return count;
    }
    /**
     * Remove cold paths (very low heat score)
     */
    async pruneColdPaths(minHeatScore = 0.01) {
        const result = await this.pool.queryWithSwag(`DELETE FROM memory_hot_paths WHERE heat_score < $1 RETURNING id`, [minHeatScore]);
        logger.info({ pruned: result.rows.length }, 'cold paths pruned');
        return result.rows.length;
    }
    /**
     * Identify paths that should be cached based on access patterns
     */
    async identifyPathsToCache(limit = 10) {
        const result = await this.pool.queryWithSwag(`SELECT * FROM memory_hot_paths
       WHERE is_cached = false
       AND heat_score > 2.0
       AND access_count >= 5
       ORDER BY heat_score DESC
       LIMIT $1`, [limit]);
        return result.rows.map((row) => this.rowToHotPath(row));
    }
    /**
     * Get transition statistics
     */
    async getTransitionStats() {
        const result = await this.pool.queryWithSwag(`
      SELECT
        (SELECT COUNT(*) FROM memory_access_transitions) as total_count,
        (SELECT COUNT(DISTINCT (from_memory_id, to_memory_id)) FROM memory_access_transitions) as unique_pairs,
        (SELECT AVG(transition_count) FROM memory_access_transitions) as avg_per_pair
    `);
        const topResult = await this.pool.queryWithSwag(`SELECT from_memory_id, to_memory_id, transition_count
       FROM memory_access_transitions
       ORDER BY transition_count DESC
       LIMIT 10`);
        const row = result.rows[0];
        return {
            totalTransitions: parseInt(row.total_count, 10),
            uniquePairs: parseInt(row.unique_pairs, 10),
            avgTransitionsPerPair: parseFloat(row.avg_per_pair) || 0,
            topTransitions: topResult.rows.map((r) => ({
                fromId: r.from_memory_id,
                toId: r.to_memory_id,
                count: r.transition_count
            }))
        };
    }
    /**
     * Get hot path statistics
     */
    async getHotPathStats() {
        const result = await this.pool.queryWithSwag(`
      SELECT
        COUNT(*) as total_paths,
        COUNT(*) FILTER (WHERE is_cached = true) as cached_paths,
        AVG(heat_score) as avg_heat,
        AVG(memory_count) as avg_length,
        SUM(cache_hits) as total_cache_hits
      FROM memory_hot_paths
    `);
        const row = result.rows[0];
        return {
            totalPaths: parseInt(row.total_paths, 10),
            cachedPaths: parseInt(row.cached_paths, 10),
            avgHeatScore: parseFloat(row.avg_heat) || 0,
            avgPathLength: parseFloat(row.avg_length) || 0,
            totalCacheHits: parseInt(row.total_cache_hits, 10) || 0
        };
    }
    // ===========================================================================
    // HELPERS
    // ===========================================================================
    computePathHash(memoryIds) {
        return createHash('sha256')
            .update(memoryIds.join('|'))
            .digest('hex');
    }
    rowToHotPath(row) {
        return {
            id: row.id,
            pathName: row.path_name,
            pathHash: row.path_hash,
            memoryIds: row.memory_ids ?? [],
            memoryCount: row.memory_count,
            accessCount: row.access_count,
            lastAccessedAt: row.last_accessed_at,
            firstAccessedAt: row.first_accessed_at,
            heatScore: parseFloat(row.heat_score),
            peakHeatScore: parseFloat(row.peak_heat_score),
            isCached: row.is_cached,
            cachedAt: row.cached_at,
            cacheHits: row.cache_hits,
            avgTransitionSimilarity: row.avg_transition_similarity,
            pathCoherence: row.path_coherence,
            dominantTags: row.dominant_tags ?? [],
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
}
// Per-project instance management (Map pattern for project isolation)
const hotPathManagersByProject = new Map();
export function getHotPathManager(pool, projectPath) {
    const targetProject = projectPath || getCurrentProjectPath();
    if (!hotPathManagersByProject.has(targetProject) && !pool) {
        throw new Error('hot path manager not initialized for project ' + targetProject + ' - pass pool first');
    }
    if (!hotPathManagersByProject.has(targetProject) && pool) {
        hotPathManagersByProject.set(targetProject, new HotPathManager(pool));
    }
    return hotPathManagersByProject.get(targetProject);
}
export function resetHotPathManager(projectPath) {
    if (projectPath) {
        hotPathManagersByProject.delete(projectPath);
    }
    else {
        const targetProject = getCurrentProjectPath();
        hotPathManagersByProject.delete(targetProject);
    }
}
export function resetAllHotPathManagers() {
    hotPathManagersByProject.clear();
}
//# sourceMappingURL=hotPathManager.js.map