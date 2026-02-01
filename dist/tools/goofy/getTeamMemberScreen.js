/**
 * getTeamMemberScreen - Get current screen contents of a running teamMember
 */
import { getTeamMemberScreen } from '../teamMemberDeployer.js';
import { logger } from '../../utils/logger.js';
export class GetTeamMemberScreen {
    name = 'getTeamMemberScreen';
    description = `Get the current screen contents of a running teamMember.

This captures a snapshot of what is currently displayed in the team member's
screen session - similar to taking a screenshot of the terminal.

Unlike getTeamMemberOutput which shows the full output log, this shows only
what is currently visible on the screen (typically the last ~50 lines
depending on terminal size).

Use this to:
- See what the team member is currently showing
- Check if team member is waiting for input
- Detect permission prompts in real-time
- Monitor live team member state
- Debug hanging team members

This is particularly useful for:
- Seeing if a team member is stuck on a permission prompt
- Checking interactive menus or questions
- Monitoring real-time progress indicators

Example:
  teamMemberId: "test_teamMember_1234567890"`;
    inputSchema = {
        type: 'object',
        properties: {
            teamMemberId: {
                type: 'string',
                description: 'The team member ID to capture screen from'
            }
        },
        required: ['teamMemberId']
    };
    async execute(args) {
        try {
            const screen = await getTeamMemberScreen(args.teamMemberId);
            logger.info({ teamMemberId: args.teamMemberId }, 'Retrieved team member screen');
            return {
                screen,
                message: `Screen captured from team member ${args.teamMemberId}`
            };
        }
        catch (error) {
            logger.error({ error, teamMemberId: args.teamMemberId }, 'Failed to get team member screen');
            return {
                screen: '',
                message: `Failed to capture screen from team member ${args.teamMemberId}`
            };
        }
    }
}
//# sourceMappingURL=getTeamMemberScreen.js.map