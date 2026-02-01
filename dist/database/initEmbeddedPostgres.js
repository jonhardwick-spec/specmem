/**
 * Embedded PostgreSQL Auto-Initialization Module
 *
 * Handles automatic initialization of an embedded PostgreSQL instance:
 * 1. Initialize data directory with initdb
 * 2. Start PostgreSQL server
 * 3. Create database and user
 * 4. Install pgvector extension
 * 5. Run all SpecMem migrations
 *
 * This module is designed for zero-config deployment where PostgreSQL
 * is bundled with SpecMem rather than relying on a system-wide installation.
 */
// @ts-ignore - pg types not installed
import pg from 'pg';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';
import { generateSecretSauce } from '../config/autoConfig.js';
import { ConnectionPoolGoBrrr } from '../db/connectionPoolGoBrrr.js';
import { BigBrainMigrations } from '../db/bigBrainMigrations.js';
const { Client } = pg;
const execAsync = promisify(exec);
// Default configuration
const DEFAULT_CONFIG = {
    port: 5432,
    database: 'specmem_westayunprofessional',
    user: 'specmem_westayunprofessional',
    connectionTimeout: 30000,
    maxRetries: 30,
    retryDelay: 1000
};
/**
 * Get the default base directory for embedded PostgreSQL
 */
export function getDefaultBaseDir() {
    // Use environment variable if set
    if (process.env['SPECMEM_EMBEDDED_PG_DIR']) {
        return process.env['SPECMEM_EMBEDDED_PG_DIR'];
    }
    // Use XDG data directory on Linux, or appropriate platform-specific location
    const platform = os.platform();
    const home = os.homedir();
    if (platform === 'linux') {
        const xdgData = process.env['XDG_DATA_HOME'] || path.join(home, '.local', 'share');
        return path.join(xdgData, 'specmem', 'postgres');
    }
    else if (platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'specmem', 'postgres');
    }
    else if (platform === 'win32') {
        const appData = process.env['APPDATA'] || path.join(home, 'AppData', 'Roaming');
        return path.join(appData, 'specmem', 'postgres');
    }
    // Fallback to home directory
    return path.join(home, '.specmem', 'postgres');
}
/**
 * Detect PostgreSQL binary paths
 */
async function detectPostgresBinaries() {
    const binaries = {};
    // Common PostgreSQL installation paths
    const searchPaths = [
        '/usr/lib/postgresql/16/bin',
        '/usr/lib/postgresql/15/bin',
        '/usr/lib/postgresql/14/bin',
        '/usr/pgsql-16/bin',
        '/usr/pgsql-15/bin',
        '/usr/pgsql-14/bin',
        '/opt/homebrew/opt/postgresql@16/bin',
        '/opt/homebrew/opt/postgresql@15/bin',
        '/opt/homebrew/opt/postgresql@14/bin',
        '/usr/local/pgsql/bin',
        '/usr/local/bin',
        '/usr/bin'
    ];
    // Add paths from environment
    const pathEnv = process.env['PATH'] || '';
    const envPaths = pathEnv.split(path.delimiter);
    const allPaths = [...searchPaths, ...envPaths];
    for (const dir of allPaths) {
        if (!binaries.initdb) {
            const initdbPath = path.join(dir, 'initdb');
            if (fs.existsSync(initdbPath)) {
                binaries.initdb = initdbPath;
            }
        }
        if (!binaries.pgCtl) {
            const pgCtlPath = path.join(dir, 'pg_ctl');
            if (fs.existsSync(pgCtlPath)) {
                binaries.pgCtl = pgCtlPath;
            }
        }
        if (!binaries.postgres) {
            const postgresPath = path.join(dir, 'postgres');
            if (fs.existsSync(postgresPath)) {
                binaries.postgres = postgresPath;
            }
        }
        // Stop searching once all binaries found
        if (binaries.initdb && binaries.pgCtl && binaries.postgres) {
            break;
        }
    }
    // Try using 'which' command as fallback
    if (!binaries.initdb) {
        try {
            const { stdout } = await execAsync('which initdb 2>/dev/null');
            binaries.initdb = stdout.trim();
        }
        catch {
            // Not found via which
        }
    }
    if (!binaries.pgCtl) {
        try {
            const { stdout } = await execAsync('which pg_ctl 2>/dev/null');
            binaries.pgCtl = stdout.trim();
        }
        catch {
            // Not found via which
        }
    }
    if (!binaries.postgres) {
        try {
            const { stdout } = await execAsync('which postgres 2>/dev/null');
            binaries.postgres = stdout.trim();
        }
        catch {
            // Not found via which
        }
    }
    return binaries;
}
/**
 * Check if PostgreSQL data directory is initialized
 */
