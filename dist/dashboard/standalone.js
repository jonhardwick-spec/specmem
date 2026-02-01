/**
 * Standalone Dashboard Server Entry Point
 *
 * This file is the entry point for running the SpecMem dashboard as a standalone process.
 * Can be run directly with Node.js when running the dashboard separately from the main MCP server.
 *
 * Usage: node dist/dashboard/standalone.js
 *        scripts/dashboard-standalone.sh           (foreground mode)
 *        scripts/dashboard-standalone.sh -d        (daemon mode)
 *
 * Features:
 * - NO PM2 DEPENDENCY - uses native Node.js process management
 * - Project-scoped ports via portAllocator (based on SPECMEM_PROJECT_PATH)
 * - Simple daemon mode with nohup + PID file (via shell script)
 * - Graceful shutdown on SIGTERM/SIGINT
 *
 * Environment Variables (loaded automatically from .env file):
 *   SPECMEM_PROJECT_PATH - Project path for per-project isolation (default: cwd)
 *   SPECMEM_DASHBOARD_PORT - Port to listen on (default: auto-allocated per-project)
 *   SPECMEM_DASHBOARD_HOST - Host to bind to (default: 127.0.0.1)
 *   SPECMEM_PASSWORD - Login password for dashboard
 *   SPECMEM_DASHBOARD_PASSWORD - Alternate password config (fallback)
 *   SPECMEM_COORDINATION_PORT - Coordination server port (default: auto-allocated per-project)
 *   SPECMEM_DASHBOARD_MAX_RETRIES - Max startup retries (default: 3)
 */
// Load .env file FIRST before any other imports that might use env vars
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
// Get the directory where this file is located and find .env in project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Navigate from dist/dashboard/ up to project root
const projectRoot = resolve(__dirname, '..', '..');
const envPath = resolve(projectRoot, '.env');
// Load environment variables from .env file
dotenv.config({ path: envPath });
import { getDashboardServer, resetDashboardServer } from './webServer.js';
import { logger } from '../utils/logger.js';
import { getPassword, isUsingDefaultPassword } from '../config/password.js';
import { getEmbeddingTimeout } from '../config/embeddingTimeouts.js';
import { createConnection } from 'net';
import { ClaudeSessionWatcher } from '../claude-sessions/sessionWatcher.js';
/**
 * Simple embedding provider that connects to Frankenstein via Unix socket
 * FULLY DYNAMIC - no hardcoded dimensions!
 * Uses adaptive timeout based on actual response times
 */
