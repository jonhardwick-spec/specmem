/**
 * metrics.ts - Prometheus Metrics Export for SpecMem
 *
 * yo this exposes metrics in Prometheus format
 * request counts, latencies, memory usage, all that good stuff
 * scrape it at /metrics and youre set fr fr
 *
 * Issue #27 fix - metrics export with Prometheus
 */
import { logger } from './logger.js';
/**
 * Metric types
 */
export var MetricType;
(function (MetricType) {
    MetricType["COUNTER"] = "counter";
    MetricType["GAUGE"] = "gauge";
    MetricType["HISTOGRAM"] = "histogram";
    MetricType["SUMMARY"] = "summary";
})(MetricType || (MetricType = {}));
/**
 * Counter metric
 */
class Counter {
    values = new Map();
    name;
    help;
    labelNames;
    constructor(config) {
        this.name = config.name;
        this.help = config.help;
        this.labelNames = config.labelNames || [];
    }
    inc(labels = {}, value = 1) {
        const key = this.labelKey(labels);
        this.values.set(key, (this.values.get(key) || 0) + value);
    }
    reset() {
        this.values.clear();
    }
    collect() {
        const lines = [
            `# HELP ${this.name} ${this.help}`,
            `# TYPE ${this.name} counter`
        ];
        for (const [key, value] of this.values) {
            const labelStr = key ? `{${key}}` : '';
            lines.push(`${this.name}${labelStr} ${value}`);
        }
        return lines.join('\n');
    }
    labelKey(labels) {
        if (this.labelNames.length === 0)
            return '';
        return this.labelNames
            .map(name => `${name}="${labels[name] || ''}"`)
            .join(',');
    }
}
/**
 * Gauge metric
 */
class Gauge {
    values = new Map();
    name;
    help;
    labelNames;
    constructor(config) {
        this.name = config.name;
        this.help = config.help;
        this.labelNames = config.labelNames || [];
    }
    set(labelsOrValue, maybeValue) {
        if (typeof labelsOrValue === 'number') {
            this.values.set('', labelsOrValue);
        }
        else {
            const key = this.labelKey(labelsOrValue);
            this.values.set(key, maybeValue);
        }
    }
    inc(labels = {}, value = 1) {
        const key = this.labelKey(labels);
        this.values.set(key, (this.values.get(key) || 0) + value);
    }
    dec(labels = {}, value = 1) {
        const key = this.labelKey(labels);
        this.values.set(key, (this.values.get(key) || 0) - value);
    }
    reset() {
        this.values.clear();
    }
    collect() {
        const lines = [
            `# HELP ${this.name} ${this.help}`,
            `# TYPE ${this.name} gauge`
        ];
        for (const [key, value] of this.values) {
            const labelStr = key ? `{${key}}` : '';
            lines.push(`${this.name}${labelStr} ${value}`);
        }
        return lines.join('\n');
    }
    labelKey(labels) {
        if (this.labelNames.length === 0)
            return '';
        return this.labelNames
            .map(name => `${name}="${labels[name] || ''}"`)
            .join(',');
    }
}
/**
 * Histogram metric
 */
