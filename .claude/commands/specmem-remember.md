# SpecMem Remember - Store Memories

## Tool: `mcp__specmem__save_memory`

## Usage
```
/specmem-remember <content>
/specmem-remember --type <type> --importance <level> --tags <tag1,tag2> <content>
/specmem-remember --metadata <key:value> --expires <ISO8601> <content>
```

## Execution Rules

**REQUIRED: content argument must be provided (non-empty string after parsing flags)**

1. **NO ARGS or EMPTY** → Show Help below → STOP (do not call tool)
2. **"help" or "-h" or "--help"** → Show Help below → STOP (do not call tool)
3. **HAS CONTENT** → Parse args and execute tool below

## Execute

**Step 1: Parse the input for optional flags:**
- `--type <value>` → memoryType (default: "semantic")
- `--importance <value>` → importance (default: "medium")
- `--tags <value>` → tags array (comma-separated)
- `--metadata <key:value>` → metadata object (format: key:value or JSON)
- `--expires <ISO8601>` → expiresAt (ISO 8601 date-time string)
- Everything remaining after flags → content

**Step 2: Validate content exists:**
- If content is empty or whitespace-only → Show Help → STOP

**Step 3: Call the MCP tool:**

You MUST invoke `mcp__specmem__save_memory` with these parameters:
```
content: "<the parsed content string>" (REQUIRED)
memoryType: "<type>" (optional, default: "semantic")
importance: "<level>" (optional, default: "medium")
tags: ["tag1", "tag2"] (optional, parsed from comma-separated)
metadata: {key: "value"} (optional, additional structured data)
expiresAt: "ISO8601 date-time" (optional, when memory should expire)
imageBase64: "base64 string" (optional, base64-encoded image data)
imageMimeType: "image/png" (optional, MIME type for image)
```

Example tool invocation for `/specmem-remember The API uses JWT`:
```
mcp__specmem__save_memory({
  "content": "The API uses JWT",
  "memoryType": "semantic",
  "importance": "medium"
})
```

Example with metadata and expiration:
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

## Help

```
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
