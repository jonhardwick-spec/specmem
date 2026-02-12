/**
 * killDeployedTeamMember - Terminate a running teamMember
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
interface KillDeployedTeamMemberInput {
    teamMemberId: string;
}
interface KillDeployedTeamMemberOutput {
    success: boolean;
    teamMemberId: string;
    message: string;
}
export declare class KillDeployedTeamMember implements MCPTool<KillDeployedTeamMemberInput, KillDeployedTeamMemberOutput> {
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
    execute(params: KillDeployedTeamMemberInput): Promise<KillDeployedTeamMemberOutput>;
}
export {};
//# sourceMappingURL=killDeployedTeamMember.d.ts.map