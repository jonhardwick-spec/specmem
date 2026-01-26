# SpecMem Code - Codebase Search (user)

## REQUIRED: Check Arguments First

**IF no arguments provided OR args is empty/whitespace/help/-h/--help:**

OUTPUT THIS HELP AND STOP:

```
SpecMem Code - Semantic Codebase Search

USAGE:
  /specmem-code <query>           Search code by meaning
  /specmem-code auth middleware   Find authentication middleware
  /specmem-code --limit 20 error  Search with more results

OPTIONS:
  --limit N            Max results (default: 10, max: 100)
  --threshold N        Min similarity score 0-1 (default: 0.1)
  --lang LANG          Filter by language (typescript, python, go, rust, etc.)
  --file PATTERN       Filter by file pattern (e.g., "src/**/*.ts")
  --type TYPE          Filter by definition type (function, class, method, etc.)
  --zoom N             Zoom level 0-100: 0=signature only, 50=balanced, 100=full (default: 50)
  --no-memory-links    Skip linking code to related memories
  --no-attribution     Skip user/claude attribution
  --summarize          Truncate content for compact view

EXAMPLES:
  /specmem-code websocket handler
  /specmem-code --limit 5 form validation
  /specmem-code --lang python machine learning
  /specmem-code --file "src/api/*" route handlers
  /specmem-code --zoom 0 function signatures
  /specmem-code --type class authentication

DIFFERENCE FROM /specmem-pointers:
  - /specmem-code: Basic code search (NO tracebacks by default)
  - /specmem-pointers: Code search WITH tracebacks (caller/callee analysis)

RELATED:
  /specmem-pointers  Code search WITH tracebacks
  /specmem-find      Search memories (not code)
```

**DO NOT PROCEED WITHOUT A QUERY.**

---

## Has Query - Execute Search

**Parse the arguments:**
- `--limit N` -> limit parameter (default: 10, max: 100)
- `--threshold N` -> threshold parameter (default: 0.1)
- `--lang LANG` -> language parameter
- `--file PATTERN` -> filePattern parameter
- `--type TYPE` -> definitionTypes parameter (array)
- `--zoom N` -> zoom parameter (0-100, default: 50)
- `--no-memory-links` -> includeMemoryLinks: false
- `--no-attribution` -> includeAttribution: false
- `--summarize` -> summarize: true
- Remaining text = query

**VALIDATION:**
- If query is empty after parsing options -> STOP and show help
- If limit < 1 or limit > 100 -> ERROR: "limit must be 1-100"
- If threshold < 0 or threshold > 1 -> ERROR: "threshold must be 0-1"
- If zoom < 0 or zoom > 100 -> ERROR: "zoom must be 0-100"

**CALL THIS MCP TOOL NOW** (do not just display it, actually invoke it):

Use mcp__specmem__find_code_pointers with these parameters:
- query: the extracted search query (REQUIRED)
- limit: parsed limit or 10
- threshold: parsed threshold or 0.1
- language: if --lang was provided
- filePattern: if --file was provided
- definitionTypes: if --type was provided (as array)
- zoom: parsed zoom or 50
- includeTracebacks: false (DEFAULT for /specmem-code)
- includeMemoryLinks: true unless --no-memory-links
- includeAttribution: false unless explicitly requested
- summarize: true if --summarize provided
- maxContentLength: 0 (no truncation by default)

**Format the results:**

```
CODE SEARCH: "<query>"
Found N results (threshold: X.XX)

[1] <file>:<line> | <type> | score: <similarity>
    <code snippet>

    Memory Links: <related memories if available>

[2] <file>:<line> | <type> | score: <similarity>
    <code snippet>
...

TIP: Use /specmem-pointers for traceback analysis (what uses this code)
```

Show code context and memory links if available.
