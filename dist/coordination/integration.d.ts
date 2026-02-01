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
import { SpecMemEvent, BaseEvent, MessageHandler } from '../events/index.js';
/**
 * File watcher events
 */
export interface FileChangedEvent extends BaseEvent {
    type: 'file:changed';
    filePath: string;
    relativePath: string;
    changeType: 'add' | 'change' | 'unlink';
    sizeBytes?: number;
}
export interface FileAddedEvent extends BaseEvent {
    type: 'file:added';
    filePath: string;
    relativePath: string;
    sizeBytes: number;
    contentHash?: string;
}
export interface FileDeletedEvent extends BaseEvent {
    type: 'file:deleted';
    filePath: string;
    relativePath: string;
}
/**
 * Database events
 */
export interface DBQueryStartEvent extends BaseEvent {
    type: 'db:query:start';
    queryId: string;
    queryType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'TRANSACTION' | 'OTHER';
    tableName?: string;
}
export interface DBQueryCompleteEvent extends BaseEvent {
    type: 'db:query:complete';
    queryId: string;
    queryType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'TRANSACTION' | 'OTHER';
    durationMs: number;
    rowsAffected?: number;
    success: boolean;
    error?: string;
}
export interface DBSlowQueryEvent extends BaseEvent {
    type: 'db:query:slow';
    queryId: string;
    querySnippet: string;
    durationMs: number;
    threshold: number;
}
/**
 * Codebase indexer events
 */
export interface CodebaseScanStartEvent extends BaseEvent {
    type: 'codebase:scan:start';
    rootPath: string;
    scanType: 'full' | 'incremental';
}
export interface CodebaseScanCompleteEvent extends BaseEvent {
    type: 'codebase:scan:complete';
    rootPath: string;
    filesIndexed: number;
    linesIndexed: number;
    durationMs: number;
    success: boolean;
}
export interface CodebaseScanProgressEvent extends BaseEvent {
    type: 'codebase:scan:progress';
    processed: number;
    total: number;
    currentFile?: string;
    percentComplete: number;
}
export interface CodebaseFileIndexedEvent extends BaseEvent {
    type: 'codebase:file:indexed';
    filePath: string;
    language: string;
    lineCount: number;
    hasEmbedding: boolean;
}
/**
 * Memory operation events (enhanced)
 */
export interface MemoryUpdatedEvent extends BaseEvent {
    type: 'memory:updated';
    memoryId: string;
    fieldsUpdated: string[];
}
export interface MemoryLinkedEvent extends BaseEvent {
    type: 'memory:linked';
    sourceId: string;
    targetId: string;
    relationType: string;
    strength: number;
}
export interface MemoryConsolidatedEvent extends BaseEvent {
    type: 'memory:consolidated';
    newMemoryId: string;
    sourceMemoryIds: string[];
    strategy: string;
}
/**
 * Extended union of all SpecMem events
 */
export type SpecMemExtendedEvent = SpecMemEvent | FileChangedEvent | FileAddedEvent | FileDeletedEvent | DBQueryStartEvent | DBQueryCompleteEvent | DBSlowQueryEvent | CodebaseScanStartEvent | CodebaseScanCompleteEvent | CodebaseScanProgressEvent | CodebaseFileIndexedEvent | MemoryUpdatedEvent | MemoryLinkedEvent | MemoryConsolidatedEvent;
/**
 * SpecMemCoordinator - The central event hub
 *
 * Manages all event subscriptions and provides helper methods
 * for emitting events from any component in SpecMem.
 */
