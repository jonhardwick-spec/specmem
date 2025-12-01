/**
 * CLAUDE CONFIG INJECTOR - ENHANCED AUTO-CONFIGURATION
 * =====================================================
 *
 * Auto-injects SpecMem configuration into Claude Code on startup.
 * This is the CENTRAL entry point for all Claude configuration.
 *
 * Features:
 * - Auto-detects if SpecMem MCP server is configured for current project
 * - Adds MCP server config to ~/.claude/config.json if missing
 * - Deploys hooks to ~/.claude/hooks/
 * - Deploys slash commands to ~/.claude/commands/
 * - Sets required permissions in ~/.claude/settings.json
 * - Sets SPECMEM_PROJECT_PATH for project isolation
 * - Hot-patches running Claude instances via SIGHUP
 * - Fully idempotent - safe to run multiple times
 *
 * Config Hierarchy:
 * - ~/.claude/config.json: MCP server registration (command, args, env)
 * - ~/.claude/settings.json: Hooks, permissions, preferences
 * - ~/.claude/hooks/: Hook script files
 * - ~/.claude/commands/: Slash command .md files
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ============================================================================
// Path Configuration
// ============================================================================
const HOME_DIR = os.homedir();
const CLAUDE_CONFIG_DIR = path.join(HOME_DIR, '.claude');
const CONFIG_PATH = path.join(CLAUDE_CONFIG_DIR, 'config.json');
const SETTINGS_PATH = path.join(CLAUDE_CONFIG_DIR, 'settings.json');
const HOOKS_DIR = path.join(CLAUDE_CONFIG_DIR, 'hooks');
const COMMANDS_DIR = path.join(CLAUDE_CONFIG_DIR, 'commands');
// Claude stores per-project MCP configs in ~/.claude.json under "projects" key
const CLAUDE_JSON_PATH = path.join(HOME_DIR, '.claude.json');
// SpecMem directory detection - works from both src/ and dist/
function getSpecmemRoot() {
    // Check environment variable first
    if (process.env.SPECMEM_ROOT) {
        return process.env.SPECMEM_ROOT;
    }
    // Try to detect from current file location
    // When compiled: dist/init/claudeConfigInjector.js -> need to go up 2 levels
    // When in src: src/init/claudeConfigInjector.ts -> need to go up 2 levels
    const currentDir = __dirname;
    const possibleRoot = path.resolve(currentDir, '..', '..');
    // Verify by checking for bootstrap.js
    const bootstrapPath = path.join(possibleRoot, 'bootstrap.js');
    if (fs.existsSync(bootstrapPath)) {
        return possibleRoot;
    }
    // Fallback to cwd
    return process.cwd();
}
const SPECMEM_ROOT = getSpecmemRoot();
const BOOTSTRAP_PATH = path.join(SPECMEM_ROOT, 'bootstrap.js');
const SOURCE_HOOKS_DIR = path.join(SPECMEM_ROOT, 'claude-hooks');
const SOURCE_COMMANDS_DIR = path.join(SPECMEM_ROOT, 'commands');
// ============================================================================
// The specmem hooks that should be configured
// ============================================================================
// Environment variables for all hooks - MUST include paths!
// NOTE: Socket paths are per-project at {PROJECT}/specmem/sockets/
const HOOK_ENV = {
    SPECMEM_HOME: path.join(HOME_DIR, '.specmem'), // Dynamic path using os.homedir()
    SPECMEM_PKG: SPECMEM_ROOT, // Use detected package root
    // Per-project socket paths - ${cwd} is expanded at runtime by Claude Code
    SPECMEM_RUN_DIR: '${cwd}/specmem/sockets',
    SPECMEM_EMBEDDING_SOCKET: '${cwd}/specmem/sockets/embeddings.sock',
    SPECMEM_PROJECT_PATH: '${cwd}', // Dynamically set by Claude Code
    SPECMEM_SEARCH_LIMIT: '5',
    SPECMEM_THRESHOLD: '0.30',
    SPECMEM_MAX_CONTENT: '200'
};
// ============================================================================
// Permissions SpecMem needs auto-allowed
// ============================================================================
const SPECMEM_PERMISSIONS = [
    'mcp__specmem__*', // All SpecMem MCP tools
    'Read(*)', // File reading for context
    'Grep(*)', // Code search
    'Glob(*)' // File pattern matching
];
// ============================================================================
// JSON File Utilities
// ============================================================================
function safeReadJson(filePath, defaultValue) {
    try {
        if (!fs.existsSync(filePath)) {
            return defaultValue;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    }
    catch (err) {
        logger.warn({ filePath, err }, '[ConfigInjector] Could not read JSON file');
        return defaultValue;
    }
}
function safeWriteJson(filePath, data) {
    try {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
        }
        // Create backup if file exists
        if (fs.existsSync(filePath)) {
            const backupPath = `${filePath}.backup.${Date.now()}`;
            fs.copyFileSync(filePath, backupPath);
            cleanupOldBackups(filePath, 3);
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    }
    catch (err) {
        logger.error({ filePath, err }, '[ConfigInjector] Failed to write JSON');
        return false;
    }
}
function cleanupOldBackups(basePath, keepCount) {
    try {
        const dir = path.dirname(basePath);
        const baseName = path.basename(basePath);
        const files = fs.readdirSync(dir);
        const backups = files
            .filter(f => f.startsWith(`${baseName}.backup.`))
            .sort()
            .reverse();
        for (let i = keepCount; i < backups.length; i++) {
            fs.unlinkSync(path.join(dir, backups[i]));
        }
    }
    catch {
        // Ignore cleanup errors
    }
}
// ============================================================================
// MCP Server Configuration (config.json)
// ============================================================================
/**
 * Check if SpecMem MCP server is configured for the current project
 */
