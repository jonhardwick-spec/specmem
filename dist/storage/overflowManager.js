import { logger } from '../utils/logger.js';
import { getOverflowStorage } from './overflowStorage.js';
import { toonFormat } from './toonFormat.js';
const DEFAULT_RAM_LIMIT_MB = 100;
const DEFAULT_EVICTION_THRESHOLD = 0.85;
const DEFAULT_EVICTION_BATCH_SIZE = 50;
const DEFAULT_CHECK_INTERVAL_MS = 30_000;
export class OverflowManager {
    pool;
    ramCache = new Map();
    ramLimitBytes;
    evictionThreshold;
    evictionBatchSize;
    checkIntervalMs;
    overflowStorage = null;
    checkTimer = null;
    currentRamUsage = 0;
    isInitialized = false;
    totalEvictions = 0;
    totalRecalls = 0;
    totalHits = 0;
    totalMisses = 0;
    evictionCallback = null;
    constructor(pool, config = {}) {
        this.pool = pool;
        this.ramLimitBytes = (config.ramLimitMb ?? DEFAULT_RAM_LIMIT_MB) * 1024 * 1024;
        this.evictionThreshold = config.evictionThreshold ?? DEFAULT_EVICTION_THRESHOLD;
        this.evictionBatchSize = config.evictionBatchSize ?? DEFAULT_EVICTION_BATCH_SIZE;
        this.checkIntervalMs = config.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
        this.overflowStorage = getOverflowStorage(pool, config.overflowConfig);
    }
    async initialize() {
        if (this.isInitialized) {
            logger.debug('overflow manager already initialized');
            return;
        }
        await this.overflowStorage.initialize();
        this.startMemoryCheck();
        this.isInitialized = true;
        logger.info({
            ramLimitMb: this.ramLimitBytes / (1024 * 1024),
            evictionThreshold: this.evictionThreshold,
            batchSize: this.evictionBatchSize
        }, 'overflow manager initialized');
    }
    onEviction(callback) {
        this.evictionCallback = callback;
    }
    async set(key, data, options = {}) {
        const size = toonFormat.estimateSize(data);
        if (this.ramCache.has(key)) {
            const existing = this.ramCache.get(key);
            this.currentRamUsage -= existing.size;
        }
        if (this.shouldEvict(size)) {
            await this.evictToOverflow();
        }
        const entry = {
            key,
            data,
            size,
            createdAt: Date.now(),
            accessedAt: Date.now(),
            accessCount: 1,
            inOverflow: false
        };
        this.ramCache.set(key, entry);
        this.currentRamUsage += size;
        logger.debug({
            key,
            size,
            ramUsageMb: (this.currentRamUsage / (1024 * 1024)).toFixed(2)
        }, 'stored entry in RAM cache');
    }
    async get(key) {
        const cached = this.ramCache.get(key);
        if (cached) {
            cached.accessedAt = Date.now();
            cached.accessCount++;
            this.totalHits++;
            logger.trace({ key }, 'RAM cache hit');
            return cached.data;
        }
        this.totalMisses++;
        const overflowData = await this.overflowStorage.retrieve(key);
        if (overflowData !== null) {
            this.totalRecalls++;
            const size = toonFormat.estimateSize(overflowData);
            if (this.shouldEvict(size)) {
                await this.evictToOverflow();
            }
            const entry = {
                key,
                data: overflowData,
                size,
                createdAt: Date.now(),
                accessedAt: Date.now(),
                accessCount: 1,
                inOverflow: false
            };
            this.ramCache.set(key, entry);
            this.currentRamUsage += size;
            logger.debug({ key }, 'recalled entry from overflow to RAM');
            return overflowData;
        }
        logger.trace({ key }, 'entry not found in cache or overflow');
        return null;
    }
    async delete(key) {
        let deleted = false;
        const cached = this.ramCache.get(key);
        if (cached) {
            this.currentRamUsage -= cached.size;
            this.ramCache.delete(key);
            deleted = true;
        }
        const overflowDeleted = await this.overflowStorage.delete(key);
        deleted = deleted || overflowDeleted;
        if (deleted) {
            logger.debug({ key }, 'deleted entry from overflow manager');
        }
        return deleted;
    }
    async has(key) {
        if (this.ramCache.has(key)) {
            return true;
        }
        return this.overflowStorage.exists(key);
    }
    hasInRam(key) {
        return this.ramCache.has(key);
    }
    shouldEvict(additionalSize = 0) {
        const projectedUsage = this.currentRamUsage + additionalSize;
        const threshold = this.ramLimitBytes * this.evictionThreshold;
        return projectedUsage > threshold;
    }
    async evictToOverflow(count) {
        const batchSize = count ?? this.evictionBatchSize;
        const candidates = this.getLeastUsedEntries(batchSize);
        let evictedCount = 0;
        for (const entry of candidates) {
            try {
                await this.overflowStorage.store(entry.key, entry.data, {
                    metadata: {
                        originalAccessCount: entry.accessCount,
                        originalCreatedAt: entry.createdAt
                    }
                });
                if (this.evictionCallback) {
                    await this.evictionCallback(entry.key, entry.data);
                }
                this.currentRamUsage -= entry.size;
                this.ramCache.delete(entry.key);
                this.totalEvictions++;
                evictedCount++;
                logger.debug({
                    key: entry.key,
                    size: entry.size,
                    accessCount: entry.accessCount
                }, 'evicted entry to overflow storage');
            }
            catch (err) {
                logger.error({ err, key: entry.key }, 'failed to evict entry to overflow');
            }
        }
        logger.info({
            evictedCount,
            ramUsageMb: (this.currentRamUsage / (1024 * 1024)).toFixed(2),
            totalEvictions: this.totalEvictions
        }, 'completed eviction batch');
        return evictedCount;
    }
    getLeastUsedEntries(count) {
        const entries = Array.from(this.ramCache.values());
        entries.sort((a, b) => {
            if (a.accessCount !== b.accessCount) {
                return a.accessCount - b.accessCount;
            }
            return a.accessedAt - b.accessedAt;
        });
        return entries.slice(0, count);
    }
    async recallFromOverflow(keys) {
        const results = new Map();
        for (const key of keys) {
            if (this.ramCache.has(key)) {
                results.set(key, this.ramCache.get(key).data);
                continue;
            }
            const data = await this.get(key);
            if (data !== null) {
                results.set(key, data);
            }
        }
        return results;
    }
    async prefetch(keys) {
        let prefetchedCount = 0;
        for (const key of keys) {
            if (this.ramCache.has(key)) {
                continue;
            }
            const data = await this.overflowStorage.retrieve(key);
            if (data !== null) {
                const size = toonFormat.estimateSize(data);
                if (!this.shouldEvict(size)) {
                    const entry = {
                        key,
                        data,
                        size,
                        createdAt: Date.now(),
                        accessedAt: Date.now(),
                        accessCount: 0,
                        inOverflow: false
                    };
                    this.ramCache.set(key, entry);
                    this.currentRamUsage += size;
                    prefetchedCount++;
                }
            }
        }
        logger.debug({ prefetchedCount, requestedCount: keys.length }, 'prefetch complete');
        return prefetchedCount;
    }
    clear() {
        this.ramCache.clear();
        this.currentRamUsage = 0;
        logger.info('cleared RAM cache');
    }
    getStats() {
        const totalRequests = this.totalHits + this.totalMisses;
        return {
            ramUsageMb: this.currentRamUsage / (1024 * 1024),
            ramLimitMb: this.ramLimitBytes / (1024 * 1024),
            ramUsagePercent: (this.currentRamUsage / this.ramLimitBytes) * 100,
            entriesInRam: this.ramCache.size,
            entriesInOverflow: 0,
            totalEvictions: this.totalEvictions,
            totalRecalls: this.totalRecalls,
            hitRate: totalRequests > 0 ? this.totalHits / totalRequests : 0
        };
    }
    async getFullStats() {
        const baseStats = this.getStats();
        const overflowStats = await this.overflowStorage.getStats();
        return {
            ...baseStats,
            entriesInOverflow: overflowStats.totalEntries,
            overflowStats
        };
    }
    getRamKeys() {
        return Array.from(this.ramCache.keys());
    }
    getRamEntries() {
        return Array.from(this.ramCache.values()).map(entry => ({
            key: entry.key,
            size: entry.size,
            accessCount: entry.accessCount,
            accessedAt: entry.accessedAt
        }));
    }
    startMemoryCheck() {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
        }
        this.checkTimer = setInterval(async () => {
            try {
                if (this.shouldEvict()) {
                    logger.info({
                        ramUsageMb: (this.currentRamUsage / (1024 * 1024)).toFixed(2),
                        threshold: this.evictionThreshold
                    }, 'RAM usage above threshold, triggering eviction');
                    await this.evictToOverflow();
                }
            }
            catch (err) {
                logger.error({ err }, 'memory check error');
            }
        }, this.checkIntervalMs);
        logger.debug({ intervalMs: this.checkIntervalMs }, 'started memory check loop');
    }
    async shutdown() {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }
        this.ramCache.clear();
        this.currentRamUsage = 0;
        this.isInitialized = false;
        logger.info({
            totalEvictions: this.totalEvictions,
            totalRecalls: this.totalRecalls,
            hitRate: this.getStats().hitRate.toFixed(2)
        }, 'overflow manager shut down');
    }
}
let managerInstance = null;
export function getOverflowManager(pool, config) {
    if (!managerInstance && !pool) {
        throw new Error('overflow manager not initialized - provide pool on first call');
    }
    if (!managerInstance && pool) {
        managerInstance = new OverflowManager(pool, config);
    }
    return managerInstance;
}
export function resetOverflowManager() {
    if (managerInstance) {
        managerInstance.shutdown().catch(err => {
            logger.warn({ err }, 'error shutting down overflow manager');
        });
        managerInstance = null;
    }
}
//# sourceMappingURL=overflowManager.js.map