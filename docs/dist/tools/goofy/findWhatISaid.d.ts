/**
 * findWhatISaid - semantic search hitting different
 *
 * uses vector similarity to find relevant memories
 * supports natural language time queries like "yesterday" or "last week"
 * also does hybrid search combining semantic + full-text for best results
 *
 * Now integrated with LWJEB event bus for memory:retrieved events
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
import { DatabaseManager } from '../../database.js';
import { SearchMemoryParams, SearchResult, EmbeddingProvider } from '../../types/index.js';
/**
 * FindWhatISaid - semantic search tool
 *
 * fr fr this semantic search hitting different
 * combines vector similarity with optional filters for precision
 *
 * Emits LWJEB events: memory:retrieved
 */
export declare class FindWhatISaid implements MCPTool<SearchMemoryParams, SearchResult[]> {
    private db;
    private embeddingProvider;
    name: string;
    description: string;
    private coordinator;
    private hotPathManager;
    private debugLogger;
    inputSchema: {
        type: "object";
        properties: {
            query: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
            threshold: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
            includeRecent: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
            recencyBoost: {
                type: string;
                default: boolean;
                description: string;
            };
            keywordFallback: {
                type: string;
                default: boolean;
                description: string;
            };
            memoryTypes: {
                type: string;
                items: {
                    type: string;
                    enum: string[];
                };
                description: string;
            };
            tags: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            importance: {
                type: string;
                items: {
                    type: string;
                    enum: string[];
                };
                description: string;
            };
            dateRange: {
                type: string;
                properties: {
                    start: {
                        type: string;
                        format: string;
                    };
                    end: {
                        type: string;
                        format: string;
                    };
                };
                description: string;
            };
            includeExpired: {
                type: string;
                default: boolean;
                description: string;
            };
            role: {
                type: string;
                enum: string[];
                description: string;
            };
            summarize: {
                type: string;
                default: boolean;
                description: string;
            };
            galleryMode: {
                oneOf: ({
                    type: string;
                    enum?: undefined;
                } | {
                    type: string;
                    enum: string[];
                })[];
                default: boolean;
                description: string;
            };
            maxContentLength: {
                type: string;
                default: number;
                description: string;
            };
            zoomLevel: {
                type: string;
                enum: string[];
                description: string;
            };
            cameraRollMode: {
                type: string;
                default: boolean;
                description: string;
            };
            projectPath: {
                type: string;
                description: string;
            };
            allProjects: {
                type: string;
                default: boolean;
                description: string;
            };
        };
        required: any[];
    };
    private dimensionService;
    constructor(db: DatabaseManager, embeddingProvider: EmbeddingProvider);
    /**
     * Build project filter condition for SQL queries
     * Supports: current project (default), specific project (projectPath), or all projects (allProjects)
     * Returns: { condition: string, params: unknown[], nextIndex: number }
     */
    private buildProjectCondition;
    /**
     * Get DimensionService (lazy initialization)
     */
    private getDimService;
    /**
     * Validate and prepare embedding for memories table search
     */
    private prepareEmbedding;
    execute(params: SearchMemoryParams): Promise<SearchResult[]>;
    /**
     * semanticSearch - the main search logic
     *
     * uses pgvector for cosine similarity search
     * applies filters for type, tags, importance, dates
     */
    private semanticSearch;
    /**
     * I5 FIX: Get recent memories regardless of similarity
     * This ensures we can always find recent prompts even if embeddings aren't ready
     */
    private getRecentMemories;
    /**
     * I5 FIX: Apply recency boost to search results
     * Memories from last hour: +20% similarity
     * Memories from last day: +10% similarity
     * This ensures recent discussions rank higher
     */
    private applyRecencyBoost;
    /**
     * I5 FIX: Keyword fallback search using ILIKE
     * When embeddings return nothing, do text-based search
     */
    private keywordSearch;
    /**
     * I5 FIX: Merge and dedupe results from multiple sources
     * Priority: semantic results > recent results > keyword results
     *
     * REACTIVE DEDUPE: Also checks for content duplicates and queues DB cleanup
     */
    private mergeAndDedupeResults;
    /**
     * REACTIVE DEDUPE: Delete duplicate memories from database
     * PROJECT ISOLATED: Only deletes from current project
     * Called asynchronously when content duplicates are detected in search results
     */
    private cleanupDuplicates;
    /**
     * hybridSearch - combines semantic + full-text search
     *
     * best of both worlds - vector similarity for meaning
     * plus full-text search for exact matches
     */
    hybridSearch(params: SearchMemoryParams & {
        projectPath?: string;
        allProjects?: boolean;
    }, queryEmbedding: number[]): Promise<SearchResult[]>;
    /**
     * update access counts for returned memories
     *
     * helps with relevance scoring over time
     */
    private updateAccessCounts;
    /**
     * Record access patterns for hot path tracking
     *
     * When memories are accessed together, we track the transition
     * to build up hot paths that can be predicted/prefetched
     */
    private recordAccessPatterns;
    /**
     * highlight matching content
     *
     * shows context around matches for better UX
     */
    private getHighlights;
    /**
     * Create search result with AGGRESSIVE content compaction
     * Uses Chinese Compactor for token savings + truncation for drill-down
     *
     * When summarize=true (DEFAULT): Returns MINIMAL structure for drill-down decision
     * When summarize=false: Returns full Memory object
     */
    private rowToSearchResult;
    private parseEmbedding;
    /**
     * Aggregate discoverable paths from all enriched results
     * Combines and deduplicates paths for a unified exploration map
     */
    private aggregateDiscoverablePaths;
    /**
     * Generate context enrichment summary
     * This is the KEY output that tells Claude what to explore next
     * Uses Traditional Chinese for token efficiency
     */
    private generateContextEnrichment;
    /**
     * Format drilldown action as Chinese instruction
     */
    private formatDrilldownAction;
    /**
     * Generate context for empty results
     * Guides Claude on what to do when no memories match
     */
    private generateEmptyResultContext;
    /**
     * Generate research spawn instructions
     * These instructions tell Claude how to spawn a research team member
     * when local memory is insufficient
     */
    private generateResearchSpawnInstructions;
    /**
     * Extract meaningful preview from content
     * Avoids showing just metadata like session IDs and timestamps
     */
    private extractMeaningfulPreview;
    /**
     * Extract meaningful content, skipping metadata-looking lines
     * Returns actual content Claude can understand and drill down on
     */
    private extractMeaningfulContent;
    /**
     * Create a semantic hint in Traditional Chinese for token efficiency
     * This gives Claude a quick understanding of what the memory is about
     */
    private createSemanticHint;
    /**
     * Extract keywords from query for related searches
     */
    private extractKeywords;
    static getStats(): {
        searchCount: number;
        totalSearchTime: number;
        averageSearchTime: number;
    };
}
//# sourceMappingURL=findWhatISaid.d.ts.map