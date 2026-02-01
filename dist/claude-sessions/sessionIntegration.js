/**
 * sessionIntegration.ts - Integrates  session watcher with SpecMem server
 *
 * yo fr fr this is the glue that connects the session watcher to the MCP server
 * handles initialization, lifecycle, and tool registration
 *
 * Features:
 * - Initializes session watcher on server start
 * - Registers session extraction MCP tools
 * - Handles graceful shutdown
 */
import { logger } from '../utils/logger.js';
import { getConfig, getProjectPath } from '../config.js';
import { createSessionWatcher } from './sessionWatcher.js';
import { getDatabase } from '../database.js';
import { ExtractSessions } from '../tools/goofy/extractSessions.js';
import { GetSessionWatcherStatus } from '../tools/goofy/getSessionWatcherStatus.js';
// Per-project session watcher Map - prevents cross-project pollution
const sessionWatcherByProject = new Map();
/**
 * Check if session watcher is enabled - READS ENV DIRECTLY
 * This is the source of truth, bypassing any config caching issues
 */
function isSessionWatcherEnabled() {
    const envVal = process.env['SPECMEM_SESSION_WATCHER_ENABLED'];
    // Default to true if not set, check for explicit 'false'
    return envVal !== 'false' && envVal !== '0';
}
/**
 * initializeSessionWatcher - initializes and starts the  session watcher
 *
 * nah bruh this starts the auto-extraction magic
 */
export async function initializeSessionWatcher(embeddingProvider) {
    // Check ENV VAR DIRECTLY - this is the source of truth!
    const envEnabled = isSessionWatcherEnabled();
    const configEnabled = getConfig().sessionWatcher?.enabled ?? false;
    logger.info({
        envEnabled,
        configEnabled,
        envValue: process.env['SPECMEM_SESSION_WATCHER_ENABLED'] ?? 'NOT_SET'
    }, 'Session watcher initialization check');
    // Use ENV as source of truth - config might be stale
    if (!envEnabled) {
        logger.info(' session watcher disabled (SPECMEM_SESSION_WATCHER_ENABLED=false)');
        return null;
    }
    logger.info('initializing  session watcher');
    try {
        const db = getDatabase();
        // Get config options with sensible defaults (config.sessionWatcher might be undefined)
        const sessionConfig = getConfig().sessionWatcher;
        const claudeDir = sessionConfig?.claudeDir ?? process.env['SPECMEM_SESSION_CLAUDE_DIR'];
        const debounceMs = sessionConfig?.debounceMs ?? parseInt(process.env['SPECMEM_SESSION_DEBOUNCE_MS'] || '2000', 10);
        const importance = sessionConfig?.importance ?? (process.env['SPECMEM_SESSION_IMPORTANCE'] || 'medium');
        const additionalTags = sessionConfig?.additionalTags ?? (process.env['SPECMEM_SESSION_TAGS'] || '').split(',').filter(t => t.trim());
        // create watcher and store in per-project Map
        const projectPath = getProjectPath();
        const watcher = createSessionWatcher(embeddingProvider, db, {
            claudeDir,
            debounceMs,
            importance,
            additionalTags,
            autoStart: true // auto-start watching
        });
        sessionWatcherByProject.set(projectPath, watcher);
        logger.info({
            claudeDir: claudeDir ?? '~/.claude',
            debounceMs,
            importance,
            tags: additionalTags,
            projectPath
        }, ' session watcher initialized successfully');
        return watcher;
    }
    catch (error) {
        logger.error({ error }, 'failed to initialize  session watcher');
        return null;
    }
}
/**
 * shutdownSessionWatcher - gracefully shuts down the session watcher
 *
 * fr fr clean shutdown when server stops
 * Can optionally shutdown a specific project's watcher or all watchers
 */
export async function shutdownSessionWatcher(projectPath) {
    const targetProject = projectPath || getProjectPath();
    const watcher = sessionWatcherByProject.get(targetProject);
    if (!watcher) {
        return;
    }
    logger.info({ projectPath: targetProject }, 'shutting down  session watcher');
    try {
        await watcher.stopWatching();
        sessionWatcherByProject.delete(targetProject);
        logger.info({ projectPath: targetProject }, ' session watcher shutdown complete');
    }
    catch (error) {
        logger.error({ error, projectPath: targetProject }, 'error shutting down session watcher');
    }
}
/**
 * shutdownAllSessionWatchers - gracefully shuts down all project session watchers
 */
export async function shutdownAllSessionWatchers() {
    logger.info({ count: sessionWatcherByProject.size }, 'shutting down all session watchers');
    for (const [projectPath, watcher] of sessionWatcherByProject) {
        try {
            await watcher.stopWatching();
            logger.info({ projectPath }, 'session watcher shutdown');
        }
        catch (error) {
            logger.error({ error, projectPath }, 'error shutting down session watcher');
        }
    }
    sessionWatcherByProject.clear();
}
/**
 * getSessionWatcher - returns the active session watcher instance for current project
 *
 * yo get the watcher to check status or trigger manual extraction
 */
export function getSessionWatcher(projectPath) {
    const targetProject = projectPath || getProjectPath();
    return sessionWatcherByProject.get(targetProject) || null;
}
/**
 * createSessionExtractionTools - creates the MCP tools for session extraction
 *
 * nah bruh register these tools with the MCP server
 */
export function createSessionExtractionTools(embeddingProvider) {
    const db = getDatabase();
    // create extraction tool
    const extractTool = new ExtractSessions(embeddingProvider, db);
    // create status tool
    const statusTool = new GetSessionWatcherStatus();
    // inject watcher instance if available for current project
    const watcher = sessionWatcherByProject.get(getProjectPath());
    if (watcher) {
        statusTool.setSessionWatcher(watcher);
    }
    return { extractTool, statusTool };
}
//# sourceMappingURL=sessionIntegration.js.map