export { SkipTheBoringShit, isBinaryFile, getFileSizeBytes, getExclusionHandler, resetExclusionHandler, DEFAULT_EXCLUSIONS } from './exclusions.js';
export { WhatLanguageIsThis, getLanguageDetector, resetLanguageDetector, LANGUAGE_REGISTRY, EXTENSION_INDEX, FILENAME_MAPPINGS, type LanguageInfo } from './languageDetection.js';
export { IngestThisWholeAssMfCodebase, YeetAllFilesIntoMemory, getIngestionEngine, resetIngestionEngine, type CodebaseFile, type IngestionProgress, type IngestionResult, type IngestionOptions } from './ingestion.js';
export { FileWatcherGoBrrr, createWatcherWithHandler, getFileWatcher, resetFileWatcher, hasWatcherForProject, getWatchedProjectPaths, type FileChangeEvent, type WatcherOptions, type WatcherStats, type CodebaseChangeHandler, type WatcherEvents } from './fileWatcher.js';
export { IngestCodebaseTool, FindInCodebaseTool, GetFileContentTool, ListFilesTool, CodebaseStatsTool, FindRelatedFilesTool, TextSearchInCodebaseTool, GetExclusionPatternsTool, GetSupportedLanguagesTool, createCodebaseTools, IngestCodebaseInput, FindInCodebaseInput, GetFileContentInput, ListFilesInput, CodebaseStatsInput, FindRelatedFilesInput, TextSearchInCodebaseInput, type CodebaseSearchResult, type CodebaseStats } from './codebaseTools.js';
import { ConnectionPoolGoBrrr } from '../db/connectionPoolGoBrrr.js';
import { EmbeddingProvider } from '../tools/index.js';
import { IngestThisWholeAssMfCodebase } from './ingestion.js';
import { FileWatcherGoBrrr } from './fileWatcher.js';
import { MCPTool } from '../mcp/toolRegistry.js';
/**
 * CodebaseContext - everything you need for codebase operations
 */
export interface CodebaseContext {
    ingestionEngine: IngestThisWholeAssMfCodebase;
    fileWatcher: FileWatcherGoBrrr | null;
    tools: MCPTool[];
}
/**
 * initializeCodebaseSystem - sets up the entire codebase module
 *
 * call this once at startup after database is initialized
 * returns all the codebase tools ready to register with MCP
 */
export declare function initializeCodebaseSystem(pool: ConnectionPoolGoBrrr, embeddingProvider: EmbeddingProvider, watchOptions?: {
    rootPath: string;
    autoStart?: boolean;
}): Promise<CodebaseContext>;
/**
 * shutdownCodebaseSystem - cleanup on exit
 */
export declare function shutdownCodebaseSystem(context: CodebaseContext): void;
//# sourceMappingURL=index.d.ts.map