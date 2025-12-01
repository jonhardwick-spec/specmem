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
 *   1. Claude calls a tool (any tool)
 *   2. Hook extracts query from tool args
 *   3. Search SpecMem for semantically similar memories
 *   4. Return Chinese-compacted context to Claude
 *   5. Claude uses context to inform tool execution
 *
 * For Claude Code integration, create a hook script that:
 *   - Reads tool name and arguments from stdin (JSON)
 *   - Calls this hook
 *   - Outputs context to stdout
 */
import { searchRelatedMemories } from './contextInjectionHook.js';
import { smartCompress } from '../utils/tokenCompressor.js';
import { logger } from '../utils/logger.js';
const DEFAULT_SIMPLE_CONFIG = {
    maxMemories: 3,
    maxContentPerMemory: 150,
    threshold: 0.2,
    compressOutput: true,
    excludeTools: ['send_message', 'list_tools', 'get_tool_schema'] // Skip meta tools
};
/**
 * Extract a searchable query from tool arguments
 * Different tools have different argument structures
 */
function extractQueryFromToolArgs(toolName, args) {
    // Common patterns for query extraction
    const queryFields = [
        'query',
        'search',
        'prompt',
        'input',
        'text',
        'content',
        'command',
        'message',
        'path',
        'file_path',
        'pattern'
    ];
    // Try each field
    for (const field of queryFields) {
        const value = args[field];
        if (typeof value === 'string' && value.length > 3) {
            return value;
        }
    }
    // Fallback: combine all string values
    const stringValues = Object.values(args)
        .filter((v) => typeof v === 'string' && v.length > 3)
        .slice(0, 3);
    if (stringValues.length > 0) {
        return stringValues.join(' ');
    }
    // Use tool name as last resort
    return toolName.replace(/_/g, ' ');
}
/**
 * Format memories as Chinese-compacted context
 * This is the CORE output format for the hook
 */
function formatChineseContext(toolName, query, memories, config) {
    if (memories.length === 0) {
        return ''; // No context to inject
    }
    const lines = [];
    // Header (Chinese)
    lines.push(`<specmem-simple query="${query.substring(0, 50)}">`);
    lines.push(`工具: ${toolName} | 相關記憶: ${memories.length}條`);
    // Compact memory summaries
    for (let i = 0; i < memories.length && i < config.maxMemories; i++) {
        const mem = memories[i];
        let content = mem.content.substring(0, config.maxContentPerMemory);
        // Compress content if enabled
        if (config.compressOutput) {
            const compressed = smartCompress(content, {
                threshold: 0.85,
                minLength: 20
            });
            content = compressed.result;
        }
        // Format: [sim%] tag1,tag2 | content...
        const sim = Math.round(mem.similarity * 100);
        const tags = mem.tags.slice(0, 2).join(',') || 'none';
        lines.push(`  ${sim}% [${tags}]: ${content}${mem.content.length > config.maxContentPerMemory ? '...' : ''}`);
    }
    // Footer with hint
    if (memories.length > 0 && memories[0].similarity > 0.5) {
        lines.push(`  ✓ 高相關性 - 直接使用此上下文`);
    }
    else if (memories.length > 0 && memories[0].similarity > 0.3) {
        lines.push(`  → 中等相關 - 可能需要驗證`);
    }
    else {
        lines.push(`  ⚠ 低相關性 - 謹慎使用`);
    }
    lines.push(`</specmem-simple>`);
    return lines.join('\n');
}
/**
 * Main hook function - call this from your PreToolUse script
 *
 * @param toolName - Name of the tool being called
 * @param args - Tool arguments
 * @param config - Optional configuration override
 * @returns Chinese-compacted context string (empty if no relevant context)
 */
export async function simpleContextHook(toolName, args, config = {}) {
    const cfg = { ...DEFAULT_SIMPLE_CONFIG, ...config };
    // Skip excluded tools
    if (cfg.excludeTools.includes(toolName)) {
        return '';
    }
    // Extract query from tool arguments
    const query = extractQueryFromToolArgs(toolName, args);
    if (!query || query.length < 4) {
        return '';
    }
    try {
        const startTime = Date.now();
        // Search SpecMem
        const memories = await searchRelatedMemories(query, {
            searchLimit: cfg.maxMemories,
            threshold: cfg.threshold,
            maxContentLength: cfg.maxContentPerMemory
        });
        const duration = Date.now() - startTime;
        logger.debug({
            tool: toolName,
            query: query.substring(0, 50),
            memoriesFound: memories.length,
            duration
        }, '[SimpleContextHook] 搜索完成');
        // Format as Chinese context
        return formatChineseContext(toolName, query, memories, cfg);
    }
    catch (error) {
        logger.error({ error, tool: toolName }, '[SimpleContextHook] 錯誤');
        return '';
    }
}
/**
 * CLI entry point for Claude Code PreToolUse hook
 * Reads JSON from stdin: { "tool_name": "...", "tool_input": {...} }
 * Outputs context to stdout (or empty if none)
 */
export async function runFromCLI() {
    try {
        // Read from stdin
        const chunks = [];
        for await (const chunk of process.stdin) {
            chunks.push(chunk);
        }
        const input = Buffer.concat(chunks).toString('utf8').trim();
        if (!input) {
            return;
        }
        // Parse JSON input
        const data = JSON.parse(input);
        const toolName = data.tool_name || data.toolName || '';
        const args = data.tool_input || data.toolInput || data.arguments || {};
        // Run hook
        const context = await simpleContextHook(toolName, args);
        // Output context (only if non-empty)
        if (context) {
            console.log(context);
        }
    }
    catch (error) {
        // Silent fail - don't break Claude's flow
        logger.error({ error }, '[SimpleContextHook CLI] Error');
    }
}
// Export for programmatic use
export default {
    simpleContextHook,
    runFromCLI,
    extractQueryFromToolArgs,
    formatChineseContext,
    DEFAULT_SIMPLE_CONFIG
};
//# sourceMappingURL=simpleContextHook.js.map