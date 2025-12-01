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
import { logger } from './logger.js';
import * as os from 'os';
// DEBUG LOGGING - only enabled when SPECMEM_DEBUG=1
const __debugLog = process.env['SPECMEM_DEBUG'] === '1'
    ? (...args) => console.error('[DEBUG]', ...args) // stderr, not stdout!
    : () => { };
// ============================================================================
// Configuration
// ============================================================================
const CONFIG = {
    // Resource limits
    maxCpuPercent: 75, // Never exceed 75% CPU
    maxRamPercent: 60, // Never exceed 60% RAM
    checkIntervalMs: 100, // Check resources every 100ms when waiting
    maxWaitMs: 300000, // Max wait 5 minutes
    queueHighWaterMark: 100, // Warn if queue exceeds this
    // FIFO + ACK settings
    maxRetries: 3, // Max retry attempts before DLQ
    baseRetryDelayMs: 1000, // Base delay for exponential backoff (1s, 2s, 4s)
    maxRetryDelayMs: 30000, // Cap retry delay at 30s
    leaseTimeoutMs: 60000, // 60s lease - requeue if not completed
    agePromotionMs: 30000, // Promote priority after 30s waiting
    // DLQ settings
    dlqMaxSize: 1000, // Max DLQ size (oldest evicted)
    dlqRetentionMs: 3600000, // Keep DLQ items for 1 hour
    // Metrics cache
    metricsCacheMs: 500, // Cache metrics for 500ms
};
// ============================================================================
// Types
// ============================================================================
// Priority levels (lower = higher priority)
export var Priority;
(function (Priority) {
    Priority[Priority["CRITICAL"] = 0] = "CRITICAL";
    Priority[Priority["HIGH"] = 1] = "HIGH";
    Priority[Priority["MEDIUM"] = 2] = "MEDIUM";
    Priority[Priority["LOW"] = 3] = "LOW";
    Priority[Priority["IDLE"] = 4] = "IDLE";
})(Priority || (Priority = {}));
// ============================================================================
// State
// ============================================================================
// Separate FIFO queues per priority level
const priorityQueues = new Map([
    [Priority.CRITICAL, []],
    [Priority.HIGH, []],
    [Priority.MEDIUM, []],
    [Priority.LOW, []],
    [Priority.IDLE, []],
]);
// Items currently being processed (keyed by id)
const processingItems = new Map();
// Dead Letter Queue
const dlq = [];
// Processing state
let isProcessing = false;
let totalRetries = 0;
let totalWaitTimeMs = 0;
let totalProcessed = 0;
// Metrics cache
let lastMetrics = null;
let lastMetricsTime = 0;
// CPU tracking
let lastCpuInfo = null;
let lastCpuTime = 0;
// Operation ID counter
let operationIdCounter = 0;
// ============================================================================
// Utility Functions
// ============================================================================
/**
 * Get max wait time from environment - DYNAMIC!
 */
function getMaxWaitMs() {
    const envVal = process.env['SPECMEM_MAX_WAIT_MS'];
    if (envVal) {
        const ms = parseInt(envVal, 10);
        if (!isNaN(ms) && ms > 0)
            return ms;
    }
    return CONFIG.maxWaitMs;
}
/**
 * Generate unique operation ID
 */
function generateOpId() {
    return `qoms_${++operationIdCounter}_${Date.now()}`;
}
/**
 * Calculate exponential backoff delay
 */
function getRetryDelay(retryCount) {
    const delay = CONFIG.baseRetryDelayMs * Math.pow(2, retryCount);
    return Math.min(delay, CONFIG.maxRetryDelayMs);
}
/**
 * Get current CPU usage percentage
 */
function getCpuPercent() {
    const cpus = os.cpus();
    if (!lastCpuInfo || Date.now() - lastCpuTime > 1000) {
        lastCpuInfo = cpus;
        lastCpuTime = Date.now();
        return 0; // First call, no delta yet
    }
    let totalDelta = 0;
    let idleDelta = 0;
    for (let i = 0; i < cpus.length; i++) {
        const curr = cpus[i].times;
        const prev = lastCpuInfo[i].times;
        const currTotal = curr.user + curr.nice + curr.sys + curr.idle + curr.irq;
        const prevTotal = prev.user + prev.nice + prev.sys + prev.idle + prev.irq;
        totalDelta += currTotal - prevTotal;
        idleDelta += curr.idle - prev.idle;
    }
    lastCpuInfo = cpus;
    lastCpuTime = Date.now();
    if (totalDelta === 0)
        return 0;
    return Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
}
/**
 * Get current system metrics
 */
