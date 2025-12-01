/**
 * claudeControl.ts - Claude Control API for SpecMem Dashboard
 *
 * Provides endpoints for triggering Claude actions via MCP sampling,
 * including auto-fix, memory consolidation, and team member orchestration.
 *
 * Phase 6 Implementation - MCP -> Claude Control Flow
 */
// @ts-ignore - express types
import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';
import { getClaudeTriggerSystem } from '../../mcp/triggerSystem.js';
import { getCurrentProjectPath } from '../../services/ProjectContext.js';
import { createClaudeHistoryRouter } from './claudeHistory.js';
// ============================================================================
// Zod Validation Schemas
// ============================================================================
const TriggerActionSchema = z.enum([
    'fix-error',
    'consolidate',
    'deploy-team-member',
    'analyze-codebase',
    'summarize-session',
    'custom'
]);
const SamplingConfigSchema = z.object({
    maxTokens: z.number().int().min(100).max(100000).optional().default(4096),
    intelligencePriority: z.number().min(0).max(1).optional().default(0.9),
    speedPriority: z.number().min(0).max(1).optional().default(0.5),
    costPriority: z.number().min(0).max(1).optional().default(0.3),
    systemPrompt: z.string().max(10000).optional()
});
const TriggerRequestSchema = z.object({
    action: TriggerActionSchema,
    prompt: z.string().min(1).max(50000),
    config: SamplingConfigSchema.optional(),
    requireConfirmation: z.boolean().optional().default(true),
    context: z.object({
        errorMessage: z.string().optional(),
        filePath: z.string().optional(),
        memoryIds: z.array(z.string().uuid()).optional(),
        sessionId: z.string().optional()
    }).optional()
});
const ScheduleRequestSchema = z.object({
    action: TriggerActionSchema,
    prompt: z.string().min(1).max(50000),
    config: SamplingConfigSchema.optional(),
    schedule: z.object({
        cron: z.string().optional(),
        intervalMinutes: z.number().int().min(1).max(1440).optional(),
        runAt: z.string().datetime().optional()
    }).refine(data => data.cron || data.intervalMinutes || data.runAt, { message: 'Must specify cron, intervalMinutes, or runAt' }),
    enabled: z.boolean().default(true)
});
const TriggerHistoryQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    action: TriggerActionSchema.optional(),
    status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional()
});
// ============================================================================
// PROJECT-SCOPED In-Memory Storage
// Prevents cross-project trigger/confirmation pollution
// ============================================================================
const triggerHistoryByProject = new Map();
const scheduledTriggersByProject = new Map();
const pendingConfirmationsByProject = new Map();
const MAX_HISTORY_SIZE = 100;
/**
 * Get current project path for cache scoping
 */
function getControlProjectPath() {
    return process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
}
/**
 * Get project-scoped trigger history
 */
function getTriggerHistory() {
    const projectPath = getControlProjectPath();
    if (!triggerHistoryByProject.has(projectPath)) {
        triggerHistoryByProject.set(projectPath, []);
    }
    return triggerHistoryByProject.get(projectPath);
}
/**
 * Get project-scoped scheduled triggers
 */
function getScheduledTriggers() {
    const projectPath = getControlProjectPath();
    if (!scheduledTriggersByProject.has(projectPath)) {
        scheduledTriggersByProject.set(projectPath, new Map());
    }
    return scheduledTriggersByProject.get(projectPath);
}
/**
 * Get project-scoped pending confirmations
 */
