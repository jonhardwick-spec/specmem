#!/usr/bin/env node
/**
 * AGENT OUTPUT FADER - Live compression while agent runs
 * =======================================================
 *
 * SessionStart daemon mode:
 *   1. Single daemon per machine (PID file enforced)
 *   2. Every 10 seconds: finds unfaded agent outputs
 *   3. Tracks what's been faded to avoid reprocessing
 *   4. Auto-exits after 2 hours or session end
 *
 * Uses ack file to track processed files and avoid memory bloat.
 */

const fs = require('fs');
const path = require('path');

// Load the compressor
let compressText;
try {
  const compressor = require('./token-compressor.cjs');
  compressText = compressor.compressText || compressor.compress || ((t) => t);
} catch (e) {
  compressText = (t) => t; // Fallback: no compression
}

const FADE_INTERVAL = 10000; // 10 seconds (was 5)
const STALE_THRESHOLD = 20000; // 20 seconds no growth = agent done
const PID_FILE = '/tmp/specmem-fader-daemon.pid';
// Marker format: ---FADED:<timestamp>:<linecount>---
const FADE_MARKER_PREFIX = '---FADED:';

/**
 * Clean a single JSON line - strip metadata, keep essentials
 *
 * IMPORTANT: Keep keys readable for Claude! Don't use cryptic abbreviations.
 * Keys used: role, content, tools (with name, input), thinking
 *
 * CRITICAL: thinking and redacted_thinking blocks MUST be preserved exactly!
 * The API will reject any modification to these blocks.
 */
function cleanLine(jsonLine) {
  try {
    const obj = JSON.parse(jsonLine);

    // Already cleaned format - check for both old (r) and new (role) format markers
    // Old format: {r: 'u'/'a', c: '...', t: [...]}
    // New format: {role: 'u'/'a', content: '...', tools: [...]}
    const isNewFormat = (obj.role === 'u' || obj.role === 'a') && !obj.message && !obj.parentUuid;
    const isOldFormat = (obj.r === 'u' || obj.r === 'a') && !obj.message && !obj.parentUuid;
    if (isNewFormat || isOldFormat) {
      return jsonLine; // Already clean
    }

    const msg = obj.message || {};
    const role = msg.role || obj.type || 'unknown';
    const content = msg.content;

    // Use readable keys: role (u/a), content, tools, thinking
    const clean = { role: role[0] }; // 'u' or 'a' (user/assistant - still short but obvious)

    if (typeof content === 'string') {
      // Apply Chinese compression to text content only
      clean.content = compressText(content);
    } else if (Array.isArray(content)) {
      const texts = [];
      const tools = [];
      const thinkingBlocks = [];

      for (const block of content) {
        // CRITICAL: Preserve thinking blocks EXACTLY as-is
        // API error if modified: "thinking or redacted_thinking blocks cannot be modified"
        if (block.type === 'thinking' || block.type === 'redacted_thinking') {
          thinkingBlocks.push(block);
        } else if (block.type === 'text' && block.text) {
          texts.push(compressText(block.text));
        } else if (block.type === 'tool_use') {
          // Keep tool info readable
          tools.push({
            name: block.name,
            input: JSON.stringify(block.input || {}).slice(0, 100) // slightly more context
          });
        }
      }

      if (texts.length) clean.content = texts.join('\n');
      if (tools.length) clean.tools = tools;
      // Preserve thinking blocks exactly - no compression, no modification
      if (thinkingBlocks.length) clean.thinking = thinkingBlocks;
    }

    return JSON.stringify(clean);
  } catch (e) {
    return null;
  }
}

/**
 * Process an output file - clean + compress in place
 *
 * Uses MARKER-BASED ACK: Only compresses content AFTER the marker.
 * Format: ---FADED:<timestamp>:<linecount>---
 *
 * This prevents re-compressing already compressed content!
 */
function fadeFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { skipped: true };

    const content = fs.readFileSync(filePath, 'utf8');
    const allLines = content.split('\n');

    if (allLines.length === 0) return { skipped: true };

    // Find the marker line (if exists)
    let markerIndex = -1;
    for (let i = 0; i < allLines.length; i++) {
      if (allLines[i].startsWith(FADE_MARKER_PREFIX)) {
        markerIndex = i;
        break;
      }
    }

    // Split into already-faded and new content
    let fadedLines = [];
    let newLines = [];

    if (markerIndex >= 0) {
      // Everything before marker is already faded
      fadedLines = allLines.slice(0, markerIndex).filter(Boolean);
      // Everything after marker is new (skip the marker itself)
      newLines = allLines.slice(markerIndex + 1).filter(Boolean);
    } else {
      // No marker - all content is new (first time fading this file)
      newLines = allLines.filter(Boolean);
    }

    // Nothing new to process?
    if (newLines.length === 0) {
      return { skipped: true, reason: 'no new content' };
    }

    // Process only the new lines
    const newlyFaded = [];
    let processedCount = 0;

    for (const line of newLines) {
      // Skip empty lines and existing markers
      if (!line.trim() || line.startsWith(FADE_MARKER_PREFIX)) continue;

      const cleaned = cleanLine(line);
      if (cleaned) {
        newlyFaded.push(cleaned);
        processedCount++;
      }
    }

    if (newlyFaded.length === 0) {
      return { skipped: true, reason: 'nothing to fade' };
    }

    // Calculate size savings
    const originalNewSize = Buffer.byteLength(newLines.join('\n'), 'utf8');
    const fadedNewSize = Buffer.byteLength(newlyFaded.join('\n'), 'utf8');

    // Build new file content: existing faded + newly faded + new marker
    const marker = `${FADE_MARKER_PREFIX}${Date.now()}:${fadedLines.length + newlyFaded.length}---`;
    const finalLines = [...fadedLines, ...newlyFaded, marker];
    const finalContent = finalLines.join('\n') + '\n';

    // Write back
    fs.writeFileSync(filePath, finalContent);

    return {
      original: originalNewSize,
      cleaned: fadedNewSize,
      ratio: Math.round((1 - fadedNewSize / originalNewSize) * 100),
      linesProcessed: processedCount,
      totalLines: finalLines.length - 1 // exclude marker
    };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Main fader loop for a specific agent
 */
async function runFader(outputFile) {
  let lastSize = 0;
  let staleCount = 0;

  const loop = setInterval(() => {
    try {
      // Check if file exists
      if (!fs.existsSync(outputFile)) {
        staleCount++;
        if (staleCount > 2) {
          clearInterval(loop);
          process.exit(0);
        }
        return;
      }

      const stat = fs.statSync(outputFile);
      const currentSize = stat.size;

      // Check if file is still growing
      if (currentSize === lastSize) {
        staleCount++;
        if (staleCount * FADE_INTERVAL >= STALE_THRESHOLD) {
          // Agent appears done - final fade and exit
          fadeFile(outputFile);
          clearInterval(loop);
          process.exit(0);
        }
      } else {
        staleCount = 0;
        lastSize = currentSize;

        // Apply fade
        const result = fadeFile(outputFile);
        if (result.ratio && process.env.SPECMEM_FADER_DEBUG) {
          console.error(`🌫️ Faded ${path.basename(outputFile)}: ${result.ratio}% smaller`);
        }
      }
    } catch (e) {
      // Silently continue
    }
  }, FADE_INTERVAL);

  // Safety timeout - max 30 minutes per agent
  setTimeout(() => {
    clearInterval(loop);
    process.exit(0);
  }, 30 * 60 * 1000);
}

/**
 * Find agent output files that need fading
 * OPTIMIZED: First checks if any subagents dir was modified recently
 */
