import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Load config files - dotenv won't override existing env vars, so order matters
// First try specmem.env from various locations, then fall back to .env
const specmemEnvPaths = [
    path.resolve(process.cwd(), 'specmem.env'), // From current working directory
    path.resolve(__dirname, '../specmem.env'), // From project root (relative to src)
    path.resolve(__dirname, '../../specmem.env'), // From dist directory
];
// Load specmem.env from first location that exists
for (const envPath of specmemEnvPaths) {
    const result = dotenv.config({ path: envPath });
    if (!result.error) {
        break; // Found and loaded successfully
    }
}
// Also load .env if it exists (won't override specmem.env values)
dotenv.config();
// ============================================================================
// ATOMIC DIRECTORY CREATION - Task #17 fix for socket path duplication race
// This prevents race conditions when multiple MCP servers try to create
// the same socket directory simultaneously. Uses O_EXCL for true atomicity.
// ============================================================================
/**
 * Check if a process with the given PID is still running
 */
function isProcessRunningCheck(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e) {
        return e.code === 'EPERM';
    }
}
/**
 * Create a directory atomically using O_EXCL lock file
 * Prevents race conditions when multiple processes try to create the same directory
 *
 * @param dirPath - Directory path to create
 * @param mode - Directory permissions (default: 0o755)
 * @returns true if directory was created, false if it already existed
 */
function atomicMkdirSync(dirPath, mode = 0o755) {
    // Fast path: if directory already exists, return immediately
    if (fs.existsSync(dirPath)) {
        try {
            const stats = fs.statSync(dirPath);
            if (stats.isDirectory()) {
                return false;
            }
        }
        catch (e) {
            // Continue with creation attempt
        }
    }
    const lockPath = dirPath + '.mkdir.lock';
    const lockTimeoutMs = 5000;
    const maxRetries = 50;
    const retryIntervalMs = 10;
    // Try to acquire lock
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // O_EXCL ensures atomic creation - fails if file exists
            const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
            const lockData = JSON.stringify({ pid: process.pid, timestamp: Date.now() });
            fs.writeSync(fd, lockData);
            fs.closeSync(fd);
            try {
                // Double-check inside lock
                if (fs.existsSync(dirPath)) {
                    const stats = fs.statSync(dirPath);
                    if (stats.isDirectory()) {
                        return false;
                    }
                }
                // Create directory
                fs.mkdirSync(dirPath, { recursive: true, mode });
                return true;
            }
            finally {
                // Release lock
                try {
                    if (fs.existsSync(lockPath)) {
                        const content = fs.readFileSync(lockPath, 'utf-8');
                        const data = JSON.parse(content);
                        if (data.pid === process.pid) {
                            fs.unlinkSync(lockPath);
                        }
                    }
                }
                catch (e) {
                    // Ignore cleanup errors
                }
            }
        }
        catch (e) {
            if (e.code === 'EEXIST') {
                // Lock file exists - check if stale
                try {
                    const content = fs.readFileSync(lockPath, 'utf-8');
                    const data = JSON.parse(content);
                    const ageMs = Date.now() - data.timestamp;
                    if (ageMs > lockTimeoutMs || !isProcessRunningCheck(data.pid)) {
                        fs.unlinkSync(lockPath);
                        continue;
                    }
                }
                catch (readErr) {
                    try {
                        fs.unlinkSync(lockPath);
                        continue;
                    }
                    catch { /* ignore */ }
                }
                // Busy-wait
                const waitUntil = Date.now() + retryIntervalMs;
                while (Date.now() < waitUntil) { /* spin */ }
            }
            else {
                // For other errors, fall back to simple mkdir
                break;
            }
        }
    }
    // Fallback: just try mkdirSync (might race but won't crash)
    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true, mode });
            return true;
        }
    }
    catch (e) {
        // Ignore - another process likely created it
    }
    return false;
}
// Cache for loaded rc config per project
const rcConfigCache = new Map();
const RC_CACHE_TTL = 60000; // 1 minute
/**
 * Load .specmemrc from project root if it exists
 * Returns null if file doesn't exist or is invalid
 * Caches result per project path
 */
function loadSpecmemRc(projectPath) {
    const cached = rcConfigCache.get(projectPath);
    if (cached && Date.now() - cached.timestamp < RC_CACHE_TTL) {
        return cached.config;
    }
    const rcPath = path.join(projectPath, '.specmemrc');
    let rcConfig = null;
    try {
        if (fs.existsSync(rcPath)) {
            const content = fs.readFileSync(rcPath, 'utf-8');
            rcConfig = JSON.parse(content);
            console.error('[CONFIG] Loaded .specmemrc from ' + rcPath);
        }
    }
    catch (err) {
        console.error('[CONFIG] Failed to load .specmemrc: ' + (err instanceof Error ? err.message : String(err)));
        rcConfig = null;
    }
    rcConfigCache.set(projectPath, { config: rcConfig, timestamp: Date.now() });
    return rcConfig;
}
/**
 * Get value from rc config with dot notation path
 * e.g., getRcValue('database.port', 5432) returns rc.database.port or 5432
 */
function getRcValue(rcConfig, rcPath, defaultValue) {
    if (!rcConfig)
        return defaultValue;
    const parts = rcPath.split('.');
    let current = rcConfig;
    for (const part of parts) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return defaultValue;
        }
        current = current[part];
    }
    return (current !== undefined && current !== null) ? current : defaultValue;
}
/**
 * Clear rc config cache - useful for testing or when rc file changes
 */
export function clearRcConfigCache(projectPath) {
    if (projectPath) {
        rcConfigCache.delete(projectPath);
    }
    else {
        rcConfigCache.clear();
    }
}
/**
 * Get the current rc config for the project (useful for debugging)
 */
export function getSpecmemRcConfig() {
    const projectPath = process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
    return loadSpecmemRc(projectPath);
}
/**
 * Get the SpecMem root directory
 * This is the main entry point for all path resolution
 * Works whether running from src/, dist/, or installed via npm
 */
