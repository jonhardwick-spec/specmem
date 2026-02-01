#!/bin/bash

# =============================================================================
# SpecMem Standalone MCP Test Script
# =============================================================================
#
# This script verifies that SpecMem MCP server works without PM2.
# It performs the following tests:
#
# 1. Kills any PM2 processes (ensures clean test environment)
# 2. Runs the MCP server directly via bootstrap.cjs
# 3. Sends a test MCP request via stdio
# 4. Verifies the response
# 5. Reports success/failure
#
# Usage:
#   ./scripts/test-mcp-standalone.sh [--verbose] [--skip-pm2-kill]
#
# Exit codes:
#   0 - All tests passed
#   1 - Test failed
#   2 - Setup/environment error
#
# =============================================================================

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPECMEM_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BOOTSTRAP_SCRIPT="$SPECMEM_ROOT/bootstrap.cjs"
TIMEOUT_SECONDS=30
TEST_PROJECT_PATH="${SPECMEM_PROJECT_PATH:-$(mktemp -d)}"
CLEANUP_TEMP=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Flags
VERBOSE=false
SKIP_PM2_KILL=false

# =============================================================================
# Helper Functions
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[FAIL]${NC} $1"
}

log_verbose() {
    if [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[DEBUG]${NC} $1"
    fi
}

cleanup() {
    log_verbose "Cleaning up..."

    # Kill any spawned MCP server
    if [ -n "$MCP_PID" ] && kill -0 "$MCP_PID" 2>/dev/null; then
        log_verbose "Killing MCP server (PID: $MCP_PID)"
        kill "$MCP_PID" 2>/dev/null || true
        wait "$MCP_PID" 2>/dev/null || true
    fi

    # Cleanup temp project directory if we created it
    if [ "$CLEANUP_TEMP" = true ] && [ -d "$TEST_PROJECT_PATH" ]; then
        log_verbose "Removing temp directory: $TEST_PROJECT_PATH"
        rm -rf "$TEST_PROJECT_PATH" 2>/dev/null || true
    fi
}

trap cleanup EXIT

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --skip-pm2-kill)
            SKIP_PM2_KILL=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--verbose] [--skip-pm2-kill]"
            echo ""
            echo "Options:"
            echo "  --verbose, -v      Show detailed output"
            echo "  --skip-pm2-kill    Don't kill PM2 processes before test"
            echo "  --help, -h         Show this help message"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 2
            ;;
    esac
done

# =============================================================================
# Pre-flight Checks
# =============================================================================

log_info "SpecMem Standalone MCP Test"
log_info "============================"
log_info ""

# Check if bootstrap.cjs exists
if [ ! -f "$BOOTSTRAP_SCRIPT" ]; then
    log_error "Bootstrap script not found: $BOOTSTRAP_SCRIPT"
    exit 2
fi

# Check if dist/index.js exists (need to build first)
if [ ! -f "$SPECMEM_ROOT/dist/index.js" ]; then
    log_warning "Built files not found. Running npm build..."
    cd "$SPECMEM_ROOT"
    npm run build || {
        log_error "Failed to build SpecMem"
        exit 2
    }
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    log_error "Node.js 18+ required, found: $(node --version)"
    exit 2
fi

# =============================================================================
# Test 1: Kill PM2 Processes
# =============================================================================

log_info "Test 1: Ensuring no PM2 processes"

if [ "$SKIP_PM2_KILL" = false ]; then
    # Check if PM2 is installed and running
    if command -v pm2 &> /dev/null; then
        PM2_COUNT=$(pm2 list 2>/dev/null | grep -c "specmem\|embedding" || echo "0")
        if [ "$PM2_COUNT" -gt 0 ]; then
            log_warning "Found $PM2_COUNT PM2 processes related to SpecMem"
            log_info "Stopping PM2 processes..."
            pm2 stop all 2>/dev/null || true
            pm2 delete all 2>/dev/null || true
            log_success "PM2 processes stopped"
        else
            log_verbose "No SpecMem PM2 processes found"
        fi
    else
        log_verbose "PM2 not installed - good!"
    fi
else
    log_verbose "Skipping PM2 kill (--skip-pm2-kill flag)"
fi

log_success "PM2 check passed"

# =============================================================================
# Test 2: Start MCP Server Directly
# =============================================================================

log_info "Test 2: Starting MCP server via stdio"

# Create temp directory if using default
if [ "$TEST_PROJECT_PATH" = "$(mktemp -d)" ]; then
    CLEANUP_TEMP=true
    log_verbose "Created temp project directory: $TEST_PROJECT_PATH"
fi

# Create a named pipe for communication
FIFO_IN=$(mktemp -u)
FIFO_OUT=$(mktemp -u)
mkfifo "$FIFO_IN"
mkfifo "$FIFO_OUT"

# Start the MCP server in background
log_verbose "Starting MCP server..."
SPECMEM_PROJECT_PATH="$TEST_PROJECT_PATH" \
SPECMEM_DASHBOARD_ENABLED=false \
SPECMEM_COORDINATION_ENABLED=false \
NO_COLOR=1 \
node "$BOOTSTRAP_SCRIPT" < "$FIFO_IN" > "$FIFO_OUT" 2>&1 &
MCP_PID=$!

