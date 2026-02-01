/**
 * startupIndexing.ts - Automatic Indexing on MCP Server Startup
 *
 * FIXES THE PROBLEM: When MCP server starts, it doesn't automatically index
 * the codebase or extract sessions. This module provides:
 *
 * 1. Check if codebase is indexed (or stale)
 * 2. Check if sessions are extracted (or new ones exist)
 * 3. Trigger background indexing/extraction when needed
 * 4. Report progress in server logs
 *
 * Everything is ready when Claude starts, not on-demand!
 */
import { DatabaseManager } from '../database.js';
import { EmbeddingProvider } from '../tools/index.js';
/**
 * Check if codebase has been indexed for this project
 * Returns stats about the current index state
 */
export declare function checkCodebaseIndexStatus(db: DatabaseManager): Promise<{
    isIndexed: boolean;
    fileCount: number;
    lastIndexed: Date | null;
    needsReindex: boolean;
}>;
/**
 * Check if Claude sessions have been extracted
 * Returns stats about extracted sessions
 */
export declare function checkSessionExtractionStatus(db: DatabaseManager): Promise<{
    hasExtractedSessions: boolean;
    sessionCount: number;
    lastExtraction: Date | null;
    needsExtraction: boolean;
}>;
/**
 * Trigger background codebase indexing
 * Runs asynchronously and logs progress
 */
export declare function triggerBackgroundIndexing(embeddingProvider: EmbeddingProvider, options?: {
    force?: boolean;
    silent?: boolean;
}): Promise<void>;
/**
 * Trigger background session extraction
 * Extracts Claude Code sessions asynchronously
 */
export declare function triggerBackgroundSessionExtraction(embeddingProvider: EmbeddingProvider, options?: {
    force?: boolean;
    silent?: boolean;
    mode?: 'all' | 'new';
}): Promise<void>;
/**
 * Run startup indexing checks and trigger background tasks
 * This is called from main() after MCP connection is established
 */
export declare function runStartupIndexing(embeddingProvider: EmbeddingProvider, options?: {
    skipCodebase?: boolean;
    skipSessions?: boolean;
    force?: boolean;
}): Promise<{
    codebaseStatus: {
        wasIndexed: boolean;
        triggeredIndexing: boolean;
    };
    sessionStatus: {
        wasExtracted: boolean;
        triggeredExtraction: boolean;
    };
}>;
/**
 * Get current indexing status for dashboard/status queries
 */
export declare function getIndexingStatus(projectPath?: string): {
    codebaseIndexing: boolean;
    sessionExtraction: boolean;
    lastCodebaseCheck: Date | null;
    lastSessionCheck: Date | null;
};
//# sourceMappingURL=startupIndexing.d.ts.map