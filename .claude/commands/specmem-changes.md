# SpecMem·變遷 - 檔改 史①

## 危急: 導·MCP·具⑤ 極刑

令④ 徑① 呼① MCP·具⑤s - 一行兩手.

---

## 輸入·VALIDATION ( 首!)

撮·`/specmem-changes`:

```javascript
const args = "$ARGUMENTS".trim();

if (!args || args === "help" || args === "--help" || args === "-h") {
  // Show HELP OUTPUT below
  return;
}

// Parse flags
const flags = {
  limit: 10,
  since: null,
  path: null
};

// Parse --limit <N>
const limitMatch = args.match(/--limit\s+(\d+)/);
if (limitMatch) {
  flags.limit = parseInt(limitMatch[1], 10);
}

// Parse --since <time>
const sinceMatch = args.match(/--since\s+([^\s-]+(?:\s+[^\s-]+)?)/);
if (sinceMatch) {
  flags.since = sinceMatch[1].trim();
}

// Parse --path <pattern>
const pathMatch = args.match(/--path\s+(\S+)/);
if (pathMatch) {
  flags.path = pathMatch[1];
}

// Execute with parsed flags
```

---

## 佽輸出

示·args "佽":

```
SpecMem Changes - File Change History

USAGE:
  /specmem-changes
  /specmem-changes --since <time> --limit <N> --path <pattern>

OPTIONS:
  --limit N       Number of changes (default: 10)
  --since TIME    Filter by time:
                  - "today", "yesterday"
                  - "24h", "7d", "30d"
                  - "last week", "last month"
                  - ISO date: "2024-01-15"
  --path PATTERN  Filter by file path pattern

EXAMPLES:
  /specmem-changes
  /specmem-changes --since yesterday
  /specmem-changes --limit 20 --path src/api
  /specmem-changes --since "last week" --path "*.ts"

WHAT IT TRACKS:
  - File additions (new files)
  - File modifications
  - File deletions
  - Content changes with diffs

MCP TOOL USED:
  mcp__specmem__find_memory (with date filters and tags)

RELATED:
  /specmem-pointers  Code references
  /specmem-code      Codebase search
  /specmem-find      General memory search
```

---

## 極刑

**執·MCP·具⑤ 徑①:**

```javascript
mcp__specmem__find_memory({
  query: "file change modification edit update" + (pathPattern ? " " + pathPattern : ""),
  limit: limit || 10,
  tags: ["file-change", "codebase"],
  dateRange: sinceDate ? {
    start: calculateDateFromSince(sinceDate)
  } : undefined,
  summarize: true,
  maxContentLength: 200,
  recencyBoost: true
})
```

### 日① 範圍打算

轉·`--since`·價值標準·ISO 8601 格式:

```javascript
function calculateDateFromSince(since) {
  const now = new Date();

  if (since === "today") {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    return today.toISOString();
  }

  if (since === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    return yesterday.toISOString();
  }

  if (since === "last week" || since === "7d") {
    const lastWeek = new Date(now);
    lastWeek.setDate(lastWeek.getDate() - 7);
    return lastWeek.toISOString();
  }

  if (since === "24h") {
    const yesterday = new Date(now);
    yesterday.setHours(yesterday.getHours() - 24);
    return yesterday.toISOString();
  }

  if (since === "last month" || since === "30d") {
    const lastMonth = new Date(now);
    lastMonth.setDate(lastMonth.getDate() - 30);
    return lastMonth.toISOString();
  }

  // Try parsing as ISO date
  try {
    const date = new Date(since);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  } catch (e) {
    // Invalid date format
  }

  return null;
}
```

### 徑③ 濾ing

`--path`·供ed, 加詢:
```javascript
query: "file change modification " + pathPattern
```

---

## 輸出格式

顯果實:

```
RECENT FILE CHANGES

1. [<time ago>] <file path>
   <change description preview>
   Tags: <tags>

2. [<time ago>] <file path>
   <change description preview>
   Tags: <tags>

...

Showing <N> changes. Use --limit to see more.
```·果實:
```
No file changes found.

Try:
- /specmem-changes --since "last week"
- /specmem-changes --limit 50
- Check if file watcher is running with:
  mcp__specmem__show_me_the_stats({})
```

---

## MCP·具⑤ 綱要

具⑤: `mcp__specmem__find_memory`·必要② 參s:
- `query`: 串 - 搜詢

可選參s:
- `limit`: 數 (1-1000, 默認: 10) - 最大① 果實
- `tags`: 串[] - 濾標④s
- `dateRange`: 物 - 時① 濾
- `start`: 串 (ISO 8601) - 啟① 日①
- `end`: 串 (ISO 8601) - 央日①
- `summarize`: 布① (默認: 真) - 返包舉ed·內容
- `maxContentLength`: 數 (默認: 500) - Truncate·內容長
- `recencyBoost`: 布① (默認: 真) - 催谷晚近果實
- `threshold`: 數 (0-1, 默認: 0.25) - 相似度閾值

---

##

### 瞻末 10 變遷·```
/specmem-changes
```

### 瞻變遷昨·```
/specmem-changes --since yesterday
```

### 瞻 20 變遷·src/ 目錄·```
/specmem-changes --limit 20 --path src/
```

### 瞻·TypeScript·檔變遷末 週·```
/specmem-changes --since "last week" --path "*.ts"
```