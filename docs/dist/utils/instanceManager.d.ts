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
/**
 * Docker container tracking for per-instance isolation
 */
export interface DockerContainers {
    /** Embedding service container ID or name */
    embedding?: string;
    /** PostgreSQL container ID or name */
    postgres?: string;
}
/**
 * Port allocation for instance services
 */
export interface InstancePorts {
    /** PostgreSQL port */
    postgres?: number;
    /** Embedding service port */
    embedding?: number;
    /** Dashboard web server port */
    dashboard?: number;
    /** Coordination/WebSocket port */
    coordination?: number;
}
export interface InstanceInfo {
    /** Process ID of the running instance */
    pid: number;
    /** Project path this instance is managing */
    projectPath: string;
    /** Hash of the project path (used for directory naming) */
    projectHash: string;
    /** When the instance started */
    startTime: string;
    /** Dashboard port if available */
    dashboardPort?: number;
    /** Coordination port if available */
    coordinationPort?: number;
    /** PostgreSQL port if available */
    postgresPort?: number;
    /** Embedding service port if available */
    embeddingPort?: number;
    /** Instance status */
    status: 'running' | 'stopped' | 'crashed' | 'unknown';
    /** Last heartbeat timestamp */
    lastHeartbeat?: string;
    /** Version of SpecMem */
    version?: string;
    /** Docker containers associated with this instance */
    dockerContainers?: DockerContainers;
    /** Port allocations for this instance */
    ports?: InstancePorts;
}
export interface InstanceRegistry {
    /** Version of the registry format */
    version: 2;
    /** Map of project hash to instance info */
    instances: Record<string, InstanceInfo>;
    /** Last updated timestamp */
    lastUpdated: string;
}
export interface InstanceManagerConfig {
    /** Base directory for all SpecMem data (default: ~/.specmem) */
    baseDir?: string;
    /** Project path for this instance */
    projectPath: string;
    /** Whether to auto-cleanup stale instances on init */
    autoCleanup?: boolean;
    /** Lock strategy: pid, socket, or both */
    lockStrategy?: 'pid' | 'socket' | 'both';
    /** Health check interval in ms */
    healthCheckIntervalMs?: number;
}
/**
 * Get the hashed project directory name for instance management (COLLISION-FREE!)
 * Uses SHA256 hash of FULL project path to ensure different paths get different instances.
 * This prevents collisions between /specmem and ~/specmem.
 * Format: First 16 chars of hash (e.g., "a1b2c3d4e5f6a7b8")
 */
export declare function getProjectDirName(projectPath?: string): string;
/**
 * Generate a deterministic hash from project path (DEPRECATED)
 * Uses first 16 characters of SHA256 for reasonable uniqueness while keeping paths short
 * @deprecated Use getProjectDirName() for new code - it's human readable!
 */
export declare function hashProjectPath(projectPath: string): string;
/**
 * Get the full hash of a project path (for registry lookups)
 * @deprecated Use getProjectDirName() for new code - it's human readable!
 */
export declare function getFullProjectHash(projectPath: string): string;
/**
 * Check if a process with the given PID is running
 */
export declare function isProcessRunning(pid: number): boolean;
/**
 * Check if a process is a SpecMem/Node process
 */
export declare function isSpecMemProcess(pid: number): boolean;
/**
 * InstanceManager - Manages per-project SpecMem instances
 *
 * Key features:
 * - Project-scoped directories: ~/.specmem/{project_hash}/
 * - Global registry: ~/.specmem/instance-registry.json
 * - Socket-based locking for reliable instance detection
 * - Automatic stale instance cleanup
 */
