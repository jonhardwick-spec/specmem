/**
 * linkTheVibes - create memory relationships
 *
 * connects memories together for graph-based traversal
 * creates those associations that make retrieval smarter
 */
import { logger } from '../../utils/logger.js';
import { getProjectPathForInsert } from '../../services/ProjectContext.js';
import { formatHumanReadable } from '../../utils/humanReadableOutput.js';
/**
 * LinkTheVibes - memory relationship tool
 *
 * creates connections between memories for smarter retrieval
 * supports bidirectional links and different relationship types
 */
export class LinkTheVibes {
    db;
    name = 'link_the_vibes';
    description = 'create relationships between memories - links them together for graph-based traversal and smarter retrieval';
    inputSchema = {
        type: 'object',
        properties: {
            sourceId: {
                type: 'string',
                format: 'uuid',
                description: 'the memory to link from'
            },
            targetIds: {
                type: 'array',
                items: { type: 'string', format: 'uuid' },
                minItems: 1,
                description: 'memories to link to'
            },
            bidirectional: {
                type: 'boolean',
                default: true,
                description: 'create links in both directions'
            },
            relationType: {
                type: 'string',
                default: 'related',
                description: 'type of relationship (e.g., related, references, follows)'
            },
            strength: {
                type: 'number',
                default: 1.0,
                minimum: 0,
                maximum: 1,
                description: 'relationship strength (0-1)'
            }
        },
        required: ['sourceId', 'targetIds']
    };
    constructor(db) {
        this.db = db;
    }
    async execute(params) {
        logger.debug({ sourceId: params.sourceId, targetCount: params.targetIds.length }, 'linking memories');
        try {
            // verify source exists
            const sourceExists = await this.memoryExists(params.sourceId);
            if (!sourceExists) {
                const humanReadableData = [{
                        id: 'link-error',
                        similarity: 0,
                        content: `[ERROR] Source memory ${params.sourceId} not found`,
                    }];
                return formatHumanReadable('link_the_vibes', humanReadableData, {
                    grey: true,
                    maxContentLength: 500
                });
            }
            // verify targets exist and filter out non-existent ones
            const validTargets = [];
            for (const targetId of params.targetIds) {
                if (targetId !== params.sourceId && await this.memoryExists(targetId)) {
                    validTargets.push(targetId);
                }
            }
            if (validTargets.length === 0) {
                const humanReadableData = [{
                        id: 'link-error',
                        similarity: 0,
                        content: '[ERROR] No valid target memories found',
                    }];
                return formatHumanReadable('link_the_vibes', humanReadableData, {
                    grey: true,
                    maxContentLength: 500
                });
            }
            // create the links
            const links = await this.createLinks(params.sourceId, validTargets, params.bidirectional ?? true, params.relationType ?? 'related', params.strength ?? 1.0);
            logger.info({ linksCreated: links.length }, 'vibes linked successfully');
            const humanReadableData = [{
                    id: 'link-result',
                    similarity: 1.0,
                    content: `[LINKED] ${links.length} links created. Source: ${params.sourceId}. Targets: ${validTargets.length}`,
                }];
            return formatHumanReadable('link_the_vibes', humanReadableData, {
                grey: true,
                maxContentLength: 500
            });
        }
        catch (error) {
            logger.error({ error }, 'linking failed');
            const humanReadableData = [{
                    id: 'link-error',
                    similarity: 0,
                    content: `[ERROR] Linking failed: ${error instanceof Error ? error.message : 'linking failed'}`,
                }];
            return formatHumanReadable('link_the_vibes', humanReadableData, {
                grey: true,
                maxContentLength: 500
            });
        }
    }
    /**
     * create links between memories
     */
    async createLinks(sourceId, targetIds, bidirectional, relationType, strength) {
        const links = [];
        await this.db.transaction(async (client) => {
            for (const targetId of targetIds) {
                // create forward link
                await client.query(`INSERT INTO memory_relations (source_id, target_id, relation_type, strength)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (source_id, target_id) DO UPDATE
           SET relation_type = $3, strength = $4`, [sourceId, targetId, relationType, strength]);
                // create reverse link if bidirectional
                if (bidirectional) {
                    await client.query(`INSERT INTO memory_relations (source_id, target_id, relation_type, strength)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (source_id, target_id) DO UPDATE
             SET relation_type = $3, strength = $4`, [targetId, sourceId, relationType, strength]);
                }
                links.push({ sourceId, targetId, bidirectional });
            }
        });
        return links;
    }
    /**
     * get related memories through the relationship graph
     *
     * traverses the graph up to specified depth
     */
    async getRelatedMemories(memoryId, depth = 1) {
        const projectPath = getProjectPathForInsert();
        const query = `
      WITH RECURSIVE related AS (
        -- direct relations from source
        SELECT
          mr.target_id AS id,
          mr.relation_type,
          mr.strength,
          1 AS depth
        FROM memory_relations mr
        WHERE mr.source_id = $1

        UNION

        -- reverse relations (others pointing to us)
        SELECT
          mr.source_id AS id,
          mr.relation_type,
          mr.strength,
          1 AS depth
        FROM memory_relations mr
        WHERE mr.target_id = $1

        UNION ALL

        -- traverse deeper
        SELECT
          CASE
            WHEN mr.source_id = r.id THEN mr.target_id
            ELSE mr.source_id
          END AS id,
          mr.relation_type,
          mr.strength * 0.8 AS strength, -- decay strength with depth
          r.depth + 1
        FROM related r
        JOIN memory_relations mr ON (
          mr.source_id = r.id OR mr.target_id = r.id
        )
        WHERE r.depth < $2
          AND (mr.source_id != $1 AND mr.target_id != $1)
      )
      SELECT DISTINCT ON (m.id)
        m.id, m.content, m.memory_type, m.importance, m.tags, m.metadata,
        m.embedding, m.created_at, m.updated_at, m.access_count,
        r.relation_type, r.strength, r.depth
      FROM related r
      JOIN memories m ON m.id = r.id
      WHERE m.id != $1
        AND m.project_path = $3
        AND (m.expires_at IS NULL OR m.expires_at > NOW())
      ORDER BY m.id, r.depth, r.strength DESC
      LIMIT 50
    `;
        const result = await this.db.query(query, [memoryId, depth, projectPath]);
        return result.rows.map((row) => ({
            memory: this.rowToMemory(row),
            relationType: row.relation_type,
            strength: row.strength,
            depth: row.depth
        }));
    }
    /**
     * unlink memories - remove a relationship
     */
    async unlinkMemories(sourceId, targetId, bidirectional = true) {
        try {
            await this.db.transaction(async (client) => {
                // remove forward link
                await client.query(`DELETE FROM memory_relations WHERE source_id = $1 AND target_id = $2`, [sourceId, targetId]);
                // remove reverse link if bidirectional
                if (bidirectional) {
                    await client.query(`DELETE FROM memory_relations WHERE source_id = $1 AND target_id = $2`, [targetId, sourceId]);
                }
            });
            logger.info({ sourceId, targetId }, 'memories unlinked');
            return {
                success: true,
                message: 'memories unlinked successfully'
            };
        }
        catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : 'unlink failed'
            };
        }
    }
    /**
     * find memories that could be linked based on similarity
     *
     * suggests potential relationships for auto-linking
     */
    async findLinkableMemories(memoryId, threshold = 0.7) {
        const projectPath = getProjectPathForInsert();
        const query = `
      WITH source_memory AS (
        SELECT id, embedding FROM memories WHERE id = $1 AND project_path = $3
      ),
      existing_links AS (
        SELECT target_id FROM memory_relations WHERE source_id = $1
        UNION
        SELECT source_id FROM memory_relations WHERE target_id = $1
      ),
      candidates AS (
        SELECT
          m.id,
          1 - (m.embedding <=> sm.embedding) AS similarity,
          el.target_id IS NOT NULL AS already_linked
        FROM memories m
        CROSS JOIN source_memory sm
        LEFT JOIN existing_links el ON el.target_id = m.id
        WHERE m.id != $1
          AND m.project_path = $3
          AND m.embedding IS NOT NULL
          AND (m.expires_at IS NULL OR m.expires_at > NOW())
          AND 1 - (m.embedding <=> sm.embedding) >= $2
      )
      SELECT * FROM candidates
      ORDER BY already_linked, similarity DESC
      LIMIT 20
    `;
        const result = await this.db.query(query, [memoryId, threshold, projectPath]);
        return result.rows.map((row) => ({
            targetId: row.id,
            similarity: row.similarity,
            alreadyLinked: row.already_linked
        }));
    }
    /**
     * auto-link memories based on similarity
     *
     * automatically creates links between similar memories
     */
    async autoLinkSimilar(memoryId, threshold = 0.85, maxLinks = 5) {
        const candidates = await this.findLinkableMemories(memoryId, threshold);
        // filter to unlinked candidates only
        const unlinked = candidates
            .filter(c => !c.alreadyLinked)
            .slice(0, maxLinks);
        if (unlinked.length === 0) {
            return {
                success: true,
                linksCreated: 0,
                message: 'no similar unlinked memories found'
            };
        }
        const targetIds = unlinked.map(c => c.targetId);
        return this.execute({
            sourceId: memoryId,
            targetIds,
            bidirectional: true
        });
    }
    /**
     * get link statistics for a memory
     */
    async getLinkStats(memoryId) {
        const projectPath = getProjectPathForInsert();
        // verify the memory belongs to this project first
        const outgoingResult = await this.db.query(`SELECT mr.relation_type, COUNT(*) as count
       FROM memory_relations mr
       JOIN memories m ON mr.source_id = m.id
       WHERE mr.source_id = $1 AND m.project_path = $2
       GROUP BY mr.relation_type`, [memoryId, projectPath]);
        const incomingResult = await this.db.query(`SELECT COUNT(*) as count
       FROM memory_relations mr
       JOIN memories m ON mr.target_id = m.id
       WHERE mr.target_id = $1 AND m.project_path = $2`, [memoryId, projectPath]);
        const relationTypes = {};
        let outgoingTotal = 0;
        for (const row of outgoingResult.rows) {
            const count = parseInt(row.count, 10);
            relationTypes[row.relation_type] = count;
            outgoingTotal += count;
        }
        const incomingTotal = parseInt(incomingResult.rows[0]?.count ?? '0', 10);
        return {
            outgoingLinks: outgoingTotal,
            incomingLinks: incomingTotal,
            totalConnections: outgoingTotal + incomingTotal,
            relationTypes
        };
    }
    async memoryExists(id) {
        const projectPath = getProjectPathForInsert();
        const result = await this.db.query(`SELECT EXISTS(SELECT 1 FROM memories WHERE id = $1 AND project_path = $2) as exists`, [id, projectPath]);
        return result.rows[0]?.exists ?? false;
    }
    rowToMemory(row) {
        return {
            id: row.id,
            content: row.content,
            memoryType: row.memory_type,
            importance: row.importance,
            tags: row.tags,
            metadata: row.metadata,
            embedding: row.embedding ? this.parseEmbedding(row.embedding) : undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            accessCount: row.access_count
        };
    }
    parseEmbedding(embeddingStr) {
        const cleaned = embeddingStr.replace(/[\[\]]/g, '');
        return cleaned.split(',').map(Number);
    }
}
//# sourceMappingURL=linkTheVibes.js.map