class Histogram {
    buckets;
    counts = new Map();
    sums = new Map();
    totalCounts = new Map();
    name;
    help;
    labelNames;
    constructor(config) {
        this.name = config.name;
        this.help = config.help;
        this.labelNames = config.labelNames || [];
        // Default buckets for latency in seconds
        this.buckets = config.buckets || [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
    }
    observe(labelsOrValue, maybeValue) {
        let labels = {};
        let value;
        if (typeof labelsOrValue === 'number') {
            value = labelsOrValue;
        }
        else {
            labels = labelsOrValue;
            value = maybeValue;
        }
        const key = this.labelKey(labels);
        // Initialize bucket counts if needed
        if (!this.counts.has(key)) {
            this.counts.set(key, new Map(this.buckets.map(b => [b, 0])));
        }
        // Update bucket counts
        const bucketCounts = this.counts.get(key);
        for (const bucket of this.buckets) {
            if (value <= bucket) {
                bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
            }
        }
        // Update sum and count
        this.sums.set(key, (this.sums.get(key) || 0) + value);
        this.totalCounts.set(key, (this.totalCounts.get(key) || 0) + 1);
    }
    /**
     * Timer helper for measuring durations
     */
    startTimer(labels = {}) {
        const start = process.hrtime.bigint();
        return () => {
            const end = process.hrtime.bigint();
            const durationSeconds = Number(end - start) / 1e9;
            this.observe(labels, durationSeconds);
        };
    }
    reset() {
        this.counts.clear();
        this.sums.clear();
        this.totalCounts.clear();
    }
    collect() {
        const lines = [
            `# HELP ${this.name} ${this.help}`,
            `# TYPE ${this.name} histogram`
        ];
        for (const [key, bucketCounts] of this.counts) {
            const labelPrefix = key ? `${key},` : '';
            let cumulative = 0;
            for (const bucket of this.buckets) {
                cumulative += bucketCounts.get(bucket) || 0;
                const le = bucket === Infinity ? '+Inf' : bucket.toString();
                lines.push(`${this.name}_bucket{${labelPrefix}le="${le}"} ${cumulative}`);
            }
            // +Inf bucket (total count)
            lines.push(`${this.name}_bucket{${labelPrefix}le="+Inf"} ${this.totalCounts.get(key) || 0}`);
            lines.push(`${this.name}_sum{${key || ''}} ${this.sums.get(key) || 0}`);
            lines.push(`${this.name}_count{${key || ''}} ${this.totalCounts.get(key) || 0}`);
        }
        return lines.join('\n');
    }
    labelKey(labels) {
        if (this.labelNames.length === 0)
            return '';
        return this.labelNames
            .map(name => `${name}="${labels[name] || ''}"`)
            .join(',');
    }
}
/**
 * MetricsRegistry - manages all metrics
 */
class MetricsRegistry {
    counters = new Map();
    gauges = new Map();
    histograms = new Map();
    collectCallbacks = [];
    /**
     * Create and register a counter
     */
    counter(config) {
        if (this.counters.has(config.name)) {
            return this.counters.get(config.name);
        }
        const counter = new Counter(config);
        this.counters.set(config.name, counter);
        return counter;
    }
    /**
     * Create and register a gauge
     */
    gauge(config) {
        if (this.gauges.has(config.name)) {
            return this.gauges.get(config.name);
        }
        const gauge = new Gauge(config);
        this.gauges.set(config.name, gauge);
        return gauge;
    }
    /**
     * Create and register a histogram
     */
    histogram(config) {
        if (this.histograms.has(config.name)) {
            return this.histograms.get(config.name);
        }
        const histogram = new Histogram(config);
        this.histograms.set(config.name, histogram);
        return histogram;
    }
    /**
     * Register a callback to collect metrics on demand
     */
    registerCollectCallback(callback) {
        this.collectCallbacks.push(callback);
    }
    /**
     * Collect all metrics in Prometheus format
     */
    collect() {
        // Run collect callbacks first
        for (const callback of this.collectCallbacks) {
            try {
                callback();
            }
            catch (error) {
                logger.warn({ error }, 'metric collect callback failed');
            }
        }
        const sections = [];
        // Collect counters
        for (const counter of this.counters.values()) {
            sections.push(counter.collect());
        }
        // Collect gauges
        for (const gauge of this.gauges.values()) {
            sections.push(gauge.collect());
        }
        // Collect histograms
        for (const histogram of this.histograms.values()) {
            sections.push(histogram.collect());
        }
        return sections.join('\n\n') + '\n';
    }
    /**
     * Reset all metrics
     */
    reset() {
        for (const counter of this.counters.values()) {
            counter.reset();
        }
        for (const gauge of this.gauges.values()) {
            gauge.reset();
        }
        for (const histogram of this.histograms.values()) {
            histogram.reset();
        }
    }
    /**
     * Clear the registry
     */
    clear() {
        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
        this.collectCallbacks = [];
    }
}
// Singleton registry
let registryInstance = null;
/**
 * Get the global metrics registry
 */
export function getMetricsRegistry() {
    if (!registryInstance) {
        registryInstance = new MetricsRegistry();
        initializeDefaultMetrics();
    }
    return registryInstance;
}
/**
 * Reset the global registry
 */
export function resetMetricsRegistry() {
    if (registryInstance) {
        registryInstance.clear();
    }
    registryInstance = null;
}
// ============================================================================
// Default SpecMem Metrics
// ============================================================================
/**
 * Initialize default metrics for SpecMem
 */
function initializeDefaultMetrics() {
    const registry = registryInstance;
    // HTTP request metrics
    registry.counter({
        name: 'specmem_http_requests_total',
        help: 'Total number of HTTP requests',
        labelNames: ['method', 'path', 'status']
    });
    registry.histogram({
        name: 'specmem_http_request_duration_seconds',
        help: 'HTTP request latency in seconds',
        labelNames: ['method', 'path'],
        buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
    });
    // Database metrics
    registry.counter({
        name: 'specmem_db_queries_total',
        help: 'Total number of database queries',
        labelNames: ['operation', 'status']
    });
    registry.histogram({
        name: 'specmem_db_query_duration_seconds',
        help: 'Database query latency in seconds',
        labelNames: ['operation'],
        buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
    });
    registry.gauge({
        name: 'specmem_db_pool_total_connections',
        help: 'Total connections in database pool'
    });
    registry.gauge({
        name: 'specmem_db_pool_idle_connections',
        help: 'Idle connections in database pool'
    });
    registry.gauge({
        name: 'specmem_db_pool_waiting_requests',
        help: 'Requests waiting for database connection'
    });
    // Memory metrics
    registry.gauge({
        name: 'specmem_memory_heap_used_bytes',
        help: 'Heap memory used in bytes'
    });
    registry.gauge({
        name: 'specmem_memory_heap_total_bytes',
        help: 'Total heap memory in bytes'
    });
    registry.gauge({
        name: 'specmem_memory_rss_bytes',
        help: 'Resident set size in bytes'
    });
    registry.gauge({
        name: 'specmem_memory_external_bytes',
        help: 'External memory in bytes'
    });
    registry.gauge({
        name: 'specmem_memory_pressure_level',
        help: 'Memory pressure level (0=normal, 1=warning, 2=critical, 3=emergency)',
        labelNames: ['level']
    });
    // Embedding cache metrics
    registry.gauge({
        name: 'specmem_embedding_cache_size',
        help: 'Number of entries in embedding cache'
    });
    registry.counter({
        name: 'specmem_embedding_cache_hits_total',
        help: 'Total embedding cache hits'
    });
    registry.counter({
        name: 'specmem_embedding_cache_misses_total',
        help: 'Total embedding cache misses'
    });
    // MCP tool metrics
    registry.counter({
        name: 'specmem_mcp_tool_calls_total',
        help: 'Total MCP tool calls',
        labelNames: ['tool', 'status']
    });
    registry.histogram({
        name: 'specmem_mcp_tool_duration_seconds',
        help: 'MCP tool call duration in seconds',
        labelNames: ['tool'],
        buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]
    });
    // Memory count metrics
    registry.gauge({
        name: 'specmem_memories_total',
        help: 'Total number of memories in database'
    });
    registry.gauge({
        name: 'specmem_memories_with_embeddings',
        help: 'Number of memories with embeddings'
    });
    // File indexer metrics
    registry.gauge({
        name: 'specmem_codebase_files_total',
        help: 'Total files in codebase index'
    });
    registry.gauge({
        name: 'specmem_codebase_lines_total',
        help: 'Total lines of code indexed'
    });
    // Error metrics
    registry.counter({
        name: 'specmem_errors_total',
        help: 'Total errors',
        labelNames: ['type', 'severity']
    });
    // Circuit breaker metrics
    registry.gauge({
        name: 'specmem_circuit_breaker_state',
        help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
        labelNames: ['name']
    });
    registry.counter({
        name: 'specmem_circuit_breaker_trips_total',
        help: 'Total circuit breaker trips',
        labelNames: ['name']
    });
    // WebSocket metrics
    registry.gauge({
        name: 'specmem_websocket_connections',
        help: 'Current WebSocket connections'
    });
    registry.counter({
        name: 'specmem_websocket_messages_total',
        help: 'Total WebSocket messages',
        labelNames: ['direction', 'type']
    });
    // Register process metrics collection
    registry.registerCollectCallback(collectProcessMetrics);
}
/**
 * Collect Node.js process metrics
 */
