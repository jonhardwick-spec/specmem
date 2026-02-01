/**
 * circuitBreaker.ts - Circuit Breaker Pattern for External Calls
 *
 * yo this protects us from cascading failures
 * when the database is down we dont keep hammering it fr fr
 * fail fast, recover gracefully
 *
 * Issue #44 fix - circuit breaker for external calls
 */
/**
 * Circuit breaker states
 */
export declare enum CircuitState {
    CLOSED = "CLOSED",// Normal operation - calls go through
    OPEN = "OPEN",// Failing - calls blocked
    HALF_OPEN = "HALF_OPEN"
}
/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
    /** Name for logging */
    name: string;
    /** Error threshold percentage (0-100) to trip the breaker */
    errorThresholdPercentage: number;
    /** Minimum number of requests before error threshold is calculated */
    requestVolumeThreshold: number;
    /** Time in ms before attempting to close the circuit */
    sleepWindowMs: number;
    /** Timeout for individual calls in ms */
    timeoutMs: number;
    /** Number of successful calls in half-open state to close circuit */
    successThreshold: number;
}
/**
 * Circuit breaker stats
 */
export interface CircuitBreakerStats {
    name: string;
    state: CircuitState;
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    timedOutCalls: number;
    rejectedCalls: number;
    errorRate: number;
    lastFailure: Date | null;
    lastSuccess: Date | null;
    lastStateChange: Date | null;
}
/**
 * CircuitBreaker - prevents cascading failures
 *
 * Features that SAVE US:
 * - Automatic state management
 * - Configurable thresholds
 * - Timeout wrapping
 * - Statistics tracking
 * - Gradual recovery (half-open state)
 */
export declare class CircuitBreaker {
    private config;
    private state;
    private failures;
    private successes;
    private lastFailureTime;
    private lastSuccessTime;
    private lastStateChangeTime;
    private halfOpenSuccesses;
    private totalCalls;
    private rejectedCalls;
    private timedOutCalls;
    private recentCalls;
    constructor(config?: Partial<CircuitBreakerConfig>);
    /**
     * Execute a function with circuit breaker protection
     */
    execute<T>(fn: () => Promise<T>): Promise<T>;
    /**
     * Execute with timeout wrapper
     */
    private executeWithTimeout;
    /**
     * Record successful call
     */
    private recordSuccess;
    /**
     * Record failed call
     */
    private recordFailure;
    /**
     * Check if circuit should trip open
     */
    private shouldTrip;
    /**
     * Calculate current error rate
     */
    private calculateErrorRate;
    /**
     * Check if we should attempt to reset the circuit
     */
    private shouldAttemptReset;
    /**
     * Trim recent calls to rolling window
     */
    private trimRecentCalls;
    /**
     * Transition to a new state
     */
    private transitionTo;
    /**
     * Get current state
     */
    getState(): CircuitState;
    /**
     * Get statistics
     */
    getStats(): CircuitBreakerStats;
    /**
     * Force close the circuit (for recovery scenarios)
     */
    forceClose(): void;
    /**
     * Force open the circuit (for maintenance scenarios)
     */
    forceOpen(): void;
    /**
     * Reset all statistics
     */
    reset(): void;
}
/**
 * Circuit breaker error - thrown when circuit is open
 */
export declare class CircuitBreakerError extends Error {
    readonly breakerName: string;
    readonly isCircuitBreakerError = true;
    constructor(message: string, breakerName: string);
}
/**
 * Circuit breaker timeout error
 */
export declare class CircuitBreakerTimeoutError extends Error {
    readonly breakerName: string;
    readonly isTimeout = true;
    constructor(message: string, breakerName: string);
}
/**
 * Circuit breaker registry - manage multiple breakers
 */
declare class CircuitBreakerRegistry {
    private breakers;
    /**
     * Get or create a circuit breaker
     */
    getBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker;
    /**
     * Get all breaker stats
     */
    getAllStats(): CircuitBreakerStats[];
    /**
     * Reset all breakers
     */
    resetAll(): void;
    /**
     * Remove a breaker
     */
    removeBreaker(name: string): boolean;
    /**
     * Clear all breakers
     */
    clear(): void;
}
/**
 * Get the global circuit breaker registry
 */
export declare function getCircuitBreakerRegistry(): CircuitBreakerRegistry;
/**
 * Reset the global registry
 */
export declare function resetCircuitBreakerRegistry(): void;
/**
 * Convenience function - get or create a circuit breaker
 */
export declare function getCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker;
/**
 * Pre-configured circuit breaker for database operations
 */
export declare const DATABASE_BREAKER_CONFIG: Partial<CircuitBreakerConfig>;
/**
 * Pre-configured circuit breaker for external API calls
 */
export declare const API_BREAKER_CONFIG: Partial<CircuitBreakerConfig>;
export {};
//# sourceMappingURL=circuitBreaker.d.ts.map