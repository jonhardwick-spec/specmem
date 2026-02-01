#!/usr/bin/env npx tsx
/**
 * Backfill embeddings for code_definitions table
 *
 * This script generates embeddings for all code_definitions that are missing them.
 * Uses the embedding socket for generation and batches updates for efficiency.
 *
 * Usage:
 *   npx tsx scripts/backfill-code-embeddings.ts
 *
 * Environment:
 *   SPECMEM_BATCH_SIZE - Number of definitions per batch (default: 50)
 *   SPECMEM_PROJECT_PATH - Filter to specific project (default: all)
 */

import { Pool } from 'pg';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';

// Configuration
const BATCH_SIZE = parseInt(process.env.SPECMEM_BATCH_SIZE || '50');
const PROJECT_FILTER = process.env.SPECMEM_PROJECT_PATH || null;
const SOCKET_PATH = process.env.SPECMEM_EMBEDDING_SOCKET ||
  path.join(process.cwd(), 'specmem', 'sockets', 'embeddings.sock');

const pool = new Pool({
  host: process.env.SPECMEM_DB_HOST || 'localhost',
  port: parseInt(process.env.SPECMEM_DB_PORT || '5432'),
  database: process.env.SPECMEM_DB_NAME || 'specmem_westayunprofessional',
  user: process.env.SPECMEM_DB_USER || 'specmem_westayunprofessional',
  password: process.env.SPECMEM_DB_PASSWORD || 'specmem_westayunprofessional'
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

/**
 * Generate embedding via socket
 */
async function generateEmbedding(text: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';

    socket.setTimeout(30000);

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
          if (resp.embedding) {
            resolve(resp.embedding);
          } else {
            reject(new Error(resp.error || 'No embedding returned'));
          }
          return;
        } catch (e) {
          reject(e);
          return;
        }
      }
    });

    socket.on('error', reject);
    socket.on('timeout', () => reject(new Error('Embedding timeout')));
  });
}

/**
 * Create embedding text from definition
 */
function createEmbeddingText(def: {
  definition_type: string;
  name: string;
  signature?: string;
  docstring?: string;
  language?: string;
}): string {
  return [
    `${def.definition_type} ${def.name}`,
    def.signature,
    def.docstring,
    def.language ? `Language: ${def.language}` : null
  ].filter(Boolean).join('\n');
}

async function main() {
  console.log('=== Code Definitions Embedding Backfill ===\n');

  // CRITICAL: Set search_path for project schema isolation
  const schemaName = await setProjectSearchPath();
  console.log(`Schema: ${schemaName}`);

  // Check socket
  if (!fs.existsSync(SOCKET_PATH)) {
    console.error(`ERROR: Embedding socket not found at ${SOCKET_PATH}`);
    console.error('Start the embedding service first: bash embedding-sandbox/warm-start.sh');
    process.exit(1);
  }

  // Count definitions needing embeddings
  let whereClause = 'embedding IS NULL';
  if (PROJECT_FILTER) {
    whereClause += ` AND project_path = '${PROJECT_FILTER.replace(/'/g, "''")}'`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM code_definitions WHERE ${whereClause}`
  );
  const total = parseInt(countResult.rows[0].total);

  console.log(`Found ${total} definitions without embeddings`);
  if (PROJECT_FILTER) {
    console.log(`Filtered to project: ${PROJECT_FILTER}`);
  }
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Socket: ${SOCKET_PATH}\n`);

  if (total === 0) {
    console.log('All definitions have embeddings!');
    await pool.end();
    return;
  }

  let processed = 0;
  let failed = 0;
  const startTime = Date.now();

  // Process in batches
  while (processed < total) {
    const batch = await pool.query(`
      SELECT id, definition_type, name, signature, docstring, language
      FROM code_definitions
      WHERE ${whereClause}
      LIMIT ${BATCH_SIZE}
    `);

    if (batch.rows.length === 0) break;

    for (const def of batch.rows) {
      try {
        const text = createEmbeddingText(def);
        const embedding = await generateEmbedding(text);
        const embeddingStr = `[${embedding.join(',')}]`;

        await pool.query(
          `UPDATE code_definitions SET embedding = $1::vector WHERE id = $2`,
          [embeddingStr, def.id]
        );

        processed++;

        // Progress every 100
        if (processed % 100 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = processed / elapsed;
          const remaining = (total - processed) / rate;
          console.log(
            `Progress: ${processed}/${total} (${((processed/total)*100).toFixed(1)}%) ` +
            `| ${rate.toFixed(1)}/s | ETA: ${Math.ceil(remaining/60)}m`
          );
        }
      } catch (err) {
        failed++;
        console.error(`Failed ${def.name}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n=== Complete ===`);
  console.log(`Processed: ${processed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Time: ${elapsed.toFixed(1)}s`);
  console.log(`Rate: ${(processed/elapsed).toFixed(1)}/s`);

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
