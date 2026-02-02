/**
 * changeHandler.ts - Processes File Changes and Updates MCP Memories
 *
 * fr fr auto-updating these memories when files change
 * handles all CRUD operations on the memory database
 *
 * Features:
 * - Auto-ingest new files
 * - Update existing memories on file modification
 * - Mark deleted files (keep history)
 * - Handle file renames (update path, keep content)
 * - Content hashing for deduplication
 *
 * Now integrated with LWJEB event bus for file:changed, file:added, file:deleted events
 */
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { basename, extname } from 'path';
import { logger } from '../utils/logger.js';
import { getCoordinator } from '../coordination/integration.js';
import { isMinifiedOrBundled, isBinaryFile, EXCLUSION_CONFIG } from '../codebase/exclusions.js';
import { getProjectPathForInsert } from '../services/ProjectContext.js';
/**
 * autoUpdateTheMemories - main change handler class
 *
 * yooo processing all them file changes rn
 * keeps MCP memories in sync with the filesystem
 *
 * Emits LWJEB events: file:changed, file:added, file:deleted
 */
export class AutoUpdateTheMemories {
    config;
    coordinator = getCoordinator();
    // stats tracking
    stats = {
        filesIngested: 0,
        filesUpdated: 0,
        filesDeleted: 0,
        filesRenamed: 0,
        filesSkipped: 0,
        errors: 0,
        totalBytesProcessed: 0,
        lastUpdateTime: null
    };
    constructor(config) {
        this.config = {
            ...config,
            maxFileSizeBytes: config.maxFileSizeBytes ?? EXCLUSION_CONFIG.maxFileSize,
            autoDetectMetadata: config.autoDetectMetadata ?? true,
            batchChanges: config.batchChanges ?? false,
            batchWindowMs: config.batchWindowMs ?? 5000
        };
    }
    /**
     * handleChange - main entry point for processing file changes
     *
     * fr fr dispatching to the right handler based on event type
     * Emits LWJEB file:changed event for all changes
     */
    async handleChange(event) {
        try {
            logger.debug({ event }, 'processing file change event');
            // Emit file:changed event via LWJEB for all file operations
            if (event.type === 'add' || event.type === 'change' || event.type === 'unlink') {
                this.coordinator.emitFileChanged(event.path, event.relativePath, event.type, event.stats?.size);
            }
            switch (event.type) {
                case 'add':
                    await this.handleFileAdded(event);
                    break;
                case 'change':
                    await this.handleFileModified(event);
                    break;
                case 'unlink':
                    await this.handleFileDeleted(event);
                    break;
                case 'addDir':
                case 'unlinkDir':
                    // nah bruh we dont track directories
                    logger.debug({ path: event.path }, 'ignoring directory event');
                    break;
                default:
                    logger.warn({ event }, 'unknown event type');
            }
            this.stats.lastUpdateTime = new Date();
        }
        catch (error) {
            this.stats.errors++;
            logger.error({ error, event }, 'failed to process file change');
            throw error;
        }
    }
    /**
     * handleFileAdded - ingest new file into MCP
     *
     * yooo new file just dropped - lets remember this
     */
    async handleFileAdded(event) {
        logger.info({ path: event.relativePath }, 'ingesting new file');
        try {
            // check minified/bundled FIRST - fast O(1) pattern check
            if (isMinifiedOrBundled(event.path)) {
                logger.debug({ path: event.relativePath }, 'skipping minified/bundled file');
                this.stats.filesSkipped++;
                return;
            }
            // check if binary
            if (await isBinaryFile(event.path)) {
                logger.debug({ path: event.relativePath }, 'skipping binary file');
                this.stats.filesSkipped++;
                return;
            }
            // read file and generate metadata
            const metadata = await this.extractFileMetadata(event.path, event.relativePath);
            // check file size
            if (metadata.size > this.config.maxFileSizeBytes) {
                logger.warn({
                    path: metadata.relativePath,
                    size: metadata.size,
                    sizeMB: (metadata.size / (1024 * 1024)).toFixed(2),
                    maxSize: this.config.maxFileSizeBytes
                }, 'file too large - skipping auto-ingest');
                this.stats.filesSkipped++;
                return;
            }
            // read file content
            const content = await fs.readFile(event.path, 'utf-8');
            // check if already exists (by content hash)
            const existingMemory = await this.findMemoryByContentHash(metadata.contentHash);
            if (existingMemory) {
                logger.debug({
                    path: metadata.relativePath,
                    existingId: existingMemory.id
                }, 'file content already exists in memory - skipping');
                this.stats.filesSkipped++;
                return;
            }
            // generate embedding with retry and queue fallback
            let embedding;
            try {
                embedding = await this.config.embeddingProvider.generateEmbedding(content);
            }
            catch (embeddingError) {
                logger.error({
                    error: embeddingError,
                    path: metadata.relativePath,
                    size: metadata.size
                }, 'Failed to generate embedding for file - will retry later');
                // Don't fail the entire ingestion - file will be reprocessed on next change
                // or during sync check
                this.stats.errors++;
                throw new Error(`Embedding generation failed: ${embeddingError instanceof Error ? embeddingError.message : String(embeddingError)}`);
            }
            // auto-detect importance and memory type
            const { importance, memoryType, tags } = this.autoDetectMetadata(metadata, content);
            // create memory payload
            const payload = {
                content,
                embedding,
                memoryType,
                importance,
                tags: [
                    ...tags,
                    'file-watcher',
                    'auto-ingested',
                    `ext:${metadata.extension}`,
                    `path:${metadata.relativePath}`
                ],
                metadata: {
                    source: 'file-watcher',
                    filePath: metadata.relativePath,
                    filename: metadata.filename,
                    extension: metadata.extension,
                    size: metadata.size,
                    mtime: metadata.mtime.toISOString(),
                    contentHash: metadata.contentHash,
                    autoIngested: true
                }
            };
            // yeet it into the database (memories table)
            const result = await this.config.yeeter.yeetOne(payload);
            // ALSO add to codebase_files for code search
            await this.updateCodebaseFiles(event.path, metadata, content, embedding);
            this.stats.filesIngested++;
            this.stats.totalBytesProcessed += metadata.size;
            // Emit file:added event via LWJEB
            this.coordinator.emitFileAdded(event.path, metadata.relativePath, metadata.size, metadata.contentHash);
            logger.info({
                path: metadata.relativePath,
                memoryId: result.id,
                size: metadata.size
            }, 'file ingested to both memories and codebase_files tables');
        }
        catch (error) {
            logger.error({ error, path: event.path }, 'failed to ingest file');
            throw error;
        }
    }
    /**
     * handleFileModified - update existing memory
     *
     * fr fr this file changed - updating memory now
     */
    async handleFileModified(event) {
        logger.info({ path: event.relativePath }, 'updating modified file');
        try {
            // check minified/bundled FIRST - fast O(1) pattern check
            if (isMinifiedOrBundled(event.path)) {
                logger.debug({ path: event.relativePath }, 'skipping minified/bundled file update');
                this.stats.filesSkipped++;
                return;
            }
            // extract new metadata
            const metadata = await this.extractFileMetadata(event.path, event.relativePath);
            // check file size
            if (metadata.size > this.config.maxFileSizeBytes) {
                logger.warn({
                    path: metadata.relativePath,
                    sizeMB: (metadata.size / (1024 * 1024)).toFixed(2)
                }, 'file too large - skipping update');
                this.stats.filesSkipped++;
                return;
            }
            // find existing memory by file path
            const existingMemory = await this.findMemoryByFilePath(metadata.relativePath);
            if (!existingMemory) {
                logger.info({ path: metadata.relativePath }, 'no existing memory found - treating as new file');
                await this.handleFileAdded(event);
                return;
            }
            // read new content
            const content = await fs.readFile(event.path, 'utf-8');
            // check if content actually changed
            if (metadata.contentHash === existingMemory.metadata?.contentHash) {
                logger.debug({ path: metadata.relativePath }, 'content unchanged - skipping update');
                this.stats.filesSkipped++;
                return;
            }
            // generate new embedding with retry and queue fallback
            let embedding;
            try {
                embedding = await this.config.embeddingProvider.generateEmbedding(content);
            }
            catch (embeddingError) {
                logger.error({
                    error: embeddingError,
                    path: metadata.relativePath,
                    size: metadata.size
                }, 'Failed to generate embedding for modified file - will retry later');
                // Don't fail the entire update - file will be reprocessed on next change
                // or during sync check
                this.stats.errors++;
                throw new Error(`Embedding generation failed: ${embeddingError instanceof Error ? embeddingError.message : String(embeddingError)}`);
            }
            // auto-detect new metadata
            const { importance, memoryType, tags } = this.autoDetectMetadata(metadata, content);
            // update the memory
            const payload = {
                content,
                embedding,
                memoryType,
                importance,
                tags: [
                    ...tags,
                    'file-watcher',
                    'auto-updated',
                    `ext:${metadata.extension}`,
                    `path:${metadata.relativePath}`
                ],
                metadata: {
                    ...existingMemory.metadata,
                    filePath: metadata.relativePath,
                    filename: metadata.filename,
                    size: metadata.size,
                    mtime: metadata.mtime.toISOString(),
                    contentHash: metadata.contentHash,
                    previousHash: existingMemory.metadata?.contentHash,
                    lastUpdated: new Date().toISOString(),
                    updateCount: (existingMemory.metadata?.updateCount ?? 0) + 1
                }
            };
            // atomic upsert - preserves ID, no race conditions
            const result = await this.config.yeeter.yeetUpdateById(existingMemory.id, payload);
            // ALSO update codebase_files table - CRITICAL for code search to have fresh data
            // Uses UPSERT pattern: try UPDATE first, INSERT if not found
            await this.updateCodebaseFiles(event.path, metadata, content, embedding);
            this.stats.filesUpdated++;
            this.stats.totalBytesProcessed += metadata.size;
            logger.info({
                path: metadata.relativePath,
                oldId: existingMemory.id,
                newId: result.id,
                size: metadata.size
            }, 'file updated in both memories and codebase_files tables');
        }
        catch (error) {
            logger.error({ error, path: event.path }, 'failed to update file');
            throw error;
        }
    }
    /**
     * handleFileDeleted - remove file from both memories and codebase_files tables
     *
     * nah bruh file got yeeted - cleaning up both tables
     */
    async handleFileDeleted(event) {
        logger.info({ path: event.relativePath }, 'handling file deletion');
        const projectPath = getProjectPathForInsert();
        try {
            // 1. Handle memories table - mark as deleted (keeps history)
            const existingMemory = await this.findMemoryByFilePath(event.relativePath);
            if (existingMemory) {
                const updatedPayload = {
                    content: existingMemory.content,
                    embedding: existingMemory.embedding,
                    memoryType: existingMemory.memoryType,
                    importance: existingMemory.importance,
                    tags: [
                        ...(existingMemory.tags || []),
                        'file-deleted',
                        'archived'
                    ],
                    metadata: {
                        ...existingMemory.metadata,
                        deleted: true,
                        deletedAt: new Date().toISOString(),
                        deletedBy: 'file-watcher'
                    }
                };
                await this.config.yeeter.yeetUpdateById(existingMemory.id, updatedPayload);
                logger.debug({ path: event.relativePath, memoryId: existingMemory.id }, 'memory marked as deleted');
            }
            // 2. Handle codebase_files table - actually delete the entry
            // Uses parameterized query with project_path filter for proper isolation
            const deleteResult = await this.config.pool.queryWithSwag(`DELETE FROM codebase_files WHERE file_path = $1 AND project_path = $2 RETURNING id`, [event.relativePath, projectPath]);
            const codebaseFilesDeleted = deleteResult.rowCount ?? 0;
            if (codebaseFilesDeleted > 0) {
                logger.debug({ path: event.relativePath, projectPath, count: codebaseFilesDeleted }, 'deleted from codebase_files');
            }
            this.stats.filesDeleted++;
            // Emit file:deleted event via LWJEB
            this.coordinator.emitFileDeleted(event.path, event.relativePath);
            logger.info({
                path: event.relativePath,
                memoryMarked: !!existingMemory,
                codebaseFilesDeleted
            }, 'file deletion handled - cleaned up from both tables');
        }
        catch (error) {
            logger.error({ error, path: event.path }, 'failed to handle file deletion');
            throw error;
        }
    }
    /**
     * extractFileMetadata - reads file and generates metadata
     */
    async extractFileMetadata(path, relativePath) {
        const stats = await fs.stat(path);
        const content = await fs.readFile(path, 'utf-8');
        const contentHash = this.hashContent(content);
        return {
            path,
            relativePath,
            filename: basename(path),
            extension: extname(path).slice(1), // remove leading dot
            size: stats.size,
            mtime: stats.mtime,
            contentHash
        };
    }
    /**
     * hashContent - generates SHA-256 hash of content
     */
    hashContent(content) {
        return createHash('sha256').update(content).digest('hex');
    }
    /**
     * findMemoryByFilePath - searches for memory by file path
     */
    async findMemoryByFilePath(relativePath) {
        try {
            // search by metadata.filePath tag
            const results = await this.config.search.textSearch({
                query: `path:${relativePath}`,
                limit: 1
            });
            return results.length > 0 ? results[0] : null;
        }
        catch (error) {
            logger.error({ error, path: relativePath }, 'failed to find memory by path');
            return null;
        }
    }
    /**
     * findMemoryByContentHash - searches for memory by content hash
     */
    async findMemoryByContentHash(contentHash) {
        try {
            // search by metadata.contentHash
            const results = await this.config.search.textSearch({
                query: `contentHash:${contentHash}`,
                limit: 1
            });
            return results.length > 0 ? results[0] : null;
        }
        catch (error) {
            logger.error({ error, contentHash }, 'failed to find memory by hash');
            return null;
        }
    }
    /**
     * autoDetectMetadata - intelligently determines file importance and type
     *
     * skids could never build this smart detection
     */
    autoDetectMetadata(metadata, content) {
        if (!this.config.autoDetectMetadata) {
            return {
                importance: 'medium',
                memoryType: 'semantic',
                tags: []
            };
        }
        const ext = metadata.extension.toLowerCase();
        const filename = metadata.filename.toLowerCase();
        const tags = [];
        // determine importance
        let importance = 'medium';
        if (filename.includes('config') || filename.includes('env')) {
            importance = 'critical';
            tags.push('configuration');
        }
        else if (ext === 'ts' || ext === 'js' || ext === 'py' || ext === 'rs' || ext === 'go') {
            importance = 'high';
            tags.push('source-code');
        }
        else if (ext === 'md' || ext === 'txt' || ext === 'doc') {
            importance = 'medium';
            tags.push('documentation');
        }
        else if (ext === 'json' || ext === 'yaml' || ext === 'toml') {
            importance = 'high';
            tags.push('data-file');
        }
        else {
            importance = 'low';
        }
        // determine memory type
        let memoryType = 'semantic';
        if (ext === 'md' || ext === 'txt') {
            memoryType = 'episodic'; // documentation is episodic
        }
        else if (ext === 'ts' || ext === 'js' || ext === 'py') {
            memoryType = 'procedural'; // code is procedural
        }
        else {
            memoryType = 'semantic'; // everything else is semantic
        }
        // add language tags
        const languageMap = {
            ts: 'typescript',
            js: 'javascript',
            py: 'python',
            rs: 'rust',
            go: 'golang',
            md: 'markdown',
            json: 'json',
            yaml: 'yaml',
            toml: 'toml'
        };
        if (languageMap[ext]) {
            tags.push(languageMap[ext]);
        }
        return { importance, memoryType, tags };
    }
    /**
     * updateCodebaseFiles - UPSERTS file data into codebase_files table
     *
     * Uses try UPDATE, then INSERT pattern for atomic updates
     * Includes content, content_hash, embedding for semantic code search
     * Project-scoped via project_path column
     */
    async updateCodebaseFiles(absolutePath, metadata, content, embedding) {
        const projectPath = getProjectPathForInsert();
        try {
            const lineCount = content.split('\n').length;
            const embeddingStr = '[' + embedding.join(',') + ']';
            // Try UPDATE first - more common case for file changes
            const updateResult = await this.config.pool.queryWithSwag(`UPDATE codebase_files SET
          content = $1,
          content_hash = $2,
          embedding = $3,
          size_bytes = $4,
          line_count = $5,
          char_count = $6,
          last_modified = NOW(),
          updated_at = NOW()
        WHERE file_path = $7 AND project_path = $8
        RETURNING id`, [
                content,
                metadata.contentHash,
                embeddingStr,
                metadata.size,
                lineCount,
                content.length,
                metadata.relativePath,
                projectPath
            ]);
            if (updateResult.rows.length > 0) {
                logger.debug({
                    path: metadata.relativePath,
                    id: updateResult.rows[0].id
                }, 'updated codebase_files entry');
                return;
            }
            // File not in codebase_files yet - INSERT it
            // This can happen if file was added via watcher but codebase wasn't initially indexed
            const ext = metadata.extension.toLowerCase();
            const languageId = ext || 'unknown';
            const languageName = ext ? ext.charAt(0).toUpperCase() + ext.slice(1) : 'Unknown';
            const languageType = this.getLanguageType(ext);
            await this.config.pool.queryWithSwag(`INSERT INTO codebase_files (
          file_path, absolute_path, file_name, extension,
          language_id, language_name, language_type,
          content, content_hash, size_bytes, line_count, char_count,
          last_modified, embedding, project_path
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14
        )
        ON CONFLICT (file_path, project_path) DO UPDATE SET
          content = EXCLUDED.content,
          content_hash = EXCLUDED.content_hash,
          embedding = EXCLUDED.embedding,
          size_bytes = EXCLUDED.size_bytes,
          line_count = EXCLUDED.line_count,
          char_count = EXCLUDED.char_count,
          last_modified = NOW(),
          updated_at = NOW()`, [
                metadata.relativePath,
                absolutePath,
                metadata.filename,
                metadata.extension,
                languageId,
                languageName,
                languageType,
                content,
                metadata.contentHash,
                metadata.size,
                lineCount,
                content.length,
                embeddingStr,
                projectPath
            ]);
            logger.debug({
                path: metadata.relativePath,
                projectPath
            }, 'inserted new codebase_files entry');
        }
        catch (error) {
            logger.error({
                error,
                path: metadata.relativePath
            }, 'failed to update codebase_files - memories table was updated, code search may be stale');
        }
    }
    /**
     * getLanguageType - maps extension to language type category
     */
    getLanguageType(ext) {
        const typeMap = {
            ts: 'programming',
            js: 'programming',
            py: 'programming',
            go: 'programming',
            rs: 'programming',
            java: 'programming',
            cpp: 'programming',
            c: 'programming',
            cs: 'programming',
            rb: 'programming',
            php: 'programming',
            swift: 'programming',
            kt: 'programming',
            md: 'markup',
            html: 'markup',
            xml: 'markup',
            json: 'data',
            yaml: 'data',
            yml: 'data',
            toml: 'data',
            css: 'style',
            scss: 'style',
            less: 'style',
            sql: 'query',
            sh: 'script',
            bash: 'script',
            zsh: 'script'
        };
        return typeMap[ext] || 'unknown';
    }
    /**
     * getStats - returns handler statistics
     */
    getStats() {
        return { ...this.stats };
    }
    /**
     * resetStats - resets statistics
     */
    resetStats() {
        this.stats = {
            filesIngested: 0,
            filesUpdated: 0,
            filesDeleted: 0,
            filesRenamed: 0,
            filesSkipped: 0,
            errors: 0,
            totalBytesProcessed: 0,
            lastUpdateTime: null
        };
    }
}
//# sourceMappingURL=changeHandler.js.map