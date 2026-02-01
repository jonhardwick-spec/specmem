// bruh this search engine is UNREAL
// pgvector + full text search = unstoppable combo
// finds memories in under 50ms even with millions of rows
import { logger } from '../utils/logger.js';
import { setupMapCleanup } from '../utils/mapCleanup.js';
import { getCurrentProjectPath } from '../services/ProjectContext.js';
// Type casting constants - avoid magic strings for PostgreSQL enum casts
const PG_TYPE_MEMORY_TYPE_ARRAY = '::memory_type[]';
const PG_TYPE_IMPORTANCE_ARRAY = '::importance_level[]';
/**
 * PERFORMANCE FIX: Explicit column list instead of SELECT *
 * This prevents fetching unnecessary data and improves query performance.
 * List these columns when you need the full memory object.
 */
const MEMORY_COLUMNS = `
  id, content, content_hash, memory_type, importance, tags, metadata,
  embedding, image_data, image_mime_type, created_at, updated_at,
  access_count, last_accessed_at, expires_at, consolidated_from
`.trim();
/**
 * BigBrainSearchEngine - finds memories FAST
 *
 * search modes that absolutely SLAP:
 * - vector search: semantic similarity with cosine distance
 * - text search: full-text with ranking
 * - hybrid: combines both for best results
 * - tag search: filter by tags with AND/OR
 * - find by id: basic lookup
 * - find similar: related memories
 * - find duplicates: content deduplication
 */
