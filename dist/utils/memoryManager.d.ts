/**
 * memoryManager.ts - RAM Memory Management for SpecMem MCP Server
 *
 * Implements 100MB RAM limit with PostgreSQL overflow for the specmem MCP server.
 * Features:
 * - Heap usage monitoring with configurable thresholds
 * - LRU eviction for embedding cache
 * - PostgreSQL overflow for cache persistence
 * - Memory pressure handler with graduated response
 * - Per-instance memory tracking for multi-session environments
 * - Automatic GC triggers when memory exceeds threshold
 *
 * @author hardwicksoftwareservices
 */
export interface MemoryConfig {
    /** Maximum heap memory in bytes (default: 100MB) */
    maxHeapBytes: number;
    /** Warning threshold percentage (default: 0.7 = 70%) */
    warningThreshold: number;
    /** Critical threshold percentage (default: 0.8 = 80%) - triggers overflow */
    criticalThreshold: number;
    /** Emergency threshold percentage (default: 0.9 = 90%) - aggressive eviction */
    emergencyThreshold: number;
    /** Check interval in milliseconds (default: 5000 = 5 seconds) */
    checkIntervalMs: number;
    /** Maximum entries in embedding cache before eviction (default: 1000) */
    maxCacheEntries: number;
}
export interface MemoryStats {
    /** Current heap used in bytes */
    heapUsed: number;
    /** Current heap total in bytes */
    heapTotal: number;
    /** Maximum configured heap in bytes */
    maxHeap: number;
    /** Heap usage percentage (0-1) */
    usagePercent: number;
    /** External memory used in bytes */
    external: number;
    /** Array buffers memory in bytes */
    arrayBuffers: number;
    /** RSS (Resident Set Size) in bytes */
    rss: number;
    /** Current pressure level */
    pressureLevel: 'normal' | 'warning' | 'critical' | 'emergency';
    /** Number of items in embedding cache */
    embeddingCacheSize: number;
    /** Number of items evicted since start */
    totalEvictions: number;
    /** Number of items moved to PostgreSQL overflow */
    totalOverflowed: number;
    /** Timestamp of last garbage collection */
    lastGC: Date | null;
    /** Uptime in milliseconds */
    uptime: number;
    /** Unique instance identifier */
    instanceId?: string;
    /** Project path this instance is serving */
    projectPath?: string;
    /** Number of automatic GC triggers */
    autoGCCount?: number;
}
/**
 * Per-instance memory snapshot for tracking
 */
export interface InstanceMemorySnapshot {
    instanceId: string;
    projectPath: string;
    timestamp: Date;
    heapUsed: number;
    heapTotal: number;
    rss: number;
    usagePercent: number;
    pressureLevel: PressureLevel;
    embeddingCacheSize: number;
    uptime: number;
    autoGCCount: number;
    warningActive: boolean;
}
/**
 * Aggregated stats across all instances
 */
export interface GlobalInstanceStats {
    totalInstances: number;
    totalHeapUsed: number;
    totalRss: number;
    averageUsagePercent: number;
    instancesInWarning: number;
    instancesInCritical: number;
    instancesInEmergency: number;
    instances: InstanceMemorySnapshot[];
}
export interface CacheEntry<T> {
    key: string;
    value: T;
    size: number;
    lastAccessed: number;
    accessCount: number;
    createdAt: number;
}
export type PressureLevel = 'normal' | 'warning' | 'critical' | 'emergency';
export interface OverflowHandler {
    /** Move data to PostgreSQL */
    moveToPostgres(entries: CacheEntry<number[]>[]): Promise<number>;
    /** Load data from PostgreSQL */
    loadFromPostgres(keys: string[]): Promise<Map<string, number[]>>;
    /** Clear overflow table */
    clearOverflow(): Promise<void>;
}
/**
 * Global registry for tracking memory usage across multiple SpecMem instances.
 * Uses a shared file-based mechanism to aggregate stats from all running instances.
 */
declare class InstanceMemoryRegistry {
    private static instance;
    private registryPath;
    private instanceId;
    private projectPath;
    private cleanupInterval;
    private readonly STALE_THRESHOLD_MS;
    private constructor();
    static getInstance(): InstanceMemoryRegistry;
    /**
     * Get this instance's unique ID
     */
    getInstanceId(): string;
    /**
     * Get the project path this instance is serving
     */
    getProjectPath(): string;
    /**
     * Register/update this instance's memory snapshot in the global registry
     */
    updateSnapshot(snapshot: Omit<InstanceMemorySnapshot, 'instanceId' | 'projectPath' | 'timestamp'>): Promise<void>;
    /**
     * Get all active instance snapshots
     */
    getAllInstances(): Promise<InstanceMemorySnapshot[]>;
    /**
     * Get aggregated stats across all instances
     */
    getGlobalStats(): Promise<GlobalInstanceStats>;
    /**
     * Remove this instance from the registry (called on shutdown)
     */
    unregister(): Promise<void>;
    /**
     * Start periodic cleanup of stale entries
     */
    startCleanup(): void;
    /**
     * Stop cleanup interval
     */
    stopCleanup(): void;
    private loadRegistry;
    private saveRegistry;
}
export declare function getInstanceRegistry(): InstanceMemoryRegistry;
/**
 * LRU Cache with size tracking for embedding vectors
 */
