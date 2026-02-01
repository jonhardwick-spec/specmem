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
import { ChildProcess } from 'child_process';
export interface ProcessOwnership {
    /** PID of the process */
    pid: number;
    /** Project dir name that owns this process */
    projectDirName: string;
    /** Project path that owns this process */
    projectPath: string;
    /** Type of process (e.g., 'embedding', 'postgres', 'team-member', 'screen') */
    processType: string;
    /** Additional metadata about the process */
    metadata?: Record<string, unknown>;
    /** When the process was registered */
    registeredAt: string;
}
export interface SafeKillResult {
    /** Whether the kill was successful */
    success: boolean;
    /** PID that was targeted */
    pid: number;
    /** Whether we owned this process */
    owned: boolean;
    /** Error message if failed */
    error?: string;
    /** Whether process was already dead */
    alreadyDead?: boolean;
}
/**
 * Register ownership of a process.
 * Call this when spawning any process that may need to be killed later.
 *
 * @param pid - Process ID to register
 * @param processType - Type of process (e.g., 'embedding', 'team-member')
 * @param metadata - Additional metadata to store
 */
export declare function registerProcessOwnership(pid: number, processType: string, metadata?: Record<string, unknown>): Promise<void>;
/**
 * Synchronous version of registerProcessOwnership
 */
export declare function registerProcessOwnershipSync(pid: number, processType: string, metadata?: Record<string, unknown>): void;
/**
 * Unregister ownership when a process exits normally
 *
 * @param pid - Process ID to unregister
 */
export declare function unregisterProcessOwnership(pid: number): Promise<void>;
/**
 * Synchronous version of unregisterProcessOwnership
 */
export declare function unregisterProcessOwnershipSync(pid: number): void;
/**
 * Get ownership info for a process
 *
 * @param pid - Process ID to check
 * @returns Ownership info or null if not found
 */
export declare function getProcessOwnership(pid: number): Promise<ProcessOwnership | null>;
/**
 * Synchronous version of getProcessOwnership
 */
export declare function getProcessOwnershipSync(pid: number): ProcessOwnership | null;
/**
 * Check if we own a process
 *
 * @param pid - Process ID to check
 * @returns True if we own this process
 */
export declare function isOwnedProcess(pid: number): boolean;
/**
 * Check if a process is running
 */
export declare function isProcessRunning(pid: number): boolean;
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
export declare function safeKillProcess(pid: number, signal?: NodeJS.Signals, options?: {
    /** Force kill without ownership check (DANGEROUS - use sparingly) */
    force?: boolean;
    /** Process type for logging */
    processType?: string;
    /** Wait for process to exit */
    waitMs?: number;
    /** Force SIGKILL after timeout */
    forceKillAfterTimeout?: boolean;
}): SafeKillResult;
/**
 * Safely kill a process by port with ownership verification.
 *
 * First finds the PID using the port, then verifies ownership before killing.
 *
 * @param port - Port number to kill process on
 * @param signal - Signal to send
 * @returns Result of the kill operation
 */
export declare function safeKillByPort(port: number, signal?: NodeJS.Signals): SafeKillResult;
/**
 * Get a project-scoped screen session name.
 * This ensures screen sessions are unique per project.
 *
 * @param baseName - Base name for the session (e.g., 'team-member-123')
 * @returns Full session name with project prefix
 */
export declare function getProjectScopedScreenName(baseName: string): string;
/**
 * Check if a screen session belongs to this project
 *
 * @param sessionName - Full screen session name
 * @returns True if the session belongs to this project
 */
export declare function isOwnedScreenSession(sessionName: string): boolean;
/**
 * Safely kill a screen session with ownership verification.
 *
 * @param sessionName - Screen session name (will be checked for project ownership)
 * @param options - Additional options
 * @returns Success status
 */
export declare function safeKillScreenSession(sessionName: string, options?: {
    force?: boolean;
}): {
    success: boolean;
    error?: string;
    owned: boolean;
};
/**
 * List all screen sessions belonging to this project
 *
 * @returns Array of owned session names
 */
export declare function listOwnedScreenSessions(): string[];
/**
 * Get a project-scoped Docker container name.
 *
 * @param baseName - Base name for the container (e.g., 'embedding', 'postgres')
 * @returns Full container name with project prefix
 */
export declare function getProjectScopedContainerName(baseName: string): string;
/**
 * Check if a Docker container name belongs to this project
 *
 * @param containerName - Container name to check
 * @returns True if container belongs to this project
 */
export declare function isOwnedContainer(containerName: string): boolean;
/**
 * Spawn a child process with automatic ownership registration.
 *
 * @param command - Command to run
 * @param args - Arguments
 * @param processType - Type of process for ownership tracking
 * @param options - Spawn options
 * @returns ChildProcess with ownership registered
 */
export declare function spawnWithOwnership(command: string, args: string[], processType: string, options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    detached?: boolean;
    metadata?: Record<string, unknown>;
}): ChildProcess;
/**
 * Clean up stale ownership files for processes that no longer exist.
 */
export declare function cleanupStaleOwnershipFiles(): Promise<{
    cleaned: number;
    errors: string[];
}>;
/**
 * Get all processes owned by this project
 */
export declare function getOwnedProcesses(): Promise<ProcessOwnership[]>;
/**
 * Kill all processes owned by this project.
 * Use during shutdown to clean up all spawned processes.
 */
export declare function killAllOwnedProcesses(signal?: NodeJS.Signals): Promise<{
    killed: number[];
    failed: number[];
}>;
//# sourceMappingURL=safeProcessTermination.d.ts.map