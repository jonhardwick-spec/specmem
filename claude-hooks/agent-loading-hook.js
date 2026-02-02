#!/usr/bin/env node
/**
 * Agent Loading Hook for  Code
 * ===================================
 *
 * PreToolUse hook that intercepts Task tool calls and:
 *   1. Shows a clean loading indicator instead of mega prompts
 *   2. Silently injects team member context
 *   3. Forces background execution
 *   4. Suppresses verbose output
 *   5. [NEW] Applies user-configurable agent settings from .specmem/agent-config.json
 *
 * Hook Event: PreToolUse
 * Matcher: Task
 *
 * Output goes to STDERR (visible in terminal) not STDOUT (tool output)
 *
 * USER CONFIGURATION:
 * Create .specmem/agent-config.json to customize agent deployment:
 * {
 *   "defaults": { "model": "sonnet", "background": true, "ultrathink": false },
 *   "agents": { "Explore": { "model": "haiku" }, "feature-dev:code-explorer": { "model": "opus" } }
 * }
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const specmemPaths = require('./specmem-paths.cjs');

// Project-scoped marker for active agents (used by team-comms-enforcer)
const _projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
const _projectHash = crypto.createHash('sha256').update(path.resolve(_projectPath)).digest('hex').slice(0, 12);
const PROJECT_TMP_DIR = `/tmp/specmem-${_projectHash}`;
const ACTIVE_AGENTS_FILE = `${PROJECT_TMP_DIR}/active-agents.json`;

// Ensure tmp dir exists
try {
  if (!fs.existsSync(PROJECT_TMP_DIR)) {
    fs.mkdirSync(PROJECT_TMP_DIR, { recursive: true, mode: 0o755 });
  }
} catch (e) {}

/**
 * Mark that an agent is being spawned (for team-comms-enforcer detection)
 */
function markAgentSpawned(agentType, description) {
  try {
    let agents = {};
    if (fs.existsSync(ACTIVE_AGENTS_FILE)) {
      agents = JSON.parse(fs.readFileSync(ACTIVE_AGENTS_FILE, 'utf8'));
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    agents[id] = {
      type: agentType,
      description: description.slice(0, 50),
      spawnedAt: Date.now()
    };
    // Clean up old entries (>10 minutes)
    const now = Date.now();
    for (const [key, val] of Object.entries(agents)) {
      if (now - val.spawnedAt > 600000) delete agents[key];
    }
    fs.writeFileSync(ACTIVE_AGENTS_FILE, JSON.stringify(agents, null, 2));
  } catch (e) {}
}

// Token compressor DISABLED - was cluttering agent context
// let compressHookOutput;
// try {
//   compressHookOutput = require('./token-compressor.cjs').compressHookOutput;
// } catch (e) {
//   compressHookOutput = (text) => text;
// }

// Use shared path utilities
const { expandCwd, getSpecmemHome, getSpecmemPkg } = specmemPaths;
const SPECMEM_HOME = getSpecmemHome();

// ============================================================================
// Interactive Agent Chooser Settings
// ============================================================================

// Skip interactive chooser if AUTO_MODE is set
const AUTO_MODE = process.env.SPECMEM_AGENT_AUTO === '1' || process.env.SPECMEM_AGENT_AUTO === 'true';

// Force interactive chooser for every deployment (default: false)
// Set SPECMEM_FORCE_CHOOSER=1 to enable mandatory approval
const FORCE_CHOOSER = process.env.SPECMEM_FORCE_CHOOSER === '1' || process.env.SPECMEM_FORCE_CHOOSER === 'true';

/**
 * SR_DEV_APPROVED_MARKER - Prevents infinite denial loops in agent deployment
 * ===========================================================================
 *
 * PROBLEM THIS SOLVES:
 * When FORCE_CHOOSER is enabled, this hook denies Task tool calls and tells
 *  to ask the user for confirmation first. Without a marker system,
 *  would:
 *   1. Try to deploy agent -> Hook denies, says "ask user first"
 *   2.  asks user, user confirms
 *   3.  tries to deploy agent again -> Hook denies AGAIN (infinite loop!)
 *
 * HOW THE MARKER SYSTEM WORKS:
 * 1. First Task call: Hook denies with message telling  to use AskUserQuestion
 * 2.  asks user via AskUserQuestion tool
 * 3. User confirms deployment settings
 * 4.  re-calls Task with "[SR-DEV-APPROVED]" in the prompt parameter
 * 5. Hook sees marker -> Allows deployment without re-asking
 *
 * MARKER DETECTION:
 * The marker is checked in BOTH the prompt AND description fields because
 *  sometimes places it in the task title instead of the prompt body.
 *
 * FLOW DIAGRAM:
 *   Task(prompt: "do X")
 *     -> Hook: DENY, "ask user first"
 *   AskUserQuestion(...)
 *     -> User confirms
 *   Task(prompt: "do X [SR-DEV-APPROVED]")
 *     -> Hook: ALLOW (marker found)
 */
const SR_DEV_APPROVED_MARKER = '[SR-DEV-APPROVED]';

// ============================================================================
// User Configuration Loading
// ============================================================================

/**
 * Default agent configuration
 */
const DEFAULT_CONFIG = {
  defaults: {
    model: 'sonnet',
    background: true,
    ultrathink: false,
    max_turns: null  // null = no limit
  },
  agents: {},
  presets: {},
  // Chooser settings - default to AUTO (no prompting)
  chooser: {
    enabled: false,  // Set to true to enable interactive chooser
    autoMode: true   // When enabled=false, just deploy with defaults
  }
};

/**
 * Load user agent configuration from .specmem/agent-config.json
 * Falls back to defaults if file doesn't exist
 */
function loadAgentConfig() {
  const configPaths = [
    path.join(process.cwd(), '.specmem', 'agent-config.json'),
    path.join(SPECMEM_HOME, 'agent-config.json'),
    path.join(process.env.HOME || '', '.specmem', 'agent-config.json')
  ];

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        const userConfig = JSON.parse(content);
        // Merge with defaults
        return {
          defaults: { ...DEFAULT_CONFIG.defaults, ...userConfig.defaults },
          agents: { ...DEFAULT_CONFIG.agents, ...userConfig.agents },
          presets: { ...DEFAULT_CONFIG.presets, ...userConfig.presets },
          chooser: { ...DEFAULT_CONFIG.chooser, ...userConfig.chooser }
        };
      }
    } catch (e) {
      // Skip invalid configs
    }
  }

  return DEFAULT_CONFIG;
}

