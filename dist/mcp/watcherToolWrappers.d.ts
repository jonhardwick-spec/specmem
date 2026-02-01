/**
 * watcherToolWrappers.ts - MCP Tool Wrappers for File Watcher
 *
 * yooo wrapping the watcher tools so they work with MCP protocol
 */
import { MCPTool } from './toolRegistry.js';
import { StartWatchingTheFilesParams, StartWatchingTheFilesResult } from '../tools/goofy/startWatchingTheFiles.js';
import { StopWatchingTheFilesParams, StopWatchingTheFilesResult } from '../tools/goofy/stopWatchingTheFiles.js';
import { CheckSyncStatusParams, CheckSyncStatusResult } from '../tools/goofy/checkSyncStatus.js';
import { ForceResyncParams, ForceResyncResult } from '../tools/goofy/forceResync.js';
/**
 * MCP Tool wrapper for start_watching
 */
export declare class StartWatchingTool implements MCPTool<StartWatchingTheFilesParams, StartWatchingTheFilesResult> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            rootPath: {
                type: string;
                description: string;
            };
            syncCheckIntervalMinutes: {
                type: string;
                description: string;
                minimum: number;
                maximum: number;
                default: number;
            };
        };
    };
    execute(params: StartWatchingTheFilesParams): Promise<StartWatchingTheFilesResult>;
}
/**
 * MCP Tool wrapper for stop_watching
 */
export declare class StopWatchingTool implements MCPTool<StopWatchingTheFilesParams, StopWatchingTheFilesResult> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            flushPending: {
                type: string;
                description: string;
                default: boolean;
            };
        };
    };
    execute(params: StopWatchingTheFilesParams): Promise<StopWatchingTheFilesResult>;
}
/**
 * MCP Tool wrapper for check_sync
 */
export declare class CheckSyncTool implements MCPTool<CheckSyncStatusParams, CheckSyncStatusResult> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            detailed: {
                type: string;
                description: string;
                default: boolean;
            };
        };
    };
    execute(params: CheckSyncStatusParams): Promise<CheckSyncStatusResult>;
}
/**
 * MCP Tool wrapper for force_resync
 */
export declare class ForceResyncTool implements MCPTool<ForceResyncParams, ForceResyncResult> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            dryRun: {
                type: string;
                description: string;
                default: boolean;
            };
        };
    };
    execute(params: ForceResyncParams): Promise<ForceResyncResult>;
}
//# sourceMappingURL=watcherToolWrappers.d.ts.map