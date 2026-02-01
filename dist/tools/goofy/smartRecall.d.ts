/**
 * smartRecall.ts - INTELLIGENT MEMORY RETRIEVAL
 *
 * This tool provides advanced memory recall with:
 * - Adaptive context windows (grows based on relevance)
 * - Associative memory spreading (related memories surface)
 * - Memory chain awareness (reasoning paths preserved)
 * - Quadrant-optimized search (spatial partitioning)
 * - Forgetting curve consideration (strength-aware)
 *
 * Unlike basic search, this tool understands memory relationships
 * and builds a contextually rich response.
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
import { DatabaseManager } from '../../database.js';
import { EmbeddingProvider } from '../../types/index.js';
interface SmartRecallInput {
    query: string;
    maxTokens?: number;
    minRelevance?: number;
    includeAssociations?: boolean;
    includeChains?: boolean;
    useQuadrants?: boolean;
    maxAssociationDepth?: number;
    boostRecentAccess?: boolean;
    boostHighImportance?: boolean;
}
interface SmartRecallResult {
    success: boolean;
    contextWindow: {
        coreMemories: MemorySummary[];
        associatedMemories: MemorySummary[];
        chainMemories: MemorySummary[];
        contextualMemories: MemorySummary[];
        totalMemories: number;
        estimatedTokens: number;
    };
    searchStats: {
        quadrantsSearched?: number;
        associationsTraversed: number;
        chainsFound: number;
        totalTimeMs: number;
    };
    message: string;
}
interface MemorySummary {
    id: string;
    content: string;
    memoryType: string;
    importance: string;
    tags: string[];
    similarity?: number;
    strength?: number;
    accessCount: number;
    createdAt: string;
}
/**
 * SmartRecall - Intelligent Memory Retrieval Tool
 *
 * This is the evolved version of basic memory search.
 * It understands context, relationships, and memory health.
 */
export declare class SmartRecall implements MCPTool<SmartRecallInput, SmartRecallResult> {
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
            maxTokens: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
            minRelevance: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
            includeAssociations: {
                type: string;
                default: boolean;
                description: string;
            };
            includeChains: {
                type: string;
                default: boolean;
                description: string;
            };
            useQuadrants: {
                type: string;
                default: boolean;
                description: string;
            };
            maxAssociationDepth: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
            boostRecentAccess: {
                type: string;
                default: boolean;
                description: string;
            };
            boostHighImportance: {
                type: string;
                default: boolean;
                description: string;
            };
        };
        required: string[];
    };
    private memorySystem;
    private quadrantSystem;
    constructor(db: DatabaseManager, embeddingProvider: EmbeddingProvider);
    execute(params: SmartRecallInput): Promise<SmartRecallResult>;
    /**
     * Apply score boosts to memories based on recency and importance
     */
    private applyBoosts;
    private countChainsFound;
    private toSummary;
}
export default SmartRecall;
//# sourceMappingURL=smartRecall.d.ts.map