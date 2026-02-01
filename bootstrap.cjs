#!/usr/bin/env node

/**
 * SpecMem Auto-Installer Bootstrap
 *
 * yooo this is the auto-install script that makes SpecMem just WORK
 * no cap it handles everything:
 * - auto-detects missing dependencies
 * - auto-installs npm packages
 * - auto-builds TypeScript
 * - auto-checks PostgreSQL
 * - auto-runs migrations
 * - just fucking WORKS with zero user intervention
 *
 * fr fr this go crazy - hardwicksoftwareservices
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const net = require('net');

// ============================================================================
// STARTUP LOGGING - Debug MCP connection issues
// ============================================================================
// Project-isolated startup log - uses {PROJECT_DIR}/specmem/run/
// Initially use fallback path, then switch after project path is known
// NO /tmp - everything in project directory!
let STARTUP_LOG_PATH = process.cwd() + '/specmem/run/mcp-startup.log';

/**
 * Write timestamped message to startup log file
 * This helps debug MCP connection issues by showing EXACTLY what happens during startup
 */
function startupLog(msg, error = null) {
  const timestamp = new Date().toISOString();
  const pid = process.pid;
  let logLine = `${timestamp} [PID:${pid}] ${msg}\n`;
  if (error) {
    logLine += `${timestamp} [PID:${pid}] ERROR: ${error.message || error}\n`;
    if (error.stack) {
      logLine += `${timestamp} [PID:${pid}] STACK: ${error.stack}\n`;
    }
  }
  try {
    fs.appendFileSync(STARTUP_LOG_PATH, logLine);
  } catch (e) {
    // Ignore write errors - logging should never break the app
  }
}

// Clear previous log and mark start
try {
  fs.writeFileSync(STARTUP_LOG_PATH, `=== SpecMem Bootstrap Starting ===\n`);
  startupLog('bootstrap.cjs ENTRY POINT - script loaded');
  startupLog(`Working directory: ${process.cwd()}`);
  startupLog(`Script location: ${__dirname}`);
  startupLog(`Node version: ${process.version}`);
  startupLog(`Platform: ${process.platform} ${os.arch()}`);
  startupLog(`stdin.isTTY: ${process.stdin.isTTY}`);
} catch (e) {
  // Ignore - just continue
}

// ============================================================================
// Embedded PostgreSQL Configuration
// ============================================================================

const PGDATA_DIR = 'pgdata';
const PG_DEFAULT_PORT_START = 5500; // Start searching for available ports from here
const PG_DEFAULT_PORT_END = 5600;   // End range for port search

// Load environment variables - PROJECT .env FIRST, then package specmem.env as fallback
// This ensures existing projects keep working with their own credentials!
const projectEnvPath = path.join(process.cwd(), '.env');
if (fs.existsSync(projectEnvPath)) {
  require('dotenv').config({ path: projectEnvPath });
  startupLog(`dotenv loaded from PROJECT .env: ${projectEnvPath}`);
}
// Load package specmem.env WITHOUT override - project .env takes precedence
require('dotenv').config({ path: path.join(__dirname, 'specmem.env') });
startupLog('dotenv loaded from package specmem.env (fallback)');

// ============================================================================
// CRITICAL FIX: Runtime DB credential auto-detection with connection testing
// Priority order for password candidates:
//   1. SPECMEM_PASSWORD env var (if set and not stale)
//   2. SPECMEM_DB_PASSWORD env var (if different from SPECMEM_PASSWORD)
//   3. Default 'specmem_westayunprofessional'
// If connection fails, tries next candidate until one works
// ============================================================================
const DEFAULT_CREDENTIAL = 'specmem_westayunprofessional';
const STALE_VALUES = ['specmem', 'specmem_user', 'specmem_pass', '', undefined, null];

function isStaleValue(val) {
  return !val || STALE_VALUES.includes(val) || (typeof val === 'string' && val.trim() === '');
}

// Build list of password candidates to try (ordered by priority)
function getPasswordCandidates() {
  const candidates = [];
  const seen = new Set();

  // Priority 1: SPECMEM_PASSWORD (most explicit)
  const envPassword = process.env.SPECMEM_PASSWORD;
  if (envPassword && !isStaleValue(envPassword) && !seen.has(envPassword)) {
    candidates.push({ value: envPassword, source: 'SPECMEM_PASSWORD' });
    seen.add(envPassword);
  }

  // Priority 2: SPECMEM_DB_PASSWORD (might be set differently)
  const dbPassword = process.env.SPECMEM_DB_PASSWORD;
  if (dbPassword && !isStaleValue(dbPassword) && !seen.has(dbPassword)) {
    candidates.push({ value: dbPassword, source: 'SPECMEM_DB_PASSWORD' });
    seen.add(dbPassword);
  }

  // Priority 3: Default credential
  if (!seen.has(DEFAULT_CREDENTIAL)) {
    candidates.push({ value: DEFAULT_CREDENTIAL, source: 'default' });
    seen.add(DEFAULT_CREDENTIAL);
  }

  return candidates;
}

// Test if we can connect to PostgreSQL with given credentials
function testDbConnection(dbName, user, password, host = 'localhost', port = 5432) {
  try {
    const { execSync } = require('child_process');
    // Quick connection test using psql
    const result = execSync(
      `PGPASSWORD="${password}" psql -h ${host} -p ${port} -U "${user}" -d "${dbName}" -c "SELECT 1" -t 2>/dev/null`,
      { timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return result.trim() === '1';
  } catch (e) {
    return false;
  }
}

// Find working credentials by testing connection
function resolveWorkingCredentials() {
  const candidates = getPasswordCandidates();
  const host = process.env.SPECMEM_DB_HOST || 'localhost';
  const port = process.env.SPECMEM_DB_PORT || 5432;

  startupLog(`Testing ${candidates.length} credential candidate(s)...`);

  for (const candidate of candidates) {
    // Try with credential as db name, user, and password (unified)
    if (testDbConnection(candidate.value, candidate.value, candidate.value, host, port)) {
      startupLog(`✅ Working credentials found via ${candidate.source}`);
      return candidate.value;
    }
  }

  // None worked - fall back to default and let it fail later with better error
  startupLog(`⚠️ No working credentials found, using default (may fail)`);
  return DEFAULT_CREDENTIAL;
}

// Resolve credentials (with connection test)
let UNIFIED_CRED;
try {
  UNIFIED_CRED = resolveWorkingCredentials();
} catch (e) {
  startupLog(`Credential test failed: ${e.message}, using default`);
  UNIFIED_CRED = DEFAULT_CREDENTIAL;
}

// Set all credential env vars to the working value
function setCredential(envKey, value) {
  const current = process.env[envKey];
  if (current !== value) {
    process.env[envKey] = value;
  }
}

setCredential('SPECMEM_DB_NAME', UNIFIED_CRED);
setCredential('SPECMEM_DB_USER', UNIFIED_CRED);
setCredential('SPECMEM_DB_PASSWORD', UNIFIED_CRED);
setCredential('SPECMEM_DASHBOARD_PASSWORD', UNIFIED_CRED);

// Function to get the unified credential - used throughout the codebase
function getUnifiedCredential() {
  return UNIFIED_CRED;
}

startupLog(`DB credentials set: DB_NAME="${process.env.SPECMEM_DB_NAME}", DB_USER="${process.env.SPECMEM_DB_USER}"`);

// ============================================================================
// MULTI-PROJECT ISOLATION: Set SPECMEM_PROJECT_PATH ONCE at startup
// REMOVED: Marker file fallback - caused race condition with simultaneous projects!
// Each MCP server instance gets its project path from  Code's cwd variable.
// ============================================================================
if (!process.env.SPECMEM_PROJECT_PATH) {
  // Use cwd from  Code (passed as env var) - this is set per-session
  process.env.SPECMEM_PROJECT_PATH = process.cwd();
  startupLog(`SPECMEM_PROJECT_PATH set from cwd: ${process.env.SPECMEM_PROJECT_PATH}`);
} else {
  startupLog(`SPECMEM_PROJECT_PATH already set: ${process.env.SPECMEM_PROJECT_PATH}`);
}

// Generate project hash for instance isolation (COLLISION-FREE!)
// Uses SHA256 hash of FULL project path to ensure different paths get different instances.
// This prevents collisions between /specmem and ~/specmem.
// Pattern: First 16 chars of hash (e.g., "a1b2c3d4e5f6a7b8")
const normalizedPath = path.resolve(process.env.SPECMEM_PROJECT_PATH).toLowerCase().replace(/\\/g, '/');
const fullHash = crypto.createHash('sha256').update(normalizedPath).digest('hex');
const PROJECT_HASH = fullHash.substring(0, 16);
process.env.SPECMEM_PROJECT_DIR_NAME = PROJECT_HASH;
process.env.SPECMEM_PROJECT_HASH = PROJECT_HASH;

startupLog(`Project hash (instance isolation): ${PROJECT_HASH} for path: ${normalizedPath}`);

// ============================================================================
// CODEBASE INDEXER DEFAULTS - Enabled by default for code search
// Sets SPECMEM_CODEBASE_ENABLED=true and SPECMEM_CODEBASE_PATH=project path
// This ensures find_code_pointers works out of the box per-project
// ============================================================================
if (!process.env.SPECMEM_CODEBASE_ENABLED) {
  process.env.SPECMEM_CODEBASE_ENABLED = 'true';
  startupLog('SPECMEM_CODEBASE_ENABLED defaulting to true');
}
if (!process.env.SPECMEM_CODEBASE_PATH) {
  process.env.SPECMEM_CODEBASE_PATH = process.env.SPECMEM_PROJECT_PATH;
  startupLog(`SPECMEM_CODEBASE_PATH defaulting to PROJECT_PATH: ${process.env.SPECMEM_CODEBASE_PATH}`);
}

startupLog(`Codebase config: ENABLED=${process.env.SPECMEM_CODEBASE_ENABLED}, PATH=${process.env.SPECMEM_CODEBASE_PATH}`);

// ============================================================================
// CRITICAL: Kill stale bootstrap processes from SAME project before starting
// This prevents zombie MCP processes that cache old socket paths
// ============================================================================
function killStaleBootstraps() {
  const currentPid = process.pid;
  const projectPath = process.env.SPECMEM_PROJECT_PATH;

  try {
    // Find all node processes running bootstrap.cjs from this same directory
    const result = execSync(
      `ps aux | grep -E "node.*bootstrap\\.cjs" | grep -v grep | awk '{print $2}'`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();

    if (!result) return;

    const pids = result.split('\n').filter(p => p.trim());
    for (const pidStr of pids) {
      const pid = parseInt(pidStr.trim(), 10);
      if (isNaN(pid) || pid === currentPid) continue;

      // Check if this process is from the same project directory
      try {
        const cwdLink = fs.readlinkSync(`/proc/${pid}/cwd`);
        if (cwdLink === projectPath || cwdLink.startsWith(projectPath + '/')) {
          // CRITICAL: Only kill processes older than 30 seconds to avoid race conditions
          // when  spawns multiple MCP server attempts in quick succession
          try {
            const stat = fs.statSync(`/proc/${pid}`);
            const processAge = Date.now() - stat.ctimeMs;
            if (processAge < 30000) {
              startupLog(`CLEANUP: Skipping young process ${pid} (age: ${Math.round(processAge/1000)}s < 30s)`);
              continue;
            }
          } catch (e) {
            // Can't determine age, skip to be safe
            continue;
          }

          startupLog(`CLEANUP: Killing stale bootstrap process ${pid} (cwd: ${cwdLink})`);
          process.kill(pid, 'SIGTERM');
          // Give it a moment to die gracefully, then force kill
          setTimeout(() => {
            try { process.kill(pid, 'SIGKILL'); } catch (e) { /* already dead */ }
          }, 1000);
        }
      } catch (e) {
        // Process might have died or we can't read its cwd - ignore
      }
    }
  } catch (e) {
    // Cleanup is best-effort - don't fail startup if it doesn't work
    startupLog(`CLEANUP: Could not check for stale processes: ${e.message}`);
  }
}

// Run cleanup immediately
killStaleBootstraps();

// ============================================================================
// CRITICAL: Clean up stale socket files on startup
// Socket files can get orphaned when containers crash or are improperly stopped
// Pattern: {PROJECT_DIR}/specmem/sockets/*.sock
// Also cleans up LEGACY locations (deprecated hash-based directories)
// ============================================================================
function cleanupStaleSockets() {
  const projectPath = process.env.SPECMEM_PROJECT_PATH;
  const projectDirName = PROJECT_HASH;

  // Primary socket directory (THE ONLY VALID LOCATION)
  // Pattern: {PROJECT_DIR}/specmem/sockets/
  const primarySocketDir = path.join(projectPath, 'specmem', 'sockets');

  // Legacy socket directories (deprecated, should be cleaned up and removed)
  // These should NOT exist - clean them up if found
  const legacyDirs = [
    path.join(os.homedir(), '.specmem', 'sockets'),               // Old ~/.specmem/sockets
    path.join(os.homedir(), '.specmem', 'instances'),             // Old hash-based instances dir
    `/tmp/specmem-${projectDirName}/sockets`,                     // Old /tmp project-based
    `/tmp/specmem-sockets`,                                        // Very old /tmp global
  ];

  // Clean primary directory
  cleanupSocketDir(primarySocketDir, 'PRIMARY');

  // Clean up legacy directories - remove them entirely if empty after cleanup
  for (const legacyDir of legacyDirs) {
    if (fs.existsSync(legacyDir)) {
      startupLog(`SOCKET CLEANUP: Found LEGACY socket dir (should not exist): ${legacyDir}`);
      cleanupSocketDir(legacyDir, 'LEGACY');

      // Try to remove the legacy directory if it's now empty
      try {
        const remaining = fs.readdirSync(legacyDir);
        if (remaining.length === 0) {
          fs.rmdirSync(legacyDir);
          startupLog(`SOCKET CLEANUP: Removed empty legacy directory: ${legacyDir}`);
        }
      } catch (e) {
        // Ignore - might be in use or have other files
      }
    }
  }
}

/**
 * Clean stale sockets from a specific directory
 */
function cleanupSocketDir(socketDir, label) {
  startupLog(`SOCKET CLEANUP [${label}]: Checking: ${socketDir}`);

  if (!fs.existsSync(socketDir)) {
    startupLog(`SOCKET CLEANUP [${label}]: Directory does not exist, nothing to clean`);
    return;
  }

  try {
    const files = fs.readdirSync(socketDir);
    const sockFiles = files.filter(f => f.endsWith('.sock'));

    if (sockFiles.length === 0) {
      startupLog(`SOCKET CLEANUP [${label}]: No socket files found`);
      return;
    }

    startupLog(`SOCKET CLEANUP [${label}]: Found ${sockFiles.length} socket file(s): ${sockFiles.join(', ')}`);

    for (const sockFile of sockFiles) {
      const sockPath = path.join(socketDir, sockFile);

      try {
        // Check if socket is actually in use by trying to connect
        const isAlive = checkSocketAlive(sockPath);

        if (!isAlive) {
          // Socket is stale - remove it
          startupLog(`SOCKET CLEANUP [${label}]: Removing stale socket: ${sockPath}`);
          fs.unlinkSync(sockPath);
        } else {
          startupLog(`SOCKET CLEANUP [${label}]: Socket is alive, keeping: ${sockPath}`);
        }
      } catch (e) {
        // If we can't check or remove, log and continue
        startupLog(`SOCKET CLEANUP [${label}]: Error handling ${sockPath}: ${e.message}`);
      }
    }
  } catch (e) {
    startupLog(`SOCKET CLEANUP [${label}]: Error reading directory: ${e.message}`);
  }
}

/**
 * Check if a Unix socket is alive by checking if a process is listening on it
 * Uses lsof or fuser to check synchronously - much faster than connecting
 * Returns true if something is listening, false otherwise
 */
function checkSocketAlive(sockPath) {
  try {
    // Method 1: Try fuser (faster)
    try {
      execSync(`fuser "${sockPath}" 2>/dev/null`, { encoding: 'utf8', timeout: 1000 });
      return true; // fuser exits 0 if processes are using the socket
    } catch (e) {
      // fuser exits non-zero if nothing is using the socket
    }

    // Method 2: Try lsof (fallback)
    try {
      const result = execSync(`lsof "${sockPath}" 2>/dev/null | head -2`, { encoding: 'utf8', timeout: 1000 });
      return result.trim().length > 0;
    } catch (e) {
      // lsof exits non-zero if nothing is using the socket
    }

    // If neither tool works, assume socket is stale
    return false;
  } catch (e) {
    return false;
  }
}

// Run socket cleanup synchronously during bootstrap
cleanupStaleSockets();

// Now that we have the project path, update paths to be project-isolated
// ALL data goes in {PROJECT_DIR}/specmem/ - NO /tmp, NO ~/.specmem!
const projectSpecmemDir = path.join(process.env.SPECMEM_PROJECT_PATH, 'specmem');
const projectRunDir = path.join(projectSpecmemDir, 'run');
STARTUP_LOG_PATH = path.join(projectRunDir, 'mcp-startup.log');

// Ensure the project-specific directories exist
try {
  if (!fs.existsSync(projectRunDir)) {
    fs.mkdirSync(projectRunDir, { recursive: true, mode: 0o755 });
  }
} catch (e) {
  // Ignore - will be created on first log write
}

startupLog(`SPECMEM_PROJECT_DIR_NAME: ${PROJECT_HASH} (used for ALL naming!)`);
startupLog(`SPECMEM_PROJECT_HASH: ${PROJECT_HASH} (DEPRECATED - now equals DIR_NAME)`);
startupLog(`Project specmem dir: ${projectSpecmemDir}`);

// ============================================================================
// CRITICAL FIX: Sync stale project configs in ~/.claude.json for future sessions
// This runs synchronously early in startup to fix stale per-project MCP configs
// ============================================================================
function syncProjectConfigs() {
  const claudeJsonPath = path.join(os.homedir(), '.claude.json');

  if (!fs.existsSync(claudeJsonPath)) {
    startupLog('No ~/.claude.json found, skipping project config sync');
    return;
  }

  try {
    const content = fs.readFileSync(claudeJsonPath, 'utf-8');
    const claudeConfig = JSON.parse(content);

    if (!claudeConfig.projects || typeof claudeConfig.projects !== 'object') {
      startupLog('No projects in ~/.claude.json, skipping sync');
      return;
    }

    const canonicalCred = getUnifiedCredential();
    let anyFixed = false;
    const fixedProjects = [];

    for (const [projectPath, projectConfig] of Object.entries(claudeConfig.projects)) {
      if (!projectConfig || typeof projectConfig !== 'object') continue;

      const specmemEnv = projectConfig.mcpServers?.specmem?.env;
      if (!specmemEnv) continue;

      let projectFixed = false;

      // Check and fix each credential
      if (specmemEnv.SPECMEM_DB_NAME && OLD_STALE_VALUES.includes(specmemEnv.SPECMEM_DB_NAME)) {
        specmemEnv.SPECMEM_DB_NAME = canonicalCred;
        projectFixed = true;
      }
      if (specmemEnv.SPECMEM_DB_USER && OLD_STALE_VALUES.includes(specmemEnv.SPECMEM_DB_USER)) {
        specmemEnv.SPECMEM_DB_USER = canonicalCred;
        projectFixed = true;
      }
      if (specmemEnv.SPECMEM_DB_PASSWORD && OLD_STALE_VALUES.includes(specmemEnv.SPECMEM_DB_PASSWORD)) {
        specmemEnv.SPECMEM_DB_PASSWORD = canonicalCred;
        projectFixed = true;
      }
      if (specmemEnv.SPECMEM_DASHBOARD_PASSWORD && OLD_STALE_VALUES.includes(specmemEnv.SPECMEM_DASHBOARD_PASSWORD)) {
        specmemEnv.SPECMEM_DASHBOARD_PASSWORD = canonicalCred;
        projectFixed = true;
      }

      // CRITICAL: Ensure SPECMEM_PROJECT_PATH is set to actual project path (not ${PWD})
      // ${PWD} doesn't get expanded by  Code, so we must use the literal path
      if (!specmemEnv.SPECMEM_PROJECT_PATH || specmemEnv.SPECMEM_PROJECT_PATH === '${PWD}' || specmemEnv.SPECMEM_PROJECT_PATH === '${cwd}') {
        specmemEnv.SPECMEM_PROJECT_PATH = projectPath;
        projectFixed = true;
        startupLog(`Setting SPECMEM_PROJECT_PATH=${projectPath} for project config`);
      }

      if (projectFixed) {
        fixedProjects.push(projectPath);
        anyFixed = true;
      }
    }

    if (anyFixed) {
      // Backup and write
      const backupPath = `${claudeJsonPath}.backup.${Date.now()}`;
      fs.copyFileSync(claudeJsonPath, backupPath);
      fs.writeFileSync(claudeJsonPath, JSON.stringify(claudeConfig, null, 2), 'utf-8');
      startupLog(`CONFIG SYNC: Fixed ${fixedProjects.length} stale project configs: ${fixedProjects.join(', ')}`);

      // Clean up old backups (keep last 3)
      try {
        const homeDir = os.homedir();
        const files = fs.readdirSync(homeDir);
        const backups = files
          .filter(f => f.startsWith('.claude.json.backup.'))
          .sort()
          .reverse();
        for (let i = 3; i < backups.length; i++) {
          fs.unlinkSync(path.join(homeDir, backups[i]));
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    } else {
      startupLog('CONFIG SYNC: All project configs already up-to-date');
    }
  } catch (e) {
    startupLog('CONFIG SYNC ERROR: ' + (e.message || e));
  }
}

// Run the config sync
syncProjectConfigs();

// ============================================================================
// Project-Local Instance Management
// ============================================================================

const SPECMEM_LOCAL_DIR = '.specmem';
const PID_FILE = 'specmem.pid';
const LOCK_SOCKET_FILE = 'specmem.sock';
const INSTANCE_STATE_FILE = 'instance.json';
const STARTUP_LOCK_FILE = 'startup.lock';  // Atomic startup lock

// Startup lock constants - prevent multiple simultaneous startups
const STARTUP_LOCK_TIMEOUT_MS = 30000;  // 30 seconds max to hold startup lock
const STARTUP_LOCK_RETRY_INTERVAL_MS = 100;  // Retry every 100ms
const STARTUP_LOCK_MAX_RETRIES = 50;  // Max 5 seconds of retrying

/**
 * Get the project path from environment or cwd
 *  Code passes this via SPECMEM_PROJECT_PATH
 */
function getProjectPath() {
  return process.env.SPECMEM_PROJECT_PATH || process.cwd();
}

/**
 * Generate a hash of the project path for identification
 */
function hashProjectPath(projectPath) {
  return crypto
    .createHash('sha256')
    .update(path.resolve(projectPath))
    .digest('hex')
    .substring(0, 12);
}

/**
 * Get the .specmem directory path for a project
 * Creates it if necessary
 */
function getSpecMemLocalDir(projectPath, create = false) {
  const specmemDir = path.join(projectPath, SPECMEM_LOCAL_DIR);

  if (create && !fs.existsSync(specmemDir)) {
    fs.mkdirSync(specmemDir, { recursive: true, mode: 0o755 });

    // Add to .gitignore if it exists
    const gitignorePath = path.join(projectPath, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      if (!content.includes(SPECMEM_LOCAL_DIR)) {
        fs.appendFileSync(gitignorePath, `\n# SpecMem local instance\n${SPECMEM_LOCAL_DIR}/\n`);
      }
    }
  }

  return specmemDir;
}

/**
 * Check if a process with the given PID is running
 */
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Check if the process is a SpecMem instance
 */
function isSpecMemProcess(pid) {
  try {
    if (process.platform === 'linux') {
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
      return cmdline.includes('specmem') || cmdline.includes('bootstrap.cjs');
    } else if (process.platform === 'darwin') {
      const result = execSync(`ps -p ${pid} -o command=`, { encoding: 'utf-8' });
      return result.includes('specmem') || result.includes('bootstrap.cjs');
    }
    return isProcessRunning(pid);
  } catch (e) {
    return false;
  }
}

/**
 * Read PID from the project's PID file
 */
function readProjectPidFile(projectPath) {
  const pidFile = path.join(getSpecMemLocalDir(projectPath), PID_FILE);

  try {
    if (!fs.existsSync(pidFile)) {
      return null;
    }
    const content = fs.readFileSync(pidFile, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch (e) {
    return null;
  }
}

/**
 * Write PID to the project's PID file
 */
function writeProjectPidFile(projectPath, pid) {
  const specmemDir = getSpecMemLocalDir(projectPath, true);
  const pidFile = path.join(specmemDir, PID_FILE);
  fs.writeFileSync(pidFile, pid.toString(), { mode: 0o644 });
}

/**
 * Remove the project's PID file
 */
function removeProjectPidFile(projectPath) {
  const pidFile = path.join(getSpecMemLocalDir(projectPath), PID_FILE);
  try {
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
  } catch (e) {
    // Ignore errors
  }
}

/**
 * Write instance state to JSON file
 */
function writeInstanceState(projectPath, state) {
  const specmemDir = getSpecMemLocalDir(projectPath, true);
  const stateFile = path.join(specmemDir, INSTANCE_STATE_FILE);
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o644 });
}

/**
 * Read instance state from JSON file
 */
function readInstanceState(projectPath) {
  const stateFile = path.join(getSpecMemLocalDir(projectPath), INSTANCE_STATE_FILE);

  try {
    if (!fs.existsSync(stateFile)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  } catch (e) {
    return null;
  }
}

/**
 * Remove instance state file
 */
function removeInstanceState(projectPath) {
  const stateFile = path.join(getSpecMemLocalDir(projectPath), INSTANCE_STATE_FILE);
  try {
    if (fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile);
    }
  } catch (e) {
    // Ignore errors
  }
}

// Socket lock for more reliable instance detection
let lockServer = null;

/**
 * Try to acquire a socket-based lock
 * Returns true if lock acquired, false if another instance is running
 *
 * FIXED: Uses atomic socket binding to prevent race conditions
 * - Does NOT delete socket first (that creates a race window)
 * - Instead, tries to connect first to check if alive
 * - Only if socket is stale/unresponsive, attempts exclusive bind
 */
function tryAcquireSocketLock(projectPath) {
  const socketPath = path.join(getSpecMemLocalDir(projectPath, true), LOCK_SOCKET_FILE);

  // STEP 1: If socket file exists, try to connect to it first
  // This avoids the race condition of delete-then-create
  if (fs.existsSync(socketPath)) {
    // Try to connect and check if instance is alive
    const isAlive = checkSocketSync(socketPath);
    if (isAlive) {
      // Another instance is definitely running
      startupLog(`tryAcquireSocketLock: socket ${socketPath} is alive, another instance running`);
      return false;
    }

    // Socket exists but not responding - it's stale
    // Try to remove it, but use a rename-then-unlink pattern for atomicity
    try {
      const staleSocketPath = socketPath + '.stale.' + process.pid;
      fs.renameSync(socketPath, staleSocketPath);
      fs.unlinkSync(staleSocketPath);
      startupLog(`tryAcquireSocketLock: removed stale socket ${socketPath}`);
    } catch (e) {
      // Another process beat us to it, or it's in use
      startupLog(`tryAcquireSocketLock: could not remove socket: ${e.message}`);
      return false;
    }
  }

  // STEP 2: Try to create and bind the socket atomically
  try {
    lockServer = net.createServer((socket) => {
      socket.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg === 'health') {
          // Enhanced health check with detailed status
          const memUsage = process.memoryUsage();
          const uptime = process.uptime();
          socket.write(JSON.stringify({
            status: 'running',
            pid: process.pid,
            uptime: Math.round(uptime),
            uptimeHuman: formatUptime(uptime),
            memory: {
              heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
              heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
              rss: Math.round(memUsage.rss / 1024 / 1024),
              external: Math.round(memUsage.external / 1024 / 1024)
            },
            projectPath: projectPath,
            version: require('./package.json').version || '1.0.0'
          }));
        } else if (msg === 'stats') {
          // Detailed stats for monitoring
          const memUsage = process.memoryUsage();
          const cpuUsage = process.cpuUsage();
          socket.write(JSON.stringify({
            status: 'running',
            pid: process.pid,
            uptime: process.uptime(),
            memory: memUsage,
            cpu: cpuUsage,
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch
          }));
        } else if (msg === 'shutdown') {
          socket.write(JSON.stringify({ status: 'shutting_down' }));
          process.emit('SIGTERM');
        } else if (msg === 'restart') {
          // Graceful restart - shutdown and let parent respawn
          socket.write(JSON.stringify({ status: 'restarting' }));
          setTimeout(() => {
            process.exit(0); // Exit cleanly to trigger restart if configured
          }, 100);
        } else if (msg === 'ping') {
          // Simple ping for quick liveness check
          socket.write('pong');
        }
        socket.end();
      });
    });

    // Handle listen errors explicitly
    lockServer.on('error', (err) => {
      startupLog(`tryAcquireSocketLock: server error: ${err.message}`);
      if (err.code === 'EADDRINUSE') {
        // Another process bound to this socket
        lockServer = null;
      }
    });

    lockServer.listen(socketPath);
    fs.chmodSync(socketPath, 0o600);
    startupLog(`tryAcquireSocketLock: successfully acquired lock on ${socketPath}`);
    return true;
  } catch (e) {
    startupLog(`tryAcquireSocketLock: failed to acquire lock: ${e.message}`);
    lockServer = null;
    return false;
  }
}

/**
 * Synchronous socket check - returns true if socket is alive and responding
 * Uses a short timeout to avoid blocking
 */
function checkSocketSync(socketPath) {
  try {
    // Use synchronous approach with a child process for timeout control
    const result = require('child_process').spawnSync('node', [
      '-e',
      `
      const net = require('net');
      const socket = new net.Socket();
      socket.setTimeout(500);
      socket.on('connect', () => { socket.write('ping'); });
      socket.on('data', () => { process.exit(0); });  // alive
      socket.on('error', () => { process.exit(1); }); // not alive
      socket.on('timeout', () => { process.exit(1); }); // not alive
      socket.connect('${socketPath.replace(/'/g, "\\'")}');
      setTimeout(() => process.exit(1), 600);
      `
    ], { timeout: 1000, stdio: 'ignore' });

    return result.status === 0;
  } catch (e) {
    return false;
  }
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

/**
 * Release the socket lock
 */
function releaseSocketLock(projectPath) {
  const socketPath = path.join(getSpecMemLocalDir(projectPath), LOCK_SOCKET_FILE);

  if (lockServer) {
    lockServer.close();
    lockServer = null;
  }

  try {
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  } catch (e) {
    // Ignore errors
  }
}

/**
 * Check if a SpecMem instance is running for this project via socket
 */
function checkSocketLock(projectPath) {
  return new Promise((resolve) => {
    const socketPath = path.join(getSpecMemLocalDir(projectPath), LOCK_SOCKET_FILE);

    if (!fs.existsSync(socketPath)) {
      resolve(false);
      return;
    }

    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1000);

    socket.on('error', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(false);
    });

    socket.on('connect', () => {
      socket.write('health');
    });

    socket.on('data', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(true);
    });

    socket.connect(socketPath);
  });
}

