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
/**
 * Check if a port is forbidden (must NEVER be used)
 */
export declare function isForbiddenPort(port: number): boolean;
/**
 * Check if a port is in use using net.createServer
 * This is the primary method for checking port availability
 *
 * @param port - Port number to check
 * @param host - Host to check (default: 127.0.0.1)
 * @returns true if port is in use, false if available
 */
export declare function isPortInUse(port: number, host?: string): Promise<boolean>;
/**
 * Check if a port is available for binding (inverse of isPortInUse)
 */
export declare function isPortAvailable(port: number, host?: string): Promise<boolean>;
/**
 * Check if a port is in use using lsof (fallback method for Linux/macOS)
 * This can detect ports held by other processes even if they're not listening
 *
 * @param port - Port number to check
 * @returns true if port is in use, false if available
 */
export declare function isPortInUseLsof(port: number): boolean;
/**
 * Find an available port starting from the base port
 * Respects the dynamic range (8595-8720) and skips forbidden ports (8787)
 *
 * @param start - Starting port (will be clamped to dynamic range)
 * @param end - Ending port (will be clamped to dynamic range)
 * @param host - Host to check (default: 127.0.0.1)
 * @returns Available port number, or null if none found
 */
export declare function findAvailablePort(start: number, end?: number | string, host?: string): Promise<number | null>;
/**
 * Configuration for server startup with port retry
 */
export interface PortRetryConfig {
    /** Base port to start trying from */
    basePort: number;
    /** Host to bind to */
    host: string;
    /** Maximum number of ports to try (default: 10) */
    maxPortAttempts?: number;
    /** Maximum number of startup retries per port (default: 3) */
    maxStartupRetries?: number;
    /** Delay between startup retries in ms (default: 1000) */
    retryDelayMs?: number;
    /** Server name for logging */
    serverName: string;
}
/**
 * Result of server startup attempt
 */
export interface PortRetryResult {
    /** Whether startup succeeded */
    success: boolean;
    /** Port that was successfully bound (if success) */
    port?: number;
    /** Error message (if failure) */
    error?: string;
    /** Number of ports attempted */
    portsAttempted: number;
}
/**
 * Start a server with port retry logic
 * Attempts multiple ports and retries on failure
 */
export declare function startServerWithRetry<T>(config: PortRetryConfig, startServer: (port: number, host: string) => Promise<T>): Promise<{
    result: PortRetryResult;
    server?: T;
}>;
/**
 * Check if a process is using a specific port
 */
export declare function checkExistingProcess(port: number): Promise<boolean>;
/**
 * Helper to sleep for a given number of milliseconds
 */
declare function sleep(ms: number): Promise<void>;
/**
 * Export sleep for use in other modules
 */
export { sleep };
//# sourceMappingURL=portUtils.d.ts.map