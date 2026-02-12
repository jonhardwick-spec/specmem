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
import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { createConnection } from 'net';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { getProjectPath, getProjectSocketDir } from '../config.js';
import { mergeWithProjectEnv, getPythonPath } from '../utils/projectEnv.js';
import { checkProcessHealth } from '../utils/processHealthCheck.js';
import { ensureSocketDirAtomicSync } from '../utils/fileProcessingQueue.js';
// ESM __dirname equivalent - replaces hardcoded paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_CONFIG = {
    healthCheckIntervalMs: parseInt(process.env['SPECMEM_MINICOT_HEALTH_INTERVAL'] || '30000', 10),
    healthCheckTimeoutMs: parseInt(process.env['SPECMEM_MINICOT_HEALTH_TIMEOUT'] || '10000', 10),
    maxFailuresBeforeRestart: parseInt(process.env['SPECMEM_MINICOT_MAX_FAILURES'] || '2', 10),
    restartCooldownMs: parseInt(process.env['SPECMEM_MINICOT_RESTART_COOLDOWN'] || '10000', 10),
    // With lazy loading, startup is faster - model loads on first request
    startupTimeoutMs: parseInt(process.env['SPECMEM_MINICOT_STARTUP_TIMEOUT'] || '60000', 10),
    maxRestartAttempts: parseInt(process.env['SPECMEM_MINICOT_MAX_RESTARTS'] || '5', 10),
    // Mini COT enabled by default - set SPECMEM_MINICOT_AUTO_START=false to disable
    autoStart: process.env['SPECMEM_MINICOT_AUTO_START'] !== 'false',
    killStaleOnStart: process.env['SPECMEM_MINICOT_KILL_STALE'] !== 'false',
    maxProcessAgeHours: parseFloat(process.env['SPECMEM_MINICOT_MAX_AGE_HOURS'] || '1'),
    modelName: process.env['SPECMEM_MINICOT_MODEL'] || 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
    device: process.env['SPECMEM_MINICOT_DEVICE'] || 'cpu',
};
// ============================================================================
// MINI COT SERVER MANAGER
// ============================================================================
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
export class MiniCOTServerManager extends EventEmitter {
    config;
    process = null;
    healthCheckTimer = null;
    isRunning = false;
    consecutiveFailures = 0;
    restartCount = 0;
    lastRestartTime = 0;
    startTime = null;
    projectPath;
    socketPath;
    pidFilePath;
    isShuttingDown = false;
    // Prevent concurrent starts (race condition causing duplicate processes)
    isStarting = false;
    // Track if user manually stopped server (prevents auto-restart)
    stoppedFlagPath;
    // Track restart timestamps for loop detection
    restartTimestamps = [];
    // Overflow queue for requests during downtime
    requestQueue = [];
    queueMaxSize = 100;
    queueDroppedCount = 0;
    isDrainingQueue = false;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        // Get project-specific paths
        this.projectPath = getProjectPath();
        this.socketPath = this.getMiniCOTSocketPath();
        this.pidFilePath = join(dirname(this.socketPath), 'minicot.pid');
        // Stopped flag file path - prevents auto-restart when user manually stops
        this.stoppedFlagPath = join(dirname(this.socketPath), 'minicot.stopped');
        logger.info({
            projectPath: this.projectPath,
            socketPath: this.socketPath,
            pidFilePath: this.pidFilePath,
            config: this.config,
        }, '[MiniCOTServerManager] Initialized');
    }
    /**
     * Get the Mini COT socket path for this project
     */
    getMiniCOTSocketPath() {
        const socketDir = getProjectSocketDir();
        return join(socketDir, 'minicot.sock');
    }
    // ==========================================================================
    // PUBLIC METHODS
    // ==========================================================================
    /**
     * Initialize and start the Mini COT server
     * Should be called on MCP server startup
     */
    async initialize() {
        logger.info('[MiniCOTServerManager] Initializing...');
        // Check if user manually stopped the server - respect their choice
        if (this.isStoppedByUser()) {
            logger.info('[MiniCOTServerManager] Server stopped by user, skipping auto-start. Use userStart() to restart.');
            // Still start health monitoring so we can detect if external process starts it
            this.startHealthMonitoring();
            return;
        }
        // Step 1: Kill any stale processes
        if (this.config.killStaleOnStart) {
            await this.killStaleProcesses();
        }
        // Step 2: Start the Mini COT server if auto-start is enabled
        if (this.config.autoStart) {
            await this.start();
        }
        // Step 3: Start health monitoring
        this.startHealthMonitoring();
        logger.info('[MiniCOTServerManager] Initialization complete');
    }
    /**
     * Start the Mini COT server
     * First checks if external process is already serving on this socket
     */
    async start() {
        if (this.isRunning) {
            logger.debug('[MiniCOTServerManager] Server already running');
            return true;
        }
        // Prevent concurrent starts (race condition causing duplicate processes)
        if (this.isStarting) {
            logger.debug('[MiniCOTServerManager] Start already in progress, skipping duplicate');
            return false;
        }
        if (this.isShuttingDown) {
            logger.warn('[MiniCOTServerManager] Cannot start during shutdown');
            return false;
        }
        // Set starting flag immediately to prevent race conditions
        this.isStarting = true;
        logger.info('[MiniCOTServerManager] Starting Mini COT server...');
        // Ensure socket directory exists
        // Task #17 FIX: Use atomic mkdir to prevent race condition when multiple
        // MCP servers try to create the socket directory simultaneously
        const socketDir = dirname(this.socketPath);
        try {
            const created = ensureSocketDirAtomicSync(socketDir);
            if (created) {
                logger.debug({ socketDir }, '[MiniCOTServerManager] Created socket directory atomically');
            }
        }
        catch (err) {
            logger.error({ error: err }, '[MiniCOTServerManager] Failed to create socket directory');
        }
        // Check if socket already exists AND is responsive (external process may have started it)
        if (existsSync(this.socketPath)) {
            const healthResult = await this.healthCheck();
            if (healthResult.success) {
                logger.info({
                    socketPath: this.socketPath,
                    responseTimeMs: healthResult.responseTimeMs
                }, '[MiniCOTServerManager] Socket already responsive (external server) - using existing');
                // Mark as running but with no managed process (external server)
                this.isRunning = true;
                this.startTime = Date.now();
                this.consecutiveFailures = 0;
                this.isStarting = false;
                this.emit('started', { pid: null, external: true });
                return true;
            }
            // Socket exists but not responding - clean it up
            try {
                unlinkSync(this.socketPath);
                logger.debug('[MiniCOTServerManager] Removed non-responsive socket file');
            }
            catch (err) {
                logger.warn({ error: err }, '[MiniCOTServerManager] Failed to remove old socket');
            }
        }
        // Find the Mini COT script
        const miniCOTScript = this.findMiniCOTScript();
        if (!miniCOTScript) {
            logger.error('[MiniCOTServerManager] Could not find Mini COT script');
            this.isStarting = false;
            return false;
        }
        // Spawn the Mini COT server process
        try {
            // yooo ALWAYS use mergeWithProjectEnv for project isolation - spawned processes need the full context
            const env = mergeWithProjectEnv({
                SPECMEM_SOCKET_DIR: socketDir,
                SPECMEM_MINICOT_SOCKET: this.socketPath,
            });
            // Task #22 fix: Use getPythonPath() instead of hardcoded 'python3'
            // Respects SPECMEM_PYTHON_PATH, PYTHON_PATH env vars, and venv activation
            const pythonPath = getPythonPath();
            logger.debug({ pythonPath }, '[MiniCOTServerManager] Using Python executable');
            this.process = spawn(pythonPath, [
                miniCOTScript,
                '--socket', this.socketPath,
                '--model', this.config.modelName,
                '--device', this.config.device,
            ], {
                env,
                cwd: this.projectPath,
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            const pid = this.process.pid;
            if (!pid) {
                throw new Error('Failed to get process PID');
            }
            // Write PID file
            this.writePidFile(pid);
            // Handle process events
            this.process.on('error', (err) => {
                logger.error({ error: err }, '[MiniCOTServerManager] Process error');
                this.handleProcessExit(-1, 'error');
            });
            this.process.on('exit', (code, signal) => {
                logger.info({ code, signal }, '[MiniCOTServerManager] Process exited');
                this.handleProcessExit(code ?? -1, signal ?? 'unknown');
            });
            // Log stderr for debugging
            this.process.stderr?.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg && (msg.includes('Socket') || msg.includes('loaded') || msg.includes('Error') || msg.includes('Mini COT'))) {
                    logger.debug({ msg }, '[MiniCOTServerManager] Server stderr');
                }
            });
            // Wait for socket to appear (Mini COT takes longer due to model loading)
            const socketReady = await this.waitForSocket();
            if (!socketReady) {
                logger.error('[MiniCOTServerManager] Socket did not appear within timeout');
                this.isStarting = false;
                await this.stop();
                return false;
            }
            this.isRunning = true;
            this.startTime = Date.now();
            this.consecutiveFailures = 0;
            // Verify the new process with health check
            const verifyHealth = await this.healthCheck();
            if (verifyHealth.success) {
                logger.info({
                    pid,
                    socketPath: this.socketPath,
                    responseTimeMs: verifyHealth.responseTimeMs,
                    modelInfo: verifyHealth.modelInfo,
                }, '[MiniCOTServerManager] Server started successfully and verified healthy');
            }
            else {
                logger.warn({
                    pid,
                    socketPath: this.socketPath,
                    error: verifyHealth.error,
                }, '[MiniCOTServerManager] Server started but health check failed (may still be initializing)');
            }
            this.emit('started', { pid });
            this.isStarting = false;
            return true;
        }
        catch (err) {
            logger.error({ error: err }, '[MiniCOTServerManager] Failed to start server');
            this.isStarting = false;
            return false;
        }
    }
    /**
     * Stop the Mini COT server gracefully
     */
    async stop() {
        this.isShuttingDown = true;
        this.isStarting = false;
        logger.info('[MiniCOTServerManager] Stopping Mini COT server...');
        // Stop health monitoring
        this.stopHealthMonitoring();
        // Kill the process
        if (this.process && this.process.pid) {
            try {
                // Try graceful SIGTERM first
                process.kill(this.process.pid, 'SIGTERM');
                // Wait briefly for graceful shutdown
                await this.sleep(1000);
                // Force kill if still running
                try {
                    process.kill(this.process.pid, 0); // Check if still running
                    process.kill(this.process.pid, 'SIGKILL');
                    logger.debug('[MiniCOTServerManager] Force killed process');
                }
                catch {
                    // Process already dead - good
                }
            }
            catch (err) {
                logger.debug({ error: err }, '[MiniCOTServerManager] Process already dead');
            }
        }
        // Also try killing by PID file (in case process reference was lost)
        await this.killByPidFile();
        // Clean up PID file
        this.removePidFile();
        // Clean up socket file
        if (existsSync(this.socketPath)) {
            try {
                unlinkSync(this.socketPath);
            }
            catch (err) {
                logger.debug({ error: err }, '[MiniCOTServerManager] Failed to remove socket');
            }
        }
        this.process = null;
        this.isRunning = false;
        this.startTime = null;
        logger.info('[MiniCOTServerManager] Server stopped');
        this.emit('stopped', { pid: this.process?.pid });
    }
    /**
     * Perform a health check on the Mini COT server
     * Mini COT uses JSON-based protocol - send a simple ping request
     */
    async healthCheck() {
        const startTime = Date.now();
        // Quick check: socket must exist
        if (!existsSync(this.socketPath)) {
            return {
                success: false,
                responseTimeMs: Date.now() - startTime,
                error: 'Socket file does not exist',
            };
        }
        // Ping the server with a minimal gallery request
        return new Promise((resolve) => {
            const socket = createConnection(this.socketPath);
            let buffer = '';
            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    socket.destroy();
                    resolve({
                        success: false,
                        responseTimeMs: Date.now() - startTime,
                        error: 'Health check timeout',
                    });
                }
            }, this.config.healthCheckTimeoutMs);
            socket.on('connect', () => {
                // Send a minimal health check request
                // Mini COT expects: { query: string, memories: [...] }
                const healthRequest = {
                    query: '__health_check__',
                    memories: []
                };
                socket.write(JSON.stringify(healthRequest) + '\n');
            });
            socket.on('data', (data) => {
                buffer += data.toString();
                const newlineIndex = buffer.indexOf('\n');
                if (newlineIndex !== -1) {
                    clearTimeout(timeout);
                    if (resolved)
                        return;
                    resolved = true;
                    try {
                        const response = JSON.parse(buffer.slice(0, newlineIndex));
                        socket.end();
                        // Mini COT responds with gallery format
                        // If we get a response (even empty gallery), it's healthy
                        if (response && !response.error) {
                            resolve({
                                success: true,
                                responseTimeMs: Date.now() - startTime,
                                modelInfo: {
                                    loaded: true,
                                    modelName: this.config.modelName,
                                },
                            });
                        }
                        else {
                            resolve({
                                success: false,
                                responseTimeMs: Date.now() - startTime,
                                error: response?.error || 'Invalid response from server',
                            });
                        }
                    }
                    catch (parseErr) {
                        socket.end();
                        resolve({
                            success: false,
                            responseTimeMs: Date.now() - startTime,
                            error: 'Invalid JSON response from server',
                        });
                    }
                }
            });
            socket.on('error', (err) => {
                clearTimeout(timeout);
                if (!resolved) {
                    resolved = true;
                    resolve({
                        success: false,
                        responseTimeMs: Date.now() - startTime,
                        error: `Socket error: ${err.message}`,
                    });
                }
            });
        });
    }
    /**
     * Get current server status
     */
    getStatus() {
        const pid = this.readPidFile();
        const socketExists = existsSync(this.socketPath);
        return {
            running: this.isRunning,
            pid,
            socketPath: this.socketPath,
            socketExists,
            healthy: this.isRunning && socketExists && this.consecutiveFailures === 0,
            lastHealthCheck: this.healthCheckTimer ? Date.now() : null,
            consecutiveFailures: this.consecutiveFailures,
            restartCount: this.restartCount,
            startTime: this.startTime,
            uptime: this.startTime ? Date.now() - this.startTime : null,
            // Queue stats
            queueSize: this.requestQueue.length,
            queueMaxSize: this.queueMaxSize,
            queueDropped: this.queueDroppedCount,
        };
    }
    /**
     * Shutdown - called when MCP server is shutting down
     */
    async shutdown() {
        await this.stop();
        this.removeAllListeners();
    }
    // ==========================================================================
    // USER-INITIATED START/STOP + RESTART LOOP DETECTION
    // ==========================================================================
    /**
     * Check if user manually stopped the server
     * Returns true if the stopped flag file exists
     */
    isStoppedByUser() {
        return existsSync(this.stoppedFlagPath);
    }
    /**
     * Set the stopped-by-user flag
     * When true, prevents auto-restart
     */
    setStoppedByUser(stopped) {
        if (stopped) {
            writeFileSync(this.stoppedFlagPath, Date.now().toString(), 'utf8');
            logger.info('[MiniCOTServerManager] Set stopped-by-user flag');
        }
        else if (existsSync(this.stoppedFlagPath)) {
            unlinkSync(this.stoppedFlagPath);
            logger.info('[MiniCOTServerManager] Cleared stopped-by-user flag');
        }
    }
    /**
     * User-initiated stop - sets flag to prevent auto-restart
     * Use this when user explicitly wants to stop the Mini COT server
     */
    async userStop() {
        logger.info('[MiniCOTServerManager] User-initiated stop');
        // Set flag BEFORE stopping to prevent health check restart race
        this.setStoppedByUser(true);
        await this.stop();
        return {
            success: true,
            message: 'Mini COT server stopped. Auto-restart disabled. Use userStart() to restart.'
        };
    }
    /**
     * User-initiated start - clears stopped flag and does hard restart
     * Use this when user explicitly wants to (re)start the Mini COT server
     */
    async userStart() {
        logger.info('[MiniCOTServerManager] User-initiated start');
        // Clear the stopped flag
        this.setStoppedByUser(false);
        // Reset restart counter for fresh start
        this.restartCount = 0;
        this.restartTimestamps = [];
        this.consecutiveFailures = 0;
        this.isShuttingDown = false;
        // Kill existing and start fresh
        await this.stop();
        // Clear the shutdown flag that stop() sets
        this.isShuttingDown = false;
        const success = await this.start();
        if (success) {
            // Start health monitoring if not already running
            this.startHealthMonitoring();
        }
        return {
            success,
            message: success
                ? 'Mini COT server started successfully'
                : 'Failed to start Mini COT server - check logs for details'
        };
    }
    // ==========================================================================
    // WARM/COLD RESTART METHODS
    // ==========================================================================
    /**
     * Warm restart - Quick restart that preserves loaded model weights in memory
     * Sends SIGHUP to Python service to reset state without unloading model
     * Faster recovery from errors while keeping the model warm
     */
    async warmRestart() {
        logger.info('[MiniCOTServerManager] Warm restart requested');
        // Check if server is running and we have a PID
        const pid = this.readPidFile();
        if (!pid || !this.isRunning) {
            logger.warn('[MiniCOTServerManager] Cannot warm restart - server not running, falling back to cold start');
            return this.coldRestart();
        }
        // Check if process exists
        try {
            process.kill(pid, 0);
        }
        catch {
            logger.warn('[MiniCOTServerManager] Cannot warm restart - process not found, falling back to cold start');
            return this.coldRestart();
        }
        try {
            // Send SIGHUP to signal warm restart (Python will reset state but keep model loaded)
            process.kill(pid, 'SIGHUP');
            logger.info({ pid }, '[MiniCOTServerManager] Sent SIGHUP for warm restart');
            // Wait for server to reset (much faster than cold start)
            await this.sleep(2000);
            // Verify health after warm restart
            const healthResult = await this.healthCheck();
            if (healthResult.success) {
                this.consecutiveFailures = 0;
                this.emit('warm_restart', { success: true });
                // Drain the queue after successful restart
                const drainResult = await this.drainQueue();
                logger.info({
                    pid,
                    responseTimeMs: healthResult.responseTimeMs,
                    queueDrained: drainResult.processed,
                }, '[MiniCOTServerManager] Warm restart successful');
                return {
                    success: true,
                    message: 'Warm restart completed - model weights preserved',
                    drainedCount: drainResult.processed,
                };
            }
            else {
                // Warm restart didnt work, try cold restart
                logger.warn({ error: healthResult.error }, '[MiniCOTServerManager] Warm restart failed health check, falling back to cold');
                this.emit('warm_restart', { success: false });
                return this.coldRestart();
            }
        }
        catch (err) {
            logger.error({ error: err }, '[MiniCOTServerManager] Warm restart signal failed');
            this.emit('warm_restart', { success: false });
            return this.coldRestart();
        }
    }
    /**
     * Cold restart - Full restart that unloads and reloads the TinyLlama model
     * Complete process termination and fresh spawn
     * Use when warm restart fails or model corruption suspected
     */
    async coldRestart() {
        logger.info('[MiniCOTServerManager] Cold restart requested');
        // Clear stopped flag if set (user wants restart)
        this.setStoppedByUser(false);
        // Reset counters for fresh start
        this.restartCount = 0;
        this.restartTimestamps = [];
        this.consecutiveFailures = 0;
        this.isShuttingDown = false;
        // Kill existing process completely
        await this.stop();
        this.isShuttingDown = false;
        // Wait a bit for cleanup
        await this.sleep(1000);
        // Fresh start
        const success = await this.start();
        if (success) {
            this.startHealthMonitoring();
            this.emit('cold_restart', { success: true });
            // Drain the queue after successful restart
            const drainResult = await this.drainQueue();
            logger.info({
                queueDrained: drainResult.processed,
            }, '[MiniCOTServerManager] Cold restart successful');
            return {
                success: true,
                message: 'Cold restart completed - model fully reloaded',
                drainedCount: drainResult.processed,
            };
        }
        else {
            this.emit('cold_restart', { success: false });
            return {
                success: false,
                message: 'Cold restart failed - check logs for details',
            };
        }
    }
    // ==========================================================================
    // OVERFLOW QUEUE METHODS
    // ==========================================================================
    /**
     * Queue a request when server is unhealthy/restarting
     * Returns a promise that resolves when the request is processed after restart
     */
    queueRequest(query, memories) {
        return new Promise((resolve, reject) => {
            // Check queue size limit
            if (this.requestQueue.length >= this.queueMaxSize) {
                // Queue full - drop oldest request and add new one
                const dropped = this.requestQueue.shift();
                if (dropped) {
                    dropped.reject(new Error('Request dropped from queue due to overflow'));
                    this.queueDroppedCount++;
                    logger.warn({
                        droppedId: dropped.id,
                        queueSize: this.requestQueue.length,
                    }, '[MiniCOTServerManager] Queue overflow - dropped oldest request');
                    this.emit('queue_overflow', {
                        dropped: 1,
                        queueSize: this.requestQueue.length,
                    });
                }
            }
            const requestId = 'cot-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
            const queuedRequest = {
                id: requestId,
                query,
                memories,
                timestamp: Date.now(),
                resolve,
                reject,
            };
            this.requestQueue.push(queuedRequest);
            logger.debug({
                requestId,
                queueSize: this.requestQueue.length,
            }, '[MiniCOTServerManager] Request queued for processing after restart');
        });
    }
    /**
     * Drain the queue after server restart
     * Processes all queued requests sequentially
     */
    async drainQueue() {
        if (this.isDrainingQueue) {
            logger.debug('[MiniCOTServerManager] Queue drain already in progress');
            return { processed: 0, failed: 0 };
        }
        if (this.requestQueue.length === 0) {
            logger.debug('[MiniCOTServerManager] No queued requests to drain');
            return { processed: 0, failed: 0 };
        }
        this.isDrainingQueue = true;
        const queueSize = this.requestQueue.length;
        logger.info({ queueSize }, '[MiniCOTServerManager] Draining request queue');
        let processed = 0;
        let failed = 0;
        // Process all queued requests
        while (this.requestQueue.length > 0) {
            const request = this.requestQueue.shift();
            if (!request)
                break;
            // Check if request is too old (> 5 minutes)
            const age = Date.now() - request.timestamp;
            if (age > 5 * 60 * 1000) {
                request.reject(new Error('Request expired in queue (> 5 minutes)'));
                failed++;
                continue;
            }
            try {
                // Send request to server
                const result = await this.sendRequest(request.query, request.memories);
                request.resolve(result);
                processed++;
            }
            catch (err) {
                request.reject(err instanceof Error ? err : new Error(String(err)));
                failed++;
            }
            // Small delay between requests to not overwhelm the server
            await this.sleep(100);
        }
        this.isDrainingQueue = false;
        logger.info({ processed, failed }, '[MiniCOTServerManager] Queue drain complete');
        this.emit('queue_drained', { processed, failed });
        return { processed, failed };
    }
    /**
     * Get current queue status
     */
    getQueueStatus() {
        const oldestRequest = this.requestQueue[0];
        return {
            size: this.requestQueue.length,
            maxSize: this.queueMaxSize,
            dropped: this.queueDroppedCount,
            isDraining: this.isDrainingQueue,
            oldestRequestAge: oldestRequest ? Date.now() - oldestRequest.timestamp : null,
        };
    }
    /**
     * Clear all queued requests (reject them with error)
     */
    clearQueue(reason = 'Queue cleared') {
        const count = this.requestQueue.length;
        while (this.requestQueue.length > 0) {
            const request = this.requestQueue.shift();
            if (request) {
                request.reject(new Error(reason));
            }
        }
        logger.info({ count, reason }, '[MiniCOTServerManager] Queue cleared');
        return count;
    }
    /**
     * Send a request to the Mini COT server (internal helper)
     */
    sendRequest(query, memories) {
        return new Promise((resolve, reject) => {
            if (!existsSync(this.socketPath)) {
                reject(new Error('Socket file does not exist'));
                return;
            }
            const socket = createConnection(this.socketPath);
            let buffer = '';
            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    socket.destroy();
                    reject(new Error('Request timeout'));
                }
            }, 30000); // 30 second timeout for COT processing
            socket.on('connect', () => {
                const request = { query, memories };
                socket.write(JSON.stringify(request) + '\n');
            });
            socket.on('data', (data) => {
                buffer += data.toString();
                const newlineIndex = buffer.indexOf('\n');
                if (newlineIndex !== -1) {
                    clearTimeout(timeout);
                    if (resolved)
                        return;
                    resolved = true;
                    try {
                        const response = JSON.parse(buffer.slice(0, newlineIndex));
                        socket.end();
                        if (response.error) {
                            reject(new Error(response.error));
                        }
                        else {
                            resolve(response);
                        }
                    }
                    catch (parseErr) {
                        socket.end();
                        reject(new Error('Invalid JSON response from server'));
                    }
                }
            });
            socket.on('error', (err) => {
                clearTimeout(timeout);
                if (!resolved) {
                    resolved = true;
                    reject(err);
                }
            });
        });
    }
    /**
     * Get restart loop detection info
     * Detects if we're in a restart loop (>3 restarts in 60 seconds)
     */
    getRestartLoopInfo() {
        const windowMs = 60000; // 60 seconds
        const loopThreshold = 3;
        const now = Date.now();
        // Count restarts in the last 60 seconds
        const recentRestarts = this.restartTimestamps.filter(ts => now - ts < windowMs).length;
        return {
            inLoop: recentRestarts >= loopThreshold,
            recentRestarts,
            maxAttempts: this.config.maxRestartAttempts,
            windowSeconds: 60,
            restartCount: this.restartCount
        };
    }
    /**
     * Get extended status including stopped-by-user flag and restart loop info
     */
    getExtendedStatus() {
        return {
            ...this.getStatus(),
            stoppedByUser: this.isStoppedByUser(),
            restartLoop: this.getRestartLoopInfo()
        };
    }
    // ==========================================================================
    // PRIVATE METHODS
    // ==========================================================================
    /**
     * Kill any stale Mini COT processes from previous runs
     * Uses robust process age checking to verify we're killing the right process
     */
    async killStaleProcesses() {
        logger.info('[MiniCOTServerManager] Checking for stale processes...');
        // Step 1: Check PID file with health check
        const healthInfo = checkProcessHealth({
            pidFilePath: this.pidFilePath,
            maxAgeHours: this.config.maxProcessAgeHours,
            expectedProcessName: 'mini-cot',
            projectPath: this.projectPath,
        });
        if (healthInfo) {
            logger.info({
                pid: healthInfo.pid,
                processExists: healthInfo.processExists,
                isMiniCOTServer: healthInfo.isEmbeddingServer, // reusing field name from generic health check
                ageHours: healthInfo.processAgeHours?.toFixed(2) || 'unknown',
                pidFileAgeHours: healthInfo.pidFileAgeHours.toFixed(2),
                isStale: healthInfo.isStale,
                recommendedAction: healthInfo.recommendedAction,
                statusMessage: healthInfo.statusMessage,
            }, '[MiniCOTServerManager] Process health check result');
            // Take action based on health check
            if (healthInfo.recommendedAction === 'kill') {
                await this.killProcessWithHealthInfo(healthInfo);
            }
            else if (healthInfo.recommendedAction === 'investigate') {
                logger.warn({
                    pid: healthInfo.pid,
                    commandLine: healthInfo.commandLine,
                    message: 'Process exists but may not be Mini COT server - killing to be safe',
                }, '[MiniCOTServerManager] Suspicious process found');
                await this.killProcessWithHealthInfo(healthInfo);
            }
            else {
                logger.info({
                    pid: healthInfo.pid,
                    ageHours: healthInfo.processAgeHours?.toFixed(2) || 'unknown',
                }, '[MiniCOTServerManager] Process is healthy but will be killed (killStaleOnStart=true)');
                await this.killProcessWithHealthInfo(healthInfo);
            }
        }
        else {
            logger.debug('[MiniCOTServerManager] No PID file found, checking for orphaned processes');
        }
        // Step 2: Also check for orphaned processes (no PID file but process exists)
        await this.killOrphanedProcesses();
        // Step 3: Clean up old socket if exists
        if (existsSync(this.socketPath)) {
            try {
                unlinkSync(this.socketPath);
                logger.debug('[MiniCOTServerManager] Removed stale socket');
            }
            catch (err) {
                logger.debug({ error: err }, '[MiniCOTServerManager] Failed to remove stale socket');
            }
        }
        // Step 4: Clean up PID file if exists
        this.removePidFile();
        logger.info('[MiniCOTServerManager] Stale process cleanup complete');
    }
    /**
     * Kill a process using health info metadata
     */
    async killProcessWithHealthInfo(healthInfo) {
        const { pid, processAgeHours, pidFileAgeHours } = healthInfo;
        if (!healthInfo.processExists) {
            logger.debug({ pid }, '[MiniCOTServerManager] Process does not exist, nothing to kill');
            return;
        }
        try {
            logger.info({
                pid,
                processAge: processAgeHours?.toFixed(2) || 'unknown',
                pidFileAge: pidFileAgeHours.toFixed(2),
                commandLine: healthInfo.commandLine,
            }, '[MiniCOTServerManager] Killing process');
            // Try graceful SIGTERM first
            process.kill(pid, 'SIGTERM');
            await this.sleep(500);
            // Check if still running
            try {
                process.kill(pid, 0);
                // Still running - force kill
                process.kill(pid, 'SIGKILL');
                logger.debug({ pid }, '[MiniCOTServerManager] Force killed process with SIGKILL');
            }
            catch {
                // Already dead - good
                logger.debug({ pid }, '[MiniCOTServerManager] Process terminated gracefully');
            }
        }
        catch (err) {
            logger.debug({ pid, error: err }, '[MiniCOTServerManager] Failed to kill process (may already be dead)');
        }
    }
    /**
     * Find and kill orphaned Mini COT processes (no PID file)
     * Kills zombie mini-cot processes NOT tracked by any project's PID file
     */
    async killOrphanedProcesses() {
        try {
            // Find ALL python3 processes running mini-cot-service.py
            const result = execSync(`pgrep -f "mini-cot-service.py" 2>/dev/null || true`, { encoding: 'utf8' }).trim();
            // Get ALL known PID files from specmem sockets dirs
            const trackedPids = new Set();
            try {
                const pidFiles = execSync(`find /tmp -name "minicot.pid" 2>/dev/null | xargs cat 2>/dev/null || true`, { encoding: 'utf8' }).trim();
                // PID files format: {PID}:{TIMESTAMP}
                for (const line of pidFiles.split('\n')) {
                    const pid = parseInt(line.split(':')[0], 10);
                    if (!isNaN(pid))
                        trackedPids.add(pid);
                }
            }
            catch { /* no pid files - all are orphans */ }
            // Also check ~/.specmem/*/sockets/ and project-local specmem/sockets/
            try {
                const homePids = execSync(`find ~/.specmem /specmem -name "minicot.pid" 2>/dev/null | xargs cat 2>/dev/null || true`, { encoding: 'utf8' }).trim();
                for (const line of homePids.split('\n')) {
                    const pid = parseInt(line.split(':')[0], 10);
                    if (!isNaN(pid))
                        trackedPids.add(pid);
                }
            }
            catch { /* fine */ }
            if (result) {
                const pids = result.split('\n').filter(p => p.trim());
                const orphanPids = pids.filter(p => !trackedPids.has(parseInt(p, 10)));
                if (orphanPids.length > 0) {
                    logger.info({
                        orphanPids,
                        trackedCount: trackedPids.size,
                        totalFound: pids.length
                    }, '[MiniCOTServerManager] Found orphaned processes (not tracked by any PID file)');
                }
                for (const pidStr of orphanPids) {
                    const pid = parseInt(pidStr, 10);
                    if (isNaN(pid))
                        continue;
                    // Skip if tracked by another project
                    if (trackedPids.has(pid)) {
                        logger.debug({ pid }, '[MiniCOTServerManager] Skipping - tracked by another project');
                        continue;
                    }
                    try {
                        // Get process info before killing
                        const healthInfo = this.getProcessInfoForOrphan(pid);
                        const ageHours = healthInfo?.ageHours ?? null;
                        // Only kill if older than max age
                        if (ageHours !== null && ageHours <= this.config.maxProcessAgeHours) {
                            logger.info({
                                pid,
                                ageHours: ageHours.toFixed(2),
                                maxAgeHours: this.config.maxProcessAgeHours,
                            }, '[MiniCOTServerManager] Orphaned process is recent, keeping it');
                            continue;
                        }
                        logger.info({
                            pid,
                            ageHours: ageHours?.toFixed(2) || 'unknown',
                            maxAgeHours: this.config.maxProcessAgeHours,
                            commandLine: healthInfo?.commandLine || 'unknown',
                        }, '[MiniCOTServerManager] Killing stale orphaned process (zombie)');
                        process.kill(pid, 'SIGTERM');
                        await this.sleep(200);
                        // Force kill if still running
                        try {
                            process.kill(pid, 0);
                            process.kill(pid, 'SIGKILL');
                        }
                        catch {
                            // Already dead
                        }
                    }
                    catch (err) {
                        logger.debug({ pid, error: err }, '[MiniCOTServerManager] Failed to kill orphaned process');
                    }
                }
            }
        }
        catch (err) {
            // pgrep may not exist or may fail - that's OK
            logger.debug({ error: err }, '[MiniCOTServerManager] pgrep failed (may not exist)');
        }
    }
    /**
     * Get process info for an orphaned process (no PID file)
     */
    getProcessInfoForOrphan(pid) {
        try {
            // Try to read /proc/[pid]/stat for start time
            const statPath = `/proc/${pid}/stat`;
            if (!existsSync(statPath)) {
                return null;
            }
            const statContent = readFileSync(statPath, 'utf8');
            const match = statContent.match(/\(.*?\)\s+(.*)$/);
            if (!match) {
                return null;
            }
            const fields = match[1].split(/\s+/);
            const startTimeJiffies = parseInt(fields[19], 10);
            if (!isNaN(startTimeJiffies)) {
                // Simple age calculation (not fully accurate but good enough)
                const uptimeContent = readFileSync('/proc/uptime', 'utf8');
                const uptimeSeconds = parseFloat(uptimeContent.split(/\s+/)[0]);
                const clockTicks = 100; // Standard for most systems
                const processStartSeconds = startTimeJiffies / clockTicks;
                const processAgeSeconds = uptimeSeconds - processStartSeconds;
                const ageHours = processAgeSeconds / 3600;
                // Get command line
                const cmdlinePath = `/proc/${pid}/cmdline`;
                let commandLine = null;
                if (existsSync(cmdlinePath)) {
                    commandLine = readFileSync(cmdlinePath, 'utf8').replace(/\0/g, ' ').trim();
                }
                return { ageHours, commandLine };
            }
        }
        catch (err) {
            logger.debug({ pid, error: err }, '[MiniCOTServerManager] Failed to get orphan process info');
        }
        return null;
    }
    /**
     * Kill process by PID file (using robust health check)
     */
    async killByPidFile() {
        const healthInfo = checkProcessHealth({
            pidFilePath: this.pidFilePath,
            maxAgeHours: this.config.maxProcessAgeHours,
            expectedProcessName: 'mini-cot',
            projectPath: this.projectPath,
        });
        if (!healthInfo) {
            logger.debug('[MiniCOTServerManager] No PID file found');
            return;
        }
        logger.debug({
            pid: healthInfo.pid,
            processExists: healthInfo.processExists,
            isMiniCOTServer: healthInfo.isEmbeddingServer,
            ageHours: healthInfo.processAgeHours?.toFixed(2) || 'unknown',
            recommendedAction: healthInfo.recommendedAction,
            statusMessage: healthInfo.statusMessage,
        }, '[MiniCOTServerManager] Checked PID file process');
        if (healthInfo.processExists) {
            await this.killProcessWithHealthInfo(healthInfo);
        }
        else {
            logger.debug({ pid: healthInfo.pid }, '[MiniCOTServerManager] Process from PID file no longer exists');
        }
        this.removePidFile();
    }
    /**
     * Find the Mini COT script path
     */
    findMiniCOTScript() {
        // specmem root dir is 2 levels up from src/mcp/
        const specmemRoot = dirname(dirname(__dirname));
        const possiblePaths = [
            // Project-local (development)
            join(this.projectPath, 'mini-cot-service.py'),
            // SpecMem package root (via __dirname - works for all installs)
            join(specmemRoot, 'mini-cot-service.py'),
            // Local npm install
            join(this.projectPath, 'node_modules', 'specmem-hardwicksoftware', 'mini-cot-service.py'),
            // Global npm install fallback (platform-agnostic)
            join(dirname(dirname(process.execPath)), 'lib', 'node_modules', 'specmem-hardwicksoftware', 'mini-cot-service.py'),
        ];
        for (const p of possiblePaths) {
            if (existsSync(p)) {
                logger.debug({ path: p }, '[MiniCOTServerManager] Found Mini COT script');
                return p;
            }
        }
        logger.error({ searchedPaths: possiblePaths }, '[MiniCOTServerManager] Mini COT script not found');
        return null;
    }
    /**
     * Wait for socket file to appear
     * Mini COT needs more time due to model loading
     */
    async waitForSocket() {
        const startTime = Date.now();
        const checkInterval = 1000; // Check every second
        while (Date.now() - startTime < this.config.startupTimeoutMs) {
            if (existsSync(this.socketPath)) {
                // Socket exists - wait a bit more for it to be fully ready
                await this.sleep(1000);
                return true;
            }
            await this.sleep(checkInterval);
        }
        return false;
    }
    /**
     * Handle process exit
     */
    handleProcessExit(code, signal) {
        const wasRunning = this.isRunning;
        this.isRunning = false;
        // Only clear process if we actually had one (not external server)
        if (this.process) {
            this.process = null;
        }
        if (this.isShuttingDown) {
            // Expected exit during shutdown
            return;
        }
        logger.warn({ code, signal, wasRunning }, '[MiniCOTServerManager] Process exited unexpectedly');
        // Attempt restart if not shutting down
        this.attemptRestart();
    }
    /**
     * Attempt to restart the server
     */
    async attemptRestart() {
        // Don't restart if user manually stopped
        if (this.isStoppedByUser()) {
            logger.info('[MiniCOTServerManager] Skipping restart - stopped by user');
            return;
        }
        // Check for restart loop (>3 restarts in 60 seconds)
        const loopInfo = this.getRestartLoopInfo();
        if (loopInfo.inLoop) {
            logger.error({
                recentRestarts: loopInfo.recentRestarts,
                windowSeconds: 60,
            }, '[MiniCOTServerManager] RESTART LOOP DETECTED - backing off');
            this.emit('restart_loop', loopInfo);
            // Exponential backoff: wait 2^restartCount seconds (max 5 minutes)
            const backoffMs = Math.min(Math.pow(2, this.restartCount) * 1000, 300000);
            logger.info({ backoffMs }, '[MiniCOTServerManager] Waiting for exponential backoff');
            await this.sleep(backoffMs);
        }
        // Check cooldown
        const timeSinceLastRestart = Date.now() - this.lastRestartTime;
        if (timeSinceLastRestart < this.config.restartCooldownMs) {
            const waitTime = this.config.restartCooldownMs - timeSinceLastRestart;
            logger.debug({ waitTime }, '[MiniCOTServerManager] Waiting for restart cooldown');
            await this.sleep(waitTime);
        }
        // Check max restarts
        if (this.restartCount >= this.config.maxRestartAttempts) {
            logger.error({
                restartCount: this.restartCount,
                maxAttempts: this.config.maxRestartAttempts,
            }, '[MiniCOTServerManager] Max restart attempts reached');
            this.emit('restart_failed', { attempts: this.restartCount });
            return;
        }
        this.restartCount++;
        this.lastRestartTime = Date.now();
        // Track restart timestamp for loop detection
        this.restartTimestamps.push(Date.now());
        // Keep only last 10 timestamps
        if (this.restartTimestamps.length > 10) {
            this.restartTimestamps.shift();
        }
        logger.info({ attempt: this.restartCount }, '[MiniCOTServerManager] Attempting restart');
        this.emit('restarting', { attempt: this.restartCount });
        const success = await this.start();
        if (!success) {
            // Will retry on next health check
            logger.warn('[MiniCOTServerManager] Restart attempt failed');
        }
    }
    /**
     * Start health monitoring
     */
    startHealthMonitoring() {
        if (this.healthCheckTimer) {
            return;
        }
        this.healthCheckTimer = setInterval(async () => {
            const result = await this.healthCheck();
            this.emit('health', result);
            if (result.success) {
                // Reset failure counter on success
                if (this.consecutiveFailures > 0) {
                    logger.info({
                        responseTimeMs: result.responseTimeMs,
                        modelInfo: result.modelInfo,
                        previousFailures: this.consecutiveFailures,
                    }, '[MiniCOTServerManager] Health check recovered - server is healthy');
                }
                else {
                    logger.debug({
                        responseTimeMs: result.responseTimeMs,
                        modelInfo: result.modelInfo,
                    }, '[MiniCOTServerManager] Health check successful');
                }
                this.consecutiveFailures = 0;
            }
            else {
                this.consecutiveFailures++;
                logger.warn({
                    failures: this.consecutiveFailures,
                    maxFailures: this.config.maxFailuresBeforeRestart,
                    error: result.error,
                    responseTimeMs: result.responseTimeMs,
                    socketPath: this.socketPath,
                    socketExists: existsSync(this.socketPath),
                }, '[MiniCOTServerManager] Health check failed');
                this.emit('unhealthy', { failures: this.consecutiveFailures });
                // Attempt restart if too many failures
                if (this.consecutiveFailures >= this.config.maxFailuresBeforeRestart) {
                    logger.warn({
                        failures: this.consecutiveFailures,
                        maxFailures: this.config.maxFailuresBeforeRestart,
                        restartCount: this.restartCount,
                    }, '[MiniCOTServerManager] Too many consecutive failures, initiating restart...');
                    this.consecutiveFailures = 0;
                    await this.attemptRestart();
                }
            }
        }, this.config.healthCheckIntervalMs);
        // Don't prevent process exit
        this.healthCheckTimer.unref();
        logger.debug('[MiniCOTServerManager] Health monitoring started');
    }
    /**
     * Stop health monitoring
     */
    stopHealthMonitoring() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
            logger.debug('[MiniCOTServerManager] Health monitoring stopped');
        }
    }
    /**
     * Write PID file with timestamp
     */
    writePidFile(pid) {
        try {
            const pidDir = dirname(this.pidFilePath);
            if (!existsSync(pidDir)) {
                mkdirSync(pidDir, { recursive: true });
            }
            // Format: PID:TIMESTAMP
            writeFileSync(this.pidFilePath, `${pid}:${Date.now()}`, 'utf8');
            logger.debug({ pid, path: this.pidFilePath }, '[MiniCOTServerManager] Wrote PID file');
        }
        catch (err) {
            logger.error({ error: err }, '[MiniCOTServerManager] Failed to write PID file');
        }
    }
    /**
     * Read PID from file
     */
    readPidFile() {
        try {
            if (!existsSync(this.pidFilePath)) {
                return null;
            }
            const content = readFileSync(this.pidFilePath, 'utf8').trim();
            const pid = parseInt(content.split(':')[0], 10);
            return isNaN(pid) ? null : pid;
        }
        catch (err) {
            return null;
        }
    }
    /**
     * Remove PID file
     */
    removePidFile() {
        try {
            if (existsSync(this.pidFilePath)) {
                unlinkSync(this.pidFilePath);
                logger.debug('[MiniCOTServerManager] Removed PID file');
            }
        }
        catch (err) {
            logger.debug({ error: err }, '[MiniCOTServerManager] Failed to remove PID file');
        }
    }
    /**
     * Sleep helper
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
// ============================================================================
// PER-PROJECT INSTANCE MAP
// ============================================================================
// Use per-project Map instead of global singleton
// This prevents cross-project socket conflicts when running multiple instances
const miniCOTManagersByProject = new Map();
/**
 * Get or create the Mini COT server manager for a specific project
 * Uses per-project Map pattern to ensure proper isolation
 */
