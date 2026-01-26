/**
 * checkSyncStatus.ts - Check Sync Status MCP Tool
 *
 * yooo checking if MCP is in sync with filesystem
 */
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { formatHumanReadableStatus } from '../../utils/humanReadableOutput.js';
export const CheckSyncStatusInput = z.object({
    detailed: z.boolean().default(false).describe('Include detailed drift information')
});
/**
 * CheckSyncStatus - MCP tool to check sync status
 *
 * fr fr verifying everything is synced up
 */
export class CheckSyncStatus {
    /**
     * execute - checks sync status
     */
    static async execute(params, watcherManager) {
        try {
            logger.info({ params }, 'checking sync status via MCP tool');
            // get watcher status
            const watcherStatus = watcherManager.getStatus();
            // run sync check
            const driftReport = await watcherManager.checkSync();
            // build summary message
            let summary;
            if (driftReport.inSync) {
                summary = `Everything is in sync! ${driftReport.upToDate} files are up to date.`;
            }
            else {
                const issues = [];
                if (driftReport.missingFromMcp.length > 0) {
                    issues.push(`${driftReport.missingFromMcp.length} files not in MCP`);
                }
                if (driftReport.missingFromDisk.length > 0) {
                    issues.push(`${driftReport.missingFromDisk.length} files deleted from disk`);
                }
                if (driftReport.contentMismatch.length > 0) {
                    issues.push(`${driftReport.contentMismatch.length} files modified`);
                }
                summary = `Drift detected: ${issues.join(', ')}. Sync score: ${(driftReport.syncScore * 100).toFixed(1)}%`;
            }
            const result = {
                inSync: driftReport.inSync,
                syncScore: driftReport.syncScore,
                driftPercentage: driftReport.driftPercentage,
                summary,
                stats: {
                    totalFiles: driftReport.totalFiles,
                    totalMemories: driftReport.totalMemories,
                    upToDate: driftReport.upToDate,
                    missingFromMcp: driftReport.missingFromMcp.length,
                    missingFromDisk: driftReport.missingFromDisk.length,
                    contentMismatch: driftReport.contentMismatch.length
                },
                watcherStatus: {
                    isRunning: watcherStatus.isRunning,
                    eventsProcessed: watcherStatus.watcher.eventsProcessed,
                    queueSize: watcherStatus.queue.currentQueueSize
                }
            };
            // add details if requested
            if (params.detailed) {
                result.details = {
                    missingFromMcp: driftReport.missingFromMcp,
                    missingFromDisk: driftReport.missingFromDisk,
                    contentMismatch: driftReport.contentMismatch
                };
            }
            logger.info({ inSync: driftReport.inSync, syncScore: driftReport.syncScore }, 'sync check complete');
            // Build human readable response
            const drifted = driftReport.missingFromMcp.length + driftReport.missingFromDisk.length + driftReport.contentMismatch.length;
            const message = `Sync Score: ${Math.round(driftReport.syncScore * 100)}%
${summary}

Stats:
  Up to date: ${driftReport.upToDate}
  Drifted: ${drifted}
  Missing: ${driftReport.missingFromMcp.length}
  Deleted: ${driftReport.missingFromDisk.length}
  Modified: ${driftReport.contentMismatch.length}
  Watcher: ${watcherStatus.isRunning ? 'Running' : 'Stopped'}
  Events: ${watcherStatus.watcher.eventsProcessed}`;
            return formatHumanReadableStatus('check_sync', message);
        }
        catch (error) {
            logger.error({ error, params }, 'failed to check sync status');
            throw error;
        }
    }
    /**
     * schema - MCP tool schema
     */
    static schema = {
        name: 'check_sync',
        description: 'Check if MCP memories are in sync with the filesystem. Detects missing files, deleted files, and content mismatches. Returns a sync score and detailed drift information.',
        inputSchema: {
            type: 'object',
            properties: {
                detailed: {
                    type: 'boolean',
                    description: 'Include detailed list of drifted files (default: false)',
                    default: false
                }
            }
        }
    };
}
//# sourceMappingURL=checkSyncStatus.js.map