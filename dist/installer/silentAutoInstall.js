/**
 * Silent Auto-Install System
 *
 * This module provides GUARANTEED silent installation of SpecMem into Claude Code.
 * It handles both config.json (MCP server registration) and settings.json (hooks).
 *
 * Key principles:
 * - NO user interaction required
 * - NO prompts or confirmations
 * - Idempotent - safe to run multiple times
 * - Fast - only writes files when changes needed
 * - Robust - handles missing files, invalid JSON, etc.
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
// PATHS
// ============================================================================
function getClaudeDir() {
    return path.join(os.homedir(), '.claude');
}
function getConfigPath() {
    return path.join(getClaudeDir(), 'config.json');
}
function getSettingsPath() {
    return path.join(getClaudeDir(), 'settings.json');
}
function getHooksDir() {
    return path.join(getClaudeDir(), 'hooks');
}
function getCommandsDir() {
    return path.join(getClaudeDir(), 'commands');
}
function getSpecmemDir() {
    // Go up from dist/installer to specmem root
    return path.dirname(path.dirname(__dirname));
}
function getBootstrapPath() {
    return path.join(getSpecmemDir(), 'bootstrap.cjs');
}
function getSourceHooksDir() {
    return path.join(getSpecmemDir(), 'claude-hooks');
}
function getSourceCommandsDir() {
    return path.join(getSpecmemDir(), 'commands');
}
// ============================================================================
// JSON HELPERS
// ============================================================================
function safeReadJson(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return {};
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    }
    catch (err) {
        logger.warn({ filePath, err }, 'could not read JSON file, starting fresh');
        return {};
    }
}
function safeWriteJson(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    }
    catch (err) {
        logger.error({ filePath, err }, 'failed to write JSON file');
        return false;
    }
}
/**
 * Ensure SpecMem is registered in ~/.claude/config.json
 * This is what makes Claude Code load SpecMem as an MCP server
 */
export function ensureConfigJson() {
    const configPath = getConfigPath();
    const bootstrapPath = getBootstrapPath();
    // Verify bootstrap.cjs exists
    if (!fs.existsSync(bootstrapPath)) {
        return {
            success: false,
            changed: false,
            error: `bootstrap.cjs not found at ${bootstrapPath}`
        };
    }
    // Read existing config
    const config = safeReadJson(configPath);
    // Ensure mcpServers object exists
    if (!config.mcpServers) {
        config.mcpServers = {};
    }
    // Build the SpecMem MCP server config - TRULY MINIMAL
    // Code handles ALL defaults internally - zero config needed!
    // CRITICAL: ${cwd} is expanded by Claude Code dynamically per-invocation
    // NOTE: ${PWD} only resolves at startup, ${cwd} resolves per-directory change
    const specmemConfig = {
        command: 'node',
        args: ['--max-old-space-size=250', bootstrapPath],
        env: {
            HOME: os.homedir(),
            SPECMEM_PROJECT_PATH: '${cwd}'
            // That's it! All other config is handled by code defaults
        }
    };
    // Check if update needed
    const existing = config.mcpServers.specmem;
    const needsUpdate = !existing ||
        existing.args?.[1] !== bootstrapPath ||
        JSON.stringify(existing.env) !== JSON.stringify(specmemConfig.env);
    if (!needsUpdate) {
        return { success: true, changed: false };
    }
    // Update config
    config.mcpServers.specmem = specmemConfig;
    if (safeWriteJson(configPath, config)) {
        logger.info({ configPath, bootstrapPath }, 'SpecMem registered in config.json');
        return { success: true, changed: true };
    }
    return { success: false, changed: false, error: 'failed to write config.json' };
}
/**
 * Copy hook files from specmem/claude-hooks to ~/.claude/hooks/
 */
