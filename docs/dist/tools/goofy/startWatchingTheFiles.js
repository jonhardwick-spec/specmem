/**
 * startWatchingTheFiles.ts - Start File Watcher MCP Tool
 *
 * PROJECT-SCOPED: Only watches the current project directory
 * Uses SPECMEM_PROJECT_PATH to determine scope
 */
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { getProjectContext } from '../../services/ProjectContext.js';
import { getWatcherStatus, getWatchedPaths } from '../../mcp/watcherIntegration.js';
export const StartWatchingTheFilesInput = z.object({
    // Note: rootPath is DEPRECATED - always uses project path now
    rootPath: z.string().optional().describe('DEPRECATED: Root directory to watch (ignored - always uses SPECMEM_PROJECT_PATH)'),
    syncCheckIntervalMinutes: z.number().int().min(1).max(1440).default(60).describe('How often to check sync status in minutes (default: 60)')
});
/**
 * StartWatchingTheFiles - MCP tool to start file watcher
 *
 * PROJECT-SCOPED: Only watches the current project, not global paths
 * This prevents RAM bloat from watching files across all sessions
 */
export class StartWatchingTheFiles {
    /**
     * execute - starts the file watcher (PROJECT-SCOPED)
     */
    static async execute(params, watcherManager) {
        const projectPath = getProjectContext().getProjectPath();
        try {
            // Warn if deprecated rootPath was provided
            if (params.rootPath && params.rootPath !== projectPath) {
                logger.warn({
                    providedPath: params.rootPath,
                    projectPath
                }, 'rootPath parameter is DEPRECATED and ignored - using project path instead');
            }
            logger.info({ projectPath }, 'starting PROJECT-SCOPED file watcher via MCP tool');
            // check if already running
            const status = watcherManager.getStatus();
            if (status.isRunning) {
                const watchedPaths = getWatchedPaths();
                return {
                    success: true, // Changed to true - already running is OK
                    message: `File watcher already running for project: ${projectPath}`,
                    projectScoped: true,
                    config: {
                        projectPath,
                        watchedPaths,
                        syncCheckIntervalMinutes: params.syncCheckIntervalMinutes,
                        filesWatched: status.watcher.filesWatched
                    }
                };
            }
            // start the watcher
            await watcherManager.start(params.syncCheckIntervalMinutes);
            // get updated status
            const newStatus = watcherManager.getStatus();
            const watchedPaths = getWatchedPaths();
            // CRITICAL: Verify watcher actually started - dont trust the call alone
            if (!newStatus.isRunning) {
                logger.error({
                    projectPath,
                    status: newStatus
                }, 'watcher start() completed but isRunning is false');
                return {
                    success: false,
                    message: 'Watcher failed to start - manager not running after start() call',
                    projectScoped: true,
                    config: {
                        projectPath,
                        watchedPaths: [],
                        syncCheckIntervalMinutes: params.syncCheckIntervalMinutes
                    }
                };
            }
            // also verify underlying file watcher is actually watching
            if (!newStatus.watcher.isWatching) {
                logger.error({
                    projectPath,
                    watcherStats: newStatus.watcher
                }, 'watcher manager running but file watcher not active');
                return {
                    success: false,
                    message: 'Watcher partially started but file monitoring not active',
                    projectScoped: true,
                    config: {
                        projectPath,
                        watchedPaths: [],
                        syncCheckIntervalMinutes: params.syncCheckIntervalMinutes
                    }
                };
            }
            logger.info({
                projectPath,
                watchedPaths,
                filesWatched: newStatus.watcher.filesWatched
            }, 'PROJECT-SCOPED file watcher started and VERIFIED');
            return {
                success: true,
                message: 'Project-scoped file watcher started and verified. Monitoring ' + newStatus.watcher.filesWatched + ' files in ' + projectPath,
                projectScoped: true,
                config: {
                    projectPath,
                    watchedPaths,
                    syncCheckIntervalMinutes: params.syncCheckIntervalMinutes,
                    filesWatched: newStatus.watcher.filesWatched
                }
            };
        }
        catch (error) {
            logger.error({ error, projectPath }, 'failed to start project-scoped file watcher');
            return {
                success: false,
                message: `Failed to start file watcher: ${error.message}`,
                projectScoped: true,
                config: {
                    projectPath,
                    watchedPaths: [],
                    syncCheckIntervalMinutes: params.syncCheckIntervalMinutes
                }
            };
        }
    }
    /**
     * schema - MCP tool schema
     */
    static schema = {
        name: 'start_watching',
        description: 'Start file watcher to auto-update MCP memories when code changes. Monitors your entire codebase and keeps memories in sync with the filesystem. nah bruh this is ESSENTIAL for keeping everything up to date',
        inputSchema: {
            type: 'object',
            properties: {
                rootPath: {
                    type: 'string',
                    description: 'Root directory to watch (defaults to current working directory)'
                },
                syncCheckIntervalMinutes: {
                    type: 'number',
                    description: 'How often to check sync status in minutes (default: 60)',
                    minimum: 1,
                    maximum: 1440,
                    default: 60
                }
            }
        }
    };
}
/**
 * getWatcherStatusForMcp - helper to get watcher status for MCP responses
 */
export function getWatcherStatusForMcp() {
    const status = getWatcherStatus();
    return {
        isRunning: status.isRunning,
        projectScoped: true, // Always project-scoped now
        projectPath: status.projectPath,
        watchedPaths: status.watchedPaths,
        filesWatched: status.watcherStats?.watcher.filesWatched ?? 0,
        eventsProcessed: status.watcherStats?.watcher.eventsProcessed ?? 0
    };
}
//# sourceMappingURL=startWatchingTheFiles.js.map