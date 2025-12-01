/**
 * showMeTheStats - get memory system statistics
 *
 * shows you what you working with fr fr
 * includes distributions, time series, and performance metrics
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
import { DatabaseManager } from '../../database.js';
import { GetStatsParams, MemoryStats } from '../../types/index.js';
import { GlobalInstanceStats } from '../../utils/memoryManager.js';
interface ExtendedStats extends MemoryStats {
    databaseStats?: {
        totalConnections: number;
        idleConnections: number;
        waitingConnections: number;
    };
    cacheStats?: {
        embeddingCacheSize: number;
        embeddingCacheHitRate: number;
        serverCacheHitRate: number;
    };
    timeSeriesData?: Array<{
        period: string;
        count: number;
        avgImportance: number;
    }>;
    relationshipStats?: {
        totalRelations: number;
        avgConnectionsPerMemory: number;
        mostConnectedMemories: Array<{
            id: string;
            connections: number;
        }>;
    };
    /** Chinese Compactor stats - token efficiency compression */
    compressionStats?: {
        enabled: boolean;
        termCount: number;
        minLength: number;
        threshold: number;
    };
    /** Response compaction metrics - tracking token savings */
    responseCompactionMetrics?: {
        totalCompressed: number;
        bytesSaved: number;
        averageRatio: number;
        byContext: Record<string, {
            count: number;
            saved: number;
        }>;
    };
    /** Per-instance RAM usage tracking */
    instanceStats?: {
        currentInstance: {
            instanceId: string;
            projectPath: string;
            heapUsedMB: number;
            heapTotalMB: number;
            rssMB: number;
            usagePercent: number;
            pressureLevel: string;
            autoGCCount: number;
            uptimeSeconds: number;
        };
        globalStats?: GlobalInstanceStats;
    };
    /** Embedding server health status */
    embeddingServerStatus?: {
        running: boolean;
        healthy: boolean;
        pid: number | null;
        consecutiveFailures: number;
        restartCount: number;
        uptimeSeconds: number | null;
        lastHealthCheck: number | null;
        socketPath: string;
        socketExists: boolean;
    };
}
/**
 * ShowMeTheStats - statistics tool
 *
 * gives you the full picture of your memory system
 * distributions, performance, and more
 */
export declare class ShowMeTheStats implements MCPTool<GetStatsParams, ExtendedStats> {
    private db;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            includeTagDistribution: {
                type: string;
                default: boolean;
                description: string;
            };
            includeTypeDistribution: {
                type: string;
                default: boolean;
                description: string;
            };
            includeImportanceDistribution: {
                type: string;
                default: boolean;
                description: string;
            };
            includeTimeSeriesData: {
                type: string;
                default: boolean;
                description: string;
            };
            timeSeriesGranularity: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            includeRelationshipStats: {
                type: string;
                default: boolean;
                description: string;
            };
            includeCacheStats: {
                type: string;
                default: boolean;
                description: string;
            };
            includeInstanceStats: {
                type: string;
                default: boolean;
                description: string;
            };
            includeAllInstances: {
                type: string;
                default: boolean;
                description: string;
            };
            includeEmbeddingServerStatus: {
                type: string;
                default: boolean;
                description: string;
            };
        };
    };
    constructor(db: DatabaseManager);
    execute(params: GetStatsParams & {
        includeRelationshipStats?: boolean;
        includeCacheStats?: boolean;
        includeInstanceStats?: boolean;
        includeAllInstances?: boolean;
        includeEmbeddingServerStatus?: boolean;
    }): Promise<ExtendedStats>;
    /**
     * Get embedding server health status
     */
    private getEmbeddingServerStatus;
    /**
     * Get per-instance RAM usage statistics
     */
    private getInstanceStats;
    /**
     * get base memory statistics
     */
    private getBaseStats;
    /**
     * get memory type distribution
     */
    private getTypeDistribution;
    /**
     * get importance level distribution
     */
    private getImportanceDistribution;
    /**
     * get tag usage distribution
     */
    private getTagDistribution;
    /**
     * get time series data for memory creation
     */
    private getTimeSeriesData;
    /**
     * get relationship statistics
     */
    private getRelationshipStats;
    /**
     * get cache statistics
     */
    private getCacheStats;
    /**
     * get database connection stats
     */
    private getDatabaseStats;
    /**
     * get storage size breakdown
     */
    getStorageBreakdown(): Promise<{
        contentSize: number;
        embeddingsSize: number;
        imagesSize: number;
        metadataSize: number;
        totalSize: number;
    }>;
    /**
     * get health check status
     */
    healthCheck(): Promise<{
        status: 'healthy' | 'degraded' | 'unhealthy';
        checks: Record<string, {
            status: boolean;
            message: string;
        }>;
    }>;
}
export {};
//# sourceMappingURL=showMeTheStats.d.ts.map