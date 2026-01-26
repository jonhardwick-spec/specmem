#!/usr/bin/env node
/**
 * SPECMEM GLOBAL POSTINSTALL - FULL AUTO-INSTALL
 * ===============================================
 *
 * Runs after `npm install -g specmem-hardwicksoftware`
 * Auto-installs and configures EVERYTHING:
 *   1. PostgreSQL (if missing)
 *   2. pgvector extension
 *   3. SpecMem database and user
 *   4.  hooks
 *   5. Docker (embedding service)
 *   6. All directories and configs
 *
 * @author hardwicksoftwareservices
 * @website https://justcalljon.pro
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

// ============================================================================
// GLOBAL INSTALL CHECK - Must be installed globally!
// ============================================================================
const isGlobalInstall = process.env.npm_config_global === 'true' ||
                        __dirname.includes('/lib/node_modules/') ||
                        __dirname.includes('\\node_modules\\npm\\') ||
                        process.env.npm_lifecycle_event === 'postinstall' &&
                        !__dirname.includes(process.cwd());

// ============================================================================
// UNINSTALL OLD VERSIONS FIRST
// ============================================================================
try {
  const oldVersionCheck = require('child_process').execSync('npm list -g specmem-hardwicksoftware --depth=0 2>/dev/null || true', { encoding: 'utf8' });
  if (oldVersionCheck.includes('specmem-hardwicksoftware@') && !oldVersionCheck.includes(require('../package.json').version)) {
    console.log('\x1b[33m⚠ Removing old version before installing new one...\x1b[0m');
    require('child_process').execSync('npm uninstall -g specmem-hardwicksoftware 2>/dev/null || true', { stdio: 'pipe' });
  }
} catch (e) { /* ignore */ }

// ============================================================================
// PLATFORM CHECK - Linux only for now
// ============================================================================
const currentPlatform = require('os').platform();
if (currentPlatform === 'win32') {
  console.log('\n\x1b[31m╔════════════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[31m║\x1b[0m  \x1b[1m\x1b[31m⚠ SPECMEM IS LINUX-ONLY (for now)\x1b[0m                         \x1b[31m║\x1b[0m');
  console.log('\x1b[31m╠════════════════════════════════════════════════════════════╣\x1b[0m');
  console.log('\x1b[31m║\x1b[0m                                                            \x1b[31m║\x1b[0m');
  console.log('\x1b[31m║\x1b[0m  Windows support coming soon!                              \x1b[31m║\x1b[0m');
  console.log('\x1b[31m║\x1b[0m                                                            \x1b[31m║\x1b[0m');
  console.log('\x1b[31m║\x1b[0m  Options:                                                  \x1b[31m║\x1b[0m');
  console.log('\x1b[31m║\x1b[0m    • Use WSL2 (Windows Subsystem for Linux)               \x1b[31m║\x1b[0m');
  console.log('\x1b[31m║\x1b[0m    • Use a Linux VM or Docker container                   \x1b[31m║\x1b[0m');
  console.log('\x1b[31m║\x1b[0m    • Use a Linux VPS                                       \x1b[31m║\x1b[0m');
  console.log('\x1b[31m║\x1b[0m                                                            \x1b[31m║\x1b[0m');
  console.log('\x1b[31m╚════════════════════════════════════════════════════════════╝\x1b[0m\n');
  process.exit(0);
}

if (currentPlatform === 'darwin') {
  console.log('\n\x1b[33m╔════════════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[33m║\x1b[0m  \x1b[1m\x1b[33m⚠ MACOS SUPPORT IS EXPERIMENTAL\x1b[0m                           \x1b[33m║\x1b[0m');
  console.log('\x1b[33m╠════════════════════════════════════════════════════════════╣\x1b[0m');
  console.log('\x1b[33m║\x1b[0m                                                            \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m  SpecMem is primarily developed for Linux.                \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m  Some features may not work correctly on macOS.           \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m                                                            \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m  Proceeding with installation...                          \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m                                                            \x1b[33m║\x1b[0m');
  console.log('\x1b[33m╚════════════════════════════════════════════════════════════╝\x1b[0m\n');
  // Continue with install but warn
}

if (!isGlobalInstall) {
  console.log('\n\x1b[33m╔════════════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[33m║\x1b[0m  \x1b[1m\x1b[31m⚠ SPECMEM MUST BE INSTALLED GLOBALLY\x1b[0m                      \x1b[33m║\x1b[0m');
  console.log('\x1b[33m╠════════════════════════════════════════════════════════════╣\x1b[0m');
  console.log('\x1b[33m║\x1b[0m                                                            \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m  You ran:  npm install specmem-hardwicksoftware           \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m                                                            \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m  \x1b[1m\x1b[32mCorrect command:\x1b[0m                                         \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m  \x1b[1m\x1b[36m  npm install -g specmem-hardwicksoftware\x1b[0m                 \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m                                                            \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m  SpecMem is a CLI tool that integrates with Claude Code.  \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m  It must be installed globally to work properly.          \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m                                                            \x1b[33m║\x1b[0m');
  console.log('\x1b[33m╚════════════════════════════════════════════════════════════╝\x1b[0m\n');
  process.exit(0); // Exit cleanly so npm doesn't show error
}

// Colors for terminal output
const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

const log = {
  info: (msg) => console.log(`${c.blue}ℹ${c.reset} ${msg}`),
  success: (msg) => console.log(`${c.green}✓${c.reset} ${msg}`),
  warn: (msg) => console.log(`${c.yellow}⚠${c.reset} ${msg}`),
  error: (msg) => console.log(`${c.red}✗${c.reset} ${msg}`),
  header: (msg) => console.log(`\n${c.bright}${c.cyan}═══ ${msg} ═══${c.reset}\n`),
  step: (num, msg) => console.log(`${c.cyan}[${num}]${c.reset} ${msg}`)
};

// Paths
const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const CLAUDE_HOOKS_DIR = path.join(CLAUDE_DIR, 'hooks');
const CLAUDE_SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const SPECMEM_GLOBAL_DIR = path.join(HOME, '.specmem');
const SPECMEM_PKG_DIR = path.dirname(__dirname);

// Database config
const DB_CONFIG = {
  name: 'specmem_westayunprofessional',
  user: 'specmem_westayunprofessional',
  password: 'specmem_westayunprofessional',
  host: 'localhost',
  port: 5432
};

// Detect OS
const PLATFORM = os.platform();
const IS_MAC = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';
const IS_WINDOWS = PLATFORM === 'win32';

// Detect if running inside Docker container
const IS_DOCKER = fs.existsSync('/.dockerenv') ||
                  (fs.existsSync('/proc/1/cgroup') &&
                   fs.readFileSync('/proc/1/cgroup', 'utf8').includes('docker'));

// Skip embeddings flag (for low-resource or containerized environments)
const SKIP_EMBEDDINGS = process.env.SPECMEM_SKIP_EMBEDDINGS === 'true' ||
                        process.env.SPECMEM_LITE === 'true';

/**
 * Run a command and return success/output
 */
function run(cmd, options = {}) {
  try {
    const result = execSync(cmd, {
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
      timeout: options.timeout || 120000,
      ...options
    });
    return { success: true, output: result };
  } catch (e) {
    return { success: false, output: e.message, error: e };
  }
}

/**
 * Check if a command exists
 */
function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a directory exists
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log.success(`Created: ${dir}`);
  }
}

// ============================================================================
// CLAUDE CODE INSTALLATION
// ============================================================================

// ============================================================================
// CORE SYSTEM DEPENDENCIES - Install EVERYTHING if missing
// ============================================================================

/**
 * Install ALL core system dependencies before anything else
 */
