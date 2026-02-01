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
import { logger } from '../utils/logger.js';
/**
 * Performance metrics implementation
 */
class PerformanceMetricsImpl {
    identifier;
    totalPublishes = 0;
    totalSubscribes = 0;
    totalUnsubscribes = 0;
    totalDispatches = 0;
    totalErrors = 0;
    cacheHits = 0;
    cacheMisses = 0;
    cacheInvalidations = 0;
    publishLatencies = [];
    dispatchLatencies = [];
    startTime;
    maxSamples;
    warningThresholdMs;
    constructor(identifier, maxSamples = 10000, warningThresholdMs = 25) {
        this.identifier = identifier;
        this.startTime = Date.now();
        this.maxSamples = maxSamples;
        this.warningThresholdMs = warningThresholdMs;
    }
    recordPublish(durationMs) {
        this.totalPublishes++;
        this.addLatencySample(this.publishLatencies, durationMs);
        // Warn if exceeding threshold
        if (durationMs > this.warningThresholdMs) {
            logger.warn({
                metric: 'publishLatency',
                duration: durationMs,
                threshold: this.warningThresholdMs
            }, 'publish latency exceeded threshold');
        }
    }
    recordDispatch(durationMs) {
        this.totalDispatches++;
        this.addLatencySample(this.dispatchLatencies, durationMs);
        // Warn if exceeding threshold
        if (durationMs > this.warningThresholdMs) {
            logger.warn({
                metric: 'dispatchLatency',
                duration: durationMs,
                threshold: this.warningThresholdMs
            }, 'dispatch latency exceeded threshold');
        }
    }
    recordCacheHit() {
        this.cacheHits++;
    }
    recordCacheMiss() {
        this.cacheMisses++;
    }
    recordCacheInvalidation() {
        this.cacheInvalidations++;
    }
    recordSubscribe() {
        this.totalSubscribes++;
    }
    recordUnsubscribe() {
        this.totalUnsubscribes++;
    }
    recordError() {
        this.totalErrors++;
    }
    addLatencySample(samples, value) {
        samples.push(value);
        // Keep only recent samples to bound memory
        if (samples.length > this.maxSamples) {
            samples.shift();
        }
    }
    getStats() {
        const uptime = (Date.now() - this.startTime) / 1000; // seconds
        return {
            identifier: this.identifier,
            uptime,
            publishRate: uptime > 0 ? this.totalPublishes / uptime : 0,
            dispatchRate: uptime > 0 ? this.totalDispatches / uptime : 0,
            publishLatency: this.calculatePercentiles(this.publishLatencies),
            dispatchLatency: this.calculatePercentiles(this.dispatchLatencies),
            cacheHitRate: this.calculateRate(this.cacheHits, this.cacheHits + this.cacheMisses),
            cacheMissRate: this.calculateRate(this.cacheMisses, this.cacheHits + this.cacheMisses),
            errorRate: this.calculateRate(this.totalErrors, this.totalDispatches),
            totals: {
                publishes: this.totalPublishes,
                subscribes: this.totalSubscribes,
                unsubscribes: this.totalUnsubscribes,
                dispatches: this.totalDispatches,
                errors: this.totalErrors,
                cacheHits: this.cacheHits,
                cacheMisses: this.cacheMisses,
                cacheInvalidations: this.cacheInvalidations
            }
        };
    }
    reset() {
        this.totalPublishes = 0;
        this.totalSubscribes = 0;
        this.totalUnsubscribes = 0;
        this.totalDispatches = 0;
        this.totalErrors = 0;
        this.cacheHits = 0;
        this.cacheMisses = 0;
        this.cacheInvalidations = 0;
        this.publishLatencies = [];
        this.dispatchLatencies = [];
        this.startTime = Date.now();
    }
    calculatePercentiles(samples) {
        if (samples.length === 0) {
            return {
                min: 0,
                max: 0,
                mean: 0,
                p50: 0,
                p95: 0,
                p99: 0
            };
        }
        const sorted = [...samples].sort((a, b) => a - b);
        const len = sorted.length;
        return {
            min: sorted[0] ?? 0,
            max: sorted[len - 1] ?? 0,
            mean: samples.reduce((a, b) => a + b, 0) / len,
            p50: this.percentile(sorted, 50),
            p95: this.percentile(sorted, 95),
            p99: this.percentile(sorted, 99)
        };
    }
    percentile(sorted, p) {
        if (sorted.length === 0)
            return 0;
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
    }
    calculateRate(numerator, denominator) {
        return denominator > 0 ? numerator / denominator : 0;
    }
}
/**
 * Create a new metrics instance
 */