export function isSpecmemMcpConfigured(projectPath) {
    const config = safeReadJson(CONFIG_PATH, {});
    if (!config.mcpServers?.specmem) {
        return false;
    }
    const specmem = config.mcpServers.specmem;
    // Check if it points to a valid bootstrap.js
    if (!specmem.args || specmem.args.length < 2) {
        return false;
    }
    const bootstrapArg = specmem.args[1];
    // Check if bootstrap exists
    if (!fs.existsSync(bootstrapArg)) {
        return false;
    }
    // If projectPath specified, check if env has correct project path
    if (projectPath) {
        const configuredPath = specmem.env?.SPECMEM_PROJECT_PATH;
        // ${PWD} is expanded at runtime by Claude Code, so it's valid
        if (configuredPath && configuredPath !== '${PWD}' && configuredPath !== projectPath) {
            return false;
        }
    }
    return true;
}
/**
 * Configure SpecMem MCP server in config.json
 * Returns true if changes were made
 */
function configureMcpServer() {
    // Verify bootstrap.js exists
    if (!fs.existsSync(BOOTSTRAP_PATH)) {
        return {
            configured: false,
            error: `bootstrap.js not found at ${BOOTSTRAP_PATH}`
        };
    }
    const config = safeReadJson(CONFIG_PATH, {});
    if (!config.mcpServers) {
        config.mcpServers = {};
    }
    // Build the SpecMem MCP server config
    // CRITICAL: ${cwd} is expanded by Claude Code at runtime to current working directory
    // NOTE: ${PWD} resolves at MCP server startup, ${cwd} resolves per-invocation
    const specmemConfig = {
        command: 'node',
        args: ['--max-old-space-size=250', BOOTSTRAP_PATH],
        env: {
            // Core paths - ${cwd} gives us project isolation (dynamic per-directory)
            HOME: HOME_DIR,
            SPECMEM_PROJECT_PATH: '${cwd}',
            SPECMEM_WATCHER_ROOT_PATH: '${cwd}',
            SPECMEM_CODEBASE_PATH: '${cwd}',
            // Database (use environment values or defaults)
            SPECMEM_DB_HOST: process.env.SPECMEM_DB_HOST || 'localhost',
            SPECMEM_DB_PORT: process.env.SPECMEM_DB_PORT || '5432',
            // Watchers enabled by default
            SPECMEM_SESSION_WATCHER_ENABLED: 'true',
            SPECMEM_WATCHER_ENABLED: 'true',
            // Dashboard
            SPECMEM_DASHBOARD_ENABLED: 'true',
            SPECMEM_DASHBOARD_PORT: process.env.SPECMEM_DASHBOARD_PORT || '8595',
        }
    };
    // Check if update needed - compare serialized configs
    const existing = config.mcpServers.specmem;
    const needsUpdate = !existing ||
        existing.args?.[1] !== BOOTSTRAP_PATH ||
        !existing.env?.SPECMEM_PROJECT_PATH;
    if (!needsUpdate) {
        return { configured: false }; // Already correctly configured
    }
    // Update config
    config.mcpServers.specmem = specmemConfig;
    if (safeWriteJson(CONFIG_PATH, config)) {
        logger.info({ path: CONFIG_PATH, bootstrap: BOOTSTRAP_PATH }, '[ConfigInjector] MCP server configured in config.json');
        return { configured: true };
    }
    return { configured: false, error: 'Failed to write config.json' };
}
// ============================================================================
// Project-Level MCP Config Fixer
// ============================================================================
/**
 * Fix outdated specmem MCP configs in ~/.claude.json
 *
 * Claude stores per-project MCP configs in ~/.claude.json under "projects" key.
 * Old specmem installations may have left stale paths that point to non-existent
 * locations. This function scans all project entries and fixes specmem configs
 * to point to the current BOOTSTRAP_PATH.
 *
 * @returns Number of project configs that were fixed
 */