function isDataDirectoryInitialized(dataDir) {
    const pgVersionFile = path.join(dataDir, 'PG_VERSION');
    return fs.existsSync(pgVersionFile);
}
/**
 * Initialize PostgreSQL data directory with initdb
 */
async function initializeDataDirectory(initdbPath, dataDir, user) {
    logger.info({ dataDir, user }, 'Initializing PostgreSQL data directory with initdb');
    // Create parent directories if needed
    const parentDir = path.dirname(dataDir);
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 });
    }
    return new Promise((resolve) => {
        const initdb = spawn(initdbPath, [
            '-D', dataDir,
            '-U', user,
            '-E', 'UTF8',
            '--locale=C',
            '--auth=trust',
            '--auth-host=scram-sha-256'
        ], {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        initdb.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        initdb.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        initdb.on('close', (code) => {
            if (code === 0) {
                logger.info('PostgreSQL data directory initialized successfully');
                // Configure pg_hba.conf for password authentication
                const pgHbaPath = path.join(dataDir, 'pg_hba.conf');
                try {
                    let hbaContent = fs.readFileSync(pgHbaPath, 'utf-8');
                    // Replace trust with scram-sha-256 for local connections
                    // but keep host connections using scram-sha-256
                    const hbaConfig = `
# PostgreSQL Client Authentication Configuration File
# ====================================================
# TYPE  DATABASE        USER            ADDRESS                 METHOD

# Local connections - password required
local   all             all                                     scram-sha-256

# IPv4 local connections
host    all             all             127.0.0.1/32            scram-sha-256

# IPv6 local connections
host    all             all             ::1/128                 scram-sha-256

# Allow replication connections from localhost
local   replication     all                                     scram-sha-256
host    replication     all             127.0.0.1/32            scram-sha-256
host    replication     all             ::1/128                 scram-sha-256
`;
                    fs.writeFileSync(pgHbaPath, hbaConfig, { mode: 0o600 });
                    logger.info('pg_hba.conf configured for password authentication');
                }
                catch (err) {
                    logger.warn({ err }, 'Could not update pg_hba.conf');
                }
                // Configure postgresql.conf for embedded use
                const postgresConfPath = path.join(dataDir, 'postgresql.conf');
                try {
                    let confContent = fs.readFileSync(postgresConfPath, 'utf-8');
                    // Add/modify settings for embedded use
                    const additionalConfig = `
# SpecMem Embedded PostgreSQL Configuration
listen_addresses = 'localhost'
max_connections = 50
shared_buffers = 128MB
work_mem = 16MB
maintenance_work_mem = 64MB
effective_cache_size = 256MB
wal_level = minimal
max_wal_senders = 0
`;
                    fs.appendFileSync(postgresConfPath, additionalConfig);
                    logger.info('postgresql.conf configured for embedded use');
                }
                catch (err) {
                    logger.warn({ err }, 'Could not update postgresql.conf');
                }
                resolve({ success: true });
            }
            else {
                const error = `initdb failed with code ${code}: ${stderr}`;
                logger.error({ code, stderr, stdout }, error);
                resolve({ success: false, error });
            }
        });
        initdb.on('error', (err) => {
            const error = `Failed to start initdb: ${err.message}`;
            logger.error({ err }, error);
            resolve({ success: false, error });
        });
    });
}
/**
 * Start PostgreSQL server
 */
async function startPostgres(pgCtlPath, dataDir, port, logFile) {
    logger.info({ dataDir, port }, 'Starting PostgreSQL server');
    const actualLogFile = logFile || path.join(dataDir, 'postgresql.log');
    return new Promise((resolve) => {
        const pgCtl = spawn(pgCtlPath, [
            'start',
            '-D', dataDir,
            '-l', actualLogFile,
            '-o', `-p ${port}`,
            '-w' // Wait for startup to complete
        ], {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        pgCtl.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        pgCtl.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        pgCtl.on('close', (code) => {
            if (code === 0) {
                logger.info({ port }, 'PostgreSQL server started successfully');
                resolve({ success: true });
            }
            else {
                const error = `pg_ctl start failed with code ${code}: ${stderr || stdout}`;
                logger.error({ code, stderr, stdout }, error);
                resolve({ success: false, error });
            }
        });
        pgCtl.on('error', (err) => {
            const error = `Failed to start pg_ctl: ${err.message}`;
            logger.error({ err }, error);
            resolve({ success: false, error });
        });
    });
}
/**
 * Check if PostgreSQL is already running
 */
async function isPostgresRunning(pgCtlPath, dataDir) {
    return new Promise((resolve) => {
        const pgCtl = spawn(pgCtlPath, ['status', '-D', dataDir], {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        pgCtl.on('close', (code) => {
            // pg_ctl status returns 0 if server is running, non-zero otherwise
            resolve(code === 0);
        });
        pgCtl.on('error', () => {
            resolve(false);
        });
    });
}
/**
 * Wait for PostgreSQL to accept connections with retry logic
 */
async function waitForConnection(host, port, user, password, database, maxRetries, retryDelay) {
    logger.info({ host, port, maxRetries }, 'Waiting for PostgreSQL to accept connections');
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const client = new Client({
                host,
                port,
                user,
                password,
                database,
                connectionTimeoutMillis: 5000
            });
            await client.connect();
            const result = await client.query('SELECT version()');
            const version = result.rows[0]?.version;
            await client.end();
            logger.info({ attempt, version }, 'Successfully connected to PostgreSQL');
            return { connected: true, version };
        }
        catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            if (attempt < maxRetries) {
                logger.debug({ attempt, maxRetries, error }, 'Connection attempt failed, retrying...');
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
            else {
                logger.error({ error, attempts: maxRetries }, 'Failed to connect after all retries');
                return { connected: false, error };
            }
        }
    }
    return { connected: false, error: 'Max retries exceeded' };
}
/**
 * Initialize the database - create database and user if they don't exist
 */
export async function initializeDatabase(host, port, adminUser, adminPassword, targetDatabase, targetUser, targetPassword) {
    logger.info({ targetDatabase, targetUser }, 'Initializing database and user');
    let client = null;
    try {
        // Connect as admin user to postgres database
        client = new Client({
            host,
            port,
            user: adminUser,
            password: adminPassword,
            database: 'postgres',
            connectionTimeoutMillis: 10000
        });
        await client.connect();
        // Check if user exists
        const userResult = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [targetUser]);
        const userExists = userResult.rows.length > 0;
        let userCreated = false;
        if (!userExists) {
            logger.info({ targetUser }, 'Creating database user');
            // Use PostgreSQL format() for safe password escaping
            await client.query(`DO $$ BEGIN EXECUTE format('CREATE USER "${targetUser}" WITH PASSWORD %L LOGIN CREATEDB', $1); END $$`, [targetPassword]);
            userCreated = true;
            logger.info({ targetUser }, 'User created successfully');
        }
        else {
            logger.info({ targetUser }, 'User already exists, updating password');
            // Update password for existing user
            await client.query(`DO $$ BEGIN EXECUTE format('ALTER USER "${targetUser}" WITH PASSWORD %L', $1); END $$`, [targetPassword]);
        }
        // Check if database exists
        const dbResult = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDatabase]);
        const dbExists = dbResult.rows.length > 0;
        let dbCreated = false;
        if (!dbExists) {
            logger.info({ targetDatabase }, 'Creating database');
            // Database names cannot be parameterized in DDL
            await client.query(`CREATE DATABASE "${targetDatabase}" OWNER "${targetUser}"`);
            dbCreated = true;
            logger.info({ targetDatabase }, 'Database created successfully');
        }
        else {
            logger.info({ targetDatabase }, 'Database already exists');
        }
        // Grant privileges
        await client.query(`GRANT ALL PRIVILEGES ON DATABASE "${targetDatabase}" TO "${targetUser}"`);
        logger.info({ targetDatabase, targetUser }, 'Privileges granted');
        return { success: true, dbCreated, userCreated };
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error({ err, error }, 'Failed to initialize database');
        return { success: false, dbCreated: false, userCreated: false, error };
    }
    finally {
        if (client) {
            try {
                await client.end();
            }
            catch {
                // Ignore close errors
            }
        }
    }
}
/**
 * Install required PostgreSQL extensions (pgvector, pg_trgm, etc.)
 */