class SocketEmbeddingProvider {
    socketPath;
    detectedDimension = null;
    // Adaptive timeout tracking
    responseTimes = [];
    static RESPONSE_TIME_WINDOW = 20;
    // UNIFIED TIMEOUT CONFIG: Set SPECMEM_EMBEDDING_TIMEOUT (seconds) to control ALL timeouts
    // See src/config/embeddingTimeouts.ts for full documentation
    static MIN_TIMEOUT_MS = getEmbeddingTimeout('min');
    static MAX_TIMEOUT_MS = getEmbeddingTimeout('max');
    static INITIAL_TIMEOUT_MS = getEmbeddingTimeout('initial');
    static TIMEOUT_MULTIPLIER = 3;
    constructor(socketPath) {
        this.socketPath = socketPath;
    }
    /**
     * Calculate adaptive timeout based on recent response times
     */
    getAdaptiveTimeout() {
        if (this.responseTimes.length < 3) {
            return SocketEmbeddingProvider.INITIAL_TIMEOUT_MS;
        }
        const sum = this.responseTimes.reduce((a, b) => a + b, 0);
        const mean = sum / this.responseTimes.length;
        const squaredDiffs = this.responseTimes.map(t => Math.pow(t - mean, 2));
        const stdDev = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length);
        const adaptiveTimeout = mean + (SocketEmbeddingProvider.TIMEOUT_MULTIPLIER * stdDev);
        return Math.max(SocketEmbeddingProvider.MIN_TIMEOUT_MS, Math.min(SocketEmbeddingProvider.MAX_TIMEOUT_MS, adaptiveTimeout));
    }
    recordResponseTime(ms) {
        this.responseTimes.push(ms);
        if (this.responseTimes.length > SocketEmbeddingProvider.RESPONSE_TIME_WINDOW) {
            this.responseTimes.shift();
        }
    }
    /**
     * Get the dimension of embeddings this provider generates
     */
    async getEmbeddingDimension() {
        if (this.detectedDimension) {
            return this.detectedDimension;
        }
        // Detect by generating a test embedding
        const testEmbedding = await this.generateEmbedding('test');
        this.detectedDimension = testEmbedding.length;
        logger.info({ dimension: this.detectedDimension }, 'Detected embedding dimension from provider');
        return this.detectedDimension;
    }
    async generateEmbedding(text) {
        return new Promise((resolve, reject) => {
            const socket = createConnection(this.socketPath);
            const startTime = Date.now();
            const timeoutMs = this.getAdaptiveTimeout();
            const timeoutId = setTimeout(() => {
                socket.destroy();
                reject(new Error(`Embedding timeout after ${Math.round(timeoutMs / 1000)}s (adaptive)`));
            }, timeoutMs);
            let responseData = '';
            socket.on('connect', () => {
                socket.write(JSON.stringify({ type: 'embed', text }) + '\n');
            });
            socket.on('data', (chunk) => {
                responseData += chunk.toString();
                if (responseData.includes('\n')) {
                    clearTimeout(timeoutId);
                    this.recordResponseTime(Date.now() - startTime);
                    try {
                        const response = JSON.parse(responseData.trim());
                        if (response.error) {
                            reject(new Error(response.error));
                        }
                        else {
                            resolve(response.embedding);
                        }
                    }
                    catch (err) {
                        reject(new Error(`Failed to parse embedding response: ${err}`));
                    }
                    socket.end();
                }
            });
            socket.on('error', (err) => {
                clearTimeout(timeoutId);
                reject(err);
            });
        });
    }
}
// Import port allocator for project-scoped ports
import { getInstancePorts } from '../utils/portAllocator.js';
// Configuration from environment variables (with project-scoped port allocation)
// Ports will be auto-allocated per-project if not explicitly set via environment
const host = process.env['SPECMEM_DASHBOARD_HOST'] || '127.0.0.1';
// Use centralized password module - will resolve from SPECMEM_PASSWORD, SPECMEM_DASHBOARD_PASSWORD, etc.
const password = getPassword();
const maxRetries = parseInt(process.env['SPECMEM_DASHBOARD_MAX_RETRIES'] || '3', 10);
// Initialize ports - will use env vars if set, otherwise auto-allocate per-project
let port;
let coordinationPort;
// We'll initialize ports in the async startup function to allow for project-scoped allocation
// Warn if using default password (security concern)
if (isUsingDefaultPassword()) {
    logger.warn('Using default password - please set SPECMEM_PASSWORD or SPECMEM_DASHBOARD_PASSWORD for production!');
    logger.warn(`Checked .env file at: ${envPath}`);
}
let dashboardServer = null;
let sessionWatcher = null;
let isShuttingDown = false;
/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        logger.info({ signal }, 'shutdown already in progress, ignoring duplicate signal');
        return;
    }
    isShuttingDown = true;
    logger.info({ signal }, 'received shutdown signal, gracefully stopping dashboard...');
    try {
        // Stop session watcher if running
        if (sessionWatcher) {
            await sessionWatcher.stopWatching();
            logger.info('session watcher stopped');
        }
        await resetDashboardServer();
        logger.info('dashboard server stopped successfully');
    }
    catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'error during dashboard shutdown');
    }
    process.exit(0);
}
/**
 * Start the standalone dashboard server
 */
