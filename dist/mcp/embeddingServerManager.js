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
import { getProjectSchema } from '../db/projectNamespacing.js';
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
    // Circuit breaker configuration (Issue #10)
    cbRestartWindowMs: parseInt(process.env['SPECMEM_RESTART_WINDOW_MS'] || '300000', 10),
    cbMaxRestartsInWindow: parseInt(process.env['SPECMEM_RESTART_MAX_IN_WINDOW'] || '5', 10),
    cbCooldownMs: parseInt(process.env['SPECMEM_RESTART_COOLDOWN_MS'] || '60000', 10),
    cbMaxCooldownMs: parseInt(process.env['SPECMEM_RESTART_MAX_COOLDOWN_MS'] || '600000', 10),
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
    // FIX: Startup grace period - prevents health monitoring from reporting errors during initialization
    startupGraceUntil = 0;
    // FIX: File-based lock to prevent CROSS-PROCESS concurrent starts
    // The in-memory isStarting flag only prevents within same process
    // Multiple MCP servers (subagents, sessions) need file-based coordination
    startLockPath;
    START_LOCK_TIMEOUT_MS = 60000; // 60 second lock timeout
    // Phase 4: Track if user manually stopped server (prevents auto-restart)
    stoppedFlagPath;
    // Phase 4: Track restart timestamps for loop detection
    restartTimestamps = [];
    // Circuit breaker state (Issue #10)
    // States: 'closed' (normal), 'open' (tripped, blocking restarts), 'half-open' (testing one restart)
    cbState = 'closed';
    cbRestartTimestamps = []; // sliding window of restart timestamps
    cbCurrentCooldownMs = 0; // current cooldown duration (doubles on repeated failures)
    cbCooldownUntil = 0; // timestamp when cooldown expires
    cbLastStateChange = Date.now();
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
        // FIX 1B: Process deduplication check BEFORE acquiring lock
        // Find all running embedding server processes and try to reuse one
        const runningServers = this.findRunningEmbeddingServers();
        if (runningServers.length > 0) {
            logger.info({ count: runningServers.length, pids: runningServers.map(s => s.pid) },
                '[EmbeddingServerManager] FIX 1B: Found existing embedding server processes, checking health');
            // Test if any existing process is healthy via socket
            // CRITICAL FIX: Retry health check up to 15s to give freshly-spawned servers time to warm up
            // This prevents MCP bootstrap from killing servers that init just spawned
            if (existsSync(this.socketPath)) {
                for (let attempt = 0; attempt < 6; attempt++) {
                    const healthResult = await this.healthCheck();
                    if (healthResult.success) {
                        logger.info({
                            pids: runningServers.map(s => s.pid),
                            responseTimeMs: healthResult.responseTimeMs,
                            attempt,
                        }, '[EmbeddingServerManager] FIX 1B: Existing server is healthy - reusing instead of spawning new');
                        this.isRunning = true;
                        this.startTime = Date.now();
                        this.consecutiveFailures = 0;
                        return true;
                    }
                    if (attempt < 5) {
                        logger.debug({ attempt }, '[EmbeddingServerManager] FIX 1B: Health check failed, waiting 3s before retry...');
                        await this.sleep(3000);
                        // Re-check socket still exists
                        if (!existsSync(this.socketPath)) break;
                    }
                }
            } else {
                // Socket doesn't exist yet but processes are running - wait for socket to appear
                logger.debug('[EmbeddingServerManager] FIX 1B: No socket yet, waiting up to 15s for server to create it');
                for (let i = 0; i < 15; i++) {
                    await this.sleep(1000);
                    if (existsSync(this.socketPath)) {
                        const healthResult = await this.healthCheck();
                        if (healthResult.success) {
                            logger.info({
                                pids: runningServers.map(s => s.pid),
                                responseTimeMs: healthResult.responseTimeMs,
                            }, '[EmbeddingServerManager] FIX 1B: Server became healthy after waiting - reusing');
                            this.isRunning = true;
                            this.startTime = Date.now();
                            this.consecutiveFailures = 0;
                            return true;
                        }
                    }
                }
            }
            // Existing processes found but unhealthy after retries - kill only THIS project's before starting fresh
            // PROJECT ISOLATION: Filter to only processes belonging to this project
            const thisProjectServers = runningServers.filter(s => this._isProcessForThisProject(s.pid));
            logger.warn({ count: thisProjectServers.length, totalFound: runningServers.length },
                '[EmbeddingServerManager] FIX 1B: Existing processes are unhealthy, killing this project\'s before fresh start');
            for (const server of thisProjectServers) {
                try {
                    process.kill(server.pid, 'SIGTERM');
                    logger.info({ pid: server.pid }, '[EmbeddingServerManager] FIX 1B: Sent SIGTERM to unhealthy server');
                }
                catch (err) {
                    logger.debug({ pid: server.pid, error: err.message }, '[EmbeddingServerManager] FIX 1B: Failed to SIGTERM process');
                }
            }
            // Wait 2 seconds for processes to terminate
            await this.sleep(2000);
            // Force kill any survivors
            for (const server of thisProjectServers) {
                try {
                    process.kill(server.pid, 0); // Check if alive
                    process.kill(server.pid, 'SIGKILL');
                    logger.info({ pid: server.pid }, '[EmbeddingServerManager] FIX 1B: Force killed surviving process');
                }
                catch {
                    // Already dead - good
                }
            }
            // Clean up stale socket
            if (existsSync(this.socketPath)) {
                try { unlinkSync(this.socketPath); } catch { /* ignore */ }
            }
        }
        // FIX 1C: PID file validation before acquiring lock
        // Check if PID file points to a live, healthy process we can reuse
        const pidData = this.readPidFileWithTimestamp();
        if (pidData && pidData.pid) {
            try {
                process.kill(pidData.pid, 0); // Check if process is alive
                // Process is alive - check if it's healthy
                if (existsSync(this.socketPath)) {
                    const pidHealthResult = await this.healthCheck();
                    if (pidHealthResult.success) {
                        logger.info({
                            pid: pidData.pid,
                            responseTimeMs: pidHealthResult.responseTimeMs,
                        }, '[EmbeddingServerManager] FIX 1C: PID file process is alive and healthy - reusing');
                        this.isRunning = true;
                        this.startTime = Date.now();
                        this.consecutiveFailures = 0;
                        return true;
                    }
                }
                logger.info({ pid: pidData.pid },
                    '[EmbeddingServerManager] FIX 1C: PID file process alive but not healthy, continuing with start');
            }
            catch {
                // Process is dead - clean up PID file
                logger.info({ pid: pidData.pid },
                    '[EmbeddingServerManager] FIX 1C: PID file process is dead, cleaning up');
                this.removePidFile();
            }
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
        // FIX: Set dynamic startup grace period based on configured startupTimeoutMs
        this.startupGraceUntil = Date.now() + this.config.startupTimeoutMs;
        logger.info({ graceMs: this.config.startupTimeoutMs }, '[EmbeddingServerManager] Starting embedding server (grace period active)...');
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
        // ═══════════════════════════════════════════════════════════════════════════
        // PRE-SPAWN ORPHAN KILL: Ensure NO other Frankenstein is running for this socket
        // This is the LAST line of defense before spawning a new process
        // ═══════════════════════════════════════════════════════════════════════════
        try {
            const killWaitMs = parseInt(process.env['SPECMEM_ORPHAN_KILL_WAIT_MS'] || '2000', 10);
            // 1. Kill via PID file
            const pidFilePath = join(dirname(this.socketPath), 'embedding.pid');
            if (existsSync(pidFilePath)) {
                const pidContent = readFileSync(pidFilePath, 'utf8').trim();
                const oldPid = parseInt(pidContent.split(':')[0], 10);
                if (oldPid && !isNaN(oldPid) && oldPid !== process.pid) {
                    try {
                        process.kill(oldPid, 0);
                        logger.info({ pid: oldPid }, '[EmbeddingServerManager] Killing existing process before spawn');
                        process.kill(oldPid, 'SIGTERM');
                        await this.sleep(killWaitMs);
                        try {
                            process.kill(oldPid, 0);
                            process.kill(oldPid, 'SIGKILL');
                            logger.warn({ pid: oldPid }, '[EmbeddingServerManager] Force killed stubborn process');
                        } catch { /* dead */ }
                    } catch { /* not running */ }
                }
            }
            // 2. Kill via pgrep as fallback (catches processes without PID files)
            // PROJECT ISOLATION: Only kill processes belonging to THIS project
            try {
                const { execSync: execSyncLocal } = await import('child_process');
                const pids = execSyncLocal(`pgrep -f "frankenstein-embeddings.py" 2>/dev/null || true`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
                let killedAny = false;
                for (const pidStr of pids) {
                    const pid = parseInt(pidStr, 10);
                    if (pid && pid !== process.pid) {
                        // PROJECT ISOLATION: Skip processes belonging to other projects
                        if (!this._isProcessForThisProject(pid)) {
                            logger.debug({ pid }, '[EmbeddingServerManager] Pre-spawn: Skipping process belonging to another project');
                            continue;
                        }
                        try {
                            process.kill(pid, 'SIGTERM');
                            killedAny = true;
                            logger.info({ pid }, '[EmbeddingServerManager] Killed orphan frankenstein process (pgrep)');
                        } catch { /* already dead */ }
                    }
                }
                if (killedAny) {
                    await this.sleep(killWaitMs);
                }
            } catch { /* pgrep not available or no matches */ }
            // 3. Clean stale socket
            if (existsSync(this.socketPath)) {
                unlinkSync(this.socketPath);
                logger.debug('[EmbeddingServerManager] Removed stale socket before spawn');
            }
        } catch (preSpawnErr) {
            logger.debug({ error: preSpawnErr }, '[EmbeddingServerManager] Pre-spawn cleanup failed (non-fatal)');
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
            // CRITICAL: Pass DB schema name so embedding server queries the right schema
            const projectSchema = getProjectSchema(this.projectPath);
            const env = mergeWithProjectEnv({
                SPECMEM_SOCKET_DIR: socketDir,
                SPECMEM_EMBEDDING_SOCKET: this.socketPath,
                SPECMEM_EMBEDDING_IDLE_TIMEOUT: '0',
                SPECMEM_DB_SCHEMA: projectSchema,
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
            // FIX: Clear grace period once server is verified running
            if (verifyHealth.success) {
                this.startupGraceUntil = 0;
            }
            this.releaseStartLock(); // Release file-based lock
            return true;
        }
        catch (err) {
            logger.error({ error: err }, '[EmbeddingServerManager] Failed to start server');
            this.isStarting = false; // Reset starting flag on error
            this.startupGraceUntil = 0; // Clear grace on failure too
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
            // FIX 1A: Strengthened lock acquisition with PID validation and stale detection
            // First check if lock exists and is stale
            if (existsSync(this.startLockPath)) {
                try {
                    const lockContent = readFileSync(this.startLockPath, 'utf8').trim();
                    const parts = lockContent.split(':');
                    const lockTime = parseInt(parts[0], 10);
                    const lockPid = parseInt(parts[1], 10);
                    const lockAge = Date.now() - lockTime;
                    // FIX 1A: Reduced stale threshold from 60s to 120s for robustness
                    const STALE_LOCK_THRESHOLD_MS = 120000; // 120 seconds
                    if (lockAge >= STALE_LOCK_THRESHOLD_MS) {
                        // Stale lock by time - remove it
                        logger.warn({ lockAge, lockPid, thresholdMs: STALE_LOCK_THRESHOLD_MS }, '[EmbeddingServerManager] Removing stale start lock (exceeded time threshold)');
                        unlinkSync(this.startLockPath);
                    }
                    else if (!isNaN(lockPid) && lockPid > 0) {
                        // FIX 1A: Lock is recent - check if the owning process is still alive
                        try {
                            process.kill(lockPid, 0); // Signal 0 = check existence
                            // Process is alive and lock is recent - respect it
                            logger.debug({ lockAge, lockPid }, '[EmbeddingServerManager] Lock held by alive process');
                            return false;
                        }
                        catch (killErr) {
                            // Process is dead - stale lock from a crashed process
                            logger.warn({ lockPid, lockAge }, '[EmbeddingServerManager] Lock owner process is dead, removing stale lock');
                            try {
                                unlinkSync(this.startLockPath);
                            }
                            catch { /* ignore */ }
                        }
                    }
                    else {
                        // Recent lock but no valid PID - respect it
                        logger.debug({ lockAge, lockPid }, '[EmbeddingServerManager] Lock held by another process (no valid PID)');
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
            // FIX 1A: Write PID + timestamp to lock file for stale detection
            const lockContent = `${Date.now()}:${process.pid}`;
            writeFileSync(fd, lockContent, 'utf8');
            closeSync(fd);
            logger.debug({ pid: process.pid }, '[EmbeddingServerManager] Acquired start lock atomically');
            return true;
        }
        catch (err) {
            if (err.code === 'EEXIST') {
                // FIX 1A: On EEXIST, read the lock content and check if owner is alive
                try {
                    const lockContent = readFileSync(this.startLockPath, 'utf8').trim();
                    const parts = lockContent.split(':');
                    const lockTime = parseInt(parts[0], 10);
                    const lockPid = parseInt(parts[1], 10);
                    const lockAge = Date.now() - lockTime;
                    // Check if lock is stale (>120s) or owner process is dead
                    let isStale = lockAge > 120000;
                    if (!isStale && !isNaN(lockPid) && lockPid > 0) {
                        try {
                            process.kill(lockPid, 0);
                            // Owner alive, lock valid
                        }
                        catch {
                            // Owner dead, lock is stale
                            isStale = true;
                        }
                    }
                    if (isStale) {
                        logger.warn({ lockPid, lockAge }, '[EmbeddingServerManager] EEXIST but lock is stale, removing and retrying');
                        try {
                            unlinkSync(this.startLockPath);
                        }
                        catch { /* ignore */ }
                        // Retry once after removing stale lock
                        try {
                            const fd = openSync(this.startLockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
                            const newLockContent = `${Date.now()}:${process.pid}`;
                            writeFileSync(fd, newLockContent, 'utf8');
                            closeSync(fd);
                            logger.debug({ pid: process.pid }, '[EmbeddingServerManager] Acquired start lock on retry after stale removal');
                            return true;
                        }
                        catch (retryErr) {
                            logger.debug('[EmbeddingServerManager] Retry lock acquisition failed - another process won the race');
                            return false;
                        }
                    }
                }
                catch (readErr) {
                    // Can't read lock file - just report as held
                }
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
     * FIX 1B: Find all running embedding server processes using ps
     * Returns array of { pid, command } objects for each running frankenstein-embeddings.py process
     */
    findRunningEmbeddingServers() {
        try {
            const result = execSync('ps aux | grep frankenstein-embeddings.py | grep -v grep', {
                encoding: 'utf8',
                timeout: 5000,
            }).trim();
            if (!result) return [];
            const processes = [];
            for (const line of result.split('\n')) {
                if (!line.trim()) continue;
                const parts = line.trim().split(/\s+/);
                const pid = parseInt(parts[1], 10);
                if (!isNaN(pid)) {
                    processes.push({ pid, command: parts.slice(10).join(' ') });
                }
            }
            return processes;
        }
        catch (err) {
            // ps/grep returns exit code 1 when no matches found - that's normal
            return [];
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
                // Process all complete lines in the buffer
                // The server may send multiple lines: {"status": "processing"} then {"embedding": [...]}
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    if (resolved)
                        return;
                    const line = buffer.slice(0, newlineIndex);
                    buffer = buffer.slice(newlineIndex + 1);
                    try {
                        const response = JSON.parse(line);
                        // Handle error responses
                        if (response.error) {
                            clearTimeout(timeout);
                            resolved = true;
                            socket.end();
                            reject(new Error(response.error));
                            return;
                        }
                        // Skip "processing" status messages - wait for actual embedding
                        if (response.status === 'processing') {
                            logger.debug({ textLength: response.text_length }, '[EmbeddingServerManager] Embedding request queued, waiting for result...');
                            continue; // Keep reading for the actual embedding
                        }
                        // Got the embedding!
                        if (response.embedding && Array.isArray(response.embedding)) {
                            clearTimeout(timeout);
                            resolved = true;
                            socket.end();
                            resolve(response.embedding);
                            return;
                        }
                        // Unknown response format - log but keep waiting
                        logger.warn({ response: JSON.stringify(response).slice(0, 100) }, '[EmbeddingServerManager] Unexpected response format, continuing to wait');
                    }
                    catch (parseErr) {
                        logger.warn({ line: line.slice(0, 100) }, '[EmbeddingServerManager] Failed to parse line, continuing to wait');
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
     * Generate embeddings for multiple texts in a SINGLE socket connection.
     * Sends {texts: [...]} → gets {embeddings: [[...], [...], ...]}
     * Much faster than N individual generateEmbeddingViaSocket calls.
     */
    async generateEmbeddingsBatchViaSocket(texts) {
        if (!texts || texts.length === 0) return [];
        return new Promise((resolve, reject) => {
            const socket = createConnection(this.socketPath);
            let buffer = '';
            let resolved = false;
            // Scale timeout with batch size: 60s base + 1s per text
            const timeoutMs = Math.max(60000, 60000 + texts.length * 1000);
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    socket.destroy();
                    reject(new Error(`Batch embedding timeout after ${timeoutMs}ms for ${texts.length} texts`));
                }
            }, timeoutMs);
            socket.on('connect', () => {
                socket.write(JSON.stringify({ texts }) + '\n');
            });
            socket.on('data', (data) => {
                buffer += data.toString();
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    if (resolved) return;
                    const line = buffer.slice(0, newlineIndex);
                    buffer = buffer.slice(newlineIndex + 1);
                    try {
                        const response = JSON.parse(line);
                        if (response.error) {
                            clearTimeout(timeout);
                            resolved = true;
                            socket.end();
                            reject(new Error(response.error));
                            return;
                        }
                        if (response.status === 'processing') {
                            continue; // Wait for actual result
                        }
                        if (response.embeddings && Array.isArray(response.embeddings)) {
                            clearTimeout(timeout);
                            resolved = true;
                            socket.end();
                            resolve(response.embeddings);
                            return;
                        }
                        logger.warn({ responseKeys: Object.keys(response) }, '[EmbeddingServerManager] Unexpected batch response, continuing');
                    } catch (parseErr) {
                        logger.warn({ line: line.slice(0, 100) }, '[EmbeddingServerManager] Failed to parse batch line');
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
            socket.on('close', () => {
                clearTimeout(timeout);
                if (!resolved) {
                    resolved = true;
                    reject(new Error('Socket closed before batch embedding response received'));
                }
            });
        });
    }
    /**
     * Trigger server-side codebase processing via process_codebase command.
     * The Python server reads files from DB that have NULL embeddings
     * and generates embeddings in large batches (200/batch) with direct DB writes.
     * This is the FASTEST path for large codebases (30k+ files).
     */
    async triggerServerSideProcessing(projectPath = null, batchSize = 200) {
        return new Promise((resolve, reject) => {
            const socket = createConnection(this.socketPath);
            let buffer = '';
            let resolved = false;
            // Server-side processing can take a long time for large codebases
            const timeoutMs = 600000; // 10 minutes
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    socket.destroy();
                    reject(new Error(`Server-side codebase processing timeout after ${timeoutMs}ms`));
                }
            }, timeoutMs);
            socket.on('connect', () => {
                const request = {
                    process_codebase: true,
                    batch_size: batchSize,
                    limit: 0, // Process ALL files
                };
                if (projectPath) {
                    request.project_path = projectPath;
                }
                socket.write(JSON.stringify(request) + '\n');
                logger.info({ projectPath, batchSize }, '[EmbeddingServerManager] Triggered server-side codebase processing');
            });
            socket.on('data', (data) => {
                buffer += data.toString();
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    if (resolved) return;
                    const line = buffer.slice(0, newlineIndex);
                    buffer = buffer.slice(newlineIndex + 1);
                    try {
                        const response = JSON.parse(line);
                        if (response.error) {
                            clearTimeout(timeout);
                            resolved = true;
                            socket.end();
                            reject(new Error(response.error));
                            return;
                        }
                        if (response.status === 'processing') {
                            logger.debug('[EmbeddingServerManager] Server-side processing in progress...');
                            continue;
                        }
                        // process_codebase returns stats when done
                        if (response.total_processed !== undefined || response.processed !== undefined) {
                            clearTimeout(timeout);
                            resolved = true;
                            socket.end();
                            logger.info({ response }, '[EmbeddingServerManager] Server-side processing complete');
                            resolve(response);
                            return;
                        }
                        logger.debug({ responseKeys: Object.keys(response) }, '[EmbeddingServerManager] Server-side processing intermediate response');
                    } catch (parseErr) {
                        logger.warn({ line: line.slice(0, 100) }, '[EmbeddingServerManager] Failed to parse server-side response');
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
            socket.on('close', () => {
                clearTimeout(timeout);
                if (!resolved) {
                    resolved = true;
                    reject(new Error('Socket closed before server-side processing response'));
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
        this.startupGraceUntil = 0; // Clear any active grace period
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
        // FIX: Kill remaining embedding server processes for THIS project (orphans from previous sessions/subagents)
        // PROJECT ISOLATION: Only kill processes belonging to this project, not other projects
        const allServers = this.findRunningEmbeddingServers();
        const thisProjectStopServers = allServers.filter(s => this._isProcessForThisProject(s.pid));
        if (thisProjectStopServers.length > 0) {
            logger.info({ count: thisProjectStopServers.length, totalFound: allServers.length, pids: thisProjectStopServers.map(s => s.pid) },
                '[EmbeddingServerManager] Killing remaining embedding server processes for THIS project');
            for (const server of thisProjectStopServers) {
                try {
                    process.kill(server.pid, 'SIGTERM');
                } catch { /* already dead */ }
            }
            await this.sleep(2000);
            for (const server of thisProjectStopServers) {
                try {
                    process.kill(server.pid, 0);
                    process.kill(server.pid, 'SIGKILL');
                    logger.info({ pid: server.pid }, '[EmbeddingServerManager] Force killed orphan embedding process');
                } catch { /* already dead */ }
            }
        }
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
        // Reset circuit breaker on user-initiated start (Issue #10)
        this.resetCircuitBreaker();
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
        const graceActive = this.startupGraceUntil > 0 && Date.now() < this.startupGraceUntil;
        return {
            ...this.getStatus(),
            stoppedByUser: this.isStoppedByUser(),
            restartLoop: this.getRestartLoopInfo(),
            circuitBreaker: this.getCircuitBreakerStatus(),
            startupGrace: graceActive ? {
                active: true,
                remainingMs: this.startupGraceUntil - Date.now(),
                totalMs: this.config.startupTimeoutMs
            } : { active: false }
        };
    }
    // ==========================================================================
    // CIRCUIT BREAKER (Issue #10)
    // ==========================================================================
    /**
     * Manually reset the circuit breaker - callable from MCP tools
     * Resets the circuit breaker to closed state, clears all cooldowns and counters.
     * Use this when the underlying issue has been resolved (e.g., model file fixed, dependency installed).
     */
    resetCircuitBreaker() {
        const previousState = this.cbState;
        this.cbState = 'closed';
        this.cbRestartTimestamps = [];
        this.cbCurrentCooldownMs = 0;
        this.cbCooldownUntil = 0;
        this.cbLastStateChange = Date.now();
        // Also reset the legacy restart counters
        this.restartCount = 0;
        this.restartTimestamps = [];
        this.consecutiveFailures = 0;
        logger.info({
            previousState,
            newState: 'closed',
        }, '[EmbeddingServerManager] Circuit breaker manually reset: -> closed (all counters cleared)');
        this.emit('circuit_breaker', { state: 'closed', manualReset: true });
        return {
            success: true,
            previousState,
            newState: 'closed',
            message: `Circuit breaker reset from '${previousState}' to 'closed'. All cooldowns and counters cleared.`,
        };
    }
    /**
     * Get circuit breaker status for diagnostics
     */
    getCircuitBreakerStatus() {
        const now = Date.now();
        // Prune window for accurate count
        const restartsInWindow = this.cbRestartTimestamps.filter(
            ts => (now - ts) < this.config.cbRestartWindowMs
        ).length;
        return {
            state: this.cbState,
            restartsInWindow,
            maxRestartsInWindow: this.config.cbMaxRestartsInWindow,
            windowMs: this.config.cbRestartWindowMs,
            currentCooldownMs: this.cbCurrentCooldownMs,
            maxCooldownMs: this.config.cbMaxCooldownMs,
            cooldownUntil: this.cbCooldownUntil > 0 ? new Date(this.cbCooldownUntil).toISOString() : null,
            cooldownRemainingMs: this.cbCooldownUntil > now ? this.cbCooldownUntil - now : 0,
            lastStateChange: new Date(this.cbLastStateChange).toISOString(),
            timeSinceLastStateChangeMs: now - this.cbLastStateChange,
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
        // Step 0: KILL ANY ROGUE DOCKER EMBEDDING CONTAINERS
        // Docker containers crash-loop if they can't bind to the socket because
        // the native Python server already owns it. Clean them up FIRST.
        try {
            const projectDirName = require('path').basename(this.projectPath).toLowerCase().replace(/[^a-z0-9]/g, '');
            const containerName = `specmem-embedding-${projectDirName}`;
            // Check if container exists (running or stopped)
            const checkCmd = `docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${containerName}$"`;
            try {
                execSync(checkCmd, { stdio: 'pipe' });
                // Container exists - remove it forcefully
                logger.info({ containerName }, '[EmbeddingServerManager] Removing rogue Docker embedding container');
                execSync(`docker rm -f ${containerName} 2>/dev/null`, { stdio: 'pipe' });
                logger.info({ containerName }, '[EmbeddingServerManager] Rogue Docker container removed');
            }
            catch {
                // Container doesn't exist - good
                logger.debug({ containerName }, '[EmbeddingServerManager] No rogue Docker container found');
            }
        }
        catch (err) {
            logger.debug({ error: err?.message || err }, '[EmbeddingServerManager] Docker cleanup check failed (Docker may not be installed)');
        }
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
                // CRITICAL FIX: Don't kill healthy servers - REUSE them!
                // This allows multiple MCP sessions to share the same embedding server
                // Killing a healthy server breaks other sessions that depend on it
                logger.info({
                    pid: healthInfo.pid,
                    ageHours: healthInfo.processAgeHours?.toFixed(2) || 'unknown',
                }, '[EmbeddingServerManager] Process is healthy - REUSING instead of killing (preserves other sessions)');
                // Mark as running so we don't try to start a new one
                this.isRunning = true;
                this.process = { pid: healthInfo.pid }; // Track the existing process
                return; // Don't kill, don't clean socket - just reuse
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
                const allProjectPids = execSync(`find /home /root /opt /srv /var /tmp -maxdepth 6 -path "*/specmem/sockets/embedding.pid" -o -path "*/.specmem/*/sockets/embedding.pid" 2>/dev/null | xargs cat 2>/dev/null || true`, { encoding: 'utf8', timeout: 5000 }).trim();
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
                        // CRITICAL FIX: Never kill --service mode processes based on age
                        // Service mode is meant to run indefinitely
                        const isServiceMode = commandLine.includes('--service');
                        if (isServiceMode) {
                            logger.info({
                                pid,
                                ageHours: ageHours?.toFixed(2) || 'unknown',
                                socketPath: this.socketPath,
                            }, '[EmbeddingServerManager] Orphaned --service process found - KEEPING (service mode runs indefinitely)');
                            // Adopt it instead of killing
                            this.isRunning = true;
                            this.process = { pid };
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
                // Check both env var names - MCP manager uses SPECMEM_EMBEDDING_SOCKET,
                // but specmem-init spawns with SPECMEM_SOCKET_PATH
                if (envVar.startsWith('SPECMEM_EMBEDDING_SOCKET=')) {
                    return envVar.split('=')[1];
                }
                if (envVar.startsWith('SPECMEM_SOCKET_PATH=')) {
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
     * Check if a running process belongs to THIS project instance.
     * Reads /proc/PID/environ and checks SPECMEM_PROJECT_PATH, SPECMEM_SOCKET_PATH,
     * and SPECMEM_EMBEDDING_SOCKET for a match against this project's paths.
     * Returns true if the process belongs to this project, false otherwise.
     * Returns false on any error (permission denied, process gone, etc.)
     */
    _isProcessForThisProject(pid) {
        try {
            const environPath = `/proc/${pid}/environ`;
            if (!existsSync(environPath)) {
                return false;
            }
            const environ = readFileSync(environPath, 'utf8');
            const envVars = environ.split('\0');
            const projectPath = this.projectPath || process.cwd();
            const socketPath = this.socketPath;
            for (const v of envVars) {
                if (v.startsWith('SPECMEM_PROJECT_PATH=') && v.includes(projectPath)) return true;
                if (v.startsWith('SPECMEM_SOCKET_PATH=') && v.includes(projectPath)) return true;
                if (v.startsWith('SPECMEM_EMBEDDING_SOCKET=') && socketPath && v.includes(socketPath)) return true;
            }
            return false;
        }
        catch {
            return false;
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
            // Respect recommended action — don't kill healthy/service processes
            if (healthInfo.recommendedAction === 'keep') {
                logger.info({ pid: healthInfo.pid, status: healthInfo.statusMessage },
                    '[EmbeddingServerManager] killByPidFile: Process is healthy/service - keeping');
                return;
            }
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
        // DOCKER DISABLED: warm-start.sh Docker fallback removed - native Python only
        logger.error({ searchedPaths: embeddingPaths }, '[EmbeddingServerManager] Embedding script not found (Docker disabled)');
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
     * Attempt to restart the server (with circuit breaker - Issue #10)
     *
     * Circuit breaker pattern:
     * - CLOSED: Normal operation, restarts allowed. Track restarts in sliding window.
     * - OPEN: Too many restarts in window, block all restarts, wait for cooldown.
     * - HALF-OPEN: After cooldown, allow ONE test restart. Success -> CLOSED, failure -> OPEN (doubled cooldown).
     */
    async attemptRestart() {
        // Phase 4: Don't restart if user manually stopped
        if (this.isStoppedByUser()) {
            logger.info('[EmbeddingServerManager] Skipping restart - stopped by user');
            return;
        }
        const now = Date.now();
        // --- Circuit Breaker Logic (Issue #10) ---
        // Prune the sliding window: remove timestamps older than cbRestartWindowMs
        this.cbRestartTimestamps = this.cbRestartTimestamps.filter(
            ts => (now - ts) < this.config.cbRestartWindowMs
        );
        if (this.cbState === 'open') {
            // Circuit is OPEN - check if cooldown has elapsed
            if (now < this.cbCooldownUntil) {
                const remainingMs = this.cbCooldownUntil - now;
                logger.warn({
                    cbState: this.cbState,
                    cooldownRemainingMs: remainingMs,
                    currentCooldownMs: this.cbCurrentCooldownMs,
                }, '[EmbeddingServerManager] Circuit breaker OPEN - restart blocked, waiting for cooldown');
                return;
            }
            // Cooldown elapsed - transition to half-open
            this.cbState = 'half-open';
            this.cbLastStateChange = now;
            logger.info({
                previousState: 'open',
                newState: 'half-open',
                cooldownMs: this.cbCurrentCooldownMs,
            }, '[EmbeddingServerManager] Circuit breaker: open -> half-open (allowing one test restart)');
            this.emit('circuit_breaker', { state: 'half-open', cooldownMs: this.cbCurrentCooldownMs });
        }
        if (this.cbState === 'closed') {
            // Check if we should trip the breaker
            if (this.cbRestartTimestamps.length >= this.config.cbMaxRestartsInWindow) {
                // Trip the circuit breaker
                this.cbState = 'open';
                this.cbCurrentCooldownMs = this.cbCurrentCooldownMs || this.config.cbCooldownMs;
                this.cbCooldownUntil = now + this.cbCurrentCooldownMs;
                this.cbLastStateChange = now;
                logger.error({
                    previousState: 'closed',
                    newState: 'open',
                    restartsInWindow: this.cbRestartTimestamps.length,
                    windowMs: this.config.cbRestartWindowMs,
                    maxAllowed: this.config.cbMaxRestartsInWindow,
                    cooldownMs: this.cbCurrentCooldownMs,
                    cooldownUntil: new Date(this.cbCooldownUntil).toISOString(),
                }, '[EmbeddingServerManager] Circuit breaker TRIPPED: closed -> open (too many restarts in window)');
                this.emit('circuit_breaker', {
                    state: 'open',
                    restartsInWindow: this.cbRestartTimestamps.length,
                    cooldownMs: this.cbCurrentCooldownMs,
                });
                return;
            }
        }
        // --- End Circuit Breaker pre-check ---
        // Phase 4: Check for restart loop (>3 restarts in 60 seconds) - legacy check
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
        const timeSinceLastRestart = now - this.lastRestartTime;
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
        // Track restart timestamp for both legacy loop detection and circuit breaker window
        const restartTs = Date.now();
        this.restartTimestamps.push(restartTs);
        this.cbRestartTimestamps.push(restartTs);
        // Keep only last 10 timestamps for legacy tracking
        if (this.restartTimestamps.length > 10) {
            this.restartTimestamps.shift();
        }
        logger.info({
            attempt: this.restartCount,
            cbState: this.cbState,
            restartsInWindow: this.cbRestartTimestamps.length,
        }, '[EmbeddingServerManager] Attempting restart');
        this.emit('restarting', { attempt: this.restartCount });
        const success = await this.start();
        // --- Circuit Breaker post-restart evaluation ---
        if (this.cbState === 'half-open') {
            if (success) {
                // Test restart succeeded - close the circuit breaker
                this.cbState = 'closed';
                this.cbCurrentCooldownMs = 0; // Reset cooldown on success
                this.cbRestartTimestamps = [];
                this.cbLastStateChange = Date.now();
                logger.info({
                    previousState: 'half-open',
                    newState: 'closed',
                }, '[EmbeddingServerManager] Circuit breaker: half-open -> closed (restart succeeded, counters reset)');
                this.emit('circuit_breaker', { state: 'closed' });
            }
            else {
                // Test restart failed - reopen with doubled cooldown
                this.cbState = 'open';
                this.cbCurrentCooldownMs = Math.min(
                    this.cbCurrentCooldownMs * 2,
                    this.config.cbMaxCooldownMs
                );
                this.cbCooldownUntil = Date.now() + this.cbCurrentCooldownMs;
                this.cbLastStateChange = Date.now();
                logger.error({
                    previousState: 'half-open',
                    newState: 'open',
                    newCooldownMs: this.cbCurrentCooldownMs,
                    maxCooldownMs: this.config.cbMaxCooldownMs,
                    cooldownUntil: new Date(this.cbCooldownUntil).toISOString(),
                }, '[EmbeddingServerManager] Circuit breaker: half-open -> open (restart failed, cooldown doubled)');
                this.emit('circuit_breaker', {
                    state: 'open',
                    cooldownMs: this.cbCurrentCooldownMs,
                });
            }
        }
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
                // FIX: During startup grace period, suppress failure counting and restart attempts
                // Grace period is dynamic, derived from config.startupTimeoutMs
                if (this.startupGraceUntil > 0 && Date.now() < this.startupGraceUntil) {
                    const remainingMs = this.startupGraceUntil - Date.now();
                    logger.debug({ remainingMs, error: result.error },
                        '[EmbeddingServerManager] Health check failed during startup grace period - suppressing');
                    return; // Don't count failures or attempt restarts during grace
                }
                // Clear expired grace period
                if (this.startupGraceUntil > 0 && Date.now() >= this.startupGraceUntil) {
                    this.startupGraceUntil = 0;
                }
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
            // FIX 4: Duplicate process detection during health monitoring
            // Check for multiple embedding server processes FOR THIS PROJECT and kill extras
            // PROJECT ISOLATION: Filter to only this project's processes before killing duplicates
            try {
                const runningServers = this.findRunningEmbeddingServers();
                // PROJECT ISOLATION: Only consider processes belonging to this project
                const thisProjectHealthServers = runningServers.filter(s => this._isProcessForThisProject(s.pid));
                if (thisProjectHealthServers.length > 1) {
                    logger.error({
                        count: thisProjectHealthServers.length,
                        totalSystemWide: runningServers.length,
                        pids: thisProjectHealthServers.map(s => s.pid),
                    }, '[EmbeddingServerManager] CRITICAL: Multiple embedding server processes detected for THIS project!');
                    // Determine the legitimate PID from PID file
                    const legitimatePid = this.readPidFile();
                    if (legitimatePid) {
                        // Kill all THIS PROJECT's processes that are NOT the legitimate one
                        for (const server of thisProjectHealthServers) {
                            if (server.pid !== legitimatePid) {
                                try {
                                    logger.warn({ pid: server.pid, legitimatePid },
                                        '[EmbeddingServerManager] FIX 4: Killing duplicate embedding server process');
                                    process.kill(server.pid, 'SIGTERM');
                                    // Give it a moment, then force kill if needed
                                    setTimeout(() => {
                                        try {
                                            process.kill(server.pid, 0);
                                            process.kill(server.pid, 'SIGKILL');
                                            logger.warn({ pid: server.pid },
                                                '[EmbeddingServerManager] FIX 4: Force killed duplicate process');
                                        }
                                        catch { /* already dead */ }
                                    }, 2000);
                                }
                                catch (killErr) {
                                    logger.debug({ pid: server.pid, error: killErr.message },
                                        '[EmbeddingServerManager] FIX 4: Failed to kill duplicate (may be dead)');
                                }
                            }
                        }
                    }
                    else {
                        // No PID file - keep the first one, kill the rest (only this project's processes)
                        logger.warn('[EmbeddingServerManager] FIX 4: No PID file found, keeping oldest process');
                        for (let i = 1; i < thisProjectHealthServers.length; i++) {
                            try {
                                process.kill(thisProjectHealthServers[i].pid, 'SIGTERM');
                                logger.warn({ pid: thisProjectHealthServers[i].pid },
                                    '[EmbeddingServerManager] FIX 4: Killing extra duplicate process');
                            }
                            catch { /* ignore */ }
                        }
                    }
                }
            }
            catch (dupErr) {
                logger.debug({ error: dupErr.message },
                    '[EmbeddingServerManager] FIX 4: Duplicate detection check failed (non-fatal)');
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
            // FIX: Only skip if shutting down - heartbeat should still try for externally started servers
            if (this.isShuttingDown) {
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
     * FIX 6: Get process resource usage (CPU, memory) for the embedding server
     * Uses `ps -p PID -o pid,pcpu,pmem,rss,vsz` to get resource metrics
     * @returns {{ pid: number, cpu: number, memPercent: number, rss: number, vsz: number } | null}
     */
    getProcessResources() {
        const pid = this.readPidFile();
        if (!pid) return null;
        try {
            // Check process is alive first
            process.kill(pid, 0);
            const result = execSync(`ps -p ${pid} -o pid,pcpu,pmem,rss,vsz --no-headers`, {
                encoding: 'utf8',
                timeout: 5000,
            }).trim();
            if (!result) return null;
            const parts = result.trim().split(/\s+/);
            if (parts.length < 5) return null;
            return {
                pid: parseInt(parts[0], 10),
                cpu: parseFloat(parts[1]),           // %CPU
                memPercent: parseFloat(parts[2]),     // %MEM
                rss: parseInt(parts[3], 10),          // RSS in KB
                vsz: parseInt(parts[4], 10),          // VSZ in KB
            };
        }
        catch (err) {
            logger.debug({ pid, error: err.message }, '[EmbeddingServerManager] FIX 6: Failed to get process resources');
            return null;
        }
    }
    /**
     * FIX 6: Check resource limits and log warnings if exceeded
     * Warns if RSS > 6000MB or CPU > 80%
     * @returns {{ withinLimits: boolean, warnings: string[] }}
     */
    checkResourceLimits() {
        const resources = this.getProcessResources();
        if (!resources) {
            return { withinLimits: true, warnings: [] };
        }
        const warnings = [];
        const RSS_LIMIT_MB = 6000;   // 6GB RSS limit
        const CPU_LIMIT_PCT = 80;     // 80% CPU limit
        const rssMb = resources.rss / 1024; // Convert KB to MB
        if (rssMb > RSS_LIMIT_MB) {
            const msg = `Embedding server RSS memory (${rssMb.toFixed(0)}MB) exceeds limit (${RSS_LIMIT_MB}MB)`;
            warnings.push(msg);
            logger.warn({
                pid: resources.pid,
                rssMb: rssMb.toFixed(0),
                limitMb: RSS_LIMIT_MB,
            }, `[EmbeddingServerManager] FIX 6: RESOURCE WARNING - ${msg}`);
        }
        if (resources.cpu > CPU_LIMIT_PCT) {
            const msg = `Embedding server CPU usage (${resources.cpu.toFixed(1)}%) exceeds limit (${CPU_LIMIT_PCT}%)`;
            warnings.push(msg);
            logger.warn({
                pid: resources.pid,
                cpuPercent: resources.cpu.toFixed(1),
                limitPercent: CPU_LIMIT_PCT,
            }, `[EmbeddingServerManager] FIX 6: RESOURCE WARNING - ${msg}`);
        }
        if (warnings.length === 0) {
            logger.debug({
                pid: resources.pid,
                rssMb: rssMb.toFixed(0),
                cpuPercent: resources.cpu.toFixed(1),
            }, '[EmbeddingServerManager] FIX 6: Resource usage within limits');
        }
        return {
            withinLimits: warnings.length === 0,
            warnings,
            resources: {
                pid: resources.pid,
                cpuPercent: resources.cpu,
                rssMb: Math.round(rssMb),
                vszMb: Math.round(resources.vsz / 1024),
                memPercent: resources.memPercent,
            },
        };
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