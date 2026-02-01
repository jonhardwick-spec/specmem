/**
 * whatDidIMean - recall memories by ID or filters
 *
 * when you need to get specific memories back
 * supports pagination, sorting, and filtering
 */
import { logger } from '../../utils/logger.js';
import { smartCompress } from '../../utils/tokenCompressor.js';
import { buildProjectWhereClause, getProjectContext } from '../../services/ProjectContext.js';
import { formatHumanReadable } from '../../utils/humanReadableOutput.js';
/**
 * WhatDidIMean - memory recall tool
 *
 * retrieves memories by ID or filter criteria
 * supports pagination because we might have A LOT of memories
 *
 * Returns human-readable format for better readability
 */
export class WhatDidIMean {
    db;
    name = 'get_memory';
    description = 'Get memories by ID or filter criteria - supports pagination and sorting. Returns human-readable format.';
    inputSchema = {
        type: 'object',
        properties: {
            id: {
                type: 'string',
                format: 'uuid',
                description: 'specific memory ID to retrieve'
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'filter by tags (OR logic)'
            },
            limit: {
                type: 'number',
                default: 50,
                minimum: 1,
                maximum: 1000,
                description: 'max number of memories to return'
            },
            offset: {
                type: 'number',
                default: 0,
                minimum: 0,
                description: 'skip this many memories for pagination'
            },
            orderBy: {
                type: 'string',
                enum: ['created', 'updated', 'accessed', 'importance'],
                default: 'created',
                description: 'how to sort the results'
            },
            orderDirection: {
                type: 'string',
                enum: ['asc', 'desc'],
                default: 'desc',
                description: 'sort direction'
            },
            summarize: {
                type: 'boolean',
                default: false,
                description: 'Optional - truncate content to save context when browsing. Default false (full content for drill-down)'
            },
            maxContentLength: {
                type: 'number',
                default: 0,
                description: 'Optional - truncate content to this many chars. 0 = full content (default)'
            }
        }
    };
    // Compaction options interface
    compactionOpts = {};
    constructor(db) {
        this.db = db;
    }
    async execute(params) {
        logger.debug({ params }, 'recalling memories');
        // Store compaction options for use in rowToMemory
        this.compactionOpts = {
            summarize: params.summarize,
            maxContentLength: params.maxContentLength
        };
        try {
            // if we got a specific ID, just get that one
            if (params.id) {
                const memory = await this.getMemoryById(params.id);
                if (!memory) {
                    // Return empty results - memory not found
                    return formatHumanReadable('get_memory', [], {
                        grey: true,
                        showSimilarity: false,
                        maxContentLength: params.maxContentLength || 300
                    });
                }
                // Convert single memory to human-readable format
                const humanReadableData = [{
                        id: memory.id,
                        similarity: 1.0,
                        content: memory.content || '',
                    }];
                return formatHumanReadable('get_memory', humanReadableData, {
                    grey: true,
                    showSimilarity: false,
                    maxContentLength: params.maxContentLength || 300
                });
            }
            // otherwise do a filtered query - return as human-readable
            const result = await this.getMemoriesWithFilters(params);
            // Convert memories array to human-readable format
            const humanReadableData = result.memories.map(m => ({
                id: m.id,
                similarity: 0.5,
                content: m.content || '',
            }));
            return formatHumanReadable('get_memory', humanReadableData, {
                grey: true,
                showSimilarity: true,
                maxContentLength: params.maxContentLength || 300
            });
        }
        catch (error) {
            logger.error({ error, params }, 'recall failed');
            throw error;
        }
    }
    /**
     * get a single memory by ID
     *
     * also updates access count cuz we tracking that
     */
    async getMemoryById(id) {
        const result = await this.db.query(`UPDATE memories
       SET access_count = access_count + 1,
           last_accessed_at = NOW()
       WHERE id = $1
       RETURNING
         id, content, memory_type, importance, tags, metadata,
         embedding, created_at, updated_at, access_count, last_accessed_at,
         expires_at, consolidated_from, image_data, image_mime_type`, [id]);
        if (result.rows.length === 0) {
            return null;
        }
        return this.rowToMemory(result.rows[0]);
    }
    /**
     * get memories with filters, pagination, and sorting
     */
    async getMemoriesWithFilters(params) {
        const conditions = [];
        const queryParams = [];
        let paramIndex = 1;
        // PROJECT NAMESPACING: Filter by current project
        const projectFilter = buildProjectWhereClause(paramIndex);
        conditions.push(projectFilter.sql);
        queryParams.push(projectFilter.param);
        paramIndex = projectFilter.nextIndex;
        // tags filter
        if (params.tags?.length) {
            conditions.push(`tags && $${paramIndex}::text[]`);
            queryParams.push(params.tags);
            paramIndex++;
        }
        // default: exclude expired
        conditions.push('(expires_at IS NULL OR expires_at > NOW())');
        // build ORDER BY clause
        const orderColumn = this.getOrderColumn(params.orderBy ?? 'created');
        const orderDirection = params.orderDirection === 'asc' ? 'ASC' : 'DESC';
        const whereClause = conditions.length > 0
            ? `WHERE ${conditions.join(' AND ')}`
            : '';
        // get total count first
        const countResult = await this.db.query(`SELECT COUNT(*) as count FROM memories ${whereClause}`, queryParams);
        const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
        // get the memories
        const limit = params.limit ?? 50;
        const offset = params.offset ?? 0;
        const query = `
      SELECT
        id, content, memory_type, importance, tags, metadata,
        embedding, created_at, updated_at, access_count, last_accessed_at,
        expires_at, consolidated_from, image_data, image_mime_type
      FROM memories
      ${whereClause}
      ORDER BY ${orderColumn} ${orderDirection} NULLS LAST
      LIMIT ${limit}
      OFFSET ${offset}
    `;
        const result = await this.db.query(query, queryParams);
        // update access counts for retrieved memories
        if (result.rows.length > 0) {
            const ids = result.rows.map((r) => r.id);
            await this.db.query(`UPDATE memories
         SET access_count = access_count + 1,
             last_accessed_at = NOW()
         WHERE id = ANY($1::uuid[])`, [ids]);
        }
        return {
            memories: result.rows.map((row) => this.rowToMemory(row)),
            total,
            hasMore: offset + result.rows.length < total,
            page: { offset, limit }
        };
    }
    /**
     * get related memories through the relationship graph
     *
     * traverses memory_relations to find connected memories
     */
    async getRelatedMemories(memoryId, depth = 1) {
        // PROJECT NAMESPACING: Filter by current project
        const projectPath = getProjectContext().getProjectPath();
        const query = `
      WITH RECURSIVE related AS (
        -- start with direct relations
        SELECT target_id AS id, 1 AS depth
        FROM memory_relations
        WHERE source_id = $1

        UNION

        -- add reverse relations
        SELECT source_id AS id, 1 AS depth
        FROM memory_relations
        WHERE target_id = $1

        UNION ALL

        -- traverse deeper
        SELECT
          CASE WHEN mr.source_id = r.id THEN mr.target_id ELSE mr.source_id END AS id,
          r.depth + 1
        FROM related r
        JOIN memory_relations mr ON (mr.source_id = r.id OR mr.target_id = r.id)
        WHERE r.depth < $2
      )
      SELECT DISTINCT m.*
      FROM related r
      JOIN memories m ON m.id = r.id
      WHERE m.id != $1
        AND (m.expires_at IS NULL OR m.expires_at > NOW())
        AND m.project_path = $3
      LIMIT 50
    `;
        const result = await this.db.query(query, [memoryId, depth, projectPath]);
        return result.rows.map((row) => this.rowToMemory(row));
    }
    /**
     * get all chunks of a chunked memory
     *
     * useful when you stored something big and it got split
     */
    async getMemoryChunks(parentId) {
        // PROJECT NAMESPACING: Filter by current project
        const projectPath = getProjectContext().getProjectPath();
        const query = `
      SELECT
        id, content, memory_type, importance, tags, metadata,
        embedding, created_at, updated_at, access_count, last_accessed_at,
        expires_at, consolidated_from, image_data, image_mime_type
      FROM memories
      WHERE
        (id = $1
        OR tags @> ARRAY['parent-' || $1]::text[]
        OR metadata->>'parentId' = $1)
        AND project_path = $2
      ORDER BY
        CASE WHEN id = $1 THEN 0 ELSE 1 END,
        (metadata->>'chunkIndex')::int NULLS LAST
    `;
        const result = await this.db.query(query, [parentId, projectPath]);
        return result.rows.map((row) => this.rowToMemory(row));
    }
    getOrderColumn(orderBy) {
        switch (orderBy) {
            case 'created':
                return 'created_at';
            case 'updated':
                return 'updated_at';
            case 'accessed':
                return 'last_accessed_at';
            case 'importance':
                return `CASE importance
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          WHEN 'trivial' THEN 5
        END`;
            default:
                return 'created_at';
        }
    }
    rowToMemory(row) {
        // Apply Chinese Compactor approach with truncation + compression
        let content = row.content;
        let contentTruncated = false;
        let compressionRatio = 1.0;
        const originalLength = row.content.length;
        // STEP 1: Truncate first based on options
        if (this.compactionOpts.summarize) {
            // Default summary: first 500 chars
            if (content.length > 500) {
                content = content.substring(0, 500) + '...';
                contentTruncated = true;
            }
        }
        else if (this.compactionOpts.maxContentLength && this.compactionOpts.maxContentLength > 0) {
            if (content.length > this.compactionOpts.maxContentLength) {
                content = content.substring(0, this.compactionOpts.maxContentLength) + '...';
                contentTruncated = true;
            }
        }
        // STEP 2: Apply Chinese compression for additional token savings
        // Only compress if content is long enough to benefit
        if (content.length > 50) {
            const compressed = smartCompress(content, {
                threshold: 0.80, // Allow slightly lossy for big savings
                minLength: 30
            });
            content = compressed.result;
            compressionRatio = compressed.compressionRatio;
        }
        return {
            id: row.id,
            content: content,
            memoryType: row.memory_type,
            importance: row.importance,
            tags: row.tags,
            metadata: {
                ...row.metadata,
                // Add truncation/compression indicators for drill-down awareness
                ...(contentTruncated ? {
                    _truncated: true,
                    _len: originalLength,
                    _drill: `get_memory id:${row.id.substring(0, 8)}`
                } : {}),
                ...(compressionRatio < 0.9 ? { _compressed: true } : {}),
                // SEMANTIC HINTS: Extract keywords from content instead of raw embedding
                _semanticHints: this.extractSemanticKeywords(row.content, row.tags)
            },
            embedding: undefined, // Replaced with semantic keywords in metadata._semanticHints
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            accessCount: row.access_count,
            lastAccessedAt: row.last_accessed_at ?? undefined,
            expiresAt: row.expires_at ?? undefined,
            consolidatedFrom: row.consolidated_from ?? undefined,
            imageData: row.image_data ? row.image_data.toString('base64') : undefined,
            imageMimeType: row.image_mime_type ?? undefined
        };
    }
    parseEmbedding(embeddingStr) {
        const cleaned = embeddingStr.replace(/[\[\]]/g, '');
        return cleaned.split(',').map(Number);
    }
    /**
     * Extract semantic keywords from content for drill-down context
     * Returns Chinese-compacted keywords sorted by relevance
     *
     * This replaces the useless 1536-number embedding with actual meaningful words
     */
    extractSemanticKeywords(content, tags) {
        // Extract technical terms (PascalCase, CONSTANTS, technical words)
        const techTerms = content.match(/\b(?:[A-Z][a-z]+){2,}\b|\b[A-Z][A-Z0-9_]{2,}\b/g) || [];
        // Extract code-related words
        const codeWords = content.match(/\b(?:function|class|const|let|var|async|await|return|import|export|interface|type)\b/g) || [];
        // Extract file paths
        const filePaths = content.match(/(?:\/[\w.-]+)+\.(?:ts|js|tsx|jsx|py|go|rs|java|json|yaml|md|css|html|sql|sh)/g) || [];
        // Extract common nouns and verbs (simple heuristic)
        const words = content.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
        const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'been', 'were', 'will', 'would', 'could', 'should']);
        const meaningfulWords = words.filter(w => !stopWords.has(w));
        // Count word frequency
        const wordFreq = new Map();
        for (const word of meaningfulWords) {
            wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
        }
        // Get top 10 most frequent words
        const topWords = Array.from(wordFreq.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([word]) => word);
        // Combine all keywords
        const keywords = [
            ...new Set([
                ...techTerms.slice(0, 5),
                ...codeWords.slice(0, 3),
                ...filePaths.slice(0, 2).map(p => p.split('/').pop().replace(/\.\w+$/, '')),
                ...topWords.slice(0, 8),
                ...tags.filter(t => !t.startsWith('claude-') && !t.startsWith('role:')).slice(0, 3)
            ])
        ];
        // NO compression here - these keywords feed into Mini COT which expects English
        // Compression happens on OUTPUT, not INPUT to Mini COT
        const keywordString = keywords.join(', ');
        return keywordString.slice(0, 200); // Max 200 chars
    }
}
//# sourceMappingURL=whatDidIMean.js.map