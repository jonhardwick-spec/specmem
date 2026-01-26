#!/usr/bin/env node
/**
 * TEAM COMMS ENFORCER HOOK - STRICT MODE
 *
 * BLOCKS agents that don't follow protocol:
 * 1. Must announce via send_team_message FIRST
 * 2. Must claim_task before any work
 * 3. After 3 searches: BLOCK until they use find_memory/find_code_pointers
 * 4. Before Edit/Write: BLOCK if no claim or no memory tool usage
 * 5. Every 5 tool usages: BLOCK until they check broadcasts (read_team_messages)
 * 6. Every 8 tool usages: BLOCK until they check help requests (get_team_status)
 * 7. Before Edit/Write: CHECK if file is claimed by another agent (collision prevention)
 *
 * File claim tracking:
 * - Claims are written to PROJECT_TMP_DIR/active-claims.json
 * - Before writing, check if another agent has the file claimed
 * - Claims auto-expire after 30 minutes
 * - release_task() clears claims from this session
 *
 * Cross-swarm help is ALWAYS allowed - helping hands make the world go round!
 * - request_help: Ask for help from any swarm
 * - respond_to_help: Help agents in other swarms
 *
 * Main window (no agents) = pass through
 * Agents = STRICT enforcement
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// AGENT DETECTION: Use shared is-agent.cjs for reliable env-var-based detection
// This checks CLAUDE_SUBAGENT, CLAUDE_AGENT_ID, SPECMEM_AGENT_MODE, etc.
let isAgentFn;
try {
  isAgentFn = require('./is-agent.cjs').isAgent;
} catch {
  // Fallback: try from specmem package
  try {
    isAgentFn = require('/usr/lib/node_modules/specmem-hardwicksoftware/claude-hooks/is-agent.cjs').isAgent;
  } catch {
    isAgentFn = () => false; // Can't detect agents, skip enforcement
  }
}

// Project paths - CRITICAL: Use cwd() FIRST, not inherited env vars
// This prevents cross-project enforcement (specmem agents blocking /newServer)
const _projectPath = process.cwd();  // ALWAYS use current working directory
const _projectHash = crypto.createHash('sha256').update(path.resolve(_projectPath)).digest('hex').slice(0, 12);
const PROJECT_TMP_DIR = `/tmp/specmem-${_projectHash}`;
const TRACKING_FILE = `${PROJECT_TMP_DIR}/agent-enforcement.json`;
const ACTIVE_AGENTS_FILE = `${PROJECT_TMP_DIR}/active-agents.json`;

// Ensure tmp dir
try {
  if (!fs.existsSync(PROJECT_TMP_DIR)) {
    fs.mkdirSync(PROJECT_TMP_DIR, { recursive: true, mode: 0o755 });
  }
} catch (e) {}

// ============================================================================
// CONFIGURATION
// ============================================================================
const MAX_SEARCHES_BEFORE_BLOCK = 3;
const TEAM_COMMS_CHECK_INTERVAL = 4;  // MUST read_team_messages every 4 tool usages
const BROADCAST_CHECK_INTERVAL = 5;   // MUST read_team_messages w/ include_broadcasts every 5 tool usages
const HELP_CHECK_INTERVAL = 8;        // Check help requests every 8 tool usages

// Tools that count as "announcing"
const ANNOUNCE_TOOLS = [
  'mcp__specmem__send_team_message',
  'mcp__specmem__broadcast_to_team'
];

// Tools that count as "claiming"
const CLAIM_TOOLS = [
  'mcp__specmem__claim_task'
];

// Memory/semantic tools they MUST use
const MEMORY_TOOLS = [
  'mcp__specmem__find_memory',
  'mcp__specmem__find_code_pointers',
  'mcp__specmem__smart_search',
  'mcp__specmem__findMemoryGallery',
  'mcp__specmem__drill_down',
  'mcp__specmem__getMemoryFull'
];

// Tools that count as checking broadcasts
const BROADCAST_CHECK_TOOLS = [
  'mcp__specmem__read_team_messages'  // Must have include_broadcasts: true
];

// Tools that count as checking/responding to help
const HELP_CHECK_TOOLS = [
  'mcp__specmem__get_team_status',      // Shows open help requests
  'mcp__specmem__request_help',         // Asking for help
  'mcp__specmem__respond_to_help'       // Responding to help
];

// Basic search tools (limited before requiring memory tools)
const BASIC_SEARCH_TOOLS = ['Grep', 'Glob', 'Read'];

// Dangerous tools that require full compliance
const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit'];

// FULL COMPLIANCE TOOLS - agents use these to bypass everything
// Requires: announced + claimed + usedMemoryTools
// - Bash: can run grep/cat/sed/echo to bypass all limits
// - Task: can spawn sub-agents to bypass limits
const FULL_COMPLIANCE_TOOLS = ['Bash', 'Task'];

// Tools that are always allowed (reading team state + cross-swarm help)
const ALWAYS_ALLOWED = [
  'mcp__specmem__read_team_messages',
  'mcp__specmem__get_team_status',
  'mcp__specmem__send_team_message',
  'mcp__specmem__broadcast_to_team',
  'mcp__specmem__claim_task',
  'mcp__specmem__release_task',
  'mcp__specmem__find_memory',
  'mcp__specmem__find_code_pointers',
  'mcp__specmem__smart_search',
  'mcp__specmem__findMemoryGallery',
  'mcp__specmem__drill_down',
  'mcp__specmem__getMemoryFull',
  'mcp__specmem__save_memory',
  // Cross-swarm help - helping hands make the world go round!
  'mcp__specmem__request_help',
  'mcp__specmem__respond_to_help'
];

// ============================================================================
// TRACKING
// ============================================================================
function loadTracking() {
  try {
    if (fs.existsSync(TRACKING_FILE)) {
      return JSON.parse(fs.readFileSync(TRACKING_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveTracking(data) {
  try {
    fs.writeFileSync(TRACKING_FILE, JSON.stringify(data, null, 2));
  } catch (e) {}
}

function getAgentState(tracking, sessionId) {
  if (!tracking[sessionId]) {
    tracking[sessionId] = {
      announced: false,
      claimed: false,
      usedMemoryTools: false,
      searchCount: 0,
      blockedCount: 0,
      commsToolCount: 0,           // Tool calls since last team comms check (every 4)
      broadcastToolCount: 0,       // Tool calls since last broadcast check (every 5)
      helpToolUsageCount: 0,       // Tool calls since last help check (every 8)
      lastCommsCheck: Date.now(),
      lastBroadcastCheck: Date.now(),
      lastHelpCheck: Date.now(),
      needsCommsCheck: false,      // HARD BLOCK until they read team messages
      needsBroadcastCheck: false,  // HARD BLOCK until they read broadcasts
      needsHelpCheck: false,       // Flag when they hit the limit
      lastActivity: Date.now()
    };
  }
  return tracking[sessionId];
}

function isSpecmemProject() {
  // Check if this project is actually using specmem
  // If there's no .specmem dir or specmem sockets, don't enforce
  const indicators = [
    path.join(_projectPath, '.specmem'),
    path.join(_projectPath, 'specmem', 'sockets'),
    path.join(_projectPath, 'specmem.env')
  ];
  return indicators.some(p => fs.existsSync(p));
}

/**
 * Detect if this hook is running inside an agent context.
 *
 * THREE detection methods (any one = agent):
 * 1. Environment vars: CLAUDE_SUBAGENT, CLAUDE_AGENT_ID, SPECMEM_AGENT_MODE, etc.
 *    (set by Claude Code for subagents, or by deployTeamMember for team members)
 * 2. Subagent tracking: agents.json written by subagent-loading-hook.js on SubagentStart
 *    has active agents with no endTime = currently running subagent
 * 3. Active agents file: active-agents.json written by agent-loading-hook.js
 *    has recently spawned agents
 *
 * CRITICAL: session_id is NOT reliable because subagents share the parent's session_id.
 */
