#!/usr/bin/env node
/**
 * SPECMEM PRE-COMPACTION HOOK
 * ===========================
 *
 * Fires before context compaction to:
 *   1. Save critical context to SpecMem
 *   2. Warn when at 5% till compaction
 *   3. Preserve key decisions and code state
 *
 * @author hardwicksoftwareservices
 * @website https://justcalljon.pro
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Shared path resolution
const specmemPaths = require('./specmem-paths.cjs');

// Token compressor for output
const { compressHookOutput } = require('./token-compressor.cjs');

// Context deduplication - clear cache on compaction (session boundary)
let contextDedup;
try {
  contextDedup = require('./context-dedup.cjs');
} catch (e) {
  contextDedup = { clearCache: () => {} };
}




// Config - all paths are project-relative by default
const SPECMEM_HOME = specmemPaths.getSpecmemHome();
const SPECMEM_PKG = specmemPaths.getSpecmemPkg();
const RUN_DIR = specmemPaths.expandCwd(process.env.SPECMEM_RUN_DIR) || specmemPaths.getProjectSocketDir();

// TASK #23 FIX: Use unified credential pattern with SPECMEM_PASSWORD fallback
const UNIFIED_DEFAULT = 'specmem_westayunprofessional';
const unifiedCred = specmemPaths.expandCwd(process.env.SPECMEM_PASSWORD) || UNIFIED_DEFAULT;

// DB config - unified credential pattern
const DB = {
  host: specmemPaths.expandCwd(process.env.SPECMEM_DB_HOST) || 'localhost',
  port: specmemPaths.expandCwd(process.env.SPECMEM_DB_PORT) || '5432',
  name: specmemPaths.expandCwd(process.env.SPECMEM_DB_NAME) || unifiedCred,
  user: specmemPaths.expandCwd(process.env.SPECMEM_DB_USER) || unifiedCred,
  pass: specmemPaths.expandCwd(process.env.SPECMEM_DB_PASSWORD) || unifiedCred
};

/**
 * Save a critical memory
 */
function saveCriticalMemory(content, tags = []) {
  const escapedContent = content.replace(/'/g, "''").replace(/\n/g, '\\n');
  const tagsArray = `{${tags.map(t => `"${t}"`).join(',')}}`;

  const sql = `
    INSERT INTO memories (content, memory_type, importance, tags, metadata)
    VALUES ('${escapedContent}', 'episodic', 'critical', '${tagsArray}',
            '{"source": "precompact_hook", "timestamp": "${new Date().toISOString()}"}'::jsonb)
    RETURNING id
  `;

  try {
    execSync(
      `PGPASSWORD='${DB.pass}' psql -h ${DB.host} -p ${DB.port} -U ${DB.user} -d ${DB.name} -t -A -c "${sql.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Main hook handler
 */
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
  // CRIT-07 FIX: Read input with timeout instead of indefinite for-await
  let input = await readStdinWithTimeout(5000);

  // Parse hook input
  let messageCount = 0;
  let tokenCount = 0;
  let compactionTarget = 0;
  let projectPath = process.cwd();

  try {
    const data = JSON.parse(input);
    messageCount = data.messageCount || 0;
    tokenCount = data.tokenCount || 0;
    compactionTarget = data.compactionTarget || 0;
    projectPath = data.workingDirectory || data.cwd || process.cwd();
  } catch (e) {
    // Use defaults
  }

  // COMPACTION = SESSION BOUNDARY - clear context injection cache
  // This ensures pre-tool-use hooks can inject fresh context after compaction
  contextDedup.clearCache(projectPath);

  // Calculate percentage remaining
  const percentRemaining = compactionTarget > 0
    ? Math.round((1 - tokenCount / compactionTarget) * 100)
    : 100;

  // Build output
  let output = '';

  // Warning at 5% or less
  if (percentRemaining <= 5) {
    output += `\n⚠️ COMPACTION IMMINENT (${percentRemaining}% context remaining)\n`;
    output += `Messages: ${messageCount} | Tokens: ${tokenCount}/${compactionTarget}\n`;
    output += `Critical context will be saved to SpecMem.\n\n`;

    // Save compaction event
    const summary = `Pre-compaction state: ${messageCount} messages, ${tokenCount} tokens, project: ${projectPath}`;
    saveCriticalMemory(summary, ['compaction', 'system', path.basename(projectPath)]);
  } else if (percentRemaining <= 15) {
    output += `\n📊 Context usage: ${100 - percentRemaining}% (${tokenCount}/${compactionTarget} tokens)\n`;
    output += `Consider using /specmem-remember to save important context.\n\n`;
  }

  // If we have actual content to preserve, save it
  // The hook receives conversation summary in some cases
  if (input.length > 500) {
    // Save truncated version of current context
    const contextSummary = input.slice(0, 2000);
    saveCriticalMemory(
      `Context before compaction:\n${contextSummary}`,
      ['precompact', 'context', path.basename(projectPath)]
    );
  }

  // Output warning/status with compression
  if (output) {
    // Compress but skip warning header since this IS a warning
    const compressed = compressHookOutput(output, {
      threshold: 0.70,
      minLength: 30,
      includeWarning: true  // Still remind  to respond in English
    });
    console.log(compressed);
  }

  process.exit(0);
}

main().catch((e) => {
  // LOW-44 FIX: Log errors before exit
  console.error('[specmem-precompact] Unhandled error:', e.message || e);
  process.exit(0);
});
