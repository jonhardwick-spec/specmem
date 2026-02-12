/**
 * codeRecall.ts - Recall AI-Generated Code from Memory
 *
 * nah bruh no more massive explores needed fr
 * the system can now recall exactly what was written and WHY
 *
 * Features:
 * - Semantic search for stored code
 * - Search by purpose, file path, language
 * - Get full version history
 * - Find related code automatically
 */
import { logger } from '../utils/logger.js';
/**
 * CodeRecall - THE BRAIN for remembering what was written
 *
 * fr fr never need massive explores again
 * semantic search + filtering = finding code FAST
 */
export class CodeRecall {
    pool;
    embeddingProvider;
    // stats
    stats = {
        searches: 0,
        recalls: 0,
        cacheHits: 0,
        cacheMisses: 0
    };
    constructor(pool, embeddingProvider) {
        this.pool = pool;
        this.embeddingProvider = embeddingProvider;
    }
    /**
     * whatDidIWriteFor - THE MAIN SEARCH METHOD
     *
     * nah bruh no more explores needed fr
     * semantic search for stored code
     */
    async whatDidIWriteFor(query, options = {}) {
        this.stats.searches++;
        const startTime = Date.now();
        logger.info({
            query: query.slice(0, 100),
            options
        }, 'searching for stored code');
        const client = await this.pool.connect();
        try {
            // generate embedding for semantic search
            const queryEmbedding = await this.embeddingProvider.generateEmbedding(query);
            // build the search query
            let sql = `
        SELECT
          id, file_path, file_name, code_content, code_hash,
          purpose, conversation_context, operation_type, language,
          related_files, related_memory_ids, parent_code_id,
          tags, metadata, embedding, created_at, updated_at, version,
          1 - (embedding <=> $1::vector) as similarity
        FROM claude_code_history
        WHERE embedding IS NOT NULL
      `;
            const params = [`[${queryEmbedding.join(',')}]`];
            let paramIndex = 2;
            // add filters
            if (options.operationType) {
                sql += ` AND operation_type = $${paramIndex++}`;
                params.push(options.operationType);
            }
            if (options.language) {
                sql += ` AND language = $${paramIndex++}`;
                params.push(options.language);
            }
            if (options.tags && options.tags.length > 0) {
                sql += ` AND tags && $${paramIndex++}`;
                params.push(options.tags);
            }
            if (options.dateRange?.start) {
                sql += ` AND created_at >= $${paramIndex++}`;
                params.push(options.dateRange.start);
            }
            if (options.dateRange?.end) {
                sql += ` AND created_at <= $${paramIndex++}`;
                params.push(options.dateRange.end);
            }
            // latest version only filter
            if (options.latestVersionOnly) {
                sql += `
          AND version = (
            SELECT MAX(version)
            FROM claude_code_history ch2
            WHERE ch2.file_path = claude_code_history.file_path
          )
        `;
            }
            // similarity threshold
            const threshold = options.threshold ?? 0.5;
            sql += ` AND 1 - (embedding <=> $1::vector) >= ${threshold}`;
            // order and limit
            sql += ` ORDER BY similarity DESC LIMIT $${paramIndex}`;
            params.push(options.limit ?? 10);
            const result = await client.query(sql, params);
            const searchResults = result.rows.map((row) => ({
                code: this.mapRowToEntry(row),
                similarity: row.similarity ?? 0,
                highlights: this.extractHighlights(row.code_content, query)
            }));
            const duration = Date.now() - startTime;
            logger.info({
                query: query.slice(0, 50),
                resultCount: searchResults.length,
                duration
            }, 'code search complete');
            return searchResults;
        }
        finally {
            client.release();
        }
    }
    /**
     * allTheCodeIWrote - list all code  wrote
     *
     * skids cant find this code but  can lmao
     */
    async allTheCodeIWrote(options = {}) {
        this.stats.recalls++;
        const client = await this.pool.connect();
        try {
            let sql = `
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
                sql += ` AND operation_type = $${paramIndex++}`;
                params.push(options.operationType);
            }
            if (options.language) {
                sql += ` AND language = $${paramIndex++}`;
                params.push(options.language);
            }
            const orderBy = options.orderBy || 'created';
            const orderColumn = {
                created: 'created_at',
                updated: 'updated_at',
                file_path: 'file_path',
                version: 'version'
            }[orderBy];
            const orderDirection = options.orderDirection || 'desc';
            sql += ` ORDER BY ${orderColumn} ${orderDirection.toUpperCase()}`;
            sql += ` LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
            params.push(options.limit ?? 50, options.offset ?? 0);
            const result = await client.query(sql, params);
            return result.rows.map(this.mapRowToEntry);
        }
        finally {
            client.release();
        }
    }
    /**
     * whyDidIWriteThis - get the context for why code was written
     *
     * fr fr helps  understand its own decisions
     */
    async whyDidIWriteThis(codeId) {
        const client = await this.pool.connect();
        try {
            // get the main code entry
            const mainResult = await client.query(`SELECT
          id, file_path, file_name, code_content, code_hash,
          purpose, conversation_context, operation_type, language,
          related_files, related_memory_ids, parent_code_id,
          tags, metadata, embedding, created_at, updated_at, version
        FROM claude_code_history
        WHERE id = $1`, [codeId]);
            if (mainResult.rows.length === 0 || !mainResult.rows[0]) {
                return null;
            }
            const code = this.mapRowToEntry(mainResult.rows[0]);
            // get related code by file paths
            const relatedResult = await client.query(`SELECT
          id, file_path, file_name, code_content, code_hash,
          purpose, conversation_context, operation_type, language,
          related_files, related_memory_ids, parent_code_id,
          tags, metadata, embedding, created_at, updated_at, version
        FROM claude_code_history
        WHERE file_path = ANY($1)
          AND id != $2
        ORDER BY created_at DESC
        LIMIT 10`, [code.relatedFiles, codeId]);
            // get previous versions
            const versionsResult = await client.query(`SELECT
          id, file_path, file_name, code_content, code_hash,
          purpose, conversation_context, operation_type, language,
          related_files, related_memory_ids, parent_code_id,
          tags, metadata, embedding, created_at, updated_at, version
        FROM claude_code_history
        WHERE file_path = $1
          AND version < $2
        ORDER BY version DESC
        LIMIT 5`, [code.filePath, code.version]);
            return {
                code,
                purpose: code.purpose,
                context: code.conversationContext,
                relatedCode: relatedResult.rows.map(this.mapRowToEntry),
                previousVersions: versionsResult.rows.map(this.mapRowToEntry)
            };
        }
        finally {
            client.release();
        }
    }
    /**
     * getCodeHistory - get full version history for a file
     *
     * see how 's code evolved over time
     */
    async getCodeHistory(filePath) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`SELECT
          id, file_path, file_name, code_content, code_hash,
          purpose, conversation_context, operation_type, language,
          related_files, related_memory_ids, parent_code_id,
          tags, metadata, embedding, created_at, updated_at, version,
          LAG(id) OVER (ORDER BY version) as prev_version,
          LEAD(id) OVER (ORDER BY version) as next_version
        FROM claude_code_history
        WHERE file_path = $1
        ORDER BY version ASC`, [filePath]);
            return result.rows.map((row) => ({
                code: this.mapRowToEntry(row),
                prevVersion: row.prev_version ?? undefined,
                nextVersion: row.next_version ?? undefined
            }));
        }
        finally {
            client.release();
        }
    }
    /**
     * searchByFilePath - search by file path pattern
     *
     * find code by file path without semantic search
     */
    async searchByFilePath(pathPattern, options = {}) {
        const client = await this.pool.connect();
        try {
            let sql = `
        SELECT
          id, file_path, file_name, code_content, code_hash,
          purpose, conversation_context, operation_type, language,
          related_files, related_memory_ids, parent_code_id,
          tags, metadata, embedding, created_at, updated_at, version
        FROM claude_code_history
        WHERE file_path ILIKE $1
      `;
            if (options.latestOnly) {
                sql += `
          AND version = (
            SELECT MAX(version)
            FROM claude_code_history ch2
            WHERE ch2.file_path = claude_code_history.file_path
          )
        `;
            }
            sql += ` ORDER BY created_at DESC LIMIT $2`;
            const result = await client.query(sql, [
                `%${pathPattern}%`,
                options.limit ?? 20
            ]);
            return result.rows.map(this.mapRowToEntry);
        }
        finally {
            client.release();
        }
    }
    /**
     * searchByPurpose - text search on purpose field
     *
     * find code by what it was meant to do
     */
    async searchByPurpose(purposeQuery, options = {}) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`SELECT
          id, file_path, file_name, code_content, code_hash,
          purpose, conversation_context, operation_type, language,
          related_files, related_memory_ids, parent_code_id,
          tags, metadata, embedding, created_at, updated_at, version,
          ts_rank(content_tsv, plainto_tsquery('english', $1)) as rank
        FROM claude_code_history
        WHERE content_tsv @@ plainto_tsquery('english', $1)
        ORDER BY rank DESC
        LIMIT $2`, [purposeQuery, options.limit ?? 20]);
            return result.rows.map(this.mapRowToEntry);
        }
        finally {
            client.release();
        }
    }
    /**
     * findRelatedCode - find code related to a specific entry
     *
     * what else did  write around the same time?
     */
    async findRelatedCode(codeId, options = {}) {
        const client = await this.pool.connect();
        try {
            const refResult = await client.query(`SELECT created_at, file_path, related_files, embedding
         FROM claude_code_history
         WHERE id = $1`, [codeId]);
            if (refResult.rows.length === 0) {
                return [];
            }
            const ref = refResult.rows[0];
            if (!ref) {
                return [];
            }
            const windowMs = (options.windowMinutes ?? 30) * 60 * 1000;
            // find related by:
            // 1. Explicitly linked files
            // 2. Created within time window
            // 3. Semantic similarity (if embedding exists)
            let sql = `
        SELECT
          id, file_path, file_name, code_content, code_hash,
          purpose, conversation_context, operation_type, language,
          related_files, related_memory_ids, parent_code_id,
          tags, metadata, embedding, created_at, updated_at, version
        FROM claude_code_history
        WHERE id != $1
          AND (
            file_path = ANY($2)
            OR (
              created_at BETWEEN $3 - interval '${windowMs} milliseconds'
                AND $3 + interval '${windowMs} milliseconds'
            )
      `;
            const params = [codeId, ref.related_files || [], ref.created_at];
            // add semantic similarity if we have an embedding
            if (ref.embedding) {
                sql += ` OR (
          embedding IS NOT NULL
          AND 1 - (embedding <=> $4::vector) > 0.7
        )`;
                params.push(`[${ref.embedding.join(',')}]`);
            }
            sql += `)
        ORDER BY created_at DESC
        LIMIT $${params.length + 1}
      `;
            params.push(options.limit ?? 10);
            const result = await client.query(sql, params);
            return result.rows.map(this.mapRowToEntry);
        }
        finally {
            client.release();
        }
    }
    /**
     * getCodeStats - get statistics about 's code
     */
    async getCodeStats() {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
        SELECT
          COUNT(*) as total_entries,
          COUNT(DISTINCT file_path) as unique_files,
          SUM(length(code_content)) as total_characters,
          AVG(length(code_content))::INTEGER as avg_code_length,
          MIN(created_at) as oldest_code,
          MAX(created_at) as newest_code
        FROM claude_code_history
      `);
            const opResult = await client.query(`
        SELECT operation_type, COUNT(*) as count
        FROM claude_code_history
        GROUP BY operation_type
      `);
            const langResult = await client.query(`
        SELECT language, COUNT(*) as count
        FROM claude_code_history
        GROUP BY language
        ORDER BY count DESC
        LIMIT 20
      `);
            const row = result.rows[0];
            if (!row) {
                return {
                    totalEntries: 0,
                    uniqueFiles: 0,
                    byOperation: {},
                    byLanguage: {},
                    totalCharacters: 0,
                    avgCodeLength: 0,
                    oldestCode: null,
                    newestCode: null
                };
            }
            const byOperation = {};
            for (const opRow of opResult.rows) {
                byOperation[opRow.operation_type] = parseInt(opRow.count);
            }
            const byLanguage = {};
            for (const langRow of langResult.rows) {
                byLanguage[langRow.language] = parseInt(langRow.count);
            }
            return {
                totalEntries: parseInt(row.total_entries),
                uniqueFiles: parseInt(row.unique_files),
                byOperation: byOperation,
                byLanguage,
                totalCharacters: parseInt(row.total_characters ?? '0') || 0,
                avgCodeLength: parseInt(row.avg_code_length ?? '0') || 0,
                oldestCode: row.oldest_code ? new Date(row.oldest_code) : null,
                newestCode: row.newest_code ? new Date(row.newest_code) : null
            };
        }
        finally {
            client.release();
        }
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
     * extractHighlights - extract matching snippets from code
     */
    extractHighlights(code, query) {
        const highlights = [];
        const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const lines = code.split('\n');
        for (const line of lines) {
            const lowerLine = line.toLowerCase();
            for (const word of queryWords) {
                if (lowerLine.includes(word)) {
                    highlights.push(line.trim().slice(0, 100));
                    break;
                }
            }
            if (highlights.length >= 3)
                break;
        }
        return highlights;
    }
    /**
     * getStats - get recall statistics
     */
    getStats() {
        return { ...this.stats };
    }
}
/**
 * Export singleton creator
 */
let _recall = null;
export function getCodeRecall(pool, embeddingProvider) {
    if (!_recall && pool && embeddingProvider) {
        _recall = new CodeRecall(pool, embeddingProvider);
    }
    if (!_recall) {
        throw new Error('CodeRecall not initialized');
    }
    return _recall;
}
export function resetCodeRecall() {
    _recall = null;
}
//# sourceMappingURL=codeRecall.js.map