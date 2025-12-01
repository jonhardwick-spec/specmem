/**
 * InstanceManager - Per-Project Instance Tracking for SpecMem
 *
 * Provides isolated instance management for each Claude session/project:
 * - Each project gets its own .specmem/{project_hash}/ directory
 * - PID files, sockets, and instance state are project-scoped
 * - Global registry tracks all running instances across projects
 * - Stale instance cleanup on startup
 * - Kill command to terminate specific instances
 *
 * This fixes the issue where multiple SpecMem instances would conflict
 * by writing to the same PID file in .specmem/
 *
 * @author hardwicksoftwareservices
 */
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { createServer, Socket } from 'net';
import { execSync } from 'child_process';
import { logger } from './logger.js';
// ============================================================================
// Constants
// ============================================================================
const DEFAULT_BASE_DIR = path.join(os.homedir(), '.specmem');
const REGISTRY_FILE = 'instance-registry.json';
const PID_FILE = 'specmem.pid';
const SOCKET_FILE = 'specmem.sock';
const STATE_FILE = 'instance.json';
const LOCK_FILE = 'specmem.lock';
// Minimum age for a PID file to be considered stale (prevents race conditions)
const MIN_PID_AGE_MS = 10000;
// Maximum age for an instance to be considered stale without heartbeat
const MAX_INSTANCE_AGE_MS = 3600000; // 1 hour
// ============================================================================
// Utility Functions
// ============================================================================
/**
 * Get the hashed project directory name for instance management (COLLISION-FREE!)
 * Uses SHA256 hash of FULL project path to ensure different paths get different instances.
 * This prevents collisions between /specmem and ~/specmem.
 * Format: First 16 chars of hash (e.g., "a1b2c3d4e5f6a7b8")
 */
export function getProjectDirName(projectPath) {
    // If env var is explicitly set, use it (but verify it's a hash, not basename)
    if (!projectPath && process.env['SPECMEM_PROJECT_DIR_NAME']) {
        const envValue = process.env['SPECMEM_PROJECT_DIR_NAME'];
        // Check if it looks like a hash (16 hex chars) - if so, use it
        if (/^[a-f0-9]{16}$/.test(envValue)) {
            return envValue;
        }
        // Otherwise, it's an old basename-style value - hash it for safety
    }
    const pathToUse = projectPath || process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
    // Hash the FULL resolved path to avoid collisions
    const normalizedPath = path.resolve(pathToUse).toLowerCase().replace(/\\/g, '/');
    const fullHash = createHash('sha256').update(normalizedPath).digest('hex');
    // Use first 16 chars of hash for reasonable uniqueness while keeping paths short
    return fullHash.substring(0, 16);
}
/**
 * Generate a deterministic hash from project path (DEPRECATED)
 * Uses first 16 characters of SHA256 for reasonable uniqueness while keeping paths short
 * @deprecated Use getProjectDirName() for new code - it's human readable!
 */
export function hashProjectPath(projectPath) {
    const normalizedPath = path.resolve(projectPath).toLowerCase().replace(/\\/g, '/');
    const fullHash = createHash('sha256').update(normalizedPath).digest('hex');
    return fullHash.substring(0, 16);
}
/**
 * Get the full hash of a project path (for registry lookups)
 * @deprecated Use getProjectDirName() for new code - it's human readable!
 */
export function getFullProjectHash(projectPath) {
    const normalizedPath = path.resolve(projectPath).toLowerCase().replace(/\\/g, '/');
    return createHash('sha256').update(normalizedPath).digest('hex');
}
/**
 * Check if a process with the given PID is running
 */
export function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Check if a process is a SpecMem/Node process
 */
export function isSpecMemProcess(pid) {
    try {
        if (process.platform === 'linux') {
            const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
            return cmdline.includes('specmem') || cmdline.includes('bootstrap') || cmdline.includes('node');
        }
        else if (process.platform === 'darwin') {
            const result = execSync(`ps -p ${pid} -o command= 2>/dev/null || echo ""`, { encoding: 'utf-8' });
            return result.includes('specmem') || result.includes('bootstrap') || result.includes('node');
        }
        return isProcessRunning(pid);
    }
    catch {
        return false;
    }
}
// ============================================================================
// InstanceManager Class
// ============================================================================
/**
 * Singleton instance manager for the current process
 */
let globalInstanceManager = null;
/**
 * InstanceManager - Manages per-project SpecMem instances
 *
 * Key features:
 * - Project-scoped directories: ~/.specmem/{project_hash}/
 * - Global registry: ~/.specmem/instance-registry.json
 * - Socket-based locking for reliable instance detection
 * - Automatic stale instance cleanup
 */