function installCoreDeps() {
  log.header('Installing Core System Dependencies');

  const packages = [];

  // Check what's missing
  if (!commandExists('python3')) packages.push('python3');
  if (!commandExists('pip3') && !commandExists('pip')) packages.push('python3-pip');
  if (!commandExists('screen')) packages.push('screen');
  if (!commandExists('curl')) packages.push('curl');
  if (!commandExists('git')) packages.push('git');
  if (!commandExists('sudo')) packages.push('sudo');

  if (packages.length === 0) {
    log.success('All core dependencies already installed');
    return true;
  }

  log.info(`Missing packages: ${packages.join(', ')}`);
  log.info('Installing via package manager...');

  if (IS_LINUX) {
    if (commandExists('apt-get')) {
      // Debian/Ubuntu/Mint
      const result = run(`apt-get update -qq && apt-get install -y ${packages.join(' ')} python3-venv build-essential`, { timeout: 300000 });
      if (!result.success) {
        // Try with sudo
        run(`sudo apt-get update -qq && sudo apt-get install -y ${packages.join(' ')} python3-venv build-essential`, { timeout: 300000 });
      }
    } else if (commandExists('dnf')) {
      run(`sudo dnf install -y ${packages.join(' ').replace('python3-pip', 'python3-pip python3-devel')} gcc make`, { timeout: 300000 });
    } else if (commandExists('yum')) {
      run(`sudo yum install -y ${packages.join(' ').replace('python3-pip', 'python3-pip python3-devel')} gcc make`, { timeout: 300000 });
    } else if (commandExists('pacman')) {
      run(`sudo pacman -Sy --noconfirm ${packages.join(' ').replace('python3-pip', 'python-pip')}`, { timeout: 300000 });
    }
  } else if (IS_MAC) {
    if (commandExists('brew')) {
      run(`brew install ${packages.join(' ').replace('python3-pip', 'python3')}`, { timeout: 300000 });
    } else {
      log.warn('Homebrew not found - install from https://brew.sh');
    }
  }

  // Verify critical ones
  const missing = [];
  if (!commandExists('python3')) missing.push('python3');
  if (!commandExists('pip3') && !commandExists('pip')) missing.push('pip');
  if (!commandExists('screen')) missing.push('screen');

  if (missing.length > 0) {
    log.warn(`Still missing: ${missing.join(', ')}`);
    log.info('Some features may not work without these dependencies');
  } else {
    log.success('All core dependencies installed');
  }

  return true;
}

/**
 * Check if Claude Code is installed, install if missing
 */
function ensureClaudeCode() {
  log.header('Checking Claude Code');

  // Check if claude command exists
  if (commandExists('claude')) {
    const version = run('claude --version', { silent: true });
    log.success(`Claude Code found: ${version.output?.trim() || 'installed'}`);
    return true;
  }

  log.warn('Claude Code not found - installing...');
  log.info('Installing @anthropic-ai/claude-code globally...');

  const result = run('npm install -g @anthropic-ai/claude-code', { timeout: 300000 });

  if (result.success) {
    log.success('Claude Code installed successfully');
    log.info('You will need to run "claude" and authenticate with Anthropic');
    return true;
  } else {
    log.error('Failed to install Claude Code');
    log.info('Install manually: npm install -g @anthropic-ai/claude-code');
    return false;
  }
}

/**
 * Check if screen is installed, install if missing (needed for team members)
 */
function ensureScreen() {
  log.header('Checking screen');

  if (commandExists('screen')) {
    log.success('screen found');
    return true;
  }

  log.warn('screen not found - installing...');

  let result;
  if (IS_MAC) {
    result = run('brew install screen', { timeout: 120000 });
  } else if (IS_LINUX) {
    // Try apt first, then yum/dnf
    result = run('apt-get update -qq && apt-get install -y screen', { timeout: 120000 });
    if (!result.success) {
      result = run('yum install -y screen || dnf install -y screen', { timeout: 120000 });
    }
  }

  if (result?.success) {
    log.success('screen installed successfully');
    return true;
  } else {
    log.warn('Could not auto-install screen');
    log.info('Install manually: apt install screen (Debian/Ubuntu) or brew install screen (Mac)');
    return false;
  }
}

// ============================================================================
// POSTGRESQL INSTALLATION
// ============================================================================

/**
 * Check if PostgreSQL is installed and running
 */
function checkPostgres() {
  log.header('Checking PostgreSQL');

  // Check if psql exists
  if (!commandExists('psql')) {
    log.warn('PostgreSQL not found - will install');
    return false;
  }

  // Check if server is running
  const result = run('pg_isready', { silent: true });
  if (result.success) {
    log.success('PostgreSQL is installed and running');
    return true;
  }

  log.warn('PostgreSQL installed but not running');
  return 'installed_not_running';
}

/**
 * Install PostgreSQL based on OS
 */
function installPostgres() {
  log.header('Installing PostgreSQL');

  const PG_TIMEOUT = 180000; // 3 minute timeout for PG install

  if (IS_MAC) {
    log.step(1, 'Installing via Homebrew...');

    // Check if Homebrew exists
    if (!commandExists('brew')) {
      log.info('Installing Homebrew first...');
      run('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', { timeout: 300000 });
    }

    run('brew install postgresql@16', { timeout: PG_TIMEOUT });
    run('brew services start postgresql@16', { timeout: 30000 });

    // Add to PATH
    try {
      const brewPrefix = execSync('brew --prefix', { encoding: 'utf8', timeout: 10000 }).trim();
      const pgPath = `${brewPrefix}/opt/postgresql@16/bin`;
      log.info(`Add to PATH: export PATH="${pgPath}:$PATH"`);
    } catch (e) {}

  } else if (IS_LINUX) {
    log.step(1, 'Detecting Linux distribution...');

    // Check for apt (Debian/Ubuntu)
    if (commandExists('apt-get')) {
      log.step(2, 'Installing via apt (timeout: 3 min)...');
      run('sudo apt-get update', { timeout: 60000 });
      const result = run('sudo apt-get install -y postgresql postgresql-contrib', { timeout: PG_TIMEOUT });
      if (!result.success) {
        log.warn('PostgreSQL install timed out or failed');
        log.info('Try manually: sudo apt-get install -y postgresql postgresql-contrib');
        return false;
      }
      run('sudo systemctl start postgresql', { timeout: 30000 });
      run('sudo systemctl enable postgresql', { timeout: 30000 });
    }
    // Check for yum/dnf (RHEL/CentOS/Fedora)
    else if (commandExists('dnf')) {
      log.step(2, 'Installing via dnf (timeout: 3 min)...');
      const result = run('sudo dnf install -y postgresql-server postgresql-contrib', { timeout: PG_TIMEOUT });
      if (!result.success) {
        log.warn('PostgreSQL install timed out');
        return false;
      }
      run('sudo postgresql-setup --initdb', { timeout: 60000 });
      run('sudo systemctl start postgresql', { timeout: 30000 });
      run('sudo systemctl enable postgresql', { timeout: 30000 });
    }
    else if (commandExists('yum')) {
      log.step(2, 'Installing via yum (timeout: 3 min)...');
      const result = run('sudo yum install -y postgresql-server postgresql-contrib', { timeout: PG_TIMEOUT });
      if (!result.success) {
        log.warn('PostgreSQL install timed out');
        return false;
      }
      run('sudo postgresql-setup initdb', { timeout: 60000 });
      run('sudo systemctl start postgresql', { timeout: 30000 });
      run('sudo systemctl enable postgresql', { timeout: 30000 });
    }
    // Check for pacman (Arch)
    else if (commandExists('pacman')) {
      log.step(2, 'Installing via pacman (timeout: 3 min)...');
      const result = run('sudo pacman -S --noconfirm postgresql', { timeout: PG_TIMEOUT });
      if (!result.success) {
        log.warn('PostgreSQL install timed out');
        return false;
      }
      run('sudo -u postgres initdb -D /var/lib/postgres/data', { timeout: 60000 });
      run('sudo systemctl start postgresql', { timeout: 30000 });
      run('sudo systemctl enable postgresql', { timeout: 30000 });
    }
    else {
      log.error('Could not detect package manager. Please install PostgreSQL manually.');
      return false;
    }

  } else if (IS_WINDOWS) {
    log.error('Windows detected - please install PostgreSQL manually from:');
    log.info('https://www.postgresql.org/download/windows/');
    log.info('Or use: choco install postgresql');
    return false;
  }

  // Verify installation with timeout
  log.info('Verifying PostgreSQL installation...');
  const check = run('pg_isready', { silent: true, timeout: 10000 });
  if (check.success) {
    log.success('PostgreSQL installed and running!');
    return true;
  }

  // Try starting the service
  log.info('Trying to start PostgreSQL service...');
  if (IS_MAC) {
    run('brew services start postgresql@16', { timeout: 30000 });
  } else if (IS_LINUX) {
    run('sudo systemctl start postgresql', { timeout: 30000 });
  }

  // Wait up to 30 seconds for PG to be ready
  for (let i = 0; i < 6; i++) {
    if (run('pg_isready', { silent: true, timeout: 5000 }).success) {
      log.success('PostgreSQL is ready');
      return true;
    }
    log.info('Waiting for PostgreSQL to start...');
    run('sleep 5', { silent: true });
  }

  log.warn('PostgreSQL may not be fully started - continuing anyway');
  return true; // Continue setup, might work
}

// ============================================================================
// PGVECTOR INSTALLATION
// ============================================================================

/**
 * Check if pgvector extension is available
 */