/**
 * Get settings for a specific agent type
 * Merges defaults with agent-specific overrides
 */
function getAgentSettings(agentType, config) {
  const settings = { ...config.defaults };

  // Apply agent-specific overrides
  if (agentType && config.agents[agentType]) {
    Object.assign(settings, config.agents[agentType]);
  }

  // Ultrathink forces opus model
  if (settings.ultrathink) {
    settings.model = 'opus';
  }

  return settings;
}

// ============================================================================
// ANSI Escape Codes for Terminal UI
// ============================================================================

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Colors
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Background
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',

  // Cursor control
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  clearLine: '\x1b[2K',
  moveUp: '\x1b[1A',
};

// ============================================================================
// Agent Chooser Instructions Builder
// ============================================================================

/**
 * AGENT TYPE CATEGORIES - for 4-question flow
 * Category -> Type -> Model -> Extras
 */
const AGENT_CATEGORIES = {
  'Built-in Fast': {
    desc: 'Quick tasks, codebase search',
    types: [
      { name: 'Explore', desc: 'Fast codebase search & exploration' },
      { name: 'Bash', desc: 'Command execution specialist' },
      { name: 'claude-code-guide', desc: 'Documentation & API help' },
      { name: 'statusline-setup', desc: 'Configure status line' }
    ]
  },
  'Built-in Deep': {
    desc: 'Complex reasoning tasks',
    types: [
      { name: 'general-purpose', desc: 'Default - complex multi-step tasks' },
      { name: 'Plan', desc: 'Architecture planning & design' }
    ]
  },
  'Feature-dev': {
    desc: 'Implementation work (opus default)',
    types: [
      { name: 'feature-dev', desc: 'Feature implementation' },
      { name: 'feature-dev:code-explorer', desc: 'Deep code analysis' },
      { name: 'feature-dev:architect', desc: 'System architecture' }
    ]
  },
  'Utility': {
    desc: 'Specialized tasks',
    types: [
      { name: 'bug-hunter', desc: 'Find & fix bugs' },
      { name: 'test-writer', desc: 'Write tests' },
      { name: 'refactor', desc: 'Code refactoring' }
    ]
  }
};

/**
 * FLAT AGENT TYPES LIST (for backwards compat)
 */
const AGENT_TYPES = Object.values(AGENT_CATEGORIES).flatMap(cat =>
  cat.types.map(t => ({ ...t, model: cat.desc.includes('opus') ? 'opus' : 'sonnet' }))
);

