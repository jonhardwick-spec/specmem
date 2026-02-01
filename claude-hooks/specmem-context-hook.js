#!/usr/bin/env node
/**
 * SpecMem Context Hook for Claude Code
 *
 * Automatically injects relevant memories into Claude Code sessions
 * using Traditional Chinese compression for token efficiency.
 *
 * Hook Event: UserPromptSubmit
 * Output: Compressed context via stdout for Claude to consume
 */

const { Client } = require('pg');
const path = require('path');

// Import shared path resolution utilities
const {
  expandCwd,
  getSpecmemPkg,
  getSpecmemHome,
  getProjectSocketDir,
  getEmbeddingSocket
} = require('./specmem-paths.cjs');

// Token compressor for output compression
let compressHookOutput;
try {
  compressHookOutput = require('./token-compressor.cjs').compressHookOutput;
} catch (e) {
  compressHookOutput = (text) => text;
}

// ============================================================================
// Configuration - All paths are project-relative by default
// ============================================================================

// Use shared module for path resolution
const SPECMEM_HOME = getSpecmemHome();
const SPECMEM_PKG = getSpecmemPkg();
const SPECMEM_RUN_DIR = expandCwd(process.env.SPECMEM_RUN_DIR) || getProjectSocketDir();
const SPECMEM_EMBEDDING_SOCKET = expandCwd(process.env.SPECMEM_EMBEDDING_SOCKET) || getEmbeddingSocket();
const SPECMEM_PROJECT_PATH = expandCwd(process.env.SPECMEM_PROJECT_PATH) || process.cwd();

// Project filtering - enabled by default
const projectFilterEnabled = process.env.SPECMEM_PROJECT_FILTER !== 'false';

const CONFIG = {
  db: {
    host: expandCwd(process.env.SPECMEM_DB_HOST) || 'localhost',
    port: parseInt(expandCwd(process.env.SPECMEM_DB_PORT) || '5432'),
    database: expandCwd(process.env.SPECMEM_DB_NAME) || 'specmem',
    user: expandCwd(process.env.SPECMEM_DB_USER) || 'specmem',
    password: expandCwd(process.env.SPECMEM_DB_PASSWORD) || 'specmem'
  },
  // Path configuration for per-project operation
  paths: {
    home: SPECMEM_HOME,
    pkg: SPECMEM_PKG,
    runDir: SPECMEM_RUN_DIR,
    embeddingSocket: SPECMEM_EMBEDDING_SOCKET,
    projectPath: SPECMEM_PROJECT_PATH
  },
  projectFilterEnabled,
  maxMemories: parseInt(expandCwd(process.env.SPECMEM_HOOK_MAX_MEMORIES) || '5'),
  minSimilarity: parseFloat(expandCwd(process.env.SPECMEM_HOOK_MIN_SIMILARITY) || '0.15'),
  maxContentLength: parseInt(expandCwd(process.env.SPECMEM_HOOK_MAX_CONTENT) || '300'),
  enableCompression: expandCwd(process.env.SPECMEM_HOOK_COMPRESS) !== 'false',
  cooldownMs: parseInt(expandCwd(process.env.SPECMEM_HOOK_COOLDOWN) || '30000')
};

// ============================================================================
// Compression Functions - Use shared token-compressor
// ============================================================================

/**
 * Compress text to Traditional Chinese for token efficiency
 * Now uses the shared token-compressor.cjs for consistent compression
 */
function compressToTraditionalChinese(text) {
  if (!text || text.length < 20) return text;

  // Use shared compressor with no warning (we add our own tags)
  return compressHookOutput(text, {
    minLength: 20,
    includeWarning: false
  });
}

// ============================================================================
// Database Query Functions
// ============================================================================

/**
 * Search memories using pgvector similarity
 */
async function searchMemories(client, query, limit = CONFIG.maxMemories) {
  // First, get the embedding for the query by searching similar content
  // Since we can't generate embeddings directly, we do a text-based similarity search
  const sql = `
    WITH query_embedding AS (
      SELECT embedding
      FROM memories
      WHERE content ILIKE $1
      LIMIT 1
    )
    SELECT
      m.id,
      m.content,
      m.memory_type,
      m.importance,
      m.tags,
      m.created_at,
      CASE
        WHEN EXISTS (SELECT 1 FROM query_embedding) THEN
          1 - (m.embedding <=> (SELECT embedding FROM query_embedding))
        ELSE
          similarity(m.content, $2)
      END as similarity
    FROM memories m
    WHERE m.content IS NOT NULL
      AND length(m.content) > 20
    ORDER BY similarity DESC
    LIMIT $3
  `;

  try {
    const result = await client.query(sql, [`%${query.substring(0, 50)}%`, query, limit]);
    return result.rows.filter(r => r.similarity >= CONFIG.minSimilarity);
  } catch (error) {
    // Fallback to simple text search if vector search fails
    const fallbackSql = `
      SELECT
        id, content, memory_type, importance, tags, created_at,
        similarity(content, $1) as similarity
      FROM memories
      WHERE content ILIKE $2
      ORDER BY similarity DESC
      LIMIT $3
    `;
    const result = await client.query(fallbackSql, [query, `%${query}%`, limit]);
    return result.rows;
  }
}

