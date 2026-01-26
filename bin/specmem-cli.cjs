#!/usr/bin/env node
/**
 * SpecMem CLI - THE COMMAND CENTER
 * =================================
 *
 * Usage:
 *   specmem setup    - First-run setup (download + optimize models)
 *   specmem init     - Initialize SpecMem for current project
 *   specmem status   - Check SpecMem status
 *   specmem doctor   - Check system requirements
 *
 * Services auto-start when you run `claude` in an initialized project!
 *
 * @author hardwicksoftwareservices
 * @website https://justcalljon.pro
 */

const { execSync, spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// Generate per-project screen name hash (first 8 chars of SHA256)
function getProjectScreenName(projectPath) {
  const normalized = path.resolve(projectPath).toLowerCase().replace(/\\/g, '/');
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  const dirName = path.basename(projectPath).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'project';
  return `claude-${dirName}-${hash}`;
}

// ANSI colors
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';

const SPECMEM_GLOBAL = path.join(os.homedir(), '.specmem');
const SPECMEM_PKG = path.dirname(__dirname);
const MODELS_DIR = path.join(SPECMEM_PKG, 'models');
const OPTIMIZED_DIR = path.join(MODELS_DIR, 'optimized');

const args = process.argv.slice(2);
const command = args[0] || 'help';
const subArgs = args.slice(1);

// ASCII banner lines (raw, no colors)
const BANNER_LINES = [
  '  ███████╗██████╗ ███████╗ ██████╗███╗   ███╗███████╗███╗   ███╗',
  '  ██╔════╝██╔══██╗██╔════╝██╔════╝████╗ ████║██╔════╝████╗ ████║',
  '  ███████╗██████╔╝█████╗  ██║     ██╔████╔██║█████╗  ██╔████╔██║',
  '  ╚════██║██╔═══╝ ██╔══╝  ██║     ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║',
  '  ███████║██║     ███████╗╚██████╗██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║',
  '  ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝',
];

// Letter column ranges: [start, end] (0-indexed)
// S=0-7, P=8-16, E=17-25, C=26-33, M=34-45, E=46-53, M=54-65
const LETTER_RANGES = [
  [2, 9],   // S
  [10, 17], // P
  [18, 26], // E
  [27, 34], // C
  [35, 46], // M (first)
  [47, 54], // E
  [55, 66], // M (second)
];

// ANSI cursor control
const CURSOR_UP = (n) => `\x1b[${n}A`;
const CURSOR_DOWN = (n) => `\x1b[${n}B`;
const CLEAR_LINE = '\x1b[2K';
const CURSOR_START = '\r';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const BRIGHT_RED = '\x1b[91m';
const GREY = '\x1b[90m';

// Get terminal width for dynamic sizing
function getTermWidth() {
  return process.stdout.columns || 80;
}

// Colorize a single line with specific letter highlighted
function colorizeLine(line, highlightIdx, fadeIdx) {
  let result = '';
  const chars = [...line]; // Handle unicode properly

  for (let i = 0; i < chars.length; i++) {
    let color = GREY; // Default: grey

    // Check each letter range
    for (let letterIdx = 0; letterIdx < LETTER_RANGES.length; letterIdx++) {
      const [start, end] = LETTER_RANGES[letterIdx];
      if (i >= start && i < end) {
        if (letterIdx === highlightIdx) {
          color = BRIGHT_RED + BOLD; // Currently highlighting: bright red
        } else if (letterIdx < fadeIdx) {
          color = CYAN; // Already passed: cyan (the "lit up" state)
        }
        break;
      }
    }

    result += color + chars[i];
  }

  return result + RESET;
}

// Center text based on terminal width
function centerText(text, width) {
  const textLen = [...text.replace(/\x1b\[[0-9;]*m/g, '')].length; // Strip ANSI for length
  const termWidth = width || getTermWidth();
  const padding = Math.max(0, Math.floor((termWidth - textLen) / 2));
  return ' '.repeat(padding) + text;
}

// Animated banner with sliding red highlight - SIMPLE & ROBUST
async function showAnimatedBanner(skipAnimation = false) {
  const bannerHeight = BANNER_LINES.length;

  // Skip animation if requested or not a TTY
  if (skipAnimation || !process.stdout.isTTY) {
    showBanner();
    return;
  }

  const SAVE_CURSOR = '\x1b7';
  const RESTORE_CURSOR = '\x1b8';
  const FRAME_DELAY = 90;
  const LETTERS = 7;

  process.stdout.write(HIDE_CURSOR);
  console.log('');

  // Reserve space
  for (let i = 0; i < bannerHeight; i++) console.log('');

  // Go back to start
  process.stdout.write(`\x1b[${bannerHeight}A`);
  process.stdout.write(SAVE_CURSOR);

  try {
    for (let highlight = 0; highlight <= LETTERS; highlight++) {
      process.stdout.write(RESTORE_CURSOR);

      for (let i = 0; i < bannerHeight; i++) {
        const line = colorizeLine(BANNER_LINES[i], highlight, highlight);
        process.stdout.write('\r' + CLEAR_LINE + line + '\n');
      }

      if (highlight < LETTERS) {
        await new Promise(r => setTimeout(r, FRAME_DELAY));
      }
    }

    // Final solid cyan
    process.stdout.write(RESTORE_CURSOR);
    for (const line of BANNER_LINES) {
      process.stdout.write('\r' + CLEAR_LINE + CYAN + BOLD + line + RESET + '\n');
    }
  } catch (e) {
    // Fallback
  } finally {
    process.stdout.write(SHOW_CURSOR);
  }

  console.log(`${DIM}  Developed by Hardwick Software Services | https://justcalljon.pro${RESET}\n`);
}

// Static banner (fallback)
function showBanner() {
  console.log(`
${CYAN}${BOLD}  ███████╗██████╗ ███████╗ ██████╗███╗   ███╗███████╗███╗   ███╗
  ██╔════╝██╔══██╗██╔════╝██╔════╝████╗ ████║██╔════╝████╗ ████║
  ███████╗██████╔╝█████╗  ██║     ██╔████╔██║█████╗  ██╔████╔██║
  ╚════██║██╔═══╝ ██╔══╝  ██║     ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║
  ███████║██║     ███████╗╚██████╗██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║
  ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝${RESET}
${DIM}  Developed by Hardwick Software Services | https://justcalljon.pro${RESET}
`);
}

// Check if models are optimized
function modelsReady() {
  const manifestPath = path.join(OPTIMIZED_DIR, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      return manifest.version && manifest.benchmark;
    } catch (e) {
      return false;
    }
  }
  return false;
}

// Get version from package.json
const SPECMEM_VERSION = require(path.join(SPECMEM_PKG, 'package.json')).version;

// Main command router
switch (command) {
  case 'init':
    // Check for updates first, then run init
    runWithUpdateCheck(() => runFancyInit());
    break;
  case 'setup':
    // Check for updates first, then run setup
    runWithUpdateCheck(() => runFirstRunSetup());
    break;
  case 'update':
    runUpdate();
    break;
  case 'cleanup':
    // Forward to specmem-cleanup
    runCleanup();
    break;
  case 'dashboard':
  case 'dash':
    launchDashboard();
    break;
  case 'start':
    startServices();
    break;
  case 'status':
    showStatus();
    break;
  case 'doctor':
    runDoctor();
    break;
  case '--version':
  case '-v':
  case 'version':
    showVersion();
    break;
  case 'help':
  case '--help':
  case '-h':
  default:
    showHelp();
}

// Launch dashboard (specmem-console)
function launchDashboard() {
  const consoleScript = path.join(SPECMEM_PKG, 'bin', 'specmem-console.cjs');
  if (!fs.existsSync(consoleScript)) {
    console.log(`${RED}Dashboard not found: ${consoleScript}${RESET}`);
    process.exit(1);
  }
  const projectPath = process.cwd();
  const child = spawn('node', [consoleScript, projectPath], {
    stdio: 'inherit',
    cwd: projectPath,
    env: { ...process.env, SPECMEM_PROJECT_PATH: projectPath }
  });
  child.on('close', (code) => {
    process.exit(code || 0);
  });
}

// Show version
function showVersion() {
  console.log(`${CYAN}SpecMem${RESET} v${SPECMEM_VERSION}`);
  console.log(`${DIM}Hardwick Software Services - https://justcalljon.pro${RESET}`);
}

// Run update check
async function runUpdate() {
  const updater = require(path.join(SPECMEM_PKG, 'scripts', 'auto-updater.cjs'));
  await updater.checkForUpdates();
}

// Run command with update check first
async function runWithUpdateCheck(callback) {
  try {
    const updater = require(path.join(SPECMEM_PKG, 'scripts', 'auto-updater.cjs'));
    const updated = await updater.checkForUpdates();
    if (updated) {
      // User updated, they need to re-run the command
      process.exit(0);
    }
  } catch (e) {
    // Updater failed, continue anyway
  }
  callback();
}

// Run first-run model setup
function runFirstRunSetup() {
  showBanner();
  console.log(`${MAGENTA}${BOLD}═══ First-Run Model Setup ═══${RESET}\n`);

  const setupScript = path.join(SPECMEM_PKG, 'scripts', 'first-run-model-setup.cjs');

  if (!fs.existsSync(setupScript)) {
    console.log(`${RED}Setup script not found: ${setupScript}${RESET}`);
    process.exit(1);
  }

  const child = spawn('node', [setupScript], {
    stdio: 'inherit',
    env: { ...process.env }
  });

  child.on('close', (code) => {
    process.exit(code);
  });
}

// Run fancy init script (with loading bars)
function runFancyInit() {
  const initScript = path.join(SPECMEM_PKG, 'scripts', 'specmem-init.cjs');

  if (!fs.existsSync(initScript)) {
    console.log(`${RED}Init script not found: ${initScript}${RESET}`);
    console.log(`${DIM}Falling back to legacy init...${RESET}`);
    initProject();
    return;
  }

  // Pass through any args (like --console)
  const args = process.argv.slice(3); // Skip node, script, 'init'
  const child = spawn('node', [initScript, '--no-screen-check', ...args], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env, SPECMEM_CLI_PARENT: '1' }
  });

  child.on('close', (code) => {
    process.exit(code);
  });
}

