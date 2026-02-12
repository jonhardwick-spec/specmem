/**
 * Test script to verify the sandboxed embedding service works
 *
 * Socket path uses PROJECT ISOLATION:
 * Pattern: {PROJECT}/specmem/sockets/embeddings.sock
 * No fallbacks to shared paths!
 */

import { createConnection } from 'net';
import { existsSync } from 'fs';
import { join } from 'path';

// Project-local socket path - NO FALLBACKS
// Pattern: {PROJECT}/specmem/sockets/embeddings.sock
const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
const projectSocketPath = join(projectPath, 'specmem', 'sockets', 'embeddings.sock');

// Allow explicit override via env var
const SOCKET_PATH = process.env.SPECMEM_EMBEDDING_SOCKET || projectSocketPath;

console.log('Testing sandboxed embedding service...');
console.log('Socket:', SOCKET_PATH);

const socket = createConnection(SOCKET_PATH);

socket.on('connect', () => {
  console.log('Connected to sandbox');
  const request = JSON.stringify({ type: 'embed', text: 'Hello world, this is a test!' }) + '\n';
  socket.write(request);
});

socket.on('data', (data) => {
  try {
    const response = JSON.parse(data.toString().trim());

    if (response.error) {
      console.error('Error:', response.error);
      process.exit(1);
    }

    console.log('SUCCESS!');
    console.log('Model:', response.model);
    console.log('Dimensions:', response.dimension);
    console.log('Embedding (first 5):', response.embedding.slice(0, 5));
    socket.end();
    process.exit(0);
  } catch (err) {
    console.error('Parse error:', err);
    process.exit(1);
  }
});

socket.on('error', (err) => {
  console.error('Socket error:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('Timeout - no response received');
  process.exit(1);
}, 10000);
