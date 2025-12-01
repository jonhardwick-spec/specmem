#!/usr/bin/env node
/**
 * Agent Chooser Hook - Interactive Agent Deployment
 * ==================================================
 *
 * PreToolUse hook that INTERCEPTS Task tool calls and:
 *   1. BLOCKS automatic deployment
 *   2. Injects instructions for Claude to ask user for preferences
 *   3. User chooses agent type, model, settings PER DEPLOYMENT
 *
 * This gives users FULL CONTROL over every agent that gets deployed!
 *
 * Hook Event: PreToolUse
 * Matcher: Task
 *
 * To disable interactive mode, set SPECMEM_AGENT_AUTO=1
 */

const fs = require('fs');
const path = require('path');

// Check if auto mode is enabled (skip interactive)
const AUTO_MODE = process.env.SPECMEM_AGENT_AUTO === '1' || process.env.SPECMEM_AGENT_AUTO === 'true';

// Check if chooser is disabled
const CHOOSER_DISABLED = process.env.SPECMEM_NO_CHOOSER === '1' || process.env.SPECMEM_NO_CHOOSER === 'true';

// Marker to prevent re-processing
const CHOOSER_MARKER = '[AGENT_CHOOSER_CONFIRMED]';

/**
 * Load user config
 */
function loadConfig() {
  const configPaths = [
    path.join(process.cwd(), '.specmem', 'agent-config.json'),
    path.join(process.env.HOME || '', '.specmem', 'agent-config.json')
  ];

  for (const p of configPaths) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch (e) {}
  }

  return {
    defaults: { model: 'sonnet', background: true },
    agents: {}
  };
}

/**
 * Build the chooser context that instructs Claude to ask the user
 */
function buildChooserContext(description, currentType, currentModel, config) {
  const agentTypes = [
    { name: 'general-purpose', desc: 'Full toolset for complex multi-step tasks' },
    { name: 'Explore', desc: 'Fast codebase exploration and search' },
    { name: 'feature-dev:code-explorer', desc: 'Deep code analysis with tracing' },
    { name: 'feature-dev:code-architect', desc: 'Architecture design blueprints' },
    { name: 'feature-dev:code-reviewer', desc: 'Code review with confidence filtering' },
    { name: 'Bash', desc: 'Shell/git/CLI command specialist' },
    { name: 'Plan', desc: 'Architecture and implementation planning' }
  ];

  const models = [
    { name: 'haiku', desc: 'Fastest, cheapest - simple tasks' },
    { name: 'sonnet', desc: 'Balanced speed and quality (default)' },
    { name: 'opus', desc: 'Deepest thinking - complex analysis' }
  ];

  return `
[AGENT-CHOOSER]
🎛️ AGENT DEPLOYMENT PAUSED - Confirm settings

Task: "${description}"
Agent: ${currentType || 'general-purpose'} | Model: ${currentModel || config.defaults?.model || 'sonnet'}

Call AskUserQuestion NOW:
{
  "questions": [
    {
      "question": "Agent for: ${description.slice(0, 40)}...?",
      "header": "Agent",
      "options": [
        {"label": "${currentType || 'general-purpose'}", "description": "Current"},
        {"label": "Explore", "description": "Fast search"},
        {"label": "feature-dev:code-explorer", "description": "Deep analysis"},
        {"label": "Plan", "description": "Architecture"}
      ],
      "multiSelect": false
    },
    {
      "question": "Model?",
      "header": "Model",
      "options": [
        {"label": "sonnet", "description": "Balanced (recommended)"},
        {"label": "opus", "description": "Deepest thinking"},
        {"label": "haiku", "description": "Fastest"}
      ],
      "multiSelect": false
    }
  ]
}

After response: Re-deploy Task with choices + "${CHOOSER_MARKER}" in prompt.
[/AGENT-CHOOSER]
`;
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

    // Only intercept Task tool
    if (toolName !== 'Task') {
      process.exit(0);
    }

    // Skip if chooser is disabled
    if (CHOOSER_DISABLED) {
      process.exit(0);  // Let other hooks handle it
    }

    // Skip if auto mode is enabled
    if (AUTO_MODE) {
      process.exit(0);  // Let other hooks handle it
    }

    const prompt = toolInput.prompt || '';
    const description = toolInput.description || 'agent task';
    const agentType = toolInput.subagent_type || '';
    const model = toolInput.model || '';

    // Skip if already confirmed by user (has our marker)
    if (prompt.includes(CHOOSER_MARKER)) {
      // User confirmed - let it proceed (other hooks will process)
      process.exit(0);
    }

    // Load config for defaults
    const config = loadConfig();

    // Build the chooser context
    const chooserContext = buildChooserContext(description, agentType, model, config);

    // BLOCK the deployment and inject instructions for Claude to ask user
    console.log(JSON.stringify({
      continue: false,  // Block the tool call
      stopReason: `Agent deployment requires user confirmation. Use AskUserQuestion to let user choose settings.`,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `🛑 Agent chooser: Awaiting user confirmation for "${description.slice(0, 40)}"`,
        additionalContext: chooserContext
      }
    }));

  } catch (e) {
    // LOW-44 FIX: Log errors before exit
    console.error('[agent-chooser-hook] Error:', e.message || e);
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('[agent-chooser-hook] Unhandled error:', e.message || e);
  process.exit(0);
});
