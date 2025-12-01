const c = require('./token-compressor.cjs');
const t = 'The function creates a database connection';
const comp = c.compress(t);
console.log('Codes:', Object.keys(c.CODES).length);
console.log('Original:', t.length, 'chars');
console.log('Compressed:', comp.length, 'chars');
console.log('Savings:', ((1-comp.length/t.length)*100).toFixed(0)+'%');
console.log('Result:', comp);
