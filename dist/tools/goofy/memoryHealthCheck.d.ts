/**
 * memoryHealthCheck.ts - MEMORY SYSTEM HEALTH AND MAINTENANCE
 *
 * This tool provides:
 * 1. Memory health overview (fading memories, association strength)
 * 2. Maintenance operations (decay associations, clean up)
 * 3. Memory strength updates (reinforce important memories)
 * 4. System statistics (quadrants, chains, associations)
 *
 * Think of this as the "memory doctor" - it keeps the memory system healthy.
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
import { DatabaseManager } from '../../database.js';
import { EmbeddingProvider, ImportanceLevelType } from '../../types/index.js';
import { MemoryStrength } from '../../memory/humanLikeMemory.js';
interface HealthCheckInput {
    operation: 'overview' | 'fading_memories' | 'decay_associations' | 'reinforce_memory' | 'stats' | 'regenerate_embeddings';
    fadingThreshold?: number;
    limit?: number;
    memoryId?: string;
    wasSuccessfulRecall?: boolean;
    importance?: ImportanceLevelType;
    dryRun?: boolean;
    batchSize?: number;
}
interface HealthCheckResult {
    success: boolean;
    data: {
        totalMemories?: number;
        strongMemories?: number;
        fadingMemories?: number;
        totalAssociations?: number;
        totalChains?: number;
        totalQuadrants?: number;
        avgRetrievability?: number;
        avgStability?: number;
        fadingList?: Array<{
            memoryId: string;
            content: string;
            importance: string;
            retrievability: number;
            stability: number;
            daysSinceAccess: number;
        }>;
        associationsDecayed?: number;
        updatedStrength?: MemoryStrength;
        stats?: Record<string, unknown>;
        nullEmbeddings?: number;
        regenerated?: number;
        failed?: number;
        failedIds?: string[];
    };
    message: string;
}
/**
 * MemoryHealthCheck - System Health and Maintenance Tool
 *
 * Use this to:
 * 1. Monitor overall memory system health
 * 2. Find memories that are "fading" and need reinforcement
 * 3. Run maintenance tasks (decay old associations)
 * 4. Manually reinforce important memories
 */
export declare class MemoryHealthCheck implements MCPTool<HealthCheckInput, HealthCheckResult> {
    private db;
    private embeddingProvider;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            operation: {
                type: string;
                enum: string[];
                description: string;
            };
            fadingThreshold: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
            limit: {
                type: string;
                default: number;
                description: string;
            };
            memoryId: {
                type: string;
                format: string;
                description: string;
            };
            wasSuccessfulRecall: {
                type: string;
                default: boolean;
                description: string;
            };
            importance: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            dryRun: {
                type: string;
                default: boolean;
                description: string;
            };
            batchSize: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
        };
        required: string[];
    };
    private memorySystem;
    constructor(db: DatabaseManager, embeddingProvider: EmbeddingProvider);
    execute(params: HealthCheckInput): Promise<HealthCheckResult>;
    /**
     * Get overall memory system health overview
     */
    private getOverview;
    /**
     * Get list of fading memories that need attention
     */
    private getFadingMemories;
    /**
     * Decay old associations (maintenance task)
     */
    private decayAssociations;
    /**
     * Manually reinforce a memory's strength
     */
    private reinforceMemory;
    /**
     * Get detailed system statistics
     */
    private getDetailedStats;
    /**
     * REGENERATE EMBEDDINGS - Fix memories with NULL or missing embeddings
     *
     * This operation:
     * 1. Finds all memories with NULL embeddings
     * 2. Generates proper ML embeddings using the embedding provider
     * 3. Updates the database with the new embeddings
     *
     * IMPORTANT: This uses the ML embedding provider (NOT hash fallback!)
     * Hash embeddings are in a different vector space and would corrupt search.
     *
     * Use dryRun=true to see what would be fixed without making changes.
     */
    private regenerateEmbeddings;
}
export default MemoryHealthCheck;
//# sourceMappingURL=memoryHealthCheck.d.ts.map