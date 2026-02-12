import { ServerConfig } from './types/index.js';
interface SpecmemRcConfig {
    database?: {
        host?: string;
        port?: number;
        database?: string;
        user?: string;
        password?: string;
    };
    embedding?: {
        model?: string;
        batchSize?: number;
        cpuLimit?: number;
    };
    watcher?: {
        enabled?: boolean;
        debounceMs?: number;
        maxFileSizeBytes?: number;
        excludePatterns?: string[];
    };
    sessionWatcher?: {
        enabled?: boolean;
        debounceMs?: number;
        importance?: string;
        additionalTags?: string[];
    };
    compression?: {
        enabled?: boolean;
        minLength?: number;
        threshold?: number;
    };
    dashboard?: {
        enabled?: boolean;
        port?: number;
        mode?: 'private' | 'public';
    };
    codebase?: {
        enabled?: boolean;
        excludePatterns?: string[];
    };
    skills?: {
        enabled?: boolean;
        skillsPath?: string;
    };
    logging?: {
        level?: string;
        prettyPrint?: boolean;
    };
}
/**
 * Clear rc config cache - useful for testing or when rc file changes
 */
export declare function clearRcConfigCache(projectPath?: string): void;
/**
 * Get the current rc config for the project (useful for debugging)
 */
export declare function getSpecmemRcConfig(): SpecmemRcConfig | null;
/**
 * Get the SpecMem root directory
 * This is the main entry point for all path resolution
 * Works whether running from src/, dist/, or installed via npm
 */
export declare function getSpecmemRoot(): string;
/**
 * MULTI-PROJECT ISOLATION FIX
 *
 * REMOVED: Marker file /tmp/specmem-current-project.txt
 *
 * The marker file caused race conditions when multiple projects ran simultaneously -
 * whichever hook wrote last would "win", causing other projects to read wrong data.
 *
 * NOW: Each MCP server uses ONLY its SPECMEM_PROJECT_PATH env var (set at startup).
 */
/**
 * Get the project path that SpecMem is monitoring
 *
 * PROJECT ISOLATION (priority order):
 * 1. SPECMEM_PROJECT_PATH environment variable (set at MCP server start by bootstrap.cjs)
 * 2. process.cwd() as last fallback
 *
 * Each MCP server instance has its own SPECMEM_PROJECT_PATH set at startup,
 * enabling TRUE multi-project simultaneous isolation.
 */
export declare function getProjectPath(): string;
/**
 * Get the project hash for instance isolation (COLLISION-FREE!)
 * Uses SHA256 hash of FULL project path to ensure different paths get different instances.
 * This prevents collisions between /specmem and ~/specmem.
 * Format: First 16 chars of hash (e.g., "a1b2c3d4e5f6a7b8")
 */
export declare function getProjectDirName(): string;
/**
 * DEPRECATED: Returns project hash
 * Kept for backwards compatibility - now returns the hash
 */
export declare function getProjectHash(): string;
/**
 * DEPRECATED: Returns project hash
 * Kept for backwards compatibility - now returns the hash
 */
export declare function getProjectHashFull(): string;
/**
 * Get the per-instance directory for this project
 * ALWAYS uses PROJECT DIRECTORY for complete isolation
 * e.g. /home/user/myproject/specmem/ - NOT ~/.specmem/
 * User requirement: "EVERYTHING LOCALIZED WITHIN THE PROJECT"
 */
export declare function getInstanceDir(): string;
/**
 * Get project info as a structured object (for logging/debugging)
 */
export declare function getProjectInfo(): {
    path: string;
    hash: string;
    hashFull: string;
    instanceDir: string;
};
/**
 * Get path to specmem's internal run directory (sockets, PIDs, etc)
 */
export declare function getRunDir(): string;
/**
 * Get the project-scoped socket directory
 * Pattern: {PROJECT_DIR}/specmem/sockets/ - FULLY LOCALIZED
 */
export declare function getProjectSocketDir(): string;
/**
 * Get the embedding socket path - PROJECT ISOLATION ENFORCED
 *
 * Socket path resolution (strict project isolation):
 * 1. SPECMEM_EMBEDDING_SOCKET env var (explicit override - HIGHEST PRIORITY)
 * 2. Project directory socket: {PROJECT}/specmem/sockets/embeddings.sock
 *
 * IMPORTANT: No fallbacks to shared paths! Each project MUST have its own socket.
 * This prevents embedding pollution between projects.
 *
 * @returns The path to the embedding socket (existing or default project path)
 */
export declare function getEmbeddingSocketPath(): string;
/**
 * Get detailed socket search information for debugging
 * Returns socket search results with all checked locations
 *
 * Checks multiple locations in priority order:
 * 1. Project directory (preferred for isolation)
 * 2. /tmp/ fallbacks (where embedding service may create them)
 * 3. SpecMem root and legacy locations
 */
export declare function getSocketSearchInfo(): {
    foundSocket: string | null;
    searchedLocations: Array<{
        path: string;
        description: string;
        priority: string;
        exists: boolean;
        isSocket: boolean;
        isSymlink: boolean;
        symlinkTarget?: string;
    }>;
    projectDirName: string;
    projectHash: string;
    specmemRoot: string;
    specmemHome: string;
    isDocker: boolean;
};
/**
 * Get project-specific database name
 * Uses SPECMEM_PROJECT_DIR_NAME for per-project isolation
 * Format: specmem_{projectname} or custom via SPECMEM_DB_NAME
 *
 * @returns Database name in format specmem_{project_dir_name}
 */
