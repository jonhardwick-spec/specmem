# SpecMem·主① 令④ 樞紐·SpecMem - 記, codebase, 隊協作①.

## 具⑤ 映①ing·令④ 路由器檄s MCP·具⑤s·專用令④s.

## 用法·```
/specmem                     # Show help
/specmem help                # Show help
/specmem <subcommand> [args]
```

## 人稱 - 極刑理③

**步 1: 析輸入**
- 撮首 字① `subcommand`
- 撮餘 言① `args`

**步 2: 輸入·Validation**
路由①, 驗必要② 言論①:

| Subcommand | Validation·必要② |
|------------|---------------------|
| 找, 惦, 碼, 搜 | args·叵空 |
| 練①, DD | args·必是有效正面整數 |
| 隊送, 隊堅稱, 隊佽 | 亞實參必要② |

validation·失敗s, 示宜① 錯誤訊錯誤處截①.

**步 3: 路由·Subcommand**

| subcommand... | 執 |
|---------------------|--------------|
| (空) / "佽" / "--佽" / "-h" | 示佽 輸出, 停 |
| "找" | 驗·args·存③ → `mcp__specmem__find_memory({query: "<args>", summarize: true, limit: 10})` |
| "惦" / "儲" | 驗·args·存③ → `mcp__specmem__save_memory({content: "<args>", importance: "medium"})` |
| "stats" | `mcp__specmem__show_me_the_stats({includeTypeDistribution: true, includeImportanceDistribution: true, includeCacheStats: true, includeInstanceStats: true})` |
| "碼" / "搜" | 驗·args·存③ → `mcp__specmem__find_code_pointers({query: "<args>", limit: 10, includeTracebacks: true})` |
| "隊" | 睹隊·SUBCOMMAND·路由① |
| "同步①" | `mcp__specmem__check_sync({detailed: true})` |
| "觀" | `mcp__specmem__start_watching({})` |
| "練①" / "DD" | 驗·args·數 → `mcp__specmem__drill_down({drilldownID: <args as number>, includeCode: true, includeContext: true, includeRelated: true})` |
| 不明 | 示: "不明·subcommand: <subcommand>. 跑 /SM·佽可用令④s." |

**步 4: 隊·Subcommand·路由①**
subcommand "隊", 析·`args`·隊一舉:

| 隊·args | Validation | 執 |
|-----------|------------|--------------|
| "狀態" | 無 | `mcp__specmem__get_team_status({})` |
| "送 <訊息>" | 查訊息存③s | `mcp__specmem__send_team_message({message: "<message>", type: "update", priority: "normal"})` |
| "音訊" / "讀①" | 無 | `mcp__specmem__read_team_messages({limit: 10, compress: true})` |
| "堅稱 <desc>" | 查·desc·存③s | `mcp__specmem__claim_task({description: "<desc>"})` |
| "發布 <ID>" | 查·ID·存③s | `mcp__specmem__release_task({claimId: "<id>"})` |
| "佽 <問>" | 查問 存③s | `mcp__specmem__request_help({question: "<remaining args>"})` |
| (空) | 無 | 示隊 佽: "用法: /SM·隊 [狀態|送|音訊|堅稱|發布|佽]\n\nExamples:\n /SM·隊狀態\n /SM·隊送 使役·auth\n /SM·隊堅稱修復ing login·蟲" |

## 佽輸出
(顯剛② args, "佽", "--佽", "-h")

```
SpecMem - Intelligent Memory & Codebase System

USAGE:
  /specmem <subcommand> [arguments]

MEMORY SEARCH & STORAGE:
  /specmem find <query>        Semantic search across all memories
                               Example: /specmem find authentication flow

  /specmem remember <content>  Store new memory with medium importance
                               Example: /specmem remember API uses JWT

  /specmem drill <id>          Drill into memory details using drilldownID
                               Example: /specmem drill 12345

  /specmem stats               Show memory statistics and distributions

CODEBASE SEARCH:
  /specmem code <query>        Semantic code search with tracebacks
                               Example: /specmem code websocket handler

  /specmem search <query>      Alias for 'code' command

