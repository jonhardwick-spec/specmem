/**
 * COT Broadcast - Bridge between MCP tools and Dashboard
 * ========================================================
 *
 * MCP tools generate COT (Chain of Thought) reasoning via MiniCOTScorer,
 * but the dashboard reads Claude's terminal - two disconnected systems.
 *
 * This utility bridges them by:
 * 1. Writing COT to a log file that dashboard tails
 * 2. Providing structured COT messages for display
 *
 * Usage in MCP tools:
 *   import { broadcastCOT } from '../utils/cotBroadcast.js';
 *   broadcastCOT('find_memory', 'Analyzing query: authentication patterns', { confidence: 0.85 });
 */
export interface COTMessage {
    timestamp: string;
    tool: string;
    message: string;
    metadata?: {
        confidence?: number;
        query?: string;
        resultCount?: number;
        phase?: string;
        [key: string]: any;
    };
}
/**
 * Broadcast COT message to dashboard
 *
 * @param tool - Name of the MCP tool (e.g., 'find_memory', 'find_code_pointers')
 * @param message - Human-readable COT message
 * @param metadata - Optional metadata (confidence, resultCount, etc.)
 */
export declare function broadcastCOT(tool: string, message: string, metadata?: COTMessage['metadata']): void;
/**
 * Broadcast COT start phase
 */
export declare function cotStart(tool: string, query: string): void;
/**
 * Broadcast COT analysis phase
 */
export declare function cotAnalyze(tool: string, what: string, confidence?: number): void;
/**
 * Broadcast COT result phase
 */
export declare function cotResult(tool: string, summary: string, resultCount?: number, confidence?: number): void;
/**
 * Broadcast COT error
 */
export declare function cotError(tool: string, error: string): void;
/**
 * Clear COT log (for testing/reset)
 */
export declare function clearCotLog(): void;
//# sourceMappingURL=cotBroadcast.d.ts.map