function fixProjectMcpConfigs() {
    const errors = [];
    let fixed = 0;
    // Read ~/.claude.json
    if (!fs.existsSync(CLAUDE_JSON_PATH)) {
        return { fixed: 0, errors: [] }; // No file = nothing to fix
    }
    let claudeJson;
    try {
        const content = fs.readFileSync(CLAUDE_JSON_PATH, 'utf-8');
        claudeJson = JSON.parse(content);
    }
    catch (err) {
        return { fixed: 0, errors: [`Failed to read ${CLAUDE_JSON_PATH}: ${err}`] };
    }
    // Check for projects section
    if (!claudeJson.projects || typeof claudeJson.projects !== 'object') {
        return { fixed: 0, errors: [] }; // No projects = nothing to fix
    }
    let modified = false;
    // Scan all project entries
    for (const [projectPath, projectConfig] of Object.entries(claudeJson.projects)) {
        const config = projectConfig;
        // Check if this project has a specmem MCP server config
        if (config?.mcpServers?.specmem) {
            const specmem = config.mcpServers.specmem;
            const args = specmem.args || [];
            // Check if the args contain an outdated specmem path
            let needsUpdate = false;
            const updatedArgs = args.map((arg) => {
                if (typeof arg === 'string' &&
                    arg.includes('specmem') &&
                    arg !== BOOTSTRAP_PATH &&
                    (arg.endsWith('index.js') || arg.endsWith('bootstrap.js'))) {
                    needsUpdate = true;
                    return BOOTSTRAP_PATH;
                }
                return arg;
            });
            if (needsUpdate) {
                // Update the args
                specmem.args = updatedArgs;
                // Ensure SPECMEM_PROJECT_PATH is set to actual project path
                // CRITICAL: ${PWD} doesn't get expanded by Claude Code, use literal path
                if (!specmem.env) {
                    specmem.env = {};
                }
                if (!specmem.env.SPECMEM_PROJECT_PATH || specmem.env.SPECMEM_PROJECT_PATH === '${PWD}' || specmem.env.SPECMEM_PROJECT_PATH === '${cwd}') {
                    specmem.env.SPECMEM_PROJECT_PATH = projectPath; // Use the actual project path key
                }
                logger.info({ projectPath, oldArgs: args, newArgs: updatedArgs }, '[ConfigInjector] Fixed outdated specmem path in project config');
                fixed++;
                modified = true;
            }
        }
    }
    // Write back if modified
    if (modified) {
        try {
            fs.writeFileSync(CLAUDE_JSON_PATH, JSON.stringify(claudeJson, null, 2));
            logger.info({ path: CLAUDE_JSON_PATH, projectsFixed: fixed }, '[ConfigInjector] Updated project-level MCP configs');
        }
        catch (err) {
            errors.push(`Failed to write ${CLAUDE_JSON_PATH}: ${err}`);
        }
    }
    return { fixed, errors };
}
// ============================================================================
// Hook Files Deployment
// ============================================================================
/**
 * Copy hook files from source to ~/.claude/hooks/
 * Only copies if content differs (idempotent)
 */
function deployHooks() {
    const copied = [];
    const errors = [];
    // Ensure target directory exists
    if (!fs.existsSync(HOOKS_DIR)) {
        try {
            fs.mkdirSync(HOOKS_DIR, { recursive: true, mode: 0o755 });
        }
        catch (err) {
            return { copied: [], errors: [`Could not create hooks dir: ${err}`] };
        }
    }
    // Check source directory
    if (!fs.existsSync(SOURCE_HOOKS_DIR)) {
        return { copied: [], errors: [`Source hooks dir not found: ${SOURCE_HOOKS_DIR}`] };
    }
    // Copy all hook files (including .js for CommonJS compatibility)
    try {
        const files = fs.readdirSync(SOURCE_HOOKS_DIR);
        for (const file of files) {
            if (file.endsWith('.js') || file.endsWith('.cjs') || file.endsWith('.py') || file.endsWith('.sh') || file.endsWith('.json')) {
                const srcPath = path.join(SOURCE_HOOKS_DIR, file);
                const dstPath = path.join(HOOKS_DIR, file);
                try {
                    // Check if update needed
                    let needsCopy = true;
                    if (fs.existsSync(dstPath)) {
                        const srcContent = fs.readFileSync(srcPath, 'utf-8');
                        const dstContent = fs.readFileSync(dstPath, 'utf-8');
                        needsCopy = srcContent !== dstContent;
                    }
                    if (needsCopy) {
                        fs.copyFileSync(srcPath, dstPath);
                        // Make executable for scripts (not JSON data files)
                        if (!file.endsWith('.json')) {
                            fs.chmodSync(dstPath, 0o755);
                        }
                        copied.push(file);
                    }
                }
                catch (err) {
                    errors.push(`Could not copy ${file}: ${err}`);
                }
            }
        }
    }
    catch (err) {
        errors.push(`Could not read source dir: ${err}`);
    }
    return { copied, errors };
}
// ============================================================================
// Command Files Deployment
// ============================================================================
/**
 * Copy slash command files from source to ~/.claude/commands/
 */
function deployCommands() {
    const copied = [];
    const errors = [];
    // Ensure target directory exists
    if (!fs.existsSync(COMMANDS_DIR)) {
        try {
            fs.mkdirSync(COMMANDS_DIR, { recursive: true, mode: 0o755 });
        }
        catch (err) {
            return { copied: [], errors: [`Could not create commands dir: ${err}`] };
        }
    }
    // Check source directory
    if (!fs.existsSync(SOURCE_COMMANDS_DIR)) {
        return { copied: [], errors: [`Source commands dir not found: ${SOURCE_COMMANDS_DIR}`] };
    }
    // Remove outdated specmem commands
    try {
        const existingFiles = fs.readdirSync(COMMANDS_DIR);
        for (const file of existingFiles) {
            if (file.startsWith('specmem-') && file.endsWith('.md')) {
                const srcPath = path.join(SOURCE_COMMANDS_DIR, file);
                if (!fs.existsSync(srcPath)) {
                    try {
                        fs.unlinkSync(path.join(COMMANDS_DIR, file));
                        logger.info({ file }, '[ConfigInjector] Removed outdated command');
                    }
                    catch {
                        // Non-fatal
                    }
                }
            }
        }
    }
    catch {
        // Non-fatal
    }
    // Copy command files
    try {
        const files = fs.readdirSync(SOURCE_COMMANDS_DIR);
        for (const file of files) {
            if (file.endsWith('.md')) {
                const srcPath = path.join(SOURCE_COMMANDS_DIR, file);
                const dstPath = path.join(COMMANDS_DIR, file);
                try {
                    let needsCopy = true;
                    if (fs.existsSync(dstPath)) {
                        const srcContent = fs.readFileSync(srcPath, 'utf-8');
                        const dstContent = fs.readFileSync(dstPath, 'utf-8');
                        needsCopy = srcContent !== dstContent;
                    }
                    if (needsCopy) {
                        fs.copyFileSync(srcPath, dstPath);
                        copied.push(file.replace('.md', ''));
                    }
                }
                catch (err) {
                    errors.push(`Could not copy ${file}: ${err}`);
                }
            }
        }
    }
    catch (err) {
        errors.push(`Could not read source dir: ${err}`);
    }
    return { copied, errors };
}
// ============================================================================
// Per-Project Command Deployment
// ============================================================================
/**
 * Deploy commands to a specific project's .claude/commands/ directory
 * This enables project-specific command overrides and ensures commands
 * are available even without global installation.
 *
 * @param projectPath - The project root directory
 */