function checkPgvector() {
  log.header('Checking pgvector Extension');

  const result = run(
    `sudo -u postgres psql -c "SELECT 1 FROM pg_available_extensions WHERE name = 'vector';" 2>/dev/null`,
    { silent: true, timeout: 15000 }
  );

  if (result.success && result.output && result.output.includes('1')) {
    log.success('pgvector extension is available');
    return true;
  }

  log.warn('pgvector not found - will install');
  return false;
}

/**
 * Install pgvector extension
 */
function installPgvector() {
  log.header('Installing pgvector Extension');

  const PGVECTOR_TIMEOUT = 120000; // 2 minute timeout

  if (IS_MAC) {
    log.step(1, 'Installing pgvector via Homebrew...');
    run('brew install pgvector', { timeout: PGVECTOR_TIMEOUT });

  } else if (IS_LINUX) {
    // Try apt first (Ubuntu/Debian have pgvector in repos now)
    if (commandExists('apt-get')) {
      log.step(1, 'Trying apt install (timeout: 2 min)...');
      const aptResult = run('sudo apt-get install -y postgresql-16-pgvector 2>/dev/null || sudo apt-get install -y postgresql-pgvector 2>/dev/null', { silent: true, timeout: PGVECTOR_TIMEOUT });

      if (!aptResult.success) {
        log.step(2, 'Building pgvector from source (timeout: 3 min)...');
        buildPgvectorFromSource();
      }
    } else {
      log.step(1, 'Building pgvector from source (timeout: 3 min)...');
      buildPgvectorFromSource();
    }
  }

  // Verify with timeout
  log.info('Verifying pgvector installation...');
  const check = run(
    `sudo -u postgres psql -c "SELECT 1 FROM pg_available_extensions WHERE name = 'vector';" 2>/dev/null`,
    { silent: true, timeout: 15000 }
  );

  if (check.success && check.output && check.output.includes('1')) {
    log.success('pgvector installed successfully!');
    return true;
  }

  log.warn('pgvector install may have timed out - continuing anyway');
  log.info('SpecMem can work without pgvector (reduced functionality)');
  return false;
}

/**
 * Build pgvector from source
 */
function buildPgvectorFromSource() {
  log.info('Building pgvector from source...');

  const BUILD_TIMEOUT = 180000; // 3 minute timeout for build

  // Install build dependencies
  if (commandExists('apt-get')) {
    run('sudo apt-get install -y build-essential git postgresql-server-dev-all', { timeout: 120000 });
  } else if (commandExists('dnf')) {
    run('sudo dnf install -y gcc make git postgresql-devel', { timeout: 120000 });
  } else if (commandExists('yum')) {
    run('sudo yum install -y gcc make git postgresql-devel', { timeout: 120000 });
  }

  // Clone and build with timeout
  const tmpDir = '/tmp/pgvector-build';
  run(`rm -rf ${tmpDir}`, { timeout: 10000 });

  const cloneResult = run(`git clone --branch v0.7.4 https://github.com/pgvector/pgvector.git ${tmpDir}`, { timeout: 60000 });
  if (!cloneResult.success) {
    log.warn('Failed to clone pgvector repo - skipping');
    return;
  }

  const buildResult = run(`cd ${tmpDir} && make && sudo make install`, { timeout: BUILD_TIMEOUT });
  if (!buildResult.success) {
    log.warn('pgvector build timed out or failed');
  }

  run(`rm -rf ${tmpDir}`, { timeout: 10000 });
}

// ============================================================================
// DATABASE SETUP
// ============================================================================

/**
 * Create SpecMem database and user
 */
function setupDatabase() {
  log.header('Setting Up SpecMem Database');

  const { name, user, password } = DB_CONFIG;

  // Create user with SUPERUSER (needed for pgvector extension)
  log.step(1, `Creating user: ${user}`);
  run(`sudo -u postgres psql -c "CREATE USER ${user} WITH SUPERUSER PASSWORD '${password}';" 2>/dev/null || true`, { silent: true });
  // Ensure SUPERUSER in case user already existed
  run(`sudo -u postgres psql -c "ALTER USER ${user} WITH SUPERUSER;" 2>/dev/null || true`, { silent: true });

  // Create database
  log.step(2, `Creating database: ${name}`);
  run(`sudo -u postgres psql -c "CREATE DATABASE ${name} OWNER ${user};" 2>/dev/null || true`, { silent: true });

  // Grant privileges
  log.step(3, 'Granting privileges...');
  run(`sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${name} TO ${user};" 2>/dev/null || true`, { silent: true });

  // Enable pgvector extension
  log.step(4, 'Enabling pgvector extension...');
  run(`sudo -u postgres psql -d ${name} -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || true`, { silent: true });

  // Verify connection
  log.step(5, 'Verifying database connection...');
  const verify = run(
    `PGPASSWORD='${password}' psql -h localhost -U ${user} -d ${name} -c "SELECT 1;" 2>/dev/null`,
    { silent: true }
  );

  if (verify.success) {
    log.success('Database setup complete!');
    return true;
  }

  // Try adjusting pg_hba.conf for password auth
  log.warn('Connection failed - adjusting authentication...');
  adjustPgAuth();

  return true;
}

/**
 * Adjust PostgreSQL authentication to allow password auth
 */
function adjustPgAuth() {
  log.info('Configuring PostgreSQL authentication...');

  // Find pg_hba.conf
  const possiblePaths = [
    '/etc/postgresql/16/main/pg_hba.conf',
    '/etc/postgresql/15/main/pg_hba.conf',
    '/etc/postgresql/14/main/pg_hba.conf',
    '/var/lib/pgsql/data/pg_hba.conf',
    '/var/lib/postgres/data/pg_hba.conf'
  ];

  let pgHbaPath = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      pgHbaPath = p;
      break;
    }
  }

  if (!pgHbaPath) {
    // Try to find it
    const findResult = run('sudo find /etc /var -name pg_hba.conf 2>/dev/null | head -1', { silent: true });
    if (findResult.success && findResult.output) {
      pgHbaPath = findResult.output.trim();
    }
  }

  if (pgHbaPath) {
    log.info(`Found pg_hba.conf: ${pgHbaPath}`);

    // Backup and modify
    run(`sudo cp ${pgHbaPath} ${pgHbaPath}.backup`);

    // Add password auth for our user
    const authLine = `host    ${DB_CONFIG.name}    ${DB_CONFIG.user}    127.0.0.1/32    md5`;
    run(`echo '${authLine}' | sudo tee -a ${pgHbaPath}`);

    // Reload PostgreSQL
    run('sudo systemctl reload postgresql 2>/dev/null || sudo -u postgres pg_ctl reload');

    log.success('PostgreSQL authentication configured');
  }
}

// ============================================================================
// DOCKER SETUP
// ============================================================================

/**
 * Check and install Docker - Full auto-install for all platforms
 */
function setupDocker() {
  log.header('Checking Docker');

  // Skip if requested or in lite mode
  if (SKIP_EMBEDDINGS) {
    log.info('Skipping Docker/embeddings setup (SPECMEM_SKIP_EMBEDDINGS=true)');
    log.info('SpecMem will use API-based embeddings as fallback');
    return true;
  }

  // Warn if running inside Docker (Docker-in-Docker is complex)
  if (IS_DOCKER) {
    log.warn('Running inside Docker container detected!');
    log.info('Docker-in-Docker requires special setup.');
    log.info('Options:');
    log.info('  1. Mount host Docker socket: -v /var/run/docker.sock:/var/run/docker.sock');
    log.info('  2. Use privileged mode: --privileged');
    log.info('  3. Skip local embeddings: export SPECMEM_SKIP_EMBEDDINGS=true');
    log.info('');
    log.info('Attempting to continue anyway...');
  }

  // Check if Docker is already installed
  if (commandExists('docker')) {
    log.success('Docker is installed');
    return startDockerDaemon();
  }

  log.warn('Docker not found - attempting auto-install...');

  // Platform-specific installation
  if (IS_MAC) {
    return installDockerMac();
  } else if (IS_LINUX) {
    return installDockerLinux();
  } else if (IS_WINDOWS) {
    log.error('Windows detected - please install Docker Desktop manually:');
    log.info('https://docs.docker.com/desktop/install/windows-install/');
    log.info('Or use: winget install Docker.DockerDesktop');
    return false;
  }

  return false;
}

/**
 * Start Docker daemon if not running
 */
