/**
 * claudeCodeTracker.ts - Track What Gets Written in Real-Time
 *
 * yooo this is the TRACKER that follows code activity
 * integrates with file watcher to auto-detect code writes
 *
 * Features:
 * - Auto-detect code operations from file changes
 * - Track edit patterns and purposes
 * - Maintain a session-based activity log
 * - Link consecutive edits to same purpose
 */
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { basename, extname } from 'path';
import { logger } from '../utils/logger.js';
import { getLanguageDetector } from '../codebase/languageDetection.js';
/**
 * CodeTracker - THE WATCHER that tracks code activity
 *
 * fr fr never forgets what was written because this tracker catches EVERYTHING
 */
export class CodeTracker {
    memorizer;
    config;
    currentSession = null;
    pendingEdits = new Map();
    recentFiles = new Map();
    // stats
    stats = {
        filesTracked: 0,
        filesSkipped: 0,
        sessionsCreated: 0,
        purposesDetected: 0,
        relatedFilesLinked: 0,
        errors: 0
    };
    constructor(memorizer, config = {}) {
        this.memorizer = memorizer;
        this.config = {
            sessionTimeoutMs: config.sessionTimeoutMs ?? 30 * 60 * 1000, // 30 min
            relatedFilesWindowMs: config.relatedFilesWindowMs ?? 5 * 60 * 1000, // 5 min
            maxContentSizeBytes: config.maxContentSizeBytes ?? 500 * 1024, // 500KB
            autoDetectPurpose: config.autoDetectPurpose ?? true,
            alwaysTrackPatterns: config.alwaysTrackPatterns ?? [],
            neverTrackPatterns: config.neverTrackPatterns ?? [
                '*.log',
                '*.tmp',
                '*.lock',
                'package-lock.json',
                'yarn.lock',
                'pnpm-lock.yaml'
            ]
        };
    }
    /**
     * onFileChange - main entry point for file watcher integration
     *
     * yooo file changed - lets track this
     */
    async onFileChange(event) {
        try {
            // skip if pattern is in never track list
            if (this.shouldSkip(event.path)) {
                this.stats.filesSkipped++;
                return;
            }
            // handle based on event type
            switch (event.type) {
                case 'add':
                case 'change':
                    await this.trackFileModification(event);
                    break;
                case 'unlink':
                    await this.trackFileDeletion(event);
                    break;
                default:
                    // skip directory events
                    break;
            }
        }
        catch (error) {
            this.stats.errors++;
            logger.error({ error, event }, 'tracker failed to process file change');
        }
    }
    /**
     * trackFileModification - track a file being added or modified
     *
     * fr fr this was probably written - lets remember it
     */
    async trackFileModification(event) {
        logger.debug({ path: event.relativePath }, 'tracking file modification');
        // read the file content
        const content = await this.readFileContent(event.path);
        if (!content) {
            return;
        }
        // check size limit
        if (content.length > this.config.maxContentSizeBytes) {
            logger.warn({
                path: event.relativePath,
                size: content.length,
                maxSize: this.config.maxContentSizeBytes
            }, 'file too large to auto-track');
            this.stats.filesSkipped++;
            return;
        }
        // ensure we have a session
        this.ensureSession();
        // get or detect purpose
        const editContext = this.getEditContext(event.relativePath, content);
        // determine operation type
        const operationType = event.type === 'add' ? 'create' : 'edit';
        // find related files from recent edits
        const relatedFiles = this.findRelatedFiles(event.relativePath);
        // memorize the code!
        const params = {
            filePath: event.relativePath,
            codeWritten: content,
            purpose: editContext.purpose,
            operationType,
            relatedFiles: [...editContext.relatedFiles, ...relatedFiles],
            tags: editContext.tags,
            conversationContext: editContext.conversationContext
        };
        await this.memorizer.rememberWhatIJustWrote(params);
        // update tracking state
        this.recentFiles.set(event.relativePath, new Date());
        this.updateSession(event.relativePath);
        this.stats.filesTracked++;
        logger.info({
            path: event.relativePath,
            purpose: editContext.purpose,
            operationType
        }, 'file modification tracked and memorized');
    }
    /**
     * trackFileDeletion - track a file being deleted
     *
     * nah bruh file got yeeted - still remembering this happened
     */
    async trackFileDeletion(event) {
        logger.debug({ path: event.relativePath }, 'tracking file deletion');
        // we cant read the content anymore, but we can log the deletion
        const params = {
            filePath: event.relativePath,
            codeWritten: `[FILE DELETED: ${event.relativePath}]`,
            purpose: 'File was deleted',
            operationType: 'delete',
            tags: ['deleted', 'file-removed']
        };
        await this.memorizer.rememberWhatIJustWrote(params);
        // remove from recent files
        this.recentFiles.delete(event.relativePath);
        this.stats.filesTracked++;
        logger.info({
            path: event.relativePath
        }, 'file deletion tracked');
    }
    /**
     * setPurposeForNextEdits - manually set the purpose for upcoming edits
     *
     *  can call this to set context for what it's about to write
     */
    setPurposeForNextEdits(filePaths, purpose, context) {
        for (const filePath of filePaths) {
            this.pendingEdits.set(filePath, {
                purpose,
                relatedFiles: context?.relatedFiles || [],
                conversationContext: context?.conversationContext,
                tags: context?.tags
            });
        }
        logger.info({
            files: filePaths,
            purpose
        }, 'purpose set for upcoming edits');
    }
    /**
     * clearPendingPurpose - clear pending purpose for files
     */
    clearPendingPurpose(filePaths) {
        for (const filePath of filePaths) {
            this.pendingEdits.delete(filePath);
        }
    }
    /**
     * getEditContext - get or auto-detect the edit context
     */
    getEditContext(filePath, content) {
        // check if we have a pending edit context
        const pending = this.pendingEdits.get(filePath);
        if (pending) {
            this.pendingEdits.delete(filePath);
            return pending;
        }
        // auto-detect purpose if enabled
        if (this.config.autoDetectPurpose) {
            const detectedPurpose = this.detectPurposeFromCode(filePath, content);
            if (detectedPurpose) {
                this.stats.purposesDetected++;
                return {
                    purpose: detectedPurpose,
                    relatedFiles: [],
                    tags: ['auto-detected-purpose']
                };
            }
        }
        // fallback to generic purpose
        const langDetector = getLanguageDetector();
        const langInfo = langDetector.detect(filePath);
        const fileName = basename(filePath);
        const operation = this.recentFiles.has(filePath) ? 'update' : 'create';
        return {
            purpose: `${operation === 'create' ? 'Created' : 'Updated'} ${langInfo?.name || 'file'}: ${fileName}`,
            relatedFiles: [],
            tags: []
        };
    }
    /**
     * detectPurposeFromCode - analyze code to guess what it does
     *
     * skids could never build this smart detection
     */
    detectPurposeFromCode(filePath, content) {
        const fileName = basename(filePath);
        const ext = extname(filePath).slice(1);
        // check for common patterns
        const patterns = [
            // test files
            { regex: /\.(test|spec)\.(ts|js|tsx|jsx)$/i, purpose: 'Added/updated test file' },
            { regex: /describe\(['"`].*['"`]/i, purpose: 'Added/updated tests' },
            { regex: /test\(['"`].*['"`]/i, purpose: 'Added/updated test cases' },
            { regex: /it\(['"`].*['"`]/i, purpose: 'Added/updated test cases' },
            // component files
            { regex: /export (default )?function \w+Component/i, purpose: 'Created/updated React component' },
            { regex: /export (default )?class \w+ extends (React\.)?Component/i, purpose: 'Created/updated React component' },
            { regex: /const \w+ = \(\) => {/i, purpose: 'Created/updated functional component' },
            // API/route files
            { regex: /router\.(get|post|put|delete|patch)/i, purpose: 'Added/updated API routes' },
            { regex: /app\.(get|post|put|delete|patch)/i, purpose: 'Added/updated API endpoints' },
            { regex: /export (async )?function (GET|POST|PUT|DELETE|PATCH)/i, purpose: 'Added/updated API handler' },
            // database/migration files
            { regex: /migration/i, purpose: 'Added/updated database migration' },
            { regex: /CREATE TABLE/i, purpose: 'Added database schema' },
            { regex: /ALTER TABLE/i, purpose: 'Updated database schema' },
            // configuration files
            { regex: /config\.(ts|js|json|yaml|yml)$/i, purpose: 'Updated configuration' },
            { regex: /\.env/i, purpose: 'Updated environment configuration' },
            // documentation
            { regex: /\.(md|mdx)$/i, purpose: 'Updated documentation' },
            { regex: /README/i, purpose: 'Updated README documentation' },
            // utilities/helpers
            { regex: /utils?\/|helpers?\//i, purpose: 'Added/updated utility functions' },
            { regex: /export function \w+/i, purpose: 'Added/updated utility function' },
            // hooks
            { regex: /use[A-Z]\w+/i, purpose: 'Added/updated React hook' },
            // types/interfaces
            { regex: /interface \w+ \{/i, purpose: 'Added/updated TypeScript interface' },
            { regex: /type \w+ =/i, purpose: 'Added/updated TypeScript type' },
            // classes
            { regex: /export (default )?class \w+/i, purpose: 'Added/updated class' },
            // MCP tools
            { regex: /implements MCPTool/i, purpose: 'Added/updated MCP tool' },
            { regex: /class \w+Tool/i, purpose: 'Added/updated tool implementation' }
        ];
        // check filename patterns first
        for (const { regex, purpose } of patterns) {
            if (regex.test(fileName)) {
                return purpose;
            }
        }
        // then check content patterns
        for (const { regex, purpose } of patterns) {
            if (regex.test(content)) {
                return purpose;
            }
        }
        return null;
    }
    /**
     * findRelatedFiles - find files edited around the same time
     */
    findRelatedFiles(currentFile) {
        const now = Date.now();
        const windowMs = this.config.relatedFilesWindowMs;
        const related = [];
        for (const [file, lastEdit] of this.recentFiles.entries()) {
            if (file !== currentFile) {
                const timeDiff = now - lastEdit.getTime();
                if (timeDiff < windowMs) {
                    related.push(file);
                    this.stats.relatedFilesLinked++;
                }
            }
        }
        return related;
    }
    /**
     * ensureSession - make sure we have an active session
     */
    ensureSession() {
        const now = new Date();
        // check if current session is still valid
        if (this.currentSession) {
            const timeSinceLastActivity = now.getTime() - this.currentSession.lastActivityAt.getTime();
            if (timeSinceLastActivity > this.config.sessionTimeoutMs) {
                // session expired, create new one
                this.currentSession = null;
            }
        }
        // create new session if needed
        if (!this.currentSession) {
            this.currentSession = {
                sessionId: createHash('md5')
                    .update(`${now.toISOString()}-${Math.random()}`)
                    .digest('hex')
                    .slice(0, 8),
                startedAt: now,
                lastActivityAt: now,
                filesModified: [],
                operationCount: 0
            };
            this.stats.sessionsCreated++;
            logger.info({ sessionId: this.currentSession.sessionId }, 'new tracking session started');
        }
    }
    /**
     * updateSession - update session with new activity
     */
    updateSession(filePath) {
        if (!this.currentSession)
            return;
        this.currentSession.lastActivityAt = new Date();
        this.currentSession.operationCount++;
        if (!this.currentSession.filesModified.includes(filePath)) {
            this.currentSession.filesModified.push(filePath);
        }
    }
    /**
     * shouldSkip - check if file should be skipped
     */
    shouldSkip(filePath) {
        const fileName = basename(filePath);
        // check never track patterns
        for (const pattern of this.config.neverTrackPatterns) {
            if (this.matchPattern(fileName, pattern)) {
                return true;
            }
        }
        // check always track patterns
        for (const pattern of this.config.alwaysTrackPatterns) {
            if (this.matchPattern(fileName, pattern)) {
                return false;
            }
        }
        return false;
    }
    /**
     * matchPattern - simple glob pattern matching
     */
    matchPattern(str, pattern) {
        const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        return new RegExp(`^${regexPattern}$`, 'i').test(str);
    }
    /**
     * readFileContent - safely read file content
     */
    async readFileContent(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return content;
        }
        catch (error) {
            logger.warn({ error, filePath }, 'failed to read file content');
            return null;
        }
    }
    /**
     * getCurrentSession - get current session info
     */
    getCurrentSession() {
        return this.currentSession;
    }
    /**
     * getStats - get tracker statistics
     */
    getStats() {
        return { ...this.stats };
    }
    /**
     * cleanup - clear old entries from recent files
     */
    cleanup() {
        const now = Date.now();
        const maxAge = this.config.relatedFilesWindowMs * 2;
        for (const [file, lastEdit] of this.recentFiles.entries()) {
            if (now - lastEdit.getTime() > maxAge) {
                this.recentFiles.delete(file);
            }
        }
    }
}
/**
 * Export singleton creator
 */
let _tracker = null;
export function getCodeTracker(memorizer, config) {
    if (!_tracker && memorizer) {
        _tracker = new CodeTracker(memorizer, config);
    }
    if (!_tracker) {
        throw new Error('CodeTracker not initialized');
    }
    return _tracker;
}
export function resetCodeTracker() {
    _tracker = null;
}
//# sourceMappingURL=claudeCodeTracker.js.map