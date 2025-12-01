# SpecMem Embedding Sandbox

Air-gapped embedding service for SpecMem. Provides real ML embeddings using the `all-MiniLM-L6-v2` model with **zero network access**.

## Why Air-Gapped?

**Security First.** The embedding model runs in a Docker container with:

- **`--network none`**: Absolutely no network access. Cannot phone home.
- **`--read-only`**: Read-only root filesystem. Cannot write to disk.
- **`--cap-drop ALL`**: No Linux capabilities. Minimal privileges.
- **`--security-opt no-new-privileges`**: Cannot escalate privileges.
- **Non-root user**: Runs as unprivileged `embed` user.
- **Unix socket only**: No TCP ports. Communication via local socket only.

This means the embedding service:
- Cannot send your data anywhere
- Cannot download anything at runtime
- Cannot modify its own code
- Cannot access your filesystem
- Can ONLY receive text and return embeddings

## Architecture

```
+------------------+        Unix Socket         +------------------+
|                  |  ${SPECMEM_SOCKET_DIR}/    |                  |
|  SpecMem Server  | ----------------------->   |  Sandbox         |
|  (Node.js)       |   embeddings.sock          |  Container       |
|                  | <-----------------------   |  (Docker)        |
|                  |    384-dim vectors         |                  |
+------------------+                            +------------------+
                                                       |
                                                       | --network none
                                                       | --read-only
                                                       | --cap-drop ALL
                                                       v
                                                   [NO NETWORK]
```

## Quick Start

### 1. Start the Sandbox

```bash
./start-sandbox.sh
```

This will:
1. Build the Docker image
2. Download the model (~23MB) to a Docker volume
3. Start the container with all security restrictions
4. Create the Unix socket at `${SPECMEM_HOME}/run/embeddings.sock`

### 2. Stop the Sandbox

```bash
./stop-sandbox.sh
```

Or manually:
```bash
docker stop specmem-embedding
```

### 3. View Logs

```bash
docker logs specmem-embedding
docker logs -f specmem-embedding  # Follow mode
```

## Pre-downloading the Model

The model is automatically downloaded on first run. To pre-download manually:

```bash
# Create the volume
docker volume create specmem-model-cache

# Build the image
docker build -t specmem-embedding .

# Download the model (requires network)
docker run --rm \
  -v specmem-model-cache:/home/embed/.cache \
  specmem-embedding \
  node download-model.mjs
```

After this, the container can run fully air-gapped.

## Model Details

- **Model**: `Xenova/all-MiniLM-L6-v2` (ONNX version)
- **Dimensions**: 384
- **Size**: ~23MB
- **Library**: `@huggingface/transformers` (browser/Node.js inference)

This is the same architecture as sentence-transformers but runs locally without Python.

## Integration with SpecMem

The client in `client.ts` handles:

1. Checking if the sandbox socket exists
2. Sending text to the sandbox for embedding
3. Falling back to hash-based embeddings if sandbox unavailable

```typescript
import { getSandboxedEmbeddingClient } from './embedding-sandbox/client.js';

const client = getSandboxedEmbeddingClient();

// Automatically uses sandbox if available, hash fallback otherwise
const embedding = await client.generateEmbedding("Hello world");
```

## Socket Protocol

The sandbox uses newline-delimited JSON over Unix socket:

**Request:**
```json
{"type": "embed", "text": "Your text here"}\n
```

**Response:**
```json
{"embedding": [0.123, -0.456, ...], "dimension": 384, "model": "Xenova/all-MiniLM-L6-v2"}\n
```

**Error:**
```json
{"error": "Error message"}\n
```

## Troubleshooting

### Socket not found

```bash
# Check if container is running
docker ps | grep specmem-embedding

# Check socket directory
ls -la /tmp/specmem-sockets/

# Restart the sandbox
./stop-sandbox.sh && ./start-sandbox.sh
```

### Model not loading

```bash
# Check container logs
docker logs specmem-embedding

# Re-download model
docker volume rm specmem-model-cache
./start-sandbox.sh
```

### Permission denied on socket

```bash
# Fix socket directory permissions
sudo chmod 755 /tmp/specmem-sockets
```

## Security Verification

Verify the container has no network:

```bash
# Try to ping from inside container (should fail)
docker exec specmem-embedding ping -c 1 google.com
# Expected: ping: bad address 'google.com'

# Check network settings
docker inspect specmem-embedding | grep -A 10 "NetworkSettings"
# Should show "NetworkMode": "none"
```

## Files

- `Dockerfile` - Container configuration
- `server.mjs` - Embedding server (runs inside container)
- `download-model.mjs` - Model pre-download script
- `client.ts` - TypeScript client for SpecMem
- `start-sandbox.sh` - Start the sandbox
- `stop-sandbox.sh` - Stop the sandbox
- `package.json` - Dependencies
