/**
 * ResponseCompactor - Automatic Chinese Compactor integration for tool responses
 *
 * This service provides:
 * 1. Automatic compression of tool responses using Traditional Chinese
 * 2. Round-trip verified compression (keeps English where translation fails)
 * 3. Configuration-aware compression (respects environment settings)
 * 4. Metrics tracking for token savings
 *
 * Usage:
 *   import { compactResponse, compactFor } from '../services/ResponseCompactor';
 *
 *   // In tool execute():
 *   return compactResponse({ content: "Your response..." }, 'search');
 *
 * Or use the decorator pattern:
 *   return compactFor("Your response text", 'search');
 */
import { getCompressionConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
// ============================================================================
// LOAD NEW TOKEN COMPRESSOR FROM HOOKS (22,672 Chinese codes!)
// ============================================================================
let hooksCompressor = null;
const HOOKS_DIR = join(homedir(), '.claude', 'hooks');
const COMPRESSOR_PATH = join(HOOKS_DIR, 'token-compressor.cjs');
// Use dynamic import for ESM compatibility (require() doesn't work in ESM)
const loadHooksCompressor = async () => {
    try {
        if (existsSync(COMPRESSOR_PATH)) {
            // Use createRequire for .cjs files in ESM context
            const { createRequire } = await import('module');
            const require = createRequire(import.meta.url);
            hooksCompressor = require(COMPRESSOR_PATH);
            logger.info({ path: COMPRESSOR_PATH, codes: Object.keys(hooksCompressor.CODES || {}).length }, 'Loaded token-compressor.cjs from hooks');
        }
    }
    catch (e) {
        logger.warn({ error: e }, 'Failed to load hooks compressor, using fallback');
    }
};
// Initialize async - will use fallback until loaded
loadHooksCompressor();
// Fallback to old compressor if hooks version not available
import { smartCompress as fallbackSmartCompress, shouldCompress as fallbackShouldCompress, smartWordByWordCompress as fallbackWordByWord } from '../utils/tokenCompressor.js';
// Use hooks compressor if available, else fallback
const smartCompress = hooksCompressor?.compress
    ? (text, opts) => ({
        result: hooksCompressor.compress(text),
        compressionRatio: 1 - (hooksCompressor.compress(text).length / text.length),
        wasCompressed: true
    })
    : fallbackSmartCompress;
const smartWordByWordCompress = hooksCompressor?.compress
    ? (text, opts) => ({
        result: hooksCompressor.compress(text),
        compressionRatio: 1 - (hooksCompressor.compress(text).length / text.length),
        wordsCompressed: text.split(/\s+/).length
    })
    : fallbackWordByWord;
const shouldCompress = hooksCompressor
    ? (text, context) => text && text.length > 30
    : fallbackShouldCompress;
const metrics = {
    totalCompressed: 0,
    totalOriginalBytes: 0,
    totalCompressedBytes: 0,
    byContext: {
        search: { count: 0, saved: 0 },
        system: { count: 0, saved: 0 },
        hook: { count: 0, saved: 0 }
    },
    averageRatio: 1.0,
    lastUpdated: new Date()
};
/**
 * Get current compression metrics
 */
export function getCompressionMetrics() {
    return { ...metrics };
}
/**
 * Reset compression metrics
 */
export function resetCompressionMetrics() {
    metrics.totalCompressed = 0;
    metrics.totalOriginalBytes = 0;
    metrics.totalCompressedBytes = 0;
    metrics.byContext.search = { count: 0, saved: 0 };
    metrics.byContext.system = { count: 0, saved: 0 };
    metrics.byContext.hook = { count: 0, saved: 0 };
    metrics.averageRatio = 1.0;
    metrics.lastUpdated = new Date();
}
/**
 * Update metrics with new compression result
 */
function updateMetrics(originalLen, compressedLen, context) {
    metrics.totalCompressed++;
    metrics.totalOriginalBytes += originalLen;
    metrics.totalCompressedBytes += compressedLen;
    metrics.byContext[context].count++;
    metrics.byContext[context].saved += (originalLen - compressedLen);
    metrics.averageRatio = metrics.totalCompressedBytes / metrics.totalOriginalBytes;
    metrics.lastUpdated = new Date();
}
/**
 * Compress a string for  response using Traditional Chinese
 * This is the main entry point for string compression
 *
 * @param text - The text to compress
 * @param context - The context (search, system, hook) for config-aware compression
 * @returns Compressed text (or original if compression disabled/failed)
 */
export async function compactFor(text, context = 'system') {
    if (!text || typeof text !== 'string')
        return text;
    // Check if compression is enabled for this context
    if (!shouldCompress(text, context)) {
        return text;
    }
    const originalLen = text.length;
    try {
        // Use word-by-word compression for best results
        const { result, compressionRatio, wordsCompressed } = smartWordByWordCompress(text, {
            threshold: 0.8,
            minWordLength: 3
        });
        // Only use compressed result if it's meaningfully smaller
        if (compressionRatio < 0.95 && wordsCompressed > 0) {
            updateMetrics(originalLen, result.length, context);
            logger.debug({
                context,
                originalLen,
                compressedLen: result.length,
                ratio: compressionRatio,
                wordsCompressed
            }, 'Text compressed for ');
            return result;
        }
        return text;
    }
    catch (error) {
        logger.warn({ error, context }, 'Compression failed, returning original text');
        return text;
    }
}
/**
 * Compress a string synchronously (for simpler use cases)
 * Uses the smart compress algorithm
 */
export function compactForSync(text, context = 'system') {
    if (!text || typeof text !== 'string')
        return text;
    if (!shouldCompress(text, context)) {
        return text;
    }
    const originalLen = text.length;
    try {
        const { result, compressionRatio, wasCompressed } = smartCompress(text, {
            threshold: 0.8,
            minLength: 50
        });
        if (wasCompressed && compressionRatio < 0.95) {
            updateMetrics(originalLen, result.length, context);
            return result;
        }
        return text;
    }
    catch (error) {
        return text;
    }
}
// ============================================================================
// RESPONSE OBJECT COMPRESSION
// ============================================================================
/**
 * Recursively compress string fields in an object
 * Handles nested objects and arrays
 */
export function compactResponse(response, context = 'system') {
    if (!shouldCompress('x'.repeat(100), context)) {
        return response;
    }
    return compactObjectRecursive(response, context);
}
/**
 * Async version of compactResponse for better compression
 */
export async function compactResponseAsync(response, context = 'system') {
    if (!shouldCompress('x'.repeat(100), context)) {
        return response;
    }
    return compactObjectRecursiveAsync(response, context);
}
/**
 * Recursively process object for compression (sync)
 */
function compactObjectRecursive(obj, context) {
    if (obj === null || obj === undefined)
        return obj;
    // Handle strings
    if (typeof obj === 'string') {
        return compactForSync(obj, context);
    }
    // Handle arrays
    if (Array.isArray(obj)) {
        return obj.map(item => compactObjectRecursive(item, context));
    }
    // Handle objects
    if (typeof obj === 'object') {
        const compressed = {};
        for (const [key, value] of Object.entries(obj)) {
            // Skip certain keys that should not be compressed
            if (shouldSkipKey(key)) {
                compressed[key] = value;
                continue;
            }
            // Compress string fields that are commonly verbose
            if (isCompressibleKey(key) && typeof value === 'string') {
                compressed[key] = compactForSync(value, context);
            }
            else if (typeof value === 'object' && value !== null) {
                compressed[key] = compactObjectRecursive(value, context);
            }
            else {
                compressed[key] = value;
            }
        }
        return compressed;
    }
    return obj;
}
/**
 * Recursively process object for compression (async)
 */
async function compactObjectRecursiveAsync(obj, context) {
    if (obj === null || obj === undefined)
        return obj;
    // Handle strings
    if (typeof obj === 'string') {
        return compactFor(obj, context);
    }
    // Handle arrays
    if (Array.isArray(obj)) {
        return Promise.all(obj.map(item => compactObjectRecursiveAsync(item, context)));
    }
    // Handle objects
    if (typeof obj === 'object') {
        const compressed = {};
        for (const [key, value] of Object.entries(obj)) {
            // Skip certain keys that should not be compressed
            if (shouldSkipKey(key)) {
                compressed[key] = value;
                continue;
            }
            // Compress string fields that are commonly verbose
            if (isCompressibleKey(key) && typeof value === 'string') {
                compressed[key] = await compactFor(value, context);
            }
            else if (typeof value === 'object' && value !== null) {
                compressed[key] = await compactObjectRecursiveAsync(value, context);
            }
            else {
                compressed[key] = value;
            }
        }
        return compressed;
    }
    return obj;
}
/**
 * Keys that should NEVER be compressed
 * These contain identifiers, paths, or structured data
 */
function shouldSkipKey(key) {
    const skipKeys = new Set([
        'id',
        'memory_id',
        'memoryId',
        'file_path',
        'filePath',
        'url',
        'path',
        'embedding',
        '_drill',
        'drill_hint',
        'timestamp',
        'created_at',
        'updated_at',
        'createdAt',
        'updatedAt',
        'hash',
        'signature',
        'token',
        'key',
        'uuid',
        'source_file_path',
        'target_path',
        'resolved_path',
        'name', // Function/class names should stay English
        'qualified_name',
        'definition_type',
        'language',
        'language_name',
        'line_number',
        'start_line',
        'end_line',
        'import_type'
    ]);
    return skipKeys.has(key) || key.startsWith('_');
}
/**
 * Keys that ARE good candidates for compression
 */
function isCompressibleKey(key) {
    const compressibleKeys = new Set([
        'content',
        'content_preview',
        'message',
        'description',
        'summary',
        'text',
        'result',
        'output',
        'response',
        'body',
        'explanation',
        'reason',
        'details',
        'info',
        'context',
        'contextHint',
        '_contextHint',
        'prompt',
        'instruction',
        'hint',
        'note',
        'comment',
        'docstring',
        'thumbnail',
        'preview',
        'snippet',
        'cot', // Chain of thought reasoning
        'contextForTeam Member',
        'taskPrompt',
        'researchQuestions'
    ]);
    return compressibleKeys.has(key);
}
// ============================================================================
// TOOL RESPONSE WRAPPER
// ============================================================================
/**
 * Wrapper function for tool execute methods
 * Automatically compresses the response before returning
 *
 * Usage in tool:
 *   async execute(params: MyParams): Promise<MyResult> {
 *     const result = await this.doWork(params);
 *     return wrapToolResponse(result, 'search');
 *   }
 */
export function wrapToolResponse(response, context = 'system') {
    return compactResponse(response, context);
}
/**
 * Async wrapper for tool responses
 */
export async function wrapToolResponseAsync(response, context = 'system') {
    return compactResponseAsync(response, context);
}
// ============================================================================
// HUMAN-READABLE FORMAT COMPRESSION
// ============================================================================
/**
 * Smart compress humanReadable format - preserves structure, compresses content
 *
 * Input format:
 * [SPECMEM-FIND-MEMORY]
 * Query: "search term"
 * Mode: SEMANTIC SEARCH
 * Found 3 relevant memories:
 *
 * 1. [70%] [USER] actual content here that can be compressed...
 * 2. [65%] [CLAUDE] more content here...
 *
 * Use drill_down(ID) for details.
 * [/SPECMEM-FIND-MEMORY]
 *
 * Preserves: tags, Query:, Mode:, Found N, percentages, roles, drill_down hints
 * Compresses: actual memory/code content
 */
export function compressHumanReadableFormat(text) {
    // Remove ANSI codes for processing, re-add at end
    const hasAnsi = text.includes('\x1b[');
    const cleanText = text.replace(/\x1b\[\d+m/g, '');
    const lines = cleanText.split('\n');
    const compressedLines = [];
    for (const line of lines) {
        // Preserve structure lines as-is
        if (line.startsWith('[SPECMEM-') ||
            line.startsWith('[/SPECMEM-') ||
            line.startsWith('[CAMERA-ROLL]') ||
            line.startsWith('[/CAMERA-ROLL]') ||
            line.startsWith('Query:') ||
            line.startsWith('Zoom:') ||
            line.startsWith('Mode:') ||
            line.startsWith('Found ') ||
            line.startsWith('Use drill_down') ||
            line.startsWith('Use get_memory') ||
            line.startsWith('drill_down(') ||
            line.trim() === '') {
            compressedLines.push(line);
            continue;
        }
        // For content lines (N. [X%] [ROLE] content...), compress only the content part
        const contentMatch = line.match(/^(\d+\.\s*\[\d+%\]\s*(?:\[USER\]|\[CLAUDE\]|\[戶[^\]]*\]|\[克勞德[^\]]*\])?\s*)(.*)$/);
        if (contentMatch) {
            const [, prefix, content] = contentMatch;
            // Compress the content portion using smart compressor
            const { result: compressed } = smartCompress(content);
            compressedLines.push(prefix + compressed);
            continue;
        }
        // For code format lines (N. [X%] name (type)), check for File: lines
        const fileMatch = line.match(/^(\s*File:\s*)(.*)$/);
        if (fileMatch) {
            // Keep file paths as-is
            compressedLines.push(line);
            continue;
        }
        // For other indented content lines (signatures, etc.), compress
        if (line.startsWith('   ')) {
            const { result: compressed } = smartCompress(line.trim());
            compressedLines.push('   ' + compressed);
            continue;
        }
        // Default: compress the whole line
        const { result: compressedLine } = smartCompress(line);
        compressedLines.push(compressedLine);
    }
    const result = compressedLines.join('\n');
    // Re-add ANSI grey if original had it
    if (hasAnsi) {
        return '\x1b[90m' + result + '\x1b[0m';
    }
    return result;
}
// ============================================================================
// DECORATOR HELPERS (for class methods)
// ============================================================================
/**
 * Create a wrapped execute function that auto-compresses responses
 *
 * Usage:
 *   execute = createCompressedExecute(
 *     this.executeImpl.bind(this),
 *     'search'
 *   );
 */
export function createCompressedExecute(executeFn, context = 'system') {
    return async (params) => {
        const result = await executeFn(params);
        return compactResponseAsync(result, context);
    };
}
// ============================================================================
// CONVENIENCE EXPORTS
// ============================================================================
export { smartCompress, compressToTraditionalChinese, compactIfEnabled, shouldCompress } from '../utils/tokenCompressor.js';
// Re-export config getter for convenience
export { getCompressionConfig } from '../config.js';
/**
 * Quick check if compression is globally enabled
 */
export function isCompressionEnabled() {
    try {
        const cfg = getCompressionConfig();
        return cfg.enabled;
    }
    catch {
        return true; // Default to enabled
    }
}
/**
 * Get a summary of compression savings
 */
export function getCompressionSummary() {
    return {
        enabled: isCompressionEnabled(),
        totalCompressed: metrics.totalCompressed,
        bytesSaved: metrics.totalOriginalBytes - metrics.totalCompressedBytes,
        averageRatio: metrics.averageRatio,
        byContext: { ...metrics.byContext }
    };
}
//# sourceMappingURL=ResponseCompactor.js.map