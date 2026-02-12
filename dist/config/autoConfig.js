// yooo auto-config system that goes CRAZY
// detects first run, generates secure configs, all that good stuff
// no more manual setup - this does it ALL fr fr
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { logger } from '../utils/logger.js';
// @ts-ignore - pg types not installed
import pg from 'pg';
// Import unified password service for password persistence
import { persistPasswordToEnv, setPassword } from './password.js';
const { Client } = pg;
/**
 * discoverActiveDatabase - dynamically finds which DB has the actual memories
 *
 * Tries databases in order of likelihood:
 * 1. SPECMEM_DB_NAME env var (if set)
 * 2. specmem_westayunprofessional (the OG password-named DB)
 * 3. specmem (the default)
 *
 * Returns the DB with the most memories, or first accessible one
 */
async function discoverActiveDatabase(host, port, password) {
    const candidates = [
        process.env['SPECMEM_DB_NAME'], // User override first
        'specmem_westayunprofessional', // The OG database (unified password pattern)
    ].filter(Boolean);
    let bestDb = 'specmem_westayunprofessional';
    let maxMemories = -1;
    for (const dbName of candidates) {
        const client = new Client({
            host,
            port,
            database: dbName,
            user: 'specmem_westayunprofessional', // Try the OG user first
            password,
            connectionTimeoutMillis: 3000
        });
        try {
            await client.connect();
            const result = await client.query('SELECT COUNT(*) as count FROM memories');
            const count = parseInt(result.rows[0]?.count || '0', 10);
            logger.info({ database: dbName, memoryCount: count }, '[AutoConfig] Discovered database with memories');
            if (count > maxMemories) {
                maxMemories = count;
                bestDb = dbName;
            }
            await client.end();
        }
        catch (err) {
            // Try with env password as fallback
            try {
                const client2 = new Client({
                    host,
                    port,
                    database: dbName,
                    user: process.env['SPECMEM_DB_USER'] || 'specmem_westayunprofessional',
                    password,
                    connectionTimeoutMillis: 3000
                });
                await client2.connect();
                const result = await client2.query('SELECT COUNT(*) as count FROM memories');
                const count = parseInt(result.rows[0]?.count || '0', 10);
                logger.info({ database: dbName, memoryCount: count, user: process.env['SPECMEM_DB_USER'] || 'specmem_westayunprofessional' }, '[AutoConfig] Discovered database (fallback user)');
                if (count > maxMemories) {
                    maxMemories = count;
                    bestDb = dbName;
                }
                await client2.end();
            }
            catch {
                logger.debug({ database: dbName }, '[AutoConfig] Database not accessible');
            }
        }
    }
    logger.info({ selectedDatabase: bestDb, memoryCount: maxMemories }, '[AutoConfig] Selected active database');
    return bestDb;
}
/**
 * isThisTheFirstRodeo - checks if this is the first time running SpecMem
 *
 * looks for config files in:
 * 1. ~/.specmem/config.json
 * 2. .env file in project root
 * 3. existing database connection
 */
export async function isThisTheFirstRodeo() {
    try {
        // check for user config directory
        const configDir = await getConfigDirectory();
        const configPath = path.join(configDir, 'config.json');
        try {
            await fs.access(configPath);
            logger.debug({ configPath }, 'found existing config - not first rodeo');
            return false;
        }
        catch {
            // config doesn't exist, might be first run
        }
        // check for .env file in project root
        const projectRoot = getProjectRoot();
        const envPath = path.join(projectRoot, '.env');
        try {
            await fs.access(envPath);
            const envContent = await fs.readFile(envPath, 'utf-8');
            // if .env exists and has DB password, probably not first run
            if (envContent.includes('SPECMEM_DB_PASSWORD') && !envContent.includes('your_secure_password_here')) {
                logger.debug({ envPath }, 'found configured .env - not first rodeo');
                return false;
            }
        }
        catch {
            // .env doesn't exist
        }
        logger.info('no existing config found - this IS the first rodeo lets gooo');
        return true;
    }
    catch (err) {
        logger.warn({ err }, 'error checking first run status, assuming first run');
        return true;
    }
}
/**
 * Parse DATABASE_URL if provided
 * Format: postgres://user:password@host:port/database
 */
