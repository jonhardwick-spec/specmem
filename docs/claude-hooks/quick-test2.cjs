#!/usr/bin/env node
delete require.cache[require.resolve('./token-compressor.cjs')];
const c = require('./token-compressor.cjs');

const tests = [
  'The function returns a value.',
  'Creating new database connections.',
  'The server is processing requests.',
  'User authentication enabled successfully.',
  'Filtering queries from the cache.',
];

console.log('Sentence round-trip test:\n');
let pass = 0, fail = 0;
for (const t of tests) {
  const comp = c.compress(t);
  const dec = c.decompress(comp);
  const ok = dec === t;
  console.log(`${ok ? '✓' : '✗'} "${t}"`);
  console.log(`  comp: "${comp}"`);
  console.log(`  dec:  "${dec}"\n`);
  ok ? pass++ : fail++;
}
console.log(`${pass}/${pass+fail} passed`);
