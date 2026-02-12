#!/usr/bin/env node
/**
 * SPECMEM INIT - INITIALIZED PRE PRODUCTION 🔥
 * ==================================
 *
 * Every run is a FLEX - scorched earth rebuild from scratch.
 * No "already optimized" bullshit. We wipe. We rebuild. We flex.
 *
 * 10 Stages:
 *   1. ANALYZE PROJECT     - Count files, LOC, determine tier
 *   2. SCORCHED EARTH      - Wipe existing configs
 *   3. MODEL OPTIMIZATION  - Generate fresh tier-optimized config
 *   4. EMBEDDING SETUP     - Configure/warm embedding server
 *   5. CODEBASE INDEXING   - Index codebase with embeddings for find_code_pointers
 *   6. TOKEN COMPRESSION   - Compress commands with Chinese encoding
 *   7. COMMAND DEPLOYMENT  - Deploy all slash commands
 *   8. SESSION EXTRACTION  - Extract  session history into memories
 *   9. FINAL VERIFICATION  - Verify everything is ready
 *  10. SCREEN SESSIONS     - Launch brain &  (default, --no-console to skip)
 *
 * BULLETPROOF: Running init multiple times never breaks anything.
 * Existing sessions are detected and reused. No duplicates.
 *
 * @author hardwicksoftwareservices
 * @website https://justcalljon.pro
 */

// ============================================================================
// IMMEDIATE TERMINAL CLEAR - First thing, before ANY output
// ============================================================================
process.stdout.write('\x1b[2J\x1b[H\x1b[3J'); // Clear screen + scrollback + home cursor

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

/**
 * Get the Python executable path for spawning Python processes (Task #22 fix)
 * Priority: SPECMEM_PYTHON_PATH > PYTHON_PATH > VIRTUAL_ENV/bin/python > python3
 */
function getPythonPath() {
  if (process.env['SPECMEM_PYTHON_PATH']) return process.env['SPECMEM_PYTHON_PATH'];
  if (process.env['PYTHON_PATH']) return process.env['PYTHON_PATH'];
  const virtualEnv = process.env['VIRTUAL_ENV'];
  if (virtualEnv) {
    const isWindows = process.platform === 'win32';
    return isWindows ? virtualEnv + '/Scripts/python.exe' : virtualEnv + '/bin/python';
  }
  return 'python3';
}

/**
 * Get the Claude binary path, preferring claudefix wrapper over raw binary.
 * Detects claudefix in common install locations and symlinks it into the
 * user's local bin so screen sessions (which resolve /root/.local/bin first)
 * route through claudefix instead of the raw Claude binary.
 *
 * If claudefix is NOT installed, auto-detects the raw Claude binary location
 * and returns its full absolute path so screen sessions don't depend on PATH order.
 */
