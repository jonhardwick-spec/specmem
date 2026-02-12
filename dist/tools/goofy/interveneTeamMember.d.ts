/**
 * interveneTeamMember - Send input to a running team member's screen session
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
interface InterveneTeamMemberInput {
    teamMemberId: string;
    input: string;
}
interface InterveneTeamMemberOutput {
    success: boolean;
    message: string;
}
export declare class InterveneTeamMember implements MCPTool<InterveneTeamMemberInput, InterveneTeamMemberOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            teamMemberId: {
                type: string;
                description: string;
            };
            input: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute(args: InterveneTeamMemberInput): Promise<InterveneTeamMemberOutput>;
}
export {};
//# sourceMappingURL=interveneTeamMember.d.ts.map