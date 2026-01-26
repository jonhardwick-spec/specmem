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
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { isPortAvailable } from './portUtils.js';
import { logger } from './logger.js';
// ============================================================================
// Constants
// ============================================================================
/**
 * FORBIDDEN PORTS - These ports must NEVER be used
 * Port 8787 is explicitly forbidden per project requirements
 */
export const FORBIDDEN_PORTS = [
    8787, // NEVER use this port - explicitly forbidden
];
/**
 * Port configuration for SpecMem services
 *
 * IMPORTANT: Dynamic port range is 8595-8720 (125 ports for instances)
 * Port 8787 is FORBIDDEN and must never be allocated
 */
export const PORT_CONFIG = {
    /** Minimum port number for dynamic allocation */
    MIN_PORT: 8595,
    /** Maximum port number for dynamic allocation (125 ports: 8595-8720) */
    MAX_PORT: 8720,
    /** Total ports available in the dynamic range */
    DYNAMIC_RANGE_SIZE: 126, // 8720 - 8595 + 1 = 126, minus forbidden = 125 usable
    /** Range size for each project's port block */
    PORT_RANGE_SIZE: 50,
    /** Number of ports to allocate per instance (dashboard, coordination, postgres) */
    PORTS_PER_INSTANCE: 3,
    /** Port indices within instance allocation */
    PORT_INDICES: {
        DASHBOARD: 0,
        COORDINATION: 1,
        POSTGRES: 2,
    },
    /** Reserved port ranges for common services to avoid */
    RESERVED_RANGES: [
        { start: 8080, end: 8090 }, // Common web servers
        { start: 3000, end: 3010 }, // React dev servers
        { start: 5000, end: 5010 }, // Flask default
        { start: 5432, end: 5432 }, // PostgreSQL default (system)
        { start: 6379, end: 6380 }, // Redis
        { start: 27017, end: 27018 }, // MongoDB
    ],
    /** Default ports (fallback when no project-specific config) */
    DEFAULTS: {
        DASHBOARD: 8595,
        COORDINATION: 8596,
        POSTGRES: 5432, // System postgres - no dynamic allocation
    },
    /** Max attempts to find available ports */
    MAX_ALLOCATION_ATTEMPTS: 125, // Can try all ports in range
    /** PostgreSQL - always system postgres on 5432 (no dynamic allocation) */
    POSTGRES: {
        MIN_PORT: 5432,
        MAX_PORT: 5432,
    },
    /** System PostgreSQL port (always use system postgres on 5432) */
    SYSTEM_POSTGRES_PORT: 5432,
};
// ============================================================================
// Port Hash Generation
// ============================================================================
/**
 * Generate a deterministic hash from project path
 * Returns a number that can be used as a port offset
 */
export function hashProjectPath(projectPath) {
    // Normalize path for consistent hashing across platforms
    const normalizedPath = path.resolve(projectPath).toLowerCase().replace(/\\/g, '/');
    // Create SHA256 hash
    const hash = createHash('sha256').update(normalizedPath).digest('hex');
    // Use first 8 characters of hash to generate port offset
    const hashNum = parseInt(hash.substring(0, 8), 16);
    // Calculate port offset within allowed range
    const rangeSize = PORT_CONFIG.MAX_PORT - PORT_CONFIG.MIN_PORT;
    const offset = (hashNum % rangeSize);
    return { hash, offset };
}
/**
 * Calculate base port for a project
 * Uses dynamic range 8595-8720 (125 ports), never uses forbidden port 8787
 */
export function calculateBasePort(projectPath) {
    const { offset } = hashProjectPath(projectPath);
    const rangeSize = PORT_CONFIG.MAX_PORT - PORT_CONFIG.MIN_PORT - PORT_CONFIG.PORTS_PER_INSTANCE;
    let basePort = PORT_CONFIG.MIN_PORT + (offset % rangeSize);
    // Ensure we have room for all ports in the instance
    if (basePort > PORT_CONFIG.MAX_PORT - PORT_CONFIG.PORTS_PER_INSTANCE) {
        basePort = PORT_CONFIG.MIN_PORT;
    }
    // CRITICAL: Skip forbidden ports (8787)
    while (isForbiddenPort(basePort) || isForbiddenPort(basePort + 1) || isForbiddenPort(basePort + 2)) {
        basePort++;
        if (basePort > PORT_CONFIG.MAX_PORT - PORT_CONFIG.PORTS_PER_INSTANCE) {
            basePort = PORT_CONFIG.MIN_PORT;
        }
    }
    // Avoid reserved ranges (but these shouldn't be in our 8595-8720 range)
    for (const reserved of PORT_CONFIG.RESERVED_RANGES) {
        if (basePort >= reserved.start && basePort <= reserved.end + PORT_CONFIG.PORTS_PER_INSTANCE) {
            basePort = reserved.end + 1;
        }
    }
    return basePort;
}
// ============================================================================
// Port Config Persistence
// ============================================================================
/**
 * Get the default config file path for a project
 */
