/**
 * CONFIG AUTO-SYNC SERVICE
 * ========================
 *
 * This service ensures ~/.claude/config.json and ~/.claude/settings.json
 * have consistent SpecMem configuration.
 *
 * PROBLEM SOLVED:
 * - config.json may point to bootstrap.cjs OR dist/index.js
 * - settings.json hooks may reference different paths
 * - This causes startup failures and broken integrations
 *
 * SOLUTION:
 * - AUTHORITATIVE SOURCE: bootstrap.cjs is always the entry point
 * - config.json: MCP server entry points to bootstrap.cjs
 * - settings.json: Hooks point to ~/.claude/hooks/ copies
 * - Both files are kept in sync on every startup
 *
 * Created by Implementation Agent B2 (Opus)
 * Date: 2025-12-29
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ============================================================================
// PATH DEFINITIONS
// ============================================================================
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CONFIG_PATH = path.join(CLAUDE_DIR, 'config.json');
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
const HOOKS_DIR = path.join(CLAUDE_DIR, 'hooks');
const COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');
// SpecMem directory - go up from dist/config to root
function getSpecmemDir() {
    // When running from dist/config/configSync.js, need to go up 3 levels
    // But also handle running from src during development
    const currentDir = __dirname;
    // Check if we're in dist/config
    if (currentDir.includes('dist')) {
        return path.resolve(currentDir, '..', '..');
    }
    // Otherwise we're in src/config
    return path.resolve(currentDir, '..', '..');
}
// Prefer proxy for resilient MCP connections (auto-reconnect on crash)
const _proxyPath = path.join(getSpecmemDir(), 'mcp-proxy.cjs');
const BOOTSTRAP_PATH = fs.existsSync(_proxyPath) ? _proxyPath : path.join(getSpecmemDir(), 'bootstrap.cjs');
const SOURCE_HOOKS_DIR = path.join(getSpecmemDir(), 'claude-hooks');
const SOURCE_COMMANDS_DIR = path.join(getSpecmemDir(), 'commands');
// ============================================================================
// JSON HELPERS (with safe read/write)
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
        logger.warn({ filePath, err }, 'could not read JSON file');
        return defaultValue;
    }
}
function safeWriteJson(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
        }
        // Create backup before writing
        if (fs.existsSync(filePath)) {
            const backupPath = `${filePath}.backup.${Date.now()}`;
            fs.copyFileSync(filePath, backupPath);
            // Clean up old backups (keep only last 3)
            const backupDir = path.dirname(filePath);
            const baseName = path.basename(filePath);
            try {
                const files = fs.readdirSync(backupDir);
                const backups = files
                    .filter(f => f.startsWith(`${baseName}.backup.`))
                    .sort()
                    .reverse();
                for (let i = 3; i < backups.length; i++) {
                    fs.unlinkSync(path.join(backupDir, backups[i]));
                }
            }
            catch {
                // Ignore cleanup errors
            }
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    }
    catch (err) {
        logger.error({ filePath, err }, 'failed to write JSON file');
        return false;
    }
}
// ============================================================================
// CONFIG.JSON SYNC
// ============================================================================
/**
 * Check and fix config.json MCP server entry
 *
 * AUTHORITATIVE CONFIG:
 * - command: 'node'
 * - args: ['--max-old-space-size=250', '/path/to/specmem/bootstrap.cjs']
 * - env: Standard SpecMem environment variables
 */
