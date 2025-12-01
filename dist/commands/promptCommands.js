/**
 * PromptCommands - prompt library management for Claude
 *
 * save and reuse prompts fr fr
 * - /prompt save <name> - save current prompt
 * - /prompt load <name> - load saved prompt
 * - /prompt list - list all saved prompts
 * - /prompt search <query> - find prompts semantically
 *
 * this is how you build up a library of reusable prompts
 *
 * EMBEDDING DIMENSION NOTE:
 * DEPRECATED: SPECMEM_EMBEDDING_DIMENSIONS is no longer used.
 * Embedding dimensions are AUTO-DETECTED from the database pgvector column.
 * The system auto-migrates when dimension mismatch is detected at startup.
 */
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { getDimensionService } from '../services/DimensionService.js';
/**
 * PromptCommands - manage a library of reusable prompts
 *
 * save your best prompts and never lose them again
 */
export class PromptCommands {
    db;
    embeddingProvider;
    name = 'prompt';
    description = 'Save, load, and manage reusable prompts - build your prompt library';
    actions = new Map();
    dimensionService = null;
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
        this.registerActions();
        this.ensurePromptTable();
        // Initialize dimension service
        try {
            this.dimensionService = getDimensionService(db, embeddingProvider);
        }
        catch {
            // Will be initialized when needed
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
            const prepared = await dimService.validateAndPrepare('saved_prompts', embedding, originalText);
            return `[${prepared.embedding.join(',')}]`;
        }
        catch {
            return `[${embedding.join(',')}]`;
        }
    }
    registerActions() {
        this.actions.set('save', {
            name: 'save',
            description: 'Save a prompt to the library',
            usage: '/prompt save <name> <content> [--description "..."] [--category system] [--tags tag1,tag2]',
            examples: [
                '/prompt save "code review" "Review this code for..." --category development',
                '/prompt save "summarize" "Summarize the following in 3 bullets: {{content}}" --tags summary,utility'
            ]
        });
        this.actions.set('load', {
            name: 'load',
            description: 'Load a saved prompt by name or ID',
            usage: '/prompt load <name|id> [--vars key=value,key2=value2]',
            examples: [
                '/prompt load "code review"',
                '/prompt load abc-123 --vars content="my code here"'
            ]
        });
        this.actions.set('list', {
            name: 'list',
            description: 'List all saved prompts',
            usage: '/prompt list [--category name] [--limit 20]',
            examples: [
                '/prompt list',
                '/prompt list --category development',
                '/prompt list --limit 50'
            ]
        });
        this.actions.set('search', {
            name: 'search',
            description: 'Semantic search through saved prompts',
            usage: '/prompt search <query> [--limit 10]',
            examples: [
                '/prompt search "code analysis"',
                '/prompt search "writing assistant" --limit 5'
            ]
        });
        this.actions.set('delete', {
            name: 'delete',
            description: 'Delete a saved prompt',
            usage: '/prompt delete <name|id>',
            examples: [
                '/prompt delete "old prompt"',
                '/prompt delete abc-123'
            ]
        });
        this.actions.set('update', {
            name: 'update',
            description: 'Update an existing prompt',
            usage: '/prompt update <name|id> [--content "..."] [--description "..."] [--tags tag1,tag2]',
            examples: [
                '/prompt update "code review" --content "New content here"',
                '/prompt update abc-123 --tags updated,reviewed'
            ]
        });
        this.actions.set('export', {
            name: 'export',
            description: 'Export prompts to JSON',
            usage: '/prompt export [--category name] [--file prompts.json]',
            examples: [
                '/prompt export',
                '/prompt export --category development'
            ]
        });
        this.actions.set('import', {
            name: 'import',
            description: 'Import prompts from JSON',
            usage: '/prompt import <json>',
            examples: [
                '/prompt import [{"name": "test", "content": "Test prompt"}]'
            ]
        });
        this.actions.set('categories', {
            name: 'categories',
            description: 'List all prompt categories',
            usage: '/prompt categories',
            examples: ['/prompt categories']
        });
        this.actions.set('help', {
            name: 'help',
            description: 'Show help for prompt commands',
            usage: '/prompt help',
            examples: ['/prompt help']
        });
    }
    /**
     * Ensure the prompts table exists
     */
    async ensurePromptTable() {
        try {
            await this.db.query(`
        CREATE TABLE IF NOT EXISTS saved_prompts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255) NOT NULL UNIQUE,
          content TEXT NOT NULL,
          description TEXT,
          category VARCHAR(100) DEFAULT 'general',
          tags TEXT[] DEFAULT '{}',
          variables TEXT[] DEFAULT '{}',
          -- NOTE: Dimension is auto-detected from memories table, unbounded initially
          embedding vector,
          usage_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
            await this.db.query(`
        CREATE INDEX IF NOT EXISTS idx_prompts_name ON saved_prompts(name)
      `);
            await this.db.query(`
        CREATE INDEX IF NOT EXISTS idx_prompts_category ON saved_prompts(category)
      `);
            await this.db.query(`
        CREATE INDEX IF NOT EXISTS idx_prompts_tags ON saved_prompts USING gin(tags)
      `);
            await this.db.query(`
        CREATE INDEX IF NOT EXISTS idx_prompts_embedding ON saved_prompts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50)
      `);
            logger.debug('saved_prompts table ensured');
        }
        catch (error) {
            logger.error({ error }, 'failed to create prompts table');
        }
    }
    async handleAction(action, args) {
        switch (action) {
            case 'save':
                return this.handleSave(args);
            case 'load':
                return this.handleLoad(args);
            case 'list':
                return this.handleList(args);
            case 'search':
                return this.handleSearch(args);
            case 'delete':
                return this.handleDelete(args);
            case 'update':
                return this.handleUpdate(args);
            case 'export':
                return this.handleExport(args);
            case 'import':
                return this.handleImport(args);
            case 'categories':
                return this.handleCategories();
            case 'help':
                return { success: true, message: this.getHelp() };
            default:
                return {
                    success: false,
                    message: `Unknown action '${action}' - try /prompt help`,
                    suggestions: ['/prompt help', '/prompt list', '/prompt save']
                };
        }
    }
    /**
     * Handle /prompt save
     */
    async handleSave(args) {
        if (args.length < 2) {
            return {
                success: false,
                message: 'Need name and content',
                suggestions: ['/prompt save "name" "content"']
            };
        }
        const name = args[0];
        const parsed = this.parseArgs(args.slice(1));
        const content = parsed.content;
        if (!content) {
            return {
                success: false,
                message: 'No content provided',
                suggestions: ['/prompt save "name" "Your prompt content here"']
            };
        }
        const description = parsed.flags.get('description') ?? '';
        const category = parsed.flags.get('category') ?? 'general';
        const tags = parsed.flags.get('tags')?.split(',') ?? [];
        // extract template variables like {{variable_name}}
        const variables = this.extractVariables(content);
        try {
            // generate embedding for semantic search
            const embedding = await this.embeddingProvider.generateEmbedding(content);
            // Prepare embedding with dimension projection
            const embeddingStr = await this.prepareEmbeddingForStorage(embedding, content);
            const id = uuidv4();
            await this.db.query(`INSERT INTO saved_prompts (id, name, content, description, category, tags, variables, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (name) DO UPDATE SET
           content = EXCLUDED.content,
           description = EXCLUDED.description,
           category = EXCLUDED.category,
           tags = EXCLUDED.tags,
           variables = EXCLUDED.variables,
           embedding = EXCLUDED.embedding,
           updated_at = NOW()`, [
                id,
                name,
                content,
                description,
                category,
                tags,
                variables,
                embeddingStr
            ]);
            return {
                success: true,
                message: `Prompt saved: ${name}`,
                data: {
                    id,
                    name,
                    category,
                    tags,
                    variables,
                    contentLength: content.length
                }
            };
        }
        catch (error) {
            logger.error({ error }, 'prompt save failed');
            return {
                success: false,
                message: `Failed to save prompt: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /prompt load
     */
    async handleLoad(args) {
        const identifier = args[0];
        if (!identifier) {
            return {
                success: false,
                message: 'No prompt name or ID provided',
                suggestions: ['/prompt list', '/prompt load "my prompt"']
            };
        }
        const parsed = this.parseArgs(args.slice(1));
        const varsStr = parsed.flags.get('vars');
        const variables = {};
        if (varsStr) {
            for (const pair of varsStr.split(',')) {
                // split on first = only so values can contain =
                const eqIdx = pair.indexOf('=');
                if (eqIdx > 0) {
                    const key = pair.slice(0, eqIdx).trim();
                    const value = pair.slice(eqIdx + 1).trim();
                    if (key) {
                        variables[key] = value;
                    }
                }
            }
        }
        try {
            // try by ID first
            let result = await this.db.query(`SELECT * FROM saved_prompts WHERE id = $1`, [identifier]);
            // try by name if not found
            if (result.rows.length === 0) {
                result = await this.db.query(`SELECT * FROM saved_prompts WHERE name ILIKE $1`, [`%${identifier}%`]);
            }
            if (result.rows.length === 0) {
                return {
                    success: false,
                    message: `Prompt not found: ${identifier}`,
                    suggestions: ['/prompt list', '/prompt search "' + identifier + '"']
                };
            }
            const prompt = result.rows[0];
            // update usage count
            await this.db.query(`UPDATE saved_prompts SET usage_count = usage_count + 1 WHERE id = $1`, [prompt.id]);
            // substitute variables
            let finalContent = prompt.content;
            for (const [key, value] of Object.entries(variables)) {
                finalContent = finalContent.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
            }
            // check for unsubstituted variables
            const remainingVars = this.extractVariables(finalContent);
            return {
                success: true,
                message: `Loaded prompt: ${prompt.name}`,
                data: {
                    id: prompt.id,
                    name: prompt.name,
                    content: finalContent,
                    description: prompt.description,
                    category: prompt.category,
                    tags: prompt.tags,
                    usageCount: prompt.usage_count + 1,
                    remainingVariables: remainingVars.length > 0 ? remainingVars : undefined
                }
            };
        }
        catch (error) {
            logger.error({ error }, 'prompt load failed');
            return {
                success: false,
                message: `Failed to load prompt: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /prompt list
     */
    async handleList(args) {
        const parsed = this.parseArgs(args);
        const category = parsed.flags.get('category');
        const limit = parseInt(parsed.flags.get('limit') ?? '20', 10);
        try {
            let query = `
        SELECT id, name, description, category, tags, variables, usage_count, created_at, updated_at
        FROM saved_prompts
      `;
            const params = [];
            let paramIndex = 1;
            if (category) {
                query += ` WHERE category = $${paramIndex}`;
                params.push(category);
                paramIndex++;
            }
            query += ` ORDER BY usage_count DESC, updated_at DESC LIMIT $${paramIndex}`;
            params.push(limit);
            const result = await this.db.query(query, params);
            return {
                success: true,
                message: `Found ${result.rows.length} prompts`,
                data: {
                    prompts: result.rows.map((row) => ({
                        id: row.id,
                        name: row.name,
                        description: row.description?.slice(0, 100),
                        category: row.category,
                        tags: row.tags,
                        variables: row.variables,
                        usageCount: row.usage_count,
                        updatedAt: row.updated_at
                    }))
                }
            };
        }
        catch (error) {
            logger.error({ error }, 'prompt list failed');
            return {
                success: false,
                message: `Failed to list prompts: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /prompt search
     */
    async handleSearch(args) {
        const parsed = this.parseArgs(args);
        if (!parsed.content) {
            return {
                success: false,
                message: 'No search query provided',
                suggestions: ['/prompt search "code review"']
            };
        }
        const limit = parseInt(parsed.flags.get('limit') ?? '10', 10);
        try {
            const queryEmbedding = await this.embeddingProvider.generateEmbedding(parsed.content);
            const result = await this.db.query(`SELECT id, name, description, category, tags, content,
                1 - (embedding <=> $1::vector) as similarity
         FROM saved_prompts
         WHERE embedding IS NOT NULL
         ORDER BY similarity DESC
         LIMIT $2`, [`[${queryEmbedding.join(',')}]`, limit]);
            return {
                success: true,
                message: `Found ${result.rows.length} matching prompts`,
                data: {
                    query: parsed.content,
                    results: result.rows.map((row) => ({
                        id: row.id,
                        name: row.name,
                        description: row.description,
                        category: row.category,
                        similarity: Math.round(row.similarity * 100) / 100,
                        preview: row.content.slice(0, 150) + (row.content.length > 150 ? '...' : '')
                    }))
                }
            };
        }
        catch (error) {
            logger.error({ error }, 'prompt search failed');
            return {
                success: false,
                message: `Search failed: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /prompt delete
     */
    async handleDelete(args) {
        const identifier = args[0];
        if (!identifier) {
            return {
                success: false,
                message: 'No prompt name or ID provided',
                suggestions: ['/prompt list']
            };
        }
        try {
            // try by ID first
            let result = await this.db.query(`DELETE FROM saved_prompts WHERE id = $1 RETURNING name`, [identifier]);
            // try by name if not found
            if (result.rows.length === 0) {
                result = await this.db.query(`DELETE FROM saved_prompts WHERE name = $1 RETURNING name`, [identifier]);
            }
            if (result.rows.length === 0) {
                return {
                    success: false,
                    message: `Prompt not found: ${identifier}`
                };
            }
            return {
                success: true,
                message: `Prompt deleted: ${result.rows[0].name}`,
                data: { deletedName: result.rows[0].name }
            };
        }
        catch (error) {
            logger.error({ error }, 'prompt delete failed');
            return {
                success: false,
                message: `Failed to delete prompt: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /prompt update
     */
    async handleUpdate(args) {
        const identifier = args[0];
        if (!identifier) {
            return {
                success: false,
                message: 'No prompt name or ID provided',
                suggestions: ['/prompt list']
            };
        }
        const parsed = this.parseArgs(args.slice(1));
        const updates = [];
        const params = [];
        let paramIndex = 1;
        if (parsed.content || parsed.flags.has('content')) {
            const content = parsed.flags.get('content') ?? parsed.content;
            updates.push(`content = $${paramIndex}`);
            params.push(content);
            paramIndex++;
            // update variables
            const variables = this.extractVariables(content);
            updates.push(`variables = $${paramIndex}`);
            params.push(variables);
            paramIndex++;
            // regenerate embedding
            const embedding = await this.embeddingProvider.generateEmbedding(content);
            updates.push(`embedding = $${paramIndex}::vector`);
            params.push(`[${embedding.join(',')}]`);
            paramIndex++;
        }
        if (parsed.flags.has('description')) {
            updates.push(`description = $${paramIndex}`);
            params.push(parsed.flags.get('description'));
            paramIndex++;
        }
        if (parsed.flags.has('category')) {
            updates.push(`category = $${paramIndex}`);
            params.push(parsed.flags.get('category'));
            paramIndex++;
        }
        if (parsed.flags.has('tags')) {
            updates.push(`tags = $${paramIndex}`);
            params.push(parsed.flags.get('tags').split(','));
            paramIndex++;
        }
        if (updates.length === 0) {
            return {
                success: false,
                message: 'No updates provided',
                suggestions: ['/prompt update "name" --content "new content"']
            };
        }
        updates.push(`updated_at = NOW()`);
        try {
            // try by ID first
            params.push(identifier);
            let result = await this.db.query(`UPDATE saved_prompts SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING id, name`, params);
            // try by name if not found
            if (result.rows.length === 0) {
                result = await this.db.query(`UPDATE saved_prompts SET ${updates.join(', ')}
           WHERE name = $${paramIndex}
           RETURNING id, name`, params);
            }
            if (result.rows.length === 0) {
                return {
                    success: false,
                    message: `Prompt not found: ${identifier}`
                };
            }
            return {
                success: true,
                message: `Prompt updated: ${result.rows[0].name}`,
                data: { id: result.rows[0].id, name: result.rows[0].name }
            };
        }
        catch (error) {
            logger.error({ error }, 'prompt update failed');
            return {
                success: false,
                message: `Failed to update prompt: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /prompt export
     */
    async handleExport(args) {
        const parsed = this.parseArgs(args);
        const category = parsed.flags.get('category');
        try {
            let query = `SELECT name, content, description, category, tags, variables FROM saved_prompts`;
            const params = [];
            if (category) {
                query += ` WHERE category = $1`;
                params.push(category);
            }
            query += ` ORDER BY name`;
            const result = await this.db.query(query, params);
            const exportData = result.rows.map((row) => ({
                name: row.name,
                content: row.content,
                description: row.description,
                category: row.category,
                tags: row.tags,
                variables: row.variables
            }));
            return {
                success: true,
                message: `Exported ${result.rows.length} prompts`,
                data: {
                    prompts: exportData,
                    json: JSON.stringify(exportData, null, 2)
                }
            };
        }
        catch (error) {
            logger.error({ error }, 'prompt export failed');
            return {
                success: false,
                message: `Export failed: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /prompt import
     */
    async handleImport(args) {
        const jsonStr = args.join(' ');
        if (!jsonStr) {
            return {
                success: false,
                message: 'No JSON data provided',
                suggestions: ['/prompt import [{"name": "test", "content": "Test"}]']
            };
        }
        try {
            const prompts = JSON.parse(jsonStr);
            if (!Array.isArray(prompts)) {
                return {
                    success: false,
                    message: 'Expected JSON array of prompts'
                };
            }
            let imported = 0;
            let failed = 0;
            const errors = [];
            for (const prompt of prompts) {
                try {
                    if (!prompt.name || !prompt.content) {
                        errors.push(`Missing name or content for prompt`);
                        failed++;
                        continue;
                    }
                    const embedding = await this.embeddingProvider.generateEmbedding(prompt.content);
                    const variables = this.extractVariables(prompt.content);
                    // Prepare embedding with dimension projection
                    const embeddingStr = await this.prepareEmbeddingForStorage(embedding, prompt.content);
                    await this.db.query(`INSERT INTO saved_prompts (id, name, content, description, category, tags, variables, embedding)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (name) DO UPDATE SET
               content = EXCLUDED.content,
               description = EXCLUDED.description,
               category = EXCLUDED.category,
               tags = EXCLUDED.tags,
               variables = EXCLUDED.variables,
               embedding = EXCLUDED.embedding,
               updated_at = NOW()`, [
                        uuidv4(),
                        prompt.name,
                        prompt.content,
                        prompt.description ?? '',
                        prompt.category ?? 'general',
                        prompt.tags ?? [],
                        variables,
                        embeddingStr
                    ]);
                    imported++;
                }
                catch (error) {
                    errors.push(`${prompt.name}: ${error instanceof Error ? error.message : 'unknown'}`);
                    failed++;
                }
            }
            return {
                success: true,
                message: `Imported ${imported} prompts, ${failed} failed`,
                data: {
                    imported,
                    failed,
                    errors: errors.slice(0, 5)
                }
            };
        }
        catch (error) {
            logger.error({ error }, 'prompt import failed');
            return {
                success: false,
                message: `Import failed: ${error instanceof Error ? error.message : 'invalid JSON'}`
            };
        }
    }
    /**
     * Handle /prompt categories
     */
    async handleCategories() {
        try {
            const result = await this.db.query(`
        SELECT category, COUNT(*) as count
        FROM saved_prompts
        GROUP BY category
        ORDER BY count DESC
      `);
            return {
                success: true,
                message: `Found ${result.rows.length} categories`,
                data: {
                    categories: result.rows.map((row) => ({
                        name: row.category,
                        count: parseInt(row.count)
                    }))
                }
            };
        }
        catch (error) {
            logger.error({ error }, 'prompt categories failed');
            return {
                success: false,
                message: `Failed to get categories: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Extract template variables from prompt content
     * Variables are in the format {{variable_name}}
     */
    extractVariables(content) {
        const matches = content.match(/\{\{(\w+)\}\}/g);
        if (!matches)
            return [];
        const variables = matches.map(m => m.slice(2, -2));
        return [...new Set(variables)]; // unique
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
            '### Prompt Library Commands',
            '',
            'Save and manage reusable prompts with template variables.',
            'Variables use {{variable_name}} syntax.',
            ''
        ];
        for (const [name, action] of this.actions) {
            if (name === 'help')
                continue;
            lines.push(`- **/${this.name} ${name}** - ${action.description}`);
            lines.push(`  Usage: \`${action.usage}\``);
        }
        return lines.join('\n');
    }
}
//# sourceMappingURL=promptCommands.js.map