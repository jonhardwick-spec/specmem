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
import { logger } from './logger.js';
import { randomBytes } from 'crypto';
// ============================================================================
// Default Configuration
// ============================================================================
// Memory thresholds now configurable via SPECMEM_MAX_HEAP_MB env var (default 100MB)
const DEFAULT_CONFIG = {
    maxHeapBytes: parseInt(process.env['SPECMEM_MAX_HEAP_MB'] || '100', 10) * 1024 * 1024, // 100MB default
    warningThreshold: 0.6, // 60% - earlier warning
    criticalThreshold: 0.7, // 70% - earlier overflow trigger
    emergencyThreshold: 0.8, // 80% - earlier aggressive eviction
    checkIntervalMs: 3000, // 3 seconds - check more often
    maxCacheEntries: 500 // reduced from 1000
};
// ============================================================================
// Instance Memory Registry - Tracks memory across all SpecMem instances
// ============================================================================
/**
 * Global registry for tracking memory usage across multiple SpecMem instances.
 * Uses a shared file-based mechanism to aggregate stats from all running instances.
 */
class InstanceMemoryRegistry {
    static instance = null;
    registryPath;
    instanceId;
    projectPath;
    cleanupInterval = null;
    STALE_THRESHOLD_MS = 30000; // 30 seconds - consider instance stale if no update
    constructor() {
        // Generate unique instance ID
        this.instanceId = `specmem-${randomBytes(4).toString('hex')}-${process.pid}`;
        this.projectPath = process.cwd();
        // Registry stored in temp dir for cross-process visibility
        const tmpDir = process.env['SPECMEM_TEMP_DIR'] || '/tmp';
        this.registryPath = `${tmpDir}/specmem-instance-registry.json`;
    }
    static getInstance() {
        if (!InstanceMemoryRegistry.instance) {
            InstanceMemoryRegistry.instance = new InstanceMemoryRegistry();
        }
        return InstanceMemoryRegistry.instance;
    }
    /**
     * Get this instance's unique ID
     */
    getInstanceId() {
        return this.instanceId;
    }
    /**
     * Get the project path this instance is serving
     */
    getProjectPath() {
        return this.projectPath;
    }
    /**
     * Register/update this instance's memory snapshot in the global registry
     */
    async updateSnapshot(snapshot) {
        try {
            const registry = await this.loadRegistry();
            // Update our entry
            registry[this.instanceId] = {
                instanceId: this.instanceId,
                projectPath: this.projectPath,
                timestamp: new Date(),
                ...snapshot
            };
            await this.saveRegistry(registry);
        }
        catch (error) {
            // Non-fatal - log and continue
            logger.debug({ error, instanceId: this.instanceId }, 'Failed to update instance registry');
        }
    }
    /**
     * Get all active instance snapshots
     */
    async getAllInstances() {
        try {
            const registry = await this.loadRegistry();
            const now = Date.now();
            const activeInstances = [];
            for (const [id, snapshot] of Object.entries(registry)) {
                const snapshotTime = new Date(snapshot.timestamp).getTime();
                // Only include instances that have updated recently
                if (now - snapshotTime < this.STALE_THRESHOLD_MS) {
                    activeInstances.push(snapshot);
                }
            }
            return activeInstances;
        }
        catch (error) {
            logger.debug({ error }, 'Failed to load instance registry');
            return [];
        }
    }
    /**
     * Get aggregated stats across all instances
     */
    async getGlobalStats() {
        const instances = await this.getAllInstances();
        if (instances.length === 0) {
            return {
                totalInstances: 0,
                totalHeapUsed: 0,
                totalRss: 0,
                averageUsagePercent: 0,
                instancesInWarning: 0,
                instancesInCritical: 0,
                instancesInEmergency: 0,
                instances: []
            };
        }
        const stats = {
            totalInstances: instances.length,
            totalHeapUsed: instances.reduce((sum, i) => sum + i.heapUsed, 0),
            totalRss: instances.reduce((sum, i) => sum + i.rss, 0),
            averageUsagePercent: instances.reduce((sum, i) => sum + i.usagePercent, 0) / instances.length,
            instancesInWarning: instances.filter(i => i.pressureLevel === 'warning').length,
            instancesInCritical: instances.filter(i => i.pressureLevel === 'critical').length,
            instancesInEmergency: instances.filter(i => i.pressureLevel === 'emergency').length,
            instances
        };
        return stats;
    }
    /**
     * Remove this instance from the registry (called on shutdown)
     */
    async unregister() {
        try {
            const registry = await this.loadRegistry();
            delete registry[this.instanceId];
            await this.saveRegistry(registry);
        }
        catch (error) {
            logger.debug({ error }, 'Failed to unregister instance');
        }
    }
    /**
     * Start periodic cleanup of stale entries
     */
    startCleanup() {
        if (this.cleanupInterval)
            return;
        this.cleanupInterval = setInterval(async () => {
            try {
                const registry = await this.loadRegistry();
                const now = Date.now();
                let cleaned = 0;
                for (const [id, snapshot] of Object.entries(registry)) {
                    const snapshotTime = new Date(snapshot.timestamp).getTime();
                    if (now - snapshotTime > this.STALE_THRESHOLD_MS * 2) {
                        delete registry[id];
                        cleaned++;
                    }
                }
                if (cleaned > 0) {
                    await this.saveRegistry(registry);
                    logger.debug({ cleaned }, 'Cleaned stale instance entries');
                }
            }
            catch (error) {
                // Ignore cleanup errors
            }
        }, this.STALE_THRESHOLD_MS);
    }
    /**
     * Stop cleanup interval
     */
    stopCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
    async loadRegistry() {
        const fs = await import('fs/promises');
        try {
            const data = await fs.readFile(this.registryPath, 'utf8');
            return JSON.parse(data);
        }
        catch (error) {
            // File doesn't exist or is corrupted - start fresh
            return {};
        }
    }
    async saveRegistry(registry) {
        const fs = await import('fs/promises');
        await fs.writeFile(this.registryPath, JSON.stringify(registry, null, 2), 'utf8');
    }
}
// Export singleton getter
export function getInstanceRegistry() {
    return InstanceMemoryRegistry.getInstance();
}
// ============================================================================
// LRU Cache Implementation
// ============================================================================
/**
 * LRU Cache with size tracking for embedding vectors
 */
