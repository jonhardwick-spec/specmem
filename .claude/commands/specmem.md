# SpecMem
Main command hub for SpecMem - memory, codebase, and team coordination.

## Tool Mapping
This command is a ROUTER that dispatches to MCP tools or dedicated commands.

## Usage
```
/specmem                     # Show help
/specmem help                # Show help
/specmem <subcommand> [args]
```

## When Called - EXECUTION LOGIC

**Step 1: Parse Input**
- Extract first word as `subcommand`
- Extract remaining words as `args`

**Step 2: Input Validation**
Before routing, validate required arguments:

| Subcommand | Validation Required |
|------------|---------------------|
| find, remember, code, search | args must not be empty |
| drill, drilldown | args must be a valid positive integer |
| team send, team claim, team help | second argument and beyond required |

If validation fails, show appropriate error message from ERROR HANDLING section below.

**Step 3: Route by Subcommand**

| If subcommand is... | EXECUTE THIS |
|---------------------|--------------|
| (empty) / "help" / "--help" / "-h" | Show HELP OUTPUT below, then STOP |
| "find" | Validate args exist → `mcp__specmem__find_memory({query: "<args>", summarize: true, limit: 10})` |
| "remember" / "store" | Validate args exist → `mcp__specmem__save_memory({content: "<args>", importance: "medium"})` |
| "stats" | `mcp__specmem__show_me_the_stats({includeTypeDistribution: true, includeImportanceDistribution: true, includeCacheStats: true, includeInstanceStats: true})` |
| "code" / "search" | Validate args exist → `mcp__specmem__find_code_pointers({query: "<args>", limit: 10, includeTracebacks: true})` |
| "team" | See TEAM SUBCOMMAND ROUTING below |
| "sync" | `mcp__specmem__check_sync({detailed: true})` |
| "watch" | `mcp__specmem__start_watching({})` |
| "drill" / "drilldown" | Validate args is number → `mcp__specmem__drill_down({drilldownID: <args as number>, includeCode: true, includeContext: true, includeRelated: true})` |
| UNKNOWN | Show: "Unknown subcommand: <subcommand>. Run /specmem help for available commands." |

**Step 4: TEAM Subcommand Routing**
When subcommand is "team", parse `args` for team action:

| team args | Validation | EXECUTE THIS |
|-----------|------------|--------------|
| "status" | None | `mcp__specmem__get_team_status({})` |
| "send <message>" | Check message exists | `mcp__specmem__send_team_message({message: "<message>", type: "update", priority: "normal"})` |
| "messages" / "read" | None | `mcp__specmem__read_team_messages({limit: 10, compress: true})` |
| "claim <desc>" | Check desc exists | `mcp__specmem__claim_task({description: "<desc>"})` |
| "release <id>" | Check id exists | `mcp__specmem__release_task({claimId: "<id>"})` |
| "help <question>" | Check question exists | `mcp__specmem__request_help({question: "<remaining args>"})` |
| (empty) | None | Show team help: "Usage: /specmem team [status|send|messages|claim|release|help]\n\nExamples:\n  /specmem team status\n  /specmem team send Working on auth\n  /specmem team claim Fixing login bug" |

## Help Output
(Display this EXACTLY when no args, "help", "--help", or "-h")

