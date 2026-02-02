/**
 * portAllocator.ts - Dynamic Port Allocation for SpecMem Instances
 *
 * Provides unique, consistent port allocation for each SpecMem instance
 * based on project path. Uses deterministic hashing with conflict detection
 * and automatic fallback to alternative ports.
 *
 * Strategy: Hash-based port generation with conflict detection
 * - Hash project path to get a base port offset
 * - Check for port conflicts
 * - Persist allocated ports for consistency across restarts
 * - Automatic retry with next available port if conflict detected
 *
 * @author hardwicksoftwareservices
 */
/**
 * FORBIDDEN PORTS - These ports must NEVER be used
 * Port 8787 is explicitly forbidden per project requirements
 */
export declare const FORBIDDEN_PORTS: readonly number[];
/**
 * Port configuration for SpecMem services
 *
 * IMPORTANT: Dynamic port range is 8595-8720 (125 ports for instances)
 * Port 8787 is FORBIDDEN and must never be allocated
 */
export declare const PORT_CONFIG: {
    /** Minimum port number for dynamic allocation */
    readonly MIN_PORT: 8595;
    /** Maximum port number for dynamic allocation (125 ports: 8595-8720) */
    readonly MAX_PORT: 8720;
    /** Total ports available in the dynamic range */
    readonly DYNAMIC_RANGE_SIZE: 126;
    /** Range size for each project's port block */
    readonly PORT_RANGE_SIZE: 50;
    /** Number of ports to allocate per instance (dashboard, coordination, postgres) */
    readonly PORTS_PER_INSTANCE: 3;
    /** Port indices within instance allocation */
    readonly PORT_INDICES: {
        readonly DASHBOARD: 0;
        readonly COORDINATION: 1;
        readonly POSTGRES: 2;
    };
    /** Reserved port ranges for common services to avoid */
    readonly RESERVED_RANGES: readonly [{
        readonly start: 8080;
        readonly end: 8090;
    }, {
        readonly start: 3000;
        readonly end: 3010;
    }, {
        readonly start: 5000;
        readonly end: 5010;
    }, {
        readonly start: 5432;
        readonly end: 5432;
    }, {
        readonly start: 6379;
        readonly end: 6380;
    }, {
        readonly start: 27017;
        readonly end: 27018;
    }];
    /** Default ports (fallback when no project-specific config) */
    readonly DEFAULTS: {
        readonly DASHBOARD: 8595;
        readonly COORDINATION: 8596;
        readonly POSTGRES: 5432;
    };
    /** Max attempts to find available ports */
    readonly MAX_ALLOCATION_ATTEMPTS: 125;
    /** PostgreSQL - always system postgres on 5432 (no dynamic allocation) */
    readonly POSTGRES: {
        readonly MIN_PORT: 5432;
        readonly MAX_PORT: 5432;
    };
    /** System PostgreSQL port (always use system postgres on 5432) */
    readonly SYSTEM_POSTGRES_PORT: 5432;
};
/**
 * Allocated ports for a SpecMem instance
 */
export interface AllocatedPorts {
    /** Dashboard web server port */
    dashboard: number;
    /** Coordination server port */
    coordination: number;
    /** PostgreSQL port - always system postgres 5432 */
    postgres: number;
    /** Project path this allocation is for */
    projectPath: string;
    /** Hash used for deterministic allocation */
    projectHash: string;
    /** Timestamp of allocation */
    allocatedAt: number;
    /** Whether ports were verified as available */
    verified: boolean;
}
/**
 * Port allocation configuration
 */
export interface PortAllocationConfig {
    /** Project root path (used for hashing) */
    projectPath: string;
    /** Minimum port to use */
    minPort?: number;
    /** Maximum port to use */
    maxPort?: number;
    /** Whether to verify port availability */
    verifyAvailability?: boolean;
    /** Whether to persist allocation to project config */
    persistAllocation?: boolean;
    /** Custom config file path (default: .specmem/ports.json) */
    configPath?: string;
}
/**
 * Port configuration file structure
 */
interface PortConfigFile {
    version: 1;
    projectPath: string;
    projectHash: string;
    ports: {
        dashboard: number;
        coordination: number;
        postgres?: number;
    };
    allocatedAt: number;
    lastVerified?: number;
}
/**
 * Generate a deterministic hash from project path
 * Returns a number that can be used as a port offset
 */
export declare function hashProjectPath(projectPath: string): {
    hash: string;
    offset: number;
};
/**
 * Calculate base port for a project
 * Uses dynamic range 8595-8720 (125 ports), never uses forbidden port 8787
 */
export declare function calculateBasePort(projectPath: string): number;
/**
 * Get the default config file path for a project
 */
export declare function getConfigFilePath(projectPath: string, customPath?: string): string;
/**
 * Load persisted port configuration from file
 */
