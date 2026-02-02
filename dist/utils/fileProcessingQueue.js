/**
 * fileProcessingQueue.ts - Race Condition Prevention for File Indexing
 *
 * yo this queue ensures only one process indexes a file at a time
 * no more race conditions when multiple events fire fr fr
 * mutex per file path - enterprise grade locking
 *
 * Issue #16 fix - race condition in file indexing
 */
import { logger } from './logger.js';
/**
 * Queue item status
 */
export var QueueItemStatus;
(function (QueueItemStatus) {
    QueueItemStatus["PENDING"] = "PENDING";
    QueueItemStatus["PROCESSING"] = "PROCESSING";
    QueueItemStatus["COMPLETED"] = "COMPLETED";
    QueueItemStatus["FAILED"] = "FAILED";
})(QueueItemStatus || (QueueItemStatus = {}));
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
export class FileProcessingQueue {
    queue = new Map();
    pathLocks = new Map();
    processing = new Set();
    processingTimes = [];
    maxConcurrent;
    maxRetries;
    processor;
    isProcessing = false;
    itemCounter = 0;
    constructor(options) {
        this.processor = options.processor;
        this.maxConcurrent = options.maxConcurrent ?? 5;
        this.maxRetries = options.maxRetries ?? 3;
    }
    /**
     * Add an item to the queue
     * Returns false if the path is already queued/processing
     */
    async enqueue(path, data) {
        // Check if path is already locked or queued
        if (this.pathLocks.get(path)) {
            logger.debug({ path }, 'path already being processed, skipping');
            return false;
        }
        // Check if item for this path already exists
        const existingItem = Array.from(this.queue.values()).find(item => item.path === path && item.status === QueueItemStatus.PENDING);
        if (existingItem) {
            logger.debug({ path }, 'path already queued, skipping');
            return false;
        }
        const id = `item-${++this.itemCounter}`;
        const item = {
            id,
            path,
            data,
            status: QueueItemStatus.PENDING,
            addedAt: Date.now(),
            retryCount: 0
        };
        this.queue.set(id, item);
        logger.debug({ id, path }, 'item queued');
        // Trigger processing
        this.processNext();
        return true;
    }
    /**
     * Process the next item in the queue
     */
    async processNext() {
        if (this.isProcessing)
            return;
        if (this.processing.size >= this.maxConcurrent)
            return;
        // Find next pending item
        const pendingItems = Array.from(this.queue.values())
            .filter(item => item.status === QueueItemStatus.PENDING &&
            !this.pathLocks.get(item.path))
            .sort((a, b) => a.addedAt - b.addedAt);
        if (pendingItems.length === 0)
            return;
        this.isProcessing = true;
        // Process multiple items up to maxConcurrent
        const toProcess = pendingItems.slice(0, this.maxConcurrent - this.processing.size);
        await Promise.all(toProcess.map(item => this.processItem(item)));
        this.isProcessing = false;
        // Check if there are more items to process
        if (this.hasPendingItems()) {
            setImmediate(() => this.processNext());
        }
    }
    /**
     * Process a single item
     */
    async processItem(item) {
        // Acquire lock
        this.pathLocks.set(item.path, true);
        this.processing.add(item.id);
        item.status = QueueItemStatus.PROCESSING;
        item.startedAt = Date.now();
        logger.debug({ id: item.id, path: item.path }, 'processing started');
        try {
            await this.processor(item.path, item.data);
            item.status = QueueItemStatus.COMPLETED;
            item.completedAt = Date.now();
            // Track processing time
            const processingTime = item.completedAt - item.startedAt;
            this.processingTimes.push(processingTime);
            if (this.processingTimes.length > 100) {
                this.processingTimes.shift();
            }
            logger.debug({
                id: item.id,
                path: item.path,
                durationMs: processingTime
            }, 'processing completed');
        }
        catch (error) {
            item.error = error instanceof Error ? error.message : 'Unknown error';
            if (item.retryCount < this.maxRetries) {
                // Retry with backoff
                item.retryCount++;
                item.status = QueueItemStatus.PENDING;
                const backoffMs = Math.pow(2, item.retryCount) * 1000;
                logger.warn({
                    id: item.id,
                    path: item.path,
                    error: item.error,
                    retryCount: item.retryCount,
                    backoffMs
                }, 'processing failed, scheduling retry');
                setTimeout(() => {
                    // Re-add to queue for retry
                    item.status = QueueItemStatus.PENDING;
                    this.processNext();
                }, backoffMs);
            }
            else {
                item.status = QueueItemStatus.FAILED;
                item.completedAt = Date.now();
                logger.error({
                    id: item.id,
                    path: item.path,
                    error: item.error,
                    retryCount: item.retryCount
                }, 'processing failed permanently');
            }
        }
        finally {
            // Release lock
            this.pathLocks.delete(item.path);
            this.processing.delete(item.id);
        }
    }
    /**
     * Check if path is currently locked
     */
    isLocked(path) {
        return this.pathLocks.get(path) === true;
    }
    /**
     * Check if there are pending items
     */
    hasPendingItems() {
        return Array.from(this.queue.values()).some(item => item.status === QueueItemStatus.PENDING);
    }
    /**
     * Get queue statistics
     */
    getStats() {
        const items = Array.from(this.queue.values());
        const pending = items.filter(i => i.status === QueueItemStatus.PENDING).length;
        const processing = items.filter(i => i.status === QueueItemStatus.PROCESSING).length;
        const completed = items.filter(i => i.status === QueueItemStatus.COMPLETED).length;
        const failed = items.filter(i => i.status === QueueItemStatus.FAILED).length;
        const avgTime = this.processingTimes.length > 0
            ? this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length
            : 0;
        return {
            pending,
            processing,
            completed,
            failed,
            total: items.length,
            lockedPaths: this.pathLocks.size,
            avgProcessingTimeMs: avgTime
        };
    }
    /**
     * Get all items for a specific path
     */
    getItemsForPath(path) {
        return Array.from(this.queue.values()).filter(item => item.path === path);
    }
    /**
     * Clear completed and failed items older than maxAge
     */
    cleanup(maxAgeMs = 300000) {
        const cutoff = Date.now() - maxAgeMs;
        let removed = 0;
        for (const [id, item] of this.queue) {
            if ((item.status === QueueItemStatus.COMPLETED ||
                item.status === QueueItemStatus.FAILED) &&
                item.completedAt &&
                item.completedAt < cutoff) {
                this.queue.delete(id);
                removed++;
            }
        }
        if (removed > 0) {
            logger.debug({ removed }, 'cleaned up old queue items');
        }
        return removed;
    }
    /**
     * Wait for all pending items to complete
     */
    async drain() {
        while (this.hasPendingItems() || this.processing.size > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    /**
     * Clear the queue
     */
    clear() {
        this.queue.clear();
        this.pathLocks.clear();
        this.processing.clear();
    }
}
/**
 * Simple mutex lock for file paths
 */
export class FileMutex {
    locks = new Map();
    /**
     * Acquire lock for a path
     */
    async acquire(path) {
        let lockInfo = this.locks.get(path);
        if (!lockInfo) {
            lockInfo = { locked: false, waiters: [] };
            this.locks.set(path, lockInfo);
        }
        if (!lockInfo.locked) {
            lockInfo.locked = true;
            return;
        }
        // Wait for lock
        return new Promise(resolve => {
            lockInfo.waiters.push(resolve);
        });
    }
    /**
     * Release lock for a path
     */
    release(path) {
        const lockInfo = this.locks.get(path);
        if (!lockInfo)
            return;
        if (lockInfo.waiters.length > 0) {
            // Wake up next waiter
            const nextWaiter = lockInfo.waiters.shift();
            nextWaiter?.();
        }
        else {
            lockInfo.locked = false;
            // Clean up if no waiters
            this.locks.delete(path);
        }
    }
    /**
     * Check if path is locked
     */
    isLocked(path) {
        const lockInfo = this.locks.get(path);
        return lockInfo?.locked === true;
    }
    /**
     * Execute with lock
     */
    async withLock(path, fn) {
        await this.acquire(path);
        try {
            return await fn();
        }
        finally {
            this.release(path);
        }
    }
    /**
     * Get number of active locks
     */
    getActiveLockCount() {
        return Array.from(this.locks.values()).filter(l => l.locked).length;
    }
    /**
     * Clear all locks (use with caution!)
     */
    clear() {
        this.locks.clear();
    }
}
// Singleton instances
let queueInstance = null;
let mutexInstance = null;
/**
 * Get the global file mutex
 */
export function getFileMutex() {
    if (!mutexInstance) {
        mutexInstance = new FileMutex();
    }
    return mutexInstance;
}
/**
 * Reset the global file mutex
 */
export function resetFileMutex() {
    if (mutexInstance) {
        mutexInstance.clear();
    }
    mutexInstance = null;
}
/**
 * Convenience function - acquire lock for path
 */
export async function acquireFileLock(path) {
    return getFileMutex().acquire(path);
}
/**
 * Convenience function - release lock for path
 */
export function releaseFileLock(path) {
    return getFileMutex().release(path);
}
/**
 * Convenience function - execute with file lock
 */
export async function withFileLock(path, fn) {
    return getFileMutex().withLock(path, fn);
}
// =============================================================================
// CROSS-PROCESS ATOMIC FILE LOCK
// Uses O_EXCL flag for true atomic file creation - works across processes!
// This prevents race conditions when multiple MCP servers try to create
// the same socket directory or file simultaneously.
// =============================================================================
import * as fs from 'fs';
import * as path from 'path';
const DEFAULT_LOCK_CONFIG = {
    lockTimeoutMs: 10000,
    retryIntervalMs: 50,
    maxRetries: 100
};
/**
 * Check if a process with the given PID is still running
 */
function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e) {
        return e.code === 'EPERM';
    }
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
export async function acquireAtomicLock(lockPath, config = {}) {
    const cfg = { ...DEFAULT_LOCK_CONFIG, ...config };
    const lockDir = path.dirname(lockPath);
    if (!fs.existsSync(lockDir)) {
        try {
            fs.mkdirSync(lockDir, { recursive: true, mode: 0o755 });
        }
        catch (e) {
            // Directory may be created by another process - that's OK
        }
    }
    for (let attempt = 0; attempt < cfg.maxRetries; attempt++) {
        try {
            // O_EXCL ensures atomic creation - fails if file exists
            const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
            // Write lock metadata
            const lockData = JSON.stringify({
                pid: process.pid,
                timestamp: Date.now(),
                hostname: require('os').hostname()
            });
            fs.writeSync(fd, lockData);
            fs.closeSync(fd);
            logger.debug({ lockPath, attempt }, 'atomic lock acquired');
            // Return release function
            const release = () => {
                try {
                    // Only remove if we still own it
                    if (fs.existsSync(lockPath)) {
                        const content = fs.readFileSync(lockPath, 'utf-8');
                        const data = JSON.parse(content);
                        if (data.pid === process.pid) {
                            fs.unlinkSync(lockPath);
                            logger.debug({ lockPath }, 'atomic lock released');
                        }
                    }
                }
                catch (e) {
                    // Ignore cleanup errors
                }
            };
            return { acquired: true, lockFile: lockPath, release };
        }
        catch (e) {
            if (e.code === 'EEXIST') {
                // Lock file exists - check if it's stale
                try {
                    const content = fs.readFileSync(lockPath, 'utf-8');
                    const data = JSON.parse(content);
                    const ageMs = Date.now() - data.timestamp;
                    // If lock is older than timeout, it's stale
                    if (ageMs > cfg.lockTimeoutMs) {
                        logger.debug({ lockPath, ageMs, stalePid: data.pid }, 'removing stale atomic lock');
                        fs.unlinkSync(lockPath);
                        continue; // Retry immediately
                    }
                    // If lock holder is dead, remove it
                    if (!isProcessRunning(data.pid)) {
                        logger.debug({ lockPath, deadPid: data.pid }, 'removing atomic lock from dead process');
                        fs.unlinkSync(lockPath);
                        continue; // Retry immediately
                    }
                    // Active lock held by another process - wait and retry
                }
                catch (readErr) {
                    // Can't read lock file - try to remove it
                    try {
                        fs.unlinkSync(lockPath);
                        continue;
                    }
                    catch (unlinkErr) {
                        // Ignore
                    }
                }
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, cfg.retryIntervalMs));
            }
            else {
                // Unexpected error
                logger.error({ lockPath, error: e.message }, 'atomic lock acquisition failed');
                throw e;
            }
        }
    }
    logger.warn({ lockPath, maxRetries: cfg.maxRetries }, 'failed to acquire atomic lock after max retries');
    return { acquired: false, lockFile: lockPath, release: () => { } };
}
/**
 * Execute a function while holding an atomic lock
 * Ensures the lock is released even if the function throws.
 *
 * @param lockPath - Path for the lock file
 * @param fn - Function to execute while holding the lock
 * @param config - Lock configuration
 * @returns Result of the function, or throws if lock couldn't be acquired
 */