function isRunningAsAgent() {
  // Method 1: Environment variable detection (most reliable)
  if (isAgentFn()) return true;

  // Method 2: Check subagent tracking (from subagent-loading-hook.js SubagentStart)
  try {
    const agentsFile = `${PROJECT_TMP_DIR}/agents.json`;
    if (fs.existsSync(agentsFile)) {
      const data = JSON.parse(fs.readFileSync(agentsFile, 'utf8'));
      const now = Date.now();
      for (const agent of Object.values(data.agents || {})) {
        // Agent started within last 10 min AND has no endTime = still running
        if (!agent.endTime && agent.startTime && (now - agent.startTime < 600000)) {
          return true;
        }
      }
    }
  } catch {}

  return false;
}

function isSpecmemEnabled() {
  if (!isSpecmemProject()) return false;
  // Check that enforcement makes sense (agents exist or we are one)
  if (isAgentFn()) return true;
  try {
    // Check active-agents.json for recently spawned agents
    if (!fs.existsSync(ACTIVE_AGENTS_FILE)) return false;
    const agents = JSON.parse(fs.readFileSync(ACTIVE_AGENTS_FILE, 'utf8'));
    const now = Date.now();
    for (const agent of Object.values(agents)) {
      if (now - agent.spawnedAt < 600000) return true;
    }
  } catch {}
  return false;
}

