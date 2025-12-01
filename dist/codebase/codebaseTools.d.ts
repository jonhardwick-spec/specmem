import { z } from 'zod';
import { ConnectionPoolGoBrrr } from '../db/connectionPoolGoBrrr.js';
import { EmbeddingProvider } from '../tools/index.js';
import { MCPTool } from '../mcp/toolRegistry.js';
/**
 * Input schemas for all the codebase tools
 */
export declare const IngestCodebaseInput: z.ZodObject<{
    rootPath: z.ZodString;
    additionalExclusions: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    maxFileSizeBytes: z.ZodOptional<z.ZodNumber>;
    generateEmbeddings: z.ZodDefault<z.ZodBoolean>;
    includeHiddenFiles: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    maxFileSizeBytes?: number;
    generateEmbeddings?: boolean;
    rootPath?: string;
    additionalExclusions?: string[];
    includeHiddenFiles?: boolean;
}, {
    maxFileSizeBytes?: number;
    generateEmbeddings?: boolean;
    rootPath?: string;
    additionalExclusions?: string[];
    includeHiddenFiles?: boolean;
}>;
export declare const FindInCodebaseInput: z.ZodObject<{
    query: z.ZodString;
    limit: z.ZodDefault<z.ZodNumber>;
    threshold: z.ZodDefault<z.ZodNumber>;
    languageFilter: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    pathPattern: z.ZodOptional<z.ZodString>;
    excludeChunks: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    query?: string;
    limit?: number;
    threshold?: number;
    languageFilter?: string[];
    pathPattern?: string;
    excludeChunks?: boolean;
}, {
    query?: string;
    limit?: number;
    threshold?: number;
    languageFilter?: string[];
    pathPattern?: string;
    excludeChunks?: boolean;
}>;
export declare const GetFileContentInput: z.ZodEffects<z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    filePath: z.ZodOptional<z.ZodString>;
    includeEmbedding: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    id?: string;
    filePath?: string;
    includeEmbedding?: boolean;
}, {
    id?: string;
    filePath?: string;
    includeEmbedding?: boolean;
}>, {
    id?: string;
    filePath?: string;
    includeEmbedding?: boolean;
}, {
    id?: string;
    filePath?: string;
    includeEmbedding?: boolean;
}>;
export declare const ListFilesInput: z.ZodObject<{
    pathPattern: z.ZodOptional<z.ZodString>;
    languageFilter: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    limit: z.ZodDefault<z.ZodNumber>;
    offset: z.ZodDefault<z.ZodNumber>;
    orderBy: z.ZodDefault<z.ZodEnum<["path", "size", "lines", "modified"]>>;
    orderDirection: z.ZodDefault<z.ZodEnum<["asc", "desc"]>>;
}, "strip", z.ZodTypeAny, {
    limit?: number;
    offset?: number;
    orderBy?: "path" | "size" | "modified" | "lines";
    orderDirection?: "asc" | "desc";
    languageFilter?: string[];
    pathPattern?: string;
}, {
    limit?: number;
    offset?: number;
    orderBy?: "path" | "size" | "modified" | "lines";
    orderDirection?: "asc" | "desc";
    languageFilter?: string[];
    pathPattern?: string;
}>;
export declare const CodebaseStatsInput: z.ZodObject<{
    includeLanguageBreakdown: z.ZodDefault<z.ZodBoolean>;
    includeTopFiles: z.ZodDefault<z.ZodBoolean>;
    topFilesLimit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    includeLanguageBreakdown?: boolean;
    includeTopFiles?: boolean;
    topFilesLimit?: number;
}, {
    includeLanguageBreakdown?: boolean;
    includeTopFiles?: boolean;
    topFilesLimit?: number;
}>;
export declare const FindRelatedFilesInput: z.ZodEffects<z.ZodObject<{
    fileId: z.ZodOptional<z.ZodString>;
    filePath: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
    threshold: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit?: number;
    threshold?: number;
    filePath?: string;
    fileId?: string;
}, {
    limit?: number;
    threshold?: number;
    filePath?: string;
    fileId?: string;
}>, {
    limit?: number;
    threshold?: number;
    filePath?: string;
    fileId?: string;
}, {
    limit?: number;
    threshold?: number;
    filePath?: string;
    fileId?: string;
}>;
export declare const TextSearchInCodebaseInput: z.ZodObject<{
    query: z.ZodString;
    limit: z.ZodDefault<z.ZodNumber>;
    languageFilter: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    caseSensitive: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    query?: string;
    limit?: number;
    languageFilter?: string[];
    caseSensitive?: boolean;
}, {
    query?: string;
    limit?: number;
    languageFilter?: string[];
    caseSensitive?: boolean;
}>;
/**
 * Result types
 */
