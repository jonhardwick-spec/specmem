/**
 * get_related_code - Find code related to a prompt or memory
 *
 * Uses the link system to find code that has been associated
 * with specific conversations or topics.
 */
import { MCPTool } from '../mcp/toolRegistry.js';
import { DatabaseManager } from '../database.js';
import { EmbeddingProvider } from '../types/index.js';
import { GetRelatedCodeParams, RelatedCodeResult } from './types.js';
/**
 * GetRelatedCode - Find code related to conversations
 *
 * Features:
 * - Find by memory ID
 * - Semantic search by query
 * - Filter by relationship type
 * - Strength-based ranking
 */
export declare class GetRelatedCode implements MCPTool<GetRelatedCodeParams, RelatedCodeResult> {
    private db;
    private embeddingProvider;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            memoryId: {
                type: string;
                format: string;
                description: string;
            };
            query: {
                type: string;
                description: string;
            };
            relationshipTypes: {
                type: string;
                items: {
                    type: string;
                    enum: string[];
                };
                description: string;
            };
            minStrength: {
                type: string;
                minimum: number;
                maximum: number;
                default: number;
                description: string;
            };
            limit: {
                type: string;
                minimum: number;
                maximum: number;
                default: number;
                description: string;
            };
        };
    };
    constructor(db: DatabaseManager, embeddingProvider: EmbeddingProvider);
    execute(params: GetRelatedCodeParams): Promise<RelatedCodeResult>;
    /**
     * Find code by memory ID
     */
    private findByMemoryId;
    /**
     * Semantic search for related code
     */
    private semanticSearch;
    /**
     * Text-based search fallback
     */
    private textSearch;
    /**
     * Update access patterns for found code
     */
    private updateAccessPatterns;
}
//# sourceMappingURL=getRelatedCode.d.ts.map