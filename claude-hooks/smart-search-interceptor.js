#!/usr/bin/env node
/**
 * SMART SEARCH INTERCEPTOR - PreToolUse Hook
 * ==========================================
 *
 * Intercepts Grep/Glob tool calls and:
 * 1. EXECUTES the command ourselves
 * 2. COMPACTS output through smartCompactor
 * 3. INJECTS relevant code memories (>25% file-specific, >30% general)
 * 4. BLOCKS original command, returns enriched compacted result
 *
 * RESULT:  gets compacted search + code context = fewer tokens!
 *
 * Hook Event: PreToolUse
 * Triggers On: Grep, Glob
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

// Import shared path resolution utilities
let expandCwd, getProjectSocketDir, getEmbeddingSocket;
try {
  const paths = require('./specmem-paths.cjs');
  expandCwd = paths.expandCwd;
  getProjectSocketDir = paths.getProjectSocketDir;
  getEmbeddingSocket = paths.getEmbeddingSocket;
} catch (e) {
  expandCwd = (val) => val ? val.replace(/\$\{cwd\}/g, process.cwd()) : val;
  getProjectSocketDir = () => path.join(process.cwd(), 'specmem', 'sockets');
  getEmbeddingSocket = (cwd) => path.join(cwd || process.cwd(), 'specmem', 'sockets', 'embeddings.sock');
}

// Token compressor
let compressHookOutput;
try {
  compressHookOutput = require('./token-compressor.cjs').compressHookOutput;
} catch (e) {
  compressHookOutput = (text) => text;
}

// Project path - updated dynamically
let PROJECT_PATH = expandCwd(process.env.SPECMEM_PROJECT_PATH) || process.cwd() || '/';

// TASK #23 FIX: Use unified credential pattern with SPECMEM_PASSWORD fallback
const UNIFIED_DEFAULT = 'specmem_westayunprofessional';
const unifiedCred = expandCwd(process.env.SPECMEM_PASSWORD) || UNIFIED_DEFAULT;

// Configuration
const CONFIG = {
  maxResults: 5,
  thresholdFileSpecific: 0.25,  // 25% for file-specific searches
  thresholdGeneral: 0.30,       // 30% for general searches
  socketTimeout: 10000,
  maxOutputLines: 100,

  dbHost: expandCwd(process.env.SPECMEM_DB_HOST) || 'localhost',
  dbPort: parseInt(expandCwd(process.env.SPECMEM_DB_PORT) || '5432'),
  dbName: expandCwd(process.env.SPECMEM_DB_NAME) || unifiedCred,
  dbUser: expandCwd(process.env.SPECMEM_DB_USER) || unifiedCred,
  dbPassword: expandCwd(process.env.SPECMEM_DB_PASSWORD) || unifiedCred,

  embeddingSocket: getEmbeddingSocket()
};


// ============================================================================
// Execute the actual Grep/Glob command
// ============================================================================

function executeGrepCommand(toolInput) {
  try {
    const pattern = toolInput.pattern || '';
    const searchPath = toolInput.path || PROJECT_PATH;
    const outputMode = toolInput.output_mode || 'files_with_matches';
    const caseInsensitive = toolInput['-i'] ? '-i' : '';
    const context = toolInput['-C'] ? `-C ${toolInput['-C']}` : '';
    const fileType = toolInput.type ? `--type ${toolInput.type}` : '';
    const glob = toolInput.glob ? `--glob '${toolInput.glob}'` : '';

    let rgFlags = '-n --color=never';
    if (outputMode === 'files_with_matches') rgFlags += ' -l';
    if (outputMode === 'count') rgFlags += ' -c';

    const cmd = `rg ${rgFlags} ${caseInsensitive} ${context} ${fileType} ${glob} '${pattern.replace(/'/g, "\\'")}' '${searchPath}' 2>/dev/null | head -${CONFIG.maxOutputLines}`;

    //`Executing grep: ${cmd}`);
    const result = execSync(cmd, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    return result.trim();
  } catch (e) {
    if (e.status === 1) return ''; // No matches
    //`Grep error: ${e.message}`);
    return '';
  }
}

function executeGlobCommand(toolInput) {
  try {
    const pattern = toolInput.pattern || '';
    const searchPath = toolInput.path || PROJECT_PATH;

    // Use find with pattern matching
    const cmd = `find '${searchPath}' -type f -path '*${pattern.replace(/\*\*/g, '*').replace(/'/g, "\\'")}' 2>/dev/null | head -${CONFIG.maxOutputLines}`;

    //`Executing glob: ${cmd}`);
    const result = execSync(cmd, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    return result.trim();
  } catch (e) {
    //`Glob error: ${e.message}`);
    return '';
  }
}

