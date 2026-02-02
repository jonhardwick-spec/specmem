/**
 * config.ts - Event Bus Configuration System
 *
 * Adapted from Hippo's LWJEB BusConfigurations pattern
 * (https://github.com/Hippo/LWJEB)
 *
 * Provides configuration management equivalent to:
 * - BusConfiguration
 * - BusPubSubConfiguration
 * - AsynchronousPublicationConfiguration
 * - ExceptionHandlingConfiguration
 *
 * @author hardwicksoftwareservices
 */
import { logger } from '../utils/logger.js';
/**
 * Default exception handler - logs errors
 */
export const defaultExceptionHandler = (error, context) => {
    logger.error({ error, ...context }, 'event bus exception');
};
/**
 * Get default configuration
 * Equivalent to LWJEB's BusConfigurations.getDefault()
 */
export function getDefaultConfiguration() {
    return {
        identifier: 'LWJEB-TS',
        dispatcherCount: 3,
        daemonMode: true,
        suppressDispatcherInterrupt: true,
        cacheEnabled: true,
        maxCacheSize: 1000, // reduced from 10000 to save RAM
        maxQueueSize: 5000, // reduced from 100000 to save RAM
        maxLatencyMs: 25, // Sub-25ms target as per requirements
        exceptionHandler: defaultExceptionHandler
    };
}
/**
 * Configuration builder pattern
 * Equivalent to LWJEB's BusConfigurations.Builder
 */
export class EventBusConfigurationBuilder {
    config;
    constructor() {
        this.config = getDefaultConfiguration();
    }
    /**
     * Set bus identifier
     */
    identifier(id) {
        this.config.identifier = id;
        return this;
    }
    /**
     * Set dispatcher count
     */
    dispatchers(count) {
        if (count < 1) {
            throw new Error('dispatcher count must be at least 1');
        }
        this.config.dispatcherCount = count;
        return this;
    }
    /**
     * Enable/disable daemon mode
     */
    daemon(enabled) {
        this.config.daemonMode = enabled;
        return this;
    }
    /**
     * Enable/disable caching
     */
    caching(enabled) {
        this.config.cacheEnabled = enabled;
        return this;
    }
    /**
     * Set maximum cache size
     */
    maxCache(size) {
        if (size < 0) {
            throw new Error('cache size must be non-negative');
        }
        this.config.maxCacheSize = size;
        return this;
    }
    /**
     * Set maximum queue size
     */
    maxQueue(size) {
        if (size < 1) {
            throw new Error('queue size must be at least 1');
        }
        this.config.maxQueueSize = size;
        return this;
    }
    /**
     * Set latency target (for warnings)
     */
    latencyTarget(ms) {
        if (ms < 1) {
            throw new Error('latency target must be at least 1ms');
        }
        this.config.maxLatencyMs = ms;
        return this;
    }
    /**
     * Set exception handler
     */
    onException(handler) {
        this.config.exceptionHandler = handler;
        return this;
    }
    /**
     * Build the configuration
     */
    build() {
        return { ...this.config };
    }
}
/**
 * Create a configuration builder
 */
export function configBuilder() {
    return new EventBusConfigurationBuilder();
}
/**
 * Predefined configuration profiles
 * Equivalent to common LWJEB use cases
 */
export const ConfigProfiles = {
    /**
     * High performance configuration
     * Optimized for sub-10ms latency
     */
    highPerformance() {
        return configBuilder()
            .identifier('high-perf')
            .dispatchers(5)
            .daemon(true)
            .caching(true)
            .maxCache(50000)
            .maxQueue(500000)
            .latencyTarget(10)
            .build();
    },
    /**
     * Memory efficient configuration
     * Reduced cache/queue sizes
     */
    memoryEfficient() {
        return configBuilder()
            .identifier('mem-efficient')
            .dispatchers(2)
            .daemon(true)
            .caching(true)
            .maxCache(1000)
            .maxQueue(10000)
            .latencyTarget(50)
            .build();
    },
    /**
     * Debug configuration
     * Verbose logging, strict latency
     */
    debug() {
        return configBuilder()
            .identifier('debug')
            .dispatchers(1)
            .daemon(false)
            .caching(false)
            .maxCache(100)
            .maxQueue(1000)
            .latencyTarget(100)
            .onException((error, context) => {
            logger.error({ error, ...context }, '[DEBUG] event bus exception');
            // In debug mode, also log stack trace
            if (error.stack) {
                logger.debug({ stack: error.stack }, 'stack trace');
            }
        })
            .build();
    },
    /**
     * MCP optimized configuration
     * Balanced for MCP tool integration
     */
    mcpOptimized() {
        return configBuilder()
            .identifier('specmem-mcp')
            .dispatchers(3)
            .daemon(true)
            .caching(true)
            .maxCache(10000)
            .maxQueue(50000)
            .latencyTarget(25) // Sub-25ms as per requirements
            .build();
    }
};
/**
 * Load configuration from environment variables
 */
export function loadConfigFromEnv() {
    const config = {};
    const identifier = process.env['SPECMEM_EVENT_BUS_ID'];
    if (identifier) {
        config.identifier = identifier;
    }
    const dispatchers = process.env['SPECMEM_EVENT_DISPATCHERS'];
    if (dispatchers) {
        config.dispatcherCount = parseInt(dispatchers, 10);
    }
    const cacheEnabled = process.env['SPECMEM_EVENT_CACHE_ENABLED'];
    if (cacheEnabled !== undefined) {
        config.cacheEnabled = cacheEnabled.toLowerCase() === 'true';
    }
    const maxCache = process.env['SPECMEM_EVENT_MAX_CACHE'];
    if (maxCache) {
        config.maxCacheSize = parseInt(maxCache, 10);
    }
    const maxQueue = process.env['SPECMEM_EVENT_MAX_QUEUE'];
    if (maxQueue) {
        config.maxQueueSize = parseInt(maxQueue, 10);
    }
    const latencyTarget = process.env['SPECMEM_EVENT_LATENCY_TARGET'];
    if (latencyTarget) {
        config.maxLatencyMs = parseInt(latencyTarget, 10);
    }
    return config;
}
/**
 * Validate configuration
 */
export function validateConfiguration(config) {
    const errors = [];
    if (!config.identifier || config.identifier.trim() === '') {
        errors.push('identifier is required');
    }
    if (config.dispatcherCount < 1) {
        errors.push('dispatcherCount must be at least 1');
    }
    if (config.maxCacheSize < 0) {
        errors.push('maxCacheSize must be non-negative');
    }
    if (config.maxQueueSize < 1) {
        errors.push('maxQueueSize must be at least 1');
    }
    if (config.maxLatencyMs < 1) {
        errors.push('maxLatencyMs must be at least 1');
    }
    return errors;
}
/**
 * Merge configurations with validation
 */
export function mergeConfigurations(base, override) {
    const merged = { ...base, ...override };
    const errors = validateConfiguration(merged);
    if (errors.length > 0) {
        throw new Error(`Invalid configuration: ${errors.join(', ')}`);
    }
    return merged;
}
//# sourceMappingURL=config.js.map