const MODELS = [
  { name: 'opus', desc: 'Deepest reasoning (slow, expensive)' },
  { name: 'sonnet', desc: 'Balanced (default)' },
  { name: 'haiku', desc: 'Fastest (cheap, simple tasks)' }
];

// ============================================================================
// Type Mapping: Custom types → Valid  Code subagent_types
// ============================================================================

/**
 * Maps our custom agent type names to valid  Code subagent_type values
 * The Task tool only accepts: Bash, general-purpose, statusline-setup, Explore, Plan, claude-code-guide
 */
const SUBAGENT_TYPE_MAP = {
  // Built-in types (pass through)
  'Bash': 'Bash',
  'general-purpose': 'general-purpose',
  'statusline-setup': 'statusline-setup',
  'Explore': 'Explore',
  'Plan': 'Plan',
  'claude-code-guide': 'claude-code-guide',

  // Feature-dev variants → map to appropriate built-in
  'feature-dev': 'general-purpose',
  'feature-dev:code-explorer': 'Explore',
  'feature-dev:architect': 'Plan',

  // Utility types → general-purpose
  'bug-hunter': 'general-purpose',
  'test-writer': 'general-purpose',
  'refactor': 'general-purpose',

  // Plugin agent names (from ~/.claude/plugins/)
  'code-explorer': 'Explore',
  'code-architect': 'Plan',
  'code-reviewer': 'general-purpose',

  // SpecMem bundled agents (from /specmem/plugins/specmem-agents/)
  'memory-explorer': 'Explore',
  'team-coordinator': 'general-purpose',
  'specmem-bug-hunter': 'general-purpose',
};

/**
 * Get valid  Code subagent_type from our custom type name
 */
function getValidSubagentType(customType) {
  return SUBAGENT_TYPE_MAP[customType] || 'general-purpose';
}

/**
 * Load plugin agent prompt from ~/.claude/plugins/{name}/agents/{agent}.md
 * Returns the markdown content (without frontmatter) or null if not found
 */
function loadPluginAgentPrompt(agentName) {
  // Normalize agent name (feature-dev:code-explorer → code-explorer)
  const baseName = agentName.includes(':') ? agentName.split(':').pop() : agentName;

  // Find SpecMem package directory (bundled plugins)
  let specmemPkgDir = null;
  try {
    // Try to find specmem package via require.resolve
    const specmemPath = require.resolve('specmem-hardwicksoftware/package.json');
    specmemPkgDir = path.dirname(specmemPath);
  } catch {
    // Fallback: check common locations
    const fallbackPaths = [
      '/specmem/plugins',  // Development
      path.join(process.env.HOME || '', '.specmem', 'plugins'),  // Global install
    ];
    for (const p of fallbackPaths) {
      if (fs.existsSync(p)) {
        specmemPkgDir = path.dirname(p);  // Parent of plugins
        break;
      }
    }
  }

  // Plugin directories to search (order matters - user plugins first)
  const pluginDirs = [
    path.join(process.env.HOME || '', '.claude', 'plugins'),
    path.join(process.cwd(), '.claude', 'plugins'),
    // SpecMem bundled plugins
    specmemPkgDir ? path.join(specmemPkgDir, 'plugins') : null,
    '/specmem/plugins',  // Development fallback
  ].filter(Boolean);

  for (const pluginDir of pluginDirs) {
    try {
      if (!fs.existsSync(pluginDir)) continue;

      // Search all plugins for agents/ directory
      const plugins = fs.readdirSync(pluginDir);
      for (const plugin of plugins) {
        const agentFile = path.join(pluginDir, plugin, 'agents', `${baseName}.md`);
        if (fs.existsSync(agentFile)) {
          const content = fs.readFileSync(agentFile, 'utf8');
          // Remove YAML frontmatter (between --- markers)
          const withoutFrontmatter = content.replace(/^---[\s\S]*?---\s*/m, '');
          return withoutFrontmatter.trim();
        }
      }
    } catch (e) {
      // Continue searching
    }
  }

  return null;
}

/**
 * Get ALL agent types organized for pagination
 * Returns array of 4-item pages for AskUserQuestion
 */
