/**
 * portUtils.ts - Port availability checking and retry logic
 *
 * Provides utilities to check if ports are available and implement
 * retry logic with fallback ports to prevent EADDRINUSE crashes.
 *
 * IMPORTANT: Dynamic port range is 8595-8720 (125 ports for instances)
 * Port 8787 is FORBIDDEN and must never be allocated
 *
 * @author hardwicksoftwareservices
 */
import { createServer } from 'net';
import { execSync } from 'child_process';
import { logger } from './logger.js';
/**
 * FORBIDDEN PORTS - These ports must NEVER be used
 * Port 8787 is explicitly forbidden per project requirements
 */
const FORBIDDEN_PORTS = [8787];
/**
 * Check if a port is forbidden (must NEVER be used)
 */
export function isForbiddenPort(port) {
    return FORBIDDEN_PORTS.includes(port);
}
/**
 * Check if a port is in use using net.createServer
 * This is the primary method for checking port availability
 *
 * @param port - Port number to check
 * @param host - Host to check (default: 127.0.0.1)
 * @returns true if port is in use, false if available
 */
export async function isPortInUse(port, host = '127.0.0.1') {
    // First check if port is forbidden - always treat as "in use"
    if (isForbiddenPort(port)) {
        logger.debug({ port }, 'Port is forbidden, treating as in use');
        return true;
    }
    return new Promise((resolve) => {
        const server = createServer();
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(true); // Port IS in use
            }
            else {
                // Other error, assume port is in use for safety
                resolve(true);
            }
        });
        server.once('listening', () => {
            server.close(() => {
                resolve(false); // Port is NOT in use (available)
            });
        });
        server.listen(port, host);
    });
}
/**
 * Check if a port is available for binding (inverse of isPortInUse)
 */
export async function isPortAvailable(port, host = '127.0.0.1') {
    // Forbidden ports are never available
    if (isForbiddenPort(port)) {
        return false;
    }
    return new Promise((resolve) => {
        const server = createServer();
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(false);
            }
            else {
                // Other error, assume port is not available
                resolve(false);
            }
        });
        server.once('listening', () => {
            server.close(() => {
                resolve(true);
            });
        });
        server.listen(port, host);
    });
}
/**
 * Check if a port is in use using lsof (fallback method for Linux/macOS)
 * This can detect ports held by other processes even if they're not listening
 *
 * @param port - Port number to check
 * @returns true if port is in use, false if available
 */
export function isPortInUseLsof(port) {
    // Forbidden ports are always "in use"
    if (isForbiddenPort(port)) {
        return true;
    }
    try {
        const result = execSync(`lsof -i :${port} -t 2>/dev/null || echo ""`, {
            encoding: 'utf-8',
            timeout: 5000,
        }).trim();
        return result.length > 0;
    }
    catch {
        // lsof failed or timed out, fall back to assuming port is free
        return false;
    }
}
/**
 * Dynamic port configuration for SpecMem instances
 * Range: 8595-8720 (125 usable ports, excluding forbidden port 8787)
 */
const DYNAMIC_PORT_RANGE = {
    MIN: 8595,
    MAX: 8720,
};
/**
 * Find an available port starting from the base port
 * Respects the dynamic range (8595-8720) and skips forbidden ports (8787)
 *
 * @param start - Starting port (will be clamped to dynamic range)
 * @param end - Ending port (will be clamped to dynamic range)
 * @param host - Host to check (default: 127.0.0.1)
 * @returns Available port number, or null if none found
 */
