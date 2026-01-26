/**
 * getSessionWatcherStatus.ts - Get  Session Watcher Status
 *
 * yo fr fr check if the session watcher is running
 * shows stats on how many sessions have been extracted
 *
 * Use this to check if auto-extraction is working
 */
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { getSessionWatcher } from '../../claude-sessions/sessionIntegration.js';
const GetSessionWatcherStatusInputSchema = z.object({});
/**
 * Check if session watcher is enabled via env var - SOURCE OF TRUTH
 */
function isSessionWatcherEnabled() {
    const envVal = process.env['SPECMEM_SESSION_WATCHER_ENABLED'];
    // Default to true if not set, check for explicit 'false'
    return envVal !== 'false' && envVal !== '0';
}
/**
 * GetSessionWatcherStatus - gets status of the  session watcher
 *
 * nah bruh check if your sessions are being auto-extracted
 */
export class GetSessionWatcherStatus {
    name = 'get-session-watcher-status';
    description = 'Get the status of the  Code session watcher. Shows if auto-extraction is enabled, how many sessions have been processed, and when the last extraction occurred.';
    inputSchema = {
        type: 'object',
        properties: {}
    };
    sessionWatcher = null;
    setSessionWatcher(watcher) {
        this.sessionWatcher = watcher;
    }
    async execute(args) {
        logger.info('getting session watcher status');
        // Check env var directly - this is the source of truth
        const envEnabled = isSessionWatcherEnabled();
        try {
            // Try to get watcher from: 1) this instance, 2) global state
            const watcher = this.sessionWatcher || getSessionWatcher();
            if (!watcher) {
                // Watcher not running but check WHY
                if (!envEnabled) {
                    return {
                        enabled: false,
                        isWatching: false,
                        envEnabled: false,
                        message: ' session watcher is disabled. Set SPECMEM_SESSION_WATCHER_ENABLED=true to enable.'
                    };
                }
                else {
                    // Env says enabled but watcher not running - this is a BUG
                    return {
                        enabled: false,
                        isWatching: false,
                        envEnabled: true,
                        message: 'BUG: SPECMEM_SESSION_WATCHER_ENABLED=true but watcher not initialized! Check MCP startup logs.'
                    };
                }
            }
            const stats = watcher.getStats();
            return {
                enabled: true,
                isWatching: stats.isWatching,
                envEnabled: true,
                stats: {
                    totalProcessed: stats.totalProcessed,
                    lastProcessedTime: stats.lastProcessedTime?.toISOString() ?? null,
                    errors: stats.errors,
                    historyPath: stats.historyPath,
                    lastCheckTimestamp: new Date(stats.lastCheckTimestamp).toISOString()
                },
                message: stats.isWatching
                    ? `Session watcher is active. ${stats.totalProcessed} sessions processed.`
                    : 'Session watcher is enabled but not currently watching.'
            };
        }
        catch (error) {
            logger.error({ error }, 'failed to get session watcher status');
            return {
                enabled: false,
                isWatching: false,
                envEnabled,
                message: `Failed to get status: ${error.message}`
            };
        }
    }
}
//# sourceMappingURL=getSessionWatcherStatus.js.map