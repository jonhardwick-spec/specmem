#!/usr/bin/env node
/**
 * SpecMem Auto-Updater
 * Detects ALL global install locations and updates them all
 * Hardwick Software Services - https://justcalljon.pro
 */

const { execSync } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

const PACKAGE_NAME = 'specmem-hardwicksoftware';
const CURRENT_VERSION = require('../package.json').version;

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function rainbow(text) {
  const rainbowColors = ['\x1b[31m', '\x1b[33m', '\x1b[32m', '\x1b[36m', '\x1b[34m', '\x1b[35m'];
  let result = '';
  let colorIdx = 0;
  for (const char of text) {
    if (char === ' ') {
      result += char;
    } else {
      result += rainbowColors[colorIdx % rainbowColors.length] + char;
      colorIdx++;
    }
  }
  return result + '\x1b[0m';
}

/**
 * Discover ALL global install locations for the package.
 * Checks:
 *   1. `npm root -g` (npm's configured global)
 *   2. Common global prefixes (/usr/lib, /usr/local/lib, ~/.npm-global, etc.)
 *   3. Follows `which specmem` symlink back to its install root
 *   4. NVM / fnm paths if present
 * Returns array of { dir, version, isNpmDefault, isActive }
 */
function findAllInstallLocations() {
  const locations = new Map(); // dir -> { version, isNpmDefault, isActive }

  // 1. npm's configured global root
  try {
    const npmRoot = execSync('npm root -g 2>/dev/null', { encoding: 'utf8' }).trim();
    const pkgDir = path.join(npmRoot, PACKAGE_NAME);
    _probeLocation(locations, pkgDir, { isNpmDefault: true });
  } catch (_) {}

  // 2. Common global prefixes
  const commonPrefixes = [
    '/usr/lib/node_modules',
    '/usr/local/lib/node_modules',
    '/usr/share/node_modules',
    path.join(process.env.HOME || '/root', '.npm-global', 'lib', 'node_modules'),
    path.join(process.env.HOME || '/root', '.local', 'lib', 'node_modules'),
  ];

  // NVM paths
  if (process.env.NVM_DIR) {
    try {
      const nvmVersions = fs.readdirSync(path.join(process.env.NVM_DIR, 'versions', 'node'));
      for (const v of nvmVersions) {
        commonPrefixes.push(path.join(process.env.NVM_DIR, 'versions', 'node', v, 'lib', 'node_modules'));
      }
    } catch (_) {}
  }

  // fnm paths
  const fnmDir = process.env.FNM_DIR || path.join(process.env.HOME || '/root', '.fnm');
  try {
    if (fs.existsSync(path.join(fnmDir, 'node-versions'))) {
      const fnmVersions = fs.readdirSync(path.join(fnmDir, 'node-versions'));
      for (const v of fnmVersions) {
        commonPrefixes.push(path.join(fnmDir, 'node-versions', v, 'installation', 'lib', 'node_modules'));
      }
    }
  } catch (_) {}

  for (const prefix of commonPrefixes) {
    const pkgDir = path.join(prefix, PACKAGE_NAME);
    _probeLocation(locations, pkgDir, {});
  }

  // 3. Follow `which specmem` symlink to find the install root
  try {
    const binPath = execSync('which specmem 2>/dev/null', { encoding: 'utf8' }).trim();
    if (binPath) {
      const realPath = fs.realpathSync(binPath);
      // realPath is like /usr/local/lib/node_modules/specmem-hardwicksoftware/bin/specmem-cli.cjs
      // Walk up to find the package root
      let dir = path.dirname(realPath);
      for (let i = 0; i < 5; i++) {
        const pjson = path.join(dir, 'package.json');
        if (fs.existsSync(pjson)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pjson, 'utf8'));
            if (pkg.name === PACKAGE_NAME) {
              _probeLocation(locations, dir, { isActive: true });
              break;
            }
          } catch (_) {}
        }
        dir = path.dirname(dir);
      }
    }
  } catch (_) {}

  return Array.from(locations.entries()).map(([dir, info]) => ({ dir, ...info }));
}

