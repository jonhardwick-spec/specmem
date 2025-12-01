/**
 * SPECMEM PATHS - Shared path resolution for hooks
 *
 * This module dynamically finds the global SpecMem installation,
 * allowing hooks to work regardless of where SpecMem is installed.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Find the global SpecMem package location dynamically
 * OPTIMIZED: Check fast paths FIRST before slow npm root -g (~115ms)
 */
function findGlobalSpecmemPkg() {
  // 1. Check if we're running from within the package itself
  const hookDir = __dirname;
  const possiblePkgRoot = path.dirname(hookDir);

  if (fs.existsSync(path.join(possiblePkgRoot, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(possiblePkgRoot, 'package.json'), 'utf8'));
      if (pkg.name === 'specmem-hardwicksoftware') {
        return possiblePkgRoot;
      }
    } catch (e) {}
  }

  // 2. Check common global locations FIRST (instant fs.existsSync - ~0ms)
  const commonPaths = [
    '/usr/lib/node_modules/specmem-hardwicksoftware',
    '/usr/local/lib/node_modules/specmem-hardwicksoftware',
    path.join(os.homedir(), '.npm-global/lib/node_modules/specmem-hardwicksoftware'),
    path.join(os.homedir(), 'node_modules/specmem-hardwicksoftware'),
    '/specmem'  // Docker/dev fallback
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }

  // 3. Check file-based cache for npm root -g result (avoids 115ms spawn per hook call)
  const cacheFile = path.join(os.tmpdir(), 'specmem-npm-root-cache.txt');
  try {
    if (fs.existsSync(cacheFile)) {
      const stat = fs.statSync(cacheFile);
      const ageMs = Date.now() - stat.mtimeMs;
      // Cache valid for 1 hour
      if (ageMs < 3600000) {
        const cachedRoot = fs.readFileSync(cacheFile, 'utf8').trim();
        const globalPkg = path.join(cachedRoot, 'specmem-hardwicksoftware');
        if (fs.existsSync(globalPkg)) {
          return globalPkg;
        }
      }
    }
  } catch (e) {}

  // 4. SLOW PATH: npm root -g (~115ms) - only if all else fails
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8', timeout: 5000 }).trim();
    // Cache the result for future calls
    try { fs.writeFileSync(cacheFile, globalRoot); } catch (e) {}
    const globalPkg = path.join(globalRoot, 'specmem-hardwicksoftware');
    if (fs.existsSync(globalPkg)) {
      return globalPkg;
    }
  } catch (e) {}

  // 5. Ultimate fallback
  return process.cwd();
}

/**
 * Expand ${cwd} placeholders in env vars
 * Handles: null, undefined, non-string values, ${cwd}, and $cwd patterns
 */
function expandCwd(val, cwd) {
  if (!val) return val;
  // Handle non-string values (numbers, objects, etc.)
  if (typeof val !== 'string') return val;
  const cwdPath = cwd || process.cwd();
  return val.replace(/\$\{cwd\}/g, cwdPath).replace(/\$cwd/g, cwdPath);
}

// Cache the package path
let _cachedPkgPath = null;

function getSpecmemPkg() {
  if (!_cachedPkgPath) {
    _cachedPkgPath = process.env.SPECMEM_PKG
      ? expandCwd(process.env.SPECMEM_PKG)
      : findGlobalSpecmemPkg();
  }
  return _cachedPkgPath;
}

function getSpecmemHome() {
  return process.env.SPECMEM_HOME
    ? expandCwd(process.env.SPECMEM_HOME)
    : path.join(os.homedir(), '.specmem');
}

function getProjectSocketDir(projectPath) {
  return path.join(projectPath || process.cwd(), 'specmem', 'sockets');
}

function getEmbeddingSocket(projectPath) {
  return path.join(getProjectSocketDir(projectPath), 'embeddings.sock');
}

/**
 * Load pg classes from specmem package - hooks need these but pg isn't in ~/.claude/hooks/
 * Provides both Pool (for connection pooling) and Client (for single connections)
 */
let Pool = null;
let Client = null;
let pgModule = null;

function loadPgModule() {
  if (pgModule) return pgModule;
  const pkgPath = getSpecmemPkg();

  // Try loading from specmem package node_modules
  try {
    pgModule = require(path.join(pkgPath, 'node_modules/pg'));
    return pgModule;
  } catch {}

  // Try global pg
  try {
    pgModule = require('pg');
    return pgModule;
  } catch {}

  return null;
}

/**
 * Get pg.Pool class for connection pooling
 * Usage: const pool = new Pool(config); pool.query(...);
 */
function getPool() {
  if (Pool) return Pool;
  const pg = loadPgModule();
  if (pg) {
    Pool = pg.Pool;
  }
  return Pool;
}

/**
 * Get pg.Client class for single connections
 * Usage: const client = new Client(config); await client.connect(); await client.query(...); await client.end();
 */
function getClient() {
  if (Client) return Client;
  const pg = loadPgModule();
  if (pg) {
    Client = pg.Client;
  }
  return Client;
}

/**
 * Read stdin with timeout (CRIT-07 fix - prevents hook hangs)
 */
function readStdinWithTimeout(timeoutMs = 5000) {
  return new Promise((resolve) => {
    let input = '';
    const timer = setTimeout(() => {
      process.stdin.destroy();
      resolve(input);
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(input);
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      resolve(input);
    });
  });
}

/**
 * Get project schema name from path
 */
function getSchemaName(projectPath) {
  if (!projectPath || projectPath === '/') return 'public';
  const dirName = path.basename(projectPath).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return 'specmem_' + dirName;
}

module.exports = {
  findGlobalSpecmemPkg,
  expandCwd,
  getSpecmemPkg,
  getSpecmemHome,
  getProjectSocketDir,
  getEmbeddingSocket,
  getPool,
  getClient,
  getSchemaName,
  readStdinWithTimeout,
  SPECMEM_PKG: getSpecmemPkg(),
  SPECMEM_HOME: getSpecmemHome()
};