function getClaudeBinary() {
  const claudefixCandidates = [
    '/usr/local/bin/claude-fixed',
    '/usr/lib/node_modules/claudefix/bin/claude-fixed.js',
    '/usr/local/lib/node_modules/claudefix/bin/claude-fixed.js',
    path.join(os.homedir(), '.npm-global/lib/node_modules/claudefix/bin/claude-fixed.js'),
    path.join(os.homedir(), 'node_modules/claudefix/bin/claude-fixed.js'),
  ];

  // Auto-detect raw Claude binary location (used for backup + fallback)
  function findRawClaude() {
    const rawCandidates = [
      path.join(os.homedir(), '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/usr/bin/claude',
    ];
    // Check Claude versions directory (managed installs)
    const versionsDir = path.join(os.homedir(), '.local', 'share', 'claude', 'versions');
    try {
      if (fs.existsSync(versionsDir)) {
        const versions = fs.readdirSync(versionsDir)
          .filter(v => /^\d+\.\d+\.\d+$/.test(v))
          .sort((a, b) => {
            const [aMaj, aMin, aPat] = a.split('.').map(Number);
            const [bMaj, bMin, bPat] = b.split('.').map(Number);
            return bMaj - aMaj || bMin - aMin || bPat - aPat;
          });
        if (versions.length) return path.join(versionsDir, versions[0]);
      }
    } catch {}
    for (const candidate of rawCandidates) {
      try {
        if (!fs.existsSync(candidate)) continue;
        // Resolve symlinks and check it's an actual binary, not a claudefix wrapper
        const resolved = fs.realpathSync(candidate);
        if (resolved.includes('claudefix')) continue;
        // Read first bytes to make sure it's not the wrapper script
        const head = fs.readFileSync(candidate, 'utf8').slice(0, 500);
        if (head.includes('claudefix')) continue;
        return resolved;
      } catch {}
    }
    // Last resort: ask the shell
    try {
      return execSync('which claude 2>/dev/null', { encoding: 'utf8' }).trim();
    } catch {}

    // No Claude binary found anywhere — auto-install it
    initLog('[SETUP] Claude CLI not found — installing @anthropic-ai/claude-code');
    try {
      execSync('npm install -g @anthropic-ai/claude-code 2>&1', { stdio: 'pipe', timeout: 120000 });
      initLog('[SETUP] Claude CLI installed');
      // Re-check after install
      try {
        return execSync('which claude 2>/dev/null', { encoding: 'utf8' }).trim();
      } catch {}
      // Check common install locations
      const postInstallCandidates = [
        '/usr/local/bin/claude',
        path.join(os.homedir(), '.local', 'bin', 'claude'),
        '/usr/bin/claude',
      ];
      for (const c of postInstallCandidates) {
        if (fs.existsSync(c)) return c;
      }
    } catch (e) {
      initLog('[SETUP] Claude CLI install failed: ' + e.message);
    }

    return 'claude';
  }

  // Check for the claudefix wrapper script at /usr/local/bin/claude
  const wrapperPath = '/usr/local/bin/claude';
  let claudefixWrapper = null;
  try {
    if (fs.existsSync(wrapperPath)) {
      const content = fs.readFileSync(wrapperPath, 'utf8');
      if (content.includes('claudefix')) {
        claudefixWrapper = wrapperPath;
      }
    }
  } catch {}

  // Find a working claudefix binary
  let claudefixBin = claudefixWrapper;
  if (!claudefixBin) {
    for (const candidate of claudefixCandidates) {
      if (fs.existsSync(candidate)) {
        claudefixBin = candidate;
        break;
      }
    }
  }

  if (claudefixBin) {
    // Ensure the local bin claude symlink points to claudefix so screen sessions use it
    const localBin = path.join(os.homedir(), '.local', 'bin');
    const localClaude = path.join(localBin, 'claude');
    try {
      if (fs.existsSync(localClaude)) {
        const stat = fs.lstatSync(localClaude);
        if (stat.isSymbolicLink()) {
          const target = fs.readlinkSync(localClaude);
          // If it's pointing at a raw Claude binary (not claudefix), repoint it
          if (!target.includes('claudefix')) {
            // Back up original symlink target so claudefix can find the real binary
            const backupPath = path.join(localBin, 'claude-original');
            if (!fs.existsSync(backupPath)) {
              fs.symlinkSync(target, backupPath);
            }
            fs.unlinkSync(localClaude);
            fs.symlinkSync(claudefixBin, localClaude);
            initLog(`Relinked ${localClaude} -> ${claudefixBin} (was: ${target})`);
          }
        }
      }
    } catch (e) {
      initLog(`Could not relink local claude to claudefix: ${e.message}`, true);
    }
    return claudefixBin;
  }

  // No claudefix found - return the raw Claude binary's absolute path
  const rawBin = findRawClaude();
  initLog(`claudefix not found, using raw claude: ${rawBin}`);
  return rawBin;
}

/**
 * ROOT/NON-ROOT DETECTION - Dynamic paths based on user privileges
 * Root: uses /usr/lib/node_modules/specmem-hardwicksoftware/
 * Non-root: uses ~/.specmem/
 */
function isRootUser() {
  // Check UID on Unix systems
  if (process.getuid && process.getuid() === 0) return true;
  // Check EUID (effective UID)
  if (process.geteuid && process.geteuid() === 0) return true;
  // Fallback: check if we can write to /usr/lib
  try {
    fs.accessSync('/usr/lib', fs.constants.W_OK);
    return true;
  } catch (e) {
    return false;
  }
}

const IS_ROOT = isRootUser();
const USER_SPECMEM_DIR = IS_ROOT ? path.dirname(__dirname) : path.join(os.homedir(), '.specmem');

// yooo DRY PRINCIPLE - use shared codebase logic instead of reimplementing
// this bridges CJS (specmem-init.cjs) to ESM (dist/codebase/*)
let codebaseBridge = null;
async function getCodebaseBridge() {
  if (codebaseBridge) return codebaseBridge;
  try {
    codebaseBridge = require('../lib/codebase-bridge.cjs');
    return codebaseBridge;
  } catch (e) {
    // fallback - bridge not available, use inline logic
    return null;
  }
}

// ============================================================================
// SAFE MKDIR - Falls back to sudo if permission denied
// ============================================================================

/**
 * Create directory - dies with clear message if permission denied.
 * If specmem can't create dirs, it needs to be run with sudo.
 */
function safeMkdir(dirPath, opts = {}) {
  try {
    fs.mkdirSync(dirPath, { recursive: true, ...opts });
  } catch (e) {
    if (e.code === 'EACCES' || e.code === 'EPERM') {
      console.error('\n\x1b[31m\x1b[1m');
      console.error('  ╔═══════════════════════════════════════════════════╗');
      console.error('  ║  Hey, I need sudo!                               ║');
      console.error('  ║                                                   ║');
      console.error('  ║  SpecMem can\'t create directories without         ║');
      console.error('  ║  proper permissions. Run with sudo:               ║');
      console.error('  ║                                                   ║');
      console.error('  ║    sudo npx specmem-hardwicksoftware              ║');
      console.error('  ║                                                   ║');
      console.error(`  ║  Failed path: ${dirPath.slice(0, 35).padEnd(35)} ║`);
      console.error('  ╚═══════════════════════════════════════════════════╝');
      console.error('\x1b[0m');
      process.exit(1);
    }
    throw e;
  }
}

// ============================================================================
// INIT LOGGING - Persistent log file for debugging init issues
// ============================================================================

const _initProjectPath = process.cwd();
const _initLogDir = path.join(_initProjectPath, 'specmem', 'run');
const _initLogPath = path.join(_initLogDir, 'init-startup.log');

// Track if log has been initialized (cleared) this run
let _initLogCleared = false;

function initLog(msg, error) {
  const timestamp = new Date().toISOString();
  let logLine = `[${timestamp}] ${msg}`;
  if (error) {
    const stack = error.stack || error.message || String(error);
    logLine += `\n  ERROR: ${stack}`;
  }
  logLine += '\n';

  try {
    // Ensure log dir exists
    if (!fs.existsSync(_initLogDir)) {
      safeMkdir(_initLogDir);
    }

    // First write clears the file (fresh log each run), subsequent writes append
    if (!_initLogCleared) {
      fs.writeFileSync(_initLogPath, logLine);
      _initLogCleared = true;
    } else {
      fs.appendFileSync(_initLogPath, logLine);
    }
  } catch (e) {
    // Silent fail - don't break init just because logging failed
  }
}

initLog('=== SPECMEM-INIT STARTED ===');
initLog(`Project path: ${_initProjectPath}`);
initLog(`Node version: ${process.version}`);

// ============================================================================
// USER CONFIG - Persistent config that survives specmem-init (NOT wiped!)
// Location: {project}/specmem/user-config.json
// ============================================================================

const USER_CONFIG_PATH = path.join(_initProjectPath, 'specmem', 'user-config.json');

/**
 * Load user config if exists - this persists across init/updates!
 * Sets env vars for CPU/RAM limits from user's saved preferences.
 */
function loadUserConfig() {
  try {
    if (fs.existsSync(USER_CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf8'));
      initLog(`Loaded user-config.json: ${JSON.stringify(config)}`);

      // Apply resource limits to env if set in user config
      if (config.cpuMin != null) process.env.SPECMEM_CPU_MIN = String(config.cpuMin);
      if (config.cpuMax != null) process.env.SPECMEM_CPU_MAX = String(config.cpuMax);
      if (config.ramMinMb != null) process.env.SPECMEM_RAM_MIN_MB = String(config.ramMinMb);
      if (config.ramMaxMb != null) process.env.SPECMEM_RAM_MAX_MB = String(config.ramMaxMb);

      return config;
    }
  } catch (e) {
    initLog(`Failed to load user-config.json: ${e.message}`);
  }
  return null;
}

/**
 * Save user config - persists CPU/RAM limits across init/updates
 */
function saveUserConfig(config) {
  try {
    const dir = path.dirname(USER_CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      safeMkdir(dir);
    }
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(config, null, 2));
    initLog(`Saved user-config.json: ${JSON.stringify(config)}`);
    return true;
  } catch (e) {
    initLog(`Failed to save user-config.json: ${e.message}`);
    return false;
  }
}

// Load user config FIRST before anything else - preserves limits across updates
const _userConfig = loadUserConfig();
if (_userConfig) {
  initLog(`User config loaded - CPU: ${_userConfig.cpuMin || 'default'}-${_userConfig.cpuMax || 'default'}%, RAM: ${_userConfig.ramMinMb || 'default'}-${_userConfig.ramMaxMb || 'default'}MB`);
}

// Auto-save current env vars to user-config if they differ from defaults
// This captures limits set via env vars BEFORE specmem-init so they persist
(function autoSaveCustomLimits() {
  const DEFAULTS = { cpuMin: 20, cpuMax: 40, ramMinMb: 4000, ramMaxMb: 6000 };
  const current = {
    cpuMin: process.env.SPECMEM_CPU_MIN ? parseFloat(process.env.SPECMEM_CPU_MIN) : null,
    cpuMax: process.env.SPECMEM_CPU_MAX ? parseFloat(process.env.SPECMEM_CPU_MAX) : null,
    ramMinMb: process.env.SPECMEM_RAM_MIN_MB ? parseFloat(process.env.SPECMEM_RAM_MIN_MB) : null,
    ramMaxMb: process.env.SPECMEM_RAM_MAX_MB ? parseFloat(process.env.SPECMEM_RAM_MAX_MB) : null,
  };

  // Check if any are set and differ from defaults
  const hasCustom = (current.cpuMin != null && current.cpuMin !== DEFAULTS.cpuMin) ||
                    (current.cpuMax != null && current.cpuMax !== DEFAULTS.cpuMax) ||
                    (current.ramMinMb != null && current.ramMinMb !== DEFAULTS.ramMinMb) ||
                    (current.ramMaxMb != null && current.ramMaxMb !== DEFAULTS.ramMaxMb);

  if (hasCustom) {
    // Merge with existing user config
    const existing = _userConfig || {};
    const merged = {
      ...existing,
      ...(current.cpuMin != null ? { cpuMin: current.cpuMin } : {}),
      ...(current.cpuMax != null ? { cpuMax: current.cpuMax } : {}),
      ...(current.ramMinMb != null ? { ramMinMb: current.ramMinMb } : {}),
      ...(current.ramMaxMb != null ? { ramMaxMb: current.ramMaxMb } : {}),
    };
    saveUserConfig(merged);
    initLog(`Auto-saved custom limits to user-config.json`);
  }
})();

// ============================================================================
// RESOURCE LIMITS NOTICE - Show if CPU/RAM limits differ from defaults
// ============================================================================

/**
 * Get resource limits notice if limits differ from defaults
 * Shows user their configured CPU/RAM limits for transparency
 */
function getResourceLimitsNotice() {
  // Defaults from frankenstein-embeddings.py
  const DEFAULTS = { cpuMin: 20, cpuMax: 40, ramMinMb: 4000, ramMaxMb: 6000 };

  // Read current config from env (already set by loadUserConfig if user-config.json exists)
  const cpuMin = parseFloat(process.env.SPECMEM_CPU_MIN || DEFAULTS.cpuMin);
  const cpuMax = parseFloat(process.env.SPECMEM_CPU_MAX || DEFAULTS.cpuMax);
  const ramMinMb = parseFloat(process.env.SPECMEM_RAM_MIN_MB || DEFAULTS.ramMinMb);
  const ramMaxMb = parseFloat(process.env.SPECMEM_RAM_MAX_MB || DEFAULTS.ramMaxMb);

  // Check if any limits differ from defaults
  const isDifferent = cpuMin !== DEFAULTS.cpuMin || cpuMax !== DEFAULTS.cpuMax ||
                      ramMinMb !== DEFAULTS.ramMinMb || ramMaxMb !== DEFAULTS.ramMaxMb;

  if (!isDifferent) return null;

  // Convert MB to GB for display (cleaner)
  const ramMinGb = (ramMinMb / 1000).toFixed(1);
  const ramMaxGb = (ramMaxMb / 1000).toFixed(1);

  return `Running with modified usage limits: CPU: ${cpuMin}-${cpuMax}%  RAM: ${ramMinGb}-${ramMaxGb}GB`;
}

// ============================================================================
// CLI FLAG HANDLING - Always launch Brain unless --no-console specified
// ============================================================================

const args = process.argv.slice(2);
initLog(`Args: ${args.join(' ') || '(none)'}`);

// ============================================================================
// SCREEN DETECTION - If running inside a screen FOR THIS PROJECT, exit and restart
// CRITICAL: Only kill screens belonging to THIS project, not other projects!
// ============================================================================

function detectAndExitScreen() {
  // SAFETY: Never kill screen if running from  Code session
  // This prevents  from accidentally killing its own environment
  if (process.env.CLAUDE_CODE || process.env.CLAUDE_SESSION_ID || process.env.ANTHROPIC_API_KEY) {
    initLog('Running from  Code session - skipping screen detection');
    return; // NEVER kill when  is running us
  }

  // SAFETY: Skip if --no-screen-check flag is passed
  if (args.includes('--no-screen-check') || args.includes('--nsc')) {
    initLog('Screen check disabled via flag');
    return;
  }

  const sty = process.env.STY; // Screen session name
  const term = process.env.TERM || '';

  if (sty || term === 'screen' || term.startsWith('screen.')) {
    // We're inside a screen session - but is it OUR project's screen?
    const cwd = process.cwd();
    const projectId = path.basename(cwd).toLowerCase().replace(/[^a-z0-9]/g, '');

    // Check if this screen belongs to the current project
    // Our screens are named: specmem-{projectId}, claude-{projectId}
    // MUST match projectId specifically, not just prefix
    const screenName = sty ? sty.split('.').pop() : '';
    const isOurScreen = screenName === `specmem-${projectId}` ||
                        screenName === `claude-${projectId}` ||
                        screenName === projectId;

    // CRITICAL: Only kill if this is EXACTLY our project's screen
    // Don't kill screens from other projects or generic claude sessions!
    if (!isOurScreen) {
      // Running inside a different screen - just continue, don't kill!
      initLog(`Inside screen "${screenName}" but not our project screen (${projectId}) - continuing safely`);
      return; // DO NOT kill!
    }

    console.log('\x1b[33m⚠️  Detected running inside this project\'s screen session\x1b[0m');
    console.log('\x1b[2m   Killing screen and restarting specmem-init fresh...\x1b[0m');

    try {
      // Write a restart script that will run after we kill the screen
      const restartScript = `/tmp/specmem-restart-${process.pid}.sh`;
      fs.writeFileSync(restartScript, `#!/bin/bash
sleep 0.5
cd "${cwd}"
specmem-init ${args.join(' ')}
rm -f "${restartScript}"
`, { mode: 0o755 });

      // Spawn the restart script detached, then kill this screen
      const restartProc = spawn('bash', [restartScript], {
        detached: true,
        stdio: 'ignore',
        cwd: cwd
      });
      restartProc.on('error', () => {}); // fire-and-forget
      restartProc.unref();

      // Kill ONLY the current screen session (verified to be ours)
      if (sty) {
        execSync(`screen -S "${sty}" -X quit 2>/dev/null || true`, { stdio: 'ignore' });
      }

      process.exit(0);
    } catch (e) {
      console.error('\x1b[31mFailed to restart outside screen:\x1b[0m', e.message);
      // Continue anyway
    }
  }
}

// Run screen detection before anything else
detectAndExitScreen();

// Handle --help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${'\x1b[96m'}${'\x1b[1m'}SPECMEM INIT${'\x1b[0m'} - Project Initialization & Brain Console

${'\x1b[2m'}Usage:${'\x1b[0m'}
  specmem-init              Full init + launch Brain console
  specmem-init --no-console Init only, don't launch Brain
  specmem-init --help       Show this help

${'\x1b[2m'}Options:${'\x1b[0m'}
  --no-console      Skip launching Brain (init only)
  --reset-config    Reset ALL configs to defaults (wipe user-config.json too)
  --help, -h        Show this help

${'\x1b[2m'}What happens:${'\x1b[0m'}
  1. Scorched earth - wipes old configs (preserves user-config.json)
  2. Analyzes project & optimizes settings
  3. Compresses commands with Chinese tokens
  4. Launches  in centered window
  5. Current terminal becomes SpecMem Brain

${'\x1b[2m'}Config files:${'\x1b[0m'}
  specmem/user-config.json   Your custom CPU/RAM limits (PRESERVED on init)
  specmem/model-config.json  Auto-generated tier config (wiped on init)
  specmem.env                Main config (edit with caution!)

${'\x1b[2m'}Examples:${'\x1b[0m'}
  specmem-init               # Full init + Brain console
  specmem-init --no-console  # Init only (for CI/scripts)
  specmem-init --reset-config # Reset everything including user limits
`);
  process.exit(0);
}

// Handle --reset-config flag - wipes EVERYTHING including user-config.json
const RESET_ALL_CONFIG = args.includes('--reset-config');
if (RESET_ALL_CONFIG) {
  const userConfigPath = path.join(_initProjectPath, 'specmem', 'user-config.json');
  if (fs.existsSync(userConfigPath)) {
    fs.unlinkSync(userConfigPath);
    console.log('\x1b[33m⚠️  User config reset - all settings restored to defaults\x1b[0m');
    initLog('User config deleted due to --reset-config flag');
  }
}

// Always launch screens unless --no-console is specified

// ============================================================================
// ANSI ESCAPE CODES
// ============================================================================

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  blink: '\x1b[5m',
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
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  clearLine: '\x1b[2K',
  cursorUp: (n = 1) => `\x1b[${n}A`,
  cursorDown: (n = 1) => `\x1b[${n}B`,
  cursorStart: '\x1b[0G',
  cursorTo: (col) => `\x1b[${col}G`,
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  saveCursor: '\x1b[s',
  restoreCursor: '\x1b[u'
};

// Fire/lava gradient for the flex
const fireGradient = [c.red, c.brightRed, c.yellow, c.brightYellow, c.white];

// ============================================================================
// TIMEOUT CONSTANTS - Centralized timeouts for consistency fr
// ============================================================================
const TIMEOUTS = {
  // Embedding socket operations
  // NOTE: EMBEDDING_WARMUP is now DEPRECATED - we use event-based polling instead
  // The warmup function polls the 'ready' endpoint until model reports loaded,
  // which is superior to hardcoded timeouts that assume model loads in X seconds
  EMBEDDING_WARMUP: 5000,       // 5s - per-request timeout during polling (not total)
  EMBEDDING_REQUEST: 90000,     // 90s - standard embedding generation (increased from 60s)
  EMBEDDING_BATCH: 60000,       // 60s - batch embedding operations (increased from 30s)

  // Connection testing
  CONNECTION_TEST: 30000,       // 30s - socket/db connection checks

  // Database
  DB_CONNECTION: 10000,         // 10s - database pool connection timeout

  // External processes
  EXEC_TIMEOUT: 60000,          // 60s - execSync for apt/system commands
  EXEC_SHORT: 5000              // 5s - quick exec commands
};

// ============================================================================
// ANIMATED BANNER - Sliding red highlight through SPECMEM letters
// ============================================================================

const BANNER_LINES = [
  '  ███████╗██████╗ ███████╗ ██████╗███╗   ███╗███████╗███╗   ███╗',
  '  ██╔════╝██╔══██╗██╔════╝██╔════╝████╗ ████║██╔════╝████╗ ████║',
  '  ███████╗██████╔╝█████╗  ██║     ██╔████╔██║█████╗  ██╔████╔██║',
  '  ╚════██║██╔═══╝ ██╔══╝  ██║     ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║',
  '  ███████║██║     ███████╗╚██████╗██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║',
  '  ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝',
];

// Letter column ranges: [start, end] for S P E C M E M
const LETTER_RANGES = [
  [2, 9],   // S
  [10, 17], // P
  [18, 26], // E
  [27, 34], // C
  [35, 46], // M (first)
  [47, 54], // E
  [55, 66], // M (second)
];

// Colorize a single line with specific letter highlighted
function colorizeBannerLine(line, highlightIdx, fadeIdx) {
  let result = '';
  const chars = [...line]; // Handle unicode properly

  for (let i = 0; i < chars.length; i++) {
    let color = c.gray; // Default: grey

    // Check each letter range
    for (let letterIdx = 0; letterIdx < LETTER_RANGES.length; letterIdx++) {
      const [start, end] = LETTER_RANGES[letterIdx];
      if (i >= start && i < end) {
        if (letterIdx === highlightIdx) {
          color = c.brightRed + c.bold; // Currently highlighting: bright red
        } else if (letterIdx < fadeIdx) {
          color = c.cyan; // Already passed: cyan (lit up state)
        }
        break;
      }
    }

    result += color + chars[i];
  }

  return result + c.reset;
}

// Animated banner with sliding red highlight - FIXED: No cursor save/restore issues
async function showAnimatedBanner(skipAnimation = false) {
  const bannerHeight = BANNER_LINES.length; // 6 lines

  // Static fallback
  const drawStatic = () => {
    console.log('');
    for (const line of BANNER_LINES) {
      console.log(c.cyan + c.bold + line + c.reset);
    }
    console.log(`${c.dim}  Developed by Hardwick Software Services | https://justcalljon.pro${c.reset}`);
    console.log('');
  };

  // Skip animation if requested or not a TTY
  if (skipAnimation || !process.stdout.isTTY) {
    drawStatic();
    return;
  }

  const FRAME_DELAY = 15;  // Fast animation
  const LETTERS = 7;

  process.stdout.write(c.hideCursor);
  console.log(''); // Blank line before banner

  try {
    // Animate using cursorUp to redraw in place
    // First, print placeholder lines
    for (let i = 0; i < bannerHeight; i++) {
      console.log('');
    }

    for (let highlight = 0; highlight <= LETTERS; highlight++) {
      // Move cursor up to start of banner area
      process.stdout.write(`\x1b[${bannerHeight}A`);

      // Draw each line of banner with current highlight
      for (let i = 0; i < bannerHeight; i++) {
        const line = colorizeBannerLine(BANNER_LINES[i], highlight, highlight);
        process.stdout.write('\r' + c.clearLine + line + '\n');
      }

      if (highlight < LETTERS) {
        await new Promise(r => setTimeout(r, FRAME_DELAY));
      }
    }

    // Final solid cyan - cursor is already at end of banner
    process.stdout.write(`\x1b[${bannerHeight}A`);
    for (const line of BANNER_LINES) {
      process.stdout.write('\r' + c.clearLine + c.cyan + c.bold + line + c.reset + '\n');
    }
  } catch (e) {
    // Fallback on error - just print static
    drawStatic();
    return;
  } finally {
    process.stdout.write(c.showCursor);
  }

  console.log(`${c.dim}  Developed by Hardwick Software Services | https://justcalljon.pro${c.reset}`);
  console.log('');
}

// ============================================================================
// VISUAL WIDTH HELPERS - Fix emoji/unicode box drawing
// ============================================================================

/**
 * Calculate visual width of a string (handles emojis, ANSI codes)
 * Emojis are 2 chars wide visually, ANSI codes are 0 width
 */
function visualWidth(str) {
  // Strip ANSI escape codes first
  const stripped = str.replace(/\x1b\[[0-9;]*m/g, '');

  let width = 0;
  for (const char of stripped) {
    const code = char.codePointAt(0);
    // Emoji ranges (simplified - covers most common)
    if (code >= 0x1F300 && code <= 0x1FAF8 ||  // Misc symbols, emoticons, etc
        code >= 0x2600 && code <= 0x26FF ||     // Misc symbols
        code >= 0x2700 && code <= 0x27BF ||     // Dingbats
        code >= 0x231A && code <= 0x23FE ||     // Misc technical
        code >= 0x200D) {                        // ZWJ and modifiers
      width += 2;
    } else if (code > 0xFFFF) {
      // Other surrogate pairs (usually 2 wide)
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Pad string to visual width
 */
function padToWidth(str, targetWidth, padChar = ' ') {
  const currentWidth = visualWidth(str);
  const needed = targetWidth - currentWidth;
  return str + padChar.repeat(Math.max(0, needed));
}

/**
 * Draw a box with proper alignment
 */
function drawBox(lines, { borderColor = c.brightRed, width = null } = {}) {
  // Calculate max visual width
  const maxWidth = width || Math.max(...lines.map(l => visualWidth(l.text || l))) + 4;
  const innerWidth = maxWidth - 4; // Account for "║  " and "  ║"

  const result = [];
  result.push(`${borderColor}${c.bold}  ╔${'═'.repeat(maxWidth - 2)}╗${c.reset}`);

  for (const line of lines) {
    const text = typeof line === 'string' ? line : line.text;
    const padded = padToWidth(text, innerWidth);
    result.push(`${borderColor}${c.bold}  ║${c.reset}  ${padded}  ${borderColor}${c.bold}║${c.reset}`);
  }

  result.push(`${borderColor}${c.bold}  ╚${'═'.repeat(maxWidth - 2)}╝${c.reset}`);
  return result;
}

// ============================================================================
// LINUX EMOJI FONT AUTO-FIX + XTERM COLOR EMOJI SUPPORT
// ============================================================================

/**
 * Detect Linux environment and fix emoji font support system-wide.
 * Installs Noto Color Emoji, configures fontconfig fallback priority,
 * and sets up .Xresources for xterm color emoji rendering (iOS-style).
 *
 * Works on any Linux desktop: XFCE, GNOME, KDE, i3, headless, etc.
 * xterm specifically needs TrueType faceName + fontconfig emoji fallback
 * to render color emoji glyphs instead of hollow boxes.
 */
function checkAndFixEmojiSupport() {
  if (process.platform !== 'linux') {
    return { needed: false, fixed: false };
  }

  const homeDir = os.homedir();
  const term = process.env.TERM || '';
  const result = { needed: false, fixed: false, hasEmoji: false, fontInstalled: false, fontconfigWritten: false, xresourcesWritten: false };

  // ── Step 1: Detect existing emoji font ──────────────────────────────────
  let hasEmojiFont = false;
  try {
    const fontList = execSync('fc-list 2>/dev/null || true', { encoding: 'utf8' });
    hasEmojiFont = fontList.includes('Noto Color Emoji') ||
                   fontList.includes('EmojiOne') ||
                   fontList.includes('Twemoji') ||
                   fontList.includes('Symbola') ||
                   fontList.includes('Apple Color Emoji');
  } catch (e) { /* fc-list unavailable */ }

  result.hasEmoji = hasEmojiFont;

  // ── Step 2: Install Noto Color Emoji if missing ─────────────────────────
  if (!hasEmojiFont) {
    result.needed = true;
    console.log(`${c.yellow}⚠ No color emoji font detected${c.reset}`);
    console.log(`${c.dim}  Installing fonts-noto-color-emoji for iOS-style emoji rendering...${c.reset}`);

    try {
      execSync('sudo -n true 2>/dev/null', { stdio: 'ignore' });
      execSync('sudo apt-get update -qq && sudo apt-get install -y fonts-noto-color-emoji fonts-symbola 2>/dev/null', {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: TIMEOUTS.EXEC_TIMEOUT
      });
      execSync('fc-cache -f 2>/dev/null || true', { stdio: 'ignore' });

      console.log(`${c.green}✓ Noto Color Emoji font installed${c.reset}`);
      result.fontInstalled = true;
      result.fixed = true;
      result.hasEmoji = true;
    } catch (e) {
      console.log(`${c.yellow}  Auto-install failed. Run manually:${c.reset}`);
      console.log(`${c.cyan}  sudo apt install fonts-noto-color-emoji fonts-symbola${c.reset}`);
      result.manualRequired = true;
    }
  }

  // ── Step 3: Fontconfig color emoji priority ─────────────────────────────
  // This makes every application (including xterm) fall back to color emoji
  // when the primary font lacks a glyph. Without this, monospace fonts show
  // empty rectangles for emoji codepoints.
  const fontconfigDir = path.join(homeDir, '.config', 'fontconfig', 'conf.d');
  const fontconfigFile = path.join(fontconfigDir, '01-specmem-emoji.conf');

  if (!fs.existsSync(fontconfigFile)) {
    const fontconfigXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<!--
  SpecMem Emoji Fontconfig - iOS-style color emoji fallback
  Auto-generated by specmem-init. Safe to delete if unwanted.
  Ensures color emoji renders in xterm, urxvt, and all X11 terminals.
-->
<fontconfig>
  <!-- Prefer color emoji for all generic families -->
  <match target="pattern">
    <test name="family"><string>monospace</string></test>
    <edit name="family" mode="append"><string>Noto Color Emoji</string></edit>
  </match>
  <match target="pattern">
    <test name="family"><string>sans-serif</string></test>
    <edit name="family" mode="append"><string>Noto Color Emoji</string></edit>
  </match>
  <match target="pattern">
    <test name="family"><string>serif</string></test>
    <edit name="family" mode="append"><string>Noto Color Emoji</string></edit>
  </match>

  <!-- Force color emoji rendering over text presentation -->
  <match target="font">
    <test name="family" compare="contains"><string>Emoji</string></test>
    <edit name="scalable" mode="assign"><bool>true</bool></edit>
    <edit name="embeddedbitmap" mode="assign"><bool>true</bool></edit>
    <edit name="color" mode="assign"><bool>true</bool></edit>
  </match>

  <!-- Alias Apple Color Emoji requests to Noto Color Emoji -->
  <alias>
    <family>Apple Color Emoji</family>
    <prefer><family>Noto Color Emoji</family></prefer>
  </alias>
</fontconfig>
`;
    try {
      safeMkdir(fontconfigDir);
      fs.writeFileSync(fontconfigFile, fontconfigXml, 'utf8');
      // Rebuild cache so xterm picks it up immediately
      execSync('fc-cache -f 2>/dev/null || true', { stdio: 'ignore' });
      result.fontconfigWritten = true;
      result.fixed = true;
      initLog('Wrote fontconfig emoji fallback: ' + fontconfigFile);
    } catch (e) {
      initLog('Failed to write fontconfig emoji file', e);
    }
  } else {
    result.fontconfigWritten = true; // already exists
  }

  // ── Step 4: xterm .Xresources for color emoji ──────────────────────────
  // xterm requires faceName (TrueType) mode to render color emoji.
  // The classic bitmap font mode (font: fixed) cannot display emoji at all.
  // We append xterm settings only if not already present.
  const xresourcesPath = path.join(homeDir, '.Xresources');
  const specmemMarker = '! -- specmem-emoji-config --';

  let hasXresources = false;
  let xresourcesContent = '';
  try {
    if (fs.existsSync(xresourcesPath)) {
      xresourcesContent = fs.readFileSync(xresourcesPath, 'utf8');
      hasXresources = xresourcesContent.includes(specmemMarker);
    }
  } catch (e) { /* no .Xresources */ }

  if (!hasXresources) {
    const xtermConfig = `
${specmemMarker}
! SpecMem xterm emoji configuration - iOS-style color emoji in xterm
! Uses TrueType rendering with Noto Color Emoji fallback.
! Auto-generated by specmem-init. Remove this block if unwanted.
xterm*faceName: DejaVu Sans Mono
xterm*faceSize: 11
xterm*renderFont: true
xterm*utf8: 2
xterm*utf8Title: true
xterm*locale: true
xterm*faceNameDoublesize: Noto Color Emoji
! Enable wide character and color glyph support
xterm*cjkWidth: false
xterm*mkWidth: true
xterm*utf8Fonts.font: -misc-fixed-medium-r-normal--18-*-*-*-*-*-iso10646-1
! ${specmemMarker}
`;
    try {
      fs.appendFileSync(xresourcesPath, xtermConfig, 'utf8');
      // Merge into live X resources if xrdb is available
      execSync('xrdb -merge ~/.Xresources 2>/dev/null || true', { stdio: 'ignore' });
      result.xresourcesWritten = true;
      result.fixed = true;
      initLog('Appended xterm emoji config to .Xresources');
    } catch (e) {
      initLog('Failed to write .Xresources xterm config', e);
    }
  } else {
    result.xresourcesWritten = true; // already present
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  if (result.fontconfigWritten || result.xresourcesWritten) {
    if (!hasEmojiFont && result.fontInstalled) {
      console.log(`${c.dim}  Restart your terminal for full emoji support.${c.reset}`);
    }
    if (result.fontconfigWritten && !hasXresources) {
      console.log(`${c.dim}  Fontconfig: color emoji fallback for all apps${c.reset}`);
    }
    if (result.xresourcesWritten && !hasXresources) {
      console.log(`${c.dim}  Xresources: xterm TrueType + emoji configured${c.reset}`);
    }
    console.log('');
  }

  return result;
}

// ============================================================================
// XFCE TERMINAL COLOR FIX - Fixes rainbow display from ANSI escape sequences
// ============================================================================

/**
 * Detect XFCE terminal and fix color code handling issues.
 * XFCE4-terminal can display garbled "rainbow" output when:
 * 1. TERM isn't set to xterm-256color
 * 2. Terminal profile has incorrect color settings
 * 3. Escape sequences aren't properly interpreted
 *
 * This function auto-configures XFCE terminal for proper ANSI handling.
 */
function checkAndFixXFCETerminal() {
  if (process.platform !== 'linux') {
    return { needed: false, fixed: false };
  }

  const homeDir = os.homedir();
  const desktop = (process.env.XDG_CURRENT_DESKTOP || '').toUpperCase();
  const session = (process.env.DESKTOP_SESSION || '').toLowerCase();
  const termProgram = process.env.TERM_PROGRAM || '';
  const colorterm = process.env.COLORTERM || '';
  const term = process.env.TERM || '';

  const result = { needed: false, fixed: false, termFixed: false, profileFixed: false, bashrcFixed: false };

  // Only proceed if we're in XFCE or using xfce4-terminal
  const isXFCE = desktop === 'XFCE' || session === 'xfce' || session.includes('xfce');
  const isXFCETerminal = termProgram.includes('xfce') || process.env.XFCE_TERMINAL_ID;

  if (!isXFCE && !isXFCETerminal) {
    return result;
  }

  initLog('Detected XFCE environment - checking terminal color config');

  // ── Step 1: Check TERM environment variable ─────────────────────────────
  // xfce4-terminal works best with xterm-256color
  if (term !== 'xterm-256color' && !term.includes('256color')) {
    result.needed = true;
    initLog(`TERM is "${term}" - should be xterm-256color`);
  }

  // ── Step 2: Configure xfce4-terminal terminalrc ─────────────────────────
  const terminalrcDir = path.join(homeDir, '.config', 'xfce4', 'terminal');
  const terminalrcPath = path.join(terminalrcDir, 'terminalrc');
  const specmemMarker = '# -- specmem-color-fix --';

  let terminalrcExists = false;
  let terminalrcContent = '';
  let hasSpecmemConfig = false;

  try {
    if (fs.existsSync(terminalrcPath)) {
      terminalrcExists = true;
      terminalrcContent = fs.readFileSync(terminalrcPath, 'utf8');
      hasSpecmemConfig = terminalrcContent.includes(specmemMarker);
    }
  } catch (e) { /* no terminalrc */ }

  if (!hasSpecmemConfig) {
    result.needed = true;

    // XFCE terminal config to fix color issues
    const colorFix = `
${specmemMarker}
# SpecMem XFCE Terminal Color Fix
# Fixes rainbow display from ANSI escape sequences
# Auto-generated by specmem-init. Remove this block if unwanted.
ColorForeground=#f5f5f5
ColorBackground=#0a0a0f
ColorCursor=#00bfff
ColorSelection=#264f78
ColorSelectionUseDefault=FALSE
ColorBold=#ffffff
ColorBoldUseDefault=FALSE
ColorPalette=#1e1e1e;#f44747;#608b4e;#dcdcaa;#569cd6;#c586c0;#4ec9b0;#d4d4d4;#808080;#f44747;#608b4e;#dcdcaa;#569cd6;#c586c0;#4ec9b0;#ffffff
MiscAlwaysShowTabs=FALSE
MiscBell=FALSE
MiscBellUrgent=FALSE
MiscBordersDefault=TRUE
MiscCursorBlinks=TRUE
MiscCursorShape=TERMINAL_CURSOR_SHAPE_BLOCK
MiscDefaultGeometry=120x35
MiscInheritGeometry=FALSE
MiscMenubarDefault=FALSE
MiscMouseAutohide=FALSE
MiscMouseWheelZoom=TRUE
MiscToolbarDefault=FALSE
MiscConfirmClose=TRUE
MiscCycleTabs=TRUE
MiscTabCloseButtons=TRUE
MiscTabCloseMiddleClick=TRUE
MiscTabPosition=GTK_POS_TOP
MiscHighlightUrls=TRUE
MiscMiddleClickOpensUri=FALSE
MiscCopyOnSelect=FALSE
MiscShowRelaunchDialog=TRUE
MiscRewrapOnResize=TRUE
MiscUseShiftArrowsToScroll=FALSE
MiscSlimTabs=FALSE
MiscNewTabAdjacent=FALSE
MiscSearchDialogOpacity=100
MiscShowUnsafePasteDialog=TRUE
ScrollingBar=TERMINAL_SCROLLBAR_NONE
ScrollingLines=10000
ScrollingOnOutput=FALSE
TitleMode=TERMINAL_TITLE_REPLACE
`;

    try {
      safeMkdir(terminalrcDir);

      if (terminalrcExists) {
        // Append to existing config
        fs.appendFileSync(terminalrcPath, colorFix);
      } else {
        // Create new config with header
        fs.writeFileSync(terminalrcPath, `[Configuration]${colorFix}`);
      }

      result.profileFixed = true;
      result.fixed = true;
      initLog('Wrote XFCE terminal color fix to: ' + terminalrcPath);
    } catch (e) {
      initLog('Failed to write XFCE terminal config', e);
    }
  }

  // ── Step 3: Add TERM export to bashrc ───────────────────────────────────
  // This ensures TERM=xterm-256color persists across sessions
  const bashrcPath = path.join(homeDir, '.bashrc');
  const bashrcMarker = '# specmem-term-fix';

  let bashrcContent = '';
  let hasBashrcFix = false;

  try {
    if (fs.existsSync(bashrcPath)) {
      bashrcContent = fs.readFileSync(bashrcPath, 'utf8');
      hasBashrcFix = bashrcContent.includes(bashrcMarker);
    }
  } catch (e) { /* no .bashrc */ }

  if (!hasBashrcFix && result.needed) {
    const termFix = `
${bashrcMarker}
# SpecMem: Force 256-color terminal support for proper ANSI rendering
# Fixes XFCE terminal rainbow display issue with  Code output
if [[ "$TERM" != *"256color"* ]] && [[ -n "$DISPLAY" ]]; then
  export TERM=xterm-256color
fi
`;

    try {
      fs.appendFileSync(bashrcPath, termFix);
      result.bashrcFixed = true;
      result.fixed = true;
      initLog('Added TERM fix to .bashrc');
    } catch (e) {
      initLog('Failed to write .bashrc TERM fix', e);
    }
  }

  // ── Step 4: Set TERM for current session ────────────────────────────────
  if (result.needed && !term.includes('256color')) {
    process.env.TERM = 'xterm-256color';
    result.termFixed = true;
    result.fixed = true;
    initLog('Set TERM=xterm-256color for current session');
  }

  // ── Report what we fixed ────────────────────────────────────────────────
  if (result.fixed) {
    console.log(`${c.green}✓ XFCE terminal color fix applied${c.reset}`);
    if (result.profileFixed) {
      console.log(`${c.dim}  Terminal profile: proper color palette configured${c.reset}`);
    }
    if (result.bashrcFixed) {
      console.log(`${c.dim}  Bashrc: TERM=xterm-256color for future sessions${c.reset}`);
    }
    if (result.termFixed) {
      console.log(`${c.dim}  Current session: TERM updated to xterm-256color${c.reset}`);
    }
    console.log(`${c.yellow}  Restart terminal for full effect${c.reset}`);
    console.log('');
  }

  return result;
}

// ============================================================================
// ELEGANT PROGRESS UI - Now with more FLEX
// ============================================================================

// Module-level UI reference for warnings from nested functions
let _currentUI = null;
function uiWarn(msg) {
  if (_currentUI) _currentUI.addWarning(msg);
  else initLog('[WARN] ' + msg);
}

class ProgressUI {
  constructor() {
    this.currentStage = 0;
    this.totalStages = 10; // Default with screens, 9 if --no-console
    this.stageName = '';
    this.status = '';
    this.subStatus = '';
    this.spinnerFrames = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];
    this.fireFrames = ['🔥', '💥', '⚡', '✨', '🔥'];
    this.spinnerIndex = 0;
    this.fireIndex = 0;
    this.interval = null;
    this.startTime = Date.now();
    this.width = Math.min(process.stdout.columns || 80, 76);
    this.completedStages = [];

    // Sub-progress within stage (0-1 for smooth bar increments)
    this.subProgress = 0;

    // Animation offset for shimmer effect on grey filler
    this.shimmerOffset = 0;

    // Warnings/errors footer (shows last warning, logs all to file)
    this.lastWarning = '';
    this.warningCount = 0;

    // Render lock to prevent concurrent stdout writes
    this.isRendering = false;

    // TUI file feed - shows what's being embedded in real-time
    this.fileFeed = [];          // [{file, status, time}] - last N files
    this.fileFeedMax = 3;        // How many files to show
    this.fileFeedEnabled = false; // Show content during embedding phase
    this.fileFeedAllocated = false; // Once allocated, space persists for stable layout
  }

  // Add a warning - shows in footer and logs to file
  addWarning(msg) {
    this.warningCount++;
    this.lastWarning = msg.length > 60 ? msg.slice(0, 57) + '...' : msg;
    initLog('[WARN] ' + msg);
  }

  start() {
    process.stdout.write(c.hideCursor);

    // Version and Chinese compression warning - persistent info line
    const version = typeof SPECMEM_VERSION !== 'undefined' ? SPECMEM_VERSION : require('../package.json').version;
    process.stdout.write(`  ${c.dim}v${version}${c.reset} ${c.cyan}│${c.reset} ${c.dim}Hardwick Software Services${c.reset}\n`);
    process.stdout.write(`  ${c.yellow}⚠${c.reset} ${c.dim}Dear amazing user, to save tokens we compress output with 繁體中文 (Traditional Chinese).${c.reset}\n`);
    process.stdout.write(`  ${c.dim}  Nothing sneaky! 30-70% token savings with 99-100% context accuracy. Full semantic preservation.${c.reset}\n`);

    // Show resource limits if different from defaults
    const limitsNotice = getResourceLimitsNotice();
    if (limitsNotice) {
      process.stdout.write(`  ${c.cyan}🔧${c.reset} ${c.dim}${limitsNotice}${c.reset}\n`);
    }

    // Add separator to protect info above
    process.stdout.write(`${c.dim}${'─'.repeat(this.width)}${c.reset}\n`);
    // Print initial lines that we'll update in place (13 max for buffer against cursor drift)
    process.stdout.write('\n\n\n\n\n\n\n\n\n\n\n\n\n');

    this.interval = setInterval(() => this.render(), 60);
  }

  render() {
    // Render lock - prevent concurrent renders
    if (this.isRendering) return;
    this.isRendering = true;

    try {
      const spinner = this.spinnerFrames[this.spinnerIndex];
      const fire = this.fireFrames[this.fireIndex];
      this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
      this.fireIndex = (this.fireIndex + 1) % this.fireFrames.length;

      // Advance shimmer animation (faster for more visible pulse)
      this.shimmerOffset = (this.shimmerOffset + 1) % 30;

      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);

      // PER-STAGE LOADING BAR: Each stage gets its own 0-100% progress
      // subProgress is 0.0-1.0 representing work done within current stage
      const percent = Math.min(100, Math.round(this.subProgress * 100));

      // Build progress bar
      const barWidth = this.width - 20;
      const filled = Math.round((percent / 100) * barWidth);
      const empty = barWidth - filled;

      // Stage color gradient
      let barColor = c.red;
      let barColorCode = '\x1b[38;5;196m'; // Red
      if (percent >= 25) { barColor = c.brightRed; barColorCode = '\x1b[38;5;202m'; }
      if (percent >= 50) { barColor = c.yellow; barColorCode = '\x1b[38;5;220m'; }
      if (percent >= 75) { barColor = c.brightYellow; barColorCode = '\x1b[38;5;226m'; }
      if (percent >= 90) { barColor = c.brightGreen; barColorCode = '\x1b[38;5;46m'; }

      // FILLED PORTION - shimmer pulse going through the filled bar
      let filledPart = '';
      for (let i = 0; i < filled; i++) {
        // Shimmer wave position (creates a moving bright spot)
        const shimmerPos = (i + this.shimmerOffset) % 30;

        if (shimmerPos >= 12 && shimmerPos <= 18) {
          // Shimmer highlight (brighter version of bar color)
          const highlightColor = percent >= 90 ? '\x1b[38;5;51m' :  // Bright cyan for green
                                 percent >= 75 ? '\x1b[38;5;230m' : // Bright yellow
                                 percent >= 50 ? '\x1b[38;5;226m' : // Yellow
                                 percent >= 25 ? '\x1b[38;5;208m' : // Bright red
                                 '\x1b[38;5;202m'; // Red
          filledPart += `${highlightColor}█`;
        } else if (shimmerPos === 11 || shimmerPos === 19) {
          // Shimmer fade edge
          filledPart += `${barColorCode}▓`;
        } else {
          // Normal filled color
          filledPart += `${barColorCode}█`;
        }
      }

      // EMPTY PORTION - grey box with diagonal construction stripes
      let emptyPart = '';
      if (empty > 0) {
        // Opening box border
        emptyPart += `${c.gray}╢`;

        // Interior construction stripes
        const stripePattern = ['╱', ' ', ' ']; // Diagonal line with spacing
        const interior = empty - 2; // Account for borders
        for (let i = 0; i < interior; i++) {
          const patternIndex = (i + Math.floor(this.shimmerOffset / 3)) % stripePattern.length;
          const char = stripePattern[patternIndex];
          emptyPart += `${c.gray}${char}`;
        }

        // Closing box border
        emptyPart += `${c.gray}╟`;
      }

      const bar = `${filledPart}${emptyPart}${c.reset}`;
      const statusText = this.status.substring(0, this.width - 6);

      // Build line 5 content
      let line5 = '';
      if (this.lastWarning) {
        const warnPrefix = this.warningCount > 1 ? `(${this.warningCount}) ` : '';
        line5 = `     ${c.yellow}⚠${c.reset} ${c.dim}${warnPrefix}${this.lastWarning}${c.reset}`;
      } else if (this.completedStages.length > 0) {
        const recent = this.completedStages.slice(-3).map(s => `${c.green}✓${c.dim}${s}${c.reset}`).join(' ');
        line5 = `     ${recent}`;
      }

      // ATOMIC RENDER - single write to prevent interleaving
      // Smooth transition: show "BEGINNING..." for first second of codebase indexing
      let displayStageName = this.stageName;
      if (this.stageName === 'CODEBASE INDEXING' && parseFloat(elapsed) < 1.0) {
        displayStageName = 'BEGINNING CODEBASE INDEXATION';
      }

      // ROBUST CURSOR HANDLING: Always go up MAX lines and clear them all
      // This prevents ghost lines from cursor drift (any extra newlines between renders)
      // Base: 5 lines + File feed: 5 lines + Buffer: 3 lines for safety = 13 max
      const maxLines = 13;
      const contentLines = this.fileFeedAllocated ? 10 : 5;

      const output = [
        c.cursorUp(maxLines),
      ];

      // Clear buffer lines at top (handles cursor drift from rogue newlines)
      for (let i = 0; i < maxLines - contentLines; i++) {
        output.push(`${c.clearLine}${c.cursorStart}\n`);
      }

      // Main UI content
      output.push(
        `${c.clearLine}${c.cursorStart}  ${fire} ${c.cyan}${spinner}${c.reset} ${c.bold}[${this.currentStage}/${this.totalStages}]${c.reset} ${c.brightCyan}${displayStageName}${c.reset} ${c.dim}(${elapsed}s)${c.reset}\n`,
        `${c.clearLine}${c.cursorStart}     ${c.white}${statusText}${c.reset}\n`,
        `${c.clearLine}${c.cursorStart}  ${bar} ${c.bold}${barColor}${percent}%${c.reset}\n`,
        `${c.clearLine}${c.cursorStart}     ${c.dim}${this.subStatus || ''}${c.reset}\n`,
        `${c.clearLine}${c.cursorStart}${line5}\n`
      );

      // Add file feed area if ever allocated (persists for stable layout)
      if (this.fileFeedAllocated) {
        if (this.fileFeedEnabled && this.fileFeed.length > 0) {
          // Show active file feed with content
          output.push(`${c.clearLine}${c.cursorStart}  ${c.dim}┌${'─'.repeat(this.width - 4)}┐${c.reset}\n`);
          for (let i = 0; i < this.fileFeedMax; i++) {
            const entry = this.fileFeed[i];
            if (entry) {
              const age = Math.round((Date.now() - entry.time) / 1000);
              const ageStr = age < 60 ? `${age}s` : `${Math.floor(age/60)}m`;
              const line = `${entry.status} ${entry.file}`;
              const padded = line.length > this.width - 12 ? line.slice(0, this.width - 15) + '...' : line;
              output.push(`${c.clearLine}${c.cursorStart}  ${c.dim}│${c.reset} ${padded.padEnd(this.width - 12)}${c.dim}${ageStr.padStart(4)}${c.reset} ${c.dim}│${c.reset}\n`);
            } else {
              output.push(`${c.clearLine}${c.cursorStart}  ${c.dim}│${' '.repeat(this.width - 4)}│${c.reset}\n`);
            }
          }
          output.push(`${c.clearLine}${c.cursorStart}  ${c.dim}└${'─'.repeat(this.width - 4)}┘${c.reset}\n`);
        } else {
          // Empty placeholder (keeps layout stable)
          for (let i = 0; i < 5; i++) {
            output.push(`${c.clearLine}${c.cursorStart}\n`);
          }
        }
      }

      process.stdout.write(output.join(''));
    } finally {
      this.isRendering = false;
    }
  }

  setStage(num, name) {
    if (this.currentStage > 0 && this.stageName) {
      this.completedStages.push(this.stageName.split(' ')[0]); // Just first word
    }
    this.currentStage = num;
    this.stageName = name;
    this.status = '';
    this.subStatus = '';
    this.subProgress = 0; // Reset sub-progress for new stage
  }

  setStatus(status, subProgressIncrement = 0) {
    this.status = status;
    // Optionally increment sub-progress with each status update
    if (subProgressIncrement > 0) {
      this.subProgress = Math.min(1, this.subProgress + subProgressIncrement);
    }
  }

  // Set sub-progress directly (0-1 range, represents progress within current stage)
  setSubProgress(progress) {
    this.subProgress = Math.max(0, Math.min(1, progress));
  }

  setSubStatus(subStatus) {
    this.subStatus = subStatus;
  }

  /**
   * Slow down rendering during heavy I/O phases to prevent race conditions.
   * Call this before phases that do lots of parallel work.
   */
  slowRendering(intervalMs = 500) {
    if (this.interval) {
      clearInterval(this.interval);
    }
    this.interval = setInterval(() => this.render(), intervalMs);
  }

  /**
   * Resume normal rendering speed after heavy I/O phase.
   */
  normalRendering() {
    if (this.interval) {
      clearInterval(this.interval);
    }
    this.interval = setInterval(() => this.render(), 60);
  }

  /**
   * Pause rendering to allow console.log output without breaking cursor positioning.
   * Call this BEFORE any console.log statements during a stage.
   */
  pauseRendering() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    // Move cursor below our 5-line area so console.log doesn't overlap
    // We're already at line 5 after last render, so just stay there
  }

  /**
   * Enable/disable the file feed TUI panel
   * IMPORTANT: File feed area is ALWAYS allocated once enabled the first time.
   * This keeps the loading bar position stable.
   * NOTE: We no longer write newlines here - start() allocates 13 lines upfront.
   */
  enableFileFeed(enabled = true) {
    if (enabled && !this.fileFeedAllocated) {
      // Just set the flag - no newlines needed (start() allocates 13 lines for buffer)
      this.fileFeedAllocated = true;
    }
    this.fileFeedEnabled = enabled;
    if (!enabled) {
      this.fileFeed = [];
    }
  }

  /**
   * Add a file to the embedding feed
   * @param {string} filePath - Relative file path
   * @param {string} status - 'reading', 'embedding', 'done', 'skip', 'error', 'def'
   * @param {string} detail - Optional detail (e.g., definition name, size)
   */
  addFileToFeed(filePath, status = 'embedding', detail = null) {
    if (!this.fileFeedEnabled) return;

    const statusIcons = {
      reading: '📖',
      embedding: '🧠',
      done: '✅',
      skip: '⏭️',
      error: '❌',
      def: '🔧',  // For definitions
      user: '👤',  // User prompt (session extraction)
      assistant: '🤖'  // Claude response (session extraction)
    };

    // Format display string
    let displayText;
    if (status === 'def' && detail) {
      // Show definition: "🔧 function createLogger() → logger.ts"
      const shortFile = filePath.split('/').pop();
      displayText = `${detail} → ${shortFile}`;
    } else if ((status === 'user' || status === 'assistant') && detail) {
      // Session entry: "👤 [abc123] "message preview...""
      displayText = `[${filePath}] ${detail}`;
    } else if (detail) {
      // Show file with detail: "logger.ts (3.2KB)"
      const fileName = filePath.length > 35 ? '...' + filePath.slice(-32) : filePath;
      displayText = `${fileName} ${detail}`;
    } else {
      displayText = filePath.length > 45 ? '...' + filePath.slice(-42) : filePath;
    }

    this.fileFeed.unshift({
      file: displayText,
      status: statusIcons[status] || '⏳',
      time: Date.now()
    });

    // Keep only last N files
    if (this.fileFeed.length > this.fileFeedMax) {
      this.fileFeed.pop();
    }
  }

  /**
   * Resume rendering after console.log output is done.
   * Call this AFTER console.log statements are complete.
   */
  resumeRendering() {
    if (!this.interval) {
      // Re-print 5 blank lines for our render area (use write to avoid buffering issues)
      process.stdout.write('\n\n\n\n\n');
      this.interval = setInterval(() => this.render(), 60);
    }
  }

  /**
   * Print content while paused - handles the pause/resume automatically.
   * Use this for blocks of console output during a stage.
   */
  printBlock(callback) {
    this.pauseRendering();
    callback();
    this.resumeRendering();
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write(c.showCursor);
  }

  complete(message) {
    this.stop();
    // Calculate lines to clear (5 base + 5 if file feed was enabled)
    const linesToClear = this.fileFeedEnabled ? 10 : 5;

    // Clear terminal and show completion banner
    process.stdout.write('\x1b[2J\x1b[H'); // Clear screen and move to top

    // Show the SPECMEM banner in cyan (completed state)
    for (const line of BANNER_LINES) {
      console.log(c.cyan + c.bold + line + c.reset);
    }
    console.log(`${c.dim}  Developed by Hardwick Software Services | https://justcalljon.pro${c.reset}`);
    console.log('');
    console.log(`  ${c.brightGreen}✓${c.reset} ${c.bold}${message}${c.reset}`);

    // Disable file feed
    this.fileFeedEnabled = false;
    this.fileFeed = [];
  }

  fail(message) {
    this.stop();

    // Clear terminal and show failure banner
    process.stdout.write('\x1b[2J\x1b[H'); // Clear screen and move to top

    // Show the SPECMEM banner in red (failed state)
    for (const line of BANNER_LINES) {
      console.log(c.red + line + c.reset);
    }
    console.log(`${c.dim}  Developed by Hardwick Software Services | https://justcalljon.pro${c.reset}`);
    console.log('');
    console.log(`  ${c.red}✗${c.reset} ${message}`);

    // Disable file feed
    this.fileFeedEnabled = false;
    this.fileFeed = [];
  }
}

// ============================================================================
// SPEED MODE - ENABLED BY DEFAULT for fast initialization
// ============================================================================

let speedMode = true;  // FAST BY DEFAULT - no more waiting!
let speedModeListener = null;

function initSpeedMode() {
  if (!process.stdin.isTTY) return;

  // Enable raw mode to capture keypresses
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  speedModeListener = (key) => {
    // Space = enable speed mode
    if (key === ' ') {
      if (!speedMode) {
        speedMode = true;
        process.stdout.write(`\r${c.clearLine}${c.brightYellow}⚡ TURBO MODE ACTIVATED${c.reset}\n`);
      }
    }
    // Ctrl+C = exit
    if (key === '\u0003') {
      cleanupSpeedMode();
      process.exit(0);
    }
  };

  process.stdin.on('data', speedModeListener);
}

function cleanupSpeedMode() {
  if (speedModeListener) {
    process.stdin.removeListener('data', speedModeListener);
    speedModeListener = null;
  }
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function sleep(ms) {
  // Speed mode: reduce delays to minimum
  const actualMs = speedMode ? Math.min(ms, 20) : ms;
  return new Promise(resolve => setTimeout(resolve, actualMs));
}

// ============================================================================
// QOMS - Queued Operation Management System (CJS version)
// ============================================================================
// Resource-aware operation execution with:
//   - CPU/RAM monitoring (never exceed 75% CPU, 60% RAM)
//   - Priority levels (CRITICAL, HIGH, MEDIUM, LOW, IDLE)
//   - FIFO queue with exponential backoff
//   - Automatic throttling when resources are constrained
// ============================================================================

const QOMS_CONFIG = {
  maxCpuPercent: 90,       // Allow higher CPU for speed
  maxRamPercent: 80,       // Allow more RAM
  checkIntervalMs: 10,     // Fast checks
  maxWaitMs: 10000,        // Shorter max wait
  minDelayMs: 5,           // Minimal delay
  maxDelayMs: 20,          // Minimal max delay
};

const QOMS_PRIORITY = {
  CRITICAL: 0,  // Always run (health checks)
  HIGH: 1,      // User-facing ops
  MEDIUM: 2,    // Background ops (default)
  LOW: 3,       // Maintenance
  IDLE: 4,      // Only when system idle
};

// CPU tracking for percentage calculation
let lastCpuInfo = null;
let lastCpuTime = 0;

/**
 * Get current CPU usage percentage
 */
function getCpuPercent() {
  const cpus = os.cpus();

  if (!lastCpuInfo || Date.now() - lastCpuTime > 1000) {
    lastCpuInfo = cpus;
    lastCpuTime = Date.now();
    return 0; // First call, no delta yet
  }

  let totalDelta = 0;
  let idleDelta = 0;

  for (let i = 0; i < cpus.length; i++) {
    const curr = cpus[i].times;
    const prev = lastCpuInfo[i].times;

    const currTotal = curr.user + curr.nice + curr.sys + curr.idle + curr.irq;
    const prevTotal = prev.user + prev.nice + prev.sys + prev.idle + prev.irq;

    totalDelta += currTotal - prevTotal;
    idleDelta += curr.idle - prev.idle;
  }

  lastCpuInfo = cpus;
  lastCpuTime = Date.now();

  if (totalDelta === 0) return 0;
  return Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
}

/**
 * Get current system metrics
 */
function getSystemMetrics() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return {
    cpuPercent: getCpuPercent(),
    ramPercent: Math.round((usedMem / totalMem) * 100),
    freeRamMB: Math.round(freeMem / 1024 / 1024),
    totalRamMB: Math.round(totalMem / 1024 / 1024),
  };
}

/**
 * Check if we can execute an operation
 */
function canExecute(priority = QOMS_PRIORITY.MEDIUM) {
  const metrics = getSystemMetrics();

  // Critical operations always run
  if (priority === QOMS_PRIORITY.CRITICAL) {
    return true;
  }

  // Check CPU limit
  if (metrics.cpuPercent > QOMS_CONFIG.maxCpuPercent) {
    return false;
  }

  // Check RAM limit
  if (metrics.ramPercent > QOMS_CONFIG.maxRamPercent) {
    return false;
  }

  // IDLE priority only runs when system is very idle
  if (priority === QOMS_PRIORITY.IDLE) {
    return metrics.cpuPercent < 5 && metrics.ramPercent < 15;
  }

  return true;
}

/**
 * QQMS - Resource-aware delay with QOMS
 * Waits for resources to be available, then applies a randomized delay
 * @param {number} priority - QOMS priority level
 * @returns {Promise<void>}
 */
async function qqms(priority = QOMS_PRIORITY.MEDIUM) {
  const startWait = Date.now();

  // Wait for resources if needed (with timeout)
  while (!canExecute(priority) && (Date.now() - startWait) < QOMS_CONFIG.maxWaitMs) {
    await sleep(QOMS_CONFIG.checkIntervalMs);
  }

  // Apply randomized delay for smooth visual updates
  const baseDelay = QOMS_CONFIG.minDelayMs;
  const randomRange = QOMS_CONFIG.maxDelayMs - QOMS_CONFIG.minDelayMs;
  const delay = baseDelay + Math.floor(Math.random() * randomRange);

  return sleep(delay);
}

/**
 * Execute an operation with QOMS resource management
 * @param {Function} operation - Async operation to execute
 * @param {number} priority - QOMS priority level
 * @returns {Promise<any>}
 */
async function qomsExec(operation, priority = QOMS_PRIORITY.MEDIUM) {
  const startWait = Date.now();

  // Wait for resources
  while (!canExecute(priority) && (Date.now() - startWait) < QOMS_CONFIG.maxWaitMs) {
    await sleep(QOMS_CONFIG.checkIntervalMs);
  }

  // Execute the operation
  return operation();
}

// Export QOMS for use in stages
const qoms = {
  exec: qomsExec,
  delay: qqms,
  canExecute,
  getMetrics: getSystemMetrics,
  PRIORITY: QOMS_PRIORITY,
  CONFIG: QOMS_CONFIG,
};

// ============================================================================
// DOCKER MANAGEMENT - Cleanup + Warm-Start + Version Safety
// ============================================================================
// Strategy for embedding containers:
//   PAUSED   → Check version! Keep if match, KILL if mismatch (old code!)
//   RUNNING  → Check version! Keep if match, KILL if mismatch (old code!)
//   EXITED   → Check version! Clean if >1hr OR version mismatch
//   DEAD     → Clean immediately (broken garbage)
//
// VERSION SAFETY:
//   - Every container gets labeled with specmem.version on creation
//   - Before using ANY container, check specmem.version label
//   - Missing label = old code = KILL IT
//   - Version mismatch = old code = KILL IT
//   - Only exact version match = safe to use
// ============================================================================

// Get current specmem version from package.json
function getSpecmemVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version || '0.0.0';
  } catch (e) {
    return '0.0.0';
  }
}

const SPECMEM_VERSION = getSpecmemVersion();

/**
 * Check if a container has the correct specmem version
 * @param {string} containerId - Container ID or name
 * @returns {Object} Version check result
 */
function checkContainerVersion(containerId) {
  const result = {
    hasVersion: false,
    version: null,
    matches: false,
    needsRebuild: true,
  };

  try {
    // Get the specmem.version label
    const labelOutput = execSync(
      `docker inspect --format='{{index .Config.Labels "specmem.version"}}' ${containerId} 2>/dev/null`,
      { encoding: 'utf8' }
    ).trim();

    if (labelOutput && labelOutput !== '<no value>' && labelOutput !== '') {
      result.hasVersion = true;
      result.version = labelOutput;
      result.matches = labelOutput === SPECMEM_VERSION;
      result.needsRebuild = !result.matches;
    }
  } catch (e) {
    // Container doesn't exist or can't be inspected
  }

  return result;
}

/**
 * Kill and remove a container (version mismatch = old code)
 * @param {string} containerId - Container ID or name
 * @param {string} reason - Why we're killing it
 * @returns {boolean} Success
 */
function killOutdatedContainer(containerId, reason) {
  try {
    execSync(`docker rm -f ${containerId} 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Clean up dead and exited Docker containers, detect paused containers for warm-start
 * CRITICAL: Validates version labels to prevent running old code!
 * @returns {Object} Cleanup and warm-start results
 */
async function cleanupDockerContainers() {
  const results = {
    dead: 0,
    exited: 0,
    versionMismatch: 0,   // Containers killed due to version mismatch
    paused: 0,            // Track paused containers (warm-start assets!)
    running: 0,           // Track running containers
    cleaned: [],
    pausedContainers: [], // List of paused containers for potential warm-start
    runningContainers: [], // List of running embedding containers
    errors: [],
    dockerAvailable: false,
    currentVersion: SPECMEM_VERSION,
  };

  try {
    // Check if docker is available
    execSync('docker --version 2>/dev/null', { stdio: 'pipe' });
    results.dockerAvailable = true;
  } catch (e) {
    return results; // Docker not available, skip cleanup
  }

  try {
    // Get all containers with their status
    const containerList = execSync(
      'docker ps -a --format "{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Image}}" 2>/dev/null',
      { encoding: 'utf8' }
    ).trim();

    if (!containerList) return results;

    const lines = containerList.split('\n').filter(l => l.trim());

    for (const line of lines) {
      const [id, name, status, image] = line.split('\t');

      // Check if specmem/embedding related
      const isSpecmem = name?.includes('specmem') || image?.includes('specmem');
      const isEmbedding = name?.includes('embedding') || image?.includes('embedding') || image?.includes('frankenstein');

      // FIX: Check if container belongs to THIS project before any cleanup
      // Only manage containers from the current project - don't touch other projects!
      let belongsToThisProject = false;
      if (isSpecmem || isEmbedding) {
        try {
          const containerPath = execSync(
            `docker inspect --format='{{index .Config.Labels "specmem.path"}}' ${id} 2>/dev/null`,
            { encoding: 'utf8' }
          ).trim();
          const currentPath = process.cwd();
          belongsToThisProject = containerPath === currentPath;
        } catch (e) {
          // No label = legacy container, check by name pattern
          const projectDirName = path.basename(process.cwd()).toLowerCase().replace(/[^a-z0-9]/g, '');
          belongsToThisProject = name?.includes(projectDirName);
        }
      }

      // VERSION CHECK for specmem containers (critical safety!)
      let versionCheck = { matches: true, needsRebuild: false };
      if ((isSpecmem || isEmbedding) && belongsToThisProject) {
        versionCheck = checkContainerVersion(id);

        // Kill containers with version mismatch (OLD CODE!) - ONLY for THIS project
        if (versionCheck.needsRebuild && status !== 'Dead') {
          const oldVersion = versionCheck.version || 'MISSING';
          if (killOutdatedContainer(id, `version mismatch: ${oldVersion} != ${SPECMEM_VERSION}`)) {
            results.versionMismatch++;
            results.cleaned.push({
              id,
              name,
              type: 'version_mismatch',
              oldVersion,
              newVersion: SPECMEM_VERSION,
              wasState: status?.includes('Paused') ? 'paused' : (status?.startsWith('Up') ? 'running' : 'exited'),
            });
          }
          continue; // Container is gone, move on
        }
      }

      // Track PAUSED containers - warm-start gold! (only if version matches AND belongs to this project)
      if (status?.includes('Paused')) {
        if ((isSpecmem || isEmbedding) && belongsToThisProject && versionCheck.matches) {
          results.paused++;
          results.pausedContainers.push({
            id, name, status, image,
            warmStartReady: true,
            version: versionCheck.version,
            versionMatches: true,
          });
        }
        continue;
      }

      // Track RUNNING containers (only if version matches AND belongs to this project)
      if (status?.startsWith('Up') && !status?.includes('Paused')) {
        if ((isSpecmem || isEmbedding) && belongsToThisProject && versionCheck.matches) {
          results.running++;
          results.runningContainers.push({
            id, name, status, image,
            version: versionCheck.version,
            versionMatches: true,
          });
        }
        continue;
      }

      // Clean ALL dead containers (they're unusable garbage)
      if (status === 'Dead') {
        try {
          execSync(`docker rm -f ${id} 2>/dev/null`, { stdio: 'pipe' });
          results.dead++;
          results.cleaned.push({ id, name: name || '(unnamed)', type: 'dead' });
        } catch (e) {
          results.errors.push({ id, name, error: e.message });
        }
      }
      // Clean exited specmem containers older than 1 hour (ONLY for this project)
      else if (isSpecmem && belongsToThisProject && status?.startsWith('Exited')) {
        // Parse time from status like "Exited (0) 42 hours ago"
        const timeMatch = status.match(/(\d+)\s+(second|minute|hour|day|week)/);
        if (timeMatch) {
          const amount = parseInt(timeMatch[1], 10);
          const unit = timeMatch[2];

          // Only clean if older than 1 hour
          const oldEnough = (unit === 'hour' && amount >= 1) ||
                           unit === 'day' ||
                           unit === 'week';

          if (oldEnough) {
            try {
              execSync(`docker rm ${id} 2>/dev/null`, { stdio: 'pipe' });
              results.exited++;
              results.cleaned.push({ id, name, type: 'exited', age: status });
            } catch (e) {
              results.errors.push({ id, name, error: e.message });
            }
          }
        }
      }
    }

    // Also prune dangling images if any containers were cleaned
    if (results.dead + results.exited > 0) {
      try {
        execSync('docker image prune -f 2>/dev/null', { stdio: 'pipe' });
      } catch (e) {
        // Ignore prune errors
      }
    }

  } catch (e) {
    results.errors.push({ error: e.message });
  }

  return results;
}

/**
 * Kill ALL embedding containers for THIS PROJECT specifically
 * Called on init to ensure clean state - no kys check needed!
 * Uses specmem.path label to filter by project
 * @returns {Object} Cleanup results
 */
function killProjectEmbeddingContainers() {
  const results = {
    killed: 0,
    containers: [],
    errors: [],
  };

  const projectPath = process.cwd();
  const projectDirName = path.basename(projectPath).toLowerCase().replace(/[^a-z0-9]/g, '');

  try {
    // Method 1: Find by specmem.path label (most accurate)
    const byLabel = execSync(
      `docker ps -q --filter "label=specmem.path=${projectPath}" 2>/dev/null`,
      { encoding: 'utf8' }
    ).trim();

    // Method 2: Find by container name pattern (fallback)
    const byName = execSync(
      `docker ps -q --filter "name=specmem-embedding-${projectDirName}" 2>/dev/null`,
      { encoding: 'utf8' }
    ).trim();

    // Combine and dedupe
    const containerIds = new Set([
      ...byLabel.split('\n').filter(id => id.trim()),
      ...byName.split('\n').filter(id => id.trim()),
    ]);

    for (const containerId of containerIds) {
      try {
        // Get container name for logging
        const name = execSync(`docker inspect --format='{{.Name}}' ${containerId} 2>/dev/null`, { encoding: 'utf8' }).trim().replace(/^\//, '');

        // Stop and remove
        execSync(`docker rm -f ${containerId} 2>/dev/null`, { stdio: 'pipe' });
        results.killed++;
        results.containers.push(name || containerId);
      } catch (e) {
        results.errors.push({ id: containerId, error: e.message });
      }
    }
  } catch (e) {
    // Docker not available or no containers
  }

  return results;
}

/**
 * Warm-start a paused embedding container (instant ~100ms resume)
 * @param {string} containerName - Name of the paused container
 * @returns {Object} Result of warm-start
 */
async function warmStartContainer(containerName) {
  const result = {
    success: false,
    latencyMs: 0,
    error: null,
  };

  const startTime = Date.now();

  try {
    // Unpause the container
    execSync(`docker unpause ${containerName} 2>/dev/null`, { stdio: 'pipe' });
    result.latencyMs = Date.now() - startTime;
    result.success = true;
  } catch (e) {
    result.error = e.message;
  }

  return result;
}

/**
 * Pause an embedding container for resource savings (keeps model in RAM)
 * @param {string} containerName - Name of the running container
 * @returns {Object} Result of pause
 */
async function pauseContainer(containerName) {
  const result = {
    success: false,
    error: null,
  };

  try {
    execSync(`docker pause ${containerName} 2>/dev/null`, { stdio: 'pipe' });
    result.success = true;
  } catch (e) {
    result.error = e.message;
  }

  return result;
}

/**
 * Get detailed embedding container status
 * @returns {Object} Status of embedding containers
 */
function getEmbeddingStatus() {
  const status = {
    available: false,
    containers: [],
    warmStartReady: false,
    coldStartRequired: false,
  };

  try {
    const containerList = execSync(
      'docker ps -a --format "{{.Names}}\\t{{.Status}}" --filter "name=embedding" 2>/dev/null',
      { encoding: 'utf8' }
    ).trim();

    if (!containerList) {
      status.coldStartRequired = true;
      return status;
    }

    status.available = true;

    for (const line of containerList.split('\n').filter(l => l.trim())) {
      const [name, containerStatus] = line.split('\t');

      const isPaused = containerStatus?.includes('Paused');
      const isRunning = containerStatus?.startsWith('Up') && !isPaused;

      status.containers.push({
        name,
        status: containerStatus,
        isPaused,
        isRunning,
        warmStartReady: isPaused,
      });

      if (isPaused) status.warmStartReady = true;
      if (isRunning) status.available = true;
    }

    if (!status.warmStartReady && !status.containers.some(c => c.isRunning)) {
      status.coldStartRequired = true;
    }

  } catch (e) {
    status.coldStartRequired = true;
  }

  return status;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatNumber(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Recursive directory deletion (like rm -rf)
function rimraf(dir) {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rimraf(fullPath);
    } else {
      fs.unlinkSync(fullPath);
    }
  }
  fs.rmdirSync(dir);
}

// ============================================================================
// TIER CONFIGURATION - What settings SHOULD be for each tier
// ============================================================================

const TIER_CONFIG = {
  small: {
    embedding: { batchSize: 32, maxConcurrent: 4, timeout: 30000 },
    watcher: { debounceMs: 500, maxFileSizeBytes: 1024 * 1024, queueBatchSize: 10 },
    cache: { embeddingCacheSize: 1000, memoryCacheSize: 500, codeCacheSize: 200 },
    processing: { chunkSize: 4096, overlapSize: 512, maxChunks: 100 }
  },
  medium: {
    embedding: { batchSize: 24, maxConcurrent: 3, timeout: 45000 },
    watcher: { debounceMs: 750, maxFileSizeBytes: 768 * 1024, queueBatchSize: 8 },
    cache: { embeddingCacheSize: 2500, memoryCacheSize: 1000, codeCacheSize: 500 },
    processing: { chunkSize: 3072, overlapSize: 384, maxChunks: 75 }
  },
  large: {
    embedding: { batchSize: 16, maxConcurrent: 2, timeout: 60000 },
    watcher: { debounceMs: 1000, maxFileSizeBytes: 512 * 1024, queueBatchSize: 5 },
    cache: { embeddingCacheSize: 3500, memoryCacheSize: 1400, codeCacheSize: 1000 },
    processing: { chunkSize: 2048, overlapSize: 256, maxChunks: 50 }
  }
};

// embedding model max context - standardize all text truncation to this
const MAX_EMBED_CHARS = 8000;

// ============================================================================
// STAGE 1: PROJECT ANALYSIS
// ============================================================================

async function analyzeProject(projectPath, ui) {
  ui.setStage(1, 'PROJECT ANALYSIS');

  const results = {
    tier: 'small',
    files: { total: 0, byType: {} },
    lines: { total: 0, code: 0 },
    complexity: 0,
    size: 0
  };

  // Substage 1: Initialize scan
  ui.setStatus('Initializing project scan...');
  ui.setSubProgress(0.1);
  ui.setSubStatus('Preparing file system traversal');
  await qqms();

  const fileTypes = {};
  let totalFiles = 0;
  let totalSize = 0;

  // Substage 2: Scan directories
  ui.setStatus('Scanning directory structure...');
  ui.setSubProgress(0.25);
  ui.setSubStatus('Traversing project tree...');
  await qqms();

  function scanDir(dir, depth = 0) {
    if (depth > 10) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', '.venv', 'venv'].includes(entry.name)) continue;
          scanDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase() || '.noext';
          fileTypes[ext] = (fileTypes[ext] || 0) + 1;
          totalFiles++;
          try {
            totalSize += fs.statSync(fullPath).size;
          } catch (e) {
            // yooo file stat failed but we keep scanning fr
            if (process.env.SPECMEM_DEBUG) console.log('[SCAN] stat failed for ' + fullPath + ': ' + e.message);
          }
        }
      }
    } catch (e) {
      // directory scan failed but we keep going no cap
      if (process.env.SPECMEM_DEBUG) console.log('[SCAN] readdir failed for ' + dir + ': ' + e.message);
    }
  }

  scanDir(projectPath);
  results.files.total = totalFiles;
  results.files.byType = fileTypes;
  results.size = totalSize;

  ui.setSubProgress(0.4);
  ui.setSubStatus(`Found ${formatNumber(totalFiles)} files`);
  await qqms();

  // Substage 3: Calculate sizes
  ui.setStatus('Calculating file sizes...');
  ui.setSubProgress(0.55);
  ui.setSubStatus(`Total: ${formatBytes(totalSize)}`);
  await qqms();

  // Substage 4: Count LOC
  ui.setStatus('Counting lines of code...');
  ui.setSubProgress(0.7);
  ui.setSubStatus('Scanning source files...');
  await qqms();

  let codeLines = 0;
  const codeExtensions = ['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.hpp', '.cs', '.rb', '.php'];
  let filesProcessed = 0;

  function countLines(dir, depth = 0) {
    if (depth > 10) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (['node_modules', '.git', 'dist', 'build', '__pycache__', '.next'].includes(entry.name)) continue;
          countLines(fullPath, depth + 1);
        } else if (entry.isFile() && codeExtensions.includes(path.extname(entry.name).toLowerCase())) {
          try {
            codeLines += fs.readFileSync(fullPath, 'utf8').split('\n').length;
            filesProcessed++;
          } catch (e) {
            // yooo file read failed - prolly binary or permission issue
            if (process.env.SPECMEM_DEBUG) console.log('[LOC] read failed for ' + fullPath + ': ' + e.message);
          }
        }
      }
    } catch (e) {
      // directory scan cooked fr
      if (process.env.SPECMEM_DEBUG) console.log('[LOC] readdir failed for ' + dir + ': ' + e.message);
    }
  }

  countLines(projectPath);
  results.lines.code = codeLines;

  ui.setSubProgress(0.8);
  ui.setSubStatus(`${formatNumber(codeLines)} LOC in ${formatNumber(filesProcessed)} files`);
  await qqms();

  // Substage 5: Analyze file types
  ui.setStatus('Analyzing file types...');
  ui.setSubProgress(0.85);
  const langCount = Object.keys(fileTypes).filter(ext => codeExtensions.includes(ext)).length;
  ui.setSubStatus(`${langCount} programming languages detected`);
  await qqms();

  // Substage 6: Calculate complexity
  ui.setStatus('Calculating project complexity...');
  ui.setSubProgress(0.9);
  ui.setSubStatus('Evaluating metrics...');
  await qqms();

  let complexity = 0;

  // File count factor
  if (totalFiles > 2000) complexity += 35;
  else if (totalFiles > 1000) complexity += 30;
  else if (totalFiles > 500) complexity += 20;
  else if (totalFiles > 100) complexity += 10;

  ui.setSubStatus(`File complexity: +${complexity}`);
  await qqms();

  // LOC factor
  const locScore = complexity;
  if (codeLines > 200000) complexity += 35;
  else if (codeLines > 100000) complexity += 30;
  else if (codeLines > 50000) complexity += 20;
  else if (codeLines > 10000) complexity += 10;

  ui.setSubStatus(`LOC complexity: +${complexity - locScore}`);
  await qqms();

  // Size factor
  const sizeScore = complexity;
  if (totalSize > 500 * 1024 * 1024) complexity += 20;
  else if (totalSize > 100 * 1024 * 1024) complexity += 15;
  else if (totalSize > 10 * 1024 * 1024) complexity += 5;

  ui.setSubStatus(`Size complexity: +${complexity - sizeScore}`);
  await qqms();

  // Language diversity factor
  if (langCount > 5) complexity += 10;
  else if (langCount > 3) complexity += 5;

  results.complexity = Math.min(complexity, 100);

  // Substage 7: Determine tier
  ui.setStatus('Determining project tier...');
  ui.setSubProgress(0.95);
  await qqms();

  if (complexity >= 60 || codeLines > 50000 || totalFiles > 500) {
    results.tier = 'large';
  } else if (complexity >= 30 || codeLines > 10000 || totalFiles > 100) {
    results.tier = 'medium';
  }

  const tierColors = { small: c.green, medium: c.yellow, large: c.brightRed };
  const tierEmoji = { small: '🟢', medium: '🟡', large: '🔴' };
  ui.setSubProgress(1.0);
  ui.setSubStatus(`${tierEmoji[results.tier]} Tier: ${tierColors[results.tier]}${results.tier.toUpperCase()}${c.reset} (${complexity}/100)`);
  await qqms();

  return results;
}

// ============================================================================
// STAGE 2: SCORCHED EARTH - Wipe everything and rebuild fresh
// ============================================================================

async function scorchedEarth(projectPath, ui) {
  ui.setStage(2, 'CLEANUP');

  const specmemDir = path.join(projectPath, 'specmem');
  const projectDir = path.join(projectPath, '.claude');

  let wipedItems = 0;

  // NOTE: user-config.json is NEVER wiped - it persists user's custom CPU/RAM limits
  // Only model-config.json (auto-generated tier config) gets wiped

  // PRESERVE USER CUSTOMIZATIONS from model-config.json before wiping
  // If user modified resource limits in model-config.json, save them to user-config.json
  ui.setStatus('Checking for user customizations...');
  ui.setSubProgress(0.05);
  const modelConfigPath = path.join(specmemDir, 'model-config.json');
  const userConfigPath = path.join(specmemDir, 'user-config.json');

  if (fs.existsSync(modelConfigPath)) {
    try {
      const modelConfig = JSON.parse(fs.readFileSync(modelConfigPath, 'utf8'));
      const DEFAULTS = { cpuMin: 20, cpuMax: 40, ramMinMb: 4000, ramMaxMb: 6000 };

      // Check if resources differ from defaults
      const resources = modelConfig.resources || {};
      const hasCustomLimits = (resources.cpuMin != null && resources.cpuMin !== DEFAULTS.cpuMin) ||
                              (resources.cpuMax != null && resources.cpuMax !== DEFAULTS.cpuMax) ||
                              (resources.ramMinMb != null && resources.ramMinMb !== DEFAULTS.ramMinMb) ||
                              (resources.ramMaxMb != null && resources.ramMaxMb !== DEFAULTS.ramMaxMb);

      // Check for heavyOps settings too
      const heavyOps = modelConfig.heavyOps || null;
      const hasHeavyOps = heavyOps && heavyOps.enabled != null;

      if (hasCustomLimits || hasHeavyOps) {
        // Preserve custom settings to user-config.json
        let userConfig = {};
        if (fs.existsSync(userConfigPath)) {
          try {
            userConfig = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
          } catch (e) { /* fresh user config */ }
        }

        // Merge resource limits
        if (resources.cpuMin != null) userConfig.cpuMin = resources.cpuMin;
        if (resources.cpuMax != null) userConfig.cpuMax = resources.cpuMax;
        if (resources.ramMinMb != null) userConfig.ramMinMb = resources.ramMinMb;
        if (resources.ramMaxMb != null) userConfig.ramMaxMb = resources.ramMaxMb;

        // Merge heavyOps settings
        if (hasHeavyOps) {
          userConfig.heavyOps = {
            enabled: heavyOps.enabled,
            batchSizeMultiplier: heavyOps.batchSizeMultiplier || 2,
            throttleReduction: heavyOps.throttleReduction || 0.2
          };
          initLog(`Preserved heavyOps: enabled=${heavyOps.enabled}, multiplier=${heavyOps.batchSizeMultiplier}`);
        }

        userConfig.preservedAt = new Date().toISOString();
        userConfig.preservedFrom = 'model-config.json';

        fs.writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2));
        ui.setSubStatus(`💾 Custom settings preserved to user-config.json`);
        initLog(`Preserved custom limits: CPU ${resources.cpuMin}-${resources.cpuMax}%, RAM ${resources.ramMinMb}-${resources.ramMaxMb}MB`);
        await qqms();
      }
    } catch (e) {
      initLog(`Failed to check model-config.json for customizations: ${e.message}`);
    }
  }

  // Now wipe model-config.json (user customizations already preserved above)
  ui.setStatus('Wiping existing model configuration...');
  ui.setSubProgress(0.1);
  if (fs.existsSync(modelConfigPath)) {
    fs.unlinkSync(modelConfigPath);
    wipedItems++;
    ui.setSubStatus('🔥 model-config.json destroyed (custom limits preserved)');
    await qqms();
  }

  // Wipe embedding-timeouts.json
  ui.setStatus('Wiping embedding timeout config...');
  ui.setSubProgress(0.25);
  const timeoutPath = path.join(specmemDir, 'embedding-timeouts.json');
  if (fs.existsSync(timeoutPath)) {
    fs.unlinkSync(timeoutPath);
    wipedItems++;
    ui.setSubStatus('🔥 embedding-timeouts.json destroyed');
    await qqms();
  }

  // Wipe project commands (will redeploy fresh)
  ui.setStatus('Wiping project commands...');
  ui.setSubProgress(0.45);
  const projectCmdsDir = path.join(projectDir, 'commands');
  if (fs.existsSync(projectCmdsDir)) {
    const cmds = fs.readdirSync(projectCmdsDir).filter(f => f.startsWith('specmem') && f.endsWith('.md'));
    for (const cmd of cmds) {
      fs.unlinkSync(path.join(projectCmdsDir, cmd));
      wipedItems++;
    }
    ui.setSubStatus(`🔥 ${cmds.length} project commands destroyed`);
    await qqms();
  }

  // Wipe settings.local.json (will recreate)
  ui.setStatus('Wiping local  settings...');
  ui.setSubProgress(0.65);
  const localSettings = path.join(projectDir, 'settings.local.json');
  if (fs.existsSync(localSettings)) {
    fs.unlinkSync(localSettings);
    wipedItems++;
    ui.setSubStatus('🔥 settings.local.json destroyed');
    await qqms();
  }

  // Clear embedding cache (if exists)
  ui.setStatus('Clearing embedding cache...');
  ui.setSubProgress(0.85);
  const cacheDir = path.join(specmemDir, 'cache');
  if (fs.existsSync(cacheDir)) {
    const cacheFiles = fs.readdirSync(cacheDir);
    for (const f of cacheFiles) {
      try {
        fs.unlinkSync(path.join(cacheDir, f));
        wipedItems++;
      } catch (e) {
        // yooo cache file delete failed - might be locked
        if (process.env.SPECMEM_DEBUG) console.log('[CACHE] delete failed for ' + f + ': ' + e.message);
      }
    }
    ui.setSubStatus(`🔥 ${cacheFiles.length} cache files destroyed`);
    await qqms();
  }

  ui.setStatus('Scorched earth complete!');
  ui.setSubProgress(1.0);
  ui.setSubStatus(`💀 ${wipedItems} items obliterated - rebuilding from scratch`);
  await qqms();

  return { wipedItems };
}

// ============================================================================
// STAGE 5: MODEL OPTIMIZATION
// ============================================================================

async function optimizeModel(projectPath, analysis, ui) {
  ui.setStage(3, 'BLAST OFF 🚀');

  const recommended = TIER_CONFIG[analysis.tier];

  // Adjust cache based on available RAM
  ui.setStatus('Analyzing system resources...');
  const totalRAM = os.totalmem() / (1024 * 1024 * 1024);
  const freeRAM = os.freemem() / (1024 * 1024 * 1024);
  const cpus = os.cpus().length;

  ui.setSubStatus(`${totalRAM.toFixed(1)}GB RAM (${freeRAM.toFixed(1)}GB free), ${cpus} CPUs`);
  await qqms();

  let cacheMultiplier = 1;
  if (freeRAM > 8) cacheMultiplier = 1.5;
  else if (freeRAM > 4) cacheMultiplier = 1.2;
  else if (freeRAM < 2) cacheMultiplier = 0.7;

  // Adjust concurrency based on CPU cores
  let concurrentMultiplier = 1;
  if (cpus >= 8) concurrentMultiplier = 1.5;
  else if (cpus >= 4) concurrentMultiplier = 1.2;
  else if (cpus < 2) concurrentMultiplier = 0.5;

  // For large projects, reduce cache to prevent OOM
  if (analysis.tier === 'large') cacheMultiplier *= 0.7;

  const config = {
    tier: analysis.tier,
    generatedAt: new Date().toISOString(),
    projectStats: {
      files: analysis.files.total,
      linesOfCode: analysis.lines.code,
      size: analysis.size,
      complexity: analysis.complexity
    },
    systemStats: {
      totalRAM: Math.round(totalRAM * 100) / 100,
      freeRAM: Math.round(freeRAM * 100) / 100,
      cpus: cpus
    },
    embedding: {
      batchSize: recommended.embedding.batchSize,
      maxConcurrent: Math.max(1, Math.round(recommended.embedding.maxConcurrent * concurrentMultiplier)),
      timeout: recommended.embedding.timeout
    },
    watcher: { ...recommended.watcher },
    cache: {
      embeddingCacheSize: Math.round(recommended.cache.embeddingCacheSize * cacheMultiplier),
      memoryCacheSize: Math.round(recommended.cache.memoryCacheSize * cacheMultiplier),
      codeCacheSize: Math.round(recommended.cache.codeCacheSize * cacheMultiplier)
    },
    processing: { ...recommended.processing },
    // ═══════════════════════════════════════════════════════════════════════
    // 🔥 SCORCHED EARTH OPTIMIZATIONS - ALL ON BY DEFAULT 🔥
    // User overrides from user-config.json are applied below
    // ═══════════════════════════════════════════════════════════════════════
    resources: (function() {
      // Start with defaults
      const defaults = {
        cpuMin: 20,       // Target minimum 20% CPU
        cpuMax: 40,       // Cap at 40% CPU
        ramMinMb: 4000,   // 4GB minimum RAM
        ramMaxMb: 6000,   // 6GB maximum RAM
        updatedAt: new Date().toISOString()
      };
      // Apply user overrides from user-config.json (persisted across init)
      const userConfigPath = path.join(projectPath, 'specmem', 'user-config.json');
      if (fs.existsSync(userConfigPath)) {
        try {
          const userConfig = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
          if (userConfig.cpuMin != null) defaults.cpuMin = userConfig.cpuMin;
          if (userConfig.cpuMax != null) defaults.cpuMax = userConfig.cpuMax;
          if (userConfig.ramMinMb != null) defaults.ramMinMb = userConfig.ramMinMb;
          if (userConfig.ramMaxMb != null) defaults.ramMaxMb = userConfig.ramMaxMb;
          initLog(`Applied user config overrides: CPU ${defaults.cpuMin}-${defaults.cpuMax}%, RAM ${defaults.ramMinMb}-${defaults.ramMaxMb}MB`);
        } catch (e) {
          initLog(`Failed to read user-config.json for overrides: ${e.message}`);
        }
      }
      return defaults;
    })(),
    optimizations: {
      // OPT 1: Warm RAM - Model stays loaded, no cold starts
      warmRam: { enabled: true, description: 'Model stays warm in RAM (no cold starts)' },
      // OPT 2: QQMS Throttling - CPU-aware delay system
      qqmsThrottling: { enabled: true, description: 'QQMS CPU-aware throttling with FIFO+ACK' },
      // OPT 3: Efficient I/O - select() based, no busy-waiting
      efficientIO: { enabled: true, description: 'select() I/O - no busy-waiting' },
      // OPT 4: Adaptive Batch Sizing - Auto-adjusts based on CPU/RAM
      adaptiveBatch: { enabled: true, description: 'Adaptive batch sizing based on CPU/RAM' },
      enabledAt: new Date().toISOString()
    },
    // heavyOps - restored from user-config.json if previously enabled
    heavyOps: (function() {
      const userConfigPath = path.join(projectPath, 'specmem', 'user-config.json');
      if (fs.existsSync(userConfigPath)) {
        try {
          const userConfig = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
          if (userConfig.heavyOps && userConfig.heavyOps.enabled) {
            initLog(`Restored heavyOps from user-config.json: multiplier=${userConfig.heavyOps.batchSizeMultiplier}`);
            return {
              enabled: true,
              enabledAt: new Date().toISOString(),
              originalBatchSize: recommended.embedding.batchSize,
              batchSizeMultiplier: userConfig.heavyOps.batchSizeMultiplier || 2,
              throttleReduction: userConfig.heavyOps.throttleReduction || 0.2
            };
          }
        } catch (e) {
          initLog(`Failed to read heavyOps from user-config.json: ${e.message}`);
        }
      }
      return null; // Not enabled
    })()
  };

  // Remove heavyOps if null (not enabled)
  if (config.heavyOps === null) {
    delete config.heavyOps;
  }

  // 🚀 BLAST OFF - Model Optimization (uses ProgressUI only, no custom output)
  ui.setStatus('Configuring...');
  ui.setSubProgress(0.3);

  const visualDelay = (ms) => new Promise(r => setTimeout(r, ms));
  await visualDelay(300);
  ui.setStatus('Optimizing model...');
  ui.setSubProgress(0.5);

  // Write config first
  const configDir = path.join(projectPath, 'specmem');
  safeMkdir(configDir);
  const configPath = path.join(configDir, 'model-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Read back and verify
  let verifiedConfig;
  try {
    verifiedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error('Config write failed: ' + err.message);
  }

  // Verify all optimizations using ProgressUI (NO custom output, NO new lines)
  const steps = [
    { key: 'warmRam', name: 'Warm RAM' },
    { key: 'qqmsThrottling', name: 'QQMS' },
    { key: 'efficientIO', name: 'Efficient I/O' },
    { key: 'adaptiveBatch', name: 'Adaptive Batch' },
    { key: 'resources', name: 'Resources' }
  ];

  let allVerified = true;
  let verifiedNames = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let verified = false;

    if (step.key === 'resources') {
      const res = verifiedConfig.resources;
      verified = res && res.cpuMin != null && res.cpuMax != null;
    } else {
      verified = verifiedConfig.optimizations?.[step.key]?.enabled === true;
    }

    if (!verified) allVerified = false;
    else verifiedNames.push(step.name);

    ui.setSubProgress((i + 1) / steps.length);
    ui.setStatus(`Verifying ${step.name}...`);
    ui.setSubStatus(verified ? `✓ ${step.name} enabled` : `✗ ${step.name} FAILED`);

    await visualDelay(150);
  }

  if (!allVerified) {
    throw new Error('MODEL_CONFIG_FAILED: Not all optimizations verified');
  }

  ui.setSubProgress(1.0);
  ui.setSubStatus(`All verified: ${verifiedNames.join(', ')}`);

  return config;
}

// ============================================================================
// STAGE 8: EMBEDDING DOCKER - Cold start + feed with codebase
// ============================================================================
/**
 * Cold-start the embedding Docker container and feed it with the indexed codebase.
 * This ensures the overflow queue is pre-populated before  launches.
 */
async function coldStartEmbeddingDocker(projectPath, modelConfig, ui, codebaseResult) {
  ui.setStage(4, 'EMBEDDING DOCKER');

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔒 PRE-FLIGHT ACK CHECK - Verify optimizations before starting embedding 🔒
  // We NEVER start embedding server without verified optimizations
  // ═══════════════════════════════════════════════════════════════════════════
  ui.setStatus('Pre-flight: Verifying model optimizations...');

  const requiredOpts = ['warmRam', 'qqmsThrottling', 'efficientIO', 'adaptiveBatch'];
  for (const opt of requiredOpts) {
    if (!modelConfig.optimizations?.[opt]?.enabled) {
      initLog('PRE-FLIGHT FAILED: ' + opt + ' not enabled');
      ui.setSubStatus('✗ PRE-FLIGHT: ' + opt + ' not enabled');
      throw new Error(`PRE_FLIGHT_FAILED: ${opt} optimization not verified`);
    }
  }
  // Pre-flight passed - update status (no console.log needed, UI shows it)
  ui.setSubStatus('Pre-flight: All 4 optimizations verified ✓');
  await qqms();

  const socketsDir = path.join(projectPath, 'specmem', 'sockets');
  const socketPath = path.join(socketsDir, 'embeddings.sock');
  const {spawn} = require('child_process');

  // Ensure sockets directory exists
  ui.setStatus('Preparing embedding environment...');
  safeMkdir(socketsDir);

  // Create statusbar-state.json for claudefix footer integration
  const statusbarPath = path.join(socketsDir, 'statusbar-state.json');
  if (!fs.existsSync(statusbarPath)) {
    fs.writeFileSync(statusbarPath, JSON.stringify({
      embeddingHealth: 'unknown',
      lastToolCall: null,
      lastToolDuration: 0,
      memoryCount: 0,
      mcpConnected: false,
      lastUpdate: Date.now()
    }, null, 2));
  }

  ui.setSubProgress(0.1);
  await qqms();

  // Write timeout config - these get persisted for runtime use
  ui.setStatus('Configuring embedding timeouts...');
  const timeoutConfig = {
    firstRequestTimeout: modelConfig.tier === 'large' ? 120000 : modelConfig.tier === 'medium' ? 90000 : 60000,
    subsequentTimeout: modelConfig.embedding.timeout,
    batchTimeout: modelConfig.embedding.timeout * modelConfig.embedding.batchSize / 10,
    warmupTimeout: TIMEOUTS.EMBEDDING_BATCH
  };
  const timeoutPath = path.join(projectPath, 'specmem', 'embedding-timeouts.json');
  fs.writeFileSync(timeoutPath, JSON.stringify(timeoutConfig, null, 2));
  ui.setSubProgress(0.2);
  await qqms();

  // DOCKER DISABLED: Native Python (frankenstein-embeddings.py) is the primary system.
  // Docker containers were causing CPU spikes and socket conflicts.
  try {
    const { execSync } = require('child_process');
    execSync('docker rm -f $(docker ps -aq --filter "name=specmem-embedding") 2>/dev/null', { stdio: 'ignore', timeout: 10000 });
  } catch {}
  initLog('[DOCKER] Docker embedding disabled - using native Python exclusively');
  ui.setSubStatus('Using native Python embedding server');
  return { serverRunning: false, warmupLatency: null, timeoutConfig };

  // EARLY BAIL-OUT: Check if Docker is actually usable before wasting time
  // 1. Docker daemon must be running
  // 2. The embedding image must exist locally (warm-start.sh uses specmem-embedding:latest)
  // 3. OR there must be an existing container we can resume
  // If none of these are true, skip Docker entirely — Stage 5 will use native Python.
  try {
    const { execSync } = require('child_process');
    // Check if Docker daemon is accessible
    try { execSync('docker info', { stdio: 'ignore', timeout: 5000 }); } catch {
      initLog('[DOCKER] Docker daemon not accessible - skipping Docker stage');
      ui.setSubStatus('⚠️ Docker not available - will use native Python');
      return { serverRunning: false, warmupLatency: null, timeoutConfig };
    }
    // Check for existing specmem embedding containers (any state)
    const containers = execSync(
      `docker ps -a --filter "name=specmem-embedding" --format "{{.Names}}" 2>/dev/null`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    if (!containers) {
      // No containers — check if the image exists to cold-start from
      const images = execSync(
        `docker images -q specmem-embedding:latest 2>/dev/null`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();
      if (!images) {
        initLog('[DOCKER] No embedding containers and no specmem-embedding:latest image - skipping Docker');
        ui.setSubStatus('⚠️ No Docker embedding image - will use native Python');
        return { serverRunning: false, warmupLatency: null, timeoutConfig };
      }
    }
    initLog(`[DOCKER] Found containers/image - proceeding with Docker warm-start`);
  } catch (e) {
    initLog(`[DOCKER] Pre-check failed (${e.message}) - skipping Docker`);
    ui.setSubStatus('⚠️ Docker pre-check failed - will use native Python');
    return { serverRunning: false, warmupLatency: null, timeoutConfig };
  }

  // Spawn warm-start.sh with env vars for per-project socket
  const dockerProcess = spawn('bash', [warmStartScript], {
    cwd: path.dirname(warmStartScript),
    env: {
      ...process.env,
      SPECMEM_PROJECT_PATH: projectPath,
      SPECMEM_EMBEDDING_SOCKET: socketPath,
      SPECMEM_SOCKET_DIR: socketsDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let dockerOutput = '';
  let dockerStarted = false;

  // Stream Docker logs to UI sub-status
  dockerProcess.stdout.on('data', chunk => {
    dockerOutput += chunk.toString();
    const lines = dockerOutput.split('\n');
    const lastLine = lines[lines.length - 2] || lines[lines.length - 1] || '';

    // Extract meaningful status from log
    if (lastLine.includes('Socket ready')) {
      dockerStarted = true;
      ui.setSubStatus('✅ Docker container ready');
    } else if (lastLine.length > 0 && lastLine.length < 60) {
      ui.setSubStatus(lastLine.trim());
    }
  });

  dockerProcess.stderr.on('data', chunk => {
    const line = chunk.toString().trim();
    if (line.length > 0 && line.length < 60) {
      ui.setSubStatus(`🐳 ${line}`);
    }
  });

  // Wait for Docker to start (up to 60s)
  // DYNAMIC WAIT: Poll for Docker socket with adaptive intervals (max 5min)
  const MAX_DOCKER_WAIT_MS = 300000; // 5 minute absolute cap
  const dockerStart = Date.now();
  ui.setStatus('Waiting for Docker container...');
  ui.setSubProgress(0.3);

  let dockerPollInterval = 200; // start fast for Docker
  while (Date.now() - dockerStart < MAX_DOCKER_WAIT_MS) {
    if (dockerStarted || fs.existsSync(socketPath)) {
      break;
    }
    await new Promise(r => setTimeout(r, dockerPollInterval));
    const elapsed = Date.now() - dockerStart;
    // Slow down polling after 10s
    if (elapsed > 10000) dockerPollInterval = Math.min(dockerPollInterval + 100, 2000);
    // Progress update every ~5s
    if (Math.floor(elapsed / 5000) !== Math.floor((elapsed - dockerPollInterval) / 5000)) {
      const progress = Math.min(0.7, 0.3 + (elapsed / MAX_DOCKER_WAIT_MS) * 0.4);
      ui.setSubProgress(progress);
      ui.setSubStatus(`Waiting for Docker... (${Math.round(elapsed / 1000)}s)`);
    }
  }

  const dockerLatency = Date.now() - dockerStart;

  if (!fs.existsSync(socketPath)) {
    ui.setStatus('⚠️ Docker socket not ready - will start on first use');
    ui.setSubStatus(`Waited ${Math.round(dockerLatency/1000)}s`);
    ui.setSubProgress(1);
    return { serverRunning: false, warmupLatency: null, timeoutConfig };
  }

  ui.setStatus('Docker container ready!');
  ui.setSubStatus(`🚀 Started in ${Math.round(dockerLatency/1000)}s`);
  ui.setSubProgress(0.8);
  await qqms();

  // EVENT-BASED WARMUP: Wait for actual embed response instead of fixed timeout
  // The warmup request triggers model loading (if lazy) and we wait for the real response
  // No fixed timeout - the embed request itself is the proof the model is ready
  ui.setStatus('Warming up embedding model...');
  let warmupLatency = null;

  try {
    const net = require('net');
    const warmupStart = Date.now();

    // Progress animation during warmup (updates every 500ms until response)
    let progressInterval = null;
    let elapsed = 0;

    const startProgressAnimation = () => {
      progressInterval = setInterval(() => {
        elapsed = Math.round((Date.now() - warmupStart) / 1000);
        // Asymptotic progress: 80% -> 98% over time (never reaches 100 until done)
        const progressFactor = 1 - Math.exp(-elapsed / 30);
        ui.setSubProgress(0.8 + progressFactor * 0.18);
        ui.setSubStatus(`⏳ Loading model... (${elapsed}s)`);
      }, 500);
    };

    const stopProgressAnimation = () => {
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    };

    startProgressAnimation();

    // Send warmup embed request and wait for ACTUAL response (no timeout!)
    // This triggers lazy model loading and waits until model is ready
    await new Promise((resolve, reject) => {
      const client = new net.Socket();
      let data = '';

      // No socket timeout - we wait as long as needed for model to load
      // The server will respond once model is loaded and embedding is ready

      client.connect(socketPath, () => {
        ui.setSubStatus('🔄 Sending warmup request...');
        client.write(JSON.stringify({ type: 'embed', text: 'specmem initialization warmup test' }) + '\n');
      });

      client.on('data', chunk => {
        data += chunk.toString();
        // Process all complete lines (server sends "processing" status first, then embedding)
        let newlineIdx;
        while ((newlineIdx = data.indexOf('\n')) !== -1) {
          const line = data.slice(0, newlineIdx);
          data = data.slice(newlineIdx + 1);
          try {
            const parsed = JSON.parse(line);
            // Skip "processing" heartbeat - model is still loading
            if (parsed.status === 'processing') {
              ui.setSubStatus(`⏳ Processing... (${elapsed}s)`);
              continue;
            }
            // Got actual response - model is ready!
            client.destroy();
            stopProgressAnimation();

            if (parsed.embedding || parsed.embeddings) {
              warmupLatency = Date.now() - warmupStart;
              ui.setStatus('Embedding model ready!');
              ui.setSubStatus(`⚡ Model loaded in ${Math.round(warmupLatency/1000)}s`);
              ui.setSubProgress(1);
              resolve(parsed);
            } else if (parsed.error) {
              reject(new Error(parsed.error));
            } else {
              reject(new Error('Invalid response format'));
            }
            return;
          } catch (e) {
            // Not valid JSON, keep waiting
          }
        }
      });

      client.on('error', (err) => {
        stopProgressAnimation();
        reject(err);
      });

      // Only timeout after 5 minutes as safety limit (not the normal case)
      setTimeout(() => {
        if (client.connecting || client.readable) {
          client.destroy();
          stopProgressAnimation();
          reject(new Error('Model loading exceeded 5 minutes'));
        }
      }, 300000);
    });

  } catch (e) {
    ui.setSubStatus(`⚠️ Warmup failed: ${e.message}`);
  }

  await qqms();

  // TODO: Feed overflow queue with codebase data (future enhancement)
  // const filesIndexed = codebaseResult?.filesIndexed || 0;
  // ui.setStatus(`Feeding ${filesIndexed} files to overflow queue...`);

  return {
    serverRunning: true,
    warmupLatency,
    timeoutConfig,
    dockerLatency
  };
}

// ============================================================================
// STAGE 3: CODEBASE INDEXING
// ============================================================================
// This stage indexes the codebase with embeddings so find_code_pointers works
// from the start. Previously, indexing only happened when MCP server started,
// which meant the first  session had no code search capability.

// CRITICAL BUG FIX: Track the PID of the embedding server spawned by THIS init
// process. killExistingEmbeddingServer() must NEVER kill our own child.
// Without this, the init process spawns the server, the server writes its PID
// to embedding.pid, and then a later call to killExistingEmbeddingServer()
// reads that PID file and SIGTERMs our own child process.
let spawnedEmbeddingPid = null;

async function indexCodebase(projectPath, ui, embeddingResult) {
  ui.setStage(5, 'CODEBASE INDEXING');

  const { Pool } = require('pg');
  const crypto = require('crypto');
  const net = require('net');
  const { v4: uuidv4 } = require('uuid');

  const results = {
    filesScanned: 0,
    filesIndexed: 0,
    filesSkipped: 0,
    definitionsExtracted: 0,
    embeddingsGenerated: 0,
    errors: [],
    durationMs: 0
  };

  const startTime = Date.now();

  initLog('=== CODEBASE INDEXING STARTED ===');

  // Get socket path for embedding server
  // CRITICAL FIX: Check PROJECT socket FIRST (fresh from Docker stage 4), then shared socket as fallback
  const projectSocketPath = path.join(projectPath, 'specmem', 'sockets', 'embeddings.sock');
  const userId = process.getuid ? process.getuid() : 'default';
  const sharedSocketPath = path.join(os.tmpdir(), `specmem-embed-${userId}.sock`);

  initLog(`Socket paths: project=${projectSocketPath}, shared=${sharedSocketPath}`);
  initLog(`Project socket exists: ${fs.existsSync(projectSocketPath)}, Shared socket exists: ${fs.existsSync(sharedSocketPath)}`);

  // SOCKET LIVENESS CHECK - validate socket is alive, not just that file exists
  // Orphaned socket files (process died, socket file remains) cause ECONNREFUSED
  // and stall the entire indexing pipeline.
  function quickSocketAlive(sockPath) {
    return new Promise((resolve) => {
      const client = new net.Socket();
      const timeout = setTimeout(() => { client.destroy(); resolve(false); }, 3000);
      client.on('connect', () => { clearTimeout(timeout); client.destroy(); resolve(true); });
      client.on('error', () => { clearTimeout(timeout); client.destroy(); resolve(false); });
      client.connect(sockPath);
    });
  }

  // DYNAMIC READINESS POLLING — no hardcoded timeouts.
  // Polls for socket file + health check with adaptive intervals.
  // Starts fast (500ms), slows down after 10s (2s intervals).
  // Max wait: 300s (5 minutes). Returns true if server is ready.
  const MAX_EMBED_WAIT_MS = 300000; // 5 minute absolute cap
  async function waitForEmbeddingReady(sockPath, opts = {}) {
    const { ui: _ui, label = 'server', logFn = initLog } = opts;
    const start = Date.now();
    let pollInterval = 500;   // start fast
    let lastLogTime = 0;

    while (Date.now() - start < MAX_EMBED_WAIT_MS) {
      const elapsed = Date.now() - start;

      // Phase 1: Wait for socket FILE to appear
      if (!fs.existsSync(sockPath)) {
        if (elapsed - lastLogTime > 5000) {
          const elapsedSec = Math.round(elapsed / 1000);
          if (_ui) _ui.setSubStatus(`Waiting for ${label} socket... (${elapsedSec}s)`);
          logFn(`[EMBED] Waiting for socket file: ${sockPath} (${elapsedSec}s elapsed)`);
          lastLogTime = elapsed;
        }
        await new Promise(r => setTimeout(r, pollInterval));
        if (elapsed > 10000) pollInterval = Math.min(pollInterval + 250, 2000);
        continue;
      }

      // Phase 2: Socket file exists — check if server is actually responding
      const alive = await quickSocketAlive(sockPath);
      if (alive) {
        const elapsedSec = Math.round((Date.now() - start) / 1000);
        logFn(`[EMBED] ${label} ready after ${elapsedSec}s`);
        if (_ui) _ui.setSubStatus(`✓ ${label} ready (${elapsedSec}s)`);
        return true;
      }

      // Socket exists but not responding yet — server still warming up
      if (elapsed - lastLogTime > 3000) {
        const elapsedSec = Math.round(elapsed / 1000);
        if (_ui) _ui.setSubStatus(`${label} warming up... (${elapsedSec}s)`);
        lastLogTime = elapsed;
      }
      await new Promise(r => setTimeout(r, pollInterval));
      if (elapsed > 10000) pollInterval = Math.min(pollInterval + 250, 2000);
    }

    const totalSec = Math.round((Date.now() - start) / 1000);
    logFn(`[EMBED] ${label} failed to become ready after ${totalSec}s (max ${MAX_EMBED_WAIT_MS / 1000}s)`);
    if (_ui) _ui.setSubStatus(`⚠️ ${label} not ready after ${totalSec}s`);
    return false;
  }

  // Project socket takes priority - it's the fresh one from Docker stage 4
  let activeSocketPath = null;
  if (fs.existsSync(projectSocketPath)) {
    const alive = await quickSocketAlive(projectSocketPath);
    if (alive) {
      activeSocketPath = projectSocketPath;
      initLog(`Using PROJECT socket: ${projectSocketPath} (verified alive)`);
    } else {
      // CRITICAL FIX: Don't remove socket if our spawned server owns it.
      // Check the PID file to see if this socket belongs to our child process.
      const pidFile = path.join(projectPath, 'specmem', 'sockets', 'embedding.pid');
      let ownedByUs = false;
      if (spawnedEmbeddingPid) {
        try {
          if (fs.existsSync(pidFile)) {
            const pidContent = fs.readFileSync(pidFile, 'utf8').trim();
            const filePid = parseInt(pidContent.split(':')[0], 10);
            if (filePid === spawnedEmbeddingPid) {
              ownedByUs = true;
              initLog(`PROJECT socket not yet responsive but owned by our spawned PID ${spawnedEmbeddingPid} - keeping socket, server may still be warming up`);
              activeSocketPath = projectSocketPath; // Trust our child, it's just warming up
            }
          }
        } catch { /* ignore */ }
      }
      if (!ownedByUs) {
        initLog(`PROJECT socket exists but DEAD (ECONNREFUSED) - removing orphaned socket: ${projectSocketPath}`);
        try { fs.unlinkSync(projectSocketPath); } catch {}
      }
    }
  }
  if (!activeSocketPath && fs.existsSync(sharedSocketPath)) {
    const alive = await quickSocketAlive(sharedSocketPath);
    if (alive) {
      activeSocketPath = sharedSocketPath;
      initLog(`Using SHARED socket: ${sharedSocketPath} (verified alive)`);
    } else {
      initLog(`SHARED socket exists but DEAD - removing orphaned socket: ${sharedSocketPath}`);
      try { fs.unlinkSync(sharedSocketPath); } catch {}
    }
  }
  if (!activeSocketPath) {
    initLog('WARNING: No live embedding socket found! Will spawn new server.');
  }

  // Check if embedding server is available from Stage 4
  const serverRunning = embeddingResult?.serverRunning || false;
  const socketExists = activeSocketPath !== null;

  // Helper: Kill any existing embedding server for this project before spawning a new one
  // CRITICAL FIX: Never kill a server that was spawned by THIS init process.
  // The spawnedEmbeddingPid variable tracks our child's PID to prevent self-kill.
  function killExistingEmbeddingServer(projectPath) {
    const pidFile = path.join(projectPath, 'specmem', 'sockets', 'embedding.pid');
    try {
      if (!fs.existsSync(pidFile)) return false;
      const content = fs.readFileSync(pidFile, 'utf8').trim();
      const pid = parseInt(content.split(':')[0], 10);
      if (!pid || isNaN(pid)) return false;

      // CRITICAL FIX: Never kill our own child process!
      // This prevents the race condition where:
      // 1. Init spawns embedding server
      // 2. Server writes PID to embedding.pid
      // 3. Later code path calls killExistingEmbeddingServer()
      // 4. It reads the PID file and kills our own child
      if (spawnedEmbeddingPid && pid === spawnedEmbeddingPid) {
        initLog(`[EMBED] Skipping kill of PID ${pid} - this is OUR spawned server`);
        return false;
      }

      // Check if process is alive
      try { process.kill(pid, 0); } catch {
        // Process dead, clean up PID file
        try { fs.unlinkSync(pidFile); } catch {}
        return false;
      }
      // Process alive — kill it gracefully
      initLog(`[EMBED] Killing existing embedding server PID ${pid} before respawn`);
      process.kill(pid, 'SIGTERM');
      // Wait up to 3 seconds for it to die
      for (let i = 0; i < 6; i++) {
        const { execSync } = require('child_process');
        try { execSync(`sleep 0.5`); } catch {}
        try { process.kill(pid, 0); } catch { return true; } // Dead
      }
      // Force kill if still alive
      try { process.kill(pid, 'SIGKILL'); } catch {}
      try { fs.unlinkSync(pidFile); } catch {}
      return true;
    } catch (e) {
      initLog(`[EMBED] PID file check error: ${e.message}`);
      return false;
    }
  }

  // CRITICAL: If no embedding server, START IT NOW - never skip embeddings!
  if (!serverRunning && !socketExists) {
    ui.setStatus('Starting embedding server...');
    ui.setSubStatus('No socket found - launching Python embedding server');

    // USE PYTHON DIRECTLY - frankenstein-embeddings.py has built-in torch.set_num_threads()
    // for CPU control, no need for external cpulimit wrapper
    const possiblePythonPaths = [
      path.join(__dirname, '..', 'embedding-sandbox', 'frankenstein-embeddings.py'),
      path.join(projectPath, 'embedding-sandbox', 'frankenstein-embeddings.py'),
      '/opt/specmem/embedding-sandbox/frankenstein-embeddings.py'
    ];

    let embeddingScript = null;

    // Find frankenstein-embeddings.py
    for (const p of possiblePythonPaths) {
      if (fs.existsSync(p)) {
        embeddingScript = p;
        break;
      }
    }

    if (embeddingScript) {
      // Start the embedding server directly with Python
      const { spawn } = require('child_process');
      const socketsDir = path.join(projectPath, 'specmem', 'sockets');
      safeMkdir(socketsDir);

      // Kill any existing embedding server before spawning a new one
      // Reset spawnedEmbeddingPid since we're about to spawn a replacement
      spawnedEmbeddingPid = null;
      killExistingEmbeddingServer(projectPath);

      // Clean up stale socket
      if (fs.existsSync(projectSocketPath)) {
        try {
          fs.unlinkSync(projectSocketPath);
        } catch (e) {
          // yooo socket cleanup failed - embedding might complain but we try anyway
          initLog('[EMBED] stale socket cleanup failed: ' + e.message);
        }
      }

      // Use Python directly - built-in thread limiting via torch.set_num_threads()
      initLog('[EMBED] Starting frankenstein-embeddings.py directly');
      const pythonPath = getPythonPath();

      // Redirect stdout/stderr to log file instead of piping
      // CRITICAL: Piped stdio keeps a reference to the child process even after unref(),
      // which can cause SIGTERM/SIGPIPE when the parent's event loop is under heavy load
      // (e.g. during batch embedding). Using 'ignore' or file descriptors prevents this.
      const embedLogPath = path.join(projectPath, 'specmem', 'sockets', 'embedding-autostart.log');
      const embedLogFd = fs.openSync(embedLogPath, 'a');

      const embeddingProcess = spawn(pythonPath, [embeddingScript], {
        cwd: path.dirname(embeddingScript),
        env: {
          ...process.env,
          SPECMEM_EMBEDDING_SOCKET: projectSocketPath,
          SPECMEM_SOCKET_PATH: projectSocketPath,
          SPECMEM_PROJECT_PATH: projectPath
        },
        detached: true,
        stdio: ['ignore', embedLogFd, embedLogFd]
      });

      // CRITICAL FIX: Track spawned PID so killExistingEmbeddingServer() won't kill it
      spawnedEmbeddingPid = embeddingProcess.pid;
      initLog(`[EMBED] Spawned embedding server with PID ${spawnedEmbeddingPid} - tracking to prevent self-kill`);

      // error handler BEFORE unref - prevents silent spawn failures
      embeddingProcess.on('error', (err) => {
        ui.setSubStatus('Embedding spawn error: ' + err.message);
      });

      // Close the fd in the parent so only the child holds it
      fs.closeSync(embedLogFd);

      embeddingProcess.unref();

      // DYNAMIC WAIT: Poll for socket + health check with adaptive intervals (max 5min)
      ui.setSubStatus('Waiting for embedding server to start...');
      const serverReady = await waitForEmbeddingReady(projectSocketPath, { ui, label: 'Embedding server' });
      if (serverReady) {
        activeSocketPath = projectSocketPath;
      }

      if (!activeSocketPath) {
        ui.setSubStatus('⚠️ Embedding server failed to start after 60s - continuing without');
      }
    } else {
      ui.setSubStatus('⚠️ No embedding script found - continuing without');
    }
    await qqms();
  } else {
    ui.setSubStatus(`Using socket: ${activeSocketPath ? path.basename(path.dirname(activeSocketPath)) : 'none'}/embeddings.sock`);
  }

  // Test connection to verify socket is responding
  if (activeSocketPath) {
    ui.setStatus('Testing embedding server connection...');
    try {
      const testResult = await new Promise((resolve, reject) => {
        const testClient = new net.Socket();
        let testData = '';
        testClient.setTimeout(TIMEOUTS.CONNECTION_TEST);
        testClient.connect(activeSocketPath, () => {
          // yooo MUST include type:'embed' - server requires this format fr
          testClient.write(JSON.stringify({ type: 'embed', text: 'test connection' }) + '\n');
        });
        testClient.on('data', chunk => {
          testData += chunk.toString();
          // yooo handle heartbeats - server sends {"status":"processing"} FIRST
          let newlineIdx;
          while ((newlineIdx = testData.indexOf('\n')) !== -1) {
            const completeLine = testData.slice(0, newlineIdx);
            testData = testData.slice(newlineIdx + 1);
            try {
              const parsed = JSON.parse(completeLine);
              // skip heartbeat/processing status - keep waiting
              if (parsed.status === 'processing') {
                continue;
              }
              // got actual response - check if embedding was returned
              testClient.destroy();
              if (parsed.embedding && Array.isArray(parsed.embedding)) {
                resolve(true);
              } else if (parsed.error) {
                reject(new Error(parsed.error));
              } else {
                resolve(true); // any non-heartbeat response is fine for connectivity test
              }
              return;
            } catch (e) {
              // JSON parse error - keep buffering
            }
          }
        });
        testClient.on('error', e => { testClient.destroy(); reject(e); });
        testClient.on('timeout', () => { testClient.destroy(); reject(new Error('timeout')); });
      });
      ui.setSubStatus('✓ Embedding server responding');
      initLog('Embedding socket test passed');
    } catch (e) {
      ui.setSubStatus(`⚠️ Socket test failed: ${e.message} - retrying...`);
      initLog(`Embedding socket test FAILED: ${e.message} - will retry before killing`, e);

      // DYNAMIC READINESS POLL: Don't immediately kill — poll with adaptive intervals (max 5min)
      const recovered = await waitForEmbeddingReady(activeSocketPath, { ui, label: 'Embedding server warmup' });

      if (recovered) {
        // Server is alive after retries - continue to indexing
      } else {
      // Server truly dead after 15s of retries - now kill and restart
      // If this is our spawned server, it's been unresponsive for 15s - allow the kill
      // by resetting spawnedEmbeddingPid (we're giving up on it)
      initLog('Attempting socket recovery - cleaning stale socket and restarting server...');
      ui.setStatus('Recovering embedding server...');

      // Reset PID tracking since we're abandoning this server
      spawnedEmbeddingPid = null;
      killExistingEmbeddingServer(projectPath);

      // Clean up the stale socket file
      try {
        if (fs.existsSync(projectSocketPath)) {
          fs.unlinkSync(projectSocketPath);
          initLog(`Cleaned up stale socket: ${projectSocketPath}`);
        }
      } catch (cleanErr) {
        initLog(`Failed to clean stale socket: ${cleanErr.message}`);
      }

      // DOCKER DISABLED: Recovery uses native Python via MCP health monitor
      initLog('Docker recovery disabled - MCP health monitor will restart native Python server');
      activeSocketPath = null;
    } // end else (server truly dead after retries)
    } // end catch
    await qqms();
  }

  // Database connection
  ui.setStatus('Connecting to database...');
  const dbName = process.env.SPECMEM_DB_NAME || 'specmem_westayunprofessional';
  const dbUser = process.env.SPECMEM_DB_USER || 'specmem_westayunprofessional';
  const dbPass = process.env.SPECMEM_DB_PASSWORD || 'specmem_westayunprofessional';
  const dbHost = process.env.SPECMEM_DB_HOST || 'localhost';
  const dbPort = process.env.SPECMEM_DB_PORT || 5432;

  initLog(`Database config: host=${dbHost}, port=${dbPort}, db=${dbName}, user=${dbUser}`);

  let pool;
  try {
    pool = new Pool({
      database: dbName,
      user: dbUser,
      password: dbPass,
      host: dbHost,
      port: dbPort,
      max: 3,
      connectionTimeoutMillis: TIMEOUTS.DB_CONNECTION
    });
    // yooo CRITICAL - capture pg notices so they dont write to stdout during ProgressUI
    pool.on('notice', (msg) => initLog('[PG-NOTICE] ' + (msg.message || msg)));
    pool.on('error', (err) => initLog('[PG-ERROR] ' + (err.message || err)));
    await pool.query('SELECT 1');
    initLog('Database connection test passed');

    // CRITICAL FIX: Create and set search_path to project schema for proper isolation
    const schemaName = 'specmem_' + path.basename(projectPath).toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

    // Create schema if it doesn't exist
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
    initLog(`Project schema ensured: ${schemaName}`);

    // Set search_path for ALL pool connections (not just the current one)
    // pool.query() checks out different connections; SET only affects one.
    // Using pool.on('connect') ensures every new connection gets the right search_path.
    pool.on('connect', (client) => {
      client.query(`SET search_path TO ${schemaName}, public`).catch(() => {});
    });
    // Also set it on the existing connection
    await pool.query(`SET search_path TO ${schemaName}, public`);
    initLog(`Database schema set to: ${schemaName}`);
    ui.setSubStatus(`Database connected (schema: ${schemaName})`);

    // Initialize schema tables from SQL file
    const schemaInitPath = path.join(__dirname, '..', 'dist', 'db', 'projectSchemaInit.sql');
    if (fs.existsSync(schemaInitPath)) {
      const schemaInitSql = fs.readFileSync(schemaInitPath, 'utf8');
      await pool.query(schemaInitSql);
      initLog(`Schema tables initialized from ${schemaInitPath}`);
    } else {
      initLog(`WARNING: Schema init SQL not found at ${schemaInitPath}`);
    }

    await qqms();
  } catch (e) {
    ui.setSubStatus(`Database error: ${e.message}`);
    results.errors.push(`DB: ${e.message}`);
    return results;
  }

  // yooo DRY PRINCIPLE - use shared codebase logic from the bridge
  // this eliminates duplication with src/codebase/ingestion.ts
  ui.setStatus('Scanning for source files...');

  let files = [];
  let fileLanguageMap = new Map(); // filePath -> language object

  const bridge = await getCodebaseBridge();
  if (bridge) {
    // Use the proper shared scanning logic from codebase-bridge.cjs
    // this uses SkipTheBoringShit exclusions and WhatLanguageIsThis detection
    try {
      const scannedFiles = await bridge.scanSourceFiles(projectPath, { maxDepth: 15 });
      files = scannedFiles.map(f => f.filePath);
      // store language info for later use
      for (const f of scannedFiles) {
        fileLanguageMap.set(f.filePath, f.language);
      }
    } catch (e) {
      // fallback to inline logic if bridge fails
      files = [];
    }
  }

  // fallback inline scanning if bridge not available or failed
  if (files.length === 0) {
    const codeExtensions = [
      '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
      '.py', '.pyi', '.go', '.rs', '.java', '.kt', '.scala',
      '.rb', '.php', '.c', '.cpp', '.h', '.hpp', '.swift'
    ];
    const excludeDirs = [
      'node_modules', '.git', 'dist', 'build', '__pycache__',
      '.next', '.venv', 'venv', 'env', '.cache', 'coverage',
      '.pytest_cache', '.mypy_cache', '.tox'
    ];
    const langMap = {
      '.ts': 'typescript', '.tsx': 'typescript-react',
      '.js': 'javascript', '.jsx': 'javascript-react',
      '.mjs': 'javascript', '.cjs': 'javascript',
      '.py': 'python', '.pyi': 'python',
      '.go': 'go', '.rs': 'rust',
      '.java': 'java', '.kt': 'kotlin', '.scala': 'scala',
      '.rb': 'ruby', '.php': 'php',
      '.c': 'c', '.cpp': 'cpp', '.h': 'c-header', '.hpp': 'cpp-header',
      '.swift': 'swift'
    };

    function findFiles(dir, depth = 0) {
      if (depth > 15) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (excludeDirs.includes(entry.name)) continue;
          if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;

          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            findFiles(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (codeExtensions.includes(ext)) {
              files.push(fullPath);
              // store inline language info
              fileLanguageMap.set(fullPath, { id: langMap[ext] || 'unknown', name: langMap[ext] || 'unknown' });
            }
          }
        }
      } catch (e) {
        // yooo file discovery failed for this dir - keep going tho
        if (process.env.SPECMEM_DEBUG) console.log('[INDEX] findFiles failed for ' + dir + ': ' + e.message);
      }
    }
    findFiles(projectPath);
  }

  results.filesScanned = files.length;
  initLog(`File discovery complete: ${files.length} source files found`);
  ui.setSubStatus(`Found ${files.length} source files`);
  await qqms();

  if (files.length === 0) {
    initLog('WARNING: No source files found - skipping codebase indexing');
    ui.setStatus('No source files found');
    await pool.end();
    return results;
  }

  // AUTO-CREATE codebase_files table if it doesn't exist
  // CRITICAL: Init must not depend on MCP migrations having run first
  // FIX: Use gen_random_uuid() (built-in PG13+) instead of uuid_generate_v4() (uuid-ossp extension)
  // The uuid-ossp extension is installed in specmem_specmem schema, NOT public,
  // so uuid_generate_v4() is unavailable when search_path is set to other project schemas.
  // Also ensure vector extension exists in public schema (accessible to all project schemas).
  try {
    // vector extension must be in public schema so all project schemas can use vector type
    await pool.query(`CREATE EXTENSION IF NOT EXISTS "vector" SCHEMA public`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS codebase_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        file_path TEXT NOT NULL,
        absolute_path TEXT NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        extension VARCHAR(50),
        language_id VARCHAR(50) NOT NULL DEFAULT 'unknown',
        language_name VARCHAR(100) NOT NULL DEFAULT 'Unknown',
        language_type VARCHAR(50) NOT NULL DEFAULT 'data',
        content TEXT NOT NULL,
        content_hash VARCHAR(64),
        size_bytes INTEGER NOT NULL DEFAULT 0,
        line_count INTEGER NOT NULL DEFAULT 0,
        char_count INTEGER NOT NULL DEFAULT 0,
        last_modified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        chunk_index INTEGER,
        total_chunks INTEGER,
        original_file_id UUID,
        embedding vector(384),
        project_path TEXT DEFAULT '/',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT content_not_empty CHECK (length(content) > 0)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_codebase_files_content_hash ON codebase_files(content_hash)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_codebase_files_path ON codebase_files(file_path)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_codebase_files_project_path_file ON codebase_files(file_path, project_path)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_codebase_files_project_path_hash ON codebase_files(project_path, content_hash)`);
    initLog('[CODEBASE] Table codebase_files ensured');
  } catch (e) {
    initLog(`[CODEBASE] Table ensure warning: ${e.message}`);
  }

  // Load existing hashes to skip unchanged files ONLY if they have embeddings
  // CRITICAL: Files without embeddings need to be re-indexed even if content matches!
  ui.setStatus('Checking existing index...');
  const existingHashes = new Map();
  let filesWithoutEmbeddings = 0;
  try {
    // Only skip files that have BOTH matching hash AND an embedding
    const hashResult = await pool.query(
      `SELECT file_path, content_hash, (embedding IS NOT NULL) as has_embedding
       FROM codebase_files WHERE project_path = $1 AND content_hash IS NOT NULL`,
      [projectPath]
    );
    for (const row of hashResult.rows) {
      if (row.has_embedding) {
        existingHashes.set(row.file_path, row.content_hash);
      } else {
        filesWithoutEmbeddings++;
      }
    }
    initLog(`Existing index: ${existingHashes.size} files with embeddings, ${filesWithoutEmbeddings} files missing embeddings`);
    ui.setSubStatus(`${existingHashes.size} indexed with embeddings, ${filesWithoutEmbeddings} need embeddings`);
  } catch (e) {
    initLog(`No existing index (fresh): ${e.message}`);
    ui.setSubStatus('Fresh index (no existing data)');
  }
  await qqms();

  // ============================================================================
  // BATCH EMBEDDING - SPEED OPTIMIZED
  // Instead of one socket connection per text, aggregate into batches
  // Server supports {type: 'batch_embed', texts: [...]} for 100+/s throughput
  // ============================================================================

  // ============================================================================
  // RELIABILITY IMPROVEMENTS - Socket health tracking and auto-recovery
  // ============================================================================

  // Track consecutive failures to detect dead socket
  let consecutiveEmbeddingFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  // Respawn backoff for revalidateSocket() — prevents rapid-fire restarts
  let lastRevalidateTime = 0;
  let revalidateBackoffMs = 1000; // Start at 1s, doubles each time up to 30s

  // FIX: Categorize embedding errors for better debugging and error tracking
  function categorizeEmbeddingError(error) {
    const msg = (error && error.message) ? error.message.toLowerCase() : '';
    if (msg.includes('timeout')) return 'TIMEOUT';
    if (msg.includes('socket') && msg.includes('not') && msg.includes('found')) return 'SOCKET_NOT_FOUND';
    if (msg.includes('socket') && msg.includes('closed')) return 'SOCKET_CLOSED';
    if (msg.includes('socket') || msg.includes('connect')) return 'SOCKET_ERROR';
    if (msg.includes('econnrefused')) return 'CONNECTION_REFUSED';
    if (msg.includes('econnreset')) return 'CONNECTION_RESET';
    if (msg.includes('epipe') || msg.includes('broken pipe')) return 'BROKEN_PIPE';
    if (msg.includes('json') || msg.includes('parse')) return 'JSON_PARSE';
    if (msg.includes('embedding') && msg.includes('invalid')) return 'INVALID_RESPONSE';
    if (msg.includes('server') && msg.includes('error')) return 'SERVER_ERROR';
    if (msg.includes('overload') || msg.includes('busy')) return 'SERVER_OVERLOAD';
    return 'UNKNOWN';
  }

  // Socket health check helper - verifies socket is alive before use
  async function checkSocketHealth() {
    if (!activeSocketPath || !fs.existsSync(activeSocketPath)) {
      return false;
    }
    return new Promise((resolve) => {
      const client = new net.Socket();
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          client.destroy();
          resolve(false);
        }
      }, 2000); // 2s health check timeout

      client.on('connect', () => {
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          // Send health check request
          client.write(JSON.stringify({ type: 'health' }) + '\n');
        }
      });

      client.on('data', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          client.destroy();
          resolve(true);
        }
      });

      client.on('error', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          client.destroy();
          resolve(false);
        }
      });

      client.on('close', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(false);
        }
      });

      try {
        client.connect(activeSocketPath);
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(false);
        }
      }
    });
  }

  // Revalidate socket path after failures (may have been restarted externally)
  async function revalidateSocket() {
    // Backoff: prevent rapid-fire revalidation/respawn loops
    const now = Date.now();
    const timeSinceLastRevalidate = now - lastRevalidateTime;
    if (timeSinceLastRevalidate < revalidateBackoffMs) {
      initLog(`[EMBED] Revalidation throttled (${revalidateBackoffMs}ms backoff, ${timeSinceLastRevalidate}ms elapsed)`);
      return false;
    }
    lastRevalidateTime = now;
    revalidateBackoffMs = Math.min(revalidateBackoffMs * 2, 30000);

    const projectSocketPath = path.join(projectPath, 'specmem', 'sockets', 'embeddings.sock');
    const projDirName = path.basename(projectPath).replace(/[^a-zA-Z0-9_-]/g, '_');
    const sharedSocketPath = path.join(os.homedir(), '.specmem', projDirName, 'sockets', 'embeddings.sock');

    // Check project socket first (preferred)
    if (fs.existsSync(projectSocketPath)) {
      activeSocketPath = projectSocketPath;
      const healthy = await checkSocketHealth();
      if (healthy) {
        initLog(`Revalidated socket: using project socket at ${projectSocketPath}`);
        consecutiveEmbeddingFailures = 0;
        revalidateBackoffMs = 1000;
        return true;
      }
    }

    // Fallback to shared socket (home dir)
    if (fs.existsSync(sharedSocketPath)) {
      activeSocketPath = sharedSocketPath;
      const healthy = await checkSocketHealth();
      if (healthy) {
        initLog(`Revalidated socket: using shared socket at ${sharedSocketPath}`);
        consecutiveEmbeddingFailures = 0;
        revalidateBackoffMs = 1000;
        return true;
      }
    }

    // Fallback to /tmp shared sockets
    for (let i = 0; i < 5; i++) {
      const tmpSocket = `/tmp/specmem-embed-${i}.sock`;
      if (fs.existsSync(tmpSocket)) {
        activeSocketPath = tmpSocket;
        const healthy = await checkSocketHealth();
        if (healthy) {
          initLog(`Revalidated socket: using /tmp shared socket at ${tmpSocket}`);
          consecutiveEmbeddingFailures = 0;
          revalidateBackoffMs = 1000;
          return true;
        }
      }
    }

    // AUTO-RESTART: If no socket found, try restarting the embedding server
    initLog('Socket revalidation: no socket found, attempting auto-restart of embedding server...');
    try {
      const { spawn } = require('child_process');
      const possiblePythonPaths = [
        path.join(__dirname, '..', 'embedding-sandbox', 'frankenstein-embeddings.py'),
        path.join(projectPath, 'embedding-sandbox', 'frankenstein-embeddings.py'),
        '/opt/specmem/embedding-sandbox/frankenstein-embeddings.py'
      ];
      let embeddingScript = null;
      for (const p of possiblePythonPaths) {
        if (fs.existsSync(p)) { embeddingScript = p; break; }
      }
      if (embeddingScript) {
        const socketsDir = path.join(projectPath, 'specmem', 'sockets');
        if (!fs.existsSync(socketsDir)) fs.mkdirSync(socketsDir, { recursive: true });
        // Kill any existing embedding server before respawn
        // Reset spawnedEmbeddingPid since we're about to spawn a replacement
        spawnedEmbeddingPid = null;
        killExistingEmbeddingServer(projectPath);
        // Clean stale socket
        if (fs.existsSync(projectSocketPath)) {
          try { fs.unlinkSync(projectSocketPath); } catch { /* ignore */ }
        }
        const pythonPath = getPythonPath();
        // CRITICAL: Use file descriptor stdio, NOT pipes. Piped stdio causes SIGTERM
        // when parent event loop is under heavy load during batch indexing.
        const revalLogPath = path.join(projectPath, 'specmem', 'sockets', 'embedding-autostart.log');
        const revalLogFd = fs.openSync(revalLogPath, 'a');
        const proc = spawn(pythonPath, [embeddingScript], {
          cwd: path.dirname(embeddingScript),
          env: { ...process.env, SPECMEM_EMBEDDING_SOCKET: projectSocketPath, SPECMEM_SOCKET_PATH: projectSocketPath, SPECMEM_PROJECT_PATH: projectPath },
          detached: true,
          stdio: ['ignore', revalLogFd, revalLogFd]
        });
        // CRITICAL FIX: Track spawned PID so killExistingEmbeddingServer() won't kill it
        spawnedEmbeddingPid = proc.pid;
        initLog(`[EMBED] Revalidation spawned embedding server with PID ${spawnedEmbeddingPid} - tracking to prevent self-kill`);
        proc.on('error', () => {});
        fs.closeSync(revalLogFd);
        proc.unref();
        // DYNAMIC WAIT: Poll for readiness with adaptive intervals (max 5min)
        const revalReady = await waitForEmbeddingReady(projectSocketPath, { label: 'Revalidation restart' });
        if (revalReady) {
          activeSocketPath = projectSocketPath;
          initLog(`Embedding server auto-restarted successfully, socket at ${projectSocketPath}`);
          consecutiveEmbeddingFailures = 0;
          revalidateBackoffMs = 1000;
          return true;
        }
        initLog('Embedding server auto-restart: server did not become ready');
      }
    } catch (restartErr) {
      initLog(`Embedding server auto-restart failed: ${restartErr.message || restartErr}`);
    }

    initLog('Socket revalidation failed: no healthy socket found');
    return false;
  }

  // Batch embedding function - processes multiple texts in one request
  async function generateBatchEmbeddings(texts) {
    if (!activeSocketPath || !texts || texts.length === 0) {
      return texts.map(() => null);
    }

    // RELIABILITY FIX: Check if socket file exists before attempting connection
    if (!fs.existsSync(activeSocketPath)) {
      initLog(`Batch embedding: socket file missing at ${activeSocketPath}`);
      const revalidated = await revalidateSocket();
      if (!revalidated) {
        initLog('Batch embedding: no valid socket found, returning nulls');
        return texts.map(() => null);
      }
    }

    const maxRetries = 3; // Increased from 2 for better reliability
    let lastError = null;

    // FIX: Track concurrent connections to avoid overwhelming the server
    const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB max buffer to prevent memory issues

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // FIX: Pre-flight socket check before each attempt
        if (!fs.existsSync(activeSocketPath)) {
          initLog(`Batch attempt ${attempt}: Socket file missing, revalidating...`);
          const revalidated = await revalidateSocket();
          if (!revalidated) {
            throw new Error('Socket not available - server may have restarted');
          }
        }

        const result = await new Promise((resolve, reject) => {
          const client = new net.Socket();
          let data = '';
          let settled = false; // RELIABILITY FIX: Prevent multiple resolve/reject calls
          let heartbeatCount = 0; // Track heartbeats to detect server overload
          const HEARTBEAT_LIMIT = 30; // If we get 30 heartbeats, server is overloaded

          client.setTimeout(TIMEOUTS.EMBEDDING_REQUEST * 2); // Longer timeout for batch

          // HARD WALL-CLOCK TIMEOUT: Cannot be reset by data/heartbeats
          // Prevents infinite hangs on large files where server keeps sending heartbeats
          const HARD_TIMEOUT_MS = TIMEOUTS.EMBEDDING_REQUEST * 3; // 270s absolute max
          const hardTimeout = setTimeout(() => {
            if (!settled) {
              settled = true;
              if (!client.destroyed) client.destroy();
              reject(new Error(`Hard wall-clock timeout after ${HARD_TIMEOUT_MS}ms - embedding took too long (heartbeats: ${heartbeatCount})`));
            }
          }, HARD_TIMEOUT_MS);

          // Cleanup helper to avoid leaked resources
          const cleanup = () => {
            clearTimeout(hardTimeout);
            if (!client.destroyed) client.destroy();
          };

          client.connect(activeSocketPath, () => {
            // Use batch_embed protocol - server returns {embeddings: [[...], [...], ...]}
            const truncatedTexts = texts.map(t => (t || '').slice(0, MAX_EMBED_CHARS));
            client.write(JSON.stringify({ type: 'batch_embed', texts: truncatedTexts }) + '\n');
          });

          client.on('data', chunk => {
            if (settled) return;
            data += chunk.toString();

            // FIX: Prevent runaway buffer growth from malformed responses
            if (data.length > MAX_BUFFER_SIZE) {
              settled = true;
              cleanup();
              reject(new Error('Response buffer overflow - malformed server response'));
              return;
            }

            let newlineIdx;
            while ((newlineIdx = data.indexOf('\n')) !== -1) {
              const completeLine = data.slice(0, newlineIdx);
              data = data.slice(newlineIdx + 1);

              // FIX: Skip empty lines that can occur during server restart
              if (!completeLine.trim()) continue;

              try {
                const parsed = JSON.parse(completeLine);

                // FIX: Track heartbeats to detect server backpressure/overload
                if (parsed.status === 'processing') {
                  heartbeatCount++;
                  if (heartbeatCount > HEARTBEAT_LIMIT) {
                    settled = true;
                    cleanup();
                    reject(new Error('Server overload detected - too many processing heartbeats'));
                    return;
                  }
                  continue;
                }

                if (settled) return;
                settled = true;
                cleanup();

                if (parsed.error) {
                  reject(new Error('Batch embedding error: ' + parsed.error));
                  return;
                }
                // Server returns {embeddings: [[...], [...], ...]}
                const embeddings = parsed.embeddings || parsed;
                if (!Array.isArray(embeddings)) {
                  reject(new Error('Invalid batch response: expected array, got ' + typeof embeddings));
                  return;
                }

                // FIX: Validate response length matches request length
                if (embeddings.length !== texts.length) {
                  initLog(`Batch response mismatch: got ${embeddings.length}, expected ${texts.length}`);
                  // Pad or truncate to match - don't fail
                  while (embeddings.length < texts.length) embeddings.push(null);
                  if (embeddings.length > texts.length) embeddings.length = texts.length;
                }

                resolve(embeddings);
                return;
              } catch (e) {
                // FIX: Better handling of partial JSON - check if it looks like valid JSON start
                if (!completeLine.startsWith('{') && !completeLine.startsWith('[')) {
                  // Not JSON at all - might be server log output, skip it
                  if (process.env.SPECMEM_DEBUG) initLog(`Skipping non-JSON line: ${completeLine.slice(0, 50)}...`);
                  continue;
                }
                // Otherwise keep buffering - might be incomplete
              }
            }
          });

          // RELIABILITY FIX: Handle unexpected close before response
          client.on('close', hadError => {
            if (!settled) {
              settled = true;
              reject(new Error(`Socket closed unexpectedly${hadError ? ' with error' : ''} before batch response (data received: ${data.length} bytes)`));
            }
          });

          client.on('error', e => {
            if (!settled) {
              settled = true;
              cleanup();
              reject(new Error(`Socket error: ${e.message}`));
            }
          });

          client.on('timeout', () => {
            if (!settled) {
              settled = true;
              cleanup();
              reject(new Error(`Batch embedding timeout after ${TIMEOUTS.EMBEDDING_REQUEST * 2}ms - socket may be unresponsive (heartbeats: ${heartbeatCount})`));
            }
          });
        });

        // Reset failure counter on success
        consecutiveEmbeddingFailures = 0;
        return result;
      } catch (err) {
        lastError = err;
        consecutiveEmbeddingFailures++;

        // FIX: Log error type for debugging
        const errorType = categorizeEmbeddingError(err);
        if (process.env.SPECMEM_DEBUG) initLog(`Batch attempt ${attempt} failed (${errorType}): ${err.message}`);

        // Revalidate socket after consecutive failures
        if (consecutiveEmbeddingFailures >= MAX_CONSECUTIVE_FAILURES) {
          initLog(`Batch embedding: ${consecutiveEmbeddingFailures} consecutive failures, revalidating socket...`);
          await revalidateSocket();
        }

        // FIX: Different backoff strategies based on error type
        if (attempt < maxRetries) {
          let backoffMs = Math.pow(2, attempt) * 100;
          // Server overload or timeout - wait longer
          if (errorType === 'SERVER_OVERLOAD' || errorType === 'TIMEOUT') {
            backoffMs = Math.pow(2, attempt) * 500; // 5x longer backoff
          }
          await new Promise(r => setTimeout(r, backoffMs));
        }
      }
    }

    // Batch failed - return nulls
    initLog(`Batch embedding failed after ${maxRetries} attempts: ${lastError?.message}`);
    return texts.map(() => null);
  }

  // Single embedding fallback (for compatibility)
  async function generateEmbedding(text) {
    // If no socket available, return null (no embedding)
    if (!activeSocketPath) {
      return null;
    }

    // FIX: Validate input before attempting embedding
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      if (process.env.SPECMEM_DEBUG) initLog('Single embedding: skipping empty/invalid text');
      return null;
    }

    // RELIABILITY FIX: Check if socket file exists before attempting connection
    if (!fs.existsSync(activeSocketPath)) {
      if (process.env.SPECMEM_DEBUG) initLog(`Single embedding: socket file missing at ${activeSocketPath}`);
      const revalidated = await revalidateSocket();
      if (!revalidated) {
        return null; // Can't generate embedding without socket
      }
    }

    const maxRetries = 3; // Increased from 2 for better reliability
    let lastError = null;
    const MAX_BUFFER_SIZE = 1024 * 1024; // 1MB max for single embedding response

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // FIX: Pre-flight socket check each attempt (socket may have been removed between retries)
        if (!fs.existsSync(activeSocketPath)) {
          if (process.env.SPECMEM_DEBUG) initLog(`Single attempt ${attempt}: Socket disappeared, revalidating...`);
          const revalidated = await revalidateSocket();
          if (!revalidated) {
            throw new Error('Socket not available - server may have restarted');
          }
        }

        const result = await new Promise((resolve, reject) => {
          const client = new net.Socket();
          let data = '';
          let settled = false; // RELIABILITY FIX: Prevent multiple resolve/reject calls
          let heartbeatCount = 0;
          client.setTimeout(TIMEOUTS.EMBEDDING_REQUEST);

          // Cleanup helper to avoid leaked resources
          const cleanup = () => {
            if (!client.destroyed) client.destroy();
          };

          client.connect(activeSocketPath, () => {
            // type:'embed' is required - server expects this format
            client.write(JSON.stringify({ type: 'embed', text: text.slice(0, MAX_EMBED_CHARS) }) + '\n');
          });

          client.on('data', chunk => {
            if (settled) return;
            data += chunk.toString();

            // FIX: Prevent buffer overflow from malformed responses
            if (data.length > MAX_BUFFER_SIZE) {
              settled = true;
              cleanup();
              reject(new Error('Single embedding response buffer overflow'));
              return;
            }

            // TCP can split responses - process ALL complete lines before newline
            // Server sends heartbeat {"status":"processing"} FIRST, then actual embedding
            let newlineIdx;
            while ((newlineIdx = data.indexOf('\n')) !== -1) {
              const completeLine = data.slice(0, newlineIdx);
              data = data.slice(newlineIdx + 1); // consume the line

              // FIX: Skip empty lines
              if (!completeLine.trim()) continue;

              try {
                const parsed = JSON.parse(completeLine);

                // Skip heartbeat/processing status - keep waiting for actual embedding
                // FIX: Track heartbeats to detect server overload
                if (parsed.status === 'processing') {
                  heartbeatCount++;
                  if (heartbeatCount > 20) { // Single embed shouldn't take this long
                    settled = true;
                    cleanup();
                    reject(new Error('Single embedding overload - too many heartbeats'));
                    return;
                  }
                  continue; // wait for next message
                }

                if (settled) return;
                settled = true;
                cleanup();

                // Check for error response FIRST before dangerous fallback
                if (parsed.error) {
                  reject(new Error('Embedding server error: ' + (parsed.error || 'unknown')));
                  return;
                }
                // validate embedding is actually an array, not random object
                const embedding = Array.isArray(parsed.embedding) ? parsed.embedding :
                                  Array.isArray(parsed) ? parsed : null;
                if (!embedding) {
                  reject(new Error('Invalid embedding response: expected array, got ' + typeof (parsed.embedding || parsed)));
                  return;
                }
                // Validate embedding has reasonable dimensions (32-4096)
                // Server can return different dimensions if TARGET_DIM is set
                if (embedding.length < 32 || embedding.length > 4096) {
                  initLog(`Invalid embedding dimensions: got ${embedding.length}, expected 32-4096`);
                  resolve(null);
                  return;
                }
                resolve(embedding);
                return; // done processing
              } catch (e) {
                // FIX: Better handling of non-JSON output
                if (!completeLine.startsWith('{') && !completeLine.startsWith('[')) {
                  if (process.env.SPECMEM_DEBUG) initLog(`Skipping non-JSON: ${completeLine.slice(0, 30)}...`);
                  continue;
                }
                // JSON parse error - keep buffering (incomplete JSON)
              }
            }
          });

          // RELIABILITY FIX: Handle unexpected close before response
          client.on('close', hadError => {
            if (!settled) {
              settled = true;
              reject(new Error(`Socket closed unexpectedly${hadError ? ' with error' : ''} before response`));
            }
          });

          client.on('error', e => {
            if (!settled) {
              settled = true;
              cleanup();
              reject(new Error(`Socket error: ${e.message}`));
            }
          });

          client.on('timeout', () => {
            if (!settled) {
              settled = true;
              cleanup();
              reject(new Error(`Embedding timeout after ${TIMEOUTS.EMBEDDING_REQUEST}ms - socket may be unresponsive`));
            }
          });
        });

        // Reset failure counter on success
        consecutiveEmbeddingFailures = 0;
        return result;
      } catch (err) {
        lastError = err;
        consecutiveEmbeddingFailures++;

        // FIX: Categorize error for better debugging
        const errorType = categorizeEmbeddingError(err);
        if (process.env.SPECMEM_DEBUG) initLog(`Single attempt ${attempt} failed (${errorType}): ${err.message}`);

        // Revalidate socket after consecutive failures
        if (consecutiveEmbeddingFailures >= MAX_CONSECUTIVE_FAILURES) {
          if (process.env.SPECMEM_DEBUG) initLog(`Single embedding: ${consecutiveEmbeddingFailures} consecutive failures, revalidating socket...`);
          await revalidateSocket();
        }

        // FIX: Different backoff strategies based on error type
        if (attempt < maxRetries) {
          let backoffMs = Math.pow(2, attempt) * 100;
          // Server overload or timeout - wait longer before retry
          if (errorType === 'SERVER_OVERLOAD' || errorType === 'TIMEOUT') {
            backoffMs = Math.pow(2, attempt) * 500;
          }
          // Silent retry - don't break ProgressUI with console.log
          if (process.env.SPECMEM_DEBUG) console.error('[EMBEDDING] Retry ' + attempt + '/' + maxRetries + ' failed, backing off ' + backoffMs + 'ms...');
          await new Promise(r => setTimeout(r, backoffMs));
        }
      }
    }

    // All retries failed - silent to not break ProgressUI
    if (process.env.SPECMEM_DEBUG) console.error('[EMBEDDING] All ' + maxRetries + ' attempts failed: ' + (lastError ? lastError.message : 'unknown error'));
    throw lastError || new Error('embedding failed after ' + maxRetries + ' retries');
  }

  // Process files in batches with parallel embedding generation - 8x faster than sequential no cap
  // CRITICAL: Slow rendering during heavy I/O to prevent line splits from race conditions
  ui.slowRendering(300);
  ui.setStatus('Indexing codebase...');

  // Enable TUI file feed - shows what's being embedded in real-time
  ui.enableFileFeed(true);
  // SPEED OPTIMIZED: larger batches + more parallelism = faster indexing
  const batchSize = 50; // was 20 - larger batches = fewer UI updates
  const parallelLimit = 16; // was 8 - embedding server handles more concurrent requests
  let processed = 0;
  let lastUIUpdate = Date.now(); // throttle UI updates to reduce overhead

  // Read maxConcurrent from model-config.json for parallel embedding batches
  let embeddingMaxConcurrent = 3; // default
  try {
    const mcPath = path.join(projectPath, 'specmem', 'model-config.json');
    if (fs.existsSync(mcPath)) {
      const mc = JSON.parse(fs.readFileSync(mcPath, 'utf8'));
      if (mc.embedding && mc.embedding.maxConcurrent) {
        embeddingMaxConcurrent = mc.embedding.maxConcurrent;
      }
    }
  } catch { /* use default */ }
  initLog(`Embedding concurrency: ${embeddingMaxConcurrent} parallel batches`);

  // STORE-THEN-EMBED: For large codebases (>1000 files), store files first
  // then trigger Python server's batch processing (200 files/batch, direct DB)
  if (files.length > 1000 && activeSocketPath) {
    initLog(`Large codebase detected (${files.length} files) - using store-then-embed mode`);
    ui.setStatus('Store-then-embed mode (large codebase)');
    ui.setSubStatus('Phase 1: Storing files without embeddings...');

    // Phase 1: Store all files without embeddings (fast - no socket calls)
    await runWithConcurrency(files, async (filePath, idx) => {
      try {
        const relativePath = path.relative(projectPath, filePath);
        const stats = fs.statSync(filePath);
        if (stats.size > 500 * 1024) { results.filesSkipped++; return; }

        // Binary check
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(Math.min(8192, stats.size));
        fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        if (buf.includes(0)) { results.filesSkipped++; return; }

        const content = fs.readFileSync(filePath, 'utf-8');
        const contentHash = crypto.createHash('sha256').update(content).digest('hex');

        // Skip if already indexed with embedding
        if (existingHashes.get(relativePath) === contentHash) {
          results.filesSkipped++;
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const lang = fileLanguageMap.get(filePath) || { id: 'unknown', name: 'Unknown' };
        const lineCount = content.split('\n').length;
        const fileId = uuidv4();

        try {
          await pool.query(`DELETE FROM codebase_files WHERE file_path = $1 AND project_path = $2`, [relativePath, projectPath]);
        } catch { /* ignore */ }

        await pool.query(`
          INSERT INTO codebase_files (
            id, file_path, absolute_path, file_name, extension,
            language_id, language_name, content, content_hash,
            size_bytes, line_count, project_path
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
          fileId, relativePath, filePath, path.basename(filePath), ext,
          (lang.id || 'unknown').toLowerCase(), lang.name || 'Unknown',
          content, contentHash, stats.size, lineCount, projectPath
        ]);

        results.filesIndexed++;
        if (idx % 100 === 0) {
          ui.setSubStatus(`Stored ${results.filesIndexed} / ${files.length} files...`);
        }
      } catch (e) {
        results.errors.push(path.relative(projectPath, filePath) + ': ' + e.message);
      }
    }, parallelLimit);

    initLog(`Phase 1 complete: ${results.filesIndexed} files stored without embeddings`);
    ui.setSubStatus(`${results.filesIndexed} files stored, triggering server-side embedding...`);

    // Phase 2: Trigger Python server's process_codebase endpoint
    try {
      const ssResult = await new Promise((resolve, reject) => {
        const client = new net.Socket();
        let buffer = '';
        let settled = false;
        const timeout = setTimeout(() => {
          if (!settled) { settled = true; client.destroy(); reject(new Error('Server-side processing timeout (10min)')); }
        }, 600000);
        client.on('connect', () => {
          client.write(JSON.stringify({ process_codebase: true, batch_size: 200, limit: 0, project_path: projectPath }) + '\n');
        });
        client.on('data', (data) => {
          buffer += data.toString();
          let newlineIdx;
          while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
            if (settled) return;
            const line = buffer.slice(0, newlineIdx);
            buffer = buffer.slice(newlineIdx + 1);
            try {
              const resp = JSON.parse(line);
              if (resp.error) { clearTimeout(timeout); settled = true; client.end(); reject(new Error(resp.error)); return; }
              if (resp.status === 'processing') continue;
              if (resp.total_processed !== undefined || resp.processed !== undefined) {
                clearTimeout(timeout); settled = true; client.end(); resolve(resp); return;
              }
            } catch { /* keep waiting */ }
          }
        });
        client.on('error', (e) => { clearTimeout(timeout); if (!settled) { settled = true; reject(e); } });
        client.connect(activeSocketPath);
      });

      results.embeddingsGenerated = ssResult.total_processed || ssResult.processed || 0;
      initLog(`Server-side embedding complete: ${results.embeddingsGenerated} embeddings generated`);
      ui.setSubStatus(`Server-side: ${results.embeddingsGenerated} embeddings generated`);
    } catch (ssErr) {
      initLog(`Server-side embedding failed: ${ssErr.message} - falling back to client-side`);
      ui.setSubStatus('Server-side failed, falling back to client-side...');
      // Fall through to standard loop below (it will handle the remaining files)
    }

    // Skip the standard indexing loop
    results.durationMs = Date.now() - startTime;
    ui.enableFileFeed(false);
    ui.slowRendering(0);
    await pool.end();

    initLog(`=== CODEBASE INDEXING COMPLETE (store-then-embed) ===`);
    initLog(`Files: ${results.filesScanned} scanned, ${results.filesIndexed} indexed, ${results.embeddingsGenerated} embeddings`);
    initLog(`Duration: ${results.durationMs}ms`);
    return results;
  }

  // Track current file for better progress display
  let currentFile = '';
  let currentFileChunk = 0;
  let currentFileTotalChunks = 1;
  let currentPhase = 'Scanning'; // Track which phase we're in for better UI feedback

  // Per-embed progress callback - updates UI as each file completes
  // FIX: Accept filePath argument to show the actual file being processed, not stale data
  function updateProgress(filePathOrIndex = null, fileDataList = null) {
    processed++;
    const now = Date.now();
    // Update UI every 100ms for smoother progress (was 200ms)
    if (now - lastUIUpdate > 100 || processed >= files.length) {
      lastUIUpdate = now;
      ui.setSubProgress(processed / files.length);
      const failStr = results.embeddingsFailed ? ` [${results.embeddingsFailed} err]` : '';

      // FIX: Use fileDataList lookup if index provided, else fallback to currentFile
      let displayFile = '';
      if (typeof filePathOrIndex === 'number' && fileDataList && fileDataList[filePathOrIndex]) {
        displayFile = ` | ${path.basename(fileDataList[filePathOrIndex].relativePath)}`;
      } else if (currentFile) {
        displayFile = ` | ${path.basename(currentFile)}`;
      }

      const chunkStr = currentFileTotalChunks > 1 ? ` (${currentFileChunk}/${currentFileTotalChunks})` : '';
      const phaseStr = currentPhase ? `[${currentPhase}] ` : '';
      ui.setSubStatus(`${phaseStr}${processed}/${files.length} files - ${results.embeddingsGenerated} embeddings${failStr}${displayFile}${chunkStr}`);
    }
  }

  // Set current file for progress display
  function setCurrentFile(filePath, chunk = 1, totalChunks = 1) {
    currentFile = filePath;
    currentFileChunk = chunk;
    currentFileTotalChunks = totalChunks;
  }

  // Set current phase for progress display
  function setPhase(phase) {
    currentPhase = phase;
  }

  // helper to run promises with concurrency limit - worker pool pattern fr
  async function runWithConcurrency(items, fn, limit, onComplete = null) {
    const itemResults = [];
    let index = 0;
    async function worker() {
      while (index < items.length) {
        const currentIndex = index++;
        itemResults[currentIndex] = await fn(items[currentIndex], currentIndex);
        // Per-item progress callback
        if (onComplete) onComplete(currentIndex);
      }
    }
    const workers = [];
    for (let w = 0; w < Math.min(limit, items.length); w++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return itemResults;
  }

  // Log start of indexing loop
  initLog(`Starting file indexing: ${files.length} files, batchSize=${batchSize}, parallelLimit=${parallelLimit}`);
  initLog(`SPEED OPTIMIZATION: Using batch embedding API for 10x faster throughput`);

  // ============================================================================
  // SPEED OPTIMIZED: Two-phase approach
  // Phase 1: Read all files in batch, collect embedding texts
  // Phase 2: Generate embeddings in ONE batch request per batch
  // Phase 3: Write to DB in parallel
  // This reduces socket connections from N to 1 per batch = MASSIVE speedup
  // ============================================================================

  const EMBEDDING_BATCH_SIZE = 100; // Texts per embedding batch request

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);

    // Log progress every 5 batches
    if ((i / batchSize) % 5 === 0) {
      initLog(`Batch progress: ${i}/${files.length} files, ${results.embeddingsGenerated} embeddings, ${results.embeddingsFailed || 0} failed`);
    }

    // ========== PHASE 1: Read files and prepare data (parallel) ==========
    // FIX: Set phase for better UI feedback
    setPhase('Reading');

    const fileDataList = [];
    const fileEmbedTexts = [];
    const fileToTextIdx = new Map(); // Map file index to embedding text index

    await runWithConcurrency(batch, async (filePath, batchIdx) => {
      try {
        const relativePath = path.relative(projectPath, filePath);
        setCurrentFile(relativePath, 1, 1);

        const stats = fs.statSync(filePath);

        // Skip large files (>500KB)
        if (stats.size > 500 * 1024) {
          results.filesSkipped++;
          ui.addFileToFeed(relativePath, 'skip');
          return;
        }

        // FIX: Detect binary files before reading - binary files cause embedding issues
        // Check first 8KB for null bytes which indicate binary content
        const fd = fs.openSync(filePath, 'r');
        const checkBuffer = Buffer.alloc(Math.min(8192, stats.size));
        fs.readSync(fd, checkBuffer, 0, checkBuffer.length, 0);
        fs.closeSync(fd);
        if (checkBuffer.includes(0)) {
          // Binary file detected - skip it
          if (process.env.SPECMEM_DEBUG) initLog(`Skipping binary file: ${relativePath}`);
          results.filesSkipped++;
          ui.addFileToFeed(relativePath, 'skip');
          return;
        }

        const content = fs.readFileSync(filePath, 'utf8');

        // FIX: Skip empty files - they produce garbage embeddings
        if (!content || content.trim().length === 0) {
          if (process.env.SPECMEM_DEBUG) initLog(`Skipping empty file: ${relativePath}`);
          results.filesSkipped++;
          ui.addFileToFeed(relativePath, 'skip');
          return;
        }

        const contentHash = crypto.createHash('sha256').update(content).digest('hex');

        // Skip unchanged files
        if (existingHashes.get(relativePath) === contentHash) {
          results.filesSkipped++;
          ui.addFileToFeed(relativePath, 'skip');
          return;
        }

        const fileName = path.basename(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const langInfo = fileLanguageMap.get(filePath);
        const language = langInfo ? langInfo.id : 'unknown';
        const lineCount = content.split('\n').length;
        const fileId = uuidv4();

        // Collect embedding text
        const embeddingText = 'File: ' + relativePath + '\nLanguage: ' + language + '\n\n' + content.slice(0, MAX_EMBED_CHARS);
        const textIdx = fileEmbedTexts.length;
        fileEmbedTexts.push(embeddingText);
        fileToTextIdx.set(fileDataList.length, textIdx);

        // Extract definitions for later embedding
        const definitions = await extractDefinitions(content, relativePath, language, fileId);
        const maxDefsPerFile = 30;
        const defsToProcess = definitions.slice(0, maxDefsPerFile);

        // Show what was extracted
        const sizeKB = (stats.size / 1024).toFixed(1);
        const defCount = defsToProcess.length;
        ui.addFileToFeed(relativePath, 'reading', `(${sizeKB}KB, ${defCount} defs)`);

        fileDataList.push({
          filePath, relativePath, fileName, ext, language, content, contentHash,
          stats, lineCount, fileId, definitions: defsToProcess
        });
      } catch (e) {
        results.errors.push(path.relative(projectPath, filePath) + ': ' + e.message);
        ui.addFileToFeed(path.relative(projectPath, filePath), 'error');
      }
    }, parallelLimit);

    // ========== PHASE 2: Batch generate embeddings (ONE request!) ==========
    // FIX: Set phase for better UI feedback
    setPhase('Embedding');

    let fileEmbeddings = [];
    // FIX: If activeSocketPath is gone (socket died), try to revalidate before skipping
    if (fileEmbedTexts.length > 0 && !activeSocketPath) {
      initLog('No active socket for embedding phase - attempting revalidation...');
      const revalidated = await revalidateSocket();
      if (revalidated) {
        initLog(`Socket revalidated successfully: ${activeSocketPath}`);
      } else {
        initLog('Socket revalidation failed - embeddings will be skipped for this batch');
      }
    }
    if (fileEmbedTexts.length > 0 && activeSocketPath) {
      try {
        ui.setSubStatus(`Generating ${fileEmbedTexts.length} embeddings in batch...`);

        // Split into smaller batches
        const embBatches = [];
        for (let j = 0; j < fileEmbedTexts.length; j += EMBEDDING_BATCH_SIZE) {
          embBatches.push({ start: j, texts: fileEmbedTexts.slice(j, j + EMBEDDING_BATCH_SIZE) });
        }

        // Process embedding batches with concurrency (uses maxConcurrent from model config)
        const embResults = new Array(embBatches.length);
        await runWithConcurrency(embBatches, async (batch, batchIdx) => {
          const batchNum = batchIdx + 1;
          if (embBatches.length > 1) {
            ui.setSubStatus(`Embedding batch ${batchNum}/${embBatches.length} (${batch.texts.length} files)...`);
          }
          for (let k = 0; k < batch.texts.length; k++) {
            const fileIdx = batch.start + k;
            if (fileDataList[fileIdx]) {
              const fd = fileDataList[fileIdx];
              const sizeKB = (fd.stats.size / 1024).toFixed(1);
              ui.addFileToFeed(fd.relativePath, 'embedding', `(${sizeKB}KB)`);
            }
          }
          embResults[batchIdx] = await generateBatchEmbeddings(batch.texts);
        }, embeddingMaxConcurrent);

        // Flatten results in order
        for (const br of embResults) {
          if (br) fileEmbeddings.push(...br);
        }

        // Count successful embeddings
        for (const emb of fileEmbeddings) {
          if (emb && Array.isArray(emb)) {
            results.embeddingsGenerated++;
          } else {
            results.embeddingsSkipped = (results.embeddingsSkipped || 0) + 1;
          }
        }
      } catch (e) {
        initLog(`Batch embedding failed: ${e.message}`);
        results.embeddingsFailed = (results.embeddingsFailed || 0) + fileEmbedTexts.length;
        results.errorTypes = results.errorTypes || {};
        const errorType = categorizeEmbeddingError(e);
        results.errorTypes[errorType] = (results.errorTypes[errorType] || 0) + 1;
        fileEmbeddings = fileEmbedTexts.map(() => null);
      }
    }

    // ========== PHASE 3: Write to DB (parallel) ==========
    // FIX: Set phase for better UI feedback
    setPhase('Writing');

    // Collect all definition embedding texts for batch processing
    const defEmbedTexts = [];
    const defDataList = [];

    await runWithConcurrency(fileDataList, async (fileData, idx) => {
      try {
        // FIX: Update current file before each operation so UI shows correct file
        setCurrentFile(fileData.relativePath, 1, 1);
        ui.addFileToFeed(fileData.relativePath, 'done');

        const textIdx = fileToTextIdx.get(idx);
        const embedding = textIdx !== undefined ? fileEmbeddings[textIdx] : null;

        const embeddingStr = (embedding && Array.isArray(embedding) && embedding.length > 0)
          ? '[' + embedding.join(',') + ']'
          : null;

        // Delete existing file entry
        try {
          await pool.query(
            `DELETE FROM codebase_files WHERE file_path = $1 AND project_path = $2`,
            [fileData.relativePath, projectPath]
          );
        } catch (e) { /* ignore */ }

        // Insert file
        await pool.query(`
          INSERT INTO codebase_files (
            id, file_path, absolute_path, file_name, extension,
            language_id, language_name, content, content_hash,
            size_bytes, line_count, embedding, project_path
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [
          fileData.fileId, fileData.relativePath, fileData.filePath, fileData.fileName, fileData.ext,
          fileData.language.toLowerCase(), fileData.language, fileData.content, fileData.contentHash,
          fileData.stats.size, fileData.lineCount, embeddingStr, projectPath
        ]);

        results.filesIndexed++;

        // Collect definitions for batch embedding
        for (const def of fileData.definitions) {
          const defText = def.type + ' ' + def.name + '\n' + (def.signature || '') + '\nFile: ' + fileData.relativePath;
          defEmbedTexts.push(defText);
          defDataList.push({ def, fileId: fileData.fileId, relativePath: fileData.relativePath });
        }
      } catch (e) {
        results.errors.push(fileData.relativePath + ': ' + e.message);
      }
    }, parallelLimit, (idx) => updateProgress(idx, fileDataList));

    // ========== PHASE 4: Batch generate definition embeddings ==========
    // FIX: Set phase for better UI feedback
    setPhase('Defs');

    let defEmbeddings = [];
    if (defEmbedTexts.length > 0 && activeSocketPath) {
      try {
        ui.setSubStatus(`Embedding ${defEmbedTexts.length} definitions...`);
        // Split into batches
        const defBatches = [];
        for (let j = 0; j < defEmbedTexts.length; j += EMBEDDING_BATCH_SIZE) {
          defBatches.push({ start: j, texts: defEmbedTexts.slice(j, j + EMBEDDING_BATCH_SIZE) });
        }
        // Process with concurrency
        const defResults = new Array(defBatches.length);
        await runWithConcurrency(defBatches, async (batch, batchIdx) => {
          if (defBatches.length > 1) {
            ui.setSubStatus(`[Defs] Batch ${batchIdx + 1}/${defBatches.length} (${batch.texts.length} defs)...`);
          }
          for (let k = 0; k < batch.texts.length; k++) {
            const defIdx = batch.start + k;
            if (defDataList[defIdx]) {
              const dd = defDataList[defIdx];
              const defLabel = `${dd.def.type} ${dd.def.name}()`;
              ui.addFileToFeed(dd.relativePath, 'def', defLabel);
            }
          }
          defResults[batchIdx] = await generateBatchEmbeddings(batch.texts);
        }, embeddingMaxConcurrent);
        // Flatten in order
        for (const dr of defResults) {
          if (dr) defEmbeddings.push(...dr);
        }
      } catch (e) {
        initLog(`Definition batch embedding failed: ${e.message}`);
        // FIX: Categorize the error
        results.errorTypes = results.errorTypes || {};
        const errorType = categorizeEmbeddingError(e);
        results.errorTypes['DEF_' + errorType] = (results.errorTypes['DEF_' + errorType] || 0) + 1;
        defEmbeddings = defEmbedTexts.map(() => null);
      }
    }

    // ========== PHASE 5: Write definitions to DB (parallel) ==========
    // FIX: Set phase for better UI feedback
    setPhase('SaveDefs');

    await runWithConcurrency(defDataList, async (defData, idx) => {
      try {
        const defEmbedding = defEmbeddings[idx];
        const defEmbeddingStr = (defEmbedding && Array.isArray(defEmbedding) && defEmbedding.length > 0)
          ? '[' + defEmbedding.join(',') + ']'
          : null;

        await pool.query(
          'INSERT INTO code_definitions (' +
            'id, file_id, file_path, name, definition_type, ' +
            'start_line, end_line, signature, visibility, ' +
            'is_exported, project_path, embedding' +
          ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ' +
          'ON CONFLICT (id) DO UPDATE SET ' +
            'embedding = COALESCE(EXCLUDED.embedding, code_definitions.embedding), ' +
            'updated_at = NOW()',
          [
            defData.def.id, defData.fileId, defData.relativePath, defData.def.name, defData.def.type,
            defData.def.startLine, defData.def.endLine, defData.def.signature, 'public',
            true, projectPath, defEmbeddingStr
          ]
        );
        results.definitionsExtracted++;
      } catch (e) {
        if (process.env.SPECMEM_DEBUG) console.log('[INDEX] def insert failed: ' + e.message);
      }
    }, parallelLimit);

    // Note: progress updates now happen per-embed via updateProgress callback
    // This block only runs for end-of-batch logging
    if ((i / batchSize) % 5 === 0) {
      initLog(`Progress: ${processed}/${files.length} files, ${results.embeddingsGenerated} embeddings`);
    }

    // Brief pause every batch to avoid overwhelming resources - reduced from 50ms
    await new Promise(r => setTimeout(r, 10));
  }

  // CRITICAL: Resume normal rendering after heavy I/O batch processing is done
  ui.normalRendering();

  await pool.end();
  results.durationMs = Date.now() - startTime;

  ui.setStatus('Codebase indexed!');
  // Show failed/skipped counts if any for debugging
  const failInfo = [];
  if (results.embeddingsFailed) failInfo.push(`${results.embeddingsFailed} failed`);
  if (results.embeddingsSkipped) failInfo.push(`${results.embeddingsSkipped} skipped`);
  const failStr = failInfo.length ? ` (${failInfo.join(', ')})` : '';
  ui.setSubStatus(`${results.filesIndexed} files, ${results.definitionsExtracted} definitions, ${results.embeddingsGenerated} embeddings${failStr}`);

  // Log detailed error breakdown if there were failures
  if (results.errorTypes && Object.keys(results.errorTypes).length > 0) {
    const errorBreakdown = Object.entries(results.errorTypes)
      .map(([type, count]) => `${type}:${count}`)
      .join(', ');
    initLog(`Error breakdown: ${errorBreakdown}`);
    // Also show in UI briefly
    if (results.embeddingsFailed > 5) {
      ui.setSubStatus(`${results.filesIndexed} files, ${results.embeddingsGenerated} embeddings - Errors: ${errorBreakdown}`);
    }
  }

  // Log summary to init log
  initLog(`Codebase indexing complete: ${results.filesIndexed} files, ${results.embeddingsGenerated} embeddings, ${results.embeddingsFailed || 0} failed, ${results.embeddingsSkipped || 0} skipped`);
  await qqms();

  // Disable TUI file feed
  ui.enableFileFeed(false);
  ui.normalRendering();

  return results;
}

// Helper: Extract function/class definitions from code
async function extractDefinitions(content, filePath, language, fileId) {
  // yooo DRY - try bridge first for better extraction
  const bridge = await getCodebaseBridge();
  if (bridge) {
    try {
      const defs = await bridge.extractDefinitions(content, filePath, fileId);
      if (defs && defs.length > 0) {
        return defs.slice(0, 500).map(d => ({ id: d.id, name: d.name, type: d.definitionType || d.type, startLine: d.startLine, endLine: d.endLine, signature: d.signature || "" }));
      }
    } catch (e) { /* fallback */ }
  }
  // fallback to inline extraction below
  const { v4: uuidv4 } = require('uuid');
  const definitions = [];
  const lines = content.split('\n');

  // Simple regex-based extraction for common patterns
  const patterns = {
    'typescript': [
      { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(/gm, type: 'function' },
      { regex: /^(?:export\s+)?class\s+(\w+)/gm, type: 'class' },
      { regex: /^(?:export\s+)?interface\s+(\w+)/gm, type: 'interface' },
      { regex: /^(?:export\s+)?type\s+(\w+)/gm, type: 'type' },
      { regex: /^\s*(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/gm, type: 'method' },
    ],
    'javascript': [
      { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm, type: 'function' },
      { regex: /^(?:export\s+)?class\s+(\w+)/gm, type: 'class' },
    ],
    'python': [
      { regex: /^(?:async\s+)?def\s+(\w+)\s*\(/gm, type: 'function' },
      { regex: /^class\s+(\w+)/gm, type: 'class' },
    ],
    'go': [
      { regex: /^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/gm, type: 'function' },
      { regex: /^type\s+(\w+)\s+struct/gm, type: 'struct' },
      { regex: /^type\s+(\w+)\s+interface/gm, type: 'interface' },
    ],
    'rust': [
      { regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm, type: 'function' },
      { regex: /^(?:pub\s+)?struct\s+(\w+)/gm, type: 'struct' },
      { regex: /^(?:pub\s+)?trait\s+(\w+)/gm, type: 'trait' },
      { regex: /^(?:pub\s+)?impl(?:<[^>]*>)?\s+(\w+)/gm, type: 'impl' },
    ],
  };

  // Normalize language name
  const langKey = language.replace('-react', '').replace('-header', '');
  const langPatterns = patterns[langKey] || patterns['typescript'];

  for (const { regex, type } of langPatterns) {
    let match;
    const contentCopy = content;
    regex.lastIndex = 0;

    while ((match = regex.exec(contentCopy)) !== null) {
      const name = match[1];
      if (!name || name.length < 2 || name.length > 100) continue;

      // Skip common noise
      const noise = ['if', 'else', 'for', 'while', 'switch', 'return', 'break', 'continue', 'try', 'catch'];
      if (noise.includes(name.toLowerCase())) continue;

      // Find line number
      const beforeMatch = contentCopy.slice(0, match.index);
      const startLine = beforeMatch.split('\n').length;

      // Estimate end line (simple heuristic)
      let endLine = startLine;
      let braceCount = 0;
      let started = false;
      for (let i = startLine - 1; i < lines.length; i++) {
        const line = lines[i];
        for (const char of line) {
          if (char === '{' || char === ':') started = true;
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
        }
        if (started && braceCount === 0) {
          endLine = i + 1;
          break;
        }
        if (i > startLine + 100) {
          endLine = startLine + 20; // Cap at 20 lines
          break;
        }
      }

      // Build signature
      const signatureLine = lines[startLine - 1] || '';
      const signature = signatureLine.trim().slice(0, 200);

      definitions.push({
        id: uuidv4(),
        name,
        type,
        startLine,
        endLine,
        signature
      });
    }
  }

  // warn if we're about to truncate (shows in UI footer + logs to file)
  const DEFINITION_LIMIT = 500;
  if (definitions.length > DEFINITION_LIMIT) {
    uiWarn('File ' + path.basename(filePath) + ' has ' + definitions.length + ' defs, truncating');
  }
  return definitions.slice(0, DEFINITION_LIMIT);
}

// ============================================================================
// STAGE 6: TOKEN COMPRESSION
// ============================================================================

async function compressTokens(projectPath, ui) {
  ui.setStage(7, 'TOKEN COMPRESSION');

  // Import compressor inline
  let compress;
  try {
    const compressor = require('../claude-hooks/token-compressor.cjs');
    compress = compressor.compress;
  } catch (e) {
    ui.setStatus('Token compressor not found');
    ui.setSubStatus(`⚠️ ${e.message}`);
    await qqms();
    return { success: false, reason: 'compressor not found' };
  }

  // Find command files
  const sourceDir = path.join(__dirname, '..', 'commands');
  const globalDir = path.join(os.homedir(), '.claude', 'commands');
  const projectDir = path.join(projectPath, '.claude', 'commands');

  if (!fs.existsSync(sourceDir)) {
    ui.setStatus('No commands to compress');
    ui.setSubStatus('⚠️ Source commands directory not found');
    await qqms();
    return { success: false, reason: 'no source directory' };
  }

  const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.md') && f.startsWith('specmem'));

  if (files.length === 0) {
    ui.setStatus('No command files found');
    await qqms();
    return { success: true, optimized: 0 };
  }

  // Ensure target directories exist
  safeMkdir(globalDir);
  safeMkdir(projectDir);

  ui.setStatus(`Compressing ${files.length} commands...`);
  ui.setSubStatus('Traditional Chinese token compression');

  let totalSaved = 0;
  let totalOriginal = 0;
  let optimized = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const shortName = file.replace('specmem-', '').replace('.md', '');

    // Per-stage progress bar
    ui.setSubProgress((i + 1) / files.length);
    ui.setSubStatus(`[${i + 1}/${files.length}] ${shortName}`);

    try {
      const srcPath = path.join(sourceDir, file);
      const content = fs.readFileSync(srcPath, 'utf8');
      totalOriginal += content.length;

      // Compress
      const compressed = compress(content, { threshold: 0.65, skipCodeBlocks: true });
      const saved = content.length - compressed.length;
      totalSaved += saved;

      if (saved > 0) {
        optimized++;
        // Write compressed version
        fs.writeFileSync(path.join(globalDir, file), compressed);
        fs.writeFileSync(path.join(projectDir, file), compressed);
      } else {
        // Write original
        fs.writeFileSync(path.join(globalDir, file), content);
        fs.writeFileSync(path.join(projectDir, file), content);
      }
    } catch (e) {
      // Copy original on error
      try {
        const content = fs.readFileSync(path.join(sourceDir, file), 'utf8');
        fs.writeFileSync(path.join(globalDir, file), content);
        fs.writeFileSync(path.join(projectDir, file), content);
      } catch (e2) {
        // yooo fallback copy also failed - skill file is cooked
        initLog('[SKILLS] failed to deploy ' + file + ': ' + e2.message);
      }
    }

    // Small delay for visual feedback
    await qqms();
  }

  const percent = totalOriginal > 0 ? Math.round((totalSaved / totalOriginal) * 100) : 0;
  ui.setStatus(`Compressed ${optimized}/${files.length} files`);
  ui.setSubStatus(`✓ Saved ${formatBytes(totalSaved)} (${percent}% reduction)`);

  await qqms();
  return { success: true, optimized, total: files.length, saved: totalSaved, percent };
}


// ============================================================================
// STAGE 7: COMMAND DEPLOYMENT
// ============================================================================

async function deployCommands(projectPath, ui) {
  ui.setStage(8, 'COMMAND DEPLOYMENT');

  const globalCmdsDir = path.join(os.homedir(), '.claude', 'commands');
  const projectCmdsDir = path.join(projectPath, '.claude', 'commands');
  const specmemSkillsDir = path.join(__dirname, '..', 'skills');

  // Ensure directories exist
  safeMkdir(globalCmdsDir);
  safeMkdir(projectCmdsDir);

  let deployedGlobal = 0;
  let deployedProject = 0;

  // Find skill files to deploy
  ui.setStatus('Scanning for command definitions...');

  if (fs.existsSync(specmemSkillsDir)) {
    const skillFiles = fs.readdirSync(specmemSkillsDir).filter(f => f.endsWith('.md'));
    ui.setSubStatus(`Found ${skillFiles.length} command definitions`);
    await qqms();

    // Deploy to project directory
    ui.setStatus('Deploying commands to project...');
    for (let i = 0; i < skillFiles.length; i++) {
      const file = skillFiles[i];
      const src = path.join(specmemSkillsDir, file);
      const dest = path.join(projectCmdsDir, file);
      // Per-stage progress: project deploy is first half (0-0.5)
      ui.setSubProgress((i + 1) / skillFiles.length * 0.5);
      try {
        fs.copyFileSync(src, dest);
        deployedProject++;
        ui.setSubStatus(`📦 ${file}`);
        await qqms();
      } catch (e) {
        // yooo command deploy to project failed
        initLog('[CMDS] project deploy failed for ' + file + ': ' + e.message);
      }
    }

    // Also deploy to global
    ui.setStatus('Deploying commands globally...');
    for (let i = 0; i < skillFiles.length; i++) {
      const file = skillFiles[i];
      const src = path.join(specmemSkillsDir, file);
      const dest = path.join(globalCmdsDir, file);
      // Per-stage progress: global deploy is second half (0.5-1.0)
      ui.setSubProgress(0.5 + (i + 1) / skillFiles.length * 0.5);
      try {
        fs.copyFileSync(src, dest);
        deployedGlobal++;
        await qqms();
      } catch (e) {
        // yooo global command deploy failed
        initLog('[CMDS] global deploy failed for ' + file + ': ' + e.message);
      }
    }

    ui.setSubProgress(1.0);
    ui.setSubStatus(`✨ ${deployedProject} project + ${deployedGlobal} global commands deployed`);
  } else {
    ui.setSubStatus('⚠️ Skills directory not found');
  }

  await qqms();
  return { globalCommands: deployedGlobal, projectCommands: deployedProject };
}

// ============================================================================
// STAGE 4: SESSION EXTRACTION - Extract  session history into memories
// ============================================================================

/**
 * Parse  session files and store as memories.
 * This extracts user prompts and  responses from ~/.claude/projects/
 * so they're searchable via find_memory from the start.
 */
async function extractSessions(projectPath, ui, embeddingResult = null) {
  ui.setStage(6, 'SESSION EXTRACTION');

  const claudeDir = path.join(os.homedir(), '.claude');
  const projectsDir = path.join(claudeDir, 'projects');
  const historyPath = path.join(claudeDir, 'history.jsonl');

  const result = {
    extracted: 0,
    stored: 0,
    failed: 0,
    skipped: 0,
    sessions: 0,
    embeddingsGenerated: 0
  };

  ui.setStatus('Scanning for  session files...');
  ui.setSubStatus('Looking in ~/.claude/projects/');
  await qqms();

  // Check if embedding server is available
  // CRITICAL FIX: Use project socket path, not /tmp global socket
  const projectSocketPath = path.join(projectPath, 'specmem', 'sockets', 'embeddings.sock');
  const userId = process.getuid ? process.getuid() : 'default';
  const sharedSocketPath = path.join(os.tmpdir(), `specmem-embed-${userId}.sock`);

  // Try project socket first, then shared socket
  let socketPath = null;
  if (fs.existsSync(projectSocketPath)) {
    socketPath = projectSocketPath;
  } else if (fs.existsSync(sharedSocketPath)) {
    socketPath = sharedSocketPath;
  }

  // Also check embeddingResult from earlier stage
  const embeddingServerRunning = embeddingResult?.serverRunning || socketPath !== null;

  // CRITICAL: If no embedding server, START IT NOW - never skip embeddings!
  if (!embeddingServerRunning) {
    ui.setStatus('Starting embedding server for session extraction...');
    ui.setSubStatus('No socket found - launching Python embedding server');

    // Find the Python embedding script
    const possiblePaths = [
      path.join(__dirname, '..', 'embedding-sandbox', 'frankenstein-embeddings.py'),
      path.join(projectPath, 'embedding-sandbox', 'frankenstein-embeddings.py'),
      '/opt/specmem/embedding-sandbox/frankenstein-embeddings.py'
    ];

    let embeddingScript = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        embeddingScript = p;
        break;
      }
    }

    if (embeddingScript) {
      const { spawn } = require('child_process');
      const socketsDir = path.join(projectPath, 'specmem', 'sockets');
      safeMkdir(socketsDir);

      // Kill any existing embedding server before spawning for session extraction
      // Reset spawnedEmbeddingPid since we're about to spawn a replacement
      spawnedEmbeddingPid = null;
      killExistingEmbeddingServer(projectPath);

      // Clean up stale socket
      if (fs.existsSync(projectSocketPath)) {
        try {
          fs.unlinkSync(projectSocketPath);
        } catch (e) {
          // yooo session socket cleanup failed - might work anyway
          initLog('[SESSIONS] socket cleanup failed: ' + e.message);
        }
      }

      // Task #22 fix: Use getPythonPath() instead of hardcoded 'python3'
      const pythonPath = getPythonPath();
      // CRITICAL: Use file descriptor stdio, NOT pipes. Piped stdio causes SIGTERM
      // when parent event loop is under heavy load during batch indexing.
      const sessEmbedLogPath = path.join(projectPath, 'specmem', 'sockets', 'embedding-autostart.log');
      const sessEmbedLogFd = fs.openSync(sessEmbedLogPath, 'a');
      const embeddingProcess = spawn(pythonPath, [embeddingScript], {
        cwd: path.dirname(embeddingScript),
        env: {
          ...process.env,
          SPECMEM_EMBEDDING_SOCKET: projectSocketPath,
          SPECMEM_SOCKET_PATH: projectSocketPath,
          SPECMEM_PROJECT_PATH: projectPath
        },
        detached: true,
        stdio: ['ignore', sessEmbedLogFd, sessEmbedLogFd]
      });

      // CRITICAL FIX: Track spawned PID so killExistingEmbeddingServer() won't kill it
      spawnedEmbeddingPid = embeddingProcess.pid;
      initLog(`[EMBED] Session extraction spawned embedding server with PID ${spawnedEmbeddingPid} - tracking to prevent self-kill`);

      // error handler BEFORE unref - prevents silent spawn failures
      embeddingProcess.on('error', (err) => {
        ui.setSubStatus('Embedding spawn error: ' + err.message);
      });

      fs.closeSync(sessEmbedLogFd);
      embeddingProcess.unref();

      // DYNAMIC WAIT: Poll for readiness with adaptive intervals (max 5min)
      ui.setSubStatus('Waiting for embedding server to start...');
      const sessReady = await waitForEmbeddingReady(projectSocketPath, { ui, label: 'Session embedding server' });
      if (sessReady) {
        socketPath = projectSocketPath;
      }

      if (!socketPath) {
        ui.setStatus('⚠️ Embedding server failed to start');
        ui.setSubStatus('Session extraction requires embeddings - skipping');
        await qqms();
        return { ...result, skipped: true, reason: 'embedding_server_failed' };
      }
    } else {
      ui.setStatus('⚠️ No embedding script found');
      ui.setSubStatus('Session extraction requires embeddings - skipping');
      await qqms();
      return { ...result, skipped: true, reason: 'no_embedding_script' };
    }
  }

  ui.setSubStatus(`Using embedding socket: ${socketPath ? path.basename(path.dirname(socketPath)) : 'none'}`);

  // Get all session files
  const sessionFiles = [];

  // Add history.jsonl if exists
  if (fs.existsSync(historyPath)) {
    sessionFiles.push({ path: historyPath, type: 'history' });
  }

  // Add project session files
  if (fs.existsSync(projectsDir)) {
    const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(projectsDir, d.name));

    for (const projDir of projectDirs) {
      try {
        const files = fs.readdirSync(projDir)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => ({ path: path.join(projDir, f), type: 'session' }));
        sessionFiles.push(...files);
      } catch (e) {
        // yooo session dir scan failed - might be permission issue
        if (process.env.SPECMEM_DEBUG) console.log('[SESSIONS] scan failed for ' + projDir + ': ' + e.message);
      }
    }
  }

  if (sessionFiles.length === 0) {
    ui.setStatus('No session files found');
    ui.setSubStatus('⚠️ No  sessions to extract');
    await qqms();
    return { ...result, reason: 'no_sessions' };
  }

  ui.setStatus(`Found ${sessionFiles.length} session files`);
  ui.setSubStatus('Parsing session entries...');
  await qqms();

  // Parse session files - extract user prompts and  responses
  const entries = [];
  const crypto = require('crypto');

  for (const file of sessionFiles.slice(0, 50)) { // Limit to 50 files for init speed
    try {
      const content = fs.readFileSync(file.path, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          // Skip file-history-snapshot and other non-message types
          if (entry.type === 'file-history-snapshot') continue;
          if (entry.type === 'system') continue;
          if (entry.type === 'summary') continue;

          // User messages
          if (entry.type === 'user' && entry.message) {
            let content = '';
            const msgContent = entry.message.content;
            if (typeof msgContent === 'string') {
              content = msgContent;
            } else if (Array.isArray(msgContent) && msgContent[0]?.text) {
              content = msgContent[0].text;
            } else if (entry.display) {
              content = entry.display;
            }

            if (content && content.trim().length > 10) {
              const hash = crypto.createHash('sha256')
                .update(`${entry.sessionId}:${entry.timestamp}`)
                .digest('hex').slice(0, 16);

              entries.push({
                type: 'user',
                content: content.trim(),
                formatted: `[USER] ${content.trim()}`,
                sessionId: entry.sessionId,
                timestamp: entry.timestamp,
                hash,
                project: entry.cwd || entry.project || 'unknown'
              });
            }
          }

          // Assistant messages
          if (entry.type === 'assistant' && entry.message?.content) {
            let textContent = '';
            const msgContent = entry.message.content;

            if (Array.isArray(msgContent)) {
              for (const block of msgContent) {
                if (block.type === 'text' && block.text) {
                  textContent += block.text + '\n';
                }
              }
            }

            textContent = textContent.trim();

            // Skip empty or tool-only responses
            if (textContent && textContent.length > 20 &&
                !textContent.startsWith('[Tools:') &&
                !textContent.startsWith('[Tool:')) {

              const hash = crypto.createHash('sha256')
                .update(`${entry.sessionId}:${entry.timestamp}`)
                .digest('hex').slice(0, 16);

              entries.push({
                type: 'assistant',
                content: textContent,
                formatted: `[CLAUDE] ${textContent}`,
                sessionId: entry.sessionId,
                timestamp: entry.timestamp,
                hash,
                project: entry.cwd || 'unknown',
                model: entry.message.model
              });
            }
          }
        } catch (e) {
          // Skip invalid JSON lines
        }
      }
    } catch (e) {
      // Skip unreadable files
    }
  }

  result.extracted = entries.length;
  result.sessions = new Set(entries.map(e => e.sessionId)).size;

  if (entries.length === 0) {
    ui.setStatus('No session entries found');
    ui.setSubStatus('⚠️ Session files were empty or corrupted');
    await qqms();
    return result;
  }

  ui.setStatus(`Extracted ${entries.length} entries from ${result.sessions} sessions`);
  ui.setSubStatus('Storing memories (this may take a moment)...');
  await qqms();

  // Load database credentials from specmem.env
  let dbConfig = {
    host: 'localhost',
    port: 5432,
    database: 'specmem_westayunprofessional',
    user: 'specmem_westayunprofessional',
    password: 'specmem_westayunprofessional'
  };

  // parseEnvValue splits on first = only, handles values with = in them (like passwords)
  const parseEnvValue = (line, prefix) => {
    if (!line.startsWith(prefix)) return null;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) return null;
    return line.slice(eqIdx + 1).trim();
  };

  const envPath = path.join(__dirname, '..', 'specmem.env');
  if (fs.existsSync(envPath)) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf8');
      for (const line of envContent.split('\n')) {
        const hostVal = parseEnvValue(line, 'SPECMEM_DB_HOST=');
        const portVal = parseEnvValue(line, 'SPECMEM_DB_PORT=');
        const nameVal = parseEnvValue(line, 'SPECMEM_DB_NAME=');
        const userVal = parseEnvValue(line, 'SPECMEM_DB_USER=');
        const passVal = parseEnvValue(line, 'SPECMEM_DB_PASSWORD=');
        if (hostVal) dbConfig.host = hostVal;
        if (portVal) dbConfig.port = parseInt(portVal) || 5432;
        if (nameVal) dbConfig.database = nameVal;
        if (userVal) dbConfig.user = userVal;
        if (passVal !== null && passVal !== undefined) dbConfig.password = passVal;
      }
    } catch (envErr) {
      // yooo env file read failed - using defaults
      if (process.env.SPECMEM_DEBUG) console.log('[SESSIONS] env file read failed: ' + envErr.message);
    }
  }

  // Override with environment variables if set
  if (process.env.SPECMEM_DB_HOST) dbConfig.host = process.env.SPECMEM_DB_HOST;
  if (process.env.SPECMEM_DB_PORT) dbConfig.port = parseInt(process.env.SPECMEM_DB_PORT);
  if (process.env.SPECMEM_DB_NAME) dbConfig.database = process.env.SPECMEM_DB_NAME;
  if (process.env.SPECMEM_DB_USER) dbConfig.user = process.env.SPECMEM_DB_USER;
  if (process.env.SPECMEM_DB_PASSWORD) dbConfig.password = process.env.SPECMEM_DB_PASSWORD;

  // Connect to PostgreSQL
  let pool;
  try {
    const pg = require('pg');
    pool = new pg.Pool(dbConfig);
    // yooo CRITICAL - capture pg notices so they dont write to stdout during ProgressUI
    pool.on('notice', (msg) => initLog('[PG-NOTICE] ' + (msg.message || msg)));
    pool.on('error', (err) => initLog('[PG-ERROR] ' + (err.message || err)));
    await pool.query('SELECT 1');

    // CRITICAL FIX: Create and set search_path to project schema for proper isolation
    const schemaName = 'specmem_' + path.basename(projectPath).toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

    // Create schema if it doesn't exist
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);

    // Set search_path for ALL pool connections (not just the current one)
    pool.on('connect', (client) => {
      client.query(`SET search_path TO ${schemaName}, public`).catch(() => {});
    });
    await pool.query(`SET search_path TO ${schemaName}, public`);
    ui.setSubStatus(`Connected (schema: ${schemaName})`);

    // Initialize schema tables from SQL file
    const schemaInitPath = path.join(__dirname, '..', 'dist', 'db', 'projectSchemaInit.sql');
    if (fs.existsSync(schemaInitPath)) {
      const schemaInitSql = fs.readFileSync(schemaInitPath, 'utf8');
      await pool.query(schemaInitSql);
    }
  } catch (dbErr) {
    ui.setStatus('Database connection failed');
    ui.setSubStatus('Will extract on first MCP connect');

    const markerPath = path.join(projectPath, 'specmem', 'sockets', 'needs-session-extraction');
    safeMkdir(path.dirname(markerPath));
    fs.writeFileSync(markerPath, JSON.stringify({
      requested: new Date().toISOString(),
      reason: 'database_connection_failed',
      sessionCount: result.sessions,
      entryCount: entries.length,
      error: dbErr.message
    }));
    await qqms();
    return { ...result, skipped: true, reason: 'db_connection_failed' };
  }

  // Check for existing sessions to avoid duplicates
  ui.setStatus('Checking for existing sessions...');
  let existingHashes = new Set();
  try {
    const hashResult = await pool.query(`
      SELECT metadata->>'hash' as hash FROM memories
      WHERE 'claude-session' = ANY(tags) AND metadata->>'hash' IS NOT NULL
    `);
    existingHashes = new Set(hashResult.rows.map(r => r.hash));
    ui.setSubStatus(`Found ${existingHashes.size} existing memories`);
  } catch (hashErr) {
    // yooo hash lookup failed - might dupe some memories but thats fine fr
    initLog('[SESSIONS] hash lookup failed: ' + hashErr.message);
  }
  await qqms();

  const newEntries = entries.filter(e => !existingHashes.has(e.hash));
  if (newEntries.length === 0) {
    ui.setStatus('Sessions already extracted');
    ui.setSubStatus('All entries already in database');
    await pool.end();
    await qqms();
    // Note: use duplicatesSkipped (not skipped) - skipped is boolean for actual failures
    return { ...result, stored: 0, duplicatesSkipped: entries.length };
  }

  ui.setStatus(`Storing ${newEntries.length} new entries...`);
  ui.setSubStatus(`(${entries.length - newEntries.length} already exist)`);

  // Enable file feed for session embedding - shows what's being embedded
  ui.enableFileFeed(true);
  await qqms();

  // ============================================================================
  // BATCH EMBEDDING FOR SESSION EXTRACTION - SPEED OPTIMIZED
  // Uses batch_embed protocol to process multiple texts in one socket request
  // Same pattern as codebase indexing for 10x+ faster session extraction
  // ============================================================================

  const SESSION_EMBED_BATCH_SIZE = 50; // Texts per batch request

  // Batch embedding function - processes multiple texts in one request
  async function genBatchEmbeddings(texts) {
    if (!socketPath || !texts || texts.length === 0) {
      return texts.map(() => null);
    }

    const net = require('net');
    const maxRetries = 2;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await new Promise((resolve, reject) => {
          const client = new net.Socket();
          let data = '';
          client.setTimeout(TIMEOUTS.EMBEDDING_BATCH * 2); // Longer timeout for batch

          client.connect(socketPath, () => {
            // Use batch_embed protocol - server returns {embeddings: [[...], [...], ...]}
            const truncatedTexts = texts.map(t => (t || '').slice(0, MAX_EMBED_CHARS));
            client.write(JSON.stringify({ type: 'batch_embed', texts: truncatedTexts }) + '\n');
          });

          client.on('data', chunk => {
            data += chunk.toString();
            let newlineIdx;
            while ((newlineIdx = data.indexOf('\n')) !== -1) {
              const completeLine = data.slice(0, newlineIdx);
              data = data.slice(newlineIdx + 1);
              try {
                const parsed = JSON.parse(completeLine);
                if (parsed.status === 'processing') continue;
                client.destroy();
                if (parsed.error) {
                  reject(new Error('Batch embedding error: ' + parsed.error));
                  return;
                }
                // Server returns {embeddings: [[...], [...], ...]}
                const embeddings = parsed.embeddings || parsed;
                if (!Array.isArray(embeddings)) {
                  reject(new Error('Invalid batch response: expected array'));
                  return;
                }
                resolve(embeddings);
                return;
              } catch (e) {
                // JSON parse error - keep buffering
              }
            }
          });

          client.on('error', e => { client.destroy(); reject(e); });
          client.on('timeout', () => { client.destroy(); reject(new Error('batch timeout')); });
        });

        return result;
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 200 * attempt));
        }
      }
    }

    // Batch failed - return nulls
    initLog(`Session batch embedding failed after ${maxRetries} attempts: ${lastError?.message}`);
    return texts.map(() => null);
  }

  const BATCH_SIZE = 50; // Increased from 10 - more entries per batch = fewer socket connections
  let stored = 0;
  let failed = 0;

  let processed = 0;
  let lastUIUpdate = Date.now();

  // Per-entry progress update with 100ms throttle
  function updateEntryProgress(count = 1) {
    processed += count;
    const now = Date.now();
    if (now - lastUIUpdate > 100 || processed >= newEntries.length) {
      lastUIUpdate = now;
      ui.setSubProgress(processed / newEntries.length);
      ui.setSubStatus(`${processed}/${newEntries.length} entries - ${stored} stored, ${failed} failed`);
    }
  }

  // Process in batches - collect texts, batch embed, then store
  for (let i = 0; i < newEntries.length; i += BATCH_SIZE) {
    const batch = newEntries.slice(i, i + BATCH_SIZE);

    // Phase 1: Collect all texts for this batch
    const texts = batch.map(entry => entry.formatted);

    // Phase 2: Generate embeddings in ONE batch request
    ui.setSubStatus(`Batch embedding ${texts.length} entries...`);
    let embeddings = [];
    try {
      // Split into smaller batches if needed
      for (let j = 0; j < texts.length; j += SESSION_EMBED_BATCH_SIZE) {
        const textBatch = texts.slice(j, j + SESSION_EMBED_BATCH_SIZE);
        const batchResults = await genBatchEmbeddings(textBatch);
        embeddings.push(...batchResults);
      }
    } catch (e) {
      initLog(`Session batch embedding failed: ${e.message}`);
      embeddings = texts.map(() => null);
    }

    // Phase 3: Store all entries with their embeddings
    for (let idx = 0; idx < batch.length; idx++) {
      const entry = batch[idx];
      const embedding = embeddings[idx];

      // Show in file feed: preview of what user/claude said
      const preview = entry.content.slice(0, 50).replace(/\n/g, ' ');
      ui.addFileToFeed(
        entry.sessionId.slice(0, 8),
        entry.type === 'user' ? 'user' : 'assistant',
        `"${preview}${entry.content.length > 50 ? '...' : ''}"`
      );

      try {
        const tags = [
          'claude-session', 'conversation',
          `role:${entry.type}`,
          `session:${entry.sessionId.slice(0, 8)}`,
          entry.type === 'user' ? 'user-prompt' : 'claude-response'
        ];
        const metadata = {
          sessionId: entry.sessionId,
          hash: entry.hash,
          project: entry.project,
          project_path: projectPath,
          timestamp: new Date(entry.timestamp).toISOString(),
          timestampMs: entry.timestamp,
          source: 'claude-code',
          entryId: `${entry.sessionId}-${entry.timestamp}-${entry.type}`,
          role: entry.type
        };
        if (entry.model) metadata.model = entry.model;

        // validate embedding before .join()
        const embeddingStr = (embedding && Array.isArray(embedding) && embedding.length > 0)
          ? '[' + embedding.join(',') + ']'
          : null;
        await pool.query(`
          INSERT INTO memories (content, memory_type, importance, tags, metadata, embedding, project_path)
          VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING
        `, [entry.formatted, 'episodic', 'medium', tags, metadata, embeddingStr, projectPath]);
        stored++;
      } catch (insertErr) { failed++; }
    }
    updateEntryProgress(batch.length);  // Update progress for entire batch
    await qqms();
  }

  await pool.end();
  result.stored = stored;
  result.failed = failed;

  // Disable file feed after session extraction
  ui.enableFileFeed(false);

  ui.setStatus(`Session extraction complete`);
  ui.setSubStatus(`${stored} stored, ${failed} failed, ${entries.length - newEntries.length} existed`);

  await qqms();
  return result;
}

