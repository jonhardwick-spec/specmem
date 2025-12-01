/**
 * SpecMem Auto-Start Mechanism
 *
 * Implements project-local SpecMem instances that:
 * 1. Automatically start when Claude Code starts
 * 2. Are isolated per project (using project path hash)
 * 3. Detect existing instances to prevent duplicates
 * 4. Handle graceful shutdown on Claude Code exit
 * 5. Auto-restart on crash with backoff
 *
 * Integration Points:
 * - Claude Code spawns SpecMem via MCP server config
 * - Working directory passed via SPECMEM_PROJECT_PATH env var
 * - PID file stored in project's .specmem/ directory
 * - Socket/lock files for process detection
 */
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawn, execSync } from 'child_process';
import { createServer, Socket } from 'net';
import { fileURLToPath } from 'url';
import { mergeWithProjectEnv } from '../utils/projectEnv.js';
// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ============================================================================
// Constants
// ============================================================================
const DEFAULT_CONFIG = {
    maxRestarts: 5,
    restartBackoffMs: 1000,
    maxRestartBackoffMs: 30000,
    healthCheckIntervalMs: 10000,
    shutdownTimeoutMs: 5000,
    createProjectDir: true,
    lockStrategy: 'both',
};
const SPECMEM_DIR = '.specmem';
const PID_FILE = 'specmem.pid';
const LOCK_FILE = 'specmem.lock';
const SOCKET_FILE = 'specmem.sock';
const STATE_FILE = 'instance.json';
// ============================================================================
// Utility Functions
// ============================================================================
/**
 * Generate a unique hash for a project path
 * Used to create project-specific instance identifiers
 */
export function hashProjectPath(projectPath) {
    const normalizedPath = path.resolve(projectPath);
    return crypto
        .createHash('sha256')
        .update(normalizedPath)
        .digest('hex')
        .substring(0, 12);
}
/**
 * Get the SpecMem directory for a project
 * Returns the path (does not create - use ensureSpecMemDir for that)
 */
export function getSpecMemDir(projectPath, _create = false) {
    // Note: create parameter kept for backward compatibility but is now a no-op
    // Use ensureSpecMemDir() for async creation
    return path.join(projectPath, SPECMEM_DIR);
}
/**
 * Ensure the SpecMem directory exists (async version)
 * Creates it if it doesn't exist and optionally updates .gitignore
 */
export async function ensureSpecMemDir(projectPath) {
    const specmemDir = path.join(projectPath, SPECMEM_DIR);
    try {
        await fsp.mkdir(specmemDir, { recursive: true, mode: 0o755 });
    }
    catch (err) {
        // EEXIST is fine - directory already exists
        if (err.code !== 'EEXIST') {
            throw err;
        }
    }
    // Try to add to .gitignore if it exists
    const gitignorePath = path.join(projectPath, '.gitignore');
    try {
        const content = await fsp.readFile(gitignorePath, 'utf-8');
        if (!content.includes(SPECMEM_DIR)) {
            await fsp.appendFile(gitignorePath, `\n# SpecMem local instance\n${SPECMEM_DIR}/\n`);
        }
    }
    catch {
        // .gitignore doesn't exist or not readable - that's fine
    }
    return specmemDir;
}
/**
 * Sync version of ensureSpecMemDir for contexts where async isn't possible
 */
export function ensureSpecMemDirSync(projectPath) {
    const specmemDir = path.join(projectPath, SPECMEM_DIR);
    try {
        fs.mkdirSync(specmemDir, { recursive: true, mode: 0o755 });
    }
    catch (err) {
        if (err.code !== 'EEXIST') {
            throw err;
        }
    }
    // Try to add to .gitignore
    const gitignorePath = path.join(projectPath, '.gitignore');
    try {
        const content = fs.readFileSync(gitignorePath, 'utf-8');
        if (!content.includes(SPECMEM_DIR)) {
            fs.appendFileSync(gitignorePath, `\n# SpecMem local instance\n${SPECMEM_DIR}/\n`);
        }
    }
    catch {
        // .gitignore doesn't exist or not readable - that's fine
    }
    return specmemDir;
}
/**
 * Get the path to a specific file in the SpecMem directory
 */
