/**
 * teamMemberDeploy.ts - Team Member Deployment API Endpoints
 *
 * Phase 3: Team Member Deployment System Backend APIs
 *
 * Endpoints:
 * - POST /api/team-members/deploy - Deploy a new team member via MCP sampling
 * - POST /api/team-members/:id/stop - Stop a running teamMember
 * - GET /api/team-members/:id/status - Get team member status
 * - POST /api/team-members/:id/command - Send command to running teamMember
 * - GET /api/team-members/running - List all running team members
 */
import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { getTeamMemberDeployment } from '../../team-members/teamMemberDeployment.js';
import { getTeamMemberTracker } from '../../team-members/teamMemberTracker.js';
import { getTeamMemberStreamManager } from '../websocket/teamMemberStream.js';
// ============================================================================
// Validation Schemas
// ============================================================================
// TEAM_MEMBER 3 FIX: Removed all token limits - everything is UNLIMITED!
const DeployTeamMemberSchema = z.object({
    name: z.string().min(1).max(100),
    teamMemberType: z.enum(['worker', 'overseer', 'qa']),
    workerType: z.enum(['test', 'repair', 'ai', 'codeReview', 'custom']).default('test'),
    task: z.string().max(10000).optional(),
    config: z.object({
        intelligencePriority: z.number().min(0).max(1).default(0.9),
        speedPriority: z.number().min(0).max(1).default(0.5),
        maxTokens: z.number().int().min(100).optional(), // UNLIMITED - no max!
        tokensLimit: z.number().int().min(1000).optional(), // UNLIMITED - no max!
        memoryLimit: z.number().int().min(10).optional().default(500), // Higher default
        autoRestart: z.boolean().default(false),
        maxRestarts: z.number().int().min(0).max(10).default(3)
    }).optional(),
    // AI Worker specific configuration
    aiConfig: z.object({
        model: z.enum(['opus', 'sonnet', 'haiku']).default('sonnet'),
        apiKey: z.string().optional(), // Will use ANTHROPIC_API_KEY env var if not provided
        systemPrompt: z.string().max(10000).optional(),
        maxTokens: z.number().int().min(100).optional() // UNLIMITED - no max!
    }).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional()
});
const SendCommandSchema = z.object({
    type: z.string().min(1),
    payload: z.record(z.unknown()).optional()
});
const StopTeamMemberSchema = z.object({
    force: z.boolean().default(false)
});
// ============================================================================
// Team Member Deployment API Router Factory
// ============================================================================
export function createTeamMemberDeployRouter() {
    const router = Router();
    let teamMemberDeployment = null;
    let teamMemberTracker = null;
    // Initialize on first request
    router.use((req, res, next) => {
        if (!teamMemberDeployment) {
            try {
                teamMemberDeployment = getTeamMemberDeployment();
                teamMemberTracker = getTeamMemberTracker();
            }
            catch (error) {
                logger.warn({ error }, 'Team Member deployment not available');
            }
        }
        next();
    });
    /**
     * POST /api/team-members/deploy
     * Deploy a new team member
     */
    router.post('/deploy', async (req, res) => {
        try {
            if (!teamMemberDeployment) {
                res.status(503).json({ error: 'Team Member deployment service not available' });
                return;
            }
            const parseResult = DeployTeamMemberSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Invalid request body',
                    details: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
                });
                return;
            }
            const { name, teamMemberType, workerType, task, config, aiConfig, command, args, env } = parseResult.data;
            // Build deployment config
            const deployConfig = {
                name,
                type: teamMemberType,
                workerType,
                command,
                args,
                env,
                tokensLimit: config?.tokensLimit,
                memoryLimit: config?.memoryLimit,
                autoRestart: config?.autoRestart,
                maxRestarts: config?.maxRestarts,
                // Include AI-specific config if deploying an AI worker
                aiConfig: workerType === 'ai' ? aiConfig : undefined
            };
            // Deploy the team member
            const teamMember = await teamMemberDeployment.deploy(deployConfig);
            // Broadcast via WebSocket
            const streamManager = getTeamMemberStreamManager();
            if (streamManager) {
                streamManager.broadcastSessionCreated(teamMember.id, teamMemberType, task);
            }
            logger.info({ teamMemberId: teamMember.id, name, teamMemberType }, 'Team Member deployed via dashboard');
            res.status(201).json({
                success: true,
                teamMember: {
                    id: teamMember.id,
                    name: teamMember.name,
                    type: teamMember.type,
                    status: teamMember.status,
                    createdAt: teamMember.createdAt
                },
                message: `TeamMember ${name} deployed successfully`
            });
        }
        catch (error) {
            logger.error({ error }, 'Error deploying team member');
            res.status(500).json({ error: 'Failed to deploy team member' });
        }
    });
    /**
     * POST /api/team-members/:id/stop
     * Stop a running teamMember
     */
    router.post('/:id/stop', async (req, res) => {
        try {
            if (!teamMemberDeployment) {
                res.status(503).json({ error: 'Team Member deployment service not available' });
                return;
            }
            const { id } = req.params;
            const parseResult = StopTeamMemberSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Invalid request body',
                    details: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
                });
                return;
            }
            const { force } = parseResult.data;
            // Check if team member is running
            if (!teamMemberDeployment.isRunning(id)) {
                res.status(404).json({ error: 'Team Member not found or not running' });
                return;
            }
            // Stop the team member
            const stopped = await teamMemberDeployment.stop(id, force);
            if (stopped) {
                // Broadcast via WebSocket
                const streamManager = getTeamMemberStreamManager();
                if (streamManager && teamMemberTracker) {
                    const teamMember = await teamMemberTracker.getTeamMember(id);
                    if (teamMember) {
                        streamManager.broadcastSessionEnded(id, teamMember.type, 'stopped');
                    }
                }
                logger.info({ teamMemberId: id, force }, 'Team Member stopped via dashboard');
                res.json({ success: true, message: 'Team Member stopped' });
            }
            else {
                res.status(500).json({ error: 'Failed to stop team member' });
            }
        }
        catch (error) {
            logger.error({ error }, 'Error stopping team member');
            res.status(500).json({ error: 'Failed to stop team member' });
        }
    });
    /**
     * GET /api/team-members/:id/status
     * Get detailed status of a team member
     */
    router.get('/:id/status', async (req, res) => {
        try {
            const { id } = req.params;
            if (!teamMemberTracker) {
                res.status(503).json({ error: 'Team Member tracker not available' });
                return;
            }
            const teamMember = await teamMemberTracker.getTeamMember(id);
            if (!teamMember) {
                res.status(404).json({ error: 'Team Member not found' });
                return;
            }
            // Get additional info if available
            const isRunning = teamMemberDeployment?.isRunning(id) || false;
            const limits = teamMemberDeployment?.getTeamMemberLimits(id);
            const limitStatus = teamMemberDeployment?.getTeamMemberLimitStatus(id);
            res.json({
                success: true,
                teamMember: {
                    id: teamMember.id,
                    name: teamMember.name,
                    type: teamMember.type,
                    status: teamMember.status,
                    tokensUsed: teamMember.tokensUsed,
                    tokensLimit: teamMember.tokensLimit,
                    createdAt: teamMember.createdAt,
                    lastActivityAt: teamMember.lastHeartbeat,
                    currentTask: teamMember.currentTask
                },
                isRunning,
                limits: limits || null,
                limitStatus: limitStatus || []
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching team member status');
            res.status(500).json({ error: 'Failed to fetch team member status' });
        }
    });
    /**
     * POST /api/team-members/:id/command
     * Send a command to a running teamMember
     */
    router.post('/:id/command', async (req, res) => {
        try {
            if (!teamMemberDeployment) {
                res.status(503).json({ error: 'Team Member deployment service not available' });
                return;
            }
            const { id } = req.params;
            const parseResult = SendCommandSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Invalid request body',
                    details: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
                });
                return;
            }
            const { type, payload } = parseResult.data;
            // Check if team member is running
            if (!teamMemberDeployment.isRunning(id)) {
                res.status(404).json({ error: 'Team Member not found or not running' });
                return;
            }
            // Send command to team member
            const result = await teamMemberDeployment.sendCommand(id, { type, ...payload });
            if (result.success) {
                logger.info({ teamMemberId: id, commandType: type }, 'Command sent to team member');
                res.json({
                    success: true,
                    queued: result.queued,
                    response: result.response,
                    message: result.queued ? 'Command queued for processing' : 'Command executed'
                });
            }
            else {
                res.status(500).json({ error: 'Failed to send command' });
            }
        }
        catch (error) {
            logger.error({ error }, 'Error sending command to team member');
            res.status(500).json({ error: 'Failed to send command' });
        }
    });
    /**
     * POST /api/team-members/:id/restart
     * Restart a team member
     */
    router.post('/:id/restart', async (req, res) => {
        try {
            if (!teamMemberDeployment) {
                res.status(503).json({ error: 'Team Member deployment service not available' });
                return;
            }
            const { id } = req.params;
            const result = await teamMemberDeployment.restart(id);
            if (result) {
                logger.info({ teamMemberId: id }, 'Team Member restarted via dashboard');
                res.json({ success: true, message: 'Team Member restarted' });
            }
            else {
                res.status(404).json({ error: 'Team Member not found or could not be restarted' });
            }
        }
        catch (error) {
            logger.error({ error }, 'Error restarting team member');
            res.status(500).json({ error: 'Failed to restart team member' });
        }
    });
    /**
     * GET /api/team-members/running
     * List all currently running team members
     */
    router.get('/running', async (req, res) => {
        try {
            if (!teamMemberDeployment || !teamMemberTracker) {
                res.status(503).json({ error: 'Team Member services not available' });
                return;
            }
            const runningIds = teamMemberDeployment.getRunningTeamMemberIds();
            const teamMembers = [];
            for (const id of runningIds) {
                const teamMember = await teamMemberTracker.getTeamMember(id);
                if (teamMember) {
                    teamMembers.push({
                        id: teamMember.id,
                        name: teamMember.name,
                        type: teamMember.type,
                        status: teamMember.status,
                        tokensUsed: teamMember.tokensUsed,
                        tokensLimit: teamMember.tokensLimit,
                        lastActivityAt: teamMember.lastHeartbeat
                    });
                }
            }
            res.json({
                success: true,
                teamMembers,
                count: teamMembers.length
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching running team members');
            res.status(500).json({ error: 'Failed to fetch running team members' });
        }
    });
    /**
     * GET /api/team-members/types
     * Get available team member types and their configurations
     * TEAM_MEMBER 3 FIX: All token limits removed - UNLIMITED!
     */
    router.get('/types', async (req, res) => {
        res.json({
            success: true,
            types: [
                {
                    type: 'worker',
                    label: 'Worker Team Member',
                    description: 'Executes tasks and produces code output',
                    workerTypes: ['test', 'repair', 'ai', 'codeReview', 'custom'],
                    defaultConfig: {
                        intelligencePriority: 0.8,
                        speedPriority: 0.5,
                        maxTokens: 128000, // UNLIMITED!
                        tokensLimit: null, // NO LIMIT!
                        memoryLimit: 500
                    }
                },
                {
                    type: 'overseer',
                    label: 'Overseer Team Member',
                    description: 'Manages and coordinates worker team members',
                    workerTypes: ['custom'],
                    defaultConfig: {
                        intelligencePriority: 0.9,
                        speedPriority: 0.3,
                        maxTokens: 128000, // UNLIMITED!
                        tokensLimit: null, // NO LIMIT!
                        memoryLimit: 500
                    }
                },
                {
                    type: 'qa',
                    label: 'QA Team Member',
                    description: 'Reviews and tests code from workers',
                    workerTypes: ['test', 'custom'],
                    defaultConfig: {
                        intelligencePriority: 0.85,
                        speedPriority: 0.4,
                        maxTokens: 128000, // UNLIMITED!
                        tokensLimit: null, // NO LIMIT!
                        memoryLimit: 500
                    }
                }
            ]
        });
    });
    /**
     * GET /api/team-members/deployment/stats
     * Get deployment statistics
     */
    router.get('/deployment/stats', async (req, res) => {
        try {
            if (!teamMemberDeployment || !teamMemberTracker) {
                res.status(503).json({ error: 'Team Member services not available' });
                return;
            }
            const allTeamMembers = await teamMemberTracker.getAllTeamMembers();
            const runningIds = teamMemberDeployment.getRunningTeamMemberIds();
            const stats = {
                total: allTeamMembers.length,
                running: runningIds.length,
                byType: {
                    worker: allTeamMembers.filter(a => a.type === 'worker').length,
                    overseer: allTeamMembers.filter(a => a.type === 'overseer').length,
                    qa: allTeamMembers.filter(a => a.type === 'qa').length
                },
                byStatus: {
                    pending: allTeamMembers.filter(a => a.status === 'pending').length,
                    running: allTeamMembers.filter(a => a.status === 'running').length,
                    completed: allTeamMembers.filter(a => a.status === 'completed').length,
                    failed: allTeamMembers.filter(a => a.status === 'failed').length,
                    stopped: allTeamMembers.filter(a => a.status === 'stopped').length
                },
                totalTokensUsed: allTeamMembers.reduce((sum, a) => sum + a.tokensUsed, 0)
            };
            res.json({ success: true, stats });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching deployment stats');
            res.status(500).json({ error: 'Failed to fetch deployment stats' });
        }
    });
    return router;
}
//# sourceMappingURL=teamMemberDeploy.js.map