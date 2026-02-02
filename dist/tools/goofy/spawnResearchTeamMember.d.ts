/**
 * SPAWN RESEARCH TEAM_MEMBER
 *
 * Spawns a  Code subprocess to research information on the web.
 * The local embedding model is just a dumb vector generator - it can't
 * actually understand or research things. This tool bridges that gap.
 *
 * When SpecMem needs more context on a topic:
 *   1. This tool spawns a  subprocess via deployTeamMember (with MCP access!)
 *   2.  researches using WebSearch/WebFetch
 *   3. Findings are saved back to SpecMem as memories
 *   4. The local embedding model can then find these researched facts
 *
 * FIXED: Now uses deployTeamMember from teamMemberDeployer.ts which:
 * - Spawns team members in screen sessions (persistent)
 * - Gives team members full SpecMem MCP access
 * - Properly tracks team member PIDs
 *
 * FIX 2024-12: Added database persistence for research team member tracking.
 *
 * FIX 2024-12 (CRITICAL): Changed from spawn('claude', ['--print', ...]) to
 * deployTeamMember() which properly gives team members MCP access. The old --print mode
 * ran  WITHOUT any tools, so WebSearch/WebFetch were never available!
 *
 * Security:  subprocess inherits parent permissions. This is
 * intentional - we want  to have web access for research.
 */
import { z } from 'zod';
declare const SpawnResearchTeamMemberSchema: z.ZodObject<{
    topic: z.ZodString;
    context: z.ZodOptional<z.ZodString>;
    depth: z.ZodDefault<z.ZodEnum<["quick", "medium", "thorough"]>>;
    saveToMemory: z.ZodDefault<z.ZodBoolean>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    tags?: string[];
    topic?: string;
    context?: string;
    depth?: "medium" | "quick" | "thorough";
    saveToMemory?: boolean;
}, {
    tags?: string[];
    topic?: string;
    context?: string;
    depth?: "medium" | "quick" | "thorough";
    saveToMemory?: boolean;
}>;
type SpawnResearchTeamMemberInput = z.infer<typeof SpawnResearchTeamMemberSchema>;
interface ResearchResult {
    success: boolean;
    topic: string;
    summary: string;
    sources: string[];
    memoriesCreated: number;
    error?: string;
    teamMemberId?: string;
    screenSession?: string;
}
/**
 * Spawn  subprocess to do research
 *
 * FIXED: Now uses deployTeamMember() which properly spawns team members with:
 * - Full MCP access (SpecMem, WebSearch, WebFetch, etc.)
 * - Screen sessions for persistence
 * - Proper tracking and monitoring
 *
 * The OLD implementation used spawn('claude', ['--print', '-p', prompt])
 * which runs  in print-only mode WITHOUT MCP tools access!
 */
export declare function spawnResearchTeamMember(input: SpawnResearchTeamMemberInput): Promise<ResearchResult>;
export declare function getActiveResearchTeamMembers(): Promise<Array<{
    id: string;
    topic: string;
    startTime: number;
    pid: number;
    screenSession?: string;
    depth?: string;
}>>;
export declare const spawnResearchTeamMemberTool: {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        topic: z.ZodString;
        context: z.ZodOptional<z.ZodString>;
        depth: z.ZodDefault<z.ZodEnum<["quick", "medium", "thorough"]>>;
        saveToMemory: z.ZodDefault<z.ZodBoolean>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        tags?: string[];
        topic?: string;
        context?: string;
        depth?: "medium" | "quick" | "thorough";
        saveToMemory?: boolean;
    }, {
        tags?: string[];
        topic?: string;
        context?: string;
        depth?: "medium" | "quick" | "thorough";
        saveToMemory?: boolean;
    }>;
    handler: typeof spawnResearchTeamMember;
};
export { SpawnResearchTeamMemberSchema };
//# sourceMappingURL=spawnResearchTeamMember.d.ts.map