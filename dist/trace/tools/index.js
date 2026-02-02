/**
 * Trace/Explore Tools Index
 *
 * Exports all the trace and explore MCP tools
 * These tools reduce 's search overhead by 80%+
 */
export { TraceError, default as TraceErrorTool } from './traceError.js';
export { ExploreDependencies, default as ExploreDependenciesTool } from './exploreDependencies.js';
export { FindSimilarBugs, default as FindSimilarBugsTool } from './findSimilarBugs.js';
export { AnalyzeImpact, default as AnalyzeImpactTool } from './analyzeImpact.js';
export { SmartExplore, default as SmartExploreTool } from './smartExplore.js';
import { TraceError } from './traceError.js';
import { ExploreDependencies } from './exploreDependencies.js';
import { FindSimilarBugs } from './findSimilarBugs.js';
import { AnalyzeImpact } from './analyzeImpact.js';
import { SmartExplore } from './smartExplore.js';
/**
 * Create all trace/explore tools
 */
export function createTraceExploreTools() {
    return [
        new TraceError(),
        new ExploreDependencies(),
        new FindSimilarBugs(),
        new AnalyzeImpact(),
        new SmartExplore()
    ];
}
/**
 * Tool names for reference
 */
export const TRACE_EXPLORE_TOOL_NAMES = [
    'trace_error',
    'explore_dependencies',
    'find_similar_bugs',
    'analyze_impact',
    'smart_explore'
];
//# sourceMappingURL=index.js.map