function getAgentTypePages(description) {
  const desc = description.toLowerCase();

  // Prioritize types based on keywords (most specific first)
  let prioritized = [...AGENT_TYPES];

  // Reorder based on task description
  const boostTypes = [];
  if (desc.includes('bug') || desc.includes('fix') || desc.includes('debug')) {
    boostTypes.push('bug-hunter', 'feature-dev', 'general-purpose');
  } else if (desc.includes('test') || desc.includes('spec')) {
    boostTypes.push('test-writer', 'bug-hunter', 'general-purpose');
  } else if (desc.includes('refactor') || desc.includes('clean')) {
    boostTypes.push('refactor', 'feature-dev', 'general-purpose');
  } else if (desc.includes('plan') || desc.includes('design') || desc.includes('architect')) {
    boostTypes.push('Plan', 'feature-dev:architect', 'general-purpose');
  } else if (desc.includes('feature') || desc.includes('implement') || desc.includes('build')) {
    boostTypes.push('feature-dev', 'general-purpose', 'Plan');
  } else if (desc.includes('explore') || desc.includes('search') || desc.includes('find')) {
    boostTypes.push('Explore', 'feature-dev:code-explorer', 'general-purpose');
  }

  // Move boosted types to front
  if (boostTypes.length > 0) {
    prioritized.sort((a, b) => {
      const aIdx = boostTypes.indexOf(a.name);
      const bIdx = boostTypes.indexOf(b.name);
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      if (aIdx >= 0) return -1;
      if (bIdx >= 0) return 1;
      return 0;
    });
  }

  // Split into pages of 4 (AskUserQuestion limit)
  const pages = [];
  for (let i = 0; i < prioritized.length; i += 4) {
    pages.push(prioritized.slice(i, i + 4));
  }
  return pages;
}

/**
 * Pick the best 4 agent types based on task description
 * AskUserQuestion only allows 4 options (user can type "Other" for custom)
 */
function pickRelevantAgentTypes(description) {
  const pages = getAgentTypePages(description);
  return pages[0]?.map(a => a.name) || ['general-purpose', 'feature-dev', 'Explore', 'Plan'];
}

/**
 * Build FULL instructions for  to handle manual mode properly
 * This is the key fix -  needs EXPLICIT step-by-step instructions
 */
function buildChooserInstructions(description, currentType, settings, config) {
  const currentModel = settings.model || 'sonnet';
  const shortDesc = description.slice(0, 50);

  // Pick 4 most relevant agent types (AskUserQuestion limit)
  const relevantTypes = pickRelevantAgentTypes(description);
  const agentOptions = relevantTypes.map(name => {
    const agent = AGENT_TYPES.find(a => a.name === name) || { name, desc: name };
    return '{"label":"' + agent.name + '","description":"' + agent.desc + '"}';
  }).join(',');

  // Build category options - flattened
  const categoryOptions = Object.entries(AGENT_CATEGORIES).map(([name, cat]) =>
    '{"label":"' + name + '","description":"' + cat.desc + '"}'
  ).join(',');

  // Build category->type mapping - flattened
  const categoryTypeMap = Object.entries(AGENT_CATEGORIES).map(([catName, cat]) =>
    catName + ':' + cat.types.map(t => t.name).join(',')
  ).join(' | ');

  // FLATTENED: Single line format to avoid breaking 's context formatting
  return '[AGENT-CHOOSER-MANUAL] Task:"' + shortDesc + '" | ' +
    'STEP1:AskUserQuestion({question:"Category?",options:[' + categoryOptions + ']}) | ' +
    'STEP2:Based on category ask TYPE(' + categoryTypeMap + ') | ' +
    'STEP3:Ask MODEL(opus/sonnet/haiku) | ' +
    'STEP4:Ask EXTRAS(ultrathink,thorough,quick) multiSelect:true | ' +
    'STEP5:Ask CHANNEL(main,swarm-1,swarm-2,swarm-3) | ' +
    'THEN:Re-call Task with subagent_type+model+prompt+"' + SR_DEV_APPROVED_MARKER + '" [/AGENT-CHOOSER-MANUAL]';
}

/**
 * Build STEP 1 instructions - Auto vs Manual choice
 *
 * DEPLOYMENT FLOW:
 * 1. Deploy mode (Auto/Manual)
 * 2. If Manual + Multi-agent: Per-agent "Auto/Configure" choice
 * 3. Model selection (opus/sonnet/haiku)
 * 4. Model sub-features (thorough, fast, thinking, ultrathink)
 * 5. Channel selection (main, swarm-1, swarm-2, etc.)
 */