function findActiveAgentFiles() {
  const files = [];
  const homeDir = process.env.HOME || '/root';
  const projectsDir = path.join(homeDir, '.claude', 'projects');

  try {
    if (!fs.existsSync(projectsDir)) return files;

    // Scan all project directories (structure: projects/<project>/<session-id>/subagents/)
    for (const project of fs.readdirSync(projectsDir)) {
      const projectDir = path.join(projectsDir, project);
      if (!fs.statSync(projectDir).isDirectory()) continue;

      // Scan session directories within project
      for (const session of fs.readdirSync(projectDir)) {
        const subagentsDir = path.join(projectDir, session, 'subagents');
        if (!fs.existsSync(subagentsDir)) continue;

        // QUICK CHECK: Has this subagents dir been modified in last 30 seconds?
        // If not, skip scanning its files entirely
        try {
          const dirStat = fs.statSync(subagentsDir);
          if (Date.now() - dirStat.mtimeMs > 30000) continue; // Dir untouched for 30s
        } catch { continue; }

        for (const file of fs.readdirSync(subagentsDir)) {
          if (file.endsWith('.jsonl') && file.startsWith('agent-')) {
            const fullPath = path.join(subagentsDir, file);
            const stat = fs.statSync(fullPath);

            // Skip tiny files (1 byte = placeholder)
            if (stat.size < 100) continue;

            // Check if file needs fading by looking for marker at end
            try {
              const fd = fs.openSync(fullPath, 'r');
              const fileSize = stat.size;
              const readSize = Math.min(100, fileSize);
              const buf = Buffer.alloc(readSize);
              fs.readSync(fd, buf, 0, readSize, Math.max(0, fileSize - readSize));
              fs.closeSync(fd);
              const tail = buf.toString('utf8');
              // If ends with marker, file is fully faded - skip
              if (tail.includes(FADE_MARKER_PREFIX) && tail.trim().endsWith('---')) {
                continue;
              }
            } catch (e) {}

            // Include file with its size for sorting
            files.push({ path: fullPath, size: stat.size, mtime: stat.mtimeMs });
          }
        }
      }
    }
  } catch (e) {}

  return files;
}

/**
 * SINGLETON ENFORCEMENT - kill old daemon, take over
 */
function killOldDaemon() {
  try {
    if (!fs.existsSync(PID_FILE)) return;
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (isNaN(pid) || pid === process.pid) return;
    // Kill the old daemon
    try {
      process.kill(pid, 'SIGTERM');
    } catch (e) {
      // Process already dead
    }
    // Clean up PID file
    try { fs.unlinkSync(PID_FILE); } catch {}
  } catch (e) {
    // Ignore errors
  }
}

// Legacy function for compatibility
function isDaemonRunning() {
  return false; // We always take over now
}

// LOW-34 FIX: Use atomic file operations to prevent race conditions
function writePidFile() {
  const tmpFile = `${PID_FILE}.${process.pid}.tmp`;
  try {
    // Write to temp file first, then rename atomically
    fs.writeFileSync(tmpFile, process.pid.toString());
    fs.renameSync(tmpFile, PID_FILE);
  } catch (e) {
    // Clean up temp file on failure
    try { fs.unlinkSync(tmpFile); } catch {}
    throw e;
  }
}

function cleanupPidFile() {
  try { fs.unlinkSync(PID_FILE); } catch {}
}

/**
 * Hook handler - spawns fader for the agent
 */
async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);

    // Extract agent ID and output file from hook data
    const agentId = data.agent_id || data.agentId || data.task_id || data.subagent_id;
    const outputFile = data.output_file || data.outputFile;

    // Resolve output file path
    let targetFile = outputFile;

    if (!targetFile && agentId) {
      // Try known locations
      const homeDir = process.env.HOME || '/root';
      const candidates = [
        `/tmp/claude/-specmem/tasks/${agentId}.output`,
      ];

      // Search subagents directories
      const projectsDir = path.join(homeDir, '.claude', 'projects');
      if (fs.existsSync(projectsDir)) {
        for (const project of fs.readdirSync(projectsDir)) {
          candidates.push(path.join(projectsDir, project, 'subagents', `agent-${agentId}.jsonl`));
        }
      }

      for (const c of candidates) {
        if (fs.existsSync(c)) {
          targetFile = c;
          break;
        }
      }
    }

    // No specific file - spawn the session daemon to monitor for new agents
    if (!targetFile) {
      const { spawn, execSync } = require('child_process');

      // Check if daemon already running (avoid duplicates)
      try {
        const running = execSync('pgrep -f "agent-output-fader.*--daemon"', { encoding: 'utf8' });
        if (running.trim()) {
          process.exit(0); // Daemon already running
        }
      } catch (e) {} // No daemon running, start one

      const daemon = spawn(process.execPath, [__filename, '--daemon'], {
        detached: true,
        stdio: 'ignore'
      });
      daemon.unref();
      process.exit(0);
    }

    // Spawn the fader loop in background (detached)
    const { spawn } = require('child_process');
    const fader = spawn(process.execPath, [__filename, '--fade', targetFile], {
      detached: true,
      stdio: 'ignore'
    });
    fader.unref();

    process.exit(0);
  } catch (e) {
    process.exit(0);
  }
}

