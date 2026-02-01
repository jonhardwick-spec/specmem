/**
 * spatialMemory.ts - SPATIAL MEMORY ENGINE
 *
 * Makes 's memory ACTUALLY INTELLIGENT through spatial organization.
 * This is where memories become self-organizing semantic neighborhoods.
 *
 * Features:
 * - Quadrant-based memory organization (like spatial indexes)
 * - Automatic clustering of related memories
 * - Region-based searching (find all memories in a semantic region)
 * - Cluster auto-labeling from content themes
 * - Self-balancing when quadrants get too full
 *
 * The goal:  should think about memories like physical locations,
 * where related concepts are "near" each other in semantic space.
 */
import { ConnectionPoolGoBrrr } from './connectionPoolGoBrrr.js';
import { Memory, MemoryType } from '../types/index.js';
export interface SemanticQuadrant {
    id: number;
    name: string;
    description: string | null;
    quadrantCode: string;
    centroid: number[] | null;
    bounds: {
        minX: number | null;
        maxX: number | null;
        minY: number | null;
        maxY: number | null;
    };
    parentQuadrantId: number | null;
    depth: number;
    memoryCount: number;
    maxCapacity: number;
    avgSimilarity: number | null;
    tags: string[];
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}
export interface MemoryCluster {
    id: number;
    name: string | null;
    description: string | null;
    clusterType: 'semantic' | 'temporal' | 'tag_based' | 'manual';
    centroid: number[] | null;
    memoryCount: number;
    coherenceScore: number | null;
    silhouetteScore: number | null;
    topTags: string[];
    topTerms: string[];
    parentClusterId: number | null;
    depth: number;
    isStable: boolean;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}
