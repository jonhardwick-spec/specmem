#!/usr/bin/env npx tsx
/**
 * FAST Parallel Backfill - Uses multiple concurrent workers
 *
 * Target: 234K definitions in ~30 seconds
 * Strategy: 50 parallel workers, each doing ~5000 definitions
 */

import { Pool } from 'pg';
import * as net from 'net';
import * as path from 'path';

const WORKERS = parseInt(process.env.WORKERS || '50');
const SOCKET_PATH = process.env.SPECMEM_EMBEDDING_SOCKET ||
  path.join(process.cwd(), 'specmem', 'sockets', 'embeddings.sock');

const pool = new Pool({
  host: process.env.SPECMEM_DB_HOST || 'localhost',
  port: parseInt(process.env.SPECMEM_DB_PORT || '5432'),
  database: process.env.SPECMEM_DB_NAME || 'specmem_westayunprofessional',
  user: process.env.SPECMEM_DB_USER || 'specmem_westayunprofessional',
  password: process.env.SPECMEM_DB_PASSWORD || 'specmem_westayunprofessional',
  max: WORKERS + 5 // Pool size for workers
});

/**
 * Set search_path to project-specific schema for isolation
 * CRITICAL: Must be called before any table operations
 */
async function setProjectSearchPath(): Promise<string> {
  const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
  const schemaName = 'specmem_' + path.basename(projectPath).toLowerCase().replace(/[^a-z0-9]/g, '');
  await pool.query(`SET search_path TO ${schemaName}, public`);
  return schemaName;
}

async function generateEmbedding(text: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';
    socket.setTimeout(10000);

    socket.connect(SOCKET_PATH, () => {
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
          socket.end();
          if (resp.embedding) resolve(resp.embedding);
          else reject(new Error(resp.error || 'No embedding'));
          return;
        } catch (e) { reject(e); return; }
      }
    });

    socket.on('error', reject);
    socket.on('timeout', () => reject(new Error('timeout')));
  });
}

function createEmbeddingText(def: any): string {
  return [
    `${def.definition_type} ${def.name}`,
    def.signature,
    def.docstring,
    def.language ? `Language: ${def.language}` : null
  ].filter(Boolean).join('\n');
}

async function worker(workerId: number, ids: string[]): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  for (const id of ids) {
    try {
      const result = await pool.query(
        'SELECT id, definition_type, name, signature, docstring, language FROM code_definitions WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) continue;

      const def = result.rows[0];
      const text = createEmbeddingText(def);
      const embedding = await generateEmbedding(text);
      const embStr = `[${embedding.join(',')}]`;

      await pool.query(
        'UPDATE code_definitions SET embedding = $1::vector WHERE id = $2',
        [embStr, id]
      );

      processed++;
    } catch (err) {
      failed++;
    }
  }

  return { processed, failed };
}

async function main() {
  console.log('=== FAST Parallel Embedding Backfill ===\n');

  // CRITICAL: Set search_path for project schema isolation
  const schemaName = await setProjectSearchPath();
  console.log(`Schema: ${schemaName}`);
  console.log(`Workers: ${WORKERS}`);
  console.log(`Socket: ${SOCKET_PATH}\n`);

  // Get all IDs that need embeddings - PRIORITIZE RECENT FILES FIRST
  const result = await pool.query(
    `SELECT id FROM code_definitions
     WHERE embedding IS NULL AND project_path = $1
     ORDER BY updated_at DESC NULLS LAST`,
    [process.env.SPECMEM_PROJECT_PATH || '/specmem']
  );

  const ids = result.rows.map(r => r.id);
  console.log(`Total definitions to process: ${ids.length}`);

  if (ids.length === 0) {
    console.log('All done!');
    await pool.end();
    return;
  }

  // Distribute IDs across workers
  const chunkSize = Math.ceil(ids.length / WORKERS);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }

  console.log(`Chunks per worker: ~${chunkSize}`);
  console.log('Starting workers...\n');

  const startTime = Date.now();

  // Run all workers in parallel
  const results = await Promise.all(
    chunks.map((chunk, i) => worker(i, chunk))
  );

  const totalProcessed = results.reduce((a, r) => a + r.processed, 0);
  const totalFailed = results.reduce((a, r) => a + r.failed, 0);
  const elapsed = (Date.now() - startTime) / 1000;

  console.log(`\n=== Complete ===`);
  console.log(`Processed: ${totalProcessed}`);
  console.log(`Failed: ${totalFailed}`);
  console.log(`Time: ${elapsed.toFixed(1)}s`);
  console.log(`Rate: ${(totalProcessed / elapsed).toFixed(0)}/s`);

  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