// Run cleanup script
function runCleanup() {
  const cleanupScript = path.join(SPECMEM_PKG, 'bin', 'specmem-cleanup.cjs');

  if (!fs.existsSync(cleanupScript)) {
    console.log(`${RED}Cleanup script not found: ${cleanupScript}${RESET}`);
    process.exit(1);
  }

  // Pass through any args
  const args = process.argv.slice(3);
  const child = spawn('node', [cleanupScript, ...args], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env }
  });

  child.on('close', (code) => {
    process.exit(code);
  });
}

// Initialize project (legacy - kept for fallback)
function initProject() {
  const projectDir = process.cwd();
  const specmemDir = path.join(projectDir, '.specmem');
  const specmemDirAlt = path.join(projectDir, 'specmem'); // Some setups use this

  showBanner();
  console.log(`${CYAN}Initializing SpecMem for:${RESET} ${projectDir}\n`);

  // Check if models are ready
  if (!modelsReady()) {
    console.log(`${YELLOW}⚠ Models not optimized yet!${RESET}`);
    console.log(`${DIM}Run 'specmem setup' first for best performance.${RESET}\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WIPE EXISTING LOCAL SPECMEM DATA FOR CLEAN REINSTALL
  // Cleans: docker containers, sockets, hooks, local data directories
  // EXCLUDES: The actual /specmem source directory (package install location)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`${MAGENTA}${BOLD}═══ Cleaning Existing SpecMem Data ═══${RESET}\n`);

  // Safety check: Don't wipe if we're inside the specmem package source itself
  const isSpecmemSource = fs.existsSync(path.join(projectDir, 'package.json')) &&
    (() => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf-8'));
        return pkg.name === 'specmem-hardwicksoftware';
      } catch { return false; }
    })();

  if (isSpecmemSource) {
    console.log(`${YELLOW}⚠${RESET} Running inside SpecMem source directory - skipping aggressive cleanup`);
    console.log(`${DIM}  Only cleaning runtime data, not source files${RESET}\n`);
  }

  // 1. KILL DOCKER CONTAINERS with specmem labels
  console.log(`${CYAN}→${RESET} Stopping specmem Docker containers...`);
  try {
    execSync(`docker ps -q --filter "label=specmem" 2>/dev/null | xargs -r docker stop 2>/dev/null || true`, { stdio: 'pipe' });
    execSync(`docker ps -aq --filter "label=specmem" 2>/dev/null | xargs -r docker rm -f 2>/dev/null || true`, { stdio: 'pipe' });
    // Also kill embedding containers for this project
    const projectHash = crypto.createHash('sha256').update(projectDir).digest('hex').slice(0, 12);
    execSync(`docker ps -aq --filter "name=specmem-embed" 2>/dev/null | xargs -r docker stop 2>/dev/null || true`, { stdio: 'pipe' });
    console.log(`${GREEN}✓${RESET} Docker containers cleaned`);
  } catch (e) {
    console.log(`${DIM}  No docker containers to clean${RESET}`);
  }

  // 2. REMOVE SOCKET FILES
  console.log(`${CYAN}→${RESET} Removing socket files...`);
  const socketLocations = [
    path.join(projectDir, 'specmem', 'sockets'),
    path.join(projectDir, '.specmem', 'sockets'),
    `/tmp/specmem-${path.basename(projectDir)}`,
  ];
  for (const sockDir of socketLocations) {
    if (fs.existsSync(sockDir)) {
      try {
        fs.rmSync(sockDir, { recursive: true, force: true });
      } catch {}
    }
  }
  // Also clean user-level embedding socket
  try {
    const uid = process.getuid ? process.getuid() : 'default';
    fs.unlinkSync(`/tmp/specmem-embed-${uid}.sock`);
  } catch {}
  console.log(`${GREEN}✓${RESET} Socket files cleaned`);

  // 3. CLEAN LOCAL DATA DIRECTORIES (but NOT specmem source!)
  console.log(`${CYAN}→${RESET} Removing local specmem data...`);
  const dirsToClean = [specmemDir]; // .specmem/

  // Only clean specmem/ if it's NOT the source package
  if (!isSpecmemSource && fs.existsSync(specmemDirAlt)) {
    // Check if it looks like runtime data vs source code
    const hasPackageJson = fs.existsSync(path.join(specmemDirAlt, 'package.json'));
    if (!hasPackageJson) {
      dirsToClean.push(specmemDirAlt);
    }
  }

  for (const dir of dirsToClean) {
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`${GREEN}✓${RESET} Removed ${path.basename(dir)}/`);
      } catch (e) {
        console.log(`${YELLOW}⚠${RESET} Could not fully remove ${dir}: ${e.message}`);
      }
    }
  }

  // 4. KILL STALE SCREEN SESSIONS for this project ONLY
  console.log(`${CYAN}→${RESET} Cleaning screen sessions...`);
  const screenName = getProjectScreenName(projectDir);
  // Extract hash from screenName (format: claude-{name}-{hash8})
  const projectHash = screenName.split('-').pop();
  try {
    // CRITICAL: Only kill THIS project's screen sessions, not all claude- sessions
    // This prevents accidentally killing agents from other projects
    execSync(`screen -ls 2>/dev/null | grep -E "${screenName}" | cut -d. -f1 | awk '{print $1}' | xargs -r -I{} screen -S {} -X quit 2>/dev/null || true`, { stdio: 'pipe' });
    // Also clean up specmem-prefixed sessions for this project
    execSync(`screen -ls 2>/dev/null | grep -E "specmem-${projectHash}" | cut -d. -f1 | awk '{print $1}' | xargs -r -I{} screen -S {} -X quit 2>/dev/null || true`, { stdio: 'pipe' });
    execSync(`screen -wipe 2>/dev/null || true`, { stdio: 'pipe' });
    console.log(`${GREEN}✓${RESET} Screen sessions cleaned (project: ${projectHash})`);
  } catch {
    console.log(`${DIM}  No screen sessions to clean${RESET}`);
  }

  // 5. REMOVE SPECMEM ENTRIES FROM CLAUDE PROJECT CONFIG
  console.log(`${CYAN}→${RESET} Cleaning  project config...`);
  try {
    const claudeProjectDir = path.join(os.homedir(), '.claude', 'projects');
    if (fs.existsSync(claudeProjectDir)) {
      // Find and remove project-specific specmem config
      const projectSafe = projectDir.replace(/\//g, '-').replace(/^-/, '');
      const configPath = path.join(claudeProjectDir, projectSafe, 'specmem.json');
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    }
    console.log(`${GREEN}✓${RESET}  config cleaned`);
  } catch {
    console.log(`${DIM}  No  config to clean${RESET}`);
  }

  console.log(`\n${GREEN}${BOLD}✓ Cleanup complete!${RESET}\n`);

  // Create fresh project .specmem directory
  fs.mkdirSync(specmemDir, { recursive: true });
  console.log(`${GREEN}✓${RESET} Created fresh .specmem directory`);

  // Copy env template
  const envSrc = path.join(SPECMEM_PKG, 'specmem.env');
  const envDest = path.join(projectDir, '.env');

  if (fs.existsSync(envSrc) && !fs.existsSync(envDest)) {
    fs.copyFileSync(envSrc, envDest);
    console.log(`${GREEN}✓${RESET} Created .env from template`);
  } else if (fs.existsSync(envDest)) {
    console.log(`${DIM}  .env already exists${RESET}`);
  }

  // Create project-specific directories
  const dirs = ['sockets', 'logs', 'data'];
  for (const dir of dirs) {
    const dirPath = path.join(specmemDir, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
  console.log(`${GREEN}✓${RESET} Created project directories`);

  // AUTO-DEPLOY HOOKS TO CLAUDE
  console.log(`\n${MAGENTA}${BOLD}═══ Auto-Deploying Hooks ═══${RESET}\n`);
  const deployScript = path.join(SPECMEM_PKG, 'scripts', 'deploy-hooks.cjs');

  if (fs.existsSync(deployScript)) {
    try {
      execSync(`node "${deployScript}"`, {
        stdio: 'inherit',
        env: { ...process.env, SPECMEM_HOME: SPECMEM_GLOBAL }
      });
    } catch (e) {
      console.log(`${YELLOW}⚠${RESET} Hook deployment had warnings (non-fatal)`);
    }
  } else {
    // Fallback: basic hook setup
    const claudeDir = path.join(os.homedir(), '.claude');
    const claudeSettings = path.join(claudeDir, 'settings.json');

    if (fs.existsSync(claudeSettings)) {
      console.log(`${GREEN}✓${RESET}  Code detected - configure hooks manually`);
    } else {
      console.log(`${YELLOW}⚠${RESET}  Code not found`);
      console.log(`${DIM}  Install: npm install -g @anthropic-ai/claude-code${RESET}`);
    }
  }

  console.log(`
${GREEN}${BOLD}✓ Project initialized!${RESET}

${CYAN}What's configured:${RESET}
  • ${BOLD}MCP Server${RESET} - specmem auto-starts with  Code
  • ${BOLD}Hooks${RESET} - Context injection before prompts
  • ${BOLD}Commands${RESET} - /specmem-* slash commands available
`);

  // Launch  in screen session
  console.log(`${CYAN}${BOLD}═══ Launching  Code ═══${RESET}\n`);

  try {
    // Check if screen is available
    try {
      execSync('which screen', { stdio: 'pipe' });
    } catch {
      console.log(`${YELLOW}⚠${RESET} screen not installed, installing...`);
      try {
        execSync('apt-get install -y screen 2>/dev/null || sudo apt-get install -y screen 2>/dev/null', { stdio: 'pipe', timeout: 60000 });
      } catch {
        console.log(`${YELLOW}⚠${RESET} Could not install screen, launching  directly...`);
        console.log(`${DIM}Run: claude${RESET}\n`);
        // Launch  directly without screen
        const child = spawn('claude', [], {
          cwd: projectDir,
          stdio: 'inherit',
          env: { ...process.env, SPECMEM_PROJECT_PATH: projectDir }
        });
        return;
      }
    }

    // Use per-project screen name to avoid collisions
    // Format: claude-{projectName}-{hash8}
    const screenName = getProjectScreenName(projectDir);

    console.log(`${GREEN}✓${RESET} Screen session: ${CYAN}${screenName}${RESET}`);
    console.log(`${DIM}  Detach later with: Ctrl+A, D${RESET}`);
    console.log(`${DIM}  Reattach with: screen -r ${screenName}${RESET}\n`);

    // Kill existing screen session for THIS project if it exists
    try {
      execSync(`screen -S ${screenName} -X quit 2>/dev/null`, { stdio: 'pipe' });
    } catch {}

    // Give screen time to clean up
    execSync('sleep 0.5', { stdio: 'pipe' });

    // Launch  in a new screen session AND auto-attach
    console.log(`${GREEN}${BOLD}✓ Launching  Code...${RESET}\n`);
    console.log(`${DIM}───────────────────────────────────────────────${RESET}`);

    // Use -S to create named session, no -d so it attaches immediately
    const result = spawnSync('screen', ['-S', screenName, 'claude'], {
      cwd: projectDir,
      stdio: 'inherit',
      env: { ...process.env, SPECMEM_PROJECT_PATH: projectDir }
    });

    // User has detached or  exited
    console.log(`\n${DIM}───────────────────────────────────────────────${RESET}`);

    // Check if session still exists (user detached vs  exited)
    try {
      execSync(`screen -list | grep "${screenName}"`, { stdio: 'pipe' });
      console.log(`${GREEN}✓${RESET} Session '${screenName}' still running in background`);
      console.log(`${CYAN}To reattach:${RESET} screen -r ${screenName}\n`);
    } catch {
      console.log(`${DIM}Session ended. Run 'specmem init' to start again.${RESET}\n`);
    }

  } catch (err) {
    console.log(`${YELLOW}⚠${RESET} Could not launch  automatically: ${err.message}`);
    console.log(`${DIM}Run manually: claude${RESET}`);
  }
}

// Start services
function startServices() {
  showBanner();

  console.log(`${GREEN}${BOLD}SpecMem services auto-start with !${RESET}\n`);
  console.log(`Once your project is initialized, just run:\n`);
  console.log(`  ${DIM}$${RESET} claude\n`);
  console.log(`SpecMem's MCP server starts automatically when  opens.\n`);

  // Check if project is initialized
  const settingsPath = path.join(process.cwd(), '.claude', 'settings.local.json');
  if (fs.existsSync(settingsPath)) {
    console.log(`${GREEN}✓${RESET} This project is initialized. Just run ${CYAN}claude${RESET}!\n`);
  } else {
    console.log(`${YELLOW}⚠${RESET} This project isn't initialized yet. Run:\n`);
    console.log(`  ${DIM}$${RESET} specmem init\n`);
  }

  // Check if models need setup
  if (!modelsReady()) {
    console.log(`${YELLOW}⚠${RESET} Models not optimized. Run:\n`);
    console.log(`  ${DIM}$${RESET} specmem setup\n`);
  }
}

// Show status
function showStatus() {
  showBanner();
  console.log(`${CYAN}═══ SpecMem Status ═══${RESET}\n`);

  // Check models
  if (modelsReady()) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(OPTIMIZED_DIR, 'manifest.json'), 'utf-8'));
      console.log(`${GREEN}✓${RESET} Models optimized`);
      console.log(`  ${DIM}Speedup: ${manifest.benchmark.speedup}x${RESET}`);
      console.log(`  ${DIM}Latency: ${manifest.benchmark.quantized_ms}ms/embedding${RESET}`);
    } catch (e) {
      console.log(`${GREEN}✓${RESET} Models ready`);
    }
  } else {
    console.log(`${RED}✗${RESET} Models not optimized - run 'specmem setup'`);
  }

  // Run health check if available
  const healthCheck = path.join(SPECMEM_PKG, 'specmem-health.cjs');

  if (fs.existsSync(healthCheck)) {
    console.log('');
    try {
      execSync(`node "${healthCheck}"`, { stdio: 'inherit' });
    } catch (e) {
      // Health check handles its own errors
    }
  }
}

