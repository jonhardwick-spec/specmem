const c = require('./token-compressor.cjs');
const tests = [
  'The authentication system validates user credentials',
  'Memory management optimizes application performance',
  'The callback function handles asynchronous operations',
  'Database queries return filtered results efficiently',
  'Component rendering displays dynamic user interfaces',
  'Error logging helps developers debug production issues',
  'The API endpoint processes client requests securely',
  'Configuration settings control application behavior',
  'Version control tracks code changes over time',
  'Testing frameworks verify software functionality'
];
let pass=0, tot=0;
for (const t of tests) {
  const comp = c.compress(t);
  const decomp = c.decompress(comp);
  const oW = c.getSemanticWords(t);
  const dW = c.getSemanticWords(decomp);
  const oS = new Set(oW), dS = new Set(dW);
  const m = [...oS].filter(w => dS.has(w)).length;
  const acc = oS.size > 0 ? m / oS.size : 1;
  tot += acc;
  if (acc >= 0.99) pass++;
  else console.log((acc*100).toFixed(0)+'%:', oW.filter(w=>!dS.has(w)).join(','));
}
console.log('Accuracy:', (tot/tests.length*100).toFixed(1)+'%');
console.log('Passed:', pass+'/'+tests.length);
