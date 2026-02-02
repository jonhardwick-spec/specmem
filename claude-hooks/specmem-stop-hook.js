#!/usr/bin/env node
/**
 * SpecMem Stop Hook - Save session context on stop/interrupt
 *
 * This hook fires when the session is interrupted (Esc) or stopped.
 * It saves any pending work context to SpecMem for later resumption.
 *
 * IMPORTANT: This should be FAST and non-blocking. The user is trying to stop.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Read hook input from stdin
let inputData = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  try {
    const hookInput = JSON.parse(inputData);
    handleStop(hookInput);
  } catch (e) {
    // Silent fail - don't block the stop
    process.exit(0);
  }
});

// Timeout - don't hang the stop
setTimeout(() => {
  process.exit(0);
}, 3000);

function handleStop(hookInput) {
  const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
  const sessionId = hookInput.sessionId || 'unknown';

  // Quick log that session was stopped - useful for debugging
  const logDir = path.join(projectPath, 'specmem', 'sockets');
  const logFile = path.join(logDir, 'session-stops.log');

  try {
    fs.mkdirSync(logDir, { recursive: true });
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} | Session stopped: ${sessionId}\n`;
    fs.appendFileSync(logFile, logEntry);
  } catch (e) {
    // Ignore log errors
  }

  // Output minimal JSON - just suppress output, no invalid event names
  // Valid hookEventNames are: PreToolUse, UserPromptSubmit, PostToolUse
  console.log(JSON.stringify({
    suppressOutput: true
  }));

  process.exit(0);
}
