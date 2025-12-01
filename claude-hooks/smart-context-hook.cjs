#!/usr/bin/env node
/**
 * SMART CONTEXT INJECTION HOOK v3
 * ================================
 *
 * When Claude searches (Grep/Glob), this hook:
 *   1. Extracts the search query
 *   2. Runs find_code_pointers (semantic code search)
 *   3. Gets FULL content + tracebacks (drill-down style)
 *   4. Chinese compresses the output
 *   5. Injects relevant code BEFORE Claude's search runs
 *
 * For Read operations:
 *   - Searches memories related to the file being read
 *   - Returns relevant context about that file
 *
 * Flow:
 *   Claude calls Search() → Hook intercepts → find_code_pointers
 *   → drill down (get full content) → compress → inject to Claude
 */

const fs = require('fs');
const net = require('net');
const path = require('path');

// Use shared specmem-paths for Pool and helpers
const { getPool, expandCwd, getSchemaName, readStdinWithTimeout: sharedReadStdin } = require('./specmem-paths.cjs');
const Pool = getPool();

// Exit early if pg not available
if (!Pool) {
  process.exit(0);
}

// Token compressor for Chinese compression
let compressHookOutput;
try {
  compressHookOutput = require('./token-compressor.cjs').compressHookOutput;
} catch (e) {
  // Fallback if compressor not available
  compressHookOutput = (text) => text;
}

// Default SPECMEM_HOME to project-relative path
const SPECMEM_HOME = expandCwd(process.env.SPECMEM_HOME) || path.join(process.cwd(), 'specmem');
const SPECMEM_RUN_DIR = expandCwd(process.env.SPECMEM_RUN_DIR) || path.join(SPECMEM_HOME, 'sockets');

// Get current project path for filtering
const PROJECT_PATH = expandCwd(process.env.SPECMEM_PROJECT_PATH) || process.cwd() || '/';

// Use imported getSchemaName from specmem-paths.cjs
const SCHEMA_NAME = getSchemaName(PROJECT_PATH);

// TASK #23 FIX: Use unified credential pattern with SPECMEM_PASSWORD fallback
const UNIFIED_DEFAULT = 'specmem_westayunprofessional';
const unifiedCred = expandCwd(process.env.SPECMEM_PASSWORD) || UNIFIED_DEFAULT;

const CONFIG = {
  // How many results to return (default 5 for good coverage)
  searchLimit: parseInt(process.env.SPECMEM_SEARCH_LIMIT || '5'),
  // Similarity threshold (0.15 for local embeddings which score lower)
  threshold: parseFloat(process.env.SPECMEM_THRESHOLD || '0.15'),
  // Zoom level 0-100: 0=signature only, 50=balanced, 100=full context
  // Maps to content length: 0→100 chars, 50→500 chars, 100→2000 chars
  zoom: parseInt(process.env.SPECMEM_ZOOM || '50'),
  // Project filtering
  projectFilterEnabled: process.env.SPECMEM_PROJECT_FILTER !== 'false',
  // Embedding socket
  embeddingSocket: expandCwd(process.env.SPECMEM_EMBEDDING_SOCKET) || path.join(SPECMEM_RUN_DIR, 'embeddings.sock'),
  // Database connection - unified credential pattern
  dbHost: expandCwd(process.env.SPECMEM_DB_HOST) || 'localhost',
  dbPort: parseInt(expandCwd(process.env.SPECMEM_DB_PORT) || '5432'),
  dbName: expandCwd(process.env.SPECMEM_DB_NAME) || unifiedCred,
  dbUser: expandCwd(process.env.SPECMEM_DB_USER) || unifiedCred,
  dbPassword: expandCwd(process.env.SPECMEM_DB_PASSWORD) || unifiedCred
};

// Cooldown to avoid spamming same queries
const recentQueries = new Map();
const COOLDOWN_MS = 5000;

function shouldSkipQuery(query) {
  const now = Date.now();
  const lastTime = recentQueries.get(query);
  if (lastTime && now - lastTime < COOLDOWN_MS) {
    return true;
  }
  recentQueries.set(query, now);
  // Cleanup old entries
  for (const [q, t] of recentQueries) {
    if (now - t > COOLDOWN_MS * 10) recentQueries.delete(q);
  }
  return false;
}

/**
 * Convert zoom level (0-100) to content length
 * zoom 0   → 100 chars (signature only - just function name and params)
 * zoom 50  → 500 chars (balanced - function body preview)
 * zoom 100 → 2000 chars (full context - entire function)
 */
