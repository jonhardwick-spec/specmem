/**
 * checkSyncStatus.ts - Check Sync Status MCP Tool
 *
 * yooo checking if MCP is in sync with filesystem
 */
import { z } from 'zod';
import type { WatcherManager } from '../../watcher/index.js';
export declare const CheckSyncStatusInput: z.ZodObject<{
    detailed: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    detailed?: boolean;
}, {
    detailed?: boolean;
}>;
export type CheckSyncStatusParams = z.infer<typeof CheckSyncStatusInput>;
export interface CheckSyncStatusResult {
    inSync: boolean;
    syncScore: number;
    driftPercentage: number;
    summary: string;
    stats: {
        totalFiles: number;
        totalMemories: number;
        upToDate: number;
        missingFromMcp: number;
        missingFromDisk: number;
        contentMismatch: number;
    };
    details?: {
        missingFromMcp: string[];
        missingFromDisk: string[];
        contentMismatch: string[];
    };
    watcherStatus: {
        isRunning: boolean;
        eventsProcessed: number;
        queueSize: number;
    };
}
/**
 * CheckSyncStatus - MCP tool to check sync status
 *
 * fr fr verifying everything is synced up
 */
export declare class CheckSyncStatus {
    /**
     * execute - checks sync status
     */
    static execute(params: CheckSyncStatusParams, watcherManager: WatcherManager): Promise<CheckSyncStatusResult>;
    /**
     * schema - MCP tool schema
     */
    static schema: {
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
    };
}
//# sourceMappingURL=checkSyncStatus.d.ts.map