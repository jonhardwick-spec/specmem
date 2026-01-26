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
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import chokidar from 'chokidar';
import { logger } from '../utils/logger.js';
import { getProjectPath } from '../config.js';
import { getCoordinator } from '../coordination/integration.js';
import { getDimensionService } from '../services/DimensionService.js';
import { getProjectContext } from '../services/ProjectContext.js';
import { getCodeAnalyzer } from './codeAnalyzer.js';
import { TEXT_LIMITS } from '../constants.js';
/**
 * Default configuration that slaps
 * Uses environment variable or current working directory for codebase path
 */
const DEFAULT_CONFIG = {
    codebasePath: process.env['SPECMEM_CODEBASE_PATH'] || process.cwd(),
    excludePatterns: [
        'node_modules',
        '.git',
        'dist',
        'build',
        '.next',
        'coverage',
        '.cache',
        '__pycache__',
        '.pytest_cache',
        '.mypy_cache',
        'venv',
        '.venv',
        'env',
        '.env',
        '*.pyc',
        '*.pyo',
        '*.so',
        '*.dylib',
        '*.dll',
        '*.exe',
        '*.bin',
        '*.log',
        '*.lock',
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml',
        '.DS_Store',
        'Thumbs.db'
    ],
    includeExtensions: [
        '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
        '.py', '.pyi',
        '.json',
        '.md', '.markdown', '.rst', '.txt',
        '.yaml', '.yml',
        '.toml', '.ini', '.cfg',
        '.sh', '.bash', '.zsh',
        '.css', '.scss', '.sass', '.less',
        '.html', '.htm', '.xml',
        '.sql',
        '.go',
        '.rs',
        '.java', '.kt', '.scala',
        '.rb',
        '.php',
        '.c', '.cpp', '.h', '.hpp',
        '.swift',
        '.dockerfile', 'Dockerfile',
        '.env.example', '.env.template'
    ],
    maxFileSizeBytes: 1024 * 1024, // 1MB
    generateEmbeddings: true,
    watchForChanges: true,
    debounceMs: 1000,
    batchSize: 50,
    maxDepth: 30,
    // Enhanced analysis options - semantic search goes CRAZY with these
    extractDefinitions: true,
    trackDependencies: true,
    calculateComplexity: true,
    chunkCode: true,
    chunkSize: 50,
    chunkOverlap: 10,
    generateChunkEmbeddings: true
};
/**
 * Language detection mapping
 */