function startDockerDaemon() {
  const running = run('docker info', { silent: true });
  if (running.success) {
    log.success('Docker daemon is running');
    return true;
  }

  log.warn('Docker daemon not running - attempting to start...');

  if (IS_MAC) {
    // Try to start Docker Desktop
    log.step(1, 'Starting Docker Desktop...');
    run('open -a Docker', { silent: true });

    // Wait for Docker to start (up to 60 seconds)
    log.info('Waiting for Docker daemon to start...');
    for (let i = 0; i < 12; i++) {
      run('sleep 5', { silent: true });
      if (run('docker info', { silent: true }).success) {
        log.success('Docker daemon started');
        return true;
      }
      process.stdout.write('.');
    }
    console.log('');

    // Try colima as fallback
    if (commandExists('colima')) {
      log.step(2, 'Trying colima start...');
      run('colima start');
      if (run('docker info', { silent: true }).success) {
        log.success('Docker (via colima) started');
        return true;
      }
    }

    log.warn('Could not start Docker daemon automatically');
    log.info('Please start Docker Desktop manually and re-run installation');
    return false;

  } else if (IS_LINUX) {
    // In Docker container, systemctl won't work
    if (IS_DOCKER) {
      log.warn('Inside Docker container - systemctl unavailable');
      log.info('Checking if Docker socket is mounted...');

      if (fs.existsSync('/var/run/docker.sock')) {
        if (run('docker info', { silent: true }).success) {
          log.success('Docker socket available (mounted from host)');
          return true;
        }
      }

      log.warn('Docker socket not available in container');
      log.info('SpecMem will work without local embeddings');
      log.info('To enable: run container with -v /var/run/docker.sock:/var/run/docker.sock');
      return false;
    }

    // Try systemctl first (only on non-containerized Linux)
    log.step(1, 'Starting Docker via systemctl...');
    run('sudo systemctl start docker');
    run('sudo systemctl enable docker');

    if (run('docker info', { silent: true }).success) {
      log.success('Docker daemon started');
      return true;
    }

    // Try service command as fallback
    log.step(2, 'Trying service command...');
    run('sudo service docker start');

    if (run('docker info', { silent: true }).success) {
      log.success('Docker daemon started');
      return true;
    }

    log.warn('Could not start Docker daemon');
    return false;
  }

  return false;
}

/**
 * Install Docker on macOS
 */
