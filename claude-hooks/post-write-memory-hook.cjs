#!/usr/bin/env node
/**
 * POST-WRITE MEMORY HOOK
 * ======================
 *
 * Fires AFTER Write/Edit operations to link conversation context to modified files.
 *
 * Flow:
 *   1. Claude writes/edits a file
 *   2. This hook intercepts the PostToolUse event
 *   3. Captures recent conversation context (from session or memories)
 *   4. Creates a memory with context about WHY the file was modified
 *   5. Links that memory to the file via codebase_pointers table
 *   6. Generates embedding ASYNCHRONOUSLY (non-blocking)
 *
 * This enables find_code_pointers to return relevant conversation context
 * when reading files - "who asked for this code and what was discussed?"
 *
 * @author hardwicksoftwareservices
 * @website https://justcalljon.pro
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

// Use shared specmem-paths for Pool and helpers
const specmemPaths = require('./specmem-paths.cjs');
const { getPool, expandCwd, getSchemaName } = specmemPaths;
const Pool = getPool();

// Early exit if Pool not available
if (!Pool) {
  process.exit(0);
}

// Legacy compat - keep specmemPaths structure for existing code
const _specmemPaths = {
    expandCwd,
    getSpecmemPkg: () => '/specmem',
    getSpecmemHome: () => path.join(process.cwd(), 'specmem'),
    getProjectSocketDir: (cwd) => path.join(cwd || process.cwd(), 'specmem', 'sockets'),
    getEmbeddingSocket: (cwd) => path.join(cwd || process.cwd(), 'specmem', 'sockets', 'embeddings.sock')
  };

// Default paths
const SPECMEM_HOME = specmemPaths.getSpecmemHome();
const SPECMEM_RUN_DIR = expandCwd(process.env.SPECMEM_RUN_DIR) || specmemPaths.getProjectSocketDir();

// Get current project path
let PROJECT_PATH = expandCwd(process.env.SPECMEM_PROJECT_PATH) || process.cwd() || '/';

/**
 * Get schema name from project path (local version)
 */
function getSchemaNameLocal(projectPath) {
  if (!projectPath || projectPath === '/') return 'public';
  const dirName = path.basename(projectPath).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return 'specmem_' + dirName;
}

// DB config - unified credential pattern
const UNIFIED_DEFAULT = 'specmem_westayunprofessional';
const unifiedCred = expandCwd(process.env.SPECMEM_PASSWORD) || UNIFIED_DEFAULT;
const CONFIG = {
  dbHost: expandCwd(process.env.SPECMEM_DB_HOST) || 'localhost',
  dbPort: parseInt(expandCwd(process.env.SPECMEM_DB_PORT) || '5432'),
  dbName: expandCwd(process.env.SPECMEM_DB_NAME) || unifiedCred,
  dbUser: expandCwd(process.env.SPECMEM_DB_USER) || unifiedCred,
  dbPassword: expandCwd(process.env.SPECMEM_DB_PASSWORD) || unifiedCred,
  embeddingSocket: expandCwd(process.env.SPECMEM_EMBEDDING_SOCKET) || path.join(SPECMEM_RUN_DIR, 'embeddings.sock')
};

// Lazy-initialized pg Pool
let dbPool = null;
function getDbPool() {
  if (!dbPool) {
    dbPool = new Pool({
      host: CONFIG.dbHost,
      port: CONFIG.dbPort,
      database: CONFIG.dbName,
      user: CONFIG.dbUser,
      password: CONFIG.dbPassword,
      max: 2,
      idleTimeoutMillis: 3000,
      connectionTimeoutMillis: 3000
    });
  }
  return dbPool;
}

/**
 * Generate UUID v4
 */
