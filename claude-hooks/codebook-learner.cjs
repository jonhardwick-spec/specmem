#!/usr/bin/env node
/**
 * CODEBOOK LEARNER - Thin wrapper for hooks directory
 * Full implementation in /specmem/dist/services/codebookLearner.cjs
 * Made by Hardwick Software · justcalljon.pro
 */
const path = require('path');

// Try SpecMem package first, then installed location
const locations = [
  '/specmem/dist/services/codebookLearner.cjs',
  '/usr/lib/node_modules/specmem-hardwicksoftware/dist/services/codebookLearner.cjs',
];

let mod;
for (const loc of locations) {
  try { mod = require(loc); break; } catch (e) { /* try next */ }
}

if (mod) {
  module.exports = mod;
} else {
  // Fallback: just the miss recorder (no Docker deps)
  const fs = require('fs');
  const MISS_LOG = '/tmp/specmem-compressor-misses.jsonl';
  function recordMiss(word) {
    if (!word || word.length < 4 || word.length > 30 || !/^[a-z]+$/.test(word)) return;
    try { fs.appendFileSync(MISS_LOG, JSON.stringify({ w: word, t: Date.now() }) + '\n'); } catch (e) {}
  }
  module.exports = { recordMiss };
}
