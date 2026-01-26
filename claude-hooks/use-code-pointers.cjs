#!/usr/bin/env node
/**
 * Use Code Pointers Hook
 * ======================
 *
 * PreToolUse hook that auto-enriches Grep/Glob with code pointer context.
 *
 * Pattern:
 *   1st Grep/Glob - Allow through
 *   2nd Grep/Glob - RUN find_code_pointers, INJECT results, then ALLOW Grep/Glob
 *   3rd Grep/Glob - BLOCK and require find_code_pointers
 *
 * This gives Claude semantic code context alongside text-based search results.
 *
 * Hook Event: PreToolUse
 * Matcher: Grep, Glob
 *
 * @author hardwicksoftwareservices
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Import shared utilities
let expandCwd, getEmbeddingSocket, getSchemaName;
try {
  const paths = require('./specmem-paths.cjs');
  expandCwd = paths.expandCwd;
  getEmbeddingSocket = paths.getEmbeddingSocket;
  getSchemaName = paths.getSchemaName;
} catch (e) {
  expandCwd = (val) => val ? val.replace(/\$\{cwd\}/g, process.cwd()) : val;
  getEmbeddingSocket = (cwd) => path.join(cwd || process.cwd(), 'specmem', 'sockets', 'embeddings.sock');
  getSchemaName = (p) => 'specmem_' + path.basename(p || process.cwd()).toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

// Track call count in a temp file (persists across hook invocations)
const COUNTER_FILE = path.join(os.tmpdir(), 'specmem-grep-glob-counter.json');

// Config
const CONFIG = {
  maxResults: 5,
  threshold: 0.25,
  socketTimeout: 8000,
  dbHost: expandCwd(process.env.SPECMEM_DB_HOST) || 'localhost',
  dbPort: parseInt(expandCwd(process.env.SPECMEM_DB_PORT) || '5432'),
  dbName: expandCwd(process.env.SPECMEM_DB_NAME) || 'specmem_westayunprofessional',
  dbUser: expandCwd(process.env.SPECMEM_DB_USER) || 'specmem_westayunprofessional',
  dbPassword: expandCwd(process.env.SPECMEM_DB_PASSWORD) || 'specmem_westayunprofessional'
};

function getCounter() {
  try {
    if (fs.existsSync(COUNTER_FILE)) {
      const data = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8'));
      // Reset counter if it's been more than 10 minutes
      if (Date.now() - data.lastUpdate > 10 * 60 * 1000) {
        return { count: 0, lastUpdate: Date.now() };
      }
      return data;
    }
  } catch (e) {}
  return { count: 0, lastUpdate: Date.now() };
}

function incrementCounter() {
  const data = getCounter();
  data.count++;
  data.lastUpdate = Date.now();
  try {
    fs.writeFileSync(COUNTER_FILE, JSON.stringify(data));
  } catch (e) {}
  return data.count;
}

function resetCounter() {
  try {
    fs.writeFileSync(COUNTER_FILE, JSON.stringify({ count: 0, lastUpdate: Date.now() }));
  } catch (e) {}
}

// Check if find_code_pointers MCP is available
function isMcpAvailable() {
  try {
    const claudeJsonPath = path.join(os.homedir(), '.claude.json');
    if (fs.existsSync(claudeJsonPath)) {
      const claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
      const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
      const projectConfig = claudeJson.projects?.[projectPath];
      if (projectConfig?.mcpServers?.specmem) return true;
      if (claudeJson.mcpServers?.specmem) return true;
    }
  } catch (e) {}
  return false;
}

// Generate embedding via socket
async function generateEmbedding(text, socketPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(socketPath)) {
      reject(new Error('Embedding socket not found'));
      return;
    }

    const socket = new net.Socket();
    let buffer = '';
    socket.setTimeout(CONFIG.socketTimeout);

    socket.connect(socketPath, () => {
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

// Search code definitions using embeddings
async function searchCodePointers(query, projectPath) {
  try {
    const socketPath = getEmbeddingSocket(projectPath);
    const embedding = await generateEmbedding(query, socketPath);
    const embStr = `[${embedding.join(',')}]`;
    const schemaName = getSchemaName(projectPath);

    const sql = `
      SET search_path TO ${schemaName}, public;
      SELECT
        name, definition_type, file_path, start_line,
        LEFT(signature, 150) as signature,
        ROUND((1 - (embedding <=> '${embStr}'::vector))::numeric * 100, 1) as relevancy
      FROM code_definitions
      WHERE 1 - (embedding <=> '${embStr}'::vector) > ${CONFIG.threshold}
        AND embedding IS NOT NULL
      ORDER BY relevancy DESC
      LIMIT ${CONFIG.maxResults}
    `;

    const result = execSync(
      `PGPASSWORD='${CONFIG.dbPassword}' psql -h ${CONFIG.dbHost} -p ${CONFIG.dbPort} -U ${CONFIG.dbUser} -d ${CONFIG.dbName} -t -A -F '|' -c "${sql.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8', timeout: 8000 }
    );

    return result.trim().split('\n').filter(Boolean).map(line => {
      const [name, type, file, startLine, sig, rel] = line.split('|');
      return { name, type, file, startLine, signature: sig, relevancy: parseFloat(rel) || 0 };
    }).filter(r => r.name && r.file && r.relevancy > CONFIG.threshold * 100);
  } catch (e) {
    return [];
  }
}

// Format code pointers for injection
function formatCodePointers(pointers, query) {
  if (!pointers.length) return '';

  const header = `[SM-CODE-INJECT] find_code_pointers("${query.slice(0, 40)}") - ${pointers.length} results`;
  const results = pointers.map((p, i) => {
    const sig = p.signature ? p.signature.replace(/\n/g, ' ').slice(0, 80) : '';
    return `${i+1}.[${p.relevancy}%] ${p.name}(${p.type}) ${p.file}:${p.startLine}${sig ? ' - ' + sig : ''}`;
  }).join(' | ');

  return `${header} | ${results} | [/SM-CODE-INJECT] Use find_code_pointers for full context`;
}

async function main() {
  // Read input from stdin
  const input = await new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        resolve({});
      }
    });
  });

  const toolName = input.tool_name || '';
  const projectPath = input.cwd || process.cwd();

  // If find_code_pointers is being used, RESET the counter (reward good behavior!)
  if (toolName === 'mcp__specmem__find_code_pointers') {
    resetCounter();
    console.log(JSON.stringify({ decision: 'approve' }));
    return;
  }

  // Only process Grep and Glob
  if (toolName !== 'Grep' && toolName !== 'Glob') {
    console.log(JSON.stringify({ decision: 'approve' }));
    return;
  }

  // Check if MCP is available
  if (!isMcpAvailable()) {
    console.log(JSON.stringify({ decision: 'approve' }));
    return;
  }

  // Increment counter
  const count = incrementCounter();
  const phase = count % 3;  // 1=allow, 2=inject+allow, 0=block

  const query = input.tool_input?.pattern || '';

  // 2nd call (phase 2): INJECT code pointers and ALLOW
  if (phase === 2) {
    let message = `⚠️ 2nd search - auto-injecting code context. Next search will be BLOCKED.`;

    if (query.length >= 3) {
      try {
        const pointers = await searchCodePointers(query, projectPath);
        if (pointers.length > 0) {
          message = formatCodePointers(pointers, query);
        } else {
          message = `[SM-CODE-INJECT] No code matches for "${query.slice(0, 40)}" (try find_code_pointers for semantic search)`;
        }
      } catch (e) {
        message = `⚠️ Code search failed - use find_code_pointers MCP tool for semantic results`;
      }
    }

    console.log(JSON.stringify({
      decision: 'approve',
      message: message
    }));
    return;
  }

  // 3rd call (phase 0): BLOCK and require find_code_pointers
  if (phase === 0) {
    const reason = `🚫 Search blocked! Use find_code_pointers MCP tool instead.

Instead of ${toolName}, use:
  mcp__specmem__find_code_pointers({query: "${query || 'your search term'}", limit: 10})

find_code_pointers understands code MEANING, not just text patterns.`;

    console.log(JSON.stringify({
      decision: 'block',
      reason: reason
    }));
    return;
  }

  // 1st call (phase 1): Allow through normally
  console.log(JSON.stringify({ decision: 'approve' }));
}

main().catch(err => {
  console.error('Hook error:', err);
  // On error, approve to avoid blocking
  console.log(JSON.stringify({ decision: 'approve' }));
});
