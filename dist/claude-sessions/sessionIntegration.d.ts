/**
 * sessionIntegration.ts - Integrates Claude session watcher with SpecMem server
 *
 * yo fr fr this is the glue that connects the session watcher to the MCP server
 * handles initialization, lifecycle, and tool registration
 *
 * Features:
 * - Initializes session watcher on server start
 * - Registers session extraction MCP tools
 * - Handles graceful shutdown
 */
import { ClaudeSessionWatcher } from './sessionWatcher.js';
import { EmbeddingProvider } from '../tools/index.js';
import { ExtractClaudeSessions } from '../tools/goofy/extractClaudeSessions.js';
import { GetSessionWatcherStatus } from '../tools/goofy/getSessionWatcherStatus.js';
/**
 * initializeSessionWatcher - initializes and starts the Claude session watcher
 *
 * nah bruh this starts the auto-extraction magic
 */
export declare function initializeSessionWatcher(embeddingProvider: EmbeddingProvider): Promise<ClaudeSessionWatcher | null>;
/**
 * shutdownSessionWatcher - gracefully shuts down the session watcher
 *
 * fr fr clean shutdown when server stops
 * Can optionally shutdown a specific project's watcher or all watchers
 */
export declare function shutdownSessionWatcher(projectPath?: string): Promise<void>;
/**
 * shutdownAllSessionWatchers - gracefully shuts down all project session watchers
 */
export declare function shutdownAllSessionWatchers(): Promise<void>;
/**
 * getSessionWatcher - returns the active session watcher instance for current project
 *
 * yo get the watcher to check status or trigger manual extraction
 */
export declare function getSessionWatcher(projectPath?: string): ClaudeSessionWatcher | null;
/**
 * createSessionExtractionTools - creates the MCP tools for session extraction
 *
 * nah bruh register these tools with the MCP server
 */
export declare function createSessionExtractionTools(embeddingProvider: EmbeddingProvider): {
    extractTool: ExtractClaudeSessions;
    statusTool: GetSessionWatcherStatus;
};
//# sourceMappingURL=sessionIntegration.d.ts.map