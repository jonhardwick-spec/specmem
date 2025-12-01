/**
 * Resilient Transport Layer for MCP Server
 *
 * Implements connection health monitoring, exponential backoff reconnection,
 * and graceful handling for the stdio-based MCP transport. Since MCP servers
 * run as child processes of Claude Code and communicate via stdin/stdout,
 * actual transport reconnection is handled by Claude Code restarting the process.
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
import { logger } from '../utils/logger.js';
import { EventEmitter } from 'events';
// Connection states for the transport layer
export var ConnectionState;
(function (ConnectionState) {
    ConnectionState["INITIALIZING"] = "initializing";
    ConnectionState["CONNECTED"] = "connected";
    ConnectionState["DEGRADED"] = "degraded";
    ConnectionState["RECOVERING"] = "recovering";
    ConnectionState["DISCONNECTING"] = "disconnecting";
    ConnectionState["DISCONNECTED"] = "disconnected";
})(ConnectionState || (ConnectionState = {}));
// Helper to safely parse int with fallback
function safeParseInt(value, defaultValue) {
    if (!value)
        return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
}
// Helper to safely parse float with fallback
function safeParseFloat(value, defaultValue) {
    if (!value)
        return defaultValue;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
}
const DEFAULT_CONFIG = {
    healthCheckIntervalMs: safeParseInt(process.env['SPECMEM_TRANSPORT_HEALTH_INTERVAL'], 30000),
    inactivityThresholdMs: safeParseInt(process.env['SPECMEM_TRANSPORT_INACTIVITY_THRESHOLD'], 300000), // 5 minutes
    maxErrorsBeforeShutdown: safeParseInt(process.env['SPECMEM_TRANSPORT_MAX_ERRORS'], 10),
    debugMode: process.env['SPECMEM_TRANSPORT_DEBUG'] === 'true',
    // Keepalive: Send ping every 60 seconds to keep connection alive
    // This is CRITICAL for preventing "not connected" issues when Claude is idle
    keepaliveIntervalMs: safeParseInt(process.env['SPECMEM_TRANSPORT_KEEPALIVE_INTERVAL'], 60000),
    keepaliveEnabled: process.env['SPECMEM_TRANSPORT_KEEPALIVE_ENABLED'] !== 'false', // enabled by default
    // NEW: Recovery configuration - exponential backoff for connection issues
    recoveryEnabled: process.env['SPECMEM_TRANSPORT_RECOVERY_ENABLED'] !== 'false', // enabled by default
    recoveryMaxAttempts: safeParseInt(process.env['SPECMEM_TRANSPORT_RECOVERY_MAX_ATTEMPTS'], 5),
    recoveryBaseDelayMs: safeParseInt(process.env['SPECMEM_TRANSPORT_RECOVERY_BASE_DELAY'], 1000),
    recoveryMaxDelayMs: safeParseInt(process.env['SPECMEM_TRANSPORT_RECOVERY_MAX_DELAY'], 30000),
    recoveryMultiplier: safeParseFloat(process.env['SPECMEM_TRANSPORT_RECOVERY_MULTIPLIER'], 2),
    // NEW: Grace periods
    stdinGracePeriodMs: safeParseInt(process.env['SPECMEM_TRANSPORT_STDIN_GRACE_PERIOD'], 5000),
    shutdownGracePeriodMs: safeParseInt(process.env['SPECMEM_TRANSPORT_SHUTDOWN_GRACE_PERIOD'], 100),
};
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
export class ResilientTransport extends EventEmitter {
    config;
    state = ConnectionState.INITIALIZING;
    lastActivityTime = Date.now();
    monitoringStartTime = Date.now();
    errorCount = 0;
    healthCheckTimer = null;
    keepaliveTimer = null;
    recoveryTimer = null;
    stdinMonitor = null;
    stdoutMonitor = null;
    shutdownInProgress = false;
    keepaliveCallback = null;
    connectionRecoveryCallback = null;
    // NEW: Recovery tracking
    recoveryAttempts = 0;
    lastRecoveryTime = 0;
    recentErrors = [];
    MAX_RECENT_ERRORS = 10;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        const timestamp = new Date().toISOString();
        logger.info({
            timestamp,
            healthCheckIntervalMs: this.config.healthCheckIntervalMs,
            inactivityThresholdMs: this.config.inactivityThresholdMs,
            maxErrorsBeforeShutdown: this.config.maxErrorsBeforeShutdown,
            recoveryEnabled: this.config.recoveryEnabled,
            recoveryMaxAttempts: this.config.recoveryMaxAttempts,
            recoveryBaseDelayMs: this.config.recoveryBaseDelayMs,
            recoveryMaxDelayMs: this.config.recoveryMaxDelayMs
        }, `[${timestamp}] ResilientTransport: initialized with config (all timeouts configurable via env vars)`);
    }
    /**
     * Get a human-readable suggestion for a specific error type
     * Helps users understand what went wrong and how to fix it
     */
    getErrorSuggestion(type, message) {
        const suggestions = {
            'stdin_end': 'Claude Code may have closed the connection. Check if Claude Code is still running. The MCP server will restart automatically when Claude Code reconnects.',
            'stdin_close': 'The input stream was closed unexpectedly. This usually happens when Claude Code terminates. Wait for Claude Code to restart the MCP server.',
            'stdin_error': 'Error reading from input stream. Check system resources and file descriptor limits. Try restarting Claude Code.',
            'stdout_pipe_broken': 'Cannot write to output stream (EPIPE). Claude Code is no longer listening. The connection will be cleaned up automatically.',
            'stdout_error': 'Error writing to output stream. Check if Claude Code is still running and accepting input.',
            'stdout_close': 'Output stream closed unexpectedly. Claude Code may have terminated or hit a bug.',
            'keepalive_failed': 'Failed to send keepalive ping. The connection may be degraded. Will retry automatically.',
            'max_errors_exceeded': `Too many errors occurred (${this.errorCount}/${this.config.maxErrorsBeforeShutdown}). Shutting down to prevent resource leaks. Claude Code will restart the MCP server.`,
            'recovery_exhausted': `All ${this.config.recoveryMaxAttempts} recovery attempts failed. The connection cannot be restored. Claude Code needs to restart the MCP server.`,
            'epipe': 'Broken pipe error - the receiving end closed the connection. This is normal when Claude Code restarts.',
            'eagain': 'Resource temporarily unavailable. The system is under load. Will retry automatically with backoff.',
            'econnreset': 'Connection was reset by peer. Claude Code may have crashed or restarted.',
            'enotconn': 'Socket is not connected. The transport was never properly established.',
        };
        // Check for specific error codes in the message
        const lowerMessage = message.toLowerCase();
        if (lowerMessage.includes('epipe'))
            return suggestions['epipe'];
        if (lowerMessage.includes('eagain'))
            return suggestions['eagain'];
        if (lowerMessage.includes('econnreset'))
            return suggestions['econnreset'];
        if (lowerMessage.includes('enotconn'))
            return suggestions['enotconn'];
        return suggestions[type] || 'An unexpected error occurred. Check the logs for more details and try restarting Claude Code.';
    }
    /**
     * Calculate the next backoff delay using exponential backoff with jitter
     * Formula: min(maxDelay, baseDelay * multiplier^attempt) + random jitter
     */
    calculateBackoffDelay(attempt) {
        const exponentialDelay = this.config.recoveryBaseDelayMs * Math.pow(this.config.recoveryMultiplier, attempt);
        const cappedDelay = Math.min(exponentialDelay, this.config.recoveryMaxDelayMs);
        // Add 10% jitter to prevent thundering herd
        const jitter = cappedDelay * 0.1 * Math.random();
        return Math.floor(cappedDelay + jitter);
    }
    /**
     * Format a timestamp for logging
     */
    formatTimestamp() {
        return new Date().toISOString();
    }
    /**
     * Start monitoring the stdio streams
     * Should be called after MCP server.connect()
     */
    startMonitoring() {
        const timestamp = this.formatTimestamp();
        if (this.state !== ConnectionState.INITIALIZING) {
            logger.warn({ currentState: this.state, timestamp }, `[${timestamp}] ResilientTransport: already monitoring (state=${this.state})`);
            return;
        }
        this.state = ConnectionState.CONNECTED;
        this.lastActivityTime = Date.now();
        this.monitoringStartTime = Date.now();
        // DEBUG: Log monitoring start with full config visibility
        logger.info({
            timestamp,
            event: 'TRANSPORT_MONITOR_START',
            config: {
                healthCheckIntervalMs: this.config.healthCheckIntervalMs,
                keepaliveEnabled: this.config.keepaliveEnabled,
                keepaliveIntervalMs: this.config.keepaliveIntervalMs,
                recoveryEnabled: this.config.recoveryEnabled,
                recoveryMaxAttempts: this.config.recoveryMaxAttempts,
                stdinGracePeriodMs: this.config.stdinGracePeriodMs
            }
        }, `[${timestamp}] ResilientTransport: starting stdio monitoring`);
        process.stderr.write(`[SPECMEM ${timestamp}] Transport monitoring started (health=${this.config.healthCheckIntervalMs}ms, keepalive=${this.config.keepaliveIntervalMs}ms)\n`);
        // Monitor stdin for EOF (Claude disconnecting)
        this.setupStdinMonitoring();
        // Monitor stdout for write errors (pipe broken)
        this.setupStdoutMonitoring();
        // Start periodic health checks
        this.startHealthChecks();
        // Start keepalive mechanism if enabled
        if (this.config.keepaliveEnabled) {
            this.startKeepalive();
        }
        this.emit('connected');
        logger.info({
            timestamp,
            event: 'TRANSPORT_MONITOR_ACTIVE',
            keepaliveEnabled: this.config.keepaliveEnabled,
            keepaliveIntervalMs: this.config.keepaliveIntervalMs,
            recoveryEnabled: this.config.recoveryEnabled
        }, `[${timestamp}] ResilientTransport: monitoring active - connection established`);
    }
    /**
     * Set the keepalive callback - this will be called periodically to keep connection alive
     * The callback should send a log message or ping to Claude
     */
    setKeepaliveCallback(callback) {
        this.keepaliveCallback = callback;
        logger.debug('ResilientTransport: keepalive callback set');
    }
    /**
     * Set the connection recovery callback - called when connection is restored from degraded
     * The callback should re-send tool list notifications to Claude
     */
    setConnectionRecoveryCallback(callback) {
        this.connectionRecoveryCallback = callback;
        logger.debug('ResilientTransport: connection recovery callback set');
    }
    /**
     * Start the keepalive timer
     * Sends periodic keepalive pings to prevent idle disconnection
     */
    startKeepalive() {
        if (this.keepaliveTimer) {
            clearInterval(this.keepaliveTimer);
        }
        this.keepaliveTimer = setInterval(async () => {
            await this.sendKeepalive();
        }, this.config.keepaliveIntervalMs);
        // Don't keep process alive just for keepalive
        this.keepaliveTimer.unref();
        logger.debug({
            intervalMs: this.config.keepaliveIntervalMs
        }, 'ResilientTransport: keepalive timer started');
    }
    /**
     * Send a keepalive ping
     * Records activity and optionally calls the keepalive callback
     */
    async sendKeepalive() {
        if (this.shutdownInProgress || this.state === ConnectionState.DISCONNECTED) {
            return;
        }
        try {
            // Record activity to prevent degraded state
            this.recordActivity();
            // Call the keepalive callback if set (e.g., send log to Claude)
            if (this.keepaliveCallback) {
                await this.keepaliveCallback();
            }
            if (this.config.debugMode) {
                logger.debug('ResilientTransport: keepalive sent');
            }
        }
        catch (err) {
            // Keepalive failure shouldn't crash - just log and record error
            const error = err instanceof Error ? err : new Error(String(err));
            logger.warn({ error: error.message }, 'ResilientTransport: keepalive failed');
            this.recordError('keepalive_failed', error.message);
        }
    }
    /**
     * Setup stdin monitoring for connection issues
     * Handles edge cases: EOF, close, EPIPE, EAGAIN, etc.
     */
    setupStdinMonitoring() {
        const stdin = process.stdin;
        // Track when stdin receives data (activity indicator)
        const onData = () => {
            this.recordActivity();
        };
        // Handle stdin end (Claude closed connection)
        // BUT: Don't trigger immediately on startup - stdin may not be ready yet
        // Use configurable grace period (default: 5 seconds)
        const onEnd = () => {
            const timestamp = this.formatTimestamp();
            const uptimeMs = Date.now() - this.monitoringStartTime;
            const gracePeriod = this.config.stdinGracePeriodMs;
            if (uptimeMs < gracePeriod) {
                // Too early - this might be a terminal/test run, not Claude
                logger.debug({ uptimeMs, gracePeriod, timestamp }, `[${timestamp}] ResilientTransport: stdin ended very early (${uptimeMs}ms < ${gracePeriod}ms grace period) - ignoring (likely terminal mode)`);
                return;
            }
            const errorDetail = {
                type: 'stdin_end',
                message: 'stdin stream ended - Claude may have closed the connection',
                timestamp,
                suggestion: this.getErrorSuggestion('stdin_end', ''),
            };
            logger.warn({
                uptimeMs,
                timestamp,
                error: errorDetail
            }, `[${timestamp}] ResilientTransport: stdin ended after ${Math.round(uptimeMs / 1000)}s - attempting recovery`);
            process.stderr.write(`[SPECMEM ${timestamp}] WARNING: stdin ended - ${errorDetail.suggestion}\n`);
            this.handleConnectionIssue('stdin_end', errorDetail);
        };
        // Handle stdin close
        const onClose = () => {
            if (this.shutdownInProgress)
                return;
            const timestamp = this.formatTimestamp();
            const uptimeMs = Date.now() - this.monitoringStartTime;
            const gracePeriod = this.config.stdinGracePeriodMs;
            if (uptimeMs < gracePeriod) {
                // Too early - ignore
                logger.debug({ uptimeMs, gracePeriod, timestamp }, `[${timestamp}] ResilientTransport: stdin closed very early (${uptimeMs}ms < ${gracePeriod}ms grace period) - ignoring`);
                return;
            }
            const errorDetail = {
                type: 'stdin_close',
                message: 'stdin stream closed unexpectedly',
                timestamp,
                suggestion: this.getErrorSuggestion('stdin_close', ''),
            };
            logger.warn({
                uptimeMs,
                timestamp,
                error: errorDetail
            }, `[${timestamp}] ResilientTransport: stdin closed unexpectedly after ${Math.round(uptimeMs / 1000)}s`);
            process.stderr.write(`[SPECMEM ${timestamp}] WARNING: stdin closed - ${errorDetail.suggestion}\n`);
            this.handleConnectionIssue('stdin_close', errorDetail);
        };
        // Handle stdin errors - includes EPIPE, EAGAIN, etc.
        const onError = (err) => {
            const timestamp = this.formatTimestamp();
            const errorDetail = {
                type: 'stdin_error',
                message: err.message,
                timestamp,
                suggestion: this.getErrorSuggestion('stdin_error', err.message),
                code: err.code,
                syscall: err.syscall,
            };
            // Store recent error for diagnostics
            this.recentErrors.push(errorDetail);
            if (this.recentErrors.length > this.MAX_RECENT_ERRORS) {
                this.recentErrors.shift();
            }
            logger.error({
                error: err.message,
                code: err.code,
                syscall: err.syscall,
                timestamp,
                errorDetail
            }, `[${timestamp}] ResilientTransport: stdin error - ${err.message}`);
            process.stderr.write(`[SPECMEM ${timestamp}] ERROR: stdin error (${err.code || 'unknown'}): ${err.message}\n`);
            this.recordError('stdin_error', err.message);
        };
        stdin.on('data', onData);
        stdin.on('end', onEnd);
        stdin.on('close', onClose);
        stdin.on('error', onError);
        // Store cleanup function
        this.stdinMonitor = () => {
            stdin.off('data', onData);
            stdin.off('end', onEnd);
            stdin.off('close', onClose);
            stdin.off('error', onError);
        };
    }
    /**
     * Setup stdout monitoring for write issues
     * Handles edge cases: EPIPE (broken pipe), EAGAIN, write errors
     */
    setupStdoutMonitoring() {
        const stdout = process.stdout;
        // Handle stdout errors (broken pipe, etc.)
        const onError = (err) => {
            const timestamp = this.formatTimestamp();
            // Determine error type based on message and code
            const isPipeError = err.message.includes('EPIPE') ||
                err.message.includes('pipe') ||
                err.code === 'EPIPE';
            const isEagain = err.message.includes('EAGAIN') || err.code === 'EAGAIN';
            const errorType = isPipeError ? 'stdout_pipe_broken' :
                isEagain ? 'stdout_eagain' : 'stdout_error';
            const errorDetail = {
                type: errorType,
                message: err.message,
                timestamp,
                suggestion: this.getErrorSuggestion(errorType, err.message),
                code: err.code,
                syscall: err.syscall,
            };
            // Store recent error for diagnostics
            this.recentErrors.push(errorDetail);
            if (this.recentErrors.length > this.MAX_RECENT_ERRORS) {
                this.recentErrors.shift();
            }
            if (isPipeError) {
                // EPIPE typically means Claude closed the connection - this is often fatal
                logger.warn({
                    error: err.message,
                    code: err.code,
                    timestamp,
                    errorDetail
                }, `[${timestamp}] ResilientTransport: stdout pipe broken (EPIPE) - Claude disconnected`);
                process.stderr.write(`[SPECMEM ${timestamp}] WARNING: Broken pipe - ${errorDetail.suggestion}\n`);
                this.handleConnectionIssue('stdout_pipe_broken', errorDetail);
            }
            else if (isEagain) {
                // EAGAIN is recoverable - just log and continue
                logger.debug({
                    error: err.message,
                    code: err.code,
                    timestamp
                }, `[${timestamp}] ResilientTransport: stdout EAGAIN - will retry`);
                this.recordError('stdout_eagain', err.message);
            }
            else {
                logger.error({
                    error: err.message,
                    code: err.code,
                    syscall: err.syscall,
                    timestamp,
                    errorDetail
                }, `[${timestamp}] ResilientTransport: stdout error - ${err.message}`);
                process.stderr.write(`[SPECMEM ${timestamp}] ERROR: stdout error (${err.code || 'unknown'}): ${err.message}\n`);
                this.recordError('stdout_error', err.message);
            }
        };
        // Handle stdout close
        const onClose = () => {
            if (this.shutdownInProgress)
                return;
            const timestamp = this.formatTimestamp();
            const errorDetail = {
                type: 'stdout_close',
                message: 'stdout stream closed unexpectedly',
                timestamp,
                suggestion: this.getErrorSuggestion('stdout_close', ''),
            };
            logger.warn({
                timestamp,
                errorDetail
            }, `[${timestamp}] ResilientTransport: stdout closed unexpectedly`);
            process.stderr.write(`[SPECMEM ${timestamp}] WARNING: stdout closed - ${errorDetail.suggestion}\n`);
            this.handleConnectionIssue('stdout_close', errorDetail);
        };
        stdout.on('error', onError);
        stdout.on('close', onClose);
        // Store cleanup function
        this.stdoutMonitor = () => {
            stdout.off('error', onError);
            stdout.off('close', onClose);
        };
    }
    /**
     * Start periodic health checks
     */
    startHealthChecks() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        this.healthCheckTimer = setInterval(() => {
            this.performHealthCheck();
        }, this.config.healthCheckIntervalMs);
        // Don't keep process alive just for health checks
        this.healthCheckTimer.unref();
    }
    /**
     * Perform a health check and emit status
     */
    performHealthCheck() {
        const timestamp = this.formatTimestamp();
        const health = this.getHealth();
        if (this.config.debugMode) {
            logger.debug({
                timestamp,
                state: health.state,
                lastActivityMs: health.lastActivityMs,
                errorCount: health.errorCount,
                recoveryAttempts: this.recoveryAttempts
            }, `[${timestamp}] ResilientTransport: health check (state=${health.state}, inactive=${Math.round(health.lastActivityMs / 1000)}s)`);
        }
        // Check for inactivity
        if (health.lastActivityMs > this.config.inactivityThresholdMs) {
            if (this.state === ConnectionState.CONNECTED) {
                this.state = ConnectionState.DEGRADED;
                logger.warn({
                    timestamp,
                    inactiveMs: health.lastActivityMs,
                    inactiveSec: Math.round(health.lastActivityMs / 1000),
                    thresholdMs: this.config.inactivityThresholdMs
                }, `[${timestamp}] ResilientTransport: connection DEGRADED - no activity for ${Math.round(health.lastActivityMs / 1000)}s (threshold: ${Math.round(this.config.inactivityThresholdMs / 1000)}s)`);
                process.stderr.write(`[SPECMEM ${timestamp}] WARNING: Connection degraded - no activity for ${Math.round(health.lastActivityMs / 1000)}s\n`);
                this.emit('degraded', health);
            }
        }
        else if (this.state === ConnectionState.DEGRADED || this.state === ConnectionState.RECOVERING) {
            // Activity resumed, upgrade state
            const previousState = this.state;
            this.state = ConnectionState.CONNECTED;
            this.recoveryAttempts = 0; // Reset recovery counter on successful connection
            logger.info({
                timestamp,
                previousState,
                recoveryAttempts: this.recoveryAttempts
            }, `[${timestamp}] ResilientTransport: connection RESTORED from ${previousState}`);
            process.stderr.write(`[SPECMEM ${timestamp}] Connection restored from ${previousState}\n`);
            this.emit('restored', health);
            // CRITICAL: Trigger connection recovery callback
            // This re-sends tool list notifications to Claude, fixing "not connected" issues
            this.triggerConnectionRecovery();
        }
        // Check error count
        if (health.errorCount >= this.config.maxErrorsBeforeShutdown) {
            const errorDetail = {
                type: 'max_errors_exceeded',
                message: `Error threshold exceeded: ${health.errorCount}/${this.config.maxErrorsBeforeShutdown}`,
                timestamp,
                suggestion: this.getErrorSuggestion('max_errors_exceeded', ''),
            };
            logger.error({
                timestamp,
                errorCount: health.errorCount,
                maxErrors: this.config.maxErrorsBeforeShutdown,
                recentErrors: this.recentErrors.slice(-5),
                errorDetail
            }, `[${timestamp}] ResilientTransport: ERROR THRESHOLD EXCEEDED (${health.errorCount}/${this.config.maxErrorsBeforeShutdown}) - shutting down`);
            process.stderr.write(`[SPECMEM ${timestamp}] ERROR: Too many errors (${health.errorCount}/${this.config.maxErrorsBeforeShutdown}) - ${errorDetail.suggestion}\n`);
            this.handleConnectionLoss('max_errors_exceeded', errorDetail);
        }
        this.emit('health', health);
    }
    /**
     * Trigger connection recovery - re-sends tool list notifications
     */
    async triggerConnectionRecovery() {
        if (this.connectionRecoveryCallback) {
            try {
                logger.info('ResilientTransport: triggering connection recovery callback');
                await this.connectionRecoveryCallback();
                logger.info('ResilientTransport: connection recovery complete - tools should be available');
            }
            catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                logger.warn({ error: error.message }, 'ResilientTransport: connection recovery callback failed');
            }
        }
    }
    /**
     * Record that activity occurred (message sent/received)
     */
    recordActivity() {
        this.lastActivityTime = Date.now();
        // If we were degraded, check if we should restore
        if (this.state === ConnectionState.DEGRADED) {
            this.state = ConnectionState.CONNECTED;
            logger.info('ResilientTransport: activity detected - connection restored');
            this.emit('restored', this.getHealth());
            // CRITICAL: Trigger connection recovery callback
            this.triggerConnectionRecovery();
        }
    }
    /**
     * Record an error for tracking
     */
    recordError(type, message) {
        this.errorCount++;
        logger.warn({
            errorType: type,
            message,
            totalErrors: this.errorCount,
            maxErrors: this.config.maxErrorsBeforeShutdown
        }, 'ResilientTransport: error recorded');
        this.emit('error', { type, message, count: this.errorCount });
        // Check if we've hit the error threshold
        if (this.errorCount >= this.config.maxErrorsBeforeShutdown) {
            this.performHealthCheck();
        }
    }
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
    handleConnectionIssue(reason, errorDetail) {
        const timestamp = this.formatTimestamp();
        // If already shutting down, skip
        if (this.shutdownInProgress) {
            logger.debug({ reason, timestamp }, `[${timestamp}] ResilientTransport: ignoring ${reason} - shutdown in progress`);
            return;
        }
        // If recovery is disabled, go straight to shutdown
        if (!this.config.recoveryEnabled) {
            logger.info({ reason, timestamp }, `[${timestamp}] ResilientTransport: recovery disabled - escalating to shutdown`);
            this.handleConnectionLoss(reason, errorDetail);
            return;
        }
        // If we've exhausted recovery attempts, give up
        if (this.recoveryAttempts >= this.config.recoveryMaxAttempts) {
            const exhaustedError = {
                type: 'recovery_exhausted',
                message: `All ${this.config.recoveryMaxAttempts} recovery attempts failed for: ${reason}`,
                timestamp,
                suggestion: this.getErrorSuggestion('recovery_exhausted', ''),
            };
            logger.error({
                timestamp,
                reason,
                recoveryAttempts: this.recoveryAttempts,
                maxAttempts: this.config.recoveryMaxAttempts,
                recentErrors: this.recentErrors.slice(-3)
            }, `[${timestamp}] ResilientTransport: RECOVERY EXHAUSTED after ${this.recoveryAttempts} attempts - shutting down`);
            process.stderr.write(`[SPECMEM ${timestamp}] ERROR: Recovery exhausted after ${this.recoveryAttempts} attempts - ${exhaustedError.suggestion}\n`);
            this.handleConnectionLoss('recovery_exhausted', exhaustedError);
            return;
        }
        // Enter recovery state
        if (this.state !== ConnectionState.RECOVERING) {
            this.state = ConnectionState.RECOVERING;
            logger.info({
                timestamp,
                reason,
                previousState: this.state
            }, `[${timestamp}] ResilientTransport: entering RECOVERY state due to: ${reason}`);
        }
        // Increment recovery attempt counter
        this.recoveryAttempts++;
        this.lastRecoveryTime = Date.now();
        // Calculate backoff delay
        const backoffDelay = this.calculateBackoffDelay(this.recoveryAttempts - 1);
        logger.info({
            timestamp,
            reason,
            attempt: this.recoveryAttempts,
            maxAttempts: this.config.recoveryMaxAttempts,
            backoffDelayMs: backoffDelay,
            backoffDelaySec: Math.round(backoffDelay / 1000)
        }, `[${timestamp}] ResilientTransport: RECOVERY attempt ${this.recoveryAttempts}/${this.config.recoveryMaxAttempts} - waiting ${Math.round(backoffDelay / 1000)}s before retry`);
        process.stderr.write(`[SPECMEM ${timestamp}] Recovery attempt ${this.recoveryAttempts}/${this.config.recoveryMaxAttempts} - waiting ${Math.round(backoffDelay / 1000)}s\n`);
        // Emit recovery event for listeners
        this.emit('recovering', {
            reason,
            attempt: this.recoveryAttempts,
            maxAttempts: this.config.recoveryMaxAttempts,
            backoffDelayMs: backoffDelay,
            timestamp
        });
        // Clear any existing recovery timer
        if (this.recoveryTimer) {
            clearTimeout(this.recoveryTimer);
        }
        // Schedule recovery check after backoff delay
        this.recoveryTimer = setTimeout(() => {
            this.attemptRecovery(reason, errorDetail);
        }, backoffDelay);
        // Don't keep process alive just for recovery timer
        this.recoveryTimer.unref();
    }
    /**
     * Attempt to recover the connection after backoff delay
     */
    async attemptRecovery(originalReason, originalError) {
        const timestamp = this.formatTimestamp();
        // Check if we're still in recovery state
        if (this.state !== ConnectionState.RECOVERING) {
            logger.debug({
                timestamp,
                state: this.state
            }, `[${timestamp}] ResilientTransport: no longer in recovery state - skipping attempt`);
            return;
        }
        // Check if stdin/stdout are still open
        const stdinOpen = !process.stdin.destroyed;
        const stdoutOpen = !process.stdout.destroyed;
        logger.info({
            timestamp,
            attempt: this.recoveryAttempts,
            stdinOpen,
            stdoutOpen
        }, `[${timestamp}] ResilientTransport: checking connection status (stdin=${stdinOpen}, stdout=${stdoutOpen})`);
        // If both streams are still open, try the recovery callback
        if (stdinOpen && stdoutOpen) {
            try {
                logger.info({ timestamp }, `[${timestamp}] ResilientTransport: attempting connection recovery...`);
                process.stderr.write(`[SPECMEM ${timestamp}] Attempting connection recovery...\n`);
                await this.triggerConnectionRecovery();
                // If we get here without error, recovery might have worked
                // Transition back to connected state
                this.state = ConnectionState.CONNECTED;
                this.recoveryAttempts = 0;
                logger.info({
                    timestamp,
                    previousAttempts: this.recoveryAttempts
                }, `[${timestamp}] ResilientTransport: RECOVERY SUCCESSFUL - connection restored`);
                process.stderr.write(`[SPECMEM ${timestamp}] Recovery successful - connection restored\n`);
                this.emit('restored', this.getHealth());
                return;
            }
            catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                logger.warn({
                    timestamp,
                    error: error.message,
                    attempt: this.recoveryAttempts
                }, `[${timestamp}] ResilientTransport: recovery callback failed - ${error.message}`);
                // Continue to next attempt
                this.handleConnectionIssue(originalReason, originalError);
                return;
            }
        }
        // If streams are closed, recovery is not possible
        logger.warn({
            timestamp,
            stdinOpen,
            stdoutOpen,
            reason: 'streams_closed'
        }, `[${timestamp}] ResilientTransport: cannot recover - streams are closed`);
        // Try another recovery attempt if we have attempts left
        if (this.recoveryAttempts < this.config.recoveryMaxAttempts) {
            this.handleConnectionIssue(originalReason, originalError);
        }
        else {
            this.handleConnectionLoss('recovery_failed_streams_closed', originalError);
        }
    }
    /**
     * Handle detected connection loss - final shutdown path
     * This is called when recovery is disabled or all recovery attempts have failed
     */
    handleConnectionLoss(reason, errorDetail) {
        const timestamp = this.formatTimestamp();
        if (this.shutdownInProgress) {
            logger.debug({ reason, timestamp }, `[${timestamp}] ResilientTransport: ignoring ${reason} - shutdown already in progress`);
            return; // Already handling shutdown
        }
        this.shutdownInProgress = true;
        this.state = ConnectionState.DISCONNECTING;
        logger.warn({
            timestamp,
            reason,
            errorDetail,
            recoveryAttempts: this.recoveryAttempts,
            recentErrors: this.recentErrors.slice(-3)
        }, `[${timestamp}] ResilientTransport: CONNECTION LOST (${reason}) - initiating graceful shutdown`);
        process.stderr.write(`[SPECMEM ${timestamp}] Connection lost: ${reason} - shutting down gracefully\n`);
        if (errorDetail) {
            process.stderr.write(`[SPECMEM ${timestamp}] ${errorDetail.suggestion}\n`);
        }
        this.emit('disconnecting', { reason, errorDetail, timestamp });
        // Give a short time for any pending operations (configurable)
        setTimeout(() => {
            this.shutdown();
        }, this.config.shutdownGracePeriodMs);
    }
    /**
     * Get current connection health
     */
    getHealth() {
        const now = Date.now();
        const timestamp = this.formatTimestamp();
        const lastActivityMs = now - this.lastActivityTime;
        let warningMessage = null;
        if (this.state === ConnectionState.RECOVERING) {
            warningMessage = `Recovery in progress (attempt ${this.recoveryAttempts}/${this.config.recoveryMaxAttempts})`;
        }
        else if (lastActivityMs > this.config.inactivityThresholdMs) {
            warningMessage = `No activity for ${Math.round(lastActivityMs / 1000)}s (threshold: ${Math.round(this.config.inactivityThresholdMs / 1000)}s)`;
        }
        else if (this.errorCount > 0) {
            warningMessage = `${this.errorCount} errors recorded (max: ${this.config.maxErrorsBeforeShutdown})`;
        }
        return {
            state: this.state,
            stdinOpen: !process.stdin.destroyed,
            stdoutOpen: !process.stdout.destroyed,
            lastActivityMs,
            errorCount: this.errorCount,
            warningMessage,
            timestamp,
            recoveryAttempts: this.recoveryAttempts,
        };
    }
    /**
     * Get current connection state
     */
    getState() {
        return this.state;
    }
    /**
     * Check if connection is healthy
     */
    isHealthy() {
        return this.state === ConnectionState.CONNECTED;
    }
    /**
     * Check if connection is usable (connected or degraded)
     */
    isUsable() {
        return this.state === ConnectionState.CONNECTED || this.state === ConnectionState.DEGRADED;
    }
    /**
     * Shutdown monitoring and cleanup
     */
    shutdown() {
        const timestamp = this.formatTimestamp();
        if (this.state === ConnectionState.DISCONNECTED) {
            logger.debug({ timestamp }, `[${timestamp}] ResilientTransport: already shut down - skipping`);
            return; // Already shutdown
        }
        logger.info({
            timestamp,
            previousState: this.state,
            errorCount: this.errorCount,
            recoveryAttempts: this.recoveryAttempts,
            uptimeMs: Date.now() - this.monitoringStartTime,
            uptimeSec: Math.round((Date.now() - this.monitoringStartTime) / 1000)
        }, `[${timestamp}] ResilientTransport: shutting down (was ${this.state}, uptime ${Math.round((Date.now() - this.monitoringStartTime) / 1000)}s)`);
        process.stderr.write(`[SPECMEM ${timestamp}] Transport shutting down (uptime: ${Math.round((Date.now() - this.monitoringStartTime) / 1000)}s)\n`);
        this.state = ConnectionState.DISCONNECTED;
        this.shutdownInProgress = true;
        // Stop health checks
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
        // Stop keepalive timer
        if (this.keepaliveTimer) {
            clearInterval(this.keepaliveTimer);
            this.keepaliveTimer = null;
        }
        // Stop recovery timer
        if (this.recoveryTimer) {
            clearTimeout(this.recoveryTimer);
            this.recoveryTimer = null;
        }
        // Clear callbacks
        this.keepaliveCallback = null;
        this.connectionRecoveryCallback = null;
        // Remove stdin listeners
        if (this.stdinMonitor) {
            this.stdinMonitor();
            this.stdinMonitor = null;
        }
        // Remove stdout listeners
        if (this.stdoutMonitor) {
            this.stdoutMonitor();
            this.stdoutMonitor = null;
        }
        this.emit('disconnected');
        logger.info({ timestamp }, `[${timestamp}] ResilientTransport: shutdown complete`);
        process.stderr.write(`[SPECMEM ${timestamp}] Transport shutdown complete\n`);
    }
    /**
     * Reset error count (e.g., after successful recovery)
     */
    resetErrors() {
        const timestamp = this.formatTimestamp();
        const previousCount = this.errorCount;
        this.errorCount = 0;
        this.recoveryAttempts = 0;
        if (previousCount > 0) {
            logger.info({
                timestamp,
                previousErrorCount: previousCount
            }, `[${timestamp}] ResilientTransport: error count reset (was ${previousCount})`);
        }
    }
    /**
     * Get recent errors for debugging
     */
    getRecentErrors() {
        return [...this.recentErrors];
    }
    /**
     * Check if currently in recovery state
     */
    isRecovering() {
        return this.state === ConnectionState.RECOVERING;
    }
    /**
     * Get current recovery status
     */
    getRecoveryStatus() {
        return {
            isRecovering: this.state === ConnectionState.RECOVERING,
            attempts: this.recoveryAttempts,
            maxAttempts: this.config.recoveryMaxAttempts,
            lastRecoveryTime: this.lastRecoveryTime,
        };
    }
}
// Singleton instance for global access
let resilientTransportInstance = null;
/**
 * Get or create the resilient transport singleton
 */
export function getResilientTransport(config) {
    if (!resilientTransportInstance) {
        resilientTransportInstance = new ResilientTransport(config);
    }
    return resilientTransportInstance;
}
/**
 * Reset the resilient transport (for testing or restart)
 */
export function resetResilientTransport() {
    if (resilientTransportInstance) {
        resilientTransportInstance.shutdown();
        resilientTransportInstance = null;
    }
}
//# sourceMappingURL=resilientTransport.js.map