// ============================================================================
// STAGE 9: FINAL VERIFICATION
// ============================================================================

async function finalVerification(projectPath, analysis, modelConfig, ui) {
  ui.setStage(9, 'FINAL VERIFICATION');

  const checks = {
    modelConfig: false,
    embeddingConfig: false,
    projectCommands: false,
    globalCommands: false,
    localSettings: false
  };

  // Check model config
  ui.setStatus('Verifying model configuration...');
  ui.setSubProgress(0.15);
  const modelConfigPath = path.join(projectPath, 'specmem', 'model-config.json');
  if (fs.existsSync(modelConfigPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(modelConfigPath, 'utf8'));
      checks.modelConfig = config.tier === analysis.tier;
      ui.setSubStatus(checks.modelConfig ? '✓ Model config valid' : '⚠️ Model config mismatch');
    } catch (e) {
      ui.setSubStatus('⚠️ Model config corrupt');
    }
  }
  await qqms();

  // Check embedding config
  ui.setStatus('Verifying embedding configuration...');
  ui.setSubProgress(0.35);
  const timeoutPath = path.join(projectPath, 'specmem', 'embedding-timeouts.json');
  checks.embeddingConfig = fs.existsSync(timeoutPath);
  ui.setSubStatus(checks.embeddingConfig ? '✓ Embedding config valid' : '⚠️ Missing embedding config');
  await qqms();

  // Check commands
  ui.setStatus('Verifying command deployment...');
  ui.setSubProgress(0.55);
  const projectCmdsDir = path.join(projectPath, '.claude', 'commands');
  const globalCmdsDir = path.join(os.homedir(), '.claude', 'commands');

  const projectCmds = fs.existsSync(projectCmdsDir)
    ? fs.readdirSync(projectCmdsDir).filter(f => f.startsWith('specmem') && f.endsWith('.md')).length
    : 0;
  const globalCmds = fs.existsSync(globalCmdsDir)
    ? fs.readdirSync(globalCmdsDir).filter(f => f.startsWith('specmem') && f.endsWith('.md')).length
    : 0;

  checks.projectCommands = projectCmds > 0;
  checks.globalCommands = globalCmds > 0;
  ui.setSubStatus(`✓ ${projectCmds} project, ${globalCmds} global commands`);
  await qqms();

  // Create/verify local settings
  ui.setStatus('Verifying  local settings...');
  ui.setSubProgress(0.75);
  const settingsPath = path.join(projectPath, '.claude', 'settings.local.json');

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      // yooo settings file corrupted - starting fresh
      initLog('[VERIFY] settings.local.json parse failed: ' + e.message);
    }
  }

  // Ensure permissions
  if (!settings.permissions) settings.permissions = {};
  if (!settings.permissions.allow) settings.permissions.allow = [];

  const requiredPerms = ['mcp__specmem__*'];
  for (const perm of requiredPerms) {
    if (!settings.permissions.allow.includes(perm)) {
      settings.permissions.allow.push(perm);
    }
  }

  safeMkdir(path.dirname(settingsPath));
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  checks.localSettings = true;
  ui.setSubStatus('✓ Local settings configured');
  await qqms();

  // Summary
  const passed = Object.values(checks).filter(v => v).length;
  const total = Object.values(checks).length;

  ui.setSubProgress(1.0);
  ui.setStatus(`Verification complete: ${passed}/${total} checks passed`);
  ui.setSubStatus(passed === total ? '🎉 All systems ready!' : `⚠️ ${total - passed} issues need attention`);
  await qqms();

  return { checks, passed, total };
}

