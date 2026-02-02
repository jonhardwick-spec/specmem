/**
 * get_related_code - Find code related to a prompt or memory
 *
 * Uses the link system to find code that has been associated
 * with specific conversations or topics.
 */
import { logger } from '../utils/logger.js';
import { GetRelatedCodeInput } from './types.js';
/**
 * GetRelatedCode - Find code related to conversations
 *
 * Features:
 * - Find by memory ID
 * - Semantic search by query
 * - Filter by relationship type
 * - Strength-based ranking
 */
export class GetRelatedCode {
    db;
    embeddingProvider;
    name = 'get_related_code';
    description = `Find code related to a conversation or topic. Search by:
- memoryId: Find code linked to a specific memory/prompt
- query: Semantic search for related code
- relationshipTypes: Filter by relationship type(s)
- minStrength: Filter by minimum link strength (0-1)`;
    inputSchema = {
        type: 'object',
        properties: {
            memoryId: {
                type: 'string',
                format: 'uuid',
                description: 'UUID of the memory to find related code for'
            },
            query: {
                type: 'string',
                description: 'Semantic search query to find related code'
            },
            relationshipTypes: {
                type: 'array',
                items: {
                    type: 'string',
                    enum: ['referenced', 'explained', 'modified', 'debugged', 'created',
                        'related', 'imported', 'depends_on', 'tested']
                },
                description: 'Filter by relationship type(s)'
            },
            minStrength: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                default: 0.5,
                description: 'Minimum link strength (0-1)'
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
        const validatedParams = GetRelatedCodeInput.parse(params);
        logger.debug({
            memoryId: validatedParams.memoryId,
            query: validatedParams.query
        }, 'Finding related code');
        try {
            let results;
            if (validatedParams.memoryId) {
                // Find by memory ID
                results = await this.findByMemoryId(validatedParams.memoryId, validatedParams.relationshipTypes, validatedParams.minStrength, validatedParams.limit);
            }
            else if (validatedParams.query) {
                // Semantic search
                results = await this.semanticSearch(validatedParams.query, validatedParams.relationshipTypes, validatedParams.minStrength, validatedParams.limit);
            }
            else {
                results = [];
            }
            // Update access patterns for found code
            const codeIds = results.map(r => r.codeId).filter(Boolean);
            if (codeIds.length > 0) {
                await this.updateAccessPatterns(codeIds, validatedParams.query);
            }
            logger.info({ resultCount: results.length }, 'Found related code');
            return {
                success: true,
                relatedCode: results,
                total: results.length,
                message: `Found ${results.length} related code file(s)`
            };
        }
        catch (error) {
            logger.error({ error, params: validatedParams }, 'Failed to find related code');
            return {
                success: false,
                relatedCode: [],
                total: 0,
                message: error instanceof Error ? error.message : 'Failed to find related code'
            };
        }
    }
    /**
     * Find code by memory ID
     */
    async findByMemoryId(memoryId, relationshipTypes, minStrength = 0.5, limit = 10) {
        let query = `
      SELECT
        cpl.code_id,
        COALESCE(cf.file_path, (cpl.metadata->>'filePath')::text) as file_path,
        cpl.relationship_type,
        cpl.strength,
        cpl.context,
        ce.explanation_text
      FROM code_prompt_links cpl
      LEFT JOIN codebase_files cf ON cpl.code_id = cf.id
      LEFT JOIN code_explanations ce ON cpl.explanation_id = ce.id
      WHERE cpl.memory_id = $1
      AND cpl.strength >= $2
    `;
        const values = [memoryId, minStrength];
        let paramIndex = 3;
        if (relationshipTypes && relationshipTypes.length > 0) {
            query += ` AND cpl.relationship_type = ANY($${paramIndex++})`;
            values.push(relationshipTypes);
        }
        query += ` ORDER BY cpl.strength DESC LIMIT $${paramIndex}`;
        values.push(limit);
        const result = await this.db.query(query, values);
        return result.rows.map((row) => ({
            codeId: row.code_id,
            filePath: row.file_path,
            relationshipType: row.relationship_type,
            strength: row.strength,
            context: row.context ?? undefined,
            explanation: row.explanation_text ?? undefined
        }));
    }
    /**
     * Semantic search for related code
     */
    async semanticSearch(query, relationshipTypes, minStrength = 0.5, limit = 10) {
        // Generate embedding for query
        const queryEmbedding = await this.embeddingProvider.generateEmbedding(query);
        if (!queryEmbedding || queryEmbedding.length === 0) {
            return this.textSearch(query, relationshipTypes, minStrength, limit);
        }
        const embeddingStr = `[${queryEmbedding.join(',')}]`;
        // Search through code explanations first
        let searchQuery = `
      SELECT DISTINCT ON (cf.id)
        cf.id as code_id,
        cf.file_path,
        'related' as relationship_type,
        (1 - (ce.embedding <=> $1::vector)) as strength,
        ce.explanation_text,
        NULL as context
      FROM code_explanations ce
      JOIN codebase_files cf ON ce.code_id = cf.id
      WHERE ce.embedding IS NOT NULL
      AND (1 - (ce.embedding <=> $1::vector)) >= $2
    `;
        const values = [embeddingStr, minStrength];
        let paramIndex = 3;
        if (relationshipTypes && relationshipTypes.length > 0) {
            // For semantic search, we use the explanation results but can still filter
            searchQuery += ` AND 'related' = ANY($${paramIndex++})`;
            values.push(relationshipTypes);
        }
        searchQuery += `
      ORDER BY cf.id, strength DESC
      LIMIT $${paramIndex}
    `;
        values.push(limit);
        const result = await this.db.query(searchQuery, values);
        return result.rows.map((row) => ({
            codeId: row.code_id,
            filePath: row.file_path,
            relationshipType: row.relationship_type,
            strength: row.strength,
            explanation: row.explanation_text ?? undefined,
            context: row.context ?? undefined
        }));
    }
    /**
     * Text-based search fallback
     */
    async textSearch(query, relationshipTypes, minStrength = 0.5, limit = 10) {
        let searchQuery = `
      SELECT DISTINCT ON (cf.id)
        cf.id as code_id,
        cf.file_path,
        'related' as relationship_type,
        ts_rank(to_tsvector('english', ce.explanation_text), plainto_tsquery('english', $1)) as strength,
        ce.explanation_text,
        NULL as context
      FROM code_explanations ce
      JOIN codebase_files cf ON ce.code_id = cf.id
      WHERE to_tsvector('english', ce.explanation_text) @@ plainto_tsquery('english', $1)
      AND ts_rank(to_tsvector('english', ce.explanation_text), plainto_tsquery('english', $1)) >= $2
    `;
        const values = [query, minStrength];
        let paramIndex = 3;
        if (relationshipTypes && relationshipTypes.length > 0) {
            searchQuery += ` AND 'related' = ANY($${paramIndex++})`;
            values.push(relationshipTypes);
        }
        searchQuery += `
      ORDER BY cf.id, strength DESC
      LIMIT $${paramIndex}
    `;
        values.push(limit);
        const result = await this.db.query(searchQuery, values);
        return result.rows.map((row) => ({
            codeId: row.code_id,
            filePath: row.file_path,
            relationshipType: row.relationship_type,
            strength: row.strength,
            explanation: row.explanation_text ?? undefined,
            context: row.context ?? undefined
        }));
    }
    /**
     * Update access patterns for found code
     */
    async updateAccessPatterns(codeIds, query) {
        const hour = new Date().getHours();
        const day = new Date().getDay();
        for (const codeId of codeIds) {
            await this.db.query(`INSERT INTO code_access_patterns (code_id, access_count, last_accessed, common_queries)
         VALUES ($1, 1, NOW(), $2)
         ON CONFLICT (code_id) DO UPDATE SET
           access_count = code_access_patterns.access_count + 1,
           last_accessed = NOW(),
           common_queries = CASE
             WHEN $3::text IS NOT NULL AND $3 != ''
             THEN array_append(
               (SELECT common_queries[array_length(common_queries, 1) - 9:array_length(common_queries, 1)]
                FROM code_access_patterns WHERE code_id = $1),
               $3
             )
             ELSE code_access_patterns.common_queries
           END,
           hourly_access_pattern[$4] = code_access_patterns.hourly_access_pattern[$4] + 1,
           daily_access_pattern[$5] = code_access_patterns.daily_access_pattern[$5] + 1`, [
                codeId,
                query ? [query] : [],
                query ?? null,
                hour + 1,
                day + 1
            ]);
        }
    }
}
//# sourceMappingURL=getRelatedCode.js.map