#!/bin/bash
#
# Native Process Manager for SpecMem AI Services
# Replaces PM2 with native process management using PID files and signals
#
# Features:
# - PID file management for process tracking
# - Graceful shutdown with SIGTERM/SIGKILL fallback
# - Auto-restart on crash (optional)
# - Health checks via Unix socket
# - Log rotation support
#
# Usage:
#   ./manage-services.sh start    # Start all AI services
#   ./manage-services.sh stop     # Stop all AI services
#   ./manage-services.sh restart  # Restart all AI services
#   ./manage-services.sh status   # Show service status
#   ./manage-services.sh logs     # Tail service logs
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPECMEM_HOME="${SPECMEM_HOME:-$(dirname "$SCRIPT_DIR")}"
SPECMEM_RUN_DIR="${SPECMEM_RUN_DIR:-${SPECMEM_HOME}/run}"
SPECMEM_SOCKET_DIR="${SPECMEM_SOCKET_DIR:-${SPECMEM_RUN_DIR}}"

RUN_DIR="${SPECMEM_RUN_DIR}"
SOCKET_DIR="${SPECMEM_SOCKET_DIR}"
LOG_DIR="${SCRIPT_DIR}/logs"

# Service definitions
declare -A SERVICES=(
    ["frankenstein"]="${SCRIPT_DIR}/frankenstein-embeddings.py"
    ["mini-cot"]="${SPECMEM_HOME}/mini-cot-service.py"
)

declare -A SERVICE_SOCKETS=(
    ["frankenstein"]="${SOCKET_DIR}/embeddings.sock"
    ["mini-cot"]="${SOCKET_DIR}/mini-cot.sock"
)

declare -A SERVICE_ARGS=(
    ["frankenstein"]="--socket ${SOCKET_DIR}/embeddings.sock --idle-threshold 30 --active-cpu-limit 25"
    ["mini-cot"]="--socket ${SOCKET_DIR}/mini-cot.sock --model TinyLlama/TinyLlama-1.1B-Chat-v1.0 --cache-size 100"
)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Logging functions
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_debug() { echo -e "${CYAN}[DEBUG]${NC} $1"; }

# Create directories
setup_dirs() {
    mkdir -p "$RUN_DIR" "$SOCKET_DIR" "$LOG_DIR"
    chmod 755 "$RUN_DIR" "$SOCKET_DIR" "$LOG_DIR"
}

# Get PID file path
pid_file() {
    echo "${RUN_DIR}/${1}.pid"
}

# Get log file path
log_file() {
    echo "${LOG_DIR}/${1}.log"
}

