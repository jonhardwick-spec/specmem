/**
 * humanLikeMemory.ts - HUMAN-LIKE MEMORY EVOLUTION SYSTEM
 *
 * This module implements human-inspired memory patterns:
 * 1. Forgetting curves (Ebbinghaus-inspired decay)
 * 2. Associative recall (memories trigger related memories)
 * 3. Memory chains (sequential reasoning paths)
 * 4. Memory strength (reinforced by access)
 * 5. Consolidation during "sleep" (background processing)
 *
 * The goal is to make 's memory more natural and intelligent,
 * not just a flat database but a living, evolving knowledge store.
 */
import { Memory, ImportanceLevelType, EmbeddingProvider } from '../types/index.js';
/**
 * EBBINGHAUS FORGETTING CURVE PARAMETERS
 *
 * The forgetting curve models how memory strength decays over time.
 * Formula: R = e^(-t/S) where R is retention, t is time, S is stability
 *
 * Stability increases with:
 * - Higher importance
 * - More access (repetition)
 * - Stronger associations
 * - Recent reinforcement
 */
export interface MemoryStrength {
    memoryId: string;
    stability: number;
    retrievability: number;
    lastReview: Date;
    reviewCount: number;
    intervalDays: number;
    easeFactor: number;
}
/**
 * ASSOCIATIVE LINK - connection between memories
 *
 * Associations form when:
 * - Memories are accessed together
 * - Semantic similarity is high
 * - Temporal proximity exists
 * - Explicit links are created
 */
export interface AssociativeLink {
    sourceId: string;
    targetId: string;
    strength: number;
    linkType: 'semantic' | 'temporal' | 'causal' | 'contextual' | 'user_defined';
    coActivationCount: number;
    lastCoActivation: Date;
    decayRate: number;
}
/**
 * MEMORY CHAIN - sequential reasoning path
 *
 * Chains preserve the order of thoughts and reasoning steps.
 * Useful for:
 * - Multi-step problem solving
 * - Code implementation sequences
 * - Debugging trails
 * - Decision trees
 */
export interface MemoryChain {
    id: string;
    name: string;
    description: string;
    memoryIds: string[];
    chainType: 'reasoning' | 'implementation' | 'debugging' | 'exploration' | 'conversation';
    importance: ImportanceLevelType;
    createdAt: Date;
    lastAccessedAt: Date;
    accessCount: number;
    metadata: Record<string, unknown>;
}
/**
 * MEMORY CONTEXT WINDOW - adaptive retrieval context
 *
 * Context windows dynamically grow or shrink based on:
 * - Query complexity
 * - Number of relevant memories
 * - Depth of associations
 * - Current task requirements
 */
export interface ContextWindow {
    coreMemories: Memory[];
    associatedMemories: Memory[];
    chainMemories: Memory[];
    contextualMemories: Memory[];
    totalTokenEstimate: number;
    relevanceThreshold: number;
    maxDepth: number;
}
/**
 * HumanLikeMemorySystem - The brain of SpecMem
 *
 * This system makes memory more intelligent by:
 * 1. Tracking memory strength and decay
 * 2. Building associative networks
 * 3. Preserving reasoning chains
 * 4. Adapting context based on relevance
 */
export declare class HumanLikeMemorySystem {
    private db;
    private embeddingProvider;
    private strengthCache;
    private cacheTimeout;
    constructor(db: any, embeddingProvider: EmbeddingProvider);
    /**
     * Calculate current retrievability based on Ebbinghaus curve
     *
     * R(t) = e^(-t/S) where:
     * - R is retrievability (0-1)
     * - t is time since last review (days)
     * - S is stability (higher = slower decay)
     */
    calculateRetrievability(lastReview: Date, stability: number, importance: ImportanceLevelType): number;
    /**
     * Update memory strength after access (spaced repetition)
     *
     * When a memory is accessed:
     * 1. Retrievability is reset to 1.0
     * 2. Stability increases based on interval
     * 3. Next optimal interval is calculated
     */
    updateMemoryStrength(memoryId: string, wasSuccessfulRecall: boolean, importance: ImportanceLevelType): Promise<MemoryStrength>;
    /**
     * Create initial strength for new memory
     */
    private createInitialStrength;
    /**
     * Get memories that are "fading" (low retrievability)
     * These should be reviewed or consolidated
     */
    getFadingMemories(threshold?: number, limit?: number): Promise<Array<{
        memory: Memory;
        strength: MemoryStrength;
    }>>;
    /**
     * Build associative links when memories are accessed together
     *
     * When memory A is accessed in context of memory B:
     * - Create or strengthen A -> B link
     * - Co-activation count increases
     * - Link strength increases
     */
    recordCoActivation(memoryIds: string[], linkType?: AssociativeLink['linkType']): Promise<void>;
    /**
     * Strengthen (or create) an associative link
     */
    private strengthenLink;
    /**
     * Get associated memories through link traversal
     *
     * Uses spreading activation: stronger links activate targets more
     */
    getAssociatedMemories(memoryId: string, depth?: number, minStrength?: number, limit?: number): Promise<Array<{
        memory: Memory;
        path: string[];
        totalStrength: number;
    }>>;
    /**
     * Decay old association links (run periodically)
     *
     * Links that aren't reinforced will gradually weaken
     */
    decayAssociations(decayDays?: number): Promise<number>;
    /**
     * Create a new memory chain (reasoning path)
     */
    createChain(name: string, description: string, memoryIds: string[], chainType: MemoryChain['chainType'], importance: ImportanceLevelType): Promise<MemoryChain>;
    /**
     * Extend an existing chain with new memories
     */
    extendChain(chainId: string, newMemoryIds: string[]): Promise<MemoryChain>;
    /**
     * Find chains that contain a specific memory
     */
    findChainsContaining(memoryId: string): Promise<MemoryChain[]>;
    /**
     * Build an adaptive context window for a query
     *
     * The context window expands based on:
     * - Query complexity
     * - Number of relevant memories found
     * - Strength of associations
     * - Available token budget
     */
    buildContextWindow(query: string, embedding: number[], options?: {
        maxTokens?: number;
        minRelevance?: number;
        includeAssociations?: boolean;
        includeChains?: boolean;
        maxAssociationDepth?: number;
    }): Promise<ContextWindow>;
    /**
     * Estimate tokens for a list of memories
     */
    private estimateTokens;
    private getMemoryStrength;
    private saveMemoryStrength;
    private rowToMemory;
    private parseEmbedding;
}
export default HumanLikeMemorySystem;
//# sourceMappingURL=humanLikeMemory.d.ts.map