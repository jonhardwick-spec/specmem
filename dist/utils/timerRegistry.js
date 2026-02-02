/**
 * timerRegistry.ts - Graceful Timer Management for SpecMem
 *
 * yo this registry keeps track of ALL intervals and timeouts
 * so we can clean them up properly on shutdown
 * no more orphaned timers fr fr
 *
 * Issue #18 fix - graceful shutdown for intervals/timers
 */
import { logger } from './logger.js';
/**
 * TimerRegistry - centralized timer management
 *
 * Features that SLAP:
 * - Track all setInterval/setTimeout calls
 * - Graceful cleanup on shutdown
 * - Debug logging for timer lifecycle
 * - Prevent timer leaks in tests
 */
class TimerRegistry {
    timers = new Map();
    isShuttingDown = false;
    nextId = 0;
    /**
     * Register and start an interval
     */
    registerInterval(callback, ms, description = 'unnamed interval') {
        if (this.isShuttingDown) {
            logger.warn({ description }, 'attempted to register interval during shutdown');
            // Return a dummy ID and don't actually create the interval
            return `shutdown-blocked-${this.nextId++}`;
        }
        const id = `interval-${this.nextId++}`;
        const handle = setInterval(callback, ms);
        this.timers.set(id, {
            id,
            handle,
            type: 'interval',
            description,
            createdAt: new Date()
        });
        logger.debug({ id, description, intervalMs: ms }, 'registered interval');
        return id;
    }
    /**
     * Register and start a timeout
     */
    registerTimeout(callback, ms, description = 'unnamed timeout') {
        if (this.isShuttingDown) {
            logger.warn({ description }, 'attempted to register timeout during shutdown');
            return `shutdown-blocked-${this.nextId++}`;
        }
        const id = `timeout-${this.nextId++}`;
        // Wrap callback to auto-remove from registry when it fires
        const wrappedCallback = () => {
            this.timers.delete(id);
            callback();
        };
        const handle = setTimeout(wrappedCallback, ms);
        this.timers.set(id, {
            id,
            handle,
            type: 'timeout',
            description,
            createdAt: new Date()
        });
        logger.debug({ id, description, delayMs: ms }, 'registered timeout');
        return id;
    }
    /**
     * Clear a specific timer by ID
     */
    clear(id) {
        const timer = this.timers.get(id);
        if (!timer) {
            return false;
        }
        if (timer.type === 'interval') {
            clearInterval(timer.handle);
        }
        else {
            clearTimeout(timer.handle);
        }
        this.timers.delete(id);
        logger.debug({ id, description: timer.description }, 'cleared timer');
        return true;
    }
    /**
     * Clear all timers - for graceful shutdown
     */
    clearAll() {
        this.isShuttingDown = true;
        let count = 0;
        for (const [id, timer] of this.timers) {
            if (timer.type === 'interval') {
                clearInterval(timer.handle);
            }
            else {
                clearTimeout(timer.handle);
            }
            logger.debug({ id, description: timer.description, type: timer.type }, 'cleared timer during shutdown');
            count++;
        }
        this.timers.clear();
        logger.info({ clearedCount: count }, 'all timers cleared during shutdown');
        return count;
    }
    /**
     * Get count of active timers
     */
    getActiveCount() {
        return this.timers.size;
    }
    /**
     * Get detailed stats about active timers
     */
    getStats() {
        const now = Date.now();
        const intervals = Array.from(this.timers.values()).filter(t => t.type === 'interval').length;
        const timeouts = this.timers.size - intervals;
        return {
            total: this.timers.size,
            intervals,
            timeouts,
            timers: Array.from(this.timers.values()).map(t => ({
                id: t.id,
                type: t.type,
                description: t.description,
                ageMs: now - t.createdAt.getTime()
            }))
        };
    }
    /**
     * Reset the registry (for testing)
     */
    reset() {
        this.clearAll();
        this.isShuttingDown = false;
        this.nextId = 0;
    }
}
// Singleton instance - THE ONE AND ONLY timer registry
let registryInstance = null;
/**
 * Get the global timer registry
 */
export function getTimerRegistry() {
    if (!registryInstance) {
        registryInstance = new TimerRegistry();
    }
    return registryInstance;
}
/**
 * Reset the global timer registry (for testing)
 */
export function resetTimerRegistry() {
    if (registryInstance) {
        registryInstance.reset();
    }
    registryInstance = null;
}
/**
 * Convenience function - register an interval
 */
export function registerInterval(callback, ms, description) {
    return getTimerRegistry().registerInterval(callback, ms, description);
}
/**
 * Convenience function - register a timeout
 */
export function registerTimeout(callback, ms, description) {
    return getTimerRegistry().registerTimeout(callback, ms, description);
}
/**
 * Convenience function - clear a timer
 */
export function clearRegisteredTimer(id) {
    return getTimerRegistry().clear(id);
}
/**
 * Convenience function - clear all timers (for shutdown)
 */
export function clearAllTimers() {
    return getTimerRegistry().clearAll();
}
export { TimerRegistry };
//# sourceMappingURL=timerRegistry.js.map