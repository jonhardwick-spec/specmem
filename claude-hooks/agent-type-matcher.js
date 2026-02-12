#!/usr/bin/env node
/**
 * Agent Type Matcher - Auto-match task requirements to agent capabilities
 * =======================================================================
 *
 * Analyzes the task prompt and automatically selects (or rejects) agent types
 * based on their ACTUAL capabilities. Prevents issues like:
 *   - Deploying Explore agents for tasks requiring file writes
 *   - Using Bash agents for tasks needing code analysis
 *   - Picking feature-dev agents when Edit/Write is required
 *
 * Hook Event: PreToolUse
 * Matcher: Task
 * Priority: Should run BEFORE agent-loading-hook.js
 *
 * Set SPECMEM_AUTO_MATCH=1 to auto-upgrade agents when capabilities don't match.
 * Set SPECMEM_STRICT_MATCH=1 to block mismatched agents entirely.
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// AGENT CAPABILITY DEFINITIONS - What each agent type CAN and CANNOT do
// ============================================================================

const AGENT_CAPABILITIES = {
  // FULL ACCESS AGENTS - Can do everything
  'general-purpose': {
    canWrite: true,
    canRead: true,
    canBash: true,
    canSearch: true,
    canPlan: true,
    canWebSearch: true,
    bestFor: ['complex tasks', 'multi-step work', 'any task'],
    description: 'Full toolset - can do anything',
    tools: ['All tools available']
  },

  'Plan': {
    canWrite: true,
    canRead: true,
    canBash: true,
    canSearch: true,
    canPlan: true,
    canWebSearch: true,
    bestFor: ['architecture', 'design', 'implementation plans'],
    description: 'Architecture and planning specialist',
    tools: ['All tools available']
  },

  // READ-ONLY AGENTS - Cannot modify files!
  'Explore': {
    canWrite: false,  // CRITICAL: Cannot write files!
    canRead: true,
    canBash: false,
    canSearch: true,
    canPlan: false,
    canWebSearch: true,
    bestFor: ['codebase exploration', 'finding files', 'understanding code'],
    description: 'Fast codebase search - READ-ONLY',
    tools: ['All tools for reading/searching'],
    warnings: ['Cannot write, edit, or create files']
  },

  'feature-dev:code-explorer': {
    canWrite: false,  // No Edit/Write tools!
    canRead: true,
    canBash: false,   // Only BashOutput, not full Bash
    canSearch: true,
    canPlan: false,
    canWebSearch: true,
    bestFor: ['deep code analysis', 'tracing execution', 'understanding features'],
    description: 'Deep analysis - READ-ONLY',
    tools: ['Glob', 'Grep', 'LS', 'Read', 'NotebookRead', 'WebFetch', 'TodoWrite', 'WebSearch'],
    warnings: ['Cannot write, edit, or create files', 'Cannot run arbitrary bash commands']
  },

  'feature-dev:code-architect': {
    canWrite: false,
    canRead: true,
    canBash: false,
    canSearch: true,
    canPlan: true,  // Can plan but not execute
    canWebSearch: true,
    bestFor: ['architecture design', 'implementation blueprints', 'feature design'],
    description: 'Architecture design - READ-ONLY',
    tools: ['Glob', 'Grep', 'LS', 'Read', 'NotebookRead', 'WebFetch', 'TodoWrite', 'WebSearch'],
    warnings: ['Cannot write, edit, or create files - only designs']
  },

  'feature-dev:code-reviewer': {
    canWrite: false,
    canRead: true,
    canBash: false,
    canSearch: true,
    canPlan: false,
    canWebSearch: true,
    bestFor: ['code review', 'finding bugs', 'security analysis'],
    description: 'Code review - READ-ONLY',
    tools: ['Glob', 'Grep', 'LS', 'Read', 'NotebookRead', 'WebFetch', 'TodoWrite', 'WebSearch'],
    warnings: ['Cannot write, edit, or create files - only reviews']
  },

  // LIMITED AGENTS
  'Bash': {
    canWrite: false,  // Only through bash commands
    canRead: false,
    canBash: true,
    canSearch: false,
    canPlan: false,
    canWebSearch: false,
    bestFor: ['git operations', 'npm commands', 'shell scripts', 'CLI tools'],
    description: 'Shell command specialist - Bash only',
    tools: ['Bash'],
    warnings: ['Only has Bash tool - no file tools']
  }
};

// ============================================================================
// TASK REQUIREMENT DETECTION - Analyze what the task needs
// ============================================================================

/**
 * Patterns that indicate the task requires file writing
 */