export async function findAvailablePort(start, end, host = '127.0.0.1') {
    // Handle legacy signature: findAvailablePort(basePort, host, maxAttempts)
    let effectiveStart = start;
    let effectiveEnd;
    let effectiveHost = host;
    if (typeof end === 'string') {
        // Legacy call: findAvailablePort(basePort, host, maxAttempts) or findAvailablePort(basePort, host)
        effectiveHost = end;
        effectiveEnd = DYNAMIC_PORT_RANGE.MAX;
    }
    else if (typeof end === 'number' && end < 100) {
        // Legacy call with maxAttempts: findAvailablePort(basePort, host, maxAttempts)
        effectiveEnd = Math.min(start + end, DYNAMIC_PORT_RANGE.MAX);
    }
    else {
        effectiveEnd = end ?? DYNAMIC_PORT_RANGE.MAX;
    }
    // Clamp to dynamic range
    effectiveStart = Math.max(effectiveStart, DYNAMIC_PORT_RANGE.MIN);
    effectiveEnd = Math.min(effectiveEnd, DYNAMIC_PORT_RANGE.MAX);
    if (effectiveStart > effectiveEnd) {
        effectiveStart = DYNAMIC_PORT_RANGE.MIN;
    }
    logger.debug({
        start: effectiveStart,
        end: effectiveEnd,
        host: effectiveHost,
    }, 'Finding available port in range');
    for (let port = effectiveStart; port <= effectiveEnd; port++) {
        // Skip forbidden ports (8787)
        if (isForbiddenPort(port)) {
            logger.debug({ port }, 'Skipping forbidden port');
            continue;
        }
        // Check if port is in use using net.createServer
        const inUse = await isPortInUse(port, effectiveHost);
        if (!inUse) {
            logger.debug({ port, host: effectiveHost }, 'Found available port');
            return port;
        }
        logger.debug({ port, host: effectiveHost }, 'Port in use, trying next');
    }
    // Wrap around to start of range if we started mid-range
    if (effectiveStart > DYNAMIC_PORT_RANGE.MIN) {
        for (let port = DYNAMIC_PORT_RANGE.MIN; port < effectiveStart; port++) {
            if (isForbiddenPort(port))
                continue;
            const inUse = await isPortInUse(port, effectiveHost);
            if (!inUse) {
                logger.debug({ port, host: effectiveHost }, 'Found available port (wrapped)');
                return port;
            }
        }
    }
    logger.warn({
        start: effectiveStart,
        end: effectiveEnd,
        host: effectiveHost,
    }, 'No available ports found in range');
    return null;
}
/**
 * Start a server with port retry logic
 * Attempts multiple ports and retries on failure
 */
export async function startServerWithRetry(config, startServer) {
    const maxPortAttempts = config.maxPortAttempts ?? 10;
    const maxStartupRetries = config.maxStartupRetries ?? 3;
    const retryDelayMs = config.retryDelayMs ?? 1000;
    let portsAttempted = 0;
    let lastError;
    for (let portOffset = 0; portOffset < maxPortAttempts; portOffset++) {
        const port = config.basePort + portOffset;
        portsAttempted++;
        // First check if port is available
        const available = await isPortAvailable(port, config.host);
        if (!available) {
            logger.debug({ port, serverName: config.serverName }, 'port already in use, skipping');
            continue;
        }
        // Try to start the server with retries
        for (let retry = 0; retry < maxStartupRetries; retry++) {
            try {
                logger.info({
                    port,
                    host: config.host,
                    attempt: retry + 1,
                    serverName: config.serverName
                }, 'attempting to start server');
                const server = await startServer(port, config.host);
                logger.info({
                    port,
                    host: config.host,
                    serverName: config.serverName
                }, 'server started successfully');
                return {
                    result: {
                        success: true,
                        port,
                        portsAttempted
                    },
                    server
                };
            }
            catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                lastError = error.message;
                // Check if it's a port-in-use error (race condition)
                if (error.message.includes('EADDRINUSE') || error.code === 'EADDRINUSE') {
                    logger.warn({ port, serverName: config.serverName }, 'port became unavailable during startup');
                    break; // Try next port
                }
                logger.warn({
                    port,
                    retry: retry + 1,
                    maxRetries: maxStartupRetries,
                    error: lastError,
                    serverName: config.serverName
                }, 'server startup failed, retrying');
                // Wait before retry
                if (retry < maxStartupRetries - 1) {
                    await sleep(retryDelayMs * Math.pow(2, retry)); // Exponential backoff
                }
            }
        }
    }
    // All attempts failed
    logger.error({
        basePort: config.basePort,
        portsAttempted,
        lastError,
        serverName: config.serverName
    }, 'failed to start server on any port');
    return {
        result: {
            success: false,
            error: lastError || 'All port attempts failed',
            portsAttempted
        }
    };
}
/**
 * Check if a process is using a specific port
 */
export async function checkExistingProcess(port) {
    // Simply check if port is in use
    return !(await isPortAvailable(port));
}
/**
 * Helper to sleep for a given number of milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Export sleep for use in other modules
 */
export { sleep };
//# sourceMappingURL=portUtils.js.map