export function getConfigFilePath(projectPath, customPath) {
    if (customPath) {
        return path.resolve(customPath);
    }
    return path.join(projectPath, '.specmem', 'ports.json');
}
/**
 * Load persisted port configuration from file
 */
export async function loadPortConfig(projectPath, configPath) {
    const filePath = getConfigFilePath(projectPath, configPath);
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const config = JSON.parse(content);
        // Validate config structure
        if (config.version !== 1 || !config.ports?.dashboard || !config.ports?.coordination) {
            logger.warn({ filePath }, 'Invalid port config file structure, will regenerate');
            return null;
        }
        // Validate project path matches (in case file was copied)
        const currentHash = hashProjectPath(projectPath).hash;
        if (config.projectHash !== currentHash) {
            logger.info({
                storedHash: config.projectHash,
                currentHash,
                filePath
            }, 'Project path changed, will regenerate port config');
            return null;
        }
        logger.debug({
            filePath,
            ports: config.ports
        }, 'Loaded persisted port configuration');
        return config;
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            logger.debug({ error, filePath }, 'Error loading port config');
        }
        return null;
    }
}
/**
 * Save port configuration to file
 */
export async function savePortConfig(projectPath, ports, configPath) {
    const filePath = getConfigFilePath(projectPath, configPath);
    const { hash } = hashProjectPath(projectPath);
    const config = {
        version: 1,
        projectPath: path.resolve(projectPath),
        projectHash: hash,
        ports,
        allocatedAt: Date.now(),
        lastVerified: Date.now(),
    };
    try {
        // Ensure .specmem directory exists
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        // Write config with nice formatting
        await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
        logger.info({
            filePath,
            ports
        }, 'Port configuration saved');
        return true;
    }
    catch (error) {
        logger.error({ error, filePath }, 'Failed to save port configuration');
        return false;
    }
}
// ============================================================================
// Port Availability Checking
// ============================================================================
/**
 * Check if a port is forbidden (must NEVER be used)
 * Port 8787 is explicitly forbidden per project requirements
 */
export function isForbiddenPort(port) {
    return FORBIDDEN_PORTS.includes(port);
}
/**
 * Check if a port is in a reserved range
 */
export function isReservedPort(port) {
    // First check forbidden ports
    if (isForbiddenPort(port)) {
        return true;
    }
    // Then check reserved ranges
    for (const reserved of PORT_CONFIG.RESERVED_RANGES) {
        if (port >= reserved.start && port <= reserved.end) {
            return true;
        }
    }
    return false;
}
/**
 * Check if a port is within the valid dynamic allocation range
 * Valid range: 8595-8720 (excluding forbidden ports)
 */
export function isInDynamicRange(port) {
    return port >= PORT_CONFIG.MIN_PORT && port <= PORT_CONFIG.MAX_PORT && !isForbiddenPort(port);
}
/**
 * Verify that allocated ports are available
 */
export async function verifyPortsAvailable(ports, host = '127.0.0.1') {
    const [dashboardAvailable, coordinationAvailable] = await Promise.all([
        isPortAvailable(ports.dashboard, host),
        isPortAvailable(ports.coordination, host),
    ]);
    return {
        dashboard: dashboardAvailable,
        coordination: coordinationAvailable
    };
}
/**
 * Find next available port pair starting from base port
 * Uses dynamic allocation within range 8595-8720, never uses forbidden ports (8787)
 */
