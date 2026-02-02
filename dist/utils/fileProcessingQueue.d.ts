/**
 * fileProcessingQueue.ts - Race Condition Prevention for File Indexing
 *
 * yo this queue ensures only one process indexes a file at a time
 * no more race conditions when multiple events fire fr fr
 * mutex per file path - enterprise grade locking
 *
 * Issue #16 fix - race condition in file indexing
 */
/**
 * Queue item status
 */
export declare enum QueueItemStatus {
    PENDING = "PENDING",
    PROCESSING = "PROCESSING",
    COMPLETED = "COMPLETED",
    FAILED = "FAILED"
}
/**
 * Queue item
 */
export interface QueueItem<T> {
    id: string;
    path: string;
    data: T;
    status: QueueItemStatus;
    addedAt: number;
    startedAt?: number;
    completedAt?: number;
    error?: string;
    retryCount: number;
}
/**
 * Queue statistics
 */
export interface QueueStats {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
    lockedPaths: number;
    avgProcessingTimeMs: number;
}
/**
 * FileProcessingQueue - prevents race conditions in file processing
 *
 * Features that PREVENT CHAOS:
 * - Per-path mutex locking
 * - FIFO queue processing
 * - Automatic retry with backoff
 * - Concurrent processing limits
 * - Deadlock prevention
 */
export declare class FileProcessingQueue<T = unknown> {
    private queue;
    private pathLocks;
    private processing;
    private processingTimes;
    private maxConcurrent;
    private maxRetries;
    private processor;
    private isProcessing;
    private itemCounter;
    constructor(options: {
        processor: (path: string, data: T) => Promise<void>;
        maxConcurrent?: number;
        maxRetries?: number;
    });
    /**
     * Add an item to the queue
     * Returns false if the path is already queued/processing
     */
    enqueue(path: string, data: T): Promise<boolean>;
    /**
     * Process the next item in the queue
     */
    private processNext;
    /**
     * Process a single item
     */
    private processItem;
    /**
     * Check if path is currently locked
     */
    isLocked(path: string): boolean;
    /**
     * Check if there are pending items
     */
    hasPendingItems(): boolean;
    /**
     * Get queue statistics
     */
    getStats(): QueueStats;
    /**
     * Get all items for a specific path
     */
    getItemsForPath(path: string): QueueItem<T>[];
    /**
     * Clear completed and failed items older than maxAge
     */
    cleanup(maxAgeMs?: number): number;
    /**
     * Wait for all pending items to complete
     */
    drain(): Promise<void>;
    /**
     * Clear the queue
     */
    clear(): void;
}
/**
 * Simple mutex lock for file paths
 */
export declare class FileMutex {
    private locks;
    /**
     * Acquire lock for a path
     */
    acquire(path: string): Promise<void>;
    /**
     * Release lock for a path
     */
    release(path: string): void;
    /**
     * Check if path is locked
     */
    isLocked(path: string): boolean;
    /**
     * Execute with lock
     */
    withLock<T>(path: string, fn: () => Promise<T>): Promise<T>;
    /**
     * Get number of active locks
     */
    getActiveLockCount(): number;
    /**
     * Clear all locks (use with caution!)
     */
    clear(): void;
}
/**
 * Get the global file mutex
 */
export declare function getFileMutex(): FileMutex;
/**
 * Reset the global file mutex
 */
export declare function resetFileMutex(): void;
/**
 * Convenience function - acquire lock for path
 */
export declare function acquireFileLock(path: string): Promise<void>;
/**
 * Convenience function - release lock for path
 */
export declare function releaseFileLock(path: string): void;
/**
 * Convenience function - execute with file lock
 */
export declare function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T>;
/**
 * Configuration for atomic file lock
 */
export interface AtomicLockConfig {
    /** Max time to hold the lock in ms (default: 10000) */
    lockTimeoutMs?: number;
    /** Time between retry attempts in ms (default: 50) */
    retryIntervalMs?: number;
    /** Max number of retries (default: 100 = 5 seconds) */
    maxRetries?: number;
}
/**
 * Result of lock acquisition
 */
export interface AtomicLockResult {
    acquired: boolean;
    lockFile: string;
    /** Call this to release the lock */
    release: () => void;
}
/**
 * Acquire an atomic lock using O_EXCL flag
 * This is a TRUE cross-process lock that works even when multiple MCP instances
 * try to acquire the same lock simultaneously.
 *
 * @param lockPath - Path for the lock file (e.g., /path/to/socket.lock)
 * @param config - Lock configuration
 * @returns Lock result with release function
 */
export declare function acquireAtomicLock(lockPath: string, config?: AtomicLockConfig): Promise<AtomicLockResult>;
/**
 * Execute a function while holding an atomic lock
 * Ensures the lock is released even if the function throws.
 *
 * @param lockPath - Path for the lock file
 * @param fn - Function to execute while holding the lock
 * @param config - Lock configuration
 * @returns Result of the function, or throws if lock couldn't be acquired
 */
export declare function withAtomicLock<T>(lockPath: string, fn: () => Promise<T>, config?: AtomicLockConfig): Promise<T>;
/**
 * Create a directory atomically with cross-process locking
 * Prevents race conditions when multiple processes try to create the same directory.
 *
 * @param dirPath - Directory path to create
 * @param options - mkdir options (mode, etc.)
 * @returns true if directory was created, false if it already existed
 */
export declare function atomicMkdir(dirPath: string, options?: {
    mode?: number;
}): Promise<boolean>;
/**
 * Create a socket directory atomically - specialized for socket path creation
 * This is the main function to use when setting up socket directories.
 *
 * @param socketDir - Socket directory path
 * @returns true if directory was created, false if it already existed
 */
export declare function ensureSocketDirAtomic(socketDir: string): Promise<boolean>;
/**
 * Synchronous version of atomic lock acquisition
 * Uses busy-wait loop instead of async sleep - use sparingly!
 * This is needed for synchronous functions like getEmbeddingSocketPath()
 *
 * @param lockPath - Path for the lock file
 * @param config - Lock configuration (uses shorter timeouts for sync)
 * @returns Lock result with release function
 */
export declare function acquireAtomicLockSync(lockPath: string, config?: AtomicLockConfig): AtomicLockResult;
/**
 * Execute a synchronous function while holding an atomic lock
 *
 * @param lockPath - Path for the lock file
 * @param fn - Synchronous function to execute while holding the lock
 * @param config - Lock configuration
 * @returns Result of the function
 */
export declare function withAtomicLockSync<T>(lockPath: string, fn: () => T, config?: AtomicLockConfig): T;
/**
 * Synchronous version of atomicMkdir
 * Creates a directory atomically with cross-process locking
 *
 * @param dirPath - Directory path to create
 * @param options - mkdir options
 * @returns true if directory was created, false if it already existed
 */
export declare function atomicMkdirSync(dirPath: string, options?: {
    mode?: number;
}): boolean;
/**
 * Synchronous version of ensureSocketDirAtomic
 * Creates socket directory atomically - for use in synchronous config functions
 *
 * @param socketDir - Socket directory path
 * @returns true if directory was created, false if it already existed
 */
export declare function ensureSocketDirAtomicSync(socketDir: string): boolean;
//# sourceMappingURL=fileProcessingQueue.d.ts.map