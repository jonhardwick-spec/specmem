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
 */
function expandCwd(val, cwd) {
  if (!val) return val;
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

module.exports = {
  findGlobalSpecmemPkg,
  expandCwd,
  getSpecmemPkg,
  getSpecmemHome,
  getProjectSocketDir,
  getEmbeddingSocket,
  SPECMEM_PKG: getSpecmemPkg(),
  SPECMEM_HOME: getSpecmemHome()
};