export declare class LRUCache<T> {
    private cache;
    private maxEntries;
    private totalSize;
    private evictionCount;
    constructor(maxEntries?: number);
    /**
     * Get an entry from the cache
     */
    get(key: string): T | undefined;
    /**
     * Set an entry in the cache
     */
    set(key: string, value: T, size?: number): void;
    /**
     * Check if key exists in cache
     */
    has(key: string): boolean;
    /**
     * Delete an entry from cache
     */
    delete(key: string): boolean;
    /**
     * Evict the oldest (least recently used) entry
     */
    private evictOldest;
    /**
     * Evict multiple oldest entries
     */
    evictMultiple(count: number): CacheEntry<T>[];
    /**
     * Evict entries until size is below threshold
     */
    evictUntilSize(maxSize: number): CacheEntry<T>[];
    /**
     * Get all entries (for overflow)
     */
    getAllEntries(): CacheEntry<T>[];
    /**
     * Get least recently used entries
     */
    getLRUEntries(count: number): CacheEntry<T>[];
    /**
     * Clear all entries
     */
    clear(): void;
    /**
     * Get cache statistics
     */
    getStats(): {
        size: number;
        totalSize: number;
        evictionCount: number;
        maxEntries: number;
    };
    get size(): number;
}
/**
 * Memory Manager for SpecMem MCP Server
 *
 * Monitors heap usage and implements overflow to PostgreSQL when approaching limits.
 * Now with per-instance tracking and automatic GC triggers.
 */
export declare class MemoryManager {
    private config;
    private embeddingCache;
    private overflowHandler;
    private checkInterval;
    private startTime;
    private lastGC;
    private totalOverflowed;
    private pressureLevel;
    private listeners;
    private instanceRegistry;
    private autoGCCount;
    private warningEmitted;
    private readonly AUTO_GC_THRESHOLD;
    private readonly GC_COOLDOWN_MS;
    private lastAutoGC;
    constructor(config?: Partial<MemoryConfig>);
    /**
     * Initialize memory monitoring
     */
    initialize(): void;
    /**
     * Get this instance's unique identifier
     */
    getInstanceId(): string;
    /**
     * Get the project path this instance is serving
     */
    getProjectPath(): string;
    /**
     * Get stats for all active SpecMem instances
     */
    getGlobalInstanceStats(): Promise<GlobalInstanceStats>;
    /**
     * Set overflow handler for PostgreSQL persistence
     */
    setOverflowHandler(handler: OverflowHandler): void;
    /**
     * Check current memory pressure and take action
     */
    private checkMemoryPressure;
    /**
     * Trigger automatic garbage collection when memory is getting high
     */
    private triggerAutoGC;
    /**
     * Emit a warning when memory exceeds threshold
     */
    private emitMemoryWarning;
    /**
     * Update the instance registry with current memory snapshot
     */
    private updateInstanceSnapshot;
    /**
     * Handle warning pressure (70-80%)
     */
    private handleWarningPressure;
    /**
     * Handle critical pressure (80-90%) - move to PostgreSQL
     */
    private handleCriticalPressure;
    /**
     * Handle emergency pressure (90%+) - aggressive eviction
     */
    private handleEmergencyPressure;
    /**
     * Move cache entries to PostgreSQL overflow
     */
    private moveToOverflow;
    /**
     * Force garbage collection if available
     */
    private forceGC;
    /**
     * Get current memory statistics
     */
    getStats(): MemoryStats;
    /**
     * Get embedding from cache or load from overflow
     */
    getEmbedding(key: string): Promise<number[] | undefined>;
    /**
     * Store embedding in cache
     */
    setEmbedding(key: string, embedding: number[]): void;
    /**
     * Check if embedding exists in cache
     */
    hasEmbedding(key: string): boolean;
    /**
     * Clear all caches
     */
    clearCaches(): void;
    /**
     * Add event listener for memory stats updates
     */
    on(event: 'stats', listener: (stats: MemoryStats) => void): void;
    /**
     * Notify listeners of stats update
     */
    private notifyListeners;
    /**
     * Shutdown memory manager
     */
    shutdown(): Promise<void>;
    /**
     * Force an immediate garbage collection (if available)
     * Returns true if GC was triggered, false if not available
     */
    triggerGC(): boolean;
    /**
     * Get the auto GC trigger count
     */
    getAutoGCCount(): number;
}
/**
 * Get the global memory manager
 */
export declare function getMemoryManager(config?: Partial<MemoryConfig>): MemoryManager;
/**
 * Reset the global memory manager (for testing)
 */
export declare function resetMemoryManager(): Promise<void>;
export {};
//# sourceMappingURL=memoryManager.d.ts.map