function installDockerMac() {
  log.header('Installing Docker on macOS');

  // Check for Homebrew
  if (!commandExists('brew')) {
    log.step(1, 'Installing Homebrew first...');
    const brewInstall = run('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
    if (!brewInstall.success) {
      log.error('Failed to install Homebrew');
      log.info('Install Docker Desktop manually: https://docs.docker.com/desktop/install/mac-install/');
      return false;
    }
  }

  // Option 1: Try Docker Desktop (official, GUI)
  log.step(2, 'Installing Docker Desktop via Homebrew...');
  const desktopResult = run('brew install --cask docker', { silent: true });

  if (desktopResult.success) {
    log.success('Docker Desktop installed');
    log.step(3, 'Starting Docker Desktop...');
    run('open -a Docker');

    // Wait for Docker to initialize
    log.info('Waiting for Docker to initialize (this may take a minute)...');
    for (let i = 0; i < 12; i++) {
      run('sleep 5', { silent: true });
      if (run('docker info', { silent: true }).success) {
        log.success('Docker is ready!');
        return true;
      }
      process.stdout.write('.');
    }
    console.log('');
    log.warn('Docker Desktop installed but not yet ready');
    log.info('Please wait for Docker Desktop to finish starting, then re-run');
    return true; // It's installed, just not ready
  }

  // Option 2: Try colima (lightweight, CLI-only)
  log.step(2, 'Docker Desktop failed, trying colima...');
  run('brew install colima docker docker-compose');

  if (commandExists('colima')) {
    log.step(3, 'Starting colima...');
    run('colima start --cpu 2 --memory 4');

    if (run('docker info', { silent: true }).success) {
      log.success('Docker (via colima) is ready!');
      return true;
    }
  }

  log.error('Could not install Docker automatically');
  log.info('Please install Docker Desktop manually: https://docs.docker.com/desktop/install/mac-install/');
  return false;
}

/**
 * Install Docker on Linux - supports multiple package managers
 */
function installDockerLinux() {
  log.header('Installing Docker on Linux');

  // Method 1: Official Docker install script (works on most distros)
  log.step(1, 'Trying official Docker install script...');
  const scriptResult = run('curl -fsSL https://get.docker.com | sudo sh', { timeout: 300000 });

  if (scriptResult.success && commandExists('docker')) {
    log.success('Docker installed via official script');
    configureDockerLinux();
    return startDockerDaemon();
  }

  // Method 2: Package manager specific
  log.step(2, 'Trying package manager installation...');

  if (commandExists('apt-get')) {
    // Debian/Ubuntu
    log.info('Detected Debian/Ubuntu...');
    run('sudo apt-get update');
    run('sudo apt-get install -y ca-certificates curl gnupg');
    run('sudo install -m 0755 -d /etc/apt/keyrings');
    run('curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg');
    run('sudo chmod a+r /etc/apt/keyrings/docker.gpg');

    // Add repo (try Ubuntu first, then Debian)
    const distro = run('lsb_release -is 2>/dev/null || cat /etc/os-release | grep ^ID= | cut -d= -f2', { silent: true });
    const codename = run('lsb_release -cs 2>/dev/null || cat /etc/os-release | grep VERSION_CODENAME | cut -d= -f2', { silent: true });

    const repoDistro = distro.output?.toLowerCase().includes('ubuntu') ? 'ubuntu' : 'debian';
    run(`echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${repoDistro} $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list`);

    run('sudo apt-get update');
    run('sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin');

  } else if (commandExists('dnf')) {
    // Fedora/RHEL 8+
    log.info('Detected Fedora/RHEL...');
    run('sudo dnf -y install dnf-plugins-core');
    run('sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo');
    run('sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin');

  } else if (commandExists('yum')) {
    // CentOS/RHEL 7
    log.info('Detected CentOS/RHEL...');
    run('sudo yum install -y yum-utils');
    run('sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo');
    run('sudo yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin');

  } else if (commandExists('pacman')) {
    // Arch Linux
    log.info('Detected Arch Linux...');
    run('sudo pacman -Sy --noconfirm docker docker-compose');

  } else if (commandExists('zypper')) {
    // openSUSE
    log.info('Detected openSUSE...');
    run('sudo zypper install -y docker docker-compose');

  } else {
    log.error('Could not detect package manager');
    log.info('Please install Docker manually: https://docs.docker.com/engine/install/');
    return false;
  }

  if (commandExists('docker')) {
    log.success('Docker installed');
    configureDockerLinux();
    return startDockerDaemon();
  }

  log.error('Docker installation failed');
  return false;
}

/**
 * Configure Docker for non-root usage on Linux
 * SECURITY: Binds Docker to 127.0.0.1 only (no external access)
 */
function configureDockerLinux() {
  log.step('→', 'Configuring Docker for non-root usage...');

  const user = process.env.USER || process.env.LOGNAME || 'root';

  // Add user to docker group
  run(`sudo usermod -aG docker ${user}`);

  // SECURITY: Configure Docker to bind to localhost only
  log.step('→', 'Securing Docker to localhost only (127.0.0.1)...');
  const daemonConfig = {
    "iptables": true,
    "ip": "127.0.0.1",
    "ip-forward": false,
    "userland-proxy": true,
    "live-restore": true,
    "log-driver": "json-file",
    "log-opts": {
      "max-size": "10m",
      "max-file": "3"
    }
  };

  try {
    const daemonJsonPath = '/etc/docker/daemon.json';
    run('sudo mkdir -p /etc/docker');

    // Check if config exists and merge
    let existingConfig = {};
    if (fs.existsSync(daemonJsonPath)) {
      try {
        existingConfig = JSON.parse(fs.readFileSync(daemonJsonPath, 'utf8'));
      } catch (e) {}
    }

    const mergedConfig = { ...existingConfig, ...daemonConfig };
    const configJson = JSON.stringify(mergedConfig, null, 2);

    // Write via sudo
    run(`echo '${configJson}' | sudo tee ${daemonJsonPath}`);
    log.success('Docker configured for localhost-only access (127.0.0.1)');
  } catch (e) {
    log.warn('Could not configure Docker daemon.json - manual security review recommended');
  }

  // Enable and start Docker service
  run('sudo systemctl enable docker');
  run('sudo systemctl restart docker'); // Restart to apply new config

  // Set up Docker to start on boot
  run('sudo systemctl enable containerd');

  log.success(`User '${user}' added to docker group`);
  log.info('Note: You may need to log out and back in for group changes to take effect');
}

/**
 * Build or pull the SpecMem embedding Docker image
 */
function setupEmbeddingImage() {
  log.header('Setting Up Embedding Docker Image');

  const imageName = 'specmem-embeddings:latest';

  // Check if image already exists
  const exists = run(`docker image inspect ${imageName}`, { silent: true });
  if (exists.success) {
    log.success('Embedding image already exists');
    return true;
  }

  // Try to build from local Dockerfile
  const dockerfilePath = path.join(SPECMEM_PKG_DIR, 'embedding-sandbox', 'Dockerfile');

  if (fs.existsSync(dockerfilePath)) {
    log.step(1, 'Building embedding image from Dockerfile...');
    const buildResult = run(
      `docker build -t ${imageName} ${path.dirname(dockerfilePath)}`,
      { timeout: 600000 } // 10 min timeout for build
    );

    if (buildResult.success) {
      log.success('Embedding image built successfully');
      return true;
    }
    log.warn('Docker build failed, will build on first use');
  } else {
    log.info('No Dockerfile found - image will be built on first use');
  }

  return false;
}

/**
 * Load embedded Docker images from package
 */
function loadEmbeddedDockerImages() {
  log.header('Loading Embedded Docker Images');

  const dockerDistDir = path.join(SPECMEM_PKG_DIR, 'docker-dist');
  const manifestPath = path.join(dockerDistDir, 'manifest.json');

  // Check if we have embedded images
  if (!fs.existsSync(manifestPath)) {
    log.info('No embedded Docker images found (development mode)');
    log.info('Images will be built on first use');
    return false;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    log.info(`Found ${manifest.images.length} embedded image(s)`);

    for (const image of manifest.images) {
      const imagePath = path.join(dockerDistDir, image.file);

      if (!fs.existsSync(imagePath)) {
        log.warn(`Image file not found: ${image.file}`);
        continue;
      }

      log.step('→', `Loading ${image.name}:${image.tag}...`);

      // Check if image already exists
      const exists = run(`docker image inspect ${image.name}:${image.tag}`, { silent: true });
      if (exists.success) {
        log.info(`Image ${image.name}:${image.tag} already exists, skipping`);
        continue;
      }

      // Load the image
      const loadResult = run(`gunzip -c "${imagePath}" | docker load`, { silent: true });

      if (loadResult.success) {
        log.success(`Loaded: ${image.name}:${image.tag}`);
      } else {
        log.warn(`Failed to load: ${image.name}:${image.tag}`);
      }
    }

    return true;
  } catch (e) {
    log.warn(`Error loading embedded images: ${e.message}`);
    return false;
  }
}

// ============================================================================
// CLAUDE COMMANDS SETUP
// ============================================================================

/**
 * Install SpecMem slash commands to 's commands directory
 * These are the /specmem-* commands that provide memory operations
 */
function installCommands() {
  log.header('Installing SpecMem Commands');

  const commandsDir = path.join(CLAUDE_DIR, 'commands');
  const specmemCommandsDir = path.join(SPECMEM_PKG_DIR, 'commands');

  ensureDir(commandsDir);

  if (!fs.existsSync(specmemCommandsDir)) {
    log.warn(`Commands directory not found: ${specmemCommandsDir}`);
    return { installed: false, commands: [] };
  }

  // Get all .md command files
  const commandFiles = fs.readdirSync(specmemCommandsDir).filter(f => f.endsWith('.md'));
  const copiedCommands = [];

  // Clean up old SpecMem commands that no longer exist in source
  if (fs.existsSync(commandsDir)) {
    const existingCommands = fs.readdirSync(commandsDir).filter(f => f.startsWith('specmem') && f.endsWith('.md'));
    for (const oldCmd of existingCommands) {
      if (!commandFiles.includes(oldCmd)) {
        try {
          fs.unlinkSync(path.join(commandsDir, oldCmd));
          log.info(`Removed outdated: ${oldCmd}`);
        } catch (e) {}
      }
    }
  }

  // Copy all command files
  for (const cmdFile of commandFiles) {
    const src = path.join(specmemCommandsDir, cmdFile);
    const dest = path.join(commandsDir, cmdFile);

    try {
      fs.copyFileSync(src, dest);
      copiedCommands.push(cmdFile.replace('.md', ''));
      log.success(`Installed: /${cmdFile.replace('.md', '')}`);
    } catch (e) {
      log.warn(`Failed to install: ${cmdFile}`);
    }
  }

  if (copiedCommands.length > 0) {
    log.success(`Total: ${copiedCommands.length} commands installed`);
  }

  return { installed: copiedCommands.length > 0, commands: copiedCommands };
}

// ============================================================================
// CLAUDE SKILLS SETUP
// ============================================================================

/**
 * Install SpecMem skills to 's commands directory
 * Skills are .md files that provide specialized behaviors/prompts
 * They get deployed alongside commands (same directory in  Code)
 */
function installSkills() {
  log.header('Installing SpecMem Skills');

  const commandsDir = path.join(CLAUDE_DIR, 'commands');
  const skillsDir = path.join(SPECMEM_PKG_DIR, 'skills');

  ensureDir(commandsDir);

  if (!fs.existsSync(skillsDir)) {
    log.warn(`Skills directory not found: ${skillsDir}`);
    return { installed: false, skills: [] };
  }

  const copiedSkills = [];

  /**
   * Recursively copy skill files from a directory
   */
  function copySkillsFrom(srcDir, prefix = '') {
    if (!fs.existsSync(srcDir)) return;

    const items = fs.readdirSync(srcDir, { withFileTypes: true });

    for (const item of items) {
      const srcPath = path.join(srcDir, item.name);

      if (item.isDirectory()) {
        // Recurse into subdirectories (e.g., teammemberskills/)
        copySkillsFrom(srcPath, item.name + '-');
      } else if (item.name.endsWith('.md')) {
        // Skill file - copy to commands dir
        const destName = prefix ? `${prefix}${item.name}` : item.name;
        const destPath = path.join(commandsDir, destName);

        try {
          fs.copyFileSync(srcPath, destPath);
          copiedSkills.push(destName.replace('.md', ''));
          log.success(`Skill: /${destName.replace('.md', '')}`);
        } catch (e) {
          log.warn(`Failed to install skill: ${destName}`);
        }
      }
    }
  }

  // Copy all skills (including from subdirectories)
  copySkillsFrom(skillsDir);

  if (copiedSkills.length > 0) {
    log.success(`Total: ${copiedSkills.length} skills installed`);
  }

  return { installed: copiedSkills.length > 0, skills: copiedSkills };
}

// ============================================================================
// SPECMEM PLUGINS SETUP
// ============================================================================

/**
 * Install SpecMem plugins to 's plugins directory
 * Plugins contain agent definitions that get loaded by agent-loading-hook
 */
function installPlugins() {
  log.header('Installing SpecMem Plugins');

  const claudePluginsDir = path.join(CLAUDE_DIR, 'plugins');
  const specmemPluginsDir = path.join(SPECMEM_PKG_DIR, 'plugins');

  ensureDir(claudePluginsDir);

  if (!fs.existsSync(specmemPluginsDir)) {
    log.info('No bundled plugins found (development mode)');
    return { installed: false, plugins: [] };
  }

  const copiedPlugins = [];

  /**
   * Recursively copy a directory
   */
  function copyDirRecursive(src, dest) {
    ensureDir(dest);
    const items = fs.readdirSync(src, { withFileTypes: true });

    for (const item of items) {
      const srcPath = path.join(src, item.name);
      const destPath = path.join(dest, item.name);

      if (item.isDirectory()) {
        copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  // Get all plugin directories
  const plugins = fs.readdirSync(specmemPluginsDir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const plugin of plugins) {
    const srcPluginDir = path.join(specmemPluginsDir, plugin.name);
    const destPluginDir = path.join(claudePluginsDir, plugin.name);

    try {
      copyDirRecursive(srcPluginDir, destPluginDir);
      copiedPlugins.push(plugin.name);
      log.success(`Plugin: ${plugin.name}`);
    } catch (e) {
      log.warn(`Failed to install plugin: ${plugin.name}`);
    }
  }

  if (copiedPlugins.length > 0) {
    log.success(`Total: ${copiedPlugins.length} plugins installed`);
  }

  return { installed: copiedPlugins.length > 0, plugins: copiedPlugins };
}

// ============================================================================
// CLAUDE HOOKS SETUP
// ============================================================================

/**
 * Install  hooks
 * Copies ALL hook files including .cjs and .json support files
 */
function installHooks() {
  log.header('Installing  Hooks');

  ensureDir(CLAUDE_HOOKS_DIR);

  const hooksDir = path.join(SPECMEM_PKG_DIR, 'claude-hooks');

  if (!fs.existsSync(hooksDir)) {
    log.warn(`Hooks directory not found: ${hooksDir}`);
    return;
  }

  // CRITICAL: Include .cjs and .json files for token compressor system
  const hooks = fs.readdirSync(hooksDir).filter(f =>
    f.endsWith('.js') || f.endsWith('.cjs') || f.endsWith('.json') ||
    f.endsWith('.py') || f.endsWith('.sh')
  );

  let installed = 0;
  for (const hook of hooks) {
    const src = path.join(hooksDir, hook);
    const dest = path.join(CLAUDE_HOOKS_DIR, hook);

    try {
      fs.copyFileSync(src, dest);
      // Only chmod executable files, not .json
      if (!hook.endsWith('.json')) {
        fs.chmodSync(dest, 0o755);
      }
      installed++;
    } catch (e) {
      log.warn(`Failed to install: ${hook}`);
    }
  }

  log.success(`Installed ${installed} hook files`);
}

/**
 * Configure  settings.json with hooks
 */
function configureSettings() {
  log.header('Configuring  Settings');

  ensureDir(CLAUDE_DIR);

  let settings = {};

  // Load existing settings
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    try {
      settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
      log.info('Loaded existing settings.json');
    } catch (e) {
      log.warn('Could not parse existing settings.json, creating new');
    }
  }

  // Ensure permissions
  if (!settings.permissions) settings.permissions = {};
  if (!settings.permissions.allow) settings.permissions.allow = [];

  // Add SpecMem permissions (MCP tools + Skills for commands)
  const requiredPermissions = [
    'mcp__specmem__*',      // All MCP tools
    'Skill(specmem)',        // Main specmem skill
    'Skill(specmem-*)',      // All specmem-* skills/commands
    'Bash',
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep'
  ];
  for (const perm of requiredPermissions) {
    if (!settings.permissions.allow.includes(perm)) {
      settings.permissions.allow.push(perm);
    }
  }

  // Configure hooks - MERGE with existing, don't overwrite!
  if (!settings.hooks) settings.hooks = {};

  // Standard env vars for all hooks
  const hookEnv = {
    SPECMEM_HOME: SPECMEM_GLOBAL_DIR,
    SPECMEM_PKG: SPECMEM_PKG_DIR,
    SPECMEM_RUN_DIR: '${cwd}/specmem/sockets',
    SPECMEM_EMBEDDING_SOCKET: '${cwd}/specmem/sockets/embeddings.sock',
    SPECMEM_PROJECT_PATH: '${cwd}'
  };

  /**
   * Helper to merge hooks without clobbering user's custom hooks
   * - Removes old specmem hooks (by matcher or command pattern)
   * - Adds new specmem hooks
   * - Preserves user's custom non-specmem hooks
   */
  function mergeHooks(existing, newHooks) {
    if (!existing) return newHooks;

    // Build set of specmem matchers for new hooks
    const specmemMatchers = new Map();
    for (const hook of newHooks) {
      const matcherKey = hook.matcher || '__CATCHALL__';
      specmemMatchers.set(matcherKey, hook);
    }

    // Filter existing hooks:
    // - Remove groups with same matcher as specmem (specmem takes priority)
    // - Remove old specmem hooks (by command pattern)
    const preserved = existing.filter(h => {
      const matcherKey = h.matcher || '__CATCHALL__';

      // If specmem has a hook for this matcher, remove existing
      if (specmemMatchers.has(matcherKey)) {
        return false;
      }

      // Check if this is a specmem hook (to avoid duplicates on re-init)
      const hookStr = JSON.stringify(h);
      if (hookStr.includes('specmem-') ||
          hookStr.includes('/specmem/') ||
          hookStr.includes('team-comms-enforcer') ||
          hookStr.includes('smart-context-hook') ||
          hookStr.includes('agent-loading-hook') ||
          hookStr.includes('input-aware-improver')) {
        return false;
      }

      return true; // Preserve user's custom hooks
    });

    // Return: preserved user hooks + new specmem hooks
    return [...preserved, ...newHooks];
  }

  // UserPromptSubmit hooks - MERGE
  const specmemUserPromptHooks = [
    {
      hooks: [{
        type: 'command',
        command: `node ${path.join(CLAUDE_HOOKS_DIR, 'specmem-drilldown-hook.js')}`,
        timeout: 30,
        env: {
          ...hookEnv,
          SPECMEM_SEARCH_LIMIT: '5',
          SPECMEM_THRESHOLD: '0.30',
          SPECMEM_MAX_CONTENT: '200'
        }
      }]
    },
    {
      hooks: [{
        type: 'command',
        command: `node ${path.join(CLAUDE_HOOKS_DIR, 'input-aware-improver.js')}`,
        timeout: 5,
        env: hookEnv
      }]
    }
  ];
  settings.hooks.UserPromptSubmit = mergeHooks(settings.hooks.UserPromptSubmit, specmemUserPromptHooks);

  // PreToolUse hooks - Agent loading with chooser - MERGE
  const specmemPreToolUseHooks = [
    {
      matcher: 'Task',
      hooks: [{
        type: 'command',
        command: `node ${path.join(CLAUDE_HOOKS_DIR, 'agent-loading-hook.js')}`,
        timeout: 10,
        statusMessage: 'Agent Chooser...',
        env: {
          ...hookEnv,
          SPECMEM_FORCE_CHOOSER: '1',
          SPECMEM_AGENT_AUTO: '0'
        }
      }]
    },
    {
      matcher: 'Grep',
      hooks: [{
        type: 'command',
        command: `node ${path.join(CLAUDE_HOOKS_DIR, 'smart-context-hook.js')}`,
        timeout: 8,
        env: {
          ...hookEnv,
          SPECMEM_SEARCH_LIMIT: '3',
          SPECMEM_THRESHOLD: '0.25',
          SPECMEM_MAX_CONTENT: '150'
        }
      }]
    },
    {
      matcher: 'Glob',
      hooks: [{
        type: 'command',
        command: `node ${path.join(CLAUDE_HOOKS_DIR, 'smart-context-hook.js')}`,
        timeout: 8,
        env: {
          ...hookEnv,
          SPECMEM_SEARCH_LIMIT: '3',
          SPECMEM_THRESHOLD: '0.25',
          SPECMEM_MAX_CONTENT: '150'
        }
      }]
    },
    {
      matcher: 'Read',
      hooks: [{
        type: 'command',
        command: `node ${path.join(CLAUDE_HOOKS_DIR, 'smart-context-hook.js')}`,
        timeout: 8,
        env: {
          ...hookEnv,
          SPECMEM_SEARCH_LIMIT: '3',
          SPECMEM_THRESHOLD: '0.25',
          SPECMEM_MAX_CONTENT: '150'
        }
      }]
    }
  ];
  settings.hooks.PreToolUse = mergeHooks(settings.hooks.PreToolUse, specmemPreToolUseHooks);

  // SessionStart hook - MERGE
  const specmemSessionStartHooks = [
    {
      hooks: [{
        type: 'command',
        command: `node ${path.join(CLAUDE_HOOKS_DIR, 'specmem-session-start.cjs')}`,
        timeout: 30,
        env: hookEnv
      }]
    }
  ];
  settings.hooks.SessionStart = mergeHooks(settings.hooks.SessionStart, specmemSessionStartHooks);

  // PreCompact hook - saves context before compaction - MERGE
  const specmemPreCompactHooks = [
    {
      hooks: [{
        type: 'command',
        command: `node ${path.join(CLAUDE_HOOKS_DIR, 'specmem-precompact.js')}`,
        timeout: 60,
        env: hookEnv
      }]
    }
  ];
  settings.hooks.PreCompact = mergeHooks(settings.hooks.PreCompact, specmemPreCompactHooks);

  // PostToolUse hooks - agent completion tracking - MERGE
  const specmemPostToolUseHooks = [
    {
      matcher: 'Task',
      hooks: [{
        type: 'command',
        command: `node ${path.join(CLAUDE_HOOKS_DIR, 'task-progress-hook.js')}`,
        timeout: 10,
        statusMessage: 'Team member finished',
        env: hookEnv
      }]
    }
  ];
  settings.hooks.PostToolUse = mergeHooks(settings.hooks.PostToolUse, specmemPostToolUseHooks);

  // SubagentStart/Stop hooks - MERGE
  const specmemSubagentStartHooks = [
    {
      hooks: [{
        type: 'command',
        command: `node ${path.join(CLAUDE_HOOKS_DIR, 'subagent-loading-hook.js')}`,
        timeout: 5,
        statusMessage: 'Starting subagent...',
        env: hookEnv
      }]
    }
  ];
  settings.hooks.SubagentStart = mergeHooks(settings.hooks.SubagentStart, specmemSubagentStartHooks);

  const specmemSubagentStopHooks = [
    {
      hooks: [{
        type: 'command',
        command: `node ${path.join(CLAUDE_HOOKS_DIR, 'subagent-loading-hook.js')}`,
        timeout: 5,
        statusMessage: 'Subagent completed',
        env: hookEnv
      }]
    }
  ];
  settings.hooks.SubagentStop = mergeHooks(settings.hooks.SubagentStop, specmemSubagentStopHooks);

  // Configure MCP servers
  if (!settings.mcpServers) settings.mcpServers = {};

  // Read database credentials from .env if available, otherwise use defaults
  const envPath = path.join(process.cwd(), '.env');
  // Use DB_CONFIG as the single source of truth for credentials
  let dbCredentials = {
    SPECMEM_DB_HOST: DB_CONFIG.host,
    SPECMEM_DB_PORT: String(DB_CONFIG.port),
    SPECMEM_DB_NAME: DB_CONFIG.name,
    SPECMEM_DB_USER: DB_CONFIG.user,
    SPECMEM_DB_PASSWORD: DB_CONFIG.password
  };

  if (fs.existsSync(envPath)) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      const envLines = envContent.split('\n');
      for (const line of envLines) {
        const match = line.match(/^(SPECMEM_DB_\w+)=(.+)$/);
        if (match) {
          dbCredentials[match[1]] = match[2].trim();
        }
      }
      log.dim('Loaded DB credentials from .env');
    } catch (e) {
      log.dim('Using default DB credentials');
    }
  }

  settings.mcpServers.specmem = {
    command: 'node',
    args: [
      '--max-old-space-size=250',
      path.join(SPECMEM_PKG_DIR, 'bootstrap.cjs')
    ],
    env: {
      HOME: HOME,
      SPECMEM_PROJECT_PATH: '${PWD}',
      ...dbCredentials
    }
  };

  // Write settings
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));
  log.success(' settings configured (merged with existing - no clobbering!)');
}

