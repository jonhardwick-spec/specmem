// yooo this is the MAIN EXPORT for the db layer
// all the goated database operations in one place
// skids could never build something this clean no cap
// === NEW PRODUCTION READINESS FEATURES ===
// Batch Operations - Issue #40
export { BatchOperations, BatchInsertBuilder, BatchUpdateBuilder, createBatchOperations } from './batchOperations.js';
// Streaming Queries - Issue #41
export { CursorPaginator, QueryStreamer, createPaginatedResponse } from './streamingQuery.js';
// Dashboard Query Engine - Optimized queries for SpecMem dashboard
export { DashboardQueryEngine, getDashboardEngine, resetDashboardEngine } from './dashboardQueries.js';
// API Data Manager - Manages endpoints, bans, security events, oauth
export { ApiDataManager, getApiDataManager, initApiDataManager, resetApiDataManager } from './apiDataManager.js';
// === EXISTING EXPORTS ===
// connection pool - the foundation of everything
export { ConnectionPoolGoBrrr, getThePool, yeetThePool } from './connectionPoolGoBrrr.js';
// migrations - schema evolution that slaps
export { BigBrainMigrations } from './bigBrainMigrations.js';
// insert operations - yeeting data into postgres
export { MemoryYeeter, getTheYeeter, resetTheYeeter } from './yeetStuffInDb.js';
// search operations - finding that shit FAST
export { BigBrainSearchEngine, getBigBrain, resetBigBrain } from './findThatShit.js';
// delete operations - nuking memories from orbit
export { MemoryNuker, getTheNuker, resetTheNuker } from './nukeFromOrbit.js';
import { ConnectionPoolGoBrrr } from './connectionPoolGoBrrr.js';
import { BigBrainMigrations } from './bigBrainMigrations.js';
import { MemoryYeeter } from './yeetStuffInDb.js';
import { BigBrainSearchEngine } from './findThatShit.js';
import { MemoryNuker } from './nukeFromOrbit.js';
import { DashboardQueryEngine } from './dashboardQueries.js';
import { ApiDataManager } from './apiDataManager.js';
import { logger } from '../utils/logger.js';
import { getProjectPath } from '../config.js';
import { getProjectSchema } from './projectNamespacing.js';
// Per-project database contexts
const dbContextByProject = new Map();
/**
 * initializeTheBigBrainDb - sets up the entire database layer for a project
 *
 * this function:
 * 1. creates the connection pool
 * 2. runs pending migrations
 * 3. initializes all managers
 * 4. returns the full context
 *
 * call this once at startup and youre good to go fr
 * uses Map pattern to isolate contexts per project
 */
