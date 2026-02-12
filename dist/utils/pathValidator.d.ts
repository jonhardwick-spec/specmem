/**
 * pathValidator.ts - File Path Security for SpecMem
 *
 * yo this module sanitizes all file paths
 * prevents directory traversal attacks and other sketchy stuff
 * no more ../../../etc/passwd fr fr
 *
 * Issue #36 fix - input sanitization on file paths
 */
/**
 * Path validation result
 */
export interface PathValidationResult {
    valid: boolean;
    normalizedPath: string | null;
    error?: string;
    securityIssue?: string;
}
/**
 * Path validator configuration
 */
export interface PathValidatorConfig {
    /** Allowed base directories (whitelist) */
    allowedBaseDirs: string[];
    /** Maximum path length */
    maxPathLength: number;
    /** Allow symlinks */
    allowSymlinks: boolean;
    /** Blocked path patterns (regex) */
    blockedPatterns: RegExp[];
    /** Blocked file names */
    blockedFileNames: string[];
}
/**
 * PathValidator - secure file path handling
 *
 * Features that keep us SAFE:
 * - Directory traversal detection
 * - Path normalization
 * - Whitelist enforcement
 * - Symlink protection
 * - Sensitive file blocking
 */
export declare class PathValidator {
    private config;
    constructor(config?: Partial<PathValidatorConfig>);
    /**
     * Validate and normalize a file path
     */
    validate(inputPath: string, basePath?: string): PathValidationResult;
    /**
     * Quick check for directory traversal patterns
     */
    private containsTraversal;
    /**
     * Sanitize a filename (just the name, no path)
     */
    sanitizeFileName(fileName: string): string;
    /**
     * Check if a path is within a specific directory
     */
    isWithinDirectory(targetPath: string, baseDir: string): boolean;
    /**
     * Get a safe relative path
     */
    getSafeRelativePath(fullPath: string, baseDir: string): string | null;
    /**
     * Add a directory to the whitelist
     */
    addAllowedBaseDir(dir: string): void;
    /**
     * Remove a directory from the whitelist
     */
    removeAllowedBaseDir(dir: string): void;
}
/**
 * Get the global path validator
 */
export declare function getPathValidator(config?: Partial<PathValidatorConfig>): PathValidator;
/**
 * Reset the global path validator (for testing)
 */
export declare function resetPathValidator(): void;
/**
 * Convenience function - validate a path
 */
export declare function validatePath(inputPath: string, basePath?: string): PathValidationResult;
/**
 * Convenience function - sanitize a filename
 */
export declare function sanitizeFileName(fileName: string): string;
/**
 * Convenience function - check if path is within directory
 */
export declare function isPathWithin(targetPath: string, baseDir: string): boolean;
//# sourceMappingURL=pathValidator.d.ts.map