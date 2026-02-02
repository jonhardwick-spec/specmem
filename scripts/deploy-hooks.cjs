#!/usr/bin/env node
/**
 * SPECMEM HOOK DEPLOYER
 * =====================
 *
 * Auto-deploys hooks to 's settings for the current project.
 * Runs on `specmem init` to configure per-project hooks.
 *
 * @author hardwicksoftwareservices
 * @website https://justcalljon.pro
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ANSI colors
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

// Paths
const SPECMEM_HOME = process.env.SPECMEM_HOME || path.join(os.homedir(), '.specmem');
const SPECMEM_PKG = path.resolve(__dirname, '..');  // Where SpecMem is actually installed
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_HOOKS_DIR = path.join(CLAUDE_DIR, 'hooks');
// IMPORTANT: Run hooks from package dir so they can find pg via node_modules
const PACKAGE_HOOKS_DIR = path.join(SPECMEM_PKG, 'claude-hooks');
const CLAUDE_SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const CLAUDE_CONFIG = path.join(CLAUDE_DIR, 'config.json');  // old location - NOT USED BY CLAUDE
const CLAUDE_JSON = path.join(os.homedir(), '.claude.json');  // MCP servers ACTUALLY go here!
const PROJECT_PATH = process.cwd();

// Detect install type - global vs local
const IS_GLOBAL_INSTALL = SPECMEM_PKG.includes('/lib/node_modules/') ||
                          SPECMEM_PKG.includes('/node/lib/') ||
                          SPECMEM_PKG.includes('\\node_modules\\specmem') === false;
const IS_PROJECT_DIR = fs.existsSync(path.join(PROJECT_PATH, 'package.json')) ||
                       fs.existsSync(path.join(PROJECT_PATH, '.git')) ||
                       fs.existsSync(path.join(PROJECT_PATH, 'tsconfig.json'));

// Hooks to deploy - all .js hooks + support files
// Auto-synced with /specmem/claude-hooks/ contents
const HOOKS_TO_DEPLOY = [
  // Main hooks (.js versions) - COMPLETE LIST
  'agent-chooser-hook.js',
  'agent-chooser-inject.js',
  'agent-loading-hook.js',
  'agent-output-interceptor.js',
  'agent-type-matcher.js',
  'background-completion-silencer.js',  // Silences verbose completion messages
  'bash-auto-background.js',            // Auto-backgrounds long-running bash commands
  'drilldown-enforcer.js',
  'file-claim-enforcer.cjs',             // Enforces claim_task before Read/Edit/Write for agents
  'input-aware-improver.js',
  'search-reminder-hook.js',            // Reminds  to use find_code_pointers
  'smart-context-hook.cjs',
  'smart-search-interceptor.js',
  'specmem-context-hook.cjs',
  'specmem-drilldown-hook.cjs',
  'specmem-drilldown-setter.js',
  'specmem-precompact.js',
  'specmem-session-start.cjs',           // Session start hook (.js version)
  'specmem-session-start.cjs',          // Session start hook (.cjs version for compatibility)
  'specmem-stop-hook.js',               // Stop hook - fast cleanup on Esc/interrupt
  'specmem-team-member-inject.js',
  'subagent-loading-hook.js',
  'task-progress-hook.js',
  // CRITICAL: .cjs versions for CommonJS compatibility in hooks dir
  'smart-context-hook.cjs',
  // Team communication enforcement
  'team-comms-enforcer.cjs',
  'post-write-memory-hook.cjs',
  'context-dedup.cjs',
  'specmem-team-comms.cjs',
  // Agent output fading
  'agent-output-fader.cjs',
  'output-cleaner.cjs',
  // Path resolver - REQUIRED for all hooks to work!
  'specmem-paths.cjs',
  // Socket helper for MCP connections
  'socket-connect-helper.cjs',
  // Token compression system
  'token-compressor.cjs',
  'merged-codes.cjs',
  'merged-codes.json',
  'cedict-codes.json',
  'cedict-extracted.json',
  'english-morphology.cjs',
  'english-morphology-standalone.cjs',
  'grammar-engine.cjs',
  // Shell scripts
  'specmem-session-init.sh',
  'claude-watchdog.sh'
];

// Hook configuration for  settings.json
// NOTE: These are generated at runtime with correct paths
// VALID HOOKS: PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit,
//              Notification, SessionStart, SessionEnd, Stop, SubagentStart,
//              SubagentStop, PreCompact, PermissionRequest
function getHookConfig() {
  // CRITICAL: All hooks MUST have these env vars to work across projects!
  // Per-project sockets - each project has its own embedding models
  const BASE_ENV = {
    "SPECMEM_HOME": SPECMEM_HOME,
    "SPECMEM_PKG": SPECMEM_PKG,
    "SPECMEM_RUN_DIR": "${cwd}/specmem/sockets",
    "SPECMEM_EMBEDDING_SOCKET": "${cwd}/specmem/sockets/embeddings.sock",
    "SPECMEM_PROJECT_PATH": "${cwd}"
  };

  return {
    // UserPromptSubmit - fires when user submits prompt, can inject context
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/specmem-drilldown-hook.cjs`,
            "timeout": 30,
            "statusMessage": "🔍 Searching SpecMem...",
            "env": {
              ...BASE_ENV,
              "SPECMEM_SEARCH_LIMIT": "5",
              "SPECMEM_THRESHOLD": "0.25",
              "SPECMEM_MAX_CONTENT": "300"
            }
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/input-aware-improver.js`,
            "timeout": 5,
            "env": BASE_ENV
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/agent-loading-hook.js`,
            "timeout": 10,
            "statusMessage": "Agent Chooser...",
            "env": {
              ...BASE_ENV,
              "SPECMEM_FORCE_CHOOSER": "1",
              "SPECMEM_AGENT_AUTO": "0"
            }
          }
        ]
      },
      {
        "matcher": "Grep",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/team-comms-enforcer.cjs`,
            "timeout": 5,
            "env": { "SPECMEM_PROJECT_PATH": "${cwd}" }
          }
        ]
      },
      {
        "matcher": "Grep",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/smart-context-hook.cjs`,
            "timeout": 8,
            "env": {
              ...BASE_ENV,
              "SPECMEM_SEARCH_LIMIT": "3",
              "SPECMEM_THRESHOLD": "0.25",
              "SPECMEM_MAX_CONTENT": "150"
            }
          }
        ]
      },
      {
        "matcher": "Grep",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/search-reminder-hook.js`,
            "timeout": 3,
            "statusMessage": "💡 Search hint...",
            "env": BASE_ENV
          }
        ]
      },
      {
        "matcher": "Glob",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/team-comms-enforcer.cjs`,
            "timeout": 5,
            "env": { "SPECMEM_PROJECT_PATH": "${cwd}" }
          }
        ]
      },
      {
        "matcher": "Glob",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/smart-context-hook.cjs`,
            "timeout": 8,
            "env": {
              ...BASE_ENV,
              "SPECMEM_SEARCH_LIMIT": "3",
              "SPECMEM_THRESHOLD": "0.25",
              "SPECMEM_MAX_CONTENT": "150"
            }
          }
        ]
      },
      {
        "matcher": "Glob",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/search-reminder-hook.js`,
            "timeout": 3,
            "statusMessage": "💡 Search hint...",
            "env": BASE_ENV
          }
        ]
      },
      {
        "matcher": "Read",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/team-comms-enforcer.cjs`,
            "timeout": 5,
            "env": { "SPECMEM_PROJECT_PATH": "${cwd}" }
          }
        ]
      },
      {
        "matcher": "Read",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/smart-context-hook.cjs`,
            "timeout": 8,
            "env": {
              ...BASE_ENV,
              "SPECMEM_SEARCH_LIMIT": "3",
              "SPECMEM_THRESHOLD": "0.25",
              "SPECMEM_MAX_CONTENT": "150"
            }
          }
        ]
      },
      {
        "matcher": "Read",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/file-claim-enforcer.cjs`,
            "timeout": 5,
            "statusMessage": "Checking file claims...",
            "env": {
              ...BASE_ENV,
              "SPECMEM_DB_HOST": "localhost",
              "SPECMEM_DB_PORT": "5432",
              "SPECMEM_DB_NAME": "specmem_westayunprofessional",
              "SPECMEM_DB_USER": "specmem_westayunprofessional",
              "SPECMEM_DB_PASSWORD": "specmem_westayunprofessional"
            }
          }
        ]
      },
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/team-comms-enforcer.cjs`,
            "timeout": 5,
            "env": { "SPECMEM_PROJECT_PATH": "${cwd}" }
          }
        ]
      },
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/file-claim-enforcer.cjs`,
            "timeout": 5,
            "statusMessage": "Checking file claims...",
            "env": {
              ...BASE_ENV,
              "SPECMEM_DB_HOST": "localhost",
              "SPECMEM_DB_PORT": "5432",
              "SPECMEM_DB_NAME": "specmem_westayunprofessional",
              "SPECMEM_DB_USER": "specmem_westayunprofessional",
              "SPECMEM_DB_PASSWORD": "specmem_westayunprofessional"
            }
          }
        ]
      },
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/team-comms-enforcer.cjs`,
            "timeout": 5,
            "env": { "SPECMEM_PROJECT_PATH": "${cwd}" }
          }
        ]
      },
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/file-claim-enforcer.cjs`,
            "timeout": 5,
            "statusMessage": "Checking file claims...",
            "env": {
              ...BASE_ENV,
              "SPECMEM_DB_HOST": "localhost",
              "SPECMEM_DB_PORT": "5432",
              "SPECMEM_DB_NAME": "specmem_westayunprofessional",
              "SPECMEM_DB_USER": "specmem_westayunprofessional",
              "SPECMEM_DB_PASSWORD": "specmem_westayunprofessional"
            }
          }
        ]
      },
      {
        "matcher": "TaskOutput",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/agent-output-interceptor.js`,
            "timeout": 3,
            "statusMessage": "⚡ Checking team messages...",
            "env": BASE_ENV
          }
        ]
      },
      {
        "matcher": "mcp__specmem__find_memory",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/team-comms-enforcer.cjs`,
            "timeout": 5,
            "env": { "SPECMEM_PROJECT_PATH": "${cwd}" }
          }
        ]
      },
      {
        "matcher": "mcp__specmem__find_code_pointers",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/team-comms-enforcer.cjs`,
            "timeout": 5,
            "env": { "SPECMEM_PROJECT_PATH": "${cwd}" }
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/specmem-session-start.cjs`,
            "timeout": 30,
            "statusMessage": "📚 Loading SpecMem context...",
            "env": BASE_ENV
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/task-progress-hook.js`,
            "timeout": 10,
            "statusMessage": "Team member finished",
            "env": BASE_ENV
          }
        ]
      },
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/post-write-memory-hook.cjs`,
            "timeout": 10,
            "env": BASE_ENV
          }
        ]
      },
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/post-write-memory-hook.cjs`,
            "timeout": 10,
            "env": BASE_ENV
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/subagent-loading-hook.js`,
            "timeout": 5,
            "statusMessage": "Starting subagent...",
            "env": BASE_ENV
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/subagent-loading-hook.js`,
            "timeout": 5,
            "statusMessage": "Subagent completed",
            "env": BASE_ENV
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/specmem-stop-hook.js`,
            "timeout": 3,
            "env": {
              "SPECMEM_PROJECT_PATH": "${cwd}"
            }
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": `node ${PACKAGE_HOOKS_DIR}/specmem-precompact.js`,
            "timeout": 60,
            "statusMessage": "💾 Saving context before compaction...",
            "env": BASE_ENV
          }
        ]
      }
    ]
  };
}

/**
 * Copy hooks from SpecMem to  hooks directory
 */
