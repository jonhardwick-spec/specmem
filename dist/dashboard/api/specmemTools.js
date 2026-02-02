/**
 * specmemTools.ts - HTTP API that calls ACTUAL MCP Tools
 *
 * These endpoints invoke the real MCP tool classes (FindWhatISaid, RememberThisShit, etc.)
 * so HTTP clients get the SAME output as MCP tool calls - including embeddings,
 * semantic search, similarity scores, etc.
 *
 * PROJECT ISOLATED: All destructive operations are scoped to current project
 */
import { Router } from 'express';
import { logger } from '../../utils/logger.js';
import { getProjectPathForInsert } from '../../services/ProjectContext.js';
// Import the ACTUAL MCP tool classes
import { FindWhatISaid } from '../../tools/goofy/findWhatISaid.js';
import { RememberThisShit } from '../../tools/goofy/rememberThisShit.js';
import { YeahNahDeleteThat } from '../../tools/goofy/yeahNahDeleteThat.js';
import { ShowMeTheStats } from '../../tools/goofy/showMeTheStats.js';
import { LinkTheVibes } from '../../tools/goofy/linkTheVibes.js';
import { DrillDown } from '../../tools/goofy/drillDown.js';
import { CompareInstanceMemory } from '../../tools/goofy/compareInstanceMemory.js';
import { getMemoryManager } from '../../utils/memoryManager.js';
// Tool instances (initialized when router is created)
let findTool = null;
let rememberTool = null;
let deleteTool = null;
let statsTool = null;
let linkTool = null;
let drillDownTool = null;
let toolsInitialized = false;
export function createSpecmemToolsRouter(getDb, requireAuth, getEmbeddingProvider) {
    const router = Router();
    // Initialize tools when first request comes in (lazy init)
    // NOTE: Re-initializes if embeddingProvider becomes available after initial null
    const initTools = () => {
        // Get current embedding provider (may be null initially, set later)
        const embeddingProvider = getEmbeddingProvider?.();
        // If already initialized and embedding provider hasn't changed, return
        if (toolsInitialized && findTool) {
            return true;
        }
        const db = getDb();
        if (!db || !embeddingProvider) {
            logger.warn('Cannot init MCP tools - db or embeddingProvider not available');
            return false;
        }
        try {
            findTool = new FindWhatISaid(db, embeddingProvider);
            rememberTool = new RememberThisShit(db, embeddingProvider);
            deleteTool = new YeahNahDeleteThat(db);
            statsTool = new ShowMeTheStats(db);
            linkTool = new LinkTheVibes(db);
            drillDownTool = new DrillDown(db);
            toolsInitialized = true;
            logger.info('MCP tools initialized for HTTP API - full semantic search enabled!');
            return true;
        }
        catch (err) {
            logger.error({ err }, 'Failed to initialize MCP tools');
            return false;
        }
    };
    /**
     * POST /api/specmem/remember - Store a memory using REAL RememberThisShit tool
     */
    router.post('/remember', requireAuth, async (req, res) => {
        try {
            const { content, memoryType, importance, tags, metadata } = req.body;
            if (!content) {
                res.status(400).json({ success: false, error: 'Content is required' });
                return;
            }
            const db = getDb();
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not available' });
                return;
            }
            const hasTools = initTools();
            if (hasTools && rememberTool) {
                // Use the REAL MCP tool!
                const result = await rememberTool.execute({
                    content,
                    memoryType: memoryType || 'semantic',
                    importance: importance || 'medium',
                    tags: tags || [],
                    metadata: metadata || {}
                });
                logger.info({ result }, 'Memory stored via HTTP using MCP tool');
                res.json({
                    success: true,
                    memory: result,
                    hasEmbedding: true,
                    message: 'Memory stored with embeddings fr fr'
                });
            }
            else {
                // REFUSE to store without embeddings - would corrupt semantic search
                // Storing memories without embeddings creates orphaned data that pollutes search results
                logger.error('Attempted to store memory without embedding provider - REFUSING');
                res.status(503).json({
                    success: false,
                    error: 'Embedding provider not available. Cannot store memories without embeddings as this corrupts semantic search. Please ensure the Frankenstein embedding service is running.',
                    retryable: true
                });
            }
        }
        catch (error) {
            logger.error({ error }, 'Error storing memory via API');
            res.status(500).json({ success: false, error: 'Failed to store memory' });
        }
    });
    /**
     * POST /api/specmem/find - Search memories using REAL FindWhatISaid tool
     */
    router.post('/find', requireAuth, async (req, res) => {
        try {
            const { query, limit, threshold, memoryTypes, tags, importance, dateRange, includeExpired } = req.body;
            if (!query) {
                res.status(400).json({ success: false, error: 'Query is required' });
                return;
            }
            const db = getDb();
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not available' });
                return;
            }
            const hasTools = initTools();
            if (hasTools && findTool) {
                // Use the REAL MCP tool with semantic search!
                // NOTE: Local hash-based embeddings produce low similarity scores (0.1-0.4 typical)
                // so we use a lower default threshold than OpenAI embeddings would need
                const results = await findTool.execute({
                    query,
                    limit: limit || 10,
                    threshold: threshold || 0.1,
                    memoryTypes,
                    tags,
                    importance,
                    dateRange,
                    includeExpired: includeExpired || false
                });
                logger.info({ query, resultCount: results.length }, 'Semantic search via HTTP using MCP tool');
                // If semantic search returned results, use them
                if (results.length > 0) {
                    res.json({
                        success: true,
                        memories: results.map((r) => ({
                            ...r.memory,
                            similarity: r.similarity,
                            highlights: r.highlights
                        })),
                        count: results.length,
                        searchType: 'semantic',
                        message: `Found ${results.length} memories with semantic search fr fr`
                    });
                    return;
                }
                // HYBRID FALLBACK: If semantic returns 0 results, try text search
                // This handles cases where local embeddings don't match existing embeddings
                logger.info({ query }, 'Semantic search returned 0 results, falling back to hybrid text search');
                // First try PostgreSQL full-text search for better word matching
                let sqlQuery = `
          SELECT id, content, memory_type, importance, tags, metadata, created_at, updated_at,
                 ts_rank(content_tsv, plainto_tsquery('english', $1)) as rank
          FROM memories
          WHERE content_tsv @@ plainto_tsquery('english', $1)
        `;
                const params = [query];
                let paramIndex = 2;
                if (memoryTypes?.length) {
                    sqlQuery += ` AND memory_type = ANY($${paramIndex}::text[])`;
                    params.push(memoryTypes);
                    paramIndex++;
                }
                if (tags?.length) {
                    sqlQuery += ` AND tags && $${paramIndex}::text[]`;
                    params.push(tags);
                    paramIndex++;
                }
                sqlQuery += ` ORDER BY rank DESC, created_at DESC LIMIT $${paramIndex}`;
                params.push(limit || 10);
                let textResult = await db.query(sqlQuery, params);
                // If full-text search returned nothing, fall back to ILIKE on exact query
                if (textResult.rows.length === 0) {
                    logger.info({ query }, 'Full-text search returned 0 results, trying ILIKE fallback');
                    sqlQuery = `
            SELECT id, content, memory_type, importance, tags, metadata, created_at, updated_at
            FROM memories
            WHERE content ILIKE $1
          `;
                    const iLikeParams = [`%${query}%`];
                    paramIndex = 2;
                    if (memoryTypes?.length) {
                        sqlQuery += ` AND memory_type = ANY($${paramIndex}::text[])`;
                        iLikeParams.push(memoryTypes);
                        paramIndex++;
                    }
                    if (tags?.length) {
                        sqlQuery += ` AND tags && $${paramIndex}::text[]`;
                        iLikeParams.push(tags);
                        paramIndex++;
                    }
                    sqlQuery += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
                    iLikeParams.push(limit || 10);
                    textResult = await db.query(sqlQuery, iLikeParams);
                }
                res.json({
                    success: true,
                    memories: textResult.rows,
                    count: textResult.rows.length,
                    searchType: 'hybrid',
                    message: `Found ${textResult.rows.length} memories (semantic->text hybrid search)`
                });
                return;
            }
            else {
                // Fallback to text search if embedding provider not available
                // Use full-text search first, then ILIKE fallback
                // PROJECT ISOLATION: Filter by project_path
                const projectPath = getProjectPathForInsert();
                let sqlQuery = `
          SELECT id, content, memory_type, importance, tags, metadata, created_at, updated_at,
                 ts_rank(content_tsv, plainto_tsquery('english', $1)) as rank
          FROM memories
          WHERE content_tsv @@ plainto_tsquery('english', $1)
            AND project_path = $2
        `;
                const params = [query, projectPath];
                let paramIndex = 3;
                if (memoryTypes?.length) {
                    sqlQuery += ` AND memory_type = ANY($${paramIndex}::text[])`;
                    params.push(memoryTypes);
                    paramIndex++;
                }
                if (tags?.length) {
                    sqlQuery += ` AND tags && $${paramIndex}::text[]`;
                    params.push(tags);
                    paramIndex++;
                }
                sqlQuery += ` ORDER BY rank DESC, created_at DESC LIMIT $${paramIndex}`;
                params.push(limit || 10);
                let result = await db.query(sqlQuery, params);
                // ILIKE fallback if full-text search returns nothing
                if (result.rows.length === 0) {
                    sqlQuery = `
            SELECT id, content, memory_type, importance, tags, metadata, created_at, updated_at
            FROM memories
            WHERE content ILIKE $1
              AND project_path = $2
          `;
                    const iLikeParams = [`%${query}%`, projectPath];
                    paramIndex = 3;
                    if (memoryTypes?.length) {
                        sqlQuery += ` AND memory_type = ANY($${paramIndex}::text[])`;
                        iLikeParams.push(memoryTypes);
                        paramIndex++;
                    }
                    if (tags?.length) {
                        sqlQuery += ` AND tags && $${paramIndex}::text[]`;
                        iLikeParams.push(tags);
                        paramIndex++;
                    }
                    sqlQuery += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
                    iLikeParams.push(limit || 10);
                    result = await db.query(sqlQuery, iLikeParams);
                }
                res.json({
                    success: true,
                    memories: result.rows,
                    count: result.rows.length,
                    searchType: 'text',
                    message: `Found ${result.rows.length} memories (text search fallback)`
                });
            }
        }
        catch (error) {
            logger.error({ error }, 'Error searching memories via API');
            res.status(500).json({ success: false, error: 'Failed to search memories' });
        }
    });
    /**
     * POST /api/specmem/semantic - Semantic search
     */
    router.post('/semantic', requireAuth, async (req, res) => {
        try {
            const { query, limit, threshold } = req.body;
            if (!query) {
                res.status(400).json({ success: false, error: 'Query is required' });
                return;
            }
            const db = getDb();
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not available' });
                return;
            }
            const hasTools = initTools();
            if (hasTools && findTool) {
                // Use FindWhatISaid for semantic search
                // NOTE: Local hash-based embeddings produce low similarity scores (0.1-0.4 typical)
                const results = await findTool.execute({
                    query,
                    limit: limit || 5,
                    threshold: threshold || 0.1
                });
                // If semantic search returned results, use them
                if (results.length > 0) {
                    res.json({
                        success: true,
                        memories: results.map((r) => ({
                            ...r.memory,
                            similarity: r.similarity,
                            highlights: r.highlights
                        })),
                        count: results.length,
                        searchType: 'semantic',
                        message: 'Semantic search complete with embeddings'
                    });
                    return;
                }
                // HYBRID FALLBACK: If semantic returns 0 results, try text search
                // PROJECT ISOLATION: Filter by project_path
                logger.info({ query }, 'Semantic search returned 0 results, falling back to text search');
                const projectPath = getProjectPathForInsert();
                const textResult = await db.query(`SELECT id, content, memory_type, importance, tags, metadata, created_at
           FROM memories
           WHERE content ILIKE $1
             AND project_path = $2
           ORDER BY created_at DESC
           LIMIT $3`, [`%${query}%`, projectPath, limit || 5]);
                res.json({
                    success: true,
                    memories: textResult.rows,
                    count: textResult.rows.length,
                    searchType: 'hybrid',
                    message: `Found ${textResult.rows.length} memories (semantic->text hybrid search)`
                });
            }
            else {
                // Fallback when embedding provider not available
                // PROJECT ISOLATION: Filter by project_path
                const projectPath = getProjectPathForInsert();
                const result = await db.query(`SELECT id, content, memory_type, importance, tags, metadata, created_at
           FROM memories
           WHERE content ILIKE $1
             AND project_path = $2
           ORDER BY created_at DESC
           LIMIT $3`, [`%${query}%`, projectPath, limit || 5]);
                res.json({
                    success: true,
                    memories: result.rows,
                    count: result.rows.length,
                    searchType: 'text',
                    message: 'Semantic search complete (text fallback)'
                });
            }
        }
        catch (error) {
            logger.error({ error }, 'Error in semantic search via API');
            res.status(500).json({ success: false, error: 'Failed to perform semantic search' });
        }
    });
    /**
     * DELETE /api/specmem/delete/:id - Delete memory
     */
    router.delete('/delete/:id', requireAuth, async (req, res) => {
        try {
            const { id } = req.params;
            const db = getDb();
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not available' });
                return;
            }
            const hasTools = initTools();
            if (hasTools && deleteTool) {
                const result = await deleteTool.execute({ id });
                res.json({
                    success: true,
                    result,
                    message: 'Memory yeeted successfully fr fr'
                });
            }
            else {
                // Fallback: PROJECT ISOLATED - only delete from current project
                const projectPath = getProjectPathForInsert();
                const result = await db.query('DELETE FROM memories WHERE id = $1 AND project_path = $2 RETURNING id', [id, projectPath]);
                if (result.rows.length === 0) {
                    res.status(404).json({ success: false, error: 'Memory not found in project' });
                    return;
                }
                res.json({ success: true, message: 'Memory yeeted successfully fr fr' });
            }
        }
        catch (error) {
            logger.error({ error }, 'Error deleting memory via API');
            res.status(500).json({ success: false, error: 'Failed to delete memory' });
        }
    });
    /**
     * GET /api/specmem/stats - Get stats
     */
    router.get('/stats', requireAuth, async (req, res) => {
        try {
            const db = getDb();
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not available' });
                return;
            }
            const hasTools = initTools();
            if (hasTools && statsTool) {
                const stats = await statsTool.execute({});
                res.json({
                    success: true,
                    stats,
                    message: 'Stats retrieved fr fr'
                });
            }
            else {
                // PROJECT ISOLATION: Filter stats to current project only
                const projectPath = getProjectPathForInsert();
                const stats = await db.query(`
          SELECT
            COUNT(*) as total_memories,
            COUNT(DISTINCT memory_type) as memory_types,
            COUNT(DISTINCT importance) as importance_levels,
            pg_size_pretty(pg_total_relation_size('memories')) as table_size
          FROM memories
          WHERE project_path = $1
        `, [projectPath]);
                const memUsage = process.memoryUsage();
                res.json({
                    success: true,
                    database: stats.rows[0],
                    memory: {
                        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
                        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
                        rssMB: Math.round(memUsage.rss / 1024 / 1024)
                    },
                    message: 'Stats retrieved fr fr'
                });
            }
        }
        catch (error) {
            logger.error({ error }, 'Error fetching stats via API');
            res.status(500).json({ success: false, error: 'Failed to fetch stats' });
        }
    });
    /**
     * GET /api/specmem/instances - Compare memory usage across all SpecMem instances
     */
    router.get('/instances', requireAuth, async (req, res) => {
        try {
            const compareTool = new CompareInstanceMemory();
            const sortBy = req.query.sortBy;
            const sortDirection = req.query.sortDirection;
            const minUsagePercent = req.query.minUsagePercent ? parseFloat(req.query.minUsagePercent) : undefined;
            const warningsOnly = req.query.warningsOnly === 'true';
            const result = await compareTool.execute({
                sortBy,
                sortDirection,
                minUsagePercent,
                warningsOnly
            });
            res.json(result);
        }
        catch (error) {
            logger.error({ error }, 'Error fetching instance stats');
            res.status(500).json({ success: false, error: 'Failed to fetch instance stats' });
        }
    });
    /**
     * POST /api/specmem/gc - Trigger garbage collection on current instance
     */
    router.post('/gc', requireAuth, async (req, res) => {
        try {
            const memoryManager = getMemoryManager();
            const beforeStats = memoryManager.getStats();
            const gcTriggered = memoryManager.triggerGC();
            if (!gcTriggered) {
                res.json({
                    success: false,
                    message: 'GC not available - start Node with --expose-gc flag',
                    beforeStats: {
                        heapUsedMB: Math.round(beforeStats.heapUsed / 1024 / 1024),
                        usagePercent: Math.round(beforeStats.usagePercent * 100)
                    }
                });
                return;
            }
            const afterStats = memoryManager.getStats();
            const freedMB = Math.round((beforeStats.heapUsed - afterStats.heapUsed) / 1024 / 1024 * 100) / 100;
            res.json({
                success: true,
                message: `GC triggered, freed ${freedMB}MB`,
                instanceId: beforeStats.instanceId,
                before: {
                    heapUsedMB: Math.round(beforeStats.heapUsed / 1024 / 1024),
                    usagePercent: Math.round(beforeStats.usagePercent * 100)
                },
                after: {
                    heapUsedMB: Math.round(afterStats.heapUsed / 1024 / 1024),
                    usagePercent: Math.round(afterStats.usagePercent * 100)
                },
                freedMB
            });
        }
        catch (error) {
            logger.error({ error }, 'Error triggering GC');
            res.status(500).json({ success: false, error: 'Failed to trigger GC' });
        }
    });
    /**
     * POST /api/specmem/link - Link memories
     */
    router.post('/link', requireAuth, async (req, res) => {
        try {
            const { sourceId, targetId, relationType, strength } = req.body;
            if (!sourceId || !targetId) {
                res.status(400).json({ success: false, error: 'Source and target IDs required' });
                return;
            }
            const db = getDb();
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not available' });
                return;
            }
            const hasTools = initTools();
            if (hasTools && linkTool) {
                const result = await linkTool.execute({
                    sourceId,
                    targetIds: [targetId],
                    relationType: relationType || 'related',
                    strength: strength || 0.5
                });
                res.json({
                    success: true,
                    result,
                    message: 'Memories linked successfully fr fr'
                });
            }
            else {
                await db.query(`INSERT INTO memory_relations (source_id, target_id, relation_type, created_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (source_id, target_id, relation_type) DO NOTHING`, [sourceId, targetId, relationType || 'related']);
                res.json({ success: true, message: 'Memories linked successfully fr fr' });
            }
        }
        catch (error) {
            logger.error({ error }, 'Error linking memories via API');
            res.status(500).json({ success: false, error: 'Failed to link memories' });
        }
    });
    /**
     * POST /api/specmem/drilldown - Drill down into a specific memory
     *
     * Camera Roll Drilldown: Use a drilldownID from find_memory results to zoom
     * into a specific memory and explore related content.
     *
     * Request body:
     *   - drilldownId: number (required) - The drilldownID from camera roll results
     *   - includeCode: boolean (optional, default: true) - Include code references
     *   - includeContext: boolean (optional, default: true) - Include conversation context
     *   - includeRelated: boolean (optional, default: true) - Include related memories
     *   - relatedLimit: number (optional, default: 5) - Max related memories to return
     *   - compress: boolean (optional, default: true) - Apply Chinese compression
     *
     * Returns CameraRollItem format with full content and exploration options.
     */
    router.post('/drilldown', requireAuth, async (req, res) => {
        try {
            const { drilldownId, includeCode = true, includeContext = true, includeRelated = true, relatedLimit = 5, compress = true } = req.body;
            // Validate drilldownId
            if (drilldownId === undefined || drilldownId === null) {
                res.status(400).json({
                    success: false,
                    error: 'drilldownId is required',
                    hint: 'Use find_memory with cameraRollMode to get drilldownIDs first'
                });
                return;
            }
            const numericId = parseInt(drilldownId, 10);
            if (isNaN(numericId)) {
                res.status(400).json({
                    success: false,
                    error: 'drilldownId must be a number',
                    hint: 'DrilldownIDs are numeric, e.g., 123, 456'
                });
                return;
            }
            const db = getDb();
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not available' });
                return;
            }
            const hasTools = initTools();
            if (hasTools && drillDownTool) {
                // Use the REAL DrillDown MCP tool!
                const result = await drillDownTool.execute({
                    drilldownID: numericId,
                    includeCode,
                    includeContext,
                    includeRelated,
                    relatedLimit,
                    compress
                });
                logger.info({
                    drilldownId: numericId,
                    memoryID: result.memoryID,
                    hasContent: !!result.fullContent,
                    relatedCount: result.relatedMemories?.length || 0,
                    codeRefCount: result.codeReferences?.length || 0
                }, 'Drilldown via HTTP using MCP tool');
                // Return proper CameraRollItem-compatible response
                res.json({
                    success: true,
                    drilldown: {
                        // Core content
                        content: result.fullContent,
                        CR: result.fullCR,
                        // Identification & navigation
                        drilldownID: numericId,
                        memoryID: result.memoryID,
                        type: result.type,
                        // Context
                        conversationContext: result.conversationContext,
                        // Related items for further exploration
                        relatedMemories: result.relatedMemories,
                        codeReferences: result.codeReferences,
                        // Metadata
                        timestamp: result.originalTimestamp,
                        sessionID: result.sessionID,
                        // Navigation hints
                        parentDrilldownID: result.parentDrilldownID,
                        childDrilldownIDs: result.childDrilldownIDs,
                        canDrillDeeper: result.canDrillDeeper,
                        hasMore: result.canDrillDeeper
                    },
                    _hints: {
                        reminder: result._REMINDER,
                        drilldownHint: result._DRILLDOWN_HINT
                    },
                    message: result.memoryID
                        ? `Drilldown complete for ${result.memoryID}`
                        : `Drilldown ID ${numericId} not found or expired`
                });
            }
            else {
                // Fallback: Try direct database lookup if tools not initialized
                // This won't have full drilldown features but provides basic functionality
                logger.warn('DrillDown tool not initialized, using direct database fallback');
                // We can't use drilldownRegistry without the tool, so just return an error
                res.status(503).json({
                    success: false,
                    error: 'DrillDown tool not initialized',
                    hint: 'Ensure embedding provider is available for full drilldown functionality'
                });
            }
        }
        catch (error) {
            logger.error({ error }, 'Error in drilldown via API');
            res.status(500).json({ success: false, error: 'Failed to perform drilldown' });
        }
    });
    // ==================== TEAM_MEMBER COMMUNICATION HTTP ENDPOINTS ====================
    /**
     * POST /api/specmem/team-member/heartbeat - Send team member heartbeat
     */
    router.post('/team-member/heartbeat', requireAuth, async (req, res) => {
        try {
            const { teamMemberId, teamMemberName, teamMemberType, status, metadata } = req.body;
            if (!teamMemberId) {
                res.status(400).json({ success: false, error: 'teamMemberId is required' });
                return;
            }
            const db = getDb();
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not available' });
                return;
            }
            await db.query(`INSERT INTO team_member_sessions (team_member_id, team_member_name, team_member_type, status, metadata, last_heartbeat, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (team_member_id) DO UPDATE SET
           team_member_name = COALESCE(EXCLUDED.team_member_name, team_member_sessions.team_member_name),
           team_member_type = COALESCE(EXCLUDED.team_member_type, team_member_sessions.team_member_type),
           status = EXCLUDED.status,
           metadata = COALESCE(EXCLUDED.metadata, team_member_sessions.metadata),
           last_heartbeat = NOW()`, [teamMemberId, teamMemberName || teamMemberId, teamMemberType || 'worker', status || 'active', JSON.stringify(metadata || {})]);
            logger.info({ teamMemberId, status }, 'Team Member heartbeat via HTTP API');
            res.json({
                success: true,
                teamMemberId,
                status: status || 'active',
                timestamp: new Date().toISOString(),
                message: 'Heartbeat received fr fr'
            });
        }
        catch (error) {
            logger.error({ error }, 'Error processing heartbeat via API');
            res.status(500).json({ success: false, error: 'Failed to process heartbeat' });
        }
    });
    /**
     * POST /api/specmem/team-member/message - Send message to team member
     */
    router.post('/team-member/message', requireAuth, async (req, res) => {
        try {
            const { from, to, message, priority, metadata } = req.body;
            if (!from || !message) {
                res.status(400).json({ success: false, error: 'from and message are required' });
                return;
            }
            const db = getDb();
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not available' });
                return;
            }
            const tags = [
                'team-member-message',
                `from:${from}`,
                `to:${to || 'all'}`,
                `type:${to === 'all' ? 'broadcast' : 'direct'}`,
                `priority:${priority || 'medium'}`
            ];
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            // PROJECT ISOLATION: Get fresh project path at call time
            const projectPath = getProjectPathForInsert();
            const result = await db.query(`INSERT INTO memories (content, memory_type, importance, tags, metadata, expires_at, created_at, updated_at, project_path)
         VALUES ($1, 'team_member_message', $2, $3, $4, $5, NOW(), NOW(), $6)
         RETURNING id, created_at`, [message, priority || 'medium', tags, JSON.stringify({ from, to: to || 'all', type: to === 'all' ? 'broadcast' : 'direct', ...metadata }), expiresAt, projectPath]);
            logger.info({ from, to: to || 'all', messageId: result.rows[0].id }, 'Team Member message sent via HTTP API');
            res.json({
                success: true,
                messageId: result.rows[0].id,
                from,
                to: to || 'all',
                timestamp: result.rows[0].created_at,
                message: 'Message sent fr fr'
            });
        }
        catch (error) {
            logger.error({ error }, 'Error sending team member message via API');
            res.status(500).json({ success: false, error: 'Failed to send message' });
        }
    });
    /**
     * GET /api/specmem/team-member/messages - Get messages for team member
     */
    router.get('/team-member/messages', requireAuth, async (req, res) => {
        try {
            const teamMemberId = req.query.teamMemberId;
            const includeExpired = req.query.includeExpired === 'true';
            const sortByPriority = req.query.sortByPriority === 'true';
            const limit = Math.min(parseInt(req.query.limit) || 50, 200);
            if (!teamMemberId) {
                res.status(400).json({ success: false, error: 'teamMemberId query parameter is required' });
                return;
            }
            const db = getDb();
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not available' });
                return;
            }
            const toTag = 'to:' + teamMemberId;
            const toAllTag = 'to:all';
            let query = `
        SELECT id, content, importance as priority, tags, metadata, created_at, expires_at
        FROM memories
        WHERE memory_type = 'team_member_message'
          AND (tags @> ARRAY[$1]::text[] OR tags @> ARRAY[$2]::text[])
      `;
            const params = [toTag, toAllTag];
            let paramIndex = 3;
            if (!includeExpired) {
                query += ` AND (expires_at IS NULL OR expires_at > NOW())`;
            }
            if (sortByPriority) {
                query += ` ORDER BY CASE importance
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
          ELSE 4
        END, created_at DESC`;
            }
            else {
                query += ` ORDER BY created_at DESC`;
            }
            query += ` LIMIT $${paramIndex}`;
            params.push(limit);
            const result = await db.query(query, params);
            const messages = result.rows.map(row => {
                const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
                return {
                    messageId: row.id,
                    from: meta.from,
                    to: meta.to,
                    content: row.content,
                    priority: row.priority,
                    messageType: meta.type,
                    timestamp: row.created_at,
                    expiresAt: row.expires_at
                };
            });
            res.json({
                success: true,
                messages,
                count: messages.length,
                hasUnread: messages.length > 0
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching team member messages via API');
            res.status(500).json({ success: false, error: 'Failed to fetch messages' });
        }
    });
    /**
     * GET /api/specmem/team-member/active - Get active team members
     */
    router.get('/team-member/active', requireAuth, async (req, res) => {
        try {
            const withinSeconds = parseInt(req.query.withinSeconds) || 60;
            const db = getDb();
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not available' });
                return;
            }
            const result = await db.query(`SELECT
           team_member_id,
           team_member_name,
           team_member_type,
           status,
           metadata,
           last_heartbeat,
           EXTRACT(EPOCH FROM (NOW() - last_heartbeat)) as seconds_ago
         FROM team_member_sessions
         WHERE last_heartbeat > NOW() - INTERVAL '${withinSeconds} seconds'
         ORDER BY last_heartbeat DESC`);
            const teamMembers = result.rows.map(row => ({
                teamMemberId: row.team_member_id,
                teamMemberName: row.team_member_name,
                teamMemberType: row.team_member_type,
                status: row.status,
                metadata: row.metadata,
                lastHeartbeat: row.last_heartbeat,
                secondsAgo: Math.round(row.seconds_ago)
            }));
            res.json({
                success: true,
                teamMembers,
                count: teamMembers.length
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching active team members via API');
            res.status(500).json({ success: false, error: 'Failed to fetch active team members' });
        }
    });
    // ==================== TEAM_MEMBER SPY ENDPOINTS ====================
    /**
     * GET /api/specmem/team-member/spy/all-messages - Get ALL team member messages for spying
     * Returns all inter-team member communications regardless of sender/recipient
     */
    router.get('/team-member/spy/all-messages', requireAuth, async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const offset = parseInt(req.query.offset) || 0;
            const sinceMinutes = parseInt(req.query.sinceMinutes) || 60;
            const db = getDb();
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not available' });
                return;
            }
            const result = await db.query(`SELECT id, content, importance as priority, tags, metadata, created_at, expires_at
         FROM memories
         WHERE memory_type = 'team_member_message'
           AND created_at > NOW() - INTERVAL '${sinceMinutes} minutes'
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`, [limit, offset]);
            const messages = result.rows.map(row => {
                const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
                return {
                    id: row.id,
                    from: meta.from || 'unknown',
                    to: meta.to || 'all',
                    message: row.content,
                    priority: row.priority,
                    type: meta.type || 'direct',
                    timestamp: row.created_at,
                    expiresAt: row.expires_at,
                    tags: row.tags
                };
            });
            res.json({
                success: true,
                messages,
                count: messages.length,
                offset,
                limit
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching all team member messages for spy');
            res.status(500).json({ success: false, error: 'Failed to fetch messages' });
        }
    });
    /**
     * GET /api/specmem/team-member/spy/history - Get team member heartbeat history
     * Returns historical team member activity including disconnected team members
     */
    router.get('/team-member/spy/history', requireAuth, async (req, res) => {
        try {
            const sinceHours = parseInt(req.query.sinceHours) || 24;
            const limit = Math.min(parseInt(req.query.limit) || 50, 200);
            const db = getDb();
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not available' });
                return;
            }
            const result = await db.query(`SELECT
           team_member_id,
           team_member_name,
           team_member_type,
           status,
           metadata,
           last_heartbeat,
           created_at,
           EXTRACT(EPOCH FROM (NOW() - last_heartbeat)) as seconds_ago
         FROM team_member_sessions
         WHERE last_heartbeat > NOW() - INTERVAL '${sinceHours} hours'
         ORDER BY last_heartbeat DESC
         LIMIT $1`, [limit]);
            const teamMembers = result.rows.map(row => ({
                teamMemberId: row.team_member_id,
                teamMemberName: row.team_member_name,
                teamMemberType: row.team_member_type,
                status: row.status,
                metadata: row.metadata,
                lastHeartbeat: row.last_heartbeat,
                createdAt: row.created_at,
                secondsAgo: Math.round(row.seconds_ago),
                isActive: row.seconds_ago < 120 // Active if heartbeat within 2 mins
            }));
            res.json({
                success: true,
                teamMembers,
                count: teamMembers.length,
                sinceHours
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching team member history for spy');
            res.status(500).json({ success: false, error: 'Failed to fetch team member history' });
        }
    });
    /**
     * GET /api/specmem/team-member/spy/conversation - Get conversation between two team members
     */
    router.get('/team-member/spy/conversation', requireAuth, async (req, res) => {
        try {
            const teamMember1 = req.query.teamMember1;
            const teamMember2 = req.query.teamMember2;
            const limit = Math.min(parseInt(req.query.limit) || 50, 200);
            if (!teamMember1 || !teamMember2) {
                res.status(400).json({ success: false, error: 'teamMember1 and team member2 query parameters are required' });
                return;
            }
            const db = getDb();
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not available' });
                return;
            }
            const from1Tag = 'from:' + teamMember1;
            const to1Tag = 'to:' + teamMember1;
            const from2Tag = 'from:' + teamMember2;
            const to2Tag = 'to:' + teamMember2;
            const result = await db.query(`SELECT id, content, importance as priority, tags, metadata, created_at
         FROM memories
         WHERE memory_type = 'team_member_message'
           AND (
             (tags @> ARRAY[$1]::text[] AND tags @> ARRAY[$2]::text[])
             OR (tags @> ARRAY[$3]::text[] AND tags @> ARRAY[$4]::text[])
           )
         ORDER BY created_at ASC
         LIMIT $5`, [from1Tag, to2Tag, from2Tag, to1Tag, limit]);
            const messages = result.rows.map(row => {
                const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
                return {
                    id: row.id,
                    from: meta.from,
                    to: meta.to,
                    message: row.content,
                    priority: row.priority,
                    timestamp: row.created_at
                };
            });
            res.json({
                success: true,
                conversation: messages,
                count: messages.length,
                participants: [teamMember1, teamMember2]
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching team member conversation');
            res.status(500).json({ success: false, error: 'Failed to fetch conversation' });
        }
    });
    /**
     * GET /api/specmem/team-member/spy/stats - Get team member communication statistics
     */
    router.get('/team-member/spy/stats', requireAuth, async (req, res) => {
        try {
            const sinceHours = parseInt(req.query.sinceHours) || 24;
            const db = getDb();
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not available' });
                return;
            }
            // Get message counts
            const messageStats = await db.query(`SELECT COUNT(*) as total_messages,
                COUNT(DISTINCT ARRAY(SELECT unnest(tags) WHERE unnest LIKE 'from:%')) as unique_senders
         FROM memories
         WHERE memory_type = 'team_member_message'
           AND created_at > NOW() - INTERVAL '${sinceHours} hours'`);
            // Get active team member count
            const teamMemberStats = await db.query(`SELECT
           COUNT(*) as total_teamMembers,
           COUNT(CASE WHEN last_heartbeat > NOW() - INTERVAL '2 minutes' THEN 1 END) as active_teamMembers,
           COUNT(DISTINCT team_member_type) as team_member_types
         FROM team_member_sessions
         WHERE last_heartbeat > NOW() - INTERVAL '${sinceHours} hours'`);
            // Get messages per team member
            const perTeamMemberStats = await db.query(`SELECT
           tags,
           COUNT(*) as message_count
         FROM memories
         WHERE memory_type = 'team_member_message'
           AND created_at > NOW() - INTERVAL '${sinceHours} hours'
         GROUP BY tags
         ORDER BY message_count DESC
         LIMIT 20`);
            res.json({
                success: true,
                stats: {
                    totalMessages: parseInt(messageStats.rows[0]?.total_messages || '0'),
                    totalTeamMembers: parseInt(teamMemberStats.rows[0]?.total_teamMembers || '0'),
                    activeTeamMembers: parseInt(teamMemberStats.rows[0]?.active_teamMembers || '0'),
                    teamMemberTypes: parseInt(teamMemberStats.rows[0]?.team_member_types || '0'),
                    sinceHours
                }
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching team member spy stats');
            res.status(500).json({ success: false, error: 'Failed to fetch stats' });
        }
    });
    return router;
}
export default createSpecmemToolsRouter;
//# sourceMappingURL=specmemTools.js.map