function syncConfigJson() {
    const mismatches = [];
    // Verify bootstrap.cjs exists
    if (!fs.existsSync(BOOTSTRAP_PATH)) {
        return {
            fixed: false,
            mismatches: [],
            error: `bootstrap.cjs not found at ${BOOTSTRAP_PATH}`
        };
    }
    // Read existing config
    const config = safeReadJson(CONFIG_PATH, { mcpServers: {} });
    if (!config.mcpServers) {
        config.mcpServers = {};
    }
    const existing = config.mcpServers['specmem'];
    let needsFix = false;
    // Check if specmem entry exists
    if (!existing) {
        mismatches.push({
            file: 'config.json',
            field: 'mcpServers.specmem',
            expected: 'present',
            actual: undefined,
            fixed: false
        });
        needsFix = true;
    }
    else {
        // Check command
        if (existing.command !== 'node') {
            mismatches.push({
                file: 'config.json',
                field: 'mcpServers.specmem.command',
                expected: 'node',
                actual: existing.command,
                fixed: false
            });
            needsFix = true;
        }
        // Check args - should point to bootstrap.cjs
        const expectedArgs = [BOOTSTRAP_PATH];
        // Support both old format (with --max-old-space-size) and new format (just path)
        const actualEntryPoint = existing.args?.find(a => a.includes('bootstrap.cjs') || a.includes('mcp-proxy.cjs'));
        if (actualEntryPoint !== BOOTSTRAP_PATH) {
            mismatches.push({
                file: 'config.json',
                field: 'mcpServers.specmem.args[1]',
                expected: BOOTSTRAP_PATH,
                actual: actualEntryPoint,
                fixed: false
            });
            needsFix = true;
        }
        // Check for dist/index.js (wrong entry point)
        if (actualEntryPoint?.includes('dist/index.js')) {
            mismatches.push({
                file: 'config.json',
                field: 'mcpServers.specmem.args[1]',
                expected: BOOTSTRAP_PATH,
                actual: actualEntryPoint,
                fixed: false
            });
            needsFix = true;
        }
    }
    if (!needsFix) {
        return { fixed: false, mismatches };
    }
    // Fix config.json
    config.mcpServers['specmem'] = {
        command: 'node',
        args: [BOOTSTRAP_PATH],
        env: {
            HOME: os.homedir(),
            // Project-local configuration - ${cwd} is expanded by  Code per-invocation
            // NOTE: ${PWD} only resolves at startup, ${cwd} resolves dynamically
            SPECMEM_PROJECT_PATH: '${cwd}',
            SPECMEM_WATCHER_ROOT_PATH: '${cwd}',
            SPECMEM_CODEBASE_PATH: '${cwd}',
            // Database configuration
            SPECMEM_DB_HOST: process.env.SPECMEM_DB_HOST || 'localhost',
            SPECMEM_DB_PORT: process.env.SPECMEM_DB_PORT || '5432',
            SPECMEM_DB_NAME: process.env.SPECMEM_DB_NAME || process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional',
            SPECMEM_DB_USER: process.env.SPECMEM_DB_USER || process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional',
            SPECMEM_DB_PASSWORD: process.env.SPECMEM_DB_PASSWORD || process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional',
            // Session and dashboard configuration
            SPECMEM_SESSION_WATCHER_ENABLED: process.env.SPECMEM_SESSION_WATCHER_ENABLED || 'true',
            SPECMEM_MAX_HEAP_MB: process.env.SPECMEM_MAX_HEAP_MB || '250',
            SPECMEM_DASHBOARD_ENABLED: process.env.SPECMEM_DASHBOARD_ENABLED || 'true',
            SPECMEM_DASHBOARD_PORT: process.env.SPECMEM_DASHBOARD_PORT || '8595',
            SPECMEM_DASHBOARD_HOST: process.env.SPECMEM_DASHBOARD_HOST || '0.0.0.0',
            SPECMEM_DASHBOARD_PASSWORD: process.env.SPECMEM_DASHBOARD_PASSWORD || process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional'
        }
    };
    if (safeWriteJson(CONFIG_PATH, config)) {
        // Mark all mismatches as fixed
        for (const m of mismatches) {
            m.fixed = true;
        }
        logger.info({ path: CONFIG_PATH, mismatches: mismatches.length }, 'config.json synchronized');
        return { fixed: true, mismatches };
    }
    return { fixed: false, mismatches, error: 'failed to write config.json' };
}
// ============================================================================
// PROJECT-LEVEL CONFIG SYNC
// ============================================================================
/**
 * Sync project-level MCP configurations in ~/.claude.json
 *
 *  Code stores per-project configs under `projects -> {path} -> mcpServers`
 * These can become stale when credentials change. This function automatically
 * fixes stale specmem env vars in all project entries.
 *
 * ROOT CAUSE FIX: When user runs  in different projects, each project
 * gets its own MCP config snapshot. If the master credentials change, these
 * per-project snapshots become stale and cause "permission denied" errors.
 */
