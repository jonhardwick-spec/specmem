# SpecMem·隊員 - 隊協作① 具⑤s

## 必要②: 查言論① 首

** 言論① 供ed args·空/whitespace/help/-h/--help:**

輸出佽 停:

```
SpecMem Team Member - Team Coordination

USAGE:
  /specmem-team-member <subcommand> [args]

SUBCOMMANDS:

  status              Show team status, active claims, help requests
  messages            Read recent team messages (last 10)
  send <message>      Send a message to the team
  claim <description> Claim a task to prevent conflicts
  release [claimId]   Release task claims (default: all)
  broadcast <message> Broadcast status update to all members
  help-request <text> Request help from the team
  help-respond <id> <response> Respond to a help request
  clear               Clear team messages (requires confirmation)

EXAMPLES:

  /specmem-team-member status
  /specmem-team-member messages
  /specmem-team-member send Working on auth module
  /specmem-team-member claim Implementing user login
  /specmem-team-member release
  /specmem-team-member broadcast API endpoints ready
  /specmem-team-member help-request How does token refresh work?
  /specmem-team-member help-respond abc-123 Try using JWT refresh tokens
  /specmem-team-member clear

MCP TOOLS:
  send_team_message, read_team_messages, broadcast_to_team,
  claim_task, release_task, get_team_status,
  request_help, respond_to_help, clear_team_messages
```

** 叵遂·SUBCOMMAND.**

---

## Subcommand - 析執

析首 字① subcommand, REST·言論①.

---

### SUBCOMMAND: 狀態

**VALIDATION:**
- 言論① 必要②

**呼① MCP·具⑤ ** ( 叵顯, 喚 ):

用·`mcp__specmem__get_team_status`·參s:
```json
{}
```

**顯果實示ing:**
- 活躍任務堅稱s ( 使役 )
- 晚近隊 事業① (音訊, 堅稱s)
- 開① 佽求①s·計①

---

### SUBCOMMAND: 音訊 ( 讀①)

**VALIDATION:**
- 言論① 必要② (用s·默認s)

**呼① MCP·具⑤ ** ( 叵顯, 喚 ):

用·`mcp__specmem__read_team_messages`·參s:
```json
{
  "limit": 10,
  "compress": true,
  "include_broadcasts": true
}
```

**顯:** 晚近隊 音訊寄件人, 內容, 時戳, unread·狀態.

**札:**
- 用·`mentions_only: true`·濾 @提s
- 用·`unread_only: true`·示·unread·音訊
- 用·`since: "2025-01-21T10:00:00Z"`·濾時①

---

### SUBCOMMAND: 送 <訊息>

撮 "送" 訊息內容.

**VALIDATION:**
- ** 訊息文⑤ 供ed:** 輸出 "錯①: 訊息供ed. 用法: /SM-隊-員送 <訊息>" 停.
- 訊息叵 空·whitespace

**呼① MCP·具⑤ ** ( 叵顯, 喚 ):

用·`mcp__specmem__send_team_message`·參s:
```json
{
  "message": "<extracted message text>",
  "type": "update",
  "priority": "normal"
}
```

**有效價值標準:**
- `type`: "狀態" | "問" | "更①" | "廣播" | "help_request" | "help_response"
- `priority`: "低" | "對頭" | "亢" | "倥①"
- `task_id`: (可選) 串 - 送任務-特定頻
- `project_id`: (可選) 串 - 送專案-特定頻
- `thread_id`: (可選) 串 - 復③ 緒
- `sender_name`: (可選) 串 - 顯名① 寄件人

**顯:** 確認訊息送①, 連② messageId·提s·找①.

**儎②s @提s:** 用 @員-ID·訊息報信特定隊 員s.

---

### SUBCOMMAND: 堅稱 <描述>

撮 "堅稱" 任務描述.

**VALIDATION:**
- ** 描述供ed:** 輸出 "錯①: 任務描述. 用法: /SM-隊-員堅稱 <描述>" 停.
- 描述叵 空·whitespace

