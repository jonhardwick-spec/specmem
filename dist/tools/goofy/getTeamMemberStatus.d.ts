/**
 * getTeamMemberStatus - Get detailed status of a deployed team member
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
interface GetTeamMemberStatusInput {
    teamMemberId: string;
}
interface GetTeamMemberStatusOutput {
    running: boolean;
    screenSession?: string;
    output?: string;
    monitorLog?: string;
    promptFile?: string;
    startTime?: string;
    message: string;
}
export declare class GetTeamMemberStatus implements MCPTool<GetTeamMemberStatusInput, GetTeamMemberStatusOutput> {
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
    execute(args: GetTeamMemberStatusInput): Promise<GetTeamMemberStatusOutput>;
}
export {};
//# sourceMappingURL=getTeamMemberStatus.d.ts.map