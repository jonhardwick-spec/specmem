/**
 * recall_code_explanation - Retrieve stored code explanations
 *
 * Supports multiple retrieval methods:
 * - By code ID
 * - By file path
 * - By semantic search query
 * - By explanation type
 */
import { logger } from '../utils/logger.js';
import { RecallExplanationInput } from './types.js';
/**
 * RecallCodeExplanation - Retrieve stored explanations
 *
 * Features:
 * - Multiple retrieval methods
 * - Semantic search support
 * - Quality filtering
 * - Type filtering
 */
export class RecallCodeExplanation {
    db;
    embeddingProvider;
    name = 'recall_code_explanation';
    description = `Retrieve stored code explanations. Search by:
- codeId: Get explanations for a specific code file
- filePath: Get explanations by file path pattern
- query: Semantic search for related explanations
- explanationType: Filter by type (general, architectural, etc.)
- minQuality: Filter by minimum quality score (0-1)`;
    inputSchema = {
        type: 'object',
        properties: {
            codeId: {
                type: 'string',
                format: 'uuid',
                description: 'UUID of the code file'
            },
            filePath: {
                type: 'string',
                description: 'File path pattern to search (supports % wildcard)'
            },
            query: {
                type: 'string',
                description: 'Semantic search query'
            },
            explanationType: {
                type: 'string',
                enum: ['general', 'architectural', 'algorithmic', 'usage', 'gotchas',
                    'performance', 'security', 'debugging', 'history', 'todo'],
                description: 'Filter by explanation type'
            },
            minQuality: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                default: 0,
                description: 'Minimum quality score (0-1)'
            },
            limit: {
                type: 'number',
                minimum: 1,
                maximum: 100,
                default: 10,
                description: 'Maximum results to return'
            }
        }
    };
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
    }
    async execute(params) {
        const validatedParams = RecallExplanationInput.parse(params);
        logger.debug({ params: validatedParams }, 'Recalling code explanations');
        try {
            let explanations;
            if (validatedParams.query) {
                // Semantic search mode
                explanations = await this.semanticSearch(validatedParams.query, validatedParams.explanationType, validatedParams.minQuality, validatedParams.limit);
            }
            else {
                // Direct lookup mode
                explanations = await this.directLookup(validatedParams);
            }
            // Update use counts for retrieved explanations
            if (explanations.length > 0) {
                await this.updateUseCounts(explanations.map(e => e.id));
            }
            logger.info({
                resultCount: explanations.length,
                method: validatedParams.query ? 'semantic' : 'direct'
            }, 'Recalled code explanations');
            return {
                success: true,
                explanations,
                total: explanations.length,
                message: `Found ${explanations.length} explanation(s)`
            };
        }
        catch (error) {
            logger.error({ error, params: validatedParams }, 'Failed to recall explanations');
            return {
                success: false,
                explanations: [],
                total: 0,
                message: error instanceof Error ? error.message : 'Failed to recall explanations'
            };
        }
    }
    /**
     * Semantic search for explanations
     */
    async semanticSearch(query, explanationType, minQuality = 0, limit = 10) {
        // Generate embedding for query
        const queryEmbedding = await this.embeddingProvider.generateEmbedding(query);
        if (!queryEmbedding || queryEmbedding.length === 0) {
            logger.warn('Failed to generate query embedding, falling back to text search');
            return this.textSearch(query, explanationType, minQuality, limit);
        }
        const embeddingStr = `[${queryEmbedding.join(',')}]`;
        // Vector similarity search
        const result = await this.db.query(`SELECT *,
        1 - (embedding <=> $1::vector) as similarity
       FROM code_explanations
       WHERE embedding IS NOT NULL
       AND quality_score >= $2
       ${explanationType ? 'AND explanation_type = $5' : ''}
       ORDER BY embedding <=> $1::vector
       LIMIT $3`, explanationType
            ? [embeddingStr, minQuality, limit, undefined, explanationType]
            : [embeddingStr, minQuality, limit]);
        return result.rows.map((row) => this.rowToExplanation(row));
    }
    /**
     * Text-based search fallback
     */
    async textSearch(query, explanationType, minQuality = 0, limit = 10) {
        const result = await this.db.query(`SELECT *,
        ts_rank(to_tsvector('english', explanation_text), plainto_tsquery('english', $1)) as rank
       FROM code_explanations
       WHERE to_tsvector('english', explanation_text) @@ plainto_tsquery('english', $1)
       AND quality_score >= $2
       ${explanationType ? 'AND explanation_type = $4' : ''}
       ORDER BY rank DESC
       LIMIT $3`, explanationType
            ? [query, minQuality, limit, explanationType]
            : [query, minQuality, limit]);
        return result.rows.map((row) => ({
            ...this.rowToExplanation(row),
            similarity: row.rank
        }));
    }
    /**
     * Direct lookup by codeId or filePath
     */
    async directLookup(params) {
        let query = `SELECT * FROM code_explanations WHERE 1=1`;
        const values = [];
        let paramIndex = 1;
        if (params.codeId) {
            query += ` AND code_id = $${paramIndex++}`;
            values.push(params.codeId);
        }
        if (params.filePath) {
            query += ` AND file_path LIKE $${paramIndex++}`;
            values.push(`%${params.filePath}%`);
        }
        if (params.explanationType) {
            query += ` AND explanation_type = $${paramIndex++}`;
            values.push(params.explanationType);
        }
        if (params.minQuality !== undefined) {
            query += ` AND quality_score >= $${paramIndex++}`;
            values.push(params.minQuality);
        }
        query += ` ORDER BY quality_score DESC, use_count DESC`;
        query += ` LIMIT $${paramIndex++}`;
        values.push(params.limit);
        const result = await this.db.query(query, values);
        return result.rows.map((row) => this.rowToExplanation(row));
    }
    /**
     * Convert database row to CodeExplanation
     */
    rowToExplanation(row) {
        return {
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
            metadata: row.metadata,
            similarity: row.similarity ?? row.rank
        };
    }
    /**
     * Update use counts for retrieved explanations
     */
    async updateUseCounts(explanationIds) {
        if (explanationIds.length === 0)
            return;
        await this.db.query(`UPDATE code_explanations
       SET use_count = use_count + 1
       WHERE id = ANY($1)`, [explanationIds]);
    }
}
//# sourceMappingURL=recallExplanation.js.map