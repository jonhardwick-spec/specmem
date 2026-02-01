/**
 * deployTeamMember - The Task tool but actually works with MCP
 *
 * Spawns team members in screen sessions with full SpecMem MCP access.
 * This is basically skidding  Code's Task tool but making it not suck.
 */
import { deployTeamMember as deployTeamMemberImpl } from '../teamMemberDeployer.js';
import { logger } from '../../utils/logger.js';
export class DeployTeamMember {
    name = 'deployTeamMember';
    description = `Deploy a team member with full SpecMem MCP access.

This is like the Task tool but actually works - spawned team members get full access
to all SpecMem MCP tools including team member communication (sayToTeamMember, listenForMessages,
sendHeartbeat, getActiveTeamMembers).

TeamMembers are spawned in detached screen sessions so they persist independently.

Models:
- haiku: Fast & cheap (claude-3-5-haiku) - good for helpers and simple tasks
- sonnet: Balanced (claude-sonnet-4-5) - recommended for most workers
- opus: Powerful (claude-opus-4-5) - best for overseer and complex reasoning

TeamMember Types:
- overseer: Coordinates the mission, assigns tasks to workers
- worker: Executes specific tasks assigned by overseer
- helper: Assists workers with codebase searches and exploration

Use this to:
- Deploy multi-team-member swarms that can actually coordinate
- Spawn team members with guaranteed MCP tool access
- Enable true multi-team-member collaboration via SpecMem communication`;
    inputSchema = {
        type: 'object',
        properties: {
            teamMemberId: {
                type: 'string',
                description: 'Unique ID for this team member (e.g., "worker-1", "overseer-1")'
            },
            teamMemberName: {
                type: 'string',
                description: 'Human-readable name for the team member'
            },
            teamMemberType: {
                type: 'string',
                enum: ['overseer', 'worker', 'helper'],
                description: 'Type of team member being deployed'
            },
            model: {
                type: 'string',
                enum: ['haiku', 'sonnet', 'opus'],
                description: 'Model to use for this team member'
            },
            prompt: {
                type: 'string',
                description: 'The full prompt/instructions for this team member'
            },
            background: {
                type: 'boolean',
                description: 'Run in background (default: true)',
                default: true
            }
        },
        required: ['teamMemberId', 'teamMemberName', 'teamMemberType', 'model', 'prompt']
    };
    async execute(params) {
        const { teamMemberId, teamMemberName, teamMemberType, model, prompt, background = true } = params;
        try {
            logger.info({
                teamMemberId,
                teamMemberName,
                teamMemberType,
                model,
                background
            }, 'Deploying team member with MCP access');
            const result = await deployTeamMemberImpl({
                teamMemberId,
                teamMemberName,
                teamMemberType,
                model,
                prompt,
                background
            });
            if (result.success) {
                logger.info({
                    teamMemberId,
                    screenSession: result.screenSession
                }, 'Team Member deployed successfully');
            }
            return result;
        }
        catch (error) {
            logger.error({ error, teamMemberId }, 'Team Member deployment failed');
            return {
                success: false,
                teamMemberId,
                teamMemberName,
                message: error instanceof Error ? error.message : 'Unknown deployment error'
            };
        }
    }
}
//# sourceMappingURL=deployTeamMember.js.map