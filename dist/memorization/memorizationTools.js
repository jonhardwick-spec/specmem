/**
 * memorizationTools.ts - MCP Tools for Claude's Auto-Memorization
 *
 * yooo these are THE TOOLS that let Claude remember what it wrote
 * no more massive explores because Claude KNOWS what it created
 *
 * Tools:
 * - remember_what_i_wrote - manually store Claude's code
 * - what_did_i_write_for - search Claude's code semantically
 * - all_my_code - list all code Claude wrote
 * - code_history - get version history for a file
 * - why_did_i_write_this - get context for why code was written
 */
import { logger } from '../utils/logger.js';
/**
 * RememberWhatIWroteTool - manually store code Claude just wrote
 *
 * yooo Claude just wrote some fire code lets memorize it
 * call this AFTER using Write, Edit, or NotebookEdit tools
 */
export class RememberWhatIWroteTool {
    memorizer;
    name = 'remember_what_i_wrote';
    description = 'Manually store code that Claude just wrote. Call this AFTER using Write/Edit/NotebookEdit to remember what you created and why.';
    inputSchema = {
        type: 'object',
        properties: {
            filePath: {
                type: 'string',
                description: 'The path to the file that was written/edited'
            },
            codeWritten: {
                type: 'string',
                description: 'The actual code that was written'
            },
            purpose: {
                type: 'string',
                description: 'WHY did you write this code? What problem does it solve?'
            },
            operationType: {
                type: 'string',
                enum: ['write', 'edit', 'notebook_edit', 'create', 'update', 'delete'],
                default: 'write',
                description: 'What type of operation was performed'
            },
            relatedFiles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Other files that are related to this code'
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags for categorizing this code'
            },
            conversationContext: {
                type: 'string',
                description: 'Context from the conversation that led to this code'
            }
        },
        required: ['filePath', 'codeWritten', 'purpose']
    };
    constructor(memorizer) {
        this.memorizer = memorizer;
    }
    async execute(params) {
        logger.info({
            filePath: params.filePath,
            purpose: params.purpose.slice(0, 100)
        }, 'remember_what_i_wrote called');
        try {
            const result = await this.memorizer.rememberWhatIJustWrote({
                filePath: params.filePath,
                codeWritten: params.codeWritten,
                purpose: params.purpose,
                operationType: params.operationType,
                relatedFiles: params.relatedFiles,
                tags: params.tags,
                conversationContext: params.conversationContext
            });
            return {
                success: result.success,
                codeId: result.codeId,
                version: result.version,
                message: result.message
            };
        }
        catch (error) {
            logger.error({ error }, 'remember_what_i_wrote failed');
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Failed to memorize code'
            };
        }
    }
}
/**
 * WhatDidIWriteForTool - semantic search for code Claude wrote
 *
 * nah bruh no more massive explores needed fr
 * search for code by purpose, content, or context
 */
export class WhatDidIWriteForTool {
    recall;
    name = 'what_did_i_write_for';
    description = 'Search for code you previously wrote. Use semantic search to find code by purpose, content, or what it does. No more massive explores needed!';
    inputSchema = {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'What are you looking for? Describe the purpose, feature, or content'
            },
            limit: {
                type: 'number',
                default: 10,
                description: 'Max number of results to return'
            },
            threshold: {
                type: 'number',
                default: 0.5,
                description: 'Minimum similarity threshold (0-1)'
            },
            operationType: {
                type: 'string',
                enum: ['write', 'edit', 'notebook_edit', 'create', 'update', 'delete'],
                description: 'Filter by operation type'
            },
            language: {
                type: 'string',
                description: 'Filter by programming language'
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by tags'
            },
            latestVersionOnly: {
                type: 'boolean',
                default: true,
                description: 'Only return the latest version of each file'
            }
        },
        required: ['query']
    };
    constructor(recall) {
        this.recall = recall;
    }
    async execute(params) {
        logger.info({
            query: params.query.slice(0, 100)
        }, 'what_did_i_write_for called');
        try {
            const results = await this.recall.whatDidIWriteFor(params.query, {
                limit: params.limit,
                threshold: params.threshold,
                operationType: params.operationType,
                language: params.language,
                tags: params.tags,
                latestVersionOnly: params.latestVersionOnly ?? true
            });
            return {
                results: results.map(r => ({
                    file: r.code.filePath,
                    code: r.code.codeContent.slice(0, 2000), // truncate for response
                    purpose: r.code.purpose,
                    similarity: Math.round(r.similarity * 100) / 100,
                    when: r.code.createdAt.toISOString(),
                    version: r.code.version,
                    highlights: r.highlights
                })),
                count: results.length,
                query: params.query
            };
        }
        catch (error) {
            logger.error({ error }, 'what_did_i_write_for failed');
            return {
                results: [],
                count: 0,
                query: params.query
            };
        }
    }
}
/**
 * AllMyCodeTool - list all code Claude wrote
 *
 * skids cant find this code but Claude can lmao
 * get a comprehensive list of all code activities
 */
