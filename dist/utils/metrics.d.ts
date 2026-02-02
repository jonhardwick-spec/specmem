/**
 * metrics.ts - Prometheus Metrics Export for SpecMem
 *
 * yo this exposes metrics in Prometheus format
 * request counts, latencies, memory usage, all that good stuff
 * scrape it at /metrics and youre set fr fr
 *
 * Issue #27 fix - metrics export with Prometheus
 */
/**
 * Metric types
 */
export declare enum MetricType {
    COUNTER = "counter",
    GAUGE = "gauge",
    HISTOGRAM = "histogram",
    SUMMARY = "summary"
}
/**
 * Base metric configuration
 */
interface MetricConfig {
    name: string;
    help: string;
    labelNames?: string[];
}
/**
 * Histogram bucket configuration
 */
interface HistogramConfig extends MetricConfig {
    buckets?: number[];
}
/**
 * Counter metric
 */
declare class Counter {
    private values;
    readonly name: string;
    readonly help: string;
    readonly labelNames: string[];
    constructor(config: MetricConfig);
    inc(labels?: Record<string, string>, value?: number): void;
    reset(): void;
    collect(): string;
    private labelKey;
}
/**
 * Gauge metric
 */
declare class Gauge {
    private values;
    readonly name: string;
    readonly help: string;
    readonly labelNames: string[];
    constructor(config: MetricConfig);
    set(labels: Record<string, string>, value: number): void;
    set(value: number): void;
    inc(labels?: Record<string, string>, value?: number): void;
    dec(labels?: Record<string, string>, value?: number): void;
    reset(): void;
    collect(): string;
    private labelKey;
}
/**
 * Histogram metric
 */
declare class Histogram {
    private buckets;
    private counts;
    private sums;
    private totalCounts;
    readonly name: string;
    readonly help: string;
    readonly labelNames: string[];
    constructor(config: HistogramConfig);
    observe(labels: Record<string, string>, value: number): void;
    observe(value: number): void;
    /**
     * Timer helper for measuring durations
     */
    startTimer(labels?: Record<string, string>): () => void;
    reset(): void;
    collect(): string;
    private labelKey;
}
/**
 * MetricsRegistry - manages all metrics
 */
declare class MetricsRegistry {
    private counters;
    private gauges;
    private histograms;
    private collectCallbacks;
    /**
     * Create and register a counter
     */
    counter(config: MetricConfig): Counter;
    /**
     * Create and register a gauge
     */
    gauge(config: MetricConfig): Gauge;
    /**
     * Create and register a histogram
     */
    histogram(config: HistogramConfig): Histogram;
    /**
     * Register a callback to collect metrics on demand
     */
    registerCollectCallback(callback: () => void): void;
    /**
     * Collect all metrics in Prometheus format
     */
    collect(): string;
    /**
     * Reset all metrics
     */
    reset(): void;
    /**
     * Clear the registry
     */
    clear(): void;
}
/**
 * Get the global metrics registry
 */
export declare function getMetricsRegistry(): MetricsRegistry;
/**
 * Reset the global registry
 */
export declare function resetMetricsRegistry(): void;
/**
 * Get HTTP request counter
 */
export declare function getHttpRequestCounter(): Counter;
/**
 * Get HTTP request duration histogram
 */
export declare function getHttpDurationHistogram(): Histogram;
/**
 * Get database query counter
 */
export declare function getDbQueryCounter(): Counter;
/**
 * Get database query duration histogram
 */
export declare function getDbDurationHistogram(): Histogram;
/**
 * Get MCP tool counter
 */
export declare function getMcpToolCounter(): Counter;
/**
 * Get error counter
 */
export declare function getErrorCounter(): Counter;
/**
 * Collect all metrics and return as Prometheus format string
 */
export declare function collectMetrics(): string;
export { Counter, Gauge, Histogram, MetricsRegistry };
//# sourceMappingURL=metrics.d.ts.map