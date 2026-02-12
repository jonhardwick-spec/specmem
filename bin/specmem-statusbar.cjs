#!/usr/bin/env node
/**
 * SPECMEM STATUS BAR - Clean two-line status display
 * ===================================================
 * Old-school elegant theme with new functionality.
 *
 * Two lines:
 *   Line 1 (top):    Team comms - latest message centered on dash line
 *   Line 2 (bottom): Status info centered on dash line
 *
 * Coordinates with claudefix:
 *   - claudefix draws on row `rows` (bottom)
 *   - specmem draws on rows `rows - 2` and `rows - 1` (above claudefix)
 *
 * @author hardwicksoftwareservices
 * @website https://justcalljon.pro
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

// Dynamic version from package.json
const SPECMEM_VERSION = (() => {
  try { return require(path.join(__dirname, '..', 'package.json')).version; } catch (_) { return '?.?.?'; }
})();

// ============================================================================
// Colors - Clean basic ANSI (old-school elegant)
// ============================================================================

const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';
const GREEN   = '\x1b[32m';
const YELLOW  = '\x1b[33m';
const RED     = '\x1b[31m';
const CYAN    = '\x1b[36m';
const MAGENTA = '\x1b[35m';

// ============================================================================
// Configuration
// ============================================================================

const PROJECT_PATH = process.env.SPECMEM_PROJECT_PATH || process.cwd();
const SOCKET_PATH = path.join(PROJECT_PATH, 'specmem', 'sockets', 'embeddings.sock');
const DEBUG_LOG = path.join(PROJECT_PATH, 'specmem', 'sockets', 'mcp-debug.log');
const STATUS_FILE = path.join(PROJECT_PATH, 'specmem', 'sockets', 'statusbar-state.json');
const TEAM_COMMS_FILE = path.join(PROJECT_PATH, 'specmem', 'sockets', 'team-comms-latest.json');

// Max age for team comms to be considered "active" (5 minutes)
const TEAM_COMMS_MAX_AGE_MS = parseInt(process.env.SPECMEM_TEAM_COMMS_TTL || '300000', 10);

// ============================================================================
// Status State
// ============================================================================

let statusState = {
  embeddingHealth: 'unknown',
  lastToolCall: null,
  lastToolDuration: 0,
  memoryCount: 0,
  mcpConnected: false,
  lastUpdate: 0,
  mode: 'COMMAND',
  resourceUsage: null,
  syncScore: null,
  teamComms: null
};

// ============================================================================
// Health Checks
// ============================================================================

function checkEmbeddingHealth() {
  return new Promise((resolve) => {
    if (!fs.existsSync(SOCKET_PATH)) {
      resolve('offline');
      return;
    }

    const socket = new net.Socket();
    let responded = false;

    socket.setTimeout(2000);

    socket.connect(SOCKET_PATH, () => {
      socket.write(JSON.stringify({ stats: true }) + '\n');
    });

    socket.on('data', (data) => {
      if (!responded) {
        responded = true;
        socket.destroy();
        try {
          const response = JSON.parse(data.toString().split('\n')[0]);
          if (response.error) {
            resolve('degraded');
          } else {
            resolve('healthy');
          }
        } catch (e) {
          resolve('degraded');
        }
      }
    });

    socket.on('error', () => {
      if (!responded) { responded = true; socket.destroy(); resolve('error'); }
    });

    socket.on('timeout', () => {
      if (!responded) { responded = true; socket.destroy(); resolve('timeout'); }
    });
  });
}

function getLastToolCall() {
  try {
    if (!fs.existsSync(DEBUG_LOG)) return null;
    const content = fs.readFileSync(DEBUG_LOG, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    for (let i = lines.length - 1; i >= 0 && i > lines.length - 20; i--) {
      const line = lines[i];
      if (!line.includes('ERROR')) {
        const match = line.match(/\[(\d+:\d+:\d+)\]\s+(\w+)\s+\((\d+)ms\)/);
        if (match) {
          return { time: match[1], tool: match[2], duration: parseInt(match[3], 10) };
        }
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ============================================================================
// Resource Monitoring
// ============================================================================

function getResourceUsage() {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const ramPercent = Math.round((usedMem / totalMem) * 100);
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length || 1;
    const cpuLoad = Math.round((loadAvg[0] / cpuCount) * 100);
    return { ramPercent, cpuLoad };
  } catch (_e) {
    return null;
  }
}

// ============================================================================
// Team Comms
// ============================================================================

function getLatestTeamComms() {
  try {
    if (!fs.existsSync(TEAM_COMMS_FILE)) return null;
    const raw = fs.readFileSync(TEAM_COMMS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    // Check if message is still fresh
    const age = Date.now() - new Date(data.timestamp).getTime();
    if (age > TEAM_COMMS_MAX_AGE_MS) return null;
    return data;
  } catch (_e) {
    return null;
  }
}

// ============================================================================
// Status Formatting - Old-school elegant theme
// ============================================================================

/**
 * Format team comms line (top line)
 * Shows latest agent message truncated to 24 chars, or "no active team working"
 */
