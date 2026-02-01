/**
 * Unified Embedding Timeout Configuration for SpecMem
 *
 * This module provides a centralized configuration for ALL embedding-related timeouts.
 *
 * SIMPLE USAGE:
 *   Set SPECMEM_EMBEDDING_TIMEOUT (in SECONDS) to control ALL timeouts at once.
 *   Example: export SPECMEM_EMBEDDING_TIMEOUT=60  # 60 second timeout for all operations
 *
 * GRANULAR OVERRIDES:
 *   If you need fine-grained control, individual env vars are available (in milliseconds):
 *   - SPECMEM_EMBEDDING_REQUEST_TIMEOUT_MS: Per-request timeout (default: 60s - was 30s)
 *   - SPECMEM_FIND_EMBEDDING_TIMEOUT_MS: Memory search embedding generation (default: 60s - was 30s)
 *   - SPECMEM_HEALTH_EMBEDDING_TIMEOUT_MS: Health check embedding timeout (default: 5s)
 *   - SPECMEM_EMBEDDING_INITIAL_TIMEOUT_MS: Initial/cold-start timeout (default: 120s - was 60s)
 *   - SPECMEM_EMBEDDING_MAX_TIMEOUT_MS: Maximum adaptive timeout (default: 300s/5min)
 *   - SPECMEM_EMBEDDING_MIN_TIMEOUT_MS: Minimum adaptive timeout (default: 30s)
 *   - SPECMEM_CODE_SEARCH_TIMEOUT: Code pointer search timeout (default: 60s - was 30s)
 *
 * Additional environment variables:
 *   - SPECMEM_DOCKER_EXEC_TIMEOUT_MS: Docker command execution timeout (default: 30s)
 *   - SPECMEM_DOCKER_STOP_TIMEOUT_MS: Docker stop/kill timeout (default: 30s)
 *   - SPECMEM_SOCKET_WAIT_TIMEOUT_MS: Wait for socket availability (default: 30s)
 *   - SPECMEM_MINI_COT_TIMEOUT_MS: Mini COT analysis timeout (default: 60s)
 *   - SPECMEM_CIRCUIT_TIMEOUT_MS: Circuit breaker operation timeout (default: 30s)
 *
 * TIMEOUT HIERARCHY:
 *   Master timeout (SPECMEM_EMBEDDING_TIMEOUT) > Individual env vars > Defaults
 *   When master is set, individual values are derived from it:
 *   - request: master
 *   - search: master
 *   - health: master (capped at 10s for health checks)
 *   - initial: master * 2
 *   - max: master * 10
 *   - min: master
 *   - codeSearch: master
 *
 * @module config/embeddingTimeouts
 */
import { logger } from '../utils/logger.js';
/**
 * Parse the master timeout from environment (in SECONDS)
 * Returns null if not set, allowing individual timeouts to take precedence
 */
function parseMasterTimeout() {
    const envVal = process.env['SPECMEM_EMBEDDING_TIMEOUT'];
    if (!envVal)
        return null;
    const seconds = parseInt(envVal, 10);
    if (isNaN(seconds) || seconds <= 0) {
        logger.warn({ envVal }, 'Invalid SPECMEM_EMBEDDING_TIMEOUT value, ignoring');
        return null;
    }
    return seconds * 1000; // Convert to milliseconds
}
/**
 * Parse a millisecond timeout from environment
 */
function parseTimeoutMs(envVar, defaultMs) {
    const envVal = process.env[envVar];
    if (!envVal)
        return defaultMs;
    const ms = parseInt(envVal, 10);
    if (isNaN(ms) || ms <= 0) {
        logger.warn({ envVar, envVal }, 'Invalid timeout value, using default');
        return defaultMs;
    }
    return ms;
}
/**
 * Embedding timeout configuration object
 * All values are in milliseconds
 *
 * Use the getter functions to automatically apply master timeout overrides
 */