// ============================================================================
// BLOCK RESPONSE BUILDERS
// ============================================================================
function blockResponse(reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  });
}

function allowWithReminder(reminder) {
  return JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: reminder
    }
  });
}

// ============================================================================
// MAIN HOOK
// ============================================================================

// FAST TIMEOUT - Never block main Claude
// If stdin takes too long, bail and allow the tool call
setTimeout(() => {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}, 500); // 0.5s max

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name;
    const sessionId = data.session_id || 'unknown';

    // ========================================================================
    // AGENT DETECTION - ONLY ENFORCE ON AGENT SESSIONS
    // Uses env vars (CLAUDE_SUBAGENT, CLAUDE_AGENT_ID, etc.) + subagent tracking
    // Main Claude window is NEVER blocked, only subagents/team members
    // ========================================================================
    if (!isRunningAsAgent()) {
      // Not an agent - pass through immediately
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    // Verify this is a specmem-enabled project
    if (!isSpecmemProject()) {
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    // ========================================================================
    // AGENTS ARE ACTIVE - ENFORCE PROTOCOL
    // ========================================================================
    const tracking = loadTracking();
    const state = getAgentState(tracking, sessionId);
    state.lastActivity = Date.now();

    // ========================================================================
    // TRACK STATE FOR ALL TOOLS (announcements, claims, memory, comms)
    // ========================================================================
    if (ANNOUNCE_TOOLS.includes(toolName)) {
      state.announced = true;
    }
    if (CLAIM_TOOLS.includes(toolName)) {
      state.claimed = true;
      const params = data.tool_input || {};
      const claimFiles = params.files || [];
      const claimDesc = params.description || 'unnamed task';
      const claimsFile = `${PROJECT_TMP_DIR}/active-claims.json`;
      try {
        let claims = {};
        if (fs.existsSync(claimsFile)) {
          claims = JSON.parse(fs.readFileSync(claimsFile, 'utf8'));
        }
        const claimId = `claim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        claims[claimId] = {
          sessionId, agentId: sessionId, files: claimFiles,
          description: claimDesc, createdAt: Date.now()
        };
        const now = Date.now();
        for (const [id, claim] of Object.entries(claims)) {
          if (now - claim.createdAt > 1800000) delete claims[id];
        }
        fs.writeFileSync(claimsFile, JSON.stringify(claims, null, 2));
        state.currentClaimId = claimId;
      } catch (e) {}
    }
    if (toolName === 'mcp__specmem__release_task') {
      const claimsFile = `${PROJECT_TMP_DIR}/active-claims.json`;
      try {
        if (fs.existsSync(claimsFile)) {
          let claims = JSON.parse(fs.readFileSync(claimsFile, 'utf8'));
          for (const [id, claim] of Object.entries(claims)) {
            if (claim.sessionId === sessionId) delete claims[id];
          }
          fs.writeFileSync(claimsFile, JSON.stringify(claims, null, 2));
        }
      } catch (e) {}
      state.claimed = false;
      state.editedFiles = [];
    }
    if (MEMORY_TOOLS.includes(toolName)) {
      state.usedMemoryTools = true;
      state.searchCount = 0;
    }
    // Track team comms reads - resets comms counter
    if (BROADCAST_CHECK_TOOLS.includes(toolName)) {
      state.commsToolCount = 0;
      state.lastCommsCheck = Date.now();
      state.needsCommsCheck = false;
      // Also reset broadcast counter IF they included broadcasts
      const params = data.tool_input || {};
      if (params.include_broadcasts !== false) {
        state.broadcastToolCount = 0;
        state.lastBroadcastCheck = Date.now();
        state.needsBroadcastCheck = false;
      }
    }
    if (HELP_CHECK_TOOLS.includes(toolName)) {
      state.helpToolUsageCount = 0;
      state.lastHelpCheck = Date.now();
      state.needsHelpCheck = false;
    }

    // ========================================================================
    // CHECK: Must announce first (before anything else)
    // ========================================================================
    if (!state.announced && !ALWAYS_ALLOWED.includes(toolName)) {
      state.blockedCount++;
      saveTracking(tracking);
      console.log(blockResponse(
        `[BLOCKED] You MUST ANNOUNCE yourself first!\n\n` +
        `This is your MANDATORY FIRST ACTION before any other tool:\n\n` +
        `send_team_message({type:"status", message:"Starting: [describe your task]"})\n\n` +
        `Note: If you were assigned to a specific channel (e.g. swarm-1, swarm-2), use that channel.\n` +
        `Otherwise, the message will go to the main channel.\n\n` +
        `After announcing, you can proceed with other tools.`
      ));
      return;
    }

    // ========================================================================
    // INCREMENT ALL COUNTERS ON EVERY TOOL CALL (per-agent, per-session)
    // This counts ALL tools including ALWAYS_ALLOWED - no dodging
    // ========================================================================
    state.commsToolCount = (state.commsToolCount || 0) + 1;
    state.broadcastToolCount = (state.broadcastToolCount || 0) + 1;
    state.helpToolUsageCount = (state.helpToolUsageCount || 0) + 1;

    // ========================================================================
    // HARD BLOCK: Must read team messages every 4 tool usages
    // read_team_messages() satisfies this - any mode
    // ========================================================================
    if (state.commsToolCount >= TEAM_COMMS_CHECK_INTERVAL && !BROADCAST_CHECK_TOOLS.includes(toolName)) {
      state.needsCommsCheck = true;
      state.blockedCount++;
      saveTracking(tracking);
      console.log(blockResponse(
        `[BLOCKED] MANDATORY team comms check! (${state.commsToolCount} tools since last check)\n\n` +
        `REQUIRED: read_team_messages({include_swarms: true, limit: 5})\n\n` +
        `You MUST check team messages every 4 tool calls. This is non-negotiable.\n` +
        `Other agents may have critical updates for you. CHECK NOW.`
      ));
      return;
    }

    // ========================================================================
    // HARD BLOCK: Must read broadcasts every 5 tool usages
    // read_team_messages({include_broadcasts: true}) satisfies this
    // ========================================================================
    if (state.broadcastToolCount >= BROADCAST_CHECK_INTERVAL && !BROADCAST_CHECK_TOOLS.includes(toolName)) {
      state.needsBroadcastCheck = true;
      state.blockedCount++;
      saveTracking(tracking);
      console.log(blockResponse(
        `[BLOCKED] MANDATORY broadcast check! (${state.broadcastToolCount} tools since last broadcast check)\n\n` +
        `REQUIRED: read_team_messages({include_broadcasts: true, include_swarms: true, limit: 10})\n\n` +
        `You MUST check broadcasts every 5 tool calls. This is non-negotiable.\n` +
        `Team-wide announcements and status updates require your attention. CHECK NOW.`
      ));
      return;
    }

    // ========================================================================
    // CHECK: Must check help requests every 8 tool usages
    // ========================================================================
    if (state.helpToolUsageCount >= HELP_CHECK_INTERVAL && !HELP_CHECK_TOOLS.includes(toolName)) {
      state.needsHelpCheck = true;
      state.blockedCount++;
      saveTracking(tracking);
      console.log(blockResponse(
        `[BLOCKED] Time to check if anyone needs help! (${state.helpToolUsageCount} tools since last check)\n\n` +
        `REQUIRED: get_team_status()\n\n` +
        `This shows open help requests from ALL swarms. Helping hands make the world go round!\n` +
        `If you see a request you can help with, use respond_to_help().\n` +
        `After checking, you can continue working.`
      ));
      return;
    }

    // ========================================================================
    // ALWAYS ALLOWED TOOLS - pass through after counter checks
    // ========================================================================
    if (ALWAYS_ALLOWED.includes(toolName)) {
      saveTracking(tracking);
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    // ========================================================================
    // WARN: Approaching comms check
    // ========================================================================
    if (state.commsToolCount === TEAM_COMMS_CHECK_INTERVAL - 1) {
      console.log(allowWithReminder(
        `[HEADS UP] Next tool call will require team comms check. Do it now: read_team_messages({include_swarms: true, limit: 5})`
      ));
      // Don't return - continue to other checks
    }

    // ========================================================================
    // BASIC SEARCH TOOLS - Limited to 3 before requiring memory tools
    // ========================================================================
    if (BASIC_SEARCH_TOOLS.includes(toolName)) {
      state.searchCount++;

      if (state.searchCount > MAX_SEARCHES_BEFORE_BLOCK && !state.usedMemoryTools) {
        state.blockedCount++;
        saveTracking(tracking);
        console.log(blockResponse(
          `[BLOCKED] ${state.searchCount} searches without using memory tools!\n\n` +
          `YOU MUST USE THESE FIRST:\n` +
          `• find_memory({query:"your search"}) - semantic memory search\n` +
          `• find_code_pointers({query:"your search"}) - semantic code search with tracebacks\n\n` +
          `These are MORE POWERFUL than Grep/Glob. USE THEM NOW.`
        ));
        return;
      }

      // Warn at limit
      if (state.searchCount === MAX_SEARCHES_BEFORE_BLOCK && !state.usedMemoryTools) {
        saveTracking(tracking);
        console.log(allowWithReminder(
          `[WARNING] Last search before BLOCK! Use find_memory() or find_code_pointers() NOW or next search will be blocked.`
        ));
        return;
      }

      saveTracking(tracking);
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    // ========================================================================
    // WRITE TOOLS - Must have claimed AND used memory tools
    // Also check if file is claimed by another agent
    // ========================================================================
    if (WRITE_TOOLS.includes(toolName)) {
      const issues = [];
      const toolInput = data.tool_input || {};
      const filePath = toolInput.file_path || '';

      if (!state.claimed) {
        issues.push(`claim_task({description:"what you're doing", files:["${filePath || 'file.ts'}"]}) - CLAIM FIRST`);
      }
      if (!state.usedMemoryTools) {
        issues.push(`find_memory() or find_code_pointers() to understand the code first`);
      }

      // Check if this file is claimed by ANOTHER agent
      if (filePath && state.claimed) {
        const claimsFile = `${PROJECT_TMP_DIR}/active-claims.json`;
        try {
          if (fs.existsSync(claimsFile)) {
            const claims = JSON.parse(fs.readFileSync(claimsFile, 'utf8'));
            for (const [claimId, claim] of Object.entries(claims)) {
              if (claim.files && claim.files.includes(filePath)) {
                // Someone has this file claimed - is it us?
                if (claim.sessionId !== sessionId && claim.agentId !== sessionId) {
                  // Another agent has this file claimed!
                  const claimedBy = claim.description || claim.agentId || 'another agent';
                  issues.push(`File "${filePath}" is claimed by: ${claimedBy}\n   Wait for them to release_task() or coordinate via send_team_message()`);
                }
              }
            }
          }
        } catch (e) {
          // Silently continue if can't read claims
        }
      }

      if (issues.length > 0) {
        state.blockedCount++;
        saveTracking(tracking);
        console.log(blockResponse(
          `[BLOCKED] Cannot ${toolName} without proper preparation!\n\n` +
          `YOU MUST DO THESE FIRST:\n` +
          issues.map((i, idx) => `${idx + 1}. ${i}`).join('\n') + `\n\n` +
          `Then retry your ${toolName}.`
        ));
        return;
      }

      // Track that we edited this file (for auto-release reminder)
      if (!state.editedFiles) state.editedFiles = [];
      if (filePath && !state.editedFiles.includes(filePath)) {
        state.editedFiles.push(filePath);
      }

      saveTracking(tracking);
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    // ========================================================================
    // BASH - THE ULTIMATE BYPASS TOOL - REQUIRES EVERYTHING
    // Agents use Bash to bypass by running: grep, cat, find, sed, echo, etc.
    // ========================================================================
    if (FULL_COMPLIANCE_TOOLS.includes(toolName)) {
      const issues = [];

      if (!state.announced) {
        issues.push(`send_team_message({message:"Starting: [task]", type:"status"}) - ANNOUNCE FIRST`);
      }
      if (!state.claimed) {
        issues.push(`claim_task({description:"what you're doing"}) - CLAIM YOUR WORK`);
      }
      if (!state.usedMemoryTools) {
        issues.push(`find_memory() or find_code_pointers() - USE SEMANTIC SEARCH FIRST`);
      }

      if (issues.length > 0) {
        state.blockedCount++;
        saveTracking(tracking);
        const toolType = toolName === 'Task' ? 'sub-agents' : 'Bash';
        console.log(blockResponse(
          `[BLOCKED] ${toolName} requires FULL protocol compliance!\n\n` +
          `Nice try - no bypassing through ${toolType}.\n\n` +
          `YOU MUST DO ALL OF THESE FIRST:\n` +
          issues.map((i, idx) => `${idx + 1}. ${i}`).join('\n') + `\n\n` +
          `NO SHORTCUTS. Follow the protocol.`
        ));
        return;
      }

      saveTracking(tracking);
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    // ========================================================================
    // OTHER TOOLS - Allow but remind
    // ========================================================================
    saveTracking(tracking);

    if (!state.usedMemoryTools && state.searchCount > 0) {
      console.log(allowWithReminder(
        `[REMINDER] Use find_memory() and find_code_pointers() for better results!`
      ));
      return;
    }

    console.log(JSON.stringify({ continue: true }));

  } catch (err) {
    console.log(JSON.stringify({ continue: true }));
  }
});