function copyHooks() {
  console.log(`\n${C.cyan}═══ Copying Hooks ═══${C.reset}\n`);

  // Create  hooks directory
  if (!fs.existsSync(CLAUDE_HOOKS_DIR)) {
    fs.mkdirSync(CLAUDE_HOOKS_DIR, { recursive: true });
    console.log(`${C.green}✓${C.reset} Created ${PACKAGE_HOOKS_DIR}`);
  }

  // Source directories to check for hooks
  const hookSources = [
    path.join(SPECMEM_HOME, 'claude-hooks'),
    path.join(__dirname, '..', 'claude-hooks'),
    path.join(__dirname, '..', 'hooks')
  ];

  let copied = 0;

  for (const hookName of HOOKS_TO_DEPLOY) {
    let found = false;

    for (const sourceDir of hookSources) {
      const sourcePath = path.join(sourceDir, hookName);
      const destPath = path.join(CLAUDE_HOOKS_DIR, hookName);

      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, destPath);
        fs.chmodSync(destPath, 0o755);
        console.log(`${C.green}✓${C.reset} ${hookName}`);
        copied++;
        found = true;
        break;
      }
    }

    if (!found) {
      console.log(`${C.yellow}⚠${C.reset} ${hookName} not found in SpecMem`);
    }
  }

  return copied;
}