const LANGUAGE_MAP = {
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.ts': 'typescript',
    '.jsx': 'javascript-react',
    '.tsx': 'typescript-react',
    '.py': 'python',
    '.pyi': 'python',
    '.json': 'json',
    '.md': 'markdown',
    '.markdown': 'markdown',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'zsh',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'sass',
    '.html': 'html',
    '.xml': 'xml',
    '.sql': 'sql',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.kt': 'kotlin',
    '.rb': 'ruby',
    '.php': 'php',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c-header',
    '.hpp': 'cpp-header',
    '.swift': 'swift'
};
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
export class CodebaseIndexer {
    config;
    index = new Map();
    embeddingProvider;
    db;
    watcher = null;
    isWatching = false;
    lastFullScan = null;
    lastUpdate = null;
    pendingUpdates = new Map();
    updateTimer = null;
    isProcessing = false;
    // Enhanced analysis
    codeAnalyzer;
    definitionsIndex = new Map();
    dependenciesIndex = new Map();
    chunksIndex = new Map();
    complexityIndex = new Map();
    // Dimension service for dynamic embedding handling
    dimensionService = null;
    constructor(config = {}, embeddingProvider = null, db = null) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.embeddingProvider = embeddingProvider;
        this.db = db;
        this.codeAnalyzer = getCodeAnalyzer({
            chunkSize: this.config.chunkSize,
            chunkOverlap: this.config.chunkOverlap
        });
        // Initialize dimension service if db is available
        if (db) {
            try {
                this.dimensionService = getDimensionService(db, embeddingProvider || undefined);
            }
            catch (err) {
                // dimension service unavailable at init - will retry on first use
                logger.debug({ error: String(err) }, 'DimensionService init deferred - will retry lazily');
            }
        }
    }
    /**
     * Get the DimensionService (lazy initialization)
     */
    getDimService() {
        if (!this.dimensionService && this.db) {
            try {
                this.dimensionService = getDimensionService(this.db, this.embeddingProvider || undefined);
            }
            catch (err) {
                // dimension service still not available - embeddings will use raw dimensions
                logger.debug({ error: String(err) }, 'DimensionService unavailable - using raw embedding dimensions');
            }
        }
        return this.dimensionService;
    }
    /**
     * Prepare embedding for database storage - projects to target dimension if needed.
     * Uses DimensionService to handle dimension mismatches.
     *
     * @param embedding - The raw embedding from the embedding provider
     * @param tableName - Target table for dimension lookup
     * @param originalText - Original text for re-embedding if needed
     * @returns Formatted embedding string for PostgreSQL, or null if no embedding
     */
    async prepareEmbeddingForStorage(embedding, tableName, originalText) {
        if (!embedding || embedding.length === 0)
            return null;
        const dimService = this.getDimService();
        if (!dimService) {
            // No dimension service available - return embedding as-is
            return `[${embedding.join(',')}]`;
        }
        try {
            const prepared = await dimService.validateAndPrepare(tableName, embedding, originalText);
            if (prepared.wasModified) {
                logger.debug({
                    action: prepared.action,
                    tableName,
                    originalDim: embedding.length,
                    newDim: prepared.embedding.length
                }, 'Projected embedding to target dimension for storage');
            }
            return `[${prepared.embedding.join(',')}]`;
        }
        catch (error) {
            logger.warn({ error, tableName }, 'Failed to prepare embedding, using original');
            return `[${embedding.join(',')}]`;
        }
    }
    /**
     * Get coordinator lazily to avoid circular dependency during initialization
     */
    getCoordinatorSafe() {
        try {
            return getCoordinator();
        }
        catch (e) {
            // Coordinator not initialized yet - this is expected during startup
            return null;
        }
    }
    /**
     * initialize - starts the indexer with initial scan
     */
    async initialize() {
        logger.info({ codebasePath: this.config.codebasePath }, 'initializing codebase indexer...');
        // perform initial full scan with PARALLEL batch embedding for speed
        await this.fullScanParallel();
        // start file watcher if enabled
        if (this.config.watchForChanges) {
            await this.startWatching();
        }
        const stats = this.getStats();
        logger.info({
            totalFiles: stats.totalFiles,
            totalLines: stats.totalLines,
            watching: stats.isWatching
        }, 'codebase indexer initialized - we ready to search fr fr');
        return stats;
    }
    /**
     * fullScan - performs a complete scan of the codebase
     * OPTIMIZED: Skips unchanged files using hash comparison against DB
     * Emits LWJEB events: codebase:scan:start, codebase:scan:progress, codebase:scan:complete
     */
    async fullScan() {
        const coordinator = this.getCoordinatorSafe();
        logger.info({ path: this.config.codebasePath }, 'starting full codebase scan...');
        const startTime = Date.now();
        // Emit codebase:scan:start event via LWJEB
        coordinator?.emitCodebaseScanStart(this.config.codebasePath, 'full');
        // Load existing file hashes from DB to skip unchanged files - filtered by project
        const existingHashes = new Map();
        const projectPath = getProjectContext().getProjectPath();
        if (this.db) {
            try {
                const result = await this.db.query(`SELECT file_path, content_hash FROM codebase_files WHERE content_hash IS NOT NULL AND project_path = $1`, [projectPath]);
                for (const row of result.rows) {
                    existingHashes.set(row.file_path, row.content_hash);
                }
                logger.info({ cachedFiles: existingHashes.size, projectPath }, 'loaded existing file hashes for skip check');
            }
            catch (error) {
                logger.warn({ error }, 'failed to load existing hashes, will reindex all');
            }
        }
        // clear existing in-memory index
        this.index.clear();
        // find all files
        const files = await this.findFiles(this.config.codebasePath, 0);
        logger.info({ fileCount: files.length }, 'found files to index');
        let skipped = 0;
        let indexed = 0;
        const changedFiles = [];
        // process files in batches
        for (let i = 0; i < files.length; i += this.config.batchSize) {
            const batch = files.slice(i, i + this.config.batchSize);
            await Promise.all(batch.map(async (filePath) => {
                try {
                    const relativePath = path.relative(this.config.codebasePath, filePath);
                    // Quick hash check - read file and compute hash first
                    const stats = await fs.stat(filePath);
                    if (stats.size > this.config.maxFileSizeBytes)
                        return;
                    if (await this.isBinaryFile(filePath))
                        return;
                    const content = await fs.readFile(filePath, 'utf-8');
                    const contentHash = this.hashContent(content);
                    // Check if file unchanged
                    const existingHash = existingHashes.get(relativePath);
                    if (existingHash === contentHash) {
                        skipped++;
                        return; // Skip - file hasn't changed
                    }
                    // File is new or changed - full index
                    const indexedFile = await this.indexFile(filePath);
                    if (indexedFile) {
                        this.index.set(indexedFile.filePath, indexedFile);
                        changedFiles.push(indexedFile);
                        indexed++;
                        // Emit codebase:file:indexed event via LWJEB
                        coordinator?.emitCodebaseFileIndexed(indexedFile.filePath, indexedFile.language, indexedFile.lineCount, !!indexedFile.embedding);
                    }
                }
                catch (error) {
                    logger.warn({ error, filePath }, 'failed to index file');
                }
            }));
            // progress update
            const processed = Math.min(i + this.config.batchSize, files.length);
            logger.debug({ processed, total: files.length, skipped, indexed }, 'indexing progress');
            // Emit codebase:scan:progress event via LWJEB
            coordinator?.emitCodebaseScanProgress(processed, files.length);
        }
        this.lastFullScan = new Date();
        this.lastUpdate = new Date();
        // persist ONLY changed files to database
        if (this.db && changedFiles.length > 0) {
            await this.persistToDatabase(changedFiles);
        }
        const duration = Date.now() - startTime;
        const totalLines = Array.from(this.index.values()).reduce((sum, f) => sum + f.lineCount, 0);
        // Emit codebase:scan:complete event via LWJEB
        coordinator?.emitCodebaseScanComplete(this.config.codebasePath, this.index.size, totalLines, duration, true);
        logger.info({
            filesIndexed: indexed,
            filesSkipped: skipped,
            duration,
            linesIndexed: totalLines
        }, 'full codebase scan complete (hash-optimized)');
    }
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
    async fullScanParallel() {
        const coordinator = this.getCoordinatorSafe();
        const projectPath = getProjectContext().getProjectPath();
        const startTime = Date.now();
        logger.info({ path: this.config.codebasePath }, '🚀 starting PARALLEL codebase scan...');
        coordinator?.emitCodebaseScanStart(this.config.codebasePath, 'full');
        // Load existing hashes AND mtimes for fast deduplication
        // OPTIMIZATION: mtime check is ~100x faster than reading file to compute hash
        const existingFiles = new Map(); // file_path -> { hash, mtime }
        if (this.db) {
            try {
                const result = await this.db.query(
                    `SELECT file_path, content_hash, last_modified FROM codebase_files WHERE content_hash IS NOT NULL AND project_path = $1`,
                    [projectPath]
                );
                for (const row of result.rows) {
                    existingFiles.set(row.file_path, {
                        hash: row.content_hash,
                        mtime: row.last_modified ? new Date(row.last_modified).getTime() : 0
                    });
                }
                logger.info({ existingCount: existingFiles.size }, 'loaded existing files (hash+mtime) for fast deduplication');
            }
            catch (error) {
                logger.warn({ error }, 'failed to load existing file data');
            }
        }
        // Clear in-memory index - MEMORY FIX: Only store metadata, not full content
        this.index.clear();
        this.definitionsIndex.clear();
        this.chunksIndex.clear();
        // PHASE 1: Find all files
        const files = await this.findFiles(this.config.codebasePath, 0);
        logger.info({ fileCount: files.length }, 'found files to scan');
        // MEMORY FIX: Smaller batches to prevent OOM at 70%
        // Dynamic batch sizing: reduced from 200 max to 50 max for stability
        // Larger batches caused memory pressure and crashes
        const dynamicBatchSize = Math.min(Math.max(25, Math.ceil(files.length / 2000)), 50);
        logger.info({ dynamicBatchSize, totalFiles: files.length }, 'using dynamic batch size (memory-optimized)');
        // Stats tracking with ACK counts
        let totalProcessed = 0;
        let totalSkipped = 0;
        let totalMtimeSkipped = 0;  // Fast path: skipped via mtime (no file read)
        let totalHashSkipped = 0;   // Slow path: skipped via hash (file read required)
        let totalIndexed = 0;
        let totalAckSuccess = 0;
        let totalAckFailed = 0;
        let totalEmbeddings = 0;
        // PHASE 2: Process files in batches with parallel embedding
        for (let i = 0; i < files.length; i += dynamicBatchSize) {
            const batchFiles = files.slice(i, i + dynamicBatchSize);
            const batchStartTime = Date.now();
            // 2a: Read and filter files (parallel)
            const fileDataPromises = batchFiles.map(async (filePath) => {
                try {
                    const relativePath = path.relative(this.config.codebasePath, filePath);
                    const stats = await fs.stat(filePath);
                    if (stats.size > this.config.maxFileSizeBytes)
                        return null;
                    // MTIME-FIRST OPTIMIZATION: Skip file read if mtime unchanged
                    // stat() is ~100x faster than read(), saves massive I/O on unchanged files
                    const existing = existingFiles.get(relativePath);
                    if (existing && existing.mtime && stats.mtime.getTime() <= existing.mtime) {
                        // mtime unchanged = file unchanged, skip without reading
                        return { skipped: true, relativePath, mtimeSkip: true };
                    }
                    if (await this.isBinaryFile(filePath))
                        return null;
                    const content = await fs.readFile(filePath, 'utf-8');
                    const contentHash = this.hashContent(content);
                    // Fallback: hash check for files with changed mtime but same content
                    if (existing && existing.hash === contentHash) {
                        return { skipped: true, relativePath, hashSkip: true };
                    }
                    const fileName = path.basename(filePath);
                    const extension = path.extname(filePath).toLowerCase();
                    const language = this.detectLanguage(fileName, extension);
                    return {
                        skipped: false,
                        id: uuidv4(),
                        filePath: relativePath,
                        absolutePath: filePath,
                        fileName,
                        extension,
                        language,
                        content,
                        contentHash,
                        sizeBytes: stats.size,
                        lineCount: content.split('\n').length,
                        lastModified: stats.mtime,
                        lastIndexed: new Date()
                    };
                }
                catch (err) {
                    // file read/hash failed - log with path context for debugging
                    logger.debug({ filePath, error: String(err) }, 'failed to read file during parallel scan');
                    return null;
                }
            });
            const fileDataResults = await Promise.all(fileDataPromises);
            // Filter out nulls and skipped
            const filesToEmbed = [];
            for (const result of fileDataResults) {
                if (!result)
                    continue;
                if (result.skipped) {
                    totalSkipped++;
                    if (result.mtimeSkip) totalMtimeSkipped++;
                    if (result.hashSkip) totalHashSkipped++;
                    continue;
                }
                filesToEmbed.push(result);
            }
            // 2b: Generate embeddings using BATCH API (single socket request for all texts!)
            // This is 5-10x faster than individual Promise.all calls
            // STABILITY FIX: Add timeout and graceful degradation to prevent system crashes
            if (this.embeddingProvider && filesToEmbed.length > 0) {
                const embeddingTexts = filesToEmbed.map(f => this.createEmbeddingText(f));
                const EMBEDDING_BATCH_TIMEOUT_MS = 60000; // 60 second timeout per batch
                try {
                    // Use batch method if available (single socket request!)
                    let embeddings;
                    // Wrap in timeout to prevent hanging if embedding server is overwhelmed
                    const embeddingPromise = this.embeddingProvider.generateEmbeddingsBatch
                        ? this.embeddingProvider.generateEmbeddingsBatch(embeddingTexts)
                        : Promise.all(embeddingTexts.map(text => this.embeddingProvider.generateEmbedding(text)));
                    embeddings = await Promise.race([
                        embeddingPromise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error(`Embedding timeout after ${EMBEDDING_BATCH_TIMEOUT_MS}ms`)), EMBEDDING_BATCH_TIMEOUT_MS))
                    ]);
                    // Attach embeddings to files
                    for (let j = 0; j < filesToEmbed.length; j++) {
                        filesToEmbed[j].embedding = embeddings[j];
                        totalEmbeddings++;
                    }
                }
                catch (error) {
                    // Log but continue - don't crash the entire scan
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    const isTimeout = errorMsg.includes('timeout');
                    logger.warn({
                        error: errorMsg,
                        batchIndex: Math.floor(i / dynamicBatchSize),
                        batchSize: filesToEmbed.length,
                        isTimeout
                    }, isTimeout ? 'embedding timeout - server may be overloaded' : 'batch embedding failed, continuing without embeddings');
                    // STABILITY FIX: If embedding is timing out, skip definition embeddings too
                    // to prevent cascade failures
                    if (isTimeout) {
                        logger.info('Skipping definition embeddings due to server overload');
                    }
                }
            }
            // 2c: Enhanced analysis for each file (definitions, chunks, etc.)
            for (const file of filesToEmbed) {
                if (this.shouldAnalyze(file.language)) {
                    try {
                        const analysis = await this.codeAnalyzer.analyzeFile(file.id, file.filePath, file.content, file.language);
                        file.analysis = analysis;
                        this.definitionsIndex.set(file.filePath, analysis.definitions);
                        this.chunksIndex.set(file.filePath, analysis.chunks);
                    }
                    catch (err) {
                        // code analysis failed - log with file context for debugging
                        logger.debug({ filePath: file.filePath, language: file.language, error: String(err) }, 'code analysis failed - indexing without definitions/chunks');
                    }
                }
                totalIndexed++;
            }
            // 2d: Persist batch to DB with ACK verification (needs full content)
            if (this.db && filesToEmbed.length > 0) {
                const ackResult = await this.persistBatchWithAck(filesToEmbed, projectPath);
                totalAckSuccess += ackResult.success;
                totalAckFailed += ackResult.failed;
            }
            // 2e: MEMORY FIX - Now that content is persisted to DB, create lightweight index entries
            // This prevents OOM at 70% on large codebases
            for (const file of filesToEmbed) {
                const lightFile = {
                    ...file,
                    content: '', // Clear content to free memory - it's in DB now
                    analysis: undefined // Analysis data is indexed separately
                };
                this.index.set(file.filePath, lightFile);
            }
            // MEMORY FIX: Help garbage collector by clearing references
            // and hinting that we're done with this batch
            filesToEmbed.length = 0; // Clear array
            totalProcessed += batchFiles.length;
            const batchDuration = Date.now() - batchStartTime;
            // STABILITY FIX: Check memory usage and log warning if high
            const memUsage = process.memoryUsage();
            const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
            const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
            const usagePercent = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
            if (usagePercent > 85) {
                logger.warn({
                    heapUsedMB,
                    heapTotalMB,
                    usagePercent,
                    processed: totalProcessed,
                    total: files.length
                }, '⚠️ HIGH MEMORY USAGE - may need to reduce batch size');
                // Force garbage collection if available (run node with --expose-gc)
                if (global.gc) {
                    global.gc();
                    logger.info('Forced garbage collection due to high memory');
                }
            }
            // Progress logging every 10 batches
            if ((i / dynamicBatchSize) % 10 === 0) {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                const rate = Math.round(totalProcessed / parseFloat(elapsed));
                logger.info({
                    processed: totalProcessed,
                    indexed: totalIndexed,
                    skipped: totalSkipped,
                    mtimeSkip: totalMtimeSkipped,
                    hashSkip: totalHashSkipped,
                    embeddings: totalEmbeddings,
                    ackSuccess: totalAckSuccess,
                    ackFailed: totalAckFailed,
                    elapsedSec: elapsed,
                    filesPerSec: rate,
                    batchMs: batchDuration
                }, '📊 parallel scan progress');
            }
            // Emit progress event
            coordinator?.emitCodebaseScanProgress(totalProcessed, files.length);
        }
        this.lastFullScan = new Date();
        this.lastUpdate = new Date();
        const duration = Date.now() - startTime;
        const totalLines = Array.from(this.index.values()).reduce((sum, f) => sum + f.lineCount, 0);
        coordinator?.emitCodebaseScanComplete(this.config.codebasePath, this.index.size, totalLines, duration, true);
        logger.info({
            filesProcessed: totalProcessed,
            filesIndexed: totalIndexed,
            filesSkipped: totalSkipped,
            mtimeSkipped: totalMtimeSkipped,  // Fast path - no file read needed
            hashSkipped: totalHashSkipped,    // Slow path - file read required
            embeddingsGenerated: totalEmbeddings,
            ackSuccess: totalAckSuccess,
            ackFailed: totalAckFailed,
            durationMs: duration,
            durationSec: (duration / 1000).toFixed(1),
            filesPerSec: Math.round(totalProcessed / (duration / 1000)),
            linesIndexed: totalLines
        }, `✅ PARALLEL codebase scan complete! (${totalMtimeSkipped} mtime-skipped, ${totalHashSkipped} hash-skipped)`);
    }
    /**
     * persistBatchWithAck - persist files with ACK verification using RETURNING
     */
    async persistBatchWithAck(files, projectPath) {
        let success = 0;
        let failed = 0;
        if (!this.db)
            return { success, failed };
        for (const file of files) {
            try {
                const embeddingStr = await this.prepareEmbeddingForStorage(file.embedding, 'codebase_files', this.createEmbeddingText(file));
                // ACK verification: RETURNING id confirms the write
                const result = await this.db.query(`INSERT INTO codebase_files (
            id, file_path, absolute_path, file_name, extension,
            language_id, language_name, content, content_hash,
            size_bytes, line_count, embedding, project_path
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
          )
          ON CONFLICT (file_path, project_path) DO UPDATE SET
            content = EXCLUDED.content,
            content_hash = EXCLUDED.content_hash,
            size_bytes = EXCLUDED.size_bytes,
            line_count = EXCLUDED.line_count,
            embedding = COALESCE(EXCLUDED.embedding, codebase_files.embedding),
            updated_at = NOW()
          RETURNING id`, [
                    file.id,
                    file.filePath,
                    file.absolutePath,
                    file.fileName,
                    file.extension,
                    file.language.toLowerCase(),
                    file.language,
                    file.content,
                    file.contentHash,
                    file.sizeBytes,
                    file.lineCount,
                    embeddingStr,
                    projectPath
                ]);
                if (result.rows.length > 0) {
                    success++;
                    // Also persist definitions with embeddings if available
                    if (file.analysis?.definitions) {
                        await this.persistDefinitionsWithAck(file.id, file.analysis.definitions, projectPath);
                    }
                }
                else {
                    failed++;
                }
            }
            catch (error) {
                failed++;
                logger.debug({ error, filePath: file.filePath }, 'ACK failed for file');
            }
        }
        return { success, failed };
    }
    /**
     * persistDefinitionsWithAck - persist code definitions with embeddings and ACK
     */
    async persistDefinitionsWithAck(fileId, definitions, projectPath) {
        if (!this.db || !this.embeddingProvider)
            return;
        // Filter garbage entries
        const GARBAGE_NAMES = new Set([
            'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NULL', 'TRUE', 'FALSE',
            'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'TABLE',
            'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AS', 'IN',
            'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'UNION',
            'function', 'class', 'const', 'let', 'var', 'if', 'else', 'return',
            'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch'
        ]);
        const validDefs = definitions.filter(def => def.name.length >= 2 &&
            !GARBAGE_NAMES.has(def.name) &&
            !GARBAGE_NAMES.has(def.name.toUpperCase()));
        if (validDefs.length === 0)
            return;
        // Generate embeddings for definitions in parallel
        const defTexts = validDefs.map(def => [
            `${def.definitionType} ${def.name}`,
            def.signature || '',
            def.docstring || ''
        ].filter(Boolean).join('\n'));
        try {
            // Use batch embedding for definitions (single socket request!)
            let defEmbeddings;
            if (this.embeddingProvider.generateEmbeddingsBatch) {
                defEmbeddings = await this.embeddingProvider.generateEmbeddingsBatch(defTexts);
            }
            else {
                defEmbeddings = await Promise.all(defTexts.map(text => this.embeddingProvider.generateEmbedding(text)));
            }
            // Insert definitions with ACK
            for (let i = 0; i < validDefs.length; i++) {
                const def = validDefs[i];
                const embeddingStr = await this.prepareEmbeddingForStorage(defEmbeddings[i], 'code_definitions', defTexts[i]);
                await this.db.query(`INSERT INTO code_definitions (
            id, file_id, file_path, name, qualified_name, definition_type,
            start_line, end_line, signature, docstring, visibility,
            is_exported, is_async, is_static, project_path, embedding
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
          )
          ON CONFLICT (id) DO UPDATE SET
            embedding = COALESCE(EXCLUDED.embedding, code_definitions.embedding),
            updated_at = NOW()
          RETURNING id`, [
                    def.id, fileId, def.filePath, def.name, def.qualifiedName, def.definitionType,
                    def.startLine, def.endLine, def.signature, def.docstring, def.visibility,
                    def.isExported, def.isAsync, def.isStatic, projectPath, embeddingStr
                ]);
            }
        }
        catch (error) {
            // definition embedding/persistence failed - log with file context
            logger.warn({ error: String(error), fileId, defCount: validDefs.length }, 'failed to persist code definitions with embeddings');
        }
    }
    /**
     * findFiles - recursively finds all indexable files
     */
    async findFiles(dirPath, depth) {
        if (depth > this.config.maxDepth) {
            return [];
        }
        const files = [];
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                // check exclusions
                if (this.shouldExclude(entry.name, fullPath)) {
                    continue;
                }
                if (entry.isDirectory()) {
                    const subFiles = await this.findFiles(fullPath, depth + 1);
                    files.push(...subFiles);
                }
                else if (entry.isFile()) {
                    if (this.shouldInclude(entry.name)) {
                        files.push(fullPath);
                    }
                }
            }
        }
        catch (error) {
            logger.warn({ dirPath, error }, 'failed to read directory');
        }
        return files;
    }
    /**
     * shouldExclude - checks if path should be excluded
     */
    shouldExclude(name, fullPath) {
        // skip hidden files/directories
        if (name.startsWith('.') && name !== '.env.example' && name !== '.env.template') {
            return true;
        }
        // check exclude patterns
        for (const pattern of this.config.excludePatterns) {
            if (name === pattern || name.endsWith(pattern)) {
                return true;
            }
            // check if path contains excluded directory
            if (fullPath.includes(`/${pattern}/`) || fullPath.includes(`\\${pattern}\\`)) {
                return true;
            }
        }
        return false;
    }
    /**
     * shouldInclude - checks if file should be included
     */
    shouldInclude(name) {
        const ext = path.extname(name).toLowerCase();
        // check Dockerfile special case
        if (name.toLowerCase() === 'dockerfile') {
            return true;
        }
        return this.config.includeExtensions.includes(ext);
    }
    /**
     * indexFile - reads and indexes a single file with enhanced analysis
     */
    async indexFile(absolutePath) {
        try {
            const stats = await fs.stat(absolutePath);
            // skip if too large
            if (stats.size > this.config.maxFileSizeBytes) {
                logger.debug({ path: absolutePath, size: stats.size }, 'skipping large file');
                return null;
            }
            // skip if binary
            if (await this.isBinaryFile(absolutePath)) {
                return null;
            }
            const content = await fs.readFile(absolutePath, 'utf-8');
            const relativePath = path.relative(this.config.codebasePath, absolutePath);
            const fileName = path.basename(absolutePath);
            const extension = path.extname(absolutePath).toLowerCase();
            const language = this.detectLanguage(fileName, extension);
            const contentHash = this.hashContent(content);
            const lineCount = content.split('\n').length;
            const indexed = {
                id: uuidv4(),
                filePath: relativePath,
                absolutePath,
                fileName,
                extension,
                language,
                content,
                contentHash,
                sizeBytes: stats.size,
                lineCount,
                lastModified: stats.mtime,
                lastIndexed: new Date()
            };
            // generate embedding if enabled
            if (this.config.generateEmbeddings && this.embeddingProvider) {
                try {
                    const textForEmbedding = this.createEmbeddingText(indexed);
                    indexed.embedding = await this.embeddingProvider.generateEmbedding(textForEmbedding);
                }
                catch (error) {
                    logger.warn({ error, path: relativePath }, 'failed to generate embedding');
                }
            }
            // Enhanced analysis - extract definitions, dependencies, chunks, complexity
            if (this.shouldAnalyze(language)) {
                try {
                    const analysis = await this.codeAnalyzer.analyzeFile(indexed.id, relativePath, content, language);
                    indexed.analysis = analysis;
                    // Store in indexes
                    this.definitionsIndex.set(relativePath, analysis.definitions);
                    this.dependenciesIndex.set(relativePath, analysis.dependencies);
                    this.chunksIndex.set(relativePath, analysis.chunks);
                    this.complexityIndex.set(relativePath, analysis.complexity);
                    // Generate embeddings for chunks if enabled
                    if (this.config.generateChunkEmbeddings && this.embeddingProvider) {
                        await this.generateChunkEmbeddings(analysis.chunks);
                    }
                    logger.debug({
                        path: relativePath,
                        definitions: analysis.definitions.length,
                        dependencies: analysis.dependencies.length,
                        chunks: analysis.chunks.length,
                        complexity: analysis.complexity.cyclomaticComplexity
                    }, 'file analysis complete');
                }
                catch (error) {
                    logger.warn({ error, path: relativePath }, 'failed to analyze file');
                }
            }
            return indexed;
        }
        catch (error) {
            logger.warn({ error, path: absolutePath }, 'failed to index file');
            return null;
        }
    }
    /**
     * shouldAnalyze - determines if a file should get enhanced analysis
     */
    shouldAnalyze(language) {
        // Only analyze programming languages, not config or data files
        const analyzableLanguages = [
            'typescript', 'typescript-react', 'javascript', 'javascript-react',
            'python', 'go', 'rust', 'java', 'kotlin', 'scala',
            'ruby', 'php', 'c', 'cpp', 'swift', 'html'
        ];
        return analyzableLanguages.includes(language);
    }
    /**
     * generateChunkEmbeddings - generates embeddings for code chunks
     */
    async generateChunkEmbeddings(chunks) {
        if (!this.embeddingProvider)
            return;
        for (const chunk of chunks) {
            try {
                const text = `File: ${chunk.filePath}\nLanguage: ${chunk.language}\nLines ${chunk.startLine}-${chunk.endLine}\n\n${chunk.content}`;
                chunk.embedding = await this.embeddingProvider.generateEmbedding(text);
            }
            catch (error) {
                logger.warn({ error, chunkId: chunk.id }, 'failed to generate chunk embedding');
            }
        }
    }
    /**
     * isBinaryFile - checks if file is binary
     */
    async isBinaryFile(filePath) {
        try {
            const buffer = Buffer.alloc(512);
            const fd = await fs.open(filePath, 'r');
            try {
                await fd.read(buffer, 0, 512, 0);
            }
            finally {
                await fd.close();
            }
            // check for null bytes (common in binary files)
            for (let i = 0; i < 512; i++) {
                if (buffer[i] === 0) {
                    return true;
                }
            }
            return false;
        }
        catch (e) {
            // binary detection failed - log with file context, assume text for safety
            logger.debug({ filePath, error: String(e) }, 'binary detection failed - assuming text file');
            return false;
        }
    }
    /**
     * detectLanguage - determines file language
     */
    detectLanguage(fileName, extension) {
        // check special filenames
        if (fileName.toLowerCase() === 'dockerfile') {
            return 'dockerfile';
        }
        if (fileName.toLowerCase() === 'makefile') {
            return 'makefile';
        }
        return LANGUAGE_MAP[extension] || 'unknown';
    }
    /**
     * hashContent - generates SHA256 hash of content
     */
    hashContent(content) {
        return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
    }
    /**
     * createEmbeddingText - creates optimal text for embedding
     */
    createEmbeddingText(file) {
        const header = `File: ${file.filePath}\nLanguage: ${file.language}\n\n`;
        // truncate content if needed - use standardized limit from constants
        let content = file.content;
        if (content.length > TEXT_LIMITS.EMBEDDING_CONTENT_MAX) {
            content = content.slice(0, TEXT_LIMITS.EMBEDDING_CONTENT_MAX) + '\n...[truncated]';
        }
        return header + content;
    }
    /**
     * startWatching - begins watching for file changes
     */
    async startWatching() {
        if (this.isWatching) {
            return;
        }
        logger.info({ path: this.config.codebasePath }, 'starting codebase file watcher...');
        // build ignore patterns for chokidar
        const ignored = [
            ...this.config.excludePatterns.map(p => `**/${p}/**`),
            '**/.*' // hidden files
        ];
        this.watcher = chokidar.watch(this.config.codebasePath, {
            ignored,
            ignoreInitial: true,
            persistent: true,
            depth: this.config.maxDepth,
            awaitWriteFinish: {
                stabilityThreshold: this.config.debounceMs,
                pollInterval: 100
            }
        });
        this.watcher.on('add', (filePath) => this.queueUpdate(filePath, 'add'));
        this.watcher.on('change', (filePath) => this.queueUpdate(filePath, 'change'));
        this.watcher.on('unlink', (filePath) => this.queueUpdate(filePath, 'unlink'));
        this.watcher.on('error', (error) => {
            logger.error({ error }, 'codebase watcher error');
        });
        this.isWatching = true;
        logger.info('codebase watcher started');
    }
    /**
     * queueUpdate - queues a file update for batch processing
     */
    queueUpdate(filePath, type) {
        // check if file should be included
        const fileName = path.basename(filePath);
        if (!this.shouldInclude(fileName)) {
            return;
        }
        this.pendingUpdates.set(filePath, type);
        // reset timer
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }
        // process after debounce period
        this.updateTimer = setTimeout(() => {
            this.processPendingUpdates();
        }, this.config.debounceMs);
    }
    /**
     * processPendingUpdates - processes all queued updates
     * Emits incremental scan events via LWJEB
     */
    async processPendingUpdates() {
        if (this.isProcessing || this.pendingUpdates.size === 0) {
            return;
        }
        this.isProcessing = true;
        const coordinator = this.getCoordinatorSafe();
        const startTime = Date.now();
        // Emit codebase:scan:start for incremental scan via LWJEB
        coordinator?.emitCodebaseScanStart(this.config.codebasePath, 'incremental');
        try {
            const updates = new Map(this.pendingUpdates);
            this.pendingUpdates.clear();
            logger.debug({ count: updates.size }, 'processing codebase updates');
            let filesIndexed = 0;
            let totalLines = 0;
            for (const [filePath, type] of updates) {
                try {
                    if (type === 'unlink') {
                        const relativePath = path.relative(this.config.codebasePath, filePath);
                        this.index.delete(relativePath);
                        logger.debug({ path: relativePath }, 'removed file from index');
                    }
                    else {
                        const indexed = await this.indexFile(filePath);
                        if (indexed) {
                            this.index.set(indexed.filePath, indexed);
                            filesIndexed++;
                            totalLines += indexed.lineCount;
                            // Emit codebase:file:indexed event via LWJEB
                            coordinator?.emitCodebaseFileIndexed(indexed.filePath, indexed.language, indexed.lineCount, !!indexed.embedding);
                            logger.debug({ path: indexed.filePath }, 'updated file in index');
                        }
                    }
                }
                catch (error) {
                    logger.warn({ error, filePath }, 'failed to process update');
                }
            }
            const duration = Date.now() - startTime;
            // Emit codebase:scan:complete for incremental scan via LWJEB
            coordinator?.emitCodebaseScanComplete(this.config.codebasePath, filesIndexed, totalLines, duration, true);
            this.lastUpdate = new Date();
        }
        finally {
            this.isProcessing = false;
        }
    }
    /**
     * persistToDatabase - stores files and enhanced analysis in the database
     * Uses RETURNING to get the actual file ID (handles ON CONFLICT cases)
     * to prevent foreign key violations when inserting code_chunks
     */
    async persistToDatabase(files) {
        if (!this.db || files.length === 0)
            return 0;
        logger.info({ fileCount: files.length }, 'persisting files to database...');
        let storedCount = 0;
        const batchSize = 100;
        const projectPath = getProjectContext().getProjectPath();
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            try {
                for (const file of batch) {
                    // Use dimension service to prepare embedding for correct dimension
                    const embeddingText = this.createEmbeddingText(file);
                    const embeddingStr = await this.prepareEmbeddingForStorage(file.embedding, 'codebase_files', embeddingText);
                    // Map simple language string to database structure
                    // The database expects language_id, language_name, language_type
                    const languageId = file.language.toLowerCase();
                    const languageName = file.language.charAt(0).toUpperCase() + file.language.slice(1);
                    const languageType = this.getLanguageType(file.language);
                    // Use RETURNING id to get the actual file ID that was inserted or updated
                    // This prevents foreign key violations when the file already exists
                    // (ON CONFLICT would update existing row but file.id would be a new UUID)
                    // First try to update existing file - filtered by project_path
                    // Update existing file with content_hash
                    const updateResult = await this.db.query(`UPDATE codebase_files SET
              absolute_path = $2,
              file_name = $3,
              extension = $4,
              language_id = $5,
              language_name = $6,
              language_type = $7,
              content = $8,
              size_bytes = $9,
              line_count = $10,
              char_count = $11,
              last_modified = $12,
              embedding = COALESCE($13, embedding),
              content_hash = $14
            WHERE file_path = $1 AND project_path = $15
            RETURNING id`, [
                        file.filePath,
                        file.absolutePath,
                        file.fileName,
                        file.extension,
                        languageId,
                        languageName,
                        languageType,
                        file.content,
                        file.sizeBytes,
                        file.lineCount,
                        file.content.length,
                        file.lastModified,
                        embeddingStr,
                        file.contentHash,
                        projectPath
                    ]);
                    let result;
                    if (updateResult.rows.length === 0) {
                        // File doesn't exist, insert it with project_path and content_hash
                        result = await this.db.query(`INSERT INTO codebase_files (
                id, file_path, absolute_path, file_name, extension,
                language_id, language_name, language_type,
                content, size_bytes, line_count, char_count,
                last_modified, embedding, content_hash, project_path
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
              )
              RETURNING id`, [
                            file.id,
                            file.filePath,
                            file.absolutePath,
                            file.fileName,
                            file.extension,
                            languageId,
                            languageName,
                            languageType,
                            file.content,
                            file.sizeBytes,
                            file.lineCount,
                            file.content.length,
                            file.lastModified,
                            embeddingStr,
                            file.contentHash,
                            projectPath
                        ]);
                    }
                    else {
                        result = updateResult;
                    }
                    // Use the actual database ID (could be different from file.id on conflict)
                    const actualFileId = result.rows[0]?.id || file.id;
                    // Store enhanced analysis if available using the actual file ID
                    if (file.analysis) {
                        await this.persistAnalysis(actualFileId, file.analysis);
                    }
                    storedCount++;
                }
                logger.debug({
                    batch: Math.floor(i / batchSize) + 1,
                    storedInBatch: batch.length
                }, 'stored batch of files');
            }
            catch (error) {
                logger.error({ error, batchIndex: Math.floor(i / batchSize) }, 'failed to store batch');
            }
        }
        logger.info({ storedCount }, 'database persistence complete');
        return storedCount;
    }
    /**
     * persistAnalysis - stores enhanced analysis data in the database
     * All tables are scoped by project_path for data isolation
     */
    async persistAnalysis(fileId, analysis) {
        if (!this.db)
            return;
        const projectPath = getProjectContext().getProjectPath();
        try {
            // Store code chunks with project_path
            for (const chunk of analysis.chunks) {
                // Skip empty chunks - no point storing whitespace fr fr
                if (!chunk.content.trim())
                    continue;
                // Use dimension service to prepare chunk embedding
                const chunkText = `File: ${chunk.filePath}\nLanguage: ${chunk.language}\nLines ${chunk.startLine}-${chunk.endLine}\n\n${chunk.content}`;
                const embeddingStr = await this.prepareEmbeddingForStorage(chunk.embedding, 'code_chunks', chunkText);
                await this.db.query(`INSERT INTO code_chunks (
            id, file_id, file_path, chunk_index, start_line, end_line,
            start_char, end_char, content, language, chunk_type,
            context_before, context_after, embedding, metadata, project_path
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
          )
          ON CONFLICT (id) DO UPDATE SET
            content = EXCLUDED.content,
            embedding = COALESCE(EXCLUDED.embedding, code_chunks.embedding),
            updated_at = NOW()`, [
                    chunk.id, fileId, chunk.filePath, chunk.chunkIndex,
                    chunk.startLine, chunk.endLine, chunk.startChar, chunk.endChar,
                    chunk.content, chunk.language, chunk.chunkType,
                    chunk.contextBefore, chunk.contextAfter,
                    embeddingStr, JSON.stringify(chunk.metadata), projectPath
                ]);
            }
            // Store code definitions with project_path AND embeddings
            // FIX: Previously embeddings were missing, causing low relevance in find_code_pointers
            // ACK VERIFICATION: Skip garbage entries (SQL keywords, common noise)
            const GARBAGE_NAMES = new Set([
                // SQL keywords
                'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'NULL', 'TRUE', 'FALSE',
                'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'TABLE', 'INDEX',
                'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AS', 'IN', 'LIKE',
                'BETWEEN', 'IS', 'GROUP', 'BY', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET',
                'DISTINCT', 'UNION', 'ALL', 'ANY', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
                'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'CAST',
                'VALUES', 'RETURNING', 'INTO', 'SET', 'DEFAULT', 'PRIMARY', 'KEY', 'FOREIGN',
                'REFERENCES', 'UNIQUE', 'CHECK', 'CONSTRAINT', 'CASCADE', 'RESTRICT',
                'ROUND', 'LOWER', 'UPPER', 'TRIM', 'LENGTH', 'SUBSTRING', 'REPLACE', 'CONCAT',
                'EXTRACT', 'DATE', 'TIME', 'TIMESTAMP', 'INTERVAL', 'NOW', 'CURRENT_DATE',
                // JS noise
                'switch', 'super', 'clearInterval', 'clearTimeout', 'setTimeout', 'callback',
                // Common false positives
                'undefined', 'null', 'true', 'false', 'NaN', 'Infinity'
            ]);
            const isValidDefinition = (def) => {
                // Name must exist and be reasonable
                if (!def.name || def.name.length < 2 || def.name.length > 100)
                    return false;
                // Name must not be a garbage keyword
                if (GARBAGE_NAMES.has(def.name.toUpperCase()))
                    return false;
                // Name should start with letter or underscore
                if (!/^[a-zA-Z_$]/.test(def.name))
                    return false;
                // Signature shouldn't be SQL (indicates parser confusion)
                if (def.signature && /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE)\s/i.test(def.signature))
                    return false;
                return true;
            };
            for (const def of analysis.definitions) {
                // ACK: Verify this is a real code definition, not garbage
                if (!isValidDefinition(def)) {
                    logger.debug({ name: def.name, filePath: def.filePath }, 'Skipping invalid definition (ACK failed)');
                    continue;
                }
                // Generate embedding for definition based on name + signature + docstring
                // This enables semantic search to find definitions by meaning
                const defText = [
                    `${def.definitionType} ${def.name}`,
                    def.signature || '',
                    def.docstring || '',
                    `File: ${def.filePath}`,
                    `Language: ${def.language}`
                ].filter(Boolean).join('\n');
                // Generate embedding for the definition text
                let defEmbeddingStr = null;
                if (this.embeddingProvider) {
                    try {
                        const defEmbedding = await this.embeddingProvider.generateEmbedding(defText);
                        defEmbeddingStr = await this.prepareEmbeddingForStorage(defEmbedding, 'code_definitions', defText);
                    }
                    catch (err) {
                        logger.warn({ error: err, defName: def.name }, 'Failed to generate definition embedding');
                    }
                }
                await this.db.query(`INSERT INTO code_definitions (
            id, file_id, file_path, name, qualified_name, definition_type,
            start_line, end_line, start_column, end_column,
            signature, docstring, return_type, visibility,
            is_exported, is_async, is_static, is_abstract,
            parent_definition_id, parameters, language, decorators, metadata, project_path, embedding
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
          )
          ON CONFLICT (id) DO UPDATE SET
            signature = EXCLUDED.signature,
            embedding = COALESCE(EXCLUDED.embedding, code_definitions.embedding),
            updated_at = NOW()`, [
                    def.id, fileId, def.filePath, def.name, def.qualifiedName, def.definitionType,
                    def.startLine, def.endLine, def.startColumn, def.endColumn,
                    def.signature, def.docstring, def.returnType, def.visibility,
                    def.isExported, def.isAsync, def.isStatic, def.isAbstract,
                    def.parentDefinitionId, JSON.stringify(def.parameters),
                    def.language, def.decorators, JSON.stringify(def.metadata), projectPath, defEmbeddingStr
                ]);
            }
            // Store code dependencies with project_path
            for (const dep of analysis.dependencies) {
                await this.db.query(`INSERT INTO code_dependencies (
            id, source_file_id, source_file_path, target_path, resolved_path,
            import_type, import_statement, imported_names, imported_as,
            is_default_import, is_namespace_import, is_type_import, is_side_effect_import,
            line_number, column_number, is_external, is_builtin, is_relative,
            is_absolute, is_dynamic, package_name, package_version, language, metadata, project_path
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
          )
          ON CONFLICT (id) DO UPDATE SET
            resolved_path = EXCLUDED.resolved_path,
            updated_at = NOW()`, [
                    dep.id, fileId, dep.sourceFilePath, dep.targetPath, dep.resolvedPath,
                    dep.importType, dep.importStatement, dep.importedNames, dep.importedAs,
                    dep.isDefaultImport, dep.isNamespaceImport, dep.isTypeImport, dep.isSideEffectImport,
                    dep.lineNumber, dep.columnNumber, dep.isExternal, dep.isBuiltin, dep.isRelative,
                    dep.isAbsolute, dep.isDynamic, dep.packageName, dep.packageVersion,
                    dep.language, JSON.stringify(dep.metadata), projectPath
                ]);
            }
            // Store code complexity with project_path
            const comp = analysis.complexity;
            await this.db.query(`INSERT INTO code_complexity (
          id, file_id, file_path, definition_id, definition_name, scope_type,
          lines_of_code, logical_lines, comment_lines, blank_lines,
          cyclomatic_complexity, cognitive_complexity, halstead_difficulty,
          halstead_effort, halstead_volume, maintainability_index,
          parameter_count, return_statement_count, nesting_depth, coupling_score,
          issues_count, issues, duplicate_blocks, duplicate_lines,
          language, metadata, analyzed_at, analyzer_version, project_path
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27, $28, $29
        )
        ON CONFLICT (id) DO UPDATE SET
          cyclomatic_complexity = EXCLUDED.cyclomatic_complexity,
          maintainability_index = EXCLUDED.maintainability_index,
          analyzed_at = EXCLUDED.analyzed_at,
          updated_at = NOW()`, [
                comp.id, fileId, comp.filePath, comp.definitionId, comp.definitionName, comp.scopeType,
                comp.linesOfCode, comp.logicalLines, comp.commentLines, comp.blankLines,
                comp.cyclomaticComplexity, comp.cognitiveComplexity, comp.halsteadDifficulty,
                comp.halsteadEffort, comp.halsteadVolume, comp.maintainabilityIndex,
                comp.parameterCount, comp.returnStatementCount, comp.nestingDepth, comp.couplingScore,
                comp.issuesCount, JSON.stringify(comp.issues), comp.duplicateBlocks, comp.duplicateLines,
                comp.language, JSON.stringify(comp.metadata), comp.analyzedAt, comp.analyzerVersion, projectPath
            ]);
        }
        catch (error) {
            logger.error({ error, fileId }, 'failed to persist analysis');
        }
    }
    /**
     * getLanguageType - determines language type category
     */
    getLanguageType(language) {
        const programmingLangs = [
            'javascript', 'typescript', 'python', 'java', 'go', 'rust',
            'c', 'cpp', 'swift', 'kotlin', 'ruby', 'php', 'scala'
        ];
        const markupLangs = ['html', 'xml', 'markdown'];
        const dataLangs = ['json', 'yaml', 'toml'];
        const configLangs = ['ini', 'cfg', 'bash', 'zsh', 'dockerfile'];
        const lower = language.toLowerCase();
        if (programmingLangs.some(l => lower.includes(l)))
            return 'programming';
        if (markupLangs.some(l => lower.includes(l)))
            return 'markup';
        if (dataLangs.some(l => lower.includes(l)))
            return 'data';
        if (configLangs.some(l => lower.includes(l)))
            return 'config';
        return 'data';
    }
    /**
     * stopWatching - stops the file watcher
     */
    async stopWatching() {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
            this.updateTimer = null;
        }
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
        }
        this.isWatching = false;
        logger.info('codebase watcher stopped');
    }
    // === PUBLIC API ===
    /**
     * getFile - retrieves a file by relative path
     */
    getFile(relativePath) {
        return this.index.get(relativePath);
    }
    /**
     * getAllFiles - returns all indexed files
     */
    getAllFiles() {
        return Array.from(this.index.values());
    }
    /**
     * searchByPath - searches files by path pattern
     */
    searchByPath(pattern) {
        const normalizedPattern = pattern.toLowerCase();
        return Array.from(this.index.values()).filter(file => file.filePath.toLowerCase().includes(normalizedPattern) ||
            file.fileName.toLowerCase().includes(normalizedPattern));
    }
    /**
     * searchByContent - searches files by content
     */
    searchByContent(query) {
        const normalizedQuery = query.toLowerCase();
        return Array.from(this.index.values()).filter(file => file.content.toLowerCase().includes(normalizedQuery));
    }
    /**
     * searchByLanguage - returns all files of a language
     */
    searchByLanguage(language) {
        return Array.from(this.index.values()).filter(file => file.language === language);
    }
    /**
     * getCodebaseOverview - returns a summary of the codebase
     */
    getCodebaseOverview() {
        const stats = this.getStats();
        const files = this.getAllFiles();
        let overview = `# Codebase Overview\n\n`;
        overview += `**Root Path**: ${this.config.codebasePath}\n`;
        overview += `**Total Files**: ${stats.totalFiles}\n`;
        overview += `**Total Lines**: ${stats.totalLines}\n`;
        overview += `**Total Size**: ${(stats.totalBytes / 1024 / 1024).toFixed(2)} MB\n\n`;
        overview += `## Language Breakdown\n\n`;
        for (const [language, count] of Object.entries(stats.languageBreakdown)) {
            overview += `- **${language}**: ${count} files\n`;
        }
        overview += '\n';
        overview += `## Directory Structure\n\n`;
        // group files by top-level directory
        const directories = new Map();
        for (const file of files) {
            const parts = file.filePath.split(path.sep);
            const topDir = parts[0] || 'root';
            directories.set(topDir, (directories.get(topDir) || 0) + 1);
        }
        for (const [dir, count] of Array.from(directories.entries()).sort((a, b) => b[1] - a[1])) {
            overview += `- \`${dir}/\`: ${count} files\n`;
        }
        return overview;
    }
    /**
     * getStats - returns indexer statistics including enhanced analysis metrics
     */
    getStats() {
        const files = Array.from(this.index.values());
        const languageBreakdown = {};
        const definitionBreakdown = {};
        let totalBytes = 0;
        let totalLines = 0;
        let filesWithEmbeddings = 0;
        let totalDefinitions = 0;
        let totalDependencies = 0;
        let totalChunks = 0;
        let chunksWithEmbeddings = 0;
        let totalComplexity = 0;
        let complexityCount = 0;
        for (const file of files) {
            languageBreakdown[file.language] = (languageBreakdown[file.language] || 0) + 1;
            totalBytes += file.sizeBytes;
            totalLines += file.lineCount;
            if (file.embedding) {
                filesWithEmbeddings++;
            }
        }
        // Count definitions
        for (const defs of this.definitionsIndex.values()) {
            totalDefinitions += defs.length;
            for (const def of defs) {
                definitionBreakdown[def.definitionType] = (definitionBreakdown[def.definitionType] || 0) + 1;
            }
        }
        // Count dependencies
        for (const deps of this.dependenciesIndex.values()) {
            totalDependencies += deps.length;
        }
        // Count chunks
        for (const chunks of this.chunksIndex.values()) {
            totalChunks += chunks.length;
            for (const chunk of chunks) {
                if (chunk.embedding) {
                    chunksWithEmbeddings++;
                }
            }
        }
        // Calculate average complexity
        for (const complexity of this.complexityIndex.values()) {
            if (complexity.cyclomaticComplexity !== undefined) {
                totalComplexity += complexity.cyclomaticComplexity;
                complexityCount++;
            }
        }
        return {
            totalFiles: files.length,
            totalBytes,
            totalLines,
            filesWithEmbeddings,
            languageBreakdown,
            lastFullScan: this.lastFullScan,
            lastUpdate: this.lastUpdate,
            isWatching: this.isWatching,
            // Enhanced statistics
            totalDefinitions,
            totalDependencies,
            totalChunks,
            chunksWithEmbeddings,
            avgComplexity: complexityCount > 0 ? totalComplexity / complexityCount : 0,
            definitionBreakdown
        };
    }
    /**
     * shutdown - cleanup resources
     */
    async shutdown() {
        await this.stopWatching();
        this.index.clear();
        this.definitionsIndex.clear();
        this.dependenciesIndex.clear();
        this.chunksIndex.clear();
        this.complexityIndex.clear();
        logger.info('codebase indexer shut down');
    }
    // === ENHANCED PUBLIC API ===
    /**
     * getDefinitions - returns all definitions for a file
     */
    getDefinitions(filePath) {
        return this.definitionsIndex.get(filePath) || [];
    }
    /**
     * getAllDefinitions - returns all definitions across all files
     */
    getAllDefinitions() {
        return Array.from(this.definitionsIndex.values()).flat();
    }
    /**
     * searchDefinitions - searches for definitions by name
     */
    searchDefinitions(query) {
        const normalizedQuery = query.toLowerCase();
        return this.getAllDefinitions().filter(def => def.name.toLowerCase().includes(normalizedQuery) ||
            (def.qualifiedName?.toLowerCase().includes(normalizedQuery)));
    }
    /**
     * getDefinitionsByType - returns all definitions of a specific type
     */
    getDefinitionsByType(type) {
        return this.getAllDefinitions().filter(def => def.definitionType === type);
    }
    /**
     * getDependencies - returns all dependencies for a file
     */
    getDependencies(filePath) {
        return this.dependenciesIndex.get(filePath) || [];
    }
    /**
     * getAllDependencies - returns all dependencies across all files
     */
    getAllDependencies() {
        return Array.from(this.dependenciesIndex.values()).flat();
    }
    /**
     * getDependentsOf - returns files that import the given path
     */
    getDependentsOf(targetPath) {
        return this.getAllDependencies().filter(dep => dep.targetPath === targetPath ||
            dep.resolvedPath === targetPath);
    }
    /**
     * getExternalDependencies - returns all external (npm) dependencies
     */
    getExternalDependencies() {
        return this.getAllDependencies().filter(dep => dep.isExternal);
    }
    /**
     * getChunks - returns all chunks for a file
     */
    getChunks(filePath) {
        return this.chunksIndex.get(filePath) || [];
    }
    /**
     * getAllChunks - returns all chunks across all files
     */
    getAllChunks() {
        return Array.from(this.chunksIndex.values()).flat();
    }
    /**
     * getComplexity - returns complexity metrics for a file
     */
    getComplexity(filePath) {
        return this.complexityIndex.get(filePath);
    }
    /**
     * getHighComplexityFiles - returns files with high cyclomatic complexity
     */
    getHighComplexityFiles(threshold = 10) {
        return Array.from(this.complexityIndex.values())
            .filter(comp => (comp.cyclomaticComplexity || 0) > threshold)
            .sort((a, b) => (b.cyclomaticComplexity || 0) - (a.cyclomaticComplexity || 0));
    }
    /**
     * getLowMaintainabilityFiles - returns files with low maintainability index
     */
    getLowMaintainabilityFiles(threshold = 50) {
        return Array.from(this.complexityIndex.values())
            .filter(comp => (comp.maintainabilityIndex || 100) < threshold)
            .sort((a, b) => (a.maintainabilityIndex || 0) - (b.maintainabilityIndex || 0));
    }
    /**
     * findSimilarChunks - finds chunks similar to the query using embeddings
     * Returns chunks with similarity scores
     */
    async findSimilarChunks(query, limit = 10) {
        if (!this.embeddingProvider) {
            logger.warn('no embedding provider for similarity search');
            return [];
        }
        try {
            const queryEmbedding = await this.embeddingProvider.generateEmbedding(query);
            const allChunks = this.getAllChunks().filter(c => c.embedding);
            const results = allChunks.map(chunk => ({
                chunk,
                similarity: this.cosineSimilarity(queryEmbedding, chunk.embedding)
            }));
            return results
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, limit);
        }
        catch (error) {
            logger.warn({ error }, 'failed to find similar chunks');
            return [];
        }
    }
    /**
     * cosineSimilarity - calculates cosine similarity between two vectors
     */
    cosineSimilarity(a, b) {
        if (a.length !== b.length)
            return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        if (normA === 0 || normB === 0)
            return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
    /**
     * getDependencyGraph - returns a dependency graph for visualization
     */
    getDependencyGraph() {
        const nodes = new Set();
        const edges = [];
        for (const [filePath, deps] of this.dependenciesIndex) {
            nodes.add(filePath);
            for (const dep of deps) {
                if (dep.resolvedPath && !dep.isExternal) {
                    nodes.add(dep.resolvedPath);
                    edges.push({ from: filePath, to: dep.resolvedPath });
                }
            }
        }
        return {
            nodes: Array.from(nodes),
            edges
        };
    }
}
// Per-project indexer instances
const indexersByProject = new Map();
/**
 * getCodebaseIndexer - returns indexer instance for current project
 * uses Map pattern to isolate instances per project
 */
export function getCodebaseIndexer(config, embeddingProvider, db, projectPath) {
    const targetProject = projectPath || getProjectPath();
    if (!indexersByProject.has(targetProject)) {
        indexersByProject.set(targetProject, new CodebaseIndexer(config, embeddingProvider || null, db || null));
    }
    return indexersByProject.get(targetProject);
}
/**
 * resetCodebaseIndexer - resets the indexer for a project (for testing)
 */
export function resetCodebaseIndexer(projectPath) {
    const targetProject = projectPath || getProjectPath();
    const indexer = indexersByProject.get(targetProject);
    if (indexer) {
        indexer.shutdown();
        indexersByProject.delete(targetProject);
    }
}
/**
 * resetAllCodebaseIndexers - resets all indexer instances (for testing)
 */
export function resetAllCodebaseIndexers() {
    for (const [project, indexer] of indexersByProject) {
        indexer.shutdown();
    }
    indexersByProject.clear();
}
//# sourceMappingURL=codebaseIndexer.js.map