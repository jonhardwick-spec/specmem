/**
 * metrics.ts - Performance Monitoring System
 *
 * Tracks event bus performance metrics to ensure sub-25ms dispatch latency
 * Inspired by LWJEB's focus on speed and performance optimization
 *
 * Key metrics tracked:
 * - Publish latency (p50, p95, p99)
 * - Cache hit/miss rates
 * - Handler execution times
 * - Queue depths
 * - Error rates
 *
 * @author hardwicksoftwareservices
 */
/**
 * Performance metrics interface
 */
export interface PerformanceMetrics {
    identifier: string;
    totalPublishes: number;
    totalSubscribes: number;
    totalUnsubscribes: number;
    totalDispatches: number;
    totalErrors: number;
    cacheHits: number;
    cacheMisses: number;
    cacheInvalidations: number;
    publishLatencies: number[];
    dispatchLatencies: number[];
    recordPublish(durationMs: number): void;
    recordDispatch(durationMs: number): void;
    recordCacheHit(): void;
    recordCacheMiss(): void;
    recordCacheInvalidation(): void;
    recordSubscribe(): void;
    recordUnsubscribe(): void;
    recordError(): void;
    getStats(): MetricStats;
    reset(): void;
}
/**
 * Aggregated metric statistics
 */
export interface MetricStats {
    identifier: string;
    uptime: number;
    publishRate: number;
    dispatchRate: number;
    publishLatency: LatencyPercentiles;
    dispatchLatency: LatencyPercentiles;
    cacheHitRate: number;
    cacheMissRate: number;
    errorRate: number;
    totals: {
        publishes: number;
        subscribes: number;
        unsubscribes: number;
        dispatches: number;
        errors: number;
        cacheHits: number;
        cacheMisses: number;
        cacheInvalidations: number;
    };
}
/**
 * Latency percentiles
 */
export interface LatencyPercentiles {
    min: number;
    max: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
}
/**
 * Create a new metrics instance
 */
export declare function createMetrics(identifier: string): PerformanceMetrics;
/**
 * Metrics aggregator for multiple publishers
 */
export declare class MetricsAggregator {
    private metrics;
    /**
     * Register a metrics instance
     */
    register(metrics: PerformanceMetrics): void;
    /**
     * Unregister a metrics instance
     */
    unregister(identifier: string): void;
    /**
     * Get aggregated stats across all instances
     */
    getAggregatedStats(): AggregatedMetricStats;
    /**
     * Check if any instance is exceeding latency targets
     */
    checkLatencyHealth(targetMs?: number): LatencyHealthReport;
    private averageLatencyPercentiles;
    private emptyAggregatedStats;
}
/**
 * Aggregated stats across multiple instances
 */
export interface AggregatedMetricStats {
    instanceCount: number;
    averageUptime: number;
    aggregatePublishRate: number;
    aggregateDispatchRate: number;
    averagePublishLatency: LatencyPercentiles;
    averageDispatchLatency: LatencyPercentiles;
    aggregateCacheHitRate: number;
    aggregateErrorRate: number;
    totals: {
        publishes: number;
        subscribes: number;
        unsubscribes: number;
        dispatches: number;
        errors: number;
        cacheHits: number;
        cacheMisses: number;
        cacheInvalidations: number;
    };
    byInstance: Record<string, MetricStats>;
}
/**
 * Latency health report
 */
export interface LatencyHealthReport {
    healthy: boolean;
    targetMs: number;
    violations: {
        identifier: string;
        p95: number;
        p99: number;
    }[];
}
export declare function getGlobalAggregator(): MetricsAggregator;
export declare function resetGlobalAggregator(): void;
/**
 * Format metrics for display
 */
export declare function formatMetricStats(stats: MetricStats): string;
//# sourceMappingURL=metrics.d.ts.map