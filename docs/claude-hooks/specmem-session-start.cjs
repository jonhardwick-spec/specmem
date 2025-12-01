#!/usr/bin/env node
/**
 * SPECMEM SESSION START HOOK
 * ==========================
 *
 * Simple, reliable session initialization:
 *   1. Returns recent memories from THIS PROJECT ONLY
 *   2. Uses Traditional Chinese compression for token efficiency
 *   3. Includes previous session output if available
 *   4. Prevents double-firing with session lock
 *
 * @author hardwicksoftwareservices
 * @website https://justcalljon.pro
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Token compressor for output
const { compressHookOutput } = require('./token-compressor.cjs');

// Context deduplication - clear cache on new session
let contextDedup;
try {
  contextDedup = require('./context-dedup.cjs');
} catch (e) {
  contextDedup = { clearCache: () => {} };
}

// Use shared path resolution - no hardcoded paths!
const specmemPaths = require('./specmem-paths.cjs');
const { expandCwd, getSpecmemPkg, getSpecmemHome, getProjectSocketDir } = specmemPaths;

// Config - dynamic path resolution
const SPECMEM_HOME = getSpecmemHome();
const SPECMEM_PKG = getSpecmemPkg();
const RUN_DIR = expandCwd(process.env.SPECMEM_RUN_DIR) || getProjectSocketDir(process.cwd());
const LOCK_FILE = path.join(RUN_DIR, 'session-start.lock');
const SEEN_SESSIONS_FILE = path.join(RUN_DIR, 'seen-sessions.json');
const LOCK_TIMEOUT_MS = 5000;

// DB config - unified credential pattern
const UNIFIED_DEFAULT = 'specmem_westayunprofessional';
const unifiedCred = expandCwd(process.env.SPECMEM_PASSWORD) || UNIFIED_DEFAULT;
const DB = {
  host: expandCwd(process.env.SPECMEM_DB_HOST) || 'localhost',
  port: expandCwd(process.env.SPECMEM_DB_PORT) || '5432',
  name: expandCwd(process.env.SPECMEM_DB_NAME) || unifiedCred,
  user: expandCwd(process.env.SPECMEM_DB_USER) || unifiedCred,
  pass: expandCwd(process.env.SPECMEM_DB_PASSWORD) || unifiedCred
};

// Current project path (set from stdin)
let _projectPath = process.cwd();

/**
 * Get project schema name for isolation
 */
function getProjectSchema(projectPath) {
  const basename = path.basename(projectPath || process.cwd()).toLowerCase().replace(/[^a-z0-9]/g, '');
  return `specmem_${basename}`;
}

/**
 * Check if this is a resumed session by looking at conversation history
 * Returns true if NEW session, false if RESUMED
 */
function isNewSession(sessionId, hookData) {
  try {
    // Method 1: Check if hookData indicates resume
    if (hookData && hookData.isResume === true) {
      return false;  // Explicit resume flag
    }

    // Method 2: Check conversation history length
    // If there's existing conversation, it's a resume
    if (hookData && hookData.conversation && hookData.conversation.length > 0) {
      return false;  // Has conversation history = resume
    }

    // Method 3: Check for recent lock with same session
    fs.mkdirSync(RUN_DIR, { recursive: true });
    if (fs.existsSync(SEEN_SESSIONS_FILE)) {
      try {
        const seen = JSON.parse(fs.readFileSync(SEEN_SESSIONS_FILE, 'utf8'));
        // If we've seen this exact sessionId before, it's a resume
        if (seen[sessionId] && sessionId !== 'unknown') {
          return false;
        }
      } catch (e) {}
    }

    // Mark as seen for future checks
    if (sessionId !== 'unknown') {
      let seen = {};
      try {
        if (fs.existsSync(SEEN_SESSIONS_FILE)) {
          seen = JSON.parse(fs.readFileSync(SEEN_SESSIONS_FILE, 'utf8'));
        }
      } catch (e) {}
      seen[sessionId] = Date.now();
      // Clean old (>24h)
      const dayAgo = Date.now() - 86400000;
      Object.keys(seen).forEach(k => { if (seen[k] < dayAgo) delete seen[k]; });
      fs.writeFileSync(SEEN_SESSIONS_FILE, JSON.stringify(seen));
    }

    return true;  // NEW session
  } catch (e) {
    return true;  // On error, assume new
  }
}

