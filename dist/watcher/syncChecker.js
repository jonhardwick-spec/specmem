/**
 * syncChecker.ts - Sync Status Verification
 *
 * yooo checking if MCP is in sync with filesystem
 * detects drift and triggers resync when needed
 *
 * Features:
 * - Compare filesystem state with MCP memories
 * - Detect missing files (in MCP but not on disk)
 * - Detect new files (on disk but not in MCP)
 * - Detect modified files (content hash mismatch)
 * - Full resync capability
 * - Incremental drift detection
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { logger } from '../utils/logger.js';
import { glob } from 'glob';
import { getEmbeddingTimeout } from '../config/embeddingTimeouts.js';
/**
 * Wrap an async operation with a timeout. Prevents sync/resync from hanging
 * indefinitely when embedding service or DB becomes unresponsive.
 */
function withSyncTimeout(operation, timeoutMs, operationName) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            const err = new Error(`[Sync] ${operationName} timed out after ${Math.round(timeoutMs / 1000)}s`);
            err.code = 'SYNC_TIMEOUT';
            reject(err);
        }, timeoutMs);
        Promise.resolve().then(() => operation())
            .then(result => { clearTimeout(timeoutId); resolve(result); })
            .catch(error => { clearTimeout(timeoutId); reject(error); });
    });
}
/**
 * areWeStillInSync - sync status checker
 *
 * fr fr making sure everything is synced up
 */
