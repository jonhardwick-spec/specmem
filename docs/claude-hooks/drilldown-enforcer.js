#!/usr/bin/env node
/**
 * DRILLDOWN ENFORCER HOOK
 * =======================
 *
 * Enforces the drilldown workflow after SpecMem searches.
 *
 * Problem: Claude uses find_memory/find_code_pointers, gets results with _drill
 * instructions, then ignores them and uses Read/Glob/Grep directly.
 *
 * Solution: This hook tracks when SpecMem searches return results and reminds
 * Claude to drill down before using other search tools.
 *
 * State is persisted to $SPECMEM_RUN_DIR/specmem-drilldown-state.json
 * (defaults to ./run/specmem-drilldown-state.json if env not set)
 *
 * Works in standalone mode (no PM2 required)
 *
 * Hook Event: PreToolUse
 */

const fs = require('fs');
const path = require('path');

// Helper to expand ${cwd} in env vars (Claude Code doesn't expand them!)
function expandCwd(val) {
  if (!val) return val;
  return val.replace(/\$\{cwd\}/g, process.cwd()).replace(/\$cwd/g, process.cwd());
}



// Project-relative paths - use process.cwd() as base for per-project isolation
const SPECMEM_HOME = expandCwd(process.env.SPECMEM_HOME) || path.join(process.cwd(), 'specmem');
const SPECMEM_PKG = expandCwd(process.env.SPECMEM_PKG) || path.join(process.cwd(), 'specmem');
// Per-project sockets: default to {cwd}/specmem/sockets/ (NOT SPECMEM_HOME/run!)
const SPECMEM_RUN_DIR = expandCwd(process.env.SPECMEM_RUN_DIR) || path.join(process.cwd(), 'specmem/sockets');

// Use project-scoped paths for state and logging
const STATE_FILE = path.join(SPECMEM_RUN_DIR, 'specmem-drilldown-state.json');
const LOG_FILE = path.join(SPECMEM_HOME, 'logs', 'drilldown-enforcer.log');

// Tools that trigger enforcement reminder
const SEARCH_TOOLS = ['Read', 'Glob', 'Grep', 'Bash'];

// SpecMem tools that should clear the enforcement
const SPECMEM_DRILLDOWN_TOOLS = [
  'mcp__specmem__get_memory',  // This is the drilldown action
];

// SpecMem tools that SET enforcement (when they return results)
const SPECMEM_SEARCH_TOOLS = [
  'mcp__specmem__find_memory',
  'mcp__specmem__find_code_pointers',
  'mcp__specmem__smart_search',
];

function log(message) {
  try {
    const timestamp = new Date().toISOString();
    const logDir = path.dirname(LOG_FILE);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(LOG_FILE, `${timestamp} - ${message}\n`);
  } catch (e) {
    // Silent fail
  }
}

function getState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const content = fs.readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    // LOW-40 FIX: Delete corrupted state file instead of silently failing
    try {
      fs.unlinkSync(STATE_FILE);
      log(`Deleted corrupted state file: ${e.message}`);
    } catch (e2) { /* ignore */ }
  }
  return {
    hasPendingDrilldown: false,
    lastSearchTool: null,
    lastSearchQuery: null,
    resultCount: 0,
    drillInstructions: [],
    timestamp: null
  };
}

function saveState(state) {
  try {
    // Ensure run directory exists for state file
    const stateDir = path.dirname(STATE_FILE);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    log(`Failed to save state: ${e.message}`);
  }
}

function clearState() {
  saveState({
    hasPendingDrilldown: false,
    lastSearchTool: null,
    lastSearchQuery: null,
    resultCount: 0,
    drillInstructions: [],
    timestamp: null
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
  let inputData = await readStdinWithTimeout(5000);

  try {
    const hookData = JSON.parse(inputData);
    const toolName = hookData.tool_name || '';
    const toolInput = hookData.tool_input || {};

    const state = getState();

    // Check if this is a drilldown action (clears enforcement)
    if (SPECMEM_DRILLDOWN_TOOLS.includes(toolName)) {
      log(`Drilldown detected via ${toolName} - clearing enforcement`);
      clearState();
      process.exit(0);
    }

    // Check if this is a search tool that should trigger reminder
    if (SEARCH_TOOLS.includes(toolName) && state.hasPendingDrilldown) {
      // Check if state is recent (within 10 minutes)
      const stateAge = Date.now() - new Date(state.timestamp).getTime();
      if (stateAge < 10 * 60 * 1000) {
        log(`Intercepted ${toolName} - pending drilldown from ${state.lastSearchTool}`);

        // Generate reminder message
        const reminder = generateDrilldownReminder(state, toolName, toolInput);

        // Output the reminder as context injection
        const output = {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: 'Drilldown reminder injected',
            additionalContext: reminder
          }
        };

        console.log(JSON.stringify(output));
        process.exit(0);
      } else {
        // State too old, clear it
        clearState();
      }
    }

    // Allow tool to proceed
    process.exit(0);

  } catch (error) {
    log(`Error: ${error.message}`);
    process.exit(0);
  }
}

function generateDrilldownReminder(state, attemptedTool, toolInput) {
  const instructions = state.drillInstructions.slice(0, 3);

  let reminder = `
⚠️ DRILLDOWN REMINDER ⚠️

You just searched SpecMem with "${state.lastSearchTool}" and got ${state.resultCount} results.
Now you're trying to use "${attemptedTool}" directly.

STOP! Use the _drill instructions from your search results first:
${instructions.map((inst, i) => `  ${i + 1}. ${inst}`).join('\n')}

If the first result doesn't have what you need, ITERATE - drill into result #2, #3, etc.
Only use ${attemptedTool} if you've drilled down and still need more info.

To drill down on a memory, use: get_memory({id: "MEMORY_ID_FROM_RESULTS"})
`;

  return reminder;
}

// Also export a function to SET the drilldown state (called by PostToolUse or external)
// This would be called after find_memory/find_code_pointers returns results
function setDrilldownPending(searchTool, query, resultCount, drillInstructions) {
  saveState({
    hasPendingDrilldown: true,
    lastSearchTool: searchTool,
    lastSearchQuery: query,
    resultCount: resultCount,
    drillInstructions: drillInstructions,
    timestamp: new Date().toISOString()
  });
  log(`Set drilldown pending: ${searchTool} returned ${resultCount} results`);
}

// Run main
main().catch(err => {
  // LOW-44 FIX: Log errors to both file AND stderr
  log(`Fatal: ${err.message}`);
  console.error('[drilldown-enforcer] Fatal:', err.message || err);
  process.exit(0);
});

// Export for external use
module.exports = { setDrilldownPending, clearState, getState };
