# SpecMem AutoClaude - 自導任務極刑

## 令④ 析ing - 讀① 首

析來①s `/specmem-autoclaude`:

**危急: 查空/佚③ 言論① 首**

```
ARGS = everything after "/specmem-autoclaude "
ARGS = ARGS.trim()
```

**裁① 樹:**
1. ARGS·空·ARGS === "" → **停. 輸出佽 文⑤. 叵遂.**
2. ARGS === "佽" ARGS === "-h" ARGS === "--佽" → **停. 輸出佽 文⑤. 叵遂.**
3. ARGS·內容 ( 任務提示) → 承① AUTOCLAUDE·工作流

---

## 佽文⑤ - 輸出剛② 停

** 示:** 空·args, args, "佽" 實參.

**一舉:** 輸出文⑤ verbatim, 停. 叵呼① MCP·具⑤s.

```
SpecMem AutoClaude - Autonomous Task Execution

USAGE:
  /specmem-autoclaude "<task>"    Execute task autonomously
  /specmem-autoclaude help        Show this help

EXAMPLES:
  /specmem-autoclaude "fix the login bug"
  /specmem-autoclaude "improve websocket performance"
  /specmem-autoclaude "add dark mode to dashboard"

WHAT IT DOES:
  1. Searches SpecMem for relevant memories
  2. Finds related code files in codebase
  3. Creates todo list and executes task autonomously
  4. Saves learnings for future reference

REQUIRED:
  - You MUST provide a task in quotes
  - Empty command shows this help

TIPS:
  - Be specific about what you want
  - Works best with tasks discussed before
  - Check /specmem-stats for available context

MCP TOOLS USED:
  - mcp__specmem__find_memory (search memories)
  - mcp__specmem__find_code_pointers (search code)
  - mcp__specmem__save_memory (store learnings)

RELATED:
  /specmem-find      Search memories only
  /specmem-code      Search code only
  /specmem-stats     View memory statistics
```

**停示ing·佽. 叵承① 工作流.**

---

## AUTOCLAUDE·工作流

**前提②:** 任務提示必是供ed. $任務空, 返回佽 文⑤.

任務供ed, 執臺階:

### 步 1: 團① 記上下文

搜相干回憶任務:

**呼① mcp__specmem__find_memory:**
```
{
  "query": "$TASK",
  "limit": 10,
  "summarize": false,
  "keywordFallback": true,
  "includeRecent": 5
}
```·搜親① 問題s·問題①s:
```
{
  "query": "problem issue bug error $TASK",
  "limit": 5,
  "summarize": true
}
```

**參s:**
- 詢: 串 (必要②) - 何事搜
- 限①: 數 (默認: 10) - 最大① 果實
- 包舉: 布① (默認: 真) - truncate·內容
- keywordFallback: 布① (默認: 真) - 退步鍵詞搜
- includeRecent: 數 (默認: 0) - 兵② 含·N·晚近回憶

### 步 2: 找相干碼

用語義碼 搜找 親① 案卷①:

**呼① mcp__specmem__find_code_pointers:**
```
{
  "query": "$TASK",
  "limit": 10,
  "threshold": 0.1,
  "includeTracebacks": true,
  "includeMemoryLinks": true,
  "zoom": 50
}
```

**參s:**
- 詢: 串 (必要②) - 碼搜
- 限①: 數 (默認: 10) - 最大① 果實
- 閾值: 數 (默認: 0.1) - 最小① 相似度 0-1
- includeTracebacks: 布① (默認: 真) - 示呼①er/callee
- includeMemoryLinks: 布① (默認: 真) - 鏈回憶
- 縮放: 數 (默認: 50) - 細部級 0-100

### 步 3: 創·Todo·單③

基於回憶碼 找①, 創·actionable todos:

**呼① TodoWrite:**
```
[
  {
    content: "Analyze current implementation",
    status: "in_progress",
    activeForm: "Analyzing implementation"
  },
  {
    content: "Implement fix/improvement",
    status: "pending",
    activeForm: "Implementing changes"
  },
  {
    content: "Test changes",
    status: "pending",
    activeForm: "Testing changes"
  },
  {
    content: "Save learnings to SpecMem",
    status: "pending",
    activeForm: "Saving learnings"
  }
]
```

