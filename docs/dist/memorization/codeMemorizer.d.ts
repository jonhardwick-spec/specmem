/**
 * codeMemorizer.ts - Main Auto-Memorization System for Claude's Code
 *
 * yooo this is THE BRAIN that remembers everything Claude writes
 * no more massive explores - Claude will KNOW what it wrote and WHY
 *
 * fr fr when Claude writes code, this system:
 * 1. Captures the code that was written
 * 2. Stores it with rich metadata
 * 3. Tracks WHY it was written
 * 4. Links to related files
 * 5. Makes it all searchable
 */
import pg from 'pg';
import { EmbeddingProvider } from '../tools/index.js';
export type ClaudeOperationType = 'write' | 'edit' | 'notebook_edit' | 'create' | 'update' | 'delete';
/**
 * yooo parameters for remembering what Claude wrote
 */
export interface RememberCodeParams {
    filePath: string;
    codeWritten: string;
    purpose: string;
    operationType?: ClaudeOperationType;
    relatedFiles?: string[];
    tags?: string[];
    conversationContext?: string;
    metadata?: Record<string, unknown>;
    parentCodeId?: string;
}
/**
 * result from remembering code
 */
export interface RememberCodeResult {
    success: boolean;
    codeId?: string;
    message: string;
    version?: number;
}
/**
 * stored code entry from database
 */
export interface StoredCodeEntry {
    id: string;
    filePath: string;
    fileName: string;
    codeContent: string;
    codeHash: string;
    purpose: string;
    conversationContext?: string;
    operationType: ClaudeOperationType;
    language: string;
    relatedFiles: string[];
    relatedMemoryIds: string[];
    parentCodeId?: string;
    tags: string[];
    metadata: Record<string, unknown>;
    embedding?: number[];
    createdAt: Date;
    updatedAt: Date;
    version: number;
}
/**
 * CodeMemorizer - THE BRAIN that remembers Claude's code
 *
 * nah bruh Claude never forgets what it wrote now
 * this is the core system for auto-memorization
 */
export declare class CodeMemorizer {
    private pool;
    private embeddingProvider;
    private stats;
    constructor(pool: pg.Pool, embeddingProvider: EmbeddingProvider);
    /**
     * rememberWhatIJustWrote - THE MAIN METHOD
     *
     * yooo Claude just wrote some fire code lets memorize it
     * this is what gets called after Claude uses Write, Edit, or NotebookEdit
     */
    rememberWhatIJustWrote(params: RememberCodeParams): Promise<RememberCodeResult>;
    /**
     * yeetCodeIntoDb - insert the code into database
     *
     * fr fr this is where the magic happens
     */
    private yeetCodeIntoDb;
    /**
     * getNextVersion - get the next version number for a file
     *
     * tracking versions so we can see code evolution
     */
    private getNextVersion;
    /**
     * cookTheEmbeddings - generate embeddings for semantic search
     *
     * this is where we turn code + purpose into searchable vectors
     */
    private cookTheEmbeddings;
    /**
     * getCodeByFilePath - get all code entries for a file
     *
     * lets see what Claude wrote for this file
     */
    getCodeByFilePath(filePath: string, options?: {
        limit?: number;
        includeAllVersions?: boolean;
    }): Promise<StoredCodeEntry[]>;
    /**
     * getRecentCode - get recently memorized code
     *
     * fr fr what did Claude write recently?
     */
    getRecentCode(options?: {
        limit?: number;
        operationType?: ClaudeOperationType;
        language?: string;
    }): Promise<StoredCodeEntry[]>;
    /**
     * getCodeHistory - get version history for a file
     *
     * see how Claude's code evolved over time
     */
    getCodeHistory(filePath: string): Promise<StoredCodeEntry[]>;
    /**
     * mapRowToEntry - convert database row to typed entry
     */
    private mapRowToEntry;
    /**
     * getStats - return memorization statistics
     *
     * how much does Claude remember?
     */
    getStats(): {
        uniqueFilesCount: number;
        codesMemorized: number;
        totalCharacters: number;
        uniqueFiles: Set<string>;
        operationCounts: {
            write: number;
            edit: number;
            notebook_edit: number;
            create: number;
            update: number;
            delete: number;
        };
        errors: number;
        lastMemorizedAt: Date | null;
    };
    /**
     * linkToMemory - link code to a regular memory
     *
     * connecting code to memories for cross-referencing
     */
    linkToMemory(codeId: string, memoryId: string): Promise<void>;
}
export declare function getCodeMemorizer(pool?: pg.Pool, embeddingProvider?: EmbeddingProvider): CodeMemorizer;
export declare function resetCodeMemorizer(): void;
//# sourceMappingURL=codeMemorizer.d.ts.map