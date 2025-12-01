import { logger } from './utils/logger.js';
import { getDimensionService } from './services/DimensionService.js';
import { getProjectContext } from './services/ProjectContext.js';
import { getEmbeddingTimeout } from './config/embeddingTimeouts.js';
/**
 * UNIFIED TIMEOUT CONFIGURATION
 * Set SPECMEM_EMBEDDING_TIMEOUT (seconds) to control ALL embedding/search timeouts
 * See src/config/embeddingTimeouts.ts for full documentation
 *
 * Individual overrides still available:
 * - SPECMEM_SEARCH_TIMEOUT_MS: Overall timeout for search operations
 * - SPECMEM_HYBRID_SEARCH_TIMEOUT_MS: Override timeout for hybrid search
 * - SPECMEM_VECTOR_QUERY_TIMEOUT_MS: Timeout for vector similarity operations
 */
const SEARCH_TIMEOUT_MS = getEmbeddingTimeout('search');
const HYBRID_SEARCH_TIMEOUT_MS = getEmbeddingTimeout('dbSearch');
const VECTOR_QUERY_TIMEOUT_MS = getEmbeddingTimeout('request');
/**
 * High-performance semantic search engine using pgvector for vector similarity
 * and PostgreSQL full-text search for hybrid retrieval.
 * Uses DimensionService to handle dynamic embedding dimensions.
 */
