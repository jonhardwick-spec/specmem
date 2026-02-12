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
import { existsSync } from 'fs';
import { createConnection } from 'net';
import { logger } from '../utils/logger.js';
import { ConnectionState } from './resilientTransport.js';
import { getEmbeddingTimeout } from '../config/embeddingTimeouts.js';
import { getEmbeddingSocketPath, getProjectPath } from '../config.js';
// Health status for individual components
export var ComponentHealth;
(function (ComponentHealth) {
    ComponentHealth["HEALTHY"] = "healthy";
    ComponentHealth["DEGRADED"] = "degraded";
    ComponentHealth["UNHEALTHY"] = "unhealthy";
    ComponentHealth["UNKNOWN"] = "unknown";
})(ComponentHealth || (ComponentHealth = {}));
const DEFAULT_CONFIG = {
    checkIntervalMs: parseInt(process.env['SPECMEM_HEALTH_CHECK_INTERVAL_MS'] || process.env['SPECMEM_HEALTH_CHECK_INTERVAL'] || '30000', 10),
    // Adaptive interval for unhealthy state (Issue #16)
    unhealthyCheckIntervalMs: parseInt(process.env['SPECMEM_HEALTH_CHECK_UNHEALTHY_INTERVAL_MS'] || '5000', 10),
    dbTimeoutMs: parseInt(process.env['SPECMEM_HEALTH_DB_TIMEOUT'] || '5000', 10),
    // Use unified timeout config for embedding health checks
    embeddingTimeoutMs: getEmbeddingTimeout('health'),
    unhealthyThreshold: parseInt(process.env['SPECMEM_HEALTH_UNHEALTHY_THRESHOLD'] || '3', 10),
    recoveryThreshold: parseInt(process.env['SPECMEM_HEALTH_RECOVERY_THRESHOLD'] || '2', 10),
    autoRecoveryEnabled: process.env['SPECMEM_HEALTH_AUTO_RECOVERY'] !== 'false',
    recoveryIntervalMs: parseInt(process.env['SPECMEM_HEALTH_RECOVERY_INTERVAL'] || '60000', 10),
    logHealthStatus: process.env['SPECMEM_HEALTH_LOG_STATUS'] !== 'false',
    logIntervalMs: parseInt(process.env['SPECMEM_HEALTH_LOG_INTERVAL'] || '300000', 10) // 5 minutes
};
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
export class HealthMonitor extends EventEmitter {
    config;
    startTime;
    checkTimer = null;
    logTimer = null;
    isRunning = false;
    // Issue #16: Concurrency guard - prevents overlapping health checks
    isCheckRunning = false;
    // Issue #16: Diagnostics
    totalHealthChecks = 0;
    lastCheckTimestamp = 0;
    // Issue #16: Adaptive interval tracking
    currentCheckIntervalMs = 0;
    consecutiveHealthyChecks = 0;
    // Component references
    resilientTransport = null;
    database = null;
    embeddingSocketPath = null;
    // Health tracking per component
    transportHealth;
    databaseHealth;
    embeddingHealth;
    // Recovery tracking
    lastRecoveryAttempt = {};
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.startTime = Date.now();
        // Initialize component health tracking
        this.transportHealth = this.createInitialHealth('transport');
        this.databaseHealth = this.createInitialHealth('database');
        this.embeddingHealth = this.createInitialHealth('embedding');
        // Issue #16: Initialize adaptive interval to healthy rate
        this.currentCheckIntervalMs = this.config.checkIntervalMs;
        logger.info({
            checkIntervalMs: this.config.checkIntervalMs,
            unhealthyCheckIntervalMs: this.config.unhealthyCheckIntervalMs,
            autoRecoveryEnabled: this.config.autoRecoveryEnabled,
            logHealthStatus: this.config.logHealthStatus
        }, '[HealthMonitor] Initialized with config');
    }
    createInitialHealth(component) {
        return {
            component,
            health: ComponentHealth.UNKNOWN,
            lastCheckTime: 0,
            lastSuccessTime: null,
            errorCount: 0,
            lastError: null,
            details: {}
        };
    }
    /**
     * Set the resilient transport for monitoring
     */
    setTransport(transport) {
        this.resilientTransport = transport;
        logger.debug('[HealthMonitor] Transport reference set');
    }
    /**
     * Set the database manager for monitoring
     */
    setDatabase(db) {
        this.database = db;
        logger.debug('[HealthMonitor] Database reference set');
    }
    /**
     * Set the embedding socket path for monitoring
     */
    setEmbeddingSocketPath(socketPath) {
        this.embeddingSocketPath = socketPath;
        logger.debug({ socketPath }, '[HealthMonitor] Embedding socket path set');
    }
    /**
     * Start the health monitoring loop
     *
     * Issue #16: Uses setTimeout + recursive scheduling instead of setInterval
     * to prevent check stacking when a health check takes longer than the interval.
     * Uses adaptive intervals: faster checks when unhealthy, slower when healthy.
     */
    start() {
        if (this.isRunning) {
            logger.warn('[HealthMonitor] Already running');
            return;
        }
        this.isRunning = true;
        this.startTime = Date.now();
        this.currentCheckIntervalMs = this.config.checkIntervalMs;
        // Issue #16: Start recursive setTimeout-based health check loop
        this.scheduleNextHealthCheck();
        // Start periodic health logging if enabled
        if (this.config.logHealthStatus) {
            this.logTimer = setInterval(() => {
                this.logHealthStatus();
            }, this.config.logIntervalMs);
            this.logTimer.unref();
        }
        // Run initial health check immediately
        this.runHealthChecks().catch(err => {
            logger.error({ error: err }, '[HealthMonitor] Initial health check error');
        });
        logger.info({
            initialIntervalMs: this.currentCheckIntervalMs,
            unhealthyIntervalMs: this.config.unhealthyCheckIntervalMs,
        }, '[HealthMonitor] Health monitoring started (adaptive setTimeout scheduling)');
    }
    /**
     * Issue #16: Schedule the next health check using setTimeout (prevents stacking)
     * Each check schedules the next one after completing, so checks never overlap from the timer.
     */
    scheduleNextHealthCheck() {
        if (!this.isRunning) {
            return;
        }
        // Clear any existing timer to prevent duplicates
        if (this.checkTimer) {
            clearTimeout(this.checkTimer);
            this.checkTimer = null;
        }
        this.checkTimer = setTimeout(async () => {
            if (!this.isRunning) return;
            try {
                await this.runHealthChecks();
            }
            catch (err) {
                logger.error({ error: err }, '[HealthMonitor] Health check error');
            }
            // Schedule the next check (recursive scheduling)
            this.scheduleNextHealthCheck();
        }, this.currentCheckIntervalMs);
        this.checkTimer.unref();
    }
    /**
     * Stop the health monitoring loop
     */
    stop() {
        if (!this.isRunning) {
            return;
        }
        this.isRunning = false;
        // Issue #16: checkTimer is now a setTimeout, use clearTimeout
        if (this.checkTimer) {
            clearTimeout(this.checkTimer);
            this.checkTimer = null;
        }
        if (this.logTimer) {
            clearInterval(this.logTimer);
            this.logTimer = null;
        }
        logger.info({
            totalHealthChecks: this.totalHealthChecks,
            lastCheckTimestamp: this.lastCheckTimestamp > 0 ? new Date(this.lastCheckTimestamp).toISOString() : null,
            uptimeMs: Date.now() - this.startTime,
        }, '[HealthMonitor] Health monitoring stopped');
    }
    /**
     * Issue #16: Full cleanup/destroy method for graceful shutdown
     * Stops all timers, removes all listeners, and resets all state.
     */
    destroy() {
        this.stop();
        this.removeAllListeners();
        this.resilientTransport = null;
        this.database = null;
        this.embeddingSocketPath = null;
        this.isCheckRunning = false;
        this.totalHealthChecks = 0;
        this.lastCheckTimestamp = 0;
        this.consecutiveHealthyChecks = 0;
        logger.info('[HealthMonitor] Destroyed - all resources released');
    }
    /**
     * Run all health checks (non-blocking)
     *
     * Issue #16: Added concurrency guard to prevent overlapping checks,
     * diagnostic counters, and adaptive interval adjustment.
     */
    async runHealthChecks() {
        // Issue #16: Concurrency guard - prevent overlapping health checks
        if (this.isCheckRunning) {
            logger.debug('[HealthMonitor] Health check already in progress, skipping to prevent stacking');
            return this.getSystemHealth();
        }
        this.isCheckRunning = true;
        try {
            const checkPromises = [
                this.checkTransportHealth(),
                this.checkDatabaseHealth(),
                this.checkEmbeddingHealth()
            ];
            // Run all checks in parallel - they shouldn't block each other
            await Promise.allSettled(checkPromises);
            // Issue #16: Update diagnostics
            this.totalHealthChecks++;
            this.lastCheckTimestamp = Date.now();
            // Calculate overall health
            const result = this.getSystemHealth();
            // Issue #16: Adaptive interval adjustment
            this.adjustCheckInterval(result.overallHealth);
            // Emit health event
            this.emit('health', result);
            // Check for auto-recovery needs
            if (this.config.autoRecoveryEnabled) {
                await this.attemptAutoRecovery();
            }
            return result;
        }
        finally {
            this.isCheckRunning = false;
        }
    }
    /**
     * Issue #16: Adjust the check interval based on current system health
     *
     * - Healthy: use normal interval (SPECMEM_HEALTH_CHECK_INTERVAL_MS, default 30s)
     * - Unhealthy: use fast interval (SPECMEM_HEALTH_CHECK_UNHEALTHY_INTERVAL_MS, default 5s)
     * - Recovering: gradually increase from unhealthy to healthy interval
     *   (each consecutive healthy check increases interval by 25% toward the healthy rate)
     */
    adjustCheckInterval(overallHealth) {
        const healthyInterval = this.config.checkIntervalMs;
        const unhealthyInterval = this.config.unhealthyCheckIntervalMs;
        const previousInterval = this.currentCheckIntervalMs;
        if (overallHealth === ComponentHealth.UNHEALTHY) {
            // Unhealthy: switch to fast polling immediately
            this.currentCheckIntervalMs = unhealthyInterval;
            this.consecutiveHealthyChecks = 0;
        }
        else if (overallHealth === ComponentHealth.DEGRADED) {
            // Degraded: use midpoint between unhealthy and healthy
            this.currentCheckIntervalMs = Math.round((unhealthyInterval + healthyInterval) / 2);
            this.consecutiveHealthyChecks = 0;
        }
        else if (overallHealth === ComponentHealth.HEALTHY) {
            this.consecutiveHealthyChecks++;
            if (this.currentCheckIntervalMs < healthyInterval) {
                // Recovering: gradually increase interval back to healthy rate
                // Each consecutive healthy check moves 25% closer to the healthy interval
                const step = (healthyInterval - this.currentCheckIntervalMs) * 0.25;
                this.currentCheckIntervalMs = Math.round(
                    Math.min(this.currentCheckIntervalMs + Math.max(step, 1000), healthyInterval)
                );
            }
            else {
                this.currentCheckIntervalMs = healthyInterval;
            }
        }
        // Log interval changes
        if (previousInterval !== this.currentCheckIntervalMs) {
            logger.info({
                previousIntervalMs: previousInterval,
                newIntervalMs: this.currentCheckIntervalMs,
                overallHealth,
                consecutiveHealthyChecks: this.consecutiveHealthyChecks,
            }, '[HealthMonitor] Adaptive interval adjusted');
        }
    }
    /**
     * Check transport health
     */
    async checkTransportHealth() {
        const now = Date.now();
        this.transportHealth.lastCheckTime = now;
        try {
            if (!this.resilientTransport) {
                this.updateComponentHealth(this.transportHealth, ComponentHealth.UNKNOWN, 'Transport not set');
                return;
            }
            const transportHealth = this.resilientTransport.getHealth();
            // Map transport state to component health
            let health;
            let details = {
                state: transportHealth.state,
                stdinOpen: transportHealth.stdinOpen,
                stdoutOpen: transportHealth.stdoutOpen,
                lastActivityMs: transportHealth.lastActivityMs,
                errorCount: transportHealth.errorCount
            };
            switch (transportHealth.state) {
                case ConnectionState.CONNECTED:
                    health = ComponentHealth.HEALTHY;
                    break;
                case ConnectionState.DEGRADED:
                    health = ComponentHealth.DEGRADED;
                    break;
                case ConnectionState.DISCONNECTING:
                case ConnectionState.DISCONNECTED:
                    health = ComponentHealth.UNHEALTHY;
                    break;
                default:
                    health = ComponentHealth.UNKNOWN;
            }
            this.updateComponentHealth(this.transportHealth, health, null, details);
        }
        catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            this.updateComponentHealth(this.transportHealth, ComponentHealth.UNHEALTHY, error);
        }
    }
    /**
     * Check database health with timeout
     */
    async checkDatabaseHealth() {
        const now = Date.now();
        this.databaseHealth.lastCheckTime = now;
        try {
            if (!this.database) {
                this.updateComponentHealth(this.databaseHealth, ComponentHealth.UNKNOWN, 'Database not set');
                return;
            }
            // Run a simple query with timeout
            const queryPromise = this.database.query('SELECT 1 as health_check');
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Database health check timeout')), this.config.dbTimeoutMs));
            const result = await Promise.race([queryPromise, timeoutPromise]);
            // Get pool stats for detailed health info
            const stats = await this.database.getStats();
            const details = {
                poolTotal: stats.total,
                poolIdle: stats.idle,
                poolWaiting: stats.waiting,
                querySucceeded: true
            };
            // Check for degraded state (high waiting count)
            if (stats.waiting > stats.total / 2) {
                this.updateComponentHealth(this.databaseHealth, ComponentHealth.DEGRADED, null, details);
            }
            else {
                this.updateComponentHealth(this.databaseHealth, ComponentHealth.HEALTHY, null, details);
            }
        }
        catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            this.updateComponentHealth(this.databaseHealth, ComponentHealth.UNHEALTHY, error);
        }
    }
    /**
     * Check embedding socket health
     */
    async checkEmbeddingHealth() {
        const now = Date.now();
        this.embeddingHealth.lastCheckTime = now;
        try {
            // First check if socket path exists
            const socketPath = this.embeddingSocketPath || this.getDefaultEmbeddingSocketPath();
            if (!socketPath) {
                this.updateComponentHealth(this.embeddingHealth, ComponentHealth.UNKNOWN, 'Socket path not configured');
                return;
            }
            if (!existsSync(socketPath)) {
                this.updateComponentHealth(this.embeddingHealth, ComponentHealth.UNHEALTHY, 'Socket file does not exist', {
                    socketPath,
                    socketExists: false
                });
                return;
            }
            // Try to connect and send a dimension query (lightweight health check)
            const checkResult = await this.pingEmbeddingSocket(socketPath);
            if (checkResult.success) {
                this.updateComponentHealth(this.embeddingHealth, ComponentHealth.HEALTHY, null, {
                    socketPath,
                    socketExists: true,
                    responseTime: checkResult.responseTimeMs,
                    nativeDimensions: checkResult.nativeDimensions,
                    targetDimensions: checkResult.targetDimensions
                });
            }
            else {
                this.updateComponentHealth(this.embeddingHealth, ComponentHealth.UNHEALTHY, checkResult.error, {
                    socketPath,
                    socketExists: true
                });
            }
        }
        catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            this.updateComponentHealth(this.embeddingHealth, ComponentHealth.UNHEALTHY, error);
        }
    }
    /**
     * Ping the embedding socket to verify it's responsive
     */
    pingEmbeddingSocket(socketPath) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const socket = createConnection(socketPath);
            let buffer = '';
            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    socket.destroy();
                    resolve({ success: false, error: 'Socket connection timeout' });
                }
            }, this.config.embeddingTimeoutMs);
            socket.on('connect', () => {
                // Send dimension query as health check
                socket.write(JSON.stringify({ type: 'get_dimension' }) + '\n');
            });
            socket.on('data', (data) => {
                buffer += data.toString();
                const newlineIndex = buffer.indexOf('\n');
                if (newlineIndex !== -1) {
                    clearTimeout(timeout);
                    if (resolved)
                        return;
                    resolved = true;
                    const responseTimeMs = Date.now() - startTime;
                    try {
                        const response = JSON.parse(buffer.slice(0, newlineIndex));
                        socket.end();
                        resolve({
                            success: true,
                            responseTimeMs,
                            nativeDimensions: response.native_dimensions,
                            targetDimensions: response.target_dimensions
                        });
                    }
                    catch (parseErr) {
                        socket.end();
                        resolve({ success: false, error: 'Invalid response from embedding socket' });
                    }
                }
            });
            socket.on('error', (err) => {
                clearTimeout(timeout);
                if (!resolved) {
                    resolved = true;
                    resolve({ success: false, error: `Socket error: ${err.message}` });
                }
            });
            socket.on('close', () => {
                clearTimeout(timeout);
                if (!resolved) {
                    resolved = true;
                    resolve({ success: false, error: 'Socket closed unexpectedly' });
                }
            });
        });
    }
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
    getDefaultEmbeddingSocketPath() {
        // Delegate to centralized config - handles all path detection, priority, and connectivity testing
        const socketPath = getEmbeddingSocketPath();
        logger.debug({ socketPath }, '[HealthMonitor] Using centralized socket path detection');
        return socketPath;
    }
    /**
     * Quick synchronous-ish socket connectivity test
     * Returns true if socket appears connectable, false otherwise
     * Uses very short timeout to avoid blocking
     */
    quickSocketTest(socketPath) {
        try {
            // Use a synchronous-style check: create connection and see if it errors immediately
            // This catches obvious failures like "connection refused" or "no such file"
            const net = require('net');
            let connected = false;
            let testComplete = false;
            const socket = net.createConnection(socketPath);
            // Very short timeout - we just want to know if it connects at all
            socket.setTimeout(100);
            socket.on('connect', () => {
                connected = true;
                testComplete = true;
                socket.destroy();
            });
            socket.on('error', () => {
                testComplete = true;
                socket.destroy();
            });
            socket.on('timeout', () => {
                testComplete = true;
                socket.destroy();
            });
            // For synchronous-style behavior, we'll use a spin wait with very short duration
            // This is acceptable because we have a 100ms timeout max
            const startTime = Date.now();
            const maxWait = 150; // 150ms max wait
            // Use setImmediate-based polling in a way that's compatible with sync context
            // We'll return optimistically for async contexts
            // For the initial check, if the file exists and is a socket, assume it might work
            const fs = require('fs');
            try {
                const stats = fs.statSync(socketPath);
                if (stats.isSocket()) {
                    // File is a socket, destroy our test connection and return true
                    // The full health check will verify connectivity properly
                    socket.destroy();
                    return true;
                }
            }
            catch {
                // Can't stat, probably not accessible
                socket.destroy();
                return false;
            }
            socket.destroy();
            return false;
        }
        catch {
            return false;
        }
    }
    /**
     * Update component health status and emit events if changed
     */
    updateComponentHealth(component, newHealth, error, details = {}) {
        const previousHealth = component.health;
        component.health = newHealth;
        component.details = details;
        if (error) {
            component.errorCount++;
            component.lastError = error;
        }
        else {
            component.errorCount = 0;
            component.lastError = null;
            component.lastSuccessTime = Date.now();
        }
        // Emit events on health state changes
        if (previousHealth !== newHealth) {
            if (newHealth === ComponentHealth.DEGRADED) {
                this.emit('degraded', { component: component.component, result: { ...component } });
                logger.warn({
                    component: component.component,
                    previousHealth,
                    newHealth,
                    error
                }, '[HealthMonitor] Component degraded');
            }
            else if (newHealth === ComponentHealth.UNHEALTHY) {
                this.emit('unhealthy', { component: component.component, result: { ...component } });
                logger.error({
                    component: component.component,
                    previousHealth,
                    newHealth,
                    error
                }, '[HealthMonitor] Component unhealthy');
            }
            else if (newHealth === ComponentHealth.HEALTHY && previousHealth !== ComponentHealth.UNKNOWN) {
                this.emit('recovered', { component: component.component, result: { ...component } });
                logger.info({
                    component: component.component,
                    previousHealth,
                    newHealth
                }, '[HealthMonitor] Component recovered');
            }
        }
    }
    /**
     * Attempt auto-recovery for failed components
     */
    async attemptAutoRecovery() {
        const now = Date.now();
        // Check if database needs recovery
        if (this.databaseHealth.health === ComponentHealth.UNHEALTHY &&
            this.databaseHealth.errorCount >= this.config.recoveryThreshold) {
            if (this.shouldAttemptRecovery('database', now)) {
                await this.recoverDatabase();
            }
        }
        // Check if embedding needs recovery (we can't restart it, but we can log a warning)
        if (this.embeddingHealth.health === ComponentHealth.UNHEALTHY &&
            this.embeddingHealth.errorCount >= this.config.recoveryThreshold) {
            if (this.shouldAttemptRecovery('embedding', now)) {
                await this.recoverEmbedding();
            }
        }
        // Transport recovery is handled by ResilientTransport itself
    }
    shouldAttemptRecovery(component, now) {
        const lastAttempt = this.lastRecoveryAttempt[component] || 0;
        return (now - lastAttempt) >= this.config.recoveryIntervalMs;
    }
    /**
     * Attempt to recover database connection
     */
    async recoverDatabase() {
        const now = Date.now();
        this.lastRecoveryAttempt['database'] = now;
        logger.info('[HealthMonitor] Attempting database recovery...');
        try {
            if (!this.database) {
                logger.warn('[HealthMonitor] No database reference for recovery');
                this.emit('recovery_attempted', { component: 'database', success: false });
                return;
            }
            // Try to re-run a query to force connection pool refresh
            await this.database.query('SELECT 1');
            logger.info('[HealthMonitor] Database recovery successful');
            this.emit('recovery_attempted', { component: 'database', success: true });
            // Mark as healthy
            this.updateComponentHealth(this.databaseHealth, ComponentHealth.HEALTHY, null, {
                recoveredAt: new Date().toISOString()
            });
        }
        catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            logger.error({ error }, '[HealthMonitor] Database recovery failed');
            this.emit('recovery_attempted', { component: 'database', success: false });
        }
    }
    /**
     * Handle embedding service unavailability
     * Since we can't restart the embedding container from here, we log a warning
     * and suggest manual intervention
     */
    async recoverEmbedding() {
        const now = Date.now();
        this.lastRecoveryAttempt['embedding'] = now;
        logger.warn({
            socketPath: this.embeddingSocketPath || this.getDefaultEmbeddingSocketPath(),
            errorCount: this.embeddingHealth.errorCount,
            lastError: this.embeddingHealth.lastError
        }, '[HealthMonitor] Embedding service unhealthy - fallback embeddings will be used. ' +
            'To restore, check embedding container: docker ps -a | grep specmem-embedding');
        this.emit('recovery_attempted', { component: 'embedding', success: false });
        // Update details to show recovery was attempted
        this.embeddingHealth.details = {
            ...this.embeddingHealth.details,
            lastRecoveryAttempt: new Date().toISOString(),
            recoveryNote: 'Fallback embeddings active - restart embedding container to restore'
        };
    }
    /**
     * Get comprehensive system health status
     */
    getSystemHealth() {
        // Calculate overall health (worst of all components, excluding unknown)
        let overallHealth = ComponentHealth.HEALTHY;
        const healthValues = [
            this.transportHealth.health,
            this.databaseHealth.health,
            this.embeddingHealth.health
        ].filter(h => h !== ComponentHealth.UNKNOWN);
        if (healthValues.includes(ComponentHealth.UNHEALTHY)) {
            overallHealth = ComponentHealth.UNHEALTHY;
        }
        else if (healthValues.includes(ComponentHealth.DEGRADED)) {
            overallHealth = ComponentHealth.DEGRADED;
        }
        else if (healthValues.length === 0) {
            overallHealth = ComponentHealth.UNKNOWN;
        }
        return {
            overallHealth,
            components: {
                transport: { ...this.transportHealth },
                database: { ...this.databaseHealth },
                embedding: { ...this.embeddingHealth }
            },
            uptime: Date.now() - this.startTime,
            timestamp: new Date().toISOString(),
            // Issue #16: Diagnostics
            totalHealthChecks: this.totalHealthChecks,
            lastCheckTimestamp: this.lastCheckTimestamp > 0 ? new Date(this.lastCheckTimestamp).toISOString() : null,
            currentCheckIntervalMs: this.currentCheckIntervalMs,
            consecutiveHealthyChecks: this.consecutiveHealthyChecks,
        };
    }
    /**
     * Log current health status
     */
    logHealthStatus() {
        const health = this.getSystemHealth();
        const logLevel = health.overallHealth === ComponentHealth.HEALTHY ? 'info' :
            health.overallHealth === ComponentHealth.DEGRADED ? 'warn' : 'error';
        const logFn = logLevel === 'info' ? logger.info.bind(logger) :
            logLevel === 'warn' ? logger.warn.bind(logger) :
                logger.error.bind(logger);
        logFn({
            overallHealth: health.overallHealth,
            uptimeMs: health.uptime,
            transport: {
                health: health.components.transport.health,
                errorCount: health.components.transport.errorCount
            },
            database: {
                health: health.components.database.health,
                errorCount: health.components.database.errorCount
            },
            embedding: {
                health: health.components.embedding.health,
                errorCount: health.components.embedding.errorCount
            }
        }, `[HealthMonitor] System health: ${health.overallHealth}`);
    }
    /**
     * Get individual component health
     */
    getTransportHealth() {
        return { ...this.transportHealth };
    }
    getDatabaseHealth() {
        return { ...this.databaseHealth };
    }
    getEmbeddingHealth() {
        return { ...this.embeddingHealth };
    }
    /**
     * Force a health check immediately
     */
    async forceHealthCheck() {
        return this.runHealthChecks();
    }
    /**
     * Check if system is healthy enough for operation
     */
    isOperational() {
        // System is operational if database is at least degraded
        // (embedding can use fallback, transport issues will cause MCP to restart anyway)
        return this.databaseHealth.health !== ComponentHealth.UNHEALTHY;
    }
}
// Per-project health monitor Map - prevents cross-project pollution
const healthMonitorsByProject = new Map();
/**
 * Get or create the health monitor for current/specified project
 */
export function getHealthMonitor(config, projectPath) {
    const targetProject = projectPath || getProjectPath();
    if (!healthMonitorsByProject.has(targetProject)) {
        healthMonitorsByProject.set(targetProject, new HealthMonitor(config));
        logger.debug({ projectPath: targetProject }, '[HealthMonitor] Created new instance for project');
    }
    return healthMonitorsByProject.get(targetProject);
}
/**
 * Reset the health monitor for current/specified project (for testing or restart)
 */
export function resetHealthMonitor(projectPath) {
    const targetProject = projectPath || getProjectPath();
    const monitor = healthMonitorsByProject.get(targetProject);
    if (monitor) {
        monitor.destroy();
        healthMonitorsByProject.delete(targetProject);
        logger.debug({ projectPath: targetProject }, '[HealthMonitor] Reset instance for project');
    }
}
/**
 * Reset all health monitors across all projects
 */
export function resetAllHealthMonitors() {
    for (const [projectPath, monitor] of healthMonitorsByProject) {
        monitor.destroy();
        logger.debug({ projectPath }, '[HealthMonitor] Destroyed instance for project');
    }
    healthMonitorsByProject.clear();
}
//# sourceMappingURL=healthMonitor.js.map