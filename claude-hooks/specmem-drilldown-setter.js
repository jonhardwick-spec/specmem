#!/usr/bin/env node
/**
 * SPECMEM DRILLDOWN STATE SETTER
 * ==============================
 *
 * PostToolUse hook that sets drilldown state after SpecMem searches.
 * Works in tandem with drilldown-enforcer.js (PreToolUse hook).
 *
 * When find_memory/find_code_pointers returns results, this hook:
 * 1. Parses the results to extract memory IDs
 * 2. Writes state to $SPECMEM_RUN_DIR/specmem-drilldown-state.json
 * 3. The enforcer hook will then remind Claude to drill down
 *
 * Works in standalone mode (no PM2 required)
 *
 * Hook Event: PostToolUse
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Helper to expand ${cwd} in env vars (Claude Code doesn't expand them!)
function expandCwd(val) {
  if (!val) return val;
  return val.replace(/\$\{cwd\}/g, process.cwd()).replace(/\$cwd/g, process.cwd());
}




const SPECMEM_HOME = expandCwd(process.env.SPECMEM_HOME) || process.cwd();
const SPECMEM_RUN_DIR = expandCwd(process.env.SPECMEM_RUN_DIR) || path.join(process.cwd(), 'specmem/sockets');

const STATE_FILE = path.join(SPECMEM_RUN_DIR, 'specmem-drilldown-state.json');
const LOG_FILE = path.join(SPECMEM_HOME, 'logs', 'drilldown-setter.log');

// SpecMem search tools that should trigger drilldown tracking
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

function saveState(state) {
  try {
    // Ensure run directory exists for state file
    const stateDir = path.dirname(STATE_FILE);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    log(`State saved: ${state.resultCount} results from ${state.lastSearchTool}`);
  } catch (e) {
    log(`Failed to save state: ${e.message}`);
  }
}

/**
 * Parse SpecMem search results to extract drilldown info
 */
function parseSearchResults(toolOutput) {
  const results = [];
  const drillInstructions = [];

  try {
    // Try to parse as JSON first
    let data;
    if (typeof toolOutput === 'string') {
      // Try to find JSON in the output
      const jsonMatch = toolOutput.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        data = JSON.parse(jsonMatch[0]);
      }
    } else {
      data = toolOutput;
    }

    // Handle array of results
    if (Array.isArray(data)) {
      data.forEach((item, i) => {
        if (item.id || item._drill) {
          results.push({
            id: item.id,
            preview: (item.content || item.summary || '').slice(0, 100)
          });
          if (item._drill) {
            drillInstructions.push(`Result ${i + 1}: ${item._drill}`);
          } else if (item.id) {
            drillInstructions.push(`Result ${i + 1}: get_memory({id: "${item.id}"})`);
          }
        }
      });
    }

    // Handle object with results array
    if (data && data.results && Array.isArray(data.results)) {
      data.results.forEach((item, i) => {
        if (item.id || item._drill) {
          results.push({
            id: item.id,
            preview: (item.content || item.summary || '').slice(0, 100)
          });
          if (item._drill) {
            drillInstructions.push(`Result ${i + 1}: ${item._drill}`);
          } else if (item.id) {
            drillInstructions.push(`Result ${i + 1}: get_memory({id: "${item.id}"})`);
          }
        }
      });
    }

    // Also scan for _drill patterns in string output
    if (typeof toolOutput === 'string') {
      const drillPattern = /_drill["\s:]+["\']?([^"'\n,}]+)/g;
      let match;
      while ((match = drillPattern.exec(toolOutput)) !== null) {
        if (!drillInstructions.some(d => d.includes(match[1]))) {
          drillInstructions.push(`Drill: ${match[1]}`);
        }
      }

      // Also look for memory IDs
      const uuidPattern = /["']?id["']?\s*:\s*["']([a-f0-9-]{36})["']/gi;
      while ((match = uuidPattern.exec(toolOutput)) !== null) {
        if (!results.some(r => r.id === match[1])) {
          results.push({ id: match[1], preview: '' });
          drillInstructions.push(`get_memory({id: "${match[1]}"})`);
        }
      }
    }
  } catch (e) {
    log(`Parse error: ${e.message}`);
  }

  return { results, drillInstructions };
}

async function main() {
  let inputData = '';

  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  try {
    const hookData = JSON.parse(inputData);
    const toolName = hookData.tool_name || '';
    const toolOutput = hookData.tool_output || hookData.result || '';
    const toolInput = hookData.tool_input || {};

    // Only process SpecMem search tools
    if (!SPECMEM_SEARCH_TOOLS.includes(toolName)) {
      process.exit(0);
    }

    log(`Processing ${toolName} output`);

    // Parse the search results
    const { results, drillInstructions } = parseSearchResults(toolOutput);

    // Only set state if we have results
    if (results.length > 0) {
      const query = toolInput.query || toolInput.pattern || 'unknown query';

      saveState({
        hasPendingDrilldown: true,
        lastSearchTool: toolName,
        lastSearchQuery: query,
        resultCount: results.length,
        drillInstructions: drillInstructions.slice(0, 5), // Keep top 5
        resultIds: results.slice(0, 5).map(r => r.id),
        timestamp: new Date().toISOString()
      });

      log(`Set drilldown pending: ${results.length} results, ${drillInstructions.length} drill instructions`);
    } else {
      log(`No results to track from ${toolName}`);
    }

    // Exit cleanly (don't modify tool output)
    process.exit(0);

  } catch (error) {
    log(`Error: ${error.message}`);
    process.exit(0);
  }
}

main().catch(err => {
  // LOW-44 FIX: Log errors to both file AND stderr
  log(`Fatal: ${err.message}`);
  console.error('[specmem-drilldown-setter] Fatal:', err.message || err);
  process.exit(0);
});
