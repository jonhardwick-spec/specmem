/**
 * retryHelper.ts - Exponential Backoff Retry Utilities
 *
 * yo this handles transient failures like a CHAMP
 * exponential backoff, jitter, configurable retry logic fr fr
 *
 * Task #40 fix - database retry logic
 */
import { logger } from './logger.js';
/**
 * Default retry configuration - good for most DB operations
 */
export const DEFAULT_RETRY_CONFIG = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitter: true,
    isRetryable: isTransientDbError
};
/**
 * Aggressive retry config - for critical operations
 */
export const AGGRESSIVE_RETRY_CONFIG = {
    maxRetries: 5,
    baseDelayMs: 500,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    jitter: true,
    isRetryable: isTransientDbError
};
/**
 * Quick retry config - for fast operations that might flake
 */
export const QUICK_RETRY_CONFIG = {
    maxRetries: 2,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    backoffMultiplier: 2,
    jitter: true,
    isRetryable: isTransientDbError
};
/**
 * PostgreSQL transient error codes that can be retried
 */
const TRANSIENT_PG_CODES = new Set([
    '40001', // serialization_failure
    '40P01', // deadlock_detected
    '57P01', // admin_shutdown
    '57P02', // crash_shutdown
    '57P03', // cannot_connect_now
    '08006', // connection_failure
    '08001', // sqlclient_unable_to_establish_sqlconnection
    '08004', // sqlserver_rejected_establishment_of_sqlconnection
    '08003', // connection_does_not_exist
    '08000', // connection_exception
    '53300', // too_many_connections
    '53400', // configuration_limit_exceeded
    '57P04', // database_dropped (rare but can retry on different db)
    'ECONNRESET', // TCP connection reset
    'ECONNREFUSED', // connection refused
    'ETIMEDOUT', // connection timed out
    'EPIPE', // broken pipe
]);
/**
 * Check if an error is a transient database error that can be retried
 */
export function isTransientDbError(error) {
    if (!error)
        return false;
    // Handle pg DatabaseError
    if (error && typeof error === 'object') {
        const err = error;
        // PostgreSQL error code
        if (typeof err['code'] === 'string' && TRANSIENT_PG_CODES.has(err['code'])) {
            return true;
        }
        // Node.js system error
        if (typeof err['errno'] === 'string' && TRANSIENT_PG_CODES.has(err['errno'])) {
            return true;
        }
        // Connection errors in message
        if (err instanceof Error) {
            const msg = err.message.toLowerCase();
            if (msg.includes('connection') ||
                msg.includes('timeout') ||
                msg.includes('econnreset') ||
                msg.includes('econnrefused') ||
                msg.includes('etimedout') ||
                msg.includes('socket hang up') ||
                msg.includes('network') ||
                msg.includes('terminate')) {
                return true;
            }
        }
    }
    return false;
}
/**
 * Calculate delay with exponential backoff and optional jitter
 */
export function calculateBackoffDelay(attempt, config) {
    // Exponential backoff: baseDelay * (multiplier ^ attempt)
    let delay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);
    // Cap at maximum
    delay = Math.min(delay, config.maxDelayMs);
    // Add jitter to prevent thundering herd (0-50% of delay)
    if (config.jitter) {
        const jitterAmount = delay * 0.5 * Math.random();
        delay = delay + jitterAmount;
    }
    return Math.floor(delay);
}
/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
export async function withRetry(fn, config = {}, context) {
    const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
    const { maxRetries, isRetryable, onRetry } = fullConfig;
    let lastError;
    let totalDelayMs = 0;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            // Check if error is retryable
            const canRetry = isRetryable ? isRetryable(error) : true;
            if (!canRetry || attempt >= maxRetries) {
                // Not retryable or out of attempts
                logger.error({
                    context,
                    attempt: attempt + 1,
                    maxRetries: maxRetries + 1,
                    error: error instanceof Error ? error.message : String(error),
                    totalDelayMs
                }, 'retry exhausted - all attempts failed');
                throw error;
            }
            // Calculate backoff delay
            const delayMs = calculateBackoffDelay(attempt, fullConfig);
            totalDelayMs += delayMs;
            // Log and call onRetry callback
            logger.warn({
                context,
                attempt: attempt + 1,
                maxRetries: maxRetries + 1,
                delayMs,
                error: error instanceof Error ? error.message : String(error)
            }, 'transient error - retrying with backoff');
            if (onRetry) {
                onRetry(attempt + 1, error, delayMs);
            }
            // Wait before retry
            await sleep(delayMs);
        }
    }
    // This should never be reached but TypeScript needs it
    throw lastError;
}
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
export async function tryWithRetry(fn, config = {}, context) {
    const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
    const { maxRetries, isRetryable, onRetry } = fullConfig;
    let lastError;
    let totalDelayMs = 0;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await fn();
            return {
                success: true,
                result,
                attempts: attempt + 1,
                totalDelayMs
            };
        }
        catch (error) {
            lastError = error;
            const canRetry = isRetryable ? isRetryable(error) : true;
            if (!canRetry || attempt >= maxRetries) {
                return {
                    success: false,
                    error: lastError,
                    attempts: attempt + 1,
                    totalDelayMs
                };
            }
            const delayMs = calculateBackoffDelay(attempt, fullConfig);
            totalDelayMs += delayMs;
            if (onRetry) {
                onRetry(attempt + 1, error, delayMs);
            }
            await sleep(delayMs);
        }
    }
    return {
        success: false,
        error: lastError,
        attempts: maxRetries + 1,
        totalDelayMs
    };
}
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
export async function retryQuery(pool, text, params, config) {
    return withRetry(() => pool.query(text, params), config, 'db query');
}
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
export function Retryable(config = {}) {
    return function (_target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = async function (...args) {
            return withRetry(() => originalMethod.apply(this, args), config, propertyKey);
        };
        return descriptor;
    };
}
//# sourceMappingURL=retryHelper.js.map