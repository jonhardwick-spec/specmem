#!/usr/bin/env node
/**
 * GLOBAL INSTALL ENFORCER
 *
 * SpecMem MUST be installed globally (-g) because:
 * 1. It registers as an MCP server in  Code
 * 2. It installs system-wide hooks in ~/.claude/
 * 3. It provides global CLI commands (specmem, specmem-init, etc.)
 * 4. Local installs would break path resolution and hook registration
 *
 * This script runs on preinstall and blocks non-global installs.
 */

const path = require('path');

// Check if this is a global install
// npm sets npm_config_global=true for -g installs
const isGlobal = process.env.npm_config_global === 'true' ||
                 process.env.npm_config_global === '1';

// Also check the install path - global installs go to /usr/lib or similar
const installPath = process.env.npm_config_prefix || '';
const isGlobalPath = installPath.includes('/usr/lib') ||
                     installPath.includes('/usr/local') ||
                     installPath.includes('\\AppData\\Roaming\\npm') || // Windows
                     installPath.includes('.nvm/versions'); // nvm

// Check if we're in development mode (npm link, etc.)
const isDev = process.env.npm_lifecycle_event === 'preinstall' &&
              process.cwd().includes('/specmem');

// Skip check for npm link and development
if (isDev) {
  console.log('[SpecMem] Development mode detected - skipping global check');
  process.exit(0);
}

// Skip if npm pack or tarball install from local path
const npmCommand = process.env.npm_command || '';
if (npmCommand === 'pack') {
  console.log('[SpecMem] npm pack detected - skipping global check');
  process.exit(0);
}

if (!isGlobal && !isGlobalPath) {
  console.error(`
╔══════════════════════════════════════════════════════════════════╗
║                    ⚠️  GLOBAL INSTALL REQUIRED ⚠️                  ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  SpecMem MUST be installed globally with the -g flag:            ║
║                                                                  ║
║    npm install -g specmem-hardwicksoftware                       ║
║                                                                  ║
║  Why? SpecMem:                                                   ║
║    • Registers as a system-wide MCP server                       ║
║    • Installs hooks in ~/.claude/                                ║
║    • Provides global CLI commands                                ║
║                                                                  ║
║  Local installs will NOT work correctly.                         ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}

console.log('[SpecMem] Global install detected - proceeding with installation');
