/**
 * smartExplore.ts - MCP Tool for Intelligent Code Exploration
 *
 * yo this is the ULTIMATE SEARCH fr fr
 * combines all the smart stuff:
 * - cached search patterns
 * - past successful searches
 * - code access patterns
 * - error-to-solution mappings
 *
 * reduces Claude's need for full codebase searches by 80%+
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
/**
 * Input parameters for smart_explore tool
 */
interface SmartExploreInput {
    query: string;
    context?: 'error' | 'feature' | 'refactor' | 'debug' | 'general';
    fileTypes?: string[];
    modules?: string[];
    limit?: number;
    useCache?: boolean;
}
/**
 * Output from smart_explore tool
 */
interface SmartExploreOutput {
    success: boolean;
    query: string;
    relevantFiles: string[];
    cacheHit: boolean;
    searchReductionPercent: number;
    suggestions: Array<{
        file: string;
        reason: string;
        confidence: number;
    }>;
    relatedSearches: string[];
    metrics: {
        totalFilesSearched: number;
        cacheHitRate: number;
        avgSearchReduction: number;
    };
    message: string;
}
/**
 * SmartExplore MCP Tool
 *
 * The intelligent search that learns from past searches
 * Much smarter than grep - uses:
 * - Cached search patterns
 * - Error-to-file mappings
 * - Code access patterns
 * - Semantic similarity
 *
 * Use this as your FIRST search tool - it often finds what you need
 * without scanning the entire codebase
 */
export declare class SmartExplore implements MCPTool<SmartExploreInput, SmartExploreOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            query: {
                type: string;
                description: string;
            };
            context: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
            fileTypes: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            modules: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            limit: {
                type: string;
                description: string;
                default: number;
            };
            useCache: {
                type: string;
                description: string;
                default: boolean;
            };
        };
        required: string[];
    };
    execute(params: SmartExploreInput): Promise<SmartExploreOutput>;
    /**
     * Search using context-specific strategies
     */
    private searchByContext;
    /**
     * Search for feature-related files
     */
    private searchFeatureFiles;
    /**
     * Search for refactoring candidates
     */
    private searchRefactorCandidates;
    /**
     * Find related searches from history
     */
    private findRelatedSearches;
    /**
     * Build summary message
     */
    private buildMessage;
}
export default SmartExplore;
//# sourceMappingURL=smartExplore.d.ts.map