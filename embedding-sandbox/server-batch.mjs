/**
 * SANDBOXED EMBEDDING SERVER - BATCH SUPPORT
 *
 * Adds batch embedding to enable 100+/s throughput
 */

import { pipeline, env } from '@huggingface/transformers';
import { createServer } from 'net';
import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Machine-unique shared socket path
const getMachineSocketPath = () => {
  const userId = process.getuid ? process.getuid() : 'default';
  return join(tmpdir(), `specmem-embed-${userId}.sock`);
};

const SOCKET_PATH = process.env.SOCKET_PATH || getMachineSocketPath();
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

let NATIVE_DIM = null;
let TARGET_DIM = null;

const CACHE_DIR = process.env.HF_HOME || '/home/embed/.cache/huggingface';
env.cacheDir = CACHE_DIR;

console.log('[Sandbox] Starting BATCH embedding server...');
console.log('[Sandbox] Socket:', SOCKET_PATH);

let extractor = null;
let modelReady = false;

async function loadModel() {
  try {
    console.log('[Sandbox] Loading model...');
    extractor = await pipeline('feature-extraction', MODEL_NAME, {
      local_files_only: true,
      device: 'cpu'
    });
    modelReady = true;

    const testOutput = await extractor('test', { pooling: 'mean', normalize: true });
    NATIVE_DIM = testOutput.data.length;
    TARGET_DIM = NATIVE_DIM;

    console.log('[Sandbox] Model ready. Dimension:', NATIVE_DIM);
    console.log('[Sandbox] BATCH support enabled for high throughput');
  } catch (error) {
    console.error('[Sandbox] FATAL:', error.message);
  }
}

function scaleEmbedding(embedding, targetDim) {
  const srcDim = embedding.length;
  if (srcDim === targetDim) return embedding;

  const result = new Float64Array(targetDim);
  if (targetDim < srcDim) {
    const ratio = srcDim / targetDim;
    for (let i = 0; i < targetDim; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.floor((i + 1) * ratio);
      let sum = 0;
      for (let j = start; j < end; j++) sum += embedding[j];
      result[i] = sum / (end - start);
    }
  } else {
    const ratio = (srcDim - 1) / (targetDim - 1);
    for (let i = 0; i < targetDim; i++) {
      const srcIdx = i * ratio;
      const low = Math.floor(srcIdx);
      const high = Math.min(low + 1, srcDim - 1);
      const frac = srcIdx - low;
      result[i] = embedding[low] * (1 - frac) + embedding[high] * frac;
    }
  }

  let norm = 0;
  for (let i = 0; i < targetDim; i++) norm += result[i] * result[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < targetDim; i++) result[i] /= norm;
  return Array.from(result);
}

async function generateEmbedding(text) {
  if (!modelReady) throw new Error('Model not loaded');
  const truncated = text.slice(0, 1000);
  const output = await extractor(truncated, { pooling: 'mean', normalize: true });
  let embedding = Array.from(output.data);
  if (TARGET_DIM && embedding.length !== TARGET_DIM) {
    embedding = scaleEmbedding(embedding, TARGET_DIM);
  }
  return embedding;
}

// BATCH embedding - process multiple texts at once
async function generateBatchEmbeddings(texts) {
  if (!modelReady) throw new Error('Model not loaded');

  const results = [];
  // Process in parallel chunks for efficiency
  const CHUNK_SIZE = 10;

  for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
    const chunk = texts.slice(i, i + CHUNK_SIZE);
    const promises = chunk.map(async (text) => {
      try {
        const truncated = text.slice(0, 1000);
        const output = await extractor(truncated, { pooling: 'mean', normalize: true });
        let embedding = Array.from(output.data);
        if (TARGET_DIM && embedding.length !== TARGET_DIM) {
          embedding = scaleEmbedding(embedding, TARGET_DIM);
        }
        return { embedding, error: null };
      } catch (e) {
        return { embedding: null, error: e.message };
      }
    });

    const chunkResults = await Promise.all(promises);
    results.push(...chunkResults);
  }

  return results;
}

function handleRequest(socket) {
  let buffer = '';

  socket.on('data', async (data) => {
    buffer += data.toString();
    const newlineIndex = buffer.indexOf('\n');
    if (newlineIndex === -1) return;

    const requestJson = buffer.slice(0, newlineIndex);
    buffer = buffer.slice(newlineIndex + 1);

    try {
      const request = JSON.parse(requestJson);

      // Health check
      if (request.type === 'health') {
        socket.write(JSON.stringify({
          status: modelReady ? 'healthy' : 'loading',
          model: MODEL_NAME,
          native_dimensions: NATIVE_DIM,
          target_dimensions: TARGET_DIM,
          batch_support: true
        }) + '\n');
        return;
      }

      // Set dimension
      if (request.type === 'set_dimension') {
        if (request.dimension && typeof request.dimension === 'number' && request.dimension > 0) {
          TARGET_DIM = request.dimension;
          socket.write(JSON.stringify({ status: 'ok', dimension: TARGET_DIM }) + '\n');
        } else {
          socket.write(JSON.stringify({ error: 'Invalid dimension' }) + '\n');
        }
        return;
      }

      // BATCH embedding - new!
      if (request.type === 'batch_embed') {
        if (!Array.isArray(request.texts)) {
          socket.write(JSON.stringify({ error: 'texts must be array' }) + '\n');
          return;
        }

        const startTime = Date.now();
        const results = await generateBatchEmbeddings(request.texts);
        const elapsed = Date.now() - startTime;

        socket.write(JSON.stringify({
          embeddings: results.map(r => r.embedding),
          errors: results.map(r => r.error),
          count: request.texts.length,
          elapsed_ms: elapsed,
          rate: (request.texts.length / (elapsed / 1000)).toFixed(1)
        }) + '\n');
        return;
      }

      // Single embed (backwards compatible)
      if (request.type === 'embed') {
        if (!request.text || typeof request.text !== 'string') {
          socket.write(JSON.stringify({ error: 'Missing text' }) + '\n');
          return;
        }
        const embedding = await generateEmbedding(request.text);
        socket.write(JSON.stringify({
          embedding,
          dimensions: embedding.length
        }) + '\n');
        return;
      }

      socket.write(JSON.stringify({ error: 'Unknown request type' }) + '\n');

    } catch (error) {
      socket.write(JSON.stringify({ error: error.message }) + '\n');
    }
  });

  socket.on('error', () => {});
}

async function main() {
  await loadModel();

  if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH);

  const server = createServer(handleRequest);
  server.listen(SOCKET_PATH, () => {
    console.log('[Sandbox] Listening on:', SOCKET_PATH);
  });

  process.on('SIGTERM', () => {
    console.log('[Sandbox] Shutting down...');
    server.close();
    if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH);
    process.exit(0);
  });
}

main();
