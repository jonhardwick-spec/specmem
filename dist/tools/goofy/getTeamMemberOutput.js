/**
 * getTeamMemberOutput - Get output from a deployed team member
 */
import { getTeamMemberOutput } from '../teamMemberDeployer.js';
import { logger } from '../../utils/logger.js';
import { compactResponse } from '../../services/ResponseCompactor.js';
export class GetTeamMemberOutput {
    name = 'getTeamMemberOutput';
    description = `Get recent output from a deployed teamMember.

Retrieves the last N lines from the team member's output log. Default is 100 lines.

This is similar to TeamMemberOutputTool but specifically for team members deployed
via the deployTeamMember tool running in screen sessions.

Use this to:
- Monitor team member progress
- Check what a team member has output so far
- Debug team member behavior
- Verify team member is producing output

Example:
  teamMemberId: "test_teamMember_1234567890"
  lines: 50  # optional, defaults to 100`;
    inputSchema = {
        type: 'object',
        properties: {
            teamMemberId: {
                type: 'string',
                description: 'The team member ID to get output from'
            },
            lines: {
                type: 'number',
                description: 'Number of lines to retrieve (default: 100)',
                default: 100
            }
        },
        required: ['teamMemberId']
    };
    async execute(args) {
        try {
            const lines = args.lines || 100;
            const output = await getTeamMemberOutput(args.teamMemberId, lines);
            logger.info({ teamMemberId: args.teamMemberId, lines }, 'Retrieved team member output');
            // Apply Chinese compactor for token efficiency
            return compactResponse({
                output,
                lines,
                message: `Retrieved ${lines} lines from team member ${args.teamMemberId}`
            }, 'system');
        }
        catch (error) {
            logger.error({ error, teamMemberId: args.teamMemberId }, 'Failed to get team member output');
            return compactResponse({
                output: '',
                lines: 0,
                message: `Failed to get output for team member ${args.teamMemberId}`
            }, 'system');
        }
    }
}
//# sourceMappingURL=getTeamMemberOutput.js.map