function collectProcessMetrics() {
    const registry = registryInstance;
    if (!registry)
        return;
    const mem = process.memoryUsage();
    const heapUsed = registry.gauge({
        name: 'specmem_memory_heap_used_bytes',
        help: 'Heap memory used in bytes'
    });
    heapUsed.set(mem.heapUsed);
    const heapTotal = registry.gauge({
        name: 'specmem_memory_heap_total_bytes',
        help: 'Total heap memory in bytes'
    });
    heapTotal.set(mem.heapTotal);
    const rss = registry.gauge({
        name: 'specmem_memory_rss_bytes',
        help: 'Resident set size in bytes'
    });
    rss.set(mem.rss);
    const external = registry.gauge({
        name: 'specmem_memory_external_bytes',
        help: 'External memory in bytes'
    });
    external.set(mem.external);
}
// ============================================================================
// Convenience functions
// ============================================================================
/**
 * Get HTTP request counter
 */
export function getHttpRequestCounter() {
    return getMetricsRegistry().counter({
        name: 'specmem_http_requests_total',
        help: 'Total number of HTTP requests',
        labelNames: ['method', 'path', 'status']
    });
}
/**
 * Get HTTP request duration histogram
 */
export function getHttpDurationHistogram() {
    return getMetricsRegistry().histogram({
        name: 'specmem_http_request_duration_seconds',
        help: 'HTTP request latency in seconds',
        labelNames: ['method', 'path']
    });
}
/**
 * Get database query counter
 */
export function getDbQueryCounter() {
    return getMetricsRegistry().counter({
        name: 'specmem_db_queries_total',
        help: 'Total number of database queries',
        labelNames: ['operation', 'status']
    });
}
/**
 * Get database query duration histogram
 */
export function getDbDurationHistogram() {
    return getMetricsRegistry().histogram({
        name: 'specmem_db_query_duration_seconds',
        help: 'Database query latency in seconds',
        labelNames: ['operation']
    });
}
/**
 * Get MCP tool counter
 */
export function getMcpToolCounter() {
    return getMetricsRegistry().counter({
        name: 'specmem_mcp_tool_calls_total',
        help: 'Total MCP tool calls',
        labelNames: ['tool', 'status']
    });
}
/**
 * Get error counter
 */
export function getErrorCounter() {
    return getMetricsRegistry().counter({
        name: 'specmem_errors_total',
        help: 'Total errors',
        labelNames: ['type', 'severity']
    });
}
/**
 * Collect all metrics and return as Prometheus format string
 */
export function collectMetrics() {
    return getMetricsRegistry().collect();
}
export { Counter, Gauge, Histogram, MetricsRegistry };
//# sourceMappingURL=metrics.js.map