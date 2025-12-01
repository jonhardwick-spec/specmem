/**
 * adaptiveSearchConfig.ts - Auto-Adjusting Search Parameters
 *
 * Dynamically adjusts vector search parameters based on actual database state.
 * This prevents "nah" empty results by adapting to what's actually available.
 *
 * Features:
 * - Auto-detects total vector count in database
 * - Adjusts similarity threshold based on vector density
 * - Adjusts result limit based on available data
 * - Caches config for performance (refreshes every 5 min)
 *
 * @author hardwicksoftwareservices
 */
import type { Pool } from 'pg';
/**
 * Adaptive search configuration
 */
export interface AdaptiveSearchConfig {
    /** Total vectors in database */
    totalVectors: number;
    /** Recommended similarity threshold (0-1) */
    similarityThreshold: number;
    /** Recommended result limit */
    resultLimit: number;
    /** Whether database has enough data for semantic search */
    hasEnoughData: boolean;
    /** Last config refresh timestamp */
    lastRefresh: Date;
    /** Config quality score (0-1, higher = more reliable) */
    qualityScore: number;
}
/**
 * Get adaptive search configuration based on database state
 *
 * This function:
 * 1. Checks total vector count in database
 * 2. Calculates optimal thresholds based on data density
 * 3. Adjusts search parameters to match what's available
 * 4. Caches result for 5 minutes per project
 *
 * @param pool PostgreSQL pool
 * @param forceRefresh Force refresh even if cached
 * @param projectPath Optional project path for cache key (uses pool config if not provided)
 * @returns Adaptive search configuration
 */
export declare function getAdaptiveSearchConfig(pool: Pool, forceRefresh?: boolean, projectPath?: string): Promise<AdaptiveSearchConfig>;
/**
 * Force refresh adaptive config
 * Call this after bulk memory operations (import, delete, consolidation)
 * @param pool PostgreSQL pool
 * @param projectPath Optional project path for cache key
 */
export declare function refreshAdaptiveConfig(pool: Pool, projectPath?: string): Promise<AdaptiveSearchConfig>;
/**
 * Get human-readable explanation of current config
 */
export declare function explainAdaptiveConfig(config: AdaptiveSearchConfig): string;
/**
 * Clear cached config (for testing or project cleanup)
 * @param projectPath Optional project path to clear specific cache, or clear all if not specified
 */
export declare function clearAdaptiveConfigCache(projectPath?: string): void;
//# sourceMappingURL=adaptiveSearchConfig.d.ts.map