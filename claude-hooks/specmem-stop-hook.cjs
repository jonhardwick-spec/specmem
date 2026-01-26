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
  const projectPath = process.env.SPECMEM_PROJECT_PATH || hookInput.cwd || process.cwd();
  const sessionId = hookInput.session_id || 'unknown';

  // Extract fields from actual hook input schema
  const hookEvent = hookInput.hook_event_name || 'Stop';
  const permMode = hookInput.permission_mode || 'unknown';
  const transcriptPath = hookInput.transcript_path || '';

  // Quick log that session was stopped
  const logDir = path.join(projectPath, 'specmem', 'sockets');
  const logFile = path.join(logDir, 'session-stops.log');

  try {
    fs.mkdirSync(logDir, { recursive: true });
    const timestamp = new Date().toISOString();

    const logEntry = `${timestamp} | event=${hookEvent} | session=${sessionId} | mode=${permMode}\n`;
    fs.appendFileSync(logFile, logEntry);

    // Rotate log if over 100 lines
    try {
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      if (lines.length > 100) {
        fs.writeFileSync(logFile, lines.slice(-50).join('\n') + '\n');
      }
    } catch (rotateErr) {
      // Ignore rotation errors
    }
  } catch (e) {
    // Ignore log errors
  }

  process.exit(0);
}
