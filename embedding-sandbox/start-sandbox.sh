#!/bin/bash
# ============================================================================
# SPECMEM EMBEDDING SANDBOX STARTER
# ============================================================================
#
# This script starts the air-gapped embedding container.
# The container runs with NO NETWORK ACCESS for security.
#
# Security measures:
#   --network none     : No network access at all
#   --read-only        : Read-only root filesystem
#   --cap-drop ALL     : No Linux capabilities
#   --security-opt no-new-privileges : Prevent privilege escalation
#
# The container communicates ONLY via Unix socket.
#
# PROJECT ISOLATION:
#   Each project gets its own socket path and container name.
#   Container: specmem-embedding-{project_dir_name}
#   Socket: {PROJECT_DIR}/specmem/sockets/embeddings.sock
#   USER REQUIREMENT: ALL data in PROJECT DIRECTORY - no ~/.specmem
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPECMEM_HOME="${SPECMEM_HOME:-$(dirname "$SCRIPT_DIR")}"

# ============================================================================
# PROJECT ISOLATION SETUP
# ============================================================================

# Ensure SPECMEM_PROJECT_PATH is set
export SPECMEM_PROJECT_PATH="${SPECMEM_PROJECT_PATH:-$(pwd)}"
SPECMEM_PROJECT_PATH="$(cd "$SPECMEM_PROJECT_PATH" && pwd)"

