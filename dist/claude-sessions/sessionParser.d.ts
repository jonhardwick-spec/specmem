/**
 * sessionParser.ts - Claude Code Session File Parser
 *
 * Parses Claude Code session files to extract conversations:
 * - Reads from ~/.claude/history.jsonl (user prompts with metadata)
 * - Reads from ~/.claude/projects/ directories (full conversations)
 *
 * Features:
 * - Parses both history.jsonl and project session files (JSONL format)
 * - Extracts USER messages and ASSISTANT messages
 * - Extracts thinking blocks from Claude's responses
 * - Extracts tool_use blocks for context
 * - Tags messages properly: role:user, role:assistant, has-thinking
 * - Formats content: [USER] prefix or [CLAUDE] prefix with [THINKING] blocks
 * - Hash-based deduplication using session_id + timestamp
 * - Chunked loading with ACK verification
 *
 * DEDUPLICATION STRATEGY (FIX MED-44):
 * All entry points use standardized deduplication:
 * - generateEntryHash: sessionId + timestamp (for session-level dedup)
 * - generateContentHash: role + content (for content-level dedup)
 * - CASE-SENSITIVE: Do NOT lowercase content (FIX MED-28)
 *
 * USER/CLAUDE PAIRING METADATA:
 * convertToMemoryParams() sets these fields for find_memory pairing:
 * - sessionId: Same for all messages in a session (enables grouping)
 * - timestamp: ISO string from JSONL entry (when message was sent)
 * - timestampMs: Numeric ms since epoch (efficient comparison/ordering)
 * - role: 'user' or 'assistant' (message direction)
 * - messageId: Unique ID for this message (from uuid field in JSONL)
 */
import { StoreMemoryParams, MemoryType, ImportanceLevelType } from '../types/index.js';
import type { DatabaseManager } from '../database.js';
/**
 * Generate hash for deduplication based on session_id + timestamp
 * LEGACY: Used for backwards compatibility with existing hashes
 */
export declare function generateEntryHash(sessionId: string, timestamp: number | string): string;
/**
 * Generate content hash for deduplication based on actual content
 * This prevents storing the same message multiple times even if from different sources
 *
 * FIX MED-28: Removed .toLowerCase() - case normalization caused false deduplication
 * where "Fix bug" and "FIX BUG" would be treated as the same message.
 * We still normalize whitespace and remove prefixes but preserve case.
 */
export declare function generateContentHash(content: string, role: 'user' | 'assistant'): string;
/**
 * Message entry structure from session files (project/*.jsonl)
 */
export interface SessionMessageEntry {
    type: 'user' | 'assistant' | 'file-history-snapshot' | 'system' | 'summary' | 'queue-operation';
    userType?: string;
    message?: {
        role?: string;
        content?: string | Array<{
            type: string;
            text?: string;
            thinking?: string;
            name?: string;
            input?: unknown;
        }>;
        model?: string;
        id?: string;
    };
    timestamp: number | string;
    sessionId: string;
    uuid: string;
    parentUuid?: string;
    cwd?: string;
    project?: string;
    teamMemberId?: string;
}
/**
 * History.jsonl entry structure (user prompts only)
 */
export interface HistoryEntry {
    display: string;
    pastedContents: Record<string, unknown>;
    timestamp: number;
    project: string;
    sessionId: string;
}
export type ClaudeSessionEntry = HistoryEntry;
/**
 * Parsed session data with metadata
 */
export interface ParsedSession {
    id: string;
    hash: string;
    content: string;
    formattedContent: string;
    role: 'user' | 'assistant';
    timestamp: Date;
    project: string;
    sessionId: string;
    messageId?: string;
    model?: string;
    thinking?: string;
    toolCalls?: Array<{
        name: string;
        input: unknown;
    }>;
    pastedContent?: Record<string, unknown>;
    isContextRestoration?: boolean;
}
/**
 * Session extraction stats
 */
export interface SessionStats {
    totalEntries: number;
    validEntries: number;
    invalidEntries: number;
    uniqueSessions: number;
    userMessages: number;
    assistantMessages: number;
    oldestEntry: Date | null;
    newestEntry: Date | null;
    projectsFound: Set<string>;
}
/**
 * Rate limiting configuration for chunked loading
 * Target: 100MB/s throughput
 */
export interface ChunkingConfig {
    targetBytesPerSecond: number;
    chunkDelayMs: number;
    batchSize: number;
}
/**
 * ACK result for verified database writes
 */
export interface AckResult {
    success: boolean;
    insertedId?: string;
    error?: string;
    hash: string;
}
/**
 * ClaudeSessionParser - parses Claude Code session files
 *
 * Reads from:
 * - ~/.claude/history.jsonl (user prompts)
 * - ~/.claude/projects/ directories (full conversations with assistant responses)
 *
 * PROJECT FILTERING (FIX Task #13):
 * When projectPathFilter is provided, only parses session files that match the project.
 * This prevents wasted parsing of sessions from other projects.
 */
