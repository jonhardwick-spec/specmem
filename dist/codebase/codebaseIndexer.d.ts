/**
 * codebaseIndexer.ts - Intelligent Codebase Indexing System
 *
 * yo this indexer is the BRAINS of the operation fr fr
 * scans the codebase (configurable via SPECMEM_CODEBASE_PATH), stores it with embeddings
 * and keeps it updated automatically when files change
 *
 * Features:
 * - Full recursive codebase scanning
 * - Smart exclusions (node_modules, .git, dist, etc.)
 * - File type detection and language awareness
 * - Embedding generation for semantic search
 * - Auto-update via file watching
 * - Incremental updates (only changed files)
 * - Code definition extraction (functions, classes, etc.)
 * - Dependency/import tracking
 * - Code complexity metrics
 * - Semantic code chunking for better search
 *
 * Now integrated with LWJEB event bus for codebase:scan events
 * and enhanced with CodeAnalyzer for semantic code understanding
 */
import { EmbeddingProvider } from '../tools/index.js';
import { DatabaseManager } from '../database.js';
import { AnalysisResult, CodeDefinition, CodeDependency, CodeChunk, CodeComplexity } from './codeAnalyzer.js';
/**
 * IndexedFile - representation of a file in the index
 */
export interface IndexedFile {
    id: string;
    filePath: string;
    absolutePath: string;
    fileName: string;
    extension: string;
    language: string;
    content: string;
    contentHash: string;
    sizeBytes: number;
    lineCount: number;
    lastModified: Date;
    lastIndexed: Date;
    embedding?: number[];
    analysis?: AnalysisResult;
}
/**
 * CodebaseIndexerConfig - configuration options
 */
export interface CodebaseIndexerConfig {
    codebasePath: string;
    excludePatterns: string[];
    includeExtensions: string[];
    maxFileSizeBytes: number;
    generateEmbeddings: boolean;
    watchForChanges: boolean;
    debounceMs: number;
    batchSize: number;
    maxDepth: number;
    extractDefinitions: boolean;
    trackDependencies: boolean;
    calculateComplexity: boolean;
    chunkCode: boolean;
    chunkSize: number;
    chunkOverlap: number;
    generateChunkEmbeddings: boolean;
}
/**
 * IndexStats - statistics about the index
 */
export interface IndexStats {
    totalFiles: number;
    totalBytes: number;
    totalLines: number;
    filesWithEmbeddings: number;
    languageBreakdown: Record<string, number>;
    lastFullScan: Date | null;
    lastUpdate: Date | null;
    isWatching: boolean;
    totalDefinitions: number;
    totalDependencies: number;
    totalChunks: number;
    chunksWithEmbeddings: number;
    avgComplexity: number;
    definitionBreakdown: Record<string, number>;
}
/**
 * CodebaseIndexer - the main indexing engine
 *
 * scans your entire codebase and makes it searchable
 * uses embeddings for semantic search no cap
 *
 * Emits LWJEB events: codebase:scan:start, codebase:scan:complete, codebase:scan:progress, codebase:file:indexed
 *
 * Now enhanced with:
 * - Code definition extraction (functions, classes, etc.)
 * - Dependency/import tracking
 * - Code complexity metrics
 * - Semantic code chunking
 */
