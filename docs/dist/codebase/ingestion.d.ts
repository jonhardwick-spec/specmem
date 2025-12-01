import { LanguageInfo } from './languageDetection.js';
import { ConnectionPoolGoBrrr } from '../db/connectionPoolGoBrrr.js';
import { EmbeddingProvider } from '../tools/index.js';
/**
 * CodebaseFile - what we know about each file
 */
export interface CodebaseFile {
    id: string;
    filePath: string;
    absolutePath: string;
    fileName: string;
    extension: string;
    language: LanguageInfo;
    content: string;
    contentHash: string;
    sizeBytes: number;
    lineCount: number;
    charCount: number;
    lastModified: Date;
    chunkIndex?: number;
    totalChunks?: number;
    originalFileId?: string;
    embedding?: number[];
}
/**
 * IngestionProgress - tracks progress during ingestion
 */
export interface IngestionProgress {
    phase: 'scanning' | 'reading' | 'embedding' | 'storing' | 'complete' | 'error';
    totalFiles: number;
    processedFiles: number;
    skippedFiles: number;
    errorFiles: number;
    currentFile: string;
    bytesProcessed: number;
    linesProcessed: number;
    startTime: number;
    estimatedTimeRemaining: number;
    filesPerSecond: number;
}
/**
 * IngestionResult - final summary
 */
export interface IngestionResult {
    success: boolean;
    rootPath: string;
    totalFiles: number;
    storedFiles: number;
    chunkedFiles: number;
    skippedFiles: number;
    errorFiles: number;
    totalBytes: number;
    totalLines: number;
    totalChunks: number;
    languageBreakdown: Record<string, number>;
    duration: number;
    errors: Array<{
        file: string;
        error: string;
    }>;
}
/**
 * IngestionOptions - customization for the ingestion process
 */
export interface IngestionOptions {
    rootPath: string;
    additionalExclusions?: string[];
    maxFileSizeBytes?: number;
    chunkSizeChars?: number;
    chunkOverlapChars?: number;
    generateEmbeddings?: boolean;
    embeddingBatchSize?: number;
    parallelReads?: number;
    onProgress?: (progress: IngestionProgress) => void;
    includeHiddenFiles?: boolean;
    maxDepth?: number;
}
/**
 * IngestThisWholeAssMfCodebase - the BEAST that ingests entire codebases
 *
 * features that go CRAZY:
 * - recursive directory scanning
 * - smart exclusions (.gitignore style)
 * - language detection for all files
 * - automatic chunking for large files
 * - parallel processing for SPEED
 * - progress tracking
 * - embedding generation
 * - batch database insertion
 */
export declare class IngestThisWholeAssMfCodebase {
    private pool;
    private embeddingProvider;
    private exclusionHandler;
    private languageDetector;
    private progress;
    private options;
    constructor(pool: ConnectionPoolGoBrrr, embeddingProvider?: EmbeddingProvider | null);
    private initProgress;
    /**
     * ingest - main entry point for codebase ingestion
     * this is where the magic happens fr fr
     */
    ingest(options: IngestionOptions): Promise<IngestionResult>;
    /**
     * scanDirectory - recursively find all files
     */
    private scanDirectory;
    /**
     * processFile - read and process a single file
     * returns array because large files get chunked
     */
    private processFile;
    /**
     * chunkFile - splits large files into manageable chunks
     * preserves line boundaries for clean splits
     */
    private chunkFile;
    /**
     * generateEmbeddings - batch generate embeddings for all files
     */
    private generateEmbeddings;
    /**
     * createEmbeddingText - creates optimal text for embedding
     */
    private createEmbeddingText;
    /**
     * storeFiles - batch insert files into database with parallel processing
     * Note: content_hash is a GENERATED ALWAYS column, so we don't include it in INSERT
     * Task #37 FIX: Now uses processBatchesWithConcurrency for 3-5x speedup
     */
    private storeFiles;
    /**
     * hashContent - sha256 hash of content
     */
    private hashContent;
    /**
     * updateProgressStats - recalculate progress metrics
     */
    private updateProgressStats;
    /**
     * emitProgress - send progress update to callback
     */
    private emitProgress;
    /**
     * getProgress - get current progress
     */
    getProgress(): IngestionProgress;
}
/**
 * YeetAllFilesIntoMemory - batch insert for already-processed files
 * use this when you have files ready to store
 * Note: content_hash is GENERATED ALWAYS, so we don't include it in INSERT
 * Task #37 FIX: Now uses parallel batch processing for massive speedup
 */
export declare class YeetAllFilesIntoMemory {
    private pool;
    private embeddingProvider;
    constructor(pool: ConnectionPoolGoBrrr, embeddingProvider?: EmbeddingProvider | null);
    /**
     * yeet - insert multiple files with parallel batch processing
     * Task #37 FIX: Was doing one-by-one sequential inserts, now does parallel batches
     */
    yeet(files: CodebaseFile[]): Promise<{
        inserted: number;
        duplicates: number;
        errors: number;
    }>;
    /**
     * createEmbeddingText - creates optimal text for embedding generation
     */
    private createEmbeddingText;
}
export declare function getIngestionEngine(pool: ConnectionPoolGoBrrr, embeddingProvider?: EmbeddingProvider, projectPath?: string): IngestThisWholeAssMfCodebase;
export declare function resetIngestionEngine(projectPath?: string): void;
export declare function resetAllIngestionEngines(): void;
//# sourceMappingURL=ingestion.d.ts.map