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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';
// ============================================================================
// Configuration
// ============================================================================
const SPECMEM_CONFIG_DIR = path.join(os.homedir(), '.specmem');
const TEAM_CONFIG_FILE = path.join(SPECMEM_CONFIG_DIR, 'team-framing.json');
/**
 * Default team framing configuration
 */
export const DEFAULT_TEAM_CONFIG = {
    enabled: true,
    channelName: 'dev-coordination',
    customPreprompt: '',
    additionalContext: '',
    triggerTools: ['Task', 'task', 'spawn_agent', 'deploy_agent'],
    includeMcpToolInstructions: true,
    seniorEngineerName: 'the senior engineer',
    teamName: 'the development team'
};
/**
 * The core team framing prompt
 * This creates the psychological context for team member collaboration
 */
export function generateTeamFramingPrompt(taskDescription, config) {
    // Use custom preprompt if provided, otherwise use default
    if (config.customPreprompt) {
        return config.customPreprompt.replace('[TASK DESCRIPTION HERE]', taskDescription);
    }
    const mcpToolInstructions = config.includeMcpToolInstructions ? `
To coordinate and avoid conflicts:

1. Use the \`send_team_message\` tool to share your progress
2. Use the \`read_team_messages\` tool to see what others are working on
3. Use the \`request_code_review\` tool to get feedback from teammates
4. Use the \`claim_task\` tool to indicate what you're working on

Our team uses a custom Slack-like communication channel. Always check for messages from teammates before making major changes.
` : `
Coordinate with your teammates by checking what others are working on before making major changes.
`;
    return `You are a developer on a software development team. ${config.seniorEngineerName} on this team is skeptical of AI assistance, so you must perform your tasks efficiently and communicate well with your fellow developers.

Other developers may be working on related parts of this task.${mcpToolInstructions}
Your current task assignment: ${taskDescription}`;
}
// ============================================================================
// Configuration Management
// ============================================================================
/**
 * Load team framing configuration from file
 */
export function loadTeamConfig() {
    try {
        if (existsSync(TEAM_CONFIG_FILE)) {
            const content = readFileSync(TEAM_CONFIG_FILE, 'utf-8');
            const parsed = JSON.parse(content);
            return { ...DEFAULT_TEAM_CONFIG, ...parsed };
        }
    }
    catch (error) {
        logger.warn({ error }, '[TeamFraming] Failed to load config, using defaults');
    }
    return { ...DEFAULT_TEAM_CONFIG };
}
/**
 * Save team framing configuration to file
 */
export function saveTeamConfig(config) {
    const fullConfig = { ...loadTeamConfig(), ...config };
    try {
        if (!existsSync(SPECMEM_CONFIG_DIR)) {
            mkdirSync(SPECMEM_CONFIG_DIR, { recursive: true });
        }
        writeFileSync(TEAM_CONFIG_FILE, JSON.stringify(fullConfig, null, 2));
        logger.info({ configPath: TEAM_CONFIG_FILE }, '[TeamFraming] Saved config');
    }
    catch (error) {
        logger.error({ error }, '[TeamFraming] Failed to save config');
    }
    return fullConfig;
}
/**
 * Update specific config fields
 */
export function updateTeamConfig(updates) {
    return saveTeamConfig(updates);
}
/**
 * Reset config to defaults
 */
export function resetTeamConfig() {
    return saveTeamConfig(DEFAULT_TEAM_CONFIG);
}
// ============================================================================
// Main Hook Logic
// ============================================================================
/**
 * Check if tool name matches any trigger tools
 */
function isTriggerTool(toolName, triggerTools) {
    const normalized = toolName.toLowerCase();
    return triggerTools.some(trigger => normalized === trigger.toLowerCase() ||
        normalized.includes(trigger.toLowerCase()));
}
/**
 * Extract task description from tool input
 * Different tools have different argument structures
 */
function extractTaskDescription(toolInput) {
    // Common field names for task/prompt
    const promptFields = [
        'prompt',
        'task',
        'description',
        'message',
        'content',
        'instructions',
        'command',
        'input',
        'text'
    ];
    for (const field of promptFields) {
        const value = toolInput[field];
        if (typeof value === 'string' && value.length > 0) {
            return value;
        }
    }
    return null;
}
/**
 * Main hook function - intercepts Task tool calls and injects team framing
 *
 * @param toolName - Name of the tool being called
 * @param toolInput - Tool arguments/input
 * @param config - Optional configuration override
 * @returns Modified tool input with team framing injected
 */
