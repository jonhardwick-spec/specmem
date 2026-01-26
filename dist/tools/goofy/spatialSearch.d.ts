/**
 * spatialSearch.ts - SPATIAL MEMORY SEARCH TOOL
 *
 * MCP tool for searching memories using spatial/quadrant organization.
 * Enables  to search memories like navigating a map - by region,
 * cluster, or following hot paths.
 *
 * This is how 's memory becomes truly intelligent - not just
 * searching text, but understanding the landscape of knowledge.
 *
 * Use cases:
 * - "Find all memories in the technical quadrant"
 * - "Get memories in the cluster about API design"
 * - "What memories are frequently accessed with this one?"
 * - "Show me the neighborhood around this memory"
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
import { DatabaseManager } from '../../database.js';
import { Memory } from '../../types/index.js';
import { SemanticQuadrant, MemoryCluster } from '../../db/spatialMemory.js';
import { HotPath } from '../../db/hotPathManager.js';
interface SpatialSearchInput {
    mode: 'quadrant' | 'cluster' | 'neighborhood' | 'hot_path' | 'predict';
    quadrantCode?: string;
    quadrantId?: number;
    clusterId?: number;
    clusterName?: string;
    memoryId?: string;
    neighborhoodRadius?: number;
    hotPathId?: number;
    startMemoryId?: string;
    currentMemoryId?: string;
    limit?: number;
    includeStats?: boolean;
}
interface SpatialSearchResult {
    memories: Memory[];
    quadrant?: SemanticQuadrant;
    cluster?: MemoryCluster;
    hotPath?: HotPath;
    predictions?: Array<{
        memoryId: string;
        probability: number;
        memory?: Memory;
    }>;
    stats?: {
        totalInRegion?: number;
        avgSimilarity?: number;
        searchDurationMs?: number;
    };
    message: string;
}
export declare class SpatialSearch implements MCPTool<SpatialSearchInput, SpatialSearchResult> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            mode: {
                type: string;
                enum: string[];
                description: string;
            };
            quadrantCode: {
                type: string;
                description: string;
            };
            quadrantId: {
                type: string;
                description: string;
            };
            clusterId: {
                type: string;
                description: string;
            };
            clusterName: {
                type: string;
                description: string;
            };
            memoryId: {
                type: string;
                format: string;
                description: string;
            };
            neighborhoodRadius: {
                type: string;
                default: number;
                description: string;
            };
            hotPathId: {
                type: string;
                description: string;
            };
            startMemoryId: {
                type: string;
                format: string;
                description: string;
            };
            currentMemoryId: {
                type: string;
                format: string;
                description: string;
            };
            limit: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
            includeStats: {
                type: string;
                default: boolean;
                description: string;
            };
        };
        required: string[];
    };
    private db;
    private spatialEngine;
    private hotPathManager;
    constructor(db: DatabaseManager);
    private ensureEngines;
    execute(params: SpatialSearchInput): Promise<SpatialSearchResult>;
    private searchQuadrant;
    private searchCluster;
    private searchNeighborhood;
    private searchHotPath;
    private predictNext;
    private rowToMemory;
    private parseEmbedding;
}
interface SpatialManageInput {
    action: 'init_quadrants' | 'run_clustering' | 'list_quadrants' | 'list_clusters' | 'assign_memory' | 'get_stats' | 'decay_heat' | 'label_clusters';
    memoryId?: string;
    quadrantId?: number;
    clusterId?: number;
    numClusters?: number;
    minClusterSize?: number;
    limit?: number;
}
interface SpatialManageResult {
    success: boolean;
    message: string;
    data?: any;
}
export declare class SpatialManage implements MCPTool<SpatialManageInput, SpatialManageResult> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            action: {
                type: string;
                enum: string[];
                description: string;
            };
            memoryId: {
                type: string;
                format: string;
                description: string;
            };
            quadrantId: {
                type: string;
                description: string;
            };
            clusterId: {
                type: string;
                description: string;
            };
            numClusters: {
                type: string;
                default: number;
                description: string;
            };
            minClusterSize: {
                type: string;
                default: number;
                description: string;
            };
            limit: {
                type: string;
                default: number;
                description: string;
            };
        };
        required: string[];
    };
    private db;
    private spatialEngine;
    private hotPathManager;
    constructor(db: DatabaseManager);
    private ensureEngines;
    execute(params: SpatialManageInput): Promise<SpatialManageResult>;
    private parseEmbedding;
}
export {};
//# sourceMappingURL=spatialSearch.d.ts.map