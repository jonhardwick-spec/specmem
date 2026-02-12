/**
 * createReasoningChain.ts - CREATE AND MANAGE REASONING CHAINS
 *
 * Reasoning chains preserve sequential thought processes:
 * - Multi-step problem solving
 * - Code implementation sequences
 * - Debugging trails
 * - Decision trees
 *
 * Unlike flat memory storage, chains maintain ORDER and CAUSALITY,
 * making it easy to follow a train of thought or retrace steps.
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
import { DatabaseManager } from '../../database.js';
import { EmbeddingProvider, ImportanceLevelType } from '../../types/index.js';
import { MemoryChain } from '../../memory/humanLikeMemory.js';
interface CreateChainInput {
    name: string;
    description: string;
    memoryIds: string[];
    chainType: 'reasoning' | 'implementation' | 'debugging' | 'exploration' | 'conversation';
    importance?: ImportanceLevelType;
}
interface ExtendChainInput {
    chainId: string;
    newMemoryIds: string[];
}
interface FindChainsInput {
    memoryId?: string;
    chainType?: string;
    keyword?: string;
    limit?: number;
}
type ChainInput = CreateChainInput | ExtendChainInput | FindChainsInput;
interface ChainResult {
    success: boolean;
    chain?: MemoryChain;
    chains?: MemoryChain[];
    message: string;
}
/**
 * CreateReasoningChain - Memory Chain Management Tool
 *
 * Use this to:
 * 1. Create new chains linking related memories in sequence
 * 2. Extend existing chains with new memories
 * 3. Find chains containing specific memories
 */
export declare class CreateReasoningChain implements MCPTool<ChainInput, ChainResult> {
    private db;
    private embeddingProvider;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            name: {
                type: string;
                description: string;
            };
            description: {
                type: string;
                description: string;
            };
            memoryIds: {
                type: string;
                items: {
                    type: string;
                    format: string;
                };
                description: string;
            };
            chainType: {
                type: string;
                enum: string[];
                description: string;
            };
            importance: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            chainId: {
                type: string;
                format: string;
                description: string;
            };
            newMemoryIds: {
                type: string;
                items: {
                    type: string;
                    format: string;
                };
                description: string;
            };
            memoryId: {
                type: string;
                format: string;
                description: string;
            };
            keyword: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                default: number;
                description: string;
            };
        };
    };
    private memorySystem;
    constructor(db: DatabaseManager, embeddingProvider: EmbeddingProvider);
    execute(params: ChainInput): Promise<ChainResult>;
    /**
     * Create a new reasoning chain
     */
    private createChain;
    /**
     * Extend an existing chain with new memories
     */
    private extendChain;
    /**
     * Find chains by memory ID or keyword
     */
    private findChains;
    /**
     * Validate that memory IDs exist in the database
     */
    private validateMemoryIds;
    private rowToChain;
}
export default CreateReasoningChain;
//# sourceMappingURL=createReasoningChain.d.ts.map