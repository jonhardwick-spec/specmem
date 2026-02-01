/**
 * drill_down - Camera Roll Drilldown Tool
 *
 * Enables zooming into specific memories from camera roll results.
 * Takes a numeric drilldownID and returns detailed content with
 * more exploration options (more drilldown IDs).
 *
 * Camera Roll Metaphor:
 * - find_memory({ cameraRollMode: true }) returns a "camera roll" of results
 * - Each result has a drilldownID (e.g., 123, 456, 789)
 * - drill_down(123) zooms into that specific memory
 * - Returns: full content, related memories (with their own drilldown IDs),
 *   code references, and conversation context
 *
 * Usage:
 *   drill_down({ drilldownID: 123 })
 *   drill_down({ drilldownID: 456, includeCode: true, includeContext: true })
 */
import { logger } from '../../utils/logger.js';
import { drilldownRegistry, performDrilldown } from '../../services/CameraZoomSearch.js';
import { smartCompress } from '../../utils/tokenCompressor.js';
import { compactXmlResponse, stripNewlines } from '../../utils/compactXmlResponse.js';
import { formatHumanReadable } from '../../utils/humanReadableOutput.js';
import { cotStart, cotResult, cotError } from '../../utils/cotBroadcast.js';
import { getProjectPathForInsert } from '../../services/ProjectContext.js';
// ============================================================================
// REMINDERS
// ============================================================================
const DRILLDOWN_REMINDER = `DRILL_DOWN 深入查看模式
✅ fullContent = 主要內容
✅ pairedMessage = 對話配對 (用戶提示↔回應)
可繼續 drill_down(ID) | 返回: find_memory({ cameraRollMode: true })`;
const NOT_FOUND_REMINDER = `DRILLDOWN_ID 未找到
可能已過期或無效 | 請重新搜索: find_memory({ query, cameraRollMode: true })`;
// ============================================================================
// MAIN TOOL
// ============================================================================
export class DrillDown {
    db;
    name = 'drill_down';
    description = 'Zoom into a specific memory from camera roll results. Use drilldownID from find_memory results to explore deeper.';
    inputSchema = {
        type: 'object',
        properties: {
            drilldownID: {
                type: 'number',
                description: 'The numeric drilldownID from camera roll results (e.g., 123, 456)'
            },
            includeCode: {
                type: 'boolean',
                default: true,
                description: 'Include code references in the result'
            },
            includeContext: {
                type: 'boolean',
                default: true,
                description: 'Include conversation context (before/after messages)'
            },
            includeRelated: {
                type: 'boolean',
                default: true,
                description: 'Include related memories for further exploration'
            },
            relatedLimit: {
                type: 'number',
                default: 5,
                minimum: 1,
                maximum: 20,
                description: 'Maximum number of related memories to return'
            },
            compress: {
                type: 'boolean',
                default: true,
                description: 'Apply Traditional Chinese compression for token efficiency'
            },
            // humanReadable is always true - removed as configurable option per user request
        },
        required: ['drilldownID']
    };
    constructor(db) {
        this.db = db;
    }
    async execute(params) {
        const startTime = Date.now();
        logger.info({
            drilldownID: params.drilldownID,
            includeCode: params.includeCode,
            includeContext: params.includeContext
        }, '[DrillDown] Executing drilldown');
        // Broadcast COT start to dashboard
        cotStart('drill_down', `ID ${params.drilldownID}`);
        // Resolve drilldownID to entry
        const entry = drilldownRegistry.resolve(params.drilldownID);
        if (!entry) {
            logger.warn({ drilldownID: params.drilldownID }, '[DrillDown] ID not found in registry');
            const errorData = {
                error: 'NOT_FOUND',
                id: params.drilldownID,
                message: stripNewlines(`Drilldown ID ${params.drilldownID} not found. It may have expired or never existed.`),
                hint: 'drill_down(ID) 無效 | 請用 find_memory 重新搜索',
                reminder: NOT_FOUND_REMINDER
            };
            return compactXmlResponse(errorData, 'drilldown');
        }
        try {
            // Perform the drilldown
            const result = await performDrilldown(params.drilldownID, this.db, {
                includeConversationContext: params.includeContext !== false,
                relatedLimit: params.relatedLimit ?? 5,
                codeRefLimit: params.includeCode !== false ? 3 : 0
            });
            if (!result) {
                const errorData = {
                    error: 'LOAD_FAILED',
                    id: params.drilldownID,
                    memoryID: entry.memoryID,
                    type: entry.type,
                    message: stripNewlines(`Memory ${entry.memoryID} could not be loaded from database.`),
                    hint: `Memory ${entry.memoryID} 無法加載`,
                    reminder: NOT_FOUND_REMINDER
                };
                return compactXmlResponse(errorData, 'drilldown');
            }
            // Apply compression if requested
            let fullContent = result.fullContent;
            let fullCR = result.fullCR;
            if (params.compress !== false) {
                const contentCompressed = smartCompress(fullContent, { threshold: 0.85 });
                fullContent = contentCompressed.result;
                if (fullCR) {
                    const crCompressed = smartCompress(fullCR, { threshold: 0.85 });
                    fullCR = crCompressed.result;
                }
            }
            // Format conversation context for response
            // ROUND-TRIP VERIFIED compression - keeps English where Chinese loses context
            const compressPreview = (text) => {
                const preview = text.substring(0, 100);
                if (params.compress === false)
                    return preview;
                return smartCompress(preview, { threshold: 0.75 }).result;
            };
            let conversationContext;
            if (result.conversationContext && params.includeContext !== false) {
                conversationContext = {
                    before: result.conversationContext.before.map(item => ({
                        drilldownID: item.drilldownID,
                        preview: compressPreview(item.content),
                        similarity: item.similarity
                    })),
                    after: result.conversationContext.after.map(item => ({
                        drilldownID: item.drilldownID,
                        preview: compressPreview(item.content),
                        similarity: item.similarity
                    }))
                };
            }
            // Format related memories
            const relatedMemories = params.includeRelated !== false
                ? result.relatedMemories.map(item => ({
                    drilldownID: item.drilldownID,
                    preview: compressPreview(item.content),
                    similarity: item.similarity
                }))
                : [];
            // Format code references
            const codeReferences = params.includeCode !== false
                ? result.codeReferences.map(item => ({
                    drilldownID: item.drilldownID,
                    filePath: item.memoryID.split(':')[0] || item.memoryID,
                    preview: item.content.substring(0, 100)
                }))
                : [];
            const duration = Date.now() - startTime;
            logger.info({
                drilldownID: params.drilldownID,
                duration,
                relatedCount: relatedMemories.length,
                codeRefCount: codeReferences.length
            }, '[DrillDown] Complete');
            // Build drilldown hint
            const childIDs = result.childDrilldownIDs.slice(0, 5);
            const drilldownHint = childIDs.length > 0
                ? `可繼續探索: ${childIDs.map(id => `drill_down(${id})`).join(' | ')}`
                : `無更多可探索項 | 返回: find_memory({ query, cameraRollMode: true })`;
            // CRITICAL: Format paired message (user prompt for  response, or vice versa)
            let pairedMessage;
            if (result.pairedMessage) {
                const pairedRole = result.pairedMessage.role || 'user';
                const label = pairedRole === 'user'
                    ? '📝 USER PROMPT:'
                    : '🤖 CLAUDE RESPONSE:';
                let pairedContent = result.pairedMessage.content;
                if (params.compress !== false) {
                    const compressed = smartCompress(pairedContent, { threshold: 0.85 });
                    pairedContent = compressed.result;
                }
                pairedMessage = {
                    role: pairedRole,
                    content: pairedContent,
                    drilldownID: result.pairedMessage.drilldownID,
                    label
                };
            }
            // Always use humanReadable format
            const humanReadableData = [{
                    fullContent,
                    content: fullContent,
                    context: conversationContext ? {
                        before: conversationContext.before.map(m => m.preview),
                        after: conversationContext.after.map(m => m.preview)
                    } : undefined,
                    code: codeReferences.map(ref => ({
                        file: ref.filePath,
                        content: ref.preview
                    })),
                    related: relatedMemories.map(mem => ({
                        id: mem.drilldownID,
                        drilldownID: mem.drilldownID,
                        content: mem.preview,
                        similarity: mem.similarity
                    }))
                }];
            // Broadcast COT result to dashboard
            cotResult('drill_down', `Loaded memory with ${relatedMemories.length} related`, relatedMemories.length);
            return formatHumanReadable('drill_down', humanReadableData, {
                grey: true,
                showSimilarity: true,
                maxContentLength: 500
            });
        }
        catch (error) {
            // Broadcast COT error to dashboard
            cotError('drill_down', error?.message?.slice(0, 100) || 'Unknown error');
            logger.error({ error, drilldownID: params.drilldownID }, '[DrillDown] Failed');
            throw error;
        }
    }
}
// ============================================================================
// ADDITIONAL HELPER: Get Memory by DrilldownID
// This is simpler than drill_down - just returns the full content
// ============================================================================
export class GetMemoryByDrilldownID {
    db;
    name = 'get_memory_by_id';
    description = 'Get full memory content using a drilldownID. Simpler than drill_down - just returns content without exploration options.';
    inputSchema = {
        type: 'object',
        properties: {
            drilldownID: {
                type: 'number',
                description: 'The numeric drilldownID from camera roll results'
            }
        },
        required: ['drilldownID']
    };
    constructor(db) {
        this.db = db;
    }
    async execute(params) {
        const entry = drilldownRegistry.resolve(params.drilldownID);
        if (!entry) {
            return null;
        }
        try {
            const projectPath = getProjectPathForInsert();
            const result = await this.db.query(`
        SELECT id, content FROM memories WHERE id = $1 AND project_path = $2
      `, [entry.memoryID, projectPath]);
            if (result.rows.length === 0) {
                return null;
            }
            return {
                content: result.rows[0].content,
                memoryID: entry.memoryID
            };
        }
        catch (error) {
            logger.error({ error, drilldownID: params.drilldownID }, '[GetMemoryByDrilldownID] Failed');
            return null;
        }
    }
}
//# sourceMappingURL=drillDown.js.map