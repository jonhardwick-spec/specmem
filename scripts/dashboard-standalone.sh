#!/bin/bash
# ============================================================================
# SpecMem Dashboard Standalone Launcher
# ============================================================================
# Native process management for the dashboard webserver (no PM2)
#
# Features:
# - Project-scoped ports via portAllocator
# - Foreground mode (default) with optional -d for daemon mode
# - Simple process management with nohup + PID file when daemonized
# - Stop/status/restart commands
#
# Usage:
#   ./dashboard-standalone.sh                  # Start in foreground
#   ./dashboard-standalone.sh -d               # Start as daemon
#   ./dashboard-standalone.sh stop             # Stop daemon
#   ./dashboard-standalone.sh status           # Show status
#   ./dashboard-standalone.sh restart          # Restart daemon
#   ./dashboard-standalone.sh logs             # Tail logs
#
# The dashboard is OPTIONAL - the MCP server works without it.
# This is just for the web UI.
# ============================================================================

set -e

# ============================================================================
# PATHS AND DIRECTORIES
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPECMEM_HOME="${SPECMEM_HOME:-$(dirname "$SCRIPT_DIR")}"

# Source project environment for isolation
source "${SCRIPT_DIR}/project-env.sh"

# Set up instance-scoped paths
RUN_DIR="${SPECMEM_INSTANCE_DIR:-$HOME/.specmem/instances/${SPECMEM_PROJECT_HASH}}"
PID_FILE="${RUN_DIR}/dashboard.pid"
LOG_FILE="${SPECMEM_LOG_DIR:-$RUN_DIR/logs}/dashboard.log"

# Ensure directories exist
mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")"

# ============================================================================
# COLOR OUTPUT
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_debug() { echo -e "${CYAN}[DEBUG]${NC} $1"; }

# ============================================================================
# PROCESS MANAGEMENT FUNCTIONS
# ============================================================================

# Check if dashboard is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Get dashboard PID
get_pid() {
    if [ -f "$PID_FILE" ]; then
        cat "$PID_FILE" 2>/dev/null
    fi
}

# Start dashboard in foreground mode
start_foreground() {
    if is_running; then
        log_warn "Dashboard already running (PID: $(get_pid))"
        log_info "Use '$0 stop' to stop it first, or '$0 restart'"
        exit 1
    fi

    show_banner

    log_info "Starting dashboard in foreground mode..."
    log_info "Press Ctrl+C to stop"
    echo ""

    # Load environment
    load_environment

    # Run directly (exec replaces shell with node)
    exec node "${SPECMEM_HOME}/dist/dashboard/standalone.js"
}

# Start dashboard in daemon mode
start_daemon() {
    if is_running; then
        log_warn "Dashboard already running (PID: $(get_pid))"
        log_info "Use '$0 restart' to restart"
        return 0
    fi

    show_banner

    log_info "Starting dashboard in daemon mode..."

    # Load environment
    load_environment

    # Start with nohup in background
    nohup node "${SPECMEM_HOME}/dist/dashboard/standalone.js" >> "$LOG_FILE" 2>&1 &
    local pid=$!

    # Write PID file
    echo "$pid" > "$PID_FILE"

    # Wait briefly to check if process started
    sleep 2

    if is_running; then
        log_info "Dashboard started (PID: $pid)"
        log_info "Log file: $LOG_FILE"
        log_info "Use '$0 status' to check status"
        log_info "Use '$0 stop' to stop"
    else
        log_error "Dashboard failed to start. Check logs: $LOG_FILE"
        rm -f "$PID_FILE"
        exit 1
    fi
}

# Stop the dashboard
stop_dashboard() {
    if ! is_running; then
        log_warn "Dashboard is not running"
        rm -f "$PID_FILE"
        return 0
    fi

    local pid=$(get_pid)
    log_info "Stopping dashboard (PID: $pid)..."

    # Send SIGTERM for graceful shutdown
    kill -TERM "$pid" 2>/dev/null || true

    # Wait up to 10 seconds for graceful shutdown
    local count=0
    while kill -0 "$pid" 2>/dev/null && [ $count -lt 20 ]; do
        sleep 0.5
        count=$((count + 1))
    done

    # Force kill if still running
    if kill -0 "$pid" 2>/dev/null; then
        log_warn "Dashboard did not stop gracefully, sending SIGKILL..."
        kill -KILL "$pid" 2>/dev/null || true
        sleep 1
    fi

    # Cleanup PID file
    rm -f "$PID_FILE"
    log_info "Dashboard stopped"
}

