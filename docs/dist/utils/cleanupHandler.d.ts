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
import { EventEmitter } from 'events';
/**
 * Cleanup handler function type
 */
export type CleanupFn = () => void | Promise<void>;
/**
 * Cleanup handler manager
 * Centralized registry for cleanup handlers
 */
declare class CleanupHandlerManager {
    private handlers;
    private isShuttingDown;
    private cleanupPromise;
    private handlerIdCounter;
    constructor();
    /**
     * Set up process exit handlers
     */
    private setupProcessHandlers;
    /**
     * Generate unique handler ID
     */
    private generateId;
    /**
     * Register a cleanup handler
     *
     * @param name Human-readable name for logging
     * @param cleanup The cleanup function
     * @param priority Lower = run first (default: 100)
     * @returns Handler ID for removal
     */
    register(name: string, cleanup: CleanupFn, priority?: number): string;
    /**
     * Unregister a cleanup handler
     *
     * @param id Handler ID returned from register()
     */
    unregister(id: string): boolean;
    /**
     * Run all cleanup handlers
     */
    runAllCleanups(): Promise<void>;
    /**
     * Execute cleanup handlers in priority order
     */
    private executeCleanups;
    /**
     * Get count of registered handlers
     */
    getHandlerCount(): number;
    /**
     * Get registered handler names (for debugging)
     */
    getHandlerNames(): string[];
    /**
     * Check if shutdown is in progress
     */
    isInShutdown(): boolean;
}
/**
 * Register a cleanup handler
 */
export declare function registerCleanupHandler(name: string, cleanup: CleanupFn, priority?: number): string;
/**
 * Unregister a cleanup handler
 */
export declare function unregisterCleanupHandler(id: string): boolean;
/**
 * Run all cleanup handlers
 */
export declare function runAllCleanups(): Promise<void>;
/**
 * Get the cleanup manager instance
 */
export declare function getCleanupManager(): CleanupHandlerManager;
/**
 * Helper to register cleanup for an event emitter
 *
 * Automatically removes event listeners when cleanup runs
 */
export declare function registerEventCleanup(emitter: EventEmitter, eventName: string, listener: (...args: unknown[]) => void, name?: string): string;
/**
 * Helper to safely add an error handler with cleanup
 */
export declare function addErrorHandler(emitter: EventEmitter, handler: (error: Error) => void, name?: string): string;
/**
 * Create a wrapped event listener that automatically cleans up
 */
export declare function createManagedListener<T extends (...args: unknown[]) => void>(emitter: EventEmitter, eventName: string, listener: T, name?: string): {
    listener: T;
    cleanup: () => void;
};
export {};
//# sourceMappingURL=cleanupHandler.d.ts.map