function syncProjectConfigs() {
    const projectsFixed = [];
    // Read the  config (not config.json, but ~/.claude.json - the main  Code config)
    const claudeJsonPath = path.join(os.homedir(), '.claude.json');
    if (!fs.existsSync(claudeJsonPath)) {
        return { fixed: false, projectsFixed: [], error: 'No ~/.claude.json found' };
    }
    let claudeConfig;
    try {
        const content = fs.readFileSync(claudeJsonPath, 'utf-8');
        claudeConfig = JSON.parse(content);
    }
    catch (err) {
        return { fixed: false, projectsFixed: [], error: `Failed to read ~/.claude.json: ${err}` };
    }
    // Skip if no projects section
    if (!claudeConfig.projects || typeof claudeConfig.projects !== 'object') {
        return { fixed: false, projectsFixed: [] };
    }
    // Get the canonical credential values
    const canonicalDbName = process.env.SPECMEM_DB_NAME || process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional';
    const canonicalDbUser = process.env.SPECMEM_DB_USER || process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional';
    const canonicalDbPassword = process.env.SPECMEM_DB_PASSWORD || process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional';
    const canonicalDashboardPassword = process.env.SPECMEM_DASHBOARD_PASSWORD || process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional';
    let anyFixed = false;
    // Iterate through all projects
    for (const [projectPath, projectConfig] of Object.entries(claudeConfig.projects)) {
        if (!projectConfig || typeof projectConfig !== 'object')
            continue;
        const pc = projectConfig;
        const specmemEnv = pc.mcpServers?.specmem?.env;
        if (!specmemEnv)
            continue;
        let projectFixed = false;
        // Check and fix each credential
        if (specmemEnv.SPECMEM_DB_NAME && specmemEnv.SPECMEM_DB_NAME !== canonicalDbName) {
            logger.info({ projectPath, old: specmemEnv.SPECMEM_DB_NAME, new: canonicalDbName }, '[ConfigSync] Fixing stale SPECMEM_DB_NAME in project');
            specmemEnv.SPECMEM_DB_NAME = canonicalDbName;
            projectFixed = true;
        }
        if (specmemEnv.SPECMEM_DB_USER && specmemEnv.SPECMEM_DB_USER !== canonicalDbUser) {
            logger.info({ projectPath, old: specmemEnv.SPECMEM_DB_USER, new: canonicalDbUser }, '[ConfigSync] Fixing stale SPECMEM_DB_USER in project');
            specmemEnv.SPECMEM_DB_USER = canonicalDbUser;
            projectFixed = true;
        }
        if (specmemEnv.SPECMEM_DB_PASSWORD && specmemEnv.SPECMEM_DB_PASSWORD !== canonicalDbPassword) {
            logger.info({ projectPath, old: '***', new: '***' }, '[ConfigSync] Fixing stale SPECMEM_DB_PASSWORD in project');
            specmemEnv.SPECMEM_DB_PASSWORD = canonicalDbPassword;
            projectFixed = true;
        }
        if (specmemEnv.SPECMEM_DASHBOARD_PASSWORD && specmemEnv.SPECMEM_DASHBOARD_PASSWORD !== canonicalDashboardPassword) {
            logger.info({ projectPath, old: '***', new: '***' }, '[ConfigSync] Fixing stale SPECMEM_DASHBOARD_PASSWORD in project');
            specmemEnv.SPECMEM_DASHBOARD_PASSWORD = canonicalDashboardPassword;
            projectFixed = true;
        }
        if (projectFixed) {
            projectsFixed.push(projectPath);
            anyFixed = true;
        }
    }
    if (!anyFixed) {
        return { fixed: false, projectsFixed: [] };
    }
    // Write back the updated config
    try {
        // Create backup first
        const backupPath = `${claudeJsonPath}.backup.${Date.now()}`;
        fs.copyFileSync(claudeJsonPath, backupPath);
        // Clean up old backups (keep only last 3)
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
        }
        catch {
            // Ignore cleanup errors
        }
        fs.writeFileSync(claudeJsonPath, JSON.stringify(claudeConfig, null, 2), 'utf-8');
        logger.info({ projectsFixed }, '[ConfigSync] Project-level configs updated');
        return { fixed: true, projectsFixed };
    }
    catch (err) {
        return { fixed: false, projectsFixed: [], error: `Failed to write ~/.claude.json: ${err}` };
    }
}
// ============================================================================
// SETTINGS.JSON SYNC
// ============================================================================
/**
 * Check if a hook entry contains a specific command substring
 */
