const c = require('./token-compressor.cjs');
const tests = ['queries', 'settings', 'query', 'setting'];
for (const t of tests) {
  const comp = c.compress('The ' + t);
  const decomp = c.decompress(comp);
  console.log(`${t} → ${comp} → ${decomp}`);
}