export declare class CodebaseIndexer {
    private config;
    private index;
    private embeddingProvider;
    private db;
    private watcher;
    private isWatching;
    private lastFullScan;
    private lastUpdate;
    private pendingUpdates;
    private updateTimer;
    private isProcessing;
    private codeAnalyzer;
    private definitionsIndex;
    private dependenciesIndex;
    private chunksIndex;
    private complexityIndex;
    private dimensionService;
    constructor(config?: Partial<CodebaseIndexerConfig>, embeddingProvider?: EmbeddingProvider | null, db?: DatabaseManager | null);
    /**
     * Get the DimensionService (lazy initialization)
     */
    private getDimService;
    /**
     * Prepare embedding for database storage - projects to target dimension if needed.
     * Uses DimensionService to handle dimension mismatches.
     *
     * @param embedding - The raw embedding from the embedding provider
     * @param tableName - Target table for dimension lookup
     * @param originalText - Original text for re-embedding if needed
     * @returns Formatted embedding string for PostgreSQL, or null if no embedding
     */
    private prepareEmbeddingForStorage;
    /**
     * Get coordinator lazily to avoid circular dependency during initialization
     */
    private getCoordinatorSafe;
    /**
     * initialize - starts the indexer with initial scan
     */
    initialize(): Promise<IndexStats>;
    /**
     * fullScan - performs a complete scan of the codebase
     * OPTIMIZED: Skips unchanged files using hash comparison against DB
     * Emits LWJEB events: codebase:scan:start, codebase:scan:progress, codebase:scan:complete
     */
    fullScan(): Promise<void>;
    /**
     * fullScanParallel - OPTIMIZED scan with parallel batch embedding
     * Uses session watcher pattern: collect → parallel embed → batch insert with ACK
     *
     * Key optimizations:
     * 1. Two-pass scan: metadata first, then batch embeddings
     * 2. Dynamic batch sizing based on file count
     * 3. Parallel embedding generation with Promise.all()
     * 4. ACK verification with RETURNING clause
     * 5. Progress streaming with rate limiting
     * 6. Memory-efficient: don't store full content in memory
     * 7. Concurrency limits to prevent OOM crashes
     */
    fullScanParallel(): Promise<void>;
    /**
     * persistBatchWithAck - persist files with ACK verification using RETURNING
     */
    private persistBatchWithAck;
    /**
     * persistDefinitionsWithAck - persist code definitions with embeddings and ACK
     */
    private persistDefinitionsWithAck;
    /**
     * findFiles - recursively finds all indexable files
     */
    private findFiles;
    /**
     * shouldExclude - checks if path should be excluded
     */
    private shouldExclude;
    /**
     * shouldInclude - checks if file should be included
     */
    private shouldInclude;
    /**
     * indexFile - reads and indexes a single file with enhanced analysis
     */
    private indexFile;
    /**
     * shouldAnalyze - determines if a file should get enhanced analysis
     */
    private shouldAnalyze;
    /**
     * generateChunkEmbeddings - generates embeddings for code chunks
     */
    private generateChunkEmbeddings;
    /**
     * isBinaryFile - checks if file is binary
     */
    private isBinaryFile;
    /**
     * detectLanguage - determines file language
     */
    private detectLanguage;
    /**
     * hashContent - generates SHA256 hash of content
     */
    private hashContent;
    /**
     * createEmbeddingText - creates optimal text for embedding
     */
    private createEmbeddingText;
    /**
     * startWatching - begins watching for file changes
     */
    private startWatching;
    /**
     * queueUpdate - queues a file update for batch processing
     */
    private queueUpdate;
    /**
     * processPendingUpdates - processes all queued updates
     * Emits incremental scan events via LWJEB
     */
    private processPendingUpdates;
    /**
     * persistToDatabase - stores files and enhanced analysis in the database
     * Uses RETURNING to get the actual file ID (handles ON CONFLICT cases)
     * to prevent foreign key violations when inserting code_chunks
     */
    private persistToDatabase;
    /**
     * persistAnalysis - stores enhanced analysis data in the database
     * All tables are scoped by project_path for data isolation
     */
    private persistAnalysis;
    /**
     * getLanguageType - determines language type category
     */
    private getLanguageType;
    /**
     * stopWatching - stops the file watcher
     */
    stopWatching(): Promise<void>;
    /**
     * getFile - retrieves a file by relative path
     */
    getFile(relativePath: string): IndexedFile | undefined;
    /**
     * getAllFiles - returns all indexed files
     */
    getAllFiles(): IndexedFile[];
    /**
     * searchByPath - searches files by path pattern
     */
    searchByPath(pattern: string): IndexedFile[];
    /**
     * searchByContent - searches files by content
     */
    searchByContent(query: string): IndexedFile[];
    /**
     * searchByLanguage - returns all files of a language
     */
    searchByLanguage(language: string): IndexedFile[];
    /**
     * getCodebaseOverview - returns a summary of the codebase
     */
    getCodebaseOverview(): string;
    /**
     * getStats - returns indexer statistics including enhanced analysis metrics
     */
    getStats(): IndexStats;
    /**
     * shutdown - cleanup resources
     */
    shutdown(): Promise<void>;
    /**
     * getDefinitions - returns all definitions for a file
     */
    getDefinitions(filePath: string): CodeDefinition[];
    /**
     * getAllDefinitions - returns all definitions across all files
     */
    getAllDefinitions(): CodeDefinition[];
    /**
     * searchDefinitions - searches for definitions by name
     */
    searchDefinitions(query: string): CodeDefinition[];
    /**
     * getDefinitionsByType - returns all definitions of a specific type
     */
    getDefinitionsByType(type: string): CodeDefinition[];
    /**
     * getDependencies - returns all dependencies for a file
     */
    getDependencies(filePath: string): CodeDependency[];
    /**
     * getAllDependencies - returns all dependencies across all files
     */
    getAllDependencies(): CodeDependency[];
    /**
     * getDependentsOf - returns files that import the given path
     */
    getDependentsOf(targetPath: string): CodeDependency[];
    /**
     * getExternalDependencies - returns all external (npm) dependencies
     */
    getExternalDependencies(): CodeDependency[];
    /**
     * getChunks - returns all chunks for a file
     */
    getChunks(filePath: string): CodeChunk[];
    /**
     * getAllChunks - returns all chunks across all files
     */
    getAllChunks(): CodeChunk[];
    /**
     * getComplexity - returns complexity metrics for a file
     */
    getComplexity(filePath: string): CodeComplexity | undefined;
    /**
     * getHighComplexityFiles - returns files with high cyclomatic complexity
     */
    getHighComplexityFiles(threshold?: number): CodeComplexity[];
    /**
     * getLowMaintainabilityFiles - returns files with low maintainability index
     */
    getLowMaintainabilityFiles(threshold?: number): CodeComplexity[];
    /**
     * findSimilarChunks - finds chunks similar to the query using embeddings
     * Returns chunks with similarity scores
     */
    findSimilarChunks(query: string, limit?: number): Promise<Array<{
        chunk: CodeChunk;
        similarity: number;
    }>>;
    /**
     * cosineSimilarity - calculates cosine similarity between two vectors
     */
    private cosineSimilarity;
    /**
     * getDependencyGraph - returns a dependency graph for visualization
     */
    getDependencyGraph(): {
        nodes: string[];
        edges: Array<{
            from: string;
            to: string;
        }>;
    };
}
/**
 * getCodebaseIndexer - returns indexer instance for current project
 * uses Map pattern to isolate instances per project
 */
export declare function getCodebaseIndexer(config?: Partial<CodebaseIndexerConfig>, embeddingProvider?: EmbeddingProvider, db?: DatabaseManager, projectPath?: string): CodebaseIndexer;
/**
 * resetCodebaseIndexer - resets the indexer for a project (for testing)
 */
export declare function resetCodebaseIndexer(projectPath?: string): void;
/**
 * resetAllCodebaseIndexers - resets all indexer instances (for testing)
 */
export declare function resetAllCodebaseIndexers(): void;
//# sourceMappingURL=codebaseIndexer.d.ts.map