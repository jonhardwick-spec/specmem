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
import { Pool } from 'pg';
export interface QueuedEmbeddingRequest {
    id: number;
    text: string;
    priority: number;
    created_at: Date;
    project_id: string;
}
export interface QueueStats {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
}
export declare class EmbeddingQueue {
    private pool;
    private projectId;
    private initialized;
    private pendingCallbacks;
    private isDraining;
    constructor(pool: Pool);
    /**
     * Initialize the queue table if it doesn't exist
     */
    initialize(): Promise<void>;
    /**
     * Queue a text for embedding when socket is down
     * Returns a promise that resolves when the embedding is eventually generated
     */
    queueForEmbedding(text: string, priority?: number): Promise<number[]>;
    /**
     * Get number of pending requests in queue
     */
    getPendingCount(): Promise<number>;
    /**
     * Get queue statistics
     */
    getStats(): Promise<QueueStats>;
    /**
     * Drain the queue - process all pending requests
     * Called when socket warms up
     *
     * @param embedFn Function to generate embedding for a text
     * @returns Number of items processed
     */
    drainQueue(embedFn: (text: string) => Promise<number[]>): Promise<number>;
    /**
     * Clean up old completed/failed entries
     * Keep last 7 days by default
     */
    cleanup(daysToKeep?: number): Promise<number>;
}
export declare function getEmbeddingQueue(pool: Pool, projectPath?: string): EmbeddingQueue;
export declare function hasEmbeddingQueue(projectPath?: string): boolean;
export declare function resetEmbeddingQueue(projectPath?: string): void;
//# sourceMappingURL=EmbeddingQueue.d.ts.map