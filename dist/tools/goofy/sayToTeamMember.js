/**
 * sayToTeamMember - Send a message to a team member via MCP (NOT HTTP)
 *
 * DEPRECATED: This tool now wraps the new MCP-based team communication.
 * Prefer using send_team_message directly for new implementations.
 *
 * Allows team members to communicate with each other through the
 * MCP-based team communication system (NOT HTTP/REST).
 */
import { SendTeamMessage } from '../../mcp/tools/teamComms.js';
import { logger } from '../../utils/logger.js';
export class SayToTeamMember {
    name = 'sayToTeamMember';
    description = `[DEPRECATED - Use send_team_message instead]
Send a message to another team member via MCP (NOT HTTP).

This tool wraps the new MCP-based team communication system.
For new code, prefer using send_team_message directly.

Use this to:
- Coordinate work with other team members
- Share findings or updates
- Request help or information
- Broadcast status updates to all team members

Examples:
- "Hey @frontend-member, I've completed the API endpoints"
- "All team: Database migration is complete"`;
    inputSchema = {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'The message content to send'
            },
            to: {
                type: 'string',
                description: 'Team member ID to send to, or "all" for broadcast (default: "all")',
                default: 'all'
            },
            priority: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
                description: 'Message priority (default: "medium")',
                default: 'medium'
            },
            teamMemberId: {
                type: 'string',
                description: 'Your member ID (who is sending this message)'
            }
        },
        required: ['message', 'teamMemberId']
    };
    async execute(params) {
        const { message, to = 'all', priority = 'medium', teamMemberId } = params;
        try {
            // Map priority to new format
            const priorityMap = {
                'low': 'low',
                'medium': 'normal',
                'high': 'high'
            };
            // Set environment variable for member ID
            const originalMemberId = process.env['SPECMEM_MEMBER_ID'];
            process.env['SPECMEM_MEMBER_ID'] = teamMemberId;
            try {
                // Use the new MCP-based team communication
                const sendMessage = new SendTeamMessage();
                // Determine message type based on target
                const messageType = to === 'all' ? 'broadcast' : 'update';
                // If sending to specific member, prepend @mention
                const finalMessage = to !== 'all' ? `@${to} ${message}` : message;
                const result = await sendMessage.execute({
                    message: finalMessage,
                    type: messageType,
                    priority: priorityMap[priority] || 'normal',
                    sender_name: teamMemberId
                });
                logger.info({
                    from: teamMemberId,
                    to,
                    priority,
                    messageLength: message.length,
                    messageId: result.messageId,
                    via: 'MCP team comms'
                }, 'Team member message sent via MCP (NOT HTTP)');
                return {
                    success: true,
                    message: `Message sent to ${to} via MCP`,
                    sentTo: to,
                    timestamp: result.timestamp,
                    messageId: result.messageId
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
            logger.error({ error, teamMemberId, to }, 'Failed to send team member message');
            return {
                success: false,
                message: `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`,
                sentTo: to,
                timestamp: new Date().toISOString()
            };
        }
    }
}
//# sourceMappingURL=sayToTeamMember.js.map