function formatTeamComms() {
  const comms = statusState.teamComms;
  if (!comms || !comms.message) {
    return `${DIM}no active team working${RESET}`;
  }
  // Clean the message - strip tags, metadata, swarm IDs
  let msg = comms.message
    .replace(/\[.*?\]/g, '')       // Remove [tags]
    .replace(/@\S+/g, '')          // Remove @mentions
    .replace(/swarm-\d+/gi, '')    // Remove swarm IDs
    .replace(/\s+/g, ' ')         // Normalize whitespace
    .trim();

  // Truncate to 24 chars
  if (msg.length > 24) {
    msg = msg.slice(0, 23) + '\u2026';
  }

  // Show sender name (truncated) + message
  let sender = (comms.sender || 'agent').replace(/^mcp-/, '').replace(/-\d+$/, '');
  if (sender.length > 10) sender = sender.slice(0, 9) + '\u2026';

  return `${CYAN}${sender}${RESET}${DIM}:${RESET} ${msg}`;
}

/**
 * Format status line (bottom line) - old-school style with new data
 *
 * Layout: ● health │ SpecMem v3.6.0 │ tool Xms │ 98% sync │ 14% RAM 9% CPU
 */
function formatStatus() {
  const parts = [];

  // Embedding health indicator
  const embIcon = {
    'healthy':  `${GREEN}\u25cf${RESET}`,
    'degraded': `${YELLOW}\u25d0${RESET}`,
    'error':    `${RED}\u25cf${RESET}`,
    'offline':  `${DIM}\u25cb${RESET}`,
    'timeout':  `${YELLOW}\u25cc${RESET}`,
    'unknown':  `${DIM}?${RESET}`
  }[statusState.embeddingHealth] || `${DIM}?${RESET}`;

  const healthLabel = {
    'healthy': `${GREEN}Online${RESET}`,
    'degraded': `${YELLOW}Degraded${RESET}`,
    'error': `${RED}Error${RESET}`,
    'offline': `${DIM}Offline${RESET}`,
    'timeout': `${YELLOW}Timeout${RESET}`,
    'unknown': `${DIM}Unknown${RESET}`
  }[statusState.embeddingHealth] || `${DIM}Unknown${RESET}`;

  parts.push(`${embIcon} ${healthLabel}`);

  // Version
  parts.push(`${CYAN}${BOLD}SpecMem${RESET} ${DIM}v${SPECMEM_VERSION}${RESET}`);

  // Last tool call
  if (statusState.lastToolCall) {
    const tool = statusState.lastToolCall.tool.replace('mcp__specmem__', '').slice(0, 18);
    const dur = statusState.lastToolCall.duration;
    const durColor = dur > 5000 ? RED : dur > 1000 ? YELLOW : GREEN;
    parts.push(`${CYAN}${tool}${RESET} ${durColor}${dur}ms${RESET}`);
  }

  // Sync score
  if (statusState.syncScore !== null && statusState.syncScore !== undefined) {
    const score = Math.round(statusState.syncScore);
    const syncColor = score >= 90 ? GREEN : score >= 50 ? YELLOW : RED;
    parts.push(`${syncColor}${score}%${RESET}${DIM} sync${RESET}`);
  }

  // Resources
  const res = statusState.resourceUsage || getResourceUsage();
  if (res) {
    const ramColor = res.ramPercent > 85 ? RED : res.ramPercent > 60 ? YELLOW : GREEN;
    const cpuColor = res.cpuLoad > 90 ? RED : res.cpuLoad > 70 ? YELLOW : GREEN;
    parts.push(`${ramColor}${res.ramPercent}%${RESET}${DIM} RAM${RESET} ${cpuColor}${res.cpuLoad}%${RESET}${DIM} CPU${RESET}`);
  }

  return parts.join(` ${DIM}\u2502${RESET} `);
}

