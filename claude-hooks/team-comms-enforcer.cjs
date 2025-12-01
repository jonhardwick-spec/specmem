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
const BROADCAST_CHECK_INTERVAL = 5;   // Check broadcasts every 5 tool usages
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
      toolUsageCount: 0,           // Total tool calls since last broadcast check
      helpToolUsageCount: 0,       // Total tool calls since last help check
      lastBroadcastCheck: Date.now(),
      lastHelpCheck: Date.now(),
      needsBroadcastCheck: false,  // Flag when they hit the limit
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

function hasActiveAgents() {
  try {
    // CRITICAL: Only enforce on specmem-enabled projects
    if (!isSpecmemProject()) return false;

    if (!fs.existsSync(ACTIVE_AGENTS_FILE)) return false;
    const agents = JSON.parse(fs.readFileSync(ACTIVE_AGENTS_FILE, 'utf8'));
    const now = Date.now();
    // Only count agents spawned in the last 10 minutes
    for (const agent of Object.values(agents)) {
      if (now - agent.spawnedAt < 600000) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

function isAgentSession(sessionId) {
  // Check if THIS session is a spawned agent (vs main Claude window)
  // Main Claude should NEVER be blocked - only enforce on subagents
  //
  // FIX: Since sessionIds aren't stored when agents spawn, we need a different approach:
  // 1. Check if this is explicitly the MAIN session (stored in main-session.json)
  // 2. If not main AND agents are active, treat as agent
  try {
    if (!fs.existsSync(ACTIVE_AGENTS_FILE)) return false;
    const agents = JSON.parse(fs.readFileSync(ACTIVE_AGENTS_FILE, 'utf8'));

    // Check if sessionId is explicitly registered (legacy check)
    for (const [agentId, agent] of Object.entries(agents)) {
      if (agent.sessionId === sessionId || agentId === sessionId) {
        return true;
      }
    }

    // NEW: Check if this is the MAIN session
    const mainSessionFile = `${PROJECT_TMP_DIR}/main-session.json`;
    if (fs.existsSync(mainSessionFile)) {
      const mainData = JSON.parse(fs.readFileSync(mainSessionFile, 'utf8'));
      if (mainData.sessionId === sessionId) {
        return false; // This IS the main session, not an agent
      }
    }

    // If agents are active and we're not the main session, assume we're an agent
    // This catches spawned agents whose sessionIds weren't captured at spawn time
    const now = Date.now();
    for (const agent of Object.values(agents)) {
      if (now - agent.spawnedAt < 600000) {
        // There ARE active agents, and we're not the main session
        // So we must be one of the agents
        return true;
      }
    }

    return false;
  } catch (e) {
    return false;
  }
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
    // MAIN WINDOW CHECK - ONLY ENFORCE ON AGENT SESSIONS
    // Main Claude window should NEVER be blocked, only subagents
    // ========================================================================
    if (!hasActiveAgents() || !isAgentSession(sessionId)) {
      // No agents running OR this is the main Claude window - pass through
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
    // ALWAYS ALLOWED TOOLS - but track state
    // ========================================================================
    if (ALWAYS_ALLOWED.includes(toolName)) {
      // Track announcements
      if (ANNOUNCE_TOOLS.includes(toolName)) {
        state.announced = true;
      }
      // Track claims + write to shared claims file
      if (CLAIM_TOOLS.includes(toolName)) {
        state.claimed = true;
        // Write claim to shared file so other agents can see it
        const params = data.tool_input || {};
        const claimFiles = params.files || [];
        const claimDesc = params.description || 'unnamed task';
        const claimsFile = `${PROJECT_TMP_DIR}/active-claims.json`;
        try {
          let claims = {};
          if (fs.existsSync(claimsFile)) {
            claims = JSON.parse(fs.readFileSync(claimsFile, 'utf8'));
          }
          // Add this claim
          const claimId = `claim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          claims[claimId] = {
            sessionId,
            agentId: sessionId,
            files: claimFiles,
            description: claimDesc,
            createdAt: Date.now()
          };
          // Clean up old claims (>30 min)
          const now = Date.now();
          for (const [id, claim] of Object.entries(claims)) {
            if (now - claim.createdAt > 1800000) delete claims[id];
          }
          fs.writeFileSync(claimsFile, JSON.stringify(claims, null, 2));
          state.currentClaimId = claimId;
        } catch (e) {}
      }
      // Track release_task - remove from shared claims
      if (toolName === 'mcp__specmem__release_task') {
        const claimsFile = `${PROJECT_TMP_DIR}/active-claims.json`;
        try {
          if (fs.existsSync(claimsFile)) {
            let claims = JSON.parse(fs.readFileSync(claimsFile, 'utf8'));
            // Remove claims from this session
            for (const [id, claim] of Object.entries(claims)) {
              if (claim.sessionId === sessionId) delete claims[id];
            }
            fs.writeFileSync(claimsFile, JSON.stringify(claims, null, 2));
          }
        } catch (e) {}
        state.claimed = false;
        state.editedFiles = [];
      }
      // Track memory tool usage
      if (MEMORY_TOOLS.includes(toolName)) {
        state.usedMemoryTools = true;
        state.searchCount = 0; // Reset search count
      }
      // Track broadcast checks (read_team_messages with broadcasts)
      if (BROADCAST_CHECK_TOOLS.includes(toolName)) {
        // Check if they included broadcasts in the params
        const params = data.tool_input || {};
        if (params.include_broadcasts !== false) {  // Default is true
          state.toolUsageCount = 0;  // Reset counter
          state.lastBroadcastCheck = Date.now();
          state.needsBroadcastCheck = false;
        }
      }
      // Track help checks
      if (HELP_CHECK_TOOLS.includes(toolName)) {
        state.helpToolUsageCount = 0;  // Reset counter
        state.lastHelpCheck = Date.now();
        state.needsHelpCheck = false;
      }
      saveTracking(tracking);
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    // ========================================================================
    // CHECK: Must announce first
    // ========================================================================
    if (!state.announced) {
      state.blockedCount++;
      saveTracking(tracking);
      // Make the announcement requirement very clear with proper channel guidance
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
    // INCREMENT TOOL USAGE COUNTERS (for broadcast/help enforcement)
    // ========================================================================
    state.toolUsageCount = (state.toolUsageCount || 0) + 1;
    state.helpToolUsageCount = (state.helpToolUsageCount || 0) + 1;

    // ========================================================================
    // CHECK: Must check broadcasts every 5 tool usages
    // ========================================================================
    if (state.toolUsageCount >= BROADCAST_CHECK_INTERVAL) {
      state.needsBroadcastCheck = true;
      state.blockedCount++;
      saveTracking(tracking);
      console.log(blockResponse(
        `[BLOCKED] Time to check broadcasts! (${state.toolUsageCount} tools since last check)\n\n` +
        `REQUIRED: read_team_messages({include_broadcasts: true, limit: 10})\n\n` +
        `Stay informed about team updates. Other swarms might need your help!\n` +
        `After checking, you can continue working.`
      ));
      return;
    }

    // ========================================================================
    // CHECK: Must check help requests every 8 tool usages
    // ========================================================================
    if (state.helpToolUsageCount >= HELP_CHECK_INTERVAL) {
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
    // WARN: Approaching broadcast check
    // ========================================================================
    if (state.toolUsageCount === BROADCAST_CHECK_INTERVAL - 1) {
      // Don't block, just warn
      console.log(allowWithReminder(
        `[HEADS UP] Next tool call will require broadcast check. Consider checking now with read_team_messages({include_broadcasts: true})`
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
