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
// Publisher exports
export { EventPublisher, createPublisher, getGlobalPublisher, resetGlobalPublisher, DeadPublicationResult, StandardPublicationResult } from './Publisher.js';
// Configuration exports
export { defaultExceptionHandler, getDefaultConfiguration, EventBusConfigurationBuilder, configBuilder, ConfigProfiles, loadConfigFromEnv, validateConfiguration, mergeConfigurations } from './config.js';
// Metrics exports
export { createMetrics, MetricsAggregator, getGlobalAggregator, resetGlobalAggregator, formatMetricStats } from './metrics.js';
// Integration exports
export { 
// Event bus
MCPEventBus, getMCPEventBus, resetMCPEventBus, 
// Tool integration
wrapToolWithEvents, createMemoryEventHelpers, 
// Convenience functions
publishEvent, subscribeToEvent, emitStartup, emitShutdown, emitError, 
// Performance monitoring
setupPerformanceMonitoring } from './integration.js';
//# sourceMappingURL=index.js.map