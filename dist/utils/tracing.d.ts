/**
 * tracing.ts - Distributed Tracing for SpecMem
 *
 * yo this adds OpenTelemetry-style tracing
 * track requests from start to finish across all components
 * correlate logs with traces fr fr
 *
 * Issue #43 fix - distributed tracing with OpenTelemetry
 */
/**
 * Span status
 */
export declare enum SpanStatus {
    UNSET = "UNSET",
    OK = "OK",
    ERROR = "ERROR"
}
/**
 * Span kind
 */
export declare enum SpanKind {
    INTERNAL = "INTERNAL",
    SERVER = "SERVER",
    CLIENT = "CLIENT",
    PRODUCER = "PRODUCER",
    CONSUMER = "CONSUMER"
}
/**
 * Span attributes (key-value pairs)
 */
export type SpanAttributes = Record<string, string | number | boolean>;
/**
 * Span event
 */
export interface SpanEvent {
    name: string;
    timestamp: number;
    attributes?: SpanAttributes;
}
/**
 * Span context for propagation
 */
export interface SpanContext {
    traceId: string;
    spanId: string;
    traceFlags: number;
}
/**
 * Span data
 */
export interface SpanData {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind: SpanKind;
    startTime: number;
    endTime?: number;
    status: SpanStatus;
    statusMessage?: string;
    attributes: SpanAttributes;
    events: SpanEvent[];
}
/**
 * Span - represents a single operation in a trace
 */
export declare class Span {
    private data;
    private ended;
    constructor(name: string, parentContext?: SpanContext, kind?: SpanKind, attributes?: SpanAttributes);
    /**
     * Get span context for propagation
     */
    getContext(): SpanContext;
    /**
     * Set span attribute
     */
    setAttribute(key: string, value: string | number | boolean): this;
    /**
     * Set multiple attributes
     */
    setAttributes(attributes: SpanAttributes): this;
    /**
     * Add an event to the span
     */
    addEvent(name: string, attributes?: SpanAttributes): this;
    /**
     * Set span status
     */
    setStatus(status: SpanStatus, message?: string): this;
    /**
     * Record an exception
     */
    recordException(error: Error): this;
    /**
     * End the span
     */
    end(): void;
    /**
     * Get span data
     */
    getData(): SpanData;
    /**
     * Get trace ID
     */
    getTraceId(): string;
    /**
     * Get span ID
     */
    getSpanId(): string;
    /**
     * Get duration in ms (or null if not ended)
     */
    getDuration(): number | null;
    private generateTraceId;
    private generateSpanId;
}
/**
 * Span exporter interface
 */
export interface SpanExporter {
    export(span: SpanData): void;
}
/**
 * Console span exporter - logs spans to console
 */
export declare class ConsoleSpanExporter implements SpanExporter {
    export(span: SpanData): void;
}
/**
 * In-memory span exporter - stores spans for querying
 */
export declare class InMemorySpanExporter implements SpanExporter {
    private spans;
    private maxSpans;
    constructor(maxSpans?: number);
    export(span: SpanData): void;
    getSpans(): SpanData[];
    getSpansByTraceId(traceId: string): SpanData[];
    clear(): void;
}
/**
 * Tracer - creates and manages spans
 */
declare class Tracer {
    private exporters;
    private activeSpans;
    private serviceName;
    constructor(serviceName?: string);
    /**
     * Start a new span
     */
    startSpan(name: string, options?: {
        kind?: SpanKind;
        attributes?: SpanAttributes;
        parent?: SpanContext | Span;
    }): Span;
    /**
     * Start a span and execute a function within it
     */
    trace<T>(name: string, fn: (span: Span) => Promise<T>, options?: {
        kind?: SpanKind;
        attributes?: SpanAttributes;
        parent?: SpanContext | Span;
    }): Promise<T>;
    /**
     * Start a span and execute a sync function within it
     */
    traceSync<T>(name: string, fn: (span: Span) => T, options?: {
        kind?: SpanKind;
        attributes?: SpanAttributes;
        parent?: SpanContext | Span;
    }): T;
    /**
     * Add an exporter
     */
    addExporter(exporter: SpanExporter): void;
    /**
     * Remove all exporters
     */
    clearExporters(): void;
    /**
     * Export a span to all registered exporters
     */
    exportSpan(span: SpanData): void;
    /**
     * Get active span count
     */
    getActiveSpanCount(): number;
    /**
     * Set service name
     */
    setServiceName(name: string): void;
}
/**
 * Get the global tracer
 */
export declare function getTracer(): Tracer;
/**
 * Reset the global tracer
 */
export declare function resetTracer(): void;
/**
 * Start a span
 */
export declare function startSpan(name: string, options?: {
    kind?: SpanKind;
    attributes?: SpanAttributes;
    parent?: SpanContext | Span;
}): Span;
/**
 * Trace an async function
 */
export declare function trace<T>(name: string, fn: (span: Span) => Promise<T>, options?: {
    kind?: SpanKind;
    attributes?: SpanAttributes;
    parent?: SpanContext | Span;
}): Promise<T>;
/**
 * Trace a sync function
 */
export declare function traceSync<T>(name: string, fn: (span: Span) => T, options?: {
    kind?: SpanKind;
    attributes?: SpanAttributes;
    parent?: SpanContext | Span;
}): T;
/**
 * Extract trace context from HTTP headers
 */
export declare function extractTraceContext(headers: Record<string, string | undefined>): SpanContext | undefined;
/**
 * Inject trace context into HTTP headers
 */
export declare function injectTraceContext(context: SpanContext, headers?: Record<string, string>): Record<string, string>;
export { Tracer };
//# sourceMappingURL=tracing.d.ts.map