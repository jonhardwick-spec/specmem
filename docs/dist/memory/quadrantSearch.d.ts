/**
 * quadrantSearch.ts - SPATIAL/SEMANTIC QUADRANT PARTITIONING
 *
 * Large codebases and memory stores become unwieldy with flat search.
 * This module implements quadrant-based partitioning for:
 *
 * 1. SPATIAL QUADRANTS - Group memories by "semantic space"
 *    - Each quadrant represents a conceptual domain
 *    - Queries first identify relevant quadrants, then search within
 *
 * 2. HIERARCHICAL INDEXING - Multi-level organization
 *    - L0: Global index (all quadrants)
 *    - L1: Domain quadrants (code, docs, conversations, etc.)
 *    - L2: Sub-domain quadrants (by language, project, topic)
 *    - L3: Leaf clusters (fine-grained groups)
 *
 * 3. ADAPTIVE PARTITIONING - Quadrants split/merge based on:
 *    - Memory count (too many = split)
 *    - Semantic dispersion (too varied = split)
 *    - Access patterns (rarely accessed quadrants merge)
 *
 * This dramatically speeds up search for large memory stores by
 * reducing the search space before expensive vector comparisons.
 */
import { Memory, MemoryType, EmbeddingProvider } from '../types/index.js';
/**
 * QUADRANT - A semantic partition of memory space
 *
 * Each quadrant has:
 * - A centroid embedding (average of all member memories)
 * - Boundaries defined by semantic distance
 * - Statistics for adaptive management
 */
export interface Quadrant {
    id: string;
    name: string;
    level: number;
    parentId: string | null;
    childIds: string[];
    centroid: number[];
    radius: number;
    keywords: string[];
    memoryCount: number;
    totalAccessCount: number;
    lastAccessedAt: Date;
    createdAt: Date;
    updatedAt: Date;
    maxMemories: number;
    minMemories: number;
    maxRadius: number;
    memoryTypes: MemoryType[];
    tags: string[];
    metadata: Record<string, unknown>;
}
/**
 * QUADRANT SEARCH RESULT
 */
export interface QuadrantSearchResult {
    quadrant: Quadrant;
    distance: number;
    estimatedRelevance: number;
    memoryCount: number;
}
/**
 * MEMORY ASSIGNMENT - Tracks which quadrant a memory belongs to
 */
export interface QuadrantAssignment {
    memoryId: string;
    quadrantId: string;
    distanceToCentroid: number;
    assignedAt: Date;
}
/**
 * QuadrantSearchSystem - Hierarchical Semantic Partitioning
 *
 * The core idea: Instead of searching ALL memories, first find
 * relevant quadrants, then search within those quadrants only.
 *
 * For a 1M memory store:
 * - Flat search: Compare query to all 1M embeddings
 * - Quadrant search: Compare to ~50 quadrants, then ~1000 memories
 *
 * This provides 100-1000x speedup for large stores.
 */
export declare class QuadrantSearchSystem {
    private db;
    private embeddingProvider;
    private dimensionService;
    private quadrantCache;
    private rootQuadrantId;
    private detectedDimension;
    private config;
    constructor(db: any, embeddingProvider: EmbeddingProvider);
    /**
     * Get the DimensionService (lazy initialization)
     */
    private getDimService;
    /**
     * Validate and prepare an embedding for database operations.
     * Uses DimensionService to handle dimension mismatches.
     */
    private prepareEmbedding;
    /**
     * Get the current embedding dimension from DB or provider
     * DYNAMIC - no hardcoded values!
     */
    private getDimension;
    /**
     * Create a zero vector with the correct dimension
     */
    private createZeroCentroid;
    /**
     * Initialize the quadrant system with root quadrant
     */
    initialize(): Promise<void>;
    /**
     * Create a new quadrant
     */
    createQuadrant(name: string, description: string, level: number, parentId: string | null, centroid: number[], keywords: string[]): Promise<Quadrant>;
    /**
     * Assign a memory to the best quadrant
     */
    assignMemory(memory: Memory, embedding: number[]): Promise<QuadrantAssignment>;
    /**
     * Find the best quadrant for a given embedding
     * Dimension-agnostic traversal - skips quadrants with mismatched dimensions
     */
    private findBestQuadrant;
    /**
     * Search for relevant quadrants given a query embedding
     *
     * This is the key optimization: instead of searching all memories,
     * we first identify the most relevant quadrants, then search within them.
     * Uses DimensionService to handle dimension mismatches gracefully.
     */
    searchQuadrants(queryEmbedding: number[], options?: {
        maxQuadrants?: number;
        minRelevance?: number;
        level?: number;
        includeChildren?: boolean;
        originalQuery?: string;
    }): Promise<QuadrantSearchResult[]>;
    /**
     * Search memories within specific quadrants
     *
     * This is called AFTER searchQuadrants to get actual memories
     * from the most relevant quadrants.
     * Uses DimensionService to handle dimension mismatches gracefully.
     */
    searchWithinQuadrants(queryEmbedding: number[], quadrantIds: string[], options?: {
        limit?: number;
        threshold?: number;
        originalQuery?: string;
    }): Promise<Array<{
        memory: Memory;
        similarity: number;
        quadrantId: string;
    }>>;
    /**
     * Full quadrant-aware search: find quadrants, then search within
     * Uses DimensionService to handle dimension mismatches gracefully.
     */
    smartSearch(queryEmbedding: number[], options?: {
        limit?: number;
        threshold?: number;
        maxQuadrants?: number;
        originalQuery?: string;
    }): Promise<Array<{
        memory: Memory;
        similarity: number;
        quadrantId: string;
    }>>;
    /**
     * Global search fallback (searches all memories)
     * Assumes embedding is already validated by caller.
     */
    private globalSearch;
    /**
     * Split a quadrant that has grown too large or dispersed
     * Dimension-agnostic - validates and filters embeddings during split.
     */
    splitQuadrant(quadrantId: string): Promise<Quadrant[]>;
    /**
     * Simple k-means clustering for quadrant splitting
     * Dimension-agnostic - filters embeddings by expected dimension.
     */
    private kMeansClustering;
    private loadQuadrantsIntoCache;
    private updateQuadrantStats;
    private cosineDistance;
    /**
     * Compute cosine similarity between two vectors
     * Works with any dimension - no hardcoded values
     */
    private cosineSimilarity;
    /**
     * Compute average of multiple embeddings
     * Dimension-agnostic - uses first embedding's dimension, validates all others match
     */
    private averageEmbeddings;
    private extractKeywords;
    private parseEmbedding;
    private rowToQuadrant;
    private rowToMemory;
    /**
     * Get the current detected embedding dimension
     * Returns null if not yet detected
     */
    getDetectedDimension(): number | null;
    /**
     * Force re-detection of embedding dimension
     * Useful when database schema changes
     */
    refreshDimension(): Promise<number>;
    /**
     * Validate that an embedding has the correct dimension
     */
    validateEmbeddingDimension(embedding: number[]): Promise<boolean>;
}
export default QuadrantSearchSystem;
//# sourceMappingURL=quadrantSearch.d.ts.map