export class AllMyCodeTool {
    recall;
    name = 'all_my_code';
    description = 'List all code you have written. Get a comprehensive view of all your code activities with filtering and pagination.';
    inputSchema = {
        type: 'object',
        properties: {
            limit: {
                type: 'number',
                default: 20,
                description: 'Max entries to return'
            },
            offset: {
                type: 'number',
                default: 0,
                description: 'Offset for pagination'
            },
            operationType: {
                type: 'string',
                enum: ['write', 'edit', 'notebook_edit', 'create', 'update', 'delete'],
                description: 'Filter by operation type'
            },
            language: {
                type: 'string',
                description: 'Filter by language'
            },
            orderBy: {
                type: 'string',
                enum: ['created', 'updated', 'file_path', 'version'],
                default: 'created',
                description: 'Sort field'
            },
            orderDirection: {
                type: 'string',
                enum: ['asc', 'desc'],
                default: 'desc',
                description: 'Sort direction'
            }
        }
    };
    constructor(recall) {
        this.recall = recall;
    }
    async execute(params) {
        logger.info({ params }, 'all_my_code called');
        try {
            const entries = await this.recall.allTheCodeIWrote({
                limit: params.limit,
                offset: params.offset,
                operationType: params.operationType,
                language: params.language,
                orderBy: params.orderBy,
                orderDirection: params.orderDirection
            });
            return {
                entries: entries.map(e => ({
                    id: e.id,
                    file: e.filePath,
                    purpose: e.purpose,
                    operation: e.operationType,
                    language: e.language,
                    version: e.version,
                    when: e.createdAt.toISOString(),
                    codePreview: e.codeContent.slice(0, 200) + (e.codeContent.length > 200 ? '...' : '')
                })),
                total: entries.length,
                offset: params.offset ?? 0,
                limit: params.limit ?? 20
            };
        }
        catch (error) {
            logger.error({ error }, 'all_my_code failed');
            return {
                entries: [],
                total: 0,
                offset: params.offset ?? 0,
                limit: params.limit ?? 20
            };
        }
    }
}
/**
 * CodeHistoryTool - get version history for a file
 *
 * see how Claude's code evolved over time
 * track all changes made to a specific file
 */
export class CodeHistoryTool {
    recall;
    name = 'code_history';
    description = 'Get the full version history of code you wrote for a specific file. See how the code evolved over time.';
    inputSchema = {
        type: 'object',
        properties: {
            filePath: {
                type: 'string',
                description: 'The file path to get history for'
            }
        },
        required: ['filePath']
    };
    constructor(recall) {
        this.recall = recall;
    }
    async execute(params) {
        logger.info({ filePath: params.filePath }, 'code_history called');
        try {
            const timeline = await this.recall.getCodeHistory(params.filePath);
            return {
                file: params.filePath,
                versions: timeline.map(t => ({
                    id: t.code.id,
                    version: t.code.version,
                    purpose: t.code.purpose,
                    operation: t.code.operationType,
                    when: t.code.createdAt.toISOString(),
                    codePreview: t.code.codeContent.slice(0, 300) + (t.code.codeContent.length > 300 ? '...' : ''),
                    hasPrevious: !!t.prevVersion,
                    hasNext: !!t.nextVersion
                })),
                totalVersions: timeline.length
            };
        }
        catch (error) {
            logger.error({ error }, 'code_history failed');
            return {
                file: params.filePath,
                versions: [],
                totalVersions: 0
            };
        }
    }
}
/**
 * WhyDidIWriteThisTool - understand why code was written
 *
 * fr fr helps Claude understand its own decisions
 * get full context including related code and history
 */