function parseDatabaseUrlForDetection() {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
        return null;
    }
    try {
        const normalizedUrl = databaseUrl.replace(/^postgresql:\/\//, 'postgres://');
        const url = new URL(normalizedUrl);
        if (url.protocol !== 'postgres:') {
            return null;
        }
        return {
            host: url.hostname,
            port: url.port ? parseInt(url.port, 10) : 5432,
            user: decodeURIComponent(url.username) || 'postgres',
            password: decodeURIComponent(url.password) || ''
        };
    }
    catch {
        return null;
    }
}
/**
 * detectThePostgresVibes - auto-detect PostgreSQL connection details
 *
 * checks common locations:
 * 1. DATABASE_URL (if set, takes priority)
 * 2. Environment variables (PGHOST, PGPORT, etc)
 * 3. localhost:5432 (standard port)
 * 4. Unix socket connection
 * 5. Common Docker/Podman ports
 */
export async function detectThePostgresVibes() {
    // DATABASE_URL takes priority if set
    const parsedUrl = parseDatabaseUrlForDetection();
    if (parsedUrl) {
        logger.info({ host: parsedUrl.host, port: parsedUrl.port }, 'DATABASE_URL detected, using that');
    }
    // try environment variables first (or DATABASE_URL if parsed)
    const envHost = parsedUrl?.host || process.env['PGHOST'] || process.env['POSTGRES_HOST'] || 'localhost';
    const envPort = parsedUrl?.port || parseInt(process.env['PGPORT'] || process.env['POSTGRES_PORT'] || '5432', 10);
    logger.info({ host: envHost, port: envPort }, 'yooo auto-detecting postgres lets goooo');
    // try to connect to detect if postgres is available
    const testLocations = [
        { host: envHost, port: envPort },
        { host: 'localhost', port: 5432 },
        { host: '127.0.0.1', port: 5432 },
    ];
    // Use credentials from DATABASE_URL if available, otherwise fall back to env vars
    const testUser = parsedUrl?.user || process.env['PGUSER'] || 'postgres';
    const testPassword = parsedUrl?.password || process.env['PGPASSWORD'] || '';
    for (const location of testLocations) {
        try {
            const client = new Client({
                host: location.host,
                port: location.port,
                user: testUser,
                password: testPassword,
                database: 'postgres', // connect to default db
                connectionTimeoutMillis: 2000,
            });
            await client.connect();
            const result = await client.query('SELECT version()');
            const version = result.rows[0]?.version;
            await client.end();
            logger.info({
                host: location.host,
                port: location.port,
                version
            }, 'postgres detected - WE FOUND IT');
            return {
                host: location.host,
                port: location.port,
                available: true,
                version
            };
        }
        catch (err) {
            logger.debug({
                host: location.host,
                port: location.port,
                error: err.message
            }, 'postgres not found at this location, trying next...');
        }
    }
    // no postgres found, return defaults
    logger.warn('postgres not detected - using defaults (might need manual config)');
    return {
        host: 'localhost',
        port: 5432,
        available: false
    };
}
/**
 * generateSecretSauce - creates secure random keys and passwords
 *
 * uses crypto.randomBytes for cryptographically secure randomness
 * generates URL-safe base64 strings for maximum compatibility
 */
export function generateSecretSauce(length = 32) {
    // fr fr this config generation go crazy
    const bytes = crypto.randomBytes(length);
    // URL-safe base64 encoding (no special chars that break env files)
    return bytes.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '')
        .slice(0, length);
}
/**
 * Get project hash for per-project isolation
 * Uses SPECMEM_PROJECT_HASH env var or computes from project path
 */
