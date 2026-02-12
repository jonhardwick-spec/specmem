/**
 * reloadBroadcast.ts - Hot Reload Broadcast for Multi-Instance SpecMem
 *
 * Provides functionality to broadcast reload signals to ALL running SpecMem
 * instances when code changes occur. Uses SIGUSR1 for graceful restart.
 *
 * Architecture:
 * - Reads instance registry from instanceManager
 * - Sends SIGUSR1 to each running instance (except self)
 * - Emits coordination events for reload tracking
 * - Handles failed signals gracefully (dead instances)
 *
 * @author hardwicksoftwareservices
 * @task HR-7 - Hot Reload broadcast implementation
 */
import { listInstances, isProcessRunning } from '../utils/instanceManager.js';
import { logger } from '../utils/logger.js';
import { getLazyCoordinationServer, isCoordinationServerRunning } from '../coordination/server.js';
import { RELOAD_EVENTS } from '../coordination/events.js';
import { getProjectDirName } from '../config.js';
// ============================================================================
// Main Functions
// ============================================================================
/**
 * Broadcast reload signal to all running SpecMem instances.
 *
 * This is the main entry point for hot reload. When called:
 * 1. Gets all running instances from the registry
 * 2. Sends SIGUSR1 to each instance (triggers graceful restart)
 * 3. Emits coordination events for tracking
 * 4. Returns detailed results
 *
 * @param reason - Human-readable reason for the reload (e.g., "Code changes detected")
 * @param options - Optional configuration
 * @returns Results of the broadcast operation
 *
 * @example
 * // Broadcast reload due to code changes
 * const result = await broadcastReload('TypeScript compilation completed');
 * console.log(`Signaled ${result.signaled} instances`);
 *
 * @example
 * // Broadcast with custom signal
 * const result = await broadcastReload('Manual refresh', { signal: 'SIGUSR2' });
 */
export async function broadcastReload(reason, options = {}) {
    const { signal = 'SIGUSR1', includeSelf = false, emitEvents = true, projectHashes, sameProjectOnly = true, // SAFETY: Default to same project only
     } = options;
    // Get current project identifier for filtering
    const currentProjectDirName = getProjectDirName();
    const timestamp = Date.now();
    const result = {
        signaled: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        signaledPids: [],
        failedPids: [],
        errors: [],
        timestamp,
        reason,
    };
    logger.info({ reason, signal, includeSelf }, '[HotReload] Broadcasting reload to all instances');
    // Emit reload requested event if coordination server is available
    if (emitEvents) {
        await emitReloadEvent(RELOAD_EVENTS.RELOAD_REQUESTED, {
            reason,
            timestamp,
            signal,
        });
    }
    // Get all running instances
    let instances;
    try {
        instances = listInstances({ includeDockerStatus: false });
        result.total = instances.length;
    }
    catch (error) {
        const errorMsg = `Failed to list instances: ${error instanceof Error ? error.message : String(error)}`;
        logger.error({ error }, '[HotReload] ' + errorMsg);
        result.errors.push(errorMsg);
        return result;
    }
    if (instances.length === 0) {
        logger.info('[HotReload] No instances found in registry');
        return result;
    }
    logger.info({ instanceCount: instances.length }, '[HotReload] Found instances in registry');
    // SAFETY: Filter to same project only by default
    if (sameProjectOnly && !projectHashes) {
        instances = instances.filter(inst => inst.projectHash === currentProjectDirName);
        logger.debug({ filtered: instances.length, currentProject: currentProjectDirName }, '[HotReload] Filtered to same project (SAFETY: sameProjectOnly=true)');
    }
    // Filter instances if project hashes specified
    if (projectHashes && projectHashes.length > 0) {
        instances = instances.filter(inst => projectHashes.includes(inst.projectHash));
        logger.debug({ filtered: instances.length, projectHashes }, '[HotReload] Filtered to specific projects');
    }
    // Signal each instance
    for (const instance of instances) {
        const { pid, projectPath, projectHash } = instance;
        // Skip self unless explicitly included
        if (!includeSelf && pid === process.pid) {
            logger.debug({ pid, projectPath }, '[HotReload] Skipping self');
            result.skipped++;
            continue;
        }
        // Check if process is still running
        if (!isProcessRunning(pid)) {
            logger.debug({ pid, projectPath }, '[HotReload] Instance process not running, skipping');
            result.skipped++;
            continue;
        }
        // Send signal
        try {
            process.kill(pid, signal);
            result.signaled++;
            result.signaledPids.push(pid);
            logger.info({ pid, projectPath, projectHash, signal }, '[HotReload] Sent signal to instance');
        }
        catch (error) {
            result.failed++;
            result.failedPids.push(pid);
            const errorMsg = `Failed to signal PID ${pid}: ${error instanceof Error ? error.message : String(error)}`;
            result.errors.push(errorMsg);
            logger.warn({ pid, projectPath, error }, '[HotReload] Failed to signal instance (may be dead)');
        }
    }
    // Emit draining event
    if (emitEvents && result.signaled > 0) {
        await emitReloadEvent(RELOAD_EVENTS.RELOAD_DRAINING, {
            instancesSignaled: result.signaled,
            timestamp: Date.now(),
        });
    }
    logger.info({
        signaled: result.signaled,
        failed: result.failed,
        skipped: result.skipped,
        total: result.total,
        reason,
    }, '[HotReload] Broadcast complete');
    return result;
}
/**
 * Broadcast reload to a specific instance by PID.
 *
 * @param pid - Process ID to signal
 * @param reason - Reason for reload
 * @param signal - Signal to send (default: SIGUSR1)
 * @returns True if signal was sent successfully
 */
