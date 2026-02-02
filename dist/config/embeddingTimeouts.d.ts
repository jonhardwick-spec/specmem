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
/**
 * Embedding timeout configuration object
 * All values are in milliseconds
 *
 * Use the getter functions to automatically apply master timeout overrides
 */
export declare const embeddingTimeouts: {
    /**
     * Master timeout in milliseconds (from SPECMEM_EMBEDDING_TIMEOUT in seconds)
     * Returns null if master timeout is not set
     */
    readonly master: number;
    /**
     * Per-request timeout for embedding generation
     * Used by LocalEmbeddingProvider and socket communication
     * Env: SPECMEM_EMBEDDING_REQUEST_TIMEOUT_MS (default: 60000 = 60s)
     */
    readonly request: number;
    /**
     * Timeout for embedding generation during memory search (find_memory)
     * Env: SPECMEM_FIND_EMBEDDING_TIMEOUT_MS (default: 60000 = 60s)
     */
    readonly search: number;
    /**
     * Timeout for health check embedding tests
     * Kept shorter to quickly detect issues
     * Env: SPECMEM_HEALTH_EMBEDDING_TIMEOUT_MS (default: 5000)
     * Note: When master is set, health timeout is capped at 10s to prevent slow health checks
     */
    readonly health: number;
    /**
     * Initial timeout for cold-start scenarios
     * Used when the embedding service is first starting up
     * Env: SPECMEM_EMBEDDING_INITIAL_TIMEOUT_MS (default: 120000 - increased from 60s)
     */
    readonly initial: number;
    /**
     * Maximum adaptive timeout (upper bound)
     * Used by adaptive timeout algorithms
     * Env: SPECMEM_EMBEDDING_MAX_TIMEOUT_MS (default: 300000 = 5 minutes)
     */
    readonly max: number;
    /**
     * Minimum adaptive timeout (lower bound)
     * Prevents adaptive timeout from going too low
     * Env: SPECMEM_EMBEDDING_MIN_TIMEOUT_MS (default: 30000)
     */
    readonly min: number;
    /**
     * Code search/pointer lookup timeout
     * Used by find_code_pointers tool
     * Env: SPECMEM_CODE_SEARCH_TIMEOUT (default: 60000 - increased from 30s)
     */
    readonly codeSearch: number;
    /**
     * Search timeout for database queries in find_memory
     * Env: SPECMEM_FIND_SEARCH_TIMEOUT_MS (default: 180000 = 3 minutes)
     */
    readonly dbSearch: number;
    /**
     * File watcher embedding timeout
     * Used when indexing files via the file watcher
     * Longer timeout than code search since file watcher processes in background
     * Env: SPECMEM_FILE_WATCHER_TIMEOUT_MS (default: 120000 = 2 minutes)
     */
    readonly fileWatcher: number;
};
/**
 * Type for timeout operation types
 */
export type EmbeddingTimeoutType = 'request' | 'search' | 'health' | 'initial' | 'max' | 'min' | 'codeSearch' | 'dbSearch' | 'fileWatcher';
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
export declare function getEmbeddingTimeout(type?: EmbeddingTimeoutType): number;
/**
 * Get all timeout values as a plain object (useful for logging/debugging)
 *
 * @returns Object with all current timeout values in milliseconds
 */
export declare function getAllEmbeddingTimeouts(): Record<EmbeddingTimeoutType | 'master', number | null>;
/**
 * Check if master timeout is configured
 *
 * @returns true if SPECMEM_EMBEDDING_TIMEOUT is set and valid
 */
export declare function hasMasterTimeout(): boolean;
/**
 * Format timeout for user-friendly error messages
 *
 * @param ms - Timeout in milliseconds
 * @returns Human-readable string (e.g., "30s", "2m 30s")
 */
export declare function formatTimeout(ms: number): string;
/**
 * Log current timeout configuration (for debugging)
 */
export declare function logTimeoutConfig(): void;
//# sourceMappingURL=embeddingTimeouts.d.ts.map