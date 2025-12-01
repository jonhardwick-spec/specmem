/**
 * startWatchingTheFiles.ts - Start File Watcher MCP Tool
 *
 * PROJECT-SCOPED: Only watches the current project directory
 * Uses SPECMEM_PROJECT_PATH to determine scope
 */
import { z } from 'zod';
import { WatcherManager } from '../../watcher/index.js';
export declare const StartWatchingTheFilesInput: z.ZodObject<{
    rootPath: z.ZodOptional<z.ZodString>;
    syncCheckIntervalMinutes: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    rootPath?: string;
    syncCheckIntervalMinutes?: number;
}, {
    rootPath?: string;
    syncCheckIntervalMinutes?: number;
}>;
export type StartWatchingTheFilesParams = z.infer<typeof StartWatchingTheFilesInput>;
export interface StartWatchingTheFilesResult {
    success: boolean;
    message: string;
    projectScoped: boolean;
    config: {
        projectPath: string;
        watchedPaths: string[];
        syncCheckIntervalMinutes: number;
        filesWatched?: number;
    };
}
/**
 * StartWatchingTheFiles - MCP tool to start file watcher
 *
 * PROJECT-SCOPED: Only watches the current project, not global paths
 * This prevents RAM bloat from watching files across all sessions
 */
export declare class StartWatchingTheFiles {
    /**
     * execute - starts the file watcher (PROJECT-SCOPED)
     */
    static execute(params: StartWatchingTheFilesParams, watcherManager: WatcherManager): Promise<StartWatchingTheFilesResult>;
    /**
     * schema - MCP tool schema
     */
    static schema: {
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
    };
}
/**
 * GetWatcherStatusResult - type for watcher status
 */
export interface GetWatcherStatusResult {
    isRunning: boolean;
    projectScoped: boolean;
    projectPath: string | null;
    watchedPaths: string[];
    filesWatched: number;
    eventsProcessed: number;
}
/**
 * getWatcherStatusForMcp - helper to get watcher status for MCP responses
 */
export declare function getWatcherStatusForMcp(): GetWatcherStatusResult;
//# sourceMappingURL=startWatchingTheFiles.d.ts.map