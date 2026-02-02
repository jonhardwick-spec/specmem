# SpecMem·儀表盤 - 儀表盤位置 & 埠資訊

示s·儀表盤·URL, 埠, 准入調①.

## 令④ 析ing

```javascript
const args = "$ARGUMENTS".trim();

if (args === "help" || args === "--help" || args === "-h") {
  // Show HELP OUTPUT below
  return;
}

// If NO args or any other input → Execute GET DASHBOARD INFO
```

---

## 輸入·VALIDATION

```javascript
const args = "$ARGUMENTS".trim();

if (args === "help" || args === "--help" || args === "-h") {
  // Show HELP OUTPUT below
  return;
}

// Otherwise, execute immediately (no args required)
```

---

## 佽輸出·```
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

## 儀表盤·INFO·執旋·args·令④.

### 步 1: 讀① 配置

用·Bash·讀① 埠s.json:

```bash
if [ -f .specmem/ports.json ]; then
  cat .specmem/ports.json
else
  echo '{"ports":{"dashboard":9294}}'
fi
```

### 步 2: 決價值標準

析·JSON·輸出撮:
- **埠**: `ports.json` → `ports.dashboard`·欄位 (默認: 9294)
- **調①**: `$SPECMEM_DASHBOARD_MODE` env·宣 (默認: 私)
- **主機**:
- 調① '私': 127.0.0.1
- 調① '公': 0.0.0.0

### 步 3: 輸出儀表盤·Info·格式顯:

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

### 輸出 (私調①)

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

### 輸出 (公調①)

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

## IMPLEMENTATION·侵

用·Bash·令④s:

1. 讀① `.specmem/ports.json`·儀表盤埠
2. 查·`$SPECMEM_DASHBOARD_MODE`·環境變
3. 格式顯 輸出·implementation:

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

## MCP·具⑤s·中古①

**無** - 令④ 用s Bash exclusively·讀數配置案卷①.

---

## 親① 令④s

- `/specmem-stats` - 瞻系統統計連② 儀表盤狀態
- `/specmem-service` - 司·SpecMem·務 (啟①/stop/restart)

---

##

### 示儀表盤·info
```
/specmem-getdashboard
```

### 示佽·```
/specmem-getdashboard help
```