export declare class ClaudeSessionParser {
    private claudeDir;
    private projectsDir;
    private historyPath;
    private projectPathFilter;
    constructor(claudeDir?: string, projectPathFilter?: string | null);
    /**
     * FIX Task #13: Set project path filter after construction
     * Allows updating the filter for existing parser instances
     */
    setProjectPathFilter(projectPath: string | null): void;
    /**
     * Get all project directories containing session files
     *
     * FIX Task #13: When projectPathFilter is set, only returns directories
     * that match the current project path (encoded in directory name).
     * This enables early filtering BEFORE parsing files.
     */
    private getProjectDirectories;
    /**
     * Get all session files from all project directories
     * SORTED BY MODIFICATION TIME (newest first) for efficient catch-up
     */
    private getAllSessionFiles;
    /**
     * parseAllSessions - reads ALL session files from history.jsonl and project directories
     *
     * Reads both user prompts and Claude's responses including thinking blocks
     */
    parseAllSessions(): Promise<ParsedSession[]>;
    /**
     * parseHistoryJsonl - parses the history.jsonl file (user prompts only)
     *
     * FIX HIGH-30: Added parse error stats and warning logs instead of silent skip
     * FIX Task #13: Added early project filtering at entry level
     */
    private parseHistoryJsonl;
    /**
     * convertHistoryEntry - converts a history.jsonl entry to ParsedSession
     */
    private convertHistoryEntry;
    /**
     * parseSessionFile - reads and parses a single session file
     *
     * FIX HIGH-30: Added parse error stats and warning logs instead of silent skip
     * FIX Task #13: Added early project filtering at entry level
     */
    parseSessionFile(filePath: string): Promise<ParsedSession[]>;
    /**
     * FIX Task #13: Check if a project path matches the filter
     * Handles exact match, subdirectory match, and parent directory match
     */
    private matchesProjectFilter;
    /**
     * streamAllSessions - streams all session files with chunked loading and rate limiting
     *
     * Features:
     * - NEWEST FIRST: Files sorted by mtime, entries reversed within each file
     * - Memory-efficient: processes files in chunks
     * - Rate limited: 100MB/s throughput via QOMS
     * - Hash-based deduplication: skips entries with matching session_id + timestamp hash
     * - EARLY EXIT: Stops processing a file after N consecutive duplicates (already indexed)
     * - ACK logging: logs SKIP or INSERT for each entry
     */
    streamAllSessions(existingHashes: Set<string>, onBatch: (sessions: ParsedSession[]) => Promise<void>, batchSize?: number, config?: ChunkingConfig): Promise<{
        total: number;
        processed: number;
        skipped: number;
        bytesProcessed: number;
        earlyExitFiles: number;
        parseErrors: number;
    }>;
    /**
     * convertMessageEntry - converts a session entry to ParsedSession
     */
    private convertMessageEntry;
    /**
     * parseHistoryFile - LEGACY: reads history.jsonl for backwards compatibility
     * Now uses convertHistoryEntry for consistent formatting
     */
    parseHistoryFile(): Promise<ParsedSession[]>;
    /**
     * parseNewEntries - reads only new entries since a given timestamp
     *
     * FIX MED-47: Optimized to only parse files modified after sinceTimestamp
     * Uses file mtime filtering + streaming with early exit to avoid re-parsing all sessions
     */
    parseNewEntries(sinceTimestamp: number): Promise<ParsedSession[]>;
    /**
     * getSessionStats - analyzes session files and returns stats
     */
    getSessionStats(): Promise<SessionStats>;
    /**
     * convertToMemoryParams - converts parsed sessions to memory storage params
     *
     * Uses formattedContent which includes:
     * - [USER] prefix for user messages
     * - [CLAUDE] prefix for assistant messages with [THINKING] blocks
     *
     * Tags include:
     * - role:user or role:assistant
     * - has-thinking for messages with thinking blocks
     */
    convertToMemoryParams(sessions: ParsedSession[], options?: {
        importance?: ImportanceLevelType;
        memoryType?: MemoryType;
        additionalTags?: string[];
    }): StoreMemoryParams[];
    /**
     * getLastProcessedTimestamp - helper to get the last processed timestamp from DB
     */
    getLastProcessedTimestamp(db: DatabaseManager): Promise<number>;
    private isValidLegacyEntry;
}
/**
 * Helper function to create parser with default config
 *
 * FIX Task #13: Now accepts optional projectPathFilter for early filtering.
 * When provided, the parser will only process session files from directories
 * that could match the specified project path, avoiding wasteful parsing.
 */
export declare function createSessionParser(claudeDir?: string, projectPathFilter?: string): ClaudeSessionParser;
/**
 * isToolOrThinkingContent - checks if content is a tool call
 * These should be SKIPPED from memory storage as they pollute the database
 *
 * Patterns to skip:
 * - [Tools: ...] - tool call descriptions
 * - [Tool: ...] - individual tool patterns
 *
 * NOTE: We KEEP thinking blocks - they contain valuable reasoning!
 */
export declare function isToolOrThinkingContent(content: string): boolean;
/**
 * isContextRestoration - detects context restoration summaries
 *
 * Context restorations are injected when Claude's context window overflows.
 * They look like user messages but are actually system-generated summaries.
 *
 * These should be tagged differently so they don't pollute find_memory results
 * for actual user prompts.
 */
export declare function isContextRestoration(content: string): boolean;
//# sourceMappingURL=sessionParser.d.ts.map