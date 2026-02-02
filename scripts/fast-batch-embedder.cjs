#!/usr/bin/env node
/**
 * FAST BATCH EMBEDDER v2 for code_definitions
 *
 * Uses batch embedding API for 100+/s throughput
 */

const { Pool } = require('pg');
const net = require('net');

// Configuration - socket path derives from project path for per-project isolation
const path = require('path');
const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();

// Get project schema name from dir name (matches projectNamespacing.ts)
function getProjectSchema(projPath) {
  const dirName = path.basename(projPath)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'default';
  return 'specmem_' + dirName;
}
const SCHEMA_NAME = getProjectSchema(projectPath);

const CONFIG = {
  socketPath: process.env.SPECMEM_SOCKET || `${projectPath}/specmem/sockets/embeddings.sock`,
  dbHost: process.env.PGHOST || 'localhost',
  dbPort: parseInt(process.env.PGPORT || '5433'),
  dbName: process.env.PGDATABASE || 'specmem_westayunprofessional',
  dbUser: process.env.PGUSER || 'specmem_westayunprofessional',
  dbPassword: process.env.PGPASSWORD || 'specmem_westayunprofessional',

  batchSize: parseInt(process.env.BATCH_SIZE || '100'),  // Texts per batch request
  dbBatchSize: parseInt(process.env.DB_BATCH_SIZE || '500'),  // Rows per DB fetch
  maxRows: parseInt(process.env.MAX_ROWS || '0'),  // 0 = unlimited
};

// Stats tracking
const stats = {
  processed: 0,
  errors: 0,
  startTime: Date.now(),
};

