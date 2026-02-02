# SpecMem Agents - User-Configurable Agent Deployment

Configure exactly which agents get deployed and with what settings.

## COMMAND PARSING

- If NO args, "help", "--help", "-h" → Show HELP below
- If `list` → List all available agent types with descriptions
- If `config` → Show current configuration
- If `set <type> <setting> <value>` → Configure agent settings
- If `defaults` → Reset to default configuration
- If `deploy <type> <prompt>` → Deploy with specific type
- If `interactive` or `-i` → Interactive agent selector

## INPUT VALIDATION

Extract everything after `/specmem-agents`:

```javascript
const args = "$ARGUMENTS".trim();

if (!args || args === "help" || args === "--help" || args === "-h") {
  // Show HELP OUTPUT below
  return;
}

if (args === "list") {
  // Execute LIST action
  return;
}

if (args === "config") {
  // Execute CONFIG action
  return;
}

if (args === "defaults") {
  // Execute DEFAULTS action
  return;
}

if (args.startsWith("set ")) {
  // Parse: set <target> <setting> <value>
  const parts = args.slice(4).trim().split(/\s+/);
  if (parts.length < 3) {
    console.log("ERROR: set requires 3 arguments: <target> <setting> <value>");
    console.log("Example: /specmem-agents set default model opus");
    return;
  }
  // Execute SET action
  return;
}

if (args.startsWith("deploy ")) {
  // Parse: deploy <type> <prompt>
  const match = args.match(/^deploy\s+(\S+)\s+(.+)$/);
  if (!match) {
    console.log("ERROR: deploy requires <type> and <prompt>");
    console.log("Example: /specmem-agents deploy Explore \"find auth code\"");
    return;
  }
  // Execute DEPLOY action
  return;
}

if (args === "interactive" || args === "-i") {
  // Execute INTERACTIVE action
  return;
}

// Unknown command
console.log("Unknown command. Use /specmem-agents help for usage.");
```

---

## HELP OUTPUT

```
SpecMem Agents - Configurable Agent Deployment

USAGE:
  /specmem-agents                    Show this help
  /specmem-agents list               List all agent types
  /specmem-agents config             Show current settings
  /specmem-agents set <args>         Configure agent settings
  /specmem-agents deploy <type> <p>  Deploy specific type
  /specmem-agents interactive        Interactive selector

AVAILABLE AGENT TYPES:
  general-purpose    Full toolset, any task
  Bash               Shell command specialist
  Explore            Codebase exploration (quick/medium/thorough)
  Plan               Architecture & implementation planning
  feature-dev:code-explorer    Deep code analysis
  feature-dev:code-architect   Feature design blueprints
  feature-dev:code-reviewer    Code review with confidence filtering

CONFIGURABLE SETTINGS:
  model          haiku | sonnet | opus (default: sonnet)
  max_turns      1-100 (default: unlimited by type)
  background     true | false (default: true)
  ultrathink     true | false (opus only, default: false)

EXAMPLES:
  /specmem-agents set default model opus
  /specmem-agents set feature-dev:code-explorer model opus
  /specmem-agents deploy Explore "find authentication code"
  /specmem-agents interactive

NOTE: This command does NOT directly call MCP tools.
      It configures agent settings in .specmem/agent-config.json
      which are then read by agent-loading-hook.js
```

---

## LIST - Show Available Agent Types

Display this table:

```
AVAILABLE AGENT TYPES
=====================

TYPE                      | TOOLS                           | BEST FOR
--------------------------|--------------------------------|---------------------------
general-purpose           | All tools                       | Complex multi-step tasks
Bash                      | Bash only                       | Git, CLI, terminal ops
Explore                   | All (fast)                      | Codebase questions
Plan                      | All                             | Architecture planning
feature-dev:code-explorer | Glob,Grep,Read,NotebookRead     | Deep code analysis
feature-dev:code-architect| Glob,Grep,Read,NotebookRead     | Feature design
feature-dev:code-reviewer | Glob,Grep,Read,NotebookRead     | Code review

THOROUGHNESS LEVELS (for Explore):
  quick         Basic search, fast results
  medium        Moderate exploration (default)
  very thorough Comprehensive analysis

MODEL OPTIONS:
  haiku    Fast, cheap - simple tasks
  sonnet   Balanced - most tasks (default)
  opus     Deep thinking - complex analysis

Set "ultrathink" to use Opus for deepest reasoning.
```

---

## CONFIG - Show Current Configuration

Read configuration from `.specmem/agent-config.json` or show defaults:

```json
{
  "defaults": {
    "model": "sonnet",
    "background": true,
    "ultrathink": false
  },
  "agents": {
    "general-purpose": {
      "model": "sonnet",
      "description": "Full toolset agent"
    },
    "Explore": {
      "model": "haiku",
      "thoroughness": "medium"
    },
    "feature-dev:code-explorer": {
      "model": "sonnet"
    }
  },
  "presets": {
    "ultrathink-team": {
      "model": "opus",
      "background": true,
      "description": "Deep analysis team with Opus"
    }
  }
}
```

