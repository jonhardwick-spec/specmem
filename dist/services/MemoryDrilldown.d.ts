/**
 * MEMORY DRILLDOWN SYSTEM - Camera Roll Edition
 *
 * Architecture for Claude's memory access:
 *   1. find_memory(query, { cameraRollMode: true }) → Returns camera roll with drilldownIDs
 *   2. drill_down(drilldownID) → Zoom in for more detail on that memory
 *   3. get_memory(drilldownID) → Get full memory content
 *
 * Camera Roll Metaphor:
 *   - Zoom OUT = broad search, many results, less detail (threshold 0.3-0.5)
 *   - Zoom IN = focused search, fewer results, more detail (threshold 0.8-0.9)
 *   - Each result has a drilldownID for further exploration
 *   - Drilling down reveals associated memories, context, related conversations
 *
 * Response Format:
 * ```
 * content: "Here's what I said from last week"
 * CR (Claude Response): "Well that's interesting because..."
 * drilldownID: 123
 * similarity: 0.87
 * ```
 *
 * Then Claude can:
 *   - drill_down(123) - zoom in for more detail on that memory
 *   - get_memory(123) - get full memory content
 *   - Each drill-down may reveal MORE drilldown IDs for deeper exploration
 */
import type { DatabaseManager } from '../database.js';
import { type CameraRollItem, type DrilldownResult } from './CameraZoomSearch.js';
interface MemorySnippet {
    id: string;
    drilldownID: number;
    thumbnail: string;
    keywords: string[];
    relevance: number;
    drill_hint: string;
    has_code: boolean;
    has_conversation: boolean;
}
interface CodePointer {
    file_path: string;
    line_start?: number;
    line_end?: number;
    function_name?: string;
    class_name?: string;
}
interface ConversationContext {
    team_member_id: string;
    team_member_name: string;
    timestamp: Date;
    summary: string;
    full_transcript?: string;
}
interface FullMemory {
    id: string;
    content: string;
    keywords: string[];
    created_at: Date;
    code_pointers: CodePointer[];
    live_code: {
        [file_path: string]: string;
    };
    conversation: ConversationContext | null;
    related_memories: MemorySnippet[];
}
export declare class MemoryDrilldown {
    private db;
    private codebaseRoot;
    private dimensionService;
    private cachedDimension;
    private embeddingProvider;
    constructor(db: DatabaseManager, codebaseRoot?: string, embeddingProvider?: any);
    /**
     * Get DimensionService (lazy initialization)
     */
    private getDimService;
    /**
     * Get the embedding dimension from the database
     */
    private getEmbeddingDimension;
    /**
     * FIND MEMORY - Returns gallery of drill-down-able snippets
     * This is what Claude sees first when searching memories
     */
    findMemory(query: string, limit?: number): Promise<MemorySnippet[]>;
    /**
     * GET MEMORY - Full drill-down with code + conversation
     * This is what Claude gets when they drill down on a memory
     */
    getMemory(id: string): Promise<FullMemory>;
    /**
     * GET CODE POINTERS
     * Fetch pointers to code files/functions/classes
     */
    private getCodePointers;
    /**
     * LOAD LIVE CODE
     * Read actual code from filesystem (REAL LIVE CODE!)
     */
    private loadLiveCode;
    /**
     * GET CONVERSATION
     * Fetch the conversation that spawned this memory
     */
    private getConversation;
    /**
     * GET RELATED MEMORIES
     * Find similar memories for further drill-down
     */
    private getRelatedMemories;
    /**
     * CREATE THUMBNAIL
     * Short preview for gallery view
     */
    private createThumbnail;
    /**
     * QUERY TO VECTOR
     * Convert query to embedding vector for similarity search
     * CRITICAL: Uses proper embedding provider for semantic accuracy!
     * Now matches save_memory behavior: retries ML service, fails if unavailable
     * Hash fallback is REMOVED to prevent vector space mismatch!
     */
    private queryToVector;
    /**
     * DRILL DOWN - Zoom into a specific memory using its drilldownID
     *
     * This is the main entry point for camera roll exploration.
     * Takes a numeric drilldownID (from camera roll results) and returns:
     * - Full content of the memory
     * - Conversation context (before/after messages)
     * - Related memories (more drilldown IDs to explore)
     * - Code references
     *
     * @param drilldownID - The numeric ID from camera roll results
     * @returns DrilldownResult with full content and more exploration options
     */
    drillDown(drilldownID: number): Promise<DrilldownResult | null>;
    /**
     * GET MEMORY BY DRILLDOWN ID - Get full content using drilldownID
     *
     * Similar to drill_down but returns a simpler structure focused on content.
     * Useful when you just want the full memory without exploration options.
     *
     * @param drilldownID - The numeric ID from camera roll results
     * @returns Full memory content or null if not found
     */
    getMemoryByDrilldownID(drilldownID: number): Promise<FullMemory | null>;
    /**
     * REGISTER MEMORY FOR DRILLDOWN
     *
     * Registers a memory ID and returns its drilldownID.
     * Used internally when creating camera roll results.
     *
     * @param memoryID - The UUID of the memory
     * @param type - Type of content ('memory' | 'code' | 'context')
     * @returns The numeric drilldownID
     */
    registerForDrilldown(memoryID: string, type?: 'memory' | 'code' | 'context'): number;
    /**
     * GET DRILLDOWN STATS
     *
     * Returns statistics about the drilldown registry.
     * Useful for monitoring and debugging.
     */
    getDrilldownStats(): {
        totalEntries: number;
        oldestEntry?: Date;
        newestEntry?: Date;
    };
    /**
     * CONVERT TO CAMERA ROLL ITEM
     *
     * Converts a memory snippet to the camera roll format with drilldownID.
     * Used when upgrading existing results to camera roll format.
     *
     * @param snippet - The memory snippet to convert
     * @param includeClaudeResponse - Whether to include CR field
     * @returns CameraRollItem with drilldownID
     */
    toCameraRollItem(snippet: MemorySnippet, includeClaudeResponse?: boolean): CameraRollItem;
}
export {};
/**
 * EXAMPLE USAGE
 *
 * // Step 1: Find memories (gallery view)
 * const drilldown = new MemoryDrilldown(db);
 * const gallery = await drilldown.findMemory("authentication system");
 *
 * // Claude sees:
 * [
 *   {
 *     id: "mem_123",
 *     thumbnail: "Authentication using JWT tokens with 2FA support... [auth, jwt, security]",
 *     relevance: 0.85,
 *     drill_hint: "get_memory({id: 'mem_123'})",
 *     has_code: true,
 *     has_conversation: true
 *   },
 *   ...
 * ]
 *
 * // Step 2: Claude drills down
 * const full = await drilldown.getMemory("mem_123");
 *
 * // Claude now gets:
 * {
 *   content: "Full memory content...",
 *   code_pointers: [
 *     { file_path: "src/auth/jwt.ts", line_start: 45, line_end: 120, function_name: "verifyToken" }
 *   ],
 *   live_code: {
 *     "src/auth/jwt.ts": "export async function verifyToken(token: string) { ... }"  // REAL CODE!
 *   },
 *   conversation: {
 *     team_member_name: "claude-opus",
 *     summary: "User asked to implement JWT auth, discussed 2FA integration",
 *     timestamp: ...
 *   },
 *   related_memories: [
 *     { id: "mem_124", thumbnail: "2FA implementation...", drill_hint: "get_memory({id: 'mem_124'})" },
 *     ...
 *   ]
 * }
 */
//# sourceMappingURL=MemoryDrilldown.d.ts.map