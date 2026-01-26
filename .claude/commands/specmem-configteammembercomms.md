# SpecMem Team Member Communication Configuration

Check and configure team member communication settings.

## COMMAND PARSING

```javascript
const args = "$ARGUMENTS".trim();

if (!args || args === "help" || args === "--help" || args === "-h") {
  // Show HELP OUTPUT below
  return;
}

if (args === "test") {
  // Execute TEST action
  return;
}

if (args === "status") {
  // Execute STATUS action
  return;
}

// Unknown command
console.log("Unknown command. Use /specmem-configteammembercomms help for usage.");
```

---

## INPUT VALIDATION

```javascript
const args = "$ARGUMENTS".trim();

// Valid commands:
// - /specmem-configteammembercomms          (show help)
// - /specmem-configteammembercomms help     (show help)
// - /specmem-configteammembercomms test     (test communication)
// - /specmem-configteammembercomms status   (show status)
```

---

## HELP OUTPUT

Show this when NO args provided or "help":

```
SpecMem Team Member Communication Configuration

COMMANDS:

  /specmem-configteammembercomms test
    Test team communication by sending and reading a message

  /specmem-configteammembercomms status
    Show current team status and storage backend

WHAT THIS CONFIGURES:

  Team members communicate via SpecMem's MCP tools:
  - send_team_message: Send messages to team
  - read_team_messages: Read team activity
  - claim_task: Claim files/tasks to avoid conflicts
  - release_task: Release claims when done
  - get_team_status: See who's working on what
  - broadcast_to_team: Broadcast to all team members
  - request_help: Ask team for help
  - respond_to_help: Answer help requests

HOW IT WORKS:

  All team communication goes through PostgreSQL database.
  MCP tools handle serialization and message routing.
  No HTTP endpoints needed - direct MCP tool calls.

  Database tables:
  - team_channels: Project-isolated channels
  - team_messages: Messages with threading
  - task_claims: File/task claims
  - help_requests: Open help requests

  Each project gets its own isolated schema for team data.

TROUBLESHOOTING:

  If communication fails:
  1. Check SpecMem service is running
  2. Verify PostgreSQL connection
  3. Reload Claude session to refresh MCP

RELATED COMMANDS:

  /specmem-team-member status    - View team status
  /specmem-team-member messages  - Read team messages
  /specmem-team-member claim     - Claim a task

MCP TOOLS USED:
  - mcp__specmem__send_team_message
  - mcp__specmem__read_team_messages
  - mcp__specmem__get_team_status
```

---

## EXECUTION

### TEST Action (`/specmem-configteammembercomms test`)

Test that team communication is working by:

#### Step 1: Send a test message

```javascript
mcp__specmem__send_team_message({
  message: "[CONFIG TEST] Team member communication test at " + new Date().toISOString(),
  type: "status"
})
```

#### Step 2: Read recent messages to verify

```javascript
mcp__specmem__read_team_messages({
  limit: 5
})
```

#### Step 3: Show result

Check if the test message appears in the results:

**SUCCESS:**
```
TEAM COMMUNICATION TEST

✅ Send Message: OK
✅ Read Messages: OK
✅ Test message found in results

Status: WORKING

Team communication is functioning correctly.
Database: PostgreSQL
Storage: Project-isolated schema
```

**FAILURE:**
```
TEAM COMMUNICATION TEST

❌ Send Message: OK
❌ Read Messages: OK (but test message not found)

Status: NOT WORKING

Possible issues:
- Database connection problem
- Table permissions issue
- Schema isolation misconfigured

Try:
1. Check SpecMem service is running
2. Verify PostgreSQL connection
3. Check logs: tail -f ~/.specmem/logs/mcp-server.log
4. Reload Claude session
```

---

### STATUS Action (`/specmem-configteammembercomms status`)

Get current team status:

```javascript
mcp__specmem__get_team_status({})
```

#### Display the result:

```
TEAM COMMUNICATION STATUS

Active Claims: <count>
<list of active claims if any>

Recent Activity: <count> messages in last hour

Open Help Requests: <count>
<list of help requests if any>

Storage Backend: PostgreSQL
Schema: <project schema name>
Tables: team_channels, team_messages, task_claims, help_requests

Team communication is active and operational.
```

If no activity:
```
TEAM COMMUNICATION STATUS

Active Claims: 0
Recent Activity: 0 messages

Open Help Requests: 0

Storage Backend: PostgreSQL
Schema: <project schema name>

No active team members detected.

Deploy a team with:
  /specmem-webdev <task>
  /specmem-agents deploy <type> <task>
```

---

## MCP TOOL SCHEMAS

### mcp__specmem__send_team_message
- `message`: string (required) - Message content
- `type`: "status" | "question" | "update" | "broadcast" | "help_request" | "help_response"
- `priority`: "low" | "normal" | "high" | "urgent"

### mcp__specmem__read_team_messages
- `limit`: number (default: 10, max: 100)
- `unread_only`: boolean
- `mentions_only`: boolean
- `since`: string (ISO 8601 timestamp)

### mcp__specmem__get_team_status
No parameters required.

Returns:
- `activeClaims`: array of TaskClaim objects
- `recentActivity`: number - Message count in last hour
- `openHelpRequests`: array of HelpRequest objects

---

## MCP TOOLS USED

- `mcp__specmem__send_team_message` - Send test message
- `mcp__specmem__read_team_messages` - Read messages to verify
- `mcp__specmem__get_team_status` - Get team status overview

---

## DATABASE SCHEMA INFO

Team communication uses these PostgreSQL tables:

### team_channels
- Per-project channels for team communication
- Each project gets isolated channels based on project path

### team_messages
- Messages with threading support
- Supports @mentions and read receipts
- Message types: status, question, update, broadcast, help_request, help_response

### task_claims
- Active file/task claims to prevent conflicts
- Each claim has description, files, claimed_by, status

### help_requests
- Open help requests from team members
- Status: open, answered
- Linked to channels

All tables include `project_path` for per-project isolation.

---

## EXAMPLES

### Test team communication
```
/specmem-configteammembercomms test
```

Output:
```
TEAM COMMUNICATION TEST

✅ Send Message: OK
✅ Read Messages: OK
✅ Test message found in results

Status: WORKING
```

### Check team status
```
/specmem-configteammembercomms status
```

Output:
```
TEAM COMMUNICATION STATUS

Active Claims: 2
  - design-agent: tailwind.config.ts, src/index.css
  - component-agent: src/components/Button.tsx

Recent Activity: 15 messages in last hour

Open Help Requests: 0

Storage Backend: PostgreSQL
Schema: project_specmem

Team communication is active and operational.
```

### Show help
```
/specmem-configteammembercomms help
```
