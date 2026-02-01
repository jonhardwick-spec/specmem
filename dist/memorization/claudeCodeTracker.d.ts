/**
 * claudeCodeTracker.ts - Track What Claude Writes in Real-Time
 *
 * yooo this is the TRACKER that follows Claude's code activity
 * integrates with file watcher to auto-detect when Claude writes
 *
 * Features:
 * - Auto-detect Claude's code operations from file changes
 * - Track edit patterns and purposes
 * - Maintain a session-based activity log
 * - Link consecutive edits to same purpose
 */
import { CodeMemorizer } from './codeMemorizer.js';
import { FileChangeEvent } from '../watcher/fileWatcher.js';
/**
 * Session activity tracking
 */
export interface SessionActivity {
    sessionId: string;
    startedAt: Date;
    lastActivityAt: Date;
    filesModified: string[];
    operationCount: number;
    currentPurpose?: string;
}
/**
 * Edit context - helps Claude understand what it was doing
 */
export interface EditContext {
    purpose: string;
    relatedFiles: string[];
    conversationContext?: string;
    tags?: string[];
}
/**
 * Configuration for the tracker
 */
export interface TrackerConfig {
    sessionTimeoutMs?: number;
    relatedFilesWindowMs?: number;
    maxContentSizeBytes?: number;
    autoDetectPurpose?: boolean;
    alwaysTrackPatterns?: string[];
    neverTrackPatterns?: string[];
}
/**
 * ClaudeCodeTracker - THE WATCHER that tracks Claude's code activity
 *
 * fr fr Claude never forgets what it wrote because this tracker catches EVERYTHING
 */
export declare class ClaudeCodeTracker {
    private memorizer;
    private config;
    private currentSession;
    private pendingEdits;
    private recentFiles;
    private stats;
    constructor(memorizer: CodeMemorizer, config?: TrackerConfig);
    /**
     * onFileChange - main entry point for file watcher integration
     *
     * yooo file changed - lets see if Claude did this
     */
    onFileChange(event: FileChangeEvent): Promise<void>;
    /**
     * trackFileModification - track a file being added or modified
     *
     * fr fr Claude probably wrote this - lets remember it
     */
    private trackFileModification;
    /**
     * trackFileDeletion - track a file being deleted
     *
     * nah bruh file got yeeted - still remembering this happened
     */
    private trackFileDeletion;
    /**
     * setPurposeForNextEdits - manually set the purpose for upcoming edits
     *
     * Claude can call this to set context for what it's about to write
     */
    setPurposeForNextEdits(filePaths: string[], purpose: string, context?: {
        relatedFiles?: string[];
        conversationContext?: string;
        tags?: string[];
    }): void;
    /**
     * clearPendingPurpose - clear pending purpose for files
     */
    clearPendingPurpose(filePaths: string[]): void;
    /**
     * getEditContext - get or auto-detect the edit context
     */
    private getEditContext;
    /**
     * detectPurposeFromCode - analyze code to guess what it does
     *
     * skids could never build this smart detection
     */
    private detectPurposeFromCode;
    /**
     * findRelatedFiles - find files edited around the same time
     */
    private findRelatedFiles;
    /**
     * ensureSession - make sure we have an active session
     */
    private ensureSession;
    /**
     * updateSession - update session with new activity
     */
    private updateSession;
    /**
     * shouldSkip - check if file should be skipped
     */
    private shouldSkip;
    /**
     * matchPattern - simple glob pattern matching
     */
    private matchPattern;
    /**
     * readFileContent - safely read file content
     */
    private readFileContent;
    /**
     * getCurrentSession - get current session info
     */
    getCurrentSession(): SessionActivity | null;
    /**
     * getStats - get tracker statistics
     */
    getStats(): {
        filesTracked: number;
        filesSkipped: number;
        sessionsCreated: number;
        purposesDetected: number;
        relatedFilesLinked: number;
        errors: number;
    };
    /**
     * cleanup - clear old entries from recent files
     */
    cleanup(): void;
}
export declare function getClaudeCodeTracker(memorizer?: CodeMemorizer, config?: TrackerConfig): ClaudeCodeTracker;
export declare function resetClaudeCodeTracker(): void;
//# sourceMappingURL=claudeCodeTracker.d.ts.map