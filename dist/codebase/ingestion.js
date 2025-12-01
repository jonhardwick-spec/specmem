// yooo scanning entire codebase lets goooo
// this is the MAIN EVENT - ingestThisWholeAssMfCodebase
// we about to store MILLIONS of lines of code in memory fr fr
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { getProjectPath } from '../config.js';
import { SkipTheBoringShit, isBinaryFile, getFileSizeBytes, shouldSkipLargeFile, isMinifiedOrBundled } from './exclusions.js';
import { WhatLanguageIsThis } from './languageDetection.js';
import { processBatchesWithConcurrency, DEFAULT_CONCURRENCY_LIMIT } from '../db/batchOperations.js';
import { TEXT_LIMITS } from '../constants.js';
import { getCurrentProjectId } from '../services/ProjectContext.js';
/**
 * default options that hit different
 */
const DEFAULT_OPTIONS = {
    maxFileSizeBytes: 10 * 1024 * 1024, // 10MB max
    chunkSizeChars: 50_000, // 50K chars per chunk
    chunkOverlapChars: 1000, // 1K overlap
    generateEmbeddings: true,
    embeddingBatchSize: 50,
    parallelReads: 10,
    includeHiddenFiles: false,
    maxDepth: 50
};
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
export class IngestThisWholeAssMfCodebase {
    pool;
    embeddingProvider;
    exclusionHandler;
    languageDetector;
    progress;
    options;
    constructor(pool, embeddingProvider = null) {
        this.pool = pool;
        this.embeddingProvider = embeddingProvider;
        this.exclusionHandler = new SkipTheBoringShit();
        this.languageDetector = new WhatLanguageIsThis();
        this.options = { rootPath: '', ...DEFAULT_OPTIONS };
        this.progress = this.initProgress();
    }
    initProgress() {
        return {
            phase: 'scanning',
            totalFiles: 0,
            processedFiles: 0,
            skippedFiles: 0,
            errorFiles: 0,
            currentFile: '',
            bytesProcessed: 0,
            linesProcessed: 0,
            startTime: Date.now(),
            estimatedTimeRemaining: 0,
            filesPerSecond: 0
        };
    }
    /**
     * ingest - main entry point for codebase ingestion
     * this is where the magic happens fr fr
     */
    async ingest(options) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.progress = this.initProgress();
        const result = {
            success: false,
            rootPath: this.options.rootPath,
            totalFiles: 0,
            storedFiles: 0,
            chunkedFiles: 0,
            skippedFiles: 0,
            errorFiles: 0,
            totalBytes: 0,
            totalLines: 0,
            totalChunks: 0,
            languageBreakdown: {},
            duration: 0,
            errors: []
        };
        const startTime = Date.now();
        try {
            // verify root path exists
            const rootStats = await fs.stat(this.options.rootPath);
            if (!rootStats.isDirectory()) {
                throw new Error('rootPath must be a directory bruh');
            }
            // initialize exclusion handler with root path
            await this.exclusionHandler.initialize(this.options.rootPath);
            if (this.options.additionalExclusions?.length) {
                for (const pattern of this.options.additionalExclusions) {
                    this.exclusionHandler.addPattern(pattern);
                }
            }
            // phase 1: scan for all files
            this.progress.phase = 'scanning';
            this.emitProgress();
            logger.info({ rootPath: this.options.rootPath }, 'starting codebase scan - lets find all them files');
            const filePaths = await this.scanDirectory(this.options.rootPath, 0);
            this.progress.totalFiles = filePaths.length;
            result.totalFiles = filePaths.length;
            logger.info({ fileCount: filePaths.length }, 'scan complete - found all the files fr');
            // phase 2: read and process files
            this.progress.phase = 'reading';
            this.emitProgress();
            const files = [];
            const errors = [];
            // process files in parallel batches
            for (let i = 0; i < filePaths.length; i += this.options.parallelReads) {
                const batch = filePaths.slice(i, i + this.options.parallelReads);
                const batchResults = await Promise.allSettled(batch.map(fp => this.processFile(fp)));
                for (let j = 0; j < batchResults.length; j++) {
                    const fileResult = batchResults[j];
                    const filePath = batch[j];
                    if (fileResult?.status === 'fulfilled' && fileResult.value) {
                        const processedFiles = fileResult.value;
                        files.push(...processedFiles);
                        // update stats
                        for (const file of processedFiles) {
                            result.totalBytes += file.sizeBytes;
                            result.totalLines += file.lineCount;
                            result.languageBreakdown[file.language.id] =
                                (result.languageBreakdown[file.language.id] ?? 0) + 1;
                            if (file.chunkIndex !== undefined) {
                                result.totalChunks++;
                            }
                        }
                        this.progress.processedFiles++;
                        this.progress.bytesProcessed = result.totalBytes;
                        this.progress.linesProcessed = result.totalLines;
                    }
                    else if (fileResult?.status === 'rejected') {
                        errors.push({ file: filePath, error: String(fileResult.reason) });
                        result.errorFiles++;
                        this.progress.errorFiles++;
                    }
                    this.progress.currentFile = filePath;
                    this.updateProgressStats();
                    this.emitProgress();
                }
            }
            // count chunked files
            const chunkedFileIds = new Set(files.filter(f => f.originalFileId).map(f => f.originalFileId));
            result.chunkedFiles = chunkedFileIds.size;
            // phase 3: generate embeddings if enabled
            if (this.options.generateEmbeddings && this.embeddingProvider) {
                this.progress.phase = 'embedding';
                this.emitProgress();
                await this.generateEmbeddings(files);
            }
            // phase 4: store in database
            this.progress.phase = 'storing';
            this.emitProgress();
            const storedCount = await this.storeFiles(files);
            result.storedFiles = storedCount;
            // done!
            this.progress.phase = 'complete';
            result.success = true;
            result.duration = Date.now() - startTime;
            result.errors = errors;
            result.skippedFiles = this.exclusionHandler.getStats().totalSkipped;
            this.emitProgress();
            logger.info({
                duration: result.duration,
                totalFiles: result.totalFiles,
                storedFiles: result.storedFiles,
                chunkedFiles: result.chunkedFiles,
                totalLines: result.totalLines,
                totalBytes: result.totalBytes,
                languageCount: Object.keys(result.languageBreakdown).length
            }, 'codebase ingestion COMPLETE - we did it boys');
            return result;
        }
        catch (error) {
            this.progress.phase = 'error';
            result.success = false;
            result.errors.push({ file: 'root', error: String(error) });
            result.duration = Date.now() - startTime;
            logger.error({ error }, 'codebase ingestion FAILED');
            this.emitProgress();
            return result;
        }
    }
    /**
     * scanDirectory - recursively find all files
     */
    async scanDirectory(dirPath, depth) {
        if (depth > this.options.maxDepth) {
            logger.warn({ dirPath, depth }, 'max depth reached - skipping deeper directories');
            return [];
        }
        const files = [];
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                const relativePath = path.relative(this.options.rootPath, fullPath);
                // skip hidden files unless explicitly included
                if (!this.options.includeHiddenFiles && entry.name.startsWith('.')) {
                    continue;
                }
                // check exclusions
                if (this.exclusionHandler.shouldSkip(relativePath, entry.isDirectory())) {
                    continue;
                }
                if (entry.isDirectory()) {
                    // recurse into subdirectory
                    const subFiles = await this.scanDirectory(fullPath, depth + 1);
                    files.push(...subFiles);
                }
                else if (entry.isFile()) {
                    // check if symlink points to valid file
                    if (entry.isSymbolicLink()) {
                        try {
                            const realPath = await fs.realpath(fullPath);
                            const realStats = await fs.stat(realPath);
                            if (!realStats.isFile())
                                continue;
                        }
                        catch (e) {
                            // symlink resolution failed - log with file context for debugging
                            logger.debug({ filePath: fullPath, error: String(e) }, 'skipping broken/circular symlink');
                            continue;
                        }
                    }
                    files.push(fullPath);
                }
            }
        }
        catch (error) {
            logger.warn({ dirPath, error }, 'failed to read directory - skipping');
        }
        return files;
    }
    /**
     * processFile - read and process a single file
     * returns array because large files get chunked
     */
    async processFile(filePath) {
        const relativePath = path.relative(this.options.rootPath, filePath);
        // check minified/bundled FIRST - fast O(1) pattern check
        if (isMinifiedOrBundled(filePath)) {
            this.progress.skippedFiles++;
            return [];
        }
        // check if binary
        if (await isBinaryFile(filePath)) {
            this.progress.skippedFiles++;
            return [];
        }
        // check size - use EXCLUSION_CONFIG.maxFileSize as primary limit
        const sizeBytes = await getFileSizeBytes(filePath);
        // skip files over the hard limit (default 1MB from EXCLUSION_CONFIG)
        if (await shouldSkipLargeFile(filePath)) {
            this.progress.skippedFiles++;
            return [];
        }
        const exceedsMaxSize = sizeBytes > this.options.maxFileSizeBytes;
        // read content
        let content;
        try {
            content = await fs.readFile(filePath, 'utf-8');
        }
        catch (error) {
            logger.warn({ filePath, error }, 'failed to read file');
            throw error;
        }
        // detect language
        const language = this.languageDetector.detect(filePath, content);
        // get file stats
        const stats = await fs.stat(filePath);
        const lineCount = content.split('\n').length;
        const charCount = content.length;
        const contentHash = this.hashContent(content);
        // large files that exceed maxFileSizeBytes MUST be chunked
        // only skip if file exceeds maxFileSizeBytes AND is smaller than chunkSizeChars (cant chunk effectively)
        if (exceedsMaxSize && charCount <= this.options.chunkSizeChars) {
            logger.debug({ filePath, sizeBytes, charCount }, 'file too large but too small to chunk - skipping');
            this.progress.skippedFiles++;
            return [];
        }
        const baseFile = {
            filePath: relativePath,
            absolutePath: filePath,
            fileName: path.basename(filePath),
            extension: path.extname(filePath),
            language,
            contentHash,
            sizeBytes,
            lineCount,
            charCount,
            lastModified: stats.mtime
        };
        // chunk large files - either exceeds maxFileSizeBytes OR exceeds chunkSizeChars
        if (exceedsMaxSize || charCount > this.options.chunkSizeChars) {
            logger.debug({ filePath, sizeBytes, charCount, exceedsMaxSize }, 'chunking large file fr');
            return this.chunkFile(baseFile, content);
        }
        // single file (no chunking needed)
        return [{
                ...baseFile,
                id: uuidv4(),
                content
            }];
    }
    /**
     * chunkFile - splits large files into manageable chunks
     * preserves line boundaries for clean splits
     */
    chunkFile(baseFile, content) {
        const chunks = [];
        const originalFileId = uuidv4();
        const chunkSize = this.options.chunkSizeChars;
        const overlap = this.options.chunkOverlapChars;
        let currentPos = 0;
        let chunkIndex = 0;
        while (currentPos < content.length) {
            let endPos = Math.min(currentPos + chunkSize, content.length);
            // find a good break point (end of line) if not at the end
            if (endPos < content.length) {
                const searchStart = Math.max(endPos - 500, currentPos);
                const searchRegion = content.slice(searchStart, endPos);
                const lastNewline = searchRegion.lastIndexOf('\n');
                if (lastNewline !== -1) {
                    endPos = searchStart + lastNewline + 1;
                }
            }
            const chunkContent = content.slice(currentPos, endPos);
            chunks.push({
                ...baseFile,
                id: uuidv4(),
                content: chunkContent,
                contentHash: this.hashContent(chunkContent),
                sizeBytes: Buffer.byteLength(chunkContent, 'utf-8'),
                lineCount: chunkContent.split('\n').length,
                charCount: chunkContent.length,
                chunkIndex,
                totalChunks: -1, // will be set after
                originalFileId
            });
            // move position with overlap for context continuity
            currentPos = endPos - overlap;
            if (currentPos <= 0)
                currentPos = endPos; // prevent infinite loop
            chunkIndex++;
        }
        // set total chunks count
        for (const chunk of chunks) {
            chunk.totalChunks = chunks.length;
        }
        logger.debug({
            filePath: baseFile.filePath,
            originalChars: content.length,
            chunkCount: chunks.length
        }, 'chunked large file - fr fr this file was MASSIVE');
        return chunks;
    }
    /**
     * generateEmbeddings - batch generate embeddings for all files
     */
    async generateEmbeddings(files) {
        if (!this.embeddingProvider)
            return;
        // filter files that support embeddings
        const embeddableFiles = files.filter(f => f.language.supportsEmbeddings);
        logger.info({
            total: files.length,
            embeddable: embeddableFiles.length
        }, 'generating embeddings for embeddable files');
        const batchSize = this.options.embeddingBatchSize;
        for (let i = 0; i < embeddableFiles.length; i += batchSize) {
            const batch = embeddableFiles.slice(i, i + batchSize);
            // Prepare texts for batch embedding
            const textsForEmbedding = batch.map(file => this.createEmbeddingText(file));
            // Use BATCH API if available - 5-10x faster!
            let embeddings;
            try {
                if (this.embeddingProvider.generateEmbeddingsBatch) {
                    const batchEmbeddings = await this.embeddingProvider.generateEmbeddingsBatch(textsForEmbedding);
                    embeddings = batchEmbeddings;
                }
                else {
                    // Fallback to parallel individual calls
                    embeddings = await Promise.all(textsForEmbedding.map(async (text, idx) => {
                        try {
                            return await this.embeddingProvider.generateEmbedding(text);
                        }
                        catch (error) {
                            logger.warn({ file: batch[idx]?.filePath, error }, 'failed to generate embedding');
                            return null;
                        }
                    }));
                }
            }
            catch (error) {
                logger.warn({ batchStart: i, error }, 'batch embedding failed, falling back to individual');
                // Fallback on batch failure
                embeddings = await Promise.all(textsForEmbedding.map(async (text, idx) => {
                    try {
                        return await this.embeddingProvider.generateEmbedding(text);
                    }
                    catch (err) {
                        logger.warn({ file: batch[idx]?.filePath, error: err }, 'failed to generate embedding');
                        return null;
                    }
                }));
            }
            // store embeddings on the file objects
            for (let j = 0; j < batch.length; j++) {
                const file = batch[j];
                const embedding = embeddings[j];
                if (file && embedding) {
                    file.embedding = embedding;
                }
            }
            logger.debug({
                batch: Math.floor(i / batchSize) + 1,
                totalBatches: Math.ceil(embeddableFiles.length / batchSize)
            }, 'embedding batch complete');
        }
    }
    /**
     * createEmbeddingText - creates optimal text for embedding
     */
    createEmbeddingText(file) {
        // include file metadata for better semantic matching
        const header = `File: ${file.filePath}\nLanguage: ${file.language.name}\n`;
        // for chunks, include chunk info
        let chunkInfo = '';
        if (file.chunkIndex !== undefined) {
            chunkInfo = `Chunk ${file.chunkIndex + 1} of ${file.totalChunks}\n`;
        }
        // truncate content if needed for embedding model limits
        let content = file.content;
        if (content.length > TEXT_LIMITS.EMBEDDING_CONTENT_MAX) {
            content = content.slice(0, TEXT_LIMITS.EMBEDDING_CONTENT_MAX) + '\n...[truncated for embedding]';
        }
        return header + chunkInfo + '\n' + content;
    }
    /**
     * storeFiles - batch insert files into database with parallel processing
     * Note: content_hash is a GENERATED ALWAYS column, so we don't include it in INSERT
     * Task #37 FIX: Now uses processBatchesWithConcurrency for 3-5x speedup
     */
    async storeFiles(files) {
        if (files.length === 0)
            return 0;
        const batchSize = 100;
        let totalStored = 0;
        // PROJECT ISOLATION: Get project_id for codebase_files table
        const projectId = await getCurrentProjectId();
        // parallel batch processing - 5 concurrent batches by default
        const results = await processBatchesWithConcurrency(files, batchSize, DEFAULT_CONCURRENCY_LIMIT, async (batch, batchIndex) => {
            let batchStored = 0;
            try {
                await this.pool.transactionGang(async (client) => {
                    for (const file of batch) {
                        const embeddingStr = file.embedding ? '[' + file.embedding.join(',') + ']' : null;
                        // Note: content_hash is GENERATED ALWAYS from content, don't include it
                        // PROJECT ISOLATION: Include project_id to scope files to current project
                        await client.query('INSERT INTO codebase_files (' +
                            'id, file_path, absolute_path, file_name, extension,' +
                            'language_id, language_name, language_type,' +
                            'content, size_bytes, line_count, char_count,' +
                            'last_modified, chunk_index, total_chunks, original_file_id,' +
                            'embedding, project_id' +
                            ') VALUES (' +
                            '$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18' +
                            ')' +
                            'ON CONFLICT (content_hash) DO UPDATE SET' +
                            ' file_path = EXCLUDED.file_path,' +
                            ' last_modified = EXCLUDED.last_modified,' +
                            ' embedding = COALESCE(EXCLUDED.embedding, codebase_files.embedding)', [
                            file.id,
                            file.filePath,
                            file.absolutePath,
                            file.fileName,
                            file.extension,
                            file.language.id,
                            file.language.name,
                            file.language.type,
                            file.content,
                            file.sizeBytes,
                            file.lineCount,
                            file.charCount,
                            file.lastModified,
                            file.chunkIndex ?? null,
                            file.totalChunks ?? null,
                            file.originalFileId ?? null,
                            embeddingStr,
                            projectId
                        ]);
                        batchStored++;
                    }
                });
                logger.debug({
                    batch: batchIndex + 1,
                    storedInBatch: batch.length
                }, 'stored batch of files');
            }
            catch (error) {
                logger.error({ error, batchIndex }, 'failed to store batch');
            }
            return batchStored;
        });
        // sum up results from all parallel batches
        totalStored = results.reduce((sum, count) => sum + count, 0);
        return totalStored;
    }
    /**
     * hashContent - sha256 hash of content
     */
    hashContent(content) {
        return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
    }
    /**
     * updateProgressStats - recalculate progress metrics
     */
    updateProgressStats() {
        const elapsed = (Date.now() - this.progress.startTime) / 1000;
        this.progress.filesPerSecond = this.progress.processedFiles / Math.max(elapsed, 0.1);
        const remaining = this.progress.totalFiles - this.progress.processedFiles;
        this.progress.estimatedTimeRemaining = remaining / Math.max(this.progress.filesPerSecond, 0.1);
    }
    /**
     * emitProgress - send progress update to callback
     */
    emitProgress() {
        if (this.options.onProgress) {
            this.options.onProgress({ ...this.progress });
        }
    }
    /**
     * getProgress - get current progress
     */
    getProgress() {
        return { ...this.progress };
    }
}
/**
 * YeetAllFilesIntoMemory - batch insert for already-processed files
 * use this when you have files ready to store
 * Note: content_hash is GENERATED ALWAYS, so we don't include it in INSERT
 * Task #37 FIX: Now uses parallel batch processing for massive speedup
 */
