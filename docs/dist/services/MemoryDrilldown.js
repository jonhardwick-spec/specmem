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
import * as fs from 'fs/promises';
import * as path from 'path';
import { getDimensionService } from './DimensionService.js';
import { getProjectContext } from './ProjectContext.js';
import { drilldownRegistry, performDrilldown } from './CameraZoomSearch.js';
import { smartCompress } from '../utils/tokenCompressor.js';
import { logger } from '../utils/logger.js';
export class MemoryDrilldown {
    db;
    codebaseRoot;
    dimensionService = null;
    cachedDimension = null;
    embeddingProvider = null; // EmbeddingProvider for proper semantic search
    constructor(db, codebaseRoot = '/server', embeddingProvider) {
        this.db = db;
        this.codebaseRoot = codebaseRoot;
        this.embeddingProvider = embeddingProvider || null;
        try {
            this.dimensionService = getDimensionService(db, embeddingProvider);
        }
        catch {
            // Will initialize when needed
        }
    }
    /**
     * Get DimensionService (lazy initialization)
     */
    getDimService() {
        if (!this.dimensionService) {
            this.dimensionService = getDimensionService(this.db);
        }
        return this.dimensionService;
    }
    /**
     * Get the embedding dimension from the database
     */
    async getEmbeddingDimension() {
        if (this.cachedDimension)
            return this.cachedDimension;
        try {
            const dimService = this.getDimService();
            const dim = await dimService.getTableDimension('memories');
            if (dim) {
                this.cachedDimension = dim;
                return dim;
            }
        }
        catch {
            // Fall through to default
        }
        // Default fallback
        return 384;
    }
    /**
     * FIND MEMORY - Returns gallery of drill-down-able snippets
     * This is what Claude sees first when searching memories
     */
    async findMemory(query, limit = 20) {
        // PROJECT NAMESPACING: Filter by current project
        const projectPath = getProjectContext().getProjectPath();
        const results = await this.db.query(`
      SELECT
        m.id,
        m.content,
        m.tags,
        m.metadata,
        m.embedding,
        EXISTS(SELECT 1 FROM codebase_pointers WHERE memory_id = m.id) as has_code,
        EXISTS(SELECT 1 FROM team_member_conversations WHERE memory_id = m.id) as has_conversation,
        1 - (m.embedding <=> $1::vector) as relevance
      FROM memories m
      WHERE m.content ILIKE $2
        AND m.project_path = $4
      ORDER BY m.embedding <=> $1::vector
      LIMIT $3
    `, [
            await this.queryToVector(query),
            `%${query}%`,
            limit,
            projectPath
        ]);
        return results.rows.map(row => {
            const tags = row.tags || [];
            const hints = row.metadata?._semanticHints?.split(', ') || [];
            const keywords = [...tags, ...hints];
            // Register for drilldown to get numeric ID
            const drilldownID = this.registerForDrilldown(row.id, 'memory');
            return {
                id: row.id,
                drilldownID, // Add drilldownID for gallery/camera roll
                thumbnail: this.createThumbnail(row.content, keywords.join(', ')),
                keywords,
                relevance: row.relevance,
                drill_hint: `drill_down(${drilldownID})`, // Use drilldown ID instead
                has_code: row.has_code,
                has_conversation: row.has_conversation
            };
        });
    }
    /**
     * GET MEMORY - Full drill-down with code + conversation
     * This is what Claude gets when they drill down on a memory
     */
    async getMemory(id) {
        // Fetch base memory - use actual column names (tags, metadata, NOT keywords)
        const memoryResult = await this.db.query(`
      SELECT id, content, tags, metadata, created_at, embedding
      FROM memories
      WHERE id = $1
    `, [id]);
        if (memoryResult.rows.length === 0) {
            throw new Error(`Memory ${id} not found`);
        }
        const memory = memoryResult.rows[0];
        // Fetch code pointers
        const codePointers = await this.getCodePointers(id);
        // Load actual live code from filesystem
        const liveCode = await this.loadLiveCode(codePointers);
        // Fetch conversation context
        const conversation = await this.getConversation(id);
        // Find related memories (for further drill-down)
        const relatedMemories = await this.getRelatedMemories(memory.embedding, id);
        // Extract keywords from tags array or metadata._semanticHints
        const keywords = memory.tags || [];
        const semanticHints = memory.metadata?._semanticHints;
        const allKeywords = semanticHints ? [...keywords, ...semanticHints.split(', ')] : keywords;
        return {
            id: memory.id,
            content: memory.content,
            keywords: allKeywords,
            created_at: memory.created_at,
            code_pointers: codePointers,
            live_code: liveCode,
            conversation: conversation,
            related_memories: relatedMemories
        };
    }
    /**
     * GET CODE POINTERS
     * Fetch pointers to code files/functions/classes
     */
    async getCodePointers(memoryId) {
        const result = await this.db.query(`
      SELECT
        file_path,
        line_start,
        line_end,
        function_name,
        class_name
      FROM codebase_pointers
      WHERE memory_id = $1
      ORDER BY created_at DESC
    `, [memoryId]);
        return result.rows.map(row => ({
            file_path: row.file_path,
            line_start: row.line_start,
            line_end: row.line_end,
            function_name: row.function_name,
            class_name: row.class_name
        }));
    }
    /**
     * LOAD LIVE CODE
     * Read actual code from filesystem (REAL LIVE CODE!)
     */
    async loadLiveCode(pointers) {
        const liveCode = {};
        for (const pointer of pointers) {
            try {
                const fullPath = path.join(this.codebaseRoot, pointer.file_path);
                const content = await fs.readFile(fullPath, 'utf-8');
                // If line range specified, extract just that section
                if (pointer.line_start && pointer.line_end) {
                    const lines = content.split('\n');
                    const section = lines.slice(pointer.line_start - 1, pointer.line_end).join('\n');
                    liveCode[pointer.file_path] = section;
                }
                else {
                    liveCode[pointer.file_path] = content;
                }
            }
            catch (err) {
                console.warn(`⚠️ Could not load code from ${pointer.file_path}:`, err);
                liveCode[pointer.file_path] = `// Code not found: ${pointer.file_path}`;
            }
        }
        return liveCode;
    }
    /**
     * GET CONVERSATION
     * Fetch the conversation that spawned this memory
     */
    async getConversation(memoryId) {
        const result = await this.db.query(`
      SELECT
        team_member_id,
        team_member_name,
        timestamp,
        summary,
        full_transcript
      FROM team_member_conversations
      WHERE memory_id = $1
      ORDER BY timestamp DESC
      LIMIT 1
    `, [memoryId]);
        if (result.rows.length === 0) {
            return null;
        }
        const row = result.rows[0];
        return {
            team_member_id: row.team_member_id,
            team_member_name: row.team_member_name,
            timestamp: row.timestamp,
            summary: row.summary,
            full_transcript: row.full_transcript
        };
    }
    /**
     * GET RELATED MEMORIES
     * Find similar memories for further drill-down
     */
    async getRelatedMemories(embedding, excludeId) {
        // PROJECT NAMESPACING: Filter by current project
        const projectPath = getProjectContext().getProjectPath();
        const result = await this.db.query(`
      SELECT
        m.id,
        m.content,
        m.tags,
        m.metadata,
        EXISTS(SELECT 1 FROM codebase_pointers WHERE memory_id = m.id) as has_code,
        EXISTS(SELECT 1 FROM team_member_conversations WHERE memory_id = m.id) as has_conversation,
        1 - (m.embedding <=> $1::vector) as relevance
      FROM memories m
      WHERE m.id != $2
        AND m.project_path = $3
      ORDER BY m.embedding <=> $1::vector
      LIMIT 5
    `, [embedding, excludeId, projectPath]);
        return result.rows.map(row => {
            const tags = row.tags || [];
            const hints = row.metadata?._semanticHints?.split(', ') || [];
            const keywords = [...tags, ...hints];
            // Register for drilldown to get numeric ID
            const drilldownID = this.registerForDrilldown(row.id, 'memory');
            return {
                id: row.id,
                drilldownID, // Add drilldownID for gallery/camera roll
                thumbnail: this.createThumbnail(row.content, keywords.join(', ')),
                keywords,
                relevance: row.relevance,
                drill_hint: `drill_down(${drilldownID})`, // Use drilldown ID instead
                has_code: row.has_code,
                has_conversation: row.has_conversation
            };
        });
    }
    /**
     * CREATE THUMBNAIL
     * Short preview for gallery view
     */
    createThumbnail(content, keywords) {
        const preview = content.substring(0, 80);
        const keywordStr = keywords ? keywords.split(',').slice(0, 3).join(', ') : '';
        return `${preview}... [${keywordStr}]`;
    }
    /**
     * QUERY TO VECTOR
     * Convert query to embedding vector for similarity search
     * CRITICAL: Uses proper embedding provider for semantic accuracy!
     * Now matches save_memory behavior: retries ML service, fails if unavailable
     * Hash fallback is REMOVED to prevent vector space mismatch!
     */
    async queryToVector(query) {
        const MAX_RETRIES = 3;
        const RETRY_DELAY_MS = 1000;
        // MUST use embedding provider - hash embeddings are in different vector space!
        if (!this.embeddingProvider) {
            throw new Error('[MemoryDrilldown] No embedding provider configured - cannot perform semantic search. Initialize with embeddingProvider.');
        }
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const embedding = await this.embeddingProvider.generateEmbedding(query);
                logger.info({
                    query: query.substring(0, 50),
                    embeddingDim: embedding.length,
                    method: 'embeddingProvider',
                    attempt
                }, '[MemoryDrilldown] Generated semantic embedding for query');
                return `[${embedding.join(',')}]`;
            }
            catch (error) {
                logger.warn({
                    error,
                    query: query.substring(0, 50),
                    attempt,
                    maxRetries: MAX_RETRIES
                }, '[MemoryDrilldown] Embedding provider failed - retrying');
                if (attempt < MAX_RETRIES) {
                    // Exponential backoff
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
                }
            }
        }
        // All retries exhausted - FAIL instead of hash fallback
        // Hash embeddings are in different vector space and won't match ML embeddings!
        const errorMsg = `ML embedding service unavailable after ${MAX_RETRIES} attempts. ` +
            'Cannot search memories with hash fallback - vector space mismatch would return garbage results. ' +
            'Please ensure the embedding service is running.';
        logger.error({ query: query.substring(0, 50) }, errorMsg);
        throw new Error(errorMsg);
    }
    // simpleHash REMOVED - hash embeddings are in different vector space than ML embeddings
    // Using hash fallback would return garbage results. See queryToVector() for details.
    // ============================================================================
    // CAMERA ROLL DRILLDOWN METHODS
    // These enable the drill_down(ID) and get_memory(ID) operations
    // ============================================================================
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
    async drillDown(drilldownID) {
        logger.info({ drilldownID }, '[MemoryDrilldown] Drilling down');
        // Use the shared performDrilldown function from CameraZoomSearch
        return performDrilldown(drilldownID, this.db, {
            includeConversationContext: true,
            relatedLimit: 5,
            codeRefLimit: 3
        });
    }
    /**
     * GET MEMORY BY DRILLDOWN ID - Get full content using drilldownID
     *
     * Similar to drill_down but returns a simpler structure focused on content.
     * Useful when you just want the full memory without exploration options.
     *
     * @param drilldownID - The numeric ID from camera roll results
     * @returns Full memory content or null if not found
     */
    async getMemoryByDrilldownID(drilldownID) {
        const entry = drilldownRegistry.resolve(drilldownID);
        if (!entry) {
            logger.warn({ drilldownID }, '[MemoryDrilldown] Drilldown ID not found');
            return null;
        }
        try {
            return await this.getMemory(entry.memoryID);
        }
        catch (error) {
            logger.error({ error, drilldownID, memoryID: entry.memoryID }, '[MemoryDrilldown] Failed to get memory');
            return null;
        }
    }
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
    registerForDrilldown(memoryID, type = 'memory') {
        return drilldownRegistry.register(memoryID, type);
    }
    /**
     * GET DRILLDOWN STATS
     *
     * Returns statistics about the drilldown registry.
     * Useful for monitoring and debugging.
     */
    getDrilldownStats() {
        return drilldownRegistry.getStats();
    }
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
    toCameraRollItem(snippet, includeClaudeResponse = false) {
        const drilldownID = this.registerForDrilldown(snippet.id, 'memory');
        // Compress content for token efficiency
        const compressed = smartCompress(snippet.thumbnail, { threshold: 0.85 });
        // CLEAN OUTPUT: Only essential fields (removed tags, hasMore, codePointers)
        return {
            content: compressed.result,
            drilldownID,
            memoryID: snippet.id,
            similarity: snippet.relevance
        };
    }
}
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
//# sourceMappingURL=MemoryDrilldown.js.map