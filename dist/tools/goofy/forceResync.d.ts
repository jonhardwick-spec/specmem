/**
 * forceResync.ts - Force Full Resync MCP Tool
 *
 * yooo forcing a full resync of everything
 */
import { z } from 'zod';
import { WatcherManager } from '../../watcher/index.js';
export declare const ForceResyncInput: z.ZodObject<{
    dryRun: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    dryRun?: boolean;
}, {
    dryRun?: boolean;
}>;
export type ForceResyncParams = z.infer<typeof ForceResyncInput>;
export interface ForceResyncResult {
    success: boolean;
    message: string;
    dryRun: boolean;
    stats: {
        filesAdded: number;
        filesUpdated: number;
        filesMarkedDeleted: number;
        errors: number;
        duration: number;
    };
    errors?: string[];
}
/**
 * ForceResync - MCP tool to force full resync
 *
 * fr fr resyncing EVERYTHING from scratch
 */
export declare class ForceResync {
    /**
     * execute - forces full resync
     */
    static execute(params: ForceResyncParams, watcherManager: WatcherManager): Promise<ForceResyncResult>;
    /**
     * schema - MCP tool schema
     */
    static schema: {
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
    };
}
//# sourceMappingURL=forceResync.d.ts.map