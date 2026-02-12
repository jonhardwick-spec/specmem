import { DatabaseManager } from './database.js';
import { SearchMemoryParams, SearchResult, Memory, EmbeddingProvider } from './types/index.js';
/**
 * High-performance semantic search engine using pgvector for vector similarity
 * and PostgreSQL full-text search for hybrid retrieval.
 * Uses DimensionService to handle dynamic embedding dimensions.
 */
export declare class SemanticSearchEngine {
    private db;
    private dimensionService;
    private embeddingProvider;
    constructor(db: DatabaseManager, embeddingProvider?: EmbeddingProvider);
    /**
     * Get the DimensionService (lazy initialization)
     */
    private getDimService;
    /**
     * Validate and prepare an embedding for search.
     * Handles dimension mismatches by re-embedding or scaling.
     */
    private prepareEmbedding;
    search(params: SearchMemoryParams, queryEmbedding: number[]): Promise<SearchResult[]>;
    hybridSearch(params: SearchMemoryParams, queryEmbedding: number[]): Promise<SearchResult[]>;
    findSimilarToMemory(memoryId: string, limit?: number, threshold?: number): Promise<SearchResult[]>;
    findDuplicates(threshold?: number): Promise<Array<{
        memory1: Memory;
        memory2: Memory;
        similarity: number;
    }>>;
    private updateAccessStats;
    private rowToMemory;
    private parseEmbedding;
    private extractHighlights;
}
//# sourceMappingURL=search.d.ts.map