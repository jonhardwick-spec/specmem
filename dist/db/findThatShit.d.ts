import { ConnectionPoolGoBrrr } from './connectionPoolGoBrrr.js';
import { Memory, MemoryType, ImportanceLevelType, SearchResult, RecallMemoryParams } from '../types/index.js';
interface RawMemoryRow {
    id: string;
    content: string;
    content_hash: string;
    memory_type: MemoryType;
    importance: ImportanceLevelType;
    tags: string[];
    metadata: Record<string, unknown>;
    embedding: string | null;
    image_data: Buffer | null;
    image_mime_type: string | null;
    created_at: Date;
    updated_at: Date;
    access_count: number;
    last_accessed_at: Date | null;
    expires_at: Date | null;
    consolidated_from: string[] | null;
    similarity?: number;
    text_rank?: number;
}
interface VectorSearchOpts {
    embedding: number[];
    limit?: number;
    threshold?: number;
    memoryTypes?: MemoryType[];
    tags?: string[];
    importance?: ImportanceLevelType[];
    includeExpired?: boolean;
    dateRange?: {
        start?: string;
        end?: string;
    };
    allProjects?: boolean;
    projectPath?: string;
}
interface TextSearchOpts {
    query: string;
    limit?: number;
    memoryTypes?: MemoryType[];
    tags?: string[];
    includeExpired?: boolean;
    allProjects?: boolean;
    projectPath?: string;
}
/**
 * BigBrainSearchEngine - finds memories FAST
 *
 * search modes that absolutely SLAP:
 * - vector search: semantic similarity with cosine distance
 * - text search: full-text with ranking
 * - hybrid: combines both for best results
 * - tag search: filter by tags with AND/OR
 * - find by id: basic lookup
 * - find similar: related memories
 * - find duplicates: content deduplication
 */
export declare class BigBrainSearchEngine {
    private pool;
    private searchCount;
    private cacheHits;
    constructor(pool: ConnectionPoolGoBrrr);
    getPool(): ConnectionPoolGoBrrr;
    vectorSearch(opts: VectorSearchOpts): Promise<SearchResult[]>;
    textSearch(opts: TextSearchOpts): Promise<SearchResult[]>;
    hybridSearch(query: string, embedding: number[], opts?: {
        limit?: number;
        vectorWeight?: number;
        memoryTypes?: MemoryType[];
        tags?: string[];
        includeExpired?: boolean;
        allProjects?: boolean;
        projectPath?: string;
    }): Promise<SearchResult[]>;
    tagSearch(tags: string[], mode?: 'AND' | 'OR', opts?: {
        limit?: number;
        includeExpired?: boolean;
        allProjects?: boolean;
        projectPath?: string;
    }): Promise<Memory[]>;
    findById(id: string, opts?: {
        crossProject?: boolean;
    }): Promise<Memory | null>;
    findByIds(ids: string[], opts?: {
        crossProject?: boolean;
    }): Promise<Memory[]>;
    findSimilarToMemory(memoryId: string, opts?: {
        limit?: number;
        threshold?: number;
        allProjects?: boolean;
        projectPath?: string;
    }): Promise<SearchResult[]>;
    findDuplicates(threshold?: number, opts?: {
        allProjects?: boolean;
        projectPath?: string;
    }): Promise<Array<{
        memory1: Memory;
        memory2: Memory;
        similarity: number;
    }>>;
    recall(params: RecallMemoryParams & {
        allProjects?: boolean;
        projectPath?: string;
    }): Promise<{
        memories: Memory[];
        total: number;
        hasMore: boolean;
    }>;
    findRelated(memoryId: string, opts?: {
        depth?: number;
        relationType?: string;
        limit?: number;
        allProjects?: boolean;
        projectPath?: string;
    }): Promise<Memory[]>;
    getAllTags(limit?: number, opts?: {
        allProjects?: boolean;
        projectPath?: string;
    }): Promise<Array<{
        name: string;
        count: number;
    }>>;
    countMemories(filters?: {
        memoryType?: MemoryType;
        importance?: ImportanceLevelType;
        tags?: string[];
        includeExpired?: boolean;
        allProjects?: boolean;
        projectPath?: string;
    }): Promise<number>;
    private touchMemories;
    private rowToMemory;
    private parseEmbedding;
    private extractHighlights;
    getStats(): {
        totalSearches: number;
        cacheHits: number;
    };
}
export declare function getBigBrain(pool?: ConnectionPoolGoBrrr, projectPath?: string): BigBrainSearchEngine;
export declare function resetBigBrain(projectPath?: string): void;
export declare function resetAllBigBrains(): void;
export type { VectorSearchOpts, TextSearchOpts, RawMemoryRow };
//# sourceMappingURL=findThatShit.d.ts.map