// Direct fade mode (called by spawned process)
if (process.argv.includes('--fade')) {
  const fileArg = process.argv[process.argv.indexOf('--fade') + 1];
  if (fileArg) {
    runFader(fileArg);
  } else {
    process.exit(0);
  }
} else if (process.argv.includes('--delayed-find')) {
  // Delayed finder - waits for agent files to appear then fades them
  const { spawn } = require('child_process');

  // Wait 3 seconds for agent files to be created
  setTimeout(() => {
    const activeFiles = findActiveAgentFiles();
    for (const file of activeFiles) {
      const fader = spawn(process.execPath, [__filename, '--fade', file], {
        detached: true,
        stdio: 'ignore'
      });
      fader.unref();
    }
    process.exit(0);
  }, 3000);
} else if (process.argv.includes('--daemon')) {
  // Session daemon mode - monitors for new agent files every 10 seconds
  // SINGLETON: Kill old daemon, take over
  // ACK: Uses in-file markers, no external tracking needed!

  // Kill any existing daemon and take over
  killOldDaemon();

  // Claim the daemon slot
  writePidFile();

  // Cleanup PID file on exit
  process.on('exit', cleanupPidFile);
  process.on('SIGINT', () => { cleanupPidFile(); process.exit(0); });
  process.on('SIGTERM', () => { cleanupPidFile(); process.exit(0); });

  // Track when we last processed each file (cooldown)
  const lastProcessed = new Map(); // path -> timestamp
  const COOLDOWN = 15000; // 15 seconds between processing same file
  const MAX_TRACKED_FILES = 200; // LOW-35 FIX: Limit map size to prevent memory leak

  const runCycle = () => {
    // findActiveAgentFiles() skips dirs not modified in 30s (fast early exit)
    const candidates = findActiveAgentFiles();

    if (candidates.length === 0) return; // Nothing to do - dir mtime check already optimized this

    // Filter out files on cooldown
    const now = Date.now();
    const ready = candidates.filter(f => {
      const lastTime = lastProcessed.get(f.path) || 0;
      return now - lastTime > COOLDOWN;
    });

    if (ready.length === 0) return; // All files on cooldown

    // SORT BY SIZE - biggest files first (most savings)
    // ONE FILE PER CYCLE - prevents resource spikes
    ready.sort((a, b) => b.size - a.size);
    const target = ready[0]; // Biggest ready file

    // Mark as processed
    lastProcessed.set(target.path, now);

    // Fade just this one file
    const result = fadeFile(target.path);

    if (result.ratio && process.env.SPECMEM_FADER_DEBUG) {
      console.error(`🌫️ Faded ${path.basename(target.path)}: ${result.ratio}% (${result.linesProcessed} lines, ${ready.length - 1} ready, ${candidates.length} total)`);
    }

    // LOW-35 FIX: Proper cleanup to prevent memory leak
    // Clean old entries from map (files that finished)
    if (lastProcessed.size > MAX_TRACKED_FILES / 2) {
      const entries = Array.from(lastProcessed.entries());
      // Sort by timestamp (oldest first) and remove stale entries
      entries.sort((a, b) => a[1] - b[1]);
      for (const [p, t] of entries) {
        // Remove if older than 10 minutes OR if map is too large
        if (now - t > 600000 || lastProcessed.size > MAX_TRACKED_FILES) {
          lastProcessed.delete(p);
        }
        // Stop if we've cleaned enough
        if (lastProcessed.size <= MAX_TRACKED_FILES / 2) break;
      }
    }
  };

  // Start the interval
  intervalHandle = setInterval(runCycle, FADE_INTERVAL);
  runCycle(); // Run immediately on start

  // Max 2 hour runtime
  setTimeout(() => {
    clearInterval(intervalHandle);
    cleanupPidFile();
    process.exit(0);
  }, 2 * 60 * 60 * 1000);
} else {
  // Hook mode - spawn daemon if not already running
  main().catch(() => process.exit(0));
}
