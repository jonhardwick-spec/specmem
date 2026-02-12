/**
 * integration.ts - MCP Tool Integration for Event Bus
 *
 * Provides seamless integration between the LWJEB-inspired event bus
 * and SpecMem's MCP tool ecosystem.
 *
 * Features:
 * - Tool execution events (before/after hooks)
 * - Memory operation events
 * - Performance monitoring integration
 * - Easy subscription patterns for MCP tools
 *
 * @author hardwicksoftwareservices
 */
import { createPublisher } from './Publisher.js';
import { ConfigProfiles } from './config.js';
import { getGlobalAggregator, formatMetricStats } from './metrics.js';
import { logger } from '../utils/logger.js';
// ============================================================================
// Event Bus Integration
// ============================================================================
/**
 * MCP Event Bus - specialized publisher for SpecMem MCP events
 */
export class MCPEventBus {
    publisher;
    aggregator;
    constructor(config) {
        // Use MCP-optimized profile as base
        const baseConfig = ConfigProfiles.mcpOptimized();
        this.publisher = createPublisher({ ...baseConfig, ...config });
        this.aggregator = getGlobalAggregator();
        this.aggregator.register(this.publisher.getMetrics());
        logger.info({ identifier: baseConfig.identifier }, 'MCP Event Bus initialized');
    }
    /**
     * Publish an event
     */
    async publish(event) {
        const result = this.publisher.post(event);
        return result.dispatch();
    }
    /**
     * Publish an event asynchronously
     */
    publishAsync(event) {
        const result = this.publisher.post(event);
        result.async();
    }
    /**
     * Subscribe to events by type
     */
    on(eventType, handler, options) {
        this.publisher.subscribe(eventType, handler, {
            ...options,
            filter: (event) => event.type === eventType
        });
    }
    /**
     * Subscribe once to an event type
     */
    once(eventType, handler) {
        this.on(eventType, handler, { once: true });
    }
    /**
     * Unsubscribe from event type
     */
    off(eventType, subscriberId) {
        this.publisher.unsubscribe(eventType, subscriberId);
    }
    /**
     * Get performance metrics
     */
    getMetrics() {
        return this.publisher.getMetrics().getStats();
    }
    /**
     * Get formatted metrics string
     */
    getFormattedMetrics() {
        return formatMetricStats(this.getMetrics());
    }
    /**
     * Shutdown the event bus
     */
    async shutdown() {
        this.aggregator.unregister(this.publisher.getMetrics().identifier);
        await this.publisher.shutdownGracefully();
    }
}
// ============================================================================
// Tool Wrapper for Event Integration
// ============================================================================
/**
 * Wrap an MCP tool to emit events on execution
 */
export function wrapToolWithEvents(tool, eventBus) {
    return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        async execute(params) {
            const startTime = performance.now();
            // Emit start event
            eventBus.publishAsync({
                type: 'tool:execution:start',
                timestamp: Date.now(),
                source: 'mcp-integration',
                toolName: tool.name,
                params
            });
            try {
                const result = await tool.execute(params);
                const durationMs = performance.now() - startTime;
                // Emit complete event
                eventBus.publishAsync({
                    type: 'tool:execution:complete',
                    timestamp: Date.now(),
                    source: 'mcp-integration',
                    toolName: tool.name,
                    params,
                    result,
                    durationMs,
                    success: true
                });
                // Check latency
                if (durationMs > 25) {
                    eventBus.publishAsync({
                        type: 'performance:alert',
                        timestamp: Date.now(),
                        source: 'mcp-integration',
                        metric: 'toolExecutionLatency',
                        value: durationMs,
                        threshold: 25,
                        severity: durationMs > 100 ? 'critical' : 'warning'
                    });
                }
                return result;
            }
            catch (error) {
                const durationMs = performance.now() - startTime;
                // Emit error event
                eventBus.publishAsync({
                    type: 'tool:execution:complete',
                    timestamp: Date.now(),
                    source: 'mcp-integration',
                    toolName: tool.name,
                    params,
                    result: null,
                    durationMs,
                    success: false,
                    error: error instanceof Error ? error : new Error(String(error))
                });
                throw error;
            }
        }
    };
}
/**
 * Create event helpers for memory operations
 */