function buildAutoManualChoice(description) {
  const shortDesc = description.slice(0, 40);

  // Human-readable format using bracket notation
  return `[AGENT-DEPLOY-REQUIRED]
Task: "${shortDesc}"
Status: Awaiting senior dev approval

[STEP-1] Deploy Mode
Use AskUserQuestion with options:
  - Auto | Deploy with defaults (sonnet, main channel)
  - Manual | Configure model, features, channel

IF AUTO: Re-call Task with defaults + "${SR_DEV_APPROVED_MARKER}"

[STEP-2] Model Selection (Manual only)
Options: opus (deep reasoning) | sonnet (balanced) | haiku (fast/cheap)

[STEP-3] Features (Manual only, multiSelect:true)
Options: thorough | fast | thinking | ultrathink (opus only)

[STEP-4] Channel (Manual only)
Options: main | swarm-1 | swarm-2 | swarm-3

[MULTI-AGENT]
For 2+ agents, ask per-agent: Auto (defaults) | Configure

[FINAL-STEP]
Re-call Task with: prompt containing [FEATURES:...] [CHANNEL:...] ${SR_DEV_APPROVED_MARKER}
[/AGENT-DEPLOY-REQUIRED]`;
}

// ============================================================================
// Loading Indicator
// ============================================================================

const SPINNERS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const ROCKET_FRAMES = ['🚀', '🔥', '✨', '💫', '⭐', '🌟', '✨', '🔥'];

/**
 * Write to terminal using screen -X stuff
 * This injects text into the active screen window!
 * LOW-43 FIX: Check permissions before writing to TTY devices
 */
function writeToPTS(text) {
  const { execSync, spawnSync } = require('child_process');

  try {
    // Method 1: screen -X stuff injects into active window
    // Need to escape special chars and add newlines
    const escapedText = text.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
    spawnSync('screen', ['-X', 'stuff', text + '\n'], {
      stdio: 'ignore',
      timeout: 1000
    });
  } catch (e) {
    // Fallback: try writing to pts devices
    try {
      const whoOutput = execSync('who 2>/dev/null', { encoding: 'utf8' });
      const lines = whoOutput.split('\n');
      for (const line of lines) {
        const match = line.match(/pts\/(\d+)/);
        if (match) {
          const ptsPath = '/dev/pts/' + match[1];
          try {
            // LOW-43 FIX: Check write permission before attempting write
            fs.accessSync(ptsPath, fs.constants.W_OK);
            fs.writeFileSync(ptsPath, text + '\n');
          } catch (e2) {
            // Silently skip devices we can't write to
          }
        }
      }
    } catch (e2) {}
  }
}

/**
 * Show a compact deployment notification
 * Writes to PTS devices so it appears in terminal
 * Now includes user-configured settings!
 */
function showDeploymentNotice(description, agentType, settings = {}) {
  const icon = ROCKET_FRAMES[Math.floor(Math.random() * ROCKET_FRAMES.length)];
  const typeLabel = agentType ? `[${agentType}]` : '[agent]';

  // Truncate description if too long
  const maxLen = 40;
  const shortDesc = description.length > maxLen
    ? description.substring(0, maxLen - 3) + '...'
    : description;

  // Build settings indicator
  const settingsParts = [];
  if (settings.model && settings.model !== 'sonnet') {
    settingsParts.push(`${ANSI.magenta}${settings.model}${ANSI.reset}`);
  }
  if (settings.ultrathink) {
    settingsParts.push(`${ANSI.yellow}ultrathink${ANSI.reset}`);
  }
  const settingsStr = settingsParts.length > 0 ? ` ${settingsParts.join(' ')}` : '';

  // Compact single-line output with settings
  const line = `${ANSI.cyan}${icon} ${ANSI.bold}Deploying${ANSI.reset} ${ANSI.gray}${typeLabel}${ANSI.reset}${settingsStr} ${ANSI.white}${shortDesc}${ANSI.reset} ${ANSI.dim}(background)${ANSI.reset}`;

  // Write to pts devices - bypasses 's stdio capture!
  writeToPTS(line);
}

/**
 * Show a more detailed box for important deployments
 */
function showDeploymentBox(description, agentType, isParallel = false) {
  const width = 60;
  const icon = '🚀';

  // Truncate and pad description
  const maxDescLen = width - 8;
  const shortDesc = description.length > maxDescLen
    ? description.substring(0, maxDescLen - 3) + '...'
    : description.padEnd(maxDescLen);

  const typeStr = agentType ? ` ${ANSI.dim}[${agentType}]${ANSI.reset}` : '';
  const parallelStr = isParallel ? ` ${ANSI.yellow}(parallel)${ANSI.reset}` : '';

  const lines = [
    `${ANSI.cyan}┌${'─'.repeat(width - 2)}┐${ANSI.reset}`,
    `${ANSI.cyan}│${ANSI.reset} ${icon} ${ANSI.bold}${shortDesc}${ANSI.reset}${typeStr}${parallelStr}`.padEnd(width + 20) + `${ANSI.cyan}│${ANSI.reset}`,
    `${ANSI.cyan}└${'─'.repeat(width - 2)}┘${ANSI.reset}`,
  ];

  // Write to pts devices
  writeToPTS(lines.join('\n'));
}

