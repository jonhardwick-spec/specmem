/**
 * DimensionAdapter - Centralized Dimension Detection and Adaptation System
 *
 * This module provides a complete solution for handling embedding dimension mismatches
 * across all vector columns in the database. It:
 *
 * 1. Detects dimensions from ALL tables with vector columns (not just memories)
 * 2. Provides transparent adapters for INSERT and SELECT operations
 * 3. Caches dimension info to avoid repeated queries
 * 4. Integrates with the projection layer for dimension transformation
 *
 * Single Source of Truth: Database pg_attribute table
 *
 * @author specmem team
 */
import type { DatabaseManager } from '../database.js';
import type { EmbeddingProvider } from '../types/index.js';
import { getProjectionInfo } from '../embeddings/projectionLayer.js';
/**
 * Detected vector column information
 */
export interface VectorColumnInfo {
    tableName: string;
    columnName: string;
    dimension: number | null;
    hasIndex: boolean;
    indexType?: 'ivfflat' | 'hnsw' | 'btree' | 'other';
}
/**
 * Result of dimension detection across all tables
 */
export interface DimensionDetectionResult {
    success: boolean;
    canonicalDimension: number | null;
    tables: VectorColumnInfo[];
    inconsistencies: Array<{
        table: string;
        column: string;
        dimension: number | null;
        expected: number;
    }>;
    detectedAt: Date;
}
/**
 * Adapter result for embedding operations
 */
export interface AdaptedEmbedding {
    embedding: number[];
    originalDimension: number;
    targetDimension: number;
    wasAdapted: boolean;
    adaptationMethod: 'none' | 'projection' | 'scaling' | 'reembedding';
}
/**
 * Centralized adapter for embedding dimension management.
 *
 * Features:
 * - Auto-detection of all vector columns in database
 * - Transparent dimension adaptation for INSERT/SELECT
 * - Caching with configurable TTL
 * - Integration with projection layer
 * - Logging of all dimension mismatches
 */
export declare class DimensionAdapter {
    private db;
    private embeddingProvider;
    private dimensionCache;
    private canonicalDimension;
    private canonicalDimensionTimestamp;
    private readonly CACHE_TTL_MS;
    private initialized;
    /**
     * Known tables with embedding columns.
     * This list is used as a hint but actual detection queries all tables.
     */
    private static readonly KNOWN_EMBEDDING_TABLES;
    constructor(db: DatabaseManager, embeddingProvider?: EmbeddingProvider, cacheTTLMs?: number);
    /**
     * Set/update the embedding provider
     */
    setEmbeddingProvider(provider: EmbeddingProvider): void;
    /**
     * Initialize the adapter by detecting all dimensions.
     * Should be called after database is ready.
     */
    initialize(): Promise<DimensionDetectionResult>;
    /**
     * Detect dimensions from ALL tables with vector columns.
     * Queries pg_attribute for comprehensive detection.
     */
    detectAllDimensions(): Promise<DimensionDetectionResult>;
    /**
     * Detect the index type for a vector column
     */
    private detectIndexType;
    /**
     * Get the canonical dimension (from memories table).
     * Uses cache with TTL.
     */
    getCanonicalDimension(forceRefresh?: boolean): Promise<number | null>;
    /**
     * Get dimension for a specific table/column.
     * Uses cache with TTL.
     */
    getTableDimension(tableName: string, columnName?: string): Promise<number | null>;
    /**
     * Adapt an embedding for insertion into a specific table.
     * Automatically detects dimension mismatch and applies projection.
     *
     * @param embedding - The embedding to adapt
     * @param tableName - Target table name
     * @param columnName - Target column name (default: 'embedding')
     * @param originalText - Original text for re-embedding if available
     * @returns Adapted embedding with metadata
     */
    adaptForInsert(embedding: number[], tableName: string, columnName?: string, originalText?: string): Promise<AdaptedEmbedding>;
    /**
     * Adapt an embedding for a SELECT/search operation.
     * Query embeddings must match the table's dimension.
     *
     * @param queryEmbedding - The query embedding
     * @param tableName - Table to search
     * @param columnName - Column to search (default: 'embedding')
     * @returns Adapted embedding
     */
    adaptForSelect(queryEmbedding: number[], tableName: string, columnName?: string): Promise<AdaptedEmbedding>;
    /**
     * Format an adapted embedding for PostgreSQL insertion.
     * Returns the string format: '[0.1,0.2,...]'
     */
    formatForPostgres(embedding: number[], tableName: string, columnName?: string, originalText?: string): Promise<string>;
    /**
     * Adapt multiple embeddings for batch insertion.
     */
    adaptBatchForInsert(embeddings: number[][], tableName: string, columnName?: string): Promise<AdaptedEmbedding[]>;
    /**
     * Clear all cached dimension info.
     */
    clearCache(): void;
    /**
     * Invalidate cache for a specific table.
     */
    invalidateTable(tableName: string): void;
    /**
     * Get cache statistics for debugging.
     */
    getCacheStats(): {
        cacheSize: number;
        canonicalDimension: number | null;
        canonicalAge: number;
        entries: Array<{
            key: string;
            dimension: number | null;
            age: number;
        }>;
    };
    /**
     * Check if the adapter is initialized.
     */
    isInitialized(): boolean;
    /**
     * Get adapter status for health checks.
     */
    getStatus(): {
        initialized: boolean;
        canonicalDimension: number | null;
        cacheSize: number;
        projectionLayerInfo: ReturnType<typeof getProjectionInfo>;
    };
}
/**
 * Get the singleton DimensionAdapter instance.
 * Must be initialized with a DatabaseManager first.
 */
export declare function getDimensionAdapter(db?: DatabaseManager, embeddingProvider?: EmbeddingProvider): DimensionAdapter;
/**
 * Reset the singleton (for testing).
 */
export declare function resetDimensionAdapter(): void;
/**
 * Initialize the dimension adapter and detect all dimensions.
 * Should be called after database initialization.
 */
export declare function initializeDimensionAdapter(db: DatabaseManager, embeddingProvider?: EmbeddingProvider): Promise<DimensionDetectionResult>;
/**
 * Quick helper to adapt an embedding for any table.
 */
export declare function adaptEmbedding(embedding: number[], tableName: string, operation?: 'insert' | 'select', originalText?: string): Promise<number[]>;
/**
 * Get the current canonical dimension.
 */
export declare function getCanonicalDimension(): Promise<number | null>;
export default DimensionAdapter;
//# sourceMappingURL=DimensionAdapter.d.ts.map