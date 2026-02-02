/**
 * MemoryCommands - memory-related slash commands for 
 *
 * yo these are the commands for working with memories fr
 * - /memory store <content> - store a memory
 * - /memory search <query> - semantic search
 * - /memory recall <id> - get specific memory
 * - /memory delete <id> - delete memory
 * - /memory stats - show statistics
 *
 * PROJECT ISOLATED: All operations are scoped to current project
 */
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { getDimensionService } from '../services/DimensionService.js';
import { compactResponse } from '../services/ResponseCompactor.js';
import { getProjectPathForInsert } from '../services/ProjectContext.js';
/**
 * MemoryCommands - handle all memory-related commands
 *
 * rememberThisShit but as slash commands
 */
export class MemoryCommands {
    db;
    embeddingProvider;
    name = 'memory';
    description = 'Store, search, and manage memories - your persistent knowledge base';
    actions = new Map();
    dimensionService = null;
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
        this.registerActions();
        try {
            this.dimensionService = getDimensionService(db, embeddingProvider);
        }
        catch {
            // Will initialize when needed
        }
    }
    getDimService() {
        if (!this.dimensionService) {
            this.dimensionService = getDimensionService(this.db, this.embeddingProvider);
        }
        return this.dimensionService;
    }
    async prepareEmbedding(embedding, originalQuery) {
        const dimService = this.getDimService();
        const prepared = await dimService.validateAndPrepare('memories', embedding, originalQuery);
        if (prepared.wasModified) {
            logger.debug({ action: prepared.action }, 'Adjusted embedding dimension');
        }
        return prepared.embedding;
    }
    /**
     * Register all available actions
     */
    registerActions() {
        this.actions.set('store', {
            name: 'store',
            description: 'Store a new memory with optional tags and importance level',
            usage: '/memory store <content> [--tags tag1,tag2] [--importance high] [--type semantic]',
            examples: [
                '/memory store "The API key format is XYZ-123" --tags api,security --importance high',
                '/memory store "Meeting notes from standup" --type episodic',
                '/memory store "How to deploy: npm run build && npm run deploy" --type procedural'
            ]
        });
        this.actions.set('search', {
            name: 'search',
            description: 'Semantic search through memories using natural language',
            usage: '/memory search <query> [--limit 10] [--threshold 0.7] [--tags tag1,tag2]',
            examples: [
                '/memory search "how to authenticate with the API"',
                '/memory search "deployment steps" --limit 5',
                '/memory search "database config" --tags config,database'
            ]
        });
        this.actions.set('recall', {
            name: 'recall',
            description: 'Recall a specific memory by ID or get recent memories',
            usage: '/memory recall [id] [--limit 10] [--tags tag1,tag2]',
            examples: [
                '/memory recall abc-123-def',
                '/memory recall --limit 20',
                '/memory recall --tags important'
            ]
        });
        this.actions.set('delete', {
            name: 'delete',
            description: 'Delete a memory by ID or delete by criteria',
            usage: '/memory delete <id> | /memory delete --tags tag1 --older-than 30d',
            examples: [
                '/memory delete abc-123-def',
                '/memory delete --tags temp --older-than 7d',
                '/memory delete --expired'
            ]
        });
        this.actions.set('stats', {
            name: 'stats',
            description: 'Show memory statistics and database health',
            usage: '/memory stats [--detailed]',
            examples: [
                '/memory stats',
                '/memory stats --detailed'
            ]
        });
        this.actions.set('update', {
            name: 'update',
            description: 'Update an existing memory',
            usage: '/memory update <id> [--content "new content"] [--tags tag1,tag2] [--importance high]',
            examples: [
                '/memory update abc-123 --importance critical',
                '/memory update abc-123 --tags updated,reviewed',
                '/memory update abc-123 --content "Updated content here"'
            ]
        });
        this.actions.set('help', {
            name: 'help',
            description: 'Show help for memory commands',
            usage: '/memory help [action]',
            examples: [
                '/memory help',
                '/memory help store'
            ]
        });
    }
    /**
     * Handle a memory action
     */
    async handleAction(action, args) {
        switch (action) {
            case 'store':
                return this.handleStore(args);
            case 'search':
                return this.handleSearch(args);
            case 'recall':
                return this.handleRecall(args);
            case 'delete':
                return this.handleDelete(args);
            case 'stats':
                return this.handleStats(args);
            case 'update':
                return this.handleUpdate(args);
            case 'help':
                return { success: true, message: this.getHelp() };
            default:
                return {
                    success: false,
                    message: `Unknown action '${action}' - nah bruh try /memory help`,
                    suggestions: ['/memory help', '/memory store', '/memory search']
                };
        }
    }
    /**
     * Handle /memory store
     */
    async handleStore(args) {
        const parsed = this.parseArgs(args);
        if (!parsed.content) {
            return {
                success: false,
                message: 'No content provided - what do you want me to remember fr?',
                suggestions: ['/memory store "your content here"']
            };
        }
        const id = uuidv4();
        const tags = parsed.flags.get('tags')?.split(',') ?? [];
        const importance = parsed.flags.get('importance') ?? 'medium';
        const memoryType = parsed.flags.get('type') ?? 'semantic';
        try {
            // generate embedding
            const embedding = await this.embeddingProvider.generateEmbedding(parsed.content);
            // Prepare embedding with dimension projection
            const preparedEmbedding = embedding.length > 0
                ? await this.prepareEmbedding(embedding, parsed.content)
                : null;
            // store in database
            // PROJECT ISOLATION: Get fresh project path at call time
            const projectPath = getProjectPathForInsert();
            await this.db.query(`INSERT INTO memories (id, content, memory_type, importance, tags, metadata, embedding, project_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
                id,
                parsed.content,
                memoryType,
                importance,
                tags,
                { source: 'command', command: '/memory store' },
                preparedEmbedding ? `[${preparedEmbedding.join(',')}]` : null,
                projectPath
            ]);
            logger.info({ memoryId: id, tags }, 'memory stored via command');
            return {
                success: true,
                message: `Memory stored! ID: ${id}`,
                data: {
                    id,
                    content: parsed.content.slice(0, 100) + (parsed.content.length > 100 ? '...' : ''),
                    tags,
                    importance,
                    memoryType
                }
            };
        }
        catch (error) {
            logger.error({ error }, 'memory store command failed');
            return {
                success: false,
                message: `Failed to store memory: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /memory search
     */
    async handleSearch(args) {
        const parsed = this.parseArgs(args);
        if (!parsed.content) {
            return {
                success: false,
                message: 'No search query provided - what are you looking for fr?',
                suggestions: ['/memory search "your query here"']
            };
        }
        const limit = parseInt(parsed.flags.get('limit') ?? '10', 10);
        const threshold = parseFloat(parsed.flags.get('threshold') ?? '0.7');
        const tags = parsed.flags.get('tags')?.split(',');
        try {
            // generate query embedding
            const rawEmbedding = await this.embeddingProvider.generateEmbedding(parsed.content);
            // Validate and prepare embedding dimension using DimensionService
            const queryEmbedding = await this.prepareEmbedding(rawEmbedding, parsed.content);
            // build query
            let query = `
        SELECT
          id, content, memory_type, importance, tags, metadata,
          created_at, updated_at, access_count,
          1 - (embedding <=> $1::vector) as similarity
        FROM memories
        WHERE embedding IS NOT NULL
      `;
            const params = [`[${queryEmbedding.join(',')}]`];
            let paramIndex = 2;
            if (tags && tags.length > 0) {
                query += ` AND tags && $${paramIndex}`;
                params.push(tags);
                paramIndex++;
            }
            query += ` AND 1 - (embedding <=> $1::vector) >= $${paramIndex}`;
            params.push(threshold);
            query += ` ORDER BY similarity DESC LIMIT $${paramIndex + 1}`;
            params.push(limit);
            const result = await this.db.query(query, params);
            // update access count for found memories
            if (result.rows.length > 0) {
                const ids = result.rows.map((r) => r.id);
                await this.db.query(`UPDATE memories SET access_count = access_count + 1, last_accessed_at = NOW()
           WHERE id = ANY($1)`, [ids]);
            }
            // Apply Chinese compactor for token efficiency
            return compactResponse({
                success: true,
                message: `Found ${result.rows.length} matching memories`,
                data: {
                    query: parsed.content,
                    results: result.rows.map((row) => ({
                        id: row.id,
                        content: row.content.slice(0, 200) + (row.content.length > 200 ? '...' : ''),
                        similarity: Math.round(row.similarity * 100) / 100,
                        tags: row.tags,
                        importance: row.importance,
                        memoryType: row.memory_type,
                        createdAt: row.created_at
                    }))
                }
            }, 'search');
        }
        catch (error) {
            logger.error({ error }, 'memory search command failed');
            return {
                success: false,
                message: `Search failed: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /memory recall
     */
    async handleRecall(args) {
        const parsed = this.parseArgs(args);
        // check if first arg is an ID (uuid format)
        const idArg = args[0];
        const isUuid = idArg && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idArg);
        if (isUuid) {
            // recall specific memory
            // PROJECT ISOLATED: Only recall from current project
            const projectPath = getProjectPathForInsert();
            const result = await this.db.query(`SELECT * FROM memories WHERE id = $1 AND project_path = $2`, [idArg, projectPath]);
            if (result.rows.length === 0) {
                return {
                    success: false,
                    message: `Memory ${idArg} not found - it might have been yeeted`
                };
            }
            // update access
            await this.db.query(`UPDATE memories SET access_count = access_count + 1, last_accessed_at = NOW()
         WHERE id = $1 AND project_path = $2`, [idArg, projectPath]);
            const memory = result.rows[0];
            return {
                success: true,
                message: 'Memory recalled',
                data: {
                    id: memory.id,
                    content: memory.content,
                    memoryType: memory.memory_type,
                    importance: memory.importance,
                    tags: memory.tags,
                    metadata: memory.metadata,
                    createdAt: memory.created_at,
                    updatedAt: memory.updated_at,
                    accessCount: memory.access_count + 1
                }
            };
        }
        // list recent memories
        // PROJECT ISOLATED: Only list from current project
        const projectPath = getProjectPathForInsert();
        const limit = parseInt(parsed.flags.get('limit') ?? '10', 10);
        const tags = parsed.flags.get('tags')?.split(',');
        let query = `SELECT * FROM memories WHERE project_path = $1`;
        const params = [projectPath];
        let paramIndex = 2;
        if (tags && tags.length > 0) {
            query += ` AND tags && $${paramIndex}`;
            params.push(tags);
            paramIndex++;
        }
        query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
        params.push(limit);
        const result = await this.db.query(query, params);
        return {
            success: true,
            message: `Retrieved ${result.rows.length} memories`,
            data: {
                memories: result.rows.map((row) => ({
                    id: row.id,
                    content: row.content.slice(0, 150) + (row.content.length > 150 ? '...' : ''),
                    tags: row.tags,
                    importance: row.importance,
                    createdAt: row.created_at
                }))
            }
        };
    }
    /**
     * Handle /memory delete
     * PROJECT ISOLATED: Only deletes from current project
     */
    async handleDelete(args) {
        const parsed = this.parseArgs(args);
        const projectPath = getProjectPathForInsert();
        // check if first arg is an ID
        const idArg = args[0];
        const isUuid = idArg && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idArg);
        if (isUuid) {
            // PROJECT ISOLATED: Only delete from current project
            const result = await this.db.query(`DELETE FROM memories WHERE id = $1 AND project_path = $2 RETURNING id`, [idArg, projectPath]);
            if (result.rows.length === 0) {
                return {
                    success: false,
                    message: `Memory ${idArg} not found in project - maybe already yeeted or belongs to another project?`
                };
            }
            return {
                success: true,
                message: `Memory ${idArg} deleted - yeah nah deleted that fr`,
                data: { deletedId: idArg }
            };
        }
        // delete by criteria
        const tags = parsed.flags.get('tags')?.split(',');
        const olderThan = parsed.flags.get('older-than');
        const expiredOnly = parsed.flags.has('expired');
        if (!tags && !olderThan && !expiredOnly) {
            return {
                success: false,
                message: 'No deletion criteria provided - need an ID, --tags, --older-than, or --expired',
                suggestions: [
                    '/memory delete <id>',
                    '/memory delete --tags temp',
                    '/memory delete --expired'
                ]
            };
        }
        // PROJECT ISOLATED: Always filter by project_path
        let query = `DELETE FROM memories WHERE project_path = $1`;
        const params = [projectPath];
        let paramIndex = 2;
        if (tags && tags.length > 0) {
            query += ` AND tags && $${paramIndex}`;
            params.push(tags);
            paramIndex++;
        }
        if (olderThan) {
            const days = parseInt(olderThan.replace('d', ''), 10);
            query += ` AND created_at < NOW() - INTERVAL '${days} days'`;
        }
        if (expiredOnly) {
            query += ` AND expires_at IS NOT NULL AND expires_at < NOW()`;
        }
        query += ` RETURNING id`;
        const result = await this.db.query(query, params);
        return {
            success: true,
            message: `Deleted ${result.rows.length} memories - yeeted them all fr`,
            data: {
                deletedCount: result.rows.length,
                deletedIds: result.rows.map((r) => r.id)
            }
        };
    }
    /**
     * Handle /memory stats
     * PROJECT ISOLATED: Stats are scoped to current project
     */
    async handleStats(_args) {
        try {
            const projectPath = getProjectPathForInsert();
            const stats = await this.db.query(`
        SELECT
          COUNT(*) as total_memories,
          COUNT(DISTINCT unnest(tags)) as unique_tags,
          AVG(access_count)::numeric(10,2) as avg_access_count,
          COUNT(CASE WHEN image_data IS NOT NULL THEN 1 END) as memories_with_images,
          COUNT(CASE WHEN expires_at IS NOT NULL AND expires_at < NOW() THEN 1 END) as expired_memories,
          COUNT(CASE WHEN memory_type = 'consolidated' THEN 1 END) as consolidated_memories,
          MIN(created_at) as oldest_memory,
          MAX(created_at) as newest_memory,
          pg_size_pretty(pg_total_relation_size('memories')) as table_size
        FROM memories
        WHERE project_path = $1
      `, [projectPath]);
            const typeDistribution = await this.db.query(`
        SELECT memory_type, COUNT(*) as count
        FROM memories
        WHERE project_path = $1
        GROUP BY memory_type
        ORDER BY count DESC
      `, [projectPath]);
            const importanceDistribution = await this.db.query(`
        SELECT importance, COUNT(*) as count
        FROM memories
        WHERE project_path = $1
        GROUP BY importance
        ORDER BY count DESC
      `, [projectPath]);
            const topTags = await this.db.query(`
        SELECT tag, COUNT(*) as count
        FROM (SELECT unnest(tags) as tag FROM memories WHERE project_path = $1) t
        GROUP BY tag
        ORDER BY count DESC
        LIMIT 10
      `, [projectPath]);
            const row = stats.rows[0];
            return {
                success: true,
                message: 'Memory statistics retrieved',
                data: {
                    totalMemories: parseInt(row.total_memories),
                    uniqueTags: parseInt(row.unique_tags),
                    avgAccessCount: parseFloat(row.avg_access_count ?? '0'),
                    memoriesWithImages: parseInt(row.memories_with_images),
                    expiredMemories: parseInt(row.expired_memories),
                    consolidatedMemories: parseInt(row.consolidated_memories),
                    oldestMemory: row.oldest_memory,
                    newestMemory: row.newest_memory,
                    tableSize: row.table_size,
                    typeDistribution: typeDistribution.rows.reduce((acc, r) => {
                        acc[r.memory_type] = parseInt(r.count);
                        return acc;
                    }, {}),
                    importanceDistribution: importanceDistribution.rows.reduce((acc, r) => {
                        acc[r.importance] = parseInt(r.count);
                        return acc;
                    }, {}),
                    topTags: topTags.rows.map((r) => ({ tag: r.tag, count: parseInt(r.count) }))
                }
            };
        }
        catch (error) {
            logger.error({ error }, 'memory stats command failed');
            return {
                success: false,
                message: `Failed to get stats: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /memory update
     */
    async handleUpdate(args) {
        const idArg = args[0];
        if (!idArg || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idArg)) {
            return {
                success: false,
                message: 'Valid memory ID required',
                suggestions: ['/memory update <uuid> --importance high']
            };
        }
        const parsed = this.parseArgs(args.slice(1));
        const updates = [];
        const params = [idArg];
        let paramIndex = 2;
        if (parsed.flags.has('content') || parsed.content) {
            const content = parsed.flags.get('content') ?? parsed.content;
            updates.push(`content = $${paramIndex}`);
            params.push(content);
            paramIndex++;
            // regenerate embedding
            const embedding = await this.embeddingProvider.generateEmbedding(content);
            updates.push(`embedding = $${paramIndex}::vector`);
            params.push(`[${embedding.join(',')}]`);
            paramIndex++;
        }
        if (parsed.flags.has('tags')) {
            updates.push(`tags = $${paramIndex}`);
            params.push(parsed.flags.get('tags').split(','));
            paramIndex++;
        }
        if (parsed.flags.has('importance')) {
            updates.push(`importance = $${paramIndex}`);
            params.push(parsed.flags.get('importance'));
            paramIndex++;
        }
        if (updates.length === 0) {
            return {
                success: false,
                message: 'No updates provided - what should I change fr?',
                suggestions: ['/memory update <id> --content "new content"', '/memory update <id> --importance high']
            };
        }
        const result = await this.db.query(`UPDATE memories SET ${updates.join(', ')} WHERE id = $1 RETURNING id, content, tags, importance`, params);
        if (result.rows.length === 0) {
            return {
                success: false,
                message: `Memory ${idArg} not found`
            };
        }
        const memory = result.rows[0];
        return {
            success: true,
            message: `Memory ${idArg} updated`,
            data: {
                id: memory.id,
                content: memory.content.slice(0, 100) + (memory.content.length > 100 ? '...' : ''),
                tags: memory.tags,
                importance: memory.importance
            }
        };
    }
    /**
     * Parse args with flags
     */
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
    /**
     * Get help text for this category
     */
    getHelp() {
        const lines = [
            '### Memory Commands',
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
//# sourceMappingURL=memoryCommands.js.map