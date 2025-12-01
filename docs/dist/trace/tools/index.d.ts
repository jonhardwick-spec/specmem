/**
 * Trace/Explore Tools Index
 *
 * Exports all the trace and explore MCP tools
 * These tools reduce Claude's search overhead by 80%+
 */
export { TraceError, default as TraceErrorTool } from './traceError.js';
export { ExploreDependencies, default as ExploreDependenciesTool } from './exploreDependencies.js';
export { FindSimilarBugs, default as FindSimilarBugsTool } from './findSimilarBugs.js';
export { AnalyzeImpact, default as AnalyzeImpactTool } from './analyzeImpact.js';
export { SmartExplore, default as SmartExploreTool } from './smartExplore.js';
import { MCPTool } from '../../mcp/toolRegistry.js';
/**
 * Create all trace/explore tools
 */
export declare function createTraceExploreTools(): MCPTool[];
/**
 * Tool names for reference
 */
export declare const TRACE_EXPLORE_TOOL_NAMES: readonly ["trace_error", "explore_dependencies", "find_similar_bugs", "analyze_impact", "smart_explore"];
export type TraceExploreToolName = typeof TRACE_EXPLORE_TOOL_NAMES[number];
//# sourceMappingURL=index.d.ts.map