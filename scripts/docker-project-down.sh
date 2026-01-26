#!/bin/bash
# ============================================
# SpecMem Docker Project Down
# ============================================
# Stop Docker services for a specific project
#
# Usage:
#   ./docker-project-down.sh                    # Use current directory
#   SPECMEM_PROJECT_PATH=/path/to/project ./docker-project-down.sh
#   ./docker-project-down.sh --volumes          # Also remove volumes (data loss!)
#
# Environment Variables:
#   SPECMEM_PROJECT_PATH    - Project path (default: current directory)

set -e

# Check for --volumes flag
REMOVE_VOLUMES=""
if [[ "$1" == "--volumes" ]] || [[ "$1" == "-v" ]]; then
    REMOVE_VOLUMES="-v"
    echo "WARNING: --volumes flag set - this will DELETE ALL DATA for this project!"
    echo "Press Ctrl+C within 5 seconds to cancel..."
    sleep 5
fi

# Determine project path and compute identifiers
PROJECT_PATH="${SPECMEM_PROJECT_PATH:-$(pwd)}"
PROJECT_HASH=$(echo -n "$PROJECT_PATH" | sha256sum | cut -c1-12)
# Get project dir name (human-readable) and sanitize for Docker naming
PROJECT_DIR_NAME=$(basename "$PROJECT_PATH" | tr '[:upper:]' '[:lower:]' | tr '_' '-' | tr -cd 'a-z0-9-')
if [ -z "$PROJECT_DIR_NAME" ] || [ ${#PROJECT_DIR_NAME} -lt 2 ]; then
    PROJECT_DIR_NAME="$PROJECT_HASH"
fi

# Export required environment variables
export SPECMEM_PROJECT_HASH="$PROJECT_HASH"
export SPECMEM_PROJECT_DIR_NAME="$PROJECT_DIR_NAME"
export SPECMEM_PROJECT_PATH="$PROJECT_PATH"

# Set default values for other required vars (needed for compose file parsing)
# Use hash for port calculation to avoid conflicts
HASH_NUM=$(printf "%d" "0x${PROJECT_HASH:0:4}" 2>/dev/null || echo "0")
PORT_OFFSET=$((HASH_NUM % 1000))
export SPECMEM_PG_PORT=$((5433 + PORT_OFFSET))
export SPECMEM_COORDINATION_PORT=$((8588 + PORT_OFFSET))
export SPECMEM_DASHBOARD_PORT=$((8589 + PORT_OFFSET))
export SPECMEM_COORDINATION_PORT_HOST=$((8590 + PORT_OFFSET))
export SPECMEM_DASHBOARD_PORT_HOST=$((8591 + PORT_OFFSET))
export SPECMEM_DB_PASSWORD="${SPECMEM_DB_PASSWORD:-${SPECMEM_PASSWORD:-specmem_westayunprofessional}}"
export SPECMEM_DASHBOARD_PASSWORD="${SPECMEM_DASHBOARD_PASSWORD:-${SPECMEM_PASSWORD:-specmem_westayunprofessional}}"
export SPECMEM_LOG_LEVEL="${SPECMEM_LOG_LEVEL:-info}"

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "SpecMem Docker - Project Shutdown"
echo "=========================================="
echo "Project Path: $PROJECT_PATH"
echo "Project Name: $PROJECT_DIR_NAME"
if [[ -n "$REMOVE_VOLUMES" ]]; then
    echo "Mode:         REMOVING VOLUMES (data will be deleted!)"
else
    echo "Mode:         Preserving volumes"
fi
echo "=========================================="

# Change to compose directory and stop services
cd "$COMPOSE_DIR"

# Stop with project-specific compose project name (use dir name for readability)
docker-compose -f docker-compose.project.yml -p "specmem-$PROJECT_DIR_NAME" down $REMOVE_VOLUMES

echo ""
echo "=========================================="
echo "Services stopped for project: $PROJECT_DIR_NAME"
if [[ -n "$REMOVE_VOLUMES" ]]; then
    echo "Volumes have been removed."
else
    echo "Volumes preserved. Data will persist for next startup."
fi
echo "=========================================="