function deployCommandsToProject(projectPath) {
    const copied = [];
    const errors = [];
    if (!projectPath) {
        return { copied, errors: ['No project path provided'] };
    }
    const projectCommandsDir = path.join(projectPath, '.claude', 'commands');
    // Ensure target directory exists
    if (!fs.existsSync(projectCommandsDir)) {
        try {
            fs.mkdirSync(projectCommandsDir, { recursive: true, mode: 0o755 });
            logger.info({ path: projectCommandsDir }, '[ConfigInjector] Created per-project commands dir');
        }
        catch (err) {
            return { copied: [], errors: [`Could not create project commands dir: ${err}`] };
        }
    }
    // Check source directory
    if (!fs.existsSync(SOURCE_COMMANDS_DIR)) {
        return { copied: [], errors: [`Source commands dir not found: ${SOURCE_COMMANDS_DIR}`] };
    }
    // Copy command files to project
    try {
        const files = fs.readdirSync(SOURCE_COMMANDS_DIR);
        for (const file of files) {
            if (file.endsWith('.md') && file.startsWith('specmem')) {
                const srcPath = path.join(SOURCE_COMMANDS_DIR, file);
                const dstPath = path.join(projectCommandsDir, file);
                try {
                    let needsCopy = true;
                    if (fs.existsSync(dstPath)) {
                        const srcContent = fs.readFileSync(srcPath, 'utf-8');
                        const dstContent = fs.readFileSync(dstPath, 'utf-8');
                        needsCopy = srcContent !== dstContent;
                    }
                    if (needsCopy) {
                        fs.copyFileSync(srcPath, dstPath);
                        copied.push(file.replace('.md', ''));
                    }
                }
                catch (err) {
                    errors.push(`Could not copy ${file} to project: ${err}`);
                }
            }
        }
    }
    catch (err) {
        errors.push(`Could not read source dir: ${err}`);
    }
    if (copied.length > 0) {
        logger.info({ projectPath, copied }, '[ConfigInjector] Deployed commands to per-project dir');
    }
    return { copied, errors };
}
/**
 * Configure per-project settings.local.json
 * This allows project-specific settings without modifying global config
 */
function configureProjectSettings(projectPath) {
    if (!projectPath) {
        return { updated: false, error: 'No project path provided' };
    }
    const projectSettingsPath = path.join(projectPath, '.claude', 'settings.local.json');
    const projectClaudeDir = path.join(projectPath, '.claude');
    // Ensure .claude directory exists
    if (!fs.existsSync(projectClaudeDir)) {
        try {
            fs.mkdirSync(projectClaudeDir, { recursive: true, mode: 0o755 });
        }
        catch (err) {
            return { updated: false, error: `Could not create .claude dir: ${err}` };
        }
    }
    // Read existing or create new
    let settings = {};
    if (fs.existsSync(projectSettingsPath)) {
        try {
            settings = JSON.parse(fs.readFileSync(projectSettingsPath, 'utf-8'));
        }
        catch {
            settings = {};
        }
    }
    let needsUpdate = false;
    // Ensure MCP permissions are set for this project
    if (!settings.permissions)
        settings.permissions = {};
    if (!settings.permissions.allow)
        settings.permissions.allow = [];
    for (const perm of SPECMEM_PERMISSIONS) {
        if (!settings.permissions.allow.includes(perm)) {
            settings.permissions.allow.push(perm);
            needsUpdate = true;
        }
    }
    // Set default mode to accept edits for smoother experience
    if (!settings.permissions.defaultMode) {
        settings.permissions.defaultMode = 'acceptEdits';
        needsUpdate = true;
    }
    if (!needsUpdate) {
        return { updated: false };
    }
    try {
        fs.writeFileSync(projectSettingsPath, JSON.stringify(settings, null, 2) + '\n');
        logger.info({ path: projectSettingsPath }, '[ConfigInjector] Updated per-project settings');
        return { updated: true };
    }
    catch (err) {
        return { updated: false, error: `Could not write settings: ${err}` };
    }
}
// ============================================================================
// Settings Configuration (settings.json)
// ============================================================================
/**
 * Configure hooks and permissions in settings.json
 * Hook format rules from Claude Code source:
 * - UserPromptSubmit, SessionStart, Stop: NO matcher field
 * - PreToolUse, PostToolUse: matcher is a STRING pattern ("*", "Bash", etc.)
 */
/**
 * MASTER HOOK CONFIGURATION
 * =========================
 * ALL SpecMem hooks are defined here. If a hook is missing from settings.json,
 * it will be added automatically. This ensures consistent configuration.
 */
