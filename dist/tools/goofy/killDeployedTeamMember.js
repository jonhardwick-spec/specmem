/**
 * killDeployedTeamMember - Terminate a running teamMember
 */
import { killTeamMember } from '../teamMemberDeployer.js';
import { logger } from '../../utils/logger.js';
export class KillDeployedTeamMember {
    name = 'killDeployedTeamMember';
    description = `Terminate a running team member deployed via deployTeamMember.

Kills the team member's screen session, stopping the team member immediately.

Use this to:
- Stop team members that are no longer needed
- Kill stuck or misbehaving team members
- Clean up after mission completion`;
    inputSchema = {
        type: 'object',
        properties: {
            teamMemberId: {
                type: 'string',
                description: 'The team member ID to terminate'
            }
        },
        required: ['teamMemberId']
    };
    async execute(params) {
        const { teamMemberId } = params;
        try {
            const success = await killTeamMember(teamMemberId);
            if (success) {
                logger.info({ teamMemberId }, 'Team Member terminated successfully');
                return {
                    success: true,
                    teamMemberId,
                    message: `TeamMember ${teamMemberId} terminated successfully`
                };
            }
            else {
                return {
                    success: false,
                    teamMemberId,
                    message: `Failed to terminate team member ${teamMemberId} - may not exist or already stopped`
                };
            }
        }
        catch (error) {
            logger.error({ error, teamMemberId }, 'Failed to terminate team member');
            return {
                success: false,
                teamMemberId,
                message: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
}
//# sourceMappingURL=killDeployedTeamMember.js.map