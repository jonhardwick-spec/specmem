#!/usr/bin/env node
/**
 * SPECMEM AUTOCLAUDE - Autonomous Claude Controller 🤖
 * =====================================================
 *
 * The future is here. No more n8n + ChatGPT middleman bullshit.
 * SpecMem directly controls Claude via screen sessions.
 *
 * Features:
 *   - Auto-accept permissions (configurable)
 *   - Prompt reinforcement
 *   - Completion detection ("completed completed completed")
 *   - Runtime duration limits (hour:minute format)
 *   - Detailed logging
 *
 * Usage:
 *   specmem-autoclaude <project-path> <prompt> [duration]
 *   Duration format: "1:30" = 1 hour 30 minutes
 *
 * @author hardwicksoftwareservices
 * @website https://justcalljon.pro
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

// ============================================================================
// ANSI COLORS
// ============================================================================

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightCyan: '\x1b[96m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m'
};

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // How often to check Claude's output (ms)
  pollInterval: 2000,

  // How long to wait after sending a prompt before checking (ms)
  promptCooldown: 5000,

  // Auto-permission settings
  autoAcceptPermissions: true,
  autoAllowDontAskAgain: true, // Use "don't ask again" option

  // Completion detection
  completionPattern: /completed\s+completed\s+completed/i,
  completionCheckInterval: 10000, // Check every 10 seconds after initial cooldown

  // Reinforcement settings
  reinforceAfterMinutes: 15, // Remind Claude of the objective
  maxReinforcements: 3,

  // Permission patterns
  permissionPatterns: [
    /\[yes\].*\[no\]/i,
    /Allow.*Deny/i,
    /Do you want to/i,
    /May Claude/i,
    /Permission required/i,
    /\(Y\/n\)/i,
    /approve.*reject/i,
    /accept.*decline/i
  ],

  // Error patterns (might need intervention)
  errorPatterns: [
    /error:/i,
    /failed to/i,
    /exception/i,
    /crashed/i,
    /ENOENT/i,
    /EACCES/i
  ],

  // Stuck patterns (Claude asking for input it shouldn't need)
  stuckPatterns: [
    /what would you like/i,
    /please provide/i,
    /i need more information/i,
    /could you clarify/i
  ]
};

// ============================================================================
// UTILITIES
// ============================================================================

function log(level, message) {
  const timestamp = new Date().toLocaleTimeString();
  const colors = {
    info: c.cyan,
    success: c.green,
    warn: c.yellow,
    error: c.red,
    debug: c.gray
  };
  const icons = {
    info: '●',
    success: '✓',
    warn: '⚠',
    error: '✗',
    debug: '·'
  };
  console.log(`${c.dim}[${timestamp}]${c.reset} ${colors[level]}${icons[level]}${c.reset} ${message}`);
}

function getProjectId(projectPath) {
  const name = path.basename(projectPath);
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}

function parseDuration(durationStr) {
  // Format: "1:30" = 1 hour 30 minutes
  const match = durationStr.match(/^(\d+):(\d+)$/);
  if (!match) {
    return 30 * 60 * 1000; // Default 30 minutes
  }
  const hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  return (hours * 60 + minutes) * 60 * 1000;
}

function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${minutes.toString().padStart(2, '0')}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// SCREEN CONTROL
// ============================================================================

function screenExists(name) {
  try {
    const output = execSync('screen -ls 2>/dev/null || true', { encoding: 'utf8' });
    return output.includes(name);
  } catch (e) {
    return false;
  }
}

function screenSend(sessionName, text, enterAfter = true) {
  try {
    execSync(`screen -S ${sessionName} -p 0 -X stuff "${text.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
    if (enterAfter) {
      execSync(`screen -S ${sessionName} -p 0 -X stuff "$(printf '\\x0d')"`, { stdio: 'ignore' });
    }
    return true;
  } catch (e) {
    return false;
  }
}

function screenKey(sessionName, key) {
  const keyMap = {
    enter: '\\x0d',
    down: '\\x1b[B',
    up: '\\x1b[A',
    'ctrl-c': '\\x03'
  };

  const code = keyMap[key];
  if (!code) return false;

  try {
    execSync(`screen -S ${sessionName} -p 0 -X stuff "$(printf '${code}')"`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function screenRead(sessionName, lines = 100) {
  try {
    const tmpFile = `/tmp/autoclaude-${Date.now()}.txt`;
    execSync(`screen -S ${sessionName} -p 0 -X hardcopy ${tmpFile}`, { stdio: 'ignore' });
    const content = fs.readFileSync(tmpFile, 'utf8');
    fs.unlinkSync(tmpFile);
    return content;
  } catch (e) {
    return '';
  }
}

function screenKill(sessionName) {
  try {
    execSync(`screen -S ${sessionName} -X quit 2>/dev/null || true`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

// ============================================================================
// AUTOCLAUDE CONTROLLER
// ============================================================================

class AutoClaudeController {
  constructor(projectPath, prompt, durationMs) {
    this.projectPath = projectPath;
    this.projectId = getProjectId(projectPath);
    this.prompt = prompt;
    this.durationMs = durationMs;

    this.claudeSession = `claude-${this.projectId}`;
    this.startTime = null;
    this.lastOutput = '';
    this.permissionsAccepted = 0;
    this.reinforcements = 0;
    this.lastReinforcementTime = 0;
    this.running = false;
    this.completed = false;

    // Stats
    this.stats = {
      startTime: null,
      endTime: null,
      permissionsHandled: 0,
      reinforcements: 0,
      completedSuccessfully: false,
      exitReason: null
    };
  }

  /**
   * Check if duration exceeded
   */
  isTimeUp() {
    if (!this.startTime) return false;
    const elapsed = Date.now() - this.startTime;
    return elapsed >= this.durationMs;
  }

  /**
   * Get remaining time
   */
  getRemainingTime() {
    if (!this.startTime) return this.durationMs;
    const elapsed = Date.now() - this.startTime;
    return Math.max(0, this.durationMs - elapsed);
  }

  /**
   * Start Claude
   */
  startClaude() {
    if (screenExists(this.claudeSession)) {
      log('warn', `Claude session already exists: ${this.claudeSession}`);
      log('info', 'Killing existing session...');
      screenKill(this.claudeSession);
      execSync('sleep 2');
    }

    log('info', `Starting Claude in screen: ${this.claudeSession}`);

    // PTY MEMORY APPROACH: NO -L -Logfile (zero disk I/O)
    // Uses screen hardcopy on-demand instead of continuous logging
    // -h 5000 sets scrollback buffer to 5000 lines for hardcopy capture
    const cmd = `screen -h 5000 -dmS ${this.claudeSession} bash -c "cd '${this.projectPath}' && claude 2>&1; exec bash"`;
    execSync(cmd, { stdio: 'ignore' });

    // Wait for it to start
    let tries = 0;
    while (!screenExists(this.claudeSession) && tries < 20) {
      execSync('sleep 0.5');
      tries++;
    }

    if (!screenExists(this.claudeSession)) {
      log('error', 'Failed to start Claude');
      return false;
    }

    log('success', 'Claude started');
    return true;
  }

  /**
   * Send the initial prompt
   */
  async sendPrompt() {
    log('info', 'Waiting for Claude to initialize...');
    await sleep(5000); // Wait for Claude to be ready

    log('info', `Sending prompt: ${this.prompt.substring(0, 50)}...`);

    // Build the reinforced prompt with completion instructions
    const fullPrompt = `${this.prompt}

IMPORTANT: When you have FULLY completed this task, respond with exactly:
"completed completed completed: <summary of what was done>"

This signals that the task is done. Do not use this phrase until you are COMPLETELY finished.`;

    screenSend(this.claudeSession, fullPrompt);
    log('success', 'Prompt sent');

    await sleep(CONFIG.promptCooldown);
  }

  /**
   * Check if waiting for permission
   */
  checkForPermission(output) {
    // Look at last 30 lines for permission prompts
    const recentOutput = output.split('\n').slice(-30).join('\n');

    for (const pattern of CONFIG.permissionPatterns) {
      if (pattern.test(recentOutput)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Handle permission prompt
   */
  handlePermission() {
    if (CONFIG.autoAllowDontAskAgain) {
      // Navigate to "Yes, don't ask again" (typically option 2)
      log('info', 'Auto-accepting permission (don\'t ask again)...');
      screenKey(this.claudeSession, 'down');
      execSync('sleep 0.2');
      screenKey(this.claudeSession, 'enter');
    } else {
      // Just accept (option 1)
      log('info', 'Auto-accepting permission...');
      screenKey(this.claudeSession, 'enter');
    }

    this.permissionsAccepted++;
    this.stats.permissionsHandled++;
    log('success', `Permission accepted (total: ${this.permissionsAccepted})`);
  }

  /**
   * Check for completion pattern
   */
  checkForCompletion(output) {
    return CONFIG.completionPattern.test(output);
  }

  /**
   * Check for stuck patterns (Claude asking unnecessary questions)
   */
  checkForStuck(output) {
    const recentOutput = output.split('\n').slice(-20).join('\n');
    for (const pattern of CONFIG.stuckPatterns) {
      if (pattern.test(recentOutput)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Reinforce the prompt
   */
  async reinforcePrompt() {
    if (this.reinforcements >= CONFIG.maxReinforcements) {
      log('warn', 'Max reinforcements reached');
      return;
    }

    const remaining = formatDuration(this.getRemainingTime());
    const reinforcement = `

REMINDER: Your objective is: "${this.prompt}"

Time remaining: ${remaining}

Please continue working on this task. When completely done, respond with:
"completed completed completed: <summary>"`;

    log('info', 'Sending reinforcement prompt...');
    screenSend(this.claudeSession, reinforcement);
    this.reinforcements++;
    this.stats.reinforcements++;
    this.lastReinforcementTime = Date.now();
    log('success', `Reinforcement sent (${this.reinforcements}/${CONFIG.maxReinforcements})`);
  }

  /**
   * Handle stuck Claude
   */
  async handleStuck() {
    log('warn', 'Claude appears to be stuck (asking for input)');

    const nudge = `

Continue with the task. Don't ask me questions - use your best judgment to proceed.
Your objective: "${this.prompt}"

Make decisions autonomously and continue working.`;

    screenSend(this.claudeSession, nudge);
    log('info', 'Sent nudge to continue');
  }

  /**
   * Main monitoring loop
   */
  async monitorLoop() {
    log('info', 'Starting monitoring loop...');

    while (this.running) {
      await sleep(CONFIG.pollInterval);

      // Check if Claude is still running
      if (!screenExists(this.claudeSession)) {
        log('error', 'Claude session terminated unexpectedly');
        this.stats.exitReason = 'session_terminated';
        this.running = false;
        break;
      }

      // Check time
      if (this.isTimeUp()) {
        const elapsed = formatDuration(Date.now() - this.startTime);
        log('warn', `Time limit reached (${elapsed})`);
        this.stats.exitReason = 'time_limit';
        this.running = false;
        break;
      }

      // Read output
      const output = screenRead(this.claudeSession);

      // Check for permission prompts
      if (CONFIG.autoAcceptPermissions && this.checkForPermission(output)) {
        this.handlePermission();
        await sleep(1000);
        continue;
      }

      // Check for completion
      if (this.checkForCompletion(output)) {
        log('success', '🎉 TASK COMPLETED! Claude signaled completion.');
        this.completed = true;
        this.stats.completedSuccessfully = true;
        this.stats.exitReason = 'completed';
        this.running = false;
        break;
      }

      // Check if stuck
      if (this.checkForStuck(output) && output !== this.lastOutput) {
        await this.handleStuck();
      }

      // Check if we need to reinforce
      const timeSinceReinforce = Date.now() - this.lastReinforcementTime;
      const timeSinceStart = Date.now() - this.startTime;
      if (timeSinceStart > CONFIG.reinforceAfterMinutes * 60 * 1000 &&
          timeSinceReinforce > CONFIG.reinforceAfterMinutes * 60 * 1000 &&
          this.reinforcements < CONFIG.maxReinforcements) {
        await this.reinforcePrompt();
      }

      // Check for significant output changes (Claude is working)
      if (output.length > this.lastOutput.length + 100) {
        log('debug', 'Claude is working...');
      }

      this.lastOutput = output;

      // Show status periodically
      const elapsed = formatDuration(Date.now() - this.startTime);
      const remaining = formatDuration(this.getRemainingTime());
      if (Math.random() < 0.1) { // ~10% of polls
        log('info', `Running... [${elapsed} elapsed, ${remaining} remaining, ${this.permissionsAccepted} perms]`);
      }
    }
  }

  /**
   * Run AutoClaude
   */
  async run() {
    console.log('');
    console.log(`${c.brightCyan}${c.bold}  ╔══════════════════════════════════════════════════╗${c.reset}`);
    console.log(`${c.brightCyan}${c.bold}  ║${c.reset}  ${c.brightYellow}🤖${c.reset} ${c.brightCyan}${c.bold}AUTOCLAUDE${c.reset} ${c.dim}v1.0.0${c.reset}                        ${c.brightCyan}${c.bold}║${c.reset}`);
    console.log(`${c.brightCyan}${c.bold}  ║${c.reset}  ${c.dim}Autonomous Claude Controller${c.reset}                  ${c.brightCyan}${c.bold}║${c.reset}`);
    console.log(`${c.brightCyan}${c.bold}  ╚══════════════════════════════════════════════════╝${c.reset}`);
    console.log('');
    console.log(`${c.dim}Project:${c.reset}  ${this.projectPath}`);
    console.log(`${c.dim}Duration:${c.reset} ${formatDuration(this.durationMs)}`);
    console.log(`${c.dim}Prompt:${c.reset}   ${this.prompt.substring(0, 60)}${this.prompt.length > 60 ? '...' : ''}`);
    console.log('');

    this.startTime = Date.now();
    this.stats.startTime = new Date().toISOString();
    this.running = true;

    // Start Claude
    if (!this.startClaude()) {
      this.stats.exitReason = 'start_failed';
      return this.stats;
    }

    // Send initial prompt
    await this.sendPrompt();

    // Start monitoring
    await this.monitorLoop();

    // Cleanup
    this.stats.endTime = new Date().toISOString();

    // Final summary
    console.log('');
    console.log(`${c.dim}═════════════════════════════════════════════════════${c.reset}`);
    console.log(`${c.bold}AutoClaude Session Complete${c.reset}`);
    console.log(`${c.dim}─────────────────────────────────────────────────────${c.reset}`);
    console.log(`${c.dim}Duration:${c.reset}     ${formatDuration(Date.now() - this.startTime)}`);
    console.log(`${c.dim}Permissions:${c.reset}  ${this.stats.permissionsHandled} auto-handled`);
    console.log(`${c.dim}Reinforcements:${c.reset} ${this.stats.reinforcements}`);
    console.log(`${c.dim}Status:${c.reset}       ${this.stats.completedSuccessfully ? `${c.green}✓ Completed${c.reset}` : `${c.yellow}${this.stats.exitReason}${c.reset}`}`);
    console.log(`${c.dim}═════════════════════════════════════════════════════${c.reset}`);

    // Show final output
    console.log('');
    log('info', 'Final Claude output:');
    console.log(`${c.dim}─────────────────────────────────────────────────────${c.reset}`);
    console.log(screenRead(this.claudeSession, 50));
    console.log(`${c.dim}─────────────────────────────────────────────────────${c.reset}`);

    // Ask if user wants to keep Claude running
    console.log('');
    log('info', `Claude session still running: ${this.claudeSession}`);
    log('info', `Attach with: screen -r ${this.claudeSession}`);

    return this.stats;
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(`${c.cyan}${c.bold}SpecMem AutoClaude${c.reset}`);
    console.log('');
    console.log(`${c.dim}Usage:${c.reset}`);
    console.log(`  specmem-autoclaude <project-path> <prompt> [duration]`);
    console.log('');
    console.log(`${c.dim}Arguments:${c.reset}`);
    console.log(`  project-path  Path to the project directory`);
    console.log(`  prompt        The task/prompt to give Claude`);
    console.log(`  duration      Max runtime in hour:minute format (default: 0:30)`);
    console.log('');
    console.log(`${c.dim}Examples:${c.reset}`);
    console.log(`  specmem-autoclaude /myproject "Fix all TypeScript errors" 1:00`);
    console.log(`  specmem-autoclaude . "Add unit tests for utils/" 0:45`);
    console.log(`  specmem-autoclaude /app "Refactor the auth system" 2:30`);
    console.log('');
    process.exit(1);
  }

  const projectPath = path.resolve(args[0]);
  const prompt = args[1];
  const duration = args[2] || '0:30';

  // Validate project path
  if (!fs.existsSync(projectPath)) {
    log('error', `Project path does not exist: ${projectPath}`);
    process.exit(1);
  }

  const durationMs = parseDuration(duration);

  // Check screen is installed
  try {
    execSync('which screen', { stdio: 'ignore' });
  } catch (e) {
    log('error', "'screen' is not installed");
    console.log(`${c.dim}Install with: sudo apt install screen${c.reset}`);
    process.exit(1);
  }

  // Run AutoClaude
  const controller = new AutoClaudeController(projectPath, prompt, durationMs);
  const stats = await controller.run();

  process.exit(stats.completedSuccessfully ? 0 : 1);
}

main().catch(err => {
  log('error', err.message);
  process.exit(1);
});
