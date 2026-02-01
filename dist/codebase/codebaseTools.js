// yooo these are the MCP tools for codebase operations
// findCodeThatMatters, codebaseStatsGoCrazy, and more
// claude gonna be able to search our entire codebase now fr fr
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { IngestThisWholeAssMfCodebase } from './ingestion.js';
import { DEFAULT_EXCLUSIONS } from './exclusions.js';
import { LANGUAGE_REGISTRY } from './languageDetection.js';
import { getDimensionService } from '../services/DimensionService.js';
import { compactResponse } from '../services/ResponseCompactor.js';
import { getProjectContext } from '../services/ProjectContext.js';
import { TEXT_LIMITS } from '../constants.js';
/**
 * Input schemas for all the codebase tools
 */
export const IngestCodebaseInput = z.object({
    rootPath: z.string().describe('absolute path to the codebase root directory'),
    additionalExclusions: z.array(z.string()).optional().describe('extra patterns to exclude'),
    maxFileSizeBytes: z.number().optional().describe('skip files larger than this (default 10MB)'),
    generateEmbeddings: z.boolean().default(true).describe('whether to generate embeddings'),
    includeHiddenFiles: z.boolean().default(false).describe('include hidden files/folders')
});
export const FindInCodebaseInput = z.object({
    query: z.string().min(1).describe('semantic search query'),
    limit: z.number().int().min(1).max(100).default(20).describe('max results'),
    threshold: z.number().min(0).max(1).default(0.6).describe('similarity threshold'),
    languageFilter: z.array(z.string()).optional().describe('filter by language IDs'),
    pathPattern: z.string().optional().describe('glob pattern for file path'),
    excludeChunks: z.boolean().default(false).describe('only return full files, not chunks')
});
export const GetFileContentInput = z.object({
    id: z.string().uuid().optional().describe('file ID'),
    filePath: z.string().optional().describe('relative file path'),
    includeEmbedding: z.boolean().default(false).describe('include the embedding vector')
}).refine(data => data.id || data.filePath, { message: 'must provide either id or filePath' });
export const ListFilesInput = z.object({
    pathPattern: z.string().optional().describe('glob pattern for file path'),
    languageFilter: z.array(z.string()).optional().describe('filter by language IDs'),
    limit: z.number().int().min(1).max(1000).default(100).describe('max results'),
    offset: z.number().int().min(0).default(0).describe('pagination offset'),
    orderBy: z.enum(['path', 'size', 'lines', 'modified']).default('path').describe('sort field'),
    orderDirection: z.enum(['asc', 'desc']).default('asc').describe('sort direction')
});
export const CodebaseStatsInput = z.object({
    includeLanguageBreakdown: z.boolean().default(true),
    includeTopFiles: z.boolean().default(false),
    topFilesLimit: z.number().int().min(1).max(50).default(10)
});
export const FindRelatedFilesInput = z.object({
    fileId: z.string().uuid().optional().describe('find files related to this file by ID'),
    filePath: z.string().optional().describe('find files related to this path'),
    limit: z.number().int().min(1).max(50).default(10).describe('max related files'),
    threshold: z.number().min(0).max(1).default(0.7).describe('similarity threshold')
}).refine(data => data.fileId || data.filePath, { message: 'must provide either fileId or filePath' });
export const TextSearchInCodebaseInput = z.object({
    query: z.string().min(1).describe('full-text search query'),
    limit: z.number().int().min(1).max(100).default(20).describe('max results'),
    languageFilter: z.array(z.string()).optional().describe('filter by language IDs'),
    caseSensitive: z.boolean().default(false).describe('case-sensitive search')
});
/**
 * IngestCodebaseTool - ingestThisWholeAssMfCodebase
 * scans and stores an entire codebase
 */
export class IngestCodebaseTool {
    pool;
    embeddingProvider;
    name = 'ingest_codebase';
    description = 'Scan and store an entire codebase in memory for semantic search. This ingests ALL files recursively, detects languages, chunks large files, and generates embeddings.';
    inputSchema = {
        type: 'object',
        properties: {
            rootPath: { type: 'string', description: 'Absolute path to codebase root' },
            additionalExclusions: { type: 'array', items: { type: 'string' }, description: 'Extra exclusion patterns' },
            maxFileSizeBytes: { type: 'number', description: 'Skip files larger than this (default 10MB)' },
            generateEmbeddings: { type: 'boolean', description: 'Generate embeddings for semantic search' },
            includeHiddenFiles: { type: 'boolean', description: 'Include hidden files' }
        },
        required: ['rootPath']
    };
    constructor(pool, embeddingProvider) {
        this.pool = pool;
        this.embeddingProvider = embeddingProvider;
    }
    async execute(params) {
        const input = IngestCodebaseInput.parse(params);
        logger.info({ rootPath: input.rootPath }, 'starting codebase ingestion - ingestThisWholeAssMfCodebase activated');
        const engine = new IngestThisWholeAssMfCodebase(this.pool, this.embeddingProvider);
        const result = await engine.ingest({
            rootPath: input.rootPath,
            additionalExclusions: input.additionalExclusions,
            maxFileSizeBytes: input.maxFileSizeBytes,
            generateEmbeddings: input.generateEmbeddings,
            includeHiddenFiles: input.includeHiddenFiles
        });
        return {
            success: result.success,
            message: result.success
                ? `Successfully ingested ${result.storedFiles} files (${result.chunkedFiles} chunked into ${result.totalChunks} pieces) from ${result.rootPath}`
                : `Ingestion failed with ${result.errors.length} errors`,
            stats: {
                totalFiles: result.totalFiles,
                storedFiles: result.storedFiles,
                chunkedFiles: result.chunkedFiles,
                totalChunks: result.totalChunks,
                skippedFiles: result.skippedFiles,
                errorFiles: result.errorFiles,
                totalLines: result.totalLines,
                totalBytes: result.totalBytes,
                durationMs: result.duration
            },
            languageBreakdown: result.languageBreakdown,
            errors: result.errors.slice(0, 10) // only return first 10 errors
        };
    }
}
/**
 * FindInCodebaseTool - findCodeThatMatters
 * semantic search across all indexed files
 */
