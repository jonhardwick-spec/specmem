# SpecMem Pointers - Semantic Code Search with Tracebacks (user)

## IMMEDIATE ACTION REQUIRED

**Step 1: Check Input**
Look at what comes after `/specmem-pointers`:

- If EMPTY, whitespace only, "help", "--help", or "-h" → Show HELP below, STOP
- Otherwise → Continue to Step 2

**Step 2: Parse Arguments**
Extract from input:
- `--limit N` → set limit (default: 10, max: 100)
- `--threshold N` → set threshold (default: 0.1, range: 0-1)
- `--gallery` → galleryMode: true (Mini COT analysis)
- `--camera` → cameraRollMode: true (drilldown IDs)
- `--zoom-level LEVEL` → zoomLevel: ultra-wide/wide/normal/close/macro
- `--zoom N` → zoom: 0-100 (0=signature, 50=balanced, 100=full)
- `--lang LANG` → set language filter
- `--file PATTERN` → set filePattern
- `--type TYPE` → set definitionTypes (function, class, method, etc.)
- `--no-tracebacks` → includeTracebacks: false
- `--no-memory-links` → includeMemoryLinks: false
- `--with-attribution` → includeAttribution: true
- `--cot-scoring` → useCotScoring: true
- `--summarize` → summarize: true
- `--max-content N` → maxContentLength: N
- Everything else = the query

**VALIDATION:**
- If query is empty after parsing options → STOP and show HELP
- If limit < 1 or limit > 100 → ERROR: "limit must be 1-100"
- If threshold < 0 or threshold > 1 → ERROR: "threshold must be 0-1"
- If zoom < 0 or zoom > 100 → ERROR: "zoom must be 0-100"

**Step 3: EXECUTE THIS MCP TOOL NOW**

```
mcp__specmem__find_code_pointers({
  query: "<extracted query>",
  limit: <limit or 10>,
  threshold: <threshold or 0.1>,
  includeTracebacks: <true unless --no-tracebacks>,
  includeMemoryLinks: <true unless --no-memory-links>,
  includeAttribution: <true if --with-attribution>,
  galleryMode: <true if --gallery>,
  cameraRollMode: <true if --camera>,
  useCotScoring: <true if --cot-scoring>,
  zoomLevel: "<zoom level if provided>",
  zoom: <zoom value if provided or 50>,
  language: "<lang if provided>",
  filePattern: "<pattern if provided>",
  definitionTypes: <[type] if provided>,
  summarize: <true if --summarize>,
  maxContentLength: <N if --max-content>
})
```

**Step 4: Display Results**
Show the tool output formatted as:

```
CODE POINTERS: "<query>"
Found N results (threshold: X.XX)

[1] <file>:<line> | <type> | score: <similarity>
    <code snippet>

    USED BY (Tracebacks):
    - <caller-file>:<line>
    - <caller-file>:<line>

    Memory Links: <related memories if available>
    Attribution: <user/assistant if enabled>

[2] <file>:<line> | <type> | score: <similarity>
    <code snippet>

    USED BY:
    - <caller-file>:<line>
...
```

If --gallery, include Mini COT analysis summary.
If --camera, mention drilldown IDs for exploration.
If --with-attribution, show who created/modified the code.

---

## HELP

```
SpecMem Pointers - Semantic Code Search with Tracebacks

USAGE:
  /specmem-pointers <query>
  /specmem-pointers authentication flow
  /specmem-pointers --gallery websocket handler
  /specmem-pointers --limit 20 database queries

OPTIONS:
  --limit N              Max results (default: 10, max: 100)
  --threshold N          Min similarity 0-1 (default: 0.1)
  --gallery              Enable Mini COT analysis (deeper insights)
  --camera               Enable camera roll mode (drilldown IDs)
  --zoom-level LEVEL     ultra-wide/wide/normal/close/macro
  --zoom N               Zoom 0-100: 0=sig only, 50=balanced, 100=full
  --lang LANG            Filter by language (typescript, python, etc.)
  --file PATTERN         Filter by file pattern (e.g., "src/**/*.ts")
  --type TYPE            Filter by type (function, class, method, etc.)
  --no-tracebacks        Skip caller/callee analysis
  --no-memory-links      Skip memory attribution
  --with-attribution     Show user/claude attribution
  --cot-scoring          Enable Mini COT relevance scoring
  --summarize            Truncate content for compact view
  --max-content N        Max content length (0=unlimited)

EXAMPLES:
  /specmem-pointers error handling middleware
  /specmem-pointers --gallery api validation
  /specmem-pointers --limit 15 form components
  /specmem-pointers --lang python data processing
  /specmem-pointers --zoom 0 function signatures
  /specmem-pointers --camera --zoom-level wide search patterns
  /specmem-pointers --with-attribution authentication logic

WHAT IT DOES:
  1. Semantic search finds code by MEANING (not keywords)
  2. Shows tracebacks - what files import/use the code
  3. Links code to related memories (context from past work)
  4. Gallery mode adds AI analysis of results
  5. Camera roll mode enables drill-down exploration

TRACEBACKS:
  Shows which files use the found code:
  - Import relationships
  - Function calls
  - Class usage
  - Caller/callee analysis

DIFFERENCE FROM /specmem-code:
  - /specmem-code: Basic code search (NO tracebacks by default)
  - /specmem-pointers: Code search WITH tracebacks enabled

RELATED:
  /specmem-code     Code search WITHOUT tracebacks
  /specmem-find     Search memories (not code)
  /specmem-changes  View file change history
```
