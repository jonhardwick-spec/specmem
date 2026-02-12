/**
 * Embedding Server Control MCP Tools
 *
 * Phase 4 implementation: User-controllable embedding server lifecycle
 *
 * Tools:
 * - embedding_start: Start/restart embedding server (clears stopped flag)
 * - embedding_stop: Stop embedding server (sets stopped flag to prevent auto-restart)
 * - embedding_status: Get detailed server status including restart loop detection
 *
 * @author hardwicksoftwareservices
 */
import { getEmbeddingServerManager } from '../embeddingServerManager.js';
import { logger } from '../../utils/logger.js';
import { execSync } from 'child_process';
// Module-level reference to embedding provider for socket reset
let embeddingProviderRef = null;
/**
 * Set the embedding provider reference for socket reset
 * Called from toolRegistry during initialization
 */
export function setEmbeddingProviderRef(provider) {
    embeddingProviderRef = provider;
}
// ============================================================================
// EMBEDDING START TOOL
// ============================================================================
/**
 * Start or restart the embedding server
 * Clears the stopped-by-user flag and does a hard restart
 */
export class EmbeddingStart {
    name = 'embedding_start';
    description = 'Start or restart the embedding server. Clears any stopped flag and does a fresh start. Use this after embedding_stop or when server is not responding.';
    inputSchema = {
        type: 'object',
        properties: {
            force: {
                type: 'boolean',
                description: 'Force restart even if server appears healthy (default: false)',
                default: false
            }
        },
        required: []
    };
    async execute(params) {
        const { force = false } = params;
        logger.info({ force }, '[EmbeddingStart] User requested start');
        try {
            const manager = getEmbeddingServerManager();
            const currentStatus = manager.getStatus();
            // If already running and healthy, skip unless force
            if (currentStatus.running && currentStatus.healthy && !force) {
                return {
                    success: true,
                    message: 'Embedding server already running and healthy',
                    status: manager.getExtendedStatus()
                };
            }
            // ═══════════════════════════════════════════════════════════════
            // HARD KILL: Force kill ALL frankenstein processes before restart
            // This ensures force start actually works even when manager lost
            // track of the process (e.g., after MCP reconnect)
            // ═══════════════════════════════════════════════════════════════
            try {
                const pids = execSync('pgrep -f "frankenstein-embeddings.py" 2>/dev/null || true', { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
                if (pids.length > 0) {
                    logger.info({ pids, count: pids.length }, '[EmbeddingStart] Hard killing all frankenstein processes');
                    for (const pidStr of pids) {
                        const pid = parseInt(pidStr, 10);
                        if (pid && pid !== process.pid) {
                            try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
                        }
                    }
                    // Wait for them to die
                    const killWaitMs = parseInt(process.env['SPECMEM_ORPHAN_KILL_WAIT_MS'] || '2000', 10);
                    await new Promise(r => setTimeout(r, killWaitMs));
                    // Force kill survivors
                    for (const pidStr of pids) {
                        const pid = parseInt(pidStr, 10);
                        if (pid && pid !== process.pid) {
                            try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
                        }
                    }
                    logger.info('[EmbeddingStart] All old frankenstein processes killed');
                }
            } catch (killErr) {
                logger.debug({ error: killErr }, '[EmbeddingStart] Hard kill failed (non-fatal)');
            }
            const result = await manager.userStart();
            // CRITICAL: Reset the MCP's socket connection to pick up new server
            if (result.success && embeddingProviderRef?.resetSocket) {
                logger.info('[EmbeddingStart] Resetting MCP socket connection...');
                embeddingProviderRef.resetSocket();
            }
            return {
                ...result,
                status: manager.getExtendedStatus()
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error({ error: errorMsg }, '[EmbeddingStart] Failed');
            return {
                success: false,
                message: 'Failed to start embedding server: ' + errorMsg
            };
        }
    }
}
// ============================================================================
// EMBEDDING STOP TOOL
// ============================================================================
/**
 * Stop the embedding server and prevent auto-restart
 * Sets the stopped-by-user flag so health monitoring won't restart it
 */
export class EmbeddingStop {
    name = 'embedding_stop';
    description = 'Stop the embedding server and prevent auto-restart. Sets a stopped flag so health monitoring will not restart it. Use embedding_start to restart.';
    inputSchema = {
        type: 'object',
        properties: {},
        required: []
    };
    async execute() {
        logger.info('[EmbeddingStop] User requested stop');
        try {
            const manager = getEmbeddingServerManager();
            const result = await manager.userStop();
            return {
                ...result,
                status: manager.getExtendedStatus()
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error({ error: errorMsg }, '[EmbeddingStop] Failed');
            return {
                success: false,
                message: 'Failed to stop embedding server: ' + errorMsg
            };
        }
    }
}
// ============================================================================
// EMBEDDING STATUS TOOL
// ============================================================================
/**
 * Get detailed embedding server status
 * Includes running state, health, restart loop detection, and user stop flag
 */
export class EmbeddingStatus {
    name = 'embedding_status';
    description = 'Get detailed embedding server status including health, restart loop detection, and whether user manually stopped it.';
    inputSchema = {
        type: 'object',
        properties: {
            healthCheck: {
                type: 'boolean',
                description: 'Perform a live health check (default: true)',
                default: true
            }
        },
        required: []
    };
    async execute(params) {
        const { healthCheck = true } = params;
        try {
            const manager = getEmbeddingServerManager();
            const extStatus = manager.getExtendedStatus();
            // Format uptime nicely
            let uptimeStr = null;
            if (extStatus.uptime !== null) {
                const seconds = Math.floor(extStatus.uptime / 1000);
                const minutes = Math.floor(seconds / 60);
                const hours = Math.floor(minutes / 60);
                if (hours > 0) {
                    uptimeStr = hours + 'h ' + (minutes % 60) + 'm';
                }
                else if (minutes > 0) {
                    uptimeStr = minutes + 'm ' + (seconds % 60) + 's';
                }
                else {
                    uptimeStr = seconds + 's';
                }
            }
            const result = {
                success: true,
                status: {
                    running: extStatus.running,
                    healthy: extStatus.healthy,
                    stoppedByUser: extStatus.stoppedByUser,
                    pid: extStatus.pid,
                    uptime: uptimeStr,
                    restartCount: extStatus.restartCount,
                    consecutiveFailures: extStatus.consecutiveFailures,
                    restartLoop: {
                        inLoop: extStatus.restartLoop.inLoop,
                        recentRestarts: extStatus.restartLoop.recentRestarts,
                        windowSeconds: extStatus.restartLoop.windowSeconds
                    },
                    socketPath: extStatus.socketPath,
                    socketExists: extStatus.socketExists
                }
            };
            // Perform live health check if requested
            if (healthCheck) {
                const healthResult = await manager.healthCheck();
                result.status.healthCheckResult = {
                    success: healthResult.success,
                    responseTimeMs: healthResult.responseTimeMs,
                    error: healthResult.error
                };
            }
            return result;
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error({ error: errorMsg }, '[EmbeddingStatus] Failed');
            return {
                success: false,
                status: {
                    running: false,
                    healthy: false,
                    stoppedByUser: false,
                    pid: null,
                    uptime: null,
                    restartCount: 0,
                    consecutiveFailures: 0,
                    restartLoop: { inLoop: false, recentRestarts: 0, windowSeconds: 60 },
                    socketPath: 'unknown',
                    socketExists: false
                }
            };
        }
    }
}
// ============================================================================
// TOOL FACTORY
// ============================================================================
/**
 * Create all embedding control tools
 * Call this from toolRegistry.ts to register the tools
 */
export function createEmbeddingControlTools() {
    return [
        new EmbeddingStart(),
        new EmbeddingStop(),
        new EmbeddingStatus()
    ];
}
//# sourceMappingURL=embeddingControl.js.map