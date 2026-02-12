/**
 * getActiveTeamMembers - List all currently active team members via MCP
 *
 * DEPRECATED: This tool now uses MCP-based team communication.
 * Uses get_team_status to retrieve active team member information.
 *
 * Returns a list of teamMembers based on recent activity in the
 * MCP-based team communication system.
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
interface GetActiveTeamMembersInput {
    teamMemberId: string;
    withinSeconds?: number;
}
interface GetActiveTeamMembersOutput {
    success: boolean;
    teamMembers: Array<{
        teamMemberId: string;
        teamMemberName?: string;
        teamMemberType?: string;
        status: 'active' | 'idle' | 'busy';
        lastHeartbeat: string;
        secondsAgo: number;
    }>;
    count: number;
}
export declare class GetActiveTeamMembers implements MCPTool<GetActiveTeamMembersInput, GetActiveTeamMembersOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            teamMemberId: {
                type: string;
                description: string;
            };
            withinSeconds: {
                type: string;
                description: string;
                default: number;
            };
        };
        required: string[];
    };
    execute(params: GetActiveTeamMembersInput): Promise<GetActiveTeamMembersOutput>;
}
export {};
//# sourceMappingURL=getActiveTeamMembers.d.ts.map