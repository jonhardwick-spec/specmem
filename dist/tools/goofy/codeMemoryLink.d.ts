/**
 * Code-Memory Link Service
 *
 * Correlates code search results with related memories from the codebase_pointers table.
 * Adds attribution based on memory role:
 * - 'requested_by_user': User explicitly asked for this feature/code
 * - 'implemented_by_claude': Claude created/modified this code
 * - 'discussed': Code was discussed but not explicitly requested
 *
 * This module is used by findCodePointers to enrich code search results with
 * context about WHY the code exists and WHO initiated it.
 */
import { DatabaseManager } from '../../database.js';
/**
 * Attribution type for Code-Memory Link
 */
export type CodeAttribution = 'requested_by_user' | 'implemented_by_claude' | 'discussed';
/**
 * Related memory link - connects code to its origin memory
 */
export interface RelatedMemoryLink {
    id: string;
    content_preview: string;
    attribution: CodeAttribution;
    similarity: number;
    timestamp?: string;
}
/**
 * Code search result with optional memory link
 */
export interface CodeResultWithMemory {
    file_path: string;
    name?: string;
    line_range?: {
        start: number;
        end: number;
    };
    memoryId?: string;
    attribution?: 'user' | 'assistant' | 'unknown';
    attributionNote?: string;
}
/**
 * CodeMemoryLinkService
 *
 * Correlates code with related memories and adds attribution
 */
export declare class CodeMemoryLinkService {
    private db;
    constructor(db: DatabaseManager);
    /**
     * Add related memory links to code results
     * Queries codebase_pointers to find memories that reference each code file
     * Adds attribution based on memory role (user/assistant)
     */
    addMemoryLinks<T extends CodeResultWithMemory>(results: T[]): Promise<void>;
    /**
     * Get default attribution note based on role
     */
    private getDefaultAttributionNote;
    /**
     * Find memories related to a specific code file
     * Returns detailed memory information for drill-down
     */
    findRelatedMemories(filePath: string, limit?: number): Promise<RelatedMemoryLink[]>;
    /**
     * Format attribution for human-readable display
     */
    static formatAttribution(attribution: CodeAttribution): string;
    /**
     * Format attribution with emoji for compact display
     */
    static formatAttributionCompact(attribution: CodeAttribution): string;
}
/**
 * Get or create the CodeMemoryLinkService instance for the current project
 */
export declare function getCodeMemoryLinkService(db: DatabaseManager, projectPath?: string): CodeMemoryLinkService;
/**
 * Reset service instance (for testing)
 */
export declare function resetCodeMemoryLinkService(projectPath?: string): void;
//# sourceMappingURL=codeMemoryLink.d.ts.map