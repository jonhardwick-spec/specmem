/**
 * deployTeamMember - The Task tool but actually works with MCP
 *
 * Spawns team members in screen sessions with full SpecMem MCP access.
 * This is basically skidding  Code's Task tool but making it not suck.
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
interface DeployTeamMemberInput {
    teamMemberId: string;
    teamMemberName: string;
    teamMemberType: 'overseer' | 'worker' | 'helper';
    model: 'haiku' | 'sonnet' | 'opus';
    prompt: string;
    background?: boolean;
}
interface DeployTeamMemberOutput {
    success: boolean;
    teamMemberId: string;
    teamMemberName: string;
    pid?: number;
    screenSession?: string;
    message: string;
}
export declare class DeployTeamMember implements MCPTool<DeployTeamMemberInput, DeployTeamMemberOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            teamMemberId: {
                type: string;
                description: string;
            };
            teamMemberName: {
                type: string;
                description: string;
            };
            teamMemberType: {
                type: string;
                enum: string[];
                description: string;
            };
            model: {
                type: string;
                enum: string[];
                description: string;
            };
            prompt: {
                type: string;
                description: string;
            };
            background: {
                type: string;
                description: string;
                default: boolean;
            };
        };
        required: string[];
    };
    execute(params: DeployTeamMemberInput): Promise<DeployTeamMemberOutput>;
}
export {};
//# sourceMappingURL=deployTeamMember.d.ts.map