### 步 4: 執·Autonomously

**科:**
1. 讀① 案卷① 編務 (用讀① 具⑤)
2. 對地, 一意ed·變遷 (用編① 具⑤)
3. 試③ 顯著變遷 (用·Bash·具⑤ 用得上)
4. 更① todos·烝 (剺完結, 加新 )
5. 卡死①, 存烝 匯報

**工作流:**
- 剺首·todo "in_progress"
- 完成任務
- 剺 "完結"
- 移下·todo

### 步 5: 存學術s·任務完成, 存詳 記:

**呼① mcp__specmem__save_memory:**
```
{
  "content": "Task: $TASK\n\nChanges Made:\n- [list specific changes]\n- [one change per line]\n\nFiles Modified:\n- [absolute path 1]\n- [absolute path 2]\n\nKey Learnings:\n[insights gained]\n[patterns discovered]\n[things to remember]\n\nContext:\n[relevant context for future reference]",
  "importance": "high",
  "memoryType": "episodic",
  "tags": ["task-completion", "autoclaude", "task-type"]
}
```

**參s:**
- 內容: 串 (必要②) - 記內容
- 意義①: "危急" | "亢" | "媒" | "低" | "屑" (默認: "媒")
- memoryType: "情節" | "語義" | "程序①" | "使役" (默認: "語義")
- 標④s: 串[] (可選) - categorization·標④s

**VALIDATION:**
- 內容叵 空
- 用 "亢" 意義① 任務·completions
- 用 "情節" 事變/任務s
- 含相干標④s categorization

### 步 6: 匯報·Completion·輸出摘要:

```
AUTOCLAUDE TASK COMPLETE

TASK: $TASK

CHANGES MADE:
- [specific change 1 with file path]
- [specific change 2 with file path]
- [etc.]

FILES MODIFIED:
- /absolute/path/to/file1
- /absolute/path/to/file2

MEMORIES SEARCHED: [count] memories found
CODE SEARCHED: [count] files found
MEMORY SAVED: [memory_id] - learnings stored for future reference

NEXT STEPS:
- [optional: suggest what user should do next]
- [optional: mention related tasks]
```

---

## 錯誤處

** 記搜 返s·果實:**
- 試寬④er·搜規約
- 查任務訴說s·評ed
- 遂碼 搜

** 碼搜 返s·果實:**
- 試搜 規約
- 查檔 模式s·文④ 濾s
- 叫戶② 澄① 案卷① 修改

** 無法完成任務:**
- 存片 烝記
- 剺當前·todo "in_progress" (叵完結)
- 匯報·what's·卡①ed
- 叫戶② 指引①

---

## VALIDATION CHECKLIST·執ing, 核②:
- [ ] 任務提示叵 空
- [ ] find_memory·人稱有效詢
- [ ] find_code_pointers·人稱有效詢
- [ ] TodoWrite·人稱有效·todo·結構
- [ ] save_memory·人稱·non-空內容
- [ ] 檔徑③s·輸出無比較級 (叵親)
- [ ] 變遷試③ed·剺ing·完成
- [ ] 終期記 含s·相干備細

---

## 具⑤ 參引

### mcp__specmem__find_memory·搜回憶語義意.

**必要②:** 詢 (串)
**可選:** 限①, 包舉, keywordFallback, includeRecent, 閾值, memoryTypes, 標④s

### mcp__specmem__find_code_pointers·搜碼 語義意.

**必要②:** 詢 (串)
**可選:** 限①, 閾值, includeTracebacks, includeMemoryLinks, 縮放, 文④, filePattern, definitionTypes

### mcp__specmem__save_memory·儲記 前① 參引.

**必要②:** 內容 (串)
**可選:** 意義①, memoryType, 標④s, 元數據

**危急:** 內容參 叵空 串.

---

## 提綱

- 用無比較級檔 徑③s·輸出
- 試③ 變遷剺ing todos·完成
- 存緬① 學術s·佽前① 任務s
- 任務含混, 叫釐清
- 用現 回憶啟 侵
- 鏈親① 回憶相干