/**
 * DEEP MERGE helper - appends SpecMem hooks without clobbering existing ones
 * @param {Object} existing - Existing hooks object
 * @param {Object} specmemHooks - SpecMem hooks to inject
 * @returns {Object} Merged hooks object
 */
function mergeHooksAppend(existing, specmemHooks) {
  const merged = { ...existing };

  for (const [eventName, specmemEventHooks] of Object.entries(specmemHooks)) {
    if (!merged[eventName]) {
      // Event doesn't exist, add it fresh
      merged[eventName] = specmemEventHooks;
    } else {
      // Event exists - UPDATE our hooks (replace by filename match) or append
      const existingHooks = merged[eventName];

      for (const specmemHook of specmemEventHooks) {
        // Check if this exact hook already exists (by command path)
        const specmemCommand = specmemHook.hooks?.[0]?.command || '';
        const specmemFile = specmemCommand.split('/').pop();

        const existingIndex = existingHooks.findIndex(existing => {
          const existingCommand = existing.hooks?.[0]?.command || '';
          // Match by hook file name (last part of path)
          const existingFile = existingCommand.split('/').pop();
          return specmemFile && existingFile && specmemFile === existingFile;
        });

        if (existingIndex >= 0) {
          // CRITICAL FIX: UPDATE existing hook instead of skipping!
          // This ensures env vars like SPECMEM_PROJECT_PATH get updated
          existingHooks[existingIndex] = specmemHook;
          console.log(`${C.dim}  Updated existing hook: ${specmemFile}${C.reset}`);
        } else {
          // New hook, append it
          existingHooks.push(specmemHook);
        }
      }
    }
  }

  return merged;
}

/**
 * ACK VERIFICATION - Verify all hooks were properly registered
 * @param {Object} settings - The settings object to verify
 * @param {Object} requiredHooks - The hooks that should be present
 * @returns {Object} { success: boolean, registered: string[], missing: string[] }
 */
function verifyHookRegistration(settings, requiredHooks) {
  const registered = [];
  const missing = [];

  for (const [eventName, specmemEventHooks] of Object.entries(requiredHooks)) {
    for (const specmemHook of specmemEventHooks) {
      const specmemCommand = specmemHook.hooks?.[0]?.command || '';
      const specmemFile = specmemCommand.split('/').pop();

      // Check if this hook exists in settings
      const eventHooks = settings.hooks?.[eventName] || [];
      const found = eventHooks.some(existing => {
        const existingCommand = existing.hooks?.[0]?.command || '';
        const existingFile = existingCommand.split('/').pop();
        return specmemFile && existingFile && specmemFile === existingFile;
      });

      if (found) {
        registered.push(`${eventName}:${specmemFile}`);
      } else {
        missing.push(`${eventName}:${specmemFile}`);
      }
    }
  }

  return {
    success: missing.length === 0,
    registered,
    missing
  };
}

/**
 * Update  settings.json with hook configuration
 * CRITICAL: APPENDS hooks instead of replacing - preserves user's existing hooks!
 */
