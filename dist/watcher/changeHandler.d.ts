/**
 * changeHandler.ts - Processes File Changes and Updates MCP Memories
 *
 * fr fr auto-updating these memories when files change
 * handles all CRUD operations on the memory database
 *
 * Features:
 * - Auto-ingest new files
 * - Update existing memories on file modification
 * - Mark deleted files (keep history)
 * - Handle file renames (update path, keep content)
 * - Content hashing for deduplication
 *
 * Now integrated with LWJEB event bus for file:changed, file:added, file:deleted events
 */
import { FileChangeEvent } from './fileWatcher.js';
import { MemoryYeeter } from '../db/yeetStuffInDb.js';
import { BigBrainSearchEngine } from '../db/findThatShit.js';
import { MemoryNuker } from '../db/nukeFromOrbit.js';
import { EmbeddingProvider } from '../tools/index.js';
export interface ChangeHandlerConfig {
    rootPath: string;
    embeddingProvider: EmbeddingProvider;
    yeeter: MemoryYeeter;
    search: BigBrainSearchEngine;
    nuker: MemoryNuker;
    pool: import('../db/connectionPoolGoBrrr.js').ConnectionPoolGoBrrr;
    maxFileSizeBytes?: number;
    autoDetectMetadata?: boolean;
    batchChanges?: boolean;
    batchWindowMs?: number;
}
export interface FileMetadata {
    path: string;
    relativePath: string;
    filename: string;
    extension: string;
    size: number;
    mtime: Date;
    contentHash: string;
}
/**
 * autoUpdateTheMemories - main change handler class
 *
 * yooo processing all them file changes rn
 * keeps MCP memories in sync with the filesystem
 *
 * Emits LWJEB events: file:changed, file:added, file:deleted
 */
export declare class AutoUpdateTheMemories {
    private config;
    private coordinator;
    private stats;
    constructor(config: ChangeHandlerConfig);
    /**
     * handleChange - main entry point for processing file changes
     *
     * fr fr dispatching to the right handler based on event type
     * Emits LWJEB file:changed event for all changes
     */
    handleChange(event: FileChangeEvent): Promise<void>;
    /**
     * handleFileAdded - ingest new file into MCP
     *
     * yooo new file just dropped - lets remember this
     */
    private handleFileAdded;
    /**
     * handleFileModified - update existing memory
     *
     * fr fr this file changed - updating memory now
     */
    private handleFileModified;
    /**
     * handleFileDeleted - remove file from both memories and codebase_files tables
     *
     * nah bruh file got yeeted - cleaning up both tables
     */
    private handleFileDeleted;
    /**
     * extractFileMetadata - reads file and generates metadata
     */
    private extractFileMetadata;
    /**
     * hashContent - generates SHA-256 hash of content
     */
    private hashContent;
    /**
     * findMemoryByFilePath - searches for memory by file path
     */
    private findMemoryByFilePath;
    /**
     * findMemoryByContentHash - searches for memory by content hash
     */
    private findMemoryByContentHash;
    /**
     * autoDetectMetadata - intelligently determines file importance and type
     *
     * skids could never build this smart detection
     */
    private autoDetectMetadata;
    /**
     * updateCodebaseFiles - UPSERTS file data into codebase_files table
     *
     * Uses try UPDATE, then INSERT pattern for atomic updates
     * Includes content, content_hash, embedding for semantic code search
     * Project-scoped via project_path column
     */
    private updateCodebaseFiles;
    /**
     * getLanguageType - maps extension to language type category
     */
    private getLanguageType;
    /**
     * getStats - returns handler statistics
     */
    getStats(): typeof this.stats;
    /**
     * resetStats - resets statistics
     */
    resetStats(): void;
}
//# sourceMappingURL=changeHandler.d.ts.map