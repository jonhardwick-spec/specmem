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
import { logger } from '../utils/logger.js';
export class HotReloadManager {
    static instance;
    activeCalls = new Map();
    isDraining = false;
    drainTimeout = 30000; // 30 seconds max drain time
    reloadListeners = [];
    static getInstance() {
        if (!this.instance) {
            this.instance = new HotReloadManager();
        }
        return this.instance;
    }
    /**
     * Track when a tool call starts
     * Called by MCP server before tool execution
     */
    startToolCall(id, name) {
        this.activeCalls.set(id, { id, name, startedAt: Date.now() });
        logger.debug({ id, name, activeCount: this.activeCalls.size }, '[HotReload] Tool call started');
    }
    /**
     * Track when a tool call completes
     * Called by MCP server after tool execution (success or failure)
     */
    endToolCall(id) {
        this.activeCalls.delete(id);
        logger.debug({ id, activeCount: this.activeCalls.size }, '[HotReload] Tool call ended');
    }
    /**
     * Get count of active calls
     */
    getActiveCallCount() {
        return this.activeCalls.size;
    }
    /**
     * Get details of active calls (for dashboard/debugging)
     */
    getActiveCallDetails() {
        return Array.from(this.activeCalls.values());
    }
    /**
     * Check if we're currently draining
     */
    isDrainingCalls() {
        return this.isDraining;
    }
    /**
     * Register a listener to be called before reload
     * Useful for cleanup tasks (closing connections, saving state, etc.)
     */
    onBeforeReload(listener) {
        this.reloadListeners.push(listener);
    }
    /**
     * Start draining - wait for active calls to complete
     * Returns when all calls are done or timeout is reached
     */
    async drain() {
        this.isDraining = true;
        logger.info({ activeCount: this.activeCalls.size }, '[HotReload] Starting drain phase');
        const startTime = Date.now();
        while (this.activeCalls.size > 0 && (Date.now() - startTime) < this.drainTimeout) {
            await new Promise(resolve => setTimeout(resolve, 100));
            // Log progress every 5 seconds
            const elapsed = Date.now() - startTime;
            if (elapsed % 5000 < 100 && this.activeCalls.size > 0) {
                const remaining = this.getActiveCallDetails();
                logger.info({
                    remaining: remaining.length,
                    calls: remaining.map(c => c.name),
                    elapsedMs: elapsed
                }, '[HotReload] Drain in progress, waiting for calls to complete');
            }
        }
        if (this.activeCalls.size > 0) {
            const remaining = this.getActiveCallDetails();
            logger.warn({
                remaining: remaining.length,
                calls: remaining.map(c => ({ name: c.name, ageMs: Date.now() - c.startedAt }))
            }, '[HotReload] Drain timeout - forcing shutdown with active calls');
        }
        else {
            logger.info('[HotReload] Drain complete - all calls finished');
        }
    }
    /**
     * Execute pre-reload listeners
     */
    async runReloadListeners() {
        for (const listener of this.reloadListeners) {
            try {
                await listener();
            }
            catch (err) {
                logger.error({ err }, '[HotReload] Error in reload listener');
            }
        }
    }
    /**
     * Sync stale project configs in ~/.claude.json
     * Fixes credentials for all projects before restart
     */
    async syncProjectConfigs() {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const claudeJsonPath = path.join(os.homedir(), '.claude.json');
        if (!fs.existsSync(claudeJsonPath)) {
            logger.info('[HotReload] No ~/.claude.json found, skipping config sync');
            return;
        }
        try {
            const content = fs.readFileSync(claudeJsonPath, 'utf-8');
            const config = JSON.parse(content);
            if (!config.projects || typeof config.projects !== 'object') {
                return;
            }
            const canonicalCred = process.env.SPECMEM_PASSWORD || 'specmem_westayunprofessional';
            const staleValues = ['specmem', 'specmem_user', 'specmem_pass', ''];
            let anyFixed = false;
            const fixedProjects = [];
            for (const [projectPath, projectConfig] of Object.entries(config.projects)) {
                if (!projectConfig || typeof projectConfig !== 'object')
                    continue;
                const specmemEnv = projectConfig.mcpServers?.specmem?.env;
                if (!specmemEnv)
                    continue;
                let projectFixed = false;
                for (const key of ['SPECMEM_DB_NAME', 'SPECMEM_DB_USER', 'SPECMEM_DB_PASSWORD', 'SPECMEM_DASHBOARD_PASSWORD']) {
                    if (specmemEnv[key] && staleValues.includes(specmemEnv[key])) {
                        specmemEnv[key] = canonicalCred;
                        projectFixed = true;
                    }
                }
                if (projectFixed) {
                    fixedProjects.push(projectPath);
                    anyFixed = true;
                }
            }
            if (anyFixed) {
                fs.writeFileSync(claudeJsonPath, JSON.stringify(config, null, 2));
                logger.info({ fixedProjects }, '[HotReload] Fixed stale project configs');
            }
        }
        catch (err) {
            logger.error({ err }, '[HotReload] Error syncing project configs');
        }
    }
    /**
     * Restart Docker containers related to SpecMem
     * This ensures fresh instances with updated configs
     */
    async restartDockerContainers() {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const containersToRestart = [
            'specmem-server-default',
            'frankenstein-embeddings',
            'embedding-sandbox-embedding-sandbox-1'
        ];
        for (const container of containersToRestart) {
            try {
                // Check if container exists and is running
                const { stdout: psOutput } = await execAsync(`docker ps -q -f name=${container}`);
                if (!psOutput.trim()) {
                    logger.debug({ container }, '[HotReload] Container not running, skipping');
                    continue;
                }
                logger.info({ container }, '[HotReload] Restarting container');
                await execAsync(`docker restart ${container}`);
                logger.info({ container }, '[HotReload] Container restarted');
            }
            catch (err) {
                logger.warn({ container, err }, '[HotReload] Failed to restart container');
                // Continue with other containers
            }
        }
    }
    /**
     * Trigger reload (called on SIGUSR1 or by CLI)
     * Drains active calls, syncs configs, restarts Docker, and exits for respawn
     */
    async triggerReload() {
        logger.info('[HotReload] Full reinstantiation triggered');
        // Step 1: Run pre-reload listeners
        await this.runReloadListeners();
        // Step 2: Drain active calls
        await this.drain();
        // Step 3: Sync stale project configs for future sessions
        await this.syncProjectConfigs();
        // Step 4: Restart Docker containers
        await this.restartDockerContainers();
        // Step 5: Exit cleanly - Claude will respawn with new code
        logger.info('[HotReload] Exiting for reload');
        process.exit(0);
    }
    /**
     * Trigger a quick reload without Docker restart
     * Use for code-only changes
     */
    async triggerQuickReload() {
        logger.info('[HotReload] Quick reload triggered (no Docker restart)');
        await this.runReloadListeners();
        await this.drain();
        await this.syncProjectConfigs();
        logger.info('[HotReload] Exiting for quick reload');
        process.exit(0);
    }
    /**
     * Get status for dashboard/monitoring
     */
    getStatus() {
        return {
            isDraining: this.isDraining,
            activeCallCount: this.activeCalls.size,
            activeCalls: this.getActiveCallDetails(),
            drainTimeoutMs: this.drainTimeout
        };
    }
    /**
     * Reset the manager (useful for testing)
     */
    reset() {
        this.activeCalls.clear();
        this.isDraining = false;
        this.reloadListeners = [];
    }
}
// Singleton export
export const hotReloadManager = HotReloadManager.getInstance();
/**
 * Get the singleton HotReloadManager instance
 * Preferred way to access the manager for consistency
 */
export function getHotReloadManager() {
    return HotReloadManager.getInstance();
}
//# sourceMappingURL=hotReloadManager.js.map