/**
 * taskTeamMembers.ts - API endpoints for Task team member tracking
 *
 * yo fr fr this lets you view and manually log Task team members
 */
import { Router } from 'express';
import { z } from 'zod';
import { logger, serializeError } from '../../utils/logger.js';
import { getTaskTeamMemberLogger } from '../../team-members/taskTeamMemberLogger.js';
// ============================================================================
// Validation Schemas
// ============================================================================
const ManualLogSchema = z.object({
    name: z.string().min(1).max(200),
    teamMemberType: z.enum(['worker', 'overseer', 'qa']),
    description: z.string().max(2000),
    status: z.enum(['completed', 'failed']),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    result: z.string().optional(),
    error: z.string().optional(),
    logs: z.array(z.object({
        level: z.enum(['info', 'warn', 'error', 'debug']),
        message: z.string(),
        timestamp: z.string().datetime()
    })).optional(),
    metadata: z.record(z.any()).optional()
});
// ============================================================================
// Task Team Members API Router
// ============================================================================
export function createTaskTeamMembersRouter() {
    const router = Router();
    /**
     * GET /api/task-team-members/list
     * List all Task team members from database
     */
    router.get('/list', async (req, res) => {
        try {
            const limitStr = req.query.limit;
            let limit = 50; // default
            if (limitStr) {
                const parsed = parseInt(limitStr, 10);
                // FIX LOW-21: Validate parseInt result to prevent NaN propagation
                limit = isNaN(parsed) ? 50 : Math.min(Math.max(parsed, 1), 1000); // Clamp to reasonable range
            }
            const taskLogger = getTaskTeamMemberLogger();
            const teamMembers = await taskLogger.getTaskTeamMembers(limit);
            res.json({
                success: true,
                teamMembers,
                count: teamMembers.length
            });
        }
        catch (error) {
            logger.error({ error: serializeError(error) }, 'Couldn\'t get Task team members bruh');
            res.status(500).json({ error: 'Failed to fetch Task team members' });
        }
    });
    /**
     * POST /api/task-team-members/log-manual
     * Manually log a past Task team member deployment
     */
    router.post('/log-manual', async (req, res) => {
        try {
            const parseResult = ManualLogSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Nah bruh that request is wack',
                    details: parseResult.error.issues.map(i => ({
                        path: i.path.join('.'),
                        message: i.message
                    }))
                });
                return;
            }
            const data = parseResult.data;
            const taskLogger = getTaskTeamMemberLogger();
            const teamMemberId = await taskLogger.logManualDeployment({
                name: data.name,
                teamMemberType: data.teamMemberType,
                description: data.description,
                status: data.status,
                startedAt: new Date(data.startedAt),
                completedAt: new Date(data.completedAt),
                result: data.result,
                error: data.error,
                logs: data.logs?.map(log => ({
                    level: log.level,
                    message: log.message,
                    timestamp: new Date(log.timestamp)
                })),
                metadata: data.metadata
            });
            logger.info({ teamMemberId, name: data.name }, 'Task team member logged manually fr fr');
            res.json({
                success: true,
                teamMemberId,
                message: `Task team member "${data.name}" logged, no cap`
            });
        }
        catch (error) {
            logger.error({ error: serializeError(error) }, 'Couldn\'t log Task team member manually bruh');
            res.status(500).json({ error: 'Failed to log Task team member' });
        }
    });
    /**
     * POST /api/task-team-members/log-recent
     * Automatically log the most recent Task team members from  history
     *
     * yo this extracts team members from ~/.claude/history.jsonl
     */
    router.post('/log-recent', async (req, res) => {
        try {
            const limitStr = req.body.limit;
            let limit = 10; // default
            if (limitStr) {
                const parsed = parseInt(limitStr, 10);
                // FIX LOW-21: Validate parseInt result to prevent NaN propagation
                limit = isNaN(parsed) ? 10 : Math.min(Math.max(parsed, 1), 100); // Clamp to reasonable range
            }
            // TODO: Parse history.jsonl and extract Task tool invocations
            // For now, return not implemented
            res.status(501).json({
                error: 'Auto-extraction from history not implemented yet',
                message: 'Use /api/task-team-members/log-manual to manually log past team members'
            });
        }
        catch (error) {
            logger.error({ error: serializeError(error) }, 'Couldn\'t auto-log Task team members bruh');
            res.status(500).json({ error: 'Failed to auto-log Task team members' });
        }
    });
    return router;
}
//# sourceMappingURL=taskTeamMembers.js.map