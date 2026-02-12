/**
 * EmbeddingQueue.ts - PostgreSQL Overflow Queue for Embeddings
 *
 * When embedding socket is down (Docker paused/cold), queue requests to PostgreSQL.
 * When socket warms up, drain the queue FIRST before processing new requests.
 *
 * Flow:
 * 1. generateSandboxedEmbedding() tries warm socket
 * 2. If fails, tries direct connection
 * 3. If still fails, queues to PostgreSQL with callback promise
 * 4. When socket warms up, drainQueue() processes all pending requests
 * 5. Callbacks resolve with embeddings, requesters get their results
 *
 * @author hardwicksoftwareservices
 */
import { logger } from '../utils/logger.js';
import { getProjectDirName } from '../config.js';
import { getProjectSchema } from '../db/projectNamespacing.js';
// ============================================================================
// EmbeddingQueue Class
// ============================================================================
export class EmbeddingQueue {
    pool;
    projectId;
    initialized = false;
    pendingCallbacks = new Map();
    // Track when each callback was queued for expiry cleanup
    callbackTimestamps = new Map();
    isDraining = false;
    // Configurable limits via environment variables
    maxQueueAge = parseInt(process.env['SPECMEM_EMBED_QUEUE_MAX_AGE_MS'] || '300000'); // 5 min default
    cleanupIntervalMs = parseInt(process.env['SPECMEM_EMBED_QUEUE_CLEANUP_INTERVAL_MS'] || '60000'); // 1 min default
    maxQueueSize = parseInt(process.env['SPECMEM_EMBED_QUEUE_MAX_SIZE'] || '500');
    cleanupTimer = null;
    constructor(pool) {
        this.pool = pool;
        this.projectId = getProjectDirName();
        // Start periodic cleanup of expired callbacks
        this.cleanupTimer = setInterval(() => {
            this.expireStaleCallbacks();
        }, this.cleanupIntervalMs);
        // CRITICAL: Set search_path on every new connection to ensure queries
        // hit the correct project schema, not public
        this.pool.on('connect', async (client) => {
            try {
                const schemaName = getProjectSchema();
                await client.query(`SET search_path TO ${schemaName}, public`);
                logger.debug({ schemaName }, 'EmbeddingQueue: search_path set on new connection');
            }
            catch (err) {
                logger.error({ err }, 'EmbeddingQueue: Failed to set search_path on connection');
            }
        });
    }
    /**
     * Initialize the queue table if it doesn't exist
     */
    async initialize() {
        if (this.initialized)
            return;
        try {
            await this.pool.query(`
        CREATE TABLE IF NOT EXISTS embedding_queue (
          id SERIAL PRIMARY KEY,
          project_id VARCHAR(64) NOT NULL,
          text TEXT NOT NULL,
          priority INTEGER DEFAULT 5,
          status VARCHAR(20) DEFAULT 'pending',
          embedding vector,
          error_message TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          processed_at TIMESTAMP,
          CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
        )
      `);
            // Index for efficient queue processing
            await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_embedding_queue_pending
        ON embedding_queue (project_id, status, priority DESC, created_at ASC)
        WHERE status = 'pending'
      `);
            this.initialized = true;
            logger.info({ projectId: this.projectId }, 'EmbeddingQueue initialized');
        }
        catch (err) {
            logger.error({ err }, 'Failed to initialize EmbeddingQueue');
            throw err;
        }
    }
    /**
     * Queue a text for embedding when socket is down
     * Returns a promise that resolves when the embedding is eventually generated
     */
    async queueForEmbedding(text, priority = 5) {
        await this.initialize();
        // Reject new items when queue is full
        if (this.pendingCallbacks.size >= this.maxQueueSize) {
            const err = new Error(`EmbeddingQueue full (${this.pendingCallbacks.size}/${this.maxQueueSize}) - rejecting new request`);
            logger.warn({ pendingCount: this.pendingCallbacks.size, maxQueueSize: this.maxQueueSize }, err.message);
            throw err;
        }
        return new Promise(async (resolve, reject) => {
            try {
                // Insert into queue
                const result = await this.pool.query(`INSERT INTO embedding_queue (project_id, text, priority, status)
           VALUES ($1, $2, $3, 'pending')
           RETURNING id`, [this.projectId, text, priority]);
                const queueId = result.rows[0].id;
                logger.info({
                    queueId,
                    projectId: this.projectId,
                    textLength: text.length,
                    priority
                }, 'Queued embedding request');
                // Store callback for when this gets processed
                this.pendingCallbacks.set(queueId, (embedding, error) => {
                    if (error) {
                        reject(error);
                    }
                    else if (embedding) {
                        resolve(embedding);
                    }
                    else {
                        reject(new Error('No embedding returned'));
                    }
                });
                // Track when this callback was added for expiry
                this.callbackTimestamps.set(queueId, Date.now());
            }
            catch (err) {
                logger.error({ err, text: text.substring(0, 50) }, 'Failed to queue embedding');
                reject(err);
            }
        });
    }
    /**
     * Get number of pending requests in queue
     */
    async getPendingCount() {
        await this.initialize();
        const result = await this.pool.query(`SELECT COUNT(*) as count FROM embedding_queue WHERE project_id = $1 AND status = 'pending'`, [this.projectId]);
        return parseInt(result.rows[0].count, 10);
    }
    /**
     * Get queue statistics
     */
    async getStats() {
        await this.initialize();
        const result = await this.pool.query(`SELECT status, COUNT(*) as count
       FROM embedding_queue
       WHERE project_id = $1
       GROUP BY status`, [this.projectId]);
        const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
        for (const row of result.rows) {
            stats[row.status] = parseInt(row.count, 10);
        }
        return stats;
    }
    /**
     * Drain the queue - process all pending requests
     * Called when socket warms up
     *
     * @param embedFn Function to generate embedding for a text
     * @returns Number of items processed
     */
    async drainQueue(embedFn) {
        if (this.isDraining) {
            logger.debug('Queue drain already in progress');
            return 0;
        }
        this.isDraining = true;
        let processed = 0;
        try {
            await this.initialize();
            const pendingCount = await this.getPendingCount();
            if (pendingCount === 0) {
                logger.debug('No pending items in embedding queue');
                return 0;
            }
            logger.info({ pendingCount, projectId: this.projectId }, 'Draining embedding queue');
            // Process in batches
            const batchSize = 10;
            let hasMore = true;
            while (hasMore) {
                // Get next batch of pending items
                const result = await this.pool.query(`UPDATE embedding_queue
           SET status = 'processing', processed_at = NOW()
           WHERE id IN (
             SELECT id FROM embedding_queue
             WHERE project_id = $1 AND status = 'pending'
             ORDER BY priority DESC, created_at ASC
             LIMIT $2
             FOR UPDATE SKIP LOCKED
           )
           RETURNING id, text, priority, created_at, project_id`, [this.projectId, batchSize]);
                if (result.rows.length === 0) {
                    hasMore = false;
                    break;
                }
                // Process each item
                for (const item of result.rows) {
                    try {
                        const embedding = await embedFn(item.text);
                        // Mark as completed and store embedding
                        await this.pool.query(`UPDATE embedding_queue
               SET status = 'completed', embedding = $2::vector
               WHERE id = $1`, [item.id, `[${embedding.join(',')}]`]);
                        // Call the callback if it exists
                        const callback = this.pendingCallbacks.get(item.id);
                        if (callback) {
                            callback(embedding);
                            this.pendingCallbacks.delete(item.id);
                            this.callbackTimestamps.delete(item.id);
                        }
                        processed++;
                        logger.debug({ queueId: item.id, processed }, 'Processed queued embedding');
                    }
                    catch (err) {
                        // Mark as failed
                        const errorMsg = err instanceof Error ? err.message : String(err);
                        await this.pool.query(`UPDATE embedding_queue
               SET status = 'failed', error_message = $2
               WHERE id = $1`, [item.id, errorMsg]);
                        // Call callback with error
                        const callback = this.pendingCallbacks.get(item.id);
                        if (callback) {
                            callback(null, err instanceof Error ? err : new Error(errorMsg));
                            this.pendingCallbacks.delete(item.id);
                            this.callbackTimestamps.delete(item.id);
                        }
                        logger.warn({ queueId: item.id, error: errorMsg }, 'Failed to process queued embedding');
                    }
                }
            }
            logger.info({ processed, projectId: this.projectId }, 'Finished draining embedding queue');
        }
        finally {
            this.isDraining = false;
        }
        return processed;
    }
    /**
     * Expire stale callbacks that have been waiting longer than maxQueueAge.
     * Called periodically by the cleanup timer to prevent unbounded callback growth.
     */
    expireStaleCallbacks() {
        const now = Date.now();
        let expiredCount = 0;
        for (const [queueId, timestamp] of this.callbackTimestamps.entries()) {
            if (now - timestamp > this.maxQueueAge) {
                const callback = this.pendingCallbacks.get(queueId);
                if (callback) {
                    callback(null, new Error(`EmbeddingQueue callback expired after ${this.maxQueueAge}ms (queueId: ${queueId})`));
                    this.pendingCallbacks.delete(queueId);
                }
                this.callbackTimestamps.delete(queueId);
                expiredCount++;
            }
        }
        if (expiredCount > 0) {
            logger.warn({ expiredCount, remainingCallbacks: this.pendingCallbacks.size }, 'Expired stale EmbeddingQueue callbacks');
        }
    }
    /**
     * Shutdown the queue - clears cleanup timer and rejects all pending callbacks.
     * Must be called when the EmbeddingQueue is no longer needed.
     */
    shutdown() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        // Reject all remaining pending callbacks
        let rejectedCount = 0;
        for (const [queueId, callback] of this.pendingCallbacks.entries()) {
            callback(null, new Error('EmbeddingQueue shutting down'));
            rejectedCount++;
        }
        this.pendingCallbacks.clear();
        this.callbackTimestamps.clear();
        if (rejectedCount > 0) {
            logger.info({ rejectedCount }, 'EmbeddingQueue shutdown - rejected pending callbacks');
        }
    }
    /**
     * Clean up old completed/failed entries
     * Keep last 7 days by default
     */
    async cleanup(daysToKeep = 7) {
        await this.initialize();
        const result = await this.pool.query(`DELETE FROM embedding_queue
       WHERE project_id = $1
       AND status IN ('completed', 'failed')
       AND created_at < NOW() - INTERVAL '1 day' * $2`, [this.projectId, daysToKeep]);
        const deleted = result.rowCount || 0;
        if (deleted > 0) {
            logger.info({ deleted, daysToKeep, projectId: this.projectId }, 'Cleaned up old queue entries');
        }
        return deleted;
    }
}
// ============================================================================
// Per-Project Instance Management (Map pattern for project isolation)
// ============================================================================
import { getProjectPath } from '../config.js';
const embeddingQueuesByProject = new Map();
export function getEmbeddingQueue(pool, projectPath) {
    const targetProject = projectPath || getProjectPath();
    if (!embeddingQueuesByProject.has(targetProject)) {
        embeddingQueuesByProject.set(targetProject, new EmbeddingQueue(pool));
    }
    return embeddingQueuesByProject.get(targetProject);
}
export function hasEmbeddingQueue(projectPath) {
    const targetProject = projectPath || getProjectPath();
    return embeddingQueuesByProject.has(targetProject);
}
export function resetEmbeddingQueue(projectPath) {
    const targetProject = projectPath || getProjectPath();
    embeddingQueuesByProject.delete(targetProject);
}
//# sourceMappingURL=EmbeddingQueue.js.map