/**
 * EXCLUSION_CONFIG - central config for file exclusions
 * maxFileSize configurable via SPECMEM_MAX_FILE_SIZE env var
 */
export declare const EXCLUSION_CONFIG: {
    maxFileSize: number;
    excludePatterns: string[];
    skipLargeFiles: boolean;
};
/**
 * default exclusions - these are like the golden rules fr
 * we NEVER wanna ingest these folders/files
 */
declare const DEFAULT_EXCLUSIONS: string[];
/**
 * SkipTheBoringShit - the exclusion handler that keeps our db clean
 *
 * features that go hard:
 * - .gitignore style patterns
 * - glob pattern matching
 * - directory-specific rules
 * - custom .specmemignore file support
 * - negation patterns (! prefix)
 */
export declare class SkipTheBoringShit {
    private patterns;
    private customPatterns;
    private initialized;
    private rootPath;
    private stats;
    constructor(additionalExclusions?: string[]);
    /**
     * initialize - loads .specmemignore from project root if exists
     */
    initialize(rootPath: string): Promise<void>;
    /**
     * shouldSkip - the main check function
     * returns true if we should skip this path
     */
    shouldSkip(filePath: string, isDirectory?: boolean): boolean;
    /**
     * addPattern - adds a new exclusion pattern at runtime
     */
    addPattern(pattern: string, isCustom?: boolean): void;
    /**
     * removePattern - removes a pattern
     */
    removePattern(pattern: string): boolean;
    /**
     * getPatterns - returns all active patterns
     */
    getPatterns(): {
        defaults: string[];
        custom: string[];
    };
    /**
     * getStats - returns exclusion statistics
     */
    getStats(): {
        totalChecked: number;
        totalSkipped: number;
        skipRate: number;
        topSkippedPatterns: Array<{
            pattern: string;
            count: number;
        }>;
    };
    /**
     * resetStats - clears the statistics
     */
    resetStats(): void;
    /**
     * saveSpecmemignore - saves current custom patterns to .specmemignore
     */
    saveSpecmemignore(rootPath?: string): Promise<void>;
    private loadPatterns;
    private parsePattern;
    private matchPattern;
    private globToRegex;
    private escapeRegex;
    private normalizePath;
}
/**
 * isBinaryFile - check if file is binary using multiple methods
 *
 * detection order (fast to slow):
 * 1. extension check - O(1) lookup, catches most binaries
 * 2. magic bytes - read first 8 bytes, detect format
 * 3. null byte scan - binary files usually have null bytes
 * 4. non-text ratio - fallback for weird binary formats
 */
export declare function isBinaryFile(filePath: string): Promise<boolean>;
/**
 * getFileSizeBytes - gets file size without reading content
 */
export declare function getFileSizeBytes(filePath: string): Promise<number>;
/**
 * shouldSkipLargeFile - checks if file exceeds size limit
 * logs when skipping for debugging
 */
export declare function shouldSkipLargeFile(filePath: string): Promise<boolean>;
/**
 * isMinifiedOrBundled - quick pattern check for minified/bundled files
 * O(1) extension check + basename patterns
 */
export declare function isMinifiedOrBundled(filePath: string): boolean;
export declare function getExclusionHandler(projectPath?: string): SkipTheBoringShit;
export declare function resetExclusionHandler(projectPath?: string): void;
export declare function resetAllExclusionHandlers(): void;
export { DEFAULT_EXCLUSIONS };
//# sourceMappingURL=exclusions.d.ts.map