// ============================================================================
// GLOBAL DIRECTORIES & ENV
// ============================================================================

/**
 * Setup global SpecMem directories
 */
function setupGlobalDirs() {
  log.header('Setting Up Global Directories');

  const dirs = [
    SPECMEM_GLOBAL_DIR,
    path.join(SPECMEM_GLOBAL_DIR, 'instances'),
    path.join(SPECMEM_GLOBAL_DIR, 'docker'),
    path.join(SPECMEM_GLOBAL_DIR, 'sockets'),
    path.join(SPECMEM_GLOBAL_DIR, 'logs')
  ];

  for (const dir of dirs) {
    ensureDir(dir);
  }
}

/**
 * Copy default agent configuration
 */
function copyAgentConfig() {
  const srcConfig = path.join(SPECMEM_PKG_DIR, '.specmem', 'agent-config.json');
  const destConfig = path.join(SPECMEM_GLOBAL_DIR, 'agent-config.json');

  if (fs.existsSync(srcConfig) && !fs.existsSync(destConfig)) {
    try {
      fs.copyFileSync(srcConfig, destConfig);
      log.success('Agent config template installed');
    } catch (e) {
      log.warn('Could not copy agent config');
    }
  }
}

/**
 * Create environment template
 */
function createEnvTemplate() {
  log.header('Creating Environment Template');

  const envTemplate = `# SpecMem Configuration
# Generated by specmem-hardwicksoftware
# https://justcalljon.pro

# Database (auto-configured)
SPECMEM_DB_HOST=${DB_CONFIG.host}
SPECMEM_DB_PORT=${DB_CONFIG.port}
SPECMEM_DB_NAME=${DB_CONFIG.name}
SPECMEM_DB_USER=${DB_CONFIG.user}
SPECMEM_DB_PASSWORD=${DB_CONFIG.password}

# Embedding Service
SPECMEM_EMBEDDING_TIMEOUT=45
SPECMEM_EMBEDDING_MAX_RETRIES=3

# Memory Settings
SPECMEM_MAX_HEAP_MB=100
SPECMEM_SEARCH_LIMIT=10
SPECMEM_THRESHOLD=0.25

# Docker (on-demand activation)
SPECMEM_DOCKER_CPU_LIMIT=20
SPECMEM_DOCKER_MEMORY_LIMIT=2g
SPECMEM_DOCKER_IDLE_TIMEOUT=60
`;

  const envPath = path.join(SPECMEM_GLOBAL_DIR, 'specmem.env.template');
  fs.writeFileSync(envPath, envTemplate);
  log.success('Environment template created');
}

