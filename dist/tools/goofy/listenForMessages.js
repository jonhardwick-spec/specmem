/**
 * listenForMessages - Receive messages from other team members via MCP
 *
 * DEPRECATED: This tool now wraps the new MCP-based team communication.
 * Prefer using read_team_messages directly for new implementations.
 *
 * Retrieves messages sent to this team member via the MCP-based
 * team communication system (NOT HTTP/REST).
 */
import { ReadTeamMessages } from '../../mcp/tools/teamComms.js';
import { logger } from '../../utils/logger.js';
export class ListenForMessages {
    name = 'listenForMessages';
    description = `[DEPRECATED - Use read_team_messages instead]
Retrieve messages sent to this team member via MCP (NOT HTTP).

This tool wraps the new MCP-based team communication system.
For new code, prefer using read_team_messages directly.

Messages include:
- Direct messages sent to this member
- Broadcast messages sent to all team members
- Status updates from other team members

Use this to:
- Check for new coordination messages
- Get updates from other team members
- Retrieve @mentions and direct messages
- Stay informed about team-wide broadcasts`;
    inputSchema = {
        type: 'object',
        properties: {
            teamMemberId: {
                type: 'string',
                description: 'Your member ID (who is receiving messages)'
            },
            includeExpired: {
                type: 'boolean',
                description: 'Include expired messages in results (default: false)',
                default: false
            },
            sortByPriority: {
                type: 'boolean',
                description: 'Sort messages by priority first (default: true)',
                default: true
            }
        },
        required: ['teamMemberId']
    };
    async execute(params) {
        const { teamMemberId, includeExpired = false, sortByPriority = true } = params;
        try {
            // Set environment variable for member ID
            const originalMemberId = process.env['SPECMEM_MEMBER_ID'];
            process.env['SPECMEM_MEMBER_ID'] = teamMemberId;
            try {
                // Use the new MCP-based team communication
                const readMessages = new ReadTeamMessages();
                const result = await readMessages.execute({
                    limit: 50,
                    include_broadcasts: true,
                    // Note: The new system doesn't have explicit "expired" messages,
                    // but we can filter by mentions if needed
                    mentions_only: false,
                    unread_only: !includeExpired
                });
                // Map to legacy format
                const messages = result.messages.map(msg => ({
                    from: msg.sender,
                    content: msg.content,
                    timestamp: msg.timestamp,
                    messageType: msg.type,
                    priority: msg.priority === 'normal' ? 'medium' : msg.priority,
                    messageId: msg.id,
                    expiresAt: undefined // New system doesn't have expiration
                }));
                // Sort by priority if requested (high > medium > low)
                if (sortByPriority) {
                    const priorityOrder = { 'high': 0, 'urgent': 0, 'normal': 1, 'medium': 1, 'low': 2 };
                    messages.sort((a, b) => {
                        const priorityDiff = (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1);
                        if (priorityDiff !== 0)
                            return priorityDiff;
                        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
                    });
                }
                logger.info({
                    teamMemberId,
                    messageCount: messages.length,
                    includeExpired,
                    sortByPriority,
                    via: 'MCP team comms'
                }, 'Retrieved team member messages via MCP (NOT HTTP)');
                return {
                    success: true,
                    messages,
                    count: messages.length,
                    hasUnread: result.unread_count > 0
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
            logger.error({ error, teamMemberId }, 'Failed to retrieve team member messages');
            return {
                success: false,
                messages: [],
                count: 0,
                hasUnread: false
            };
        }
    }
}
//# sourceMappingURL=listenForMessages.js.map