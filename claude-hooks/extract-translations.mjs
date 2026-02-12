#!/usr/bin/env node
/**
 * EXTRACT TRANSLATIONS FROM CC-CEDICT
 * ====================================
 *
 * Extracts English → Traditional Chinese mappings by analyzing definitions.
 * Prioritizes single-word definitions that are exact matches.
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the all.js data
const allPath = join(__dirname, '../node_modules/cc-cedict/data/all.js');
let allContent = readFileSync(allPath, 'utf8');
allContent = allContent.replace(/^export default /, '');
const allData = JSON.parse(allContent);
const entries = allData.all || allData;

console.log(`Loaded ${entries.length} CC-CEDICT entries\n`);

// Build English → Traditional Chinese mapping
// Key insight: prioritize entries where the English definition IS the word (not contains it)
const exactMatches = new Map();  // Single-word exact definitions
const phraseMatches = new Map(); // Multi-word but starts with the target

for (const entry of entries) {
  const [traditional, simplified, pinyin, defs] = entry;
  if (!traditional || traditional.length === 0) continue;

  // Get definitions
  const definitions = Array.isArray(defs) ? defs : (typeof defs === 'string' ? [defs] : []);

  for (const def of definitions) {
    if (!def) continue;

    // Clean definition
    const cleaned = def.toLowerCase().trim();

    // Check for exact single-word match (best case!)
    if (/^[a-z]+$/.test(cleaned) && cleaned.length > 2) {
      // Prefer shorter Traditional characters
      if (!exactMatches.has(cleaned) || traditional.length < exactMatches.get(cleaned).length) {
        exactMatches.set(cleaned, traditional);
      }
    }

    // Check for "to X" pattern (verb definitions)
    const toMatch = cleaned.match(/^to ([a-z]+)$/);
    if (toMatch) {
      const verb = toMatch[1];
      if (!exactMatches.has(verb) || traditional.length < exactMatches.get(verb).length) {
        exactMatches.set(verb, traditional);
      }
    }

    // Check for "a/an X" pattern (noun definitions)
    const aMatch = cleaned.match(/^an? ([a-z]+)$/);
    if (aMatch) {
      const noun = aMatch[1];
      if (!exactMatches.has(noun) || traditional.length < exactMatches.get(noun).length) {
        exactMatches.set(noun, traditional);
      }
    }

    // Check for phrases that start with a single word followed by definition
    // e.g., "function (computing)" → function
    const parenMatch = cleaned.match(/^([a-z]+)\s*\(/);
    if (parenMatch) {
      const word = parenMatch[1];
      if (word.length > 2) {
        if (!phraseMatches.has(word) || traditional.length < phraseMatches.get(word).length) {
          phraseMatches.set(word, traditional);
        }
      }
    }
  }
}

console.log(`Found ${exactMatches.size} exact single-word matches`);
console.log(`Found ${phraseMatches.size} phrase matches\n`);

// Merge: exact matches take priority
const merged = new Map([...phraseMatches, ...exactMatches]);

// Programming-focused terms we want to ensure we have
const PROGRAMMING_TERMS = [
  // Core
  'function', 'method', 'class', 'object', 'variable', 'constant', 'parameter',
  'argument', 'return', 'value', 'type', 'array', 'string', 'number', 'boolean',
  'null', 'undefined', 'void', 'integer', 'float', 'double', 'byte', 'char',

  // Actions
  'create', 'read', 'update', 'delete', 'add', 'remove', 'insert', 'append',
  'push', 'pop', 'get', 'set', 'put', 'post', 'fetch', 'send', 'receive',
  'call', 'invoke', 'execute', 'run', 'start', 'stop', 'pause', 'resume',
  'load', 'save', 'store', 'write', 'open', 'close', 'connect', 'disconnect',
  'initialize', 'configure', 'setup', 'build', 'compile', 'deploy', 'test',
  'check', 'validate', 'verify', 'confirm', 'process', 'handle', 'manage',
  'filter', 'sort', 'search', 'find', 'match', 'replace', 'parse', 'format',
  'encode', 'decode', 'encrypt', 'decrypt', 'compress', 'decompress',
  'merge', 'split', 'join', 'concat', 'copy', 'move', 'rename', 'delete',

  // System
  'server', 'client', 'host', 'port', 'socket', 'connection', 'network',
  'database', 'table', 'column', 'row', 'query', 'index', 'key', 'schema',
  'file', 'folder', 'directory', 'path', 'buffer', 'stream', 'pipe',
  'process', 'thread', 'worker', 'task', 'job', 'queue', 'stack',
  'memory', 'cache', 'storage', 'disk', 'cpu', 'resource', 'container',

  // State
  'state', 'status', 'mode', 'flag', 'option', 'setting', 'config',
  'active', 'inactive', 'enabled', 'disabled', 'pending', 'complete',
  'success', 'failure', 'error', 'warning', 'info', 'debug', 'trace',
  'valid', 'invalid', 'empty', 'full', 'null', 'undefined', 'default',

  // Data
  'data', 'input', 'output', 'result', 'response', 'request', 'message',
  'event', 'signal', 'callback', 'promise', 'async', 'sync', 'await',
  'list', 'map', 'set', 'tree', 'graph', 'node', 'edge', 'link',
  'record', 'entry', 'item', 'element', 'field', 'property', 'attribute',

  // Web
  'page', 'view', 'component', 'element', 'template', 'layout', 'style',
  'route', 'path', 'url', 'link', 'anchor', 'button', 'form', 'input',
  'header', 'footer', 'body', 'content', 'text', 'image', 'icon', 'media',

  // Common
  'name', 'id', 'uuid', 'token', 'key', 'secret', 'password', 'hash',
  'user', 'admin', 'role', 'permission', 'access', 'auth', 'session',
  'time', 'date', 'timestamp', 'duration', 'interval', 'timeout', 'delay',
  'count', 'total', 'sum', 'average', 'max', 'min', 'limit', 'offset',
  'size', 'length', 'width', 'height', 'depth', 'level', 'position',
  'first', 'last', 'next', 'previous', 'current', 'parent', 'child',
  'source', 'target', 'origin', 'destination', 'from', 'to', 'with',
  'new', 'old', 'temp', 'backup', 'original', 'modified', 'updated',
];

// Check coverage
const found = [];
const missing = [];

for (const term of PROGRAMMING_TERMS) {
  if (merged.has(term)) {
    found.push({ term, trad: merged.get(term) });
  } else {
    missing.push(term);
  }
}

console.log(`Programming terms coverage: ${found.length}/${PROGRAMMING_TERMS.length}`);
console.log(`Missing: ${missing.slice(0, 30).join(', ')}${missing.length > 30 ? '...' : ''}\n`);

// Build final dictionary with only found terms (for programming focus)
// Plus all exact matches for general vocabulary
const finalDict = {};

// Add all exact matches (high quality)
for (const [eng, trad] of merged) {
  if (eng.length > 2 && eng.length < 20 && trad.length <= 4) {
    finalDict[eng] = trad;
  }
}

console.log(`Final dictionary: ${Object.keys(finalDict).length} entries\n`);

// Show samples
console.log('=== SAMPLE PROGRAMMING TERMS ===');
for (const term of PROGRAMMING_TERMS.slice(0, 30)) {
  const trad = finalDict[term];
  if (trad) {
    console.log(`  ${term.padEnd(15)} → ${trad}`);
  }
}

// Write output
const outputPath = join(__dirname, 'cedict-extracted.json');
writeFileSync(outputPath, JSON.stringify(finalDict, null, 2));
console.log(`\nWrote ${Object.keys(finalDict).length} entries to ${outputPath}`);

// Also print stats on character lengths
const lengths = {};
for (const trad of Object.values(finalDict)) {
  const len = trad.length;
  lengths[len] = (lengths[len] || 0) + 1;
}
console.log('\nCharacter length distribution:');
for (const [len, count] of Object.entries(lengths).sort((a, b) => a[0] - b[0])) {
  console.log(`  ${len} char: ${count} entries`);
}