export interface CodebaseSearchResult {
    file: {
        id: string;
        filePath: string;
        fileName: string;
        language: string;
        lineCount: number;
        sizeBytes: number;
        isChunk: boolean;
        chunkIndex?: number;
        totalChunks?: number;
    };
    similarity: number;
    contentPreview: string;
}
export interface CodebaseStats {
    totalFiles: number;
    totalChunks: number;
    uniqueFiles: number;
    totalLines: number;
    totalBytes: number;
    languageBreakdown?: Record<string, {
        fileCount: number;
        lineCount: number;
        byteCount: number;
    }>;
    topFilesBySize?: Array<{
        filePath: string;
        sizeBytes: number;
        language: string;
    }>;
    topFilesByLines?: Array<{
        filePath: string;
        lineCount: number;
        language: string;
    }>;
    lastIngestionTime?: Date;
}
/**
 * IngestCodebaseTool - ingestThisWholeAssMfCodebase
 * scans and stores an entire codebase
 */
export declare class IngestCodebaseTool implements MCPTool {
    private pool;
    private embeddingProvider;
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            rootPath: {
                type: string;
                description: string;
            };
            additionalExclusions: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            maxFileSizeBytes: {
                type: string;
                description: string;
            };
            generateEmbeddings: {
                type: string;
                description: string;
            };
            includeHiddenFiles: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    constructor(pool: ConnectionPoolGoBrrr, embeddingProvider: EmbeddingProvider);
    execute(params: unknown): Promise<{
        success: boolean;
        message: string;
        stats: {
            totalFiles: number;
            storedFiles: number;
            chunkedFiles: number;
            totalChunks: number;
            skippedFiles: number;
            errorFiles: number;
            totalLines: number;
            totalBytes: number;
            durationMs: number;
        };
        languageBreakdown: Record<string, number>;
        errors: {
            file: string;
            error: string;
        }[];
    }>;
}
/**
 * FindInCodebaseTool - findCodeThatMatters
 * semantic search across all indexed files
 */
export declare class FindInCodebaseTool implements MCPTool {
    private pool;
    private embeddingProvider;
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            query: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                description: string;
            };
            threshold: {
                type: string;
                description: string;
            };
            languageFilter: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            pathPattern: {
                type: string;
                description: string;
            };
            excludeChunks: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    private dimensionService;
    constructor(pool: ConnectionPoolGoBrrr, embeddingProvider: EmbeddingProvider);
    private getDimService;
    execute(params: unknown): Promise<{
        query: string;
        resultCount: number;
        results: CodebaseSearchResult[];
    }>;
}
/**
 * GetFileContentTool - retrieve specific file content
 */
export declare class GetFileContentTool implements MCPTool {
    private pool;
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            id: {
                type: string;
                description: string;
            };
            filePath: {
                type: string;
                description: string;
            };
            includeEmbedding: {
                type: string;
                description: string;
            };
        };
    };
    constructor(pool: ConnectionPoolGoBrrr);
    execute(params: unknown): Promise<{
        found: boolean;
        message: string;
        file?: undefined;
        content?: undefined;
        contentHash?: undefined;
        embedding?: undefined;
    } | {
        found: boolean;
        file: {
            id: string;
            filePath: string;
            absolutePath: string;
            fileName: string;
            extension: string;
            language: {
                id: string;
                name: string;
                type: string;
            };
            sizeBytes: number;
            lineCount: number;
            charCount: number;
            lastModified: Date;
            isChunk: boolean;
            chunkIndex: number;
            totalChunks: number;
            originalFileId: string;
        };
        content: string;
        contentHash: string;
        embedding: number[];
        message?: undefined;
    }>;
}
/**
 * ListFilesTool - list indexed files with filtering
 */
