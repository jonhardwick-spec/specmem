#!/bin/bash
# EMBEDDING SUPERVISOR - Auto-restart with exponential backoff
#
# Features:
#   - Monitors embedding server process
#   - Auto-restarts on crash/exit with exponential backoff
#   - Resets backoff after successful run period
#   - Logs all restart attempts
#   - Max backoff cap to prevent infinite wait
#
# Usage: ./embedding-supervisor.sh [project_path]

set -e

# Configuration
PROJECT_PATH="${1:-${SPECMEM_PROJECT_PATH:-$(pwd)}}"
SOCKET_DIR="${PROJECT_PATH}/specmem/sockets"
LOG_FILE="${SOCKET_DIR}/supervisor.log"
PID_FILE="${SOCKET_DIR}/embedding.pid"

# Backoff configuration
INITIAL_BACKOFF=1        # Start with 1 second
MAX_BACKOFF=300          # Cap at 5 minutes
BACKOFF_MULTIPLIER=2     # Double each time
SUCCESS_THRESHOLD=60     # Reset backoff after 60s of successful running

# Get the embedding server script
SPECMEM_DIR="$(cd "$(dirname "$0")" && pwd)"
EMBEDDING_SCRIPT="${SPECMEM_DIR}/frankenstein-embeddings.py"

# Ensure socket directory exists
mkdir -p "$SOCKET_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [SUPERVISOR] $1" | tee -a "$LOG_FILE"
}

cleanup() {
    log "Supervisor shutting down..."
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        kill "$pid" 2>/dev/null || true
        rm -f "$PID_FILE"
    fi
    rm -f "${SOCKET_DIR}/embeddings.sock"
    exit 0
}

trap cleanup SIGINT SIGTERM

start_server() {
    log "Starting embedding server for project: $PROJECT_PATH"

    # Clean up old socket
    rm -f "${SOCKET_DIR}/embeddings.sock"

    # Start the embedding server
    cd "$PROJECT_PATH"
    export SPECMEM_PROJECT_PATH="$PROJECT_PATH"

    python3 "$EMBEDDING_SCRIPT" >> "${SOCKET_DIR}/embedding.log" 2>&1 &
    local pid=$!
    echo "$pid" > "$PID_FILE"

    log "Started embedding server with PID: $pid"
    echo "$pid"
}

wait_for_socket() {
    local timeout=${1:-30}
    local socket="${SOCKET_DIR}/embeddings.sock"

    for i in $(seq 1 $timeout); do
        if [ -S "$socket" ]; then
            # Test if socket is responsive
            if echo '{"stats":true}' | timeout 2 nc -U "$socket" 2>/dev/null | grep -q "stats"; then
                return 0
            fi
        fi
        sleep 1
    done
    return 1
}

main() {
    log "=========================================="
    log "Embedding Supervisor Starting"
    log "Project: $PROJECT_PATH"
    log "Socket: ${SOCKET_DIR}/embeddings.sock"
    log "=========================================="

    local backoff=$INITIAL_BACKOFF
    local consecutive_failures=0
    local max_consecutive=10

    while true; do
        local start_time=$(date +%s)

        # Start the server
        local pid=$(start_server)

        # Wait for socket to be ready
        if wait_for_socket 30; then
            log "Socket is ready and responsive"
            backoff=$INITIAL_BACKOFF  # Reset backoff on successful start
            consecutive_failures=0
        else
            log "WARNING: Socket not ready after 30s, but continuing..."
        fi

        # Monitor the process
        while kill -0 "$pid" 2>/dev/null; do
            sleep 5

            # Check if we've been running long enough to reset backoff
            local run_time=$(($(date +%s) - start_time))
            if [ $run_time -ge $SUCCESS_THRESHOLD ] && [ $backoff -gt $INITIAL_BACKOFF ]; then
                log "Server stable for ${run_time}s, resetting backoff"
                backoff=$INITIAL_BACKOFF
                consecutive_failures=0
            fi
        done

        # Process died
        local run_time=$(($(date +%s) - start_time))
        consecutive_failures=$((consecutive_failures + 1))

        log "Server exited after ${run_time}s (failure #${consecutive_failures})"

        # Check for too many failures
        if [ $consecutive_failures -ge $max_consecutive ]; then
            log "ERROR: Too many consecutive failures ($max_consecutive), giving up"
            exit 1
        fi

        # Apply backoff
        log "Waiting ${backoff}s before restart (backoff)"
        sleep $backoff

        # Increase backoff for next time (exponential)
        backoff=$((backoff * BACKOFF_MULTIPLIER))
        if [ $backoff -gt $MAX_BACKOFF ]; then
            backoff=$MAX_BACKOFF
        fi

        # Clean up
        rm -f "$PID_FILE"
        rm -f "${SOCKET_DIR}/embeddings.sock"
    done
}

# Check if already running
if [ -f "$PID_FILE" ]; then
    existing_pid=$(cat "$PID_FILE")
    if kill -0 "$existing_pid" 2>/dev/null; then
        log "Supervisor already running with PID $existing_pid"
        exit 0
    else
        log "Stale PID file found, cleaning up"
        rm -f "$PID_FILE"
    fi
fi

main
