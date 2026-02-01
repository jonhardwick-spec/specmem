/**
 * semantic_search_explanations - Search code explanations by meaning
 *
 * Uses vector embeddings to find explanations semantically similar
 * to a search query, enabling natural language code discovery.
 */
import { logger } from '../utils/logger.js';
import { SemanticSearchInput } from './types.js';
/**
 * SemanticSearchExplanations - Natural language code search
 *
 * Features:
 * - Vector similarity search
 * - Quality filtering
 * - Type filtering
 * - Relevance scoring
 */
export class SemanticSearchExplanations {
    db;
    embeddingProvider;
    name = 'semantic_search_explanations';
    description = `Search code explanations using natural language. Find explanations
semantically similar to your query. Great for questions like:
- "How does authentication work?"
- "Where is the database connection handled?"
- "What are the security considerations?"`;
    inputSchema = {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Natural language search query'
            },
            limit: {
                type: 'number',
                minimum: 1,
                maximum: 100,
                default: 10,
                description: 'Maximum results to return'
            },
            threshold: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                default: 0.7,
                description: 'Minimum similarity threshold (0-1)'
            },
            explanationTypes: {
                type: 'array',
                items: {
                    type: 'string',
                    enum: ['general', 'architectural', 'algorithmic', 'usage', 'gotchas',
                        'performance', 'security', 'debugging', 'history', 'todo']
                },
                description: 'Filter by explanation type(s)'
            },
            minQuality: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                default: 0,
                description: 'Minimum quality score (0-1)'
            }
        },
        required: ['query']
    };
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
    }
    async execute(params) {
        const validatedParams = SemanticSearchInput.parse(params);
        logger.debug({ query: validatedParams.query }, 'Performing semantic search');
        try {
            // Generate embedding for query
            const queryEmbedding = await this.embeddingProvider.generateEmbedding(validatedParams.query);
            if (!queryEmbedding || queryEmbedding.length === 0) {
                logger.warn('Failed to generate query embedding');
                return {
                    success: false,
                    results: [],
                    total: 0,
                    message: 'Failed to generate query embedding'
                };
            }
            const embeddingStr = `[${queryEmbedding.join(',')}]`;
            // Build query
            let searchQuery = `
        SELECT
          ce.*,
          cf.content as code_content,
          1 - (ce.embedding <=> $1::vector) as similarity
        FROM code_explanations ce
        LEFT JOIN codebase_files cf ON ce.code_id = cf.id
        WHERE ce.embedding IS NOT NULL
        AND 1 - (ce.embedding <=> $1::vector) >= $2
        AND ce.quality_score >= $3
      `;
            const values = [
                embeddingStr,
                validatedParams.threshold,
                validatedParams.minQuality
            ];
            let paramIndex = 4;
            if (validatedParams.explanationTypes && validatedParams.explanationTypes.length > 0) {
                searchQuery += ` AND ce.explanation_type = ANY($${paramIndex++})`;
                values.push(validatedParams.explanationTypes);
            }
            searchQuery += `
        ORDER BY similarity DESC
        LIMIT $${paramIndex}
      `;
            values.push(validatedParams.limit);
            const result = await this.db.query(searchQuery, values);
            const results = result.rows.map((row) => ({
                explanation: {
                    id: row.id,
                    codeId: row.code_id ?? undefined,
                    filePath: row.file_path,
                    lineStart: row.line_start ?? undefined,
                    lineEnd: row.line_end ?? undefined,
                    codeSnippet: row.code_snippet ?? undefined,
                    explanationText: row.explanation_text,
                    explanationType: row.explanation_type,
                    qualityScore: row.quality_score,
                    useCount: row.use_count,
                    feedbackPositive: row.feedback_positive,
                    feedbackNegative: row.feedback_negative,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at,
                    createdBy: row.created_by,
                    metadata: row.metadata
                },
                similarity: row.similarity,
                codeSnippet: row.code_snippet ?? row.code_content?.slice(0, 500) ?? undefined
            }));
            // Update use counts
            const explanationIds = results.map((r) => r.explanation.id);
            if (explanationIds.length > 0) {
                await this.updateUseCounts(explanationIds);
            }
            // Track this query for learning
            await this.trackQuery(validatedParams.query, queryEmbedding, results.map((r) => r.explanation.codeId).filter(Boolean));
            logger.info({
                resultCount: results.length,
                topSimilarity: results[0]?.similarity ?? 0
            }, 'Semantic search completed');
            return {
                success: true,
                results,
                total: results.length,
                message: `Found ${results.length} matching explanation(s)`
            };
        }
        catch (error) {
            logger.error({ error, query: validatedParams.query }, 'Semantic search failed');
            return {
                success: false,
                results: [],
                total: 0,
                message: error instanceof Error ? error.message : 'Search failed'
            };
        }
    }
    /**
     * Update use counts for retrieved explanations
     */
    async updateUseCounts(explanationIds) {
        await this.db.query(`UPDATE code_explanations
       SET use_count = use_count + 1
       WHERE id = ANY($1)`, [explanationIds]);
    }
    /**
     * Track query for learning improvement
     */
    async trackQuery(query, embedding, foundCodeIds) {
        // Store query in access patterns for learning
        for (const codeId of foundCodeIds) {
            try {
                await this.db.query(`INSERT INTO code_access_patterns (
            code_id, common_queries, query_embeddings, access_count, last_accessed
          ) VALUES ($1, $2, $3, 1, NOW())
          ON CONFLICT (code_id) DO UPDATE SET
            access_count = code_access_patterns.access_count + 1,
            last_accessed = NOW(),
            common_queries = CASE
              WHEN NOT ($4 = ANY(code_access_patterns.common_queries))
              THEN array_append(
                (SELECT common_queries[array_length(common_queries, 1) - 49:array_length(common_queries, 1)]
                 FROM code_access_patterns WHERE code_id = $1),
                $4
              )
              ELSE code_access_patterns.common_queries
            END`, [codeId, [query], [embedding], query]);
            }
            catch (error) {
                // Log but don't fail the search
                logger.warn({ error, codeId }, 'Failed to track query');
            }
        }
    }
}
//# sourceMappingURL=semanticSearch.js.map