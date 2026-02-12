#!/usr/bin/env node
/**
 * TEST HOOK - Write directly to user's terminal via /dev/tty
 */

const fs = require('fs');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    // Write directly to user's terminal - bypasses Claude's stdout capture
    const tty = fs.openSync('/dev/tty', 'w');
    fs.writeSync(tty, '\n🎯 HOOK FIRED: UserPromptSubmit received!\n');
    fs.writeSync(tty, '📝 Your input was received by the hook system.\n');
    fs.writeSync(tty, '✅ If you see this, /dev/tty hooks work!\n\n');
    fs.closeSync(tty);
  } catch (e) {
    // Fallback to console if /dev/tty not available
    console.log('🎯 HOOK FIRED (fallback): ' + e.message);
  }
});