export async function findAvailablePortPair(startPort, host = '127.0.0.1', maxAttempts = PORT_CONFIG.MAX_ALLOCATION_ATTEMPTS) {
    // Ensure start port is within valid range
    let currentPort = Math.max(startPort, PORT_CONFIG.MIN_PORT);
    if (currentPort > PORT_CONFIG.MAX_PORT) {
        currentPort = PORT_CONFIG.MIN_PORT;
    }
    const checkedPorts = new Set();
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const dashboardPort = currentPort;
        const coordinationPort = dashboardPort + 1;
        // Track checked ports to avoid infinite loops
        if (checkedPorts.has(dashboardPort)) {
            currentPort = PORT_CONFIG.MIN_PORT;
            if (checkedPorts.has(currentPort)) {
                break; // We've checked all ports
            }
            continue;
        }
        checkedPorts.add(dashboardPort);
        // Skip if coordination port would be out of range
        if (coordinationPort > PORT_CONFIG.MAX_PORT) {
            currentPort = PORT_CONFIG.MIN_PORT;
            continue;
        }
        // Skip forbidden ports (8787) - CRITICAL: never use these
        if (isForbiddenPort(dashboardPort) || isForbiddenPort(coordinationPort)) {
            logger.debug({ dashboardPort, coordinationPort }, 'Skipping forbidden port');
            currentPort = coordinationPort + 1;
            continue;
        }
        // Skip reserved ports
        if (isReservedPort(dashboardPort) || isReservedPort(coordinationPort)) {
            currentPort = coordinationPort + 1;
            continue;
        }
        // Check availability using net.createServer
        const availability = await verifyPortsAvailable({ dashboard: dashboardPort, coordination: coordinationPort }, host);
        if (availability.dashboard && availability.coordination) {
            logger.debug({
                dashboardPort,
                coordinationPort,
                attempt
            }, 'Found available port pair');
            return {
                dashboard: dashboardPort,
                coordination: coordinationPort
            };
        }
        logger.debug({
            dashboardPort,
            coordinationPort,
            dashboardAvailable: availability.dashboard,
            coordinationAvailable: availability.coordination
        }, 'Port pair not available, trying next');
        // Move to next pair
        currentPort = coordinationPort + 1;
        if (currentPort > PORT_CONFIG.MAX_PORT) {
            currentPort = PORT_CONFIG.MIN_PORT;
        }
    }
    return null;
}
// ============================================================================
// PostgreSQL Port Allocation
// ============================================================================
/**
 * Calculate PostgreSQL port for a project using hash-based allocation
 * Uses same deterministic hashing as dashboard/coordination but in the PostgreSQL range
 */
export function calculatePostgresPort(projectPath) {
    const { offset } = hashProjectPath(projectPath);
    const pgRange = PORT_CONFIG.POSTGRES.MAX_PORT - PORT_CONFIG.POSTGRES.MIN_PORT;
    // Use the hash offset to calculate PostgreSQL port within its dedicated range
    const pgOffset = offset % pgRange;
    return PORT_CONFIG.POSTGRES.MIN_PORT + pgOffset;
}
/**
 * Check if a port is being used by a PostgreSQL process
 * This provides more specific detection than generic port checks
 */
export async function isPostgresPortInUse(port, host = '127.0.0.1') {
    // First, check if the port is in use at all
    const portInUse = !(await isPortAvailable(port, host));
    if (!portInUse) {
        return false;
    }
    // Port is in use - we could try to determine if it's PostgreSQL specifically
    // but for safety, treat any port in use as potentially PostgreSQL
    // This prevents conflicts with other PostgreSQL instances
    logger.debug({ port, host }, 'Port is in use (potential PostgreSQL)');
    return true;
}
/**
 * Verify PostgreSQL port is available
 * Checks both generic port availability and PostgreSQL-specific indicators
 */
export async function verifyPostgresPortAvailable(port, host = '127.0.0.1') {
    // Check if port is within valid PostgreSQL range
    if (port < PORT_CONFIG.POSTGRES.MIN_PORT || port > PORT_CONFIG.POSTGRES.MAX_PORT) {
        logger.warn({ port, range: PORT_CONFIG.POSTGRES }, 'Port outside PostgreSQL range');
        return false;
    }
    // Check if port is available
    const available = await isPortAvailable(port, host);
    if (!available) {
        logger.debug({ port }, 'PostgreSQL port not available');
        return false;
    }
    return true;
}
/**
 * Find an available PostgreSQL port starting from the hash-based port
 * Iterates through the PostgreSQL port range to find an unused port
 */
