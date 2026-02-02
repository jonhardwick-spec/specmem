#!/bin/bash
#############################################
# SPECMEM EMBEDDING RAM MANAGER
# =============================
#
# Intelligent RAM management for embedding container:
# - Base limit: 250MB
# - Scale to 500MB if needed
# - Auto-restart on OOM
# - Use whatever's available if not enough RAM
#
# This is SELF-CONTAINED - no external deps
#############################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPECMEM_HOME="${SPECMEM_HOME:-$(dirname "$SCRIPT_DIR")}"
SPECMEM_RUN_DIR="${SPECMEM_RUN_DIR:-${SPECMEM_HOME}/run}"
SPECMEM_SOCKET_DIR="${SPECMEM_SOCKET_DIR:-${SPECMEM_RUN_DIR}}"

# PROJECT ISOLATION: Derive container name from project directory name
# Priority: SPECMEM_PROJECT_DIR_NAME env > computed from SPECMEM_PROJECT_PATH > computed from cwd
# This matches the TypeScript implementation for human-readable container names
if [ -n "$SPECMEM_PROJECT_DIR_NAME" ]; then
    PROJECT_DIR_NAME="$SPECMEM_PROJECT_DIR_NAME"
else
    PROJECT_PATH="${SPECMEM_PROJECT_PATH:-$(pwd)}"
    RESOLVED_PATH=$(cd "$PROJECT_PATH" 2>/dev/null && pwd || echo "$PROJECT_PATH")
    # Get the directory basename and sanitize for Docker naming
    PROJECT_DIR_NAME=$(basename "$RESOLVED_PATH" | tr '[:upper:]' '[:lower:]' | tr '_' '-' | tr -cd 'a-z0-9-')
    # Fallback to hash if name is empty
    if [ -z "$PROJECT_DIR_NAME" ] || [ ${#PROJECT_DIR_NAME} -lt 2 ]; then
        PROJECT_DIR_NAME=$(echo -n "$RESOLVED_PATH" | sha256sum | cut -c1-12)
    fi
fi

CONTAINER_NAME="specmem-embedding-${PROJECT_DIR_NAME}"
IMAGE_NAME="specmem-embedding:latest"
SOCKET_DIR="${SPECMEM_SOCKET_DIR}"
SOCKET_PATH="$SOCKET_DIR/embeddings.sock"

# RAM settings (in MB)
# all-MiniLM-L6-v2 needs ~350MB for inference
BASE_RAM=400
MAX_RAM=600
CURRENT_RAM=$BASE_RAM

# State file for tracking RAM level
STATE_FILE="$SOCKET_DIR/.ram-state"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[RAM-MGR]${NC} $(date '+%H:%M:%S') $1"
}

warn() {
    echo -e "${YELLOW}[RAM-MGR]${NC} $(date '+%H:%M:%S') $1"
}

err() {
    echo -e "${RED}[RAM-MGR]${NC} $(date '+%H:%M:%S') $1"
}

# Get available system RAM in MB
get_available_ram() {
    free -m | awk '/^Mem:/ {print $7}'
}

# Get current container memory usage (%)
get_container_memory_percent() {
    docker stats --no-stream --format "{{.MemPerc}}" $CONTAINER_NAME 2>/dev/null | tr -d '%' || echo "0"
}

# Determine optimal RAM limit based on system availability
calculate_ram_limit() {
    local available=$(get_available_ram)
    local requested=$1

    # Reserve 500MB for system
    local usable=$((available - 500))

    if [ $usable -lt 100 ]; then
        err "System critically low on RAM! Available: ${available}MB"
        # Use whatever we can get (min 100MB)
        echo 100
        return
    fi

    if [ $usable -lt $requested ]; then
        warn "Not enough RAM for ${requested}MB, using ${usable}MB"
        echo $usable
    else
        echo $requested
    fi
}

# Stop and remove container
stop_container() {
    log "Stopping container..."
    docker stop $CONTAINER_NAME 2>/dev/null || true
    docker rm $CONTAINER_NAME 2>/dev/null || true
}

# Start container with specified RAM limit
start_container() {
    local ram_mb=$1

    log "Starting container with ${ram_mb}MB RAM limit..."

    mkdir -p $SOCKET_DIR
    rm -f $SOCKET_PATH

    # Calculate swap (same as RAM for emergency buffer)
    local swap_mb=$((ram_mb * 2))

    docker run -d \
        --name $CONTAINER_NAME \
        --network none \
        --read-only \
        --cap-drop ALL \
        --memory="${ram_mb}m" \
        --memory-swap="${swap_mb}m" \
        --memory-reservation="$((ram_mb / 2))m" \
        --oom-kill-disable=false \
        --restart=no \
        -v "$SOCKET_DIR:/sockets:rw" \
        -e SOCKET_PATH=/sockets/embeddings.sock \
        --tmpfs /tmp:rw,size=50m,mode=1777 \
        --health-cmd="test -S /sockets/embeddings.sock" \
        --health-interval=10s \
        --health-timeout=5s \
        --health-retries=3 \
        -l "specmem.project=$PROJECT_DIR_NAME" \
        -l "specmem.created=$(date +%s)" \
        -l "specmem.path=${SPECMEM_PROJECT_PATH:-$(pwd)}" \
        $IMAGE_NAME

    # Save current RAM state
    echo $ram_mb > $STATE_FILE
    CURRENT_RAM=$ram_mb

    # Wait for socket
    local retries=0
    while [ ! -S $SOCKET_PATH ] && [ $retries -lt 30 ]; do
        sleep 1
        retries=$((retries + 1))
    done

    if [ -S $SOCKET_PATH ]; then
        log "Container started successfully with ${ram_mb}MB"
        return 0
    else
        err "Container failed to create socket!"
        return 1
    fi
}

# Double RAM limit (intelligent scaling)
double_ram() {
    local current=$1
    local new_ram=$((current * 2))

    if [ $new_ram -gt $MAX_RAM ]; then
        new_ram=$MAX_RAM
    fi

    local actual=$(calculate_ram_limit $new_ram)

    if [ $actual -le $current ]; then
        warn "Can't scale up - not enough system RAM"
        return 1
    fi

    log "Scaling RAM: ${current}MB -> ${actual}MB"
    stop_container
    start_container $actual
}

# Monitor container and handle OOM
monitor() {
    log "Starting RAM monitor (base: ${BASE_RAM}MB, max: ${MAX_RAM}MB)"

    local oom_count=0
    local last_restart=$(date +%s)

    while true; do
        sleep 5

        # Check if container is running
        if ! docker ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
            local exit_code=$(docker inspect --format='{{.State.ExitCode}}' $CONTAINER_NAME 2>/dev/null || echo "unknown")
            local oom_killed=$(docker inspect --format='{{.State.OOMKilled}}' $CONTAINER_NAME 2>/dev/null || echo "false")

            if [ "$oom_killed" = "true" ]; then
                warn "Container was OOM killed!"
                oom_count=$((oom_count + 1))

                # Load current RAM level
                if [ -f $STATE_FILE ]; then
                    CURRENT_RAM=$(cat $STATE_FILE)
                fi

                # Try to scale up if we haven't hit max
                if [ $CURRENT_RAM -lt $MAX_RAM ]; then
                    log "Attempting to scale up after OOM..."
                    double_ram $CURRENT_RAM
                else
                    # Already at max, just restart
                    warn "Already at max RAM, restarting with same limit..."
                    stop_container
                    start_container $CURRENT_RAM
                fi
            else
                # Container died for other reason
                err "Container died (exit: $exit_code), restarting..."
                stop_container
                start_container $CURRENT_RAM
            fi

            last_restart=$(date +%s)
        fi

        # Check memory pressure
        local mem_pct=$(get_container_memory_percent)
        mem_pct=${mem_pct%.*}  # Remove decimal

        if [ -n "$mem_pct" ] && [ "$mem_pct" -gt 85 ] 2>/dev/null; then
            warn "High memory pressure: ${mem_pct}%"

            # If we have room to scale and haven't recently restarted
            local now=$(date +%s)
            local since_restart=$((now - last_restart))

            if [ $CURRENT_RAM -lt $MAX_RAM ] && [ $since_restart -gt 60 ]; then
                log "Proactively scaling up due to memory pressure..."
                double_ram $CURRENT_RAM
                last_restart=$(date +%s)
            fi
        fi
    done
}

# Initial startup
start() {
    log "SpecMem Embedding RAM Manager starting..."

    # Stop any existing container
    stop_container

    # Calculate initial RAM
    local initial_ram=$(calculate_ram_limit $BASE_RAM)

    # Start container
    start_container $initial_ram

    log "Container running. Testing embedding..."

    # Quick test
    sleep 2
    if echo '{"type":"embed","text":"test"}' | timeout 10 nc -U $SOCKET_PATH | grep -q "embedding"; then
        log "Embedding test PASSED"
    else
        warn "Embedding test failed, but container is running"
    fi
}

# CLI
case "${1:-start}" in
    start)
        start
        ;;
    monitor)
        start
        monitor
        ;;
    stop)
        stop_container
        log "Container stopped"
        ;;
    restart)
        stop_container
        start
        ;;
    scale)
        if [ -f $STATE_FILE ]; then
            CURRENT_RAM=$(cat $STATE_FILE)
        fi
        double_ram $CURRENT_RAM
        ;;
    status)
        if docker ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
            log "Container is RUNNING"
            docker stats --no-stream $CONTAINER_NAME
            if [ -f $STATE_FILE ]; then
                log "RAM limit: $(cat $STATE_FILE)MB"
            fi
        else
            err "Container is NOT running"
        fi
        ;;
    *)
        echo "Usage: $0 {start|monitor|stop|restart|scale|status}"
        exit 1
        ;;
esac
