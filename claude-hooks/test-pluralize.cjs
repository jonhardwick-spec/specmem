#!/usr/bin/env node
const pluralize = require('pluralize');

console.log('=== PLURALIZE LIBRARY TEST ===\n');

// Test singularization (what we need for compression)
const plurals = ['functions', 'queries', 'settings', 'databases', 'children', 'data'];
console.log('SINGULARIZE (for compression):');
for (const p of plurals) {
  const s = pluralize.singular(p);
  const isPlural = pluralize.isPlural(p);
  console.log(`  ${p} → ${s} (isPlural: ${isPlural})`);
}

// Test pluralization (what we need for decompression)
const singulars = ['function', 'query', 'setting', 'database', 'child', 'datum'];
console.log('\nPLURALIZE (for decompression):');
for (const s of singulars) {
  const p = pluralize.plural(s);
  console.log(`  ${s} → ${p}`);
}

// Test verb forms - pluralize doesn't handle these
console.log('\nVERB FORMS (pluralize may not handle):');
const verbs = ['creating', 'created', 'creates', 'running', 'ran', 'worked'];
for (const v of verbs) {
  const s = pluralize.singular(v);
  const isPlural = pluralize.isPlural(v);
  console.log(`  ${v} → ${s} (isPlural: ${isPlural})`);
}

// Check if we can detect word type
console.log('\nWORD TYPE DETECTION:');
const words = ['server', 'servers', 'create', 'creates', 'running'];
for (const w of words) {
  console.log(`  ${w}: singular=${pluralize.isSingular(w)}, plural=${pluralize.isPlural(w)}`);
}