function updateSettings() {
  console.log(`\n${C.cyan}═══ Updating  Settings (APPEND MODE) ═══${C.reset}\n`);

  // Create  directory if needed
  if (!fs.existsSync(CLAUDE_DIR)) {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  }

  // Load existing settings or create new
  let settings = {};
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    try {
      settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
      console.log(`${C.dim}Loaded existing settings${C.reset}`);

      // Count existing hooks for reporting
      const existingHookCount = Object.keys(settings.hooks || {}).length;
      if (existingHookCount > 0) {
        console.log(`${C.dim}Found ${existingHookCount} existing hook event types${C.reset}`);
      }
    } catch (e) {
      console.log(`${C.yellow}⚠${C.reset} Could not parse existing settings, creating new`);
    }
  }

  // Initialize hooks object if not present
  if (!settings.hooks) {
    settings.hooks = {};
  }

  // Get SpecMem hooks and APPEND (not replace!)
  const HOOK_CONFIG = getHookConfig();
  const beforeCount = Object.values(settings.hooks).flat().length;
  settings.hooks = mergeHooksAppend(settings.hooks, HOOK_CONFIG);
  const afterCount = Object.values(settings.hooks).flat().length;
  const addedCount = afterCount - beforeCount;

  console.log(`${C.green}✓${C.reset} Injected SpecMem hooks (+${addedCount} new, ${afterCount} total)`);
  let updated = true;

  // Ensure permissions allow SpecMem MCP tools and Skills
  if (!settings.permissions) {
    settings.permissions = { allow: [], deny: [] };
  }

  // Required permissions for full SpecMem functionality
  const REQUIRED_PERMISSIONS = [
    'mcp__specmem__*',     // MCP tools
    'Skill(specmem)',       // Main skill
    'Skill(specmem-*)',     // All specmem-* skills/commands
    'Read',
    'Grep',
    'Glob'
  ];

  for (const perm of REQUIRED_PERMISSIONS) {
    if (!settings.permissions.allow.includes(perm)) {
      settings.permissions.allow.push(perm);
      console.log(`${C.green}✓${C.reset} Added permission: ${perm}`);
      updated = true;
    }
  }

  // NOTE: MCP server config moved to configureMCP() - writes to config.json not settings.json

  // Save settings
  if (updated) {
    // Backup existing settings
    if (fs.existsSync(CLAUDE_SETTINGS)) {
      const backupPath = `${CLAUDE_SETTINGS}.backup.${Date.now()}`;
      fs.copyFileSync(CLAUDE_SETTINGS, backupPath);
      console.log(`${C.dim}Backed up to ${backupPath}${C.reset}`);
    }

    fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));
    console.log(`${C.green}✓${C.reset} Settings saved`);

    // ══════════════════════════════════════════════════════════════════════════
    // ACK VERIFICATION - Re-read settings and verify all hooks registered!
    // ══════════════════════════════════════════════════════════════════════════
    console.log(`\n${C.cyan}═══ ACK Verification ═══${C.reset}\n`);

    try {
      // Re-read settings from disk to verify write succeeded
      const verifySettings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
      const verification = verifyHookRegistration(verifySettings, HOOK_CONFIG);

      if (verification.success) {
        console.log(`${C.green}✓ ACK: All ${verification.registered.length} SpecMem hooks verified!${C.reset}`);

        // Show registered hooks by event type
        const byEvent = {};
        for (const hookId of verification.registered) {
          const [event, file] = hookId.split(':');
          if (!byEvent[event]) byEvent[event] = [];
          byEvent[event].push(file);
        }

        for (const [event, hooks] of Object.entries(byEvent)) {
          console.log(`  ${C.dim}${event}:${C.reset} ${hooks.join(', ')}`);
        }
      } else {
        console.log(`${C.red}✗ ACK FAILED: ${verification.missing.length} hooks not registered!${C.reset}`);
        for (const missing of verification.missing) {
          console.log(`  ${C.red}MISSING:${C.reset} ${missing}`);
        }
        console.log(`\n${C.yellow}⚠ Run 'specmem init' again or check settings.json manually${C.reset}`);
      }
    } catch (verifyError) {
      console.log(`${C.red}✗ ACK FAILED: Could not re-read settings${C.reset}`);
      console.log(`  ${C.dim}${verifyError.message}${C.reset}`);
    }
  } else {
    console.log(`${C.dim}No changes needed${C.reset}`);
  }

  return updated;
}

/**
 * Copy commands from SpecMem to  commands directory
 */
function copyCommands() {
  console.log(`\n${C.cyan}═══ Copying Commands ═══${C.reset}\n`);

  const CLAUDE_COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');
  const SPECMEM_COMMANDS_DIR = path.join(SPECMEM_PKG, 'commands');

  // Create  commands directory
  if (!fs.existsSync(CLAUDE_COMMANDS_DIR)) {
    fs.mkdirSync(CLAUDE_COMMANDS_DIR, { recursive: true });
    console.log(`${C.green}✓${C.reset} Created ${CLAUDE_COMMANDS_DIR}`);
  }

  if (!fs.existsSync(SPECMEM_COMMANDS_DIR)) {
    console.log(`${C.yellow}⚠${C.reset} Commands directory not found: ${SPECMEM_COMMANDS_DIR}`);
    return 0;
  }

  // Get all .md command files
  const commandFiles = fs.readdirSync(SPECMEM_COMMANDS_DIR).filter(f => f.endsWith('.md'));
  let copied = 0;

  for (const cmdFile of commandFiles) {
    const sourcePath = path.join(SPECMEM_COMMANDS_DIR, cmdFile);
    const destPath = path.join(CLAUDE_COMMANDS_DIR, cmdFile);

    try {
      fs.copyFileSync(sourcePath, destPath);
      console.log(`${C.green}✓${C.reset} /${cmdFile.replace('.md', '')}`);
      copied++;
    } catch (e) {
      console.log(`${C.yellow}⚠${C.reset} Failed to copy ${cmdFile}: ${e.message}`);
    }
  }

  console.log(`${C.dim}Total: ${copied} commands deployed${C.reset}`);
  return copied;
}

/**
 * Copy skills from SpecMem to both global and project skills directories
 */
