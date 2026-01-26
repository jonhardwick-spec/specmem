/**
 * getSessionWatcherStatus.ts - Get  Session Watcher Status
 *
 * yo fr fr check if the session watcher is running
 * shows stats on how many sessions have been extracted
 *
 * Use this to check if auto-extraction is working
 */
import { z } from 'zod';
import { MCPTool } from '../../mcp/toolRegistry.js';
import { SessionWatcher } from '../../claude-sessions/sessionWatcher.js';
declare const GetSessionWatcherStatusInputSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
type GetSessionWatcherStatusInput = z.infer<typeof GetSessionWatcherStatusInputSchema>;
/**
 * GetSessionWatcherStatus - gets status of the  session watcher
 *
 * nah bruh check if your sessions are being auto-extracted
 */
export declare class GetSessionWatcherStatus implements MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {};
    };
    private sessionWatcher;
    setSessionWatcher(watcher: SessionWatcher): void;
    execute(args: GetSessionWatcherStatusInput): Promise<{
        enabled: boolean;
        isWatching: boolean;
        envEnabled: boolean;
        stats?: {
            totalProcessed: number;
            lastProcessedTime: string | null;
            errors: number;
            historyPath: string;
            lastCheckTimestamp: string;
        };
        message: string;
    }>;
}
export {};
//# sourceMappingURL=getSessionWatcherStatus.d.ts.map