export async function installExtensions(host, port, user, password, database) {
    logger.info({ database }, 'Installing PostgreSQL extensions');
    let client = null;
    const installedExtensions = [];
    try {
        client = new Client({
            host,
            port,
            user,
            password,
            database,
            connectionTimeoutMillis: 10000
        });
        await client.connect();
        // Install required extensions
        const extensions = ['vector', 'pg_trgm', 'btree_gin', 'uuid-ossp'];
        for (const ext of extensions) {
            try {
                await client.query(`CREATE EXTENSION IF NOT EXISTS "${ext}"`);
                installedExtensions.push(ext);
                logger.info({ extension: ext }, 'Extension installed/verified');
            }
            catch (err) {
                // Some extensions might not be available, log warning but continue
                logger.warn({ extension: ext, err }, 'Could not install extension');
            }
        }
        // Verify pgvector is installed (critical for SpecMem)
        const vectorCheck = await client.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'");
        const pgvectorInstalled = vectorCheck.rows.length > 0;
        if (!pgvectorInstalled) {
            logger.error('pgvector extension is required but not available');
            return {
                success: false,
                extensions: installedExtensions,
                error: 'pgvector extension is not available. Please install pgvector on your system.'
            };
        }
        return { success: true, extensions: installedExtensions };
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error({ err, error }, 'Failed to install extensions');
        return { success: false, extensions: installedExtensions, error };
    }
    finally {
        if (client) {
            try {
                await client.end();
            }
            catch {
                // Ignore close errors
            }
        }
    }
}
/**
 * Run all SpecMem database migrations
 */