export class AreWeStillInSync {
    config;
    lastSyncCheck = null;
    constructor(config) {
        this.config = {
            ...config,
            ignorePatterns: config.ignorePatterns ?? [],
            maxFileSizeBytes: config.maxFileSizeBytes ?? 1024 * 1024, // 1MB
            batchSize: config.batchSize ?? 100
        };
    }
    /**
     * checkSync - performs drift detection
     *
     * yooo checking if we still in sync
     */
    async checkSync() {
        logger.info('starting sync check...');
        const startTime = Date.now();
        try {
            // 1. get all files on disk
            const diskFiles = await this.scanDiskFiles();
            // 2. get all file-watcher memories from MCP
            const mcpFiles = await this.scanMcpMemories();
            // 3. compare and find drifts
            // LOW-11 FIX: Convert to Maps for O(1) lookups instead of O(n*m) nested find()
            const missingFromMcp = [];
            const missingFromDisk = [];
            const contentMismatch = [];
            let upToDate = 0;
            // LOW-11 FIX: Build lookup Maps for O(1) access
            const mcpFileMap = new Map(mcpFiles.map(m => [m.path, m]));
            const diskFileMap = new Map(diskFiles.map(f => [f.path, f]));
            // check files on disk - O(n) instead of O(n*m)
            for (const diskFile of diskFiles) {
                const mcpFile = mcpFileMap.get(diskFile.path);
                if (!mcpFile) {
                    missingFromMcp.push(diskFile.path);
                }
                else {
                    // compare content hash
                    if (diskFile.hash !== mcpFile.hash) {
                        contentMismatch.push(diskFile.path);
                    }
                    else {
                        upToDate++;
                    }
                }
            }
            // check files in MCP - O(m) instead of O(n*m)
            for (const mcpFile of mcpFiles) {
                const diskFile = diskFileMap.get(mcpFile.path);
                if (!diskFile && !mcpFile.deleted) {
                    missingFromDisk.push(mcpFile.path);
                }
            }
            // calculate metrics
            const totalFiles = diskFiles.length;
            const totalMemories = mcpFiles.length;
            const totalDrift = missingFromMcp.length + missingFromDisk.length + contentMismatch.length;
            // Sync score = what % of disk files are correctly synced in MCP
            // Deleted-from-disk files are cleanup work, not sync failures
            const totalItems = totalFiles || 1;
            const driftPercentage = totalItems > 0 ? (totalDrift / totalItems) * 100 : 0;
            const syncScore = totalItems > 0 ? upToDate / totalItems : 1;
            const report = {
                inSync: totalDrift === 0,
                lastChecked: new Date(),
                totalFiles,
                totalMemories,
                missingFromMcp,
                missingFromDisk,
                contentMismatch,
                upToDate,
                driftPercentage,
                syncScore
            };
            this.lastSyncCheck = report.lastChecked;
            const duration = Date.now() - startTime;
            logger.info({
                inSync: report.inSync,
                totalFiles,
                totalMemories,
                drift: totalDrift,
                driftPercentage: driftPercentage.toFixed(2),
                syncScore: syncScore.toFixed(3),
                durationMs: duration
            }, 'sync check complete');
            return report;
        }
        catch (error) {
            logger.error({ error }, 'sync check failed');
            throw error;
        }
    }
    /**
     * resyncEverythingFrFr - full resync of filesystem to MCP
     *
     * yooo doing a full resync lets goooo
     * NON-BLOCKING: Yields to event loop between batches
     */
    async resyncEverythingFrFr() {
        logger.info('starting full resync (non-blocking)...');
        const startTime = Date.now();
        // Overall resync deadline: 10 minutes max (configurable via SPECMEM_RESYNC_TIMEOUT_MS)
        const RESYNC_TIMEOUT_MS = parseInt(process.env['SPECMEM_RESYNC_TIMEOUT_MS'] || '600000');
        const isOverDeadline = () => (Date.now() - startTime) > RESYNC_TIMEOUT_MS;
        const result = {
            success: false,
            filesAdded: 0,
            filesUpdated: 0,
            filesMarkedDeleted: 0,
            errors: [],
            duration: 0
        };
        try {
            // 1. check current sync status
            const driftReport = await this.checkSync();
            logger.info({
                missingFromMcp: driftReport.missingFromMcp.length,
                missingFromDisk: driftReport.missingFromDisk.length,
                contentMismatch: driftReport.contentMismatch.length
            }, 'drift detected - starting resync');
            // Helper to process files in PARALLEL batches with concurrency + retry on transient failure
            const CONCURRENCY = 25; // High throughput: 30k files in 3min target, CPU-limited by QQMS
            const PER_FILE_TIMEOUT = getEmbeddingTimeout('fileWatcher'); // 120s per file operation
            const MAX_FILE_RETRIES = 1; // Retry failed files once before giving up
            const processInBatches = async (files, handler, operationType) => {
                const batchErrors = [];
                let processed = 0;
                let retryQueue = []; // Files that failed transiently and should be retried
                for (let i = 0; i < files.length; i += CONCURRENCY) {
                    if (isOverDeadline()) break; // Respect overall deadline
                    const batch = files.slice(i, i + CONCURRENCY);
                    const results = await Promise.allSettled(batch.map(path => withSyncTimeout(() => handler(path).then(() => path), PER_FILE_TIMEOUT, `${operationType} ${path}`)));
                    for (let j = 0; j < results.length; j++) {
                        const result = results[j];
                        if (result.status === 'fulfilled') {
                            processed++;
                        } else {
                            const errMsg = result.reason?.message || String(result.reason);
                            const isTransient = errMsg.includes('timeout') || errMsg.includes('ECONNRESET') || errMsg.includes('socket') || errMsg.includes('QOMS');
                            if (isTransient) {
                                retryQueue.push(batch[j]);
                            } else {
                                batchErrors.push(`Failed to ${operationType}: ${errMsg}`);
                                logger.error({ error: result.reason }, `failed to ${operationType} file during resync`);
                            }
                        }
                    }
                    // Yield to event loop between parallel batches
                    if (i + CONCURRENCY < files.length) {
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                    // Log progress every 50 files
                    if (processed > 0 && processed % 50 === 0) {
                        logger.info({ processed, total: files.length, operationType }, 'resync progress');
                    }
                }
                // Retry pass: process transiently-failed files once more with backoff
                if (retryQueue.length > 0 && !isOverDeadline()) {
                    logger.info({ retryCount: retryQueue.length, operationType }, '[Sync] Retrying transiently-failed files after 2s backoff');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    for (let i = 0; i < retryQueue.length; i += CONCURRENCY) {
                        if (isOverDeadline()) break;
                        const retryBatch = retryQueue.slice(i, i + CONCURRENCY);
                        const retryResults = await Promise.allSettled(retryBatch.map(path => withSyncTimeout(() => handler(path).then(() => path), PER_FILE_TIMEOUT, `${operationType} retry ${path}`)));
                        for (const result of retryResults) {
                            if (result.status === 'fulfilled') {
                                processed++;
                            } else {
                                const errMsg = result.reason?.message || String(result.reason);
                                batchErrors.push(`Failed to ${operationType} (after retry): ${errMsg}`);
                            }
                        }
                    }
                }
                return { processed, errors: batchErrors };
            };
            // 2. add missing files to MCP
            const addResult = await processInBatches(driftReport.missingFromMcp, async (path) => {
                const fullPath = join(this.config.rootPath, path);
                const stats = await fs.stat(fullPath);
                await this.config.changeHandler.handleChange({
                    type: 'add',
                    path: fullPath,
                    relativePath: path,
                    timestamp: new Date(),
                    stats: { size: stats.size, mtime: stats.mtime }
                });
            }, 'add');
            result.filesAdded = addResult.processed;
            result.errors.push(...addResult.errors);
            // Check overall deadline between phases
            if (isOverDeadline()) {
                logger.warn({ elapsedMs: Date.now() - startTime, phase: 'after-add' }, '[Sync] Resync deadline exceeded, stopping early');
                result.errors.push(`Resync deadline exceeded after add phase (${Math.round((Date.now() - startTime) / 1000)}s)`);
                result.duration = Date.now() - startTime;
                return result;
            }
            // 3. update files with content mismatch
            const updateResult = await processInBatches(driftReport.contentMismatch, async (path) => {
                const fullPath = join(this.config.rootPath, path);
                const stats = await fs.stat(fullPath);
                await this.config.changeHandler.handleChange({
                    type: 'change',
                    path: fullPath,
                    relativePath: path,
                    timestamp: new Date(),
                    stats: { size: stats.size, mtime: stats.mtime }
                });
            }, 'update');
            result.filesUpdated = updateResult.processed;
            result.errors.push(...updateResult.errors);
            // Check overall deadline between phases
            if (isOverDeadline()) {
                logger.warn({ elapsedMs: Date.now() - startTime, phase: 'after-update' }, '[Sync] Resync deadline exceeded, stopping early');
                result.errors.push(`Resync deadline exceeded after update phase (${Math.round((Date.now() - startTime) / 1000)}s)`);
                result.duration = Date.now() - startTime;
                return result;
            }
            // 4. mark deleted files
            const deleteResult = await processInBatches(driftReport.missingFromDisk, async (path) => {
                await this.config.changeHandler.handleChange({
                    type: 'unlink',
                    path: join(this.config.rootPath, path),
                    relativePath: path,
                    timestamp: new Date()
                });
            }, 'mark deleted');
            result.filesMarkedDeleted = deleteResult.processed;
            result.errors.push(...deleteResult.errors);
            result.success = result.errors.length === 0;
            result.duration = Date.now() - startTime;
            logger.info({
                success: result.success,
                filesAdded: result.filesAdded,
                filesUpdated: result.filesUpdated,
                filesMarkedDeleted: result.filesMarkedDeleted,
                errors: result.errors.length,
                durationMs: result.duration
            }, 'resync complete');
            return result;
        }
        catch (error) {
            result.errors.push(`Resync failed: ${error.message}`);
            result.duration = Date.now() - startTime;
            logger.error({ error }, 'resync failed');
            return result;
        }
    }
    /**
     * scanDiskFiles - scans filesystem for all files
     *
     * NON-BLOCKING: Uses streaming/generator pattern to avoid loading all paths into memory.
     * Processes files in configurable batches with memory pressure detection.
     * Respects .gitignore and configurable ignore patterns.
     *
     * Env vars:
     *   SPECMEM_SCAN_BATCH_SIZE      - files per batch (default 500)
     *   SPECMEM_SCAN_MAX_FILES       - max files to scan (default 50000)
     *   SPECMEM_SCAN_MAX_HEAP_MB     - heap limit before pausing (default 2048)
     *   SPECMEM_SCAN_IGNORE_PATTERNS - comma-separated ignore dirs (default "node_modules,.git,dist,build,.next,__pycache__")
     */
    async scanDiskFiles() {
        logger.debug('scanning disk files (streaming, non-blocking)...');
        // Configurable limits via environment variables
        const SCAN_BATCH_SIZE = parseInt(process.env['SPECMEM_SCAN_BATCH_SIZE'] || '2000');
        const SCAN_MAX_FILES = parseInt(process.env['SPECMEM_SCAN_MAX_FILES'] || '50000');
        const SCAN_MAX_HEAP_MB = parseInt(process.env['SPECMEM_SCAN_MAX_HEAP_MB'] || '2048');
        const SCAN_MAX_HEAP_BYTES = SCAN_MAX_HEAP_MB * 1024 * 1024;
        // Configurable ignore patterns via env var (comma-separated directory names)
        const defaultIgnoreDirs = 'node_modules,.git,dist,build,.next,__pycache__';
        const envIgnoreDirs = process.env['SPECMEM_SCAN_IGNORE_PATTERNS'] || defaultIgnoreDirs;
        const ignoreDirNames = envIgnoreDirs.split(',').map(d => d.trim()).filter(Boolean);
        // Build glob ignore patterns from the directory names
        const ignorePatterns = [
            ...ignoreDirNames.map(d => `**/${d}/**`),
            '**/coverage/**',
            '**/.cache/**',
            ...this.config.ignorePatterns
        ];
        // Use glob stream to avoid loading all paths into a single array
        const fileStream = glob.stream('**/*', {
            cwd: this.config.rootPath,
            ignore: ignorePatterns,
            nodir: true, // only files
            dot: false, // ignore dotfiles
            absolute: false
        });
        const fileData = [];
        let batch = [];
        let processedCount = 0;
        let totalEnumerated = 0;
        let memoryPressurePaused = false;
        /**
         * Process a single batch of file paths: stat, read, hash.
         */
        const processBatch = async (fileBatch) => {
            for (const file of fileBatch) {
                try {
                    const fullPath = join(this.config.rootPath, file);
                    const stats = await fs.stat(fullPath);
                    // skip large files
                    if (stats.size > this.config.maxFileSizeBytes) {
                        logger.debug({ path: file, size: stats.size }, 'skipping large file');
                        continue;
                    }
                    // skip binary files (heuristic: check for null bytes)
                    const content = await fs.readFile(fullPath, 'utf-8').catch(() => null);
                    if (!content) {
                        logger.debug({ path: file }, 'skipping binary file');
                        continue;
                    }
                    const hash = createHash('sha256').update(content).digest('hex');
                    fileData.push({ path: file, hash });
                }
                catch (error) {
                    logger.debug({ error, path: file }, 'failed to process file');
                }
            }
        };
        // Consume the glob stream in batches
        for await (const filePath of fileStream) {
            totalEnumerated++;
            // Enforce max files limit to prevent runaway scanning
            if (totalEnumerated > SCAN_MAX_FILES) {
                logger.warn({ maxFiles: SCAN_MAX_FILES, enumerated: totalEnumerated }, '[SyncChecker] Max files limit reached, stopping scan');
                break;
            }
            batch.push(typeof filePath === 'string' ? filePath : filePath.toString());
            // When batch is full, process it
            if (batch.length >= SCAN_BATCH_SIZE) {
                // Memory pressure detection
                const heapUsed = process.memoryUsage().heapUsed;
                if (heapUsed > SCAN_MAX_HEAP_BYTES) {
                    if (!memoryPressurePaused) {
                        logger.warn({
                            heapUsedMB: Math.round(heapUsed / (1024 * 1024)),
                            limitMB: SCAN_MAX_HEAP_MB,
                            processedSoFar: processedCount,
                            enumerated: totalEnumerated
                        }, '[SyncChecker] Memory pressure detected during disk scan, pausing to allow GC');
                        memoryPressurePaused = true;
                    }
                    // Force GC if available, then yield to let it run
                    if (global.gc) {
                        global.gc();
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                    // Re-check after pause
                    const heapAfter = process.memoryUsage().heapUsed;
                    if (heapAfter > SCAN_MAX_HEAP_BYTES) {
                        logger.warn({
                            heapUsedMB: Math.round(heapAfter / (1024 * 1024)),
                            limitMB: SCAN_MAX_HEAP_MB,
                            processedSoFar: processedCount
                        }, '[SyncChecker] Memory pressure persists after GC pause, stopping scan early');
                        break;
                    }
                    memoryPressurePaused = false;
                }
                await processBatch(batch);
                processedCount += batch.length;
                batch = [];
                // Yield to event loop between batches - prevents blocking
                await new Promise(resolve => setImmediate(resolve));
                // Log progress periodically
                if (processedCount % 1000 === 0) {
                    logger.debug({ processed: processedCount, hashed: fileData.length, enumerated: totalEnumerated }, 'disk scan progress');
                }
            }
        }
        // Process any remaining files in the last partial batch
        if (batch.length > 0) {
            await processBatch(batch);
            processedCount += batch.length;
        }
        logger.debug({ count: fileData.length, totalProcessed: processedCount, totalEnumerated, maxFiles: SCAN_MAX_FILES }, 'disk scan complete');
        return fileData;
    }
    /**
     * scanMcpMemories - gets all file-watcher memories from MCP
     * Also checks codebase_files table where actual indexed files are stored.
     *
     * Uses pagination to handle codebases with >10K memories.
     *
     * Env vars:
     *   SPECMEM_SYNC_MEMORY_LIMIT     - max total memories to fetch (default 50000)
     *   SPECMEM_SYNC_MEMORY_PAGE_SIZE  - page size for paginated queries (default 5000)
     */
    async scanMcpMemories() {
        logger.debug('scanning MCP memories and codebase_files...');
        const MEMORY_LIMIT = parseInt(process.env['SPECMEM_SYNC_MEMORY_LIMIT'] || '50000');
        const PAGE_SIZE = parseInt(process.env['SPECMEM_SYNC_MEMORY_PAGE_SIZE'] || '5000');
        const allFiles = [];
        const seenPaths = new Set();
        try {
            // 1. Check codebase_files table first (this is where indexed files actually live)
            const pool = this.config.search.getPool();
            // Get total count first for logging
            const countResult = await pool.queryWithSwag(`SELECT COUNT(*) as total
                FROM codebase_files
                WHERE project_path = $1 AND content_hash IS NOT NULL`, [this.config.rootPath]);
            const totalCodebaseFiles = parseInt(countResult.rows[0]?.total || '0');
            logger.debug({ totalCodebaseFiles }, 'codebase_files total count');
            // Paginated fetch of codebase_files
            let codebaseOffset = 0;
            let codebaseFetched = 0;
            while (codebaseFetched < MEMORY_LIMIT) {
                const currentPageSize = Math.min(PAGE_SIZE, MEMORY_LIMIT - codebaseFetched);
                const codebaseResult = await pool.queryWithSwag(`SELECT file_path, content_hash
                    FROM codebase_files
                    WHERE project_path = $1 AND content_hash IS NOT NULL
                    ORDER BY file_path
                    LIMIT $2 OFFSET $3`, [this.config.rootPath, currentPageSize, codebaseOffset]);
                if (codebaseResult.rows.length === 0) {
                    break; // No more rows
                }
                for (const row of codebaseResult.rows) {
                    if (row.file_path && !seenPaths.has(row.file_path)) {
                        seenPaths.add(row.file_path);
                        allFiles.push({
                            path: row.file_path,
                            hash: row.content_hash || '',
                            deleted: false
                        });
                    }
                }
                codebaseFetched += codebaseResult.rows.length;
                codebaseOffset += codebaseResult.rows.length;
                // If we got fewer than page size, we've reached the end
                if (codebaseResult.rows.length < currentPageSize) {
                    break;
                }
                // Yield to event loop between pages
                await new Promise(resolve => setImmediate(resolve));
            }
            logger.debug({ codebaseFilesCount: codebaseFetched, totalInDb: totalCodebaseFiles }, 'codebase_files scan complete');
            // 2. Also check memories table for file-watcher entries (legacy support)
            // Use pagination to avoid the old hardcoded 10K limit
            const memoriesCountResult = await pool.queryWithSwag(`SELECT COUNT(*) as total
                FROM memories
                WHERE project_path = $1 AND metadata->>'source' = 'file-watcher'`, [this.config.rootPath]);
            const totalMemories = parseInt(memoriesCountResult.rows[0]?.total || '0');
            logger.debug({ totalMemories }, 'file-watcher memories total count');
            let memoriesOffset = 0;
            let memoriesFetched = 0;
            let memoriesAdded = 0;
            const memoryFetchLimit = MEMORY_LIMIT - codebaseFetched; // Respect overall limit
            while (memoriesFetched < memoryFetchLimit && memoriesFetched < totalMemories) {
                const currentPageSize = Math.min(PAGE_SIZE, memoryFetchLimit - memoriesFetched);
                const results = await this.config.search.textSearch({
                    query: 'file-watcher',
                    limit: currentPageSize,
                    offset: memoriesOffset,
                    projectPath: this.config.rootPath
                });
                if (!results || results.length === 0) {
                    break; // No more results
                }
                const memoriesData = results
                    .filter(m => m.memory.metadata?.source === 'file-watcher')
                    .map(m => ({
                    path: m.memory.metadata?.filePath || '',
                    hash: m.memory.metadata?.contentHash || '',
                    deleted: m.memory.metadata?.deleted === true
                }))
                    .filter(m => m.path);
                // Merge memories entries (avoiding duplicates)
                for (const mem of memoriesData) {
                    if (!seenPaths.has(mem.path)) {
                        seenPaths.add(mem.path);
                        allFiles.push(mem);
                        memoriesAdded++;
                    }
                }
                memoriesFetched += results.length;
                memoriesOffset += results.length;
                // If we got fewer than page size, we've reached the end
                if (results.length < currentPageSize) {
                    break;
                }
                // Yield to event loop between pages
                await new Promise(resolve => setImmediate(resolve));
            }
            logger.debug({
                totalCount: allFiles.length,
                fromCodebaseFiles: codebaseFetched,
                fromMemories: memoriesAdded,
                totalMemoriesInDb: totalMemories,
                totalCodebaseInDb: totalCodebaseFiles,
                memoryLimit: MEMORY_LIMIT,
                pageSize: PAGE_SIZE
            }, 'MCP scan complete');
            return allFiles;
        }
        catch (error) {
            logger.error({ error }, 'failed to scan MCP memories');
            return [];
        }
    }
    /**
     * getLastSyncCheck - returns time of last sync check
     */
    getLastSyncCheck() {
        return this.lastSyncCheck;
    }
    /**
     * getSyncHealth - returns health metrics
     */
    async getSyncHealth() {
        const issues = [];
        const minutesSinceCheck = this.lastSyncCheck
            ? (Date.now() - this.lastSyncCheck.getTime()) / 1000 / 60
            : null;
        // check if we need a sync check
        if (!this.lastSyncCheck) {
            issues.push('Never performed sync check');
        }
        else if (minutesSinceCheck && minutesSinceCheck > 60) {
            issues.push(`Last sync check was ${Math.floor(minutesSinceCheck)} minutes ago`);
        }
        // do a quick sync check if needed
        if (!this.lastSyncCheck || (minutesSinceCheck && minutesSinceCheck > 60)) {
            try {
                const report = await this.checkSync();
                if (!report.inSync) {
                    issues.push(`Drift detected: ${report.missingFromMcp.length} missing, ${report.contentMismatch.length} modified`);
                }
                if (report.driftPercentage > 10) {
                    issues.push(`High drift: ${report.driftPercentage.toFixed(1)}%`);
                }
            }
            catch (error) {
                issues.push(`Sync check failed: ${error.message}`);
            }
        }
        return {
            healthy: issues.length === 0,
            lastChecked: this.lastSyncCheck,
            minutesSinceCheck,
            issues
        };
    }
}
//# sourceMappingURL=syncChecker.js.map