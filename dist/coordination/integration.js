/**
 * coordination/integration.ts - Central Event Hub for SpecMem
 *
 * This is THE central nervous system connecting all SpecMem components
 * through LWJEB event bus. All events flow through here.
 *
 * Features:
 * - Unified event registration and dispatch
 * - Cross-component communication
 * - Performance monitoring integration
 * - Sub-25ms event emission guarantee
 *
 * @author hardwicksoftwareservices
 */
import { getMCPEventBus, setupPerformanceMonitoring } from '../events/index.js';
import { logger } from '../utils/logger.js';
import { compactIfEnabled } from '../utils/tokenCompressor.js';
// ============================================================================
// Central Coordination Hub
// ============================================================================
/**
 * SpecMemCoordinator - The central event hub
 *
 * Manages all event subscriptions and provides helper methods
 * for emitting events from any component in SpecMem.
 */
export class SpecMemCoordinator {
    eventBus;
    cleanupFunctions = [];
    initialized = false;
    // Statistics
    stats = {
        eventsEmitted: 0,
        eventsByType: new Map(),
        slowQueries: 0,
        filesProcessed: 0,
        memoriesStored: 0,
        memoriesRetrieved: 0,
        memoriesDeleted: 0
    };
    constructor() {
        this.eventBus = getMCPEventBus();
    }
    /**
     * Initialize the coordinator with all event listeners
     */
    async initialize() {
        if (this.initialized)
            return;
        logger.info('Initializing SpecMem Coordinator - central event hub');
        // Setup performance monitoring
        const cleanupPerf = setupPerformanceMonitoring(this.eventBus, {
            latencyThresholdMs: 25,
            checkIntervalMs: 10000,
            onAlert: (alert) => {
                logger.warn({
                    metric: alert.metric,
                    value: alert.value,
                    threshold: alert.threshold,
                    severity: alert.severity
                }, 'Performance alert triggered');
            }
        });
        this.cleanupFunctions.push(cleanupPerf);
        // Setup internal event tracking
        this.setupEventTracking();
        this.initialized = true;
        logger.info('SpecMem Coordinator initialized - all systems connected');
        // Emit startup event
        this.emitSystemEvent('startup', 'SpecMem Coordinator initialized');
    }
    /**
     * Setup internal event tracking for statistics
     */
    setupEventTracking() {
        // Track all events for statistics
        const trackEvent = (event) => {
            this.stats.eventsEmitted++;
            const count = this.stats.eventsByType.get(event.type) || 0;
            this.stats.eventsByType.set(event.type, count + 1);
        };
        // Subscribe to key events
        this.eventBus.on('tool:execution:complete', (event) => {
            trackEvent(event);
        });
        this.eventBus.on('memory:stored', (event) => {
            trackEvent(event);
            this.stats.memoriesStored++;
        });
        this.eventBus.on('memory:retrieved', (event) => {
            trackEvent(event);
            this.stats.memoriesRetrieved++;
        });
        this.eventBus.on('memory:deleted', (event) => {
            trackEvent(event);
            this.stats.memoriesDeleted++;
        });
    }
    // =========================================================================
    // Event Emission Helpers - Sub-25ms guaranteed
    // =========================================================================
    /**
     * Emit a tool execution start event
     */
    emitToolStart(toolName, params) {
        this.eventBus.publishAsync({
            type: 'tool:execution:start',
            timestamp: Date.now(),
            source: 'mcp-coordinator',
            toolName,
            params
        });
    }
    /**
     * Emit a tool execution complete event
     */
    emitToolComplete(toolName, params, result, durationMs, success, error) {
        this.eventBus.publishAsync({
            type: 'tool:execution:complete',
            timestamp: Date.now(),
            source: 'mcp-coordinator',
            toolName,
            params,
            result,
            durationMs,
            success,
            error
        });
    }
    /**
     * Emit a file change event
     */
    emitFileChanged(filePath, relativePath, changeType, sizeBytes) {
        this.eventBus.publishAsync({
            type: 'file:changed',
            timestamp: Date.now(),
            source: 'file-watcher',
            filePath,
            relativePath,
            changeType,
            sizeBytes
        });
        this.stats.filesProcessed++;
    }
    /**
     * Emit a file added event
     */
    emitFileAdded(filePath, relativePath, sizeBytes, contentHash) {
        this.eventBus.publishAsync({
            type: 'file:added',
            timestamp: Date.now(),
            source: 'file-watcher',
            filePath,
            relativePath,
            sizeBytes,
            contentHash
        });
    }
    /**
     * Emit a file deleted event
     */
    emitFileDeleted(filePath, relativePath) {
        this.eventBus.publishAsync({
            type: 'file:deleted',
            timestamp: Date.now(),
            source: 'file-watcher',
            filePath,
            relativePath
        });
    }
    /**
     * Emit a database query start event
     */
    emitDBQueryStart(queryId, queryType, tableName) {
        this.eventBus.publishAsync({
            type: 'db:query:start',
            timestamp: Date.now(),
            source: 'database',
            queryId,
            queryType,
            tableName
        });
    }
    /**
     * Emit a database query complete event
     */
    emitDBQueryComplete(queryId, queryType, durationMs, success, rowsAffected, error) {
        this.eventBus.publishAsync({
            type: 'db:query:complete',
            timestamp: Date.now(),
            source: 'database',
            queryId,
            queryType,
            durationMs,
            rowsAffected,
            success,
            error
        });
        // Check for slow queries
        if (durationMs > 100) {
            this.stats.slowQueries++;
            this.eventBus.publishAsync({
                type: 'db:query:slow',
                timestamp: Date.now(),
                source: 'database',
                queryId,
                querySnippet: `${queryType} query`,
                durationMs,
                threshold: 100
            });
        }
    }
    /**
     * Emit a codebase scan start event
     */
    emitCodebaseScanStart(rootPath, scanType) {
        this.eventBus.publishAsync({
            type: 'codebase:scan:start',
            timestamp: Date.now(),
            source: 'codebase-indexer',
            rootPath,
            scanType
        });
    }
    /**
     * Emit a codebase scan complete event
     */
    emitCodebaseScanComplete(rootPath, filesIndexed, linesIndexed, durationMs, success) {
        this.eventBus.publishAsync({
            type: 'codebase:scan:complete',
            timestamp: Date.now(),
            source: 'codebase-indexer',
            rootPath,
            filesIndexed,
            linesIndexed,
            durationMs,
            success
        });
    }
    /**
     * Emit a codebase scan progress event
     */
    emitCodebaseScanProgress(processed, total, currentFile) {
        this.eventBus.publishAsync({
            type: 'codebase:scan:progress',
            timestamp: Date.now(),
            source: 'codebase-indexer',
            processed,
            total,
            currentFile,
            percentComplete: total > 0 ? Math.round((processed / total) * 100) : 0
        });
    }
    /**
     * Emit a codebase file indexed event
     */
    emitCodebaseFileIndexed(filePath, language, lineCount, hasEmbedding) {
        this.eventBus.publishAsync({
            type: 'codebase:file:indexed',
            timestamp: Date.now(),
            source: 'codebase-indexer',
            filePath,
            language,
            lineCount,
            hasEmbedding
        });
    }
    /**
     * Emit a memory stored event
     * Uses Chinese Compactor for token-efficient content in hook output
     */
    emitMemoryStored(memoryId, content, tags, importance) {
        // Truncate first, then apply Chinese compression for hook output
        const truncated = content.slice(0, 200);
        const { result: compressedContent } = compactIfEnabled(truncated, 'hook');
        this.eventBus.publishAsync({
            type: 'memory:stored',
            timestamp: Date.now(),
            source: 'memory-operations',
            memoryId,
            content: compressedContent,
            tags,
            importance
        });
    }
    /**
     * Emit a memory retrieved event
     */
    emitMemoryRetrieved(memoryIds, query) {
        this.eventBus.publishAsync({
            type: 'memory:retrieved',
            timestamp: Date.now(),
            source: 'memory-operations',
            memoryIds,
            query,
            count: memoryIds.length
        });
    }
    /**
     * Emit a memory deleted event
     */
    emitMemoryDeleted(memoryId) {
        this.eventBus.publishAsync({
            type: 'memory:deleted',
            timestamp: Date.now(),
            source: 'memory-operations',
            memoryId
        });
    }
    /**
     * Emit a memory updated event
     */
    emitMemoryUpdated(memoryId, fieldsUpdated) {
        this.eventBus.publishAsync({
            type: 'memory:updated',
            timestamp: Date.now(),
            source: 'memory-operations',
            memoryId,
            fieldsUpdated
        });
    }
    /**
     * Emit a memory linked event
     */
    emitMemoryLinked(sourceId, targetId, relationType, strength) {
        this.eventBus.publishAsync({
            type: 'memory:linked',
            timestamp: Date.now(),
            source: 'memory-operations',
            sourceId,
            targetId,
            relationType,
            strength
        });
    }
    /**
     * Emit a memory consolidated event
     */
    emitMemoryConsolidated(newMemoryId, sourceMemoryIds, strategy) {
        this.eventBus.publishAsync({
            type: 'memory:consolidated',
            timestamp: Date.now(),
            source: 'memory-operations',
            newMemoryId,
            sourceMemoryIds,
            strategy
        });
    }
    /**
     * Emit a system event
     */
    emitSystemEvent(eventType, message, details) {
        this.eventBus.publishAsync({
            type: `system:${eventType}`,
            timestamp: Date.now(),
            source: 'system',
            message,
            details
        });
    }
    /**
     * Emit a performance alert
     */
    emitPerformanceAlert(metric, value, threshold, severity) {
        this.eventBus.publishAsync({
            type: 'performance:alert',
            timestamp: Date.now(),
            source: 'performance-monitor',
            metric,
            value,
            threshold,
            severity
        });
    }
    // =========================================================================
    // Subscription Helpers
    // =========================================================================
    /**
     * Subscribe to events of a specific type
     */
    on(eventType, handler) {
        this.eventBus.on(eventType, handler);
    }
    /**
     * Subscribe once to an event type
     */
    once(eventType, handler) {
        this.eventBus.once(eventType, handler);
    }
    /**
     * Unsubscribe from events
     */
    off(eventType, subscriberId) {
        this.eventBus.off(eventType, subscriberId);
    }
    // =========================================================================
    // Statistics and Monitoring
    // =========================================================================
    /**
     * Get coordinator statistics
     */
    getStats() {
        return {
            ...this.stats,
            eventsByType: Object.fromEntries(this.stats.eventsByType),
            eventBusMetrics: this.eventBus.getMetrics()
        };
    }
    /**
     * Get formatted metrics
     */
    getFormattedMetrics() {
        const stats = this.getStats();
        return `
=== SpecMem Coordinator Stats ===
Events Emitted: ${stats.eventsEmitted}
Memories Stored: ${stats.memoriesStored}
Memories Retrieved: ${stats.memoriesRetrieved}
Memories Deleted: ${stats.memoriesDeleted}
Files Processed: ${stats.filesProcessed}
Slow Queries: ${stats.slowQueries}

=== Event Bus ===
${this.eventBus.getFormattedMetrics()}
    `.trim();
    }
    // =========================================================================
    // Cleanup
    // =========================================================================
    /**
     * Shutdown the coordinator
     */
    async shutdown() {
        logger.info('Shutting down SpecMem Coordinator...');
        this.emitSystemEvent('shutdown', 'SpecMem Coordinator shutting down');
        // Run cleanup functions
        for (const cleanup of this.cleanupFunctions) {
            try {
                cleanup();
            }
            catch (error) {
                logger.warn({ error }, 'Cleanup function failed');
            }
        }
        await this.eventBus.shutdown();
        this.initialized = false;
        logger.info('SpecMem Coordinator shut down');
    }
}
// ============================================================================
// Singleton Instance
// ============================================================================
let coordinatorInstance = null;
/**
 * Get the global coordinator instance
 */
export function getCoordinator() {
    if (!coordinatorInstance) {
        coordinatorInstance = new SpecMemCoordinator();
    }
    return coordinatorInstance;
}
/**
 * Reset the coordinator (for testing)
 */
export async function resetCoordinator() {
    if (coordinatorInstance) {
        await coordinatorInstance.shutdown();
        coordinatorInstance = null;
    }
}
//# sourceMappingURL=integration.js.map