// Run doctor check
function runDoctor() {
  showBanner();
  console.log(`${CYAN}${BOLD}═══ System Requirements Check ═══${RESET}\n`);

  let allGood = true;

  // Check Node.js
  try {
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.slice(1).split('.')[0]);
    if (major >= 18) {
      console.log(`${GREEN}✓${RESET} Node.js ${nodeVersion} (>= 18 required)`);
    } else {
      console.log(`${RED}✗${RESET} Node.js ${nodeVersion} (>= 18 required)`);
      allGood = false;
    }
  } catch (e) {
    console.log(`${RED}✗${RESET} Node.js check failed`);
    allGood = false;
  }

  // Check Python
  try {
    const pyVersion = execSync('python3 --version 2>/dev/null || python --version 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000
    }).trim();
    if (pyVersion.includes('Python 3')) {
      console.log(`${GREEN}✓${RESET} ${pyVersion}`);
    } else {
      console.log(`${RED}✗${RESET} Python 3 required (found ${pyVersion})`);
      allGood = false;
    }
  } catch (e) {
    console.log(`${RED}✗${RESET} Python 3 not found`);
    allGood = false;
  }

  // Check Docker
  try {
    const dockerVersion = execSync('docker --version 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000
    }).trim();
    console.log(`${GREEN}✓${RESET} ${dockerVersion}`);
  } catch (e) {
    console.log(`${YELLOW}⚠${RESET} Docker not found (optional but recommended)`);
  }

  // Check PostgreSQL
  try {
    const pgVersion = execSync('psql --version 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000
    }).trim();
    console.log(`${GREEN}✓${RESET} ${pgVersion}`);
  } catch (e) {
    console.log(`${YELLOW}⚠${RESET} PostgreSQL not found (will use SQLite fallback)`);
  }

  // Check models
  console.log('');
  if (modelsReady()) {
    console.log(`${GREEN}✓${RESET} Embedding models optimized`);
  } else {
    console.log(`${YELLOW}⚠${RESET} Embedding models not optimized - run 'specmem setup'`);
  }

  // Check  Code
  const claudeDir = path.join(os.homedir(), '.claude');
  if (fs.existsSync(claudeDir)) {
    console.log(`${GREEN}✓${RESET}  Code detected`);
  } else {
    console.log(`${YELLOW}⚠${RESET}  Code not installed`);
  }

  // Summary
  console.log('');
  if (allGood) {
    console.log(`${GREEN}${BOLD}All required dependencies present!${RESET}`);
  } else {
    console.log(`${RED}${BOLD}Some required dependencies missing.${RESET}`);
    console.log(`${DIM}Run 'npm install -g specmem-hardwicksoftware' to auto-install.${RESET}`);
  }
}

