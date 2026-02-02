/**
 * cleanupHandler.ts - Centralized Cleanup Handler for Event Listeners
 *
 * Provides utilities to register and manage cleanup handlers for
 * event listeners, preventing memory leaks and ensuring graceful shutdown.
 *
 * Features:
 * - Centralized cleanup registration
 * - Automatic cleanup on process exit
 * - Priority-based cleanup ordering
 * - Error handling for failed cleanups
 *
 * @author hardwicksoftwareservices
 */
import { logger } from './logger.js';
/**
 * Cleanup handler manager
 * Centralized registry for cleanup handlers
 */
class CleanupHandlerManager {
    handlers = new Map();
    isShuttingDown = false;
    cleanupPromise = null;
    handlerIdCounter = 0;
    constructor() {
        // Register process exit handlers
        this.setupProcessHandlers();
    }
    /**
     * Set up process exit handlers
     */
    setupProcessHandlers() {
        // Handle various exit signals
        const exitHandler = (signal) => {
            logger.debug({ signal }, 'received exit signal, running cleanup');
            this.runAllCleanups().catch(err => {
                logger.error({ err }, 'error during cleanup');
            });
        };
        // These are already registered in the main process, but we add them
        // as a safety net for subprocesses or if main handlers fail
        process.once('SIGINT', () => exitHandler('SIGINT'));
        process.once('SIGTERM', () => exitHandler('SIGTERM'));
        process.once('beforeExit', () => exitHandler('beforeExit'));
    }
    /**
     * Generate unique handler ID
     */
    generateId() {
        return `cleanup_${Date.now()}_${++this.handlerIdCounter}`;
    }
    /**
     * Register a cleanup handler
     *
     * @param name Human-readable name for logging
     * @param cleanup The cleanup function
     * @param priority Lower = run first (default: 100)
     * @returns Handler ID for removal
     */
    register(name, cleanup, priority = 100) {
        const id = this.generateId();
        const registration = {
            id,
            name,
            cleanup,
            priority,
            registered: new Date()
        };
        this.handlers.set(id, registration);
        logger.debug({ id, name, priority, totalHandlers: this.handlers.size }, 'cleanup handler registered');
        return id;
    }
    /**
     * Unregister a cleanup handler
     *
     * @param id Handler ID returned from register()
     */
    unregister(id) {
        const handler = this.handlers.get(id);
        if (handler) {
            this.handlers.delete(id);
            logger.debug({ id, name: handler.name }, 'cleanup handler unregistered');
            return true;
        }
        return false;
    }
    /**
     * Run all cleanup handlers
     */
    async runAllCleanups() {
        if (this.isShuttingDown) {
            // Already cleaning up, return existing promise
            return this.cleanupPromise;
        }
        this.isShuttingDown = true;
        this.cleanupPromise = this.executeCleanups();
        return this.cleanupPromise;
    }
    /**
     * Execute cleanup handlers in priority order
     */
    async executeCleanups() {
        // Sort by priority (lower first)
        const sortedHandlers = Array.from(this.handlers.values())
            .sort((a, b) => a.priority - b.priority);
        logger.info({ count: sortedHandlers.length }, 'running cleanup handlers');
        const results = [];
        for (const handler of sortedHandlers) {
            try {
                logger.debug({ name: handler.name, priority: handler.priority }, 'running cleanup handler');
                await handler.cleanup();
                results.push({ name: handler.name, success: true });
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                logger.error({ name: handler.name, error: errorMsg }, 'cleanup handler failed');
                results.push({ name: handler.name, success: false, error: errorMsg });
            }
        }
        // Clear handlers after cleanup
        this.handlers.clear();
        const failed = results.filter(r => !r.success);
        if (failed.length > 0) {
            logger.warn({ failed: failed.length, total: results.length }, 'some cleanup handlers failed');
        }
        else {
            logger.info({ total: results.length }, 'all cleanup handlers completed successfully');
        }
    }
    /**
     * Get count of registered handlers
     */
    getHandlerCount() {
        return this.handlers.size;
    }
    /**
     * Get registered handler names (for debugging)
     */
    getHandlerNames() {
        return Array.from(this.handlers.values()).map(h => h.name);
    }
    /**
     * Check if shutdown is in progress
     */
    isInShutdown() {
        return this.isShuttingDown;
    }
}
// Singleton instance
const cleanupManager = new CleanupHandlerManager();
/**
 * Register a cleanup handler
 */
export function registerCleanupHandler(name, cleanup, priority = 100) {
    return cleanupManager.register(name, cleanup, priority);
}
/**
 * Unregister a cleanup handler
 */
export function unregisterCleanupHandler(id) {
    return cleanupManager.unregister(id);
}
/**
 * Run all cleanup handlers
 */
export function runAllCleanups() {
    return cleanupManager.runAllCleanups();
}
/**
 * Get the cleanup manager instance
 */
export function getCleanupManager() {
    return cleanupManager;
}
/**
 * Helper to register cleanup for an event emitter
 *
 * Automatically removes event listeners when cleanup runs
 */
export function registerEventCleanup(emitter, eventName, listener, name) {
    return registerCleanupHandler(name || `EventListener:${eventName}`, () => {
        emitter.removeListener(eventName, listener);
    }, 50 // Higher priority to remove listeners early
    );
}
/**
 * Helper to safely add an error handler with cleanup
 */
export function addErrorHandler(emitter, handler, name) {
    emitter.on('error', handler);
    return registerEventCleanup(emitter, 'error', handler, name || 'ErrorHandler');
}
/**
 * Create a wrapped event listener that automatically cleans up
 */
export function createManagedListener(emitter, eventName, listener, name) {
    const cleanupId = registerEventCleanup(emitter, eventName, listener, name);
    return {
        listener,
        cleanup: () => unregisterCleanupHandler(cleanupId)
    };
}
//# sourceMappingURL=cleanupHandler.js.map