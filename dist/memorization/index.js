/**
 * memorization/index.ts - Auto-Memorization System for AI-Generated Code
 *
 * yooo this module makes the system REMEMBER what it writes
 * no more massive explores because the system KNOWS what was created
 *
 * The Big Picture:
 * - When code is written (Write, Edit, NotebookEdit), this system captures it
 * - Stores with rich metadata: purpose, related files, tags
 * - Semantic search lets you find code by what it does
 * - Version history tracks how code evolved
 *
 * fr fr never forgets what was written now
 */
// Core components
export { CodeMemorizer, getCodeMemorizer, resetCodeMemorizer } from './codeMemorizer.js';
export { CodeTracker, getCodeTracker, resetCodeTracker } from './claudeCodeTracker.js';
export { CodeRecall, getCodeRecall, resetCodeRecall } from './codeRecall.js';
// MCP Tools
export { RememberWhatIWroteTool, WhatDidIWriteForTool, AllMyCodeTool, CodeHistoryTool, WhyDidIWriteThisTool, SetCodingPurposeTool, CodeStatsTool, createMemorizationTools } from './memorizationTools.js';
// Database migration
export { claudeCodeHistoryMigration, runCodeMigration, isCodeMigrationApplied } from './claudeCodeMigration.js';
// Watcher integration
export { WatcherMemorizationBridge, setupWatcherMemorization, getWatcherMemorizationBridge, setWatcherMemorizationBridge, resetWatcherMemorizationBridge } from './watcherIntegration.js';
import { getCodeMemorizer, resetCodeMemorizer } from './codeMemorizer.js';
import { getCodeRecall, resetCodeRecall } from './codeRecall.js';
import { getCodeTracker, resetCodeTracker } from './claudeCodeTracker.js';
import { createMemorizationTools } from './memorizationTools.js';
import { logger } from '../utils/logger.js';
/**
 * initializeMemorizationSystem - set up the complete memorization system
 *
 * yooo this is the one-stop-shop for getting everything ready
 * call this once at startup and you're good to go
 */
export function initializeMemorizationSystem(config) {
    logger.info('initializing auto-memorization system - about to remember EVERYTHING');
    // create core components
    const memorizer = getCodeMemorizer(config.pool, config.embeddingProvider);
    const recall = getCodeRecall(config.pool, config.embeddingProvider);
    const tracker = getCodeTracker(memorizer, config.trackerConfig);
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
    resetCodeTracker();
    logger.info('memorization system reset');
}
//# sourceMappingURL=index.js.map