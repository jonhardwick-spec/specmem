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
import { smartCompress, shouldCompress } from './tokenCompressor.js';
// ANSI color codes for terminal output
// Colors DISABLED by default - MCP responses don't need terminal styling
// Set SPECMEM_COLOR=1 to enable if your terminal handles it properly
// Many terminals (esp XFCE) show garbled rainbow output with ANSI codes
const USE_COLOR = process.env.SPECMEM_COLOR === '1';
const GREY = USE_COLOR ? '\x1b[90m' : '';
const RESET = USE_COLOR ? '\x1b[0m' : '';
const DIM = USE_COLOR ? '\x1b[2m' : '';
/**
 * Compress content text while preserving structural elements
 * Only compresses the actual content, not tags/metadata
 */
function compressContent(content) {
    if (!shouldCompress(content)) {
        return content;
    }
    try {
        const { result, wasCompressed } = smartCompress(content, {
            threshold: 0.75, // Slightly lower threshold for content compression
            minLength: 30 // Compress even shorter content
        });
        return wasCompressed ? result : content;
    }
    catch {
        return content;
    }
}
/**
 * Truncate with middle ellipsis - shows first N words ... last N words
 * yooo this keeps the important parts visible
 */
function middleTruncate(text, firstWords = 8, lastWords = 8) {
    const words = text.split(/\s+/);
    if (words.length <= firstWords + lastWords + 2) {
        return text; // Short enough, no truncation needed
    }
    const first = words.slice(0, firstWords).join(' ');
    const last = words.slice(-lastWords).join(' ');
    return `${first}...${last}`;
}
/**
 * Format a single memory result for human reading
 * Format: [N] XX% #ID [USER] prompt [CLAUDE] response
 * Respects maxContentLength and compress options
 */
function formatMemoryItem(item, index, opts) {
    const content = (item.content || '').replace(/\n/g, ' ').trim();
    const maxLen = opts.maxContentLength || 300;
    const shouldTruncate = maxLen > 0;
    const doCompress = opts.compress === true;
    // Helper to optionally compress text
    const maybeCompress = (text) => doCompress ? compressContent(text) : text;
    // Helper to optionally truncate text
    const maybeTruncate = (text, limit) => {
        if (!shouldTruncate || limit === 0)
            return text;
        return text.length > limit ? text.slice(0, limit) + '...' : text;
    };
    // Parse USER and CLAUDE parts if both present
    const userMatch = content.match(/\[USER\]\s*([^\[]*)/i);
    const claudeMatch = content.match(/\[CLAUDE\]\s*(.*)/i);
    let userPart = '';
    let claudePart = '';
    if (userMatch && claudeMatch) {
        // Both parts present
        userPart = maybeCompress(maybeTruncate(userMatch[1].trim(), maxLen / 2));
        claudePart = maybeCompress(maybeTruncate(claudeMatch[1].trim(), maxLen / 2));
    }
    else {
        // Single role - detect and format
        const isUser = content.startsWith('[USER]') || content.includes('用戶]') || content.includes('[戶');
        const is = content.startsWith('[CLAUDE]') || content.includes('助手]') || content.includes('[克勞德');
        let cleanContent = content
            .replace(/^\[USER\]\s*/i, '')
            .replace(/^\[CLAUDE\]\s*/i, '')
            .replace(/^用戶\]\s*/i, '')
            .replace(/^助手\]\s*/i, '')
            .replace(/^\[戶[^\]]*\]\s*/i, '')
            .replace(/^\[克勞德[^\]]*\]\s*/i, '')
            .trim();
        if (isUser) {
            userPart = maybeCompress(maybeTruncate(cleanContent, maxLen));
        }
        else if (is) {
            claudePart = maybeCompress(maybeTruncate(cleanContent, maxLen));
        }
        else {
            // Unknown role
            claudePart = maybeCompress(maybeTruncate(cleanContent, maxLen));
        }
    }
    // Build output line: [N] XX% #ID [USER] ... [CLAUDE] ...
    const simStr = opts.showSimilarity && item.similarity != null
        ? Math.round(item.similarity * 100) + '%'
        : '';
    // ID for drill_down - use drilldownID if available, else full UUID (or truncated if fullIds=false)
    let displayId;
    if (item.drilldownID != null) {
        displayId = String(item.drilldownID);
    }
    else if (item.id) {
        displayId = opts.fullIds !== false ? item.id : item.id.slice(0, 8);
    }
    else {
        displayId = '?';
    }
    let line = `[${index + 1}] ${simStr} #${displayId}`;
    // Only show parts that have actual content - no placeholders
    if (userPart && userPart.length > 5)
        line += ` [USER] ${userPart}`;
    if (claudePart && claudePart.length > 5)
        line += ` [CLAUDE] ${claudePart}`;
    // If neither part has content, show raw content preview
    if (!userPart && !claudePart && content.length > 0) {
        line += ` ${maybeCompress(maybeTruncate(content, maxLen))}`;
    }
    return line.trim();
}
/**
 * Format a single code result for human reading
 * Matches smart-context-hook format: [X%] name (type)\n   File: path:line
 * NOTE: Does NOT compress code items - file paths, function names, signatures
 * must remain exact for accurate reference
 */
