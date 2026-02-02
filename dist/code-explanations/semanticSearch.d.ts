/**
 * semantic_search_explanations - Search code explanations by meaning
 *
 * Uses vector embeddings to find explanations semantically similar
 * to a search query, enabling natural language code discovery.
 */
import { MCPTool } from '../mcp/toolRegistry.js';
import { DatabaseManager } from '../database.js';
import { EmbeddingProvider } from '../types/index.js';
import { SemanticSearchParams, SemanticSearchResult } from './types.js';
/**
 * SemanticSearchExplanations - Natural language code search
 *
 * Features:
 * - Vector similarity search
 * - Quality filtering
 * - Type filtering
 * - Relevance scoring
 */
export declare class SemanticSearchExplanations implements MCPTool<SemanticSearchParams, SemanticSearchResult> {
    private db;
    private embeddingProvider;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            query: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                minimum: number;
                maximum: number;
                default: number;
                description: string;
            };
            threshold: {
                type: string;
                minimum: number;
                maximum: number;
                default: number;
                description: string;
            };
            explanationTypes: {
                type: string;
                items: {
                    type: string;
                    enum: string[];
                };
                description: string;
            };
            minQuality: {
                type: string;
                minimum: number;
                maximum: number;
                default: number;
                description: string;
            };
        };
        required: string[];
    };
    constructor(db: DatabaseManager, embeddingProvider: EmbeddingProvider);
    execute(params: SemanticSearchParams): Promise<SemanticSearchResult>;
    /**
     * Update use counts for retrieved explanations
     */
    private updateUseCounts;
    /**
     * Track query for learning improvement
     */
    private trackQuery;
}
//# sourceMappingURL=semanticSearch.d.ts.map