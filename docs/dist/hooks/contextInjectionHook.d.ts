/**
 * SPECMEM CONTEXT INJECTION HOOK
 * ==============================
 *
 * Native SpecMem hook that auto-injects context into every prompt.
 * This is the CORE of the drilldown flow - it intercepts prompts
 * and enriches them with relevant memory context.
 *
 * Flow:
 *   1. User submits prompt
 *   2. Hook generates embedding for prompt (via sandboxed container)
 *   3. Hook searches SpecMem for semantically similar memories
 *   4. Context is injected into the prompt
 *   5. Claude sees enriched prompt with related context
 *
 * This hook uses:
 *   - Sandboxed embedding container (all-MiniLM-L6-v2, 384 dims)
 *   - PostgreSQL pgvector for semantic search
 *   - Chinese Compactor for token efficiency
 */
export interface ContextHookConfig {
    searchLimit: number;
    threshold: number;
    maxContentLength: number;
    dbHost: string;
    dbPort: number;
    dbName: string;
    dbUser: string;
    dbPassword: string;
    embeddingSocket: string;
    enabled: boolean;
    compressContext: boolean;
    includeMetadata: boolean;
}
declare const DEFAULT_CONFIG: ContextHookConfig;
/**
 * Memory search result
 */
export interface MemoryResult {
    id: string;
    content: string;
    importance: string;
    tags: string[];
    similarity: number;
}
/**
 * Search SpecMem for related memories
 * NOW PER-PROJECT - only searches memories from current project!
 */
export declare function searchRelatedMemories(prompt: string, config?: Partial<ContextHookConfig>): Promise<MemoryResult[]>;
/**
 * Format memories for context injection
 */
export declare function formatContextInjection(memories: MemoryResult[], config?: Partial<ContextHookConfig>): string;
/**
 * Main hook handler - call this from Claude Code hooks
 */
export declare function contextInjectionHook(prompt: string, config?: Partial<ContextHookConfig>): Promise<string>;
export { DEFAULT_CONFIG };
//# sourceMappingURL=contextInjectionHook.d.ts.map