export function createMetrics(identifier) {
    return new PerformanceMetricsImpl(identifier);
}
/**
 * Metrics aggregator for multiple publishers
 */
export class MetricsAggregator {
    metrics = new Map();
    /**
     * Register a metrics instance
     */
    register(metrics) {
        this.metrics.set(metrics.identifier, metrics);
    }
    /**
     * Unregister a metrics instance
     */
    unregister(identifier) {
        this.metrics.delete(identifier);
    }
    /**
     * Get aggregated stats across all instances
     */
    getAggregatedStats() {
        const allStats = Array.from(this.metrics.values()).map(m => m.getStats());
        if (allStats.length === 0) {
            return this.emptyAggregatedStats();
        }
        // Aggregate totals
        const totals = allStats.reduce((acc, stats) => ({
            publishes: acc.publishes + stats.totals.publishes,
            subscribes: acc.subscribes + stats.totals.subscribes,
            unsubscribes: acc.unsubscribes + stats.totals.unsubscribes,
            dispatches: acc.dispatches + stats.totals.dispatches,
            errors: acc.errors + stats.totals.errors,
            cacheHits: acc.cacheHits + stats.totals.cacheHits,
            cacheMisses: acc.cacheMisses + stats.totals.cacheMisses,
            cacheInvalidations: acc.cacheInvalidations + stats.totals.cacheInvalidations
        }), {
            publishes: 0,
            subscribes: 0,
            unsubscribes: 0,
            dispatches: 0,
            errors: 0,
            cacheHits: 0,
            cacheMisses: 0,
            cacheInvalidations: 0
        });
        // Calculate aggregate rates
        const totalCacheRequests = totals.cacheHits + totals.cacheMisses;
        return {
            instanceCount: allStats.length,
            averageUptime: allStats.reduce((sum, s) => sum + s.uptime, 0) / allStats.length,
            aggregatePublishRate: allStats.reduce((sum, s) => sum + s.publishRate, 0),
            aggregateDispatchRate: allStats.reduce((sum, s) => sum + s.dispatchRate, 0),
            averagePublishLatency: this.averageLatencyPercentiles(allStats.map(s => s.publishLatency)),
            averageDispatchLatency: this.averageLatencyPercentiles(allStats.map(s => s.dispatchLatency)),
            aggregateCacheHitRate: totalCacheRequests > 0 ? totals.cacheHits / totalCacheRequests : 0,
            aggregateErrorRate: totals.dispatches > 0 ? totals.errors / totals.dispatches : 0,
            totals,
            byInstance: Object.fromEntries(allStats.map(s => [s.identifier, s]))
        };
    }
    /**
     * Check if any instance is exceeding latency targets
     */
    checkLatencyHealth(targetMs = 25) {
        const violations = [];
        for (const metrics of this.metrics.values()) {
            const stats = metrics.getStats();
            if (stats.publishLatency.p95 > targetMs || stats.dispatchLatency.p95 > targetMs) {
                violations.push({
                    identifier: stats.identifier,
                    p95: Math.max(stats.publishLatency.p95, stats.dispatchLatency.p95),
                    p99: Math.max(stats.publishLatency.p99, stats.dispatchLatency.p99)
                });
            }
        }
        return {
            healthy: violations.length === 0,
            targetMs,
            violations
        };
    }
    averageLatencyPercentiles(all) {
        if (all.length === 0) {
            return { min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
        }
        return {
            min: Math.min(...all.map(p => p.min)),
            max: Math.max(...all.map(p => p.max)),
            mean: all.reduce((sum, p) => sum + p.mean, 0) / all.length,
            p50: all.reduce((sum, p) => sum + p.p50, 0) / all.length,
            p95: all.reduce((sum, p) => sum + p.p95, 0) / all.length,
            p99: all.reduce((sum, p) => sum + p.p99, 0) / all.length
        };
    }
    emptyAggregatedStats() {
        return {
            instanceCount: 0,
            averageUptime: 0,
            aggregatePublishRate: 0,
            aggregateDispatchRate: 0,
            averagePublishLatency: { min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 },
            averageDispatchLatency: { min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 },
            aggregateCacheHitRate: 0,
            aggregateErrorRate: 0,
            totals: {
                publishes: 0,
                subscribes: 0,
                unsubscribes: 0,
                dispatches: 0,
                errors: 0,
                cacheHits: 0,
                cacheMisses: 0,
                cacheInvalidations: 0
            },
            byInstance: {}
        };
    }
}
/**
 * Global metrics aggregator singleton
 */
let globalAggregator = null;
export function getGlobalAggregator() {
    if (!globalAggregator) {
        globalAggregator = new MetricsAggregator();
    }
    return globalAggregator;
}
export function resetGlobalAggregator() {
    globalAggregator = null;
}
/**
 * Format metrics for display
 */
export function formatMetricStats(stats) {
    const lines = [
        `=== Event Bus Metrics: ${stats.identifier} ===`,
        `Uptime: ${stats.uptime.toFixed(1)}s`,
        '',
        '-- Throughput --',
        `Publish Rate: ${stats.publishRate.toFixed(2)}/s`,
        `Dispatch Rate: ${stats.dispatchRate.toFixed(2)}/s`,
        '',
        '-- Publish Latency (ms) --',
        `  Min: ${stats.publishLatency.min.toFixed(2)}`,
        `  Mean: ${stats.publishLatency.mean.toFixed(2)}`,
        `  P50: ${stats.publishLatency.p50.toFixed(2)}`,
        `  P95: ${stats.publishLatency.p95.toFixed(2)}`,
        `  P99: ${stats.publishLatency.p99.toFixed(2)}`,
        `  Max: ${stats.publishLatency.max.toFixed(2)}`,
        '',
        '-- Dispatch Latency (ms) --',
        `  Min: ${stats.dispatchLatency.min.toFixed(2)}`,
        `  Mean: ${stats.dispatchLatency.mean.toFixed(2)}`,
        `  P50: ${stats.dispatchLatency.p50.toFixed(2)}`,
        `  P95: ${stats.dispatchLatency.p95.toFixed(2)}`,
        `  P99: ${stats.dispatchLatency.p99.toFixed(2)}`,
        `  Max: ${stats.dispatchLatency.max.toFixed(2)}`,
        '',
        '-- Cache Performance --',
        `Hit Rate: ${(stats.cacheHitRate * 100).toFixed(1)}%`,
        `Miss Rate: ${(stats.cacheMissRate * 100).toFixed(1)}%`,
        '',
        '-- Error Rate --',
        `${(stats.errorRate * 100).toFixed(2)}%`,
        '',
        '-- Totals --',
        `Publishes: ${stats.totals.publishes}`,
        `Dispatches: ${stats.totals.dispatches}`,
        `Subscribes: ${stats.totals.subscribes}`,
        `Unsubscribes: ${stats.totals.unsubscribes}`,
        `Errors: ${stats.totals.errors}`,
        `Cache Hits: ${stats.totals.cacheHits}`,
        `Cache Misses: ${stats.totals.cacheMisses}`,
        `Cache Invalidations: ${stats.totals.cacheInvalidations}`
    ];
    return lines.join('\n');
}
//# sourceMappingURL=metrics.js.map