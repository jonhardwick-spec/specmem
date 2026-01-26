/**
 * Resilient Transport Layer for MCP Server
 *
 * Implements connection health monitoring, exponential backoff reconnection,
 * and graceful handling for the stdio-based MCP transport. Since MCP servers
 * run as child processes of  Code and communicate via stdin/stdout,
 * actual transport reconnection is handled by  Code restarting the process.
 * This module focuses on:
 *
 * 1. Detecting connection issues early (stdin EOF, pipe breaks, EPIPE errors)
 * 2. Graceful shutdown when connection is irrecoverably lost
 * 3. Announcing connection state changes to logs WITH TIMESTAMPS
 * 4. Health monitoring for proactive issue detection
 * 5. Recovery attempts with exponential backoff before giving up
 * 6. Clear, actionable error messages explaining what went wrong
 *
 * IMPORTANT: The MCP protocol uses stdio - stdout is reserved for JSON-RPC
 * messages, so all logging MUST go to stderr.
 *
 * Environment Variables (all configurable, no hardcoded timeouts):
 * - SPECMEM_TRANSPORT_HEALTH_INTERVAL: Health check interval (default: 30000ms)
 * - SPECMEM_TRANSPORT_INACTIVITY_THRESHOLD: Degraded state threshold (default: 300000ms)
 * - SPECMEM_TRANSPORT_MAX_ERRORS: Max errors before shutdown (default: 10)
 * - SPECMEM_TRANSPORT_DEBUG: Enable verbose debug logging (default: false)
 * - SPECMEM_TRANSPORT_KEEPALIVE_INTERVAL: Keepalive ping interval (default: 60000ms)
 * - SPECMEM_TRANSPORT_KEEPALIVE_ENABLED: Enable keepalive (default: true)
 * - SPECMEM_TRANSPORT_RECOVERY_ENABLED: Enable recovery attempts (default: true)
 * - SPECMEM_TRANSPORT_RECOVERY_MAX_ATTEMPTS: Max recovery attempts (default: 5)
 * - SPECMEM_TRANSPORT_RECOVERY_BASE_DELAY: Base delay for backoff (default: 1000ms)
 * - SPECMEM_TRANSPORT_RECOVERY_MAX_DELAY: Max delay cap (default: 30000ms)
 * - SPECMEM_TRANSPORT_RECOVERY_MULTIPLIER: Backoff multiplier (default: 2)
 * - SPECMEM_TRANSPORT_STDIN_GRACE_PERIOD: Grace period for stdin close (default: 5000ms)
 * - SPECMEM_TRANSPORT_SHUTDOWN_GRACE_PERIOD: Grace period before shutdown (default: 100ms)
 */
import { EventEmitter } from 'events';
export declare enum ConnectionState {
    INITIALIZING = "initializing",
    CONNECTED = "connected",
    DEGRADED = "degraded",
    RECOVERING = "recovering",// NEW: Attempting recovery with backoff
    DISCONNECTING = "disconnecting",
    DISCONNECTED = "disconnected"
}
export interface HealthCheckResult {
    state: ConnectionState;
    stdinOpen: boolean;
    stdoutOpen: boolean;
    lastActivityMs: number;
    errorCount: number;
    warningMessage: string | null;
    timestamp: string;
    recoveryAttempts: number;
}
export interface TransportError {
    type: string;
    message: string;
    timestamp: string;
    suggestion: string;
    code?: string;
    syscall?: string;
}
export interface ResilientTransportConfig {
    healthCheckIntervalMs: number;
    inactivityThresholdMs: number;
    maxErrorsBeforeShutdown: number;
    debugMode: boolean;
    keepaliveIntervalMs: number;
    keepaliveEnabled: boolean;
    recoveryEnabled: boolean;
    recoveryMaxAttempts: number;
    recoveryBaseDelayMs: number;
    recoveryMaxDelayMs: number;
    recoveryMultiplier: number;
    stdinGracePeriodMs: number;
    shutdownGracePeriodMs: number;
}
/**
 * ResilientTransport - monitors and manages MCP stdio transport health
 *
 * This wraps the standard StdioServerTransport with health monitoring,
 * exponential backoff recovery, and graceful error handling. It emits
 * events that the MCP server can listen to for handling connection state changes.
 *
 * Key features:
 * - Exponential backoff reconnection attempts before giving up
 * - Detailed error messages with actionable suggestions
 * - Timestamp logging for all state changes
 * - Configurable via environment variables (no hardcoded values)
 * - Handles stdio edge cases (EPIPE, broken pipe, EAGAIN, etc.)
 */
