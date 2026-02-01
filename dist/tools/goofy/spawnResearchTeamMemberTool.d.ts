/**
 * SPAWN RESEARCH TEAM_MEMBER TOOL
 *
 * MCP Tool wrapper for spawnResearchTeamMember functionality.
 * Spawns  subprocess to research topics on the web and save to SpecMem.
 *
 * Why this exists:
 * - Local embedding model is just a dumb vector generator
 * - Can't actually understand or research things
 * - This spawns  to do real web research
 * - Results saved back to SpecMem for future retrieval
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
interface SpawnResearchInput {
    topic: string;
    context?: string;
    depth?: 'quick' | 'medium' | 'thorough';
    saveToMemory?: boolean;
    tags?: string[];
    userConfirmed?: boolean;
}
interface SpawnResearchOutput {
    success: boolean;
    topic: string;
    summary: string;
    sources: string[];
    memoriesCreated: number;
    error?: string;
}
/**
 * SpawnResearchTeamMemberTool - spawns  to research topics fr fr
 *
 * When SpecMem needs more context than the local AI can provide,
 * this tool spawns a  subprocess to do real web research
 */
export declare class SpawnResearchTeamMemberTool implements MCPTool<SpawnResearchInput, SpawnResearchOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            topic: {
                type: string;
                description: string;
            };
            context: {
                type: string;
                description: string;
            };
            depth: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            saveToMemory: {
                type: string;
                default: boolean;
                description: string;
            };
            tags: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            userConfirmed: {
                type: string;
                default: boolean;
                description: string;
            };
        };
        required: string[];
    };
    execute(params: SpawnResearchInput): Promise<SpawnResearchOutput>;
}
/**
 * GetActiveResearchTeamMembersTool - check what research is in progress
 *
 * FIXED: Now properly awaits the async getActiveResearchTeamMembers() function
 * which queries the database and verifies screen session liveness for accurate results.
 */
export declare class GetActiveResearchTeamMembersTool implements MCPTool<Record<string, never>, {
    teamMembers: Array<{
        id: string;
        topic: string;
        startTime: number;
        pid: number;
        depth?: string;
        screenSession?: string;
        status: string;
        elapsedMs: number;
    }>;
    count: number;
    message: string;
}> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {};
        required: any[];
    };
    execute(): Promise<{
        teamMembers: Array<{
            id: string;
            topic: string;
            startTime: number;
            pid: number;
            depth?: string;
            screenSession?: string;
            status: string;
            elapsedMs: number;
        }>;
        count: number;
        message: string;
    }>;
}
export {};
//# sourceMappingURL=spawnResearchTeamMemberTool.d.ts.map