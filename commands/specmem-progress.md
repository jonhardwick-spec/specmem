# SpecMem Progress - Watch Team Member Progress

Watch team member progress in real-time using SpecMem team communication.

## COMMAND PARSING

```javascript
const args = "$ARGUMENTS".trim();

if (!args || args === "help" || args === "--help" || args === "-h") {
  // Show recent team messages (default 10)
  // Execute DEFAULT action
  return;
}

if (args === "--live" || args === "live") {
  // Execute LIVE mode
  return;
}

if (args.startsWith("--count ")) {
  const countMatch = args.match(/--count\s+(\d+)/);
  if (!countMatch) {
    console.log("ERROR: --count requires a number");
    console.log("Example: /specmem-progress --count 20");
    return;
  }
  const count = parseInt(countMatch[1], 10);
  // Execute with custom count
  return;
}

// Unknown argument - show help
console.log("Unknown argument. Use /specmem-progress help for usage.");
```

---

## INPUT VALIDATION

```javascript
const args = "$ARGUMENTS".trim();

// Valid commands:
// - /specmem-progress              (show last 10)
// - /specmem-progress --count 20   (show last 20)
// - /specmem-progress --live       (live polling)
// - /specmem-progress help         (show help)
```

---

## HELP OUTPUT

```
SpecMem Progress - Watch Team Activity

USAGE:
  /specmem-progress              Show last 10 team messages
  /specmem-progress --count 20   Show last 20 messages
  /specmem-progress --live       Live polling mode (updates every 5s)
  /specmem-progress help         Show this help

WHAT YOU'LL SEE:
  - Team member status updates
  - Task claims and completions
  - Help requests and responses
  - Broadcast messages

This shows real progress from agents using MCP team communication!

MCP TOOL USED:
  mcp__specmem__read_team_messages

RELATED:
  /specmem-team-member status    Full team status
  /specmem-team-member messages  Read messages with filters
```

---

## EXECUTION

### DEFAULT MODE (no args or "help")

Execute this MCP tool:

```javascript
mcp__specmem__read_team_messages({
  limit: 10,
  compress: false
})
```

### WITH --count

Execute this MCP tool with custom limit:

```javascript
mcp__specmem__read_team_messages({
  limit: COUNT,
  compress: false
})
```

### LIVE MODE (--live)

Poll `mcp__specmem__read_team_messages` every 5 seconds.

Only show NEW messages since last poll by using the `since` parameter:

```javascript
// First call - show last 10
let lastTimestamp = null;

while (true) {
  const result = mcp__specmem__read_team_messages({
    limit: 10,
    since: lastTimestamp,
    compress: false
  });

  if (result.messages && result.messages.length > 0) {
    // Display new messages
    displayMessages(result.messages);

    // Update last timestamp
    lastTimestamp = result.messages[0].timestamp;
  }

  // Wait 5 seconds
  await sleep(5000);
}
```

**NOTE**: Live mode should display "Press Ctrl+C to stop" and update in place.

---

## DISPLAY FORMAT

Show messages in a clean progress format:

```
╔══════════════════════════════════════════════════════════════╗
║  📊 TEAM PROGRESS                                            ║
╠══════════════════════════════════════════════════════════════╣
║  [12:34:05] Agent-1: Starting authentication module...       ║
║  [12:34:12] Agent-2: Claimed files: src/auth/*               ║
║  [12:34:25] Agent-1: ✅ Completed login form                 ║
║  [12:34:30] Agent-3: 🔄 Working on API endpoints...          ║
╚══════════════════════════════════════════════════════════════╝

Showing 4 messages. Use --count to see more.
```

For each message, display:
- **Timestamp**: [HH:MM:SS] format
- **Sender**: Abbreviated sender name or ID
- **Content**: Message content (truncate if > 60 chars)
- **Icon**: Based on message type
  - 🔄 - status updates
  - ✅ - completions
  - ❓ - questions
  - 🆘 - help requests
  - 📢 - broadcasts

---

## MCP TOOL SCHEMA

Tool: `mcp__specmem__read_team_messages`

Optional parameters:
- `limit`: number (default: 10, max: 100) - Max messages to return
- `since`: string (ISO 8601) - Only messages after this timestamp
- `unread_only`: boolean (default: false) - Only unread messages
- `mentions_only`: boolean (default: false) - Only messages mentioning you
- `include_broadcasts`: boolean (default: true) - Include broadcast messages
- `compress`: boolean (default: true) - Enable Chinese compression

Returns:
- `messages`: array of TeamMessage objects
  - `id`: string - Message ID
  - `sender`: string - Sender ID
  - `sender_name`: string - Sender display name
  - `content`: string - Message content
  - `type`: string - Message type
  - `priority`: string - Message priority
  - `timestamp`: string - ISO 8601 timestamp
  - `mentions`: string[] - Mentioned member IDs
  - `read_by`: string[] - Members who read this

---

## OUTPUT EXAMPLES

### Default (last 10 messages)

```
╔══════════════════════════════════════════════════════════════╗
║  📊 TEAM PROGRESS                                            ║
╠══════════════════════════════════════════════════════════════╣
║  [14:23:45] design-agent: 🔄 Setting up design tokens        ║
║  [14:24:12] component-agent: 🔄 Creating Button component    ║
║  [14:24:30] design-agent: ✅ Design system complete          ║
║  [14:25:01] component-agent: ✅ Button component ready       ║
║  [14:25:15] integration-agent: 🔄 Integrating components     ║
╚══════════════════════════════════════════════════════════════╝

Showing 5 messages. Use --count to see more.
```

### With --count 20

```
╔══════════════════════════════════════════════════════════════╗
║  📊 TEAM PROGRESS (Last 20)                                  ║
╠══════════════════════════════════════════════════════════════╣
║  [13:00:00] coordinator: 📢 Starting webdev team deployment  ║
║  [13:00:15] design-agent: 🔄 Claimed tailwind.config.ts      ║
║  ...                                                          ║
║  [14:25:15] integration-agent: 🔄 Integrating components     ║
╚══════════════════════════════════════════════════════════════╝

Showing 20 messages.
```

### Live mode

```
╔══════════════════════════════════════════════════════════════╗
║  📊 TEAM PROGRESS (LIVE)                                     ║
║  Press Ctrl+C to stop                                        ║
╠══════════════════════════════════════════════════════════════╣
║  [14:25:15] integration-agent: 🔄 Integrating components     ║
║  [14:25:30] quality-agent: 🔄 Starting review...             ║
║  [14:26:00] quality-agent: ✅ Quality check passed!          ║
╚══════════════════════════════════════════════════════════════╝

Last update: 14:26:00
```

### No messages

```
╔══════════════════════════════════════════════════════════════╗
║  📊 TEAM PROGRESS                                            ║
╠══════════════════════════════════════════════════════════════╣
║  No team messages found.                                     ║
║                                                               ║
║  Try:                                                         ║
║  - Deploy a team: /specmem-webdev <task>                     ║
║  - Check status: /specmem-team-member status                 ║
╚══════════════════════════════════════════════════════════════╝
```

---

## MCP TOOLS USED

- `mcp__specmem__read_team_messages` - Read team communication messages

---

## EXAMPLES

### Show last 10 messages
```
/specmem-progress
```

### Show last 20 messages
```
/specmem-progress --count 20
```

### Live polling mode
```
/specmem-progress --live
```
(Press Ctrl+C to stop)

### Show help
```
/specmem-progress help
```
