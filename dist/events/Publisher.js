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
import { getDefaultConfiguration } from './config.js';
import { createMetrics } from './metrics.js';
import { logger } from '../utils/logger.js';
/**
 * Dead message result - when no handlers exist
 * Equivalent to LWJEB's DeadMessagePublicationResult
 */
export class DeadPublicationResult {
    topic;
    handlers = [];
    timestamp;
    constructor(topic) {
        this.topic = topic;
        this.timestamp = Date.now();
    }
    async dispatch() {
        return {
            success: false,
            handlersInvoked: 0,
            errors: [],
            durationMs: 0
        };
    }
    async() {
        // No-op for dead messages
    }
    asyncWithTimeout(_timeoutMs) {
        // No-op for dead messages
    }
}
/**
 * Standard publication result with handlers
 * Equivalent to LWJEB's StandardMessagePublicationResult
 */
export class StandardPublicationResult {
    topic;
    handlers;
    timestamp;
    publisher;
    dispatched = false;
    constructor(publisher, topic, handlers) {
        this.publisher = publisher;
        this.topic = topic;
        this.handlers = handlers;
        this.timestamp = Date.now();
    }
    async dispatch() {
        if (this.dispatched) {
            return {
                success: false,
                handlersInvoked: 0,
                errors: [new Error('Already dispatched')],
                durationMs: 0
            };
        }
        this.dispatched = true;
        const startTime = performance.now();
        const errors = [];
        let handlersInvoked = 0;
        // Sort by priority (higher = first)
        const sortedHandlers = [...this.handlers].sort((a, b) => b.priority - a.priority);
        for (const registered of sortedHandlers) {
            // Apply filter if present
            if (registered.filter && !registered.filter(this.topic)) {
                continue;
            }
            try {
                await registered.handler(this.topic);
                handlersInvoked++;
                // Remove one-time handlers
                if (registered.once) {
                    this.publisher.removeHandler(registered);
                }
            }
            catch (error) {
                errors.push(error instanceof Error ? error : new Error(String(error)));
            }
        }
        const durationMs = performance.now() - startTime;
        return {
            success: errors.length === 0,
            handlersInvoked,
            errors,
            durationMs
        };
    }
    async() {
        setImmediate(() => {
            this.dispatch().catch(err => {
                logger.error({ error: err }, 'async dispatch failed');
            });
        });
    }
    asyncWithTimeout(timeoutMs) {
        const timeoutHandle = setTimeout(() => {
            if (!this.dispatched) {
                logger.warn({ topic: this.topic, timeoutMs }, 'async dispatch timed out');
            }
        }, timeoutMs);
        setImmediate(() => {
            this.dispatch()
                .then(() => clearTimeout(timeoutHandle))
                .catch(err => {
                clearTimeout(timeoutHandle);
                logger.error({ error: err }, 'async dispatch failed');
            });
        });
    }
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
export class EventPublisher extends EventEmitter {
    config;
    metrics;
    // Subscriber map: topic class/type -> handlers
    // Equivalent to LWJEB's subscriberMap
    subscriberMap = new Map();
    // Result cache for performance (LWJEB's resultCache HashMap)
    resultCache = new Map();
    // Async dispatch queue (LWJEB's BlockingQueue)
    dispatchQueue = [];
    isProcessingQueue = false;
    // Shutdown flag
    shutdown = false;
    constructor(config) {
        super();
        this.config = { ...getDefaultConfiguration(), ...config };
        this.metrics = createMetrics(this.config.identifier);
        // Start dispatcher "threads" (via intervals)
        this.setupDispatchers();
        logger.info({ identifier: this.config.identifier }, 'EventPublisher initialized');
    }
    /**
     * Setup async dispatchers - equivalent to LWJEB's setupDispatchers()
     * Uses setInterval instead of Java threads
     */
    setupDispatchers() {
        const processInterval = setInterval(() => {
            if (this.shutdown) {
                clearInterval(processInterval);
                return;
            }
            this.processDispatchQueue();
        }, 1); // Process queue every 1ms for low latency
        // Allow process to exit even if interval is running
        if (processInterval.unref) {
            processInterval.unref();
        }
    }
    /**
     * Process the async dispatch queue
     */
    async processDispatchQueue() {
        if (this.isProcessingQueue || this.dispatchQueue.length === 0) {
            return;
        }
        this.isProcessingQueue = true;
        try {
            // Process up to dispatcherCount items per tick
            const batchSize = Math.min(this.config.dispatcherCount, this.dispatchQueue.length);
            for (let i = 0; i < batchSize; i++) {
                const result = this.dispatchQueue.shift();
                if (result) {
                    await result.dispatch();
                }
            }
        }
        finally {
            this.isProcessingQueue = false;
        }
    }
    /**
     * Post/publish a topic - equivalent to LWJEB's post(T topic)
     *
     * Uses caching for performance: if we've seen this exact topic before
     * and handlers haven't changed, return cached result
     */
    post(topic) {
        const startTime = performance.now();
        // Generate cache key from topic
        const cacheKey = this.generateCacheKey(topic);
        // Check cache if enabled
        if (this.config.cacheEnabled) {
            const cached = this.resultCache.get(cacheKey);
            if (cached) {
                this.metrics.recordCacheHit();
                this.metrics.recordPublish(performance.now() - startTime);
                return cached;
            }
            this.metrics.recordCacheMiss();
        }
        // Get handlers for this topic type
        const topicType = this.getTopicType(topic);
        const handlers = this.subscriberMap.get(topicType) ?? [];
        // Create result
        let result;
        if (handlers.length === 0) {
            result = new DeadPublicationResult(topic);
            this.emit('deadMessage', topic);
        }
        else {
            result = new StandardPublicationResult(this, topic, [...handlers]);
        }
        // Cache the result
        if (this.config.cacheEnabled) {
            this.resultCache.set(cacheKey, result);
            // Enforce cache size limit
            if (this.resultCache.size > this.config.maxCacheSize) {
                const firstKey = this.resultCache.keys().next().value;
                if (firstKey) {
                    this.resultCache.delete(firstKey);
                }
            }
        }
        const duration = performance.now() - startTime;
        this.metrics.recordPublish(duration);
        // Warn if exceeding latency target
        if (duration > this.config.maxLatencyMs) {
            logger.warn({
                duration,
                target: this.config.maxLatencyMs,
                topicType
            }, 'publish exceeded latency target');
        }
        return result;
    }
    /**
     * Subscribe a handler - equivalent to LWJEB's subscribe(Object parent)
     */
    subscribe(topicType, handler, options = {}) {
        const registered = {
            handler,
            priority: options.priority ?? 0,
            filter: options.filter,
            once: options.once ?? false,
            subscriberId: options.subscriberId ?? this.generateSubscriberId()
        };
        const handlers = this.subscriberMap.get(topicType) ?? [];
        handlers.push(registered);
        this.subscriberMap.set(topicType, handlers);
        // Invalidate cache when subscriptions change
        this.invalidateCaches();
        this.metrics.recordSubscribe();
        logger.debug({
            topicType,
            subscriberId: registered.subscriberId,
            priority: registered.priority
        }, 'handler subscribed');
    }
    /**
     * Subscribe once - handler is removed after first invocation
     */
    subscribeOnce(topicType, handler, options = {}) {
        this.subscribe(topicType, handler, { ...options, once: true });
    }
    /**
     * Unsubscribe handlers - equivalent to LWJEB's unsubscribe(Object parent)
     */
    unsubscribe(topicType, subscriberId) {
        if (!this.subscriberMap.has(topicType)) {
            return;
        }
        if (subscriberId) {
            // Remove specific subscriber
            const handlers = this.subscriberMap.get(topicType) ?? [];
            const filtered = handlers.filter(h => h.subscriberId !== subscriberId);
            this.subscriberMap.set(topicType, filtered);
        }
        else {
            // Remove all handlers for topic type
            this.subscriberMap.delete(topicType);
        }
        // Invalidate cache when subscriptions change
        this.invalidateCaches();
        this.metrics.recordUnsubscribe();
        logger.debug({ topicType, subscriberId }, 'handler unsubscribed');
    }
    /**
     * Remove a specific handler registration
     * Used internally for one-time handlers
     */
    removeHandler(registered) {
        for (const [topicType, handlers] of this.subscriberMap.entries()) {
            const index = handlers.indexOf(registered);
            if (index >= 0) {
                handlers.splice(index, 1);
                this.invalidateCaches();
                break;
            }
        }
    }
    /**
     * Invalidate all caches - equivalent to LWJEB's invalidateCaches()
     */
    invalidateCaches() {
        this.resultCache.clear();
        this.metrics.recordCacheInvalidation();
    }
    /**
     * Add message to async dispatch queue
     * Equivalent to LWJEB's addMessage()
     */
    addToQueue(result) {
        if (this.dispatchQueue.length >= this.config.maxQueueSize) {
            logger.warn({
                queueSize: this.dispatchQueue.length,
                maxSize: this.config.maxQueueSize
            }, 'dispatch queue full - dropping message');
            return;
        }
        this.dispatchQueue.push(result);
    }
    /**
     * Get current metrics
     */
    getMetrics() {
        return this.metrics;
    }
    /**
     * Get subscriber count for a topic type
     */
    getSubscriberCount(topicType) {
        return this.subscriberMap.get(topicType)?.length ?? 0;
    }
    /**
     * Get all registered topic types
     */
    getTopicTypes() {
        return Array.from(this.subscriberMap.keys());
    }
    /**
     * Shutdown the publisher - equivalent to LWJEB's shutdown()
     */
    async shutdownGracefully(timeoutMs = 5000) {
        logger.info({ identifier: this.config.identifier }, 'shutting down publisher...');
        // Wait for queue to drain (with timeout)
        const startTime = Date.now();
        while (this.dispatchQueue.length > 0 && (Date.now() - startTime) < timeoutMs) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        if (this.dispatchQueue.length > 0) {
            logger.warn({
                remainingMessages: this.dispatchQueue.length
            }, 'shutdown timeout - some messages not dispatched');
        }
        this.shutdown = true;
        this.removeAllListeners();
        logger.info({ identifier: this.config.identifier }, 'publisher shut down');
    }
    /**
     * Force immediate shutdown - equivalent to LWJEB's forceShutdown()
     */
    forceShutdown() {
        this.shutdown = true;
        this.dispatchQueue.length = 0;
        this.removeAllListeners();
        logger.info({ identifier: this.config.identifier }, 'publisher force shut down');
    }
    /**
     * Generate cache key for a topic
     */
    generateCacheKey(topic) {
        // For objects, use JSON stringification
        // For primitives, use toString
        if (typeof topic === 'object' && topic !== null) {
            try {
                return JSON.stringify(topic);
            }
            catch (e) {
                // Circular reference or non-serializable - fall back to String
                return String(topic);
            }
        }
        return String(topic);
    }
    /**
     * Get topic type identifier
     */
    getTopicType(topic) {
        if (typeof topic === 'object' && topic !== null) {
            // Use constructor name or 'object'
            return topic.constructor?.name ?? 'object';
        }
        return typeof topic;
    }
    /**
     * Generate unique subscriber ID
     */
    generateSubscriberId() {
        return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}
/**
 * Create a new EventPublisher instance
 * Factory function for convenience
 */
export function createPublisher(config) {
    return new EventPublisher(config);
}
/**
 * Global publisher singleton for convenience
 */
let globalPublisher = null;
export function getGlobalPublisher() {
    if (!globalPublisher) {
        globalPublisher = createPublisher({ identifier: 'specmem-global' });
    }
    return globalPublisher;
}
export function resetGlobalPublisher() {
    if (globalPublisher) {
        globalPublisher.forceShutdown();
        globalPublisher = null;
    }
}
//# sourceMappingURL=Publisher.js.map