export async function runMigrations(host, port, database, user, password) {
    logger.info({ database }, 'Running database migrations');
    const pool = new ConnectionPoolGoBrrr({
        host,
        port,
        database,
        user,
        password,
        maxConnections: 5,
        idleTimeout: 10000,
        connectionTimeout: 10000
    });
    try {
        await pool.wakeUp();
        const migrations = new BigBrainMigrations(pool);
        await migrations.runAllMigrations();
        // Get count of applied migrations
        const result = await pool.queryWithSwag('SELECT COUNT(*) FROM _specmem_migrations');
        const migrationsRun = parseInt(result.rows[0]?.count || '0', 10);
        logger.info({ migrationsRun }, 'Migrations completed successfully');
        return { success: true, migrationsRun };
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error({ err, error }, 'Migration failed');
        return { success: false, migrationsRun: 0, error };
    }
    finally {
        await pool.shutdown();
    }
}
/**
 * Verify database is ready and all components are working
 */
export async function verifyDatabase(host, port, database, user, password) {
    logger.info({ database }, 'Verifying database readiness');
    const checks = {
        connection: false,
        pgvector: false,
        memoriesTable: false,
        migrationsTable: false
    };
    let client = null;
    try {
        client = new Client({
            host,
            port,
            user,
            password,
            database,
            connectionTimeoutMillis: 10000
        });
        await client.connect();
        checks.connection = true;
        // Check pgvector extension
        const vectorCheck = await client.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'");
        checks.pgvector = vectorCheck.rows.length > 0;
        // Check memories table
        const memoriesCheck = await client.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'memories'");
        checks.memoriesTable = memoriesCheck.rows.length > 0;
        // Check migrations table
        const migrationsCheck = await client.query("SELECT 1 FROM information_schema.tables WHERE table_name = '_specmem_migrations'");
        checks.migrationsTable = migrationsCheck.rows.length > 0;
        const allPassed = Object.values(checks).every(v => v);
        if (allPassed) {
            logger.info({ checks }, 'Database verification passed');
        }
        else {
            logger.warn({ checks }, 'Some database checks failed');
        }
        return { success: allPassed, checks };
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error({ err, error, checks }, 'Database verification failed');
        return { success: false, checks, error };
    }
    finally {
        if (client) {
            try {
                await client.end();
            }
            catch {
                // Ignore close errors
            }
        }
    }
}
/**
 * Main initialization function - orchestrates the entire embedded PostgreSQL setup
 *
 * This function handles:
 * 1. Detecting/setting up PostgreSQL binaries
 * 2. Initializing data directory if needed (first run)
 * 3. Starting PostgreSQL server
 * 4. Creating database and user
 * 5. Installing extensions (pgvector, etc.)
 * 6. Running all migrations
 * 7. Verifying everything is ready
 */
