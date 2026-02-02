# SpecMem·代理s - 戶②-Configurable·代理部署①

配置② 剛② 代理s·部①ed·設置s.

## 令④ 析ing

- args, "佽", "--佽", "-h" → 示佽
- `list` → 單③ 可用代理描述s
- `config` → 示當前配置
- `set <type> <setting> <value>` → 配置② 代理設置s
- `defaults` → 重設默認配置
- `deploy <type> <prompt>` → 部① 特定
- `interactive` `-i` → 互動① 代理·selector

## 輸入·VALIDATION·撮·`/specmem-agents`:

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

## 佽輸出·```
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

## 單③ - 示可用代理

顯表:

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

## 配置③ - 示當前配置

讀① 配置·`.specmem/agent-config.json`·示默認s:

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
```·配置檔存③s, 示:

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

## 集 - 配置② 代理設置s·析: `set <target> <setting> <value>`·垛s:
- `default` - 集默認代理s
- `<agent-type>` - 集特定代理

設置s:
- `model` - 俳句 | 十四行詩 | 作品
- `background` - 真 | 假②
- `ultrathink` - 真 | 假② (兵②s·作品模型)
- `max_turns` - 數 1-100
- `thoroughness` - 㨗 | 媒 | 周④ (探① )

### 極刑理③

1. 讀① 現配置③ `.specmem/agent-config.json` ( 創空)
2. 更① 額定設置
3. 存配置檔
4. 證改

輸出s:

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

## 部① - 部① 特定代理

析: `deploy <type> <prompt>`·執:
```
Task({
  subagent_type: "<type>",
  model: <from config or default>,
  description: "<first 5 words of prompt>",
  run_in_background: <from config>,
  prompt: "<prompt>"
})
```

`ultrathink`·啟用ed·配置③, 兵② 模型 "作品".

:
```
/specmem-agents deploy feature-dev:code-explorer "trace the authentication flow"
```·輸出s:
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

## 互動① - 代理·Selector UI·人稱, 用·AskUserQuestion·戶② 配置②:

### 問 1: 代理·```json
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

### 問 2: 模型節選·```json
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

### 問 3: 後台極刑·```json
{
  "question": "Run in background?",
  "header": "Execution",
  "options": [
    {"label": "Background (Recommended)", "description": "Run async, continue working"},
    {"label": "Foreground", "description": "Wait for completion"}
  ],
  "multiSelect": false
}
```·節選s, 叫任務提示部①.

---

## 配置檔綱要

位置: `.specmem/agent-config.json`

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

## 鉤一元化·`agent-loading-hook.js`·讀① 配置③ 著① 設置s:

1. 任務具⑤ PreToolUse, 讀① `.specmem/agent-config.json`
2. 設置s·額定·`subagent_type`
3. 覆① 模型/後台配置②ed
4. 著① ultrathink (兵② 作品) 啟用ed
5. 承① modified·參s

---

## MCP·具⑤s·中古①

- **無** - 令④ 司s·配置案卷①
- 配置讀① `agent-loading-hook.js`·任務部署①
- 代理部署① 用s·克勞德·Code's·建③- 任務具⑤

---

##

### 啟用·Ultrathink·代理s
```
/specmem-agents set default ultrathink true
```

### 配置② 迅·Exploration
```
/specmem-agents set Explore model haiku
/specmem-agents set Explore thoroughness quick
```

### 部① 冞分析隊·```
/specmem-agents deploy feature-dev:code-explorer "analyze the authentication system"
```

### 互動① 滿① 乂·```
/specmem-agents interactive
```
→ 刷① 代理 → 刷① 模型 → 取① 後台 → 進提示 → 部①