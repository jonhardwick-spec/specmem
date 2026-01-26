/**
 * exportProjectMemories - export memories from current project to JSON
 *
 * dumps memories from the current project schema so you can
 * back them up, share them, or import them elsewhere
 */
import { logger } from '../../utils/logger.js';
import { getProjectPathForInsert } from '../../services/ProjectContext.js';

export class ExportProjectMemories {
    db;
    name = 'export_project_memories';
    description = 'Export memories from the current project to JSON. Use for backups, sharing, or transferring memories between machines. Returns JSON array of memories.';
    inputSchema = {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Optional semantic search query to filter which memories to export. If omitted, exports all (up to limit).'
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional tag filter - only export memories with these tags'
            },
            memoryTypes: {
                type: 'array',
                items: {
                    type: 'string',
                    enum: ['episodic', 'semantic', 'procedural', 'working', 'consolidated']
                },
                description: 'Optional memory type filter'
            },
            importance: {
                type: 'array',
                items: {
                    type: 'string',
                    enum: ['critical', 'high', 'medium', 'low', 'trivial']
                },
                description: 'Optional importance filter'
            },
            limit: {
                type: 'number',
                default: 500,
                minimum: 1,
                maximum: 50000,
                description: 'Max number of memories to export (default: 500)'
            },
            outputPath: {
                type: 'string',
                description: 'Optional file path to write JSON output. If omitted, returns in response.'
            },
            includeEmbeddings: {
                type: 'boolean',
                default: false,
                description: 'Include embedding vectors in export (large, usually not needed)'
            }
        },
        required: []
    };

    constructor(db) {
        this.db = db;
    }

    async execute(params) {
        const { query, tags, memoryTypes, importance, outputPath, includeEmbeddings = false } = params;
        const limit = Math.min(params.limit || 500, 50000);
        const startTime = Date.now();

        try {
            const currentSchema = this.db.getProjectSchemaName();
            const currentProjectPath = getProjectPathForInsert();

            logger.info({
                currentSchema,
                currentProjectPath,
                limit,
                query: query?.slice(0, 50),
                tags,
                outputPath
            }, 'Starting memory export');

            // Build query
            const conditions = [];
            const queryParams = [];
            let paramIndex = 1;

            if (tags && tags.length > 0) {
                conditions.push(`tags && $${paramIndex}::text[]`);
                queryParams.push(tags);
                paramIndex++;
            }

            if (memoryTypes && memoryTypes.length > 0) {
                conditions.push(`memory_type = ANY($${paramIndex}::text[])`);
                queryParams.push(memoryTypes);
                paramIndex++;
            }

            if (importance && importance.length > 0) {
                conditions.push(`importance = ANY($${paramIndex}::text[])`);
                queryParams.push(importance);
                paramIndex++;
            }

            const embedSelect = includeEmbeddings ? ', embedding' : '';
            let selectQuery;

            if (query) {
                // Semantic search - need embedding
                let embedding;
                try {
                    const embProvider = this.db._embeddingProvider || null;
                    if (embProvider) {
                        embedding = await embProvider.generateEmbedding(query);
                    }
                } catch (e) {
                    logger.warn({ error: e?.message }, 'Could not generate embedding for query filter');
                }

                if (embedding) {
                    conditions.push(`embedding IS NOT NULL`);
                    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
                    selectQuery = `
                        SELECT id, content, memory_type, importance, tags, metadata,
                               project_path, created_at, updated_at, expires_at,
                               1 - (embedding <=> $${paramIndex}::vector) as similarity
                               ${embedSelect}
                        FROM memories
                        ${whereClause}
                        ORDER BY embedding <=> $${paramIndex}::vector
                        LIMIT $${paramIndex + 1}
                    `;
                    queryParams.push(`[${embedding.join(',')}]`);
                    queryParams.push(limit);
                } else {
                    // Fallback to text search
                    conditions.push(`content ILIKE $${paramIndex}`);
                    queryParams.push(`%${query}%`);
                    paramIndex++;
                    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
                    selectQuery = `
                        SELECT id, content, memory_type, importance, tags, metadata,
                               project_path, created_at, updated_at, expires_at
                               ${embedSelect}
                        FROM memories
                        ${whereClause}
                        ORDER BY created_at DESC
                        LIMIT $${paramIndex}
                    `;
                    queryParams.push(limit);
                }
            } else {
                const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
                selectQuery = `
                    SELECT id, content, memory_type, importance, tags, metadata,
                           project_path, created_at, updated_at, expires_at
                           ${embedSelect}
                    FROM memories
                    ${whereClause}
                    ORDER BY created_at DESC
                    LIMIT $${paramIndex}
                `;
                queryParams.push(limit);
            }

            const result = await this.db.query(selectQuery, queryParams);
            const memories = result.rows.map(row => ({
                id: row.id,
                content: row.content,
                memory_type: row.memory_type,
                importance: row.importance,
                tags: row.tags,
                metadata: row.metadata,
                project_path: row.project_path,
                created_at: row.created_at,
                updated_at: row.updated_at,
                expires_at: row.expires_at,
                ...(row.similarity !== undefined ? { similarity: Math.round(row.similarity * 1000) / 1000 } : {}),
                ...(includeEmbeddings && row.embedding ? { embedding: row.embedding } : {})
            }));

            const duration = Date.now() - startTime;

            // Write to file if outputPath specified
            if (outputPath) {
                const fs = await import('fs');
                const exportData = {
                    exportedAt: new Date().toISOString(),
                    sourceProject: currentProjectPath,
                    sourceSchema: currentSchema,
                    totalExported: memories.length,
                    filters: { query, tags, memoryTypes, importance, limit },
                    memories
                };
                fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            exported: memories.length,
                            outputPath,
                            sourceSchema: currentSchema,
                            duration: `${duration}ms`,
                            fileSizeKB: Math.round(fs.statSync(outputPath).size / 1024)
                        }, null, 2)
                    }]
                };
            }

            // Return inline
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        exported: memories.length,
                        sourceProject: currentProjectPath,
                        sourceSchema: currentSchema,
                        duration: `${duration}ms`,
                        memories
                    }, null, 2)
                }]
            };

        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error({ error: errMsg }, 'Memory export failed');
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        error: 'Memory export failed',
                        details: errMsg
                    }, null, 2)
                }]
            };
        }
    }
}
