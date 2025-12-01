/**
 * traceError.ts - MCP Tool for Error Tracing
 *
 * yo this tool is the DETECTIVE of the codebase fr fr
 * give it an error message and it finds the root cause
 * saves Claude from doing massive explores every time
 *
 * Features:
 * - Error pattern matching
 * - Root cause identification
 * - Solution history lookup
 * - Similar bug pattern detection
 * - Search reduction metrics
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
import { TraceResult } from '../traceExploreSystem.js';
/**
 * Input parameters for trace_error tool
 */
interface TraceErrorInput {
    errorMessage: string;
    stackTrace?: string;
    recordSolution?: boolean;
    solutionDescription?: string;
    solutionFiles?: string[];
}
/**
 * Output from trace_error tool
 */
interface TraceErrorOutput {
    success: boolean;
    traceResult?: TraceResult;
    suggestedFiles: string[];
    previousSolutions: Array<{
        description: string;
        filesModified: string[];
        successRate: number;
    }>;
    similarBugs: Array<{
        errorType: string;
        commonFiles: string[];
        resolutionCount: number;
    }>;
    searchReductionPercent: number;
    message: string;
}
/**
 * TraceError MCP Tool
 *
 * Takes an error message and optionally a stack trace,
 * finds likely root causes and previous solutions
 *
 * This is THE key tool for reducing Claude's search overhead
 * Instead of exploring the whole codebase, Claude can:
 * 1. Call trace_error with the error
 * 2. Get suggested files to look at
 * 3. See how similar errors were fixed before
 *
 * Reduces full codebase searches by 80%+ fr fr
 */
export declare class TraceError implements MCPTool<TraceErrorInput, TraceErrorOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            errorMessage: {
                type: string;
                description: string;
            };
            stackTrace: {
                type: string;
                description: string;
            };
            recordSolution: {
                type: string;
                description: string;
                default: boolean;
            };
            solutionDescription: {
                type: string;
                description: string;
            };
            solutionFiles: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
        };
        required: string[];
    };
    execute(params: TraceErrorInput): Promise<TraceErrorOutput>;
    /**
     * Extract error type from message
     */
    private extractErrorType;
}
export default TraceError;
//# sourceMappingURL=traceError.d.ts.map