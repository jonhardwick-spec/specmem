/**
 * yeahNahDeleteThat - yeet memories we dont need
 *
 * delete memories by ID, criteria, or expired status
 * handles cascading deletes for relations too
 *
 * Now integrated with LWJEB event bus for memory:deleted events
 * NOW WITH PROJECT ISOLATION - won't accidentally nuke other projects' data
 */
import { logger } from '../../utils/logger.js';
import { getCoordinator } from '../../coordination/integration.js';
import { getProjectPathForInsert } from '../../services/ProjectContext.js';
import { formatHumanReadable } from '../../utils/humanReadableOutput.js';
/**
 * YeahNahDeleteThat - memory deletion tool
 *
 * nice try lmao - but fr we validate everything
 * supports batch deletes and cleanup operations
 *
 * Emits LWJEB events: memory:deleted
 */
export class YeahNahDeleteThat {
    db;
    name = 'remove_memory';
    description = 'Delete memories by ID, criteria, or expired status - handles bulk deletes and cleanup';
    coordinator = getCoordinator();
    inputSchema = {
        type: 'object',
        properties: {
            id: {
                type: 'string',
                format: 'uuid',
                description: 'specific memory ID to delete'
            },
            ids: {
                type: 'array',
                items: { type: 'string', format: 'uuid' },
                description: 'multiple memory IDs to delete'
            },
            olderThan: {
                type: 'string',
                format: 'date-time',
                description: 'delete memories older than this timestamp'
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'delete memories with these tags'
            },
            expiredOnly: {
                type: 'boolean',
                default: false,
                description: 'only delete expired memories'
            }
        }
    };
    constructor(db) {
        this.db = db;
    }
    async execute(params) {
        logger.debug({ params }, 'deleting memories');
        try {
            // gotta have at least one criterion fr
            if (!params.id && !params.ids?.length && !params.olderThan && !params.tags?.length && !params.expiredOnly) {
                const humanReadableData = [{
                        id: 'deletion-error',
                        similarity: 1.0,
                        content: '[ERROR] need at least one deletion criterion - cant just delete everything lmao',
                    }];
                return formatHumanReadable('remove_memory', humanReadableData, {
                    grey: true,
                    maxContentLength: 500
                });
            }
            // delete by single ID
            if (params.id) {
                return await this.deleteById(params.id);
            }
            // delete by multiple IDs
            if (params.ids?.length) {
                return await this.deleteByIds(params.ids);
            }
            // delete by criteria
            return await this.deleteByCriteria(params);
        }
        catch (error) {
            logger.error({ error, params }, 'delete failed');
            const humanReadableData = [{
                    id: 'deletion-error',
                    similarity: 1.0,
                    content: `[ERROR] ${error instanceof Error ? error.message : 'delete failed for unknown reason'}`,
                }];
            return formatHumanReadable('remove_memory', humanReadableData, {
                grey: true,
                maxContentLength: 500
            });
        }
    }
    /**
     * delete a single memory by ID
     * PROJECT ISOLATED: Only deletes from current project
     */
    async deleteById(id) {
        const projectPath = getProjectPathForInsert();
        const result = await this.db.query(`DELETE FROM memories WHERE id = $1 AND project_path = $2 RETURNING id`, [id, projectPath]);
        if (result.rows.length === 0) {
            const humanReadableData = [{
                    id: 'deletion-error',
                    similarity: 1.0,
                    content: `[ERROR] memory ${id} not found in project - maybe already deleted or belongs to another project?`,
                }];
            return formatHumanReadable('remove_memory', humanReadableData, {
                grey: true,
                maxContentLength: 500
            });
        }
        // Emit memory:deleted event via LWJEB
        this.coordinator.emitMemoryDeleted(id);
        logger.info({ id, projectPath }, 'memory deleted');
        const humanReadableData = [{
                id: 'deletion-result',
                similarity: 1.0,
                content: `[DELETED] 1 memory removed. yeeted memory ${id} into the void`,
            }];
        return formatHumanReadable('remove_memory', humanReadableData, {
            grey: true,
            maxContentLength: 500
        });
    }
    /**
     * delete multiple memories by IDs
     * PROJECT ISOLATED: Only deletes from current project
     *
     * uses batch delete for efficiency
     */
    async deleteByIds(ids) {
        // validate UUIDs
        const validIds = ids.filter(id => this.isValidUuid(id));
        if (validIds.length === 0) {
            const humanReadableData = [{
                    id: 'deletion-error',
                    similarity: 1.0,
                    content: '[ERROR] no valid UUIDs provided',
                }];
            return formatHumanReadable('remove_memory', humanReadableData, {
                grey: true,
                maxContentLength: 500
            });
        }
        const projectPath = getProjectPathForInsert();
        const result = await this.db.query(`DELETE FROM memories WHERE id = ANY($1::uuid[]) AND project_path = $2 RETURNING id`, [validIds, projectPath]);
        const deletedIds = result.rows.map((r) => r.id);
        // Emit memory:deleted events via LWJEB for each deleted memory
        for (const id of deletedIds) {
            this.coordinator.emitMemoryDeleted(id);
        }
        logger.info({ count: deletedIds.length, projectPath }, 'batch delete complete');
        const humanReadableData = [{
                id: 'deletion-result',
                similarity: 1.0,
                content: `[DELETED] ${deletedIds.length} memories removed. yeeted ${deletedIds.length} memories`,
            }];
        return formatHumanReadable('remove_memory', humanReadableData, {
            grey: true,
            maxContentLength: 500
        });
    }
    /**
     * delete by criteria (tags, age, expired status)
     * PROJECT ISOLATED: Only deletes from current project
     */
    async deleteByCriteria(params) {
        const conditions = [];
        const queryParams = [];
        let paramIndex = 1;
        // PROJECT ISOLATION: Always filter by project_path
        const projectPath = getProjectPathForInsert();
        conditions.push(`project_path = $${paramIndex}`);
        queryParams.push(projectPath);
        paramIndex++;
        // expired only
        if (params.expiredOnly) {
            conditions.push('expires_at IS NOT NULL AND expires_at <= NOW()');
        }
        // older than
        if (params.olderThan) {
            conditions.push(`created_at < $${paramIndex}::timestamptz`);
            queryParams.push(params.olderThan);
            paramIndex++;
        }
        // by tags
        if (params.tags?.length) {
            conditions.push(`tags && $${paramIndex}::text[]`);
            queryParams.push(params.tags);
            paramIndex++;
        }
        // We always have project_path, but need at least one other criterion
        if (conditions.length === 1) {
            const humanReadableData = [{
                    id: 'deletion-error',
                    similarity: 1.0,
                    content: '[ERROR] no valid criteria provided (besides project filter)',
                }];
            return formatHumanReadable('remove_memory', humanReadableData, {
                grey: true,
                maxContentLength: 500
            });
        }
        const query = `
      DELETE FROM memories
      WHERE ${conditions.join(' AND ')}
      RETURNING id
    `;
        const result = await this.db.query(query, queryParams);
        const deletedIds = result.rows.map((r) => r.id);
        // Emit memory:deleted events via LWJEB for each deleted memory
        for (const id of deletedIds) {
            this.coordinator.emitMemoryDeleted(id);
        }
        logger.info({ count: deletedIds.length, criteria: conditions, projectPath }, 'criteria-based delete complete');
        const humanReadableData = [{
                id: 'deletion-result',
                similarity: 1.0,
                content: `[DELETED] ${deletedIds.length} memories removed. yeeted ${deletedIds.length} memories matching criteria`,
            }];
        return formatHumanReadable('remove_memory', humanReadableData, {
            grey: true,
            maxContentLength: 500
        });
    }
    /**
     * cleanup expired memories - scheduled task style
     * PROJECT ISOLATED: Only cleans up current project's expired memories
     *
     * call this periodically to keep the db clean
     */
    async cleanupExpired() {
        const projectPath = getProjectPathForInsert();
        const result = await this.db.query(`DELETE FROM memories
       WHERE expires_at IS NOT NULL
         AND expires_at <= NOW()
         AND project_path = $1
       RETURNING id`, [projectPath]);
        const deletedIds = result.rows.map((r) => r.id);
        logger.info({ count: deletedIds.length, projectPath }, 'expired memories cleaned up');
        const humanReadableData = [{
                id: 'deletion-result',
                similarity: 1.0,
                content: `[DELETED] ${deletedIds.length} memories removed. cleaned up ${deletedIds.length} expired memories`,
            }];
        return formatHumanReadable('remove_memory', humanReadableData, {
            grey: true,
            maxContentLength: 500
        });
    }
    /**
     * delete orphaned relations
     *
     * cleanup relations where source or target no longer exists
     */
    async cleanupOrphanedRelations() {
        // the foreign key CASCADE should handle this, but just in case
        const result = await this.db.query(`WITH deleted AS (
         DELETE FROM memory_relations mr
         WHERE NOT EXISTS (SELECT 1 FROM memories m WHERE m.id = mr.source_id)
            OR NOT EXISTS (SELECT 1 FROM memories m WHERE m.id = mr.target_id)
         RETURNING 1
       )
       SELECT COUNT(*) as count FROM deleted`);
        const count = parseInt(result.rows[0]?.count ?? '0', 10);
        if (count > 0) {
            logger.info({ count }, 'orphaned relations cleaned up');
        }
        return count;
    }
    /**
     * delete consolidated source memories
     * PROJECT ISOLATED: Only deletes from current project
     *
     * after consolidation, we can optionally remove the originals
     */
    async deleteConsolidatedSources(consolidatedId) {
        const projectPath = getProjectPathForInsert();
        // get the source memory IDs from the consolidated memory (only if in same project)
        const consolidated = await this.db.query(`SELECT consolidated_from FROM memories WHERE id = $1 AND project_path = $2`, [consolidatedId, projectPath]);
        if (!consolidated.rows[0]?.consolidated_from?.length) {
            const humanReadableData = [{
                    id: 'deletion-error',
                    similarity: 1.0,
                    content: '[ERROR] no source memories found for this consolidated memory in current project',
                }];
            return formatHumanReadable('remove_memory', humanReadableData, {
                grey: true,
                maxContentLength: 500
            });
        }
        const sourceIds = consolidated.rows[0].consolidated_from;
        const result = await this.db.query(`DELETE FROM memories
       WHERE id = ANY($1::uuid[])
         AND id != $2
         AND project_path = $3
       RETURNING id`, [sourceIds, consolidatedId, projectPath]);
        const deletedIds = result.rows.map((r) => r.id);
        const humanReadableData = [{
                id: 'deletion-result',
                similarity: 1.0,
                content: `[DELETED] ${deletedIds.length} memories removed. deleted ${deletedIds.length} source memories after consolidation`,
            }];
        return formatHumanReadable('remove_memory', humanReadableData, {
            grey: true,
            maxContentLength: 500
        });
    }
    isValidUuid(str) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return uuidRegex.test(str);
    }
}
//# sourceMappingURL=yeahNahDeleteThat.js.map