function getRequiredHooks() {
    // All hook files with their paths
    const HOOKS = {
        drilldown: path.join(HOOKS_DIR, 'specmem-drilldown-hook.js'),
        smartContext: path.join(HOOKS_DIR, 'smart-context-hook.js'),
        inputAware: path.join(HOOKS_DIR, 'input-aware-improver.js'),
        sessionStart: path.join(HOOKS_DIR, 'specmem-session-start.js'),
        precompact: path.join(HOOKS_DIR, 'specmem-precompact.js'),
        agentLoading: path.join(HOOKS_DIR, 'agent-loading-hook.js'),
        taskProgress: path.join(HOOKS_DIR, 'task-progress-hook.js'),
        subagentLoading: path.join(HOOKS_DIR, 'subagent-loading-hook.js'),
        teamMemberInject: path.join(HOOKS_DIR, 'specmem-team-member-inject.js'),
        agentOutputInterceptor: path.join(HOOKS_DIR, 'agent-output-interceptor.js'),
        // Daemon that monitors and compresses agent output files in real-time
        agentOutputFader: path.join(HOOKS_DIR, 'agent-output-fader.cjs'),
    };
    // Environment for search/context hooks
    const searchEnv = {
        ...HOOK_ENV,
        SPECMEM_SEARCH_LIMIT: '3',
        SPECMEM_THRESHOLD: '0.25',
        SPECMEM_MAX_CONTENT: '150'
    };
    return {
        // =========================================================================
        // UserPromptSubmit - fires when user submits a prompt
        // =========================================================================
        UserPromptSubmit: [
            {
                hooks: [
                    // Drilldown hook - provides semantic context from memories
                    ...(fs.existsSync(HOOKS.drilldown) ? [{
                            type: 'command',
                            command: `node ${HOOKS.drilldown}`,
                            timeout: 30,
                            env: HOOK_ENV
                        }] : []),
                    // Input-aware improver - enhances prompt understanding
                    ...(fs.existsSync(HOOKS.inputAware) ? [{
                            type: 'command',
                            command: `node ${HOOKS.inputAware}`,
                            timeout: 5,
                            env: HOOK_ENV
                        }] : [])
                ].filter(h => h)
            }
        ],
        // =========================================================================
        // PreToolUse - fires BEFORE a tool is used (can modify input!)
        // =========================================================================
        PreToolUse: [
            // CRITICAL: Agent loading hook for Task tool - injects SpecMem context & auto-backgrounds
            ...(fs.existsSync(HOOKS.agentLoading) ? [{
                    matcher: 'Task',
                    hooks: [{
                            type: 'command',
                            command: `node ${HOOKS.agentLoading}`,
                            timeout: 10,
                            statusMessage: 'Deploying team member...',
                            env: HOOK_ENV
                        }]
                }] : []),
            // Smart context for Grep
            ...(fs.existsSync(HOOKS.smartContext) ? [{
                    matcher: 'Grep',
                    hooks: [{
                            type: 'command',
                            command: `node ${HOOKS.smartContext}`,
                            timeout: 8,
                            env: searchEnv
                        }]
                }] : []),
            // Smart context for Glob
            ...(fs.existsSync(HOOKS.smartContext) ? [{
                    matcher: 'Glob',
                    hooks: [{
                            type: 'command',
                            command: `node ${HOOKS.smartContext}`,
                            timeout: 8,
                            env: searchEnv
                        }]
                }] : []),
            // Smart context for Read
            ...(fs.existsSync(HOOKS.smartContext) ? [{
                    matcher: 'Read',
                    hooks: [{
                            type: 'command',
                            command: `node ${HOOKS.smartContext}`,
                            timeout: 8,
                            env: searchEnv
                        }]
                }] : []),
            // CRITICAL: Agent output interceptor - blocks wasteful agent output file reads
            // Fires for Read to block direct file reads
            ...(fs.existsSync(HOOKS.agentOutputInterceptor) ? [{
                    matcher: 'Read',
                    hooks: [{
                            type: 'command',
                            command: `node ${HOOKS.agentOutputInterceptor}`,
                            timeout: 3,
                            env: HOOK_ENV
                        }]
                }] : []),
            // Also fires for Bash to block tail/cat/head on output files
            ...(fs.existsSync(HOOKS.agentOutputInterceptor) ? [{
                    matcher: 'Bash',
                    hooks: [{
                            type: 'command',
                            command: `node ${HOOKS.agentOutputInterceptor}`,
                            timeout: 3,
                            env: HOOK_ENV
                        }]
                }] : [])
        ].filter(h => h.hooks?.length > 0),
        // =========================================================================
        // PostToolUse - fires AFTER a tool completes
        // =========================================================================
        PostToolUse: [
            ...(fs.existsSync(HOOKS.taskProgress) ? [{
                    matcher: 'Task',
                    hooks: [{
                            type: 'command',
                            command: `node ${HOOKS.taskProgress}`,
                            timeout: 10,
                            statusMessage: 'Team member finished',
                            env: HOOK_ENV
                        }]
                }] : [])
        ].filter(h => h.hooks?.length > 0),
        // =========================================================================
        // SessionStart - fires when Claude Code session starts
        // =========================================================================
        SessionStart: [
            ...(fs.existsSync(HOOKS.sessionStart) ? [{
                    hooks: [{
                            type: 'command',
                            command: `node ${HOOKS.sessionStart}`,
                            timeout: 30,
                            statusMessage: 'Loading SpecMem context...',
                            env: HOOK_ENV
                        }]
                }] : []),
            // Start the agent output fader daemon - monitors & compresses agent outputs in real-time
            ...(fs.existsSync(HOOKS.agentOutputFader) ? [{
                    hooks: [{
                            type: 'command',
                            command: `node ${HOOKS.agentOutputFader} --daemon`,
                            timeout: 3,
                            statusMessage: '🌫️ Starting output fader daemon...',
                            env: {}
                        }]
                }] : [])
        ].filter(h => h.hooks?.length > 0),
        // =========================================================================
        // PreCompact - fires before context compaction (save memories!)
        // =========================================================================
        PreCompact: [
            ...(fs.existsSync(HOOKS.precompact) ? [{
                    hooks: [{
                            type: 'command',
                            command: `node ${HOOKS.precompact}`,
                            timeout: 60,
                            statusMessage: 'Saving context before compaction...',
                            env: HOOK_ENV
                        }]
                }] : [])
        ].filter(h => h.hooks?.length > 0),
        // =========================================================================
        // SubagentStart/Stop - fires when subagents start/finish
        // =========================================================================
        SubagentStart: [
            ...(fs.existsSync(HOOKS.subagentLoading) ? [{
                    hooks: [{
                            type: 'command',
                            command: `node ${HOOKS.subagentLoading}`,
                            timeout: 5,
                            statusMessage: 'Starting subagent...'
                        }]
                }] : [])
        ].filter(h => h.hooks?.length > 0),
        SubagentStop: [
            ...(fs.existsSync(HOOKS.subagentLoading) ? [{
                    hooks: [{
                            type: 'command',
                            command: `node ${HOOKS.subagentLoading}`,
                            timeout: 5,
                            statusMessage: 'Subagent completed'
                        }]
                }] : [])
        ].filter(h => h.hooks?.length > 0),
        // =========================================================================
        // Stop - fires when Claude Code session ends
        // =========================================================================
        Stop: [
            ...(fs.existsSync(HOOKS.drilldown) ? [{
                    hooks: [{
                            type: 'command',
                            command: `node ${HOOKS.drilldown}`,
                            timeout: 15,
                            env: HOOK_ENV
                        }]
                }] : [])
        ].filter(h => h.hooks?.length > 0)
    };
}
/**
 * Check if a specific hook exists in settings with the correct command
 */