function zoomToContentLength(zoom) {
  const minLength = 100;   // zoom 0
  const maxLength = 2000;  // zoom 100
  const clampedZoom = Math.max(0, Math.min(100, zoom));
  return Math.round(minLength + (maxLength - minLength) * (clampedZoom / 100));
}

/**
 * Convert zoom level to max lines to show
 * zoom 0   → 3 lines (signature)
 * zoom 50  → 15 lines (preview)
 * zoom 100 → 50 lines (full)
 */
function zoomToMaxLines(zoom) {
  const minLines = 3;
  const maxLines = 50;
  const clampedZoom = Math.max(0, Math.min(100, zoom));
  return Math.round(minLines + (maxLines - minLines) * (clampedZoom / 100));
}

/**
 * Non-blocking embedding service check
 * FIXED: No more blocking execSync - just check socket exists
 * If socket missing, hook silently fails - embedding server is started elsewhere
 */
function isEmbeddingServiceReady() {
  // Simple existence check - no blocking!
  return fs.existsSync(CONFIG.embeddingSocket);
}

// Lazy-initialized pg Pool for async database access
let dbPool = null;
function createDbPool() {
  if (!dbPool) {
    dbPool = new Pool({
      host: CONFIG.dbHost,
      port: CONFIG.dbPort,
      database: CONFIG.dbName,
      user: CONFIG.dbUser,
      password: CONFIG.dbPassword,
      max: 2,  // Small pool - hooks are short-lived
      idleTimeoutMillis: 3000,
      connectionTimeoutMillis: 3000
    });
  }
  return dbPool;
}

// Cache for DB embedding dimension (auto-detected)
let cachedDbDimension = null;

/**
 * ASYNC: Get embedding dimension from database
 * FIXED: Uses pg Pool instead of blocking execSync!
 */
async function getDbEmbeddingDimensionAsync() {
  if (cachedDbDimension !== null) return cachedDbDimension;

  try {
    const pool = createDbPool();
    // Set search path for project schema
    await pool.query('SET search_path TO ' + SCHEMA_NAME + ', public');

    const result = await pool.query(
      "SELECT atttypmod FROM pg_attribute WHERE attname = 'embedding' AND attrelid = 'code_chunks'::regclass"
    );
    cachedDbDimension = result.rows[0]?.atttypmod || 1536;
  } catch (e) {
    cachedDbDimension = 1536; // Default fallback
  }
  return cachedDbDimension;
}

/**
 * Project embedding to target dimension
 * - If source < target: pad with zeros
 * - If source > target: truncate
 * - If equal: return as-is
 */
function projectEmbedding(embedding, targetDim) {
  const sourceDim = embedding.length;
  if (sourceDim === targetDim) return embedding;

  if (sourceDim < targetDim) {
    // Pad with zeros
    const padded = [...embedding];
    while (padded.length < targetDim) padded.push(0);
    return padded;
  } else {
    // Truncate
    return embedding.slice(0, targetDim);
  }
}

async function generateEmbedding(text) {
  // Quick check - don't wait for embedding service
  if (!isEmbeddingServiceReady()) {
    throw new Error('Embedding service not ready');
  }

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';
    socket.setTimeout(15000);  // 15s timeout - allows time for embedding cold-start

    socket.connect(CONFIG.embeddingSocket, () => {
      socket.write(JSON.stringify({ type: 'embed', text }) + '\n');
    });

    socket.on('data', async (data) => {
      buffer += data.toString();
      const idx = buffer.indexOf('\n');
      if (idx !== -1) {
        try {
          const resp = JSON.parse(buffer.slice(0, idx));
          socket.end();
          if (resp.embedding) {
            // Auto-project to match DB dimension - ASYNC now!
            const dbDim = await getDbEmbeddingDimensionAsync();
            const projected = projectEmbedding(resp.embedding, dbDim);
            resolve(projected);
          } else {
            reject(new Error('No embedding'));
          }
        } catch (e) { reject(e); }
      }
    });

    socket.on('error', reject);
    socket.on('timeout', () => reject(new Error('timeout')));
  });
}

/**
 * Build project filter clause for SQL queries
 */
