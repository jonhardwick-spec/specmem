/**
 * sessionWatcher.ts - Watches  Code session files for new entries
 *
 * Features:
 * - Watches ~/.claude/history.jsonl and project session files
 * - On init: Chunked DB loading with ACK verification
 * - Rate limited at 100MB/s via QOMS
 * - Hash-based deduplication (session_id + timestamp)
 * - Extracts USER messages, CLAUDE responses, and THINKING blocks
 * - Tags: role:user, role:assistant, has-thinking
 * - Content format: [USER] or [CLAUDE][THINKING] prefixes
 *
 * USER/CLAUDE PAIRING SUPPORT:
 * Each saved memory includes metadata fields for pairing:
 * - metadata.sessionId: Same for all messages in a session
 * - metadata.timestamp: ISO string from JSONL entry
 * - metadata.timestampMs: Numeric ms since epoch for efficient ordering
 * - metadata.role: 'user' or 'assistant'
 *
 * find_memory uses these to pair user prompts with claude responses by:
 * 1. Matching sessionId (same conversation)
 * 2. Finding closest opposite-role message by timestamp
 */
import { EmbeddingProvider } from '../tools/index.js';
import { DatabaseManager } from '../database.js';
export interface SessionWatcherConfig {
    claudeDir?: string;
    debounceMs?: number;
    autoStart?: boolean;
    verbose?: boolean;
    importance?: 'critical' | 'high' | 'medium' | 'low' | 'trivial';
    additionalTags?: string[];
}
export interface SessionWatcherStats {
    isWatching: boolean;
    totalProcessed: number;
    lastProcessedTime: Date | null;
    errors: number;
    historyPath: string;
    lastCheckTimestamp: number;
}
/**
 * SessionWatcher - watches and auto-extracts  sessions
 *
 * nah bruh this is THE watcher for  sessions
 * auto-updates specmem whenever you chat with 
 *
 * PROJECT-SCOPED: Only processes sessions belonging to the current project!
 * Sessions from other projects are filtered out to prevent cross-project pollution.
 */
export declare class SessionWatcher {
    private config;
    private watcher;
    private parser;
    private isWatching;
    private embeddingProvider;
    private db;
    private stats;
    private debouncedExtract;
    private heartbeatInterval;
    private lastFileEventTime;
    private lastFileModTimes;
    private lastHeartbeatCheck;
    private signalHandlersBound;
    private boundSignalHandler;
    private initialCatchUpDone;
    private initialCatchUpTimestamp;
    constructor(embeddingProvider: EmbeddingProvider, db: DatabaseManager, config?: SessionWatcherConfig);
    /**
     * startWatching - starts watching  history and project session files
     *
     * Watches:
     * - ~/.claude/history.jsonl (user prompts)
     * - ~/.claude/projects/ directories (full conversations)
     */
    startWatching(): Promise<void>;
    /**
     * stopWatching - stops watching the history file
     */
    stopWatching(): Promise<void>;
    /**
     * catchUpMissingSessions - streams and imports any missing sessions on init
     *
     * Features:
     * - Chunked loading with 100MB/s rate limiting via QOMS
     * - Hash-based deduplication (session_id + timestamp)
     * - ACK verification for each batch insert
     * - Logs SKIP for existing entries, INSERT with ACK for new entries
     *
     * PAIRING SUPPORT (for find_memory user/claude pairs):
     * Batch inserts preserve metadata with sessionId, timestamp, timestampMs, role
     * which enables find_memory to pair user prompts with claude responses later
     */
    private catchUpMissingSessions;
    /**
     * extractNewSessions - extracts and stores new sessions
     *
     * Features:
     * - Hash-based deduplication (session_id + timestamp)
     * - ACK verification for each insert
     * - Stores with [USER] or [CLAUDE][THINKING] formatted content
     *
     * PAIRING SUPPORT (for find_memory user/claude pairs):
     * Each saved memory includes metadata with:
     * - sessionId: groups all messages in a conversation
     * - timestamp/timestampMs: when the message was sent (from JSONL entry)
     * - role: 'user' or 'assistant'
     *
     * find_memory uses these to pair user prompts with claude responses
     * by matching sessionId + finding closest opposite-role message by timestamp
     */
    private extractNewSessions;
    /**
     * manualExtract - manually trigger extraction (for testing/debugging)
     *
     * yo fr fr force an extraction right now
     */
    manualExtract(): Promise<number>;
    /**
     * getStats - returns current watcher statistics
     */
    getStats(): SessionWatcherStats;
    /**
     * isActive - checks if watcher is currently running
     */
    isActive(): boolean;
    /**
     * FIX MED-46: checkFilesModified - checks if session files have changed since last heartbeat
     *
     * Compares file modification times against cached values to avoid redundant extraction.
     * Returns true if any file has been modified or is new since last check.
     */
    private checkFilesModified;
}
/**
 * Helper function to create watcher with default config
 */
export declare function createSessionWatcher(embeddingProvider: EmbeddingProvider, db: DatabaseManager, config?: SessionWatcherConfig): SessionWatcher;
//# sourceMappingURL=sessionWatcher.d.ts.map