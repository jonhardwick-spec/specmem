#!/bin/bash
# Quick start: Run embedding server with auto-restart supervision
# Usage: ./start-supervised.sh [project_path]

PROJECT_PATH="${1:-${SPECMEM_PROJECT_PATH:-$(pwd)}}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Run supervisor in background
nohup "$SCRIPT_DIR/embedding-supervisor.sh" "$PROJECT_PATH" > /dev/null 2>&1 &
echo "Embedding supervisor started for: $PROJECT_PATH"
echo "Logs: ${PROJECT_PATH}/specmem/sockets/supervisor.log"
