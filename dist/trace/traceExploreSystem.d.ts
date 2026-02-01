/**
 * traceExploreSystem.ts - Trace & Root Cause Analysis System
 *
 * yo this is the BIG BRAIN system for Claude Code fr fr
 * reduces full codebase searches by 80%+ through intelligent recall
 *
 * Features:
 * - Error pattern recognition and root cause mapping
 * - Bug pattern detection and solution history
 * - Code relationship graphs with impact analysis
 * - Smart dependency exploration
 * - Intelligent caching of search patterns
 * - Pre-computed dependency graphs
 *
 * EMBEDDING DIMENSION NOTE:
 * DEPRECATED: SPECMEM_EMBEDDING_DIMENSIONS is no longer used.
 * Embedding dimensions are AUTO-DETECTED from the database pgvector column.
 * The system auto-migrates when dimension mismatch is detected at startup.
 */
import { DatabaseManager } from '../database.js';
import { EmbeddingProvider } from '../tools/index.js';
/**
 * Code trace entry - maps errors to root causes
 */
export interface CodeTrace {
    id: string;
    errorPattern: string;
    errorSignature: string;
    rootCauseCodeIds: string[];
    rootCauseFiles: string[];
    solutionHistory: SolutionEntry[];
    hitCount: number;
    lastHitAt: Date;
    createdAt: Date;
    updatedAt: Date;
    embedding?: number[];
}
/**
 * Solution entry for a code trace
 */
export interface SolutionEntry {
    id: string;
    description: string;
    codeChange: string;
    filesModified: string[];
    successRate: number;
    appliedCount: number;
    createdAt: Date;
}
/**
 * Bug pattern - recurring issue patterns
 */
export interface BugPattern {
    id: string;
    errorSignature: string;
    errorType: string;
    commonFiles: string[];
    commonKeywords: string[];
    resolutionStats: ResolutionStats;
    occurrenceCount: number;
    lastOccurrenceAt: Date;
    createdAt: Date;
    embedding?: number[];
}
/**
 * Resolution statistics for bug patterns
 */
export interface ResolutionStats {
    totalResolved: number;
    avgResolutionTimeMs: number;
    commonSolutions: string[];
    successfulPatterns: string[];
}
/**
 * Code relationship - dependency between code entities
 */
export interface CodeRelationship {
    id: string;
    fromCodeId: string;
    fromFilePath: string;
    toCodeId: string;
    toFilePath: string;
    relationshipType: RelationshipType;
    strength: number;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}
/**
 * Relationship types between code entities
 */
export type RelationshipType = 'imports' | 'exports' | 'calls' | 'extends' | 'implements' | 'references' | 'depends_on' | 'similar_to' | 'related_error';
/**
 * Search pattern cache entry
 */
export interface SearchPatternCache {
    id: string;
    searchQuery: string;
    searchHash: string;
    resultFileIds: string[];
    resultFilePaths: string[];
    hitCount: number;
    lastHitAt: Date;
    createdAt: Date;
    embedding?: number[];
}
/**
 * Dependency graph node
 */
export interface DependencyNode {
    fileId: string;
    filePath: string;
    language: string;
    imports: string[];
    exports: string[];
    dependsOn: string[];
    dependedBy: string[];
    impactScore: number;
}
/**
 * Trace result from error analysis
 */
export interface TraceResult {
    errorPattern: string;
    matchingTraces: CodeTrace[];
    suggestedRootCauses: Array<{
        file: string;
        confidence: number;
        reason: string;
    }>;
    similarBugs: BugPattern[];
    previousSolutions: SolutionEntry[];
    searchReductionPercent: number;
}
/**
 * Impact analysis result
 */
export interface ImpactAnalysis {
    targetFile: string;
    directDependents: string[];
    indirectDependents: string[];
    totalAffectedFiles: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    affectedModules: string[];
    testFilesAffected: string[];
    suggestedTestScope: string[];
}
/**
 * TraceExploreSystem - the brain for error tracing and dependency exploration
 *
 * reduces Claude's search overhead by:
 * 1. Mapping errors to known root causes
 * 2. Caching successful search patterns
 * 3. Pre-computing dependency graphs
 * 4. Learning from solution history
 */
export declare class TraceExploreSystem {
    private db;
    private embeddingProvider;
    private isInitialized;
    private traceCache;
    private bugPatternCache;
    private searchPatternCache;
    private dependencyGraph;
    private metrics;
    constructor(db: DatabaseManager, embeddingProvider?: EmbeddingProvider | null);
    /**
     * Initialize the trace/explore system
     * Sets up tables and loads caches
     */
    initialize(): Promise<void>;
    /**
     * Ensure all required tables exist
     */
    private ensureTables;
    /**
     * Load hot data into in-memory caches
     */
    private loadCaches;
    /**
     * Trace an error to find likely root causes
     * This is THE key method for reducing search overhead
     */
    traceError(errorMessage: string, stackTrace?: string): Promise<TraceResult>;
    /**
     * Generate a normalized error signature for matching
     */
    private generateErrorSignature;
    /**
     * Build a trace result with all relevant information
     */
    private buildTraceResult;
    /**
     * Find similar traces using vector similarity
     */
    private findSimilarTraces;
    /**
     * Infer potential root causes from error message
     */
    private inferRootCauses;
    /**
     * Find similar bug patterns
     */
    private findSimilarBugPatterns;
    /**
     * Extract error types from message
     */
    private extractErrorTypes;
    /**
     * Update trace hit count
     */
    private updateTraceHit;
    /**
     * Explore dependencies of a file
     * Shows what a file imports and what imports it
     */
    exploreDependencies(filePath: string, depth?: number): Promise<{
        file: string;
        imports: string[];
        importedBy: string[];
        dependencyChain: string[][];
        totalDependencies: number;
    }>;
    /**
     * Analyze impact of changes to a file
     * Shows what would be affected if the file changes
     */
    analyzeImpact(filePath: string): Promise<ImpactAnalysis>;
    /**
     * Record a successful trace for future lookups
     */
    recordTrace(errorMessage: string, stackTrace: string | undefined, rootCauseFiles: string[], solution?: SolutionEntry): Promise<string>;
    /**
     * Record a code relationship
     */
    recordRelationship(fromFilePath: string, toFilePath: string, relationshipType: RelationshipType, strength?: number): Promise<void>;
    /**
     * Cache a search pattern for future use
     */
    cacheSearchPattern(searchQuery: string, resultFilePaths: string[]): Promise<void>;
    /**
     * Look up cached search results
     */
    getCachedSearchResults(searchQuery: string): Promise<string[] | null>;
    /**
     * Hash a string for cache keys
     */
    private hashString;
    /**
     * Get system metrics
     */
    getMetrics(): typeof this.metrics & {
        traceCacheHitRate: number;
        bugPatternCacheHitRate: number;
        searchCacheHitRate: number;
        estimatedSearchReduction: number;
    };
    /**
     * Shutdown and cleanup
     */
    shutdown(): Promise<void>;
}
/**
 * Get the singleton trace/explore system instance
 */
export declare function getTraceExploreSystem(db?: DatabaseManager, embeddingProvider?: EmbeddingProvider): TraceExploreSystem;
/**
 * Reset the singleton (for testing)
 */
export declare function resetTraceExploreSystem(): void;
//# sourceMappingURL=traceExploreSystem.d.ts.map