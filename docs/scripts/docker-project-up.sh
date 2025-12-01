#!/bin/bash
# ============================================
# SpecMem Docker Project Up
# ============================================
# Start Docker services for a specific project
# Creates isolated containers, volumes, and networks
#
# Usage:
#   ./docker-project-up.sh                    # Use current directory
#   SPECMEM_PROJECT_PATH=/path/to/project ./docker-project-up.sh
#
# Environment Variables:
#   SPECMEM_PROJECT_PATH    - Project path (default: current directory)
#   SPECMEM_PASSWORD        - Unified password (default: specmem_westayunprofessional)
#   SPECMEM_DB_PASSWORD     - Database password (default: SPECMEM_PASSWORD)
#   SPECMEM_LOG_LEVEL       - Log level (default: info)

set -e

# Determine project path and compute identifiers
PROJECT_PATH="${SPECMEM_PROJECT_PATH:-$(pwd)}"
PROJECT_HASH=$(echo -n "$PROJECT_PATH" | sha256sum | cut -c1-12)
# Get project dir name (human-readable) and sanitize for Docker naming
PROJECT_DIR_NAME=$(basename "$PROJECT_PATH" | tr '[:upper:]' '[:lower:]' | tr '_' '-' | tr -cd 'a-z0-9-')
if [ -z "$PROJECT_DIR_NAME" ] || [ ${#PROJECT_DIR_NAME} -lt 2 ]; then
    PROJECT_DIR_NAME="$PROJECT_HASH"
fi

# Calculate unique ports based on hash (deterministic to avoid conflicts)
# Convert first 4 chars of hash to a number and use it for port offset
HASH_NUM=$(printf "%d" "0x${PROJECT_HASH:0:4}" 2>/dev/null || echo "0")
PORT_OFFSET=$((HASH_NUM % 1000))

# Export all required environment variables
export SPECMEM_PROJECT_HASH="$PROJECT_HASH"
export SPECMEM_PROJECT_DIR_NAME="$PROJECT_DIR_NAME"
export SPECMEM_PROJECT_PATH="$PROJECT_PATH"
export SPECMEM_PG_PORT=$((5433 + PORT_OFFSET))
export SPECMEM_COORDINATION_PORT=$((8588 + PORT_OFFSET))
export SPECMEM_DASHBOARD_PORT=$((8589 + PORT_OFFSET))
export SPECMEM_COORDINATION_PORT_HOST=$((8590 + PORT_OFFSET))
export SPECMEM_DASHBOARD_PORT_HOST=$((8591 + PORT_OFFSET))

# Use unified password from SPECMEM_PASSWORD or default
export SPECMEM_DB_PASSWORD="${SPECMEM_DB_PASSWORD:-${SPECMEM_PASSWORD:-specmem_westayunprofessional}}"
export SPECMEM_DASHBOARD_PASSWORD="${SPECMEM_DASHBOARD_PASSWORD:-${SPECMEM_PASSWORD:-specmem_westayunprofessional}}"
export SPECMEM_LOG_LEVEL="${SPECMEM_LOG_LEVEL:-info}"

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "SpecMem Docker - Project Startup"
echo "=========================================="
echo "Project Path:      $PROJECT_PATH"
echo "Project Name:      $PROJECT_DIR_NAME"
echo "PostgreSQL Port:   $SPECMEM_PG_PORT"
echo "Coordination Port: $SPECMEM_COORDINATION_PORT_HOST"
echo "Dashboard Port:    $SPECMEM_DASHBOARD_PORT_HOST"
echo "=========================================="

# Change to compose directory and start services
cd "$COMPOSE_DIR"

# Start with project-specific compose project name (use dir name for readability)
docker-compose -f docker-compose.project.yml -p "specmem-$PROJECT_DIR_NAME" up -d

echo ""
echo "=========================================="
echo "Services started successfully!"
echo "=========================================="
echo "PostgreSQL:  localhost:$SPECMEM_PG_PORT"
echo "Dashboard:   http://localhost:$SPECMEM_DASHBOARD_PORT_HOST"
echo "Coordination: http://localhost:$SPECMEM_COORDINATION_PORT_HOST"
echo ""
echo "To view logs:  docker-compose -f docker-compose.project.yml -p specmem-$PROJECT_DIR_NAME logs -f"
echo "To stop:       ./scripts/docker-project-down.sh"
echo "=========================================="
