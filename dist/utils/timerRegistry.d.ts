/**
 * timerRegistry.ts - Graceful Timer Management for SpecMem
 *
 * yo this registry keeps track of ALL intervals and timeouts
 * so we can clean them up properly on shutdown
 * no more orphaned timers fr fr
 *
 * Issue #18 fix - graceful shutdown for intervals/timers
 */
/**
 * Timer types we track
 */
type TimerType = 'interval' | 'timeout';
/**
 * TimerRegistry - centralized timer management
 *
 * Features that SLAP:
 * - Track all setInterval/setTimeout calls
 * - Graceful cleanup on shutdown
 * - Debug logging for timer lifecycle
 * - Prevent timer leaks in tests
 */
declare class TimerRegistry {
    private timers;
    private isShuttingDown;
    private nextId;
    /**
     * Register and start an interval
     */
    registerInterval(callback: () => void, ms: number, description?: string): string;
    /**
     * Register and start a timeout
     */
    registerTimeout(callback: () => void, ms: number, description?: string): string;
    /**
     * Clear a specific timer by ID
     */
    clear(id: string): boolean;
    /**
     * Clear all timers - for graceful shutdown
     */
    clearAll(): number;
    /**
     * Get count of active timers
     */
    getActiveCount(): number;
    /**
     * Get detailed stats about active timers
     */
    getStats(): {
        total: number;
        intervals: number;
        timeouts: number;
        timers: Array<{
            id: string;
            type: TimerType;
            description: string;
            ageMs: number;
        }>;
    };
    /**
     * Reset the registry (for testing)
     */
    reset(): void;
}
/**
 * Get the global timer registry
 */
export declare function getTimerRegistry(): TimerRegistry;
/**
 * Reset the global timer registry (for testing)
 */
export declare function resetTimerRegistry(): void;
/**
 * Convenience function - register an interval
 */
export declare function registerInterval(callback: () => void, ms: number, description?: string): string;
/**
 * Convenience function - register a timeout
 */
export declare function registerTimeout(callback: () => void, ms: number, description?: string): string;
/**
 * Convenience function - clear a timer
 */
export declare function clearRegisteredTimer(id: string): boolean;
/**
 * Convenience function - clear all timers (for shutdown)
 */
export declare function clearAllTimers(): number;
export { TimerRegistry };
//# sourceMappingURL=timerRegistry.d.ts.map