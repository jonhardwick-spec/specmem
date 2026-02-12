#!/usr/bin/env node
const { CODES, PHRASES } = require('./token-compressor.cjs');

// Find all collisions
const codeToWords = {};

// Check CODES
for (const [eng, chi] of Object.entries(CODES)) {
  if (!codeToWords[chi]) codeToWords[chi] = [];
  codeToWords[chi].push(eng);
}

// Check PHRASES
for (const [eng, chi] of Object.entries(PHRASES)) {
  if (!codeToWords[chi]) codeToWords[chi] = [];
  codeToWords[chi].push('PHRASE:' + eng);
}

// Print collisions
console.log('=== CODE COLLISIONS ===');
let collisionCount = 0;
for (const [chi, words] of Object.entries(codeToWords)) {
  // Filter to unique base words (ignore plurals/tenses of same word)
  const bases = [...new Set(words.map(w => {
    const clean = w.replace(/^PHRASE:/, '');
    // Simple lemmatization
    if (clean.endsWith('ing')) return clean.slice(0, -3);
    if (clean.endsWith('ed')) return clean.slice(0, -2);
    if (clean.endsWith('es')) return clean.slice(0, -2);
    if (clean.endsWith('s') && !clean.endsWith('ss')) return clean.slice(0, -1);
    return clean;
  }))];

  if (bases.length > 1) {
    console.log(`${chi} → ${words.join(', ')}`);
    collisionCount++;
  }
}
console.log(`\nTotal collisions: ${collisionCount}`);