function getProjectHash() {
    if (process.env['SPECMEM_PROJECT_HASH']) {
        return process.env['SPECMEM_PROJECT_HASH'];
    }
    const projectPath = process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
    return crypto.createHash('sha256').update(path.resolve(projectPath)).digest('hex').slice(0, 12);
}
/**
 * Get project-specific database name
 * Format: specmem_{projectHash}
 */
function getProjectDatabaseName() {
    if (process.env['SPECMEM_DB_NAME']) {
        return process.env['SPECMEM_DB_NAME'];
    }
    return `specmem_${getProjectHash()}`;
}
/**
 * Get project-specific port from hash
 * Derives a unique port in a given range based on project hash
 */
function getProjectPortFromHash(basePort, rangeSize = 100) {
    const projectHash = getProjectHash();
    const hashNum = parseInt(projectHash.slice(0, 4), 16);
    return basePort + (hashNum % rangeSize);
}
/**
 * autoMagicSetup - generates complete server configuration
 *
 * creates a production-ready config with:
 * - secure random passwords
 * - auto-detected postgres settings
 * - per-project isolation via project hash
 * - sensible defaults for all options
 */
export async function autoMagicSetup() {
    logger.info('starting autoMagicSetup - lets configure this beast');
    // detect postgres
    const pgInfo = await detectThePostgresVibes();
    // generate secure database password
    const dbPassword = generateSecretSauce(32);
    // Get project-specific database name
    const projectDbName = getProjectDatabaseName();
    // Get project-specific port (for embedded postgres)
    const projectDbPort = process.env['SPECMEM_DB_PORT']
        ? parseInt(process.env['SPECMEM_DB_PORT'], 10)
        : getProjectPortFromHash(5500, 100);
    logger.info({ projectDbName, projectDbPort, projectHash: getProjectHash() }, 'using project-specific database configuration');
    // create config object
    const config = {
        database: {
            host: pgInfo.host,
            port: pgInfo.available ? pgInfo.port : projectDbPort,
            database: projectDbName,
            user: process.env['SPECMEM_DB_USER'] || 'specmem_westayunprofessional',
            password: dbPassword,
            maxConnections: 20,
            idleTimeout: 30000,
            connectionTimeout: 5000,
            ssl: false
        },
        embedding: {
            // DEPRECATED: dimensions is now auto-detected from the database pgvector column
            // Do NOT hardcode dimensions - they are dynamically detected from pg_attribute
            // The Frankenstein model outputs 384 dims, but DB may be migrated to any dimension
            // dimensions: 384,  // REMOVED - auto-detected from database
            model: 'text-embedding-3-small',
            batchSize: 100
        },
        consolidation: {
            autoEnabled: false,
            intervalMinutes: 60,
            minMemoriesForConsolidation: 5,
            similarityQueryLimit: 1000,
            temporalQueryLimit: 500,
            tagBasedQueryLimit: 50,
            importanceQueryLimit: 200
        },
        storage: {
            maxImageSizeBytes: 10 * 1024 * 1024, // 10MB
            allowedImageTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
        },
        logging: {
            level: 'info',
            prettyPrint: false
        },
        // Watcher - REQUIRED, always enabled by default
        watcher: {
            enabled: true,
            rootPath: process.env['SPECMEM_PROJECT_PATH'] || process.cwd(),
            debounceMs: 1000,
            autoRestart: true,
            maxRestarts: 5,
            maxFileSizeBytes: 1048576,
            autoDetectMetadata: true,
            queueMaxSize: 10000,
            queueBatchSize: 50,
            queueProcessingIntervalMs: 2000,
            syncCheckIntervalMinutes: 60
        },
        // Session watcher - REQUIRED, always enabled by default
        sessionWatcher: {
            enabled: true,
            debounceMs: 2000,
            importance: 'medium',
            additionalTags: []
        }
    };
    logger.info('autoMagicSetup completed - config generated successfully');
    return config;
}
/**
 * getConfigDirectory - returns the user's config directory
 * creates it if it doesn't exist
 */
