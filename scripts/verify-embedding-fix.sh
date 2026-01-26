#!/bin/bash
# SpecMem Embedding Fix Verification Script
# Run after applying fixes and reinstalling

set -e
PASS=0
FAIL=0
WARN=0

check() {
  local desc="$1"
  local result="$2"
  if [ "$result" = "0" ]; then
    echo "  ✓ PASS: $desc"
    ((PASS++))
  else
    echo "  ✗ FAIL: $desc"
    ((FAIL++))
  fi
}

warn() {
  echo "  ⚠ WARN: $1"
  ((WARN++))
}

echo "========================================"
echo "SpecMem Embedding Fix Verification"
echo "========================================"
echo ""

# 1. Check version
echo "--- Version Check ---"
INSTALLED_VER=$(specmem --version 2>/dev/null || echo "NOT INSTALLED")
echo "  Installed version: $INSTALLED_VER"
echo "$INSTALLED_VER" | grep -q "3.5.96"
check "Version is 3.5.96" "$?"

# 2. Check process count
echo ""
echo "--- Process Check ---"
PROC_COUNT=$(ps aux | grep "frankenstein-embeddings.py" | grep -v grep | wc -l)
echo "  Embedding processes running: $PROC_COUNT"
[ "$PROC_COUNT" -le 1 ]
check "At most 1 embedding process running" "$?"

# 3. Check for stale lock files
echo ""
echo "--- Lock File Check ---"
if [ -f "/specmem/sockets/embedding.starting" ]; then
  warn "Stale embedding.starting lock file exists"
else
  check "No stale embedding.starting lock" "0"
fi

if [ -f "/specmem/sockets/bootstrap.lock" ]; then
  # Check if PID is alive
  LOCK_PID=$(head -1 /specmem/sockets/bootstrap.lock 2>/dev/null)
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    check "Bootstrap lock PID $LOCK_PID is alive" "0"
  else
    warn "Bootstrap lock references dead PID $LOCK_PID"
  fi
else
  check "No bootstrap lock (OK if not started yet)" "0"
fi

# 4. Check socket file
echo ""
echo "--- Socket Check ---"
SOCK_PATHS=(
  "/specmem/sockets/embeddings.sock"
)
for sock in "${SOCK_PATHS[@]}"; do
  if [ -S "$sock" ]; then
    check "Socket exists: $sock" "0"
  else
    echo "  Socket not found: $sock (will be created on first use)"
  fi
done

# 5. Check embeddingServerManager.js has fixes
echo ""
echo "--- Code Fix Verification ---"
ESM="/specmem/dist/mcp/embeddingServerManager.js"
if [ -f "$ESM" ]; then
  grep -q "findRunningEmbeddingServers" "$ESM"
  check "embeddingServerManager has findRunningEmbeddingServers method" "$?"

  grep -q "process.kill.*0" "$ESM"
  check "embeddingServerManager has process liveness check" "$?"

  grep -q "getProcessResources\|checkResourceLimits" "$ESM"
  check "embeddingServerManager has resource monitoring" "$?"
else
  check "embeddingServerManager.js exists" "1"
fi

# 6. Check bootstrap.cjs has lock
echo ""
BSC="/specmem/bootstrap.cjs"
if [ -f "$BSC" ]; then
  grep -q "checkBootstrapLock\|bootstrap.lock\|Bootstrap already running" "$BSC"
  check "bootstrap.cjs has deduplication lock" "$?"
else
  check "bootstrap.cjs exists" "1"
fi

# 7. Check timeout configs
echo ""
echo "--- Timeout Config ---"
TIMEOUT_FILE=$(find /specmem -name "embedding-timeouts.json" 2>/dev/null | head -1)
if [ -n "$TIMEOUT_FILE" ]; then
  SUB_TIMEOUT=$(grep -o '"subsequentTimeout":\s*[0-9]*' "$TIMEOUT_FILE" | grep -o '[0-9]*')
  echo "  subsequentTimeout: ${SUB_TIMEOUT}ms"
  [ "$SUB_TIMEOUT" -le 15000 ] 2>/dev/null
  check "subsequentTimeout <= 15000ms" "$?"
else
  warn "No embedding-timeouts.json found"
fi

# 8. Check cleanup script exists
echo ""
echo "--- Utilities ---"
[ -x "/specmem/scripts/cleanup-embedding-servers.sh" ]
check "Cleanup script exists and is executable" "$?"

# 9. Node syntax verification
echo ""
echo "--- Syntax Check ---"
node -c "$ESM" 2>/dev/null
check "embeddingServerManager.js syntax valid" "$?"
node -c "$BSC" 2>/dev/null
check "bootstrap.cjs syntax valid" "$?"

# Summary
echo ""
echo "========================================"
echo "RESULTS: $PASS passed, $FAIL failed, $WARN warnings"
echo "========================================"

if [ "$FAIL" -gt 0 ]; then
  echo "SOME CHECKS FAILED - Review output above"
  exit 1
else
  echo "ALL CHECKS PASSED"
  exit 0
fi