export function getSpecMemFilePath(projectPath, filename) {
    return path.join(getSpecMemDir(projectPath), filename);
}
/**
 * Check if a process with the given PID is running
 */
export function isProcessRunning(pid) {
    try {
        // Signal 0 checks if process exists without actually sending a signal
        process.kill(pid, 0);
        return true;
    }
    catch (e) {
        return false;
    }
}
/**
 * Check if a process is a SpecMem instance
 * Verifies by checking cmdline on Linux/Mac
 */
export function isSpecMemProcess(pid) {
    try {
        if (process.platform === 'linux') {
            const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
            return cmdline.includes('specmem') || cmdline.includes('bootstrap.cjs');
        }
        else if (process.platform === 'darwin') {
            const result = execSync(`ps -p ${pid} -o command=`, { encoding: 'utf-8' });
            return result.includes('specmem') || result.includes('bootstrap.cjs');
        }
        // On Windows or unknown platforms, just check if process exists
        return isProcessRunning(pid);
    }
    catch (e) {
        return false;
    }
}
// ============================================================================
// Lock Management
// ============================================================================
/**
 * Read the PID from the PID file
 */
export function readPidFile(projectPath) {
    const pidFile = getSpecMemFilePath(projectPath, PID_FILE);
    try {
        // Direct read - if file doesn't exist, readFileSync throws ENOENT
        const content = fs.readFileSync(pidFile, 'utf-8').trim();
        const pid = parseInt(content, 10);
        return isNaN(pid) ? null : pid;
    }
    catch {
        // File doesn't exist or not readable
        return null;
    }
}
/**
 * Read the PID from the PID file (async version)
 */
export async function readPidFileAsync(projectPath) {
    const pidFile = getSpecMemFilePath(projectPath, PID_FILE);
    try {
        const content = (await fsp.readFile(pidFile, 'utf-8')).trim();
        const pid = parseInt(content, 10);
        return isNaN(pid) ? null : pid;
    }
    catch {
        // File doesn't exist or not readable
        return null;
    }
}
/**
 * Write the PID to the PID file
 */
export function writePidFile(projectPath, pid) {
    const pidFile = getSpecMemFilePath(projectPath, PID_FILE);
    ensureSpecMemDirSync(projectPath); // Ensure directory exists
    fs.writeFileSync(pidFile, pid.toString(), { mode: 0o644 });
}
/**
 * Write the PID to the PID file (async version)
 */
export async function writePidFileAsync(projectPath, pid) {
    const pidFile = getSpecMemFilePath(projectPath, PID_FILE);
    await ensureSpecMemDir(projectPath);
    await fsp.writeFile(pidFile, pid.toString(), { mode: 0o644 });
}
/**
 * Remove the PID file
 */
export function removePidFile(projectPath) {
    const pidFile = getSpecMemFilePath(projectPath, PID_FILE);
    try {
        // Direct unlink - if file doesn't exist, it throws ENOENT which we ignore
        fs.unlinkSync(pidFile);
    }
    catch {
        // File doesn't exist or can't be removed - ignore
    }
}
/**
 * Remove the PID file (async version)
 */
export async function removePidFileAsync(projectPath) {
    const pidFile = getSpecMemFilePath(projectPath, PID_FILE);
    try {
        await fsp.unlink(pidFile);
    }
    catch {
        // File doesn't exist or can't be removed - ignore
    }
}
/**
 * Read the instance state from the state file
 */
export function readInstanceState(projectPath) {
    const stateFile = getSpecMemFilePath(projectPath, STATE_FILE);
    try {
        // Direct read - if file doesn't exist, readFileSync throws ENOENT
        const content = fs.readFileSync(stateFile, 'utf-8');
        const state = JSON.parse(content);
        return {
            ...state,
            startTime: new Date(state.startTime),
            lastCrash: state.lastCrash ? new Date(state.lastCrash) : undefined,
        };
    }
    catch {
        // File doesn't exist, not readable, or invalid JSON
        return null;
    }
}
/**
 * Read the instance state from the state file (async version)
 */
