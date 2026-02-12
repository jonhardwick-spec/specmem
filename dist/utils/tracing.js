/**
 * tracing.ts - Distributed Tracing for SpecMem
 *
 * yo this adds OpenTelemetry-style tracing
 * track requests from start to finish across all components
 * correlate logs with traces fr fr
 *
 * Issue #43 fix - distributed tracing with OpenTelemetry
 */
import { logger } from './logger.js';
import crypto from 'crypto';
/**
 * Span status
 */
export var SpanStatus;
(function (SpanStatus) {
    SpanStatus["UNSET"] = "UNSET";
    SpanStatus["OK"] = "OK";
    SpanStatus["ERROR"] = "ERROR";
})(SpanStatus || (SpanStatus = {}));
/**
 * Span kind
 */
export var SpanKind;
(function (SpanKind) {
    SpanKind["INTERNAL"] = "INTERNAL";
    SpanKind["SERVER"] = "SERVER";
    SpanKind["CLIENT"] = "CLIENT";
    SpanKind["PRODUCER"] = "PRODUCER";
    SpanKind["CONSUMER"] = "CONSUMER";
})(SpanKind || (SpanKind = {}));
/**
 * Span - represents a single operation in a trace
 */
export class Span {
    data;
    ended = false;
    constructor(name, parentContext, kind = SpanKind.INTERNAL, attributes = {}) {
        this.data = {
            traceId: parentContext?.traceId || this.generateTraceId(),
            spanId: this.generateSpanId(),
            parentSpanId: parentContext?.spanId,
            name,
            kind,
            startTime: Date.now(),
            status: SpanStatus.UNSET,
            attributes: { ...attributes },
            events: []
        };
    }
    /**
     * Get span context for propagation
     */
    getContext() {
        return {
            traceId: this.data.traceId,
            spanId: this.data.spanId,
            traceFlags: 1 // sampled
        };
    }
    /**
     * Set span attribute
     */
    setAttribute(key, value) {
        if (!this.ended) {
            this.data.attributes[key] = value;
        }
        return this;
    }
    /**
     * Set multiple attributes
     */
    setAttributes(attributes) {
        if (!this.ended) {
            Object.assign(this.data.attributes, attributes);
        }
        return this;
    }
    /**
     * Add an event to the span
     */
    addEvent(name, attributes) {
        if (!this.ended) {
            this.data.events.push({
                name,
                timestamp: Date.now(),
                attributes
            });
        }
        return this;
    }
    /**
     * Set span status
     */
    setStatus(status, message) {
        if (!this.ended) {
            this.data.status = status;
            this.data.statusMessage = message;
        }
        return this;
    }
    /**
     * Record an exception
     */
    recordException(error) {
        if (!this.ended) {
            this.setStatus(SpanStatus.ERROR, error.message);
            this.addEvent('exception', {
                'exception.type': error.name,
                'exception.message': error.message,
                'exception.stacktrace': error.stack || ''
            });
        }
        return this;
    }
    /**
     * End the span
     */
    end() {
        if (this.ended)
            return;
        this.ended = true;
        this.data.endTime = Date.now();
        // Export the span
        getTracer().exportSpan(this.data);
    }
    /**
     * Get span data
     */
    getData() {
        return { ...this.data };
    }
    /**
     * Get trace ID
     */
    getTraceId() {
        return this.data.traceId;
    }
    /**
     * Get span ID
     */
    getSpanId() {
        return this.data.spanId;
    }
    /**
     * Get duration in ms (or null if not ended)
     */
    getDuration() {
        if (!this.data.endTime)
            return null;
        return this.data.endTime - this.data.startTime;
    }
    generateTraceId() {
        return crypto.randomBytes(16).toString('hex');
    }
    generateSpanId() {
        return crypto.randomBytes(8).toString('hex');
    }
}
/**
 * Console span exporter - logs spans to console
 */
export class ConsoleSpanExporter {
    export(span) {
        const duration = span.endTime ? span.endTime - span.startTime : 0;
        logger.debug({
            traceId: span.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            name: span.name,
            kind: span.kind,
            status: span.status,
            durationMs: duration,
            attributes: span.attributes,
            events: span.events.length > 0 ? span.events : undefined
        }, `span: ${span.name}`);
    }
}
/**
 * In-memory span exporter - stores spans for querying
 */
