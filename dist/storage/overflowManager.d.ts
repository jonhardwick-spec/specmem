import pg from 'pg';
import { OverflowStorage, OverflowStorageConfig } from './overflowStorage.js';
export interface CacheEntry<T = unknown> {
    key: string;
    data: T;
    size: number;
    createdAt: number;
    accessedAt: number;
    accessCount: number;
    inOverflow: boolean;
}
export interface OverflowManagerConfig {
    ramLimitMb?: number;
    evictionThreshold?: number;
    evictionBatchSize?: number;
    checkIntervalMs?: number;
    overflowConfig?: OverflowStorageConfig;
}
export interface OverflowManagerStats {
    ramUsageMb: number;
    ramLimitMb: number;
    ramUsagePercent: number;
    entriesInRam: number;
    entriesInOverflow: number;
    totalEvictions: number;
    totalRecalls: number;
    hitRate: number;
}
type EvictionCallback<T> = (key: string, data: T) => void | Promise<void>;
export declare class OverflowManager<T = unknown> {
    private readonly pool;
    private readonly ramCache;
    private readonly ramLimitBytes;
    private readonly evictionThreshold;
    private readonly evictionBatchSize;
    private readonly checkIntervalMs;
    private overflowStorage;
    private checkTimer;
    private currentRamUsage;
    private isInitialized;
    private totalEvictions;
    private totalRecalls;
    private totalHits;
    private totalMisses;
    private evictionCallback;
    constructor(pool: pg.Pool, config?: OverflowManagerConfig);
    initialize(): Promise<void>;
    onEviction(callback: EvictionCallback<T>): void;
    set(key: string, data: T, options?: {
        ttlDays?: number;
        metadata?: Record<string, unknown>;
    }): Promise<void>;
    get(key: string): Promise<T | null>;
    delete(key: string): Promise<boolean>;
    has(key: string): Promise<boolean>;
    hasInRam(key: string): boolean;
    private shouldEvict;
    evictToOverflow(count?: number): Promise<number>;
    private getLeastUsedEntries;
    recallFromOverflow(keys: string[]): Promise<Map<string, T>>;
    prefetch(keys: string[]): Promise<number>;
    clear(): void;
    getStats(): OverflowManagerStats;
    getFullStats(): Promise<OverflowManagerStats & {
        overflowStats: Awaited<ReturnType<OverflowStorage['getStats']>>;
    }>;
    getRamKeys(): string[];
    getRamEntries(): Array<{
        key: string;
        size: number;
        accessCount: number;
        accessedAt: number;
    }>;
    private startMemoryCheck;
    shutdown(): Promise<void>;
}
export declare function getOverflowManager<T = unknown>(pool?: pg.Pool, config?: OverflowManagerConfig): OverflowManager<T>;
export declare function resetOverflowManager(): void;
export {};
//# sourceMappingURL=overflowManager.d.ts.map