export declare class SpecMemCoordinator {
    private eventBus;
    private cleanupFunctions;
    private initialized;
    private stats;
    constructor();
    /**
     * Initialize the coordinator with all event listeners
     */
    initialize(): Promise<void>;
    /**
     * Setup internal event tracking for statistics
     */
    private setupEventTracking;
    /**
     * Emit a tool execution start event
     */
    emitToolStart(toolName: string, params: unknown): void;
    /**
     * Emit a tool execution complete event
     */
    emitToolComplete(toolName: string, params: unknown, result: unknown, durationMs: number, success: boolean, error?: Error): void;
    /**
     * Emit a file change event
     */
    emitFileChanged(filePath: string, relativePath: string, changeType: 'add' | 'change' | 'unlink', sizeBytes?: number): void;
    /**
     * Emit a file added event
     */
    emitFileAdded(filePath: string, relativePath: string, sizeBytes: number, contentHash?: string): void;
    /**
     * Emit a file deleted event
     */
    emitFileDeleted(filePath: string, relativePath: string): void;
    /**
     * Emit a database query start event
     */
    emitDBQueryStart(queryId: string, queryType: DBQueryStartEvent['queryType'], tableName?: string): void;
    /**
     * Emit a database query complete event
     */
    emitDBQueryComplete(queryId: string, queryType: DBQueryCompleteEvent['queryType'], durationMs: number, success: boolean, rowsAffected?: number, error?: string): void;
    /**
     * Emit a codebase scan start event
     */
    emitCodebaseScanStart(rootPath: string, scanType: 'full' | 'incremental'): void;
    /**
     * Emit a codebase scan complete event
     */
    emitCodebaseScanComplete(rootPath: string, filesIndexed: number, linesIndexed: number, durationMs: number, success: boolean): void;
    /**
     * Emit a codebase scan progress event
     */
    emitCodebaseScanProgress(processed: number, total: number, currentFile?: string): void;
    /**
     * Emit a codebase file indexed event
     */
    emitCodebaseFileIndexed(filePath: string, language: string, lineCount: number, hasEmbedding: boolean): void;
    /**
     * Emit a memory stored event
     * Uses Chinese Compactor for token-efficient content in hook output
     */
    emitMemoryStored(memoryId: string, content: string, tags: string[], importance: string): void;
    /**
     * Emit a memory retrieved event
     */
    emitMemoryRetrieved(memoryIds: string[], query?: string): void;
    /**
     * Emit a memory deleted event
     */
    emitMemoryDeleted(memoryId: string): void;
    /**
     * Emit a memory updated event
     */
    emitMemoryUpdated(memoryId: string, fieldsUpdated: string[]): void;
    /**
     * Emit a memory linked event
     */
    emitMemoryLinked(sourceId: string, targetId: string, relationType: string, strength: number): void;
    /**
     * Emit a memory consolidated event
     */
    emitMemoryConsolidated(newMemoryId: string, sourceMemoryIds: string[], strategy: string): void;
    /**
     * Emit a system event
     */
    emitSystemEvent(eventType: 'startup' | 'shutdown' | 'error', message: string, details?: Record<string, unknown>): void;
    /**
     * Emit a performance alert
     */
    emitPerformanceAlert(metric: string, value: number, threshold: number, severity: 'warning' | 'critical'): void;
    /**
     * Subscribe to events of a specific type
     */
    on<E extends SpecMemExtendedEvent>(eventType: E['type'], handler: MessageHandler<E>): void;
    /**
     * Subscribe once to an event type
     */
    once<E extends SpecMemExtendedEvent>(eventType: E['type'], handler: MessageHandler<E>): void;
    /**
     * Unsubscribe from events
     */
    off(eventType: string, subscriberId?: string): void;
    /**
     * Get coordinator statistics
     */
    getStats(): {
        eventsByType: {
            [k: string]: number;
        };
        eventBusMetrics: import("../events/metrics.js").MetricStats;
        eventsEmitted: number;
        slowQueries: number;
        filesProcessed: number;
        memoriesStored: number;
        memoriesRetrieved: number;
        memoriesDeleted: number;
    };
    /**
     * Get formatted metrics
     */
    getFormattedMetrics(): string;
    /**
     * Shutdown the coordinator
     */
    shutdown(): Promise<void>;
}
/**
 * Get the global coordinator instance
 */
export declare function getCoordinator(): SpecMemCoordinator;
/**
 * Reset the coordinator (for testing)
 */
export declare function resetCoordinator(): Promise<void>;
export { SpecMemEvent, BaseEvent, ToolExecutionStartEvent, ToolExecutionCompleteEvent, MemoryStoredEvent, MemoryRetrievedEvent, MemoryDeletedEvent, PerformanceAlertEvent, SystemEvent } from '../events/index.js';
//# sourceMappingURL=integration.d.ts.map