const WRITE_PATTERNS = [
  /\b(write|create|make|add|implement|build|generate)\b.*\b(file|code|function|class|component|module|test|documentation)/i,
  /\b(fix|update|modify|change|edit|refactor|rename)\b/i,
  /\b(save|store|output)\b.*\b(to|in)\b/i,
  /\b(create|write|generate|add)\b.*\b(new|a)\b/i,
  /\bimplementing\b/i,
  /\badd\b.*\bto\b/i,
  /\binsert\b/i,
  /\bdelete\b.*\b(from|in)\b/i,
  /\breplace\b/i,
  /\bcommit\b/i,
  /\bpush\b/i,
];

/**
 * Patterns that indicate read-only exploration is sufficient
 */
const READ_PATTERNS = [
  /\b(find|search|look for|locate)\b/i,
  /\b(explain|understand|analyze|describe)\b/i,
  /\b(what|where|how|why|which)\b.*\?/i,
  /\b(trace|follow|track)\b.*\b(execution|flow|path)\b/i,
  /\b(list|show|display)\b.*\b(files|functions|classes)\b/i,
  /\b(review|check|examine|inspect)\b/i,
  /\bexplore\b/i,
];

/**
 * Patterns that indicate bash/CLI is needed
 */
const BASH_PATTERNS = [
  /\b(run|execute|npm|yarn|pnpm|git|docker)\b/i,
  /\b(install|build|test|deploy)\b\s+(the|this)?/i,
  /\b(start|stop|restart)\b.*\b(server|service|process)\b/i,
  /\b(command|terminal|shell|cli)\b/i,
];

/**
 * Patterns indicating architecture/planning needs
 */
const PLAN_PATTERNS = [
  /\b(design|architect|plan|strategy)\b/i,
  /\b(blueprint|roadmap|specification)\b/i,
  /\bhow (should|would|could) (we|i)\b/i,
  /\b(approach|implementation plan)\b/i,
];

/**
 * Analyze task prompt to determine requirements
 */
function analyzeTaskRequirements(prompt) {
  const requirements = {
    needsWrite: false,
    needsRead: true,  // Almost always needed
    needsBash: false,
    needsSearch: false,
    needsPlan: false,
    confidence: 'low',
    detectedPatterns: []
  };

  // Check for write requirements
  for (const pattern of WRITE_PATTERNS) {
    if (pattern.test(prompt)) {
      requirements.needsWrite = true;
      requirements.detectedPatterns.push(`write: ${pattern.toString()}`);
    }
  }

  // Check for bash requirements
  for (const pattern of BASH_PATTERNS) {
    if (pattern.test(prompt)) {
      requirements.needsBash = true;
      requirements.detectedPatterns.push(`bash: ${pattern.toString()}`);
    }
  }

  // Check for plan requirements
  for (const pattern of PLAN_PATTERNS) {
    if (pattern.test(prompt)) {
      requirements.needsPlan = true;
      requirements.detectedPatterns.push(`plan: ${pattern.toString()}`);
    }
  }

  // Check for read-only patterns
  let readOnlyMatches = 0;
  for (const pattern of READ_PATTERNS) {
    if (pattern.test(prompt)) {
      readOnlyMatches++;
      requirements.needsSearch = true;
      requirements.detectedPatterns.push(`read: ${pattern.toString()}`);
    }
  }

  // Determine confidence
  if (requirements.detectedPatterns.length >= 3) {
    requirements.confidence = 'high';
  } else if (requirements.detectedPatterns.length >= 1) {
    requirements.confidence = 'medium';
  }

  // Special case: if ONLY read patterns match and no write patterns
  if (readOnlyMatches > 0 && !requirements.needsWrite && !requirements.needsBash) {
    requirements.readOnlySufficient = true;
  }

  return requirements;
}

// ============================================================================
// AGENT MATCHING LOGIC
// ============================================================================

/**
 * Check if an agent type can fulfill task requirements
 */
function agentCanFulfill(agentType, requirements) {
  const caps = AGENT_CAPABILITIES[agentType];
  if (!caps) return { canFulfill: true, reason: 'Unknown agent - allowing by default' };

  const issues = [];

  if (requirements.needsWrite && !caps.canWrite) {
    issues.push(`Cannot write files (task requires: write/edit/create)`);
  }

  if (requirements.needsBash && !caps.canBash) {
    issues.push(`Cannot run bash commands (task requires: shell/git/npm)`);
  }

  return {
    canFulfill: issues.length === 0,
    issues,
    agentCaps: caps
  };
}

