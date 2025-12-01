#!/usr/bin/env node
/**
 * Test and debug decompressor suffix handling
 */
const fs = require('fs');

// Test cases
const tests = [
  ['啟用ed', 'enabled'],      // enable + ed (base ends in e)
  ['創ed', 'created'],        // create + ed
  ['工ing', 'working'],       // work + ing
  ['濾ed', 'filtered'],       // filter + ed
  ['返s', 'returns'],         // return + s
  ['函s', 'functions'],       // function + s
];

console.log('Testing suffix patterns:\n');

// The problem: when CODES has "enable" → "啟用"
// And we compress "enabled" → "啟用ed"
// Then decompress "啟用ed" should → "enabled" not "enableed"

// Solution: When replacing ChineseCode+suffix, check if English base
// already ends with the first char of suffix

const SUFFIXES = ['tion', 'ment', 'ing', 'ed', 'er', 'est', 'es', 's', 'ly'];

function smartJoin(base, suffix) {
  // Handle cases where base ends with letter that suffix starts with
  // enable + ed → enabled (not enableed)
  // create + ed → created (not createed)
  if (suffix.startsWith('e') && base.endsWith('e')) {
    return base + suffix.slice(1);
  }
  // For -ing, if base ends in 'e', it was likely dropped
  // But we stored it as base form, so: write + ing = writing (not writeing)
  // Actually the morphology engine handles this - it stores 'write' as base
  // So 寫ing should become writing... but 寫 maps to 'write'
  // write + ing = writeing? No, the original was 'writing'

  // Actually the issue is:
  // - Original: "enabled"
  // - Morphology finds: base="enable", suffix="ed"
  // - Compress: 啟用ed
  // - Decompress: 啟用 → "enable", then + "ed" = "enableed" WRONG!

  // The fix: if base ends in 'e' and suffix is 'ed' or 'es' or 'er',
  // don't add the 'e' from suffix
  if (base.endsWith('e') && (suffix === 'ed' || suffix === 'es' || suffix === 'er' || suffix === 'est')) {
    return base + suffix.slice(1); // enabled, creates, writer, latest
  }

  return base + suffix;
}

for (const [input, expected] of tests) {
  // Simulate what the decompressor does
  // Assume Chinese code maps to English base
  const chineseCode = input.replace(/[a-z]+$/, '');
  const suffix = input.match(/[a-z]+$/)?.[0] || '';

  // Mock base lookup
  const baseMap = {
    '啟用': 'enable',
    '創': 'create',
    '工': 'work',
    '濾': 'filter',
    '返': 'return',
    '函': 'function',
  };

  const base = baseMap[chineseCode] || '???';
  const result = smartJoin(base, suffix);
  const ok = result === expected;

  console.log(`${ok ? '✓' : '✗'} ${input} → ${base} + ${suffix} = ${result} (expected: ${expected})`);
}

console.log('\n--- smartJoin function ready for integration ---');
