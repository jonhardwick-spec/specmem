/**
 * dashboardQueries.ts - Optimized Dashboard Database Queries
 *
 * This module provides highly optimized queries specifically for the SpecMem dashboard.
 * All queries are designed for minimal latency and efficient resource usage.
 *
 * Key optimizations:
 * - Uses materialized views for stats
 * - Cursor-based pagination (no OFFSET)
 * - Efficient aggregation queries
 * - Pre-computed summaries where possible
 * - Approximate counts for large tables
 */
import { ConnectionPoolGoBrrr } from './connectionPoolGoBrrr.js';
import { type PaginatedResult } from './streamingQuery.js';
import { MemoryType, ImportanceLevelType } from '../types/index.js';
export interface DashboardStats {
    totalMemories: number;
    totalMemoriesApprox: number;
    typeDistribution: Record<MemoryType, number>;
    importanceDistribution: Record<ImportanceLevelType, number>;
    recentActivityCount: number;
    memoriesWithEmbeddings: number;
    memoriesWithImages: number;
    expiredMemories: number;
    avgAccessCount: number;
    avgContentLength: number;
    oldestMemory: Date | null;
    newestMemory: Date | null;
    computedAt: Date;
    isStale: boolean;
}
export interface DashboardMemoryRow {
    id: string;
    content: string;
    contentPreview: string;
    memoryType: MemoryType;
    importance: ImportanceLevelType;
    tags: string[];
    hasEmbedding: boolean;
    hasImage: boolean;
    createdAt: Date;
    updatedAt: Date;
    accessCount: number;
    expiresAt: Date | null;
}
export interface TimeSeriesDataPoint {
    timestamp: Date;
    count: number;
    label: string;
}
export interface TagStats {
    name: string;
    count: number;
    lastUsed: Date | null;
}
export interface DashboardFilters {
    memoryTypes?: MemoryType[];
    importance?: ImportanceLevelType[];
    tags?: string[];
    hasEmbedding?: boolean;
    hasImage?: boolean;
    searchQuery?: string;
    dateFrom?: Date;
    dateTo?: Date;
    includeExpired?: boolean;
}
/**
 * DashboardQueryEngine - Optimized queries for the SpecMem dashboard
 *
 * Performance characteristics:
 * - Stats query: <10ms (from materialized view)
 * - Memory list: <50ms with cursor pagination
 * - Search: <100ms with HNSW index
 * - Time series: <20ms with date_trunc aggregation
 */
export declare class DashboardQueryEngine {
    private pool;
    private statsRefreshInterval;
    private lastStatsRefresh;
    private statsCache;
    private storageStatsCache;
    private statsCacheTtlMs;
    constructor(pool: ConnectionPoolGoBrrr);
    /**
     * Set cache TTL for stats (default 5 min)
     */
    setStatsCacheTtl(ttlMs: number): void;
    /**
     * Get dashboard statistics (from materialized view for speed)
     * Falls back to real-time query if view doesn't exist
     */
    getStats(forceRefresh?: boolean): Promise<DashboardStats>;
    /**
     * Real-time stats query - uses approximate counts + sampling to avoid full table scan
     * Caches results for statsCacheTtlMs (default 5 min)
     */
    private getStatsRealtime;
    /**
     * Invalidate stats cache (call after bulk operations)
     */
    invalidateStatsCache(): void;
    /**
     * Refresh the materialized view (call periodically)
     */
    refreshStatsView(): Promise<void>;
    /**
     * Get paginated memories list with cursor-based pagination
     * Much faster than OFFSET for large tables
     */
    getMemoriesList(filters?: DashboardFilters, pageSize?: number, cursor?: string, sortBy?: 'created_at' | 'updated_at' | 'access_count', sortDir?: 'asc' | 'desc'): Promise<PaginatedResult<DashboardMemoryRow>>;
    /**
     * Get time series data for charts
     */
    getTimeSeries(granularity?: 'hour' | 'day' | 'week' | 'month', daysBack?: number, memoryType?: MemoryType): Promise<TimeSeriesDataPoint[]>;
    /**
     * Get top tags with usage counts
     */
    getTopTags(limit?: number): Promise<TagStats[]>;
    /**
     * Get memory type distribution over time (for stacked charts)
     */
    getTypeDistributionOverTime(granularity?: 'day' | 'week' | 'month', daysBack?: number): Promise<Array<{
        timestamp: Date;
        episodic: number;
        semantic: number;
        procedural: number;
        working: number;
        consolidated: number;
    }>>;
    /**
     * Get recent activity feed (last N memories)
     */
    getRecentActivity(limit?: number): Promise<DashboardMemoryRow[]>;
    /**
     * Get storage usage statistics - uses pg_class for fast estimates, caches results
     */
    getStorageStats(forceRefresh?: boolean): Promise<{
        totalSize: number;
        contentSize: number;
        embeddingSize: number;
        imageSize: number;
        indexSize: number;
        tableCount: number;
    }>;
    /**
     * Search memories with text query (uses GIN index)
     */
    searchMemories(query: string, filters?: DashboardFilters, limit?: number): Promise<Array<DashboardMemoryRow & {
        rank: number;
    }>>;
    /**
     * Get relationship graph data for visualization
     */
    getRelationshipGraph(centerMemoryId?: string, maxNodes?: number, maxDepth?: number): Promise<{
        nodes: Array<{
            id: string;
            type: MemoryType;
            importance: ImportanceLevelType;
            label: string;
        }>;
        edges: Array<{
            source: string;
            target: string;
            type: string;
            strength: number;
        }>;
    }>;
    /**
     * Start automatic stats refresh (call on server startup)
     * Uses cached stats most of the time, only refreshes materialized view every 5 minutes
     */
    startAutoRefresh(intervalMs?: number): void;
    /**
     * Stop automatic stats refresh
     */
    stopAutoRefresh(): void;
}
export declare function getDashboardEngine(pool?: ConnectionPoolGoBrrr, projectPath?: string): DashboardQueryEngine;
export declare function resetDashboardEngine(projectPath?: string): void;
export declare function resetAllDashboardEngines(): void;
//# sourceMappingURL=dashboardQueries.d.ts.map