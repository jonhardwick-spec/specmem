/**
 * timeoutMiddleware.ts - Request Timeout Middleware
 *
 * Provides timeout middleware for Express to prevent long-running requests
 * from hanging indefinitely and consuming resources.
 *
 * Features:
 * - Configurable timeout per route
 * - Custom timeout response
 * - Request cleanup on timeout
 *
 * @author hardwicksoftwareservices
 */
import { Request, Response, NextFunction } from 'express';
/**
 * Timeout configuration options
 */
export interface TimeoutConfig {
    /** Timeout in milliseconds (default: 30000 = 30 seconds) */
    timeout: number;
    /** Custom message to send on timeout */
    message?: string;
    /** Whether to log timeout events (default: true) */
    log?: boolean;
}
/**
 * Create request timeout middleware
 *
 * @param options Timeout configuration options
 * @returns Express middleware function
 */
export declare function requestTimeout(options?: Partial<TimeoutConfig>): (req: Request, res: Response, next: NextFunction) => void;
/**
 * Set server timeouts
 * Should be called after server is created
 */
export declare function setServerTimeouts(server: import('http').Server | import('https').Server, options?: {
    /** Keep-alive timeout (default: 5000ms) */
    keepAliveTimeout?: number;
    /** Headers timeout (default: 60000ms) */
    headersTimeout?: number;
    /** Request timeout (default: 120000ms) */
    requestTimeout?: number;
}): void;
/**
 * WebSocket ping/pong timeout configuration
 */
export interface WsPingPongConfig {
    /** Ping interval in milliseconds (default: 30000 = 30 seconds) */
    pingInterval: number;
    /** Pong timeout in milliseconds (default: 10000 = 10 seconds) */
    pongTimeout: number;
}
/**
 * Default WebSocket ping/pong configuration
 */
export declare const DEFAULT_WS_PING_PONG: WsPingPongConfig;
/**
 * Setup WebSocket ping/pong for connection health
 *
 * @param ws WebSocket instance
 * @param config Ping/pong configuration
 * @returns Cleanup function to stop ping/pong
 */
export declare function setupWsPingPong(ws: import('ws').WebSocket, config?: WsPingPongConfig): () => void;
/**
 * Database connection timeout configuration
 * These are already set in connectionPoolGoBrrr.ts, but we export
 * environment variable names for documentation
 */
export declare const DB_TIMEOUT_ENV_VARS: {
    /** Connection timeout in ms (default: 10000) */
    connectionTimeout: string;
    /** Statement timeout in ms (default: 30000) */
    statementTimeout: string;
    /** Query timeout in ms (default: 60000) */
    queryTimeout: string;
    /** Idle timeout in ms (default: 30000) */
    idleTimeout: string;
};
//# sourceMappingURL=timeoutMiddleware.d.ts.map