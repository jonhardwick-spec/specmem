/**
 * SpecMem Auto-Start Mechanism
 *
 * Implements project-local SpecMem instances that:
 * 1. Automatically start when  Code starts
 * 2. Are isolated per project (using project path hash)
 * 3. Detect existing instances to prevent duplicates
 * 4. Handle graceful shutdown on  Code exit
 * 5. Auto-restart on crash with backoff
 *
 * Integration Points:
 * -  Code spawns SpecMem via MCP server config
 * - Working directory passed via SPECMEM_PROJECT_PATH env var
 * - PID file stored in project's .specmem/ directory
 * - Socket/lock files for process detection
 */
export interface SpecMemInstance {
    pid: number;
    projectPath: string;
    projectHash: string;
    startTime: Date;
    port: number;
    socketPath: string;
    status: 'starting' | 'running' | 'stopping' | 'stopped' | 'crashed';
    restartCount: number;
    lastCrash?: Date;
}
export interface AutoStartConfig {
    projectPath: string;
    maxRestarts?: number;
    restartBackoffMs?: number;
    maxRestartBackoffMs?: number;
    healthCheckIntervalMs?: number;
    shutdownTimeoutMs?: number;
    createProjectDir?: boolean;
    lockStrategy?: 'pid' | 'socket' | 'both';
}
export interface AutoStartResult {
    success: boolean;
    instance?: SpecMemInstance;
    alreadyRunning?: boolean;
    error?: string;
}
/**
 * Generate a unique hash for a project path
 * Used to create project-specific instance identifiers
 */
export declare function hashProjectPath(projectPath: string): string;
/**
 * Get the SpecMem directory for a project
 * Returns the path (does not create - use ensureSpecMemDir for that)
 */
export declare function getSpecMemDir(projectPath: string, _create?: boolean): string;
/**
 * Ensure the SpecMem directory exists (async version)
 * Creates it if it doesn't exist and optionally updates .gitignore
 */
export declare function ensureSpecMemDir(projectPath: string): Promise<string>;
/**
 * Sync version of ensureSpecMemDir for contexts where async isn't possible
 */
export declare function ensureSpecMemDirSync(projectPath: string): string;
/**
 * Get the path to a specific file in the SpecMem directory
 */
export declare function getSpecMemFilePath(projectPath: string, filename: string): string;
/**
 * Check if a process with the given PID is running
 */
export declare function isProcessRunning(pid: number): boolean;
/**
 * Check if a process is a SpecMem instance
 * Verifies by checking cmdline on Linux/Mac
 */
export declare function isSpecMemProcess(pid: number): boolean;
/**
 * Read the PID from the PID file
 */
export declare function readPidFile(projectPath: string): number | null;
/**
 * Read the PID from the PID file (async version)
 */
export declare function readPidFileAsync(projectPath: string): Promise<number | null>;
/**
 * Write the PID to the PID file
 */
export declare function writePidFile(projectPath: string, pid: number): void;
/**
 * Write the PID to the PID file (async version)
 */
export declare function writePidFileAsync(projectPath: string, pid: number): Promise<void>;
/**
 * Remove the PID file
 */
export declare function removePidFile(projectPath: string): void;
/**
 * Remove the PID file (async version)
 */
export declare function removePidFileAsync(projectPath: string): Promise<void>;
/**
 * Read the instance state from the state file
 */
export declare function readInstanceState(projectPath: string): SpecMemInstance | null;
/**
 * Read the instance state from the state file (async version)
 */
export declare function readInstanceStateAsync(projectPath: string): Promise<SpecMemInstance | null>;
/**
 * Write the instance state to the state file
 */
export declare function writeInstanceState(projectPath: string, instance: SpecMemInstance): void;
/**
 * Write the instance state to the state file (async version)
 */
export declare function writeInstanceStateAsync(projectPath: string, instance: SpecMemInstance): Promise<void>;
/**
 * Remove the instance state file
 */
export declare function removeInstanceState(projectPath: string): void;
/**
 * Remove the instance state file (async version)
 */
export declare function removeInstanceStateAsync(projectPath: string): Promise<void>;
/**
 * Try to acquire a socket-based lock for this project
 * Returns true if lock acquired, false if another instance is running
 */
export declare function tryAcquireSocketLock(projectPath: string): boolean;
/**
 * Try to acquire a socket-based lock for this project (async version)
 * Returns true if lock acquired, false if another instance is running
 */
export declare function tryAcquireSocketLockAsync(projectPath: string): Promise<boolean>;
/**
 * Release the socket lock
 */
export declare function releaseSocketLock(projectPath: string): void;
/**
 * Release the socket lock (async version)
 */
export declare function releaseSocketLockAsync(projectPath: string): Promise<void>;
/**
 * Check if a SpecMem instance is running for this project via socket
 * Uses connection attempt instead of file existence check to avoid race conditions
 */
export declare function checkSocketLock(projectPath: string): Promise<boolean>;
/**
 * Check if a SpecMem instance is already running for this project
 * Uses both PID file and socket check for reliability
 */
export declare function isInstanceRunning(projectPath: string, strategy?: 'pid' | 'socket' | 'both'): Promise<boolean>;
/**
 * Get information about a running instance
 */
export declare function getRunningInstance(projectPath: string): Promise<SpecMemInstance | null>;
/**
 * Main class for managing auto-starting SpecMem instances
 */
export declare class AutoStartManager {
    private config;
    private process;
    private instance;
    private healthCheckInterval;
    private isShuttingDown;
    constructor(config: AutoStartConfig);
    /**
     * Start a SpecMem instance for the configured project
     * Returns existing instance if already running
     */
    start(): Promise<AutoStartResult>;
    /**
     * Spawn the actual SpecMem process
     */
    private spawnSpecMem;
    /**
     * Find the SpecMem bootstrap script path
     * Uses fs.accessSync to check file accessibility rather than existsSync
     */
    private findSpecMemPath;
    /**
     * Handle process crash with exponential backoff restart
     */
    private handleCrash;
    /**
     * Start health check monitoring
     */
    private startHealthCheck;
    /**
     * Stop the SpecMem instance gracefully
     */
    stop(): Promise<void>;
    /**
     * Clean up all resources
     */
    private cleanup;
    /**
     * Get the current instance state
     */
    getInstance(): SpecMemInstance | null;
}
/**
 * Start SpecMem for the current project
 * Automatically detects project path from environment or cwd
 */
export declare function autoStartSpecMem(projectPath?: string): Promise<AutoStartResult>;
/**
 * Check if SpecMem is running for a project
 */
export declare function isSpecMemRunning(projectPath?: string): Promise<boolean>;
/**
 * Stop SpecMem for a project
 */
export declare function stopSpecMem(projectPath?: string): Promise<void>;
//# sourceMappingURL=index.d.ts.map