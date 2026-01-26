/**
 * SANDBOXED EMBEDDING SERVER - DYNAMIC DIMENSIONS
 *
 * This server runs inside a Docker container with NO NETWORK ACCESS.
 * It can ONLY:
 *   - Receive text via Unix socket
 *   - Return embedding vectors at DATABASE dimension
 *   - Read the pre-downloaded model weights
 *
 * DYNAMIC DIMENSIONS:
 *   - Native dimension detected from model at load time
 *   - Target dimension queried from database or set via protocol
 *   - Embeddings scaled to match database dimension
 *
 * Security measures:
 *   - Docker --network none
 *   - Read-only root filesystem
 *   - No capabilities (--cap-drop ALL)
 *   - Runs as non-root user
 *   - Unix socket only (no TCP)
 */

import { pipeline, env } from '@huggingface/transformers';
import { createServer } from 'net';
import { existsSync, unlinkSync } from 'fs';

// Machine-unique shared socket path - embeddings are stateless so sharing is safe
// Pattern: /tmp/specmem-embed-{uid}.sock
// Single embedding server per user, shared across all projects for efficiency
import { join } from 'path';
import { tmpdir } from 'os';

const getMachineSocketPath = () => {
  // Priority order for socket path:
  // 1. SPECMEM_EMBEDDING_SOCKET - explicit embedding socket path
  if (process.env.SPECMEM_EMBEDDING_SOCKET) {
    return process.env.SPECMEM_EMBEDDING_SOCKET;
  }

  // 2. SPECMEM_SOCKET_DIR - socket directory with embeddings.sock filename
  if (process.env.SPECMEM_SOCKET_DIR) {
    return join(process.env.SPECMEM_SOCKET_DIR, 'embeddings.sock');
  }

  // 3. SPECMEM_PROJECT_PATH - project-specific socket path
  if (process.env.SPECMEM_PROJECT_PATH) {
    return join(process.env.SPECMEM_PROJECT_PATH, 'specmem', 'sockets', 'embeddings.sock');
  }

  // 4. Fallback: machine-unique shared socket (legacy behavior)
  // Use UID for machine-unique but shared socket (not per-project)
  // Embeddings are stateless - one server can serve all projects
  const userId = process.getuid ? process.getuid() : 'default';
  return join(tmpdir(), `specmem-embed-${userId}.sock`);
};

const SOCKET_PATH = process.env.SOCKET_PATH || getMachineSocketPath();
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

// Bundled model: shipped with npm package, used as fallback when HF cache unavailable
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = dirname(__filename_esm);
const BUNDLED_MODEL_DIR = join(__dirname_esm, 'models', 'all-MiniLM-L6-v2');

// Dynamic dimensions - detected from model and database
let NATIVE_DIM = null;
let TARGET_DIM = null;

// Set cache directory explicitly - must match download-model.mjs
const CACHE_DIR = process.env.HF_HOME || '/home/embed/.cache/huggingface';
env.cacheDir = CACHE_DIR;

console.log('[Sandbox] Starting air-gapped embedding server...');
console.log('[Sandbox] NO NETWORK ACCESS - this is intentional');
console.log('[Sandbox] Socket path:', SOCKET_PATH);

// Load the model (from local cache only - no network)
let extractor = null;
let modelReady = false;
let loadError = null;

async function loadModel() {
  try {
    console.log('[Sandbox] Loading model from local cache...');

    // Try HF cache first, fall back to bundled model
    let modelSource = MODEL_NAME;
    try {
      extractor = await pipeline('feature-extraction', MODEL_NAME, {
        local_files_only: true,
        device: 'cpu'
      });
    } catch (hfErr) {
      // HF cache miss — try bundled model shipped with npm package
      if (existsSync(BUNDLED_MODEL_DIR)) {
        console.log(`[Sandbox] HF cache miss, loading bundled model: ${BUNDLED_MODEL_DIR}`);
        // Ensure model.onnx exists (bundled may only have model_quint8_avx2.onnx)
        const onnxDir = join(BUNDLED_MODEL_DIR, 'onnx');
        const modelOnnx = join(onnxDir, 'model.onnx');
        if (!existsSync(modelOnnx) && existsSync(onnxDir)) {
          // Find any .onnx file and symlink as model.onnx
          const { readdirSync, symlinkSync } = await import('fs');
          const onnxFiles = readdirSync(onnxDir).filter(f => f.endsWith('.onnx'));
          if (onnxFiles.length > 0) {
            try { symlinkSync(onnxFiles[0], modelOnnx); } catch {}
          }
        }
        extractor = await pipeline('feature-extraction', BUNDLED_MODEL_DIR, {
          local_files_only: true,
          device: 'cpu'
        });
        modelSource = BUNDLED_MODEL_DIR;
      } else {
        throw hfErr;
      }
    }

    // Skip the duplicate pipeline call below — extractor is already loaded

    modelReady = true;

    // Detect native dimension by running a test embedding
    const testOutput = await extractor('test', { pooling: 'mean', normalize: true });
    NATIVE_DIM = testOutput.data.length;
    TARGET_DIM = NATIVE_DIM; // Default to native, can be set via protocol

    console.log('[Sandbox] Model loaded successfully. Native dimension:', NATIVE_DIM);
    console.log('[Sandbox] Target dimension:', TARGET_DIM, '(can be set via protocol)');
    console.log('[Sandbox] Ready to accept embedding requests.');
  } catch (error) {
    loadError = error.message;
    console.error('[Sandbox] FATAL: Failed to load model:', error.message);
    console.error('[Sandbox] Did you run "npm run download-model" first?');
    // Don't exit - let the server return errors instead
  }
}