export async function getConfigDirectory() {
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, '.specmem');
    try {
        await fs.mkdir(configDir, { recursive: true });
    }
    catch (err) {
        logger.warn({ err, configDir }, 'error creating config directory');
    }
    return configDir;
}
/**
 * getProjectRoot - returns the project root directory
 */
export function getProjectRoot() {
    // assuming this file is in src/config/autoConfig.ts
    return path.resolve(import.meta.url.replace('file://', ''), '../../..');
}
/**
 * saveConfigToFile - saves config to ~/.specmem/config.json
 */
export async function saveConfigToFile(config) {
    const configDir = await getConfigDirectory();
    const configPath = path.join(configDir, 'config.json');
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    // set restrictive permissions (only owner can read/write)
    await fs.chmod(configPath, 0o600);
    logger.info({ configPath }, 'config saved to file - secure permissions applied');
    return configPath;
}
/**
 * createEnvFile - creates .env file in project root
 */
export async function createEnvFile(config) {
    const projectRoot = getProjectRoot();
    const envPath = path.join(projectRoot, '.env');
    // check if .env already exists
    try {
        await fs.access(envPath);
        logger.warn({ envPath }, '.env already exists - backing up to .env.backup');
        // backup existing .env
        const backupPath = path.join(projectRoot, '.env.backup');
        await fs.copyFile(envPath, backupPath);
    }
    catch {
        // .env doesn't exist, we good
    }
    // generate .env content
    // Note: passwords MUST be quoted if they contain # (treated as comment) or other special chars
    const envContent = `# SpecMem Configuration - Auto-generated
# Generated at: ${new Date().toISOString()}

# PostgreSQL Database
SPECMEM_DB_HOST=${config.database.host}
SPECMEM_DB_PORT=${config.database.port}
SPECMEM_DB_NAME=${config.database.database}
SPECMEM_DB_USER=${config.database.user}
SPECMEM_DB_PASSWORD="${config.database.password}"
SPECMEM_DB_MAX_CONNECTIONS=${config.database.maxConnections}
SPECMEM_DB_IDLE_TIMEOUT=${config.database.idleTimeout}
SPECMEM_DB_CONNECTION_TIMEOUT=${config.database.connectionTimeout}
SPECMEM_DB_SSL=${config.database.ssl}

# Embedding Configuration
# Uses local embeddings - fully standalone, no external API needed
# NOTE: Dimensions are AUTO-DETECTED from the database pgvector column
# Do NOT configure SPECMEM_EMBEDDING_DIMENSIONS - it is DEPRECATED and ignored
# The dimension is determined by the Frankenstein model and the DB schema
SPECMEM_EMBEDDING_BATCH_SIZE=${config.embedding.batchSize}

# Coordination Server
SPECMEM_COORDINATION_ENABLED=true
SPECMEM_COORDINATION_PORT=3001

# Consolidation Settings
SPECMEM_AUTO_CONSOLIDATION=${config.consolidation.autoEnabled}
SPECMEM_CONSOLIDATION_INTERVAL=${config.consolidation.intervalMinutes}
SPECMEM_MIN_MEMORIES_CONSOLIDATION=${config.consolidation.minMemoriesForConsolidation}

# Storage Settings
SPECMEM_MAX_IMAGE_SIZE=${config.storage.maxImageSizeBytes}
SPECMEM_ALLOWED_IMAGE_TYPES=${config.storage.allowedImageTypes.join(',')}

# Logging
SPECMEM_LOG_LEVEL=${config.logging.level}
SPECMEM_LOG_PRETTY=${config.logging.prettyPrint}
`;
    await fs.writeFile(envPath, envContent, 'utf-8');
    // set restrictive permissions
    await fs.chmod(envPath, 0o600);
    logger.info({ envPath }, '.env file created - ready for standalone operation');
    return envPath;
}
/**
 * runAutoConfig - main entry point for auto-configuration
 *
 * orchestrates the entire auto-config process:
 * 1. Check if first run
 * 2. Detect postgres
 * 3. Generate config
 * 4. Save to files
 */
