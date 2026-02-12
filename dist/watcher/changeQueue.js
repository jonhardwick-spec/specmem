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
import { logger } from '../utils/logger.js';
/**
 * queueTheChangesUp - change queue manager
 *
 * fr fr keeping all them changes organized
 */
export class QueueTheChangesUp {
    config;
    queue = [];
    processing = false;
    processingInterval = null;
    changeHandler;
    // deduplication map: path -> latest queued change
    dedupMap = new Map();
    // LOW-10 FIX: Track retry timeouts for cleanup on stop
    retryTimeouts = new Set();
    // stats
    stats = {
        queuedCount: 0,
        processedCount: 0,
        failedCount: 0,
        retriedCount: 0,
        deduplicatedCount: 0,
        averageProcessingTimeMs: 0,
        currentQueueSize: 0,
        isProcessing: false
    };
    // processing times for average calculation
    processingTimes = [];
    constructor(changeHandler, config = {}) {
        this.changeHandler = changeHandler;
        this.config = {
            maxQueueSize: config.maxQueueSize ?? 10000,
            batchSize: config.batchSize ?? 100,
            processingIntervalMs: config.processingIntervalMs ?? 500,
            maxRetries: config.maxRetries ?? 3,
            retryDelayMs: config.retryDelayMs ?? 1000,
            retryBackoffMultiplier: config.retryBackoffMultiplier ?? 2,
            enableDeduplication: config.enableDeduplication ?? true
        };
    }
    /**
     * enqueue - adds a file change to the queue
     *
     * yooo adding this change to the queue
     */
    enqueue(event, priority = 1) {
        // check if queue is full
        if (this.queue.length >= this.config.maxQueueSize) {
            logger.warn({ queueSize: this.queue.length }, 'queue is full - dropping event');
            return false;
        }
        // deduplication check
        if (this.config.enableDeduplication) {
            const existing = this.dedupMap.get(event.path);
            if (existing) {
                // update existing entry with latest event
                existing.event = event;
                existing.priority = Math.max(existing.priority, priority);
                this.stats.deduplicatedCount++;
                logger.debug({
                    path: event.path,
                    type: event.type
                }, 'deduplicated file change');
                return true;
            }
        }
        // create queued change
        const queuedChange = {
            event,
            priority,
            retries: 0,
            enqueuedAt: new Date()
        };
        // add to queue (sorted by priority)
        this.queue.push(queuedChange);
        this.sortQueue();
        // add to dedup map
        if (this.config.enableDeduplication) {
            this.dedupMap.set(event.path, queuedChange);
        }
        this.stats.queuedCount++;
        this.stats.currentQueueSize = this.queue.length;
        logger.debug({
            path: event.path,
            type: event.type,
            priority,
            queueSize: this.queue.length
        }, 'file change enqueued');
        return true;
    }
    /**
     * startProcessing - begins processing queue
     *
     * fr fr lets start processing these changes
     */
    startProcessing() {
        if (this.processing) {
            logger.warn('queue processing already started');
            return;
        }
        logger.info({
            batchSize: this.config.batchSize,
            intervalMs: this.config.processingIntervalMs
        }, 'starting queue processing');
        this.processing = true;
        this.stats.isProcessing = true;
        // start processing interval
        this.processingInterval = setInterval(() => this.processBatch(), this.config.processingIntervalMs);
        // also process immediately
        this.processBatch();
    }
    /**
     * stopProcessing - stops queue processing
     *
     * @param flush - if true, processes all pending changes before stopping (default: true)
     */
    async stopProcessing(flush = true) {
        if (!this.processing) {
            logger.warn('queue processing not running');
            return;
        }
        logger.info({ flush, pendingCount: this.queue.length }, 'stopping queue processing');
        // FIX MED-15: Flush pending changes before stopping to avoid data loss
        if (flush && this.queue.length > 0) {
            logger.info({ pendingCount: this.queue.length }, 'flushing pending changes before stop');
            await this.flush();
        }
        this.processing = false;
        this.stats.isProcessing = false;
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }
        // LOW-10 FIX: Cancel all pending retry timeouts to prevent memory leaks
        for (const timeout of this.retryTimeouts) {
            clearTimeout(timeout);
        }
        const cancelledCount = this.retryTimeouts.size;
        this.retryTimeouts.clear();
        if (cancelledCount > 0) {
            logger.debug({ cancelledTimeouts: cancelledCount }, 'cancelled pending retry timeouts');
        }
    }
    /**
     * processBatch - processes a batch of changes
     *
     * nah bruh processing this whole batch at once
     */
    async processBatch() {
        if (this.queue.length === 0) {
            return;
        }
        logger.debug({
            queueSize: this.queue.length,
            batchSize: this.config.batchSize
        }, 'processing batch');
        // take batch from front of queue
        const batch = this.queue.splice(0, this.config.batchSize);
        // process each change in parallel (with concurrency limit)
        const promises = batch.map(change => this.processChange(change));
        try {
            await Promise.allSettled(promises);
        }
        catch (error) {
            logger.error({ error }, 'batch processing error');
        }
        this.stats.currentQueueSize = this.queue.length;
        // update average processing time
        if (this.processingTimes.length > 0) {
            const sum = this.processingTimes.reduce((a, b) => a + b, 0);
            this.stats.averageProcessingTimeMs = sum / this.processingTimes.length;
            // keep only last 100 times
            if (this.processingTimes.length > 100) {
                this.processingTimes = this.processingTimes.slice(-100);
            }
        }
    }
    /**
     * processChange - processes a single change
     */
    async processChange(change) {
        const startTime = Date.now();
        try {
            // process the change
            await this.changeHandler.handleChange(change.event);
            // success
            change.processedAt = new Date();
            this.stats.processedCount++;
            // remove from dedup map
            if (this.config.enableDeduplication) {
                this.dedupMap.delete(change.event.path);
            }
            // track processing time
            const processingTime = Date.now() - startTime;
            this.processingTimes.push(processingTime);
            logger.debug({
                path: change.event.path,
                type: change.event.type,
                processingTimeMs: processingTime
            }, 'change processed successfully');
        }
        catch (error) {
            // failure - retry logic
            change.lastError = error;
            change.retries++;
            logger.error({
                error,
                path: change.event.path,
                retries: change.retries,
                maxRetries: this.config.maxRetries
            }, 'failed to process change');
            if (change.retries < this.config.maxRetries) {
                // retry with exponential backoff
                const delay = this.config.retryDelayMs * Math.pow(this.config.retryBackoffMultiplier, change.retries - 1);
                logger.info({
                    path: change.event.path,
                    retries: change.retries,
                    delayMs: delay
                }, 'retrying change after delay');
                // LOW-10 FIX: Track retry timeout for cleanup on stop
                const retryTimeout = setTimeout(() => {
                    this.retryTimeouts.delete(retryTimeout);
                    // increase priority for retries
                    this.enqueue(change.event, change.priority + 1);
                }, delay);
                this.retryTimeouts.add(retryTimeout);
                this.stats.retriedCount++;
            }
            else {
                // max retries exceeded - give up
                logger.error({
                    path: change.event.path,
                    retries: change.retries
                }, 'max retries exceeded - dropping change');
                this.stats.failedCount++;
                // remove from dedup map
                if (this.config.enableDeduplication) {
                    this.dedupMap.delete(change.event.path);
                }
            }
        }
    }
    /**
     * sortQueue - sorts queue by priority (highest first)
     */
    sortQueue() {
        this.queue.sort((a, b) => b.priority - a.priority);
    }
    /**
     * getStats - returns queue statistics
     */
    getStats() {
        return { ...this.stats };
    }
    /**
     * clear - clears the queue
     */
    clear() {
        logger.info({ queueSize: this.queue.length }, 'clearing queue');
        this.queue = [];
        this.dedupMap.clear();
        this.stats.currentQueueSize = 0;
    }
    /**
     * flush - processes all pending changes immediately
     *
     * yooo flushing the whole queue rn
     */
    async flush() {
        logger.info({ queueSize: this.queue.length }, 'flushing queue');
        while (this.queue.length > 0) {
            await this.processBatch();
        }
        logger.info('queue flushed');
    }
    /**
     * getPendingCount - returns number of pending changes
     */
    getPendingCount() {
        return this.queue.length;
    }
    /**
     * hasPendingChanges - checks if there are pending changes
     */
    hasPendingChanges() {
        return this.queue.length > 0;
    }
    /**
     * getPendingPaths - returns paths of all pending changes
     */
    getPendingPaths() {
        return this.queue.map(change => change.event.path);
    }
    /**
     * getQueueHealth - returns queue health metrics
     */
    getQueueHealth() {
        const issues = [];
        const totalProcessed = this.stats.processedCount + this.stats.failedCount;
        const failureRate = totalProcessed > 0
            ? this.stats.failedCount / totalProcessed
            : 0;
        const queueUtilization = this.queue.length / this.config.maxQueueSize;
        // check for issues
        if (queueUtilization > 0.8) {
            issues.push('Queue is >80% full');
        }
        if (failureRate > 0.1) {
            issues.push(`High failure rate: ${(failureRate * 100).toFixed(1)}%`);
        }
        if (this.stats.averageProcessingTimeMs > 5000) {
            issues.push(`Slow processing: ${this.stats.averageProcessingTimeMs}ms avg`);
        }
        const healthy = issues.length === 0;
        return {
            healthy,
            queueUtilization,
            failureRate,
            averageProcessingTimeMs: this.stats.averageProcessingTimeMs,
            issues
        };
    }
    /**
     * resetStats - resets statistics
     */
    resetStats() {
        this.stats = {
            queuedCount: 0,
            processedCount: 0,
            failedCount: 0,
            retriedCount: 0,
            deduplicatedCount: 0,
            averageProcessingTimeMs: 0,
            currentQueueSize: this.queue.length,
            isProcessing: this.processing
        };
        this.processingTimes = [];
    }
}
//# sourceMappingURL=changeQueue.js.map