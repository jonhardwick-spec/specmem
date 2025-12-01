#!/usr/bin/env node
/**
 * SpecMem - Speculative Memory MCP Server
 *
 * yo shoutout to doobidoo/mcp-memory-service for the inspo
 * we took their SQLite version and made it POSTGRESQL BEAST MODE
 * - hardwicksoftwareservices
 *
 * this thing hits different fr fr - semantic search, dream-inspired
 * consolidation, and postgresql go crazy together no cap
 */
import { ToolRegistry } from './toolRegistry.js';
import { EmbeddingProvider } from '../tools/index.js';
import { HealthMonitor, SystemHealthResult } from './healthMonitor.js';
import { EmbeddingServerManager, EmbeddingServerStatus } from './embeddingServerManager.js';
import { MiniCOTServerManager, MiniCOTServerStatus } from './miniCOTServerManager.js';
declare const _SERVER_CACHE: {
    hitCount: number;
    missCount: number;
    lastAccessTime: number;
};
interface ServerStats {
    uptime: number;
    toolCalls: number;
    cacheHitRate: number;
    lastError: string | null;
}
/**
 * SpecMem MCP Server - the main event fr fr
 *
 * handles all the claude code integration like a champ
 * stdio transport go brrrr for that sweet sweet IPC
 */
