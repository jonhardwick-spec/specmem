/**
 * claude-sessions/index.ts -  Session Extraction Module Exports
 *
 * Exports for  session parsing and watching:
 * - Parser for history.jsonl and project session files
 * - Watcher with chunked loading and ACK verification
 * - Hash-based deduplication utilities
 */
export { SessionParser, createSessionParser, generateEntryHash } from './sessionParser.js';
export { SessionWatcher, createSessionWatcher } from './sessionWatcher.js';
//# sourceMappingURL=index.js.map