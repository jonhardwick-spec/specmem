import { z } from 'zod';
export const MemoryTypeEnum = z.enum([
    'episodic',
    'semantic',
    'procedural',
    'working',
    'consolidated'
]);
export const ImportanceLevel = z.enum(['critical', 'high', 'medium', 'low', 'trivial']);
export const MemorySchema = z.object({
    id: z.string().uuid(),
    content: z.string().min(1).max(1_000_000),
    memoryType: MemoryTypeEnum,
    importance: ImportanceLevel,
    tags: z.array(z.string()).max(50),
    metadata: z.record(z.unknown()).optional(),
    embedding: z.array(z.number()).optional(),
    imageData: z.string().optional(),
    imageMimeType: z.string().optional(),
    createdAt: z.date(),
    updatedAt: z.date(),
    accessCount: z.number().int().nonnegative(),
    lastAccessedAt: z.date().optional(),
    expiresAt: z.date().optional(),
    consolidatedFrom: z.array(z.string().uuid()).optional(),
    relatedMemories: z.array(z.string().uuid()).optional()
});
export const StoreMemoryInput = z.object({
    content: z.string().min(1).max(1_000_000),
    memoryType: MemoryTypeEnum.default('semantic'),
    importance: ImportanceLevel.default('medium'),
    tags: z.array(z.string()).max(50).default([]),
    metadata: z.record(z.unknown()).optional(),
    imageBase64: z.string().optional(),
    imageMimeType: z.string().optional(),
    expiresAt: z.string().datetime().optional()
});
export const SearchMemoryInput = z.object({
    query: z.string().max(10_000).default(''), // Empty = show help
    limit: z.number().int().min(1).max(1000).default(10),
    threshold: z.number().min(0).max(1).default(0.1),
    memoryTypes: z.array(MemoryTypeEnum).optional(),
    tags: z.array(z.string()).optional(),
    importance: z.array(ImportanceLevel).optional(),
    dateRange: z.object({
        start: z.string().datetime().optional(),
        end: z.string().datetime().optional()
    }).optional(),
    includeExpired: z.boolean().default(false),
    // NEW: Role filtering for  sessions
    role: z.enum(['user', 'assistant']).optional(),
    // NEW: Content summarization options (Chinese Compactor approach)
    // DEFAULTS TO COMPACTED to save context - use get_memory for drill-down
    summarize: z.boolean().default(true),
    maxContentLength: z.number().int().min(0).default(1000), // Was 500 - user feedback: more content
    // EXPERIMENTAL: Search mode - choose between fast basic search or deep gallery analysis
    // 'ask' = return mode options for user to choose
    // true = gallery mode (Mini COT analysis with COT reasoning)
    // false = basic mode (fast semantic + keyword search)
    galleryMode: z.union([z.boolean(), z.literal('ask')]).default(false),
    // I5 FIX: Force include recent memories regardless of similarity
    // Useful for checking recent prompts/discussions that may not have embeddings yet
    includeRecent: z.number().int().min(0).max(50).default(0),
    // I5 FIX: Boost recent memories in similarity scoring
    // Last hour: 20% boost, last day: 10% boost
    recencyBoost: z.boolean().default(true),
    // I5 FIX: If embedding search fails, fallback to keyword (ILIKE) search
    keywordFallback: z.boolean().default(true),
    // CAMERA ROLL MODE - zoom-based exploration with drilldownIDs
    cameraRollMode: z.boolean().default(false),
    zoomLevel: z.enum(['ultra-wide', 'wide', 'normal', 'close', 'macro']).optional(),
    // HUMAN READABLE MODE - hook-style output with [SPECMEM-TOOL] tags
    // When true, outputs grey text with proper newlines for easy reading
    humanReadable: z.boolean().default(false)
});
export const RecallMemoryInput = z.object({
    id: z.string().uuid().optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(1000).default(50),
    offset: z.number().int().nonnegative().default(0),
    orderBy: z.enum(['created', 'updated', 'accessed', 'importance']).default('created'),
    orderDirection: z.enum(['asc', 'desc']).default('desc')
});
export const ConsolidateMemoryInput = z.object({
    strategy: z.enum(['similarity', 'temporal', 'tag_based', 'importance']).default('similarity'),
    threshold: z.number().min(0).max(1).default(0.85),
    maxMemories: z.number().int().min(2).max(100).default(10),
    memoryTypes: z.array(MemoryTypeEnum).optional(),
    dryRun: z.boolean().default(false)
});
export const UpdateMemoryInput = z.object({
    id: z.string().uuid(),
    content: z.string().min(1).max(1_000_000).optional(),
    importance: ImportanceLevel.optional(),
    tags: z.array(z.string()).max(50).optional(),
    metadata: z.record(z.unknown()).optional(),
    expiresAt: z.string().datetime().nullable().optional()
});
export const DeleteMemoryInput = z.object({
    id: z.string().uuid().optional(),
    ids: z.array(z.string().uuid()).optional(),
    olderThan: z.string().datetime().optional(),
    tags: z.array(z.string()).optional(),
    expiredOnly: z.boolean().default(false)
}).refine(data => data.id || data.ids || data.olderThan || data.tags || data.expiredOnly, { message: 'At least one deletion criterion required' });
export const LinkMemoriesInput = z.object({
    sourceId: z.string().uuid(),
    targetIds: z.array(z.string().uuid()).min(1).max(100),
    bidirectional: z.boolean().default(true)
});
export const GetStatsInput = z.object({
    includeTagDistribution: z.boolean().default(false),
    includeTypeDistribution: z.boolean().default(true),
    includeImportanceDistribution: z.boolean().default(true),
    includeTimeSeriesData: z.boolean().default(false),
    timeSeriesGranularity: z.enum(['hour', 'day', 'week', 'month']).default('day')
});
//# sourceMappingURL=index.js.map