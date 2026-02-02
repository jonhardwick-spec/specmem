import pg from 'pg';
import { DatabaseConfig } from '../types/index.js';
interface PoolDrip {
    total: number;
    idle: number;
    waiting: number;
    maxedOut: boolean;
}
interface PoolConfig {
    maxConnections: number;
    minConnections: number;
    idleTimeoutMs: number;
    connectionTimeoutMs: number;
    statementTimeoutMs: number;
    queryTimeoutMs: number;
    healthCheckIntervalMs: number;
    retryAttempts: number;
    retryDelayMs: number;
}
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
export declare class ConnectionPoolGoBrrr {
    private pool;
    private readonly config;
    private readonly poolSettings;
    private isAlive;
    private healthCheckInterval;
    private queryCount;
    private slowQueryCount;
    private errorCount;
    private lastHealthCheck;
    private cleanupHandlerId;
    private errorHandlerCleanupId;
    private currentErrorHandler;
    private currentConnectHandler;
    private currentAcquireHandler;
    private currentRemoveHandler;
    constructor(config: DatabaseConfig, poolSettings?: Partial<PoolConfig>);
    private spawnThePool;
    private cleanupPoolListeners;
    private setupPoolListeners;
    wakeUp(): Promise<void>;
    private startHealthMonitor;
    private recreatePool;
    queryWithSwag<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[], retries?: number): Promise<pg.QueryResult<T>>;
    private isTransientError;
    transactionGang<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T>;
    seriousTransaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T>;
    getPoolDrip(): PoolDrip;
    getFullStats(): {
        pool: PoolDrip;
        queries: {
            total: number;
            slow: number;
            errors: number;
        };
        health: {
            isAlive: boolean;
            lastCheck: Date;
            uptimeMs: number;
        };
        config: {
            maxConnections: number;
            host: string;
            database: string;
        };
    };
    private sleep;
    shutdown(): Promise<void>;
    getRawClient(): Promise<pg.PoolClient>;
    /**
     * Gets a client with GUARANTEED search_path set.
     * Use this instead of getRawClient() when schema isolation is critical.
     * The pool.on('connect') handler sets search_path async, which can race.
     * This method explicitly waits for search_path to be set before returning.
     */
    getClientWithSchema(): Promise<pg.PoolClient>;
    getPool(): pg.Pool;
}
export declare function getThePool(config?: DatabaseConfig): ConnectionPoolGoBrrr;
export declare function yeetThePool(): void;
export declare function yeetAllPools(): void;
export type { PoolDrip, PoolConfig };
//# sourceMappingURL=connectionPoolGoBrrr.d.ts.map