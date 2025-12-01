#!/usr/bin/env node
/**
 * SpecMem Health Check CLI (Standalone - No PM2)
 *
 * Command-line tool to check the health of running SpecMem instances.
 * Communicates via the socket lock file in .specmem directory.
 *
 * This script performs comprehensive health checks WITHOUT requiring PM2:
 * - Socket connectivity to running SpecMem instance
 * - PostgreSQL database connectivity
 * - MCP configuration validation
 * - Build status verification
 * - Embedding socket detection
 *
 * Usage:
 *   node specmem-health.cjs [project-path]
 *   node specmem-health.cjs --json
 *   node specmem-health.cjs --stats
 *   node specmem-health.cjs --full    # Run all diagnostic checks
 *
 * Examples:
 *   node specmem-health.cjs                    # Check current directory
 *   node specmem-health.cjs /path/to/project   # Check specific project
 *   node specmem-health.cjs --json             # JSON output
 *   node specmem-health.cjs --full             # Full diagnostic
 */

const net = require('net');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');
const os = require('os');

const SPECMEM_LOCAL_DIR = '.specmem';
const LOCK_SOCKET_FILE = 'specmem.sock';

/**
 * Get 12-char project hash for path isolation
 */
function getProjectHashFull(projectPath) {
  if (process.env.SPECMEM_PROJECT_HASH) {
    return process.env.SPECMEM_PROJECT_HASH;
  }
  const resolvedPath = path.resolve(projectPath || process.env.SPECMEM_PROJECT_PATH || process.cwd());
  return crypto.createHash('sha256').update(resolvedPath).digest('hex').slice(0, 12);
}

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function getProjectPath() {
  // Check command line args for project path
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (!arg.startsWith('-') && fs.existsSync(arg)) {
      return path.resolve(arg);
    }
  }
  return process.cwd();
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getSocketPath(projectPath) {
  return path.join(projectPath, SPECMEM_LOCAL_DIR, LOCK_SOCKET_FILE);
}

// Get specmem root directory
function getSpecmemRoot() {
  return process.env.SPECMEM_ROOT || '/specmem';
}

// Load specmem.env file
function loadSpecmemEnv() {
  const envPath = path.join(getSpecmemRoot(), 'specmem.env');
  const env = {};
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match && !line.startsWith('#')) {
        env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    });
  }
  return env;
}

// Check PostgreSQL connectivity
async function checkPostgreSQL() {
  const env = loadSpecmemEnv();
  const host = env.SPECMEM_DB_HOST || process.env.SPECMEM_DB_HOST || 'localhost';
  const port = env.SPECMEM_DB_PORT || process.env.SPECMEM_DB_PORT || '5432';
  const dbName = env.SPECMEM_DB_NAME || process.env.SPECMEM_DB_NAME || 'specmem_westayunprofessional';
  const user = env.SPECMEM_DB_USER || process.env.SPECMEM_DB_USER || 'specmem_westayunprofessional';
  const password = env.SPECMEM_DB_PASSWORD || process.env.SPECMEM_DB_PASSWORD || 'specmem_westayunprofessional';

  return new Promise((resolve) => {
    // Try psql first
    try {
      const result = execSync(
        `PGPASSWORD="${password}" psql -h "${host}" -p "${port}" -U "${user}" -d "${dbName}" -c "SELECT 1" 2>&1`,
        { encoding: 'utf8', timeout: 5000 }
      );
      // Check for pgvector
      try {
        const pgvector = execSync(
          `PGPASSWORD="${password}" psql -h "${host}" -p "${port}" -U "${user}" -d "${dbName}" -tAc "SELECT COUNT(*) FROM pg_extension WHERE extname='vector'" 2>&1`,
          { encoding: 'utf8', timeout: 5000 }
        );
        const hasPgvector = pgvector.trim() === '1';
        resolve({
          status: 'pass',
          detail: `Connected to ${dbName}@${host}:${port}${hasPgvector ? ' (pgvector enabled)' : ''}`
        });
      } catch {
        resolve({ status: 'pass', detail: `Connected to ${dbName}@${host}:${port}` });
      }
    } catch (err) {
      // Try TCP connection as fallback
      const socket = new net.Socket();
      socket.setTimeout(3000);
      socket.on('connect', () => {
        socket.destroy();
        resolve({ status: 'warn', detail: `Port ${port} reachable but psql check failed` });
      });
      socket.on('error', () => {
        resolve({ status: 'fail', detail: `Cannot connect to ${host}:${port}` });
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve({ status: 'fail', detail: `Connection timeout to ${host}:${port}` });
      });
      socket.connect(parseInt(port), host);
    }
  });
}

