// yoooo this connection pool straight up BUSSIN no cap
// handles all the postgres connection drip
// skids cant even comprehend this scalability fr fr
// @ts-ignore - pg types not installed
import pg from 'pg';
import { logger } from '../utils/logger.js';
import { registerCleanupHandler, unregisterCleanupHandler } from '../utils/cleanupHandler.js';
import { loadConfig } from '../config.js';
// Schema isolation - get project schema for search_path
import { getProjectSchema } from './projectNamespacing.js';
const { Pool, types } = pg;
// nah bruh we gotta fix these postgres type parsers
// otherwise numbers come back as strings and thats NOT IT
types.setTypeParser(1700, parseFloat); // numeric/decimal
types.setTypeParser(20, parseInt); // bigint
const DEFAULT_POOL_SETTINGS = {
    maxConnections: 100, // bruh we scaling to the MOON
    minConnections: 5, // keep some warm connections fr
    idleTimeoutMs: 30000, // 30 sec timeout on idle connections
    connectionTimeoutMs: 30000, // 30 sec to establish connection
    statementTimeoutMs: 30000, // 30 sec statement timeout
    queryTimeoutMs: 60000, // 1 min query timeout for thicc queries
    healthCheckIntervalMs: 30000, // health check every 30 sec
    retryAttempts: 3, // retry this many times on failure
    retryDelayMs: 1000 // wait 1 sec between retries
};
/**
 * ConnectionPoolGoBrrr - the most GOATED postgres connection manager
 * handles 100+ concurrent connections like its nothing fr
 * auto reconnects, health checks, all that good stuff
 *
 * features that go crazy:
 * - connection pooling (duh)
 * - automatic retry with exponential backoff
 * - health monitoring that NEVER sleeps
 * - query performance tracking
 * - transaction management thats actually fire
 */
