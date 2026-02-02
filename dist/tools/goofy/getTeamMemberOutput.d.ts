/**
 * getTeamMemberOutput - Get output from a deployed team member
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
interface GetTeamMemberOutputInput {
    teamMemberId: string;
    lines?: number;
}
interface GetTeamMemberOutputOutput {
    output: string;
    lines: number;
    message: string;
}
export declare class GetTeamMemberOutput implements MCPTool<GetTeamMemberOutputInput, GetTeamMemberOutputOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            teamMemberId: {
                type: string;
                description: string;
            };
            lines: {
                type: string;
                description: string;
                default: number;
            };
        };
        required: string[];
    };
    execute(args: GetTeamMemberOutputInput): Promise<GetTeamMemberOutputOutput>;
}
export {};
//# sourceMappingURL=getTeamMemberOutput.d.ts.map