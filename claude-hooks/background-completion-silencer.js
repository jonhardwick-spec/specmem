#!/usr/bin/env node
/**
 * Background Completion Silencer
 * ===============================
 *
 * Intercepts background task/shell completion notifications and:
 * 1. Silently logs them instead of spamming Claude
 * 2. Shows minimal 1-line notification to user terminal
 * 3. Prevents Claude from blocking on processing notifications
 *
 * Hook Event: PostToolUse (for Task, Bash with run_in_background)
 *
 * The problem: When multiple background tasks complete, their notifications
 * flood Claude and block user interaction until all are processed.
 *
 * The fix: Intercept completions, show minimal terminal notification,
 * suppress the verbose output that makes Claude respond.
 */

const fs = require('fs');
const path = require('path');

// ANSI colors for terminal output
const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

/**
 * Write minimal notification to terminal (bypasses Claude's stdin)
 */
function notifyTerminal(message) {
  try {
    // Write to stderr so it appears in terminal but doesn't bloat tool output
    process.stderr.write(`${ANSI.dim}${message}${ANSI.reset}\n`);
  } catch (e) {}
}

/**
 * Log completion to file for later review
 */
function logCompletion(taskId, status, summary) {
  const logDir = process.env.SPECMEM_HOME
    ? path.join(process.env.SPECMEM_HOME, 'logs')
    : path.join(process.env.HOME || '/tmp', '.specmem', 'logs');

  try {
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'background-completions.log');
    const entry = `[${new Date().toISOString()}] ${taskId}: ${status} - ${summary}\n`;
    fs.appendFileSync(logFile, entry);
  } catch (e) {}
}

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
    const toolOutput = data.tool_output || {};

    // Only intercept background completions
    const isBackgroundTask = toolInput.run_in_background === true;
    const isTaskTool = toolName === 'Task';
    const isBashTool = toolName === 'Bash';

    if (!isBackgroundTask && !isTaskTool) {
      // Not a background operation, pass through
      process.exit(0);
    }

    // Check if this is a completion notification (has output/result)
    const hasOutput = toolOutput && (
      toolOutput.output ||
      toolOutput.result ||
      toolOutput.stdout ||
      toolOutput.status === 'completed'
    );

    if (!hasOutput) {
      // Still running or just started, pass through
      process.exit(0);
    }

    // This is a completion - silence the verbose output!
    const taskId = toolInput.description || toolInput.task_id || 'background task';
    const status = toolOutput.status || 'completed';

    // Get a short summary (first 50 chars of output)
    let summary = '';
    if (typeof toolOutput.output === 'string') {
      summary = toolOutput.output.slice(0, 50).replace(/\n/g, ' ');
    } else if (typeof toolOutput.result === 'string') {
      summary = toolOutput.result.slice(0, 50).replace(/\n/g, ' ');
    }

    // Log full output to file
    logCompletion(taskId, status, JSON.stringify(toolOutput).slice(0, 500));

    // Show minimal terminal notification
    const icon = status === 'completed' ? '✓' : status === 'failed' ? '✗' : '•';
    notifyTerminal(`${ANSI.gray}[bg]${ANSI.reset} ${icon} ${taskId.slice(0, 30)}${summary ? ': ' + summary.slice(0, 20) + '...' : ''}`);

    // Return minimal output to Claude (doesn't trigger verbose processing)
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        // Suppress the full output, replace with minimal acknowledgment
        suppressOutput: true,
        minimalOutput: `[Background ${status}: ${taskId.slice(0, 30)}]`
      }
    }));

  } catch (e) {
    // LOW-44 FIX: Log errors before exit
    console.error('[background-completion-silencer] Error:', e.message || e);
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('[background-completion-silencer] Unhandled error:', e.message || e);
  process.exit(0);
});