export class InstanceManager {
    config;
    projectDirName;
    projectHash; // Kept for backwards compat
    instanceDir;
    lockSocket = null;
    heartbeatInterval = null;
    initialized = false;
    constructor(config) {
        this.config = {
            baseDir: config.baseDir || DEFAULT_BASE_DIR,
            projectPath: path.resolve(config.projectPath),
            autoCleanup: config.autoCleanup ?? true,
            lockStrategy: config.lockStrategy || 'both',
            healthCheckIntervalMs: config.healthCheckIntervalMs || 30000,
        };
        // Use readable project dir name for instance directory (MUCH easier to debug!)
        this.projectDirName = getProjectDirName(this.config.projectPath);
        this.projectHash = hashProjectPath(this.config.projectPath); // Kept for backwards compat
        this.instanceDir = path.join(this.config.baseDir, 'instances', this.projectDirName);
    }
    // ==========================================================================
    // Directory Management
    // ==========================================================================
    /**
     * Get the instance directory for this project
     */
    getInstanceDir() {
        return this.instanceDir;
    }
    /**
     * Get the path to a file in the instance directory
     */
    getFilePath(filename) {
        return path.join(this.instanceDir, filename);
    }
    /**
     * Ensure the instance directory exists
     */
    async ensureInstanceDir() {
        try {
            await fsp.mkdir(this.instanceDir, { recursive: true, mode: 0o755 });
        }
        catch (err) {
            if (err.code !== 'EEXIST') {
                throw err;
            }
        }
    }
    /**
     * Ensure the instance directory exists (sync version)
     */
    ensureInstanceDirSync() {
        try {
            fs.mkdirSync(this.instanceDir, { recursive: true, mode: 0o755 });
        }
        catch (err) {
            if (err.code !== 'EEXIST') {
                throw err;
            }
        }
    }
    // ==========================================================================
    // PID File Management
    // ==========================================================================
    /**
     * Read the PID from the PID file
     */
    readPid() {
        const pidFile = this.getFilePath(PID_FILE);
        try {
            const content = fs.readFileSync(pidFile, 'utf-8').trim();
            const pid = parseInt(content, 10);
            return isNaN(pid) ? null : pid;
        }
        catch {
            return null;
        }
    }
    /**
     * Write PID to the PID file
     */
    writePid(pid) {
        this.ensureInstanceDirSync();
        const pidFile = this.getFilePath(PID_FILE);
        fs.writeFileSync(pidFile, pid.toString(), { mode: 0o644 });
    }
    /**
     * Remove the PID file
     */
    removePid() {
        const pidFile = this.getFilePath(PID_FILE);
        try {
            fs.unlinkSync(pidFile);
        }
        catch {
            // Ignore - file may not exist
        }
    }
    /**
     * Get the age of the PID file in milliseconds
     */
    getPidFileAge() {
        const pidFile = this.getFilePath(PID_FILE);
        try {
            const stats = fs.statSync(pidFile);
            return Date.now() - stats.mtimeMs;
        }
        catch {
            return null;
        }
    }
    // ==========================================================================
    // Socket Lock Management
    // ==========================================================================
    /**
     * Try to acquire a socket-based lock
     * Returns true if lock acquired, false if another instance is running
     */
    tryAcquireSocketLock() {
        const socketPath = this.getFilePath(SOCKET_FILE);
        this.ensureInstanceDirSync();
        // Try to remove stale socket
        try {
            fs.unlinkSync(socketPath);
        }
        catch (err) {
            if (err.code !== 'ENOENT') {
                // Socket exists and is in use
                return false;
            }
        }
        try {
            this.lockSocket = createServer((socket) => {
                socket.on('data', (data) => {
                    const msg = data.toString().trim();
                    if (msg === 'health') {
                        socket.write(JSON.stringify({
                            status: 'running',
                            pid: process.pid,
                            projectPath: this.config.projectPath,
                            projectDirName: this.projectDirName,
                            projectHash: this.projectHash, // backwards compat
                        }));
                    }
                    else if (msg === 'shutdown') {
                        socket.write(JSON.stringify({ status: 'shutting_down' }));
                        // Graceful shutdown
                        process.emit('SIGTERM');
                    }
                    else if (msg === 'info') {
                        const info = this.getInstanceInfo();
                        socket.write(JSON.stringify(info));
                    }
                    socket.end();
                });
            });
            this.lockSocket.listen(socketPath);
            fs.chmodSync(socketPath, 0o600);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Release the socket lock
     */
    releaseSocketLock() {
        const socketPath = this.getFilePath(SOCKET_FILE);
        if (this.lockSocket) {
            this.lockSocket.close();
            this.lockSocket = null;
        }
        try {
            fs.unlinkSync(socketPath);
        }
        catch {
            // Ignore
        }
    }
    /**
     * Check if a socket lock is held by another process
     */
    async checkSocketLock() {
        return new Promise((resolve) => {
            const socketPath = this.getFilePath(SOCKET_FILE);
            const socket = new Socket();
            const timeout = setTimeout(() => {
                socket.destroy();
                resolve(false);
            }, 1000);
            socket.on('error', () => {
                clearTimeout(timeout);
                socket.destroy();
                resolve(false);
            });
            socket.on('connect', () => {
                socket.write('health');
            });
            socket.on('data', () => {
                clearTimeout(timeout);
                socket.destroy();
                resolve(true);
            });
            socket.connect(socketPath);
        });
    }
    // ==========================================================================
    // Instance State Management
    // ==========================================================================
    /**
     * Get current instance info
     */
    getInstanceInfo() {
        return {
            pid: process.pid,
            projectPath: this.config.projectPath,
            projectHash: this.projectDirName, // Use readable dir name in registry (keeping field name for backwards compat)
            startTime: new Date().toISOString(),
            status: 'running',
            lastHeartbeat: new Date().toISOString(),
            version: process.env.npm_package_version || '1.0.0',
        };
    }
    /**
     * Write instance state to file
     */
    writeInstanceState(info) {
        this.ensureInstanceDirSync();
        const stateFile = this.getFilePath(STATE_FILE);
        const fullInfo = {
            ...this.getInstanceInfo(),
            ...info,
        };
        fs.writeFileSync(stateFile, JSON.stringify(fullInfo, null, 2), { mode: 0o644 });
    }
    /**
     * Read instance state from file
     */
    readInstanceState() {
        const stateFile = this.getFilePath(STATE_FILE);
        try {
            const content = fs.readFileSync(stateFile, 'utf-8');
            return JSON.parse(content);
        }
        catch {
            return null;
        }
    }
    /**
     * Remove instance state file
     */
    removeInstanceState() {
        const stateFile = this.getFilePath(STATE_FILE);
        try {
            fs.unlinkSync(stateFile);
        }
        catch {
            // Ignore
        }
    }
    // ==========================================================================
    // Registry Management
    // ==========================================================================
    /**
     * Get path to the global registry file
     */
    getRegistryPath() {
        return path.join(this.config.baseDir, REGISTRY_FILE);
    }
    /**
     * Load the global instance registry
     */
    loadRegistry() {
        const registryPath = this.getRegistryPath();
        try {
            const content = fs.readFileSync(registryPath, 'utf-8');
            const registry = JSON.parse(content);
            // Upgrade from old format if needed
            if (!registry.version || registry.version < 2) {
                return {
                    version: 2,
                    instances: registry.instances || {},
                    lastUpdated: new Date().toISOString(),
                };
            }
            return registry;
        }
        catch {
            return {
                version: 2,
                instances: {},
                lastUpdated: new Date().toISOString(),
            };
        }
    }
    /**
     * Save the global instance registry
     */
    saveRegistry(registry) {
        const registryPath = this.getRegistryPath();
        try {
            fs.mkdirSync(this.config.baseDir, { recursive: true, mode: 0o755 });
        }
        catch (err) {
            if (err.code !== 'EEXIST') {
                throw err;
            }
        }
        registry.lastUpdated = new Date().toISOString();
        fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), { mode: 0o644 });
    }
    /**
     * Register this instance in the global registry
     */
    registerInstance(ports) {
        const registry = this.loadRegistry();
        registry.instances[this.projectDirName] = {
            ...this.getInstanceInfo(),
            dashboardPort: ports?.dashboard,
            coordinationPort: ports?.coordination,
            postgresPort: ports?.postgres,
        };
        this.saveRegistry(registry);
    }
    /**
     * Unregister this instance from the global registry
     */
    unregisterInstance() {
        const registry = this.loadRegistry();
        delete registry.instances[this.projectDirName];
        this.saveRegistry(registry);
    }
    /**
     * Update heartbeat in the registry
     */
    updateHeartbeat() {
        const registry = this.loadRegistry();
        if (registry.instances[this.projectDirName]) {
            registry.instances[this.projectDirName].lastHeartbeat = new Date().toISOString();
            this.saveRegistry(registry);
        }
    }
    /**
     * Get all registered instances
     */
    getAllInstances() {
        const registry = this.loadRegistry();
        return Object.values(registry.instances);
    }
    // ==========================================================================
    // Instance Detection & Cleanup
    // ==========================================================================
    /**
     * Check if an instance is already running for this project
     */
    async isInstanceRunning() {
        const { lockStrategy } = this.config;
        // Check PID file
        if (lockStrategy === 'pid' || lockStrategy === 'both') {
            const pid = this.readPid();
            if (pid !== null && pid !== process.pid && isProcessRunning(pid) && isSpecMemProcess(pid)) {
                return true;
            }
        }
        // Check socket
        if (lockStrategy === 'socket' || lockStrategy === 'both') {
            const socketRunning = await this.checkSocketLock();
            if (socketRunning) {
                return true;
            }
        }
        return false;
    }
    /**
     * Clean up stale instances from the registry
     * Registry is now keyed by readable project dir name (e.g., "myproject")
     */
    async cleanupStaleInstances() {
        const registry = this.loadRegistry();
        const cleaned = [];
        const running = [];
        for (const [instanceKey, info] of Object.entries(registry.instances)) {
            // Skip our own instance
            if (info.pid === process.pid) {
                running.push(instanceKey);
                continue;
            }
            // Check if process is still running
            if (isProcessRunning(info.pid) && isSpecMemProcess(info.pid)) {
                // Check heartbeat age if available
                if (info.lastHeartbeat) {
                    const age = Date.now() - new Date(info.lastHeartbeat).getTime();
                    if (age > MAX_INSTANCE_AGE_MS) {
                        // Stale - hasn't sent heartbeat in too long
                        logger.info({ pid: info.pid, projectPath: info.projectPath, ageMs: age }, 'Cleaning stale instance (no heartbeat)');
                        cleaned.push(instanceKey);
                        delete registry.instances[instanceKey];
                        continue;
                    }
                }
                running.push(instanceKey);
            }
            else {
                // Process is dead - clean up
                logger.info({ pid: info.pid, projectPath: info.projectPath }, 'Cleaning dead instance');
                cleaned.push(instanceKey);
                delete registry.instances[instanceKey];
                // Also clean up the instance directory (uses readable project name now!)
                const instanceDir = path.join(this.config.baseDir, 'instances', instanceKey);
                try {
                    await fsp.rm(instanceDir, { recursive: true, force: true });
                }
                catch {
                    // Ignore cleanup errors
                }
            }
        }
        if (cleaned.length > 0) {
            this.saveRegistry(registry);
        }
        return { cleaned, running };
    }
    /**
     * Clean up stale locks for THIS project only (replaces cleanupStaleLocks in index.ts)
     *
     * SAFETY: This method operates ONLY within this project's instance directory.
     * The PID file and instance state are project-scoped, so we can safely:
     * 1. Kill processes whose PID is in OUR project's PID file
     * 2. Clean up OUR project's lock files
     *
     * We NEVER touch processes or files from other projects.
     */
    cleanupStaleLocks() {
        const pidFile = this.getFilePath(PID_FILE);
        const sockFile = this.getFilePath(SOCKET_FILE);
        const instanceFile = this.getFilePath(STATE_FILE);
        // Check if instance directory exists
        if (!fs.existsSync(this.instanceDir)) {
            return;
        }
        // Check PID file age - don't clean if too recent
        const pidAge = this.getPidFileAge();
        if (pidAge !== null && pidAge < MIN_PID_AGE_MS) {
            logger.debug({ ageMs: pidAge }, 'PID file is too recent, skipping stale check');
            return;
        }
        // Check PID file
        const pid = this.readPid();
        if (pid !== null) {
            // Never clean our own PID
            if (pid === process.pid) {
                return;
            }
            // Check if process is still running
            if (isProcessRunning(pid) && isSpecMemProcess(pid)) {
                // Process is alive - check instance age
                const state = this.readInstanceState();
                if (state?.startTime) {
                    const age = Date.now() - new Date(state.startTime).getTime();
                    if (age > MAX_INSTANCE_AGE_MS) {
                        // SAFETY: This PID came from OUR project's PID file, so it's safe to kill.
                        // The PID file path is: ~/.specmem/instances/{projectDirName}/specmem.pid
                        // This ensures we only kill processes that were started for THIS project.
                        logger.warn({ pid, ageMs: age, projectDirName: this.projectDirName }, '[SafeKill] Killing very old SpecMem instance (ownership verified via project-scoped PID file)');
                        try {
                            process.kill(pid, 'SIGTERM');
                        }
                        catch {
                            // Ignore kill errors
                        }
                    }
                }
            }
            else {
                // Process is dead - clean up stale locks
                logger.info({ pid }, 'Cleaning up stale lock files from dead process');
                try {
                    fs.unlinkSync(pidFile);
                }
                catch { /* ignore */ }
                try {
                    fs.unlinkSync(sockFile);
                }
                catch { /* ignore */ }
                try {
                    fs.unlinkSync(instanceFile);
                }
                catch { /* ignore */ }
            }
        }
        // Clean orphaned socket
        if (fs.existsSync(sockFile) && !fs.existsSync(pidFile)) {
            logger.info('Cleaning up orphaned socket file');
            try {
                fs.unlinkSync(sockFile);
            }
            catch { /* ignore */ }
        }
    }
    // ==========================================================================
    // Lifecycle Management
    // ==========================================================================
    /**
     * Initialize the instance manager
     * Acquires locks, writes PID, registers in global registry
     */
    async initialize() {
        // Check if already running
        const running = await this.isInstanceRunning();
        if (running) {
            return { success: false, alreadyRunning: true };
        }
        // Clean up stale locks first
        if (this.config.autoCleanup) {
            this.cleanupStaleLocks();
            await this.cleanupStaleInstances();
        }
        // Ensure instance directory exists
        await this.ensureInstanceDir();
        // Acquire socket lock
        if (this.config.lockStrategy === 'socket' || this.config.lockStrategy === 'both') {
            const acquired = this.tryAcquireSocketLock();
            if (!acquired) {
                return { success: false, error: 'Failed to acquire socket lock' };
            }
        }
        // Write PID file
        this.writePid(process.pid);
        // Write instance state
        this.writeInstanceState();
        // Register in global registry
        this.registerInstance();
        // Start heartbeat
        this.startHeartbeat();
        this.initialized = true;
        logger.info({
            projectPath: this.config.projectPath,
            projectDirName: this.projectDirName,
            instanceDir: this.instanceDir,
            pid: process.pid,
        }, 'Instance manager initialized');
        return { success: true };
    }
    /**
     * Start heartbeat updates
     */
    startHeartbeat() {
        if (this.heartbeatInterval) {
            return;
        }
        this.heartbeatInterval = setInterval(() => {
            this.updateHeartbeat();
            this.writeInstanceState({ lastHeartbeat: new Date().toISOString() });
        }, this.config.healthCheckIntervalMs);
    }
    /**
     * Stop heartbeat updates
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
    /**
     * Shutdown the instance manager
     * Releases locks, removes PID, unregisters from registry
     */
    shutdown() {
        this.stopHeartbeat();
        this.releaseSocketLock();
        this.removePid();
        this.removeInstanceState();
        this.unregisterInstance();
        this.initialized = false;
        logger.info({ projectPath: this.config.projectPath }, 'Instance manager shutdown');
    }
    /**
     * Check if initialized
     */
    isInitialized() {
        return this.initialized;
    }
}
/**
 * Clean up any existing SpecMem instances running for the SAME project.
 * This is called at startup to ensure only ONE instance per project.
 *
 * SAFETY: This function ONLY touches instances for the given projectPath.
 * It uses getProjectDirName() to match instances, never hashes.
 * Different projects are completely unaffected.
 *
 * Flow:
 * 1. Read the registry to find any existing instances for this project
 * 2. If found and PID is not our current process:
 *    - Check if process is still running
 *    - If running, send SIGTERM and wait up to 5 seconds
 *    - If still alive, send SIGKILL
 *    - Clean up PID file, socket file, and registry entry
 * 3. Also clean up any associated Docker containers
 *
 * @param projectPath - Path to the project (used to derive projectDirName)
 * @param options - Optional configuration
 * @returns Object with killed PIDs, skipped PIDs, and any errors
 */
