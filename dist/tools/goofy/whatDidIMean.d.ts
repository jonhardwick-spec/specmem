/**
 * whatDidIMean - recall memories by ID or filters
 *
 * when you need to get specific memories back
 * supports pagination, sorting, and filtering
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
import { DatabaseManager } from '../../database.js';
import { RecallMemoryParams, Memory } from '../../types/index.js';
/**
 * WhatDidIMean - memory recall tool
 *
 * retrieves memories by ID or filter criteria
 * supports pagination because we might have A LOT of memories
 *
 * Returns human-readable format for better readability
 */
export declare class WhatDidIMean implements MCPTool<RecallMemoryParams, string> {
    private db;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            id: {
                type: string;
                format: string;
                description: string;
            };
            tags: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            limit: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
            offset: {
                type: string;
                default: number;
                minimum: number;
                description: string;
            };
            orderBy: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            orderDirection: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            summarize: {
                type: string;
                default: boolean;
                description: string;
            };
            maxContentLength: {
                type: string;
                default: number;
                description: string;
            };
        };
    };
    private compactionOpts;
    constructor(db: DatabaseManager);
    execute(params: RecallMemoryParams & {
        summarize?: boolean;
        maxContentLength?: number;
    }): Promise<string>;
    /**
     * get a single memory by ID
     *
     * also updates access count cuz we tracking that
     */
    private getMemoryById;
    /**
     * get memories with filters, pagination, and sorting
     */
    private getMemoriesWithFilters;
    /**
     * get related memories through the relationship graph
     *
     * traverses memory_relations to find connected memories
     */
    getRelatedMemories(memoryId: string, depth?: number): Promise<Memory[]>;
    /**
     * get all chunks of a chunked memory
     *
     * useful when you stored something big and it got split
     */
    getMemoryChunks(parentId: string): Promise<Memory[]>;
    private getOrderColumn;
    private rowToMemory;
    private parseEmbedding;
    /**
     * Extract semantic keywords from content for drill-down context
     * Returns Chinese-compacted keywords sorted by relevance
     *
     * This replaces the useless 1536-number embedding with actual meaningful words
     */
    private extractSemanticKeywords;
}
//# sourceMappingURL=whatDidIMean.d.ts.map