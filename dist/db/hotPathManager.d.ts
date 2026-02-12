/**
 * hotPathManager.ts - HOT PATH ACCELERATION ENGINE
 *
 * Tracks frequently accessed memory chains and optimizes retrieval.
 * When memories are accessed together often, they become a "hot path"
 * that gets cached and pre-fetched for faster recall.
 *
 * Think of it like how your brain gets faster at recalling related memories
 * the more you think about them together.
 *
 * Features:
 * - Tracks memory access transitions (A -> B -> C)
 * - Detects frequently used access patterns
 * - Creates and caches hot paths for fast retrieval
 * - Decays unused paths over time
 * - Predicts next memories based on current context
 */
import { ConnectionPoolGoBrrr } from './connectionPoolGoBrrr.js';
import { Memory } from '../types/index.js';
export interface HotPath {
    id: number;
    pathName: string | null;
    pathHash: string;
    memoryIds: string[];
    memoryCount: number;
    accessCount: number;
    lastAccessedAt: Date | null;
    firstAccessedAt: Date;
    heatScore: number;
    peakHeatScore: number;
    isCached: boolean;
    cachedAt: Date | null;
    cacheHits: number;
    avgTransitionSimilarity: number | null;
    pathCoherence: number | null;
    dominantTags: string[];
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}
export interface AccessTransition {
    id: number;
    fromMemoryId: string;
    toMemoryId: string;
    transitionCount: number;
    lastTransitionAt: Date;
    sessionId: string | null;
    timeBetweenMs: number | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface PredictionResult {
    memoryId: string;
    probability: number;
    transitionCount: number;
    memory?: Memory;
}
export declare class HotPathManager {
    private pool;
    private lastAccessedMemoryId;
    private currentSessionId;
    private accessBuffer;
    constructor(pool: ConnectionPoolGoBrrr);
    /**
     * Start tracking a new session
     */
    startSession(sessionId?: string): string;
    /**
     * End current session and process access patterns
     */
    endSession(): Promise<void>;
    private generateSessionId;
    /**
     * Record a memory access - call this whenever a memory is retrieved
     */
    recordAccess(memoryId: string): Promise<void>;
    /**
     * Record a transition between two memories
     */
    recordTransition(fromId: string, toId: string, sessionId?: string | null, timeBetweenMs?: number | null): Promise<void>;
    /**
     * Process access buffer to detect potential hot paths
     */
    private processAccessBuffer;
    /**
     * Check how often a memory sequence appears in transitions
     * OPTIMIZED: Single batch query instead of N-1 queries
     */
    private checkPatternFrequency;
    /**
     * Create a new hot path
     */
    createHotPath(memoryIds: string[], name?: string): Promise<HotPath>;
    /**
     * Get hot path by hash
     */
    getHotPathByHash(hash: string): Promise<HotPath | null>;
    /**
     * Get hot path by ID
     */
    getHotPath(id: number): Promise<HotPath | null>;
    /**
     * List hot paths by heat score
     */
    listHotPaths(opts?: {
        minHeatScore?: number;
        cachedOnly?: boolean;
        limit?: number;
    }): Promise<HotPath[]>;
    /**
     * Increment hot path access count and heat
     */
    incrementHotPathAccess(pathId: number): Promise<void>;
    /**
     * Mark a hot path as cached
     */
    cacheHotPath(pathId: number): Promise<void>;
    /**
     * Increment cache hit count
     */
    recordCacheHit(pathId: number): Promise<void>;
    /**
     * Get memories in a hot path
     * PROJECT ISOLATION: Filters by project_path to ensure only current project's memories are returned
     */
    getHotPathMemories(pathId: number): Promise<Memory[]>;
    /**
     * Predict next likely memories based on current context
     */
    predictNextMemories(currentMemoryId: string, limit?: number): Promise<PredictionResult[]>;
    /**
     * Predict next memories with full memory objects
     * PROJECT ISOLATION: Filters by project_path to ensure only current project's memories are returned
     */
    predictNextWithDetails(currentMemoryId: string, limit?: number): Promise<PredictionResult[]>;
    /**
     * Check if there's a hot path starting from current memory
     */
    findMatchingHotPaths(startMemoryId: string): Promise<HotPath[]>;
    /**
     * Check if we're on a known hot path and prefetch remaining memories
     */
    checkAndPrefetch(currentSequence: string[]): Promise<Memory[] | null>;
    /**
     * Decay heat scores for all hot paths
     */
    decayHeatScores(): Promise<number>;
    /**
     * Remove cold paths (very low heat score)
     */
    pruneColdPaths(minHeatScore?: number): Promise<number>;
    /**
     * Identify paths that should be cached based on access patterns
     */
    identifyPathsToCache(limit?: number): Promise<HotPath[]>;
    /**
     * Get transition statistics
     */
    getTransitionStats(): Promise<{
        totalTransitions: number;
        uniquePairs: number;
        avgTransitionsPerPair: number;
        topTransitions: Array<{
            fromId: string;
            toId: string;
            count: number;
        }>;
    }>;
    /**
     * Get hot path statistics
     */
    getHotPathStats(): Promise<{
        totalPaths: number;
        cachedPaths: number;
        avgHeatScore: number;
        avgPathLength: number;
        totalCacheHits: number;
    }>;
    private computePathHash;
    private rowToHotPath;
    private rowToMemory;
    private parseEmbedding;
}
export declare function getHotPathManager(pool?: ConnectionPoolGoBrrr, projectPath?: string): HotPathManager;
export declare function resetHotPathManager(projectPath?: string): void;
export declare function resetAllHotPathManagers(): void;
//# sourceMappingURL=hotPathManager.d.ts.map