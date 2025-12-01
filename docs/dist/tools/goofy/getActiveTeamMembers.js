/**
 * getActiveTeamMembers - List all currently active team members via MCP
 *
 * DEPRECATED: This tool now uses MCP-based team communication.
 * Uses get_team_status to retrieve active team member information.
 *
 * Returns a list of teamMembers based on recent activity in the
 * MCP-based team communication system.
 */
import { ReadTeamMessages } from '../../mcp/tools/teamComms.js';
import { logger } from '../../utils/logger.js';
export class GetActiveTeamMembers {
    name = 'getActiveTeamMembers';
    description = `[USES MCP - NOT HTTP]
Get a list of active team members based on recent team communication.

Uses the MCP-based team communication system to identify team members
who have sent messages recently.

Use this to:
- Discover what other team members are active
- Find team members to coordinate with
- Check if specific team members are available
- Monitor the multi-team-member system status

Status values are derived from recent activity:
- active: Member has sent messages in the last minute
- idle: Member has sent messages in the last 5 minutes
- busy: Member has sent a 'busy' status broadcast`;
    inputSchema = {
        type: 'object',
        properties: {
            teamMemberId: {
                type: 'string',
                description: 'Your team member ID'
            },
            withinSeconds: {
                type: 'number',
                description: 'Consider members active if message within this many seconds (default: 300)',
                default: 300
            }
        },
        required: ['teamMemberId']
    };
    async execute(params) {
        const { teamMemberId, withinSeconds = 300 } = params;
        try {
            // Set environment variable for member ID
            const originalMemberId = process.env['SPECMEM_MEMBER_ID'];
            process.env['SPECMEM_MEMBER_ID'] = teamMemberId;
            try {
                // Use MCP-based team status to get activity
                const readMessages = new ReadTeamMessages();
                // Get recent messages to identify active members
                const sinceDate = new Date(Date.now() - withinSeconds * 1000);
                const result = await readMessages.execute({
                    limit: 100,
                    since: sinceDate.toISOString(),
                    include_broadcasts: true
                });
                // Extract unique senders and their activity
                const memberActivity = new Map();
                const now = new Date();
                const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
                const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
                for (const msg of result.messages) {
                    const existingInfo = memberActivity.get(msg.sender);
                    const msgDate = new Date(msg.timestamp);
                    // Check if this is a status broadcast with busy/idle info
                    let status = 'active';
                    if (msg.type === 'broadcast' && msg.content.includes(' is busy')) {
                        status = 'busy';
                    }
                    else if (msg.type === 'broadcast' && msg.content.includes(' is idle')) {
                        status = 'idle';
                    }
                    else if (msgDate < fiveMinutesAgo) {
                        status = 'idle';
                    }
                    else if (msgDate >= oneMinuteAgo) {
                        status = 'active';
                    }
                    if (!existingInfo || msgDate > existingInfo.lastMessage) {
                        memberActivity.set(msg.sender, {
                            lastMessage: msgDate,
                            senderName: msg.sender_name !== msg.sender ? msg.sender_name : undefined,
                            status,
                            messageType: msg.type
                        });
                    }
                }
                // Convert to output format
                const teamMembers = Array.from(memberActivity.entries())
                    .filter(([memberId]) => memberId !== teamMemberId) // Exclude self
                    .map(([memberId, info]) => ({
                    teamMemberId: memberId,
                    teamMemberName: info.senderName,
                    teamMemberType: undefined, // Not available in new system
                    status: info.status,
                    lastHeartbeat: info.lastMessage.toISOString(),
                    secondsAgo: Math.floor((now.getTime() - info.lastMessage.getTime()) / 1000)
                }))
                    .sort((a, b) => a.secondsAgo - b.secondsAgo); // Most recent first
                logger.info({
                    teamMemberId,
                    withinSeconds,
                    activeMembersFound: teamMembers.length,
                    via: 'MCP team comms'
                }, 'Retrieved active team members via MCP (NOT HTTP)');
                return {
                    success: true,
                    teamMembers,
                    count: teamMembers.length
                };
            }
            finally {
                // Restore original member ID
                if (originalMemberId) {
                    process.env['SPECMEM_MEMBER_ID'] = originalMemberId;
                }
                else {
                    delete process.env['SPECMEM_MEMBER_ID'];
                }
            }
        }
        catch (error) {
            logger.error({ error, teamMemberId }, 'Failed to retrieve active team members');
            return {
                success: false,
                teamMembers: [],
                count: 0
            };
        }
    }
}
//# sourceMappingURL=getActiveTeamMembers.js.map