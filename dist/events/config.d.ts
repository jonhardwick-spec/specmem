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
/**
 * Main event bus configuration
 * Equivalent to LWJEB's BusConfiguration + AsynchronousPublicationConfiguration
 */
export interface EventBusConfiguration {
    /** Unique identifier for this bus instance */
    identifier: string;
    /** Number of async dispatchers (equivalent to LWJEB's dispatcherCount) */
    dispatcherCount: number;
    /** Use daemon-style processing (allow process exit) */
    daemonMode: boolean;
    /** Suppress interrupt exceptions during shutdown */
    suppressDispatcherInterrupt: boolean;
    /** Enable result caching for performance */
    cacheEnabled: boolean;
    /** Maximum cache entries before eviction */
    maxCacheSize: number;
    /** Maximum async queue size */
    maxQueueSize: number;
    /** Target latency in milliseconds (warn if exceeded) */
    maxLatencyMs: number;
    /** Exception handler callback */
    exceptionHandler: ExceptionHandler;
}
/**
 * Exception handler type
 * Equivalent to LWJEB's ExceptionHandlingConfiguration
 */
export type ExceptionHandler = (error: Error, context?: Record<string, unknown>) => void;
/**
 * Default exception handler - logs errors
 */
export declare const defaultExceptionHandler: ExceptionHandler;
/**
 * Get default configuration
 * Equivalent to LWJEB's BusConfigurations.getDefault()
 */
export declare function getDefaultConfiguration(): EventBusConfiguration;
/**
 * Configuration builder pattern
 * Equivalent to LWJEB's BusConfigurations.Builder
 */
export declare class EventBusConfigurationBuilder {
    private config;
    constructor();
    /**
     * Set bus identifier
     */
    identifier(id: string): this;
    /**
     * Set dispatcher count
     */
    dispatchers(count: number): this;
    /**
     * Enable/disable daemon mode
     */
    daemon(enabled: boolean): this;
    /**
     * Enable/disable caching
     */
    caching(enabled: boolean): this;
    /**
     * Set maximum cache size
     */
    maxCache(size: number): this;
    /**
     * Set maximum queue size
     */
    maxQueue(size: number): this;
    /**
     * Set latency target (for warnings)
     */
    latencyTarget(ms: number): this;
    /**
     * Set exception handler
     */
    onException(handler: ExceptionHandler): this;
    /**
     * Build the configuration
     */
    build(): EventBusConfiguration;
}
/**
 * Create a configuration builder
 */
export declare function configBuilder(): EventBusConfigurationBuilder;
/**
 * Predefined configuration profiles
 * Equivalent to common LWJEB use cases
 */
export declare const ConfigProfiles: {
    /**
     * High performance configuration
     * Optimized for sub-10ms latency
     */
    highPerformance(): EventBusConfiguration;
    /**
     * Memory efficient configuration
     * Reduced cache/queue sizes
     */
    memoryEfficient(): EventBusConfiguration;
    /**
     * Debug configuration
     * Verbose logging, strict latency
     */
    debug(): EventBusConfiguration;
    /**
     * MCP optimized configuration
     * Balanced for MCP tool integration
     */
    mcpOptimized(): EventBusConfiguration;
};
/**
 * Load configuration from environment variables
 */
export declare function loadConfigFromEnv(): Partial<EventBusConfiguration>;
/**
 * Validate configuration
 */
export declare function validateConfiguration(config: EventBusConfiguration): string[];
/**
 * Merge configurations with validation
 */
export declare function mergeConfigurations(base: EventBusConfiguration, override: Partial<EventBusConfiguration>): EventBusConfiguration;
//# sourceMappingURL=config.d.ts.map