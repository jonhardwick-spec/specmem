/**
 * interveneTeamMember - Send input to a running team member's screen session
 */
import { interveneTeamMember } from '../teamMemberDeployer.js';
import { logger } from '../../utils/logger.js';
export class InterveneTeamMember {
    name = 'interveneTeamMember';
    description = `Send input to a running team member's screen session.

This allows you to intervene in a running team member by sending keystrokes/commands
directly to its screen session. The team member will receive the input as if it were
typed into the terminal.

POWERFUL CAPABILITIES:
- Send answers to permission prompts
- Provide additional context mid-execution
- Redirect team member behavior
- Send commands to interactive team members
- Answer questions the team member asks

Use cases:
- Answer permission prompts automatically
- Provide clarification when team member asks for it
- Send "yes" or "no" responses
- Input data the team member is waiting for
- Send control sequences (though be careful!)

Example:
  teamMemberId: "test_teamMember_1234567890"
  input: "yes"  # Send "yes" followed by newline

  teamMemberId: "research_teamMember_123"
  input: "2"  # Select option 2 from a menu

IMPORTANT: Input is sent with a newline automatically, as if you pressed Enter.`;
    inputSchema = {
        type: 'object',
        properties: {
            teamMemberId: {
                type: 'string',
                description: 'The team member ID to send input to'
            },
            input: {
                type: 'string',
                description: 'The input text to send (newline will be added automatically)'
            }
        },
        required: ['teamMemberId', 'input']
    };
    async execute(args) {
        try {
            const result = await interveneTeamMember(args.teamMemberId, args.input);
            logger.info({
                teamMemberId: args.teamMemberId,
                input: args.input,
                success: result.success
            }, 'Team Member intervention attempted');
            return result;
        }
        catch (error) {
            logger.error({ error, teamMemberId: args.teamMemberId }, 'Failed to intervene in team member');
            return {
                success: false,
                message: `Failed to send input to team member ${args.teamMemberId}`
            };
        }
    }
}
//# sourceMappingURL=interveneTeamMember.js.map