// ============================================================================
// TERMINAL DETECTION & AUTO-OPEN
// ============================================================================

/**
 * Detect the current terminal emulator
 * Returns: { name, command, openNew }
 */
function detectTerminal() {
  const term = process.env.TERM || '';
  const terminal = process.env.TERMINAL || '';
  const colorterm = process.env.COLORTERM || '';
  const desktop = process.env.XDG_CURRENT_DESKTOP || '';
  const session = process.env.XDG_SESSION_DESKTOP || '';

  // Try to detect from process tree
  let parentTerm = '';
  try {
    // Get parent process name
    const ppid = process.ppid;
    const cmdline = fs.readFileSync(`/proc/${ppid}/cmdline`, 'utf8').split('\0')[0];
    parentTerm = path.basename(cmdline);
  } catch (e) {
    // yooo parent process detection failed - no biggie, we try other methods
    if (process.env.SPECMEM_DEBUG) console.log('[TERM] parent process detection failed: ' + e.message);
  }

  // Terminal configs: { command to open new window with command }
  // Priority: system default first, then Ptyxis/GNOME 45+, then others, xterm last (fallback)
  const terminals = {
    'x-terminal-emulator': { name: 'System Default', cmd: 'x-terminal-emulator', newWindow: '-e' },
    'ptyxis': { name: 'Ptyxis', cmd: 'ptyxis', newWindow: '--' },
    'xfce4-terminal': { name: 'XFCE Terminal', cmd: 'xfce4-terminal', newWindow: '-x' },
    'gnome-terminal': { name: 'GNOME Terminal', cmd: 'gnome-terminal', newWindow: '--' },
    'konsole': { name: 'Konsole', cmd: 'konsole', newWindow: '-e' },
    'alacritty': { name: 'Alacritty', cmd: 'alacritty', newWindow: '-e' },
    'kitty': { name: 'Kitty', cmd: 'kitty', newWindow: '' },
    'terminator': { name: 'Terminator', cmd: 'terminator', newWindow: '-x' },
    'tilix': { name: 'Tilix', cmd: 'tilix', newWindow: '-e' },
    'foot': { name: 'Foot', cmd: 'foot', newWindow: '--' },
    'urxvt': { name: 'URxvt', cmd: 'urxvt', newWindow: '-e' },
    'st': { name: 'st', cmd: 'st', newWindow: '-e' },
    'mate-terminal': { name: 'MATE Terminal', cmd: 'mate-terminal', newWindow: '-x' },
    'lxterminal': { name: 'LXTerminal', cmd: 'lxterminal', newWindow: '-e' },
    'qterminal': { name: 'QTerminal', cmd: 'qterminal', newWindow: '-e' },
    'terminology': { name: 'Terminology', cmd: 'terminology', newWindow: '-e' },
    'xterm': { name: 'XTerm', cmd: 'xterm', newWindow: '-e' },
  };

  // Detection order
  const checks = [
    parentTerm,
    terminal.toLowerCase(),
    process.env.TERM_PROGRAM?.toLowerCase(),
  ];

  // Check if we're in XFCE
  if (desktop === 'XFCE' || session === 'xfce') {
    checks.unshift('xfce4-terminal');
  }

  // Find matching terminal
  for (const check of checks) {
    if (!check) continue;
    for (const [key, config] of Object.entries(terminals)) {
      // Match bidirectionally: "xfce" matches "xfce4-terminal" and vice versa
      if (check.includes(key) || key.includes(check) || check.includes(config.cmd) || config.cmd.includes(check)) {
        // Verify it exists
        try {
          execSync(`which ${config.cmd}`, { stdio: 'ignore' });
          return { ...config, detected: key };
        } catch (e) {
          // yooo terminal not found - try next one
        }
      }
    }
  }

  // Fallback: try to find any available terminal
  for (const [key, config] of Object.entries(terminals)) {
    try {
      execSync(`which ${config.cmd}`, { stdio: 'ignore' });
      return { ...config, detected: key, fallback: true };
    } catch (e) {
      // yooo terminal not found - try next one
    }
  }

  return null;
}

