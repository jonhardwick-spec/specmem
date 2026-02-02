/**
 * findSimilarBugs.ts - MCP Tool for Bug Pattern Matching
 *
 * yo this tool is the BUG HISTORIAN fr fr
 * shows you similar issues that happened before
 * and how they were fixed
 *
 * why solve the same bug twice when you can learn from history
 */
import { getTraceExploreSystem } from '../traceExploreSystem.js';
import { logger } from '../../utils/logger.js';
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
export class FindSimilarBugs {
    name = 'find_similar_bugs';
    description = `Finds similar bugs from history and shows how they were resolved.

Use this to learn from past issues and avoid re-solving the same problems.
Search by:
- Error message or type
- Keywords related to the issue
- File path where the bug occurred

Returns:
- Similar past bugs
- How they were resolved
- Common files involved
- Resolution statistics`;
    inputSchema = {
        type: 'object',
        properties: {
            errorMessage: {
                type: 'string',
                description: 'The error message to search for'
            },
            errorType: {
                type: 'string',
                description: 'Error type to search for (e.g., TypeError, SyntaxError)'
            },
            keywords: {
                type: 'array',
                items: { type: 'string' },
                description: 'Keywords to search for in bug patterns'
            },
            filePath: {
                type: 'string',
                description: 'File path to find bugs associated with'
            },
            limit: {
                type: 'number',
                description: 'Maximum number of results (default: 10)',
                default: 10
            },
            recordBug: {
                type: 'boolean',
                description: 'Set to true to record this as a new bug pattern',
                default: false
            },
            resolution: {
                type: 'string',
                description: 'Resolution description (when recording a bug)'
            }
        }
    };
    async execute(params) {
        const startTime = Date.now();
        const limit = params.limit ?? 10;
        try {
            const traceSystem = getTraceExploreSystem();
            await traceSystem.initialize();
            // Build search query
            const searchText = [
                params.errorMessage,
                params.errorType,
                ...(params.keywords || []),
                params.filePath
            ].filter(Boolean).join(' ');
            if (!searchText && !params.recordBug) {
                return {
                    success: false,
                    similarBugs: [],
                    suggestedSolutions: [],
                    commonRootCauseFiles: [],
                    message: 'Provide at least one of: errorMessage, errorType, keywords, or filePath'
                };
            }
            // If recording a bug, handle that first
            if (params.recordBug && params.errorMessage) {
                await this.recordBugPattern(params.errorMessage, params.errorType, params.keywords || [], params.filePath ? [params.filePath] : [], params.resolution);
                return {
                    success: true,
                    similarBugs: [],
                    suggestedSolutions: [],
                    commonRootCauseFiles: params.filePath ? [params.filePath] : [],
                    message: `Bug pattern recorded. This will help identify similar issues in the future.`
                };
            }
            // Search for similar bugs using trace system
            const traceResult = await traceSystem.traceError(searchText || '', undefined);
            const similarBugs = traceResult.similarBugs;
            // Also search by file path if provided
            let fileRelatedBugs = [];
            if (params.filePath) {
                fileRelatedBugs = await this.searchBugsByFile(params.filePath);
            }
            // Combine and deduplicate
            const allBugs = this.deduplicateBugs([...similarBugs, ...fileRelatedBugs]);
            const limitedBugs = allBugs.slice(0, limit);
            // Extract suggested solutions
            const suggestedSolutions = new Set();
            const commonFiles = new Set();
            for (const bug of limitedBugs) {
                for (const solution of bug.resolutionStats.commonSolutions) {
                    suggestedSolutions.add(solution);
                }
                for (const file of bug.commonFiles) {
                    commonFiles.add(file);
                }
            }
            // Also get solutions from traces
            for (const solution of traceResult.previousSolutions) {
                suggestedSolutions.add(solution.description);
                for (const file of solution.filesModified) {
                    commonFiles.add(file);
                }
            }
            const duration = Date.now() - startTime;
            logger.info({
                searchText: searchText?.slice(0, 50),
                bugsFound: limitedBugs.length,
                solutionsFound: suggestedSolutions.size,
                duration
            }, 'find_similar_bugs completed');
            return {
                success: true,
                similarBugs: limitedBugs.map(bug => ({
                    errorType: bug.errorType,
                    errorSignature: bug.errorSignature,
                    occurrenceCount: bug.occurrenceCount,
                    commonFiles: bug.commonFiles,
                    commonKeywords: bug.commonKeywords,
                    resolutionStats: {
                        totalResolved: bug.resolutionStats.totalResolved,
                        avgResolutionTimeMs: bug.resolutionStats.avgResolutionTimeMs,
                        commonSolutions: bug.resolutionStats.commonSolutions
                    },
                    lastOccurrence: bug.lastOccurrenceAt?.toISOString() || 'unknown'
                })),
                suggestedSolutions: Array.from(suggestedSolutions).slice(0, 10),
                commonRootCauseFiles: Array.from(commonFiles).slice(0, 20),
                message: limitedBugs.length > 0
                    ? `Found ${limitedBugs.length} similar bugs. Check suggested solutions and common files.`
                    : 'No similar bugs found. This might be a new type of issue.'
            };
        }
        catch (error) {
            logger.error({ error }, 'find_similar_bugs failed');
            return {
                success: false,
                similarBugs: [],
                suggestedSolutions: [],
                commonRootCauseFiles: [],
                message: `Search failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    /**
     * Record a new bug pattern
     */
    async recordBugPattern(errorMessage, errorType, keywords = [], files = [], resolution) {
        const traceSystem = getTraceExploreSystem();
        // Record as trace with solution
        await traceSystem.recordTrace(errorMessage, undefined, files, resolution ? {
            id: crypto.randomUUID(),
            description: resolution,
            codeChange: '',
            filesModified: files,
            successRate: 1.0,
            appliedCount: 1,
            createdAt: new Date()
        } : undefined);
    }
    /**
     * Search bugs by associated file
     */
    async searchBugsByFile(filePath) {
        // This would query the database for bugs associated with the file
        // For now, return empty - actual implementation would query bug_patterns table
        return [];
    }
    /**
     * Deduplicate bugs by error signature
     */
    deduplicateBugs(bugs) {
        const seen = new Set();
        const unique = [];
        for (const bug of bugs) {
            if (!seen.has(bug.errorSignature)) {
                seen.add(bug.errorSignature);
                unique.push(bug);
            }
        }
        return unique;
    }
}
export default FindSimilarBugs;
//# sourceMappingURL=findSimilarBugs.js.map