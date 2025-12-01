#!/bin/bash
# ============================================================================
# On-Demand Embedding Service Starter
# ============================================================================
# Called by hooks when embeddings are needed but service isn't running.
#
# PROJECT ISOLATION:
#   Each project gets its own socket at:
#   ~/.specmem/instances/{project_dir_name}/sockets/embeddings.sock
#
#   PID and log files are also project-scoped:
#   ~/.specmem/instances/{project_dir_name}/logs/frankenstein-embeddings.log
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SPECMEM_HOME="${SPECMEM_HOME:-$(dirname "$SCRIPT_DIR")}"

# ============================================================================
# PROJECT ISOLATION SETUP
# ============================================================================

# Ensure SPECMEM_PROJECT_PATH is set
export SPECMEM_PROJECT_PATH="${SPECMEM_PROJECT_PATH:-$(pwd)}"
SPECMEM_PROJECT_PATH="$(cd "$SPECMEM_PROJECT_PATH" && pwd)"

# Generate project DIRECTORY NAME (readable, not hash!)
PROJECT_DIR_NAME=$(basename "$SPECMEM_PROJECT_PATH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_.-]/-/g; s/--*/-/g; s/^-//; s/-$//')
[ -z "$PROJECT_DIR_NAME" ] && PROJECT_DIR_NAME="default"
export SPECMEM_PROJECT_DIR_NAME="$PROJECT_DIR_NAME"

# Set project-scoped paths (using readable name, NOT hash!)
INSTANCE_DIR="${SPECMEM_INSTANCE_DIR:-$HOME/.specmem/instances/$PROJECT_DIR_NAME}"
SOCKET_DIR="${SPECMEM_SOCKET_DIR:-$INSTANCE_DIR/sockets}"
LOG_DIR="${SPECMEM_LOG_DIR:-$INSTANCE_DIR/logs}"

# Create directories
mkdir -p "${SOCKET_DIR}" "${LOG_DIR}"

# Project-scoped file paths
SOCKET_PATH="${SOCKET_DIR}/embeddings.sock"
PID_FILE="${INSTANCE_DIR}/frankenstein-embeddings.pid"
LOG_FILE="${LOG_DIR}/frankenstein-embeddings.log"

# Export for child processes
export SPECMEM_SOCKET_DIR="${SOCKET_DIR}"
export SPECMEM_LOG_DIR="${LOG_DIR}"
export SPECMEM_PROJECT_HASH="${PROJECT_HASH}"

# ============================================================================
# SERVICE CHECK
# ============================================================================

check_service() {
    if [ -S "$SOCKET_PATH" ]; then
        # Try a quick ping
        echo '{"stats": true}' | timeout 2 nc -U "$SOCKET_PATH" > /dev/null 2>&1
        return $?
    fi
    return 1
}

# ============================================================================
# START SERVICE
# ============================================================================

start_service() {
    echo "[$(date)] Starting Frankenstein embeddings on-demand for project: $SPECMEM_PROJECT_PATH" >> "$LOG_FILE"
    echo "[$(date)] Instance hash: $PROJECT_HASH" >> "$LOG_FILE"

    # Kill any zombie process
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE")
        kill -0 "$OLD_PID" 2>/dev/null || rm -f "$PID_FILE"
    fi

    # Start in background with QQMS throttling to prevent CPU spikes
    cd "$SCRIPT_DIR"
    nohup python3 frankenstein-embeddings.py \
        --socket "$SOCKET_PATH" \
        --db-host "${SPECMEM_DB_HOST:-localhost}" \
        --db-port "${SPECMEM_DB_PORT:-5432}" \
        --db-name "${SPECMEM_DB_NAME:-specmem_westayunprofessional}" \
        --db-user "${SPECMEM_DB_USER:-specmem_westayunprofessional}" \
        --db-password "${SPECMEM_DB_PASSWORD:-specmem_westayunprofessional}" \
        --max-rps "${SPECMEM_EMBEDDING_MAX_RPS:-10}" \
        --base-delay "${SPECMEM_EMBEDDING_BASE_DELAY:-100}" \
        --cpu-threshold "${SPECMEM_EMBEDDING_CPU_THRESHOLD:-60}" \
        >> "$LOG_FILE" 2>&1 &

    echo $! > "$PID_FILE"

    # Wait for socket to appear (max 30 seconds)
    for i in {1..30}; do
        if [ -S "$SOCKET_PATH" ]; then
            echo "[$(date)] Service started (PID: $(cat $PID_FILE), Hash: $PROJECT_HASH)" >> "$LOG_FILE"
            exit 0
        fi
        sleep 1
    done

    echo "[$(date)] ERROR: Service failed to start" >> "$LOG_FILE"
    exit 1
}

# ============================================================================
# MAIN
# ============================================================================

if check_service; then
    # Already running
    exit 0
else
    start_service
fi
