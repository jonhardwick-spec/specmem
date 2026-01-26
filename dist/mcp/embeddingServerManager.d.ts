/**
 * Embedding Server Lifecycle Manager
 *
 * Manages the embedding server process lifecycle for the MCP server.
 * Ensures embedding server is ALWAYS available when  needs it.
 *
 * Features:
 * 1. On MCP server start: Check for stale processes, kill them, start fresh
 * 2. On MCP server stop: Gracefully kill embedding server using PID file
 * 3. Project-specific socket path: {PROJECT}/specmem/sockets/embeddings.sock
 * 4. Health check that pings embedding server periodically
 * 5. Auto-restart if embedding server dies
 *
 * @author hardwicksoftwareservices
 */
import { EventEmitter } from 'events';
interface EmbeddingServerConfig {
    /** Health check interval in ms (default: 30 seconds) */
    healthCheckIntervalMs: number;
    /** Health check timeout in ms (default: 3 seconds) */
    healthCheckTimeoutMs: number;
    /** Max consecutive failures before restart (default: 2) */
    maxFailuresBeforeRestart: number;
    /** Restart cooldown in ms (default: 10 seconds) */
    restartCooldownMs: number;
    /** Startup timeout in ms (default: 15 seconds - fail-fast) */
    startupTimeoutMs: number;
    /** Max restart attempts (default: 5) */
    maxRestartAttempts: number;
    /** Auto-start on MCP server start (default: true) */
    autoStart: boolean;
    /** Kill stale processes on start (default: true) */
    killStaleOnStart: boolean;
    /** Max process age in hours before considering stale (default: 1) */
    maxProcessAgeHours: number;
}
export interface EmbeddingServerStatus {
    running: boolean;
    pid: number | null;
    socketPath: string;
    socketExists: boolean;
    healthy: boolean;
    lastHealthCheck: number | null;
    consecutiveFailures: number;
    restartCount: number;
    startTime: number | null;
    uptime: number | null;
}
export interface HealthCheckResult {
    success: boolean;
    responseTimeMs: number;
    error?: string;
    dimensions?: {
        native: number;
        target: number;
    };
}
/**
 * EmbeddingServerManager - Manages embedding server process lifecycle
 *
 * Events emitted:
 * - 'started': { pid: number } - Server started successfully
 * - 'stopped': { pid: number } - Server stopped
 * - 'health': HealthCheckResult - Health check result
 * - 'unhealthy': { failures: number } - Server unhealthy
 * - 'restarting': { attempt: number } - Restarting server
 * - 'restart_failed': { attempts: number } - All restart attempts failed
 */
