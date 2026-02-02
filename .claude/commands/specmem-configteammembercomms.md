# SpecMem·隊員 交流配置

查配置② 隊員 交流設置s.

## 令④ 析ing

```javascript
const args = "$ARGUMENTS".trim();

if (!args || args === "help" || args === "--help" || args === "-h") {
  // Show HELP OUTPUT below
  return;
}

if (args === "test") {
  // Execute TEST action
  return;
}

if (args === "status") {
  // Execute STATUS action
  return;
}

// Unknown command
console.log("Unknown command. Use /specmem-configteammembercomms help for usage.");
```

---

## 輸入·VALIDATION

```javascript
const args = "$ARGUMENTS".trim();

// Valid commands:
// - /specmem-configteammembercomms          (show help)
// - /specmem-configteammembercomms help     (show help)
// - /specmem-configteammembercomms test     (test communication)
// - /specmem-configteammembercomms status   (show status)
```

---

## 佽輸出

示·args·供ed "佽":

```
SpecMem Team Member Communication Configuration

COMMANDS:

  /specmem-configteammembercomms test
    Test team communication by sending and reading a message

  /specmem-configteammembercomms status
    Show current team status and storage backend

WHAT THIS CONFIGURES:

  Team members communicate via SpecMem's MCP tools:
  - send_team_message: Send messages to team
  - read_team_messages: Read team activity
  - claim_task: Claim files/tasks to avoid conflicts
  - release_task: Release claims when done
  - get_team_status: See who's working on what
  - broadcast_to_team: Broadcast to all team members
  - request_help: Ask team for help
  - respond_to_help: Answer help requests

HOW IT WORKS:

  All team communication goes through PostgreSQL database.
  MCP tools handle serialization and message routing.
  No HTTP endpoints needed - direct MCP tool calls.

  Database tables:
  - team_channels: Project-isolated channels
  - team_messages: Messages with threading
  - task_claims: File/task claims
  - help_requests: Open help requests

  Each project gets its own isolated schema for team data.

TROUBLESHOOTING:

  If communication fails:
  1. Check SpecMem service is running
  2. Verify PostgreSQL connection
  3. Reload Claude session to refresh MCP

RELATED COMMANDS:

  /specmem-team-member status    - View team status
  /specmem-team-member messages  - Read team messages
  /specmem-team-member claim     - Claim a task

MCP TOOLS USED:
  - mcp__specmem__send_team_message
  - mcp__specmem__read_team_messages
  - mcp__specmem__get_team_status
```

---

## 極刑

### 試③ 一舉 (`/specmem-configteammembercomms test`)

試③ 隊交流使役:

#### 步 1: 送試③ 訊息·```javascript
mcp__specmem__send_team_message({
  message: "[CONFIG TEST] Team member communication test at " + new Date().toISOString(),
  type: "status"
})
```

#### 步 2: 讀① 晚近音訊核②

```javascript
mcp__specmem__read_team_messages({
  limit: 5
})
```

#### 步 3: 示果

查試③ 訊息果實:

**成功:**
```
TEAM COMMUNICATION TEST

✅ Send Message: OK
✅ Read Messages: OK
✅ Test message found in results

Status: WORKING

Team communication is functioning correctly.
Database: PostgreSQL
Storage: Project-isolated schema
```

**失敗①:**
```
TEAM COMMUNICATION TEST

❌ Send Message: OK
❌ Read Messages: OK (but test message not found)

Status: NOT WORKING

Possible issues:
- Database connection problem
- Table permissions issue
- Schema isolation misconfigured

Try:
1. Check SpecMem service is running
2. Verify PostgreSQL connection
3. Check logs: tail -f ~/.specmem/logs/mcp-server.log
4. Reload Claude session
```

---

### 狀態一舉 (`/specmem-configteammembercomms status`)

當前隊 狀態:

```javascript
mcp__specmem__get_team_status({})
```

#### 顯果:

```
TEAM COMMUNICATION STATUS

Active Claims: <count>
<list of active claims if any>

Recent Activity: <count> messages in last hour

Open Help Requests: <count>
<list of help requests if any>

Storage Backend: PostgreSQL
Schema: <project schema name>
Tables: team_channels, team_messages, task_claims, help_requests

Team communication is active and operational.
```·事業①:
```
TEAM COMMUNICATION STATUS

Active Claims: 0
Recent Activity: 0 messages

Open Help Requests: 0

Storage Backend: PostgreSQL
Schema: <project schema name>

No active team members detected.

Deploy a team with:
  /specmem-webdev <task>
  /specmem-agents deploy <type> <task>
```

---

## MCP·具⑤ 綱要s

### mcp__specmem__send_team_message
- `message`: 串 (必要②) - 訊息內容
- `type`: "狀態" | "問" | "更①" | "廣播" | "help_request" | "help_response"
- `priority`: "低" | "對頭" | "亢" | "倥①"

### mcp__specmem__read_team_messages
- `limit`: 數 (默認: 10, 最大①: 100)
- `unread_only`: 布①
- `mentions_only`: 布①
- `since`: 串 (ISO 8601 時戳)

### mcp__specmem__get_team_status·參s·必要②.

返s:
- `activeClaims`: 陣② TaskClaim·物s
- `recentActivity`: 數 - 訊息計① 末時②
- `openHelpRequests`: 陣② HelpRequest·物s

---

## MCP·具⑤s·中古①

- `mcp__specmem__send_team_message` - 送試③ 訊息
- `mcp__specmem__read_team_messages` - 讀① 音訊核②
- `mcp__specmem__get_team_status` - 隊狀態概觀

---

## 資料庫綱要·INFO·隊交流用s PostgreSQL·表s:

### team_channels
- 論③-專案頻s·隊交流
- 專案索 頻s·基於專案徑③

### team_messages
- 音訊緒ing·儎②
- 儎②s @提s·讀① 單據
- 訊息: 狀態, 問, 更①, 廣播, help_request, help_response

### task_claims
- 活躍檔/任務堅稱s·杜傾軋s
- 堅稱描述, 案卷①, claimed_by, 狀態

### help_requests
- 開① 佽求①s·隊員s
- 狀態: 開①, 答ed
- 鏈ed·頻s·表s·含·`project_path`·論③-專案·isolation.

---

##

### 試③ 隊交流·```
/specmem-configteammembercomms test
```·輸出:
```
TEAM COMMUNICATION TEST

✅ Send Message: OK
✅ Read Messages: OK
✅ Test message found in results

Status: WORKING
```

### 查隊 狀態·```
/specmem-configteammembercomms status
```·輸出:
```
TEAM COMMUNICATION STATUS

Active Claims: 2
  - design-agent: tailwind.config.ts, src/index.css
  - component-agent: src/components/Button.tsx

Recent Activity: 15 messages in last hour

Open Help Requests: 0

Storage Backend: PostgreSQL
Schema: project_specmem

Team communication is active and operational.
```

### 示佽·```
/specmem-configteammembercomms help
```