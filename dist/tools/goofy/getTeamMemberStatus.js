/**
 * getTeamMemberStatus - Get detailed status of a deployed team member
 */
import { getTeamMemberStatus } from '../teamMemberDeployer.js';
import { logger } from '../../utils/logger.js';
export class GetTeamMemberStatus {
    name = 'getTeamMemberStatus';
    description = `Get detailed status and information about a deployed teamMember.

Returns comprehensive information including:
- Whether team member is currently running
- Screen session name
- Recent output (last 50 lines)
- Permission monitor log
- Original prompt
- Start time

Use this to:
- Check if a team member is still running
- See recent output without tailing logs
- Debug stuck or failed team members
- Verify team member received correct prompt

Example:
  teamMemberId: "test_team_member_1234567890"`;
    inputSchema = {
        type: 'object',
        properties: {
            teamMemberId: {
                type: 'string',
                description: 'The team member ID to check status for'
            }
        },
        required: ['teamMemberId']
    };
    async execute(args) {
        try {
            const status = await getTeamMemberStatus(args.teamMemberId);
            logger.info({ teamMemberId: args.teamMemberId, running: status.running }, 'Retrieved team member status');
            return {
                ...status,
                message: status.running
                    ? `TeamMember ${args.teamMemberId} is running in session ${status.screenSession}`
                    : `TeamMember ${args.teamMemberId} is not running`
            };
        }
        catch (error) {
            logger.error({ error, teamMemberId: args.teamMemberId }, 'Failed to get team member status');
            return {
                running: false,
                message: `Failed to get status for team member ${args.teamMemberId}`
            };
        }
    }
}
//# sourceMappingURL=getTeamMemberStatus.js.map