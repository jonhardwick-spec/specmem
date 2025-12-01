/**
 * First Run Detection and Setup
 *
 * yo this handles first-time setup and configuration
 * creates config files, runs initial migrations, etc.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger.js';
/**
 * Get the config directory path
 * yo where we storing config fr
 */
function getConfigDir() {
    return path.join(os.homedir(), '.specmem');
}
/**
 * Get the config file path
 * nah bruh where the config at
 */
function getConfigPath() {
    return path.join(getConfigDir(), 'config.json');
}
/**
 * Get the first-run marker path
 * yo where we marking this as installed
 */
function getMarkerPath() {
    return path.join(process.cwd(), '.installed');
}
/**
 * Check if this is the first run
 * is this the first rodeo fr fr
 */
export function isThisTheFirstRodeo() {
    const configPath = getConfigPath();
    const markerPath = getMarkerPath();
    return !fs.existsSync(configPath) && !fs.existsSync(markerPath);
}
/**
 * Create config directory if it doesn't exist
 * yo make that config dir
 */
function ensureConfigDir() {
    const configDir = getConfigDir();
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
        logger.info({ path: configDir }, 'created config directory');
    }
}
/**
 * Detect embedding provider
 * Always uses local embeddings - no external API needed
 */
function detectEmbeddingProvider() {
    return 'local';
}
/**
 * Check if database is configured
 * yo do we have db creds
 */
function isDatabaseConfigured() {
    return !!(process.env.SPECMEM_DB_PASSWORD ||
        fs.existsSync(path.join(process.cwd(), '.env')));
}
/**
 * Create initial configuration
 * yo setup that config file fr fr
 */
export function createInitialConfig() {
    ensureConfigDir();
    const config = {
        installedAt: new Date().toISOString(),
        version: '1.0.0',
        dbConfigured: isDatabaseConfigured(),
        embeddingProvider: detectEmbeddingProvider(),
        watcherEnabled: process.env.SPECMEM_WATCHER_ENABLED === 'true'
    };
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    logger.info({ path: configPath }, 'created initial configuration');
    return config;
}
/**
 * Load existing configuration
 * yo load that config
 */
export function loadConfig() {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
        return null;
    }
    try {
        const data = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(data);
    }
    catch (err) {
        logger.error({ err }, 'failed to load config');
        return null;
    }
}
/**
 * Mark installation as complete
 * yo mark this as installed fr fr
 */
export function markAsInstalled() {
    const markerPath = getMarkerPath();
    const timestamp = new Date().toISOString();
    fs.writeFileSync(markerPath, timestamp, { mode: 0o600 });
    logger.info({ path: markerPath }, 'marked as installed');
}
/**
 * Create default .env file if it doesn't exist
 * yo setup that .env file
 */
export function createDefaultEnvFile() {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        logger.info('.env file already exists, skipping');
        return;
    }
    const defaultEnv = `# SpecMem Configuration
# Created: ${new Date().toISOString()}
# Standalone memory server with local embeddings - no external API needed

# Database Configuration (REQUIRED)
SPECMEM_DB_HOST=localhost
SPECMEM_DB_PORT=5432
SPECMEM_DB_NAME=specmem_westayunprofessional
SPECMEM_DB_USER=specmem_westayunprofessional
SPECMEM_DB_PASSWORD=specmem_westayunprofessional

# Embedding Configuration
# Uses local embeddings - fully standalone
# NOTE: Dimensions are AUTO-DETECTED from the database pgvector column
# Do NOT configure SPECMEM_EMBEDDING_DIMENSIONS - it is DEPRECATED and ignored
# The dimension is determined by the Frankenstein model and the DB schema

# Coordination Server
SPECMEM_COORDINATION_ENABLED=true
SPECMEM_COORDINATION_PORT=3001

# Watcher Configuration (OPTIONAL)
SPECMEM_WATCHER_ENABLED=false
SPECMEM_WATCHER_ROOT_PATH=
SPECMEM_WATCHER_IGNORE_PATH=

# Logging
SPECMEM_LOG_LEVEL=info
SPECMEM_LOG_PRETTY=false

# Consolidation (OPTIONAL)
SPECMEM_AUTO_CONSOLIDATION=false
SPECMEM_CONSOLIDATION_INTERVAL=60
`;
    fs.writeFileSync(envPath, defaultEnv, { mode: 0o600 });
    logger.info({ path: envPath }, 'created default .env file');
}
/**
 * Show first-run welcome message
 * yo welcome the user fr fr
 */
export function showWelcomeMessage(config) {
    logger.info('='.repeat(60));
    logger.info('Welcome to SpecMem - Speculative Memory MCP Server');
    logger.info('='.repeat(60));
    logger.info({
        installedAt: config.installedAt,
        version: config.version,
        dbConfigured: config.dbConfigured,
        embeddingProvider: config.embeddingProvider,
        watcherEnabled: config.watcherEnabled
    }, 'Configuration:');
    logger.info(`  Installed: ${config.installedAt}`);
    logger.info(`  Version: ${config.version}`);
    logger.info(`  Database: ${config.dbConfigured ? 'Configured' : 'Not configured'}`);
    logger.info(`  Embeddings: ${config.embeddingProvider}`);
    logger.info(`  Watcher: ${config.watcherEnabled ? 'Enabled' : 'Disabled'}`);
    if (!config.dbConfigured) {
        logger.warn('WARNING: Database not configured');
        logger.warn('SpecMem requires PostgreSQL with pgvector extension.');
        logger.warn('Check the INSTALL.md file for setup instructions.');
    }
    if (config.embeddingProvider === 'local') {
        logger.info('Using local standalone embeddings - no external API needed.');
    }
    logger.info('='.repeat(60));
}
/**
 * Run first-time setup
 * yo do all the first run stuff fr fr
 */
export async function runFirstTimeSetup() {
    logger.info('running first-time setup...');
    // create default .env if needed
    createDefaultEnvFile();
    // create config
    const config = createInitialConfig();
    // mark as installed
    markAsInstalled();
    // show welcome message
    showWelcomeMessage(config);
    logger.info('first-time setup complete');
    return config;
}
//# sourceMappingURL=firstRun.js.map