TEAM COORDINATION:
  /specmem team status         See active claims and team activity
  /specmem team send <msg>     Send update/status to team
  /specmem team messages       Read recent team messages (last 10)
  /specmem team claim <desc>   Claim task/files to avoid conflicts
  /specmem team release <id>   Release a claim (use 'all' to release all)
  /specmem team help <question> Broadcast help request to team

SYSTEM MANAGEMENT:
  /specmem sync                Check if files are in sync with memories
  /specmem watch               Start file watcher for auto-sync

DEDICATED COMMANDS (advanced features):
  /specmem-find                Memory search with filters (tags, types, etc)
  /specmem-code                Code search with language/file filters
  /specmem-pointers            Code search with caller/callee analysis
  /specmem-remember            Store memory with custom importance/tags
  /specmem-stats               Full statistics with cache performance
  /specmem-drilldown           Interactive memory exploration
  /specmem-team-member         Deploy autonomous team members
  /specmem-changes             View file change history
  /specmem-hooks               Manage custom Claude hooks
  /specmem-service             Service mode management
  /specmem-autoclaude          Autonomous task execution mode

WORKFLOW EXAMPLES:
  # Start working on a task
  /specmem team claim "Fixing authentication bug"
  /specmem team status

  # Research before coding
  /specmem find authentication implementation
  /specmem code login handler

  # Update team on progress
  /specmem team send "Auth bug fixed, testing now"

  # Complete work
  /specmem team release all
  /specmem team send "Auth bug fix complete"

TIPS:
  - Use 'find' for searching conversations/memories
  - Use 'code' for searching actual code files
  - Always 'claim' tasks before starting to avoid conflicts
  - Use 'drill' to explore detailed memory content
  - Check 'team status' to see what others are working on
```

## 錯誤處

**不明·subcommand:**
```
Unknown subcommand: "<input>"

Run /specmem help to see available commands.
```

**佚③ 必要② 實參 (找, 惦, 碼, 搜):**
```
Error: '<subcommand>' requires a search query or content.

Usage: /specmem <subcommand> <argument>

Examples:
  /specmem find authentication flow
  /specmem remember "User auth uses JWT tokens"
  /specmem code websocket connection handler
```

**無效·DD ID:**
```
Error: 'drill' requires a valid numeric drilldown ID.

Usage: /specmem drill <drilldownID>

Example:
  /specmem drill 12345

Get drilldown IDs from:
  - find_memory results with cameraRollMode: true
  - Previous drill_down results in relatedMemories
```

**隊·subcommand·佚③ 一舉:**
```
Usage: /specmem team [status|send|messages|claim|release|help]

Examples:
  /specmem team status              # See who's working on what
  /specmem team send "Working on auth"   # Update team
  /specmem team messages            # Read recent messages
  /specmem team claim "Fixing login"     # Claim task
  /specmem team release all         # Release all claims
  /specmem team help "Need help with websockets"  # Ask for help
```

**隊·subcommand·佚③ 訊息/描述:**
```
Error: '/specmem team <action>' requires additional information.

Examples:
  /specmem team send <message>      # Requires a message
  /specmem team claim <description> # Requires task description
  /specmem team release <claimId>   # Requires claim ID or 'all'
  /specmem team help <question>     # Requires your question

