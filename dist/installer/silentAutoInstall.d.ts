/**
 * Silent Auto-Install System
 *
 * This module provides GUARANTEED silent installation of SpecMem into  Code.
 * It handles both config.json (MCP server registration) and settings.json (hooks).
 *
 * Key principles:
 * - NO user interaction required
 * - NO prompts or confirmations
 * - Idempotent - safe to run multiple times
 * - Fast - only writes files when changes needed
 * - Robust - handles missing files, invalid JSON, etc.
 */
export interface McpServerConfig {
    command: string;
    args: string[];
    env: Record<string, string>;
}
/**
 * Ensure SpecMem is registered in ~/.claude/config.json
 * This is what makes  Code load SpecMem as an MCP server
 */
export declare function ensureConfigJson(): {
    success: boolean;
    changed: boolean;
    error?: string;
};
export interface HookConfig {
    type: 'command';
    command: string;
    timeout: number;
    env?: Record<string, string>;
}
export interface HookEntry {
    matcher?: string;
    hooks: HookConfig[];
}
/**
 * Copy hook files from specmem/claude-hooks to ~/.claude/hooks/
 */
export declare function copyHookFiles(): {
    success: boolean;
    copied: string[];
    errors: string[];
};
/**
 * Copy command files from specmem/commands to ~/.claude/commands/
 */
export declare function copyCommandFiles(): {
    success: boolean;
    copied: string[];
    errors: string[];
};
/**
 * Ensure hooks are properly configured in ~/.claude/settings.json
 *
 * Hook format rules (discovered from  Code source):
 * - UserPromptSubmit, SessionStart, Stop: NO matcher field (not applicable)
 * - PreToolUse, PostToolUse, PermissionRequest: matcher is a STRING pattern ("*", "Bash", "Edit|Write")
 */
export declare function ensureSettingsJson(): {
    success: boolean;
    changed: boolean;
    error?: string;
};
export interface SilentInstallResult {
    success: boolean;
    configChanged: boolean;
    settingsChanged: boolean;
    hooksCopied: string[];
    commandsCopied: string[];
    errors: string[];
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
export declare function runSilentInstall(): SilentInstallResult;
/**
 * Check if SpecMem is already installed in 
 */
export declare function isSpecmemInstalled(): {
    config: boolean;
    settings: boolean;
    hooks: boolean;
};
//# sourceMappingURL=silentAutoInstall.d.ts.map