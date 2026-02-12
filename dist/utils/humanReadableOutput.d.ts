/**
 * Human-Readable Output Formatter for MCP Tools
 *
 * Converts MCP tool results to hook-style format for easy reading.
 * Format: [SPECMEM-<TOOL>]...[/SPECMEM-<TOOL>] tags with grey text.
 *
 * This matches the format used by  Code hooks for consistency.
 * When humanReadable=true, tools output this instead of compactXmlResponse.
 *
 * SMART COMPRESSION (v1.0.44+):
 * - Preserves: [SPECMEM-*] tags, Query:, Mode:, Found N, percentages, roles, file paths
 * - Compresses: actual content using Traditional Chinese tokens for ~40-60% token savings
 */
/**
 * Result item types that can be formatted
 */
interface MemoryResult {
    id?: string;
    drilldownID?: number | string;
    similarity?: number;
    content?: string;
    tags?: string[];
    type?: string;
    importance?: string;
    createdAt?: string | Date;
    user?: string;
    claude?: string;
}
interface CodeResult {
    id?: string;
    drilldownID?: number;
    file?: string;
    filePath?: string;
    line?: number;
    name?: string;
    signature?: string;
    content?: string;
    similarity?: number;
    language?: string;
    definitionType?: string;
    callers?: string[];
    callees?: string[];
}
interface DrilldownResult {
    content?: string;
    fullContent?: string;
    context?: {
        before?: string[];
        after?: string[];
    };
    code?: Array<{
        file?: string;
        line?: number;
        content?: string;
    }>;
    related?: Array<{
        id?: string;
        drilldownID?: number;
        content?: string;
        similarity?: number;
    }>;
}
type HumanReadableResult = MemoryResult | CodeResult | DrilldownResult;
/**
 * Options for human-readable formatting
 */
export interface HumanReadableOptions {
    /** Apply grey coloring for terminal output (default: true) */
    grey?: boolean;
    /** Include similarity scores (default: true) */
    showSimilarity?: boolean;
    /** Include tags (default: true) */
    showTags?: boolean;
    /** Max content length before truncation (default: 300, 0 = no truncation) */
    maxContentLength?: number;
    /** Tool name override (auto-detected if not provided) */
    toolName?: string;
    /** Apply Chinese token compression (default: false) */
    compress?: boolean;
    /** Show full UUIDs instead of truncated (default: true for drill_down compat) */
    fullIds?: boolean;
    /** Show traceback info (callers/callees) for code results (default: false) */
    showTracebacks?: boolean;
}
/**
 * Main export: Format MCP tool output in hook-style for human readability
 *
 * @param toolName - Name of the MCP tool (e.g., 'find_memory', 'find_code_pointers')
 * @param results - Array of results from the tool
 * @param options - Formatting options
 * @returns Formatted string with [SPECMEM-TOOL] tags
 *
 * Example output:
 * ```
 * [SPECMEM-FIND-MEMORY]
 * 1. [ID:42] (92% match)
 *    Dashboard quadrant layout uses QuadrantRenderer class
 *    Tags: dashboard, ui
 *
 * 2. [ID:43] (87% match)
 *    MCP tools use compactXmlResponse for output
 *    Tags: mcp, formatting
 *
 * Use drill_down(ID) for details.
 * [/SPECMEM-FIND-MEMORY]
 * ```
 */
export declare function formatHumanReadable(toolName: string, results: HumanReadableResult[], options?: HumanReadableOptions & {
    query?: string;
}): string;
/**
 * Format a simple status/info message in hook style
 */
export declare function formatHumanReadableStatus(toolName: string, message: string, options?: {
    grey?: boolean;
}): string;
/**
 * Format an error in hook style
 */
export declare function formatHumanReadableError(toolName: string, error: string | Error, options?: {
    grey?: boolean;
}): string;
export {};
//# sourceMappingURL=humanReadableOutput.d.ts.map