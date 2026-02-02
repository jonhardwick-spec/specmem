// yooo this is the CODEBASE module index
// all the goated codebase ingestion features in one place
// ingestThisWholeAssMfCodebase and friends live here
// ========================================
// EXCLUSIONS - skipTheBoringShit
// ========================================
export { SkipTheBoringShit, isBinaryFile, getFileSizeBytes, getExclusionHandler, resetExclusionHandler, DEFAULT_EXCLUSIONS } from './exclusions.js';
// ========================================
// LANGUAGE DETECTION - whatLanguageIsThis
// ========================================
export { WhatLanguageIsThis, getLanguageDetector, resetLanguageDetector, LANGUAGE_REGISTRY, EXTENSION_INDEX, FILENAME_MAPPINGS } from './languageDetection.js';
// ========================================
// INGESTION - ingestThisWholeAssMfCodebase
// ========================================
export { IngestThisWholeAssMfCodebase, YeetAllFilesIntoMemory, getIngestionEngine, resetIngestionEngine } from './ingestion.js';
// ========================================
// FILE WATCHER - keepItFresh
// ========================================
export { FileWatcherGoBrrr, createWatcherWithHandler, getFileWatcher, resetFileWatcher, hasWatcherForProject, getWatchedProjectPaths } from './fileWatcher.js';
// ========================================
// MCP TOOLS - the actual tools claude uses
// ========================================
export { 
// tool classes
IngestCodebaseTool, FindInCodebaseTool, GetFileContentTool, ListFilesTool, CodebaseStatsTool, FindRelatedFilesTool, TextSearchInCodebaseTool, GetExclusionPatternsTool, GetSupportedLanguagesTool, 
// factory function
createCodebaseTools, 
// input schemas
IngestCodebaseInput, FindInCodebaseInput, GetFileContentInput, ListFilesInput, CodebaseStatsInput, FindRelatedFilesInput, TextSearchInCodebaseInput } from './codebaseTools.js';
import { IngestThisWholeAssMfCodebase } from './ingestion.js';
import { FileWatcherGoBrrr } from './fileWatcher.js';
import { createCodebaseTools } from './codebaseTools.js';
import { logger } from '../utils/logger.js';
/**
 * initializeCodebaseSystem - sets up the entire codebase module
 *
 * call this once at startup after database is initialized
 * returns all the codebase tools ready to register with MCP
 */
export async function initializeCodebaseSystem(pool, embeddingProvider, watchOptions) {
    logger.info('initializing codebase system - about to ingest some code fr fr');
    // create ingestion engine
    const ingestionEngine = new IngestThisWholeAssMfCodebase(pool, embeddingProvider);
    // create file watcher if options provided
    let fileWatcher = null;
    if (watchOptions?.rootPath) {
        fileWatcher = new FileWatcherGoBrrr({
            rootPath: watchOptions.rootPath,
            debounceMs: 200,
            ignoreInitial: true
        });
        if (watchOptions.autoStart) {
            await fileWatcher.start();
        }
    }
    // create MCP tools
    const tools = createCodebaseTools(pool, embeddingProvider);
    logger.info({
        toolCount: tools.length,
        watcherActive: fileWatcher?.isActive() ?? false
    }, 'codebase system initialized - we ready to ingest');
    return {
        ingestionEngine,
        fileWatcher,
        tools
    };
}
/**
 * shutdownCodebaseSystem - cleanup on exit
 */
export function shutdownCodebaseSystem(context) {
    if (context.fileWatcher) {
        context.fileWatcher.stop();
    }
    logger.info('codebase system shut down - peace');
}
//# sourceMappingURL=index.js.map