# Check if service is running
is_running() {
    local service=$1
    local pidfile=$(pid_file "$service")

    if [ -f "$pidfile" ]; then
        local pid=$(cat "$pidfile" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Get service PID
get_pid() {
    local service=$1
    local pidfile=$(pid_file "$service")

    if [ -f "$pidfile" ]; then
        cat "$pidfile" 2>/dev/null
    fi
}

# Start a service
start_service() {
    local service=$1
    local script=${SERVICES[$service]}
    local args=${SERVICE_ARGS[$service]}
    local socket=${SERVICE_SOCKETS[$service]}
    local pidfile=$(pid_file "$service")
    local logfile=$(log_file "$service")

    if [ ! -f "$script" ]; then
        log_error "Script not found: $script"
        return 1
    fi

    if is_running "$service"; then
        log_warn "$service is already running (PID: $(get_pid $service))"
        return 0
    fi

    # Remove stale socket if exists
    if [ -S "$socket" ]; then
        rm -f "$socket"
    fi

    log_info "Starting $service..."

    # Start the service in background
    nohup python3 "$script" $args >> "$logfile" 2>&1 &
    local pid=$!

    # Write PID file
    echo "$pid" > "$pidfile"

    # Wait for socket to appear (max 30 seconds)
    local count=0
    while [ ! -S "$socket" ] && [ $count -lt 60 ]; do
        sleep 0.5
        count=$((count + 1))

        # Check if process is still alive
        if ! kill -0 "$pid" 2>/dev/null; then
            log_error "$service died during startup. Check logs: $logfile"
            rm -f "$pidfile"
            return 1
        fi
    done

    if [ -S "$socket" ]; then
        log_info "$service started (PID: $pid, Socket: $socket)"
        return 0
    else
        log_error "$service failed to create socket. Check logs: $logfile"
        kill -TERM "$pid" 2>/dev/null || true
        rm -f "$pidfile"
        return 1
    fi
}

# Stop a service gracefully
stop_service() {
    local service=$1
    local pidfile=$(pid_file "$service")
    local socket=${SERVICE_SOCKETS[$service]}

    if ! is_running "$service"; then
        log_warn "$service is not running"
        rm -f "$pidfile"
        return 0
    fi

    local pid=$(get_pid "$service")
    log_info "Stopping $service (PID: $pid)..."

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
        log_warn "$service did not stop gracefully, sending SIGKILL..."
        kill -KILL "$pid" 2>/dev/null || true
        sleep 1
    fi

    # Cleanup
    rm -f "$pidfile" "$socket"
    log_info "$service stopped"
}

# Restart a service
restart_service() {
    local service=$1
    stop_service "$service"
    sleep 1
    start_service "$service"
}

# Show service status
show_status() {
    echo ""
    echo "========================================"
    echo "SpecMem AI Services Status"
    echo "========================================"
    echo ""

    for service in "${!SERVICES[@]}"; do
        local socket=${SERVICE_SOCKETS[$service]}

        if is_running "$service"; then
            local pid=$(get_pid "$service")
            local mem=$(ps -p "$pid" -o rss= 2>/dev/null | awk '{printf "%.1f MB", $1/1024}')
            local cpu=$(ps -p "$pid" -o %cpu= 2>/dev/null | awk '{printf "%.1f%%", $1}')

            echo -e "${GREEN}[RUNNING]${NC} $service"
            echo "    PID:    $pid"
            echo "    Memory: $mem"
            echo "    CPU:    $cpu"
            echo "    Socket: $socket"

            # Check socket health
            if [ -S "$socket" ]; then
                echo -e "    Health: ${GREEN}Socket OK${NC}"
            else
                echo -e "    Health: ${YELLOW}Socket missing!${NC}"
            fi
        else
            echo -e "${RED}[STOPPED]${NC} $service"
        fi
        echo ""
    done
}

# Tail logs
show_logs() {
    local service=${1:-all}

    if [ "$service" = "all" ]; then
        tail -f "${LOG_DIR}/"*.log
    else
        local logfile=$(log_file "$service")
        if [ -f "$logfile" ]; then
            tail -f "$logfile"
        else
            log_error "Log file not found: $logfile"
        fi
    fi
}

# Health check via socket
health_check() {
    local service=$1
    local socket=${SERVICE_SOCKETS[$service]}

    if [ ! -S "$socket" ]; then
        return 1
    fi

    # Send stats request and check response
    local response=$(echo '{"stats":true}' | timeout 5 nc -U "$socket" 2>/dev/null)

    if [ -n "$response" ]; then
        return 0
    else
        return 1
    fi
}

# Main command handler
main() {
    local command=${1:-status}
    local service=${2:-all}

    setup_dirs

    case "$command" in
        start)
            if [ "$service" = "all" ]; then
                for svc in "${!SERVICES[@]}"; do
                    start_service "$svc"
                done
            else
                start_service "$service"
            fi
            ;;

        stop)
            if [ "$service" = "all" ]; then
                for svc in "${!SERVICES[@]}"; do
                    stop_service "$svc"
                done
            else
                stop_service "$service"
            fi
            ;;

        restart)
            if [ "$service" = "all" ]; then
                for svc in "${!SERVICES[@]}"; do
                    restart_service "$svc"
                done
            else
                restart_service "$service"
            fi
            ;;

        status)
            show_status
            ;;

        logs)
            show_logs "$service"
            ;;

        health)
            if [ "$service" = "all" ]; then
                for svc in "${!SERVICES[@]}"; do
                    if health_check "$svc"; then
                        echo -e "$svc: ${GREEN}healthy${NC}"
                    else
                        echo -e "$svc: ${RED}unhealthy${NC}"
                    fi
                done
            else
                if health_check "$service"; then
                    echo -e "$service: ${GREEN}healthy${NC}"
                else
                    echo -e "$service: ${RED}unhealthy${NC}"
                fi
            fi
            ;;

        *)
            echo "Usage: $0 {start|stop|restart|status|logs|health} [service|all]"
            echo ""
            echo "Services: frankenstein, mini-cot"
            echo ""
            echo "Examples:"
            echo "  $0 start                # Start all services"
            echo "  $0 stop frankenstein    # Stop frankenstein only"
            echo "  $0 status               # Show all service status"
            echo "  $0 logs mini-cot        # Tail mini-cot logs"
            echo "  $0 health               # Run health checks"
            exit 1
            ;;
    esac
}

main "$@"
