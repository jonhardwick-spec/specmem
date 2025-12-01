#!/bin/bash
# ============================================================================
# SpecMem Project Environment Helper
# ============================================================================
# Source this script to set up project-scoped environment variables.
# This ensures all SpecMem components use the same isolation paths.
#
# Usage:
#   source /path/to/project-env.sh
#   # or
#   . /path/to/project-env.sh
#
# After sourcing:
#   - SPECMEM_PROJECT_PATH: Absolute path to the project
#   - SPECMEM_PROJECT_HASH: 12-char hash for directory naming
#   - SPECMEM_INSTANCE_DIR: Per-project instance directory
#   - SPECMEM_SOCKET_DIR: Socket directory for this instance
#   - SPECMEM_LOG_DIR: Log directory for this instance
#   - SPECMEM_OVERFLOW_DIR: Overflow queue directory
# ============================================================================

# Resolve project path (default to current working directory)
export SPECMEM_PROJECT_PATH="${SPECMEM_PROJECT_PATH:-$(pwd)}"
SPECMEM_PROJECT_PATH="$(cd "$SPECMEM_PROJECT_PATH" && pwd)"  # Normalize to absolute path

# Generate project directory name (human-readable, for container names)
# This matches TypeScript instanceManager.ts for readable Docker containers
SPECMEM_PROJECT_DIR_NAME=$(basename "$SPECMEM_PROJECT_PATH" | tr '[:upper:]' '[:lower:]' | tr '_' '-' | tr -cd 'a-z0-9-')
# Remove leading/trailing hyphens and collapse multiple hyphens
SPECMEM_PROJECT_DIR_NAME=$(echo "$SPECMEM_PROJECT_DIR_NAME" | sed 's/--*/-/g; s/^-//; s/-$//')
# Fallback to hash if name is empty or too short
if [ -z "$SPECMEM_PROJECT_DIR_NAME" ] || [ ${#SPECMEM_PROJECT_DIR_NAME} -lt 2 ]; then
    SPECMEM_PROJECT_DIR_NAME=$(echo -n "$SPECMEM_PROJECT_PATH" | sha256sum | cut -c1-12)
fi
export SPECMEM_PROJECT_DIR_NAME

# Generate project hash (first 12 chars of SHA256) - DEPRECATED, kept for backwards compatibility
# This matches the TypeScript constants.ts and bootstrap.cjs hash format (12 chars for consistency)
export SPECMEM_PROJECT_HASH=$(echo -n "$SPECMEM_PROJECT_PATH" | tr '\\' '/' | sha256sum | cut -c1-12)

# Set instance-scoped directories (use dir name for human-readable paths)
export SPECMEM_INSTANCE_DIR="${HOME}/.specmem/instances/${SPECMEM_PROJECT_DIR_NAME}"
export SPECMEM_SOCKET_DIR="${SPECMEM_INSTANCE_DIR}/sockets"
export SPECMEM_LOG_DIR="${SPECMEM_INSTANCE_DIR}/logs"
export SPECMEM_OVERFLOW_DIR="${SPECMEM_INSTANCE_DIR}/overflow"

# Create directories if they don't exist
mkdir -p "$SPECMEM_SOCKET_DIR" "$SPECMEM_LOG_DIR" "$SPECMEM_OVERFLOW_DIR" 2>/dev/null

# Export for child processes
export SPECMEM_PROJECT_PATH SPECMEM_PROJECT_DIR_NAME SPECMEM_PROJECT_HASH SPECMEM_INSTANCE_DIR SPECMEM_SOCKET_DIR SPECMEM_LOG_DIR SPECMEM_OVERFLOW_DIR