export function getSpecmemRoot() {
    // If SPECMEM_ROOT is set, use it
    if (process.env['SPECMEM_ROOT']) {
        return process.env['SPECMEM_ROOT'];
    }
    // Default to cwd - specmem should always be run from its root
    return process.cwd();
}
// ============================================================================
// PROJECT PATH UTILITIES - For multi-instance isolation
// These functions provide project-specific paths and identifiers
// SPECMEM_PROJECT_PATH is set by Claude Code via MCP config or defaults to cwd
// ============================================================================
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
export function getProjectPath() {
    // PRIORITY 2: Environment variable (static, set at startup)
    if (process.env['SPECMEM_PROJECT_PATH']) {
        return process.env['SPECMEM_PROJECT_PATH'];
    }
    // PRIORITY 3: Current working directory (fallback)
    return process.cwd();
}
/**
 * Get the project hash for instance isolation (COLLISION-FREE!)
 * Uses SHA256 hash of FULL project path to ensure different paths get different instances.
 * This prevents collisions between /specmem and ~/specmem.
 * Format: First 16 chars of hash (e.g., "a1b2c3d4e5f6a7b8")
 */
export function getProjectDirName() {
    // Check env var first (set by bootstrap.cjs)
    if (process.env['SPECMEM_PROJECT_DIR_NAME']) {
        return process.env['SPECMEM_PROJECT_DIR_NAME'];
    }
    // Compute hash from FULL project path
    const projectPath = getProjectPath();
    const normalizedPath = path.resolve(projectPath).toLowerCase().replace(/\\/g, '/');
    const fullHash = createHash('sha256').update(normalizedPath).digest('hex');
    return fullHash.substring(0, 16);
}
/**
 * DEPRECATED: Returns project hash
 * Kept for backwards compatibility - now returns the hash
 */
export function getProjectHash() {
    return getProjectDirName();
}
/**
 * DEPRECATED: Returns project hash
 * Kept for backwards compatibility - now returns the hash
 */
export function getProjectHashFull() {
    if (process.env['SPECMEM_PROJECT_DIR_NAME']) {
        return process.env['SPECMEM_PROJECT_DIR_NAME'];
    }
    // Fallback - compute hash
    return getProjectDirName();
}
/**
 * Get the per-instance directory for this project
 * ALWAYS uses PROJECT DIRECTORY for complete isolation
 * e.g. /home/user/myproject/specmem/ - NOT ~/.specmem/
 * User requirement: "EVERYTHING LOCALIZED WITHIN THE PROJECT"
 */
export function getInstanceDir() {
    // CRITICAL: Use project directory, NOT user home!
    // User explicitly required: "{PROJECT_DIR}/specmem/" for all data
    return path.join(getProjectPath(), 'specmem');
}
/**
 * Get project info as a structured object (for logging/debugging)
 */
export function getProjectInfo() {
    return {
        path: getProjectPath(),
        hash: getProjectHash(),
        hashFull: getProjectHashFull(),
        instanceDir: getInstanceDir(),
    };
}
/**
 * Get path to specmem's internal run directory (sockets, PIDs, etc)
 */
export function getRunDir() {
    return path.join(getSpecmemRoot(), 'run');
}
/**
 * Get the project-scoped socket directory
 * Pattern: {PROJECT_DIR}/specmem/sockets/ - FULLY LOCALIZED
 */