function hasHook(hooks, commandSubstring, matcher) {
    if (!hooks || hooks.length === 0)
        return false;
    return hooks.some(entry => {
        // For matchers, check if matcher matches
        if (matcher && entry.matcher !== matcher)
            return false;
        // Check if any hook command includes the substring
        return entry.hooks?.some(h => h.command?.includes(commandSubstring));
    });
}
function configureSettings() {
    const settings = safeReadJson(SETTINGS_PATH, {});
    const permissionsAdded = [];
    const hooksAdded = [];
    let needsUpdate = false;
    // Initialize sections
    if (!settings.hooks)
        settings.hooks = {};
    if (!settings.permissions)
        settings.permissions = { allow: [] };
    if (!settings.permissions.allow)
        settings.permissions.allow = [];
    // Get all required hooks
    const requiredHooks = getRequiredHooks();
    // =========================================================================
    // VERIFY AND ADD EACH HOOK TYPE
    // =========================================================================
    for (const [hookType, requiredEntries] of Object.entries(requiredHooks)) {
        if (requiredEntries.length === 0)
            continue;
        const currentHooks = settings.hooks[hookType] || [];
        // Check each required entry
        for (const required of requiredEntries) {
            const hookFile = required.hooks?.[0]?.command?.match(/node (.+\.js)/)?.[1] || '';
            const hookName = path.basename(hookFile, '.js');
            const matcher = required.matcher;
            // Check if this specific hook already exists
            const exists = hasHook(currentHooks, hookName, matcher);
            if (!exists) {
                // Add the missing hook
                if (!settings.hooks[hookType]) {
                    settings.hooks[hookType] = [];
                }
                settings.hooks[hookType].push(required);
                hooksAdded.push(`${hookType}:${matcher || 'default'}:${hookName}`);
                needsUpdate = true;
                logger.info({ hookType, hookName, matcher }, '[ConfigInjector] Added missing hook');
            }
        }
    }
    // =========================================================================
    // PERMISSIONS
    // =========================================================================
    for (const perm of SPECMEM_PERMISSIONS) {
        if (!settings.permissions.allow.includes(perm)) {
            settings.permissions.allow.push(perm);
            permissionsAdded.push(perm);
            needsUpdate = true;
        }
    }
    if (!needsUpdate) {
        return { updated: false, permissionsAdded: [], hooksAdded: [] };
    }
    // Log what we're adding
    if (hooksAdded.length > 0) {
        logger.info({ hooksAdded }, '[ConfigInjector] Adding hooks to settings.json');
    }
    if (safeWriteJson(SETTINGS_PATH, settings)) {
        logger.info({ path: SETTINGS_PATH, permissionsAdded, hooksAdded }, '[ConfigInjector] Settings updated');
        return { updated: true, permissionsAdded, hooksAdded };
    }
    return { updated: false, permissionsAdded: [], hooksAdded: [], error: 'Failed to write settings.json' };
}
// ============================================================================
// Hot-Patching Running Claude Instances
// ============================================================================
/**
 * Hot-patch running Claude instances by sending SIGHUP
 * This causes them to reload their configuration without restart
 *
 * SAFETY NOTE: This function is intentionally DISABLED by default because it
 * sends signals to ALL Claude processes on the machine, which could affect
 * Claude instances from OTHER projects. This is dangerous in multi-project
 * environments.
 *
 * To enable, set SPECMEM_ENABLE_CLAUDE_HOT_PATCH=true in environment.
 *
 * Even when enabled, we:
 * 1. Skip our own process
 * 2. Skip our parent process (the Claude that spawned us)
 * 3. Log warnings about the cross-project nature of this operation
 */
