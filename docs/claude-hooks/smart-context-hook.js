#!/usr/bin/env node
/**
 * SMART CONTEXT INJECTION HOOK v4
 * ================================
 *
 * Read operations → find_memory (semantic memory search)
 * Grep/Glob operations → find_code_pointers (semantic code search)
 *
 * Uses pg Pool directly like MCP tools - no shell escaping issues
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const { Pool } = require('pg');

// Use shared path resolution
const specmemPaths = require('./specmem-paths.cjs');
const { expandCwd, getSpecmemPkg, getSpecmemHome, getProjectSocketDir } = specmemPaths;

// Token compressor for Chinese compression
let compressHookOutput;
try {
  compressHookOutput = require('./token-compressor.cjs').compressHookOutput;
} catch (e) {
  compressHookOutput = (text) => text;
}

// Dynamic path resolution
const SPECMEM_HOME = getSpecmemHome();
const SPECMEM_PKG = getSpecmemPkg();
const SPECMEM_RUN_DIR = expandCwd(process.env.SPECMEM_RUN_DIR) || getProjectSocketDir(process.cwd());

let PROJECT_PATH = expandCwd(process.env.SPECMEM_PROJECT_PATH) || process.cwd() || '/';

// Load .env from SPECMEM_PKG
function loadEnv() {
  const envFile = path.join(SPECMEM_PKG, 'specmem.env');
  if (fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, 'utf8');
    content.split('\n').forEach(line => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match && !process.env[match[1].trim()]) {
        process.env[match[1].trim()] = match[2].trim();
      }
    });
  }
}
loadEnv();

const CONFIG = {
  searchLimit: parseInt(process.env.SPECMEM_SEARCH_LIMIT || '5'),
  threshold: parseFloat(process.env.SPECMEM_THRESHOLD || '0.40'),
  maxContentLength: parseInt(process.env.SPECMEM_MAX_CONTENT || '300'),
  projectFilterEnabled: process.env.SPECMEM_PROJECT_FILTER !== 'false',
  embeddingSocket: expandCwd(process.env.SPECMEM_EMBEDDING_SOCKET) || path.join(SPECMEM_RUN_DIR, 'embeddings.sock'),
  // TASK #23 FIX: Use unified credential pattern with SPECMEM_PASSWORD fallback
  dbHost: process.env.SPECMEM_DB_HOST || 'localhost',
  dbPort: parseInt(process.env.SPECMEM_DB_PORT || '5432'),
  dbName: process.env.SPECMEM_DB_NAME || process.env.SPECMEM_PASSWORD || 'specmem_westayunprofessional',
  dbUser: process.env.SPECMEM_DB_USER || process.env.SPECMEM_PASSWORD || 'specmem_westayunprofessional',
  dbPassword: process.env.SPECMEM_DB_PASSWORD || process.env.SPECMEM_PASSWORD || 'specmem_westayunprofessional'
};

// Lazy-initialized pg Pool
let dbPool = null;
function getPool() {
  if (!dbPool) {
    dbPool = new Pool({
      host: CONFIG.dbHost,
      port: CONFIG.dbPort,
      database: CONFIG.dbName,
      user: CONFIG.dbUser,
      password: CONFIG.dbPassword,
      max: 3,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 5000
    });
  }
  return dbPool;
}

/**
 * Set search_path for project schema isolation
 * Must be called before any queries to ensure we hit the right schema
 */
async function setProjectSearchPath(client) {
  const projectPath = PROJECT_PATH || process.env.SPECMEM_PROJECT_PATH || process.cwd();
  const dirName = path.basename(projectPath).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const schemaName = 'specmem_' + dirName;
  await client.query('SET search_path TO ' + schemaName + ', public');
}

/**
 * Scale embedding to target dimension (like DimensionService.scaleEmbedding)
 * Pads with zeros or truncates to match target dimension
 */