export interface QuadrantAssignment {
    memoryId: string;
    quadrantId: number;
    posX: number | null;
    posY: number | null;
    distanceFromCentroid: number | null;
    assignedAt: Date;
    assignmentMethod: string;
}
export interface ClusterAssignment {
    memoryId: string;
    clusterId: number;
    membershipScore: number;
    distanceToCentroid: number | null;
    assignedAt: Date;
    assignmentMethod: string;
}
export interface SpatialSearchOptions {
    quadrantCode?: string;
    quadrantId?: number;
    clusterId?: number;
    clusterName?: string;
    withinBounds?: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
    };
    limit?: number;
    includeNearby?: boolean;
    nearbyRadius?: number;
}
export interface ClusteringOptions {
    method: 'kmeans' | 'agglomerative' | 'auto';
    numClusters?: number;
    minClusterSize?: number;
    maxClusters?: number;
    memoryType?: MemoryType;
    tags?: string[];
    includeExpired?: boolean;
}
export declare class SpatialMemoryEngine {
    private pool;
    private dimensionService;
    private cachedDimension;
    constructor(pool: ConnectionPoolGoBrrr);
    /**
     * Get DimensionService (lazy initialization)
     */
    private getDimService;
    /**
     * Get the embedding dimension from database
     */
    getEmbeddingDimension(): Promise<number>;
    /**
     * Validate and scale an embedding to match expected dimension
     */
    prepareEmbedding(embedding: number[]): Promise<number[]>;
    /**
     * Create a new semantic quadrant
     */
    createQuadrant(opts: {
        name: string;
        quadrantCode: string;
        description?: string;
        parentQuadrantId?: number;
        centroid?: number[];
        bounds?: {
            minX: number;
            maxX: number;
            minY: number;
            maxY: number;
        };
        tags?: string[];
        metadata?: Record<string, unknown>;
    }): Promise<SemanticQuadrant>;
    /**
     * Get quadrant by ID
     */
    getQuadrant(id: number): Promise<SemanticQuadrant | null>;
    /**
     * Get quadrant by code
     */
    getQuadrantByCode(code: string): Promise<SemanticQuadrant | null>;
    /**
     * List all quadrants with optional filtering
     */
    listQuadrants(opts?: {
        parentId?: number;
        depth?: number;
        minMemoryCount?: number;
    }): Promise<SemanticQuadrant[]>;
    /**
     * Assign a memory to a quadrant
     */
    assignToQuadrant(memoryId: string, quadrantId: number, opts?: {
        posX?: number;
        posY?: number;
        distanceFromCentroid?: number;
        method?: string;
    }): Promise<void>;
    /**
     * Get memories in a specific quadrant
     */
    getMemoriesInQuadrant(quadrantId: number, limit?: number): Promise<Array<{
        memory: Memory;
        position: {
            x: number | null;
            y: number | null;
        };
    }>>;
    /**
     * Find the best quadrant for a memory based on its embedding
     */
    findBestQuadrant(embedding: number[]): Promise<SemanticQuadrant | null>;
    /**
     * Auto-assign a memory to the best quadrant
     */
    autoAssignToQuadrant(memoryId: string, embedding: number[]): Promise<SemanticQuadrant | null>;
    /**
     * Check if quadrant needs splitting (over capacity)
     */
    checkQuadrantCapacity(quadrantId: number): Promise<{
        needsSplit: boolean;
        currentCount: number;
        maxCapacity: number;
    }>;
    /**
     * Create a new memory cluster
     */
    createCluster(opts: {
        name?: string;
        description?: string;
        clusterType?: 'semantic' | 'temporal' | 'tag_based' | 'manual';
        centroid?: number[];
        topTags?: string[];
        topTerms?: string[];
        parentClusterId?: number;
        metadata?: Record<string, unknown>;
    }): Promise<MemoryCluster>;
    /**
     * Get cluster by ID
     */
    getCluster(id: number): Promise<MemoryCluster | null>;
    /**
     * List clusters with optional filtering
     */
    listClusters(opts?: {
        clusterType?: string;
        parentId?: number;
        minMemoryCount?: number;
        minCoherence?: number;
    }): Promise<MemoryCluster[]>;
    /**
     * Assign a memory to a cluster
     */
    assignToCluster(memoryId: string, clusterId: number, opts?: {
        membershipScore?: number;
        distanceToCentroid?: number;
        method?: string;
    }): Promise<void>;
    /**
     * Get memories in a cluster
     */
    getMemoriesInCluster(clusterId: number, limit?: number): Promise<Array<{
        memory: Memory;
        membershipScore: number;
    }>>;
    /**
     * Find the best cluster for a memory based on its embedding
     */
    findBestCluster(embedding: number[]): Promise<MemoryCluster | null>;
    /**
     * Auto-assign a memory to the best cluster
     */
    autoAssignToCluster(memoryId: string, embedding: number[]): Promise<MemoryCluster | null>;
    /**
     * Update cluster centroid based on current members
     */
    updateClusterCentroid(clusterId: number): Promise<void>;
    /**
     * Auto-label a cluster based on its contents
     */
    autoLabelCluster(clusterId: number): Promise<{
        name: string;
        topTags: string[];
    }>;
    /**
     * Search memories within a spatial region
     */
    searchSpatial(opts: SpatialSearchOptions): Promise<Memory[]>;
    /**
     * Find neighboring quadrants/clusters
     */
    findNeighboringQuadrants(quadrantId: number, limit?: number): Promise<SemanticQuadrant[]>;
    /**
     * Find related clusters based on shared memories
     */
    findRelatedClusters(clusterId: number, limit?: number): Promise<Array<{
        cluster: MemoryCluster;
        sharedCount: number;
    }>>;
    /**
     * Initialize default quadrants (4 quadrants based on content themes)
     */
    initializeDefaultQuadrants(): Promise<SemanticQuadrant[]>;
    /**
     * Bulk assign memories to quadrants based on embeddings
     */
    bulkAssignToQuadrants(limit?: number): Promise<number>;
    /**
     * Run simple k-means-style clustering on unassigned memories
     */
    runSimpleClustering(opts?: {
        numClusters?: number;
        minClusterSize?: number;
    }): Promise<number>;
    /**
     * Get spatial memory statistics
     */
    getStats(): Promise<{
        totalQuadrants: number;
        totalClusters: number;
        assignedToQuadrant: number;
        assignedToCluster: number;
        avgMemoriesPerQuadrant: number;
        avgMemoriesPerCluster: number;
    }>;
    private rowToQuadrant;
    private rowToCluster;
    private rowToMemory;
    private parseEmbedding;
    private cosineSimilarity;
    private calculateCentroid;
}
export declare function getSpatialEngine(pool?: ConnectionPoolGoBrrr, projectPath?: string): SpatialMemoryEngine;
export declare function resetSpatialEngine(projectPath?: string): void;
//# sourceMappingURL=spatialMemory.d.ts.map