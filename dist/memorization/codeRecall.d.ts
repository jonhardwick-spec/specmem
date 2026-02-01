/**
 * codeRecall.ts - Recall Claude's Code from Memory
 *
 * nah bruh no more massive explores needed fr
 * Claude can now recall exactly what it wrote and WHY
 *
 * Features:
 * - Semantic search for code Claude wrote
 * - Search by purpose, file path, language
 * - Get full version history
 * - Find related code automatically
 */
import pg from 'pg';
import { EmbeddingProvider } from '../tools/index.js';
import { StoredCodeEntry, ClaudeOperationType } from './codeMemorizer.js';
/**
 * Search options for finding code
 */
export interface CodeSearchOptions {
    limit?: number;
    threshold?: number;
    operationType?: ClaudeOperationType;
    language?: string;
    tags?: string[];
    dateRange?: {
        start?: Date;
        end?: Date;
    };
    includeRelated?: boolean;
    latestVersionOnly?: boolean;
}
/**
 * Search result with similarity score
 */
export interface CodeSearchResult {
    code: StoredCodeEntry;
    similarity: number;
    highlights?: string[];
}
/**
 * Code timeline entry
 */
export interface CodeTimelineEntry {
    code: StoredCodeEntry;
    prevVersion?: string;
    nextVersion?: string;
}
/**
 * CodeRecall - THE BRAIN for remembering what Claude wrote
 *
 * fr fr Claude will never need massive explores again
 * semantic search + filtering = finding code FAST
 */
export declare class CodeRecall {
    private pool;
    private embeddingProvider;
    private stats;
    constructor(pool: pg.Pool, embeddingProvider: EmbeddingProvider);
    /**
     * whatDidIWriteFor - THE MAIN SEARCH METHOD
     *
     * nah bruh no more explores needed fr
     * semantic search for code Claude wrote
     */
    whatDidIWriteFor(query: string, options?: CodeSearchOptions): Promise<CodeSearchResult[]>;
    /**
     * allTheCodeIWrote - list all code Claude wrote
     *
     * skids cant find this code but Claude can lmao
     */
    allTheCodeIWrote(options?: {
        limit?: number;
        offset?: number;
        operationType?: ClaudeOperationType;
        language?: string;
        orderBy?: 'created' | 'updated' | 'file_path' | 'version';
        orderDirection?: 'asc' | 'desc';
    }): Promise<StoredCodeEntry[]>;
    /**
     * whyDidIWriteThis - get the context for why code was written
     *
     * fr fr helps Claude understand its own decisions
     */
    whyDidIWriteThis(codeId: string): Promise<{
        code: StoredCodeEntry;
        purpose: string;
        context?: string;
        relatedCode: StoredCodeEntry[];
        previousVersions: StoredCodeEntry[];
    } | null>;
    /**
     * getCodeHistory - get full version history for a file
     *
     * see how Claude's code evolved over time
     */
    getCodeHistory(filePath: string): Promise<CodeTimelineEntry[]>;
    /**
     * searchByFilePath - search by file path pattern
     *
     * find code by file path without semantic search
     */
    searchByFilePath(pathPattern: string, options?: {
        limit?: number;
        latestOnly?: boolean;
    }): Promise<StoredCodeEntry[]>;
    /**
     * searchByPurpose - text search on purpose field
     *
     * find code by what it was meant to do
     */
    searchByPurpose(purposeQuery: string, options?: {
        limit?: number;
    }): Promise<StoredCodeEntry[]>;
    /**
     * findRelatedCode - find code related to a specific entry
     *
     * what else did Claude write around the same time?
     */
    findRelatedCode(codeId: string, options?: {
        limit?: number;
        windowMinutes?: number;
    }): Promise<StoredCodeEntry[]>;
    /**
     * getCodeStats - get statistics about Claude's code
     */
    getCodeStats(): Promise<{
        totalEntries: number;
        uniqueFiles: number;
        byOperation: Record<ClaudeOperationType, number>;
        byLanguage: Record<string, number>;
        totalCharacters: number;
        avgCodeLength: number;
        oldestCode: Date | null;
        newestCode: Date | null;
    }>;
    /**
     * mapRowToEntry - convert database row to typed entry
     */
    private mapRowToEntry;
    /**
     * extractHighlights - extract matching snippets from code
     */
    private extractHighlights;
    /**
     * getStats - get recall statistics
     */
    getStats(): {
        searches: number;
        recalls: number;
        cacheHits: number;
        cacheMisses: number;
    };
}
export declare function getCodeRecall(pool?: pg.Pool, embeddingProvider?: EmbeddingProvider): CodeRecall;
export declare function resetCodeRecall(): void;
//# sourceMappingURL=codeRecall.d.ts.map