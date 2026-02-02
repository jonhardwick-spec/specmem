# SpecMem Find
Semantic memory search - finds memories by meaning, not just keywords.

## Tool Mapping
This command executes: `mcp__specmem__find_memory`

## EXECUTION INSTRUCTIONS

**STEP 1: Check arguments**
```
IF args is empty OR args equals "help" OR args equals "--help":
    OUTPUT the Help Output section below
    STOP - do not call any tools
```

**STEP 2: Parse the input**
```
1. Extract flags:
   --limit N           Results count (1-1000, default: 10)
   --threshold N       Similarity score 0-1 (default: 0.25)
   --type TYPE         Memory type filter (episodic, semantic, procedural, working, consolidated)
   --tags TAGS         Tag filter (comma-separated)
   --importance IMP    Importance filter (critical, high, medium, low, trivial)
   --after DATE        After date ("yesterday", "last week", "2024-01-15")
   --before DATE       Before date
   --recent N          Force include N recent memories (0-50)
   --no-recency-boost  Disable recency boost
   --no-keyword        Disable keyword fallback
   --role ROLE         Filter by role (user, assistant)
   --full              Return full content (no summarization)
   --max-length N      Max content length in chars (default: 500, 0 = no limit)
   --gallery           Enable gallery mode with Mini COT analysis
   --camera-roll       Enable camera roll format with drilldownIDs
   --zoom LEVEL        Zoom level: ultra-wide, wide, normal, close, macro
   --project PATH      Search specific project path
   --all-projects      Search ALL projects (cross-project search)

2. Everything remaining after flags is the QUERY
3. IF query is empty after parsing:
    OUTPUT the Error Output section below
    STOP - do not call any tools
```

**STEP 3: Execute MCP tool (REQUIRED - must actually call this)**
```
mcp__specmem__find_memory({
  query: "<the extracted query string>",
  limit: <--limit value or default 10>,
  threshold: <--threshold value or default 0.25>,
  memoryTypes: <array with --type value if provided, otherwise omit>,
  tags: <array from --tags split by comma if provided, otherwise omit>,
  importance: <array from --importance split by comma if provided, otherwise omit>,
  dateRange: <object with start/end if --after/--before provided, otherwise omit>,
  includeRecent: <--recent value or default 0>,
  recencyBoost: <true unless --no-recency-boost specified>,
  keywordFallback: <true unless --no-keyword specified>,
  role: <--role value if provided, otherwise omit>,
  summarize: <false if --full specified, otherwise true>,
  maxContentLength: <--max-length value or default 500>,
  galleryMode: <true if --gallery specified, otherwise false>,
  cameraRollMode: <true if --camera-roll specified, otherwise false>,
  zoomLevel: <--zoom value if provided, otherwise omit>,
  projectPath: <--project value if provided, otherwise omit>,
  allProjects: <true if --all-projects specified, otherwise false>
})
```

**STEP 4: Display results**
Format the tool response for the user, showing matching memories with their content and relevance scores.

---

## Usage
```
/specmem-find <query>           # REQUIRED: query cannot be empty
/specmem-find --limit 5 <query>
/specmem-find --type procedural <query>
/specmem-find --recent 10 <query>
/specmem-find --camera-roll --zoom wide <query>
/specmem-find --all-projects <query>
```

## Help Output
(shown when no args or "help")

```
SpecMem Find - Semantic Memory Search

USAGE:
  /specmem-find <query>
  /specmem-find [options] <query>

SEARCH OPTIONS:
  --limit N           Results count (1-1000, default: 10)
  --threshold N       Similarity 0-1 (default: 0.25, lower = more results)
  --recent N          Force include N recent memories (0-50)
  --no-recency-boost  Disable automatic recency boost
  --no-keyword        Disable keyword fallback search

FILTER OPTIONS:
  --type TYPE         Memory type: episodic, semantic, procedural, working, consolidated
  --tags TAGS         Filter by tags (comma-separated)
  --importance IMP    Filter by importance: critical, high, medium, low, trivial
  --role ROLE         Filter by role: user (your messages), assistant (Claude)
  --after DATE        After date ("yesterday", "last week", "2024-01-15")
  --before DATE       Before date

OUTPUT OPTIONS:
  --full              Return full content (no truncation)
  --max-length N      Max content length in chars (default: 500, 0 = unlimited)
  --gallery           Enable gallery mode with Mini COT analysis
  --camera-roll       Enable camera roll format with drilldownIDs
  --zoom LEVEL        Zoom: ultra-wide (50), wide (25), normal (15), close (10), macro (5)

PROJECT OPTIONS:
  --project PATH      Search specific project path
  --all-projects      Search ALL projects (cross-project search)

EXAMPLES:
  /specmem-find authentication flow
  /specmem-find --limit 5 database schema
  /specmem-find --type procedural deployment steps
  /specmem-find --tags api,auth token handling
  /specmem-find --after yesterday recent decisions
  /specmem-find --recent 10 what did we discuss
  /specmem-find --role user what I asked about
  /specmem-find --camera-roll --zoom wide project architecture
  /specmem-find --all-projects similar patterns

SEMANTIC SEARCH:
  Uses vector embeddings for meaning-based search.
  "auth tokens" finds memories about "JWT cookies" even
  if those exact words weren't used.

CAMERA ROLL MODE:
  Returns compact results with drilldownIDs for exploration.
  Use /specmem-drilldown <ID> to get full details.

ZOOM LEVELS:
  ultra-wide: 50 results, 15% threshold (broad overview)
  wide:       25 results, 25% threshold (balanced)
  normal:     15 results, 40% threshold (focused)
  close:      10 results, 60% threshold (precise)
  macro:       5 results, 80% threshold (exact matches)

RELATED COMMANDS:
  /specmem-remember   Store new memories
  /specmem-drilldown  Deep dive into a memory
  /specmem-stats      View memory statistics
```

## Tool Schema
```json
{
  "query": "string - natural language search query (not required, empty shows help)",
  "limit": "number 1-1000 - results count (default: 10)",
  "threshold": "number 0-1 - min similarity (default: 0.25)",
  "includeRecent": "number 0-50 - force include N recent memories (default: 0)",
  "recencyBoost": "boolean - boost recent memories (default: true)",
  "keywordFallback": "boolean - fallback to keyword search if no results (default: true)",
  "memoryTypes": ["episodic", "semantic", "procedural", "working", "consolidated"],
  "tags": ["array", "of", "filter", "tags"],
  "importance": ["critical", "high", "medium", "low", "trivial"],
  "dateRange": {
    "start": "ISO date string",
    "end": "ISO date string"
  },
  "includeExpired": "boolean - include expired memories (default: false)",
  "role": "string - user or assistant filter",
  "summarize": "boolean - truncate content (default: true)",
  "maxContentLength": "number - max content chars (default: 500, 0 = unlimited)",
  "galleryMode": "boolean or 'ask' - Mini COT analysis (default: false)",
  "cameraRollMode": "boolean - camera roll format with drilldownIDs (default: false)",
  "zoomLevel": "string - ultra-wide, wide, normal, close, macro",
  "projectPath": "string - search specific project path",
  "allProjects": "boolean - search ALL projects (default: false)"
}
```

## Error Output
(shown for invalid input)

```
Error: No search query provided

USAGE: /specmem-find <query>

Examples:
  /specmem-find authentication system
  /specmem-find --limit 5 database schema
  /specmem-find --type procedural how to deploy
  /specmem-find --recent 10 recent discussions

Run /specmem-find help for full options.
```
