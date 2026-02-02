/**
 * circuitBreaker.ts - Circuit Breaker Pattern for External Calls
 *
 * yo this protects us from cascading failures
 * when the database is down we dont keep hammering it fr fr
 * fail fast, recover gracefully
 *
 * Issue #44 fix - circuit breaker for external calls
 */
import { logger } from './logger.js';
/**
 * Circuit breaker states
 */
export var CircuitState;
(function (CircuitState) {
    CircuitState["CLOSED"] = "CLOSED";
    CircuitState["OPEN"] = "OPEN";
    CircuitState["HALF_OPEN"] = "HALF_OPEN"; // Testing - allowing limited calls
})(CircuitState || (CircuitState = {}));
const DEFAULT_CONFIG = {
    name: 'default',
    errorThresholdPercentage: 50,
    requestVolumeThreshold: 10,
    sleepWindowMs: parseInt(process.env['SPECMEM_CIRCUIT_SLEEP_MS'] || '10000', 10), // 10 seconds default
    timeoutMs: parseInt(process.env['SPECMEM_CIRCUIT_TIMEOUT_MS'] || '30000', 10), // 30 seconds default
    successThreshold: 5
};
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
export class CircuitBreaker {
    config;
    state = CircuitState.CLOSED;
    failures = 0;
    successes = 0;
    lastFailureTime = null;
    lastSuccessTime = null;
    lastStateChangeTime = new Date();
    halfOpenSuccesses = 0;
    totalCalls = 0;
    rejectedCalls = 0;
    timedOutCalls = 0;
    recentCalls = [];
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Execute a function with circuit breaker protection
     */
    async execute(fn) {
        this.totalCalls++;
        // Check if circuit is open
        if (this.state === CircuitState.OPEN) {
            if (this.shouldAttemptReset()) {
                this.transitionTo(CircuitState.HALF_OPEN);
            }
            else {
                this.rejectedCalls++;
                logger.debug({
                    breaker: this.config.name,
                    state: this.state
                }, 'circuit breaker rejected call');
                throw new CircuitBreakerError(`Circuit breaker ${this.config.name} is OPEN`, this.config.name);
            }
        }
        try {
            // Execute with timeout
            const result = await this.executeWithTimeout(fn);
            this.recordSuccess();
            return result;
        }
        catch (error) {
            this.recordFailure(error);
            throw error;
        }
    }
    /**
     * Execute with timeout wrapper
     */
    async executeWithTimeout(fn) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.timedOutCalls++;
                reject(new CircuitBreakerTimeoutError(`Operation timed out after ${this.config.timeoutMs}ms`, this.config.name));
            }, this.config.timeoutMs);
            fn()
                .then((result) => {
                clearTimeout(timeoutId);
                resolve(result);
            })
                .catch((error) => {
                clearTimeout(timeoutId);
                reject(error);
            });
        });
    }
    /**
     * Record successful call
     */
    recordSuccess() {
        this.successes++;
        this.lastSuccessTime = new Date();
        // Track recent calls for rolling window
        this.recentCalls.push({ success: true, timestamp: Date.now() });
        this.trimRecentCalls();
        if (this.state === CircuitState.HALF_OPEN) {
            this.halfOpenSuccesses++;
            if (this.halfOpenSuccesses >= this.config.successThreshold) {
                this.transitionTo(CircuitState.CLOSED);
            }
        }
        logger.trace({
            breaker: this.config.name,
            state: this.state,
            successes: this.successes
        }, 'circuit breaker success');
    }
    /**
     * Record failed call
     */
    recordFailure(error) {
        this.failures++;
        this.lastFailureTime = new Date();
        // Track recent calls for rolling window
        this.recentCalls.push({ success: false, timestamp: Date.now() });
        this.trimRecentCalls();
        if (this.state === CircuitState.HALF_OPEN) {
            // Any failure in half-open state opens the circuit again
            this.transitionTo(CircuitState.OPEN);
        }
        else if (this.shouldTrip()) {
            this.transitionTo(CircuitState.OPEN);
        }
        logger.debug({
            breaker: this.config.name,
            state: this.state,
            failures: this.failures,
            error: error instanceof Error ? error.message : 'unknown'
        }, 'circuit breaker failure');
    }
    /**
     * Check if circuit should trip open
     */
    shouldTrip() {
        if (this.recentCalls.length < this.config.requestVolumeThreshold) {
            return false;
        }
        const errorRate = this.calculateErrorRate();
        return errorRate >= this.config.errorThresholdPercentage;
    }
    /**
     * Calculate current error rate
     */
    calculateErrorRate() {
        if (this.recentCalls.length === 0)
            return 0;
        const failures = this.recentCalls.filter(c => !c.success).length;
        return (failures / this.recentCalls.length) * 100;
    }
    /**
     * Check if we should attempt to reset the circuit
     */
    shouldAttemptReset() {
        if (!this.lastFailureTime)
            return true;
        const elapsed = Date.now() - this.lastFailureTime.getTime();
        return elapsed >= this.config.sleepWindowMs;
    }
    /**
     * Trim recent calls to rolling window
     */
    trimRecentCalls() {
        const windowSize = this.config.requestVolumeThreshold * 2;
        if (this.recentCalls.length > windowSize) {
            this.recentCalls = this.recentCalls.slice(-windowSize);
        }
    }
    /**
     * Transition to a new state
     */
    transitionTo(newState) {
        const oldState = this.state;
        this.state = newState;
        this.lastStateChangeTime = new Date();
        if (newState === CircuitState.HALF_OPEN) {
            this.halfOpenSuccesses = 0;
        }
        if (newState === CircuitState.CLOSED) {
            this.failures = 0;
            this.recentCalls = [];
        }
        logger.info({
            breaker: this.config.name,
            oldState,
            newState
        }, 'circuit breaker state change');
    }
    /**
     * Get current state
     */
    getState() {
        return this.state;
    }
    /**
     * Get statistics
     */
    getStats() {
        return {
            name: this.config.name,
            state: this.state,
            totalCalls: this.totalCalls,
            successfulCalls: this.successes,
            failedCalls: this.failures,
            timedOutCalls: this.timedOutCalls,
            rejectedCalls: this.rejectedCalls,
            errorRate: this.calculateErrorRate(),
            lastFailure: this.lastFailureTime,
            lastSuccess: this.lastSuccessTime,
            lastStateChange: this.lastStateChangeTime
        };
    }
    /**
     * Force close the circuit (for recovery scenarios)
     */
    forceClose() {
        this.transitionTo(CircuitState.CLOSED);
        logger.warn({ breaker: this.config.name }, 'circuit breaker force closed');
    }
    /**
     * Force open the circuit (for maintenance scenarios)
     */
    forceOpen() {
        this.transitionTo(CircuitState.OPEN);
        logger.warn({ breaker: this.config.name }, 'circuit breaker force opened');
    }
    /**
     * Reset all statistics
     */
    reset() {
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.lastFailureTime = null;
        this.lastSuccessTime = null;
        this.lastStateChangeTime = new Date();
        this.halfOpenSuccesses = 0;
        this.totalCalls = 0;
        this.rejectedCalls = 0;
        this.timedOutCalls = 0;
        this.recentCalls = [];
        logger.info({ breaker: this.config.name }, 'circuit breaker reset');
    }
}
/**
 * Circuit breaker error - thrown when circuit is open
 */
