#!/bin/bash
# ============================================================================
# Frankenstein Embeddings - Throttled Mode
# ============================================================================
# Uses cpulimit for hard CPU throttling without Docker
#
# PROJECT ISOLATION:
#   Each project gets its own socket path at:
#   ~/.specmem/instances/{project_dir_name}/sockets/frankenstein.sock
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
OVERFLOW_DIR="${SPECMEM_OVERFLOW_DIR:-$INSTANCE_DIR/overflow}"

# ============================================================================
# CONFIGURATION
# ============================================================================

CPU_LIMIT=20
MAX_RPS=3
BASE_DELAY=200
CPU_THRESHOLD=15
SOCKET_PATH="${SOCKET_DIR}/frankenstein.sock"

cd "$SCRIPT_DIR"

echo "========================================"
echo "Frankenstein Embeddings (THROTTLED MODE)"
echo "========================================"
echo "Project: $SPECMEM_PROJECT_PATH"
echo "Hash: $PROJECT_HASH"
echo ""
echo "CPU Limit: ${CPU_LIMIT}%"
echo "Max RPS: ${MAX_RPS}"
echo "Base Delay: ${BASE_DELAY}ms"
echo "Socket: ${SOCKET_PATH}"
echo ""

# Create directories
mkdir -p "${SOCKET_DIR}"
mkdir -p "${OVERFLOW_DIR}"

# Export for Python script
export SPECMEM_SOCKET_DIR="${SOCKET_DIR}"
export SPECMEM_OVERFLOW_DIR="${OVERFLOW_DIR}"
export SPECMEM_PROJECT_HASH="${PROJECT_HASH}"

# Check if cpulimit is installed
if command -v cpulimit &> /dev/null; then
    echo "Using cpulimit for hard CPU throttle..."

    # Start the process in background
    python3 frankenstein-embeddings.py \
        --socket "$SOCKET_PATH" \
        --max-rps "$MAX_RPS" \
        --base-delay "$BASE_DELAY" \
        --cpu-threshold "$CPU_THRESHOLD" &

    PID=$!
    echo "Started Frankenstein with PID: $PID"

    # Apply cpulimit
    sleep 2
    cpulimit -p $PID -l $CPU_LIMIT -b
    echo "Applied ${CPU_LIMIT}% CPU limit to PID $PID"

    # Wait for process
    wait $PID
else
    echo "cpulimit not installed, using internal QQMS throttling only..."

    # Run directly with aggressive internal throttling
    python3 frankenstein-embeddings.py \
        --socket "$SOCKET_PATH" \
        --max-rps "$MAX_RPS" \
        --base-delay "$BASE_DELAY" \
        --cpu-threshold "$CPU_THRESHOLD"
fi
