/**
 * memorization/index.ts - Auto-Memorization System for Claude's Code
 *
 * yooo this module makes Claude REMEMBER what it writes
 * no more massive explores because Claude KNOWS what it created
 *
 * The Big Picture:
 * - When Claude writes code (Write, Edit, NotebookEdit), this system captures it
 * - Stores with rich metadata: purpose, related files, tags
 * - Semantic search lets Claude find code by what it does
 * - Version history tracks how code evolved
 *
 * fr fr Claude never forgets what it wrote now
 */
export { CodeMemorizer, RememberCodeParams, RememberCodeResult, StoredCodeEntry, ClaudeOperationType, getCodeMemorizer, resetCodeMemorizer } from './codeMemorizer.js';
export { ClaudeCodeTracker, SessionActivity, EditContext, TrackerConfig, getClaudeCodeTracker, resetClaudeCodeTracker } from './claudeCodeTracker.js';
export { CodeRecall, CodeSearchOptions, CodeSearchResult, CodeTimelineEntry, getCodeRecall, resetCodeRecall } from './codeRecall.js';
export { RememberWhatIWroteTool, WhatDidIWriteForTool, AllMyCodeTool, CodeHistoryTool, WhyDidIWriteThisTool, SetCodingPurposeTool, CodeStatsTool, createMemorizationTools } from './memorizationTools.js';
export { claudeCodeHistoryMigration, runClaudeCodeMigration, isClaudeCodeMigrationApplied } from './claudeCodeMigration.js';
export { WatcherMemorizationBridge, WatcherMemorizationConfig, setupWatcherMemorization, getWatcherMemorizationBridge, setWatcherMemorizationBridge, resetWatcherMemorizationBridge } from './watcherIntegration.js';
import pg from 'pg';
import { EmbeddingProvider } from '../tools/index.js';
import { CodeMemorizer } from './codeMemorizer.js';
import { CodeRecall } from './codeRecall.js';
import { ClaudeCodeTracker, TrackerConfig } from './claudeCodeTracker.js';
import { MCPTool } from '../mcp/toolRegistry.js';
/**
 * Configuration for the memorization system
 */
export interface MemorizationConfig {
    pool: pg.Pool;
    embeddingProvider: EmbeddingProvider;
    trackerConfig?: TrackerConfig;
}
/**
 * Initialized memorization system components
 */
export interface MemorizationSystem {
    memorizer: CodeMemorizer;
    recall: CodeRecall;
    tracker: ClaudeCodeTracker;
    tools: MCPTool[];
}
/**
 * initializeMemorizationSystem - set up the complete memorization system
 *
 * yooo this is the one-stop-shop for getting everything ready
 * call this once at startup and you're good to go
 */
export declare function initializeMemorizationSystem(config: MemorizationConfig): MemorizationSystem;
/**
 * resetMemorizationSystem - reset all singletons (for testing)
 */
export declare function resetMemorizationSystem(): void;
//# sourceMappingURL=index.d.ts.map