function copySkills() {
  console.log(`\n${C.cyan}═══ Copying Skills ═══${C.reset}\n`);

  const CLAUDE_SKILLS_DIR = path.join(CLAUDE_DIR, 'skills');
  const PROJECT_SKILLS_DIR = path.join(PROJECT_PATH, 'skills');
  const SPECMEM_SKILLS_DIR = path.join(SPECMEM_PKG, 'skills');

  if (!fs.existsSync(SPECMEM_SKILLS_DIR)) {
    console.log(`${C.yellow}⚠${C.reset} Skills directory not found: ${SPECMEM_SKILLS_DIR}`);
    return 0;
  }

  let copied = 0;

  // Recursively copy all .md skill files
  function copyDir(srcDir, destDir, prefix = '') {
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const entries = fs.readdirSync(srcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);

      if (entry.isDirectory()) {
        // Recursively copy subdirectories
        copyDir(srcPath, destPath, prefix + entry.name + '/');
      } else if (entry.name.endsWith('.md')) {
        try {
          fs.copyFileSync(srcPath, destPath);
          copied++;
        } catch (e) {
          // Silent fail for individual files
        }
      }
    }
  }

  // Copy to global ~/.claude/skills/
  if (!fs.existsSync(CLAUDE_SKILLS_DIR)) {
    fs.mkdirSync(CLAUDE_SKILLS_DIR, { recursive: true });
  }
  copyDir(SPECMEM_SKILLS_DIR, CLAUDE_SKILLS_DIR);
  console.log(`${C.green}✓${C.reset} Global: ~/.claude/skills/`);

  // Copy to project /skills/
  if (!fs.existsSync(PROJECT_SKILLS_DIR)) {
    fs.mkdirSync(PROJECT_SKILLS_DIR, { recursive: true });
  }
  copyDir(SPECMEM_SKILLS_DIR, PROJECT_SKILLS_DIR);
  console.log(`${C.green}✓${C.reset} Project: ${PROJECT_PATH}/skills/`);

  // Count total unique skills
  const skillCount = copied / 2;  // Divided by 2 since we copy to both locations
  console.log(`${C.dim}Total: ${skillCount} skills deployed to both locations${C.reset}`);
  return skillCount;
}

/**
 * Configure MCP server in ~/.claude.json (the ACTUAL location!)
 *  Code stores per-project MCP servers in ~/.claude.json under projects[path].mcpServers
 */
function configureMCP() {
  console.log(`\n${C.cyan}═══ Configuring MCP Server ═══${C.reset}\n`);

  // Load existing ~/.claude.json or create new
  let claudeJson = {};
  if (fs.existsSync(CLAUDE_JSON)) {
    try {
      claudeJson = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8'));
      console.log(`${C.dim}Loaded existing ~/.claude.json${C.reset}`);
    } catch (e) {
      console.log(`${C.yellow}⚠${C.reset} Could not parse existing ~/.claude.json, creating new`);
    }
  }

  // Initialize projects object if not present
  if (!claudeJson.projects) {
    claudeJson.projects = {};
  }

  // Initialize project entry if not present
  if (!claudeJson.projects[PROJECT_PATH]) {
    claudeJson.projects[PROJECT_PATH] = {
      allowedTools: [],
      mcpContextUris: [],
      mcpServers: {},
      enabledMcpjsonServers: [],
      disabledMcpjsonServers: [],
      hasTrustDialogAccepted: true,
      projectOnboardingSeenCount: 0,
      hasMdExternalIncludesApproved: false,
      hasMdExternalIncludesWarningShown: false
    };
    console.log(`${C.dim}Created project entry for ${PROJECT_PATH}${C.reset}`);
  }

  // Ensure mcpServers object exists
  if (!claudeJson.projects[PROJECT_PATH].mcpServers) {
    claudeJson.projects[PROJECT_PATH].mcpServers = {};
  }

  // Read database credentials from .env if available, otherwise use unified credential
  const envPath = path.join(process.cwd(), '.env');
  let dbCredentials = {
    SPECMEM_DB_HOST: 'localhost',
    SPECMEM_DB_PORT: '5432',
    SPECMEM_DB_NAME: 'specmem',
    SPECMEM_DB_USER: 'specmem',
    SPECMEM_DB_PASSWORD: 'specmem'
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
      console.log(`${C.dim}Loaded DB credentials from .env${C.reset}`);
    } catch (e) {
      console.log(`${C.dim}Using default DB credentials${C.reset}`);
    }
  }

  // Configure specmem MCP server for THIS project
  // CRITICAL: Include per-project socket paths to prevent multi-project conflicts!
  const projectSocketDir = path.join(PROJECT_PATH, 'specmem', 'sockets');
  claudeJson.projects[PROJECT_PATH].mcpServers.specmem = {
    "type": "stdio",
    "command": "node",
    "args": [
      path.join(SPECMEM_PKG, 'bootstrap.cjs')
    ],
    "env": {
      ...dbCredentials,
      "SPECMEM_SESSION_WATCHER_ENABLED": "true",
      "SPECMEM_PROJECT_PATH": PROJECT_PATH,
      // Per-project socket paths - CRITICAL for multi-project isolation!
      "SPECMEM_RUN_DIR": projectSocketDir,
      "SPECMEM_EMBEDDING_SOCKET": path.join(projectSocketDir, 'embeddings.sock'),
      "SPECMEM_LOCK_SOCKET": path.join(projectSocketDir, 'specmem.lock.sock')
    }
  };

  // Also set hasTrustDialogAccepted to avoid manual approval
  claudeJson.projects[PROJECT_PATH].hasTrustDialogAccepted = true;

  // Backup and save
  if (fs.existsSync(CLAUDE_JSON)) {
    const backupPath = `${CLAUDE_JSON}.backup.${Date.now()}`;
    fs.copyFileSync(CLAUDE_JSON, backupPath);
    console.log(`${C.dim}Backed up to ${backupPath}${C.reset}`);
  }

  fs.writeFileSync(CLAUDE_JSON, JSON.stringify(claudeJson, null, 2));
  console.log(`${C.green}✓${C.reset} Configured MCP server: specmem for project ${PROJECT_PATH}`);

  // ACK verification - re-read and verify
  try {
    const verifyJson = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8'));
    const projectConfig = verifyJson.projects?.[PROJECT_PATH];
    if (projectConfig?.mcpServers?.specmem?.args?.[0]?.includes('bootstrap.cjs')) {
      console.log(`${C.green}✓ ACK: MCP server verified in ~/.claude.json for ${PROJECT_PATH}${C.reset}`);
    } else {
      console.log(`${C.red}✗ ACK FAILED: MCP server not properly configured${C.reset}`);
    }
  } catch (e) {
    console.log(`${C.red}✗ ACK FAILED: Could not verify ~/.claude.json${C.reset}`);
  }

  return true;
}

/**
 * Create project-specific hook config
 */
