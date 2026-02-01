/**
 * CodebaseCommands - codebase indexing and search commands for 
 *
 * yooo this is where we ingest whole ass codebases
 * - /codebase ingest - scan and index entire codebase
 * - /codebase search <query> - find code semantically
 * - /codebase file <path> - get specific file
 * - /codebase update - refresh changed files
 * - /codebase stats - codebase statistics
 *
 * also handles /docs commands since docs are just special code
 */
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import { splitContent } from '../mcp/mcpProtocolHandler.js';
import { logger } from '../utils/logger.js';
import { compactResponse } from '../services/ResponseCompactor.js';
import { getDimensionService } from '../services/DimensionService.js';
import { getEnabledExtensions, getEnabledExtensionsSync, getLanguageConfig, setLanguageEnabled, setLanguagePriority } from '../config/languageConfig.js';
import { getProjectPathForInsert } from '../services/ProjectContext.js';
/**
 * CodebaseCommands - ingest and search codebases
 *
 * ingestThisWholeAssMfCodebase but as slash commands
 */
export class CodebaseCommands {
    db;
    embeddingProvider;
    name = 'codebase';
    description = 'Ingest, search, and manage codebase knowledge - index your entire project';
    actions = new Map();
    dimensionService = null;
    // file extensions to index - now loaded from config!
    // using sync version for initialization, will refresh async when needed
    codeExtensions = getEnabledExtensionsSync();
    docExtensions = new Set([
        '.md', '.mdx', '.txt', '.rst', '.adoc', '.org'
    ]);
    configExtensions = new Set([
        '.json', '.yaml', '.yml', '.toml', '.ini', '.env.example'
    ]);
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
        this.registerActions();
        // async refresh of code extensions from config
        this.refreshCodeExtensions();
        // Initialize dimension service
        try {
            this.dimensionService = getDimensionService(db, embeddingProvider);
        }
        catch {
            // Will initialize when needed
        }
    }
    /**
     * Get the DimensionService (lazy initialization)
     */
    getDimService() {
        if (!this.dimensionService) {
            try {
                this.dimensionService = getDimensionService(this.db, this.embeddingProvider);
            }
            catch {
                // Service not available
            }
        }
        return this.dimensionService;
    }
    /**
     * Prepare embedding for database storage
     */
    async prepareEmbeddingForStorage(embedding, originalText) {
        if (!embedding || embedding.length === 0)
            return null;
        const dimService = this.getDimService();
        if (!dimService) {
            return `[${embedding.join(',')}]`;
        }
        try {
            const prepared = await dimService.validateAndPrepare('memories', embedding, originalText);
            return `[${prepared.embedding.join(',')}]`;
        }
        catch {
            return `[${embedding.join(',')}]`;
        }
    }
    /**
     * Refresh code extensions from config file
     */
    async refreshCodeExtensions() {
        try {
            this.codeExtensions = await getEnabledExtensions();
            logger.debug({ count: this.codeExtensions.size }, 'refreshed code extensions from config');
        }
        catch (err) {
            logger.warn({ err }, 'failed to refresh code extensions, using cached');
        }
    }
    registerActions() {
        this.actions.set('ingest', {
            name: 'ingest',
            description: 'Scan and index an entire codebase or directory',
            usage: '/codebase ingest <path> [--extensions ts,js,py] [--ignore node_modules,dist] [--max-files 1000]',
            examples: [
                '/codebase ingest ./src',
                '/codebase ingest /path/to/project --extensions ts,tsx',
                '/codebase ingest . --ignore node_modules,dist,.git'
            ]
        });
        this.actions.set('search', {
            name: 'search',
            description: 'Semantic search through indexed code',
            usage: '/codebase search <query> [--limit 10] [--file-type ts] [--path-contains src]',
            examples: [
                '/codebase search "database connection handling"',
                '/codebase search "authentication middleware" --file-type ts',
                '/codebase search "API endpoints" --path-contains routes'
            ]
        });
        this.actions.set('file', {
            name: 'file',
            description: 'Get a specific indexed file by path',
            usage: '/codebase file <path>',
            examples: [
                '/codebase file src/index.ts',
                '/codebase file ./utils/helpers.py'
            ]
        });
        this.actions.set('update', {
            name: 'update',
            description: 'Refresh index for changed files',
            usage: '/codebase update [path] [--since 24h] [--force]',
            examples: [
                '/codebase update',
                '/codebase update ./src --since 1h',
                '/codebase update --force'
            ]
        });
        this.actions.set('stats', {
            name: 'stats',
            description: 'Show codebase indexing statistics',
            usage: '/codebase stats [--by-extension] [--by-directory]',
            examples: [
                '/codebase stats',
                '/codebase stats --by-extension'
            ]
        });
        this.actions.set('index', {
            name: 'index',
            description: 'Alias for ingest - index documentation',
            usage: '/docs index <path>',
            examples: [
                '/docs index ./docs',
                '/docs index ./README.md'
            ]
        });
        this.actions.set('get', {
            name: 'get',
            description: 'Get documentation on a topic',
            usage: '/docs get <topic>',
            examples: [
                '/docs get authentication',
                '/docs get "getting started"'
            ]
        });
        this.actions.set('help', {
            name: 'help',
            description: 'Show help for codebase commands',
            usage: '/codebase help [action]',
            examples: ['/codebase help', '/codebase help ingest']
        });
        // Language configuration actions
        this.actions.set('languages', {
            name: 'languages',
            description: 'Show configured programming languages and their priorities',
            usage: '/codebase languages [--enabled-only]',
            examples: [
                '/codebase languages',
                '/codebase languages --enabled-only'
            ]
        });
        this.actions.set('lang-enable', {
            name: 'lang-enable',
            description: 'Enable a programming language for indexing',
            usage: '/codebase lang-enable <language-id>',
            examples: [
                '/codebase lang-enable csharp',
                '/codebase lang-enable python'
            ]
        });
        this.actions.set('lang-disable', {
            name: 'lang-disable',
            description: 'Disable a programming language from indexing',
            usage: '/codebase lang-disable <language-id>',
            examples: [
                '/codebase lang-disable csharp',
                '/codebase lang-disable php'
            ]
        });
        this.actions.set('lang-priority', {
            name: 'lang-priority',
            description: 'Set priority for a language (1-10, higher = more important)',
            usage: '/codebase lang-priority <language-id> <priority>',
            examples: [
                '/codebase lang-priority python 10',
                '/codebase lang-priority csharp 1'
            ]
        });
    }
    async handleAction(action, args) {
        switch (action) {
            case 'ingest':
            case 'index':
                return this.handleIngest(args);
            case 'search':
                return this.handleSearch(args);
            case 'file':
                return this.handleFile(args);
            case 'get':
                return this.handleGet(args);
            case 'update':
                return this.handleUpdate(args);
            case 'stats':
                return this.handleStats(args);
            case 'languages':
                return this.handleLanguages(args);
            case 'lang-enable':
                return this.handleLangEnable(args);
            case 'lang-disable':
                return this.handleLangDisable(args);
            case 'lang-priority':
                return this.handleLangPriority(args);
            case 'help':
                return { success: true, message: this.getHelp() };
            default:
                return {
                    success: false,
                    message: `Unknown action '${action}' - try /codebase help`,
                    suggestions: ['/codebase help', '/codebase ingest', '/codebase search']
                };
        }
    }
    /**
     * Handle /codebase ingest
     */
    async handleIngest(args) {
        const parsed = this.parseArgs(args);
        const targetPath = parsed.content ?? '.';
        const customExtensions = parsed.flags.get('extensions')?.split(',');
        const ignorePatterns = parsed.flags.get('ignore')?.split(',') ?? ['node_modules', 'dist', '.git', '__pycache__', 'venv'];
        const maxFiles = parseInt(parsed.flags.get('max-files') ?? '1000', 10);
        logger.info({ targetPath, maxFiles, ignorePatterns }, 'starting codebase ingest');
        try {
            // resolve absolute path
            const absolutePath = path.resolve(targetPath);
            // check if path exists
            const stats = await fs.stat(absolutePath);
            if (!stats.isDirectory()) {
                // single file
                const file = await this.readFile(absolutePath, absolutePath);
                if (file) {
                    await this.indexFile(file);
                    return {
                        success: true,
                        message: `Indexed single file: ${absolutePath}`,
                        data: { filesIndexed: 1, path: absolutePath }
                    };
                }
            }
            // scan directory
            const files = await this.scanDirectory(absolutePath, absolutePath, ignorePatterns, customExtensions, maxFiles);
            // index files with progress
            let indexed = 0;
            let failed = 0;
            const errors = [];
            for (const file of files) {
                try {
                    await this.indexFile(file);
                    indexed++;
                }
                catch (error) {
                    failed++;
                    errors.push(`${file.relativePath}: ${error instanceof Error ? error.message : 'unknown'}`);
                }
            }
            return {
                success: true,
                message: `Codebase indexed! ${indexed} files processed, ${failed} failed`,
                data: {
                    totalFiles: files.length,
                    indexed,
                    failed,
                    errors: errors.slice(0, 10), // first 10 errors
                    path: absolutePath
                }
            };
        }
        catch (error) {
            logger.error({ error }, 'codebase ingest failed');
            return {
                success: false,
                message: `Ingest failed: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Scan directory recursively
     */
    async scanDirectory(dir, basePath, ignorePatterns, customExtensions, maxFiles = 1000) {
        const files = [];
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (files.length >= maxFiles)
                break;
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(basePath, fullPath);
            // check ignore patterns
            if (ignorePatterns.some(pattern => relativePath.includes(pattern))) {
                continue;
            }
            if (entry.isDirectory()) {
                const subFiles = await this.scanDirectory(fullPath, basePath, ignorePatterns, customExtensions, maxFiles - files.length);
                files.push(...subFiles);
            }
            else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                // check if should index this extension
                const shouldIndex = customExtensions
                    ? customExtensions.includes(ext.slice(1))
                    : this.codeExtensions.has(ext) || this.docExtensions.has(ext) || this.configExtensions.has(ext);
                if (shouldIndex) {
                    const file = await this.readFile(fullPath, basePath);
                    if (file) {
                        files.push(file);
                    }
                }
            }
        }
        return files;
    }
    /**
     * Read a file
     */
    async readFile(filePath, basePath) {
        try {
            const stats = await fs.stat(filePath);
            // skip large files (> 1MB)
            if (stats.size > 1_000_000) {
                logger.debug({ filePath, size: stats.size }, 'skipping large file');
                return null;
            }
            const content = await fs.readFile(filePath, 'utf-8');
            return {
                path: filePath,
                relativePath: path.relative(basePath, filePath),
                content,
                extension: path.extname(filePath).toLowerCase(),
                size: stats.size,
                modifiedAt: stats.mtime
            };
        }
        catch (error) {
            logger.debug({ filePath, error }, 'failed to read file');
            return null;
        }
    }
    /**
     * Index a file into the database
     */
    async indexFile(file) {
        // determine memory type based on extension
        const isDoc = this.docExtensions.has(file.extension);
        const memoryType = isDoc ? 'semantic' : 'procedural';
        // split large files into chunks
        const maxChunkSize = 10000;
        const chunks = file.content.length > maxChunkSize
            ? splitContent(file.content, maxChunkSize, 200)
            : [file.content];
        const tags = [
            'codebase',
            `ext:${file.extension.slice(1)}`,
            `path:${path.dirname(file.relativePath)}`,
            isDoc ? 'documentation' : 'code'
        ];
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const id = uuidv4();
            // generate embedding
            const embedding = await this.embeddingProvider.generateEmbedding(chunk);
            // Prepare embedding with dimension projection
            const embeddingStr = await this.prepareEmbeddingForStorage(embedding, chunk);
            const chunkTags = chunks.length > 1
                ? [...tags, `chunk:${i + 1}/${chunks.length}`]
                : tags;
            // PROJECT ISOLATION: Get fresh project path at call time
            const projectPath = getProjectPathForInsert();
            await this.db.query(`INSERT INTO memories (id, content, memory_type, importance, tags, metadata, embedding, project_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           content = EXCLUDED.content,
           embedding = EXCLUDED.embedding,
           updated_at = NOW()`, [
                id,
                chunk,
                memoryType,
                'medium',
                chunkTags,
                {
                    source: 'codebase',
                    filePath: file.relativePath,
                    extension: file.extension,
                    fileSize: file.size,
                    chunkIndex: chunks.length > 1 ? i : undefined,
                    totalChunks: chunks.length > 1 ? chunks.length : undefined,
                    modifiedAt: file.modifiedAt.toISOString()
                },
                embeddingStr,
                projectPath
            ]);
        }
    }
    /**
     * Handle /codebase search
     */
    async handleSearch(args) {
        const parsed = this.parseArgs(args);
        if (!parsed.content) {
            return {
                success: false,
                message: 'No search query provided',
                suggestions: ['/codebase search "database connection"']
            };
        }
        const limit = parseInt(parsed.flags.get('limit') ?? '10', 10);
        const fileType = parsed.flags.get('file-type');
        const pathContains = parsed.flags.get('path-contains');
        try {
            const queryEmbedding = await this.embeddingProvider.generateEmbedding(parsed.content);
            let query = `
        SELECT
          id, content, tags, metadata,
          1 - (embedding <=> $1::vector) as similarity
        FROM memories
        WHERE embedding IS NOT NULL
          AND 'codebase' = ANY(tags)
      `;
            const params = [`[${queryEmbedding.join(',')}]`];
            let paramIndex = 2;
            if (fileType) {
                query += ` AND $${paramIndex} = ANY(tags)`;
                params.push(`ext:${fileType}`);
                paramIndex++;
            }
            if (pathContains) {
                query += ` AND metadata->>'filePath' ILIKE $${paramIndex}`;
                params.push(`%${pathContains}%`);
                paramIndex++;
            }
            query += ` ORDER BY similarity DESC LIMIT $${paramIndex}`;
            params.push(limit);
            const result = await this.db.query(query, params);
            // Apply Chinese compactor for token efficiency
            return compactResponse({
                success: true,
                message: `Found ${result.rows.length} matching code segments`,
                data: {
                    query: parsed.content,
                    results: result.rows.map((row) => ({
                        id: row.id,
                        filePath: row.metadata?.filePath,
                        content: row.content.slice(0, 300) + (row.content.length > 300 ? '...' : ''),
                        similarity: Math.round(row.similarity * 100) / 100,
                        extension: row.metadata?.extension,
                        tags: row.tags.filter((t) => !t.startsWith('ext:') && !t.startsWith('path:'))
                    }))
                }
            }, 'search');
        }
        catch (error) {
            logger.error({ error }, 'codebase search failed');
            return {
                success: false,
                message: `Search failed: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /codebase file
     */
    async handleFile(args) {
        const filePath = args[0];
        if (!filePath) {
            return {
                success: false,
                message: 'No file path provided',
                suggestions: ['/codebase file src/index.ts']
            };
        }
        const result = await this.db.query(`SELECT id, content, tags, metadata, created_at
       FROM memories
       WHERE 'codebase' = ANY(tags)
         AND metadata->>'filePath' = $1
       ORDER BY (metadata->>'chunkIndex')::int NULLS FIRST`, [filePath]);
        if (result.rows.length === 0) {
            return {
                success: false,
                message: `File not indexed: ${filePath}`,
                suggestions: ['/codebase ingest .']
            };
        }
        // combine chunks if multiple
        const fullContent = result.rows.map((r) => r.content).join('\n');
        return {
            success: true,
            message: `Retrieved ${filePath}`,
            data: {
                path: filePath,
                content: fullContent,
                chunks: result.rows.length,
                indexedAt: result.rows[0].created_at
            }
        };
    }
    /**
     * Handle /docs get - search for documentation
     */
    async handleGet(args) {
        const topic = args.join(' ');
        if (!topic) {
            return {
                success: false,
                message: 'No topic provided',
                suggestions: ['/docs get authentication']
            };
        }
        const queryEmbedding = await this.embeddingProvider.generateEmbedding(topic);
        const result = await this.db.query(`SELECT id, content, tags, metadata,
              1 - (embedding <=> $1::vector) as similarity
       FROM memories
       WHERE embedding IS NOT NULL
         AND ('documentation' = ANY(tags) OR 'codebase' = ANY(tags))
       ORDER BY similarity DESC
       LIMIT 5`, [`[${queryEmbedding.join(',')}]`]);
        if (result.rows.length === 0) {
            return {
                success: false,
                message: `No documentation found for: ${topic}`,
                suggestions: ['/docs index ./docs', '/codebase search "' + topic + '"']
            };
        }
        // Apply Chinese compactor for token efficiency
        return compactResponse({
            success: true,
            message: `Found documentation on: ${topic}`,
            data: {
                topic,
                results: result.rows.map((row) => ({
                    content: row.content,
                    source: row.metadata?.filePath,
                    similarity: Math.round(row.similarity * 100) / 100
                }))
            }
        }, 'search');
    }
    /**
     * Handle /codebase update
     */
    async handleUpdate(args) {
        const parsed = this.parseArgs(args);
        const targetPath = parsed.content ?? '.';
        const force = parsed.flags.has('force');
        const sinceStr = parsed.flags.get('since') ?? '24h';
        // parse since duration
        const sinceHours = parseInt(sinceStr.replace('h', ''), 10) || 24;
        const sinceDate = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
        logger.info({ targetPath, force, sinceDate }, 'updating codebase index');
        try {
            const absolutePath = path.resolve(targetPath);
            // get indexed files
            const indexedFiles = await this.db.query(`SELECT DISTINCT metadata->>'filePath' as file_path,
                MAX((metadata->>'modifiedAt')::timestamptz) as indexed_at
         FROM memories
         WHERE 'codebase' = ANY(tags)
           AND metadata->>'filePath' IS NOT NULL
         GROUP BY metadata->>'filePath'`);
            const indexedMap = new Map(indexedFiles.rows.map((r) => [r.file_path, new Date(r.indexed_at)]));
            // scan for changed files
            const files = await this.scanDirectory(absolutePath, absolutePath, ['node_modules', 'dist', '.git'], undefined, 10000);
            let updated = 0;
            let skipped = 0;
            for (const file of files) {
                const indexedAt = indexedMap.get(file.relativePath);
                if (force || !indexedAt || file.modifiedAt > indexedAt || file.modifiedAt > sinceDate) {
                    // delete old chunks - PROJECT ISOLATED
                    const projectPath = getProjectPathForInsert();
                    await this.db.query(`DELETE FROM memories
             WHERE 'codebase' = ANY(tags)
               AND metadata->>'filePath' = $1
               AND project_path = $2`, [file.relativePath, projectPath]);
                    // reindex
                    await this.indexFile(file);
                    updated++;
                }
                else {
                    skipped++;
                }
            }
            return {
                success: true,
                message: `Update complete! ${updated} files updated, ${skipped} unchanged`,
                data: {
                    updated,
                    skipped,
                    totalScanned: files.length
                }
            };
        }
        catch (error) {
            logger.error({ error }, 'codebase update failed');
            return {
                success: false,
                message: `Update failed: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /codebase stats
     */
    async handleStats(args) {
        const parsed = this.parseArgs(args);
        const byExtension = parsed.flags.has('by-extension');
        const byDirectory = parsed.flags.has('by-directory');
        try {
            const basicStats = await this.db.query(`
        SELECT
          COUNT(*) as total_chunks,
          COUNT(DISTINCT metadata->>'filePath') as total_files,
          pg_size_pretty(SUM(length(content))::bigint) as total_size,
          MIN(created_at) as first_indexed,
          MAX(updated_at) as last_updated
        FROM memories
        WHERE 'codebase' = ANY(tags)
      `);
            const data = {
                ...basicStats.rows[0]
            };
            if (byExtension) {
                const extStats = await this.db.query(`
          SELECT
            metadata->>'extension' as extension,
            COUNT(DISTINCT metadata->>'filePath') as file_count,
            COUNT(*) as chunk_count
          FROM memories
          WHERE 'codebase' = ANY(tags)
          GROUP BY metadata->>'extension'
          ORDER BY file_count DESC
        `);
                data.byExtension = extStats.rows;
            }
            if (byDirectory) {
                const dirStats = await this.db.query(`
          SELECT
            split_part(metadata->>'filePath', '/', 1) as directory,
            COUNT(DISTINCT metadata->>'filePath') as file_count
          FROM memories
          WHERE 'codebase' = ANY(tags)
          GROUP BY split_part(metadata->>'filePath', '/', 1)
          ORDER BY file_count DESC
          LIMIT 20
        `);
                data.byDirectory = dirStats.rows;
            }
            return {
                success: true,
                message: 'Codebase statistics retrieved',
                data
            };
        }
        catch (error) {
            logger.error({ error }, 'codebase stats failed');
            return {
                success: false,
                message: `Stats failed: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /codebase languages - show all configured languages
     */
    async handleLanguages(args) {
        const parsed = this.parseArgs(args);
        const enabledOnly = parsed.flags.has('enabled-only');
        try {
            const config = await getLanguageConfig();
            const languages = Object.values(config)
                .filter(lang => !enabledOnly || lang.enabled)
                .sort((a, b) => b.priority - a.priority); // sort by priority (high to low)
            const lines = [];
            lines.push('### Configured Programming Languages');
            lines.push('');
            lines.push('| Language | ID | Priority | Status | Extensions |');
            lines.push('|----------|-----|----------|--------|------------|');
            for (const lang of languages) {
                const status = lang.enabled ? 'ENABLED' : 'disabled';
                const exts = lang.extensions.join(', ');
                lines.push(`| ${lang.name} | ${lang.id} | ${lang.priority} | ${status} | ${exts} |`);
            }
            lines.push('');
            lines.push(`Total: ${languages.length} languages configured`);
            lines.push(`Enabled: ${languages.filter(l => l.enabled).length}`);
            return {
                success: true,
                message: lines.join('\n'),
                data: {
                    total: languages.length,
                    enabled: languages.filter(l => l.enabled).length,
                    languages: languages.map(l => ({
                        id: l.id,
                        name: l.name,
                        priority: l.priority,
                        enabled: l.enabled,
                        extensions: l.extensions
                    }))
                }
            };
        }
        catch (error) {
            logger.error({ error }, 'failed to get language config');
            return {
                success: false,
                message: `Failed to get languages: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /codebase lang-enable - enable a language
     */
    async handleLangEnable(args) {
        const langId = args[0];
        if (!langId) {
            return {
                success: false,
                message: 'No language ID provided',
                suggestions: ['/codebase lang-enable python', '/codebase languages']
            };
        }
        try {
            const success = await setLanguageEnabled(langId, true);
            if (!success) {
                return {
                    success: false,
                    message: `Language '${langId}' not found`,
                    suggestions: ['/codebase languages']
                };
            }
            // refresh our cached extensions
            await this.refreshCodeExtensions();
            return {
                success: true,
                message: `Language '${langId}' is now ENABLED for indexing`,
                data: { langId, enabled: true }
            };
        }
        catch (error) {
            logger.error({ error, langId }, 'failed to enable language');
            return {
                success: false,
                message: `Failed to enable language: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /codebase lang-disable - disable a language
     */
    async handleLangDisable(args) {
        const langId = args[0];
        if (!langId) {
            return {
                success: false,
                message: 'No language ID provided',
                suggestions: ['/codebase lang-disable csharp', '/codebase languages']
            };
        }
        try {
            const success = await setLanguageEnabled(langId, false);
            if (!success) {
                return {
                    success: false,
                    message: `Language '${langId}' not found`,
                    suggestions: ['/codebase languages']
                };
            }
            // refresh our cached extensions
            await this.refreshCodeExtensions();
            return {
                success: true,
                message: `Language '${langId}' is now DISABLED and won't be indexed`,
                data: { langId, enabled: false }
            };
        }
        catch (error) {
            logger.error({ error, langId }, 'failed to disable language');
            return {
                success: false,
                message: `Failed to disable language: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /codebase lang-priority - set language priority
     */
    async handleLangPriority(args) {
        const langId = args[0];
        const priorityStr = args[1];
        if (!langId || !priorityStr) {
            return {
                success: false,
                message: 'Usage: /codebase lang-priority <language-id> <priority>',
                suggestions: ['/codebase lang-priority python 10', '/codebase languages']
            };
        }
        const priority = parseInt(priorityStr, 10);
        if (isNaN(priority) || priority < 1 || priority > 10) {
            return {
                success: false,
                message: 'Priority must be a number between 1 and 10',
                suggestions: ['/codebase lang-priority python 10']
            };
        }
        try {
            const success = await setLanguagePriority(langId, priority);
            if (!success) {
                return {
                    success: false,
                    message: `Language '${langId}' not found`,
                    suggestions: ['/codebase languages']
                };
            }
            return {
                success: true,
                message: `Language '${langId}' priority set to ${priority}`,
                data: { langId, priority }
            };
        }
        catch (error) {
            logger.error({ error, langId, priority }, 'failed to set language priority');
            return {
                success: false,
                message: `Failed to set priority: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    parseArgs(args) {
        const flags = new Map();
        const contentParts = [];
        let i = 0;
        while (i < args.length) {
            const arg = args[i];
            if (arg.startsWith('--')) {
                const flagName = arg.slice(2);
                const nextArg = args[i + 1];
                if (nextArg && !nextArg.startsWith('--')) {
                    flags.set(flagName, nextArg);
                    i += 2;
                }
                else {
                    flags.set(flagName, 'true');
                    i++;
                }
            }
            else {
                contentParts.push(arg);
                i++;
            }
        }
        return {
            content: contentParts.length > 0 ? contentParts.join(' ') : null,
            flags
        };
    }
    getHelp() {
        const lines = [
            '### Codebase Commands',
            ''
        ];
        // Main codebase actions (excluding help, aliases, and lang-* commands)
        for (const [name, action] of this.actions) {
            if (name === 'help' || name === 'index' || name === 'get' || name.startsWith('lang'))
                continue;
            lines.push(`- **/${this.name} ${name}** - ${action.description}`);
            lines.push(`  Usage: \`${action.usage}\``);
        }
        lines.push('');
        lines.push('### Language Configuration Commands');
        lines.push('- **/codebase languages** - Show all configured languages and their priorities');
        lines.push('- **/codebase lang-enable <id>** - Enable a language for indexing');
        lines.push('- **/codebase lang-disable <id>** - Disable a language from indexing');
        lines.push('- **/codebase lang-priority <id> <1-10>** - Set priority (higher = more important)');
        lines.push('');
        lines.push('Config file: `~/.specmem/language-config.json`');
        lines.push('');
        lines.push('### Documentation Commands (alias)');
        lines.push('- **/docs index** - Index documentation files');
        lines.push('- **/docs search** - Search documentation');
        lines.push('- **/docs get** - Get documentation on a topic');
        return lines.join('\n');
    }
}
//# sourceMappingURL=codebaseCommands.js.map