# Show dashboard status
show_status() {
    echo ""
    echo "========================================"
    echo "SpecMem Dashboard Status"
    echo "========================================"
    echo ""
    echo "Project:  $SPECMEM_PROJECT_PATH"
    echo "Hash:     $SPECMEM_PROJECT_HASH"
    echo ""

    if is_running; then
        local pid=$(get_pid)
        local mem=$(ps -p "$pid" -o rss= 2>/dev/null | awk '{printf "%.1f MB", $1/1024}')
        local cpu=$(ps -p "$pid" -o %cpu= 2>/dev/null | awk '{printf "%.1f%%", $1}')
        local uptime=$(ps -p "$pid" -o etime= 2>/dev/null | tr -d ' ')

        echo -e "Status:   ${GREEN}RUNNING${NC}"
        echo "PID:      $pid"
        echo "Memory:   $mem"
        echo "CPU:      $cpu"
        echo "Uptime:   $uptime"
        echo "Log:      $LOG_FILE"
        echo ""

        # Try to get port from logs or environment
        local port="${SPECMEM_DASHBOARD_PORT:-auto-allocated}"
        if [ "$port" = "auto-allocated" ] && [ -f "$LOG_FILE" ]; then
            # Try to extract port from recent logs
            local detected_port=$(tail -100 "$LOG_FILE" 2>/dev/null | grep -oP 'port.*?:\s*\K\d+' | tail -1)
            if [ -n "$detected_port" ]; then
                port="$detected_port"
            fi
        fi

        echo "Dashboard URL: http://localhost:${port}"
    else
        echo -e "Status:   ${RED}STOPPED${NC}"
    fi
    echo ""
}

# Restart the dashboard
restart_dashboard() {
    stop_dashboard
    sleep 1
    start_daemon
}

# Show logs
show_logs() {
    if [ -f "$LOG_FILE" ]; then
        log_info "Tailing dashboard logs: $LOG_FILE"
        echo ""
        tail -f "$LOG_FILE"
    else
        log_error "Log file not found: $LOG_FILE"
        log_info "Dashboard may not have been started yet"
        exit 1
    fi
}

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

# Show startup banner
show_banner() {
    echo ""
    echo "========================================"
    echo "SpecMem Dashboard (Standalone)"
    echo "========================================"
    echo "Project:  $SPECMEM_PROJECT_PATH"
    echo "Hash:     $SPECMEM_PROJECT_HASH"
    echo "PID File: $PID_FILE"
    echo "Log File: $LOG_FILE"
    if [ -n "$SPECMEM_DASHBOARD_PORT" ]; then
        echo "Port:     $SPECMEM_DASHBOARD_PORT"
    else
        echo "Port:     (auto-allocated via portAllocator)"
    fi
    echo ""
}

# Load environment from specmem.env and .env
load_environment() {
    # Export project isolation vars
    export SPECMEM_PROJECT_PATH
    export SPECMEM_PROJECT_HASH
    export SPECMEM_INSTANCE_DIR
    export SPECMEM_SOCKET_DIR="${SPECMEM_SOCKET_DIR:-$SPECMEM_INSTANCE_DIR/sockets}"
    export SPECMEM_LOG_DIR="${SPECMEM_LOG_DIR:-$SPECMEM_INSTANCE_DIR/logs}"

    # Load specmem.env if it exists
    if [ -f "${SPECMEM_HOME}/specmem.env" ]; then
        set -a
        source "${SPECMEM_HOME}/specmem.env"
        set +a
    fi

    # Load .env if it exists (will override specmem.env)
    if [ -f "${SPECMEM_HOME}/.env" ]; then
        set -a
        source "${SPECMEM_HOME}/.env"
        set +a
    fi

    # Ensure we're in the right directory
    cd "${SPECMEM_HOME}"
}

# Show usage help
show_usage() {
    echo "SpecMem Dashboard Standalone Launcher"
    echo ""
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  (none)      Start in foreground mode (Ctrl+C to stop)"
    echo "  -d          Start in daemon mode (background)"
    echo "  stop        Stop the running dashboard"
    echo "  status      Show dashboard status"
    echo "  restart     Restart the dashboard (daemon mode)"
    echo "  logs        Tail dashboard logs"
    echo "  help        Show this help message"
    echo ""
    echo "Options:"
    echo "  -d          Run as daemon (background mode)"
    echo ""
    echo "Environment Variables:"
    echo "  SPECMEM_PROJECT_PATH       Project path (default: current directory)"
    echo "  SPECMEM_DASHBOARD_PORT     Dashboard port (default: auto-allocated)"
    echo "  SPECMEM_DASHBOARD_HOST     Dashboard host (default: 127.0.0.1)"
    echo "  SPECMEM_DASHBOARD_PASSWORD Login password"
    echo ""
    echo "Examples:"
    echo "  $0                    # Start in foreground"
    echo "  $0 -d                 # Start as daemon"
    echo "  $0 stop               # Stop daemon"
    echo "  $0 status             # Check if running"
    echo "  $0 logs               # View logs"
    echo ""
    echo "NOTE: The dashboard is OPTIONAL. The MCP server works without it."
    echo "      This is just for the web UI."
}

# ============================================================================
# MAIN COMMAND HANDLER
# ============================================================================

main() {
    local command="${1:-foreground}"

    case "$command" in
        -d|--daemon|daemon)
            start_daemon
            ;;

        stop)
            stop_dashboard
            ;;

        status)
            show_status
            ;;

        restart)
            restart_dashboard
            ;;

        logs)
            show_logs
            ;;

        help|--help|-h)
            show_usage
            ;;

        foreground|"")
            start_foreground
            ;;

        *)
            # Check if it's a flag we don't recognize
            if [[ "$command" == -* ]]; then
                log_error "Unknown option: $command"
                echo ""
                show_usage
                exit 1
            fi
            # Otherwise treat as foreground start
            start_foreground
            ;;
    esac
}

main "$@"