async function startDashboard() {
    // Initialize project-scoped ports
    // Uses SPECMEM_PROJECT_PATH env var (set by shell scripts) to determine project isolation
    const projectPath = process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
    try {
        // Get project-scoped ports (will persist to .specmem/ports.json)
        const allocatedPorts = await getInstancePorts(projectPath);
        // Use env var if explicitly set, otherwise use allocated ports
        port = process.env['SPECMEM_DASHBOARD_PORT']
            ? parseInt(process.env['SPECMEM_DASHBOARD_PORT'], 10)
            : allocatedPorts.dashboard;
        coordinationPort = process.env['SPECMEM_COORDINATION_PORT']
            ? parseInt(process.env['SPECMEM_COORDINATION_PORT'], 10)
            : allocatedPorts.coordination;
        logger.info({
            projectPath,
            projectHash: allocatedPorts.projectHash,
            allocatedPorts: {
                dashboard: allocatedPorts.dashboard,
                coordination: allocatedPorts.coordination,
                postgres: allocatedPorts.postgres
            },
            usingPorts: { dashboard: port, coordination: coordinationPort }
        }, 'project-scoped ports initialized');
    }
    catch (portError) {
        // Fallback to dynamic ports from portAllocator if full allocation fails
        logger.warn({ error: portError }, 'Port allocation failed, using portAllocator fallback');
        const { getDashboardPort, getCoordinationPort } = await import('../utils/portAllocator.js');
        port = parseInt(process.env['SPECMEM_DASHBOARD_PORT'] || '', 10) || getDashboardPort();
        coordinationPort = parseInt(process.env['SPECMEM_COORDINATION_PORT'] || '', 10) || getCoordinationPort();
    }
    logger.info({
        port,
        host,
        coordinationPort,
        maxRetries
    }, 'starting standalone dashboard server...');
    // Retry loop with exponential backoff
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            dashboardServer = getDashboardServer({
                port,
                host,
                password,
                coordinationPort,
                maxPortAttempts: 10,
                maxStartupRetries: 2,
                retryDelayMs: 1000
            });
            // Initialize Frankenstein embedding provider for semantic search
            // Use centralized config for socket path
            const { getEmbeddingSocketPath } = await import('../config.js');
            const embeddingSocket = getEmbeddingSocketPath();
            logger.info({ socket: embeddingSocket }, 'Connecting to Frankenstein embeddings...');
            let embeddingProvider = null;
            try {
                embeddingProvider = new SocketEmbeddingProvider(embeddingSocket);
                // DYNAMIC DIMENSION DETECTION
                const detectedDim = await embeddingProvider.getEmbeddingDimension();
                logger.info({ detectedDimension: detectedDim }, 'Auto-detected embedding dimension');
                dashboardServer.setEmbeddingProvider(embeddingProvider);
                logger.info('Frankenstein embeddings connected - FULL semantic search enabled!');
            }
            catch (embeddingError) {
                logger.warn({ error: embeddingError }, 'Failed to connect to Frankenstein - running in text-only mode');
                logger.info('dashboard running in standalone mode - text search only (no semantic embeddings)');
            }
            await dashboardServer.start();
            // AUTO-MIGRATION: Check DB dimension and migrate if needed (AFTER start() initializes db!)
            if (embeddingProvider) {
                const db = dashboardServer.db;
                if (db) {
                    try {
                        // CRITICAL: Set search_path BEFORE any migration queries to ensure
                        // we're operating on the correct project's schema
                        const { getProjectSchema } = await import('../db/projectNamespacing.js');
                        const schemaName = getProjectSchema();
                        await db.query(`SET search_path TO ${schemaName}, public`);
                        logger.info({ schemaName }, 'Search path set for auto-migration');
                        const detectedDim = await embeddingProvider.getEmbeddingDimension();
                        const result = await db.query(`
              SELECT atttypmod
              FROM pg_attribute
              WHERE attrelid = 'memories'::regclass
              AND attname = 'embedding'
            `);
                        const currentDim = result.rows[0]?.atttypmod; // pgvector stores dimension directly in atttypmod
                        if (currentDim !== detectedDim) {
                            logger.warn({ currentDim, detectedDim, schemaName }, 'Dimension mismatch - auto-migrating database...');
                            // Count existing memories
                            const countResult = await db.query('SELECT COUNT(*) as count FROM memories');
                            const memoryCount = parseInt(countResult.rows[0]?.count || '0', 10);
                            logger.warn({ memoryCount, currentDim, detectedDim, schemaName }, `Truncating ${memoryCount} memories with wrong dimension...`);
                            // Drop ALL dependent objects (views, materialized views, indexes)
                            await db.query('DROP MATERIALIZED VIEW IF EXISTS memory_stats CASCADE');
                            await db.query('DROP MATERIALIZED VIEW IF EXISTS spatial_memory_stats CASCADE');
                            await db.query('DROP VIEW IF EXISTS memories_recent CASCADE');
                            await db.query('DROP VIEW IF EXISTS memories_active CASCADE');
                            await db.query(`DROP INDEX IF EXISTS idx_memories_embedding_hnsw`);
                            await db.query(`DROP INDEX IF EXISTS idx_memories_embedding_ivfflat`);
                            await db.query(`DROP INDEX IF EXISTS idx_memories_embedding`);
                            // TRUNCATE memories table (existing embeddings have wrong dimensions!)
                            await db.query('TRUNCATE TABLE memories CASCADE');
                            logger.info({ schemaName }, 'Memories table truncated - ready for fresh catch-up');
                            // Alter embedding column to match detected dimension
                            await db.query(`ALTER TABLE memories ALTER COLUMN embedding TYPE vector(${detectedDim})`);
                            // Recreate HNSW index for fast semantic search
                            await db.query(`CREATE INDEX idx_memories_embedding_hnsw ON memories USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`);
                            logger.info({ newDimension: detectedDim, schemaName }, 'Database auto-migrated to match embedding dimension!');
                        }
                        else {
                            logger.info({ dimension: detectedDim, schemaName }, 'Database dimension matches - no migration needed');
                        }
                    }
                    catch (migrationError) {
                        logger.warn({ error: migrationError }, 'Could not auto-migrate dimension - continuing anyway');
                    }
                }
            }
            // Start session watcher if enabled
            const sessionWatcherEnabled = process.env['SPECMEM_SESSION_WATCHER_ENABLED'] === 'true';
            const db = dashboardServer ? dashboardServer.db : null;
            if (sessionWatcherEnabled && embeddingProvider && db) {
                try {
                    sessionWatcher = new ClaudeSessionWatcher(embeddingProvider, db, {
                        autoStart: true,
                        importance: 'medium',
                        additionalTags: []
                    });
                    logger.info('Session watcher started - auto-extracting Claude sessions');
                }
                catch (watcherError) {
                    logger.warn({ error: watcherError }, 'Failed to start session watcher');
                }
            }
            else if (sessionWatcherEnabled) {
                logger.warn('Session watcher enabled but missing dependencies (embeddings or db)');
            }
            const actualPort = dashboardServer.getActualPort();
            logger.info({
                port: actualPort,
                configuredPort: port,
                host,
                url: `http://${host}:${actualPort}`,
                attempt
            }, 'STANDALONE DASHBOARD SERVER STARTED - TACTICAL OPS READY');
            return; // Success!
        }
        catch (error) {
            logger.warn({
                error: error instanceof Error ? error.message : String(error),
                attempt,
                maxRetries
            }, 'dashboard startup attempt failed');
            // Reset for next attempt
            try {
                await resetDashboardServer();
            }
            catch (resetError) {
                logger.debug({ resetError }, 'error resetting dashboard server');
            }
            dashboardServer = null;
            // Wait before retry with exponential backoff (1s, 2s, 4s...)
            if (attempt < maxRetries) {
                const delay = 1000 * Math.pow(2, attempt - 1);
                logger.info({ delayMs: delay }, 'waiting before dashboard retry');
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    // All retries exhausted
    logger.error({
        port,
        host,
        maxRetries
    }, 'DASHBOARD SERVER STARTUP FAILED - all retries exhausted');
    process.exit(1);
}
// Register shutdown handlers BEFORE starting
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
// Handle uncaught errors
process.on('uncaughtException', (error) => {
    logger.error({ error: error.message, stack: error.stack }, 'uncaught exception in dashboard');
    gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, 'unhandled rejection in dashboard');
    gracefulShutdown('unhandledRejection');
});
// Start the dashboard
startDashboard().catch((error) => {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'failed to start dashboard');
    process.exit(1);
});
//# sourceMappingURL=standalone.js.map