/**
 * Open a new terminal window with a command
 * Options: { centered: bool, width: int, height: int }
 */
function openTerminalWithCommand(terminal, command, title = '', options = {}) {
  if (!terminal) return false;

  const { centered = false, width = 120, height = 35 } = options;

  try {
    let cmd;

    // Get screen dimensions for centering
    let screenW = 1920, screenH = 1080;
    try {
      const xdpyinfo = execSync('xdpyinfo 2>/dev/null | grep dimensions', { encoding: 'utf8' });
      const match = xdpyinfo.match(/(\d+)x(\d+)/);
      if (match) {
        screenW = parseInt(match[1]);
        screenH = parseInt(match[2]);
      }
    } catch (e) {
      // yooo screen dimensions detection failed - using defaults
      if (process.env.SPECMEM_DEBUG) console.log('[TERM] screen detection failed: ' + e.message);
    }

    // Calculate center position
    const posX = centered ? Math.floor((screenW - width * 8) / 2) : 100;
    const posY = centered ? Math.floor((screenH - height * 16) / 2) : 100;
    const geometry = `${width}x${height}+${posX}+${posY}`;

    if (terminal.cmd === 'xfce4-terminal') {
      cmd = `${terminal.cmd} --title="${title}" --geometry=${geometry} ${terminal.newWindow} ${command} &`;
    } else if (terminal.cmd === 'gnome-terminal') {
      cmd = `${terminal.cmd} --title="${title}" --geometry=${geometry} ${terminal.newWindow} ${command} &`;
    } else if (terminal.cmd === 'ptyxis') {
      // Ptyxis (GNOME 45+) - no -geometry support, uses --title and -- separator
      cmd = `${terminal.cmd} --title="${title}" -- ${command} &`;
    } else if (terminal.cmd === 'x-terminal-emulator') {
      // System default via Debian alternatives - try --title, fall back to generic
      cmd = `${terminal.cmd} --title="${title}" -e ${command} &`;
    } else if (terminal.cmd === 'foot') {
      // Foot (Wayland) - uses --title and no -geometry
      cmd = `${terminal.cmd} --title="${title}" ${command} &`;
    } else if (terminal.cmd === 'konsole') {
      cmd = `${terminal.cmd} --new-tab -p tabtitle="${title}" ${terminal.newWindow} ${command} &`;
    } else if (terminal.cmd === 'kitty') {
      cmd = `${terminal.cmd} --title "${title}" -o initial_window_width=${width * 8} -o initial_window_height=${height * 16} ${command} &`;
    } else {
      // Generic format with geometry
      cmd = `${terminal.cmd} -geometry ${geometry} ${terminal.newWindow} ${command} &`;
    }

    execSync(cmd, { stdio: 'ignore', shell: true });
    return true;
  } catch (e) {
    return false;
  }
}