// ============================================================================
// SpecMem Skills Loader - Silently inject skills into agents
// ============================================================================

// Cache for loaded skills (loaded once at startup)
let cachedSkills = null;

// DISABLED: Token compression removed
// async function compressText(text) {
//   if (!text || text.length < 50) return text;
//   return compressHookOutput(text, { minLength: 50, includeWarning: false });
// }

/**
 * Load all skills from specmem/skills/teammemberskills/
 * Skills are already in Traditional Chinese for token efficiency
 * Returns concatenated skill content (compressed)
 */
async function loadSkills() {
  if (cachedSkills !== null) return cachedSkills;

  // Search multiple skill directories (local  first, then specmem)
  const homeDir = process.env.HOME || '/root';
  const skillsDirs = [
    // Local  skills (highest priority)
    path.join(homeDir, '.claude', 'skills', 'teammemberskills'),
    path.join(homeDir, '.claude', 'skills'),
    path.join(homeDir, '.claude', 'commands'), // Also check commands folder
    // SpecMem skills
    path.join(SPECMEM_HOME, 'skills', 'teammemberskills'),
    path.join(SPECMEM_HOME, 'skills'),
    // Project-local skills
    path.join(process.cwd(), 'skills', 'teammemberskills'),
    path.join(process.cwd(), 'skills')
  ];

  // Collect all skills with their importance
  const allSkills = [];

  for (const dir of skillsDirs) {
    try {
      if (!fs.existsSync(dir)) continue;

      const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));

      for (const file of files) {
        // Skip if already loaded (dedup across directories)
        if (allSkills.some(s => s.name === file)) continue;

        try {
          const filePath = path.join(dir, file);
          const content = fs.readFileSync(filePath, 'utf8');

          // Check for -IMPORTANT- marker (case insensitive)
          const isImportant = /-IMPORTANT-/i.test(content);

          // Extract just the meat - skip headers/frontmatter
          const trimmed = content
            .replace(/^#[^#].*$/gm, '') // Remove H1 headers
            .replace(/\*\*⚠️.*\*\*/g, '') // Remove warning headers
            .replace(/-IMPORTANT-/gi, '') // Remove the marker itself
            .replace(/---\n/g, '') // Remove HR
            .trim();

          if (trimmed.length > 100) { // Only include substantial skills
            allSkills.push({
              name: file,
              content: trimmed,
              important: isImportant
            });
          }
        } catch (e) {
          // Skip unreadable files
        }
      }
    } catch (e) {
      // Try next directory
    }
  }

  // Sort: -IMPORTANT- skills first, then alphabetically
  allSkills.sort((a, b) => {
    if (a.important && !b.important) return -1;
    if (!a.important && b.important) return 1;
    return a.name.localeCompare(b.name);
  });

  // Build skill content (max 8 skills to limit tokens)
  let skillContent = '';
  for (const skill of allSkills.slice(0, 8)) {
    const compressed = await compressText(skill.content.slice(0, 2000));
    const marker = skill.important ? '⭐' : '';
    skillContent += `\n[SKILL:${marker}${skill.name.replace('.md', '')}]\n${compressed}\n`;
  }

  cachedSkills = skillContent || '';
  return cachedSkills;
}

// ============================================================================
// SpecMem MCP Tools Context - DEV TEAM SLACK FRAMING
// ============================================================================

/**
 * Get team context for agents - THE GOLDEN PROMPT
 * "Ghosts in the machine" framing that makes agents work smart
 */
