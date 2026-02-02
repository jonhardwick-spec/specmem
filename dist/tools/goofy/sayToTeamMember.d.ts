/**
 * sayToTeamMember - Send a message to a team member via MCP (NOT HTTP)
 *
 * DEPRECATED: This tool now wraps the new MCP-based team communication.
 * Prefer using send_team_message directly for new implementations.
 *
 * Allows team members to communicate with each other through the
 * MCP-based team communication system (NOT HTTP/REST).
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
interface SayToTeamMemberInput {
    message: string;
    to?: string;
    priority?: 'low' | 'medium' | 'high';
    teamMemberId: string;
}
interface SayToTeamMemberOutput {
    success: boolean;
    message: string;
    sentTo: string;
    timestamp: string;
    messageId?: string;
}
export declare class SayToTeamMember implements MCPTool<SayToTeamMemberInput, SayToTeamMemberOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            message: {
                type: string;
                description: string;
            };
            to: {
                type: string;
                description: string;
                default: string;
            };
            priority: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
            teamMemberId: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute(params: SayToTeamMemberInput): Promise<SayToTeamMemberOutput>;
}
export {};
//# sourceMappingURL=sayToTeamMember.d.ts.map