/**
 * Check if a SpecMem instance is already running for this project
 * Uses both PID file and socket check for reliability
 */
async function isProjectInstanceRunning(projectPath, options = {}) {
  const { retries = 3, retryDelayMs = 100 } = options;

  for (let attempt = 0; attempt < retries; attempt++) {
    // Check 1: PID file
    const pid = readProjectPidFile(projectPath);
    if (pid !== null && pid !== process.pid) {
      if (isProcessRunning(pid) && isSpecMemProcess(pid)) {
        startupLog(`isProjectInstanceRunning: found running instance via PID ${pid}`);
        return { running: true, pid, method: 'pid' };
      }
    }

    // Check 2: Socket lock (async with timeout)
    const socketRunning = await checkSocketLock(projectPath);
    if (socketRunning) {
      startupLog(`isProjectInstanceRunning: found running instance via socket`);
      return { running: true, pid: pid || null, method: 'socket' };
    }

    // Check 3: Instance state file - look for recent startup
    const instanceState = readInstanceState(projectPath);
    if (instanceState && instanceState.status === 'starting' && instanceState.pid !== process.pid) {
      const startTime = new Date(instanceState.startTime).getTime();
      const ageMs = Date.now() - startTime;
      // If another instance started within last 30 seconds, it might still be initializing
      if (ageMs < STARTUP_LOCK_TIMEOUT_MS && isProcessRunning(instanceState.pid)) {
        startupLog(`isProjectInstanceRunning: found starting instance (PID ${instanceState.pid}, age ${ageMs}ms)`);
        return { running: true, pid: instanceState.pid, method: 'instance_state', status: 'starting' };
      }
    }

    // If first attempt found nothing, retry after delay (handles race conditions)
    if (attempt < retries - 1) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }

  return { running: false };
}

/**
 * Clean up stale lock files for this project
 *
 * FIXED: Uses atomic operations to prevent race conditions
 * - Checks instance state file for recent activity
 * - Uses rename-then-unlink for atomic socket removal
 * - Verifies socket is actually stale before removing
 */
function cleanupStaleLocks(projectPath) {
  const specmemDir = getSpecMemLocalDir(projectPath);

  // If .specmem dir doesn't exist, nothing to clean
  if (!fs.existsSync(specmemDir)) {
    return { cleaned: false, reason: 'no_specmem_dir' };
  }

  const pidFile = path.join(specmemDir, PID_FILE);
  const socketPath = path.join(specmemDir, LOCK_SOCKET_FILE);
  const instanceFile = path.join(specmemDir, INSTANCE_STATE_FILE);

  // Read all state atomically before making decisions
  let pidFileAge = 0;
  let pid = null;
  let instanceState = null;

  try {
    if (fs.existsSync(pidFile)) {
      const stats = fs.statSync(pidFile);
      pidFileAge = Date.now() - stats.mtimeMs;
      const content = fs.readFileSync(pidFile, 'utf-8').trim();
      pid = parseInt(content, 10);
      if (isNaN(pid)) pid = null;
    }
  } catch (e) {
    startupLog(`cleanupStaleLocks: error reading PID file: ${e.message}`);
  }

  try {
    instanceState = readInstanceState(projectPath);
  } catch (e) {
    // Ignore
  }

  // SAFETY CHECK 1: Never clean our own PID
  if (pid === process.pid) {
    return { cleaned: false, reason: 'own_pid' };
  }

  // SAFETY CHECK 2: Don't clean if instance is actively starting (within startup timeout)
  if (instanceState && instanceState.status === 'starting') {
    const startTime = new Date(instanceState.startTime).getTime();
    const ageMs = Date.now() - startTime;
    if (ageMs < STARTUP_LOCK_TIMEOUT_MS) {
      startupLog(`cleanupStaleLocks: skipping - instance starting (age ${ageMs}ms)`);
      return { cleaned: false, reason: 'instance_starting', ageMs };
    }
  }

  // SAFETY CHECK 3: Don't clean very recent PID files (might still be initializing)
  const MIN_AGE_MS = 5000;  // Reduced from 10s since we now check instance state
  if (pidFileAge > 0 && pidFileAge < MIN_AGE_MS) {
    startupLog(`cleanupStaleLocks: PID file only ${Math.round(pidFileAge/1000)}s old, skipping`);
    return { cleaned: false, reason: 'too_recent', pidFileAge };
  }

  // SAFETY CHECK 4: If socket is alive, don't clean anything
  if (fs.existsSync(socketPath)) {
    const isAlive = checkSocketSync(socketPath);
    if (isAlive) {
      startupLog(`cleanupStaleLocks: socket is alive, not cleaning`);
      return { cleaned: false, reason: 'socket_alive' };
    }
  }

  // SAFETY CHECK 5: If process is actually running, don't clean
  if (pid !== null && isProcessRunning(pid)) {
    // Double-check it's actually a specmem process
    if (isSpecMemProcess(pid)) {
      startupLog(`cleanupStaleLocks: process ${pid} is running, not cleaning`);
      return { cleaned: false, reason: 'process_running', pid };
    }
    // PID file contains wrong process ID - safe to clean
    startupLog(`cleanupStaleLocks: PID ${pid} is not a specmem process, cleaning`);
  }

  // Now safe to clean stale locks
  let cleaned = false;

  // Clean PID file using atomic rename
  if (fs.existsSync(pidFile)) {
    try {
      const stalePidFile = pidFile + '.stale.' + process.pid;
      fs.renameSync(pidFile, stalePidFile);
      fs.unlinkSync(stalePidFile);
      startupLog(`cleanupStaleLocks: removed stale PID file (was PID ${pid})`);
      cleaned = true;
    } catch (e) {
      startupLog(`cleanupStaleLocks: could not remove PID file: ${e.message}`);
    }
  }

  // Clean socket file using atomic rename
  if (fs.existsSync(socketPath)) {
    try {
      const staleSocketPath = socketPath + '.stale.' + process.pid;
      fs.renameSync(socketPath, staleSocketPath);
      fs.unlinkSync(staleSocketPath);
      startupLog(`cleanupStaleLocks: removed stale socket`);
      cleaned = true;
    } catch (e) {
      startupLog(`cleanupStaleLocks: could not remove socket: ${e.message}`);
    }
  }

  // Clean instance state if it's stale
  if (instanceState && instanceState.status !== 'running') {
    try {
      removeInstanceState(projectPath);
      startupLog(`cleanupStaleLocks: removed stale instance state`);
      cleaned = true;
    } catch (e) {
      // Ignore
    }
  }

  if (cleaned) {
    log(`Cleaned stale locks (PID ${pid} was not running)`, colors.yellow);
  }

  return { cleaned, pid };
}

// ============================================================================
// Startup Sequence Lock - Prevents Simultaneous Starts
// ============================================================================

/**
 * Acquire startup lock - uses O_EXCL flag for atomic file creation
 * This prevents the TOCTOU race between checking for running instance
 * and acquiring the socket lock
 *
 * Returns: { acquired: boolean, lockFile: string, cleanup: () => void }
 */
async function acquireStartupLock(projectPath) {
  const specmemDir = getSpecMemLocalDir(projectPath, true);
  const lockFile = path.join(specmemDir, STARTUP_LOCK_FILE);

  // Try to acquire with retries
  for (let attempt = 0; attempt < STARTUP_LOCK_MAX_RETRIES; attempt++) {
    try {
      // O_EXCL ensures atomic creation - fails if file exists
      const fd = fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);

      // Write our PID and timestamp
      const lockData = JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        nodeVersion: process.version
      });
      fs.writeSync(fd, lockData);
      fs.closeSync(fd);

      startupLog(`acquireStartupLock: acquired lock (attempt ${attempt + 1})`);

      // Return cleanup function
      const cleanup = () => {
        try {
          // Only remove if we still own it
          const content = fs.readFileSync(lockFile, 'utf-8');
          const data = JSON.parse(content);
          if (data.pid === process.pid) {
            fs.unlinkSync(lockFile);
            startupLog('acquireStartupLock: released lock');
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      };

      return { acquired: true, lockFile, cleanup };
    } catch (e) {
      if (e.code === 'EEXIST') {
        // Lock file exists - check if it's stale
        try {
          const content = fs.readFileSync(lockFile, 'utf-8');
          const data = JSON.parse(content);
          const ageMs = Date.now() - data.timestamp;

          // If lock is older than timeout, it's stale
          if (ageMs > STARTUP_LOCK_TIMEOUT_MS) {
            startupLog(`acquireStartupLock: removing stale lock (age ${ageMs}ms, PID ${data.pid})`);
            fs.unlinkSync(lockFile);
            continue; // Retry immediately
          }

          // If lock holder is dead, remove it
          if (!isProcessRunning(data.pid)) {
            startupLog(`acquireStartupLock: removing lock from dead process ${data.pid}`);
            fs.unlinkSync(lockFile);
            continue; // Retry immediately
          }

          // Active lock held by another process - wait and retry
          startupLog(`acquireStartupLock: lock held by PID ${data.pid} (age ${ageMs}ms), waiting...`);
        } catch (readErr) {
          // Can't read lock file - try to remove it
          try {
            fs.unlinkSync(lockFile);
            continue;
          } catch (unlinkErr) {
            // Ignore
          }
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, STARTUP_LOCK_RETRY_INTERVAL_MS));
      } else {
        // Some other error
        startupLog(`acquireStartupLock: error: ${e.message}`);
        break;
      }
    }
  }

  startupLog('acquireStartupLock: failed to acquire lock after max retries');
  return { acquired: false, lockFile, cleanup: () => {} };
}

// ============================================================================
// Embedded PostgreSQL Management
// ============================================================================

let embeddedPgProcess = null;
let embeddedPgPort = null;
let embeddedPgPassword = null;

/**
 * Check if a port is available
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Find an available port in a range
 */
