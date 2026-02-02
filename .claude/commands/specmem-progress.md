# SpecMem·烝 - 觀隊 員烝

觀隊 員烝 實①-時① using SpecMem·隊交流.

## 令④ 析ing

```javascript
const args = "$ARGUMENTS".trim();

if (!args || args === "help" || args === "--help" || args === "-h") {
  // Show recent team messages (default 10)
  // Execute DEFAULT action
  return;
}

if (args === "--live" || args === "live") {
  // Execute LIVE mode
  return;
}

if (args.startsWith("--count ")) {
  const countMatch = args.match(/--count\s+(\d+)/);
  if (!countMatch) {
    console.log("ERROR: --count requires a number");
    console.log("Example: /specmem-progress --count 20");
    return;
  }
  const count = parseInt(countMatch[1], 10);
  // Execute with custom count
  return;
}

// Unknown argument - show help
console.log("Unknown argument. Use /specmem-progress help for usage.");
```

---

## 輸入·VALIDATION

```javascript
const args = "$ARGUMENTS".trim();

// Valid commands:
// - /specmem-progress              (show last 10)
// - /specmem-progress --count 20   (show last 20)
// - /specmem-progress --live       (live polling)
// - /specmem-progress help         (show help)
```

---

## 佽輸出·```
SpecMem Progress - Watch Team Activity

USAGE:
  /specmem-progress              Show last 10 team messages
  /specmem-progress --count 20   Show last 20 messages
  /specmem-progress --live       Live polling mode (updates every 5s)
  /specmem-progress help         Show this help

WHAT YOU'LL SEE:
  - Team member status updates
  - Task claims and completions
  - Help requests and responses
  - Broadcast messages

This shows real progress from agents using MCP team communication!

MCP TOOL USED:
  mcp__specmem__read_team_messages

RELATED:
  /specmem-team-member status    Full team status
  /specmem-team-member messages  Read messages with filters
```

---

## 極刑

### 默認調① ( args "佽")

執·MCP·具⑤:

```javascript
mcp__specmem__read_team_messages({
  limit: 10,
  compress: false
})
```

### --計①

執·MCP·具⑤ 自定限①:

```javascript
mcp__specmem__read_team_messages({
  limit: COUNT,
  compress: false
})
```

### 住調① (--住)

Poll `mcp__specmem__read_team_messages` 5 廢品.

示新 音訊末·poll using `since`·參:

```javascript
// First call - show last 10
let lastTimestamp = null;

while (true) {
  const result = mcp__specmem__read_team_messages({
    limit: 10,
    since: lastTimestamp,
    compress: false
  });

  if (result.messages && result.messages.length > 0) {
    // Display new messages
    displayMessages(result.messages);

    // Update last timestamp
    lastTimestamp = result.messages[0].timestamp;
  }

  // Wait 5 seconds
  await sleep(5000);
}
```

**札**: 住調① 顯 "催·Ctrl+C·停" 更① 位.

---

## 顯格式

示音訊扢 烝格式:

```
╔══════════════════════════════════════════════════════════════╗
║  📊 TEAM PROGRESS                                            ║
╠══════════════════════════════════════════════════════════════╣
║  [12:34:05] Agent-1: Starting authentication module...       ║
║  [12:34:12] Agent-2: Claimed files: src/auth/*               ║
║  [12:34:25] Agent-1: ✅ Completed login form                 ║
║  [12:34:30] Agent-3: 🔄 Working on API endpoints...          ║
╚══════════════════════════════════════════════════════════════╝

Showing 4 messages. Use --count to see more.
```·訊息, 顯:
- **時戳**: [HH:MM:SS] 格式
- **寄件人**: 簡約① 寄件人名① ID
- **內容**: 訊息內容 (truncate > 60 煳s)
- **Icon**: 基於訊息
- 🔄 - 狀態更①s
- ✅ - completions
- ❓ - 問s
- 🆘 - 佽求①s
- 📢 - 廣播s

---

## MCP·具⑤ 綱要

具⑤: `mcp__specmem__read_team_messages`·可選參s:
- `limit`: 數 (默認: 10, 最大①: 100) - 最大① 音訊返
- `since`: 串 (ISO 8601) - 音訊時戳
- `unread_only`: 布① (默認: 假②) - unread·音訊
- `mentions_only`: 布① (默認: 假②) - 音訊提ing
- `include_broadcasts`: 布① (默認: 真) - 含廣播音訊
- `compress`: 布① (默認: 真) - 啟用崋 壓縮

返s:
- `messages`: 陣② TeamMessage·物s
- `id`: 串 - 訊息·ID
- `sender`: 串 - 寄件人·ID
- `sender_name`: 串 - 寄件人顯 名①
- `content`: 串 - 訊息內容
- `type`: 串 - 訊息
- `priority`: 串 - 訊息緩急
- `timestamp`: 串 - ISO 8601 時戳
- `mentions`: 串[] - 提ed·員·IDs
- `read_by`: 串[] - 員s·讀①

---

## 輸出

### 默認 (末 10 音訊)

```
╔══════════════════════════════════════════════════════════════╗
║  📊 TEAM PROGRESS                                            ║
╠══════════════════════════════════════════════════════════════╣
║  [14:23:45] design-agent: 🔄 Setting up design tokens        ║
║  [14:24:12] component-agent: 🔄 Creating Button component    ║
║  [14:24:30] design-agent: ✅ Design system complete          ║
║  [14:25:01] component-agent: ✅ Button component ready       ║
║  [14:25:15] integration-agent: 🔄 Integrating components     ║
╚══════════════════════════════════════════════════════════════╝

Showing 5 messages. Use --count to see more.
```

### --計① 20

```
╔══════════════════════════════════════════════════════════════╗
║  📊 TEAM PROGRESS (Last 20)                                  ║
╠══════════════════════════════════════════════════════════════╣
║  [13:00:00] coordinator: 📢 Starting webdev team deployment  ║
║  [13:00:15] design-agent: 🔄 Claimed tailwind.config.ts      ║
║  ...                                                          ║
║  [14:25:15] integration-agent: 🔄 Integrating components     ║
╚══════════════════════════════════════════════════════════════╝

Showing 20 messages.
```

### 住調①

```
╔══════════════════════════════════════════════════════════════╗
║  📊 TEAM PROGRESS (LIVE)                                     ║
║  Press Ctrl+C to stop                                        ║
╠══════════════════════════════════════════════════════════════╣
║  [14:25:15] integration-agent: 🔄 Integrating components     ║
║  [14:25:30] quality-agent: 🔄 Starting review...             ║
║  [14:26:00] quality-agent: ✅ Quality check passed!          ║
╚══════════════════════════════════════════════════════════════╝

Last update: 14:26:00
```

### 音訊·```
╔══════════════════════════════════════════════════════════════╗
║  📊 TEAM PROGRESS                                            ║
╠══════════════════════════════════════════════════════════════╣
║  No team messages found.                                     ║
║                                                               ║
║  Try:                                                         ║
║  - Deploy a team: /specmem-webdev <task>                     ║
║  - Check status: /specmem-team-member status                 ║
╚══════════════════════════════════════════════════════════════╝
```

---

## MCP·具⑤s·中古①

- `mcp__specmem__read_team_messages` - 讀① 隊交流音訊

---

##

### 示末 10 音訊·```
/specmem-progress
```

### 示末 20 音訊·```
/specmem-progress --count 20
```

### 住·polling·調①
```
/specmem-progress --live
```
(催·Ctrl+C·停)

### 示佽·```
/specmem-progress help
```