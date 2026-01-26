#!/usr/bin/env node
/**
 * SPECMEM DRILLDOWN HOOK
 * ======================
 *
 * Advanced hook that:
 *   1. Searches SpecMem for context on every prompt
 *   2. Injects related memories
 *   3. Can trigger interactive drilldown if needed
 *
 * This runs as a UserPromptSubmit hook.
 */

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const os = require('os');

// Import shared path resolution utilities AND Pool
const {
  expandCwd,
  getSpecmemPkg,
  getSpecmemHome,
  getProjectSocketDir,
  getEmbeddingSocket,
  getPool,
  getSchemaName
} = require('./specmem-paths.cjs');

const Pool = getPool();

// Token compressor for output
let compressHookOutput;
try {
  compressHookOutput = require('./token-compressor.cjs').compressHookOutput;
} catch (e) {
  // Fallback if compressor not available
  compressHookOutput = (text) => text;
}

// Context deduplication to prevent double injection
let contextDedup;
try {
  contextDedup = require('./context-dedup.cjs');
} catch (e) {
  // Fallback if dedup not available
  contextDedup = {
    shouldSkipInjection: () => false,
    markInjected: () => {}
  };
}

// Use shared module for path resolution
const SPECMEM_HOME = getSpecmemHome();
const SPECMEM_PKG = getSpecmemPkg();
const SPECMEM_RUN_DIR = expandCwd(process.env.SPECMEM_RUN_DIR) || getProjectSocketDir();

// Project path will be set from 's hook input (cwd field)
// Fallback: 1. SPECMEM_PROJECT_PATH env var, 2. process.cwd()
let PROJECT_PATH = expandCwd(process.env.SPECMEM_PROJECT_PATH) || process.cwd() || '/';

// Configuration
const CONFIG = {
  // SpecMem settings
  searchLimit: parseInt(process.env.SPECMEM_SEARCH_LIMIT || '5'),
  // ACCURACY FIX: Raised threshold from 0.3 to 0.4 to reduce false positives
  // Local embeddings score lower, but 0.4 filters out noise while keeping relevant results
  threshold: parseFloat(process.env.SPECMEM_THRESHOLD || '0.4'),
  // ACCURACY FIX: Increased content length from 300 to 500 for better context
  maxContentLength: parseInt(process.env.SPECMEM_MAX_CONTENT || '500'),
  enabled: process.env.SPECMEM_ENABLED !== 'false',
  // Project filtering - can be disabled with SPECMEM_PROJECT_FILTER=false
  projectFilterEnabled: process.env.SPECMEM_PROJECT_FILTER !== 'false',

  // Database connection (for direct queries)
  // Note: expandCwd applied for consistency, though DB params typically don't contain ${cwd}
  dbHost: expandCwd(process.env.SPECMEM_DB_HOST) || 'localhost',
  dbPort: parseInt(expandCwd(process.env.SPECMEM_DB_PORT) || '5432'),
  dbName: expandCwd(process.env.SPECMEM_DB_NAME) || 'specmem_westayunprofessional',
  dbUser: expandCwd(process.env.SPECMEM_DB_USER) || 'specmem_westayunprofessional',
  dbPassword: expandCwd(process.env.SPECMEM_DB_PASSWORD) || 'specmem_westayunprofessional',

  // Embedding socket
  embeddingSocket: expandCwd(process.env.SPECMEM_EMBEDDING_SOCKET) || path.join(SPECMEM_RUN_DIR, 'embeddings.sock')
};

/**
 * Check if embedding socket exists and is a socket file
 * OPTIMIZED: Just fs.existsSync + statSync.isSocket() for hook performance
 * The full health check (nc connection) is too slow for hooks (~50-100ms)
 * If server is dead but socket exists, embedding calls will fail and trigger restart
 */