export function createMemoryEventHelpers(eventBus) {
    return {
        /**
         * Emit memory stored event
         */
        onMemoryStored(memoryId, content, tags, importance) {
            eventBus.publishAsync({
                type: 'memory:stored',
                timestamp: Date.now(),
                source: 'memory-operations',
                memoryId,
                content,
                tags,
                importance
            });
        },
        /**
         * Emit memory retrieved event
         */
        onMemoryRetrieved(memoryIds, query) {
            eventBus.publishAsync({
                type: 'memory:retrieved',
                timestamp: Date.now(),
                source: 'memory-operations',
                memoryIds,
                query,
                count: memoryIds.length
            });
        },
        /**
         * Emit memory deleted event
         */
        onMemoryDeleted(memoryId) {
            eventBus.publishAsync({
                type: 'memory:deleted',
                timestamp: Date.now(),
                source: 'memory-operations',
                memoryId
            });
        },
        /**
         * Emit cache event
         */
        onCache(type, key) {
            eventBus.publishAsync({
                type: `cache:${type}`,
                timestamp: Date.now(),
                source: 'cache',
                key
            });
        }
    };
}
// ============================================================================
// Global Event Bus Singleton
// ============================================================================
let globalEventBus = null;
/**
 * Get the global MCP event bus instance
 */
export function getMCPEventBus() {
    if (!globalEventBus) {
        globalEventBus = new MCPEventBus();
    }
    return globalEventBus;
}
/**
 * Reset the global event bus (for testing)
 */
export async function resetMCPEventBus() {
    if (globalEventBus) {
        await globalEventBus.shutdown();
        globalEventBus = null;
    }
}
// ============================================================================
// Convenience Exports
// ============================================================================
/**
 * Quick publish to global bus
 */
export function publishEvent(event) {
    getMCPEventBus().publishAsync(event);
}
/**
 * Quick subscribe to global bus
 */
export function subscribeToEvent(eventType, handler) {
    getMCPEventBus().on(eventType, handler);
}
/**
 * Emit system startup event
 */
export function emitStartup(message, details) {
    publishEvent({
        type: 'system:startup',
        timestamp: Date.now(),
        source: 'system',
        message,
        details
    });
}
/**
 * Emit system shutdown event
 */
export function emitShutdown(message, details) {
    publishEvent({
        type: 'system:shutdown',
        timestamp: Date.now(),
        source: 'system',
        message,
        details
    });
}
/**
 * Emit system error event
 */
export function emitError(message, details) {
    publishEvent({
        type: 'system:error',
        timestamp: Date.now(),
        source: 'system',
        message,
        details
    });
}
// ============================================================================
// Performance Monitoring Integration
// ============================================================================
/**
 * Setup automatic performance monitoring
 */
export function setupPerformanceMonitoring(eventBus, options = {}) {
    const { latencyThresholdMs = 25, checkIntervalMs = 5000, onAlert } = options;
    // Subscribe to performance alerts
    if (onAlert) {
        eventBus.on('performance:alert', onAlert);
    }
    // Periodic health check
    const interval = setInterval(() => {
        const stats = eventBus.getMetrics();
        // Check publish latency
        if (stats.publishLatency.p95 > latencyThresholdMs) {
            const alert = {
                type: 'performance:alert',
                timestamp: Date.now(),
                source: 'performance-monitor',
                metric: 'publishLatencyP95',
                value: stats.publishLatency.p95,
                threshold: latencyThresholdMs,
                severity: stats.publishLatency.p95 > latencyThresholdMs * 2 ? 'critical' : 'warning'
            };
            eventBus.publishAsync(alert);
        }
        // Check dispatch latency
        if (stats.dispatchLatency.p95 > latencyThresholdMs) {
            const alert = {
                type: 'performance:alert',
                timestamp: Date.now(),
                source: 'performance-monitor',
                metric: 'dispatchLatencyP95',
                value: stats.dispatchLatency.p95,
                threshold: latencyThresholdMs,
                severity: stats.dispatchLatency.p95 > latencyThresholdMs * 2 ? 'critical' : 'warning'
            };
            eventBus.publishAsync(alert);
        }
        // Check error rate
        if (stats.errorRate > 0.01) { // >1% error rate
            const alert = {
                type: 'performance:alert',
                timestamp: Date.now(),
                source: 'performance-monitor',
                metric: 'errorRate',
                value: stats.errorRate * 100, // percentage
                threshold: 1, // 1%
                severity: stats.errorRate > 0.05 ? 'critical' : 'warning'
            };
            eventBus.publishAsync(alert);
        }
    }, checkIntervalMs);
    // Return cleanup function
    return () => {
        clearInterval(interval);
    };
}
//# sourceMappingURL=integration.js.map