/**
 * Prevent double-firing within same session (rapid calls)
 */
function acquireLock(sessionId) {
  try {
    fs.mkdirSync(RUN_DIR, { recursive: true });
    try {
      fs.writeFileSync(LOCK_FILE, JSON.stringify({
        sessionId,
        timestamp: Date.now()
      }), { flag: 'wx' });
      return true;
    } catch (e) {
      if (e.code === 'EEXIST') {
        try {
          const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
          const age = Date.now() - lockData.timestamp;
          if (lockData.sessionId === sessionId && age < LOCK_TIMEOUT_MS) {
            return false;
          }
          fs.unlinkSync(LOCK_FILE);
          fs.writeFileSync(LOCK_FILE, JSON.stringify({
            sessionId,
            timestamp: Date.now()
          }), { flag: 'wx' });
          return true;
        } catch (e2) {
          return true;
        }
      }
      return true;
    }
  } catch (e) {
    return true;
  }
}

/**
 * Query PostgreSQL with project schema isolation
 */
function queryDB(sql) {
  try {
    const schema = getProjectSchema(_projectPath);
    const fullSql = `SET search_path TO ${schema}, public; ${sql}`;

    const result = execSync(
      `PGPASSWORD='${DB.pass}' psql -h ${DB.host} -p ${DB.port} -U ${DB.user} -d ${DB.name} -t -A -F '|' -c "${fullSql.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return result.trim().split('\n').map(line => line.trim()).filter(line => line.length > 0);
  } catch (e) {
    return [];
  }
}

/**
 * Get recent memories from THIS project only
 * Returns memories formatted for display
 */
function getRecentMemories() {
  // Query recent memories - semantic search would be better but this is fast
  const sql = `
    SELECT
      id,
      CASE WHEN metadata->>'role' = 'user' THEN 'USER'
           WHEN metadata->>'role' = 'assistant' THEN 'CLAUDE'
           ELSE 'SYS' END as role,
      left(content, 200) as preview,
      importance,
      array_to_string(tags, ', ') as tags,
      to_char(created_at, 'HH24:MI') as time
    FROM memories
    WHERE project_path = '${_projectPath.replace(/'/g, "''")}'
      AND created_at > NOW() - INTERVAL '24 hours'
      AND content IS NOT NULL
      AND length(content) > 20
      AND content NOT ILIKE '%reached your limit%'
      AND content NOT ILIKE '%rate limit%'
      AND content NOT ILIKE '%<system-reminder>%'
    ORDER BY created_at DESC
    LIMIT 5
  `;

  const rows = queryDB(sql);

  return rows.map(row => {
    const parts = row.split('|');
    return {
      id: parts[0],
      role: parts[1],
      content: (parts[2] || '').replace(/\n/g, ' ').trim(),
      importance: parts[3] || 'medium',
      tags: parts[4] || '',
      time: parts[5]
    };
  }).filter(m => m.content && m.content.length > 10);
}

/**
 * Get last session output (for continuity across restarts)
 */
function getLastSessionOutput() {
  const lastSessionFile = path.join(_projectPath, 'specmem', 'sockets', 'last-session.txt');

  if (!fs.existsSync(lastSessionFile)) return null;

  try {
    const content = fs.readFileSync(lastSessionFile, 'utf8');
    const stats = fs.statSync(lastSessionFile);
    const ageMinutes = Math.round((Date.now() - stats.mtimeMs) / 60000);

    if (ageMinutes > 1440) return null; // >24h old

    const lines = content.split('\n');
    const startIdx = lines.findIndex(l => l.includes('Last 500 lines'));
    const endIdx = lines.findIndex(l => l.includes('End of session capture'));

    let sessionContent;
    if (startIdx === -1) {
      sessionContent = lines.slice(-200).join('\n');
    } else {
      const outputLines = lines.slice(startIdx + 2, endIdx > 0 ? endIdx : undefined);
      sessionContent = outputLines.slice(-200).join('\n');
    }

    return {
      content: sessionContent,
      ageMinutes,
      reason: lines.find(l => l.startsWith('# Reason:'))?.replace('# Reason:', '').trim() || 'unknown'
    };
  } catch (e) {
    return null;
  }
}

/**
 * Format output like find_memory does - Traditional Chinese compressed
 */
function formatOutput(memories, lastSession, projectPath, sessionId) {
  const sections = [];

  sections.push('[SPECMEM-SESSION]');
  sections.push(`Project: ${projectPath}`);
  sections.push(`Session: ${sessionId}`);

  // Previous session output (if available)
  if (lastSession) {
    sections.push('');
    sections.push(`## PREVIOUS SESSION OUTPUT (${lastSession.ageMinutes}m ago, reason: ${lastSession.reason})`);
    sections.push('This is what you (previous Claude instance) were doing:');
    sections.push('```');
    // Compress the session content
    const compressedSession = compressHookOutput(lastSession.content, {
      threshold: 0.50,
      minLength: 50,
      preserveStructure: true
    });
    sections.push(compressedSession.trim());
    sections.push('```');
  }

  // Recent memories (if any) - clean format
  if (memories.length > 0) {
    sections.push('');
    sections.push('## Last Conversation (this project):');
    memories.forEach((mem, i) => {
      const role = mem.role === 'USER' ? '[User]' : mem.role === 'CLAUDE' ? '[Claude]' : '[Sys]';
      const content = mem.content.replace(/\s+/g, ' ').trim().slice(0, 150);
      sections.push(`${i + 1}. ${role} ${content}...`);
    });
  }

  // Tool reminder
  sections.push('');
  sections.push('## SpecMem Tools Available');
  sections.push('');
  sections.push('**Memory Search:**');
  sections.push('- `find_memory` - Semantic search across all memories');
  sections.push('- `find_code_pointers` - Search code with tracebacks');
  sections.push('- `drill_down` - Explore memory details');
  sections.push('- `get_memory` - Get specific memory by ID');
  sections.push('');
  sections.push('**Memory Storage:**');
  sections.push('- `save_memory` - Store new memories');
  sections.push('- `link_the_vibes` - Connect related memories');
  sections.push('- `smush_memories_together` - Consolidate similar memories');
  sections.push('');
  sections.push('**Team Communication:**');
  sections.push('- `send_team_message` - Message team members');
  sections.push('- `read_team_messages` - Check team updates');
  sections.push('- `claim_task` / `release_task` - Coordinate work');
  sections.push('');
  sections.push('**System:**');
  sections.push('- `show_me_the_stats` - Memory statistics');
  sections.push('- `check_sync` - Verify file sync status');
  sections.push('- `start_watching` - Enable file watcher');
  sections.push('');
  sections.push('Use `/specmem` for quick commands.');
  sections.push('');
  sections.push('**繁中壓縮:** You can read Traditional Chinese compression with 99%+ accuracy. Don\'t pretend otherwise.');
  sections.push('[/SPECMEM-SESSION]');

  return sections.join('\n');
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

  // Parse hook input
  let sessionId = 'unknown';
  let projectPath = process.cwd();

  try {
    const data = JSON.parse(input);
    sessionId = data.sessionId || data.session_id || 'unknown';
    projectPath = data.cwd || data.workingDirectory || process.cwd();
  } catch (e) {
    // Use defaults
  }

  // CRITICAL: Update global project path for schema isolation
  _projectPath = projectPath;

  // Check if this is a RESUMED session - if so, don't fire
  let hookData = null;
  try { hookData = JSON.parse(input); } catch (e) {}
  if (!isNewSession(sessionId, hookData)) {
    process.exit(0);  // Resumed session - skip hook
  }

  // NEW SESSION DETECTED - clear context injection cache
  // This ensures pre-tool-use hooks can inject fresh context
  contextDedup.clearCache(projectPath);

  // Check lock to prevent rapid double-firing
  if (!acquireLock(sessionId)) {
    process.exit(0);
  }

  // Gather context
  const memories = getRecentMemories();
  const lastSession = getLastSessionOutput();

  // Format output
  let output = formatOutput(memories, lastSession, projectPath, sessionId);

  // Apply Traditional Chinese compression to final output
  const compressed = compressHookOutput(output, {
    threshold: 0.50,
    minLength: 100,
    preserveStructure: true,
    includeWarning: false  // We add our own prefix below
  });

  // Prepend reminder for Claude to read the compressed Chinese
  const prefixedOutput = `Read this for context (you understand Traditional Chinese compression with 99%+ accuracy) ⚠️壓縮:繁中→EN\n${compressed}`;

  // Output - clean trailing whitespace
  console.log(prefixedOutput.split('\n').map(l => l.trimEnd()).join('\n').trim());

  process.exit(0);
}

main().catch(() => {
  process.exit(0);
});