export function cleanupSameProjectInstances(projectPath, options) {
    const baseDir = options?.baseDir || DEFAULT_BASE_DIR;
    const forceDocker = options?.forceDocker ?? false;
    const removeVolumes = options?.removeVolumes ?? false;
    const result = {
        killed: [],
        skipped: [],
        errors: [],
    };
    // Derive the project directory name (readable, not hash)
    const projectDirName = getProjectDirName(projectPath);
    logger.info({
        projectPath,
        projectDirName,
        currentPid: process.pid,
    }, 'Starting same-project instance cleanup');
    // Load registry to find existing instances
    const registryPath = path.join(baseDir, REGISTRY_FILE);
    let registry;
    try {
        const content = fs.readFileSync(registryPath, 'utf-8');
        registry = JSON.parse(content);
    }
    catch {
        // No registry = no instances to clean up
        logger.debug('No instance registry found, nothing to clean up');
        return result;
    }
    // Find the instance for this project
    const existingInstance = registry.instances[projectDirName];
    if (!existingInstance) {
        logger.debug({ projectDirName }, 'No existing instance found for this project');
        return result;
    }
    const existingPid = existingInstance.pid;
    // Skip if it's our own process
    if (existingPid === process.pid) {
        logger.debug({ pid: existingPid }, 'Existing instance is our own process, skipping');
        result.skipped.push(existingPid);
        return result;
    }
    // Check if the process is actually running
    if (!isProcessRunning(existingPid)) {
        logger.info({ pid: existingPid, projectDirName }, 'Existing instance is dead, cleaning up stale entries');
        // Clean up stale registry entry and files
        cleanupInstanceFiles(baseDir, projectDirName, registry);
        return result;
    }
    // Verify it's a SpecMem process (not a random process that got the same PID)
    if (!isSpecMemProcess(existingPid)) {
        logger.warn({
            pid: existingPid,
            projectDirName,
        }, 'PID exists but is not a SpecMem process, cleaning up stale entries only');
        cleanupInstanceFiles(baseDir, projectDirName, registry);
        return result;
    }
    logger.info({
        pid: existingPid,
        projectPath: existingInstance.projectPath,
        startTime: existingInstance.startTime,
    }, 'Found running SpecMem instance for same project, killing it');
    // Step 1: Clean up Docker containers first (before killing process)
    try {
        const instanceDir = path.join(baseDir, 'instances', projectDirName);
        const dockerFile = path.join(instanceDir, 'docker-containers.json');
        if (fs.existsSync(dockerFile)) {
            const dockerContent = fs.readFileSync(dockerFile, 'utf-8');
            const dockerInfo = JSON.parse(dockerContent);
            const containers = dockerInfo.containers || {};
            // Stop embedding container
            if (containers.embedding) {
                try {
                    if (isDockerContainerRunningSync(containers.embedding)) {
                        logger.info({ containerId: containers.embedding }, 'Stopping embedding container');
                        const stopCmd = forceDocker
                            ? `docker kill ${containers.embedding}`
                            : `docker stop ${containers.embedding}`;
                        execSync(stopCmd, { encoding: 'utf-8', timeout: 30000 });
                    }
                    const rmFlags = removeVolumes ? '-v' : '';
                    execSync(`docker rm ${rmFlags} ${containers.embedding} 2>/dev/null || true`, {
                        encoding: 'utf-8',
                        timeout: 10000,
                    });
                    logger.info({ containerId: containers.embedding }, 'Removed embedding container');
                }
                catch (err) {
                    result.errors.push(`Failed to stop embedding container: ${err.message}`);
                }
            }
            // Note: Postgres docker support removed - use system postgres on port 5432
        }
    }
    catch (err) {
        logger.warn({ err, projectDirName }, 'Error during Docker cleanup (non-fatal)');
    }
    // Step 2: Send SIGTERM and wait for graceful shutdown
    try {
        logger.info({ pid: existingPid }, 'Sending SIGTERM to existing instance');
        process.kill(existingPid, 'SIGTERM');
        // Wait up to 5 seconds for graceful shutdown
        const startTime = Date.now();
        const maxWait = 5000;
        let processExited = false;
        while (Date.now() - startTime < maxWait) {
            if (!isProcessRunning(existingPid)) {
                processExited = true;
                break;
            }
            // Synchronous sleep (we want this to be blocking for startup reliability)
            const sleepMs = 100;
            const sleepStart = Date.now();
            while (Date.now() - sleepStart < sleepMs) {
                // Busy wait - we need synchronous behavior here
            }
        }
        if (processExited) {
            logger.info({ pid: existingPid }, 'Process exited gracefully after SIGTERM');
            result.killed.push(existingPid);
        }
        else {
            // Step 3: Process still alive - send SIGKILL
            logger.warn({ pid: existingPid }, 'Process did not exit gracefully, sending SIGKILL');
            try {
                process.kill(existingPid, 'SIGKILL');
                // Give it a moment to die
                const killStart = Date.now();
                while (Date.now() - killStart < 500) {
                    // Busy wait
                }
                result.killed.push(existingPid);
                logger.info({ pid: existingPid }, 'Process killed with SIGKILL');
            }
            catch (killErr) {
                result.errors.push(`Failed to SIGKILL process ${existingPid}: ${killErr.message}`);
            }
        }
        // Step 4: Clean up files and registry
        cleanupInstanceFiles(baseDir, projectDirName, registry);
    }
    catch (err) {
        const errMsg = err.message;
        if (errMsg.includes('ESRCH')) {
            // Process already dead
            logger.info({ pid: existingPid }, 'Process was already dead');
            cleanupInstanceFiles(baseDir, projectDirName, registry);
        }
        else {
            result.errors.push(`Failed to kill process ${existingPid}: ${errMsg}`);
        }
    }
    logger.info({
        killed: result.killed,
        skipped: result.skipped,
        errors: result.errors,
    }, 'Same-project instance cleanup complete');
    return result;
}
/**
 * Helper to clean up instance files and registry entry
 */
