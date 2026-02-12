/**
 * Mini COT Server Lifecycle Manager v2
 *
 * Manages the Mini COT (Chain-of-Thought) model service lifecycle for the MCP server.
 * Mini COT provides semantic analysis and gallery curation using TinyLlama.
 *
 * Features:
 * 1. On MCP server start: Check for stale processes, kill them, start fresh
 * 2. On MCP server stop: Gracefully kill Mini COT server using PID file
 * 3. Project-specific socket path: {PROJECT}/specmem/sockets/minicot.sock
 * 4. Health check that pings Mini COT server periodically
 * 5. Auto-restart if Mini COT server dies
 *
 * NEW IN v2 (Task #18 - Optimized like Frankenstein):
 * - Lazy loading: Model only loads on first request (faster startup)
 * - Model caching: Cached in /tmp/mini-cot-models/
 * - Web dev context: Injects documentation patterns for better code analysis
 * - Quantization support: SPECMEM_MINICOT_QUANTIZE=true for 4-bit (GPU)
 * - RAM guard: Auto-throttles under memory pressure
 * - Health check optimization: Fast ping without full inference
 *
 * Environment Variables:
 * - SPECMEM_MINICOT_CONTEXT: Custom context to inject (optional)
 * - SPECMEM_MINICOT_QUANTIZE: Enable 4-bit quantization (default: false)
 * - SPECMEM_MINICOT_MODEL: Model name (default: TinyLlama/TinyLlama-1.1B-Chat-v1.0)
 * - SPECMEM_MINICOT_DEVICE: cpu/cuda (default: cpu)
 *
 * @author hardwicksoftwareservices
 */
import { EventEmitter } from 'events';
interface MiniCOTServerConfig {
    /** Health check interval in ms (default: 30 seconds) */
    healthCheckIntervalMs: number;
    /** Health check timeout in ms (default: 10 seconds) */
    healthCheckTimeoutMs: number;
    /** Max consecutive failures before restart (default: 2) */
    maxFailuresBeforeRestart: number;
    /** Restart cooldown in ms (default: 10 seconds) */
    restartCooldownMs: number;
    /** Startup timeout in ms (default: 120 seconds - Mini COT needs more time to load model) */
    startupTimeoutMs: number;
    /** Max restart attempts (default: 5) */
    maxRestartAttempts: number;
    /** Auto-start on MCP server start (default: false - Mini COT is optional) */
    autoStart: boolean;
    /** Kill stale processes on start (default: true) */
    killStaleOnStart: boolean;
    /** Max process age in hours before considering stale (default: 1) */
    maxProcessAgeHours: number;
    /** Model name for TinyLlama (default: TinyLlama/TinyLlama-1.1B-Chat-v1.0) */
    modelName: string;
    /** Device for inference (default: cpu) */
    device: string;
}
export interface MiniCOTServerStatus {
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
    queueSize: number;
    queueMaxSize: number;
    queueDropped: number;
}
export interface QueuedRequest {
    id: string;
    query: string;
    memories: Array<{
        id: string;
        keywords: string;
        snippet: string;
    }>;
    timestamp: number;
    resolve: (result: any) => void;
    reject: (error: Error) => void;
}
export interface HealthCheckResult {
    success: boolean;
    responseTimeMs: number;
    error?: string;
    modelInfo?: {
        loaded: boolean;
        modelName?: string;
    };
}
/**
 * MiniCOTServerManager - Manages Mini COT model service lifecycle
 *
 * Events emitted:
 * - 'started': { pid: number } - Server started successfully
 * - 'stopped': { pid: number } - Server stopped
 * - 'health': HealthCheckResult - Health check result
 * - 'unhealthy': { failures: number } - Server unhealthy
 * - 'restarting': { attempt: number } - Restarting server
 * - 'restart_failed': { attempts: number } - All restart attempts failed
 * - 'restart_loop': RestartLoopInfo - Restart loop detected
 * - 'warm_restart': { success: boolean } - Warm restart completed
 * - 'cold_restart': { success: boolean } - Cold restart completed
 * - 'queue_overflow': { dropped: number, queueSize: number } - Queue overflow occurred
 * - 'queue_drained': { processed: number, failed: number } - Queue drained after restart
 */
