/**
 * safeProcessTermination.ts - Safe Process Termination with Ownership Verification
 *
 * CRITICAL SAFETY MODULE: Ensures SpecMem NEVER kills processes from other projects.
 *
 * Problem:
 *   Multiple SpecMem instances can run on the same machine for different projects.
 *   Killing processes by port or name without ownership verification is dangerous
 *   and could terminate processes from OTHER projects.
 *
 * Solution:
 *   1. PID ownership files: When spawning processes, write ownership metadata
 *   2. Ownership verification: Before killing, verify the process belongs to us
 *   3. Project-scoped naming: Screen sessions, containers include project identifier
 *   4. Safe cleanup: Only clean resources we created
 *
 * @author hardwicksoftwareservices
 */
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawn } from 'child_process';
import { getProjectDirName, getProjectPath } from '../config.js';
import { logger } from './logger.js';
import { getProjectEnv } from './projectEnv.js';
// ============================================================================
// Constants
// ============================================================================
const PID_OWNERSHIP_DIR = 'pids';
/**
 * Get the PID ownership directory for the current project instance
 */
function getPidOwnershipDir() {
    const homeDir = os.homedir();
    const projectDirName = getProjectDirName();
    return path.join(homeDir, '.specmem', 'instances', projectDirName, PID_OWNERSHIP_DIR);
}
// ============================================================================
// PID Ownership Management
// ============================================================================
/**
 * Register ownership of a process.
 * Call this when spawning any process that may need to be killed later.
 *
 * @param pid - Process ID to register
 * @param processType - Type of process (e.g., 'embedding', 'team-member')
 * @param metadata - Additional metadata to store
 */
export async function registerProcessOwnership(pid, processType, metadata) {
    const pidDir = getPidOwnershipDir();
    const pidFile = path.join(pidDir, `${pid}.json`);
    // Ensure directory exists
    try {
        await fsp.mkdir(pidDir, { recursive: true, mode: 0o755 });
    }
    catch (err) {
        if (err.code !== 'EEXIST') {
            logger.error({ err, pidDir }, '[SafeKill] Failed to create PID ownership directory');
            throw err;
        }
    }
    const ownership = {
        pid,
        projectDirName: getProjectDirName(),
        projectPath: getProjectPath(),
        processType,
        metadata,
        registeredAt: new Date().toISOString(),
    };
    await fsp.writeFile(pidFile, JSON.stringify(ownership, null, 2), { mode: 0o644 });
    logger.debug({ pid, processType, projectDirName: ownership.projectDirName }, '[SafeKill] Registered process ownership');
}
/**
 * Synchronous version of registerProcessOwnership
 */
export function registerProcessOwnershipSync(pid, processType, metadata) {
    const pidDir = getPidOwnershipDir();
    const pidFile = path.join(pidDir, `${pid}.json`);
    // Ensure directory exists
    try {
        fs.mkdirSync(pidDir, { recursive: true, mode: 0o755 });
    }
    catch (err) {
        if (err.code !== 'EEXIST') {
            logger.error({ err, pidDir }, '[SafeKill] Failed to create PID ownership directory');
            throw err;
        }
    }
    const ownership = {
        pid,
        projectDirName: getProjectDirName(),
        projectPath: getProjectPath(),
        processType,
        metadata,
        registeredAt: new Date().toISOString(),
    };
    fs.writeFileSync(pidFile, JSON.stringify(ownership, null, 2), { mode: 0o644 });
    logger.debug({ pid, processType, projectDirName: ownership.projectDirName }, '[SafeKill] Registered process ownership');
}
/**
 * Unregister ownership when a process exits normally
 *
 * @param pid - Process ID to unregister
 */
export async function unregisterProcessOwnership(pid) {
    const pidDir = getPidOwnershipDir();
    const pidFile = path.join(pidDir, `${pid}.json`);
    try {
        await fsp.unlink(pidFile);
        logger.debug({ pid }, '[SafeKill] Unregistered process ownership');
    }
    catch (err) {
        if (err.code !== 'ENOENT') {
            logger.warn({ err, pid }, '[SafeKill] Failed to unregister process ownership');
        }
    }
}
/**
 * Synchronous version of unregisterProcessOwnership
 */