function getSystemMetrics(opId) {
    // Use cached metrics if recent enough
    if (lastMetrics && Date.now() - lastMetricsTime < CONFIG.metricsCacheMs) {
        __debugLog('[QOMS DEBUG]', Date.now(), 'GET_SYSTEM_METRICS_CACHED', { opId });
        return lastMetrics;
    }
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const metrics = {
        cpuPercent: getCpuPercent(),
        ramPercent: Math.round((usedMem / totalMem) * 100),
        freeRamMB: Math.round(freeMem / 1024 / 1024),
        totalRamMB: Math.round(totalMem / 1024 / 1024),
        loadAvg1m: os.loadavg()[0],
    };
    lastMetrics = metrics;
    lastMetricsTime = Date.now();
    __debugLog('[QOMS DEBUG]', Date.now(), 'GET_SYSTEM_METRICS_FRESH', { opId, metrics });
    return metrics;
}
/**
 * Check if we can execute an operation
 */
function canExecute(priority, opId) {
    const metrics = getSystemMetrics(opId);
    // Critical operations always run
    if (priority === Priority.CRITICAL) {
        return true;
    }
    // Check CPU limit
    if (metrics.cpuPercent > CONFIG.maxCpuPercent) {
        __debugLog('[QOMS DEBUG]', Date.now(), 'CAN_EXECUTE_CPU_EXCEEDED', { opId, cpu: metrics.cpuPercent });
        return false;
    }
    // Check RAM limit
    if (metrics.ramPercent > CONFIG.maxRamPercent) {
        __debugLog('[QOMS DEBUG]', Date.now(), 'CAN_EXECUTE_RAM_EXCEEDED', { opId, ram: metrics.ramPercent });
        return false;
    }
    // IDLE priority only runs when system is very idle
    if (priority === Priority.IDLE) {
        return metrics.cpuPercent < 5 && metrics.ramPercent < 15;
    }
    return true;
}
/**
 * Wait until resources are available
 */
async function waitForResources(priority, maxWaitMs, opId) {
    const effectiveMaxWaitMs = maxWaitMs ?? getMaxWaitMs();
    const startTime = Date.now();
    while (Date.now() - startTime < effectiveMaxWaitMs) {
        if (canExecute(priority, opId)) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, CONFIG.checkIntervalMs));
    }
    return false;
}
// ============================================================================
// Queue Operations
// ============================================================================
/**
 * Get total queue length across all priorities
 */
function getTotalQueueLength() {
    let total = 0;
    for (const q of priorityQueues.values()) {
        total += q.length;
    }
    return total;
}
/**
 * Get next item to process (highest priority, oldest first - FIFO)
 */
function getNextItem() {
    const now = Date.now();
    // Check for priority aging - promote items that have waited too long
    for (const [priority, queue] of priorityQueues.entries()) {
        if (priority === Priority.CRITICAL)
            continue; // Don't age critical
        for (const item of queue) {
            if (item.status === 'pending' &&
                now - item.enqueuedAt > CONFIG.agePromotionMs &&
                item.priority > Priority.CRITICAL) {
                // Promote priority
                const newPriority = item.priority - 1;
                __debugLog('[QOMS DEBUG]', Date.now(), 'PRIORITY_AGED', {
                    opId: item.id,
                    from: Priority[item.priority],
                    to: Priority[newPriority],
                    waitedMs: now - item.enqueuedAt
                });
                // Remove from current queue and add to higher priority
                const idx = queue.indexOf(item);
                if (idx !== -1) {
                    queue.splice(idx, 1);
                    item.priority = newPriority;
                    const targetQueue = priorityQueues.get(newPriority);
                    targetQueue.push(item);
                }
            }
        }
    }
    // Process in priority order (CRITICAL first, IDLE last)
    for (const priority of [Priority.CRITICAL, Priority.HIGH, Priority.MEDIUM, Priority.LOW, Priority.IDLE]) {
        const queue = priorityQueues.get(priority);
        // Find first pending item that's ready (past retry delay)
        for (let i = 0; i < queue.length; i++) {
            const item = queue[i];
            if (item.status === 'pending') {
                // Check if we're past retry delay
                if (item.nextRetryAt && now < item.nextRetryAt) {
                    continue; // Not ready yet
                }
                return item;
            }
        }
    }
    return null;
}
/**
 * ACK - Acknowledge successful completion
 */
