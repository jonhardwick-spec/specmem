# SpecMem Command → Tool Mapping

Quick reference mapping all SpecMem commands to their corresponding MCP tools and resources.

---

## Commands Summary Table

| # | Command | Primary Tool | Secondary Tools | Required Args |
|---|---------|--------------|-----------------|---------------|
| 1 | `/specmem-find` | `mcp__specmem__find_memory` | N/A | query (2+ words) |
| 2 | `/specmem-stats` | `mcp__specmem__show_me_the_stats` | N/A | none (optional: memory, codebase, team-members) |
| 3 | `/specmem-drilldown` | `mcp__specmem__find_memory` | `mcp__specmem__spawn_research_team_member` | query (start or auto mode) |
| 4 | `/specmem-changes` | File change history tracker | N/A | none (optional: --limit, --path, --type) |
| 5 | `/specmem-hooks` | Hook manager | N/A | subcommand (list, add, remove, enable, disable, deploy, scan, example, status) |
| 6 | `/specmem-code` | `mcp__specmem__find_code_pointers` | N/A | query (code search) |
| 7 | `/specmem-remember` | `mcp__specmem__save_memory` | N/A | content (required) |
| 8 | `/specmem-pointers` | `mcp__specmem__find_code_pointers` | N/A | query (semantic code search) |
| 9 | `/specmem-configteammembercomms` | AskUserQuestion + Hook/HTTP Config | N/A | none (interactive selection) |
| 10 | `/specmem` | `mcp__specmem__send_team_message` + `mcp__specmem__read_team_messages` | Task tool | action (deploy, list, memory, codebase) |
| 11 | `/specmem-getdashboard` | Configuration reader | N/A | none |
| 12 | `/specmem-team-member` | HTTP API endpoints + Task tool | `mcp__specmem__send_team_message` | action (deploy, list, help) |
| 13 | `/specmem-autoclaude` | `mcp__specmem__find_memory` + Exploration | TodoWrite | task description |
| 14 | `/specmem-service` | Service mode selector | `mcp__specmem__show_me_the_stats`, HTTP API, PostgreSQL | none (interactive selection) |

---

## Detailed Command-Tool Mapping

### Memory Operations

#### 1. `/specmem-find` - Semantic Memory Search
```
Primary Tool:   mcp__specmem__find_memory
Parameters:     query, limit, threshold, memoryTypes, tags, dateRange
```
Search stored memories using semantic similarity. Core search capability for all memory-based queries.

#### 7. `/specmem-remember` - Store Memories
```
Primary Tool:   mcp__specmem__save_memory
Parameters:     content, memoryType, importance, tags
```
Persist information to SpecMem's memory system with optional metadata.

#### 2. `/specmem-stats` - Memory & Codebase Statistics
```
Primary Tool:   mcp__specmem__show_me_the_stats
Parameters:     (optional filters for memory/codebase/team-members)
```
View aggregated statistics about stored memories, indexed code, and active team members.

---

### Code Search & Analysis

#### 6. `/specmem-code` - Codebase Search
```
Primary Tool:   find_code_pointers (via mcp__specmem__find_code_pointers)
Parameters:     query, semantic, fileTypes, paths, limit
Secondary:      None
```
Search indexed codebase using semantic or text-based search.

#### 8. `/specmem-pointers` - Semantic Code Search with Tracebacks
```
Primary Tool:   mcp__specmem__find_code_pointers
Parameters:     query, limit, galleryMode, includeTracebacks
```
Find code by semantic meaning and show what files use/import it (tracebacks).

#### 4. `/specmem-changes` - File Change History
```
Primary Tool:   File change tracker (database)
Parameters:     limit, filePath, changeType
```
View recent file changes (add, modify, delete) with timestamps and content diffs.

---

### Advanced Workflows

#### 3. `/specmem-drilldown` - Interactive Memory Retrieval
```
Primary Tool:   mcp__specmem__find_memory
Secondary:      mcp__specmem__spawn_research_team_member
Modes:          start (interactive), auto (automatic)
Flow:
  1. Initial search: find_memory
  2. User controls depth and filtering
  3. Optional: spawn_research_team_member for web research
```
User-controlled drilldown for gathering curated context on complex topics.

#### 13. `/specmem-autoclaude` - Autonomous Task Execution
```
Primary Tool:   mcp__specmem__find_memory
Secondary:      TodoWrite, Glob, Grep, Read, Edit, Bash
```
Execute tasks autonomously with memory-driven context gathering and knowledge capture.

---

### Team Member Operations

#### 10. `/specmem` - Main Command Interface
```
Primary Tools:
  - mcp__specmem__send_team_message (team communication)
  - mcp__specmem__read_team_messages (listen for updates)
  - Task tool (deploy team members)
Subcommands:
  - deploy "<mission>"     (Task tool + team comms)
  - list                   (mcp__specmem__get_active_team_members)
  - memory store/search    (mcp__specmem__save_memory / mcp__specmem__find_memory)
  - codebase search        (mcp__specmem__find_code_pointers)
```
Central hub for team member deployment and memory/codebase commands.

#### 12. `/specmem-team-member` - Team Member Deployment
```
Primary Tools:
  - Task tool (deploy team members)
  - HTTP API endpoints (team member communication)
Secondary:
  - mcp__specmem__send_team_message (optional monitoring)
Communication Mode: HTTP API (curl commands in spawned team members)
```
Deploy coordinated multi-team member swarms with Overseer, Workers, and Helpers.