export async function teamMemberPrepromptHook(toolName, toolInput, config = {}) {
    const cfg = { ...loadTeamConfig(), ...config };
    // Skip if disabled
    if (!cfg.enabled) {
        return { modified: false };
    }
    // Check if this is a trigger tool
    if (!isTriggerTool(toolName, cfg.triggerTools)) {
        return { modified: false };
    }
    // Extract the original task description
    const originalTask = extractTaskDescription(toolInput);
    if (!originalTask) {
        logger.debug({ toolName }, '[TeamFraming] No task description found in tool input');
        return { modified: false };
    }
    // Generate the framed prompt
    const framedPrompt = generateTeamFramingPrompt(originalTask, cfg);
    // Create modified tool input with framed prompt
    const modifiedInput = { ...toolInput };
    // Find and replace the prompt field
    const promptFields = ['prompt', 'task', 'description', 'message', 'content', 'instructions'];
    for (const field of promptFields) {
        if (typeof toolInput[field] === 'string') {
            modifiedInput[field] = framedPrompt;
            break;
        }
    }
    logger.info({
        toolName,
        originalTaskLength: originalTask.length,
        framedPromptLength: framedPrompt.length,
        channel: cfg.channelName
    }, '[TeamFraming] Injected team framing into team member prompt');
    return {
        modified: true,
        modifiedInput,
        debug: {
            originalPrompt: originalTask,
            framedPrompt,
            config: cfg
        }
    };
}
/**
 * CLI entry point for  Code PreToolUse hook
 * Reads JSON from stdin: { "tool_name": "...", "tool_input": {...} }
 * Outputs modified tool input to stdout (as JSON)
 */
export async function runFromCLI() {
    try {
        // Read from stdin
        const chunks = [];
        for await (const chunk of process.stdin) {
            chunks.push(chunk);
        }
        const input = Buffer.concat(chunks).toString('utf8').trim();
        if (!input) {
            return;
        }
        // Parse JSON input
        const data = JSON.parse(input);
        const toolName = data.tool_name || '';
        const toolInput = data.tool_input || {};
        // Run hook
        const result = await teamMemberPrepromptHook(toolName, toolInput);
        // Output result
        if (result.modified && result.modifiedInput) {
            // Output the modified tool input
            const output = {
                tool_name: toolName,
                tool_input: result.modifiedInput
            };
            console.log(JSON.stringify(output));
        }
        // If not modified, output nothing (tool proceeds unchanged)
    }
    catch (error) {
        // Silent fail - don't break 's flow
        logger.error({ error }, '[TeamFraming CLI] Error');
    }
}
// ============================================================================
// Utility Functions for Integration
// ============================================================================
/**
 * Enable team framing
 */
export function enableTeamFraming() {
    updateTeamConfig({ enabled: true });
    logger.info('[TeamFraming] Enabled');
}
/**
 * Disable team framing
 */
export function disableTeamFraming() {
    updateTeamConfig({ enabled: false });
    logger.info('[TeamFraming] Disabled');
}
/**
 * Set custom pre-prompt text
 */
export function setCustomPreprompt(preprompt) {
    updateTeamConfig({ customPreprompt: preprompt });
    logger.info({ prepromptLength: preprompt.length }, '[TeamFraming] Custom preprompt set');
}
/**
 * Set communication channel name
 */
export function setChannelName(channelName) {
    updateTeamConfig({ channelName });
    logger.info({ channelName }, '[TeamFraming] Channel name updated');
}
/**
 * Get current configuration
 */
export function getTeamConfig() {
    return loadTeamConfig();
}
/**
 * Check if team framing is enabled
 */
export function isTeamFramingEnabled() {
    return loadTeamConfig().enabled;
}
// ============================================================================
// Export for MCP Tool Integration
// ============================================================================
export const teamFramingTools = {
    teamMemberPrepromptHook,
    runFromCLI,
    enableTeamFraming,
    disableTeamFraming,
    setCustomPreprompt,
    setChannelName,
    getTeamConfig,
    isTeamFramingEnabled,
    loadTeamConfig,
    saveTeamConfig,
    updateTeamConfig,
    resetTeamConfig,
    generateTeamFramingPrompt,
    DEFAULT_TEAM_CONFIG
};
// Export default for programmatic use
export default teamFramingTools;
//# sourceMappingURL=teamMemberPrepromptHook.js.map