export async function initializeTheBigBrainDb(config, runMigrations = true, projectPath) {
    const targetProject = projectPath || getProjectPath();
    if (dbContextByProject.has(targetProject)) {
        logger.warn({ project: targetProject }, 'database already initialized for project - returning existing context');
        return dbContextByProject.get(targetProject);
    }
    logger.info({ project: targetProject }, 'initializing the BIG BRAIN database layer...');
    const start = Date.now();
    // 1. create pool
    const pool = new ConnectionPoolGoBrrr(config);
    await pool.wakeUp();
    logger.debug('connection pool is UP');
    // 1.5 set search_path BEFORE migrations so tables land in the right schema
    const schemaName = getProjectSchema(targetProject);
    await pool.queryWithSwag(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
    await pool.queryWithSwag(`SET search_path TO ${schemaName}, public`);
    logger.debug({ schemaName }, 'search_path set for project schema');
    // 2. run migrations if enabled
    const migrations = new BigBrainMigrations(pool);
    if (runMigrations) {
        logger.info('running database migrations...');
        await migrations.runAllMigrations();
    }
    // 3. initialize managers
    const yeeter = new MemoryYeeter(pool);
    const search = new BigBrainSearchEngine(pool);
    const nuker = new MemoryNuker(pool);
    const dashboard = new DashboardQueryEngine(pool);
    const apiData = new ApiDataManager(pool);
    // Start dashboard auto-refresh (refresh stats every 60 seconds)
    dashboard.startAutoRefresh(60000);
    // 4. store context
    const dbContext = {
        pool,
        migrations,
        yeeter,
        search,
        nuker,
        dashboard,
        apiData
    };
    dbContextByProject.set(targetProject, dbContext);
    const duration = Date.now() - start;
    logger.info({ duration, project: targetProject }, 'database layer fully initialized - WE READY');
    return dbContext;
}
/**
 * getDbContext - gets the current database context for a project
 * throws if not initialized yet
 */
export function getDbContext(projectPath) {
    const targetProject = projectPath || getProjectPath();
    const context = dbContextByProject.get(targetProject);
    if (!context) {
        throw new Error(`database not initialized for project ${targetProject} - call initializeTheBigBrainDb first bruh`);
    }
    return context;
}
/**
 * hasDbContext - checks if database context exists for a project (non-throwing)
 */
export function hasDbContext(projectPath) {
    const targetProject = projectPath || getProjectPath();
    return dbContextByProject.has(targetProject);
}
/**
 * resetDbContext - resets the database context for a project (for testing)
 */
export function resetDbContext(projectPath) {
    const targetProject = projectPath || getProjectPath();
    const context = dbContextByProject.get(targetProject);
    if (context) {
        context.dashboard.stopAutoRefresh();
    }
    dbContextByProject.delete(targetProject);
}
/**
 * resetAllDbContexts - resets all database contexts (for testing)
 */
export function resetAllDbContexts() {
    for (const [project, context] of dbContextByProject) {
        context.dashboard.stopAutoRefresh();
    }
    dbContextByProject.clear();
}
/**
 * shutdownTheDb - gracefully shuts down everything for a project
 * call this before process exit
 */
export async function shutdownTheDb(projectPath) {
    const targetProject = projectPath || getProjectPath();
    const context = dbContextByProject.get(targetProject);
    if (!context) {
        logger.warn({ project: targetProject }, 'database not initialized for project - nothing to shutdown');
        return;
    }
    logger.info({ project: targetProject }, 'shutting down database layer...');
    // Stop dashboard auto-refresh first
    context.dashboard.stopAutoRefresh();
    await context.pool.shutdown();
    dbContextByProject.delete(targetProject);
    logger.info({ project: targetProject }, 'database layer shut down - peace out');
}
/**
 * shutdownAllDbs - gracefully shuts down all project databases
 * call this before process exit for multi-project cleanup
 */
export async function shutdownAllDbs() {
    logger.info(`shutting down ${dbContextByProject.size} database contexts...`);
    for (const [project, context] of dbContextByProject) {
        logger.info({ project }, 'shutting down database...');
        context.dashboard.stopAutoRefresh();
        await context.pool.shutdown();
    }
    dbContextByProject.clear();
    logger.info('all database layers shut down - peace out');
}
/**
 * getDbStats - comprehensive stats across all managers
 */
export function getDbStats() {
    const ctx = getDbContext();
    return {
        pool: ctx.pool.getFullStats(),
        yeeter: ctx.yeeter.getStats(),
        search: ctx.search.getStats(),
        nuker: ctx.nuker.getStats()
    };
}
/**
 * healthCheck - verifies everything is working
 */
export async function healthCheck() {
    const errors = [];
    let poolOk = false;
    let migrationsOk = false;
    try {
        const ctx = getDbContext();
        // check pool
        try {
            const stats = ctx.pool.getPoolDrip();
            poolOk = stats.total > 0;
            if (stats.maxedOut) {
                errors.push('connection pool is maxed out');
            }
        }
        catch (err) {
            errors.push(`pool check failed: ${err.message}`);
        }
        // check migrations
        try {
            const status = await ctx.migrations.getStatus();
            migrationsOk = status.pending.length === 0;
            if (status.pending.length > 0) {
                errors.push(`${status.pending.length} pending migrations`);
            }
        }
        catch (err) {
            errors.push(`migration check failed: ${err.message}`);
        }
    }
    catch (err) {
        errors.push(`context not available: ${err.message}`);
    }
    return {
        healthy: poolOk && migrationsOk && errors.length === 0,
        pool: poolOk,
        migrations: migrationsOk,
        errors
    };
}
//# sourceMappingURL=index.js.map