#### 9. `/specmem-configteammembercomms` - Team Member Communication Config
```
Tool Type:      Configuration + Interactive Selection
Methods:
  - Hook mode:      PreToolUse hook injects MCP proxy
  - HTTP mode:      Manual curl commands
  - Test both:      Validate which mode works
```
Configure how subteam members communicate with SpecMem (Hook vs HTTP).

---

### System & Configuration

#### 11. `/specmem-getdashboard` - Dashboard Information
```
Tool Type:      Configuration Reader
Sources:
  - .specmem/ports.json (port number)
  - SPECMEM_DASHBOARD_MODE env var (public/private)
Output:         Dashboard URL and access information
```
Display dashboard location, port, and access mode.

#### 14. `/specmem-service` - Service Mode Selector
```
Tool Type:      Service Mode Selector
Available Modes:
  1. Native MCP:    mcp__specmem__show_me_the_stats
  2. HTTP API:      curl to http://localhost:8595
  3. Direct DB:     PostgreSQL connection
  4. Auto-detect:   Try MCP → HTTP → DB
```
Choose between MCP, HTTP, or database access modes for SpecMem operations.

#### 5. `/specmem-hooks` - Custom Hook Management
```
Tool Type:      Hook Manager
SubCommands:
  - list           (show registered hooks)
  - add <file>     (register new hook)
  - remove <name>  (unregister hook)
  - enable/disable (toggle hook state)
  - deploy         (push hooks to Claude)
  - scan           (find new hooks)
  - example        (create template hook)
  - status         (show system status)
```
Manage custom pre/post-tool hooks and deployment to Claude.

---

## Communication Patterns

### MCP Tool Patterns

**Direct MCP Tools Used:**
- `mcp__specmem__find_memory` - All memory search operations
- `mcp__specmem__save_memory` - Store information
- `mcp__specmem__show_me_the_stats` - System statistics
- `mcp__specmem__find_code_pointers` - Code search/analysis
- `mcp__specmem__spawn_research_team_member` - Web research
- `mcp__specmem__send_team_message` - Team communication
- `mcp__specmem__read_team_messages` - Listen for team updates

**Indirect Access (via HTTP/Config):**
- Database queries (for team member sessions, memories)
- HTTP API endpoints (for subteam member communication)
- Hook system (PreToolUse/PostToolUse injection)

### Team Member Communication

**Modes:**
| Mode | Mechanism | Used In | Notes |
|------|-----------|---------|-------|
| **Native MCP** | MCP tools | Main context | Requires tool permissions |
| **HTTP API** | curl commands | Subteam members | Works everywhere, auth required |
| **Hook Mode** | PreToolUse injection | Optional enhancement | Auto-injects HTTP proxy |

---

## Command Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                    CORE MEMORY LAYER                        │
│  /specmem-find ──────> mcp__specmem__find_memory            │
│  /specmem-remember ──> mcp__specmem__save_memory            │
│  /specmem-stats ─────> mcp__specmem__show_me_the_stats      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    CODE SEARCH LAYER                        │
│  /specmem-code ──────┐                                      │
│  /specmem-pointers ──> mcp__specmem__find_code_pointers    │
│  /specmem-changes ───>                                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   ADVANCED WORKFLOWS                        │
│  /specmem-drilldown ──> find_memory + spawn_research_tm    │
│  /specmem-autoclaude ─> find_memory + TodoWrite + tools    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  TEAM MEMBER OPERATIONS                     │
│  /specmem ──────────┐                                       │
│  /specmem-tm deploy > Task tool + HTTP API + team comms    │
│  /specmem-comms ────┘                                       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  SYSTEM CONFIGURATION                       │
│  /specmem-service ───────> MCP / HTTP / DB selector        │
│  /specmem-hooks ─────────> Hook manager                     │
│  /specmem-getdashboard ──> Config reader                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Reference by Use Case

### Need to Search Memory?
→ `/specmem-find` (direct search)
→ `/specmem-drilldown` (curated, interactive)
→ `/specmem-autoclaude` (with autonomous execution)

### Need to Search Code?
→ `/specmem-code` (semantic code search)
→ `/specmem-pointers` (code + tracebacks)
→ `/specmem-changes` (see recent modifications)

### Need to Deploy Team Members?
→ `/specmem deploy` (shorthand)
→ `/specmem team member deploy` (full syntax)
→ `/specmem-team-member deploy` (direct command)

### Need System Info?
→ `/specmem-stats` (memory, code, team stats)
→ `/specmem-getdashboard` (dashboard location)
→ `/specmem-service` (service availability)

### Need to Store Knowledge?
→ `/specmem-remember` (save to memory)
→ `/specmem-hooks` (custom logic)

---

## Tool Permission Requirements

| Tool | MCP Access | HTTP Access | DB Access | Subteam Member Access |
|------|-----------|------------|----------|----------------------|
| find_memory | ✅ Yes | ✅ Yes | ✅ Yes | HTTP only |
| save_memory | ✅ Yes | ✅ Yes | ✅ Yes | HTTP only |
| show_me_the_stats | ✅ Yes | ✅ Yes | ✅ Yes | Limited |
| find_code_pointers | ✅ Yes | ✅ Yes | ✅ Yes | HTTP only |
| send_team_message | ✅ Yes | ✅ Yes | ✅ Yes (via DB) | HTTP only |
| Task tool | ✅ Yes | N/A | N/A | ✅ Yes |

---

## Update History

**Version 1.0** - January 3, 2026
- Initial mapping of all 14 commands
- Complete MCP tool cross-reference
- Communication patterns documented
- Dependency graph included