// ============================================================================
// Embedding + Code Search
// ============================================================================

async function generateEmbedding(text) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';
    socket.setTimeout(CONFIG.socketTimeout);

    socket.connect(CONFIG.embeddingSocket, () => {
      socket.write(JSON.stringify({ type: 'embed', text }) + '\n');
    });

    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const resp = JSON.parse(line);
          if (resp.status === 'processing') continue;
          if (resp.embedding) {
            socket.end();
            resolve(resp.embedding);
            return;
          } else if (resp.error) {
            socket.end();
            reject(new Error(resp.error));
            return;
          }
        } catch (e) {}
      }
    });

    socket.on('error', reject);
    socket.on('timeout', () => reject(new Error('timeout')));
  });
}

function extractFilePath(query) {
  const patterns = [
    /(?:^|\s)([\/~][\w\/.-]+\.\w+)(?:\s|$|:)/,
    /(?:^|\s)([\w-]+\/[\w\/.-]+\.\w+)(?:\s|$|:)/,
    /(?:^|\s)(src\/[\w\/.-]+)(?:\s|$|:)/,
    /(?:^|\s)(lib\/[\w\/.-]+)(?:\s|$|:)/,
  ];
  for (const pat of patterns) {
    const m = query.match(pat);
    if (m) return m[1];
  }
  return null;
}

