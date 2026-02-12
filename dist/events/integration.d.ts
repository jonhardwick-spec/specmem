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
import { MessageHandler, DispatchResult } from './Publisher.js';
import { EventBusConfiguration } from './config.js';
import { MCPTool } from '../mcp/toolRegistry.js';
/**
 * Base event interface
 */
export interface BaseEvent {
    type: string;
    timestamp: number;
    source: string;
}
/**
 * Tool execution started event
 */
export interface ToolExecutionStartEvent extends BaseEvent {
    type: 'tool:execution:start';
    toolName: string;
    params: unknown;
}
/**
 * Tool execution completed event
 */
export interface ToolExecutionCompleteEvent extends BaseEvent {
    type: 'tool:execution:complete';
    toolName: string;
    params: unknown;
    result: unknown;
    durationMs: number;
    success: boolean;
    error?: Error;
}
/**
 * Memory stored event
 */
export interface MemoryStoredEvent extends BaseEvent {
    type: 'memory:stored';
    memoryId: string;
    content: string;
    tags: string[];
    importance: string;
}
/**
 * Memory retrieved event
 */
export interface MemoryRetrievedEvent extends BaseEvent {
    type: 'memory:retrieved';
    memoryIds: string[];
    query?: string;
    count: number;
}
/**
 * Memory deleted event
 */
export interface MemoryDeletedEvent extends BaseEvent {
    type: 'memory:deleted';
    memoryId: string;
}
/**
 * Cache event
 */
export interface CacheEvent extends BaseEvent {
    type: 'cache:hit' | 'cache:miss' | 'cache:invalidate';
    key?: string;
}
/**
 * Performance alert event
 */
export interface PerformanceAlertEvent extends BaseEvent {
    type: 'performance:alert';
    metric: string;
    value: number;
    threshold: number;
    severity: 'warning' | 'critical';
}
/**
 * System event
 */
export interface SystemEvent extends BaseEvent {
    type: 'system:startup' | 'system:shutdown' | 'system:error';
    message: string;
    details?: Record<string, unknown>;
}
/**
 * Union of all event types
 */
export type SpecMemEvent = ToolExecutionStartEvent | ToolExecutionCompleteEvent | MemoryStoredEvent | MemoryRetrievedEvent | MemoryDeletedEvent | CacheEvent | PerformanceAlertEvent | SystemEvent;
/**
 * MCP Event Bus - specialized publisher for SpecMem MCP events
 */
export declare class MCPEventBus {
    private publisher;
    private aggregator;
    constructor(config?: Partial<EventBusConfiguration>);
    /**
     * Publish an event
     */
    publish(event: SpecMemEvent): Promise<DispatchResult>;
    /**
     * Publish an event asynchronously
     */
    publishAsync(event: SpecMemEvent): void;
    /**
     * Subscribe to events by type
     */
    on<E extends SpecMemEvent>(eventType: E['type'], handler: MessageHandler<E>, options?: {
        priority?: number;
        once?: boolean;
        subscriberId?: string;
    }): void;
    /**
     * Subscribe once to an event type
     */
    once<E extends SpecMemEvent>(eventType: E['type'], handler: MessageHandler<E>): void;
    /**
     * Unsubscribe from event type
     */
    off(eventType: string, subscriberId?: string): void;
    /**
     * Get performance metrics
     */
    getMetrics(): import("./metrics.js").MetricStats;
    /**
     * Get formatted metrics string
     */
    getFormattedMetrics(): string;
    /**
     * Shutdown the event bus
     */
    shutdown(): Promise<void>;
}
/**
 * Wrap an MCP tool to emit events on execution
 */
export declare function wrapToolWithEvents<TInput, TOutput>(tool: MCPTool<TInput, TOutput>, eventBus: MCPEventBus): MCPTool<TInput, TOutput>;
/**
 * Create event helpers for memory operations
 */
export declare function createMemoryEventHelpers(eventBus: MCPEventBus): {
    /**
     * Emit memory stored event
     */
    onMemoryStored(memoryId: string, content: string, tags: string[], importance: string): void;
    /**
     * Emit memory retrieved event
     */
    onMemoryRetrieved(memoryIds: string[], query?: string): void;
    /**
     * Emit memory deleted event
     */
    onMemoryDeleted(memoryId: string): void;
    /**
     * Emit cache event
     */
    onCache(type: "hit" | "miss" | "invalidate", key?: string): void;
};
/**
 * Get the global MCP event bus instance
 */
export declare function getMCPEventBus(): MCPEventBus;
/**
 * Reset the global event bus (for testing)
 */
export declare function resetMCPEventBus(): Promise<void>;
/**
 * Quick publish to global bus
 */
export declare function publishEvent(event: SpecMemEvent): void;
/**
 * Quick subscribe to global bus
 */
export declare function subscribeToEvent<E extends SpecMemEvent>(eventType: E['type'], handler: MessageHandler<E>): void;
/**
 * Emit system startup event
 */
export declare function emitStartup(message: string, details?: Record<string, unknown>): void;
/**
 * Emit system shutdown event
 */
export declare function emitShutdown(message: string, details?: Record<string, unknown>): void;
/**
 * Emit system error event
 */
export declare function emitError(message: string, details?: Record<string, unknown>): void;
/**
 * Setup automatic performance monitoring
 */
export declare function setupPerformanceMonitoring(eventBus: MCPEventBus, options?: {
    latencyThresholdMs?: number;
    checkIntervalMs?: number;
    onAlert?: (alert: PerformanceAlertEvent) => void;
}): () => void;
//# sourceMappingURL=integration.d.ts.map