// ============================================================================
// STAGE 10: SCREEN SESSION LAUNCHER - Idempotent & Bulletproof
// ============================================================================

async function launchScreenSessions(projectPath, ui) {
  ui.setStage(10, 'SCREEN SESSIONS');

  const projectId = path.basename(projectPath).replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const brainSession = `specmem-${projectId}`;
  const claudeSession = `claude-${projectId}`;

  const result = {
    brain: false,
    brainAlreadyRunning: false,
    claude: false,
    claudeAlreadyRunning: false
  };

  // Check if screen is installed
  ui.setStatus('Checking for screen utility...');
  try {
    execSync('which screen', { stdio: 'ignore' });
  } catch (e) {
    ui.setSubStatus('⚠️ screen not installed - skipping session launch');
    await sleep(150);
    return result;
  }

  // Get current running screens
  ui.setStatus('Detecting running sessions...');
  let runningScreens = '';
  try {
    runningScreens = execSync('screen -ls 2>/dev/null || true', { encoding: 'utf8' });
  } catch (e) {
    // yooo screen list failed - assuming no sessions running
    if (process.env.SPECMEM_DEBUG) console.log('[SCREEN] screen -ls failed: ' + e.message);
  }

  const brainRunning = runningScreens.includes(brainSession);
  const claudeRunning = runningScreens.includes(claudeSession);

  // Show what's running
  const runningParts = [];
  if (brainRunning) runningParts.push('🧠 Brain');
  if (claudeRunning) runningParts.push('🤖 ');
  if (runningParts.length > 0) {
    ui.setSubStatus(`Already running: ${runningParts.join(', ')}`);
    await qqms();
  } else {
    ui.setSubStatus('No existing sessions detected');
    await qqms();
  }

  // Launch brain if not running
  if (!brainRunning) {
    ui.setStatus('Launching SpecMem Brain...');
    const consolePath = path.join(__dirname, '..', 'bin', 'specmem-console.cjs');

    if (fs.existsSync(consolePath)) {
      try {
        execSync(`screen -dmS ${brainSession} node "${consolePath}" "${projectPath}"`, { stdio: 'ignore' });
        await sleep(150);

        // Verify it started
        const checkScreens = execSync('screen -ls 2>/dev/null || true', { encoding: 'utf8' });
        if (checkScreens.includes(brainSession)) {
          result.brain = true;
          ui.setSubStatus(`✓ Brain launched: ${brainSession}`);
        } else {
          ui.setSubStatus('⚠️ Brain failed to start');
        }
      } catch (e) {
        ui.setSubStatus(`⚠️ Brain launch error: ${e.message}`);
      }
    } else {
      ui.setSubStatus('⚠️ specmem-console.cjs not found');
    }
    await qqms();
  } else {
    result.brain = true;
    result.brainAlreadyRunning = true;
    ui.setStatus('Brain already running...');
    ui.setSubStatus(`✓ Reusing: ${brainSession}`);
    await qqms();
  }

  // Launch  if not running
  if (!claudeRunning) {
    ui.setStatus('Launching  session...');

    try {
      // Launch  in a screen session with the project path
      // PTY MEMORY APPROACH: NO -L -Logfile (zero disk I/O)
      // Uses screen hardcopy to tmpfs on-demand instead of continuous logging
      // -h 5000 sets scrollback buffer to 5000 lines for hardcopy capture
      const claudeBin = getClaudeBinary();
      execSync(`screen -h 5000 -dmS ${claudeSession} bash -c 'cd "${projectPath}" && "${claudeBin}" 2>&1; exec bash'`, { stdio: 'ignore' });
      await sleep(300);

      // Verify it started
      const checkScreens = execSync('screen -ls 2>/dev/null || true', { encoding: 'utf8' });
      if (checkScreens.includes(claudeSession)) {
        result.claude = true;
        ui.setSubStatus(`✓  launched: ${claudeSession}`);
      } else {
        ui.setSubStatus('⚠️  failed to start');
      }
    } catch (e) {
      ui.setSubStatus(`⚠️  launch error: ${e.message}`);
    }
    await qqms();
  } else {
    result.claude = true;
    result.claudeAlreadyRunning = true;
    ui.setStatus(' already running...');
    ui.setSubStatus(`✓ Reusing: ${claudeSession}`);
    await qqms();
  }

  // Final status
  ui.setStatus('Screen sessions ready');
  const parts = [];
  if (result.brain) parts.push(result.brainAlreadyRunning ? '🧠 Brain (existing)' : '🧠 Brain (new)');
  if (result.claude) parts.push(result.claudeAlreadyRunning ? '🤖  (existing)' : '🤖  (new)');
  ui.setSubStatus(parts.length > 0 ? parts.join(' + ') : 'No sessions launched');
  await qqms();

  // Auto-open terminal windows
  const terminal = detectTerminal();
  result.terminal = terminal;
  result.brainSession = brainSession;
  result.claudeSession = claudeSession;

  if (terminal && result.claude) {
    ui.setStatus('Opening  terminal...');
    ui.setSubStatus(`Detected: ${terminal.name}${terminal.fallback ? ' (fallback)' : ''}`);
    await qqms();

    // Open  in a centered window (smaller, in front)
    const success = openTerminalWithCommand(
      terminal,
      `screen -r ${claudeSession}`,
      ` - ${projectId}`,
      { centered: true, width: 100, height: 30 }
    );

    if (success) {
      ui.setSubStatus(`✓  window opened (centered)`);
    } else {
      ui.setSubStatus(`⚠️ Could not open  window - attach with: screen -r ${claudeSession}`);
    }
    await qqms();
  }

  // Note: Brain will be attached in the current terminal after init completes
  await qqms();
  return result;
}

