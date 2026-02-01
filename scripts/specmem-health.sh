#!/bin/bash
# ============================================================================
# SpecMem Health Check Script (Standalone - No PM2)
# ============================================================================
# Quick diagnostic tool to verify SpecMem is properly configured and running.
# Checks all essential components without assuming any process manager.
#
# Usage:
#   ./scripts/specmem-health.sh
#   ./scripts/specmem-health.sh --json
#
# Exit codes:
#   0 - All critical checks pass
#   1 - One or more critical checks failed
# ============================================================================

set -o pipefail

SPECMEM_DIR="${SPECMEM_ROOT:-/specmem}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source project environment if available
if [ -f "$SCRIPT_DIR/project-env.sh" ]; then
    source "$SCRIPT_DIR/project-env.sh"
fi

# Load specmem.env for database config
if [ -f "$SPECMEM_DIR/specmem.env" ]; then
    source "$SPECMEM_DIR/specmem.env"
fi

# Compute project hash if not set (for project-isolated paths)
if [ -z "$SPECMEM_PROJECT_HASH" ]; then
    _project_path="${SPECMEM_PROJECT_PATH:-$(pwd)}"
    _resolved_path="$(cd "$_project_path" 2>/dev/null && pwd || echo "$_project_path")"
    SPECMEM_PROJECT_HASH=$(echo -n "$_resolved_path" | sha256sum | cut -c1-12)
fi

# Output format
JSON_OUTPUT=false
if [ "$1" = "--json" ] || [ "$1" = "-j" ]; then
    JSON_OUTPUT=true
fi

# Colors (disabled for JSON output)
if [ "$JSON_OUTPUT" = false ]; then
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    RED='\033[0;31m'
    CYAN='\033[0;36m'
    DIM='\033[0;90m'
    NC='\033[0m'
else
    GREEN='' YELLOW='' RED='' CYAN='' DIM='' NC=''
fi

# Results tracking
declare -A RESULTS
CRITICAL_FAILED=0

# Helper functions
check_pass() {
    local name="$1"
    local detail="$2"
    RESULTS["$name"]="pass:$detail"
    if [ "$JSON_OUTPUT" = false ]; then
        echo -e "${GREEN}[OK]${NC} $name: $detail"
    fi
}

check_warn() {
    local name="$1"
    local detail="$2"
    RESULTS["$name"]="warn:$detail"
    if [ "$JSON_OUTPUT" = false ]; then
        echo -e "${YELLOW}[!!]${NC} $name: $detail"
    fi
}

check_fail() {
    local name="$1"
    local detail="$2"
    RESULTS["$name"]="fail:$detail"
    CRITICAL_FAILED=1
    if [ "$JSON_OUTPUT" = false ]; then
        echo -e "${RED}[XX]${NC} $name: $detail"
    fi
}

# JSON output function
output_json() {
    echo "{"
    echo "  \"timestamp\": \"$(date -Iseconds)\","
    echo "  \"specmem_dir\": \"$SPECMEM_DIR\","
    echo "  \"critical_failed\": $CRITICAL_FAILED,"
    echo "  \"checks\": {"

    local first=true
    for key in "${!RESULTS[@]}"; do
        if [ "$first" = false ]; then
            echo ","
        fi
        first=false

        local value="${RESULTS[$key]}"
        local status="${value%%:*}"
        local detail="${value#*:}"
        # Escape quotes in detail
        detail="${detail//\"/\\\"}"
        printf "    \"%s\": {\"status\": \"%s\", \"detail\": \"%s\"}" "$key" "$status" "$detail"
    done

    echo ""
    echo "  }"
    echo "}"
}