export async function withAtomicLock(lockPath, fn, config = {}) {
    const lock = await acquireAtomicLock(lockPath, config);
    if (!lock.acquired) {
        throw new Error(`Failed to acquire atomic lock: ${lockPath}`);
    }
    try {
        return await fn();
    }
    finally {
        lock.release();
    }
}
/**
 * Create a directory atomically with cross-process locking
 * Prevents race conditions when multiple processes try to create the same directory.
 *
 * @param dirPath - Directory path to create
 * @param options - mkdir options (mode, etc.)
 * @returns true if directory was created, false if it already existed
 */
export async function atomicMkdir(dirPath, options = {}) {
    // If directory already exists, return immediately
    if (fs.existsSync(dirPath)) {
        try {
            const stats = fs.statSync(dirPath);
            if (stats.isDirectory()) {
                return false; // Already exists
            }
        }
        catch (e) {
            // Stat failed - continue with creation attempt
        }
    }
    const lockPath = dirPath + '.mkdir.lock';
    return withAtomicLock(lockPath, async () => {
        // Double-check inside lock (another process may have created it)
        if (fs.existsSync(dirPath)) {
            try {
                const stats = fs.statSync(dirPath);
                if (stats.isDirectory()) {
                    return false;
                }
            }
            catch (e) {
                // Continue with creation
            }
        }
        // Create directory
        fs.mkdirSync(dirPath, { recursive: true, mode: options.mode ?? 0o755 });
        logger.debug({ dirPath }, 'atomically created directory');
        return true;
    });
}
/**
 * Create a socket directory atomically - specialized for socket path creation
 * This is the main function to use when setting up socket directories.
 *
 * @param socketDir - Socket directory path
 * @returns true if directory was created, false if it already existed
 */