**呼① MCP·具⑤ ** ( 叵顯, 喚 ):

用·`mcp__specmem__claim_task`·參s:
```json
{
  "description": "<extracted description>",
  "files": []
}
```

**有效價值標準:**
- `description`: 串 (必要②) - you're·使役
- `files`: 串[] (可選) - 陣② 檔徑③s you'll·使役

**顯:**
- 堅稱·ID ( 用發布)
- 確認訊息
- 警①s·傾軋ing·檔堅稱s

**札:** 案卷① 堅稱ed·員, you'll·警① 堅稱成②.

---

### SUBCOMMAND: 發布 [claimId]

撮·claimId "發布" 供ed, 用 "".

**VALIDATION:**
- claimId·供ed, 必是有效·UUID ""
- 默認 "" claimId·額定

**呼① MCP·具⑤ ** ( 叵顯, 喚 ):

用·`mcp__specmem__release_task`·參s:
```json
{
  "claimId": "<claimId or 'all'>"
}
```

**有效價值標準:**
- `claimId`: 串 (必要②) - 特定堅稱·UUID "" 發布堅稱s

**顯:**
- 確認示ing·數堅稱s·發布ed
- 單③ 發布ed·堅稱·IDs

---

### SUBCOMMAND: 廣播 <訊息>

撮 "廣播" 訊息內容.

**VALIDATION:**
- ** 訊息文⑤ 供ed:** 輸出 "錯①: 訊息供ed. 用法: /SM-隊-員廣播 <訊息>" 停.
- 訊息叵 空·whitespace

**呼① MCP·具⑤ ** ( 叵顯, 喚 ):

用·`mcp__specmem__broadcast_to_team`·參s:
```json
{
  "message": "<extracted message text>",
  "broadcast_type": "status",
  "priority": "normal",
  "cross_project": false
}
```

**有效價值標準:**
- `message`: 串 (必要②) - 廣播訊息
- `broadcast_type`: "狀態" | "烝" | "公告" (默認: "狀態")
- `priority`: "低" | "對頭" | "亢" | "倥①" (默認: "對頭")
- `metadata`: 物 (可選) - e.g., { 烝: 75 }
- `cross_project`: 布① (默認: 假②) - 真, 廣播專案s (用·sparingly!)

**顯:** 確認廣播送① messageId.

**札:** 默認, 廣播s·及隊 員s·專案. 用·cross_project: 真系統-寬③ 公告s.

---

### SUBCOMMAND: 佽-求① <問>

撮 "佽-求①" 問.

**VALIDATION:**
- ** 問供ed:** 輸出 "錯①: 問供ed. 用法: /SM-隊-員佽-求① <問>" 停.
- 問叵 空·whitespace

**呼① MCP·具⑤ ** ( 叵顯, 喚 ):

用·`mcp__specmem__request_help`·參s:
```json
{
  "question": "<extracted question>",
  "context": null,
  "skills_needed": []
}
```

**有效價值標準:**
- `question`: 串 (必要②) - 問問題待② 佽
- `context`: 串 (可選) - 另外上下文問題①
- `skills_needed`: 串[] (可選) - e.g., ["資料庫", "typescript"]

**顯:**
- 佽求① ID (存跟蹤應①s!)
- 確認廣播送① 隊
- 提示① 查音訊應①s

---

### SUBCOMMAND: 佽-應 <requestId> <應①>

析言論①: 首字① requestId, REST·應① 文⑤.

**VALIDATION:**
- ** requestId·供ed:** 輸出 "錯①: 佚③ 求① ID. 用法: /SM-隊-員佽-應 <requestId> <應①>" 停.
- ** 應① 文⑤ 供ed:** 輸出 "錯①: 應① 供ed. 用法: /SM-隊-員佽-應 <requestId> <應①>" 停.
- requestId·必是有效·UUID·格式
- 應① 叵空·whitespace