export class YeetAllFilesIntoMemory {
    pool;
    embeddingProvider;
    constructor(pool, embeddingProvider = null) {
        this.pool = pool;
        this.embeddingProvider = embeddingProvider;
    }
    /**
     * yeet - insert multiple files with parallel batch processing
     * Task #37 FIX: Was doing one-by-one sequential inserts, now does parallel batches
     */
    async yeet(files) {
        const stats = { inserted: 0, duplicates: 0, errors: 0 };
        if (files.length === 0) {
            return stats;
        }
        // fr fr ingesting millions of lines rn
        logger.info({ fileCount: files.length }, 'yeeting files into memory - lets gooo');
        // PROJECT ISOLATION: Get project_id for codebase_files table
        const projectId = await getCurrentProjectId();
        const batchSize = 50;
        // parallel batch processing - 5 concurrent batches
        const results = await processBatchesWithConcurrency(files, batchSize, DEFAULT_CONCURRENCY_LIMIT, async (batch) => {
            const batchStats = { inserted: 0, duplicates: 0, errors: 0 };
            for (const file of batch) {
                try {
                    // Generate embedding if not already present and provider exists
                    let embeddingStr = null;
                    if (file.embedding) {
                        embeddingStr = '[' + file.embedding.join(',') + ']';
                    }
                    else if (this.embeddingProvider && file.language.supportsEmbeddings) {
                        try {
                            const embeddingText = this.createEmbeddingText(file);
                            const embedding = await this.embeddingProvider.generateEmbedding(embeddingText);
                            if (embedding) {
                                file.embedding = embedding;
                                embeddingStr = '[' + embedding.join(',') + ']';
                            }
                        }
                        catch (embErr) {
                            logger.debug({ file: file.filePath, error: embErr }, 'embedding generation failed for file');
                        }
                    }
                    // Note: content_hash is GENERATED ALWAYS from content, don't include it
                    // PROJECT ISOLATION: Include project_id to scope files to current project
                    const result = await this.pool.queryWithSwag('INSERT INTO codebase_files (' +
                        'id, file_path, absolute_path, file_name, extension,' +
                        'language_id, language_name, language_type,' +
                        'content, size_bytes, line_count, char_count,' +
                        'last_modified, chunk_index, total_chunks, original_file_id,' +
                        'embedding, project_id' +
                        ') VALUES (' +
                        '$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18' +
                        ')' +
                        'ON CONFLICT (content_hash) DO UPDATE SET ' +
                        'embedding = COALESCE(EXCLUDED.embedding, codebase_files.embedding) ' +
                        'RETURNING id', [
                        file.id,
                        file.filePath,
                        file.absolutePath,
                        file.fileName,
                        file.extension,
                        file.language.id,
                        file.language.name,
                        file.language.type,
                        file.content,
                        file.sizeBytes,
                        file.lineCount,
                        file.charCount,
                        file.lastModified,
                        file.chunkIndex ?? null,
                        file.totalChunks ?? null,
                        file.originalFileId ?? null,
                        embeddingStr,
                        projectId
                    ]);
                    if (result.rowCount && result.rowCount > 0) {
                        batchStats.inserted++;
                    }
                    else {
                        batchStats.duplicates++;
                    }
                }
                catch (error) {
                    batchStats.errors++;
                    logger.warn({ file: file.filePath, error }, 'failed to yeet file');
                }
            }
            return batchStats;
        });
        // aggregate stats from all parallel batches
        for (const batchStats of results) {
            stats.inserted += batchStats.inserted;
            stats.duplicates += batchStats.duplicates;
            stats.errors += batchStats.errors;
        }
        logger.info(stats, 'yeet complete - files in memory now');
        return stats;
    }
    /**
     * createEmbeddingText - creates optimal text for embedding generation
     */
    createEmbeddingText(file) {
        const header = 'File: ' + file.filePath + '\nLanguage: ' + file.language.name + '\n';
        let chunkInfo = '';
        if (file.chunkIndex !== undefined) {
            chunkInfo = 'Chunk ' + (file.chunkIndex + 1) + ' of ' + file.totalChunks + '\n';
        }
        let content = file.content;
        if (content.length > TEXT_LIMITS.EMBEDDING_CONTENT_MAX) {
            content = content.slice(0, TEXT_LIMITS.EMBEDDING_CONTENT_MAX) + '\n...[truncated for embedding]';
        }
        return header + chunkInfo + '\n' + content;
    }
}
// Per-project ingestion engines
const ingestionByProject = new Map();
export function getIngestionEngine(pool, embeddingProvider, projectPath) {
    const targetProject = projectPath || getProjectPath();
    if (!ingestionByProject.has(targetProject)) {
        ingestionByProject.set(targetProject, new IngestThisWholeAssMfCodebase(pool, embeddingProvider ?? null));
    }
    return ingestionByProject.get(targetProject);
}
export function resetIngestionEngine(projectPath) {
    const targetProject = projectPath || getProjectPath();
    ingestionByProject.delete(targetProject);
}
export function resetAllIngestionEngines() {
    ingestionByProject.clear();
}
//# sourceMappingURL=ingestion.js.map