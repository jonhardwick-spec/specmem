/**
 * extractClaudeSessions.ts - Manual Claude Session Extraction Tool
 *
 * yo fr fr manually trigger Claude session extraction
 * extracts ALL sessions or just new ones since last check
 *
 * This is the MCP tool that lets you manually extract sessions
 * perfect for initial setup or when you want to force an update
 */
import { z } from 'zod';
import { logger, serializeError } from '../../utils/logger.js';
import { createSessionParser } from '../../claude-sessions/sessionParser.js';
import { getProjectPathForInsert, getCurrentProjectPath } from '../../services/ProjectContext.js';
const ExtractClaudeSessionsInputSchema = z.object({
    mode: z.enum(['all', 'new']).default('new').describe('Extraction mode: "all" to re-extract everything, "new" for only new entries since last extraction'),
    importance: z.enum(['critical', 'high', 'medium', 'low', 'trivial']).default('medium').describe('Importance level to assign to extracted session memories'),
    additionalTags: z.array(z.string()).optional().describe('Additional tags to add to all extracted session memories'),
    claudeDir: z.string().optional().describe('Custom path to .claude directory (defaults to ~/.claude)')
});
/**
 * ExtractClaudeSessions - manually extracts Claude Code sessions
 *
 * nah bruh this is the manual extraction tool
 * perfect for when you first set this up or want to refresh
 */