export function getMiniCOTServerManager(config) {
    const projectPath = getProjectPath();
    // Check if we already have a manager for this project
    if (miniCOTManagersByProject.has(projectPath)) {
        return miniCOTManagersByProject.get(projectPath);
    }
    // Create new manager for this project
    const manager = new MiniCOTServerManager(config);
    miniCOTManagersByProject.set(projectPath, manager);
    logger.info({ projectPath, totalManagers: miniCOTManagersByProject.size }, '[MiniCOTServerManager] Created new per-project manager');
    return manager;
}
/**
 * Reset the Mini COT server manager for a specific project (or current project)
 */
export async function resetMiniCOTServerManager(projectPath) {
    const targetPath = projectPath || getProjectPath();
    if (miniCOTManagersByProject.has(targetPath)) {
        const manager = miniCOTManagersByProject.get(targetPath);
        await manager.shutdown();
        miniCOTManagersByProject.delete(targetPath);
        logger.info({ projectPath: targetPath }, '[MiniCOTServerManager] Reset project manager');
    }
}
/**
 * Reset ALL Mini COT server managers (for global cleanup)
 */
export async function resetAllMiniCOTServerManagers() {
    const promises = [];
    for (const [projectPath, manager] of miniCOTManagersByProject) {
        promises.push(manager.shutdown().then(() => {
            logger.info({ projectPath }, '[MiniCOTServerManager] Shutdown manager');
        }));
    }
    await Promise.all(promises);
    miniCOTManagersByProject.clear();
}
//# sourceMappingURL=miniCOTServerManager.js.map