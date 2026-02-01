#!/usr/bin/env node
/**
 * AGENT OUTPUT INTERCEPTOR - Token-saving version
 * Blocks verbose agent output reads AND TaskOutput to conserve context
 * Redirects to compact MCP team messages instead
 */

const specmemPaths = require('./specmem-paths.cjs');

const fs = require('fs');
const path = require('path');

// Auto-expand cwd for project isolation
const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
const homeDir = process.env.HOME || '/root';

async function main() {
  // ═══════════════════════════════════════════════════════════════════
  // BYPASS: Debug mode for when you NEED to read raw agent output
  // WARNING: Raw agent output = 10k-50k tokens per read!
  // ═══════════════════════════════════════════════════════════════════
  // Option 1: SPECMEM_DEBUG_AGENTS=1 env var
  // Option 2: touch ~/.claude/.debug-agents
  //
  // Only use this if you're debugging agent failures!
  // This burns tokens like crazy - use read_team_messages() normally.
  // ═══════════════════════════════════════════════════════════════════
  if (process.env.SPECMEM_DEBUG_AGENTS === '1') {
    process.exit(0);
  }
  const debugFlagPath = path.join(homeDir, '.claude', '.debug-agents');
  if (fs.existsSync(debugFlagPath)) {
    process.exit(0);
  }

  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    const tool = data.tool_name || '';
    const toolInput = data.tool_input || {};

    // ═══════════════════════════════════════════════════════════════════
    // INTERCEPT TaskOutput - This is the main token waster!
    // TaskOutput returns full verbose JSON which burns 10k+ tokens
    // ═══════════════════════════════════════════════════════════════════
    if (tool === 'TaskOutput') {
      const taskId = toolInput.task_id || 'unknown';

      // Check if task is very recent (< 5 seconds) - allow first check
      // This gives agents time to post to team channel before we block
      const taskIdShort = taskId.slice(0, 8);

      // Use a state file to track first access per task
      const stateDir = path.join(projectPath, 'specmem', 'sockets');
      const statePath = path.join(stateDir, 'task-output-state.json');

      try {
        // Ensure state dir exists
        if (!fs.existsSync(stateDir)) {
          fs.mkdirSync(stateDir, { recursive: true });
        }

        // Load or create state
        let state = {};
        if (fs.existsSync(statePath)) {
          try {
            state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          } catch (e) {
            state = {};
          }
        }

        const now = Date.now();
        const firstAccess = state[taskId];

        if (!firstAccess) {
          // First time checking this task - allow it through and record timestamp
          state[taskId] = now;
          fs.writeFileSync(statePath, JSON.stringify(state));
          process.exit(0); // Allow first check
        }

        // Clean up old entries (> 30 min) to prevent state bloat
        const thirtyMinsAgo = now - 30 * 60 * 1000;
        for (const [tid, ts] of Object.entries(state)) {
          if (ts < thirtyMinsAgo) {
            delete state[tid];
          }
        }
        fs.writeFileSync(statePath, JSON.stringify(state));

      } catch (e) {
        // On error, allow access (fail open)
        process.exit(0);
      }

      // Subsequent access - deny and redirect to team messages
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `⚡ Token saver: Use mcp__specmem__read_team_messages({limit:5}) to check agent updates. Task ${taskIdShort} results are in team channel. (First check was allowed - subsequent checks blocked)`
        }
      }));
      process.exit(0);
    }

    // ═══════════════════════════════════════════════════════════════════
    // INTERCEPT Read/Bash of .output files
    // ═══════════════════════════════════════════════════════════════════
    const filePath = toolInput.file_path || toolInput.command || '';

    // Check for agent output files in multiple locations:
    // 1. Legacy: /tmp/claude/.../tasks/[hash].output
    // 2. Current: ~/.claude/projects/.../subagents/agent-[hash].jsonl
    const isLegacyOutput = /\/tmp\/claude\/.*\/tasks\/[a-f0-9]+\.output/.test(filePath);
    const isSubagentOutput = /\.claude\/projects\/.*\/subagents\/agent-[a-f0-9]+\.jsonl/.test(filePath);
    const isAgentOutput = isLegacyOutput || isSubagentOutput;

    if (isAgentOutput && (tool === 'Read' || tool === 'Bash')) {
      // Extract agent ID from either path format
      const legacyMatch = filePath.match(/tasks\/([a-f0-9]+)\.output/);
      const subagentMatch = filePath.match(/agent-([a-f0-9]+)\.jsonl/);
      const agentId = (legacyMatch || subagentMatch)?.[1] || 'unknown';

      // Allow first access per agent (same pattern as TaskOutput)
      const stateDir = path.join(projectPath, 'specmem', 'sockets');
      const statePath = path.join(stateDir, 'agent-output-state.json');

      try {
        if (!fs.existsSync(stateDir)) {
          fs.mkdirSync(stateDir, { recursive: true });
        }

        let state = {};
        if (fs.existsSync(statePath)) {
          try {
            state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          } catch (e) {
            state = {};
          }
        }

        const now = Date.now();
        const firstAccess = state[agentId];

        if (!firstAccess) {
          // First time reading this agent's output - allow it
          state[agentId] = now;
          fs.writeFileSync(statePath, JSON.stringify(state));
          process.exit(0); // Allow first read
        }

        // Clean up old entries (> 30 min)
        const thirtyMinsAgo = now - 30 * 60 * 1000;
        for (const [aid, ts] of Object.entries(state)) {
          if (ts < thirtyMinsAgo) {
            delete state[aid];
          }
        }
        fs.writeFileSync(statePath, JSON.stringify(state));

      } catch (e) {
        // On error, allow access (fail open)
        process.exit(0);
      }

      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `⚡ Token saver: Use mcp__specmem__read_team_messages() for agent ${agentId.slice(0,8)} results. (First read was allowed - subsequent reads blocked)`
        }
      }));
      process.exit(0);
    }

    // Allow everything else
    process.exit(0);
  } catch (e) {
    // LOW-44 FIX: Log errors before exit
    console.error('[agent-output-interceptor] Error:', e.message || e);
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('[agent-output-interceptor] Unhandled error:', e.message || e);
  process.exit(0);
});
