/**
 * getTeamMemberScreen - Get current screen contents of a running teamMember
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
interface GetTeamMemberScreenInput {
    teamMemberId: string;
}
interface GetTeamMemberScreenOutput {
    screen: string;
    message: string;
}
export declare class GetTeamMemberScreen implements MCPTool<GetTeamMemberScreenInput, GetTeamMemberScreenOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            teamMemberId: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute(args: GetTeamMemberScreenInput): Promise<GetTeamMemberScreenOutput>;
}
export {};
//# sourceMappingURL=getTeamMemberScreen.d.ts.map