function formatCodeItem(item, index, opts) {
    const lines = [];
    // Format: N. [X%] name (type)
    const simStr = opts.showSimilarity && item.similarity != null
        ? '[' + Math.round(item.similarity * 100) + '%]'
        : '';
    const name = item.name || item.signature || '(file)';
    // Show type - default to 'file' for file-level matches without definition_type
    const typeStr = item.definitionType ? ' (' + item.definitionType + ')' : '';
    lines.push(`${index + 1}. ${simStr} ${name}${typeStr}`.trim());
    // File: path:line (PRESERVED - never compress file paths)
    // Only show line number if > 0 (0 means no line info available)
    const file = item.file || item.filePath || 'unknown';
    const lineStr = item.line && item.line > 0 ? ':' + item.line : '';
    lines.push('   File: ' + file + lineStr);
    // Language if present
    if (item.language) {
        lines.push('   Language: ' + item.language);
    }
    // Signature if different from name (PRESERVED - code signatures stay exact)
    if (item.signature && item.signature !== name) {
        lines.push('   Signature: ' + item.signature);
    }
    // Traceback info - show callers/callees if enabled and present
    if (opts.showTracebacks) {
        // Show callers (who calls this code)
        if (item.callers && item.callers.length > 0) {
            const callerFiles = item.callers.map(f => f.split('/').pop() || f).join(', ');
            lines.push('   Called by: ' + callerFiles);
        }
        // Show callees (what this code calls)
        if (item.callees && item.callees.length > 0) {
            const calleeFiles = item.callees.map(f => f.split('/').pop() || f).join(', ');
            lines.push('   Calls: ' + calleeFiles);
        }
    }
    return lines.join('\n');
}
/**
 * Format drilldown result for human reading
 * Respects compress option - only compresses if explicitly enabled
 */