function hotPatchRunningClaude() {
    // SAFETY: Disabled by default - opt-in only
    if (process.env['SPECMEM_ENABLE_CLAUDE_HOT_PATCH'] !== 'true') {
        logger.debug('[ConfigInjector] Hot-patching disabled (SPECMEM_ENABLE_CLAUDE_HOT_PATCH != true)');
        return 0;
    }
    let patchedCount = 0;
    // Get our parent PID - this is the Claude that spawned us as MCP server
    // We must NOT signal our parent or we'll kill ourselves!
    const parentPid = process.ppid;
    // SAFETY WARNING: We're about to signal ALL Claude processes
    logger.warn('[ConfigInjector] Hot-patching enabled - this may affect Claude instances from OTHER projects!');
    try {
        // Find all running Claude processes
        const output = execSync('pgrep -f "claude" 2>/dev/null || true', { encoding: 'utf-8' });
        const pids = output.trim().split('\n').filter(Boolean);
        for (const pid of pids) {
            try {
                const pidNum = parseInt(pid, 10);
                // Don't signal ourselves
                if (pidNum === process.pid)
                    continue;
                // Don't signal our parent (the Claude that spawned us)!
                if (pidNum === parentPid) {
                    logger.debug({ pid: pidNum }, '[ConfigInjector] Skipping parent Claude process');
                    continue;
                }
                process.kill(pidNum, 'SIGHUP');
                patchedCount++;
                logger.info({ pid: pidNum }, '[ConfigInjector] Sent SIGHUP to Claude');
            }
            catch {
                // Process might have exited, ignore
            }
        }
        if (patchedCount > 0) {
            logger.info({ count: patchedCount, skippedParent: parentPid }, '[ConfigInjector] Hot-patched running Claude instances');
        }
    }
    catch {
        logger.debug('[ConfigInjector] No running Claude processes found');
    }
    return patchedCount;
}
// ============================================================================
// Main Injection Function
// ============================================================================
/**
 * Main injection function - call this on SpecMem startup
 *
 * This function:
 * 1. Deploys hook files to ~/.claude/hooks/
 * 2. Deploys command files to ~/.claude/commands/ (GLOBAL)
 * 3. Configures MCP server in ~/.claude/config.json
 * 4. Configures hooks and permissions in ~/.claude/settings.json
 * 4.5. Deploys commands to {PROJECT}/.claude/commands/ (PER-PROJECT)
 * 4.6. Configures {PROJECT}/.claude/settings.local.json (PER-PROJECT)
 * 5. Hot-patches running Claude instances (disabled by default)
 *
 * Deploy Targets:
 * - GLOBAL: ~/.claude/commands/ - available to all projects
 * - PER-PROJECT: {PROJECT}/.claude/commands/ - project-specific
 * - GLOBAL SETTINGS: ~/.claude/settings.json - hooks & permissions
 * - PER-PROJECT SETTINGS: {PROJECT}/.claude/settings.local.json
 *
 * Fully idempotent - safe to call on every startup
 */
