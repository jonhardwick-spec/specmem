#!/usr/bin/env npx tsx
/**
 * Backfill Missing Embeddings for code_definitions Table (Task #43)
 *
 * ROOT CAUSE: 78.5% of code_definitions have NULL embeddings because
 * the codebaseIndexer silently returns without generating embeddings
 * when the embedding provider is unavailable during indexing.
 *
 * FIX: This script backfills all missing embeddings using the correct
 * request format: {"type": "embed", "text": "..."} for single requests.
 *
 * Key improvements over previous scripts:
 * 1. Properly sets search_path for per-project schema isolation
 * 2. Uses batch embedding API for 5-10x faster processing
 * 3. Handles errors gracefully with retries
 * 4. Reports detailed progress and statistics
 *
 * Usage:
 *   SPECMEM_PROJECT_PATH=/specmem npx tsx scripts/backfill-code-definition-embeddings.ts
 *
 * Environment:
 *   SPECMEM_PROJECT_PATH - Required: Project path for schema isolation
 *   SPECMEM_BATCH_SIZE - Batch size (default: 100)
 *   SPECMEM_WORKERS - Parallel workers (default: 10)
 *   SPECMEM_EMBEDDING_SOCKET - Socket path (auto-detected from project path)
 *
 * @author hardwicksoftwareservices
 */

import { Pool, PoolClient } from 'pg';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';

// Configuration
const PROJECT_PATH = process.env.SPECMEM_PROJECT_PATH;
if (!PROJECT_PATH) {
  console.error('ERROR: SPECMEM_PROJECT_PATH environment variable is required');
  console.error('Usage: SPECMEM_PROJECT_PATH=/your/project npx tsx scripts/backfill-code-definition-embeddings.ts');
  process.exit(1);
}

const BATCH_SIZE = parseInt(process.env.SPECMEM_BATCH_SIZE || '100');
const WORKERS = parseInt(process.env.SPECMEM_WORKERS || '10');

// Find embedding socket - check multiple common locations
function findEmbeddingSocket(): string {
  const possiblePaths = [
    process.env.SPECMEM_EMBEDDING_SOCKET,
    path.join(PROJECT_PATH, 'specmem', 'sockets', 'embeddings.sock'),
    path.join(PROJECT_PATH, 'run', 'embeddings.sock'),
    '/tmp/specmem-embeddings.sock',
  ].filter(Boolean) as string[];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Return first option as default (will fail later with helpful error)
  return possiblePaths[0] || path.join(PROJECT_PATH, 'specmem', 'sockets', 'embeddings.sock');
}

const SOCKET_PATH = findEmbeddingSocket();

// Get project schema name from dir name (matches projectNamespacing.ts)
function getProjectSchema(projectPath: string): string {
  const dirName = path.basename(projectPath)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'default';
  return 'specmem_' + dirName;
}

const SCHEMA_NAME = getProjectSchema(PROJECT_PATH);

// Database pool
const pool = new Pool({
  host: process.env.SPECMEM_DB_HOST || 'localhost',
  port: parseInt(process.env.SPECMEM_DB_PORT || '5432'),
  database: process.env.SPECMEM_DB_NAME || 'specmem_westayunprofessional',
  user: process.env.SPECMEM_DB_USER || 'specmem_westayunprofessional',
  password: process.env.SPECMEM_DB_PASSWORD || 'specmem_westayunprofessional',
  max: WORKERS + 5
});

/**
 * Set search_path for a connection to use project schema
 */
async function setSearchPath(client: PoolClient): Promise<void> {
  await client.query('SET search_path TO ' + SCHEMA_NAME + ', public');
}

/**
 * Generate batch embeddings via socket using correct format: {"texts": [...]}
 */