export class LRUCache {
    cache = new Map();
    maxEntries;
    totalSize = 0;
    evictionCount = 0;
    constructor(maxEntries = 1000) {
        this.maxEntries = maxEntries;
    }
    /**
     * Get an entry from the cache
     */
    get(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return undefined;
        // Update access stats (LRU touch)
        entry.lastAccessed = Date.now();
        entry.accessCount++;
        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }
    /**
     * Set an entry in the cache
     */
    set(key, value, size = 0) {
        // Remove existing entry if present
        if (this.cache.has(key)) {
            const existing = this.cache.get(key);
            this.totalSize -= existing.size;
            this.cache.delete(key);
        }
        // Evict oldest entries if at capacity
        while (this.cache.size >= this.maxEntries) {
            this.evictOldest();
        }
        const entry = {
            key,
            value,
            size,
            lastAccessed: Date.now(),
            accessCount: 1,
            createdAt: Date.now()
        };
        this.cache.set(key, entry);
        this.totalSize += size;
    }
    /**
     * Check if key exists in cache
     */
    has(key) {
        return this.cache.has(key);
    }
    /**
     * Delete an entry from cache
     */
    delete(key) {
        const entry = this.cache.get(key);
        if (entry) {
            this.totalSize -= entry.size;
            return this.cache.delete(key);
        }
        return false;
    }
    /**
     * Evict the oldest (least recently used) entry
     */
    evictOldest() {
        // First entry is the oldest (LRU)
        const firstKey = this.cache.keys().next().value;
        if (firstKey) {
            const entry = this.cache.get(firstKey);
            this.cache.delete(firstKey);
            this.totalSize -= entry.size;
            this.evictionCount++;
            return entry;
        }
        return undefined;
    }
    /**
     * Evict multiple oldest entries
     */
    evictMultiple(count) {
        const evicted = [];
        for (let i = 0; i < count && this.cache.size > 0; i++) {
            const entry = this.evictOldest();
            if (entry)
                evicted.push(entry);
        }
        return evicted;
    }
    /**
     * Evict entries until size is below threshold
     */
    evictUntilSize(maxSize) {
        const evicted = [];
        while (this.totalSize > maxSize && this.cache.size > 0) {
            const entry = this.evictOldest();
            if (entry)
                evicted.push(entry);
        }
        return evicted;
    }
    /**
     * Get all entries (for overflow)
     */
    getAllEntries() {
        return Array.from(this.cache.values());
    }
    /**
     * Get least recently used entries
     */
    getLRUEntries(count) {
        const entries = [];
        for (const entry of this.cache.values()) {
            entries.push(entry);
            if (entries.length >= count)
                break;
        }
        return entries;
    }
    /**
     * Clear all entries
     */
    clear() {
        this.cache.clear();
        this.totalSize = 0;
    }
    /**
     * Get cache statistics
     */
    getStats() {
        return {
            size: this.cache.size,
            totalSize: this.totalSize,
            evictionCount: this.evictionCount,
            maxEntries: this.maxEntries
        };
    }
    get size() {
        return this.cache.size;
    }
}
// ============================================================================
// Memory Manager
// ============================================================================
/**
 * Memory Manager for SpecMem MCP Server
 *
 * Monitors heap usage and implements overflow to PostgreSQL when approaching limits.
 * Now with per-instance tracking and automatic GC triggers.
 */
