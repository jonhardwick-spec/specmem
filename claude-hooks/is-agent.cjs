#!/usr/bin/env node
/**
 * SHARED AGENT DETECTION UTILITY
 *
 * Use this in any hook that should ONLY run for agents, not main Claude.
 *
 * Usage:
 *   const { isAgent } = require('./is-agent.cjs');
 *   if (!isAgent()) process.exit(0); // Skip for main Claude
 */

/**
 * Detect if current process is an agent (not main Claude)
 *
 * IMPORTANT: Only explicit agent indicators count!
 * Screen sessions (STY) and process trees are NOT reliable because
 * main Claude also runs in screen sessions via specmem-init.
 */
function isAgent() {
  // ONLY use explicit env vars set by agent spawning code
  // These are set by deployTeamMember or Task tool when spawning agents
  if (process.env.SPECMEM_AGENT_MODE === '1') return true;
  if (process.env.SPECMEM_TEAM_MEMBER_ID) return true;
  if (process.env.CLAUDE_SUBAGENT === '1') return true;
  if (process.env.CLAUDE_AGENT_ID) return true;

  // Check if this is a team member screen session (has specmem-tm- prefix)
  // Regular Claude screens are claude-<project>, not specmem-tm-
  if (process.env.STY && process.env.STY.includes('specmem-tm-')) return true;

  // Check working directory for agent-specific paths
  try {
    const cwd = process.cwd();
    // Only agent scratchpads, not main project
    if (cwd.includes('/tmp/claude/') && cwd.includes('/scratchpad/')) {
      return true;
    }
  } catch (e) {}

  // Default: NOT an agent (main Claude session gets unrestricted access)
  return false;
}

/**
 * Check if we're in a subagent context (Task tool spawned)
 */
function isSubagent() {
  return process.env.CLAUDE_SUBAGENT === '1' ||
         process.env.CLAUDE_AGENT_ID !== undefined;
}

/**
 * Check if we're a deployed team member (specmem team member system)
 */
function isTeamMember() {
  return process.env.SPECMEM_TEAM_MEMBER_ID !== undefined ||
         (process.env.STY && process.env.STY.includes('specmem-tm-'));
}

module.exports = {
  isAgent,
  isSubagent,
  isTeamMember
};
