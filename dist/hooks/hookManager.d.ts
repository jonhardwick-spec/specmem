/**
 * SpecMem Hook Manager
 * ====================
 *
 * Dynamic hook discovery, validation, and deployment system.
 * Hooks are auto-discovered from {PROJECT}/specmem/hooks/ and deployed to .
 *
 * PER-PROJECT ISOLATION:
 *   - Each project has its own hooks directory: {PROJECT}/specmem/hooks/
 *   - Each project has its own hooks registry: {PROJECT}/specmem/hooks.json
 *   - 's ~/.claude/hooks/ is only used for deployment (shared)
 *
 * Features:
 *   - Auto-discovery of hooks from project hooks directory
 *   - Syntax validation before deployment (checks Python/Node/etc.)
 *   - Dashboard API for hook management
 *   - Live editing and hot-reload
 */
export interface HookConfig {
    name: string;
    type: 'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit' | 'AssistantResponse';
    enabled: boolean;
    file: string;
    timeout?: number;
    env?: Record<string, string>;
    description?: string;
    language?: string;
    content?: string;
    createdAt: string;
    updatedAt: string;
    lastValidated?: string;
    validationStatus?: 'valid' | 'invalid' | 'unchecked';
    validationError?: string;
}
export interface HooksRegistry {
    version: string;
    hooks: HookConfig[];
    lastDeployed?: string;
    lastScanned?: string;
}
export interface ValidationResult {
    valid: boolean;
    language: string;
    error?: string;
    checkerAvailable: boolean;
    installCmd?: string;
    installName?: string;
}
export declare class HookManager {
    private registry;
    private watchInterval;
    constructor();
    /**
     * Ensure all required directories exist
     * Now uses per-project paths!
     */
    private ensureDirectories;
    /**
     * Load hooks registry from config file
     * Now uses per-project hooks.json!
     */
    private loadRegistry;
    /**
     * Save hooks registry to config file
     * Now saves to per-project hooks.json!
     */
    private saveRegistry;
    /**
     * Detect language from file extension
     */
    detectLanguage(filePath: string): string;
    /**
     * Check if a language checker is available
     */
    isCheckerAvailable(language: string): boolean;
    /**
     * Validate hook syntax
     */
    validateHook(hookPath: string): Promise<ValidationResult>;
    /**
     * Register a new hook
     */
    registerHook(config: Omit<HookConfig, 'createdAt' | 'updatedAt'>): Promise<HookConfig>;
    /**
     * Update hook content (for live editing)
     */
    updateHookContent(name: string, content: string, description?: string): Promise<HookConfig | null>;
    /**
     * Validate and update hook status
     */
    validateAndUpdateHook(name: string): Promise<ValidationResult>;
    /**
     * Unregister a hook
     */
    unregisterHook(name: string): boolean;
    /**
     * Enable or disable a hook
     */
    setHookEnabled(name: string, enabled: boolean): boolean;
    /**
     * Get all registered hooks
     */
    getHooks(): HookConfig[];
    /**
     * Get hook by name with full content
     */
    getHookWithContent(name: string): HookConfig | null;
    /**
     * Get hooks by type
     */
    getHooksByType(type: HookConfig['type']): HookConfig[];
    /**
     * Scan custom-hooks directory for new hooks (dynamic discovery)
     * Now scans per-project: {PROJECT}/specmem/hooks/
     */
    scanCustomHooks(): {
        registered: string[];
        existing: string[];
        errors: string[];
    };
    /**
     * Deploy all enabled AND validated hooks to 's hooks directory
     */
    deployHooks(): {
        deployed: string[];
        skipped: string[];
        errors: string[];
    };
    /**
     * Create a new hook from content (upload)
     */
    createHookFromContent(name: string, content: string, type: HookConfig['type'], description: string, language?: string): Promise<{
        hook: HookConfig | null;
        error?: string;
    }>;
    /**
     * Delete a hook file
     */
    deleteHook(name: string): {
        success: boolean;
        error?: string;
    };
    /**
     * Get deployment status
     */
    getStatus(): {
        registeredHooks: number;
        enabledHooks: number;
        validatedHooks: number;
        customHooksDir: string;
        claudeHooksDir: string;
        lastDeployed: string | null;
        lastScanned: string | null;
        availableCheckers: string[];
        projectPath: string;
    };
    /**
     * Create the team framing hook for Task tool interception
     * This hook injects "dev team" framing into spawned team members
     */
    createTeamFramingHook(): string;
    /**
     * Create an example custom hook
     */
    createExampleHook(): string;
    /**
     * Start watching for hook changes (for hot-reload)
     */
    startWatching(intervalMs?: number): void;
    /**
     * Stop watching
     */
    stopWatching(): void;
}
export declare function getHookManager(): HookManager;
export declare function resetHookManager(): void;
export declare function resetAllHookManagers(): void;
export declare function formatHooksList(hooks: HookConfig[]): string;
export declare function formatValidationResult(result: ValidationResult): string;
//# sourceMappingURL=hookManager.d.ts.map