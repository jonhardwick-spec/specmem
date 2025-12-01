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
import { logger } from '../utils/logger.js';
const adaptiveConfigCache = new Map();
/**
 * Config refresh interval (5 minutes)
 */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
/**
 * Min vectors needed for reliable semantic search
 */
const MIN_VECTORS_FOR_SEMANTIC = 100;
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
export async function getAdaptiveSearchConfig(pool, forceRefresh = false, projectPath) {
    const now = Date.now();
    // Use database name as project identifier if projectPath not provided
    // This ensures per-project isolation when multiple projects share same process
    const cacheKey = projectPath || pool.options?.database || 'default';
    const cached = adaptiveConfigCache.get(cacheKey);
    // Return cached config if fresh
    if (!forceRefresh && cached && (now - cached.timestamp) < REFRESH_INTERVAL_MS) {
        logger.debug({ cacheKey }, 'Using cached adaptive search config');
        return cached.config;
    }
    try {
        logger.debug({ cacheKey }, 'Refreshing adaptive search config...');
        // Get total vector count
        const vectorCountResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM memories
      WHERE embedding IS NOT NULL
    `);
        const totalVectors = parseInt(vectorCountResult.rows[0]?.count || '0', 10);
        // Calculate adaptive parameters
        const config = calculateAdaptiveParams(totalVectors);
        // Cache it with project key
        adaptiveConfigCache.set(cacheKey, { config, timestamp: now });
        logger.info({
            cacheKey,
            totalVectors,
            threshold: config.similarityThreshold,
            limit: config.resultLimit,
            quality: config.qualityScore
        }, 'Adaptive search config refreshed');
        return config;
    }
    catch (err) {
        logger.error({ err, cacheKey }, 'Failed to get adaptive search config');
        // Return fallback config
        return {
            totalVectors: 0,
            similarityThreshold: 0.1, // Very permissive fallback
            resultLimit: 10,
            hasEnoughData: false,
            lastRefresh: new Date(),
            qualityScore: 0
        };
    }
}
/**
 * Calculate optimal search parameters based on vector count
 *
 * Logic:
 * - More vectors = higher threshold (can be pickier)
 * - Fewer vectors = lower threshold (need to be lenient)
 * - Result limit scales with available data
 *
 * @param totalVectors Total vectors in database
 * @returns Adaptive configuration
 */
function calculateAdaptiveParams(totalVectors) {
    const hasEnoughData = totalVectors >= MIN_VECTORS_FOR_SEMANTIC;
    let similarityThreshold;
    let resultLimit;
    let qualityScore;
    if (totalVectors === 0) {
        // No vectors - ultra permissive (will still return empty but gracefully)
        similarityThreshold = 0;
        resultLimit = 0;
        qualityScore = 0;
    }
    else if (totalVectors < 100) {
        // Very few vectors - be VERY lenient
        similarityThreshold = 0.05;
        resultLimit = Math.min(totalVectors, 10);
        qualityScore = totalVectors / 100; // 0-1 scale
    }
    else if (totalVectors < 1000) {
        // Small dataset - lenient threshold
        similarityThreshold = 0.1;
        resultLimit = Math.min(totalVectors, 25);
        qualityScore = 0.5 + (totalVectors / 2000); // 0.5-1.0 scale
    }
    else if (totalVectors < 10000) {
        // Medium dataset - moderate threshold
        similarityThreshold = 0.15;
        resultLimit = 50;
        qualityScore = 0.8;
    }
    else if (totalVectors < 50000) {
        // Large dataset - can be pickier
        similarityThreshold = 0.2;
        resultLimit = 100;
        qualityScore = 0.9;
    }
    else {
        // Huge dataset - be selective
        similarityThreshold = 0.25;
        resultLimit = 200;
        qualityScore = 1.0;
    }
    return {
        totalVectors,
        similarityThreshold,
        resultLimit,
        hasEnoughData,
        lastRefresh: new Date(),
        qualityScore
    };
}
/**
 * Force refresh adaptive config
 * Call this after bulk memory operations (import, delete, consolidation)
 * @param pool PostgreSQL pool
 * @param projectPath Optional project path for cache key
 */
export async function refreshAdaptiveConfig(pool, projectPath) {
    logger.debug({ projectPath }, 'Force refreshing adaptive search config');
    return getAdaptiveSearchConfig(pool, true, projectPath);
}
/**
 * Get human-readable explanation of current config
 */
export function explainAdaptiveConfig(config) {
    const { totalVectors, similarityThreshold, resultLimit, hasEnoughData, qualityScore } = config;
    let explanation = `Adaptive Search Config:\n`;
    explanation += `- Total vectors in DB: ${totalVectors.toLocaleString()}\n`;
    explanation += `- Similarity threshold: ${(similarityThreshold * 100).toFixed(1)}%\n`;
    explanation += `- Result limit: ${resultLimit}\n`;
    explanation += `- Data quality: ${(qualityScore * 100).toFixed(0)}%\n`;
    explanation += `- Semantic search: ${hasEnoughData ? 'READY' : 'LIMITED DATA'}\n`;
    if (!hasEnoughData) {
        explanation += `\nℹ️ Database has fewer than ${MIN_VECTORS_FOR_SEMANTIC} vectors.\n`;
        explanation += `Add more memories for better search quality.\n`;
    }
    return explanation;
}
/**
 * Clear cached config (for testing or project cleanup)
 * @param projectPath Optional project path to clear specific cache, or clear all if not specified
 */
export function clearAdaptiveConfigCache(projectPath) {
    if (projectPath) {
        adaptiveConfigCache.delete(projectPath);
        logger.debug({ projectPath }, 'Adaptive config cache cleared for project');
    }
    else {
        adaptiveConfigCache.clear();
        logger.debug('All adaptive config caches cleared');
    }
}
//# sourceMappingURL=adaptiveSearchConfig.js.map