// Database pool
let pool = null;
function getPool() {
  if (!pool) {
    pool = new Pool({
      host: CONFIG.dbHost,
      port: CONFIG.dbPort,
      database: CONFIG.dbName,
      user: CONFIG.dbUser,
      password: CONFIG.dbPassword,
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

// Send batch embedding request
function embedBatch(texts) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let response = '';

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Socket timeout'));
    }, 60000);

    socket.connect(CONFIG.socketPath, () => {
      socket.write(JSON.stringify({ type: 'batch_embed', texts }) + '\n');
    });

    socket.on('data', (data) => {
      response += data.toString();
      // Server sends heartbeat {"status":"processing"} FIRST, then actual response
      let idx;
      while ((idx = response.indexOf('\n')) !== -1) {
        const line = response.slice(0, idx);
        response = response.slice(idx + 1);
        try {
          const result = JSON.parse(line);
          // yooo skip heartbeat/processing status - keep waiting
          if (result.status === 'processing') {
            continue;
          }
          clearTimeout(timeout);
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result);
          }
          socket.destroy();
          return;
        } catch (e) {
          clearTimeout(timeout);
          reject(new Error('Invalid JSON response'));
          socket.destroy();
          return;
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// Try single embedding fallback (for servers without batch support)
function embedSingle(text) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let response = '';

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Socket timeout'));
    }, 30000);

    socket.connect(CONFIG.socketPath, () => {
      socket.write(JSON.stringify({ type: 'embed', text }) + '\n');
    });

    socket.on('data', (data) => {
      response += data.toString();
      // Server sends heartbeat {"status":"processing"} FIRST, then actual embedding
      let idx;
      while ((idx = response.indexOf('\n')) !== -1) {
        const line = response.slice(0, idx);
        response = response.slice(idx + 1);
        try {
          const result = JSON.parse(line);
          // yooo skip heartbeat/processing status - keep waiting
          if (result.status === 'processing') {
            continue;
          }
          clearTimeout(timeout);
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result.embedding);
          }
          socket.destroy();
          return;
        } catch (e) {
          clearTimeout(timeout);
          reject(new Error('Invalid JSON response'));
          socket.destroy();
          return;
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// Process a batch of definitions
async function processBatch(definitions, useBatch = true) {
  const texts = definitions.map(def => {
    return [
      `${def.definition_type} ${def.name}`,
      def.signature || '',
      def.docstring || '',
      `File: ${def.file_path}`,
      `Language: ${def.language}`
    ].join('\n').slice(0, 1000);
  });

  const results = [];

  if (useBatch) {
    try {
      const batchResult = await embedBatch(texts);
      for (let i = 0; i < definitions.length; i++) {
        results.push({
          id: definitions[i].id,
          embedding: batchResult.embeddings[i],
          error: batchResult.errors?.[i] || null
        });
      }
    } catch (err) {
      // Fallback to single mode
      console.log('  Batch failed, falling back to single mode...');
      return processBatch(definitions, false);
    }
  } else {
    // Single mode fallback
    for (const def of definitions) {
      const text = texts[definitions.indexOf(def)];
      try {
        const embedding = await embedSingle(text);
        results.push({ id: def.id, embedding, error: null });
      } catch (err) {
        results.push({ id: def.id, embedding: null, error: err.message });
      }
    }
  }

  return results;
}

// Bulk update embeddings in database
async function updateEmbeddings(results) {
  const pool = getPool();
  const successful = results.filter(r => r.embedding);

  if (successful.length === 0) return 0;

  const client = await pool.connect();
  try {
    // CRITICAL: Set search_path for this connection
    await client.query(`SET search_path TO ${SCHEMA_NAME}, public`);
    await client.query('BEGIN');

    const ids = successful.map(r => r.id);
    const embeddings = successful.map(r => `[${r.embedding.join(',')}]`);

    await client.query(`
      UPDATE code_definitions cd
      SET embedding = data.emb::vector
      FROM (
        SELECT unnest($1::uuid[]) as id, unnest($2::text[]) as emb
      ) data
      WHERE cd.id = data.id
    `, [ids, embeddings]);

    await client.query('COMMIT');
    return successful.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Main processing loop
async function main() {
  console.log('=== FAST BATCH EMBEDDER v2 ===');
  console.log(`Project: ${projectPath}`);
  console.log(`Schema: ${SCHEMA_NAME}`);
  console.log(`Socket: ${CONFIG.socketPath}`);
  console.log(`Batch size: ${CONFIG.batchSize} texts per request`);
  console.log(`DB batch: ${CONFIG.dbBatchSize} rows per fetch`);
  console.log('');

  const pool = getPool();

  // CRITICAL: Set search_path for project schema isolation
  await pool.query(`SET search_path TO ${SCHEMA_NAME}, public`);

  // Check counts
  const countResult = await pool.query(`
    SELECT COUNT(*) as total, COUNT(embedding) as has_embedding
    FROM code_definitions
  `);

  const total = parseInt(countResult.rows[0].total);
  const hasEmbedding = parseInt(countResult.rows[0].has_embedding);
  const needsProcessing = total - hasEmbedding;

  console.log(`Total definitions: ${total}`);
  console.log(`Already embedded: ${hasEmbedding}`);
  console.log(`Need embedding: ${needsProcessing}`);
  console.log('');

  if (needsProcessing === 0) {
    console.log('All done!');
    await pool.end();
    return;
  }

  const toProcess = CONFIG.maxRows > 0 ? Math.min(needsProcessing, CONFIG.maxRows) : needsProcessing;
  console.log(`Processing ${toProcess} definitions...`);

  while (stats.processed < toProcess) {
    // Fetch batch from DB
    const batchResult = await pool.query(`
      SELECT id, definition_type, name, signature, docstring, file_path, language
      FROM code_definitions
      WHERE embedding IS NULL
      ORDER BY updated_at DESC NULLS LAST
      LIMIT $1
    `, [CONFIG.dbBatchSize]);

    if (batchResult.rows.length === 0) break;

    // Process in smaller embedding batches
    for (let i = 0; i < batchResult.rows.length; i += CONFIG.batchSize) {
      const chunk = batchResult.rows.slice(i, i + CONFIG.batchSize);
      const results = await processBatch(chunk);

      // Update DB
      const updated = await updateEmbeddings(results);

      stats.processed += updated;
      stats.errors += results.filter(r => r.error).length;

      // Progress
      const elapsed = (Date.now() - stats.startTime) / 1000;
      const rate = stats.processed / elapsed;
      const remaining = toProcess - stats.processed;
      const eta = remaining / rate;

      process.stdout.write(`\r  Progress: ${stats.processed}/${toProcess} (${rate.toFixed(1)}/s) ETA: ${eta.toFixed(0)}s    `);
    }
  }

  // Final stats
  const totalTime = (Date.now() - stats.startTime) / 1000;
  console.log('\n');
  console.log('=== COMPLETE ===');
  console.log(`Processed: ${stats.processed}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Time: ${totalTime.toFixed(1)}s`);
  console.log(`Rate: ${(stats.processed / totalTime).toFixed(1)}/s`);

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