export async function findAvailablePostgresPort(startPort, host = '127.0.0.1', maxAttempts = PORT_CONFIG.MAX_ALLOCATION_ATTEMPTS) {
    const { MIN_PORT, MAX_PORT } = PORT_CONFIG.POSTGRES;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Calculate candidate port, wrapping within PostgreSQL range
        let candidatePort = startPort + attempt;
        if (candidatePort > MAX_PORT) {
            candidatePort = MIN_PORT + ((candidatePort - MIN_PORT) % (MAX_PORT - MIN_PORT + 1));
        }
        // Check if port is available
        const available = await verifyPostgresPortAvailable(candidatePort, host);
        if (available) {
            logger.debug({
                port: candidatePort,
                attempt,
                startPort
            }, 'Found available PostgreSQL port');
            return candidatePort;
        }
        logger.debug({
            port: candidatePort,
            attempt
        }, 'PostgreSQL port not available, trying next');
    }
    logger.warn({
        startPort,
        maxAttempts,
        range: PORT_CONFIG.POSTGRES
    }, 'No available PostgreSQL port found in range');
    return null;
}
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
export async function allocatePostgresPort(config) {
    const { projectPath, verifyAvailability = true, persistAllocation = true, configPath, } = config;
    const resolvedPath = path.resolve(projectPath);
    const { hash } = hashProjectPath(resolvedPath);
    const host = '127.0.0.1';
    logger.info({
        projectPath: resolvedPath,
        hash: hash.substring(0, 16) + '...',
    }, 'Allocating PostgreSQL port for SpecMem instance');
    // Step 1: Check for existing persisted configuration
    const existingConfig = await loadPortConfig(resolvedPath, configPath);
    if (existingConfig?.ports.postgres) {
        const existingPort = existingConfig.ports.postgres;
        if (verifyAvailability) {
            const available = await verifyPostgresPortAvailable(existingPort, host);
            if (available) {
                logger.info({ port: existingPort }, 'Using persisted PostgreSQL port');
                return {
                    port: existingPort,
                    projectPath: resolvedPath,
                    projectHash: hash,
                    verified: true,
                };
            }
            else {
                logger.warn({
                    port: existingPort
                }, 'Persisted PostgreSQL port not available, reallocating');
            }
        }
        else {
            return {
                port: existingPort,
                projectPath: resolvedPath,
                projectHash: hash,
                verified: false,
            };
        }
    }
    // Step 2: Calculate hash-based port
    const basePort = calculatePostgresPort(resolvedPath);
    logger.debug({ basePort }, 'Calculated hash-based PostgreSQL port');
    // Step 3: Find available port
    let port = null;
    if (verifyAvailability) {
        port = await findAvailablePostgresPort(basePort, host);
        if (!port) {
            // Try from min port as last resort
            logger.warn({ basePort }, 'No PostgreSQL ports available from hash position, trying from start');
            port = await findAvailablePostgresPort(PORT_CONFIG.POSTGRES.MIN_PORT, host);
        }
    }
    else {
        port = basePort;
    }
    // Fallback to default
    if (!port) {
        logger.error('No available PostgreSQL port found, using default');
        port = PORT_CONFIG.DEFAULTS.POSTGRES;
    }
    // Step 4: Persist allocation (need to merge with existing config)
    if (persistAllocation) {
        // Load existing config to preserve dashboard/coordination ports
        const existing = await loadPortConfig(resolvedPath, configPath);
        const portsToSave = {
            dashboard: existing?.ports.dashboard || PORT_CONFIG.DEFAULTS.DASHBOARD,
            coordination: existing?.ports.coordination || PORT_CONFIG.DEFAULTS.COORDINATION,
            postgres: port,
        };
        await savePortConfigWithPostgres(resolvedPath, portsToSave, configPath);
    }
    logger.info({
        port,
        projectPath: resolvedPath
    }, 'PostgreSQL port allocation complete');
    return {
        port,
        projectPath: resolvedPath,
        projectHash: hash,
        verified: verifyAvailability,
    };
}
/**
 * Save port configuration including PostgreSQL port
 */
