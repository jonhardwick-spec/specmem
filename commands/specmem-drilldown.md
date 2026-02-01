# SpecMem Drilldown - Interactive Memory Retrieval with User Control

## IMMEDIATE ACTION REQUIRED

**Step 1: Check Input**
Look at what comes after `/specmem-drilldown`:

- If EMPTY, whitespace only, "help", "--help", or "-h" -> Show HELP below, STOP
- If input is a NUMERIC ID (e.g., `123`, `456`) -> Go to Step 2A
- If input is a UUID (e.g., `abc12345-...`) -> Go to Step 2C
- Otherwise (text query) -> Go to Step 2B

---

## Step 2A: Drilldown by Numeric ID

When input is a numeric ID like `/specmem-drilldown 123`:

**VALIDATION:**
- Check that input is a valid integer
- If invalid (NaN, negative, etc.) -> Show HELP, STOP

**EXECUTE THIS MCP TOOL NOW:**

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

**Display results as:**
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

## Step 2B: Search then Drilldown

When input is a query like `/specmem-drilldown authentication flow`:

**VALIDATION:**
- Check that query is not empty after trimming
- If empty -> Show HELP, STOP

**EXECUTE THIS MCP TOOL NOW:**

```
mcp__specmem__find_memory({
  query: "<the query text>",
  limit: 10,
  cameraRollMode: true,
  summarize: true,
  maxContentLength: 300
})
```

**Display results with drilldown IDs:**
```
MEMORIES FOR: "<query>"

1. [Drill: 123] <preview text>... (score: 0.XX)
2. [Drill: 456] <preview text>... (score: 0.XX)
3. [Drill: 789] <preview text>... (score: 0.XX)
...

To explore deeper: /specmem-drilldown <ID>
```

---

## Step 2C: Get Full Memory by UUID

When input is a UUID like `/specmem-drilldown abc12345-6789-...`:

**VALIDATION:**
- Check that input looks like a UUID (contains dashes, hex chars)
- If invalid -> Show HELP, STOP

**EXECUTE THIS MCP TOOL NOW:**

```
mcp__specmem__get_memory({
  id: "<the UUID string>",
  summarize: false
})
```

**Display the full memory content.**

---

## HELP

Show this when no args, empty input, "help", or validation fails:

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

## Tool Schemas

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

**NOTES:**
- `compress: true` uses round-trip verified compression for token efficiency
- Compression keeps English where Chinese would lose context
- Returns `pairedMessage` showing user prompt ↔ Claude response pairing

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

**NOTES:**
- Simpler than `drill_down` - just returns content without exploration options
- Returns `{ content: string, memoryID: string }` or `null` if not found
