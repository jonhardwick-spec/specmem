export { BatchOperations, BatchInsertBuilder, BatchUpdateBuilder, createBatchOperations, type BatchOptions, type BatchResult } from './batchOperations.js';
export { CursorPaginator, QueryStreamer, createPaginatedResponse, type CursorPaginationOptions, type PaginatedResult, type StreamOptions } from './streamingQuery.js';
export { DashboardQueryEngine, getDashboardEngine, resetDashboardEngine, type DashboardStats, type DashboardMemoryRow, type DashboardFilters, type TimeSeriesDataPoint, type TagStats } from './dashboardQueries.js';
export { ApiDataManager, getApiDataManager, initApiDataManager, resetApiDataManager, type ApiEndpoint, type CreateEndpointPayload, type IpBan, type CreateBanPayload, type AutobanConfig, type SecurityEvent, type CreateSecurityEventPayload, type OAuthProvider, type AdminSession, type ApiStats, type SecurityStats, type BanStats } from './apiDataManager.js';
export { ConnectionPoolGoBrrr, getThePool, yeetThePool, type PoolDrip, type PoolConfig } from './connectionPoolGoBrrr.js';
export { BigBrainMigrations, type Migration, type MigrationRecord } from './bigBrainMigrations.js';
export { MemoryYeeter, getTheYeeter, resetTheYeeter, type MemoryInsertPayload, type YeetResult, type BatchYeetStats } from './yeetStuffInDb.js';
export { BigBrainSearchEngine, getBigBrain, resetBigBrain, type VectorSearchOpts, type TextSearchOpts, type RawMemoryRow } from './findThatShit.js';
export { MemoryNuker, getTheNuker, resetTheNuker, type NukeResult, type CleanupResult, type BulkNukeOpts } from './nukeFromOrbit.js';
import { DatabaseConfig } from '../types/index.js';
import { ConnectionPoolGoBrrr } from './connectionPoolGoBrrr.js';
import { BigBrainMigrations } from './bigBrainMigrations.js';
import { MemoryYeeter } from './yeetStuffInDb.js';
import { BigBrainSearchEngine } from './findThatShit.js';
import { MemoryNuker } from './nukeFromOrbit.js';
import { DashboardQueryEngine } from './dashboardQueries.js';
import { ApiDataManager } from './apiDataManager.js';
export interface DatabaseContext {
    pool: ConnectionPoolGoBrrr;
    migrations: BigBrainMigrations;
    yeeter: MemoryYeeter;
    search: BigBrainSearchEngine;
    nuker: MemoryNuker;
    dashboard: DashboardQueryEngine;
    apiData: ApiDataManager;
}
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
export declare function initializeTheBigBrainDb(config: DatabaseConfig, runMigrations?: boolean, projectPath?: string): Promise<DatabaseContext>;
/**
 * getDbContext - gets the current database context for a project
 * throws if not initialized yet
 */
export declare function getDbContext(projectPath?: string): DatabaseContext;
/**
 * hasDbContext - checks if database context exists for a project (non-throwing)
 */
export declare function hasDbContext(projectPath?: string): boolean;
/**
 * resetDbContext - resets the database context for a project (for testing)
 */
export declare function resetDbContext(projectPath?: string): void;
/**
 * resetAllDbContexts - resets all database contexts (for testing)
 */
export declare function resetAllDbContexts(): void;
/**
 * shutdownTheDb - gracefully shuts down everything for a project
 * call this before process exit
 */
export declare function shutdownTheDb(projectPath?: string): Promise<void>;
/**
 * shutdownAllDbs - gracefully shuts down all project databases
 * call this before process exit for multi-project cleanup
 */
export declare function shutdownAllDbs(): Promise<void>;
/**
 * getDbStats - comprehensive stats across all managers
 */
export declare function getDbStats(): {
    pool: ReturnType<ConnectionPoolGoBrrr['getFullStats']>;
    yeeter: ReturnType<MemoryYeeter['getStats']>;
    search: ReturnType<BigBrainSearchEngine['getStats']>;
    nuker: ReturnType<MemoryNuker['getStats']>;
};
/**
 * healthCheck - verifies everything is working
 */
export declare function healthCheck(): Promise<{
    healthy: boolean;
    pool: boolean;
    migrations: boolean;
    errors: string[];
}>;
//# sourceMappingURL=index.d.ts.map