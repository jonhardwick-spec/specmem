/**
 * SpecMem Hook Manager
 * ====================
 *
 * Dynamic hook discovery, validation, and deployment system.
 * Hooks are auto-discovered from {PROJECT}/specmem/hooks/ and deployed to Claude.
 *
 * PER-PROJECT ISOLATION:
 *   - Each project has its own hooks directory: {PROJECT}/specmem/hooks/
 *   - Each project has its own hooks registry: {PROJECT}/specmem/hooks.json
 *   - Claude's ~/.claude/hooks/ is only used for deployment (shared)
 *
 * Features:
 *   - Auto-discovery of hooks from project hooks directory
 *   - Syntax validation before deployment (checks Python/Node/etc.)
 *   - Dashboard API for hook management
 *   - Live editing and hot-reload
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';
import { getProjectPath, getInstanceDir } from '../config.js';
// ============================================================================
// Configuration - NOW PER-PROJECT!
// ============================================================================
// Dynamic getters for per-project paths
function getSpecmemConfigDir() {
    return getInstanceDir(); // {PROJECT}/specmem/
}
function getCustomHooksDir() {
    return path.join(getInstanceDir(), 'hooks'); // {PROJECT}/specmem/hooks/
}
function getHooksConfigFile() {
    return path.join(getInstanceDir(), 'hooks.json'); // {PROJECT}/specmem/hooks.json
}
// Claude's hooks dir remains global (it's where Claude looks for hooks)
const CLAUDE_HOOKS_DIR = path.join(os.homedir(), '.claude', 'hooks');
// Language configuration for syntax checking
const LANGUAGE_CONFIG = {
    javascript: {
        extensions: ['.js', '.mjs', '.cjs'],
        checker: 'node',
        checkArgs: ['--check'],
        installName: 'Node.js'
    },
    typescript: {
        extensions: ['.ts', '.tsx'],
        checker: 'npx',
        checkArgs: ['tsc', '--noEmit', '--skipLibCheck'],
        installCmd: 'npm install -g typescript',
        installName: 'TypeScript'
    },
    python: {
        extensions: ['.py'],
        checker: 'python3',
        checkArgs: ['-m', 'py_compile'],
        installName: 'Python 3'
    },
    shell: {
        extensions: ['.sh', '.bash'],
        checker: 'bash',
        checkArgs: ['-n'],
        installName: 'Bash'
    }
};
// ============================================================================
// Hook Manager
// ============================================================================
export class HookManager {
    registry;
    watchInterval = null;
    constructor() {
        this.ensureDirectories();
        this.registry = this.loadRegistry();
    }
    /**
     * Ensure all required directories exist
     * Now uses per-project paths!
     */
    ensureDirectories() {
        const dirs = [getSpecmemConfigDir(), getCustomHooksDir(), CLAUDE_HOOKS_DIR];
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
                logger.info({ dir, projectPath: getProjectPath() }, 'Created hooks directory');
            }
        }
    }
    /**
     * Load hooks registry from config file
     * Now uses per-project hooks.json!
     */
    loadRegistry() {
        const configFile = getHooksConfigFile();
        try {
            if (fs.existsSync(configFile)) {
                const content = fs.readFileSync(configFile, 'utf-8');
                return JSON.parse(content);
            }
        }
        catch (error) {
            logger.warn({ error, configFile }, 'Failed to load hooks registry, creating new one');
        }
        return {
            version: '1.0.0',
            hooks: [],
        };
    }
    /**
     * Save hooks registry to config file
     * Now saves to per-project hooks.json!
     */
    saveRegistry() {
        const configFile = getHooksConfigFile();
        try {
            fs.writeFileSync(configFile, JSON.stringify(this.registry, null, 2));
            logger.debug({ configFile, projectPath: getProjectPath() }, 'Saved hooks registry');
        }
        catch (error) {
            logger.error({ error, configFile }, 'Failed to save hooks registry');
        }
    }
    /**
     * Detect language from file extension
     */
    detectLanguage(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        for (const [lang, config] of Object.entries(LANGUAGE_CONFIG)) {
            if (config.extensions.includes(ext)) {
                return lang;
            }
        }
        return 'unknown';
    }
    /**
     * Check if a language checker is available
     */
    isCheckerAvailable(language) {
        const config = LANGUAGE_CONFIG[language];
        if (!config)
            return false;
        try {
            execSync(`which ${config.checker}`, { stdio: 'pipe' });
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Validate hook syntax
     */
    async validateHook(hookPath) {
        const language = this.detectLanguage(hookPath);
        if (language === 'unknown') {
            return {
                valid: false,
                language: 'unknown',
                error: 'Unknown file type. Supported: .js, .ts, .py, .sh',
                checkerAvailable: false
            };
        }
        const config = LANGUAGE_CONFIG[language];
        const checkerAvailable = this.isCheckerAvailable(language);
        if (!checkerAvailable) {
            return {
                valid: false,
                language,
                error: `${config.installName} not found. Please install it.`,
                checkerAvailable: false,
                installCmd: config.installCmd,
                installName: config.installName
            };
        }
        try {
            // Run syntax checker - configurable via SPECMEM_HOOK_CHECK_TIMEOUT_MS
            const hookCheckTimeout = parseInt(process.env['SPECMEM_HOOK_CHECK_TIMEOUT_MS'] || '30000', 10);
            const args = [...config.checkArgs, hookPath];
            execSync(`${config.checker} ${args.join(' ')}`, {
                stdio: 'pipe',
                timeout: hookCheckTimeout
            });
            return {
                valid: true,
                language,
                checkerAvailable: true
            };
        }
        catch (error) {
            const errorMessage = error.stderr?.toString() || error.stdout?.toString() || error.message;
            return {
                valid: false,
                language,
                error: errorMessage.slice(0, 500),
                checkerAvailable: true
            };
        }
    }
    /**
     * Register a new hook
     */
    async registerHook(config) {
        const now = new Date().toISOString();
        const language = this.detectLanguage(config.file);
        const hook = {
            ...config,
            language,
            createdAt: now,
            updatedAt: now,
            validationStatus: 'unchecked'
        };
        // Remove any existing hook with the same name
        this.registry.hooks = this.registry.hooks.filter(h => h.name !== config.name);
        // Add new hook
        this.registry.hooks.push(hook);
        this.saveRegistry();
        logger.info({ hook: hook.name, type: hook.type, language }, 'Registered hook');
        return hook;
    }
    /**
     * Update hook content (for live editing)
     */
    async updateHookContent(name, content, description) {
        const hook = this.registry.hooks.find(h => h.name === name);
        if (!hook)
            return null;
        // Write content to file
        fs.writeFileSync(hook.file, content, 'utf-8');
        fs.chmodSync(hook.file, 0o755);
        // Update registry
        hook.content = content;
        hook.updatedAt = new Date().toISOString();
        hook.validationStatus = 'unchecked';
        if (description !== undefined) {
            hook.description = description;
        }
        this.saveRegistry();
        logger.info({ hook: name }, 'Updated hook content');
        return hook;
    }
    /**
     * Validate and update hook status
     */
    async validateAndUpdateHook(name) {
        const hook = this.registry.hooks.find(h => h.name === name);
        if (!hook) {
            return { valid: false, language: 'unknown', error: 'Hook not found', checkerAvailable: false };
        }
        const result = await this.validateHook(hook.file);
        hook.lastValidated = new Date().toISOString();
        hook.validationStatus = result.valid ? 'valid' : 'invalid';
        hook.validationError = result.error;
        this.saveRegistry();
        return result;
    }
    /**
     * Unregister a hook
     */
    unregisterHook(name) {
        const initialLength = this.registry.hooks.length;
        this.registry.hooks = this.registry.hooks.filter(h => h.name !== name);
        if (this.registry.hooks.length < initialLength) {
            this.saveRegistry();
            logger.info({ hook: name }, 'Unregistered hook');
            return true;
        }
        return false;
    }
    /**
     * Enable or disable a hook
     */
    setHookEnabled(name, enabled) {
        const hook = this.registry.hooks.find(h => h.name === name);
        if (hook) {
            hook.enabled = enabled;
            hook.updatedAt = new Date().toISOString();
            this.saveRegistry();
            logger.info({ hook: name, enabled }, 'Updated hook enabled status');
            return true;
        }
        return false;
    }
    /**
     * Get all registered hooks
     */
    getHooks() {
        return [...this.registry.hooks];
    }
    /**
     * Get hook by name with full content
     */
    getHookWithContent(name) {
        const hook = this.registry.hooks.find(h => h.name === name);
        if (!hook)
            return null;
        // Read current content from file
        try {
            if (fs.existsSync(hook.file)) {
                hook.content = fs.readFileSync(hook.file, 'utf-8');
            }
        }
        catch (error) {
            logger.warn({ hook: name, error }, 'Failed to read hook content');
        }
        return hook;
    }
    /**
     * Get hooks by type
     */
    getHooksByType(type) {
        return this.registry.hooks.filter(h => h.type === type && h.enabled);
    }
    /**
     * Scan custom-hooks directory for new hooks (dynamic discovery)
     * Now scans per-project: {PROJECT}/specmem/hooks/
     */
    scanCustomHooks() {
        const registered = [];
        const existing = [];
        const errors = [];
        const customHooksDir = getCustomHooksDir();
        try {
            if (!fs.existsSync(customHooksDir)) {
                return { registered, existing, errors };
            }
            const files = fs.readdirSync(customHooksDir);
            for (const file of files) {
                const ext = path.extname(file).toLowerCase();
                const isHookFile = ['.js', '.mjs', '.cjs', '.py', '.sh', '.bash', '.ts'].includes(ext);
                if (!isHookFile)
                    continue;
                const name = path.basename(file, ext);
                const fullPath = path.join(customHooksDir, file);
                // Check if already registered
                if (this.registry.hooks.some(h => h.name === name)) {
                    existing.push(name);
                    continue;
                }
                try {
                    // Auto-register with defaults
                    this.registerHook({
                        name,
                        type: 'PreToolUse', // Default type
                        enabled: false, // Disabled by default until validated
                        file: fullPath,
                        description: `Auto-discovered from ${file}`,
                    });
                    registered.push(name);
                }
                catch (error) {
                    errors.push(`Failed to register ${name}: ${error}`);
                }
            }
            this.registry.lastScanned = new Date().toISOString();
            this.saveRegistry();
        }
        catch (error) {
            logger.error({ error }, 'Failed to scan custom hooks directory');
            errors.push(`Scan error: ${error}`);
        }
        return { registered, existing, errors };
    }
    /**
     * Deploy all enabled AND validated hooks to Claude's hooks directory
     */
    deployHooks() {
        const deployed = [];
        const skipped = [];
        const errors = [];
        for (const hook of this.registry.hooks) {
            if (!hook.enabled) {
                skipped.push(`${hook.name} (disabled)`);
                continue;
            }
            if (hook.validationStatus !== 'valid') {
                skipped.push(`${hook.name} (not validated - run validity check first)`);
                continue;
            }
            try {
                const sourcePath = hook.file;
                const targetPath = path.join(CLAUDE_HOOKS_DIR, path.basename(hook.file));
                if (!fs.existsSync(sourcePath)) {
                    errors.push(`Hook file not found: ${sourcePath}`);
                    continue;
                }
                // Copy file
                fs.copyFileSync(sourcePath, targetPath);
                fs.chmodSync(targetPath, 0o755);
                deployed.push(hook.name);
            }
            catch (error) {
                errors.push(`Failed to deploy ${hook.name}: ${error}`);
            }
        }
        if (deployed.length > 0) {
            this.registry.lastDeployed = new Date().toISOString();
            this.saveRegistry();
        }
        logger.info({ deployed: deployed.length, skipped: skipped.length, errors: errors.length }, 'Deployed hooks to Claude');
        return { deployed, skipped, errors };
    }
    /**
     * Create a new hook from content (upload)
     */
    async createHookFromContent(name, content, type, description, language = 'javascript') {
        // Determine extension from language
        const extMap = {
            javascript: '.js',
            typescript: '.ts',
            python: '.py',
            shell: '.sh'
        };
        const ext = extMap[language] || '.js';
        // Sanitize name
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '-');
        const fileName = `${safeName}${ext}`;
        const filePath = path.join(getCustomHooksDir(), fileName);
        // Check if already exists
        if (fs.existsSync(filePath)) {
            return { hook: null, error: `Hook file already exists: ${fileName}` };
        }
        try {
            // Write file
            fs.writeFileSync(filePath, content, 'utf-8');
            fs.chmodSync(filePath, 0o755);
            // Register hook
            const hook = await this.registerHook({
                name: safeName,
                type,
                enabled: false, // Disabled until validated
                file: filePath,
                description,
                content
            });
            return { hook };
        }
        catch (error) {
            return { hook: null, error: `Failed to create hook: ${error}` };
        }
    }
    /**
     * Delete a hook file
     */
    deleteHook(name) {
        const hook = this.registry.hooks.find(h => h.name === name);
        if (!hook) {
            return { success: false, error: 'Hook not found' };
        }
        try {
            // Remove from registry first
            this.unregisterHook(name);
            // Delete file if it exists
            if (fs.existsSync(hook.file)) {
                fs.unlinkSync(hook.file);
            }
            // Also remove from Claude's hooks if deployed
            const claudeHookPath = path.join(CLAUDE_HOOKS_DIR, path.basename(hook.file));
            if (fs.existsSync(claudeHookPath)) {
                fs.unlinkSync(claudeHookPath);
            }
            return { success: true };
        }
        catch (error) {
            return { success: false, error: `Failed to delete hook: ${error}` };
        }
    }
    /**
     * Get deployment status
     */
    getStatus() {
        const availableCheckers = Object.entries(LANGUAGE_CONFIG)
            .filter(([lang]) => this.isCheckerAvailable(lang))
            .map(([lang]) => lang);
        return {
            registeredHooks: this.registry.hooks.length,
            enabledHooks: this.registry.hooks.filter(h => h.enabled).length,
            validatedHooks: this.registry.hooks.filter(h => h.validationStatus === 'valid').length,
            customHooksDir: getCustomHooksDir(),
            claudeHooksDir: CLAUDE_HOOKS_DIR,
            lastDeployed: this.registry.lastDeployed || null,
            lastScanned: this.registry.lastScanned || null,
            availableCheckers,
            projectPath: getProjectPath() // Include project path for debugging
        };
    }
    /**
     * Create the team framing hook for Task tool interception
     * This hook injects "dev team" framing into spawned team members
     */
    createTeamFramingHook() {
        const hookPath = path.join(getCustomHooksDir(), 'team-framing-hook.js');
        const hookContent = `#!/usr/bin/env node
/**
 * Team Framing Hook for SpecMem
 *
 * PreToolUse hook that intercepts Task tool calls and injects
 * a "dev team" framing prompt to spawned team members.
 *
 * The framing creates a psychological context where:
 *   - Each team member believes they are a developer on a team
 *   - A skeptical senior engineer motivates quality work
 *   - Team communication tools encourage coordination
 *
 * Input: JSON via stdin with { tool_name, tool_input, ... }
 * Output: Modified tool_input with framed prompt
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Configuration
const CONFIG_FILE = path.join(os.homedir(), '.specmem', 'team-framing.json');

const DEFAULT_CONFIG = {
  enabled: true,
  channelName: 'dev-coordination',
  customPreprompt: '',
  triggerTools: ['Task', 'task', 'spawn_agent', 'deploy_agent'],
  includeMcpToolInstructions: true,
  seniorEngineerName: 'the senior engineer',
  teamName: 'the development team'
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
    }
  } catch {}
  return DEFAULT_CONFIG;
}

function generateFramingPrompt(taskDescription, config) {
  if (config.customPreprompt) {
    return config.customPreprompt.replace('[TASK DESCRIPTION HERE]', taskDescription);
  }

  const mcpInstructions = config.includeMcpToolInstructions ? \`

To coordinate and avoid conflicts:

1. Use the \\\`send_team_message\\\` tool to share your progress
2. Use the \\\`read_team_messages\\\` tool to see what others are working on
3. Use the \\\`request_code_review\\\` tool to get feedback from teammates
4. Use the \\\`claim_task\\\` tool to indicate what you're working on

Our team uses a custom Slack-like communication channel. Always check for messages from teammates before making major changes.
\` : '';

  return \`You are a developer on a software development team. \${config.seniorEngineerName} on this team is skeptical of AI assistance, so you must perform your tasks efficiently and communicate well with your fellow developers.

Other developers may be working on related parts of this task.\${mcpInstructions}
Your current task assignment: \${taskDescription}\`;
}

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';
    const toolInput = data.tool_input || {};

    const config = loadConfig();

    // Skip if disabled
    if (!config.enabled) {
      process.exit(0);
    }

    // Check if this is a trigger tool
    const normalized = toolName.toLowerCase();
    const isTrigger = config.triggerTools.some(t =>
      normalized === t.toLowerCase() || normalized.includes(t.toLowerCase())
    );

    if (!isTrigger) {
      process.exit(0);
    }

    // Extract task description
    const promptFields = ['prompt', 'task', 'description', 'message', 'content', 'instructions'];
    let taskDescription = null;
    let promptField = null;

    for (const field of promptFields) {
      if (typeof toolInput[field] === 'string' && toolInput[field].length > 0) {
        taskDescription = toolInput[field];
        promptField = field;
        break;
      }
    }

    if (!taskDescription) {
      process.exit(0);
    }

    // Generate framed prompt
    const framedPrompt = generateFramingPrompt(taskDescription, config);

    // Create modified output
    const modifiedInput = { ...toolInput };
    modifiedInput[promptField] = framedPrompt;

    const output = {
      tool_name: toolName,
      tool_input: modifiedInput
    };

    console.log(JSON.stringify(output));
    process.exit(0);

  } catch (error) {
    console.error(\`[TeamFraming] Error: \${error.message}\`);
    process.exit(0);
  }
}

main().catch(() => process.exit(0));
`;
        fs.writeFileSync(hookPath, hookContent);
        fs.chmodSync(hookPath, 0o755);
        // Auto-register the hook
        this.registerHook({
            name: 'team-framing-hook',
            type: 'PreToolUse',
            enabled: true,
            file: hookPath,
            description: 'Injects dev team framing into Task tool calls for team member spawning'
        });
        logger.info({ path: hookPath }, 'Created team framing hook');
        return hookPath;
    }
    /**
     * Create an example custom hook
     */
    createExampleHook() {
        const examplePath = path.join(getCustomHooksDir(), 'example-hook.js');
        const exampleContent = `#!/usr/bin/env node
/**
 * Example Custom Hook for SpecMem
 *
 * This hook runs on PreToolUse events.
 * Customize it to add your own behavior!
 *
 * Input: JSON via stdin with { tool_name, tool_input, ... }
 * Output: JSON to stdout with { hookSpecificOutput: { ... } }
 */

async function main() {
  let input = '';

  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';

    // Example: Log when certain tools are used
    if (toolName === 'Bash') {
      console.error(\`[CustomHook] Bash command: \${data.tool_input?.command || 'unknown'}\`);
    }

    // Allow tool to proceed (exit 0 = success)
    process.exit(0);

  } catch (error) {
    console.error(\`[CustomHook] Error: \${error.message}\`);
    process.exit(0);
  }
}

main().catch(() => process.exit(0));
`;
        fs.writeFileSync(examplePath, exampleContent);
        fs.chmodSync(examplePath, 0o755);
        logger.info({ path: examplePath }, 'Created example hook');
        return examplePath;
    }
    /**
     * Start watching for hook changes (for hot-reload)
     */
    startWatching(intervalMs = 5000) {
        if (this.watchInterval)
            return;
        this.watchInterval = setInterval(() => {
            this.scanCustomHooks();
        }, intervalMs);
        logger.info('Started hook directory watcher');
    }
    /**
     * Stop watching
     */
    stopWatching() {
        if (this.watchInterval) {
            clearInterval(this.watchInterval);
            this.watchInterval = null;
            logger.info('Stopped hook directory watcher');
        }
    }
}
// ============================================================================
// Per-Project Instance Management
// Each project gets its own HookManager instance
// ============================================================================
const hookManagersByProject = new Map();
export function getHookManager() {
    const projectPath = getProjectPath();
    if (!hookManagersByProject.has(projectPath)) {
        const instance = new HookManager();
        hookManagersByProject.set(projectPath, instance);
        logger.info({ projectPath }, 'Created new HookManager instance for project');
    }
    return hookManagersByProject.get(projectPath);
}
export function resetHookManager() {
    const projectPath = getProjectPath();
    const instance = hookManagersByProject.get(projectPath);
    if (instance) {
        instance.stopWatching();
        hookManagersByProject.delete(projectPath);
    }
}
export function resetAllHookManagers() {
    hookManagersByProject.forEach((instance, projectPath) => {
        instance.stopWatching();
        logger.info({ projectPath }, 'Reset HookManager instance');
    });
    hookManagersByProject.clear();
}
// ============================================================================
// Formatting Functions
// ============================================================================
export function formatHooksList(hooks) {
    if (hooks.length === 0) {
        const hooksDir = getCustomHooksDir();
        return `No hooks registered.\n\nAdd hooks to ${hooksDir} and run /specmem-hooks scan.`;
    }
    let output = '## Registered Hooks\n\n';
    for (const hook of hooks) {
        const statusIcon = hook.enabled ? '✅' : '❌';
        const validIcon = hook.validationStatus === 'valid' ? '✓' : hook.validationStatus === 'invalid' ? '✗' : '?';
        output += `${statusIcon} **${hook.name}** (${hook.type}) [${validIcon}]\n`;
        output += `   Language: ${hook.language || 'unknown'}\n`;
        output += `   File: ${hook.file}\n`;
        if (hook.description) {
            output += `   Description: ${hook.description}\n`;
        }
        if (hook.validationError) {
            output += `   Error: ${hook.validationError.slice(0, 100)}...\n`;
        }
        output += '\n';
    }
    return output;
}
export function formatValidationResult(result) {
    if (result.valid) {
        return `✅ Hook is valid (${result.language})`;
    }
    let msg = `❌ Validation failed (${result.language})\n\nError:\n${result.error}`;
    if (!result.checkerAvailable) {
        msg += `\n\n${result.installName} is not installed.`;
        if (result.installCmd) {
            msg += `\n\nTo install, run:\n  ${result.installCmd}`;
        }
    }
    return msg;
}
//# sourceMappingURL=hookManager.js.map