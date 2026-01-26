# SpecMem Team Member - Team Coordination Tools

## REQUIRED: Check Arguments First

**IF no arguments provided OR args is empty/whitespace/help/-h/--help:**

OUTPUT THIS HELP AND STOP:

```
SpecMem Team Member - Team Coordination

USAGE:
  /specmem-team-member <subcommand> [args]

SUBCOMMANDS:

  status              Show team status, active claims, help requests
  messages            Read recent team messages (last 10)
  send <message>      Send a message to the team
  claim <description> Claim a task to prevent conflicts
  release [claimId]   Release task claims (default: all)
  broadcast <message> Broadcast status update to all members
  help-request <text> Request help from the team
  help-respond <id> <response> Respond to a help request
  clear               Clear team messages (requires confirmation)

EXAMPLES:

  /specmem-team-member status
  /specmem-team-member messages
  /specmem-team-member send Working on auth module
  /specmem-team-member claim Implementing user login
  /specmem-team-member release
  /specmem-team-member broadcast API endpoints ready
  /specmem-team-member help-request How does token refresh work?
  /specmem-team-member help-respond abc-123 Try using JWT refresh tokens
  /specmem-team-member clear

MCP TOOLS:
  send_team_message, read_team_messages, broadcast_to_team,
  claim_task, release_task, get_team_status,
  request_help, respond_to_help, clear_team_messages
```

**DO NOT PROCEED WITHOUT A SUBCOMMAND.**

---

## Has Subcommand - Parse and Execute

Parse the first word as the subcommand, rest as arguments.

---

### SUBCOMMAND: status

**VALIDATION:**
- No arguments required

**CALL THIS MCP TOOL NOW** (do not just display it, actually invoke it):

Use `mcp__specmem__get_team_status` with parameters:
```json
{}
```

**Display results showing:**
- Active task claims (who is working on what)
- Recent team activity (messages, claims)
- Open help requests count

---

### SUBCOMMAND: messages (or read)

**VALIDATION:**
- No arguments required (uses defaults)

**CALL THIS MCP TOOL NOW** (do not just display it, actually invoke it):

Use `mcp__specmem__read_team_messages` with parameters:
```json
{
  "limit": 10,
  "compress": true,
  "include_broadcasts": true
}
```

**Display:** Recent team messages with sender, content, timestamp, and unread status.

**NOTE:**
- Use `mentions_only: true` to filter for @mentions
- Use `unread_only: true` to show only unread messages
- Use `since: "2025-01-21T10:00:00Z"` to filter by time

---

### SUBCOMMAND: send <message>

Extract everything after "send" as the message content.

**VALIDATION:**
- **IF no message text provided:** Output "Error: No message provided. Usage: /specmem-team-member send <message>" and STOP.
- Message must not be empty or only whitespace

**CALL THIS MCP TOOL NOW** (do not just display it, actually invoke it):

Use `mcp__specmem__send_team_message` with parameters:
```json
{
  "message": "<extracted message text>",
  "type": "update",
  "priority": "normal"
}
```

**VALID VALUES:**
- `type`: "status" | "question" | "update" | "broadcast" | "help_request" | "help_response"
- `priority`: "low" | "normal" | "high" | "urgent"
- `task_id`: (optional) string - send to task-specific channel
- `project_id`: (optional) string - send to project-specific channel
- `thread_id`: (optional) string - reply to a thread
- `sender_name`: (optional) string - display name for sender

**Display:** Confirmation that message was sent, including messageId and mentions found.

**SUPPORTS @MENTIONS:** Use @member-id in the message to notify specific team members.

---

### SUBCOMMAND: claim <description>

Extract everything after "claim" as the task description.

**VALIDATION:**
- **IF no description provided:** Output "Error: No task description. Usage: /specmem-team-member claim <description>" and STOP.
- Description must not be empty or only whitespace

**CALL THIS MCP TOOL NOW** (do not just display it, actually invoke it):

Use `mcp__specmem__claim_task` with parameters:
```json
{
  "description": "<extracted description>",
  "files": []
}
```

**VALID VALUES:**
- `description`: string (required) - what you're working on
- `files`: string[] (optional) - array of file paths you'll be working on

**Display:**
- Claim ID (for use with release)
- Confirmation message
- Any warnings about conflicting file claims

**NOTE:** If files are already claimed by another member, you'll get a warning but the claim will still succeed.

---

### SUBCOMMAND: release [claimId]

Extract claimId after "release" if provided, otherwise use "all".

**VALIDATION:**
- If claimId provided, it must be a valid UUID or "all"
- Default to "all" if no claimId specified

**CALL THIS MCP TOOL NOW** (do not just display it, actually invoke it):

Use `mcp__specmem__release_task` with parameters:
```json
{
  "claimId": "<claimId or 'all'>"
}
```

**VALID VALUES:**
- `claimId`: string (required) - specific claim UUID or "all" to release all your claims

**Display:**
- Confirmation showing number of claims released
- List of released claim IDs

---

### SUBCOMMAND: broadcast <message>

Extract everything after "broadcast" as the message content.

**VALIDATION:**
- **IF no message text provided:** Output "Error: No message provided. Usage: /specmem-team-member broadcast <message>" and STOP.
- Message must not be empty or only whitespace

**CALL THIS MCP TOOL NOW** (do not just display it, actually invoke it):

Use `mcp__specmem__broadcast_to_team` with parameters:
```json
{
  "message": "<extracted message text>",
  "broadcast_type": "status",
  "priority": "normal",
  "cross_project": false
}
```