async function savePortConfigWithPostgres(projectPath, ports, configPath) {
    const filePath = getConfigFilePath(projectPath, configPath);
    const { hash } = hashProjectPath(projectPath);
    const config = {
        version: 1,
        projectPath: path.resolve(projectPath),
        projectHash: hash,
        ports,
        allocatedAt: Date.now(),
        lastVerified: Date.now(),
    };
    try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
        logger.info({
            filePath,
            ports
        }, 'Port configuration (with PostgreSQL) saved');
        return true;
    }
    catch (error) {
        logger.error({ error, filePath }, 'Failed to save port configuration with PostgreSQL');
        return false;
    }
}
/**
 * Get PostgreSQL port synchronously (from cached allocation)
 */
export function getPostgresPort() {
    if (globalAllocatedPorts?.postgres) {
        return globalAllocatedPorts.postgres;
    }
    const envPort = parseInt(process.env['SPECMEM_POSTGRES_PORT'] || '', 10);
    return envPort || PORT_CONFIG.DEFAULTS.POSTGRES;
}
/**
 * Get PostgreSQL connection string for the allocated port
 */
export function getPostgresConnectionString(database = 'specmem_westayunprofessional', user = 'specmem_westayunprofessional', host = 'localhost') {
    const port = getPostgresPort();
    return `postgresql://${user}@${host}:${port}/${database}`;
}
// ============================================================================
// Main Port Allocation
// ============================================================================
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
export async function allocatePorts(config) {
    const { projectPath, verifyAvailability = true, persistAllocation = true, configPath, } = config;
    const resolvedPath = path.resolve(projectPath);
    const { hash, offset } = hashProjectPath(resolvedPath);
    const host = '127.0.0.1';
    logger.info({
        projectPath: resolvedPath,
        hash: hash.substring(0, 16) + '...',
        offset
    }, 'Allocating ports for SpecMem instance');
    // Step 1: Check for existing persisted configuration
    const existingConfig = await loadPortConfig(resolvedPath, configPath);
    if (existingConfig) {
        const ports = existingConfig.ports;
        if (verifyAvailability) {
            const availability = await verifyPortsAvailable(ports, host);
            // Also check PostgreSQL port if present
            const postgresAvailable = ports.postgres
                ? await verifyPostgresPortAvailable(ports.postgres, host)
                : true;
            if (availability.dashboard && availability.coordination && postgresAvailable) {
                logger.info({ ports }, 'Using persisted port configuration');
                return {
                    dashboard: ports.dashboard,
                    coordination: ports.coordination,
                    postgres: ports.postgres || PORT_CONFIG.DEFAULTS.POSTGRES,
                    projectPath: resolvedPath,
                    projectHash: hash,
                    allocatedAt: existingConfig.allocatedAt,
                    verified: true,
                };
            }
            else {
                logger.warn({
                    ports,
                    availability,
                    postgresAvailable
                }, 'Persisted ports not available, reallocating');
            }
        }
        else {
            // Use without verification (caller will handle conflicts)
            return {
                dashboard: ports.dashboard,
                coordination: ports.coordination,
                postgres: ports.postgres || PORT_CONFIG.DEFAULTS.POSTGRES,
                projectPath: resolvedPath,
                projectHash: hash,
                allocatedAt: existingConfig.allocatedAt,
                verified: false,
            };
        }
    }
    // Step 2: Calculate hash-based base port
    const basePort = calculateBasePort(resolvedPath);
    logger.debug({ basePort }, 'Calculated hash-based base port');
    // Step 3: Find available port pair (dashboard + coordination)
    let ports = null;
    if (verifyAvailability) {
        ports = await findAvailablePortPair(basePort, host);
        if (!ports) {
            // Try from min port as last resort
            logger.warn({ basePort }, 'No ports available in hash range, trying from min port');
            ports = await findAvailablePortPair(PORT_CONFIG.MIN_PORT, host);
        }
    }
    else {
        // Use calculated ports without verification
        ports = {
            dashboard: basePort,
            coordination: basePort + 1,
        };
    }
    if (!ports) {
        // Ultimate fallback to defaults
        logger.error('No available ports found, using defaults');
        ports = {
            dashboard: PORT_CONFIG.DEFAULTS.DASHBOARD,
            coordination: PORT_CONFIG.DEFAULTS.COORDINATION,
        };
    }
    // Step 4: Allocate PostgreSQL port
    const pgBasePort = calculatePostgresPort(resolvedPath);
    let postgresPort = PORT_CONFIG.DEFAULTS.POSTGRES;
    if (verifyAvailability) {
        const availablePgPort = await findAvailablePostgresPort(pgBasePort, host);
        if (availablePgPort) {
            postgresPort = availablePgPort;
        }
        else {
            logger.warn({ pgBasePort }, 'No PostgreSQL port available, using default');
        }
    }
    else {
        postgresPort = pgBasePort;
    }
    // Step 5: Persist allocation (including PostgreSQL)
    const allPorts = {
        dashboard: ports.dashboard,
        coordination: ports.coordination,
        postgres: postgresPort,
    };
    if (persistAllocation) {
        await savePortConfigWithPostgres(resolvedPath, allPorts, configPath);
    }
    logger.info({
        ports: allPorts,
        projectPath: resolvedPath
    }, 'Port allocation complete');
    return {
        dashboard: allPorts.dashboard,
        coordination: allPorts.coordination,
        postgres: allPorts.postgres,
        projectPath: resolvedPath,
        projectHash: hash,
        allocatedAt: Date.now(),
        verified: verifyAvailability,
    };
}
// ============================================================================
// Singleton Port Manager
// ============================================================================
/**
 * Global allocated ports for the current instance
 */
