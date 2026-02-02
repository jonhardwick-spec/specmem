#!/usr/bin/env node
/**
 * ENGLISH MORPHOLOGY ENGINE - STANDALONE VERSION
 * Handles suffix extraction without external dependencies
 * Falls back to pattern-based analysis
 */

// Common irregular verb forms (embedded, no external deps)
const IRREGULAR_VERBS = {
  'ran': 'run', 'written': 'write', 'wrote': 'write',
  'built': 'build', 'sent': 'send', 'found': 'find',
  'made': 'make', 'said': 'say', 'gone': 'go', 'went': 'go',
  'done': 'do', 'had': 'have', 'been': 'be', 'was': 'be', 'were': 'be',
  'got': 'get', 'taken': 'take', 'took': 'take',
  'seen': 'see', 'saw': 'see', 'known': 'know', 'knew': 'know',
  'thought': 'think', 'brought': 'bring', 'bought': 'buy',
  'caught': 'catch', 'taught': 'teach', 'fought': 'fight',
  'held': 'hold', 'told': 'tell', 'sold': 'sell',
  'left': 'leave', 'kept': 'keep', 'slept': 'sleep',
  'felt': 'feel', 'met': 'meet', 'led': 'lead',
  'read': 'read', 'set': 'set', 'put': 'put', 'cut': 'cut',
  'begun': 'begin', 'began': 'begin', 'broken': 'break', 'broke': 'break',
  'chosen': 'choose', 'chose': 'choose', 'driven': 'drive', 'drove': 'drive',
  'eaten': 'eat', 'ate': 'eat', 'fallen': 'fall', 'fell': 'fall',
  'given': 'give', 'gave': 'give', 'grown': 'grow', 'grew': 'grow',
  'hidden': 'hide', 'hid': 'hide', 'ridden': 'ride', 'rode': 'ride',
  'risen': 'rise', 'rose': 'rise', 'spoken': 'speak', 'spoke': 'speak',
  'stolen': 'steal', 'stole': 'steal', 'thrown': 'throw', 'threw': 'throw',
  'worn': 'wear', 'wore': 'wear', 'woken': 'wake', 'woke': 'wake',
};

// Common irregular nouns
const IRREGULAR_NOUNS = {
  'children': 'child', 'men': 'man', 'women': 'woman',
  'teeth': 'tooth', 'feet': 'foot', 'mice': 'mouse',
  'geese': 'goose', 'people': 'person', 'dice': 'die',
  'indices': 'index', 'vertices': 'vertex', 'matrices': 'matrix',
  'analyses': 'analysis', 'theses': 'thesis', 'crises': 'crisis',
  'phenomena': 'phenomenon', 'criteria': 'criterion', 'data': 'datum',
};

function getSuffix(inflected, base) {
  if (inflected.endsWith('ing')) return 'ing';
  if (inflected.endsWith('ed')) return 'ed';
  if (inflected.endsWith('es')) return 'es';
  if (inflected.endsWith('s')) return 's';
  if (inflected.endsWith('er')) return 'er';
  if (inflected.endsWith('est')) return 'est';
  return '';
}

function getBaseForm(word, CODES) {
  const w = word.toLowerCase();

  // Check irregular forms first
  if (IRREGULAR_VERBS[w] && CODES[IRREGULAR_VERBS[w]]) {
    return { base: IRREGULAR_VERBS[w], suffix: getSuffix(w, IRREGULAR_VERBS[w]) };
  }
  if (IRREGULAR_NOUNS[w] && CODES[IRREGULAR_NOUNS[w]]) {
    return { base: IRREGULAR_NOUNS[w], suffix: 's' };
  }

  // Try verb patterns: -ing, -ed, -es, -s
  // -ies → -y (cries → cry)
  if (w.endsWith('ies') && w.length > 4) {
    const base = w.slice(0, -3) + 'y';
    if (CODES[base]) return { base, suffix: 's' };
  }

  // -ing removal
  if (w.endsWith('ing') && w.length > 5) {
    const stem = w.slice(0, -3);
    // Doubled consonant (running → run)
    if (stem.length > 2 && stem[stem.length-1] === stem[stem.length-2]) {
      const base = stem.slice(0, -1);
      if (CODES[base]) return { base, suffix: 'ing' };
    }
    // Direct (working → work)
    if (CODES[stem]) return { base: stem, suffix: 'ing' };
    // Add e (creating → create)
    if (CODES[stem + 'e']) return { base: stem + 'e', suffix: 'ing' };
  }

  // -ed removal
  if (w.endsWith('ed') && w.length > 4) {
    const stem = w.slice(0, -2);
    // Doubled consonant (stopped → stop)
    if (stem.length > 2 && stem[stem.length-1] === stem[stem.length-2]) {
      const base = stem.slice(0, -1);
      if (CODES[base]) return { base, suffix: 'ed' };
    }
    // Direct (worked → work)
    if (CODES[stem]) return { base: stem, suffix: 'ed' };
    // Remove 'd' only (created → create)
    if (CODES[w.slice(0, -1)]) return { base: w.slice(0, -1), suffix: 'ed' };
  }

  // -es removal (watches → watch, processes → process)
  if (w.endsWith('es') && w.length > 4) {
    // -ches, -shes, -xes, -sses, -zes
    if (w.endsWith('ches') || w.endsWith('shes') || w.endsWith('xes') || w.endsWith('sses') || w.endsWith('zes')) {
      const base = w.slice(0, -2);
      if (CODES[base]) return { base, suffix: 's' };
    }
    // -ves → -f or -fe (wolves → wolf, knives → knife)
    if (w.endsWith('ves')) {
      const baseF = w.slice(0, -3) + 'f';
      const baseFe = w.slice(0, -3) + 'fe';
      if (CODES[baseF]) return { base: baseF, suffix: 's' };
      if (CODES[baseFe]) return { base: baseFe, suffix: 's' };
    }
    // Plain -es → -e (creates → create)
    const base = w.slice(0, -1);
    if (CODES[base]) return { base, suffix: 's' };
  }

  // -s removal (works → work)
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) {
    const base = w.slice(0, -1);
    if (CODES[base]) return { base, suffix: 's' };
  }

  // -er removal (bigger → big, worker → work)
  if (w.endsWith('er') && w.length > 4) {
    const stem = w.slice(0, -2);
    // Doubled consonant (bigger → big)
    if (stem.length > 2 && stem[stem.length-1] === stem[stem.length-2]) {
      const base = stem.slice(0, -1);
      if (CODES[base]) return { base, suffix: 'er' };
    }
    if (CODES[stem]) return { base: stem, suffix: 'er' };
    if (CODES[stem + 'e']) return { base: stem + 'e', suffix: 'er' };
  }

  // -est removal (biggest → big)
  if (w.endsWith('est') && w.length > 5) {
    const stem = w.slice(0, -3);
    if (stem.length > 2 && stem[stem.length-1] === stem[stem.length-2]) {
      const base = stem.slice(0, -1);
      if (CODES[base]) return { base, suffix: 'est' };
    }
    if (CODES[stem]) return { base: stem, suffix: 'est' };
    if (CODES[stem + 'e']) return { base: stem + 'e', suffix: 'est' };
  }

  return { base: word, suffix: '' };
}

module.exports = { getBaseForm };