async function searchCodeMemories(query) {
  try {
    const embedding = await generateEmbedding(query);
    const embStr = `[${embedding.join(',')}]`;

    const filePath = extractFilePath(query);
    const threshold = filePath ? CONFIG.thresholdFileSpecific : CONFIG.thresholdGeneral;

    let fileFilter = '';
    if (filePath) {
      fileFilter = `AND file_path ILIKE '%${filePath.replace(/'/g, "''")}%'`;
    }

    // Compute schema name from project path for proper isolation
    const dirName = path.basename(PROJECT_PATH).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const schemaName = 'specmem_' + dirName;

    const sql = `
      SET search_path TO ${schemaName}, public;
      SELECT
        name, definition_type, file_path, start_line, end_line,
        LEFT(signature, 200) as signature,
        ROUND((1 - (embedding <=> '${embStr}'::vector))::numeric * 100, 1) as relevancy
      FROM code_definitions
      WHERE 1 - (embedding <=> '${embStr}'::vector) > ${threshold}
        AND embedding IS NOT NULL
        ${fileFilter}
      ORDER BY relevancy DESC
      LIMIT ${CONFIG.maxResults}
    `;

    const result = execSync(
      `PGPASSWORD='${CONFIG.dbPassword}' psql -h ${CONFIG.dbHost} -p ${CONFIG.dbPort} -U ${CONFIG.dbUser} -d ${CONFIG.dbName} -t -A -F '|' -c "${sql.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8', timeout: 8000 }
    );

    return result.trim().split('\n').filter(Boolean).map(line => {
      const [name, type, file, startLine, endLine, sig, rel] = line.split('|');
      return { name, type, file, startLine, endLine, signature: sig, relevancy: parseFloat(rel) || 0 };
    }).filter(r => r.name && r.file && r.relevancy > threshold * 100);
  } catch (e) {
    //`Code search error: ${e.message}`);
    return [];
  }
}

// ============================================================================
// Format Output
// ============================================================================

/**
 * Format enriched output - FLATTENED single line with pipe separators
 * Avoids newlines that could break 's context formatting
 */
function formatEnrichedOutput(toolOutput, codeMemories, toolName, query) {
  const parts = [];

  // Header
  parts.push('[SM-SEARCH] ' + toolName + ' enriched');

  // Tool output (compacted) - flatten to single line
  if (toolOutput) {
    const outputLines = toolOutput.split('\n').filter(l => l.trim());
    const shown = outputLines.slice(0, 15);
    // FLATTEN: Join output lines with semicolons
    parts.push(toolName + '(' + outputLines.length + '): ' + shown.join('; ') + (outputLines.length > 15 ? '...(+' + (outputLines.length - 15) + ')' : ''));
  } else {
    parts.push(toolName + ': No matches');
  }

  // Code memories - flatten
  if (codeMemories.length > 0) {
    const threshold = codeMemories[0].relevancy > 25 ? '25' : '30';
    const memParts = codeMemories.map((m, i) => {
      // FLATTEN: Remove any embedded newlines in signature
      const sig = m.signature ? m.signature.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
      return (i+1) + '.[' + m.relevancy + '%] ' + m.name + '(' + m.type + ') ' + m.file + ':' + m.startLine + (sig ? ' ' + sig : '');
    });
    parts.push('Code(>' + threshold + '%): ' + memParts.join('; '));
  }

  parts.push('[/SM-SEARCH] find_code_pointers(zoom=N)');

  // Join with pipe separator instead of newlines
  return parts.join(' | ');
}

// ============================================================================
// Read stdin with timeout
// ============================================================================

function readStdinWithTimeout(timeoutMs = 5000) {
  return new Promise((resolve) => {
    let input = '';
    const timer = setTimeout(() => {
      process.stdin.destroy();
      resolve(input);
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(input); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(input); });
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  //'=== Search Interceptor started ===');

  const input = await readStdinWithTimeout(5000);

  let hookData;
  try {
    hookData = JSON.parse(input);
  } catch (e) {
    process.exit(0);
  }

  const toolName = hookData.tool_name || '';
  const toolInput = hookData.tool_input || {};

  // Only intercept Grep and Glob
  if (!['Grep', 'Glob'].includes(toolName)) {
    process.exit(0);
  }

  // Update paths
  if (hookData.cwd) {
    PROJECT_PATH = hookData.cwd;
    CONFIG.embeddingSocket = getEmbeddingSocket(hookData.cwd);
  }

  //`Intercepting ${toolName}: ${JSON.stringify(toolInput).slice(0, 200)}`);

  try {
    // 1. Execute the command ourselves
    let toolOutput = '';
    if (toolName === 'Grep') {
      toolOutput = executeGrepCommand(toolInput);
    } else if (toolName === 'Glob') {
      toolOutput = executeGlobCommand(toolInput);
    }

    //`Tool output: ${toolOutput.length} chars`);

    // 2. Search for relevant code memories
    const query = toolInput.pattern || '';
    let codeMemories = [];
    if (query.length >= 3) {
      try {
        codeMemories = await searchCodeMemories(query);
        //`Code memories: ${codeMemories.length}`);
      } catch (e) {
        //`Code search failed: ${e.message}`);
      }
    }

    // 3. Format enriched output
    const enriched = formatEnrichedOutput(toolOutput, codeMemories, toolName, query);

    // 4. Compact with smartCompactor - add Chinese warning header
    const chineseWarning = '\u26a0\ufe0f\u58d3\u7e2e:\u7e41\u4e2d\u2192EN | ';  // ⚠️壓縮:繁中→EN |
    const compacted = chineseWarning + compressHookOutput(enriched, {
      threshold: 0.50,
      minLength: 50,
      preserveStructure: true,
      includeWarning: false  // We added our own warning
    });

    // 5. BLOCK original command, return our result
    // PreToolUse hooks return JSON with decision
    const response = {
      decision: 'block',
      reason: compacted
    };

    console.log(JSON.stringify(response));

  } catch (e) {
    //`Error: ${e.message}`);
    // On error, let the original command run
    process.exit(0);
  }

  //'=== Search Interceptor finished ===');
  process.exit(0);
}

main().catch(e => {
  //`Fatal: ${e.message}`);
  process.exit(0);
});
