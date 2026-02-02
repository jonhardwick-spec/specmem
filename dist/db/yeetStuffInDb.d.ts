import { ConnectionPoolGoBrrr } from './connectionPoolGoBrrr.js';
import { Memory, MemoryType, ImportanceLevelType } from '../types/index.js';
interface MemoryInsertPayload {
    content: string;
    memoryType: MemoryType;
    importance: ImportanceLevelType;
    tags: string[];
    metadata?: Record<string, unknown>;
    embedding?: number[];
    imageData?: string;
    imageMimeType?: string;
    expiresAt?: Date;
    consolidatedFrom?: string[];
}
interface YeetResult {
    id: string;
    contentHash: string;
    wasCreated: boolean;
    duration: number;
}
interface BatchYeetStats {
    total: number;
    inserted: number;
    skipped: number;
    failed: number;
    duration: number;
    ids: string[];
}
/**
 * MemoryYeeter - throws memories into postgres at CRAZY speeds
 *
 * optimizations that go hard:
 * - batch inserts with transaction batching
 * - content hash deduplication
 * - embedding caching
 * - tag normalization
 * - prepared statements for repeat inserts
 */
export declare class MemoryYeeter {
    private pool;
    private insertCount;
    private duplicateCount;
    constructor(pool: ConnectionPoolGoBrrr);
    yeetOne(payload: MemoryInsertPayload): Promise<YeetResult>;
    yeetAndReturn(payload: MemoryInsertPayload): Promise<Memory>;
    yeetBatch(payloads: MemoryInsertPayload[], batchSize?: number): Promise<BatchYeetStats>;
    yeetOrUpdate(payload: MemoryInsertPayload, updateFields?: (keyof MemoryInsertPayload)[]): Promise<YeetResult>;
    yeetRelation(sourceId: string, targetId: string, relationType?: string, strength?: number, bidirectional?: boolean): Promise<void>;
    yeetRelationsBatch(relations: Array<{
        sourceId: string;
        targetId: string;
        relationType?: string;
        strength?: number;
    }>, bidirectional?: boolean): Promise<number>;
    private syncTagsForMemory;
    addEmbeddingToMemory(memoryId: string, embedding: number[]): Promise<void>;
    yeetUpdateById(existingId: string, payload: MemoryInsertPayload): Promise<YeetResult>;
    cacheEmbedding(contentHash: string, embedding: number[], model?: string): Promise<void>;
    getCachedEmbedding(contentHash: string): Promise<number[] | null>;
    private computeContentHash;
    private findByContentHash;
    private parseEmbedding;
    getStats(): {
        totalInserted: number;
        duplicatesSkipped: number;
    };
}
export declare function getTheYeeter(pool?: ConnectionPoolGoBrrr, projectPath?: string): MemoryYeeter;
export declare function resetTheYeeter(projectPath?: string): void;
export declare function resetAllYeeters(): void;
export type { MemoryInsertPayload, YeetResult, BatchYeetStats };
//# sourceMappingURL=yeetStuffInDb.d.ts.map