function _probeLocation(map, pkgDir, flags) {
  try {
    const realDir = fs.realpathSync(pkgDir);
    if (map.has(realDir)) {
      // Merge flags
      const existing = map.get(realDir);
      if (flags.isNpmDefault) existing.isNpmDefault = true;
      if (flags.isActive) existing.isActive = true;
      return;
    }
    const pjson = path.join(realDir, 'package.json');
    if (!fs.existsSync(pjson)) return;
    const pkg = JSON.parse(fs.readFileSync(pjson, 'utf8'));
    if (pkg.name !== PACKAGE_NAME) return;
    map.set(realDir, {
      version: pkg.version,
      isNpmDefault: !!flags.isNpmDefault,
      isActive: !!flags.isActive,
    });
  } catch (_) {}
}

async function getLatestVersion() {
  try {
    const result = execSync(`npm view ${PACKAGE_NAME} version 2>/dev/null`, { encoding: 'utf8' });
    return result.trim();
  } catch (e) {
    return null;
  }
}

function versionToNumber(ver) {
  const parts = ver.split('.').map(Number);
  return parts[0] * 1000000 + (parts[1] || 0) * 1000 + (parts[2] || 0);
}

function compareVersions(current, latest) {
  const currentNum = versionToNumber(current);
  const latestNum = versionToNumber(latest);
  if (latestNum > currentNum) return 1;
  if (latestNum < currentNum) return -1;
  return 0;
}

function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().trim());
    });
  });
}

/**
 * Update all detected install locations.
 * Strategy:
 *   1. Run `npm install -g PACKAGE@version` (covers npm's default root)
 *   2. For any additional locations not covered by step 1, copy from
 *      the freshly-installed npm default location (rsync/cp -a)
 */
function updateAllLocations(targetVersion) {
  const locations = findAllInstallLocations();
  const results = { updated: [], failed: [], skipped: [] };

  // Step 1: npm install -g (handles npm's default global root)
  log('   Installing via npm...', 'cyan');
  try {
    execSync(`npm install -g ${PACKAGE_NAME}@${targetVersion}`, { stdio: 'pipe' });
  } catch (e) {
    log(`   npm install -g failed: ${e.message}`, 'red');
    results.failed.push({ dir: '(npm default)', error: e.message });
  }

  // Re-scan to find what npm installed and where
  const postInstall = findAllInstallLocations();
  const npmDefault = postInstall.find(l => l.isNpmDefault);

  if (!npmDefault) {
    log('   Could not find npm default install location after npm install -g', 'red');
    return results;
  }

  // Check if npm default is now at target version
  if (npmDefault.version === targetVersion) {
    results.updated.push(npmDefault.dir);
  }

  // Step 2: Sync any stale locations from the npm default
  for (const loc of postInstall) {
    if (loc.dir === npmDefault.dir) continue;
    if (loc.version === targetVersion) {
      results.skipped.push(loc.dir);
      continue;
    }

    log(`   Syncing ${colors.dim}${loc.dir}${colors.cyan} (was v${loc.version})...`, 'cyan');
    try {
      // Use rsync if available, fall back to cp
      try {
        execSync(`rsync -a --delete "${npmDefault.dir}/" "${loc.dir}/"`, { stdio: 'pipe' });
      } catch (_) {
        execSync(`cp -a "${npmDefault.dir}/." "${loc.dir}/"`, { stdio: 'pipe' });
      }
      results.updated.push(loc.dir);
    } catch (e) {
      log(`   Failed to sync ${loc.dir}: ${e.message}`, 'red');
      results.failed.push({ dir: loc.dir, error: e.message });
    }
  }

  return results;
}

