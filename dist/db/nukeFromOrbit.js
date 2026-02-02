// yoooo this file NUKES memories from existence
// handles deletions, expiration cleanup, bulk ops
// its the only way to be sure fr fr
// NOW WITH PROJECT ISOLATION - won't accidentally nuke other projects' data
import { logger } from '../utils/logger.js';
import { getProjectPathForInsert, getCurrentProjectPath } from '../services/ProjectContext.js';
/**
 * MemoryNuker - deletes memories with EXTREME PREJUDICE
 *
 * deletion modes:
 * - single: delete by id
 * - bulk: delete by criteria
 * - expired: cleanup old stuff
 * - cascade: delete with all relations
 * - purge: nuclear option - delete EVERYTHING
 */
export class MemoryNuker {
    pool;
    deletedCount = 0;
    constructor(pool) {
        this.pool = pool;
    }
    // DELETE SINGLE - removes one memory by id
    // PROJECT ISOLATED: Only deletes from current project unless crossProject is true
    async nukeOne(id, crossProject = false) {
        const start = Date.now();
        const projectPath = getProjectPathForInsert();
        // Project-scoped delete unless explicitly cross-project
        const result = crossProject
            ? await this.pool.queryWithSwag('DELETE FROM memories WHERE id = $1', [id])
            : await this.pool.queryWithSwag('DELETE FROM memories WHERE id = $1 AND project_path = $2', [id, projectPath]);
        const deleted = (result.rowCount ?? 0) > 0;
        const duration = Date.now() - start;
        if (deleted) {
            this.deletedCount++;
            logger.debug({ id, duration, projectPath, crossProject }, 'memory nuked successfully');
        }
        else {
            logger.debug({ id, duration, projectPath, crossProject }, 'memory not found in project - nothing to nuke');
        }
        return deleted;
    }
    // DELETE MULTIPLE - removes memories by list of ids
    // PROJECT ISOLATED: Only deletes from current project unless crossProject is true
    async nukeMany(ids, crossProject = false) {
        if (ids.length === 0) {
            return { deleted: 0, duration: 0 };
        }
        const start = Date.now();
        const projectPath = getProjectPathForInsert();
        // cascade will handle relations - project scoped unless explicitly cross-project
        const result = crossProject
            ? await this.pool.queryWithSwag('DELETE FROM memories WHERE id = ANY($1)', [ids])
            : await this.pool.queryWithSwag('DELETE FROM memories WHERE id = ANY($1) AND project_path = $2', [ids, projectPath]);
        const deleted = result.rowCount ?? 0;
        const duration = Date.now() - start;
        this.deletedCount += deleted;
        logger.info({
            requested: ids.length,
            deleted,
            duration,
            projectPath,
            crossProject
        }, 'bulk nuke complete');
        return { deleted, duration };
    }
    // DELETE BY CRITERIA - flexible bulk deletion
    // PROJECT ISOLATED: Scoped to current project unless crossProject is true
    async nukeByCriteria(opts) {
        const start = Date.now();
        const conditions = [];
        const values = [];
        let paramIndex = 1;
        const projectPath = getProjectPathForInsert();
        // PROJECT ISOLATION: Add project_path filter unless explicitly cross-project
        if (!opts.crossProject) {
            conditions.push(`project_path = $${paramIndex}`);
            values.push(projectPath);
            paramIndex++;
        }
        // by ids
        if (opts.ids?.length) {
            conditions.push(`id = ANY($${paramIndex})`);
            values.push(opts.ids);
            paramIndex++;
        }
        // by age
        if (opts.olderThan) {
            conditions.push(`created_at < $${paramIndex}`);
            values.push(opts.olderThan);
            paramIndex++;
        }
        // by type
        if (opts.memoryType) {
            conditions.push(`memory_type = $${paramIndex}`);
            values.push(opts.memoryType);
            paramIndex++;
        }
        // by importance
        if (opts.importance) {
            conditions.push(`importance = $${paramIndex}`);
            values.push(opts.importance);
            paramIndex++;
        }
        // by tags (any match)
        if (opts.tags?.length) {
            conditions.push(`tags && $${paramIndex}`);
            values.push(opts.tags);
            paramIndex++;
        }
        // only expired
        if (opts.expiredOnly) {
            conditions.push('expires_at IS NOT NULL AND expires_at < NOW()');
        }
        // For non-crossProject, we always have project_path condition
        // For crossProject, we need at least one other criteria
        if (opts.crossProject && conditions.length === 0) {
            throw new Error('at least one criteria required for cross-project deletion - cant just nuke everything accidentally');
        }
        const whereClause = conditions.join(' AND ');
        // dry run - just count
        if (opts.dryRun) {
            const countResult = await this.pool.queryWithSwag(`SELECT COUNT(*) as count FROM memories WHERE ${whereClause}`, values);
            const count = parseInt(countResult.rows[0]?.count ?? '0', 10);
            const duration = Date.now() - start;
            logger.info({
                dryRun: true,
                wouldDelete: count,
                duration,
                criteria: opts,
                projectPath,
                crossProject: opts.crossProject
            }, 'dry run complete - nothing actually deleted');
            return { deleted: count, duration };
        }
        // actual deletion
        const result = await this.pool.queryWithSwag(`DELETE FROM memories WHERE ${whereClause}`, values);
        const deleted = result.rowCount ?? 0;
        const duration = Date.now() - start;
        this.deletedCount += deleted;
        logger.info({
            deleted,
            duration,
            criteria: opts,
            projectPath,
            crossProject: opts.crossProject
        }, 'bulk nuke by criteria complete');
        return { deleted, duration };
    }
    // DELETE BY TAGS - removes all memories with specific tags
    // PROJECT ISOLATED: Scoped to current project unless crossProject is true
    async nukeByTags(tags, mode = 'ANY', crossProject = false) {
        const start = Date.now();
        const projectPath = getProjectPathForInsert();
        let query;
        if (crossProject) {
            if (mode === 'ANY') {
                query = 'DELETE FROM memories WHERE tags && $1';
            }
            else {
                query = 'DELETE FROM memories WHERE tags @> $1';
            }
        }
        else {
            // Project-scoped deletion
            if (mode === 'ANY') {
                query = 'DELETE FROM memories WHERE tags && $1 AND project_path = $2';
            }
            else {
                query = 'DELETE FROM memories WHERE tags @> $1 AND project_path = $2';
            }
        }
        const result = crossProject
            ? await this.pool.queryWithSwag(query, [tags])
            : await this.pool.queryWithSwag(query, [tags, projectPath]);
        const deleted = result.rowCount ?? 0;
        const duration = Date.now() - start;
        this.deletedCount += deleted;
        logger.info({ deleted, duration, tags, mode, projectPath, crossProject }, 'nuke by tags complete');
        return { deleted, duration };
    }
    // DELETE EXPIRED - cleanup old memories
    // PROJECT ISOLATED: Scoped to current project unless crossProject is true
    async nukeExpired(crossProject = false) {
        const start = Date.now();
        const projectPath = getProjectPathForInsert();
        const result = crossProject
            ? await this.pool.queryWithSwag('DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < NOW()')
            : await this.pool.queryWithSwag('DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < NOW() AND project_path = $1', [projectPath]);
        const deleted = result.rowCount ?? 0;
        const duration = Date.now() - start;
        this.deletedCount += deleted;
        logger.info({ deleted, duration, projectPath, crossProject }, 'expired memories nuked');
        return { deleted, duration };
    }
    // DELETE RELATIONS - removes relations for a memory
    async nukeRelationsFor(memoryId) {
        const start = Date.now();
        const result = await this.pool.queryWithSwag('DELETE FROM memory_relations WHERE source_id = $1 OR target_id = $1', [memoryId]);
        const deleted = result.rowCount ?? 0;
        const duration = Date.now() - start;
        logger.debug({ memoryId, deleted, duration }, 'relations nuked');
        return { deleted, duration };
    }
    // DELETE SPECIFIC RELATION
    async nukeRelation(sourceId, targetId, relationType, bidirectional = true) {
        const start = Date.now();
        let deleted = 0;
        await this.pool.transactionGang(async (client) => {
            if (relationType) {
                const result = await client.query('DELETE FROM memory_relations WHERE source_id = $1 AND target_id = $2 AND relation_type = $3', [sourceId, targetId, relationType]);
                deleted += result.rowCount ?? 0;
                if (bidirectional) {
                    const reverseResult = await client.query('DELETE FROM memory_relations WHERE source_id = $1 AND target_id = $2 AND relation_type = $3', [targetId, sourceId, relationType]);
                    deleted += reverseResult.rowCount ?? 0;
                }
            }
            else {
                const result = await client.query('DELETE FROM memory_relations WHERE source_id = $1 AND target_id = $2', [sourceId, targetId]);
                deleted += result.rowCount ?? 0;
                if (bidirectional) {
                    const reverseResult = await client.query('DELETE FROM memory_relations WHERE source_id = $1 AND target_id = $2', [targetId, sourceId]);
                    deleted += reverseResult.rowCount ?? 0;
                }
            }
        });
        const duration = Date.now() - start;
        logger.debug({ sourceId, targetId, deleted, duration }, 'specific relations nuked');
        return { deleted, duration };
    }
    // FULL CLEANUP - removes orphans, expired, stale cache
    // PROJECT ISOLATED: Memory cleanup is project-scoped unless crossProject=true
    // Orphan cleanup (tags, relations, cache) is always global as it's a maintenance task
    async deepClean(crossProject = false) {
        const start = Date.now();
        const projectPath = getProjectPathForInsert();
        const result = {
            expiredDeleted: 0,
            orphanTagsDeleted: 0,
            orphanRelationsDeleted: 0,
            embeddingCachePurged: 0,
            duration: 0
        };
        logger.info({ projectPath, crossProject }, 'starting deep clean operation - hold up...');
        await this.pool.transactionGang(async (client) => {
            // 1. delete expired memories - project scoped unless crossProject
            const expiredResult = crossProject
                ? await client.query('DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < NOW()')
                : await client.query('DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < NOW() AND project_path = $1', [projectPath]);
            result.expiredDeleted = expiredResult.rowCount ?? 0;
            // 2. delete orphan tags (tags with no memories) - global maintenance task
            const orphanTagsResult = await client.query(`
        DELETE FROM tags
        WHERE id NOT IN (SELECT DISTINCT tag_id FROM memory_tags)
      `);
            result.orphanTagsDeleted = orphanTagsResult.rowCount ?? 0;
            // 3. delete orphan memory_tags (for memories that dont exist)
            // this shouldnt happen with cascades but just in case - global maintenance
            const orphanMemoryTagsResult = await client.query(`
        DELETE FROM memory_tags
        WHERE memory_id NOT IN (SELECT id FROM memories)
      `);
            // 4. orphan relations (shouldnt exist with cascade but check anyway) - global maintenance
            const orphanRelationsResult = await client.query(`
        DELETE FROM memory_relations
        WHERE source_id NOT IN (SELECT id FROM memories)
           OR target_id NOT IN (SELECT id FROM memories)
      `);
            result.orphanRelationsDeleted = orphanRelationsResult.rowCount ?? 0;
            // 5. purge old embedding cache entries (unused for 30 days) - global maintenance
            const cacheResult = await client.query(`
        DELETE FROM embedding_cache
        WHERE last_used_at < NOW() - INTERVAL '30 days'
      `);
            result.embeddingCachePurged = cacheResult.rowCount ?? 0;
        });
        result.duration = Date.now() - start;
        logger.info({
            ...result,
            projectPath,
            crossProject
        }, 'deep clean complete - everything is fresh now');
        return result;
    }
    // VACUUM - reclaim disk space after deletions
    async vacuum(full = false) {
        const start = Date.now();
        if (full) {
            // VACUUM FULL is slow but reclaims the most space
            // cant run in transaction
            await this.pool.queryWithSwag('VACUUM FULL ANALYZE memories');
            await this.pool.queryWithSwag('VACUUM FULL ANALYZE memory_relations');
            await this.pool.queryWithSwag('VACUUM FULL ANALYZE tags');
            await this.pool.queryWithSwag('VACUUM FULL ANALYZE memory_tags');
            await this.pool.queryWithSwag('VACUUM FULL ANALYZE embedding_cache');
        }
        else {
            // regular vacuum is faster
            await this.pool.queryWithSwag('VACUUM ANALYZE memories');
            await this.pool.queryWithSwag('VACUUM ANALYZE memory_relations');
            await this.pool.queryWithSwag('VACUUM ANALYZE tags');
        }
        const duration = Date.now() - start;
        logger.info({ full, duration }, 'vacuum complete - tables are clean');
    }
    // REINDEX - rebuild indexes after massive deletions
    async reindex() {
        const start = Date.now();
        // reindex can take a while but is worth it after big deletes
        await this.pool.queryWithSwag('REINDEX TABLE CONCURRENTLY memories');
        await this.pool.queryWithSwag('REINDEX TABLE CONCURRENTLY memory_relations');
        const duration = Date.now() - start;
        logger.info({ duration }, 'reindex complete - queries should be fast again');
    }
    // TRUNCATE - nuclear option, deletes EVERYTHING
    async thermonuclearOption(confirm) {
        if (confirm !== 'YES_NUKE_EVERYTHING_I_AM_SURE') {
            throw new Error('nah bruh you gotta confirm with the magic string - this deletes EVERYTHING');
        }
        const start = Date.now();
        logger.warn('THERMONUCLEAR OPTION ACTIVATED - deleting ALL memories');
        await this.pool.transactionGang(async (client) => {
            // order matters for foreign keys
            await client.query('TRUNCATE TABLE memory_relations CASCADE');
            await client.query('TRUNCATE TABLE memory_tags CASCADE');
            await client.query('TRUNCATE TABLE consolidation_history CASCADE');
            await client.query('TRUNCATE TABLE embedding_cache CASCADE');
            await client.query('TRUNCATE TABLE tags CASCADE');
            await client.query('TRUNCATE TABLE memories CASCADE');
        });
        const duration = Date.now() - start;
        logger.warn({ duration }, 'THERMONUCLEAR COMPLETE - everything is gone');
    }
    // MARK AS EXPIRED - soft delete by setting expiration
    // PROJECT ISOLATED: Only marks memories in current project unless crossProject is true
    async markExpired(ids, crossProject = false) {
        if (ids.length === 0)
            return 0;
        const projectPath = getProjectPathForInsert();
        const result = crossProject
            ? await this.pool.queryWithSwag('UPDATE memories SET expires_at = NOW() WHERE id = ANY($1) AND (expires_at IS NULL OR expires_at > NOW())', [ids])
            : await this.pool.queryWithSwag('UPDATE memories SET expires_at = NOW() WHERE id = ANY($1) AND (expires_at IS NULL OR expires_at > NOW()) AND project_path = $2', [ids, projectPath]);
        const marked = result.rowCount ?? 0;
        logger.debug({ marked, total: ids.length, projectPath, crossProject }, 'memories marked as expired');
        return marked;
    }
    // ARCHIVE - move to archive table (keeps data but out of main queries)
    // PROJECT ISOLATED: Only archives memories from current project unless crossProject is true
    async archiveOldMemories(olderThanDays, crossProject = false) {
        const start = Date.now();
        const projectPath = getProjectPathForInsert();
        // first ensure archive table exists
        await this.pool.queryWithSwag(`
      CREATE TABLE IF NOT EXISTS memories_archive (
        LIKE memories INCLUDING ALL,
        archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
        // move old memories - project scoped unless crossProject
        await this.pool.transactionGang(async (client) => {
            if (crossProject) {
                // insert into archive
                await client.query(`
          INSERT INTO memories_archive
          SELECT *, NOW() as archived_at
          FROM memories
          WHERE created_at < NOW() - INTERVAL '${olderThanDays} days'
            AND importance NOT IN ('critical', 'high')
        `);
                // delete from main table
                await client.query(`
          DELETE FROM memories
          WHERE created_at < NOW() - INTERVAL '${olderThanDays} days'
            AND importance NOT IN ('critical', 'high')
        `);
            }
            else {
                // Project-scoped archive
                await client.query(`
          INSERT INTO memories_archive
          SELECT *, NOW() as archived_at
          FROM memories
          WHERE created_at < NOW() - INTERVAL '${olderThanDays} days'
            AND importance NOT IN ('critical', 'high')
            AND project_path = $1
        `, [projectPath]);
                // delete from main table
                await client.query(`
          DELETE FROM memories
          WHERE created_at < NOW() - INTERVAL '${olderThanDays} days'
            AND importance NOT IN ('critical', 'high')
            AND project_path = $1
        `, [projectPath]);
            }
        });
        // count whats in archive
        const countResult = await this.pool.queryWithSwag(`SELECT COUNT(*) as count FROM memories_archive
       WHERE archived_at > NOW() - INTERVAL '1 minute'`);
        const archived = parseInt(countResult.rows[0]?.count ?? '0', 10);
        const duration = Date.now() - start;
        logger.info({
            archived,
            olderThanDays,
            duration,
            projectPath,
            crossProject
        }, 'memories archived successfully');
        return { deleted: archived, duration };
    }
    // GET DELETION STATS
    getStats() {
        return {
            totalDeleted: this.deletedCount
        };
    }
    // PREVIEW - shows what would be deleted without doing it
    // PROJECT ISOLATED: Only previews current project unless crossProject is true
    async previewNuke(opts) {
        const conditions = [];
        const values = [];
        let paramIndex = 1;
        const projectPath = getProjectPathForInsert();
        // PROJECT ISOLATION: Add project_path filter unless explicitly cross-project
        if (!opts.crossProject) {
            conditions.push(`project_path = $${paramIndex}`);
            values.push(projectPath);
            paramIndex++;
        }
        if (opts.ids?.length) {
            conditions.push(`id = ANY($${paramIndex})`);
            values.push(opts.ids);
            paramIndex++;
        }
        if (opts.olderThan) {
            conditions.push(`created_at < $${paramIndex}`);
            values.push(opts.olderThan);
            paramIndex++;
        }
        if (opts.memoryType) {
            conditions.push(`memory_type = $${paramIndex}`);
            values.push(opts.memoryType);
            paramIndex++;
        }
        if (opts.importance) {
            conditions.push(`importance = $${paramIndex}`);
            values.push(opts.importance);
            paramIndex++;
        }
        if (opts.tags?.length) {
            conditions.push(`tags && $${paramIndex}`);
            values.push(opts.tags);
            paramIndex++;
        }
        if (opts.expiredOnly) {
            conditions.push('expires_at IS NOT NULL AND expires_at < NOW()');
        }
        // For non-crossProject, we always have project_path condition
        if (conditions.length === 0) {
            return { count: 0, sampleIds: [] };
        }
        const whereClause = conditions.join(' AND ');
        const countResult = await this.pool.queryWithSwag(`SELECT COUNT(*) as count FROM memories WHERE ${whereClause}`, values);
        const sampleResult = await this.pool.queryWithSwag(`SELECT id FROM memories WHERE ${whereClause} LIMIT 10`, values);
        return {
            count: parseInt(countResult.rows[0]?.count ?? '0', 10),
            sampleIds: sampleResult.rows.map((r) => r.id)
        };
    }
}
// per-project Map pattern - each project gets its own nuker to avoid cross-project nuking fr
const nukerInstancesByProject = new Map();
export function getTheNuker(pool, projectPath) {
    const targetProject = projectPath || getCurrentProjectPath();
    if (!nukerInstancesByProject.has(targetProject) && !pool) {
        throw new Error(`nuker not initialized for project ${targetProject} - pass pool first`);
    }
    if (!nukerInstancesByProject.has(targetProject) && pool) {
        nukerInstancesByProject.set(targetProject, new MemoryNuker(pool));
        logger.debug(`[Nuker] Created memory nuker for project: ${targetProject}`);
    }
    return nukerInstancesByProject.get(targetProject);
}
export function resetTheNuker(projectPath) {
    if (projectPath) {
        nukerInstancesByProject.delete(projectPath);
        logger.debug(`[Nuker] Reset nuker for project: ${projectPath}`);
    }
    else {
        // reset current project only
        const currentProject = getCurrentProjectPath();
        nukerInstancesByProject.delete(currentProject);
        logger.debug(`[Nuker] Reset nuker for current project: ${currentProject}`);
    }
}
export function resetAllNukers() {
    nukerInstancesByProject.clear();
    logger.debug('[Nuker] Reset all nukers');
}
//# sourceMappingURL=nukeFromOrbit.js.map