export class SemanticSearchEngine {
    db;
    dimensionService = null;
    embeddingProvider = null;
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider || null;
        try {
            this.dimensionService = getDimensionService(db, embeddingProvider);
        }
        catch {
            // Will initialize when needed
        }
    }
    /**
     * Get the DimensionService (lazy initialization)
     */
    getDimService() {
        console.log('[SEARCH DEBUG]', Date.now(), 'GET_DIM_SERVICE_START', { hasExisting: !!this.dimensionService });
        if (!this.dimensionService) {
            console.log('[SEARCH DEBUG]', Date.now(), 'GET_DIM_SERVICE_CREATING_NEW', { hasDb: !!this.db, hasProvider: !!this.embeddingProvider });
            this.dimensionService = getDimensionService(this.db, this.embeddingProvider || undefined);
            console.log('[SEARCH DEBUG]', Date.now(), 'GET_DIM_SERVICE_CREATED', { service: !!this.dimensionService });
        }
        console.log('[SEARCH DEBUG]', Date.now(), 'GET_DIM_SERVICE_END', { returning: !!this.dimensionService });
        return this.dimensionService;
    }
    /**
     * Validate and prepare an embedding for search.
     * Handles dimension mismatches by re-embedding or scaling.
     */
    async prepareEmbedding(embedding, originalQuery) {
        console.log('[SEARCH DEBUG]', Date.now(), 'PREPARE_EMBEDDING_START', { embeddingLength: embedding?.length, hasQuery: !!originalQuery, queryPreview: originalQuery?.substring(0, 50) });
        const dimService = this.getDimService();
        console.log('[SEARCH DEBUG]', Date.now(), 'PREPARE_EMBEDDING_GOT_DIM_SERVICE', { dimService: !!dimService });
        const prepareStart = Date.now();
        const prepared = await dimService.validateAndPrepare('memories', embedding, originalQuery);
        console.log('[SEARCH DEBUG]', Date.now(), 'PREPARE_EMBEDDING_VALIDATED', { wasModified: prepared.wasModified, action: prepared.action, prepareTimeMs: Date.now() - prepareStart, resultLength: prepared.embedding?.length });
        if (prepared.wasModified) {
            logger.debug({ action: prepared.action }, 'Adjusted embedding dimension for search');
        }
        console.log('[SEARCH DEBUG]', Date.now(), 'PREPARE_EMBEDDING_END', { finalLength: prepared.embedding?.length });
        return prepared.embedding;
    }
    async search(params, queryEmbedding) {
        const start = Date.now();
        console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_METHOD_START', {
            query: params.query?.substring(0, 100),
            embeddingLength: queryEmbedding?.length,
            threshold: params.threshold,
            limit: params.limit,
            memoryTypes: params.memoryTypes,
            tags: params.tags,
            includeExpired: params.includeExpired
        });
        // NOTE: Timeout is handled by the caller (findWhatISaid.ts) via Promise.race()
        // The previous AbortController here was REDUNDANT and caused "AbortError: The operation was aborted"
        // because controller.abort() throws DOMException which escaped the try/catch/finally block.
        //
        // REMOVED: AbortController and setTimeout that caused the bug.
        // The caller's Promise.race() with SEARCH_TIMEOUT_MS handles timeout gracefully.
        try {
            // Validate and prepare embedding dimension
            console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_PREPARE_EMBEDDING_START', { inputLength: queryEmbedding?.length });
            const validatedEmbedding = await this.prepareEmbedding(queryEmbedding, params.query);
            console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_PREPARE_EMBEDDING_DONE', { validatedLength: validatedEmbedding?.length, timeElapsed: Date.now() - start });
            console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_BUILD_CONDITIONS_START', {});
            const conditions = [];
            const values = [];
            let paramIndex = 1;
            values.push(`[${validatedEmbedding.join(',')}]`);
            const embeddingParam = paramIndex++;
            console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_EMBEDDING_PARAM_ADDED', { embeddingParam, embeddingVectorLength: validatedEmbedding.length });
            // PROJECT ISOLATION: Filter by project_id for per-instance isolation
            // Uses UUID-based FK relationship for efficient filtering
            console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_PROJECT_CONTEXT_START', {});
            const projectContext = getProjectContext();
            console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_PROJECT_CONTEXT_GOT', { hasProjectId: projectContext.hasProjectId() });
            if (projectContext.hasProjectId()) {
                // Include both project-specific memories AND default project memories (shared/global)
                // Note: getProjectId() is async but we use the cached value after initialization
                const projectIdStart = Date.now();
                const projectId = await projectContext.getProjectId();
                console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_PROJECT_ID_FETCHED', { projectId, fetchTimeMs: Date.now() - projectIdStart });
                conditions.push(`(project_id = $${paramIndex} OR project_id = '00000000-0000-0000-0000-000000000000'::uuid)`);
                values.push(projectId);
                paramIndex++;
            }
            if (!params.includeExpired) {
                conditions.push(`(expires_at IS NULL OR expires_at > NOW())`);
            }
            if (params.memoryTypes?.length) {
                conditions.push(`memory_type = ANY($${paramIndex}::memory_type[])`);
                values.push(params.memoryTypes);
                paramIndex++;
            }
            if (params.tags?.length) {
                conditions.push(`tags && $${paramIndex}`);
                values.push(params.tags);
                paramIndex++;
            }
            if (params.importance?.length) {
                conditions.push(`importance = ANY($${paramIndex}::importance_level[])`);
                values.push(params.importance);
                paramIndex++;
            }
            if (params.dateRange?.start) {
                conditions.push(`created_at >= $${paramIndex}`);
                values.push(params.dateRange.start);
                paramIndex++;
            }
            if (params.dateRange?.end) {
                conditions.push(`created_at <= $${paramIndex}`);
                values.push(params.dateRange.end);
                paramIndex++;
            }
            conditions.push(`embedding IS NOT NULL`);
            const thresholdParam = paramIndex++;
            values.push(1 - params.threshold);
            const limitParam = paramIndex;
            values.push(params.limit);
            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_CONDITIONS_BUILT', {
                conditionCount: conditions.length,
                whereClauseLength: whereClause.length,
                thresholdParam,
                thresholdValue: 1 - params.threshold,
                limitParam,
                limitValue: params.limit,
                paramCount: values.length,
                timeElapsed: Date.now() - start
            });
            const query = `
        WITH vector_search AS (
          SELECT
            id, content, memory_type, importance, tags, metadata,
            embedding, image_data, image_mime_type, created_at, updated_at,
            access_count, last_accessed_at, expires_at, consolidated_from,
            1 - (embedding <=> $${embeddingParam}::vector) AS similarity
          FROM memories
          ${whereClause}
          AND (embedding <=> $${embeddingParam}::vector) < $${thresholdParam}
          ORDER BY embedding <=> $${embeddingParam}::vector
          LIMIT $${limitParam}
        )
        SELECT * FROM vector_search ORDER BY similarity DESC
      `;
            console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_QUERY_BUILT', { queryLength: query.length, timeElapsed: Date.now() - start });
            console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_DB_QUERY_START', { paramCount: values.length, timeElapsed: Date.now() - start });
            const dbQueryStart = Date.now();
            const result = await this.db.query(query, values);
            console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_DB_QUERY_DONE', { rowCount: result.rows?.length, dbQueryTimeMs: Date.now() - dbQueryStart, timeElapsed: Date.now() - start });
            console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_UPDATE_ACCESS_STATS_START', { idCount: result.rows.length, timeElapsed: Date.now() - start });
            const accessStatsStart = Date.now();
            await this.updateAccessStats(result.rows.map((r) => r.id));
            console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_UPDATE_ACCESS_STATS_DONE', { accessStatsTimeMs: Date.now() - accessStatsStart, timeElapsed: Date.now() - start });
            console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_MAP_RESULTS_START', { rowCount: result.rows.length, timeElapsed: Date.now() - start });
            const mapResultsStart = Date.now();
            const searchResults = result.rows.map((row) => ({
                memory: this.rowToMemory(row),
                similarity: row.similarity ?? 0,
                highlights: this.extractHighlights(row.content, params.query)
            }));
            console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_MAP_RESULTS_DONE', { resultCount: searchResults.length, mapTimeMs: Date.now() - mapResultsStart, timeElapsed: Date.now() - start });
            const duration = Date.now() - start;
            // Enhanced logging with similarity distribution - CRITICAL for debugging relevance issues
            const similarities = searchResults.map(r => r.similarity);
            logger.info({
                duration,
                resultCount: searchResults.length,
                threshold: params.threshold,
                thresholdAsDistance: 1 - params.threshold, // What we actually compare against
                topSimilarity: similarities[0] || 0,
                minSimilarity: similarities[similarities.length - 1] || 0,
                avgSimilarity: similarities.length > 0
                    ? Math.round(similarities.reduce((a, b) => a + b, 0) / similarities.length * 1000) / 1000
                    : 0,
                // Bucket counts for relevance analysis
                highRelevance: similarities.filter(s => s >= 0.5).length,
                mediumRelevance: similarities.filter(s => s >= 0.25 && s < 0.5).length,
                lowRelevance: similarities.filter(s => s < 0.25).length
            }, '[SemanticSearchEngine] Search completed with relevance distribution');
            console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_METHOD_END', {
                resultCount: searchResults.length,
                totalDurationMs: duration,
                topSimilarity: similarities[0] || 0,
                minSimilarity: similarities[similarities.length - 1] || 0
            });
            return searchResults;
        }
        catch (error) {
            // Log search errors for debugging
            const err = error;
            console.log('[SEARCH DEBUG]', Date.now(), 'SEARCH_METHOD_ERROR', {
                errorName: err.name,
                errorMessage: err.message,
                errorStack: err.stack?.substring(0, 500),
                durationMs: Date.now() - start
            });
            logger.error({
                query: params.query,
                error: err.message,
                duration: Date.now() - start
            }, '[SemanticSearchEngine] Search failed');
            throw error;
        }
    }
    async hybridSearch(params, queryEmbedding) {
        const start = Date.now();
        console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_METHOD_START', {
            query: params.query?.substring(0, 100),
            embeddingLength: queryEmbedding?.length,
            threshold: params.threshold,
            limit: params.limit,
            memoryTypes: params.memoryTypes,
            tags: params.tags,
            includeExpired: params.includeExpired
        });
        // NOTE: Timeout is handled by the caller (findWhatISaid.ts) via Promise.race()
        // The previous AbortController here was REDUNDANT and caused "AbortError: The operation was aborted"
        // because controller.abort() throws DOMException which escaped the try/catch/finally block.
        //
        // REMOVED: AbortController and setTimeout that caused the bug.
        // The caller's Promise.race() with SEARCH_TIMEOUT_MS handles timeout gracefully.
        try {
            // Validate and prepare embedding dimension
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_PREPARE_EMBEDDING_START', { inputLength: queryEmbedding?.length });
            const validatedEmbedding = await this.prepareEmbedding(queryEmbedding, params.query);
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_PREPARE_EMBEDDING_DONE', { validatedLength: validatedEmbedding?.length, timeElapsed: Date.now() - start });
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_BUILD_CONDITIONS_START', {});
            const conditions = [];
            const values = [];
            let paramIndex = 1;
            values.push(`[${validatedEmbedding.join(',')}]`);
            const embeddingParam = paramIndex++;
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_EMBEDDING_PARAM_ADDED', { embeddingParam, embeddingVectorLength: validatedEmbedding.length });
            values.push(params.query);
            const textQueryParam = paramIndex++;
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_TEXT_QUERY_PARAM_ADDED', { textQueryParam, queryLength: params.query?.length });
            // PROJECT ISOLATION: Filter by project_id for per-instance isolation
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_PROJECT_CONTEXT_START', {});
            const projectContext = getProjectContext();
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_PROJECT_CONTEXT_GOT', { hasProjectId: projectContext.hasProjectId() });
            if (projectContext.hasProjectId()) {
                const projectIdStart = Date.now();
                const projectId = await projectContext.getProjectId();
                console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_PROJECT_ID_FETCHED', { projectId, fetchTimeMs: Date.now() - projectIdStart });
                conditions.push(`(project_id = $${paramIndex} OR project_id = '00000000-0000-0000-0000-000000000000'::uuid)`);
                values.push(projectId);
                paramIndex++;
            }
            if (!params.includeExpired) {
                conditions.push(`(expires_at IS NULL OR expires_at > NOW())`);
            }
            if (params.memoryTypes?.length) {
                conditions.push(`memory_type = ANY($${paramIndex}::memory_type[])`);
                values.push(params.memoryTypes);
                paramIndex++;
            }
            if (params.tags?.length) {
                conditions.push(`tags && $${paramIndex}`);
                values.push(params.tags);
                paramIndex++;
            }
            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_CONDITIONS_BUILT', {
                conditionCount: conditions.length,
                whereClauseLength: whereClause.length,
                paramCount: values.length,
                timeElapsed: Date.now() - start
            });
            values.push(params.limit * 2);
            const limitParam = paramIndex++;
            values.push(params.limit);
            const finalLimitParam = paramIndex;
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_LIMITS_SET', { limitParam, limitValue: params.limit * 2, finalLimitParam, finalLimitValue: params.limit });
            const query = `
        WITH vector_results AS (
          SELECT id, 1 - (embedding <=> $${embeddingParam}::vector) AS vector_score
          FROM memories
          ${whereClause}
          ${conditions.length > 0 ? 'AND' : 'WHERE'} embedding IS NOT NULL
          ORDER BY embedding <=> $${embeddingParam}::vector
          LIMIT $${limitParam}
        ),
        text_results AS (
          SELECT id, ts_rank(content_tsv, plainto_tsquery('english', $${textQueryParam})) AS text_score
          FROM memories
          ${whereClause}
          ${conditions.length > 0 ? 'AND' : 'WHERE'} content_tsv @@ plainto_tsquery('english', $${textQueryParam})
          ORDER BY text_score DESC
          LIMIT $${limitParam}
        ),
        combined AS (
          SELECT
            COALESCE(v.id, t.id) AS id,
            COALESCE(v.vector_score, 0) * 0.7 + COALESCE(t.text_score, 0) * 0.3 AS combined_score
          FROM vector_results v
          FULL OUTER JOIN text_results t ON v.id = t.id
        )
        SELECT m.*, c.combined_score AS similarity
        FROM combined c
        JOIN memories m ON m.id = c.id
        ORDER BY c.combined_score DESC
        LIMIT $${finalLimitParam}
      `;
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_QUERY_BUILT', { queryLength: query.length, timeElapsed: Date.now() - start });
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_DB_QUERY_START', { paramCount: values.length, timeElapsed: Date.now() - start });
            const dbQueryStart = Date.now();
            const result = await this.db.query(query, values);
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_DB_QUERY_DONE', { rowCount: result.rows?.length, dbQueryTimeMs: Date.now() - dbQueryStart, timeElapsed: Date.now() - start });
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_UPDATE_ACCESS_STATS_START', { idCount: result.rows.length, timeElapsed: Date.now() - start });
            const accessStatsStart = Date.now();
            await this.updateAccessStats(result.rows.map((r) => r.id));
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_UPDATE_ACCESS_STATS_DONE', { accessStatsTimeMs: Date.now() - accessStatsStart, timeElapsed: Date.now() - start });
            const duration = Date.now() - start;
            logger.info({
                duration,
                resultCount: result.rows.length,
                searchType: 'hybrid'
            }, '[SemanticSearchEngine] Hybrid search completed');
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_MAP_RESULTS_START', { rowCount: result.rows.length, timeElapsed: Date.now() - start });
            const mapResultsStart = Date.now();
            const searchResults = result.rows.map((row) => ({
                memory: this.rowToMemory(row),
                similarity: row.similarity ?? 0,
                highlights: this.extractHighlights(row.content, params.query)
            }));
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_MAP_RESULTS_DONE', { resultCount: searchResults.length, mapTimeMs: Date.now() - mapResultsStart, timeElapsed: Date.now() - start });
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_METHOD_END', {
                resultCount: searchResults.length,
                totalDurationMs: duration
            });
            return searchResults;
        }
        catch (error) {
            // Log hybrid search errors for debugging
            const err = error;
            console.log('[SEARCH DEBUG]', Date.now(), 'HYBRID_SEARCH_METHOD_ERROR', {
                errorName: err.name,
                errorMessage: err.message,
                errorStack: err.stack?.substring(0, 500),
                durationMs: Date.now() - start
            });
            logger.error({
                query: params.query,
                error: err.message,
                duration: Date.now() - start
            }, '[SemanticSearchEngine] Hybrid search failed');
            throw error;
        }
    }
    async findSimilarToMemory(memoryId, limit = 10, threshold = 0.7) {
        const start = Date.now();
        console.log('[SEARCH DEBUG]', Date.now(), 'FIND_SIMILAR_METHOD_START', { memoryId, limit, threshold, timeoutMs: VECTOR_QUERY_TIMEOUT_MS });
        // TIMEOUT: Wrap findSimilar operation in timeout controller
        const timeoutHandle = setTimeout(() => {
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_SIMILAR_TIMEOUT_TRIGGERED', { memoryId, timeoutMs: VECTOR_QUERY_TIMEOUT_MS });
            const timeoutError = new Error(`Find similar operation timeout after ${VECTOR_QUERY_TIMEOUT_MS / 1000}s. ` +
                `Memory ID: "${memoryId}". ` +
                `Configure timeout via SPECMEM_VECTOR_QUERY_TIMEOUT_MS environment variable (current: ${VECTOR_QUERY_TIMEOUT_MS}ms).`);
            timeoutError.code = 'VECTOR_QUERY_TIMEOUT';
            timeoutError.timeout = VECTOR_QUERY_TIMEOUT_MS;
            logger.warn({ timeout: VECTOR_QUERY_TIMEOUT_MS, memoryId }, 'Find similar timeout triggered');
            throw timeoutError;
        }, VECTOR_QUERY_TIMEOUT_MS);
        try {
            // PROJECT ISOLATION: Filter by project_id
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_SIMILAR_PROJECT_CONTEXT_START', {});
            const projectContext = getProjectContext();
            let projectFilter = '';
            let params = [memoryId, 1 - threshold, limit];
            if (projectContext.hasProjectId()) {
                const projectIdStart = Date.now();
                const projectId = await projectContext.getProjectId();
                console.log('[SEARCH DEBUG]', Date.now(), 'FIND_SIMILAR_PROJECT_ID_FETCHED', { projectId, fetchTimeMs: Date.now() - projectIdStart });
                projectFilter = `AND (m.project_id = $4 OR m.project_id = '00000000-0000-0000-0000-000000000000'::uuid)`;
                params = [memoryId, 1 - threshold, limit, projectId];
            }
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_SIMILAR_PROJECT_CONTEXT_DONE', { hasFilter: !!projectFilter, paramCount: params.length });
            const query = `
        WITH source AS (
          SELECT embedding, project_id FROM memories WHERE id = $1
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
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_SIMILAR_QUERY_BUILT', { queryLength: query.length, timeElapsed: Date.now() - start });
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_SIMILAR_DB_QUERY_START', { paramCount: params.length, timeElapsed: Date.now() - start });
            const dbQueryStart = Date.now();
            const result = await this.db.query(query, params);
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_SIMILAR_DB_QUERY_DONE', { rowCount: result.rows?.length, dbQueryTimeMs: Date.now() - dbQueryStart, timeElapsed: Date.now() - start });
            const duration = Date.now() - start;
            logger.debug({
                duration,
                resultCount: result.rows.length,
                memoryId
            }, '[SemanticSearchEngine] Find similar completed');
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_SIMILAR_MAP_RESULTS_START', { rowCount: result.rows.length, timeElapsed: Date.now() - start });
            const mapResultsStart = Date.now();
            const searchResults = result.rows.map((row) => ({
                memory: this.rowToMemory(row),
                similarity: row.similarity ?? 0
            }));
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_SIMILAR_MAP_RESULTS_DONE', { resultCount: searchResults.length, mapTimeMs: Date.now() - mapResultsStart, timeElapsed: Date.now() - start });
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_SIMILAR_METHOD_END', { resultCount: searchResults.length, totalDurationMs: duration });
            return searchResults;
        }
        finally {
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_SIMILAR_FINALLY_CLEAR_TIMEOUT', {});
            clearTimeout(timeoutHandle);
        }
    }
    async findDuplicates(threshold = 0.95) {
        const start = Date.now();
        const duplicateTimeoutMs = SEARCH_TIMEOUT_MS * 2; // Give duplicate detection more time (it's heavier)
        console.log('[SEARCH DEBUG]', Date.now(), 'FIND_DUPLICATES_METHOD_START', { threshold, timeoutMs: duplicateTimeoutMs });
        // TIMEOUT: Wrap findDuplicates operation in timeout controller
        const timeoutHandle = setTimeout(() => {
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_DUPLICATES_TIMEOUT_TRIGGERED', { timeoutMs: duplicateTimeoutMs });
            const timeoutError = new Error(`Find duplicates operation timeout after ${duplicateTimeoutMs / 1000}s. ` +
                `This operation scans all memory embeddings. ` +
                `Configure timeout via SPECMEM_SEARCH_TIMEOUT_MS environment variable (current multiplier: 2x).`);
            timeoutError.code = 'DUPLICATE_SEARCH_TIMEOUT';
            timeoutError.timeout = duplicateTimeoutMs;
            logger.warn({ timeout: duplicateTimeoutMs }, 'Find duplicates timeout triggered');
            throw timeoutError;
        }, duplicateTimeoutMs);
        try {
            // PROJECT ISOLATION: Only find duplicates within same project
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_DUPLICATES_PROJECT_CONTEXT_START', {});
            const projectContext = getProjectContext();
            let projectFilter = '';
            let params = [1 - threshold];
            if (projectContext.hasProjectId()) {
                const projectIdStart = Date.now();
                const projectId = await projectContext.getProjectId();
                console.log('[SEARCH DEBUG]', Date.now(), 'FIND_DUPLICATES_PROJECT_ID_FETCHED', { projectId, fetchTimeMs: Date.now() - projectIdStart });
                projectFilter = `AND (m1.project_id = $2 OR m1.project_id = '00000000-0000-0000-0000-000000000000'::uuid)
           AND (m2.project_id = $2 OR m2.project_id = '00000000-0000-0000-0000-000000000000'::uuid)`;
                params = [1 - threshold, projectId];
            }
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_DUPLICATES_PROJECT_CONTEXT_DONE', { hasFilter: !!projectFilter, paramCount: params.length });
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
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_DUPLICATES_QUERY_BUILT', { queryLength: query.length, timeElapsed: Date.now() - start });
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_DUPLICATES_DB_QUERY_START', { paramCount: params.length, timeElapsed: Date.now() - start });
            const dbQueryStart = Date.now();
            const result = await this.db.query(query, params);
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_DUPLICATES_DB_QUERY_DONE', { rowCount: result.rows?.length, dbQueryTimeMs: Date.now() - dbQueryStart, timeElapsed: Date.now() - start });
            const duplicates = [];
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_DUPLICATES_FETCH_MEMORIES_START', { pairCount: result.rows.length, timeElapsed: Date.now() - start });
            const fetchMemoriesStart = Date.now();
            for (const row of result.rows) {
                const [mem1Result, mem2Result] = await Promise.all([
                    this.db.query('SELECT * FROM memories WHERE id = $1', [row.id1]),
                    this.db.query('SELECT * FROM memories WHERE id = $2', [row.id2])
                ]);
                if (mem1Result.rows[0] && mem2Result.rows[0]) {
                    duplicates.push({
                        memory1: this.rowToMemory(mem1Result.rows[0]),
                        memory2: this.rowToMemory(mem2Result.rows[0]),
                        similarity: row.similarity
                    });
                }
            }
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_DUPLICATES_FETCH_MEMORIES_DONE', { duplicateCount: duplicates.length, fetchTimeMs: Date.now() - fetchMemoriesStart, timeElapsed: Date.now() - start });
            const duration = Date.now() - start;
            logger.debug({
                duration,
                duplicateCount: duplicates.length
            }, '[SemanticSearchEngine] Find duplicates completed');
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_DUPLICATES_METHOD_END', { duplicateCount: duplicates.length, totalDurationMs: duration });
            return duplicates;
        }
        finally {
            console.log('[SEARCH DEBUG]', Date.now(), 'FIND_DUPLICATES_FINALLY_CLEAR_TIMEOUT', {});
            clearTimeout(timeoutHandle);
        }
    }
    async updateAccessStats(ids) {
        console.log('[SEARCH DEBUG]', Date.now(), 'UPDATE_ACCESS_STATS_START', { idCount: ids.length });
        if (ids.length === 0) {
            console.log('[SEARCH DEBUG]', Date.now(), 'UPDATE_ACCESS_STATS_SKIP_EMPTY', {});
            return;
        }
        const dbQueryStart = Date.now();
        await this.db.query(`UPDATE memories
       SET access_count = access_count + 1, last_accessed_at = NOW()
       WHERE id = ANY($1)`, [ids]);
        console.log('[SEARCH DEBUG]', Date.now(), 'UPDATE_ACCESS_STATS_DONE', { idCount: ids.length, dbQueryTimeMs: Date.now() - dbQueryStart });
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
}
//# sourceMappingURL=search.js.map