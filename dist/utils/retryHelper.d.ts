/**
 * retryHelper.ts - Exponential Backoff Retry Utilities
 *
 * yo this handles transient failures like a CHAMP
 * exponential backoff, jitter, configurable retry logic fr fr
 *
 * Task #40 fix - database retry logic
 */
/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
    /** Maximum number of retry attempts */
    maxRetries: number;
    /** Base delay in ms between retries */
    baseDelayMs: number;
    /** Maximum delay cap in ms */
    maxDelayMs: number;
    /** Backoff multiplier (default: 2 for exponential) */
    backoffMultiplier: number;
    /** Add random jitter to prevent thundering herd */
    jitter: boolean;
    /** Function to determine if error is retryable */
    isRetryable?: (error: unknown) => boolean;
    /** Called before each retry attempt */
    onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}
/**
 * Default retry configuration - good for most DB operations
 */
export declare const DEFAULT_RETRY_CONFIG: RetryConfig;
/**
 * Aggressive retry config - for critical operations
 */
export declare const AGGRESSIVE_RETRY_CONFIG: RetryConfig;
/**
 * Quick retry config - for fast operations that might flake
 */
export declare const QUICK_RETRY_CONFIG: RetryConfig;
/**
 * Check if an error is a transient database error that can be retried
 */
export declare function isTransientDbError(error: unknown): boolean;
/**
 * Calculate delay with exponential backoff and optional jitter
 */
export declare function calculateBackoffDelay(attempt: number, config: RetryConfig): number;
/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
    success: boolean;
    result?: T;
    error?: unknown;
    attempts: number;
    totalDelayMs: number;
}
/**
 * Execute an async function with retry logic and exponential backoff
 *
 * @param fn - The async function to execute
 * @param config - Retry configuration (uses DEFAULT_RETRY_CONFIG if not provided)
 * @param context - Optional context string for logging
 * @returns The result of the function if successful
 * @throws The last error if all retries fail
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => pool.query('SELECT * FROM users'),
 *   { maxRetries: 3, baseDelayMs: 1000 },
 *   'fetch users'
 * );
 * ```
 */
export declare function withRetry<T>(fn: () => Promise<T>, config?: Partial<RetryConfig>, context?: string): Promise<T>;
/**
 * Execute an async function with retry, returning a result object instead of throwing
 *
 * @example
 * ```ts
 * const result = await tryWithRetry(() => riskyOperation());
 * if (result.success) {
 *   console.log('Got:', result.result);
 * } else {
 *   console.error('Failed after', result.attempts, 'attempts');
 * }
 * ```
 */
export declare function tryWithRetry<T>(fn: () => Promise<T>, config?: Partial<RetryConfig>, context?: string): Promise<RetryResult<T>>;
/**
 * Wrap a pool.query call with retry logic
 *
 * This is a convenience wrapper specifically for pg pool queries
 *
 * @example
 * ```ts
 * const result = await retryQuery(pool, 'SELECT * FROM users WHERE id = $1', [userId]);
 * ```
 */
export declare function retryQuery<T = unknown>(pool: {
    query: (text: string, params?: unknown[]) => Promise<{
        rows: T[];
    }>;
}, text: string, params?: unknown[], config?: Partial<RetryConfig>): Promise<{
    rows: T[];
}>;
/**
 * Retry decorator for class methods
 *
 * @example
 * ```ts
 * class MyService {
 *   @Retryable({ maxRetries: 3 })
 *   async fetchData() {
 *     // This method will be retried on transient failures
 *   }
 * }
 * ```
 */
export declare function Retryable(config?: Partial<RetryConfig>): (_target: unknown, propertyKey: string, descriptor: PropertyDescriptor) => PropertyDescriptor;
//# sourceMappingURL=retryHelper.d.ts.map