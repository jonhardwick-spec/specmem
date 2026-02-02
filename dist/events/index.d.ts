/**
 * events/index.ts - LWJEB-inspired Event Bus System
 *
 * TypeScript adaptation of Hippo's LWJEB (https://github.com/Hippo/LWJEB)
 * Optimized for SpecMem MCP with sub-25ms dispatch latency target.
 *
 * Key Features:
 * - PubSub pattern with result caching
 * - Async dispatcher queues
 * - Performance metrics tracking
 * - MCP tool integration
 *
 * @author hardwicksoftwareservices
 */
export { EventPublisher, createPublisher, getGlobalPublisher, resetGlobalPublisher, MessageHandler, RegisteredHandler, PublicationResult, DispatchResult, DeadPublicationResult, StandardPublicationResult } from './Publisher.js';
export { EventBusConfiguration, ExceptionHandler, defaultExceptionHandler, getDefaultConfiguration, EventBusConfigurationBuilder, configBuilder, ConfigProfiles, loadConfigFromEnv, validateConfiguration, mergeConfigurations } from './config.js';
export { PerformanceMetrics, MetricStats, LatencyPercentiles, createMetrics, MetricsAggregator, AggregatedMetricStats, LatencyHealthReport, getGlobalAggregator, resetGlobalAggregator, formatMetricStats } from './metrics.js';
export { BaseEvent, ToolExecutionStartEvent, ToolExecutionCompleteEvent, MemoryStoredEvent, MemoryRetrievedEvent, MemoryDeletedEvent, CacheEvent, PerformanceAlertEvent, SystemEvent, SpecMemEvent, MCPEventBus, getMCPEventBus, resetMCPEventBus, wrapToolWithEvents, createMemoryEventHelpers, publishEvent, subscribeToEvent, emitStartup, emitShutdown, emitError, setupPerformanceMonitoring } from './integration.js';
//# sourceMappingURL=index.d.ts.map