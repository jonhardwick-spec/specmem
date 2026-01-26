# SpecMem Get Dashboard - Dashboard Location & Port Information

Shows dashboard URL, port, and access mode.

## COMMAND PARSING

```javascript
const args = "$ARGUMENTS".trim();

if (args === "help" || args === "--help" || args === "-h") {
  // Show HELP OUTPUT below
  return;
}

// If NO args or any other input → Execute GET DASHBOARD INFO
```

---

## INPUT VALIDATION

```javascript
const args = "$ARGUMENTS".trim();

if (args === "help" || args === "--help" || args === "-h") {
  // Show HELP OUTPUT below
  return;
}

// Otherwise, execute immediately (no args required)
```

---

## HELP OUTPUT

```
SpecMem Get Dashboard - Show Dashboard Location

USAGE:
  /specmem-getdashboard         Show dashboard information
  /specmem-getdashboard help    Show this help

WHAT IT SHOWS:
  - Dashboard host and port
  - Full URL to access dashboard
  - Access mode (public/private)
  - Quick links to dashboard pages

CONFIGURATION:
  Port from:     .specmem/ports.json
  Mode via:      SPECMEM_DASHBOARD_MODE env var

  Modes:
    private (default):   127.0.0.1, localhost only
    public:              0.0.0.0, network accessible

RELATED:
  /specmem-stats      View statistics
  /specmem-service    Service management

NOTE: This command does NOT use MCP tools.
      It reads configuration files using Bash.
```

---

## GET DASHBOARD INFO

Execute immediately when no args or just the command.

### Step 1: Read Configuration

Use Bash to read ports.json:

```bash
if [ -f .specmem/ports.json ]; then
  cat .specmem/ports.json
else
  echo '{"ports":{"dashboard":9294}}'
fi
```

### Step 2: Determine Values

Parse the JSON output to extract:
- **Port**: From `ports.json` → `ports.dashboard` field (default: 9294)
- **Mode**: From `$SPECMEM_DASHBOARD_MODE` env var (default: private)
- **Host**:
  - If mode is 'private': 127.0.0.1
  - If mode is 'public': 0.0.0.0

### Step 3: Output Dashboard Info

Format and display:

```
SpecMem Dashboard Information

  Host:   [host] ([mode])
  Port:   [port]
  URL:    http://[host]:[port]
  Mode:   [mode]
  Access: [Localhost only / Network accessible]

Configuration Sources:
  Port from:    .specmem/ports.json
  Mode from:    SPECMEM_DASHBOARD_MODE=[value or "default: private"]

Quick Links:
  Main Dashboard:    http://[host]:[port]/dashboard-v2.html
  Prompt Console:    http://[host]:[port]/prompt-console.html
  Data Export:       http://[host]:[port]/data-export.html
```

### Example Output (Private Mode)

```
SpecMem Dashboard Information

  Host:   127.0.0.1 (private)
  Port:   9294
  URL:    http://127.0.0.1:9294
  Mode:   private
  Access: Localhost only

Configuration Sources:
  Port from:    .specmem/ports.json
  Mode from:    SPECMEM_DASHBOARD_MODE (default: private)

Quick Links:
  Main Dashboard:    http://127.0.0.1:9294/dashboard-v2.html
  Prompt Console:    http://127.0.0.1:9294/prompt-console.html
  Data Export:       http://127.0.0.1:9294/data-export.html
```

### Example Output (Public Mode)

```
SpecMem Dashboard Information

  Host:   0.0.0.0 (public)
  Port:   9294
  URL:    http://0.0.0.0:9294
  Mode:   public
  Access: Network accessible (WARNING: Open to network!)

Configuration Sources:
  Port from:    .specmem/ports.json
  Mode from:    SPECMEM_DASHBOARD_MODE=public

Quick Links:
  Main Dashboard:    http://0.0.0.0:9294/dashboard-v2.html
  Prompt Console:    http://0.0.0.0:9294/prompt-console.html
  Data Export:       http://0.0.0.0:9294/data-export.html

WARNING: Public mode exposes dashboard to your network.
         Only use on trusted networks.
```

---

## IMPLEMENTATION APPROACH

Use Bash commands to:

1. Read `.specmem/ports.json` to get dashboard port
2. Check `$SPECMEM_DASHBOARD_MODE` environment variable
3. Format and display the output

Example implementation:

```bash
# Read port from JSON
PORT=$(cat .specmem/ports.json 2>/dev/null | grep -o '"dashboard":[0-9]*' | cut -d: -f2)
PORT=${PORT:-9294}

# Get mode from environment
MODE=${SPECMEM_DASHBOARD_MODE:-private}

# Determine host based on mode
if [ "$MODE" = "public" ]; then
  HOST="0.0.0.0"
  ACCESS="Network accessible (WARNING: Open to network!)"
  WARNING="\nWARNING: Public mode exposes dashboard to your network.\n         Only use on trusted networks."
else
  HOST="127.0.0.1"
  ACCESS="Localhost only"
  WARNING=""
fi

# Display formatted output
echo "SpecMem Dashboard Information"
echo ""
echo "  Host:   $HOST ($MODE)"
echo "  Port:   $PORT"
echo "  URL:    http://$HOST:$PORT"
echo "  Mode:   $MODE"
echo "  Access: $ACCESS"
echo ""
echo "Configuration Sources:"
echo "  Port from:    .specmem/ports.json"
if [ -n "$SPECMEM_DASHBOARD_MODE" ]; then
  echo "  Mode from:    SPECMEM_DASHBOARD_MODE=$SPECMEM_DASHBOARD_MODE"
else
  echo "  Mode from:    SPECMEM_DASHBOARD_MODE (default: private)"
fi
echo ""
echo "Quick Links:"
echo "  Main Dashboard:    http://$HOST:$PORT/dashboard-v2.html"
echo "  Prompt Console:    http://$HOST:$PORT/prompt-console.html"
echo "  Data Export:       http://$HOST:$PORT/data-export.html"
if [ -n "$WARNING" ]; then
  echo "$WARNING"
fi
```

---

## MCP TOOLS USED

**NONE** - This command uses Bash exclusively for reading configuration files.

---

## RELATED COMMANDS

- `/specmem-stats` - View system statistics including dashboard status
- `/specmem-service` - Manage SpecMem service (start/stop/restart)

---

## EXAMPLES

### Show dashboard info
```
/specmem-getdashboard
```

### Show help
```
/specmem-getdashboard help
```