// Check embedding socket
function checkEmbeddingSocket() {
  const env = loadSpecmemEnv();
  const specmemRoot = getSpecmemRoot();

  // Get user ID for machine-unique shared socket
  const userId = process.getuid ? process.getuid() : 'default';

  const socketPaths = [
    env.SPECMEM_EMBEDDING_SOCKET,
    process.env.SPECMEM_EMBEDDING_SOCKET,
    // Machine-shared socket (NEW - preferred)
    `/tmp/specmem-embed-${userId}.sock`,
    // DEPRECATED: Legacy project-isolated paths
    path.join(specmemRoot, 'run', 'embeddings.sock'),
    '/tmp/specmem-sockets/embeddings.sock',
    // Container internal path
    '/sockets/embeddings.sock'
  ].filter(Boolean);

  for (const sockPath of socketPaths) {
    try {
      const stat = fs.statSync(sockPath);
      if (stat.isSocket()) {
        return { status: 'pass', detail: `Found at ${sockPath}` };
      }
    } catch {
      // Not found, continue
    }
  }

  // Check for Docker container as alternative
  try {
    const result = execSync('docker ps --filter "name=frankenstein" --filter "status=running" 2>/dev/null', { encoding: 'utf8' });
    if (result.includes('frankenstein')) {
      return { status: 'pass', detail: 'Docker container running (socket internal)' };
    }
  } catch {
    // Docker not available or container not running
  }

  return { status: 'warn', detail: 'Not found (optional - embeddings will queue)' };
}

// Check MCP configuration
function checkMCPConfig() {
  const claudeConfig = path.join(os.homedir(), '.claude.json');

  if (!fs.existsSync(claudeConfig)) {
    return { status: 'fail', detail: '~/.claude.json not found' };
  }

  try {
    const content = fs.readFileSync(claudeConfig, 'utf8');

    if (!content.includes('specmem')) {
      return { status: 'fail', detail: 'specmem not configured in ~/.claude.json' };
    }

    // Try to parse and extract path
    const config = JSON.parse(content);
    const mcpServers = config.mcpServers || {};
    const specmemConfig = mcpServers.specmem;

    if (!specmemConfig) {
      return { status: 'fail', detail: 'specmem MCP server not found in config' };
    }

    const args = specmemConfig.args || [];
    const scriptPath = args.find(arg => arg.endsWith('.cjs') || arg.endsWith('.js'));

    if (scriptPath && fs.existsSync(scriptPath)) {
      return { status: 'pass', detail: `Valid (path: ${scriptPath})` };
    } else if (scriptPath) {
      return { status: 'fail', detail: `Configured path not found: ${scriptPath}` };
    } else {
      return { status: 'warn', detail: 'specmem configured but path could not be verified' };
    }
  } catch (err) {
    return { status: 'warn', detail: `Config parse error: ${err.message}` };
  }
}

