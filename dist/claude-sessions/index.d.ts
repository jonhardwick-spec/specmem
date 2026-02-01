/**
 * claude-sessions/index.ts - Claude Session Extraction Module Exports
 *
 * Exports for Claude session parsing and watching:
 * - Parser for history.jsonl and project session files
 * - Watcher with chunked loading and ACK verification
 * - Hash-based deduplication utilities
 */
export { ClaudeSessionParser, createSessionParser, generateEntryHash } from './sessionParser.js';
export { ClaudeSessionWatcher, createSessionWatcher } from './sessionWatcher.js';
export type { ClaudeSessionEntry, HistoryEntry, SessionMessageEntry, ParsedSession, SessionStats, ChunkingConfig, AckResult } from './sessionParser.js';
export type { SessionWatcherConfig, SessionWatcherStats } from './sessionWatcher.js';
//# sourceMappingURL=index.d.ts.map