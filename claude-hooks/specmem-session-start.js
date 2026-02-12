#!/usr/bin/env node
/**
 * SPECMEM SESSION START HOOK
 * ==========================
 *
 * Comprehensive session initialization:
 *   1. Returns last 3 user/Claude messages (per project)
 *   2. Returns last 3 code modifications (per project)
 *   3. Reminds Claude how to use SpecMem tools
 *   4. Detects compaction status
 *   5. Prevents double-firing with session lock
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

// Use shared path resolution - no hardcoded paths!
const specmemPaths = require('./specmem-paths.cjs');
const { expandCwd, getSpecmemPkg, getSpecmemHome, getProjectSocketDir } = specmemPaths;

// Config - dynamic path resolution
const SPECMEM_HOME = getSpecmemHome();
const SPECMEM_PKG = getSpecmemPkg();
const RUN_DIR = expandCwd(process.env.SPECMEM_RUN_DIR) || getProjectSocketDir(process.cwd());
const LOCK_FILE = path.join(RUN_DIR, 'session-start.lock');
const LOCK_TIMEOUT_MS = 5000; // 5 second lock timeout

// DB config for direct queries
const DB = {
  host: expandCwd(process.env.SPECMEM_DB_HOST) || 'localhost',
  port: expandCwd(process.env.SPECMEM_DB_PORT) || '5432',
  name: expandCwd(process.env.SPECMEM_DB_NAME) || 'specmem',
  user: expandCwd(process.env.SPECMEM_DB_USER) || 'specmem',
  pass: expandCwd(process.env.SPECMEM_DB_PASSWORD) || 'specmem'
};

/**
 * Prevent double-firing with lock file
 * MED-27 FIX: Uses atomic 'wx' flag instead of TOCTOU check-then-write
 */
function acquireLock(sessionId) {
  try {
    fs.mkdirSync(RUN_DIR, { recursive: true });

    // MED-27 FIX: Use atomic 'wx' flag instead of TOCTOU pattern
    try {
      fs.writeFileSync(LOCK_FILE, JSON.stringify({
        sessionId,
        timestamp: Date.now()
      }), { flag: 'wx' }); // wx = create exclusive, fail if exists
      return true;
    } catch (e) {
      if (e.code === 'EEXIST') {
        // Lock file exists - check if it's stale or same session
        try {
          const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
          const age = Date.now() - lockData.timestamp;
          if (lockData.sessionId === sessionId && age < LOCK_TIMEOUT_MS) {
            return false; // Same session, recent - already fired
          }
          // Stale lock - remove and retry
          fs.unlinkSync(LOCK_FILE);
          fs.writeFileSync(LOCK_FILE, JSON.stringify({
            sessionId,
            timestamp: Date.now()
          }), { flag: 'wx' });
          return true;
        } catch (e2) {
          return true; // On any error, allow execution
        }
      }
      return true; // On other errors, allow execution
    }
  } catch (e) {
    return true; // On error, allow execution
  }
}

/**
 * Start embedding server for this project if not running
 * Follows EmbeddingServerManager pattern from src/mcp/embeddingServerManager.ts
 *
 * Logic:
 * 1. Check if socket exists and is responsive (external server like Docker)
 * 2. Check PID file and kill stale processes
 * 3. Kill orphaned processes for this project
 * 4. Start fresh server if needed
 * 5. Wait for socket to be ready
 *
 * CRITICAL: Each session gets its own check - never reuse servers from other projects
 */