function formatDrilldownItem(item, opts) {
    const sections = [];
    const doCompress = opts.compress === true;
    const maybeCompress = (text) => doCompress ? compressContent(text) : text;
    // main content
    const content = item.fullContent || item.content;
    if (content) {
        sections.push('CONTENT:');
        const lines = content.split('\n').slice(0, 20);
        const formattedLines = lines.map(l => '  ' + maybeCompress(l));
        sections.push(formattedLines.join('\n'));
        if (content.split('\n').length > 20) {
            sections.push('  ... (' + (content.split('\n').length - 20) + ' more lines)');
        }
    }
    // conversation context
    if (item.context) {
        if (item.context.before && item.context.before.length > 0) {
            sections.push('\nCONTEXT BEFORE:');
            item.context.before.slice(0, 3).forEach((c, i) => {
                const truncated = c.replace(/\n/g, ' ').slice(0, 150);
                sections.push('  [' + (i + 1) + '] ' + maybeCompress(truncated) + '...');
            });
        }
        if (item.context.after && item.context.after.length > 0) {
            sections.push('\nCONTEXT AFTER:');
            item.context.after.slice(0, 3).forEach((c, i) => {
                const truncated = c.replace(/\n/g, ' ').slice(0, 150);
                sections.push('  [' + (i + 1) + '] ' + maybeCompress(truncated) + '...');
            });
        }
    }
    // code references (never compress - paths must be exact)
    if (item.code && item.code.length > 0) {
        sections.push('\nCODE REFERENCES:');
        item.code.slice(0, 5).forEach((c, i) => {
            const loc = c.file ? c.file + (c.line ? ':' + c.line : '') : 'inline';
            sections.push('  [' + (i + 1) + '] ' + loc);
            if (c.content) {
                const preview = c.content.replace(/\n/g, ' ').slice(0, 100);
                sections.push('      ' + preview + (c.content.length > 100 ? '...' : ''));
            }
        });
    }
    // related memories - show full IDs for drill_down
    if (item.related && item.related.length > 0) {
        sections.push('\nRELATED (drill_down for more):');
        item.related.slice(0, 5).forEach((r, i) => {
            const idStr = r.drilldownID != null ? 'ID:' + r.drilldownID : (r.id || '?');
            const simStr = r.similarity != null ? ' ' + Math.round(r.similarity * 100) + '%' : '';
            const preview = (r.content || '').replace(/\n/g, ' ').slice(0, 100);
            sections.push('  [' + idStr + ']' + simStr + ' ' + maybeCompress(preview) + '...');
        });
    }
    return sections.join('\n');
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
export function formatHumanReadable(toolName, results, options) {
    const opts = {
        grey: true,
        showSimilarity: true,
        showTags: true,
        maxContentLength: 70, // Default: 70 chars for quick overview
        compress: true, // Default: smartCompress for 30-70% token savings
        fullIds: true, // Default: show full UUIDs for drill_down compat
        ...options
    };
    // convert tool name to tag format: find_memory -> FIND-MEMORY
    const tag = toolName.toUpperCase().replace(/_/g, '-');
    // color codes
    const grey = opts.grey ? GREY : '';
    const reset = opts.grey ? RESET : '';
    // Build header with query and mode (like smart-context-hook)
    let header = '';
    if (options?.query) {
        header += `Query: "${options.query}"\n`;
    }
    header += `Mode: SEMANTIC SEARCH\n`;
    // format based on result type
    let content;
    let hint;
    if (!Array.isArray(results) || results.length === 0) {
        content = 'No results found.';
        hint = '';
    }
    else {
        // detect result type from first item
        const first = results[0];
        if (first.file || first.filePath || first.signature || first.definitionType) {
            // code results
            header += `Found ${results.length} code definitions:\n`;
            content = results.map((r, i) => formatCodeItem(r, i, opts)).join('\n');
            hint = '\ndrill_down(ID) 獲取完整代碼';
        }
        else if (first.fullContent !== undefined || first.context !== undefined) {
            // drilldown result (single item typically)
            content = formatDrilldownItem(first, opts);
            hint = '';
            header = ''; // No header for drilldown
        }
        else {
            // memory results - deduplicate by content similarity
            const seen = new Set();
            const deduped = results.filter(r => {
                // Create content fingerprint (first 50 chars normalized)
                const fingerprint = (r.content || '').replace(/\s+/g, ' ').trim().slice(0, 50).toLowerCase();
                if (seen.has(fingerprint))
                    return false;
                seen.add(fingerprint);
                return true;
            });
            header += `Found ${deduped.length} relevant memories:\n`;
            content = deduped.map((r, i) => formatMemoryItem(r, i, opts)).join('\n');
            hint = '\ndrill_down(ID) 獲取完整內容';
        }
    }
    return grey + '[SPECMEM-' + tag + ']\n' + header + content + hint + '\n[/SPECMEM-' + tag + ']' + reset;
}
/**
 * Format a simple status/info message in hook style
 */
export function formatHumanReadableStatus(toolName, message, options) {
    const tag = toolName.toUpperCase().replace(/_/g, '-');
    const grey = options?.grey !== false ? GREY : '';
    const reset = options?.grey !== false ? RESET : '';
    return grey + '[SPECMEM-' + tag + ']\n' + message + '\n[/SPECMEM-' + tag + ']' + reset;
}
/**
 * Format an error in hook style
 */
export function formatHumanReadableError(toolName, error, options) {
    const tag = toolName.toUpperCase().replace(/_/g, '-');
    const grey = options?.grey !== false ? GREY : '';
    const reset = options?.grey !== false ? RESET : '';
    const errorMsg = error instanceof Error ? error.message : error;
    return grey + '[SPECMEM-' + tag + '-ERROR]\n' + errorMsg + '\n[/SPECMEM-' + tag + '-ERROR]' + reset;
}
//# sourceMappingURL=humanReadableOutput.js.map