#!/usr/bin/env node
/**
 * SPECMEM CLEANUP - Claude Screen Session Manager 🧹
 * ===================================================
 *
 * Manage and cleanup Claude screen sessions for a project.
 * Supports multiple Claude instances per project.
 *
 * Session naming:
 *   - claude-{projectId}       (single instance)
 *   - claude-{projectId}-1     (multi-instance)
 *   - claude-{projectId}-2
 *   - specmem-{projectId}      (brain console)
 *
 * Usage:
 *   specmem-cleanup                    List all screens for current project
 *   specmem-cleanup list               Same as above
 *   specmem-cleanup all                Stop ALL project screens (with progress save)
 *   specmem-cleanup <id>               Stop specific screen (by number or full name)
 *   specmem-cleanup --force <id>       Stop without saving progress
 *   specmem-cleanup --global           List ALL specmem/claude screens system-wide
 *
 * @author hardwicksoftwareservices
 * @website https://justcalljon.pro
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
  brightCyan: '\x1b[96m'
};

// ============================================================================
// UTILITIES
// ============================================================================

function getProjectId(projectPath) {
  const name = path.basename(projectPath);
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}

function log(level, message) {
  const colors = { info: c.cyan, success: c.green, warn: c.yellow, error: c.red };
  const icons = { info: '●', success: '✓', warn: '⚠', error: '✗' };
  console.log(`${colors[level]}${icons[level]}${c.reset} ${message}`);
}

/**
 * Get all screen sessions
 */
function getAllScreens() {
  try {
    const output = execSync('screen -ls 2>/dev/null || true', { encoding: 'utf8' });
    const screens = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // Match screen format: "12345.session-name (Detached)" or "(Attached)"
      const match = line.match(/^\s*(\d+)\.([^\s]+)\s+\(([^)]+)\)/);
      if (match) {
        screens.push({
          pid: match[1],
          name: match[2],
          fullName: `${match[1]}.${match[2]}`,
          status: match[3].toLowerCase()
        });
      }
    }

    return screens;
  } catch (e) {
    return [];
  }
}

/**
 * Get screens for a specific project
 */
function getProjectScreens(projectId) {
  const allScreens = getAllScreens();

  return allScreens.filter(s =>
    s.name.startsWith(`claude-${projectId}`) ||
    s.name.startsWith(`specmem-${projectId}`)
  );
}

/**
 * Read screen output
 */
function screenRead(sessionName, lines = 400) {
  try {
    const tmpFile = `/tmp/specmem-cleanup-${Date.now()}.txt`;
    execSync(`screen -S ${sessionName} -p 0 -X hardcopy ${tmpFile}`, { stdio: 'ignore' });
    const content = fs.readFileSync(tmpFile, 'utf8');
    fs.unlinkSync(tmpFile);
    return content;
  } catch (e) {
    return null;
  }
}

/**
 * Send text to screen
 */
