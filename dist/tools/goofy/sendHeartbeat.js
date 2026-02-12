/**
 * sendHeartbeat - Announce that this team member is alive and active via MCP
 *
 * DEPRECATED: This tool now uses MCP-based team communication.
 * Uses broadcast_to_team to send status updates instead of memory-based heartbeats.
 *
 * Sends a status broadcast to indicate this team member is running and available.
 * Other team members can see this through get_team_status.
 */
import { BroadcastToTeam } from '../../mcp/tools/teamComms.js';
import { logger } from '../../utils/logger.js';
export class SendHeartbeat {
    name = 'sendHeartbeat';
    description = `[USES MCP - NOT HTTP]
Send a heartbeat/status broadcast to indicate this team member is alive and active.
This allows other team members to see your status via get_team_status.

Status values:
- active: Member is running and ready for work
- idle: Member is running but not currently working on anything
- busy: Member is actively executing a task

Use this to:
- Announce your presence to the team
- Update your current status
- Enable coordination with other team members`;
    inputSchema = {
        type: 'object',
        properties: {
            teamMemberId: {
                type: 'string',
                description: 'Your team member ID'
            },
            status: {
                type: 'string',
                enum: ['active', 'idle', 'busy'],
                description: 'Current status (default: "active")',
                default: 'active'
            },
            teamMemberName: {
                type: 'string',
                description: 'Optional friendly name for your member'
            },
            teamMemberType: {
                type: 'string',
                description: 'Optional type/role (e.g., "websocket-expert", "frontend-builder")'
            }
        },
        required: ['teamMemberId']
    };
    async execute(params) {
        const { teamMemberId, status = 'active', teamMemberName, teamMemberType } = params;
        try {
            // Set environment variable for member ID
            const originalMemberId = process.env['SPECMEM_MEMBER_ID'];
            const originalMemberName = process.env['SPECMEM_MEMBER_NAME'];
            process.env['SPECMEM_MEMBER_ID'] = teamMemberId;
            if (teamMemberName) {
                process.env['SPECMEM_MEMBER_NAME'] = teamMemberName;
            }
            try {
                // Use MCP-based broadcast for heartbeat
                const broadcast = new BroadcastToTeam();
                const typeInfo = teamMemberType ? ` [${teamMemberType}]` : '';
                const nameInfo = teamMemberName ? ` (${teamMemberName})` : '';
                const result = await broadcast.execute({
                    message: `${teamMemberId}${nameInfo}${typeInfo} is ${status}`,
                    broadcast_type: 'status',
                    priority: 'low',
                    metadata: {
                        heartbeat: true,
                        teamMemberId,
                        teamMemberName,
                        teamMemberType,
                        status
                    }
                });
                logger.info({
                    teamMemberId,
                    status,
                    teamMemberName,
                    teamMemberType,
                    messageId: result.messageId,
                    via: 'MCP broadcast'
                }, 'Team member heartbeat sent via MCP (NOT HTTP)');
                return {
                    success: true,
                    message: `Heartbeat sent via MCP (status: ${status})`,
                    timestamp: result.timestamp,
                    messageId: result.messageId
                };
            }
            finally {
                // Restore original values
                if (originalMemberId) {
                    process.env['SPECMEM_MEMBER_ID'] = originalMemberId;
                }
                else {
                    delete process.env['SPECMEM_MEMBER_ID'];
                }
                if (originalMemberName) {
                    process.env['SPECMEM_MEMBER_NAME'] = originalMemberName;
                }
                else {
                    delete process.env['SPECMEM_MEMBER_NAME'];
                }
            }
        }
        catch (error) {
            logger.error({ error, teamMemberId }, 'Failed to send heartbeat');
            return {
                success: false,
                message: `Failed to send heartbeat: ${error instanceof Error ? error.message : 'Unknown error'}`,
                timestamp: new Date().toISOString()
            };
        }
    }
}
//# sourceMappingURL=sendHeartbeat.js.map