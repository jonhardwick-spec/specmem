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
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as net from 'net';
import { logger } from '../utils/logger.js';
// Directory structure
const SPECMEM_LOCAL_DIR = '.specmem';
const PGDATA_DIR = 'pgdata';
const PG_LOG_FILE = 'postgresql.log';
const PG_STATE_FILE = 'pg-state.json';
// Port range for embedded PostgreSQL instances (avoid common ports)
const PG_PORT_BASE = 54320;
const PG_PORT_RANGE = 1000; // Ports 54320-55319
// Default database and user for SpecMem (unified password pattern)
const DEFAULT_DATABASE = process.env['SPECMEM_DB_NAME'] || process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional';
const DEFAULT_USER = process.env['SPECMEM_DB_USER'] || process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional';
const DEFAULT_PASSWORD = process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional';
// Timeout settings
const STARTUP_TIMEOUT_MS = 30000; // 30 seconds for PostgreSQL to start
const SHUTDOWN_TIMEOUT_MS = 10000; // 10 seconds for graceful shutdown
const CONNECTION_RETRY_DELAY_MS = 500;
const MAX_CONNECTION_RETRIES = 60; // 30 seconds total
/**
 * Check if a command exists in PATH
 */
function commandExists(cmd) {
    try {
        execSync(`which ${cmd}`, { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Find PostgreSQL binaries - checks common locations
 */
function findPostgresBinaries() {
    // Common PostgreSQL binary locations
    const searchPaths = [
        '/usr/lib/postgresql/16/bin',
        '/usr/lib/postgresql/15/bin',
        '/usr/lib/postgresql/14/bin',
        '/usr/lib/postgresql/13/bin',
        '/usr/pgsql-16/bin',
        '/usr/pgsql-15/bin',
        '/usr/pgsql-14/bin',
        '/opt/homebrew/opt/postgresql@16/bin',
        '/opt/homebrew/opt/postgresql@15/bin',
        '/opt/homebrew/opt/postgresql@14/bin',
        '/usr/local/opt/postgresql@16/bin',
        '/usr/local/opt/postgresql@15/bin',
        '/usr/local/opt/postgresql@14/bin',
        '/usr/local/bin',
        '/usr/bin',
    ];
    // Check PATH first
    if (commandExists('initdb') && commandExists('pg_ctl')) {
        return {
            initdb: 'initdb',
            pg_ctl: 'pg_ctl',
            psql: 'psql',
            createdb: 'createdb',
            createuser: 'createuser',
        };
    }
    // Check common locations
    for (const basePath of searchPaths) {
        const initdb = path.join(basePath, 'initdb');
        const pg_ctl = path.join(basePath, 'pg_ctl');
        const psql = path.join(basePath, 'psql');
        const createdb = path.join(basePath, 'createdb');
        const createuser = path.join(basePath, 'createuser');
        // Use try/catch to avoid race conditions with existsSync
        try {
            fs.accessSync(initdb, fs.constants.X_OK);
            fs.accessSync(pg_ctl, fs.constants.X_OK);
            return { initdb, pg_ctl, psql, createdb, createuser };
        }
        catch {
            // Binary not found or not executable, continue searching
        }
    }
    return null;
}
/**
 * Generate a deterministic port from project path
 */
function calculatePortFromPath(projectPath) {
    const hash = crypto
        .createHash('sha256')
        .update(path.resolve(projectPath))
        .digest('hex');
    // Use first 4 chars of hash to generate port offset
    const offset = parseInt(hash.substring(0, 4), 16) % PG_PORT_RANGE;
    return PG_PORT_BASE + offset;
}
/**
 * Check if a port is available
 */
async function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => {
            resolve(false);
        });
        server.once('listening', () => {
            server.close(() => {
                resolve(true);
            });
        });
        server.listen(port, '127.0.0.1');
    });
}
/**
 * Find an available port starting from the calculated port
 */