function screenSend(sessionName, text) {
  try {
    execSync(`screen -S ${sessionName} -p 0 -X stuff "${text.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
    execSync(`screen -S ${sessionName} -p 0 -X stuff "$(printf '\\x0d')"`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Kill a screen session
 */
function screenKill(sessionName) {
  try {
    execSync(`screen -S ${sessionName} -X quit 2>/dev/null`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Save progress for a Claude screen
 */
function saveProgress(projectPath, screenName, reason = 'cleanup') {
  const trackingDir = path.join(projectPath, 'claudeProgressTracking');

  // Create tracking directory
  if (!fs.existsSync(trackingDir)) {
    fs.mkdirSync(trackingDir, { recursive: true });
  }

  // Generate filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const safeName = screenName.replace(/[^a-zA-Z0-9_-]/g, '-');
  const filename = `${safeName}-${timestamp}-${reason}.txt`;
  const filepath = path.join(trackingDir, filename);

  // Try to ask Claude to summarize
  log('info', `Asking ${screenName} to save progress...`);
  screenSend(screenName, '\n\n[SAVE PROGRESS] Please briefly summarize what you accomplished and any pending tasks.');

  // Wait a moment
  try { execSync('sleep 2'); } catch (e) {}

  // Read screen output
  const output = screenRead(screenName, 400);

  if (!output) {
    log('warn', `No output from ${screenName}`);
    return null;
  }

  // Write file
  const content = `# Claude Session Progress
# ========================
# Project: ${projectPath}
# Session: ${screenName}
# Saved: ${new Date().toISOString()}
# Reason: ${reason}
#
# Last 400 lines of screen output:
# ================================

${output}

# ================================
# End of session capture
`;

  fs.writeFileSync(filepath, content, 'utf8');
  log('success', `Saved: ${filename}`);

  return filepath;
}

/**
 * Stop a screen with optional progress save
 */
function stopScreen(projectPath, screen, saveFirst = true) {
  const isClaudeScreen = screen.name.startsWith('claude-');

  // Save progress for Claude screens
  if (saveFirst && isClaudeScreen) {
    saveProgress(projectPath, screen.name, 'cleanup');
  }

  // Kill the screen
  if (screenKill(screen.name)) {
    log('success', `Stopped: ${screen.name}`);
    return true;
  } else {
    log('error', `Failed to stop: ${screen.name}`);
    return false;
  }
}

/**
 * Print screen list
 */
function printScreenList(screens, projectId) {
  if (screens.length === 0) {
    console.log(`${c.dim}No active screens for project: ${projectId}${c.reset}`);
    return;
  }

  console.log('');
  console.log(`${c.cyan}${c.bold}Active Screens for ${projectId}${c.reset}`);
  console.log(`${c.dim}─────────────────────────────────────────────────${c.reset}`);

  let idx = 1;
  for (const screen of screens) {
    const type = screen.name.startsWith('specmem-') ? '🧠 Brain' : '🤖 Claude';
    const statusColor = screen.status === 'attached' ? c.green : c.yellow;
    const statusIcon = screen.status === 'attached' ? '●' : '○';

    console.log(`  ${c.bold}${idx}.${c.reset} ${type}  ${c.white}${screen.name}${c.reset}`);
    console.log(`     ${c.dim}PID: ${screen.pid}  Status: ${statusColor}${statusIcon} ${screen.status}${c.reset}`);
    idx++;
  }

  console.log('');
  console.log(`${c.dim}Commands:${c.reset}`);
  console.log(`  ${c.cyan}specmem-cleanup <number>${c.reset}  Stop specific screen (saves progress)`);
  console.log(`  ${c.cyan}specmem-cleanup all${c.reset}       Stop all screens (saves progress)`);
  console.log(`  ${c.cyan}specmem-cleanup --force <number>${c.reset}  Stop without saving`);
  console.log('');
}

/**
 * Print all screens (global view)
 */
function printGlobalScreens() {
  const allScreens = getAllScreens();

  const specmemScreens = allScreens.filter(s =>
    s.name.startsWith('claude-') || s.name.startsWith('specmem-')
  );

  if (specmemScreens.length === 0) {
    console.log(`${c.dim}No SpecMem/Claude screens found system-wide${c.reset}`);
    return;
  }

  console.log('');
  console.log(`${c.cyan}${c.bold}All SpecMem/Claude Screens (System-Wide)${c.reset}`);
  console.log(`${c.dim}─────────────────────────────────────────────────${c.reset}`);

  // Group by project
  const byProject = {};
  for (const screen of specmemScreens) {
    // Extract project ID from screen name
    let projectId = 'unknown';
    if (screen.name.startsWith('claude-')) {
      projectId = screen.name.replace('claude-', '').replace(/-\d+$/, '');
    } else if (screen.name.startsWith('specmem-')) {
      projectId = screen.name.replace('specmem-', '');
    }

    if (!byProject[projectId]) byProject[projectId] = [];
    byProject[projectId].push(screen);
  }

  for (const [projectId, screens] of Object.entries(byProject)) {
    console.log(`\n  ${c.bold}Project: ${projectId}${c.reset}`);
    for (const screen of screens) {
      const type = screen.name.startsWith('specmem-') ? '🧠' : '🤖';
      const statusColor = screen.status === 'attached' ? c.green : c.yellow;
      console.log(`    ${type} ${c.white}${screen.name}${c.reset} ${statusColor}(${screen.status})${c.reset}`);
    }
  }

  console.log('');
}

// ============================================================================
// MAIN
// ============================================================================

function main() {
  const args = process.argv.slice(2);
  const projectPath = process.cwd();
  const projectId = getProjectId(projectPath);

  // Parse flags
  const forceMode = args.includes('--force') || args.includes('-f');
  const globalMode = args.includes('--global') || args.includes('-g');
  const filteredArgs = args.filter(a => !a.startsWith('-'));
  const cmd = filteredArgs[0]?.toLowerCase();

  // Check screen is installed
  try {
    execSync('which screen', { stdio: 'ignore' });
  } catch (e) {
    log('error', "'screen' is not installed");
    console.log(`${c.dim}Install with: sudo apt install screen${c.reset}`);
    process.exit(1);
  }

  // Handle --help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${c.cyan}${c.bold}SPECMEM CLEANUP${c.reset} - Claude Screen Session Manager

${c.dim}Usage:${c.reset}
  specmem-cleanup                    List project screens
  specmem-cleanup list               Same as above
  specmem-cleanup all                Stop ALL project screens (saves progress)
  specmem-cleanup <number>           Stop screen by list number
  specmem-cleanup <name>             Stop screen by name
  specmem-cleanup --force <id>       Stop without saving progress
  specmem-cleanup --global           Show all screens system-wide

${c.dim}Options:${c.reset}
  --force, -f     Don't save progress before stopping
  --global, -g    Show screens for all projects
  --help, -h      Show this help

${c.dim}Examples:${c.reset}
  specmem-cleanup                    # List screens for current project
  specmem-cleanup 1                  # Stop screen #1 (saves progress)
  specmem-cleanup all                # Stop all (saves progress)
  specmem-cleanup --force all        # Stop all without saving
  specmem-cleanup claude-myproj-2    # Stop by name
  specmem-cleanup --global           # See all projects

${c.dim}Progress Tracking:${c.reset}
  When stopping Claude screens, the last 400 lines of output are saved to:
  ./claudeProgressTracking/claude-session-TIMESTAMP-cleanup.txt
`);
    process.exit(0);
  }

  // Handle --global
  if (globalMode) {
    printGlobalScreens();
    process.exit(0);
  }

  // Get project screens
  const screens = getProjectScreens(projectId);

  // No command = list
  if (!cmd || cmd === 'list' || cmd === 'ls') {
    printScreenList(screens, projectId);
    process.exit(0);
  }

  // Handle 'all'
  if (cmd === 'all') {
    if (screens.length === 0) {
      log('info', 'No screens to clean up');
      process.exit(0);
    }

    console.log(`${c.yellow}Stopping ${screens.length} screen(s)...${c.reset}`);
    let stopped = 0;

    for (const screen of screens) {
      if (stopScreen(projectPath, screen, !forceMode)) {
        stopped++;
      }
    }

    log('success', `Cleaned up ${stopped}/${screens.length} screens`);
    process.exit(0);
  }

  // Handle number or name
  let targetScreen = null;

  // Try as number first
  const num = parseInt(cmd);
  if (!isNaN(num) && num >= 1 && num <= screens.length) {
    targetScreen = screens[num - 1];
  } else {
    // Try as name (partial match)
    targetScreen = screens.find(s =>
      s.name === cmd ||
      s.name.includes(cmd) ||
      s.fullName === cmd
    );
  }

  if (!targetScreen) {
    log('error', `Screen not found: ${cmd}`);
    console.log(`${c.dim}Use 'specmem-cleanup list' to see available screens${c.reset}`);
    process.exit(1);
  }

  // Stop the screen
  stopScreen(projectPath, targetScreen, !forceMode);
}

main();
