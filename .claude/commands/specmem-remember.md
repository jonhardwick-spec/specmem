# SpecMem·惦 - 儲回憶

## 具⑤: `mcp__specmem__save_memory`

## 用法·```
/specmem-remember <content>
/specmem-remember --type <type> --importance <level> --tags <tag1,tag2> <content>
/specmem-remember --metadata <key:value> --expires <ISO8601> <content>
```

## 極刑科

**必要②: 內容實參必是供ed (non-空串 析ing·幟s)**

1. ** ARGS·空** → 示佽 → 停 ( 叵呼① 具⑤)
2. **"佽" "-h" "--佽"** → 示佽 → 停 ( 叵呼① 具⑤)
3. ** 內容** → 析·args·執具⑤

## 執

**步 1: 析輸入可選幟s:**
- `--type <value>` → memoryType (默認: "語義")
- `--importance <value>` → 意義① (默認: "媒")
- `--tags <value>` → 標④s·陣② (讀-睽)
- `--metadata <key:value>` → 元數據物 (格式: 鍵:值·JSON)
- `--expires <ISO8601>` → expiresAt (ISO 8601 日①-時① 串)
- 餘幟s → 內容

**步 2: 驗內容存③s:**
- 內容空·whitespace- → 示佽 → 停

**步 3: 呼① MCP·具⑤:**

喚·`mcp__specmem__save_memory`·參s:
```
content: "<the parsed content string>" (REQUIRED)
memoryType: "<type>" (optional, default: "semantic")
importance: "<level>" (optional, default: "medium")
tags: ["tag1", "tag2"] (optional, parsed from comma-separated)
metadata: {key: "value"} (optional, additional structured data)
expiresAt: "ISO8601 date-time" (optional, when memory should expire)
imageBase64: "base64 string" (optional, base64-encoded image data)
imageMimeType: "image/png" (optional, MIME type for image)
```·具⑤ invocation `/specmem-remember The API uses JWT`:
```
mcp__specmem__save_memory({
  "content": "The API uses JWT",
  "memoryType": "semantic",
  "importance": "medium"
})
```·元數據·expiration:
```
mcp__specmem__save_memory({
  "content": "Temporary session data for debugging",
  "memoryType": "working",
  "importance": "low",
  "tags": ["debug", "session"],
  "metadata": {"sessionId": "abc123", "environment": "dev"},
  "expiresAt": "2026-01-22T00:00:00Z"
})
```

## 佽·```
SPECMEM REMEMBER - Store Persistent Memories

USAGE:
  /specmem-remember <content>
  /specmem-remember --type <type> --importance <level> --tags <tags> <content>
  /specmem-remember --metadata <key:value> --expires <ISO8601> <content>

MEMORY TYPES:
  episodic    - Events, experiences, temporal information
  semantic    - Facts, knowledge, general information (default)
  procedural  - How-to, processes, step-by-step instructions
  working     - Temporary info, short-term context

IMPORTANCE LEVELS:
  critical    - Mission-critical information, system failures
  high        - Very important, security issues, major decisions
  medium      - Standard importance (default)
  low         - Minor details, nice-to-know information
  trivial     - Minimal importance, temporary notes

OPTIONAL PARAMETERS:
  --tags <tag1,tag2>         - Comma-separated categorization tags
  --metadata <key:value>     - Additional structured data (JSON or key:value)
  --expires <ISO8601>        - Expiration date-time (ISO 8601 format)

FEATURES:
  • Auto-splitting for large content (>50KB automatically chunked)
  • Image support via imageBase64 and imageMimeType parameters
  • Unlimited content length with automatic chunking
  • Project-aware storage with automatic namespace isolation

EXAMPLES:
  /specmem-remember The API uses JWT tokens for authentication
  /specmem-remember --type procedural Run npm test before commit
  /specmem-remember --importance high --tags auth,security Use HTTPS only
  /specmem-remember --type working --expires 2026-01-25T00:00:00Z Temp debug data
  /specmem-remember --metadata env:production --tags deploy Deploy requires approval

TOOL SCHEMA (mcp__specmem__save_memory):
  content: string (REQUIRED) - Memory content to store
  memoryType: "episodic" | "semantic" | "procedural" | "working" (default: "semantic")
  importance: "critical" | "high" | "medium" | "low" | "trivial" (default: "medium")
  tags: string[] (default: []) - Categorization tags for search
  metadata: object (optional) - Additional structured data
  expiresAt: string (optional) - ISO 8601 date-time for expiration
  imageBase64: string (optional) - Base64-encoded image data
  imageMimeType: string (optional) - MIME type (e.g., image/png, image/jpeg)

RESPONSE:
  Success: {success: true, id: "uuid", message: "✓ stored (Xms)"}
  Chunked: {success: true, ids: ["uuid1", "uuid2"], message: "✓ stored N chunks"}
  Error: {success: false, message: "error description"}
```