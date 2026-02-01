#!/usr/bin/env node
/**
 * Agent Chooser Injection Hook
 * ============================
 *
 * SessionStart hook that injects standing instructions telling Claude
 * to ALWAYS ask the user before deploying agents via the Task tool.
 *
 * This gives users full control over every agent deployment!
 *
 * Hook Event: SessionStart
 *
 * To disable: set SPECMEM_AGENT_AUTO=1
 */

const fs = require('fs');
const path = require('path');

// Check if auto mode (skip asking)
const AUTO_MODE = process.env.SPECMEM_AGENT_AUTO === '1';
const CHOOSER_DISABLED = process.env.SPECMEM_NO_CHOOSER === '1';

function loadConfig() {
  const paths = [
    path.join(process.cwd(), '.specmem', 'agent-config.json'),
    path.join(process.env.HOME || '', '.specmem', 'agent-config.json')
  ];
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {}
  }
  return { defaults: { model: 'sonnet' }, agents: {} };
}

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  try {
    const data = JSON.parse(input);

    if (data.hookEventName !== 'SessionStart') {
      process.exit(0);
    }

    // Skip if disabled
    if (AUTO_MODE || CHOOSER_DISABLED) {
      process.exit(0);
    }

    const config = loadConfig();

    const instructions = `
## AGENT DEPLOYMENT PROTOCOL

BEFORE deploying any agent via the Task tool, you MUST ask the user to confirm settings using AskUserQuestion.

**Required Questions:**

1. **Agent Type Selection:**
\`\`\`json
{
  "question": "What type of agent should handle this task?",
  "header": "Agent Type",
  "options": [
    {"label": "general-purpose (Recommended)", "description": "Full toolset for complex tasks"},
    {"label": "Explore", "description": "Fast codebase search and exploration"},
    {"label": "feature-dev:code-explorer", "description": "Deep code analysis with tracebacks"},
    {"label": "feature-dev:code-architect", "description": "Architecture and design planning"}
  ],
  "multiSelect": false
}
\`\`\`

2. **Model Selection:**
\`\`\`json
{
  "question": "Which model should the agent use?",
  "header": "Model",
  "options": [
    {"label": "sonnet (Recommended)", "description": "Balanced speed and capability"},
    {"label": "opus (Ultrathink)", "description": "Deepest reasoning for complex analysis"},
    {"label": "haiku", "description": "Fastest, for simple tasks"}
  ],
  "multiSelect": false
}
\`\`\`

**Current Configuration:** (from .specmem/agent-config.json)
- Default model: ${config.defaults?.model || 'sonnet'}
- Background execution: ${config.defaults?.background !== false ? 'enabled' : 'disabled'}

**Quick Deploy Option:**
If user says "use defaults" or "quick deploy", skip the questions and use current config.

**Remember:** Users want control over which agent types and models are used. Always ask unless they explicitly say to use defaults.
`;

    console.log(JSON.stringify({
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: instructions
      }
    }));

  } catch (e) {
    // LOW-44 FIX: Log errors before exit
    console.error('[agent-chooser-inject] Error:', e.message || e);
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('[agent-chooser-inject] Unhandled error:', e.message || e);
  process.exit(0);
});