export declare class ListFilesTool implements MCPTool {
    private pool;
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            pathPattern: {
                type: string;
                description: string;
            };
            languageFilter: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            limit: {
                type: string;
                description: string;
            };
            offset: {
                type: string;
                description: string;
            };
            orderBy: {
                type: string;
                enum: string[];
                description: string;
            };
            orderDirection: {
                type: string;
                enum: string[];
                description: string;
            };
        };
    };
    constructor(pool: ConnectionPoolGoBrrr);
    execute(params: unknown): Promise<{
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
        files: {
            id: any;
            filePath: any;
            fileName: any;
            language: any;
            sizeBytes: any;
            lineCount: any;
            lastModified: any;
        }[];
    }>;
}
/**
 * CodebaseStatsTool - codebaseStatsGoCrazy
 * comprehensive statistics about the indexed codebase
 */
export declare class CodebaseStatsTool implements MCPTool {
    private pool;
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            includeLanguageBreakdown: {
                type: string;
                description: string;
            };
            includeTopFiles: {
                type: string;
                description: string;
            };
            topFilesLimit: {
                type: string;
                description: string;
            };
        };
    };
    constructor(pool: ConnectionPoolGoBrrr);
    execute(params: unknown): Promise<CodebaseStats>;
}
/**
 * FindRelatedFilesTool - find files related to a given file
 */
export declare class FindRelatedFilesTool implements MCPTool {
    private pool;
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            fileId: {
                type: string;
                description: string;
            };
            filePath: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                description: string;
            };
            threshold: {
                type: string;
                description: string;
            };
        };
    };
    constructor(pool: ConnectionPoolGoBrrr);
    execute(params: unknown): Promise<{
        found: boolean;
        sourceFile: {
            id: string;
            filePath: string;
        };
        relatedCount: number;
        relatedFiles: {
            id: any;
            filePath: any;
            fileName: any;
            language: any;
            lineCount: any;
            sizeBytes: any;
            similarity: any;
        }[];
    } | {
        found: boolean;
        message: string;
        hasEmbedding?: undefined;
    } | {
        found: boolean;
        hasEmbedding: boolean;
        message: string;
    }>;
}
/**
 * TextSearchInCodebaseTool - full-text search across codebase
 */
export declare class TextSearchInCodebaseTool implements MCPTool {
    private pool;
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            query: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                description: string;
            };
            languageFilter: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            caseSensitive: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    constructor(pool: ConnectionPoolGoBrrr);
    execute(params: unknown): Promise<{
        query: string;
        resultCount: number;
        results: {
            file: {
                id: any;
                filePath: any;
                fileName: any;
                language: any;
                lineCount: any;
                sizeBytes: any;
                isChunk: boolean;
                chunkIndex: any;
                totalChunks: any;
            };
            matchCount: number;
            matchingLines: {
                lineNumber: number;
                content: string;
            }[];
        }[];
    }>;
}
/**
 * GetExclusionPatternsTool - see what patterns are being excluded
 */
export declare class GetExclusionPatternsTool implements MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {};
    };
    execute(): Promise<{
        defaultPatterns: string[];
        patternCount: number;
        description: string;
    }>;
}
/**
 * GetSupportedLanguagesTool - list all supported languages
 */
export declare class GetSupportedLanguagesTool implements MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            type: {
                type: string;
                enum: string[];
                description: string;
            };
        };
    };
    execute(params: {
        type?: string;
    }): Promise<{
        count: number;
        languages: {
            id: string;
            name: string;
            type: "data" | "config" | "programming" | "markup" | "prose";
            extensions: string[];
            supportsEmbeddings: boolean;
        }[];
    }>;
}
/**
 * GetCodePointersTool - understand how code connects
 *
 * answers questions like:
 * - "what files import this file?"
 * - "what calls this function?"
 * - "where is this class used?"
 *
 * traces through dependencies and definitions to show real connections
 */
