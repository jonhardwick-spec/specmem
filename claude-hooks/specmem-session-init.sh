#!/bin/bash
# SpecMem Session Init Hook
# Enables MCP tool access for Task-spawned subagents (team members)
#
# This hook runs on SessionStart and writes the magic env var to CLAUDE_ENV_FILE
# so that all Task-spawned agents get access to SpecMem MCP tools.
#
# Works in standalone mode (no PM2 required) - SpecMem runs as stdio MCP server

# Determine SPECMEM_HOME - use env var if set, otherwise detect from script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPECMEM_HOME_DETECTED="${SPECMEM_HOME:-$(dirname "$SCRIPT_DIR")}"

if [ -n "$CLAUDE_ENV_FILE" ]; then
  # Enable MCP tools for subagents (the secret sauce!)
  echo 'export CLAUDE_CODE_ALLOW_MCP_TOOLS_FOR_SUBAGENTS=1' >> "$CLAUDE_ENV_FILE"

  # Set SPECMEM_HOME for hooks - use detected path if not already set
  if [ -z "$SPECMEM_HOME" ]; then
    echo "export SPECMEM_HOME='${SPECMEM_HOME_DETECTED}'" >> "$CLAUDE_ENV_FILE"
  else
    echo "export SPECMEM_HOME='${SPECMEM_HOME}'" >> "$CLAUDE_ENV_FILE"
  fi

  # Set SPECMEM_RUN_DIR for hook state files (project-scoped)
  echo "export SPECMEM_RUN_DIR='${SPECMEM_HOME_DETECTED}/run'" >> "$CLAUDE_ENV_FILE"

  # Ensure run directory exists for state files
  mkdir -p "${SPECMEM_HOME_DETECTED}/run" 2>/dev/null || true
  mkdir -p "${SPECMEM_HOME_DETECTED}/logs" 2>/dev/null || true
fi

exit 0