export async function runAutoConfig() {
    logger.info('running auto-config - this bout to be smooth fr');
    const isFirstRun = await isThisTheFirstRodeo();
    if (!isFirstRun) {
        // load existing config
        const configDir = await getConfigDirectory();
        const configPath = path.join(configDir, 'config.json');
        const projectRoot = getProjectRoot();
        const envPath = path.join(projectRoot, '.env');
        try {
            const configContent = await fs.readFile(configPath, 'utf-8');
            const config = JSON.parse(configContent);
            logger.info('loaded existing config - no generation needed');
            return {
                isFirstRun: false,
                configPath,
                envPath,
                config,
                wasGenerated: false
            };
        }
        catch (err) {
            logger.warn({ err }, 'error loading existing config, generating new one');
        }
    }
    // generate new config
    const config = await autoMagicSetup();
    // save to both locations
    const configPath = await saveConfigToFile(config);
    const envPath = await createEnvFile(config);
    logger.info({
        configPath,
        envPath,
        isFirstRun
    }, 'auto-config complete - SpecMem is ready to rock');
    return {
        isFirstRun,
        configPath,
        envPath,
        config,
        wasGenerated: true
    };
}
/**
 * syncConfigToUserFile - ALWAYS syncs current running config to ~/.specmem/config.json
 *
 * This ensures the hook ALWAYS has the latest config, even if .env changed
 * Called on EVERY startup - makes SpecMem deployable anywhere
 */
export async function syncConfigToUserFile(config) {
    try {
        const configPath = await saveConfigToFile(config);
        logger.info({ configPath }, 'config synced to user file - hooks will read fresh config');
    }
    catch (err) {
        logger.warn({ err }, 'failed to sync config to user file - hooks may have stale config');
    }
}
/**
 * Get the .specmem directory path for current project
 */
export function getLocalSpecMemDir() {
    return path.join(process.cwd(), '.specmem');
}
/**
 * Get the instance.json path for current project
 */
export function getInstanceConfigPath() {
    return path.join(getLocalSpecMemDir(), 'instance.json');
}
/**
 * createAtomicBackup - Create a backup of a file before modifying
 *
 * Uses timestamp-based naming for multiple backup versions
 * Returns the backup path for potential rollback
 */
export async function createAtomicBackup(filePath) {
    try {
        // Check if file exists
        try {
            await fs.access(filePath);
        }
        catch {
            // File doesn't exist, nothing to backup
            return null;
        }
        // Create backup with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${filePath}.backup.${timestamp}`;
        // Copy file atomically
        const content = await fs.readFile(filePath, 'utf-8');
        await fs.writeFile(backupPath, content, 'utf-8');
        logger.debug({ filePath, backupPath }, 'created atomic backup');
        return backupPath;
    }
    catch (err) {
        logger.warn({ err, filePath }, 'failed to create backup');
        return null;
    }
}
/**
 * atomicWriteFile - Write a file atomically using temp file + rename
 *
 * Prevents file corruption by writing to a temp file first,
 * then atomically renaming (which is atomic on most filesystems)
 */
export async function atomicWriteFile(filePath, content) {
    const tempPath = `${filePath}.tmp.${process.pid}`;
    try {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        // Write to temp file first
        await fs.writeFile(tempPath, content, 'utf-8');
        // Atomically rename temp to target
        await fs.rename(tempPath, filePath);
        // Set restrictive permissions for sensitive files
        if (filePath.includes('.env') || filePath.includes('config.json') || filePath.includes('instance.json')) {
            await fs.chmod(filePath, 0o600);
        }
        logger.debug({ filePath }, 'atomic file write completed');
    }
    catch (err) {
        // Clean up temp file on error
        try {
            await fs.unlink(tempPath);
        }
        catch {
            // Ignore cleanup errors
        }
        throw err;
    }
}
/**
 * rollbackFromBackup - Restore a file from its backup
 *
 * Used when a config update fails and we need to revert
 */
