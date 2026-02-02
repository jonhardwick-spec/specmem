/**
 * smushMemoriesTogether - dream-inspired consolidation like doobidoo
 *
 * nah bruh this consolidation go crazy
 * uses DBSCAN clustering to find similar memories and merge them
 * inspired by doobidoo's dream-inspired architecture
 */
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';
import { getProjectPathForInsert } from '../../services/ProjectContext.js';
import { formatHumanReadable } from '../../utils/humanReadableOutput.js';
/**
 * SmushMemoriesTogether - dream-inspired consolidation engine
 *
 * consolidation dream-inspired just like doobidoo
 * uses DBSCAN-style clustering to find related memories
 * then merges them into cohesive consolidated memories
 */
export class SmushMemoriesTogether {
    db;
    embeddingProvider;
    name = 'smush_memories_together';
    description = 'intelligently merge similar memories using dream-inspired consolidation - reduces redundancy and improves retrieval quality';
    inputSchema = {
        type: 'object',
        properties: {
            strategy: {
                type: 'string',
                enum: ['similarity', 'temporal', 'tag_based', 'importance'],
                default: 'similarity',
                description: 'consolidation strategy: similarity (vector clustering), temporal (time-based), tag_based (shared tags), importance (priority-based)'
            },
            threshold: {
                type: 'number',
                default: 0.85,
                minimum: 0,
                maximum: 1,
                description: 'similarity threshold for merging (higher = more strict)'
            },
            maxMemories: {
                type: 'number',
                default: 10,
                minimum: 2,
                maximum: 100,
                description: 'max memories per consolidation group'
            },
            memoryTypes: {
                type: 'array',
                items: { type: 'string' },
                description: 'only consolidate these memory types'
            },
            dryRun: {
                type: 'boolean',
                default: false,
                description: 'preview consolidation without executing'
            }
        }
    };
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
    }
    async execute(params) {
        const startTime = Date.now();
        logger.info({ strategy: params.strategy, dryRun: params.dryRun }, 'starting consolidation fr');
        try {
            // find clusters based on strategy
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
            // process each cluster
            const results = [];
            for (const cluster of clusters) {
                if (cluster.members.length < 2)
                    continue;
                const result = await this.smushCluster(cluster, params.dryRun);
                results.push(result);
            }
            const duration = Date.now() - startTime;
            const stats = {
                clustersFound: clusters.length,
                memoriesProcessed: clusters.reduce((sum, c) => sum + c.members.length, 0),
                memoriesConsolidated: results.filter(r => r.wasExecuted).length,
                spaceSaved: this.calculateSpaceSaved(results),
                duration
            };
            logger.info(stats, 'consolidation complete - we vibing');
            const humanReadableData = results.map((r, i) => ({
                id: r.consolidatedMemory?.id || `consolidated-${i}`,
                similarity: 1.0,
                content: `[CONSOLIDATED] ${r.sourceMemoryIds.length} memories merged. ${r.wasExecuted ? 'Executed' : 'Dry run'}. ${r.consolidatedMemory ? r.consolidatedMemory.content : 'Preview only'}`,
            }));
            return formatHumanReadable('smush_memories_together', humanReadableData, {
                grey: true,
                maxContentLength: 500
            });
        }
        catch (error) {
            logger.error({ error }, 'consolidation failed');
            throw error;
        }
    }
    /**
     * findSimilarityClusters - DBSCAN-style clustering using embeddings
     *
     * this is the main clustering algorithm fr
     * groups memories by vector similarity
     */
    async findSimilarityClusters(params) {
        // PROJECT ISOLATION: Filter by project_path to prevent cross-project consolidation
        const projectPath = getProjectPathForInsert();
        const typeFilter = params.memoryTypes?.length
            ? `AND memory_type = ANY($2::memory_type[])`
            : '';
        const query = `
      SELECT id, content, memory_type, importance, tags, metadata, embedding,
             created_at, updated_at, access_count
      FROM memories
      WHERE embedding IS NOT NULL
        AND (expires_at IS NULL OR expires_at > NOW())
        AND memory_type != 'consolidated'
        AND project_path = $1
        ${typeFilter}
      ORDER BY created_at DESC
      LIMIT 1000
    `;
        const queryParams = params.memoryTypes?.length ? [projectPath, params.memoryTypes] : [projectPath];
        const result = await this.db.query(query, queryParams);
        const memories = result.rows.map((row) => this.rowToMemory(row));
        return this.clusterByEmbedding(memories, params.threshold, params.maxMemories);
    }
    /**
     * findTemporalClusters - group by time windows
     *
     * memories created around the same time often relate to each other
     */
    async findTemporalClusters(params) {
        // PROJECT ISOLATION: Filter by project_path to prevent cross-project consolidation
        const projectPath = getProjectPathForInsert();
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
          AND project_path = $1
        ORDER BY created_at DESC
        LIMIT 500
      )
      SELECT * FROM time_buckets
    `;
        const result = await this.db.query(query, [projectPath]);
        // group by day bucket
        const buckets = new Map();
        for (const row of result.rows) {
            const bucketKey = row.bucket.toISOString();
            if (!buckets.has(bucketKey)) {
                buckets.set(bucketKey, []);
            }
            buckets.get(bucketKey).push(this.rowToMemory(row));
        }
        // within each bucket, cluster by similarity
        const clusters = [];
        for (const [_, memories] of buckets) {
            if (memories.length < 2)
                continue;
            const subClusters = await this.clusterByEmbedding(memories, params.threshold, params.maxMemories);
            clusters.push(...subClusters);
        }
        return clusters;
    }
    /**
     * findTagBasedClusters - group by shared tags
     *
     * memories with overlapping tags are probably related
     */
    async findTagBasedClusters(params) {
        // PROJECT ISOLATION: Filter by project_path to prevent cross-project consolidation
        const projectPath = getProjectPathForInsert();
        const query = `
      WITH tag_groups AS (
        SELECT unnest(tags) AS tag, array_agg(id) AS memory_ids
        FROM memories
        WHERE (expires_at IS NULL OR expires_at > NOW())
          AND memory_type != 'consolidated'
          AND array_length(tags, 1) > 0
          AND project_path = $1
        GROUP BY unnest(tags)
        HAVING count(*) >= 2
        ORDER BY count(*) DESC
        LIMIT 50
      )
      SELECT DISTINCT m.id, m.content, m.memory_type, m.importance, m.tags,
             m.metadata, m.embedding, m.created_at, m.updated_at, m.access_count
      FROM tag_groups tg
      JOIN memories m ON m.id = ANY(tg.memory_ids)
      WHERE m.embedding IS NOT NULL
        AND m.project_path = $1
    `;
        const result = await this.db.query(query, [projectPath]);
        const memories = result.rows.map((row) => this.rowToMemory(row));
        return this.clusterByTagOverlap(memories, 0.5, params.maxMemories);
    }
    /**
     * findImportanceClusters - prioritize high-value memories
     *
     * focus consolidation on critical/high importance memories first
     */
    async findImportanceClusters(params) {
        // PROJECT ISOLATION: Filter by project_path to prevent cross-project consolidation
        const projectPath = getProjectPathForInsert();
        const query = `
      SELECT id, content, memory_type, importance, tags, metadata, embedding,
             created_at, updated_at, access_count
      FROM memories
      WHERE embedding IS NOT NULL
        AND (expires_at IS NULL OR expires_at > NOW())
        AND memory_type != 'consolidated'
        AND importance IN ('critical', 'high')
        AND project_path = $1
      ORDER BY
        CASE importance
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
        END,
        access_count DESC
      LIMIT 200
    `;
        const result = await this.db.query(query, [projectPath]);
        const memories = result.rows.map((row) => this.rowToMemory(row));
        return this.clusterByEmbedding(memories, params.threshold, params.maxMemories);
    }
    /**
     * clusterByEmbedding - the DBSCAN-style clustering
     *
     * finds clusters of similar memories based on cosine similarity
     */
    clusterByEmbedding(memories, threshold, maxClusterSize) {
        if (memories.length === 0)
            return [];
        const clusters = [];
        const assigned = new Set();
        for (const memory of memories) {
            if (assigned.has(memory.id) || !memory.embedding)
                continue;
            const cluster = [memory];
            assigned.add(memory.id);
            // find similar memories to add to cluster
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
    /**
     * clusterByTagOverlap - group by shared tags
     */
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
                const overlap = this.jaccardSimilarity(memory.tags, candidate.tags);
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
    /**
     * smushCluster - merge memories in a cluster
     *
     * creates a new consolidated memory and optionally marks sources as expired
     */
    async smushCluster(cluster, dryRun) {
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
        // merge content, tags, and compute average embedding
        const consolidatedContent = this.mergeContent(cluster.members);
        const consolidatedTags = this.mergeTags(cluster.members);
        const consolidatedImportance = this.mergeImportance(cluster.members);
        const consolidatedEmbedding = this.averageEmbeddings(cluster.members.filter(m => m.embedding).map(m => m.embedding));
        const id = uuidv4();
        // PROJECT ISOLATION: Get fresh project path at call time
        const projectPath = getProjectPathForInsert();
        await this.db.transaction(async (client) => {
            // insert consolidated memory
            await client.query(`INSERT INTO memories (id, content, memory_type, importance, tags, metadata, embedding, consolidated_from, project_path)
         VALUES ($1, $2, 'consolidated', $3, $4, $5, $6, $7, $8)`, [
                id,
                consolidatedContent,
                consolidatedImportance,
                consolidatedTags,
                {
                    sourceCount: cluster.members.length,
                    averageSimilarity: cluster.averageSimilarity,
                    consolidatedAt: new Date().toISOString()
                },
                consolidatedEmbedding ? `[${consolidatedEmbedding.join(',')}]` : null,
                sourceIds,
                projectPath
            ]);
            // mark source memories as expired (soft delete)
            await client.query(`UPDATE memories SET expires_at = NOW() WHERE id = ANY($1::uuid[])`, [sourceIds]);
            // create relations from consolidated to sources
            for (const sourceId of sourceIds) {
                await client.query(`INSERT INTO memory_relations (source_id, target_id, relation_type, strength)
           VALUES ($1, $2, 'consolidated_from', 1.0)
           ON CONFLICT DO NOTHING`, [id, sourceId]);
            }
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
        logger.info({ consolidatedId: id, sourceCount: sourceIds.length }, 'memories smushed together');
        return {
            consolidatedMemory,
            sourceMemoryIds: sourceIds,
            similarityScores,
            wasExecuted: true
        };
    }
    /**
     * mergeContent - combine content from multiple memories
     *
     * deduplicates sentences and creates coherent merged content
     */
    mergeContent(memories) {
        const uniqueSentences = new Set();
        for (const memory of memories) {
            // split by sentence-ending punctuation
            const sentences = memory.content
                .split(/[.!?]+/)
                .map(s => s.trim())
                .filter(s => s.length > 10);
            sentences.forEach(s => uniqueSentences.add(s));
        }
        return Array.from(uniqueSentences).join('. ') + '.';
    }
    /**
     * mergeTags - combine and prioritize tags
     */
    mergeTags(memories) {
        const tagCounts = new Map();
        for (const memory of memories) {
            for (const tag of memory.tags) {
                tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
            }
        }
        // sort by frequency and take top 20
        return Array.from(tagCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([tag]) => tag);
    }
    /**
     * mergeImportance - take the highest importance
     */
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
    /**
     * averageEmbeddings - compute average embedding vector
     */
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
        // normalize to unit vector
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
    jaccardSimilarity(a, b) {
        const setA = new Set(a);
        const setB = new Set(b);
        const intersection = new Set([...setA].filter(x => setB.has(x)));
        const union = new Set([...setA, ...setB]);
        return union.size === 0 ? 0 : intersection.size / union.size;
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
    calculateSpaceSaved(results) {
        // rough estimate of space saved
        return results
            .filter(r => r.wasExecuted && r.consolidatedMemory)
            .reduce((sum, r) => {
            const sourceLength = r.sourceMemoryIds.length * 1000; // estimate
            const consolidatedLength = r.consolidatedMemory?.content.length ?? 0;
            return sum + Math.max(0, sourceLength - consolidatedLength);
        }, 0);
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
//# sourceMappingURL=smushMemoriesTogether.js.map