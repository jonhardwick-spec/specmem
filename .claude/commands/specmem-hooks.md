# SpecMem·鉤s - 自定鉤 管理

司克勞德碼 鉤s `/specmem/claude-hooks/`.

## 令④ 析ing·析來①s `/specmem-hooks`:

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

## 佽輸出·args "佽":

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

## 極刑

### "單③"

執·bash·令④:

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
```·顯輸出示ing·鉤檔 描述詁s.

### "狀態"

執·bash·令④s:

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

### "部①"

執·bash·令④s:

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
```·匯報成功失敗①.

### "掃描"

執·bash·令④:

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

## 鉤描述s·短描述s·俗② 鉤s:

- **代理-載①ing-鉤.js** - 配置②s·模型/設置s·代理部署① 基於.SM/代理-配置③.json
- **代理-輸出-interceptor.js** - 處s·代理輸出專① 格式ing
- **bash-auto-後台.js** - 自然而然後台s·曼-一連·Bash·令④s
- **輸入-覺②-改進er.js** - 剖s·輸入議s·改進①s
- **俊-上下文-鉤.js** - 注入s·相干·SpecMem·上下文提示s
- **SM-上下文-鉤.js** - 加s SpecMem·回憶對話上下文
- **SM-DD-鉤.js** - 提醒s·戶② DD·記搜s
- **SM-隊-員-注入.js** - 加s·隊協作① 指示①
- **任務-烝-鉤.js** - 行止① 顯s·任務烝

---

## MCP·具⑤s·中古①

**無** - 令④ 用s Bash exclusively·檔運作①.

---

##

### 單③ 鉤s
```
/specmem-hooks list
```

### 查鉤 系統狀態·```
/specmem-hooks status
```

### 部① 鉤s·克勞德·```
/specmem-hooks deploy
```

### 掃描新 鉤s
```
/specmem-hooks scan
```