// Check build status
function checkBuild() {
  const specmemRoot = getSpecmemRoot();
  const distFile = path.join(specmemRoot, 'dist', 'index.js');

  if (!fs.existsSync(distFile)) {
    return { status: 'fail', detail: "dist/index.js not found - run 'npm run build'" };
  }

  const stat = fs.statSync(distFile);
  const buildTime = stat.mtime;
  const ageMs = Date.now() - buildTime.getTime();
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  // Check if source is newer
  const srcDir = path.join(specmemRoot, 'src');
  if (fs.existsSync(srcDir)) {
    try {
      const result = execSync(`find "${srcDir}" -name "*.ts" -newer "${distFile}" 2>/dev/null | head -1`, { encoding: 'utf8' });
      if (result.trim()) {
        return { status: 'warn', detail: "Source newer than build - consider 'npm run build'" };
      }
    } catch {
      // find command failed, skip this check
    }
  }

  const buildTimeStr = buildTime.toISOString().replace('T', ' ').split('.')[0];
  if (ageDays > 7) {
    return { status: 'warn', detail: `dist/index.js is ${ageDays} days old (built: ${buildTimeStr})` };
  }

  return { status: 'pass', detail: `Up to date (built: ${buildTimeStr})` };
}

// Run full diagnostic
async function runFullDiagnostic(projectPath, jsonOutput) {
  const results = {
    timestamp: new Date().toISOString(),
    specmem_root: getSpecmemRoot(),
    project_path: projectPath,
    checks: {}
  };

  // PostgreSQL
  results.checks.postgresql = await checkPostgreSQL();

  // Embedding Socket
  results.checks.embedding_socket = checkEmbeddingSocket();

  // MCP Config
  results.checks.mcp_config = checkMCPConfig();

  // Build Status
  results.checks.build = checkBuild();

  // SpecMem Socket
  const socketPath = getSocketPath(projectPath);
  if (fs.existsSync(socketPath)) {
    try {
      const health = await checkHealth(socketPath, 'health');
      results.checks.specmem_instance = {
        status: 'pass',
        detail: `Running (PID: ${health.pid}, Uptime: ${health.uptimeHuman || 'unknown'})`
      };
    } catch (err) {
      results.checks.specmem_instance = { status: 'warn', detail: `Socket exists but not responding: ${err.message}` };
    }
  } else {
    results.checks.specmem_instance = { status: 'warn', detail: 'No running instance (start via Claude Code)' };
  }

  // Critical files
  const criticalFiles = ['bootstrap.cjs', 'package.json', 'specmem.env'];
  const missing = criticalFiles.filter(f => !fs.existsSync(path.join(getSpecmemRoot(), f)));
  if (missing.length === 0) {
    results.checks.critical_files = { status: 'pass', detail: 'All present' };
  } else {
    results.checks.critical_files = { status: 'fail', detail: `Missing: ${missing.join(', ')}` };
  }

  // Calculate overall status
  const statuses = Object.values(results.checks).map(c => c.status);
  results.critical_failed = statuses.includes('fail');

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
    return results.critical_failed ? 1 : 0;
  }

  // Pretty print
  log('\nSpecMem Full Diagnostic', colors.cyan);
  log('=' .repeat(60), colors.dim);
  log(`SpecMem Root: ${results.specmem_root}`, colors.dim);
  log(`Project Path: ${results.project_path}`, colors.dim);
  log('');

  const statusIcons = {
    pass: `${colors.green}[OK]${colors.reset}`,
    warn: `${colors.yellow}[!!]${colors.reset}`,
    fail: `${colors.red}[XX]${colors.reset}`
  };

  for (const [name, check] of Object.entries(results.checks)) {
    const displayName = name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    log(`${statusIcons[check.status]} ${displayName}: ${check.detail}`);
  }

  log('');
  log('-'.repeat(60), colors.dim);
  if (results.critical_failed) {
    log('Some critical checks failed - see above for details', colors.red);
  } else {
    log('All critical checks passed!', colors.green);
  }
  log('');

  return results.critical_failed ? 1 : 0;
}

async function checkHealth(socketPath, command = 'health') {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(socketPath)) {
      reject(new Error('Socket not found - SpecMem not running'));
      return;
    }

    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Health check timeout'));
    }, 5000);

    let buffer = '';

    socket.on('connect', () => {
      socket.write(command);
    });

    socket.on('data', (data) => {
      buffer += data.toString();
    });

    socket.on('end', () => {
      clearTimeout(timeout);
      try {
        const response = JSON.parse(buffer);
        resolve(response);
      } catch (e) {
        reject(new Error(`Invalid response: ${buffer}`));
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    socket.connect(socketPath);
  });
}