async function findAvailablePort(startPort) {
    for (let offset = 0; offset < PG_PORT_RANGE; offset++) {
        const port = PG_PORT_BASE + ((startPort - PG_PORT_BASE + offset) % PG_PORT_RANGE);
        if (await isPortAvailable(port)) {
            return port;
        }
    }
    throw new Error(`No available ports in range ${PG_PORT_BASE}-${PG_PORT_BASE + PG_PORT_RANGE - 1}`);
}
/**
 * Wait for PostgreSQL to accept connections
 */
async function waitForPostgres(port, psqlPath, user, database, maxRetries = MAX_CONNECTION_RETRIES) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            // Try to connect using psql
            execSync(`${psqlPath} -h 127.0.0.1 -p ${port} -U ${user} -d ${database} -c "SELECT 1"`, { stdio: 'ignore', timeout: 5000 });
            return true;
        }
        catch {
            await new Promise((resolve) => setTimeout(resolve, CONNECTION_RETRY_DELAY_MS));
        }
    }
    return false;
}
/**
 * Embedded PostgreSQL Manager
 *
 * Manages a per-project PostgreSQL instance with automatic lifecycle management.
 */
export class EmbeddedPostgresManager {
    config;
    state = null;
    binaries = null;
    pgProcess = null;
    shutdownInProgress = false;
    constructor(config) {
        this.config = {
            projectPath: path.resolve(config.projectPath),
            port: config.port ?? calculatePortFromPath(config.projectPath),
            database: config.database ?? DEFAULT_DATABASE,
            user: config.user ?? DEFAULT_USER,
            password: config.password ?? DEFAULT_PASSWORD,
            autoStart: config.autoStart ?? true,
        };
    }
    /**
     * Get the .specmem directory path
     */
    get specmemDir() {
        return path.join(this.config.projectPath, SPECMEM_LOCAL_DIR);
    }
    /**
     * Get the PostgreSQL data directory path
     */
    get dataDir() {
        return path.join(this.specmemDir, PGDATA_DIR);
    }
    /**
     * Get the PostgreSQL log file path
     */
    get logFile() {
        return path.join(this.specmemDir, PG_LOG_FILE);
    }
    /**
     * Get the state file path
     */
    get stateFile() {
        return path.join(this.specmemDir, PG_STATE_FILE);
    }
    /**
     * Get the project hash for identification
     */
    get projectHash() {
        return crypto
            .createHash('sha256')
            .update(this.config.projectPath)
            .digest('hex')
            .substring(0, 12);
    }
    /**
     * Ensure .specmem directory exists
     */
    ensureSpecmemDir() {
        // Use recursive: true which is idempotent - no need to check existence first
        try {
            fs.mkdirSync(this.specmemDir, { recursive: true, mode: 0o755 });
        }
        catch (err) {
            // Only throw if it's not an "already exists" error
            if (err.code !== 'EEXIST') {
                throw err;
            }
        }
        // Add to .gitignore - use try/catch instead of existsSync
        const gitignorePath = path.join(this.config.projectPath, '.gitignore');
        try {
            const content = fs.readFileSync(gitignorePath, 'utf-8');
            if (!content.includes(SPECMEM_LOCAL_DIR)) {
                fs.appendFileSync(gitignorePath, `\n# SpecMem local instance\n${SPECMEM_LOCAL_DIR}/\n`);
            }
        }
        catch (err) {
            // ENOENT means .gitignore doesn't exist - that's fine
            if (err.code !== 'ENOENT') {
                logger.warn({ err }, 'Error updating .gitignore');
            }
        }
    }
    /**
     * Load state from file
     */
    loadState() {
        try {
            // Read directly - handle ENOENT instead of pre-checking with existsSync
            const content = fs.readFileSync(this.stateFile, 'utf-8');
            return JSON.parse(content);
        }
        catch (err) {
            // ENOENT is expected if state file doesn't exist yet
            if (err.code !== 'ENOENT') {
                logger.warn({ err }, 'Failed to load embedded PostgreSQL state');
            }
        }
        return null;
    }
    /**
     * Save state to file
     */
    saveState(state) {
        try {
            this.ensureSpecmemDir();
            fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), { mode: 0o644 });
            this.state = state;
        }
        catch (err) {
            logger.error({ err }, 'Failed to save embedded PostgreSQL state');
        }
    }
    /**
     * Check if PostgreSQL binaries are available
     */
    async checkPrerequisites() {
        this.binaries = findPostgresBinaries();
        if (!this.binaries) {
            return {
                available: false,
                error: 'PostgreSQL binaries not found. Please install PostgreSQL:\n' +
                    '  Ubuntu/Debian: sudo apt-get install postgresql postgresql-contrib\n' +
                    '  macOS: brew install postgresql\n' +
                    '  Fedora/RHEL: sudo dnf install postgresql-server postgresql-contrib',
            };
        }
        return { available: true };
    }
    /**
     * Check if PostgreSQL is already initialized
     */
    isInitialized() {
        const pgVersionFile = path.join(this.dataDir, 'PG_VERSION');
        // Use try/catch with accessSync instead of existsSync to avoid race conditions
        try {
            fs.accessSync(pgVersionFile, fs.constants.F_OK);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Check if PostgreSQL is currently running
     */
    async isRunning() {
        // Check state file for PID
        const state = this.loadState();
        if (!state?.pid) {
            return false;
        }
        // Verify process is running
        try {
            process.kill(state.pid, 0);
            // Also verify it's actually PostgreSQL on the expected port
            if (this.binaries?.psql) {
                execSync(`${this.binaries.psql} -h 127.0.0.1 -p ${state.port} -U ${this.config.user} -d ${this.config.database} -c "SELECT 1"`, { stdio: 'ignore', timeout: 5000 });
                return true;
            }
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Initialize PostgreSQL data directory
     */
    async initPostgres() {
        logger.info({ dataDir: this.dataDir }, 'Initializing embedded PostgreSQL');
        const prereqs = await this.checkPrerequisites();
        if (!prereqs.available) {
            return { success: false, error: prereqs.error };
        }
        // Check if already initialized
        if (this.isInitialized()) {
            logger.info('Embedded PostgreSQL already initialized');
            return { success: true };
        }
        this.ensureSpecmemDir();
        try {
            // Run initdb
            logger.info({ initdb: this.binaries.initdb, dataDir: this.dataDir }, 'Running initdb');
            execSync(`${this.binaries.initdb} -D "${this.dataDir}" -U ${this.config.user} -E UTF8 --no-locale`, {
                stdio: 'pipe',
                timeout: 60000,
                env: {
                    ...process.env,
                    PGPASSWORD: this.config.password,
                },
            });
            // Configure postgresql.conf for embedded use
            await this.configurePostgres();
            // Configure pg_hba.conf for local connections
            await this.configureAuthentication();
            logger.info('Embedded PostgreSQL initialized successfully');
            return { success: true };
        }
        catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            logger.error({ err }, 'Failed to initialize embedded PostgreSQL');
            return { success: false, error };
        }
    }
    /**
     * Configure postgresql.conf for embedded use
     */
    async configurePostgres() {
        const confFile = path.join(this.dataDir, 'postgresql.conf');
        // Find an available port
        const port = await findAvailablePort(this.config.port);
        this.config.port = port;
        const additionalConfig = `
# SpecMem Embedded PostgreSQL Configuration
# Auto-generated - do not edit manually

# Network settings - localhost only for security
listen_addresses = '127.0.0.1'
port = ${port}

# Performance settings for local embedded use
shared_buffers = 128MB
work_mem = 16MB
maintenance_work_mem = 64MB
effective_cache_size = 256MB

# WAL settings for embedded use (reduced for local development)
wal_level = minimal
max_wal_senders = 0
fsync = off
synchronous_commit = off
full_page_writes = off

# Logging
log_destination = 'stderr'
logging_collector = on
log_directory = '${this.specmemDir.replace(/'/g, "''")}'
log_filename = 'postgresql.log'
log_rotation_age = 1d
log_rotation_size = 10MB

# Connection settings
max_connections = 50
`;
        // Append to postgresql.conf
        fs.appendFileSync(confFile, additionalConfig);
        logger.info({ port }, 'Configured postgresql.conf');
    }
    /**
     * Configure pg_hba.conf for local connections
     */
    async configureAuthentication() {
        const hbaFile = path.join(this.dataDir, 'pg_hba.conf');
        const hbaConfig = `
# SpecMem Embedded PostgreSQL Authentication
# Auto-generated - do not edit manually

# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
`;
        // Write new pg_hba.conf
        fs.writeFileSync(hbaFile, hbaConfig, { mode: 0o600 });
        logger.info('Configured pg_hba.conf');
    }
    /**
     * Start PostgreSQL server
     */
    async startPostgres() {
        logger.info('Starting embedded PostgreSQL');
        const prereqs = await this.checkPrerequisites();
        if (!prereqs.available) {
            return { success: false, error: prereqs.error };
        }
        // Check if already running
        if (await this.isRunning()) {
            const state = this.loadState();
            logger.info({ port: state?.port }, 'Embedded PostgreSQL already running');
            return { success: true, port: state?.port };
        }
        // Initialize if needed
        if (!this.isInitialized()) {
            const initResult = await this.initPostgres();
            if (!initResult.success) {
                return { success: false, error: initResult.error };
            }
        }
        // Read the configured port from postgresql.conf
        const confFile = path.join(this.dataDir, 'postgresql.conf');
        const confContent = fs.readFileSync(confFile, 'utf-8');
        const portMatch = confContent.match(/^port\s*=\s*(\d+)/m);
        const port = portMatch ? parseInt(portMatch[1], 10) : this.config.port;
        // Check if port is available (another instance might have taken it)
        if (!(await isPortAvailable(port))) {
            // Try to find a new available port
            const newPort = await findAvailablePort(port);
            logger.warn({ oldPort: port, newPort }, 'Original port was taken, using new port');
            // Update postgresql.conf with new port
            const newConfContent = confContent.replace(/^port\s*=\s*\d+/m, `port = ${newPort}`);
            fs.writeFileSync(confFile, newConfContent);
            this.config.port = newPort;
        }
        else {
            this.config.port = port;
        }
        try {
            // Start PostgreSQL using pg_ctl
            logger.info({ pg_ctl: this.binaries.pg_ctl, dataDir: this.dataDir, port: this.config.port }, 'Running pg_ctl start');
            execSync(`${this.binaries.pg_ctl} start -D "${this.dataDir}" -l "${this.logFile}" -o "-p ${this.config.port}" -w -t ${STARTUP_TIMEOUT_MS / 1000}`, {
                stdio: 'pipe',
                timeout: STARTUP_TIMEOUT_MS + 5000,
                env: process.env,
            });
            // Wait for PostgreSQL to accept connections
            const ready = await waitForPostgres(this.config.port, this.binaries.psql, this.config.user, 'postgres', // Connect to postgres database first
            MAX_CONNECTION_RETRIES);
            if (!ready) {
                return { success: false, error: 'PostgreSQL started but not accepting connections' };
            }
            // Create specmem database if it doesn't exist
            await this.ensureDatabase();
            // Get the PID - use try/catch instead of existsSync to avoid race conditions
            const pidFile = path.join(this.dataDir, 'postmaster.pid');
            let pid;
            try {
                const pidContent = fs.readFileSync(pidFile, 'utf-8');
                pid = parseInt(pidContent.split('\n')[0], 10);
            }
            catch (err) {
                // ENOENT is expected if PID file doesn't exist yet
                if (err.code !== 'ENOENT') {
                    logger.warn({ err }, 'Failed to read PostgreSQL PID file');
                }
            }
            // Save state
            this.saveState({
                initialized: true,
                port: this.config.port,
                pid,
                dataDir: this.dataDir,
                database: this.config.database,
                user: this.config.user,
                startedAt: new Date().toISOString(),
                projectPath: this.config.projectPath,
                projectHash: this.projectHash,
            });
            logger.info({ port: this.config.port, pid }, 'Embedded PostgreSQL started successfully');
            return { success: true, port: this.config.port };
        }
        catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            logger.error({ err }, 'Failed to start embedded PostgreSQL');
            // Check log file for more details - use try/catch to avoid race conditions
            try {
                const logTail = fs.readFileSync(this.logFile, 'utf-8').split('\n').slice(-20).join('\n');
                logger.error({ logTail }, 'PostgreSQL log tail');
            }
            catch {
                // Log file doesn't exist or can't be read - that's okay
            }
            return { success: false, error };
        }
    }
    /**
     * Ensure the specmem database exists
     */
    async ensureDatabase() {
        try {
            // Check if database exists
            const result = execSync(`${this.binaries.psql} -h 127.0.0.1 -p ${this.config.port} -U ${this.config.user} -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${this.config.database}'"`, { encoding: 'utf-8', timeout: 5000 }).trim();
            if (result !== '1') {
                // Create database
                logger.info({ database: this.config.database }, 'Creating specmem database');
                execSync(`${this.binaries.createdb} -h 127.0.0.1 -p ${this.config.port} -U ${this.config.user} ${this.config.database}`, { stdio: 'pipe', timeout: 10000 });
                // Enable required extensions
                logger.info('Enabling PostgreSQL extensions');
                execSync(`${this.binaries.psql} -h 127.0.0.1 -p ${this.config.port} -U ${this.config.user} -d ${this.config.database} -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS btree_gin;"`, { stdio: 'pipe', timeout: 10000 });
            }
        }
        catch (err) {
            logger.warn({ err }, 'Error ensuring database exists');
            // Don't fail - the database might already exist
        }
    }
    /**
     * Stop PostgreSQL server
     */
    async stopPostgres() {
        if (this.shutdownInProgress) {
            logger.info('Shutdown already in progress');
            return { success: true };
        }
        this.shutdownInProgress = true;
        logger.info('Stopping embedded PostgreSQL');
        const prereqs = await this.checkPrerequisites();
        if (!prereqs.available) {
            this.shutdownInProgress = false;
            return { success: false, error: prereqs.error };
        }
        // Check if actually running
        if (!(await this.isRunning())) {
            logger.info('Embedded PostgreSQL is not running');
            this.shutdownInProgress = false;
            return { success: true };
        }
        try {
            // Stop using pg_ctl with smart mode (waits for connections to close)
            execSync(`${this.binaries.pg_ctl} stop -D "${this.dataDir}" -m smart -t ${SHUTDOWN_TIMEOUT_MS / 1000}`, {
                stdio: 'pipe',
                timeout: SHUTDOWN_TIMEOUT_MS + 5000,
                env: process.env,
            });
            // Update state
            const state = this.loadState();
            if (state) {
                state.pid = undefined;
                state.startedAt = undefined;
                this.saveState(state);
            }
            logger.info('Embedded PostgreSQL stopped successfully');
            this.shutdownInProgress = false;
            return { success: true };
        }
        catch (err) {
            // Try fast shutdown if smart shutdown failed
            try {
                logger.warn('Smart shutdown failed, trying fast shutdown');
                execSync(`${this.binaries.pg_ctl} stop -D "${this.dataDir}" -m fast -t 10`, { stdio: 'pipe', timeout: 15000 });
                this.shutdownInProgress = false;
                return { success: true };
            }
            catch (fastErr) {
                // Try immediate shutdown as last resort
                try {
                    logger.warn('Fast shutdown failed, trying immediate shutdown');
                    execSync(`${this.binaries.pg_ctl} stop -D "${this.dataDir}" -m immediate`, { stdio: 'pipe', timeout: 5000 });
                    this.shutdownInProgress = false;
                    return { success: true };
                }
                catch (immErr) {
                    const error = immErr instanceof Error ? immErr.message : String(immErr);
                    logger.error({ err: immErr }, 'Failed to stop embedded PostgreSQL');
                    this.shutdownInProgress = false;
                    return { success: false, error };
                }
            }
        }
    }
    /**
     * Get connection configuration for the embedded PostgreSQL
     */
    getConnectionConfig() {
        const state = this.loadState();
        return {
            host: '127.0.0.1',
            port: state?.port ?? this.config.port,
            database: this.config.database,
            user: this.config.user,
            password: this.config.password,
        };
    }
    /**
     * Get current state
     */
    getState() {
        return this.loadState();
    }
    /**
     * Get data directory path
     */
    getDataDir() {
        return this.dataDir;
    }
    /**
     * Clean up and remove all PostgreSQL data
     * WARNING: This deletes all data!
     */
    async destroy() {
        logger.warn('Destroying embedded PostgreSQL data');
        // Stop first
        const stopResult = await this.stopPostgres();
        if (!stopResult.success) {
            logger.warn({ error: stopResult.error }, 'Could not stop PostgreSQL cleanly before destroy');
        }
        try {
            // Remove data directory - use force: true which handles non-existence gracefully
            try {
                fs.rmSync(this.dataDir, { recursive: true, force: true });
            }
            catch (err) {
                // ENOENT is fine - directory already gone
                if (err.code !== 'ENOENT') {
                    throw err;
                }
            }
            // Remove state file - use try/catch instead of existsSync
            try {
                fs.unlinkSync(this.stateFile);
            }
            catch (err) {
                // ENOENT is fine - file already gone
                if (err.code !== 'ENOENT') {
                    throw err;
                }
            }
            // Remove log file - use try/catch instead of existsSync
            try {
                fs.unlinkSync(this.logFile);
            }
            catch (err) {
                // ENOENT is fine - file already gone
                if (err.code !== 'ENOENT') {
                    throw err;
                }
            }
            logger.info('Embedded PostgreSQL data destroyed');
            return { success: true };
        }
        catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            logger.error({ err }, 'Failed to destroy embedded PostgreSQL data');
            return { success: false, error };
        }
    }
    /**
     * Register shutdown handlers to stop PostgreSQL on process exit
     */
    registerShutdownHandlers() {
        const shutdown = async (signal) => {
            logger.info({ signal }, 'Received shutdown signal, stopping embedded PostgreSQL');
            await this.stopPostgres();
        };
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGHUP', () => shutdown('SIGHUP'));
        // Handle uncaught exceptions
        process.on('uncaughtException', async (error) => {
            logger.error({ error }, 'Uncaught exception, stopping embedded PostgreSQL');
            await this.stopPostgres();
            process.exit(1);
        });
        // Handle unhandled rejections
        process.on('unhandledRejection', async (reason) => {
            logger.error({ reason }, 'Unhandled rejection, stopping embedded PostgreSQL');
            await this.stopPostgres();
            process.exit(1);
        });
        logger.info('Registered embedded PostgreSQL shutdown handlers');
    }
}
// Singleton instance for the current project
let embeddedPgInstance = null;
/**
 * Get or create the embedded PostgreSQL manager for the current project
 */