export async function ensureSocketDirAtomic(socketDir) {
    return atomicMkdir(socketDir, { mode: 0o755 });
}
// =============================================================================
// SYNCHRONOUS CROSS-PROCESS ATOMIC FILE LOCK
// Same as async version but uses busy-wait for synchronous contexts (like config.ts)
// =============================================================================
/**
 * Synchronous version of atomic lock acquisition
 * Uses busy-wait loop instead of async sleep - use sparingly!
 * This is needed for synchronous functions like getEmbeddingSocketPath()
 *
 * @param lockPath - Path for the lock file
 * @param config - Lock configuration (uses shorter timeouts for sync)
 * @returns Lock result with release function
 */
export function acquireAtomicLockSync(lockPath, config = {}) {
    const cfg = {
        lockTimeoutMs: config.lockTimeoutMs ?? 5000, // Shorter default for sync
        retryIntervalMs: config.retryIntervalMs ?? 10, // Shorter intervals
        maxRetries: config.maxRetries ?? 50 // Fewer retries (500ms total)
    };
    const lockDir = path.dirname(lockPath);
    if (!fs.existsSync(lockDir)) {
        try {
            fs.mkdirSync(lockDir, { recursive: true, mode: 0o755 });
        }
        catch (e) {
            // Directory may be created by another process - that's OK
        }
    }
    for (let attempt = 0; attempt < cfg.maxRetries; attempt++) {
        try {
            // O_EXCL ensures atomic creation - fails if file exists
            const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
            // Write lock metadata
            const lockData = JSON.stringify({
                pid: process.pid,
                timestamp: Date.now(),
                hostname: require('os').hostname()
            });
            fs.writeSync(fd, lockData);
            fs.closeSync(fd);
            // Return release function
            const release = () => {
                try {
                    if (fs.existsSync(lockPath)) {
                        const content = fs.readFileSync(lockPath, 'utf-8');
                        const data = JSON.parse(content);
                        if (data.pid === process.pid) {
                            fs.unlinkSync(lockPath);
                        }
                    }
                }
                catch (e) {
                    // Ignore cleanup errors
                }
            };
            return { acquired: true, lockFile: lockPath, release };
        }
        catch (e) {
            if (e.code === 'EEXIST') {
                // Lock file exists - check if it's stale
                try {
                    const content = fs.readFileSync(lockPath, 'utf-8');
                    const data = JSON.parse(content);
                    const ageMs = Date.now() - data.timestamp;
                    // If lock is older than timeout, it's stale
                    if (ageMs > cfg.lockTimeoutMs) {
                        fs.unlinkSync(lockPath);
                        continue;
                    }
                    // If lock holder is dead, remove it
                    if (!isProcessRunning(data.pid)) {
                        fs.unlinkSync(lockPath);
                        continue;
                    }
                }
                catch (readErr) {
                    try {
                        fs.unlinkSync(lockPath);
                        continue;
                    }
                    catch (unlinkErr) {
                        // Ignore
                    }
                }
                // Busy-wait (NOT ideal but necessary for sync context)
                const waitUntil = Date.now() + cfg.retryIntervalMs;
                while (Date.now() < waitUntil) {
                    // Spin wait - releases GIL occasionally
                }
            }
            else {
                throw e;
            }
        }
    }
    return { acquired: false, lockFile: lockPath, release: () => { } };
}
/**
 * Execute a synchronous function while holding an atomic lock
 *
 * @param lockPath - Path for the lock file
 * @param fn - Synchronous function to execute while holding the lock
 * @param config - Lock configuration
 * @returns Result of the function
 */
