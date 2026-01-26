#!/usr/bin/env node
/**
 * MCP Proxy - Resilient stdio proxy for SpecMem MCP server
 *
 * Claude connects to this proxy via stdio. The proxy manages the actual
 * MCP server (bootstrap.cjs) as a child process. If the server crashes
 * or restarts, the proxy reconnects transparently — Claude never sees
 * a disconnect.
 *
 * Protocol: MCP uses Content-Length framed JSON-RPC 2.0 over stdio.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Config
const BOOTSTRAP_PATH = path.join(__dirname, 'bootstrap.cjs');
const MAX_RESTART_DELAY = 10000; // 10s max backoff
const INITIAL_RESTART_DELAY = 500; // 500ms first retry
const MAX_QUEUE_SIZE = 200;
const HEARTBEAT_INTERVAL = 30000; // 30s keepalive pings

// State
let child = null;
let childReady = false;
let pendingQueue = []; // Messages queued during reconnect
let restartDelay = INITIAL_RESTART_DELAY;
let restartCount = 0;
let lastInitializeRequest = null; // Cache the initialize request for re-init
let lastInitializeResponse = null;
let initializeId = null;
let shuttingDown = false;
let heartbeatTimer = null;
let childStdoutBuffer = '';
let stdinBuffer = '';

function log(msg) {
  try {
    fs.appendFileSync('/tmp/specmem-proxy.log',
      `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

log(`Proxy starting. PID=${process.pid} BOOTSTRAP=${BOOTSTRAP_PATH}`);
log(`ENV: PROJECT_PATH=${process.env.SPECMEM_PROJECT_PATH}`);

// ============================================================================
// Content-Length framed message parser
// ============================================================================
function parseMessages(buffer) {
  const messages = [];
  let remaining = buffer;

  while (remaining.length > 0) {
    remaining = remaining.trimStart();
    if (remaining.length === 0) break;

    // Mode 1: Content-Length framed (MCP spec)
    if (remaining.startsWith('Content-Length:')) {
      const headerEnd = remaining.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = remaining.substring(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        remaining = remaining.substring(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (remaining.length < bodyEnd) break;

      const body = remaining.substring(bodyStart, bodyEnd);
      remaining = remaining.substring(bodyEnd);

      try {
        messages.push(JSON.parse(body));
      } catch (e) {
        log(`Parse error (framed): ${e.message}`);
      }
      continue;
    }

    // Mode 2: Raw JSON (newline-delimited) — Claude Code sends this
    if (remaining[0] === '{') {
      // Find the end of this JSON object by tracking braces
      let depth = 0;
      let inString = false;
      let escape = false;
      let end = -1;
      for (let i = 0; i < remaining.length; i++) {
        const ch = remaining[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      if (end === -1) break; // Incomplete JSON

      const jsonStr = remaining.substring(0, end);
      remaining = remaining.substring(end);

      try {
        messages.push(JSON.parse(jsonStr));
      } catch (e) {
        log(`Parse error (raw): ${e.message}`);
      }
      continue;
    }

    // Skip unknown byte
    remaining = remaining.substring(1);
  }

  return { messages, remaining };
}

function serializeMessage(obj) {
  return JSON.stringify(obj) + '\n';
}

// ============================================================================
// Send message to Claude (stdout) — newline-delimited JSON per MCP SDK
// ============================================================================
function sendToClient(msg) {
  try {
    process.stdout.write(serializeMessage(msg));
  } catch (e) {
    log(`stdout write error: ${e.message}`);
  }
}

// ============================================================================
// Send message to MCP server (child stdin)
// ============================================================================
function sendToServer(msg) {
  // CRITICAL: Always forward initialize and notifications/initialized immediately
  // even before childReady — these are what MAKE the child ready.
  // Without this, deadlock: proxy waits for init response, bootstrap waits for init request.
  const isInitFlow = msg.method === 'initialize' || msg.method === 'notifications/initialized';

  if (!child || child.killed) {
    if (pendingQueue.length < MAX_QUEUE_SIZE) {
      pendingQueue.push(msg);
      log(`Queued message (no child) (${pendingQueue.length} pending): ${msg.method || msg.id || '?'}`);
    }
    return;
  }

  if (!childReady && !isInitFlow) {
    if (pendingQueue.length < MAX_QUEUE_SIZE) {
      pendingQueue.push(msg);
      log(`Queued message (${pendingQueue.length} pending): ${msg.method || msg.id || '?'}`);
    } else {
      log(`Queue full, dropping message: ${msg.method || msg.id || '?'}`);
    }
    return;
  }

  try {
    child.stdin.write(serializeMessage(msg));
  } catch (e) {
    log(`child stdin write error: ${e.message}`);
    pendingQueue.push(msg);
  }
}

// ============================================================================
// Flush queued messages to server
// ============================================================================
function flushQueue() {
  if (pendingQueue.length === 0) return;
  log(`Flushing ${pendingQueue.length} queued messages to server`);
  const queue = [...pendingQueue];
  pendingQueue = [];
  for (const msg of queue) {
    sendToServer(msg);
  }
}

// ============================================================================
// Spawn/restart the MCP server
// ============================================================================
function spawnServer() {
  if (shuttingDown) return;
  if (child && !child.killed) {
    try { child.kill('SIGTERM'); } catch {}
  }

  childReady = false;
  childStdoutBuffer = '';

  const args = process.argv.slice(2); // Pass through any args
  const env = { ...process.env };

  log(`Spawning server: node ${BOOTSTRAP_PATH} ${args.join(' ')}`);

  // CRITICAL: Do NOT hardcode --max-old-space-size here
  // The proxy's own heap limit is set by Claude config args (e.g. --max-old-space-size=250)
  // but the child bootstrap needs MORE memory for all its initialization
  const heapLimit = process.env.SPECMEM_MAX_HEAP_MB || '1024';
  child = spawn('node', ['--expose-gc', `--max-old-space-size=${heapLimit}`, BOOTSTRAP_PATH, ...args], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: process.env.SPECMEM_PROJECT_PATH || process.cwd()
  });

  child.stderr.on('data', (data) => {
    // Forward stderr (logs) to our stderr
    process.stderr.write(data);
  });

  child.stdout.on('data', (data) => {
    const raw = data.toString();
    log(`CHILD STDOUT (${raw.length} bytes): ${raw.substring(0, 200)}`);
    childStdoutBuffer += raw;

    const { messages, remaining } = parseMessages(childStdoutBuffer);
    log(`CHILD PARSED: ${messages.length} messages, ${remaining.length} bytes remaining`);
    childStdoutBuffer = remaining;

    for (const msg of messages) {
      // If this is the response to initialize, cache it and mark ready
      if (msg.id !== undefined && msg.id === initializeId && msg.result) {
        lastInitializeResponse = msg;
        childReady = true;
        restartDelay = INITIAL_RESTART_DELAY;
        restartCount = 0;
        log(`Server initialized (id=${msg.id}). Flushing queue.`);

        // If this is a RE-init (not the first), don't send the response
        // to Claude — Claude already has the init response from first time
        if (restartCount > 0 || lastInitializeResponse) {
          // Still send it on first init
        }
        sendToClient(msg);
        flushQueue();
        startHeartbeat();
        continue;
      }

      // Forward everything else to Claude
      sendToClient(msg);
    }
  });

  child.on('error', (err) => {
    log(`Server process error: ${err.message}`);
    scheduleRestart();
  });

  child.on('exit', (code, signal) => {
    log(`Server exited: code=${code} signal=${signal}`);
    childReady = false;
    stopHeartbeat();

    if (!shuttingDown) {
      // If bootstrap was intentionally killed (SIGTERM/SIGKILL from init or system),
      // don't restart — exit the proxy too. Init will start a fresh bootstrap.
      // Only restart on crashes (non-zero exit code without signal).
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        log(`Bootstrap was intentionally killed (${signal}) — proxy exiting`);
        shutdown();
      } else {
        scheduleRestart();
      }
    }
  });

  // If we have a cached initialize request, re-send it
  if (lastInitializeRequest && restartCount > 0) {
    log(`Re-sending initialize request (restart #${restartCount})`);
    setTimeout(() => {
      if (child && !child.killed) {
        try {
          child.stdin.write(serializeMessage(lastInitializeRequest));
          // Also send initialized notification
          setTimeout(() => {
            if (child && !child.killed) {
              try {
                child.stdin.write(serializeMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }));
              } catch {}
            }
          }, 100);
        } catch (e) {
          log(`Re-init write error: ${e.message}`);
        }
      }
    }, 200);
  }

  restartCount++;
}

function scheduleRestart() {
  if (shuttingDown) return;
  log(`Scheduling restart in ${restartDelay}ms (restart #${restartCount})`);
  setTimeout(() => {
    spawnServer();
  }, restartDelay);
  restartDelay = Math.min(restartDelay * 2, MAX_RESTART_DELAY);
}

// ============================================================================
// Heartbeat — detect dead server
// ============================================================================
function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!child || child.killed || !childReady) return;
    // Send a ping (list tools) to keep connection alive
    // MCP doesn't have a ping method, but we can use this to detect dead pipes
    try {
      child.stdin.write(''); // Zero-byte write to test pipe
    } catch (e) {
      log(`Heartbeat detected dead pipe: ${e.message}`);
      childReady = false;
      try { child.kill('SIGTERM'); } catch {}
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ============================================================================
// Handle stdin from Claude
// ============================================================================
process.stdin.on('data', (data) => {
  const raw = data.toString();
  log(`STDIN RAW (${raw.length} bytes): ${raw.substring(0, 200)}`);
  stdinBuffer += raw;

  const { messages, remaining } = parseMessages(stdinBuffer);
  log(`STDIN PARSED: ${messages.length} messages, ${remaining.length} bytes remaining`);
  stdinBuffer = remaining;

  for (const msg of messages) {
    // Cache the initialize request so we can re-send on restart
    if (msg.method === 'initialize') {
      lastInitializeRequest = msg;
      initializeId = msg.id;
      log(`Got initialize request (id=${msg.id})`);
    }

    // Cache initialized notification
    if (msg.method === 'notifications/initialized') {
      log('Got initialized notification');
    }

    sendToServer(msg);
  }
});

process.stdin.on('end', () => {
  log('stdin closed (Claude disconnected)');
  shutdown();
});

process.stdin.on('error', (err) => {
  log(`stdin error: ${err.message}`);
  shutdown();
});

// ============================================================================
// Graceful shutdown
// ============================================================================
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Proxy shutting down');
  stopHeartbeat();
  if (child && !child.killed) {
    child.kill('SIGTERM');
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      process.exit(0);
    }, 3000);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Orphan detection: if parent (Claude) dies, proxy gets reparented to PID 1
// Check every 10s and exit if orphaned
setInterval(() => {
  if (process.ppid === 1) {
    log('Parent died (PPID=1), proxy shutting down');
    shutdown();
  }
}, 10000);

// ============================================================================
// Start
// ============================================================================
spawnServer();
