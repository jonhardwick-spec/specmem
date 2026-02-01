/**
 * recall_code_explanation - Retrieve stored code explanations
 *
 * Supports multiple retrieval methods:
 * - By code ID
 * - By file path
 * - By semantic search query
 * - By explanation type
 */
import { MCPTool } from '../mcp/toolRegistry.js';
import { DatabaseManager } from '../database.js';
import { EmbeddingProvider } from '../types/index.js';
import { RecallExplanationParams, RecallExplanationResult } from './types.js';
/**
 * RecallCodeExplanation - Retrieve stored explanations
 *
 * Features:
 * - Multiple retrieval methods
 * - Semantic search support
 * - Quality filtering
 * - Type filtering
 */
export declare class RecallCodeExplanation implements MCPTool<RecallExplanationParams, RecallExplanationResult> {
    private db;
    private embeddingProvider;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            codeId: {
                type: string;
                format: string;
                description: string;
            };
            filePath: {
                type: string;
                description: string;
            };
            query: {
                type: string;
                description: string;
            };
            explanationType: {
                type: string;
                enum: string[];
                description: string;
            };
            minQuality: {
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
    execute(params: RecallExplanationParams): Promise<RecallExplanationResult>;
    /**
     * Semantic search for explanations
     */
    private semanticSearch;
    /**
     * Text-based search fallback
     */
    private textSearch;
    /**
     * Direct lookup by codeId or filePath
     */
    private directLookup;
    /**
     * Convert database row to CodeExplanation
     */
    private rowToExplanation;
    /**
     * Update use counts for retrieved explanations
     */
    private updateUseCounts;
}
//# sourceMappingURL=recallExplanation.d.ts.map