export async function readInstanceStateAsync(projectPath) {
    const stateFile = getSpecMemFilePath(projectPath, STATE_FILE);
    try {
        const content = await fsp.readFile(stateFile, 'utf-8');
        const state = JSON.parse(content);
        return {
            ...state,
            startTime: new Date(state.startTime),
            lastCrash: state.lastCrash ? new Date(state.lastCrash) : undefined,
        };
    }
    catch {
        // File doesn't exist, not readable, or invalid JSON
        return null;
    }
}
/**
 * Write the instance state to the state file
 */
export function writeInstanceState(projectPath, instance) {
    const stateFile = getSpecMemFilePath(projectPath, STATE_FILE);
    ensureSpecMemDirSync(projectPath); // Ensure directory exists
    fs.writeFileSync(stateFile, JSON.stringify(instance, null, 2), { mode: 0o644 });
}
/**
 * Write the instance state to the state file (async version)
 */
export async function writeInstanceStateAsync(projectPath, instance) {
    const stateFile = getSpecMemFilePath(projectPath, STATE_FILE);
    await ensureSpecMemDir(projectPath);
    await fsp.writeFile(stateFile, JSON.stringify(instance, null, 2), { mode: 0o644 });
}
/**
 * Remove the instance state file
 */
export function removeInstanceState(projectPath) {
    const stateFile = getSpecMemFilePath(projectPath, STATE_FILE);
    try {
        // Direct unlink - if file doesn't exist, it throws ENOENT which we ignore
        fs.unlinkSync(stateFile);
    }
    catch {
        // File doesn't exist or can't be removed - ignore
    }
}
/**
 * Remove the instance state file (async version)
 */
export async function removeInstanceStateAsync(projectPath) {
    const stateFile = getSpecMemFilePath(projectPath, STATE_FILE);
    try {
        await fsp.unlink(stateFile);
    }
    catch {
        // File doesn't exist or can't be removed - ignore
    }
}
// ============================================================================
// Socket-based Lock (more reliable than PID file alone)
// ============================================================================
let lockSocket = null;
/**
 * Try to acquire a socket-based lock for this project
 * Returns true if lock acquired, false if another instance is running
 */
export function tryAcquireSocketLock(projectPath) {
    const socketPath = getSpecMemFilePath(projectPath, SOCKET_FILE);
    ensureSpecMemDirSync(projectPath); // Ensure directory exists
    // Clean up stale socket file - direct unlink, no existence check
    try {
        fs.unlinkSync(socketPath);
    }
    catch (err) {
        // ENOENT is fine (file doesn't exist)
        // Other errors (like EBUSY) mean another process is using it
        if (err.code !== 'ENOENT') {
            return false;
        }
    }
    try {
        lockSocket = createServer((socket) => {
            // Handle incoming health check requests
            socket.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg === 'health') {
                    socket.write(JSON.stringify({ status: 'running', pid: process.pid }));
                }
                else if (msg === 'shutdown') {
                    socket.write(JSON.stringify({ status: 'shutting_down' }));
                    process.emit('SIGTERM');
                }
                socket.end();
            });
        });
        lockSocket.listen(socketPath);
        fs.chmodSync(socketPath, 0o600);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Try to acquire a socket-based lock for this project (async version)
 * Returns true if lock acquired, false if another instance is running
 */
export async function tryAcquireSocketLockAsync(projectPath) {
    const socketPath = getSpecMemFilePath(projectPath, SOCKET_FILE);
    await ensureSpecMemDir(projectPath);
    // Clean up stale socket file
    try {
        await fsp.unlink(socketPath);
    }
    catch (err) {
        if (err.code !== 'ENOENT') {
            return false;
        }
    }
    try {
        lockSocket = createServer((socket) => {
            socket.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg === 'health') {
                    socket.write(JSON.stringify({ status: 'running', pid: process.pid }));
                }
                else if (msg === 'shutdown') {
                    socket.write(JSON.stringify({ status: 'shutting_down' }));
                    process.emit('SIGTERM');
                }
                socket.end();
            });
        });
        lockSocket.listen(socketPath);
        await fsp.chmod(socketPath, 0o600);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Release the socket lock
 */
export function releaseSocketLock(projectPath) {
    const socketPath = getSpecMemFilePath(projectPath, SOCKET_FILE);
    if (lockSocket) {
        lockSocket.close();
        lockSocket = null;
    }
    try {
        // Direct unlink - if file doesn't exist, it throws ENOENT which we ignore
        fs.unlinkSync(socketPath);
    }
    catch {
        // File doesn't exist or can't be removed - ignore
    }
}
/**
 * Release the socket lock (async version)
 */