If no config file exists, show:

```
CURRENT CONFIGURATION
=====================
Using defaults (no custom config)

DEFAULT SETTINGS:
  model:      sonnet
  background: true
  ultrathink: false

Create custom config with:
  /specmem-agents set default model opus
  /specmem-agents set Explore model haiku
```

---

## SET - Configure Agent Settings

Parse: `set <target> <setting> <value>`

Targets:
- `default` - Set default for all agents
- `<agent-type>` - Set for specific agent type

Settings:
- `model` - haiku | sonnet | opus
- `background` - true | false
- `ultrathink` - true | false (forces opus model)
- `max_turns` - number 1-100
- `thoroughness` - quick | medium | very thorough (Explore only)

### Execution Logic

1. Read existing config from `.specmem/agent-config.json` (or create empty)
2. Update the specified setting
3. Save config file
4. Confirm the change

Example outputs:

```
SET: default model = opus
Config saved to .specmem/agent-config.json

All new agents will use opus model by default.
```

```
SET: Explore thoroughness = very thorough
Config saved to .specmem/agent-config.json

Explore agents will now use "very thorough" analysis.
```

---

## DEPLOY - Deploy Specific Agent Type

Parse: `deploy <type> <prompt>`

Execute:
```
Task({
  subagent_type: "<type>",
  model: <from config or default>,
  description: "<first 5 words of prompt>",
  run_in_background: <from config>,
  prompt: "<prompt>"
})
```

If `ultrathink` is enabled in config, force model to "opus".

Example:
```
/specmem-agents deploy feature-dev:code-explorer "trace the authentication flow"
```

Outputs:
```
DEPLOYING AGENT
===============
Type:       feature-dev:code-explorer
Model:      opus (ultrathink enabled)
Background: true
Task:       trace the authentication flow

Agent deployed. Check progress with:
  /tasks
```

---

## INTERACTIVE - Agent Selector UI

When called, use AskUserQuestion to let user configure:

### Question 1: Agent Type
```json
{
  "question": "What type of agent do you want to deploy?",
  "header": "Agent Type",
  "options": [
    {"label": "general-purpose", "description": "Full toolset for complex tasks"},
    {"label": "Explore", "description": "Fast codebase exploration"},
    {"label": "feature-dev:code-explorer", "description": "Deep code analysis"},
    {"label": "feature-dev:code-architect", "description": "Architecture design"}
  ],
  "multiSelect": false
}
```

### Question 2: Model Selection
```json
{
  "question": "Which model should the agent use?",
  "header": "Model",
  "options": [
    {"label": "sonnet (Recommended)", "description": "Balanced speed and quality"},
    {"label": "opus", "description": "Deepest thinking, best for complex analysis"},
    {"label": "haiku", "description": "Fastest, best for simple tasks"}
  ],
  "multiSelect": false
}
```

### Question 3: Background Execution
```json
{
  "question": "Run in background?",
  "header": "Execution",
  "options": [
    {"label": "Background (Recommended)", "description": "Run async, continue working"},
    {"label": "Foreground", "description": "Wait for completion"}
  ],
  "multiSelect": false
}
```

After selections, ask for the task prompt and deploy.

---

## CONFIG FILE SCHEMA

Location: `.specmem/agent-config.json`

```typescript
interface AgentConfig {
  // Global defaults
  defaults: {
    model: "haiku" | "sonnet" | "opus";
    background: boolean;
    ultrathink: boolean;  // Forces opus with deep thinking
    max_turns?: number;
  };

  // Per-agent-type overrides
  agents: {
    [agentType: string]: {
      model?: "haiku" | "sonnet" | "opus";
      background?: boolean;
      max_turns?: number;
      thoroughness?: "quick" | "medium" | "very thorough";  // Explore only
      description?: string;
    };
  };

  // Named presets for quick selection
  presets: {
    [presetName: string]: {
      model: "haiku" | "sonnet" | "opus";
      background: boolean;
      description: string;
      agents?: string[];  // Which agent types to use
    };
  };
}
```

---

## HOOK INTEGRATION

The `agent-loading-hook.js` should read this config and apply settings:

1. On Task tool PreToolUse, read `.specmem/agent-config.json`
2. Get settings for the specified `subagent_type`
3. Override model/background if configured
4. Apply ultrathink (force opus) if enabled
5. Continue with modified parameters

---

## MCP Tools Used

- **NONE** - This command manages configuration files only
- Configuration is read by `agent-loading-hook.js` during Task deployment
- Agent deployment uses Claude Code's built-in Task tool

---

## EXAMPLES

### Enable Ultrathink for All Agents
```
/specmem-agents set default ultrathink true
```

### Configure Fast Exploration
```
/specmem-agents set Explore model haiku
/specmem-agents set Explore thoroughness quick
```

### Deploy Deep Analysis Team
```
/specmem-agents deploy feature-dev:code-explorer "analyze the authentication system"
```

### Interactive Full Control
```
/specmem-agents interactive
```
→ Select agent type → Select model → Choose background → Enter prompt → Deploy