```
SpecMem - Intelligent Memory & Codebase System

USAGE:
  /specmem <subcommand> [arguments]

MEMORY SEARCH & STORAGE:
  /specmem find <query>        Semantic search across all memories
                               Example: /specmem find authentication flow

  /specmem remember <content>  Store new memory with medium importance
                               Example: /specmem remember API uses JWT

  /specmem drill <id>          Drill into memory details using drilldownID
                               Example: /specmem drill 12345

  /specmem stats               Show memory statistics and distributions

CODEBASE SEARCH:
  /specmem code <query>        Semantic code search with tracebacks
                               Example: /specmem code websocket handler

  /specmem search <query>      Alias for 'code' command

TEAM COORDINATION:
  /specmem team status         See active claims and team activity
  /specmem team send <msg>     Send update/status to team
  /specmem team messages       Read recent team messages (last 10)
  /specmem team claim <desc>   Claim task/files to avoid conflicts
  /specmem team release <id>   Release a claim (use 'all' to release all)
  /specmem team help <question> Broadcast help request to team

SYSTEM MANAGEMENT:
  /specmem sync                Check if files are in sync with memories
  /specmem watch               Start file watcher for auto-sync

DEDICATED COMMANDS (advanced features):
  /specmem-find                Memory search with filters (tags, types, etc)
  /specmem-code                Code search with language/file filters
  /specmem-pointers            Code search with caller/callee analysis
  /specmem-remember            Store memory with custom importance/tags
  /specmem-stats               Full statistics with cache performance
  /specmem-drilldown           Interactive memory exploration
  /specmem-team-member         Deploy autonomous team members
  /specmem-changes             View file change history
  /specmem-hooks               Manage custom Claude hooks
  /specmem-service             Service mode management
  /specmem-autoclaude          Autonomous task execution mode

WORKFLOW EXAMPLES:
  # Start working on a task
  /specmem team claim "Fixing authentication bug"
  /specmem team status

  # Research before coding
  /specmem find authentication implementation
  /specmem code login handler

  # Update team on progress
  /specmem team send "Auth bug fixed, testing now"

  # Complete work
  /specmem team release all
  /specmem team send "Auth bug fix complete"

TIPS:
  - Use 'find' for searching conversations/memories
  - Use 'code' for searching actual code files
  - Always 'claim' tasks before starting to avoid conflicts
  - Use 'drill' to explore detailed memory content
  - Check 'team status' to see what others are working on
```

## Error Handling

**Unknown subcommand:**
```
Unknown subcommand: "<input>"

Run /specmem help to see available commands.
```

**Missing required argument (find, remember, code, search):**
```
Error: '<subcommand>' requires a search query or content.

Usage: /specmem <subcommand> <argument>

Examples:
  /specmem find authentication flow
  /specmem remember "User auth uses JWT tokens"
  /specmem code websocket connection handler
```

**Invalid drilldown ID:**
```
Error: 'drill' requires a valid numeric drilldown ID.

Usage: /specmem drill <drilldownID>

Example:
  /specmem drill 12345

Get drilldown IDs from:
  - find_memory results with cameraRollMode: true
  - Previous drill_down results in relatedMemories
```

**Team subcommand missing action:**
```
Usage: /specmem team [status|send|messages|claim|release|help]

Examples:
  /specmem team status              # See who's working on what
  /specmem team send "Working on auth"   # Update team
  /specmem team messages            # Read recent messages
  /specmem team claim "Fixing login"     # Claim task
  /specmem team release all         # Release all claims
  /specmem team help "Need help with websockets"  # Ask for help
```

**Team subcommand missing message/description:**
```
Error: '/specmem team <action>' requires additional information.

Examples:
  /specmem team send <message>      # Requires a message
  /specmem team claim <description> # Requires task description
  /specmem team release <claimId>   # Requires claim ID or 'all'
  /specmem team help <question>     # Requires your question

Try '/specmem team status' or '/specmem team messages' for no-arg commands.
```

## Tool Schema Reference

### find_memory
```json
{
  "query": "string - natural language search (REQUIRED)",
  "limit": "number 1-1000 (default: 10)",
  "threshold": "number 0-1 (default: 0.25)",
  "memoryTypes": ["episodic", "semantic", "procedural", "working"],
  "tags": ["string array"],
  "summarize": "boolean (default: true) - truncate for compact view",
  "recencyBoost": "boolean (default: true) - boost recent memories",
  "cameraRollMode": "boolean (default: false) - enable drill-down IDs",
  "includeRecent": "number 0-50 (default: 0) - force include N most recent"
}
```

### save_memory
```json
{
  "content": "string - content to store (REQUIRED)",
  "importance": "critical|high|medium|low|trivial (default: medium)",
  "memoryType": "episodic|semantic|procedural|working (default: semantic)",
  "tags": ["string array"],
  "metadata": "object - additional structured data"
}
```

