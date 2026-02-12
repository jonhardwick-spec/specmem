/**
 * listDeployedTeamMembers - Show all team members deployed via deployTeamMember tool
 */
import { listRunningTeamMembers } from '../teamMemberDeployer.js';
import { logger } from '../../utils/logger.js';
import { compactResponse } from '../../services/ResponseCompactor.js';
export class ListDeployedTeamMembers {
    name = 'listDeployedTeamMembers';
    description = `List all currently running team members deployed via the deployTeamMember tool.

Shows team members running in screen sessions with detailed information including:
- TeamMember ID
- Screen session name
- Start time
- Whether team member has produced output

This is different from getActiveTeamMembers which shows team members that have sent recent heartbeats.

Use this to:
- See what team members are currently deployed
- Check if team members are still running
- Identify team members that may be stuck (no output)
- Get team member IDs for use with other monitoring tools`;
    inputSchema = {
        type: 'object',
        properties: {}
    };
    async execute() {
        try {
            const teamMembers = await listRunningTeamMembers();
            logger.info({ count: teamMembers.length }, 'Listed deployed team members');
            const teamMemberSummary = teamMembers.map(a => `${a.teamMemberId} (${a.hasOutput ? 'active' : 'no output'}) - started ${a.startTime || 'unknown'}`).join('\n');
            // Apply Chinese compactor for token efficiency
            return compactResponse({
                teamMembers,
                count: teamMembers.length,
                message: teamMembers.length > 0
                    ? `Found ${teamMembers.length} running teamMembers:\n${teamMemberSummary}`
                    : 'No team members currently deployed'
            }, 'system');
        }
        catch (error) {
            logger.error({ error }, 'Failed to list deployed team members');
            return compactResponse({
                teamMembers: [],
                count: 0,
                message: 'Failed to list team members'
            }, 'system');
        }
    }
}
//# sourceMappingURL=listDeployedTeamMembers.js.map