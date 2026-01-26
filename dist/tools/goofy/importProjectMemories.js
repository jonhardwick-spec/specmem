/**
 * importProjectMemories - import memories from another project schema
 *
 * copies memories from project A into the current project
 * so you can carry context across projects fr fr
 */
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import { getProjectSchema } from '../../db/projectNamespacing.js';
import { getProjectPathForInsert } from '../../services/ProjectContext.js';
import { formatHumanReadable } from '../../utils/humanReadableOutput.js';

export class ImportProjectMemories {
    db;
    embeddingProvider;
    name = 'import_project_memories';
    description = 'Import memories from another project into the current project. Use this to carry context across projects - e.g. import /specmem memories into /AEGIS_AI.';
    inputSchema = {
        type: 'object',
        properties: {
            sourceProject: {
                type: 'string',
                description: 'Absolute path of the source project to import from (e.g. "/specmem", "/AEGIS_AI")'
            },
            query: {
                type: 'string',
                description: 'Optional semantic search query to filter which memories to import. If omitted, imports all (up to limit).'
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional tag filter - only import memories with these tags'
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
                default: 100,
                minimum: 1,
                maximum: 1000,
                description: 'Max number of memories to import (default: 100)'
            },
            dryRun: {
                type: 'boolean',
                default: false,
                description: 'Preview what would be imported without actually importing'
            }
        },
        required: ['sourceProject']
    };

    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
    }

    async execute(params) {
        const { sourceProject, query, tags, memoryTypes, importance, dryRun = false } = params;
        const limit = Math.min(params.limit || 100, 1000);
        const startTime = Date.now();

        try {
            // Get schema names
            const sourceSchema = getProjectSchema(sourceProject);
            const currentSchema = this.db.getProjectSchemaName();
            const currentProjectPath = getProjectPathForInsert();

            logger.info({
                sourceProject,
                sourceSchema,
                currentSchema,
                limit,
                dryRun,
                query: query?.slice(0, 50),
                tags
            }, 'Starting memory import');

            // Verify source schema exists
            const schemaCheck = await this.db.query(
                `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
                [sourceSchema]
            );

            if (schemaCheck.rows.length === 0) {
                // List available schemas for helpful error
                const available = await this.db.query(
                    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'specmem_%' ORDER BY schema_name`
                );
                const schemaList = available.rows.map(r => r.schema_name).join(', ');
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            error: `Source schema '${sourceSchema}' not found`,
                            sourceProject,
                            availableSchemas: schemaList || 'none',
                            hint: 'Make sure the source project path is correct and has been used with SpecMem before'
                        }, null, 2)
                    }]
                };
            }

            // Build query to fetch memories from source schema
            const conditions = [];
            const queryParams = [];
            let paramIndex = 1;

            // Filter by tags
            if (tags && tags.length > 0) {
                conditions.push(`tags && $${paramIndex}::text[]`);
                queryParams.push(tags);
                paramIndex++;
            }

            // Filter by memory types
            if (memoryTypes && memoryTypes.length > 0) {
                conditions.push(`memory_type = ANY($${paramIndex}::text[])`);
                queryParams.push(memoryTypes);
                paramIndex++;
            }

            // Filter by importance
            if (importance && importance.length > 0) {
                conditions.push(`importance = ANY($${paramIndex}::text[])`);
                queryParams.push(importance);
                paramIndex++;
            }

            // Build the SELECT query against source schema
            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

            let selectQuery;
            if (query && this.embeddingProvider) {
                // Semantic search - generate embedding for query, order by similarity
                const embedding = await this.embeddingProvider.generateEmbedding(query);
                const embeddingStr = `[${embedding.join(',')}]`;
                queryParams.push(embeddingStr);
                selectQuery = `
                    SELECT id, content, memory_type, importance, tags, metadata,
                           embedding, role, created_at, updated_at, expires_at,
                           1 - (embedding <=> $${paramIndex}::vector) as similarity
                    FROM "${sourceSchema}".memories
                    ${whereClause}
                    ORDER BY embedding <=> $${paramIndex}::vector
                    LIMIT ${limit}
                `;
                paramIndex++;
            } else {
                selectQuery = `
                    SELECT id, content, memory_type, importance, tags, metadata,
                           embedding, role, created_at, updated_at, expires_at
                    FROM "${sourceSchema}".memories
                    ${whereClause}
                    ORDER BY created_at DESC
                    LIMIT ${limit}
                `;
            }

            const sourceMemories = await this.db.query(selectQuery, queryParams);

            if (sourceMemories.rows.length === 0) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            result: 'No memories found matching criteria in source project',
                            sourceProject,
                            sourceSchema,
                            filters: { tags, memoryTypes, importance, query: query?.slice(0, 50) }
                        }, null, 2)
                    }]
                };
            }

            // Dry run - just show what would be imported
            if (dryRun) {
                const preview = sourceMemories.rows.slice(0, 10).map(m => ({
                    content: m.content?.slice(0, 100) + (m.content?.length > 100 ? '...' : ''),
                    type: m.memory_type,
                    importance: m.importance,
                    tags: m.tags,
                    similarity: m.similarity ? Math.round(m.similarity * 100) + '%' : undefined,
                    created: m.created_at
                }));

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            dryRun: true,
                            wouldImport: sourceMemories.rows.length,
                            sourceProject,
                            sourceSchema,
                            targetSchema: currentSchema,
                            preview,
                            previewNote: sourceMemories.rows.length > 10
                                ? `Showing 10 of ${sourceMemories.rows.length} memories`
                                : undefined
                        }, null, 2)
                    }]
                };
            }

            // Actually import - insert into current schema with new UUIDs
            let imported = 0;
            let skipped = 0;
            const errors = [];

            for (const memory of sourceMemories.rows) {
                try {
                    const newId = randomUUID();
                    const importTag = `imported_from:${sourceProject}`;
                    const newTags = Array.isArray(memory.tags)
                        ? [...new Set([...memory.tags, importTag])]
                        : [importTag];

                    // Merge metadata with import info
                    const newMetadata = {
                        ...(memory.metadata || {}),
                        imported: {
                            from: sourceProject,
                            originalId: memory.id,
                            importedAt: new Date().toISOString()
                        }
                    };

                    // Check for duplicate content in target schema
                    const dupCheck = await this.db.query(
                        `SELECT id FROM memories WHERE content = $1 LIMIT 1`,
                        [memory.content]
                    );

                    if (dupCheck.rows.length > 0) {
                        skipped++;
                        continue;
                    }

                    // Insert into current schema
                    const insertQuery = `
                        INSERT INTO memories (
                            id, content, memory_type, importance, tags, metadata,
                            embedding, project_path, role, created_at, updated_at
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6,
                            $7, $8, $9, $10, $11
                        )
                    `;

                    await this.db.query(insertQuery, [
                        newId,
                        memory.content,
                        memory.memory_type || 'semantic',
                        memory.importance || 'medium',
                        newTags,
                        JSON.stringify(newMetadata),
                        memory.embedding, // preserve original embedding vector
                        currentProjectPath,
                        memory.role || 'user',
                        memory.created_at || new Date(),
                        new Date()
                    ]);

                    imported++;
                } catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    errors.push({ id: memory.id, error: errMsg });
                    logger.warn({ memoryId: memory.id, error: errMsg }, 'Failed to import memory');
                }
            }

            const duration = Date.now() - startTime;

            logger.info({
                imported,
                skipped,
                errors: errors.length,
                duration,
                sourceProject,
                sourceSchema,
                currentSchema
            }, 'Memory import completed');

            const result = {
                imported,
                skipped,
                errors: errors.length,
                total: sourceMemories.rows.length,
                sourceProject,
                sourceSchema,
                targetSchema: currentSchema,
                duration: `${duration}ms`
            };

            if (errors.length > 0 && errors.length <= 5) {
                result.errorDetails = errors;
            } else if (errors.length > 5) {
                result.errorDetails = errors.slice(0, 5);
                result.moreErrors = errors.length - 5;
            }

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }]
            };

        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error({ error: errMsg, sourceProject }, 'Memory import failed');
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        error: 'Memory import failed',
                        details: errMsg,
                        sourceProject
                    }, null, 2)
                }]
            };
        }
    }
}