/**
 * Find the best agent type for given requirements
 */
function findBestAgent(requirements) {
  // If write is needed, use general-purpose or Plan
  if (requirements.needsWrite) {
    if (requirements.needsPlan) {
      return { agent: 'Plan', reason: 'Task needs architecture planning AND file modifications' };
    }
    return { agent: 'general-purpose', reason: 'Task requires file modifications' };
  }

  // If only bash is needed
  if (requirements.needsBash && !requirements.needsWrite && !requirements.needsSearch) {
    return { agent: 'Bash', reason: 'Task only needs shell commands' };
  }

  // If planning is needed but no write
  if (requirements.needsPlan && !requirements.needsWrite) {
    return { agent: 'feature-dev:code-architect', reason: 'Architecture design (read-only)' };
  }

  // Read-only exploration
  if (requirements.readOnlySufficient) {
    return { agent: 'Explore', reason: 'Read-only exploration is sufficient' };
  }

  // Default to general-purpose for ambiguous cases
  return { agent: 'general-purpose', reason: 'Default choice for complex/ambiguous tasks' };
}

// ============================================================================
// HOOK HANDLER
// ============================================================================

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';
    const toolInput = data.tool_input || {};

    // Only process Task tool
    if (toolName !== 'Task') {
      process.exit(0);
    }

    const prompt = toolInput.prompt || '';
    const description = toolInput.description || '';
    const requestedType = toolInput.subagent_type || 'general-purpose';

    // Skip if already has matcher marker
    if (prompt.includes('[AGENT_TYPE_MATCHED]')) {
      process.exit(0);
    }

    // Analyze requirements
    const requirements = analyzeTaskRequirements(prompt + ' ' + description);

    // Check if requested agent can fulfill
    const fulfillment = agentCanFulfill(requestedType, requirements);

    // Settings from env
    const AUTO_MATCH = process.env.SPECMEM_AUTO_MATCH === '1';
    const STRICT_MATCH = process.env.SPECMEM_STRICT_MATCH === '1';

    if (!fulfillment.canFulfill) {
      // Agent CAN'T fulfill the task!
      const best = findBestAgent(requirements);

      if (STRICT_MATCH) {
        // Block and explain
        console.log(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `❌ AGENT MISMATCH: "${requestedType}" cannot fulfill task requirements!\n\nIssues:\n${fulfillment.issues.map(i => '  • ' + i).join('\n')}\n\nRecommended: "${best.agent}" (${best.reason})\n\nRe-deploy with correct agent type, or set SPECMEM_AUTO_MATCH=1 for auto-upgrade.`
          }
        }));
        process.exit(0);
      }

      if (AUTO_MATCH) {
        // Auto-upgrade to correct agent
        const upgradedInput = {
          ...toolInput,
          subagent_type: best.agent,
          prompt: `[AGENT_TYPE_MATCHED] Auto-upgraded from ${requestedType} to ${best.agent}: ${best.reason}\n\n${prompt}`
        };

        console.log(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: `⚡ AUTO-MATCH: Upgraded ${requestedType} → ${best.agent} (${best.reason})`,
            updatedInput: upgradedInput
          }
        }));
        process.exit(0);
      }

      // Default: Warn but allow (for backward compat)
      const warningContext = `
[AGENT-TYPE-WARNING]
⚠️ POTENTIAL CAPABILITY MISMATCH DETECTED

Requested Agent: ${requestedType}
Issues:
${fulfillment.issues.map(i => '  • ' + i).join('\n')}

Recommended: ${best.agent} (${best.reason})

The task MAY fail. Consider re-deploying with "${best.agent}" if issues occur.

Set SPECMEM_AUTO_MATCH=1 for automatic agent upgrades.
Set SPECMEM_STRICT_MATCH=1 to block mismatches.
[/AGENT-TYPE-WARNING]
`;

      const warnedInput = {
        ...toolInput,
        prompt: prompt + warningContext
      };

      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: `⚠️ Capability mismatch: ${requestedType} may not handle this task. Recommended: ${best.agent}`,
          updatedInput: warnedInput
        }
      }));
      process.exit(0);
    }

    // Agent CAN fulfill - proceed normally
    process.exit(0);

  } catch (e) {
    // LOW-44 FIX: Log errors before exit
    console.error('[agent-type-matcher] Error:', e.message || e);
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('[agent-type-matcher] Unhandled error:', e.message || e);
  process.exit(0);
});