// ============================================================================
// MAIN INSTALLATION
// ============================================================================

async function main() {
  console.log(`
${c.bright}${c.cyan}
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ███████╗██████╗ ███████╗ ██████╗███╗   ███╗███████╗███╗   ███╗
║   ██╔════╝██╔══██╗██╔════╝██╔════╝████╗ ████║██╔════╝████╗ ████║
║   ███████╗██████╔╝█████╗  ██║     ██╔████╔██║█████╗  ██╔████╔██║
║   ╚════██║██╔═══╝ ██╔══╝  ██║     ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║
║   ███████║██║     ███████╗╚██████╗██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║
║   ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝
║                                                               ║
║   FULL AUTO-INSTALL                                           ║
║   PostgreSQL + pgvector + Docker + Hooks                      ║
║   https://justcalljon.pro                                     ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
${c.reset}
`);

  log.info('Starting SpecMem full auto-installation...');
  log.info(`Platform: ${PLATFORM}`);

  // ============================================================================
  // CRITICAL WARNING: YOU MUST RUN SETUP TO CUSTOMIZE!
  // ============================================================================
  console.log(`
${c.red}${c.bright}╔═══════════════════════════════════════════════════════════════════════════════╗
║                     ⚠️  IMPORTANT: RUN SETUP FIRST! ⚠️                          ║
╠═══════════════════════════════════════════════════════════════════════════════╣${c.reset}
${c.red}║${c.reset}                                                                               ${c.red}║${c.reset}
${c.red}║${c.reset}  If you skip ${c.cyan}specmem setup${c.reset}, the following ${c.yellow}DEFAULTS${c.reset} will be applied:          ${c.red}║${c.reset}
${c.red}║${c.reset}                                                                               ${c.red}║${c.reset}
${c.red}║${c.reset}  ${c.bright}DATABASE:${c.reset}                                                                ${c.red}║${c.reset}
${c.red}║${c.reset}    • Host: ${c.cyan}localhost:5432${c.reset}                                                   ${c.red}║${c.reset}
${c.red}║${c.reset}    • Database: ${c.cyan}specmem_westayunprofessional${c.reset}                                 ${c.red}║${c.reset}
${c.red}║${c.reset}    • User: ${c.cyan}specmem_westayunprofessional${c.reset}                                     ${c.red}║${c.reset}
${c.red}║${c.reset}    • Password: ${c.cyan}specmem_westayunprofessional${c.reset}                                 ${c.red}║${c.reset}
${c.red}║${c.reset}                                                                               ${c.red}║${c.reset}
${c.red}║${c.reset}  ${c.bright}HOOKS (auto-installed to ~/.claude/hooks/):${c.reset}                              ${c.red}║${c.reset}
${c.red}║${c.reset}    • specmem-drilldown-hook.js (UserPromptSubmit, 30s timeout)              ${c.red}║${c.reset}
${c.red}║${c.reset}    • input-aware-improver.js (UserPromptSubmit, 5s timeout)                 ${c.red}║${c.reset}
${c.red}║${c.reset}    • agent-loading-hook.js (PreToolUse:Task, 10s timeout)                   ${c.red}║${c.reset}
${c.red}║${c.reset}    • smart-context-hook.js (PreToolUse:Grep/Glob/Read, 8s timeout)          ${c.red}║${c.reset}
${c.red}║${c.reset}    • specmem-session-start.cjs (SessionStart, 30s timeout)                  ${c.red}║${c.reset}
${c.red}║${c.reset}    • specmem-precompact.js (PreCompact, 60s timeout)                        ${c.red}║${c.reset}
${c.red}║${c.reset}    • task-progress-hook.js (PostToolUse:Task, 10s timeout)                  ${c.red}║${c.reset}
${c.red}║${c.reset}    • subagent-loading-hook.js (SubagentStart/Stop, 5s timeout)              ${c.red}║${c.reset}
${c.red}║${c.reset}                                                                               ${c.red}║${c.reset}
${c.red}║${c.reset}  ${c.bright}MCP SERVER:${c.reset}                                                              ${c.red}║${c.reset}
${c.red}║${c.reset}    • Command: ${c.cyan}node --max-old-space-size=250 bootstrap.cjs${c.reset}                   ${c.red}║${c.reset}
${c.red}║${c.reset}    • Project path: ${c.cyan}\${PWD}${c.reset} (current working directory)                       ${c.red}║${c.reset}
${c.red}║${c.reset}                                                                               ${c.red}║${c.reset}
${c.red}║${c.reset}  ${c.bright}PERMISSIONS (auto-granted in settings.json):${c.reset}                             ${c.red}║${c.reset}
${c.red}║${c.reset}    • mcp__specmem__* (all SpecMem MCP tools)                                ${c.red}║${c.reset}
${c.red}║${c.reset}    • Skill(specmem), Skill(specmem-*)                                        ${c.red}║${c.reset}
${c.red}║${c.reset}    • Bash, Read, Write, Edit, Glob, Grep                                     ${c.red}║${c.reset}
${c.red}║${c.reset}                                                                               ${c.red}║${c.reset}
${c.red}║${c.reset}  ${c.bright}EMBEDDING MODEL (downloaded on first use):${c.reset}                               ${c.red}║${c.reset}
${c.red}║${c.reset}    • sentence-transformers/all-MiniLM-L6-v2 (~90MB)                          ${c.red}║${c.reset}
${c.red}║${c.reset}    • ONNX + INT8 quantization for 2-4x faster inference                      ${c.red}║${c.reset}
${c.red}║${c.reset}                                                                               ${c.red}║${c.reset}
${c.red}║${c.reset}  ${c.bright}DOCKER:${c.reset}                                                                  ${c.red}║${c.reset}
${c.red}║${c.reset}    • Auto-install if missing (Linux official script, Mac via Homebrew)      ${c.red}║${c.reset}
${c.red}║${c.reset}    • Bound to 127.0.0.1 only (localhost, no external access)                ${c.red}║${c.reset}
${c.red}║${c.reset}    • Memory limit: 2GB, CPU limit: 20%                                       ${c.red}║${c.reset}
${c.red}║${c.reset}                                                                               ${c.red}║${c.reset}
${c.red}${c.bright}╠═══════════════════════════════════════════════════════════════════════════════╣
║  To customize these settings, run: ${c.cyan}specmem setup${c.reset}${c.red}${c.bright}                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝${c.reset}
`);

  // Give user a moment to read
  log.info('Proceeding with default configuration in 3 seconds...');
  log.info(`(Run ${c.cyan}specmem setup${c.reset} after install to customize)`);
  console.log('');

  const results = {
    claudeCode: false,
    screen: false,
    postgres: false,
    pgvector: false,
    database: false,
    docker: false,
    hooks: false,
    commands: false,
    skills: false,
    plugins: false,
    settings: false
  };

  try {
    // Step 0: Install ALL core system deps FIRST (python3, pip, screen, curl, git)
    installCoreDeps();

    // Step 0a: Claude Code (REQUIRED)
    results.claudeCode = ensureClaudeCode();
    if (!results.claudeCode) {
      log.warn('Claude Code not installed - SpecMem requires Claude Code to function');
      log.info('Install manually: npm install -g @anthropic-ai/claude-code');
    }

    // Step 0b: screen (needed for team members) - should already be installed by installCoreDeps
    results.screen = ensureScreen();

    // Step 1: PostgreSQL
    const pgStatus = checkPostgres();
    if (pgStatus === true) {
      results.postgres = true;
    } else {
      results.postgres = installPostgres();
    }

    // Step 2: pgvector
    if (results.postgres) {
      if (!checkPgvector()) {
        installPgvector();
      }
      results.pgvector = true;
    }

    // Step 3: Database setup
    if (results.postgres) {
      results.database = setupDatabase();
    }

    // Step 4: Docker
    results.docker = setupDocker();

    // Step 4b: Load embedded Docker images (if packaged)
    if (results.docker) {
      loadEmbeddedDockerImages();
      // Step 4c: Build/setup embedding image
      setupEmbeddingImage();
    }

    // Step 5: Global directories
    setupGlobalDirs();

    // Step 6: Environment template + agent config
    createEnvTemplate();
    copyAgentConfig();

    // Step 7:  hooks
    installHooks();
    results.hooks = true;

    // Step 8: SpecMem commands (slash commands)
    const cmdResult = installCommands();
    results.commands = cmdResult.installed;

    // Step 8b: SpecMem skills (specialized prompts)
    const skillResult = installSkills();
    results.skills = skillResult.installed;

    // Step 8c: SpecMem plugins (agent definitions)
    const pluginResult = installPlugins();
    results.plugins = pluginResult.installed;

    // Step 9:  settings (with Skill permissions)
    configureSettings();
    results.settings = true;

    // Summary
    log.header('Installation Summary');

    console.log(`
${results.postgres ? c.green + '✓' : c.red + '✗'}${c.reset} PostgreSQL    ${results.postgres ? 'Installed & Running' : 'FAILED - Install manually'}
${results.pgvector ? c.green + '✓' : c.yellow + '⚠'}${c.reset} pgvector      ${results.pgvector ? 'Available' : 'May need manual install'}
${results.database ? c.green + '✓' : c.red + '✗'}${c.reset} Database      ${results.database ? 'Created & Configured' : 'FAILED'}
${results.docker ? c.green + '✓' : c.yellow + '⚠'}${c.reset} Docker        ${results.docker ? 'Available' : 'Not found - embeddings limited'}
${results.hooks ? c.green + '✓' : c.red + '✗'}${c.reset} Hooks         ${results.hooks ? 'Installed' : 'FAILED'}
${results.commands ? c.green + '✓' : c.red + '✗'}${c.reset} Commands      ${results.commands ? 'Installed (/specmem-*)' : 'FAILED'}
${results.skills ? c.green + '✓' : c.red + '✗'}${c.reset} Skills        ${results.skills ? 'Installed (specialized prompts)' : 'FAILED'}
${results.plugins ? c.green + '✓' : c.yellow + '⚠'}${c.reset} Plugins       ${results.plugins ? 'Installed (agent definitions)' : 'None bundled'}
${results.settings ? c.green + '✓' : c.red + '✗'}${c.reset} Settings      ${results.settings ? 'Configured (with Skill perms)' : 'FAILED'}
`);

    console.log(`
${c.green}${c.bright}Installation Complete!${c.reset}

${c.bright}Next steps:${c.reset}
  1. Navigate to your project: ${c.cyan}cd /path/to/your/project${c.reset}
  2. Run the full init: ${c.cyan}specmem-init${c.reset}
     - Analyzes your project (Small/Medium/Large tier)
     - Optimizes model settings based on project size
     - Configures embedding timeouts and cache
     - Compresses commands with token optimization
     - Deploys to global and per-project locations
  3. Start  Code - SpecMem auto-injects context!

${c.bright}Commands:${c.reset}
  ${c.cyan}specmem-init${c.reset}      Full project initialization with loading bars
  ${c.cyan}specmem start${c.reset}     Start services manually
  ${c.cyan}specmem status${c.reset}    Check health
  ${c.cyan}specmem doctor${c.reset}    Diagnose issues

${c.bright}Database:${c.reset}
  Host: ${DB_CONFIG.host}:${DB_CONFIG.port}
  Database: ${DB_CONFIG.name}
  User: ${DB_CONFIG.user}

${c.yellow}Need help?${c.reset} https://justcalljon.pro
`);

    // Offer to run specmem-init if we're in a project directory (not npm's cache)
    const cwd = process.cwd();
    const isProjectDir = fs.existsSync(path.join(cwd, 'package.json')) ||
                         fs.existsSync(path.join(cwd, '.git')) ||
                         fs.existsSync(path.join(cwd, 'src'));

    if (isProjectDir && !cwd.includes('node_modules') && !cwd.includes('.npm')) {
      log.info(`Detected project directory: ${cwd}`);
      log.info(`Running ${c.cyan}specmem-init${c.reset} for this project...`);
      console.log('');

      try {
        const initScript = path.join(SPECMEM_PKG_DIR, 'scripts', 'specmem-init.cjs');
        if (fs.existsSync(initScript)) {
          run(`node "${initScript}"`, { silent: false });
        }
      } catch (e) {
        log.warn(`specmem-init failed: ${e.message}`);
        log.info(`Run ${c.cyan}specmem-init${c.reset} manually to complete setup`);
      }
    }

  } catch (error) {
    log.error(`Installation failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main };