function hookContainsCommand(entry, commandSubstring) {
    return entry.hooks?.some(h => h.command?.includes(commandSubstring)) ?? false;
}
/**
 * Check if a hooks array contains a SpecMem hook with the given command substring
 */
function hasSpecmemHook(hooks, commandSubstring, matcher) {
    if (!hooks || hooks.length === 0)
        return false;
    return hooks.some(entry => {
        // If matcher is specified, must match
        if (matcher !== undefined && entry.matcher !== matcher)
            return false;
        return hookContainsCommand(entry, commandSubstring);
    });
}
/**
 * Filter out SpecMem hooks from an array (preserves user hooks)
 */
function filterOutSpecmemHooks(hooks) {
    if (!hooks)
        return [];
    return hooks.filter(entry => {
        // Keep entries that don't have any specmem-related commands
        const isSpecmem = entry.hooks?.some(h => h.command?.includes('specmem') ||
            h.command?.includes('drilldown') ||
            h.command?.includes('smart-context') ||
            h.command?.includes('input-aware'));
        return !isSpecmem;
    });
}
/**
 * Check and fix settings.json hook configuration
 *
 * CRITICAL: This function MERGES hooks - it preserves existing user hooks
 * and only adds/updates SpecMem hooks.
 *
 * AUTHORITATIVE CONFIG:
 * - UserPromptSubmit: hooks array WITHOUT matcher field
 * - PreToolUse: hooks array WITH matcher STRING (e.g., "*")
 * - SessionStart/Stop: hooks array WITHOUT matcher field
 */
function syncSettingsJson() {
    const mismatches = [];
    // Read existing settings
    const settings = safeReadJson(SETTINGS_PATH, { hooks: {} });
    if (!settings.hooks) {
        settings.hooks = {};
    }
    // Hook paths - use .js extension for CommonJS compatibility
    const drilldownHookPath = path.join(HOOKS_DIR, 'specmem-drilldown-hook.js');
    const smartContextHookPath = path.join(HOOKS_DIR, 'smart-context-hook.js');
    const inputAwareHookPath = path.join(HOOKS_DIR, 'input-aware-improver.js');
    let needsFix = false;
    // -------------------------------------------------------------------------
    // Check UserPromptSubmit hooks - need specmem drilldown hook
    // -------------------------------------------------------------------------
    const hasDrilldownHook = hasSpecmemHook(settings.hooks.UserPromptSubmit, 'drilldown');
    const hasInputAwareHook = hasSpecmemHook(settings.hooks.UserPromptSubmit, 'input-aware');
    if (!hasDrilldownHook && fs.existsSync(drilldownHookPath)) {
        mismatches.push({
            file: 'settings.json',
            field: 'hooks.UserPromptSubmit.drilldown',
            expected: 'present',
            actual: undefined,
            fixed: false
        });
        needsFix = true;
    }
    if (!hasInputAwareHook && fs.existsSync(inputAwareHookPath)) {
        mismatches.push({
            file: 'settings.json',
            field: 'hooks.UserPromptSubmit.input-aware',
            expected: 'present',
            actual: undefined,
            fixed: false
        });
        needsFix = true;
    }
    // -------------------------------------------------------------------------
    // Check PreToolUse hooks - need smart-context hook
    // -------------------------------------------------------------------------
    const hasSmartContextHook = hasSpecmemHook(settings.hooks.PreToolUse, 'smart-context');
    if (!hasSmartContextHook && fs.existsSync(smartContextHookPath)) {
        mismatches.push({
            file: 'settings.json',
            field: 'hooks.PreToolUse.smart-context',
            expected: 'present',
            actual: undefined,
            fixed: false
        });
        needsFix = true;
    }
    // -------------------------------------------------------------------------
    // Check SessionStart hooks
    // -------------------------------------------------------------------------
    const hasSessionStartHook = hasSpecmemHook(settings.hooks.SessionStart, 'specmem');
    if (!hasSessionStartHook && fs.existsSync(drilldownHookPath)) {
        mismatches.push({
            file: 'settings.json',
            field: 'hooks.SessionStart',
            expected: 'specmem hook present',
            actual: undefined,
            fixed: false
        });
        needsFix = true;
    }
    if (!needsFix) {
        return { fixed: false, mismatches };
    }
    // =========================================================================
    // MERGE FIXES - Preserve user hooks, only add/update SpecMem hooks
    // =========================================================================
    // UserPromptSubmit - preserve existing non-specmem hooks, add missing specmem hooks
    const existingUserPromptHooks = filterOutSpecmemHooks(settings.hooks.UserPromptSubmit);
    const newUserPromptHooks = [...existingUserPromptHooks];
    if (fs.existsSync(drilldownHookPath)) {
        newUserPromptHooks.push({
            // NO matcher field for UserPromptSubmit
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
        });
    }
    if (fs.existsSync(inputAwareHookPath)) {
        newUserPromptHooks.push({
            // NO matcher field for UserPromptSubmit
            hooks: [{
                    type: 'command',
                    command: `node ${inputAwareHookPath}`,
                    timeout: 5
                }]
        });
    }
    settings.hooks.UserPromptSubmit = newUserPromptHooks;
    // PreToolUse - preserve existing non-specmem hooks, add smart-context
    const existingPreToolHooks = filterOutSpecmemHooks(settings.hooks.PreToolUse);
    const newPreToolHooks = [...existingPreToolHooks];
    if (fs.existsSync(smartContextHookPath)) {
        newPreToolHooks.push({
            matcher: '*', // String pattern to match all tools
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
        });
    }
    settings.hooks.PreToolUse = newPreToolHooks;
    // SessionStart - preserve existing non-specmem hooks
    const existingSessionStartHooks = filterOutSpecmemHooks(settings.hooks.SessionStart);
    const newSessionStartHooks = [...existingSessionStartHooks];
    if (fs.existsSync(drilldownHookPath)) {
        newSessionStartHooks.push({
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
        });
    }
    settings.hooks.SessionStart = newSessionStartHooks;
    // Stop - preserve existing non-specmem hooks
    const existingStopHooks = filterOutSpecmemHooks(settings.hooks.Stop);
    const newStopHooks = [...existingStopHooks];
    if (fs.existsSync(drilldownHookPath)) {
        newStopHooks.push({
            hooks: [{
                    type: 'command',
                    command: `node ${drilldownHookPath}`,
                    timeout: 15
                }]
        });
    }
    settings.hooks.Stop = newStopHooks;
    if (safeWriteJson(SETTINGS_PATH, settings)) {
        // Mark all mismatches as fixed
        for (const m of mismatches) {
            m.fixed = true;
        }
        logger.info({ path: SETTINGS_PATH, mismatches: mismatches.length, preserved: existingUserPromptHooks.length + existingPreToolHooks.length }, 'settings.json synchronized (user hooks preserved)');
        return { fixed: true, mismatches };
    }
    return { fixed: false, mismatches, error: 'failed to write settings.json' };
}
// ============================================================================
// HOOKS SYNC
// ============================================================================
/**
 * Sync hook files from source to ~/.claude/hooks/
 */