export const embeddingTimeouts = {
    /**
     * Master timeout in milliseconds (from SPECMEM_EMBEDDING_TIMEOUT in seconds)
     * Returns null if master timeout is not set
     */
    master: parseMasterTimeout(),
    /**
     * Per-request timeout for embedding generation
     * Used by LocalEmbeddingProvider and socket communication
     * Env: SPECMEM_EMBEDDING_REQUEST_TIMEOUT_MS (default: 60000 = 60s)
     */
    get request() {
        return this.master ?? parseTimeoutMs('SPECMEM_EMBEDDING_REQUEST_TIMEOUT_MS', 60000);
    },
    /**
     * Timeout for embedding generation during memory search (find_memory)
     * Env: SPECMEM_FIND_EMBEDDING_TIMEOUT_MS (default: 60000 = 60s)
     */
    get search() {
        return this.master ?? parseTimeoutMs('SPECMEM_FIND_EMBEDDING_TIMEOUT_MS', 60000);
    },
    /**
     * Timeout for health check embedding tests
     * Kept shorter to quickly detect issues
     * Env: SPECMEM_HEALTH_EMBEDDING_TIMEOUT_MS (default: 5000)
     * Note: When master is set, health timeout is capped at 10s to prevent slow health checks
     */
    get health() {
        if (this.master !== null) {
            // Cap health timeout at 10s even if master is higher
            return Math.min(this.master, 10000);
        }
        return parseTimeoutMs('SPECMEM_HEALTH_EMBEDDING_TIMEOUT_MS', 5000);
    },
    /**
     * Initial timeout for cold-start scenarios
     * Used when the embedding service is first starting up
     * Env: SPECMEM_EMBEDDING_INITIAL_TIMEOUT_MS (default: 120000 - increased from 60s)
     */
    get initial() {
        if (this.master !== null) {
            return this.master * 2; // 2x master for initial/cold-start
        }
        return parseTimeoutMs('SPECMEM_EMBEDDING_INITIAL_TIMEOUT_MS', 120000);
    },
    /**
     * Maximum adaptive timeout (upper bound)
     * Used by adaptive timeout algorithms
     * Env: SPECMEM_EMBEDDING_MAX_TIMEOUT_MS (default: 300000 = 5 minutes)
     */
    get max() {
        if (this.master !== null) {
            return this.master * 10; // 10x master for max
        }
        return parseTimeoutMs('SPECMEM_EMBEDDING_MAX_TIMEOUT_MS', 300000);
    },
    /**
     * Minimum adaptive timeout (lower bound)
     * Prevents adaptive timeout from going too low
     * Env: SPECMEM_EMBEDDING_MIN_TIMEOUT_MS (default: 30000)
     */
    get min() {
        return this.master ?? parseTimeoutMs('SPECMEM_EMBEDDING_MIN_TIMEOUT_MS', 30000);
    },
    /**
     * Code search/pointer lookup timeout
     * Used by find_code_pointers tool
     * Env: SPECMEM_CODE_SEARCH_TIMEOUT (default: 60000 - increased from 30s)
     */
    get codeSearch() {
        return this.master ?? parseTimeoutMs('SPECMEM_CODE_SEARCH_TIMEOUT', 60000);
    },
    /**
     * Search timeout for database queries in find_memory
     * Env: SPECMEM_FIND_SEARCH_TIMEOUT_MS (default: 180000 = 3 minutes)
     */
    get dbSearch() {
        if (this.master !== null) {
            return this.master * 6; // 6x master for DB search (longer operation)
        }
        return parseTimeoutMs('SPECMEM_FIND_SEARCH_TIMEOUT_MS', 180000);
    },
    /**
     * File watcher embedding timeout
     * Used when indexing files via the file watcher
     * Longer timeout than code search since file watcher processes in background
     * Env: SPECMEM_FILE_WATCHER_TIMEOUT_MS (default: 120000 = 2 minutes)
     */
    get fileWatcher() {
        if (this.master !== null) {
            return this.master * 2; // 2x master for file watcher
        }
        return parseTimeoutMs('SPECMEM_FILE_WATCHER_TIMEOUT_MS', 120000);
    }
};
/**
 * Get a specific embedding timeout value
 *
 * @param type - The type of timeout to retrieve
 * @returns Timeout value in milliseconds
 *
 * @example
 * const timeout = getEmbeddingTimeout('request'); // 30000 by default
 * const searchTimeout = getEmbeddingTimeout('search'); // 30000 by default
 */
export function getEmbeddingTimeout(type = 'request') {
    return embeddingTimeouts[type];
}
/**
 * Get all timeout values as a plain object (useful for logging/debugging)
 *
 * @returns Object with all current timeout values in milliseconds
 */
export function getAllEmbeddingTimeouts() {
    return {
        master: embeddingTimeouts.master,
        request: embeddingTimeouts.request,
        search: embeddingTimeouts.search,
        health: embeddingTimeouts.health,
        initial: embeddingTimeouts.initial,
        max: embeddingTimeouts.max,
        min: embeddingTimeouts.min,
        codeSearch: embeddingTimeouts.codeSearch,
        dbSearch: embeddingTimeouts.dbSearch,
        fileWatcher: embeddingTimeouts.fileWatcher
    };
}
/**
 * Check if master timeout is configured
 *
 * @returns true if SPECMEM_EMBEDDING_TIMEOUT is set and valid
 */
export function hasMasterTimeout() {
    return embeddingTimeouts.master !== null;
}
/**
 * Format timeout for user-friendly error messages
 *
 * @param ms - Timeout in milliseconds
 * @returns Human-readable string (e.g., "30s", "2m 30s")
 */
export function formatTimeout(ms) {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) {
        return `${minutes}m`;
    }
    return `${minutes}m ${remainingSeconds}s`;
}
/**
 * Log current timeout configuration (for debugging)
 */
export function logTimeoutConfig() {
    const config = getAllEmbeddingTimeouts();
    const masterSet = hasMasterTimeout();
    logger.info({
        masterTimeout: masterSet ? `${config.master}ms (${formatTimeout(config.master)})` : 'not set',
        requestTimeout: `${config.request}ms`,
        searchTimeout: `${config.search}ms`,
        healthTimeout: `${config.health}ms`,
        initialTimeout: `${config.initial}ms`,
        maxTimeout: `${config.max}ms`,
        minTimeout: `${config.min}ms`,
        codeSearchTimeout: `${config.codeSearch}ms`,
        dbSearchTimeout: `${config.dbSearch}ms`,
        source: masterSet ? 'SPECMEM_EMBEDDING_TIMEOUT (master)' : 'individual env vars'
    }, 'Embedding timeout configuration loaded');
}
// Log configuration on module load if debug is enabled
if (process.env['SPECMEM_DEBUG'] === 'true') {
    logTimeoutConfig();
}
//# sourceMappingURL=embeddingTimeouts.js.map