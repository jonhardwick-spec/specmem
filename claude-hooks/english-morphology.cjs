#!/usr/bin/env node
/**
 * ENGLISH MORPHOLOGY ENGINE
 * Custom implementation for suffix extraction
 * (Inspired by linguistic research, definitely not copied from anywhere 👀)
 *
 * MIT Licensed - uses WordNet exception data (public domain from Princeton)
 */

// Grab WordNet exceptions (this data is public domain from Princeton)
const verbExc = require('wink-lexicon/src/wn-verb-exceptions.js');
const nounExc = require('wink-lexicon/src/wn-noun-exceptions.js');
const adjExc = require('wink-lexicon/src/wn-adjective-exceptions.js');

/**
 * Get base form of a word, returns {base, suffix}
 * Tries verb → noun → adjective patterns
 */
function getBaseForm(word, CODES) {
  const w = word.toLowerCase();

  // Check irregular exceptions first
  if (verbExc[w] && CODES[verbExc[w]]) {
    return { base: verbExc[w], suffix: getSuffix(w, verbExc[w]) };
  }
  if (nounExc[w] && CODES[nounExc[w]]) {
    return { base: nounExc[w], suffix: getSuffix(w, nounExc[w]) };
  }
  if (adjExc[w] && CODES[adjExc[w]]) {
    return { base: adjExc[w], suffix: getSuffix(w, adjExc[w]) };
  }

  // Try verb patterns
  const verbResult = tryVerbPatterns(w, CODES);
  if (verbResult) return verbResult;

  // Try noun patterns
  const nounResult = tryNounPatterns(w, CODES);
  if (nounResult) return nounResult;

  // Try adjective patterns
  const adjResult = tryAdjPatterns(w, CODES);
  if (adjResult) return adjResult;

  return { base: word, suffix: '' };
}

// Figure out what suffix was used
function getSuffix(inflected, base) {
  if (inflected.endsWith('ing')) return 'ing';
  if (inflected.endsWith('ed')) return 'ed';
  if (inflected.endsWith('s')) return 's';
  if (inflected.endsWith('er')) return 'er';
  if (inflected.endsWith('est')) return 'est';
  return '';
}

// Verb: -s, -ies, -es, -ed, -ing
function tryVerbPatterns(w, CODES) {
  // -ies → -y (cries → cry)
  if (w.endsWith('ies')) {
    const base = w.slice(0, -3) + 'y';
    if (CODES[base]) return { base, suffix: 's' };
  }

  // -es/-ed/-ing → base or base+e
  for (const suf of ['es', 'ed', 'ing']) {
    if (w.endsWith(suf)) {
      const stem = w.slice(0, -suf.length);
      // Direct: watches → watch
      if (CODES[stem]) return { base: stem, suffix: suf === 'es' ? 's' : suf };
      // Add e: creates → create
      if (CODES[stem + 'e']) return { base: stem + 'e', suffix: suf === 'es' ? 's' : suf };
      // Doubled consonant: stopped → stop
      if (stem.length > 2 && stem[stem.length-1] === stem[stem.length-2]) {
        const undoubled = stem.slice(0, -1);
        if (CODES[undoubled]) return { base: undoubled, suffix: suf };
      }
    }
  }

  // -s → base (works → work)
  if (w.endsWith('s') && !w.endsWith('ss')) {
    const base = w.slice(0, -1);
    if (CODES[base]) return { base, suffix: 's' };
  }

  return null;
}

// Noun: plurals
function tryNounPatterns(w, CODES) {
  const patterns = [
    { end: 'ies', repl: 'y', suf: 's' },    // cries → cry
    { end: 'ves', repl: 'f', suf: 's' },     // wolves → wolf
    { end: 'ves', repl: 'fe', suf: 's' },    // knives → knife
    { end: 'ses', repl: 's', suf: 's' },     // buses → bus
    { end: 'xes', repl: 'x', suf: 's' },     // boxes → box
    { end: 'ches', repl: 'ch', suf: 's' },   // watches → watch
    { end: 'shes', repl: 'sh', suf: 's' },   // dishes → dish
    { end: 'men', repl: 'man', suf: 's' },   // women → woman
    { end: 's', repl: '', suf: 's' },        // cats → cat
  ];

  for (const p of patterns) {
    if (w.endsWith(p.end)) {
      const base = w.slice(0, -p.end.length) + p.repl;
      if (CODES[base]) return { base, suffix: p.suf };
    }
  }
  return null;
}

// Adjective: -er, -est
function tryAdjPatterns(w, CODES) {
  for (const suf of ['est', 'er']) {
    if (w.endsWith(suf)) {
      const stem = w.slice(0, -suf.length);
      if (CODES[stem]) return { base: stem, suffix: suf };
      if (CODES[stem + 'e']) return { base: stem + 'e', suffix: suf };
      // Doubled: bigger → big
      if (stem.length > 2 && stem[stem.length-1] === stem[stem.length-2]) {
        const undoubled = stem.slice(0, -1);
        if (CODES[undoubled]) return { base: undoubled, suffix: suf };
      }
    }
  }
  return null;
}

module.exports = { getBaseForm };

// Test if run directly
if (require.main === module) {
  const CODES = require('./merged-codes.cjs');

  const tests = [
    'working', 'worked', 'works', 'worker',
    'running', 'ran', 'runs',
    'created', 'creates', 'creating',
    'stopped', 'stopping',
    'written', 'wrote', 'writes',
    'children', 'bigger', 'biggest'
  ];

  console.log('Custom Morphology Engine:\n');
  for (const t of tests) {
    const { base, suffix } = getBaseForm(t, CODES);
    const code = CODES[base] || '?';
    console.log(`${t.padEnd(12)} → ${base.padEnd(10)} + ${suffix.padEnd(4)} = ${code}${suffix}`);
  }
}
