/**
 * pathValidator.ts - File Path Security for SpecMem
 *
 * yo this module sanitizes all file paths
 * prevents directory traversal attacks and other sketchy stuff
 * no more ../../../etc/passwd fr fr
 *
 * Issue #36 fix - input sanitization on file paths
 */
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './logger.js';
const DEFAULT_CONFIG = {
    allowedBaseDirs: [], // Must be explicitly set
    maxPathLength: 4096,
    allowSymlinks: false,
    blockedPatterns: [
        /\.\./, // Directory traversal
        /^\/etc\//i, // System config
        /^\/var\/log/i, // System logs
        /^\/proc\//i, // Process info
        /^\/sys\//i, // System info
        /^\/dev\//i, // Device files
        /^~\//, // Home directory shorthand (use absolute paths)
        /\x00/, // Null bytes
        /[\r\n]/, // Newlines (injection)
    ],
    blockedFileNames: [
        '.env',
        '.env.local',
        '.env.production',
        'credentials.json',
        'secrets.json',
        '.ssh',
        '.aws',
        '.gnupg',
        'id_rsa',
        'id_ed25519',
        '.netrc',
        '.npmrc',
        '.pypirc',
    ]
};
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
export class PathValidator {
    config;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Validate and normalize a file path
     */
    validate(inputPath, basePath) {
        // Check for null/undefined
        if (!inputPath || typeof inputPath !== 'string') {
            return {
                valid: false,
                normalizedPath: null,
                error: 'Path must be a non-empty string'
            };
        }
        // Trim whitespace
        const trimmedPath = inputPath.trim();
        // Check length
        if (trimmedPath.length > this.config.maxPathLength) {
            return {
                valid: false,
                normalizedPath: null,
                error: `Path exceeds maximum length of ${this.config.maxPathLength}`,
                securityIssue: 'path_too_long'
            };
        }
        // Check for null bytes and newlines (injection attacks)
        if (/[\x00\r\n]/.test(trimmedPath)) {
            logger.warn({ path: trimmedPath.slice(0, 50) }, 'path contains dangerous characters');
            return {
                valid: false,
                normalizedPath: null,
                error: 'Path contains illegal characters',
                securityIssue: 'injection_attempt'
            };
        }
        // Check for directory traversal BEFORE normalization
        if (this.containsTraversal(trimmedPath)) {
            logger.warn({ path: trimmedPath }, 'directory traversal detected');
            return {
                valid: false,
                normalizedPath: null,
                error: 'Directory traversal not allowed',
                securityIssue: 'directory_traversal'
            };
        }
        // Check blocked patterns
        for (const pattern of this.config.blockedPatterns) {
            if (pattern.test(trimmedPath)) {
                logger.warn({ path: trimmedPath, pattern: pattern.toString() }, 'path matches blocked pattern');
                return {
                    valid: false,
                    normalizedPath: null,
                    error: 'Path matches blocked pattern',
                    securityIssue: 'blocked_pattern'
                };
            }
        }
        // Check blocked file names
        const fileName = path.basename(trimmedPath);
        if (this.config.blockedFileNames.includes(fileName) ||
            this.config.blockedFileNames.includes(fileName.toLowerCase())) {
            logger.warn({ path: trimmedPath, fileName }, 'blocked file name');
            return {
                valid: false,
                normalizedPath: null,
                error: 'Access to this file is not allowed',
                securityIssue: 'blocked_file'
            };
        }
        // Normalize the path
        let normalizedPath;
        try {
            if (basePath) {
                // Resolve relative to base path
                normalizedPath = path.resolve(basePath, trimmedPath);
            }
            else if (path.isAbsolute(trimmedPath)) {
                normalizedPath = path.normalize(trimmedPath);
            }
            else {
                // Relative path without base - resolve against cwd
                normalizedPath = path.resolve(process.cwd(), trimmedPath);
            }
        }
        catch (error) {
            return {
                valid: false,
                normalizedPath: null,
                error: 'Failed to normalize path'
            };
        }
        // Re-check for traversal after normalization
        if (basePath) {
            const normalizedBase = path.resolve(basePath);
            if (!normalizedPath.startsWith(normalizedBase + path.sep) && normalizedPath !== normalizedBase) {
                logger.warn({
                    inputPath: trimmedPath,
                    basePath,
                    resolvedPath: normalizedPath
                }, 'path escapes base directory');
                return {
                    valid: false,
                    normalizedPath: null,
                    error: 'Path must be within allowed directory',
                    securityIssue: 'path_escape'
                };
            }
        }
        // Check whitelist if configured
        if (this.config.allowedBaseDirs.length > 0) {
            const isAllowed = this.config.allowedBaseDirs.some(baseDir => {
                const normalizedBase = path.resolve(baseDir);
                return normalizedPath.startsWith(normalizedBase + path.sep) || normalizedPath === normalizedBase;
            });
            if (!isAllowed) {
                logger.warn({
                    path: normalizedPath,
                    allowedDirs: this.config.allowedBaseDirs
                }, 'path not in whitelist');
                return {
                    valid: false,
                    normalizedPath: null,
                    error: 'Path is not in allowed directories',
                    securityIssue: 'not_whitelisted'
                };
            }
        }
        // Check for symlinks if not allowed
        if (!this.config.allowSymlinks) {
            try {
                const stat = fs.lstatSync(normalizedPath);
                if (stat.isSymbolicLink()) {
                    logger.warn({ path: normalizedPath }, 'symlink not allowed');
                    return {
                        valid: false,
                        normalizedPath: null,
                        error: 'Symbolic links are not allowed',
                        securityIssue: 'symlink_blocked'
                    };
                }
            }
            catch {
                // File doesn't exist yet - that's OK
            }
        }
        return {
            valid: true,
            normalizedPath
        };
    }
    /**
     * Quick check for directory traversal patterns
     */
    containsTraversal(inputPath) {
        // Check for various traversal patterns
        const traversalPatterns = [
            /\.\.\//, // ../
            /\.\.\\/, // ..\
            /\.\.$/, // ends with ..
            /^\.\.$/, // just ..
            /%2e%2e/i, // URL encoded ..
            /%252e%252e/i, // Double URL encoded
            /\.\./, // Any ..
        ];
        return traversalPatterns.some(p => p.test(inputPath));
    }
    /**
     * Sanitize a filename (just the name, no path)
     */
    sanitizeFileName(fileName) {
        // Remove path separators
        let sanitized = fileName.replace(/[\/\\]/g, '_');
        // Remove null bytes and control characters
        sanitized = sanitized.replace(/[\x00-\x1f\x7f]/g, '');
        // Remove leading/trailing dots and spaces
        sanitized = sanitized.replace(/^[\s.]+|[\s.]+$/g, '');
        // Replace multiple underscores with single
        sanitized = sanitized.replace(/_+/g, '_');
        // Limit length
        if (sanitized.length > 255) {
            const ext = path.extname(sanitized);
            const base = path.basename(sanitized, ext);
            sanitized = base.slice(0, 255 - ext.length) + ext;
        }
        return sanitized || 'unnamed';
    }
    /**
     * Check if a path is within a specific directory
     */
    isWithinDirectory(targetPath, baseDir) {
        const normalizedTarget = path.resolve(targetPath);
        const normalizedBase = path.resolve(baseDir);
        return normalizedTarget.startsWith(normalizedBase + path.sep) ||
            normalizedTarget === normalizedBase;
    }
    /**
     * Get a safe relative path
     */
    getSafeRelativePath(fullPath, baseDir) {
        const validation = this.validate(fullPath, baseDir);
        if (!validation.valid || !validation.normalizedPath) {
            return null;
        }
        const normalizedBase = path.resolve(baseDir);
        return path.relative(normalizedBase, validation.normalizedPath);
    }
    /**
     * Add a directory to the whitelist
     */
    addAllowedBaseDir(dir) {
        const normalized = path.resolve(dir);
        if (!this.config.allowedBaseDirs.includes(normalized)) {
            this.config.allowedBaseDirs.push(normalized);
            logger.debug({ dir: normalized }, 'added to path whitelist');
        }
    }
    /**
     * Remove a directory from the whitelist
     */
    removeAllowedBaseDir(dir) {
        const normalized = path.resolve(dir);
        const index = this.config.allowedBaseDirs.indexOf(normalized);
        if (index > -1) {
            this.config.allowedBaseDirs.splice(index, 1);
            logger.debug({ dir: normalized }, 'removed from path whitelist');
        }
    }
}
// Singleton instance
let validatorInstance = null;
/**
 * Get the global path validator
 */
export function getPathValidator(config) {
    if (!validatorInstance) {
        validatorInstance = new PathValidator(config);
    }
    return validatorInstance;
}
/**
 * Reset the global path validator (for testing)
 */
export function resetPathValidator() {
    validatorInstance = null;
}
/**
 * Convenience function - validate a path
 */
export function validatePath(inputPath, basePath) {
    return getPathValidator().validate(inputPath, basePath);
}
/**
 * Convenience function - sanitize a filename
 */
export function sanitizeFileName(fileName) {
    return getPathValidator().sanitizeFileName(fileName);
}
/**
 * Convenience function - check if path is within directory
 */
export function isPathWithin(targetPath, baseDir) {
    return getPathValidator().isWithinDirectory(targetPath, baseDir);
}
//# sourceMappingURL=pathValidator.js.map