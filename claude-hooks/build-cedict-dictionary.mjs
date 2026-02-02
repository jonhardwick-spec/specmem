#!/usr/bin/env node
/**
 * BUILD CEDICT DICTIONARY
 * =======================
 *
 * Parses CC-CEDICT data and builds an English → Traditional Chinese mapping
 * optimized for code context compression.
 *
 * Output: cedict-codes.json with format:
 * { "function": "函數", "variable": "變數", ... }
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the all.js data
const allPath = join(__dirname, '../node_modules/cc-cedict/data/all.js');
let allContent = readFileSync(allPath, 'utf8');

// Remove "export default " prefix
allContent = allContent.replace(/^export default /, '');

// Parse the JSON
const allData = JSON.parse(allContent);
const entries = allData.all;

console.log(`Loaded ${entries.length} CC-CEDICT entries`);

// Priority words for programming/tech contexts
const PRIORITY_WORDS = new Set([
  // Core programming
  'function', 'variable', 'parameter', 'argument', 'return', 'class', 'object',
  'array', 'string', 'number', 'boolean', 'null', 'undefined', 'type', 'value',
  'method', 'property', 'module', 'import', 'export', 'default', 'constant',
  'async', 'await', 'promise', 'callback', 'event', 'listener', 'handler',

  // Data structures
  'list', 'map', 'set', 'queue', 'stack', 'tree', 'graph', 'node', 'edge',
  'hash', 'key', 'index', 'element', 'item', 'collection', 'iterator',

  // Operations
  'create', 'read', 'update', 'delete', 'add', 'remove', 'insert', 'append',
  'push', 'pop', 'shift', 'filter', 'sort', 'search', 'find', 'get', 'set',
  'load', 'save', 'store', 'fetch', 'send', 'receive', 'request', 'response',
  'execute', 'run', 'call', 'invoke', 'apply', 'bind', 'start', 'stop',
  'initialize', 'configure', 'setup', 'build', 'compile', 'deploy', 'test',

  // System/Infrastructure
  'server', 'client', 'database', 'cache', 'memory', 'storage', 'file', 'path',
  'connection', 'socket', 'port', 'host', 'network', 'protocol', 'api', 'endpoint',
  'process', 'thread', 'worker', 'service', 'container', 'instance', 'cluster',

  // Error handling
  'error', 'exception', 'warning', 'log', 'debug', 'trace', 'throw', 'catch',
  'try', 'finally', 'handle', 'retry', 'timeout', 'fail', 'success',

  // State/Flow
  'state', 'status', 'result', 'output', 'input', 'data', 'context', 'scope',
  'local', 'global', 'public', 'private', 'static', 'dynamic', 'abstract',
  'if', 'else', 'then', 'while', 'for', 'loop', 'break', 'continue',

  // Web/UI
  'component', 'element', 'render', 'display', 'view', 'page', 'route', 'link',
  'button', 'form', 'input', 'submit', 'click', 'scroll', 'style', 'layout',

  // Common actions/descriptors
  'new', 'old', 'next', 'previous', 'first', 'last', 'current', 'default',
  'valid', 'invalid', 'empty', 'full', 'open', 'close', 'enable', 'disable',
  'active', 'inactive', 'pending', 'complete', 'ready', 'busy', 'idle',
  'available', 'required', 'optional', 'true', 'false', 'yes', 'no',

  // Documentation
  'example', 'note', 'warning', 'info', 'help', 'document', 'description',
  'summary', 'detail', 'reference', 'source', 'target', 'origin', 'destination',

  // Time
  'time', 'date', 'now', 'before', 'after', 'start', 'end', 'duration',
  'second', 'minute', 'hour', 'day', 'week', 'month', 'year', 'timestamp',

  // Quantities
  'count', 'total', 'size', 'length', 'width', 'height', 'max', 'min',
  'average', 'sum', 'limit', 'offset', 'range', 'percent', 'ratio',

  // Common verbs
  'use', 'make', 'take', 'give', 'have', 'be', 'do', 'go', 'come', 'see',
  'know', 'think', 'want', 'need', 'try', 'look', 'work', 'change', 'check',
  'show', 'hide', 'move', 'copy', 'paste', 'select', 'choose', 'pick',

  // Common nouns
  'name', 'user', 'admin', 'system', 'application', 'project', 'task', 'job',
  'message', 'notification', 'alert', 'report', 'log', 'record', 'entry',
  'session', 'token', 'auth', 'permission', 'role', 'group', 'team', 'member',
]);

// Build English → Traditional Chinese mapping
const engToTrad = new Map();

// Track all words found
let matched = 0;
let unmatched = 0;

for (const entry of entries) {
  const [traditional, simplified, pinyin, ...defs] = entry;

  // Get definitions (can be string or array)
  const definitions = Array.isArray(defs[0]) ? defs[0] : (typeof defs[0] === 'string' ? [defs[0]] : []);

  if (!traditional || traditional.length === 0) continue;

  for (const def of definitions) {
    if (!def) continue;

    // Extract individual words from the definition
    const words = def.toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);

    for (const word of words) {
      // Only process priority words for now
      if (!PRIORITY_WORDS.has(word)) continue;

      // Prefer shorter Traditional Chinese characters (more compact)
      if (!engToTrad.has(word) || traditional.length < engToTrad.get(word).length) {
        // Skip if Traditional is longer than 4 characters (diminishing returns)
        if (traditional.length <= 4) {
          engToTrad.set(word, traditional);
          matched++;
        }
      }
    }
  }
}

console.log(`\nMatched ${engToTrad.size} priority words`);
console.log(`Checking for missing priority words...`);

// Check which priority words weren't found
const missing = [...PRIORITY_WORDS].filter(w => !engToTrad.has(w));
console.log(`Missing: ${missing.length} words`);
if (missing.length > 0) {
  console.log(`Examples: ${missing.slice(0, 20).join(', ')}`);
}

// Convert to object and sort
const result = {};
const sorted = [...engToTrad.entries()].sort((a, b) => a[0].localeCompare(b[0]));
for (const [eng, trad] of sorted) {
  result[eng] = trad;
}

// Write output
const outputPath = join(__dirname, 'cedict-codes.json');
writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(`\nWrote ${Object.keys(result).length} entries to ${outputPath}`);

// Print sample entries
console.log('\n=== SAMPLE ENTRIES ===');
const samples = ['function', 'variable', 'return', 'class', 'object', 'array', 'database', 'error', 'file', 'message'];
for (const word of samples) {
  if (result[word]) {
    console.log(`${word} → ${result[word]}`);
  }
}