async function findAvailablePort(startPort, endPort) {
  for (let port = startPort; port <= endPort; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  return null;
}

/**
 * Generate a secure random password
 */
function generateSecurePassword() {
  return crypto.randomBytes(24).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
}

// ============================================================================
// Project-Specific Port Allocation (mirrors portAllocator.ts)
// CRITICAL: This runs BEFORE the ES module is imported to ensure ports are
// allocated and set as environment variables for the TypeScript code.
// ============================================================================

/**
 * Port configuration constants - mirrors PORT_CONFIG in portAllocator.ts
 */
const PORT_CONFIG = {
  MIN_PORT: 8500,
  MAX_PORT: 9500,
  PORT_RANGE_SIZE: 50,
  PORTS_PER_INSTANCE: 3,
  RESERVED_RANGES: [
    { start: 8080, end: 8090 },
    { start: 3000, end: 3010 },
    { start: 5000, end: 5010 },
    { start: 5432, end: 5432 },
    { start: 6379, end: 6380 },
    { start: 27017, end: 27018 },
  ],
  DEFAULTS: {
    DASHBOARD: 8595,
    COORDINATION: 8596,
    POSTGRES: 5432,  // System postgres - no per-project postgres
  },
  MAX_ALLOCATION_ATTEMPTS: 20,
  // POSTGRES port range removed - use system postgres on 5432 only
  SYSTEM_POSTGRES_PORT: 5432,
};

// Global allocated ports for this instance
let globalAllocatedPorts = null;

/**
 * Hash project path to get deterministic port offset
 * Mirrors hashProjectPath in portAllocator.ts
 */
function hashProjectPathForPorts(projectPath) {
  const normalizedPath = path.resolve(projectPath).toLowerCase().replace(/\\/g, '/');
  const hash = crypto.createHash('sha256').update(normalizedPath).digest('hex');
  const hashNum = parseInt(hash.substring(0, 8), 16);
  const rangeSize = PORT_CONFIG.MAX_PORT - PORT_CONFIG.MIN_PORT;
  const offset = hashNum % rangeSize;
  return { hash, offset };
}

/**
 * Check if port is in reserved range
 */
function isReservedPort(port) {
  for (const reserved of PORT_CONFIG.RESERVED_RANGES) {
    if (port >= reserved.start && port <= reserved.end) {
      return true;
    }
  }
  return false;
}

/**
 * Calculate base port for a project
 */
function calculateBasePort(projectPath) {
  const { offset } = hashProjectPathForPorts(projectPath);
  let basePort = PORT_CONFIG.MIN_PORT + offset;

  if (basePort > PORT_CONFIG.MAX_PORT - PORT_CONFIG.PORTS_PER_INSTANCE) {
    basePort = PORT_CONFIG.MIN_PORT + (offset % (PORT_CONFIG.MAX_PORT - PORT_CONFIG.MIN_PORT - PORT_CONFIG.PORTS_PER_INSTANCE));
  }

  for (const reserved of PORT_CONFIG.RESERVED_RANGES) {
    if (basePort >= reserved.start && basePort <= reserved.end + PORT_CONFIG.PORTS_PER_INSTANCE) {
      basePort = reserved.end + 1;
    }
  }

  return basePort;
}

/**
 * Get port config file path
 */
function getPortConfigFilePath(projectPath) {
  return path.join(projectPath, '.specmem', 'ports.json');
}

/**
 * Load persisted port configuration
 */
function loadPortConfig(projectPath) {
  const filePath = getPortConfigFilePath(projectPath);
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const config = JSON.parse(content);

    if (config.version !== 1 || !config.ports?.dashboard || !config.ports?.coordination) {
      return null;
    }

    const currentHash = hashProjectPathForPorts(projectPath).hash;
    if (config.projectHash !== currentHash) {
      return null;
    }

    return config;
  } catch (e) {
    return null;
  }
}

/**
 * Save port configuration
 */
function savePortConfig(projectPath, ports) {
  const filePath = getPortConfigFilePath(projectPath);
  const { hash } = hashProjectPathForPorts(projectPath);

  const config = {
    version: 1,
    projectPath: path.resolve(projectPath),
    projectHash: hash,
    ports,
    allocatedAt: Date.now(),
    lastVerified: Date.now(),
  };

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
    startupLog(`Port configuration saved to ${filePath}`);
    return true;
  } catch (e) {
    startupLog(`Failed to save port config: ${e.message}`);
    return false;
  }
}

/**
 * Find available port pair for dashboard and coordination
 */
async function findAvailablePortPair(startPort, maxAttempts = PORT_CONFIG.MAX_ALLOCATION_ATTEMPTS) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const dashboardPort = startPort + (attempt * 2);
    const coordinationPort = dashboardPort + 1;

    if (coordinationPort > PORT_CONFIG.MAX_PORT) {
      const wrappedStart = PORT_CONFIG.MIN_PORT + (attempt * 2);
      if (wrappedStart >= startPort) {
        break;
      }
      continue;
    }

    if (isReservedPort(dashboardPort) || isReservedPort(coordinationPort)) {
      continue;
    }

    const [dashAvail, coordAvail] = await Promise.all([
      isPortAvailable(dashboardPort),
      isPortAvailable(coordinationPort)
    ]);

    if (dashAvail && coordAvail) {
      return { dashboard: dashboardPort, coordination: coordinationPort };
    }
  }

  return null;
}

/**
 * Get PostgreSQL port - always system postgres on 5432
 * No more per-project postgres allocation - system pg is 10x faster than docker!
 */
function getPostgresPort() {
  return PORT_CONFIG.SYSTEM_POSTGRES_PORT;
}

/**
 * Allocate ports for this SpecMem instance
 * MUST be called BEFORE importing the ES module
 */
async function allocateProjectPorts(projectPath) {
  startupLog(`allocateProjectPorts called for: ${projectPath}`);
  const resolvedPath = path.resolve(projectPath);
  const { hash, offset } = hashProjectPathForPorts(resolvedPath);

  logStep('PORT-ALLOC', `Allocating ports for project: ${resolvedPath}`);
  logStep('PORT-ALLOC', `Project hash: ${hash.substring(0, 16)}...`);

  // Step 1: Check for existing persisted configuration
  const existingConfig = loadPortConfig(resolvedPath);

  if (existingConfig) {
    const ports = existingConfig.ports;
    const [dashAvail, coordAvail] = await Promise.all([
      isPortAvailable(ports.dashboard),
      isPortAvailable(ports.coordination)
    ]);

    // Also check postgres port if present
    let pgAvail = true;
    if (ports.postgres) {
      pgAvail = await isPortAvailable(ports.postgres);
    }

    if (dashAvail && coordAvail && pgAvail) {
      startupLog(`Using persisted ports: dashboard=${ports.dashboard}, coordination=${ports.coordination}, postgres=${ports.postgres || 'N/A'}`);
      logSuccess(`Using persisted ports: dashboard=${ports.dashboard}, coordination=${ports.coordination}`);

      globalAllocatedPorts = {
        dashboard: ports.dashboard,
        coordination: ports.coordination,
        postgres: ports.postgres || PORT_CONFIG.DEFAULTS.POSTGRES,
        projectPath: resolvedPath,
        projectHash: hash,
        allocatedAt: existingConfig.allocatedAt,
        verified: true,
      };

      return globalAllocatedPorts;
    } else {
      startupLog(`Persisted ports not available, reallocating...`);
      logWarn('Persisted ports not available, reallocating...');
    }
  }

  // Step 2: Calculate hash-based base port
  const basePort = calculateBasePort(resolvedPath);
  startupLog(`Calculated base port: ${basePort}`);

  // Step 3: Find available port pair
  let ports = await findAvailablePortPair(basePort);

  if (!ports) {
    startupLog(`No ports in hash range, trying from MIN_PORT`);
    logWarn('No ports available in hash range, trying from min port');
    ports = await findAvailablePortPair(PORT_CONFIG.MIN_PORT);
  }

  if (!ports) {
    startupLog(`No ports found, using defaults`);
    logWarn('No available ports found, using defaults');
    ports = {
      dashboard: PORT_CONFIG.DEFAULTS.DASHBOARD,
      coordination: PORT_CONFIG.DEFAULTS.COORDINATION,
    };
  }

  // Step 4: PostgreSQL port - always system postgres on 5432
  const postgresPort = getPostgresPort();

  // Step 5: Save configuration
  const allPorts = {
    dashboard: ports.dashboard,
    coordination: ports.coordination,
    postgres: postgresPort,
  };

  savePortConfig(resolvedPath, allPorts);

  startupLog(`Port allocation complete: ${JSON.stringify(allPorts)}`);
  logSuccess(`Allocated ports: dashboard=${allPorts.dashboard}, coordination=${allPorts.coordination}, postgres=${allPorts.postgres}`);

  globalAllocatedPorts = {
    dashboard: allPorts.dashboard,
    coordination: allPorts.coordination,
    postgres: allPorts.postgres,
    projectPath: resolvedPath,
    projectHash: hash,
    allocatedAt: Date.now(),
    verified: true,
  };

  return globalAllocatedPorts;
}

/**
 * Set allocated ports as environment variables
 * Must be called BEFORE importing the ES module so TypeScript code sees them
 */
function setAllocatedPortsEnv(ports) {
  if (!ports) return;

  process.env.SPECMEM_DASHBOARD_PORT = String(ports.dashboard);
  process.env.SPECMEM_COORDINATION_PORT = String(ports.coordination);
  if (ports.postgres) {
    process.env.SPECMEM_POSTGRES_PORT = String(ports.postgres);
  }

  startupLog(`Set environment variables: SPECMEM_DASHBOARD_PORT=${ports.dashboard}, SPECMEM_COORDINATION_PORT=${ports.coordination}, SPECMEM_POSTGRES_PORT=${ports.postgres}`);
}

/**
 * Check if PostgreSQL binaries are available
 */