function ensureEmbeddingServer(projectPath) {
  const socketPath = path.join(projectPath, 'specmem', 'sockets', 'embeddings.sock');
  const socketDir = path.dirname(socketPath);
  const logFile = path.join(socketDir, 'embedding-autostart.log');
  const pidFile = path.join(socketDir, 'embedding.pid');

  // Helper: Log to file with timestamp
  function logToFile(msg) {
    try {
      const timestamp = new Date().toISOString();
      fs.appendFileSync(logFile, `[${timestamp}] ${msg}\n`);
    } catch (e) { /* ignore */ }
  }

  // Ensure socket directory exists
  try {
    fs.mkdirSync(socketDir, { recursive: true });
  } catch (e) {
    logToFile(`ERROR: Failed to create socket dir: ${e.message}`);
  }

  logToFile(`=== NEW SESSION - ensureEmbeddingServer ===`);
  logToFile(`Project: ${projectPath}`);
  logToFile(`Socket: ${socketPath}`);
  logToFile(`PID file: ${pidFile}`);

  // Helper: Check if a PID is alive
  function isPidAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Helper: Kill a process safely
  function killProcess(pid, reason) {
    try {
      logToFile(`Killing PID ${pid} (${reason})`);
      process.kill(pid, 'SIGTERM');
      // Give it a moment, then force kill if needed
      try {
        execSync(`sleep 0.5 && kill -0 ${pid} 2>/dev/null && kill -9 ${pid} 2>/dev/null || true`, {
          timeout: 3000,
          stdio: 'ignore'
        });
      } catch (e) { /* process already dead */ }
    } catch (e) {
      logToFile(`Kill failed for PID ${pid}: ${e.message}`);
    }
  }

  // Helper: Health check socket using get_dimension command
  function healthCheckSocket(socketPath) {
    try {
      const checkResult = execSync(
        `echo '{"type":"get_dimension"}' | timeout 2 nc -U "${socketPath}" 2>/dev/null | head -c 200`,
        { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();

      // Accept multiple response formats:
      // - Docker/warm-start: "healthy", "status"
      // - Python direct: "native_dimensions", "target_dimensions", "embedding"
      // - Health ping: "stats"
      if (checkResult.includes('healthy') ||
          checkResult.includes('status') ||
          checkResult.includes('stats') ||
          checkResult.includes('embedding') ||
          checkResult.includes('native_dimensions') ||
          checkResult.includes('target_dimensions')) {
        return { success: true, response: checkResult };
      } else {
        return { success: false, response: checkResult };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // STEP 1: Check if socket already exists and is responsive (Docker/external server)
  if (fs.existsSync(socketPath)) {
    logToFile(`Socket exists, checking if responsive...`);
    const healthResult = healthCheckSocket(socketPath);

    if (healthResult.success) {
      logToFile(`Socket is RESPONSIVE - using existing server (Docker/external)`);
      logToFile(`Response: ${healthResult.response ? healthResult.response.slice(0, 100) : 'N/A'}`);
      return { started: false, reason: 'already_running', external: true };
    }

    logToFile(`Socket exists but NOT responsive: ${healthResult.error || 'invalid response'}`);
    logToFile(`Response: ${healthResult.response ? healthResult.response.slice(0, 100) : 'none'}`);

    // Socket not responding - remove it
    try {
      fs.unlinkSync(socketPath);
      logToFile(`Removed non-responsive socket`);
    } catch (e) {
      logToFile(`Failed to remove socket: ${e.message}`);
    }
  }

  // STEP 2: Check PID file and kill stale processes
  if (fs.existsSync(pidFile)) {
    try {
      const pidData = fs.readFileSync(pidFile, 'utf8').trim();
      const [pidStr, timestampStr] = pidData.split(':');
      const pid = parseInt(pidStr, 10);
      const timestamp = parseInt(timestampStr, 10) || Date.now();
      const ageMs = Date.now() - timestamp;
      const ageHours = ageMs / (1000 * 60 * 60);

      logToFile(`Found PID file: pid=${pid}, age=${Math.round(ageMs/1000)}s (${ageHours.toFixed(1)}h)`);

      if (isPidAlive(pid)) {
        // Check if process is too old (>1 hour) or socket is dead
        const MAX_AGE_HOURS = 1.0;
        const shouldKill = ageHours > MAX_AGE_HOURS;

        if (shouldKill) {
          logToFile(`PID ${pid} is STALE (${ageHours.toFixed(1)}h old, max ${MAX_AGE_HOURS}h) - killing`);
          killProcess(pid, `stale process - too old (${ageHours.toFixed(1)}h)`);
        } else {
          // Process is young but socket is dead - also kill it
          logToFile(`PID ${pid} is alive but socket is dead - killing stale process`);
          killProcess(pid, 'stale process - socket dead');
        }
      } else {
        // Process is dead - clean up
        logToFile(`PID ${pid} is DEAD, cleaning up PID file`);
      }

      // Always remove PID file after check
      try { fs.unlinkSync(pidFile); } catch (e) { /* ignore */ }

    } catch (e) {
      logToFile(`Error reading PID file: ${e.message}`);
      // Remove corrupt PID file
      try { fs.unlinkSync(pidFile); } catch (e) { /* ignore */ }
    }
  }

  // STEP 3: Kill any orphaned embedding processes for THIS project
  // This catches processes that didn't write a PID file or from crashed sessions
  try {
    const projectBasename = path.basename(projectPath);
    const psResult = execSync(
      `pgrep -f "frankenstein.*${projectBasename}" 2>/dev/null || true`,
      { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (psResult) {
      const pids = psResult.split('\n').filter(p => p.trim());
      logToFile(`Found ${pids.length} orphaned processes for this project`);
      const MAX_AGE_HOURS = 1.0;

      for (const pidStr of pids) {
        const pid = parseInt(pidStr.trim(), 10);
        if (pid && pid !== process.pid) {
          // Check process age using ps
          try {
            const ageSeconds = parseInt(
              execSync(`ps -p ${pid} -o etimes= 2>/dev/null || echo "0"`, {
                encoding: 'utf8',
                timeout: 2000,
                stdio: ['pipe', 'pipe', 'pipe']
              }).trim(),
              10
            );
            const ageHours = ageSeconds / 3600;

            if (ageHours > MAX_AGE_HOURS) {
              logToFile(`Killing orphaned process ${pid} (${ageHours.toFixed(1)}h old, max ${MAX_AGE_HOURS}h)`);
              killProcess(pid, `orphaned and stale (${ageHours.toFixed(1)}h old)`);
            } else {
              logToFile(`Orphaned process ${pid} is recent (${ageHours.toFixed(1)}h), keeping it`);

              // Check if the orphan's socket is responsive before continuing to spawn
              if (fs.existsSync(socketPath)) {
                const healthResult = healthCheckSocket(socketPath);
                if (healthResult.success) {
                  logToFile(`Orphan's socket is RESPONSIVE - reusing existing server`);
                  logToFile(`Response: ${healthResult.response ? healthResult.response.slice(0, 100) : 'N/A'}`);
                  return { started: false, reason: 'orphan_healthy', pid: pid };
                }
                logToFile(`Orphan's socket exists but NOT responsive - will spawn new process`);
              } else {
                logToFile(`Orphan's socket does not exist yet - will spawn new process`);
              }
            }
          } catch (e) {
            // If we can't get age, kill it anyway (safer)
            logToFile(`Could not check age of ${pid}, killing to be safe: ${e.message}`);
            killProcess(pid, 'orphaned, age unknown');
          }
        }
      }
      // Wait for processes to die
      execSync('sleep 0.5', { stdio: 'ignore', timeout: 2000 });
    } else {
      logToFile(`No orphaned processes found`);
    }
  } catch (e) {
    logToFile(`Orphan search error (non-fatal): ${e.message}`);
  }

  // STEP 4: Find the embedding server script
  // Priority: warm-start.sh (Docker) > frankenstein-embeddings.py (direct Python)
  const warmStartScript = path.join(SPECMEM_PKG, 'embedding-sandbox', 'warm-start.sh');
  const embeddingScript = path.join(SPECMEM_PKG, 'embedding-sandbox', 'frankenstein-embeddings.py');

  let useWarmStart = fs.existsSync(warmStartScript);
  let scriptToUse = useWarmStart ? warmStartScript : embeddingScript;

  if (!fs.existsSync(scriptToUse)) {
    // Try alternative locations
    const altScript = path.join(SPECMEM_PKG, 'embedding-sandbox', 'frankenstein-embeddings.py');
    if (fs.existsSync(altScript)) {
      scriptToUse = altScript;
      useWarmStart = false;
    } else {
      logToFile(`ERROR: No embedding script found at ${embeddingScript}`);
      return { started: false, reason: 'script_not_found', path: embeddingScript };
    }
  }

  logToFile(`Using script: ${scriptToUse} (warm-start: ${useWarmStart})`);

  // STEP 5: Start the embedding server in background
  try {
    const { spawn } = require('child_process');

    // Clean up any stale socket before starting
    try { fs.unlinkSync(socketPath); } catch (e) { /* ignore */ }

    let child;
    const spawnEnv = {
      ...process.env,
      SPECMEM_PROJECT_PATH: projectPath,
      SPECMEM_SOCKET_DIR: socketDir,
      SPECMEM_EMBEDDING_IDLE_TIMEOUT: '0', // Disable idle shutdown - MCP manages lifecycle
    };

    if (useWarmStart) {
      // warm-start.sh handles Docker container management
      child = spawn('bash', [warmStartScript], {
        cwd: path.dirname(warmStartScript),
        env: spawnEnv,
        detached: true,
        stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')]
      });
    } else {
      // Direct Python execution with --service flag
      child = spawn('python3', [embeddingScript, '--service'], {
        cwd: path.dirname(embeddingScript),
        env: spawnEnv,
        detached: true,
        stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')]
      });
    }

    child.unref();
    logToFile(`Spawned embedding process with PID: ${child.pid}`);

    // CRITICAL: Write PID file so we can kill this process later
    // Format: "pid:timestamp" - matches EmbeddingServerManager format
    if (child.pid) {
      try {
        fs.writeFileSync(pidFile, `${child.pid}:${Date.now()}`);
        logToFile(`Wrote PID file: ${pidFile}`);
      } catch (e) {
        logToFile(`ERROR: Failed to write PID file: ${e.message}`);
      }
    }

    // STEP 6: Wait for socket to appear and be ready (up to 60 seconds)
    logToFile(`Waiting for socket to appear and respond...`);
    const maxWaitMs = 3000; // CRIT-06 FIX: Reduced from 60000
    const pollIntervalMs = 500;
    const startTime = Date.now();

    while ((Date.now() - startTime) < maxWaitMs) {
      if (fs.existsSync(socketPath)) {
        // Socket appeared - give it a moment to initialize
        execSync('sleep 0.5', { stdio: 'ignore', timeout: 2000 });

        // Test if socket is responsive
        const healthResult = healthCheckSocket(socketPath);
        if (healthResult.success) {
          const waitTime = Date.now() - startTime;
          logToFile(`SUCCESS: Socket ready after ${waitTime}ms`);
          logToFile(`Response: ${healthResult.response ? healthResult.response.slice(0, 100) : 'N/A'}`);
          return { started: true, pid: child.pid, socket: socketPath, waitMs: waitTime };
        }

        logToFile(`Socket exists but not ready yet (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
      }

      // Sleep before next check
      try {
        execSync(`sleep ${pollIntervalMs / 1000}`, { stdio: 'ignore', timeout: 2000 });
      } catch (e) { /* ignore */ }
    }

    // Socket didn't respond in time - log warning but return success
    // The server may still be warming up (especially Docker with GPU)
    logToFile(`WARNING: Socket not ready after ${maxWaitMs}ms, but process started`);
    logToFile(`Server may still be warming up - MCP will handle health checks`);
    return { started: true, pid: child.pid, socket: socketPath, warning: 'socket_not_ready' };

  } catch (e) {
    logToFile(`ERROR: spawn failed: ${e.message}\n${e.stack}`);
    return { started: false, reason: 'spawn_failed', error: e.message };
  }
}

/**
 * Query PostgreSQL directly
 * Returns array of trimmed, non-empty result rows
 */
function queryDB(sql) {
  try {
    const result = execSync(
      `PGPASSWORD='${DB.pass}' psql -h ${DB.host} -p ${DB.port} -U ${DB.user} -d ${DB.name} -t -A -F '|' -c "${sql.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    // Trim each line and filter out empty/whitespace-only entries
    return result
      .trim()
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
  } catch (e) {
    return [];
  }
}

/**
 * Get last 6 user/Claude exchanges for this project (3 each)
 * EXCLUDES: rate limit messages, system notifications, very short messages
 */
function getLastMessages(projectPath) {
  const escapedPath = projectPath.replace(/'/g, "''");

  // Get last user/claude messages - they have role in metadata
  // CRITICAL: Filter out rate limit messages and system noise
  const sql = `
    SELECT
      metadata->>'role' as role,
      regexp_replace(left(content, 300), E'[\\n\\r|]+', ' ', 'g') as preview,
      to_char(created_at, 'HH24:MI') as time
    FROM memories
    WHERE (project_path = '${escapedPath}' OR metadata->>'project_path' = '${escapedPath}')
      AND metadata->>'role' IN ('user', 'assistant')
      AND content IS NOT NULL
      AND length(content) > 20
      -- EXCLUDE rate limit messages and system noise
      AND content NOT ILIKE '%reached your limit%'
      AND content NOT ILIKE '%rate limit%'
      AND content NOT ILIKE '%resets %'
      AND content NOT ILIKE '%掊限%'
      AND content NOT ILIKE '%重設%'
      AND content NOT ILIKE '%You''ve reached%'
      AND content NOT ILIKE '%API rate%'
      AND content NOT ILIKE '%try again%later%'
      -- EXCLUDE very short system messages
      AND length(content) > 30
    ORDER BY created_at DESC
    LIMIT 8
  `;

  const rows = queryDB(sql);

  // Parse and separate user/claude messages
  const messages = rows.map(row => {
    const parts = row.split('|');
    const role = parts[0]?.trim();
    const preview = parts[1]?.trim()?.slice(0, 200);
    const time = parts[2]?.trim();
    return {
      role: role === 'user' ? 'USER' : role === 'assistant' ? 'CLAUDE' : 'SYS',
      content: preview?.replace(/^\[(USER|CLAUDE)\]\s*/i, ''), // Remove prefix if exists
      time
    };
  }).filter(m => m.content && m.content.length > 10);

  // Get 4 most recent real messages
  return messages.slice(0, 4);
}

/**
 * Get last 3 code modifications for this project
 */
function getLastCodeMods(projectPath) {
  const escapedPath = projectPath.replace(/'/g, "''");

  // Search memories for file edit mentions (codebase_pointers may be empty)
  // Look for Edit/Write tool uses or file modification mentions
  const sql = `
    SELECT
      regexp_replace(
        substring(content from '(?:Edit|Write|created|modified).*?(/[^ \\n|"'']+\\.[a-z]+)'),
        E'[\\n\\r]+', '', 'g'
      ) as file_ref,
      to_char(created_at, 'HH24:MI') as time
    FROM memories
    WHERE project_path = '${escapedPath}'
      AND (
        content ILIKE '%Edit%' OR
        content ILIKE '%Write%file%' OR
        content ILIKE '%created%file%' OR
        content ILIKE '%modified%'
      )
      AND content ~ '/[^ ]+\\.[a-z]+'
    ORDER BY created_at DESC
    LIMIT 5
  `;

  const rows = queryDB(sql);

  // Parse and dedupe file references
  const seen = new Set();
  return rows
    .map(row => {
      const parts = row.split('|');
      const fileRef = parts[0]?.trim();
      const time = parts[1]?.trim();

      // Extract just the filename from the path
      if (!fileRef || seen.has(fileRef)) return null;
      seen.add(fileRef);

      const fileName = fileRef.split('/').pop();
      return {
        file: fileRef,
        name: fileName,
        time
      };
    })
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * Get last session output (from previous Claude instance)
 * Reads specmem/sockets/last-session.txt
 */
function getLastSessionOutput(projectPath) {
  const lastSessionFile = path.join(projectPath, 'specmem', 'sockets', 'last-session.txt');

  if (!fs.existsSync(lastSessionFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(lastSessionFile, 'utf8');
    const stats = fs.statSync(lastSessionFile);
    const ageMinutes = Math.round((Date.now() - stats.mtimeMs) / 60000);

    // Only use if less than 24 hours old
    if (ageMinutes > 1440) {
      return null;
    }

    // Extract just the screen output (skip headers)
    const lines = content.split('\n');
    const startIdx = lines.findIndex(l => l.includes('Last 500 lines'));
    const endIdx = lines.findIndex(l => l.includes('End of session capture'));

    if (startIdx === -1) {
      // No header found, use whole content but limit to 300 lines
      return {
        content: lines.slice(-300).join('\n'),
        ageMinutes,
        reason: lines.find(l => l.startsWith('# Reason:'))?.replace('# Reason:', '').trim() || 'unknown'
      };
    }

    // Get the actual output between markers, limit to last 300 lines for context efficiency
    const outputLines = lines.slice(startIdx + 2, endIdx > 0 ? endIdx : undefined);
    const trimmedOutput = outputLines.slice(-300).join('\n');

    return {
      content: trimmedOutput,
      ageMinutes,
      reason: lines.find(l => l.startsWith('# Reason:'))?.replace('# Reason:', '').trim() || 'unknown'
    };
  } catch (e) {
    return null;
  }
}

/**
 * Check compaction status (estimate based on memory count)
 */
function getCompactionStatus(projectPath) {
  const escapedPath = projectPath.replace(/'/g, "''");

  // Count recent memories for this session
  const sql = `
    SELECT COUNT(*) as cnt
    FROM memories
    WHERE (project_path = '${escapedPath}' OR metadata->>'project_path' = '${escapedPath}')
      AND created_at > NOW() - INTERVAL '1 hour'
  `;

  const rows = queryDB(sql);
  const count = parseInt(rows[0] || '0');

  // Estimate: more than 50 recent memories = likely approaching compaction
  if (count > 50) {
    return {
      warning: true,
      message: '⚠️ High memory activity - compaction may be imminent',
      recentCount: count
    };
  }

  return { warning: false, recentCount: count };
}

/**
 * Generate SpecMem tool reminder
 * NOTE: Returns trimmed string with NO leading/trailing whitespace
 */
function getToolReminder() {
  return [
    '## SpecMem Tools Available',
    '',
    '**Memory Search:**',
    '- `find_memory` - Semantic search across all memories',
    '- `find_code_pointers` - Search code with tracebacks',
    '- `drill_down` - Explore memory details',
    '- `get_memory` - Get specific memory by ID',
    '',
    '**Memory Storage:**',
    '- `save_memory` - Store new memories',
    '- `link_the_vibes` - Connect related memories',
    '- `smush_memories_together` - Consolidate similar memories',
    '',
    '**Team Communication:**',
    '- `send_team_message` - Message team members',
    '- `read_team_messages` - Check team updates',
    '- `claim_task` / `release_task` - Coordinate work',
    '',
    '**System:**',
    '- `show_me_the_stats` - Memory statistics',
    '- `check_sync` - Verify file sync status',
    '- `start_watching` - Enable file watcher',
    '',
    'Use `/specmem` for quick commands or `/specmem-drilldown` for deep search.'
  ].join('\n');
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
      resolve(input); // Return what we have on timeout
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(input);
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      resolve(input); // Still return what we have
    });
  });
}

/**
 * Main hook handler
 */
async function main() {
  // CRIT-07 FIX: Read input with timeout instead of indefinite for-await
  let input = await readStdinWithTimeout(5000);

  // Parse hook input
  let sessionId = 'unknown';
  let projectPath = process.cwd();

  try {
    const data = JSON.parse(input);
    // Claude SessionStart hook provides: { cwd, sessionId, ... }
    // Note: cwd is the primary field, workingDirectory is NOT provided
    sessionId = data.sessionId || data.session_id || 'unknown';
    projectPath = data.cwd || data.workingDirectory || process.cwd();
  } catch (e) {
    // Use defaults
  }

  // Check lock to prevent double-firing
  if (!acquireLock(sessionId)) {
    // Already fired for this session, exit silently
    process.exit(0);
  }

  // CRITICAL: Ensure embedding server is running for THIS project
  // Each project gets its own server at {PROJECT}/specmem/sockets/embeddings.sock
  // Note: ensureEmbeddingServer now waits for socket internally, no extra delay needed
  const embeddingResult = ensureEmbeddingServer(projectPath);

  // Write env vars for subagents (bash portion)
  if (process.env.CLAUDE_ENV_FILE) {
    const envFile = process.env.CLAUDE_ENV_FILE;
    const envLines = [
      'export CLAUDE_CODE_ALLOW_MCP_TOOLS_FOR_SUBAGENTS=1',
      `export SPECMEM_HOME='${SPECMEM_HOME}'`,
      `export SPECMEM_PKG='${SPECMEM_PKG}'`,
      `export SPECMEM_RUN_DIR='${RUN_DIR}'`,
      `export SPECMEM_PROJECT_PATH='${projectPath}'`
    ];
    fs.appendFileSync(envFile, envLines.join('\n') + '\n');
  }

  // Gather context
  const lastMessages = getLastMessages(projectPath);
  const lastCodeMods = getLastCodeMods(projectPath);
  const compactionStatus = getCompactionStatus(projectPath);
  const lastSession = getLastSessionOutput(projectPath);

  // Build context output - use array to avoid trailing whitespace issues
  const sections = [];

  // Header (no leading newline - trim will handle it)
  sections.push('[SPECMEM-SESSION]');
  sections.push(`Project: ${projectPath}`);
  sections.push(`Session: ${sessionId}`);

  // CRITICAL: Previous session output (for continuity)
  if (lastSession) {
    // Extract [MESSAGE TO NEXT CLAUDE] if present - DON'T compress this, it's important
    const messageMatch = lastSession.content.match(/\[MESSAGE TO NEXT CLAUDE\]([\s\S]*?)\[\/MESSAGE TO NEXT CLAUDE\]/);

    if (messageMatch) {
      sections.push('');
      sections.push('## MESSAGE FROM PREVIOUS CLAUDE INSTANCE');
      sections.push(`**(${lastSession.ageMinutes}m ago)**`);
      sections.push('```');
      sections.push(messageMatch[1].trim());
      sections.push('```');
    }

    sections.push('');
    sections.push(`## PREVIOUS SESSION OUTPUT (${lastSession.ageMinutes}m ago, reason: ${lastSession.reason})`);
    sections.push('This is what you (previous Claude instance) were doing:');

    // Truncate to ~200 lines for token efficiency but keep the important parts
    const contentLines = lastSession.content.split('\n');
    let sessionContent;
    if (contentLines.length > 200) {
      sessionContent = contentLines.slice(0, 50).join('\n') +
        `\n... [${contentLines.length - 100} lines omitted] ...\n` +
        contentLines.slice(-50).join('\n');
    } else {
      sessionContent = lastSession.content;
    }

    // SESSION CONTENT: Output FULL readable content (no compression)
    // Compression was causing unreadable Chinese output - disabled for readability
    // Only compress if explicitly requested via SPECMEM_COMPRESS_SESSION=1
    sections.push('```');
    if (process.env.SPECMEM_COMPRESS_SESSION === '1') {
      const compressedSession = compressHookOutput(sessionContent, {
        threshold: 0.60,
        minLength: 30,
        includeWarning: false  // Warning already added at top level
      });
      sections.push(compressedSession.trim());
    } else {
      sections.push(sessionContent.trim());
    }
    sections.push('```');
  }

  // Last messages (only add section if we have data)
  if (lastMessages.length > 0) {
    sections.push('');
    sections.push('## Last Conversation (this project):');
    lastMessages.forEach((msg, i) => {
      // Trim message content to avoid trailing spaces
      const content = (msg.content || '').trim();
      if (content) {
        sections.push(`${i + 1}. [${msg.role}] ${content}...`);
      }
    });
  }

  // Last code mods (only add section if we have data)
  if (lastCodeMods.length > 0) {
    sections.push('');
    sections.push('## Recent Code Changes:');
    lastCodeMods.forEach((mod, i) => {
      const timeStr = mod.time ? ` (${mod.time})` : '';
      const name = (mod.name || '').trim();
      const file = (mod.file || '').trim();
      if (name && file) {
        sections.push(`${i + 1}. ${name}${timeStr}`);
        sections.push(`   ${file}`);
      }
    });
  }

  // Compaction warning (only add if warning is active)
  if (compactionStatus.warning) {
    sections.push('');
    sections.push(compactionStatus.message);
    sections.push(`Recent memories: ${compactionStatus.recentCount}`);
  }

  // Tool reminder
  sections.push('');
  sections.push(getToolReminder());

  sections.push('');
  sections.push('[/SPECMEM-SESSION]');

  // Build final context from sections array
  // Filter out any undefined/null entries, join with newlines, and clean up
  let context = sections
    .filter(s => s !== undefined && s !== null)
    .join('\n');

  // CRITICAL: Clean up whitespace issues
  // 1. Remove trailing whitespace from each line
  // 2. Collapse multiple consecutive blank lines to single blank line
  // 3. Trim the entire output
  context = context
    .split('\n')
    .map(line => line.trimEnd())  // Remove trailing whitespace from each line
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')   // Collapse 3+ newlines to 2 (one blank line)
    .trim();                       // Remove leading/trailing whitespace

  // SESSION START: Output full context WITHOUT compression
  // Compression makes debugging hard and context is injected at start when there's room
  // Only compress if SPECMEM_COMPRESS_SESSION is set
  if (process.env.SPECMEM_COMPRESS_SESSION === '1') {
    const compressedContext = compressHookOutput(context, {
      threshold: 0.70,
      minLength: 50,
      includeWarning: true
    });
    // Final trim to ensure no trailing whitespace
    console.log(compressedContext.trim());
  } else {
    // Output full readable context (already trimmed above)
    console.log(context);
  }

  process.exit(0);
}

// LOW-44 FIX: Log errors before exit instead of silently masking
main().catch((err) => {
  if (process.env.SPECMEM_HOOK_DEBUG) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] Session hook error: ${err.message}`);
  }
  process.exit(0);
});