export async function releaseSocketLockAsync(projectPath) {
    const socketPath = getSpecMemFilePath(projectPath, SOCKET_FILE);
    if (lockSocket) {
        lockSocket.close();
        lockSocket = null;
    }
    try {
        await fsp.unlink(socketPath);
    }
    catch {
        // File doesn't exist or can't be removed - ignore
    }
}
/**
 * Check if a SpecMem instance is running for this project via socket
 * Uses connection attempt instead of file existence check to avoid race conditions
 */
export function checkSocketLock(projectPath) {
    return new Promise((resolve) => {
        const socketPath = getSpecMemFilePath(projectPath, SOCKET_FILE);
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
        // Just try to connect - if socket doesn't exist, we'll get an error
        socket.connect(socketPath);
    });
}
// ============================================================================
// Instance Detection
// ============================================================================
/**
 * Check if a SpecMem instance is already running for this project
 * Uses both PID file and socket check for reliability
 */
export async function isInstanceRunning(projectPath, strategy = 'both') {
    // Check PID file
    if (strategy === 'pid' || strategy === 'both') {
        const pid = readPidFile(projectPath);
        if (pid !== null && isProcessRunning(pid) && isSpecMemProcess(pid)) {
            return true;
        }
    }
    // Check socket
    if (strategy === 'socket' || strategy === 'both') {
        const socketRunning = await checkSocketLock(projectPath);
        if (socketRunning) {
            return true;
        }
    }
    return false;
}
/**
 * Get information about a running instance
 */
export async function getRunningInstance(projectPath) {
    // First check if instance is running
    const running = await isInstanceRunning(projectPath);
    if (!running) {
        return null;
    }
    // Try to read saved state
    const state = readInstanceState(projectPath);
    if (state) {
        return { ...state, status: 'running' };
    }
    // Fallback: construct minimal info from PID
    const pid = readPidFile(projectPath);
    if (pid !== null) {
        return {
            pid,
            projectPath,
            projectHash: hashProjectPath(projectPath),
            startTime: new Date(), // Unknown, use current time
            port: 0, // Unknown
            socketPath: getSpecMemFilePath(projectPath, SOCKET_FILE),
            status: 'running',
            restartCount: 0,
        };
    }
    return null;
}
// ============================================================================
// Auto-Start Manager
// ============================================================================
/**
 * Main class for managing auto-starting SpecMem instances
 */
