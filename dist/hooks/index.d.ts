/**
 * SPECMEM HOOKS - Native Context Injection System
 * ===============================================
 *
 * This module exports the SpecMem hook system for  Code integration.
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
 * Usage in  Code settings.json:
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
export { contextInjectionHook, searchRelatedMemories, formatContextInjection, MemoryResult, ContextHookConfig, DEFAULT_CONFIG } from './contextInjectionHook.js';
export { startDrilldown, changeDrilldownDepth, filterMemories, addWebResearch, getFinalContext, getDrilldownState, clearDrilldown, generateDrilldownQuestion, drilldownTools, DrilldownState, DrilldownDepth, DRILLDOWN_DEPTHS } from './drilldownHook.js';
export { lowContextHook, forceCompact, getContextState, resetContextTracking, updateTokenCount, CONTEXT_LIMITS, THRESHOLDS, LowContextConfig, ContextState } from './lowContextHook.js';
export { HookManager, HookConfig, HooksRegistry, getHookManager, resetHookManager, formatHooksList } from './hookManager.js';
export { teamMemberPrepromptHook, teamFramingTools, generateTeamFramingPrompt, loadTeamConfig, saveTeamConfig, updateTeamConfig, resetTeamConfig, enableTeamFraming, disableTeamFraming, setCustomPreprompt, setChannelName, getTeamConfig, isTeamFramingEnabled, TeamFramingConfig, PreToolUseInput, TeamFramingResult, DEFAULT_TEAM_CONFIG } from './teamMemberPrepromptHook.js';
export * from './contextInjectionHook.js';
export * from './drilldownHook.js';
export * from './lowContextHook.js';
export * from './hookManager.js';
export * from './teamMemberPrepromptHook.js';
//# sourceMappingURL=index.d.ts.map