export declare class InstanceManager {
    private config;
    private projectDirName;
    private projectHash;
    private instanceDir;
    private lockSocket;
    private heartbeatInterval;
    private initialized;
    constructor(config: InstanceManagerConfig);
    /**
     * Get the instance directory for this project
     */
    getInstanceDir(): string;
    /**
     * Get the path to a file in the instance directory
     */
    getFilePath(filename: string): string;
    /**
     * Ensure the instance directory exists
     */
    ensureInstanceDir(): Promise<void>;
    /**
     * Ensure the instance directory exists (sync version)
     */
    ensureInstanceDirSync(): void;
    /**
     * Read the PID from the PID file
     */
    readPid(): number | null;
    /**
     * Write PID to the PID file
     */
    writePid(pid: number): void;
    /**
     * Remove the PID file
     */
    removePid(): void;
    /**
     * Get the age of the PID file in milliseconds
     */
    getPidFileAge(): number | null;
    /**
     * Try to acquire a socket-based lock
     * Returns true if lock acquired, false if another instance is running
     */
    tryAcquireSocketLock(): boolean;
    /**
     * Release the socket lock
     */
    releaseSocketLock(): void;
    /**
     * Check if a socket lock is held by another process
     */
    checkSocketLock(): Promise<boolean>;
    /**
     * Get current instance info
     */
    getInstanceInfo(): InstanceInfo;
    /**
     * Write instance state to file
     */
    writeInstanceState(info?: Partial<InstanceInfo>): void;
    /**
     * Read instance state from file
     */
    readInstanceState(): InstanceInfo | null;
    /**
     * Remove instance state file
     */
    removeInstanceState(): void;
    /**
     * Get path to the global registry file
     */
    private getRegistryPath;
    /**
     * Load the global instance registry
     */
    loadRegistry(): InstanceRegistry;
    /**
     * Save the global instance registry
     */
    saveRegistry(registry: InstanceRegistry): void;
    /**
     * Register this instance in the global registry
     */
    registerInstance(ports?: {
        dashboard?: number;
        coordination?: number;
        postgres?: number;
    }): void;
    /**
     * Unregister this instance from the global registry
     */
    unregisterInstance(): void;
    /**
     * Update heartbeat in the registry
     */
    updateHeartbeat(): void;
    /**
     * Get all registered instances
     */
    getAllInstances(): InstanceInfo[];
    /**
     * Check if an instance is already running for this project
     */
    isInstanceRunning(): Promise<boolean>;
    /**
     * Clean up stale instances from the registry
     * Registry is now keyed by readable project dir name (e.g., "myproject")
     */
    cleanupStaleInstances(): Promise<{
        cleaned: string[];
        running: string[];
    }>;
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
    cleanupStaleLocks(): void;
    /**
     * Initialize the instance manager
     * Acquires locks, writes PID, registers in global registry
     */
    initialize(): Promise<{
        success: boolean;
        alreadyRunning?: boolean;
        error?: string;
    }>;
    /**
     * Start heartbeat updates
     */
    private startHeartbeat;
    /**
     * Stop heartbeat updates
     */
    private stopHeartbeat;
    /**
     * Shutdown the instance manager
     * Releases locks, removes PID, unregisters from registry
     */
    shutdown(): void;
    /**
     * Check if initialized
     */
    isInitialized(): boolean;
}
/**
 * Result from cleaning up same-project instances
 */