export function getEmbeddedPostgres(projectPath) {
    const resolvedPath = projectPath ?? process.env['SPECMEM_PROJECT_PATH'] ?? process.cwd();
    if (!embeddedPgInstance || embeddedPgInstance.getDataDir() !== path.join(resolvedPath, SPECMEM_LOCAL_DIR, PGDATA_DIR)) {
        embeddedPgInstance = new EmbeddedPostgresManager({ projectPath: resolvedPath });
    }
    return embeddedPgInstance;
}
/**
 * Initialize and start embedded PostgreSQL
 * Returns connection configuration on success
 */
export async function initEmbeddedPostgres(projectPath) {
    const pg = getEmbeddedPostgres(projectPath);
    // Check prerequisites
    const prereqs = await pg.checkPrerequisites();
    if (!prereqs.available) {
        return { success: false, error: prereqs.error };
    }
    // Start PostgreSQL (will initialize if needed)
    const startResult = await pg.startPostgres();
    if (!startResult.success) {
        return { success: false, error: startResult.error };
    }
    // Register shutdown handlers
    pg.registerShutdownHandlers();
    return {
        success: true,
        connectionConfig: pg.getConnectionConfig(),
    };
}
/**
 * Stop embedded PostgreSQL
 */
export async function stopEmbeddedPostgres() {
    if (!embeddedPgInstance) {
        return { success: true };
    }
    return embeddedPgInstance.stopPostgres();
}
/**
 * Check if embedded PostgreSQL is running
 */
export async function isEmbeddedPostgresRunning() {
    if (!embeddedPgInstance) {
        return false;
    }
    return embeddedPgInstance.isRunning();
}
export default EmbeddedPostgresManager;
//# sourceMappingURL=embeddedPostgres.js.map