function isSocketHealthy(socketPath) {
  const fs = require('fs');
  try {
    if (!fs.existsSync(socketPath)) {
      return false;
    }
    const stat = fs.statSync(socketPath);
    return stat.isSocket();
  } catch (e) {
    return false;
  }
}

/**
 * Start embedding service on-demand if not running or unhealthy
 * NON-BLOCKING: Spawns detached process and returns immediately
 */
function ensureEmbeddingServiceRunning() {
  // Check if socket is healthy (not just exists) - fast path
  if (isSocketHealthy(CONFIG.embeddingSocket)) {
    return true;
  }

  // Try to start on-demand using warm-start.sh - NON-BLOCKING
  const starterScript = path.join(SPECMEM_PKG, 'embedding-sandbox', 'warm-start.sh');
  const fs = require('fs');

  if (fs.existsSync(starterScript)) {
    try {
      // Spawn detached process - don't wait for it
      const child = spawn('bash', [starterScript], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          SPECMEM_PROJECT_PATH: PROJECT_PATH
        }
      });
      // Unref so parent can exit without waiting
      child.unref();
      // Return false - embedding service is starting but not ready yet
      // The calling code will timeout/fail gracefully and retry next prompt
      return false;
    } catch (e) {
      // Silent fail - embedding service startup is non-critical
    }
  }

  return false;
}

/**
 * Generate embedding via sandboxed container
 */
async function generateEmbedding(text) {
  // Ensure service is running first
  ensureEmbeddingServiceRunning();

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';

    socket.setTimeout(45000); // 45s to account for cold-start of embedding service

    socket.connect(CONFIG.embeddingSocket, () => {
      socket.write(JSON.stringify({ type: 'embed', text }) + '\n');
    });

    socket.on('data', (data) => {
      buffer += data.toString();
      // Server sends multiple lines: first status, then embedding
      const lines = buffer.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          if (response.embedding) {
            socket.end();
            resolve(response.embedding);
            return;
          } else if (response.error) {
            socket.end();
            reject(new Error(response.error));
            return;
          }
        } catch (e) { /* partial JSON, keep buffering */ }
      }
    });

    socket.on('error', reject);
    socket.on('timeout', () => reject(new Error('Embedding timeout')));
  });
}

/**
 * Get project schema name for isolation (matches session-start.cjs)
 */
function getProjectSchema(projectPath) {
  const basename = require('path').basename(projectPath || process.cwd()).toLowerCase().replace(/[^a-z0-9]/g, '');
  return `specmem_${basename}`;
}


