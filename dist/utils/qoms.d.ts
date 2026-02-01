/**
 * QOMS - Queued Operation Management System (v2 - FIFO + ACK)
 *
 * Ensures SpecMem NEVER exceeds resource limits:
 *   - CPU: Max 75% utilization
 *   - RAM: Max 60% of system memory
 *
 * v2 IMPROVEMENTS:
 *   - Strict FIFO within priority levels (no starvation)
 *   - ACK mechanism: items only removed after explicit ACK
 *   - Retry with exponential backoff on failure
 *   - Dead Letter Queue (DLQ) for permanently failed operations
 *   - Lease timeout: long-running ops get requeued if no heartbeat
 *   - Priority aging: low priority items eventually get promoted
 *
 * How it works:
 *   1. Operations enqueued to priority-specific FIFO queues
 *   2. Processor takes oldest item from highest priority non-empty queue
 *   3. Item marked "processing" (not removed from queue)
 *   4. On success: ACK removes item
 *   5. On failure: NACK increments retry count, re-enqueues with backoff
 *   6. After max retries: move to DLQ
 *
 * @author hardwicksoftwareservices
 */
declare const CONFIG: {
    readonly maxCpuPercent: 75;
    readonly maxRamPercent: 60;
    readonly checkIntervalMs: 100;
    readonly maxWaitMs: 300000;
    readonly queueHighWaterMark: 100;
    readonly maxRetries: 3;
    readonly baseRetryDelayMs: 1000;
    readonly maxRetryDelayMs: 30000;
    readonly leaseTimeoutMs: 60000;
    readonly agePromotionMs: 30000;
    readonly dlqMaxSize: 1000;
    readonly dlqRetentionMs: 3600000;
    readonly metricsCacheMs: 500;
};
export declare enum Priority {
    CRITICAL = 0,// Must run immediately (health checks)
    HIGH = 1,// User-facing operations (search, save)
    MEDIUM = 2,// Background operations (embeddings)
    LOW = 3,// Maintenance (cleanup, consolidation)
    IDLE = 4
}
interface DLQItem {
    id: string;
    priority: Priority;
    enqueuedAt: number;
    failedAt: number;
    retryCount: number;
    lastError: string;
    operationName?: string;
}
interface SystemMetrics {
    cpuPercent: number;
    ramPercent: number;
    freeRamMB: number;
    totalRamMB: number;
    loadAvg1m: number;
}
interface QueueStats {
    queueLengths: Record<Priority, number>;
    totalQueued: number;
    processing: number;
    pendingRetries: number;
    totalRetries: number;
    dlqSize: number;
    isProcessing: boolean;
    avgWaitTimeMs: number;
    metrics: SystemMetrics;
    limits: typeof CONFIG;
}
/**
 * Enqueue an operation with FIFO + ACK support
 *
 * @param operation - The async operation to run
 * @param priority - Priority level (default: MEDIUM)
 * @returns Promise that resolves when operation completes
 */
export declare function enqueue<T>(operation: () => Promise<T>, priority?: Priority): Promise<T>;
/**
 * Get comprehensive queue stats
 */
export declare function getQueueStats(): QueueStats;
/**
 * Clear the queue (reject all pending operations)
 */
export declare function clearQueue(): number;
/**
 * Get Dead Letter Queue items
 */
export declare function getDLQ(): DLQItem[];
/**
 * Clear Dead Letter Queue
 */
export declare function clearDLQ(): number;
/**
 * Retry a DLQ item (move back to queue)
 */
export declare function retryDLQItem(dlqId: string): boolean;
/**
 * Convenience wrappers for different priority levels
 */
export declare const qoms: {
    critical: <T>(op: () => Promise<T>) => Promise<T>;
    high: <T>(op: () => Promise<T>) => Promise<T>;
    medium: <T>(op: () => Promise<T>) => Promise<T>;
    low: <T>(op: () => Promise<T>) => Promise<T>;
    idle: <T>(op: () => Promise<T>) => Promise<T>;
    enqueue: typeof enqueue;
    getStats: typeof getQueueStats;
    clear: typeof clearQueue;
    getDLQ: typeof getDLQ;
    clearDLQ: typeof clearDLQ;
    retryDLQItem: typeof retryDLQItem;
    Priority: typeof Priority;
};
export default qoms;
//# sourceMappingURL=qoms.d.ts.map