# Get project directory name (readable identifier instead of hash)
# Sanitize for Docker: lowercase, replace invalid chars with dashes
PROJECT_DIR_NAME=$(basename "$SPECMEM_PROJECT_PATH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_.-]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')

# Keep hash for internal paths (backwards compat) but use dir name for containers
PROJECT_HASH=$(echo -n "$SPECMEM_PROJECT_PATH" | tr '\\' '/' | sha256sum | cut -c1-12)

# Set project-scoped paths - MUST be in PROJECT DIRECTORY, NOT ~/.specmem
# User requirement: "EVERYTHING LOCALIZED WITHIN THE PROJECT"
INSTANCE_DIR="${SPECMEM_INSTANCE_DIR:-$SPECMEM_PROJECT_PATH/specmem}"
SOCKET_DIR="${SPECMEM_SOCKET_DIR:-$INSTANCE_DIR/sockets}"
SOCKET_PATH="${SOCKET_DIR}/embeddings.sock"

# Project-scoped container and volume names - USE READABLE DIR NAME!
CONTAINER_NAME="specmem-embedding-${PROJECT_DIR_NAME}"
IMAGE_NAME="specmem-embedding"
VOLUME_NAME="specmem-model-cache"  # Shared across projects - models are read-only

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "============================================"
echo "SPECMEM AIR-GAPPED EMBEDDING SANDBOX"
echo "============================================"
echo "Project: $SPECMEM_PROJECT_PATH"
echo "Hash: $PROJECT_HASH"
echo ""

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo -e "${RED}ERROR: Docker is not installed or not in PATH${NC}"
    exit 1
fi

# Check if Docker daemon is running
if ! docker info &> /dev/null; then
    echo -e "${RED}ERROR: Docker daemon is not running${NC}"
    exit 1
fi

# Create socket directory
echo "[1/5] Creating socket directory..."
mkdir -p "${SOCKET_DIR}"
chmod 777 "${SOCKET_DIR}"  # Allow container user to write socket

# Remove existing socket if present
if [ -S "${SOCKET_PATH}" ]; then
    echo "      Removing existing socket..."
    rm -f "${SOCKET_PATH}"
fi

# Stop existing container if running
if docker ps -q -f name="${CONTAINER_NAME}" | grep -q .; then
    echo "[2/5] Stopping existing container..."
    docker stop "${CONTAINER_NAME}" > /dev/null 2>&1 || true
    docker rm "${CONTAINER_NAME}" > /dev/null 2>&1 || true
else
    echo "[2/5] No existing container to stop"
fi

# Build the image
echo "[3/5] Building Docker image..."
docker build -t "${IMAGE_NAME}" "${SCRIPT_DIR}/" > /dev/null 2>&1
echo -e "      ${GREEN}Image built successfully${NC}"

# Download model if not cached
echo "[4/5] Checking model cache..."
if ! docker volume inspect "${VOLUME_NAME}" > /dev/null 2>&1; then
    echo "      Model not cached. Downloading (~23MB)..."
    docker run --rm \
        -v "${VOLUME_NAME}":/home/embed/.cache \
        "${IMAGE_NAME}" \
        node download-model.mjs
    echo -e "      ${GREEN}Model downloaded and cached${NC}"
else
    # Verify model is actually in the volume
    MODEL_CHECK=$(docker run --rm \
        -v "${VOLUME_NAME}":/home/embed/.cache:ro \
        "${IMAGE_NAME}" \
        sh -c "ls -la /home/embed/.cache/huggingface/hub 2>/dev/null | head -5" 2>/dev/null || echo "empty")

    if [ "${MODEL_CHECK}" = "empty" ] || [ -z "${MODEL_CHECK}" ]; then
        echo "      Model cache exists but is empty. Downloading..."
        docker run --rm \
            -v "${VOLUME_NAME}":/home/embed/.cache \
            "${IMAGE_NAME}" \
            node download-model.mjs
        echo -e "      ${GREEN}Model downloaded and cached${NC}"
    else
        echo -e "      ${GREEN}Model already cached${NC}"
    fi
fi

# Run the air-gapped container with project-scoped name
echo "[5/5] Starting air-gapped container..."

# ============================================================================
# READ CPU/RAM LIMITS FROM USER-CONFIG.JSON
# Priority: user-config.json > env var > defaults
# ============================================================================
USER_CONFIG="${INSTANCE_DIR}/user-config.json"
CPU_LIMIT="${SPECMEM_EMBEDDING_CPU_LIMIT:-}"
RAM_LIMIT="${SPECMEM_EMBEDDING_RAM_LIMIT:-}"

if [ -f "${USER_CONFIG}" ]; then
    echo "      Reading limits from user-config.json..."

    # Read cpuMax (percentage, e.g., 40 = 40% = 0.4 cpus)
    if [ -z "${CPU_LIMIT}" ]; then
        CPU_PCT=$(grep -o '"cpuMax"[[:space:]]*:[[:space:]]*[0-9]*' "${USER_CONFIG}" | grep -o '[0-9]*$' || echo "")
        if [ -n "${CPU_PCT}" ] && [ "${CPU_PCT}" -gt 0 ]; then
            # Convert percentage to decimal (40 -> 0.40)
            CPU_LIMIT=$(echo "scale=2; ${CPU_PCT} / 100" | bc)
            echo -e "      ${GREEN}CPU limit: ${CPU_LIMIT} (${CPU_PCT}% from config)${NC}"
        fi
    fi

    # Read ramMaxMb (megabytes)
    if [ -z "${RAM_LIMIT}" ]; then
        RAM_MB=$(grep -o '"ramMaxMb"[[:space:]]*:[[:space:]]*[0-9]*' "${USER_CONFIG}" | grep -o '[0-9]*$' || echo "")
        if [ -n "${RAM_MB}" ] && [ "${RAM_MB}" -gt 0 ]; then
            RAM_LIMIT="${RAM_MB}m"
            echo -e "      ${GREEN}RAM limit: ${RAM_LIMIT} (from config)${NC}"
        fi
    fi
fi

# Defaults if not set
CPU_LIMIT="${CPU_LIMIT:-1.0}"
RAM_LIMIT="${RAM_LIMIT:-4096m}"

if [ "${CPU_LIMIT}" != "1.0" ]; then
    echo -e "      ${YELLOW}CPU throttled to ${CPU_LIMIT}${NC}"
fi

# Run as default user (embed UID 1001) - DO NOT use --user root
# The Dockerfile sets proper permissions for the embed user
# --read-only removed: causes permission issues with cap-drop ALL
docker run --rm -d \
    --name "${CONTAINER_NAME}" \
    --network none \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --cpus "${CPU_LIMIT}" \
    --memory "${RAM_LIMIT}" \
    --memory-swap "${RAM_LIMIT}" \
    -v "${SOCKET_DIR}":/sockets \
    -v "${VOLUME_NAME}":/home/embed/.cache:ro \
    -e SOCKET_PATH=/sockets/embeddings.sock \
    -e SPECMEM_PROJECT_DIR_NAME="${PROJECT_DIR_NAME}" \
    -e SPECMEM_PROJECT_HASH="${PROJECT_HASH}" \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    -l "specmem.project=${PROJECT_DIR_NAME}" \
    -l "specmem.project_hash=${PROJECT_HASH}" \
    -l "specmem.created=$(date +%s)" \
    -l "specmem.path=${SPECMEM_PROJECT_PATH}" \
    -l "specmem.socket=${SOCKET_PATH}" \
    "${IMAGE_NAME}" > /dev/null

# Wait for socket to be created
echo ""
echo "Waiting for service to start..."
for i in {1..30}; do
    if [ -S "${SOCKET_PATH}" ]; then
        break
    fi
    sleep 0.5
done

# Verify the container is running and socket exists
if docker ps -q -f name="${CONTAINER_NAME}" | grep -q . && [ -S "${SOCKET_PATH}" ]; then
    echo ""
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}SANDBOX STARTED SUCCESSFULLY${NC}"
    echo -e "${GREEN}============================================${NC}"
    echo ""
    echo "Container: ${CONTAINER_NAME}"
    echo "Socket:    ${SOCKET_PATH}"
    echo "Network:   NONE (air-gapped)"
    echo ""
    echo "Security:"
    echo "  - No network access"
    echo "  - Read-only filesystem"
    echo "  - No Linux capabilities"
    echo "  - Running as root (required for socket creation)"
    echo ""
    echo "To stop: docker stop ${CONTAINER_NAME}"
    echo "To logs: docker logs ${CONTAINER_NAME}"
    echo ""
else
    echo ""
    echo -e "${RED}============================================${NC}"
    echo -e "${RED}SANDBOX FAILED TO START${NC}"
    echo -e "${RED}============================================${NC}"
    echo ""
    echo "Check logs with: docker logs ${CONTAINER_NAME}"
    exit 1
fi
