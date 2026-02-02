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
/**
 * Result of a reload broadcast operation
 */
export interface ReloadBroadcastResult {
    /** Number of instances successfully signaled */
    signaled: number;
    /** Number of instances that failed to signal (may be dead) */
    failed: number;
    /** Number of instances skipped (e.g., self) */
    skipped: number;
    /** Total instances in registry */
    total: number;
    /** PIDs that were signaled */
    signaledPids: number[];
    /** PIDs that failed */
    failedPids: number[];
    /** Any errors encountered */
    errors: string[];
    /** Timestamp of broadcast */
    timestamp: number;
    /** Reason for reload */
    reason: string;
}
/**
 * Options for broadcast operation
 */
export interface ReloadBroadcastOptions {
    /** Signal to send (default: SIGUSR1) */
    signal?: NodeJS.Signals;
    /** Include self in broadcast (default: false) */
    includeSelf?: boolean;
    /** Emit coordination events (default: true) */
    emitEvents?: boolean;
    /** Only broadcast to specific project hashes */
    projectHashes?: string[];
    /**
     * SAFETY: Only broadcast to instances of the same project (default: true)
     * Set to false to broadcast to ALL projects (use with caution!)
     */
    sameProjectOnly?: boolean;
}
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
export declare function broadcastReload(reason: string, options?: ReloadBroadcastOptions): Promise<ReloadBroadcastResult>;
/**
 * Broadcast reload to a specific instance by PID.
 *
 * @param pid - Process ID to signal
 * @param reason - Reason for reload
 * @param signal - Signal to send (default: SIGUSR1)
 * @returns True if signal was sent successfully
 */
export declare function signalInstance(pid: number, reason: string, signal?: NodeJS.Signals): boolean;
/**
 * Get the count of running SpecMem instances (excluding self).
 * Useful for checking if broadcast is needed.
 *
 * @returns Number of other running instances
 */
export declare function getOtherInstanceCount(): number;
/**
 * Check if there are other running instances to broadcast to.
 *
 * @returns True if there are other instances running
 */
export declare function hasOtherInstances(): boolean;
/**
 * Notify that a reload has completed on this instance.
 * Called by the hot reload manager after successful reload.
 *
 * @param duration - How long the reload took in ms
 * @param tier - Which tier of reload was performed
 */
export declare function notifyReloadComplete(duration: number, tier: number): Promise<void>;
/**
 * Interface for CLI commands (used by specmem-ctl reload).
 * Returns formatted output suitable for terminal display.
 */
export interface CLIReloadResult {
    success: boolean;
    message: string;
    details: ReloadBroadcastResult;
}
/**
 * Execute a reload broadcast from CLI context.
 * Provides formatted output for terminal.
 *
 * @param reason - Reason for reload
 * @returns Formatted result for CLI display
 */
export declare function executeCLIReload(reason?: string): Promise<CLIReloadResult>;
//# sourceMappingURL=reloadBroadcast.d.ts.map