function getMinimalTeamContext() {
  return `

[MANDATORY-FIRST-ACTION]
Before doing ANYTHING else, you MUST announce yourself:
send_team_message({type:"status", message:"Starting: [your task summary]"})
If you skip this, ALL your tool calls will be BLOCKED. No exceptions.
[/MANDATORY-FIRST-ACTION]

[TEAM CONTEXT]
You are a developer on a software development team. The senior engineer on this team is skeptical of AI assistance, so you must perform your tasks efficiently and communicate well with your fellow developers.

⚠️ CRITICAL: YOU MUST USE MCP TOOLS TO COMPLETE YOUR TASK ⚠️
There is NO alternative path. The system ENFORCES MCP tool usage:
- You CANNOT proceed without announcing via send_team_message FIRST
- You CANNOT write code without claiming files via claim_task
- You CANNOT search more than 3 times without using find_memory/find_code_pointers
- Every 5 tool calls, you WILL BE BLOCKED until you check read_team_messages
- Every 8 tool calls, you WILL BE BLOCKED until you check get_team_status for help requests
If you want to complete your goal, you MUST use MCP tools. There is no workaround.

TEAM COMMUNICATION (mcp__specmem__ prefix):
- send_team_message({message, channel:"main"|"swarm-1".."swarm-5", type:"status"|"question"|"update", priority})
- read_team_messages({channel, limit:10, include_broadcasts:true}) - CHECK BROADCASTS REGULARLY!
- broadcast_to_team({message, broadcast_type:"status"|"progress"|"announcement", priority})
- claim_task({description, files:["path1","path2"]}) - REQUIRED before editing
- release_task({claimId:"all"|"<id>"}) - release when done
- get_team_status({}) - see active claims, help requests, team activity
- request_help({question, context, skills_needed:["skill1"]}) - ASK OTHER SWARMS FOR HELP!
- respond_to_help({requestId, response}) - HELP OTHER SWARMS! Helping hands make the world go round!

MEMORY TOOLS (MANDATORY - enforced by hooks):
- find_memory({query, limit:10}) - semantic search for past conversations and decisions
- find_code_pointers({query, limit:10, includeTracebacks:true}) - semantic code search with callers/callees
- save_memory({content, importance, memoryType, tags}) - save important findings
- drill_down({drilldownID}) - get full context on a memory result
- getMemoryFull({id}) - get full memory with live code

WORKFLOW (enforced - you cannot skip steps):
1. START: send_team_message({type:"status", message:"Starting: [task]"})
2. CLAIM: claim_task({description, files}) - REQUIRED before any writes
3. SEARCH: find_memory/find_code_pointers FIRST, then Grep/Glob if needed
4. EVERY 5 CALLS: read_team_messages({include_broadcasts:true}) - MANDATORY
5. EVERY 8 CALLS: get_team_status() - check if anyone needs help!
6. DONE: release_task({claimId:"all"}), send completion status
[/TEAM CONTEXT]`;
}

// ============================================================================
// Hook Handler
// ============================================================================

