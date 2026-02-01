/**
 * Tool Registry - where all our goofy named tools live
 *
 * fr fr this is the brain that knows what tools we got
 * and how to call em when claude asks nice
 */
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { DatabaseManager } from '../database.js';
import { EmbeddingProvider } from '../tools/index.js';
import { MemorizationConfig } from '../memorization/index.js';
import { ConnectionPoolGoBrrr } from '../db/connectionPoolGoBrrr.js';
/**
 * base interface for all our tools - they all gotta follow this fr
 */
export interface MCPTool<TInput = unknown, TOutput = unknown> {
    name: string;
    description: string;
    inputSchema: object;
    execute(params: TInput): Promise<TOutput>;
}
/**
 * Legacy export for backwards compatibility - returns current project's cache
 */
declare const _EMBEDDING_CACHE: {
    readonly size: number;
    get(key: string): number[];
    set(key: string, value: number[]): void;
    delete(key: string): boolean;
    keys(): MapIterator<string>;
    has(key: string): boolean;
    clear(): void;
};
declare function getCachedEmbedding(key: string): number[] | undefined;
declare function setCachedEmbedding(key: string, embedding: number[]): void;
/**
 * caching wrapper for embeddings - this go crazy for performance
 */
export declare class CachingEmbeddingProvider implements EmbeddingProvider {
    private provider;
    private stats;
    constructor(provider: EmbeddingProvider);
    generateEmbedding(text: string): Promise<number[]>;
    /**
     * BATCH EMBEDDING with caching - checks cache first, only sends uncached to provider
     * This is MUCH faster than individual calls for large batches!
     */
    generateEmbeddingsBatch(texts: string[]): Promise<number[][]>;
    private hashText;
    getStats(): {
        hitRate: number;
        cacheSize: number;
        hits: number;
        misses: number;
    };
}
/**
 * Tool Registry - registers and manages all MCP tools
 *
 * this is the central hub where all the goofy tools check in
 * and get dispatched when claude needs em
 */
export declare class ToolRegistry {
    private db;
    private embeddingProvider;
    private tools;
    private toolDefinitions;
    constructor(db: DatabaseManager, embeddingProvider: EmbeddingProvider);
    /**
     * register a tool so we know about it
     * All SpecMem tools are marked as safe for automated/subagent use
     */
    register(tool: MCPTool): void;
    /**
     * get a tool by name - returns undefined if not found
     */
    getTool(name: string): MCPTool | undefined;
    /**
     * get all tool definitions for MCP ListTools
     */
    getToolDefinitions(): Tool[];
    /**
     * execute a tool by name with given params
     */
    executeTool(name: string, params: unknown): Promise<unknown>;
    /**
     * check if a tool is registered
     */
    hasTool(name: string): boolean;
    /**
     * get count of registered tools
     */
    getToolCount(): number;
}
/**
 * Create and initialize the tool registry with all our goofy tools
 *
 * this is where we bring the whole squad together fr
 */
export declare function createToolRegistry(db: DatabaseManager, embeddingProvider: EmbeddingProvider): ToolRegistry;
/**
 * Create tool registry with CODEBASE TOOLS included
 * use this when you want the full ingestThisWholeAssMfCodebase experience
 *
 * @param db - the database manager for memory operations
 * @param pool - ConnectionPoolGoBrrr for codebase operations (uses advanced pool features)
 * @param embeddingProvider - for generating embeddings
 */
export declare function createFullToolRegistry(db: DatabaseManager, pool: ConnectionPoolGoBrrr, embeddingProvider: EmbeddingProvider): ToolRegistry;
/**
 * Create COMPLETE tool registry with ALL features including memorization
 *
 * yooo this is THE ULTIMATE registry - includes:
 * - goofy memory tools
 * - codebase ingestion
 * - package tracking
 * - AUTO-MEMORIZATION (Claude remembers what it writes!)
 *
 * fr fr Claude never needs massive explores again
 */
export declare function createUltimateToolRegistry(db: DatabaseManager, pool: ConnectionPoolGoBrrr, embeddingProvider: EmbeddingProvider, memorizationConfig?: Partial<MemorizationConfig>): ToolRegistry;
export { _EMBEDDING_CACHE, getCachedEmbedding, setCachedEmbedding };
//# sourceMappingURL=toolRegistry.d.ts.map