function syncHookFiles() {
    const files = [];
    const errors = [];
    // Ensure hooks directory exists
    if (!fs.existsSync(HOOKS_DIR)) {
        try {
            fs.mkdirSync(HOOKS_DIR, { recursive: true, mode: 0o755 });
        }
        catch (err) {
            return { synced: false, files: [], errors: [`could not create hooks dir: ${err}`] };
        }
    }
    // Check source directory
    if (!fs.existsSync(SOURCE_HOOKS_DIR)) {
        return { synced: false, files: [], errors: [`source hooks dir not found: ${SOURCE_HOOKS_DIR}`] };
    }
    // Copy hook files (overwrite to ensure latest version)
    try {
        const sourceFiles = fs.readdirSync(SOURCE_HOOKS_DIR);
        for (const file of sourceFiles) {
            if (file.endsWith('.js') || file.endsWith('.py') || file.endsWith('.sh')) {
                const srcPath = path.join(SOURCE_HOOKS_DIR, file);
                const dstPath = path.join(HOOKS_DIR, file);
                try {
                    // Check if update needed (compare content)
                    let needsCopy = true;
                    if (fs.existsSync(dstPath)) {
                        const srcContent = fs.readFileSync(srcPath, 'utf-8');
                        const dstContent = fs.readFileSync(dstPath, 'utf-8');
                        needsCopy = srcContent !== dstContent;
                    }
                    if (needsCopy) {
                        fs.copyFileSync(srcPath, dstPath);
                        fs.chmodSync(dstPath, 0o755);
                        files.push(file);
                    }
                }
                catch (err) {
                    errors.push(`could not copy ${file}: ${err}`);
                }
            }
        }
    }
    catch (err) {
        errors.push(`could not read source dir: ${err}`);
    }
    return {
        synced: errors.length === 0,
        files,
        errors
    };
}
// ============================================================================
// COMMANDS SYNC
// ============================================================================
/**
 * Sync command files from source to ~/.claude/commands/
 */
