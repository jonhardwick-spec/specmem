/**
 * Hot Reload Manager
 *
 * Core orchestrator for SpecMem's hot reload system.
 * Tracks active tool calls, handles draining, and coordinates reload.
 *
 * Usage:
 *   - HR-5/HR-6 will call startToolCall() and endToolCall() during tool execution
 *   - HR-2/HR-8 will call triggerReload() via SIGUSR1 signal or CLI
 *   - Draining waits for active calls to complete before shutdown
 */
interface ActiveToolCall {
    id: string;
    name: string;
    startedAt: number;
}
export declare class HotReloadManager {
    private static instance;
    private activeCalls;
    private isDraining;
    private drainTimeout;
    private reloadListeners;
    static getInstance(): HotReloadManager;
    /**
     * Track when a tool call starts
     * Called by MCP server before tool execution
     */
    startToolCall(id: string, name: string): void;
    /**
     * Track when a tool call completes
     * Called by MCP server after tool execution (success or failure)
     */
    endToolCall(id: string): void;
    /**
     * Get count of active calls
     */
    getActiveCallCount(): number;
    /**
     * Get details of active calls (for dashboard/debugging)
     */
    getActiveCallDetails(): ActiveToolCall[];
    /**
     * Check if we're currently draining
     */
    isDrainingCalls(): boolean;
    /**
     * Register a listener to be called before reload
     * Useful for cleanup tasks (closing connections, saving state, etc.)
     */
    onBeforeReload(listener: () => void | Promise<void>): void;
    /**
     * Start draining - wait for active calls to complete
     * Returns when all calls are done or timeout is reached
     */
    drain(): Promise<void>;
    /**
     * Execute pre-reload listeners
     */
    private runReloadListeners;
    /**
     * Sync stale project configs in ~/.claude.json
     * Fixes credentials for all projects before restart
     */
    private syncProjectConfigs;
    /**
     * Restart Docker containers related to SpecMem
     * This ensures fresh instances with updated configs
     */
    private restartDockerContainers;
    /**
     * Trigger reload (called on SIGUSR1 or by CLI)
     * Drains active calls, syncs configs, restarts Docker, and exits for respawn
     */
    triggerReload(): Promise<void>;
    /**
     * Trigger a quick reload without Docker restart
     * Use for code-only changes
     */
    triggerQuickReload(): Promise<void>;
    /**
     * Get status for dashboard/monitoring
     */
    getStatus(): {
        isDraining: boolean;
        activeCallCount: number;
        activeCalls: ActiveToolCall[];
        drainTimeoutMs: number;
    };
    /**
     * Reset the manager (useful for testing)
     */
    reset(): void;
}
export declare const hotReloadManager: HotReloadManager;
/**
 * Get the singleton HotReloadManager instance
 * Preferred way to access the manager for consistency
 */
export declare function getHotReloadManager(): HotReloadManager;
export {};
//# sourceMappingURL=hotReloadManager.d.ts.map