export function unregisterProcessOwnershipSync(pid) {
    const pidDir = getPidOwnershipDir();
    const pidFile = path.join(pidDir, `${pid}.json`);
    try {
        fs.unlinkSync(pidFile);
        logger.debug({ pid }, '[SafeKill] Unregistered process ownership');
    }
    catch (err) {
        if (err.code !== 'ENOENT') {
            logger.warn({ err, pid }, '[SafeKill] Failed to unregister process ownership');
        }
    }
}
/**
 * Get ownership info for a process
 *
 * @param pid - Process ID to check
 * @returns Ownership info or null if not found
 */
export async function getProcessOwnership(pid) {
    const pidDir = getPidOwnershipDir();
    const pidFile = path.join(pidDir, `${pid}.json`);
    try {
        const content = await fsp.readFile(pidFile, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
/**
 * Synchronous version of getProcessOwnership
 */
export function getProcessOwnershipSync(pid) {
    const pidDir = getPidOwnershipDir();
    const pidFile = path.join(pidDir, `${pid}.json`);
    try {
        const content = fs.readFileSync(pidFile, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
/**
 * Check if we own a process
 *
 * @param pid - Process ID to check
 * @returns True if we own this process
 */
export function isOwnedProcess(pid) {
    const ownership = getProcessOwnershipSync(pid);
    if (!ownership) {
        return false;
    }
    return ownership.projectDirName === getProjectDirName();
}
// ============================================================================
// Safe Process Termination
// ============================================================================
/**
 * Check if a process is running
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
 * Safely kill a process with ownership verification.
 *
 * This function will REFUSE to kill a process unless:
 * 1. We have an ownership file for it, AND
 * 2. The ownership file shows this project owns it
 *
 * @param pid - Process ID to kill
 * @param signal - Signal to send (default: SIGTERM)
 * @param options - Additional options
 * @returns Result of the kill operation
 */
export function safeKillProcess(pid, signal = 'SIGTERM', options) {
    const { force = false, processType = 'unknown', waitMs = 0, forceKillAfterTimeout = false } = options || {};
    const currentProject = getProjectDirName();
    // Check if process is even running
    if (!isProcessRunning(pid)) {
        logger.debug({ pid, processType }, '[SafeKill] Process already dead');
        unregisterProcessOwnershipSync(pid);
        return { success: true, pid, owned: false, alreadyDead: true };
    }
    // Check ownership (unless force is set)
    if (!force) {
        const ownership = getProcessOwnershipSync(pid);
        if (!ownership) {
            logger.warn({ pid, processType, currentProject }, '[SafeKill] REFUSING to kill PID - no ownership file found');
            return {
                success: false,
                pid,
                owned: false,
                error: `No ownership file for PID ${pid}. Cannot verify this process belongs to project "${currentProject}".`,
            };
        }
        if (ownership.projectDirName !== currentProject) {
            logger.warn({ pid, processType, owner: ownership.projectDirName, currentProject }, '[SafeKill] REFUSING to kill PID - owned by different project');
            return {
                success: false,
                pid,
                owned: false,
                error: `PID ${pid} is owned by project "${ownership.projectDirName}", not "${currentProject}". Refusing to kill.`,
            };
        }
        logger.info({ pid, processType, projectDirName: currentProject }, '[SafeKill] Ownership verified, proceeding with kill');
    }
    else {
        logger.warn({ pid, processType }, '[SafeKill] Force kill requested - bypassing ownership check');
    }
    // Kill the process
    try {
        process.kill(pid, signal);
        logger.info({ pid, signal, processType }, '[SafeKill] Sent signal to process');
        // Wait for process to exit if requested
        if (waitMs > 0) {
            const startTime = Date.now();
            while (isProcessRunning(pid) && (Date.now() - startTime) < waitMs) {
                // Busy wait with small intervals
                const waitStart = Date.now();
                while (Date.now() - waitStart < 100) { /* spin */ }
            }
            // Force kill if still running and requested
            if (isProcessRunning(pid) && forceKillAfterTimeout) {
                logger.warn({ pid, processType }, '[SafeKill] Process still running after timeout, sending SIGKILL');
                try {
                    process.kill(pid, 'SIGKILL');
                }
                catch {
                    // Ignore - process may have exited
                }
            }
        }
        // Clean up ownership file
        unregisterProcessOwnershipSync(pid);
        return { success: true, pid, owned: true };
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error({ pid, processType, error }, '[SafeKill] Failed to kill process');
        return { success: false, pid, owned: true, error };
    }
}
/**
 * Safely kill a process by port with ownership verification.
 *
 * First finds the PID using the port, then verifies ownership before killing.
 *
 * @param port - Port number to kill process on
 * @param signal - Signal to send
 * @returns Result of the kill operation
 */
export function safeKillByPort(port, signal = 'SIGTERM') {
    // Find PID using the port
    let pid;
    try {
        const result = execSync(`lsof -ti:${port} 2>/dev/null || echo ""`, { encoding: 'utf-8' }).trim();
        if (!result) {
            return {
                success: true,
                pid: 0,
                owned: false,
                alreadyDead: true,
                error: `No process found on port ${port}`,
            };
        }
        pid = parseInt(result.split('\n')[0], 10);
        if (isNaN(pid)) {
            return {
                success: false,
                pid: 0,
                owned: false,
                error: `Could not parse PID from lsof output: ${result}`,
            };
        }
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return { success: false, pid: 0, owned: false, error: `Failed to find process on port ${port}: ${error}` };
    }
    logger.info({ port, pid }, '[SafeKill] Found process on port, verifying ownership');
    return safeKillProcess(pid, signal, { processType: `port-${port}` });
}
// ============================================================================
// Safe Screen Session Management
// ============================================================================
/**
 * Get a project-scoped screen session name.
 * This ensures screen sessions are unique per project.
 *
 * @param baseName - Base name for the session (e.g., 'team-member-123')
 * @returns Full session name with project prefix
 */
export function getProjectScopedScreenName(baseName) {
    const projectDirName = getProjectDirName();
    return `specmem-${projectDirName}-${baseName}`;
}
/**
 * Check if a screen session belongs to this project
 *
 * @param sessionName - Full screen session name
 * @returns True if the session belongs to this project
 */
export function isOwnedScreenSession(sessionName) {
    const projectDirName = getProjectDirName();
    const expectedPrefix = `specmem-${projectDirName}-`;
    return sessionName.startsWith(expectedPrefix);
}
/**
 * Safely kill a screen session with ownership verification.
 *
 * @param sessionName - Screen session name (will be checked for project ownership)
 * @param options - Additional options
 * @returns Success status
 */
export function safeKillScreenSession(sessionName, options) {
    const { force = false } = options || {};
    const projectDirName = getProjectDirName();
    // Check ownership (unless force)
    if (!force) {
        // For legacy sessions without project prefix, check if session matches pattern
        const isProjectScoped = sessionName.startsWith(`specmem-${projectDirName}-`);
        const isLegacyTeamMember = sessionName.startsWith('team-member-');
        if (!isProjectScoped && !isLegacyTeamMember) {
            logger.warn({ sessionName, projectDirName }, '[SafeKill] REFUSING to kill screen session - not owned by this project');
            return {
                success: false,
                owned: false,
                error: `Screen session "${sessionName}" does not belong to project "${projectDirName}"`,
            };
        }
        // For legacy team-member sessions, we allow killing them from any project
        // that has the team-member-* pattern (backwards compatibility)
        if (isLegacyTeamMember) {
            logger.info({ sessionName, projectDirName }, '[SafeKill] Killing legacy team-member screen session (backwards compatible)');
        }
    }
    try {
        execSync(`screen -S "${sessionName}" -X quit 2>/dev/null || true`, { encoding: 'utf-8' });
        logger.info({ sessionName }, '[SafeKill] Killed screen session');
        return { success: true, owned: true };
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error({ sessionName, error }, '[SafeKill] Failed to kill screen session');
        return { success: false, owned: true, error };
    }
}
/**
 * List all screen sessions belonging to this project
 *
 * @returns Array of owned session names
 */
export function listOwnedScreenSessions() {
    const projectDirName = getProjectDirName();
    const projectPrefix = `specmem-${projectDirName}-`;
    const legacyPrefix = 'team-member-';
    try {
        const output = execSync('screen -ls 2>/dev/null || echo ""', { encoding: 'utf-8' });
        const sessions = [];
        for (const line of output.split('\n')) {
            // Match session names like "12345.specmem-myproject-team-member-xxx"
            const match = line.match(/\d+\.([^\s]+)/);
            if (match) {
                const sessionName = match[1];
                if (sessionName.startsWith(projectPrefix) || sessionName.startsWith(legacyPrefix)) {
                    sessions.push(sessionName);
                }
            }
        }
        return sessions;
    }
    catch {
        return [];
    }
}
// ============================================================================
// Safe Docker Container Management
// ============================================================================
/**
 * Get a project-scoped Docker container name.
 *
 * @param baseName - Base name for the container (e.g., 'embedding', 'postgres')
 * @returns Full container name with project prefix
 */
export function getProjectScopedContainerName(baseName) {
    const projectDirName = getProjectDirName();
    return `specmem-${projectDirName}-${baseName}`;
}
/**
 * Check if a Docker container name belongs to this project
 *
 * @param containerName - Container name to check
 * @returns True if container belongs to this project
 */
export function isOwnedContainer(containerName) {
    const projectDirName = getProjectDirName();
    return containerName.startsWith(`specmem-${projectDirName}-`);
}
// ============================================================================
// Spawn with Ownership Tracking
// ============================================================================
/**
 * Spawn a child process with automatic ownership registration.
 *
 * @param command - Command to run
 * @param args - Arguments
 * @param processType - Type of process for ownership tracking
 * @param options - Spawn options
 * @returns ChildProcess with ownership registered
 */
export function spawnWithOwnership(command, args, processType, options) {
    const { cwd, env, detached = false, metadata } = options || {};
    // bruh ALWAYS use getProjectEnv for project isolation - spawned processes need the context
    const child = spawn(command, args, {
        cwd,
        env: env || getProjectEnv(),
        detached,
        stdio: detached ? 'ignore' : 'pipe',
    });
    if (child.pid) {
        // Register ownership
        registerProcessOwnershipSync(child.pid, processType, metadata);
        // Auto-unregister on exit
        child.on('exit', () => {
            if (child.pid) {
                unregisterProcessOwnershipSync(child.pid);
            }
        });
    }
    return child;
}
// ============================================================================
// Cleanup Utilities
// ============================================================================
/**
 * Clean up stale ownership files for processes that no longer exist.
 */
export async function cleanupStaleOwnershipFiles() {
    const pidDir = getPidOwnershipDir();
    let cleaned = 0;
    const errors = [];
    try {
        const files = await fsp.readdir(pidDir);
        for (const file of files) {
            if (!file.endsWith('.json'))
                continue;
            const pid = parseInt(file.replace('.json', ''), 10);
            if (isNaN(pid))
                continue;
            if (!isProcessRunning(pid)) {
                try {
                    await fsp.unlink(path.join(pidDir, file));
                    cleaned++;
                    logger.debug({ pid }, '[SafeKill] Cleaned stale ownership file');
                }
                catch (err) {
                    errors.push(`Failed to clean ${file}: ${err}`);
                }
            }
        }
    }
    catch (err) {
        if (err.code !== 'ENOENT') {
            errors.push(`Failed to read PID directory: ${err}`);
        }
    }
    return { cleaned, errors };
}
/**
 * Get all processes owned by this project
 */
export async function getOwnedProcesses() {
    const pidDir = getPidOwnershipDir();
    const owned = [];
    try {
        const files = await fsp.readdir(pidDir);
        for (const file of files) {
            if (!file.endsWith('.json'))
                continue;
            try {
                const content = await fsp.readFile(path.join(pidDir, file), 'utf-8');
                const ownership = JSON.parse(content);
                // Verify it's still our project and still running
                if (ownership.projectDirName === getProjectDirName() && isProcessRunning(ownership.pid)) {
                    owned.push(ownership);
                }
            }
            catch {
                // Skip invalid files
            }
        }
    }
    catch {
        // Directory may not exist yet
    }
    return owned;
}
/**
 * Kill all processes owned by this project.
 * Use during shutdown to clean up all spawned processes.
 */
export async function killAllOwnedProcesses(signal = 'SIGTERM') {
    const owned = await getOwnedProcesses();
    const killed = [];
    const failed = [];
    for (const ownership of owned) {
        const result = safeKillProcess(ownership.pid, signal, {
            processType: ownership.processType,
            waitMs: 2000,
            forceKillAfterTimeout: true,
        });
        if (result.success) {
            killed.push(ownership.pid);
        }
        else {
            failed.push(ownership.pid);
        }
    }
    return { killed, failed };
}
//# sourceMappingURL=safeProcessTermination.js.map