function syncCommandFiles() {
    const files = [];
    const errors = [];
    // Ensure commands directory exists
    if (!fs.existsSync(COMMANDS_DIR)) {
        try {
            fs.mkdirSync(COMMANDS_DIR, { recursive: true, mode: 0o755 });
        }
        catch (err) {
            return { synced: false, files: [], errors: [`could not create commands dir: ${err}`] };
        }
    }
    // Check source directory
    if (!fs.existsSync(SOURCE_COMMANDS_DIR)) {
        return { synced: false, files: [], errors: [`source commands dir not found: ${SOURCE_COMMANDS_DIR}`] };
    }
    // Remove old specmem commands that no longer exist in source
    try {
        const existingFiles = fs.readdirSync(COMMANDS_DIR);
        for (const file of existingFiles) {
            if (file.startsWith('specmem-') && file.endsWith('.md')) {
                const srcPath = path.join(SOURCE_COMMANDS_DIR, file);
                if (!fs.existsSync(srcPath)) {
                    try {
                        fs.unlinkSync(path.join(COMMANDS_DIR, file));
                        logger.info({ file }, 'removed outdated command');
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
    // Copy command files (overwrite to ensure latest version)
    try {
        const sourceFiles = fs.readdirSync(SOURCE_COMMANDS_DIR);
        for (const file of sourceFiles) {
            if (file.endsWith('.md')) {
                const srcPath = path.join(SOURCE_COMMANDS_DIR, file);
                const dstPath = path.join(COMMANDS_DIR, file);
                try {
                    // Check if update needed (compare content)
                    let needsCopy = true;
                    if (fs.existsSync(dstPath)) {
                        const srcContent = fs.readFileSync(srcPath, 'utf-8');
                        const dstContent = fs.readFileSync(dstPath, 'utf-8');
                        needsCopy = srcContent !== dstContent;
                    }
                    if (needsCopy) {
                        fs.copyFileSync(srcPath, dstPath);
                        files.push(file.replace('.md', ''));
                    }
                }
                catch (err) {
                    errors.push(`could not copy ${file}: ${err}`);
                }
            }
        }
    }
    catch (err) {
        errors.push(`could not read source dir: ${err}`);
    }
    return {
        synced: errors.length === 0,
        files,
        errors
    };
}
// ============================================================================
// MAIN SYNC FUNCTION
// ============================================================================
/**
 * Run full config sync
 *
 * This function should be called:
 * 1. On SpecMem startup (before MCP server starts)
 * 2. When /specmem-diagnose detects issues
 * 3. Manually via dashboard
 *
 * It ensures:
 * - config.json points to bootstrap.cjs (not dist/index.js)
 * - settings.json has correct hook format (no object matchers for UserPromptSubmit)
 * - Hook files are copied to ~/.claude/hooks/
 * - Command files are copied to ~/.claude/commands/
 */
export function runConfigSync() {
    logger.info('[ConfigSync] Starting config synchronization...');
    const errors = [];
    const allMismatches = [];
    // Step 1: Sync hook files FIRST (before settings.json references them)
    const hooksResult = syncHookFiles();
    if (hooksResult.errors.length > 0) {
        errors.push(...hooksResult.errors);
    }
    if (hooksResult.files.length > 0) {
        logger.info({ files: hooksResult.files }, '[ConfigSync] Hook files synced');
    }
    // Step 2: Sync command files
    const commandsResult = syncCommandFiles();
    if (commandsResult.errors.length > 0) {
        errors.push(...commandsResult.errors);
    }
    if (commandsResult.files.length > 0) {
        logger.info({ files: commandsResult.files }, '[ConfigSync] Command files synced');
    }
    // Step 3: Sync config.json
    const configResult = syncConfigJson();
    if (configResult.error) {
        errors.push(configResult.error);
    }
    allMismatches.push(...configResult.mismatches);
    // Step 4: Sync settings.json
    const settingsResult = syncSettingsJson();
    if (settingsResult.error) {
        errors.push(settingsResult.error);
    }
    allMismatches.push(...settingsResult.mismatches);
    // Step 5: Sync project-level MCP configs in ~/.claude.json
    // This fixes stale credentials in per-project config snapshots
    const projectsResult = syncProjectConfigs();
    if (projectsResult.error) {
        errors.push(projectsResult.error);
    }
    const result = {
        success: errors.length === 0,
        configFixed: configResult.fixed,
        settingsFixed: settingsResult.fixed,
        projectsFixed: projectsResult.projectsFixed,
        hooksSynced: hooksResult.files.length > 0,
        commandsSynced: commandsResult.files.length > 0,
        mismatches: allMismatches,
        errors
    };
    if (result.success) {
        const changes = [];
        if (result.configFixed)
            changes.push('config.json');
        if (result.settingsFixed)
            changes.push('settings.json');
        if (result.projectsFixed.length > 0)
            changes.push(`${result.projectsFixed.length} project configs`);
        if (result.hooksSynced)
            changes.push(`${hooksResult.files.length} hooks`);
        if (result.commandsSynced)
            changes.push(`${commandsResult.files.length} commands`);
        if (changes.length > 0) {
            logger.info({ changes }, '[ConfigSync] Config sync complete with changes');
        }
        else {
            logger.info('[ConfigSync] Config already in sync');
        }
    }
    else {
        logger.warn({ errors }, '[ConfigSync] Config sync completed with errors');
    }
    return result;
}
// ============================================================================
// HEALTH CHECK
// ============================================================================
/**
 * Check config health without making changes
 *
 * Returns current state of all config files
 */
export function checkConfigHealth() {
    const mismatches = [];
    // Check config.json
    let configOk = false;
    try {
        const config = safeReadJson(CONFIG_PATH, {});
        const specmem = config.mcpServers?.['specmem'];
        if (specmem &&
            specmem.command === 'node' &&
            specmem.args?.[1] === BOOTSTRAP_PATH) {
            configOk = true;
        }
        else {
            mismatches.push({
                file: 'config.json',
                field: 'mcpServers.specmem',
                expected: `{ command: 'node', args: [..., '${BOOTSTRAP_PATH}'] }`,
                actual: specmem ? JSON.stringify(specmem).substring(0, 100) : undefined,
                fixed: false
            });
        }
    }
    catch {
        mismatches.push({
            file: 'config.json',
            field: 'file',
            expected: 'readable',
            actual: 'error',
            fixed: false
        });
    }
    // Check settings.json
    let settingsOk = false;
    try {
        const settings = safeReadJson(SETTINGS_PATH, {});
        // Check UserPromptSubmit format (should have NO matcher)
        const userPromptOk = settings.hooks?.UserPromptSubmit?.every((e) => e.matcher === undefined && (e.hooks?.length ?? 0) > 0);
        // Check PreToolUse format (should have STRING matcher)
        const preToolOk = settings.hooks?.PreToolUse?.every((e) => typeof e.matcher === 'string' && (e.hooks?.length ?? 0) > 0);
        settingsOk = userPromptOk !== false && preToolOk !== false;
        if (!settingsOk) {
            mismatches.push({
                file: 'settings.json',
                field: 'hooks',
                expected: 'valid hook format',
                actual: 'invalid format detected',
                fixed: false
            });
        }
    }
    catch {
        mismatches.push({
            file: 'settings.json',
            field: 'file',
            expected: 'readable',
            actual: 'error',
            fixed: false
        });
    }
    // Check hooks directory
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
    // Check commands directory
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
        healthy: configOk && settingsOk && hooksOk && commandsOk,
        configOk,
        settingsOk,
        hooksOk,
        commandsOk,
        mismatches
    };
}
// ============================================================================
// EXPORTS
// ============================================================================
export default {
    runConfigSync,
    checkConfigHealth,
    syncHookFiles,
    syncCommandFiles,
    syncProjectConfigs
};
// Named export for direct use
export { syncProjectConfigs };
// Export path constants for use by other modules
export const paths = {
    CLAUDE_DIR,
    CONFIG_PATH,
    SETTINGS_PATH,
    HOOKS_DIR,
    COMMANDS_DIR,
    BOOTSTRAP_PATH,
    SOURCE_HOOKS_DIR,
    SOURCE_COMMANDS_DIR
};
//# sourceMappingURL=configSync.js.map