export class FindInCodebaseTool {
    pool;
    embeddingProvider;
    name = 'find_in_codebase';
    description = 'Semantic search across all indexed codebase files. Uses embeddings to find relevant code based on meaning, not just keywords.';
    inputSchema = {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search query describing what you\'re looking for' },
            limit: { type: 'number', description: 'Max results (default 20)' },
            threshold: { type: 'number', description: 'Similarity threshold 0-1 (default 0.6)' },
            languageFilter: { type: 'array', items: { type: 'string' }, description: 'Filter by language IDs' },
            pathPattern: { type: 'string', description: 'Glob pattern for file path' },
            excludeChunks: { type: 'boolean', description: 'Only return full files' }
        },
        required: ['query']
    };
    dimensionService = null;
    constructor(pool, embeddingProvider) {
        this.pool = pool;
        this.embeddingProvider = embeddingProvider;
        try {
            this.dimensionService = getDimensionService(pool, embeddingProvider);
        }
        catch {
            // Will initialize when needed
        }
    }
    getDimService() {
        if (!this.dimensionService) {
            this.dimensionService = getDimensionService(this.pool, this.embeddingProvider);
        }
        return this.dimensionService;
    }
    async execute(params) {
        const input = FindInCodebaseInput.parse(params);
        // generate query embedding
        const rawEmbedding = await this.embeddingProvider.generateEmbedding(input.query);
        // Validate and prepare embedding dimension using DimensionService
        const dimService = this.getDimService();
        const prepared = await dimService.validateAndPrepare('codebase_files', rawEmbedding, input.query);
        const queryEmbedding = prepared.embedding;
        if (prepared.wasModified) {
            logger.debug({ action: prepared.action }, 'Adjusted embedding dimension for codebase search');
        }
        const embeddingStr = `[${queryEmbedding.join(',')}]`;
        // Get project path for filtering
        const projectPath = getProjectContext().getProjectPath();
        // build query with project filter
        const conditions = ['embedding IS NOT NULL', 'project_path = $4'];
        const values = [embeddingStr, 1 - input.threshold, input.limit, projectPath];
        let paramIndex = 5;
        if (input.languageFilter?.length) {
            conditions.push(`language_id = ANY($${paramIndex})`);
            values.push(input.languageFilter);
            paramIndex++;
        }
        if (input.pathPattern) {
            conditions.push(`file_path LIKE $${paramIndex}`);
            values.push(input.pathPattern.replace(/\*/g, '%'));
            paramIndex++;
        }
        if (input.excludeChunks) {
            conditions.push('chunk_index IS NULL');
        }
        const query = `
      SELECT
        id, file_path, file_name, language_id, language_name,
        line_count, size_bytes, chunk_index, total_chunks,
        content,
        1 - (embedding <=> $1::vector) AS similarity
      FROM codebase_files
      WHERE ${conditions.join(' AND ')}
        AND (embedding <=> $1::vector) < $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `;
        const result = await this.pool.queryWithSwag(query, values);
        const searchResults = result.rows.map((row) => ({
            file: {
                id: row.id,
                filePath: row.file_path,
                fileName: row.file_name,
                language: row.language_name,
                lineCount: row.line_count,
                sizeBytes: row.size_bytes,
                isChunk: row.chunk_index !== null,
                chunkIndex: row.chunk_index ?? undefined,
                totalChunks: row.total_chunks ?? undefined
            },
            similarity: row.similarity,
            contentPreview: row.content.slice(0, TEXT_LIMITS.PREVIEW_MEDIUM) + (row.content.length > TEXT_LIMITS.PREVIEW_MEDIUM ? '...' : '')
        }));
        logger.info({
            query: input.query,
            resultCount: searchResults.length,
            topSimilarity: searchResults[0]?.similarity
        }, 'findCodeThatMatters search complete');
        // Apply Chinese compactor for token efficiency
        return compactResponse({
            query: input.query,
            resultCount: searchResults.length,
            results: searchResults
        }, 'search');
    }
}
/**
 * GetFileContentTool - retrieve specific file content
 */
export class GetFileContentTool {
    pool;
    name = 'get_file_content';
    description = 'Retrieve the full content of a specific file from the indexed codebase.';
    inputSchema = {
        type: 'object',
        properties: {
            id: { type: 'string', description: 'File ID (UUID)' },
            filePath: { type: 'string', description: 'Relative file path' },
            includeEmbedding: { type: 'boolean', description: 'Include embedding vector' }
        }
    };
    constructor(pool) {
        this.pool = pool;
    }
    async execute(params) {
        const input = GetFileContentInput.parse(params);
        // Get project path for filtering
        const projectPath = getProjectContext().getProjectPath();
        let query;
        let values;
        if (input.id) {
            query = `SELECT * FROM codebase_files WHERE id = $1 AND project_path = $2`;
            values = [input.id, projectPath];
        }
        else {
            query = `SELECT * FROM codebase_files WHERE file_path = $1 AND project_path = $2`;
            values = [input.filePath, projectPath];
        }
        const result = await this.pool.queryWithSwag(query, values);
        if (result.rows.length === 0) {
            return {
                found: false,
                message: 'File not found in indexed codebase'
            };
        }
        const row = result.rows[0];
        return {
            found: true,
            file: {
                id: row.id,
                filePath: row.file_path,
                absolutePath: row.absolute_path,
                fileName: row.file_name,
                extension: row.extension,
                language: {
                    id: row.language_id,
                    name: row.language_name,
                    type: row.language_type
                },
                sizeBytes: row.size_bytes,
                lineCount: row.line_count,
                charCount: row.char_count,
                lastModified: row.last_modified,
                isChunk: row.chunk_index !== null,
                chunkIndex: row.chunk_index,
                totalChunks: row.total_chunks,
                originalFileId: row.original_file_id
            },
            content: row.content,
            contentHash: row.content_hash,
            embedding: input.includeEmbedding && row.embedding
                ? row.embedding.replace(/[\[\]]/g, '').split(',').map(Number)
                : undefined
        };
    }
}
/**
 * ListFilesTool - list indexed files with filtering
 */