function getPendingConfirmations() {
    const projectPath = getControlProjectPath();
    if (!pendingConfirmationsByProject.has(projectPath)) {
        pendingConfirmationsByProject.set(projectPath, new Map());
    }
    return pendingConfirmationsByProject.get(projectPath);
}
// Legacy references for backwards compatibility
const triggerHistory = { push: (v) => getTriggerHistory().push(v), unshift: (v) => getTriggerHistory().unshift(v), pop: () => getTriggerHistory().pop(), get length() { return getTriggerHistory().length; }, slice: (start, end) => getTriggerHistory().slice(start, end), splice: (start, count) => getTriggerHistory().splice(start, count), [Symbol.iterator]: () => getTriggerHistory()[Symbol.iterator]() };
const scheduledTriggers = { get: (k) => getScheduledTriggers().get(k), set: (k, v) => getScheduledTriggers().set(k, v), delete: (k) => getScheduledTriggers().delete(k), has: (k) => getScheduledTriggers().has(k), values: () => getScheduledTriggers().values(), get size() { return getScheduledTriggers().size; } };
const pendingConfirmations = { get: (k) => getPendingConfirmations().get(k), set: (k, v) => getPendingConfirmations().set(k, v), delete: (k) => getPendingConfirmations().delete(k), has: (k) => getPendingConfirmations().has(k), values: () => getPendingConfirmations().values() };
// ============================================================================
// Claude Control Router
// ============================================================================
export function createClaudeControlRouter(db, requireAuth, broadcastUpdate) {
    const router = Router();
    // mount claude code history routes at /api/claude/history
    const historyRouter = createClaudeHistoryRouter(requireAuth);
    router.use('/', historyRouter);
    /**
     * POST /api/claude/trigger - Trigger a Claude action via MCP sampling
     */
    router.post('/trigger', requireAuth, async (req, res) => {
        try {
            // Validate request
            const parseResult = TriggerRequestSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid request body',
                    details: parseResult.error.issues.map(i => ({
                        path: i.path.join('.'),
                        message: i.message
                    }))
                });
                return;
            }
            const { action, prompt, config, requireConfirmation, context } = parseResult.data;
            const triggerId = uuidv4();
            // Create history entry
            const historyEntry = {
                id: triggerId,
                action,
                prompt,
                config,
                context,
                status: requireConfirmation ? 'pending' : 'running',
                createdAt: new Date()
            };
            // Add to history
            triggerHistory.unshift(historyEntry);
            if (triggerHistory.length > MAX_HISTORY_SIZE) {
                triggerHistory.pop();
            }
            // If confirmation required, store and return
            if (requireConfirmation) {
                pendingConfirmations.set(triggerId, historyEntry);
                // Broadcast pending confirmation
                if (broadcastUpdate) {
                    broadcastUpdate('trigger_pending', {
                        id: triggerId,
                        action,
                        prompt: prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''),
                        requiresConfirmation: true
                    });
                }
                res.json({
                    success: true,
                    id: triggerId,
                    status: 'pending_confirmation',
                    message: 'Trigger created, awaiting confirmation',
                    confirmUrl: `/api/claude/trigger/${triggerId}/confirm`
                });
                return;
            }
            // Execute immediately
            historyEntry.startedAt = new Date();
            logger.info({ triggerId, action }, 'Executing Claude trigger');
            const triggerSystem = getClaudeTriggerSystem();
            const triggerAction = {
                id: triggerId,
                action,
                prompt,
                config: config || {},
                context: context || {},
                requireConfirmation: false
            };
            const result = await triggerSystem.triggerAction(triggerAction);
            // Update history
            historyEntry.status = result.success ? 'completed' : 'failed';
            historyEntry.result = result.response;
            historyEntry.errorMessage = result.error;
            historyEntry.completedAt = new Date();
            // Persist to database
            await persistTriggerHistory(db, historyEntry);
            // Broadcast completion
            if (broadcastUpdate) {
                broadcastUpdate('trigger_completed', {
                    id: triggerId,
                    action,
                    status: historyEntry.status,
                    success: result.success
                });
            }
            res.json({
                success: result.success,
                id: triggerId,
                status: historyEntry.status,
                response: result.response,
                error: result.error,
                tokensUsed: result.tokensUsed,
                duration: result.duration
            });
        }
        catch (error) {
            logger.error({ error }, 'Error triggering Claude action');
            res.status(500).json({
                success: false,
                error: 'Failed to trigger Claude action',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });
    /**
     * POST /api/claude/trigger/:id/confirm - Confirm a pending trigger
     */
    router.post('/trigger/:id/confirm', requireAuth, async (req, res) => {
        try {
            const { id } = req.params;
            const pendingTrigger = pendingConfirmations.get(id);
            if (!pendingTrigger) {
                res.status(404).json({
                    success: false,
                    error: 'Pending trigger not found or already processed'
                });
                return;
            }
            // Remove from pending
            pendingConfirmations.delete(id);
            // Update and execute
            pendingTrigger.status = 'running';
            pendingTrigger.confirmedAt = new Date();
            pendingTrigger.startedAt = new Date();
            logger.info({ triggerId: id, action: pendingTrigger.action }, 'Confirmed trigger, executing');
            const triggerSystem = getClaudeTriggerSystem();
            const triggerAction = {
                id,
                action: pendingTrigger.action,
                prompt: pendingTrigger.prompt,
                config: pendingTrigger.config || {},
                context: pendingTrigger.context || {},
                requireConfirmation: false
            };
            const result = await triggerSystem.triggerAction(triggerAction);
            // Update history
            pendingTrigger.status = result.success ? 'completed' : 'failed';
            pendingTrigger.result = result.response;
            pendingTrigger.errorMessage = result.error;
            pendingTrigger.completedAt = new Date();
            // Persist
            await persistTriggerHistory(db, pendingTrigger);
            // Broadcast
            if (broadcastUpdate) {
                broadcastUpdate('trigger_confirmed', {
                    id,
                    action: pendingTrigger.action,
                    status: pendingTrigger.status,
                    success: result.success
                });
            }
            res.json({
                success: result.success,
                id,
                status: pendingTrigger.status,
                response: result.response,
                error: result.error
            });
        }
        catch (error) {
            logger.error({ error }, 'Error confirming trigger');
            res.status(500).json({
                success: false,
                error: 'Failed to confirm trigger'
            });
        }
    });
    /**
     * POST /api/claude/trigger/:id/cancel - Cancel a pending trigger
     */
    router.post('/trigger/:id/cancel', requireAuth, async (req, res) => {
        try {
            const { id } = req.params;
            const pendingTrigger = pendingConfirmations.get(id);
            if (!pendingTrigger) {
                res.status(404).json({
                    success: false,
                    error: 'Pending trigger not found'
                });
                return;
            }
            // Remove and update
            pendingConfirmations.delete(id);
            pendingTrigger.status = 'cancelled';
            // Broadcast
            if (broadcastUpdate) {
                broadcastUpdate('trigger_cancelled', { id, action: pendingTrigger.action });
            }
            res.json({
                success: true,
                id,
                status: 'cancelled',
                message: 'Trigger cancelled'
            });
        }
        catch (error) {
            logger.error({ error }, 'Error cancelling trigger');
            res.status(500).json({
                success: false,
                error: 'Failed to cancel trigger'
            });
        }
    });
    /**
     * GET /api/claude/trigger/history - Get trigger history
     */
    router.get('/trigger/history', requireAuth, async (req, res) => {
        try {
            const parseResult = TriggerHistoryQuerySchema.safeParse(req.query);
            if (!parseResult.success) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid query parameters'
                });
                return;
            }
            const { limit, offset, action, status } = parseResult.data;
            // Filter history
            let filtered = [...triggerHistory];
            if (action) {
                filtered = filtered.filter(h => h.action === action);
            }
            if (status) {
                filtered = filtered.filter(h => h.status === status);
            }
            // Paginate
            const paginated = filtered.slice(offset, offset + limit);
            res.json({
                success: true,
                history: paginated,
                total: filtered.length,
                limit,
                offset
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching trigger history');
            res.status(500).json({
                success: false,
                error: 'Failed to fetch trigger history'
            });
        }
    });
    /**
     * GET /api/claude/trigger/pending - Get pending confirmations
     */
    router.get('/trigger/pending', requireAuth, async (req, res) => {
        try {
            const pending = Array.from(pendingConfirmations.values()).map(p => ({
                id: p.id,
                action: p.action,
                prompt: p.prompt.substring(0, 200) + (p.prompt.length > 200 ? '...' : ''),
                createdAt: p.createdAt
            }));
            res.json({
                success: true,
                pending,
                count: pending.length
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching pending triggers');
            res.status(500).json({
                success: false,
                error: 'Failed to fetch pending triggers'
            });
        }
    });
    /**
     * POST /api/claude/schedule - Schedule a recurring trigger
     */
    router.post('/schedule', requireAuth, async (req, res) => {
        try {
            const parseResult = ScheduleRequestSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid request body',
                    details: parseResult.error.issues
                });
                return;
            }
            const { action, prompt, config, schedule, enabled } = parseResult.data;
            const scheduleId = uuidv4();
            const scheduledTrigger = {
                id: scheduleId,
                action,
                prompt,
                config,
                schedule,
                enabled,
                runCount: 0,
                createdAt: new Date()
            };
            // Calculate next run
            scheduledTrigger.nextRun = calculateNextRun(schedule);
            // Store
            scheduledTriggers.set(scheduleId, scheduledTrigger);
            // Register with trigger system if enabled
            if (enabled) {
                const triggerSystem = getClaudeTriggerSystem();
                await triggerSystem.scheduleAction(scheduleId, {
                    id: scheduleId,
                    action: action,
                    prompt,
                    config: config || {},
                    context: {},
                    requireConfirmation: false
                }, schedule);
            }
            logger.info({ scheduleId, action, schedule }, 'Scheduled trigger created');
            res.json({
                success: true,
                id: scheduleId,
                schedule: scheduledTrigger,
                message: 'Trigger scheduled successfully'
            });
        }
        catch (error) {
            logger.error({ error }, 'Error scheduling trigger');
            res.status(500).json({
                success: false,
                error: 'Failed to schedule trigger'
            });
        }
    });
    /**
     * GET /api/claude/schedule - List scheduled triggers
     */
    router.get('/schedule', requireAuth, async (req, res) => {
        try {
            const schedules = Array.from(scheduledTriggers.values());
            res.json({
                success: true,
                schedules,
                count: schedules.length
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching schedules');
            res.status(500).json({
                success: false,
                error: 'Failed to fetch schedules'
            });
        }
    });
    /**
     * DELETE /api/claude/schedule/:id - Delete a scheduled trigger
     */
    router.delete('/schedule/:id', requireAuth, async (req, res) => {
        try {
            const { id } = req.params;
            if (!scheduledTriggers.has(id)) {
                res.status(404).json({
                    success: false,
                    error: 'Scheduled trigger not found'
                });
                return;
            }
            // Remove from trigger system
            const triggerSystem = getClaudeTriggerSystem();
            triggerSystem.cancelScheduledAction(id);
            // Remove from storage
            scheduledTriggers.delete(id);
            res.json({
                success: true,
                message: 'Scheduled trigger deleted'
            });
        }
        catch (error) {
            logger.error({ error }, 'Error deleting schedule');
            res.status(500).json({
                success: false,
                error: 'Failed to delete schedule'
            });
        }
    });
    /**
     * POST /api/claude/schedule/:id/toggle - Enable/disable a scheduled trigger
     */
    router.post('/schedule/:id/toggle', requireAuth, async (req, res) => {
        try {
            const { id } = req.params;
            const schedule = scheduledTriggers.get(id);
            if (!schedule) {
                res.status(404).json({
                    success: false,
                    error: 'Scheduled trigger not found'
                });
                return;
            }
            // Toggle enabled state
            schedule.enabled = !schedule.enabled;
            const triggerSystem = getClaudeTriggerSystem();
            if (schedule.enabled) {
                await triggerSystem.scheduleAction(id, {
                    id,
                    action: schedule.action,
                    prompt: schedule.prompt,
                    config: schedule.config || {},
                    context: {},
                    requireConfirmation: false
                }, schedule.schedule);
            }
            else {
                triggerSystem.cancelScheduledAction(id);
            }
            res.json({
                success: true,
                id,
                enabled: schedule.enabled,
                message: schedule.enabled ? 'Schedule enabled' : 'Schedule disabled'
            });
        }
        catch (error) {
            logger.error({ error }, 'Error toggling schedule');
            res.status(500).json({
                success: false,
                error: 'Failed to toggle schedule'
            });
        }
    });
    /**
     * GET /api/claude/actions - List available trigger actions
     */
    router.get('/actions', requireAuth, (req, res) => {
        res.json({
            success: true,
            actions: [
                {
                    id: 'fix-error',
                    name: 'Auto-Fix Error',
                    description: 'Analyze an error and suggest/apply fixes',
                    requiredContext: ['errorMessage'],
                    optionalContext: ['filePath']
                },
                {
                    id: 'consolidate',
                    name: 'Memory Consolidation',
                    description: 'Consolidate similar memories to reduce redundancy',
                    requiredContext: [],
                    optionalContext: ['memoryIds']
                },
                {
                    id: 'deploy-team-member',
                    name: 'Deploy Team Member',
                    description: 'Deploy a new team member with a specific task',
                    requiredContext: ['prompt'],
                    optionalContext: ['teamMemberType']
                },
                {
                    id: 'analyze-codebase',
                    name: 'Analyze Codebase',
                    description: 'Perform analysis on the codebase',
                    requiredContext: [],
                    optionalContext: ['filePath', 'scope']
                },
                {
                    id: 'summarize-session',
                    name: 'Summarize Session',
                    description: 'Create a summary of the current session',
                    requiredContext: [],
                    optionalContext: ['sessionId']
                },
                {
                    id: 'custom',
                    name: 'Custom Action',
                    description: 'Execute a custom prompt',
                    requiredContext: ['prompt'],
                    optionalContext: []
                }
            ]
        });
    });
    return router;
}
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Persist trigger history to database
 */
async function persistTriggerHistory(db, entry) {
    if (!db)
        return;
    try {
        const projectPath = getCurrentProjectPath();
        await db.query(`INSERT INTO trigger_history (id, action, prompt, config, context, status, result, error_message, confirmed_at, started_at, completed_at, created_at, project_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE SET
         status = $6, result = $7, error_message = $8, confirmed_at = $9, started_at = $10, completed_at = $11`, [
            entry.id,
            entry.action,
            entry.prompt,
            JSON.stringify(entry.config || {}),
            JSON.stringify(entry.context || {}),
            entry.status,
            entry.result || null,
            entry.errorMessage || null,
            entry.confirmedAt || null,
            entry.startedAt || null,
            entry.completedAt || null,
            entry.createdAt,
            projectPath
        ]);
    }
    catch (error) {
        logger.warn({ error, entryId: entry.id }, 'Failed to persist trigger history');
    }
}
/**
 * Calculate next run time from schedule
 */
function calculateNextRun(schedule) {
    if (schedule.runAt) {
        return new Date(schedule.runAt);
    }
    if (schedule.intervalMinutes) {
        const next = new Date();
        next.setMinutes(next.getMinutes() + schedule.intervalMinutes);
        return next;
    }
    // For cron, would need to parse - simplified for now
    if (schedule.cron) {
        // Return undefined for now - cron scheduling handled by node-cron
        return undefined;
    }
    return undefined;
}
export default createClaudeControlRouter;
//# sourceMappingURL=claudeControl.js.map