export async function initializeEmbeddedPostgres(config) {
    const warnings = [];
    // Merge config with defaults
    const fullConfig = {
        baseDir: config?.baseDir || getDefaultBaseDir(),
        port: config?.port ?? DEFAULT_CONFIG.port,
        database: config?.database || DEFAULT_CONFIG.database,
        user: config?.user || DEFAULT_CONFIG.user,
        password: config?.password,
        connectionTimeout: config?.connectionTimeout ?? DEFAULT_CONFIG.connectionTimeout,
        maxRetries: config?.maxRetries ?? DEFAULT_CONFIG.maxRetries,
        retryDelay: config?.retryDelay ?? DEFAULT_CONFIG.retryDelay
    };
    // Generate password if not provided
    const password = fullConfig.password || generateSecretSauce(32);
    const dataDir = path.join(fullConfig.baseDir, 'data');
    logger.info({
        baseDir: fullConfig.baseDir,
        dataDir,
        port: fullConfig.port,
        database: fullConfig.database,
        user: fullConfig.user
    }, 'Starting embedded PostgreSQL initialization');
    // Detect PostgreSQL binaries
    const binaries = await detectPostgresBinaries();
    const initdbPath = fullConfig.initdbPath || binaries.initdb;
    const pgCtlPath = fullConfig.pgCtlPath || binaries.pgCtl;
    if (!initdbPath) {
        return {
            success: false,
            isFirstRun: false,
            dataDirectory: dataDir,
            port: fullConfig.port,
            database: fullConfig.database,
            user: fullConfig.user,
            password,
            connectionString: '',
            pgvectorEnabled: false,
            migrationsRun: false,
            error: 'Could not find initdb binary. Please install PostgreSQL.',
            warnings
        };
    }
    if (!pgCtlPath) {
        return {
            success: false,
            isFirstRun: false,
            dataDirectory: dataDir,
            port: fullConfig.port,
            database: fullConfig.database,
            user: fullConfig.user,
            password,
            connectionString: '',
            pgvectorEnabled: false,
            migrationsRun: false,
            error: 'Could not find pg_ctl binary. Please install PostgreSQL.',
            warnings
        };
    }
    logger.info({ initdbPath, pgCtlPath }, 'PostgreSQL binaries detected');
    // Check if this is first run (data directory not initialized)
    const isFirstRun = !isDataDirectoryInitialized(dataDir);
    if (isFirstRun) {
        logger.info('First run detected - initializing PostgreSQL data directory');
        // Initialize data directory
        const initResult = await initializeDataDirectory(initdbPath, dataDir, fullConfig.user);
        if (!initResult.success) {
            return {
                success: false,
                isFirstRun: true,
                dataDirectory: dataDir,
                port: fullConfig.port,
                database: fullConfig.database,
                user: fullConfig.user,
                password,
                connectionString: '',
                pgvectorEnabled: false,
                migrationsRun: false,
                error: initResult.error,
                warnings
            };
        }
    }
    // Check if PostgreSQL is already running
    const alreadyRunning = await isPostgresRunning(pgCtlPath, dataDir);
    if (!alreadyRunning) {
        // Start PostgreSQL
        const startResult = await startPostgres(pgCtlPath, dataDir, fullConfig.port);
        if (!startResult.success) {
            return {
                success: false,
                isFirstRun,
                dataDirectory: dataDir,
                port: fullConfig.port,
                database: fullConfig.database,
                user: fullConfig.user,
                password,
                connectionString: '',
                pgvectorEnabled: false,
                migrationsRun: false,
                error: startResult.error,
                warnings
            };
        }
    }
    else {
        logger.info('PostgreSQL is already running');
    }
    // Wait for PostgreSQL to accept connections
    // On first run, connect as the admin user (from initdb) to postgres database
    const adminPassword = isFirstRun ? '' : password; // Empty password for trust auth on first run
    const connectionResult = await waitForConnection('localhost', fullConfig.port, fullConfig.user, adminPassword, 'postgres', // Connect to postgres database first
    fullConfig.maxRetries, fullConfig.retryDelay);
    if (!connectionResult.connected) {
        return {
            success: false,
            isFirstRun,
            dataDirectory: dataDir,
            port: fullConfig.port,
            database: fullConfig.database,
            user: fullConfig.user,
            password,
            connectionString: '',
            postgresVersion: connectionResult.version,
            pgvectorEnabled: false,
            migrationsRun: false,
            error: `Failed to connect to PostgreSQL: ${connectionResult.error}`,
            warnings
        };
    }
    // Initialize database and user (only really needed on first run, but safe to re-run)
    const dbInitResult = await initializeDatabase('localhost', fullConfig.port, fullConfig.user, // Admin user (from initdb)
    adminPassword, fullConfig.database, fullConfig.user, password);
    if (!dbInitResult.success) {
        // Try to handle case where user/database already exist with different credentials
        if (dbInitResult.error?.includes('already exists')) {
            warnings.push('Database or user already exists - using existing configuration');
        }
        else {
            return {
                success: false,
                isFirstRun,
                dataDirectory: dataDir,
                port: fullConfig.port,
                database: fullConfig.database,
                user: fullConfig.user,
                password,
                connectionString: '',
                postgresVersion: connectionResult.version,
                pgvectorEnabled: false,
                migrationsRun: false,
                error: dbInitResult.error,
                warnings
            };
        }
    }
    // Install extensions
    const extensionsResult = await installExtensions('localhost', fullConfig.port, fullConfig.user, password, fullConfig.database);
    if (!extensionsResult.success) {
        return {
            success: false,
            isFirstRun,
            dataDirectory: dataDir,
            port: fullConfig.port,
            database: fullConfig.database,
            user: fullConfig.user,
            password,
            connectionString: '',
            postgresVersion: connectionResult.version,
            pgvectorEnabled: false,
            migrationsRun: false,
            error: extensionsResult.error,
            warnings
        };
    }
    const pgvectorEnabled = extensionsResult.extensions.includes('vector');
    // Run migrations
    const migrationsResult = await runMigrations('localhost', fullConfig.port, fullConfig.database, fullConfig.user, password);
    if (!migrationsResult.success) {
        warnings.push(`Migrations may have failed: ${migrationsResult.error}`);
    }
    // Verify everything is ready
    const verifyResult = await verifyDatabase('localhost', fullConfig.port, fullConfig.database, fullConfig.user, password);
    if (!verifyResult.success) {
        warnings.push('Database verification had issues - some features may not work');
    }
    // Build connection string
    const connectionString = `postgresql://${fullConfig.user}:${encodeURIComponent(password)}@localhost:${fullConfig.port}/${fullConfig.database}`;
    logger.info({
        isFirstRun,
        database: fullConfig.database,
        user: fullConfig.user,
        port: fullConfig.port,
        pgvectorEnabled,
        migrationsRun: migrationsResult.success,
        verifyResult: verifyResult.checks
    }, 'Embedded PostgreSQL initialization complete');
    return {
        success: true,
        isFirstRun,
        dataDirectory: dataDir,
        port: fullConfig.port,
        database: fullConfig.database,
        user: fullConfig.user,
        password,
        connectionString,
        postgresVersion: connectionResult.version,
        pgvectorEnabled,
        migrationsRun: migrationsResult.success,
        warnings
    };
}
/**
 * Stop embedded PostgreSQL server
 */