export class ListFilesTool {
    pool;
    name = 'list_files';
    description = 'List all indexed files with optional filtering and pagination.';
    inputSchema = {
        type: 'object',
        properties: {
            pathPattern: { type: 'string', description: 'Glob pattern for file path (e.g., "src/**/*.ts")' },
            languageFilter: { type: 'array', items: { type: 'string' }, description: 'Filter by language IDs' },
            limit: { type: 'number', description: 'Max results (default 100)' },
            offset: { type: 'number', description: 'Pagination offset' },
            orderBy: { type: 'string', enum: ['path', 'size', 'lines', 'modified'], description: 'Sort field' },
            orderDirection: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' }
        }
    };
    constructor(pool) {
        this.pool = pool;
    }
    async execute(params) {
        const input = ListFilesInput.parse(params);
        // Get project path for filtering
        const projectPath = getProjectContext().getProjectPath();
        const conditions = ['chunk_index IS NULL', 'project_path = $1']; // only list main files, not chunks, scoped by project
        const values = [projectPath];
        let paramIndex = 2;
        if (input.pathPattern) {
            conditions.push(`file_path LIKE $${paramIndex}`);
            values.push(input.pathPattern.replace(/\*\*/g, '%').replace(/\*/g, '%'));
            paramIndex++;
        }
        if (input.languageFilter?.length) {
            conditions.push(`language_id = ANY($${paramIndex})`);
            values.push(input.languageFilter);
            paramIndex++;
        }
        const orderColumn = {
            path: 'file_path',
            size: 'size_bytes',
            lines: 'line_count',
            modified: 'last_modified'
        }[input.orderBy];
        // get total count
        const countResult = await this.pool.queryWithSwag(`SELECT COUNT(*) as count FROM codebase_files WHERE ${conditions.join(' AND ')}`, values);
        const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
        // get page
        values.push(input.limit, input.offset);
        const query = `
      SELECT id, file_path, file_name, language_id, language_name,
             size_bytes, line_count, last_modified
      FROM codebase_files
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderColumn} ${input.orderDirection.toUpperCase()}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
        const result = await this.pool.queryWithSwag(query, values);
        return {
            total,
            limit: input.limit,
            offset: input.offset,
            hasMore: input.offset + result.rows.length < total,
            files: result.rows.map((row) => ({
                id: row.id,
                filePath: row.file_path,
                fileName: row.file_name,
                language: row.language_name,
                sizeBytes: row.size_bytes,
                lineCount: row.line_count,
                lastModified: row.last_modified
            }))
        };
    }
}
/**
 * CodebaseStatsTool - codebaseStatsGoCrazy
 * comprehensive statistics about the indexed codebase
 */
export class CodebaseStatsTool {
    pool;
    name = 'codebase_stats';
    description = 'Get comprehensive statistics about the indexed codebase including language breakdown, file counts, and more.';
    inputSchema = {
        type: 'object',
        properties: {
            includeLanguageBreakdown: { type: 'boolean', description: 'Include per-language stats' },
            includeTopFiles: { type: 'boolean', description: 'Include top files by size/lines' },
            topFilesLimit: { type: 'number', description: 'Number of top files to include' }
        }
    };
    constructor(pool) {
        this.pool = pool;
    }
    async execute(params) {
        const input = CodebaseStatsInput.parse(params);
        // Get project path for filtering
        const projectPath = getProjectContext().getProjectPath();
        // basic stats - filtered by project
        const basicStats = await this.pool.queryWithSwag(`
      SELECT
        COUNT(*) as total_files,
        COUNT(*) FILTER (WHERE chunk_index IS NOT NULL) as total_chunks,
        COUNT(*) FILTER (WHERE chunk_index IS NULL) as unique_files,
        SUM(line_count) as total_lines,
        SUM(size_bytes) as total_bytes
      FROM codebase_files
      WHERE project_path = $1
    `, [projectPath]);
        const stats = {
            totalFiles: parseInt(basicStats.rows[0]?.total_files ?? '0', 10),
            totalChunks: parseInt(basicStats.rows[0]?.total_chunks ?? '0', 10),
            uniqueFiles: parseInt(basicStats.rows[0]?.unique_files ?? '0', 10),
            totalLines: parseInt(basicStats.rows[0]?.total_lines ?? '0', 10),
            totalBytes: parseInt(basicStats.rows[0]?.total_bytes ?? '0', 10)
        };
        // language breakdown - filtered by project
        if (input.includeLanguageBreakdown) {
            const langStats = await this.pool.queryWithSwag(`
        SELECT
          language_id,
          COUNT(*) as file_count,
          SUM(line_count) as line_count,
          SUM(size_bytes) as byte_count
        FROM codebase_files
        WHERE chunk_index IS NULL AND project_path = $1
        GROUP BY language_id
        ORDER BY file_count DESC
      `, [projectPath]);
            stats.languageBreakdown = {};
            for (const row of langStats.rows) {
                stats.languageBreakdown[row.language_id] = {
                    fileCount: parseInt(row.file_count, 10),
                    lineCount: parseInt(row.line_count, 10),
                    byteCount: parseInt(row.byte_count, 10)
                };
            }
        }
        // top files - filtered by project
        if (input.includeTopFiles) {
            const topBySize = await this.pool.queryWithSwag(`
        SELECT file_path, size_bytes, language_name
        FROM codebase_files
        WHERE chunk_index IS NULL AND project_path = $1
        ORDER BY size_bytes DESC
        LIMIT $2
      `, [projectPath, input.topFilesLimit]);
            stats.topFilesBySize = topBySize.rows.map((row) => ({
                filePath: row.file_path,
                sizeBytes: row.size_bytes,
                language: row.language_name
            }));
            const topByLines = await this.pool.queryWithSwag(`
        SELECT file_path, line_count, language_name
        FROM codebase_files
        WHERE chunk_index IS NULL AND project_path = $1
        ORDER BY line_count DESC
        LIMIT $2
      `, [projectPath, input.topFilesLimit]);
            stats.topFilesByLines = topByLines.rows.map((row) => ({
                filePath: row.file_path,
                lineCount: row.line_count,
                language: row.language_name
            }));
        }
        // last ingestion time - filtered by project
        const lastMod = await this.pool.queryWithSwag(`
      SELECT MAX(created_at) as last_mod FROM codebase_files WHERE project_path = $1
    `, [projectPath]);
        if (lastMod.rows[0]?.last_mod) {
            stats.lastIngestionTime = lastMod.rows[0].last_mod;
        }
        logger.info({
            uniqueFiles: stats.uniqueFiles,
            totalLines: stats.totalLines
        }, 'codebaseStatsGoCrazy - stats retrieved');
        return stats;
    }
}
/**
 * FindRelatedFilesTool - find files related to a given file
 */
export class FindRelatedFilesTool {
    pool;
    name = 'find_related_files';
    description = 'Find files that are semantically related to a given file based on embeddings.';
    inputSchema = {
        type: 'object',
        properties: {
            fileId: { type: 'string', description: 'File ID to find related files for' },
            filePath: { type: 'string', description: 'File path to find related files for' },
            limit: { type: 'number', description: 'Max related files (default 10)' },
            threshold: { type: 'number', description: 'Similarity threshold (default 0.7)' }
        }
    };
    constructor(pool) {
        this.pool = pool;
    }
    async execute(params) {
        const input = FindRelatedFilesInput.parse(params);
        // Get project path for filtering
        const projectPath = getProjectContext().getProjectPath();
        // first get the source file's embedding - filtered by project
        let sourceQuery;
        let sourceValues;
        if (input.fileId) {
            sourceQuery = `SELECT id, file_path, embedding FROM codebase_files WHERE id = $1 AND project_path = $2`;
            sourceValues = [input.fileId, projectPath];
        }
        else {
            sourceQuery = `SELECT id, file_path, embedding FROM codebase_files WHERE file_path = $1 AND project_path = $2`;
            sourceValues = [input.filePath, projectPath];
        }
        const sourceResult = await this.pool.queryWithSwag(sourceQuery, sourceValues);
        if (sourceResult.rows.length === 0) {
            return {
                found: false,
                message: 'Source file not found in indexed codebase'
            };
        }
        const source = sourceResult.rows[0];
        if (!source.embedding) {
            return {
                found: true,
                hasEmbedding: false,
                message: 'Source file has no embedding, cannot find related files'
            };
        }
        // find related files - filtered by project
        const maxDistance = 1 - input.threshold;
        const relatedResult = await this.pool.queryWithSwag(`
      SELECT
        id, file_path, file_name, language_name, line_count, size_bytes,
        1 - (embedding <=> $1::vector) AS similarity
      FROM codebase_files
      WHERE id != $2
        AND embedding IS NOT NULL
        AND chunk_index IS NULL
        AND project_path = $5
        AND (embedding <=> $1::vector) < $3
      ORDER BY embedding <=> $1::vector
      LIMIT $4
    `, [source.embedding, source.id, maxDistance, input.limit, projectPath]);
        // Apply Chinese compactor for token efficiency
        return compactResponse({
            found: true,
            sourceFile: {
                id: source.id,
                filePath: source.file_path
            },
            relatedCount: relatedResult.rows.length,
            relatedFiles: relatedResult.rows.map((row) => ({
                id: row.id,
                filePath: row.file_path,
                fileName: row.file_name,
                language: row.language_name,
                lineCount: row.line_count,
                sizeBytes: row.size_bytes,
                similarity: row.similarity
            }))
        }, 'search');
    }
}
/**
 * TextSearchInCodebaseTool - full-text search across codebase
 */
export class TextSearchInCodebaseTool {
    pool;
    name = 'text_search_codebase';
    description = 'Full-text search across all indexed files. Finds exact or partial text matches.';
    inputSchema = {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Text to search for' },
            limit: { type: 'number', description: 'Max results (default 20)' },
            languageFilter: { type: 'array', items: { type: 'string' }, description: 'Filter by languages' },
            caseSensitive: { type: 'boolean', description: 'Case-sensitive search' }
        },
        required: ['query']
    };
    constructor(pool) {
        this.pool = pool;
    }
    async execute(params) {
        const input = TextSearchInCodebaseInput.parse(params);
        // Get project path for filtering
        const projectPath = getProjectContext().getProjectPath();
        const conditions = ['project_path = $1'];
        const values = [projectPath];
        let paramIndex = 2;
        // text search condition
        if (input.caseSensitive) {
            conditions.push(`content LIKE $${paramIndex}`);
            values.push(`%${input.query}%`);
        }
        else {
            conditions.push(`content ILIKE $${paramIndex}`);
            values.push(`%${input.query}%`);
        }
        paramIndex++;
        if (input.languageFilter?.length) {
            conditions.push(`language_id = ANY($${paramIndex})`);
            values.push(input.languageFilter);
            paramIndex++;
        }
        values.push(input.limit);
        const query = `
      SELECT
        id, file_path, file_name, language_name,
        line_count, size_bytes, content,
        chunk_index, total_chunks
      FROM codebase_files
      WHERE ${conditions.join(' AND ')}
      ORDER BY size_bytes ASC
      LIMIT $${paramIndex}
    `;
        const result = await this.pool.queryWithSwag(query, values);
        // extract matching lines for each result
        const results = result.rows.map((row) => {
            const lines = row.content.split('\n');
            const matchingLines = [];
            const searchLower = input.caseSensitive ? input.query : input.query.toLowerCase();
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i] ?? '';
                const lineToCheck = input.caseSensitive ? line : line.toLowerCase();
                if (lineToCheck.includes(searchLower)) {
                    matchingLines.push({
                        lineNumber: i + 1,
                        content: line.slice(0, 200) + (line.length > 200 ? '...' : '')
                    });
                    if (matchingLines.length >= 5)
                        break; // limit matches per file
                }
            }
            return {
                file: {
                    id: row.id,
                    filePath: row.file_path,
                    fileName: row.file_name,
                    language: row.language_name,
                    lineCount: row.line_count,
                    sizeBytes: row.size_bytes,
                    isChunk: row.chunk_index !== null,
                    chunkIndex: row.chunk_index,
                    totalChunks: row.total_chunks
                },
                matchCount: matchingLines.length,
                matchingLines
            };
        });
        // Apply Chinese compactor for token efficiency
        return compactResponse({
            query: input.query,
            resultCount: results.length,
            results
        }, 'search');
    }
}
/**
 * GetExclusionPatternsTool - see what patterns are being excluded
 */
export class GetExclusionPatternsTool {
    name = 'get_exclusion_patterns';
    description = 'Get the current exclusion patterns used during codebase ingestion.';
    inputSchema = {
        type: 'object',
        properties: {}
    };
    async execute() {
        return {
            defaultPatterns: DEFAULT_EXCLUSIONS,
            patternCount: DEFAULT_EXCLUSIONS.length,
            description: 'These patterns are automatically excluded during codebase ingestion'
        };
    }
}
/**
 * GetSupportedLanguagesTool - list all supported languages
 */
export class GetSupportedLanguagesTool {
    name = 'get_supported_languages';
    description = 'Get list of all programming languages supported for detection and indexing.';
    inputSchema = {
        type: 'object',
        properties: {
            type: {
                type: 'string',
                enum: ['all', 'programming', 'markup', 'data', 'config', 'prose'],
                description: 'Filter by language type'
            }
        }
    };
    async execute(params) {
        const filterType = params.type;
        let languages = Object.values(LANGUAGE_REGISTRY)
            .filter(l => l.id !== 'unknown');
        if (filterType && filterType !== 'all') {
            languages = languages.filter(l => l.type === filterType);
        }
        return {
            count: languages.length,
            languages: languages.map(l => ({
                id: l.id,
                name: l.name,
                type: l.type,
                extensions: l.extensions,
                supportsEmbeddings: l.supportsEmbeddings
            }))
        };
    }
}
/**
 * GetCodePointersTool - understand how code connects
 *
 * answers questions like:
 * - "what files import this file?"
 * - "what calls this function?"
 * - "where is this class used?"
 *
 * traces through dependencies and definitions to show real connections
 */
export class GetCodePointersTool {
    pool;
    name = 'get_code_pointers';
    description = 'Get code pointers showing what imports, calls, or uses a file or symbol. Traces through the codebase to find all references.';
    inputSchema = {
        type: 'object',
        properties: {
            filePath: { type: 'string', description: 'File path to find references to' },
            symbol: { type: 'string', description: 'Symbol name (function, class, variable) to find usages of' },
            lineNumber: { type: 'number', description: 'Optional line number to narrow down the search' },
            direction: {
                type: 'string',
                enum: ['incoming', 'outgoing', 'both'],
                description: 'incoming = what imports/calls this, outgoing = what this imports/calls'
            },
            includeContent: { type: 'boolean', description: 'Include the actual code at each reference point' }
        }
    };
    constructor(pool) {
        this.pool = pool;
    }
    async execute(params) {
        const direction = params.direction ?? 'both';
        const includeContent = params.includeContent ?? false;
        // Get project path for filtering
        const projectPath = getProjectContext().getProjectPath();
        const results = { incoming: [], outgoing: [], definitions: [] };
        // If we have a file path, find its dependencies
        if (params.filePath) {
            // INCOMING: What imports this file? - filtered by project
            if (direction === 'incoming' || direction === 'both') {
                const incomingQuery = `
          SELECT
            cd.source_file_path,
            cd.import_statement,
            cd.imported_names,
            cd.line_number,
            cf.content
          FROM code_dependencies cd
          LEFT JOIN codebase_files cf ON cf.file_path = cd.source_file_path AND cf.project_path = $2
          WHERE (cd.target_path LIKE $1 OR cd.resolved_path LIKE $1)
            AND cd.project_path = $2
          ORDER BY cd.source_file_path
          LIMIT 50
        `;
                const pattern = '%' + params.filePath.replace(/^.*\//, '') + '%';
                const incomingResult = await this.pool.queryWithSwag(incomingQuery, [pattern, projectPath]);
                for (const row of incomingResult.rows) {
                    results.incoming.push({
                        type: 'import',
                        sourceFile: row.source_file_path,
                        sourceLine: row.line_number,
                        importStatement: row.import_statement,
                        symbol: row.imported_names?.join(', '),
                        context: includeContent && row.content
                            ? this.getContextLines(row.content, row.line_number, 2)
                            : undefined
                    });
                }
            }
            // OUTGOING: What does this file import? - filtered by project
            if (direction === 'outgoing' || direction === 'both') {
                const outgoingQuery = `
          SELECT
            cd.target_path,
            cd.resolved_path,
            cd.import_statement,
            cd.imported_names,
            cd.line_number,
            cd.is_external,
            cd.package_name
          FROM code_dependencies cd
          WHERE cd.source_file_path LIKE $1
            AND cd.project_path = $2
          ORDER BY cd.line_number
          LIMIT 50
        `;
                const outgoingResult = await this.pool.queryWithSwag(outgoingQuery, ['%' + params.filePath + '%', projectPath]);
                for (const row of outgoingResult.rows) {
                    results.outgoing.push({
                        type: row.is_external ? 'external_import' : 'local_import',
                        targetFile: row.resolved_path ?? row.target_path,
                        targetLine: row.line_number,
                        importStatement: row.import_statement,
                        symbol: row.imported_names?.join(', ') || row.package_name
                    });
                }
            }
        }
        // If we have a symbol, find where it's defined and used
        if (params.symbol) {
            // Find definitions - filtered by project
            const defQuery = `
        SELECT
          cd.file_id,
          cd.name,
          cd.definition_type,
          cd.line_number,
          cd.signature,
          cf.file_path,
          cf.content
        FROM code_definitions cd
        JOIN codebase_files cf ON cf.id = cd.file_id
        WHERE cd.name = $1
          AND cd.project_path = $2
        ORDER BY cf.file_path
        LIMIT 20
      `;
            const defResult = await this.pool.queryWithSwag(defQuery, [params.symbol, projectPath]);
            for (const row of defResult.rows) {
                results.definitions.push({
                    file: row.file_path,
                    line: row.line_number,
                    type: row.definition_type,
                    name: row.name,
                    signature: row.signature,
                    content: includeContent && row.content
                        ? this.getContextLines(row.content, row.line_number, 3)
                        : undefined
                });
            }
            // Find usages via text search - filtered by project
            const usageQuery = `
        SELECT
          id, file_path, content
        FROM codebase_files
        WHERE content ILIKE $1
          AND chunk_index IS NULL
          AND project_path = $2
        LIMIT 30
      `;
            const usageResult = await this.pool.queryWithSwag(usageQuery, ['%' + params.symbol + '%', projectPath]);
            for (const row of usageResult.rows) {
                // Find the actual line numbers where symbol appears
                const lines = row.content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i]?.includes(params.symbol)) {
                        // Skip if this is the definition itself
                        const isDefinition = results.definitions.some(d => d.file === row.file_path && d.line === i + 1);
                        if (!isDefinition) {
                            results.incoming.push({
                                type: 'usage',
                                sourceFile: row.file_path,
                                sourceLine: i + 1,
                                symbol: params.symbol,
                                context: includeContent
                                    ? this.getContextLines(row.content, i + 1, 1)
                                    : undefined
                            });
                        }
                        // Limit usages per file
                        if (results.incoming.filter(r => r.sourceFile === row.file_path).length >= 5)
                            break;
                    }
                }
            }
        }
        // Apply Chinese compactor for token efficiency
        return compactResponse({
            query: {
                filePath: params.filePath,
                symbol: params.symbol,
                lineNumber: params.lineNumber,
                direction
            },
            incoming: results.incoming,
            outgoing: results.outgoing,
            definitions: results.definitions,
            summary: {
                incomingCount: results.incoming.length,
                outgoingCount: results.outgoing.length,
                definitionCount: results.definitions.length,
                message: `Found ${results.incoming.length} references pointing IN, ${results.outgoing.length} pointing OUT, ${results.definitions.length} definitions`
            }
        }, 'search');
    }
    getContextLines(content, lineNumber, context) {
        const lines = content.split('\n');
        const start = Math.max(0, lineNumber - context - 1);
        const end = Math.min(lines.length, lineNumber + context);
        return lines.slice(start, end).map((line, i) => {
            const num = start + i + 1;
            const marker = num === lineNumber ? '>' : ' ';
            return `${marker}${num.toString().padStart(4)}: ${line.slice(0, 150)}`;
        }).join('\n');
    }
}
/**
 * GetRecentChangesTool - show recent file changes from history
 */
export class GetRecentChangesTool {
    pool;
    name = 'get_recent_changes';
    description = 'Get recent file changes from the change history. Shows what files were modified, added, or deleted.';
    inputSchema = {
        type: 'object',
        properties: {
            limit: { type: 'number', description: 'Max changes to return (default 20)' },
            filePath: { type: 'string', description: 'Filter to specific file path' },
            changeType: {
                type: 'string',
                enum: ['add', 'modify', 'delete'],
                description: 'Filter by change type'
            },
            since: { type: 'string', description: 'ISO datetime - only show changes since this time' },
            includeContent: { type: 'boolean', description: 'Include before/after content for changes' }
        }
    };
    constructor(pool) {
        this.pool = pool;
    }
    async execute(params) {
        // Get project path for filtering
        const projectPath = getProjectContext().getProjectPath();
        const conditions = ['project_path = $1'];
        const values = [projectPath];
        let paramIndex = 2;
        if (params.filePath) {
            conditions.push(`file_path LIKE $${paramIndex}`);
            values.push('%' + params.filePath + '%');
            paramIndex++;
        }
        if (params.changeType) {
            conditions.push(`change_type = $${paramIndex}`);
            values.push(params.changeType);
            paramIndex++;
        }
        if (params.since) {
            conditions.push(`detected_at > $${paramIndex}`);
            values.push(params.since);
            paramIndex++;
        }
        const limit = params.limit ?? 20;
        values.push(limit);
        const whereClause = 'WHERE ' + conditions.join(' AND ');
        const query = `
      SELECT
        id, file_path, change_type, previous_hash, new_hash,
        size_before, size_after, line_count_before, line_count_after,
        lines_added, lines_removed, detected_at, file_modified_at,
        metadata
        ${params.includeContent ? ', previous_content, new_content' : ''}
      FROM file_change_history
      ${whereClause}
      ORDER BY detected_at DESC
      LIMIT $${paramIndex}
    `;
        const result = await this.pool.queryWithSwag(query, values);
        // Apply Chinese compactor for token efficiency
        return compactResponse({
            changes: result.rows.map((row) => ({
                id: row.id,
                filePath: row.file_path,
                changeType: row.change_type,
                detectedAt: row.detected_at,
                fileModifiedAt: row.file_modified_at,
                sizeDiff: row.size_after - row.size_before,
                linesDiff: row.line_count_after - row.line_count_before,
                linesAdded: row.lines_added,
                linesRemoved: row.lines_removed,
                previousHash: row.previous_hash,
                newHash: row.new_hash,
                metadata: row.metadata,
                previousContent: params.includeContent ? row.previous_content : undefined,
                newContent: params.includeContent ? row.new_content : undefined
            })),
            count: result.rows.length,
            hasMore: result.rows.length === limit
        }, 'search');
    }
}
/**
 * GetFullPointerContextTool - the MEGA context tool
 *
 * gives you EVERYTHING about a file:
 * - full file content
 * - what imports this file (with their code)
 * - what this file imports (with their code)
 * - all definitions in the file
 * - all usages of exported symbols
 * - recent changes
 *
 * this is the "give me full context on this file" tool
 */
export class GetFullPointerContextTool {
    pool;
    name = 'get_full_pointer_context';
    description = 'Get FULL context for a file: its content, all imports/exports, what uses it, what it uses, definitions, and recent changes. This is the mega-context tool.';
    inputSchema = {
        type: 'object',
        properties: {
            filePath: { type: 'string', description: 'File path to get full context for (required)' },
            includeRelatedContent: {
                type: 'boolean',
                description: 'Include actual code content of related files (default true)'
            },
            relatedContentLines: {
                type: 'number',
                description: 'How many context lines to include from related files (default 10)'
            },
            maxRelatedFiles: {
                type: 'number',
                description: 'Max related files to include (default 20)'
            }
        },
        required: ['filePath']
    };
    constructor(pool) {
        this.pool = pool;
    }
    async execute(params) {
        const includeContent = params.includeRelatedContent ?? true;
        const contextLines = params.relatedContentLines ?? 10;
        const maxRelated = params.maxRelatedFiles ?? 20;
        // Get project path for filtering
        const projectPath = getProjectContext().getProjectPath();
        const result = {
            mainFile: null,
            imports: [],
            importedBy: [],
            definitions: [],
            recentChanges: [],
            summary: {
                totalRelatedFiles: 0,
                totalDefinitions: 0,
                totalImports: 0,
                totalImportedBy: 0,
                totalUsages: 0
            }
        };
        // 1. Get the main file content - filtered by project
        const mainFileQuery = `
      SELECT
        id, file_path, content, language_name, line_count, size_bytes
      FROM codebase_files
      WHERE file_path LIKE $1
        AND chunk_index IS NULL
        AND project_path = $2
      LIMIT 1
    `;
        const mainFileResult = await this.pool.queryWithSwag(mainFileQuery, ['%' + params.filePath + '%', projectPath]);
        if (mainFileResult.rows.length === 0) {
            return {
                error: true,
                message: `File not found: ${params.filePath}`,
                suggestion: 'Try a partial path match or use list_files to find the exact path'
            };
        }
        const mainFile = mainFileResult.rows[0];
        result.mainFile = {
            path: mainFile.file_path,
            content: mainFile.content,
            language: mainFile.language_name,
            lineCount: mainFile.line_count,
            sizeBytes: mainFile.size_bytes
        };
        // 2. Get what this file IMPORTS (outgoing dependencies) - filtered by project
        const importsQuery = `
      SELECT
        cd.target_path,
        cd.resolved_path,
        cd.import_statement,
        cd.imported_names,
        cd.line_number,
        cd.is_external,
        cd.package_name,
        cf.content as target_content
      FROM code_dependencies cd
      LEFT JOIN codebase_files cf ON cf.file_path = cd.resolved_path
        AND cf.chunk_index IS NULL AND cf.project_path = $3
      WHERE cd.source_file_path = $1
        AND cd.project_path = $3
      ORDER BY cd.line_number
      LIMIT $2
    `;
        const importsResult = await this.pool.queryWithSwag(importsQuery, [mainFile.file_path, maxRelated, projectPath]);
        for (const row of importsResult.rows) {
            result.imports.push({
                targetPath: row.resolved_path ?? row.target_path,
                importStatement: row.import_statement,
                importedSymbols: row.imported_names ?? [],
                line: row.line_number,
                isExternal: row.is_external ?? false,
                targetContent: includeContent && row.target_content
                    ? this.extractRelevantContent(row.target_content, row.imported_names, contextLines)
                    : undefined
            });
        }
        result.summary.totalImports = result.imports.length;
        // 3. Get what IMPORTS this file (incoming dependencies) - filtered by project
        const importedByQuery = `
      SELECT
        cd.source_file_path,
        cd.import_statement,
        cd.imported_names,
        cd.line_number,
        cf.content as source_content
      FROM code_dependencies cd
      LEFT JOIN codebase_files cf ON cf.file_path = cd.source_file_path
        AND cf.chunk_index IS NULL AND cf.project_path = $3
      WHERE (cd.target_path LIKE $1 OR cd.resolved_path LIKE $1)
        AND cd.project_path = $3
      ORDER BY cd.source_file_path
      LIMIT $2
    `;
        const fileName = mainFile.file_path.split('/').pop() ?? mainFile.file_path;
        const importedByResult = await this.pool.queryWithSwag(importedByQuery, ['%' + fileName + '%', maxRelated, projectPath]);
        for (const row of importedByResult.rows) {
            result.importedBy.push({
                sourcePath: row.source_file_path,
                importStatement: row.import_statement,
                importedSymbols: row.imported_names ?? [],
                line: row.line_number,
                sourceContent: includeContent && row.source_content
                    ? this.getContextLines(row.source_content, row.line_number, contextLines)
                    : undefined
            });
        }
        result.summary.totalImportedBy = result.importedBy.length;
        // 4. Get definitions in this file - filtered by project
        const definitionsQuery = `
      SELECT
        name, definition_type, line_number, signature, is_exported
      FROM code_definitions
      WHERE file_id = $1
        AND project_path = $2
      ORDER BY line_number
    `;
        const definitionsResult = await this.pool.queryWithSwag(definitionsQuery, [mainFile.id, projectPath]);
        let totalUsages = 0;
        for (const def of definitionsResult.rows) {
            const definition = {
                name: def.name,
                type: def.definition_type,
                line: def.line_number,
                signature: def.signature,
                usedBy: []
            };
            // Find usages of this definition (only if exported) - filtered by project
            if (def.is_exported && includeContent) {
                const usageQuery = `
          SELECT file_path, content
          FROM codebase_files
          WHERE content ILIKE $1
            AND file_path != $2
            AND chunk_index IS NULL
            AND project_path = $3
          LIMIT 10
        `;
                const usageResult = await this.pool.queryWithSwag(usageQuery, ['%' + def.name + '%', mainFile.file_path, projectPath]);
                for (const usage of usageResult.rows) {
                    const lines = usage.content.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i]?.includes(def.name)) {
                            definition.usedBy.push({
                                file: usage.file_path,
                                line: i + 1,
                                context: this.getContextLines(usage.content, i + 1, 2)
                            });
                            totalUsages++;
                            if (definition.usedBy.length >= 5)
                                break;
                        }
                    }
                }
            }
            result.definitions.push(definition);
        }
        result.summary.totalDefinitions = result.definitions.length;
        result.summary.totalUsages = totalUsages;
        // 5. Get recent changes to this file - filtered by project
        const changesQuery = `
      SELECT
        change_type, detected_at,
        COALESCE(size_after, 0) - COALESCE(size_before, 0) as size_diff,
        COALESCE(line_count_after, 0) - COALESCE(line_count_before, 0) as lines_diff
      FROM file_change_history
      WHERE file_path = $1
        AND project_path = $2
      ORDER BY detected_at DESC
      LIMIT 5
    `;
        const changesResult = await this.pool.queryWithSwag(changesQuery, [mainFile.file_path, projectPath]);
        result.recentChanges = changesResult.rows.map((row) => ({
            changeType: row.change_type,
            detectedAt: row.detected_at,
            sizeDiff: row.size_diff,
            linesDiff: row.lines_diff
        }));
        // Calculate total related files
        const relatedPaths = new Set();
        result.imports.forEach(i => relatedPaths.add(i.targetPath));
        result.importedBy.forEach(i => relatedPaths.add(i.sourcePath));
        result.definitions.forEach(d => d.usedBy.forEach(u => relatedPaths.add(u.file)));
        result.summary.totalRelatedFiles = relatedPaths.size;
        // Apply Chinese compactor for token efficiency
        return compactResponse(result, 'search');
    }
    getContextLines(content, lineNumber, contextSize) {
        const lines = content.split('\n');
        const start = Math.max(0, lineNumber - contextSize - 1);
        const end = Math.min(lines.length, lineNumber + contextSize);
        return lines.slice(start, end).map((line, i) => {
            const num = start + i + 1;
            const marker = num === lineNumber ? '>' : ' ';
            return `${marker}${num.toString().padStart(4)}: ${line.slice(0, 200)}`;
        }).join('\n');
    }
    extractRelevantContent(content, symbolNames, contextLines) {
        if (!symbolNames?.length) {
            // Return first N lines if no specific symbols
            return content.split('\n').slice(0, contextLines * 2).join('\n');
        }
        // Find and extract content around each symbol
        const lines = content.split('\n');
        const relevantLines = new Set();
        for (const symbol of symbolNames) {
            for (let i = 0; i < lines.length; i++) {
                if (lines[i]?.includes(symbol)) {
                    for (let j = Math.max(0, i - contextLines); j < Math.min(lines.length, i + contextLines + 1); j++) {
                        relevantLines.add(j);
                    }
                }
            }
        }
        if (relevantLines.size === 0) {
            return content.split('\n').slice(0, contextLines * 2).join('\n');
        }
        const sortedLines = Array.from(relevantLines).sort((a, b) => a - b);
        const result = [];
        let lastLine = -2;
        for (const lineNum of sortedLines) {
            if (lineNum > lastLine + 1) {
                if (result.length > 0)
                    result.push('  ...');
            }
            result.push(`${(lineNum + 1).toString().padStart(4)}: ${lines[lineNum]?.slice(0, 200) ?? ''}`);
            lastLine = lineNum;
        }
        return result.join('\n');
    }
}
/**
 * Factory function to create all codebase tools
 */
export function createCodebaseTools(pool, embeddingProvider) {
    return [
        new IngestCodebaseTool(pool, embeddingProvider),
        new FindInCodebaseTool(pool, embeddingProvider),
        new GetFileContentTool(pool),
        new ListFilesTool(pool),
        new CodebaseStatsTool(pool),
        new FindRelatedFilesTool(pool),
        new TextSearchInCodebaseTool(pool),
        new GetExclusionPatternsTool(),
        new GetSupportedLanguagesTool(),
        new GetCodePointersTool(pool),
        new GetRecentChangesTool(pool),
        new GetFullPointerContextTool(pool)
    ];
}
//# sourceMappingURL=codebaseTools.js.map