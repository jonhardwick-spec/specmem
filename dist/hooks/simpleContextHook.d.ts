/**
 * SIMPLE CONTEXT HOOK
 * ===================
 *
 * PreToolUse hook that searches SpecMem for relevant context
 * before ANY tool executes. Outputs in Chinese Compactor format
 * for maximum token efficiency.
 *
 * This is a LIGHTWEIGHT alternative to the full ContextInjectionHook -
 * it runs on every tool call and returns compact Chinese context.
 *
 * Flow:
 *   1.  calls a tool (any tool)
 *   2. Hook extracts query from tool args
 *   3. Search SpecMem for semantically similar memories
 *   4. Return Chinese-compacted context to 
 *   5.  uses context to inform tool execution
 *
 * For  Code integration, create a hook script that:
 *   - Reads tool name and arguments from stdin (JSON)
 *   - Calls this hook
 *   - Outputs context to stdout
 */
import { MemoryResult } from './contextInjectionHook.js';
export interface SimpleContextHookConfig {
    maxMemories: number;
    maxContentPerMemory: number;
    threshold: number;
    compressOutput: boolean;
    excludeTools: string[];
}
/**
 * Extract a searchable query from tool arguments
 * Different tools have different argument structures
 */
declare function extractQueryFromToolArgs(toolName: string, args: Record<string, unknown>): string | null;
/**
 * Format memories as Chinese-compacted context
 * This is the CORE output format for the hook
 */
declare function formatChineseContext(toolName: string, query: string, memories: MemoryResult[], config: SimpleContextHookConfig): string;
/**
 * Main hook function - call this from your PreToolUse script
 *
 * @param toolName - Name of the tool being called
 * @param args - Tool arguments
 * @param config - Optional configuration override
 * @returns Chinese-compacted context string (empty if no relevant context)
 */
export declare function simpleContextHook(toolName: string, args: Record<string, unknown>, config?: Partial<SimpleContextHookConfig>): Promise<string>;
/**
 * CLI entry point for  Code PreToolUse hook
 * Reads JSON from stdin: { "tool_name": "...", "tool_input": {...} }
 * Outputs context to stdout (or empty if none)
 */
export declare function runFromCLI(): Promise<void>;
declare const _default: {
    simpleContextHook: typeof simpleContextHook;
    runFromCLI: typeof runFromCLI;
    extractQueryFromToolArgs: typeof extractQueryFromToolArgs;
    formatChineseContext: typeof formatChineseContext;
    DEFAULT_SIMPLE_CONFIG: SimpleContextHookConfig;
};
export default _default;
//# sourceMappingURL=simpleContextHook.d.ts.map