function buildProjectFilter(columnPath) {
  if (!CONFIG.projectFilterEnabled || !PROJECT_PATH || PROJECT_PATH === '/') {
    return '';
  }
  const escapedPath = PROJECT_PATH.replace(/'/g, "''");
  return ` AND ${columnPath} = '${escapedPath}'`;
}

/**
 * ASYNC: Search code chunks with FULL content (drill-down style)
 * FIXED: Uses pg Pool instead of blocking execSync!
 *
 * Returns semantic matches with:
 *   - Full code content
 *   - Relevancy percentage
 *   - File path and line numbers
 *   - Chunk type (code, etc)
 */
async function searchCodePointersWithDrilldown(query) {
  try {
    const embedding = await generateEmbedding(query);
    const embStr = `[${embedding.join(',')}]`;

    const pool = createDbPool();

    // Set search path for project schema
    await pool.query('SET search_path TO ' + SCHEMA_NAME + ', public');

    // Parameterized query - much safer and faster than string concat!
    const result = await pool.query(
      `SELECT
        cc.file_path,
        cc.chunk_type,
        cc.language,
        REPLACE(cc.content, E'\\n', '\\u2502') as content,
        cc.start_line,
        cc.end_line,
        ROUND((1 - (cc.embedding <=> $1::vector))::numeric * 100, 1) as relevancy
      FROM code_chunks cc
      WHERE cc.embedding IS NOT NULL
        AND 1 - (cc.embedding <=> $1::vector) > $2
      ORDER BY relevancy DESC
      LIMIT $3`,
      [embStr, CONFIG.threshold, CONFIG.searchLimit]
    );

    return result.rows.map(row => {
      // Extract name from first meaningful line of content
      const firstLine = (row.content || '').split('\n').find(l => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('#')) || '';
      const name = firstLine.trim().slice(0, 60) + (firstLine.length > 60 ? '...' : '');
      return {
        file_path: row.file_path,
        def_type: row.chunk_type || 'code',
        name: name || `${row.language || 'code'} chunk`,
        content: row.content?.slice(0, zoomToContentLength(CONFIG.zoom)),
        start_line: parseInt(row.start_line || 0),
        end_line: parseInt(row.end_line || 0),
        relevancy: parseFloat(row.relevancy || 0),
        called_by: '' // Not available in code_chunks
      };
    });
  } catch (e) {
    return [];
  }
}

/**
 * ASYNC: Search memories (for Read operations)
 * FIXED: Uses pg Pool instead of blocking execSync!
 */
async function searchMemories(query) {
  try {
    const embedding = await generateEmbedding(query);
    const embStr = `[${embedding.join(',')}]`;

    const pool = createDbPool();

    // Set search path for project schema
    await pool.query('SET search_path TO ' + SCHEMA_NAME + ', public');

    // Build query with optional project filter
    let sql = `
      SELECT
        id::text,
        content,
        memory_type,
        ROUND((1 - (embedding <=> $1::vector))::numeric * 100, 1) as relevancy
      FROM memories
      WHERE 1 - (embedding <=> $1::vector) > $2
    `;
    let params = [embStr, CONFIG.threshold, CONFIG.searchLimit];

    if (CONFIG.projectFilterEnabled && PROJECT_PATH && PROJECT_PATH !== '/') {
      sql += ` AND (metadata->>'project_path' = $4 OR metadata->>'project' = $4)`;
      params.push(PROJECT_PATH);
    }

    sql += ` ORDER BY relevancy DESC LIMIT $3`;

    const result = await pool.query(sql, params);

    return result.rows
      .filter(row => row.content && row.content !== 'undefined' && row.content.trim().length >= 5)
      .map(row => ({
        id: row.id,
        content: row.content.slice(0, zoomToContentLength(CONFIG.zoom)),
        type: row.memory_type,
        relevancy: parseFloat(row.relevancy || 0)
      }));
  } catch (e) {
    return [];
  }
}

/**
 * Format code pointers output - HUMAN READABLE bracket notation
 * Uses pipe separators for flat output that doesn't break Claude's formatting
 */
function formatCodePointers(results, query) {
  if (!results.length) return '';

  const parts = [];
  parts.push(`[SM-CODE] ${results.length} results | zoom: ${CONFIG.zoom}%`);

  results.forEach((r, i) => {
    const maxLines = zoomToMaxLines(CONFIG.zoom);
    let codePreview = '';
    if (r.content) {
      // Flatten code to single line with vertical bars as line separators
      const codeLines = r.content.split('\n').slice(0, maxLines);
      codePreview = codeLines.map(l => l.trim()).filter(l => l).join(' | ');
      if (codePreview.length > 200) codePreview = codePreview.slice(0, 200) + '...';
    }

    const calledBy = r.called_by ? ` <- ${r.called_by}` : '';
    parts.push(`[${i+1}] ${r.relevancy}% ${r.name} (${r.def_type}) | ${r.file_path}:${r.start_line}${calledBy} | ${codePreview}`);
  });

  parts.push('[/SM-CODE]');
  return parts.join(' | ');
}

/**
 * Format memories output - HUMAN READABLE bracket notation
 * Uses pipe separators for flat output that doesn't break Claude's formatting
 */
function formatMemories(results, query) {
  const validResults = results.filter(r => r.content && r.content.trim() && r.content !== 'undefined');
  if (!validResults.length) return '';

  const parts = [];
  parts.push(`[SM-MEM] ${validResults.length} memories`);

  validResults.forEach((r, i) => {
    const isUser = r.content.startsWith('[USER]') || r.content.includes('用戶]');
    const isClaude = r.content.startsWith('[CLAUDE]') || r.content.includes('助手]');
    const roleTag = isUser ? '[U]' : isClaude ? '[C]' : '';

    let cleanContent = r.content
      .replace(/^\[USER\]\s*/i, '')
      .replace(/^\[CLAUDE\]\s*/i, '')
      .replace(/^用戶\]\s*/i, '')
      .replace(/^助手\]\s*/i, '')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanContent && cleanContent.length > 5) {
      // Truncate long content
      if (cleanContent.length > 150) cleanContent = cleanContent.slice(0, 150) + '...';
      parts.push(`[${i+1}] ${r.relevancy}% ${roleTag} ${cleanContent}`);
    }
  });

  parts.push('[/SM-MEM] drill_down(N) for full');
  return parts.join(' | ');
}