function cleanupInstanceFiles(baseDir, projectDirName, registry) {
    const instanceDir = path.join(baseDir, 'instances', projectDirName);
    // Remove PID file
    try {
        fs.unlinkSync(path.join(instanceDir, PID_FILE));
    }
    catch { /* ignore */ }
    // Remove socket file
    try {
        fs.unlinkSync(path.join(instanceDir, SOCKET_FILE));
    }
    catch { /* ignore */ }
    // Remove instance state file
    try {
        fs.unlinkSync(path.join(instanceDir, STATE_FILE));
    }
    catch { /* ignore */ }
    // Remove docker containers file
    try {
        fs.unlinkSync(path.join(instanceDir, 'docker-containers.json'));
    }
    catch { /* ignore */ }
    // Remove from registry
    delete registry.instances[projectDirName];
    const registryPath = path.join(baseDir, REGISTRY_FILE);
    registry.lastUpdated = new Date().toISOString();
    try {
        fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), { mode: 0o644 });
    }
    catch { /* ignore */ }
    logger.debug({ instanceDir, projectDirName }, 'Cleaned up instance files and registry entry');
}
/**
 * Ensure only a single SpecMem instance runs for a project.
 * This is the "safe" entry point for startup that:
 * 1. Cleans up any existing same-project instances
 * 2. Initializes the new instance
 *
 * @param config - Instance manager configuration
 * @returns Result from initialization (success or failure)
 */