export class AutoStartManager {
    config;
    process = null;
    instance = null;
    healthCheckInterval = null;
    isShuttingDown = false;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Start a SpecMem instance for the configured project
     * Returns existing instance if already running
     */
    async start() {
        const { projectPath, lockStrategy } = this.config;
        // Check for existing instance
        const existingInstance = await getRunningInstance(projectPath);
        if (existingInstance) {
            return {
                success: true,
                instance: existingInstance,
                alreadyRunning: true,
            };
        }
        // Clean up stale files
        this.cleanup();
        // Acquire lock
        if (lockStrategy === 'socket' || lockStrategy === 'both') {
            const acquired = tryAcquireSocketLock(projectPath);
            if (!acquired) {
                return {
                    success: false,
                    error: 'Failed to acquire socket lock - another instance may be starting',
                };
            }
        }
        // Create instance record
        this.instance = {
            pid: 0, // Will be set after spawn
            projectPath,
            projectHash: hashProjectPath(projectPath),
            startTime: new Date(),
            port: parseInt(process.env.SPECMEM_DASHBOARD_PORT || '8589', 10),
            socketPath: getSpecMemFilePath(projectPath, SOCKET_FILE),
            status: 'starting',
            restartCount: 0,
        };
        // Spawn the SpecMem process
        try {
            await this.spawnSpecMem();
            // Write state files
            if (this.process?.pid) {
                this.instance.pid = this.process.pid;
                this.instance.status = 'running';
                writePidFile(projectPath, this.process.pid);
                writeInstanceState(projectPath, this.instance);
            }
            // Start health monitoring
            this.startHealthCheck();
            return {
                success: true,
                instance: this.instance,
            };
        }
        catch (error) {
            this.cleanup();
            return {
                success: false,
                error: `Failed to start SpecMem: ${error.message}`,
            };
        }
    }
    /**
     * Spawn the actual SpecMem process
     */
    async spawnSpecMem() {
        const { projectPath } = this.config;
        // Determine SpecMem installation path
        // Could be global npm package or local installation
        const specmemPath = this.findSpecMemPath();
        // yooo ALWAYS use mergeWithProjectEnv for project isolation - spawned processes need the full context
        const env = mergeWithProjectEnv({
            SPECMEM_WATCHER_ROOT_PATH: projectPath,
            SPECMEM_CODEBASE_PATH: projectPath,
            SPECMEM_INSTANCE_TYPE: 'project-local',
        });
        // Spawn the process
        this.process = spawn('node', ['--max-old-space-size=250', specmemPath], {
            cwd: projectPath,
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: false, // Keep attached to parent for clean shutdown
        });
        // Handle process events
        this.process.on('error', (error) => {
            console.error('[AutoStart] Process error:', error);
            this.handleCrash();
        });
        this.process.on('exit', (code, signal) => {
            if (!this.isShuttingDown) {
                console.error('[AutoStart] Process exited unexpectedly:', { code, signal });
                this.handleCrash();
            }
        });
        // Forward stdout/stderr to parent (for debugging)
        this.process.stdout?.on('data', (data) => {
            process.stderr.write(`[SpecMem] ${data}`);
        });
        this.process.stderr?.on('data', (data) => {
            process.stderr.write(`[SpecMem] ${data}`);
        });
        // Wait for process to start
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Process startup timeout'));
            }, 10000);
            this.process?.on('spawn', () => {
                clearTimeout(timeout);
                resolve();
            });
            this.process?.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }
    /**
     * Find the SpecMem bootstrap script path
     * Uses fs.accessSync to check file accessibility rather than existsSync
     */
    findSpecMemPath() {
        // Check common locations
        const candidates = [
            // Relative to this module (when running from SpecMem itself)
            path.resolve(__dirname, '../../bootstrap.cjs'),
            // Global npm installation
            path.join(os.homedir(), '.npm-global/lib/node_modules/specmem/bootstrap.cjs'),
            // Current directory (development)
            path.join(process.cwd(), 'bootstrap.cjs'),
            // Environment variable override
            process.env.SPECMEM_BOOTSTRAP_PATH,
        ].filter(Boolean);
        for (const candidate of candidates) {
            try {
                // Check if file exists and is readable
                fs.accessSync(candidate, fs.constants.R_OK);
                return candidate;
            }
            catch {
                // File doesn't exist or not readable - try next candidate
                continue;
            }
        }
        throw new Error('Could not find SpecMem bootstrap.cjs');
    }
    /**
     * Handle process crash with exponential backoff restart
     */
    async handleCrash() {
        if (this.isShuttingDown || !this.instance) {
            return;
        }
        this.instance.status = 'crashed';
        this.instance.lastCrash = new Date();
        this.instance.restartCount++;
        // Check if we should restart
        if (this.instance.restartCount > this.config.maxRestarts) {
            console.error('[AutoStart] Max restarts exceeded, giving up');
            this.cleanup();
            return;
        }
        // Calculate backoff delay
        const delay = Math.min(this.config.restartBackoffMs * Math.pow(2, this.instance.restartCount - 1), this.config.maxRestartBackoffMs);
        console.error(`[AutoStart] Restarting in ${delay}ms (attempt ${this.instance.restartCount})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (!this.isShuttingDown) {
            try {
                await this.spawnSpecMem();
                this.instance.status = 'running';
                if (this.process?.pid) {
                    this.instance.pid = this.process.pid;
                    writePidFile(this.config.projectPath, this.process.pid);
                }
                writeInstanceState(this.config.projectPath, this.instance);
            }
            catch (error) {
                console.error('[AutoStart] Restart failed:', error);
                this.handleCrash();
            }
        }
    }
    /**
     * Start health check monitoring
     */
    startHealthCheck() {
        this.healthCheckInterval = setInterval(() => {
            if (this.instance && this.process) {
                const running = isProcessRunning(this.process.pid);
                if (!running && !this.isShuttingDown) {
                    console.error('[AutoStart] Health check failed - process not running');
                    this.handleCrash();
                }
            }
        }, this.config.healthCheckIntervalMs);
    }
    /**
     * Stop the SpecMem instance gracefully
     */
    async stop() {
        this.isShuttingDown = true;
        // Stop health check
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        // Send SIGTERM to process
        if (this.process && this.process.pid) {
            this.process.kill('SIGTERM');
            // Wait for graceful shutdown
            await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    // Force kill if not stopped
                    if (this.process && !this.process.killed) {
                        this.process.kill('SIGKILL');
                    }
                    resolve();
                }, this.config.shutdownTimeoutMs);
                this.process?.on('exit', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }
        // Update state
        if (this.instance) {
            this.instance.status = 'stopped';
            writeInstanceState(this.config.projectPath, this.instance);
        }
        // Cleanup
        this.cleanup();
    }
    /**
     * Clean up all resources
     */
    cleanup() {
        const { projectPath } = this.config;
        releaseSocketLock(projectPath);
        removePidFile(projectPath);
        if (this.instance?.status !== 'stopped') {
            removeInstanceState(projectPath);
        }
        this.process = null;
    }
    /**
     * Get the current instance state
     */
    getInstance() {
        return this.instance;
    }
}
// ============================================================================
// Convenience Functions
// ============================================================================
/**
 * Start SpecMem for the current project
 * Automatically detects project path from environment or cwd
 */
export async function autoStartSpecMem(projectPath) {
    const path = projectPath || process.env.SPECMEM_PROJECT_PATH || process.cwd();
    const manager = new AutoStartManager({ projectPath: path });
    return manager.start();
}
/**
 * Check if SpecMem is running for a project
 */
export async function isSpecMemRunning(projectPath) {
    const path = projectPath || process.env.SPECMEM_PROJECT_PATH || process.cwd();
    return isInstanceRunning(path);
}
/**
 * Stop SpecMem for a project
 */
export async function stopSpecMem(projectPath) {
    const resolvedPath = projectPath || process.env.SPECMEM_PROJECT_PATH || process.cwd();
    const pid = readPidFile(resolvedPath);
    if (pid !== null && isProcessRunning(pid)) {
        try {
            process.kill(pid, 'SIGTERM');
            // Wait for process to stop
            await new Promise((resolve) => {
                let attempts = 0;
                const checkInterval = setInterval(() => {
                    if (!isProcessRunning(pid) || attempts > 50) {
                        clearInterval(checkInterval);
                        if (isProcessRunning(pid)) {
                            // Force kill
                            process.kill(pid, 'SIGKILL');
                        }
                        resolve();
                    }
                    attempts++;
                }, 100);
            });
        }
        catch (e) {
            // Process may already be dead
        }
    }
    // Cleanup files
    removePidFile(resolvedPath);
    releaseSocketLock(resolvedPath);
    removeInstanceState(resolvedPath);
}
// ============================================================================
// CLI Entry Point
// ============================================================================
// Check if this module is being run directly (ESM compatible)
const isMainModule = (() => {
    try {
        // ESM check
        return import.meta.url === `file://${process.argv[1]}`;
    }
    catch {
        // CJS fallback - check require.main
        return typeof require !== 'undefined' && require.main === module;
    }
})();
if (isMainModule) {
    const command = process.argv[2];
    const projectPath = process.argv[3] || process.cwd();
    switch (command) {
        case 'start':
            autoStartSpecMem(projectPath).then((result) => {
                console.log(JSON.stringify(result, null, 2));
                process.exit(result.success ? 0 : 1);
            });
            break;
        case 'stop':
            stopSpecMem(projectPath).then(() => {
                console.log('SpecMem stopped');
                process.exit(0);
            });
            break;
        case 'status':
            getRunningInstance(projectPath).then((instance) => {
                if (instance) {
                    console.log(JSON.stringify(instance, null, 2));
                }
                else {
                    console.log('Not running');
                }
                process.exit(instance ? 0 : 1);
            });
            break;
        default:
            console.log('Usage: autoStart <start|stop|status> [projectPath]');
            process.exit(1);
    }
}
//# sourceMappingURL=index.js.map