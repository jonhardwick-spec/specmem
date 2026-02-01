/**
 * smushMemoriesTogether - dream-inspired consolidation like doobidoo
 *
 * nah bruh this consolidation go crazy
 * uses DBSCAN clustering to find similar memories and merge them
 * inspired by doobidoo's dream-inspired architecture
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
import { DatabaseManager } from '../../database.js';
import { ConsolidateMemoryParams, ConsolidationResult, EmbeddingProvider } from '../../types/index.js';
/**
 * SmushMemoriesTogether - dream-inspired consolidation engine
 *
 * consolidation dream-inspired just like doobidoo
 * uses DBSCAN-style clustering to find related memories
 * then merges them into cohesive consolidated memories
 */
export declare class SmushMemoriesTogether implements MCPTool<ConsolidateMemoryParams, ConsolidationResult[]> {
    private db;
    private embeddingProvider;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            strategy: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            threshold: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
            maxMemories: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
            memoryTypes: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            dryRun: {
                type: string;
                default: boolean;
                description: string;
            };
        };
    };
    constructor(db: DatabaseManager, embeddingProvider: EmbeddingProvider);
    execute(params: ConsolidateMemoryParams): Promise<ConsolidationResult[]>;
    /**
     * findSimilarityClusters - DBSCAN-style clustering using embeddings
     *
     * this is the main clustering algorithm fr
     * groups memories by vector similarity
     */
    private findSimilarityClusters;
    /**
     * findTemporalClusters - group by time windows
     *
     * memories created around the same time often relate to each other
     */
    private findTemporalClusters;
    /**
     * findTagBasedClusters - group by shared tags
     *
     * memories with overlapping tags are probably related
     */
    private findTagBasedClusters;
    /**
     * findImportanceClusters - prioritize high-value memories
     *
     * focus consolidation on critical/high importance memories first
     */
    private findImportanceClusters;
    /**
     * clusterByEmbedding - the DBSCAN-style clustering
     *
     * finds clusters of similar memories based on cosine similarity
     */
    private clusterByEmbedding;
    /**
     * clusterByTagOverlap - group by shared tags
     */
    private clusterByTagOverlap;
    /**
     * smushCluster - merge memories in a cluster
     *
     * creates a new consolidated memory and optionally marks sources as expired
     */
    private smushCluster;
    /**
     * mergeContent - combine content from multiple memories
     *
     * deduplicates sentences and creates coherent merged content
     */
    private mergeContent;
    /**
     * mergeTags - combine and prioritize tags
     */
    private mergeTags;
    /**
     * mergeImportance - take the highest importance
     */
    private mergeImportance;
    /**
     * averageEmbeddings - compute average embedding vector
     */
    private averageEmbeddings;
    private cosineSimilarity;
    private jaccardSimilarity;
    private calculateAverageSimilarity;
    private calculateSpaceSaved;
    private rowToMemory;
    private parseEmbedding;
}
//# sourceMappingURL=smushMemoriesTogether.d.ts.map