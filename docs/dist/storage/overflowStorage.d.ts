import pg from 'pg';
import { ToonHeader } from './toonFormat.js';
export interface OverflowEntry {
    key: string;
    data: Buffer;
    header: ToonHeader;
    createdAt: Date;
    accessedAt: Date;
    accessCount: number;
    ttlDays: number;
}
export interface OverflowStorageConfig {
    tableName?: string;
    defaultTtlDays?: number;
    cleanupIntervalMs?: number;
    maxEntries?: number;
    compressionEnabled?: boolean;
}
export interface OverflowStats {
    totalEntries: number;
    totalSizeBytes: number;
    avgCompressionRatio: number;
    oldestEntry: Date | null;
    newestEntry: Date | null;
    expiredCount: number;
}
export declare class OverflowStorage {
    private readonly pool;
    private readonly tableName;
    private readonly defaultTtlDays;
    private readonly cleanupIntervalMs;
    private readonly maxEntries;
    private readonly compressionEnabled;
    private cleanupTimer;
    private isInitialized;
    constructor(pool: pg.Pool, config?: OverflowStorageConfig);
    initialize(): Promise<void>;
    private createTable;
    store<T>(key: string, data: T, options?: {
        ttlDays?: number;
        metadata?: Record<string, unknown>;
    }): Promise<{
        stored: boolean;
        stats: {
            originalSize: number;
            compressedSize: number;
        };
    }>;
    retrieve<T>(key: string): Promise<T | null>;
    delete(key: string): Promise<boolean>;
    deleteMany(keys: string[]): Promise<number>;
    exists(key: string): Promise<boolean>;
    getMetadata(key: string): Promise<{
        header: ToonHeader;
        accessCount: number;
        createdAt: Date;
        accessedAt: Date;
    } | null>;
    cleanupExpired(): Promise<number>;
    getLeastUsedKeys(limit: number): Promise<string[]>;
    getMostUsedKeys(limit: number): Promise<string[]>;
    getStats(): Promise<OverflowStats>;
    enforceMaxEntries(): Promise<number>;
    private startCleanupLoop;
    shutdown(): Promise<void>;
}
export declare function getOverflowStorage(pool?: pg.Pool, config?: OverflowStorageConfig): OverflowStorage;
export declare function resetOverflowStorage(): void;
//# sourceMappingURL=overflowStorage.d.ts.map