export async function ensureSingleInstance(config) {
    const projectPath = path.resolve(config.projectPath);
    logger.info({ projectPath }, 'Ensuring single instance for project');
    // Step 1: Clean up any existing same-project instances
    const cleanupResult = cleanupSameProjectInstances(projectPath, {
        baseDir: config.baseDir,
    });
    // Log if we killed anything
    if (cleanupResult.killed.length > 0) {
        logger.info({
            killedPids: cleanupResult.killed,
        }, 'Killed existing same-project instances');
    }
    if (cleanupResult.errors.length > 0) {
        logger.warn({
            errors: cleanupResult.errors,
        }, 'Errors during same-project cleanup (continuing anyway)');
    }
    // Step 2: Create/get the instance manager
    let instanceManager;
    try {
        instanceManager = getInstanceManager({
            ...config,
            projectPath,
        });
    }
    catch {
        // Instance manager might already exist, reset and recreate
        resetInstanceManager();
        instanceManager = getInstanceManager({
            ...config,
            projectPath,
        });
    }
    // Step 3: Initialize the instance
    const initResult = await instanceManager.initialize();
    return {
        ...initResult,
        cleanupResult,
    };
}
// ============================================================================
// Kill Instance Function
// ============================================================================
/**
 * Kill a specific SpecMem instance by project path, dir name, or hash
 * Also cleans up associated Docker containers
 * Now supports readable project dir names (e.g., "myproject")
 *
 * SAFETY: This function is used for EXPLICIT user-requested kills (e.g., CLI commands).
 * It reads the PID from the project's own PID file, ensuring we only kill processes
 * that were registered for that specific project. The lookup flow is:
 *
 * 1. User provides project identifier (path, dir name, or hash)
 * 2. We resolve to instance directory: ~/.specmem/instances/{identifier}/
 * 3. Read PID from that directory's specmem.pid file
 * 4. Kill only that specific PID
 *
 * This ensures cross-project safety because each project has its own PID file.
 */
