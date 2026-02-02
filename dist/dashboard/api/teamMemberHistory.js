/**
 * teamMemberHistory.ts - Team Member History & Communications API Endpoints
 *
 * Phase 2: Team Member History & Communications Viewer Backend APIs
 *
 * Endpoints:
 * - GET /api/team-members/history - All team member sessions with pagination
 * - GET /api/team-members/history/:id - Specific session details
 * - GET /api/team-members/communications/:id - Conversation for a session
 * - POST /api/team-members/sessions - Create a new session (for tracking)
 * - PATCH /api/team-members/sessions/:id - Update session status
 * - GET /api/team-members/communications/search - Search across communications
 * - POST /api/team-members/communications/:sessionId - Add a communication to session
 */
import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
// ============================================================================
// Validation Schemas
// ============================================================================
const HistoryQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    status: z.enum(['pending', 'running', 'completed', 'failed', 'stopped']).optional(),
    teamMemberType: z.enum(['worker', 'overseer', 'qa']).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional()
});
const CommunicationsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
    role: z.enum(['user', 'assistant', 'system', 'tool']).optional()
});
const CreateSessionSchema = z.object({
    teamMemberType: z.enum(['worker', 'overseer', 'qa']),
    task: z.string().max(10000).optional(),
    config: z.record(z.unknown()).optional()
});
const UpdateSessionSchema = z.object({
    status: z.enum(['pending', 'running', 'completed', 'failed', 'stopped']).optional(),
    task: z.string().max(10000).optional(),
    endTime: z.string().datetime().optional()
});
const AddCommunicationSchema = z.object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.string().max(100000),
    toolCalls: z.array(z.record(z.unknown())).optional()
});
// ============================================================================
// Database Schema Initialization
// ============================================================================
export async function ensureTeamMemberCommunicationsSchema(db) {
    try {
        // Create team_member_sessions table if not exists (extended version for dashboard)
        await db.query(`
      CREATE TABLE IF NOT EXISTS dashboard_team_member_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        team_member_type VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        task TEXT,
        config JSONB DEFAULT '{}',
        start_time TIMESTAMPTZ DEFAULT NOW(),
        end_time TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
        // Create team member_communications table
        await db.query(`
      CREATE TABLE IF NOT EXISTS team member_communications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES dashboard_team_member_sessions(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        tool_calls JSONB,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
        // Create indexes for performance
        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_status ON dashboard_team_member_sessions(status)
    `);
        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_type ON dashboard_team_member_sessions(team_member_type)
    `);
        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_start ON dashboard_team_member_sessions(start_time DESC)
    `);
        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_communications_session ON team member_communications(session_id)
    `);
        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_communications_timestamp ON team member_communications(timestamp DESC)
    `);
        logger.info('Team Member communications schema ensured');
    }
    catch (error) {
        logger.error({ error }, 'Failed to create team member communications schema');
        throw error;
    }
}
// ============================================================================
// Team Member History API Router Factory
// ============================================================================
export function createTeamMemberHistoryRouter(db) {
    const router = Router();
    // Ensure schema exists on first request
    let schemaInitialized = false;
    router.use(async (req, res, next) => {
        if (!schemaInitialized) {
            try {
                await ensureTeamMemberCommunicationsSchema(db);
                schemaInitialized = true;
            }
            catch (error) {
                logger.error({ error }, 'Failed to initialize team member communications schema');
            }
        }
        next();
    });
    /**
     * GET /api/team-members/history
     * Get all team member sessions with pagination and filters
     */
    router.get('/history', async (req, res) => {
        try {
            const parseResult = HistoryQuerySchema.safeParse(req.query);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Invalid query parameters',
                    details: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
                });
                return;
            }
            const { limit, offset, status, teamMemberType, startDate, endDate } = parseResult.data;
            const conditions = [];
            const queryParams = [];
            let paramIndex = 1;
            if (status) {
                conditions.push(`status = $${paramIndex}`);
                queryParams.push(status);
                paramIndex++;
            }
            if (teamMemberType) {
                conditions.push(`team_member_type = $${paramIndex}`);
                queryParams.push(teamMemberType);
                paramIndex++;
            }
            if (startDate) {
                conditions.push(`start_time >= $${paramIndex}::timestamptz`);
                queryParams.push(startDate);
                paramIndex++;
            }
            if (endDate) {
                conditions.push(`start_time <= $${paramIndex}::timestamptz`);
                queryParams.push(endDate);
                paramIndex++;
            }
            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            // Get total count
            const countResult = await db.query(`SELECT COUNT(*) as count FROM dashboard_team_member_sessions ${whereClause}`, queryParams);
            const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
            // Get sessions with communication counts
            const result = await db.query(`SELECT s.*, COALESCE(c.cnt, 0) as message_count
         FROM dashboard_team_member_sessions s
         LEFT JOIN (
           SELECT session_id, COUNT(*) as cnt
           FROM team member_communications
           GROUP BY session_id
         ) c ON s.id = c.session_id
         ${whereClause}
         ORDER BY s.start_time DESC
         LIMIT ${limit} OFFSET ${offset}`, queryParams);
            const sessions = result.rows.map(row => ({
                ...rowToSession(row),
                messageCount: parseInt(row.message_count, 10)
            }));
            res.json({
                sessions,
                total,
                hasMore: offset + sessions.length < total,
                page: { offset, limit }
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching team member history');
            res.status(500).json({ error: 'Failed to fetch team member history' });
        }
    });
    /**
     * GET /api/team-members/history/:id
     * Get a specific session with full details
     */
    router.get('/history/:id', async (req, res) => {
        try {
            const { id } = req.params;
            // Validate UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(id)) {
                res.status(400).json({ error: 'Invalid session ID format' });
                return;
            }
            const result = await db.query(`SELECT * FROM dashboard_team_member_sessions WHERE id = $1`, [id]);
            if (result.rows.length === 0) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            const session = rowToSession(result.rows[0]);
            // Get communication count
            const countResult = await db.query(`SELECT COUNT(*) as count FROM team member_communications WHERE session_id = $1`, [id]);
            res.json({
                success: true,
                session: {
                    ...session,
                    messageCount: parseInt(countResult.rows[0]?.count ?? '0', 10)
                }
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching session details');
            res.status(500).json({ error: 'Failed to fetch session details' });
        }
    });
    /**
     * GET /api/team-members/communications/:id
     * Get all communications for a session
     */
    router.get('/communications/:id', async (req, res) => {
        try {
            const { id } = req.params;
            // Validate UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(id)) {
                res.status(400).json({ error: 'Invalid session ID format' });
                return;
            }
            const parseResult = CommunicationsQuerySchema.safeParse(req.query);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Invalid query parameters',
                    details: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
                });
                return;
            }
            const { limit, offset, role } = parseResult.data;
            // Verify session exists
            const sessionResult = await db.query(`SELECT * FROM dashboard_team_member_sessions WHERE id = $1`, [id]);
            if (sessionResult.rows.length === 0) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            const conditions = ['session_id = $1'];
            const queryParams = [id];
            let paramIndex = 2;
            if (role) {
                conditions.push(`role = $${paramIndex}`);
                queryParams.push(role);
                paramIndex++;
            }
            const whereClause = `WHERE ${conditions.join(' AND ')}`;
            // Get total count
            const countResult = await db.query(`SELECT COUNT(*) as count FROM team member_communications ${whereClause}`, queryParams);
            const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
            // Get communications
            const result = await db.query(`SELECT * FROM team member_communications
         ${whereClause}
         ORDER BY timestamp ASC
         LIMIT ${limit} OFFSET ${offset}`, queryParams);
            const communications = result.rows.map(rowToCommunication);
            res.json({
                session: rowToSession(sessionResult.rows[0]),
                communications,
                total,
                hasMore: offset + communications.length < total,
                page: { offset, limit }
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching communications');
            res.status(500).json({ error: 'Failed to fetch communications' });
        }
    });
    /**
     * POST /api/team-members/sessions
     * Create a new team member session
     */
    router.post('/sessions', async (req, res) => {
        try {
            const parseResult = CreateSessionSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Invalid request body',
                    details: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
                });
                return;
            }
            const { teamMemberType, task, config } = parseResult.data;
            const result = await db.query(`INSERT INTO dashboard_team_member_sessions (team_member_type, status, task, config)
         VALUES ($1, 'pending', $2, $3)
         RETURNING *`, [teamMemberType, task || null, config || {}]);
            const session = rowToSession(result.rows[0]);
            logger.info({ sessionId: session.id, teamMemberType }, 'New team member session created');
            res.status(201).json({ success: true, session });
        }
        catch (error) {
            logger.error({ error }, 'Error creating session');
            res.status(500).json({ error: 'Failed to create session' });
        }
    });
    /**
     * PATCH /api/team-members/sessions/:id
     * Update a session status
     */
    router.patch('/sessions/:id', async (req, res) => {
        try {
            const { id } = req.params;
            // Validate UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(id)) {
                res.status(400).json({ error: 'Invalid session ID format' });
                return;
            }
            const parseResult = UpdateSessionSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Invalid request body',
                    details: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
                });
                return;
            }
            const { status, task, endTime } = parseResult.data;
            // Build update query
            const updates = [];
            const queryParams = [];
            let paramIndex = 1;
            if (status) {
                updates.push(`status = $${paramIndex}`);
                queryParams.push(status);
                paramIndex++;
            }
            if (task !== undefined) {
                updates.push(`task = $${paramIndex}`);
                queryParams.push(task);
                paramIndex++;
            }
            if (endTime) {
                updates.push(`end_time = $${paramIndex}::timestamptz`);
                queryParams.push(endTime);
                paramIndex++;
            }
            if (updates.length === 0) {
                res.status(400).json({ error: 'No valid update fields provided' });
                return;
            }
            queryParams.push(id);
            const result = await db.query(`UPDATE dashboard_team_member_sessions
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING *`, queryParams);
            if (result.rows.length === 0) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            const session = rowToSession(result.rows[0]);
            logger.info({ sessionId: id, status }, 'Team Member session updated');
            res.json({ success: true, session });
        }
        catch (error) {
            logger.error({ error }, 'Error updating session');
            res.status(500).json({ error: 'Failed to update session' });
        }
    });
    /**
     * POST /api/team-members/communications/:sessionId
     * Add a communication to a session
     */
    router.post('/communications/:sessionId', async (req, res) => {
        try {
            const { sessionId } = req.params;
            // Validate UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(sessionId)) {
                res.status(400).json({ error: 'Invalid session ID format' });
                return;
            }
            const parseResult = AddCommunicationSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Invalid request body',
                    details: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
                });
                return;
            }
            // Verify session exists
            const sessionCheck = await db.query(`SELECT id FROM dashboard_team_member_sessions WHERE id = $1`, [sessionId]);
            if (sessionCheck.rows.length === 0) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            const { role, content, toolCalls } = parseResult.data;
            const result = await db.query(`INSERT INTO team member_communications (session_id, role, content, tool_calls)
         VALUES ($1, $2, $3, $4)
         RETURNING *`, [sessionId, role, content, toolCalls ? JSON.stringify(toolCalls) : null]);
            const communication = rowToCommunication(result.rows[0]);
            res.status(201).json({ success: true, communication });
        }
        catch (error) {
            logger.error({ error }, 'Error adding communication');
            res.status(500).json({ error: 'Failed to add communication' });
        }
    });
    /**
     * GET /api/team-members/communications/search
     * Search across all communications
     */
    router.get('/communications/search', async (req, res) => {
        try {
            const query = req.query.q;
            const limit = Math.min(parseInt(req.query.limit) || 50, 100);
            const offset = parseInt(req.query.offset) || 0;
            if (!query || query.length < 2) {
                res.status(400).json({ error: 'Search query must be at least 2 characters' });
                return;
            }
            const result = await db.query(`SELECT c.*, s.team_member_type as session_type
         FROM team member_communications c
         JOIN dashboard_team_member_sessions s ON c.session_id = s.id
         WHERE c.content ILIKE $1
         ORDER BY c.timestamp DESC
         LIMIT $2 OFFSET $3`, [`%${query}%`, limit, offset]);
            res.json({
                success: true,
                communications: result.rows.map(row => ({
                    ...rowToCommunication(row),
                    sessionType: row.session_type
                })),
                query,
                count: result.rows.length
            });
        }
        catch (error) {
            logger.error({ error }, 'Error searching communications');
            res.status(500).json({ error: 'Failed to search communications' });
        }
    });
    /**
     * GET /api/team-members/stats/sessions
     * Get aggregate session statistics
     */
    router.get('/stats/sessions', async (req, res) => {
        try {
            const [totalResult, byStatusResult, byTypeResult, recentResult] = await Promise.all([
                db.query('SELECT COUNT(*) as count FROM dashboard_team_member_sessions'),
                db.query('SELECT status, COUNT(*) as count FROM dashboard_team_member_sessions GROUP BY status'),
                db.query('SELECT team_member_type, COUNT(*) as count FROM dashboard_team_member_sessions GROUP BY team_member_type'),
                db.query(`SELECT COUNT(*) as count FROM dashboard_team_member_sessions
           WHERE start_time > NOW() - INTERVAL '24 hours'`)
            ]);
            res.json({
                success: true,
                stats: {
                    total: parseInt(totalResult.rows[0]?.count ?? '0', 10),
                    byStatus: Object.fromEntries(byStatusResult.rows.map(r => [r.status, parseInt(r.count, 10)])),
                    byType: Object.fromEntries(byTypeResult.rows.map(r => [r.team_member_type, parseInt(r.count, 10)])),
                    last24Hours: parseInt(recentResult.rows[0]?.count ?? '0', 10)
                }
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching session stats');
            res.status(500).json({ error: 'Failed to fetch session stats' });
        }
    });
    /**
     * DELETE /api/team-members/sessions/:id
     * Delete a session and all its communications
     */
    router.delete('/sessions/:id', async (req, res) => {
        try {
            const { id } = req.params;
            // Validate UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(id)) {
                res.status(400).json({ error: 'Invalid session ID format' });
                return;
            }
            const result = await db.query('DELETE FROM dashboard_team_member_sessions WHERE id = $1 RETURNING id', [id]);
            if (result.rowCount === 0) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            logger.info({ sessionId: id }, 'Team Member session deleted');
            res.json({ success: true, deletedId: id });
        }
        catch (error) {
            logger.error({ error }, 'Error deleting session');
            res.status(500).json({ error: 'Failed to delete session' });
        }
    });
    /**
     * POST /api/team-members/sessions/:id/export
     * Export a session as markdown
     */
    router.post('/sessions/:id/export', async (req, res) => {
        try {
            const { id } = req.params;
            // Validate UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(id)) {
                res.status(400).json({ error: 'Invalid session ID format' });
                return;
            }
            // Get session
            const sessionResult = await db.query('SELECT * FROM dashboard_team_member_sessions WHERE id = $1', [id]);
            if (sessionResult.rows.length === 0) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            const session = rowToSession(sessionResult.rows[0]);
            // Get all communications
            const commsResult = await db.query('SELECT * FROM team member_communications WHERE session_id = $1 ORDER BY timestamp ASC', [id]);
            const communications = commsResult.rows.map(rowToCommunication);
            // Generate markdown
            let markdown = `# TeamMember Session: ${session.teamMemberType.toUpperCase()}\n\n`;
            markdown += `**Session ID:** ${session.id}\n`;
            markdown += `**Status:** ${session.status}\n`;
            markdown += `**Started:** ${session.startTime.toISOString()}\n`;
            if (session.endTime) {
                markdown += `**Ended:** ${session.endTime.toISOString()}\n`;
            }
            if (session.task) {
                markdown += `**Task:** ${session.task}\n`;
            }
            markdown += `\n---\n\n## Conversation\n\n`;
            for (const comm of communications) {
                const roleLabel = comm.role.charAt(0).toUpperCase() + comm.role.slice(1);
                markdown += `### ${roleLabel} (${comm.timestamp.toISOString()})\n\n`;
                markdown += `${comm.content}\n\n`;
                if (comm.toolCalls && comm.toolCalls.length > 0) {
                    markdown += `**Tool Calls:**\n\`\`\`json\n${JSON.stringify(comm.toolCalls, null, 2)}\n\`\`\`\n\n`;
                }
            }
            // FIX LOW-23: Add Content-Length header for proper download handling
            const markdownBuffer = Buffer.from(markdown, 'utf-8');
            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.setHeader('Content-Length', markdownBuffer.length);
            res.setHeader('Content-Disposition', `attachment; filename=session-${id}.md`);
            res.send(markdownBuffer);
        }
        catch (error) {
            logger.error({ error }, 'Error exporting session');
            res.status(500).json({ error: 'Failed to export session' });
        }
    });
    return router;
}
// ============================================================================
// Helper Functions
// ============================================================================
function rowToSession(row) {
    return {
        id: row.id,
        teamMemberType: row.team_member_type,
        status: row.status,
        task: row.task,
        config: row.config,
        startTime: row.start_time,
        endTime: row.end_time,
        createdAt: row.created_at
    };
}
function rowToCommunication(row) {
    return {
        id: row.id,
        sessionId: row.session_id,
        role: row.role,
        content: row.content,
        toolCalls: row.tool_calls,
        timestamp: row.timestamp,
        createdAt: row.created_at
    };
}
//# sourceMappingURL=teamMemberHistory.js.map