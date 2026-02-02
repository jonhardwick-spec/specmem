/**
 * findSimilarBugs.ts - MCP Tool for Bug Pattern Matching
 *
 * yo this tool is the BUG HISTORIAN fr fr
 * shows you similar issues that happened before
 * and how they were fixed
 *
 * why solve the same bug twice when you can learn from history
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
/**
 * Input parameters for find_similar_bugs tool
 */
interface FindSimilarBugsInput {
    errorMessage?: string;
    errorType?: string;
    keywords?: string[];
    filePath?: string;
    limit?: number;
    recordBug?: boolean;
    resolution?: string;
}
/**
 * Output from find_similar_bugs tool
 */
interface FindSimilarBugsOutput {
    success: boolean;
    similarBugs: Array<{
        errorType: string;
        errorSignature: string;
        occurrenceCount: number;
        commonFiles: string[];
        commonKeywords: string[];
        resolutionStats: {
            totalResolved: number;
            avgResolutionTimeMs: number;
            commonSolutions: string[];
        };
        lastOccurrence: string;
    }>;
    suggestedSolutions: string[];
    commonRootCauseFiles: string[];
    message: string;
}
/**
 * FindSimilarBugs MCP Tool
 *
 * Searches for similar bug patterns in history
 * Shows how similar issues were resolved before
 *
 * Use this when:
 * - You encounter a recurring bug
 * - You want to see if this issue happened before
 * - You need resolution strategies for similar problems
 */
export declare class FindSimilarBugs implements MCPTool<FindSimilarBugsInput, FindSimilarBugsOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            errorMessage: {
                type: string;
                description: string;
            };
            errorType: {
                type: string;
                description: string;
            };
            keywords: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            filePath: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                description: string;
                default: number;
            };
            recordBug: {
                type: string;
                description: string;
                default: boolean;
            };
            resolution: {
                type: string;
                description: string;
            };
        };
    };
    execute(params: FindSimilarBugsInput): Promise<FindSimilarBugsOutput>;
    /**
     * Record a new bug pattern
     */
    private recordBugPattern;
    /**
     * Search bugs by associated file
     */
    private searchBugsByFile;
    /**
     * Deduplicate bugs by error signature
     */
    private deduplicateBugs;
}
export default FindSimilarBugs;
//# sourceMappingURL=findSimilarBugs.d.ts.map