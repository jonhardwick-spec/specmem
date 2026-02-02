# SpecMem Hooks - Custom Hook Management

Manage Claude Code hooks in `/specmem/claude-hooks/`.

## COMMAND PARSING

Parse what comes after `/specmem-hooks`:

```javascript
const args = "$ARGUMENTS".trim();

if (!args || args === "help" || args === "--help" || args === "-h") {
  // Show HELP below
  return;
}

if (args === "list") {
  // Execute LIST action
  return;
}

if (args === "status") {
  // Execute STATUS action
  return;
}

if (args === "deploy") {
  // Execute DEPLOY action
  return;
}

if (args === "scan") {
  // Execute SCAN action
  return;
}

// Unknown command
console.log("Unknown command. Use /specmem-hooks help for usage.");
```

---

## HELP OUTPUT

If no args or "help":

```
SpecMem Hooks - Hook Management

USAGE:
  /specmem-hooks              Show this help
  /specmem-hooks list         List all hooks with descriptions
  /specmem-hooks status       Show hook system status
  /specmem-hooks deploy       Deploy enabled hooks to ~/.claude/hooks/
  /specmem-hooks scan         Scan claude-hooks directory

HOOKS DIRECTORY:
  Source: /specmem/claude-hooks/
  Target: ~/.claude/hooks/

HOOK TYPES:
  .js  - Node.js hooks (PreToolUse, PostToolUse, etc.)
  .py  - Python hooks
  .sh  - Shell script hooks
  .cjs - CommonJS hooks

AVAILABLE HOOKS:
  agent-loading-hook.js           Configures agent deployment
  agent-output-interceptor.js     Intercepts agent output
  agent-type-matcher.js           Matches agent types
  background-completion-silencer.js  Silences background completions
  bash-auto-background.js         Auto-backgrounds long Bash commands
  input-aware-improver.js         Improves prompts based on context
  smart-context-hook.js           Smart context injection
  smart-search-interceptor.js     Intercepts search operations
  specmem-context-hook.js         Injects SpecMem context into prompts
  specmem-drilldown-hook.js       Enforces drilldown after searches
  specmem-precompact.js           Precompacts responses
  specmem-session-start.cjs       Session initialization
  specmem-team-member-inject.js   Injects team member coordination
  specmem-unified-hook.py         Unified Python hook for all events
  subagent-loading-hook.js        Configures subagent loading
  task-progress-hook.js           Tracks task progress

RELATED:
  /specmem-stats    View system statistics
  /specmem          Main SpecMem commands

NOTE: This command does NOT use MCP tools.
      It manages files in the hooks directory using Bash.
```

---

## EXECUTION

### For "list"

Execute this bash command:

```bash
echo "=== SPECMEM HOOKS ===" && \
echo "" && \
for f in /specmem/claude-hooks/*.{js,py,sh,cjs} 2>/dev/null; do \
  if [ -f "$f" ]; then \
    echo "$(basename "$f")" && \
    head -3 "$f" | grep -E "^(//|#)" | sed 's/^/  /' && \
    echo ""; \
  fi; \
done
```

Display the output showing each hook file with its description from comments.

### For "status"

Execute these bash commands:

```bash
echo "=== HOOK SYSTEM STATUS ===" && \
echo "" && \
echo "Source Directory: /specmem/claude-hooks/" && \
ls -1 /specmem/claude-hooks/*.{js,py,sh,cjs} 2>/dev/null | wc -l | xargs -I{} echo "Total Hooks: {}" && \
echo "" && \
echo "Target Directory: ~/.claude/hooks/" && \
if [ -d ~/.claude/hooks/ ]; then \
  ls -la ~/.claude/hooks/; \
else \
  echo "(not found - run deploy)"; \
fi && \
echo "" && \
echo "Recent Hook Activity:" && \
ls -lt /specmem/claude-hooks/*.{js,py,sh,cjs} 2>/dev/null | head -5 | awk '{print "  " $6, $7, $8, $9}'
```

### For "deploy"

Execute these bash commands:

```bash
mkdir -p ~/.claude/hooks && \
echo "Deploying hooks to ~/.claude/hooks/..." && \
cp /specmem/claude-hooks/*.js ~/.claude/hooks/ 2>/dev/null; \
cp /specmem/claude-hooks/*.cjs ~/.claude/hooks/ 2>/dev/null; \
cp /specmem/claude-hooks/*.py ~/.claude/hooks/ 2>/dev/null; \
cp /specmem/claude-hooks/*.sh ~/.claude/hooks/ 2>/dev/null; \
chmod +x ~/.claude/hooks/* 2>/dev/null && \
echo "" && \
echo "Deployed hooks:" && \
ls -la ~/.claude/hooks/
```

Report success or failure.

### For "scan"

Execute this bash command:

```bash
echo "=== SCANNING HOOKS ===" && \
echo "" && \
echo "JavaScript Hooks:" && \
ls -la /specmem/claude-hooks/*.js 2>/dev/null || echo "  (none)" && \
echo "" && \
echo "CommonJS Hooks:" && \
ls -la /specmem/claude-hooks/*.cjs 2>/dev/null || echo "  (none)" && \
echo "" && \
echo "Python Hooks:" && \
ls -la /specmem/claude-hooks/*.py 2>/dev/null || echo "  (none)" && \
echo "" && \
echo "Shell Hooks:" && \
ls -la /specmem/claude-hooks/*.sh 2>/dev/null || echo "  (none)"
```

---

## HOOK DESCRIPTIONS

Brief descriptions for common hooks:

- **agent-loading-hook.js** - Configures model/settings for agent deployment based on .specmem/agent-config.json
- **agent-output-interceptor.js** - Processes agent output for special formatting
- **bash-auto-background.js** - Automatically backgrounds long-running Bash commands
- **input-aware-improver.js** - Analyzes input and suggests improvements
- **smart-context-hook.js** - Injects relevant SpecMem context into prompts
- **specmem-context-hook.js** - Adds SpecMem memories to conversation context
- **specmem-drilldown-hook.js** - Reminds user to drilldown after memory searches
- **specmem-team-member-inject.js** - Adds team coordination instructions
- **task-progress-hook.js** - Tracks and displays task progress

---

## MCP TOOLS USED

**NONE** - This command uses Bash exclusively for file operations.

---

## EXAMPLES

### List all hooks
```
/specmem-hooks list
```

### Check hook system status
```
/specmem-hooks status
```

### Deploy hooks to Claude
```
/specmem-hooks deploy
```

### Scan for new hooks
```
/specmem-hooks scan
```
