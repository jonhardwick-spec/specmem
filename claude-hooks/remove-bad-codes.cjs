#!/usr/bin/env node
const fs = require('fs');
const codes = require('./merged-codes.cjs');

// Remove entries with pure lowercase ASCII codes (cause substring matching issues)
const bad = [];
for (const [eng, code] of Object.entries(codes)) {
  if (/^[a-z]{1,4}$/.test(code)) {
    bad.push([eng, code]);
    delete codes[eng];
  }
}

console.log('Removed:');
bad.forEach(([e,c]) => console.log(`  ${e} → ${c}`));
console.log(`\nTotal removed: ${bad.length}`);
console.log(`Remaining: ${Object.keys(codes).length}`);

const out = `// ${Object.keys(codes).length} entries - fixed
module.exports = ${JSON.stringify(codes, null, 2)};
`;
fs.writeFileSync('./merged-codes.cjs', out);
console.log('Done!');
