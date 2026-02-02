/**
 * watcherToolWrappers.ts - MCP Tool Wrappers for File Watcher
 *
 * yooo wrapping the watcher tools so they work with MCP protocol
 */
import { getWatcherManager } from './watcherIntegration.js';
import { StartWatchingTheFiles, StartWatchingTheFilesInput } from '../tools/goofy/startWatchingTheFiles.js';
import { StopWatchingTheFiles, StopWatchingTheFilesInput } from '../tools/goofy/stopWatchingTheFiles.js';
import { CheckSyncStatus, CheckSyncStatusInput } from '../tools/goofy/checkSyncStatus.js';
import { ForceResync, ForceResyncInput } from '../tools/goofy/forceResync.js';
/**
 * MCP Tool wrapper for start_watching
 */
export class StartWatchingTool {
    name = 'start_watching';
    description = StartWatchingTheFiles.schema.description;
    inputSchema = StartWatchingTheFiles.schema.inputSchema;
    async execute(params) {
        const validated = StartWatchingTheFilesInput.parse(params);
        const watcher = getWatcherManager();
        if (!watcher) {
            return {
                success: false,
                message: 'File watcher not initialized (disabled in config)',
                projectScoped: true,
                config: {
                    projectPath: validated.rootPath || process.env['SPECMEM_PROJECT_PATH'] || process.cwd(),
                    watchedPaths: [],
                    syncCheckIntervalMinutes: validated.syncCheckIntervalMinutes
                }
            };
        }
        return await StartWatchingTheFiles.execute(validated, watcher);
    }
}
/**
 * MCP Tool wrapper for stop_watching
 */
export class StopWatchingTool {
    name = 'stop_watching';
    description = StopWatchingTheFiles.schema.description;
    inputSchema = StopWatchingTheFiles.schema.inputSchema;
    async execute(params) {
        const validated = StopWatchingTheFilesInput.parse(params);
        const watcher = getWatcherManager();
        if (!watcher) {
            return {
                success: false,
                message: 'File watcher not initialized',
                stats: {
                    eventsProcessed: 0,
                    pendingFlushed: 0
                }
            };
        }
        return await StopWatchingTheFiles.execute(validated, watcher);
    }
}
/**
 * MCP Tool wrapper for check_sync
 */
export class CheckSyncTool {
    name = 'check_sync';
    description = CheckSyncStatus.schema.description;
    inputSchema = CheckSyncStatus.schema.inputSchema;
    async execute(params) {
        const validated = CheckSyncStatusInput.parse(params);
        const watcher = getWatcherManager();
        if (!watcher) {
            throw new Error('File watcher not initialized');
        }
        return await CheckSyncStatus.execute(validated, watcher);
    }
}
/**
 * MCP Tool wrapper for force_resync
 */
export class ForceResyncTool {
    name = 'force_resync';
    description = ForceResync.schema.description;
    inputSchema = ForceResync.schema.inputSchema;
    async execute(params) {
        const validated = ForceResyncInput.parse(params);
        const watcher = getWatcherManager();
        if (!watcher) {
            throw new Error('File watcher not initialized');
        }
        return await ForceResync.execute(validated, watcher);
    }
}
//# sourceMappingURL=watcherToolWrappers.js.map