export async function stopEmbeddedPostgres(baseDir) {
    const actualBaseDir = baseDir || getDefaultBaseDir();
    const dataDir = path.join(actualBaseDir, 'data');
    logger.info({ dataDir }, 'Stopping embedded PostgreSQL');
    const binaries = await detectPostgresBinaries();
    if (!binaries.pgCtl) {
        return { success: false, error: 'Could not find pg_ctl binary' };
    }
    return new Promise((resolve) => {
        const pgCtl = spawn(binaries.pgCtl, ['stop', '-D', dataDir, '-m', 'fast'], {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stderr = '';
        pgCtl.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        pgCtl.on('close', (code) => {
            if (code === 0) {
                logger.info('Embedded PostgreSQL stopped');
                resolve({ success: true });
            }
            else {
                const error = `pg_ctl stop failed with code ${code}: ${stderr}`;
                logger.error({ code, stderr }, error);
                resolve({ success: false, error });
            }
        });
        pgCtl.on('error', (err) => {
            const error = `Failed to run pg_ctl: ${err.message}`;
            logger.error({ err }, error);
            resolve({ success: false, error });
        });
    });
}
/**
 * Get status of embedded PostgreSQL
 */
export async function getEmbeddedPostgresStatus(baseDir) {
    const actualBaseDir = baseDir || getDefaultBaseDir();
    const dataDir = path.join(actualBaseDir, 'data');
    const initialized = isDataDirectoryInitialized(dataDir);
    if (!initialized) {
        return {
            initialized: false,
            running: false,
            dataDirectory: dataDir
        };
    }
    const binaries = await detectPostgresBinaries();
    let running = false;
    if (binaries.pgCtl) {
        running = await isPostgresRunning(binaries.pgCtl, dataDir);
    }
    // Try to get version from PG_VERSION file
    let version;
    try {
        const versionFile = path.join(dataDir, 'PG_VERSION');
        version = fs.readFileSync(versionFile, 'utf-8').trim();
    }
    catch {
        // Ignore errors reading version
    }
    return {
        initialized,
        running,
        dataDirectory: dataDir,
        version
    };
}
//# sourceMappingURL=initEmbeddedPostgres.js.map