async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Batch embedding timeout after 60s'));
    }, 60000);

    socket.connect(SOCKET_PATH, () => {
      // Use batch protocol: {"texts": [...]}
      socket.write(JSON.stringify({ texts }) + '\n');
    });

    socket.on('data', (data) => {
      buffer += data.toString();
      // Server sends heartbeat {"status":"processing"} FIRST, then actual response
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        try {
          const resp = JSON.parse(line);
          // yooo skip heartbeat/processing status - keep waiting
          if (resp.status === 'processing') {
            continue;
          }
          clearTimeout(timeout);
          socket.end();
          if (resp.embeddings && Array.isArray(resp.embeddings)) {
            resolve(resp.embeddings);
          } else if (resp.error) {
            reject(new Error(resp.error));
          } else {
            reject(new Error('Invalid batch response - no embeddings array'));
          }
          return;
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
          return;
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    socket.on('timeout', () => {
      clearTimeout(timeout);
      reject(new Error('Socket timeout'));
    });
  });
}

/**
 * Generate single embedding via socket using correct format: {"type": "embed", "text": "..."}
 */
async function generateEmbedding(text: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Embedding timeout after 30s'));
    }, 30000);

    socket.connect(SOCKET_PATH, () => {
      // Use single embedding protocol: {"type": "embed", "text": "..."}
      socket.write(JSON.stringify({ type: 'embed', text }) + '\n');
    });

    socket.on('data', (data) => {
      buffer += data.toString();
      // Server sends heartbeat {"status":"processing"} FIRST, then actual embedding
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        try {
          const resp = JSON.parse(line);
          // yooo skip heartbeat/processing status - keep waiting
          if (resp.status === 'processing') {
            continue;
          }
          clearTimeout(timeout);
          socket.end();
          if (resp.embedding) {
            resolve(resp.embedding);
          } else if (resp.error) {
            reject(new Error(resp.error));
          } else {
            reject(new Error('No embedding in response'));
          }
          return;
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
          return;
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    socket.on('timeout', () => {
      clearTimeout(timeout);
      reject(new Error('Socket timeout'));
    });
  });
}

/**
 * Create embedding text from definition - matches codebaseIndexer.ts format
 */
function createEmbeddingText(def: {
  definition_type: string;
  name: string;
  signature?: string;
  docstring?: string;
  file_path?: string;
  language?: string;
}): string {
  return [
    def.definition_type + ' ' + def.name,
    def.signature || '',
    def.docstring || '',
    def.file_path ? 'File: ' + def.file_path : '',
    def.language ? 'Language: ' + def.language : ''
  ].filter(Boolean).join('\n');
}

interface DefRow {
  id: string;
  definition_type: string;
  name: string;
  signature: string | null;
  docstring: string | null;
  file_path: string | null;
  language: string | null;
}

/**
 * Process a batch of definitions
 */
async function processBatch(defs: DefRow[]): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  // Generate texts for batch embedding
  const texts = defs.map(def => createEmbeddingText({
    definition_type: def.definition_type,
    name: def.name,
    signature: def.signature || undefined,
    docstring: def.docstring || undefined,
    file_path: def.file_path || undefined,
    language: def.language || undefined
  }));

  try {
    // Try batch embedding first (5-10x faster)
    const embeddings = await generateEmbeddingsBatch(texts);

    // Update each definition with its embedding
    const client = await pool.connect();
    try {
      await setSearchPath(client);

      for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
        const embedding = embeddings[i];

        if (embedding && Array.isArray(embedding)) {
          const embeddingStr = '[' + embedding.join(',') + ']';
          await client.query(
            'UPDATE code_definitions SET embedding = $1::vector WHERE id = $2',
            [embeddingStr, def.id]
          );
          processed++;
        } else {
          failed++;
        }
      }
    } finally {
      client.release();
    }
  } catch (batchErr) {
    // Batch failed - fallback to individual processing
    console.log('  Batch failed, using individual processing: ' + (batchErr instanceof Error ? batchErr.message : batchErr));

    const client = await pool.connect();
    try {
      await setSearchPath(client);

      for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
        try {
          const embedding = await generateEmbedding(texts[i]);
          const embeddingStr = '[' + embedding.join(',') + ']';
          await client.query(
            'UPDATE code_definitions SET embedding = $1::vector WHERE id = $2',
            [embeddingStr, def.id]
          );
          processed++;
        } catch (err) {
          failed++;
        }
      }
    } finally {
      client.release();
    }
  }

  return { processed, failed };
}

