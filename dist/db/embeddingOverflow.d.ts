/**
 * embeddingOverflow.ts - PostgreSQL Overflow for Embedding Cache
 *
 * Handles persistence of embedding cache to PostgreSQL when memory pressure
 * requires overflow. Implements the OverflowHandler interface.
 *
 * @author hardwicksoftwareservices
 */
import { DatabaseManager } from '../database.js';
import { CacheEntry, OverflowHandler } from '../utils/memoryManager.js';
/**
 * PostgreSQL-based overflow handler for embedding cache
 */
export declare class EmbeddingOverflowHandler implements OverflowHandler {
    private db;
    private initialized;
    private dimensionService;
    constructor(db: DatabaseManager);
    /**
     * Get the DimensionService (lazy initialization)
     */
    private getDimService;
    /**
     * Get vector column definition dynamically from database
     */
    private getVectorColumnDef;
    /**
     * Prepare embedding for storage - validates and projects dimension if needed
     */
    private prepareEmbedding;
    /**
     * Initialize the overflow table in PostgreSQL
     */
    initialize(): Promise<void>;
    /**
     * Move embedding entries to PostgreSQL
     */
    moveToPostgres(entries: CacheEntry<number[]>[]): Promise<number>;
    /**
     * Load embeddings from PostgreSQL overflow
     */
    loadFromPostgres(keys: string[]): Promise<Map<string, number[]>>;
    /**
     * Clear all overflow data
     */
    clearOverflow(): Promise<void>;
    /**
     * Get overflow statistics
     */
    getStats(): Promise<{
        totalEntries: number;
        totalSize: number;
        oldestEntry: Date | null;
        newestEntry: Date | null;
    }>;
    /**
     * Cleanup old overflow entries (LRU eviction from overflow)
     */
    cleanup(maxEntries?: number): Promise<number>;
    /**
     * Parse embedding from PostgreSQL vector format
     */
    private parseEmbedding;
}
/**
 * Create an embedding overflow handler
 */
export declare function createEmbeddingOverflowHandler(db: DatabaseManager): EmbeddingOverflowHandler;
//# sourceMappingURL=embeddingOverflow.d.ts.map