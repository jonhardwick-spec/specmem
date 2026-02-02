/**
 * mapCleanup.ts - Cleanup intervals for project-scoped Maps
 *
 * Prevents memory leaks from Maps that accumulate entries without cleanup.
 * Each Map gets a cleanup interval that removes stale entries based on lastAccess time.
 */
import { logger } from './logger.js';
import { registerInterval } from './timerRegistry.js';
const DEFAULT_CONFIG = {
    staleThresholdMs: 30 * 60 * 1000, // 30 minutes
    checkIntervalMs: 5 * 60 * 1000, // 5 minutes
    logPrefix: '[MapCleanup]'
};
/**
 * Setup cleanup interval for a project-scoped Map with access times
 *
 * @param map - The Map to clean up
 * @param accessTimes - Map tracking last access time per key
 * @param config - Cleanup configuration
 * @returns The interval handle (already unref'd so it won't block exit)
 */
export function setupMapCleanup(map, accessTimes, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    // Use registerInterval to create the interval - it handles tracking and cleanup
    const cleanupCallback = async () => {
        const cutoff = Date.now() - cfg.staleThresholdMs;
        const stalePaths = [];
        for (const [projectPath, lastAccess] of accessTimes) {
            if (lastAccess < cutoff) {
                stalePaths.push(projectPath);
            }
        }
        for (const projectPath of stalePaths) {
            try {
                if (cfg.onCleanup) {
                    await cfg.onCleanup(projectPath);
                }
                map.delete(projectPath);
                accessTimes.delete(projectPath);
                logger.debug({ projectPath }, cfg.logPrefix + ' Cleaned up stale entry');
            }
            catch (err) {
                logger.warn({ err, projectPath }, cfg.logPrefix + ' Error during cleanup');
            }
        }
        if (stalePaths.length > 0) {
            logger.debug({ count: stalePaths.length }, cfg.logPrefix + ' Cleanup complete');
        }
    };
    // Register with timer registry - it creates the interval and tracks it for proper shutdown
    const registryId = registerInterval(cleanupCallback, cfg.checkIntervalMs, cfg.logPrefix);
    return registryId;
}
/**
 * Setup cleanup for a Map where the values contain lastAccessTime property
 * Use this when the Map value already has a timestamp field
 */
export function setupMapCleanupWithEmbeddedTime(map, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const cleanupCallback = async () => {
        const cutoff = Date.now() - cfg.staleThresholdMs;
        const stalePaths = [];
        for (const [projectPath, value] of map) {
            if (value.lastAccessTime < cutoff) {
                stalePaths.push(projectPath);
            }
        }
        for (const projectPath of stalePaths) {
            try {
                if (cfg.onCleanup) {
                    await cfg.onCleanup(projectPath);
                }
                map.delete(projectPath);
                logger.debug({ projectPath }, cfg.logPrefix + ' Cleaned up stale entry');
            }
            catch (err) {
                logger.warn({ err, projectPath }, cfg.logPrefix + ' Error during cleanup');
            }
        }
        if (stalePaths.length > 0) {
            logger.debug({ count: stalePaths.length }, cfg.logPrefix + ' Cleanup complete');
        }
    };
    const registryId = registerInterval(cleanupCallback, cfg.checkIntervalMs, cfg.logPrefix);
    return registryId;
}
/**
 * Wrapper that tracks access times automatically
 * Use this when you want automatic access time tracking on get/set
 */
export class CleanableMap {
    config;
    map = new Map();
    accessTimes = new Map();
    cleanupRegistryId = null;
    constructor(config = {}) {
        this.config = config;
    }
    /**
     * Start the cleanup interval
     */
    startCleanup() {
        if (this.cleanupRegistryId)
            return;
        this.cleanupRegistryId = setupMapCleanup(this.map, this.accessTimes, this.config);
    }
    /**
     * Stop the cleanup interval (registry handles this on shutdown)
     */
    stopCleanup() {
        // Timer registry handles cleanup on shutdown
        this.cleanupRegistryId = null;
    }
    get(key) {
        this.accessTimes.set(key, Date.now());
        return this.map.get(key);
    }
    set(key, value) {
        this.accessTimes.set(key, Date.now());
        this.map.set(key, value);
        return this;
    }
    has(key) {
        return this.map.has(key);
    }
    delete(key) {
        this.accessTimes.delete(key);
        return this.map.delete(key);
    }
    clear() {
        this.map.clear();
        this.accessTimes.clear();
    }
    get size() {
        return this.map.size;
    }
    keys() {
        return this.map.keys();
    }
    values() {
        return this.map.values();
    }
    entries() {
        return this.map.entries();
    }
    forEach(callback) {
        this.map.forEach(callback);
    }
}
//# sourceMappingURL=mapCleanup.js.map