export function signalInstance(pid, reason, signal = 'SIGUSR1') {
    logger.info({ pid, reason, signal }, '[HotReload] Signaling specific instance');
    if (!isProcessRunning(pid)) {
        logger.warn({ pid }, '[HotReload] Target process not running');
        return false;
    }
    try {
        process.kill(pid, signal);
        logger.info({ pid, signal }, '[HotReload] Signal sent to instance');
        return true;
    }
    catch (error) {
        logger.error({ pid, error }, '[HotReload] Failed to signal instance');
        return false;
    }
}
/**
 * Get the count of running SpecMem instances (excluding self).
 * Useful for checking if broadcast is needed.
 *
 * @returns Number of other running instances
 */
export function getOtherInstanceCount() {
    try {
        const instances = listInstances({ includeDockerStatus: false });
        return instances.filter(inst => inst.pid !== process.pid && isProcessRunning(inst.pid)).length;
    }
    catch (error) {
        logger.warn({ error }, '[HotReload] Failed to count other instances');
        return 0;
    }
}
/**
 * Check if there are other running instances to broadcast to.
 *
 * @returns True if there are other instances running
 */
export function hasOtherInstances() {
    return getOtherInstanceCount() > 0;
}
// ============================================================================
// Coordination Event Helpers
// ============================================================================
/**
 * Emit a reload event via the coordination server (if available).
 * This allows tracking reload progress across the cluster.
 *
 * @param eventType - Type of reload event
 * @param data - Event data
 */
async function emitReloadEvent(eventType, data) {
    try {
        // Only emit if coordination server is running (don't start it just for this)
        if (!isCoordinationServerRunning()) {
            logger.debug({ eventType }, '[HotReload] Coordination server not running, skipping event emission');
            return;
        }
        const server = await getLazyCoordinationServer();
        if (!server) {
            return;
        }
        const dispatcher = server.getDispatcher();
        dispatcher.dispatchAsync({
            type: eventType,
            timestamp: Date.now(),
            teamMemberId: 'hot-reload-manager',
            ...data,
        });
        logger.debug({ eventType, data }, '[HotReload] Emitted coordination event');
    }
    catch (error) {
        // Don't fail reload broadcast due to event emission issues
        logger.warn({ eventType, error }, '[HotReload] Failed to emit coordination event');
    }
}
/**
 * Notify that a reload has completed on this instance.
 * Called by the hot reload manager after successful reload.
 *
 * @param duration - How long the reload took in ms
 * @param tier - Which tier of reload was performed
 */
export async function notifyReloadComplete(duration, tier) {
    await emitReloadEvent(RELOAD_EVENTS.RELOAD_COMPLETE, {
        pid: process.pid,
        duration,
        tier,
        timestamp: Date.now(),
    });
    logger.info({ duration, tier }, '[HotReload] Reload complete notification sent');
}
/**
 * Execute a reload broadcast from CLI context.
 * Provides formatted output for terminal.
 *
 * @param reason - Reason for reload
 * @returns Formatted result for CLI display
 */
export async function executeCLIReload(reason = 'Manual reload via CLI') {
    const result = await broadcastReload(reason);
    let message;
    if (result.signaled === 0 && result.total === 0) {
        message = 'No SpecMem instances found to reload.';
    }
    else if (result.signaled === 0) {
        message = `No instances were signaled. ${result.skipped} skipped, ${result.failed} failed.`;
    }
    else {
        message = `Reload signal sent to ${result.signaled}/${result.total} instances.`;
        if (result.failed > 0) {
            message += ` (${result.failed} failed)`;
        }
        if (result.skipped > 0) {
            message += ` (${result.skipped} skipped)`;
        }
    }
    return {
        success: result.signaled > 0 || result.total === 0,
        message,
        details: result,
    };
}
//# sourceMappingURL=reloadBroadcast.js.map