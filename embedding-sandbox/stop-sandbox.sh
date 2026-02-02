#!/bin/bash
# ============================================
# SPECMEM EMBEDDING SANDBOX STOPPER
# ============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPECMEM_HOME="${SPECMEM_HOME:-$(dirname "$SCRIPT_DIR")}"
SPECMEM_RUN_DIR="${SPECMEM_RUN_DIR:-${SPECMEM_HOME}/run}"
SPECMEM_SOCKET_DIR="${SPECMEM_SOCKET_DIR:-${SPECMEM_RUN_DIR}}"

# PROJECT ISOLATION: Derive container name from project directory name
# Priority: SPECMEM_PROJECT_DIR_NAME env > computed from SPECMEM_PROJECT_PATH > computed from cwd
# This matches TypeScript implementation for human-readable container names
if [ -n "$SPECMEM_PROJECT_DIR_NAME" ]; then
    PROJECT_DIR_NAME="$SPECMEM_PROJECT_DIR_NAME"
else
    PROJECT_PATH="${SPECMEM_PROJECT_PATH:-$(pwd)}"
    RESOLVED_PATH=$(cd "$PROJECT_PATH" 2>/dev/null && pwd || echo "$PROJECT_PATH")
    # Get directory basename and sanitize for Docker naming
    PROJECT_DIR_NAME=$(basename "$RESOLVED_PATH" | tr '[:upper:]' '[:lower:]' | tr '_' '-' | tr -cd 'a-z0-9-')
    # Fallback to hash if name is empty
    if [ -z "$PROJECT_DIR_NAME" ] || [ ${#PROJECT_DIR_NAME} -lt 2 ]; then
        PROJECT_DIR_NAME=$(echo -n "$RESOLVED_PATH" | sha256sum | cut -c1-12)
    fi
fi

CONTAINER_NAME="specmem-embedding-${PROJECT_DIR_NAME}"
SOCKET_PATH="${SPECMEM_SOCKET_DIR}/embeddings.sock"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Stopping embedding sandbox..."

# Stop and remove container
if docker ps -q -f name="${CONTAINER_NAME}" | grep -q .; then
    docker stop "${CONTAINER_NAME}" > /dev/null 2>&1
    echo -e "${GREEN}Container stopped${NC}"
else
    echo -e "${YELLOW}Container was not running${NC}"
fi

# Clean up socket
if [ -S "${SOCKET_PATH}" ]; then
    rm -f "${SOCKET_PATH}"
    echo "Socket removed"
fi

echo "Done"
