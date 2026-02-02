#!/usr/bin/env node
// Force fresh require
delete require.cache[require.resolve('./token-compressor.cjs')];
const c = require('./token-compressor.cjs');

const tests = [
  'enabled',
  'created',
  'working',
  'functions',
  'queries',
  'settings',
];

console.log('Quick round-trip test:\n');
let pass = 0, fail = 0;
for (const t of tests) {
  const comp = c.compress(t);
  const dec = c.decompress(comp);
  const ok = dec.trim() === t;
  console.log(`${ok ? '✓' : '✗'} ${t} → ${comp} → ${dec.trim()}`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${pass+fail} passed`);