/**
 * Get recent high-importance memories
 */
async function getRecentImportantMemories(client, limit = 3) {
  const sql = `
    SELECT id, content, memory_type, importance, tags, created_at
    FROM memories
    WHERE importance IN ('critical', 'high')
      AND created_at > NOW() - INTERVAL '7 days'
    ORDER BY
      CASE importance
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        ELSE 3
      END,
      created_at DESC
    LIMIT $1
  `;

  const result = await client.query(sql, [limit]);
  return result.rows;
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Format memories for context injection
 * FLATTENED: Uses pipe separators instead of newlines to avoid breaking Claude's formatting
 */
function formatMemories(memories, options = {}) {
  const { compress = CONFIG.enableCompression, maxLength = CONFIG.maxContentLength } = options;

  if (!memories || memories.length === 0) {
    return null;
  }

  // FLATTENED format: single line with pipe separators
  const parts = ['[SM-CTX]'];

  for (let i = 0; i < memories.length; i++) {
    const mem = memories[i];
    let content = mem.content || '';

    // Truncate if too long
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '...';
    }

    // Apply Chinese compression
    if (compress) {
      content = compressToTraditionalChinese(content);
    }

    // FLATTEN: Remove any embedded newlines in content
    content = content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

    // Format similarity as percentage if available
    const simStr = mem.similarity ? '(' + Math.round(mem.similarity * 100) + '%)' : '';
    const typeStr = mem.memory_type ? '[' + mem.memory_type + ']' : '';

    parts.push((i + 1) + '.' + simStr + typeStr + ' ' + content);
  }

  parts.push('[/SM-CTX]');

  // Join with pipe separator instead of newlines
  return parts.join(' | ');
}

// ============================================================================
// Hook Handler
// ============================================================================

/**
 * Main hook handler for UserPromptSubmit event
 */
async function handleUserPrompt(hookData) {
  const client = new Client(CONFIG.db);

  try {
    await client.connect();

    // Set search_path to project schema for proper isolation
    const projectPath = hookData?.cwd || process.env.SPECMEM_PROJECT_PATH || process.cwd();
    const dirName = path.basename(projectPath).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const schemaName = 'specmem_' + dirName;
    await client.query('SET search_path TO ' + schemaName + ', public');

    // Extract query from hook data
    const prompt = hookData?.prompt || hookData?.message || '';

    if (!prompt || prompt.length < 5) {
      return null;
    }

    // Check for memory-seeking patterns
    const memoryPatterns = [
      /remember|recall|previous|earlier|before|last time|mentioned/i,
      /what did|how did|when did|where did|why did/i,
      /context|history|background/i,
      /我們|之前|記得/  // Chinese patterns too
    ];

    const isMemorySeeking = memoryPatterns.some(p => p.test(prompt));

    let memories = [];

    if (isMemorySeeking) {
      // Search for relevant memories
      memories = await searchMemories(client, prompt, CONFIG.maxMemories);
    } else {
      // Just get recent important memories for general context
      memories = await getRecentImportantMemories(client, 3);
    }

    if (memories.length === 0) {
      return null;
    }

    // Format and output
    const context = formatMemories(memories);

    return context;

  } catch (error) {
    // Graceful fallback - don't disrupt Claude Code when DB unavailable
    return null;
  } finally {
    try {
      await client.end();
    } catch (e) {
      // Ignore disconnect errors - DB might not have been connected
    }
  }
}

// ============================================================================
// Claude Code Hook Interface
// ============================================================================

/**
 * Hook entry point - reads from stdin, outputs to stdout
 */
async function main() {
  // Read hook data from stdin
  let inputData = '';

  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  try {
    const hookData = JSON.parse(inputData);

    // CRITICAL: Update paths dynamically based on actual project cwd
    // Socket path was set at module load time with wrong cwd!
    if (hookData.cwd) {
      CONFIG.paths.embeddingSocket = getEmbeddingSocket(hookData.cwd);
      CONFIG.paths.runDir = getProjectSocketDir(hookData.cwd);
      CONFIG.paths.projectPath = hookData.cwd;
    }

    const context = await handleUserPrompt(hookData);

    if (context) {
      // Output to stdout for Claude to consume
      console.log(context);
    }

  } catch (error) {
    // Silent fail - don't disrupt Claude Code
  }
}

// Export for testing
module.exports = {
  handleUserPrompt,
  compressToTraditionalChinese,
  formatMemories,
  searchMemories,
  CONFIG,
  // Export path constants for external use
  SPECMEM_HOME,
  SPECMEM_PKG,
  SPECMEM_RUN_DIR,
  SPECMEM_EMBEDDING_SOCKET,
  SPECMEM_PROJECT_PATH,
  projectFilterEnabled
};

// Run if called directly
if (require.main === module) {
  main().catch(() => {
    process.exit(0); // Exit cleanly to not block Claude
  });
}
