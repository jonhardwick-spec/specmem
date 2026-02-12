#!/usr/bin/env node
/**
 * CLAUDE SCREENFIX LOADER HOOK
 * ============================
 *
 * SessionStart hook that loads claudescreenfix-hardwicksoftware
 * to fix VTE rendering glitches on headless/VNC displays.
 *
 * Auto-installed by: npm install claudescreenfix-hardwicksoftware
 *
 * Hook Event: SessionStart
 */

try {
  const screenfix = require('claudescreenfix-hardwicksoftware');
  screenfix.install();
} catch (e) {
  // screenfix not installed or failed, continue silently
}

// Hook must output valid JSON for SessionStart
const input = process.argv[2] || '{}';
try {
  const hookEvent = JSON.parse(input);
  if (hookEvent.type === 'SessionStart') {
    console.log(JSON.stringify({ result: '' }));
  }
} catch (e) {
  // Not a valid hook call, ignore
}