// ============================================================================
// SETUP VERIFICATION & AUTO-SETUP
// ============================================================================

/**
 * Verify that specmem setup prerequisites are met
 * Returns: { needsSetup: bool, checks: {...} }
 */
async function verifySetupPrerequisites(projectPath) {
  const checks = {
    database: false,
    embeddingServer: false,
    globalDir: false,
    claudeHooks: false
  };

  // Check for global specmem directory
  const globalDir = path.join(os.homedir(), '.specmem');
  checks.globalDir = fs.existsSync(globalDir);

  // Check for  hooks directory AND settings.json with hooks configured
  const hooksDir = path.join(os.homedir(), '.claude', 'hooks');
  const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  let hooksConfigured = false;
  if (fs.existsSync(claudeSettingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8'));
      hooksConfigured = settings.hooks && Object.keys(settings.hooks).length > 0;
    } catch (e) {
      hooksConfigured = false;
    }
  }
  checks.claudeHooks = fs.existsSync(hooksDir) && hooksConfigured;

  // Check database connection
  try {
    const dbHost = process.env.SPECMEM_DB_HOST || 'localhost';
    const dbPort = process.env.SPECMEM_DB_PORT || '5432';
    const dbName = process.env.SPECMEM_DB_NAME || 'specmem_westayunprofessional';
    const dbUser = process.env.SPECMEM_DB_USER || 'specmem_westayunprofessional';
    const dbPass = process.env.SPECMEM_DB_PASSWORD || 'specmem_westayunprofessional';

    const result = execSync(
      `PGPASSWORD='${dbPass}' psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -c "SELECT 1" 2>/dev/null`,
      { encoding: 'utf8', timeout: TIMEOUTS.EXEC_SHORT, stdio: 'pipe' }
    );
    checks.database = result.includes('1');
  } catch (e) {
    checks.database = false;
  }

  // Check embedding server (socket file)
  const socketsDir = path.join(projectPath, 'specmem', 'sockets');
  const socketPath = path.join(socketsDir, 'embeddings.sock');
  checks.embeddingServer = fs.existsSync(socketPath);

  // Setup is needed if database OR global dir is missing
  const needsSetup = !checks.database || !checks.globalDir || !checks.claudeHooks;

  return { needsSetup, checks };
}

/**
 * Run automatic setup using ProgressUI (no custom console output)
 */