function checkPostgresInstalled() {
  try {
    execSync('which initdb', { stdio: 'ignore' });
    execSync('which pg_ctl', { stdio: 'ignore' });
    execSync('which psql', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the PostgreSQL data directory path for a project
 */
function getPgDataDir(projectPath) {
  return path.join(getSpecMemLocalDir(projectPath, true), PGDATA_DIR);
}

/**
 * Check if PostgreSQL data directory exists and is initialized
 */
function isPgInitialized(projectPath) {
  const pgDataDir = getPgDataDir(projectPath);
  const pgVersionFile = path.join(pgDataDir, 'PG_VERSION');
  return fs.existsSync(pgDataDir) && fs.existsSync(pgVersionFile);
}

/**
 * Initialize PostgreSQL data directory
 */
async function initializePostgres(projectPath) {
  const pgDataDir = getPgDataDir(projectPath);

  logStep('PG-INIT', `Initializing PostgreSQL data directory: ${pgDataDir}`);

  return new Promise((resolve, reject) => {
    const initdb = spawn('initdb', [
      '-D', pgDataDir,
      '-E', 'UTF8',
      '--locale=C',
      '-A', 'md5',
      '--pwfile=-'  // Read password from stdin
    ], {
      stdio: ['pipe', isMcpMode ? 'pipe' : 'inherit', isMcpMode ? 'pipe' : 'inherit']
    });

    // Write the password to stdin
    initdb.stdin.write(embeddedPgPassword + '\n');
    initdb.stdin.end();

    if (isMcpMode) {
      initdb.stdout?.pipe(process.stderr);
      initdb.stderr?.pipe(process.stderr);
    }

    initdb.on('close', (code) => {
      if (code === 0) {
        logSuccess('PostgreSQL data directory initialized');

        // Configure PostgreSQL for local connections only
        const pgHbaPath = path.join(pgDataDir, 'pg_hba.conf');
        const pgHbaContent = `
# PostgreSQL Client Authentication Configuration File
# SpecMem Embedded PostgreSQL - Local connections only
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     md5
host    all             all             127.0.0.1/32            md5
host    all             all             ::1/128                 md5
`;
        fs.writeFileSync(pgHbaPath, pgHbaContent);

        // Configure postgresql.conf for minimal resource usage
        const pgConfPath = path.join(pgDataDir, 'postgresql.conf');
        let pgConf = fs.readFileSync(pgConfPath, 'utf-8');

        // Add SpecMem-specific configuration
        const specmemConfig = `
# ============================================================================
# SpecMem Embedded PostgreSQL Configuration
# Optimized for minimal resource usage
# ============================================================================

# Connection settings (will be overridden by pg_ctl -o flag)
listen_addresses = '127.0.0.1'
max_connections = 20

# Memory settings (minimal footprint)
shared_buffers = 32MB
work_mem = 4MB
maintenance_work_mem = 16MB
effective_cache_size = 64MB

# WAL settings (reduced for embedded use)
wal_buffers = 4MB
checkpoint_completion_target = 0.9
max_wal_size = 256MB
min_wal_size = 32MB

# Logging (minimal)
log_destination = 'stderr'
logging_collector = off

# Performance
random_page_cost = 1.1
effective_io_concurrency = 200
`;
        pgConf += specmemConfig;
        fs.writeFileSync(pgConfPath, pgConf);

        resolve(true);
      } else {
        reject(new Error(`initdb failed with code ${code}`));
      }
    });

    initdb.on('error', reject);
  });
}

/**
 * Start embedded PostgreSQL server
 */
async function startEmbeddedPostgres(projectPath, port) {
  const pgDataDir = getPgDataDir(projectPath);
  const pgLogFile = path.join(getSpecMemLocalDir(projectPath), 'postgresql.log');

  logStep('PG-START', `Starting PostgreSQL on port ${port}...`);

  return new Promise((resolve, reject) => {
    const pgCtl = spawn('pg_ctl', [
      'start',
      '-D', pgDataDir,
      '-l', pgLogFile,
      '-o', `-p ${port} -k ""`,  // Port and disable Unix socket (Windows compat)
      '-w'  // Wait for startup
    ], {
      stdio: isMcpMode ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env: { ...process.env, PGPASSWORD: embeddedPgPassword }
    });

    if (isMcpMode) {
      pgCtl.stdout?.pipe(process.stderr);
      pgCtl.stderr?.pipe(process.stderr);
    }

    pgCtl.on('close', (code) => {
      if (code === 0) {
        logSuccess(`PostgreSQL started on port ${port}`);
        resolve(true);
      } else {
        reject(new Error(`pg_ctl start failed with code ${code}`));
      }
    });

    pgCtl.on('error', reject);
  });
}

/**
 * Wait for PostgreSQL to be ready to accept connections
 */
async function waitForPostgresReady(port, maxAttempts = 30) {
  logStep('PG-WAIT', 'Waiting for PostgreSQL to be ready...');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      execSync(`psql -h 127.0.0.1 -p ${port} -U postgres -c "SELECT 1" -t`, {
        stdio: 'ignore',
        env: { ...process.env, PGPASSWORD: embeddedPgPassword }
      });
      logSuccess('PostgreSQL is ready');
      return true;
    } catch {
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  throw new Error('PostgreSQL failed to become ready');
}

/**
 * Create SpecMem database and user if they don't exist
 */
async function setupSpecMemDatabase(port) {
  logStep('PG-SETUP', 'Setting up SpecMem database and user...');

  // Use unified credential pattern - all values from single password
  const dbName = process.env.SPECMEM_DB_NAME || getUnifiedCredential();
  const dbUser = process.env.SPECMEM_DB_USER || getUnifiedCredential();
  const dbPassword = embeddedPgPassword || getUnifiedCredential();

  try {
    // Check if database exists
    try {
      execSync(`psql -h 127.0.0.1 -p ${port} -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = '${dbName}'"`, {
        stdio: 'pipe',
        env: { ...process.env, PGPASSWORD: embeddedPgPassword }
      });
      const dbExists = execSync(`psql -h 127.0.0.1 -p ${port} -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = '${dbName}'"`, {
        encoding: 'utf-8',
        env: { ...process.env, PGPASSWORD: embeddedPgPassword }
      }).trim();

      if (dbExists === '1') {
        logSuccess('SpecMem database already exists');
      } else {
        // Create user
        try {
          execSync(`psql -h 127.0.0.1 -p ${port} -U postgres -c "CREATE USER ${dbUser} WITH PASSWORD '${dbPassword}'"`, {
            stdio: 'pipe',
            env: { ...process.env, PGPASSWORD: embeddedPgPassword }
          });
          logSuccess(`Created user: ${dbUser}`);
        } catch (e) {
          // User might already exist
          logWarn(`User ${dbUser} may already exist`);
        }

        // Create database
        execSync(`psql -h 127.0.0.1 -p ${port} -U postgres -c "CREATE DATABASE ${dbName} OWNER ${dbUser}"`, {
          stdio: 'pipe',
          env: { ...process.env, PGPASSWORD: embeddedPgPassword }
        });
        logSuccess(`Created database: ${dbName}`);

        // Grant privileges
        execSync(`psql -h 127.0.0.1 -p ${port} -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${dbUser}"`, {
          stdio: 'pipe',
          env: { ...process.env, PGPASSWORD: embeddedPgPassword }
        });
        logSuccess('Granted privileges to specmem user');
      }
    } catch (e) {
      // Database doesn't exist, create everything
      // Create user
      try {
        execSync(`psql -h 127.0.0.1 -p ${port} -U postgres -c "CREATE USER ${dbUser} WITH PASSWORD '${dbPassword}'"`, {
          stdio: 'pipe',
          env: { ...process.env, PGPASSWORD: embeddedPgPassword }
        });
        logSuccess(`Created user: ${dbUser}`);
      } catch {
        // User might already exist
      }

      // Create database
      execSync(`psql -h 127.0.0.1 -p ${port} -U postgres -c "CREATE DATABASE ${dbName} OWNER ${dbUser}"`, {
        stdio: 'pipe',
        env: { ...process.env, PGPASSWORD: embeddedPgPassword }
      });
      logSuccess(`Created database: ${dbName}`);

      // Grant privileges
      execSync(`psql -h 127.0.0.1 -p ${port} -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${dbUser}"`, {
        stdio: 'pipe',
        env: { ...process.env, PGPASSWORD: embeddedPgPassword }
      });
    }

    // Try to create pgvector extension
    try {
      execSync(`psql -h 127.0.0.1 -p ${port} -U postgres -d ${dbName} -c "CREATE EXTENSION IF NOT EXISTS vector"`, {
        stdio: 'pipe',
        env: { ...process.env, PGPASSWORD: embeddedPgPassword }
      });
      logSuccess('pgvector extension enabled');
    } catch {
      logWarn('pgvector extension not available - install postgresql-*-pgvector package');
    }

    return { dbName, dbUser, dbPassword };
  } catch (err) {
    throw new Error(`Failed to setup SpecMem database: ${err.message}`);
  }
}

/**
 * AUTO-SCHEMA INITIALIZATION - Creates tables on startup with verification!
 * CRITICAL: This runs BEFORE MCP server starts, ensuring schema is ready
 *
 * Uses projectSchemaInit.sql for idempotent table creation
 * Verifies by checking if 'memories' table exists
 */
async function ensureSchemaInitialized() {
  const dbHost = process.env.SPECMEM_DB_HOST || 'localhost';
  const dbPort = process.env.SPECMEM_DB_PORT || '5432';
  const dbName = process.env.SPECMEM_DB_NAME || 'specmem';
  const dbUser = process.env.SPECMEM_DB_USER || 'specmem';
  const dbPassword = process.env.SPECMEM_DB_PASSWORD || 'specmem';

  startupLog(`ensureSchemaInitialized() - DB: ${dbHost}:${dbPort}/${dbName} user=${dbUser}`);

  try {
    // Step 1: Check if schema already exists by looking for 'memories' table
    const tableCheckCmd = `psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -t -c "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'memories')"`;
    let schemaExists = false;

    try {
      const result = execSync(tableCheckCmd, {
        encoding: 'utf-8',
        env: { ...process.env, PGPASSWORD: dbPassword },
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      schemaExists = result.includes('t');
      startupLog(`Schema check: memories table exists = ${schemaExists}`);
    } catch (checkErr) {
      startupLog(`Schema check failed (probably first run): ${checkErr.message}`);
      schemaExists = false;
    }

    // Step 2: If schema doesn't exist, run projectSchemaInit.sql
    if (!schemaExists) {
      startupLog('Schema not found, initializing...');

      const schemaFile = path.join(__dirname, 'src', 'db', 'projectSchemaInit.sql');

      if (!fs.existsSync(schemaFile)) {
        startupLog(`WARNING: Schema file not found at ${schemaFile}`);
        // Try dist location as fallback
        const distSchemaFile = path.join(__dirname, 'dist', 'db', 'projectSchemaInit.sql');
        if (!fs.existsSync(distSchemaFile)) {
          startupLog('WARNING: Could not find schema file in src/ or dist/');
          return false;
        }
      }

      const initCmd = `psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -f "${schemaFile}"`;

      try {
        execSync(initCmd, {
          encoding: 'utf-8',
          env: { ...process.env, PGPASSWORD: dbPassword },
          timeout: 30000,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        startupLog('✅ Schema initialized successfully via projectSchemaInit.sql');
        logSuccess('Database schema initialized');
      } catch (initErr) {
        startupLog(`Schema init error: ${initErr.message}`);
        // Non-fatal - MCP server will retry schema creation
        logWarn('Schema initialization partial - MCP server will complete on first connect');
        return false;
      }
    } else {
      startupLog('✅ Schema already exists, no initialization needed');
      logSuccess('Database schema verified');
    }

    // Step 3: Verify by counting tables
    try {
      const countCmd = `psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"`;
      const tableCount = execSync(countCmd, {
        encoding: 'utf-8',
        env: { ...process.env, PGPASSWORD: dbPassword },
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      startupLog(`Schema verification: ${tableCount} tables found`);
      logStep('SCHEMA', `Verified: ${tableCount} tables ready`);
    } catch (verifyErr) {
      startupLog(`Schema verification skipped: ${verifyErr.message}`);
    }

    // Step 4: AUTO-FIX PERMISSIONS - Critical for multi-instance isolation!
    // Tables may be owned by 'specmem' (shared) but we connect as project-specific user.
    // This ensures the configured user has full access to all objects.
    try {
      startupLog(`Auto-fixing permissions for user: ${dbUser}`);

      // Use postgres superuser to grant privileges (the configured user may not have GRANT rights)
      const permFixSql = `
        -- Grant all privileges on existing objects
        GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${dbUser};
        GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${dbUser};
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${dbUser};
        GRANT USAGE, CREATE ON SCHEMA public TO ${dbUser};

        -- Fix ownership of critical trigger function (causes "must be owner" errors)
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_modified_column') THEN
            EXECUTE 'ALTER FUNCTION update_modified_column() OWNER TO ${dbUser}';
          END IF;
        EXCEPTION WHEN OTHERS THEN
          -- Ignore if already owned or doesn't exist
          NULL;
        END $$;

        -- Set default privileges for future objects created by any user
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${dbUser};
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${dbUser};
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${dbUser};
      `;

      // Try with sudo postgres first (for Linux), fallback to direct if that fails
      let permFixed = false;

      // Method 1: Try sudo -u postgres (works on most Linux systems)
      try {
        execSync(`sudo -u postgres psql -d ${dbName} -c "${permFixSql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
          encoding: 'utf-8',
          timeout: 15000,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        permFixed = true;
        startupLog('✅ Permissions auto-fixed via sudo postgres');
      } catch (sudoErr) {
        startupLog(`sudo postgres method failed: ${sudoErr.message?.slice(0, 100)}`);
      }

      // Method 2: Try with peer auth (socket connection as postgres)
      if (!permFixed) {
        try {
          execSync(`psql -U postgres -d ${dbName} -c "${permFixSql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
            encoding: 'utf-8',
            timeout: 15000,
            stdio: ['pipe', 'pipe', 'pipe']
          });
          permFixed = true;
          startupLog('✅ Permissions auto-fixed via peer auth');
        } catch (peerErr) {
          startupLog(`peer auth method failed: ${peerErr.message?.slice(0, 100)}`);
        }
      }

      // Method 3: Try with the configured password (if user has superuser rights)
      if (!permFixed) {
        try {
          // Simpler grants that don't require superuser
          const basicGrantSql = `
            GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${dbUser};
            GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${dbUser};
          `;
          execSync(`psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -c "${basicGrantSql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
            encoding: 'utf-8',
            env: { ...process.env, PGPASSWORD: dbPassword },
            timeout: 10000,
            stdio: ['pipe', 'pipe', 'pipe']
          });
          startupLog('✅ Basic permissions granted (limited - may still have ownership issues)');
          permFixed = true;
        } catch (basicErr) {
          startupLog(`Basic grants failed: ${basicErr.message?.slice(0, 100)}`);
        }
      }

      if (!permFixed) {
        startupLog('⚠️ Could not auto-fix permissions - may encounter "must be owner" errors');
        startupLog('   Run as superuser: sudo -u postgres psql -d ' + dbName);
        startupLog('   Then: GRANT ALL ON ALL TABLES IN SCHEMA public TO ' + dbUser + ';');
      }
    } catch (permErr) {
      startupLog(`Permission auto-fix error (non-fatal): ${permErr.message}`);
    }

    return true;
  } catch (err) {
    startupLog(`ensureSchemaInitialized() failed: ${err.message}`);
    // Non-fatal - don't block startup, MCP server will handle it
    return false;
  }
}

/**
 * Stop embedded PostgreSQL server gracefully
 */
async function stopEmbeddedPostgres(projectPath) {
  const pgDataDir = getPgDataDir(projectPath);

  if (!fs.existsSync(pgDataDir)) {
    return;
  }

  logStep('PG-STOP', 'Stopping embedded PostgreSQL...');

  return new Promise((resolve) => {
    const pgCtl = spawn('pg_ctl', [
      'stop',
      '-D', pgDataDir,
      '-m', 'fast',  // Fast shutdown mode
      '-w'           // Wait for shutdown
    ], {
      stdio: 'pipe'
    });

    pgCtl.on('close', (code) => {
      if (code === 0) {
        logSuccess('PostgreSQL stopped gracefully');
      } else {
        logWarn('PostgreSQL may not have stopped cleanly');
      }
      resolve();
    });

    pgCtl.on('error', () => {
      logWarn('Error stopping PostgreSQL');
      resolve();
    });

    // Force kill after 10 seconds
    setTimeout(() => {
      pgCtl.kill('SIGKILL');
      resolve();
    }, 10000);
  });
}

/**
 * Read or generate embedded PostgreSQL password
 */
function getOrCreatePgPassword(projectPath) {
  const specmemDir = getSpecMemLocalDir(projectPath, true);
  const passwordFile = path.join(specmemDir, '.pg_password');

  if (fs.existsSync(passwordFile)) {
    return fs.readFileSync(passwordFile, 'utf-8').trim();
  }

  const password = generateSecurePassword();
  fs.writeFileSync(passwordFile, password, { mode: 0o600 });
  return password;
}

/**
 * Read allocated PostgreSQL port from instance state
 */
function getStoredPgPort(projectPath) {
  const state = readInstanceState(projectPath);
  return state?.postgresPort || null;
}

/**
 * Full embedded PostgreSQL initialization workflow
 */
async function initializeEmbeddedPostgres(projectPath) {
  logStep('EMBEDDED-PG', 'Initializing embedded PostgreSQL...');

  // Check if PostgreSQL is installed
  if (!checkPostgresInstalled()) {
    logWarn('PostgreSQL binaries not found (initdb, pg_ctl, psql)');
    logWarn('Embedded PostgreSQL disabled - using external database');
    return null;
  }

  logSuccess('PostgreSQL binaries found');

  // Get or generate password
  embeddedPgPassword = getOrCreatePgPassword(projectPath);

  // Find an available port (check if we have a stored port first)
  let storedPort = getStoredPgPort(projectPath);
  if (storedPort && await isPortAvailable(storedPort)) {
    embeddedPgPort = storedPort;
  } else {
    embeddedPgPort = await findAvailablePort(PG_DEFAULT_PORT_START, PG_DEFAULT_PORT_END);
  }

  if (!embeddedPgPort) {
    logWarn('No available ports for embedded PostgreSQL');
    return null;
  }

  logSuccess(`Allocated PostgreSQL port: ${embeddedPgPort}`);

  // Initialize data directory if needed
  if (!isPgInitialized(projectPath)) {
    logStep('EMBEDDED-PG', 'First time setup - initializing PostgreSQL data directory...');
    await initializePostgres(projectPath);
  } else {
    logSuccess('PostgreSQL data directory already initialized');
  }

  // Start PostgreSQL
  await startEmbeddedPostgres(projectPath, embeddedPgPort);

  // Wait for PostgreSQL to be ready
  await waitForPostgresReady(embeddedPgPort);

  // Setup database and user
  const dbConfig = await setupSpecMemDatabase(embeddedPgPort);

  // Set environment variables for SpecMem
  process.env.SPECMEM_DB_HOST = 'localhost';
  process.env.SPECMEM_DB_PORT = String(embeddedPgPort);
  process.env.SPECMEM_DB_NAME = dbConfig.dbName;
  process.env.SPECMEM_DB_USER = dbConfig.dbUser;
  process.env.SPECMEM_DB_PASSWORD = dbConfig.dbPassword;

  logSuccess('Embedded PostgreSQL environment configured:');
  log(`  SPECMEM_DB_HOST=localhost`, colors.cyan);
  log(`  SPECMEM_DB_PORT=${embeddedPgPort}`, colors.cyan);
  log(`  SPECMEM_DB_NAME=${dbConfig.dbName}`, colors.cyan);
  log(`  SPECMEM_DB_USER=${dbConfig.dbUser}`, colors.cyan);
  log(`  SPECMEM_DB_PASSWORD=<auto-generated>`, colors.cyan);

  return {
    port: embeddedPgPort,
    ...dbConfig
  };
}

// UNIFIED CREDENTIALS: Single SPECMEM_PASSWORD controls DB name, user, and password
// NOTE: This is a DUPLICATE definition - the primary one is at line ~85
// Keeping for backwards compat but using same default
const UNIFIED_DEFAULT = 'specmem_westayunprofessional';
// getUnifiedCredential already defined above - reuse it

// goofy logging with colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

// Detect if running as MCP server (stdin is not a TTY means piped input)
// When  Code launches us as MCP, stdin is a pipe so isTTY is undefined (not false)
// Use !isTTY to catch both undefined and false cases
const isMcpMode = !process.stdin.isTTY;
startupLog(`MCP mode detection complete: isMcpMode=${isMcpMode}`);

function log(message, color = colors.reset) {
  // When running as MCP server, log to stderr to avoid corrupting JSON-RPC stream
  // Ensure color is never undefined to avoid "undefined" appearing in output
  const safeColor = color || colors.reset;
  if (isMcpMode) {
    console.error(`${safeColor}${message}${colors.reset}`);
  } else {
    console.log(`${safeColor}${message}${colors.reset}`);
  }
}

function logStep(step, message) {
  log(`[${step}] ${message}`, colors.cyan);
}

function logSuccess(message) {
  log(`✓ ${message}`, colors.green);
}

function logWarn(message) {
  log(`⚠ ${message}`, colors.yellow);
}

function logError(message) {
  log(`✗ ${message}`, colors.red);
}

// ============================================================================
// PROGRESS REPORTER - Unified startup loading indicators
// ============================================================================
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerIndex = 0;
let spinnerInterval = null;
let currentSpinnerMessage = '';

/**
 * Start a spinner animation for long-running operations
 */
function startSpinner(message) {
  stopSpinner(); // Clear any existing
  currentSpinnerMessage = message;
  spinnerIndex = 0;

  const isTTY = process.stderr.isTTY;
  if (!isTTY) {
    // No TTY, just log the message once
    log(`${colors.cyan}⠋${colors.reset} ${message}`, colors.reset);
    return;
  }

  spinnerInterval = setInterval(() => {
    spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
    const frame = SPINNER_FRAMES[spinnerIndex];
    process.stderr.write(`\x1b[2K\r${colors.cyan}${frame}${colors.reset} ${currentSpinnerMessage}`);
  }, 80);
}

/**
 * Stop the spinner and optionally show a final message
 */
function stopSpinner(finalMessage = null, success = true) {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
    const isTTY = process.stderr.isTTY;
    if (isTTY) {
      process.stderr.write('\x1b[2K\r'); // Clear line
    }
  }
  if (finalMessage) {
    if (success) {
      logSuccess(finalMessage);
    } else {
      logError(finalMessage);
    }
  }
}

/**
 * Show a numbered phase indicator
 * @param {number} current - Current phase (1-based)
 * @param {number} total - Total phases
 * @param {string} message - Phase description
 */
function logPhase(current, total, message) {
  const pct = Math.round((current / total) * 100);
  log(`[${current}/${total}] ${message} ${colors.dim}(${pct}%)${colors.reset}`, colors.cyan);
}

// ============================================================================
// SILENT AUTO-INSTALL SYSTEM
// Ensures SpecMem is properly configured in  Code on EVERY run
// This happens BEFORE the MCP server starts
// ============================================================================

/**
 * Safe JSON read helper
 */
function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    logWarn(`Could not read ${filePath}: ${err.message}`);
    return {};
  }
}

/**
 * Safe JSON write helper
 */
function safeWriteJson(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    logError(`Failed to write ${filePath}: ${err.message}`);
    return false;
  }
}

/**
 * Ensure SpecMem is registered in ~/.claude/config.json
 * This is what makes  Code load SpecMem as an MCP server
 */
function ensureConfigJsonSilent() {
  const claudeDir = path.join(os.homedir(), '.claude');
  const configPath = path.join(claudeDir, 'config.json');
  const bootstrapPath = path.join(__dirname, 'bootstrap.cjs');

  // Read existing config
  const config = safeReadJson(configPath);

  // Ensure mcpServers object exists
  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  // Build the SpecMem MCP server config
  // CRITICAL: ${PWD} is expanded by  Code at runtime to the current project directory
  const specmemConfig = {
    command: 'node',
    args: ['--max-old-space-size=250', bootstrapPath],
    env: {
      HOME: os.homedir(),
      // Project-local configuration - ${PWD} is expanded by  Code at runtime
      SPECMEM_PROJECT_PATH: '${PWD}',
      SPECMEM_WATCHER_ROOT_PATH: '${PWD}',
      SPECMEM_CODEBASE_PATH: '${PWD}',
      // Database configuration
      SPECMEM_DB_HOST: process.env.SPECMEM_DB_HOST || 'localhost',
      SPECMEM_DB_PORT: process.env.SPECMEM_DB_PORT || '5432',
      SPECMEM_DB_NAME: process.env.SPECMEM_DB_NAME || getUnifiedCredential(),
      SPECMEM_DB_USER: process.env.SPECMEM_DB_USER || getUnifiedCredential(),
      SPECMEM_DB_PASSWORD: process.env.SPECMEM_DB_PASSWORD || getUnifiedCredential(),
      // Session and dashboard configuration
      SPECMEM_SESSION_WATCHER_ENABLED: process.env.SPECMEM_SESSION_WATCHER_ENABLED || 'true',
      SPECMEM_WATCHER_ENABLED: process.env.SPECMEM_WATCHER_ENABLED || 'true',
      SPECMEM_MAX_HEAP_MB: process.env.SPECMEM_MAX_HEAP_MB || '250',
      SPECMEM_DASHBOARD_ENABLED: process.env.SPECMEM_DASHBOARD_ENABLED || 'true',
      SPECMEM_DASHBOARD_PORT: process.env.SPECMEM_DASHBOARD_PORT || '8595',
      SPECMEM_DASHBOARD_HOST: process.env.SPECMEM_DASHBOARD_HOST || '0.0.0.0',
      SPECMEM_DASHBOARD_PASSWORD: process.env.SPECMEM_DASHBOARD_PASSWORD || ''
    }
  };

  // Check if update needed - only check ESSENTIAL fields to avoid constant rewrites
  // This prevents the race condition where  reads settings while we're writing
  const existing = config.mcpServers.specmem;
  const needsUpdate = !existing ||
    existing.command !== 'node' ||
    existing.args?.[1] !== bootstrapPath ||
    // Only check critical env vars, not all of them (new vars are optional)
    existing.env?.SPECMEM_PROJECT_PATH !== '${PWD}' ||
    existing.env?.HOME !== os.homedir();

  if (!needsUpdate) {
    return { success: true, changed: false };
  }

  // Update config
  config.mcpServers.specmem = specmemConfig;

  if (safeWriteJson(configPath, config)) {
    logSuccess(`MCP server registered in config.json`);
    return { success: true, changed: true };
  }

  return { success: false, changed: false };
}

/**
 * Copy hook files from specmem/claude-hooks to ~/.claude/hooks/
 */
/**
 * Compare two files by content - returns true if identical
 * yooo this prevents unnecessary file copies for fast startup
 */
function filesAreIdentical(srcPath, dstPath) {
  try {
    if (!fs.existsSync(dstPath)) return false;
    const srcStat = fs.statSync(srcPath);
    const dstStat = fs.statSync(dstPath);
    // Quick check: different sizes = definitely different
    if (srcStat.size !== dstStat.size) return false;
    // Compare actual content
    const srcContent = fs.readFileSync(srcPath);
    const dstContent = fs.readFileSync(dstPath);
    return srcContent.equals(dstContent);
  } catch (err) {
    return false; // If error, assume different and copy
  }
}

function copyHookFilesSilent() {
  const sourceDir = path.join(__dirname, 'claude-hooks');
  const targetDir = path.join(os.homedir(), '.claude', 'hooks');
  const copied = [];

  // Ensure target directory exists
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true, mode: 0o755 });
    } catch (err) {
      return { success: false, copied: [] };
    }
  }

  // Check source directory
  if (!fs.existsSync(sourceDir)) {
    return { success: false, copied: [] };
  }

  // Copy hook files ONLY if content differs (fast startup optimization)
  try {
    const files = fs.readdirSync(sourceDir);
    for (const file of files) {
      if (file.endsWith('.js') || file.endsWith('.cjs') || file.endsWith('.py') || file.endsWith('.sh') || file.endsWith('.json')) {
        const srcPath = path.join(sourceDir, file);
        const dstPath = path.join(targetDir, file);

        // Skip if file content is identical - prevents race condition with 
        if (filesAreIdentical(srcPath, dstPath)) {
          continue;
        }

        try {
          fs.copyFileSync(srcPath, dstPath);
          fs.chmodSync(dstPath, 0o755);
          copied.push(file);
        } catch (err) {
          // Continue on individual file errors
        }
      }
    }
  } catch (err) {
    // Non-fatal
  }

  return { success: copied.length > 0, copied };
}

/**
 * Copy command files from specmem/commands to ~/.claude/commands/
 */
function copyCommandFilesSilent() {
  const sourceDir = path.join(__dirname, 'commands');
  const targetDir = path.join(os.homedir(), '.claude', 'commands');
  const copied = [];

  // Ensure target directory exists
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true, mode: 0o755 });
    } catch (err) {
      return { success: false, copied: [] };
    }
  }

  // Check source directory
  if (!fs.existsSync(sourceDir)) {
    return { success: false, copied: [] };
  }

  // Remove old specmem commands that no longer exist
  try {
    const existingFiles = fs.readdirSync(targetDir);
    for (const file of existingFiles) {
      if (file.startsWith('specmem-') && file.endsWith('.md')) {
        const srcPath = path.join(sourceDir, file);
        if (!fs.existsSync(srcPath)) {
          try {
            fs.unlinkSync(path.join(targetDir, file));
          } catch (err) {
            // Continue
          }
        }
      }
    }
  } catch (err) {
    // Non-fatal
  }

  // Copy command files ONLY if content differs (fast startup optimization)
  try {
    const files = fs.readdirSync(sourceDir);
    for (const file of files) {
      if (file.endsWith('.md')) {
        const srcPath = path.join(sourceDir, file);
        const dstPath = path.join(targetDir, file);

        // Skip if file content is identical - prevents race condition with 
        if (filesAreIdentical(srcPath, dstPath)) {
          continue;
        }

        try {
          fs.copyFileSync(srcPath, dstPath);
          copied.push(file.replace('.md', ''));
        } catch (err) {
          // Continue on individual file errors
        }
      }
    }
  } catch (err) {
    // Non-fatal
  }

  return { success: copied.length > 0, copied };
}

/**
 * Ensure hooks are properly configured in ~/.claude/settings.json
 *
 * Hook format rules (from  Code source):
 * - UserPromptSubmit, SessionStart, Stop: NO matcher field
 * - PreToolUse, PostToolUse, PermissionRequest: matcher is a STRING pattern
 */
function ensureSettingsJsonSilent() {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  const hooksDir = path.join(os.homedir(), '.claude', 'hooks');

  // Read existing settings
  const settings = safeReadJson(settingsPath);

  // Ensure hooks object exists
  if (!settings.hooks) {
    settings.hooks = {};
  }

  let needsUpdate = false;

  // Hook paths
  const drilldownHookPath = path.join(hooksDir, 'specmem-drilldown-hook.js');
  const smartContextHookPath = path.join(hooksDir, 'smart-context-hook.js');
  const inputAwareHookPath = path.join(hooksDir, 'input-aware-improver.js');

  // -------------------------------------------------------------------------
  // UserPromptSubmit hooks - NO matcher field
  // -------------------------------------------------------------------------
  const userPromptValid = settings.hooks.UserPromptSubmit?.length > 0 &&
    settings.hooks.UserPromptSubmit.every(h =>
      h.matcher === undefined && // No matcher for UserPromptSubmit
      h.hooks?.length > 0 &&
      h.hooks.some(hook => hook.command?.includes('specmem'))
    );

  // Standard env config with dynamic ${cwd} expansion
  const drilldownEnv = {
    SPECMEM_PROJECT_PATH: '${cwd}',
    SPECMEM_RUN_DIR: '${cwd}/specmem/sockets',
    SPECMEM_EMBEDDING_SOCKET: '${cwd}/specmem/sockets/embeddings.sock',
    SPECMEM_SEARCH_LIMIT: '5',
    SPECMEM_THRESHOLD: '0.25',
    SPECMEM_MAX_CONTENT: '300'
  };

  // MERGE UserPromptSubmit hooks - don't clobber existing non-SpecMem hooks
  if (fs.existsSync(drilldownHookPath)) {
    if (!Array.isArray(settings.hooks.UserPromptSubmit)) {
      settings.hooks.UserPromptSubmit = [];
    }

    // Check if SpecMem drilldown hook already exists
    const hasDrilldown = settings.hooks.UserPromptSubmit.some(entry =>
      entry.hooks?.some(h => h.command?.includes('specmem-drilldown'))
    );

    if (!hasDrilldown) {
      // Add SpecMem drilldown hook without removing existing hooks
      settings.hooks.UserPromptSubmit.push({
        hooks: [{
          type: 'command',
          command: `node ${drilldownHookPath}`,
          timeout: 30,
          statusMessage: '🔍 Searching SpecMem...',
          env: drilldownEnv
        }]
      });
      needsUpdate = true;
    }

    // Add input-aware-improver if it exists and not already present
    if (fs.existsSync(inputAwareHookPath)) {
      const hasInputAware = settings.hooks.UserPromptSubmit.some(entry =>
        entry.hooks?.some(h => h.command?.includes('input-aware'))
      );

      if (!hasInputAware) {
        settings.hooks.UserPromptSubmit.push({
          hooks: [{
            type: 'command',
            command: `node ${inputAwareHookPath}`,
            timeout: 5,
            env: drilldownEnv
          }]
        });
        needsUpdate = true;
      }
    }
  }

  // -------------------------------------------------------------------------
  // PreToolUse hooks - MERGE without clobbering existing non-SpecMem hooks
  // Uses ${cwd} for dynamic path expansion
  // -------------------------------------------------------------------------

  // Standard env config for smart-context hooks (dynamic paths via ${cwd})
  const smartContextEnv = {
    SPECMEM_PROJECT_PATH: '${cwd}',
    SPECMEM_RUN_DIR: '${cwd}/specmem/sockets',
    SPECMEM_EMBEDDING_SOCKET: '${cwd}/specmem/sockets/embeddings.sock',
    SPECMEM_SEARCH_LIMIT: '5',
    SPECMEM_THRESHOLD: '0.25',
    SPECMEM_MAX_CONTENT: '200'
  };

  // Helper: Check if a hook entry is SpecMem-related
  const isSpecmemHook = (entry) => {
    return entry.hooks?.some(h =>
      h.command?.includes('specmem') ||
      h.command?.includes('smart-context')
    );
  };

  // Helper: Check if two hook entries are equivalent (to avoid unnecessary rewrites)
  const hooksAreEquivalent = (a, b) => {
    if (!a || !b) return false;
    if (a.matcher !== b.matcher) return false;
    if (a.hooks?.length !== b.hooks?.length) return false;
    // Compare first hook's command (main identifier)
    const aCmd = a.hooks?.[0]?.command || '';
    const bCmd = b.hooks?.[0]?.command || '';
    return aCmd === bCmd;
  };

  // SpecMem tool matchers we want to configure
  const specmemToolMatchers = ['Read', 'Grep', 'Glob'];

  if (fs.existsSync(smartContextHookPath)) {
    // Initialize PreToolUse array if needed
    if (!Array.isArray(settings.hooks.PreToolUse)) {
      settings.hooks.PreToolUse = [];
    }

    for (const matcher of specmemToolMatchers) {
      // Find existing entry for this matcher
      const existingIdx = settings.hooks.PreToolUse.findIndex(e => e.matcher === matcher);

      // Create the SpecMem hook entry
      const specmemEntry = {
        matcher: matcher,
        hooks: [{
          type: 'command',
          command: `node ${smartContextHookPath}`,
          timeout: 10,
          env: smartContextEnv
        }]
      };

      if (existingIdx >= 0) {
        const existing = settings.hooks.PreToolUse[existingIdx];
        if (isSpecmemHook(existing)) {
          // Only replace if actually different (avoid constant rewrites)
          if (!hooksAreEquivalent(existing, specmemEntry)) {
            settings.hooks.PreToolUse[existingIdx] = specmemEntry;
            needsUpdate = true;
          }
        }
        // If it's not a SpecMem hook, leave it alone (user's custom hook)
      } else {
        // No existing entry - add new SpecMem hook
        settings.hooks.PreToolUse.push(specmemEntry);
        needsUpdate = true;
      }
    }
  }

  // -------------------------------------------------------------------------
  // SessionStart hooks - NO matcher field
  // -------------------------------------------------------------------------
  const sessionStartValid = settings.hooks.SessionStart?.length > 0 &&
    settings.hooks.SessionStart.every(h =>
      h.matcher === undefined &&
      h.hooks?.length > 0
    );

  // SessionStart hook - MERGE without clobbering
  const sessionStartHookPath = path.join(hooksDir, 'specmem-session-start.cjs');
  if (fs.existsSync(sessionStartHookPath)) {
    if (!Array.isArray(settings.hooks.SessionStart)) {
      settings.hooks.SessionStart = [];
    }

    // Check if SpecMem session start hook already exists
    const hasSessionStart = settings.hooks.SessionStart.some(entry =>
      entry.hooks?.some(h => h.command?.includes('specmem-session-start'))
    );

    if (!hasSessionStart) {
      settings.hooks.SessionStart.push({
        hooks: [{
          type: 'command',
          command: `node ${sessionStartHookPath}`,
          timeout: 30,
          statusMessage: '🚀 Loading SpecMem context...',
          env: drilldownEnv
        }]
      });
      needsUpdate = true;
    }
  }

  // -------------------------------------------------------------------------
  // Stop hooks - MERGE without clobbering
  // -------------------------------------------------------------------------
  const stopHookPath = path.join(hooksDir, 'specmem-stop-hook.js');
  if (fs.existsSync(stopHookPath)) {
    if (!Array.isArray(settings.hooks.Stop)) {
      settings.hooks.Stop = [];
    }

    // Check if SpecMem stop hook already exists
    const hasStopHook = settings.hooks.Stop.some(entry =>
      entry.hooks?.some(h => h.command?.includes('specmem'))
    );

    if (!hasStopHook) {
      settings.hooks.Stop.push({
        hooks: [{
          type: 'command',
          command: `node ${stopHookPath}`,
          timeout: 15,
          env: drilldownEnv
        }]
      });
      needsUpdate = true;
    }
  }

  // Write changes if needed
  if (!needsUpdate) {
    return { success: true, changed: false };
  }

  if (safeWriteJson(settingsPath, settings)) {
    logSuccess('Hooks configured in settings.json');
    return { success: true, changed: true };
  }

  return { success: false, changed: false };
}

/**
 * Run silent auto-install - MUST be called early before MCP server starts
 *
 * This ensures:
 * 1. SpecMem is registered in ~/.claude/config.json
 * 2. Hooks are copied to ~/.claude/hooks/
 * 3. Commands are copied to ~/.claude/commands/
 * 4. settings.json has correct hook configuration
 */
function runSilentAutoInstall() {
  logStep('SILENT-INSTALL', 'Ensuring SpecMem is configured in  Code...');

  // Step 1: Ensure config.json has SpecMem registered
  const configResult = ensureConfigJsonSilent();
  if (configResult.changed) {
    logSuccess('config.json updated');
  }

  // Step 2: Copy hook files
  const hooksResult = copyHookFilesSilent();
  if (hooksResult.copied.length > 0) {
    logSuccess(`Copied ${hooksResult.copied.length} hook files`);
  }

  // Step 3: Copy command files
  const commandsResult = copyCommandFilesSilent();
  if (commandsResult.copied.length > 0) {
    logSuccess(`Copied ${commandsResult.copied.length} command files`);
  }

  // Step 4: Ensure settings.json has correct hook configuration
  const settingsResult = ensureSettingsJsonSilent();
  if (settingsResult.changed) {
    logSuccess('settings.json updated');
  }

  // Log summary - only show restart warning if config files changed
  const anyChanges = configResult.changed || settingsResult.changed ||
                     hooksResult.copied.length > 0 || commandsResult.copied.length > 0;
  if (anyChanges) {
    logSuccess('Silent auto-install complete -  Code config updated');
    logWarn('NOTE: Restart  Code for changes to take effect');
  }
  // No message when nothing changed - faster startup, less noise

  return {
    configChanged: configResult.changed,
    settingsChanged: settingsResult.changed,
    hooksCopied: hooksResult.copied,
    commandsCopied: commandsResult.copied
  };
}

// ============================================================================
// END SILENT AUTO-INSTALL SYSTEM
// ============================================================================

/**
 * Check if this is the first time running SpecMem
 * yooo detecting first run fr fr
 */
function isThisTheFirstRodeo() {
  const configPath = path.join(os.homedir(), '.specmem', 'config.json');
  const firstRunMarker = path.join(__dirname, '.installed');
  return !fs.existsSync(configPath) && !fs.existsSync(firstRunMarker);
}

/**
 * Check if node_modules exists and has required deps
 * nah bruh checking if deps installed
 */
function areDepsInstalled() {
  const nodeModulesPath = path.join(__dirname, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    return false;
  }

  // check for critical dependencies
  // Note: @modelcontextprotocol/sdk is ESM-only, check for server/index.js instead
  const requiredDeps = ['pg', 'chokidar', 'zod'];
  for (const dep of requiredDeps) {
    try {
      require.resolve(dep);
    } catch {
      return false;
    }
  }

  // Special check for MCP SDK (ESM module with subpath exports)
  const mcpServerPath = path.join(__dirname, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'server', 'index.js');
  if (!fs.existsSync(mcpServerPath)) {
    return false;
  }

  return true;
}

/**
 * Check if TypeScript has been built
 * yo checking if we got that dist folder
 */
function isBuilt() {
  const distPath = path.join(__dirname, 'dist');
  const indexPath = path.join(distPath, 'index.js');
  return fs.existsSync(distPath) && fs.existsSync(indexPath);
}

/**
 * Get the newest modification time of all .ts files in a directory (recursive)
 * Returns timestamp in milliseconds, or 0 if no files found
 */
function getNewestTsFileTime(dirPath) {
  let newestTime = 0;

  function scanDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip node_modules and hidden dirs
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }

        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          const stats = fs.statSync(fullPath);
          if (stats.mtimeMs > newestTime) {
            newestTime = stats.mtimeMs;
          }
        }
      }
    } catch (e) {
      // Ignore errors - directory might not exist or not be readable
    }
  }

  scanDir(dirPath);
  return newestTime;
}

/**
 * Get the oldest modification time of all .js files in dist/ (recursive)
 * Returns timestamp in milliseconds, or Infinity if no files found
 */
function getOldestDistFileTime(dirPath) {
  let oldestTime = Infinity;

  function scanDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          const stats = fs.statSync(fullPath);
          if (stats.mtimeMs < oldestTime) {
            oldestTime = stats.mtimeMs;
          }
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }

  scanDir(dirPath);
  return oldestTime;
}

/**
 * Check if src/ TypeScript files are newer than dist/ JavaScript files
 * This indicates we need to recompile before loading dist/
 * Critical for MCP reconnect to pick up code changes!
 */
function isDistStale() {
  const srcPath = path.join(__dirname, 'src');
  const distPath = path.join(__dirname, 'dist');

  // If dist doesn't exist, it's definitely stale
  if (!fs.existsSync(distPath)) {
    startupLog('dist/ does not exist - needs build');
    return true;
  }

  const newestSrcTime = getNewestTsFileTime(srcPath);
  const oldestDistTime = getOldestDistFileTime(distPath);

  // If src/ is newer than any dist/ file, we need to recompile
  const isStale = newestSrcTime > oldestDistTime;

  if (isStale) {
    startupLog(`dist/ is STALE: src newest=${new Date(newestSrcTime).toISOString()}, dist oldest=${new Date(oldestDistTime).toISOString()}`);
  } else {
    startupLog(`dist/ is fresh: src newest=${new Date(newestSrcTime).toISOString()}, dist oldest=${new Date(oldestDistTime).toISOString()}`);
  }

  return isStale;
}

/**
 * Recompile TypeScript if src/ is newer than dist/
 * Called on every startup to ensure /mcp reconnect picks up code changes
 */
async function recompileIfStale() {
  if (!isDistStale()) {
    return false; // No recompile needed
  }

  log('[RECOMPILE] TypeScript sources are newer than dist/ - recompiling...', colors.yellow);
  startupLog('Triggering recompile due to stale dist/');

  try {
    // Use synchronous exec to ensure build completes before we continue
    const { execSync } = require('child_process');
    execSync('npm run build', {
      cwd: __dirname,
      stdio: isMcpMode ? 'pipe' : 'inherit',
      timeout: 120000 // 2 minute timeout
    });

    log('[RECOMPILE] TypeScript recompilation complete!', colors.green);
    startupLog('Recompilation successful');
    return true;
  } catch (err) {
    log(`[RECOMPILE] Warning: Recompilation failed: ${err.message}`, colors.yellow);
    startupLog(`Recompilation failed: ${err.message}`);
    // Continue with existing dist/ - better than crashing
    return false;
  }
}

/**
 * Install dependencies
 * yeet them dependencies in fr fr
 */
async function yeetDependenciesIn() {
  logStep('INSTALL', 'Installing npm dependencies...');

  return new Promise((resolve, reject) => {
    // In MCP mode, pipe output to stderr to avoid corrupting JSON-RPC stream
    const npm = spawn('npm', ['install'], {
      cwd: __dirname,
      stdio: isMcpMode ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: true
    });

    if (isMcpMode) {
      npm.stdout.pipe(process.stderr);
      npm.stderr.pipe(process.stderr);
    }

    npm.on('close', (code) => {
      if (code === 0) {
        logSuccess('Dependencies installed successfully');
        resolve();
      } else {
        reject(new Error(`npm install failed with code ${code}`));
      }
    });

    npm.on('error', reject);
  });
}

/**
 * Build TypeScript
 * compile that typescript yo
 */
async function buildTheCode() {
  logStep('BUILD', 'Compiling TypeScript...');

  return new Promise((resolve, reject) => {
    // In MCP mode, pipe output to stderr to avoid corrupting JSON-RPC stream
    const tsc = spawn('npm', ['run', 'build'], {
      cwd: __dirname,
      stdio: isMcpMode ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: true
    });

    if (isMcpMode) {
      tsc.stdout.pipe(process.stderr);
      tsc.stderr.pipe(process.stderr);
    }

    tsc.on('close', (code) => {
      if (code === 0) {
        logSuccess('TypeScript compiled successfully');
        resolve();
      } else {
        reject(new Error(`TypeScript build failed with code ${code}`));
      }
    });

    tsc.on('error', reject);
  });
}

/**
 * Test PostgreSQL connection
 * yo can we connect to postgres tho
 */
async function testPostgresConnection() {
  logStep('DATABASE', 'Testing PostgreSQL connection...');

  // check if pg is available
  let pg;
  try {
    pg = require('pg');
  } catch {
    logWarn('PostgreSQL client not installed yet, will test after install');
    return { connected: false, reason: 'pg_not_installed' };
  }

  // try to connect with env vars
  const config = {
    host: process.env.SPECMEM_DB_HOST || 'localhost',
    port: parseInt(process.env.SPECMEM_DB_PORT || '5432', 10),
    database: process.env.SPECMEM_DB_NAME || getUnifiedCredential(),
    user: process.env.SPECMEM_DB_USER || getUnifiedCredential(),
    password: process.env.SPECMEM_DB_PASSWORD,
  };

  if (!config.password) {
    logWarn('SPECMEM_DB_PASSWORD not set, will try auto-setup');
    return { connected: false, reason: 'no_password', config };
  }

  const client = new pg.Client(config);

  try {
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    logSuccess('PostgreSQL connection successful');
    return { connected: true, config };
  } catch (err) {
    logWarn(`PostgreSQL connection failed: ${err.message}`);
    return { connected: false, reason: 'connection_failed', config, error: err.message };
  }
}

/**
 * Show database setup instructions
 * yo tell the user how to setup postgres fr
 */
function showDatabaseInstructions() {
  log('\n' + '='.repeat(60), colors.bright);
  log('DATABASE SETUP REQUIRED', colors.yellow);
  log('='.repeat(60), colors.bright);

  log('\nSpecMem requires PostgreSQL with pgvector extension.', colors.cyan);
  log('\nQuick setup options:\n');

  log('Option 1: Docker (recommended)', colors.green);
  log('  docker run -d \\');
  log('    --name specmem-db \\');
  log('    -e POSTGRES_USER=specmem_westayunprofessional \\');
  log('    -e POSTGRES_PASSWORD=${SPECMEM_PASSWORD:-specmem_westayunprofessional} \\');
  log('    -e POSTGRES_DB=specmem_westayunprofessional \\');
  log('    -p 5432:5432 \\');
  log('    ankane/pgvector:latest\n');

  log('Option 2: Local PostgreSQL', colors.green);
  log('  1. Install PostgreSQL and pgvector extension');
  log('  2. CREATE DATABASE specmem;');
  log('  3. CREATE USER specmem WITH PASSWORD \'your_password\';');
  log('  4. GRANT ALL ON DATABASE specmem TO specmem;\n');

  log('Then set environment variables:', colors.cyan);
  log('  export SPECMEM_DB_PASSWORD=specmem_westayunprofessional');
  log('  export SPECMEM_DB_HOST=localhost');
  log('  export SPECMEM_DB_PORT=5432');
  log('  export SPECMEM_DB_NAME=specmem_westayunprofessional');
  log('  export SPECMEM_DB_USER=specmem_westayunprofessional\n');

  log('Or update specmem.env in:', colors.cyan);
  log(`  ${__dirname}/specmem.env\n`);

  log('='.repeat(60) + '\n', colors.bright);
}

/**
 * Run database migrations
 * yo run them migrations fr
 */
async function runMigrations() {
  logStep('MIGRATE', 'Running database migrations...');

  return new Promise((resolve, reject) => {
    // In MCP mode, pipe output to stderr to avoid corrupting JSON-RPC stream
    const migrate = spawn('npm', ['run', 'migrate'], {
      cwd: __dirname,
      stdio: isMcpMode ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: true
    });

    if (isMcpMode) {
      migrate.stdout.pipe(process.stderr);
      migrate.stderr.pipe(process.stderr);
    }

    migrate.on('close', (code) => {
      if (code === 0) {
        logSuccess('Database migrations complete');
        resolve();
      } else {
        logWarn('Migrations may have failed, but continuing...');
        resolve(); // don't block on migration failures
      }
    });

    migrate.on('error', (err) => {
      logWarn(`Migration error: ${err.message}`);
      resolve(); // don't block on migration errors
    });
  });
}

/**
 * Create first-run marker
 * yo mark this as installed fr fr
 */
function markAsInstalled() {
  const markerPath = path.join(__dirname, '.installed');
  fs.writeFileSync(markerPath, new Date().toISOString());
}

/**
 * Enable MCP tools for Task-spawned teamMembers
 * yooo this is the secret sauce that makes teamMembers work with MCP fr fr
 * we found this by reversing the claude code binary lmaooo
 */
/**
 * Install SpecMem hooks into  Code settings
 * These hooks auto-inject memory context into prompts
 */
function installSpecMemHooks() {
  logStep('HOOKS', 'Installing SpecMem context injection hooks...');

  const claudeDir = path.join(os.homedir(), '.claude');
  const hooksDir = path.join(claudeDir, 'hooks');
  const settingsPath = path.join(claudeDir, 'settings.json');
  // Use claude-hooks directory - this is the source of truth for all hooks
  const specmemHooksDir = path.join(__dirname, 'claude-hooks');

  // Ensure hooks directory exists
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  // Copy ALL hook files from specmem/claude-hooks to user's hooks dir
  let copiedHooks = [];
  if (fs.existsSync(specmemHooksDir)) {
    const hookFiles = fs.readdirSync(specmemHooksDir);
    for (const hookFile of hookFiles) {
      if (hookFile.endsWith('.js') || hookFile.endsWith('.py') || hookFile.endsWith('.sh')) {
        const srcPath = path.join(specmemHooksDir, hookFile);
        const dstPath = path.join(hooksDir, hookFile);

        try {
          fs.copyFileSync(srcPath, dstPath);
          fs.chmodSync(dstPath, 0o755); // make executable
          copiedHooks.push(hookFile);
        } catch (err) {
          logWarn(`Could not copy hook ${hookFile}: ${err.message}`);
        }
      }
    }
  } else {
    logWarn(`SpecMem hooks source directory not found: ${specmemHooksDir}`);
  }

  if (copiedHooks.length > 0) {
    logSuccess(`Copied hooks: ${copiedHooks.join(', ')}`);
  }

  // Update  settings to enable hooks with NEW format (matcher as object)
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      let needsUpdate = false;

      // Check if hooks need updating (missing or using old format without matcher object)
      settings.hooks = settings.hooks || {};

      // Check for invalid format (matcher as object - should be omitted for UserPromptSubmit)
      const hasInvalidFormat = settings.hooks.UserPromptSubmit?.some(h =>
        typeof h.matcher === 'object'  // Object is invalid for UserPromptSubmit
      );

      // PRESERVE existing hooks - only add SpecMem hooks if missing
      if (!settings.hooks.UserPromptSubmit) {
        settings.hooks.UserPromptSubmit = [];
      }

      // Check if our drilldown hook exists
      const hasDrilldown = settings.hooks.UserPromptSubmit.some(h =>
        h.hooks?.some(hk => hk.command?.includes('specmem-drilldown-hook'))
      );

      if (!hasDrilldown) {
        settings.hooks.UserPromptSubmit.push({
          hooks: [{
            type: 'command',
            command: `node ${path.join(hooksDir, 'specmem-drilldown-hook.js')}`,
            timeout: 30,
            env: {
              SPECMEM_SEARCH_LIMIT: '5',
              SPECMEM_THRESHOLD: '0.30',
              SPECMEM_MAX_CONTENT: '200'
            }
          }]
        });
        needsUpdate = true;
      }

      // Check if input-aware-improver exists and is needed
      const hasInputAware = settings.hooks.UserPromptSubmit.some(h =>
        h.hooks?.some(hk => hk.command?.includes('input-aware-improver'))
      );

      if (!hasInputAware && fs.existsSync(path.join(hooksDir, 'input-aware-improver.js'))) {
        settings.hooks.UserPromptSubmit.push({
          hooks: [{
            type: 'command',
            command: `node ${path.join(hooksDir, 'input-aware-improver.js')}`,
            timeout: 5
          }]
        });
        needsUpdate = true;
      }

      // PRESERVE existing PreToolUse hooks - only add SpecMem hooks if missing
      if (!settings.hooks.PreToolUse) {
        settings.hooks.PreToolUse = [];
      }

      // Check if smart-context-hook exists for common tools
      const hasSmartContext = settings.hooks.PreToolUse.some(h =>
        h.hooks?.some(hk => hk.command?.includes('smart-context-hook'))
      );

      if (!hasSmartContext && fs.existsSync(path.join(hooksDir, 'smart-context-hook.js'))) {
        // Add for Read, Grep, Glob tools (not all tools with "*")
        ['Read', 'Grep', 'Glob'].forEach(tool => {
          const hasTool = settings.hooks.PreToolUse.some(h => h.matcher === tool);
          if (!hasTool) {
            settings.hooks.PreToolUse.push({
              matcher: tool,
              hooks: [{
                type: 'command',
                command: `node ${path.join(hooksDir, 'smart-context-hook.js')}`,
                timeout: 10,
                env: {
                  SPECMEM_SEARCH_LIMIT: '5',
                  SPECMEM_THRESHOLD: '0.25',
                  SPECMEM_MAX_CONTENT: '200'
                }
              }]
            });
          }
        });
        needsUpdate = true;
      }

      if (needsUpdate) {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        logSuccess('Updated SpecMem hooks to new format in  settings');
        return { installed: true, needsRestart: true };
      } else {
        logSuccess('SpecMem hooks already configured with correct format');
        return { installed: true, alreadySet: true };
      }
    } catch (err) {
      logWarn(`Could not update  settings: ${err.message}`);
      return { installed: false, error: err.message };
    }
  } else {
    logWarn(' settings.json not found - hooks not registered');
    return { installed: false, error: 'settings.json not found' };
  }
}

/**
 * Install SpecMem slash commands to 's commands directory
 * These are the /specmem-* commands for memory operations
 */
function installSpecMemCommands() {
  logStep('COMMANDS', 'Installing SpecMem slash commands...');

  const claudeDir = path.join(os.homedir(), '.claude');
  const commandsDir = path.join(claudeDir, 'commands');
  const specmemCommandsDir = path.join(__dirname, 'commands');

  // Ensure commands directory exists
  if (!fs.existsSync(commandsDir)) {
    fs.mkdirSync(commandsDir, { recursive: true });
  }

  // Clean up old SpecMem command files (removes renamed/deleted commands)
  if (fs.existsSync(commandsDir)) {
    const existingCommands = fs.readdirSync(commandsDir);
    const oldSpecmemCommands = existingCommands.filter(f => f.startsWith('specmem-') && f.endsWith('.md'));

    for (const oldCmd of oldSpecmemCommands) {
      const oldPath = path.join(commandsDir, oldCmd);
      const newPath = path.join(specmemCommandsDir, oldCmd);

      // If command doesn't exist in source anymore, remove it
      if (!fs.existsSync(newPath)) {
        try {
          fs.unlinkSync(oldPath);
          logSuccess(`Removed outdated command: ${oldCmd}`);
        } catch (err) {
          logWarn(`Could not remove old command ${oldCmd}: ${err.message}`);
        }
      }
    }
  }

  // Copy ALL command files from specmem/commands to user's commands dir
  let copiedCommands = [];
  if (fs.existsSync(specmemCommandsDir)) {
    const commandFiles = fs.readdirSync(specmemCommandsDir);
    for (const cmdFile of commandFiles) {
      if (cmdFile.endsWith('.md')) {
        const srcPath = path.join(specmemCommandsDir, cmdFile);
        const dstPath = path.join(commandsDir, cmdFile);

        try {
          fs.copyFileSync(srcPath, dstPath);
          copiedCommands.push(cmdFile.replace('.md', ''));
        } catch (err) {
          logWarn(`Could not copy command ${cmdFile}: ${err.message}`);
        }
      }
    }
  } else {
    logWarn(`SpecMem commands source directory not found: ${specmemCommandsDir}`);
  }

  if (copiedCommands.length > 0) {
    logSuccess(`Installed commands: /${copiedCommands.join(', /')}`);
    return { installed: true, commands: copiedCommands };
  }

  return { installed: false };
}

// ============================================================================
// CONFIG AUTO-SYNC SYSTEM
// Ensures config.json and settings.json are always in sync
// ============================================================================

/**
 * Check and fix config synchronization between config.json and settings.json
 *
 * PROBLEM SOLVED:
 * - config.json may point to dist/index.js instead of bootstrap.cjs
 * - settings.json hooks may have wrong format (object matcher vs string)
 * - This causes startup failures
 *
 * SOLUTION:
 * - AUTHORITATIVE SOURCE: bootstrap.cjs is always the entry point
 * - config.json: MCP server entry points to bootstrap.cjs
 * - settings.json: Hooks use correct format for each event type
 */
function runConfigAutoSync() {
  logStep('CONFIG-SYNC', 'Checking config synchronization...');

  const claudeDir = path.join(os.homedir(), '.claude');
  const configPath = path.join(claudeDir, 'config.json');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const hooksDir = path.join(claudeDir, 'hooks');
  const bootstrapPath = path.join(__dirname, 'bootstrap.cjs');

  const mismatches = [];
  let configFixed = false;
  let settingsFixed = false;

  // Ensure directories exist
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  // -------------------------------------------------------------------------
  // CHECK CONFIG.JSON - MCP Server Entry
  // -------------------------------------------------------------------------
  try {
    let config = {};
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }

    config.mcpServers = config.mcpServers || {};
    const specmem = config.mcpServers.specmem;

    let needsConfigFix = false;

    // Check if specmem entry exists and points to bootstrap.cjs
    if (!specmem) {
      mismatches.push({ file: 'config.json', issue: 'specmem entry missing' });
      needsConfigFix = true;
    } else {
      // Check if args[1] points to bootstrap.cjs (not dist/index.js)
      const entryPoint = specmem.args?.[1];
      if (!entryPoint || !entryPoint.endsWith('bootstrap.cjs')) {
        mismatches.push({
          file: 'config.json',
          issue: `entry point is ${entryPoint || 'undefined'}, should be ${bootstrapPath}`
        });
        needsConfigFix = true;
      }
    }

    if (needsConfigFix) {
      // Fix config.json
      config.mcpServers.specmem = {
        command: 'node',
        args: ['--max-old-space-size=250', bootstrapPath],
        env: {
          HOME: process.env.HOME || os.homedir(),
          SPECMEM_PROJECT_PATH: '${PWD}',
          SPECMEM_WATCHER_ROOT_PATH: '${PWD}',
          SPECMEM_CODEBASE_PATH: '${PWD}',
          SPECMEM_DB_HOST: process.env.SPECMEM_DB_HOST || 'localhost',
          SPECMEM_DB_PORT: process.env.SPECMEM_DB_PORT || '5432',
          SPECMEM_DB_NAME: process.env.SPECMEM_DB_NAME || getUnifiedCredential(),
          SPECMEM_DB_USER: process.env.SPECMEM_DB_USER || getUnifiedCredential(),
          SPECMEM_DB_PASSWORD: process.env.SPECMEM_DB_PASSWORD || getUnifiedCredential(),
          SPECMEM_SESSION_WATCHER_ENABLED: process.env.SPECMEM_SESSION_WATCHER_ENABLED || 'true',
          SPECMEM_MAX_HEAP_MB: process.env.SPECMEM_MAX_HEAP_MB || '250',
          SPECMEM_DASHBOARD_ENABLED: process.env.SPECMEM_DASHBOARD_ENABLED || 'true',
          SPECMEM_DASHBOARD_PORT: process.env.SPECMEM_DASHBOARD_PORT || '8595',
          SPECMEM_DASHBOARD_HOST: process.env.SPECMEM_DASHBOARD_HOST || '0.0.0.0',
          SPECMEM_DASHBOARD_PASSWORD: process.env.SPECMEM_DASHBOARD_PASSWORD || ''
        }
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      configFixed = true;
      logSuccess('config.json synchronized - now points to bootstrap.cjs');
    }
  } catch (err) {
    logWarn(`Could not sync config.json: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // CHECK SETTINGS.JSON - Hook Format
  // -------------------------------------------------------------------------
  try {
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }

    settings.hooks = settings.hooks || {};
    let needsSettingsFix = false;

    // Define hook paths
    const drilldownHookPath = path.join(hooksDir, 'specmem-drilldown-hook.js');
    const smartContextHookPath = path.join(hooksDir, 'smart-context-hook.js');
    const inputAwareHookPath = path.join(hooksDir, 'input-aware-improver.js');

    // Check UserPromptSubmit - should NOT have matcher field
    const userPromptHooks = settings.hooks.UserPromptSubmit || [];
    const userPromptInvalid = userPromptHooks.some(h => h.matcher !== undefined);
    const userPromptMissingSpecmem = !userPromptHooks.some(h =>
      h.hooks?.some(hook => hook.command?.includes('specmem'))
    );

    if (userPromptInvalid || userPromptMissingSpecmem) {
      mismatches.push({
        file: 'settings.json',
        issue: userPromptInvalid ?
          'UserPromptSubmit has invalid matcher field' :
          'UserPromptSubmit missing specmem hooks'
      });
      needsSettingsFix = true;
    }

    // Check PreToolUse - matcher should be a STRING
    const preToolHooks = settings.hooks.PreToolUse || [];
    const preToolInvalid = preToolHooks.some(h => typeof h.matcher !== 'string');
    const preToolMissingSpecmem = !preToolHooks.some(h =>
      h.hooks?.some(hook => hook.command?.includes('specmem') || hook.command?.includes('smart-context'))
    );

    if (preToolInvalid || preToolMissingSpecmem) {
      mismatches.push({
        file: 'settings.json',
        issue: preToolInvalid ?
          'PreToolUse has non-string matcher' :
          'PreToolUse missing specmem hooks'
      });
      needsSettingsFix = true;
    }

    if (needsSettingsFix) {
      // Fix settings.json hooks

      // UserPromptSubmit - NO matcher
      if (fs.existsSync(drilldownHookPath)) {
        settings.hooks.UserPromptSubmit = [{
          hooks: [{
            type: 'command',
            command: `node ${drilldownHookPath}`,
            timeout: 30,
            env: {
              SPECMEM_SEARCH_LIMIT: '5',
              SPECMEM_THRESHOLD: '0.30',
              SPECMEM_MAX_CONTENT: '200'
            }
          }]
        }];

        if (fs.existsSync(inputAwareHookPath)) {
          settings.hooks.UserPromptSubmit.push({
            hooks: [{
              type: 'command',
              command: `node ${inputAwareHookPath}`,
              timeout: 5
            }]
          });
        }
      }

      // PreToolUse - STRING matcher
      if (fs.existsSync(smartContextHookPath)) {
        settings.hooks.PreToolUse = [{
          matcher: '*',
          hooks: [{
            type: 'command',
            command: `node ${smartContextHookPath}`,
            timeout: 10,
            env: {
              SPECMEM_SEARCH_LIMIT: '5',
              SPECMEM_THRESHOLD: '0.30',
              SPECMEM_MAX_CONTENT: '200'
            }
          }]
        }];
      }

      // SessionStart - NO matcher
      if (fs.existsSync(drilldownHookPath)) {
        settings.hooks.SessionStart = [{
          hooks: [{
            type: 'command',
            command: `node ${drilldownHookPath}`,
            timeout: 30,
            env: {
              SPECMEM_SEARCH_LIMIT: '5',
              SPECMEM_THRESHOLD: '0.30',
              SPECMEM_MAX_CONTENT: '200'
            }
          }]
        }];
      }

      // Stop - NO matcher
      if (fs.existsSync(drilldownHookPath)) {
        settings.hooks.Stop = [{
          hooks: [{
            type: 'command',
            command: `node ${drilldownHookPath}`,
            timeout: 15
          }]
        }];
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      settingsFixed = true;
      logSuccess('settings.json synchronized - hooks now have correct format');
    }
  } catch (err) {
    logWarn(`Could not sync settings.json: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  if (mismatches.length === 0) {
    logSuccess('Config already in sync');
  } else {
    log(`[CONFIG-SYNC] Found ${mismatches.length} mismatch(es):`, colors.yellow);
    for (const m of mismatches) {
      log(`  - ${m.file}: ${m.issue}`, colors.yellow);
    }
    if (configFixed || settingsFixed) {
      logSuccess('All mismatches have been fixed');
    }
  }

  return {
    success: true,
    configFixed,
    settingsFixed,
    mismatches
  };
}

/**
 * Setup runtime directory for sockets, logs, and temporary files
 * This is where the embedding service socket lives
 *
 * ALL DATA GOES IN {PROJECT_DIR}/specmem/ - NO /tmp, NO ~/.specmem!
 * Pattern:
 * - {PROJECT_DIR}/specmem/sockets/ - Unix sockets for Docker communication
 * - {PROJECT_DIR}/specmem/run/ - Runtime files (PID, logs, etc.)
 */
function setupRuntimeDirectory() {
  logStep('RUNTIME', 'Setting up runtime directories...');

  const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
  const specmemDir = path.join(projectPath, 'specmem');
  const socketDir = path.join(specmemDir, 'sockets');
  const runDir = path.join(specmemDir, 'run');

  try {
    // Setup specmem socket directory - THE ONLY socket location!
    if (!fs.existsSync(socketDir)) {
      fs.mkdirSync(socketDir, { recursive: true, mode: 0o777 });
      startupLog(`Created socket directory: ${socketDir}`);
    }
    fs.chmodSync(socketDir, 0o777);
    // Set ownership to UID 1001 (embed user in container) so docker can write socket
    try { fs.chownSync(socketDir, 1001, 1001); } catch (e) { /* ignore if not root */ }
    logSuccess(`Socket directory ready: ${socketDir}`);

    // Setup run directory for PID files, logs, etc.
    if (!fs.existsSync(runDir)) {
      fs.mkdirSync(runDir, { recursive: true, mode: 0o755 });
      startupLog(`Created run directory: ${runDir}`);
    }
    logSuccess(`Run directory ready: ${runDir}`);

    return { success: true, path: runDir, socketDir };
  } catch (err) {
    logWarn(`Could not setup runtime directory: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Auto-configure SpecMem MCP server in  config
 * Updates ~/.claude/config.json with correct path
 */
function configureMcpServer() {
  logStep('MCP-CONFIG', 'Configuring SpecMem MCP server in ...');

  const claudeDir = path.join(os.homedir(), '.claude');
  const configPath = path.join(claudeDir, 'config.json');
  const bootstrapPath = path.join(__dirname, 'bootstrap.cjs');

  // Ensure .claude directory exists
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  try {
    let config = {};

    // Read existing config
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      config = JSON.parse(content);
    }

    // Ensure mcpServers object exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    // Get current environment variables for SpecMem
    // NOTE: SPECMEM_PROJECT_PATH uses ${PWD} which  Code expands to the project directory
    // This makes SpecMem project-local automatically!
    const specmemEnv = {
      HOME: process.env.HOME || os.homedir(),
      // Project-local configuration - ${PWD} is expanded by  Code at runtime
      SPECMEM_PROJECT_PATH: '${PWD}',
      SPECMEM_WATCHER_ROOT_PATH: '${PWD}',
      SPECMEM_CODEBASE_PATH: '${PWD}',
      // Database configuration
      SPECMEM_DB_HOST: process.env.SPECMEM_DB_HOST || 'localhost',
      SPECMEM_DB_PORT: process.env.SPECMEM_DB_PORT || '5432',
      SPECMEM_DB_NAME: process.env.SPECMEM_DB_NAME || getUnifiedCredential(),
      SPECMEM_DB_USER: process.env.SPECMEM_DB_USER || getUnifiedCredential(),
      SPECMEM_DB_PASSWORD: process.env.SPECMEM_DB_PASSWORD || getUnifiedCredential(),
      // Session and dashboard configuration
      SPECMEM_SESSION_WATCHER_ENABLED: process.env.SPECMEM_SESSION_WATCHER_ENABLED || 'true',
      SPECMEM_WATCHER_ENABLED: process.env.SPECMEM_WATCHER_ENABLED || 'true',
      SPECMEM_MAX_HEAP_MB: process.env.SPECMEM_MAX_HEAP_MB || '250',
      SPECMEM_DASHBOARD_ENABLED: process.env.SPECMEM_DASHBOARD_ENABLED || 'true',
      SPECMEM_DASHBOARD_PORT: process.env.SPECMEM_DASHBOARD_PORT || '8595',
      SPECMEM_DASHBOARD_HOST: process.env.SPECMEM_DASHBOARD_HOST || '0.0.0.0',
      SPECMEM_DASHBOARD_PASSWORD: process.env.SPECMEM_DASHBOARD_PASSWORD || ''
    };

    // Configure or update SpecMem MCP server
    const currentConfig = config.mcpServers.specmem;
    const needsUpdate = !currentConfig ||
                        currentConfig.args?.[1] !== bootstrapPath ||
                        JSON.stringify(currentConfig.env) !== JSON.stringify(specmemEnv);

    if (needsUpdate) {
      config.mcpServers.specmem = {
        command: 'node',
        args: ['--max-old-space-size=250', bootstrapPath],
        env: specmemEnv
      };

      // Write config back
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      logSuccess(`MCP server configured at: ${bootstrapPath}`);
      return { configured: true, path: bootstrapPath };
    } else {
      logSuccess('MCP server already configured correctly');
      return { configured: true, alreadySet: true };
    }
  } catch (err) {
    logWarn(`Could not configure MCP server: ${err.message}`);
    logWarn(`Manually add to ~/.claude/config.json:`);
    logWarn(`  "specmem": { "command": "node", "args": ["--max-old-space-size=250", "${bootstrapPath}"] }`);
    return { configured: false, error: err.message };
  }
}

function enableMcpForTaskTeamMembers() {
  logStep('MCP-HACK', 'Enabling MCP tools for Task-spawned teamMembers...');

  const envVar = 'CLAUDE_CODE_ALLOW_MCP_TOOLS_FOR_SUBAGENTS';
  const exportLine = `export ${envVar}=1`;

  // Check common shell configs
  const shellConfigs = [
    path.join(os.homedir(), '.bashrc'),
    path.join(os.homedir(), '.zshrc'),
    path.join(os.homedir(), '.profile')
  ];

  let alreadySet = false;
  let configToModify = null;

  // Check if already set in any config
  for (const configPath of shellConfigs) {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      if (content.includes(envVar)) {
        alreadySet = true;
        logSuccess(`MCP for Task teamMembers already enabled in ${path.basename(configPath)}`);
        break;
      }
      // Use first existing config file
      if (!configToModify) {
        configToModify = configPath;
      }
    }
  }

  // Check if set in current environment
  if (process.env[envVar]) {
    alreadySet = true;
    logSuccess('MCP for Task teamMembers already enabled in environment');
  }

  if (!alreadySet && configToModify) {
    try {
      // Add the export line to shell config
      const comment = '\n# SpecMem: Enable MCP tools for  Code Task-spawned teamMembers\n';
      fs.appendFileSync(configToModify, comment + exportLine + '\n');
      logSuccess(`Added MCP Task team member support to ${path.basename(configToModify)}`);
      logWarn('IMPORTANT: Restart  Code for Task teamMembers to access SpecMem MCP tools!');
      return { added: true, file: configToModify, needsRestart: true };
    } catch (err) {
      logWarn(`Could not modify ${configToModify}: ${err.message}`);
      logWarn(`Manually add: ${exportLine}`);
      return { added: false, error: err.message };
    }
  }

  return { added: false, alreadySet };
}

/**
 * Start the actual MCP server
 * yooo lets start this mf
 *
 * CRITICAL FIX (Dec 2025): NO LONGER SPAWNS CHILD PROCESS!
 *
 * Previous bug: We spawned dist/index.js as a child process with stdio: 'inherit'.
 * This added ~400ms latency while Node.js loaded the child process.
 * During this gap,  Code's stdin was connected to bootstrap.cjs which
 * wasn't reading from it - causing the JSON-RPC handshake to fail.
 *
 * New approach: Dynamically import the ES module directly.
 * This eliminates the child process overhead and starts the MCP server ~400ms faster.
 * The module is loaded in-process, so stdin/stdout work immediately.
 */
async function startServer() {
  startupLog('startServer() called - starting MCP server DIRECTLY (no child process)');
  logStep('START', 'Starting SpecMem MCP Server...');

  const serverPath = path.join(__dirname, 'dist', 'index.js');
  startupLog(`Server path: ${serverPath}`);

  if (!fs.existsSync(serverPath)) {
    startupLog(`SERVER NOT FOUND: ${serverPath}`, { message: 'File does not exist' });
    logError(`Server not found at ${serverPath}`);
    process.exit(1);
  }
  startupLog('Server file exists, importing ES module directly...');

  try {
    // CRITICAL FIX: Import the ES module directly instead of spawning child process
    // This eliminates ~400ms startup latency and ensures stdin is immediately handled
    startupLog('About to dynamic import dist/index.js...');
    const serverModule = await import('./dist/index.js');
    startupLog('ES module imported successfully - MCP server is now running');

    // The module's main() function runs automatically on import (it's at module level)
    // So we don't need to call anything - the server is already started

  } catch (err) {
    startupLog('FATAL: Failed to import ES module', err);
    logError(`Failed to start server: ${err.message}`);
    console.error(err);
    process.exit(1);
  }
}

/**
 * Auto-setup database using new installer modules
 * yo lets setup that database automatically
 */
async function autoSetupDatabase() {
  logStep('AUTO-SETUP', 'Attempting automatic database setup...');

  try {
    // dynamically import the database setup modules (after TypeScript is built)
    const { quickSetupDatabase } = await import('./dist/installer/dbSetup.js');
    const { runAutoConfig } = await import('./dist/config/autoConfig.js');

    // run auto-config first to generate credentials
    logStep('CONFIG', 'Generating configuration...');
    const configResult = await runAutoConfig();

    if (configResult.wasGenerated) {
      logSuccess('Configuration generated automatically');

      // reload specmem.env file with new config with override to replace existing values
      require('dotenv').config({ path: path.join(__dirname, 'specmem.env'), override: true });

      // attempt automatic database setup
      logStep('DB-SETUP', 'Setting up database automatically...');
      const dbResult = await quickSetupDatabase(
        configResult.config.database.host,
        configResult.config.database.port,
        configResult.config.database.database,
        configResult.config.database.user
      );

      if (dbResult.success) {
        logSuccess('Database setup completed automatically!');
        logSuccess(`Database: ${configResult.config.database.database}`);
        logSuccess(`User: ${configResult.config.database.user}`);

        // update specmem.env with the connection details
        const envPath = path.join(__dirname, 'specmem.env');
        const envContent = require('fs').readFileSync(envPath, 'utf-8');
        // Note: password MUST be quoted if it contains # (treated as comment) or other special chars
        // Use the password from dbResult (which may have been generated)
        const password = dbResult.password || configResult.config.database.password;
        const newEnvContent = envContent.replace(
          /SPECMEM_DB_PASSWORD=.*/,
          `SPECMEM_DB_PASSWORD="${password}"`
        );
        require('fs').writeFileSync(envPath, newEnvContent, 'utf-8');

        // reload specmem.env again with override to replace existing values
        require('dotenv').config({ path: envPath, override: true });

        return true;
      } else {
        logWarn('Automatic database setup failed');
        logWarn(`Reason: ${dbResult.error || 'unknown'}`);
        return false;
      }
    }

    return false;
  } catch (err) {
    logWarn(`Database auto-setup error: ${err.message}`);
    return false;
  }
}

/**
 * Check if Docker is installed and running
 * yo we need docker for the embedding AI
 */
function isDockerReady() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean up old SpecMem Docker containers (> 9 hours old)
 * Uses specmem.created label timestamp to determine age
 * Only kills containers with specmem.project label (our containers)
 *
 * This prevents zombie containers from accumulating across sessions
 */
function cleanupOldDockerContainers() {
  const MAX_AGE_HOURS = 9;
  const MAX_AGE_SECONDS = MAX_AGE_HOURS * 60 * 60;
  const currentTime = Math.floor(Date.now() / 1000);

  try {
    if (!isDockerReady()) {
      startupLog('cleanupOldDockerContainers: Docker not ready, skipping');
      return { cleaned: 0, skipped: 0 };
    }

    // Get all running specmem containers with their creation timestamps
    // Format: container_id|created_timestamp
    const result = execSync(
      'docker ps -q --filter "label=specmem.project" --filter "status=running" ' +
      '--format "{{.ID}}" 2>/dev/null || true',
      { encoding: 'utf-8' }
    ).trim();

    if (!result) {
      startupLog('cleanupOldDockerContainers: No running specmem containers found');
      return { cleaned: 0, skipped: 0 };
    }

    const containerIds = result.split('\n').filter(id => id.trim());
    let cleaned = 0;
    let skipped = 0;

    for (const containerId of containerIds) {
      try {
        // Get the specmem.created label for this container
        const createdLabel = execSync(
          `docker inspect --format '{{index .Config.Labels "specmem.created"}}' ${containerId} 2>/dev/null || true`,
          { encoding: 'utf-8' }
        ).trim();

        if (!createdLabel || createdLabel === '<no value>') {
          // Container doesn't have timestamp label, skip but warn
          startupLog(`cleanupOldDockerContainers: Container ${containerId} missing specmem.created label, skipping`);
          skipped++;
          continue;
        }

        const createdTime = parseInt(createdLabel, 10);
        if (isNaN(createdTime)) {
          startupLog(`cleanupOldDockerContainers: Container ${containerId} has invalid timestamp: ${createdLabel}`);
          skipped++;
          continue;
        }

        const ageSeconds = currentTime - createdTime;
        const ageHours = (ageSeconds / 3600).toFixed(1);

        if (ageSeconds > MAX_AGE_SECONDS) {
          // Container is older than 9 hours, kill it
          startupLog(`cleanupOldDockerContainers: Killing container ${containerId} (age: ${ageHours}h > ${MAX_AGE_HOURS}h)`);
          execSync(`docker rm -f ${containerId} 2>/dev/null || true`);
          cleaned++;
        } else {
          startupLog(`cleanupOldDockerContainers: Container ${containerId} is ${ageHours}h old, keeping`);
          skipped++;
        }
      } catch (inspectErr) {
        startupLog(`cleanupOldDockerContainers: Error inspecting container ${containerId}: ${inspectErr.message}`);
        skipped++;
      }
    }

    if (cleaned > 0) {
      log(`Cleaned ${cleaned} old Docker container(s) (>${MAX_AGE_HOURS}h)`, colors.yellow);
    }

    return { cleaned, skipped };
  } catch (err) {
    startupLog(`cleanupOldDockerContainers: Error during cleanup: ${err.message}`);
    return { cleaned: 0, skipped: 0, error: err.message };
  }
}

// Track embedding container failures for throttling
let lastEmbeddingFailureTime = 0;
let embeddingFailureCount = 0;

/**
 * Check embedding container status with detailed info
 * Returns: { running: bool, healthy: bool, status: string }
 */
function getEmbeddingContainerStatus() {
  try {
    const projectDirName = process.env.SPECMEM_PROJECT_DIR_NAME || PROJECT_HASH;
    const containerName = `specmem-embedding-${projectDirName}`;
    const result = execSync(`docker ps -a --filter name=${containerName} --format "{{.Status}}"`, { encoding: 'utf-8' }).trim();

    if (!result) return { running: false, healthy: false, status: 'not_found' };

    const running = result.includes('Up');
    const healthy = result.includes('healthy');
    const unhealthy = result.includes('unhealthy');

    return {
      running,
      healthy,
      unhealthy,
      status: healthy ? 'healthy' : (unhealthy ? 'unhealthy' : (running ? 'starting' : 'stopped'))
    };
  } catch {
    return { running: false, healthy: false, status: 'error' };
  }
}

/**
 * Check if embedding container is running and healthy
 * yo is our AI brain running??
 */
function isEmbeddingContainerRunning() {
  const status = getEmbeddingContainerStatus();
  return status.running && status.healthy;
}

/**
 * Auto-restart unhealthy embedding container
 * - If unhealthy: stop, remove, restart
 * - If last failure < 15s ago: apply 15% CPU limit (throttled restart)
 * - Marks failure but continues working
 */
async function restartUnhealthyEmbeddingContainer() {
  const status = getEmbeddingContainerStatus();

  if (!status.unhealthy) {
    return false; // Not unhealthy, nothing to do
  }

  const projectDirName = process.env.SPECMEM_PROJECT_DIR_NAME || PROJECT_HASH;
  const containerName = `specmem-embedding-${projectDirName}`;
  const now = Date.now();
  const timeSinceLastFailure = now - lastEmbeddingFailureTime;
  const rapidFailure = timeSinceLastFailure < 15000; // < 15 seconds

  // Track failure
  embeddingFailureCount++;
  lastEmbeddingFailureTime = now;

  logWarn(`Embedding container unhealthy! Failure #${embeddingFailureCount}`);
  startupLog(`[CONTAINER-RESTART] ${containerName} unhealthy at ${new Date().toISOString()}`);

  try {
    // Stop and remove unhealthy container
    logStep('RESTART', `Stopping unhealthy container: ${containerName}`);
    execSync(`docker stop ${containerName} 2>/dev/null || true`, { encoding: 'utf-8' });
    execSync(`docker rm ${containerName} 2>/dev/null || true`, { encoding: 'utf-8' });

    // Determine CPU limit based on failure frequency
    let cpuLimit = '1.0'; // Normal: full CPU
    if (rapidFailure) {
      cpuLimit = '0.15'; // Throttled: 15% CPU if failing rapidly
      logWarn(`Rapid failure detected (${Math.round(timeSinceLastFailure/1000)}s since last). Applying 15% CPU throttle.`);
    }

    // Set CPU limit in environment for start-sandbox.sh to use
    process.env.SPECMEM_EMBEDDING_CPU_LIMIT = cpuLimit;

    // Restart the container
    logStep('RESTART', `Restarting embedding container (CPU limit: ${cpuLimit})`);
    await startEmbeddingSandbox();

    logSuccess(`Embedding container restarted successfully`);
    return true;
  } catch (err) {
    logWarn(`Failed to restart embedding container: ${err.message}`);
    startupLog(`[CONTAINER-RESTART-FAILED] ${err.message}`);
    return false;
  }
}

/**
 * Start the embedding sandbox
 * yo lets start that AI container fr fr
 */
async function startEmbeddingSandbox() {
  logStep('EMBEDDING', 'Setting up air-gapped AI embedding sandbox...');

  // Check Docker first
  if (!isDockerReady()) {
    logWarn('Docker not available - embedding features will be disabled');
    logWarn('Install Docker to enable local AI embeddings');
    return false;
  }

  logSuccess('Docker is ready');

  // Check if already running
  if (isEmbeddingContainerRunning()) {
    logSuccess('Embedding container already running (healthy)');
    return true;
  }

  // Try to start the sandbox
  const sandboxScript = path.join(__dirname, 'embedding-sandbox', 'start-sandbox.sh');

  if (!fs.existsSync(sandboxScript)) {
    logWarn('Embedding sandbox script not found');
    logWarn('Embedding features will be disabled');
    return false;
  }

  logStep('EMBEDDING', 'Starting air-gapped embedding container...');

  return new Promise((resolve) => {
    const sandbox = spawn('bash', [sandboxScript], {
      cwd: path.join(__dirname, 'embedding-sandbox'),
      stdio: isMcpMode ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false
    });

    if (isMcpMode) {
      sandbox.stdout.pipe(process.stderr);
      sandbox.stderr.pipe(process.stderr);
    }

    sandbox.on('close', (code) => {
      if (code === 0) {
        logSuccess('Embedding sandbox started successfully');
        logSuccess('AI model: all-MiniLM-L6-v2 (384 dimensions)');
        logSuccess('Security: air-gapped, no network access');
        resolve(true);
      } else {
        logWarn('Embedding sandbox failed to start');
        logWarn('Embedding features will be disabled');
        resolve(false);
      }
    });

    sandbox.on('error', (err) => {
      logWarn(`Embedding sandbox error: ${err.message}`);
      resolve(false);
    });

    // Timeout after 2 minutes (model download can take a while)
    setTimeout(() => {
      logWarn('Embedding sandbox startup timed out');
      sandbox.kill();
      resolve(false);
    }, 120000);
  });
}

/**
 * Check and install system dependencies
 * yo lets check if we got postgres and pgvector
 */
async function checkSystemDeps() {
  logStep('SYSTEM', 'Checking system dependencies...');

  try {
    // dynamically import system deps checker (after TypeScript is built)
    const { checkSystemDeps, autoInstallSystemDeps, showManualInstallInstructions } =
      await import('./dist/installer/systemDeps.js');

    const depsCheck = await checkSystemDeps();

    if (!depsCheck.postgresInstalled) {
      logWarn('PostgreSQL not installed');

      if (depsCheck.canInstallPackages) {
        logStep('INSTALL', 'Attempting to install PostgreSQL...');
        const newCheck = await autoInstallSystemDeps();

        if (newCheck.postgresInstalled) {
          logSuccess('PostgreSQL installed successfully');
        } else {
          logWarn('Could not auto-install PostgreSQL');
          showManualInstallInstructions(newCheck);
          return false;
        }
      } else {
        logWarn('Cannot auto-install (no sudo access)');
        showManualInstallInstructions(depsCheck);
        return false;
      }
    } else {
      logSuccess(`PostgreSQL ${depsCheck.postgresVersion || 'installed'}`);
    }

    if (!depsCheck.pgvectorInstalled) {
      logWarn('pgvector extension not installed');

      if (depsCheck.canInstallPackages) {
        logStep('INSTALL', 'Attempting to install pgvector...');
        const newCheck = await autoInstallSystemDeps();

        if (newCheck.pgvectorInstalled) {
          logSuccess('pgvector installed successfully');
        } else {
          logWarn('Could not auto-install pgvector');
          logWarn('Some features may be limited without pgvector');
        }
      } else {
        logWarn('Cannot auto-install pgvector (no sudo access)');
        logWarn('Some features may be limited');
      }
    } else {
      logSuccess('pgvector extension installed');
    }

    return true;
  } catch (err) {
    logWarn(`System dependency check skipped: ${err.message}`);
    return true; // don't block on system check failures
  }
}

/**
 * Main auto-install orchestrator
 * this is where the magic happens fr fr
 */
async function autoInstallThisMf() {
  startupLog('autoInstallThisMf() CALLED - main function starting');

  // ============================================================================
  // ULTRA-FAST PATH CHECK - DO THIS FIRST!
  // CRITICAL: MCP transport MUST connect within ~5-10 seconds
  // If we're in MCP mode with everything already installed, start IMMEDIATELY
  // Skip all slow operations (config sync, instance checks, PostgreSQL, etc.)
  // ============================================================================
  const isFirstRun = isThisTheFirstRodeo();
  const depsInstalled = areDepsInstalled();
  const built = isBuilt();
  const canUltraFastStart = !isFirstRun && isMcpMode && depsInstalled && built;

  startupLog(`Ultra-fast start check: isFirstRun=${isFirstRun}, isMcpMode=${isMcpMode}, depsInstalled=${depsInstalled}, built=${built}, canUltraFastStart=${canUltraFastStart}`);

  if (canUltraFastStart) {
    startupLog('ULTRA-FAST START - deploying hooks, checking for stale dist/, allocating ports, ensuring schema, then spawning MCP server');

    // ALWAYS deploy hooks - even in ultra-fast mode
    // This ensures hooks stay up-to-date when package is upgraded
    runSilentAutoInstall();

    logPhase(1, 4, 'Checking for code changes...');

    // =========================================================================
    // CRITICAL: Check if TypeScript needs recompile BEFORE loading dist/
    // This ensures /mcp reconnect picks up code changes!
    // Without this, reconnect would load stale compiled JavaScript.
    // =========================================================================
    const recompiled = await recompileIfStale();
    if (recompiled) {
      startupLog('Ultra-fast path: TypeScript recompiled, continuing with fresh code');
      logSuccess('TypeScript recompiled');
    }

    // CRITICAL: Allocate project-specific ports BEFORE importing ES module
    // This ensures TypeScript code sees the correct port environment variables
    logPhase(2, 4, 'Allocating ports...');
    const projectPath = getProjectPath();
    try {
      const allocatedPorts = await allocateProjectPorts(projectPath);
      setAllocatedPortsEnv(allocatedPorts);
      startupLog(`Ultra-fast path: ports allocated and set as env vars`);
    } catch (err) {
      startupLog(`Ultra-fast path: port allocation failed, using defaults: ${err.message}`);
      // Continue with default ports from environment
    }

    // AUTO-SCHEMA INITIALIZATION - ensures tables exist BEFORE MCP server starts!
    // This is critical for Docker containers where schema may not exist yet
    logPhase(3, 4, 'Ensuring database schema...');
    try {
      await ensureSchemaInitialized();
      startupLog('Ultra-fast path: schema initialization complete');
    } catch (schemaErr) {
      startupLog(`Ultra-fast path: schema init failed (non-fatal): ${schemaErr.message}`);
      // Non-fatal - MCP server will retry
    }

    // Start server BEFORE any other operations
    // The server handles its own deferred initialization
    // CRITICAL: startServer() is now async and imports the ES module directly
    // This eliminates the ~400ms child process overhead
    logPhase(4, 4, 'Starting MCP server...');
    startSpinner('Initializing SpecMem...');
    const serverStartTime = Date.now();
    await startServer();
    const serverDuration = Date.now() - serverStartTime;
    stopSpinner(`MCP server ready (${serverDuration}ms)`, true);
    startupLog('startServer() returned - MCP server running in-process');
    // Process stays alive because the MCP server is running
    return;
  }

  // ============================================================================
  // NORMAL PATH - First run or interactive mode
  // These slower operations only run when not in ultra-fast MCP mode
  // ============================================================================

  startupLog('Normal startup path (not ultra-fast)');
  logPhase(1, 5, 'Registering SpecMem in  Code...');

  // Silent auto-install ensures SpecMem is registered in  Code's config
  startupLog('Running silent auto-install...');
  runSilentAutoInstall();
  startupLog('Silent auto-install complete');
  logSuccess(' Code registration complete');

  logPhase(2, 5, 'Detecting project environment...');
  const projectPath = getProjectPath();
  const projectHash = hashProjectPath(projectPath);

  // Log project info for debugging
  logStep('PROJECT', `Path: ${projectPath}`);
  logStep('PROJECT', `Hash: ${projectHash}`);

  // ============================================================================
  // STARTUP SEQUENCE LOCK (PHASE 1)
  // Acquire atomic startup lock BEFORE checking for running instances
  // This prevents the TOCTOU race condition where multiple processes
  // simultaneously check "is instance running?" and all get "no"
  // ============================================================================

  logPhase(3, 5, 'Acquiring startup lock...');
  const startupLock = await acquireStartupLock(projectPath);

  if (!startupLock.acquired) {
    // Could not acquire startup lock - another instance is starting
    logWarn('Could not acquire startup lock - another instance is starting');

    if (isMcpMode) {
      // In MCP mode, wait and check if the other instance is now running
      logStep('WAITING', 'Waiting for other instance to complete startup...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      const runningCheck = await isProjectInstanceRunning(projectPath, { retries: 5, retryDelayMs: 200 });
      if (runningCheck.running) {
        logSuccess(`Another instance is now running (PID: ${runningCheck.pid || 'via socket'})`);
        logWarn('Exiting to avoid duplicate instances');
        process.exit(0);
      }

      // Other instance may have failed - we could try again, but for safety exit
      logError('Startup lock contention - other instance may have failed');
      process.exit(1);
    }

    logError('Failed to acquire startup lock');
    return;
  }

  startupLog('Startup lock acquired');
  logSuccess('Startup sequence lock acquired');

  // ============================================================================
  // PROJECT-LOCAL INSTANCE DETECTION (PHASE 2)
  // Now we hold the startup lock, so we're the only one checking
  // ============================================================================

  // First, clean up any stale lock files
  const cleanupResult = cleanupStaleLocks(projectPath);
  if (cleanupResult.cleaned) {
    startupLog(`Cleaned stale locks: ${JSON.stringify(cleanupResult)}`);
  }

  // Check if an instance is already running for this project
  // Use more retries since we hold the startup lock
  const existingInstance = await isProjectInstanceRunning(projectPath, { retries: 3, retryDelayMs: 100 });
  if (existingInstance.running) {
    // Release startup lock since we're not starting
    startupLock.cleanup();

    if (existingInstance.pid) {
      logSuccess(`SpecMem already running for this project (PID: ${existingInstance.pid})`);
    } else {
      logSuccess(`SpecMem already running for this project (detected via socket)`);
    }

    // In MCP mode, we need to connect to the existing instance
    // For now, we exit - future enhancement could proxy to existing instance
    if (isMcpMode) {
      logWarn('Another SpecMem instance is handling this project');
      logWarn('Exiting to avoid duplicate instances');
      process.exit(0);
    }

    return;
  }

  // ============================================================================
  // ACQUIRE PROJECT SOCKET LOCK (PHASE 3)
  // Now acquire the persistent socket lock for IPC
  // ============================================================================

  logStep('LOCK', 'Acquiring project socket lock...');
  const lockAcquired = tryAcquireSocketLock(projectPath);

  if (!lockAcquired) {
    // Release startup lock
    startupLock.cleanup();

    logWarn('Could not acquire socket lock - another instance may have started');
    if (isMcpMode) {
      // Wait a moment and check again - the other instance might finish starting
      await new Promise(resolve => setTimeout(resolve, 2000));
      const recheckInstance = await isProjectInstanceRunning(projectPath);
      if (recheckInstance.running) {
        logSuccess('Another instance is now running, exiting...');
        process.exit(0);
      }
    }
    logError('Failed to acquire project lock');
    process.exit(1);
  }
  logSuccess('Project socket lock acquired');

  // Write PID file immediately after acquiring lock
  writeProjectPidFile(projectPath, process.pid);
  logSuccess(`PID file written (${process.pid})`);

  // Write initial instance state
  writeInstanceState(projectPath, {
    pid: process.pid,
    projectPath: projectPath,
    projectHash: projectHash,
    startTime: new Date().toISOString(),
    status: 'starting',
    bootstrapVersion: '1.0.0'
  });

  // Release startup lock now that we have the socket lock
  // (socket lock is the persistent lock, startup lock was just for the race window)
  startupLock.cleanup();
  startupLog('Startup lock released, socket lock held');

  // ============================================================================
  // GRACEFUL SHUTDOWN HANDLERS
  // Clean up lock files and notify when  Code exits
  // ============================================================================

  // Orphan check interval (set up after gracefulShutdown is defined)
  let orphanCheckInterval = null;
  // Log rotation interval (set up after gracefulShutdown is defined)
  let logRotationInterval = null;

  const gracefulShutdown = async (signal) => {
    log(`\n[SHUTDOWN] Received ${signal}, cleaning up...`, colors.yellow);

    // Clear orphan check interval if running
    if (orphanCheckInterval) {
      clearInterval(orphanCheckInterval);
      orphanCheckInterval = null;
    }

    // Clear log truncation interval if running
    if (logRotationInterval) {
      clearInterval(logRotationInterval);
      logRotationInterval = null;
    }

    // Stop embedded PostgreSQL if running
    if (embeddedPgPort) {
      try {
        await stopEmbeddedPostgres(projectPath);
      } catch (err) {
        logWarn(`Error stopping PostgreSQL: ${err.message}`);
      }
    }

    // Update instance state
    writeInstanceState(projectPath, {
      pid: process.pid,
      projectPath: projectPath,
      projectHash: projectHash,
      startTime: new Date().toISOString(),
      status: 'stopped',
      stopReason: signal
    });

    // Release locks
    releaseSocketLock(projectPath);
    removeProjectPidFile(projectPath);

    log('[SHUTDOWN] Cleanup complete, exiting...', colors.green);
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  // NOTE: SIGHUP is NOT handled here - it propagates to specMemServer.ts for Tier 1 hot reload
  // Tier 1 = reload tools/skills only (no process restart, no TypeScript recompile)
  // See specMemServer.ts line 568 for the SIGHUP handler

  // ============================================================================
  // ORPHAN DETECTION (PPID=1 CHECK)
  // Detect when parent process dies and we're adopted by init (PID 1)
  // This happens when  Code crashes without sending SIGTERM
  // ============================================================================
  orphanCheckInterval = setInterval(() => {
    // On Linux/macOS, when parent dies, process is reparented to init (PID 1)
    // This means we're orphaned and should clean up
    if (process.ppid === 1) {
      log('[ORPHAN] Parent process died (PPID=1), initiating graceful shutdown...', colors.yellow);
      startupLog('Orphan detected - PPID is 1 (init process), triggering shutdown');
      clearInterval(orphanCheckInterval);
      orphanCheckInterval = null;
      gracefulShutdown('ORPHANED');
    }
  }, 60000); // Check every 60 seconds

  // ============================================================================
  // SCREEN LOG TRUNCATION - Prevent unbounded log growth causing I/O lag
  // Checks both tmpfs (/dev/shm) and local paths
  // AGGRESSIVE: 4s interval, async, 50 lines max - minimal I/O footprint
  // ============================================================================
  const LOG_TRUNCATE_INTERVAL = 4000; // 4 seconds - very aggressive
  const MAX_LOG_SIZE_KB = 5; // Truncate if file exceeds 5KB
  const MAX_LOG_LINES = 50; // Keep ONLY last 50 lines - minimal footprint

  // Track if truncation is in progress to avoid overlapping operations
  let truncationInProgress = false;

  // Get screen log path - check both tmpfs and local
  const getScreenLogPaths = () => {
    const tmpfsDir = path.join('/dev/shm/specmem', projectHash);
    const tmpfsLog = path.join(tmpfsDir, 'claude-screen.log');
    const localLog = path.join(projectPath, 'specmem', 'sockets', 'claude-screen.log');
    return [tmpfsLog, localLog];
  };

  const truncateScreenLog = () => {
    // Skip if already truncating (async overlap prevention)
    if (truncationInProgress) return;

    const logPaths = getScreenLogPaths();
    for (const screenLogPath of logPaths) {
      try {
        if (!fs.existsSync(screenLogPath)) continue;

        const stats = fs.statSync(screenLogPath);
        const fileSizeKB = stats.size / 1024;

        if (fileSizeKB > MAX_LOG_SIZE_KB) {
          truncationInProgress = true;
          const tmpPath = `${screenLogPath}.tmp`;
          // Fully async - no blocking
          const { exec } = require('child_process');
          exec(`tail -n ${MAX_LOG_LINES} "${screenLogPath}" > "${tmpPath}" && mv "${tmpPath}" "${screenLogPath}"; rm -f "${tmpPath}"`, {
            timeout: 3000 // 3s timeout - fail fast
          }, (err) => {
            truncationInProgress = false;
            // Always try to clean up tmp file
            try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
          });
          return; // Only truncate one at a time
        }
      } catch (e) { /* ignore */ }
    }
    truncationInProgress = false;
  };

  // Initial truncation and start interval
  truncateScreenLog();
  logRotationInterval = setInterval(truncateScreenLog, LOG_TRUNCATE_INTERVAL);

  // ============================================================================
  // HOT RELOAD HANDLER (SIGUSR1)
  // Tier 2 reload: Graceful restart - cleanup and exit(0) so  respawns
  // This allows code changes to take effect without manual intervention
  // ============================================================================
  process.on('SIGUSR1', async () => {
    log('\n[HOT RELOAD] SIGUSR1 received in bootstrap - triggering graceful restart', colors.cyan);
    startupLog('SIGUSR1 received - initiating hot reload graceful restart');

    try {
      // Stop embedded PostgreSQL if running (will restart on respawn)
      if (embeddedPgPort) {
        log('[HOT RELOAD] Stopping embedded PostgreSQL...', colors.yellow);
        try {
          await stopEmbeddedPostgres(projectPath);
        } catch (err) {
          logWarn(`[HOT RELOAD] Error stopping PostgreSQL: ${err.message}`);
        }
      }

      // Update instance state to indicate hot reload
      writeInstanceState(projectPath, {
        pid: process.pid,
        projectPath: projectPath,
        projectHash: projectHash,
        startTime: new Date().toISOString(),
        status: 'reloading',
        stopReason: 'SIGUSR1_HOT_RELOAD'
      });

      // Release locks so the respawned process can acquire them
      releaseSocketLock(projectPath);
      removeProjectPidFile(projectPath);

      log('[HOT RELOAD] Cleanup complete, exiting for respawn...', colors.green);
      startupLog('Hot reload cleanup complete, exiting with code 0 for respawn');

      // Exit with 0 -  will respawn us with fresh code
      process.exit(0);
    } catch (err) {
      logError(`[HOT RELOAD] Error during hot reload: ${err.message}`);
      startupLog('Hot reload error', err);
      // Still try to exit cleanly
      process.exit(0);
    }
  });

  // Handle uncaught exceptions - try to clean up
  process.on('uncaughtException', async (error) => {
    logError(`Uncaught exception: ${error.message}`);
    console.error(error);

    // Stop embedded PostgreSQL if running
    if (embeddedPgPort) {
      try {
        await stopEmbeddedPostgres(projectPath);
      } catch (pgErr) {
        logWarn(`Error stopping PostgreSQL during crash: ${pgErr.message}`);
      }
    }

    // Update instance state
    writeInstanceState(projectPath, {
      pid: process.pid,
      projectPath: projectPath,
      projectHash: projectHash,
      startTime: new Date().toISOString(),
      status: 'crashed',
      crashReason: error.message
    });

    // Try to clean up
    releaseSocketLock(projectPath);
    removeProjectPidFile(projectPath);

    process.exit(1);
  });

  // NOTE: Ultra-fast quick-start is handled at the top of autoInstallThisMf()
  // If we reach here, we're in the normal first-run or interactive path

  log('\n' + '='.repeat(60), colors.bright);
  log('SpecMem Auto-Installer', colors.cyan);
  log('Making this MCP just WORK with zero manual setup fr fr', colors.cyan);
  log('='.repeat(60) + '\n', colors.bright);

  if (isFirstRun) {
    logStep('FIRST RUN', 'First run detected, running full setup...');
  }

  try {
    logPhase(4, 5, 'Checking dependencies and build...');

    // Step 1: Check and install dependencies
    if (!areDepsInstalled()) {
      logWarn('Dependencies not installed');
      startSpinner('Installing npm packages...');
      await yeetDependenciesIn();
      stopSpinner('Dependencies installed', true);
    } else {
      logSuccess('Dependencies already installed');
    }

    // Step 2: Check and build TypeScript
    if (!isBuilt()) {
      logWarn('TypeScript not built');
      startSpinner('Compiling TypeScript...');
      await buildTheCode();
      stopSpinner('TypeScript compiled', true);
    } else {
      logSuccess('TypeScript already built');
    }

    // Step 2.5: Auto-cleanup orphaned Docker containers
    try {
      logStep('CLEANUP', 'Checking for orphaned Docker containers...');
      const { execSync } = require('child_process');
      const orphanedContainers = execSync(
        'docker ps -a --filter "name=specmem-embedding" --filter "status=exited" -q 2>/dev/null || true',
        { encoding: 'utf-8' }
      ).trim();

      if (orphanedContainers) {
        logWarn('Found orphaned specmem-embedding container, removing...');
        execSync('docker rm -f specmem-embedding 2>/dev/null || true');
        logSuccess('Orphaned container removed');
      } else {
        logSuccess('No orphaned containers found');
      }
    } catch (err) {
      logWarn(`Container cleanup skipped: ${err.message}`);
    }

    // Step 2.6: Auto-cleanup OLD running Docker containers (> 9 hours)
    // This catches zombie containers that have been running too long
    try {
      const ageCleanupResult = cleanupOldDockerContainers();
      if (ageCleanupResult.cleaned > 0) {
        logSuccess(`Cleaned ${ageCleanupResult.cleaned} old container(s) (>9h)`);
      }
    } catch (err) {
      logWarn(`Old container cleanup skipped: ${err.message}`);
    }

    // Step 3: Check system dependencies (PostgreSQL, pgvector)
    if (isFirstRun) {
      await checkSystemDeps();
    }

    // Step 3.5: Try to initialize embedded PostgreSQL first
    let embeddedPgConfig = null;
    try {
      embeddedPgConfig = await initializeEmbeddedPostgres(projectPath);
      if (embeddedPgConfig) {
        logSuccess('Embedded PostgreSQL initialized successfully');
        // Run migrations on embedded PostgreSQL
        await runMigrations();
      }
    } catch (err) {
      logWarn(`Embedded PostgreSQL initialization failed: ${err.message}`);
      logWarn('Falling back to external database configuration...');
    }

    // Step 4: Check database connection (if embedded PG not available)
    if (!embeddedPgConfig) {
      const dbCheck = await testPostgresConnection();

      if (!dbCheck.connected) {
        if (isFirstRun && (dbCheck.reason === 'no_password' || dbCheck.reason === 'connection_failed')) {
          // attempt automatic database setup
          const setupSuccess = await autoSetupDatabase();

          if (setupSuccess) {
            // test connection again
            const retestCheck = await testPostgresConnection();
            if (retestCheck.connected) {
              logSuccess('Database connection verified after auto-setup');
              // run migrations
              await runMigrations();
            } else {
              logWarn('Database setup completed but connection test failed');
              showDatabaseInstructions();
            }
          } else {
            logWarn('Automatic database setup failed');
            showDatabaseInstructions();
            logWarn('Starting without database - some features will be limited');
          }
        } else {
          showDatabaseInstructions();
          logWarn('Starting without database - some features will be limited');
        }
      } else {
        logSuccess('Database connection successful');
        // run migrations
        await runMigrations();
      }
    }

    // Step 5: Start embedding AI sandbox (Docker container)
    await startEmbeddingSandbox();

    // Step 6: Enable MCP for Task-spawned teamMembers (the secret sauce)
    const mcpHackResult = enableMcpForTaskTeamMembers();

    // Step 6.5: Install SpecMem hooks for auto context injection
    const hooksResult = installSpecMemHooks();

    // Step 6.6: Install SpecMem slash commands
    const commandsResult = installSpecMemCommands();

    // Step 6.7: Setup runtime directory for sockets
    const runtimeResult = setupRuntimeDirectory();

    // Step 6.8: Auto-configure MCP server in  config
    const mcpConfigResult = configureMcpServer();

    // Step 6.8.5: Auto-deploy hooks from specmem to 
    try {
      const deployScript = path.join(__dirname, 'scripts', 'deploy-hooks.cjs');
      if (fs.existsSync(deployScript)) {
        const { execSync } = require('child_process');
        execSync(`node "${deployScript}"`, { stdio: 'pipe', timeout: 10000 });
        logSuccess('Hooks auto-deployed to ');
      }
    } catch (e) {
      logWarn(`Hook deploy skipped: ${e.message}`);
    }

    // Step 6.9: Run final config sync to ensure both files are consistent
    // This catches any edge cases where one file was updated but not the other
    const finalSyncResult = runConfigAutoSync();
    if (finalSyncResult.mismatches.length > 0) {
      log(`[CONFIG-SYNC] Final sync fixed ${finalSyncResult.mismatches.length} mismatch(es)`, colors.green);
    }

    // Step 7: Mark as installed
    if (isFirstRun) {
      markAsInstalled();
      logSuccess('First-time setup complete!');
    }

    // Step 7.5: Allocate project-specific ports BEFORE starting server
    // CRITICAL: This ensures TypeScript code sees the correct port environment variables
    let allocatedPorts = null;
    try {
      allocatedPorts = await allocateProjectPorts(projectPath);
      setAllocatedPortsEnv(allocatedPorts);
      logSuccess(`Allocated ports: dashboard=${allocatedPorts.dashboard}, coordination=${allocatedPorts.coordination}`);
    } catch (err) {
      logWarn(`Port allocation failed, using defaults: ${err.message}`);
    }

    // Step 8: Update instance state to running (use allocated ports)
    writeInstanceState(projectPath, {
      pid: process.pid,
      projectPath: projectPath,
      projectHash: projectHash,
      startTime: new Date().toISOString(),
      status: 'running',
      dashboardPort: allocatedPorts?.dashboard || process.env.SPECMEM_DASHBOARD_PORT || PORT_CONFIG.DEFAULTS.DASHBOARD,
      coordinationPort: allocatedPorts?.coordination || process.env.SPECMEM_COORDINATION_PORT || PORT_CONFIG.DEFAULTS.COORDINATION,
      postgresPort: allocatedPorts?.postgres || embeddedPgPort || null,
      embeddedPostgres: !!embeddedPgConfig
    });

    // Step 9: Start the server
    log('\n' + '='.repeat(60), colors.bright);
    logSuccess('SpecMem ready to go! fr fr no cap');
    log(`Project: ${projectPath}`, colors.cyan);
    log(`Instance: ${projectHash}`, colors.cyan);
    if (allocatedPorts) {
      log(`Dashboard: http://localhost:${allocatedPorts.dashboard}`, colors.green);
      log(`Coordination: port ${allocatedPorts.coordination}`, colors.green);
    }
    if (embeddedPgConfig) {
      log(`Embedded PostgreSQL: port ${allocatedPorts?.postgres || embeddedPgPort}`, colors.green);
    }
    if (mcpHackResult?.needsRestart || hooksResult?.needsRestart) {
      log('', colors.yellow);
      log('NOTE: Task teamMembers now have MCP access!', colors.green);
      if (hooksResult?.installed) {
        log('SpecMem context hooks installed - memories auto-inject into prompts!', colors.green);
      }
      if (commandsResult?.installed) {
        log(`SpecMem commands installed: /${commandsResult.commands?.join(', /')}`, colors.green);
      }
      if (runtimeResult?.success) {
        log(`Runtime directory: ${runtimeResult.path}`, colors.green);
      }
      log('Restart  Code to apply changes.', colors.yellow);
    }
    log('='.repeat(60) + '\n', colors.bright);

    logPhase(5, 5, 'Starting MCP server...');
    startSpinner('Initializing SpecMem...');
    const serverStartTime = Date.now();
    startupLog('Full setup complete, calling startServer()');
    await startServer();
    const serverDuration = Date.now() - serverStartTime;
    stopSpinner(`MCP server ready (${serverDuration}ms)`, true);
    startupLog('startServer() returned after full setup - MCP server running in-process');

  } catch (error) {
    startupLog('FATAL ERROR in autoInstallThisMf()', error);
    logError(`Installation failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// yooo lets goooo
startupLog('Calling autoInstallThisMf() - entering main async function');
autoInstallThisMf().catch((error) => {
  startupLog('UNHANDLED REJECTION in autoInstallThisMf()', error);
  logError(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
