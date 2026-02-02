/**
 * memoryRecall.ts - Memory Recall API Endpoints
 *
 * Phase 1: Memory Recall Viewer Backend APIs
 *
 * Endpoints:
 * - GET /api/memory/recall/:id - Get specific memory by ID
 * - GET /api/memory/search - Search memories with pagination
 * - GET /api/memory/recent - Get recent memories
 * - GET /api/memory/by-tags - Filter memories by tags
 * - GET /api/memory/:id/related - Get related memories
 * - POST /api/memory/export - Export memories (JSON/CSV)
 * - DELETE /api/memory/:id - Delete a memory
 *
 * PROJECT ISOLATED: All operations are scoped to current project
 */
import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { getProjectPathForInsert } from '../../services/ProjectContext.js';
// ============================================================================
// Validation Schemas
// ============================================================================
const SearchQuerySchema = z.object({
    q: z.string().max(1000).optional(),
    query: z.string().max(1000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    memoryType: z.enum(['episodic', 'semantic', 'procedural', 'working', 'consolidated']).optional(),
    importance: z.enum(['critical', 'high', 'medium', 'low', 'trivial']).optional(),
    orderBy: z.enum(['created', 'updated', 'accessed', 'importance']).default('created'),
    orderDirection: z.enum(['asc', 'desc']).default('desc')
});
const RecentQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(30)
});
const TagsQuerySchema = z.object({
    tags: z.string().min(1), // Comma-separated tags
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0)
});
const ExportRequestSchema = z.object({
    format: z.enum(['json', 'csv']).default('json'),
    ids: z.array(z.string().uuid()).optional(),
    tags: z.array(z.string()).optional(),
    memoryType: z.enum(['episodic', 'semantic', 'procedural', 'working', 'consolidated']).optional(),
    limit: z.number().int().min(1).max(1000).default(100)
});
// ============================================================================
// Memory Recall API Router Factory
// ============================================================================
export function createMemoryRecallRouter(db) {
    const router = Router();
    /**
     * GET /api/memory/recall/:id
     * Get a specific memory by its UUID
     */
    router.get('/recall/:id', async (req, res) => {
        try {
            const { id } = req.params;
            // Validate UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(id)) {
                res.status(400).json({ error: 'Invalid memory ID format' });
                return;
            }
            // PROJECT ISOLATION: Only access memories from current project
            const projectPath = getProjectPathForInsert();
            const result = await db.query(`UPDATE memories
         SET access_count = access_count + 1,
             last_accessed_at = NOW()
         WHERE id = $1 AND project_path = $2
         RETURNING
           id, content, memory_type, importance, tags, metadata,
           embedding, created_at, updated_at, access_count, last_accessed_at,
           expires_at, consolidated_from, image_data, image_mime_type`, [id, projectPath]);
            if (result.rows.length === 0) {
                res.status(404).json({ error: 'Memory not found in project' });
                return;
            }
            const memory = rowToMemory(result.rows[0]);
            res.json({ success: true, memory });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching memory by ID');
            res.status(500).json({ error: 'Failed to fetch memory' });
        }
    });
    /**
     * GET /api/memory/search
     * Search memories with full-text search and filters
     */
    router.get('/search', async (req, res) => {
        try {
            const parseResult = SearchQuerySchema.safeParse(req.query);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Invalid query parameters',
                    details: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
                });
                return;
            }
            const { q, query, limit, offset, memoryType, importance, orderBy, orderDirection } = parseResult.data;
            const searchQuery = q || query || '';
            // PROJECT ISOLATION: Always filter by project_path
            const projectPath = getProjectPathForInsert();
            const conditions = ['project_path = $1', '(expires_at IS NULL OR expires_at > NOW())'];
            const queryParams = [projectPath];
            let paramIndex = 2;
            // Full-text search condition
            if (searchQuery) {
                conditions.push(`content_tsv @@ plainto_tsquery('english', $${paramIndex})`);
                queryParams.push(searchQuery);
                paramIndex++;
            }
            // Memory type filter
            if (memoryType) {
                conditions.push(`memory_type = $${paramIndex}::memory_type`);
                queryParams.push(memoryType);
                paramIndex++;
            }
            // Importance filter
            if (importance) {
                conditions.push(`importance = $${paramIndex}::importance_level`);
                queryParams.push(importance);
                paramIndex++;
            }
            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            // Get total count
            const countResult = await db.query(`SELECT COUNT(*) as count FROM memories ${whereClause}`, queryParams);
            const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
            // Build ORDER BY
            const orderColumn = getOrderColumn(orderBy);
            const orderDir = orderDirection === 'asc' ? 'ASC' : 'DESC';
            // Get memories
            const memoriesQuery = `
        SELECT
          id, content, memory_type, importance, tags, metadata,
          embedding, created_at, updated_at, access_count, last_accessed_at,
          expires_at, consolidated_from, image_data, image_mime_type
        FROM memories
        ${whereClause}
        ORDER BY ${orderColumn} ${orderDir} NULLS LAST
        LIMIT ${limit}
        OFFSET ${offset}
      `;
            const result = await db.query(memoriesQuery, queryParams);
            const response = {
                memories: result.rows.map(row => rowToMemory(row)),
                total,
                hasMore: offset + result.rows.length < total,
                page: { offset, limit }
            };
            res.json(response);
        }
        catch (error) {
            logger.error({ error }, 'Error searching memories');
            res.status(500).json({ error: 'Failed to search memories' });
        }
    });
    /**
     * GET /api/memory/recent
     * Get most recently created memories
     */
    router.get('/recent', async (req, res) => {
        try {
            const parseResult = RecentQuerySchema.safeParse(req.query);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Invalid query parameters',
                    details: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
                });
                return;
            }
            const { limit } = parseResult.data;
            // PROJECT ISOLATION: Only fetch from current project
            const projectPath = getProjectPathForInsert();
            const result = await db.query(`SELECT
           id, content, memory_type, importance, tags, metadata,
           embedding, created_at, updated_at, access_count, last_accessed_at,
           expires_at, consolidated_from, image_data, image_mime_type
         FROM memories
         WHERE project_path = $1 AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at DESC
         LIMIT $2`, [projectPath, limit]);
            res.json({
                success: true,
                memories: result.rows.map(row => rowToMemory(row)),
                count: result.rows.length
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching recent memories');
            res.status(500).json({ error: 'Failed to fetch recent memories' });
        }
    });
    /**
     * GET /api/memory/by-tags
     * Filter memories by tags (OR logic)
     */
    router.get('/by-tags', async (req, res) => {
        try {
            const parseResult = TagsQuerySchema.safeParse(req.query);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Invalid query parameters',
                    details: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
                });
                return;
            }
            const { tags: tagsStr, limit, offset } = parseResult.data;
            const tags = tagsStr.split(',').map(t => t.trim()).filter(t => t.length > 0);
            if (tags.length === 0) {
                res.status(400).json({ error: 'At least one tag is required' });
                return;
            }
            // PROJECT ISOLATION: Filter by project_path
            const projectPath = getProjectPathForInsert();
            // Get total count
            const countResult = await db.query(`SELECT COUNT(*) as count FROM memories
         WHERE project_path = $1
           AND tags && $2::text[]
           AND (expires_at IS NULL OR expires_at > NOW())`, [projectPath, tags]);
            const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
            // Get memories
            const result = await db.query(`SELECT
           id, content, memory_type, importance, tags, metadata,
           embedding, created_at, updated_at, access_count, last_accessed_at,
           expires_at, consolidated_from, image_data, image_mime_type
         FROM memories
         WHERE project_path = $1
           AND tags && $2::text[]
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`, [projectPath, tags, limit, offset]);
            res.json({
                memories: result.rows.map(row => rowToMemory(row)),
                total,
                hasMore: offset + result.rows.length < total,
                page: { offset, limit },
                searchedTags: tags
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching memories by tags');
            res.status(500).json({ error: 'Failed to fetch memories by tags' });
        }
    });
    /**
     * GET /api/memory/:id/related
     * Get related memories via memory_relations table (link_the_vibes)
     */
    router.get('/:id/related', async (req, res) => {
        try {
            const { id } = req.params;
            const depth = Math.min(parseInt(req.query.depth) || 1, 3);
            // Validate UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(id)) {
                res.status(400).json({ error: 'Invalid memory ID format' });
                return;
            }
            const query = `
        WITH RECURSIVE related AS (
          -- Start with direct relations
          SELECT target_id AS id, 1 AS depth, relation_type, strength
          FROM memory_relations
          WHERE source_id = $1

          UNION

          -- Add reverse relations
          SELECT source_id AS id, 1 AS depth, relation_type, strength
          FROM memory_relations
          WHERE target_id = $1

          UNION ALL

          -- Traverse deeper
          SELECT
            CASE WHEN mr.source_id = r.id THEN mr.target_id ELSE mr.source_id END AS id,
            r.depth + 1,
            mr.relation_type,
            mr.strength
          FROM related r
          JOIN memory_relations mr ON (mr.source_id = r.id OR mr.target_id = r.id)
          WHERE r.depth < $2
        )
        SELECT DISTINCT ON (m.id)
          m.id, m.content, m.memory_type, m.importance, m.tags, m.metadata,
          m.embedding, m.created_at, m.updated_at, m.access_count, m.last_accessed_at,
          m.expires_at, m.consolidated_from, m.image_data, m.image_mime_type,
          r.relation_type, r.strength, r.depth as relation_depth
        FROM related r
        JOIN memories m ON m.id = r.id
        WHERE m.id != $1
          AND (m.expires_at IS NULL OR m.expires_at > NOW())
        ORDER BY m.id, r.depth ASC
        LIMIT 50
      `;
            const result = await db.query(query, [id, depth]);
            const relatedMemories = result.rows.map(row => ({
                memory: rowToMemory(row),
                relationType: row.relation_type,
                strength: row.strength,
                depth: row.relation_depth
            }));
            res.json({
                success: true,
                sourceMemoryId: id,
                relatedMemories,
                count: relatedMemories.length
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching related memories');
            res.status(500).json({ error: 'Failed to fetch related memories' });
        }
    });
    /**
     * POST /api/memory/export
     * Export memories in JSON or CSV format
     */
    router.post('/export', async (req, res) => {
        try {
            const parseResult = ExportRequestSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Invalid request body',
                    details: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
                });
                return;
            }
            const { format, ids, tags, memoryType, limit } = parseResult.data;
            const conditions = ['(expires_at IS NULL OR expires_at > NOW())'];
            const queryParams = [];
            let paramIndex = 1;
            if (ids && ids.length > 0) {
                conditions.push(`id = ANY($${paramIndex}::uuid[])`);
                queryParams.push(ids);
                paramIndex++;
            }
            if (tags && tags.length > 0) {
                conditions.push(`tags && $${paramIndex}::text[]`);
                queryParams.push(tags);
                paramIndex++;
            }
            if (memoryType) {
                conditions.push(`memory_type = $${paramIndex}::memory_type`);
                queryParams.push(memoryType);
                paramIndex++;
            }
            const whereClause = `WHERE ${conditions.join(' AND ')}`;
            const result = await db.query(`SELECT
           id, content, memory_type, importance, tags, metadata,
           created_at, updated_at, access_count, last_accessed_at,
           expires_at, consolidated_from
         FROM memories
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT ${limit}`, queryParams);
            const memories = result.rows.map(row => rowToMemory(row));
            if (format === 'csv') {
                // Generate CSV
                const headers = ['id', 'content', 'memoryType', 'importance', 'tags', 'createdAt', 'accessCount'];
                const csvRows = [headers.join(',')];
                for (const memory of memories) {
                    const row = [
                        memory.id,
                        `"${(memory.content || '').replace(/"/g, '""').substring(0, 500)}"`,
                        memory.memoryType,
                        memory.importance,
                        `"${(memory.tags || []).join(';')}"`,
                        memory.createdAt.toISOString(),
                        memory.accessCount.toString()
                    ];
                    csvRows.push(row.join(','));
                }
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename=memories-export.csv');
                res.send(csvRows.join('\n'));
            }
            else {
                // Return JSON
                res.json({
                    success: true,
                    exported: memories.length,
                    memories,
                    exportedAt: new Date().toISOString()
                });
            }
        }
        catch (error) {
            logger.error({ error }, 'Error exporting memories');
            res.status(500).json({ error: 'Failed to export memories' });
        }
    });
    /**
     * DELETE /api/memory/:id
     * Delete a specific memory
     */
    router.delete('/:id', async (req, res) => {
        try {
            const { id } = req.params;
            // Validate UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(id)) {
                res.status(400).json({ error: 'Invalid memory ID format' });
                return;
            }
            // PROJECT ISOLATED: Only delete from current project
            const projectPath = getProjectPathForInsert();
            const result = await db.query('DELETE FROM memories WHERE id = $1 AND project_path = $2 RETURNING id', [id, projectPath]);
            if (result.rowCount === 0) {
                res.status(404).json({ error: 'Memory not found in project' });
                return;
            }
            logger.info({ memoryId: id, projectPath }, 'Memory deleted via dashboard');
            res.json({ success: true, deletedId: id });
        }
        catch (error) {
            logger.error({ error }, 'Error deleting memory');
            res.status(500).json({ error: 'Failed to delete memory' });
        }
    });
    /**
     * GET /api/memory/stats
     * Get memory statistics for dashboard
     */
    router.get('/stats', async (req, res) => {
        try {
            const result = await db.query(`
        SELECT
          COUNT(*) as total,
          jsonb_object_agg(COALESCE(memory_type::text, 'unknown'), type_count) as by_type,
          jsonb_object_agg(COALESCE(importance::text, 'unknown'), imp_count) as by_importance,
          COALESCE(AVG(access_count), 0)::text as avg_access_count,
          COUNT(*) FILTER (WHERE embedding IS NOT NULL)::text as with_embeddings,
          COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < NOW())::text as expired
        FROM (
          SELECT
            memory_type,
            importance,
            access_count,
            embedding,
            expires_at,
            COUNT(*) OVER (PARTITION BY memory_type) as type_count,
            COUNT(*) OVER (PARTITION BY importance) as imp_count
          FROM memories
        ) sub
      `);
            // Simpler approach - run separate queries
            // PROJECT ISOLATION: All stats scoped to current project
            const projectPath = getProjectPathForInsert();
            const totalResult = await db.query('SELECT COUNT(*) as count FROM memories WHERE project_path = $1', [projectPath]);
            const typeResult = await db.query(`SELECT memory_type::text, COUNT(*) as count FROM memories WHERE project_path = $1 GROUP BY memory_type`, [projectPath]);
            const importanceResult = await db.query(`SELECT importance::text, COUNT(*) as count FROM memories WHERE project_path = $1 GROUP BY importance`, [projectPath]);
            const embeddingResult = await db.query(`SELECT COUNT(*) as count FROM memories WHERE project_path = $1 AND embedding IS NOT NULL`, [projectPath]);
            const expiredResult = await db.query(`SELECT COUNT(*) as count FROM memories WHERE project_path = $1 AND expires_at IS NOT NULL AND expires_at < NOW()`, [projectPath]);
            const avgAccessResult = await db.query(`SELECT COALESCE(AVG(access_count), 0)::text as avg FROM memories WHERE project_path = $1`, [projectPath]);
            const stats = {
                total: parseInt(totalResult.rows[0]?.count ?? '0', 10),
                byType: Object.fromEntries(typeResult.rows.map(r => [r.memory_type, parseInt(r.count, 10)])),
                byImportance: Object.fromEntries(importanceResult.rows.map(r => [r.importance, parseInt(r.count, 10)])),
                withEmbeddings: parseInt(embeddingResult.rows[0]?.count ?? '0', 10),
                expired: parseInt(expiredResult.rows[0]?.count ?? '0', 10),
                averageAccessCount: parseFloat(avgAccessResult.rows[0]?.avg ?? '0')
            };
            res.json({ success: true, stats });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching memory stats');
            res.status(500).json({ error: 'Failed to fetch memory stats' });
        }
    });
    return router;
}
// ============================================================================
// Helper Functions
// ============================================================================
function rowToMemory(row) {
    return {
        id: row.id,
        content: row.content,
        memoryType: row.memory_type,
        importance: row.importance,
        tags: row.tags,
        metadata: row.metadata,
        embedding: row.embedding ? parseEmbedding(row.embedding) : undefined,
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
function parseEmbedding(embeddingStr) {
    const cleaned = embeddingStr.replace(/[\[\]]/g, '');
    return cleaned.split(',').map(Number);
}
function getOrderColumn(orderBy) {
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
//# sourceMappingURL=memoryRecall.js.map