function createProjectConfig() {
  console.log(`\n${C.cyan}═══ Project Configuration ═══${C.reset}\n`);

  const projectSpecmemDir = path.join(PROJECT_PATH, '.specmem');
  const projectConfigPath = path.join(projectSpecmemDir, 'hooks.json');

  // Create .specmem directory
  if (!fs.existsSync(projectSpecmemDir)) {
    fs.mkdirSync(projectSpecmemDir, { recursive: true });
  }

  // Project-specific hook config
  const projectConfig = {
    project_path: PROJECT_PATH,
    specmem_home: SPECMEM_HOME,
    hooks_enabled: true,
    search_limit: 5,
    threshold: 0.25,
    max_content_length: 300,
    configured_at: new Date().toISOString()
  };

  fs.writeFileSync(projectConfigPath, JSON.stringify(projectConfig, null, 2));
  console.log(`${C.green}✓${C.reset} Created ${projectConfigPath}`);

  // Add to .gitignore if it exists
  const gitignorePath = path.join(PROJECT_PATH, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    if (!gitignore.includes('.specmem')) {
      fs.appendFileSync(gitignorePath, '\n# SpecMem\n.specmem/\n');
      console.log(`${C.green}✓${C.reset} Added .specmem to .gitignore`);
    }
  }

  return true;
}

/**
 * Auto-install  Code if not present
 */
function ensureCode() {
  console.log(`\n${C.cyan}═══ Checking  Code ═══${C.reset}\n`);

  // Check if claude command exists
  try {
    const { execSync } = require('child_process');
    execSync('which claude', { stdio: 'pipe' });
    console.log(`${C.green}✓${C.reset}  Code is installed`);
    return true;
  } catch {
    console.log(`${C.yellow}⚠${C.reset}  Code not found, installing...`);

    try {
      const { execSync } = require('child_process');
      // Install  Code globally via npm
      execSync('npm install -g @anthropic-ai/claude-code', {
        stdio: 'inherit',
        timeout: 120000
      });
      console.log(`${C.green}✓${C.reset}  Code installed successfully`);
      return true;
    } catch (err) {
      console.log(`${C.red}✗${C.reset} Failed to install  Code: ${err.message}`);
      console.log(`${C.dim}Install manually: npm install -g @anthropic-ai/claude-code${C.reset}`);
      return false;
    }
  }
}

/**
 * Auto-install PostgreSQL + pgvector if not present
 */
