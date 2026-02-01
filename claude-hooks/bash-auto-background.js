#!/usr/bin/env node
/**
 * Bash Auto-Background Hook
 * ==========================
 *
 * PreToolUse hook for Bash that uses HEURISTICS (not execution!) to decide:
 * 1. Known quick commands -> run foreground
 * 2. Known long-running commands -> run background
 * 3. Uncertain commands -> use conservative heuristics
 *
 * SECURITY: This hook NEVER executes commands speculatively.
 * All decisions are made via pattern matching and heuristics only.
 *
 * Hook Event: PreToolUse
 * Matcher: Bash
 *
 * Set BASH_AUTO_BG_DISABLE=1 to disable this hook
 */

const fs = require('fs');
const path = require('path');

const DISABLED = process.env.BASH_AUTO_BG_DISABLE === '1';

// Commands that should NEVER be backgrounded (interactive or quick)
const NEVER_BACKGROUND = [
  /^(ls|pwd|echo|cat|head|tail|wc|date|whoami|id|which|type|file)\b/,
  /^(cd|pushd|popd)\b/,
  /^git (status|branch|log.*-\d|diff.*--stat)\b/,
  /^docker (ps|images|stats --no-stream)\b/,
  /^(true|false|:)\s*$/,
  /^printf\b/,
  /^test\b/,
  /^\[/,  // test bracket syntax
];

// Commands that should ALWAYS be backgrounded (known long-running)
const ALWAYS_BACKGROUND = [
  /^(npm|yarn|pnpm) (install|ci|build|test)\b/,
  /^docker (build|pull|push)\b/,
  /^git (clone|pull|fetch)\b/,
  /^(make|cmake|cargo build|go build)\b/,
  /\|\s*(less|more|vim|nano|vi)\b/,
  /^(sleep|watch)\b/,
  /^find\s+.*-exec\b/,  // find with -exec can be slow
  /^(rsync|scp|wget|curl.*-o)\b/,  // file transfers
  /^tar\s+(x|c).*[zj]f/,  // tar compression/extraction
];

// Commands that might be slow depending on scope (background if large paths)
const POTENTIALLY_SLOW = [
  /^find\b/,
  /^grep\s+-r\b/,
  /^rg\b/,
  /^ag\b/,
];

/**
 * Heuristic-based analysis of command (NO EXECUTION!)
 * Returns: { shouldBackground: boolean, reason: string }
 *
 * SECURITY FIX: This replaces the old quickPreview() which dangerously
 * executed commands with execSync before the permission check.
 */
function analyzeCommandHeuristically(command) {
  // Check for pipes to pagers - always background
  if (/\|\s*(less|more|head\s+-n\s*\d{3,}|tail\s+-n\s*\d{3,})/.test(command)) {
    return { shouldBackground: true, reason: 'pipes to pager/large output' };
  }

  // Check for redirects to files with known large outputs
  if (/>\s*\S+\s*2>&1/.test(command) && POTENTIALLY_SLOW.some(p => p.test(command))) {
    return { shouldBackground: true, reason: 'redirect with potentially slow command' };
  }

  // Very long commands are often complex scripts - be conservative
  if (command.length > 500) {
    return { shouldBackground: true, reason: 'complex command (>500 chars)' };
  }

  // Multiple piped commands can be slow
  const pipeCount = (command.match(/\|/g) || []).length;
  if (pipeCount >= 3) {
    return { shouldBackground: true, reason: `many pipes (${pipeCount})` };
  }

  // Commands with xargs can process many items
  if (/\|\s*xargs\b/.test(command)) {
    return { shouldBackground: true, reason: 'uses xargs (potentially many items)' };
  }

  // Default: don't background (let command run normally)
  return { shouldBackground: false, reason: 'default - run foreground' };
}

async function main() {
  if (DISABLED) {
    process.exit(0);
  }

  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';
    const toolInput = data.tool_input || {};

    if (toolName !== 'Bash') {
      process.exit(0);
    }

    const command = toolInput.command || '';

    // Skip if already set to background
    if (toolInput.run_in_background === true) {
      process.exit(0);
    }

    // Check never-background patterns (known quick commands)
    for (const pattern of NEVER_BACKGROUND) {
      if (pattern.test(command)) {
        process.exit(0); // Run normally in foreground
      }
    }

    // Check always-background patterns (known long-running)
    for (const pattern of ALWAYS_BACKGROUND) {
      if (pattern.test(command)) {
        // Force background
        const modifiedInput = {
          ...toolInput,
          run_in_background: true
        };
        console.log(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: `⚡ Auto-backgrounding: ${command.slice(0, 40)}...`,
            updatedInput: modifiedInput
          }
        }));
        process.exit(0);
      }
    }

    // For uncertain commands, use heuristic analysis (NO EXECUTION!)
    const analysis = analyzeCommandHeuristically(command);

    if (analysis.shouldBackground) {
      const modifiedInput = {
        ...toolInput,
        run_in_background: true
      };
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: `📊 Heuristic: ${analysis.reason}`,
          updatedInput: modifiedInput
        }
      }));
      process.exit(0);
    }

    // Default: run foreground (let  Bash tool handle it normally)
    process.exit(0);

  } catch (e) {
    // LOW-44 FIX: Log errors before exit
    console.error('[bash-auto-background] Error:', e.message || e);
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('[bash-auto-background] Unhandled error:', e.message || e);
  process.exit(0);
});