export function getProjectSocketDir() {
    return path.join(getInstanceDir(), 'sockets');
}
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
export function getEmbeddingSocketPath() {
    const isDebug = process.env['SPECMEM_DEBUG'] === 'true' || process.env['SPECMEM_DEBUG'] === '1';
    const debugLog = (msg) => {
        if (isDebug)
            console.error(`[Socket Debug] ${msg}`);
    };
    // Check explicit env var first - HIGHEST PRIORITY
    if (process.env['SPECMEM_EMBEDDING_SOCKET']) {
        const explicitPath = process.env['SPECMEM_EMBEDDING_SOCKET'];
        console.error(`[Socket] Using explicit SPECMEM_EMBEDDING_SOCKET: ${explicitPath}`);
        return explicitPath;
    }
    const { existsSync, lstatSync, readlinkSync } = fs;
    // Helper to check if path is an actual socket file (follows symlinks)
    const socketExists = (socketPath) => {
        try {
            // First check if path exists at all
            if (!existsSync(socketPath)) {
                debugLog(`Path does not exist: ${socketPath}`);
                return false;
            }
            // If it's a symlink, follow it and check the target
            const stats = lstatSync(socketPath);
            if (stats.isSymbolicLink()) {
                try {
                    const target = readlinkSync(socketPath);
                    const resolvedTarget = path.isAbsolute(target) ? target : path.resolve(path.dirname(socketPath), target);
                    debugLog(`Symlink ${socketPath} -> ${resolvedTarget}`);
                    const targetStats = lstatSync(resolvedTarget);
                    if (targetStats.isSocket()) {
                        debugLog(`Symlink target is a valid socket: ${resolvedTarget}`);
                        return true;
                    }
                    debugLog(`Symlink target exists but is not a socket: ${resolvedTarget}`);
                    return false;
                }
                catch (e) {
                    debugLog(`Symlink target check failed: ${e}`);
                    return false;
                }
            }
            // Direct socket file
            if (stats.isSocket()) {
                debugLog(`Direct socket found: ${socketPath}`);
                return true;
            }
            debugLog(`Path exists but is not a socket: ${socketPath}`);
            return false;
        }
        catch (e) {
            debugLog(`Socket check error for ${socketPath}: ${e}`);
            return false;
        }
    };
    // SPECMEM_HOME defaults to SpecMem installation directory, NOT ~/.claude
    // This is critical for multi-project support
    const specmemRoot = getSpecmemRoot();
    const specmemHome = process.env['SPECMEM_HOME'] || specmemRoot;
    // Get project identifiers
    const projectDirName = getProjectDirName();
    const projectHash = getProjectHash();
    // Build comprehensive list of socket locations to check (in priority order)
    // CRITICAL: PROJECT DIRECTORY is ALWAYS checked FIRST - user requirement
    // But we MUST fall back to /tmp/ paths where embedding service may create sockets
    const projectPath = getProjectPath();
    // Socket locations in priority order:
    // 1. Project directory (preferred for isolation)
    // 2. /tmp/ fallbacks (where embedding service may actually create them)
    const socketLocations = [
        // Priority 1: Project-local socket (ideal for isolation)
        {
            path: path.join(projectPath, 'specmem', 'sockets', 'embeddings.sock'),
            description: 'Project socket ({PROJECT}/specmem/sockets)',
            priority: '1-project-dir'
        },
        // Priority 2: /tmp/ with project hash (Docker mounts)
        {
            path: `/tmp/specmem-${projectDirName}/sockets/embeddings.sock`,
            description: '/tmp project-isolated Docker mount',
            priority: '2-tmp-project'
        },
        // Priority 3: SpecMem root run directory
        {
            path: path.join(specmemRoot, 'run', 'embeddings.sock'),
            description: 'SpecMem root/run',
            priority: '3-specmem-run'
        },
        {
            path: path.join(specmemRoot, 'run', 'sockets', 'embeddings.sock'),
            description: 'SpecMem root/run/sockets',
            priority: '4-specmem-run-sockets'
        },
        // Priority 5: Legacy /tmp/ locations (backwards compat)
        {
            path: '/tmp/specmem-embed-0.sock',
            description: '/tmp legacy embed socket',
            priority: '5-tmp-legacy'
        },
        {
            path: '/tmp/specmem-sockets/embeddings.sock',
            description: '/tmp legacy sockets dir',
            priority: '6-tmp-legacy-dir'
        },
        // Priority 7: Container internal path
        {
            path: '/sockets/embeddings.sock',
            description: 'Container internal path',
            priority: '7-container'
        },
    ];
    debugLog(`Searching for embedding socket...`);
    debugLog(`  specmemRoot: ${specmemRoot}`);
    debugLog(`  specmemHome: ${specmemHome}`);
    debugLog(`  projectDirName: ${projectDirName}`);
    debugLog(`  projectHash: ${projectHash}`);
    // Check each location and return the first one that has an active socket
    for (const loc of socketLocations) {
        debugLog(`Checking ${loc.priority}: ${loc.path}`);
        if (socketExists(loc.path)) {
            console.error(`[Socket] FOUND at: ${loc.path} (${loc.description})`);
            return loc.path;
        }
    }
    // DEFAULT: Return project directory socket path (where Docker should create it)
    // USER REQUIREMENT: "EVERYTHING LOCALIZED WITHIN THE PROJECT"
    // Pattern: {PROJECT_DIR}/specmem/sockets/embeddings.sock
    const projectSocketDir = path.join(projectPath, 'specmem', 'sockets');
    const defaultSocketPath = path.join(projectSocketDir, 'embeddings.sock');
    // Task #17 FIX: Use atomic mkdir to prevent race condition when multiple
    // MCP servers try to create the socket directory simultaneously
    try {
        const created = atomicMkdirSync(projectSocketDir, 0o755);
        if (created) {
            debugLog(`Created project socket directory atomically: ${projectSocketDir}`);
        }
    }
    catch (e) {
        // Ignore mkdir errors - directory may be created by Docker
        debugLog(`Failed to create socket directory: ${e}`);
    }
    // Log NOT FOUND with details for troubleshooting
    console.error(`[Socket] NOT FOUND - embedding socket not available`);
    console.error(`[Socket] Default path (will wait for socket): ${defaultSocketPath}`);
    if (isDebug) {
        console.error(`[Socket] Searched locations:`);
        for (const loc of socketLocations) {
            console.error(`[Socket]   [${loc.priority}] ${loc.path}`);
        }
        console.error(`[Socket] Set SPECMEM_EMBEDDING_SOCKET env var to override detection.`);
    }
    else {
        console.error(`[Socket] Set SPECMEM_DEBUG=true for detailed socket search info.`);
    }
    return defaultSocketPath;
}
/**
 * Get detailed socket search information for debugging
 * Returns socket search results with all checked locations
 *
 * Checks multiple locations in priority order:
 * 1. Project directory (preferred for isolation)
 * 2. /tmp/ fallbacks (where embedding service may create them)
 * 3. SpecMem root and legacy locations
 */
export function getSocketSearchInfo() {
    const specmemRoot = getSpecmemRoot();
    const specmemHome = process.env['SPECMEM_HOME'] || specmemRoot;
    const projectDirName = getProjectDirName();
    const projectHash = getProjectHash();
    const { existsSync, lstatSync, readlinkSync } = fs;
    const checkPath = (p) => {
        try {
            if (!existsSync(p))
                return { exists: false, isSocket: false, isSymlink: false };
            const stats = lstatSync(p);
            const isSymlink = stats.isSymbolicLink();
            let symlinkTarget;
            let isSocket = stats.isSocket();
            if (isSymlink) {
                try {
                    symlinkTarget = readlinkSync(p);
                    const resolvedTarget = path.isAbsolute(symlinkTarget) ? symlinkTarget : path.resolve(path.dirname(p), symlinkTarget);
                    const targetStats = lstatSync(resolvedTarget);
                    isSocket = targetStats.isSocket();
                }
                catch {
                    // Symlink target doesn't exist or is broken
                    isSocket = false;
                }
            }
            return { exists: true, isSocket, isSymlink, symlinkTarget };
        }
        catch {
            return { exists: false, isSocket: false, isSymlink: false };
        }
    };
    // Socket locations with fallbacks (matches getEmbeddingSocketPath)
    const projectPath = getProjectPath();
    const locations = [
        // Priority 1: Project-local socket (ideal for isolation)
        {
            path: path.join(projectPath, 'specmem', 'sockets', 'embeddings.sock'),
            description: 'Project socket ({PROJECT}/specmem/sockets)',
            priority: '1-project-dir'
        },
        // Priority 2: /tmp/ with project hash (Docker mounts)
        {
            path: `/tmp/specmem-${projectDirName}/sockets/embeddings.sock`,
            description: '/tmp project-isolated Docker mount',
            priority: '2-tmp-project'
        },
        // Priority 3: SpecMem root run directory
        {
            path: path.join(specmemRoot, 'run', 'embeddings.sock'),
            description: 'SpecMem root/run',
            priority: '3-specmem-run'
        },
        {
            path: path.join(specmemRoot, 'run', 'sockets', 'embeddings.sock'),
            description: 'SpecMem root/run/sockets',
            priority: '4-specmem-run-sockets'
        },
        // Priority 5: Legacy /tmp/ locations (backwards compat)
        {
            path: '/tmp/specmem-embed-0.sock',
            description: '/tmp legacy embed socket',
            priority: '5-tmp-legacy'
        },
        {
            path: '/tmp/specmem-sockets/embeddings.sock',
            description: '/tmp legacy sockets dir',
            priority: '6-tmp-legacy-dir'
        },
        // Priority 7: Container internal path
        {
            path: '/sockets/embeddings.sock',
            description: 'Container internal path',
            priority: '7-container'
        },
    ];
    const searchedLocations = locations.map(loc => {
        const status = checkPath(loc.path);
        return { ...loc, ...status };
    });
    const foundSocket = searchedLocations.find(loc => loc.isSocket)?.path || null;
    const isDocker = existsSync('/.dockerenv') || existsSync('/run/.containerenv');
    return {
        foundSocket,
        searchedLocations,
        projectDirName,
        projectHash,
        specmemRoot,
        specmemHome,
        isDocker,
    };
}
function requireEnv(key) {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}
function optionalEnv(key, defaultValue) {
    const value = process.env[key];
    // Empty strings treated as "not set" - use default
    // Fixes: SPECMEM_WATCHER_ENABLED="" should use default (true), not false
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    return value;
}
function parseBoolean(value, defaultValue = false) {
    // Empty string = use default (critical for env vars like SPECMEM_WATCHER_ENABLED="")
    if (!value || value === '') {
        return defaultValue;
    }
    const lower = value.toLowerCase();
    return lower === 'true' || value === '1';
}
/**
 * Parse port number with validation
 * Validates port is a valid number between 1-65535
 * Returns default if invalid or throws with context if throwOnInvalid=true
 */
