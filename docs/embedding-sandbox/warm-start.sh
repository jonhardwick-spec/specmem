#!/bin/bash
# WARM START - Instant embedding service resume using Docker pause/unpause
#
# Strategy:
#   1. Container RUNNING + socket responsive -> use it (instant)
#   2. Container PAUSED -> unpause + feed overflow (instant! ~100ms + feed)
#   3. Container STOPPED -> start + feed overflow (fast, ~2-3s)
#   4. No container -> create & run + COLD START (slow, ~20-30s + full feed)
#
# VERSION SAFETY:
#   - Every container gets specmem.version label
#   - Before using ANY container, check version label
#   - Missing/mismatched version = KILL & REBUILD (old code!)
#
# On idle: Container is PAUSED (not stopped) - stays in RAM, 0% CPU
#
# MACHINE-SHARED: Single embedding server per user (UID), shared across all projects
# Embeddings are stateless - sharing improves memory efficiency

set -e

# Get specmem installation directory
SPECMEM_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Get specmem version from package.json
SPECMEM_VERSION=$(node -p "require('$SPECMEM_DIR/package.json').version" 2>/dev/null || echo "0.0.0")

# SOCKET PATH RESOLUTION (in priority order):
# 1. SPECMEM_EMBEDDING_SOCKET env var (per-project, set by hooks)
# 2. SPECMEM_SOCKET_DIR env var + embeddings.sock
# 3. SPECMEM_PROJECT_PATH env var + specmem/sockets/embeddings.sock
# 4. MACHINE-SHARED fallback: /tmp/specmem-embed-{uid}.sock

# Get user ID for unique identifiers
USER_ID=$(id -u)

# Log file in user's home directory (define early for log function)
LOG_FILE="${HOME}/.specmem/logs/embedding-warm-${USER_ID}.log"
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true

# Log function (defined early so it can be used throughout)
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Resolve socket path from environment or use machine-shared fallback
if [ -n "$SPECMEM_EMBEDDING_SOCKET" ]; then
    # Per-project socket from env var (highest priority)
    SOCKET_PATH="$SPECMEM_EMBEDDING_SOCKET"
    SOCKET_DIR="$(dirname "$SOCKET_PATH")"
    log "Using per-project socket from SPECMEM_EMBEDDING_SOCKET: $SOCKET_PATH"
elif [ -n "$SPECMEM_SOCKET_DIR" ]; then
    # Socket directory from env var
    SOCKET_DIR="$SPECMEM_SOCKET_DIR"
    SOCKET_PATH="$SOCKET_DIR/embeddings.sock"
    log "Using socket dir from SPECMEM_SOCKET_DIR: $SOCKET_PATH"
elif [ -n "$SPECMEM_PROJECT_PATH" ]; then
    # Construct from project path
    SOCKET_DIR="$SPECMEM_PROJECT_PATH/specmem/sockets"
    SOCKET_PATH="$SOCKET_DIR/embeddings.sock"
    log "Using socket from SPECMEM_PROJECT_PATH: $SOCKET_PATH"
else
    # MACHINE-SHARED fallback (legacy behavior)
    SOCKET_DIR="/tmp"
    SOCKET_PATH="/tmp/specmem-embed-${USER_ID}.sock"
    log "Using machine-shared socket fallback: $SOCKET_PATH"
fi

# Ensure socket directory exists
mkdir -p "$SOCKET_DIR" 2>/dev/null || true

# Container name - use project directory name for human-readable isolation
# This matches TypeScript implementation and makes docker ps much cleaner
if [ -n "$SPECMEM_PROJECT_DIR_NAME" ]; then
    PROJECT_DIR_NAME="$SPECMEM_PROJECT_DIR_NAME"
elif [ -n "$SPECMEM_PROJECT_PATH" ]; then
    # Get dir name from project path and sanitize for Docker naming
    PROJECT_DIR_NAME=$(basename "$SPECMEM_PROJECT_PATH" | tr '[:upper:]' '[:lower:]' | tr '_' '-' | tr -cd 'a-z0-9-')
else
    # Fallback to hash of socket path
    PROJECT_DIR_NAME=$(echo -n "$SOCKET_PATH" | md5sum | cut -c1-8)
