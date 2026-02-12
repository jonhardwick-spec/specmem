/**
 * forceResync.ts - Force Full Resync MCP Tool
 *
 * yooo forcing a full resync of everything
 */
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
export const ForceResyncInput = z.object({
    dryRun: z.boolean().default(false).describe('Preview what would be resynced without actually doing it')
});
/**
 * ForceResync - MCP tool to force full resync
 *
 * fr fr resyncing EVERYTHING from scratch
 */
export class ForceResync {
    /**
     * execute - forces full resync
     */
    static async execute(params, watcherManager) {
        try {
            logger.info({ params }, 'starting force resync via MCP tool');
            if (params.dryRun) {
                // dry run - just check what would be resynced
                const driftReport = await watcherManager.checkSync();
                return {
                    success: true,
                    message: 'Dry run complete. No changes were made.',
                    dryRun: true,
                    stats: {
                        filesAdded: driftReport.missingFromMcp.length,
                        filesUpdated: driftReport.contentMismatch.length,
                        filesMarkedDeleted: driftReport.missingFromDisk.length,
                        errors: 0,
                        duration: 0
                    }
                };
            }
            // actual resync
            const result = await watcherManager.resync();
            const message = result.success
                ? `Resync complete! Added ${result.filesAdded}, updated ${result.filesUpdated}, deleted ${result.filesMarkedDeleted} files in ${result.duration}ms.`
                : `Resync completed with ${result.errors.length} errors. Added ${result.filesAdded}, updated ${result.filesUpdated}, deleted ${result.filesMarkedDeleted} files.`;
            // Update statusbar sync score after resync
            try {
                const postReport = await watcherManager.checkSync();
                if (postReport && typeof postReport.syncScore === 'number') {
                    await watcherManager.writeSyncScore(postReport.syncScore);
                }
            } catch (e) {
                logger.warn({ error: e }, 'failed to update sync score after resync');
            }
            logger.info({
                success: result.success,
                filesAdded: result.filesAdded,
                filesUpdated: result.filesUpdated,
                filesMarkedDeleted: result.filesMarkedDeleted,
                duration: result.duration
            }, 'force resync complete');
            return {
                success: result.success,
                message,
                dryRun: false,
                stats: {
                    filesAdded: result.filesAdded,
                    filesUpdated: result.filesUpdated,
                    filesMarkedDeleted: result.filesMarkedDeleted,
                    errors: result.errors.length,
                    duration: result.duration
                },
                errors: result.errors.length > 0 ? result.errors : undefined
            };
        }
        catch (error) {
            logger.error({ error, params }, 'failed to force resync');
            return {
                success: false,
                message: `Failed to resync: ${error.message}`,
                dryRun: params.dryRun,
                stats: {
                    filesAdded: 0,
                    filesUpdated: 0,
                    filesMarkedDeleted: 0,
                    errors: 1,
                    duration: 0
                },
                errors: [error.message]
            };
        }
    }
    /**
     * schema - MCP tool schema
     */
    static schema = {
        name: 'force_resync',
        description: 'Force a full resync of the entire codebase. Scans all files and updates MCP memories to match the current filesystem state. Use this after major changes like git checkout or mass file operations. Can do a dry run to preview changes first.',
        inputSchema: {
            type: 'object',
            properties: {
                dryRun: {
                    type: 'boolean',
                    description: 'Preview what would be resynced without actually doing it (default: false)',
                    default: false
                }
            }
        }
    };
}
//# sourceMappingURL=forceResync.js.map