export declare function getProjectDatabaseName(): string;
/**
 * Get project-specific database port
 * Uses project directory name to derive unique port in range 5500-5599
 * Falls back to SPECMEM_DB_PORT or default 5432
 *
 * @returns Port number for project-scoped database
 */
export declare function getProjectDatabasePort(): number;
export declare function loadConfig(): ServerConfig;
/**
 * Get config - returns cached if same project and not expired, reloads otherwise
 * This prevents cross-project pollution while maintaining performance
 * Cache is keyed by project path for true multi-project isolation
 */
export declare function getConfig(): ServerConfig;
/**
 * Force config reload - use when env vars change
 * Clears cache for current project or all projects
 */
export declare function reloadConfig(projectPath?: string): ServerConfig;
/**
 * Clear the config cache - useful for testing
 * @param projectPath - Optional project path to clear specific cache, or clear all if not specified
 */
export declare function clearConfigCache(projectPath?: string): void;
/**
 * Invalidate config cache for a specific project
 * Used when project context changes or env vars are updated
 */
export declare function invalidateConfigCache(projectPath?: string): void;
export declare const config: ServerConfig;
/**
 * Skills Configuration
 */
export interface SkillsConfig {
    enabled: boolean;
    skillsPath: string;
    autoReload: boolean;
}
export declare function loadSkillsConfig(): SkillsConfig;
/**
 * Codebase Indexer Configuration
 */
export interface CodebaseConfig {
    enabled: boolean;
    codebasePath: string;
    excludePatterns: string[];
    watchForChanges: boolean;
}
export declare function loadCodebaseConfig(): CodebaseConfig;
/**
 * Coordination Server Configuration
 */
export interface CoordinationConfig {
    enabled: boolean;
    port: number;
    host: string;
}
export declare function loadCoordinationConfig(): CoordinationConfig;
/**
 * Dashboard Server Configuration
 */
export type DashboardMode = 'private' | 'public';
export interface DashboardConfig {
    enabled: boolean;
    port: number;
    host: string;
    /** Dashboard access mode: 'private' (localhost only) or 'public' (network accessible) */
    mode: DashboardMode;
}
/**
 * Load dashboard configuration from environment variables
 *
 * SPECMEM_DASHBOARD_MODE controls access:
 * - 'private' (default): Binds to 127.0.0.1, localhost-only access
 * - 'public': Binds to configured host (0.0.0.0 for all interfaces), network accessible
 *
 * SECURITY WARNING: Public mode exposes the dashboard to your network!
 * Ensure you have a strong password set via SPECMEM_DASHBOARD_PASSWORD
 */
export declare function loadDashboardConfig(): DashboardConfig;
/**
 * Port Allocation Configuration
 * Supports dynamic port allocation per project instance
 */
export interface PortConfig {
    /** Dashboard web server port */
    dashboard: number;
    /** Coordination server port */
    coordination: number;
    /** Whether ports were dynamically allocated */
    dynamicAllocation: boolean;
    /** Project path these ports are allocated for */
    projectPath?: string;
}
/**
 * Get current port configuration
 * Uses SPECMEM_PROJECT_HASH for per-project port isolation
 * Reads from environment or derives from project hash
 * For async allocation with conflict detection, use getInstancePorts from portAllocator
 */
export declare function getPortConfig(): PortConfig;
/**
 * Chinese Compactor Configuration
 * Controls token-efficient compression using Traditional Chinese
 */
export interface CompressionConfig {
    enabled: boolean;
    minLength: number;
    threshold: number;
    compressSearchResults: boolean;
    compressSystemOutput: boolean;
    compressHookOutput: boolean;
}
export declare function loadCompressionConfig(): CompressionConfig;
/**
 * Get the compression config from the main config
 * Provides safe access with defaults if not set
 */
export declare function getCompressionConfig(): CompressionConfig;
/**
 * Embedded PostgreSQL Configuration
 * Per-project PostgreSQL instance running in .specmem/pgdata/
 */
export interface EmbeddedPostgresConfig {
    /** Enable embedded PostgreSQL mode (default: true if PostgreSQL binaries found) */
    enabled: boolean;
    /** Project path for data directory location */
    projectPath: string;
    /** Port for embedded PostgreSQL (auto-allocated if not specified) */
    port?: number;
    /** Database name to create */
    database: string;
    /** Database user to create */
    user: string;
    /** Database password (auto-generated if not specified) */
    password?: string;
    /** Auto-start PostgreSQL when SpecMem starts */
    autoStart: boolean;
    /** Auto-stop PostgreSQL when SpecMem stops */
    autoStop: boolean;
    /** Port range start for auto-allocation */
    portRangeStart: number;
    /** Port range end for auto-allocation */
    portRangeEnd: number;
}
/**
 * Load embedded PostgreSQL configuration
 * Uses SPECMEM_PROJECT_DIR_NAME for per-project isolation
 * NO MORE HASHES - uses readable project directory name
 */
export declare function loadEmbeddedPostgresConfig(): EmbeddedPostgresConfig;
/**
 * Check if embedded PostgreSQL is active
 * Returns true if:
 * 1. Embedded mode is enabled
 * 2. SPECMEM_EMBEDDED_PG_ACTIVE env var is set (set by bootstrap.cjs)
 */
export declare function isEmbeddedPostgresActive(): boolean;
/**
 * Get the embedded PostgreSQL data directory path
 */
export declare function getEmbeddedPostgresDataDir(projectPath?: string): string;
export {};
//# sourceMappingURL=config.d.ts.map