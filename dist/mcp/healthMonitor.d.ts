/**
 * MCP Health Monitor - Robust Health Monitoring for MCP Server
 *
 * Provides comprehensive health monitoring for all critical MCP components:
 * 1. Stdio transport connection (via ResilientTransport)
 * 2. Database connectivity
 * 3. Embedding socket responsiveness
 *
 * Key features:
 * - Non-blocking periodic health checks
 * - Auto-recovery for failed components
 * - Comprehensive health status logging
 * - Graceful degradation when components fail
 *
 * The health monitor runs in the background and emits events when
 * component health changes, allowing the MCP server to respond appropriately.
 */
import { EventEmitter } from 'events';
import { DatabaseManager } from '../database.js';
import { ResilientTransport } from './resilientTransport.js';
export declare enum ComponentHealth {
    HEALTHY = "healthy",
    DEGRADED = "degraded",
    UNHEALTHY = "unhealthy",
    UNKNOWN = "unknown"
}
export interface ComponentHealthResult {
    component: string;
    health: ComponentHealth;
    lastCheckTime: number;
    lastSuccessTime: number | null;
    errorCount: number;
    lastError: string | null;
    details: Record<string, unknown>;
}
export interface SystemHealthResult {
    overallHealth: ComponentHealth;
    components: {
        transport: ComponentHealthResult;
        database: ComponentHealthResult;
        embedding: ComponentHealthResult;
    };
    uptime: number;
    timestamp: string;
}
export interface HealthMonitorConfig {
    checkIntervalMs: number;
    dbTimeoutMs: number;
    embeddingTimeoutMs: number;
    unhealthyThreshold: number;
    recoveryThreshold: number;
    autoRecoveryEnabled: boolean;
    recoveryIntervalMs: number;
    logHealthStatus: boolean;
    logIntervalMs: number;
}
/**
 * HealthMonitor - Centralized health monitoring for MCP server
 *
 * Events emitted:
 * - 'health': SystemHealthResult - periodic health status
 * - 'degraded': { component: string, result: ComponentHealthResult } - component degraded
 * - 'unhealthy': { component: string, result: ComponentHealthResult } - component unhealthy
 * - 'recovered': { component: string, result: ComponentHealthResult } - component recovered
 * - 'recovery_attempted': { component: string, success: boolean } - auto-recovery attempted
 */
export declare class HealthMonitor extends EventEmitter {
    private config;
    private startTime;
    private checkTimer;
    private logTimer;
    private isRunning;
    private resilientTransport;
    private database;
    private embeddingSocketPath;
    private transportHealth;
    private databaseHealth;
    private embeddingHealth;
    private lastRecoveryAttempt;
    constructor(config?: Partial<HealthMonitorConfig>);
    private createInitialHealth;
    /**
     * Set the resilient transport for monitoring
     */
    setTransport(transport: ResilientTransport): void;
    /**
     * Set the database manager for monitoring
     */
    setDatabase(db: DatabaseManager): void;
    /**
     * Set the embedding socket path for monitoring
     */
    setEmbeddingSocketPath(socketPath: string): void;
    /**
     * Start the health monitoring loop
     */
    start(): void;
    /**
     * Stop the health monitoring loop
     */
    stop(): void;
    /**
     * Run all health checks (non-blocking)
     */
    runHealthChecks(): Promise<SystemHealthResult>;
    /**
     * Check transport health
     */
    private checkTransportHealth;
    /**
     * Check database health with timeout
     */
    private checkDatabaseHealth;
    /**
     * Check embedding socket health
     */
    private checkEmbeddingHealth;
    /**
     * Ping the embedding socket to verify it's responsive
     */
    private pingEmbeddingSocket;
    /**
     * Get the default embedding socket path
     *
     * DYNAMIC PATH RESOLUTION (in priority order):
     * 1. Environment variable: SPECMEM_EMBEDDING_SOCKET (explicit configuration)
     * 2.  home: ~/.claude/run (standard  Code location, uses os.homedir())
     * 3. SpecMem run dir: /specmem/run (container mount)
     * 4. Project-specific instances paths
     * 5. Legacy fallback paths
     *
     * USES CENTRALIZED CONFIG - no hardcoded paths!
     * Delegates to getEmbeddingSocketPath() from config.ts for single source of truth.
     */
    private getDefaultEmbeddingSocketPath;
    /**
     * Quick synchronous-ish socket connectivity test
     * Returns true if socket appears connectable, false otherwise
     * Uses very short timeout to avoid blocking
     */
    private quickSocketTest;
    /**
     * Update component health status and emit events if changed
     */
    private updateComponentHealth;
    /**
     * Attempt auto-recovery for failed components
     */
    private attemptAutoRecovery;
    private shouldAttemptRecovery;
    /**
     * Attempt to recover database connection
     */
    private recoverDatabase;
    /**
     * Handle embedding service unavailability
     * Since we can't restart the embedding container from here, we log a warning
     * and suggest manual intervention
     */
    private recoverEmbedding;
    /**
     * Get comprehensive system health status
     */
    getSystemHealth(): SystemHealthResult;
    /**
     * Log current health status
     */
    private logHealthStatus;
    /**
     * Get individual component health
     */
    getTransportHealth(): ComponentHealthResult;
    getDatabaseHealth(): ComponentHealthResult;
    getEmbeddingHealth(): ComponentHealthResult;
    /**
     * Force a health check immediately
     */
    forceHealthCheck(): Promise<SystemHealthResult>;
    /**
     * Check if system is healthy enough for operation
     */
    isOperational(): boolean;
}
/**
 * Get or create the health monitor for current/specified project
 */
export declare function getHealthMonitor(config?: Partial<HealthMonitorConfig>, projectPath?: string): HealthMonitor;
/**
 * Reset the health monitor for current/specified project (for testing or restart)
 */
export declare function resetHealthMonitor(projectPath?: string): void;
/**
 * Reset all health monitors across all projects
 */
export declare function resetAllHealthMonitors(): void;
//# sourceMappingURL=healthMonitor.d.ts.map