async function runAutoSetup(projectPath) {
  // Create a dedicated ProgressUI for setup
  const setupUI = new ProgressUI();
  setupUI.totalStages = 5;
  setupUI.start();

  try {
    // Step 0: Docker — install if missing, start daemon
    setupUI.setStage(1, 'DOCKER');
    setupUI.setStatus('Checking Docker...');
    setupUI.setSubProgress(0);

    let hasDocker = false;
    try { execSync('docker --version 2>/dev/null', { stdio: 'pipe' }); hasDocker = true; } catch (_) {}

    if (!hasDocker) {
      setupUI.setStatus('Installing Docker...');
      initLog('[SETUP] Docker not found — installing');

      const IS_MAC_INIT = process.platform === 'darwin';
      const IS_LINUX_INIT = process.platform === 'linux';

      if (IS_LINUX_INIT) {
        // Method 1: Official Docker install script
        setupUI.setSubStatus('Running official Docker install script...');
        try {
          execSync('curl -fsSL https://get.docker.com | sh 2>&1', { stdio: 'pipe', timeout: 300000 });
          try { execSync('docker --version 2>/dev/null', { stdio: 'pipe' }); hasDocker = true; } catch (_) {}
        } catch (e) {
          initLog('[SETUP] Docker official script failed: ' + e.message);
        }

        // Method 2: Package manager fallback
        if (!hasDocker) {
          setupUI.setSubStatus('Trying package manager install...');
          try {
            let hasPkgMgr = false;
            try { execSync('which apt-get 2>/dev/null', { stdio: 'pipe' }); hasPkgMgr = true;
              execSync('apt-get update -qq 2>/dev/null && apt-get install -y docker.io 2>/dev/null', { stdio: 'pipe', timeout: 120000 });
            } catch (_) {}
            if (!hasPkgMgr) {
              try { execSync('which dnf 2>/dev/null', { stdio: 'pipe' });
                execSync('dnf install -y docker 2>/dev/null', { stdio: 'pipe', timeout: 120000 });
              } catch (_) {}
            }
            try { execSync('docker --version 2>/dev/null', { stdio: 'pipe' }); hasDocker = true; } catch (_) {}
          } catch (_) {}
        }

        // Configure Docker for non-root usage
        if (hasDocker) {
          try {
            const user = process.env.USER || process.env.LOGNAME || 'root';
            execSync(`usermod -aG docker ${user} 2>/dev/null`, { stdio: 'pipe' });
          } catch (_) {}
        }
      } else if (IS_MAC_INIT) {
        setupUI.setSubStatus('Installing Docker via Homebrew...');
        try {
          execSync('brew install --cask docker 2>&1', { stdio: 'pipe', timeout: 300000 });
          execSync('open -a Docker 2>/dev/null', { stdio: 'pipe' });
          // Wait for Docker Desktop
          for (let i = 0; i < 12; i++) {
            execSync('sleep 5', { stdio: 'pipe' });
            try { execSync('docker info 2>/dev/null', { stdio: 'pipe' }); hasDocker = true; break; } catch (_) {}
          }
        } catch (e) {
          initLog('[SETUP] Docker Desktop install failed: ' + e.message);
          // Try colima
          try {
            execSync('brew install colima docker 2>&1', { stdio: 'pipe', timeout: 300000 });
            execSync('colima start --cpu 2 --memory 4 2>&1', { stdio: 'pipe', timeout: 60000 });
            try { execSync('docker info 2>/dev/null', { stdio: 'pipe' }); hasDocker = true; } catch (_) {}
          } catch (_) {}
        }
      }

      if (hasDocker) {
        initLog('[SETUP] Docker installed');
        setupUI.setSubStatus('Docker installed');
      } else {
        initLog('[SETUP] Docker install failed');
        setupUI.setSubStatus('Docker install failed — install manually');
      }
    } else {
      setupUI.setSubStatus('Docker already installed');
    }
    setupUI.setSubProgress(0.5);

    // Start Docker daemon if not running
    if (hasDocker) {
      setupUI.setStatus('Starting Docker daemon...');
      let dockerRunning = false;
      try { execSync('docker info 2>/dev/null', { stdio: 'pipe', timeout: 10000 }); dockerRunning = true; } catch (_) {}

      if (!dockerRunning) {
        initLog('[SETUP] Docker daemon not running — starting');
        const startCmds = [
          'systemctl start docker 2>/dev/null',
          'service docker start 2>/dev/null',
        ];
        for (const cmd of startCmds) {
          try {
            execSync(cmd, { stdio: 'pipe', timeout: 15000 });
            // Wait for daemon
            for (let i = 0; i < 10; i++) {
              try { execSync('docker info 2>/dev/null', { stdio: 'pipe', timeout: 5000 }); dockerRunning = true; break; } catch (_) {}
              execSync('sleep 1', { stdio: 'pipe' });
            }
            if (dockerRunning) break;
          } catch (_) {}
        }
        setupUI.setSubStatus(dockerRunning ? 'Docker daemon started' : 'Could not start Docker daemon');
      } else {
        setupUI.setSubStatus('Docker daemon already running');
      }
    }
    setupUI.setSubProgress(1);
    await qqms();

    // Step 2: Database setup — install, start, configure
    setupUI.setStage(2, 'DATABASE');
    setupUI.setStatus('Checking PostgreSQL...');
    setupUI.setSubProgress(0);

    const dbHost = process.env.SPECMEM_DB_HOST || 'localhost';
    const dbPort = process.env.SPECMEM_DB_PORT || '5432';
    const dbName = process.env.SPECMEM_DB_NAME || 'specmem_westayunprofessional';
    const dbUser = process.env.SPECMEM_DB_USER || 'specmem_westayunprofessional';
    const dbPass = process.env.SPECMEM_DB_PASSWORD || 'specmem_westayunprofessional';

    // --- Install PostgreSQL if missing ---
    let hasPsql = false;
    try { execSync('which psql 2>/dev/null', { stdio: 'pipe' }); hasPsql = true; } catch (_) {}
    if (!hasPsql) {
      setupUI.setStatus('Installing PostgreSQL...');
      setupUI.setSubStatus('apt-get install postgresql postgresql-17-pgvector');
      initLog('[SETUP] PostgreSQL not found — installing');
      try {
        execSync('apt-get update -qq 2>/dev/null && apt-get install -y postgresql postgresql-common 2>/dev/null', { stdio: 'pipe', timeout: 120000 });
        // Install pgvector for the installed PG version
        try {
          const pgVer = execSync("pg_config --version 2>/dev/null | grep -oP '\\d+' | head -1", { encoding: 'utf8', stdio: 'pipe' }).trim();
          execSync(`apt-get install -y postgresql-${pgVer}-pgvector 2>/dev/null`, { stdio: 'pipe', timeout: 60000 });
        } catch (_) {
          // Try common versions
          try { execSync('apt-get install -y postgresql-17-pgvector 2>/dev/null || apt-get install -y postgresql-16-pgvector 2>/dev/null || apt-get install -y postgresql-15-pgvector 2>/dev/null', { stdio: 'pipe', timeout: 60000 }); } catch (_) {}
        }
        initLog('[SETUP] PostgreSQL installed');
      } catch (installErr) {
        initLog('[SETUP] PostgreSQL install failed: ' + installErr.message);
        setupUI.setSubStatus('PostgreSQL install failed — install manually');
      }
    }
    setupUI.setSubProgress(0.2);

    // --- Start PostgreSQL if not running ---
    setupUI.setStatus('Starting PostgreSQL...');
    try {
      execSync('pg_isready -q 2>/dev/null', { stdio: 'pipe', timeout: 3000 });
      setupUI.setSubStatus('PostgreSQL already running');
    } catch (_pgDown) {
      initLog('[SETUP] PostgreSQL not running — auto-starting');
      const startCmds = [
        'service postgresql start',
        "pg_ctlcluster $(pg_lsclusters -h 2>/dev/null | head -1 | awk '{print $1, $2}') start",
        'systemctl start postgresql',
      ];
      let pgStarted = false;
      for (const cmd of startCmds) {
        try {
          execSync(cmd + ' 2>/dev/null', { stdio: 'pipe', timeout: 15000 });
          for (let i = 0; i < 10; i++) {
            try { execSync('pg_isready -q 2>/dev/null', { stdio: 'pipe', timeout: 2000 }); pgStarted = true; break; } catch (_) {}
            execSync('sleep 0.5', { stdio: 'pipe' });
          }
          if (pgStarted) break;
        } catch (_) {}
      }
      if (pgStarted) {
        setupUI.setSubStatus('PostgreSQL started');
        initLog('[SETUP] PostgreSQL auto-started');
      } else {
        setupUI.setSubStatus('Could not start PostgreSQL');
        initLog('[SETUP] PostgreSQL auto-start failed');
      }
    }
    setupUI.setSubProgress(0.4);

    let dbOk = false;

    // --- Create user, database, and extensions ---
    setupUI.setStatus('Setting up database...');
    try {
      execSync(`PGPASSWORD='${dbPass}' psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -c "SELECT 1" 2>/dev/null`, { stdio: 'pipe' });
      dbOk = true;
    } catch (e) {
      setupUI.setSubStatus('Creating database...');
      try {
        // Try sudo first, fall back to su for containers/environments without sudo
        const pgExec = (sql, db) => {
          const dbFlag = db ? `-d ${db}` : '';
          try {
            execSync(`sudo -u postgres psql ${dbFlag} -c "${sql}" 2>/dev/null`, { stdio: 'pipe', timeout: 10000 });
          } catch (_) {
            execSync(`su - postgres -c "psql ${dbFlag} -c \\"${sql}\\"" 2>/dev/null`, { stdio: 'pipe', timeout: 10000 });
          }
        };
        try { pgExec(`CREATE USER ${dbUser} WITH PASSWORD '${dbPass}';`); } catch (_) {}
        try { pgExec(`CREATE DATABASE ${dbName} OWNER ${dbUser};`); } catch (_) {}
        try { pgExec(`CREATE EXTENSION IF NOT EXISTS vector;`, dbName); } catch (vecErr) {
          // pgvector not installed — try installing it
          initLog('[SETUP] pgvector extension missing — installing');
          setupUI.setSubStatus('Installing pgvector...');
          try {
            const pgVer = execSync("pg_config --version 2>/dev/null | grep -oP '\\d+' | head -1", { encoding: 'utf8', stdio: 'pipe' }).trim() || '17';
            execSync(`apt-get install -y postgresql-${pgVer}-pgvector 2>/dev/null`, { stdio: 'pipe', timeout: 60000 });
            pgExec(`CREATE EXTENSION IF NOT EXISTS vector;`, dbName);
          } catch (_) {
            initLog('[SETUP] pgvector install failed');
          }
        }
        dbOk = true;
      } catch (e2) {
        try {
          execSync(`PGPASSWORD='${dbPass}' psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -c "SELECT 1" 2>/dev/null`, { stdio: 'pipe' });
          dbOk = true;
        } catch (e3) {
          initLog('[SETUP] db connection failed: ' + e3.message);
        }
      }
    }

    setupUI.setSubProgress(1);
    setupUI.setSubStatus(dbOk ? '✓ Database connected' : '✗ Database failed');
    await qqms();

    // Step 2:  hooks
    setupUI.setStage(3, 'CLAUDE HOOKS');
    setupUI.setStatus('Installing hooks...');
    setupUI.setSubProgress(0);

    const hooksDir = path.join(os.homedir(), '.claude', 'hooks');
    safeMkdir(hooksDir);

    const srcHooksDir = path.join(__dirname, '..', 'claude-hooks');
    let hookCount = 0;
    if (fs.existsSync(srcHooksDir)) {
      const hookFiles = fs.readdirSync(srcHooksDir).filter(f => f.endsWith('.js') || f.endsWith('.cjs'));
      for (const file of hookFiles) {
        try {
          fs.copyFileSync(path.join(srcHooksDir, file), path.join(hooksDir, file));
          hookCount++;
        } catch (e) {
          initLog('[SETUP] hook copy failed for ' + file + ': ' + e.message);
        }
      }
    }

    // CRITICAL: MERGE settings.json to enable hooks in  (don't clobber existing)
    const srcSettingsPath = path.join(srcHooksDir, 'settings.json');
    const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    let hooksConfigured = false;
    if (fs.existsSync(srcSettingsPath)) {
      try {
        const srcSettings = JSON.parse(fs.readFileSync(srcSettingsPath, 'utf8'));
        let existingSettings = {};

        // Load existing settings if present
        if (fs.existsSync(claudeSettingsPath)) {
          try {
            existingSettings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8'));
            // Backup before modifying
            const backupPath = claudeSettingsPath + '.backup.' + Date.now();
            fs.copyFileSync(claudeSettingsPath, backupPath);
          } catch (e) {
            existingSettings = {};
          }
        }

        // MERGE hooks - Deep merge that preserves user's non-specmem hooks
        // SpecMem hooks take priority for same event types + matchers
        const mergedSettings = { ...existingSettings };

        // Fix hardcoded paths in srcSettings for actual install environment
        const homeDir = os.homedir();
        const pkgRoot = path.resolve(__dirname, '..');
        let srcSettingsStr = JSON.stringify(srcSettings);
        if (homeDir !== '/root') {
          srcSettingsStr = srcSettingsStr.replace(/\/root\//g, homeDir + '/');
          srcSettingsStr = srcSettingsStr.replace(/"\/root"/g, '"' + homeDir + '"');
        }
        // Fix SPECMEM_PKG to point to actual install location (not dev /specmem)
        srcSettingsStr = srcSettingsStr.replace(/"SPECMEM_PKG":\s*"\/specmem"/g, `"SPECMEM_PKG": "${pkgRoot}"`);
        // Fix SPECMEM_HOME to use actual home directory
        srcSettingsStr = srcSettingsStr.replace(/"SPECMEM_HOME":\s*"\/root\/.specmem"/g, `"SPECMEM_HOME": "${path.join(homeDir, '.specmem')}"`);
        const fixedSrcSettings = JSON.parse(srcSettingsStr);

        if (fixedSrcSettings.hooks) {
          mergedSettings.hooks = mergeHooksDeep(existingSettings.hooks || {}, fixedSrcSettings.hooks);
        }

        // Helper: check if a hook command belongs to specmem
        function isSpecmemHookCmd(hookEntry) {
          const cmd = (hookEntry.command || '');
          return cmd.includes('specmem') || cmd.includes('team-comms-enforcer') ||
                 cmd.includes('agent-loading-hook') || cmd.includes('agent-output-interceptor') ||
                 cmd.includes('task-progress-hook') || cmd.includes('subagent-loading-hook') ||
                 cmd.includes('use-code-pointers') || cmd.includes('post-write-memory-hook') ||
                 cmd.includes('bullshit-radar') || cmd.includes('input-aware-improver') ||
                 cmd.includes('smart-context-hook');
        }

        // Deep merge hooks: specmem hooks take priority per-matcher, but user's
        // custom (non-specmem) hooks within the same matcher are preserved.
        // On re-init, old specmem hooks are cleaned up and replaced with new ones.
        function mergeHooksDeep(existingHooks, specmemHooks) {
          const merged = {};

          // Copy all existing event types (deep clone to avoid mutations)
          for (const eventType of Object.keys(existingHooks)) {
            merged[eventType] = JSON.parse(JSON.stringify(existingHooks[eventType]));
          }

          // Process each specmem event type
          for (const eventType of Object.keys(specmemHooks)) {
            const specmemGroups = specmemHooks[eventType];

            if (!merged[eventType]) {
              merged[eventType] = specmemGroups;
              continue;
            }

            // Build specmem's desired state: one entry per matcher
            const specmemByMatcher = new Map();
            for (const group of specmemGroups) {
              const key = group.matcher || '__CATCHALL__';
              if (!specmemByMatcher.has(key)) {
                specmemByMatcher.set(key, { ...group, hooks: [...(group.hooks || [])] });
              } else {
                // Consolidate duplicate matchers from source
                specmemByMatcher.get(key).hooks.push(...(group.hooks || []));
              }
            }

            // Extract user's custom (non-specmem) hooks per matcher from existing config
            const userHooksByMatcher = new Map();
            for (const group of merged[eventType]) {
              const key = group.matcher || '__CATCHALL__';
              const userHooks = (group.hooks || []).filter(h => !isSpecmemHookCmd(h));
              if (userHooks.length > 0) {
                if (!userHooksByMatcher.has(key)) {
                  userHooksByMatcher.set(key, []);
                }
                userHooksByMatcher.get(key).push(...userHooks);
              }
            }

            // Build final result for this event type
            const result = [];
            const handledMatchers = new Set();

            // First: all specmem matchers (with user's custom hooks merged in)
            for (const [key, group] of specmemByMatcher) {
              const userHooks = userHooksByMatcher.get(key) || [];
              result.push({ ...group, hooks: [...group.hooks, ...userHooks] });
              handledMatchers.add(key);
            }

            // Then: existing matchers that specmem doesn't touch
            for (const group of merged[eventType]) {
              const key = group.matcher || '__CATCHALL__';
              if (handledMatchers.has(key)) continue;
              handledMatchers.add(key);

              // Clean orphaned specmem hooks from non-specmem matchers
              const cleanHooks = (group.hooks || []).filter(h => !isSpecmemHookCmd(h));
              if (cleanHooks.length > 0) {
                result.push({ ...group, hooks: cleanHooks });
              }
              // If 100% specmem hooks and specmem no longer uses this matcher, drop it
            }

            merged[eventType] = result;
          }

          return merged;
        }

        // Also merge permissions (add specmem permissions without clobbering user's)
        if (fixedSrcSettings.permissions) {
          mergedSettings.permissions = mergedSettings.permissions || {};

          // Merge allow arrays - add specmem permissions, dedupe
          const existingAllow = mergedSettings.permissions.allow || [];
          const specmemAllow = fixedSrcSettings.permissions.allow || [];
          mergedSettings.permissions.allow = [...new Set([...existingAllow, ...specmemAllow])];

          // Merge deny arrays - add specmem denies, dedupe
          const existingDeny = mergedSettings.permissions.deny || [];
          const specmemDeny = fixedSrcSettings.permissions.deny || [];
          mergedSettings.permissions.deny = [...new Set([...existingDeny, ...specmemDeny])];

          // Don't clobber user's ask array or defaultMode unless they're missing
          if (!mergedSettings.permissions.ask) {
            mergedSettings.permissions.ask = fixedSrcSettings.permissions.ask || [];
          }
          if (!mergedSettings.permissions.defaultMode) {
            mergedSettings.permissions.defaultMode = fixedSrcSettings.permissions.defaultMode;
          }
        }

        // Write merged settings
        fs.writeFileSync(claudeSettingsPath, JSON.stringify(mergedSettings, null, 2));
        const hookEventCount = Object.keys(mergedSettings.hooks || {}).length;
        const permCount = (mergedSettings.permissions?.allow || []).length;
        initLog('[SETUP] settings.json deep-merged: ' + hookEventCount + ' hook events, ' + permCount + ' permissions (user hooks preserved)');

        // VERIFICATION: Confirm hooks are properly configured
        const verifySettings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8'));
        const hookEvents = Object.keys(verifySettings.hooks || {});
        hooksConfigured = hookEvents.length > 0;
        if (hooksConfigured) {
          initLog('[SETUP] ✓ Hooks verified: ' + hookEvents.join(', '));
        } else {
          initLog('[SETUP] ✗ WARNING: No hooks configured after merge!');
        }
      } catch (e) {
        initLog('[SETUP] settings.json merge failed: ' + e.message);
      }
    }

    // ========== CRITICAL: Configure MCP server in .claude.json for THIS project ==========
    // Claude Code v2.x reads project-level MCP config from ~/.claude.json projects section
    const claudeJsonPath = path.join(os.homedir(), '.claude.json');
    try {
      let claudeJson = {};
      if (fs.existsSync(claudeJsonPath)) {
        claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
      }

      // Ensure projects object exists
      if (!claudeJson.projects) claudeJson.projects = {};
      if (!claudeJson.projects[projectPath]) {
        claudeJson.projects[projectPath] = {
          allowedTools: [],
          mcpContextUris: [],
          mcpServers: {},
          hasTrustDialogAccepted: true
        };
      }

      // Find specmem package location - use __dirname since we're running from the package
      // Fallback to require.resolve for edge cases
      let specmemPkg;
      try {
        specmemPkg = path.dirname(__dirname); // We're in scripts/, so parent is package root
        if (!fs.existsSync(path.join(specmemPkg, 'bootstrap.cjs'))) {
          // Try require.resolve as fallback
          specmemPkg = require.resolve('specmem-hardwicksoftware/bootstrap.cjs').replace('/bootstrap.cjs', '');
        }
      } catch (e) {
        // Ultimate fallback - we're in /usr/lib/node_modules or similar
        specmemPkg = IS_ROOT
          ? '/usr/lib/node_modules/specmem-hardwicksoftware'
          : path.join(os.homedir(), '.specmem');
        initLog('[WARN] Could not resolve specmem package, using fallback: ' + specmemPkg);
      }
      const projectSocketDir = path.join(projectPath, 'specmem', 'sockets');

      // Configure MCP server for this project
      claudeJson.projects[projectPath].mcpServers = claudeJson.projects[projectPath].mcpServers || {};
      // Prefer mcp-proxy.cjs for resilient connections (auto-reconnect)
      const mcpEntry = fs.existsSync(path.join(specmemPkg, 'mcp-proxy.cjs'))
        ? path.join(specmemPkg, 'mcp-proxy.cjs')
        : path.join(specmemPkg, 'bootstrap.cjs');
      claudeJson.projects[projectPath].mcpServers.specmem = {
        type: "stdio",
        command: "node",
        args: [
          mcpEntry
        ],
        env: {
          HOME: os.homedir(),
          SPECMEM_PROJECT_PATH: projectPath,
          SPECMEM_RUN_DIR: projectSocketDir,
          SPECMEM_EMBEDDING_SOCKET: path.join(projectSocketDir, 'embeddings.sock'),
          SPECMEM_DB_HOST: "localhost",
          SPECMEM_DB_PORT: "5432",
          SPECMEM_DB_NAME: "specmem_westayunprofessional",
          SPECMEM_DB_USER: "specmem_westayunprofessional",
          SPECMEM_DB_PASSWORD: "specmem_westayunprofessional",
          SPECMEM_MAX_HEAP_MB: "1024"
        }
      };
      claudeJson.projects[projectPath].hasTrustDialogAccepted = true;

      fs.writeFileSync(claudeJsonPath, JSON.stringify(claudeJson, null, 2));
      initLog('[SETUP] ✓ MCP server configured in ~/.claude.json for ' + projectPath);
    } catch (e) {
      initLog('[SETUP] ⚠ Failed to configure MCP in .claude.json: ' + e.message);
    }

    setupUI.setSubProgress(1);
    const hooksStatus = hooksConfigured ? '✓' : '⚠';
    setupUI.setSubStatus(`${hooksStatus} ${hookCount} hooks installed, settings ${hooksConfigured ? 'verified' : 'NEEDS CHECK'}`);
    await qqms();

    // Step 3: Global config
    setupUI.setStage(4, 'GLOBAL CONFIG');
    setupUI.setStatus('Creating directories...');
    setupUI.setSubProgress(0);

    const globalDir = path.join(os.homedir(), '.specmem');
    safeMkdir(globalDir);
    safeMkdir(path.join(globalDir, 'cache'));
    safeMkdir(path.join(globalDir, 'logs'));

    setupUI.setSubProgress(1);
    setupUI.setSubStatus('✓ ~/.specmem ready');
    await qqms();

    // Step 4: Project dirs
    setupUI.setStage(5, 'PROJECT DIRS');
    setupUI.setStatus('Creating project directories...');
    setupUI.setSubProgress(0);

    const specmemDir = path.join(projectPath, 'specmem');
    safeMkdir(specmemDir);
    safeMkdir(path.join(specmemDir, 'sockets'));
    safeMkdir(path.join(specmemDir, 'cache'));

    const claudeDir = path.join(projectPath, '.claude');
    safeMkdir(path.join(claudeDir, 'commands'));

    setupUI.setSubProgress(1);
    setupUI.setSubStatus('✓ Project dirs ready');
    await qqms();

    // Complete and cleanup
    setupUI.complete('Setup complete!');

    if (!dbOk) {
      return { success: false, error: 'Database setup failed' };
    }

    return { success: true };

  } catch (e) {
    setupUI.fail('Setup failed: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================================
// MAIN - THE FULL FLEX
// ============================================================================

async function main() {
  const projectPath = process.cwd();
  const startTime = Date.now();

  // ========== DIRECTORY CHECK - Warn if not in a project directory ==========
  const homeDir = os.homedir();
  const badDirs = [
    homeDir,
    '/',
    '/root',
    '/home',
    '/usr',
    '/var',
    '/tmp',
    '/etc',
    '/opt'
  ];

  const isBadDir = badDirs.some(bad => projectPath === bad || projectPath === bad + '/');

  if (isBadDir) {
    console.log(`
${c.red}${c.bright}╔════════════════════════════════════════════════════════════════╗
║  ⚠ WARNING: You're running specmem from a system directory!   ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  Current directory: ${projectPath.padEnd(41)}║
║                                                                ║
║  SpecMem should be run from a PROJECT directory, not:          ║
║    • Your home folder (~)                                      ║
║    • System directories (/root, /usr, /etc, etc)               ║
║    • Temporary directories (/tmp)                              ║
║                                                                ║
║  Please cd into your project first:                            ║
║    $ cd /path/to/your/project                                  ║
║    $ specmem init                                              ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝${c.reset}
`);
    console.log(`${c.yellow}Continuing anyway in 5 seconds... (Ctrl+C to cancel)${c.reset}`);
    await new Promise(r => setTimeout(r, 5000));
  }

  // Speed mode enabled by default - no need to wait for SPACE

  // Animated banner with sliding red highlight (screen already cleared at startup)
  await showAnimatedBanner();
  console.log(`${c.dim}  Project: ${projectPath}${c.reset}`);
  console.log(`${c.brightYellow}⚡ TURBO MODE${c.reset}${c.dim} - Fast initialization enabled${c.reset}`);
  console.log('');

  // ========== PRE-STAGE 0: Auto-run setup if not done ==========
  // Check if first-run setup has been completed (models downloaded, deps installed)
  // Dynamic: root uses package dir, non-root uses ~/.specmem
  const specmemPkgDir = path.dirname(__dirname);
  const modelsDir = path.join(USER_SPECMEM_DIR, 'models', 'optimized');
  const setupMarker = path.join(USER_SPECMEM_DIR, '.setup-complete');

  // Ensure user dir exists for non-root
  if (!IS_ROOT) {
    safeMkdir(USER_SPECMEM_DIR)
  }

  // Check if setup is needed: no models dir OR no setup marker OR missing Python deps
  let needsSetup = false;
  if (!fs.existsSync(modelsDir) || !fs.existsSync(setupMarker)) {
    needsSetup = true;
  } else {
    // Also check if sentence_transformers is available
    try {
      execSync('python3 -c "import sentence_transformers" 2>/dev/null', { stdio: 'pipe' });
    } catch (e) {
      needsSetup = true;
    }
  }

  if (needsSetup) {
    console.log(`${c.yellow}═══ First-time setup required ═══${c.reset}`);
    console.log(`${c.dim}Downloading models and installing dependencies...${c.reset}\n`);

    try {
      // Run first-run-model-setup.cjs with SPECMEM_CALLED_FROM_INIT to skip redundant banner
      const setupScript = path.join(specmemPkgDir, 'scripts', 'first-run-model-setup.cjs');
      if (fs.existsSync(setupScript)) {
        execSync(`node "${setupScript}"`, {
          stdio: 'inherit',
          timeout: 600000,
          env: { ...process.env, SPECMEM_CALLED_FROM_INIT: '1' }
        });
        // Create marker file to indicate setup is complete
        fs.writeFileSync(setupMarker, new Date().toISOString());
        console.log(`\n${c.green}✓ Setup complete!${c.reset}\n`);
      } else {
        console.log(`${c.yellow}⚠ Setup script not found, continuing anyway...${c.reset}\n`);
      }
    } catch (e) {
      console.log(`${c.yellow}⚠ Setup had issues but continuing with init...${c.reset}`);
      console.log(`${c.dim}You can run 'specmem setup' manually later${c.reset}\n`);
    }
  }

  // ========== PRE-STAGE: Kill Old Stuck Init Processes ==========
  // Prevent resource conflicts by killing old specmem-init processes for THIS PROJECT ONLY
  // CRITICAL: Use realpath to normalize paths and avoid killing other projects' processes
  try {
    const myPid = process.pid;
    const myParentPid = process.ppid;
    // Resolve our project path to handle symlinks
    const myRealPath = fs.realpathSync(projectPath);

    const psOutput = execSync('ps aux | grep "specmem-init.cjs" | grep -v grep', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = psOutput.trim().split('\n').filter(l => l.includes('specmem-init.cjs'));

    for (const line of lines) {
      const parts = line.split(/\s+/);
      const pid = parseInt(parts[1], 10);
      // Skip ourselves and our parent (the wrapper script)
      if (pid === myPid || pid === myParentPid) continue;

      // Check if this process is for the SAME project (use realpath for robust comparison)
      try {
        const cwdLink = fs.readlinkSync(`/proc/${pid}/cwd`);
        // Resolve symlinks for accurate comparison
        let otherRealPath;
        try {
          otherRealPath = fs.realpathSync(cwdLink);
        } catch (e) {
          otherRealPath = cwdLink; // Can't resolve, use as-is
        }

        // STRICT CHECK: Only kill if paths match EXACTLY after resolving symlinks
        if (otherRealPath === myRealPath) {
          // Same project, kill it
          console.log(`${c.yellow}⚠️ Killing old stuck init for this project (PID ${pid})${c.reset}`);
          process.kill(pid, 'SIGTERM');
          // Also kill parent wrapper if exists
          try {
            const ppidLine = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
            const ppidMatch = ppidLine.match(/\d+\s+\([^)]+\)\s+\w\s+(\d+)/);
            if (ppidMatch) {
              const oldParent = parseInt(ppidMatch[1], 10);
              if (oldParent !== 1 && oldParent !== myParentPid) {
                process.kill(oldParent, 'SIGTERM');
              }
            }
          } catch (e) { /* ignore */ }
        }
      } catch (e) { /* process may have exited */ }
    }
  } catch (e) { /* no old processes, that's fine */ }

  // ========== PRE-STAGE: Linux Emoji Font + xterm Config ==========
  // Auto-detect missing emoji fonts, install Noto Color Emoji,
  // write fontconfig fallback, and configure .Xresources for xterm
  const emojiFixResult = checkAndFixEmojiSupport();
  if (emojiFixResult.fixed) {
    const parts = [];
    if (emojiFixResult.fontInstalled) parts.push('font');
    if (emojiFixResult.fontconfigWritten) parts.push('fontconfig');
    if (emojiFixResult.xresourcesWritten) parts.push('xterm');
    console.log(`${c.green}✓ Emoji support configured (${parts.join(' + ')})${c.reset}`);
    console.log('');
  }

  // ========== PRE-STAGE: XFCE Terminal Color Fix ==========
  // Auto-fix rainbow display issue in XFCE terminal from ANSI escape sequences
  // Sets TERM=xterm-256color, configures terminal profile, updates .bashrc
  const xfceFixResult = checkAndFixXFCETerminal();
  // (output is handled inside the function)

  // ========== PRE-STAGE: Docker Cleanup + Warm-Start Detection ==========
  // Auto-clean dead/exited specmem containers, detect warm-start opportunities
  const dockerCleanup = await cleanupDockerContainers();

  // ========== PRE-STAGE: Kill THIS PROJECT's Embedding Containers ==========
  // Auto-kill any existing embedding containers for THIS project (no kys needed!)
  const projectCleanup = killProjectEmbeddingContainers();
  if (projectCleanup.killed > 0) {
    console.log(`${c.yellow}🔥 Auto-killed ${projectCleanup.killed} old embedding container(s) for this project${c.reset}`);
    for (const name of projectCleanup.containers) {
      console.log(`   ${c.dim}${name}${c.reset}`);
    }
    console.log('');
  }

  if (dockerCleanup.dockerAvailable) {
    const hasCleanup = dockerCleanup.dead + dockerCleanup.exited + dockerCleanup.versionMismatch > 0;
    const hasPaused = dockerCleanup.paused > 0;
    const hasRunning = dockerCleanup.running > 0;

    if (hasCleanup || hasPaused || hasRunning) {
      console.log(`${c.brightCyan}🐳 Docker Status${c.reset} ${c.dim}(v${SPECMEM_VERSION})${c.reset}`);

      // Show warm-start assets (paused containers - the good stuff!)
      if (hasPaused) {
        console.log(`  ${c.green}⏸️${c.reset}  ${c.white}${dockerCleanup.paused}${c.reset} paused ${c.dim}(warm-start ready ~100ms)${c.reset}`);
        for (const container of dockerCleanup.pausedContainers) {
          const versionInfo = container.version ? `v${container.version}` : '';
          console.log(`      ${c.cyan}${container.name}${c.reset} ${c.dim}${versionInfo}${c.reset}`);
        }
      }

      // Show running containers
      if (hasRunning) {
        console.log(`  ${c.green}●${c.reset}  ${c.white}${dockerCleanup.running}${c.reset} running`);
        for (const container of dockerCleanup.runningContainers) {
          const versionInfo = container.version ? `v${container.version}` : '';
          console.log(`      ${c.cyan}${container.name}${c.reset} ${c.dim}${versionInfo}${c.reset}`);
        }
      }

      // Show version mismatch kills (old code protection!)
      if (dockerCleanup.versionMismatch > 0) {
        console.log(`  ${c.brightRed}⚠️${c.reset}  ${c.white}${dockerCleanup.versionMismatch}${c.reset} killed ${c.dim}(old code - version mismatch)${c.reset}`);
        for (const container of dockerCleanup.cleaned.filter(c => c.type === 'version_mismatch')) {
          console.log(`      ${c.red}${container.name}${c.reset} ${c.dim}v${container.oldVersion} → v${container.newVersion}${c.reset}`);
        }
      }

      // Show cleanup stats
      if (dockerCleanup.dead > 0) {
        console.log(`  ${c.green}✓${c.reset} Removed ${c.white}${dockerCleanup.dead}${c.reset} dead containers`);
      }
      if (dockerCleanup.exited > 0) {
        console.log(`  ${c.green}✓${c.reset} Removed ${c.white}${dockerCleanup.exited}${c.reset} old exited containers`);
      }
      console.log('');
    }

    // DOCKER DISABLED: Kill any paused embedding containers instead of warm-starting them
    if (hasPaused) {
      console.log(`${c.brightYellow}🧹 Cleaning Up Docker Embedding Containers${c.reset}`);
      for (const container of dockerCleanup.pausedContainers) {
        try {
          execSync(`docker rm -f ${container.name} 2>/dev/null`, { stdio: 'ignore', timeout: 10000 });
          console.log(`  ${c.green}✓${c.reset} Removed ${c.cyan}${container.name}${c.reset} ${c.dim}(using native Python instead)${c.reset}`);
        } catch {}
      }
      console.log('');
    }
  }

  // ========== PRE-STAGE: QOMS System Metrics ==========
  // Show current system resource state
  const metrics = qoms.getMetrics();
  if (metrics.cpuPercent > 50 || metrics.ramPercent > 50) {
    console.log(`${c.yellow}⚡ System Resources${c.reset}`);
    console.log(`  ${c.dim}CPU:${c.reset} ${metrics.cpuPercent > 70 ? c.red : c.yellow}${metrics.cpuPercent}%${c.reset}  ${c.dim}RAM:${c.reset} ${metrics.ramPercent > 70 ? c.red : c.yellow}${metrics.ramPercent}%${c.reset} ${c.dim}(${metrics.freeRamMB}MB free)${c.reset}`);
    if (metrics.cpuPercent > 70 || metrics.ramPercent > 70) {
      console.log(`  ${c.dim}QOMS will throttle operations to stay under limits${c.reset}`);
    }
    console.log('');
  }

  // ========== PRE-STAGE: Verify Setup Prerequisites ==========
  // Check if specmem setup has been run, if not, run it automatically
  const setupChecks = await verifySetupPrerequisites(projectPath);
  if (setupChecks.needsSetup) {
    // runAutoSetup uses its own ProgressUI - no console.log needed
    const setupResult = await runAutoSetup(projectPath);
    if (!setupResult.success) {
      process.stdout.write(`${c.red}✗ Setup failed: ${setupResult.error}${c.reset}\n`);
      process.exit(1);
    }
  }

  // ========== PRE-STAGE: Check for Existing Sessions ==========
  // Warn if re-initializing with running sessions
  const projectId = path.basename(projectPath).replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const existingBrain = `specmem-${projectId}`;
  const existing = `claude-${projectId}`;

  let runningScreens = '';
  try {
    runningScreens = execSync('screen -ls 2>/dev/null || true', { encoding: 'utf8' });
  } catch (e) {
    // yooo screen list failed in main - assuming no sessions running
    if (process.env.SPECMEM_DEBUG) console.log('[MAIN] screen -ls failed: ' + e.message);
  }

  const brainRunning = runningScreens.includes(existingBrain);
  const claudeRunning = runningScreens.includes(existing);

  // Smart session detection with user-friendly options
  let respawnBrainOnly = false;
  let skipScorchedEarth = false;
  let skipBrainAttach = false; // Set to true for hard restart - don't auto-attach to Brain

  if (brainRunning || claudeRunning) {
    // Prompt for confirmation
    const readline = require('readline');

    // CASE 1: Brain dead,  alive - offer "Respawn Brain" option
    if (!brainRunning && claudeRunning) {
      console.log(`${c.bgCyan}${c.white}${c.bold} 🧠 BRAIN DEAD - CLAUDE STILL RUNNING  ${c.reset}`);
      console.log('');
      console.log(`  ${c.red}✗${c.reset} Brain: ${c.dim}not running${c.reset}`);
      console.log(`  ${c.green}●${c.reset}  running: ${c.cyan}${existing}${c.reset}`);
      console.log('');
      console.log(`${c.cyan}  Options:${c.reset}`);
      console.log(`  ${c.brightGreen}[R]${c.reset} Respawn Brain ${c.dim}- Just relaunch Brain console ( keeps working)${c.reset}`);
      console.log(`  ${c.brightRed}[H]${c.reset} Hard restart  ${c.dim}- Kill everything, scorched earth, fresh start${c.reset}`);
      console.log(`  ${c.dim}[C]${c.reset} Cancel        ${c.dim}- Exit without changes${c.reset}`);
      console.log('');

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise((resolve) => {
        rl.question(`${c.brightCyan}${c.bold}  Choice? ${c.reset}${c.dim}(R/h/c): ${c.reset}`, (ans) => {
          rl.close();
          resolve(ans.toLowerCase().trim() || 'r'); // Default to Respawn
        });
      });

      if (answer === 'c' || answer === 'cancel') {
        console.log('');
        console.log(`${c.dim}  Cancelled.${c.reset}`);
        console.log(`${c.dim}  Attach to :${c.reset} ${c.cyan}screen -r ${existing}${c.reset}`);
        console.log('');
        process.exit(0);
      } else if (answer === 'r' || answer === 'respawn' || answer === '') {
        console.log('');
        console.log(`${c.green}  ✓ Respawning Brain only -  will keep working${c.reset}`);
        console.log('');
        respawnBrainOnly = true;
        skipScorchedEarth = true;
      } else {
        // Hard restart
        console.log('');
        console.log(`${c.yellow}  Hard restart selected - stopping ...${c.reset}`);
        try {
          execSync(`screen -S ${existing} -X quit 2>/dev/null || true`, { stdio: 'ignore' });
          console.log(`  ${c.green}✓${c.reset} Stopped  session`);
        } catch (e) {
          // yooo screen quit failed - session probably already dead
          if (process.env.SPECMEM_DEBUG) console.log('[MAIN] screen quit failed: ' + e.message);
        }
        await new Promise(r => setTimeout(r, 150));
        // Clear screen and re-show banner after hard restart
        process.stdout.write('\x1b[2J\x1b[H\x1b[3J');
        await showAnimatedBanner();
      }
    }
    // CASE 2: Both running - offer Hard restart, Brain entry, or Cancel
    else if (brainRunning && claudeRunning) {
      console.log(`${c.bgRed}${c.white}${c.bold} ⚠️  BOTH SESSIONS RUNNING  ${c.reset}`);
      console.log('');
      console.log(`  ${c.green}●${c.reset} Brain running:  ${c.cyan}${existingBrain}${c.reset}`);
      console.log(`  ${c.green}●${c.reset}  running: ${c.cyan}${existing}${c.reset}`);
      console.log('');
      console.log(`${c.yellow}  Options:${c.reset}`);
      console.log(`  ${c.brightRed}[H]${c.reset} Hard restart  ${c.dim}- Kill all, scorched earth, fresh start${c.reset}`);
      console.log(`  ${c.brightCyan}[B]${c.reset} Brain CLI     ${c.dim}- Enter SpecMem Brain console for debugging${c.reset}`);
      console.log(`  ${c.dim}[C]${c.reset} Cancel        ${c.dim}- Exit and keep sessions running${c.reset}`);
      console.log('');

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise((resolve) => {
        rl.question(`${c.brightCyan}${c.bold}  Choice: ${c.reset}${c.dim}(H/B/C): ${c.reset}`, (ans) => {
          rl.close();
          resolve(ans.toLowerCase().trim());
        });
      });

      // [B] Brain CLI - launch console directly
      if (answer === 'b' || answer === 'brain') {
        console.log('');
        console.log(`${c.cyan}  Launching Brain CLI...${c.reset}`);
        console.log('');
        const consoleScript = path.join(__dirname, '..', 'bin', 'specmem-console.cjs');
        const { spawnSync } = require('child_process');
        spawnSync('node', [consoleScript], {
          cwd: projectPath,
          stdio: 'inherit',
          env: { ...process.env, SPECMEM_PROJECT_PATH: projectPath }
        });
        process.exit(0);
      }

      // [C] Cancel or anything else
      if (answer !== 'y' && answer !== 'yes' && answer !== 'h') {
        console.log('');
        console.log(`${c.dim}  Cancelled. Sessions preserved.${c.reset}`);
        console.log(`${c.dim}  Attach to:${c.reset}`);
        console.log(`    ${c.cyan}screen -r ${existingBrain}${c.reset}  ${c.dim}(Brain)${c.reset}`);
        console.log(`    ${c.cyan}screen -r ${existing}${c.reset}  ${c.dim}()${c.reset}`);
        console.log('');
        process.exit(0);
      }

      console.log('');
      console.log(`${c.yellow}  Stopping sessions...${c.reset}`);

      // CRITICAL: Check if we're running INSIDE a screen that we're about to kill
      const currentScreen = process.env.STY || '';
      const isInsideBrain = currentScreen.includes(existingBrain.split('.')[0]);
      const isInside = currentScreen.includes(existing.split('.')[0]);

      if (isInsideBrain || isInside) {
        console.log('');
        console.log(`${c.bgYellow}${c.black}${c.bold} ⚠️  RUNNING INSIDE SCREEN  ${c.reset}`);
        console.log('');
        console.log(`  ${c.yellow}You're running this from inside ${isInsideBrain ? 'Brain' : ''} screen.${c.reset}`);
        console.log(`  ${c.yellow}Hard restart will kill this terminal!${c.reset}`);
        console.log('');
        console.log(`  ${c.cyan}Options:${c.reset}`);
        console.log(`  ${c.brightGreen}1.${c.reset} Detach first: ${c.dim}Ctrl+A then D${c.reset}`);
        console.log(`  ${c.brightGreen}2.${c.reset} Then run:     ${c.cyan}specmem-init${c.reset} ${c.dim}from a normal terminal${c.reset}`);
        console.log('');
        console.log(`  ${c.dim}Or press Enter to proceed anyway (terminal will close)${c.reset}`);

        const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
        await new Promise((resolve) => {
          rl2.question(`${c.brightYellow}  Continue anyway? ${c.reset}${c.dim}(Enter to continue, Ctrl+C to abort): ${c.reset}`, () => {
            rl2.close();
            resolve();
          });
        });
        console.log('');
      }

      // Save  progress before stopping
      try {
        const logFile = path.join(projectPath, 'specmem', 'sockets', 'claude-screen.log');
        const lastSessionFile = path.join(projectPath, 'specmem', 'sockets', 'last-session.txt');
        let lastOutput = '';
        try {
          const tmpFile = `/tmp/specmem-save-${Date.now()}.txt`;
          execSync(`screen -S ${existing} -p 0 -X hardcopy ${tmpFile}`, { stdio: 'ignore' });
          lastOutput = fs.readFileSync(tmpFile, 'utf8');
          fs.unlinkSync(tmpFile);
        } catch (e) {
          if (fs.existsSync(logFile)) {
            const content = fs.readFileSync(logFile, 'utf8');
            lastOutput = content.split('\n').slice(-500).join('\n');
          }
        }
        if (lastOutput) {
          safeMkdir(path.dirname(lastSessionFile));
          const recoveryContent = `#  Session HARD RESTART RECOVERY
# =====================================
# Project: ${projectPath}
# Session: ${existing}
# Saved: ${new Date().toISOString()}
# Reason: hard_restart_reinit
#
# Last 500 lines before restart:
# ==============================

${lastOutput}

# ==============================
# End of recovery capture
`;
          fs.writeFileSync(lastSessionFile, recoveryContent, 'utf8');
          console.log(`  ${c.green}✓${c.reset} Saved  context to last-session.txt`);
        }
        execSync(`screen -S ${existing} -X quit 2>/dev/null || true`, { stdio: 'ignore' });
        console.log(`  ${c.green}✓${c.reset} Stopped  session`);
      } catch (e) {
        execSync(`screen -S ${existing} -X quit 2>/dev/null || true`, { stdio: 'ignore' });
      }

      execSync(`screen -S ${existingBrain} -X quit 2>/dev/null || true`, { stdio: 'ignore' });
      console.log(`  ${c.green}✓${c.reset} Stopped Brain session`);
      skipBrainAttach = true; // Hard restart - don't auto-attach to Brain at the end
      await new Promise(r => setTimeout(r, 150));
      // Clear screen and re-show banner after hard restart
      process.stdout.write('\x1b[2J\x1b[H\x1b[3J');
      await showAnimatedBanner();
    }
    // CASE 3: Only Brain running (no ) - just reuse or restart
    else if (brainRunning && !claudeRunning) {
      console.log(`${c.bgYellow}${c.white}${c.bold} 🧠 BRAIN RUNNING - NO CLAUDE  ${c.reset}`);
      console.log('');
      console.log(`  ${c.green}●${c.reset} Brain running: ${c.cyan}${existingBrain}${c.reset}`);
      console.log(`  ${c.red}✗${c.reset} : ${c.dim}not running${c.reset}`);
      console.log('');
      console.log(`${c.cyan}  Options:${c.reset}`);
      console.log(`  ${c.brightGreen}[S]${c.reset} Spawn   ${c.dim}- Just launch , keep existing Brain${c.reset}`);
      console.log(`  ${c.brightCyan}[B]${c.reset} Brain CLI     ${c.dim}- Enter SpecMem Brain console for debugging${c.reset}`);
      console.log(`  ${c.brightRed}[H]${c.reset} Hard restart  ${c.dim}- Kill Brain, scorched earth, fresh start${c.reset}`);
      console.log(`  ${c.dim}[C]${c.reset} Cancel        ${c.dim}- Exit without changes${c.reset}`);
      console.log('');

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise((resolve) => {
        rl.question(`${c.brightCyan}${c.bold}  Choice? ${c.reset}${c.dim}(S/B/H/C): ${c.reset}`, (ans) => {
          rl.close();
          resolve(ans.toLowerCase().trim() || 's'); // Default to Spawn
        });
      });

      // [B] Brain CLI - launch console directly
      if (answer === 'b' || answer === 'brain') {
        console.log('');
        console.log(`${c.cyan}  Launching Brain CLI...${c.reset}`);
        console.log('');
        const consoleScript = path.join(__dirname, '..', 'bin', 'specmem-console.cjs');
        const { spawnSync } = require('child_process');
        spawnSync('node', [consoleScript], {
          cwd: projectPath,
          stdio: 'inherit',
          env: { ...process.env, SPECMEM_PROJECT_PATH: projectPath }
        });
        process.exit(0);
      }

      if (answer === 'c' || answer === 'cancel') {
        console.log('');
        console.log(`${c.dim}  Cancelled.${c.reset}`);
        console.log(`${c.dim}  Attach to Brain:${c.reset} ${c.cyan}screen -r ${existingBrain}${c.reset}`);
        console.log('');
        process.exit(0);
      } else if (answer === 's' || answer === 'spawn' || answer === '') {
        console.log('');
        console.log(`${c.green}  ✓ Spawning  only - keeping existing Brain${c.reset}`);
        console.log('');
        skipScorchedEarth = true;
        // Will skip to screen sessions and only launch 
      } else {
        // Hard restart
        console.log('');
        console.log(`${c.yellow}  Hard restart selected - stopping Brain...${c.reset}`);
        execSync(`screen -S ${existingBrain} -X quit 2>/dev/null || true`, { stdio: 'ignore' });
        console.log(`  ${c.green}✓${c.reset} Stopped Brain session`);
        skipBrainAttach = true; // Hard restart - don't auto-attach to Brain at the end
        await new Promise(r => setTimeout(r, 150));
        // Clear screen and re-show banner after hard restart
        process.stdout.write('\x1b[2J\x1b[H\x1b[3J');
        await showAnimatedBanner();
      }
    }
  }

  const ui = new ProgressUI();
  _currentUI = ui;  // Set module-level reference for uiWarn()

  // Handle cleanup
  process.on('SIGINT', () => { ui.stop(); console.log('\n  Cancelled.'); process.exit(0); });

  try {
    // Always launch screens unless --no-console is specified
    const launchScreens = !args.includes('--no-console');

    // Adjust total stages based on mode
    if (!launchScreens) {
      ui.totalStages = 9; // No screen sessions stage
    } else if (skipScorchedEarth) {
      ui.totalStages = 2; // Quick mode: just analyze + screens
    } else {
      ui.totalStages = 10; // Full mode with screen sessions
    }

    ui.start();

    // Stage 1: Analyze (always run)
    const analysis = await analyzeProject(projectPath, ui);

    // Skip stages 2-9 if respawning brain or just spawning 
    let scorched = { wipedItems: 0 };
    let modelConfig = null;
    let embeddingResult = { serverRunning: false };
    let codebaseResult = { filesIndexed: 0, embeddingsGenerated: 0, errors: [] };
    let tokenResult = { success: true };
    let deployResult = { globalCommands: 0, projectCommands: 0 };
    let sessionResult = { extracted: 0, stored: 0, sessions: 0, failed: 0, errors: [] };
    let verification = { passed: 0, total: 0 };

    // Track all initialization errors/warnings for final summary
    const initIssues = [];

    // Phase transition delay helper (smooths UI updates)
    const phaseDelay = () => new Promise(r => setTimeout(r, 100));

    if (!skipScorchedEarth) {
      // Stage 2: CLEANUP
      scorched = await scorchedEarth(projectPath, ui);
      await phaseDelay();

      // Stage 3: Model optimization (EARLY - needed for embedding config)
      modelConfig = await optimizeModel(projectPath, analysis, ui);
      await phaseDelay();

      // Stage 4: Embedding Docker (EARLY - so embeddings are available for indexing!)
      embeddingResult = await coldStartEmbeddingDocker(projectPath, modelConfig, ui, null);
      if (!embeddingResult.serverRunning) {
        initIssues.push({ stage: 'Embedding', msg: 'Docker embedding server not started' });
      }
      await phaseDelay();

      // Stage 5: Codebase indexing (NOW with embeddings available!)
      codebaseResult = await indexCodebase(projectPath, ui, embeddingResult);
      if (codebaseResult.embeddingsGenerated === 0 && codebaseResult.filesIndexed > 0) {
        initIssues.push({ stage: 'Codebase', msg: `${codebaseResult.filesIndexed} files indexed but 0 embeddings generated` });
      }
      if (codebaseResult.errors && codebaseResult.errors.length > 0) {
        initIssues.push({ stage: 'Codebase', msg: `${codebaseResult.errors.length} indexing errors` });
      }

      await phaseDelay();

      // Stage 6: Session extraction (NOW with embeddings available!)
      sessionResult = await extractSessions(projectPath, ui, embeddingResult);
      if (sessionResult.failed > 0) {
        initIssues.push({ stage: 'Sessions', msg: `${sessionResult.failed} entries failed to store` });
      }
      if (sessionResult.skipped === true && sessionResult.reason) {
        // Only log as issue if extraction was actually skipped due to error
        // (not when entries were skipped as duplicates - that's fine)
        initIssues.push({ stage: 'Sessions', msg: `Skipped: ${sessionResult.reason}` });
      }
      await phaseDelay();

      // Stage 7: Token compression
      tokenResult = await compressTokens(projectPath, ui);
      await phaseDelay();

      // Stage 8: Command deployment
      deployResult = await deployCommands(projectPath, ui);
      await phaseDelay();

      // Stage 9: Final verification
      verification = await finalVerification(projectPath, analysis, modelConfig, ui);

      // Write init completion marker - used by MCP watcher to know when init ran
      // This helps the watcher sync any files modified between init and MCP startup
      const markerPath = path.join(projectPath, 'specmem', 'sockets', 'init-complete.json');
      try {
        safeMkdir(path.dirname(markerPath));
        fs.writeFileSync(markerPath, JSON.stringify({
          timestamp: new Date().toISOString(),
          unixTimestamp: Date.now(),
          codebaseIndexed: codebaseResult.filesIndexed,
          embeddingsGenerated: codebaseResult.embeddingsGenerated,
          sessionsExtracted: sessionResult.extracted,
          verificationPassed: verification.passed,
          verificationTotal: verification.total
        }, null, 2));
      } catch (markerErr) {
        // non-fatal - just helps with debugging
      }
    }

    // Stage 10: Launch screens (always unless --no-console)
    let screenResult = { brain: false, claude: false };

    if (launchScreens) {
      screenResult = await launchScreenSessions(projectPath, ui);
    }

    // Complete - different message based on mode
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const completionMsg = skipScorchedEarth
      ? (respawnBrainOnly ? `Brain respawned in ${elapsed}s` : ` spawned in ${elapsed}s`)
      : `Full initialization complete in ${elapsed}s`;

    // Save init stats for console to display
    const initStats = {
      totalMs: Date.now() - startTime,
      elapsed,
      tier: analysis.tier,
      complexity: analysis.complexity,
      files: analysis.files.total,
      size: analysis.size,
      loc: analysis.lines.code,
      commands: !skipScorchedEarth ? { project: deployResult.projectCommands, global: deployResult.globalCommands } : null,
      embedding: !skipScorchedEarth ? {
        running: embeddingResult.serverRunning,
        warmupMs: embeddingResult.warmupLatency
      } : null,
      codebase: codebaseResult.filesIndexed > 0 ? {
        files: codebaseResult.filesIndexed,
        embeddings: codebaseResult.embeddingsGenerated
      } : null,
      sessions: sessionResult.extracted > 0 ? {
        entries: sessionResult.extracted,
        sessions: sessionResult.sessions
      } : null,
      scorched: !skipScorchedEarth ? scorched.wipedItems : null,
      mode: skipScorchedEarth ? (respawnBrainOnly ? 'brain-respawn' : 'claude-spawn') : 'full'
    };
    try {
      safeMkdir(path.join(projectPath, 'specmem', 'sockets'));
      fs.writeFileSync(
        path.join(projectPath, 'specmem', 'sockets', 'init-stats.json'),
        JSON.stringify(initStats, null, 2)
      );
    } catch (e) { /* non-fatal */ }

    ui.complete(completionMsg);

    // Epic summary
    console.log('');
    console.log(`${c.dim}  ─────────────────────────────────────────────${c.reset}`);

    const tierColors = { small: c.green, medium: c.yellow, large: c.brightRed };
    const tierEmoji = { small: '🟢', medium: '🟡', large: '🔴' };

    console.log(`  ${c.dim}Tier:${c.reset}        ${tierEmoji[analysis.tier]} ${tierColors[analysis.tier]}${c.bold}${analysis.tier.toUpperCase()}${c.reset} ${c.dim}(complexity: ${analysis.complexity}/100)${c.reset}`);
    console.log(`  ${c.dim}Files:${c.reset}       ${c.white}${formatNumber(analysis.files.total)}${c.reset} ${c.dim}(${formatBytes(analysis.size)})${c.reset}`);
    console.log(`  ${c.dim}LOC:${c.reset}         ${c.white}${formatNumber(analysis.lines.code)}${c.reset}`);

    // Show full stats only if we did full init
    if (!skipScorchedEarth) {
      console.log(`  ${c.dim}Commands:${c.reset}    ${c.white}${deployResult.projectCommands}${c.reset} ${c.dim}project${c.reset} + ${c.white}${deployResult.globalCommands}${c.reset} ${c.dim}global${c.reset}`);
      console.log(`  ${c.dim}Embedding:${c.reset}   ${embeddingResult.serverRunning ? `${c.green}✓ Server ready (${embeddingResult.warmupLatency}ms)${c.reset}` : `${c.yellow}⏳ Will start on first use${c.reset}`}`);
      // Show codebase indexing stats
      if (codebaseResult.filesIndexed > 0) {
        console.log(`  ${c.dim}Codebase:${c.reset}    ${c.green}✓ ${codebaseResult.filesIndexed} files${c.reset} ${c.dim}indexed, ${codebaseResult.embeddingsGenerated} embeddings${c.reset}`);
      } else if (!embeddingResult.serverRunning) {
        console.log(`  ${c.dim}Codebase:${c.reset}    ${c.yellow}⏳ Will index on first MCP connect${c.reset}`);
      }
      // Show session extraction stats
      if (sessionResult.extracted > 0) {
        console.log(`  ${c.dim}Sessions:${c.reset}    ${c.green}✓ ${sessionResult.extracted} entries${c.reset} ${c.dim}from ${sessionResult.sessions} sessions${c.reset}`);
      } else if (sessionResult.skipped) {
        console.log(`  ${c.dim}Sessions:${c.reset}    ${c.yellow}⏳ Will extract on first MCP connect${c.reset}`);
      }
      console.log(`  ${c.dim}Scorched:${c.reset}    ${c.brightRed}🔥 ${scorched.wipedItems} items${c.reset} ${c.dim}wiped & rebuilt${c.reset}`);
      // Docker warm-start & cleanup stats
      if (dockerCleanup.dockerAvailable) {
        const parts = [];
        if (dockerCleanup.paused > 0) {
          parts.push(`${c.green}⚡ ${dockerCleanup.paused} warm-started${c.reset}`);
        }
        if (dockerCleanup.running > 0) {
          parts.push(`${c.green}● ${dockerCleanup.running} running${c.reset}`);
        }
        if (dockerCleanup.dead + dockerCleanup.exited > 0) {
          parts.push(`${c.dim}${dockerCleanup.dead + dockerCleanup.exited} cleaned${c.reset}`);
        }
        if (parts.length > 0) {
          console.log(`  ${c.dim}Docker:${c.reset}      ${c.brightCyan}🐳${c.reset} ${parts.join(', ')}`);
        }
      }
      // QOMS resource management stats
      const finalMetrics = qoms.getMetrics();
      console.log(`  ${c.dim}QOMS:${c.reset}        ${c.green}⚡${c.reset} ${c.dim}CPU:${c.reset} ${finalMetrics.cpuPercent}% ${c.dim}RAM:${c.reset} ${finalMetrics.ramPercent}%`);

      // Show any issues/warnings from initialization
      if (initIssues.length > 0) {
        console.log(`${c.dim}  ─────────────────────────────────────────────${c.reset}`);
        console.log(`  ${c.yellow}⚠️ Issues (${initIssues.length}):${c.reset}`);
        for (const issue of initIssues) {
          console.log(`    ${c.dim}[${issue.stage}]${c.reset} ${c.yellow}${issue.msg}${c.reset}`);
        }
      }
    } else {
      console.log(`  ${c.dim}Mode:${c.reset}        ${c.cyan}Quick ${respawnBrainOnly ? '(Brain respawn)' : '( spawn)'}${c.reset}`);
    }

    if (launchScreens) {
      const brainSession = `specmem-${path.basename(projectPath).replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()}`;
      const claudeSession = `claude-${path.basename(projectPath).replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()}`;
      console.log(`${c.dim}  ─────────────────────────────────────────────${c.reset}`);
      console.log(`  ${c.dim}Screens:${c.reset}`);
      console.log(`    ${screenResult.brain ? c.green + '✓' : c.yellow + '○'} ${c.reset}Brain:  ${c.cyan}screen -r ${brainSession}${c.reset}`);
      console.log(`    ${screenResult.claude ? c.green + '✓' : c.yellow + '○'} ${c.reset}: ${c.cyan}screen -r ${claudeSession}${c.reset}`);
    }

    console.log(`${c.dim}  ─────────────────────────────────────────────${c.reset}`);
    console.log('');

    if (launchScreens) {
      console.log(`  ${c.brightGreen}${c.bold}Ready to flex!${c.reset}`);

      // If Brain is running AND we're not in hard restart mode, attach to it
      if (screenResult.brain && screenResult.brainSession && !skipBrainAttach) {
        console.log('');
        console.log(`  ${c.cyan}Attaching to SpecMem Brain in 1s...${c.reset}`);
        console.log(`  ${c.dim}( is in the centered window above)${c.reset}`);

        // Brief pause so user sees the message
        await sleep(300);

        // Clear screen before attaching for clean transition
        process.stdout.write('\x1b[2J\x1b[H');

        // FIX: Use spawnSync - blocks and gives screen full tty control
        const { spawnSync } = require('child_process');
        const result = spawnSync('screen', ['-r', screenResult.brainSession], {
          stdio: 'inherit',
          shell: false
        });

        // This only runs after screen exits (user detached or error)
        if (result.status !== 0) {
          console.log('');
          console.log(`  ${c.yellow}Screen attach returned ${result.status}${c.reset}`);
          console.log(`  ${c.dim}Re-attach manually: ${c.cyan}screen -r ${screenResult.brainSession}${c.reset}`);
        } else {
          console.log('');
          console.log(`  ${c.dim}Detached from Brain. Re-attach: ${c.cyan}screen -r ${screenResult.brainSession}${c.reset}`);
        }
        process.exit(0);
      } else if (screenResult.brain && screenResult.brainSession) {
        // Hard restart mode - still attach to Brain (new one was just launched)
        //  window was already opened, no need to show attach instructions
        console.log('');
        console.log(`  ${c.cyan}Attaching to SpecMem Brain...${c.reset}`);
        console.log(`  ${c.dim}( window already opened)${c.reset}`);

        await sleep(500); // Brief delay for hard restart

        process.stdout.write('\x1b[2J\x1b[H');

        const { spawnSync } = require('child_process');
        const result = spawnSync('screen', ['-r', screenResult.brainSession], {
          stdio: 'inherit',
          shell: false
        });

        if (result.status !== 0) {
          console.log('');
          console.log(`  ${c.yellow}Screen attach returned ${result.status}${c.reset}`);
          console.log(`  ${c.dim}Re-attach manually: ${c.cyan}screen -r ${screenResult.brainSession}${c.reset}`);
        } else {
          console.log('');
          console.log(`  ${c.dim}Detached from Brain. Re-attach: ${c.cyan}screen -r ${screenResult.brainSession}${c.reset}`);
        }
        process.exit(0);
      } else {
        // Brain failed to start - show instructions
        console.log('');
        console.log(`  ${c.yellow}Brain session not running${c.reset}`);
        if (screenResult.brainSession) {
          console.log(`  ${c.dim}Try manually:${c.reset} ${c.cyan}screen -r ${screenResult.brainSession}${c.reset}`);
        }
        // Note:  window was already opened, don't show attach instructions for it
      }
    } else {
      console.log(`  ${c.brightGreen}${c.bold}Ready to flex!${c.reset} ${c.dim}Try:${c.reset} ${c.cyan}/specmem${c.reset}${c.dim},${c.reset} ${c.cyan}/specmem-find${c.reset}${c.dim},${c.reset} ${c.cyan}/specmem-code${c.reset}`);
      console.log(`  ${c.dim}Or launch Brain:${c.reset} ${c.cyan}specmem-init${c.reset}`);
    }
    console.log('');

    // Init's job is done - exit cleanly so we don't hang around wasting resources
    process.exit(0);

  } catch (error) {
    cleanupSpeedMode();
    ui.fail(`Error: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    cleanupSpeedMode();
  }
}

main().catch((err) => {
  cleanupSpeedMode();
  console.error(err);
});