function generateUUID() {
  return crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

/**
 * Check if embedding socket exists
 */
function isEmbeddingServiceReady() {
  return fs.existsSync(CONFIG.embeddingSocket);
}

/**
 * Generate embedding via Frankenstein service (ASYNC, non-blocking call)
 */
function generateEmbeddingAsync(text) {
  return new Promise((resolve, reject) => {
    if (!isEmbeddingServiceReady()) {
      reject(new Error('Embedding service not ready'));
      return;
    }

    const socket = new net.Socket();
    let buffer = '';
    socket.setTimeout(10000);

    socket.connect(CONFIG.embeddingSocket, () => {
      socket.write(JSON.stringify({ type: 'embed', text }) + '\n');
    });

    socket.on('data', (data) => {
      buffer += data.toString();
      const idx = buffer.indexOf('\n');
      if (idx !== -1) {
        try {
          const resp = JSON.parse(buffer.slice(0, idx));
          socket.end();
          if (resp.embedding) {
            resolve(resp.embedding);
          } else {
            reject(new Error('No embedding in response'));
          }
        } catch (e) {
          reject(e);
        }
      }
    });

    socket.on('error', reject);
    socket.on('timeout', () => reject(new Error('Embedding timeout')));
  });
}

/**
 * Get recent memories from this project (conversation context)
 * Returns recent user and assistant messages
 */
async function getRecentConversationContext(limit = 5) {
  try {
    const pool = getDbPool();
    const schema = getSchemaNameLocal(PROJECT_PATH);
    await pool.query('SET search_path TO ' + schema + ', public');

    const result = await pool.query(`
      SELECT
        id::text,
        content,
        metadata->>'role' as role,
        created_at
      FROM memories
      WHERE project_path = $1
        AND created_at > NOW() - INTERVAL '30 minutes'
        AND content IS NOT NULL
        AND length(content) > 10
        AND metadata->>'role' IN ('user', 'assistant')
      ORDER BY created_at DESC
      LIMIT $2
    `, [PROJECT_PATH, limit]);

    return result.rows.map(row => ({
      id: row.id,
      content: row.content,
      role: row.role,
      created_at: row.created_at
    }));
  } catch (e) {
    return [];
  }
}

/**
 * Create a memory entry for the file modification context
 */
async function createModificationMemory(filePath, conversationContext, toolResult) {
  const memoryId = generateUUID();

  // Build content with conversation context
  let content = `[FILE_MODIFICATION] ${filePath}\n\n`;
  content += `Recent conversation context:\n`;

  // Add conversation context (reversed to chronological order)
  const contextMessages = [...conversationContext].reverse();
  contextMessages.forEach((msg, i) => {
    const roleLabel = msg.role === 'user' ? '[USER]' : '[CLAUDE]';
    const preview = (msg.content || '').slice(0, 200).replace(/\n/g, ' ');
    content += `${roleLabel} ${preview}...\n`;
  });

  // Add tool result summary if available
  if (toolResult && typeof toolResult === 'string') {
    const resultPreview = toolResult.slice(0, 100).replace(/\n/g, ' ');
    content += `\nResult: ${resultPreview}`;
  }

  try {
    const pool = getDbPool();
    const schema = getSchemaNameLocal(PROJECT_PATH);
    await pool.query('SET search_path TO ' + schema + ', public');

    // Insert memory
    await pool.query(`
      INSERT INTO memories (
        id,
        content,
        memory_type,
        importance,
        tags,
        metadata,
        project_path,
        created_at
      ) VALUES (
        $1::uuid,
        $2,
        'episodic',
        'medium',
        ARRAY['file_modification', 'code_context']::text[],
        $3::jsonb,
        $4,
        NOW()
      )
    `, [
      memoryId,
      content,
      JSON.stringify({
        role: 'system',
        source: 'post_write_hook',
        file_path: filePath,
        timestamp: new Date().toISOString()
      }),
      PROJECT_PATH
    ]);

    return memoryId;
  } catch (e) {
    return null;
  }
}

/**
 * Link memory to file in codebase_pointers table
 */
async function linkMemoryToFile(memoryId, filePath) {
  try {
    const pool = getDbPool();
    const schema = getSchemaNameLocal(PROJECT_PATH);
    await pool.query('SET search_path TO ' + schema + ', public');

    // Insert into codebase_pointers
    await pool.query(`
      INSERT INTO codebase_pointers (
        memory_id,
        file_path,
        pointer_type,
        created_at
      ) VALUES (
        $1::uuid,
        $2,
        'modification',
        NOW()
      )
      ON CONFLICT DO NOTHING
    `, [memoryId, filePath]);

    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Update memory with embedding (ASYNC, non-blocking)
 * Spawns embedding generation and updates DB when ready
 */
async function updateMemoryEmbedding(memoryId, content) {
  try {
    const embedding = await generateEmbeddingAsync(content);
    const embStr = `[${embedding.join(',')}]`;

    const pool = getDbPool();
    const schema = getSchemaNameLocal(PROJECT_PATH);
    await pool.query('SET search_path TO ' + schema + ', public');

    // Update memory embedding
    await pool.query(`
      UPDATE memories
      SET embedding = $1::vector
      WHERE id = $2::uuid
    `, [embStr, memoryId]);

    // Try to update codebase_pointer embedding (column might not exist yet)
    try {
      await pool.query(`
        UPDATE codebase_pointers
        SET embedding = $1::vector
        WHERE memory_id = $2::uuid
      `, [embStr, memoryId]);
    } catch (colErr) {
      // Column doesn't exist yet - that's fine, memory still works
    }

    return true;
  } catch (e) {
    // Embedding failure is non-critical - memory still exists, just won't be semantic searchable
    return false;
  }
}

/**
 * Read stdin with timeout
 */
function readStdinWithTimeout(timeoutMs = 5000) {
  return new Promise((resolve) => {
    let input = '';
    const timer = setTimeout(() => {
      process.stdin.destroy();
      resolve(input);
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(input);
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      resolve(input);
    });
  });
}

/**
 * Main hook handler
 */
async function main() {
  let input = await readStdinWithTimeout(5000);

  let context;
  try {
    context = JSON.parse(input);
  } catch (e) {
    process.exit(0);
  }

  // Extract tool info
  const toolName = context.tool_name || context.toolName || '';
  const toolInput = context.tool_input || context.input || {};
  const toolResult = context.tool_result || context.result || '';

  // Only handle Write and Edit
  if (!['Write', 'Edit'].includes(toolName)) {
    process.exit(0);
  }

  // Get file path from tool input
  const filePath = toolInput.file_path || toolInput.filePath || '';
  if (!filePath) {
    process.exit(0);
  }

  // Update PROJECT_PATH from cwd if provided
  if (context.cwd) {
    PROJECT_PATH = context.cwd;
    CONFIG.embeddingSocket = specmemPaths.getEmbeddingSocket(context.cwd);
  }

  // Skip if file is outside project
  if (!filePath.startsWith(PROJECT_PATH) && !filePath.startsWith('/')) {
    process.exit(0);
  }

  try {
    // Get recent conversation context
    const conversationContext = await getRecentConversationContext(5);

    // Create memory for this modification
    const memoryId = await createModificationMemory(filePath, conversationContext, toolResult);
    if (!memoryId) {
      process.exit(0);
    }

    // Link memory to file
    await linkMemoryToFile(memoryId, filePath);

    // Generate embedding ASYNC - don't block on this
    // The memory is already created, embedding just makes it semantic searchable
    const memoryContent = `File modification: ${filePath}\n${conversationContext.map(m => m.content).join('\n')}`;

    // Fire and forget - don't await
    updateMemoryEmbedding(memoryId, memoryContent).catch(() => {});

    // Output nothing - this is a silent hook that just records context
    // We don't want to clutter Claude's output

  } catch (e) {
    // Silent fail - don't break Claude's operation
  }

  // Clean up pool
  if (dbPool) {
    await dbPool.end().catch(() => {});
  }

  process.exit(0);
}

main().catch(async () => {
  if (dbPool) {
    await dbPool.end().catch(() => {});
  }
  process.exit(0);
});