function scaleEmbedding(embedding, targetDim) {
  if (embedding.length === targetDim) return embedding;

  const result = new Array(targetDim).fill(0);
  const copyLen = Math.min(embedding.length, targetDim);
  for (let i = 0; i < copyLen; i++) {
    result[i] = embedding[i];
  }

  // Normalize
  const magnitude = Math.sqrt(result.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < targetDim; i++) {
      result[i] = result[i] / magnitude;
    }
  }

  return result;
}

/**
 * Generate embedding via socket and scale to 1536 dims for memory search
 */
async function generateEmbedding(text, targetDim = 1536) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';
    socket.setTimeout(10000);

    socket.connect(CONFIG.embeddingSocket, () => {
      socket.write(JSON.stringify({ type: 'embed', text }) + '\n');
    });

    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const resp = JSON.parse(line);
          if (resp.embedding) {
            socket.end();
            // Scale to target dimension
            const scaled = scaleEmbedding(resp.embedding, targetDim);
            resolve(scaled);
            return;
          }
        } catch (e) {}
      }
    });

    socket.on('error', (e) => reject(e));
    socket.on('timeout', () => {
      socket.end();
      reject(new Error('timeout'));
    });
  });
}

/**
 * find_memory - Search memories for Read operations
 */
async function findMemory(query) {
  try {
    const embedding = await generateEmbedding(query, 384); // 384 dims for this DB
    const embStr = `[${embedding.join(',')}]`;
    const pool = getPool();

    // Set search_path for project schema isolation
    await setProjectSearchPath(pool);

    let projectFilter = '';
    const params = [embStr, CONFIG.threshold, CONFIG.searchLimit];

    if (CONFIG.projectFilterEnabled && PROJECT_PATH && PROJECT_PATH !== '/') {
      projectFilter = ` AND (metadata->>'project_path' = $4 OR project_path = $4)`;
      params.push(PROJECT_PATH);
    }

    const sql = `
      SELECT
        id,
        LEFT(content, ${CONFIG.maxContentLength}) as content,
        memory_type,
        metadata->>'role' as role,
        ROUND((1 - (embedding <=> $1::vector))::numeric * 100, 1) as relevancy
      FROM memories
      WHERE 1 - (embedding <=> $1::vector) > $2
        AND embedding IS NOT NULL
        ${projectFilter}
      ORDER BY relevancy DESC
      LIMIT $3
    `;

    const result = await pool.query(sql, params);
    const rows = result.rows.filter(r => r.content && r.content.trim().length > 5);

    // Deduplicate by content (first 100 chars) - prevents duplicate memories
    const seen = new Set();
    return rows.filter(r => {
      const key = (r.content || '').trim().slice(0, 100);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (e) {
    return [];
  }
}

/**
 * Find file modification memories via codebase_pointers
 * Returns conversation context from when the file was modified
 */
async function findFileModificationContext(filePath) {
  try {
    const pool = getPool();

    // Set search_path for project schema isolation
    await setProjectSearchPath(pool);

    // Query codebase_pointers joined with memories to get modification context
    const sql = `
      SELECT
        m.id,
        LEFT(m.content, ${CONFIG.maxContentLength}) as content,
        m.metadata->>'role' as role,
        m.created_at,
        cp.pointer_type
      FROM codebase_pointers cp
      JOIN memories m ON cp.memory_id = m.id
      WHERE cp.file_path = $1
        OR cp.file_path LIKE '%' || $2 || '%'
      ORDER BY m.created_at DESC
      LIMIT 3
    `;

    // Use both absolute and relative path matching
    const basename = path.basename(filePath);
    const result = await pool.query(sql, [filePath, basename]);

    return result.rows.filter(r => r.content && r.content.trim().length > 5);
  } catch (e) {
    return [];
  }
}

/**
 * Extract file path from query if present
 */
function extractFilePath(query) {
  const patterns = [
    /(?:^|\s)([\/~][\w\/.-]+\.\w+)(?:\s|$|:)/,
    /(?:^|\s)([\w-]+\/[\w\/.-]+\.\w+)(?:\s|$|:)/,
    /(?:^|\s)(src\/[\w\/.-]+)(?:\s|$|:)/,
    /(?:^|\s)(lib\/[\w\/.-]+)(?:\s|$|:)/,
  ];
  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * find_code_pointers - Search code for Grep/Glob operations
 * NOTE: code_definitions has relative file paths, so no project filtering
 * ENHANCED: If query contains file path, search that file specifically with 35% threshold
 */
async function findCodePointers(query) {
  try {
    const embedding = await generateEmbedding(query, 384); // 384 dims for this DB
    const embStr = `[${embedding.join(',')}]`;
    const pool = getPool();

    // Set search_path for project schema isolation
    await setProjectSearchPath(pool);

    // Check if query contains a file path - if so, use lower threshold and file filter
    const filePath = extractFilePath(query);
    const threshold = filePath ? 0.40 : CONFIG.threshold;
    const params = [embStr, threshold, CONFIG.searchLimit];

    // Build file path filter if specified
    const fileFilter = filePath ? `AND file_path ILIKE '%${filePath.replace(/'/g, "''")}%'` : '';

    // NOTE: code_definitions stores relative paths so we don't filter by project path
    const sql = `
      SELECT
        name,
        definition_type,
        file_path,
        start_line,
        end_line,
        LEFT(signature, ${CONFIG.maxContentLength}) as signature,
        ROUND((1 - (embedding <=> $1::vector))::numeric * 100, 1) as relevancy
      FROM code_definitions
      WHERE 1 - (embedding <=> $1::vector) > $2
        AND embedding IS NOT NULL
        ${fileFilter}
      ORDER BY relevancy DESC
      LIMIT $3
    `;

    const result = await pool.query(sql, params);
    const rows = result.rows.filter(r => r.name && r.file_path);

    // Deduplicate by name+file_path - prevents duplicate code entries
    const seen = new Set();
    return rows.filter(r => {
      const key = r.name + ':' + r.file_path + ':' + r.start_line;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (e) {
    return [];
  }
}

/**
 * Format memories output - clean lines, one per result
 * Now includes role labels for user/assistant distinction
 */
function formatMemories(results, query) {
  if (!results.length) return '';

  const lines = ['[SM-找] ' + results.length + '記憶:'];

  results.forEach((r, i) => {
    const rawContent = (r.content || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

    // FIXED: Parse [USER] and [CLAUDE] parts for 70 chars each
    const userMatch = rawContent.match(/\[USER\]\s*([^\[]*)/i);
    const claudeMatch = rawContent.match(/\[CLAUDE\]\s*([^\[]*)/i);

    let formattedContent;
    if (userMatch || claudeMatch) {
      // Found structured content - show 70 chars each
      const userPart = userMatch ? userMatch[1].trim().slice(0, 70) : '';
      const claudePart = claudeMatch ? claudeMatch[1].trim().slice(0, 70) : '';
      formattedContent = '';
      if (userPart) formattedContent += '[戶②] ' + userPart + '...';
      if (claudePart) formattedContent += (userPart ? ' ' : '') + '[佐] ' + claudePart + '...';
    } else {
      // No structure - use role tag and show 140 chars total
      const roleTag = r.role === 'user' ? '[戶②]' :
                      r.role === 'assistant' ? '[佐]' : '';
      formattedContent = roleTag + ' ' + rawContent.slice(0, 140) + '...';
    }

    lines.push((i+1) + '.[' + r.relevancy + '%] ' + formattedContent);
  });

  lines.push('drill_down(N) 獲取完整');
  return lines.join('\n');
}

/**
 * Format file modification context - shows conversation around file changes
 */
function formatFileModificationContext(results, filePath) {
  if (!results.length) return '';

  const lines = ['[SM-檔改] ' + path.basename(filePath) + ' 修改記錄:'];

  results.forEach((r, i) => {
    const content = (r.content || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    const roleTag = r.role === 'user' ? '[戶②]' :
                    r.role === 'assistant' ? '[佐]' :
                    r.role === 'system' ? '[系]' : '';
    lines.push((i+1) + '. ' + roleTag + ' ' + content);
  });

  return lines.join('\n');
}

/**
 * Format code pointers output - clean lines, one per result
 */
function formatCodePointers(results, query) {
  if (!results.length) return '';

  const lines = ['[SM-碼] ' + results.length + '定義:'];

  results.forEach((r, i) => {
    lines.push((i+1) + '.[' + r.relevancy + '%] ' + r.name + '(' + r.definition_type + ') ' + r.file_path + ':' + r.start_line);
  });

  lines.push('drill_down(N) 獲取代碼');
  return lines.join('\n');
}

/**
 * Extract search query from tool input
 */
function extractQuery(toolName, toolInput, userPrompt) {
  let query = '';

  if (toolName === 'Glob') {
    query = (toolInput.pattern || '')
      .replace(/\*\*/g, ' ')
      .replace(/\*/g, ' ')
      .replace(/\./g, ' ')
      .replace(/\//g, ' ')
      .trim();
  } else if (toolName === 'Grep') {
    query = toolInput.pattern || '';
  } else if (toolName === 'Read') {
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
 * Read stdin with timeout
 */
function readStdinWithTimeout(timeoutMs = 5000) {
  return new Promise((resolve) => {
    let input = '';
    const timer = setTimeout(() => {
      process.stdin.removeAllListeners();
      resolve(input);
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
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
  let input = await readStdinWithTimeout(5000);

  let context;
  try { context = JSON.parse(input); } catch { process.exit(0); }

  // Update paths dynamically based on actual project cwd
  if (context.cwd) {
    PROJECT_PATH = context.cwd;
    const projectSocketDir = path.join(context.cwd, 'specmem', 'sockets');
    CONFIG.embeddingSocket = path.join(projectSocketDir, 'embeddings.sock');
  }

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

  try {
    let output = '';

    if (toolName === 'Glob' || toolName === 'Grep') {
      // CODE SEARCH: find_code_pointers
      const results = await findCodePointers(query);
      if (results.length > 0) {
        output = formatCodePointers(results, query);
      }
    } else if (toolName === 'Read') {
      // Get file path for modification context lookup
      const filePath = toolInput.file_path || '';
      const outputParts = [];

      // 1. MEMORY SEARCH: find_memory (semantic search for related memories)
      const memResults = await findMemory(query);
      if (memResults.length > 0) {
        outputParts.push(formatMemories(memResults, query));
      }

      // 2. FILE MODIFICATION CONTEXT: find memories linked to this file via codebase_pointers
      // This shows the conversation context from when the file was last modified
      if (filePath) {
        const modResults = await findFileModificationContext(filePath);
        if (modResults.length > 0) {
          outputParts.push(formatFileModificationContext(modResults, filePath));
        }
      }

      if (outputParts.length > 0) {
        output = outputParts.join('\n---\n');
      }
    }

    // Chinese compress the output for token efficiency
    // Keep newlines for readability
    if (output) {
      const compressed = compressHookOutput(output, {
        includeWarning: true,
        flattenOutput: false
      });
      // Add prefix reminding Claude to read the compressed content
      const prefixedOutput = `Read this for context (you understand Traditional Chinese compression with 99%+ accuracy) ⚠️壓縮:繁中→EN\n${compressed}`;
      console.log(prefixedOutput);
    }
  } catch (e) {
    // Silent fail
  }

  // Close pool
  if (dbPool) {
    await dbPool.end().catch(() => {});
  }

  process.exit(0);
}

main().catch(() => {
  process.exit(0);
});
