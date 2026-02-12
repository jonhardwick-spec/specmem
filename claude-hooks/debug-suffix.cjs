const c = require('./token-compressor.cjs');

// Check if work is in CODES
console.log('work in CODES:', 'work' in c.CODES);
console.log('work →', c.CODES['work']);
console.log('create in CODES:', 'create' in c.CODES);
console.log('create →', c.CODES['create']);

// Test extractSuffix if exported
if (c.extractSuffix) {
  console.log('\nextractSuffix tests:');
  console.log('working →', c.extractSuffix('working'));
  console.log('worked →', c.extractSuffix('worked'));
  console.log('creating →', c.extractSuffix('creating'));
}