Try '/specmem team status' or '/specmem team messages' for no-arg commands.
```

## 具⑤ 綱要參引

### find_memory
```json
{
  "query": "string - natural language search (REQUIRED)",
  "limit": "number 1-1000 (default: 10)",
  "threshold": "number 0-1 (default: 0.25)",
  "memoryTypes": ["episodic", "semantic", "procedural", "working"],
  "tags": ["string array"],
  "summarize": "boolean (default: true) - truncate for compact view",
  "recencyBoost": "boolean (default: true) - boost recent memories",
  "cameraRollMode": "boolean (default: false) - enable drill-down IDs",
  "includeRecent": "number 0-50 (default: 0) - force include N most recent"
}
```

### save_memory
```json
{
  "content": "string - content to store (REQUIRED)",
  "importance": "critical|high|medium|low|trivial (default: medium)",
  "memoryType": "episodic|semantic|procedural|working (default: semantic)",
  "tags": ["string array"],
  "metadata": "object - additional structured data"
}
```

### show_me_the_stats
```json
{
  "includeTypeDistribution": "boolean (default: true)",
  "includeImportanceDistribution": "boolean (default: true)",
  "includeCacheStats": "boolean (default: true)",
  "includeInstanceStats": "boolean (default: true)",
  "includeRelationshipStats": "boolean (default: false)",
  "includeTagDistribution": "boolean (default: false)"
}
```

### find_code_pointers
```json
{
  "query": "string - what code to find (REQUIRED)",
  "limit": "number 1-100 (default: 10)",
  "includeTracebacks": "boolean (default: true) - show callers/callees",
  "language": "typescript|javascript|python|go|rust|etc - filter by language",
  "filePattern": "string - filter by path (e.g., 'routes/*.ts')",
  "definitionTypes": ["function", "method", "class", "interface", etc],
  "threshold": "number 0-1 (default: 0.1)",
  "zoom": "number 0-100 (default: 50) - content detail level"
}
```

### get_team_status
```json
{}
```·返s: activeClaims, recentActivity, openHelpRequests

### send_team_message
```json
{
  "message": "string - message content (REQUIRED)",
  "type": "status|question|update|broadcast|help_request (default: update)",
  "priority": "low|normal|high|urgent (default: normal)",
  "thread_id": "string - optional thread ID for replies"
}
```

### read_team_messages
```json
{
  "limit": "number 1-100 (default: 10)",
  "unread_only": "boolean (default: false)",
  "mentions_only": "boolean (default: false)",
  "compress": "boolean (default: true) - use Chinese token compression"
}
```

### claim_task
```json
{
  "description": "string - what you're working on (REQUIRED)",
  "files": ["array of file paths to lock"]
}
```·返s: claimId (存·release_task)

### release_task
```json
{
  "claimId": "string - claim ID or 'all' (REQUIRED)"
}
```·用·claimId claim_task·應①, '' 發布

### request_help
```json
{
  "question": "string - what you need help with (REQUIRED)",
  "context": "string - additional context about the problem",
  "skills_needed": ["array of skills like 'database', 'typescript', etc"]
}
```·返s: requestId·跟蹤應①s

### check_sync
```json
{
  "detailed": "boolean (default: false) - include file-by-file drift info"
}
```·返s: syncScore (0-100), driftedFiles, missingFiles, deletedFiles

### start_watching
```json
{
  "rootPath": "string - directory to watch (default: current working dir)",
  "syncCheckIntervalMinutes": "number 1-1440 (default: 60)"
}
```·啟①s·後台檔 觀er·自動記 更①s

### drill_down
```json
{
  "drilldownID": "number - the ID from find_memory results (REQUIRED)",
  "includeCode": "boolean (default: true) - include code references",
  "includeContext": "boolean (default: true) - include conversation context",
  "includeRelated": "boolean (default: true) - include related memories",
  "relatedLimit": "number 1-20 (default: 5) - max related memories",
  "compress": "boolean (default: true) - use token compression"
}
```·返s: fullContent, pairedMessage, conversationContext, relatedMemories, codeReferences

## Implementation·提綱

** 克勞德碼 開發者s:**
1. 路由① 令④ - 析·subcommand·檄·MCP·具⑤s
2. 驗輸入s·使命① MCP·具⑤s
3. 供中用① 錯① 音訊指南戶②s·正確用法
4. 隊令④s, 撮一舉字① 餘·args·另②
5. 練① 令④ 需①s numeric validation - 用·parseInt·查·isNaN
6. MCP·具⑤ 綱要s·準末 審核 (2026-01-21)

**令④ 極刑流②:**
```
User Input → Parse subcommand → Validate args → Route to MCP tool → Return result
                                       ↓
                                  (if invalid)
                                       ↓
                              Show error with example
```

**聯調聯試·Checklist:**
- [ ] /SM args·示s·佽
- [ ] /SM·佽示s·佽
- [ ] /SM·找·args·示s·錯①
- [ ] /SM·找 "詢" 呼①s find_memory
- [ ] /SM·練① args·示s·錯①
- [ ] /SM·練① abc·示s·無效數 錯①
- [ ] /SM·練① 123 呼①s drill_down
- [ ] /SM·隊示s·隊佽
- [ ] /SM·隊狀態呼①s get_team_status
- [ ] /SM·隊送 訊息示s·錯①
- [ ] /SM·不明示s·不明令④ 錯①