**呼① MCP·具⑤ ** ( 叵顯, 喚 ):

用·`mcp__specmem__respond_to_help`·參s:
```json
{
  "requestId": "<extracted requestId>",
  "response": "<extracted response text>"
}
```

**有效價值標準:**
- `requestId`: 串 (必要②) - ID·佽求①
- `response`: 串 (必要②) - 答指引①

**顯:**
- 確認應① 送①
- 應① 送① ( 原② 求①er)
- 應① ID·跟蹤

---

### SUBCOMMAND: 清

**VALIDATION:**
- 需①s·不含糊① 確認安危

**叫戶② 確認:**

輸出提示:
```
⚠️  WARNING: This will delete team communication data!

This will clear:
- All team messages in this project
- All task claims in this project
- All help requests in this project

Confirm deletion? Type 'yes' to proceed.
```

** 戶② 證s "":**

**呼① MCP·具⑤ ** ( 叵顯, 喚 ):

用·`mcp__specmem__clear_team_messages`·參s:
```json
{
  "confirm": true,
  "clear_claims": true,
  "clear_help_requests": true
}
```

**有效價值標準:**
- `confirm`: 布① (必要②) - 必是真 刪
- `older_than_minutes`: 數 (可選) - 刪大·N·紀要
- `clear_claims`: 布① (默認: 真) - 清任務堅稱s
- `clear_help_requests`: 布① (默認: 真) - 清佽 求①s

** 戶② 叵證:**

輸出: "清作廢ed. 據刪ed."

**顯:**
- 數音訊刪ed
- 數堅稱s·清ed
- 數佽 求①s·清ed

**使用例:** 呼① 衍伸ing·新隊 員s·保證啟① 鮮① 舊上下文.

---

### 不明·SUBCOMMAND

subcommand·叵受知, 輸出:

```
Error: Unknown subcommand '<subcommand>'

Valid subcommands:
  - status
  - messages (or read)
  - send
  - claim
  - release
  - broadcast
  - help-request
  - help-respond
  - clear

Run /specmem-team-member help for usage.
```

---

## 具⑤ 參·VALIDATION

** 驗具⑤ 參s·使命① MCP·具⑤s:**

1. **串參s**: 叵空/null/undefined·微調
2. **Enum·參s**: 匹配索① 價值標準綱要
3. **陣② 參s**: 可以是空 陣② `[]`·必是有效·JSON·陣②
4. **布① 參s**: 必是真/假②, 叵串 "真"/"假②"
5. **UUID·參s**: 匹配·UUID·格式 (8-4-4-4-12 hex·模式)

** validation·失敗s**:
- 輸出清 錯誤訊申ing what's·冤
- 示正確用法
- 叵呼① MCP·具⑤

---

## 最好規矩①

**工作流:**
1. 啟① 工: `claim` → 杜s·傾軋s
2. 更① 隊: `send` → 共烝
3. 待② 佽: `help-request` → 廣播隊
4. 佽: `help-respond` → 答問s
5. 了工: `release` → 放案卷①
6. 查狀態: `status` + `messages` → 住② 協同

**令效率:**
- `read_team_messages`·用s·崋壓縮默認 (壓: 真)
- `get_team_status`·返s ultra-凝練摘要s
- 用·`limit`·參乂 訊息計①

**專案·Isolation:**
- 具⑤s·自然而然天地ed·當前專案
- 用·`cross_project: true`·廣播系統-寬③ 公告s
- 音訊專案s·叵可見 (除① 全局廣播s)

---

## 錯誤處

**俗② 錯①s:**

1. **"堅稱未找到"** → 無效·claimId·發布令④
2. **"佽求① 未找到"** → 無效·requestId·佽-應
3. **"訊息內容不克空"** → 空訊息送/廣播
4. **"不克發布堅稱佔有ed·員"** → 事兒發布·else's·堅稱

**:**
- 示錯誤訊戶②
- 申·went·冤
- 供正確用法