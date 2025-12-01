/**
 * SPECMEM HOOKS - Native Context Injection System
 * ===============================================
 *
 * This module exports the SpecMem hook system for Claude Code integration.
 *
 * Main hooks:
 *
 * 1. Context Injection Hook (contextInjectionHook)
 *    - Intercepts every prompt
 *    - Searches SpecMem for related memories
 *    - Injects context automatically
 *
 * 2. Drilldown Hook (drilldownHook)
 *    - Interactive memory retrieval
 *    - User controls depth, filtering, research
 *    - Full transparency into what context is gathered
 *
 * 3. Team Member Preprompt Hook (teamMemberPrepromptHook)
 *    - PreToolUse hook that intercepts Task tool calls
 *    - Injects "dev team" framing to spawned team members
 *    - Creates psychological context for team member collaboration
 *    - Includes team communication tool instructions
 *
 * Usage in Claude Code settings.json:
 * {
 *   "hooks": {
 *     "UserPromptSubmit": [
 *       {
 *         "hooks": [
 *           {
 *             "type": "command",
 *             "command": "node /server/mcp/specmem/dist/hooks/cli.js"
 *           }
 *         ]
 *       }
 *     ],
 *     "PreToolUse": [
 *       {
 *         "matcher": "Task",
 *         "hooks": [
 *           {
 *             "type": "command",
 *             "command": "node /server/mcp/specmem/dist/hooks/teamMemberPrepromptHook.js"
 *           }
 *         ]
 *       }
 *     ]
 *   }
 * }
 */
export { contextInjectionHook, searchRelatedMemories, formatContextInjection, DEFAULT_CONFIG } from './contextInjectionHook.js';
export { startDrilldown, changeDrilldownDepth, filterMemories, addWebResearch, getFinalContext, getDrilldownState, clearDrilldown, generateDrilldownQuestion, drilldownTools, DRILLDOWN_DEPTHS } from './drilldownHook.js';
// Low Context Compaction Hook
export { lowContextHook, forceCompact, getContextState, resetContextTracking, updateTokenCount, CONTEXT_LIMITS, THRESHOLDS } from './lowContextHook.js';
// Hook Manager - User-Manageable Hooks System
export { HookManager, getHookManager, resetHookManager, formatHooksList } from './hookManager.js';
// Team Member Preprompt Hook - Dev Team Framing for TeamMember Spawning
export { teamMemberPrepromptHook, teamFramingTools, generateTeamFramingPrompt, loadTeamConfig, saveTeamConfig, updateTeamConfig, resetTeamConfig, enableTeamFraming, disableTeamFraming, setCustomPreprompt, setChannelName, getTeamConfig, isTeamFramingEnabled, DEFAULT_TEAM_CONFIG } from './teamMemberPrepromptHook.js';
// Re-export for convenience
export * from './contextInjectionHook.js';
export * from './drilldownHook.js';
export * from './lowContextHook.js';
export * from './hookManager.js';
export * from './teamMemberPrepromptHook.js';
//# sourceMappingURL=index.js.map