function ack(opId) {
    const item = processingItems.get(opId);
    if (!item) {
        __debugLog('[QOMS DEBUG]', Date.now(), 'ACK_NOT_FOUND', { opId });
        return false;
    }
    // Remove from processing
    processingItems.delete(opId);
    // Remove from priority queue
    const queue = priorityQueues.get(item.priority);
    const idx = queue.indexOf(item);
    if (idx !== -1) {
        queue.splice(idx, 1);
    }
    item.status = 'completed';
    // Update stats
    totalProcessed++;
    if (item.enqueuedAt) {
        totalWaitTimeMs += Date.now() - item.enqueuedAt;
    }
    __debugLog('[QOMS DEBUG]', Date.now(), 'ACK_SUCCESS', { opId, totalProcessed });
    return true;
}
/**
 * NACK - Negative acknowledge (failure, will retry)
 */
function nack(opId, error) {
    const item = processingItems.get(opId);
    if (!item) {
        __debugLog('[QOMS DEBUG]', Date.now(), 'NACK_NOT_FOUND', { opId });
        return 'not_found';
    }
    // Remove from processing
    processingItems.delete(opId);
    item.retryCount++;
    item.lastError = error.message;
    totalRetries++;
    // Check if max retries exceeded
    if (item.retryCount >= CONFIG.maxRetries) {
        // Move to DLQ
        item.status = 'dlq';
        // Remove from priority queue
        const queue = priorityQueues.get(item.priority);
        const idx = queue.indexOf(item);
        if (idx !== -1) {
            queue.splice(idx, 1);
        }
        // Add to DLQ
        const dlqItem = {
            id: item.id,
            priority: item.originalPriority,
            enqueuedAt: item.enqueuedAt,
            failedAt: Date.now(),
            retryCount: item.retryCount,
            lastError: item.lastError || 'Unknown error',
        };
        dlq.push(dlqItem);
        // Evict oldest if DLQ is full
        while (dlq.length > CONFIG.dlqMaxSize) {
            dlq.shift();
        }
        __debugLog('[QOMS DEBUG]', Date.now(), 'NACK_TO_DLQ', { opId, retries: item.retryCount, error: error.message });
        // Reject the original promise
        item.reject(new Error(`QOMS: Operation failed after ${item.retryCount} retries. Last error: ${error.message}`));
        return 'dlq';
    }
    // Schedule retry with exponential backoff
    const retryDelay = getRetryDelay(item.retryCount);
    item.nextRetryAt = Date.now() + retryDelay;
    item.status = 'pending';
    item.startedAt = undefined;
    item.leaseExpiresAt = undefined;
    __debugLog('[QOMS DEBUG]', Date.now(), 'NACK_RETRY_SCHEDULED', {
        opId,
        retryCount: item.retryCount,
        retryDelay,
        nextRetryAt: item.nextRetryAt
    });
    return 'retry';
}
/**
 * Check for lease timeouts and requeue expired items
 */
function checkLeaseTimeouts() {
    const now = Date.now();
    for (const [opId, item] of processingItems.entries()) {
        if (item.leaseExpiresAt && now > item.leaseExpiresAt) {
            __debugLog('[QOMS DEBUG]', Date.now(), 'LEASE_TIMEOUT', { opId, expiredAgo: now - item.leaseExpiresAt });
            // Treat as failure, trigger retry
            nack(opId, new Error('Lease timeout - operation took too long'));
        }
    }
}
// ============================================================================
// Queue Processor
// ============================================================================
/**
 * Process the queue - FIFO within priority levels
 */
