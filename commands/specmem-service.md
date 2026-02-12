# SpecMem Service - Service Mode Management

Manage SpecMem service modes, file watcher, and check connectivity.

## COMMAND PARSING

Parse what comes after `/specmem-service`:

**ARGUMENTS:** $ARGUMENTS

**DECISION LOGIC:**
1. If ARGUMENTS is empty, blank, or "help" -> Execute HELP section
2. If ARGUMENTS is "status" -> Execute STATUS section
3. If ARGUMENTS is "start" -> Execute START section
4. If ARGUMENTS is "stop" -> Execute STOP section
5. If ARGUMENTS is "restart" -> Execute RESTART section
6. If ARGUMENTS is "mcp" -> Execute MCP section
7. If ARGUMENTS is "http" -> Execute HTTP section
8. If ARGUMENTS is "db" -> Execute DB section
9. If ARGUMENTS is "watch" or "watch start" -> Execute WATCH_START section
10. If ARGUMENTS is "watch stop" -> Execute WATCH_STOP section
11. If ARGUMENTS is "watch status" -> Execute WATCH_STATUS section
12. If ARGUMENTS is "sync" or "sync check" -> Execute SYNC_CHECK section
13. If ARGUMENTS is "sync force" or "resync" -> Execute SYNC_FORCE section
14. Otherwise -> Execute HELP section (unknown command)

---

## HELP

Show this help output and STOP:

```
SpecMem Service - Mode Management

USAGE:
  /specmem-service              Show this help
  /specmem-service status       Check all service connectivity
  /specmem-service start        Start SpecMem services
  /specmem-service stop         Stop SpecMem services
  /specmem-service restart      Restart SpecMem services
  /specmem-service mcp          Test MCP tool availability
  /specmem-service http         Test HTTP API endpoint
  /specmem-service db           Test database connection

FILE WATCHER:
  /specmem-service watch        Start file watcher (auto-sync code changes)
  /specmem-service watch start  Start file watcher
  /specmem-service watch stop   Stop file watcher
  /specmem-service watch status Check watcher status

SYNC MANAGEMENT:
  /specmem-service sync         Check if files are in sync
  /specmem-service sync check   Check sync status (detailed)
  /specmem-service sync force   Force full resync
  /specmem-service resync       Force full resync (alias)

SERVICE MODES:
  MCP     Standard MCP via stdio (native Claude integration)
  HTTP    REST API at http://localhost:8595
  DB      Direct PostgreSQL connection
  WATCH   File watcher for auto-sync

PORTS:
  8595    Dashboard/HTTP API
  5432    PostgreSQL database
  3456    Embedding service

RELATED:
  /specmem-stats    View system statistics
  /specmem          Main SpecMem commands
```

---

## STATUS

Check all service connectivity:

**Step 1 - Check MCP:**
Call the MCP tool `mcp__specmem__show_me_the_stats` with empty parameters `{}`.

If the tool returns successfully -> Report: "MCP: CONNECTED"
If the tool fails or errors -> Report: "MCP: NOT AVAILABLE"

