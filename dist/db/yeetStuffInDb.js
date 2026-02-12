// yooooo this file YEETS memories into postgres like NOTHING
// handles single inserts, batch inserts, upserts, all that
// skids cant handle this insert game no cap
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { setupMapCleanup } from '../utils/mapCleanup.js';
import { getProjectPathForInsert, getCurrentProjectPath } from '../services/ProjectContext.js';
/**
 * MemoryYeeter - throws memories into postgres at CRAZY speeds
 *
 * optimizations that go hard:
 * - batch inserts with transaction batching
 * - content hash deduplication
 * - embedding caching
 * - tag normalization
 * - prepared statements for repeat inserts
 */
export class MemoryYeeter {
    pool;
    insertCount = 0;
    duplicateCount = 0;
    constructor(pool) {
        this.pool = pool;
    }
    // yeets a single memory into the db
    async yeetOne(payload) {
        const start = Date.now();
        const id = uuidv4();
        logger.debug({ contentLength: payload.content.length }, 'yeeting memory into db');
        // check for duplicate first - content hash is computed by postgres
        const contentHash = await this.computeContentHash(payload.content);
        const existing = await this.findByContentHash(contentHash);
        if (existing) {
            logger.debug({ existingId: existing.id, contentHash }, 'duplicate detected - skipping');
            this.duplicateCount++;
            return {
                id: existing.id,
                contentHash,
                wasCreated: false,
                duration: Date.now() - start
            };
        }
        // prepare embedding for postgres
        const embeddingStr = payload.embedding
            ? `[${payload.embedding.join(',')}]`
            : null;
        // prepare image data as buffer
        const imageBuffer = payload.imageData
            ? Buffer.from(payload.imageData, 'base64')
            : null;
        // DYNAMIC PROJECT_PATH: Read at call time, not module load time
        const projectPath = getProjectPathForInsert();
        await this.pool.queryWithSwag(`INSERT INTO memories (
        id, content, memory_type, importance, tags, metadata,
        embedding, image_data, image_mime_type, expires_at, consolidated_from, project_path
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [
            id,
            payload.content,
            payload.memoryType,
            payload.importance,
            payload.tags,
            payload.metadata ?? {},
            embeddingStr,
            imageBuffer,
            payload.imageMimeType ?? null,
            payload.expiresAt ?? null,
            payload.consolidatedFrom ?? [],
            projectPath
        ]);
        // also sync to normalized tags table
        if (payload.tags.length > 0) {
            await this.syncTagsForMemory(id, payload.tags);
        }
        this.insertCount++;
        const duration = Date.now() - start;
        logger.debug({ id, duration, contentLength: payload.content.length }, 'memory yeeted successfully');
        return {
            id,
            contentHash,
            wasCreated: true,
            duration
        };
    }
    // yeets memory and returns full memory object
    async yeetAndReturn(payload) {
        const result = await this.yeetOne(payload);
        const memoryResult = await this.pool.queryWithSwag(`SELECT id, content, memory_type, importance, tags, metadata, embedding,
        image_data, image_mime_type, created_at, updated_at, access_count,
        last_accessed_at, expires_at, consolidated_from FROM memories WHERE id = $1`, [result.id]);
        const row = memoryResult.rows[0];
        return {
            id: row.id,
            content: row.content,
            memoryType: row.memory_type,
            importance: row.importance,
            tags: row.tags,
            metadata: row.metadata,
            embedding: row.embedding ? this.parseEmbedding(row.embedding) : undefined,
            imageData: row.image_data?.toString('base64'),
            imageMimeType: row.image_mime_type ?? undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            accessCount: row.access_count,
            lastAccessedAt: row.last_accessed_at ?? undefined,
            expiresAt: row.expires_at ?? undefined,
            consolidatedFrom: row.consolidated_from ?? undefined
        };
    }
    // BATCH YEET - handles thousands of inserts efficiently
    async yeetBatch(payloads, batchSize = 500) {
        const start = Date.now();
        const stats = {
            total: payloads.length,
            inserted: 0,
            skipped: 0,
            failed: 0,
            duration: 0,
            ids: []
        };
        if (payloads.length === 0) {
            stats.duration = Date.now() - start;
            return stats;
        }
        logger.info({ total: payloads.length, batchSize }, 'starting batch yeet operation');
        // DYNAMIC PROJECT_PATH: Read at call time for entire batch
        const projectPath = getProjectPathForInsert();
        // process in batches for optimal performance
        for (let i = 0; i < payloads.length; i += batchSize) {
            const batch = payloads.slice(i, i + batchSize);
            const batchStart = Date.now();
            try {
                const batchIds = await this.pool.transactionGang(async (client) => {
                    const insertedIds = [];
                    for (const payload of batch) {
                        try {
                            const id = uuidv4();
                            // prepare embedding
                            const embeddingStr = payload.embedding
                                ? `[${payload.embedding.join(',')}]`
                                : null;
                            // prepare image
                            const imageBuffer = payload.imageData
                                ? Buffer.from(payload.imageData, 'base64')
                                : null;
                            await client.query(`INSERT INTO memories (
                  id, content, memory_type, importance, tags, metadata,
                  embedding, image_data, image_mime_type, expires_at, consolidated_from, project_path
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (content_hash) DO NOTHING
                RETURNING id`, [
                                id,
                                payload.content,
                                payload.memoryType,
                                payload.importance,
                                payload.tags,
                                payload.metadata ?? {},
                                embeddingStr,
                                imageBuffer,
                                payload.imageMimeType ?? null,
                                payload.expiresAt ?? null,
                                payload.consolidatedFrom ?? [],
                                projectPath
                            ]);
                            insertedIds.push(id);
                        }
                        catch (err) {
                            const message = err.message;
                            if (message.includes('duplicate key') || message.includes('unique constraint')) {
                                stats.skipped++;
                            }
                            else {
                                stats.failed++;
                                logger.warn({ err }, 'failed to insert memory in batch');
                            }
                        }
                    }
                    return insertedIds;
                });
                stats.ids.push(...batchIds);
                stats.inserted += batchIds.length;
                const batchDuration = Date.now() - batchStart;
                logger.debug({
                    batchIndex: Math.floor(i / batchSize),
                    batchSize: batch.length,
                    inserted: batchIds.length,
                    duration: batchDuration
                }, 'batch complete');
            }
            catch (err) {
                // whole batch failed - count them all as failed
                stats.failed += batch.length;
                logger.error({ err, batchIndex: Math.floor(i / batchSize) }, 'batch yeet FAILED');
            }
        }
        stats.duration = Date.now() - start;
        this.insertCount += stats.inserted;
        this.duplicateCount += stats.skipped;
        logger.info({
            total: stats.total,
            inserted: stats.inserted,
            skipped: stats.skipped,
            failed: stats.failed,
            duration: stats.duration,
            rate: Math.round(stats.inserted / (stats.duration / 1000))
        }, 'batch yeet complete - we movin');
        return stats;
    }
    // upsert - insert or update if exists
    async yeetOrUpdate(payload, updateFields = ['importance', 'tags', 'metadata']) {
        const start = Date.now();
        const id = uuidv4();
        const contentHash = await this.computeContentHash(payload.content);
        // DYNAMIC PROJECT_PATH: Read at call time, not module load time
        const projectPath = getProjectPathForInsert();
        // prepare embedding
        const embeddingStr = payload.embedding
            ? `[${payload.embedding.join(',')}]`
            : null;
        // build update clause dynamically
        const updateClauses = [];
        if (updateFields.includes('importance')) {
            updateClauses.push('importance = EXCLUDED.importance');
        }
        if (updateFields.includes('tags')) {
            updateClauses.push('tags = EXCLUDED.tags');
        }
        if (updateFields.includes('metadata')) {
            updateClauses.push('metadata = memories.metadata || EXCLUDED.metadata');
        }
        if (updateFields.includes('embedding')) {
            updateClauses.push('embedding = EXCLUDED.embedding');
        }
        const updateClause = updateClauses.length > 0
            ? `DO UPDATE SET ${updateClauses.join(', ')}, updated_at = NOW()`
            : 'DO NOTHING';
        const result = await this.pool.queryWithSwag(`INSERT INTO memories (
        id, content, memory_type, importance, tags, metadata,
        embedding, image_data, image_mime_type, expires_at, project_path
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (content_hash) ${updateClause}
      RETURNING id, (xmax = 0) as was_created`, [
            id,
            payload.content,
            payload.memoryType,
            payload.importance,
            payload.tags,
            payload.metadata ?? {},
            embeddingStr,
            payload.imageData ? Buffer.from(payload.imageData, 'base64') : null,
            payload.imageMimeType ?? null,
            payload.expiresAt ?? null,
            projectPath
        ]);
        const row = result.rows[0];
        const duration = Date.now() - start;
        if (row?.was_created) {
            this.insertCount++;
        }
        return {
            id: row?.id ?? id,
            contentHash,
            wasCreated: row?.was_created ?? true,
            duration
        };
    }
    // creates a memory relation (link between memories)
    async yeetRelation(sourceId, targetId, relationType = 'related', strength = 1.0, bidirectional = true) {
        logger.debug({ sourceId, targetId, relationType, bidirectional }, 'creating memory relation');
        await this.pool.transactionGang(async (client) => {
            // insert forward relation
            await client.query(`INSERT INTO memory_relations (source_id, target_id, relation_type, strength)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (source_id, target_id, relation_type) DO UPDATE SET strength = $4`, [sourceId, targetId, relationType, strength]);
            // insert reverse relation if bidirectional
            if (bidirectional) {
                await client.query(`INSERT INTO memory_relations (source_id, target_id, relation_type, strength)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (source_id, target_id, relation_type) DO UPDATE SET strength = $4`, [targetId, sourceId, relationType, strength]);
            }
        });
    }
    // bulk create relations
    async yeetRelationsBatch(relations, bidirectional = true) {
        if (relations.length === 0)
            return 0;
        let created = 0;
        await this.pool.transactionGang(async (client) => {
            for (const rel of relations) {
                const relationType = rel.relationType ?? 'related';
                const strength = rel.strength ?? 1.0;
                await client.query(`INSERT INTO memory_relations (source_id, target_id, relation_type, strength)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`, [rel.sourceId, rel.targetId, relationType, strength]);
                created++;
                if (bidirectional) {
                    await client.query(`INSERT INTO memory_relations (source_id, target_id, relation_type, strength)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`, [rel.targetId, rel.sourceId, relationType, strength]);
                }
            }
        });
        return created;
    }
    // syncs tags to normalized table for fast queries
    // batch operation - 2 queries total regardless of tag count
    async syncTagsForMemory(memoryId, tags) {
        if (tags.length === 0)
            return;
        const normalizedTags = tags.map(t => t.toLowerCase().trim()).filter(t => t.length > 0);
        if (normalizedTags.length === 0)
            return;
        await this.pool.transactionGang(async (client) => {
            // batch upsert all tags and get their IDs in one query
            const tagResult = await client.query(`INSERT INTO tags (name, usage_count)
         SELECT unnest($1::text[]), 1
         ON CONFLICT (name) DO UPDATE SET usage_count = tags.usage_count + 1
         RETURNING id`, [normalizedTags]);
            const tagIds = tagResult.rows.map(r => r.id);
            if (tagIds.length === 0)
                return;
            // batch link all tags to memory in one query
            await client.query(`INSERT INTO memory_tags (memory_id, tag_id)
         SELECT $1::uuid, unnest($2::int[])
         ON CONFLICT DO NOTHING`, [memoryId, tagIds]);
        });
    }
    // adds embedding to existing memory
    async addEmbeddingToMemory(memoryId, embedding) {
        const embeddingStr = `[${embedding.join(',')}]`;
        await this.pool.queryWithSwag(`UPDATE memories SET embedding = $1 WHERE id = $2`, [embeddingStr, memoryId]);
        logger.debug({ memoryId, dimensions: embedding.length }, 'embedding added to memory');
    }
    // ATOMIC UPDATE by ID - replaces DELETE+INSERT anti-pattern
    // uses ON CONFLICT on id column for atomic upsert
    async yeetUpdateById(existingId, payload) {
        const start = Date.now();
        const contentHash = await this.computeContentHash(payload.content);
        const projectPath = getProjectPathForInsert();
        const embeddingStr = payload.embedding
            ? `[${payload.embedding.join(',')}]`
            : null;
        const imageBuffer = payload.imageData
            ? Buffer.from(payload.imageData, 'base64')
            : null;
        // atomic upsert - if id exists, update everything; if not, insert with provided id
        const result = await this.pool.queryWithSwag(`INSERT INTO memories (
        id, content, memory_type, importance, tags, metadata,
        embedding, image_data, image_mime_type, expires_at, consolidated_from, project_path
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        memory_type = EXCLUDED.memory_type,
        importance = EXCLUDED.importance,
        tags = EXCLUDED.tags,
        metadata = EXCLUDED.metadata,
        embedding = EXCLUDED.embedding,
        image_data = EXCLUDED.image_data,
        image_mime_type = EXCLUDED.image_mime_type,
        expires_at = EXCLUDED.expires_at,
        consolidated_from = EXCLUDED.consolidated_from,
        updated_at = NOW()
      RETURNING id, (xmax = 0) as was_created`, [
            existingId,
            payload.content,
            payload.memoryType,
            payload.importance,
            payload.tags,
            payload.metadata ?? {},
            embeddingStr,
            imageBuffer,
            payload.imageMimeType ?? null,
            payload.expiresAt ?? null,
            payload.consolidatedFrom ?? [],
            projectPath
        ]);
        const row = result.rows[0];
        const duration = Date.now() - start;
        if (row?.was_created) {
            this.insertCount++;
        }
        logger.debug({ id: existingId, wasCreated: row?.was_created, duration }, 'yeetUpdateById complete');
        return {
            id: row?.id ?? existingId,
            contentHash,
            wasCreated: row?.was_created ?? false,
            duration
        };
    }
    // caches an embedding for reuse
    async cacheEmbedding(contentHash, embedding, model = 'text-embedding-3-small') {
        const embeddingStr = `[${embedding.join(',')}]`;
        await this.pool.queryWithSwag(`INSERT INTO embedding_cache (content_hash, embedding, model)
       VALUES ($1, $2, $3)
       ON CONFLICT (content_hash) DO UPDATE SET
         embedding = $2,
         last_used_at = NOW(),
         hit_count = embedding_cache.hit_count + 1`, [contentHash, embeddingStr, model]);
    }
    // gets cached embedding if exists
    async getCachedEmbedding(contentHash) {
        const result = await this.pool.queryWithSwag(`UPDATE embedding_cache
       SET hit_count = hit_count + 1, last_used_at = NOW()
       WHERE content_hash = $1
       RETURNING embedding`, [contentHash]);
        if (result.rows.length === 0)
            return null;
        return this.parseEmbedding(result.rows[0].embedding);
    }
    // helper to compute content hash
    // use convert_to() for proper UTF-8 to bytea conversion instead of ::bytea cast
    // which can fail with "invalid input syntax for type bytea" on special characters
    async computeContentHash(content) {
        const result = await this.pool.queryWithSwag(`SELECT encode(sha256(convert_to($1, 'UTF8')), 'hex') as hash`, [content]);
        return result.rows[0].hash;
    }
    // finds memory by content hash
    // PROJECT ISOLATION: Only check for duplicates within current project
    async findByContentHash(contentHash) {
        const projectPath = getProjectPathForInsert();
        const result = await this.pool.queryWithSwag(`SELECT id FROM memories WHERE content_hash = $1 AND project_path = $2 LIMIT 1`, [contentHash, projectPath]);
        return result.rows[0] ?? null;
    }
    // parses embedding string back to array
    parseEmbedding(embeddingStr) {
        const cleaned = embeddingStr.replace(/[\[\]]/g, '');
        return cleaned.split(',').map(Number);
    }
    // gets insert stats
    getStats() {
        return {
            totalInserted: this.insertCount,
            duplicatesSkipped: this.duplicateCount
        };
    }
}
// per-project Map pattern - each project gets its own yeeter no cap
const yeeterInstancesByProject = new Map();
const yeeterAccessTimes = new Map();
// Cleanup stale yeeters after 30 min inactivity
setupMapCleanup(yeeterInstancesByProject, yeeterAccessTimes, {
    staleThresholdMs: 30 * 60 * 1000,
    checkIntervalMs: 5 * 60 * 1000,
    logPrefix: '[Yeeter]'
});
export function getTheYeeter(pool, projectPath) {
    const targetProject = projectPath || getCurrentProjectPath();
    yeeterAccessTimes.set(targetProject, Date.now());
    if (!yeeterInstancesByProject.has(targetProject) && !pool) {
        throw new Error(`yeeter not initialized for project ${targetProject} - pass pool first`);
    }
    if (!yeeterInstancesByProject.has(targetProject) && pool) {
        yeeterInstancesByProject.set(targetProject, new MemoryYeeter(pool));
        logger.debug(`[Yeeter] Created memory yeeter for project: ${targetProject}`);
    }
    return yeeterInstancesByProject.get(targetProject);
}
export function resetTheYeeter(projectPath) {
    if (projectPath) {
        yeeterInstancesByProject.delete(projectPath);
        logger.debug(`[Yeeter] Reset yeeter for project: ${projectPath}`);
    }
    else {
        // reset current project only
        const currentProject = getCurrentProjectPath();
        yeeterInstancesByProject.delete(currentProject);
        logger.debug(`[Yeeter] Reset yeeter for current project: ${currentProject}`);
    }
}
export function resetAllYeeters() {
    yeeterInstancesByProject.clear();
    logger.debug('[Yeeter] Reset all yeeters');
}
//# sourceMappingURL=yeetStuffInDb.js.map