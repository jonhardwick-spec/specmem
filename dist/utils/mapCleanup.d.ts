/**
 * mapCleanup.ts - Cleanup intervals for project-scoped Maps
 *
 * Prevents memory leaks from Maps that accumulate entries without cleanup.
 * Each Map gets a cleanup interval that removes stale entries based on lastAccess time.
 */
export interface CleanupConfig {
    staleThresholdMs: number;
    checkIntervalMs: number;
    logPrefix: string;
    onCleanup?: (projectPath: string) => void | Promise<void>;
}
/**
 * Setup cleanup interval for a project-scoped Map with access times
 *
 * @param map - The Map to clean up
 * @param accessTimes - Map tracking last access time per key
 * @param config - Cleanup configuration
 * @returns The interval handle (already unref'd so it won't block exit)
 */
export declare function setupMapCleanup<T>(map: Map<string, T>, accessTimes: Map<string, number>, config?: Partial<CleanupConfig>): string;
/**
 * Setup cleanup for a Map where the values contain lastAccessTime property
 * Use this when the Map value already has a timestamp field
 */
export declare function setupMapCleanupWithEmbeddedTime<T extends {
    lastAccessTime: number;
}>(map: Map<string, T>, config?: Partial<CleanupConfig>): string;
/**
 * Wrapper that tracks access times automatically
 * Use this when you want automatic access time tracking on get/set
 */
export declare class CleanableMap<T> {
    private config;
    private map;
    private accessTimes;
    private cleanupRegistryId;
    constructor(config?: Partial<CleanupConfig>);
    /**
     * Start the cleanup interval
     */
    startCleanup(): void;
    /**
     * Stop the cleanup interval (registry handles this on shutdown)
     */
    stopCleanup(): void;
    get(key: string): T | undefined;
    set(key: string, value: T): this;
    has(key: string): boolean;
    delete(key: string): boolean;
    clear(): void;
    get size(): number;
    keys(): IterableIterator<string>;
    values(): IterableIterator<T>;
    entries(): IterableIterator<[string, T]>;
    forEach(callback: (value: T, key: string, map: Map<string, T>) => void): void;
}
//# sourceMappingURL=mapCleanup.d.ts.map