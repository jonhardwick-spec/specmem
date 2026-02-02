#!/usr/bin/env node
/**
 * MEGA TEST SUITE FOR TOKEN COMPRESSOR
 * Tests real code, real sentences, and edge cases
 */

const c = require('./token-compressor.cjs');

let passed = 0, failed = 0;
const failures = [];

function test(input, expectRoundTrip = true) {
  const comp = c.compress(input);
  const decomp = c.decompress(comp);
  const ok = decomp === input;

  if (ok) {
    passed++;
    const savings = ((1 - comp.length / input.length) * 100).toFixed(0);
    console.log(`✓ ${savings}%: "${input.slice(0,50)}${input.length>50?'...':''}" → ${comp.length} chars`);
  } else {
    failed++;
    failures.push({ input, comp, decomp });
    console.log(`✗ FAIL: "${input.slice(0,40)}..."`);
    console.log(`  comp: ${comp}`);
    console.log(`  got:  ${decomp}`);
  }
  return ok;
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('                    MEGA TOKEN COMPRESSOR TEST');
console.log('═══════════════════════════════════════════════════════════════\n');

// ═══════════════════════════════════════════════════════════════════════════
// PART 1: SINGLE WORDS - Base forms
// ═══════════════════════════════════════════════════════════════════════════
console.log('─── SINGLE WORDS (Base Forms) ───');
const baseWords = [
  'function', 'variable', 'parameter', 'return', 'class', 'object', 'array',
  'string', 'number', 'boolean', 'value', 'method', 'property', 'interface',
  'module', 'package', 'library', 'framework', 'error', 'exception', 'warning',
  'debug', 'memory', 'buffer', 'stack', 'heap', 'queue', 'callback', 'promise',
  'create', 'read', 'update', 'delete', 'add', 'remove', 'insert', 'find',
  'search', 'filter', 'sort', 'parse', 'validate', 'check', 'test', 'verify',
  'server', 'client', 'database', 'cache', 'file', 'directory', 'path',
  'request', 'response', 'query', 'session', 'token', 'user', 'permission'
];
for (const w of baseWords) test(w);

// ═══════════════════════════════════════════════════════════════════════════
// PART 2: INFLECTED FORMS - Plurals, Past Tense, Present Participle
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n─── INFLECTED FORMS ───');
const inflected = [
  // Plurals
  'functions', 'variables', 'parameters', 'classes', 'objects', 'arrays',
  'errors', 'exceptions', 'warnings', 'servers', 'clients', 'databases',
  'files', 'queries', 'sessions', 'tokens', 'users', 'permissions', 'settings',
  // Past tense
  'created', 'updated', 'deleted', 'added', 'removed', 'inserted', 'found',
  'searched', 'filtered', 'sorted', 'parsed', 'validated', 'checked', 'tested',
  'connected', 'disconnected', 'started', 'stopped', 'executed', 'called',
  // Present participle
  'creating', 'reading', 'updating', 'deleting', 'adding', 'removing',
  'searching', 'filtering', 'sorting', 'parsing', 'validating', 'checking',
  'connecting', 'starting', 'stopping', 'running', 'building', 'working',
  // Comparatives
  'bigger', 'smaller', 'faster', 'slower', 'higher', 'lower',
  // Superlatives
  'biggest', 'smallest', 'fastest', 'slowest', 'highest', 'lowest'
];
for (const w of inflected) test(w);

// ═══════════════════════════════════════════════════════════════════════════
// PART 3: REAL SENTENCES
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n─── REAL SENTENCES ───');
const sentences = [
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
  'Searching for files matching the pattern.',
  'Validating user input before submission.',
  'The promise resolved with success status.',
];
for (const s of sentences) test(s);

// ═══════════════════════════════════════════════════════════════════════════
// PART 4: ACTUAL CODE SNIPPETS
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n─── ACTUAL CODE SNIPPETS ───');
const codeSnippets = [
  'function getData() { return fetch(url); }',
  'const user = await database.findOne({ id: userId });',
  'if (error) { console.log(error.message); }',
  'const filtered = array.filter(item => item.active);',
  'export default class UserComponent extends React.Component {}',
  'const config = { server: "localhost", port: 3000 };',
  'try { await client.connect(); } catch (error) { }',
  'const result = users.map(user => user.name);',
  'async function processQueue() { while (true) {} }',
  'const { data, loading, error } = useQuery(GET_USERS);',
];
for (const code of codeSnippets) test(code);

// ═══════════════════════════════════════════════════════════════════════════
// PART 5: MULTI-LINE CODE BLOCKS
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n─── MULTI-LINE CODE BLOCKS ───');

const multiLine1 = `
async function fetchUserData(userId) {
  const response = await fetch('/api/users/' + userId);
  const data = await response.json();
  return data;
}
`.trim();
test(multiLine1);

const multiLine2 = `
class DatabaseConnection {
  constructor(config) {
    this.config = config;
    this.connected = false;
  }

  async connect() {
    this.connected = true;
  }
}
`.trim();
test(multiLine2);

const multiLine3 = `
const settings = {
  database: { host: 'localhost', port: 5432 },
  cache: { enabled: true, timeout: 3600 },
  server: { port: 3000, debug: false }
};
`.trim();
test(multiLine3);

// ═══════════════════════════════════════════════════════════════════════════
// PART 6: EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n─── EDGE CASES ───');
const edgeCases = [
  // Irregular verbs
  'written', 'ran', 'built', 'sent', 'found',
  // Words that look like inflections but aren't
  'string', 'setting', 'coding', 'testing',
  // Short words
  'id', 'db', 'ui', 'api',
  // Mixed case (should preserve original)
  'JavaScript', 'TypeScript', 'NodeJS',
  // With punctuation
  'error!', 'success?', '(function)',
  // Contractions
  "isn't", "doesn't", "can't",
];
for (const e of edgeCases) test(e);

// ═══════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('                         RESULTS');
console.log('═══════════════════════════════════════════════════════════════');
const accuracy = ((passed / (passed + failed)) * 100).toFixed(1);
console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Accuracy: ${accuracy}%`);

if (failures.length > 0) {
  console.log('\n─── FAILURES ───');
  for (const f of failures) {
    console.log(`\nInput:  "${f.input}"`);
    console.log(`Comp:   "${f.comp}"`);
    console.log(`Got:    "${f.decomp}"`);
  }
}

// Calculate compression stats on a sample text
console.log('\n─── COMPRESSION EFFICIENCY ───');
const sampleText = `
The server function processes database queries and returns cached responses.
User authentication validates the session token and checks permissions.
The component renders the filtered data with custom styling.
Error handling catches exceptions and logs warning messages.
Asynchronous callbacks trigger when the promise resolves successfully.
`.trim();

const compressed = c.compress(sampleText);
const decompressed = c.decompress(compressed);
const roundTripOk = decompressed === sampleText;
const charSavings = ((1 - compressed.length / sampleText.length) * 100).toFixed(1);

console.log(`Original:    ${sampleText.length} chars`);
console.log(`Compressed:  ${compressed.length} chars`);
console.log(`Savings:     ${charSavings}%`);
console.log(`Round-trip:  ${roundTripOk ? '✓ PERFECT' : '✗ FAILED'}`);

process.exit(failed > 0 ? 1 : 0);