let globalAllocatedPorts = null;
/**
 * Get allocated ports for the current project
 * Uses singleton pattern for consistent ports across the application
 */
export async function getInstancePorts(projectPath, options) {
    // Use SPECMEM_PROJECT_PATH (set by bootstrap.cjs) as primary source of truth for project path
    // This ensures per-instance isolation when multiple  sessions are running
    const effectiveProjectPath = projectPath || process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
    // Use cached allocation if available and matches project
    if (globalAllocatedPorts) {
        const resolvedPath = path.resolve(effectiveProjectPath);
        if (globalAllocatedPorts.projectPath === resolvedPath) {
            return globalAllocatedPorts;
        }
    }
    // Allocate new ports
    globalAllocatedPorts = await allocatePorts({
        projectPath: effectiveProjectPath,
        ...options,
    });
    return globalAllocatedPorts;
}
/**
 * Get ports synchronously (uses cached value or defaults)
 * Useful for immediate access before async allocation completes
 */
export function getInstancePortsSync() {
    return globalAllocatedPorts;
}
/**
 * Get dashboard port (sync with fallback)
 */
export function getDashboardPort() {
    if (globalAllocatedPorts?.dashboard) {
        return globalAllocatedPorts.dashboard;
    }
    const envPort = parseInt(process.env['SPECMEM_DASHBOARD_PORT'] || '', 10);
    return envPort || PORT_CONFIG.DEFAULTS.DASHBOARD;
}
/**
 * Get coordination port (sync with fallback)
 */
export function getCoordinationPort() {
    if (globalAllocatedPorts?.coordination) {
        return globalAllocatedPorts.coordination;
    }
    const envPort = parseInt(process.env['SPECMEM_COORDINATION_PORT'] || '', 10);
    return envPort || PORT_CONFIG.DEFAULTS.COORDINATION;
}
/**
 * Reset allocated ports (for testing)
 */
export function resetAllocatedPorts() {
    globalAllocatedPorts = null;
}
/**
 * Set allocated ports explicitly (for testing or external configuration)
 */
export function setAllocatedPorts(ports) {
    globalAllocatedPorts = ports;
}
// ============================================================================
// Port Display Utilities
// ============================================================================
/**
 * Format allocated ports for display
 */
export function formatPortsForDisplay(ports) {
    return [
        `Dashboard: http://localhost:${ports.dashboard}`,
        `Coordination: ws://localhost:${ports.coordination}`,
        `PostgreSQL: postgresql://localhost:${ports.postgres}/specmem`,
    ].join('\n');
}
/**
 * Get port allocation summary
 */
export function getPortAllocationSummary(ports) {
    return {
        dashboard: {
            port: ports.dashboard,
            url: `http://localhost:${ports.dashboard}`,
        },
        coordination: {
            port: ports.coordination,
            wsUrl: `ws://localhost:${ports.coordination}/teamMembers`,
        },
        postgres: {
            port: ports.postgres,
            connectionString: `postgresql://specmem@localhost:${ports.postgres}/specmem`,
        },
        projectPath: ports.projectPath,
        verified: ports.verified,
    };
}
//# sourceMappingURL=portAllocator.js.map