export declare class SpecMemServer {
    private server;
    private db;
    private toolRegistry;
    private protocolHandler;
    private commandHandler;
    private startTime;
    private toolCallCount;
    private lastError;
    private embeddingProvider;
    private resilientTransport;
    private isShuttingDown;
    private hotReloadManager;
    private healthMonitor;
    private embeddingServerManager;
    private miniCOTServerManager;
    constructor(embeddingProvider: EmbeddingProvider);
    private setupHandlers;
    private setupResourceHandlers;
    private setupPromptHandlers;
    private setupErrorHandling;
    private formatResponse;
    private getSuggestionForError;
    private isFullyReady;
    private deferredInitPromise;
    /**
     * Check if server is ready for full tool execution
     * Tools can check this and wait for init if needed
     */
    isReady(): boolean;
    /**
     * HIGH-25 FIX: Wait for deferred initialization to complete with timeout
     * Tools that need DB can await this - prevents indefinite hangs
     * @param timeoutMs Maximum time to wait (default 30s)
     * @throws Error if timeout expires before server is ready
     */
    waitForReady(timeoutMs?: number): Promise<void>;
    start(): Promise<void>;
    /**
     * Initialize the centralized health monitor
     * Monitors all MCP components: transport, database, and embedding socket
     */
    private initializeHealthMonitor;
    /**
     * Initialize the embedding server lifecycle manager
     * This ensures the embedding server is ALWAYS available when Claude needs it
     *
     * Features:
     * 1. On MCP server start: Check for stale processes, kill them, start fresh
     * 2. On MCP server stop: Gracefully kill embedding server using PID file
     * 3. Uses project-specific socket path: {PROJECT}/specmem/sockets/embeddings.sock
     * 4. Health check that pings embedding server periodically
     * 5. Auto-restart if embedding server dies
     */
    private initializeEmbeddingServerManager;
    /**
     * Setup handlers for embedding server manager events
     */
    private setupEmbeddingServerHandlers;
    /**
     * Send embedding server notification to Claude via MCP logging
     */
    private sendEmbeddingServerNotification;
    /**
     * Initialize the Mini COT server lifecycle manager
     * Optional service for semantic gallery curation and analysis
     */
    private initializeMiniCOTServerManager;
    /**
     * Setup handlers for Mini COT server events
     */
    private setupMiniCOTServerHandlers;
    /**
     * Send Mini COT server status notification to Claude
     */
    private sendMiniCOTServerNotification;
    /**
     * Get the default embedding socket path for health monitoring
     * USES CENTRALIZED CONFIG - no hardcoded paths!
     */
    private getDefaultEmbeddingSocketPath;
    /**
     * Setup handlers for health monitor events
     */
    private setupHealthMonitorHandlers;
    /**
     * Send health monitor notification to Claude via MCP logging
     */
    private sendHealthMonitorNotification;
    /**
     * Setup handlers for resilient transport events
     * Handles connection state changes and triggers graceful shutdown when needed
     */
    private setupResilientTransportHandlers;
    /**
     * Send health notification to Claude when connection state changes
     */
    private sendHealthNotification;
    /**
     * Deferred database initialization
     * Called after MCP connection is established to prevent timeout
     */
    private initializeDatabaseDeferred;
    shutdown(): Promise<void>;
    getStats(): ServerStats;
    /**
     * Get the tool registry for dynamic tool registration
     *
     * Useful for plugins or extensions that want to add tools at runtime.
     * After registering new tools, call refreshToolList() to notify Claude.
     */
    getToolRegistry(): ToolRegistry;
    /**
     * Refresh the tool list and notify Claude of changes
     *
     * Call this after dynamically registering new tools to make them
     * immediately available to Claude without requiring an MCP restart.
     *
     * @example
     * ```typescript
     * const server = new SpecMemServer(embeddingProvider);
     * const registry = server.getToolRegistry();
     * registry.register(new MyCustomTool());
     * await server.refreshToolList(); // Claude now sees the new tool!
     * ```
     */
    refreshToolList(): Promise<void>;
    /**
     * Reload tools without full restart (Tier 1 hot reload)
     *
     * This method supports hot reloading of tools and skills without requiring
     * a full MCP server restart. It's designed to be called via SIGHUP signal
     * for seamless updates during development or when skills/commands change.
     *
     * What it does:
     * 1. Re-scans skills directory to pick up new/changed skill files
     * 2. Reloads command handlers if they support dynamic reload
     * 3. Notifies Claude that the tool list has changed (triggers re-fetch)
     *
     * @example
     * ```bash
     * # From CLI - send SIGHUP to trigger reload
     * kill -HUP $(pgrep -f specmem)
     * ```
     */
    reloadTools(): Promise<void>;
    /**
     * Get health status of the MCP server (#42)
     *
     * Returns comprehensive health check info fr fr
     * Now includes transport, database, and embedding health via centralized health monitor
     */
    getHealth(): {
        status: 'healthy' | 'degraded' | 'unhealthy';
        uptime: number;
        database: {
            connected: boolean;
            health: string;
            errorCount: number;
        };
        embedding: {
            available: boolean;
            health: string;
            errorCount: number;
        };
        tools: {
            count: number;
        };
        skills: {
            count: number;
        };
        memory: {
            heapUsedMB: number;
            heapTotalMB: number;
        };
        transport: {
            state: string;
            lastActivityMs: number;
            errorCount: number;
        };
        timestamp: string;
    };
    /**
     * Get the health monitor instance for direct access
     * Useful for advanced health monitoring scenarios
     */
    getHealthMonitor(): HealthMonitor | null;
    /**
     * Force a comprehensive health check immediately
     * Returns the full system health status
     */
    forceHealthCheck(): Promise<SystemHealthResult | null>;
    /**
     * Get the embedding server manager instance
     * Useful for monitoring embedding server status
     */
    getEmbeddingServerManager(): EmbeddingServerManager | null;
    /**
     * Get embedding server status
     * Returns detailed status about the embedding server process
     */
    getEmbeddingServerStatus(): EmbeddingServerStatus | null;
    /**
     * Force restart the embedding server
     * Useful if embeddings are failing and you want to try a fresh start
     */
    restartEmbeddingServer(): Promise<boolean>;
    /**
     * Get Mini COT server lifecycle manager
     * Returns the manager if initialized, null otherwise
     */
    getMiniCOTServerManager(): MiniCOTServerManager | null;
    /**
     * Get Mini COT server status
     * Returns detailed status about the Mini COT server process
     */
    getMiniCOTServerStatus(): MiniCOTServerStatus | null;
    /**
     * Force restart the Mini COT server
     * Useful if COT analysis is failing and you want to try a fresh start
     */
    restartMiniCOTServer(): Promise<boolean>;
    /**
     * Start Mini COT server (if stopped)
     * Sets the stopped flag to false and starts the server
     */
    startMiniCOTServer(): Promise<boolean>;
    /**
     * Stop Mini COT server
     * Sets the stopped flag to true and stops the server
     */
    stopMiniCOTServer(): Promise<void>;
    /**
     * Notify Claude that the tool list is ready
     *
     * CRITICAL FOR TOOL AUTO-DISCOVERY:
     * This calls the MCP SDK's sendToolListChanged() method which sends a
     * notifications/tools/list_changed notification to Claude Code.
     *
     * When Claude receives this notification, it will:
     * 1. Invalidate its cached tool list
     * 2. Make a new ListToolsRequest to get the updated list
     * 3. Make all 39+ SpecMem tools available in its tool palette
     *
     * Without this notification, Claude may cache an empty or stale tool list
     * from the initial handshake before all tools are registered.
     *
     * The MCP protocol flow:
     * 1. Server -> Client: notifications/tools/list_changed
     * 2. Client -> Server: tools/list request
     * 3. Server -> Client: tools/list response with all 39 tools
     *
     * @see https://spec.modelcontextprotocol.io/specification/2024-11-05/server/tools/
     */
    private notifyToolListReady;
    /**
     * Announce specmem to Claude on startup
     *
     * yo this is the startup banner that lets Claude know we loaded fr fr
     * shows all tools, skills, and dashboard URL so Claude knows whats available
     */
    private announceToClaudeOnStartup;
    /**
     * Send announcement with retry logic
     *
     * Implements exponential backoff retry for sending the startup announcement
     * because the MCP connection might not be fully ready on first attempt
     */
    private sendAnnouncementWithRetry;
}
export { _SERVER_CACHE };
//# sourceMappingURL=specMemServer.d.ts.map