export async function injectClaudeConfig(projectPath) {
    logger.info({ projectPath: projectPath || 'auto' }, '[ConfigInjector] Starting Claude config injection...');
    const result = {
        success: true,
        mcpServerConfigured: false,
        settingsUpdated: false,
        hooksCopied: [],
        commandsCopied: [],
        permissionsAdded: [],
        hooksAdded: [],
        instancesPatched: 0,
        projectConfigsFixed: 0,
        errors: [],
        alreadyConfigured: false,
        bypassEnabled: false // backwards compat, set true when permissions added
    };
    try {
        // Step 1: Deploy hook files FIRST (before settings.json references them)
        const hooksResult = deployHooks();
        result.hooksCopied = hooksResult.copied;
        if (hooksResult.errors.length > 0) {
            result.errors.push(...hooksResult.errors);
        }
        if (hooksResult.copied.length > 0) {
            logger.info({ files: hooksResult.copied }, '[ConfigInjector] Deployed hooks');
        }
        // Step 2: Deploy command files
        const commandsResult = deployCommands();
        result.commandsCopied = commandsResult.copied;
        if (commandsResult.errors.length > 0) {
            result.errors.push(...commandsResult.errors);
        }
        if (commandsResult.copied.length > 0) {
            logger.info({ files: commandsResult.copied }, '[ConfigInjector] Deployed commands');
        }
        // Step 3: Configure MCP server in config.json
        const mcpResult = configureMcpServer();
        result.mcpServerConfigured = mcpResult.configured;
        if (mcpResult.error) {
            result.errors.push(mcpResult.error);
        }
        // Step 3.5: Fix stale project-level MCP configs in ~/.claude.json
        const projectFixResult = fixProjectMcpConfigs();
        result.projectConfigsFixed = projectFixResult.fixed;
        if (projectFixResult.errors.length > 0) {
            result.errors.push(...projectFixResult.errors);
        }
        if (projectFixResult.fixed > 0) {
            logger.info({ count: projectFixResult.fixed }, '[ConfigInjector] Fixed stale project MCP configs');
        }
        // Step 4: Configure settings (hooks + permissions)
        const settingsResult = configureSettings();
        result.settingsUpdated = settingsResult.updated;
        result.permissionsAdded = settingsResult.permissionsAdded;
        result.hooksAdded = settingsResult.hooksAdded || [];
        result.bypassEnabled = settingsResult.permissionsAdded.length > 0;
        if (settingsResult.error) {
            result.errors.push(settingsResult.error);
        }
        if (settingsResult.hooksAdded?.length > 0) {
            logger.info({ hooksAdded: settingsResult.hooksAdded }, '[ConfigInjector] Dynamically added hooks to settings.json');
        }
        // Step 4.5: Deploy commands to per-project .claude/commands/
        // This ensures commands work even without global installation
        const actualProjectPath = projectPath || process.env.SPECMEM_PROJECT_PATH || process.cwd();
        if (actualProjectPath && actualProjectPath !== HOME_DIR) {
            const projectCommandsResult = deployCommandsToProject(actualProjectPath);
            if (projectCommandsResult.copied.length > 0) {
                // Add to result (prefix with "project:" to distinguish)
                result.commandsCopied.push(...projectCommandsResult.copied.map(c => `project:${c}`));
                logger.info({
                    projectPath: actualProjectPath,
                    copied: projectCommandsResult.copied
                }, '[ConfigInjector] Deployed commands to per-project dir');
            }
            if (projectCommandsResult.errors.length > 0) {
                result.errors.push(...projectCommandsResult.errors);
            }
            // Also configure per-project settings.local.json
            const projectSettingsResult = configureProjectSettings(actualProjectPath);
            if (projectSettingsResult.updated) {
                result.settingsUpdated = true;
                logger.info({ projectPath: actualProjectPath }, '[ConfigInjector] Updated per-project settings.local.json');
            }
            if (projectSettingsResult.error) {
                result.errors.push(projectSettingsResult.error);
            }
        }
        // Step 5: Hot-patch running Claude instances
        // DISABLED: Cannot safely signal parent Claude from MCP child process
        // - SIGHUP kills Claude Code
        // - Other Claude instances have different project contexts
        // Config changes take effect on next Claude restart
        result.instancesPatched = 0;
        // Determine if already fully configured
        result.alreadyConfigured =
            result.hooksCopied.length === 0 &&
                result.commandsCopied.length === 0 &&
                !result.mcpServerConfigured &&
                !result.settingsUpdated &&
                result.projectConfigsFixed === 0;
        // Set overall success
        result.success = result.errors.length === 0;
        // Log summary
        if (result.alreadyConfigured) {
            logger.info('[ConfigInjector] Already fully configured');
        }
        else {
            logger.info({
                mcpServerConfigured: result.mcpServerConfigured,
                settingsUpdated: result.settingsUpdated,
                hooksCopied: result.hooksCopied.length,
                commandsCopied: result.commandsCopied.length,
                permissionsAdded: result.permissionsAdded.length,
                projectConfigsFixed: result.projectConfigsFixed,
                instancesPatched: result.instancesPatched
            }, '[ConfigInjector] Config injection complete');
        }
    }
    catch (error) {
        result.success = false;
        result.errors.push(`Unexpected error: ${error.message}`);
        logger.error({ error }, '[ConfigInjector] Config injection failed');
    }
    return result;
}
// ============================================================================
// Quick Check Functions
// ============================================================================
/**
 * Check if SpecMem is fully configured in Claude
 */
export function isConfigInjected() {
    // Check config.json has specmem MCP server
    const config = safeReadJson(CONFIG_PATH, {});
    if (!config.mcpServers?.specmem) {
        return false;
    }
    // Check settings.json has specmem hooks
    const settings = safeReadJson(SETTINGS_PATH, {});
    const hasPreToolHook = settings.hooks?.PreToolUse?.some((entry) => JSON.stringify(entry).includes('specmem'));
    const hasUserPromptHook = settings.hooks?.UserPromptSubmit?.some((entry) => JSON.stringify(entry).includes('specmem'));
    // Check at least one hook exists (now .js for CommonJS compatibility)
    const drilldownHookExists = fs.existsSync(path.join(HOOKS_DIR, 'specmem-drilldown-hook.js'));
    return !!(hasPreToolHook || hasUserPromptHook) && drilldownHookExists;
}
/**
 * Get detailed installation status
 */
export function getInstallationStatus() {
    const config = safeReadJson(CONFIG_PATH, {});
    const settings = safeReadJson(SETTINGS_PATH, {});
    const configOk = !!config.mcpServers?.specmem;
    const settingsOk = !!(settings.hooks?.UserPromptSubmit?.some((e) => JSON.stringify(e).includes('specmem')) ||
        settings.hooks?.PreToolUse?.some((e) => JSON.stringify(e).includes('specmem')));
    let hooksOk = false;
    try {
        if (fs.existsSync(HOOKS_DIR)) {
            const files = fs.readdirSync(HOOKS_DIR);
            hooksOk = files.some(f => f.includes('specmem'));
        }
    }
    catch {
        // Not ok
    }
    let commandsOk = false;
    try {
        if (fs.existsSync(COMMANDS_DIR)) {
            const files = fs.readdirSync(COMMANDS_DIR);
            commandsOk = files.some(f => f.startsWith('specmem-'));
        }
    }
    catch {
        // Not ok
    }
    return {
        config: configOk,
        settings: settingsOk,
        hooks: hooksOk,
        commands: commandsOk,
        fullyConfigured: configOk && settingsOk && hooksOk && commandsOk
    };
}
// ============================================================================
// Exports
// ============================================================================
export default {
    injectClaudeConfig,
    isConfigInjected,
    isSpecmemMcpConfigured,
    getInstallationStatus,
    hotPatchRunningClaude
};
// Export paths for testing and other modules
export const paths = {
    CLAUDE_CONFIG_DIR,
    CONFIG_PATH,
    SETTINGS_PATH,
    HOOKS_DIR,
    COMMANDS_DIR,
    SPECMEM_ROOT,
    BOOTSTRAP_PATH,
    SOURCE_HOOKS_DIR,
    SOURCE_COMMANDS_DIR
};
//# sourceMappingURL=claudeConfigInjector.js.map