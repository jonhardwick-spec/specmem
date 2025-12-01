#!/usr/bin/env node
/**
 * TASK PROGRESS HOOK - Real loading bars for Task tool agents
 *
 * Writes DIRECTLY to /dev/tty to bypass Claude's stdout capture
 * This actually shows content in the terminal!
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const specmemPaths = require('./specmem-paths.cjs');

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

// Spawn a DETACHED process that writes DIRECTLY to /dev/tty
function writeToTerminal(text) {
  try {
    // Create script that writes directly to /dev/tty (the REAL terminal)
    const scriptPath = `${PROJECT_TMP_DIR}/loading-${Date.now()}.sh`;
    fs.writeFileSync(scriptPath, `#!/bin/bash
# Write directly to controlling terminal, bypassing all redirects
cat << 'LOADINGBAR' > /dev/tty
${text}
LOADINGBAR
rm -f "${scriptPath}" 2>/dev/null
`, { mode: 0o755 });

    // Spawn with setsid to create new session, fully detached
    const child = spawn('setsid', ['bash', scriptPath], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
  } catch (e) {
    // If setsid fails, try direct
    try {
      execSync(`echo '${text.replace(/'/g, "\\'")}' > /dev/tty`, { stdio: 'ignore' });
    } catch (e2) {}
  }
}

const PROGRESS_PATH = `${PROJECT_TMP_DIR}/task-progress.json`;
const SPINNER_PID_PATH = `${PROJECT_TMP_DIR}/spinner.pid`;

function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_PATH)) {
      return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
    }
  } catch (e) {}
  return { tasks: {}, activeCount: 0 };
}

function saveProgress(data) {
  try {
    fs.writeFileSync(PROGRESS_PATH, JSON.stringify(data, null, 2));
  } catch (e) {}
}

function killSpinner() {
  try {
    if (fs.existsSync(SPINNER_PID_PATH)) {
      const pid = parseInt(fs.readFileSync(SPINNER_PID_PATH, 'utf8'));
      if (pid) process.kill(pid, 'SIGTERM');
      fs.unlinkSync(SPINNER_PID_PATH);
    }
  } catch (e) {}
}

// Read JSON from stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', async () => {
  try {
    const data = JSON.parse(input);
    const { hookEventName, toolName } = data;

    // Only handle Task tool
    if (toolName !== 'Task') {
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    if (hookEventName === 'PreToolUse') {
      handlePreTask(data);
    } else if (hookEventName === 'PostToolUse') {
      handlePostTask(data);
    } else {
      console.log(JSON.stringify({ continue: true }));
    }
  } catch (err) {
    // LOW-44 FIX: Log errors before exit
    console.error('[task-progress-hook] Error:', err.message || err);
    console.log(JSON.stringify({ continue: true }));
  }
});

function handlePreTask(data) {
  const { toolInput } = data;
  const description = toolInput?.description || 'Task';
  const runInBackground = toolInput?.run_in_background !== false;

  // Track task
  const progress = loadProgress();
  progress.activeCount++;
  const taskNum = progress.activeCount;
  progress.tasks[`task-${Date.now()}`] = {
    num: taskNum,
    description,
    startTime: Date.now(),
    background: runInBackground
  };
  saveProgress(progress);

  // Loading bar message - WRITE DIRECTLY TO TERMINAL
  const loadingBar = `
\x1b[36m╔════════════════════════════════════════════════════════════════╗
║  \x1b[33m🚀 DEPLOYING AGENT #${String(taskNum).padEnd(44)}\x1b[36m║
║  \x1b[90m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[36m  ║
║  \x1b[37m📋 ${description.slice(0, 55).padEnd(55)}\x1b[36m  ║
║  \x1b[32m⏳ Running in background...\x1b[36m                                   ║
╚════════════════════════════════════════════════════════════════╝\x1b[0m`;

  // THIS IS THE KEY - write directly to terminal!
  writeToTerminal(loadingBar);

  const output = {
    continue: true,
    suppressOutput: false,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: `
[AGENT #${taskNum} DEPLOYED]
Task: ${description}
Status: Running in background

OUTPUT PROGRESS using send_team_message():
- When starting: send_team_message({message: "🔄 Starting: [task]"})
- During work: send_team_message({message: "📝 Progress: [update]"})
- When done: send_team_message({message: "✅ Completed: [summary]"})
`
    }
  };

  console.log(JSON.stringify(output));
}

function handlePostTask(data) {
  const { toolInput, toolOutput } = data;
  const description = toolInput?.description || 'Task';

  killSpinner();

  // Get timing
  const progress = loadProgress();
  const tasks = Object.values(progress.tasks);
  const lastTask = tasks[tasks.length - 1];
  const duration = lastTask ? ((Date.now() - lastTask.startTime) / 1000).toFixed(1) : '?';

  // Clean summary
  let summary = '';
  if (typeof toolOutput === 'string') {
    const lines = toolOutput.split('\n').filter(l => l.trim());
    summary = lines.slice(-5).join('\n').slice(-300);
  }

  const completionBox = `
\x1b[32m╔════════════════════════════════════════════════════════════════╗
║  \x1b[1m✅ AGENT COMPLETED\x1b[0m\x1b[32m                                            ║
║  \x1b[90m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[32m  ║
║  \x1b[37m📋 ${description.slice(0, 55).padEnd(55)}\x1b[32m  ║
║  \x1b[33m⏱️  Duration: ${(duration + 's').padEnd(48)}\x1b[32m  ║
╚════════════════════════════════════════════════════════════════╝\x1b[0m`;

  // Write completion box directly to terminal
  writeToTerminal(completionBox);

  const output = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedMCPToolOutput: summary ? `Result:\n${summary}` : 'Task completed.'
    }
  };

  console.log(JSON.stringify(output));
}
