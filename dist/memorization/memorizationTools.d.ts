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
import { MCPTool } from '../mcp/toolRegistry.js';
import { CodeMemorizer } from './codeMemorizer.js';
import { CodeRecall } from './codeRecall.js';
import { ClaudeCodeTracker } from './claudeCodeTracker.js';
export interface RememberWhatIWroteInput {
    filePath: string;
    codeWritten: string;
    purpose: string;
    operationType?: 'write' | 'edit' | 'notebook_edit' | 'create' | 'update' | 'delete';
    relatedFiles?: string[];
    tags?: string[];
    conversationContext?: string;
}
export interface RememberWhatIWroteOutput {
    success: boolean;
    codeId?: string;
    version?: number;
    message: string;
}
/**
 * RememberWhatIWroteTool - manually store code Claude just wrote
 *
 * yooo Claude just wrote some fire code lets memorize it
 * call this AFTER using Write, Edit, or NotebookEdit tools
 */
export declare class RememberWhatIWroteTool implements MCPTool<RememberWhatIWroteInput, RememberWhatIWroteOutput> {
    private memorizer;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            filePath: {
                type: string;
                description: string;
            };
            codeWritten: {
                type: string;
                description: string;
            };
            purpose: {
                type: string;
                description: string;
            };
            operationType: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            relatedFiles: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            tags: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            conversationContext: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    constructor(memorizer: CodeMemorizer);
    execute(params: RememberWhatIWroteInput): Promise<RememberWhatIWroteOutput>;
}
export interface WhatDidIWriteForInput {
    query: string;
    limit?: number;
    threshold?: number;
    operationType?: 'write' | 'edit' | 'notebook_edit' | 'create' | 'update' | 'delete';
    language?: string;
    tags?: string[];
    latestVersionOnly?: boolean;
}
export interface WhatDidIWriteForOutput {
    results: Array<{
        file: string;
        code: string;
        purpose: string;
        similarity: number;
        when: string;
        version: number;
        highlights?: string[];
    }>;
    count: number;
    query: string;
}
/**
 * WhatDidIWriteForTool - semantic search for code Claude wrote
 *
 * nah bruh no more massive explores needed fr
 * search for code by purpose, content, or context
 */
export declare class WhatDidIWriteForTool implements MCPTool<WhatDidIWriteForInput, WhatDidIWriteForOutput> {
    private recall;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            query: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                default: number;
                description: string;
            };
            threshold: {
                type: string;
                default: number;
                description: string;
            };
            operationType: {
                type: string;
                enum: string[];
                description: string;
            };
            language: {
                type: string;
                description: string;
            };
            tags: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            latestVersionOnly: {
                type: string;
                default: boolean;
                description: string;
            };
        };
        required: string[];
    };
    constructor(recall: CodeRecall);
    execute(params: WhatDidIWriteForInput): Promise<WhatDidIWriteForOutput>;
}
export interface AllMyCodeInput {
    limit?: number;
    offset?: number;
    operationType?: 'write' | 'edit' | 'notebook_edit' | 'create' | 'update' | 'delete';
    language?: string;
    orderBy?: 'created' | 'updated' | 'file_path' | 'version';
    orderDirection?: 'asc' | 'desc';
}
export interface AllMyCodeOutput {
    entries: Array<{
        id: string;
        file: string;
        purpose: string;
        operation: string;
        language: string;
        version: number;
        when: string;
        codePreview: string;
    }>;
    total: number;
    offset: number;
    limit: number;
}
/**
 * AllMyCodeTool - list all code Claude wrote
 *
 * skids cant find this code but Claude can lmao
 * get a comprehensive list of all code activities
 */
