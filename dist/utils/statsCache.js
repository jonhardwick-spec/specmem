/**
 * statsCache.ts - In-Memory Cache with TTL for Dashboard Stats
 *
 * yo this cache keeps dashboard stats FAST
 * no more hammering the database every second
 * TTL-based invalidation fr fr
 *
 * Issue #39 fix - caching for dashboard stats
 */
import { logger } from './logger.js';
/**
 * StatsCache - TTL-based in-memory cache
 *
 * Features that GO CRAZY:
 * - TTL-based expiration
 * - Hit/miss tracking
 * - Auto-cleanup
 * - Type-safe generics
 */
export class StatsCache {
    cache = new Map();
    defaultTtlMs;
    maxEntries;
    hits = 0;
    misses = 0;
    cleanupIntervalId = null;
    constructor(options = {}) {
        this.defaultTtlMs = options.defaultTtlMs ?? 30000; // 30 seconds default
        this.maxEntries = options.maxEntries ?? 1000;
        // Start cleanup interval if specified
        const cleanupInterval = options.cleanupIntervalMs ?? 60000; // 1 minute
        if (cleanupInterval > 0) {
            this.cleanupIntervalId = setInterval(() => {
                this.cleanup();
            }, cleanupInterval);
            // Don't let cleanup interval prevent process exit
            this.cleanupIntervalId.unref?.();
        }
    }
    /**
     * Get a value from cache
     */
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return undefined;
        }
        // Check expiration
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            this.misses++;
            return undefined;
        }
        // Cache hit!
        entry.hits++;
        this.hits++;
        return entry.value;
    }
    /**
     * Set a value in cache
     */
    set(key, value, ttlMs) {
        // Enforce max entries
        if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
            this.evictOldest();
        }
        const now = Date.now();
        const ttl = ttlMs ?? this.defaultTtlMs;
        this.cache.set(key, {
            value,
            createdAt: now,
            expiresAt: now + ttl,
            hits: 0
        });
    }
    /**
     * Get or set - returns cached value or calls factory and caches result
     */
    async getOrSet(key, factory, ttlMs) {
        const cached = this.get(key);
        if (cached !== undefined) {
            return cached;
        }
        // Not in cache - call factory
        const value = await factory();
        this.set(key, value, ttlMs);
        return value;
    }
    /**
     * Get or set (sync version)
     */
    getOrSetSync(key, factory, ttlMs) {
        const cached = this.get(key);
        if (cached !== undefined) {
            return cached;
        }
        const value = factory();
        this.set(key, value, ttlMs);
        return value;
    }
    /**
     * Delete a specific key
     */
    delete(key) {
        return this.cache.delete(key);
    }
    /**
     * Delete all keys matching a pattern
     */
    deleteMatching(pattern) {
        let deleted = 0;
        for (const key of this.cache.keys()) {
            if (pattern.test(key)) {
                this.cache.delete(key);
                deleted++;
            }
        }
        return deleted;
    }
    /**
     * Clear all entries
     */
    clear() {
        this.cache.clear();
        logger.debug('stats cache cleared');
    }
    /**
     * Check if key exists and is not expired
     */
    has(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return false;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }
    /**
     * Get cache statistics
     */
    getStats() {
        const total = this.hits + this.misses;
        let oldest = null;
        let newest = null;
        for (const entry of this.cache.values()) {
            if (oldest === null || entry.createdAt < oldest) {
                oldest = entry.createdAt;
            }
            if (newest === null || entry.createdAt > newest) {
                newest = entry.createdAt;
            }
        }
        return {
            size: this.cache.size,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0,
            oldestEntry: oldest,
            newestEntry: newest
        };
    }
    /**
     * Remove expired entries
     */
    cleanup() {
        const now = Date.now();
        let removed = 0;
        for (const [key, entry] of this.cache) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
                removed++;
            }
        }
        if (removed > 0) {
            logger.debug({ removed }, 'cleaned up expired cache entries');
        }
        return removed;
    }
    /**
     * Evict oldest entry to make room
     */
    evictOldest() {
        let oldestKey = null;
        let oldestTime = Infinity;
        for (const [key, entry] of this.cache) {
            if (entry.createdAt < oldestTime) {
                oldestTime = entry.createdAt;
                oldestKey = key;
            }
        }
        if (oldestKey) {
            this.cache.delete(oldestKey);
            logger.debug({ key: oldestKey }, 'evicted oldest cache entry');
        }
    }
    /**
     * Get all keys
     */
    keys() {
        return Array.from(this.cache.keys());
    }
    /**
     * Shutdown - stop cleanup interval
     */
    shutdown() {
        if (this.cleanupIntervalId) {
            clearInterval(this.cleanupIntervalId);
            this.cleanupIntervalId = null;
        }
        this.cache.clear();
    }
}
/**
 * Specialized cache for dashboard stats
 */
export class DashboardStatsCache {
    cache;
    constructor(ttlSeconds = 30) {
        this.cache = new StatsCache({
            defaultTtlMs: ttlSeconds * 1000,
            maxEntries: 100,
            cleanupIntervalMs: 60000
        });
    }
    /**
     * Get cached stats or compute them
     */
    async getStats(key, fetcher, ttlSeconds) {
        return this.cache.getOrSet(`stats:${key}`, fetcher, ttlSeconds ? ttlSeconds * 1000 : undefined);
    }
    /**
     * Invalidate specific stats
     */
    invalidate(key) {
        this.cache.delete(`stats:${key}`);
    }
    /**
     * Invalidate all stats matching pattern
     */
    invalidatePattern(pattern) {
        return this.cache.deleteMatching(new RegExp(`^stats:.*${pattern}.*`));
    }
    /**
     * Invalidate all stats
     */
    invalidateAll() {
        this.cache.deleteMatching(/^stats:/);
    }
    /**
     * Get cache stats
     */
    getCacheStats() {
        return this.cache.getStats();
    }
    /**
     * Shutdown
     */
    shutdown() {
        this.cache.shutdown();
    }
}
// Singleton for dashboard stats
let dashboardCacheInstance = null;
/**
 * Get the global dashboard stats cache
 */
export function getDashboardCache(ttlSeconds) {
    if (!dashboardCacheInstance) {
        dashboardCacheInstance = new DashboardStatsCache(ttlSeconds);
    }
    return dashboardCacheInstance;
}
/**
 * Reset the global dashboard cache
 */
export function resetDashboardCache() {
    if (dashboardCacheInstance) {
        dashboardCacheInstance.shutdown();
    }
    dashboardCacheInstance = null;
}
//# sourceMappingURL=statsCache.js.map