export class InMemorySpanExporter {
    spans = [];
    maxSpans;
    constructor(maxSpans = 1000) {
        this.maxSpans = maxSpans;
    }
    export(span) {
        this.spans.push(span);
        if (this.spans.length > this.maxSpans) {
            this.spans = this.spans.slice(-this.maxSpans);
        }
    }
    getSpans() {
        return [...this.spans];
    }
    getSpansByTraceId(traceId) {
        return this.spans.filter(s => s.traceId === traceId);
    }
    clear() {
        this.spans = [];
    }
}
/**
 * Tracer - creates and manages spans
 */
class Tracer {
    exporters = [];
    activeSpans = new Map();
    serviceName;
    constructor(serviceName = 'specmem') {
        this.serviceName = serviceName;
        // Default to console exporter
        this.exporters.push(new ConsoleSpanExporter());
    }
    /**
     * Start a new span
     */
    startSpan(name, options = {}) {
        let parentContext;
        if (options.parent) {
            parentContext = options.parent instanceof Span
                ? options.parent.getContext()
                : options.parent;
        }
        const span = new Span(name, parentContext, options.kind, {
            'service.name': this.serviceName,
            ...options.attributes
        });
        this.activeSpans.set(span.getSpanId(), span);
        return span;
    }
    /**
     * Start a span and execute a function within it
     */
    async trace(name, fn, options = {}) {
        const span = this.startSpan(name, options);
        try {
            const result = await fn(span);
            span.setStatus(SpanStatus.OK);
            return result;
        }
        catch (error) {
            span.recordException(error);
            throw error;
        }
        finally {
            span.end();
            this.activeSpans.delete(span.getSpanId());
        }
    }
    /**
     * Start a span and execute a sync function within it
     */
    traceSync(name, fn, options = {}) {
        const span = this.startSpan(name, options);
        try {
            const result = fn(span);
            span.setStatus(SpanStatus.OK);
            return result;
        }
        catch (error) {
            span.recordException(error);
            throw error;
        }
        finally {
            span.end();
            this.activeSpans.delete(span.getSpanId());
        }
    }
    /**
     * Add an exporter
     */
    addExporter(exporter) {
        this.exporters.push(exporter);
    }
    /**
     * Remove all exporters
     */
    clearExporters() {
        this.exporters = [];
    }
    /**
     * Export a span to all registered exporters
     */
    exportSpan(span) {
        for (const exporter of this.exporters) {
            try {
                exporter.export(span);
            }
            catch (error) {
                logger.warn({ error, exporter: exporter.constructor.name }, 'span export failed');
            }
        }
    }
    /**
     * Get active span count
     */
    getActiveSpanCount() {
        return this.activeSpans.size;
    }
    /**
     * Set service name
     */
    setServiceName(name) {
        this.serviceName = name;
    }
}
// Singleton tracer
let tracerInstance = null;
/**
 * Get the global tracer
 */
export function getTracer() {
    if (!tracerInstance) {
        tracerInstance = new Tracer();
    }
    return tracerInstance;
}
/**
 * Reset the global tracer
 */
export function resetTracer() {
    tracerInstance = null;
}
// ============================================================================
// Convenience functions
// ============================================================================
/**
 * Start a span
 */
export function startSpan(name, options) {
    return getTracer().startSpan(name, options);
}
/**
 * Trace an async function
 */
export async function trace(name, fn, options) {
    return getTracer().trace(name, fn, options);
}
/**
 * Trace a sync function
 */
export function traceSync(name, fn, options) {
    return getTracer().traceSync(name, fn, options);
}
/**
 * Extract trace context from HTTP headers
 */
export function extractTraceContext(headers) {
    // Support W3C Trace Context format
    const traceparent = headers['traceparent'] || headers['Traceparent'];
    if (!traceparent)
        return undefined;
    // Format: version-traceId-spanId-traceFlags
    // Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
    const parts = traceparent.split('-');
    if (parts.length !== 4)
        return undefined;
    const [, traceId, spanId, flags] = parts;
    if (!traceId || !spanId || !flags)
        return undefined;
    return {
        traceId,
        spanId,
        traceFlags: parseInt(flags, 16)
    };
}
/**
 * Inject trace context into HTTP headers
 */
export function injectTraceContext(context, headers = {}) {
    const traceparent = `00-${context.traceId}-${context.spanId}-${context.traceFlags.toString(16).padStart(2, '0')}`;
    headers['traceparent'] = traceparent;
    return headers;
}
export { Tracer };
//# sourceMappingURL=tracing.js.map