**Step 2 - Check HTTP:**
Execute this bash command:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8595/api/health 2>/dev/null || echo "000"
```

If output is "200" -> Report: "HTTP: CONNECTED (port 8595)"
Otherwise -> Report: "HTTP: NOT AVAILABLE"

**Step 3 - Check Database:**
Execute this bash command:
```bash
pg_isready -h localhost -p 5432 2>/dev/null && echo "ready" || echo "not ready"
```

If output contains "ready" (not "not ready") -> Report: "DB: CONNECTED (port 5432)"
Otherwise -> Report: "DB: NOT AVAILABLE"

**Step 4 - Check File Watcher:**
Call the MCP tool `mcp__specmem__check_sync_status` with parameters:
```json
{
  "detailed": false
}
```

If the tool returns successfully and `watcherStatus.isRunning` is true -> Report: "WATCHER: RUNNING (syncing code changes)"
If the tool returns successfully and `watcherStatus.isRunning` is false -> Report: "WATCHER: STOPPED"
Otherwise -> Report: "WATCHER: UNKNOWN"

**Step 5 - Display Summary:**
Show all status results in a formatted summary.

---

## START

Start SpecMem services.

Execute this bash command:
```bash
cd /specmem && if [ -f start-specmem.sh ]; then echo "Starting SpecMem services..." && bash start-specmem.sh; elif [ -f start-dashboard.sh ]; then echo "Starting dashboard..." && bash start-dashboard.sh; else echo "ERROR: No startup script found at /specmem"; exit 1; fi
```

Report the result to the user.

---

## STOP

Stop SpecMem services.

Execute this bash command:
```bash
cd /specmem && if [ -f stop-specmem.sh ]; then echo "Stopping SpecMem services..." && bash stop-specmem.sh; else echo "Stopping services via pkill..." && pkill -f "specmem" 2>/dev/null || true && pkill -f "node.*specmem" 2>/dev/null || true && echo "Services stopped (or were not running)"; fi
```

Report the result to the user.

---

## RESTART

Restart SpecMem services.

Execute this bash command:
```bash
cd /specmem && echo "Restarting SpecMem services..." && (if [ -f stop-specmem.sh ]; then bash stop-specmem.sh; else pkill -f "specmem" 2>/dev/null || true; fi) && sleep 2 && (if [ -f start-specmem.sh ]; then bash start-specmem.sh; elif [ -f start-dashboard.sh ]; then bash start-dashboard.sh; else echo "ERROR: No startup script found"; exit 1; fi)
```

Report the result to the user.

---

## MCP

Test MCP tool availability.

Call the MCP tool `mcp__specmem__show_me_the_stats` with parameters:
```json
{
  "includeTypeDistribution": true,
  "includeImportanceDistribution": true
}
```

Display the result showing memory counts and distributions. If the call fails, report that MCP is not available.

---

## HTTP

Test HTTP API endpoint.

Execute this bash command:
```bash
echo "=== HTTP API CHECK ===" && echo "" && echo "Endpoint: http://localhost:8595" && echo "" && echo "Health Check:" && curl -s http://localhost:8595/api/health 2>/dev/null || echo "  (not responding)" && echo "" && echo "Available Endpoints:" && echo "  GET  /api/health" && echo "  GET  /api/stats" && echo "  GET  /api/memories" && echo "  GET  /api/team-members/active" && echo "  POST /api/memories/search"
```

Report the output to the user.

---

## DB

Test database connection.

Execute this bash command:
```bash
echo "=== DATABASE CHECK ===" && echo "" && echo "Host: localhost:5432" && echo "" && pg_isready -h localhost -p 5432 2>/dev/null || echo "Database not ready" && echo "" && echo "Tables (if connected):" && PGPASSWORD="${SPECMEM_DB_PASSWORD:-${SPECMEM_PASSWORD:-specmem_westayunprofessional}}" psql -h localhost -p 5432 -U "${SPECMEM_DB_USER:-specmem_westayunprofessional}" -d "${SPECMEM_DB_NAME:-specmem_westayunprofessional}" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' LIMIT 10;" 2>/dev/null || echo "  (cannot connect)"
```

Report the output to the user.

---

## WATCH_START

Start the file watcher to auto-sync code changes to memories.

Call the MCP tool `mcp__specmem__start_watching` with parameters:
```json
{
  "syncCheckIntervalMinutes": 60
}
```

Display the result to the user:
- If successful: Show projectPath, watchedPaths, filesWatched count
- If already running: Indicate it's already running and show stats
- If error: Show error message

**Notes:**
- File watcher is PROJECT-SCOPED (only watches current project)
- `rootPath` parameter is DEPRECATED (always uses SPECMEM_PROJECT_PATH)
- Default sync check interval is 60 minutes (1 hour)
- Keeps MCP memories in sync with filesystem automatically

---

## WATCH_STOP

Stop the file watcher.

Call the MCP tool `mcp__specmem__stop_watching` with parameters:
```json
{
  "flushPending": true
}
```

Display the result to the user:
- If successful: Show eventsProcessed and pendingFlushed counts
- If not running: Indicate watcher wasn't running
- If error: Show error message

**Notes:**
- `flushPending: true` processes all pending changes before stopping
- `flushPending: false` stops immediately without processing queue

---

## WATCH_STATUS

Check file watcher status.

Call the MCP tool `mcp__specmem__check_sync_status` with parameters:
```json
{
  "detailed": false
}
```

Display the result to the user:
- Watcher status: isRunning, eventsProcessed, queueSize
- Sync status: inSync, syncScore, driftPercentage
- Summary message
- Stats: totalFiles, totalMemories, upToDate, missingFromMcp, missingFromDisk, contentMismatch

If watcher is not running, suggest starting it with `/specmem-service watch start`.

---

## SYNC_CHECK

Check if MCP memories are in sync with filesystem.

Call the MCP tool `mcp__specmem__check_sync_status` with parameters:
```json
{
  "detailed": true
}
```

Display the result to the user:
- Sync status: inSync (true/false)
- Sync score: percentage (0-100%)
- Drift percentage: how much drift detected
- Summary message
- Statistics: totalFiles, totalMemories, upToDate, missingFromMcp, missingFromDisk, contentMismatch
- Detailed lists (because detailed: true):
  - Files missing from MCP
  - Files deleted from disk
  - Files with content mismatch

If drift is detected, suggest running `/specmem-service sync force` to resync.

**Notes:**
- This is a read-only check (doesn't modify anything)
- Shows what's out of sync between filesystem and memories
- Use this before force_resync to see what will be changed

---

## SYNC_FORCE

Force a full resync of the entire codebase.

**Step 1 - Dry Run Preview:**
Call the MCP tool `mcp__specmem__force_resync` with parameters:
```json
{
  "dryRun": true
}
```

Display the preview to the user:
- Files that would be added
- Files that would be updated
- Files that would be marked deleted

**Step 2 - Ask for Confirmation:**
Ask the user: "Do you want to proceed with the resync? This will update all MCP memories to match the current filesystem. (yes/no)"

Wait for user response.

**Step 3 - Execute Resync (if confirmed):**
If user confirms (yes/y/proceed/go/confirm):
  Call the MCP tool `mcp__specmem__force_resync` with parameters:
  ```json
  {
    "dryRun": false
  }
  ```

  Display the result:
  - Success/failure status
  - Files added
  - Files updated
  - Files marked deleted
  - Duration (milliseconds)
  - Any errors encountered

If user declines:
  Report: "Resync cancelled by user."

**Notes:**
- Always shows preview first (dry run)
- Requires explicit user confirmation
- Scans entire codebase and updates all memories
- Use after: git checkout, git pull, mass file operations
- Can take several seconds to minutes on large codebases

---
