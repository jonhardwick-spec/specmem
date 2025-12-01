# SpecMem Changes - File Change History

## CRITICAL: DIRECT MCP TOOL EXECUTION

This command MUST directly call MCP tools - no delegation to other skills.

---

## INPUT VALIDATION (DO THIS FIRST!)

Extract everything after `/specmem-changes`:

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

## HELP OUTPUT

Show this when no args or "help":

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

## EXECUTION

**EXECUTE THIS MCP TOOL DIRECTLY:**

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

### Date Range Calculation

Convert `--since` values to ISO 8601 format:

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

### Path Filtering

If `--path` provided, add to query:
```javascript
query: "file change modification " + pathPattern
```

---

## OUTPUT FORMAT

Display results as:

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
```

If no results:
```
No file changes found.

Try:
- /specmem-changes --since "last week"
- /specmem-changes --limit 50
- Check if file watcher is running with:
  mcp__specmem__show_me_the_stats({})
```

---

## MCP TOOL SCHEMA

Tool: `mcp__specmem__find_memory`

Required parameters:
- `query`: string - Search query

Optional parameters:
- `limit`: number (1-1000, default: 10) - Max results
- `tags`: string[] - Filter by tags
- `dateRange`: object - Time filter
  - `start`: string (ISO 8601) - Start date
  - `end`: string (ISO 8601) - End date
- `summarize`: boolean (default: true) - Return summarized content
- `maxContentLength`: number (default: 500) - Truncate content length
- `recencyBoost`: boolean (default: true) - Boost recent results
- `threshold`: number (0-1, default: 0.25) - Similarity threshold

---

## EXAMPLES

### View last 10 changes
```
/specmem-changes
```

### View changes from yesterday
```
/specmem-changes --since yesterday
```

### View 20 changes in src/ directory
```
/specmem-changes --limit 20 --path src/
```

### View TypeScript file changes from last week
```
/specmem-changes --since "last week" --path "*.ts"
```
