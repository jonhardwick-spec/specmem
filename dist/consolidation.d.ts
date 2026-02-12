import { DatabaseManager } from './database.js';
import { ConsolidateMemoryParams, ConsolidationResult } from './types/index.js';
/**
 * Intelligent memory consolidation engine that identifies related memories
 * and merges them into more coherent, deduplicated knowledge representations.
 *
 * Uses multiple strategies:
 * - Similarity: Vector-based clustering of semantically related content
 * - Temporal: Groups memories created within time windows
 * - Tag-based: Consolidates memories sharing significant tag overlap
 * - Importance: Prioritizes high-value memories in consolidation
 */
export declare class ConsolidationEngine {
    private db;
    private searchEngine;
    private dimensionService;
    constructor(db: DatabaseManager);
    /**
     * Get the DimensionService (lazy initialization)
     */
    private getDimService;
    /**
     * Prepare embedding for database storage - projects to target dimension if needed.
     */
    private prepareEmbeddingForStorage;
    consolidate(params: ConsolidateMemoryParams): Promise<ConsolidationResult[]>;
    private findSimilarityClusters;
    private findTemporalClusters;
    private findTagBasedClusters;
    private findImportanceClusters;
    private clusterByEmbedding;
    private clusterByTagOverlap;
    private processCluster;
    private mergeContent;
    private mergeTags;
    private mergeImportance;
    private averageEmbeddings;
    private cosineSimilarity;
    private calculateAverageSimilarity;
    private tagOverlap;
    private rowToMemory;
    private parseEmbedding;
}
//# sourceMappingURL=consolidation.d.ts.map