function parsePort(value, defaultValue, envVarName, throwOnInvalid = false) {
    if (!value || value === '') {
        return defaultValue;
    }
    const port = parseInt(value, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
        const context = envVarName ? ' (' + envVarName + ')' : '';
        const errMsg = 'Invalid port "' + value + '"' + context + ': must be number 1-65535';
        if (throwOnInvalid) {
            throw new Error(errMsg);
        }
        console.error('[CONFIG] ' + errMsg + ', using default: ' + defaultValue);
        return defaultValue;
    }
    return port;
}
/**
 * Parse DATABASE_URL connection string into components
 * Format: postgres://user:password@host:port/database?sslmode=require
 *
 * Also supports:
 * - postgresql:// prefix (treated same as postgres://)
 * - URL-encoded special chars in password
 * - Optional sslmode query parameter
 *
 * Returns null if DATABASE_URL is not set or invalid
 */
function parseDatabaseUrl() {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
        return null;
    }
    try {
        // Handle both postgres:// and postgresql:// prefixes
        const normalizedUrl = databaseUrl.replace(/^postgresql:\/\//, 'postgres://');
        // Use URL constructor for robust parsing
        const url = new URL(normalizedUrl);
        if (url.protocol !== 'postgres:') {
            console.error('[CONFIG] DATABASE_URL has invalid protocol: ' + url.protocol);
            return null;
        }
        // Extract components with URL decoding for special chars in password
        const user = decodeURIComponent(url.username);
        const password = decodeURIComponent(url.password);
        const host = url.hostname;
        const port = url.port ? parsePort(url.port, 5432, 'DATABASE_URL port') : 5432;
        const database = url.pathname.replace(/^\//, ''); // Remove leading slash
        // Check for sslmode in query params
        const sslMode = url.searchParams.get('sslmode');
        const ssl = sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full';
        if (!user || !host || !database) {
            console.error('[CONFIG] DATABASE_URL missing required components (user, host, or database)');
            return null;
        }
        console.error('[CONFIG] Parsed DATABASE_URL: host=' + host + ' port=' + port + ' database=' + database + ' user=' + user + ' ssl=' + ssl);
        return { user, password, host, port, database, ssl };
    }
    catch (err) {
        console.error('[CONFIG] Failed to parse DATABASE_URL: ' + err.message);
        return null;
    }
}
// ============================================================================
// PORT ALLOCATION UTILITIES - Project directory name derived ports
// Uses SPECMEM_PROJECT_DIR_NAME to derive unique ports per project
// NO MORE HASHES - uses readable project directory name
// ============================================================================
/**
 * Get project-specific port from project directory name
 * Derives a unique port in a given range based on project name
 * @param basePort - The base port for the range (e.g., 8500)
 * @param rangeSize - The size of the port range (e.g., 100 gives 8500-8599)
 * @returns Port number derived from project directory name
 */
function getProjectPortFromHash(basePort, rangeSize = 100) {
    // Use project directory name instead of hash
    const projectDirName = process.env['SPECMEM_PROJECT_DIR_NAME'] || getProjectDirName();
    // Simple hash from string to number
    let hashNum = 0;
    for (let i = 0; i < projectDirName.length; i++) {
        hashNum = ((hashNum << 5) - hashNum) + projectDirName.charCodeAt(i);
        hashNum = hashNum & 0xFFFF; // Keep it in range
    }
    return basePort + (Math.abs(hashNum) % rangeSize);
}
// ============================================================================
// UNIFIED CREDENTIALS: ZERO CONFIG REQUIRED
// Everything derives from SPECMEM_PASSWORD or uses smart defaults
// Per-project isolation via project directory name for database names and ports
// NO MORE HASHES - uses readable project directory name everywhere
// ============================================================================
const UNIFIED_DEFAULT = 'specmem';
function getUnifiedCredential() {
    return process.env['SPECMEM_PASSWORD'] || UNIFIED_DEFAULT;
}
/**
 * Get project-specific database name
 * Uses SPECMEM_PROJECT_DIR_NAME for per-project isolation
 * Format: specmem_{projectname} or custom via SPECMEM_DB_NAME
 *
 * @returns Database name in format specmem_{project_dir_name}
 */
export function getProjectDatabaseName() {
    // Explicit override takes precedence
    if (process.env['SPECMEM_DB_NAME']) {
        return process.env['SPECMEM_DB_NAME'];
    }
    // Per-project database using readable project directory name
    const projectDirName = process.env['SPECMEM_PROJECT_DIR_NAME'] || getProjectDirName();
    // Sanitize for PostgreSQL (max 63 chars, alphanumeric + underscore)
    const sanitized = projectDirName.replace(/[^a-z0-9]/g, '_').substring(0, 50);
    return `specmem_${sanitized}`;
}
/**
 * Get project-specific database port
 * Uses project directory name to derive unique port in range 5500-5599
 * Falls back to SPECMEM_DB_PORT or default 5432
 *
 * @returns Port number for project-scoped database
 */
export function getProjectDatabasePort() {
    // Explicit override takes precedence
    if (process.env['SPECMEM_DB_PORT']) {
        return parsePort(process.env['SPECMEM_DB_PORT'], 5432, 'SPECMEM_DB_PORT');
    }
    // For embedded postgres, derive port from project directory name
    if (process.env['SPECMEM_EMBEDDED_PG_ACTIVE'] === 'true') {
        const projectDirName = process.env['SPECMEM_PROJECT_DIR_NAME'] || getProjectDirName();
        // Simple hash from string to number for port allocation
        let hashNum = 0;
        for (let i = 0; i < projectDirName.length; i++) {
            hashNum = ((hashNum << 5) - hashNum) + projectDirName.charCodeAt(i);
            hashNum = hashNum & 0xFFFF;
        }
        return 5500 + (Math.abs(hashNum) % 100);
    }
    return 5432;
}
export function loadConfig() {
    const cred = getUnifiedCredential();
    const projectDbName = getProjectDatabaseName();
    const projectDbPort = getProjectDatabasePort();
    // Load .specmemrc if it exists - provides project-specific overrides
    const projectPath = getProjectPath();
    const rc = loadSpecmemRc(projectPath);
    // DATABASE_URL takes priority if set - parse it and use those values
    const parsedUrl = parseDatabaseUrl();
    // Priority: DATABASE_URL > ENV VAR > .specmemrc > default
    // Per-project isolation still applies if DATABASE_URL not set
    const dbHost = parsedUrl?.host || process.env['SPECMEM_DB_HOST'] || getRcValue(rc, 'database.host', 'localhost');
    const dbPort = parsedUrl?.port || projectDbPort;
    const dbName = parsedUrl?.database || projectDbName;
    const dbUser = parsedUrl?.user || process.env['SPECMEM_DB_USER'] || getRcValue(rc, 'database.user', cred);
    const dbPassword = parsedUrl?.password || process.env['SPECMEM_DB_PASSWORD'] || getRcValue(rc, 'database.password', cred);
    const dbSsl = parsedUrl?.ssl;
    return {
        database: {
            host: dbHost,
            port: dbPort,
            database: dbName,
            user: dbUser,
            password: dbPassword,
            maxConnections: 20,
            idleTimeout: 30000,
            connectionTimeout: 5000,
            ssl: dbSsl
        },
        embedding: {
            // DEPRECATED: dimensions is now auto-detected from the database pgvector column
            // This config value is IGNORED - the system queries pg_attribute for actual dimension
            // Kept for backwards compatibility but will be removed in future versions
            // dimensions: parseInt(optionalEnv('SPECMEM_EMBEDDING_DIMENSIONS', '1536'), 10),
            model: process.env['SPECMEM_EMBEDDING_MODEL'] || getRcValue(rc, 'embedding.model', 'text-embedding-3-small'),
            batchSize: process.env['SPECMEM_EMBEDDING_BATCH_SIZE'] ? parseInt(process.env['SPECMEM_EMBEDDING_BATCH_SIZE'], 10) : getRcValue(rc, 'embedding.batchSize', 100),
            // Docker container CPU limit (in cores, e.g., 1.0 = 1 core, 0.5 = half core)
            cpuLimit: process.env['SPECMEM_EMBEDDING_CPU_LIMIT'] ? parseFloat(process.env['SPECMEM_EMBEDDING_CPU_LIMIT']) : getRcValue(rc, 'embedding.cpuLimit', 1.0)
        },
        consolidation: {
            autoEnabled: parseBoolean(optionalEnv('SPECMEM_AUTO_CONSOLIDATION', 'false')),
            intervalMinutes: parseInt(optionalEnv('SPECMEM_CONSOLIDATION_INTERVAL', '60'), 10),
            minMemoriesForConsolidation: parseInt(optionalEnv('SPECMEM_MIN_MEMORIES_CONSOLIDATION', '5'), 10),
            similarityQueryLimit: parseInt(optionalEnv('SPECMEM_CONSOLIDATION_SIMILARITY_LIMIT', '1000'), 10),
            temporalQueryLimit: parseInt(optionalEnv('SPECMEM_CONSOLIDATION_TEMPORAL_LIMIT', '500'), 10),
            tagBasedQueryLimit: parseInt(optionalEnv('SPECMEM_CONSOLIDATION_TAG_LIMIT', '50'), 10),
            importanceQueryLimit: parseInt(optionalEnv('SPECMEM_CONSOLIDATION_IMPORTANCE_LIMIT', '200'), 10)
        },
        storage: {
            maxImageSizeBytes: parseInt(optionalEnv('SPECMEM_MAX_IMAGE_SIZE', '10485760'), 10),
            allowedImageTypes: optionalEnv('SPECMEM_ALLOWED_IMAGE_TYPES', 'image/png,image/jpeg,image/webp,image/gif').split(',')
        },
        logging: {
            level: (process.env['SPECMEM_LOG_LEVEL'] || getRcValue(rc, 'logging.level', 'info')),
            prettyPrint: process.env['SPECMEM_LOG_PRETTY'] ? parseBoolean(process.env['SPECMEM_LOG_PRETTY']) : getRcValue(rc, 'logging.prettyPrint', false)
        },
        // File watcher - ENABLED BY DEFAULT for live codebase updates
        // CRITICAL: Always an object (never undefined) - use enabled: boolean to control
        // Project path is DYNAMIC - uses getProjectPath() which reads SPECMEM_PROJECT_PATH
        watcher: {
            enabled: process.env['SPECMEM_WATCHER_ENABLED'] ? parseBoolean(process.env['SPECMEM_WATCHER_ENABLED']) : getRcValue(rc, 'watcher.enabled', true),
            rootPath: getProjectPath(), // DYNAMIC: Uses env var or cwd, re-evaluated per call
            ignorePath: process.env['SPECMEM_WATCHER_IGNORE_PATH'],
            debounceMs: process.env['SPECMEM_WATCHER_DEBOUNCE_MS'] ? parseInt(process.env['SPECMEM_WATCHER_DEBOUNCE_MS'], 10) : getRcValue(rc, 'watcher.debounceMs', 1000),
            autoRestart: parseBoolean(optionalEnv('SPECMEM_WATCHER_AUTO_RESTART', 'true')),
            maxRestarts: parseInt(optionalEnv('SPECMEM_WATCHER_MAX_RESTARTS', '5'), 10),
            maxFileSizeBytes: process.env['SPECMEM_WATCHER_MAX_FILE_SIZE'] ? parseInt(process.env['SPECMEM_WATCHER_MAX_FILE_SIZE'], 10) : getRcValue(rc, 'watcher.maxFileSizeBytes', 1048576),
            autoDetectMetadata: parseBoolean(optionalEnv('SPECMEM_WATCHER_AUTO_DETECT_METADATA', 'true')),
            queueMaxSize: parseInt(optionalEnv('SPECMEM_WATCHER_QUEUE_MAX_SIZE', '10000'), 10),
            queueBatchSize: parseInt(optionalEnv('SPECMEM_WATCHER_QUEUE_BATCH_SIZE', '50'), 10),
            queueProcessingIntervalMs: parseInt(optionalEnv('SPECMEM_WATCHER_QUEUE_INTERVAL_MS', '2000'), 10),
            syncCheckIntervalMinutes: parseInt(optionalEnv('SPECMEM_WATCHER_SYNC_CHECK_INTERVAL', '60'), 10)
        },
        // Session watcher - ENABLED BY DEFAULT for live chat history updates
        // CRITICAL: Always an object (never undefined) - use enabled: boolean to control
        sessionWatcher: {
            enabled: process.env['SPECMEM_SESSION_WATCHER_ENABLED'] ? parseBoolean(process.env['SPECMEM_SESSION_WATCHER_ENABLED']) : getRcValue(rc, 'sessionWatcher.enabled', true),
            claudeDir: process.env['SPECMEM_SESSION_CLAUDE_DIR'],
            debounceMs: process.env['SPECMEM_SESSION_DEBOUNCE_MS'] ? parseInt(process.env['SPECMEM_SESSION_DEBOUNCE_MS'], 10) : getRcValue(rc, 'sessionWatcher.debounceMs', 2000),
            importance: (process.env['SPECMEM_SESSION_IMPORTANCE'] || getRcValue(rc, 'sessionWatcher.importance', 'medium')),
            additionalTags: process.env['SPECMEM_SESSION_TAGS'] ? process.env['SPECMEM_SESSION_TAGS'].split(',').filter(t => t.trim()) : getRcValue(rc, 'sessionWatcher.additionalTags', [])
        },
        // Chinese Compactor - token efficiency through Traditional Chinese compression
        // Enabled by default for ~3.5x token savings on verbose outputs
        compression: {
            enabled: process.env['SPECMEM_COMPRESSION_ENABLED'] ? parseBoolean(process.env['SPECMEM_COMPRESSION_ENABLED']) : getRcValue(rc, 'compression.enabled', true),
            minLength: process.env['SPECMEM_COMPRESSION_MIN_LENGTH'] ? parseInt(process.env['SPECMEM_COMPRESSION_MIN_LENGTH'], 10) : getRcValue(rc, 'compression.minLength', 50),
            threshold: process.env['SPECMEM_COMPRESSION_THRESHOLD'] ? parseFloat(process.env['SPECMEM_COMPRESSION_THRESHOLD']) : getRcValue(rc, 'compression.threshold', 0.80),
            compressSearchResults: parseBoolean(optionalEnv('SPECMEM_COMPRESS_SEARCH', 'true')),
            compressSystemOutput: parseBoolean(optionalEnv('SPECMEM_COMPRESS_SYSTEM', 'true')),
            compressHookOutput: parseBoolean(optionalEnv('SPECMEM_COMPRESS_HOOKS', 'true'))
        }
    };
}
/**
 * Validate configuration at startup - fail fast if something is wrong fr fr
 */
function validateConfig(cfg) {
    const errors = [];
    // Database validation
    if (cfg.database.port < 1 || cfg.database.port > 65535) {
        errors.push(`Invalid database port: ${cfg.database.port}`);
    }
    if (cfg.database.maxConnections < 1 || cfg.database.maxConnections > 1000) {
        errors.push(`Invalid maxConnections: ${cfg.database.maxConnections} (must be 1-1000)`);
    }
    // Embedding validation - dimensions are now auto-detected from database
    // DEPRECATED: This validation is no longer needed as dimensions come from pgvector column
    // if (cfg.embedding.dimensions < 1 || cfg.embedding.dimensions > 10000) {
    //   errors.push(`Invalid embedding dimensions: ${cfg.embedding.dimensions}`);
    // }
    // Logging validation
    const validLogLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
    if (!validLogLevels.includes(cfg.logging.level)) {
        errors.push(`Invalid log level: ${cfg.logging.level} (must be one of: ${validLogLevels.join(', ')})`);
    }
    // Watcher validation (if enabled)
    if (cfg.watcher) {
        if (cfg.watcher.debounceMs < 0) {
            errors.push(`Invalid watcher debounce: ${cfg.watcher.debounceMs}ms`);
        }
        if (cfg.watcher.maxFileSizeBytes < 1024) {
            errors.push(`Invalid watcher maxFileSize: ${cfg.watcher.maxFileSizeBytes} (min 1024 bytes)`);
        }
    }
    // Log validation results
    if (errors.length > 0) {
        const logger = console; // Can't use pino here since config isn't loaded yet
        logger.error('=== CONFIG VALIDATION FAILED fr fr ===');
        for (const error of errors) {
            logger.error(`  - ${error}`);
        }
        logger.error('Fix these issues and restart bruh');
        process.exit(1);
    }
}
const configCache = new Map();
const CACHE_TTL = 60000; // 1 minute
/**
 * Get config - returns cached if same project and not expired, reloads otherwise
 * This prevents cross-project pollution while maintaining performance
 * Cache is keyed by project path for true multi-project isolation
 */
export function getConfig() {
    const projectPath = getProjectPath();
    const cached = configCache.get(projectPath);
    // Return cached if not expired
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.config;
    }
    // Load fresh config for new project or expired cache
    const config = loadConfig();
    validateConfig(config);
    // Cache with timestamp
    configCache.set(projectPath, { config, timestamp: Date.now() });
    return config;
}
/**
 * Force config reload - use when env vars change
 * Clears cache for current project or all projects
 */