export class WhyDidIWriteThisTool {
    recall;
    name = 'why_did_i_write_this';
    description = 'Understand why you wrote a specific piece of code. Get the full context including purpose, conversation context, related code, and previous versions.';
    inputSchema = {
        type: 'object',
        properties: {
            codeId: {
                type: 'string',
                description: 'The ID of the code entry to explain'
            }
        },
        required: ['codeId']
    };
    constructor(recall) {
        this.recall = recall;
    }
    async execute(params) {
        logger.info({ codeId: params.codeId }, 'why_did_i_write_this called');
        try {
            const result = await this.recall.whyDidIWriteThis(params.codeId);
            if (!result) {
                return { found: false };
            }
            return {
                found: true,
                purpose: result.purpose,
                context: result.context,
                file: result.code.filePath,
                code: result.code.codeContent.slice(0, 2000),
                relatedCode: result.relatedCode.map(r => ({
                    file: r.filePath,
                    purpose: r.purpose,
                    when: r.createdAt.toISOString()
                })),
                previousVersions: result.previousVersions.map(v => ({
                    version: v.version,
                    purpose: v.purpose,
                    when: v.createdAt.toISOString()
                }))
            };
        }
        catch (error) {
            logger.error({ error }, 'why_did_i_write_this failed');
            return { found: false };
        }
    }
}
/**
 * SetCodingPurposeTool - set purpose BEFORE writing code
 *
 * yooo set the context before you start coding
 * this helps the tracker know why files are being modified
 */
export class SetCodingPurposeTool {
    tracker;
    name = 'set_coding_purpose';
    description = 'Set the purpose for upcoming code edits BEFORE you start writing. This helps track WHY you are making changes.';
    inputSchema = {
        type: 'object',
        properties: {
            filePaths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files you are about to edit'
            },
            purpose: {
                type: 'string',
                description: 'WHY are you making these changes?'
            },
            relatedFiles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Other related files'
            },
            conversationContext: {
                type: 'string',
                description: 'Context from the conversation'
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags for categorization'
            }
        },
        required: ['filePaths', 'purpose']
    };
    constructor(tracker) {
        this.tracker = tracker;
    }
    async execute(params) {
        logger.info({
            files: params.filePaths,
            purpose: params.purpose.slice(0, 100)
        }, 'set_coding_purpose called');
        try {
            this.tracker.setPurposeForNextEdits(params.filePaths, params.purpose, {
                relatedFiles: params.relatedFiles,
                conversationContext: params.conversationContext,
                tags: params.tags
            });
            return {
                success: true,
                filesSet: params.filePaths,
                message: `Purpose set for ${params.filePaths.length} file(s). The tracker will use this context for the next edits.`
            };
        }
        catch (error) {
            logger.error({ error }, 'set_coding_purpose failed');
            return {
                success: false,
                filesSet: [],
                message: error instanceof Error ? error.message : 'Failed to set purpose'
            };
        }
    }
}
/**
 * CodeStatsTool - get statistics about Claude's code
 *
 * how much has Claude written? lets see the stats
 */
export class CodeStatsTool {
    recall;
    name = 'code_stats';
    description = 'Get statistics about all the code you have written. See totals, breakdowns by language and operation type, and more.';
    inputSchema = {
        type: 'object',
        properties: {}
    };
    constructor(recall) {
        this.recall = recall;
    }
    async execute(_params) {
        logger.info('code_stats called');
        try {
            const stats = await this.recall.getCodeStats();
            return {
                totalEntries: stats.totalEntries,
                uniqueFiles: stats.uniqueFiles,
                byOperation: stats.byOperation,
                byLanguage: stats.byLanguage,
                totalCharacters: stats.totalCharacters,
                avgCodeLength: stats.avgCodeLength,
                oldestCode: stats.oldestCode?.toISOString() ?? null,
                newestCode: stats.newestCode?.toISOString() ?? null
            };
        }
        catch (error) {
            logger.error({ error }, 'code_stats failed');
            return {
                totalEntries: 0,
                uniqueFiles: 0,
                byOperation: {},
                byLanguage: {},
                totalCharacters: 0,
                avgCodeLength: 0,
                oldestCode: null,
                newestCode: null
            };
        }
    }
}
// ============================================================================
// FACTORY: Create all memorization tools
// ============================================================================
/**
 * createMemorizationTools - create all the memorization MCP tools
 *
 * fr fr this is where we assemble the squad
 */
export function createMemorizationTools(memorizer, recall, tracker) {
    return [
        new RememberWhatIWroteTool(memorizer),
        new WhatDidIWriteForTool(recall),
        new AllMyCodeTool(recall),
        new CodeHistoryTool(recall),
        new WhyDidIWriteThisTool(recall),
        new SetCodingPurposeTool(tracker),
        new CodeStatsTool(recall)
    ];
}
//# sourceMappingURL=memorizationTools.js.map