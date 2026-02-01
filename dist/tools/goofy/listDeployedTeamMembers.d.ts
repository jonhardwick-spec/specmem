/**
 * listDeployedTeamMembers - Show all team members deployed via deployTeamMember tool
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
interface TeamMemberInfo {
    teamMemberId: string;
    screenSession: string;
    startTime?: string;
    hasOutput: boolean;
}
interface ListDeployedTeamMembersOutput {
    teamMembers: TeamMemberInfo[];
    count: number;
    message: string;
}
export declare class ListDeployedTeamMembers implements MCPTool<{}, ListDeployedTeamMembersOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {};
    };
    execute(): Promise<ListDeployedTeamMembersOutput>;
}
export {};
//# sourceMappingURL=listDeployedTeamMembers.d.ts.map