export interface CleanupSameProjectResult {
    /** PIDs that were successfully killed */
    killed: number[];
    /** PIDs that were skipped (e.g., our own process) */
    skipped: number[];
    /** Errors encountered during cleanup */
    errors: string[];
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
export declare function cleanupSameProjectInstances(projectPath: string, options?: {
    baseDir?: string;
    forceDocker?: boolean;
    removeVolumes?: boolean;
}): CleanupSameProjectResult;
/**
 * Ensure only a single SpecMem instance runs for a project.
 * This is the "safe" entry point for startup that:
 * 1. Cleans up any existing same-project instances
 * 2. Initializes the new instance
 *
 * @param config - Instance manager configuration
 * @returns Result from initialization (success or failure)
 */
export declare function ensureSingleInstance(config: InstanceManagerConfig): Promise<{
    success: boolean;
    alreadyRunning?: boolean;
    error?: string;
    cleanupResult?: CleanupSameProjectResult;
}>;
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
export declare function killInstance(projectPathOrNameOrHash: string, options?: {
    baseDir?: string;
    signal?: NodeJS.Signals;
    force?: boolean;
    cleanupDocker?: boolean;
    removeVolumes?: boolean;
}): Promise<{
    success: boolean;
    pid?: number;
    error?: string;
    dockerCleanup?: {
        embedding?: {
            stopped: boolean;
            containerId?: string;
        };
        postgres?: {
            stopped: boolean;
            containerId?: string;
        };
    };
}>;
/**
 * Kill all running SpecMem instances
 */
export declare function killAllInstances(options?: {
    baseDir?: string;
    signal?: NodeJS.Signals;
    force?: boolean;
    excludeSelf?: boolean;
}): Promise<{
    killed: number[];
    failed: number[];
    errors: string[];
}>;
/**
 * List all running instances with Docker container status
 */
export declare function listInstances(options?: {
    baseDir?: string;
    includeDockerStatus?: boolean;
}): InstanceInfo[];
/**
 * Extended instance listing with full Docker and port details
 */
export interface InstanceListEntry extends InstanceInfo {
    /** Whether the main process is alive */
    processAlive: boolean;
    /** Docker container statuses */
    docker: {
        embedding: {
            id?: string;
            running: boolean;
        };
        postgres: {
            id?: string;
            running: boolean;
        };
    };
    /** Calculated/allocated ports */
    allocatedPorts: {
        dashboard: number;
        coordination: number;
        postgres: number;
        embedding: number;
    };
}
/**
 * List all instances with comprehensive Docker and port information
 */
export declare function listInstancesDetailed(options?: {
    baseDir?: string;
}): InstanceListEntry[];
/**
 * Get or create the global instance manager
 */
export declare function getInstanceManager(config?: InstanceManagerConfig): InstanceManager;
/**
 * Reset the global instance manager (for testing)
 */
export declare function resetInstanceManager(): void;
/**
 * Check if instance manager is available
 */
export declare function hasInstanceManager(): boolean;
/**
 * Migrate from old .specmem/ directory to new per-project structure
 * This handles the transition from single .specmem/ to ~/.specmem/instances/{dirname}/
 * Now uses readable project dir names instead of hashes!
 */
export declare function migrateFromOldStructure(projectPath: string): Promise<void>;
/**
 * Register a Docker container for this project instance
 * Now uses readable project dir name for instance directories!
 *
 * @param projectPath - Project path (uses SPECMEM_PROJECT_PATH env if not provided)
 * @param containerType - Type of container: 'embedding' or 'postgres'
 * @param containerId - Docker container ID or name
 */
export declare function registerDockerContainer(projectPath: string, containerType: 'embedding' | 'postgres', containerId: string): Promise<void>;
/**
 * Get Docker containers for a project instance
 * Now uses readable project dir name for instance directories!
 *
 * @param projectPath - Project path
 * @returns Object with embedding and postgres container IDs
 */
export declare function getDockerContainers(projectPath: string): Promise<DockerContainers>;
/**
 * Check if a Docker container is running
 *
 * @param containerId - Container ID or name
 * @returns True if container is running
 */
export declare function isDockerContainerRunning(containerId: string): boolean;
/**
 * Stop and remove a Docker container
 *
 * @param containerId - Container ID or name
 * @param options - Optional: force remove, remove volumes
 * @returns True if successfully stopped
 */
export declare function stopDockerContainer(containerId: string, options?: {
    force?: boolean;
    removeVolumes?: boolean;
}): Promise<boolean>;
/**
 * Clean up all Docker containers for a project instance
 *
 * @param projectPath - Project path
 * @param options - Optional: force stop, remove volumes
 * @returns Object with results for each container type
 */
export declare function cleanupDockerContainers(projectPath: string, options?: {
    force?: boolean;
    removeVolumes?: boolean;
}): Promise<{
    embedding?: {
        stopped: boolean;
        containerId?: string;
    };
    postgres?: {
        stopped: boolean;
        containerId?: string;
    };
}>;
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
export declare function calculateInstancePorts(projectPath: string): {
    postgres: number;
    embedding: number;
    dashboard: number;
    coordination: number;
};
/**
 * Get instance ports, either from cache/registry or calculate new ones.
 * This is the main entry point for getting port allocations.
 * Now uses readable project dir name for registry lookups!
 *
 * @param projectPath - Project path (defaults to SPECMEM_PROJECT_PATH or cwd)
 * @returns Port allocations for all services
 */
export declare function getInstancePortsFromManager(projectPath?: string): {
    postgres: number;
    embedding: number;
    dashboard: number;
    coordination: number;
};
/**
 * Register port allocations for an instance
 * Now uses readable project dir name for registry lookups!
 *
 * @param projectPath - Project path
 * @param ports - Port allocations to register
 */
export declare function registerInstancePorts(projectPath: string, ports: InstancePorts): void;
//# sourceMappingURL=instanceManager.d.ts.map