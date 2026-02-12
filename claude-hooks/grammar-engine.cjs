#!/usr/bin/env node
/**
 * ENGLISH GRAMMAR ENGINE
 * ======================
 * Handles ALL English morphology for perfect suffix extraction
 */

// Suffix patterns ordered by specificity (longest first)
const SUFFIX_RULES = [
  // -ization/-isation (organization → organize)
  { suffix: 'ization', base: (w) => w + 'ize' },
  { suffix: 'isation', base: (w) => w + 'ise' },

  // -ation (creation → create)
  { suffix: 'ation', base: (w) => w + 'ate', altBase: (w) => w + 'e' },

  // -tion (addition → add)
  { suffix: 'tion', base: (w) => w.endsWith('c') ? w + 't' : w },

  // -sion (permission → permit, expansion → expand)
  { suffix: 'sion', base: (w) => w + 'd', altBase: (w) => w + 't' },

  // -ment (improvement → improve)
  { suffix: 'ment', base: (w) => w, altBase: (w) => w + 'e' },

  // -ness (happiness → happy, sadness → sad)
  { suffix: 'ness', base: (w) => w.endsWith('i') ? w.slice(0,-1) + 'y' : w },

  // -able/-ible (readable → read, visible → ?)
  { suffix: 'able', base: (w) => w, altBase: (w) => w + 'e' },
  { suffix: 'ible', base: (w) => w },

  // -ally (automatically → automatic)
  { suffix: 'ally', base: (w) => w + 'al', outSuffix: 'ally' },

  // -ily (happily → happy)
  { suffix: 'ily', base: (w) => w + 'y', outSuffix: 'ly' },

  // -ly (quickly → quick)
  { suffix: 'ly', base: (w) => w },

  // -ful/-less (helpful → help)
  { suffix: 'ful', base: (w) => w },
  { suffix: 'less', base: (w) => w },

  // -ous (famous → fame, dangerous → danger)
  { suffix: 'ous', base: (w) => w, altBase: (w) => w + 'e' },

  // -ive (creative → create, active → act)
  { suffix: 'ive', base: (w) => w, altBase: (w) => w + 'e' },

  // -ing (working → work, running → run, creating → create)
  {
    suffix: 'ing',
    base: (w) => w,
    altBase: (w) => w + 'e',  // creating → create
    altBase2: (w) => w.length > 1 && w[w.length-1] === w[w.length-2] ? w.slice(0,-1) : null // running → run
  },

  // -ed (worked → work, stopped → stop, created → create)
  {
    suffix: 'ed',
    base: (w) => w,
    altBase: (w) => w + 'e',  // created → create (actually creat+ed, base+e)
    altBase2: (w) => w.length > 1 && w[w.length-1] === w[w.length-2] ? w.slice(0,-1) : null, // stopped → stop
    altBase3: (w) => w.endsWith('i') ? w.slice(0,-1) + 'y' : null  // cried → cry
  },

  // -er (worker → work, bigger → big, writer → write)
  {
    suffix: 'er',
    base: (w) => w,
    altBase: (w) => w + 'e',
    altBase2: (w) => w.length > 1 && w[w.length-1] === w[w.length-2] ? w.slice(0,-1) : null
  },

  // -est (biggest → big, fastest → fast)
  {
    suffix: 'est',
    base: (w) => w,
    altBase: (w) => w.length > 1 && w[w.length-1] === w[w.length-2] ? w.slice(0,-1) : null
  },

  // -ies → -y (cries → cry, flies → fly)
  { suffix: 'ies', base: (w) => w + 'y', outSuffix: 's' },

  // -es (watches → watch, boxes → box)
  { suffix: 'es', base: (w) => w, altBase: (w) => w + 'e', outSuffix: 's' },

  // -'s (possessive)
  { suffix: "'s", base: (w) => w },

  // -s (works → work)
  { suffix: 's', base: (w) => w },
];

/**
 * Extract base form and suffix using grammar rules
 * @param {string} word - The inflected word
 * @param {Object} CODES - Dictionary to check base forms against
 * @returns {{base: string, suffix: string}}
 */
function extractWithGrammar(word, CODES) {
  const lower = word.toLowerCase();

  for (const rule of SUFFIX_RULES) {
    if (!lower.endsWith(rule.suffix)) continue;
    if (lower.length <= rule.suffix.length + 2) continue;

    const stem = lower.slice(0, -rule.suffix.length);
    const outSuffix = rule.outSuffix || rule.suffix;

    // Try all base form transformations
    const tries = [
      rule.base(stem),
      rule.altBase?.(stem),
      rule.altBase2?.(stem),
      rule.altBase3?.(stem),
    ].filter(Boolean);

    for (const tryBase of tries) {
      if (CODES.hasOwnProperty(tryBase)) {
        return { base: tryBase, suffix: outSuffix };
      }
    }
  }

  return { base: word, suffix: '' };
}

// Export
module.exports = { extractWithGrammar, SUFFIX_RULES };

// Test if run directly
if (require.main === module) {
  const CODES = require('./merged-codes.cjs');

  const tests = [
    'working', 'worked', 'worker', 'works',
    'running', 'ran', 'runs',
    'creating', 'created', 'creates', 'creation',
    'happiness', 'happily',
    'improvement', 'improving',
    'automatically', 'automatic',
    'readable', 'reading',
    'stopped', 'stopping',
    'cried', 'cries', 'crying',
    'bigger', 'biggest',
    'watched', 'watches', 'watching',
  ];

  console.log('Grammar Engine Tests:\n');
  for (const t of tests) {
    const { base, suffix } = extractWithGrammar(t, CODES);
    const code = CODES[base] || '?';
    const result = suffix ? `${code}${suffix}` : code;
    console.log(`${t.padEnd(15)} → ${base.padEnd(10)} + ${suffix.padEnd(5)} = ${result}`);
  }
}
