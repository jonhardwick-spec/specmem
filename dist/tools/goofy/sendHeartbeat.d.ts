/**
 * sendHeartbeat - Announce that this team member is alive and active via MCP
 *
 * DEPRECATED: This tool now uses MCP-based team communication.
 * Uses broadcast_to_team to send status updates instead of memory-based heartbeats.
 *
 * Sends a status broadcast to indicate this team member is running and available.
 * Other team members can see this through get_team_status.
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
interface SendHeartbeatInput {
    teamMemberId: string;
    status?: 'active' | 'idle' | 'busy';
    teamMemberName?: string;
    teamMemberType?: string;
}
interface SendHeartbeatOutput {
    success: boolean;
    message: string;
    timestamp: string;
    messageId?: string;
}
export declare class SendHeartbeat implements MCPTool<SendHeartbeatInput, SendHeartbeatOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            teamMemberId: {
                type: string;
                description: string;
            };
            status: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
            teamMemberName: {
                type: string;
                description: string;
            };
            teamMemberType: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute(params: SendHeartbeatInput): Promise<SendHeartbeatOutput>;
}
export {};
//# sourceMappingURL=sendHeartbeat.d.ts.map