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
            const totalItems = Math.max(totalFiles, totalMemories);
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
            // Helper to process files in batches with yielding
            const processInBatches = async (files, handler, operationType) => {
                const batchErrors = [];
                let processed = 0;
                const BATCH_SIZE = this.config.batchSize;
                for (let i = 0; i < files.length; i += BATCH_SIZE) {
                    const batch = files.slice(i, i + BATCH_SIZE);
                    for (const path of batch) {
                        try {
                            await handler(path);
                            processed++;
                        }
                        catch (error) {
                            batchErrors.push(`Failed to ${operationType} ${path}: ${error.message}`);
                            logger.error({ error, path }, `failed to ${operationType} file during resync`);
                        }
                    }
                    // Yield to event loop after each batch
                    if (i + BATCH_SIZE < files.length) {
                        await new Promise(resolve => setImmediate(resolve));
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
     * NON-BLOCKING: Yields to event loop periodically during batch processing
     * This prevents blocking the main thread even on large codebases
     */
    async scanDiskFiles() {
        logger.debug('scanning disk files (non-blocking)...');
        // build ignore patterns for glob
        const ignorePatterns = [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/.next/**',
            '**/coverage/**',
            '**/.cache/**',
            ...this.config.ignorePatterns
        ];
        // scan all files - glob itself is async so this part is non-blocking
        const files = await glob('**/*', {
            cwd: this.config.rootPath,
            ignore: ignorePatterns,
            nodir: true, // only files
            dot: false, // ignore dotfiles
            absolute: false
        });
        // read and hash each file in batches, yielding to event loop between batches
        const fileData = [];
        const BATCH_SIZE = this.config.batchSize;
        let processedCount = 0;
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            const batch = files.slice(i, i + BATCH_SIZE);
            // Process batch
            for (const file of batch) {
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
            processedCount += batch.length;
            // Yield to event loop after each batch - prevents blocking
            // This lets other operations (like MCP requests) process between batches
            if (i + BATCH_SIZE < files.length) {
                await new Promise(resolve => setImmediate(resolve));
                // Log progress for large scans
                if (processedCount % 500 === 0) {
                    logger.debug({ processed: processedCount, total: files.length }, 'disk scan progress');
                }
            }
        }
        logger.debug({ count: fileData.length, total: files.length }, 'disk scan complete');
        return fileData;
    }
    /**
     * scanMcpMemories - gets all file-watcher memories from MCP
     * Also checks codebase_files table where actual indexed files are stored
     */
    async scanMcpMemories() {
        logger.debug('scanning MCP memories and codebase_files...');
        const allFiles = [];
        const seenPaths = new Set();
        try {
            // 1. Check codebase_files table first (this is where indexed files actually live)
            const pool = this.config.search.getPool();
            const codebaseResult = await pool.queryWithSwag(`SELECT file_path, content_hash
         FROM codebase_files
         WHERE project_path = $1 AND content_hash IS NOT NULL`, [this.config.rootPath]);
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
            logger.debug({ codebaseFilesCount: codebaseResult.rows.length }, 'codebase_files scan complete');
            // 2. Also check memories table for file-watcher entries (legacy support)
            const results = await this.config.search.textSearch({
                query: 'file-watcher',
                limit: 10000,
                projectPath: this.config.rootPath
            });
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
                }
            }
            logger.debug({
                totalCount: allFiles.length,
                fromCodebaseFiles: codebaseResult.rows.length,
                fromMemories: memoriesData.length
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