export class ConnectionPoolGoBrrr {
    pool;
    config;
    poolSettings;
    isAlive = false;
    healthCheckInterval = null;
    queryCount = 0;
    slowQueryCount = 0;
    errorCount = 0;
    lastHealthCheck = null;
    cleanupHandlerId = null;
    errorHandlerCleanupId = null;
    // HIGH-08 FIX: Store listener references for proper cleanup before recreate
    currentErrorHandler = null;
    currentConnectHandler = null;
    currentAcquireHandler = null;
    currentRemoveHandler = null;
    constructor(config, poolSettings) {
        this.config = config;
        this.poolSettings = { ...DEFAULT_POOL_SETTINGS, ...poolSettings };
        this.pool = this.spawnThePool();
        this.setupPoolListeners();
        // Log with project isolation info for debugging
        const projectHash = process.env['SPECMEM_PROJECT_HASH'] || 'default';
        const projectPath = process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
        logger.info({
            host: config.host,
            port: config.port,
            database: config.database,
            projectHash,
            projectPath: projectPath.slice(-50), // Last 50 chars for readability
            maxConnections: this.poolSettings.maxConnections
        }, 'ConnectionPoolGoBrrr initialized with project-scoped database');
    }
    // creates the actual pg pool with all the drip settings
    spawnThePool() {
        return new Pool({
            host: this.config.host,
            port: this.config.port,
            database: this.config.database,
            user: this.config.user,
            password: this.config.password,
            max: this.poolSettings.maxConnections,
            min: this.poolSettings.minConnections,
            idleTimeoutMillis: this.poolSettings.idleTimeoutMs,
            connectionTimeoutMillis: this.poolSettings.connectionTimeoutMs,
            statement_timeout: this.poolSettings.statementTimeoutMs,
            query_timeout: this.poolSettings.queryTimeoutMs,
            ssl: this.config.ssl,
            // these pragmas go CRAZY for performance
            application_name: 'specmem-goBrrr'
        });
    }
    // HIGH-08 FIX: Clean up existing listeners before setting up new ones
    // This prevents duplicate listeners when pool is recreated
    cleanupPoolListeners() {
        if (this.currentErrorHandler) {
            this.pool.removeListener('error', this.currentErrorHandler);
        }
        if (this.currentConnectHandler) {
            this.pool.removeListener('connect', this.currentConnectHandler);
        }
        if (this.currentAcquireHandler) {
            this.pool.removeListener('acquire', this.currentAcquireHandler);
        }
        if (this.currentRemoveHandler) {
            this.pool.removeListener('remove', this.currentRemoveHandler);
        }
        // Unregister cleanup handlers to prevent leaks
        if (this.errorHandlerCleanupId) {
            unregisterCleanupHandler(this.errorHandlerCleanupId);
            this.errorHandlerCleanupId = null;
        }
        if (this.cleanupHandlerId) {
            unregisterCleanupHandler(this.cleanupHandlerId);
            this.cleanupHandlerId = null;
        }
        logger.debug('cleaned up all pool listeners - fresh slate fr');
    }
    // sets up all the event listeners so we know whats happening
    setupPoolListeners() {
        // HIGH-08 FIX: Clean up existing listeners first to prevent duplicates on recreate
        this.cleanupPoolListeners();
        // Store error handler reference for cleanup
        this.currentErrorHandler = (err) => {
            this.errorCount++;
            logger.error({ err, errorCount: this.errorCount }, 'pool error - NOT GOOD bruh');
        };
        this.pool.on('error', this.currentErrorHandler);
        // Register cleanup handler for error listener
        this.errorHandlerCleanupId = registerCleanupHandler('ConnectionPoolGoBrrr:errorHandler', () => {
            if (this.currentErrorHandler) {
                this.pool.removeListener('error', this.currentErrorHandler);
            }
        }, 10 // High priority - remove listeners early
        );
        // SCHEMA ISOLATION FIX: Track pending search_path operations per client
        // The connect event doesn't wait for async ops, so we track them separately
        const pendingSearchPaths = new WeakMap();
        this.currentConnectHandler = (client) => {
            // Set search_path - store promise for potential waiting
            // NOTE: pg doesn't await connect handler, so this is fire-and-forget
            // Critical paths use getClientWithSchema() which explicitly awaits
            try {
                const schemaName = getProjectSchema();
                // Use quoted identifier format with escaped quotes for safety
                const safeSchema = '"' + schemaName.replace(/"/g, '""') + '"';
                const searchPathPromise = client.query('SET search_path TO ' + safeSchema + ', public')
                    .then(() => {
                    logger.debug({ schemaName }, 'search_path configured for project isolation');
                })
                    .catch((err) => {
                    logger.warn({ err, schemaName }, 'failed to set search_path on connection');
                });
                pendingSearchPaths.set(client, searchPathPromise);
            }
            catch (err) {
                // getProjectSchema() failed - this is CRITICAL for schema isolation
                // Log error and set search_path to public only as fallback
                logger.error({ err }, 'CRITICAL: could not determine project schema - queries may hit wrong schema!');
                client.query('SET search_path TO public')
                    .catch((qErr) => logger.warn({ qErr }, 'failed to set fallback search_path'));
            }
        };
        this.pool.on('connect', this.currentConnectHandler);
        this.currentAcquireHandler = () => {
            logger.trace('client acquired from pool');
        };
        this.pool.on('acquire', this.currentAcquireHandler);
        this.currentRemoveHandler = () => {
            logger.debug('connection removed from pool - cleaning up');
        };
        this.pool.on('remove', this.currentRemoveHandler);
        // Register main cleanup handler
        this.cleanupHandlerId = registerCleanupHandler('ConnectionPoolGoBrrr:shutdown', async () => {
            await this.shutdown();
        }, 20 // Run after listener removal
        );
    }
    // wakes up the pool and makes sure everything is gucci
    async wakeUp() {
        if (this.isAlive) {
            logger.debug('pool already awake bro');
            return;
        }
        // test the connection real quick
        const client = await this.pool.connect();
        try {
            await client.query('SELECT 1 as alive');
            this.isAlive = true;
            this.startHealthMonitor();
            logger.info('ConnectionPoolGoBrrr is AWAKE and ready to serve');
        }
        finally {
            client.release();
        }
    }
    // health check loop that runs forever checking if we good
    startHealthMonitor() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        this.healthCheckInterval = setInterval(async () => {
            try {
                const start = Date.now();
                await this.pool.query('SELECT 1');
                const latency = Date.now() - start;
                this.lastHealthCheck = new Date();
                if (latency > 100) {
                    // nah bruh thats kinda slow
                    logger.warn({ latency }, 'health check latency kinda mid');
                }
                else {
                    logger.trace({ latency }, 'health check passed - we chillin');
                }
            }
            catch (err) {
                this.errorCount++;
                logger.error({ err }, 'health check FAILED - this is bad fr');
                // try to recreate the pool if health check fails
                if (this.errorCount > 5) {
                    logger.warn('too many errors - recreating pool');
                    await this.recreatePool();
                }
            }
        }, this.poolSettings.healthCheckIntervalMs);
    }
    // recreates the entire pool if things get sus
    async recreatePool() {
        logger.info('recreating pool - hold up...');
        // HIGH-08 FIX: Clean up listeners BEFORE ending pool to prevent leaks
        // Must happen before pool.end() since we need the pool reference
        this.cleanupPoolListeners();
        try {
            await this.pool.end();
        }
        catch (err) {
            logger.warn({ err }, 'error ending old pool but we move');
        }
        this.pool = this.spawnThePool();
        this.setupPoolListeners();
        this.errorCount = 0;
        await this.wakeUp();
        logger.info('pool recreated successfully - WE BACK');
    }
    // executes a query with automatic retry on transient failures
    // SCHEMA ISOLATION FIX: Use getClientWithSchema to guarantee search_path before any query
    async queryWithSwag(text, params, retries = this.poolSettings.retryAttempts) {
        const start = Date.now();
        this.queryCount++;
        for (let attempt = 0; attempt <= retries; attempt++) {
            const client = await this.getClientWithSchema();
            try {
                const result = await client.query(text, params);
                const duration = Date.now() - start;
                // track slow queries so we can optimize later
                if (duration > 100) {
                    this.slowQueryCount++;
                    logger.warn({
                        duration,
                        query: text.slice(0, 100),
                        slowQueries: this.slowQueryCount
                    }, 'slow query detected - might wanna optimize this fr');
                }
                return result;
            }
            catch (err) {
                const isTransient = this.isTransientError(err);
                if (isTransient && attempt < retries) {
                    const delay = this.poolSettings.retryDelayMs * Math.pow(2, attempt);
                    logger.warn({
                        attempt: attempt + 1,
                        maxRetries: retries,
                        delayMs: delay,
                        error: err.message
                    }, 'transient error - retrying with backoff');
                    await this.sleep(delay);
                    continue;
                }
                this.errorCount++;
                throw err;
            }
            finally {
                client.release();
            }
        }
        // this should never happen but typescript wants it
        throw new Error('query failed after all retries - L');
    }
    // checks if an error is transient (can be retried)
    isTransientError(err) {
        const transientCodes = [
            '40001', // serialization failure
            '40P01', // deadlock
            '57P01', // admin shutdown
            '57P02', // crash shutdown
            '57P03', // cannot connect now
            '08006', // connection failure
            '08001', // unable to establish connection
            '08004', // server rejected connection
        ];
        if (err instanceof Error) {
            const pgErr = err;
            return transientCodes.includes(pgErr.code ?? '');
        }
        return false;
    }
    // executes multiple queries in a transaction - all or nothing baby
    // SCHEMA ISOLATION FIX: Uses getClientWithSchema() to guarantee search_path
    async transactionGang(callback) {
        const client = await this.getClientWithSchema();
        const start = Date.now();
        try {
            await client.query('BEGIN');
            logger.trace('transaction started - lets get this bread');
            const result = await callback(client);
            await client.query('COMMIT');
            const duration = Date.now() - start;
            logger.debug({ duration }, 'transaction committed successfully');
            return result;
        }
        catch (err) {
            await client.query('ROLLBACK');
            const duration = Date.now() - start;
            logger.error({ err, duration }, 'transaction ROLLED BACK - big sad');
            throw err;
        }
        finally {
            client.release();
        }
    }
    // executes a serializable transaction for when consistency is CRITICAL
    // SCHEMA ISOLATION FIX: Uses getClientWithSchema() to guarantee search_path
    async seriousTransaction(callback) {
        const client = await this.getClientWithSchema();
        const start = Date.now();
        try {
            // serializable is the strongest isolation level no cap
            await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
            logger.trace('SERIOUS transaction started - no games');
            const result = await callback(client);
            await client.query('COMMIT');
            const duration = Date.now() - start;
            logger.debug({ duration }, 'serious transaction committed - WE DID IT');
            return result;
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    // gets stats about the pool - useful for monitoring
    getPoolDrip() {
        return {
            total: this.pool.totalCount,
            idle: this.pool.idleCount,
            waiting: this.pool.waitingCount,
            maxedOut: this.pool.totalCount >= this.poolSettings.maxConnections
        };
    }
    // gets comprehensive stats for observability
    getFullStats() {
        return {
            pool: this.getPoolDrip(),
            queries: {
                total: this.queryCount,
                slow: this.slowQueryCount,
                errors: this.errorCount
            },
            health: {
                isAlive: this.isAlive,
                lastCheck: this.lastHealthCheck,
                uptimeMs: this.lastHealthCheck ? Date.now() - this.lastHealthCheck.getTime() : 0
            },
            config: {
                maxConnections: this.poolSettings.maxConnections,
                host: this.config.host,
                database: this.config.database
            }
        };
    }
    // helper function to sleep - used for retry backoff
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    // gracefully shuts down the pool
    async shutdown() {
        logger.info('shutting down ConnectionPoolGoBrrr...');
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        // Unregister cleanup handlers to prevent double-shutdown
        if (this.errorHandlerCleanupId) {
            unregisterCleanupHandler(this.errorHandlerCleanupId);
            this.errorHandlerCleanupId = null;
        }
        if (this.cleanupHandlerId) {
            unregisterCleanupHandler(this.cleanupHandlerId);
            this.cleanupHandlerId = null;
        }
        try {
            await this.pool.end();
            this.isAlive = false;
            logger.info('ConnectionPoolGoBrrr shut down cleanly - peace out');
        }
        catch (err) {
            logger.error({ err }, 'error during shutdown but we tried');
            throw err;
        }
    }
    // gets a raw client for advanced operations
    async getRawClient() {
        return this.pool.connect();
    }
    /**
     * Gets a client with GUARANTEED search_path set.
     * Use this instead of getRawClient() when schema isolation is critical.
     * The pool.on('connect') handler sets search_path async, which can race.
     * This method explicitly waits for search_path to be set before returning.
     */
    async getClientWithSchema() {
        const client = await this.pool.connect();
        try {
            const schemaName = getProjectSchema();
            // Use quoted identifier format with escaped quotes for safety
            const safeSchema = '"' + schemaName.replace(/"/g, '""') + '"';
            await client.query('SET search_path TO ' + safeSchema + ', public');
            logger.trace({ schemaName }, 'search_path explicitly set on client');
            return client;
        }
        catch (err) {
            // If we can't set search_path, release client and throw
            // Don't let broken connections leak
            client.release();
            logger.error({ err }, 'failed to set search_path on client - releasing');
            throw err;
        }
    }
    // gets the underlying pg.Pool for direct access
    // fr fr needed for memorization system
    getPool() {
        return this.pool;
    }
}
// ============================================================================
// PROJECT-SCOPED POOL INSTANCES
// Each project gets its own connection pool to prevent cross-project pollution
// Pools are keyed by project path for complete isolation
// ============================================================================
const poolInstancesByProject = new Map();
const poolAccessTimes = new Map();
const POOL_STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour - pools stay longer
// LOW-33 FIX: Store interval handle so it can be cleared on shutdown
let stalePoolCleanupInterval = null;
// Cleanup stale project pools periodically
stalePoolCleanupInterval = setInterval(() => {
    const cutoff = Date.now() - POOL_STALE_THRESHOLD_MS;
    for (const [project, lastAccess] of poolAccessTimes) {
        if (lastAccess < cutoff) {
            const pool = poolInstancesByProject.get(project);
            if (pool) {
                pool.shutdown().catch(err => {
                    logger.warn({ err, project }, 'error cleaning up stale pool');
                });
            }
            poolInstancesByProject.delete(project);
            poolAccessTimes.delete(project);
            logger.debug({ project }, 'Cleaned up stale project pool');
        }
    }
}, 30 * 60 * 1000); // Check every 30 minutes
// LOW-33 FIX: Allow process to exit even if interval is running
if (stalePoolCleanupInterval.unref) {
    stalePoolCleanupInterval.unref();
}
/**
 * Get current project path for pool scoping
 */
function getPoolProjectPath() {
    return process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
}
// gets or creates the project-scoped pool instance
export function getThePool(config) {
    const projectPath = getPoolProjectPath();
    poolAccessTimes.set(projectPath, Date.now());
    let poolInstance = poolInstancesByProject.get(projectPath);
    // TASK #23 FIX: Auto-load config when not provided - graceful degradation
    if (!poolInstance && !config) {
        logger.info({ projectPath }, 'No config provided for pool, auto-loading from loadConfig().database');
        try {
            config = loadConfig().database;
        }
        catch (e) {
            // loadConfig failed - use sensible defaults
            logger.warn({ projectPath, error: String(e) }, 'loadConfig() failed for pool, using fallback defaults');
            // Use unified credential pattern - matches config.ts
            const unifiedCred = process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional';
            config = {
                host: process.env['SPECMEM_DB_HOST'] || 'localhost',
                port: parseInt(process.env['SPECMEM_DB_PORT'] || '5432', 10),
                database: process.env['SPECMEM_DB_NAME'] || unifiedCred,
                user: process.env['SPECMEM_DB_USER'] || unifiedCred,
                password: process.env['SPECMEM_DB_PASSWORD'] || unifiedCred,
                maxConnections: 20,
                idleTimeout: 30000,
                connectionTimeout: 5000,
                ssl: undefined
            };
        }
    }
    if (!poolInstance && config) {
        poolInstance = new ConnectionPoolGoBrrr(config);
        poolInstancesByProject.set(projectPath, poolInstance);
        logger.debug({ projectPath }, 'Created project-scoped pool instance');
    }
    return poolInstance;
}
// resets the project-scoped pool for testing
export function yeetThePool() {
    const projectPath = getPoolProjectPath();
    const poolInstance = poolInstancesByProject.get(projectPath);
    if (poolInstance) {
        poolInstance.shutdown().catch(err => {
            logger.warn({ err, projectPath }, 'error yeeting pool but whatever');
        });
        poolInstancesByProject.delete(projectPath);
        poolAccessTimes.delete(projectPath);
    }
}
// Yeets ALL pools - for cleanup on process exit
export function yeetAllPools() {
    // LOW-33 FIX: Clear the stale pool cleanup interval on shutdown
    if (stalePoolCleanupInterval) {
        clearInterval(stalePoolCleanupInterval);
        stalePoolCleanupInterval = null;
        logger.debug('Cleared stale pool cleanup interval');
    }
    for (const [project, pool] of poolInstancesByProject) {
        pool.shutdown().catch(err => {
            logger.warn({ err, project }, 'error yeeting pool during cleanup');
        });
    }
    poolInstancesByProject.clear();
    poolAccessTimes.clear();
}
//# sourceMappingURL=connectionPoolGoBrrr.js.map