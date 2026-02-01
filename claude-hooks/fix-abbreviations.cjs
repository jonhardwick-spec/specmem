#!/usr/bin/env node
/**
 * FIX ABBREVIATIONS
 * Removes problematic entries where the code is NOT Chinese
 * These cause substring matching issues during decompression
 */

const fs = require('fs');
const path = require('path');

const codesPath = path.join(__dirname, 'merged-codes.cjs');
const codes = require(codesPath);

console.log(`Loaded ${Object.keys(codes).length} codes\n`);

// Find and remove problematic entries
const problematic = [];
const fixed = {};

for (const [eng, code] of Object.entries(codes)) {
  // Check if code contains ANY Chinese characters
  const hasChinese = /[\u4e00-\u9fff\u3400-\u4dbf\u20000-\u2a6df]/.test(code);

  // Keep if it has Chinese OR is a proper abbreviation (all caps, like API, HTTP, REST)
  const isProperAbbrev = /^[A-Z]+$/.test(code) && ['API', 'HTTP', 'HTTPS', 'REST', 'URL', 'ID', 'PR', 'MR', 'SM', 'DD', 'GC', 'E2E'].includes(code);

  // Keep entries with Chinese or proper abbreviations
  // Remove entries like "ins", "cos", "P", "PK" that can match inside words
  if (hasChinese || isProperAbbrev) {
    fixed[eng] = code;
  } else {
    // Check if it's a short lowercase code that could match inside words
    if (code.length <= 4 && /^[a-z]+$/.test(code)) {
      problematic.push([eng, code]);
    } else if (code === 'PK' || code === 'P') {
      problematic.push([eng, code]);
    } else {
      // Keep other codes (like circled numbers ①②③)
      fixed[eng] = code;
    }
  }
}

console.log('Removed problematic entries:');
for (const [eng, code] of problematic) {
  console.log(`  ${eng} → "${code}"`);
}

console.log(`\nRemoved: ${problematic.length}`);
console.log(`Remaining: ${Object.keys(fixed).length}`);

// Write fixed codes
const jsContent = `// AUTO-GENERATED FROM CC-CEDICT + CURATED CODES
// ${Object.keys(fixed).length} entries (fixed abbreviation collisions)
// Generated: ${new Date().toISOString()}
module.exports = ${JSON.stringify(fixed, null, 2)};
`;

fs.writeFileSync(codesPath, jsContent);
console.log(`\nWrote fixed codes to ${codesPath}`);