async function main() {
  console.log('=== Code Definition Embedding Backfill (Task #43) ===\n');
  console.log('Project: ' + PROJECT_PATH);
  console.log('Schema: ' + SCHEMA_NAME);
  console.log('Socket: ' + SOCKET_PATH);
  console.log('Batch size: ' + BATCH_SIZE);
  console.log('Workers: ' + WORKERS + '\n');

  // Check socket exists
  if (!fs.existsSync(SOCKET_PATH)) {
    console.error('ERROR: Embedding socket not found at ' + SOCKET_PATH);
    console.error('Start the embedding service first');
    process.exit(1);
  }

  // Test embedding server connection
  console.log('Testing embedding server connection...');
  try {
    const testEmbed = await generateEmbedding('test');
    console.log('Embedding server OK - dimension: ' + testEmbed.length + '\n');
  } catch (err) {
    console.error('ERROR: Cannot connect to embedding server: ' + (err instanceof Error ? err.message : err));
    process.exit(1);
  }

  // Get count of definitions needing embeddings
  const client = await pool.connect();
  try {
    await setSearchPath(client);

    const countResult = await client.query(
      'SELECT COUNT(*) as total FROM code_definitions WHERE embedding IS NULL'
    );
    const total = parseInt(countResult.rows[0].total);

    const totalResult = await client.query(
      'SELECT COUNT(*) as all_defs FROM code_definitions'
    );
    const allDefs = parseInt(totalResult.rows[0].all_defs);

    const pctMissing = allDefs > 0 ? ((total / allDefs) * 100).toFixed(1) : '0';

    console.log('Total code_definitions: ' + allDefs);
    console.log('Missing embeddings: ' + total + ' (' + pctMissing + '%)');

    if (total === 0) {
      console.log('\nAll definitions have embeddings - nothing to do!');
      client.release();
      await pool.end();
      return;
    }

    console.log('\nStarting backfill...\n');

    let processed = 0;
    let failed = 0;
    const startTime = Date.now();
    let lastProgressTime = startTime;

    // Process in batches
    while (true) {
      // Get next batch - join with codebase_files to get language
      const batch = await client.query<DefRow>(
        'SELECT cd.id, cd.definition_type, cd.name, cd.signature, cd.docstring, cd.file_path, cf.language ' +
        'FROM code_definitions cd ' +
        'LEFT JOIN codebase_files cf ON cd.file_id = cf.id ' +
        'WHERE cd.embedding IS NULL LIMIT $1',
        [BATCH_SIZE]
      );

      if (batch.rows.length === 0) break;

      const result = await processBatch(batch.rows);
      processed += result.processed;
      failed += result.failed;

      // Progress update every 500ms
      const now = Date.now();
      if (now - lastProgressTime >= 500) {
        lastProgressTime = now;
        const elapsed = (now - startTime) / 1000;
        const rate = processed / elapsed;
        const remaining = (total - processed) / rate;
        const pct = ((processed / total) * 100).toFixed(1);

        process.stdout.write(
          '\rProgress: ' + processed + '/' + total + ' (' + pct + '%) | ' +
          rate.toFixed(1) + '/s | ETA: ' + formatTime(remaining) + '    '
        );
      }
    }

    const elapsed = (Date.now() - startTime) / 1000;
    console.log('\n\n=== Backfill Complete ===');
    console.log('Processed: ' + processed);
    console.log('Failed: ' + failed);
    console.log('Time: ' + elapsed.toFixed(1) + 's');
    console.log('Rate: ' + (processed / elapsed).toFixed(1) + '/s');

    // Verify final count
    const verifyResult = await client.query(
      'SELECT COUNT(*) as remaining FROM code_definitions WHERE embedding IS NULL'
    );
    const remaining = parseInt(verifyResult.rows[0].remaining);
    console.log('Remaining without embeddings: ' + remaining);

  } finally {
    client.release();
  }

  await pool.end();
}

function formatTime(seconds: number): string {
  if (seconds < 60) return Math.ceil(seconds) + 's';
  if (seconds < 3600) return Math.ceil(seconds / 60) + 'm';
  return (seconds / 3600).toFixed(1) + 'h';
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