export async function rollbackFromBackup(originalPath, backupPath) {
    try {
        const content = await fs.readFile(backupPath, 'utf-8');
        await atomicWriteFile(originalPath, content);
        logger.info({ originalPath, backupPath }, 'rolled back to backup');
        return true;
    }
    catch (err) {
        logger.error({ err, originalPath, backupPath }, 'rollback failed');
        return false;
    }
}
/**
 * loadInstanceConfig - Load the current instance.json configuration
 */
export async function loadInstanceConfig() {
    const instancePath = getInstanceConfigPath();
    try {
        const content = await fs.readFile(instancePath, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
/**
 * saveInstanceConfig - Save instance configuration atomically
 *
 * Creates backup before updating, supports rollback on error
 * Uses project hash for per-project isolation
 */
export async function saveInstanceConfig(config) {
    const instancePath = getInstanceConfigPath();
    let backupPath = null;
    try {
        // Create backup of existing config
        backupPath = await createAtomicBackup(instancePath);
        // Get project hash for isolation
        const projectHash = getProjectHash();
        const projectDbName = getProjectDatabaseName();
        const projectDbPort = getProjectPortFromHash(5500, 100);
        // Load existing config and merge
        const existingConfig = await loadInstanceConfig() || {
            projectPath: process.cwd(),
            projectHash: projectHash,
            databaseName: projectDbName,
            databasePort: projectDbPort
        };
        const updatedConfig = {
            ...existingConfig,
            ...config,
            lastConfigUpdate: new Date().toISOString(),
            configVersion: (existingConfig.configVersion || 0) + 1
        };
        // Write atomically
        await atomicWriteFile(instancePath, JSON.stringify(updatedConfig, null, 2));
        logger.info({ instancePath, config }, 'instance config saved successfully');
        return {
            success: true,
            message: 'Instance configuration saved',
            backupPath: backupPath || undefined,
            changedFields: Object.keys(config)
        };
    }
    catch (err) {
        // Attempt rollback if we have a backup
        if (backupPath) {
            await rollbackFromBackup(instancePath, backupPath);
        }
        logger.error({ err, instancePath }, 'failed to save instance config');
        return {
            success: false,
            message: `Failed to save instance config: ${err.message}`
        };
    }
}
/**
 * updateEnvFile - Update a specific variable in specmem.env or .env
 *
 * Handles atomic updates with backup and rollback
 */
export async function updateEnvFile(varName, value, envFilePath) {
    // Find the env file to update
    const envPaths = [
        envFilePath,
        path.join(process.cwd(), 'specmem.env'),
        path.join(process.cwd(), '.env'),
    ].filter(Boolean);
    for (const envPath of envPaths) {
        try {
            await fs.access(envPath);
            // Create backup
            const backupPath = await createAtomicBackup(envPath);
            // Read current content
            let content = await fs.readFile(envPath, 'utf-8');
            // Check if variable exists and update or append
            const regex = new RegExp(`^${varName}=.*$`, 'm');
            if (regex.test(content)) {
                content = content.replace(regex, `${varName}=${value}`);
            }
            else {
                // Append the new variable
                content = content.trimEnd() + `\n${varName}=${value}\n`;
            }
            // Write atomically
            await atomicWriteFile(envPath, content);
            logger.info({ envPath, varName }, 'env file updated successfully');
            return {
                success: true,
                message: `Updated ${varName} in ${envPath}`,
                backupPath: backupPath || undefined,
                changedFields: [varName]
            };
        }
        catch {
            // Try next path
            continue;
        }
    }
    return {
        success: false,
        message: `Could not find env file to update ${varName}`
    };
}
/**
 * persistDashboardMode - Persist dashboard mode changes to both instance.json and specmem.env
 *
 * Updates:
 * - .specmem/instance.json with mode/host/port
 * - specmem.env with SPECMEM_DASHBOARD_MODE and related vars
 *
 * Returns whether a restart is required (mode change requires rebinding)
 */
export async function persistDashboardMode(config) {
    const changedFields = [];
    const errors = [];
    let requiresRestart = false;
    // Load current config to detect changes
    const currentInstance = await loadInstanceConfig();
    const currentMode = currentInstance?.dashboardMode;
    const currentHost = currentInstance?.dashboardHost;
    const currentPort = currentInstance?.dashboardPort;
    // Detect if mode/host changes require restart
    if (currentMode && currentMode !== config.mode) {
        requiresRestart = true;
        changedFields.push('mode');
    }
    if (config.mode === 'public' && currentHost && currentHost !== config.host) {
        requiresRestart = true;
        changedFields.push('host');
    }
    if (currentPort && config.port && currentPort !== config.port) {
        requiresRestart = true;
        changedFields.push('port');
    }
    // Save to instance.json
    const instanceResult = await saveInstanceConfig({
        dashboardMode: config.mode,
        dashboardHost: config.host,
        dashboardPort: config.port
    });
    if (!instanceResult.success) {
        errors.push(instanceResult.message);
    }
    // Update specmem.env with mode
    const modeResult = await updateEnvFile('SPECMEM_DASHBOARD_MODE', config.mode);
    if (!modeResult.success) {
        errors.push(modeResult.message);
    }
    else {
        changedFields.push('SPECMEM_DASHBOARD_MODE');
    }
    // Update host if in public mode
    if (config.mode === 'public' && config.host) {
        const hostResult = await updateEnvFile('SPECMEM_DASHBOARD_HOST', config.host);
        if (hostResult.success) {
            changedFields.push('SPECMEM_DASHBOARD_HOST');
        }
    }
    // Update port if specified
    if (config.port) {
        const portResult = await updateEnvFile('SPECMEM_DASHBOARD_PORT', config.port.toString());
        if (portResult.success) {
            changedFields.push('SPECMEM_DASHBOARD_PORT');
        }
    }
    // Update password if specified - use unified password service
    if (config.password) {
        // Use the unified password service for persistence
        const persisted = await persistPasswordToEnv(config.password);
        if (persisted) {
            // Also update runtime password
            setPassword(config.password);
            changedFields.push('SPECMEM_PASSWORD');
        }
    }
    // Also update process.env for immediate effect (hot reload where possible)
    if (config.mode)
        process.env['SPECMEM_DASHBOARD_MODE'] = config.mode;
    if (config.host)
        process.env['SPECMEM_DASHBOARD_HOST'] = config.host;
    if (config.port)
        process.env['SPECMEM_DASHBOARD_PORT'] = config.port.toString();
    if (errors.length > 0) {
        return {
            success: false,
            message: errors.join('; '),
            changedFields,
            requiresRestart
        };
    }
    return {
        success: true,
        message: requiresRestart
            ? 'Dashboard mode updated. Server restart required to apply changes.'
            : 'Dashboard mode updated. Changes applied.',
        changedFields,
        requiresRestart
    };
}
/**
 * cleanupOldBackups - Remove backup files older than specified age
 *
 * Keeps the filesystem clean while maintaining recent backups
 */
export async function cleanupOldBackups(directory, maxAgeMs = 24 * 60 * 60 * 1000) {
    let cleaned = 0;
    try {
        const files = await fs.readdir(directory);
        const now = Date.now();
        for (const file of files) {
            if (file.includes('.backup.')) {
                const filePath = path.join(directory, file);
                try {
                    const stats = await fs.stat(filePath);
                    if (now - stats.mtimeMs > maxAgeMs) {
                        await fs.unlink(filePath);
                        cleaned++;
                    }
                }
                catch {
                    // Ignore individual file errors
                }
            }
        }
        if (cleaned > 0) {
            logger.info({ directory, cleaned }, 'cleaned up old backup files');
        }
    }
    catch (err) {
        logger.debug({ err, directory }, 'failed to cleanup backups');
    }
    return cleaned;
}
//# sourceMappingURL=autoConfig.js.map