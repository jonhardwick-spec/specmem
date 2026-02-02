/**
 * hotReload.ts - Hot Reload Dashboard API
 *
 * Provides API endpoints for hot reload status monitoring and triggering
 * from the SpecMem web dashboard.
 *
 * Endpoints:
 *   GET  /api/reload/status  - Get current reload status and active calls
 *   POST /api/reload/trigger - Trigger a soft or graceful reload
 */
import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { hotReloadManager } from '../../mcp/hotReloadManager.js';
// ============================================================================
// Validation Schemas
// ============================================================================
const TriggerReloadSchema = z.object({
    mode: z.enum(['soft', 'graceful']).default('soft')
});
// ============================================================================
// State tracking
// ============================================================================
// Track last reload time
let lastReloadTime = null;
let reloadHistory = [];
// Update last reload time when reload is triggered
hotReloadManager.onBeforeReload(() => {
    lastReloadTime = Date.now();
});
// ============================================================================
// Router Factory
// ============================================================================
export function createHotReloadRouter(requireAuth) {
    const router = Router();
    /**
     * GET /api/reload/status
     * Get current hot reload status including:
     * - Whether a reload is in progress (draining)
     * - Number of active tool calls
     * - Details of active calls
     * - Last reload timestamp
     * - Server version info
     */
    router.get('/status', requireAuth, async (req, res) => {
        try {
            const status = hotReloadManager.getStatus();
            res.json({
                success: true,
                status: {
                    isReloading: status.isDraining,
                    activeToolCalls: status.activeCallCount,
                    activeCalls: status.activeCalls.map(call => ({
                        id: call.id,
                        name: call.name,
                        duration: Date.now() - call.startedAt,
                        startedAt: new Date(call.startedAt).toISOString()
                    })),
                    drainTimeoutMs: status.drainTimeoutMs,
                    lastReload: lastReloadTime ? new Date(lastReloadTime).toISOString() : null,
                    lastReloadMs: lastReloadTime,
                    codeVersion: process.env.npm_package_version || 'unknown',
                    nodeVersion: process.version,
                    uptime: process.uptime(),
                    pid: process.pid
                },
                reloadHistory: reloadHistory.slice(-10) // Last 10 reloads
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching reload status');
            res.status(500).json({
                success: false,
                error: 'Failed to get reload status'
            });
        }
    });
    /**
     * POST /api/reload/trigger
     * Trigger a reload of the SpecMem server
     *
     * Body:
     *   mode: 'soft' | 'graceful'
     *     - soft: Sends SIGHUP to reload tools only (faster, no restart)
     *     - graceful: Sends SIGUSR1 for full graceful restart (drains calls first)
     *
     * Note: Both modes respect active tool calls - graceful waits for them to complete
     */
    router.post('/trigger', requireAuth, async (req, res) => {
        try {
            // Validate request body
            const parseResult = TriggerReloadSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    details: parseResult.error.errors.map(e => ({
                        field: e.path.join('.'),
                        message: e.message
                    }))
                });
                return;
            }
            const { mode } = parseResult.data;
            const activeCount = hotReloadManager.getActiveCallCount();
            // Record in history
            reloadHistory.push({
                time: Date.now(),
                mode,
                triggeredBy: 'dashboard'
            });
            if (reloadHistory.length > 100) {
                reloadHistory = reloadHistory.slice(-100);
            }
            logger.info({
                mode,
                activeToolCalls: activeCount,
                triggeredBy: 'dashboard'
            }, '[HotReload] Reload triggered via dashboard API');
            if (mode === 'soft') {
                // Soft reload: SIGHUP - reload tools without full restart
                // This is handled by the signal handlers set up in HR-2
                process.kill(process.pid, 'SIGHUP');
                res.json({
                    success: true,
                    message: 'Soft reload triggered (tools only)',
                    mode: 'soft',
                    activeToolCalls: activeCount,
                    note: activeCount > 0
                        ? `${activeCount} tool call(s) in progress - will complete normally`
                        : 'No active tool calls'
                });
            }
            else {
                // Graceful restart: SIGUSR1 - drain active calls and restart
                // This triggers the hotReloadManager.triggerReload() flow
                process.kill(process.pid, 'SIGUSR1');
                res.json({
                    success: true,
                    message: 'Graceful restart triggered',
                    mode: 'graceful',
                    activeToolCalls: activeCount,
                    note: activeCount > 0
                        ? `Draining ${activeCount} active tool call(s) before restart`
                        : 'No active calls - restarting immediately'
                });
            }
        }
        catch (error) {
            logger.error({ error }, 'Error triggering reload');
            res.status(500).json({
                success: false,
                error: 'Failed to trigger reload'
            });
        }
    });
    /**
     * GET /api/reload/health
     * Quick health check for reload system
     * Returns minimal info for polling/monitoring
     */
    router.get('/health', async (req, res) => {
        try {
            const status = hotReloadManager.getStatus();
            res.json({
                healthy: !status.isDraining,
                activeCallCount: status.activeCallCount,
                uptime: process.uptime()
            });
        }
        catch (error) {
            res.status(500).json({ healthy: false, error: 'Status check failed' });
        }
    });
    /**
     * GET /api/reload/calls
     * Get detailed info about active tool calls
     * Useful for debugging stuck calls or monitoring long-running operations
     */
    router.get('/calls', requireAuth, async (req, res) => {
        try {
            const status = hotReloadManager.getStatus();
            res.json({
                success: true,
                count: status.activeCallCount,
                isDraining: status.isDraining,
                calls: status.activeCalls.map(call => ({
                    id: call.id,
                    name: call.name,
                    startedAt: new Date(call.startedAt).toISOString(),
                    durationMs: Date.now() - call.startedAt,
                    durationFormatted: formatDuration(Date.now() - call.startedAt)
                }))
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching active calls');
            res.status(500).json({
                success: false,
                error: 'Failed to get active calls'
            });
        }
    });
    return router;
}
/**
 * Format milliseconds duration to human-readable string
 */
function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    if (ms < 60000)
        return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000)
        return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}
export default createHotReloadRouter;
//# sourceMappingURL=hotReload.js.map