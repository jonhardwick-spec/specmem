/**
 * changeQueue.ts - Queue Management for File Changes
 *
 * yooo batching all them file changes for performance
 * handles queuing, deduplication, and ordered processing
 *
 * Features:
 * - FIFO queue with priority support
 * - Deduplication (dont process same file twice)
 * - Batch processing for efficiency
 * - Retry logic with exponential backoff
 * - Progress tracking
 * - Conflict resolution
 */
import { FileChangeEvent } from './fileWatcher.js';
import { AutoUpdateTheMemories } from './changeHandler.js';
export interface QueueConfig {
    maxQueueSize?: number;
    batchSize?: number;
    processingIntervalMs?: number;
    maxRetries?: number;
    retryDelayMs?: number;
    retryBackoffMultiplier?: number;
    enableDeduplication?: boolean;
}
export interface QueuedChange {
    event: FileChangeEvent;
    priority: number;
    retries: number;
    lastError?: Error;
    enqueuedAt: Date;
    processedAt?: Date;
}
export interface QueueStats {
    queuedCount: number;
    processedCount: number;
    failedCount: number;
    retriedCount: number;
    deduplicatedCount: number;
    averageProcessingTimeMs: number;
    currentQueueSize: number;
    isProcessing: boolean;
}
/**
 * queueTheChangesUp - change queue manager
 *
 * fr fr keeping all them changes organized
 */
export declare class QueueTheChangesUp {
    private config;
    private queue;
    private processing;
    private processingInterval;
    private changeHandler;
    private dedupMap;
    private retryTimeouts;
    private stats;
    private processingTimes;
    constructor(changeHandler: AutoUpdateTheMemories, config?: QueueConfig);
    /**
     * enqueue - adds a file change to the queue
     *
     * yooo adding this change to the queue
     */
    enqueue(event: FileChangeEvent, priority?: number): boolean;
    /**
     * startProcessing - begins processing queue
     *
     * fr fr lets start processing these changes
     */
    startProcessing(): void;
    /**
     * stopProcessing - stops queue processing
     *
     * @param flush - if true, processes all pending changes before stopping (default: true)
     */
    stopProcessing(flush?: boolean): Promise<void>;
    /**
     * processBatch - processes a batch of changes
     *
     * nah bruh processing this whole batch at once
     */
    private processBatch;
    /**
     * processChange - processes a single change
     */
    private processChange;
    /**
     * sortQueue - sorts queue by priority (highest first)
     */
    private sortQueue;
    /**
     * getStats - returns queue statistics
     */
    getStats(): QueueStats;
    /**
     * clear - clears the queue
     */
    clear(): void;
    /**
     * flush - processes all pending changes immediately
     *
     * yooo flushing the whole queue rn
     */
    flush(): Promise<void>;
    /**
     * getPendingCount - returns number of pending changes
     */
    getPendingCount(): number;
    /**
     * hasPendingChanges - checks if there are pending changes
     */
    hasPendingChanges(): boolean;
    /**
     * getPendingPaths - returns paths of all pending changes
     */
    getPendingPaths(): string[];
    /**
     * getQueueHealth - returns queue health metrics
     */
    getQueueHealth(): {
        healthy: boolean;
        queueUtilization: number;
        failureRate: number;
        averageProcessingTimeMs: number;
        issues: string[];
    };
    /**
     * resetStats - resets statistics
     */
    resetStats(): void;
}
//# sourceMappingURL=changeQueue.d.ts.map