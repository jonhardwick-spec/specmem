const c = require('./token-compressor.cjs');

const tests = [
  'The function creates a database connection',
  'Error handling is necessary for success',
  'The server sends a response to the client',
  'Variables store important data values'
];

let pass = 0;
for (const t of tests) {
  const comp = c.compress(t);
  const decomp = c.decompress(comp);
  const origW = c.getSemanticWords(t);
  const decW = c.getSemanticWords(decomp);
  const oSet = new Set(origW);
  const dSet = new Set(decW);
  const match = [...oSet].filter(w => dSet.has(w)).length;
  const acc = oSet.size > 0 ? match / oSet.size : 1;
  if (acc >= 0.99) pass++;
  console.log((acc*100).toFixed(0)+'%', '|', t.slice(0,40));
  if (acc < 0.99) {
    console.log('  ORIG:', origW.join(', '));
    console.log('  DCMP:', decW.join(', '));
  }
}
console.log('\nPassed:', pass + '/' + tests.length);