export class CircuitBreakerError extends Error {
    breakerName;
    isCircuitBreakerError = true;
    constructor(message, breakerName) {
        super(message);
        this.name = 'CircuitBreakerError';
        this.breakerName = breakerName;
    }
}
/**
 * Circuit breaker timeout error
 */
export class CircuitBreakerTimeoutError extends Error {
    breakerName;
    isTimeout = true;
    constructor(message, breakerName) {
        super(message);
        this.name = 'CircuitBreakerTimeoutError';
        this.breakerName = breakerName;
    }
}
/**
 * Circuit breaker registry - manage multiple breakers
 */
class CircuitBreakerRegistry {
    breakers = new Map();
    /**
     * Get or create a circuit breaker
     */
    getBreaker(name, config) {
        let breaker = this.breakers.get(name);
        if (!breaker) {
            breaker = new CircuitBreaker({ ...config, name });
            this.breakers.set(name, breaker);
        }
        return breaker;
    }
    /**
     * Get all breaker stats
     */
    getAllStats() {
        return Array.from(this.breakers.values()).map(b => b.getStats());
    }
    /**
     * Reset all breakers
     */
    resetAll() {
        for (const breaker of this.breakers.values()) {
            breaker.reset();
        }
    }
    /**
     * Remove a breaker
     */
    removeBreaker(name) {
        return this.breakers.delete(name);
    }
    /**
     * Clear all breakers
     */
    clear() {
        this.breakers.clear();
    }
}
// Singleton registry
let registryInstance = null;
/**
 * Get the global circuit breaker registry
 */
export function getCircuitBreakerRegistry() {
    if (!registryInstance) {
        registryInstance = new CircuitBreakerRegistry();
    }
    return registryInstance;
}
/**
 * Reset the global registry
 */
export function resetCircuitBreakerRegistry() {
    if (registryInstance) {
        registryInstance.clear();
    }
    registryInstance = null;
}
/**
 * Convenience function - get or create a circuit breaker
 */
export function getCircuitBreaker(name, config) {
    return getCircuitBreakerRegistry().getBreaker(name, config);
}
/**
 * Pre-configured circuit breaker for database operations
 */
export const DATABASE_BREAKER_CONFIG = {
    errorThresholdPercentage: 50,
    requestVolumeThreshold: 10,
    sleepWindowMs: 10000,
    timeoutMs: 30000,
    successThreshold: 3
};
/**
 * Pre-configured circuit breaker for external API calls
 */
export const API_BREAKER_CONFIG = {
    errorThresholdPercentage: 60,
    requestVolumeThreshold: 5,
    sleepWindowMs: 30000,
    timeoutMs: 60000,
    successThreshold: 2
};
//# sourceMappingURL=circuitBreaker.js.map