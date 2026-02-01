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
export interface InjectionResult {
    success: boolean;
    mcpServerConfigured: boolean;
    settingsUpdated: boolean;
    hooksCopied: string[];
    commandsCopied: string[];
    permissionsAdded: string[];
    /** Hooks dynamically added to settings.json */
    hooksAdded: string[];
    instancesPatched: number;
    /** Number of project-level MCP configs fixed in ~/.claude.json */
    projectConfigsFixed: number;
    errors: string[];
    alreadyConfigured: boolean;
    /** @deprecated Use permissionsAdded.length > 0 instead */
    bypassEnabled: boolean;
}
/**
 * Check if SpecMem MCP server is configured for the current project
 */
export declare function isSpecmemMcpConfigured(projectPath?: string): boolean;
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
declare function hotPatchRunningClaude(): number;
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
export declare function injectClaudeConfig(projectPath?: string): Promise<InjectionResult>;
/**
 * Check if SpecMem is fully configured in Claude
 */
export declare function isConfigInjected(): boolean;
/**
 * Get detailed installation status
 */
export declare function getInstallationStatus(): {
    config: boolean;
    settings: boolean;
    hooks: boolean;
    commands: boolean;
    fullyConfigured: boolean;
};
declare const _default: {
    injectClaudeConfig: typeof injectClaudeConfig;
    isConfigInjected: typeof isConfigInjected;
    isSpecmemMcpConfigured: typeof isSpecmemMcpConfigured;
    getInstallationStatus: typeof getInstallationStatus;
    hotPatchRunningClaude: typeof hotPatchRunningClaude;
};
export default _default;
export declare const paths: {
    CLAUDE_CONFIG_DIR: string;
    CONFIG_PATH: string;
    SETTINGS_PATH: string;
    HOOKS_DIR: string;
    COMMANDS_DIR: string;
    SPECMEM_ROOT: string;
    BOOTSTRAP_PATH: string;
    SOURCE_HOOKS_DIR: string;
    SOURCE_COMMANDS_DIR: string;
};
//# sourceMappingURL=claudeConfigInjector.d.ts.map