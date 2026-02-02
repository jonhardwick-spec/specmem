# SpecMem DD - 互動① 記檢索戶② 乂

## 即時一舉必要②

**步 1: 查輸入**
容來①s `/specmem-drilldown`:

- 空, whitespace, "佽", "--佽", "-h" -> 示佽, 停
- 輸入·NUMERIC ID (e.g., `123`, `456`) -> Go·步 2A
- 輸入·UUID (e.g., `abc12345-...`) -> Go·步 2C
- (文⑤ 詢) -> Go·步 2B

---

## 步 2A: DD Numeric ID·輸入·numeric ID `/specmem-drilldown 123`:

**VALIDATION:**
- 查輸入有效整數
- 無效 (NaN, 反面,.) -> 示佽, 停

**執·MCP·具⑤:**

```
mcp__specmem__drill_down({
  drilldownID: <the numeric ID as integer>,
  includeCode: true,
  includeContext: true,
  includeRelated: true,
  relatedLimit: 5,
  compress: true
})
```

**顯果實:**
```
DRILLDOWN: Memory #<ID>

Content:
<full memory content from result.fullContent>

Paired Message:
<if pairedMessage exists, show result.pairedMessage.label and content>
<This shows the user prompt that triggered a Claude response, or vice versa>

Code References:
<code pointers from result.codeReferences if any>

Conversation Context:
<context before/after from result.conversationContext>

Related Memories:
1. [Drill: xxx] <preview>... (similarity: 0.XX)
2. [Drill: yyy] <preview>... (similarity: 0.XX)
...

Use /specmem-drilldown <ID> to explore related memories
```

---

## 步 2B: 搜·DD·輸入詢·`/specmem-drilldown authentication flow`:

**VALIDATION:**
- 查詢 叵空 微調
- 空 -> 示佽, 停

**執·MCP·具⑤:**

```
mcp__specmem__find_memory({
  query: "<the query text>",
  limit: 10,
  cameraRollMode: true,
  summarize: true,
  maxContentLength: 300
})
```

**顯果實·DD IDs:**
```
MEMORIES FOR: "<query>"

1. [Drill: 123] <preview text>... (score: 0.XX)
2. [Drill: 456] <preview text>... (score: 0.XX)
3. [Drill: 789] <preview text>... (score: 0.XX)
...

To explore deeper: /specmem-drilldown <ID>
```

---

## 步 2C: 滿① 記·UUID·輸入·UUID `/specmem-drilldown abc12345-6789-...`:

**VALIDATION:**
- 查輸入姿·UUID (容納s·突①s, hex·煳s)
- 無效 -> 示佽, 停

**執·MCP·具⑤:**

```
mcp__specmem__get_memory({
  id: "<the UUID string>",
  summarize: false
})
```

**顯滿① 記內容.**

---

## 佽

示·args, 空輸入, "佽", validation·失敗s:

```
SpecMem Drilldown - Memory Exploration

USAGE:
  /specmem-drilldown <query>       Search and get drilldown IDs
  /specmem-drilldown <ID>          Drill into specific memory by ID
  /specmem-drilldown <UUID>        Get memory by UUID
  /specmem-drilldown help          Show this help

EXAMPLES:
  /specmem-drilldown authentication system
  /specmem-drilldown 123
  /specmem-drilldown database schema design

CAMERA ROLL WORKFLOW:
  1. Search with a query -> get drilldown IDs in "camera roll" view
  2. Pick an ID -> drill into full content with drill_down
  3. Explore related memories -> repeat drilling
  4. View paired messages to see user prompts ↔ Claude responses

WHAT YOU GET:
  - Full memory content (not truncated, with compression for efficiency)
  - Paired message (the user prompt or Claude response that pairs with this)
  - Code references with live file content
  - Conversation context (before/after messages in conversation)
  - Related memories for further exploration

MCP TOOLS USED:
  - mcp__specmem__drill_down (by numeric ID)
  - mcp__specmem__find_memory (query search)
  - mcp__specmem__get_memory (by UUID)

RELATED:
  /specmem-find      Basic memory search
  /specmem-pointers  Code-focused search
```

---

## 具⑤ 綱要s

### drill_down
```json
{
  "drilldownID": "number - required - numeric ID from camera roll results",
  "includeCode": "boolean - include code references (default: true)",
  "includeContext": "boolean - include conversation context (default: true)",
  "includeRelated": "boolean - include related memories (default: true)",
  "relatedLimit": "number 1-20 - max related memories (default: 5)",
  "compress": "boolean - apply Traditional Chinese token compression (default: true)"
}
```

**提綱:**
- `compress: true`·用s·圓-征① 屬實壓縮令 效率
- 壓縮英① 崋丟 上下文
- 返s `pairedMessage`·示ing·戶② 提示 ↔ 克勞德應① 偶③ing

### find_memory
```json
{
  "query": "string - natural language search query",
  "limit": "number 1-1000 - results count (default: 10)",
  "cameraRollMode": "boolean - enable drilldown IDs (set true)",
  "summarize": "boolean - truncate content (default: true)",
  "maxContentLength": "number - content preview length (default: 500)"
}
```

### get_memory
```json
{
  "id": "string - UUID of specific memory",
  "summarize": "boolean - truncate content (default: false for drill-down)"
}
```

### get_memory_by_id
```json
{
  "drilldownID": "number - numeric ID from camera roll results"
}
```

**提綱:**
- 戇er `drill_down` - 返s·內容·exploration·選項s
- 返s `{ content: string, memoryID: string }` `null`·未找到