// Show help
function showHelp() {
  showBanner();
  console.log(`${BOLD}Usage:${RESET} specmem <command>

${BOLD}Commands:${RESET}
  ${CYAN}setup${RESET}     First-run setup (download + optimize embedding models)
  ${CYAN}init${RESET}      Initialize SpecMem for current project
  ${CYAN}status${RESET}    Check SpecMem status and model info
  ${CYAN}dashboard${RESET}  Launch the AEGIS dashboard (alias: dash)
  ${CYAN}doctor${RESET}    Check system requirements

${BOLD}Quick Start:${RESET}
  ${DIM}$${RESET} specmem setup    ${DIM}# First time only - optimizes models${RESET}
  ${DIM}$${RESET} cd your-project
  ${DIM}$${RESET} specmem init     ${DIM}# Initialize project${RESET}
  ${DIM}$${RESET} claude           ${DIM}# Services auto-start with !${RESET}

${BOLD}What It Does:${RESET}
  SpecMem provides semantic memory for  Code sessions.
  It remembers what you've discussed, code you've written,
  and provides context to make  smarter over time.

${BOLD}Auto-Start:${RESET}
  Once initialized, SpecMem services start automatically when
  you open  in the project. No manual start needed!

${DIM}https://justcalljon.pro${RESET}
`);
}
