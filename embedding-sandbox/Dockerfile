# ============================================
# SPECMEM SANDBOXED EMBEDDING SERVICE
# ============================================
#
# SECURITY ARCHITECTURE:
#   - NO NETWORK ACCESS (run with --network none)
#   - Read-only root filesystem
#   - No capabilities (--cap-drop ALL)
#   - Runs as non-root user
#   - Only Unix socket communication
#   - Model weights pre-downloaded (no runtime network)
#
# Build:
#   docker build -t specmem-embedding .
#
# Run (AIR-GAPPED):
#   docker run --rm \
#     --network none \
#     --read-only \
#     --cap-drop ALL \
#     --security-opt no-new-privileges \
#     -v /tmp/specmem-sockets:/sockets \
#     -e SOCKET_PATH=/sockets/embeddings.sock \
#     specmem-embedding
#
# ============================================

FROM node:20-slim

# Create non-root user with minimal permissions
RUN useradd --create-home --shell /bin/false embed && \
    mkdir -p /home/embed/.cache/huggingface && \
    chown -R embed:embed /home/embed

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies (network needed during build only)
RUN npm install --production && \
    npm cache clean --force && \
    rm -rf /root/.npm

# Copy application code
COPY server.mjs download-model.mjs ./

# Set environment for model download
ENV HF_HOME=/home/embed/.cache/huggingface
ENV XDG_CACHE_HOME=/home/embed/.cache

# Download model during build (this is the key step!)
# Model will be baked into the image
RUN node download-model.mjs && \
    echo "Model downloaded and baked into image"

# Change ownership
RUN chown -R embed:embed /app /home/embed/.cache

# Switch to non-root user
USER embed

# Environment
ENV NODE_ENV=production
ENV SOCKET_PATH=/sockets/embeddings.sock
ENV HF_HOME=/home/embed/.cache/huggingface
ENV XDG_CACHE_HOME=/home/embed/.cache

# Health check via socket existence (uses SOCKET_PATH env var set at runtime)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD test -S "${SOCKET_PATH:-/sockets/embeddings.sock}" || exit 1

# No network, no capabilities, read-only - these are enforced at runtime
# via docker run flags, not in the Dockerfile

CMD ["node", "server.mjs"]