async function checkForUpdates(silent = false) {
  if (!silent) {
    log('\n  Checking for SpecMem updates...', 'cyan');
  }

  const latestVersion = await getLatestVersion();

  if (!latestVersion) {
    if (!silent) log('  Could not check for updates (offline?)', 'yellow');
    return false;
  }

  // Scan all install locations
  const locations = findAllInstallLocations();

  // Find the oldest version among all locations
  let oldestVersion = CURRENT_VERSION;
  for (const loc of locations) {
    if (compareVersions(loc.version, oldestVersion) > 0) {
      // loc.version is older than oldestVersion? No — compareVersions returns 1 if second > first
      // We want the minimum version
    }
    if (versionToNumber(loc.version) < versionToNumber(oldestVersion)) {
      oldestVersion = loc.version;
    }
  }

  // Check if any location is out of sync (different versions)
  const versions = [...new Set(locations.map(l => l.version))];
  const outOfSync = versions.length > 1;

  const comparison = compareVersions(oldestVersion, latestVersion);

  if (comparison <= 0 && !outOfSync) {
    if (!silent) {
      log(`  You're running the latest version (v${CURRENT_VERSION})`, 'green');
    }
    return false;
  }

  // Show status
  console.log('\n' + rainbow('════════════════════════════════════════════════════════'));

  if (comparison > 0) {
    log(`\n  NEW VERSION AVAILABLE!`, 'bright');
    log(`   Current: v${oldestVersion}`, 'yellow');
    log(`   Latest:  v${latestVersion}`, 'green');
  }

  if (outOfSync) {
    log(`\n  INSTALL LOCATIONS OUT OF SYNC`, 'yellow');
    for (const loc of locations) {
      const marker = loc.isActive ? ' (active)' : loc.isNpmDefault ? ' (npm default)' : '';
      const vColor = loc.version === latestVersion ? 'green' : 'yellow';
      log(`   v${loc.version} ${colors.dim}${loc.dir}${colors[vColor]}${marker}`, vColor);
    }
  }

  console.log(rainbow('════════════════════════════════════════════════════════') + '\n');

  const targetVersion = comparison > 0 ? latestVersion : versions.sort((a, b) => versionToNumber(b) - versionToNumber(a))[0];
  const action = comparison > 0 ? 'update' : 'sync all locations';

  const answer = await askQuestion(`${colors.cyan}Would you like to ${action} to v${targetVersion}? (y/n): ${colors.reset}`);

  if (answer === 'y' || answer === 'yes') {
    log(`\n  Updating all locations to v${targetVersion}...`, 'cyan');
    const results = updateAllLocations(targetVersion);

    if (results.updated.length > 0) {
      log(`\n  Updated ${results.updated.length} location(s):`, 'green');
      for (const dir of results.updated) {
        log(`     ${dir}`, 'dim');
      }
    }
    if (results.skipped.length > 0) {
      log(`  ${results.skipped.length} location(s) already up to date`, 'green');
    }
    if (results.failed.length > 0) {
      log(`  ${results.failed.length} location(s) failed:`, 'red');
      for (const f of results.failed) {
        log(`     ${f.dir}: ${f.error}`, 'red');
      }
    }

    if (results.failed.length === 0) {
      log('\n  All SpecMem installations updated!', 'green');
      log('  Please restart your command to use the new version.\n', 'yellow');
      return true;
    }
    return false;
  } else {
    log('\n  Skipping update. Run "specmem update" anytime to update.\n', 'yellow');
    return false;
  }
}

/**
 * Sync all install locations to match the newest one.
 * Use after `npm install -g /specmem` (local dev install).
 * Does NOT hit the npm registry.
 */
function syncAllLocations(silent = false) {
  const locations = findAllInstallLocations();
  if (locations.length <= 1) {
    if (!silent) log('   Only one install location found, nothing to sync.', 'green');
    return { synced: 0, locations };
  }

  // Find the newest version
  locations.sort((a, b) => versionToNumber(b.version) - versionToNumber(a.version));
  const source = locations[0];
  let synced = 0;

  if (!silent) {
    log(`   Source: v${source.version} @ ${source.dir}`, 'cyan');
  }

  for (let i = 1; i < locations.length; i++) {
    const loc = locations[i];
    if (loc.version === source.version) {
      if (!silent) log(`   ${loc.dir} already at v${loc.version}`, 'green');
      continue;
    }
    if (!silent) log(`   Syncing ${loc.dir} (v${loc.version} -> v${source.version})...`, 'cyan');
    try {
      try {
        execSync(`rsync -a --delete "${source.dir}/" "${loc.dir}/"`, { stdio: 'pipe' });
      } catch (_) {
        execSync(`cp -a "${source.dir}/." "${loc.dir}/"`, { stdio: 'pipe' });
      }
      synced++;
      if (!silent) log(`   Synced.`, 'green');
    } catch (e) {
      if (!silent) log(`   Failed: ${e.message}`, 'red');
    }
  }

  return { synced, locations };
}

module.exports = {
  checkForUpdates,
  getLatestVersion,
  compareVersions,
  findAllInstallLocations,
  updateAllLocations,
  syncAllLocations,
  CURRENT_VERSION,
};

// If run directly
if (require.main === module) {
  checkForUpdates().then(() => process.exit(0));
}
