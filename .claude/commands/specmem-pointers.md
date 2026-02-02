# SpecMem·指①s - 語義碼 搜追蹤s (戶②)

## 即時一舉必要②

**步 1: 查輸入**
容來①s `/specmem-pointers`:

- 空, whitespace, "佽", "--佽", "-h" → 示佽, 停
- → 承① 步 2

**步 2: 析言論①**
撮輸入:
- `--limit N` → 集限① (默認: 10, 最大①: 100)
- `--threshold N` → 集閾值 (默認: 0.1, 範圍: 0-1)
- `--gallery` → galleryMode: 真 (迷你·COT·分析)
- `--camera` → cameraRollMode: 真 (DD IDs)
- `--zoom-level LEVEL` → zoomLevel: ultra-寬③/wide/normal/close/macro
- `--zoom N` → 縮放: 0-100 (0=簽名, 50=均衡, 100=滿①)
- `--lang LANG` → 集文④ 濾
- `--file PATTERN` → 集·filePattern
- `--type TYPE` → 集·definitionTypes (函, 類, 法②,.)
- `--no-tracebacks` → includeTracebacks: 假②
- `--no-memory-links` → includeMemoryLinks: 假②
- `--with-attribution` → includeAttribution: 真
- `--cot-scoring` → useCotScoring: 真
- `--summarize` → 包舉: 真
- `--max-content N` → maxContentLength: N
- 還① = 詢

**VALIDATION:**
- 詢空 析ing·選項s → 停示 佽
- 限① < 1 限① > 100 → 錯①: "限① 必是 1-100"
- 閾值 < 0 閾值 > 1 → 錯①: "閾值必是 0-1"
- 縮放 < 0 縮放 > 100 → 錯①: "縮放必是 0-100"

**步 3: 執·MCP·具⑤ **

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

**步 4: 顯果實**
示具⑤ 輸出格式ed:

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

--坑道, 含迷你·COT·分析摘要.
--照像機, 提·DD IDs exploration.
---歸功, 示創ed/modified·碼.

---

## 佽·```
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