// Lazy-initialized pg Pool (like smart-context-hook.js)
let dbPool = null;
function createDbPool() {
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
 * Search SpecMem directly via PostgreSQL with schema isolation
 * Uses pg Pool for reliable parsing (no pipe delimiter issues)
 */
async function searchSpecMem(query) {
  try {
    // Generate embedding for query
    const embedding = await generateEmbedding(query);
    const embeddingStr = `[${embedding.join(',')}]`;

    const pool = createDbPool();

    // CRITICAL: Set search_path BEFORE any queries for project schema isolation
    const schemaName = getProjectSchema(PROJECT_PATH);
    await pool.query('SET search_path TO ' + schemaName + ', public');

    // Build query with parameterized values
    const params = [embeddingStr, CONFIG.threshold, CONFIG.searchLimit, PROJECT_PATH];

    // ACCURACY FIX: Added importance weighting to ORDER BY
    // High importance memories rank higher even with slightly lower similarity
    // importance_rank: critical=5, high=4, medium=3, low=2, trivial=1
    const sql = `
      SELECT
        id::text,
        LEFT(content, ${CONFIG.maxContentLength}) as content,
        importance,
        tags,
        metadata->>'role' as role,
        ROUND((1 - (embedding <=> $1::vector))::numeric, 3) as similarity,
        CASE importance
          WHEN 'critical' THEN 5
          WHEN 'high' THEN 4
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 2
          WHEN 'trivial' THEN 1
          ELSE 3
        END as importance_rank
      FROM memories
      WHERE 1 - (embedding <=> $1::vector) > $2
        AND project_path = $4
        AND content IS NOT NULL
        AND length(content) > 10
        AND embedding IS NOT NULL
      ORDER BY importance_rank DESC, similarity DESC
      LIMIT $3
    `;

    const result = await pool.query(sql, params);

    // Filter and deduplicate - proper typed access, no parsing issues
    const memories = result.rows.filter(row => {
      if (!row.content) return false;
      if (row.content === 'undefined' || row.content === 'null') return false;
      if (row.content.trim().length < 5) return false;
      // Filter out 0 similarity results
      if (row.similarity <= 0) return false;
      return true;
    }).map(row => ({
      id: row.id,
      content: row.content,
      importance: row.importance,
      tags: row.tags || [],
      role: row.role,
      similarity: parseFloat(row.similarity) || 0
    }));

    // Deduplicate by content (first 100 chars)
    const seen = new Set();
    return memories.filter(m => {
      const key = (m.content || '').trim().slice(0, 100);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  } catch (error) {
    return [];
  }
}

/**
 * Format memories for injection - FLATTENED single-line format
 * Matches grep hook format: [SM-FIND] ... | ... | [/SM-FIND] drill_down(N)
 * Sorted by similarity (highest first) with drilldown IDs
 * Uses pipe separators instead of newlines to avoid breaking 's formatting
 */
function formatMemories(memories) {
  if (!memories.length) return '';

  // Sort by similarity descending (ensure proper ordering)
  const sorted = [...memories].sort((a, b) => {
    const simA = typeof a.similarity === 'number' ? a.similarity : 0;
    const simB = typeof b.similarity === 'number' ? b.similarity : 0;
    return simB - simA;
  });

  // FLATTENED format: single line with pipe separators
  // Format like Read tool output with clear role labels
  const parts = [];
  parts.push('[SM-找] ' + sorted.length + ' 回憶:');

  sorted.forEach((mem, i) => {
    // Handle similarity: 0 is valid, only undefined/NaN should show ?
    const simValue = typeof mem.similarity === 'number' && !isNaN(mem.similarity) ? mem.similarity : null;
    const sim = simValue !== null ? (simValue * 100).toFixed(1) + '%' : '?';
    const tags = mem.tags && mem.tags.length ? '[' + mem.tags.filter(t => t).slice(0, 2).join(',') + ']' : '';

    // FIXED: Extract user and claude parts separately for 70 chars each
    // Parse [USER] and [CLAUDE] tags from content BEFORE truncation
    const rawContent = (mem.content || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

    // Try to find [USER] and [CLAUDE] parts
    const userMatch = rawContent.match(/\[USER\]\s*([^\[]*)/i);
    const claudeMatch = rawContent.match(/\[CLAUDE\]\s*([^\[]*)/i);

    let formattedContent;
    if (userMatch || claudeMatch) {
      // Found structured content - show 70 chars each
      const userPart = userMatch ? userMatch[1].trim().slice(0, 70) : '';
      const claudePart = claudeMatch ? claudeMatch[1].trim().slice(0, 70) : '';
      formattedContent = '';
      if (userPart) formattedContent += '[戶②] ' + userPart + '...';
      if (claudePart) formattedContent += (userPart ? ' ' : '') + '[克勞德] ' + claudePart + '...';
    } else {
      // No structure - use role tag and show 200 chars total (increased from 140 for accuracy)
      const roleTag = mem.role === 'user' ? '[戶②]' :
                      mem.role === 'assistant' ? '[克勞德]' :
                      '[系統]';
      formattedContent = roleTag + ' ' + rawContent.slice(0, 200) + '...';
    }

    // ACCURACY FIX: Include actual memory UUID instead of fake drilldown IDs
    // The hook can't register IDs with MCP server's in-memory registry
    // So we show the UUID for use with get_memory({ id: "uuid" })
    const memId = mem.id ? mem.id.substring(0, 8) : '?';

    // Format: N.[sim%] content [tags] (id:short_uuid)
    parts.push((i + 1) + '.[' + sim + '] ' + formattedContent + ' ' + tags + ' (id:' + memId + ')');
  });

  // ACCURACY FIX: Updated instruction - getMemoryFull uses full UUID
  // User can copy the short ID prefix and find_memory can locate it
  parts.push('[/SM-找] 查看完整: find_memory({query:"id:短碼"}) 或 getMemoryFull({id:"完整UUID"})');

  // Join with pipe separator instead of newlines
  return parts.join(' | ');
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

/**
 * Main hook handler
 */
async function main() {
  // CRIT-07 FIX: Read input with timeout instead of indefinite for-await
  let input = await readStdinWithTimeout(5000);

  // Parse input -  passes { sessionId, prompt, cwd, ... }
  let prompt = '';
  let sessionId = 'unknown';
  let eventName = '';
  try {
    const data = JSON.parse(input);
    prompt = data.prompt || data.message || data.content || '';
    sessionId = data.sessionId || data.session_id || 'unknown';
    eventName = data.hookEventName || '';

    // SKIP Stop events - don't process agent transcripts as search queries
    // This prevents giant outputs when agents complete
    if (eventName === 'Stop' || eventName === 'SubagentStop') {
      process.exit(0);
    }

    // Use cwd from 's input for project filtering (critical for multi-project support!)
    // CRITICAL: Also update socket path dynamically - it was set at module load time with wrong cwd!
    if (data.cwd) {
      PROJECT_PATH = data.cwd;
      // Recalculate socket path based on actual project using shared module
      CONFIG.embeddingSocket = getEmbeddingSocket(data.cwd);
    }
  } catch (parseErr) {
    prompt = input.trim();
  }

  // Session-scoped deduplication - prevent double injection of same context
  if (contextDedup.shouldSkipInjection(PROJECT_PATH, sessionId, prompt)) {
    process.exit(0);
  }

  // Skip if disabled or prompt too short
  if (!CONFIG.enabled || !prompt || prompt.length < 10) {
    process.exit(0);
  }

  // Skip slash commands
  if (prompt.startsWith('/') || prompt.startsWith('!')) {
    process.exit(0);
  }

  // Skip task notifications (background agent completions treated as prompts)
  if (prompt.includes('<task-notification>') || prompt.includes('</task-notification>')) {
    process.exit(0);
  }

  try {
    // Search SpecMem
    const memories = await searchSpecMem(prompt);

    // Output context if found - compressed for token efficiency
    // Use flattenOutput to avoid newlines breaking 's formatting
    if (memories.length > 0) {
      const formatted = formatMemories(memories);
      // Compress with flattenOutput to avoid newlines
      const compressed = compressHookOutput(formatted, {
        threshold: 0.50,  // Less aggressive compression
        minLength: 100,   // Don't compress short sections
        flattenOutput: true  // FLATTENED: Join with pipe instead of newlines
      });
      // Prepend reminder for  to read the compressed Chinese
      const prefixedOutput = `Read this for context (you understand Traditional Chinese compression with 99%+ accuracy) ⚠️壓縮:繁中→EN │ ${compressed}`;
      console.log(prefixedOutput);

      // Mark as injected to prevent duplicate injection this session
      contextDedup.markInjected(PROJECT_PATH, sessionId, prompt);
    }
  } catch (error) {
    // Silently fail - don't break the prompt
  }

  // Close pool before exit
  if (dbPool) {
    await dbPool.end().catch(() => {});
  }

  process.exit(0);
}

main().catch(async () => {
  // Close pool on error too
  if (dbPool) {
    await dbPool.end().catch(() => {});
  }
  process.exit(0);
});