// Scale embedding to target dimension (up or down)
function scaleEmbedding(embedding, targetDim) {
  const srcDim = embedding.length;
  if (srcDim === targetDim) return embedding;

  const result = new Float64Array(targetDim);

  if (targetDim < srcDim) {
    // Downscale: average neighboring values
    const ratio = srcDim / targetDim;
    for (let i = 0; i < targetDim; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.floor((i + 1) * ratio);
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += embedding[j];
      }
      result[i] = sum / (end - start);
    }
  } else {
    // Upscale: linear interpolation
    const ratio = (srcDim - 1) / (targetDim - 1);
    for (let i = 0; i < targetDim; i++) {
      const srcIdx = i * ratio;
      const low = Math.floor(srcIdx);
      const high = Math.min(low + 1, srcDim - 1);
      const frac = srcIdx - low;
      result[i] = embedding[low] * (1 - frac) + embedding[high] * frac;
    }
  }

  // Normalize to unit length
  let norm = 0;
  for (let i = 0; i < targetDim; i++) {
    norm += result[i] * result[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < targetDim; i++) {
      result[i] /= norm;
    }
  }

  return Array.from(result);
}

// Generate embedding for text, scaled to target dimension
async function generateEmbedding(text) {
  if (!modelReady) {
    throw new Error('Model not loaded: ' + (loadError || 'unknown error'));
  }

  // Truncate to model's max length (256 tokens ~= 1000 chars)
  const truncated = text.slice(0, 1000);

  // Generate embedding at native dimension
  const output = await extractor(truncated, {
    pooling: 'mean',
    normalize: true
  });

  // Convert to array
  let embedding = Array.from(output.data);

  // Scale to target dimension if different
  if (TARGET_DIM && embedding.length !== TARGET_DIM) {
    embedding = scaleEmbedding(embedding, TARGET_DIM);
  }

  return embedding;
}

