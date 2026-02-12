/**
 * traceError.ts - MCP Tool for Error Tracing
 *
 * yo this tool is the DETECTIVE of the codebase fr fr
 * give it an error message and it finds the root cause
 * saves  from doing massive explores every time
 *
 * Features:
 * - Error pattern matching
 * - Root cause identification
 * - Solution history lookup
 * - Similar bug pattern detection
 * - Search reduction metrics
 */
import { getTraceExploreSystem } from '../traceExploreSystem.js';
import { logger } from '../../utils/logger.js';
/**
 * TraceError MCP Tool
 *
 * Takes an error message and optionally a stack trace,
 * finds likely root causes and previous solutions
 *
 * This is THE key tool for reducing 's search overhead
 * Instead of exploring the whole codebase,  can:
 * 1. Call trace_error with the error
 * 2. Get suggested files to look at
 * 3. See how similar errors were fixed before
 *
 * Reduces full codebase searches by 80%+ fr fr
 */
export class TraceError {
    name = 'trace_error';
    description = `Traces an error message to find likely root causes and previous solutions.
Give it an error message (and optionally a stack trace) and it will:
- Find files that commonly cause this type of error
- Show previous solutions for similar errors
- Identify related bug patterns
- Reduce your search scope by 80%+

Use this BEFORE doing a full codebase search - it often finds the answer directly.`;
    inputSchema = {
        type: 'object',
        properties: {
            errorMessage: {
                type: 'string',
                description: 'The error message to trace'
            },
            stackTrace: {
                type: 'string',
                description: 'Optional stack trace for better matching'
            },
            recordSolution: {
                type: 'boolean',
                description: 'Set to true to record a solution for this error type',
                default: false
            },
            solutionDescription: {
                type: 'string',
                description: 'Description of how the error was fixed (when recording)'
            },
            solutionFiles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files that were modified to fix the error (when recording)'
            }
        },
        required: ['errorMessage']
    };
    async execute(params) {
        const startTime = Date.now();
        try {
            const traceSystem = getTraceExploreSystem();
            await traceSystem.initialize();
            // Record solution if requested
            if (params.recordSolution && params.solutionDescription && params.solutionFiles) {
                await traceSystem.recordTrace(params.errorMessage, params.stackTrace, params.solutionFiles, {
                    id: crypto.randomUUID(),
                    description: params.solutionDescription,
                    codeChange: '',
                    filesModified: params.solutionFiles,
                    successRate: 1.0,
                    appliedCount: 1,
                    createdAt: new Date()
                });
                logger.info({
                    errorType: this.extractErrorType(params.errorMessage),
                    filesRecorded: params.solutionFiles.length
                }, 'recorded solution for error trace');
                return {
                    success: true,
                    suggestedFiles: params.solutionFiles,
                    previousSolutions: [{
                            description: params.solutionDescription,
                            filesModified: params.solutionFiles,
                            successRate: 1.0
                        }],
                    similarBugs: [],
                    searchReductionPercent: 0,
                    message: `Solution recorded for future reference. ${params.solutionFiles.length} files logged as root cause.`
                };
            }
            // Perform trace lookup
            const traceResult = await traceSystem.traceError(params.errorMessage, params.stackTrace);
            const duration = Date.now() - startTime;
            // Build suggested files list from all sources
            const suggestedFiles = new Set();
            // Add from matching traces
            for (const trace of traceResult.matchingTraces) {
                for (const file of trace.rootCauseFiles) {
                    suggestedFiles.add(file);
                }
            }
            // Add from suggested root causes
            for (const cause of traceResult.suggestedRootCauses) {
                suggestedFiles.add(cause.file);
            }
            // Add from similar bugs
            for (const bug of traceResult.similarBugs) {
                for (const file of bug.commonFiles.slice(0, 3)) {
                    suggestedFiles.add(file);
                }
            }
            const suggestedFilesArray = Array.from(suggestedFiles);
            logger.info({
                errorType: this.extractErrorType(params.errorMessage),
                tracesFound: traceResult.matchingTraces.length,
                suggestedFiles: suggestedFilesArray.length,
                searchReduction: traceResult.searchReductionPercent,
                duration
            }, 'error trace completed');
            // Build response
            const hasResults = suggestedFilesArray.length > 0 ||
                traceResult.previousSolutions.length > 0;
            return {
                success: true,
                traceResult,
                suggestedFiles: suggestedFilesArray,
                previousSolutions: traceResult.previousSolutions.map(s => ({
                    description: s.description,
                    filesModified: s.filesModified,
                    successRate: s.successRate
                })),
                similarBugs: traceResult.similarBugs.map(b => ({
                    errorType: b.errorType,
                    commonFiles: b.commonFiles,
                    resolutionCount: b.resolutionStats.totalResolved
                })),
                searchReductionPercent: traceResult.searchReductionPercent,
                message: hasResults
                    ? `Found ${suggestedFilesArray.length} suggested files and ${traceResult.previousSolutions.length} previous solutions. Check these first before doing a full search!`
                    : `No previous traces found for this error. Consider recording the solution once you fix it using recordSolution: true.`
            };
        }
        catch (error) {
            logger.error({ error, errorMessage: params.errorMessage }, 'trace_error failed');
            return {
                success: false,
                suggestedFiles: [],
                previousSolutions: [],
                similarBugs: [],
                searchReductionPercent: 0,
                message: `Error tracing failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    /**
     * Extract error type from message
     */
    extractErrorType(message) {
        const match = message.match(/^(\w+Error|\w+Exception):/);
        return match ? match[1] : 'UnknownError';
    }
}
export default TraceError;
//# sourceMappingURL=traceError.js.map