/**
 * Extract search query from tool input
 */
function extractQuery(toolName, toolInput, userPrompt) {
  let query = '';

  if (toolName === 'Glob') {
    // Extract meaningful parts from glob pattern
    query = (toolInput.pattern || '')
      .replace(/\*\*/g, ' ')
      .replace(/\*/g, ' ')
      .replace(/\./g, ' ')
      .replace(/\//g, ' ')
      .trim();
  } else if (toolName === 'Grep') {
    // Use grep pattern directly - this is what Claude is searching for
    query = toolInput.pattern || '';
  } else if (toolName === 'Read') {
    // Use file path and extract meaningful names
    const filePath = toolInput.file_path || '';
    const basename = path.basename(filePath, path.extname(filePath));
    query = basename.replace(/[-_]/g, ' ');
  }

  // Add user prompt context for better semantic matching
  if (userPrompt && userPrompt.length > 10 && userPrompt.length < 200) {
    query = `${userPrompt.slice(0, 100)} ${query}`.trim();
  }

  return query;
}

/**
 * Read stdin with timeout to prevent indefinite hangs
 * CRIT-07 FIX: All hooks must use this instead of raw for-await
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

async function main() {
  // Exit early if pg module couldn't be loaded
  if (!Pool) {
    process.exit(0);
  }

  // CRIT-07 FIX: Read with timeout instead of indefinite for-await
  let input = await readStdinWithTimeout(5000);

  let context;
  try { context = JSON.parse(input); } catch { process.exit(0); }

  const toolName = context.tool_name || context.toolName || '';
  const toolInput = context.tool_input || context.input || {};
  const userPrompt = context.prompt || '';

  // Only handle Glob, Grep, Read
  if (!['Glob', 'Grep', 'Read'].includes(toolName)) {
    process.exit(0);
  }

  const query = extractQuery(toolName, toolInput, userPrompt);

  if (!query || query.length < 3) {
    process.exit(0);
  }

  if (shouldSkipQuery(query)) {
    process.exit(0);
  }

  try {
    let output = '';

    if (toolName === 'Glob' || toolName === 'Grep') {
      // Code search with drill-down for Glob/Grep
      const results = await searchCodePointersWithDrilldown(query);
      if (results.length > 0) {
        output = formatCodePointers(results, query);
      }
    } else if (toolName === 'Read') {
      // Memory search for Read
      const results = await searchMemories(query);
      if (results.length > 0) {
        output = formatMemories(results, query);
      }
    }

    // Chinese compress the output for token efficiency
    if (output) {
      const compressed = compressHookOutput(output, {
        includeWarning: true,
        preserveStructure: true
      });
      console.log(compressed);
    }
  } catch (e) {
    // Silent fail - don't break Claude's search
  }

  // Clean up pool before exit
  if (dbPool) {
    await dbPool.end().catch(() => {});
  }

  process.exit(0);
}

main().catch(async () => {
  // Clean up pool on error too
  if (dbPool) {
    await dbPool.end().catch(() => {});
  }
  process.exit(0);
});
