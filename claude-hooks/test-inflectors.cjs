#!/usr/bin/env node
const Inflectors = require('en-inflectors').Inflectors;

console.log('=== EN-INFLECTORS TEST ===\n');

// Test VERB conjugation (base → inflected)
console.log('VERBS - Conjugation (base → inflected):');
const verbs = ['create', 'work', 'run', 'write', 'stop', 'enable', 'filter'];
for (const v of verbs) {
  const inf = new Inflectors(v);
  console.log(`  ${v}:`);
  console.log(`    past: ${inf.toPast()}`);
  console.log(`    gerund: ${inf.toGerund()}`);
  console.log(`    presentS: ${inf.toPresentS()}`);
}

// Test NOUN pluralization
console.log('\nNOUNS - Pluralization:');
const nouns = ['function', 'query', 'child', 'setting', 'database'];
for (const n of nouns) {
  const inf = new Inflectors(n);
  console.log(`  ${n} → ${inf.toPlural()}`);
}

// Test ADJECTIVE comparison
console.log('\nADJECTIVES - Comparison:');
const adjs = ['big', 'fast', 'slow', 'small'];
for (const a of adjs) {
  const inf = new Inflectors(a);
  console.log(`  ${a}: comparative=${inf.toComparative()}, superlative=${inf.toSuperlative()}`);
}

// Test reverse (inflected → base) - THIS IS CRITICAL
console.log('\nREVERSE - Get base form:');
const inflected = ['created', 'working', 'runs', 'functions', 'bigger'];
for (const w of inflected) {
  const inf = new Inflectors(w);
  console.log(`  ${w} → ${inf.toSingular()} / ${inf.toPresent()}`);
}
