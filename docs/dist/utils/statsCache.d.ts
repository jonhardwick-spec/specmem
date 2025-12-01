/**
 * statsCache.ts - In-Memory Cache with TTL for Dashboard Stats
 *
 * yo this cache keeps dashboard stats FAST
 * no more hammering the database every second
 * TTL-based invalidation fr fr
 *
 * Issue #39 fix - caching for dashboard stats
 */
/**
 * Cache statistics
 */
export interface CacheStats {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
    oldestEntry: number | null;
    newestEntry: number | null;
}
/**
 * StatsCache - TTL-based in-memory cache
 *
 * Features that GO CRAZY:
 * - TTL-based expiration
 * - Hit/miss tracking
 * - Auto-cleanup
 * - Type-safe generics
 */
export declare class StatsCache<T = unknown> {
    private cache;
    private defaultTtlMs;
    private maxEntries;
    private hits;
    private misses;
    private cleanupIntervalId;
    constructor(options?: {
        defaultTtlMs?: number;
        maxEntries?: number;
        cleanupIntervalMs?: number;
    });
    /**
     * Get a value from cache
     */
    get(key: string): T | undefined;
    /**
     * Set a value in cache
     */
    set(key: string, value: T, ttlMs?: number): void;
    /**
     * Get or set - returns cached value or calls factory and caches result
     */
    getOrSet(key: string, factory: () => Promise<T>, ttlMs?: number): Promise<T>;
    /**
     * Get or set (sync version)
     */
    getOrSetSync(key: string, factory: () => T, ttlMs?: number): T;
    /**
     * Delete a specific key
     */
    delete(key: string): boolean;
    /**
     * Delete all keys matching a pattern
     */
    deleteMatching(pattern: RegExp): number;
    /**
     * Clear all entries
     */
    clear(): void;
    /**
     * Check if key exists and is not expired
     */
    has(key: string): boolean;
    /**
     * Get cache statistics
     */
    getStats(): CacheStats;
    /**
     * Remove expired entries
     */
    cleanup(): number;
    /**
     * Evict oldest entry to make room
     */
    private evictOldest;
    /**
     * Get all keys
     */
    keys(): string[];
    /**
     * Shutdown - stop cleanup interval
     */
    shutdown(): void;
}
/**
 * Specialized cache for dashboard stats
 */
export declare class DashboardStatsCache {
    private cache;
    constructor(ttlSeconds?: number);
    /**
     * Get cached stats or compute them
     */
    getStats<T>(key: string, fetcher: () => Promise<T>, ttlSeconds?: number): Promise<T>;
    /**
     * Invalidate specific stats
     */
    invalidate(key: string): void;
    /**
     * Invalidate all stats matching pattern
     */
    invalidatePattern(pattern: string): number;
    /**
     * Invalidate all stats
     */
    invalidateAll(): void;
    /**
     * Get cache stats
     */
    getCacheStats(): CacheStats;
    /**
     * Shutdown
     */
    shutdown(): void;
}
/**
 * Get the global dashboard stats cache
 */
export declare function getDashboardCache(ttlSeconds?: number): DashboardStatsCache;
/**
 * Reset the global dashboard cache
 */
export declare function resetDashboardCache(): void;
//# sourceMappingURL=statsCache.d.ts.map