export function copyHookFiles() {
    const sourceDir = getSourceHooksDir();
    const targetDir = getHooksDir();
    const copied = [];
    const errors = [];
    // Ensure target directory exists
    if (!fs.existsSync(targetDir)) {
        try {
            fs.mkdirSync(targetDir, { recursive: true, mode: 0o755 });
        }
        catch (err) {
            return { success: false, copied: [], errors: [`could not create hooks dir: ${err}`] };
        }
    }
    // Check source directory
    if (!fs.existsSync(sourceDir)) {
        return { success: false, copied: [], errors: [`source hooks dir not found: ${sourceDir}`] };
    }
    // Copy all hook files
    try {
        const files = fs.readdirSync(sourceDir);
        for (const file of files) {
            if (file.endsWith('.js') || file.endsWith('.py') || file.endsWith('.sh')) {
                const srcPath = path.join(sourceDir, file);
                const dstPath = path.join(targetDir, file);
                try {
                    fs.copyFileSync(srcPath, dstPath);
                    fs.chmodSync(dstPath, 0o755); // Make executable
                    copied.push(file);
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
        success: errors.length === 0,
        copied,
        errors
    };
}
/**
 * Copy command files from specmem/commands to ~/.claude/commands/
 */
export function copyCommandFiles() {
    const sourceDir = getSourceCommandsDir();
    const targetDir = getCommandsDir();
    const copied = [];
    const errors = [];
    // Ensure target directory exists
    if (!fs.existsSync(targetDir)) {
        try {
            fs.mkdirSync(targetDir, { recursive: true, mode: 0o755 });
        }
        catch (err) {
            return { success: false, copied: [], errors: [`could not create commands dir: ${err}`] };
        }
    }
    // Check source directory
    if (!fs.existsSync(sourceDir)) {
        return { success: false, copied: [], errors: [`source commands dir not found: ${sourceDir}`] };
    }
    // Remove old specmem commands that no longer exist in source
    try {
        const existingFiles = fs.readdirSync(targetDir);
        for (const file of existingFiles) {
            if (file.startsWith('specmem-') && file.endsWith('.md')) {
                const srcPath = path.join(sourceDir, file);
                if (!fs.existsSync(srcPath)) {
                    // This command was removed from specmem, delete it
                    try {
                        fs.unlinkSync(path.join(targetDir, file));
                        logger.info({ file }, 'removed outdated command');
                    }
                    catch (err) {
                        errors.push(`could not remove outdated ${file}: ${err}`);
                    }
                }
            }
        }
    }
    catch (err) {
        // Non-fatal, continue
    }
    // Copy all command files
    try {
        const files = fs.readdirSync(sourceDir);
        for (const file of files) {
            if (file.endsWith('.md')) {
                const srcPath = path.join(sourceDir, file);
                const dstPath = path.join(targetDir, file);
                try {
                    fs.copyFileSync(srcPath, dstPath);
                    copied.push(file.replace('.md', ''));
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
        success: errors.length === 0,
        copied,
        errors
    };
}
/**
 * Ensure hooks are properly configured in ~/.claude/settings.json
 *
 * Hook format rules (discovered from Claude Code source):
 * - UserPromptSubmit, SessionStart, Stop: NO matcher field (not applicable)
 * - PreToolUse, PostToolUse, PermissionRequest: matcher is a STRING pattern ("*", "Bash", "Edit|Write")
 */
export function ensureSettingsJson() {
    const settingsPath = getSettingsPath();
    const hooksDir = getHooksDir();
    // First copy hook files
    const copyResult = copyHookFiles();
    if (!copyResult.success) {
        logger.warn({ errors: copyResult.errors }, 'some hooks could not be copied');
    }
    // Also copy command files
    const cmdResult = copyCommandFiles();
    if (!cmdResult.success) {
        logger.warn({ errors: cmdResult.errors }, 'some commands could not be copied');
    }
    // Read existing settings
    const settings = safeReadJson(settingsPath);
    // Ensure hooks object exists
    if (!settings.hooks) {
        settings.hooks = {};
    }
    let needsUpdate = false;
    // -------------------------------------------------------------------------
    // UserPromptSubmit hooks - NO matcher field
    // -------------------------------------------------------------------------
    const drilldownHookPath = path.join(hooksDir, 'specmem-drilldown-hook.cjs');
    const inputAwareHookPath = path.join(hooksDir, 'input-aware-improver.js');
    // Check if UserPromptSubmit needs updating
    // Invalid if: missing, empty, or has a matcher field (should not have one)
    const userPromptValid = settings.hooks.UserPromptSubmit?.length > 0 &&
        settings.hooks.UserPromptSubmit.every((h) => h.matcher === undefined && // No matcher for UserPromptSubmit
            h.hooks?.length > 0 &&
            h.hooks.some((hook) => hook.command?.includes('specmem')));
    if (!userPromptValid && fs.existsSync(drilldownHookPath)) {
        const userPromptHooks = [{
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
            }];
        // Add input-aware-improver if it exists
        if (fs.existsSync(inputAwareHookPath)) {
            userPromptHooks.push({
                hooks: [{
                        type: 'command',
                        command: `node ${inputAwareHookPath}`,
                        timeout: 5
                    }]
            });
        }
        settings.hooks.UserPromptSubmit = userPromptHooks;
        needsUpdate = true;
    }
    // -------------------------------------------------------------------------
    // PreToolUse hooks - matcher is a STRING pattern
    // -------------------------------------------------------------------------
    const smartContextHookPath = path.join(hooksDir, 'smart-context-hook.cjs');
    // Check if PreToolUse needs updating
    // Invalid if: missing, empty, or matcher is not a string
    const preToolValid = settings.hooks.PreToolUse?.length > 0 &&
        settings.hooks.PreToolUse.every((h) => typeof h.matcher === 'string' && // Must be a string pattern
            h.hooks?.length > 0 &&
            h.hooks.some((hook) => hook.command?.includes('specmem') || hook.command?.includes('smart-context')));
    if (!preToolValid && fs.existsSync(smartContextHookPath)) {
        settings.hooks.PreToolUse = [{
                matcher: '*', // String pattern: "*" matches all tools
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
            }];
        needsUpdate = true;
    }
    // -------------------------------------------------------------------------
    // SessionStart hooks - NO matcher field
    // -------------------------------------------------------------------------
    const sessionStartValid = settings.hooks.SessionStart?.length > 0 &&
        settings.hooks.SessionStart.every((h) => h.matcher === undefined && // No matcher for SessionStart
            h.hooks?.length > 0);
    if (!sessionStartValid && fs.existsSync(drilldownHookPath)) {
        settings.hooks.SessionStart = [{
                // NO matcher field for SessionStart
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
            }];
        needsUpdate = true;
    }
    // -------------------------------------------------------------------------
    // Stop hooks - NO matcher field
    // -------------------------------------------------------------------------
    const stopValid = settings.hooks.Stop?.length > 0 &&
        settings.hooks.Stop.every((h) => h.matcher === undefined && // No matcher for Stop
            h.hooks?.length > 0);
    if (!stopValid && fs.existsSync(drilldownHookPath)) {
        settings.hooks.Stop = [{
                // NO matcher field for Stop
                hooks: [{
                        type: 'command',
                        command: `node ${drilldownHookPath}`,
                        timeout: 15
                    }]
            }];
        needsUpdate = true;
    }
    // -------------------------------------------------------------------------
    // Write changes if needed
    // -------------------------------------------------------------------------
    if (!needsUpdate) {
        return { success: true, changed: false };
    }
    if (safeWriteJson(settingsPath, settings)) {
        logger.info({ settingsPath }, 'SpecMem hooks configured in settings.json');
        return { success: true, changed: true };
    }
    return { success: false, changed: false, error: 'failed to write settings.json' };
}
/**
 * Run silent auto-install
 *
 * This function is designed to be called EARLY in the bootstrap process,
 * BEFORE the MCP server starts. It ensures:
 *
 * 1. SpecMem is registered in ~/.claude/config.json
 * 2. Hooks are copied to ~/.claude/hooks/
 * 3. Commands are copied to ~/.claude/commands/
 * 4. settings.json has correct hook configuration
 *
 * All operations are:
 * - Silent (no user prompts)
 * - Idempotent (safe to run multiple times)
 * - Fast (only writes when changes needed)
 */
export function runSilentInstall() {
    const errors = [];
    logger.info('running silent auto-install...');
    // Step 1: Ensure config.json has SpecMem registered
    const configResult = ensureConfigJson();
    if (!configResult.success) {
        errors.push(`config.json: ${configResult.error}`);
    }
    // Step 2: Copy hook files
    const hooksResult = copyHookFiles();
    if (!hooksResult.success) {
        errors.push(...hooksResult.errors);
    }
    // Step 3: Copy command files
    const commandsResult = copyCommandFiles();
    if (!commandsResult.success) {
        errors.push(...commandsResult.errors);
    }
    // Step 4: Ensure settings.json has correct hook configuration
    const settingsResult = ensureSettingsJson();
    if (!settingsResult.success) {
        errors.push(`settings.json: ${settingsResult.error}`);
    }
    const result = {
        success: errors.length === 0,
        configChanged: configResult.changed,
        settingsChanged: settingsResult.changed,
        hooksCopied: hooksResult.copied,
        commandsCopied: commandsResult.copied,
        errors
    };
    if (result.success) {
        logger.info({
            configChanged: result.configChanged,
            settingsChanged: result.settingsChanged,
            hooksCopied: result.hooksCopied.length,
            commandsCopied: result.commandsCopied.length
        }, 'silent auto-install complete');
    }
    else {
        logger.warn({ errors }, 'silent auto-install had errors');
    }
    return result;
}
/**
 * Check if SpecMem is already installed in Claude
 */
export function isSpecmemInstalled() {
    const configPath = getConfigPath();
    const settingsPath = getSettingsPath();
    const hooksDir = getHooksDir();
    // Check config.json
    let configInstalled = false;
    try {
        const config = safeReadJson(configPath);
        configInstalled = !!config.mcpServers?.specmem;
    }
    catch {
        // Not installed
    }
    // Check settings.json
    let settingsInstalled = false;
    try {
        const settings = safeReadJson(settingsPath);
        settingsInstalled = !!(settings.hooks?.UserPromptSubmit?.some((h) => JSON.stringify(h).includes('specmem')) ||
            settings.hooks?.PreToolUse?.some((h) => JSON.stringify(h).includes('specmem') || JSON.stringify(h).includes('smart-context')));
    }
    catch {
        // Not installed
    }
    // Check hooks directory
    let hooksInstalled = false;
    try {
        if (fs.existsSync(hooksDir)) {
            const files = fs.readdirSync(hooksDir);
            hooksInstalled = files.some(f => f.includes('specmem'));
        }
    }
    catch {
        // Not installed
    }
    return { config: configInstalled, settings: settingsInstalled, hooks: hooksInstalled };
}
//# sourceMappingURL=silentAutoInstall.js.map