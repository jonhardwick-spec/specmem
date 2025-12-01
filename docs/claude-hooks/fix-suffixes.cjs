#!/usr/bin/env node
/**
 * FIX SUFFIX HANDLING
 *
 * Instead of losing suffixes, KEEP THEM:
 * working → 工ing (not just 工)
 * worked → 工ed
 * worker → 工er
 * works → 工s
 */

const fs = require('fs');

// Read current token-compressor.cjs
let code = fs.readFileSync('./token-compressor.cjs', 'utf8');

// Find the compression section and update it
// Look for where we do: return CODES[baseLower]; // Compress to base form ONLY

const oldPattern = `if (CODES.hasOwnProperty(baseLower)) {
      return CODES[baseLower]; // Compress to base form ONLY - no suffix!
    }`;

const newPattern = `if (CODES.hasOwnProperty(baseLower)) {
      // KEEP THE ENGLISH SUFFIX! e.g., working → 工ing
      return CODES[baseLower] + suffix;
    }`;

if (code.includes(oldPattern)) {
  code = code.replace(oldPattern, newPattern);
  console.log('✅ Fixed compression to keep suffixes');
} else {
  console.log('❌ Could not find compression pattern to fix');
  console.log('Searching for similar...');

  // Try alternative pattern
  const alt = /return CODES\[baseLower\];.*no suffix/;
  if (alt.test(code)) {
    code = code.replace(
      /return CODES\[baseLower\];.*no suffix.*/,
      'return CODES[baseLower] + suffix; // KEEP English suffix!'
    );
    console.log('✅ Fixed with alternative pattern');
  }
}

// Also need to update decompression to handle Chinese+suffix
// Find decompress function and update

const oldDecomp = `// Single pass through ALL codes, sorted by length (longest first)`;
const hasDecompSection = code.includes(oldDecomp);
console.log('Has decomp section:', hasDecompSection);

fs.writeFileSync('./token-compressor.cjs', code);
console.log('Wrote updated token-compressor.cjs');

// Test it
console.log('\nTesting...');
delete require.cache[require.resolve('./token-compressor.cjs')];
const c = require('./token-compressor.cjs');

const tests = ['working', 'worked', 'worker', 'works', 'creating', 'created'];
for (const t of tests) {
  const comp = c.compress('The ' + t);
  console.log(t, '→', comp);
}