export function withAtomicLockSync(lockPath, fn, config = {}) {
    const lock = acquireAtomicLockSync(lockPath, config);
    if (!lock.acquired) {
        throw new Error(`Failed to acquire atomic lock (sync): ${lockPath}`);
    }
    try {
        return fn();
    }
    finally {
        lock.release();
    }
}
/**
 * Synchronous version of atomicMkdir
 * Creates a directory atomically with cross-process locking
 *
 * @param dirPath - Directory path to create
 * @param options - mkdir options
 * @returns true if directory was created, false if it already existed
 */
export function atomicMkdirSync(dirPath, options = {}) {
    // If directory already exists, return immediately (no lock needed)
    if (fs.existsSync(dirPath)) {
        try {
            const stats = fs.statSync(dirPath);
            if (stats.isDirectory()) {
                return false;
            }
        }
        catch (e) {
            // Continue with creation attempt
        }
    }
    const lockPath = dirPath + '.mkdir.lock';
    return withAtomicLockSync(lockPath, () => {
        // Double-check inside lock (another process may have created it)
        if (fs.existsSync(dirPath)) {
            try {
                const stats = fs.statSync(dirPath);
                if (stats.isDirectory()) {
                    return false;
                }
            }
            catch (e) {
                // Continue with creation
            }
        }
        // Create directory
        fs.mkdirSync(dirPath, { recursive: true, mode: options.mode ?? 0o755 });
        return true;
    });
}
/**
 * Synchronous version of ensureSocketDirAtomic
 * Creates socket directory atomically - for use in synchronous config functions
 *
 * @param socketDir - Socket directory path
 * @returns true if directory was created, false if it already existed
 */
export function ensureSocketDirAtomicSync(socketDir) {
    return atomicMkdirSync(socketDir, { mode: 0o755 });
}
//# sourceMappingURL=fileProcessingQueue.js.map