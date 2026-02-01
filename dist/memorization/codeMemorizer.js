/**
 * codeMemorizer.ts - Main Auto-Memorization System for Claude's Code
 *
 * yooo this is THE BRAIN that remembers everything Claude writes
 * no more massive explores - Claude will KNOW what it wrote and WHY
 *
 * fr fr when Claude writes code, this system:
 * 1. Captures the code that was written
 * 2. Stores it with rich metadata
 * 3. Tracks WHY it was written
 * 4. Links to related files
 * 5. Makes it all searchable
 */
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { getLanguageDetector } from '../codebase/languageDetection.js';
/**
 * CodeMemorizer - THE BRAIN that remembers Claude's code
 *
 * nah bruh Claude never forgets what it wrote now
 * this is the core system for auto-memorization
 */
export class CodeMemorizer {
    pool;
    embeddingProvider;
    // stats tracking - gotta know how much Claude remembers
    stats = {
        codesMemorized: 0,
        totalCharacters: 0,
        uniqueFiles: new Set(),
        operationCounts: {
            write: 0,
            edit: 0,
            notebook_edit: 0,
            create: 0,
            update: 0,
            delete: 0
        },
        errors: 0,
        lastMemorizedAt: null
    };
    constructor(pool, embeddingProvider) {
        this.pool = pool;
        this.embeddingProvider = embeddingProvider;
    }
    /**
     * rememberWhatIJustWrote - THE MAIN METHOD
     *
     * yooo Claude just wrote some fire code lets memorize it
     * this is what gets called after Claude uses Write, Edit, or NotebookEdit
     */
    async rememberWhatIJustWrote(params) {
        const startTime = Date.now();
        const id = uuidv4();
        logger.info({
            filePath: params.filePath,
            codeLength: params.codeWritten.length,
            purpose: params.purpose.slice(0, 100)
        }, 'memorizing code that Claude just wrote');
        try {
            // extract filename from path
            const fileName = params.filePath.split('/').pop() || params.filePath;
            // detect programming language
            const languageDetector = getLanguageDetector();
            const languageInfo = languageDetector.detect(params.filePath);
            const language = languageInfo?.id || 'unknown';
            // determine operation type
            const operationType = params.operationType || 'write';
            // get version number for this file
            const version = await this.getNextVersion(params.filePath);
            // generate embedding for semantic search
            // this is the SECRET SAUCE for finding code later
            const embeddingText = `${params.purpose}\n\n${params.codeWritten}`;
            const embedding = await this.cookTheEmbeddings(embeddingText);
            // prepare tags
            const tags = [
                ...(params.tags || []),
                'claude-written',
                'auto-memorized',
                `lang:${language}`,
                `op:${operationType}`
            ];
            // prepare metadata
            const metadata = {
                ...params.metadata,
                memorizedAt: new Date().toISOString(),
                codeLength: params.codeWritten.length,
                languageInfo,
                source: 'code-memorizer'
            };
            // YEET IT INTO THE DATABASE
            await this.yeetCodeIntoDb({
                id,
                filePath: params.filePath,
                fileName,
                codeContent: params.codeWritten,
                purpose: params.purpose,
                conversationContext: params.conversationContext,
                operationType,
                language,
                relatedFiles: params.relatedFiles || [],
                parentCodeId: params.parentCodeId,
                tags,
                metadata,
                embedding,
                version
            });
            // update stats
            this.stats.codesMemorized++;
            this.stats.totalCharacters += params.codeWritten.length;
            this.stats.uniqueFiles.add(params.filePath);
            this.stats.operationCounts[operationType]++;
            this.stats.lastMemorizedAt = new Date();
            const duration = Date.now() - startTime;
            logger.info({
                codeId: id,
                filePath: params.filePath,
                version,
                duration
            }, 'code memorized successfully - Claude will remember this');
            return {
                success: true,
                codeId: id,
                version,
                message: `memorized code at ${params.filePath} (v${version}) - took ${duration}ms`
            };
        }
        catch (error) {
            this.stats.errors++;
            logger.error({ error, params }, 'failed to memorize code - this is NOT it');
            return {
                success: false,
                message: error instanceof Error ? error.message : 'memorization failed for unknown reason'
            };
        }
    }
    /**
     * yeetCodeIntoDb - insert the code into database
     *
     * fr fr this is where the magic happens
     */
    async yeetCodeIntoDb(params) {
        const client = await this.pool.connect();
        try {
            await client.query(`INSERT INTO claude_code_history (
          id, file_path, file_name, code_content, purpose,
          conversation_context, operation_type, language,
          related_files, parent_code_id, tags, metadata,
          embedding, version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`, [
                params.id,
                params.filePath,
                params.fileName,
                params.codeContent,
                params.purpose,
                params.conversationContext || null,
                params.operationType,
                params.language,
                params.relatedFiles,
                params.parentCodeId || null,
                params.tags,
                params.metadata,
                params.embedding && params.embedding.length > 0
                    ? `[${params.embedding.join(',')}]`
                    : null,
                params.version
            ]);
        }
        finally {
            client.release();
        }
    }
    /**
     * getNextVersion - get the next version number for a file
     *
     * tracking versions so we can see code evolution
     */
    async getNextVersion(filePath) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`SELECT MAX(version) as max_version
         FROM claude_code_history
         WHERE file_path = $1`, [filePath]);
            const currentMax = result.rows[0]?.max_version ?? 0;
            return currentMax + 1;
        }
        finally {
            client.release();
        }
    }
    /**
     * cookTheEmbeddings - generate embeddings for semantic search
     *
     * this is where we turn code + purpose into searchable vectors
     */
    async cookTheEmbeddings(text) {
        try {
            return await this.embeddingProvider.generateEmbedding(text);
        }
        catch (error) {
            logger.warn({ error }, 'embedding generation failed - storing without vector');
            return [];
        }
    }
    /**
     * getCodeByFilePath - get all code entries for a file
     *
     * lets see what Claude wrote for this file
     */
    async getCodeByFilePath(filePath, options = {}) {
        const client = await this.pool.connect();
        try {
            let query = `
        SELECT
          id, file_path, file_name, code_content, code_hash,
          purpose, conversation_context, operation_type, language,
          related_files, related_memory_ids, parent_code_id,
          tags, metadata, embedding, created_at, updated_at, version
        FROM claude_code_history
        WHERE file_path = $1
      `;
            if (!options.includeAllVersions) {
                query += ` AND version = (
          SELECT MAX(version)
          FROM claude_code_history
          WHERE file_path = $1
        )`;
            }
            query += ` ORDER BY version DESC LIMIT $2`;
            const result = await client.query(query, [
                filePath,
                options.limit || 10
            ]);
            return result.rows.map(this.mapRowToEntry);
        }
        finally {
            client.release();
        }
    }
    /**
     * getRecentCode - get recently memorized code
     *
     * fr fr what did Claude write recently?
     */
    async getRecentCode(options = {}) {
        const client = await this.pool.connect();
        try {
            let query = `
        SELECT
          id, file_path, file_name, code_content, code_hash,
          purpose, conversation_context, operation_type, language,
          related_files, related_memory_ids, parent_code_id,
          tags, metadata, embedding, created_at, updated_at, version
        FROM claude_code_history
        WHERE 1=1
      `;
            const params = [];
            let paramIndex = 1;
            if (options.operationType) {
                query += ` AND operation_type = $${paramIndex++}`;
                params.push(options.operationType);
            }
            if (options.language) {
                query += ` AND language = $${paramIndex++}`;
                params.push(options.language);
            }
            query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
            params.push(options.limit || 20);
            const result = await client.query(query, params);
            return result.rows.map(this.mapRowToEntry);
        }
        finally {
            client.release();
        }
    }
    /**
     * getCodeHistory - get version history for a file
     *
     * see how Claude's code evolved over time
     */
    async getCodeHistory(filePath) {
        return this.getCodeByFilePath(filePath, {
            includeAllVersions: true,
            limit: 100
        });
    }
    /**
     * mapRowToEntry - convert database row to typed entry
     */
    mapRowToEntry(row) {
        return {
            id: row.id,
            filePath: row.file_path,
            fileName: row.file_name,
            codeContent: row.code_content,
            codeHash: row.code_hash,
            purpose: row.purpose,
            conversationContext: row.conversation_context ?? undefined,
            operationType: row.operation_type,
            language: row.language,
            relatedFiles: row.related_files || [],
            relatedMemoryIds: row.related_memory_ids || [],
            parentCodeId: row.parent_code_id ?? undefined,
            tags: row.tags || [],
            metadata: row.metadata || {},
            embedding: row.embedding ?? undefined,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            version: row.version
        };
    }
    /**
     * getStats - return memorization statistics
     *
     * how much does Claude remember?
     */
    getStats() {
        return {
            ...this.stats,
            uniqueFilesCount: this.stats.uniqueFiles.size
        };
    }
    /**
     * linkToMemory - link code to a regular memory
     *
     * connecting code to memories for cross-referencing
     */
    async linkToMemory(codeId, memoryId) {
        const client = await this.pool.connect();
        try {
            await client.query(`UPDATE claude_code_history
         SET related_memory_ids = array_append(related_memory_ids, $2)
         WHERE id = $1
           AND NOT ($2 = ANY(related_memory_ids))`, [codeId, memoryId]);
        }
        finally {
            client.release();
        }
    }
}
/**
 * Export singleton creator
 */
let _memorizer = null;
export function getCodeMemorizer(pool, embeddingProvider) {
    if (!_memorizer && pool && embeddingProvider) {
        _memorizer = new CodeMemorizer(pool, embeddingProvider);
    }
    if (!_memorizer) {
        throw new Error('CodeMemorizer not initialized - provide pool and embedding provider');
    }
    return _memorizer;
}
export function resetCodeMemorizer() {
    _memorizer = null;
}
//# sourceMappingURL=codeMemorizer.js.map