export class MemoryManager {
    config;
    embeddingCache;
    overflowHandler = null;
    checkInterval = null;
    startTime = Date.now();
    lastGC = null;
    totalOverflowed = 0;
    pressureLevel = 'normal';
    listeners = new Map();
    // Instance tracking
    instanceRegistry;
    autoGCCount = 0;
    warningEmitted = false;
    // Auto GC configuration
    AUTO_GC_THRESHOLD = 0.75; // Trigger GC at 75% usage
    GC_COOLDOWN_MS = 10000; // Minimum 10s between auto GC
    lastAutoGC = 0;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.embeddingCache = new LRUCache(this.config.maxCacheEntries);
        this.instanceRegistry = getInstanceRegistry();
    }
    /**
     * Initialize memory monitoring
     */
    initialize() {
        logger.info({
            maxHeapMB: Math.round(this.config.maxHeapBytes / 1024 / 1024),
            warningThreshold: `${this.config.warningThreshold * 100}%`,
            criticalThreshold: `${this.config.criticalThreshold * 100}%`,
            emergencyThreshold: `${this.config.emergencyThreshold * 100}%`,
            checkIntervalMs: this.config.checkIntervalMs,
            instanceId: this.instanceRegistry.getInstanceId(),
            projectPath: this.instanceRegistry.getProjectPath()
        }, 'Memory manager initializing with instance tracking');
        // Start instance registry cleanup
        this.instanceRegistry.startCleanup();
        // Start periodic memory checks
        this.checkInterval = setInterval(() => {
            this.checkMemoryPressure();
        }, this.config.checkIntervalMs);
        // Initial check
        this.checkMemoryPressure();
        logger.info({
            instanceId: this.instanceRegistry.getInstanceId()
        }, 'Memory manager initialized');
    }
    /**
     * Get this instance's unique identifier
     */
    getInstanceId() {
        return this.instanceRegistry.getInstanceId();
    }
    /**
     * Get the project path this instance is serving
     */
    getProjectPath() {
        return this.instanceRegistry.getProjectPath();
    }
    /**
     * Get stats for all active SpecMem instances
     */
    async getGlobalInstanceStats() {
        return this.instanceRegistry.getGlobalStats();
    }
    /**
     * Set overflow handler for PostgreSQL persistence
     */
    setOverflowHandler(handler) {
        this.overflowHandler = handler;
        logger.info('Overflow handler connected');
    }
    /**
     * Check current memory pressure and take action
     */
    async checkMemoryPressure() {
        const stats = this.getStats();
        const previousLevel = this.pressureLevel;
        // Determine pressure level
        if (stats.usagePercent >= this.config.emergencyThreshold) {
            this.pressureLevel = 'emergency';
        }
        else if (stats.usagePercent >= this.config.criticalThreshold) {
            this.pressureLevel = 'critical';
        }
        else if (stats.usagePercent >= this.config.warningThreshold) {
            this.pressureLevel = 'warning';
        }
        else {
            this.pressureLevel = 'normal';
            this.warningEmitted = false; // Reset warning state when back to normal
        }
        // Log level changes
        if (previousLevel !== this.pressureLevel) {
            logger.warn({
                previousLevel,
                currentLevel: this.pressureLevel,
                heapUsedMB: Math.round(stats.heapUsed / 1024 / 1024),
                usagePercent: `${(stats.usagePercent * 100).toFixed(1)}%`,
                instanceId: this.instanceRegistry.getInstanceId()
            }, 'Memory pressure level changed');
        }
        // Emit warning when threshold exceeded (once per warning state)
        if (this.pressureLevel !== 'normal' && !this.warningEmitted) {
            this.emitMemoryWarning(stats);
            this.warningEmitted = true;
        }
        // Auto GC trigger - when approaching threshold but not yet in warning
        if (stats.usagePercent >= this.AUTO_GC_THRESHOLD && stats.usagePercent < this.config.warningThreshold) {
            this.triggerAutoGC();
        }
        // Take action based on pressure level
        switch (this.pressureLevel) {
            case 'emergency':
                await this.handleEmergencyPressure(stats);
                break;
            case 'critical':
                await this.handleCriticalPressure(stats);
                break;
            case 'warning':
                await this.handleWarningPressure(stats);
                break;
            default:
                // Normal - no action needed
                break;
        }
        // Update instance registry with current snapshot
        await this.updateInstanceSnapshot(stats);
        // Notify listeners
        this.notifyListeners(stats);
    }
    /**
     * Trigger automatic garbage collection when memory is getting high
     */
    triggerAutoGC() {
        const now = Date.now();
        // Respect cooldown period
        if (now - this.lastAutoGC < this.GC_COOLDOWN_MS) {
            return;
        }
        if (global.gc) {
            this.lastAutoGC = now;
            this.autoGCCount++;
            global.gc();
            this.lastGC = new Date();
            logger.info({
                autoGCCount: this.autoGCCount,
                instanceId: this.instanceRegistry.getInstanceId()
            }, 'Automatic GC triggered (preventive)');
        }
    }
    /**
     * Emit a warning when memory exceeds threshold
     */
    emitMemoryWarning(stats) {
        const warningData = {
            instanceId: this.instanceRegistry.getInstanceId(),
            projectPath: this.instanceRegistry.getProjectPath(),
            heapUsedMB: Math.round(stats.heapUsed / 1024 / 1024),
            maxHeapMB: Math.round(stats.maxHeap / 1024 / 1024),
            usagePercent: `${(stats.usagePercent * 100).toFixed(1)}%`,
            pressureLevel: this.pressureLevel,
            rssMB: Math.round(stats.rss / 1024 / 1024)
        };
        logger.warn(warningData, 'MEMORY WARNING: Instance exceeding threshold');
        // Also emit to stderr for visibility in Claude Code CLI
        process.stderr.write(`\n[SpecMem] MEMORY WARNING: Instance ${warningData.instanceId} at ${warningData.usagePercent} usage (${warningData.heapUsedMB}MB / ${warningData.maxHeapMB}MB)\n`);
    }
    /**
     * Update the instance registry with current memory snapshot
     */
    async updateInstanceSnapshot(stats) {
        const cacheStats = this.embeddingCache.getStats();
        await this.instanceRegistry.updateSnapshot({
            heapUsed: stats.heapUsed,
            heapTotal: stats.heapTotal,
            rss: stats.rss,
            usagePercent: stats.usagePercent,
            pressureLevel: this.pressureLevel,
            embeddingCacheSize: cacheStats.size,
            uptime: Date.now() - this.startTime,
            autoGCCount: this.autoGCCount,
            warningActive: this.pressureLevel !== 'normal'
        });
    }
    /**
     * Handle warning pressure (70-80%)
     */
    async handleWarningPressure(stats) {
        logger.debug({
            heapUsedMB: Math.round(stats.heapUsed / 1024 / 1024),
            cacheSize: this.embeddingCache.size
        }, 'Warning pressure - light eviction');
        // Evict 10% of cache entries
        const toEvict = Math.max(1, Math.floor(this.embeddingCache.size * 0.1));
        const evicted = this.embeddingCache.evictMultiple(toEvict);
        if (evicted.length > 0) {
            logger.debug({ evicted: evicted.length }, 'Evicted cache entries');
        }
    }
    /**
     * Handle critical pressure (80-90%) - move to PostgreSQL
     */
    async handleCriticalPressure(stats) {
        logger.warn({
            heapUsedMB: Math.round(stats.heapUsed / 1024 / 1024),
            cacheSize: this.embeddingCache.size
        }, 'Critical pressure - overflow to PostgreSQL');
        // Move 30% of cache to PostgreSQL
        const toMove = Math.max(1, Math.floor(this.embeddingCache.size * 0.3));
        await this.moveToOverflow(toMove);
        // Force garbage collection if available
        this.forceGC();
    }
    /**
     * Handle emergency pressure (90%+) - aggressive eviction
     */
    async handleEmergencyPressure(stats) {
        logger.error({
            heapUsedMB: Math.round(stats.heapUsed / 1024 / 1024),
            cacheSize: this.embeddingCache.size
        }, 'EMERGENCY pressure - aggressive eviction');
        // Move 50% of cache to PostgreSQL
        const toMove = Math.max(1, Math.floor(this.embeddingCache.size * 0.5));
        await this.moveToOverflow(toMove);
        // Clear any remaining cache if still critical
        const postMoveStats = this.getStats();
        if (postMoveStats.usagePercent >= this.config.emergencyThreshold) {
            logger.error('Still in emergency after overflow - clearing cache');
            this.embeddingCache.clear();
        }
        // Force garbage collection
        this.forceGC();
    }
    /**
     * Move cache entries to PostgreSQL overflow
     */
    async moveToOverflow(count) {
        if (!this.overflowHandler) {
            logger.warn('No overflow handler - evicting without persistence');
            this.embeddingCache.evictMultiple(count);
            return;
        }
        const entries = this.embeddingCache.getLRUEntries(count);
        if (entries.length === 0)
            return;
        try {
            const moved = await this.overflowHandler.moveToPostgres(entries);
            this.totalOverflowed += moved;
            // Now evict them from cache
            for (const entry of entries) {
                this.embeddingCache.delete(entry.key);
            }
            logger.info({ moved }, 'Moved entries to PostgreSQL overflow');
        }
        catch (error) {
            logger.error({ error }, 'Failed to move to overflow - evicting anyway');
            this.embeddingCache.evictMultiple(count);
        }
    }
    /**
     * Force garbage collection if available
     */
    forceGC() {
        if (global.gc) {
            global.gc();
            this.lastGC = new Date();
            logger.debug('Forced garbage collection');
        }
    }
    /**
     * Get current memory statistics
     */
    getStats() {
        const mem = process.memoryUsage();
        const cacheStats = this.embeddingCache.getStats();
        return {
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            maxHeap: this.config.maxHeapBytes,
            usagePercent: mem.heapUsed / this.config.maxHeapBytes,
            external: mem.external,
            arrayBuffers: mem.arrayBuffers,
            rss: mem.rss,
            pressureLevel: this.pressureLevel,
            embeddingCacheSize: cacheStats.size,
            totalEvictions: cacheStats.evictionCount,
            totalOverflowed: this.totalOverflowed,
            lastGC: this.lastGC,
            uptime: Date.now() - this.startTime,
            instanceId: this.instanceRegistry.getInstanceId(),
            projectPath: this.instanceRegistry.getProjectPath(),
            autoGCCount: this.autoGCCount
        };
    }
    /**
     * Get embedding from cache or load from overflow
     */
    async getEmbedding(key) {
        // Try cache first
        const cached = this.embeddingCache.get(key);
        if (cached)
            return cached;
        // Try loading from overflow
        if (this.overflowHandler) {
            try {
                const loaded = await this.overflowHandler.loadFromPostgres([key]);
                const embedding = loaded.get(key);
                if (embedding) {
                    // Add back to cache (will evict if needed)
                    const size = embedding.length * 8; // 64-bit floats
                    this.embeddingCache.set(key, embedding, size);
                    return embedding;
                }
            }
            catch (error) {
                logger.debug({ error, key }, 'Failed to load from overflow');
            }
        }
        return undefined;
    }
    /**
     * Store embedding in cache
     */
    setEmbedding(key, embedding) {
        const size = embedding.length * 8; // 64-bit floats
        this.embeddingCache.set(key, embedding, size);
    }
    /**
     * Check if embedding exists in cache
     */
    hasEmbedding(key) {
        return this.embeddingCache.has(key);
    }
    /**
     * Clear all caches
     */
    clearCaches() {
        this.embeddingCache.clear();
        logger.info('Caches cleared');
    }
    /**
     * Add event listener for memory stats updates
     */
    on(event, listener) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(listener);
    }
    /**
     * Notify listeners of stats update
     */
    notifyListeners(stats) {
        const listeners = this.listeners.get('stats') || [];
        for (const listener of listeners) {
            try {
                listener(stats);
            }
            catch (error) {
                logger.error({ error }, 'Error in memory stats listener');
            }
        }
    }
    /**
     * Shutdown memory manager
     */
    async shutdown() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        // Stop instance registry cleanup
        this.instanceRegistry.stopCleanup();
        // Unregister from instance registry
        await this.instanceRegistry.unregister();
        // Final overflow if handler available and cache has entries
        if (this.overflowHandler && this.embeddingCache.size > 0) {
            logger.info('Moving remaining cache to overflow before shutdown');
            await this.moveToOverflow(this.embeddingCache.size);
        }
        this.embeddingCache.clear();
        this.listeners.clear();
        logger.info({
            instanceId: this.instanceRegistry.getInstanceId()
        }, 'Memory manager shut down');
    }
    /**
     * Force an immediate garbage collection (if available)
     * Returns true if GC was triggered, false if not available
     */
    triggerGC() {
        if (global.gc) {
            global.gc();
            this.lastGC = new Date();
            logger.info({ instanceId: this.instanceRegistry.getInstanceId() }, 'Manual GC triggered');
            return true;
        }
        return false;
    }
    /**
     * Get the auto GC trigger count
     */
    getAutoGCCount() {
        return this.autoGCCount;
    }
}
// ============================================================================
// Singleton Instance
// ============================================================================
let globalMemoryManager = null;
/**
 * Get the global memory manager
 */
export function getMemoryManager(config) {
    if (!globalMemoryManager) {
        globalMemoryManager = new MemoryManager(config);
    }
    return globalMemoryManager;
}
/**
 * Reset the global memory manager (for testing)
 */
export async function resetMemoryManager() {
    if (globalMemoryManager) {
        await globalMemoryManager.shutdown();
        globalMemoryManager = null;
    }
}
//# sourceMappingURL=memoryManager.js.map