async function main() {
  const projectPath = getProjectPath();
  const socketPath = getSocketPath(projectPath);
  const jsonOutput = hasFlag('--json') || hasFlag('-j');
  const statsMode = hasFlag('--stats') || hasFlag('-s');
  const fullMode = hasFlag('--full') || hasFlag('-f');

  // Full diagnostic mode - run all checks
  if (fullMode) {
    const exitCode = await runFullDiagnostic(projectPath, jsonOutput);
    process.exit(exitCode);
  }

  if (!jsonOutput) {
    log(`\nSpecMem Health Check (Standalone)`, colors.cyan);
    log(`${'='.repeat(50)}`, colors.dim);
    log(`Project: ${projectPath}`, colors.dim);
    log(`Socket:  ${socketPath}`, colors.dim);
    log('');
  }

  try {
    const command = statsMode ? 'stats' : 'health';
    const response = await checkHealth(socketPath, command);

    if (jsonOutput) {
      console.log(JSON.stringify(response, null, 2));
      process.exit(response.status === 'running' ? 0 : 1);
    }

    if (response.status === 'running') {
      log(`Status: RUNNING`, colors.green);
      log(`PID:    ${response.pid}`);

      if (response.uptimeHuman) {
        log(`Uptime: ${response.uptimeHuman}`);
      } else if (response.uptime) {
        const hours = Math.floor(response.uptime / 3600);
        const mins = Math.floor((response.uptime % 3600) / 60);
        log(`Uptime: ${hours}h ${mins}m`);
      }

      if (response.memory) {
        if (response.memory.heapUsed !== undefined) {
          log(`Memory: ${response.memory.heapUsed}MB / ${response.memory.heapTotal}MB heap, ${response.memory.rss}MB RSS`);
        } else {
          const heapMB = Math.round(response.memory.heapUsed / 1024 / 1024);
          const rssMB = Math.round(response.memory.rss / 1024 / 1024);
          log(`Memory: ${heapMB}MB heap, ${rssMB}MB RSS`);
        }
      }

      if (response.version) {
        log(`Version: ${response.version}`);
      }

      if (response.nodeVersion) {
        log(`Node:   ${response.nodeVersion}`);
      }

      log('');
      log(`Health: OK`, colors.green);
      process.exit(0);
    } else {
      log(`Status: ${response.status}`, colors.yellow);
      process.exit(1);
    }
  } catch (err) {
    if (jsonOutput) {
      console.log(JSON.stringify({
        status: 'stopped',
        error: err.message
      }, null, 2));
      process.exit(1);
    }

    log(`Status: NOT RUNNING`, colors.red);
    log(`Error:  ${err.message}`, colors.dim);
    log('');
    log(`Tip: Run with --full flag for complete diagnostic`, colors.dim);
    log(`Health: FAILED`, colors.red);
    process.exit(1);
  }
}

// Show help
if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`
SpecMem Health Check CLI (Standalone - No PM2)

Usage:
  node specmem-health.cjs [project-path] [options]

Options:
  --full, -f     Run full diagnostic (DB, MCP config, build, sockets)
  --json, -j     Output JSON format
  --stats, -s    Get detailed stats from running instance
  --help, -h     Show this help

Examples:
  node specmem-health.cjs                    Check current directory
  node specmem-health.cjs /path/to/project   Check specific project
  node specmem-health.cjs --json             JSON output for scripting
  node specmem-health.cjs --stats            Detailed statistics
  node specmem-health.cjs --full             Full diagnostic (recommended for debugging)
  node specmem-health.cjs --full --json      Full diagnostic as JSON

Full diagnostic checks:
  - PostgreSQL connectivity (with pgvector detection)
  - Embedding socket availability
  - MCP configuration in ~/.claude.json
  - Build status (dist/index.js freshness)
  - Running SpecMem instance detection
  - Critical file presence

Exit codes:
  0  All critical checks pass / SpecMem running and healthy
  1  Critical checks failed / SpecMem not running or unhealthy
`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
