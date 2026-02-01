#!/usr/bin/env node
/**
 * Input-Aware Auto-Improver
 * - Pauses during user typing
 * - Captures user input (handles backspaces)
 * - Only fires auto-improve when user is idle
 * - Feeds captured input to 
 *
 * Works in standalone mode (no PM2 required)
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const specmemPaths = require('./specmem-paths.cjs');

const SPECMEM_HOME = specmemPaths.getSpecmemHome();
const SPECMEM_PKG = specmemPaths.getSpecmemPkg();
// Per-project sockets: default to {cwd}/specmem/sockets/
const SPECMEM_RUN_DIR = specmemPaths.expandCwd(process.env.SPECMEM_RUN_DIR) || specmemPaths.getProjectSocketDir();
const SPECMEM_EMBEDDING_SOCKET = specmemPaths.expandCwd(process.env.SPECMEM_EMBEDDING_SOCKET);
const SPECMEM_PROJECT_PATH = specmemPaths.expandCwd(process.env.SPECMEM_PROJECT_PATH);
const projectFilterEnabled = process.env.SPECMEM_PROJECT_FILTER !== 'false'; // defaults to TRUE

// Use project-scoped path for state file
const STATE_FILE = path.join(SPECMEM_RUN_DIR, 'claude-input-state.json');

// ============================================================================
// Dynamic Password Loading (matches src/config/password.ts)
// ============================================================================

function getPassword() {
  // 1. Check unified env var first (recommended)
  const unified = process.env.SPECMEM_PASSWORD;
  if (unified) return unified;

  // 2. Fall back to legacy dashboard password
  const dashboard = process.env.SPECMEM_DASHBOARD_PASSWORD;
  if (dashboard) return dashboard;

  // 3. Fall back to legacy API password
  const api = process.env.SPECMEM_API_PASSWORD;
  if (api) return api;

  // 4. Try to read from .env files
  const envFiles = [
    path.join(SPECMEM_HOME, '.env'),
    path.join(SPECMEM_HOME, 'specmem.env'),
    path.join(process.env.HOME || '/root', '.specmem/.env')
  ];

  const passwordVarNames = [
    'SPECMEM_PASSWORD',
    'SPECMEM_DASHBOARD_PASSWORD',
    'SPECMEM_API_PASSWORD'
  ];

  for (const envPath of envFiles) {
    try {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const varName of passwordVarNames) {
          const pattern = new RegExp(`${varName}=(.+)`);
          const match = content.match(pattern);
          if (match) {
            return match[1].trim().replace(/^["']|["']$/g, '');
          }
        }
      }
    } catch (e) {
      // Continue to next file
    }
  }

  // 5. Default fallback
  return 'specmem';
}

const SPECMEM_HOST = process.env.SPECMEM_HOST || 'localhost';
const SPECMEM_PORT = process.env.SPECMEM_DASHBOARD_PORT || '8595';
const SPECMEM_API = `http://${SPECMEM_HOST}:${SPECMEM_PORT}/api`;
const SPECMEM_PASSWORD = getPassword();

// Typing detection - if input changed recently, user is typing
const TYPING_COOLDOWN_MS = 2000; // Wait 2s after last keystroke

function getState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        }
    } catch {}
    return { lastInput: '', lastInputTime: 0, buffer: '' };
}

function saveState(state) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    } catch {}
}

// Process input buffer - handle backspaces
function processBuffer(raw) {
    let result = '';
    for (const char of raw) {
        if (char === '\b' || char === '\x7f') { // Backspace
            result = result.slice(0, -1);
        } else if (char >= ' ' || char === '\n' || char === '\t') {
            result += char;
        }
    }
    return result.trim();
}

// Check if user is currently typing
function isUserTyping(state, currentInput) {
    const now = Date.now();
    const inputChanged = currentInput !== state.lastInput;

    if (inputChanged) {
        // User typed something - update state and signal typing
        state.lastInput = currentInput;
        state.lastInputTime = now;
        state.buffer = processBuffer(currentInput);
        saveState(state);
        return true;
    }

    // Check if within cooldown period
    const timeSinceLastInput = now - state.lastInputTime;
    return timeSinceLastInput < TYPING_COOLDOWN_MS;
}

// Get recent memories for context
async function getRecentContext(limit = 3) {
    return new Promise((resolve) => {
        const req = http.request(`${SPECMEM_API}/memories?limit=${limit}&orderBy=created&orderDirection=desc`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${SPECMEM_PASSWORD}` },
            timeout: 2000
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body).memories || []);
                } catch { resolve([]); }
            });
        });
        req.on('error', () => resolve([]));
        req.on('timeout', () => { req.destroy(); resolve([]); });
        req.end();
    });
}

/**
 * Read stdin with timeout to prevent indefinite hangs
 * CRIT-07 FIX: All hooks must use this instead of raw for-await
 */
function readStdinWithTimeout(timeoutMs = 5000) {
  return new Promise((resolve) => {
    let input = '';
    const timer = setTimeout(() => {
      process.stdin.destroy();
      resolve(input);
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(input);
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      resolve(input);
    });
  });
}

async function main() {
    // CRIT-07 FIX: Read input with timeout instead of indefinite for-await
    let input = await readStdinWithTimeout(5000);

    try {
        const hookData = JSON.parse(input);
        const prompt = hookData.prompt || '';
        const state = getState();

        // If user is typing, just passthrough - don't inject anything
        if (isUserTyping(state, prompt)) {
            // Silent passthrough - let user type
            process.exit(0);
        }

        // User stopped typing - check if we should auto-improve
        const capturedInput = state.buffer || prompt;

        // Only inject context if prompt has improvement keywords OR is a question
        const shouldEnhance = /fix|improve|suggest|cook|self.?improve|specmem|\?$/i.test(capturedInput);

        if (!shouldEnhance) {
            process.exit(0);
        }

        // Get recent context from specmem
        const memories = await getRecentContext(3);
        let context = '';

        if (memories.length > 0) {
            const memContext = memories.map((m, i) => {
                const preview = (m.content || '').substring(0, 150).replace(/\n/g, ' ');
                return `${i+1}. ${preview}...`;
            }).join('\n');
            context = `[RECENT CONTEXT]\n${memContext}\n`;
        }

        context += `\n[AUTO-IMPROVE ACTIVE] Pick best option, execute fully.`;

        console.log(JSON.stringify({ type: 'context', context }));

    } catch (e) {
        // LOW-44 FIX: Log errors before exit instead of silent fail
        console.error('[input-aware-improver] Error:', e.message || e);
    }
}

main().catch((e) => {
    console.error('[input-aware-improver] Unhandled error:', e.message || e);
    process.exit(0);
});