export declare class MiniCOTServerManager extends EventEmitter {
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
    private stoppedFlagPath;
    private restartTimestamps;
    private requestQueue;
    private queueMaxSize;
    private queueDroppedCount;
    private isDrainingQueue;
    constructor(config?: Partial<MiniCOTServerConfig>);
    /**
     * Get the Mini COT socket path for this project
     */
    private getMiniCOTSocketPath;
    /**
     * Initialize and start the Mini COT server
     * Should be called on MCP server startup
     */
    initialize(): Promise<void>;
    /**
     * Start the Mini COT server
     * First checks if external process is already serving on this socket
     */
    start(): Promise<boolean>;
    /**
     * Stop the Mini COT server gracefully
     */
    stop(): Promise<void>;
    /**
     * Perform a health check on the Mini COT server
     * Mini COT uses JSON-based protocol - send a simple ping request
     */
    healthCheck(): Promise<HealthCheckResult>;
    /**
     * Get current server status
     */
    getStatus(): MiniCOTServerStatus;
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
     * Set the stopped-by-user flag
     * When true, prevents auto-restart
     */
    private setStoppedByUser;
    /**
     * User-initiated stop - sets flag to prevent auto-restart
     * Use this when user explicitly wants to stop the Mini COT server
     */
    userStop(): Promise<{
        success: boolean;
        message: string;
    }>;
    /**
     * User-initiated start - clears stopped flag and does hard restart
     * Use this when user explicitly wants to (re)start the Mini COT server
     */
    userStart(): Promise<{
        success: boolean;
        message: string;
    }>;
    /**
     * Warm restart - Quick restart that preserves loaded model weights in memory
     * Sends SIGHUP to Python service to reset state without unloading model
     * Faster recovery from errors while keeping the model warm
     */
    warmRestart(): Promise<{
        success: boolean;
        message: string;
        drainedCount?: number;
    }>;
    /**
     * Cold restart - Full restart that unloads and reloads the TinyLlama model
     * Complete process termination and fresh spawn
     * Use when warm restart fails or model corruption suspected
     */
    coldRestart(): Promise<{
        success: boolean;
        message: string;
        drainedCount?: number;
    }>;
    /**
     * Queue a request when server is unhealthy/restarting
     * Returns a promise that resolves when the request is processed after restart
     */
    queueRequest(query: string, memories: Array<{
        id: string;
        keywords: string;
        snippet: string;
    }>): Promise<any>;
    /**
     * Drain the queue after server restart
     * Processes all queued requests sequentially
     */
    drainQueue(): Promise<{
        processed: number;
        failed: number;
    }>;
    /**
     * Get current queue status
     */
    getQueueStatus(): {
        size: number;
        maxSize: number;
        dropped: number;
        isDraining: boolean;
        oldestRequestAge: number | null;
    };
    /**
     * Clear all queued requests (reject them with error)
     */
    clearQueue(reason?: string): number;
    /**
     * Send a request to the Mini COT server (internal helper)
     */
    private sendRequest;
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
    getExtendedStatus(): MiniCOTServerStatus & {
        stoppedByUser: boolean;
        restartLoop: ReturnType<MiniCOTServerManager['getRestartLoopInfo']>;
    };
    /**
     * Kill any stale Mini COT processes from previous runs
     * Uses robust process age checking to verify we're killing the right process
     */
    private killStaleProcesses;
    /**
     * Kill a process using health info metadata
     */
    private killProcessWithHealthInfo;
    /**
     * Find and kill orphaned Mini COT processes (no PID file)
     * Kills zombie mini-cot processes NOT tracked by any project's PID file
     */
    private killOrphanedProcesses;
    /**
     * Get process info for an orphaned process (no PID file)
     */
    private getProcessInfoForOrphan;
    /**
     * Kill process by PID file (using robust health check)
     */
    private killByPidFile;
    /**
     * Find the Mini COT script path
     */
    private findMiniCOTScript;
    /**
     * Wait for socket file to appear
     * Mini COT needs more time due to model loading
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
     * Write PID file with timestamp
     */
    private writePidFile;
    /**
     * Read PID from file
     */
    private readPidFile;
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
 * Get or create the Mini COT server manager for a specific project
 * Uses per-project Map pattern to ensure proper isolation
 */
export declare function getMiniCOTServerManager(config?: Partial<MiniCOTServerConfig>): MiniCOTServerManager;
/**
 * Reset the Mini COT server manager for a specific project (or current project)
 */
export declare function resetMiniCOTServerManager(projectPath?: string): Promise<void>;
/**
 * Reset ALL Mini COT server managers (for global cleanup)
 */
export declare function resetAllMiniCOTServerManagers(): Promise<void>;
export {};
//# sourceMappingURL=miniCOTServerManager.d.ts.map