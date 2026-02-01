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
import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, openSync, closeSync, constants } from 'fs';
import { join, dirname } from 'path';
import { createConnection } from 'net';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { getProjectPath, getEmbeddingSocketPath } from '../config.js';
import { checkProcessHealth } from '../utils/processHealthCheck.js';
import { getPythonPath, mergeWithProjectEnv } from '../utils/projectEnv.js';
import { ensureSocketDirAtomicSync } from '../utils/fileProcessingQueue.js';
import { getEmbeddingQueue, hasEmbeddingQueue } from '../services/EmbeddingQueue.js';
import { getDatabase } from '../database.js';
// ESM __dirname equivalent - replaces hardcoded paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_CONFIG = {
    healthCheckIntervalMs: parseInt(process.env['SPECMEM_EMBEDDING_HEALTH_INTERVAL'] || '30000', 10),
    // MED-24 FIX: Increased from 3s to 10s to handle lazy-load scenarios
    // The embedding server may need time to load the model on first request
    healthCheckTimeoutMs: parseInt(process.env['SPECMEM_EMBEDDING_HEALTH_TIMEOUT'] || '10000', 10),
    maxFailuresBeforeRestart: parseInt(process.env['SPECMEM_EMBEDDING_MAX_FAILURES'] || '2', 10),
    restartCooldownMs: parseInt(process.env['SPECMEM_EMBEDDING_RESTART_COOLDOWN'] || '10000', 10),
    // FIX: Increased from 15s to 45s - Python embedding server needs time to:
    // 1. Start Python interpreter (~1-2s)
    // 2. Import torch/sentence-transformers (~5-10s)
    // 3. Load the ML model into memory (~10-20s)
    // 4. Create the Unix socket (~100ms)
    // Total: 15-30s typical, 45s gives headroom for slower machines
    startupTimeoutMs: parseInt(process.env['SPECMEM_EMBEDDING_STARTUP_TIMEOUT'] || '45000', 10),
    maxRestartAttempts: parseInt(process.env['SPECMEM_EMBEDDING_MAX_RESTARTS'] || '5', 10),
    autoStart: process.env['SPECMEM_EMBEDDING_AUTO_START'] !== 'false',
    killStaleOnStart: process.env['SPECMEM_EMBEDDING_KILL_STALE'] !== 'false',
    maxProcessAgeHours: parseFloat(process.env['SPECMEM_EMBEDDING_MAX_AGE_HOURS'] || '1'),
};
// ============================================================================
// EMBEDDING SERVER MANAGER
// ============================================================================
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
export class EmbeddingServerManager extends EventEmitter {
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
    // FIX: Prevent concurrent starts (race condition causing duplicate processes)
    isStarting = false;
    // FIX: File-based lock to prevent CROSS-PROCESS concurrent starts
    // The in-memory isStarting flag only prevents within same process
    // Multiple MCP servers (subagents, sessions) need file-based coordination
    startLockPath;
    START_LOCK_TIMEOUT_MS = 60000; // 60 second lock timeout
    // Phase 4: Track if user manually stopped server (prevents auto-restart)
    stoppedFlagPath;
    // Phase 4: Track restart timestamps for loop detection
    restartTimestamps = [];
    // KYS (Keep Yourself Safe) heartbeat timer - sends heartbeat every 25s to embedding server
    // If embedding server doesn't receive heartbeat within 90s, it commits suicide
    // This prevents zombie embedding servers when MCP crashes (increased from 30s for startup tolerance)
    kysHeartbeatTimer = null;
    KYS_HEARTBEAT_INTERVAL_MS = 25000; // 25 seconds
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        // Get project-specific paths
        this.projectPath = getProjectPath();
        this.socketPath = getEmbeddingSocketPath();
        this.pidFilePath = join(dirname(this.socketPath), 'embedding.pid');
        // Phase 4: Stopped flag file path - prevents auto-restart when user manually stops
        this.stoppedFlagPath = join(dirname(this.socketPath), 'embedding.stopped');
        // FIX: File-based start lock path - prevents cross-process race condition
        this.startLockPath = join(dirname(this.socketPath), 'embedding.starting');
        logger.info({
            projectPath: this.projectPath,
            socketPath: this.socketPath,
            pidFilePath: this.pidFilePath,
            startLockPath: this.startLockPath,
            config: this.config,
        }, '[EmbeddingServerManager] Initialized');
    }
    // ==========================================================================
    // PUBLIC METHODS
    // ==========================================================================
    /**
     * Initialize and start the embedding server
     * Should be called on MCP server startup
     */
    async initialize() {
        logger.info('[EmbeddingServerManager] Initializing...');
        // Phase 4: Check if user manually stopped the server - respect their choice
        if (this.isStoppedByUser()) {
            logger.info('[EmbeddingServerManager] Server stopped by user, skipping auto-start. Use userStart() to restart.');
            // Still start health monitoring so we can detect if Docker starts it externally
            this.startHealthMonitoring();
            // KYS heartbeat keeps server alive when externally started
            this.startKysHeartbeat();
            return;
        }
        // Step 1: Kill any stale processes
        if (this.config.killStaleOnStart) {
            await this.killStaleProcesses();
        }
        // Step 2: Start the embedding server if auto-start is enabled
        if (this.config.autoStart) {
            await this.start();
            // NOTE: KYS heartbeat is started inside start() immediately after server starts
            // This prevents watchdog timeout during long initialization operations
        }
        // Step 3: Start health monitoring
        this.startHealthMonitoring();
        // Step 4: Start KYS heartbeat if server wasn't auto-started (e.g., externally managed)
        // Only start if not already running to avoid duplicate timers
        if (!this.kysHeartbeatTimer) {
            this.startKysHeartbeat();
            logger.info('[EmbeddingServerManager] KYS heartbeat started (fallback path)');
        }
        logger.info('[EmbeddingServerManager] Initialization complete');
    }
    /**
     * Start the embedding server
     * FIX: First check if Docker container is already serving on this socket
     * FIX: Uses file-based lock to prevent CROSS-PROCESS race conditions
     */
    async start() {
        if (this.isRunning) {
            logger.debug('[EmbeddingServerManager] Server already running');
            return true;
        }
        // FIX: Prevent concurrent starts (race condition causing duplicate processes)
        if (this.isStarting) {
            logger.debug('[EmbeddingServerManager] Start already in progress (in-memory lock), skipping duplicate');
            return false;
        }
        if (this.isShuttingDown) {
            logger.warn('[EmbeddingServerManager] Cannot start during shutdown');
            return false;
        }
        // FIX: ATOMIC CROSS-PROCESS file-based lock using O_CREAT | O_EXCL
        // This prevents race condition where multiple processes check then write
        // O_EXCL makes openSync fail if file exists - truly atomic lock acquisition
        const lockAcquired = await this.acquireStartLockAtomic();
        if (!lockAcquired) {
            // Another process is starting - wait for them
            logger.info('[EmbeddingServerManager] Lock held by another process, waiting for server...');
            const waitStart = Date.now();
            while (Date.now() - waitStart < 30000) { // 30s max wait
                await this.sleep(1000);
                if (existsSync(this.socketPath)) {
                    const healthResult = await this.healthCheck();
                    if (healthResult.success) {
                        logger.info('[EmbeddingServerManager] Another process started the server successfully');
                        this.isRunning = true;
                        this.startTime = Date.now();
                        return true;
                    }
                }
                // Check if lock released (we can try again)
                if (!existsSync(this.startLockPath)) {
                    const retryLock = await this.acquireStartLockAtomic();
                    if (retryLock)
                        break; // Got lock on retry
                }
            }
            // Timed out waiting
            if (!this.acquireStartLockAtomic()) {
                logger.warn('[EmbeddingServerManager] Timeout waiting for lock, giving up');
                return false;
            }
        }
        // Set starting flag immediately to prevent race conditions
        this.isStarting = true;
        logger.info('[EmbeddingServerManager] Starting embedding server...');
        // Ensure socket directory exists
        // Task #17 FIX: Use atomic mkdir to prevent race condition when multiple
        // MCP servers try to create the socket directory simultaneously
        const socketDir = dirname(this.socketPath);
        try {
            const created = ensureSocketDirAtomicSync(socketDir);
            if (created) {
                logger.debug({ socketDir }, '[EmbeddingServerManager] Created socket directory atomically');
            }
        }
        catch (err) {
            logger.error({ error: err }, '[EmbeddingServerManager] Failed to create socket directory');
        }
        // FIX: Check if socket already exists AND is responsive (Docker may have started it)
        if (existsSync(this.socketPath)) {
            const healthResult = await this.healthCheck();
            if (healthResult.success) {
                logger.info({
                    socketPath: this.socketPath,
                    responseTimeMs: healthResult.responseTimeMs
                }, '[EmbeddingServerManager] Socket already responsive (Docker/external server) - using existing');
                // Mark as running but with no managed process (external server)
                this.isRunning = true;
                this.startTime = Date.now();
                this.consecutiveFailures = 0;
                this.isStarting = false; // Reset starting flag
                this.releaseStartLock(); // Release file-based lock
                // CRITICAL FIX: Start KYS heartbeat for external server too
                this.startKysHeartbeat();
                logger.info('[EmbeddingServerManager] KYS heartbeat started for external server');
                this.emit('started', { pid: null, external: true });
                return true;
            }
            // Socket exists but not responding - clean it up
            try {
                unlinkSync(this.socketPath);
                logger.debug('[EmbeddingServerManager] Removed non-responsive socket file');
            }
            catch (err) {
                logger.warn({ error: err }, '[EmbeddingServerManager] Failed to remove old socket');
            }
        }
        // Find the embedding script (prefers warm-start.sh Docker mode)
        const scriptInfo = this.findEmbeddingScript();
        if (!scriptInfo) {
            logger.error('[EmbeddingServerManager] Could not find embedding script');
            this.isStarting = false;
            this.releaseStartLock();
            return false;
        }
        const { script: embeddingScript, useWarmStart } = scriptInfo;
        // Spawn the embedding server process
        try {
            // Read config from model-config.json (heavyOps + resource limits)
            let configEnv = {};
            try {
                const configPath = join(this.projectPath, 'specmem', 'model-config.json');
                if (existsSync(configPath)) {
                    const modelConfig = JSON.parse(readFileSync(configPath, 'utf8'));
                    // Pass heavyOps settings
                    if (modelConfig.heavyOps?.enabled) {
                        configEnv.SPECMEM_HEAVY_OPS = '1';
                        configEnv.SPECMEM_HEAVY_OPS_BATCH_MULT = String(modelConfig.heavyOps.batchSizeMultiplier || 2);
                        configEnv.SPECMEM_HEAVY_OPS_THROTTLE_REDUCE = String(modelConfig.heavyOps.throttleReduction || 0.20);
                        logger.info({ heavyOps: modelConfig.heavyOps }, '[EmbeddingServerManager] Heavy Ops mode enabled');
                    }
                    // Pass batch size from config
                    if (modelConfig.embedding?.batchSize) {
                        configEnv.SPECMEM_EMBEDDING_BATCH_SIZE = String(modelConfig.embedding.batchSize);
                    }
                    // Pass resource limits (cpuMin, cpuMax, ramMin, ramMax)
                    if (modelConfig.resources) {
                        const r = modelConfig.resources;
                        if (r.cpuMin != null)
                            configEnv.SPECMEM_CPU_MIN = String(r.cpuMin);
                        if (r.cpuMax != null)
                            configEnv.SPECMEM_CPU_MAX = String(r.cpuMax);
                        if (r.ramMinMb != null)
                            configEnv.SPECMEM_RAM_MIN_MB = String(r.ramMinMb);
                        if (r.ramMaxMb != null)
                            configEnv.SPECMEM_RAM_MAX_MB = String(r.ramMaxMb);
                        logger.info({ resources: r }, '[EmbeddingServerManager] Resource limits configured');
                    }
                }
            }
            catch (configErr) {
                logger.warn({ error: configErr }, '[EmbeddingServerManager] Could not read model-config.json');
            }
            // yooo ALWAYS use mergeWithProjectEnv for project isolation - spawned processes need the full context
            const env = mergeWithProjectEnv({
                SPECMEM_SOCKET_DIR: socketDir,
                SPECMEM_EMBEDDING_SOCKET: this.socketPath,
                SPECMEM_EMBEDDING_IDLE_TIMEOUT: '0',
                ...configEnv,
            });
            if (useWarmStart) {
                // Docker mode via warm-start.sh - handles container lifecycle
                logger.info({ script: embeddingScript }, '[EmbeddingServerManager] Starting via warm-start.sh (Docker mode)');
                this.process = spawn('bash', [embeddingScript], {
                    env,
                    cwd: dirname(embeddingScript),
                    detached: true,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
            }
            else {
                // Direct Python mode - Task #22 fix: Use getPythonPath()
                const pythonPath = getPythonPath();
                logger.info({ pythonPath, script: embeddingScript }, '[EmbeddingServerManager] Starting via Python (direct mode)');
                this.process = spawn(pythonPath, [embeddingScript, '--service'], {
                    env,
                    cwd: this.projectPath,
                    detached: true,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
            }
            const pid = this.process.pid;
            if (!pid) {
                throw new Error('Failed to get process PID');
            }
            // Write PID file
            this.writePidFile(pid);
            // Handle process events
            this.process.on('error', (err) => {
                logger.error({ error: err }, '[EmbeddingServerManager] Process error');
                this.handleProcessExit(-1, 'error');
            });
            this.process.on('exit', (code, signal) => {
                logger.info({ code, signal }, '[EmbeddingServerManager] Process exited');
                this.handleProcessExit(code ?? -1, signal ?? 'unknown');
            });
            // Log stderr for debugging
            this.process.stderr?.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg && (msg.includes('Socket') || msg.includes('READY') || msg.includes('Error') || msg.includes('FRANKENSTEIN'))) {
                    logger.debug({ msg }, '[EmbeddingServerManager] Server stderr');
                }
            });
            // Wait for socket to appear
            const socketReady = await this.waitForSocket();
            if (!socketReady) {
                logger.error('[EmbeddingServerManager] Socket did not appear within timeout');
                this.isStarting = false; // Reset starting flag on timeout
                this.releaseStartLock(); // Release file-based lock
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
                    dimensions: verifyHealth.dimensions,
                }, '[EmbeddingServerManager] Server started successfully and verified healthy');
            }
            else {
                logger.warn({
                    pid,
                    socketPath: this.socketPath,
                    error: verifyHealth.error,
                }, '[EmbeddingServerManager] Server started but health check failed (may still be initializing)');
            }
            this.emit('started', { pid });
            // CRITICAL FIX: Start KYS heartbeat IMMEDIATELY after server starts
            // The heartbeat must begin BEFORE any long-running operations (like queue draining)
            // to prevent the embedding server's watchdog from timing out
            this.startKysHeartbeat();
            logger.info('[EmbeddingServerManager] KYS heartbeat started immediately after server start');
            // Drain any queued embedding requests now that server is up
            this.drainEmbeddingQueueIfNeeded().catch(err => {
                logger.warn({ error: err }, '[EmbeddingServerManager] Queue drain failed (non-fatal)');
            });
            this.isStarting = false; // Reset starting flag on success
            this.releaseStartLock(); // Release file-based lock
            return true;
        }
        catch (err) {
            logger.error({ error: err }, '[EmbeddingServerManager] Failed to start server');
            this.isStarting = false; // Reset starting flag on error
            this.releaseStartLock(); // Release file-based lock
            return false;
        }
    }
    /**
     * Atomically acquire the start lock using O_CREAT | O_EXCL
     * This is truly atomic - the OS ensures only one process can create the file
     * @returns true if lock acquired, false if another process has it
     */
    async acquireStartLockAtomic() {
        try {
            // First check if lock exists and is stale
            if (existsSync(this.startLockPath)) {
                try {
                    const lockContent = readFileSync(this.startLockPath, 'utf8').trim();
                    const lockTime = parseInt(lockContent.split(':')[0], 10);
                    const lockPid = parseInt(lockContent.split(':')[1], 10);
                    const lockAge = Date.now() - lockTime;
                    if (lockAge >= this.START_LOCK_TIMEOUT_MS) {
                        // Stale lock - remove it
                        logger.warn({ lockAge, lockPid }, '[EmbeddingServerManager] Removing stale start lock');
                        unlinkSync(this.startLockPath);
                    }
                    else {
                        // Recent lock - another process has it
                        logger.debug({ lockAge, lockPid }, '[EmbeddingServerManager] Lock held by another process');
                        return false;
                    }
                }
                catch (readErr) {
                    // Lock file corrupt or unreadable - try to remove it
                    try {
                        unlinkSync(this.startLockPath);
                    }
                    catch { /* ignore */ }
                }
            }
            // Try atomic create with O_CREAT | O_EXCL - fails if file exists
            // This is the atomic part - only one process can succeed
            const fd = openSync(this.startLockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
            const lockContent = `${Date.now()}:${process.pid}`;
            writeFileSync(fd, lockContent, 'utf8');
            closeSync(fd);
            logger.debug({ pid: process.pid }, '[EmbeddingServerManager] Acquired start lock atomically');
            return true;
        }
        catch (err) {
            if (err.code === 'EEXIST') {
                // Another process created the file first - they have the lock
                logger.debug('[EmbeddingServerManager] Lock already exists (EEXIST) - another process has it');
                return false;
            }
            // Other error - log and fail
            logger.warn({ error: err }, '[EmbeddingServerManager] Lock acquisition error');
            return false;
        }
    }
    /**
     * Release the file-based start lock
     */
    releaseStartLock() {
        try {
            if (existsSync(this.startLockPath)) {
                unlinkSync(this.startLockPath);
                logger.debug('[EmbeddingServerManager] Released start lock');
            }
        }
        catch (err) {
            logger.debug({ error: err }, '[EmbeddingServerManager] Failed to release start lock');
        }
    }
    /**
     * Drain embedding queue after server starts
     * Processes any pending embedding requests that were queued while server was down
     */
    async drainEmbeddingQueueIfNeeded() {
        try {
            const db = getDatabase();
            if (!db) {
                logger.debug('[EmbeddingServerManager] No database available, skipping queue drain');
                return;
            }
            const pool = db.getPool();
            if (!pool) {
                logger.debug('[EmbeddingServerManager] No pool available, skipping queue drain');
                return;
            }
            if (!hasEmbeddingQueue()) {
                logger.debug('[EmbeddingServerManager] No embedding queue exists, skipping drain');
                return;
            }
            const queue = getEmbeddingQueue(pool);
            const pendingCount = await queue.getPendingCount();
            if (pendingCount === 0) {
                logger.debug('[EmbeddingServerManager] No pending items in queue');
                return;
            }
            logger.info({ pendingCount }, '[EmbeddingServerManager] Draining embedding queue after server start');
            const drained = await queue.drainQueue((text) => this.generateEmbeddingViaSocket(text));
            logger.info({ drained }, '[EmbeddingServerManager] Queue drain complete');
        }
        catch (err) {
            logger.warn({ error: err }, '[EmbeddingServerManager] Failed to drain embedding queue');
        }
    }
    /**
     * Generate embedding using direct socket connection
     * Used by drainQueue to process pending requests after server comes online
     */
    async generateEmbeddingViaSocket(text) {
        return new Promise((resolve, reject) => {
            const socket = createConnection(this.socketPath);
            let buffer = '';
            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    socket.destroy();
                    reject(new Error('Embedding generation timeout'));
                }
            }, 60000); // 60 second timeout for embedding generation
            socket.on('connect', () => {
                socket.write(JSON.stringify({ text }) + '\n');
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
                            return;
                        }
                        if (response.embedding && Array.isArray(response.embedding)) {
                            resolve(response.embedding);
                        }
                        else {
                            reject(new Error('Invalid embedding response format'));
                        }
                    }
                    catch (parseErr) {
                        socket.end();
                        reject(new Error('Failed to parse embedding response'));
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
     * Stop the embedding server gracefully
     */
    async stop() {
        this.isShuttingDown = true;
        this.isStarting = false; // Reset starting flag on stop
        logger.info('[EmbeddingServerManager] Stopping embedding server...');
        // Stop health monitoring
        this.stopHealthMonitoring();
        // Stop KYS heartbeat - server will suicide after 30s without heartbeat
        this.stopKysHeartbeat();
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
                    logger.debug('[EmbeddingServerManager] Force killed process');
                }
                catch {
                    // Process already dead - good
                }
            }
            catch (err) {
                logger.debug({ error: err }, '[EmbeddingServerManager] Process already dead');
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
                logger.debug({ error: err }, '[EmbeddingServerManager] Failed to remove socket');
            }
        }
        this.process = null;
        this.isRunning = false;
        this.startTime = null;
        logger.info('[EmbeddingServerManager] Server stopped');
        this.emit('stopped', { pid: this.process?.pid });
    }
    /**
     * Perform a health check on the embedding server
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
        // Ping the server
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
                // FIX: Docker server.mjs requires type field - use {"type":"health"} for health checks
                // Python server (frankenstein-embeddings.py) accepts both {"stats":true} and {"type":"health"}
                // Docker server.mjs ONLY accepts {"type":"health"} - so use that for compatibility with both
                socket.write(JSON.stringify({ type: 'health' }) + '\n');
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
                        // Check for error response first
                        if (response.error) {
                            resolve({
                                success: false,
                                responseTimeMs: Date.now() - startTime,
                                error: `Server error: ${response.error}`,
                            });
                            return;
                        }
                        // Handle both Python (capabilities) and Docker (native_dimensions) response formats
                        // Python frankenstein-embeddings.py: { capabilities: { native_dims, target_dims }, ... }
                        // Docker server.mjs: { status: "healthy", native_dimensions, target_dimensions, ... }
                        if (response.capabilities) {
                            // Python format
                            resolve({
                                success: true,
                                responseTimeMs: Date.now() - startTime,
                                dimensions: {
                                    native: response.capabilities.native_dims,
                                    target: response.capabilities.target_dims,
                                },
                            });
                        }
                        else if (response.native_dimensions !== undefined) {
                            // Docker format - check for healthy status
                            const isHealthy = response.status === 'healthy' || response.status === 'ok';
                            resolve({
                                success: isHealthy,
                                responseTimeMs: Date.now() - startTime,
                                dimensions: {
                                    native: response.native_dimensions,
                                    target: response.target_dimensions,
                                },
                            });
                        }
                        else {
                            // Fallback for other response formats - assume healthy if no error
                            resolve({
                                success: true,
                                responseTimeMs: Date.now() - startTime,
                            });
                        }
                    }
                    catch (parseErr) {
                        socket.end();
                        resolve({
                            success: false,
                            responseTimeMs: Date.now() - startTime,
                            error: 'Invalid response from server',
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
    // PHASE 4: USER-INITIATED START/STOP + RESTART LOOP DETECTION
    // ==========================================================================
    /**
     * Check if user manually stopped the server
     * Returns true if the stopped flag file exists
     */
    isStoppedByUser() {
        return existsSync(this.stoppedFlagPath);
    }
    /**
     * Check if the embedding server died due to KYS watchdog (no heartbeat from MCP)
     * Returns true if death reason file exists and contains "kys"
     */
    wasKilledByKYS() {
        const deathReasonPath = join(dirname(this.socketPath), 'embedding-death-reason.txt');
        if (!existsSync(deathReasonPath)) {
            return false;
        }
        try {
            const content = readFileSync(deathReasonPath, 'utf8');
            return content.startsWith('kys');
        }
        catch {
            return false;
        }
    }
    /**
     * Clear the KYS death reason file (called after successful respawn)
     */
    clearKYSDeathReason() {
        const deathReasonPath = join(dirname(this.socketPath), 'embedding-death-reason.txt');
        if (existsSync(deathReasonPath)) {
            try {
                unlinkSync(deathReasonPath);
                logger.info('[EmbeddingServerManager] Cleared KYS death reason file');
            }
            catch (err) {
                logger.warn({ err }, '[EmbeddingServerManager] Failed to clear KYS death reason file');
            }
        }
    }
    /**
     * Auto-respawn if server was killed by KYS watchdog
     * This is called when a socket connection fails - if KYS was the cause,
     * we respawn the server and return true so caller can retry
     */
    async autoRespawnIfKYSDeath() {
        if (!this.wasKilledByKYS()) {
            return false;
        }
        logger.info('[EmbeddingServerManager] Server was killed by KYS watchdog - auto-respawning');
        // Clear the death reason so we don't loop
        this.clearKYSDeathReason();
        // Clear stopped flag in case it was set
        this.setStoppedByUser(false);
        // Reset failure counters
        this.consecutiveFailures = 0;
        this.restartCount = 0;
        // Force a fresh start
        try {
            await this.start();
            logger.info('[EmbeddingServerManager] Auto-respawn complete after KYS death');
            return true;
        }
        catch (err) {
            logger.error({ err }, '[EmbeddingServerManager] Auto-respawn failed after KYS death');
            return false;
        }
    }
    /**
     * Set the stopped-by-user flag
     * When true, prevents auto-restart
     */
    setStoppedByUser(stopped) {
        if (stopped) {
            writeFileSync(this.stoppedFlagPath, Date.now().toString(), 'utf8');
            logger.info('[EmbeddingServerManager] Set stopped-by-user flag');
        }
        else if (existsSync(this.stoppedFlagPath)) {
            unlinkSync(this.stoppedFlagPath);
            logger.info('[EmbeddingServerManager] Cleared stopped-by-user flag');
        }
    }
    /**
     * User-initiated stop - sets flag to prevent auto-restart
     * Use this when user explicitly wants to stop the embedding server
     */
    async userStop() {
        logger.info('[EmbeddingServerManager] User-initiated stop');
        // Set flag BEFORE stopping to prevent health check restart race
        this.setStoppedByUser(true);
        await this.stop();
        return {
            success: true,
            message: 'Embedding server stopped. Auto-restart disabled. Use userStart() to restart.'
        };
    }
    /**
     * User-initiated start - clears stopped flag and does hard restart
     * Use this when user explicitly wants to (re)start the embedding server
     */
    async userStart() {
        logger.info('[EmbeddingServerManager] User-initiated start');
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
            // NOTE: KYS heartbeat already started inside start() method
            // No need to start it again here
        }
        return {
            success,
            message: success
                ? 'Embedding server started successfully'
                : 'Failed to start embedding server - check logs for details'
        };
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
     * Kill any stale embedding processes from previous runs
     * Uses robust process age checking to verify we're killing the right process
     */
    async killStaleProcesses() {
        logger.info('[EmbeddingServerManager] Checking for stale processes...');
        // Step 1: Check PID file with health check
        const healthInfo = checkProcessHealth({
            pidFilePath: this.pidFilePath,
            maxAgeHours: this.config.maxProcessAgeHours,
            expectedProcessName: 'frankenstein-embeddings',
            projectPath: this.projectPath,
        });
        if (healthInfo) {
            logger.info({
                pid: healthInfo.pid,
                processExists: healthInfo.processExists,
                isEmbeddingServer: healthInfo.isEmbeddingServer,
                ageHours: healthInfo.processAgeHours?.toFixed(2) || 'unknown',
                pidFileAgeHours: healthInfo.pidFileAgeHours.toFixed(2),
                isStale: healthInfo.isStale,
                recommendedAction: healthInfo.recommendedAction,
                statusMessage: healthInfo.statusMessage,
            }, '[EmbeddingServerManager] Process health check result');
            // Take action based on health check
            // CRITICAL FIX: Only kill if process belongs to THIS project's socket path
            // Check process's SPECMEM_EMBEDDING_SOCKET env var (not cmdline - socket isn't in cmdline!)
            const processSocketPath = healthInfo.pid ? this.getProcessSocketPath(healthInfo.pid) : null;
            const belongsToThisProject = processSocketPath === this.socketPath;
            if (!belongsToThisProject && processSocketPath) {
                logger.info({
                    pid: healthInfo.pid,
                    thisProjectSocket: this.socketPath,
                    processSocket: processSocketPath,
                }, '[EmbeddingServerManager] Process belongs to different project - skipping kill');
                // Don't kill processes from other projects - just clean up our PID file
                this.removePidFile();
                return;
            }
            if (healthInfo.recommendedAction === 'kill') {
                await this.killProcessWithHealthInfo(healthInfo);
            }
            else if (healthInfo.recommendedAction === 'investigate') {
                logger.warn({
                    pid: healthInfo.pid,
                    commandLine: healthInfo.commandLine,
                    message: 'Process exists but may not be embedding server - killing to be safe',
                }, '[EmbeddingServerManager] Suspicious process found');
                await this.killProcessWithHealthInfo(healthInfo);
            }
            else {
                logger.info({
                    pid: healthInfo.pid,
                    ageHours: healthInfo.processAgeHours?.toFixed(2) || 'unknown',
                }, '[EmbeddingServerManager] Process is healthy and belongs to this project - will be killed (killStaleOnStart=true)');
                await this.killProcessWithHealthInfo(healthInfo);
            }
        }
        else {
            logger.debug('[EmbeddingServerManager] No PID file found, checking for orphaned processes');
        }
        // Step 2: Also check for orphaned processes (no PID file but process exists)
        await this.killOrphanedProcesses();
        // Step 3: Clean up old socket if exists
        if (existsSync(this.socketPath)) {
            try {
                unlinkSync(this.socketPath);
                logger.debug('[EmbeddingServerManager] Removed stale socket');
            }
            catch (err) {
                logger.debug({ error: err }, '[EmbeddingServerManager] Failed to remove stale socket');
            }
        }
        // Step 4: Clean up PID file if exists
        this.removePidFile();
        logger.info('[EmbeddingServerManager] Stale process cleanup complete');
    }
    /**
     * Kill a process using health info metadata
     */
    async killProcessWithHealthInfo(healthInfo) {
        const { pid, processAgeHours, pidFileAgeHours } = healthInfo;
        if (!healthInfo.processExists) {
            logger.debug({ pid }, '[EmbeddingServerManager] Process does not exist, nothing to kill');
            return;
        }
        try {
            logger.info({
                pid,
                processAge: processAgeHours?.toFixed(2) || 'unknown',
                pidFileAge: pidFileAgeHours.toFixed(2),
                commandLine: healthInfo.commandLine,
            }, '[EmbeddingServerManager] Killing process');
            // Try graceful SIGTERM first
            process.kill(pid, 'SIGTERM');
            await this.sleep(500);
            // Check if still running
            try {
                process.kill(pid, 0);
                // Still running - force kill
                process.kill(pid, 'SIGKILL');
                logger.debug({ pid }, '[EmbeddingServerManager] Force killed process with SIGKILL');
            }
            catch {
                // Already dead - good
                logger.debug({ pid }, '[EmbeddingServerManager] Process terminated gracefully');
            }
        }
        catch (err) {
            logger.debug({ pid, error: err }, '[EmbeddingServerManager] Failed to kill process (may already be dead)');
        }
    }
    /**
     * Find and kill orphaned embedding processes (no PID file)
     * Kills zombie frankenstein processes NOT tracked by any project's PID file
     * Preserves processes actively used by other SpecMem instances
     *
     * CRITICAL FIX: Socket path is passed via ENVIRONMENT VARIABLES, not command line!
     * So we find ALL frankenstein processes, then filter by checking /proc/PID/environ
     */
    async killOrphanedProcesses() {
        try {
            // FIX: Find ALL frankenstein processes (socket path is in env, not cmdline)
            // Then filter by checking each process's SPECMEM_EMBEDDING_SOCKET env var
            const result = execSync(`pgrep -f "frankenstein-embeddings.py" 2>/dev/null || true`, { encoding: 'utf8' }).trim();
            // Get ALL known PID files from ALL possible locations
            // These are processes actively tracked by running instances
            const trackedPids = new Set();
            // Search common PID file locations more comprehensively
            try {
                const pidFiles = execSync(`find /tmp ~/.specmem /specmem -name "embedding.pid" 2>/dev/null | xargs cat 2>/dev/null || true`, { encoding: 'utf8' }).trim();
                // PID files format: {PID}:{TIMESTAMP}
                for (const line of pidFiles.split('\n')) {
                    if (!line.trim())
                        continue;
                    const pid = parseInt(line.split(':')[0], 10);
                    if (!isNaN(pid))
                        trackedPids.add(pid);
                }
            }
            catch { /* no pid files - all are orphans */ }
            // CRITICAL FIX: Also search for PID files in ANY project path
            // This catches project-specific socket directories like /newServer/specmem/sockets/
            try {
                const allProjectPids = execSync(`find / -path "*/specmem/sockets/embedding.pid" -o -path "*/.specmem/*/sockets/embedding.pid" 2>/dev/null | xargs cat 2>/dev/null || true`, { encoding: 'utf8', timeout: 5000 }).trim();
                for (const line of allProjectPids.split('\n')) {
                    if (!line.trim())
                        continue;
                    const pid = parseInt(line.split(':')[0], 10);
                    if (!isNaN(pid))
                        trackedPids.add(pid);
                }
            }
            catch { /* filesystem search may be slow or fail - that's ok */ }
            if (result) {
                const pids = result.split('\n').filter(p => p.trim());
                const orphanPids = pids.filter(p => !trackedPids.has(parseInt(p, 10)));
                if (orphanPids.length > 0) {
                    logger.info({
                        orphanPids,
                        trackedCount: trackedPids.size,
                        totalFound: pids.length,
                        thisProjectSocket: this.socketPath,
                    }, '[EmbeddingServerManager] Found orphaned processes for THIS project (not tracked by PID file)');
                }
                for (const pidStr of orphanPids) {
                    const pid = parseInt(pidStr, 10);
                    if (isNaN(pid))
                        continue;
                    // Skip if tracked by another project
                    if (trackedPids.has(pid)) {
                        logger.debug({ pid }, '[EmbeddingServerManager] Skipping - tracked by another project');
                        continue;
                    }
                    try {
                        // Get process info before killing
                        const healthInfo = this.getProcessInfoForOrphan(pid);
                        const ageHours = healthInfo?.ageHours ?? null;
                        const commandLine = healthInfo?.commandLine || '';
                        // CRITICAL FIX: Double-check that process belongs to THIS project
                        // First try reading socket path from process environment (most reliable)
                        const processSocketPath = this.getProcessSocketPath(pid);
                        if (processSocketPath && processSocketPath !== this.socketPath) {
                            logger.warn({
                                pid,
                                processSocketPath,
                                thisProjectSocket: this.socketPath,
                            }, '[EmbeddingServerManager] SAFETY CHECK: Process socket path does not match this project - skipping kill');
                            continue;
                        }
                        // Fallback: verify socket path is in command line
                        if (!processSocketPath && !commandLine.includes(this.socketPath)) {
                            logger.warn({
                                pid,
                                commandLine,
                                thisProjectSocket: this.socketPath,
                            }, '[EmbeddingServerManager] SAFETY CHECK: Process command line does not match this project - skipping kill');
                            continue;
                        }
                        // Only kill if older than max age
                        if (ageHours !== null && ageHours <= this.config.maxProcessAgeHours) {
                            logger.info({
                                pid,
                                ageHours: ageHours.toFixed(2),
                                maxAgeHours: this.config.maxProcessAgeHours,
                                socketPath: this.socketPath,
                            }, '[EmbeddingServerManager] Orphaned process is recent and belongs to this project, keeping it');
                            continue;
                        }
                        logger.info({
                            pid,
                            ageHours: ageHours?.toFixed(2) || 'unknown',
                            maxAgeHours: this.config.maxProcessAgeHours,
                            commandLine: healthInfo?.commandLine || 'unknown',
                            socketPath: this.socketPath,
                        }, '[EmbeddingServerManager] Killing stale orphaned process for THIS project (zombie)');
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
                        logger.debug({ pid, error: err }, '[EmbeddingServerManager] Failed to kill orphaned process');
                    }
                }
            }
        }
        catch (err) {
            // pgrep may not exist or may fail - that's OK
            logger.debug({ error: err }, '[EmbeddingServerManager] pgrep failed (may not exist)');
        }
    }
    /**
     * Get the SPECMEM_EMBEDDING_SOCKET env var from a running process
     * Returns the socket path this process is bound to, or null if not found
     */
    getProcessSocketPath(pid) {
        try {
            const environPath = `/proc/${pid}/environ`;
            if (!existsSync(environPath)) {
                return null;
            }
            const environ = readFileSync(environPath, 'utf8');
            // Environment variables are null-separated
            const envVars = environ.split('\0');
            for (const envVar of envVars) {
                if (envVar.startsWith('SPECMEM_EMBEDDING_SOCKET=')) {
                    return envVar.split('=')[1];
                }
            }
            return null;
        }
        catch {
            return null;
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
            logger.debug({ pid, error: err }, '[EmbeddingServerManager] Failed to get orphan process info');
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
            expectedProcessName: 'frankenstein-embeddings',
            projectPath: this.projectPath,
        });
        if (!healthInfo) {
            logger.debug('[EmbeddingServerManager] No PID file found');
            return;
        }
        logger.debug({
            pid: healthInfo.pid,
            processExists: healthInfo.processExists,
            isEmbeddingServer: healthInfo.isEmbeddingServer,
            ageHours: healthInfo.processAgeHours?.toFixed(2) || 'unknown',
            recommendedAction: healthInfo.recommendedAction,
            statusMessage: healthInfo.statusMessage,
        }, '[EmbeddingServerManager] Checked PID file process');
        if (healthInfo.processExists) {
            await this.killProcessWithHealthInfo(healthInfo);
        }
        else {
            logger.debug({ pid: healthInfo.pid }, '[EmbeddingServerManager] Process from PID file no longer exists');
        }
        this.removePidFile();
    }
    /**
     * Find the embedding script path
     *
     * PRIORITY: frankenstein-embeddings.py (has ALL 4 optimizations + ACK verification)
     *         > warm-start.sh (Docker)
     *
     * We NEVER use a model that hasn't been optimized with all 4 optimizations.
     */
    findEmbeddingScript() {
        // specmem root dir is 2 levels up from src/mcp/
        const specmemRoot = dirname(dirname(__dirname));
        // PRIORITY 1: frankenstein-embeddings.py (OPTIMIZED - has all 4 optimizations + ACK verification)
        const embeddingPaths = [
            // Project-local (development)
            join(this.projectPath, 'embedding-sandbox', 'frankenstein-embeddings.py'),
            // SpecMem package root (via __dirname - works for all installs)
            join(specmemRoot, 'embedding-sandbox', 'frankenstein-embeddings.py'),
            // Local npm install
            join(this.projectPath, 'node_modules', 'specmem-hardwicksoftware', 'embedding-sandbox', 'frankenstein-embeddings.py'),
            // Global npm install fallback (platform-agnostic)
            join(dirname(dirname(process.execPath)), 'lib', 'node_modules', 'specmem-hardwicksoftware', 'embedding-sandbox', 'frankenstein-embeddings.py'),
        ];
        for (const p of embeddingPaths) {
            if (existsSync(p)) {
                logger.info({ path: p }, '[EmbeddingServerManager] Using frankenstein-embeddings.py (all 4 optimizations + ACK verification)');
                return { script: p, useWarmStart: false };
            }
        }
        // PRIORITY 2: warm-start.sh (Docker-based)
        const warmStartPaths = [
            join(this.projectPath, 'embedding-sandbox', 'warm-start.sh'),
            join(specmemRoot, 'embedding-sandbox', 'warm-start.sh'),
            join(this.projectPath, 'node_modules', 'specmem-hardwicksoftware', 'embedding-sandbox', 'warm-start.sh'),
            join(dirname(dirname(process.execPath)), 'lib', 'node_modules', 'specmem-hardwicksoftware', 'embedding-sandbox', 'warm-start.sh'),
        ];
        for (const p of warmStartPaths) {
            if (existsSync(p)) {
                logger.info({ path: p }, '[EmbeddingServerManager] Using warm-start.sh (Docker mode)');
                return { script: p, useWarmStart: true };
            }
        }
        logger.error({ searchedPaths: [...embeddingPaths, ...warmStartPaths] }, '[EmbeddingServerManager] Embedding script not found');
        return null;
    }
    /**
     * Wait for socket file to appear AND server to be ready
     * FIX: Task #12 - Race condition fix: Poll with health checks instead of just file existence
     * The 60s timeout window was creating a race where socket file exists but server not ready
     */
    async waitForSocket() {
        const startTime = Date.now();
        const fileCheckInterval = 200; // fast initial polling for file
        // FIX: Increased health check interval to account for health check timeout (10s default)
        // Previous 500ms was too aggressive - health check itself takes up to 10s
        const healthCheckInterval = 1000; // 1 second between health check attempts
        // FIX: Removed fixed maxHealthCheckAttempts - now uses time-based cutoff only
        // This ensures we use the full startupTimeoutMs window instead of arbitrary attempt limit
        logger.debug({ socketPath: this.socketPath, timeoutMs: this.config.startupTimeoutMs }, '[EmbeddingServerManager] Waiting for socket with readiness polling');
        // Phase 1: Wait for socket file to appear (use 50% of timeout for file appearance)
        const fileWaitDeadline = startTime + (this.config.startupTimeoutMs * 0.5);
        while (Date.now() < fileWaitDeadline) {
            if (existsSync(this.socketPath)) {
                logger.debug({ elapsed: Date.now() - startTime }, '[EmbeddingServerManager] Socket file appeared, starting health check polling');
                break;
            }
            await this.sleep(fileCheckInterval);
        }
        if (!existsSync(this.socketPath)) {
            logger.error({ elapsed: Date.now() - startTime, timeoutMs: this.config.startupTimeoutMs }, '[EmbeddingServerManager] Socket file never appeared within timeout');
            return false;
        }
        // Phase 2: Poll health check until server responds
        // FIX: Use remaining time from startup timeout instead of fixed attempt count
        // This prevents the case where health checks + interval exceed the startup timeout
        let healthAttempts = 0;
        const healthCheckDeadline = startTime + this.config.startupTimeoutMs;
        while (Date.now() < healthCheckDeadline) {
            healthAttempts++;
            const healthResult = await this.healthCheck();
            if (healthResult.success) {
                logger.info({
                    elapsed: Date.now() - startTime,
                    healthAttempts,
                    responseTimeMs: healthResult.responseTimeMs,
                    dimensions: healthResult.dimensions,
                }, '[EmbeddingServerManager] Server ready - health check passed');
                return true;
            }
            // FIX: Check if we have enough time for another health check before sleeping
            const remainingTime = healthCheckDeadline - Date.now();
            if (remainingTime < healthCheckInterval) {
                logger.debug({
                    attempt: healthAttempts,
                    remainingMs: remainingTime,
                    error: healthResult.error,
                }, '[EmbeddingServerManager] Health check failed, not enough time for another attempt');
                break;
            }
            logger.debug({
                attempt: healthAttempts,
                remainingMs: remainingTime,
                error: healthResult.error,
            }, '[EmbeddingServerManager] Health check failed, retrying...');
            await this.sleep(healthCheckInterval);
        }
        logger.error({
            elapsed: Date.now() - startTime,
            healthAttempts,
            socketExists: existsSync(this.socketPath),
        }, '[EmbeddingServerManager] Server never became ready - health checks exhausted');
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
        logger.warn({ code, signal, wasRunning }, '[EmbeddingServerManager] Process exited unexpectedly');
        // Attempt restart if not shutting down
        this.attemptRestart();
    }
    /**
     * Attempt to restart the server
     */
    async attemptRestart() {
        // Phase 4: Don't restart if user manually stopped
        if (this.isStoppedByUser()) {
            logger.info('[EmbeddingServerManager] Skipping restart - stopped by user');
            return;
        }
        // Phase 4: Check for restart loop (>3 restarts in 60 seconds)
        const loopInfo = this.getRestartLoopInfo();
        if (loopInfo.inLoop) {
            logger.error({
                recentRestarts: loopInfo.recentRestarts,
                windowSeconds: 60,
            }, '[EmbeddingServerManager] RESTART LOOP DETECTED - backing off');
            this.emit('restart_loop', loopInfo);
            // Exponential backoff: wait 2^restartCount seconds (max 5 minutes)
            const backoffMs = Math.min(Math.pow(2, this.restartCount) * 1000, 300000);
            logger.info({ backoffMs }, '[EmbeddingServerManager] Waiting for exponential backoff');
            await this.sleep(backoffMs);
        }
        // Check cooldown
        const timeSinceLastRestart = Date.now() - this.lastRestartTime;
        if (timeSinceLastRestart < this.config.restartCooldownMs) {
            const waitTime = this.config.restartCooldownMs - timeSinceLastRestart;
            logger.debug({ waitTime }, '[EmbeddingServerManager] Waiting for restart cooldown');
            await this.sleep(waitTime);
        }
        // Check max restarts
        if (this.restartCount >= this.config.maxRestartAttempts) {
            logger.error({
                restartCount: this.restartCount,
                maxAttempts: this.config.maxRestartAttempts,
            }, '[EmbeddingServerManager] Max restart attempts reached');
            this.emit('restart_failed', { attempts: this.restartCount });
            return;
        }
        this.restartCount++;
        this.lastRestartTime = Date.now();
        // Phase 4: Track restart timestamp for loop detection
        this.restartTimestamps.push(Date.now());
        // Keep only last 10 timestamps
        if (this.restartTimestamps.length > 10) {
            this.restartTimestamps.shift();
        }
        logger.info({ attempt: this.restartCount }, '[EmbeddingServerManager] Attempting restart');
        this.emit('restarting', { attempt: this.restartCount });
        const success = await this.start();
        if (!success) {
            // Will retry on next health check
            logger.warn('[EmbeddingServerManager] Restart attempt failed');
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
                        dimensions: result.dimensions,
                        previousFailures: this.consecutiveFailures,
                    }, '[EmbeddingServerManager] Health check recovered - server is healthy');
                }
                else {
                    logger.debug({
                        responseTimeMs: result.responseTimeMs,
                        dimensions: result.dimensions,
                    }, '[EmbeddingServerManager] Health check successful');
                }
                this.consecutiveFailures = 0;
            }
            else {
                // Check if server was killed by KYS watchdog - if so, auto-respawn immediately
                if (this.wasKilledByKYS()) {
                    logger.info('[EmbeddingServerManager] Health check failed - server was killed by KYS watchdog, auto-respawning...');
                    const respawned = await this.autoRespawnIfKYSDeath();
                    if (respawned) {
                        logger.info('[EmbeddingServerManager] Auto-respawn after KYS death successful');
                        return; // Skip failure counting, server is back
                    }
                }
                this.consecutiveFailures++;
                logger.warn({
                    failures: this.consecutiveFailures,
                    maxFailures: this.config.maxFailuresBeforeRestart,
                    error: result.error,
                    responseTimeMs: result.responseTimeMs,
                    socketPath: this.socketPath,
                    socketExists: existsSync(this.socketPath),
                }, '[EmbeddingServerManager] Health check failed');
                this.emit('unhealthy', { failures: this.consecutiveFailures });
                // Attempt restart if too many failures
                if (this.consecutiveFailures >= this.config.maxFailuresBeforeRestart) {
                    logger.warn({
                        failures: this.consecutiveFailures,
                        maxFailures: this.config.maxFailuresBeforeRestart,
                        restartCount: this.restartCount,
                    }, '[EmbeddingServerManager] Too many consecutive failures, initiating restart...');
                    this.consecutiveFailures = 0;
                    await this.attemptRestart();
                }
            }
        }, this.config.healthCheckIntervalMs);
        // Don't prevent process exit
        this.healthCheckTimer.unref();
        logger.debug('[EmbeddingServerManager] Health monitoring started');
    }
    /**
     * Stop health monitoring
     */
    stopHealthMonitoring() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
            logger.debug('[EmbeddingServerManager] Health monitoring stopped');
        }
    }
    /**
     * Start KYS (Keep Yourself Safe) heartbeat - two-way ack system
     *
     * Sends {"type": "kys", "text": "kurt cobain t minus 25"} every 25 seconds.
     * If the embedding server doesn't receive this heartbeat within 30 seconds,
     * it commits suicide to prevent zombie processes.
     *
     * This prevents orphan embedding servers when MCP crashes or is killed.
     */
    startKysHeartbeat() {
        // Stop existing heartbeat if any
        this.stopKysHeartbeat();
        logger.info('[EmbeddingServerManager] Starting KYS heartbeat (every 25s)');
        this.kysHeartbeatTimer = setInterval(async () => {
            if (!this.isRunning || this.isShuttingDown) {
                return;
            }
            try {
                const socket = createConnection(this.socketPath);
                let responded = false;
                socket.setTimeout(5000); // 5 second timeout for kys ack
                socket.on('connect', () => {
                    socket.write(JSON.stringify({
                        type: 'kys',
                        text: 'kurt cobain t minus 25'
                    }) + '\n');
                });
                socket.on('data', (data) => {
                    responded = true;
                    try {
                        const response = JSON.parse(data.toString().trim());
                        logger.debug({
                            status: response.status,
                            ack: response.ack,
                        }, '[EmbeddingServerManager] KYS heartbeat acknowledged');
                    }
                    catch (e) {
                        // Parse error, but we got data so server is alive
                    }
                    socket.destroy();
                });
                socket.on('error', (err) => {
                    if (!responded) {
                        logger.warn({ error: err.message }, '[EmbeddingServerManager] KYS heartbeat failed');
                    }
                    socket.destroy();
                });
                socket.on('timeout', () => {
                    if (!responded) {
                        logger.warn('[EmbeddingServerManager] KYS heartbeat timed out');
                    }
                    socket.destroy();
                });
            }
            catch (err) {
                logger.warn({ error: err.message }, '[EmbeddingServerManager] Failed to send KYS heartbeat');
            }
        }, this.KYS_HEARTBEAT_INTERVAL_MS);
        // Don't prevent process exit
        this.kysHeartbeatTimer.unref();
    }
    /**
     * Stop KYS heartbeat
     */
    stopKysHeartbeat() {
        if (this.kysHeartbeatTimer) {
            clearInterval(this.kysHeartbeatTimer);
            this.kysHeartbeatTimer = null;
            logger.debug('[EmbeddingServerManager] KYS heartbeat stopped');
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
            logger.debug({ pid, path: this.pidFilePath }, '[EmbeddingServerManager] Wrote PID file');
        }
        catch (err) {
            logger.error({ error: err }, '[EmbeddingServerManager] Failed to write PID file');
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
     * Read PID file with timestamp
     */
    readPidFileWithTimestamp() {
        try {
            if (!existsSync(this.pidFilePath)) {
                return null;
            }
            const content = readFileSync(this.pidFilePath, 'utf8').trim();
            const parts = content.split(':');
            const pid = parseInt(parts[0], 10);
            const timestamp = parseInt(parts[1], 10);
            if (isNaN(pid))
                return null;
            return { pid, timestamp: isNaN(timestamp) ? Date.now() : timestamp };
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
                logger.debug('[EmbeddingServerManager] Removed PID file');
            }
        }
        catch (err) {
            logger.debug({ error: err }, '[EmbeddingServerManager] Failed to remove PID file');
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
// FIX: Use per-project Map instead of global singleton
// This prevents cross-project socket conflicts when running multiple instances
const embeddingManagersByProject = new Map();
/**
 * Get or create the embedding server manager for a specific project
 * Uses per-project Map pattern to ensure proper isolation
 */
export function getEmbeddingServerManager(config) {
    const projectPath = getProjectPath();
    // Check if we already have a manager for this project
    if (embeddingManagersByProject.has(projectPath)) {
        return embeddingManagersByProject.get(projectPath);
    }
    // Create new manager for this project
    const manager = new EmbeddingServerManager(config);
    embeddingManagersByProject.set(projectPath, manager);
    logger.info({ projectPath, totalManagers: embeddingManagersByProject.size }, '[EmbeddingServerManager] Created new per-project manager');
    return manager;
}
/**
 * Reset the embedding server manager for a specific project (or current project)
 */
export async function resetEmbeddingServerManager(projectPath) {
    const targetPath = projectPath || getProjectPath();
    if (embeddingManagersByProject.has(targetPath)) {
        const manager = embeddingManagersByProject.get(targetPath);
        await manager.shutdown();
        embeddingManagersByProject.delete(targetPath);
        logger.info({ projectPath: targetPath }, '[EmbeddingServerManager] Reset project manager');
    }
}
/**
 * Reset ALL embedding server managers (for global cleanup)
 */
export async function resetAllEmbeddingServerManagers() {
    const promises = [];
    for (const [projectPath, manager] of embeddingManagersByProject) {
        promises.push(manager.shutdown().then(() => {
            logger.info({ projectPath }, '[EmbeddingServerManager] Shutdown manager');
        }));
    }
    await Promise.all(promises);
    embeddingManagersByProject.clear();
}
//# sourceMappingURL=embeddingServerManager.js.map