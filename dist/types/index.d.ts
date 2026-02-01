import { z } from 'zod';
/**
 * EmbeddingProvider interface - for generating vector embeddings from text
 * Used by memory tools for semantic search capabilities
 */
export interface EmbeddingProvider {
    generateEmbedding(text: string): Promise<number[]>;
    /**
     * Batch embedding generation - MUCH faster than individual calls!
     * Uses single socket request with {"texts": [...]} protocol.
     * Falls back to sequential generateEmbedding calls if not implemented.
     */
    generateEmbeddingsBatch?(texts: string[]): Promise<number[][]>;
    /**
     * Optional shutdown method - cleanup resources like child processes
     * Called during graceful shutdown to prevent orphaned processes
     */
    shutdown?(): Promise<void>;
    /**
     * Optional socket reset - force reconnect to embedding server
     * Call after restarting embedding server to pick up new socket
     */
    resetSocket?(): void;
}
export declare const MemoryTypeEnum: z.ZodEnum<["episodic", "semantic", "procedural", "working", "consolidated"]>;
export declare const ImportanceLevel: z.ZodEnum<["critical", "high", "medium", "low", "trivial"]>;
export declare const MemorySchema: z.ZodObject<{
    id: z.ZodString;
    content: z.ZodString;
    memoryType: z.ZodEnum<["episodic", "semantic", "procedural", "working", "consolidated"]>;
    importance: z.ZodEnum<["critical", "high", "medium", "low", "trivial"]>;
    tags: z.ZodArray<z.ZodString, "many">;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    embedding: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    imageData: z.ZodOptional<z.ZodString>;
    imageMimeType: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
    accessCount: z.ZodNumber;
    lastAccessedAt: z.ZodOptional<z.ZodDate>;
    expiresAt: z.ZodOptional<z.ZodDate>;
    consolidatedFrom: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    relatedMemories: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    id?: string;
    content?: string;
    memoryType?: "episodic" | "semantic" | "procedural" | "working" | "consolidated";
    importance?: "critical" | "high" | "medium" | "low" | "trivial";
    tags?: string[];
    metadata?: Record<string, unknown>;
    embedding?: number[];
    imageData?: string;
    imageMimeType?: string;
    createdAt?: Date;
    updatedAt?: Date;
    accessCount?: number;
    lastAccessedAt?: Date;
    expiresAt?: Date;
    consolidatedFrom?: string[];
    relatedMemories?: string[];
}, {
    id?: string;
    content?: string;
    memoryType?: "episodic" | "semantic" | "procedural" | "working" | "consolidated";
    importance?: "critical" | "high" | "medium" | "low" | "trivial";
    tags?: string[];
    metadata?: Record<string, unknown>;
    embedding?: number[];
    imageData?: string;
    imageMimeType?: string;
    createdAt?: Date;
    updatedAt?: Date;
    accessCount?: number;
    lastAccessedAt?: Date;
    expiresAt?: Date;
    consolidatedFrom?: string[];
    relatedMemories?: string[];
}>;
export declare const StoreMemoryInput: z.ZodObject<{
    content: z.ZodString;
    memoryType: z.ZodDefault<z.ZodEnum<["episodic", "semantic", "procedural", "working", "consolidated"]>>;
    importance: z.ZodDefault<z.ZodEnum<["critical", "high", "medium", "low", "trivial"]>>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    imageBase64: z.ZodOptional<z.ZodString>;
    imageMimeType: z.ZodOptional<z.ZodString>;
    expiresAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    content?: string;
    memoryType?: "episodic" | "semantic" | "procedural" | "working" | "consolidated";
    importance?: "critical" | "high" | "medium" | "low" | "trivial";
    tags?: string[];
    metadata?: Record<string, unknown>;
    imageMimeType?: string;
    expiresAt?: string;
    imageBase64?: string;
}, {
    content?: string;
    memoryType?: "episodic" | "semantic" | "procedural" | "working" | "consolidated";
    importance?: "critical" | "high" | "medium" | "low" | "trivial";
    tags?: string[];
    metadata?: Record<string, unknown>;
    imageMimeType?: string;
    expiresAt?: string;
    imageBase64?: string;
}>;
export declare const SearchMemoryInput: z.ZodObject<{
    query: z.ZodDefault<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
    threshold: z.ZodDefault<z.ZodNumber>;
    memoryTypes: z.ZodOptional<z.ZodArray<z.ZodEnum<["episodic", "semantic", "procedural", "working", "consolidated"]>, "many">>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    importance: z.ZodOptional<z.ZodArray<z.ZodEnum<["critical", "high", "medium", "low", "trivial"]>, "many">>;
    dateRange: z.ZodOptional<z.ZodObject<{
        start: z.ZodOptional<z.ZodString>;
        end: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        start?: string;
        end?: string;
    }, {
        start?: string;
        end?: string;
    }>>;
    includeExpired: z.ZodDefault<z.ZodBoolean>;
    role: z.ZodOptional<z.ZodEnum<["user", "assistant"]>>;
    summarize: z.ZodDefault<z.ZodBoolean>;
    maxContentLength: z.ZodDefault<z.ZodNumber>;
    galleryMode: z.ZodDefault<z.ZodUnion<[z.ZodBoolean, z.ZodLiteral<"ask">]>>;
    includeRecent: z.ZodDefault<z.ZodNumber>;
    recencyBoost: z.ZodDefault<z.ZodBoolean>;
    keywordFallback: z.ZodDefault<z.ZodBoolean>;
    cameraRollMode: z.ZodDefault<z.ZodBoolean>;
    zoomLevel: z.ZodOptional<z.ZodEnum<["ultra-wide", "wide", "normal", "close", "macro"]>>;
    humanReadable: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    importance?: ("critical" | "high" | "medium" | "low" | "trivial")[];
    tags?: string[];
    query?: string;
    limit?: number;
    threshold?: number;
    memoryTypes?: ("episodic" | "semantic" | "procedural" | "working" | "consolidated")[];
    dateRange?: {
        start?: string;
        end?: string;
    };
    includeExpired?: boolean;
    role?: "user" | "assistant";
    summarize?: boolean;
    maxContentLength?: number;
    galleryMode?: boolean | "ask";
    includeRecent?: number;
    recencyBoost?: boolean;
    keywordFallback?: boolean;
    cameraRollMode?: boolean;
    zoomLevel?: "ultra-wide" | "wide" | "normal" | "close" | "macro";
    humanReadable?: boolean;
}, {
    importance?: ("critical" | "high" | "medium" | "low" | "trivial")[];
    tags?: string[];
    query?: string;
    limit?: number;
    threshold?: number;
    memoryTypes?: ("episodic" | "semantic" | "procedural" | "working" | "consolidated")[];
    dateRange?: {
        start?: string;
        end?: string;
    };
    includeExpired?: boolean;
    role?: "user" | "assistant";
    summarize?: boolean;
    maxContentLength?: number;
    galleryMode?: boolean | "ask";
    includeRecent?: number;
    recencyBoost?: boolean;
    keywordFallback?: boolean;
    cameraRollMode?: boolean;
    zoomLevel?: "ultra-wide" | "wide" | "normal" | "close" | "macro";
    humanReadable?: boolean;
}>;
export declare const RecallMemoryInput: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    limit: z.ZodDefault<z.ZodNumber>;
    offset: z.ZodDefault<z.ZodNumber>;
    orderBy: z.ZodDefault<z.ZodEnum<["created", "updated", "accessed", "importance"]>>;
    orderDirection: z.ZodDefault<z.ZodEnum<["asc", "desc"]>>;
}, "strip", z.ZodTypeAny, {
    id?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
    orderBy?: "importance" | "created" | "updated" | "accessed";
    orderDirection?: "asc" | "desc";
}, {
    id?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
    orderBy?: "importance" | "created" | "updated" | "accessed";
    orderDirection?: "asc" | "desc";
}>;
export declare const ConsolidateMemoryInput: z.ZodObject<{
    strategy: z.ZodDefault<z.ZodEnum<["similarity", "temporal", "tag_based", "importance"]>>;
    threshold: z.ZodDefault<z.ZodNumber>;
    maxMemories: z.ZodDefault<z.ZodNumber>;
    memoryTypes: z.ZodOptional<z.ZodArray<z.ZodEnum<["episodic", "semantic", "procedural", "working", "consolidated"]>, "many">>;
    dryRun: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    threshold?: number;
    memoryTypes?: ("episodic" | "semantic" | "procedural" | "working" | "consolidated")[];
    strategy?: "importance" | "similarity" | "temporal" | "tag_based";
    maxMemories?: number;
    dryRun?: boolean;
}, {
    threshold?: number;
    memoryTypes?: ("episodic" | "semantic" | "procedural" | "working" | "consolidated")[];
    strategy?: "importance" | "similarity" | "temporal" | "tag_based";
    maxMemories?: number;
    dryRun?: boolean;
}>;
export declare const UpdateMemoryInput: z.ZodObject<{
    id: z.ZodString;
    content: z.ZodOptional<z.ZodString>;
    importance: z.ZodOptional<z.ZodEnum<["critical", "high", "medium", "low", "trivial"]>>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    expiresAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    id?: string;
    content?: string;
    importance?: "critical" | "high" | "medium" | "low" | "trivial";
    tags?: string[];
    metadata?: Record<string, unknown>;
    expiresAt?: string;
}, {
    id?: string;
    content?: string;
    importance?: "critical" | "high" | "medium" | "low" | "trivial";
    tags?: string[];
    metadata?: Record<string, unknown>;
    expiresAt?: string;
}>;
export declare const DeleteMemoryInput: z.ZodEffects<z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    ids: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    olderThan: z.ZodOptional<z.ZodString>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    expiredOnly: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    id?: string;
    tags?: string[];
    ids?: string[];
    olderThan?: string;
    expiredOnly?: boolean;
}, {
    id?: string;
    tags?: string[];
    ids?: string[];
    olderThan?: string;
    expiredOnly?: boolean;
}>, {
    id?: string;
    tags?: string[];
    ids?: string[];
    olderThan?: string;
    expiredOnly?: boolean;
}, {
    id?: string;
    tags?: string[];
    ids?: string[];
    olderThan?: string;
    expiredOnly?: boolean;
}>;
export declare const LinkMemoriesInput: z.ZodObject<{
    sourceId: z.ZodString;
    targetIds: z.ZodArray<z.ZodString, "many">;
    bidirectional: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    sourceId?: string;
    targetIds?: string[];
    bidirectional?: boolean;
}, {
    sourceId?: string;
    targetIds?: string[];
    bidirectional?: boolean;
}>;
export declare const GetStatsInput: z.ZodObject<{
    includeTagDistribution: z.ZodDefault<z.ZodBoolean>;
    includeTypeDistribution: z.ZodDefault<z.ZodBoolean>;
    includeImportanceDistribution: z.ZodDefault<z.ZodBoolean>;
    includeTimeSeriesData: z.ZodDefault<z.ZodBoolean>;
    timeSeriesGranularity: z.ZodDefault<z.ZodEnum<["hour", "day", "week", "month"]>>;
}, "strip", z.ZodTypeAny, {
    includeTagDistribution?: boolean;
    includeTypeDistribution?: boolean;
    includeImportanceDistribution?: boolean;
    includeTimeSeriesData?: boolean;
    timeSeriesGranularity?: "hour" | "day" | "week" | "month";
}, {
    includeTagDistribution?: boolean;
    includeTypeDistribution?: boolean;
    includeImportanceDistribution?: boolean;
    includeTimeSeriesData?: boolean;
    timeSeriesGranularity?: "hour" | "day" | "week" | "month";
}>;
export type Memory = z.infer<typeof MemorySchema>;
export type MemoryType = z.infer<typeof MemoryTypeEnum>;
export type ImportanceLevelType = z.infer<typeof ImportanceLevel>;
export type StoreMemoryParams = z.infer<typeof StoreMemoryInput>;
export type SearchMemoryParams = z.infer<typeof SearchMemoryInput>;
export type RecallMemoryParams = z.infer<typeof RecallMemoryInput>;
export type ConsolidateMemoryParams = z.infer<typeof ConsolidateMemoryInput>;
export type UpdateMemoryParams = z.infer<typeof UpdateMemoryInput>;
export type DeleteMemoryParams = z.infer<typeof DeleteMemoryInput>;
export type LinkMemoriesParams = z.infer<typeof LinkMemoriesInput>;
export type GetStatsParams = z.infer<typeof GetStatsInput>;
export interface SearchResult {
    memory: Memory;
    similarity: number;
    highlights?: string[];
    isFallback?: boolean;
    fallbackNote?: string;
}
export interface ConsolidationResult {
    consolidatedMemory: Memory | null;
    sourceMemoryIds: string[];
    similarityScores: number[];
    wasExecuted: boolean;
}
export interface MemoryStats {
    totalMemories: number;
    totalSize: number;
    oldestMemory: Date | null;
    newestMemory: Date | null;
    typeDistribution?: Record<MemoryType, number>;
    importanceDistribution?: Record<ImportanceLevelType, number>;
    tagDistribution?: Record<string, number>;
    averageAccessCount: number;
    memoriesWithImages: number;
    expiredMemories: number;
    consolidatedMemories: number;
}
export interface DatabaseConfig {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    maxConnections: number;
    idleTimeout: number;
    connectionTimeout: number;
    ssl?: boolean | {
        rejectUnauthorized: boolean;
    };
}
export interface ServerConfig {
    database: DatabaseConfig;
    embedding: {
        model: string;
        batchSize: number;
        /** Docker container CPU limit in cores (e.g., 1.0 = 1 core, 0.5 = half core) */
        cpuLimit?: number;
    };
    consolidation: {
        autoEnabled: boolean;
        intervalMinutes: number;
        minMemoriesForConsolidation: number;
        similarityQueryLimit: number;
        temporalQueryLimit: number;
        tagBasedQueryLimit: number;
        importanceQueryLimit: number;
    };
    storage: {
        maxImageSizeBytes: number;
        allowedImageTypes: string[];
    };
    logging: {
        level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
        prettyPrint: boolean;
    };
    watcher: {
        enabled: boolean;
        rootPath: string;
        ignorePath?: string;
        debounceMs: number;
        autoRestart: boolean;
        maxRestarts: number;
        maxFileSizeBytes: number;
        autoDetectMetadata: boolean;
        queueMaxSize: number;
        queueBatchSize: number;
        queueProcessingIntervalMs: number;
        syncCheckIntervalMinutes: number;
    };
    sessionWatcher: {
        enabled: boolean;
        claudeDir?: string;
        debounceMs: number;
        importance: ImportanceLevelType;
        additionalTags: string[];
    };
    /**
     * Chinese Compactor Configuration
     * Compresses MCP responses using Traditional Chinese for ~3.5x token efficiency
     * Only affects internal system messages, not user-facing content
     */
    compression?: {
        enabled: boolean;
        /** Minimum text length to compress (default: 50) */
        minLength: number;
        /** Similarity threshold for semantic preservation (0-1, default: 0.80) */
        threshold: number;
        /** Apply compression to search results (default: true) */
        compressSearchResults: boolean;
        /** Apply compression to stats/system output (default: true) */
        compressSystemOutput: boolean;
        /** Apply compression to hook outputs (default: true) */
        compressHookOutput: boolean;
    };
}
//# sourceMappingURL=index.d.ts.map