# ============================================================================
# Check 1: PostgreSQL Database Connection
# ============================================================================
check_postgresql() {
    local db_host="${SPECMEM_DB_HOST:-localhost}"
    local db_port="${SPECMEM_DB_PORT:-5432}"
    local db_name="${SPECMEM_DB_NAME:-specmem_westayunprofessional}"
    local db_user="${SPECMEM_DB_USER:-specmem_westayunprofessional}"
    local db_pass="${SPECMEM_DB_PASSWORD:-specmem_westayunprofessional}"

    # Try psql connection
    if command -v psql &>/dev/null; then
        if PGPASSWORD="$db_pass" psql -h "$db_host" -p "$db_port" -U "$db_user" -d "$db_name" -c "SELECT 1" &>/dev/null; then
            # Check for pgvector extension
            local has_pgvector
            has_pgvector=$(PGPASSWORD="$db_pass" psql -h "$db_host" -p "$db_port" -U "$db_user" -d "$db_name" -tAc "SELECT COUNT(*) FROM pg_extension WHERE extname='vector'" 2>/dev/null)
            if [ "$has_pgvector" = "1" ]; then
                check_pass "PostgreSQL" "Connected to $db_name@$db_host:$db_port (pgvector enabled)"
            else
                check_warn "PostgreSQL" "Connected but pgvector extension not found"
            fi
            return 0
        else
            check_fail "PostgreSQL" "Cannot connect to $db_name@$db_host:$db_port"
            return 1
        fi
    else
        # Try pg_isready as fallback
        if command -v pg_isready &>/dev/null; then
            if pg_isready -h "$db_host" -p "$db_port" &>/dev/null; then
                check_pass "PostgreSQL" "Server responding at $db_host:$db_port (psql not available for full check)"
                return 0
            else
                check_fail "PostgreSQL" "Server not responding at $db_host:$db_port"
                return 1
            fi
        fi

        # Last resort: try TCP connection
        if timeout 2 bash -c "echo >/dev/tcp/$db_host/$db_port" 2>/dev/null; then
            check_warn "PostgreSQL" "Port $db_port is open (psql/pg_isready not available for full check)"
            return 0
        else
            check_fail "PostgreSQL" "Cannot reach $db_host:$db_port (install psql for better diagnostics)"
            return 1
        fi
    fi
}

# ============================================================================
# Check 2: Embedding Service Socket
# ============================================================================
check_embedding_socket() {
    # Check various possible socket locations
    # Project-isolated /tmp path is preferred, then home directory, then legacy paths
    local socket_paths=(
        "${SPECMEM_EMBEDDING_SOCKET:-}"
        "/tmp/specmem-${SPECMEM_PROJECT_HASH}/sockets/embeddings.sock"
        "$HOME/.specmem/instances/${SPECMEM_PROJECT_HASH:0:8}/sockets/embeddings.sock"
        "$SPECMEM_DIR/run/embeddings.sock"
        "/tmp/specmem-sockets/embeddings.sock"  # DEPRECATED: Legacy path
        "/sockets/embeddings.sock"
    )

    for sock_path in "${socket_paths[@]}"; do
        if [ -n "$sock_path" ] && [ -S "$sock_path" ]; then
            # Try to verify socket is responsive
            if command -v nc &>/dev/null; then
                if echo '{"test":true}' | timeout 1 nc -U "$sock_path" &>/dev/null; then
                    check_pass "Embedding Socket" "Found and responsive at $sock_path"
                    return 0
                else
                    check_warn "Embedding Socket" "Found at $sock_path but not responding"
                    return 0
                fi
            else
                check_pass "Embedding Socket" "Found at $sock_path"
                return 0
            fi
        fi
    done

    # Check if embedding container is running as alternative
    if command -v docker &>/dev/null; then
        if docker ps --filter "name=frankenstein" --filter "status=running" 2>/dev/null | grep -q frankenstein; then
            check_pass "Embedding Socket" "Docker container running (socket may be internal)"
            return 0
        fi
    fi

    check_warn "Embedding Socket" "Not found (optional - embeddings will queue)"
    return 0
}

# ============================================================================
# Check 3: MCP Configuration in ~/.claude.json
# ============================================================================
check_mcp_config() {
    local claude_config="$HOME/.claude.json"

    if [ ! -f "$claude_config" ]; then
        check_fail "MCP Config" "~/.claude.json not found"
        return 1
    fi

    # Check if specmem is configured
    if ! grep -q "specmem" "$claude_config" 2>/dev/null; then
        check_fail "MCP Config" "specmem not found in ~/.claude.json"
        return 1
    fi

    # Extract the configured path using grep/sed (avoid jq dependency)
    local mcp_path
    mcp_path=$(grep -oP '"args":\s*\[\s*"[^"]*bootstrap\.cjs"' "$claude_config" 2>/dev/null | grep -oP '/[^"]+bootstrap\.cjs' | head -1)

    if [ -z "$mcp_path" ]; then
        # Try alternate format - direct index.js reference
        mcp_path=$(grep -oP '"args":\s*\[\s*"[^"]*index\.js"' "$claude_config" 2>/dev/null | grep -oP '/[^"]+index\.js' | head -1)
    fi

    if [ -n "$mcp_path" ]; then
        if [ -f "$mcp_path" ]; then
            check_pass "MCP Config" "Valid (path: $mcp_path)"
            return 0
        else
            check_fail "MCP Config" "Configured path not found: $mcp_path"
            return 1
        fi
    else
        # Check if specmem MCP is at least present
        if grep -q '"specmem"' "$claude_config" 2>/dev/null; then
            check_warn "MCP Config" "specmem entry found but path could not be parsed"
            return 0
        else
            check_fail "MCP Config" "specmem MCP entry not properly configured"
            return 1
        fi
    fi
}

