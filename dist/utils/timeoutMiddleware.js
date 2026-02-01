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
import { logger } from './logger.js';
/**
 * Default timeout configuration
 */
const DEFAULT_TIMEOUT_CONFIG = {
    timeout: parseInt(process.env['SPECMEM_REQUEST_TIMEOUT'] || '180000', 10),
    message: 'Request timeout',
    log: true
};
/**
 * Create request timeout middleware
 *
 * @param options Timeout configuration options
 * @returns Express middleware function
 */
export function requestTimeout(options) {
    const config = { ...DEFAULT_TIMEOUT_CONFIG, ...options };
    return (req, res, next) => {
        // Skip if response already sent
        if (res.headersSent) {
            return next();
        }
        // Set up timeout
        const timeoutId = setTimeout(() => {
            if (!res.headersSent) {
                if (config.log) {
                    logger.warn({
                        method: req.method,
                        url: req.url,
                        timeout: config.timeout
                    }, 'request timeout');
                }
                res.status(503).json({
                    error: config.message,
                    timeout: config.timeout
                });
            }
        }, config.timeout);
        // Clear timeout when response finishes
        res.on('finish', () => {
            clearTimeout(timeoutId);
        });
        res.on('close', () => {
            clearTimeout(timeoutId);
        });
        next();
    };
}
/**
 * Set server timeouts
 * Should be called after server is created
 */
export function setServerTimeouts(server, options) {
    const { keepAliveTimeout = parseInt(process.env['SPECMEM_KEEP_ALIVE_TIMEOUT'] || '5000', 10), headersTimeout = parseInt(process.env['SPECMEM_HEADERS_TIMEOUT'] || '60000', 10), requestTimeout = parseInt(process.env['SPECMEM_REQUEST_TIMEOUT'] || '120000', 10) } = options || {};
    server.keepAliveTimeout = keepAliveTimeout;
    server.headersTimeout = headersTimeout;
    server.requestTimeout = requestTimeout;
    logger.debug({
        keepAliveTimeout,
        headersTimeout,
        requestTimeout
    }, 'server timeouts configured');
}
/**
 * Default WebSocket ping/pong configuration
 */
export const DEFAULT_WS_PING_PONG = {
    pingInterval: parseInt(process.env['SPECMEM_WS_PING_INTERVAL'] || '180000', 10),
    pongTimeout: parseInt(process.env['SPECMEM_WS_PONG_TIMEOUT'] || '60000', 10)
};
/**
 * Setup WebSocket ping/pong for connection health
 *
 * @param ws WebSocket instance
 * @param config Ping/pong configuration
 * @returns Cleanup function to stop ping/pong
 */
export function setupWsPingPong(ws, config = DEFAULT_WS_PING_PONG) {
    let pingTimeout = null;
    let pongTimeout = null;
    let isAlive = true;
    // Handle pong response
    const handlePong = () => {
        isAlive = true;
        if (pongTimeout) {
            clearTimeout(pongTimeout);
            pongTimeout = null;
        }
    };
    ws.on('pong', handlePong);
    // Send periodic pings
    const sendPing = () => {
        if (ws.readyState !== ws.OPEN) {
            return;
        }
        if (!isAlive) {
            // Didn't receive pong, terminate connection
            logger.debug('WebSocket connection timed out - no pong received');
            ws.terminate();
            return;
        }
        isAlive = false;
        ws.ping();
        // Set pong timeout
        pongTimeout = setTimeout(() => {
            if (!isAlive && ws.readyState === ws.OPEN) {
                logger.debug('WebSocket pong timeout - terminating connection');
                ws.terminate();
            }
        }, config.pongTimeout);
    };
    // Start ping interval
    pingTimeout = setInterval(sendPing, config.pingInterval);
    // Return cleanup function
    return () => {
        if (pingTimeout) {
            clearInterval(pingTimeout);
            pingTimeout = null;
        }
        if (pongTimeout) {
            clearTimeout(pongTimeout);
            pongTimeout = null;
        }
        ws.removeListener('pong', handlePong);
    };
}
/**
 * Database connection timeout configuration
 * These are already set in connectionPoolGoBrrr.ts, but we export
 * environment variable names for documentation
 */
export const DB_TIMEOUT_ENV_VARS = {
    /** Connection timeout in ms (default: 10000) */
    connectionTimeout: 'SPECMEM_DB_CONNECTION_TIMEOUT',
    /** Statement timeout in ms (default: 30000) */
    statementTimeout: 'SPECMEM_DB_STATEMENT_TIMEOUT',
    /** Query timeout in ms (default: 60000) */
    queryTimeout: 'SPECMEM_DB_QUERY_TIMEOUT',
    /** Idle timeout in ms (default: 30000) */
    idleTimeout: 'SPECMEM_DB_IDLE_TIMEOUT'
};
//# sourceMappingURL=timeoutMiddleware.js.map