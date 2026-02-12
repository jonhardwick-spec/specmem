#!/usr/bin/env node
/**
 * SEMANTIC ACCURACY TEST
 * Tests that MEANING is preserved, not exact string match
 * (Filler words like "the", "a", "is" are intentionally removed)
 */
delete require.cache[require.resolve('./token-compressor.cjs')];
const c = require('./token-compressor.cjs');

let passed = 0, failed = 0;
const failures = [];

function semanticTest(input) {
  const comp = c.compress(input);
  const dec = c.decompress(comp);

  // Get semantic words (removes fillers, lemmatizes)
  const origWords = c.getSemanticWords(input);
  const decWords = c.getSemanticWords(dec);

  // Check if all original semantic words are in decompressed
  const origSet = new Set(origWords);
  const decSet = new Set(decWords);

  let matches = 0;
  for (const w of origSet) {
    if (decSet.has(w)) matches++;
  }

  const accuracy = origSet.size > 0 ? matches / origSet.size : 1;
  const ok = accuracy >= 0.95;

  if (ok) {
    passed++;
    const savings = ((1 - comp.length / input.length) * 100).toFixed(0);
    console.log(`✓ ${savings}% saved: "${input.slice(0,40)}..."`);
  } else {
    failed++;
    failures.push({ input, comp, dec, accuracy, origWords, decWords });
    console.log(`✗ ${(accuracy*100).toFixed(0)}%: "${input.slice(0,40)}..."`);
  }
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('           SEMANTIC ACCURACY TEST (meaning preservation)');
console.log('═══════════════════════════════════════════════════════════════\n');

const tests = [
  // Sentences
  'The function returns a value from the database.',
  'User authentication failed due to invalid credentials.',
  'The server is processing multiple client requests.',
  'Creating a new component with custom properties.',
  'The query returned empty results from the cache.',
  'Checking if the session token is still valid.',
  'The application crashed with a memory exception.',
  'Building the project with optimized settings.',
  'The worker is busy processing background tasks.',
  'Database connection timeout exceeded the limit.',
  'Parsing JSON response from the API endpoint.',
  'The callback function was triggered successfully.',

  // Code-like
  'function getData() { return fetch(url); }',
  'const user = await database.findOne({ id: userId });',
  'const filtered = array.filter(item => item.active);',
  'async function processQueue() { while (true) {} }',

  // Multi-line
  `async function fetchUserData(userId) {
    const response = await fetch('/api/users/' + userId);
    return response.json();
  }`,
];

for (const t of tests) semanticTest(t);

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('                         RESULTS');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Semantic Accuracy: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

if (failures.length > 0) {
  console.log('\n─── FAILURES ───');
  for (const f of failures) {
    console.log(`\nInput: "${f.input.slice(0,60)}..."`);
    console.log(`  Original words: [${f.origWords.join(', ')}]`);
    console.log(`  Decompressed:   [${f.decWords.join(', ')}]`);
    console.log(`  Accuracy: ${(f.accuracy * 100).toFixed(0)}%`);
  }
}