export declare class AllMyCodeTool implements MCPTool<AllMyCodeInput, AllMyCodeOutput> {
    private recall;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            limit: {
                type: string;
                default: number;
                description: string;
            };
            offset: {
                type: string;
                default: number;
                description: string;
            };
            operationType: {
                type: string;
                enum: string[];
                description: string;
            };
            language: {
                type: string;
                description: string;
            };
            orderBy: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            orderDirection: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
        };
    };
    constructor(recall: CodeRecall);
    execute(params: AllMyCodeInput): Promise<AllMyCodeOutput>;
}
export interface CodeHistoryInput {
    filePath: string;
}
export interface CodeHistoryOutput {
    file: string;
    versions: Array<{
        id: string;
        version: number;
        purpose: string;
        operation: string;
        when: string;
        codePreview: string;
        hasPrevious: boolean;
        hasNext: boolean;
    }>;
    totalVersions: number;
}
/**
 * CodeHistoryTool - get version history for a file
 *
 * see how Claude's code evolved over time
 * track all changes made to a specific file
 */
export declare class CodeHistoryTool implements MCPTool<CodeHistoryInput, CodeHistoryOutput> {
    private recall;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            filePath: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    constructor(recall: CodeRecall);
    execute(params: CodeHistoryInput): Promise<CodeHistoryOutput>;
}
export interface WhyDidIWriteThisInput {
    codeId: string;
}
export interface WhyDidIWriteThisOutput {
    found: boolean;
    purpose?: string;
    context?: string;
    file?: string;
    code?: string;
    relatedCode?: Array<{
        file: string;
        purpose: string;
        when: string;
    }>;
    previousVersions?: Array<{
        version: number;
        purpose: string;
        when: string;
    }>;
}
/**
 * WhyDidIWriteThisTool - understand why code was written
 *
 * fr fr helps Claude understand its own decisions
 * get full context including related code and history
 */
export declare class WhyDidIWriteThisTool implements MCPTool<WhyDidIWriteThisInput, WhyDidIWriteThisOutput> {
    private recall;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            codeId: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    constructor(recall: CodeRecall);
    execute(params: WhyDidIWriteThisInput): Promise<WhyDidIWriteThisOutput>;
}
export interface SetCodingPurposeInput {
    filePaths: string[];
    purpose: string;
    relatedFiles?: string[];
    conversationContext?: string;
    tags?: string[];
}
export interface SetCodingPurposeOutput {
    success: boolean;
    filesSet: string[];
    message: string;
}
/**
 * SetCodingPurposeTool - set purpose BEFORE writing code
 *
 * yooo set the context before you start coding
 * this helps the tracker know why files are being modified
 */
export declare class SetCodingPurposeTool implements MCPTool<SetCodingPurposeInput, SetCodingPurposeOutput> {
    private tracker;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            filePaths: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            purpose: {
                type: string;
                description: string;
            };
            relatedFiles: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            conversationContext: {
                type: string;
                description: string;
            };
            tags: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
        };
        required: string[];
    };
    constructor(tracker: ClaudeCodeTracker);
    execute(params: SetCodingPurposeInput): Promise<SetCodingPurposeOutput>;
}
export interface CodeStatsInput {
}
export interface CodeStatsOutput {
    totalEntries: number;
    uniqueFiles: number;
    byOperation: Record<string, number>;
    byLanguage: Record<string, number>;
    totalCharacters: number;
    avgCodeLength: number;
    oldestCode: string | null;
    newestCode: string | null;
}
/**
 * CodeStatsTool - get statistics about Claude's code
 *
 * how much has Claude written? lets see the stats
 */
export declare class CodeStatsTool implements MCPTool<CodeStatsInput, CodeStatsOutput> {
    private recall;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {};
    };
    constructor(recall: CodeRecall);
    execute(_params: CodeStatsInput): Promise<CodeStatsOutput>;
}
/**
 * createMemorizationTools - create all the memorization MCP tools
 *
 * fr fr this is where we assemble the squad
 */
export declare function createMemorizationTools(memorizer: CodeMemorizer, recall: CodeRecall, tracker: ClaudeCodeTracker): MCPTool[];
//# sourceMappingURL=memorizationTools.d.ts.map