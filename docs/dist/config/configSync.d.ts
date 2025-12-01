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
export interface ConfigSyncResult {
    success: boolean;
    configFixed: boolean;
    settingsFixed: boolean;
    projectsFixed: string[];
    hooksSynced: boolean;
    commandsSynced: boolean;
    mismatches: ConfigMismatch[];
    errors: string[];
}
export interface ConfigMismatch {
    file: 'config.json' | 'settings.json';
    field: string;
    expected: string;
    actual: string | undefined;
    fixed: boolean;
}
export interface HealthCheckResult {
    healthy: boolean;
    configOk: boolean;
    settingsOk: boolean;
    hooksOk: boolean;
    commandsOk: boolean;
    mismatches: ConfigMismatch[];
}
/**
 * Sync project-level MCP configurations in ~/.claude.json
 *
 * Claude Code stores per-project configs under `projects -> {path} -> mcpServers`
 * These can become stale when credentials change. This function automatically
 * fixes stale specmem env vars in all project entries.
 *
 * ROOT CAUSE FIX: When user runs Claude in different projects, each project
 * gets its own MCP config snapshot. If the master credentials change, these
 * per-project snapshots become stale and cause "permission denied" errors.
 */
declare function syncProjectConfigs(): {
    fixed: boolean;
    projectsFixed: string[];
    error?: string;
};
/**
 * Sync hook files from source to ~/.claude/hooks/
 */
declare function syncHookFiles(): {
    synced: boolean;
    files: string[];
    errors: string[];
};
/**
 * Sync command files from source to ~/.claude/commands/
 */
declare function syncCommandFiles(): {
    synced: boolean;
    files: string[];
    errors: string[];
};
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
export declare function runConfigSync(): ConfigSyncResult;
/**
 * Check config health without making changes
 *
 * Returns current state of all config files
 */
export declare function checkConfigHealth(): HealthCheckResult;
declare const _default: {
    runConfigSync: typeof runConfigSync;
    checkConfigHealth: typeof checkConfigHealth;
    syncHookFiles: typeof syncHookFiles;
    syncCommandFiles: typeof syncCommandFiles;
    syncProjectConfigs: typeof syncProjectConfigs;
};
export default _default;
export { syncProjectConfigs };
export declare const paths: {
    CLAUDE_DIR: string;
    CONFIG_PATH: string;
    SETTINGS_PATH: string;
    HOOKS_DIR: string;
    COMMANDS_DIR: string;
    BOOTSTRAP_PATH: string;
    SOURCE_HOOKS_DIR: string;
    SOURCE_COMMANDS_DIR: string;
};
//# sourceMappingURL=configSync.d.ts.map