/**
 * Read stdin with timeout to prevent indefinite hangs
 * CRIT-07 FIX: All hooks must use this instead of raw for-await
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

async function main() {
  // CRIT-07 FIX: Read input with timeout instead of indefinite for-await
  let inputData = await readStdinWithTimeout(5000);

  try {
    const hookData = JSON.parse(inputData);
    const toolName = hookData.tool_name || '';
    const toolInput = hookData.tool_input || {};

    // Only handle Task tool
    if (toolName !== 'Task') {
      process.exit(0);
    }

    // Load user configuration
    const config = loadAgentConfig();

    const prompt = toolInput.prompt || '';
    const description = toolInput.description || 'unnamed task';
    const agentType = toolInput.subagent_type || toolInput.agent_type || '';

    // Get user-configured settings for this agent type
    const settings = getAgentSettings(agentType, config);

    // Skip if already has our context marker (already processed)
    if (prompt.includes('[TEAM CONTEXT]')) {
      showDeploymentNotice(description, agentType, settings);
      process.exit(0);
    }

    // FIX: Check for SR_DEV_APPROVED_MARKER in BOTH prompt AND description
    //  sometimes puts it in the task title instead of the prompt body
    const isUserConfirmed = prompt.includes(SR_DEV_APPROVED_MARKER) ||
                            description.includes(SR_DEV_APPROVED_MARKER);

    // =========================================================================
    // INTERACTIVE AGENT CHOOSER - FORCE DENIAL WITHOUT APPROVAL
    // The "senior dev" must approve all agent deployments
    // =========================================================================
    if (!isUserConfirmed) {
      // FIX: Give  FULL instructions for proper manual mode handling
      // This includes the AskUserQuestion format, model/type options, and next steps
      const instructions = buildAutoManualChoice(description);

      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: instructions
        }
      }));
      process.exit(0);
    }

    // Show loading indicator with config info
    showDeploymentNotice(description, agentType, settings);

    // Parse channel from prompt if specified (format: [CHANNEL:swarm-1] or channel=swarm-1)
    let assignedChannel = 'main';
    const channelMatch = prompt.match(/\[CHANNEL:([^\]]+)\]|channel=(\S+)/i);
    if (channelMatch) {
      assignedChannel = channelMatch[1] || channelMatch[2] || 'main';
    }

    // Generate unique agent ID for channel enforcement tracking
    const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // ════════════════════════════════════════════════════════════════════════
    // CHANNEL ENFORCEMENT - Write agent's assigned channel to file
    // ════════════════════════════════════════════════════════════════════════
    // This file is read by send_team_message to enforce agents only post
    // to their assigned channel (or main for broadcasts).
    const channelEnforcementDir = `${PROJECT_TMP_DIR}/agent-channels`;
    try {
      if (!fs.existsSync(channelEnforcementDir)) {
        fs.mkdirSync(channelEnforcementDir, { recursive: true, mode: 0o755 });
      }
      const channelAssignment = {
        agentId,
        channel: assignedChannel,
        agentType,
        description: description.slice(0, 50),
        createdAt: Date.now()
      };
      fs.writeFileSync(
        `${channelEnforcementDir}/${agentId}.json`,
        JSON.stringify(channelAssignment),
        'utf8'
      );
      // Clean up old channel files (>30 minutes old)
      const now = Date.now();
      for (const file of fs.readdirSync(channelEnforcementDir)) {
        try {
          const filePath = `${channelEnforcementDir}/${file}`;
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > 1800000) fs.unlinkSync(filePath);
        } catch (e) {}
      }
    } catch (e) {
      // Silently continue if we can't write - enforcement will be relaxed
    }

    // Build channel injection with agent ID for enforcement
    const isSwarm = assignedChannel !== 'main';
    const channelContext = isSwarm
      ? `\n[AGENT-ID:${agentId}][CH:${assignedChannel}] ⚠️ You're assigned to ${assignedChannel}. You can ONLY send_team_message to "${assignedChannel}" or "main". Posting to other swarms is BLOCKED.`
      : `\n[AGENT-ID:${agentId}][CH:main]`;

    // Inject minimal context + skills + channel config (silently - user doesn't see this)
    // DISABLED: Skills injection was cluttering agent context with compressed Chinese
    // TODO: Make this smarter - only inject relevant skills per agent type
    // const skills = await loadSkills();
    const skills = null;  // Disabled

    // Load plugin agent prompt if this is a custom/plugin agent type
    const pluginAgentPrompt = loadPluginAgentPrompt(agentType);

    // Build enhanced prompt with all context
    // ORDER: prompt -> team context -> channel -> plugin specialization -> SKILLS (last, most important)
    let modifiedPrompt = prompt + getMinimalTeamContext() + channelContext;

    // Add plugin agent specialization BEFORE skills
    if (pluginAgentPrompt) {
      modifiedPrompt += `\n\n[AGENT-SPECIALIZATION:${agentType}]\n${pluginAgentPrompt}\n[/AGENT-SPECIALIZATION]`;
    }

    // DISABLED: Skills injection - was cluttering agent context
    // TODO: Rework to inject only relevant skills per agent type
    // if (skills) {
    //   modifiedPrompt += `\n[SKL]${skills}`;
    // }

    // Map custom type to valid  Code subagent_type
    const validSubagentType = getValidSubagentType(agentType);

    // Build modified input with user configuration applied
    const modifiedInput = {
      ...toolInput,
      prompt: modifiedPrompt,
      // CRITICAL: Use mapped valid subagent_type, not the custom name!
      subagent_type: validSubagentType,
      // Apply user-configured model (if not already specified)
      model: toolInput.model || settings.model,
      // Apply background setting (can be overridden by user config)
      run_in_background: settings.background !== false ? true : toolInput.run_in_background,
    };

    // Apply max_turns if configured
    if (settings.max_turns && !toolInput.max_turns) {
      modifiedInput.max_turns = settings.max_turns;
    }

    // Build status message with applied settings
    const statusParts = [`🚀 [${agentType || 'agent'}]`];
    statusParts.push(`+MCP team tools`);  // Show that team context is injected
    if (settings.model !== 'sonnet') {
      statusParts.push(`model:${settings.model}`);
    }
    statusParts.push(description.slice(0, 30));

    // Mark that an agent is being spawned (for team-comms-enforcer)
    markAgentSpawned(agentType, description);

    // Output modified hook response - MUST use exact format!
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: statusParts.join(' | '),
        updatedInput: modifiedInput
      }
    };

    console.log(JSON.stringify(output));
    process.exit(0);

  } catch (error) {
    // LOW-44 FIX: Log errors before exit instead of silent fail
    console.error('[agent-loading-hook] Error:', error.message || error);
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('[agent-loading-hook] Unhandled error:', e.message || e);
  process.exit(0);
});