**VALID VALUES:**
- `message`: string (required) - the broadcast message
- `broadcast_type`: "status" | "progress" | "announcement" (default: "status")
- `priority`: "low" | "normal" | "high" | "urgent" (default: "normal")
- `metadata`: object (optional) - e.g., { progress: 75 }
- `cross_project`: boolean (default: false) - if true, broadcast to ALL projects (use sparingly!)

**Display:** Confirmation that broadcast was sent with messageId.

**NOTE:** By default, broadcasts only reach team members in the SAME PROJECT. Use cross_project: true for system-wide announcements.

---

### SUBCOMMAND: help-request <question>

Extract everything after "help-request" as the question.

**VALIDATION:**
- **IF no question provided:** Output "Error: No question provided. Usage: /specmem-team-member help-request <question>" and STOP.
- Question must not be empty or only whitespace

**CALL THIS MCP TOOL NOW** (do not just display it, actually invoke it):

Use `mcp__specmem__request_help` with parameters:
```json
{
  "question": "<extracted question>",
  "context": null,
  "skills_needed": []
}
```

**VALID VALUES:**
- `question`: string (required) - the question or issue you need help with
- `context`: string (optional) - additional context about the problem
- `skills_needed`: string[] (optional) - e.g., ["database", "typescript"]

**Display:**
- Help request ID (save this for tracking responses!)
- Confirmation that broadcast was sent to team
- Reminder to check messages for responses

---

### SUBCOMMAND: help-respond <requestId> <response>

Parse arguments: first word is requestId, rest is response text.

**VALIDATION:**
- **IF no requestId provided:** Output "Error: Missing request ID. Usage: /specmem-team-member help-respond <requestId> <response>" and STOP.
- **IF no response text provided:** Output "Error: No response provided. Usage: /specmem-team-member help-respond <requestId> <response>" and STOP.
- requestId must be a valid UUID format
- Response must not be empty or only whitespace

**CALL THIS MCP TOOL NOW** (do not just display it, actually invoke it):

Use `mcp__specmem__respond_to_help` with parameters:
```json
{
  "requestId": "<extracted requestId>",
  "response": "<extracted response text>"
}
```

**VALID VALUES:**
- `requestId`: string (required) - the ID of the help request
- `response`: string (required) - your answer or guidance

**Display:**
- Confirmation that response was sent
- Who the response was sent to (the original requester)
- Response ID for tracking

---

### SUBCOMMAND: clear

**VALIDATION:**
- Requires explicit confirmation for safety

**ASK USER FOR CONFIRMATION:**

Output this prompt:
```
⚠️  WARNING: This will delete team communication data!

This will clear:
- All team messages in this project
- All task claims in this project
- All help requests in this project

Confirm deletion? Type 'yes' to proceed.
```

**IF user confirms with "yes":**

**CALL THIS MCP TOOL NOW** (do not just display it, actually invoke it):

Use `mcp__specmem__clear_team_messages` with parameters:
```json
{
  "confirm": true,
  "clear_claims": true,
  "clear_help_requests": true
}
```

**VALID VALUES:**
- `confirm`: boolean (required) - must be true to actually delete
- `older_than_minutes`: number (optional) - only delete older than N minutes
- `clear_claims`: boolean (default: true) - also clear task claims
- `clear_help_requests`: boolean (default: true) - also clear help requests

**IF user does NOT confirm:**

Output: "Clear cancelled. No data was deleted."

**Display:**
- Number of messages deleted
- Number of claims cleared
- Number of help requests cleared

**USE CASE:** Call this BEFORE spawning new team members to ensure they start fresh without old context.

---

### UNKNOWN SUBCOMMAND

If subcommand is not recognized, output:

```
Error: Unknown subcommand '<subcommand>'

Valid subcommands:
  - status
  - messages (or read)
  - send
  - claim
  - release
  - broadcast
  - help-request
  - help-respond
  - clear

Run /specmem-team-member help for usage.
```

---

## TOOL PARAMETER VALIDATION

**Always validate tool parameters BEFORE calling MCP tools:**

1. **String parameters**: Must not be empty/null/undefined after trimming
2. **Enum parameters**: Must match exact values from schema
3. **Array parameters**: Can be empty array `[]` but must be valid JSON array
4. **Boolean parameters**: Must be true/false, not string "true"/"false"
5. **UUID parameters**: Should match UUID format (8-4-4-4-12 hex pattern)

**If validation fails**:
- Output clear error message explaining what's wrong
- Show correct usage example
- DO NOT call the MCP tool

---

## BEST PRACTICES

**Workflow:**
1. Start work: `claim` → prevents conflicts
2. Update team: `send` → share progress
3. Need help: `help-request` → broadcast to team
4. Help others: `help-respond` → answer questions
5. Finish work: `release` → free up files
6. Check status: `status` + `messages` → stay coordinated

**Token Efficiency:**
- `read_team_messages` uses Chinese compression by default (compress: true)
- `get_team_status` returns ultra-compact summaries
- Use `limit` parameter to control message count

**Project Isolation:**
- All tools are automatically scoped to current project
- Use `cross_project: true` in broadcast for system-wide announcements
- Messages from other projects are NOT visible (except global broadcasts)

---

## ERROR HANDLING

**Common Errors:**

1. **"Claim not found"** → Invalid claimId in release command
2. **"Help request not found"** → Invalid requestId in help-respond
3. **"Message content cannot be empty"** → Empty message in send/broadcast
4. **"Cannot release claim owned by another member"** → Trying to release someone else's claim

**Always:**
- Show the error message to the user
- Explain what went wrong
- Provide the correct usage example