# ============================================================================
# Check 4: Build Status (dist/index.js)
# ============================================================================
check_build() {
    local dist_file="$SPECMEM_DIR/dist/index.js"

    if [ ! -f "$dist_file" ]; then
        check_fail "Build" "dist/index.js not found - run 'npm run build'"
        return 1
    fi

    # Check if build is recent (within 7 days)
    local build_age_days
    build_age_days=$(( ($(date +%s) - $(stat -c %Y "$dist_file" 2>/dev/null || stat -f %m "$dist_file" 2>/dev/null)) / 86400 ))

    # Check if source is newer than build
    local src_dir="$SPECMEM_DIR/src"
    if [ -d "$src_dir" ]; then
        local newest_src
        newest_src=$(find "$src_dir" -name "*.ts" -newer "$dist_file" 2>/dev/null | head -1)
        if [ -n "$newest_src" ]; then
            check_warn "Build" "Source newer than build - consider 'npm run build'"
            return 0
        fi
    fi

    if [ "$build_age_days" -gt 7 ]; then
        check_warn "Build" "dist/index.js is ${build_age_days} days old"
    else
        local build_time
        build_time=$(stat -c %y "$dist_file" 2>/dev/null | cut -d. -f1 || stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$dist_file" 2>/dev/null)
        check_pass "Build" "Up to date (built: $build_time)"
    fi
    return 0
}

# ============================================================================
# Check 5: SpecMem Socket (Instance Running)
# ============================================================================
check_specmem_socket() {
    # Check for specmem.sock in project .specmem directory
    local sock_paths=(
        "$SPECMEM_DIR/.specmem/specmem.sock"
        "${SPECMEM_PROJECT_PATH:-.}/.specmem/specmem.sock"
    )

    for sock_path in "${sock_paths[@]}"; do
        if [ -S "$sock_path" ]; then
            check_pass "SpecMem Socket" "Instance running (socket: $sock_path)"
            return 0
        fi
    done

    check_warn "SpecMem Socket" "No running instance detected (start via Claude Code)"
    return 0
}

# ============================================================================
# Check 6: Critical Files
# ============================================================================
check_critical_files() {
    local missing=()
    local critical_files=(
        "bootstrap.cjs"
        "package.json"
        "specmem.env"
    )

    for file in "${critical_files[@]}"; do
        if [ ! -f "$SPECMEM_DIR/$file" ]; then
            missing+=("$file")
        fi
    done

    if [ ${#missing[@]} -eq 0 ]; then
        check_pass "Critical Files" "All present (bootstrap.cjs, package.json, specmem.env)"
        return 0
    else
        check_fail "Critical Files" "Missing: ${missing[*]}"
        return 1
    fi
}

# ============================================================================
# Main Execution
# ============================================================================
main() {
    if [ "$JSON_OUTPUT" = false ]; then
        echo ""
        echo -e "${CYAN}SpecMem Health Check${NC} ${DIM}(Standalone Mode)${NC}"
        echo -e "${DIM}================================================${NC}"
        echo -e "${DIM}Directory: $SPECMEM_DIR${NC}"
        echo ""
    fi

    # Run all checks
    check_postgresql
    check_embedding_socket
    check_mcp_config
    check_build
    check_specmem_socket
    check_critical_files

    if [ "$JSON_OUTPUT" = true ]; then
        output_json
    else
        echo ""
        echo -e "${DIM}------------------------------------------------${NC}"
        if [ $CRITICAL_FAILED -eq 0 ]; then
            echo -e "${GREEN}All critical checks passed!${NC}"
        else
            echo -e "${RED}Some critical checks failed - see above for details${NC}"
        fi
        echo ""
        echo -e "${DIM}Commands:${NC}"
        echo "  Start SpecMem:  npm start (or use Claude Code)"
        echo "  Rebuild:        npm run build"
        echo "  View logs:      Check terminal running SpecMem"
        echo ""
    fi

    exit $CRITICAL_FAILED
}

main "$@"
