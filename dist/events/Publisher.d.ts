/**
 * Publisher.ts - LWJEB-inspired Event Publishing System
 *
 * Adapted from Hippo's LWJEB (https://github.com/Hippo/LWJEB)
 * TypeScript implementation for SpecMem MCP
 *
 * Key features from LWJEB:
 * - PubSub pattern with result caching
 * - Async dispatcher threads (via setImmediate/setTimeout in JS)
 * - WeakRef-based subscriber management
 * - Sub-25ms dispatch latency target
 *
 * @author hardwicksoftwareservices (adapted from Hippo's Java implementation)
 */
import { EventEmitter } from 'events';
import { EventBusConfiguration } from './config.js';
import { PerformanceMetrics } from './metrics.js';
/**
 * Message handler function type
 * Equivalent to LWJEB's MessageHandler<T>
 */
export type MessageHandler<T> = (topic: T) => void | Promise<void>;
/**
 * Handler registration with metadata
 * Similar to LWJEB's wrapped handlers
 */
export interface RegisteredHandler<T> {
    handler: MessageHandler<T>;
    priority: number;
    filter?: (topic: T) => boolean;
    once: boolean;
    subscriberId: string;
}
/**
 * Publication result - equivalent to LWJEB's MessagePublicationResult<T>
 * Gives control over how publications are handled
 */
export interface PublicationResult<T> {
    topic: T;
    handlers: RegisteredHandler<T>[];
    timestamp: number;
    /** Dispatch immediately on current tick */
    dispatch(): Promise<DispatchResult>;
    /** Queue for async dispatch */
    async(): void;
    /** Queue with timeout */
    asyncWithTimeout(timeoutMs: number): void;
}
/**
 * Result of dispatching an event
 */
export interface DispatchResult {
    success: boolean;
    handlersInvoked: number;
    errors: Error[];
    durationMs: number;
}
/**
 * Dead message result - when no handlers exist
 * Equivalent to LWJEB's DeadMessagePublicationResult
 */
export declare class DeadPublicationResult<T> implements PublicationResult<T> {
    topic: T;
    handlers: RegisteredHandler<T>[];
    timestamp: number;
    constructor(topic: T);
    dispatch(): Promise<DispatchResult>;
    async(): void;
    asyncWithTimeout(_timeoutMs: number): void;
}
/**
 * Standard publication result with handlers
 * Equivalent to LWJEB's StandardMessagePublicationResult
 */
export declare class StandardPublicationResult<T> implements PublicationResult<T> {
    topic: T;
    handlers: RegisteredHandler<T>[];
    timestamp: number;
    private publisher;
    private dispatched;
    constructor(publisher: EventPublisher<T>, topic: T, handlers: RegisteredHandler<T>[]);
    dispatch(): Promise<DispatchResult>;
    async(): void;
    asyncWithTimeout(timeoutMs: number): void;
}
/**
 * EventPublisher - TypeScript adaptation of LWJEB's PubSub<T>
 *
 * Features:
 * - Result caching for identical topics (performance optimization)
 * - WeakRef subscriber management
 * - Priority-based handler ordering
 * - Filter support for selective handling
 * - Performance metrics tracking
 */
export declare class EventPublisher<T = unknown> extends EventEmitter {
    private config;
    private metrics;
    private subscriberMap;
    private resultCache;
    private dispatchQueue;
    private isProcessingQueue;
    private shutdown;
    constructor(config?: Partial<EventBusConfiguration>);
    /**
     * Setup async dispatchers - equivalent to LWJEB's setupDispatchers()
     * Uses setInterval instead of Java threads
     */
    private setupDispatchers;
    /**
     * Process the async dispatch queue
     */
    private processDispatchQueue;
    /**
     * Post/publish a topic - equivalent to LWJEB's post(T topic)
     *
     * Uses caching for performance: if we've seen this exact topic before
     * and handlers haven't changed, return cached result
     */
    post(topic: T): PublicationResult<T>;
    /**
     * Subscribe a handler - equivalent to LWJEB's subscribe(Object parent)
     */
    subscribe(topicType: string, handler: MessageHandler<T>, options?: {
        priority?: number;
        filter?: (topic: T) => boolean;
        once?: boolean;
        subscriberId?: string;
    }): void;
    /**
     * Subscribe once - handler is removed after first invocation
     */
    subscribeOnce(topicType: string, handler: MessageHandler<T>, options?: Omit<Parameters<typeof this.subscribe>[2], 'once'>): void;
    /**
     * Unsubscribe handlers - equivalent to LWJEB's unsubscribe(Object parent)
     */
    unsubscribe(topicType: string, subscriberId?: string): void;
    /**
     * Remove a specific handler registration
     * Used internally for one-time handlers
     */
    removeHandler(registered: RegisteredHandler<T>): void;
    /**
     * Invalidate all caches - equivalent to LWJEB's invalidateCaches()
     */
    invalidateCaches(): void;
    /**
     * Add message to async dispatch queue
     * Equivalent to LWJEB's addMessage()
     */
    addToQueue(result: PublicationResult<T>): void;
    /**
     * Get current metrics
     */
    getMetrics(): PerformanceMetrics;
    /**
     * Get subscriber count for a topic type
     */
    getSubscriberCount(topicType: string): number;
    /**
     * Get all registered topic types
     */
    getTopicTypes(): string[];
    /**
     * Shutdown the publisher - equivalent to LWJEB's shutdown()
     */
    shutdownGracefully(timeoutMs?: number): Promise<void>;
    /**
     * Force immediate shutdown - equivalent to LWJEB's forceShutdown()
     */
    forceShutdown(): void;
    /**
     * Generate cache key for a topic
     */
    private generateCacheKey;
    /**
     * Get topic type identifier
     */
    private getTopicType;
    /**
     * Generate unique subscriber ID
     */
    private generateSubscriberId;
}
/**
 * Create a new EventPublisher instance
 * Factory function for convenience
 */
export declare function createPublisher<T = unknown>(config?: Partial<EventBusConfiguration>): EventPublisher<T>;
export declare function getGlobalPublisher(): EventPublisher;
export declare function resetGlobalPublisher(): void;
export type { EventBusConfiguration } from './config.js';
//# sourceMappingURL=Publisher.d.ts.map