fi
# Final fallback if name is too short
if [ -z "$PROJECT_DIR_NAME" ] || [ ${#PROJECT_DIR_NAME} -lt 2 ]; then
    PROJECT_DIR_NAME=$(echo -n "$SOCKET_PATH" | md5sum | cut -c1-8)
fi
CONTAINER_NAME="specmem-embedding-${PROJECT_DIR_NAME}"
IMAGE_NAME="specmem-embedding:latest"

# CPU limit from env or default to 1.0
CPU_LIMIT="${SPECMEM_EMBEDDING_CPU_LIMIT:-1.0}"

# Warm start feeder script
FEEDER_SCRIPT="$SPECMEM_DIR/embedding-sandbox/warm_start_feeder.py"

# Check container version label
get_container_version() {
    docker inspect --format='{{index .Config.Labels "specmem.version"}}' "$CONTAINER_NAME" 2>/dev/null || echo ""
}

# Check if version matches current specmem
version_matches() {
    local container_version=$(get_container_version)
    if [ -z "$container_version" ] || [ "$container_version" = "<no value>" ]; then
        log "VERSION CHECK: No version label (old code!)"
        return 1
    fi
    if [ "$container_version" != "$SPECMEM_VERSION" ]; then
        log "VERSION CHECK: Mismatch - container=$container_version, specmem=$SPECMEM_VERSION (old code!)"
        return 1
    fi
    log "VERSION CHECK: OK - $container_version"
    return 0
}

# Kill container due to version mismatch
kill_old_version() {
    local old_version=$(get_container_version)
    log "KILLING OLD VERSION: $old_version != $SPECMEM_VERSION"
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
    rm -f "$SOCKET_PATH"
}

# Clean up stale containers and orphaned sockets
cleanup_stale() {
    # Find and remove exited containers for this user (but check version first!)
    local stale=$(docker ps -aq --filter "label=specmem.user=$USER_ID" --filter "status=exited")
    if [ -n "$stale" ]; then
        log "Cleaning up stale containers: $stale"
        docker rm $stale 2>/dev/null || true
    fi

    # If socket exists but container not running, remove orphan socket
    if [ -S "$SOCKET_PATH" ] && [ "$(get_container_state)" != "running" ] && [ "$(get_container_state)" != "paused" ]; then
        log "Removing orphaned socket"
        rm -f "$SOCKET_PATH"
    fi
}

# Ensure socket directory exists with correct permissions
ensure_socket_dir() {
    if [ -S "$SOCKET_PATH" ]; then
        chmod 0600 "$SOCKET_PATH"
    fi
}

# Check if socket is responding
socket_alive() {
    if [ -S "$SOCKET_PATH" ]; then
        echo '{"type":"health"}' | timeout 2 nc -U "$SOCKET_PATH" 2>/dev/null | grep -q "healthy"
        return $?
    fi
    return 1
}

# Get container state
get_container_state() {
    docker inspect --format='{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || true
}

# Feed overflow queue after warm start
feed_overflow() {
    if [ -f "$FEEDER_SCRIPT" ]; then
        log "FEEDING: Running warm start feeder..."
        python3 "$FEEDER_SCRIPT" --warm --socket "$SOCKET_PATH" >> "$LOG_FILE" 2>&1 || true
    else
        log "FEEDING: Feeder script not found at $FEEDER_SCRIPT"
    fi
}

# Feed full database on cold start
feed_cold_start() {
    if [ -f "$FEEDER_SCRIPT" ]; then
        log "COLD START FEEDING: Running full database feed..."
        python3 "$FEEDER_SCRIPT" --cold --socket "$SOCKET_PATH" >> "$LOG_FILE" 2>&1 || true
    else
        log "COLD START FEEDING: Feeder script not found at $FEEDER_SCRIPT"
    fi
}

# Record pause time for delta tracking
record_pause_time() {
    if [ -f "$FEEDER_SCRIPT" ]; then
        python3 "$FEEDER_SCRIPT" --record-pause >> "$LOG_FILE" 2>&1 || true
    fi
}

# Main warm-start logic
main() {
    cleanup_stale
    ensure_socket_dir

    log "=========================================="
    log "WARM START v$SPECMEM_VERSION"
    log "=========================================="

    # Quick check - already running and responsive?
    if socket_alive; then
        # But check version first!
        if ! version_matches; then
            log "Socket alive but OLD VERSION - killing..."
            kill_old_version
        else
            log "Socket alive - instant response"
            exit 0
        fi
    fi

    STATE=$(get_container_state)
    log "Container state: $STATE"

    # VERSION CHECK before using any existing container
    if [ -n "$STATE" ] && [ "$STATE" != "" ]; then
        if ! version_matches; then
            log "Container exists but OLD VERSION - killing and rebuilding..."
            kill_old_version
            STATE=""  # Force cold start
        fi
    fi

    case "$STATE" in
        "running")
            # Running but socket not responding - wait a moment
            log "Container running, waiting for socket..."
            for i in {1..10}; do
                sleep 0.5
                if socket_alive; then
                    log "Socket became alive"
                    exit 0
                fi
            done
            # Still not responding - restart
            log "Socket not responding, restarting container..."
            rm -f "$SOCKET_PATH"
            docker restart "$CONTAINER_NAME" >> "$LOG_FILE" 2>&1
            # Feed overflow after restart
            if wait_for_socket; then
                feed_overflow
            fi
            ;;

        "paused")
            # INSTANT RESUME - this is the magic
            log "Unpausing container (instant resume)..."
            rm -f "$SOCKET_PATH"
            docker unpause "$CONTAINER_NAME" >> "$LOG_FILE" 2>&1
            # Feed overflow queue after unpause
            if wait_for_socket; then
                feed_overflow
            fi
            ;;

        "exited"|"created")
            # Start stopped container - fast because model is cached in image layers
            log "Starting stopped container..."
            rm -f "$SOCKET_PATH"
            docker start "$CONTAINER_NAME" >> "$LOG_FILE" 2>&1
            # Feed overflow after start
            if wait_for_socket; then
                feed_overflow
            fi
            ;;

        *)
            # No container - cold start (only happens once per version)
            log "Creating new container (cold start) with version $SPECMEM_VERSION..."
            rm -f "$SOCKET_PATH"

            # Remove any old container with same name
            docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

            # Create and run with network disabled (air-gapped security)
            # Mount socket directory for access (per-project or /tmp for machine-shared)
            # CRITICAL: Add specmem.version label!

            # Determine mount strategy
            if [ "$SOCKET_DIR" = "/tmp" ]; then
                MOUNT_ARGS="-v /tmp:/tmp"
            else
                # Per-project socket - mount both the socket dir AND /tmp (for other needs)
                MOUNT_ARGS="-v $SOCKET_DIR:$SOCKET_DIR -v /tmp:/tmp"
            fi

            docker run -d \
                --name "$CONTAINER_NAME" \
                --network none \
                --restart unless-stopped \
                --cpus="$CPU_LIMIT" \
                $MOUNT_ARGS \
                -e "SOCKET_PATH=$SOCKET_PATH" \
                -e "SPECMEM_EMBEDDING_SOCKET=$SOCKET_PATH" \
                -e "SPECMEM_SOCKET_DIR=$SOCKET_DIR" \
                -e "SPECMEM_PROJECT_PATH=${SPECMEM_PROJECT_PATH:-}" \
                -l "specmem.user=$USER_ID" \
                -l "specmem.version=$SPECMEM_VERSION" \
                -l "specmem.created=$(date +%s)" \
                -l "specmem.socket=$SOCKET_PATH" \
                "$IMAGE_NAME" >> "$LOG_FILE" 2>&1

            # Wait and do COLD START feed (full database)
            if wait_for_socket; then
                feed_cold_start
            fi
            ;;
    esac

    exit 0
}

# Wait for socket to become available
wait_for_socket() {
    log "Waiting for socket..."
    for i in {1..60}; do
        if socket_alive; then
            log "Socket ready after ${i}s"
            return 0
        fi
        sleep 1
    done

    log "ERROR: Socket never became ready"
    return 1
}

main