export declare class GetCodePointersTool implements MCPTool {
    private pool;
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            filePath: {
                type: string;
                description: string;
            };
            symbol: {
                type: string;
                description: string;
            };
            lineNumber: {
                type: string;
                description: string;
            };
            direction: {
                type: string;
                enum: string[];
                description: string;
            };
            includeContent: {
                type: string;
                description: string;
            };
        };
    };
    constructor(pool: ConnectionPoolGoBrrr);
    execute(params: {
        filePath?: string;
        symbol?: string;
        lineNumber?: number;
        direction?: 'incoming' | 'outgoing' | 'both';
        includeContent?: boolean;
    }): Promise<{
        query: {
            filePath: string;
            symbol: string;
            lineNumber: number;
            direction: "both" | "incoming" | "outgoing";
        };
        incoming: {
            type: string;
            sourceFile: string;
            sourceLine?: number;
            importStatement?: string;
            symbol?: string;
            context?: string;
        }[];
        outgoing: {
            type: string;
            targetFile: string;
            targetLine?: number;
            importStatement?: string;
            symbol?: string;
            context?: string;
        }[];
        definitions: {
            file: string;
            line: number;
            type: string;
            name: string;
            signature?: string;
            content?: string;
        }[];
        summary: {
            incomingCount: number;
            outgoingCount: number;
            definitionCount: number;
            message: string;
        };
    }>;
    private getContextLines;
}
/**
 * GetRecentChangesTool - show recent file changes from history
 */
export declare class GetRecentChangesTool implements MCPTool {
    private pool;
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            limit: {
                type: string;
                description: string;
            };
            filePath: {
                type: string;
                description: string;
            };
            changeType: {
                type: string;
                enum: string[];
                description: string;
            };
            since: {
                type: string;
                description: string;
            };
            includeContent: {
                type: string;
                description: string;
            };
        };
    };
    constructor(pool: ConnectionPoolGoBrrr);
    execute(params: {
        limit?: number;
        filePath?: string;
        changeType?: 'add' | 'modify' | 'delete';
        since?: string;
        includeContent?: boolean;
    }): Promise<{
        changes: {
            id: any;
            filePath: any;
            changeType: any;
            detectedAt: any;
            fileModifiedAt: any;
            sizeDiff: number;
            linesDiff: number;
            linesAdded: any;
            linesRemoved: any;
            previousHash: any;
            newHash: any;
            metadata: any;
            previousContent: any;
            newContent: any;
        }[];
        count: number;
        hasMore: boolean;
    }>;
}
/**
 * GetFullPointerContextTool - the MEGA context tool
 *
 * gives you EVERYTHING about a file:
 * - full file content
 * - what imports this file (with their code)
 * - what this file imports (with their code)
 * - all definitions in the file
 * - all usages of exported symbols
 * - recent changes
 *
 * this is the "give me full context on this file" tool
 */
export declare class GetFullPointerContextTool implements MCPTool {
    private pool;
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            filePath: {
                type: string;
                description: string;
            };
            includeRelatedContent: {
                type: string;
                description: string;
            };
            relatedContentLines: {
                type: string;
                description: string;
            };
            maxRelatedFiles: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    constructor(pool: ConnectionPoolGoBrrr);
    execute(params: {
        filePath: string;
        includeRelatedContent?: boolean;
        relatedContentLines?: number;
        maxRelatedFiles?: number;
    }): Promise<{
        mainFile: {
            path: string;
            content: string;
            language: string;
            lineCount: number;
            sizeBytes: number;
        } | null;
        imports: Array<{
            targetPath: string;
            importStatement: string;
            importedSymbols: string[];
            line: number;
            isExternal: boolean;
            targetContent?: string;
        }>;
        importedBy: Array<{
            sourcePath: string;
            importStatement: string;
            importedSymbols: string[];
            line: number;
            sourceContent?: string;
        }>;
        definitions: Array<{
            name: string;
            type: string;
            line: number;
            signature?: string;
            usedBy: Array<{
                file: string;
                line: number;
                context?: string;
            }>;
        }>;
        recentChanges: Array<{
            changeType: string;
            detectedAt: Date;
            sizeDiff: number;
            linesDiff: number;
        }>;
        summary: {
            totalRelatedFiles: number;
            totalDefinitions: number;
            totalImports: number;
            totalImportedBy: number;
            totalUsages: number;
        };
    } | {
        error: boolean;
        message: string;
        suggestion: string;
    }>;
    private getContextLines;
    private extractRelevantContent;
}
/**
 * Factory function to create all codebase tools
 */
export declare function createCodebaseTools(pool: ConnectionPoolGoBrrr, embeddingProvider: EmbeddingProvider): MCPTool[];
//# sourceMappingURL=codebaseTools.d.ts.map