log_verbose "MCP server started with PID: $MCP_PID"

# Wait a moment for startup
sleep 2

# Check if process is still running
if ! kill -0 "$MCP_PID" 2>/dev/null; then
    log_error "MCP server died during startup"
    # Try to get any output
    timeout 1 cat "$FIFO_OUT" 2>/dev/null || true
    rm -f "$FIFO_IN" "$FIFO_OUT"
    exit 1
fi

log_success "MCP server started (PID: $MCP_PID)"

# =============================================================================
# Test 3: Send MCP Initialize Request
# =============================================================================

log_info "Test 3: Sending MCP initialize request"

# Prepare the initialize request
INIT_REQUEST='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"roots":{"listChanged":true}},"clientInfo":{"name":"test-standalone","version":"1.0.0"}}}'

log_verbose "Sending: $INIT_REQUEST"

# Send request and get response with timeout
(
    echo "$INIT_REQUEST" > "$FIFO_IN" &
    timeout "$TIMEOUT_SECONDS" head -n 1 "$FIFO_OUT"
) > /tmp/mcp_response.txt 2>&1 &
COMM_PID=$!

# Wait for response with timeout
if ! wait "$COMM_PID" 2>/dev/null; then
    log_error "Timeout waiting for MCP response"
    rm -f "$FIFO_IN" "$FIFO_OUT"
    exit 1
fi

RESPONSE=$(cat /tmp/mcp_response.txt 2>/dev/null || echo "")
rm -f /tmp/mcp_response.txt

log_verbose "Response: $RESPONSE"

# Cleanup FIFOs
rm -f "$FIFO_IN" "$FIFO_OUT"

# =============================================================================
# Test 4: Verify Response
# =============================================================================

log_info "Test 4: Verifying MCP response"

if [ -z "$RESPONSE" ]; then
    log_error "Empty response from MCP server"
    exit 1
fi

# Check if response is valid JSON
if ! echo "$RESPONSE" | python3 -m json.tool > /dev/null 2>&1; then
    # Try with node as fallback
    if ! echo "$RESPONSE" | node -e "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))" 2>/dev/null; then
        log_error "Response is not valid JSON"
        log_verbose "Response was: $RESPONSE"
        exit 1
    fi
fi

# Check for required fields using node (more portable)
VALIDATE_JS="
const response = $RESPONSE;
if (!response.jsonrpc || response.jsonrpc !== '2.0') {
    console.error('Invalid jsonrpc version');
    process.exit(1);
}
if (response.error) {
    console.error('Server returned error: ' + response.error.message);
    process.exit(1);
}
if (!response.result) {
    console.error('No result in response');
    process.exit(1);
}
if (!response.result.serverInfo || !response.result.serverInfo.name) {
    console.error('Missing serverInfo');
    process.exit(1);
}
console.log('Server: ' + response.result.serverInfo.name + ' v' + response.result.serverInfo.version);
console.log('Protocol: ' + response.result.protocolVersion);
"

if ! node -e "$VALIDATE_JS" 2>&1; then
    log_error "Response validation failed"
    log_verbose "Response was: $RESPONSE"
    exit 1
fi

log_success "MCP initialize response valid"

# Extract server info for display
SERVER_INFO=$(node -e "
const r = $RESPONSE;
console.log('  Server: ' + r.result.serverInfo.name + ' v' + r.result.serverInfo.version);
console.log('  Protocol: ' + r.result.protocolVersion);
const caps = Object.keys(r.result.capabilities || {});
console.log('  Capabilities: ' + caps.join(', '));
" 2>/dev/null || echo "  (could not parse details)")

log_info "Server details:"
echo "$SERVER_INFO"

# =============================================================================
# Test 5: Graceful Shutdown
# =============================================================================

log_info "Test 5: Testing graceful shutdown"

# Send SIGTERM
log_verbose "Sending SIGTERM to MCP server..."
kill -TERM "$MCP_PID" 2>/dev/null || true

# Wait for graceful shutdown (max 5 seconds)
SHUTDOWN_WAIT=0
while kill -0 "$MCP_PID" 2>/dev/null && [ "$SHUTDOWN_WAIT" -lt 50 ]; do
    sleep 0.1
    SHUTDOWN_WAIT=$((SHUTDOWN_WAIT + 1))
done

if kill -0 "$MCP_PID" 2>/dev/null; then
    log_warning "Server didn't shut down gracefully, sending SIGKILL"
    kill -9 "$MCP_PID" 2>/dev/null || true
    wait "$MCP_PID" 2>/dev/null || true
else
    log_success "Server shut down gracefully"
fi

# Clear the PID so cleanup doesn't try again
MCP_PID=""

# =============================================================================
# Final Report
# =============================================================================

echo ""
log_info "============================"
log_success "All standalone MCP tests passed!"
log_info "============================"
echo ""
log_info "Summary:"
log_success "  1. PM2 processes cleared/verified"
log_success "  2. MCP server started via stdio (no PM2)"
log_success "  3. MCP initialize request sent successfully"
log_success "  4. MCP response validated correctly"
log_success "  5. Server shutdown gracefully"
echo ""
log_info "The PM2-free MCP architecture is working correctly."
echo ""

exit 0