export function reloadConfig(projectPath) {
    if (projectPath) {
        configCache.delete(projectPath);
    }
    else {
        // Clear current project's cache
        const currentProject = getProjectPath();
        configCache.delete(currentProject);
    }
    return getConfig();
}
/**
 * Clear the config cache - useful for testing
 * @param projectPath - Optional project path to clear specific cache, or clear all if not specified
 */
export function clearConfigCache(projectPath) {
    if (projectPath) {
        configCache.delete(projectPath);
    }
    else {
        configCache.clear();
    }
}
/**
 * Invalidate config cache for a specific project
 * Used when project context changes or env vars are updated
 */
export function invalidateConfigCache(projectPath) {
    clearConfigCache(projectPath);
}
// BACKWARDS COMPAT: Keep 'config' export but make it call getConfig()
// This is a Proxy that evaluates lazily on each property access
// Ensures all existing imports like `import { config } from './config.js'` continue to work
export const config = new Proxy({}, {
    get(_, prop) {
        return getConfig()[prop];
    },
    // Support spread operator and Object.keys
    ownKeys() {
        return Reflect.ownKeys(getConfig());
    },
    getOwnPropertyDescriptor(_, prop) {
        const cfg = getConfig();
        if (prop in cfg) {
            return {
                value: cfg[prop],
                writable: false,
                enumerable: true,
                configurable: true
            };
        }
        return undefined;
    },
    has(_, prop) {
        return prop in getConfig();
    }
});
export function loadSkillsConfig() {
    // Load rc config for skills settings
    const projectPath = getProjectPath();
    const rc = loadSpecmemRc(projectPath);
    // Default skills path relative to current working directory or use __dirname fallback
    const defaultSkillsPath = (typeof __dirname !== 'undefined' ? `${__dirname}/../skills` : './skills');
    return {
        enabled: process.env['SPECMEM_SKILLS_ENABLED'] ? parseBoolean(process.env['SPECMEM_SKILLS_ENABLED']) : getRcValue(rc, 'skills.enabled', true),
        skillsPath: process.env['SPECMEM_SKILLS_PATH'] || getRcValue(rc, 'skills.skillsPath', defaultSkillsPath),
        autoReload: parseBoolean(optionalEnv('SPECMEM_SKILLS_AUTO_RELOAD', 'true'))
    };
}
export function loadCodebaseConfig() {
    // Load rc config for codebase settings
    const projectPath = getProjectPath();
    const rc = loadSpecmemRc(projectPath);
    const defaultExcludes = [
        'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
        '__pycache__', '.pytest_cache', '.mypy_cache', 'venv', '.venv',
        '*.pyc', '*.pyo', '*.log', 'package-lock.json', 'yarn.lock'
    ];
    // Priority: ENV > .specmemrc > defaults
    const envExcludes = process.env['SPECMEM_CODEBASE_EXCLUDE_PATTERNS'];
    const excludePatterns = envExcludes
        ? envExcludes.split(',').map(p => p.trim())
        : getRcValue(rc, 'codebase.excludePatterns', defaultExcludes);
    // Default codebase path to project path (set by bootstrap.cjs)
    const defaultCodebasePath = process.env['SPECMEM_CODEBASE_PATH'] || process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
    return {
        enabled: process.env['SPECMEM_CODEBASE_ENABLED'] ? parseBoolean(process.env['SPECMEM_CODEBASE_ENABLED']) : getRcValue(rc, 'codebase.enabled', true),
        codebasePath: optionalEnv('SPECMEM_CODEBASE_PATH', defaultCodebasePath),
        excludePatterns,
        watchForChanges: parseBoolean(optionalEnv('SPECMEM_CODEBASE_WATCH', 'true'))
    };
}
export function loadCoordinationConfig() {
    // Use project-hash-derived port: base 8600, range 100 (8600-8699)
    const defaultPort = String(getProjectPortFromHash(8600, 100));
    return {
        enabled: parseBoolean(optionalEnv('SPECMEM_COORDINATION_ENABLED', 'false')),
        port: parsePort(optionalEnv('SPECMEM_COORDINATION_PORT', defaultPort), parseInt(defaultPort, 10), 'SPECMEM_COORDINATION_PORT'),
        host: optionalEnv('SPECMEM_COORDINATION_HOST', '127.0.0.1')
    };
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
export function loadDashboardConfig() {
    // Load rc config for dashboard settings
    const projectPath = getProjectPath();
    const rc = loadSpecmemRc(projectPath);
    // Priority: ENV > .specmemrc > default
    const mode = (process.env['SPECMEM_DASHBOARD_MODE'] || getRcValue(rc, 'dashboard.mode', 'private'));
    // Validate mode
    if (mode !== 'private' && mode !== 'public') {
        console.warn('Invalid SPECMEM_DASHBOARD_MODE: "' + mode + '", defaulting to "private"');
    }
    const validMode = (mode === 'public') ? 'public' : 'private';
    // In private mode, always use localhost regardless of SPECMEM_DASHBOARD_HOST
    // In public mode, use configured host (default 0.0.0.0 for all interfaces)
    const configuredHost = optionalEnv('SPECMEM_DASHBOARD_HOST', '0.0.0.0');
    const effectiveHost = validMode === 'private' ? '127.0.0.1' : configuredHost;
    // Use project-hash-derived port: base 8500, range 100 (8500-8599)
    const defaultPort = getProjectPortFromHash(8500, 100);
    const rcPort = getRcValue(rc, 'dashboard.port', defaultPort);
    return {
        enabled: process.env['SPECMEM_DASHBOARD_ENABLED'] ? parseBoolean(process.env['SPECMEM_DASHBOARD_ENABLED']) : getRcValue(rc, 'dashboard.enabled', true),
        port: process.env['SPECMEM_DASHBOARD_PORT'] ? parsePort(process.env['SPECMEM_DASHBOARD_PORT'], rcPort, 'SPECMEM_DASHBOARD_PORT') : rcPort,
        host: effectiveHost,
        mode: validMode
    };
}
/**
 * Get current port configuration
 * Uses SPECMEM_PROJECT_HASH for per-project port isolation
 * Reads from environment or derives from project hash
 * For async allocation with conflict detection, use getInstancePorts from portAllocator
 */
export function getPortConfig() {
    // Dashboard port: base 8500, range 100 (8500-8599)
    const dashboardPort = process.env['SPECMEM_DASHBOARD_PORT']
        ? parsePort(process.env['SPECMEM_DASHBOARD_PORT'], getProjectPortFromHash(8500, 100), 'SPECMEM_DASHBOARD_PORT')
        : getProjectPortFromHash(8500, 100);
    // Coordination port: base 8600, range 100 (8600-8699)
    const coordinationPort = process.env['SPECMEM_COORDINATION_PORT']
        ? parsePort(process.env['SPECMEM_COORDINATION_PORT'], getProjectPortFromHash(8600, 100), 'SPECMEM_COORDINATION_PORT')
        : getProjectPortFromHash(8600, 100);
    return {
        dashboard: dashboardPort,
        coordination: coordinationPort,
        dynamicAllocation: !process.env['SPECMEM_DASHBOARD_PORT'] && !process.env['SPECMEM_COORDINATION_PORT'],
        projectPath: process.env['SPECMEM_PROJECT_PATH'] || process.cwd()
    };
}
export function loadCompressionConfig() {
    return {
        enabled: parseBoolean(optionalEnv('SPECMEM_COMPRESSION_ENABLED', 'true')),
        minLength: parseInt(optionalEnv('SPECMEM_COMPRESSION_MIN_LENGTH', '50'), 10),
        threshold: parseFloat(optionalEnv('SPECMEM_COMPRESSION_THRESHOLD', '0.80')),
        compressSearchResults: parseBoolean(optionalEnv('SPECMEM_COMPRESS_SEARCH', 'true')),
        compressSystemOutput: parseBoolean(optionalEnv('SPECMEM_COMPRESS_SYSTEM', 'true')),
        compressHookOutput: parseBoolean(optionalEnv('SPECMEM_COMPRESS_HOOKS', 'true'))
    };
}
/**
 * Get the compression config from the main config
 * Provides safe access with defaults if not set
 */
export function getCompressionConfig() {
    return config.compression ?? loadCompressionConfig();
}
/**
 * Load embedded PostgreSQL configuration
 * Uses SPECMEM_PROJECT_DIR_NAME for per-project isolation
 * NO MORE HASHES - uses readable project directory name
 */
export function loadEmbeddedPostgresConfig() {
    const projectPath = process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
    const projectDirName = process.env['SPECMEM_PROJECT_DIR_NAME'] || getProjectDirName();
    // Project-specific database name: specmem_{project_dir_name}
    const sanitized = projectDirName.replace(/[^a-z0-9]/g, '_').substring(0, 50);
    const defaultDbName = `specmem_${sanitized}`;
    // Project-specific port derived from directory name (range 5500-5599)
    let hashNum = 0;
    for (let i = 0; i < projectDirName.length; i++) {
        hashNum = ((hashNum << 5) - hashNum) + projectDirName.charCodeAt(i);
        hashNum = hashNum & 0xFFFF;
    }
    const defaultPort = 5500 + (Math.abs(hashNum) % 100);
    return {
        enabled: parseBoolean(optionalEnv('SPECMEM_EMBEDDED_PG_ENABLED', 'true')),
        projectPath,
        port: process.env['SPECMEM_EMBEDDED_PG_PORT']
            ? parsePort(process.env['SPECMEM_EMBEDDED_PG_PORT'], defaultPort, 'SPECMEM_EMBEDDED_PG_PORT')
            : defaultPort,
        database: optionalEnv('SPECMEM_DB_NAME', defaultDbName),
        user: optionalEnv('SPECMEM_DB_USER', 'specmem_westayunprofessional'),
        password: process.env['SPECMEM_EMBEDDED_PG_PASSWORD'] || undefined,
        autoStart: parseBoolean(optionalEnv('SPECMEM_EMBEDDED_PG_AUTOSTART', 'true')),
        autoStop: parseBoolean(optionalEnv('SPECMEM_EMBEDDED_PG_AUTOSTOP', 'true')),
        portRangeStart: parsePort(optionalEnv('SPECMEM_EMBEDDED_PG_PORT_START', '5500'), 5500, 'SPECMEM_EMBEDDED_PG_PORT_START'),
        portRangeEnd: parsePort(optionalEnv('SPECMEM_EMBEDDED_PG_PORT_END', '5600'), 5600, 'SPECMEM_EMBEDDED_PG_PORT_END'),
    };
}
/**
 * Check if embedded PostgreSQL is active
 * Returns true if:
 * 1. Embedded mode is enabled
 * 2. SPECMEM_EMBEDDED_PG_ACTIVE env var is set (set by bootstrap.cjs)
 */
export function isEmbeddedPostgresActive() {
    return parseBoolean(optionalEnv('SPECMEM_EMBEDDED_PG_ACTIVE', 'false'));
}
/**
 * Get the embedded PostgreSQL data directory path
 */
export function getEmbeddedPostgresDataDir(projectPath) {
    const basePath = projectPath || process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
    return path.join(basePath, '.specmem', 'pgdata');
}
//# sourceMappingURL=config.js.map