export async function killInstance(projectPathOrNameOrHash, options) {
    const baseDir = options?.baseDir || DEFAULT_BASE_DIR;
    const signal = options?.signal || 'SIGTERM';
    const forceKill = options?.force || false;
    const cleanupDocker = options?.cleanupDocker ?? true;
    const removeVolumes = options?.removeVolumes ?? false;
    // Determine what type of identifier we got:
    // 1. 16-char hex = legacy hash
    // 2. Absolute/relative path = derive dir name
    // 3. Otherwise = treat as project dir name
    const isLegacyHash = /^[a-f0-9]{16}$/i.test(projectPathOrNameOrHash);
    const isPath = projectPathOrNameOrHash.includes('/') || projectPathOrNameOrHash.includes('\\');
    const instanceKey = isLegacyHash
        ? projectPathOrNameOrHash
        : isPath
            ? getProjectDirName(projectPathOrNameOrHash)
            : projectPathOrNameOrHash;
    // Try to get project path from registry for Docker cleanup
    let projectPath;
    try {
        const registryPath = path.join(baseDir, REGISTRY_FILE);
        const content = fs.readFileSync(registryPath, 'utf-8');
        const registry = JSON.parse(content);
        projectPath = registry.instances[instanceKey]?.projectPath;
    }
    catch {
        // Will use directory lookup instead
    }
    const instanceDir = path.join(baseDir, 'instances', instanceKey);
    const pidFile = path.join(instanceDir, PID_FILE);
    // Clean up Docker containers first (before killing process)
    let dockerCleanup;
    if (cleanupDocker) {
        try {
            // Try to get Docker containers from the instance directory
            const dockerFile = path.join(instanceDir, 'docker-containers.json');
            let containers = {};
            try {
                const dockerContent = fs.readFileSync(dockerFile, 'utf-8');
                const dockerInfo = JSON.parse(dockerContent);
                containers = dockerInfo.containers || {};
            }
            catch {
                // No docker containers file - that's okay
            }
            dockerCleanup = {};
            if (containers.embedding) {
                try {
                    // Stop embedding container - configurable via SPECMEM_DOCKER_STOP_TIMEOUT_MS
                    const dockerStopTimeout = parseInt(process.env['SPECMEM_DOCKER_STOP_TIMEOUT_MS'] || '30000', 10);
                    if (isDockerContainerRunningSync(containers.embedding)) {
                        const stopCmd = forceKill
                            ? `docker kill ${containers.embedding}`
                            : `docker stop ${containers.embedding}`;
                        execSync(stopCmd, { encoding: 'utf-8', timeout: dockerStopTimeout });
                    }
                    const rmFlags = removeVolumes ? '-v' : '';
                    execSync(`docker rm ${rmFlags} ${containers.embedding} 2>/dev/null || true`, {
                        encoding: 'utf-8',
                        timeout: 10000,
                    });
                    dockerCleanup.embedding = { stopped: true, containerId: containers.embedding };
                    logger.info({ containerId: containers.embedding }, 'Stopped embedding Docker container');
                }
                catch (err) {
                    dockerCleanup.embedding = { stopped: false, containerId: containers.embedding };
                    logger.warn({ containerId: containers.embedding, err }, 'Failed to stop embedding container');
                }
            }
            // Note: Postgres docker support removed - use system postgres on port 5432
            // Remove docker containers file
            try {
                fs.unlinkSync(dockerFile);
            }
            catch {
                // File may not exist
            }
        }
        catch (err) {
            logger.warn({ err, instanceKey }, 'Error during Docker cleanup');
        }
    }
    // Read PID
    let pid = null;
    try {
        const content = fs.readFileSync(pidFile, 'utf-8').trim();
        pid = parseInt(content, 10);
    }
    catch {
        return {
            success: false,
            error: 'Instance not found or PID file missing',
            dockerCleanup,
        };
    }
    if (pid === null || isNaN(pid)) {
        return { success: false, error: 'Invalid PID in PID file', dockerCleanup };
    }
    // Check if process is running
    if (!isProcessRunning(pid)) {
        // Clean up files anyway
        try {
            fs.unlinkSync(pidFile);
        }
        catch { /* ignore */ }
        try {
            fs.unlinkSync(path.join(instanceDir, SOCKET_FILE));
        }
        catch { /* ignore */ }
        try {
            fs.unlinkSync(path.join(instanceDir, STATE_FILE));
        }
        catch { /* ignore */ }
        return {
            success: true,
            pid,
            error: 'Process was already dead, cleaned up files',
            dockerCleanup,
        };
    }
    // Kill the process
    try {
        process.kill(pid, signal);
        // Wait for process to exit (up to 5 seconds)
        const startTime = Date.now();
        while (isProcessRunning(pid) && (Date.now() - startTime) < 5000) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        // Force kill if still running and requested
        if (isProcessRunning(pid) && forceKill) {
            process.kill(pid, 'SIGKILL');
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        // Clean up files
        try {
            fs.unlinkSync(pidFile);
        }
        catch { /* ignore */ }
        try {
            fs.unlinkSync(path.join(instanceDir, SOCKET_FILE));
        }
        catch { /* ignore */ }
        try {
            fs.unlinkSync(path.join(instanceDir, STATE_FILE));
        }
        catch { /* ignore */ }
        // Update registry
        const registryPath = path.join(baseDir, REGISTRY_FILE);
        try {
            const content = fs.readFileSync(registryPath, 'utf-8');
            const registry = JSON.parse(content);
            delete registry.instances[instanceKey];
            registry.lastUpdated = new Date().toISOString();
            fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
        }
        catch {
            // Ignore registry errors
        }
        return { success: true, pid, dockerCleanup };
    }
    catch (err) {
        return {
            success: false,
            pid,
            error: `Failed to kill process: ${err.message}`,
            dockerCleanup,
        };
    }
}
/**
 * Synchronous check if Docker container is running (for use in killInstance)
 */
function isDockerContainerRunningSync(containerId) {
    try {
        const result = execSync(`docker inspect -f '{{.State.Running}}' ${containerId} 2>/dev/null || echo "false"`, { encoding: 'utf-8' }).trim();
        return result === 'true';
    }
    catch {
        return false;
    }
}
/**
 * Kill all running SpecMem instances
 */
export async function killAllInstances(options) {
    const baseDir = options?.baseDir || DEFAULT_BASE_DIR;
    const excludeSelf = options?.excludeSelf ?? true;
    const killed = [];
    const failed = [];
    const errors = [];
    // Load registry
    const registryPath = path.join(baseDir, REGISTRY_FILE);
    let registry;
    try {
        const content = fs.readFileSync(registryPath, 'utf-8');
        registry = JSON.parse(content);
    }
    catch {
        return { killed, failed, errors: ['No registry found'] };
    }
    // Kill each instance (keyed by readable project dir name now)
    for (const [instanceKey, info] of Object.entries(registry.instances)) {
        // Skip self if requested
        if (excludeSelf && info.pid === process.pid) {
            continue;
        }
        const result = await killInstance(instanceKey, options);
        if (result.success && result.pid) {
            killed.push(result.pid);
        }
        else if (result.pid) {
            failed.push(result.pid);
            if (result.error) {
                errors.push(result.error);
            }
        }
    }
    return { killed, failed, errors };
}
/**
 * List all running instances with Docker container status
 */
export function listInstances(options) {
    const baseDir = options?.baseDir || DEFAULT_BASE_DIR;
    const includeDockerStatus = options?.includeDockerStatus ?? true;
    const registryPath = path.join(baseDir, REGISTRY_FILE);
    try {
        const content = fs.readFileSync(registryPath, 'utf-8');
        const registry = JSON.parse(content);
        // Verify each instance is still running and check Docker containers
        // Instances are now keyed by readable project dir name (e.g., "myproject")
        const instances = [];
        for (const [instanceKey, info] of Object.entries(registry.instances)) {
            const instanceInfo = {
                ...info,
                status: isProcessRunning(info.pid) ? 'running' : 'stopped',
            };
            // Check Docker container status if requested
            if (includeDockerStatus) {
                const instanceDir = path.join(baseDir, 'instances', instanceKey);
                const dockerFile = path.join(instanceDir, 'docker-containers.json');
                try {
                    const dockerContent = fs.readFileSync(dockerFile, 'utf-8');
                    const dockerInfo = JSON.parse(dockerContent);
                    const containers = dockerInfo.containers || {};
                    // Verify containers are actually running
                    const verifiedContainers = {};
                    if (containers.embedding) {
                        const isRunning = isDockerContainerRunningSync(containers.embedding);
                        verifiedContainers.embedding = isRunning
                            ? containers.embedding
                            : `${containers.embedding} (stopped)`;
                    }
                    if (containers.postgres) {
                        const isRunning = isDockerContainerRunningSync(containers.postgres);
                        verifiedContainers.postgres = isRunning
                            ? containers.postgres
                            : `${containers.postgres} (stopped)`;
                    }
                    instanceInfo.dockerContainers = verifiedContainers;
                    // Also include ports from docker file if available
                    if (dockerInfo.ports) {
                        instanceInfo.ports = dockerInfo.ports;
                    }
                }
                catch {
                    // No docker containers for this instance
                }
            }
            instances.push(instanceInfo);
        }
        return instances;
    }
    catch {
        return [];
    }
}
/**
 * List all instances with comprehensive Docker and port information
 */
export function listInstancesDetailed(options) {
    const baseDir = options?.baseDir || DEFAULT_BASE_DIR;
    const registryPath = path.join(baseDir, REGISTRY_FILE);
    try {
        const content = fs.readFileSync(registryPath, 'utf-8');
        const registry = JSON.parse(content);
        const entries = [];
        // Instances are now keyed by readable project dir name
        for (const [instanceKey, info] of Object.entries(registry.instances)) {
            const processAlive = isProcessRunning(info.pid);
            const instanceDir = path.join(baseDir, 'instances', instanceKey);
            // Get Docker container info
            let embeddingId;
            let embeddingRunning = false;
            let postgresId;
            let postgresRunning = false;
            try {
                const dockerFile = path.join(instanceDir, 'docker-containers.json');
                const dockerContent = fs.readFileSync(dockerFile, 'utf-8');
                const dockerInfo = JSON.parse(dockerContent);
                const containers = dockerInfo.containers || {};
                if (containers.embedding) {
                    embeddingId = containers.embedding;
                    embeddingRunning = isDockerContainerRunningSync(containers.embedding);
                }
                if (containers.postgres) {
                    postgresId = containers.postgres;
                    postgresRunning = isDockerContainerRunningSync(containers.postgres);
                }
            }
            catch {
                // No docker containers for this instance
            }
            // Get or calculate ports
            const calculatedPorts = calculateInstancePorts(info.projectPath);
            const allocatedPorts = {
                dashboard: info.ports?.dashboard || info.dashboardPort || calculatedPorts.dashboard,
                coordination: info.ports?.coordination || info.coordinationPort || calculatedPorts.coordination,
                postgres: info.ports?.postgres || info.postgresPort || calculatedPorts.postgres,
                embedding: info.ports?.embedding || info.embeddingPort || calculatedPorts.embedding,
            };
            entries.push({
                ...info,
                status: processAlive ? 'running' : 'stopped',
                processAlive,
                docker: {
                    embedding: { id: embeddingId, running: embeddingRunning },
                    postgres: { id: postgresId, running: postgresRunning },
                },
                allocatedPorts,
            });
        }
        return entries;
    }
    catch {
        return [];
    }
}
// ============================================================================
// Singleton Accessor
// ============================================================================
/**
 * Get or create the global instance manager
 */
export function getInstanceManager(config) {
    if (!globalInstanceManager && config) {
        globalInstanceManager = new InstanceManager(config);
    }
    // TASK #23 FIX: Auto-create with sensible defaults when not initialized
    if (!globalInstanceManager) {
        const defaultProjectPath = process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
        logger.info({ defaultProjectPath }, 'InstanceManager not initialized, creating with defaults');
        globalInstanceManager = new InstanceManager({
            projectPath: defaultProjectPath,
            autoCleanup: true,
            lockStrategy: 'both',
            healthCheckIntervalMs: 30000
        });
    }
    return globalInstanceManager;
}
/**
 * Reset the global instance manager (for testing)
 */
export function resetInstanceManager() {
    if (globalInstanceManager) {
        globalInstanceManager.shutdown();
        globalInstanceManager = null;
    }
}
/**
 * Check if instance manager is available
 */
export function hasInstanceManager() {
    return globalInstanceManager !== null;
}
// ============================================================================
// Migration Helper
// ============================================================================
/**
 * Migrate from old .specmem/ directory to new per-project structure
 * This handles the transition from single .specmem/ to ~/.specmem/instances/{dirname}/
 * Now uses readable project dir names instead of hashes!
 */
export async function migrateFromOldStructure(projectPath) {
    const oldDir = path.join(projectPath, '.specmem');
    const newBaseDir = DEFAULT_BASE_DIR;
    const projectDirName = getProjectDirName(projectPath);
    const newInstanceDir = path.join(newBaseDir, 'instances', projectDirName);
    // Check if old directory exists
    if (!fs.existsSync(oldDir)) {
        return;
    }
    // Check if already migrated
    if (fs.existsSync(newInstanceDir)) {
        return;
    }
    logger.info({ oldDir, newInstanceDir }, 'Migrating from old .specmem structure');
    try {
        // Create new directory
        await fsp.mkdir(newInstanceDir, { recursive: true, mode: 0o755 });
        // Copy relevant files (but not ports.json which stays in old location for backward compat)
        const filesToMigrate = [PID_FILE, SOCKET_FILE, STATE_FILE, LOCK_FILE];
        for (const file of filesToMigrate) {
            const oldPath = path.join(oldDir, file);
            const newPath = path.join(newInstanceDir, file);
            try {
                await fsp.copyFile(oldPath, newPath);
                await fsp.unlink(oldPath);
            }
            catch {
                // File may not exist - ignore
            }
        }
        logger.info({ projectPath }, 'Migration complete');
    }
    catch (err) {
        logger.warn({ err, projectPath }, 'Migration failed (non-fatal)');
    }
}
// ============================================================================
// Docker Container Management
// ============================================================================
/**
 * File name for storing Docker container info
 */
const DOCKER_FILE = 'docker-containers.json';
/**
 * Port configuration constants for Docker/embedding services
 */
const DOCKER_PORT_CONFIG = {
    /** Minimum embedding service port */
    EMBEDDING_MIN_PORT: 9000,
    /** Maximum embedding service port */
    EMBEDDING_MAX_PORT: 9100,
    /** Embedding port range size */
    EMBEDDING_RANGE: 100,
};
/**
 * Register a Docker container for this project instance
 * Now uses readable project dir name for instance directories!
 *
 * @param projectPath - Project path (uses SPECMEM_PROJECT_PATH env if not provided)
 * @param containerType - Type of container: 'embedding' or 'postgres'
 * @param containerId - Docker container ID or name
 */
export async function registerDockerContainer(projectPath, containerType, containerId) {
    const projectDirName = getProjectDirName(projectPath);
    const baseDir = os.homedir();
    const instanceDir = path.join(baseDir, '.specmem', 'instances', projectDirName);
    const dockerFile = path.join(instanceDir, DOCKER_FILE);
    // Ensure instance directory exists
    try {
        await fsp.mkdir(instanceDir, { recursive: true, mode: 0o755 });
    }
    catch (err) {
        if (err.code !== 'EEXIST') {
            throw err;
        }
    }
    // Load existing docker info or create new
    let dockerInfo;
    try {
        const content = await fsp.readFile(dockerFile, 'utf-8');
        dockerInfo = JSON.parse(content);
    }
    catch {
        dockerInfo = {
            version: 1,
            projectDirName,
            containers: {},
            ports: {},
            updatedAt: new Date().toISOString(),
        };
    }
    // Update container info
    dockerInfo.containers[containerType] = containerId;
    dockerInfo.updatedAt = new Date().toISOString();
    // Write back
    await fsp.writeFile(dockerFile, JSON.stringify(dockerInfo, null, 2), 'utf-8');
    logger.info({
        projectPath,
        projectDirName,
        containerType,
        containerId,
    }, 'Registered Docker container for instance');
    // Also update the main registry if instance is registered
    const registry = loadRegistrySync();
    if (registry.instances[projectDirName]) {
        if (!registry.instances[projectDirName].dockerContainers) {
            registry.instances[projectDirName].dockerContainers = {};
        }
        registry.instances[projectDirName].dockerContainers[containerType] = containerId;
        saveRegistrySync(registry);
    }
}
/**
 * Get Docker containers for a project instance
 * Now uses readable project dir name for instance directories!
 *
 * @param projectPath - Project path
 * @returns Object with embedding and postgres container IDs
 */
export async function getDockerContainers(projectPath) {
    const projectDirName = getProjectDirName(projectPath);
    const baseDir = os.homedir();
    const instanceDir = path.join(baseDir, '.specmem', 'instances', projectDirName);
    const dockerFile = path.join(instanceDir, DOCKER_FILE);
    try {
        const content = await fsp.readFile(dockerFile, 'utf-8');
        const dockerInfo = JSON.parse(content);
        return dockerInfo.containers;
    }
    catch {
        return {};
    }
}
/**
 * Check if a Docker container is running
 *
 * @param containerId - Container ID or name
 * @returns True if container is running
 */
export function isDockerContainerRunning(containerId) {
    try {
        const result = execSync(`docker inspect -f '{{.State.Running}}' ${containerId} 2>/dev/null || echo "false"`, { encoding: 'utf-8' }).trim();
        return result === 'true';
    }
    catch {
        return false;
    }
}
/**
 * Stop and remove a Docker container
 *
 * @param containerId - Container ID or name
 * @param options - Optional: force remove, remove volumes
 * @returns True if successfully stopped
 */
export async function stopDockerContainer(containerId, options) {
    const force = options?.force ?? false;
    const removeVolumes = options?.removeVolumes ?? false;
    try {
        // Docker stop timeout - configurable via SPECMEM_DOCKER_STOP_TIMEOUT_MS
        const dockerStopTimeout = parseInt(process.env['SPECMEM_DOCKER_STOP_TIMEOUT_MS'] || '30000', 10);
        // First stop the container
        if (isDockerContainerRunning(containerId)) {
            const stopCmd = force
                ? `docker kill ${containerId}`
                : `docker stop ${containerId}`;
            execSync(stopCmd, { encoding: 'utf-8', timeout: dockerStopTimeout });
            logger.info({ containerId }, 'Stopped Docker container');
        }
        // Then remove it
        const rmFlags = removeVolumes ? '-v' : '';
        execSync(`docker rm ${rmFlags} ${containerId} 2>/dev/null || true`, {
            encoding: 'utf-8',
            timeout: 10000,
        });
        logger.info({ containerId }, 'Removed Docker container');
        return true;
    }
    catch (err) {
        logger.warn({ containerId, err }, 'Failed to stop/remove Docker container');
        return false;
    }
}
/**
 * Clean up all Docker containers for a project instance
 *
 * @param projectPath - Project path
 * @param options - Optional: force stop, remove volumes
 * @returns Object with results for each container type
 */
export async function cleanupDockerContainers(projectPath, options) {
    const containers = await getDockerContainers(projectPath);
    const results = {};
    if (containers.embedding) {
        const stopped = await stopDockerContainer(containers.embedding, options);
        results.embedding = { stopped, containerId: containers.embedding };
    }
    if (containers.postgres) {
        const stopped = await stopDockerContainer(containers.postgres, options);
        results.postgres = { stopped, containerId: containers.postgres };
    }
    // Clean up the docker containers file
    const projectDirName = getProjectDirName(projectPath);
    const baseDir = os.homedir();
    const dockerFile = path.join(baseDir, '.specmem', 'instances', projectDirName, DOCKER_FILE);
    try {
        await fsp.unlink(dockerFile);
    }
    catch {
        // File may not exist - ignore
    }
    // Also clean from registry
    const registry = loadRegistrySync();
    if (registry.instances[projectDirName]) {
        delete registry.instances[projectDirName].dockerContainers;
        saveRegistrySync(registry);
    }
    logger.info({
        projectPath,
        results,
    }, 'Cleaned up Docker containers for instance');
    return results;
}
// ============================================================================
// Deterministic Port Calculation
// ============================================================================
/**
 * FORBIDDEN PORTS - These ports must NEVER be used
 * Port 8787 is explicitly forbidden per project requirements
 */
const FORBIDDEN_PORTS = [8787];
/**
 * Dynamic port allocation configuration
 * Range: 8595-8720 (125 usable ports, excluding 8787)
 */
const DYNAMIC_PORT_CONFIG = {
    MIN_PORT: 8595,
    MAX_PORT: 8720,
    RANGE_SIZE: 126, // 8720 - 8595 + 1
};
/**
 * Check if a port is forbidden (must NEVER be used)
 */
function isForbiddenPort(port) {
    return FORBIDDEN_PORTS.includes(port);
}
/**
 * Adjust port to skip forbidden ports
 * If port lands on or near 8787, skip past it
 */
function skipForbiddenPorts(port, minPort, maxPort) {
    let adjustedPort = port;
    while (isForbiddenPort(adjustedPort)) {
        adjustedPort++;
        if (adjustedPort > maxPort) {
            adjustedPort = minPort;
        }
    }
    return adjustedPort;
}
/**
 * Calculate deterministic ports for an instance based on project hash.
 * Uses the project path hash to generate unique, consistent port allocations.
 *
 * IMPORTANT: Uses dynamic range 8595-8720 (125 ports)
 * Port 8787 is FORBIDDEN and will never be allocated
 *
 * Port ranges:
 * - Dashboard: 8595-8720 (dynamic, skip 8787)
 * - Coordination: 8595-8720 (dynamic, skip 8787)
 * - PostgreSQL: 5433-5532 (unchanged)
 * - Embedding: 9000-9099 (unchanged)
 *
 * @param projectPath - Project path to calculate ports for
 * @returns Port allocations for all services
 */
export function calculateInstancePorts(projectPath) {
    const normalizedPath = path.resolve(projectPath).toLowerCase().replace(/\\/g, '/');
    const fullHash = createHash('sha256').update(normalizedPath).digest('hex');
    // Calculate offsets within the dynamic range (8595-8720)
    // Each instance needs 2 consecutive ports (dashboard, coordination)
    // So we can have ~62 instances in the range
    const dynamicRange = DYNAMIC_PORT_CONFIG.MAX_PORT - DYNAMIC_PORT_CONFIG.MIN_PORT - 1; // -1 for coordination
    const baseOffset = parseInt(fullHash.substring(0, 8), 16) % dynamicRange;
    // Calculate dashboard port (even offset for spacing)
    let dashboardPort = DYNAMIC_PORT_CONFIG.MIN_PORT + (baseOffset * 2 % dynamicRange);
    if (dashboardPort > DYNAMIC_PORT_CONFIG.MAX_PORT - 1) {
        dashboardPort = DYNAMIC_PORT_CONFIG.MIN_PORT + (dashboardPort % dynamicRange);
    }
    // Skip forbidden ports for dashboard
    dashboardPort = skipForbiddenPorts(dashboardPort, DYNAMIC_PORT_CONFIG.MIN_PORT, DYNAMIC_PORT_CONFIG.MAX_PORT - 1);
    // Coordination port is always dashboard + 1
    let coordinationPort = dashboardPort + 1;
    // If coordination port is forbidden or out of range, adjust dashboard
    while (isForbiddenPort(coordinationPort) || coordinationPort > DYNAMIC_PORT_CONFIG.MAX_PORT) {
        dashboardPort++;
        if (dashboardPort > DYNAMIC_PORT_CONFIG.MAX_PORT - 1) {
            dashboardPort = DYNAMIC_PORT_CONFIG.MIN_PORT;
        }
        dashboardPort = skipForbiddenPorts(dashboardPort, DYNAMIC_PORT_CONFIG.MIN_PORT, DYNAMIC_PORT_CONFIG.MAX_PORT - 1);
        coordinationPort = dashboardPort + 1;
    }
    // PostgreSQL and embedding use their own ranges (unchanged)
    const postgresOffset = parseInt(fullHash.substring(8, 12), 16) % 100;
    const embeddingOffset = parseInt(fullHash.substring(12, 16), 16) % DOCKER_PORT_CONFIG.EMBEDDING_RANGE;
    return {
        dashboard: dashboardPort,
        coordination: coordinationPort,
        postgres: 5433 + postgresOffset,
        embedding: DOCKER_PORT_CONFIG.EMBEDDING_MIN_PORT + embeddingOffset,
    };
}
/**
 * Get instance ports, either from cache/registry or calculate new ones.
 * This is the main entry point for getting port allocations.
 * Now uses readable project dir name for registry lookups!
 *
 * @param projectPath - Project path (defaults to SPECMEM_PROJECT_PATH or cwd)
 * @returns Port allocations for all services
 */
export function getInstancePortsFromManager(projectPath) {
    const effectivePath = projectPath || process.env.SPECMEM_PROJECT_PATH || process.cwd();
    const projectDirName = getProjectDirName(effectivePath);
    // Try to get from registry first
    const registry = loadRegistrySync();
    const instance = registry.instances[projectDirName];
    if (instance?.ports) {
        return {
            postgres: instance.ports.postgres || instance.postgresPort || 5433,
            embedding: instance.ports.embedding || instance.embeddingPort || 9000,
            dashboard: instance.ports.dashboard || instance.dashboardPort || 8595,
            coordination: instance.ports.coordination || instance.coordinationPort || 8596,
        };
    }
    // Calculate deterministic ports
    return calculateInstancePorts(effectivePath);
}
/**
 * Register port allocations for an instance
 * Now uses readable project dir name for registry lookups!
 *
 * @param projectPath - Project path
 * @param ports - Port allocations to register
 */
export function registerInstancePorts(projectPath, ports) {
    const projectDirName = getProjectDirName(projectPath);
    const registry = loadRegistrySync();
    if (registry.instances[projectDirName]) {
        registry.instances[projectDirName].ports = ports;
        registry.instances[projectDirName].dashboardPort = ports.dashboard;
        registry.instances[projectDirName].coordinationPort = ports.coordination;
        registry.instances[projectDirName].postgresPort = ports.postgres;
        registry.instances[projectDirName].embeddingPort = ports.embedding;
        saveRegistrySync(registry);
    }
}
// ============================================================================
// Sync Registry Helpers (for use in Docker functions)
// ============================================================================
/**
 * Load registry synchronously
 */
function loadRegistrySync(baseDir) {
    const base = baseDir || DEFAULT_BASE_DIR;
    const registryPath = path.join(base, REGISTRY_FILE);
    try {
        const content = fs.readFileSync(registryPath, 'utf-8');
        const registry = JSON.parse(content);
        if (!registry.version || registry.version < 2) {
            return {
                version: 2,
                instances: registry.instances || {},
                lastUpdated: new Date().toISOString(),
            };
        }
        return registry;
    }
    catch {
        return {
            version: 2,
            instances: {},
            lastUpdated: new Date().toISOString(),
        };
    }
}
/**
 * Save registry synchronously
 */
function saveRegistrySync(registry, baseDir) {
    const base = baseDir || DEFAULT_BASE_DIR;
    const registryPath = path.join(base, REGISTRY_FILE);
    try {
        fs.mkdirSync(base, { recursive: true, mode: 0o755 });
    }
    catch (err) {
        if (err.code !== 'EEXIST') {
            throw err;
        }
    }
    registry.lastUpdated = new Date().toISOString();
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), { mode: 0o644 });
}
//# sourceMappingURL=instanceManager.js.map