### show_me_the_stats
```json
{
  "includeTypeDistribution": "boolean (default: true)",
  "includeImportanceDistribution": "boolean (default: true)",
  "includeCacheStats": "boolean (default: true)",
  "includeInstanceStats": "boolean (default: true)",
  "includeRelationshipStats": "boolean (default: false)",
  "includeTagDistribution": "boolean (default: false)"
}
```

### find_code_pointers
```json
{
  "query": "string - what code to find (REQUIRED)",
  "limit": "number 1-100 (default: 10)",
  "includeTracebacks": "boolean (default: true) - show callers/callees",
  "language": "typescript|javascript|python|go|rust|etc - filter by language",
  "filePattern": "string - filter by path (e.g., 'routes/*.ts')",
  "definitionTypes": ["function", "method", "class", "interface", etc],
  "threshold": "number 0-1 (default: 0.1)",
  "zoom": "number 0-100 (default: 50) - content detail level"
}
```

### get_team_status
```json
{}
```
Returns: activeClaims, recentActivity, openHelpRequests

### send_team_message
```json
{
  "message": "string - message content (REQUIRED)",
  "type": "status|question|update|broadcast|help_request (default: update)",
  "priority": "low|normal|high|urgent (default: normal)",
  "thread_id": "string - optional thread ID for replies"
}
```

### read_team_messages
```json
{
  "limit": "number 1-100 (default: 10)",
  "unread_only": "boolean (default: false)",
  "mentions_only": "boolean (default: false)",
  "compress": "boolean (default: true) - use Chinese token compression"
}
```

### claim_task
```json
{
  "description": "string - what you're working on (REQUIRED)",
  "files": ["array of file paths to lock"]
}
```
Returns: claimId (save this for release_task)

### release_task
```json
{
  "claimId": "string - claim ID or 'all' (REQUIRED)"
}
```
Use claimId from claim_task response, or 'all' to release everything

### request_help
```json
{
  "question": "string - what you need help with (REQUIRED)",
  "context": "string - additional context about the problem",
  "skills_needed": ["array of skills like 'database', 'typescript', etc"]
}
```
Returns: requestId for tracking responses

### check_sync
```json
{
  "detailed": "boolean (default: false) - include file-by-file drift info"
}
```
Returns: syncScore (0-100), driftedFiles, missingFiles, deletedFiles

### start_watching
```json
{
  "rootPath": "string - directory to watch (default: current working dir)",
  "syncCheckIntervalMinutes": "number 1-1440 (default: 60)"
}
```
Starts background file watcher for automatic memory updates

### drill_down
```json
{
  "drilldownID": "number - the ID from find_memory results (REQUIRED)",
  "includeCode": "boolean (default: true) - include code references",
  "includeContext": "boolean (default: true) - include conversation context",
  "includeRelated": "boolean (default: true) - include related memories",
  "relatedLimit": "number 1-20 (default: 5) - max related memories",
  "compress": "boolean (default: true) - use token compression"
}
```
Returns: fullContent, pairedMessage, conversationContext, relatedMemories, codeReferences

## Implementation Notes

**For Claude Code developers:**
1. This is a ROUTING command - parse subcommand and dispatch to MCP tools
2. Always validate inputs BEFORE calling MCP tools
3. Provide helpful error messages that guide users to correct usage
4. For team commands, extract the action word and remaining args separately
5. The drill command requires numeric validation - use parseInt and check isNaN
6. All MCP tool schemas are accurate as of the last audit (2026-01-21)

**Command Execution Flow:**
```
User Input → Parse subcommand → Validate args → Route to MCP tool → Return result
                                       ↓
                                  (if invalid)
                                       ↓
                              Show error with example
```

**Testing Checklist:**
- [ ] /specmem with no args shows help
- [ ] /specmem help shows help
- [ ] /specmem find without args shows error
- [ ] /specmem find "query" calls find_memory
- [ ] /specmem drill without args shows error
- [ ] /specmem drill abc shows invalid number error
- [ ] /specmem drill 123 calls drill_down
- [ ] /specmem team shows team help
- [ ] /specmem team status calls get_team_status
- [ ] /specmem team send without message shows error
- [ ] /specmem unknown shows unknown command error
