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
interface CompressionMetrics {
    totalCompressed: number;
    totalOriginalBytes: number;
    totalCompressedBytes: number;
    byContext: {
        search: {
            count: number;
            saved: number;
        };
        system: {
            count: number;
            saved: number;
        };
        hook: {
            count: number;
            saved: number;
        };
    };
    averageRatio: number;
    lastUpdated: Date;
}
/**
 * Get current compression metrics
 */
export declare function getCompressionMetrics(): CompressionMetrics;
/**
 * Reset compression metrics
 */
export declare function resetCompressionMetrics(): void;
export type CompressionContext = 'search' | 'system' | 'hook';
/**
 * Compress a string for  response using Traditional Chinese
 * This is the main entry point for string compression
 *
 * @param text - The text to compress
 * @param context - The context (search, system, hook) for config-aware compression
 * @returns Compressed text (or original if compression disabled/failed)
 */
export declare function compactFor(text: string, context?: CompressionContext): Promise<string>;
/**
 * Compress a string synchronously (for simpler use cases)
 * Uses the smart compress algorithm
 */
export declare function compactForSync(text: string, context?: CompressionContext): string;
/**
 * Recursively compress string fields in an object
 * Handles nested objects and arrays
 */
export declare function compactResponse<T>(response: T, context?: CompressionContext): T;
/**
 * Async version of compactResponse for better compression
 */
export declare function compactResponseAsync<T>(response: T, context?: CompressionContext): Promise<T>;
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
export declare function wrapToolResponse<T>(response: T, context?: CompressionContext): T;
/**
 * Async wrapper for tool responses
 */
export declare function wrapToolResponseAsync<T>(response: T, context?: CompressionContext): Promise<T>;
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
export declare function compressHumanReadableFormat(text: string): string;
/**
 * Create a wrapped execute function that auto-compresses responses
 *
 * Usage:
 *   execute = createCompressedExecute(
 *     this.executeImpl.bind(this),
 *     'search'
 *   );
 */
export declare function createCompressedExecute<TInput, TOutput>(executeFn: (params: TInput) => Promise<TOutput>, context?: CompressionContext): (params: TInput) => Promise<TOutput>;
export { smartCompress, compressToTraditionalChinese, compactIfEnabled, shouldCompress } from '../utils/tokenCompressor.js';
export { getCompressionConfig } from '../config.js';
/**
 * Quick check if compression is globally enabled
 */
export declare function isCompressionEnabled(): boolean;
/**
 * Get a summary of compression savings
 */
export declare function getCompressionSummary(): {
    enabled: boolean;
    totalCompressed: number;
    bytesSaved: number;
    averageRatio: number;
    byContext: Record<string, {
        count: number;
        saved: number;
    }>;
};
//# sourceMappingURL=ResponseCompactor.d.ts.map