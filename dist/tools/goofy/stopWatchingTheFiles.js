/**
 * stopWatchingTheFiles.ts - Stop File Watcher MCP Tool
 *
 * yooo stopping the file watcher
 */
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
export const StopWatchingTheFilesInput = z.object({
    flushPending: z.boolean().default(true).describe('Process all pending changes before stopping')
});
/**
 * StopWatchingTheFiles - MCP tool to stop file watcher
 */
export class StopWatchingTheFiles {
    /**
     * execute - stops the file watcher
     */
    static async execute(params, watcherManager) {
        try {
            logger.info({ params }, 'stopping file watcher via MCP tool');
            // check if running
            const status = watcherManager.getStatus();
            if (!status.isRunning) {
                return {
                    success: false,
                    message: 'File watcher is not running',
                    stats: {
                        eventsProcessed: 0,
                        pendingFlushed: 0
                    }
                };
            }
            const pendingCount = status.queue.currentQueueSize;
            // flush pending changes if requested
            if (params.flushPending && pendingCount > 0) {
                logger.info({ pendingCount }, 'flushing pending changes before stop');
                await watcherManager.flush();
            }
            // stop the watcher
            await watcherManager.stop();
            logger.info({ eventsProcessed: status.watcher.eventsProcessed }, 'file watcher stopped');
            return {
                success: true,
                message: `File watcher stopped. Processed ${status.watcher.eventsProcessed} events total.`,
                stats: {
                    eventsProcessed: status.watcher.eventsProcessed,
                    pendingFlushed: pendingCount
                }
            };
        }
        catch (error) {
            logger.error({ error, params }, 'failed to stop file watcher');
            return {
                success: false,
                message: `Failed to stop file watcher: ${error.message}`,
                stats: {
                    eventsProcessed: 0,
                    pendingFlushed: 0
                }
            };
        }
    }
    /**
     * schema - MCP tool schema
     */
    static schema = {
        name: 'stop_watching',
        description: 'Stop the file watcher. Optionally processes all pending changes before stopping. Use this when you want to pause auto-updates temporarily.',
        inputSchema: {
            type: 'object',
            properties: {
                flushPending: {
                    type: 'boolean',
                    description: 'Process all pending changes before stopping (default: true)',
                    default: true
                }
            }
        }
    };
}
//# sourceMappingURL=stopWatchingTheFiles.js.map