export declare function loadPortConfig(projectPath: string, configPath?: string): Promise<PortConfigFile | null>;
/**
 * Save port configuration to file
 */
export declare function savePortConfig(projectPath: string, ports: {
    dashboard: number;
    coordination: number;
}, configPath?: string): Promise<boolean>;
/**
 * Check if a port is forbidden (must NEVER be used)
 * Port 8787 is explicitly forbidden per project requirements
 */
export declare function isForbiddenPort(port: number): boolean;
/**
 * Check if a port is in a reserved range
 */
export declare function isReservedPort(port: number): boolean;
/**
 * Check if a port is within the valid dynamic allocation range
 * Valid range: 8595-8720 (excluding forbidden ports)
 */
export declare function isInDynamicRange(port: number): boolean;
/**
 * Verify that allocated ports are available
 */
export declare function verifyPortsAvailable(ports: {
    dashboard: number;
    coordination: number;
}, host?: string): Promise<{
    dashboard: boolean;
    coordination: boolean;
}>;
/**
 * Find next available port pair starting from base port
 * Uses dynamic allocation within range 8595-8720, never uses forbidden ports (8787)
 */
export declare function findAvailablePortPair(startPort: number, host?: string, maxAttempts?: number): Promise<{
    dashboard: number;
    coordination: number;
} | null>;
/**
 * Calculate PostgreSQL port for a project using hash-based allocation
 * Uses same deterministic hashing as dashboard/coordination but in the PostgreSQL range
 */
export declare function calculatePostgresPort(projectPath: string): number;
/**
 * Check if a port is being used by a PostgreSQL process
 * This provides more specific detection than generic port checks
 */
export declare function isPostgresPortInUse(port: number, host?: string): Promise<boolean>;
/**
 * Verify PostgreSQL port is available
 * Checks both generic port availability and PostgreSQL-specific indicators
 */
export declare function verifyPostgresPortAvailable(port: number, host?: string): Promise<boolean>;
/**
 * Find an available PostgreSQL port starting from the hash-based port
 * Iterates through the PostgreSQL port range to find an unused port
 */
export declare function findAvailablePostgresPort(startPort: number, host?: string, maxAttempts?: number): Promise<number | null>;
/**
 * Allocate a PostgreSQL port for a project
 *
 * Process:
 * 1. Check for existing allocation in ports.json
 * 2. If found and port available, use it
 * 3. Otherwise, calculate hash-based port
 * 4. Find available port if conflicts exist
 * 5. Persist allocation
 */
export declare function allocatePostgresPort(config: PortAllocationConfig): Promise<{
    port: number;
    projectPath: string;
    projectHash: string;
    verified: boolean;
}>;
/**
 * Get PostgreSQL port synchronously (from cached allocation)
 */
export declare function getPostgresPort(): number;
/**
 * Get PostgreSQL connection string for the allocated port
 */
export declare function getPostgresConnectionString(database?: string, user?: string, host?: string): string;
/**
 * Allocate ports for a SpecMem instance
 *
 * Process:
 * 1. Check for persisted port config
 * 2. If found and ports available, use them
 * 3. Otherwise, calculate hash-based ports
 * 4. Find available ports if conflicts exist
 * 5. Persist allocation for future use
 */
export declare function allocatePorts(config: PortAllocationConfig): Promise<AllocatedPorts>;
/**
 * Get allocated ports for the current project
 * Uses singleton pattern for consistent ports across the application
 */
export declare function getInstancePorts(projectPath?: string, options?: Partial<PortAllocationConfig>): Promise<AllocatedPorts>;
/**
 * Get ports synchronously (uses cached value or defaults)
 * Useful for immediate access before async allocation completes
 */
export declare function getInstancePortsSync(): AllocatedPorts | null;
/**
 * Get dashboard port (sync with fallback)
 */
export declare function getDashboardPort(): number;
/**
 * Get coordination port (sync with fallback)
 */
export declare function getCoordinationPort(): number;
/**
 * Reset allocated ports (for testing)
 */
export declare function resetAllocatedPorts(): void;
/**
 * Set allocated ports explicitly (for testing or external configuration)
 */
export declare function setAllocatedPorts(ports: AllocatedPorts): void;
/**
 * Format allocated ports for display
 */
export declare function formatPortsForDisplay(ports: AllocatedPorts): string;
/**
 * Get port allocation summary
 */
export declare function getPortAllocationSummary(ports: AllocatedPorts): {
    dashboard: {
        port: number;
        url: string;
    };
    coordination: {
        port: number;
        wsUrl: string;
    };
    postgres: {
        port: number;
        connectionString: string;
    };
    projectPath: string;
    verified: boolean;
};
export {};
//# sourceMappingURL=portAllocator.d.ts.map