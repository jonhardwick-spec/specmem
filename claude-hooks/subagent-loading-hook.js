#!/usr/bin/env node
/**
 * SUBAGENT LOADING HOOK - Visual Progress for Task Agents
 *
 * Based on MCP Runtime Guide (Hardwick Software Services):
 * - SubagentStart: Injects context, tracks spawning
 * - SubagentStop: Reports completion
 * - Uses suppressOutput to reduce noise while still injecting context
 *
 * The loading bars you see in  Code come from the agent's
 * output streaming. This hook provides CONTEXT not loading bars.
 *
 * For true loading bars, agents need to output progress themselves
 * or use run_in_background: true (but then you see nothing).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const specmemPaths = require('./specmem-paths.cjs');
const { isSubagent } = require('./is-agent.cjs');

// Use shared path utilities
const { expandCwd } = specmemPaths;

// Project hash for path isolation
const _projectPath = expandCwd(process.env.SPECMEM_PROJECT_PATH) || process.cwd();
const _projectHash = process.env.SPECMEM_PROJECT_HASH ||
  crypto.createHash('sha256').update(path.resolve(_projectPath)).digest('hex').slice(0, 12);
const PROJECT_TMP_DIR = `/tmp/specmem-${_projectHash}`;

// Ensure project tmp directory exists
try {
  if (!fs.existsSync(PROJECT_TMP_DIR)) {
    fs.mkdirSync(PROJECT_TMP_DIR, { recursive: true, mode: 0o755 });
  }
} catch (e) {}

// Track active agents for multi-spawn coordination
const TRACKING_PATH = `${PROJECT_TMP_DIR}/agents.json`;

function loadTracking() {
  try {
    if (fs.existsSync(TRACKING_PATH)) {
      return JSON.parse(fs.readFileSync(TRACKING_PATH, 'utf8'));
    }
  } catch (e) {}
  return { agents: {}, count: 0 };
}

function saveTracking(data) {
  try {
    fs.writeFileSync(TRACKING_PATH, JSON.stringify(data, null, 2));
  } catch (e) {}
}

// ULTRA-FAST TIMEOUT - Don't block user input AT ALL
// This hook should complete in <500ms or bail
const FAST_TIMEOUT = 500; // 0.5s max - user experience is priority
setTimeout(() => {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}, FAST_TIMEOUT);

// If stdin is empty/slow, exit immediately
process.stdin.once('readable', () => {
  if (!process.stdin.read()) {
    // No data available, exit fast
    setTimeout(() => {
      console.log(JSON.stringify({ continue: true }));
      process.exit(0);
    }, 100);
  }
});

// Read JSON from stdin with immediate processing
let input = '';
let processed = false;

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  // Try to process as soon as we have valid JSON
  if (!processed && input.includes('}')) {
    try {
      const data = JSON.parse(input);
      processed = true;
      processHookData(data);
    } catch (e) {
      // Not complete JSON yet, wait for more
    }
  }
});

process.stdin.on('end', () => {
  if (!processed) {
    try {
      const data = JSON.parse(input);
      processHookData(data);
    } catch (err) {
      console.log(JSON.stringify({ continue: true }));
    }
  }
});

function processHookData(data) {
  const eventName = data.hookEventName;
  if (eventName === 'SubagentStart') {
    handleSubagentStart(data);
  } else if (eventName === 'SubagentStop') {
    handleSubagentStop(data);
  } else {
    console.log(JSON.stringify({ continue: true }));
  }
  process.exit(0);
}

function handleSubagentStart(data) {
  const { subagentId, parentId, prompt, tools } = data;

  // Track this agent
  const tracking = loadTracking();
  tracking.count++;
  const agentNum = tracking.count;
  tracking.agents[subagentId] = {
    num: agentNum,
    startTime: Date.now(),
    prompt: (prompt || '').slice(0, 100),
    tools: tools || []
  };
  saveTracking(tracking);

  // Extract purpose (clean up prompt for display)
  const purpose = (prompt || 'Working...')
    .split('\n')[0]
    .slice(0, 60)
    .replace(/[#*_`]/g, '');

  // Loading context - gets injected into agent's context
  // FLATTENED: No newlines to avoid breaking 's context formatting
  // CRITICAL: The announcement requirement is MANDATORY and ENFORCED by team-comms-enforcer.cjs
  // Make it PROMINENT and FIRST in the context so agents don't miss it
  const shortPurpose = purpose.slice(0, 30).replace(/"/g, "'");
  const loadingContext = '[AGENT-' + agentNum + '-MANDATORY-STARTUP] YOUR FIRST ACTION MUST BE: send_team_message({type:"status", message:"Starting: ' + shortPurpose + '"}) | WARNING: You WILL BE BLOCKED from ALL other tools until you announce via send_team_message. This is ENFORCED by hooks - no bypass possible. | Available MCP tools: send_team_message, read_team_messages, claim_task, release_task, get_team_status, find_memory, find_code_pointers | When done: send_team_message({type:"status", message:"Completed: [summary]"})';

  // suppressOutput: true = Context gets processed but doesn't spam terminal
  // The agent will output its OWN progress via team messages
  const output = {
    continue: true,
    suppressOutput: true,  // Don't show this context injection
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext: loadingContext
    }
  };

  // But we DO want to show a brief loading message to the user
  // Use systemMessage for that (shown as a warning/info to user)
  // Unfortunately systemMessage isn't supported for SubagentStart

  console.log(JSON.stringify(output));
}

function handleSubagentStop(data) {
  const { subagentId, result, duration } = data;

  // Update tracking
  const tracking = loadTracking();
  const agentInfo = tracking.agents[subagentId];
  const agentNum = agentInfo?.num || '?';

  if (agentInfo) {
    agentInfo.endTime = Date.now();
    agentInfo.result = result;
    agentInfo.duration = duration;
    saveTracking(tracking);
  }

  // Completion context - NOT suppressed (allows finish notifications to show)
  // FLATTENED: No newlines to avoid breaking 's context formatting
  const completionContext = '[TEAM#' + agentNum + '] Completed | Result: ' + (result || 'done') + ' | Duration: ' + (duration ? duration + 's' : 'N/A');

  const output = {
    continue: true,
    // NOTE: suppressOutput removed to allow completion notifications to show
    // This was blocking agent finish notifications from appearing
    hookSpecificOutput: {
      hookEventName: 'SubagentStop',
      additionalContext: completionContext
    }
  };

  console.log(JSON.stringify(output));
}