export declare class EmbeddingServerManager extends EventEmitter {
    private config;
    private process;
    private healthCheckTimer;
    private isRunning;
    private consecutiveFailures;
    private restartCount;
    private lastRestartTime;
    private startTime;
    private projectPath;
    private socketPath;
    private pidFilePath;
    private isShuttingDown;
    private isStarting;
    private startLockPath;
    private readonly START_LOCK_TIMEOUT_MS;
    private stoppedFlagPath;
    private restartTimestamps;
    private kysHeartbeatTimer;
    private readonly KYS_HEARTBEAT_INTERVAL_MS;
    constructor(config?: Partial<EmbeddingServerConfig>);
    /**
     * Initialize and start the embedding server
     * Should be called on MCP server startup
     */
    initialize(): Promise<void>;
    /**
     * Start the embedding server
     * FIX: First check if Docker container is already serving on this socket
     * FIX: Uses file-based lock to prevent CROSS-PROCESS race conditions
     */
    start(): Promise<boolean>;
    /**
     * Atomically acquire the start lock using O_CREAT | O_EXCL
     * This is truly atomic - the OS ensures only one process can create the file
     * @returns true if lock acquired, false if another process has it
     */
    private acquireStartLockAtomic;
    /**
     * Release the file-based start lock
     */
    private releaseStartLock;
    /**
     * Drain embedding queue after server starts
     * Processes any pending embedding requests that were queued while server was down
     */
    private drainEmbeddingQueueIfNeeded;
    /**
     * Generate embedding using direct socket connection
     * Used by drainQueue to process pending requests after server comes online
     */
    private generateEmbeddingViaSocket;
    /**
     * Stop the embedding server gracefully
     */
    stop(): Promise<void>;
    /**
     * Perform a health check on the embedding server
     */
    healthCheck(): Promise<HealthCheckResult>;
    /**
     * Get current server status
     */
    getStatus(): EmbeddingServerStatus;
    /**
     * Shutdown - called when MCP server is shutting down
     */
    shutdown(): Promise<void>;
    /**
     * Check if user manually stopped the server
     * Returns true if the stopped flag file exists
     */
    isStoppedByUser(): boolean;
    /**
     * Check if the embedding server died due to KYS watchdog (no heartbeat from MCP)
     * Returns true if death reason file exists and contains "kys"
     */
    wasKilledByKYS(): boolean;
    /**
     * Clear the KYS death reason file (called after successful respawn)
     */
    private clearKYSDeathReason;
    /**
     * Auto-respawn if server was killed by KYS watchdog
     * This is called when a socket connection fails - if KYS was the cause,
     * we respawn the server and return true so caller can retry
     */
    autoRespawnIfKYSDeath(): Promise<boolean>;
    /**
     * Set the stopped-by-user flag
     * When true, prevents auto-restart
     */
    private setStoppedByUser;
    /**
     * User-initiated stop - sets flag to prevent auto-restart
     * Use this when user explicitly wants to stop the embedding server
     */
    userStop(): Promise<{
        success: boolean;
        message: string;
    }>;
    /**
     * User-initiated start - clears stopped flag and does hard restart
     * Use this when user explicitly wants to (re)start the embedding server
     */
    userStart(): Promise<{
        success: boolean;
        message: string;
    }>;
    /**
     * Get restart loop detection info
     * Detects if we're in a restart loop (>3 restarts in 60 seconds)
     */
    getRestartLoopInfo(): {
        inLoop: boolean;
        recentRestarts: number;
        maxAttempts: number;
        windowSeconds: number;
        restartCount: number;
    };
    /**
     * Get extended status including stopped-by-user flag and restart loop info
     */
    getExtendedStatus(): EmbeddingServerStatus & {
        stoppedByUser: boolean;
        restartLoop: ReturnType<EmbeddingServerManager['getRestartLoopInfo']>;
    };
    /**
     * Kill any stale embedding processes from previous runs
     * Uses robust process age checking to verify we're killing the right process
     */
    private killStaleProcesses;
    /**
     * Kill a process using health info metadata
     */
    private killProcessWithHealthInfo;
    /**
     * Find and kill orphaned embedding processes (no PID file)
     * Kills zombie frankenstein processes NOT tracked by any project's PID file
     * Preserves processes actively used by other SpecMem instances
     *
     * CRITICAL FIX: Socket path is passed via ENVIRONMENT VARIABLES, not command line!
     * So we find ALL frankenstein processes, then filter by checking /proc/PID/environ
     */
    private killOrphanedProcesses;
    /**
     * Get the SPECMEM_EMBEDDING_SOCKET env var from a running process
     * Returns the socket path this process is bound to, or null if not found
     */
    private getProcessSocketPath;
    /**
     * Get process info for an orphaned process (no PID file)
     */
    private getProcessInfoForOrphan;
    /**
     * Kill process by PID file (using robust health check)
     */
    private killByPidFile;
    /**
     * Find the embedding script path
     *
     * PRIORITY: frankenstein-embeddings.py (has ALL 4 optimizations + ACK verification)
     *         > warm-start.sh (Docker)
     *
     * We NEVER use a model that hasn't been optimized with all 4 optimizations.
     */
    private findEmbeddingScript;
    /**
     * Wait for socket file to appear AND server to be ready
     * FIX: Task #12 - Race condition fix: Poll with health checks instead of just file existence
     * The 60s timeout window was creating a race where socket file exists but server not ready
     */
    private waitForSocket;
    /**
     * Handle process exit
     */
    private handleProcessExit;
    /**
     * Attempt to restart the server
     */
    private attemptRestart;
    /**
     * Start health monitoring
     */
    private startHealthMonitoring;
    /**
     * Stop health monitoring
     */
    private stopHealthMonitoring;
    /**
     * Start KYS (Keep Yourself Safe) heartbeat - two-way ack system
     *
     * Sends {"type": "kys", "text": "kurt cobain t minus 25"} every 25 seconds.
     * If the embedding server doesn't receive this heartbeat within 30 seconds,
     * it commits suicide to prevent zombie processes.
     *
     * This prevents orphan embedding servers when MCP crashes or is killed.
     */
    private startKysHeartbeat;
    /**
     * Stop KYS heartbeat
     */
    private stopKysHeartbeat;
    /**
     * Write PID file with timestamp
     */
    private writePidFile;
    /**
     * Read PID from file
     */
    private readPidFile;
    /**
     * Read PID file with timestamp
     */
    private readPidFileWithTimestamp;
    /**
     * Remove PID file
     */
    private removePidFile;
    /**
     * Sleep helper
     */
    private sleep;
}
/**
 * Get or create the embedding server manager for a specific project
 * Uses per-project Map pattern to ensure proper isolation
 */
export declare function getEmbeddingServerManager(config?: Partial<EmbeddingServerConfig>): EmbeddingServerManager;
/**
 * Reset the embedding server manager for a specific project (or current project)
 */
export declare function resetEmbeddingServerManager(projectPath?: string): Promise<void>;
/**
 * Reset ALL embedding server managers (for global cleanup)
 */
export declare function resetAllEmbeddingServerManagers(): Promise<void>;
export {};
//# sourceMappingURL=embeddingServerManager.d.ts.map