export declare class ResilientTransport extends EventEmitter {
    private config;
    private state;
    private lastActivityTime;
    private monitoringStartTime;
    private errorCount;
    private healthCheckTimer;
    private keepaliveTimer;
    private recoveryTimer;
    private stdinMonitor;
    private stdoutMonitor;
    private shutdownInProgress;
    private keepaliveCallback;
    private connectionRecoveryCallback;
    private recoveryAttempts;
    private lastRecoveryTime;
    private recentErrors;
    private readonly MAX_RECENT_ERRORS;
    constructor(config?: Partial<ResilientTransportConfig>);
    /**
     * Get a human-readable suggestion for a specific error type
     * Helps users understand what went wrong and how to fix it
     */
    private getErrorSuggestion;
    /**
     * Calculate the next backoff delay using exponential backoff with jitter
     * Formula: min(maxDelay, baseDelay * multiplier^attempt) + random jitter
     */
    private calculateBackoffDelay;
    /**
     * Format a timestamp for logging
     */
    private formatTimestamp;
    /**
     * Start monitoring the stdio streams
     * Should be called after MCP server.connect()
     */
    startMonitoring(): void;
    /**
     * Set the keepalive callback - this will be called periodically to keep connection alive
     * The callback should send a log message or ping to 
     */
    setKeepaliveCallback(callback: () => Promise<void>): void;
    /**
     * Set the connection recovery callback - called when connection is restored from degraded
     * The callback should re-send tool list notifications to 
     */
    setConnectionRecoveryCallback(callback: () => Promise<void>): void;
    /**
     * Start the keepalive timer
     * Sends periodic keepalive pings to prevent idle disconnection
     */
    private startKeepalive;
    /**
     * Send a keepalive ping
     * Records activity and optionally calls the keepalive callback
     */
    private sendKeepalive;
    /**
     * Setup stdin monitoring for connection issues
     * Handles edge cases: EOF, close, EPIPE, EAGAIN, etc.
     */
    private setupStdinMonitoring;
    /**
     * Setup stdout monitoring for write issues
     * Handles edge cases: EPIPE (broken pipe), EAGAIN, write errors
     */
    private setupStdoutMonitoring;
    /**
     * Start periodic health checks
     */
    private startHealthChecks;
    /**
     * Perform a health check and emit status
     */
    private performHealthCheck;
    /**
     * Trigger connection recovery - re-sends tool list notifications
     */
    private triggerConnectionRecovery;
    /**
     * Record that activity occurred (message sent/received)
     */
    recordActivity(): void;
    /**
     * Record an error for tracking
     */
    recordError(type: string, message: string): void;
    /**
     * Handle a connection issue with exponential backoff recovery
     * This is the main entry point for connection problems
     *
     * Flow:
     * 1. If recovery is disabled or exhausted, go to handleConnectionLoss
     * 2. Otherwise, enter RECOVERING state and schedule a recovery attempt
     * 3. On each attempt, check if connection is restored
     * 4. If all attempts fail, escalate to handleConnectionLoss
     */
    private handleConnectionIssue;
    /**
     * Attempt to recover the connection after backoff delay
     */
    private attemptRecovery;
    /**
     * Handle detected connection loss - final shutdown path
     * This is called when recovery is disabled or all recovery attempts have failed
     */
    private handleConnectionLoss;
    /**
     * Get current connection health
     */
    getHealth(): HealthCheckResult;
    /**
     * Get current connection state
     */
    getState(): ConnectionState;
    /**
     * Check if connection is healthy
     */
    isHealthy(): boolean;
    /**
     * Check if connection is usable (connected or degraded)
     */
    isUsable(): boolean;
    /**
     * Shutdown monitoring and cleanup
     */
    shutdown(): void;
    /**
     * Reset error count (e.g., after successful recovery)
     */
    resetErrors(): void;
    /**
     * Get recent errors for debugging
     */
    getRecentErrors(): TransportError[];
    /**
     * Check if currently in recovery state
     */
    isRecovering(): boolean;
    /**
     * Get current recovery status
     */
    getRecoveryStatus(): {
        isRecovering: boolean;
        attempts: number;
        maxAttempts: number;
        lastRecoveryTime: number;
    };
}
/**
 * Get or create the resilient transport singleton
 */
export declare function getResilientTransport(config?: Partial<ResilientTransportConfig>): ResilientTransport;
/**
 * Reset the resilient transport (for testing or restart)
 */
export declare function resetResilientTransport(): void;
//# sourceMappingURL=resilientTransport.d.ts.map