export class ExtractClaudeSessions {
    name = 'extract-claude-sessions';
    description = 'Manually extract Claude Code FULL session history into specmem. Extracts BOTH user prompts AND Claude responses from session files. Use "new" mode for incremental updates or "all" to re-extract everything.';
    inputSchema = {
        type: 'object',
        properties: {
            mode: {
                type: 'string',
                enum: ['all', 'new'],
                default: 'new',
                description: 'Extraction mode: "all" to re-extract everything, "new" for only new entries since last extraction'
            },
            importance: {
                type: 'string',
                enum: ['critical', 'high', 'medium', 'low', 'trivial'],
                default: 'medium',
                description: 'Importance level to assign to extracted session memories'
            },
            additionalTags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Additional tags to add to all extracted session memories'
            },
            claudeDir: {
                type: 'string',
                description: 'Custom path to .claude directory (defaults to ~/.claude)'
            }
        }
    };
    embeddingProvider;
    db;
    constructor(embeddingProvider, db) {
        this.embeddingProvider = embeddingProvider;
        this.db = db;
    }
    async execute(args) {
        logger.info({ mode: args.mode }, 'manual Claude session extraction started');
        try {
            // FIX Task #13: Create parser WITH project filter for early filtering
            // This prevents parsing sessions from other projects (major performance win)
            const currentProject = getCurrentProjectPath();
            const parser = createSessionParser(args.claudeDir, currentProject);
            logger.info({
                projectFilter: currentProject,
                mode: args.mode
            }, 'Task #13: extracting sessions with early project filtering');
            // get sessions based on mode - now uses full session files!
            let sessions;
            if (args.mode === 'all') {
                logger.info('extracting ALL sessions (full re-import with user + assistant messages)');
                sessions = await parser.parseAllSessions();
            }
            else {
                // get last processed timestamp
                const lastTimestamp = await parser.getLastProcessedTimestamp(this.db);
                logger.info({ since: new Date(lastTimestamp) }, 'extracting new sessions only');
                sessions = await parser.parseNewEntries(lastTimestamp);
            }
            if (sessions.length === 0) {
                return {
                    success: true,
                    extracted: 0,
                    stored: 0,
                    failed: 0,
                    mode: args.mode,
                    message: 'No sessions found to extract'
                };
            }
            logger.info({ count: sessions.length }, 'sessions parsed successfully');
            // get stats
            const allStats = await parser.getSessionStats();
            // convert to memory params
            const memoryParams = parser.convertToMemoryParams(sessions, {
                importance: args.importance,
                additionalTags: args.additionalTags ?? []
            });
            // BATCH processing for speed - get all existing entryIds in ONE query
            let stored = 0;
            let failed = 0;
            let oversizedSkipped = 0;
            const BATCH_SIZE = 100; // Batch embedding handles larger batches efficiently
            const errorCounts = {};
            // Get all existing entryIds to filter duplicates in memory
            const existingResult = await this.db.query(`
        SELECT metadata->>'entryId' as entry_id
        FROM memories
        WHERE 'claude-session' = ANY(tags)
      `);
            const existingIds = new Set(existingResult.rows.map((r) => r.entry_id));
            logger.info({ existingCount: existingIds.size }, 'loaded existing entryIds for dedup');
            // Filter out duplicates
            const newParams = memoryParams.filter(p => !existingIds.has(p.metadata?.entryId));
            logger.info({ total: memoryParams.length, new: newParams.length, skipped: memoryParams.length - newParams.length }, 'filtered duplicates');
            // Check for oversized content (>1MB) and log warnings
            const MAX_CONTENT_LENGTH = 1000000; // 1MB limit from DB constraint
            const oversized = newParams.filter(p => p.content.length > MAX_CONTENT_LENGTH);
            if (oversized.length > 0) {
                logger.warn({
                    count: oversized.length,
                    maxSize: Math.max(...oversized.map(p => p.content.length)),
                    avgSize: Math.floor(oversized.reduce((sum, p) => sum + p.content.length, 0) / oversized.length)
                }, 'found oversized content that will fail DB constraint');
            }
            // Process in batches
            for (let i = 0; i < newParams.length; i += BATCH_SIZE) {
                const batch = newParams.slice(i, i + BATCH_SIZE);
                logger.info({ batch: Math.floor(i / BATCH_SIZE) + 1, total: Math.ceil(newParams.length / BATCH_SIZE), size: batch.length }, 'processing batch');
                // Generate embeddings using BATCH API - 5-10x faster than individual calls!
                // Falls back to parallel individual calls if batch not supported or fails
                let embeddings;
                const texts = batch.map(p => p.content);
                try {
                    if (this.embeddingProvider.generateEmbeddingsBatch) {
                        embeddings = await this.embeddingProvider.generateEmbeddingsBatch(texts);
                    }
                    else {
                        // Fallback to parallel individual calls
                        embeddings = await Promise.all(texts.map(t => this.embeddingProvider.generateEmbedding(t)));
                    }
                }
                catch (batchError) {
                    // Batch failed - fall back to individual calls
                    logger.warn({ error: serializeError(batchError) }, 'batch embedding failed, falling back to individual');
                    embeddings = await Promise.all(texts.map(t => this.embeddingProvider.generateEmbedding(t)));
                }
                try {
                    // PROJECT ISOLATION: Get fresh project path at call time
                    const projectPath = getProjectPathForInsert();
                    // Task #38 FIX: Wrap batch insert in transaction for atomicity
                    // Either all memories in the batch are stored or none (prevents partial failures)
                    const batchStored = await this.db.transaction(async (client) => {
                        // Build multi-row INSERT
                        const values = [];
                        const placeholders = [];
                        let paramIdx = 1;
                        for (let j = 0; j < batch.length; j++) {
                            const params = batch[j];
                            const embedding = embeddings[j];
                            placeholders.push('($' + paramIdx + ', $' + (paramIdx + 1) + ', $' + (paramIdx + 2) + ', $' + (paramIdx + 3) + ', $' + (paramIdx + 4) + ', $' + (paramIdx + 5) + ', $' + (paramIdx + 6) + ')');
                            values.push(params.content, params.memoryType, params.importance, params.tags, params.metadata, '[' + embedding.join(',') + ']', projectPath);
                            paramIdx += 7;
                        }
                        if (placeholders.length > 0) {
                            const result = await client.query('INSERT INTO memories (content, memory_type, importance, tags, metadata, embedding, project_path) VALUES ' + placeholders.join(', ') + ' RETURNING id', values);
                            return result.rows.length;
                        }
                        return 0;
                    });
                    stored += batchStored;
                }
                catch (error) {
                    // Batch failed - try inserting records individually as fallback
                    logger.warn({
                        error: serializeError(error),
                        batchStart: i,
                        batchSize: batch.length
                    }, 'batch insert failed, falling back to individual inserts');
                    for (let j = 0; j < batch.length; j++) {
                        try {
                            const params = batch[j];
                            const embedding = embeddings[j];
                            // Skip oversized content
                            if (params.content.length > MAX_CONTENT_LENGTH) {
                                failed++;
                                oversizedSkipped++;
                                errorCounts['oversized_content'] = (errorCounts['oversized_content'] || 0) + 1;
                                logger.warn({
                                    entryId: params.metadata?.entryId,
                                    contentLength: params.content.length,
                                    limit: MAX_CONTENT_LENGTH
                                }, 'skipping oversized content (exceeds 1MB limit)');
                                continue;
                            }
                            // PROJECT ISOLATION: Get fresh project path at call time
                            const projectPath = getProjectPathForInsert();
                            await this.db.query(`
                INSERT INTO memories (content, memory_type, importance, tags, metadata, embedding, project_path)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
              `, [
                                params.content,
                                params.memoryType,
                                params.importance,
                                params.tags,
                                params.metadata,
                                `[${embedding.join(',')}]`,
                                projectPath
                            ]);
                            stored++;
                        }
                        catch (individualError) {
                            failed++;
                            const errorObj = serializeError(individualError);
                            const errorKey = String(individualError?.code || errorObj.name || 'unknown');
                            errorCounts[errorKey] = (errorCounts[errorKey] || 0) + 1;
                            // Only log first few errors of each type to avoid spam
                            if ((errorCounts[errorKey] || 0) <= 3) {
                                logger.warn({
                                    error: errorObj,
                                    errorMessage: errorObj.message,
                                    errorCode: individualError?.code,
                                    errorName: errorObj.name,
                                    entryId: batch[j].metadata?.entryId,
                                    contentLength: batch[j].content.length,
                                    metadataSize: JSON.stringify(batch[j].metadata).length
                                }, 'individual insert failed - check error details');
                            }
                        }
                    }
                }
            }
            const message = `Extracted ${sessions.length} Claude sessions: ${stored} stored, ${failed} failed (${oversizedSkipped} oversized)`;
            logger.info({
                extracted: sessions.length,
                stored,
                failed,
                oversizedSkipped,
                errorBreakdown: errorCounts
            }, 'session extraction complete');
            return {
                success: true,
                extracted: sessions.length,
                stored,
                failed,
                oversizedSkipped,
                mode: args.mode,
                stats: {
                    oldestEntry: allStats.oldestEntry?.toISOString() ?? null,
                    newestEntry: allStats.newestEntry?.toISOString() ?? null,
                    uniqueSessions: allStats.uniqueSessions,
                    projectsFound: Array.from(allStats.projectsFound)
                },
                errorBreakdown: errorCounts,
                message
            };
        }
        catch (error) {
            const serialized = serializeError(error);
            logger.error({ error: serialized }, 'Claude session extraction failed');
            return {
                success: false,
                extracted: 0,
                stored: 0,
                failed: 0,
                mode: args.mode,
                message: `Extraction failed: ${serialized.message || 'Unknown error'}`,
                errorDetails: serialized
            };
        }
    }
}
//# sourceMappingURL=extractClaudeSessions.js.map