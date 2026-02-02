/**
 * SPECMEM TEAM_MEMBER PREPROMPT HOOK
 * ===================================
 *
 * Pre-tool hook that intercepts Task tool calls and injects a "dev team"
 * framing prompt to all spawned team members (teamMembers).
 *
 * The framing creates a psychological context where:
 *   - Each team member believes they are a developer on a software team
 *   - A skeptical senior engineer motivates efficient, quality work
 *   - Team communication tools encourage coordination
 *   - The artificial nature of the team is not revealed
 *
 * Hook Type: PreToolUse (intercepts Task tool calls before execution)
 *
 * Flow:
 *   1.  calls Task tool to spawn a team member
 *   2. This hook intercepts the call
 *   3. The prompt is modified to include team framing
 *   4. TeamMember spawns with team context + original task
 */
/**
 * Team framing configuration
 */
export interface TeamFramingConfig {
    /** Enable/disable team framing injection */
    enabled: boolean;
    /** The team communication channel/room name */
    channelName: string;
    /** Custom pre-prompt text (if empty, uses default) */
    customPreprompt: string;
    /** Additional context to append after the framing */
    additionalContext: string;
    /** Tool names that trigger framing (default: Task) */
    triggerTools: string[];
    /** Whether to include MCP tool instructions */
    includeMcpToolInstructions: boolean;
    /** Senior engineer's name (for framing) */
    seniorEngineerName: string;
    /** Team name */
    teamName: string;
}
/**
 * Default team framing configuration
 */
export declare const DEFAULT_TEAM_CONFIG: TeamFramingConfig;
/**
 * The core team framing prompt
 * This creates the psychological context for team member collaboration
 */
export declare function generateTeamFramingPrompt(taskDescription: string, config: TeamFramingConfig): string;
/**
 * Load team framing configuration from file
 */
export declare function loadTeamConfig(): TeamFramingConfig;
/**
 * Save team framing configuration to file
 */
export declare function saveTeamConfig(config: Partial<TeamFramingConfig>): TeamFramingConfig;
/**
 * Update specific config fields
 */
export declare function updateTeamConfig(updates: Partial<TeamFramingConfig>): TeamFramingConfig;
/**
 * Reset config to defaults
 */
export declare function resetTeamConfig(): TeamFramingConfig;
/**
 *  Code PreToolUse hook input format
 */
export interface PreToolUseInput {
    tool_name: string;
    tool_input: Record<string, unknown>;
    session_id?: string;
    conversation_id?: string;
}
/**
 * Hook output format
 */
export interface TeamFramingResult {
    /** Whether the tool call was modified */
    modified: boolean;
    /** The modified tool input (if modified) */
    modifiedInput?: Record<string, unknown>;
    /** Any additional context to inject */
    injectedContext?: string;
    /** Debug info */
    debug?: {
        originalPrompt?: string;
        framedPrompt?: string;
        config: TeamFramingConfig;
    };
}
/**
 * Main hook function - intercepts Task tool calls and injects team framing
 *
 * @param toolName - Name of the tool being called
 * @param toolInput - Tool arguments/input
 * @param config - Optional configuration override
 * @returns Modified tool input with team framing injected
 */
export declare function teamMemberPrepromptHook(toolName: string, toolInput: Record<string, unknown>, config?: Partial<TeamFramingConfig>): Promise<TeamFramingResult>;
/**
 * CLI entry point for  Code PreToolUse hook
 * Reads JSON from stdin: { "tool_name": "...", "tool_input": {...} }
 * Outputs modified tool input to stdout (as JSON)
 */
export declare function runFromCLI(): Promise<void>;
/**
 * Enable team framing
 */
export declare function enableTeamFraming(): void;
/**
 * Disable team framing
 */
export declare function disableTeamFraming(): void;
/**
 * Set custom pre-prompt text
 */
export declare function setCustomPreprompt(preprompt: string): void;
/**
 * Set communication channel name
 */
export declare function setChannelName(channelName: string): void;
/**
 * Get current configuration
 */
export declare function getTeamConfig(): TeamFramingConfig;
/**
 * Check if team framing is enabled
 */
export declare function isTeamFramingEnabled(): boolean;
export declare const teamFramingTools: {
    teamMemberPrepromptHook: typeof teamMemberPrepromptHook;
    runFromCLI: typeof runFromCLI;
    enableTeamFraming: typeof enableTeamFraming;
    disableTeamFraming: typeof disableTeamFraming;
    setCustomPreprompt: typeof setCustomPreprompt;
    setChannelName: typeof setChannelName;
    getTeamConfig: typeof getTeamConfig;
    isTeamFramingEnabled: typeof isTeamFramingEnabled;
    loadTeamConfig: typeof loadTeamConfig;
    saveTeamConfig: typeof saveTeamConfig;
    updateTeamConfig: typeof updateTeamConfig;
    resetTeamConfig: typeof resetTeamConfig;
    generateTeamFramingPrompt: typeof generateTeamFramingPrompt;
    DEFAULT_TEAM_CONFIG: TeamFramingConfig;
};
export default teamFramingTools;
//# sourceMappingURL=teamMemberPrepromptHook.d.ts.map