// Handle incoming requests
function handleRequest(socket) {
  let buffer = '';

  socket.on('data', async (data) => {
    buffer += data.toString();

    // Check for complete JSON (newline-delimited)
    const newlineIndex = buffer.indexOf('\n');
    if (newlineIndex === -1) return;

    const requestJson = buffer.slice(0, newlineIndex);
    buffer = buffer.slice(newlineIndex + 1);

    try {
      const request = JSON.parse(requestJson);

      // BACKWARDS COMPATIBILITY: Support Python-style requests
      // {"stats": true} -> treat like {"type": "health"}
      if (request.stats === true) {
        socket.write(JSON.stringify({
          status: modelReady ? 'healthy' : 'loading',
          stats: { model: MODEL_NAME, ready: modelReady },
          model: MODEL_NAME,
          native_dimensions: NATIVE_DIM,
          target_dimensions: TARGET_DIM,
          dynamic: true
        }) + '\n');
        return;
      }

      // {"text": "..."} without type -> treat like {"type": "embed", "text": "..."}
      if (!request.type && request.text && typeof request.text === 'string') {
        request.type = 'embed';
      }

      // {"texts": [...]} batch format -> handle ALL texts, return {"embeddings": [[...], ...]}
      if (!request.type && request.texts && Array.isArray(request.texts)) {
        console.log('[Sandbox] Batch request - processing', request.texts.length, 'texts');

        // Send processing heartbeat
        socket.write(JSON.stringify({
          status: 'processing',
          count: request.texts.length
        }) + '\n');

        try {
          const embeddings = [];
          for (const text of request.texts) {
            if (typeof text === 'string' && text.trim()) {
              const embedding = await generateEmbedding(text);
              embeddings.push(embedding);
            } else {
              // Invalid text - use zeros
              embeddings.push(new Array(TARGET_DIM || NATIVE_DIM).fill(0));
            }
          }

          socket.write(JSON.stringify({
            embeddings,
            dimensions: embeddings[0]?.length || TARGET_DIM || NATIVE_DIM,
            count: embeddings.length,
            native_dimensions: NATIVE_DIM,
            target_dimensions: TARGET_DIM,
            model: MODEL_NAME
          }) + '\n');
        } catch (error) {
          socket.write(JSON.stringify({ error: error.message, batch: true }) + '\n');
        }
        return;
      }

      // {"query": "..."} format from MiniCOT/other clients -> treat as embed
      if (!request.type && request.query && typeof request.query === 'string') {
        request.type = 'embed';
        request.text = request.query;
        console.log('[Sandbox] Query format - converting to embed');
      }

      // Handle set_dimension request
      if (request.type === 'set_dimension') {
        if (request.dimension && typeof request.dimension === 'number' && request.dimension > 0) {
          TARGET_DIM = request.dimension;
          console.log('[Sandbox] Target dimension set to:', TARGET_DIM);
          socket.write(JSON.stringify({ status: 'ok', dimension: TARGET_DIM }) + '\n');
        } else {
          socket.write(JSON.stringify({ error: 'Invalid dimension value' }) + '\n');
        }
        return;
      }

      // Handle get_dimension request
      if (request.type === 'get_dimension') {
        socket.write(JSON.stringify({
          native_dimensions: NATIVE_DIM,
          target_dimensions: TARGET_DIM
        }) + '\n');
        return;
      }

      // Handle health check
      if (request.type === 'health') {
        socket.write(JSON.stringify({
          status: modelReady ? 'healthy' : 'loading',
          model: MODEL_NAME,
          native_dimensions: NATIVE_DIM,
          target_dimensions: TARGET_DIM,
          dynamic: true
        }) + '\n');
        return;
      }

      if (request.type !== 'embed') {
        // More descriptive error with request info for debugging
        const reqKeys = Object.keys(request).join(', ');
        console.error('[Sandbox] Unknown request type:', request.type, '- keys:', reqKeys);
        socket.write(JSON.stringify({
          error: `Unknown request type: ${request.type || 'undefined'}`,
          received_keys: reqKeys,
          hint: 'Expected: {type:"embed",text:"..."} or {text:"..."} or {stats:true} or {type:"health"}',
          requestId: request.requestId
        }) + '\n');
        return;
      }

      if (!request.text || typeof request.text !== 'string') {
        const reqKeys = Object.keys(request).join(', ');
        console.error('[Sandbox] Missing text field - keys:', reqKeys);
        socket.write(JSON.stringify({
          error: 'Missing or invalid text field',
          received_keys: reqKeys,
          hint: 'Include "text" field with string value',
          requestId: request.requestId
        }) + '\n');
        return;
      }

      // Send "processing" heartbeat immediately so client knows we're working
      // This enables idle-based timeouts - client resets timer on any data
      // Include requestId for persistent socket matching
      socket.write(JSON.stringify({
        status: 'processing',
        text_length: request.text.length,
        requestId: request.requestId
      }) + '\n');

      // Generate embedding (scaled to target dimension)
      const embedding = await generateEmbedding(request.text);

      socket.write(JSON.stringify({
        embedding,
        dimensions: embedding.length,
        native_dimensions: NATIVE_DIM,
        target_dimensions: TARGET_DIM,
        model: MODEL_NAME,
        dynamic: true,
        requestId: request.requestId
      }) + '\n');

    } catch (error) {
      socket.write(JSON.stringify({ error: error.message }) + '\n');
    }
  });

  socket.on('error', (err) => {
    // Silently ignore EPIPE/connection reset - these are harmless
    // Common causes: health checks, clients that disconnect early
    if (err.code === 'EPIPE' || err.code === 'ECONNRESET' || err.message.includes('EPIPE')) {
      return; // Silent ignore
    }
    console.error('[Sandbox] Socket error:', err.message);
  });
}

// Start the server
async function main() {
  // Load model first
  await loadModel();

  // Clean up existing socket
  if (existsSync(SOCKET_PATH)) {
    unlinkSync(SOCKET_PATH);
  }

  // Create Unix socket server
  const server = createServer(handleRequest);

  server.listen(SOCKET_PATH, () => {
    console.log('[Sandbox] Listening on Unix socket:', SOCKET_PATH);
  });

  server.on('error', (err) => {
    console.error('[Sandbox] Server error:', err);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[Sandbox] Shutting down...');
    server.close();
    if (existsSync(SOCKET_PATH)) {
      unlinkSync(SOCKET_PATH);
    }
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[Sandbox] Fatal error:', err);
  process.exit(1);
});
