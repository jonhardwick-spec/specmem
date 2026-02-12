/**
 * Embedded PostgreSQL Manager for Per-Project SpecMem
 *
 * This module manages a project-local PostgreSQL instance that:
 * - Stores data in .specmem/pgdata/ within the project directory
 * - Auto-initializes with initdb on first run
 * - Auto-starts when SpecMem starts
 * - Auto-stops when SpecMem stops
 * - Uses unique ports per project (calculated from project path hash)
 *
 * NO GLOBAL POSTGRES REQUIRED - everything is contained in the project directory
 */
interface EmbeddedPostgresState {
    initialized: boolean;
    port: number;
    pid?: number;
    dataDir: string;
    database: string;
    user: string;
    startedAt?: string;
    projectPath: string;
    projectHash: string;
}
interface EmbeddedPostgresConfig {
    projectPath: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    autoStart?: boolean;
}
/**
 * Embedded PostgreSQL Manager
 *
 * Manages a per-project PostgreSQL instance with automatic lifecycle management.
 */
export declare class EmbeddedPostgresManager {
    private config;
    private state;
    private binaries;
    private pgProcess;
    private shutdownInProgress;
    constructor(config: EmbeddedPostgresConfig);
    /**
     * Get the .specmem directory path
     */
    private get specmemDir();
    /**
     * Get the PostgreSQL data directory path
     */
    private get dataDir();
    /**
     * Get the PostgreSQL log file path
     */
    private get logFile();
    /**
     * Get the state file path
     */
    private get stateFile();
    /**
     * Get the project hash for identification
     */
    private get projectHash();
    /**
     * Ensure .specmem directory exists
     */
    private ensureSpecmemDir;
    /**
     * Load state from file
     */
    private loadState;
    /**
     * Save state to file
     */
    private saveState;
    /**
     * Check if PostgreSQL binaries are available
     */
    checkPrerequisites(): Promise<{
        available: boolean;
        error?: string;
    }>;
    /**
     * Check if PostgreSQL is already initialized
     */
    isInitialized(): boolean;
    /**
     * Check if PostgreSQL is currently running
     */
    isRunning(): Promise<boolean>;
    /**
     * Initialize PostgreSQL data directory
     */
    initPostgres(): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * Configure postgresql.conf for embedded use
     */
    private configurePostgres;
    /**
     * Configure pg_hba.conf for local connections
     */
    private configureAuthentication;
    /**
     * Start PostgreSQL server
     */
    startPostgres(): Promise<{
        success: boolean;
        port?: number;
        error?: string;
    }>;
    /**
     * Ensure the specmem database exists
     */
    private ensureDatabase;
    /**
     * Stop PostgreSQL server
     */
    stopPostgres(): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * Get connection configuration for the embedded PostgreSQL
     */
    getConnectionConfig(): {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string;
    };
    /**
     * Get current state
     */
    getState(): EmbeddedPostgresState | null;
    /**
     * Get data directory path
     */
    getDataDir(): string;
    /**
     * Clean up and remove all PostgreSQL data
     * WARNING: This deletes all data!
     */
    destroy(): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * Register shutdown handlers to stop PostgreSQL on process exit
     */
    registerShutdownHandlers(): void;
}
/**
 * Get or create the embedded PostgreSQL manager for the current project
 */
export declare function getEmbeddedPostgres(projectPath?: string): EmbeddedPostgresManager;
/**
 * Initialize and start embedded PostgreSQL
 * Returns connection configuration on success
 */
export declare function initEmbeddedPostgres(projectPath?: string): Promise<{
    success: boolean;
    connectionConfig?: {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string;
    };
    error?: string;
}>;
/**
 * Stop embedded PostgreSQL
 */
export declare function stopEmbeddedPostgres(): Promise<{
    success: boolean;
    error?: string;
}>;
/**
 * Check if embedded PostgreSQL is running
 */
export declare function isEmbeddedPostgresRunning(): Promise<boolean>;
export default EmbeddedPostgresManager;
//# sourceMappingURL=embeddedPostgres.d.ts.map