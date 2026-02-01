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
// Core components
export { CodeMemorizer, getCodeMemorizer, resetCodeMemorizer } from './codeMemorizer.js';
export { ClaudeCodeTracker, getClaudeCodeTracker, resetClaudeCodeTracker } from './claudeCodeTracker.js';
export { CodeRecall, getCodeRecall, resetCodeRecall } from './codeRecall.js';
// MCP Tools
export { RememberWhatIWroteTool, WhatDidIWriteForTool, AllMyCodeTool, CodeHistoryTool, WhyDidIWriteThisTool, SetCodingPurposeTool, CodeStatsTool, createMemorizationTools } from './memorizationTools.js';
// Database migration
export { claudeCodeHistoryMigration, runClaudeCodeMigration, isClaudeCodeMigrationApplied } from './claudeCodeMigration.js';
// Watcher integration
export { WatcherMemorizationBridge, setupWatcherMemorization, getWatcherMemorizationBridge, setWatcherMemorizationBridge, resetWatcherMemorizationBridge } from './watcherIntegration.js';
import { getCodeMemorizer, resetCodeMemorizer } from './codeMemorizer.js';
import { getCodeRecall, resetCodeRecall } from './codeRecall.js';
import { getClaudeCodeTracker, resetClaudeCodeTracker } from './claudeCodeTracker.js';
import { createMemorizationTools } from './memorizationTools.js';
import { logger } from '../utils/logger.js';
/**
 * initializeMemorizationSystem - set up the complete memorization system
 *
 * yooo this is the one-stop-shop for getting everything ready
 * call this once at startup and you're good to go
 */
export function initializeMemorizationSystem(config) {
    logger.info('initializing auto-memorization system - Claude about to remember EVERYTHING');
    // create core components
    const memorizer = getCodeMemorizer(config.pool, config.embeddingProvider);
    const recall = getCodeRecall(config.pool, config.embeddingProvider);
    const tracker = getClaudeCodeTracker(memorizer, config.trackerConfig);
    // create MCP tools
    const tools = createMemorizationTools(memorizer, recall, tracker);
    logger.info({
        toolCount: tools.length,
        toolNames: tools.map(t => t.name)
    }, 'memorization system initialized - WE READY');
    return {
        memorizer,
        recall,
        tracker,
        tools
    };
}
/**
 * resetMemorizationSystem - reset all singletons (for testing)
 */
export function resetMemorizationSystem() {
    resetCodeMemorizer();
    resetCodeRecall();
    resetClaudeCodeTracker();
    logger.info('memorization system reset');
}
//# sourceMappingURL=index.js.map