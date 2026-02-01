#!/usr/bin/env node
/**
 * FIX COLLISIONS - Ensure unique reverse mappings
 * Each Chinese code should map to exactly ONE English word
 */

const fs = require('fs');
const codes = require('./merged-codes.cjs');

// Find all collisions
const chiToEng = {};
for (const [eng, chi] of Object.entries(codes)) {
  if (!chiToEng[chi]) chiToEng[chi] = [];
  chiToEng[chi].push(eng);
}

// Find collisions (same Chinese → multiple English)
const collisions = Object.entries(chiToEng)
  .filter(([chi, engs]) => engs.length > 1);

console.log('Found', collisions.length, 'collisions');
console.log('Examples:');
collisions.slice(0, 10).forEach(([chi, engs]) => {
  console.log(' ', chi, '→', engs.join(', '));
});

// Fix collisions by appending index suffix
const fixed = { ...codes };
let fixCount = 0;

for (const [chi, engs] of collisions) {
  // Keep first word as-is, modify others
  for (let i = 1; i < engs.length; i++) {
    const eng = engs[i];
    // Append a unique suffix (use number character)
    const numChars = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'];
    fixed[eng] = chi + (numChars[i-1] || i);
    fixCount++;
  }
}

console.log('\nFixed', fixCount, 'collisions');

// Verify no more collisions
const verify = {};
for (const [eng, chi] of Object.entries(fixed)) {
  if (!verify[chi]) verify[chi] = [];
  verify[chi].push(eng);
}
const remaining = Object.values(verify).filter(v => v.length > 1).length;
console.log('Remaining collisions:', remaining);

// Write fixed codes
const output = `// AUTO-GENERATED - ${Object.keys(fixed).length} entries, 0 collisions
// Generated: ${new Date().toISOString()}
module.exports = ${JSON.stringify(fixed, null, 2)};
`;

fs.writeFileSync('./merged-codes.cjs', output);
console.log('\nWrote fixed codes to merged-codes.cjs');
