import { v4 as uuidv4 } from 'uuid';
import { SemanticSearchEngine } from './search.js';
import { logger } from './utils/logger.js';
import { loadConfig } from './config.js';
import { getDimensionService } from './services/DimensionService.js';
import { getProjectPathForInsert } from './services/ProjectContext.js';
function getConsolidationLimits() {
    const config = loadConfig();
    return {
        similarityQueryLimit: config.consolidation.similarityQueryLimit,
        temporalQueryLimit: config.consolidation.temporalQueryLimit,
        tagBasedQueryLimit: config.consolidation.tagBasedQueryLimit,
        importanceQueryLimit: config.consolidation.importanceQueryLimit
    };
}
/**
 * Intelligent memory consolidation engine that identifies related memories
 * and merges them into more coherent, deduplicated knowledge representations.
 *
 * Uses multiple strategies:
 * - Similarity: Vector-based clustering of semantically related content
 * - Temporal: Groups memories created within time windows
 * - Tag-based: Consolidates memories sharing significant tag overlap
 * - Importance: Prioritizes high-value memories in consolidation
 */
export class ConsolidationEngine {
    db;
    searchEngine;
    dimensionService = null;
    constructor(db) {
        this.db = db;
        this.searchEngine = new SemanticSearchEngine(db);
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
     * Prepare embedding for database storage - projects to target dimension if needed.
     */
    async prepareEmbeddingForStorage(embedding, originalText) {
        if (!embedding || embedding.length === 0)
            return null;
        const dimService = this.getDimService();
        if (!dimService) {
            return `[${embedding.join(',')}]`;
        }
        try {
            const prepared = await dimService.validateAndPrepare('memories', embedding, originalText);
            if (prepared.wasModified) {
                logger.debug({
                    action: prepared.action,
                    originalDim: embedding.length,
                    newDim: prepared.embedding.length
                }, 'Projected consolidated embedding to target dimension');
            }
            return `[${prepared.embedding.join(',')}]`;
        }
        catch (error) {
            logger.warn({ error }, 'Failed to prepare embedding, using original');
            return `[${embedding.join(',')}]`;
        }
    }
    async consolidate(params) {
        const start = Date.now();
        logger.info({ strategy: params.strategy, dryRun: params.dryRun }, 'Starting consolidation');
        let clusters;
        switch (params.strategy) {
            case 'similarity':
                clusters = await this.findSimilarityClusters(params);
                break;
            case 'temporal':
                clusters = await this.findTemporalClusters(params);
                break;
            case 'tag_based':
                clusters = await this.findTagBasedClusters(params);
                break;
            case 'importance':
                clusters = await this.findImportanceClusters(params);
                break;
            default:
                clusters = await this.findSimilarityClusters(params);
        }
        const results = [];
        for (const cluster of clusters) {
            if (cluster.members.length < 2)
                continue;
            const result = await this.processCluster(cluster, params.dryRun);
            results.push(result);
        }
        const duration = Date.now() - start;
        logger.info({ duration, clustersFound: clusters.length, consolidated: results.filter(r => r.wasExecuted).length }, 'Consolidation completed');
        return results;
    }
    async findSimilarityClusters(params) {
        const limits = getConsolidationLimits();
        const typeFilter = params.memoryTypes?.length
            ? `AND memory_type = ANY($1::memory_type[])`
            : '';
        const query = `
      SELECT id, content, memory_type, importance, tags, metadata, embedding,
             created_at, updated_at, access_count
      FROM memories
      WHERE embedding IS NOT NULL
        AND (expires_at IS NULL OR expires_at > NOW())
        AND memory_type != 'consolidated'
        ${typeFilter}
      ORDER BY created_at DESC
      LIMIT $${params.memoryTypes?.length ? 2 : 1}
    `;
        const queryParams = params.memoryTypes?.length
            ? [params.memoryTypes, limits.similarityQueryLimit]
            : [limits.similarityQueryLimit];
        const result = await this.db.query(query, queryParams);
        const memories = result.rows.map((row) => this.rowToMemory(row));
        return this.clusterByEmbedding(memories, params.threshold, params.maxMemories);
    }
    async findTemporalClusters(params) {
        const limits = getConsolidationLimits();
        const windowHours = 24;
        const query = `
      WITH time_buckets AS (
        SELECT
          id, content, memory_type, importance, tags, metadata, embedding,
          created_at, updated_at, access_count,
          date_trunc('day', created_at) AS bucket
        FROM memories
        WHERE (expires_at IS NULL OR expires_at > NOW())
          AND memory_type != 'consolidated'
          AND embedding IS NOT NULL
        ORDER BY created_at DESC
        LIMIT $1
      )
      SELECT * FROM time_buckets
    `;
        const result = await this.db.query(query, [limits.temporalQueryLimit]);
        const buckets = new Map();
        for (const row of result.rows) {
            const bucketKey = row.bucket.toISOString();
            if (!buckets.has(bucketKey)) {
                buckets.set(bucketKey, []);
            }
            buckets.get(bucketKey).push(this.rowToMemory(row));
        }
        const clusters = [];
        for (const [_, memories] of buckets) {
            if (memories.length < 2)
                continue;
            const subClusters = await this.clusterByEmbedding(memories, params.threshold, params.maxMemories);
            clusters.push(...subClusters);
        }
        return clusters;
    }
    async findTagBasedClusters(params) {
        const limits = getConsolidationLimits();
        const query = `
      WITH tag_groups AS (
        SELECT unnest(tags) AS tag, array_agg(id) AS memory_ids
        FROM memories
        WHERE (expires_at IS NULL OR expires_at > NOW())
          AND memory_type != 'consolidated'
          AND array_length(tags, 1) > 0
        GROUP BY unnest(tags)
        HAVING count(*) >= 2
        ORDER BY count(*) DESC
        LIMIT $1
      )
      SELECT DISTINCT m.id, m.content, m.memory_type, m.importance, m.tags,
             m.metadata, m.embedding, m.created_at, m.updated_at, m.access_count
      FROM tag_groups tg
      JOIN memories m ON m.id = ANY(tg.memory_ids)
      WHERE m.embedding IS NOT NULL
    `;
        const result = await this.db.query(query, [limits.tagBasedQueryLimit]);
        const memories = result.rows.map((row) => this.rowToMemory(row));
        return this.clusterByTagOverlap(memories, 0.5, params.maxMemories);
    }
    async findImportanceClusters(params) {
        const limits = getConsolidationLimits();
        const query = `
      SELECT id, content, memory_type, importance, tags, metadata, embedding,
             created_at, updated_at, access_count
      FROM memories
      WHERE embedding IS NOT NULL
        AND (expires_at IS NULL OR expires_at > NOW())
        AND memory_type != 'consolidated'
        AND importance IN ('critical', 'high')
      ORDER BY
        CASE importance
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
        END,
        access_count DESC
      LIMIT $1
    `;
        const result = await this.db.query(query, [limits.importanceQueryLimit]);
        const memories = result.rows.map((row) => this.rowToMemory(row));
        return this.clusterByEmbedding(memories, params.threshold, params.maxMemories);
    }
    async clusterByEmbedding(memories, threshold, maxClusterSize) {
        if (memories.length === 0)
            return [];
        const clusters = [];
        const assigned = new Set();
        for (const memory of memories) {
            if (assigned.has(memory.id) || !memory.embedding)
                continue;
            const cluster = [memory];
            assigned.add(memory.id);
            for (const candidate of memories) {
                if (assigned.has(candidate.id) || !candidate.embedding)
                    continue;
                if (cluster.length >= maxClusterSize)
                    break;
                const similarity = this.cosineSimilarity(memory.embedding, candidate.embedding);
                if (similarity >= threshold) {
                    cluster.push(candidate);
                    assigned.add(candidate.id);
                }
            }
            if (cluster.length >= 2) {
                clusters.push({
                    centroid: memory,
                    members: cluster,
                    averageSimilarity: this.calculateAverageSimilarity(cluster)
                });
            }
        }
        return clusters;
    }
    clusterByTagOverlap(memories, overlapThreshold, maxClusterSize) {
        const clusters = [];
        const assigned = new Set();
        for (const memory of memories) {
            if (assigned.has(memory.id) || memory.tags.length === 0)
                continue;
            const cluster = [memory];
            assigned.add(memory.id);
            for (const candidate of memories) {
                if (assigned.has(candidate.id) || candidate.tags.length === 0)
                    continue;
                if (cluster.length >= maxClusterSize)
                    break;
                const overlap = this.tagOverlap(memory.tags, candidate.tags);
                if (overlap >= overlapThreshold) {
                    cluster.push(candidate);
                    assigned.add(candidate.id);
                }
            }
            if (cluster.length >= 2) {
                clusters.push({
                    centroid: memory,
                    members: cluster,
                    averageSimilarity: this.calculateAverageSimilarity(cluster)
                });
            }
        }
        return clusters;
    }
    async processCluster(cluster, dryRun) {
        const sourceIds = cluster.members.map(m => m.id);
        const similarityScores = cluster.members.map(m => {
            if (!m.embedding || !cluster.centroid.embedding)
                return 0;
            return this.cosineSimilarity(m.embedding, cluster.centroid.embedding);
        });
        if (dryRun) {
            return {
                consolidatedMemory: null,
                sourceMemoryIds: sourceIds,
                similarityScores,
                wasExecuted: false
            };
        }
        const consolidatedContent = this.mergeContent(cluster.members);
        const consolidatedTags = this.mergeTags(cluster.members);
        const consolidatedImportance = this.mergeImportance(cluster.members);
        const consolidatedEmbedding = this.averageEmbeddings(cluster.members.filter(m => m.embedding).map(m => m.embedding));
        const id = uuidv4();
        // Prepare embedding with dimension projection
        const embeddingStr = await this.prepareEmbeddingForStorage(consolidatedEmbedding, consolidatedContent);
        // PROJECT ISOLATED: Get fresh project path at call time
        const projectPath = getProjectPathForInsert();
        await this.db.transaction(async (client) => {
            await client.query(`INSERT INTO memories (id, content, memory_type, importance, tags, metadata, embedding, consolidated_from, project_path)
         VALUES ($1, $2, 'consolidated', $3, $4, $5, $6, $7, $8)`, [
                id,
                consolidatedContent,
                consolidatedImportance,
                consolidatedTags,
                { sourceCount: cluster.members.length, averageSimilarity: cluster.averageSimilarity },
                embeddingStr,
                sourceIds,
                projectPath
            ]);
            // PROJECT ISOLATED: Only expire memories in current project
            await client.query(`UPDATE memories SET expires_at = NOW() WHERE id = ANY($1) AND project_path = $2`, [sourceIds, projectPath]);
        });
        const consolidatedMemory = {
            id,
            content: consolidatedContent,
            memoryType: 'consolidated',
            importance: consolidatedImportance,
            tags: consolidatedTags,
            metadata: { sourceCount: cluster.members.length },
            embedding: consolidatedEmbedding,
            createdAt: new Date(),
            updatedAt: new Date(),
            accessCount: 0,
            consolidatedFrom: sourceIds
        };
        return {
            consolidatedMemory,
            sourceMemoryIds: sourceIds,
            similarityScores,
            wasExecuted: true
        };
    }
    mergeContent(memories) {
        const uniqueSentences = new Set();
        for (const memory of memories) {
            const sentences = memory.content.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
            sentences.forEach(s => uniqueSentences.add(s));
        }
        return Array.from(uniqueSentences).join('. ') + '.';
    }
    mergeTags(memories) {
        const tagCounts = new Map();
        for (const memory of memories) {
            for (const tag of memory.tags) {
                tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
            }
        }
        return Array.from(tagCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([tag]) => tag);
    }
    mergeImportance(memories) {
        const order = ['critical', 'high', 'medium', 'low', 'trivial'];
        let highestIndex = order.length - 1;
        for (const memory of memories) {
            const index = order.indexOf(memory.importance);
            if (index < highestIndex) {
                highestIndex = index;
            }
        }
        return order[highestIndex] ?? 'medium';
    }
    averageEmbeddings(embeddings) {
        if (embeddings.length === 0)
            return undefined;
        const dimensions = embeddings[0]?.length ?? 0;
        if (dimensions === 0)
            return undefined;
        const result = new Array(dimensions).fill(0);
        for (const embedding of embeddings) {
            for (let i = 0; i < dimensions; i++) {
                result[i] += embedding[i] ?? 0;
            }
        }
        for (let i = 0; i < dimensions; i++) {
            result[i] /= embeddings.length;
        }
        const magnitude = Math.sqrt(result.reduce((sum, val) => sum + val * val, 0));
        if (magnitude > 0) {
            for (let i = 0; i < dimensions; i++) {
                result[i] /= magnitude;
            }
        }
        return result;
    }
    cosineSimilarity(a, b) {
        if (a.length !== b.length)
            return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += (a[i] ?? 0) * (b[i] ?? 0);
            normA += (a[i] ?? 0) ** 2;
            normB += (b[i] ?? 0) ** 2;
        }
        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator === 0 ? 0 : dotProduct / denominator;
    }
    calculateAverageSimilarity(memories) {
        if (memories.length < 2)
            return 1;
        let totalSimilarity = 0;
        let comparisons = 0;
        for (let i = 0; i < memories.length; i++) {
            for (let j = i + 1; j < memories.length; j++) {
                const m1 = memories[i];
                const m2 = memories[j];
                if (m1?.embedding && m2?.embedding) {
                    totalSimilarity += this.cosineSimilarity(m1.embedding, m2.embedding);
                    comparisons++;
                }
            }
        }
        return comparisons === 0 ? 0 : totalSimilarity / comparisons;
    }
    tagOverlap(tags1, tags2) {
        const set1 = new Set(tags1);
        const set2 = new Set(tags2);
        const intersection = new Set([...set1].filter(t => set2.has(t)));
        const union = new Set([...set1, ...set2]);
        return union.size === 0 ? 0 : intersection.size / union.size;
    }
    rowToMemory(row) {
        return {
            id: row.id,
            content: row.content,
            memoryType: row.memory_type,
            importance: row.importance,
            tags: row.tags,
            metadata: row.metadata,
            embedding: row.embedding ? this.parseEmbedding(row.embedding) : undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            accessCount: row.access_count
        };
    }
    parseEmbedding(embeddingStr) {
        const cleaned = embeddingStr.replace(/[\[\]]/g, '');
        return cleaned.split(',').map(Number);
    }
}
//# sourceMappingURL=consolidation.js.map