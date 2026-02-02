# SpecMem·碼 - Codebase·搜 (戶②)

## 必要②: 查言論① 首

** 言論① 供ed args·空/whitespace/help/-h/--help:**

輸出佽 停:

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

** 叵遂 詢.**

---

## 詢 - 執搜

**析言論①:**
- `--limit N` -> 限① 參 (默認: 10, 最大①: 100)
- `--threshold N` -> 閾值參 (默認: 0.1)
- `--lang LANG` -> 文④ 參
- `--file PATTERN` -> filePattern·參
- `--type TYPE` -> definitionTypes·參 (陣②)
- `--zoom N` -> 縮放參 (0-100, 默認: 50)
- `--no-memory-links` -> includeMemoryLinks: 假②
- `--no-attribution` -> includeAttribution: 假②
- `--summarize` -> 包舉: 真
- 餘文⑤ = 詢

**VALIDATION:**
- 詢空 析ing·選項s -> 停示 佽
- 限① < 1 限① > 100 -> 錯①: "限① 必是 1-100"
- 閾值 < 0 閾值 > 1 -> 錯①: "閾值必是 0-1"
- 縮放 < 0 縮放 > 100 -> 錯①: "縮放必是 0-100"

**呼① MCP·具⑤ ** ( 叵顯, 喚 ):

用·mcp__specmem__find_code_pointers·參s:
- 詢: 撮ed·搜詢 (必要②)
- 限①: 析ed·限① 10
- 閾值: 析ed·閾值·0.1
- 文④: --lang·供ed
- filePattern: --檔供ed
- definitionTypes: -- 供ed ( 陣②)
- 縮放: 析ed·縮放 50
- includeTracebacks: 假② (默認 /SM-碼)
- includeMemoryLinks: 真 ---記-鏈s
- includeAttribution: 假② explicitly·求①ed
- 包舉: 真 --包舉供ed
- maxContentLength: 0 ( truncation·默認)

**格式果實:**

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
```·示碼 上下文記 鏈s·可用.