// ============================================================================
// Drawing - Old-school centered-on-dashes style
// ============================================================================

/**
 * Center text on a line of dashes
 * @param {string} text - ANSI-colored text to center
 * @param {number} cols - Terminal width
 * @returns {string} Full-width dash line with centered text
 */
function centerOnDashes(text, cols) {
  const plainLen = text.replace(/\x1b\[[0-9;]*m/g, '').length;
  const totalDashes = Math.max(0, cols - plainLen - 4); // 4 = spaces around text
  const leftDashes = Math.floor(totalDashes / 2);
  const rightDashes = totalDashes - leftDashes;

  if (plainLen >= cols - 4) {
    // Text too long, just show it
    return text;
  }

  return `${DIM}${'─'.repeat(leftDashes)}${RESET} ${text} ${DIM}${'─'.repeat(rightDashes)}${RESET}`;
}

/**
 * Draw two-line status bar
 * Line 1 (rows - 2): Team comms centered on dashes
 * Line 2 (rows - 1): Status info centered on dashes
 */
function drawStatusBar(rows, cols) {
  const commsLine = centerOnDashes(formatTeamComms(), cols);
  const statusLine = centerOnDashes(formatStatus(), cols);

  // Draw on rows - 2 and rows - 1 (above claudefix on rows)
  process.stdout.write(
    '\x1b7' +                                // Save cursor
    `\x1b[${rows - 2};1H` +                 // Move to team comms row
    '\x1b[2K' +                              // Clear line
    commsLine +                              // Team comms
    `\x1b[${rows - 1};1H` +                 // Move to status row
    '\x1b[2K' +                              // Clear line
    statusLine +                             // Status info
    '\x1b8'                                  // Restore cursor
  );
}

// ============================================================================
// Update
// ============================================================================

async function updateStatus() {
  statusState.embeddingHealth = await checkEmbeddingHealth();
  statusState.lastToolCall = getLastToolCall();
  statusState.resourceUsage = getResourceUsage();
  statusState.teamComms = getLatestTeamComms();
  statusState.lastUpdate = Date.now();

  // Read sync score from state file
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const existing = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
      if (existing.syncScore !== undefined) {
        statusState.syncScore = existing.syncScore;
      }
    }
  } catch (e) { /* ignore */ }

  // Save state for other processes to read
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(statusState, null, 2));
  } catch (e) { /* ignore */ }
}

function setMode(mode) {
  const valid = ['COMMAND', 'CLAUDE', 'SPECMEM'];
  statusState.mode = valid.includes((mode || '').toUpperCase())
    ? mode.toUpperCase()
    : 'COMMAND';
}

// ============================================================================
// Export for claudefix integration
// ============================================================================

module.exports = {
  drawStatusBar,
  updateStatus,
  getStatus: () => statusState,
  formatStatus,
  formatTeamComms,
  checkEmbeddingHealth,
  setMode,
  getResourceUsage
};

// ============================================================================
// Standalone mode
// ============================================================================

if (require.main === module) {
  const rows = process.stdout.rows || 24;
  const cols = process.stdout.columns || 80;

  console.log('SpecMem Status Bar - Standalone Test');
  console.log('=====================================\n');

  async function run() {
    await updateStatus();

    console.log('Team Comms:', formatTeamComms().replace(/\x1b\[[0-9;]*m/g, ''));
    console.log('Status:', formatStatus().replace(/\x1b\[[0-9;]*m/g, ''));
    console.log('\nState:', JSON.stringify(statusState, null, 2));

    // Draw at bottom
    console.log('\nDrawing status bar...');
    drawStatusBar(rows, cols);
  }

  run().catch(console.error);
}