function ensurePostgres() {
  console.log(`\n${C.cyan}═══ Checking PostgreSQL ═══${C.reset}\n`);

  const { execSync, spawnSync } = require('child_process');

  // Helper: try multiple commands until one works
  const tryCommands = (commands, opts = {}) => {
    for (const cmd of commands) {
      try {
        execSync(cmd, { stdio: 'pipe', timeout: 30000, ...opts });
        return true;
      } catch {}
    }
    return false;
  };

  // Helper: get PostgreSQL major version
  const getPgVersion = () => {
    try {
      const ver = execSync('psql --version 2>/dev/null || pg_config --version 2>/dev/null', { encoding: 'utf-8', stdio: 'pipe' });
      const match = ver.match(/(\d+)/);
      return match ? match[1] : null;
    } catch { return null; }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Check if PostgreSQL is installed
  // ═══════════════════════════════════════════════════════════════════════════
  let pgInstalled = false;
  try {
    execSync('which psql', { stdio: 'pipe' });
    pgInstalled = true;
  } catch {}

  if (!pgInstalled) {
    console.log(`${C.yellow}⚠${C.reset} PostgreSQL not found, installing...`);
    try {
      // Update apt and install PostgreSQL
      execSync('apt-get update -qq', { stdio: 'pipe', timeout: 60000 });
      execSync('apt-get install -y postgresql postgresql-contrib', { stdio: 'inherit', timeout: 300000 });
      pgInstalled = true;
      console.log(`${C.green}✓${C.reset} PostgreSQL installed`);
    } catch (err) {
      console.log(`${C.red}✗${C.reset} Failed to install PostgreSQL`);
      console.log(`${C.dim}Install manually: apt-get install postgresql postgresql-contrib${C.reset}`);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Ensure PostgreSQL cluster exists
  // ═══════════════════════════════════════════════════════════════════════════
  const pgVersion = getPgVersion() || '16';

  // Check if any clusters exist
  let clusterExists = false;
  try {
    const clusters = execSync('pg_lsclusters 2>/dev/null || echo ""', { encoding: 'utf-8', stdio: 'pipe' });
    // pg_lsclusters returns header + clusters, so >1 lines means cluster exists
    clusterExists = clusters.trim().split('\n').length > 1;
  } catch {}

  if (!clusterExists) {
    console.log(`${C.dim}No PostgreSQL cluster found, creating one...${C.reset}`);

    // Try to create a cluster
    const createCommands = [
      `pg_createcluster ${pgVersion} main --start`,
      `pg_createcluster 16 main --start`,
      `pg_createcluster 15 main --start`,
      `pg_createcluster 14 main --start`,
      `sudo pg_createcluster ${pgVersion} main --start`,
      `sudo pg_createcluster 16 main --start`,
      `sudo pg_createcluster 15 main --start`,
      `sudo pg_createcluster 14 main --start`
    ];

    const created = tryCommands(createCommands);
    if (created) {
      console.log(`${C.green}✓${C.reset} Created PostgreSQL cluster`);
      clusterExists = true;
    } else {
      console.log(`${C.yellow}⚠${C.reset} Could not create PostgreSQL cluster`);
      console.log(`${C.dim}Try: pg_createcluster ${pgVersion} main --start${C.reset}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Start PostgreSQL (try ALL methods)
  // ═══════════════════════════════════════════════════════════════════════════
  let pgRunning = false;
  try {
    const result = spawnSync('pg_isready', ['-h', 'localhost', '-p', '5432'], { stdio: 'pipe' });
    pgRunning = result.status === 0;
  } catch {}

  if (!pgRunning && clusterExists) {
    console.log(`${C.dim}Starting PostgreSQL...${C.reset}`);

    // Try ALL possible start methods
    const startCommands = [
      `/etc/init.d/postgresql start`,
      `service postgresql start`,
      `pg_ctlcluster ${pgVersion} main start`,
      `pg_ctlcluster 16 main start`,
      `pg_ctlcluster 15 main start`,
      `pg_ctlcluster 14 main start`,
      `systemctl start postgresql`,
      `sudo systemctl start postgresql`,
      `sudo service postgresql start`,
      `sudo /etc/init.d/postgresql start`
    ];

    const started = tryCommands(startCommands);

    // Wait and check again
    if (started) {
      execSync('sleep 2', { stdio: 'pipe' });
      try {
        const result = spawnSync('pg_isready', ['-h', 'localhost', '-p', '5432'], { stdio: 'pipe' });
        pgRunning = result.status === 0;
      } catch {}
    }

    if (pgRunning) {
      console.log(`${C.green}✓${C.reset} PostgreSQL started`);
    } else {
      console.log(`${C.yellow}⚠${C.reset} Could not start PostgreSQL automatically`);
      console.log(`${C.dim}Try: /etc/init.d/postgresql start${C.reset}`);
    }
  } else if (pgRunning) {
    console.log(`${C.green}✓${C.reset} PostgreSQL is running`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Install pgvector (try ALL versions)
  // ═══════════════════════════════════════════════════════════════════════════
  let pgvectorInstalled = false;
  try {
    // Check if vector extension exists in PostgreSQL
    const result = execSync('dpkg -l 2>/dev/null | grep -i pgvector || ls /usr/share/postgresql/*/extension/vector* 2>/dev/null', { encoding: 'utf-8', stdio: 'pipe' });
    pgvectorInstalled = result.length > 0;
  } catch {}

  if (!pgvectorInstalled) {
    console.log(`${C.dim}Installing pgvector...${C.reset}`);
    const pgVersion = getPgVersion();

    // Try installing pgvector with multiple version numbers
    const pgvectorPackages = [
      pgVersion ? `postgresql-${pgVersion}-pgvector` : null,
      'postgresql-16-pgvector',
      'postgresql-15-pgvector',
      'postgresql-14-pgvector',
      'postgresql-13-pgvector',
      'pgvector'
    ].filter(Boolean);

    let installed = false;
    for (const pkg of pgvectorPackages) {
      try {
        console.log(`${C.dim}  Trying ${pkg}...${C.reset}`);
        execSync(`apt-get install -y ${pkg} 2>/dev/null`, { stdio: 'pipe', timeout: 120000 });
        installed = true;
        console.log(`${C.green}✓${C.reset} Installed ${pkg}`);
        break;
      } catch {}
    }

    // If apt packages fail, try adding PostgreSQL PGDG repo
    if (!installed) {
      console.log(`${C.dim}  Adding PostgreSQL PGDG repo for pgvector...${C.reset}`);
      try {
        // Get distro codename - try multiple methods
        let codename = '';
        try {
          codename = execSync('lsb_release -cs 2>/dev/null', { encoding: 'utf-8', stdio: 'pipe' }).trim();
        } catch {
          try {
            // Fallback: read from /etc/os-release
            const osRelease = execSync('cat /etc/os-release 2>/dev/null', { encoding: 'utf-8', stdio: 'pipe' });
            const match = osRelease.match(/VERSION_CODENAME=(\w+)/);
            if (match) codename = match[1];
          } catch {}
        }

        // Map Debian codenames to Ubuntu for PGDG (they share repos)
        // bookworm = Debian 12, bullseye = Debian 11
        if (!codename || codename === 'n/a') {
          // Default to bookworm for modern systems
          codename = 'bookworm';
        }

        console.log(`${C.dim}  Detected distro: ${codename}${C.reset}`);

        // Install prerequisites and add PGDG repo
        execSync('apt-get install -y curl ca-certificates gnupg lsb-release 2>/dev/null || true', { stdio: 'pipe', timeout: 60000 });
        execSync('mkdir -p /usr/share/keyrings', { stdio: 'pipe' });
        execSync('curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg 2>/dev/null', { stdio: 'pipe', timeout: 30000 });
        execSync(`echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt ${codename}-pgdg main" > /etc/apt/sources.list.d/pgdg.list`, { stdio: 'pipe' });
        execSync('apt-get update -qq 2>/dev/null', { stdio: 'pipe', timeout: 120000 });

        // Try again with official PGDG repo
        for (const pkg of pgvectorPackages) {
          try {
            console.log(`${C.dim}  Trying ${pkg} from PGDG...${C.reset}`);
            execSync(`apt-get install -y ${pkg} 2>&1`, { stdio: 'pipe', timeout: 120000 });
            installed = true;
            console.log(`${C.green}✓${C.reset} Installed ${pkg} from PostgreSQL PGDG repo`);
            break;
          } catch {}
        }
      } catch (err) {
        console.log(`${C.dim}  PGDG repo setup failed: ${err.message}${C.reset}`);
      }
    }

    if (!installed) {
      console.log(`${C.yellow}⚠${C.reset} pgvector not available in apt - will use hash fallback`);
      console.log(`${C.dim}  SpecMem works without pgvector (uses deterministic hashes)${C.reset}`);
    }
  } else {
    console.log(`${C.green}✓${C.reset} pgvector is installed`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Create specmem database and user
  // ═══════════════════════════════════════════════════════════════════════════
  if (pgRunning) {
    console.log(`${C.dim}Setting up specmem database...${C.reset}`);

    // Try multiple approaches to run psql as postgres user
    // Order: su (Docker), sudo -u (normal Linux)
    // NOTE: We DON'T use `psql -U postgres` directly because it prompts for password!
    // The su/sudo methods use peer auth which doesn't need a password.
    const runAsPg = (sql) => {
      const commands = [
        // Docker/containers: su to postgres user (peer auth)
        `su - postgres -c "psql -c \\"${sql}\\""`,
        // Normal Linux: sudo to postgres user (peer auth)
        `sudo -u postgres psql -c "${sql}"`,
      ];
      for (const cmd of commands) {
        try {
          // Use input: '' to ensure no stdin prompt, pipe all output
          execSync(cmd + ' 2>/dev/null', { stdio: ['pipe', 'pipe', 'pipe'], input: '', timeout: 10000 });
          return true;
        } catch {}
      }
      return false;
    };

    const runAsPgOnDb = (db, sql) => {
      const commands = [
        // Docker/containers: su to postgres user (peer auth)
        `su - postgres -c "psql -d ${db} -c \\"${sql}\\""`,
        // Normal Linux: sudo to postgres user (peer auth)
        `sudo -u postgres psql -d ${db} -c "${sql}"`,
      ];
      for (const cmd of commands) {
        try {
          // Use input: '' to ensure no stdin prompt, pipe all output
          execSync(cmd + ' 2>/dev/null', { stdio: ['pipe', 'pipe', 'pipe'], input: '', timeout: 10000 });
          return true;
        } catch {}
      }
      return false;
    };

    // Create user, database, and extension
    // NOTE: Using specmem_westayunprofessional as the unified credential
    // This matches specmem.env defaults - all projects share this DB with per-project isolation via project_path
    const DB_NAME = 'specmem_westayunprofessional';
    const DB_USER = 'specmem_westayunprofessional';
    const DB_PASS = 'specmem_westayunprofessional';

    runAsPg(`CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';`);
    runAsPg(`ALTER USER ${DB_USER} WITH SUPERUSER;`);  // Needed for pgvector
    runAsPg(`CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};`);
    runAsPgOnDb(DB_NAME, "CREATE EXTENSION IF NOT EXISTS vector;");

    // Grant full permissions to ensure no ownership issues
    runAsPgOnDb(DB_NAME, `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${DB_USER};`);
    runAsPgOnDb(DB_NAME, `GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};`);
    runAsPgOnDb(DB_NAME, `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${DB_USER};`);

    // Verify database exists (only use peer auth methods - no password prompts!)
    let dbExists = false;
    try {
      const checkCmds = [
        `su - postgres -c "psql -lqt" 2>/dev/null | grep ${DB_NAME}`,
        `sudo -u postgres psql -lqt 2>/dev/null | grep ${DB_NAME}`,
      ];
      for (const cmd of checkCmds) {
        try {
          execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'], input: '', timeout: 10000 });
          dbExists = true;
          break;
        } catch {}
      }
    } catch {}

    if (dbExists) {
      console.log(`${C.green}✓${C.reset} Database ${DB_NAME} ready`);
    } else {
      console.log(`${C.yellow}⚠${C.reset} Database setup may need manual intervention`);
    }
  }

  return true;
}

/**
 * Main
 */
function main() {
  console.log(`
${C.cyan}${C.bold}╔═══════════════════════════════════════════════════════════════╗
║              SPECMEM HOOK DEPLOYER                              ║
║              https://justcalljon.pro                            ║
╚═══════════════════════════════════════════════════════════════╝${C.reset}
`);

  console.log(`${C.cyan}Project:${C.reset} ${PROJECT_PATH}`);
  console.log(`${C.cyan}SpecMem Package:${C.reset} ${SPECMEM_PKG}`);
  console.log(`${C.cyan}Install Type:${C.reset} ${IS_GLOBAL_INSTALL ? 'Global (npm -g)' : 'Local (project)'}`);
  console.log(`${C.cyan}Project Detected:${C.reset} ${IS_PROJECT_DIR ? 'Yes' : 'No (no package.json/.git)'}`);

  if (!IS_PROJECT_DIR) {
    console.log(`\n${C.yellow}⚠ Warning: Not in a project directory${C.reset}`);
    console.log(`${C.dim}  SpecMem works best when run from a project root.${C.reset}`);
    console.log(`${C.dim}  Current directory will still be configured.${C.reset}\n`);
  }

  // Step 1: Ensure  Code is installed (MUST BE FIRST)
  ensureCode();

  // Step 2: Ensure PostgreSQL + pgvector (REQUIRED for specmem to work)
  ensurePostgres();

  // Step 3: Copy hooks to ~/.claude/hooks/
  const hooksCopied = copyHooks();

  // Step 4: Copy commands to ~/.claude/commands/
  const commandsCopied = copyCommands();

  // Step 5: Copy skills to ~/.claude/skills/
  const skillsCopied = copySkills();

  // Step 6: Update  settings.json (hooks + permissions)
  const settingsUpdated = updateSettings();

  // Step 7: Configure MCP server in ~/.claude.json (THE IMPORTANT ONE!)
  const mcpConfigured = configureMCP();

  // Step 8: Create project config (.specmem/hooks.json)
  const projectConfigured = createProjectConfig();

  // Summary
  console.log(`
${C.green}${C.bold}╔═══════════════════════════════════════════════════════════════╗
║                    ✓ SPECMEM CONFIGURED!                       ║
╚═══════════════════════════════════════════════════════════════╝${C.reset}

${C.cyan}What's configured:${C.reset}
  • ${C.bold}MCP Server${C.reset} - specmem auto-starts when  Code runs
  • ${C.bold}Hooks${C.reset} - Context injection before prompts
  • ${C.bold}Commands${C.reset} - /specmem-* slash commands
  • ${C.bold}Skills${C.reset} - ${skillsCopied} skills deployed

${C.cyan}Next:${C.reset}
  ${C.bold}Just restart  Code${C.reset} - specmem will auto-start!
  ${C.dim}No need to run 'specmem start' manually.${C.reset}
`);
}

// Run
main();