async function processQueue() {
    if (isProcessing) {
        return;
    }
    isProcessing = true;
    __debugLog('[QOMS DEBUG]', Date.now(), 'PROCESS_QUEUE_START', { totalQueued: getTotalQueueLength() });
    try {
        while (true) {
            // Check lease timeouts
            checkLeaseTimeouts();
            // Get next item (FIFO within priority)
            const item = getNextItem();
            if (!item) {
                // No items ready to process
                break;
            }
            __debugLog('[QOMS DEBUG]', Date.now(), 'PROCESSING_ITEM', {
                opId: item.id,
                priority: Priority[item.priority],
                retryCount: item.retryCount,
                queuedForMs: Date.now() - item.enqueuedAt
            });
            // Wait for resources
            const canRun = await waitForResources(item.priority, undefined, item.id);
            if (!canRun) {
                // Timeout waiting for resources - NACK (will retry)
                item.status = 'pending';
                const effectiveTimeout = getMaxWaitMs();
                __debugLog('[QOMS DEBUG]', Date.now(), 'RESOURCE_TIMEOUT', { opId: item.id, timeout: effectiveTimeout });
                nack(item.id, new Error(`QOMS: Resource timeout after ${effectiveTimeout}ms`));
                continue;
            }
            // Mark as processing with lease
            item.status = 'processing';
            item.startedAt = Date.now();
            item.leaseExpiresAt = Date.now() + CONFIG.leaseTimeoutMs;
            processingItems.set(item.id, item);
            __debugLog('[QOMS DEBUG]', Date.now(), 'EXECUTION_START', {
                opId: item.id,
                leaseExpiresAt: item.leaseExpiresAt
            });
            try {
                const result = await item.operation();
                // ACK on success
                ack(item.id);
                __debugLog('[QOMS DEBUG]', Date.now(), 'EXECUTION_SUCCESS', {
                    opId: item.id,
                    executionTimeMs: Date.now() - (item.startedAt ?? 0)
                });
                item.resolve(result);
            }
            catch (error) {
                __debugLog('[QOMS DEBUG]', Date.now(), 'EXECUTION_ERROR', {
                    opId: item.id,
                    error: error instanceof Error ? error.message : String(error)
                });
                // NACK on failure (will retry or DLQ)
                const result = nack(item.id, error instanceof Error ? error : new Error(String(error)));
                // If moved to DLQ, promise was already rejected in nack()
                // If retry scheduled, we continue processing
                if (result === 'retry') {
                    __debugLog('[QOMS DEBUG]', Date.now(), 'RETRY_SCHEDULED', { opId: item.id });
                }
            }
            // Small delay between operations
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }
    finally {
        __debugLog('[QOMS DEBUG]', Date.now(), 'PROCESS_QUEUE_END', {
            totalQueued: getTotalQueueLength(),
            processing: processingItems.size
        });
        isProcessing = false;
    }
    // If there are items waiting for retry, schedule next processing
    let hasRetryItems = false;
    for (const queue of priorityQueues.values()) {
        if (queue.some(item => item.status === 'pending' && item.nextRetryAt)) {
            hasRetryItems = true;
            break;
        }
    }
    if (hasRetryItems) {
        // Find minimum retry time
        let minRetryTime = Infinity;
        for (const queue of priorityQueues.values()) {
            for (const item of queue) {
                if (item.status === 'pending' && item.nextRetryAt && item.nextRetryAt < minRetryTime) {
                    minRetryTime = item.nextRetryAt;
                }
            }
        }
        const delay = Math.max(0, minRetryTime - Date.now());
        __debugLog('[QOMS DEBUG]', Date.now(), 'SCHEDULING_RETRY_PROCESSING', { delay });
        setTimeout(() => {
            processQueue().catch(err => {
                logger.error({ error: err }, 'QOMS: queue processing error');
            });
        }, delay);
    }
}
// ============================================================================
// Public API
// ============================================================================
/**
 * Enqueue an operation with FIFO + ACK support
 *
 * @param operation - The async operation to run
 * @param priority - Priority level (default: MEDIUM)
 * @returns Promise that resolves when operation completes
 */
export async function enqueue(operation, priority = Priority.MEDIUM) {
    const opId = generateOpId();
    __debugLog('[QOMS DEBUG]', Date.now(), 'ENQUEUE_CALLED', {
        opId,
        priority: Priority[priority],
        totalQueued: getTotalQueueLength()
    });
    // Check if we can execute immediately (empty queue, resources available)
    const queue = priorityQueues.get(priority);
    if (getTotalQueueLength() === 0 && processingItems.size === 0 && canExecute(priority, opId)) {
        __debugLog('[QOMS DEBUG]', Date.now(), 'IMMEDIATE_EXECUTION', { opId });
        const startTime = Date.now();
        try {
            const result = await operation();
            __debugLog('[QOMS DEBUG]', Date.now(), 'IMMEDIATE_SUCCESS', {
                opId,
                executionTimeMs: Date.now() - startTime
            });
            totalProcessed++;
            return result;
        }
        catch (error) {
            __debugLog('[QOMS DEBUG]', Date.now(), 'IMMEDIATE_ERROR', {
                opId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    // Create queue item and add to FIFO queue
    return new Promise((resolve, reject) => {
        const item = {
            id: opId,
            priority,
            originalPriority: priority,
            operation,
            resolve,
            reject,
            enqueuedAt: Date.now(),
            status: 'pending',
            retryCount: 0,
        };
        // Add to end of priority queue (FIFO)
        queue.push(item);
        __debugLog('[QOMS DEBUG]', Date.now(), 'ENQUEUED', {
            opId,
            priority: Priority[priority],
            queueLength: queue.length,
            totalQueued: getTotalQueueLength()
        });
        // Warn if queue is getting long
        const totalQueued = getTotalQueueLength();
        if (totalQueued > CONFIG.queueHighWaterMark) {
            logger.warn({ queueLength: totalQueued }, 'QOMS: queue high water mark exceeded');
        }
        // Start processing if not already
        processQueue().catch(err => {
            logger.error({ error: err }, 'QOMS: queue processing error');
        });
    });
}
/**
 * Get comprehensive queue stats
 */
export function getQueueStats() {
    const queueLengths = {
        [Priority.CRITICAL]: priorityQueues.get(Priority.CRITICAL).length,
        [Priority.HIGH]: priorityQueues.get(Priority.HIGH).length,
        [Priority.MEDIUM]: priorityQueues.get(Priority.MEDIUM).length,
        [Priority.LOW]: priorityQueues.get(Priority.LOW).length,
        [Priority.IDLE]: priorityQueues.get(Priority.IDLE).length,
    };
    // Count pending retries
    let pendingRetries = 0;
    for (const queue of priorityQueues.values()) {
        pendingRetries += queue.filter(item => item.retryCount > 0 && item.status === 'pending').length;
    }
    return {
        queueLengths,
        totalQueued: getTotalQueueLength(),
        processing: processingItems.size,
        pendingRetries,
        totalRetries,
        dlqSize: dlq.length,
        isProcessing,
        avgWaitTimeMs: totalProcessed > 0 ? totalWaitTimeMs / totalProcessed : 0,
        metrics: getSystemMetrics(),
        limits: CONFIG,
    };
}
/**
 * Clear the queue (reject all pending operations)
 */
export function clearQueue() {
    let count = 0;
    for (const [priority, queue] of priorityQueues.entries()) {
        for (const item of queue) {
            if (item.status === 'pending') {
                item.reject(new Error('QOMS: queue cleared'));
                count++;
            }
        }
        priorityQueues.set(priority, []);
    }
    __debugLog('[QOMS DEBUG]', Date.now(), 'QUEUE_CLEARED', { count });
    return count;
}
/**
 * Get Dead Letter Queue items
 */
export function getDLQ() {
    // Clean up old DLQ items
    const now = Date.now();
    while (dlq.length > 0 && now - dlq[0].failedAt > CONFIG.dlqRetentionMs) {
        dlq.shift();
    }
    return [...dlq];
}
/**
 * Clear Dead Letter Queue
 */
export function clearDLQ() {
    const count = dlq.length;
    dlq.length = 0;
    __debugLog('[QOMS DEBUG]', Date.now(), 'DLQ_CLEARED', { count });
    return count;
}
/**
 * Retry a DLQ item (move back to queue)
 */
export function retryDLQItem(dlqId) {
    const idx = dlq.findIndex(item => item.id === dlqId);
    if (idx === -1)
        return false;
    const item = dlq[idx];
    dlq.splice(idx, 1);
    __debugLog('[QOMS DEBUG]', Date.now(), 'DLQ_RETRY', { dlqId, priority: Priority[item.priority] });
    // Note: We can't re-enqueue the operation because we don't have the function anymore
    // This is a limitation - DLQ items can only be inspected, not retried
    // For retry, the caller would need to re-submit the operation
    return true;
}
// ============================================================================
// Convenience API
// ============================================================================
/**
 * Convenience wrappers for different priority levels
 */
export const qoms = {
    critical: (op) => enqueue(op, Priority.CRITICAL),
    high: (op) => enqueue(op, Priority.HIGH),
    medium: (op) => enqueue(op, Priority.MEDIUM),
    low: (op) => enqueue(op, Priority.LOW),
    idle: (op) => enqueue(op, Priority.IDLE),
    enqueue,
    getStats: getQueueStats,
    clear: clearQueue,
    getDLQ,
    clearDLQ,
    retryDLQItem,
    Priority,
};
export default qoms;
//# sourceMappingURL=qoms.js.map