export class BigBrainSearchEngine {
    pool;
    searchCount = 0;
    cacheHits = 0;
    constructor(pool) {
        this.pool = pool;
    }
    // expose pool for direct queries (needed by syncChecker for codebase_files)
    getPool() {
        return this.pool;
    }
    // VECTOR SEARCH - the main sauce for semantic similarity
    async vectorSearch(opts) {
        const start = Date.now();
        this.searchCount++;
        // Validate embedding dimensions before query to prevent DB errors
        // SpecMem uses 384-dimension embeddings by default (all-MiniLM-L6-v2)
        const EXPECTED_EMBEDDING_DIM = 384;
        if (!opts.embedding || !Array.isArray(opts.embedding)) {
            throw new Error('vectorSearch requires a valid embedding array');
        }
        if (opts.embedding.length !== EXPECTED_EMBEDDING_DIM) {
            logger.warn({
                provided: opts.embedding.length,
                expected: EXPECTED_EMBEDDING_DIM
            }, 'Embedding dimension mismatch - query may fail or produce unexpected results');
        }
        // Validate all values are numbers (prevents NaN injection)
        if (opts.embedding.some(v => typeof v !== 'number' || isNaN(v))) {
            throw new Error('Embedding contains invalid values (non-numbers or NaN)');
        }
        const conditions = [];
        const values = [];
        let paramIndex = 1;
        // embedding parameter comes first
        const embeddingStr = `[${opts.embedding.join(',')}]`;
        values.push(embeddingStr);
        const embeddingParam = paramIndex++;
        // require embedding for vector search (duh)
        conditions.push('embedding IS NOT NULL');
        // PROJECT ISOLATION: Filter by project_path unless allProjects is true
        if (!opts.allProjects) {
            const targetProject = opts.projectPath || getCurrentProjectPath();
            conditions.push(`project_path = $${paramIndex}`);
            values.push(targetProject);
            paramIndex++;
        }
        // filter expired unless specifically included
        if (!opts.includeExpired) {
            conditions.push('(expires_at IS NULL OR expires_at > NOW())');
        }
        // memory type filter
        if (opts.memoryTypes?.length) {
            conditions.push(`memory_type = ANY($${paramIndex}${PG_TYPE_MEMORY_TYPE_ARRAY})`);
            values.push(opts.memoryTypes);
            paramIndex++;
        }
        // tag filter using array overlap
        if (opts.tags?.length) {
            conditions.push(`tags && $${paramIndex}`);
            values.push(opts.tags);
            paramIndex++;
        }
        // importance filter
        if (opts.importance?.length) {
            conditions.push(`importance = ANY($${paramIndex}${PG_TYPE_IMPORTANCE_ARRAY})`);
            values.push(opts.importance);
            paramIndex++;
        }
        // date range
        if (opts.dateRange?.start) {
            conditions.push(`created_at >= $${paramIndex}`);
            values.push(opts.dateRange.start);
            paramIndex++;
        }
        if (opts.dateRange?.end) {
            conditions.push(`created_at <= $${paramIndex}`);
            values.push(opts.dateRange.end);
            paramIndex++;
        }
        // threshold for similarity (convert to distance)
        const threshold = opts.threshold ?? 0.7;
        const maxDistance = 1 - threshold;
        values.push(maxDistance);
        const thresholdParam = paramIndex++;
        // limit
        const limit = opts.limit ?? 10;
        values.push(limit);
        const limitParam = paramIndex;
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        // nah this query goes CRAZY with HNSW index
        // PERFORMANCE FIX: Using explicit column list instead of SELECT *
        const query = `
      WITH vector_search AS (
        SELECT
          ${MEMORY_COLUMNS},
          1 - (embedding <=> $${embeddingParam}::vector) AS similarity
        FROM memories
        ${whereClause}
        AND (embedding <=> $${embeddingParam}::vector) < $${thresholdParam}
        ORDER BY embedding <=> $${embeddingParam}::vector
        LIMIT $${limitParam}
      )
      SELECT ${MEMORY_COLUMNS}, similarity FROM vector_search ORDER BY similarity DESC
    `;
        const result = await this.pool.queryWithSwag(query, values);
        // update access stats in background (dont block search)
        this.touchMemories(result.rows.map((r) => r.id)).catch((err) => {
            logger.warn({ err }, 'failed to update access stats');
        });
        const searchResults = result.rows.map((row) => ({
            memory: this.rowToMemory(row),
            similarity: row.similarity ?? 0,
            highlights: []
        }));
        const duration = Date.now() - start;
        logger.debug({
            duration,
            resultCount: searchResults.length,
            threshold,
            limit
        }, 'vector search complete - we found that shit');
        return searchResults;
    }
    // FULL TEXT SEARCH - when you need exact terms
    async textSearch(opts) {
        const start = Date.now();
        this.searchCount++;
        const conditions = [];
        const values = [];
        let paramIndex = 1;
        // query for tsquery
        values.push(opts.query);
        const queryParam = paramIndex++;
        // must match text search
        conditions.push(`content_tsv @@ plainto_tsquery('english', $${queryParam})`);
        // PROJECT ISOLATION: Filter by project_path unless allProjects is true
        if (!opts.allProjects) {
            const targetProject = opts.projectPath || getCurrentProjectPath();
            conditions.push(`project_path = $${paramIndex}`);
            values.push(targetProject);
            paramIndex++;
        }
        // filter expired
        if (!opts.includeExpired) {
            conditions.push('(expires_at IS NULL OR expires_at > NOW())');
        }
        // memory type filter
        if (opts.memoryTypes?.length) {
            conditions.push(`memory_type = ANY($${paramIndex}${PG_TYPE_MEMORY_TYPE_ARRAY})`);
            values.push(opts.memoryTypes);
            paramIndex++;
        }
        // tag filter
        if (opts.tags?.length) {
            conditions.push(`tags && $${paramIndex}`);
            values.push(opts.tags);
            paramIndex++;
        }
        const limit = opts.limit ?? 10;
        values.push(limit);
        const limitParam = paramIndex;
        const whereClause = conditions.join(' AND ');
        // PERFORMANCE FIX: Using explicit column list instead of SELECT *
        const query = `
      SELECT
        ${MEMORY_COLUMNS},
        ts_rank(content_tsv, plainto_tsquery('english', $${queryParam})) AS text_rank
      FROM memories
      WHERE ${whereClause}
      ORDER BY text_rank DESC
      LIMIT $${limitParam}
    `;
        const result = await this.pool.queryWithSwag(query, values);
        // update access stats
        this.touchMemories(result.rows.map((r) => r.id)).catch((err) => {
            logger.warn({ err }, 'failed to update access stats');
        });
        const searchResults = result.rows.map((row) => ({
            memory: this.rowToMemory(row),
            similarity: row.text_rank ?? 0,
            highlights: this.extractHighlights(row.content, opts.query)
        }));
        const duration = Date.now() - start;
        logger.debug({ duration, resultCount: searchResults.length }, 'text search complete');
        return searchResults;
    }
    // HYBRID SEARCH - combines vector + text for best of both worlds
    async hybridSearch(query, embedding, opts = {}) {
        const start = Date.now();
        this.searchCount++;
        const conditions = [];
        const values = [];
        let paramIndex = 1;
        // embedding param
        const embeddingStr = `[${embedding.join(',')}]`;
        values.push(embeddingStr);
        const embeddingParam = paramIndex++;
        // text query param
        values.push(query);
        const textQueryParam = paramIndex++;
        // PROJECT ISOLATION: Filter by project_path unless allProjects is true
        if (!opts.allProjects) {
            const targetProject = opts.projectPath || getCurrentProjectPath();
            conditions.push(`project_path = $${paramIndex}`);
            values.push(targetProject);
            paramIndex++;
        }
        // filter expired
        if (!opts.includeExpired) {
            conditions.push('(expires_at IS NULL OR expires_at > NOW())');
        }
        // memory type filter
        if (opts.memoryTypes?.length) {
            conditions.push(`memory_type = ANY($${paramIndex}${PG_TYPE_MEMORY_TYPE_ARRAY})`);
            values.push(opts.memoryTypes);
            paramIndex++;
        }
        // tag filter
        if (opts.tags?.length) {
            conditions.push(`tags && $${paramIndex}`);
            values.push(opts.tags);
            paramIndex++;
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const filterClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
        const limit = opts.limit ?? 10;
        const vectorWeight = opts.vectorWeight ?? 0.7;
        const textWeight = 1 - vectorWeight;
        values.push(limit * 2); // fetch more candidates
        const preLimitParam = paramIndex++;
        values.push(limit);
        const finalLimitParam = paramIndex;
        // hybrid query combining vector and text results
        const sqlQuery = `
      WITH vector_results AS (
        SELECT id, 1 - (embedding <=> $${embeddingParam}::vector) AS vector_score
        FROM memories
        ${whereClause}
        ${conditions.length > 0 ? 'AND' : 'WHERE'} embedding IS NOT NULL
        ORDER BY embedding <=> $${embeddingParam}::vector
        LIMIT $${preLimitParam}
      ),
      text_results AS (
        SELECT id, ts_rank(content_tsv, plainto_tsquery('english', $${textQueryParam})) AS text_score
        FROM memories
        ${whereClause}
        ${conditions.length > 0 ? 'AND' : 'WHERE'} content_tsv @@ plainto_tsquery('english', $${textQueryParam})
        ORDER BY text_score DESC
        LIMIT $${preLimitParam}
      ),
      combined AS (
        SELECT
          COALESCE(v.id, t.id) AS id,
          COALESCE(v.vector_score, 0) * ${vectorWeight} +
          COALESCE(t.text_score, 0) * ${textWeight} AS combined_score
        FROM vector_results v
        FULL OUTER JOIN text_results t ON v.id = t.id
      )
      SELECT m.*, c.combined_score AS similarity
      FROM combined c
      JOIN memories m ON m.id = c.id
      ORDER BY c.combined_score DESC
      LIMIT $${finalLimitParam}
    `;
        const result = await this.pool.queryWithSwag(sqlQuery, values);
        // update access stats
        this.touchMemories(result.rows.map((r) => r.id)).catch((err) => {
            logger.warn({ err }, 'failed to update access stats');
        });
        const searchResults = result.rows.map((row) => ({
            memory: this.rowToMemory(row),
            similarity: row.similarity ?? 0,
            highlights: this.extractHighlights(row.content, query)
        }));
        const duration = Date.now() - start;
        logger.debug({
            duration,
            resultCount: searchResults.length,
            vectorWeight,
            textWeight
        }, 'hybrid search complete - best of both worlds fr');
        return searchResults;
    }
    // TAG SEARCH - filter by tags with AND/OR logic
    async tagSearch(tags, mode = 'OR', opts = {}) {
        const start = Date.now();
        this.searchCount++;
        const conditions = [];
        const values = [];
        let paramIndex = 1;
        // PROJECT ISOLATION: Filter by project_path unless allProjects is true
        if (!opts.allProjects) {
            const targetProject = opts.projectPath || getCurrentProjectPath();
            conditions.push(`project_path = $${paramIndex}`);
            values.push(targetProject);
            paramIndex++;
        }
        // tag filtering based on mode
        if (mode === 'OR') {
            // any tag matches (array overlap)
            conditions.push(`tags && $${paramIndex}`);
            values.push(tags);
            paramIndex++;
        }
        else {
            // all tags must match (array containment)
            conditions.push(`tags @> $${paramIndex}`);
            values.push(tags);
            paramIndex++;
        }
        // expired filter
        if (!opts.includeExpired) {
            conditions.push('(expires_at IS NULL OR expires_at > NOW())');
        }
        const limit = opts.limit ?? 100;
        values.push(limit);
        const limitParam = paramIndex;
        // PERFORMANCE FIX: Using explicit column list instead of SELECT *
        const query = `
      SELECT ${MEMORY_COLUMNS} FROM memories
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${limitParam}
    `;
        const result = await this.pool.queryWithSwag(query, values);
        const duration = Date.now() - start;
        logger.debug({ duration, resultCount: result.rows.length, mode, tags }, 'tag search complete');
        return result.rows.map((row) => this.rowToMemory(row));
    }
    // GET BY ID - simple lookup
    // PERFORMANCE FIX: Using explicit column list instead of SELECT *
    // NOTE: By ID lookup intentionally skips project filtering since IDs are globally unique
    // However, we verify the memory belongs to current project for security (unless crossProject is true)
    async findById(id, opts = {}) {
        let query = `SELECT ${MEMORY_COLUMNS} FROM memories WHERE id = $1`;
        const values = [id];
        // PROJECT ISOLATION: Optionally verify memory belongs to current project
        if (!opts.crossProject) {
            const projectPath = getCurrentProjectPath();
            query += ` AND project_path = $2`;
            values.push(projectPath);
        }
        const result = await this.pool.queryWithSwag(query, values);
        if (result.rows.length === 0)
            return null;
        // touch the memory
        this.touchMemories([id]).catch(() => { });
        return this.rowToMemory(result.rows[0]);
    }
    // GET MULTIPLE BY ID
    // PERFORMANCE FIX: Using explicit column list instead of SELECT *
    // NOTE: By ID lookup intentionally skips project filtering since IDs are globally unique
    // However, we verify the memories belong to current project for security (unless crossProject is true)
    async findByIds(ids, opts = {}) {
        if (ids.length === 0)
            return [];
        let query = `SELECT ${MEMORY_COLUMNS} FROM memories WHERE id = ANY($1)`;
        const values = [ids];
        // PROJECT ISOLATION: Optionally verify memories belong to current project
        if (!opts.crossProject) {
            const projectPath = getCurrentProjectPath();
            query += ` AND project_path = $2`;
            values.push(projectPath);
        }
        const result = await this.pool.queryWithSwag(query, values);
        // touch the memories
        this.touchMemories(ids).catch(() => { });
        return result.rows.map((row) => this.rowToMemory(row));
    }
    // FIND SIMILAR - given a memory, find related ones
    async findSimilarToMemory(memoryId, opts = {}) {
        const start = Date.now();
        const limit = opts.limit ?? 10;
        const threshold = opts.threshold ?? 0.7;
        const maxDistance = 1 - threshold;
        // PROJECT ISOLATION: Build project filter
        let projectFilter = '';
        const values = [memoryId, maxDistance, limit];
        if (!opts.allProjects) {
            const targetProject = opts.projectPath || getCurrentProjectPath();
            projectFilter = `AND m.project_path = $4`;
            values.push(targetProject);
        }
        const query = `
      WITH source AS (
        SELECT embedding FROM memories WHERE id = $1
      )
      SELECT m.*, 1 - (m.embedding <=> s.embedding) AS similarity
      FROM memories m, source s
      WHERE m.id != $1
        AND m.embedding IS NOT NULL
        AND (m.expires_at IS NULL OR m.expires_at > NOW())
        AND (m.embedding <=> s.embedding) < $2
        ${projectFilter}
      ORDER BY m.embedding <=> s.embedding
      LIMIT $3
    `;
        const result = await this.pool.queryWithSwag(query, values);
        const duration = Date.now() - start;
        logger.debug({ duration, resultCount: result.rows.length }, 'similar search complete');
        return result.rows.map((row) => ({
            memory: this.rowToMemory(row),
            similarity: row.similarity ?? 0
        }));
    }
    // FIND DUPLICATES - for deduplication
    async findDuplicates(threshold = 0.95, opts = {}) {
        const start = Date.now();
        const maxDistance = 1 - threshold;
        // PROJECT ISOLATION: Build project filter
        let projectFilter = '';
        const values = [maxDistance];
        if (!opts.allProjects) {
            const targetProject = opts.projectPath || getCurrentProjectPath();
            projectFilter = `AND m1.project_path = $2 AND m2.project_path = $2`;
            values.push(targetProject);
        }
        // nah this query finds all pairs above threshold
        const query = `
      SELECT
        m1.id AS id1, m2.id AS id2,
        1 - (m1.embedding <=> m2.embedding) AS similarity
      FROM memories m1
      JOIN memories m2 ON m1.id < m2.id
      WHERE m1.embedding IS NOT NULL
        AND m2.embedding IS NOT NULL
        AND (m1.embedding <=> m2.embedding) < $1
        ${projectFilter}
      ORDER BY similarity DESC
      LIMIT 100
    `;
        const result = await this.pool.queryWithSwag(query, values);
        const duplicates = [];
        // BATCH QUERY FIX: Collect all IDs first, single query with ANY
        const allIds = new Set();
        for (const row of result.rows) {
            allIds.add(row.id1);
            allIds.add(row.id2);
        }
        // Single batch query for all memories - O(1) queries regardless of N
        const memoryMap = new Map();
        if (allIds.size > 0) {
            const batchResult = await this.pool.queryWithSwag(`SELECT ${MEMORY_COLUMNS} FROM memories WHERE id = ANY($1)`, [Array.from(allIds)]);
            for (const row of batchResult.rows) {
                memoryMap.set(row.id, this.rowToMemory(row));
            }
        }
        // Build duplicates using O(1) Map lookups - no queries in loop
        for (const row of result.rows) {
            const mem1 = memoryMap.get(row.id1);
            const mem2 = memoryMap.get(row.id2);
            if (mem1 && mem2) {
                duplicates.push({
                    memory1: mem1,
                    memory2: mem2,
                    similarity: row.similarity
                });
            }
        }
        const duration = Date.now() - start;
        logger.debug({ duration, duplicatesFound: duplicates.length }, 'duplicate search complete');
        return duplicates;
    }
    // RECALL - paginated list with filters
    async recall(params) {
        const start = Date.now();
        const conditions = [];
        const values = [];
        let paramIndex = 1;
        // specific id lookup
        if (params.id) {
            const memory = await this.findById(params.id, { crossProject: params.allProjects });
            return {
                memories: memory ? [memory] : [],
                total: memory ? 1 : 0,
                hasMore: false
            };
        }
        // PROJECT ISOLATION: Filter by project_path unless allProjects is true
        if (!params.allProjects) {
            const targetProject = params.projectPath || getCurrentProjectPath();
            conditions.push(`project_path = $${paramIndex}`);
            values.push(targetProject);
            paramIndex++;
        }
        // tag filter
        if (params.tags?.length) {
            conditions.push(`tags && $${paramIndex}`);
            values.push(params.tags);
            paramIndex++;
        }
        // filter expired
        conditions.push('(expires_at IS NULL OR expires_at > NOW())');
        // build order clause
        const orderColumn = {
            created: 'created_at',
            updated: 'updated_at',
            accessed: 'last_accessed_at',
            importance: 'importance'
        }[params.orderBy ?? 'created'];
        const orderDir = params.orderDirection ?? 'desc';
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        // get total count
        const countResult = await this.pool.queryWithSwag(`SELECT COUNT(*) as count FROM memories ${whereClause}`, values);
        const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
        // get page
        const limit = params.limit ?? 50;
        const offset = params.offset ?? 0;
        values.push(limit);
        const limitParam = paramIndex++;
        values.push(offset);
        const offsetParam = paramIndex;
        // PERFORMANCE FIX: Using explicit column list instead of SELECT *
        const query = `
      SELECT ${MEMORY_COLUMNS} FROM memories
      ${whereClause}
      ORDER BY ${orderColumn} ${orderDir.toUpperCase()} NULLS LAST
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;
        const result = await this.pool.queryWithSwag(query, values);
        const duration = Date.now() - start;
        logger.debug({ duration, resultCount: result.rows.length, total, offset, limit }, 'recall complete');
        return {
            memories: result.rows.map((row) => this.rowToMemory(row)),
            total,
            hasMore: offset + result.rows.length < total
        };
    }
    // GET RELATED MEMORIES through relations
    async findRelated(memoryId, opts = {}) {
        const depth = opts.depth ?? 1;
        const limit = opts.limit ?? 20;
        // PROJECT ISOLATION: Build project filter
        let projectFilter = '';
        const values = [memoryId, limit];
        let nextParamIdx = 3;
        if (!opts.allProjects) {
            const targetProject = opts.projectPath || getCurrentProjectPath();
            projectFilter = `AND m.project_path = $${nextParamIdx}`;
            values.push(targetProject);
            nextParamIdx++;
        }
        let query;
        if (depth === 1) {
            // simple direct relations
            const relationTypeFilter = opts.relationType ? `AND r.relation_type = $${nextParamIdx}` : "";
            query = `
        SELECT m.* FROM memories m
        JOIN memory_relations r ON m.id = r.target_id
        WHERE r.source_id = $1
        ${relationTypeFilter}
        ${projectFilter}
        ORDER BY r.strength DESC
        LIMIT $2
      `;
            if (opts.relationType) {
                values.push(opts.relationType);
            }
        }
        else {
            // recursive for multi-hop relations (careful with this - can be expensive)
            const relationTypeFilter = opts.relationType ? `AND relation_type = $${nextParamIdx}` : "";
            query = `
        WITH RECURSIVE related AS (
          SELECT target_id as id, 1 as depth, strength
          FROM memory_relations
          WHERE source_id = $1
          ${relationTypeFilter}

          UNION

          SELECT r.target_id, rel.depth + 1, r.strength
          FROM memory_relations r
          JOIN related rel ON r.source_id = rel.id
          WHERE rel.depth < ${depth}
          ${relationTypeFilter}
        )
        SELECT DISTINCT m.* FROM memories m
        JOIN related r ON m.id = r.id
        WHERE 1=1 ${projectFilter}
        ORDER BY r.depth, r.strength DESC
        LIMIT $2
      `;
            if (opts.relationType) {
                values.push(opts.relationType);
            }
        }
        const result = await this.pool.queryWithSwag(query, values);
        return result.rows.map((row) => this.rowToMemory(row));
    }
    // GET ALL TAGS with usage counts
    // PROJECT ISOLATION: Only return tags that are actually used by memories in current project
    async getAllTags(limit = 1000, opts = {}) {
        if (opts.allProjects) {
            // Cross-project: return all tags from tags table
            const result = await this.pool.queryWithSwag(`SELECT name, usage_count FROM tags
         ORDER BY usage_count DESC
         LIMIT $1`, [limit]);
            return result.rows.map((row) => ({
                name: row.name,
                count: row.usage_count
            }));
        }
        // PROJECT ISOLATION: Join with memories to only get tags used in current project
        const targetProject = opts.projectPath || getCurrentProjectPath();
        const result = await this.pool.queryWithSwag(`SELECT UNNEST(tags) AS tag, COUNT(*) AS tag_count
       FROM memories
       WHERE project_path = $1
         AND (expires_at IS NULL OR expires_at > NOW())
       GROUP BY tag
       ORDER BY tag_count DESC
       LIMIT $2`, [targetProject, limit]);
        return result.rows.map((row) => ({
            name: row.tag,
            count: parseInt(row.tag_count, 10)
        }));
    }
    // COUNT MEMORIES with optional filters
    async countMemories(filters) {
        const conditions = [];
        const values = [];
        let paramIndex = 1;
        // PROJECT ISOLATION: Filter by project_path unless allProjects is true
        if (!filters?.allProjects) {
            const targetProject = filters?.projectPath || getCurrentProjectPath();
            conditions.push(`project_path = $${paramIndex}`);
            values.push(targetProject);
            paramIndex++;
        }
        if (filters?.memoryType) {
            conditions.push(`memory_type = $${paramIndex}`);
            values.push(filters.memoryType);
            paramIndex++;
        }
        if (filters?.importance) {
            conditions.push(`importance = $${paramIndex}`);
            values.push(filters.importance);
            paramIndex++;
        }
        if (filters?.tags?.length) {
            conditions.push(`tags && $${paramIndex}`);
            values.push(filters.tags);
            paramIndex++;
        }
        if (!filters?.includeExpired) {
            conditions.push('(expires_at IS NULL OR expires_at > NOW())');
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await this.pool.queryWithSwag(`SELECT COUNT(*) as count FROM memories ${whereClause}`, values);
        return parseInt(result.rows[0]?.count ?? '0', 10);
    }
    // updates access stats for touched memories
    // PROJECT ISOLATION: Only update memories belonging to current project
    async touchMemories(ids) {
        if (ids.length === 0)
            return;
        const projectPath = getCurrentProjectPath();
        await this.pool.queryWithSwag(`UPDATE memories
       SET access_count = access_count + 1, last_accessed_at = NOW()
       WHERE id = ANY($1) AND project_path = $2`, [ids, projectPath]);
    }
    // converts db row to Memory object
    rowToMemory(row) {
        return {
            id: row.id,
            content: row.content,
            memoryType: row.memory_type,
            importance: row.importance,
            tags: row.tags,
            metadata: row.metadata,
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
    // parses embedding string to array
    parseEmbedding(embeddingStr) {
        const cleaned = embeddingStr.replace(/[\[\]]/g, '');
        return cleaned.split(',').map(Number);
    }
    // extracts relevant highlights from content
    extractHighlights(content, query) {
        const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const sentences = content.split(/[.!?]+/);
        const highlights = [];
        for (const sentence of sentences) {
            const lowerSentence = sentence.toLowerCase();
            if (words.some(word => lowerSentence.includes(word))) {
                const trimmed = sentence.trim();
                if (trimmed.length > 0 && trimmed.length < 500) {
                    highlights.push(trimmed);
                }
            }
            if (highlights.length >= 3)
                break;
        }
        return highlights;
    }
    // gets search stats
    getStats() {
        return {
            totalSearches: this.searchCount,
            cacheHits: this.cacheHits
        };
    }
}
// per-project Map pattern - no more global singleton cross-polluting projects fr
const searchInstancesByProject = new Map();
const searchAccessTimes = new Map();
// Cleanup stale search engines after 30 min inactivity
setupMapCleanup(searchInstancesByProject, searchAccessTimes, {
    staleThresholdMs: 30 * 60 * 1000,
    checkIntervalMs: 5 * 60 * 1000,
    logPrefix: '[BigBrain]'
});
export function getBigBrain(pool, projectPath) {
    const targetProject = projectPath || getCurrentProjectPath();
    searchAccessTimes.set(targetProject, Date.now());
    if (!searchInstancesByProject.has(targetProject) && !pool) {
        throw new Error(`search engine not initialized for project ${targetProject} - pass pool first`);
    }
    if (!searchInstancesByProject.has(targetProject) && pool) {
        searchInstancesByProject.set(targetProject, new BigBrainSearchEngine(pool));
        logger.debug(`[BigBrain] Created search engine for project: ${targetProject}`);
    }
    return searchInstancesByProject.get(targetProject);
}
export function resetBigBrain(projectPath) {
    if (projectPath) {
        searchInstancesByProject.delete(projectPath);
        logger.debug(`[BigBrain] Reset search engine for project: ${projectPath}`);
    }
    else {
        // reset current project only
        const currentProject = getCurrentProjectPath();
        searchInstancesByProject.delete(currentProject);
        logger.debug(`[BigBrain] Reset search engine for current project: ${currentProject}`);
    }
}
export function resetAllBigBrains() {
    searchInstancesByProject.clear();
    logger.debug('[BigBrain] Reset all search engines');
}
//# sourceMappingURL=findThatShit.js.map