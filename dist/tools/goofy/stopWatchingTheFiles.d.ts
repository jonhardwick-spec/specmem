/**
 * stopWatchingTheFiles.ts - Stop File Watcher MCP Tool
 *
 * yooo stopping the file watcher
 */
import { z } from 'zod';
import type { WatcherManager } from '../../watcher/index.js';
export declare const StopWatchingTheFilesInput: z.ZodObject<{
    flushPending: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    flushPending?: boolean;
}, {
    flushPending?: boolean;
}>;
export type StopWatchingTheFilesParams = z.infer<typeof StopWatchingTheFilesInput>;
export interface StopWatchingTheFilesResult {
    success: boolean;
    message: string;
    stats: {
        eventsProcessed: number;
        pendingFlushed: number;
    };
}
/**
 * StopWatchingTheFiles - MCP tool to stop file watcher
 */
export declare class StopWatchingTheFiles {
    /**
     * execute - stops the file watcher
     */
    static execute(params: StopWatchingTheFilesParams, watcherManager: WatcherManager): Promise<StopWatchingTheFilesResult>;
    /**
     * schema - MCP tool schema
     */
    static schema: {
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
    };
}
//# sourceMappingURL=stopWatchingTheFiles.d.ts.map