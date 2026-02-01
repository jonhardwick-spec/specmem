#!/usr/bin/env node
/**
 * SPECMEM CONSOLE - The SpecMem Brain Terminal 🧠
 * ================================================
 *
 * An interactive console for SpecMem that runs independently of Claude.
 * Can control Claude instances, run memory searches, and manage the system.
 *
 * Features:
 *   - Run SpecMem commands without Claude
 *   - Launch/control Claude instances in screen sessions
 *   - Auto-permission handling
 *   - Project-based screen naming
 *
 * Screen Sessions:
 *   - claude-{projectId}   - Claude instance for this project
 *   - specmem-{projectId}  - This console (SpecMem brain)
 *
 * @author hardwicksoftwareservices
 * @website https://justcalljon.pro
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { execSync, spawn, exec } = require('child_process');
const os = require('os');
const crypto = require('crypto');

// ============================================================================
// TMPFS SCREEN LOG - Zero disk I/O for screen logging
// Uses /dev/shm (RAM disk) to eliminate I/O lag from continuous screen output
// ============================================================================
const TMPFS_BASE = '/dev/shm/specmem';

/**
 * Get screen log path - prefers tmpfs (/dev/shm) for zero disk I/O
 * Falls back to local specmem/sockets if tmpfs unavailable
 */
function getScreenLogPath(projectPath) {
  const projectHash = crypto.createHash('md5').update(projectPath).digest('hex').slice(0, 8);
  const tmpfsDir = path.join(TMPFS_BASE, projectHash);
  const tmpfsLog = path.join(tmpfsDir, 'claude-screen.log');
  const localLog = path.join(projectPath, 'specmem', 'sockets', 'claude-screen.log');

  // Try to use tmpfs (RAM disk) - zero disk I/O
  try {
    if (fs.existsSync('/dev/shm')) {
      fs.mkdirSync(tmpfsDir, { recursive: true, mode: 0o755 });
      return tmpfsLog;
    }
  } catch (e) { /* fallback to local */ }

  return localLog;
}

// ============================================================================
// PTY MEMORY BUFFER - Pure memory, ZERO disk I/O
// Uses node-pty to capture screen output directly into memory ring buffer
// ============================================================================

let pty = null;
try {
  pty = require('node-pty');
} catch (e) {
  // node-pty not available, will use fallback
}

/**
 * Pure memory ring buffer for screen output - ZERO DISK I/O
 * Stores last N lines with O(1) append, preserves ANSI colors
 */
class PTYMemoryBuffer {
  constructor(maxLines = 100) {
    this.maxLines = maxLines;
    this.buffer = new Array(maxLines).fill('');
    this.head = 0; // Next write position
    this.count = 0; // Number of lines stored
    this.lastUpdate = 0;
    this.ptyProcess = null;
    this.attached = false;
  }

  /**
   * Append a line to the ring buffer - O(1) operation
   */
  appendLine(line) {
    this.buffer[this.head] = line;
    this.head = (this.head + 1) % this.maxLines;
    if (this.count < this.maxLines) this.count++;
    this.lastUpdate = Date.now();
  }

  /**
   * Append raw data (may contain multiple lines)
   */
  appendData(data) {
    if (!data) return;
    const lines = data.split('\n');
    for (const line of lines) {
      if (line || lines.length === 1) {
        this.appendLine(line);
      }
    }
  }

  /**
   * Get last N lines from ring buffer - O(n) where n is requested lines
   */
  getLastLines(n = 50) {
    const result = [];
    const start = (this.head - Math.min(n, this.count) + this.maxLines) % this.maxLines;
    const count = Math.min(n, this.count);

    for (let i = 0; i < count; i++) {
      const idx = (start + i) % this.maxLines;
      result.push(this.buffer[idx]);
    }
    return result.join('\n');
  }

  /**
   * Get all content
   */
  getContent() {
    return this.getLastLines(this.count);
  }

  /**
   * Clear buffer
   */
  clear() {
    this.buffer.fill('');
    this.head = 0;
    this.count = 0;
  }
}

// Global PTY buffers per session
const ptyBuffers = new Map();
const ptyProcesses = new Map();

/**
 * Get or create PTY buffer for a session
 */
function getPTYBuffer(sessionName) {
  if (!ptyBuffers.has(sessionName)) {
    ptyBuffers.set(sessionName, new PTYMemoryBuffer(100));
  }
  return ptyBuffers.get(sessionName);
}

/**
 * Attach to a screen session via PTY for live capture
 * This creates a read-only PTY that mirrors the screen output
 */
function attachPTYToScreen(sessionName) {
  if (!pty || !sessionName) return null;
  if (ptyProcesses.has(sessionName)) return ptyProcesses.get(sessionName);

  try {
    const buffer = getPTYBuffer(sessionName);

    // Use screen -x to attach in read-only mode
    const ptyProc = pty.spawn('screen', ['-x', sessionName], {
      name: 'xterm-256color',
      cols: 200,
      rows: 50,
      cwd: process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' }
    });

    ptyProc.onData((data) => {
      buffer.appendData(data);
    });

    ptyProc.onExit(() => {
      ptyProcesses.delete(sessionName);
    });

    ptyProcesses.set(sessionName, ptyProc);
    return ptyProc;
  } catch (e) {
    return null;
  }
}

/**
 * Capture screen content - ZERO DISK I/O
 * Uses PTY buffer if attached, falls back to one-shot capture
 */
function captureScreenToPTY(sessionName, lines = 50) {
  if (!sessionName) return '';

  const buffer = getPTYBuffer(sessionName);

  // If we have recent data (< 100ms old), return from buffer
  if (buffer.count > 0 && Date.now() - buffer.lastUpdate < 100) {
    return buffer.getLastLines(lines);
  }

  // Try to attach PTY for continuous capture
  if (pty && !ptyProcesses.has(sessionName)) {
    attachPTYToScreen(sessionName);
  }

  // Return buffered content
  if (buffer.count > 0) {
    return buffer.getLastLines(lines);
  }

  // Fallback: one-shot capture using screen dump (no file I/O)
  try {
    // Use screen -X stuff to trigger output, then read via screen -Q
    // Note: screen errors go to stdout, not stderr, so we need to filter them
    const content = execSync(`screen -S "${sessionName}" -Q echo 2>/dev/null || true`, {
      encoding: 'utf8',
      timeout: 500
    });
    // Filter out screen error messages that go to stdout
    // Common errors: "-X: echo: one or two arguments required", "No screen session found"
    if (content && !content.startsWith('-X:') && !content.includes('No screen session found') && !content.includes('Use: screen')) {
      buffer.appendData(content);
      return buffer.getLastLines(lines);
    }
  } catch (e) {
    // Fallback failed
  }

  return buffer.getLastLines(lines);
}

/**
 * Detach PTY from screen session
 */
function detachPTY(sessionName) {
  if (ptyProcesses.has(sessionName)) {
    try {
      ptyProcesses.get(sessionName).kill();
    } catch (e) {}
    ptyProcesses.delete(sessionName);
  }
}

/**
 * Detach all PTY processes
 */
function detachAllPTY() {
  for (const [name, proc] of ptyProcesses) {
    try { proc.kill(); } catch (e) {}
  }
  ptyProcesses.clear();
}

/**
 * Get the Python executable path for spawning Python processes (Task #22 fix)
 * Priority: SPECMEM_PYTHON_PATH > PYTHON_PATH > VIRTUAL_ENV/bin/python > python3
 */
function getPythonPath() {
  if (process.env['SPECMEM_PYTHON_PATH']) return process.env['SPECMEM_PYTHON_PATH'];
  if (process.env['PYTHON_PATH']) return process.env['PYTHON_PATH'];
  const virtualEnv = process.env['VIRTUAL_ENV'];
  if (virtualEnv) {
    const isWindows = process.platform === 'win32';
    return isWindows ? virtualEnv + '/Scripts/python.exe' : virtualEnv + '/bin/python';
  }
  return 'python3';
}

// Dashboard module system - Minecraft-style module management
const {
  DashboardModule,
  ClaudePreviewModule,
  PythiaCOTModule,
  MCPToolsModule,
  CommandConsoleModule,
  ModuleManager
} = require('./DashboardModules.cjs');

// ============================================================================
// TERMINAL CAPABILITY DETECTION
// ============================================================================

/**
 * Detect terminal capabilities for cross-platform compatibility
 * Handles XFCE, basic Linux terminals, and emoji-challenged environments
 */
function detectTerminalCapabilities() {
  const term = process.env.TERM || '';
  const colorterm = process.env.COLORTERM || '';
  const terminal = process.env.TERMINAL || '';
  const lang = process.env.LANG || '';
  const lcAll = process.env.LC_ALL || '';

  // Check for true color support
  const hasTrueColor = colorterm === 'truecolor' || colorterm === '24bit' ||
                       term.includes('256color') || term.includes('truecolor');

  // Check for basic color support
  const hasColors = hasTrueColor || term.includes('color') || term.includes('xterm') ||
                    term.includes('screen') || term.includes('tmux') || term.includes('vt100');

  // Check for unicode/emoji support
  // UTF-8 locale suggests unicode support, but emojis need more
  const hasUnicode = lang.includes('UTF-8') || lcAll.includes('UTF-8');

  // Known problematic terminals for emojis (old/limited terminals)
  const problematicTerminals = ['linux', 'vt100', 'vt220', 'dumb'];
  const isProblematicEmoji = problematicTerminals.some(t =>
    term.toLowerCase() === t
  );

  // Console/TTY check
  const isTTY = process.stdout.isTTY;

  // XFCE specific detection (known emoji issues without proper fonts)
  const isXFCE = terminal.includes('xfce') || process.env.XDG_CURRENT_DESKTOP === 'XFCE';

  // Default to safe mode if any issues detected
  const safeMode = !isTTY || term === 'dumb' || term === '' || process.env.SPECMEM_SAFE_MODE === '1';

  // Modern terminals that support emojis well
  const modernEmojiTerminals = [
    // Terminal emulator env vars
    process.env.WT_SESSION,          // Windows Terminal
    process.env.KITTY_WINDOW_ID,     // Kitty
    process.env.WEZTERM_PANE,        // WezTerm
    process.env.KONSOLE_VERSION,     // Konsole
    process.env.GNOME_TERMINAL_SCREEN, // GNOME Terminal
    process.env.ITERM_SESSION_ID,    // iTerm2
    process.env.ALACRITTY_WINDOW_ID, // Alacritty (recent versions)
    process.env.TERMINATOR_UUID,     // Terminator
    process.env.TILIX_ID,            // Tilix
    process.env.HYPER_VERSION,       // Hyper
  ].some(v => v !== undefined);

  // Additional terminal detection via TERM_PROGRAM
  const termProgram = (process.env.TERM_PROGRAM || '').toLowerCase();
  const emojiCapablePrograms = ['iterm.app', 'apple_terminal', 'vscode', 'hyper', 'tabby'];
  const isEmojiCapableProgram = emojiCapablePrograms.some(p => termProgram.includes(p));

  // Emoji support - check for modern terminals or force enable
  // Modern terminals generally handle emojis well with proper fonts
  const hasEmoji = !safeMode && hasUnicode && !isProblematicEmoji && !isXFCE && (
    process.platform === 'darwin' ||       // macOS usually works
    process.env.SPECMEM_EMOJI === '1' ||   // Force enable
    modernEmojiTerminals ||                 // Modern terminal detected
    isEmojiCapableProgram ||                // Known emoji-capable program
    (hasTrueColor && !isXFCE)               // True color usually means modern terminal
  );

  return {
    hasTrueColor,
    hasColors: hasColors && !safeMode,
    hasUnicode,
    hasEmoji,
    isTTY,
    isXFCE,
    safeMode,
    term,
    colorterm,
    modernTerminal: modernEmojiTerminals || isEmojiCapableProgram
  };
}

const termCaps = detectTerminalCapabilities();

// ============================================================================
// ANSI COLORS (with fallback support)
// ============================================================================

const c = termCaps.hasColors ? {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  black: '\x1b[30m',
  gray: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightCyan: '\x1b[96m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgRed: '\x1b[41m',
  bgCyan: '\x1b[46m',
  bgGreen: '\x1b[42m',
  clearLine: '\x1b[2K',
  cursorStart: '\x1b[0G'
} : {
  // No-color fallbacks for dumb terminals
  reset: '', bold: '', dim: '', red: '', green: '', yellow: '', blue: '',
  magenta: '', cyan: '', white: '', black: '', gray: '', brightRed: '', brightGreen: '',
  brightYellow: '', brightCyan: '', bgBlue: '', bgMagenta: '', bgRed: '', bgCyan: '', bgGreen: '',
  clearLine: '', cursorStart: ''
};

// ============================================================================
// ANSI ESCAPE CODE UTILITIES (MED-01, MED-02 fixes)
// ============================================================================

/**
 * Strip ANSI escape codes from a string for accurate width calculation
 * MED-01 fix: titlePart.length was including ANSI codes in width calc
 * Handles CSI sequences (ESC[), OSC sequences (ESC]), and other escape codes
 */
function stripAnsi(str) {
  // Match comprehensive ANSI escape sequences:
  // - CSI sequences: ESC[ followed by params and command char (most common)
  // - OSC sequences: ESC] followed by text and terminated by BEL or ESC\
  // - Other escape sequences: ESC followed by single char
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')  // CSI sequences
            .replace(/\x1b\][^\x07]*\x07/g, '')      // OSC with BEL terminator
            .replace(/\x1b\][^\x1b]*\x1b\\/g, '')    // OSC with ESC\ terminator
            .replace(/\x1b[=>()c]/g, '');            // Other escape sequences
}

/**
 * Get visible (display) width of a string, excluding ANSI codes
 * Also accounts for wide characters (emoji, CJK) that take 2 terminal columns
 */
function visibleLength(str) {
  const stripped = stripAnsi(str);
  let width = 0;
  for (const char of stripped) {
    const code = char.codePointAt(0);
    // Most emoji and CJK characters are double-width in terminals
    // Emoji: range 0x1F000-0x1FFFF and some in 0x2600-0x27FF
    // CJK: 0x4E00-0x9FFF, 0x3000-0x303F, etc.
    if (code >= 0x1F000 && code <= 0x1FFFF) {
      width += 2; // Emoji ranges (faces, symbols, etc.)
    } else if (code >= 0x2600 && code <= 0x27BF) {
      width += 2; // Misc symbols and dingbats (often emoji)
    } else if (code >= 0x4E00 && code <= 0x9FFF) {
      width += 2; // CJK Unified Ideographs
    } else if (code >= 0x3000 && code <= 0x303F) {
      width += 2; // CJK Punctuation
    } else if (code >= 0xFF00 && code <= 0xFFEF) {
      width += 2; // Fullwidth forms
    } else if (code >= 0x2300 && code <= 0x23FF) {
      width += 2; // Misc Technical (includes ⏹ pause etc.)
    } else if (code >= 0x2700 && code <= 0x27BF) {
      width += 2; // Dingbats
    } else {
      width += 1;
    }
  }
  return width;
}


/**
 * Get terminal display width of a single character
 * Returns 2 for wide chars (emoji, CJK), 1 for normal chars
 */
function getCharWidth(char) {
  const code = char.codePointAt(0);
  if (code >= 0x1F000 && code <= 0x1FFFF) return 2; // Emoji
  if (code >= 0x2600 && code <= 0x27BF) return 2;   // Misc symbols/dingbats
  if (code >= 0x4E00 && code <= 0x9FFF) return 2;   // CJK Unified Ideographs
  if (code >= 0x3000 && code <= 0x303F) return 2;   // CJK Punctuation
  if (code >= 0xFF00 && code <= 0xFFEF) return 2;   // Fullwidth forms
  if (code >= 0x2300 && code <= 0x23FF) return 2;   // Misc Technical
  if (code >= 0x2700 && code <= 0x27BF) return 2;   // Dingbats
  return 1;
}

/**
 * Truncate a string to maxLen visible characters, preserving ANSI codes
 * MED-02 fix: Plain .slice() can cut ANSI sequences in half
 */
function truncateAnsiSafe(str, maxLen) {
  if (!str || typeof str !== 'string') return '';
  if (maxLen <= 0) return '';

  let visibleCount = 0;
  let result = '';
  let i = 0;

  while (i < str.length && visibleCount < maxLen) {
    // Check for ANSI escape sequence
    if (str[i] === '\x1b' && str[i + 1] === '[') {
      // Find end of escape sequence
      let j = i + 2;
      while (j < str.length && /[0-9;]/.test(str[j])) j++;
      if (j < str.length) j++; // Include command character
      result += str.slice(i, j);
      i = j;
    } else {
      const charWidth = getCharWidth(str[i]);
      // Don't add if it would exceed maxLen
      if (visibleCount + charWidth > maxLen) break;
      result += str[i];
      visibleCount += charWidth;
      i++;
    }
  }

  // Append reset if we truncated a styled string
  if (i < str.length && result.includes('\x1b[')) {
    result += c.reset;
  }

  return result;
}

/**
 * Wrap a string to maxWidth visible characters, preserving ANSI codes
 * Returns array of wrapped lines
 */
function wrapAnsiSafe(str, maxWidth) {
  if (!str || typeof str !== 'string') return [''];
  if (maxWidth <= 0) return [''];

  const lines = [];
  let currentLine = '';
  let visibleCount = 0;
  let i = 0;
  let lastActiveStyle = ''; // Track last ANSI style to carry over

  while (i < str.length) {
    // Check for ANSI escape sequence
    if (str[i] === '\x1b' && str[i + 1] === '[') {
      // Find end of escape sequence
      let j = i + 2;
      while (j < str.length && /[0-9;]/.test(str[j])) j++;
      if (j < str.length) j++; // Include command character
      const ansiSeq = str.slice(i, j);
      currentLine += ansiSeq;
      // Track style (not reset)
      if (!ansiSeq.includes('[0m') && !ansiSeq.includes('[m')) {
        lastActiveStyle = ansiSeq;
      } else {
        lastActiveStyle = '';
      }
      i = j;
    } else if (str[i] === '\n') {
      // Explicit newline - push line and reset
      if (currentLine.includes('\x1b[')) currentLine += c.reset;
      lines.push(currentLine);
      currentLine = lastActiveStyle; // Carry style to next line
      visibleCount = 0;
      i++;
    } else {
      const charWidth = getCharWidth(str[i]);
      // Would exceed? Wrap to next line
      if (visibleCount + charWidth > maxWidth) {
        if (currentLine.includes('\x1b[')) currentLine += c.reset;
        lines.push(currentLine);
        currentLine = lastActiveStyle; // Carry style to next line
        visibleCount = 0;
      }
      currentLine += str[i];
      visibleCount += charWidth;
      i++;
    }
  }

  // Push remaining content
  if (currentLine || visibleCount > 0) {
    if (currentLine.includes('\x1b[')) currentLine += c.reset;
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
}

// ============================================================================
// EMOJI/ICON SYSTEM (with ASCII fallbacks)
// ============================================================================

/**
 * Icons with ASCII fallbacks for terminals without emoji support
 */
const icons = termCaps.hasEmoji ? {
  // Status
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  critical: '🚨',
  dead: '💀',
  healthy: '●',

  // UI Elements
  brain: '🧠',
  robot: '🤖',
  arrow: '→',
  bullet: '•',
  check: '✓',
  cross: '✗',
  dot: '●',
  circle: '○',
  star: '★',

  // Actions
  save: '💾',
  stop: '⏹',
  play: '▶',
  pause: '⏸',
  refresh: '↻',

  // Decorative
  box_tl: '╔', box_tr: '╗', box_bl: '╚', box_br: '╝',
  box_h: '═', box_v: '║',
  line_h: '─', line_v: '│',

  // Arrow icons for footer
  arrow_u: '↑', arrow_d: '↓', arrow_l: '←', arrow_r: '→',
  users: '👥'
} : {
  // ASCII fallbacks
  success: '[OK]',
  error: '[X]',
  warning: '[!]',
  info: '[i]',
  critical: '[!!!]',
  dead: '[DEAD]',
  healthy: '[*]',

  brain: '[BRAIN]',
  robot: '[CLAUDE]',
  arrow: '->',
  bullet: '*',
  check: '+',
  cross: 'x',
  dot: 'o',
  circle: 'o',
  star: '*',

  save: '[SAVE]',
  stop: '[STOP]',
  play: '[>]',
  pause: '[||]',
  refresh: '[R]',

  // Box drawing - use ASCII
  box_tl: '+', box_tr: '+', box_bl: '+', box_br: '+',
  box_h: '=', box_v: '|',
  line_h: '-', line_v: '|',

  // Arrow icons for footer - ASCII fallback
  arrow_u: '^', arrow_d: 'v', arrow_l: '<', arrow_r: '>',
  users: '[TEAM]'
};

// ============================================================================
// TTY STREAM HELPER - Get correct input/output for screen sessions
// ============================================================================

/**
 * Read last N lines of a log file efficiently using tail.
 *
 * @param {string} filePath - Path to the file
 * @param {number} lines - Number of lines to read (default: 50)
 * @returns {string|null} Last N lines of the file, or null on error
 */
function readLastLines(filePath, lines = 50, maxFileLines = 100) {
  if (!fs.existsSync(filePath)) return null;
  try {
    // Check if file is too big - if so, truncate to last maxFileLines
    const lineCount = parseInt(execSync(`wc -l < "${filePath}" 2>/dev/null`, { encoding: 'utf8' }).trim()) || 0;
    if (lineCount > maxFileLines) {
      // Truncate file to last maxFileLines lines in-place
      const lastLines = execSync(`tail -n ${maxFileLines} "${filePath}" 2>/dev/null`, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024
      });
      try {
        fs.writeFileSync(filePath, lastLines, 'utf8');
      } catch (e) { /* ignore write errors */ }
    }

    // Now read requested number of lines
    return execSync(`tail -n ${lines} "${filePath}" 2>/dev/null`, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    });
  } catch (e) {
    return null;
  }
}

/**
 * Read last N lines of a log file and WIPE everything before.
 * Keeps log files from growing unbounded.
 *
 * @param {string} filePath - Path to the file
 * @param {number} lines - Number of lines to keep (default: 50)
 * @returns {string|null} Last N lines of the file, or null on error
 */
function readAndTruncateLog(filePath, lines = 50) {
  const content = readLastLines(filePath, lines);
  if (content) {
    try {
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (e) {}
  }
  return content;
}

/**
 * Extract MCP tool calls from Claude screen log.
 * Parses log content for tool invocations like mcp__specmem__*, Bash, Read, Edit, etc.
 * Shows only the CALL, not the output/result. Most recent calls first.
 *
 * @param {string} logContent - Raw log content from screen capture
 * @param {number} maxCalls - Maximum number of calls to return (default: 20)
 * @returns {Array<Object>} Array of { toolName, args, timestamp, line }
 */
function extractMcpToolCalls(logContent, maxCalls = 20) {
  if (!logContent) return [];

  const calls = [];
  const lines = logContent.split('\n');

  // Patterns to match various tool invocations
  const patterns = [
    // MCP specmem tools: mcp__specmem__find_memory
    /mcp__specmem__(\w+)\s*\(/i,
    // Built-in tools: Bash(...), Read(...), Edit(...)
    /(Bash|Read|Edit|Write|Glob|Grep|WebSearch|WebFetch|Skill)\s*\(/i,
    // Alternative format: invoking tool "toolname"
    /invoking\s+(?:tool\s+)?["']?([a-zA-Z_]\w+)["']?\s*with/i,
    // MCP tool format in results: Tool: toolname
    /Tool:\s*([a-zA-Z_]\w+)/i
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;

      let toolName = match[1];

      // For specmem tools, prepend the namespace
      if (pattern === patterns[0]) {
        toolName = `mcp__specmem__${toolName}`;
      }

      // Extract arguments (truncated to 100 chars)
      let args = '';
      const argsMatch = line.match(/\(([^)]*)\)/);
      if (argsMatch && argsMatch[1]) {
        args = argsMatch[1].substring(0, 100);
        if (argsMatch[1].length > 100) args += '...';
      }

      // Try to extract timestamp from line (common format: HH:MM:SS or [timestamp])
      let timestamp = '';
      const timeMatch = line.match(/(\d{2}:\d{2}:\d{2})|(\[\d{4}-\d{2}-\d{2}[^\]]*\])/);
      if (timeMatch) {
        timestamp = timeMatch[0];
      }

      calls.push({
        toolName,
        args: args || '(no args captured)',
        timestamp: timestamp || 'unknown',
        line: i + 1
      });

      break; // Only match first pattern per line
    }

    // Stop if we've collected enough calls
    if (calls.length >= maxCalls) break;
  }

  // Most recent calls first (reverse the array since we read top to bottom)
  return calls.reverse();
}

/**
 * Get the correct input/output streams for interactive use.
 * When running in a screen session, process.stdin may not be the real terminal.
 * This function opens /dev/tty directly to get the actual terminal streams.
 *
 * @returns {Object} { input, output, isTTY, cleanup }
 */
function getTTYStreams() {
  const inScreen = !!process.env.STY;
  let inputStream = process.stdin;
  let outputStream = process.stdout;
  let isTTY = process.stdin.isTTY;
  let ttyFd = null;

  if (inScreen) {
    try {
      // Open /dev/tty directly - this is the REAL terminal
      // This fixes stdin capture when running in screen sessions
      const tty = require('tty');
      ttyFd = fs.openSync('/dev/tty', 'r+');
      inputStream = new tty.ReadStream(ttyFd);
      outputStream = new tty.WriteStream(ttyFd);
      isTTY = true;
    } catch (err) {
      // Fallback to process.stdin if /dev/tty fails (e.g., no controlling terminal)
      console.error(`${c.yellow}${icons.warning} Could not open /dev/tty: ${err.message}${c.reset}`);
    }
  }

  const cleanup = () => {
    try {
      if (ttyFd !== null) {
        inputStream.destroy();
        outputStream.destroy();
        fs.closeSync(ttyFd);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  };

  return { input: inputStream, output: outputStream, isTTY, cleanup };
}

// ============================================================================
// TERMINAL STATE SAFETY (MED-05 fix)
// ============================================================================

/**
 * Track raw mode state and ensure cleanup on errors/exit
 * MED-05 fix: Raw mode not restored on error
 */
let rawModeActive = false;

function safeSetRawMode(enable) {
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    try {
      process.stdin.setRawMode(enable);
      rawModeActive = enable;
    } catch (e) {
      // Ignore errors if terminal is already in desired state
    }
  }
}

function restoreTerminalState() {
  try {
    if (rawModeActive && process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
      rawModeActive = false;
    }
    // Also restore cursor and exit alternate buffer if needed
    if (termCaps.hasColors) {
      process.stdout.write('\x1b[?25h');   // Show cursor
      process.stdout.write('\x1b[?1049l'); // Exit alternate buffer
    }
  } catch (e) {
    // Best effort - terminal may already be closed
  }
}

// Register global error handlers to restore terminal state
process.on('uncaughtException', (err) => {
  restoreTerminalState();
  console.error(`\n${c.red}Uncaught exception:${c.reset}`, err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  restoreTerminalState();
  console.error(`\n${c.red}Unhandled rejection:${c.reset}`, reason);
});

process.on('SIGINT', () => {
  restoreTerminalState();
  process.exit(0);
});

process.on('SIGTERM', () => {
  restoreTerminalState();
  process.exit(0);
});

// ============================================================================
// ANIMATED BANNER - Sliding red highlight through SPECMEM letters
// ============================================================================

const BANNER_LINES = [
  '  ███████╗██████╗ ███████╗ ██████╗███╗   ███╗███████╗███╗   ███╗',
  '  ██╔════╝██╔══██╗██╔════╝██╔════╝████╗ ████║██╔════╝████╗ ████║',
  '  ███████╗██████╔╝█████╗  ██║     ██╔████╔██║█████╗  ██╔████╔██║',
  '  ╚════██║██╔═══╝ ██╔══╝  ██║     ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║',
  '  ███████║██║     ███████╗╚██████╗██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║',
  '  ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝',
];

// Letter column ranges: [start, end] for S P E C M E M
const LETTER_RANGES = [
  [2, 9],   // S
  [10, 17], // P
  [18, 26], // E
  [27, 34], // C
  [35, 46], // M (first)
  [47, 54], // E
  [55, 66], // M (second)
];

// ANSI cursor control
const cursor = {
  up: (n) => `\x1b[${n}A`,
  hide: '\x1b[?25l',
  show: '\x1b[?25h',
};

// Colorize a single line with specific letter highlighted
function colorizeBannerLine(line, highlightIdx, fadeIdx) {
  let result = '';
  const chars = [...line];

  for (let i = 0; i < chars.length; i++) {
    let color = c.gray;

    for (let letterIdx = 0; letterIdx < LETTER_RANGES.length; letterIdx++) {
      const [start, end] = LETTER_RANGES[letterIdx];
      if (i >= start && i < end) {
        if (letterIdx === highlightIdx) {
          color = c.brightRed + c.bold;
        } else if (letterIdx < fadeIdx) {
          color = c.cyan;
        }
        break;
      }
    }

    result += color + chars[i];
  }

  return result + c.reset;
}

// Animated banner with sliding red highlight - SIMPLE & ROBUST
async function showAnimatedBanner(skipAnimation = false) {
  const bannerHeight = BANNER_LINES.length;

  // Static fallback
  const drawStatic = () => {
    console.log('');
    for (const line of BANNER_LINES) {
      console.log(c.cyan + c.bold + line + c.reset);
    }
    console.log(`${c.dim}  Developed by Hardwick Software Services | https://justcalljon.pro${c.reset}`);
    console.log('');
  };

  if (skipAnimation || !process.stdout.isTTY || !termCaps.hasColors) {
    drawStatic();
    return;
  }

  const SAVE_CURSOR = '\x1b7';
  const RESTORE_CURSOR = '\x1b8';
  const FRAME_DELAY = 90;
  const LETTERS = 7;

  process.stdout.write(cursor.hide);
  console.log('');

  // Reserve space
  for (let i = 0; i < bannerHeight; i++) console.log('');

  // Go back
  process.stdout.write(`\x1b[${bannerHeight}A`);
  process.stdout.write(SAVE_CURSOR);

  try {
    for (let highlight = 0; highlight <= LETTERS; highlight++) {
      process.stdout.write(RESTORE_CURSOR);

      for (let i = 0; i < bannerHeight; i++) {
        const line = colorizeBannerLine(BANNER_LINES[i], highlight, highlight);
        process.stdout.write('\r' + c.clearLine + line + '\n');
      }

      if (highlight < LETTERS) {
        await new Promise(r => setTimeout(r, FRAME_DELAY));
      }
    }

    // Final solid cyan
    process.stdout.write(RESTORE_CURSOR);
    for (const line of BANNER_LINES) {
      process.stdout.write('\r' + c.clearLine + c.cyan + c.bold + line + c.reset + '\n');
    }
  } catch (e) {
    // Fallback
  } finally {
    process.stdout.write(cursor.show);
  }

  console.log(`${c.dim}  Developed by Hardwick Software Services | https://justcalljon.pro${c.reset}`);
  console.log('');
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Get project ID from path (last directory name, sanitized)
 */
function getProjectId(projectPath) {
  if (!projectPath) {
    console.error('WARNING: projectPath is undefined, using fallback');
    return 'unknown-project';
  }
  const name = path.basename(projectPath);
  if (!name) {
    console.error('WARNING: project basename is empty, using fallback');
    return 'unknown-project';
  }
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() || 'unknown-project';
}

/**
 * Check if a command exists
 */
function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Check if screen is installed
 */
function checkScreenDependency() {
  if (!commandExists('screen')) {
    console.log(`${c.red}${icons.error} ERROR: 'screen' is not installed${c.reset}`);
    console.log(`${c.dim}Install with: ${c.cyan}sudo apt install screen${c.reset}`);
    console.log(`${c.dim}Or on macOS: ${c.cyan}brew install screen${c.reset}`);
    process.exit(1);
  }
}

/**
 * List active screen sessions
 */
function listScreens() {
  try {
    const output = execSync('screen -ls 2>/dev/null || true', { encoding: 'utf8' });
    return output;
  } catch (e) {
    return '';
  }
}

/**
 * Check if a screen session exists
 * Uses regex to match exact session name, not partial matches
 */
function screenExists(name) {
  const screens = listScreens();
  // Match pattern: "PID.session-name" or just ".session-name"
  // This prevents false positives like "claude-proj" matching "claude-proj-1"
  const pattern = new RegExp('\\s+\\d+\\.' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+');
  return pattern.test(screens);
}

/**
 * Send text to a screen session
 * Uses screen's stuff command for reliable input transmission
 */
function screenSend(sessionName, text, enterAfter = true) {
  try {
    // Escape special chars for shell - critical for quotes and backslashes
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
    const content = enterAfter ? escaped + '\r' : escaped;

    // Use stuff command to send text directly to screen session
    execSync('screen -S ' + sessionName + ' -p 0 -X stuff "' + content + '"', {
      stdio: 'ignore',
      timeout: 3000
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Send key to screen session
 */
function screenKey(sessionName, key) {
  // Map keys to their actual byte sequences
  const keyMap = {
    enter: '^M',            // Carriage return for stuff command
    tab: '^I',              // Tab
    backspace: '^?',        // DEL
    'ctrl-c': '^C',         // ETX
    'ctrl-d': '^D',         // EOT
    esc: '^[',              // ESC
    down: '^[[B',           // Down arrow
    up: '^[[A',             // Up arrow
    left: '^[[D',           // Left arrow
    right: '^[[C',          // Right arrow
    'shift-tab': '^[[Z',    // Shift-tab
    home: '^[[H',           // Home
    end: '^[[F',            // End
    delete: '^[[3~',        // Delete
    'page-up': '^[[5~',     // Page up
    'page-down': '^[[6~'    // Page down
  };

  const stuffKey = keyMap[key];
  if (!stuffKey) return false;

  try {
    // Use stuff command with screen's control char notation
    execSync('screen -S ' + sessionName + ' -p 0 -X stuff "' + stuffKey + '"', {
      stdio: 'ignore',
      timeout: 3000
    });
    return true;
  } catch (e) {
    return false;
  }
}

// Track last trim time - trim every 10 seconds max to prevent lag during fast output
let lastLogTrimTime = 0;
const LOG_TRIM_INTERVAL = 10000; // Trim every 10 seconds if needed
const MAX_LOG_LINES = 100; // Keep only last 100 lines, nuke the rest

// Cache for async screen reads to prevent blocking
let pendingScreenRead = null;
let lastScreenReadCache = { content: '', timestamp: 0, error: null };
const SCREEN_READ_CACHE_TTL = 300; // Cache valid for 300ms

/**
 * Read screen output WITH ANSI colors preserved
 * PRIMARY: Uses PTY memory buffer with screen hardcopy (ZERO disk I/O)
 * FALLBACK: Uses log file if hardcopy fails
 */
function screenRead(sessionName, lines = 50) {
  try {
    // First verify session exists
    if (!screenExists(sessionName)) {
      return { content: '', error: 'Screen session not found: ' + sessionName, method: 'none' };
    }

    // PRIMARY METHOD: PTY memory capture using hardcopy (ZERO disk I/O)
    // Uses screen -X hardcopy to tmpfs, reads to memory, deletes tmpfs file
    try {
      const content = captureScreenToPTY(sessionName, lines);
      // Validate content - filter out screen error messages that leaked through
      if (content && content.trim() && !content.startsWith('-X:') && !content.includes('No screen session found')) {
        // Process lines preserving ANSI codes
        const allLines = content.split('\n');

        // Remove trailing empty lines
        while (allLines.length > 0 && !allLines[allLines.length - 1].trim()) {
          allLines.pop();
        }

        // Clean control chars but KEEP ANSI escape codes (\x1b = 0x1B)
        const lastLines = allLines.map(function(line) {
          return line.replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g, '');
        });

        return { content: lastLines.join('\n'), error: null, method: 'pty-memory' };
      }
    } catch (ptyErr) {
      // PTY capture failed, try log file fallback
    }

    // FALLBACK: Read from log file (legacy support)
    const logFile = getScreenLogPath(process.cwd());

    if (fs.existsSync(logFile)) {
      try {
        // Use tail command for efficient reading
        const rawContent = execSync('tail -n ' + lines + ' "' + logFile + '" 2>/dev/null', {
          encoding: 'utf8',
          timeout: 2000,
          maxBuffer: 512 * 1024
        });

        if (rawContent && rawContent.trim()) {
          const allLines = rawContent.split('\n');

          while (allLines.length > 0 && !allLines[allLines.length - 1].trim()) {
            allLines.pop();
          }

          const lastLines = allLines.map(function(line) {
            return line.replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g, '');
          });

          return { content: lastLines.join('\n'), error: null, method: 'logfile-fallback' };
        }
      } catch (logErr) {
        // Log file read failed
      }
    }

    // Method 2: Fallback to hardcopy (plain text, no colors)
    const timestamp = Date.now();
    const tmpFile = '/tmp/specmem-screen-' + process.pid + '-' + timestamp + '.txt';

    execSync('screen -S ' + sessionName + ' -p 0 -X hardcopy -h ' + tmpFile, {
      stdio: 'ignore',
      timeout: 2000
    });

    // Wait briefly for file to be written
    let retries = 0;
    while (!fs.existsSync(tmpFile) && retries < 5) {
      execSync('sleep 0.05', { stdio: 'ignore' });
      retries++;
    }

    if (!fs.existsSync(tmpFile)) {
      return { content: '', error: 'Screen capture file not created', method: 'hardcopy-failed' };
    }

    const content = fs.readFileSync(tmpFile, 'utf8');
    try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }

    const allLines = content.split('\n');
    while (allLines.length > 0 && !allLines[allLines.length - 1].trim()) {
      allLines.pop();
    }

    const lastLines = allLines.slice(-lines).map(function(line) {
      // Clean control chars but KEEP ANSI escape codes (\x1b = 0x1B)
      return line.replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g, '');
    });

    return { content: lastLines.join('\n'), error: null, method: 'hardcopy' };
  } catch (e) {
    return { content: '', error: e.message || 'Failed to read screen output', method: 'error' };
  }
}

/**
 * Async version of screenRead - uses PTY memory capture
 * Uses cache to prevent redundant reads within 300ms
 * This function returns a Promise and should be used in async contexts
 */
async function screenReadAsync(sessionName, lines = 50) {
  try {
    // Check if session exists first
    if (!screenExists(sessionName)) {
      const result = { content: '', error: 'Screen session not found: ' + sessionName, method: 'none' };
      lastScreenReadCache = { ...result, timestamp: Date.now() };
      return result;
    }

    // Check if we have a valid cache
    const now = Date.now();
    if (lastScreenReadCache.content && (now - lastScreenReadCache.timestamp < SCREEN_READ_CACHE_TTL)) {
      return lastScreenReadCache;
    }

    // PRIMARY: Use PTY memory capture (ZERO disk I/O)
    try {
      const content = captureScreenToPTY(sessionName, lines);
      if (content && content.trim()) {
        const allLines = content.split('\n');

        // Remove trailing empty lines
        while (allLines.length > 0 && !allLines[allLines.length - 1].trim()) {
          allLines.pop();
        }

        // Clean control chars but keep ANSI
        const lastLines = allLines.slice(-lines).map(function(line) {
          return line.replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g, '');
        });

        const result = { content: lastLines.join('\n'), error: null, method: 'pty-memory' };
        lastScreenReadCache = { ...result, timestamp: now };
        return result;
      }
    } catch (ptyErr) {
      // PTY capture failed, try log file fallback
    }

    // FALLBACK: Read from log file if PTY fails
    const logFile = getScreenLogPath(process.cwd());
    try {
      const rawContent = await fsPromises.readFile(logFile, 'utf8');
      if (rawContent && rawContent.trim()) {
        const allLines = rawContent.split('\n');
        while (allLines.length > 0 && !allLines[allLines.length - 1].trim()) {
          allLines.pop();
        }
        const lastLines = allLines.slice(-lines).map(function(line) {
          return line.replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g, '');
        });
        const result = { content: lastLines.join('\n'), error: null, method: 'logfile-fallback' };
        lastScreenReadCache = { ...result, timestamp: now };
        return result;
      }
    } catch (logErr) {
      // Log file fallback also failed
    }

    // Return empty content if all methods fail
    const result = { content: '', error: 'No screen output available', method: 'none' };
    lastScreenReadCache = { ...result, timestamp: now };
    return result;

  } catch (e) {
    const result = { content: '', error: e.message || 'Failed to read screen output', method: 'error' };
    return result;
  }
}

/**
 * Non-blocking screen read that returns immediately with cached data
 * Triggers async read in background if cache is stale
 * This is the preferred function for the draw loop to prevent blocking
 */
function screenReadNonBlocking(sessionName, lines = 50) {
  const now = Date.now();

  // Return cached content immediately
  const cached = lastScreenReadCache;

  // If cache is empty or stale, and no pending read, trigger new async read
  if ((!cached.content || (now - cached.timestamp > SCREEN_READ_CACHE_TTL)) && !pendingScreenRead) {
    pendingScreenRead = screenReadAsync(sessionName, lines)
      .then(result => {
        pendingScreenRead = null;
        return result;
      })
      .catch(err => {
        pendingScreenRead = null;
        return { content: '', error: err.message };
      });
  }

  // If cache is empty and sessionName provided, try to read from log file directly (synchronous fallback)
  if (!cached.content && sessionName) {
    const logFile = getScreenLogPath(process.cwd());
    try {
      if (fs.existsSync(logFile)) {
        const rawContent = execSync('tail -n ' + lines + ' "' + logFile + '" 2>/dev/null', {
          encoding: 'utf8',
          timeout: 1000,
          maxBuffer: 512 * 1024
        });
        if (rawContent && rawContent.trim()) {
          const result = { content: rawContent, error: null, method: 'logfile-sync' };
          lastScreenReadCache = { ...result, timestamp: now };
          return result;
        }
      }
    } catch (e) {
      // Ignore sync read errors, will return empty or cached
    }
  }

  // Always return immediately with whatever we have
  return cached.content ? cached : { content: '', error: null, method: 'cached' };
}

/**
 * Kill a screen session
 */
function screenKill(sessionName) {
  try {
    // Check if session exists first
    const listOutput = execSync('screen -ls 2>/dev/null || true', { encoding: 'utf8' });
    if (!listOutput.includes(sessionName)) {
      return false; // Session doesn't exist
    }
    // Send quit command with timeout
    execSync(`screen -S ${sessionName} -X quit`, { stdio: 'ignore', timeout: 5000 });
    // Brief pause then verify it's gone
    execSync('sleep 0.1', { stdio: 'ignore' });
    const verifyOutput = execSync('screen -ls 2>/dev/null || true', { encoding: 'utf8' });
    return !verifyOutput.includes(sessionName);
  } catch (e) {
    return false;
  }
}

/**
 * Parse a command with optional target number/alias
 * Examples: "accept" -> {cmd: "accept", target: null}
 *           "accept 2" -> {cmd: "accept", target: "2"}
 *           "stop main" -> {cmd: "stop", target: "main"}
 * @param {string} input - Raw command input
 * @returns {{cmd: string, target: string|null, rest: string}}
 */
function parseCommandWithTarget(input) {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0];
  const target = parts[1] || null;
  const rest = parts.slice(2).join(' ');
  return { cmd, target, rest };
}

// ============================================================================
// CLAUDE CONTROL
// ============================================================================

class ClaudeController {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.projectId = getProjectId(projectPath);
    this.claudeSession = `claude-${this.projectId}`;
    this.permissionPatterns = [
      /Allow|Deny|Yes.*don't ask/i,
      /Do you want to/i,
      /May Claude/i,
      /Permission required/i
    ];
  }

  /**
   * Check if Claude is running
   */
  isRunning() {
    return screenExists(this.claudeSession);
  }

  /**
   * Start Claude in a screen session
   */
  start(prompt = null) {
    if (this.isRunning()) {
      console.log(`${c.yellow}${icons.warning} Claude is already running in session: ${this.claudeSession}${c.reset}`);
      return true;
    }

    console.log(`${c.cyan}Starting Claude in screen session: ${this.claudeSession}${c.reset}`);

    try {
      // PTY MEMORY APPROACH: NO -L -Logfile (zero disk I/O)
      // Uses screen hardcopy to tmpfs on-demand instead of continuous logging
      // -h 5000 sets scrollback buffer to 5000 lines for hardcopy capture
      const cmd = prompt
        ? `screen -h 5000 -dmS ${this.claudeSession} bash -c "cd '${this.projectPath}' && claude '${prompt.replace(/'/g, "\\'")}' 2>&1; exec bash"`
        : `screen -h 5000 -dmS ${this.claudeSession} bash -c "cd '${this.projectPath}' && claude 2>&1; exec bash"`;

      execSync(cmd, { stdio: 'ignore' });

      // Wait for it to start
      let tries = 0;
      while (!this.isRunning() && tries < 10) {
        execSync('sleep 0.5');
        tries++;
      }

      if (this.isRunning()) {
        console.log(`${c.green}${icons.success} Claude started${c.reset}`);
        return true;
      } else {
        console.log(`${c.red}${icons.error} Failed to start Claude${c.reset}`);
        return false;
      }
    } catch (e) {
      console.log(`${c.red}${icons.error} Error starting Claude: ${e.message}${c.reset}`);
      return false;
    }
  }

  /**
   * Save Claude's progress before stopping
   * - Asks Claude to summarize what it did
   * - WAITS for Claude to actually respond (up to 30s)
   * - Saves last 500 lines to:
   *   1. ./claudeProgressTracking/{timestamp}.txt (archive)
   *   2. ./specmem/sockets/last-session.txt (for next session injection)
   */
  saveProgress(reason = 'manual') {
    const trackingDir = path.join(this.projectPath, 'claudeProgressTracking');
    const socketDir = path.join(this.projectPath, 'specmem', 'sockets');
    const lastSessionFile = path.join(socketDir, 'last-session.txt');

    // Create directories
    fs.mkdirSync(trackingDir, { recursive: true });
    fs.mkdirSync(socketDir, { recursive: true });

    // Generate timestamp filename for archive
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const archiveFile = path.join(trackingDir, `claude-session-${timestamp}-${reason}.txt`);

    // Get initial screen content to detect when Claude responds
    const initialResult = screenRead(this.claudeSession, 500);
    const initialLength = initialResult.content?.length || 0;

    // Ask Claude to summarize - be explicit
    let gotResponse = false;
    if (this.isRunning()) {
      console.log(`${c.cyan}Asking Claude to save progress...${c.reset}`);
      screenSend(this.claudeSession, `

[SAVE PROGRESS - SESSION ENDING]

**IMPORTANT: Start your response with a message to your next instance:**
\`\`\`
[MESSAGE TO NEXT CLAUDE]
<write a direct message to yourself here - what should the next instance know immediately?>
[/MESSAGE TO NEXT CLAUDE]
\`\`\`

Then provide:
1. Brief summary of what you accomplished this session
2. Any pending tasks or TODOs (be specific!)
3. Files you were working on and their current state
4. Any gotchas or things to watch out for

This session is ending - your response will be injected into the next Claude session.
`);

      // ACTUALLY WAIT for Claude to respond - poll for new output
      console.log(`${c.dim}Waiting for Claude to respond (up to 30s)...${c.reset}`);
      const startWait = Date.now();
      const maxWait = 30000; // 30 seconds max
      const pollInterval = 1000; // Check every second

      while (Date.now() - startWait < maxWait) {
        execSync(`sleep 1`);
        const currentResult = screenRead(this.claudeSession, 500);
        const currentLength = currentResult.content?.length || 0;

        // Check if output has grown significantly (Claude is responding)
        if (currentLength > initialLength + 100) {
          console.log(`${c.green}${icons.success} Claude is responding...${c.reset}`);

          // Wait a bit more for Claude to finish
          execSync('sleep 3');

          // Check if still growing
          const newResult = screenRead(this.claudeSession, 500);
          if (newResult.content?.length === currentLength) {
            // Output stabilized - Claude finished
            gotResponse = true;
            console.log(`${c.green}${icons.success} Response captured${c.reset}`);
            break;
          }
          // Still growing, keep waiting
        }

        // Check for token limit / session end indicators
        if (currentResult.content?.includes('context limit') ||
            currentResult.content?.includes('conversation is getting long') ||
            currentResult.content?.includes('out of context')) {
          console.log(`${c.yellow}${icons.warning} Token limit detected${c.reset}`);
          gotResponse = true;
          break;
        }

        process.stdout.write(`${c.dim}.${c.reset}`);
      }
      console.log('');

      if (!gotResponse) {
        console.log(`${c.yellow}${icons.warning} Timeout waiting for Claude response${c.reset}`);
      }
    }

    // Read final 500 lines - prefer screen if alive, fallback to log file
    const screenResult = screenRead(this.claudeSession, 500);
    let output = screenResult.content;

    // If screen is dead or no output, try the log file (crash recovery)
    if (!output) {
      const logFile = getScreenLogPath(this.projectPath);
      if (fs.existsSync(logFile)) {
        console.log(`${c.yellow}Screen not responding - reading from log file${c.reset}`);
        output = readAndTruncateLog(logFile, 500);
        if (output) {
          console.log(`${c.green}${icons.success} Recovered last 500 lines from log${c.reset}`);
        }
      }
    }

    if (!output) {
      console.log(`${c.yellow}${icons.warning} No screen output to save${c.reset}`);
      return null;
    }

    // Build the save file content
    const content = `# Claude Session Progress
# ========================
# Project: ${this.projectPath}
# Session: ${this.claudeSession}
# Saved: ${new Date().toISOString()}
# Reason: ${reason}
# Got Response: ${gotResponse}
#
# Last 500 lines of screen output:
# ================================

${output}

# ================================
# End of session capture
`;

    // Write to archive
    fs.writeFileSync(archiveFile, content, 'utf8');
    console.log(`${c.green}${icons.success} Archive: ${path.basename(archiveFile)}${c.reset}`);

    // Write to last-session.txt for next session injection
    fs.writeFileSync(lastSessionFile, content, 'utf8');
    console.log(`${c.green}${icons.success} Saved for next session: last-session.txt${c.reset}`);

    return archiveFile;
  }

  /**
   * Stop Claude with progress saving
   */
  stop(saveFirst = true) {
    if (!this.isRunning()) {
      console.log(`${c.yellow}${icons.warning} Claude is not running${c.reset}`);
      return true;
    }

    // Save progress before stopping
    if (saveFirst) {
      this.saveProgress('stop');
    }

    screenKill(this.claudeSession);
    console.log(`${c.green}${icons.success} Claude stopped${c.reset}`);
    return true;
  }

  /**
   * Force stop without saving
   */
  forceStop() {
    return this.stop(false);
  }

  /**
   * Send a prompt to Claude
   */
  send(text) {
    if (!this.isRunning()) {
      console.log(`${c.red}${icons.error} Claude is not running. Use 'claude start' first.${c.reset}`);
      return false;
    }

    return screenSend(this.claudeSession, text);
  }

  /**
   * Read Claude's output
   */
  read(lines = 50) {
    if (!this.isRunning()) {
      return { content: null, error: 'Claude is not running' };
    }
    return screenRead(this.claudeSession, lines);
  }

  /**
   * Accept current permission prompt
   */
  accept() {
    if (!this.isRunning()) return false;
    return screenKey(this.claudeSession, 'enter'); // Enter on "Yes"
  }

  /**
   * Accept and don't ask again
   */
  allowAlways() {
    if (!this.isRunning()) return false;
    screenKey(this.claudeSession, 'down'); // Move to "Yes, don't ask again"
    execSync('sleep 0.2');
    return screenKey(this.claudeSession, 'enter');
  }

  /**
   * Deny current permission
   */
  deny() {
    if (!this.isRunning()) return false;
    screenKey(this.claudeSession, 'down');
    execSync('sleep 0.1');
    screenKey(this.claudeSession, 'down');
    execSync('sleep 0.1');
    return screenKey(this.claudeSession, 'enter'); // Enter on "No"
  }

  /**
   * Attach to Claude session (opens in current terminal)
   */
  attach() {
    if (!this.isRunning()) {
      console.log(`${c.red}${icons.error} Claude is not running${c.reset}`);
      return;
    }

    console.log(`${c.cyan}Attaching to Claude session. Press Ctrl+A then D to detach.${c.reset}`);
    try {
      execSync(`screen -r ${this.claudeSession}`, { stdio: 'inherit' });
    } catch (e) {
      // User detached
    }
  }

  /**
   * Check if waiting for permission
   */
  isWaitingForPermission() {
    const output = this.read(20);
    if (!output) return false;

    return this.permissionPatterns.some(pattern => pattern.test(output));
  }
}

// ============================================================================
// SPECMEM DIRECT COMMANDS (without Claude)
// ============================================================================

class SpecMemDirect {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.socketPath = path.join(projectPath, 'specmem', 'sockets', 'embeddings.sock');
    this.configPath = path.join(projectPath, 'specmem', 'model-config.json');
    this.pool = null; // FIX HIGH-29: Database pool for direct queries
    this.schema = null; // Cached schema name
  }

  /**
   * FIX HIGH-29: Set database pool for direct queries
   */
  setPool(pool) {
    this.pool = pool;
    // Compute schema once
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256')
      .update(this.projectPath.replace(/\/+$/, '').toLowerCase())
      .digest('hex')
      .slice(0, 12);
    this.schema = `specmem_${hash}`;
  }

  /**
   * Get project config
   */
  getConfig() {
    try {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch (e) {
      return null;
    }
  }

  /**
   * Show project status
   */
  status() {
    console.log(`${c.cyan}${c.bold}Project Status${c.reset}`);
    console.log(`${c.dim}─────────────────────────────────────${c.reset}`);

    console.log(`${c.dim}Path:${c.reset}      ${this.projectPath}`);

    const config = this.getConfig();
    if (config) {
      const tierColors = { small: c.green, medium: c.yellow, large: c.brightRed };
      console.log(`${c.dim}Tier:${c.reset}      ${tierColors[config.tier]}${config.tier.toUpperCase()}${c.reset}`);
      console.log(`${c.dim}Files:${c.reset}     ${config.projectStats?.files || '?'}`);
      console.log(`${c.dim}LOC:${c.reset}       ${config.projectStats?.linesOfCode || '?'}`);
      console.log(`${c.dim}Generated:${c.reset} ${config.generatedAt || '?'}`);
    } else {
      console.log(`${c.yellow}${icons.warning} No model-config.json found. Run 'init' first.${c.reset}`);
    }

    // Check embedding server
    const socketExists = fs.existsSync(this.socketPath);
    console.log(`${c.dim}Embeddings:${c.reset} ${socketExists ? `${c.green}${icons.success} Socket found${c.reset}` : `${c.yellow}${icons.warning} Socket not found${c.reset}`}`);

    // Check Claude screen
    const projectId = getProjectId(this.projectPath);
    const claudeRunning = screenExists(`claude-${projectId}`);
    console.log(`${c.dim}Claude:${c.reset}    ${claudeRunning ? `${c.green}${icons.success} Running (claude-${projectId})${c.reset}` : `${c.dim}Not running${c.reset}`}`);
  }

  /**
   * Call SpecMem MCP tool via CLI
   * This requires the specmem server to be running
   */
  async callTool(toolName, params = {}) {
    // For now, this would require the MCP server to be running
    // We could add direct database access later
    console.log(`${c.yellow}${icons.warning} Direct MCP tool calls require SpecMem server to be running${c.reset}`);
    console.log(`${c.dim}Tool: ${toolName}${c.reset}`);
    console.log(`${c.dim}Params: ${JSON.stringify(params)}${c.reset}`);
  }

  /**
   * FIX HIGH-29: Search memories using keyword search (no embeddings required)
   * This is a simplified version that searches by content ILIKE
   */
  async findMemory(query, limit = 10) {
    if (!this.pool || !this.schema) {
      throw new Error('Database pool not initialized - call setPool first');
    }

    try {
      const client = await this.pool.connect();
      try {
        // Simple keyword search using ILIKE
        const result = await client.query(`
          SELECT id, content, memory_type, importance, tags, created_at
          FROM ${this.schema}.memories
          WHERE content ILIKE $1
          ORDER BY created_at DESC
          LIMIT $2
        `, [`%${query}%`, limit]);

        return result.rows;
      } finally {
        client.release();
      }
    } catch (e) {
      // Silently fail on query errors - table might not exist
      throw e;
    }
  }

  /**
   * FIX HIGH-29: Search code using keyword search (no embeddings required)
   * This searches the code_index table if it exists
   */
  async findCode(query, limit = 10) {
    if (!this.pool || !this.schema) {
      throw new Error('Database pool not initialized - call setPool first');
    }

    try {
      const client = await this.pool.connect();
      try {
        // Simple keyword search on code_index table
        const result = await client.query(`
          SELECT id, file_path, symbol_name, definition_type, content, line_start, line_end
          FROM ${this.schema}.code_index
          WHERE symbol_name ILIKE $1 OR content ILIKE $1 OR file_path ILIKE $1
          ORDER BY file_path, line_start
          LIMIT $2
        `, [`%${query}%`, limit]);

        return result.rows;
      } finally {
        client.release();
      }
    } catch (e) {
      // Silently fail on query errors - table might not exist
      throw e;
    }
  }
}

// ============================================================================
// TEAM COMMS PANEL - Real-time team message display
// ============================================================================

/**
 * TeamCommsPanel - Terminal-based UI for displaying team messages
 * Features:
 * - Polls team_messages table every 5 seconds using existing database pool
 * - Shows messages from last 30 minutes with sender, time, priority coloring
 * - Highlights new messages with 2-second flash effect (bright cyan)
 * - Auto-scrolls to newest, allows manual scroll with up/down when focused
 * - Shows unread count badge
 * - Priority-based coloring: urgent=bright red, high=bright yellow, normal=white, low=gray
 *
 * Usage:
 *   const panel = new TeamCommsPanel(projectPath, dbPool);
 *   panel.start(); // Start polling
 *   const rendered = panel.render(width, height); // Get render output
 *   panel.scrollUp(); panel.scrollDown(); // Manual scroll control
 *   panel.stop(); // Stop polling
 */
class TeamCommsPanel {
  constructor(projectPath, pool) {
    this.projectPath = projectPath;
    this.pool = pool;
    this.messages = [];
    this.lastMessageIds = new Set();
    this.scrollOffset = 0;
    this.focused = false;
    this.pollInterval = null;
    this.flashingMessages = new Set(); // Track messages currently flashing
    this.unreadCount = 0;
    this.maxMessages = 50; // Keep last 50 messages in memory
    this.messageRetentionMinutes = 30; // Query messages from last 30 minutes (was 60 seconds - too short!)
    this.pollIntervalMs = 5000; // Poll every 5 seconds
    this.lastPollTime = null; // Track last successful poll for debugging
    this.pollError = null; // Track last poll error

    // Derive project schema name (specmem_{dirname})
    this.schemaName = this.getProjectSchema();
  }

  /**
   * Get project schema name from env or derive from path
   */
  getProjectSchema() {
    // Check for explicit schema name
    const dirName = process.env.SPECMEM_PROJECT_DIR_NAME ||
                    path.basename(this.projectPath || process.cwd())
                      .toLowerCase()
                      .replace(/[^a-z0-9]/g, '_')
                      .replace(/_+/g, '_')
                      .replace(/^_|_$/g, '')
                      .slice(0, 50) || 'default';
    return `specmem_${dirName}`;
  }

  /**
   * Start polling for team messages
   * Clears any existing interval and starts fresh polling
   */
  start() {
    // Clear any existing interval to prevent duplicate polling
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Immediate poll on start (async but we dont need to wait)
    this.poll().catch(() => {}); // Ignore errors on initial poll

    // Then poll every 5 seconds
    this.pollInterval = setInterval(() => {
      this.poll().catch(() => {}); // Ignore errors, will retry next interval
    }, this.pollIntervalMs);
  }

  /**
   * Stop polling and cleanup
   */
  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.flashingMessages.clear();
  }

  /**
   * Fetch latest messages from database
   * Queries team_messages from last 30 minutes for better retention
   */
  async poll() {
    if (!this.pool) {
      this.pollError = 'No database pool available';
      return;
    }

    try {
      const client = await this.pool.connect();
      try {
        // CRITICAL: Set search_path to project schema FIRST (use format() for safe quoting)
        const schemaResult = await client.query(
          `SELECT format('SET search_path TO %I, public', $1::text) as sql`,
          [this.schemaName]
        );
        await client.query(schemaResult.rows[0].sql);

        // Get messages from last 30 minutes, sorted by most recent first
        const result = await client.query(`
          SELECT
            id, sender_id, sender_name, content, message_type, priority,
            created_at, mentions
          FROM team_messages
          WHERE created_at > NOW() - INTERVAL '30 minutes'
          ORDER BY created_at DESC
          LIMIT $1
        `, [this.maxMessages]);

        const newMessages = result.rows.map(row => ({
          id: row.id,
          sender: row.sender_name || row.sender_id,
          content: row.content,
          type: row.message_type,
          priority: row.priority || 'normal',
          timestamp: row.created_at,
          mentions: row.mentions || [],
          isNew: !this.lastMessageIds.has(row.id),
          isFlashing: false
        }));

        // Detect newly arrived messages and trigger flash effect
        for (const msg of newMessages) {
          if (msg.isNew) {
            this.flashingMessages.add(msg.id);
            msg.isFlashing = true;

            // Remove flash effect after 2 seconds
            setTimeout(() => {
              this.flashingMessages.delete(msg.id);
            }, 2000);
          }
        }

        // Update message set and unread count
        this.messages = newMessages;
        this.lastMessageIds = new Set(newMessages.map(m => m.id));
        this.unreadCount = newMessages.filter(m => m.isNew).length;
        this.lastPollTime = new Date();
        this.pollError = null;

      } finally {
        client.release();
      }
    } catch (error) {
      this.pollError = error.message;
      // Panel will just show last cached messages
    }
  }

  /**
   * Get ANSI color for priority level
   */
  getPriorityColor(priority) {
    const p = priority?.toLowerCase();
    switch (p) {
      case 'urgent': return c.brightRed;
      case 'high': return c.brightYellow;
      case 'low': return c.gray;
      case 'normal':
      default: return c.white;
    }
  }

  /**
   * Get visual icon for priority level
   */
  getPriorityIcon(priority) {
    const p = priority?.toLowerCase();
    switch (p) {
      case 'urgent': return c.brightRed + '!' + c.reset;
      case 'high': return c.brightYellow + icons.arrow_u + c.reset;
      case 'low': return c.dim + icons.arrow_d + c.reset;
      case 'normal':
      default: return c.dim + icons.bullet + c.reset;
    }
  }

  /**
   * Format timestamp for display (HH:MM:SS)
   */
  formatTime(timestamp) {
    try {
      const date = new Date(timestamp);
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${hours}:${minutes}:${seconds}`;
    } catch (e) {
      return '--:--:--';
    }
  }

  /**
   * Scroll up in message view (show older messages)
   */
  scrollUp() {
    this.scrollOffset = Math.min(this.scrollOffset + 1, Math.max(0, this.messages.length - 3));
    this.focused = true;
  }

  /**
   * Scroll down in message view (show newer messages)
   * When at bottom, auto-scroll is enabled (focused = false)
   */
  scrollDown() {
    this.scrollOffset = Math.max(this.scrollOffset - 1, 0);
    if (this.scrollOffset === 0) {
      this.focused = false; // Auto-scroll enabled when at bottom
    }
  }

  /**
   * Render the panel to terminal output
   * Returns object with header, content, footer, and full combined output
   *
   * Layout:
   * ┌─ Header (with unread badge) ─────┐
   * │ • Sender        HH:MM:SS Message │
   * │ • Sender        HH:MM:SS Message │
   * │ (scroll hints)                   │
   * └──────────────────────────────────┘
   */
  render(width = 60, height = 10) {
    const lines = [];

    // Header with unread count badge
    const badgeText = this.unreadCount > 0 ? ` [${this.unreadCount} unread]` : '';
    const headerBg = this.unreadCount > 0 ? c.bgMagenta : c.bgBlue;
    const headerLine = `${headerBg}${c.white} ${icons.brain} TEAM COMMS${badgeText} ${c.reset}`;
    lines.push(headerLine);
    lines.push(c.dim + icons.line_h.repeat(width) + c.reset);

    // Message display area (most recent at top)
    const contentHeight = Math.max(3, height - 4);
    const displayCount = Math.min(this.messages.length, contentHeight);
    const startIdx = this.scrollOffset;
    const endIdx = Math.min(startIdx + displayCount, this.messages.length);

    if (this.messages.length === 0) {
      // Empty state with friendly message or error
      if (this.pollError) {
        lines.push(`  ${c.red}${icons.error} Poll error${c.reset}`);
        lines.push('');
        lines.push(`  ${c.dim}${this.pollError}${c.reset}`);
        for (let i = 3; i < contentHeight; i++) {
          lines.push('');
        }
      } else {
        lines.push(`  ${c.dim}${icons.circle} Team channel quiet${c.reset}`);
        lines.push('');
        lines.push(`  ${c.dim}Messages from team members${c.reset}`);
        lines.push(`  ${c.dim}will appear here${c.reset}`);
        for (let i = 4; i < contentHeight; i++) {
          lines.push('');
        }
      }
    } else {
      // Render message lines
      for (let i = startIdx; i < endIdx; i++) {
        const msg = this.messages[i];
        const priorityIcon = this.getPriorityIcon(msg.priority);
        const timeStr = c.dim + this.formatTime(msg.timestamp) + c.reset;

        // Truncate sender name to 12 chars for alignment
        const senderName = msg.sender.substring(0, 12).padEnd(12);

        // Use flash color for new messages, otherwise priority color
        let contentColor = this.getPriorityColor(msg.priority);
        if (msg.isFlashing) {
          contentColor = c.brightCyan + c.bold; // Flash effect: bright cyan
        }

        // Truncate message content to fit width
        const contentMaxLen = Math.max(1, width - 30);
        const truncatedContent = msg.content.substring(0, contentMaxLen);
        const contentDisplay = truncatedContent.length < msg.content.length
          ? truncatedContent + '...'
          : truncatedContent;

        const msgLine = `  ${priorityIcon} ${c.cyan}${senderName}${c.reset} ${timeStr} ${contentColor}${contentDisplay}${c.reset}`;
        lines.push(msgLine);
      }

      // Pad remaining content lines
      const displayedLines = Math.min(displayCount, this.messages.length);
      for (let i = displayedLines; i < contentHeight; i++) {
        lines.push('');
      }
    }

    // Footer with scroll instructions
    let scrollHint = c.dim + '(auto-scroll enabled)' + c.reset;
    if (this.scrollOffset > 0) {
      scrollHint = c.dim + '(scrolled, press down to return to auto-scroll)' + c.reset;
    } else if (this.messages.length > displayCount) {
      scrollHint = c.dim + '(press up to scroll, down to auto-scroll)' + c.reset;
    }

    lines.push(c.dim + icons.line_h.repeat(width) + c.reset);
    lines.push(scrollHint);

    return {
      header: lines[0],
      separator1: lines[1],
      content: lines.slice(2, -2).join('\n'),
      separator2: lines[lines.length - 2],
      footer: lines[lines.length - 1],
      full: lines.join('\n')
    };
  }
}

// ============================================================================
// MCP TOOL PANEL - Monitors MCP tool calls
// ============================================================================

class MCPToolPanel {
  constructor(projectPath, projectId) {
    this.projectPath = projectPath;
    this.projectId = projectId;
    this.calls = [];
    this.pool = null;
  }

  setPool(pool) {
    this.pool = pool;
  }

  /**
   * Fetch recent MCP tool calls from team_member_messages
   */
  async fetchMCPCalls(limit = 10) {
    if (!this.pool) return [];

    try {
      const client = await this.pool.connect();
      try {
        // Query tool calls from team member messages (last 5 mins)
        const result = await client.query(`
          SELECT
            id, role, content, tool_calls, created_at
          FROM team_member_messages
          WHERE tool_calls IS NOT NULL
            AND created_at > NOW() - INTERVAL '5 minutes'
          ORDER BY created_at DESC
          LIMIT $1
        `, [limit]);

        this.calls = result.rows.map(row => {
          const toolCalls = Array.isArray(row.tool_calls) ? row.tool_calls : [];
          return {
            id: row.id,
            timestamp: row.created_at,
            tools: toolCalls.map(tc => ({
              name: tc.name || tc.function?.name || 'unknown',
              args: tc.arguments || tc.function?.arguments || {}
            }))
          };
        }).filter(r => r.tools.length > 0);

        return this.calls;
      } finally {
        client.release();
      }
    } catch (e) {
      // Silent fail - DB might not have this table yet
      return [];
    }
  }

  /**
   * Format a single MCP call for display
   */
  formatCall(call, width) {
    if (!call || !call.tools || call.tools.length === 0) {
      return c.dim + '(no tools)' + c.reset;
    }

    const time = new Date(call.timestamp).toLocaleTimeString().slice(0, 5);
    const toolNames = call.tools.map(t => t.name).join(', ');
    const maxToolLen = Math.max(10, width - 10);
    const truncated = toolNames.length > maxToolLen
      ? toolNames.slice(0, maxToolLen - 3) + '...'
      : toolNames;

    return `${c.dim}${time}${c.reset} ${c.brightCyan}${truncated}${c.reset}`;
  }
}

// ============================================================================
// INIT STATS DISPLAY
// ============================================================================

/**
 * Display init stats from specmem/sockets/init-stats.json
 * Shows timing breakdown ABOVE the banner
 */
function displayInitStats(projectPath) {
  try {
    const statsPath = path.join(projectPath, 'specmem', 'sockets', 'init-stats.json');
    if (!fs.existsSync(statsPath)) return;

    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));

    // Build compact display string
    const parts = [];

    if (stats.totalMs !== undefined) {
      parts.push(`Init: ${(stats.totalMs / 1000).toFixed(1)}s`);
    }
    if (stats.dbMs !== undefined) {
      parts.push(`DB: ${(stats.dbMs / 1000).toFixed(1)}s`);
    }
    if (stats.embeddingsMs !== undefined) {
      parts.push(`Embeddings: ${(stats.embeddingsMs / 1000).toFixed(1)}s`);
    }
    if (stats.watcherMs !== undefined) {
      parts.push(`Watcher: ${(stats.watcherMs / 1000).toFixed(1)}s`);
    }

    if (parts.length > 0) {
      console.log(`${c.dim}  ${parts.join(' | ')}${c.reset}`);
      console.log('');
    }
  } catch (e) {
    // Silently skip if stats file doesn't exist or is invalid
  }
}

// ============================================================================
// QUADRANT RENDERER
// ============================================================================

/**
 * QuadrantRenderer - Handles 4-quadrant dashboard layout
 *
 * Layout:
 * ┌─────────────────┬─────────────────┐
 * │  Claude Preview │   MCP Tools     │
 * ├─────────────────┼─────────────────┤
 * │ Command Console │   Pythia COT    │
 * └─────────────────┴─────────────────┘
 */
class QuadrantRenderer {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;

    // Each quadrant gets half width, half height
    // Account for 3 border lines: top, middle separator, bottom
    this.quadrantWidth = Math.floor(cols / 2);
    this.quadrantHeight = Math.floor((rows - 3) / 2);

    // Content for each quadrant (array of strings)
    this.topLeft = [];
    this.bottomLeft = [];
    this.topRight = [];
    this.bottomRight = [];

    // Quadrant titles with icons for visual polish
    this.topLeftTitle = `${icons.robot} Claude Preview`;
    this.bottomLeftTitle = `${icons.arrow} Command Console`;
    this.topRightTitle = `${icons.brain} Pythia COT`;
    this.bottomRightTitle = `${icons.bullet} MCP Tool Calls`;

    // Active quadrant for highlighting (null, 'topLeft', 'bottomLeft')
    this.activeQuadrant = null;
  }

  /**
   * Set content for top-left quadrant (Claude preview)
   */
  setTopLeft(lines) {
    this.topLeft = Array.isArray(lines) ? lines : [];
  }

  /**
   * Set content for bottom-left quadrant (Command console)
   */
  setBottomLeft(lines) {
    this.bottomLeft = Array.isArray(lines) ? lines : [];
  }

  /**
   * Set content for top-right quadrant (MCP tool calls)
   */
  setTopRight(lines) {
    this.topRight = Array.isArray(lines) ? lines : [];
  }

  /**
   * Set content for bottom-right quadrant (Pythia COT)
   */
  setBottomRight(lines) {
    this.bottomRight = Array.isArray(lines) ? lines : [];
  }

  /**
   * Truncate or pad a line to fit within width (ANSI-aware)
   */
  fitLine(line, width) {
    if (!line) line = '';
    const strippedLen = visibleLength(String(line));
    if (strippedLen > width) {
      // Truncate ANSI-aware: count visible chars, keep ANSI codes
      let visibleCount = 0;
      let result = '';
      let i = 0;
      while (i < line.length && visibleCount < width) {
        if (line[i] === '\x1b' && line[i + 1] === '[') {
          // CSI ANSI escape sequence - copy until command char [a-zA-Z]
          let j = i + 2;
          while (j < line.length && /[0-9;]/.test(line[j])) j++;
          if (j < line.length && /[a-zA-Z]/.test(line[j])) {
            j++; // Include command character
            result += line.substring(i, j);
            i = j;
            continue;
          }
        } else if (line[i] === '\x1b' && line[i + 1] === ']') {
          // OSC sequence - copy until BEL (\x07) or ESC\
          let j = i + 2;
          while (j < line.length && line[j] !== '\x07' && !(line[j] === '\x1b' && line[j + 1] === '\\')) {
            j++;
          }
          if (j < line.length) {
            j += (line[j] === '\x07') ? 1 : 2; // Include terminator
            result += line.substring(i, j);
            i = j;
            continue;
          }
        }
        const charWidth = getCharWidth(line[i]);
        // Don't add if it would exceed width
        if (visibleCount + charWidth > width) break;
        result += line[i];
        visibleCount += charWidth;
        i++;
      }
      return result + c.reset;
    } else if (strippedLen < width) {
      // Pad with spaces
      return line + ' '.repeat(width - strippedLen);
    }
    return line;
  }

  /**
   * Render a quadrant with header and content
   * NOTE: Final width fitting done by render() with fitLine(halfWidth - 2)
   * We just format content here - render() handles truncation and padding
   */
  renderQuadrant(title, lines, width, height) {
    const result = [];
    const contentHeight = height - 1; // Account for header

    // Header line with styled background - ANSI-aware title length calculation
    // fitLine in render() will truncate/pad, so just build styled header
    const header = `${c.bgBlue}${c.white}${c.bold} ${title} ${c.reset}`;
    result.push(header);

    // Content lines - just add leading space, render() handles width via fitLine
    for (let i = 0; i < contentHeight; i++) {
      if (i < lines.length) {
        result.push(` ${lines[i] || ''}`);
      } else {
        // Empty line placeholder - render() will pad
        result.push(' ');
      }
    }

    return result;
  }

  /**
   * Render full frame with borders and all quadrants
   * Active quadrant gets orange/yellow borders for visual feedback
   */
  render() {
    const output = [];
    const halfWidth = this.quadrantWidth;
    const halfHeight = this.quadrantHeight;

    // Border colors based on active quadrant
    const isTopLeftActive = this.activeQuadrant === 'topLeft';
    const isBottomLeftActive = this.activeQuadrant === 'bottomLeft';
    const orange = c.brightYellow || '\x1b[93m'; // Bright yellow as orange substitute
    const reset = c.reset;
    const dim = c.dim;

    // Render each quadrant's content
    const tlContent = this.renderQuadrant(this.topLeftTitle, this.topLeft, halfWidth, halfHeight);
    const trContent = this.renderQuadrant(this.topRightTitle, this.topRight, halfWidth, halfHeight);
    const blContent = this.renderQuadrant(this.bottomLeftTitle, this.bottomLeft, halfWidth, halfHeight);
    const brContent = this.renderQuadrant(this.bottomRightTitle, this.bottomRight, halfWidth, halfHeight);

    // Top border - highlight if top-left is active
    const topLeftBorder = isTopLeftActive ? orange : dim;
    output.push(`${topLeftBorder}╭${'─'.repeat(halfWidth - 2)}${reset}${dim}┬${'─'.repeat(halfWidth - 2)}╮${reset}`);

    // Top half (top-left + top-right)
    for (let i = 0; i < tlContent.length; i++) {
      const leftSide = this.fitLine(tlContent[i], halfWidth - 2);
      const rightSide = this.fitLine(trContent[i] || '', halfWidth - 2);
      const leftBorder = isTopLeftActive ? orange : dim;
      output.push(`${leftBorder}│${reset}${leftSide}${dim}│${reset}${rightSide}${dim}│${reset}`);
    }

    // Middle border - highlight left side if bottom-left active, right side of top if top-left active
    const midLeftBorder = isBottomLeftActive ? orange : (isTopLeftActive ? orange : dim);
    output.push(`${midLeftBorder}├${'─'.repeat(halfWidth - 2)}${reset}${dim}┼${'─'.repeat(halfWidth - 2)}┤${reset}`);

    // Bottom half (bottom-left + bottom-right)
    for (let i = 0; i < blContent.length; i++) {
      const leftSide = this.fitLine(blContent[i], halfWidth - 2);
      const rightSide = this.fitLine(brContent[i] || '', halfWidth - 2);
      const leftBorder = isBottomLeftActive ? orange : dim;
      output.push(`${leftBorder}│${reset}${leftSide}${dim}│${reset}${rightSide}${dim}│${reset}`);
    }

    // Bottom border - highlight if bottom-left is active
    const bottomLeftBorder = isBottomLeftActive ? orange : dim;
    output.push(`${bottomLeftBorder}╰${'─'.repeat(halfWidth - 2)}${reset}${dim}┴${'─'.repeat(halfWidth - 2)}╯${reset}`);

    return output.join('\n');
  }
}

// ============================================================================
// INTERACTIVE CONSOLE
// ============================================================================

class SpecMemConsole {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.projectId = getProjectId(projectPath);
    this.claude = new ClaudeController(projectPath);
    this.specmem = new SpecMemDirect(projectPath);
    this.rl = null;
    this.running = true;
    this.teamCommsPanel = null;
    this.pool = null;
    this.dashboardMode = false;

    // Multi-Claude session support
    this.claudeSessions = [];         // Array of { controller: ClaudeController, sessionNum: number }
    this.activeSessionIndex = -1;     // Index into claudeSessions (-1 = none active)
    this.nextSessionNum = 1;          // Counter for unique session numbering
    this.sessionAliases = new Map();  // Map<alias, sessionNum> for named sessions

    // Agent tracking for stop notifications
    this.trackedAgents = new Map();   // Map<agentId, {startTime, status, lastCheck, description}>
    this.agentCheckInterval = null;   // Interval for periodic agent status checks

    // Flag to suppress "Goodbye" exit when intentionally closing readline to recreate
    this.suppressRlClose = false;
  }
  /**
   * Register an agent for tracking
   * @param {string} agentId - The agent/team member ID
   * @param {string} description - Optional description of the agent's task
   */
  trackAgent(agentId, description = '') {
    this.trackedAgents.set(agentId, {
      id: agentId,
      description,
      startTime: Date.now(),
      status: 'running',
      lastCheck: Date.now()
    });
    console.log(`${c.cyan}[AGENT]${c.reset} Tracking agent: ${agentId}`);
  }

  /**
   * Check status of tracked agents by looking for their screen sessions
   * Notifies user when agents complete or stop
   */
  async checkAgentStatus() {
    // First, sync from database if available
    if (this.pool) {
      await this.syncAgentsFromDatabase();
    }

    for (const [agentId, info] of this.trackedAgents.entries()) {
      if (info.status !== 'running') continue;

      try {
        // Check if screen session still exists
        const output = execSync(`screen -ls 2>/dev/null | grep "${agentId}" || true`, { encoding: 'utf8' });

        if (!output.includes(agentId)) {
          // Agent no longer in screen list - likely completed
          info.status = 'completed';
          info.endTime = Date.now();
          info.completedAt = Date.now(); // Track completion time for auto-removal

          // Calculate duration
          const duration = Math.round((info.endTime - info.startTime) / 1000);
          const mins = Math.floor(duration / 60);
          const secs = duration % 60;
          const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

          // Check if agent exited successfully or with error
          const exitStatus = this.checkAgentExitStatus(agentId);
          const isSuccess = exitStatus.success;
          const statusColor = isSuccess ? c.green : c.red;
          const statusIcon = isSuccess ? icons.success : icons.error;
          const statusText = isSuccess ? 'COMPLETED' : 'FAILED';

          // Play terminal bell for notification
          process.stdout.write('\x07');

          // Visual notification with flashing border effect
          this.flashAgentCompletion(agentId, isSuccess);

          // Notify user with status
          console.log(`\n${statusColor}${statusIcon} [AGENT ${statusText}]${c.reset} ${agentId}`);
          console.log(`  ${c.dim}Duration: ${durationStr}${c.reset}`);
          if (info.description) {
            console.log(`  ${c.dim}Task: ${info.description}${c.reset}`);
          }
          if (!isSuccess && exitStatus.message) {
            console.log(`  ${c.red}${icons.error} ${exitStatus.message}${c.reset}`);
          }
          console.log('');

          // Schedule auto-removal after 30 seconds
          setTimeout(() => {
            this.trackedAgents.delete(agentId);
          }, 30000);
        }

        info.lastCheck = Date.now();
      } catch (e) {
        // Ignore errors - agent may have exited
      }
    }

    // Clean up old completed agents (backup cleanup in case setTimeout fails)
    this.cleanupOldCompletedAgents();
  }

  /**
   * Check agent exit status by inspecting screen logs or process exit codes
   * @param {string} agentId - The agent ID to check
   * @returns {Object} - { success: boolean, message: string }
   */
  checkAgentExitStatus(agentId) {
    try {
      // Try to read the agent's log file for error patterns
      const logPath = path.join(os.homedir(), '.claude', 'agents', agentId + '.log');
      if (fs.existsSync(logPath)) {
        const logContent = fs.readFileSync(logPath, 'utf8');
        const lastLines = logContent.split('\n').slice(-20).join('\n');

        // Check for common error patterns
        if (lastLines.match(/error|exception|failed|crashed/i)) {
          const errorMatch = lastLines.match(/(error|exception|failed)[^\n]*/i);
          return {
            success: false,
            message: errorMatch ? errorMatch[0].substring(0, 80) : 'Agent encountered an error'
          };
        }
      }

      // Default to success if no errors found
      return { success: true, message: '' };
    } catch (e) {
      // If we can't determine, assume success
      return { success: true, message: '' };
    }
  }

  /**
   * Flash visual notification when agent completes
   * Creates a brief visual effect in dashboard mode
   * @param {string} agentId - The agent ID
   * @param {boolean} isSuccess - Whether agent completed successfully
   */
  flashAgentCompletion(agentId, isSuccess) {
    if (!this.dashboardMode) return;

    // Set flash state (will be picked up by dashboard render)
    if (!this.agentFlashStates) {
      this.agentFlashStates = new Map();
    }

    this.agentFlashStates.set(agentId, {
      isSuccess,
      flashCount: 0,
      maxFlashes: 6 // Flash 3 times (on/off = 2 per flash)
    });

    // Flash effect using interval
    const flashInterval = setInterval(() => {
      const state = this.agentFlashStates.get(agentId);
      if (!state || state.flashCount >= state.maxFlashes) {
        clearInterval(flashInterval);
        if (this.agentFlashStates) {
          this.agentFlashStates.delete(agentId);
        }
        return;
      }

      state.flashCount++;

      // Visual flash in terminal (if not in dashboard, just console message)
      if (state.flashCount % 2 === 1) {
        // Flash on - show colored border indicator
        const color = isSuccess ? c.green : c.red;
        const icon = isSuccess ? icons.success : icons.error;
        process.stdout.write(color + icon + c.reset);
      }
    }, 200); // Flash every 200ms
  }

  /**
   * Clean up old completed agents (older than 30 seconds)
   * Backup cleanup in case setTimeout doesn't fire
   */
  cleanupOldCompletedAgents() {
    const now = Date.now();
    const agentsToRemove = [];

    for (const [agentId, info] of this.trackedAgents.entries()) {
      if (info.status === 'completed' && info.completedAt) {
        const age = now - info.completedAt;
        if (age > 30000) { // 30 seconds
          agentsToRemove.push(agentId);
        }
      }
    }

    for (const agentId of agentsToRemove) {
      this.trackedAgents.delete(agentId);
    }
  }

  /**
   * Sync agents from team_member_deployments database table
   */
  async syncAgentsFromDatabase() {
    if (!this.pool) return;

    try {
      const client = await this.pool.connect();
      try {
        const result = await client.query(`
          SELECT id, name, type, status, created_at, started_at, last_heartbeat
          FROM team_member_deployments
          WHERE status IN ('running', 'pending')
          ORDER BY created_at DESC
          LIMIT 50
        `);

        for (const row of result.rows) {
          const agentId = row.id;

          // Only add if not already tracked
          if (!this.trackedAgents.has(agentId)) {
            this.trackedAgents.set(agentId, {
              id: agentId,
              description: row.name + ' (' + row.type + ')',
              startTime: row.started_at ? new Date(row.started_at).getTime() : new Date(row.created_at).getTime(),
              status: 'running',
              lastCheck: Date.now()
            });
          }
        }
      } finally {
        client.release();
      }
    } catch (e) {
      // Silently fail - database may not be ready
    }
  }

  /**
   * Start agent monitoring - checks agent status every 10 seconds
   */
  startAgentMonitoring() {
    if (this.agentCheckInterval) return;

    // Initial sync from database
    this.checkAgentStatus();

    this.agentCheckInterval = setInterval(() => {
      this.checkAgentStatus();
    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop agent monitoring
   */
  stopAgentMonitoring() {
    if (this.agentCheckInterval) {
      clearInterval(this.agentCheckInterval);
      this.agentCheckInterval = null;
    }
  }

  /**
   * List all tracked agents with their status
   */
  listTrackedAgents() {
    console.log(`\n${c.cyan}Tracked Agents:${c.reset}`);
    if (this.trackedAgents.size === 0) {
      console.log(`  ${c.dim}No agents tracked${c.reset}`);
      return;
    }

    for (const [id, info] of this.trackedAgents.entries()) {
      const status = info.status === 'running'
        ? `${c.green}running${c.reset}`
        : `${c.dim}${info.status}${c.reset}`;
      const elapsed = Math.round((Date.now() - info.startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      const shortId = id.length > 16 ? id.substring(0, 16) + '...' : id;
      console.log(`  ${shortId} - ${status} (${elapsedStr})`);
      if (info.description) {
        console.log(`    ${c.dim}${info.description}${c.reset}`);
      }
    }
    console.log('');
  }

  /**
   * Get count of running agents for dashboard display
   * @returns {number} Number of agents with 'running' status
   */
  getRunningAgentCount() {
    let count = 0;
    for (const info of this.trackedAgents.values()) {
      if (info.status === 'running') count++;
    }
    return count;
  }

  /**
   * Get detailed agent status indicator for dashboard header
   * Shows running count and recent completions with colored indicators
   * @returns {string} Formatted agent status (e.g., "2 running | 1 done")
   */
  getAgentStatusIndicator() {
    let running = 0;
    let completed = 0;
    let failed = 0;

    for (const info of this.trackedAgents.values()) {
      if (info.status === 'running') {
        running++;
      } else if (info.status === 'completed') {
        // Check if it was success or failure based on flashStates or stored info
        const isSuccess = !info.failed;
        if (isSuccess) {
          completed++;
        } else {
          failed++;
        }
      }
    }

    const parts = [];
    if (running > 0) {
      parts.push(`${c.yellow}${running} running${c.reset}`);
    }
    if (completed > 0) {
      parts.push(`${c.green}${completed} ${icons.success}${c.reset}`);
    }
    if (failed > 0) {
      parts.push(`${c.red}${failed} ${icons.error}${c.reset}`);
    }

    return parts.length > 0 ? parts.join(' | ') : '';
  }



  /**
   * Set an alias for a Claude session
   * @param {number} sessionNum - Session number
   * @param {string} alias - Alias name (e.g., "main", "test", "feature-x")
   */
  setSessionAlias(sessionNum, alias) {
    // Remove any existing mapping for this alias
    for (const [existingAlias, num] of this.sessionAliases.entries()) {
      if (num === sessionNum) {
        this.sessionAliases.delete(existingAlias);
      }
    }
    this.sessionAliases.set(alias.toLowerCase(), sessionNum);
  }

  /**
   * Get session by number or alias
   * @param {string|number} identifier - Session number or alias
   * @returns {Object|null} Session object or null
   */
  getSessionByIdentifier(identifier) {
    // If it's a number, find by sessionNum
    const num = parseInt(identifier);
    if (!isNaN(num)) {
      return this.claudeSessions.find(s => s.sessionNum === num) || null;
    }

    // If it's an alias, look up the session number
    const alias = String(identifier).toLowerCase();
    const sessionNum = this.sessionAliases.get(alias);
    if (sessionNum !== undefined) {
      return this.claudeSessions.find(s => s.sessionNum === sessionNum) || null;
    }

    return null;
  }

  /**
   * Get alias for a session number
   * @param {number} sessionNum - Session number
   * @returns {string|null} Alias or null if none set
   */
  getAliasForSession(sessionNum) {
    for (const [alias, num] of this.sessionAliases.entries()) {
      if (num === sessionNum) return alias;
    }
    return null;
  }

  /**
   * Create a new Claude session with a unique numbered name
   * Session names: claude-{projectId}-1, claude-{projectId}-2, etc.
   * @param {string|null} prompt - Optional initial prompt
   * @param {string|null} alias - Optional alias for the session
   */
  createClaudeSession(prompt = null, alias = null) {
    const sessionNum = this.nextSessionNum++;
    const controller = new ClaudeController(this.projectPath);
    // Override the session name to include the number
    controller.claudeSession = `claude-${this.projectId}-${sessionNum}`;

    const session = { controller, sessionNum, alias: alias || null };
    this.claudeSessions.push(session);

    // Store alias if provided
    if (alias) {
      this.setSessionAlias(sessionNum, alias);
    }

    // Start the session
    if (controller.start(prompt)) {
      // Set as active if it's the first one or we have none active
      if (this.activeSessionIndex === -1) {
        this.activeSessionIndex = this.claudeSessions.length - 1;
      }
      return session;
    }

    // Failed to start - remove from array
    this.claudeSessions.pop();
    this.nextSessionNum--;
    // Clean up alias if we added one
    if (alias) {
      this.sessionAliases.delete(alias.toLowerCase());
    }
    return null;
  }

  /**
   * Get the currently active Claude session
   */
  getActiveSession() {
    if (this.activeSessionIndex >= 0 && this.activeSessionIndex < this.claudeSessions.length) {
      return this.claudeSessions[this.activeSessionIndex];
    }
    return null;
  }

  /**
   * Switch to the previous Claude session (Ctrl+Shift+Left)
   */
  switchToPreviousSession() {
    if (this.claudeSessions.length === 0) return false;
    // BUG FIX: handle edge case where activeSessionIndex is -1 (no active session selected)
    if (this.activeSessionIndex === -1) {
      this.activeSessionIndex = this.claudeSessions.length - 1;
      return true;
    }
    if (this.activeSessionIndex > 0) {
      this.activeSessionIndex--;
      return true;
    } else if (this.claudeSessions.length > 1) {
      // Wrap around to the last session
      this.activeSessionIndex = this.claudeSessions.length - 1;
      return true;
    }
    return false;
  }

  /**
   * Switch to the next Claude session (Ctrl+Shift+Right)
   */
  switchToNextSession() {
    if (this.claudeSessions.length === 0) return false;
    // BUG FIX: handle edge case where activeSessionIndex is -1 (no active session selected)
    if (this.activeSessionIndex === -1) {
      this.activeSessionIndex = 0;
      return true;
    }
    if (this.activeSessionIndex < this.claudeSessions.length - 1) {
      this.activeSessionIndex++;
      return true;
    } else if (this.claudeSessions.length > 1) {
      // Wrap around to the first session
      this.activeSessionIndex = 0;
      return true;
    }
    return false;
  }

  /**
   * Remove a session from tracking and adjust activeSessionIndex
   * BUG FIX: Centralized session removal with proper index adjustment
   * @param {Object} session - The session to remove
   * @returns {boolean} - Whether removal was successful
   */
  removeSessionFromTracking(session) {
    if (!session) return false;
    const idx = this.claudeSessions.indexOf(session);
    if (idx < 0) return false;

    // Remove from array
    this.claudeSessions.splice(idx, 1);

    // Adjust activeSessionIndex:
    // - If removed session was before active, shift index down
    // - If removed session was the active one, clamp to valid range
    // - If array is now empty, set to -1
    if (this.claudeSessions.length === 0) {
      this.activeSessionIndex = -1;
    } else if (idx < this.activeSessionIndex) {
      this.activeSessionIndex--;
    } else if (idx === this.activeSessionIndex) {
      // Active session was removed - pick closest valid index
      this.activeSessionIndex = Math.min(idx, this.claudeSessions.length - 1);
    }

    // Clean up alias if session had one
    const alias = this.getAliasForSession(session.sessionNum);
    if (alias) {
      this.sessionAliases.delete(alias);
    }

    return true;
  }

  /**
   * Get session indicator string for dashboard header
   * Returns e.g., "Claude 1/3", "Claude 2 "main" [3 total]", or "No Sessions"
   */
  getSessionIndicator() {
    if (this.claudeSessions.length === 0) {
      return 'No Sessions';
    }
    const active = this.getActiveSession();
    if (!active) return 'No Active';
    const alias = this.getAliasForSession(active.sessionNum);
    if (alias) {
      return `Claude ${active.sessionNum} "${alias}" [${this.claudeSessions.length} total]`;
    }
    return `Claude ${active.sessionNum}/${this.claudeSessions.length}`;
  }

  /**
   * Sync existing Claude sessions on dashboard start
   * Finds any running claude-{projectId}-* sessions and adds them
   */
  syncExistingSessions() {
    try {
      const output = execSync('screen -ls 2>/dev/null || true', { encoding: 'utf8' });
      const pattern = new RegExp(`claude-${this.projectId}-(\\d+)`, 'g');
      let match;
      const existingNums = new Set();

      while ((match = pattern.exec(output)) !== null) {
        const sessionNum = parseInt(match[1]);
        existingNums.add(sessionNum);

        // Check if we already have this session tracked
        const exists = this.claudeSessions.some(s => s.sessionNum === sessionNum);
        if (!exists) {
          const controller = new ClaudeController(this.projectPath);
          controller.claudeSession = `claude-${this.projectId}-${sessionNum}`;
          this.claudeSessions.push({ controller, sessionNum });
        }
      }

      // Update nextSessionNum to be higher than any existing
      if (existingNums.size > 0) {
        this.nextSessionNum = Math.max(...existingNums) + 1;
      }

      // Set active session if we found some but have none active
      if (this.claudeSessions.length > 0 && this.activeSessionIndex === -1) {
        this.activeSessionIndex = 0;
      }

      // Also check for the legacy single-session format (claude-{projectId} without number)
      if (output.includes(`claude-${this.projectId}\t`) || output.includes(`claude-${this.projectId}(`)) {
        // Legacy session exists - add it as session 0 if not already tracked
        const legacyExists = this.claudeSessions.some(s => s.controller.claudeSession === `claude-${this.projectId}`);
        if (!legacyExists && this.claude.isRunning()) {
          // Use the existing this.claude controller for the legacy session
          this.claudeSessions.unshift({ controller: this.claude, sessionNum: 0 });
          if (this.activeSessionIndex === -1) {
            this.activeSessionIndex = 0;
          } else {
            this.activeSessionIndex++; // Shift index since we prepended
          }
        }
      }
    } catch (e) {
      // Silent fail
    }
  }

  /**
   * Initialize database pool for team comms panel
   */
  async initializeDashboard() {
    try {
      const { getDatabase } = require('../dist/database.js');
      if (typeof getDatabase === 'function') {
        const db = getDatabase();
        this.pool = db.getPool ? db.getPool() : null;
        if (this.pool) {
          this.teamCommsPanel = new TeamCommsPanel(this.projectPath, this.pool);
          this.dashboardMode = true;
          console.log(`${c.green}${icons.success} Team comms panel initialized${c.reset}`);
          return true;
        } else {
          console.log(`${c.yellow}${icons.warning} Database pool not available${c.reset}`);
        }
      } else {
        console.log(`${c.yellow}${icons.warning} getDatabase is not a function${c.reset}`);
      }
    } catch (e) {
      console.log(`${c.red}${icons.error} Failed to initialize dashboard: ${e.message}${c.reset}`);
    }
    return false;
  }

  /**
   * Start dashboard mode with split-view
   */
  async startDashboardMode() {
    // Sync existing sessions before checking if any are running
    this.syncExistingSessions();

    // Check if any Claude sessions are running (new multi-session or legacy single)
    const hasRunningSession = this.claudeSessions.length > 0 ||
                              this.claude.isRunning();

    if (!hasRunningSession) {
      console.log(`${c.yellow}${icons.warning} No Claude sessions running. Use 'claude start' or press 'n' in dashboard to start one.${c.reset}`);
      // Still allow entering dashboard mode - user can start sessions with 'n' key
    }

    console.log(`${c.cyan}Starting dashboard mode...${c.reset}`);
    if (!this.teamCommsPanel) {
      await this.initializeDashboard();
    }
    if (this.teamCommsPanel) {
      this.teamCommsPanel.start();
    }
    this.startAgentMonitoring();
    this.enterDashboardMode();
  }

  /**
   * Print the welcome banner (animated!)
   */
  async printBanner() {
    // Display init stats ABOVE the banner (if available)
    displayInitStats(this.projectPath);
    await showAnimatedBanner();
    console.log(`${c.dim}  Project: ${this.projectPath}${c.reset}`);
    console.log(`${c.dim}  Session: specmem-${this.projectId}${c.reset}`);
    // Show terminal mode if in safe/fallback mode
    if (!termCaps.hasEmoji || !termCaps.hasColors) {
      console.log(`${c.dim}  Mode: ${termCaps.hasColors ? 'color' : 'plain'}, ${termCaps.hasEmoji ? 'emoji' : 'ascii'}${c.reset}`);
    }
    console.log('');
    console.log(`${c.dim}  Type 'help' for commands, 'exit' to quit${c.reset}`);
    console.log('');
    // Persistent notice that this window is optional
    console.log(`${c.dim}  ─────────────────────────────────────────────────────${c.reset}`);
    console.log(`${c.yellow}  ${icons.info} This window is optional!${c.reset} ${c.dim}Close it anytime - SpecMem keeps running.${c.reset}`);
    console.log(`${c.dim}     This brain console is just for you to experiment with.${c.reset}`);
    console.log(`${c.dim}  ─────────────────────────────────────────────────────${c.reset}`);
    console.log('');
  }

  /**
   * Print help
   */
  printHelp() {
    console.log('');
    console.log(`${c.cyan}${c.bold}Available Commands${c.reset}`);
    console.log(`${c.dim}─────────────────────────────────────────────────────${c.reset}`);
    console.log('');
    console.log(`${c.bold}Project:${c.reset}`);
    console.log(`  ${c.cyan}status${c.reset}              Show project status`);
    console.log(`  ${c.cyan}init${c.reset}                Run specmem-init`);
    console.log(`  ${c.cyan}screens${c.reset}             List active screen sessions`);
    console.log('');
    console.log(`${c.bold}Claude Control:${c.reset}`);
    console.log(`  ${c.cyan}claude start${c.reset}        Start Claude in screen session`);
    console.log(`  ${c.cyan}claude stop${c.reset}         Stop Claude`);
    console.log(`  ${c.cyan}claude restart${c.reset}      Restart Claude`);
    console.log(`  ${c.cyan}claude status${c.reset}       Check if Claude is running`);
    console.log(`  ${c.cyan}claude attach${c.reset}       Attach to Claude session (Ctrl+A D to detach)`);
    console.log(`  ${c.cyan}claude send <text>${c.reset}  Send text to Claude`);
    console.log(`  ${c.cyan}claude read${c.reset}         Read Claude's current output`);
    console.log('');
    console.log(`${c.bold}Session Management:${c.reset}`);
    console.log(`  ${c.cyan}sessions${c.reset}, ${c.cyan}list${c.reset}     List all Claude sessions with numbers/aliases`);
    console.log(`  ${c.cyan}switch <n|alias>${c.reset}    Switch active session`);
    console.log(`  ${c.cyan}alias <n> <name>${c.reset}    Set alias for session (e.g., alias 1 main)`);
    console.log(`  ${c.cyan}stop [n|alias]${c.reset}      Stop a Claude session (default: active)`);
    console.log(`  ${c.cyan}restart [n|alias]${c.reset}   Restart a Claude session (default: active)`);
    console.log('');
    console.log(`${c.bold}Permission Handling:${c.reset}  ${c.dim}(add number/alias to target specific session)${c.reset}`);
    console.log(`  ${c.cyan}accept [n|alias]${c.reset}    Accept permission (Yes)`);
    console.log(`  ${c.cyan}allow [n|alias]${c.reset}     Accept + don't ask again`);
    console.log(`  ${c.cyan}deny [n|alias]${c.reset}      Deny permission`);
    console.log(`  ${c.dim}Examples: accept 2, deny main, allow 1${c.reset}`);
    console.log('');
    console.log(`${c.bold}AutoClaude:${c.reset}`);
    console.log(`  ${c.cyan}autoclaude <prompt> [duration]${c.reset}`);
    console.log(`                      Run autonomous Claude with auto-permissions`);
    console.log(`                      Duration format: 1:30 = 1 hour 30 minutes`);
    console.log('');
    console.log(`${c.bold}Dashboard:${c.reset}`);
    console.log(`  ${c.cyan}dashboard${c.reset}           Split-view dashboard with Pythia COT and MCP tools`);
    console.log('');
    console.log(`${c.bold}Monitoring & Recovery:${c.reset}`);
    console.log(`  ${c.cyan}health${c.reset}              Check Claude health status`);
    console.log(`  ${c.cyan}monitor [secs]${c.reset}      Start health monitor (default: 30s)`);
    console.log(`  ${c.cyan}monitor stop${c.reset}        Stop health monitor`);
    console.log(`  ${c.cyan}recover${c.reset}             Recover session from crash log`);
    console.log('');
    console.log(`${c.bold}Cleanup:${c.reset}`);
    console.log(`  ${c.cyan}cleanup${c.reset}             List project screens`);
    console.log(`  ${c.cyan}cleanup all${c.reset}         Stop ALL (saves Claude progress)`);
    console.log(`  ${c.cyan}cleanup claude${c.reset}      Stop Claude only`);
    console.log(`  ${c.cyan}cleanup <number>${c.reset}    Stop by list number`);
    console.log('');
    console.log(`${c.bold}Agents:${c.reset}`);
    console.log(`  ${c.cyan}agents${c.reset}              List tracked agents and their status`);
    console.log(`  ${c.cyan}tasks${c.reset}               Alias for agents`);
    console.log('');
    console.log(`${c.bold}Performance:${c.reset}`);
    console.log(`  ${c.cyan}heavyops true${c.reset}       Enable heavy ops mode (+batch size, -20% throttle)`);
    console.log(`  ${c.cyan}heavyops false${c.reset}      Disable heavy ops mode (normal settings)`);
    console.log(`  ${c.cyan}heavyops status${c.reset}     Show current heavy ops status`);
    console.log(`  ${c.cyan}resources${c.reset}           Show current resource limits`);
    console.log(`  ${c.cyan}cpumin <percent>${c.reset}    Set minimum CPU usage target`);
    console.log(`  ${c.cyan}cpumax <percent>${c.reset}    Set maximum CPU usage limit`);
    console.log(`  ${c.cyan}rammin <mb>${c.reset}         Set minimum RAM usage`);
    console.log(`  ${c.cyan}rammax <mb>${c.reset}         Set maximum RAM limit`);
    console.log('');
    console.log(`${c.bold}Service Mode:${c.reset}`);
    console.log(`  ${c.cyan}service on${c.reset}          Enable service mode (background operation)`);
    console.log(`  ${c.cyan}service off${c.reset}         Disable service mode`);
    console.log(`  ${c.cyan}service status${c.reset}      Show service mode status`);
    console.log(`  ${c.cyan}service debug${c.reset}       Launch debug TUI (multi-log viewer)`);
    console.log('');
    console.log(`${c.bold}Terminal:${c.reset}`);
    console.log(`  ${c.cyan}terminal info${c.reset}       Show terminal capabilities`);
    console.log(`  ${c.cyan}terminal fix${c.reset}        Auto-install emoji fonts (Linux)`);
    console.log(`  ${c.cyan}terminal test${c.reset}       Test icon rendering`);
    console.log('');
    console.log(`${c.bold}Shutdown:${c.reset}`);
    console.log(`  ${c.brightRed}die${c.reset}                 ☠️  KILL ALL - stops Claude, Brain, Docker, cleans up`);
    console.log('');
    console.log(`${c.bold}Other:${c.reset}`);
    console.log(`  ${c.cyan}help${c.reset}                Show this help`);
    console.log(`  ${c.cyan}clear${c.reset}               Clear screen`);
    console.log(`  ${c.cyan}exit, quit${c.reset}          Exit console`);
    console.log('');
  }

  /**
   * Execute a command
   */
  async executeCommand(input) {
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case '':
        break;

      case 'help':
      case '?':
        this.printHelp();
        break;

      case 'clear':
      case 'cls':
        console.clear();
        await this.printBanner();
        break;

      case 'exit':
      case 'quit':
      case 'q':
        this.running = false;
        console.log(`${c.dim}Goodbye!${c.reset}`);
        break;

      case 'status':
        this.specmem.status();
        break;

      case 'agents':
      case 'tasks': {
        this.listTrackedAgents();
        break;
      }

      case 'screens':
        console.log(listScreens() || 'No screen sessions found');
        break;

      case 'init':
        console.log(`${c.cyan}Running specmem-init...${c.reset}`);
        try {
          execSync(`node "${path.join(__dirname, '..', 'scripts', 'specmem-init.cjs')}"`, {
            cwd: this.projectPath,
            stdio: 'inherit'
          });
        } catch (e) {
          console.log(`${c.red}${icons.error} Init failed: ${e.message}${c.reset}`);
        }
        break;

      case 'claude':
        await this.handleClaudeCommand(args);
        break;

      case 'dashboard':
        this.startDashboardMode();
        break;

      case 'accept':
      case 'yes': {
        // Support: accept [target] - accept permission on specific session
        const target = args[0];
        let session;
        if (target) {
          session = this.getSessionByIdentifier(target);
          if (!session) {
            console.log(`${c.red}${icons.error} Session '${target}' not found. Use 'sessions' to list available sessions.${c.reset}`);
            break;
          }
        } else {
          session = this.getActiveSession();
          if (!session) {
            // Fallback to legacy single-session mode
            if (this.claude.accept()) {
              console.log(`${c.green}${icons.success} Accepted${c.reset}`);
            } else {
              console.log(`${c.red}${icons.error} Failed to accept${c.reset}`);
            }
            break;
          }
        }
        if (session.controller.accept()) {
          const alias = this.getAliasForSession(session.sessionNum);
          const displayName = alias ? `${session.sessionNum} (${alias})` : session.sessionNum;
          console.log(`${c.green}${icons.success} Accepted on Claude ${displayName}${c.reset}`);
        } else {
          console.log(`${c.red}${icons.error} Failed to accept on Claude ${session.sessionNum}${c.reset}`);
        }
        break;
      }

      case 'allow': {
        // Support: allow [target] - allow always on specific session
        const target = args[0];
        let session;
        if (target) {
          session = this.getSessionByIdentifier(target);
          if (!session) {
            console.log(`${c.red}${icons.error} Session '${target}' not found. Use 'sessions' to list available sessions.${c.reset}`);
            break;
          }
        } else {
          session = this.getActiveSession();
          if (!session) {
            // Fallback to legacy single-session mode
            if (this.claude.allowAlways()) {
              console.log(`${c.green}${icons.success} Allowed (won't ask again)${c.reset}`);
            } else {
              console.log(`${c.red}${icons.error} Failed to allow${c.reset}`);
            }
            break;
          }
        }
        if (session.controller.allowAlways()) {
          const alias = this.getAliasForSession(session.sessionNum);
          const displayName = alias ? `${session.sessionNum} (${alias})` : session.sessionNum;
          console.log(`${c.green}${icons.success} Allowed (won't ask again) on Claude ${displayName}${c.reset}`);
        } else {
          console.log(`${c.red}${icons.error} Failed to allow on Claude ${session.sessionNum}${c.reset}`);
        }
        break;
      }

      case 'deny':
      case 'no': {
        // Support: deny [target] - deny permission on specific session
        const target = args[0];
        let session;
        if (target) {
          session = this.getSessionByIdentifier(target);
          if (!session) {
            console.log(`${c.red}${icons.error} Session '${target}' not found. Use 'sessions' to list available sessions.${c.reset}`);
            break;
          }
        } else {
          session = this.getActiveSession();
          if (!session) {
            // Fallback to legacy single-session mode
            if (this.claude.deny()) {
              console.log(`${c.green}${icons.success} Denied${c.reset}`);
            } else {
              console.log(`${c.red}${icons.error} Failed to deny${c.reset}`);
            }
            break;
          }
        }
        if (session.controller.deny()) {
          const alias = this.getAliasForSession(session.sessionNum);
          const displayName = alias ? `${session.sessionNum} (${alias})` : session.sessionNum;
          console.log(`${c.green}${icons.success} Denied on Claude ${displayName}${c.reset}`);
        } else {
          console.log(`${c.red}${icons.error} Failed to deny on Claude ${session.sessionNum}${c.reset}`);
        }
        break;
      }

      case 'autoclaude':
        await this.handleAutoClaudeCommand(args);
        break;

      case 'cleanup':
        await this.handleCleanupCommand(args);
        break;

      case 'recover':
        this.recoverFromCrash();
        break;

      case 'monitor':
        if (args[0] === 'stop') {
          this.stopHealthMonitor();
        } else {
          const interval = parseInt(args[0]) || 30;
          this.startHealthMonitor(interval * 1000);
        }
        break;

      case 'health':
        const health = this.claude.checkHealth();
        const statusColors = { healthy: c.green, warning: c.yellow, critical: c.red, dead: c.brightRed };
        const healthIcons = { healthy: icons.healthy, warning: icons.warning, critical: icons.critical, dead: icons.dead };
        console.log(`${statusColors[health.status]}${healthIcons[health.status]} ${health.status.toUpperCase()}: ${health.message}${c.reset}`);
        if (health.contextPercent) {
          console.log(`${c.dim}Context usage: ${health.contextPercent}%${c.reset}`);
        }
        break;

      case 'die':
      case 'kill':
      case 'nuke':
        await this.handleDieCommand();
        break;

      case 'terminal':
      case 'term':
        await this.handleTerminalCommand(args);
        break;


      // ═══════════════════════════════════════════════════════════════
      // Session Management Commands
      // ═══════════════════════════════════════════════════════════════

      case 'claudes':
      case 'sessions': {
        console.log(`\n${c.cyan}${icons.brain} Running Claude Sessions${c.reset}`);
        console.log('─'.repeat(50));

        if (this.claudeSessions.length === 0) {
          console.log(`${c.dim}No sessions running. Use 'claude start' or 'n' to start one.${c.reset}`);
        } else {
          for (const session of this.claudeSessions) {
            const isActive = this.getActiveSession() === session;
            const alias = this.getAliasForSession ? this.getAliasForSession(session.sessionNum) : null;
            const status = screenExists(session.controller.claudeSession) ? `${c.green}running${c.reset}` : `${c.red}stopped${c.reset}`;
            const activeMarker = isActive ? `${c.brightCyan}${icons.arrow}${c.reset}` : ' ';
            const aliasStr = alias ? ` "${c.yellow}${alias}${c.reset}"` : '';
            console.log(`${activeMarker} [${session.sessionNum}]${aliasStr} ${session.controller.claudeSession} - ${status}`);
          }
        }
        console.log('');
        break;
      }

      case 'stop': {
        const target = args[0];

        if (!target) {
          // Stop active session
          const active = this.getActiveSession();
          if (active) {
            screenKill(active.controller.claudeSession);
            // BUG FIX: Remove stopped session from tracking (was missing before)
            this.removeSessionFromTracking(active);
            console.log(`${c.yellow}Stopped Claude ${active.sessionNum}${c.reset}`);
          } else {
            console.log(`${c.yellow}No active session to stop. Use 'stop <n>' for specific session.${c.reset}`);
          }
        } else {
          const session = this.getSessionByIdentifier ? this.getSessionByIdentifier(target) : null;
          if (session) {
            screenKill(session.controller.claudeSession);
            // BUG FIX: Remove stopped session from tracking (was missing before)
            this.removeSessionFromTracking(session);
            console.log(`${c.yellow}Stopped Claude ${session.sessionNum}${c.reset}`);
          } else {
            console.log(`${c.red}Session ${target} not found${c.reset}`);
          }
        }
        break;
      }

      case 'restart': {
        const target = args[0];

        let session;
        if (target) {
          session = this.getSessionByIdentifier ? this.getSessionByIdentifier(target) : null;
        } else {
          session = this.getActiveSession();
        }

        if (!session) {
          console.log(`${c.red}Session not found${c.reset}`);
          break;
        }

        console.log(`${c.cyan}Restarting Claude ${session.sessionNum}...${c.reset}`);
        screenKill(session.controller.claudeSession);
        await new Promise(r => setTimeout(r, 500));
        session.controller.start();
        console.log(`${c.green}Claude ${session.sessionNum} restarted${c.reset}`);
        break;
      }

      case 'attach': {
        const target = args[0];

        let session;
        if (target) {
          session = this.getSessionByIdentifier ? this.getSessionByIdentifier(target) : null;
        } else {
          session = this.getActiveSession();
        }

        if (!session) {
          console.log(`${c.red}Session not found${c.reset}`);
          break;
        }

        console.log(`${c.cyan}Attaching to Claude ${session.sessionNum}... (Ctrl+A+D to detach)${c.reset}`);
        try {
          execSync(`screen -r ${session.controller.claudeSession}`, { stdio: 'inherit' });
        } catch (e) {
          console.log(`${c.red}Failed to attach: ${e.message}${c.reset}`);
        }
        break;
      }

      case 'switch': {
        const target = args[0];

        if (!target) {
          console.log(`${c.yellow}Usage: switch <number|alias>${c.reset}`);
          break;
        }

        const session = this.getSessionByIdentifier ? this.getSessionByIdentifier(target) : null;
        if (session) {
          const idx = this.claudeSessions.indexOf(session);
          if (idx !== -1) {
            this.activeSessionIndex = idx;
            console.log(`${c.green}Switched to Claude ${session.sessionNum}${c.reset}`);
          }
        } else {
          console.log(`${c.red}Session ${target} not found${c.reset}`);
        }
        break;
      }

      case 'minicot':
      case 'cot':
        await this.handleMiniCOTCommand(args);
        break;

      case 'heavyops':
        await this.handleHeavyOpsCommand(args);
        break;

      case 'power':
        await this.handlePowerCommand(args);
        break;

      case 'resources':
        await this.handleResourcesCommand(['status']);
        break;

      case 'cpumin':
        await this.handleResourcesCommand(['cpumin', args[0]]);
        break;

      case 'cpumax':
        await this.handleResourcesCommand(['cpumax', args[0]]);
        break;

      case 'rammin':
        await this.handleResourcesCommand(['rammin', args[0]]);
        break;

      case 'rammax':
        await this.handleResourcesCommand(['rammax', args[0]]);
        break;

      case 'embedding':
        await this.handleEmbeddingCommand(args);
        break;

      case 'service':
        await this.handleServiceCommand(args);
        break;

      default:
        console.log(`${c.yellow}Unknown command: ${cmd}${c.reset}`);
        console.log(`${c.dim}Type 'help' for available commands${c.reset}`);
    }
  }

  /**
   * Handle terminal info/fix commands
   */
  async handleTerminalCommand(args) {
    const subCmd = args[0]?.toLowerCase() || 'info';

    switch (subCmd) {
      case 'info':
        console.log(`${c.cyan}Terminal Capabilities:${c.reset}`);
        console.log(`${c.dim}${icons.line_h.repeat(40)}${c.reset}`);
        console.log(`  ${c.dim}TERM:${c.reset}       ${process.env.TERM || '(not set)'}`);
        console.log(`  ${c.dim}COLORTERM:${c.reset}  ${process.env.COLORTERM || '(not set)'}`);
        console.log(`  ${c.dim}TERMINAL:${c.reset}   ${process.env.TERMINAL || '(not set)'}`);
        console.log(`  ${c.dim}Desktop:${c.reset}    ${process.env.XDG_CURRENT_DESKTOP || '(not set)'}`);
        console.log(`  ${c.dim}LANG:${c.reset}       ${process.env.LANG || '(not set)'}`);
        console.log('');
        console.log(`${c.cyan}Detected:${c.reset}`);
        console.log(`  ${c.dim}Colors:${c.reset}     ${termCaps.hasColors ? `${c.green}${icons.success} Yes${c.reset}` : `${c.red}${icons.error} No${c.reset}`}`);
        console.log(`  ${c.dim}True Color:${c.reset} ${termCaps.hasTrueColor ? `${c.green}${icons.success} Yes${c.reset}` : `${c.dim}No${c.reset}`}`);
        console.log(`  ${c.dim}Unicode:${c.reset}    ${termCaps.hasUnicode ? `${c.green}${icons.success} Yes${c.reset}` : `${c.dim}No${c.reset}`}`);
        console.log(`  ${c.dim}Emoji:${c.reset}      ${termCaps.hasEmoji ? `${c.green}${icons.success} Yes${c.reset}` : `${c.yellow}${icons.warning} No (using ASCII)${c.reset}`}`);
        console.log(`  ${c.dim}Modern:${c.reset}     ${termCaps.modernTerminal ? `${c.green}${icons.success} Yes${c.reset}` : `${c.dim}No${c.reset}`}`);
        console.log(`  ${c.dim}XFCE:${c.reset}       ${termCaps.isXFCE ? 'Yes' : 'No'}`);
        console.log(`  ${c.dim}Safe Mode:${c.reset}  ${termCaps.safeMode ? `${c.yellow}Yes${c.reset}` : 'No'}`);
        console.log('');
        if (!termCaps.hasEmoji) {
          console.log(`${c.dim}To enable emoji support:${c.reset}`);
          console.log(`  ${c.cyan}terminal fix${c.reset}  - Auto-install emoji fonts (Linux)`);
          console.log(`  ${c.dim}Or set: ${c.cyan}export SPECMEM_EMOJI=1${c.reset} to force enable`);
          console.log(`  ${c.dim}(Modern terminals auto-detected: Kitty, WezTerm, iTerm2, etc.)${c.reset}`);
        }
        break;

      case 'fix':
        await this.fixTerminalEmoji();
        break;

      case 'test':
        console.log(`${c.cyan}Icon Test (current mode):${c.reset}`);
        console.log(`  Success: ${icons.success}`);
        console.log(`  Error:   ${icons.error}`);
        console.log(`  Warning: ${icons.warning}`);
        console.log(`  Info:    ${icons.info}`);
        console.log(`  Brain:   ${icons.brain}`);
        console.log(`  Robot:   ${icons.robot}`);
        console.log(`  Box:     ${icons.box_tl}${icons.box_h}${icons.box_h}${icons.box_tr}`);
        console.log(`           ${icons.box_v}  ${icons.box_v}`);
        console.log(`           ${icons.box_bl}${icons.box_h}${icons.box_h}${icons.box_br}`);
        break;

      default:
        console.log(`${c.cyan}Terminal subcommands:${c.reset}`);
        console.log(`  info   - Show terminal capabilities`);
        console.log(`  fix    - Auto-install emoji fonts (Linux)`);
        console.log(`  test   - Test icon rendering`);
    }
  }

  /**
   * Handle Mini COT server commands
   * Manages the TinyLlama-based semantic analysis service
   */
  async handleMiniCOTCommand(args) {
    const subCmd = args[0]?.toLowerCase() || 'status';
    const sockPath = path.join(this.projectPath, 'specmem', 'sockets', 'minicot.sock');
    const pidPath = path.join(this.projectPath, 'specmem', 'sockets', 'minicot.pid');
    const stoppedPath = path.join(this.projectPath, 'specmem', 'sockets', 'minicot.stopped');

    switch (subCmd) {
      case 'status': {
        console.log(`${c.cyan}Mini COT Server Status:${c.reset}`);
        let pid = null, isRunning = false;
        try {
          if (fs.existsSync(pidPath)) {
            pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim());
            try { process.kill(pid, 0); isRunning = true; } catch (e) {}
          }
        } catch (e) {}
        const isStopped = fs.existsSync(stoppedPath);
        const socketExists = fs.existsSync(sockPath);
        console.log(`  Status:     ${isRunning ? `${c.green}Running${c.reset}` : `${c.red}Stopped${c.reset}`}`);
        console.log(`  PID:        ${pid || '(none)'}`);
        console.log(`  Socket:     ${socketExists ? `${c.green}Exists${c.reset}` : 'Not found'}`);
        console.log(`  Auto-start: ${isStopped ? `${c.yellow}Disabled${c.reset}` : `${c.green}Enabled${c.reset}`}`);
        break;
      }
      case 'start': {
        if (fs.existsSync(stoppedPath)) fs.unlinkSync(stoppedPath);
        const scriptPath = path.join(__dirname, '..', 'mini-cot-service.py');
        if (fs.existsSync(scriptPath)) {
          // Task #22 fix: Use getPythonPath() instead of hardcoded 'python3'
          const pythonPath = getPythonPath();
          const proc = require('child_process').spawn(pythonPath, [scriptPath], {
            cwd: this.projectPath, detached: true, stdio: 'ignore',
            env: { ...process.env, SPECMEM_PROJECT_PATH: this.projectPath }
          });
          proc.unref();
          console.log(`${c.green}Mini COT starting (PID: ${proc.pid})${c.reset}`);
        } else {
          console.log(`${c.yellow}mini-cot-service.py not found${c.reset}`);
        }
        break;
      }
      case 'stop': {
        fs.mkdirSync(path.dirname(stoppedPath), { recursive: true });
        fs.writeFileSync(stoppedPath, new Date().toISOString());
        if (fs.existsSync(pidPath)) {
          try {
            const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim());
            process.kill(pid, 'SIGTERM');
            fs.unlinkSync(pidPath);
            console.log(`${c.green}Stopped PID ${pid}${c.reset}`);
          } catch (e) { console.log(`${c.yellow}Already stopped${c.reset}`); }
        }
        break;
      }
      case 'restart':
        await this.handleMiniCOTCommand(['stop']);
        await new Promise(r => setTimeout(r, 1000));
        await this.handleMiniCOTCommand(['start']);
        break;

      case 'warm': {
        // Warm restart - send SIGHUP to preserve model weights
        console.log(`${c.cyan}Performing warm restart (preserving model weights)...${c.reset}`);
        if (fs.existsSync(pidPath)) {
          try {
            const pidContent = fs.readFileSync(pidPath, 'utf8').trim();
            const pid = parseInt(pidContent.split(':')[0], 10);
            // Check if process exists
            try {
              process.kill(pid, 0);
              // Send SIGHUP for warm restart
              process.kill(pid, 'SIGHUP');
              console.log(`${c.green}Sent SIGHUP to PID ${pid}${c.reset}`);
              console.log(`${c.dim}Model weights preserved, state reset${c.reset}`);
            } catch (e) {
              console.log(`${c.yellow}Process not running, doing cold restart instead...${c.reset}`);
              await this.handleMiniCOTCommand(['cold']);
            }
          } catch (e) {
            console.log(`${c.yellow}Could not read PID file, doing cold restart...${c.reset}`);
            await this.handleMiniCOTCommand(['cold']);
          }
        } else {
          console.log(`${c.yellow}No PID file found, starting fresh...${c.reset}`);
          await this.handleMiniCOTCommand(['start']);
        }
        break;
      }

      case 'cold': {
        // Cold restart - full process termination and reload
        console.log(`${c.cyan}Performing cold restart (full model reload)...${c.reset}`);
        // Clear stopped flag
        if (fs.existsSync(stoppedPath)) fs.unlinkSync(stoppedPath);
        // Kill existing process
        if (fs.existsSync(pidPath)) {
          try {
            const pidContent = fs.readFileSync(pidPath, 'utf8').trim();
            const pid = parseInt(pidContent.split(':')[0], 10);
            process.kill(pid, 'SIGTERM');
            console.log(`${c.dim}Terminated PID ${pid}${c.reset}`);
            // Wait for process to die
            await new Promise(r => setTimeout(r, 2000));
            // Force kill if still running
            try {
              process.kill(pid, 0);
              process.kill(pid, 'SIGKILL');
              console.log(`${c.dim}Force killed PID ${pid}${c.reset}`);
            } catch (e) { /* already dead */ }
          } catch (e) { /* already dead */ }
          try { fs.unlinkSync(pidPath); } catch (e) {}
        }
        // Clean up socket
        if (fs.existsSync(sockPath)) {
          try { fs.unlinkSync(sockPath); } catch (e) {}
        }
        // Start fresh
        await new Promise(r => setTimeout(r, 1000));
        await this.handleMiniCOTCommand(['start']);
        console.log(`${c.green}Cold restart complete - model fully reloaded${c.reset}`);
        break;
      }

      case 'queue': {
        // Show queue status (if available via MCP)
        console.log(`${c.cyan}Queue Status:${c.reset}`);
        console.log(`${c.dim}Queue monitoring requires MCP connection.${c.reset}`);
        console.log(`${c.dim}Use MCP tool 'getMiniCOTServerManager().getQueueStatus()' for details.${c.reset}`);
        break;
      }

      default:
        console.log(`${c.cyan}minicot subcommands:${c.reset}`);
        console.log(`  ${c.white}status${c.reset}   - Show server status`);
        console.log(`  ${c.white}start${c.reset}    - Start the Mini COT server`);
        console.log(`  ${c.white}stop${c.reset}     - Stop the server (disables auto-restart)`);
        console.log(`  ${c.white}restart${c.reset}  - Stop and start (alias for cold)`);
        console.log(`  ${c.green}warm${c.reset}     - Quick restart, preserves model weights`);
        console.log(`  ${c.yellow}cold${c.reset}     - Full restart, reloads model completely`);
        console.log(`  ${c.dim}queue${c.reset}    - Show overflow queue status`);
    }
  }

  /**
   * Handle embedding server commands
   * Manages the Frankenstein embedding server
   */
  async handleEmbeddingCommand(args) {
    const subCmd = args[0]?.toLowerCase() || 'status';
    const sockPath = path.join(this.projectPath, 'specmem', 'sockets', 'embedding.sock');
    const pidPath = path.join(this.projectPath, 'specmem', 'sockets', 'embedding.pid');
    const stoppedPath = path.join(this.projectPath, 'specmem', 'sockets', 'embedding.stopped');
    const logPath = path.join(this.projectPath, 'specmem', 'sockets', 'embedding.log');

    switch (subCmd) {
      case 'status': {
        console.log(`${c.cyan}Embedding Server Status:${c.reset}`);
        let pid = null, isRunning = false;
        try {
          if (fs.existsSync(pidPath)) {
            pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim());
            try { process.kill(pid, 0); isRunning = true; } catch (e) {}
          }
        } catch (e) {}
        const isStopped = fs.existsSync(stoppedPath);
        const socketExists = fs.existsSync(sockPath);

        // Check socket health
        let socketHealthy = false;
        if (socketExists) {
          try {
            const stat = fs.statSync(sockPath);
            socketHealthy = stat.isSocket();
          } catch (e) {}
        }

        console.log(`  Status:     ${isRunning ? `${c.green}Running${c.reset}` : `${c.red}Stopped${c.reset}`}`);
        console.log(`  PID:        ${pid || '(none)'}`);
        console.log(`  Socket:     ${socketExists ? (socketHealthy ? `${c.green}Healthy${c.reset}` : `${c.yellow}Exists (not socket)${c.reset}`) : 'Not found'}`);
        console.log(`  Auto-start: ${isStopped ? `${c.yellow}Disabled${c.reset}` : `${c.green}Enabled${c.reset}`}`);
        console.log(`  Socket:     ${sockPath}`);
        break;
      }

      case 'start': {
        if (fs.existsSync(stoppedPath)) fs.unlinkSync(stoppedPath);
        const scriptPath = path.join(__dirname, '..', 'embedding-sandbox', 'frankenstein-embeddings.py');
        if (fs.existsSync(scriptPath)) {
          const pythonPath = getPythonPath();
          console.log(`${c.cyan}Starting embedding server...${c.reset}`);
          const proc = require('child_process').spawn(pythonPath, [scriptPath], {
            cwd: path.join(__dirname, '..', 'embedding-sandbox'),
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
              ...process.env,
              SPECMEM_PROJECT_PATH: this.projectPath,
              EMBEDDING_SOCKET_PATH: sockPath
            }
          });

          // Write PID
          fs.mkdirSync(path.dirname(pidPath), { recursive: true });
          fs.writeFileSync(pidPath, proc.pid.toString());

          // Log output
          if (proc.stdout) {
            proc.stdout.on('data', (data) => {
              try { fs.appendFileSync(logPath, data); } catch (e) {}
            });
          }
          if (proc.stderr) {
            proc.stderr.on('data', (data) => {
              try { fs.appendFileSync(logPath, data); } catch (e) {}
            });
          }

          proc.unref();
          console.log(`${c.green}Embedding server starting (PID: ${proc.pid})${c.reset}`);
          console.log(`${c.dim}Logs: ${logPath}${c.reset}`);
        } else {
          console.log(`${c.red}frankenstein-embeddings.py not found at ${scriptPath}${c.reset}`);
        }
        break;
      }

      case 'stop': {
        fs.mkdirSync(path.dirname(stoppedPath), { recursive: true });
        fs.writeFileSync(stoppedPath, new Date().toISOString());
        if (fs.existsSync(pidPath)) {
          try {
            const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim());
            process.kill(pid, 'SIGTERM');
            fs.unlinkSync(pidPath);
            console.log(`${c.green}Stopped embedding server (PID ${pid})${c.reset}`);
          } catch (e) {
            console.log(`${c.yellow}Already stopped or PID not found${c.reset}`);
          }
        } else {
          console.log(`${c.yellow}No PID file found${c.reset}`);
        }
        // Clean up socket
        if (fs.existsSync(sockPath)) {
          try { fs.unlinkSync(sockPath); } catch (e) {}
        }
        break;
      }

      case 'restart': {
        console.log(`${c.cyan}Restarting embedding server...${c.reset}`);
        await this.handleEmbeddingCommand(['stop']);
        await new Promise(r => setTimeout(r, 2000)); // Wait for cleanup
        await this.handleEmbeddingCommand(['start']);
        break;
      }

      case 'logs': {
        if (fs.existsSync(logPath)) {
          console.log(`${c.cyan}Recent Embedding Server Logs:${c.reset}`);
          console.log(`${c.dim}${icons.line_h.repeat(50)}${c.reset}`);
          try {
            const content = fs.readFileSync(logPath, 'utf8');
            const lines = content.split('\n').slice(-30); // Last 30 lines
            lines.forEach(line => console.log(`  ${c.dim}${line}${c.reset}`));
          } catch (e) {
            console.log(`${c.red}Error reading logs: ${e.message}${c.reset}`);
          }
        } else {
          console.log(`${c.yellow}No log file found at ${logPath}${c.reset}`);
        }
        break;
      }

      default:
        console.log(`${c.cyan}Embedding Server Commands:${c.reset}`);
        console.log(`  ${c.white}status${c.reset}   - Show server status (pid, socket, health)`);
        console.log(`  ${c.white}start${c.reset}    - Start the embedding server`);
        console.log(`  ${c.white}stop${c.reset}     - Stop the server (disables auto-restart)`);
        console.log(`  ${c.white}restart${c.reset}  - Stop and start the server`);
        console.log(`  ${c.white}logs${c.reset}     - Show recent server logs`);
    }
  }

  /**
   * Handle service mode commands
   * - service on: Enable service mode (MCP runs in background)
   * - service off: Disable service mode
   * - service status: Show current mode
   * - service debug: Launch debug TUI with multi-log viewer
   */
  async handleServiceCommand(args) {
    const subCmd = args[0]?.toLowerCase() || 'status';
    const userConfigPath = path.join(this.projectPath, 'specmem', 'user-config.json');

    // Load user config
    let userConfig = {};
    try {
      if (fs.existsSync(userConfigPath)) {
        userConfig = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
      }
    } catch (e) {
      // Start fresh
    }

    switch (subCmd) {
      case 'on':
      case 'enable':
      case 'true': {
        userConfig.serviceMode = { enabled: true, enabledAt: new Date().toISOString() };
        fs.mkdirSync(path.dirname(userConfigPath), { recursive: true });
        fs.writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2));
        console.log(`${c.green}${icons.success} Service mode ENABLED${c.reset}`);
        console.log(`${c.dim}MCP server will run in background without requiring console${c.reset}`);
        break;
      }

      case 'off':
      case 'disable':
      case 'false': {
        userConfig.serviceMode = { enabled: false, disabledAt: new Date().toISOString() };
        fs.writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2));
        console.log(`${c.yellow}${icons.warning} Service mode DISABLED${c.reset}`);
        break;
      }

      case 'debug':
        this.startServiceDebugTUI();
        break;

      case 'status':
      default: {
        const isEnabled = userConfig.serviceMode?.enabled === true;
        const statusColor = isEnabled ? c.green : c.yellow;
        const statusIcon = isEnabled ? icons.success : icons.warning;
        const statusText = isEnabled ? 'ENABLED' : 'DISABLED';
        console.log(`${c.cyan}Service Mode:${c.reset} ${statusColor}${statusIcon} ${statusText}${c.reset}`);
        if (userConfig.serviceMode?.enabledAt) {
          console.log(`${c.dim}Enabled at: ${userConfig.serviceMode.enabledAt}${c.reset}`);
        }
        console.log('');
        console.log(`${c.dim}Commands:${c.reset}`);
        console.log(`  ${c.cyan}service on${c.reset}     Enable service mode`);
        console.log(`  ${c.cyan}service off${c.reset}    Disable service mode`);
        console.log(`  ${c.cyan}service debug${c.reset}  Launch debug TUI (multi-log viewer)`);
        break;
      }
    }
  }

  /**
   * Service Debug TUI - Multi-log viewer with grid layout
   * Arrow keys: Navigate between log tiles
   * Enter: Fullscreen selected log (scrollable)
   * Escape: Exit fullscreen or exit TUI
   * q: Quit TUI
   */
  startServiceDebugTUI() {
    const useAltBuffer = termCaps.isTTY && !termCaps.safeMode;

    if (useAltBuffer) {
      process.stdout.write('\x1b[?1049h'); // Enter alternate buffer
      process.stdout.write('\x1b[?25l');   // Hide cursor
    }

    // Log files to display in grid
    const logSources = [
      { name: 'MCP Debug', path: path.join(this.projectPath, 'specmem', 'sockets', 'mcp-debug.log'), color: c.brightYellow },
      { name: 'MCP Tools', path: path.join(this.projectPath, 'specmem', 'sockets', 'mcp-tool-calls.log'), color: c.yellow },
      { name: 'COT Stream', path: path.join(this.projectPath, 'specmem', 'sockets', 'cot-stream.log'), color: c.magenta },
      { name: 'Embedding', path: path.join(this.projectPath, 'specmem', 'sockets', 'embedding-autostart.log'), color: c.green },
      { name: 'MCP Startup', path: path.join(this.projectPath, 'specmem', 'run', 'mcp-startup.log'), color: c.cyan },
      { name: 'Agent Output', path: path.join(this.projectPath, '.specmem', 'logs', 'agent-output-interceptor.log'), color: c.brightCyan }
    ];

    let running = true;
    let selectedIndex = 0;
    let fullscreenIndex = -1; // -1 = grid view, >=0 = fullscreen specific log
    let scrollOffset = 0;     // For fullscreen scrolling

    const getSize = () => ({
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24
    });

    // Box drawing chars
    const box = termCaps.hasUnicode ? {
      tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│'
    } : {
      tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|'
    };

    /**
     * Read last N lines from a log file
     */
    const readLogTail = (logPath, lines = 20) => {
      try {
        if (!fs.existsSync(logPath)) return [`${c.dim}(no log file)${c.reset}`];
        const content = fs.readFileSync(logPath, 'utf8');
        const allLines = content.split('\n').filter(l => l.trim());
        return allLines.slice(-lines);
      } catch (e) {
        return [`${c.dim}(error reading)${c.reset}`];
      }
    };

    /**
     * Render grid view with 2x3 or 3x2 log tiles
     */
    const drawGridView = () => {
      const { cols, rows } = getSize();
      let frame = '\x1b[2J\x1b[H'; // Clear + home

      // Header
      const title = ` ${icons.brain} SERVICE DEBUG TUI `;
      const helpText = `${c.dim}Arrow keys: select | Enter: fullscreen | q: quit${c.reset}`;
      frame += `${c.bgCyan}${c.black}${title}${' '.repeat(Math.max(0, cols - visibleLength(title) - visibleLength(helpText) - 2))}${helpText} ${c.reset}\n`;

      // Calculate tile dimensions (2 columns, 3 rows)
      const tileWidth = Math.floor((cols - 3) / 2); // -3 for borders
      const tileHeight = Math.floor((rows - 3) / 3); // -3 for header and footer

      // Pre-read all log files once per draw cycle (fixes live polling issue)
      const logCache = logSources.map(log => readLogTail(log.path, tileHeight - 3));

      // Render tiles in 2x3 grid
      for (let row = 0; row < 3; row++) {
        // Render top border of row
        let topBorder = '';
        for (let col = 0; col < 2; col++) {
          const idx = row * 2 + col;
          const isSelected = idx === selectedIndex;
          const borderColor = isSelected ? c.brightYellow : c.dim;
          const corner = col === 0 ? box.tl : '';
          topBorder += `${borderColor}${corner}${box.h.repeat(tileWidth)}${col === 0 ? box.h : box.tr}${c.reset}`;
        }
        frame += topBorder + '\n';

        // Render content lines of row
        for (let lineNum = 0; lineNum < tileHeight - 2; lineNum++) {
          let line = '';
          for (let col = 0; col < 2; col++) {
            const idx = row * 2 + col;
            const log = logSources[idx];
            const isSelected = idx === selectedIndex;
            const borderColor = isSelected ? c.brightYellow : c.dim;

            if (lineNum === 0 && log) {
              // Title line
              const titleText = ` ${log.color}${log.name}${c.reset}`;
              const padding = Math.max(0, tileWidth - visibleLength(titleText) - 1);
              line += `${borderColor}${box.v}${c.reset}${titleText}${' '.repeat(padding)}`;
            } else if (log) {
              // Content lines - use cached log content
              const logLines = logCache[idx];
              const contentLine = logLines[lineNum - 1] || '';
              // Truncate to fit tile width
              const truncated = truncateAnsiSafe(contentLine, tileWidth - 2);
              const padding = Math.max(0, tileWidth - visibleLength(truncated) - 1);
              line += `${borderColor}${box.v}${c.reset} ${truncated}${' '.repeat(padding)}`;
            } else {
              line += `${borderColor}${box.v}${c.reset}${' '.repeat(tileWidth)}`;
            }
          }
          line += `${c.dim}${box.v}${c.reset}`;
          frame += line + '\n';
        }

        // Render bottom border of row
        let bottomBorder = '';
        for (let col = 0; col < 2; col++) {
          const idx = row * 2 + col;
          const isSelected = idx === selectedIndex;
          const borderColor = isSelected ? c.brightYellow : c.dim;
          const corner = col === 0 ? box.bl : '';
          bottomBorder += `${borderColor}${corner}${box.h.repeat(tileWidth)}${col === 0 ? box.h : box.br}${c.reset}`;
        }
        frame += bottomBorder + '\n';
      }

      process.stdout.write(frame);
    };

    /**
     * Render fullscreen view of a single log
     */
    const drawFullscreenView = () => {
      const { cols, rows } = getSize();
      const log = logSources[fullscreenIndex];
      if (!log) return;

      let frame = '\x1b[2J\x1b[H'; // Clear + home

      // Header
      const title = ` ${log.color}${icons.bullet} ${log.name}${c.reset} `;
      const helpText = `${c.dim}Up/Down: scroll | Esc: back | q: quit${c.reset}`;
      frame += `${c.bgCyan}${c.black}${title}${' '.repeat(Math.max(0, cols - visibleLength(title) - visibleLength(helpText) - 2))}${helpText} ${c.reset}\n`;

      // Border top
      frame += `${c.dim}${box.tl}${box.h.repeat(cols - 2)}${box.tr}${c.reset}\n`;

      // Content area
      const contentHeight = rows - 4;
      const allLines = readLogTail(log.path, 500); // Read more lines for scrolling
      const totalLines = allLines.length;
      const maxScroll = Math.max(0, totalLines - contentHeight);
      scrollOffset = Math.min(scrollOffset, maxScroll);
      scrollOffset = Math.max(0, scrollOffset);

      const visibleLines = allLines.slice(scrollOffset, scrollOffset + contentHeight);

      for (let i = 0; i < contentHeight; i++) {
        const line = visibleLines[i] || '';
        const truncated = truncateAnsiSafe(line, cols - 4);
        const padding = Math.max(0, cols - 4 - visibleLength(truncated));
        frame += `${c.dim}${box.v}${c.reset} ${truncated}${' '.repeat(padding)} ${c.dim}${box.v}${c.reset}\n`;
      }

      // Border bottom + scroll indicator
      const scrollPct = totalLines > 0 ? Math.round((scrollOffset / Math.max(1, maxScroll)) * 100) : 100;
      const scrollInfo = ` ${scrollOffset + 1}-${Math.min(scrollOffset + contentHeight, totalLines)}/${totalLines} (${scrollPct}%) `;
      const bottomPad = Math.max(0, cols - 2 - scrollInfo.length);
      frame += `${c.dim}${box.bl}${box.h.repeat(bottomPad)}${scrollInfo}${box.br}${c.reset}\n`;

      process.stdout.write(frame);
    };

    const draw = () => {
      if (fullscreenIndex >= 0) {
        drawFullscreenView();
      } else {
        drawGridView();
      }
    };

    // Initial draw
    draw();

    // Refresh interval for live log updates
    const refreshInterval = setInterval(() => draw(), 1000);

    // Handle resize
    const resizeHandler = () => draw();
    process.stdout.on('resize', resizeHandler);

    // Raw mode for key handling
    safeSetRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const keyHandler = (key) => {
      if (key === 'q' || key === '\x03') { // q or Ctrl+C
        running = false;
        cleanup();
        return;
      }

      if (fullscreenIndex >= 0) {
        // Fullscreen mode key handling
        if (key === '\x1b' || key === '\x1b[D') { // Escape or Left arrow
          fullscreenIndex = -1;
          scrollOffset = 0;
          draw();
        } else if (key === '\x1b[A') { // Up arrow - scroll up
          scrollOffset = Math.max(0, scrollOffset - 1);
          draw();
        } else if (key === '\x1b[B') { // Down arrow - scroll down
          scrollOffset++;
          draw();
        } else if (key === '\x1b[5~') { // Page Up
          scrollOffset = Math.max(0, scrollOffset - 10);
          draw();
        } else if (key === '\x1b[6~') { // Page Down
          scrollOffset += 10;
          draw();
        }
      } else {
        // Grid view key handling
        if (key === '\x1b') { // Escape - exit TUI
          running = false;
          cleanup();
          return;
        } else if (key === '\x1b[A') { // Up arrow
          if (selectedIndex >= 2) selectedIndex -= 2;
          draw();
        } else if (key === '\x1b[B') { // Down arrow
          if (selectedIndex < logSources.length - 2) selectedIndex += 2;
          draw();
        } else if (key === '\x1b[D') { // Left arrow
          if (selectedIndex > 0) selectedIndex--;
          draw();
        } else if (key === '\x1b[C') { // Right arrow
          if (selectedIndex < logSources.length - 1) selectedIndex++;
          draw();
        } else if (key === '\r' || key === '\n') { // Enter - fullscreen
          fullscreenIndex = selectedIndex;
          scrollOffset = 0;
          draw();
        }
      }
    };

    process.stdin.on('data', keyHandler);

    const cleanup = () => {
      clearInterval(refreshInterval);
      process.stdout.removeListener('resize', resizeHandler);
      process.stdin.removeListener('data', keyHandler);
      safeSetRawMode(false);

      if (useAltBuffer) {
        process.stdout.write('\x1b[?25h');   // Show cursor
        process.stdout.write('\x1b[?1049l'); // Exit alternate buffer
      }

      console.log(`${c.dim}Exited service debug TUI${c.reset}`);
      console.log('');

      // Resume stdin for readline
      process.stdin.resume();

      // Re-create readline interface to properly restore input
      setTimeout(() => {
        // Clear any leftover raw mode state
        if (process.stdin.isTTY && process.stdin.setRawMode) {
          try { process.stdin.setRawMode(false); } catch (e) {}
        }

        this.printBanner().then(() => {
          // Re-create readline - set flag to suppress "Goodbye" on intentional close
          if (this.rl) {
            this.suppressRlClose = true; // Prevent close handler from exiting
            this.rl.close();
            this.suppressRlClose = false;
          }

          // Get fresh TTY streams
          const ttyStreams = getTTYStreams();
          if (ttyStreams.isTTY && ttyStreams.input.setRawMode) {
            ttyStreams.input.setRawMode(false);
          }
          ttyStreams.input.resume();

          this.rl = readline.createInterface({
            input: ttyStreams.input,
            output: ttyStreams.output,
            terminal: ttyStreams.isTTY
          });

          // Setup readline prompt handler again
          this.rl.on('line', (line) => this.handleCommand(line.trim()));
          this.rl.on('close', () => {
            // Only exit if not intentionally closing to recreate
            if (!this.suppressRlClose) {
              console.log(`\n${c.dim}Goodbye!${c.reset}`);
              process.exit(0);
            }
          });

          // Show prompt
          this.rl.prompt();
        });
      }, 100);
    };
  }

  /**
   * Handle heavyOps command - toggle performance mode
   * heavyOps true: +batch size (2x), -20% throttle delays
   * heavyOps false: normal settings
   */
  async handleHeavyOpsCommand(args) {
    const subCmd = args[0]?.toLowerCase() || 'status';
    const configPath = path.join(this.projectPath, 'specmem', 'model-config.json');

    // Load current config
    let config = {};
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (e) {
      console.log(`${c.yellow}Could not read config: ${e.message}${c.reset}`);
    }

    switch (subCmd) {
      case 'true':
      case 'on':
      case '1':
      case 'enable': {
        // Enable heavy ops mode
        const currentBatchSize = config.embedding?.batchSize || 16;
        const newBatchSize = Math.min(currentBatchSize * 2, 128); // Cap at 128

        config.heavyOps = {
          enabled: true,
          enabledAt: new Date().toISOString(),
          originalBatchSize: currentBatchSize,
          batchSizeMultiplier: 2,
          throttleReduction: 0.20 // 20% reduction
        };
        config.embedding = config.embedding || {};
        config.embedding.batchSize = newBatchSize;

        // Write config
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        console.log(`${c.green}${icons.success} Heavy Ops Mode ENABLED${c.reset}`);
        console.log(`${c.dim}─────────────────────────────────────────${c.reset}`);
        console.log(`  ${c.cyan}Batch Size:${c.reset}   ${currentBatchSize} → ${c.brightGreen}${newBatchSize}${c.reset} (+${Math.round((newBatchSize/currentBatchSize - 1) * 100)}%)`);
        console.log(`  ${c.cyan}Throttle:${c.reset}     ${c.brightGreen}-20%${c.reset} delay reduction`);
        console.log(`${c.dim}─────────────────────────────────────────${c.reset}`);
        console.log(`${c.yellow}Note: Restart embedding server for changes to take effect.${c.reset}`);
        console.log(`${c.dim}Run: ${c.cyan}embedding restart${c.reset} ${c.dim}or wait for auto-restart${c.reset}`);
        break;
      }

      case 'false':
      case 'off':
      case '0':
      case 'disable': {
        // Disable heavy ops mode
        if (!config.heavyOps?.enabled) {
          console.log(`${c.yellow}Heavy Ops Mode is already disabled.${c.reset}`);
          break;
        }

        const originalBatchSize = config.heavyOps.originalBatchSize || 16;
        config.embedding = config.embedding || {};
        config.embedding.batchSize = originalBatchSize;
        config.heavyOps = { enabled: false, disabledAt: new Date().toISOString() };

        // Write config
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        console.log(`${c.yellow}${icons.warning} Heavy Ops Mode DISABLED${c.reset}`);
        console.log(`${c.dim}─────────────────────────────────────────${c.reset}`);
        console.log(`  ${c.cyan}Batch Size:${c.reset}   Restored to ${c.white}${originalBatchSize}${c.reset}`);
        console.log(`  ${c.cyan}Throttle:${c.reset}     Normal delays restored`);
        console.log(`${c.dim}─────────────────────────────────────────${c.reset}`);
        console.log(`${c.dim}Embedding server will use normal settings on next restart.${c.reset}`);
        break;
      }

      case 'status':
      default: {
        const isEnabled = config.heavyOps?.enabled === true;
        const batchSize = config.embedding?.batchSize || 16;

        console.log(`${c.cyan}Heavy Ops Mode Status:${c.reset}`);
        console.log(`${c.dim}─────────────────────────────────────────${c.reset}`);
        console.log(`  ${c.cyan}Status:${c.reset}       ${isEnabled ? `${c.brightGreen}ENABLED${c.reset}` : `${c.dim}Disabled${c.reset}`}`);
        console.log(`  ${c.cyan}Batch Size:${c.reset}   ${batchSize}`);
        if (isEnabled) {
          console.log(`  ${c.cyan}Original:${c.reset}     ${config.heavyOps.originalBatchSize || 'N/A'}`);
          console.log(`  ${c.cyan}Multiplier:${c.reset}   ${config.heavyOps.batchSizeMultiplier || 2}x`);
          console.log(`  ${c.cyan}Throttle:${c.reset}     -${Math.round((config.heavyOps.throttleReduction || 0.20) * 100)}%`);
          console.log(`  ${c.cyan}Enabled At:${c.reset}   ${config.heavyOps.enabledAt || 'N/A'}`);
        }
        console.log(`${c.dim}─────────────────────────────────────────${c.reset}`);
        console.log(`${c.dim}Commands: ${c.cyan}heavyops true${c.reset}${c.dim} | ${c.cyan}heavyops false${c.reset}`);
        break;
      }
    }
  }

  /**
   * Handle power command - set power mode (low/medium/high)
   * Controls resource usage and optimizations for the embedding server.
   * Persists in user-config.json across restarts and version updates.
   *
   * Modes:
   *   LOW (default): Lazy loading, disk cache, aggressive cleanup (2min idle)
   *   MEDIUM:        Lazy loading, disk cache, moderate cleanup (5min idle)
   *   HIGH:          Immediate loading, RAM only, no cleanup (max performance)
   */
  async handlePowerCommand(args) {
    const subCmd = args[0]?.toLowerCase() || 'status';
    const userConfigPath = path.join(this.projectPath, 'specmem', 'user-config.json');
    const modelConfigPath = path.join(this.projectPath, 'specmem', 'model-config.json');

    // Load current user config (persists across updates)
    let userConfig = {};
    try {
      if (fs.existsSync(userConfigPath)) {
        userConfig = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
      }
    } catch (e) {
      // Start fresh
    }

    // Load model config for syncing
    let modelConfig = {};
    try {
      if (fs.existsSync(modelConfigPath)) {
        modelConfig = JSON.parse(fs.readFileSync(modelConfigPath, 'utf8'));
      }
    } catch (e) {
      // Start fresh
    }

    const currentLevel = userConfig.powerMode?.level || 'low';

    // Power mode settings - includes embedding server + batch/throttle settings
    const POWER_MODES = {
      low: {
        level: 'low',
        description: 'Conservative - for <8GB RAM systems',
        lazyLoading: true,
        diskCache: true,
        diskCacheMaxMb: 300,
        aggressiveCleanup: true,
        idleUnloadSeconds: 120,
        // Batch/throttle settings
        batchSize: 8,
        throttleDelayMs: 200
      },
      medium: {
        level: 'medium',
        description: 'Balanced - for 8-16GB RAM systems',
        lazyLoading: true,
        diskCache: true,
        diskCacheMaxMb: 500,
        aggressiveCleanup: true,
        idleUnloadSeconds: 300,
        // Batch/throttle settings
        batchSize: 16,
        throttleDelayMs: 100
      },
      high: {
        level: 'high',
        description: 'Max Performance - for 16GB+ RAM systems',
        lazyLoading: false,
        diskCache: false,
        diskCacheMaxMb: 0,
        aggressiveCleanup: false,
        idleUnloadSeconds: 0,
        // Batch/throttle settings
        batchSize: 32,
        throttleDelayMs: 50
      }
    };

    switch (subCmd) {
      case 'low':
      case 'medium':
      case 'high': {
        const newMode = POWER_MODES[subCmd];

        // Update user config (persists across updates)
        userConfig.powerMode = {
          ...newMode,
          setAt: new Date().toISOString()
        };

        // Also update model config for immediate use
        modelConfig.powerMode = {
          ...newMode,
          setAt: new Date().toISOString()
        };

        // Also set embedding batch size based on power mode
        modelConfig.embedding = modelConfig.embedding || {};
        modelConfig.embedding.batchSize = newMode.batchSize;
        modelConfig.embedding.throttleDelayMs = newMode.throttleDelayMs;

        // Write configs
        fs.mkdirSync(path.dirname(userConfigPath), { recursive: true });
        fs.writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2));
        fs.writeFileSync(modelConfigPath, JSON.stringify(modelConfig, null, 2));

        const modeColors = { low: c.yellow, medium: c.cyan, high: c.brightGreen };
        const modeColor = modeColors[subCmd] || c.white;

        console.log(`${c.green}${icons.success} Power Mode: ${modeColor}${subCmd.toUpperCase()}${c.reset}`);
        console.log(`${c.dim}─────────────────────────────────────────${c.reset}`);
        console.log(`  ${c.cyan}Mode:${c.reset}         ${modeColor}${subCmd.toUpperCase()}${c.reset}`);
        console.log(`  ${c.cyan}Description:${c.reset}  ${newMode.description}`);
        console.log(`${c.dim}─────────────────────────────────────────${c.reset}`);
        console.log(`  ${c.cyan}Lazy Loading:${c.reset}      ${newMode.lazyLoading ? `${c.brightGreen}ON${c.reset}` : `${c.dim}OFF${c.reset}`}`);
        console.log(`  ${c.cyan}Disk Cache:${c.reset}        ${newMode.diskCache ? `${c.brightGreen}ON${c.reset} (${newMode.diskCacheMaxMb}MB)` : `${c.dim}OFF${c.reset}`}`);
        console.log(`  ${c.cyan}Idle Cleanup:${c.reset}      ${newMode.aggressiveCleanup ? `${c.brightGreen}ON${c.reset} (${newMode.idleUnloadSeconds}s)` : `${c.dim}OFF${c.reset}`}`);
        console.log(`  ${c.cyan}Batch Size:${c.reset}        ${newMode.batchSize}`);
        console.log(`  ${c.cyan}Throttle Delay:${c.reset}    ${newMode.throttleDelayMs}ms`);
        console.log(`${c.dim}─────────────────────────────────────────${c.reset}`);
        console.log(`${c.yellow}Note: Restart embedding server for changes to take effect.${c.reset}`);
        console.log(`${c.dim}Run: ${c.cyan}embedding restart${c.reset} ${c.dim}or wait for auto-restart${c.reset}`);
        break;
      }

      case 'status':
      default: {
        const currentMode = POWER_MODES[currentLevel] || POWER_MODES.low;
        const modeColors = { low: c.yellow, medium: c.cyan, high: c.brightGreen };
        const modeColor = modeColors[currentLevel] || c.white;

        // Get actual batch size from model config (may differ from mode default)
        const actualBatchSize = modelConfig.embedding?.batchSize || currentMode.batchSize;
        const actualThrottle = modelConfig.embedding?.throttleDelayMs || currentMode.throttleDelayMs;

        console.log(`${c.cyan}Power Mode Status:${c.reset}`);
        console.log(`${c.dim}─────────────────────────────────────────${c.reset}`);
        console.log(`  ${c.cyan}Current Mode:${c.reset}  ${modeColor}${currentLevel.toUpperCase()}${c.reset}`);
        console.log(`  ${c.cyan}Description:${c.reset}   ${currentMode.description}`);
        console.log(`${c.dim}─────────────────────────────────────────${c.reset}`);
        console.log(`  ${c.cyan}Lazy Loading:${c.reset}      ${currentMode.lazyLoading ? `${c.brightGreen}ON${c.reset}` : `${c.dim}OFF${c.reset}`}`);
        console.log(`  ${c.cyan}Disk Cache:${c.reset}        ${currentMode.diskCache ? `${c.brightGreen}ON${c.reset} (${currentMode.diskCacheMaxMb}MB)` : `${c.dim}OFF${c.reset}`}`);
        console.log(`  ${c.cyan}Idle Cleanup:${c.reset}      ${currentMode.aggressiveCleanup ? `${c.brightGreen}ON${c.reset} (${currentMode.idleUnloadSeconds}s)` : `${c.dim}OFF${c.reset}`}`);
        console.log(`  ${c.cyan}Batch Size:${c.reset}        ${actualBatchSize}`);
        console.log(`  ${c.cyan}Throttle Delay:${c.reset}    ${actualThrottle}ms`);
        if (userConfig.powerMode?.setAt) {
          console.log(`  ${c.cyan}Set At:${c.reset}            ${userConfig.powerMode.setAt}`);
        }
        console.log(`${c.dim}─────────────────────────────────────────${c.reset}`);
        console.log(`${c.dim}Commands: ${c.cyan}power low${c.reset}${c.dim} | ${c.cyan}power medium${c.reset}${c.dim} | ${c.cyan}power high${c.reset}`);
        break;
      }
    }
  }

  /**
   * Handle resource control commands - CPU and RAM limits
   * Persisted to model-config.json and respected by embedding server
   */
  async handleResourcesCommand(args) {
    const subCmd = args[0]?.toLowerCase() || 'status';
    const value = args[1];
    const configPath = path.join(this.projectPath, 'specmem', 'model-config.json');

    // Load current config
    let config = {};
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (e) {
      console.log(`${c.yellow}Could not read config: ${e.message}${c.reset}`);
    }

    // Initialize resources section if not exists
    config.resources = config.resources || {
      cpuMin: 20,    // 20% minimum target
      cpuMax: 40,    // 40% max limit
      ramMinMb: 4000, // 4GB minimum
      ramMaxMb: 6000  // 6GB max
    };

    const saveConfig = () => {
      config.resources.updatedAt = new Date().toISOString();
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    };

    switch (subCmd) {
      case 'cpumin': {
        const pct = parseInt(value);
        if (isNaN(pct) || pct < 0 || pct > 100) {
          console.log(`${c.red}${icons.error} Invalid CPU percentage. Use 0-100.${c.reset}`);
          break;
        }
        config.resources.cpuMin = pct;
        saveConfig();
        console.log(`${c.green}${icons.success} CPU Min set to ${pct}%${c.reset}`);
        break;
      }

      case 'cpumax': {
        const pct = parseInt(value);
        if (isNaN(pct) || pct < 0 || pct > 100) {
          console.log(`${c.red}${icons.error} Invalid CPU percentage. Use 0-100.${c.reset}`);
          break;
        }
        config.resources.cpuMax = pct;
        saveConfig();
        console.log(`${c.green}${icons.success} CPU Max set to ${pct}%${c.reset}`);
        break;
      }

      case 'rammin': {
        const mb = parseInt(value);
        if (isNaN(mb) || mb < 100) {
          console.log(`${c.red}${icons.error} Invalid RAM value. Use MB >= 100.${c.reset}`);
          break;
        }
        config.resources.ramMinMb = mb;
        saveConfig();
        console.log(`${c.green}${icons.success} RAM Min set to ${mb}MB${c.reset}`);
        break;
      }

      case 'rammax': {
        const mb = parseInt(value);
        if (isNaN(mb) || mb < 256) {
          console.log(`${c.red}${icons.error} Invalid RAM value. Use MB >= 256.${c.reset}`);
          break;
        }
        config.resources.ramMaxMb = mb;
        saveConfig();
        console.log(`${c.green}${icons.success} RAM Max set to ${mb}MB${c.reset}`);
        break;
      }

      case 'status':
      default: {
        const r = config.resources;
        console.log(`${c.cyan}Resource Limits:${c.reset}`);
        console.log(`${c.dim}─────────────────────────────────────────${c.reset}`);
        console.log(`  ${c.cyan}CPU Min:${c.reset}      ${r.cpuMin}%`);
        console.log(`  ${c.cyan}CPU Max:${c.reset}      ${r.cpuMax}%`);
        console.log(`  ${c.cyan}RAM Min:${c.reset}      ${r.ramMinMb}MB`);
        console.log(`  ${c.cyan}RAM Max:${c.reset}      ${r.ramMaxMb}MB`);
        if (r.updatedAt) {
          console.log(`  ${c.dim}Updated:${c.reset}      ${r.updatedAt}`);
        }
        console.log(`${c.dim}─────────────────────────────────────────${c.reset}`);
        console.log(`${c.dim}Commands: cpumin <n>, cpumax <n>, rammin <mb>, rammax <mb>${c.reset}`);
        break;
      }
    }
  }

  /**
   * Auto-fix emoji support for Linux/XFCE
   */
  async fixTerminalEmoji() {
    if (process.platform !== 'linux') {
      console.log(`${c.yellow}${icons.warning} This fix is for Linux systems only${c.reset}`);
      console.log(`${c.dim}On macOS, emojis should work out of the box.${c.reset}`);
      return;
    }

    console.log(`${c.cyan}Checking emoji font status...${c.reset}`);

    // Check if emoji fonts are installed
    let hasEmojiFont = false;
    try {
      const fontList = execSync('fc-list 2>/dev/null || true', { encoding: 'utf8' });
      hasEmojiFont = fontList.includes('Noto Color Emoji') ||
                     fontList.includes('EmojiOne') ||
                     fontList.includes('Twemoji') ||
                     fontList.includes('Symbola');
    } catch (e) {}

    if (hasEmojiFont) {
      console.log(`${c.green}${icons.success} Emoji fonts already installed!${c.reset}`);
      console.log(`${c.dim}If emojis still don't show, try:${c.reset}`);
      console.log(`  1. Restart your terminal`);
      console.log(`  2. Set terminal font to one with emoji support (e.g., "Noto Sans Mono")`);
      console.log(`  3. Run: ${c.cyan}fc-cache -fv${c.reset}`);
      return;
    }

    console.log(`${c.yellow}${icons.warning} No emoji fonts found. Installing...${c.reset}`);

    try {
      // Check for sudo
      try {
        execSync('sudo -n true 2>/dev/null', { stdio: 'ignore' });
      } catch (e) {
        console.log(`${c.dim}Need sudo password for installation...${c.reset}`);
      }

      // Install fonts
      console.log(`${c.dim}Running: sudo apt install fonts-noto-color-emoji fonts-symbola${c.reset}`);
      execSync('sudo apt-get update -qq && sudo apt-get install -y fonts-noto-color-emoji fonts-symbola', {
        stdio: 'inherit',
        timeout: 120000
      });

      // Rebuild font cache
      console.log(`${c.dim}Rebuilding font cache...${c.reset}`);
      execSync('fc-cache -f', { stdio: 'ignore' });

      console.log('');
      console.log(`${c.green}${icons.success} Emoji fonts installed successfully!${c.reset}`);
      console.log(`${c.yellow}${icons.warning} IMPORTANT: Restart your terminal for changes to take effect.${c.reset}`);
      console.log('');
      console.log(`${c.dim}After restart, run '${c.cyan}terminal test${c.reset}${c.dim}' to verify.${c.reset}`);

    } catch (e) {
      console.log(`${c.red}${icons.error} Installation failed: ${e.message}${c.reset}`);
      console.log('');
      console.log(`${c.dim}Manual installation:${c.reset}`);
      console.log(`  ${c.cyan}sudo apt install fonts-noto-color-emoji fonts-symbola${c.reset}`);
      console.log(`  ${c.cyan}fc-cache -fv${c.reset}`);
    }
  }

  /**
   * DIE command - complete shutdown of SpecMem and Claude in this project
   * Stops Claude session, Brain screen, Docker embedding containers, cleans up
   */
  async handleDieCommand() {
    console.log(`${c.brightRed}${c.bold}☠️  SPECMEM DIE COMMAND ☠️${c.reset}`);
    console.log(`${c.dim}Shutting down ALL SpecMem components for this project...${c.reset}`);
    console.log('');

    let killed = 0;

    // 1. Stop Claude session
    if (this.claude.claudeSession) {
      console.log(`${c.yellow}[1/5]${c.reset} Stopping Claude session: ${c.cyan}${this.claude.claudeSession}${c.reset}`);
      try {
        execSync(`screen -S "${this.claude.claudeSession}" -X quit 2>/dev/null || true`, { stdio: 'ignore' });
        console.log(`  ${c.green}${icons.success}${c.reset} Claude stopped`);
        killed++;
      } catch (e) {
        console.log(`  ${c.dim}(not running)${c.reset}`);
      }
    } else {
      console.log(`${c.yellow}[1/5]${c.reset} Claude session: ${c.dim}not detected${c.reset}`);
    }

    // 2. Stop Brain screen session
    const brainSession = `specmem-brain-${this.projectId}`;
    console.log(`${c.yellow}[2/5]${c.reset} Stopping Brain session: ${c.cyan}${brainSession}${c.reset}`);
    try {
      const screenList = execSync('screen -ls 2>/dev/null || true', { encoding: 'utf8' });
      if (screenList.includes(brainSession) || screenList.includes('specmem-brain')) {
        execSync(`screen -S "${brainSession}" -X quit 2>/dev/null || true`, { stdio: 'ignore' });
        // Also try the generic name
        execSync('screen -ls 2>/dev/null | grep specmem-brain | cut -d. -f1 | xargs -r -n1 screen -S -X quit 2>/dev/null || true', { stdio: 'ignore' });
        console.log(`  ${c.green}${icons.success}${c.reset} Brain stopped`);
        killed++;
      } else {
        console.log(`  ${c.dim}(not running)${c.reset}`);
      }
    } catch (e) {
      console.log(`  ${c.dim}(not running)${c.reset}`);
    }

    // 3. Stop Docker embedding containers for this project
    console.log(`${c.yellow}[3/5]${c.reset} Stopping Docker embedding containers...`);
    try {
      // Filter by project socket path label (more reliable than user ID)
      const socketPath = path.join(this.projectPath, 'specmem', 'sockets', 'embeddings.sock');
      const containers = execSync(`docker ps -q --filter "label=specmem.socket=${socketPath}" 2>/dev/null || true`, { encoding: 'utf8' }).trim();
      if (containers) {
        execSync(`docker stop ${containers.split('\n').join(' ')} 2>/dev/null || true`, { stdio: 'ignore' });
        execSync(`docker rm ${containers.split('\n').join(' ')} 2>/dev/null || true`, { stdio: 'ignore' });
        console.log(`  ${c.green}${icons.success}${c.reset} Docker containers stopped`);
        killed++;
      } else {
        // Fallback: try matching by container name pattern
        const projectHash = crypto.createHash('md5').update(this.projectPath).digest('hex').slice(0, 8);
        const fallback = execSync(`docker ps -q --filter "name=specmem-embedding.*${projectHash}" 2>/dev/null || true`, { encoding: 'utf8' }).trim();
        if (fallback) {
          execSync(`docker stop ${fallback.split('\n').join(' ')} 2>/dev/null || true`, { stdio: 'ignore' });
          execSync(`docker rm ${fallback.split('\n').join(' ')} 2>/dev/null || true`, { stdio: 'ignore' });
          console.log(`  ${c.green}${icons.success}${c.reset} Docker containers stopped (by hash)`);
          killed++;
        } else {
          console.log(`  ${c.dim}(no containers found)${c.reset}`);
        }
      }
    } catch (e) {
      console.log(`  ${c.dim}(Docker not available or no containers)${c.reset}`);
    }

    // 4. Clean up socket files
    console.log(`${c.yellow}[4/5]${c.reset} Cleaning up sockets...`);
    const socketsDir = path.join(this.projectPath, 'specmem', 'sockets');
    try {
      const socketFiles = ['embeddings.sock', 'embedding.pid', 'embedding.lock', 'claude-input-state.json'];
      let cleaned = 0;
      for (const f of socketFiles) {
        const fp = path.join(socketsDir, f);
        if (fs.existsSync(fp)) {
          fs.unlinkSync(fp);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        console.log(`  ${c.green}${icons.success}${c.reset} Cleaned ${cleaned} socket files`);
      } else {
        console.log(`  ${c.dim}(no sockets to clean)${c.reset}`);
      }
    } catch (e) {
      console.log(`  ${c.dim}(cleanup error: ${e.message})${c.reset}`);
    }

    // 5. Kill any orphan node/specmem processes for this project
    console.log(`${c.yellow}[5/5]${c.reset} Killing orphan processes...`);
    try {
      // Kill specmem-init processes for this project
      const initKilled = execSync(`pgrep -f "specmem-init.cjs" 2>/dev/null || true`, { encoding: 'utf8' }).trim();
      if (initKilled) {
        for (const pid of initKilled.split('\n').filter(p => p)) {
          try {
            // Check if this init is for our project
            const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
            if (cwd === this.projectPath) {
              process.kill(parseInt(pid, 10), 'SIGTERM');
              console.log(`  ${c.green}${icons.success}${c.reset} Killed init PID ${pid}`);
              killed++;
            }
          } catch (e) { /* process gone or wrong project */ }
        }
      }
      // Kill any other specmem-related processes
      execSync(`pkill -f "specmem-console.*${this.projectPath}" 2>/dev/null || true`, { stdio: 'ignore' });
      execSync(`pkill -f "node.*specmem.*${this.projectPath}" 2>/dev/null || true`, { stdio: 'ignore' });
      console.log(`  ${c.green}${icons.success}${c.reset} Orphan processes killed`);
    } catch (e) {
      console.log(`  ${c.dim}(no orphans found)${c.reset}`);
    }

    console.log('');
    console.log(`${c.brightRed}${c.bold}☠️  SPECMEM KILLED ☠️${c.reset}`);
    console.log(`${c.dim}All SpecMem components for ${this.projectPath} have been terminated.${c.reset}`);
    console.log(`${c.dim}Run ${c.cyan}specmem-init${c.reset}${c.dim} to restart.${c.reset}`);
    console.log('');

    // Exit the console
    this.running = false;
    process.exit(0);
  }

  /**
   * Handle Claude subcommands
   */
  async handleClaudeCommand(args) {
    const subCmd = args[0]?.toLowerCase();

    switch (subCmd) {
      case 'start':
        const prompt = args.slice(1).join(' ');
        this.claude.start(prompt || null);
        break;

      case 'stop':
        this.claude.stop();
        break;

      case 'restart':
        this.claude.stop();
        await new Promise(r => setTimeout(r, 1000));
        this.claude.start();
        break;

      case 'status':
        if (this.claude.isRunning()) {
          console.log(`${c.green}${icons.success} Claude is running (${this.claude.claudeSession})${c.reset}`);
          if (this.claude.isWaitingForPermission()) {
            console.log(`${c.yellow}${icons.warning} Waiting for permission response${c.reset}`);
          }
        } else {
          console.log(`${c.dim}Claude is not running${c.reset}`);
        }
        break;

      case 'attach':
        this.claude.attach();
        break;

      case 'send':
        const text = args.slice(1).join(' ');
        if (!text) {
          console.log(`${c.yellow}Usage: claude send <text>${c.reset}`);
        } else if (this.claude.send(text)) {
          console.log(`${c.green}${icons.success} Sent${c.reset}`);
        } else {
          console.log(`${c.red}${icons.error} Failed to send${c.reset}`);
        }
        break;

      case 'read':
        const output = this.claude.read(parseInt(args[1]) || 30);
        if (output) {
          console.log(`${c.dim}─── Claude Output ───${c.reset}`);
          console.log(output);
          console.log(`${c.dim}─────────────────────${c.reset}`);
        } else {
          console.log(`${c.dim}No output available${c.reset}`);
        }
        break;

      default:
        console.log(`${c.cyan}Claude subcommands:${c.reset}`);
        console.log(`  start [prompt]  - Start Claude`);
        console.log(`  stop            - Stop Claude`);
        console.log(`  restart         - Restart Claude`);
        console.log(`  status          - Check status`);
        console.log(`  attach          - Attach to session`);
        console.log(`  send <text>     - Send text`);
        console.log(`  read [lines]    - Read output`);
    }
  }

  /**
   * Handle AutoClaude command
   */
  async handleAutoClaudeCommand(args) {
    if (args.length === 0) {
      console.log(`${c.cyan}Usage: autoclaude <prompt> [duration]${c.reset}`);
      console.log(`${c.dim}Duration format: 1:30 = 1 hour 30 minutes (default: 0:30)${c.reset}`);
      return;
    }

    // Parse duration if last arg looks like time
    let duration = '0:30'; // Default 30 minutes
    let prompt = args.join(' ');

    const lastArg = args[args.length - 1];
    if (/^\d+:\d+$/.test(lastArg)) {
      duration = lastArg;
      prompt = args.slice(0, -1).join(' ');
    }

    console.log(`${c.cyan}Starting AutoClaude...${c.reset}`);
    console.log(`${c.dim}Prompt: ${prompt}${c.reset}`);
    console.log(`${c.dim}Duration: ${duration}${c.reset}`);

    try {
      const autoclaude = spawn('node', [
        path.join(__dirname, 'specmem-autoclaude.cjs'),
        this.projectPath,
        prompt,
        duration
      ], {
        stdio: 'inherit',
        detached: false
      });

      autoclaude.on('exit', (code) => {
        console.log(`${code === 0 ? c.green + icons.success : c.red + icons.error}${c.reset} AutoClaude finished (exit code: ${code})`);
      });
    } catch (e) {
      console.log(`${c.red}${icons.error} Failed to start AutoClaude: ${e.message}${c.reset}`);
    }
  }

  /**
   * Handle cleanup subcommands
   * Manage all running screen sessions for this project
   */
  async handleCleanupCommand(args) {
    const subCmd = args[0]?.toLowerCase() || 'list';

    // Get all project screens
    const projectScreens = this.getProjectScreens();

    switch (subCmd) {
      case 'list':
      case 'ls':
        if (projectScreens.length === 0) {
          console.log(`${c.dim}No active screens for this project${c.reset}`);
          return;
        }
        console.log(`${c.cyan}Active screens for ${this.projectId}:${c.reset}`);
        projectScreens.forEach((s, i) => {
          const type = s.name.startsWith('specmem-') ? `${icons.brain} Brain` : `${icons.robot} Claude`;
          const statusColor = s.status === 'attached' ? c.green : c.yellow;
          console.log(`  ${i + 1}. ${type}  ${c.white}${s.name}${c.reset} ${statusColor}(${s.status})${c.reset}`);
        });
        console.log('');
        console.log(`${c.dim}Commands: cleanup all | cleanup claude | cleanup brain | cleanup <number>${c.reset}`);
        break;

      case 'all':
        if (projectScreens.length === 0) {
          console.log(`${c.dim}No screens to clean up${c.reset}`);
          return;
        }
        console.log(`${c.yellow}Stopping ${projectScreens.length} screen(s)...${c.reset}`);
        for (const screen of projectScreens) {
          if (screen.name.startsWith('claude-')) {
            // Save progress for Claude screens
            this.claude.stop(); // This saves progress
          } else {
            screenKill(screen.name);
            console.log(`${c.green}${icons.success} Stopped: ${screen.name}${c.reset}`);
          }
        }
        break;

      case 'claude':
        const claudeScreens = projectScreens.filter(s => s.name.startsWith('claude-'));
        if (claudeScreens.length === 0) {
          console.log(`${c.dim}No Claude screens running${c.reset}`);
          return;
        }
        for (const screen of claudeScreens) {
          this.claude.stop(); // Saves progress and stops
        }
        break;

      case 'brain':
        const brainScreens = projectScreens.filter(s => s.name.startsWith('specmem-'));
        if (brainScreens.length === 0) {
          console.log(`${c.dim}No brain screens running${c.reset}`);
          return;
        }
        for (const screen of brainScreens) {
          screenKill(screen.name);
          console.log(`${c.green}${icons.success} Stopped: ${screen.name}${c.reset}`);
        }
        console.log(`${c.yellow}${icons.warning} Brain stopped - you may need to close this terminal${c.reset}`);
        break;

      default:
        // Try as number
        const num = parseInt(subCmd);
        if (!isNaN(num) && num >= 1 && num <= projectScreens.length) {
          const target = projectScreens[num - 1];
          if (target.name.startsWith('claude-')) {
            this.claude.stop();
          } else {
            screenKill(target.name);
            console.log(`${c.green}${icons.success} Stopped: ${target.name}${c.reset}`);
          }
        } else {
          console.log(`${c.yellow}Usage: cleanup [list|all|claude|brain|<number>]${c.reset}`);
        }
    }
  }

  /**
   * Health monitor - detects token limits and crashes
   * Returns: { status: 'healthy'|'warning'|'critical'|'dead', message, contextPercent? }
   */
  checkHealth() {
    const claudeSession = this.claude.claudeSession;
    const logFile = getScreenLogPath(this.projectPath);

    // 1. Check if screen session exists
    try {
      const screens = execSync('screen -ls 2>&1 || true', { encoding: 'utf8' });
      if (!screens.includes(claudeSession)) {
        return { status: 'dead', message: 'Session not found' };
      }
      // Check for zombie state
      if (screens.includes('Dead')) {
        return { status: 'dead', message: 'Session in zombie state' };
      }
    } catch (e) {
      return { status: 'dead', message: 'Cannot check screen status' };
    }

    // 2. Test if responsive (hardcopy test)
    try {
      execSync(`screen -S ${claudeSession} -X hardcopy -h /tmp/specmem-health-check 2>/dev/null`, { timeout: 5000 });
    } catch (e) {
      return { status: 'dead', message: 'Session unresponsive' };
    }

    // 3. Check recent output for context warnings (read last 100 lines, wipe older)
    let recentOutput = readAndTruncateLog(logFile, 100) || '';

    // Also check screen output
    const screenResult = screenRead(claudeSession, 50);
    const screenOutput = screenResult.content || '';
    const combinedOutput = recentOutput + '\n' + screenOutput;

    // Critical patterns
    if (/COMPACTION IMMINENT|MAXIMUM COMPRESSION|context limit|out of context/i.test(combinedOutput)) {
      return { status: 'critical', message: 'Context limit reached - save now!' };
    }

    // Warning patterns
    if (/conversation is getting long|Context usage: [89][0-9]%/i.test(combinedOutput)) {
      // Try to extract percentage
      const match = combinedOutput.match(/Context usage: (\d+)%/);
      return {
        status: 'warning',
        message: 'Context getting full',
        contextPercent: match ? parseInt(match[1]) : null
      };
    }

    // Extract context percentage if available
    const percentMatch = combinedOutput.match(/Context usage: (\d+)%/);

    return {
      status: 'healthy',
      message: 'Claude running normally',
      contextPercent: percentMatch ? parseInt(percentMatch[1]) : null
    };
  }

  /**
   * Start background health monitor
   */
  startHealthMonitor(intervalMs = 30000) {
    if (this.healthInterval) {
      console.log(`${c.yellow}Health monitor already running${c.reset}`);
      return;
    }

    console.log(`${c.cyan}Starting health monitor (every ${intervalMs/1000}s)${c.reset}`);

    this.healthInterval = setInterval(() => {
      if (!this.claude.isRunning()) {
        // Claude died - auto-recover
        console.log(`\n${c.red}${icons.warning} ALERT: Claude session died!${c.reset}`);
        this.recoverFromCrash();
        return;
      }

      const health = this.checkHealth();

      if (health.status === 'critical') {
        console.log(`\n${c.bgRed}${c.white} ${icons.critical} CRITICAL: ${health.message} ${c.reset}`);
        console.log(`${c.yellow}Auto-saving progress...${c.reset}`);
        this.claude.saveProgress('auto_critical');
      } else if (health.status === 'warning') {
        console.log(`\n${c.yellow}${icons.warning} WARNING: ${health.message}${health.contextPercent ? ` (${health.contextPercent}%)` : ''}${c.reset}`);
      } else if (health.status === 'dead') {
        console.log(`\n${c.red}${icons.dead} DEAD: ${health.message}${c.reset}`);
        this.recoverFromCrash();
      }
      // Healthy - stay silent
    }, intervalMs);

    console.log(`${c.green}${icons.success} Health monitor started${c.reset}`);
  }

  /**
   * Stop health monitor
   */
  stopHealthMonitor() {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
      console.log(`${c.dim}Health monitor stopped${c.reset}`);
    }
  }

  /**
   * Recover session from crash - reads log file and saves for next session
   */
  recoverFromCrash() {
    const logFile = getScreenLogPath(this.projectPath);
    const lastSessionFile = path.join(this.projectPath, 'specmem', 'sockets', 'last-session.txt');
    const trackingDir = path.join(this.projectPath, 'claudeProgressTracking');

    if (!fs.existsSync(logFile)) {
      console.log(`${c.yellow}${icons.warning} No crash log found at: ${logFile}${c.reset}`);
      console.log(`${c.dim}Claude must have been started with logging enabled${c.reset}`);
      return null;
    }

    console.log(`${c.cyan}Recovering from crash log...${c.reset}`);

    try {
      // Read last 500 lines and wipe older content
      const last500 = readAndTruncateLog(logFile, 500);
      if (!last500) {
        console.log(`${c.yellow}${icons.warning} Could not read log file${c.reset}`);
        return null;
      }

      // Check log age
      const stats = fs.statSync(logFile);
      const ageMinutes = Math.round((Date.now() - stats.mtimeMs) / 60000);

      console.log(`${c.dim}Log age: ${ageMinutes} minutes${c.reset}`);

      // Build recovery content
      const content = `# Claude Session CRASH RECOVERY
# ==============================
# Project: ${this.projectPath}
# Session: ${this.claudeSession}
# Recovered: ${new Date().toISOString()}
# Log age: ${ageMinutes} minutes
# Reason: crash_recovery
#
# Last 500 lines from screen log:
# ================================

${last500}

# ================================
# End of crash recovery
`;

      // Ensure directories exist
      fs.mkdirSync(trackingDir, { recursive: true });
      fs.mkdirSync(path.dirname(lastSessionFile), { recursive: true });

      // Save to archive
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
      const archiveFile = path.join(trackingDir, `claude-session-${timestamp}-crash.txt`);
      fs.writeFileSync(archiveFile, content, 'utf8');
      console.log(`${c.green}${icons.success} Archive: ${path.basename(archiveFile)}${c.reset}`);

      // Save for next session injection
      fs.writeFileSync(lastSessionFile, content, 'utf8');
      console.log(`${c.green}${icons.success} Saved for next session: last-session.txt${c.reset}`);

      // Offer to restart Claude
      console.log('');
      console.log(`${c.cyan}Recovery complete. Use 'claude start' to restart with continuity.${c.reset}`);

      return archiveFile;
    } catch (e) {
      console.log(`${c.red}${icons.error} Recovery failed: ${e.message}${c.reset}`);
      return null;
    }
  }

  /**
   * Get all screens for current project
   */
  getProjectScreens() {
    try {
      const output = execSync('screen -ls 2>/dev/null || true', { encoding: 'utf8' });
      const screens = [];
      const lines = output.split('\n');

      for (const line of lines) {
        const match = line.match(/^\s*(\d+)\.([^\s]+)\s+\(([^)]+)\)/);
        if (match) {
          const name = match[2];
          // Only include screens for this project
          if (name.startsWith(`claude-${this.projectId}`) ||
              name.startsWith(`specmem-${this.projectId}`)) {
            screens.push({
              pid: match[1],
              name: name,
              status: match[3].toLowerCase()
            });
          }
        }
      }
      return screens;
    } catch (e) {
      return [];
    }
  }

  /**
   * Start the interactive console
   */

  /**
   * Enhanced Dashboard Mode - Interactive command line with history and tab completion
   * Features:
   * - Command history (up/down arrows to navigate)
   * - Tab completion for common commands (find, code, status, help, clear)
   * - Scrollable left panel showing command output (last 100 lines)
   * - Ctrl+L to clear display while preserving history
   */
  /**
   * Dashboard TUI with 4-quadrant split pane rendering
   * TOP LEFT: Live Claude screen preview
   * BOTTOM LEFT: SpecMem command console
   * TOP RIGHT: MCP tool calls
   * BOTTOM RIGHT: Pythia COT (chain of thought)
   */
  enterDashboardMode() {
    // Capture 'this' for use in keyHandler callback (where 'this' context is lost)
    const self = this;
    const logFile = getScreenLogPath(self.projectPath);
    const useAltBuffer = termCaps.isTTY && !termCaps.safeMode;

    if (useAltBuffer) {
      process.stdout.write('\x1b[?1049h');
      process.stdout.write('\x1b[?25l');
    }

    let running = true;
    let commandHistory = [];
    const maxCommandHistory = 20;

    // MCP Tool history - persists across draws
    const toolHistory = [];
    const maxToolHistory = 50;
    let lastLogPosition = 0; // Track where we left off in log

    // Helper to detect new tool calls since last check
    const detectNewToolCalls = (logContent) => {
      const newContent = logContent.substring(lastLogPosition);
      lastLogPosition = logContent.length;

      const newCalls = [];
      const patterns = [
        /<invoke name="([^"]+)">/g,
        /mcp__[a-z_]+__([a-z_]+)/gi,
      ];

      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(newContent)) !== null) {
          newCalls.push({
            name: match[1],
            timestamp: new Date()
          });
        }
      }

      // Add to history
      for (const call of newCalls) {
        // Avoid duplicates within 2 seconds
        const isDupe = toolHistory.some(h =>
          h.name === call.name &&
          Math.abs(h.timestamp.getTime() - call.timestamp.getTime()) < 2000
        );
        if (!isDupe) {
          toolHistory.unshift(call);
          if (toolHistory.length > maxToolHistory) {
            toolHistory.pop();
          }
        }
      }
    };

    // Drawing lock to prevent overlapping async draws (race condition fix)
    let isDrawing = false;

    // Previous frame buffer for differential rendering - CHARACTER-LEVEL diffing
    let previousFrameLines = [];
    let previousStrippedLines = []; // ANSI-stripped for comparison

    // Strip ANSI codes for content comparison
    const stripAnsi = (str) => (str || '').replace(/\x1b\[[0-9;]*m/g, '');

    // CHARACTER-LEVEL differential frame write
    // Only updates individual characters that changed, not whole lines
    const writeDiffFrame = (newFrame) => {
      const newLines = newFrame.split('\n');
      const newStripped = newLines.map(stripAnsi);

      // First render or line count changed - full redraw
      if (previousFrameLines.length !== newLines.length) {
        process.stdout.write('\x1b[2J\x1b[H' + newFrame);
        previousFrameLines = newLines;
        previousStrippedLines = newStripped;
        return;
      }

      // Character-level diff - only update chars that changed
      let output = '';
      for (let row = 0; row < newLines.length; row++) {
        const newStrip = newStripped[row] || '';
        const oldStrip = previousStrippedLines[row] || '';

        // Skip entirely unchanged lines
        if (newStrip === oldStrip) continue;

        // Find first and last changed character positions
        let firstDiff = 0;
        let lastDiffNew = newStrip.length - 1;
        let lastDiffOld = oldStrip.length - 1;

        // Find first difference
        while (firstDiff < newStrip.length && firstDiff < oldStrip.length &&
               newStrip[firstDiff] === oldStrip[firstDiff]) {
          firstDiff++;
        }

        // If lengths differ or chars differ, update from firstDiff to end of line
        // Move cursor to (row+1, firstDiff+1), clear to end, write rest of line
        // For simplicity, just rewrite from firstDiff onwards
        if (firstDiff < newStrip.length || newStrip.length !== oldStrip.length) {
          // Get the portion of the styled line from firstDiff onwards
          // We need to output the full styled line but position cursor correctly
          output += `\x1b[${row + 1};${firstDiff + 1}H\x1b[K`;

          // Extract visible portion from firstDiff - need ANSI-aware slicing
          let visiblePos = 0;
          let charIdx = 0;
          const line = newLines[row] || '';

          // Skip to firstDiff visible position
          while (charIdx < line.length && visiblePos < firstDiff) {
            if (line[charIdx] === '\x1b' && line[charIdx + 1] === '[') {
              let j = charIdx + 2;
              while (j < line.length && /[0-9;]/.test(line[j])) j++;
              if (j < line.length) j++;
              charIdx = j;
            } else {
              visiblePos++;
              charIdx++;
            }
          }

          // Output from this position onwards
          output += line.substring(charIdx);
        }
      }

      if (output) {
        process.stdout.write(output);
      }

      previousFrameLines = newLines;
      previousStrippedLines = newStripped;
    };

    // ============================================================
    // MODULE MANAGER - Minecraft-style module architecture
    // Each quadrant is its own isolated module with update/render
    // ============================================================
    const moduleManager = new ModuleManager({
      colors: c,
      icons: icons,
      projectPath: self.projectPath
    });

    // Module state getters (will be populated as we initialize state below)
    let moduleGetters = {};

    // Input mode state: 'command' (default), 'claude' (direct to Claude), 'specmem' (SpecMem commands), 'deploy' (agent deployment)
    // Phase 1: Tri-mode input system - command for dashboard control, claude for screen interaction, specmem for memory commands
    let inputMode = 'specmem';           // 'specmem' (default) | 'command' | 'claude' | 'deploy'
    let claudeInputBuffer = '';          // Buffer for claude mode input
    let specmemInputBuffer = '';         // Buffer for specmem mode input
    let deployInputBuffer = '';          // Buffer for deploy mode input
    let deployStep = 0;                  // Current step in deployment flow (0=type, 1=model, 2=task)
    let deployData = {                   // Data collected during deployment
      type: '',
      model: '',
      task: ''
    };

    // ESC key handling for exiting modes
    let escPressCount = 0;               // Track ESC presses for exit from modes
    let escTimeout = null;               // Timeout for ESC double-press detection

    // Help overlay state
    let showHelp = false;

    // Debug mode - logs keypresses to commandHistory when enabled via 'debug' command
    let debugKeyPresses = false;

    // Claude preview caching to prevent flicker
    let lastClaudeContent = '';        // Cache last good content
    let lastClaudeTime = 0;            // Timestamp of last good read
    const claudeReadCooldown = 500;    // Min ms between screen reads
    const MAX_CLAUDE_CONTENT_SIZE = 50000; // Max 50KB cached to prevent RAM bloat

    // Phase 5: Live Embedding & COT Preview - bottom strip state
    const BOTTOM_STRIP_HEIGHT = 6;     // 5 lines + 1 for separator
    let embeddingLogLines = [];        // Last 10 lines from embedding log (show 5)
    let cotLines = [];                 // Last 5 lines of COT/reasoning output
    let embeddingTailProcess = null;   // Process for tailing embedding log
    const MAX_STRIP_LINES = 5;         // Show 5 lines in each strip
    const TAIL_BUFFER_LINES = 10;      // Keep last 10 lines in buffer

    // Start tailing embedding log for live updates
    const startEmbeddingLogTail = () => {
      const embeddingLogPath = path.join(self.projectPath, 'specmem', 'sockets', 'embedding-autostart.log');
      if (!fs.existsSync(embeddingLogPath)) {
        embeddingLogLines = [c.dim + '[No embedding log]' + c.reset];
        return null;
      }
      try {
        const tail = spawn('tail', ['-f', '-n', String(TAIL_BUFFER_LINES), embeddingLogPath], {
          stdio: ['ignore', 'pipe', 'ignore']
        });
        tail.stdout.on('data', (data) => {
          const newLines = data.toString().split('\n').filter(Boolean);
          // Append new lines to buffer and keep last TAIL_BUFFER_LINES
          embeddingLogLines = [...embeddingLogLines, ...newLines].slice(-TAIL_BUFFER_LINES).map(line => {
            if (line.length > 80) return line.substring(0, 77) + '...';
            return line;
          });
        });
        tail.on('error', () => {
          embeddingLogLines = [c.dim + '[Embedding log unavailable]' + c.reset];
        });
        tail.on('close', () => { embeddingTailProcess = null; });
        return tail;
      } catch (e) {
        embeddingLogLines = [c.dim + '[Failed to tail log]' + c.reset];
        return null;
      }
    };

    // Stop tailing embedding log
    const stopEmbeddingLogTail = () => {
      if (embeddingTailProcess) {
        try { embeddingTailProcess.kill(); } catch (e) { /* ignore */ }
        embeddingTailProcess = null;
      }
    };

    // COT Log Tailing - reads from specmem/sockets/cot-stream.log
    // MCP tools broadcast COT to this log file via cotBroadcast.ts
    let cotTailProcess = null;

    const startCotLogTail = () => {
      const cotLogPath = path.join(self.projectPath, 'specmem', 'sockets', 'cot-stream.log');
      if (!fs.existsSync(cotLogPath)) {
        cotLines = [c.dim + '[No COT log - run a search]' + c.reset];
        return null;
      }
      try {
        const tail = spawn('tail', ['-f', '-n', String(TAIL_BUFFER_LINES), cotLogPath], {
          stdio: ['ignore', 'pipe', 'ignore']
        });
        tail.stdout.on('data', (data) => {
          const newLines = data.toString().split('\n').filter(Boolean);
          // Append new lines and keep last TAIL_BUFFER_LINES
          cotLines = [...cotLines.filter(l => !l.includes('[No COT')), ...newLines].slice(-TAIL_BUFFER_LINES).map(line => {
            if (line.length > 80) return line.substring(0, 77) + '...';
            return line;
          });
        });
        tail.on('error', () => {
          cotLines = [c.dim + '[COT log unavailable]' + c.reset];
        });
        tail.on('close', () => { cotTailProcess = null; });
        return tail;
      } catch (e) {
        cotLines = [c.dim + '[Failed to tail COT log]' + c.reset];
        return null;
      }
    };

    const stopCotLogTail = () => {
      if (cotTailProcess) {
        try { cotTailProcess.kill(); } catch (e) { /* ignore */ }
        cotTailProcess = null;
      }
    };

    // Legacy: Parse screen content for COT patterns (backup if log not available)
    const updateCotFromContent = (content) => {
      if (!content || cotTailProcess) return; // Skip if tailing log

      let newCotLines = [];

      // Check for explicit COT tags ONLY - do NOT parse MCP invocations as COT
      // MCP tool calls belong in the Tool Calls quadrant, not COT
      const cotMatch = content.match(/\[COT\](.*?)\[\/COT\]/s);
      if (cotMatch) {
        newCotLines = cotMatch[1].trim().split('\n');
      }

      // Also check for thinking blocks from Claude
      const thinkMatch = content.match(/<thinking>(.*?)<\/thinking>/s);
      if (thinkMatch && newCotLines.length === 0) {
        newCotLines = thinkMatch[1].trim().split('\n').slice(0, 5);
      }

      // Add new lines if found
      if (newCotLines.length > 0) {
        cotLines = [...cotLines, ...newCotLines].slice(-TAIL_BUFFER_LINES);
      }
    };

    // Render bottom strip with embedding and Team Comms preview
    const renderBottomStrip = (cols) => {
      const halfWidth = Math.floor(cols / 2);
      const output = [];
      output.push('\u251c' + '\u2500'.repeat(halfWidth - 2) + '\u253c' + '\u2500'.repeat(halfWidth - 2) + '\u2524');
      const embeddingHeader = c.magenta + icons.star + ' Embedding' + c.reset;
      const teamCommsHeader = c.yellow + icons.users + ' Team Comms' + c.reset;
      const leftLines = embeddingLogLines.length > 0 ? embeddingLogLines.slice(0, MAX_STRIP_LINES) : [c.dim + '[Idle]' + c.reset];
      // Right side: Team Comms (COT moved to bottom-right quadrant)
      let teamCommsLines = [];
      if (self.teamCommsPanel) {
        const tr = self.teamCommsPanel.render(halfWidth - 4, MAX_STRIP_LINES + 2);
        if (tr && tr.full) teamCommsLines = tr.full.split('\n').slice(2, -2).slice(0, MAX_STRIP_LINES);
      }
      const rightLines = teamCommsLines.length > 0 ? teamCommsLines : [c.dim + '[No team activity]' + c.reset];
      const leftHeader = ' ' + embeddingHeader;
      const rightHeader = ' ' + teamCommsHeader;
      const paddedLeftHeader = leftHeader + ' '.repeat(Math.max(0, halfWidth - 2 - visibleLength(leftHeader)));
      const paddedRightHeader = rightHeader + ' '.repeat(Math.max(0, halfWidth - 2 - visibleLength(rightHeader)));
      output.push('\u2502' + paddedLeftHeader + '\u2502' + paddedRightHeader + '\u2502');
      // Show 4 content lines (total 5 lines with header = MAX_STRIP_LINES)
      for (let i = 0; i < 4; i++) {
        const leftContent = leftLines[i] || '';
        const rightContent = rightLines[i] || '';
        const truncLeft = truncateAnsiSafe(' ' + leftContent, halfWidth - 3);
        const truncRight = truncateAnsiSafe(' ' + rightContent, halfWidth - 3);
        const paddedLeft = truncLeft + ' '.repeat(Math.max(0, halfWidth - 2 - visibleLength(truncLeft)));
        const paddedRight = truncRight + ' '.repeat(Math.max(0, halfWidth - 2 - visibleLength(truncRight)));
        output.push('\u2502' + paddedLeft + '\u2502' + paddedRight + '\u2502');
      }
      return output.join('\n');
    };

    // Start embedding log tail when entering dashboard
    embeddingTailProcess = startEmbeddingLogTail();
    // Start COT log tail - reads from cot-stream.log written by MCP tools
    cotTailProcess = startCotLogTail();

    // LOG ROTATION - prevent unbounded growth that consumes RAM
    // Screen's -L flag continuously appends to claude-screen.log
    // We proactively truncate every 30 seconds to keep file small
    const LOG_ROTATION_INTERVAL = 30000; // 30 seconds
    const MAX_LOG_SIZE_KB = 100; // Truncate if file exceeds 100KB
    const MAX_LOG_LINES_ROTATE = 200; // Keep last 200 lines after rotation

    let logRotationInterval = null;
    const rotateLogFile = () => {
      try {
        if (!fs.existsSync(logFile)) return;
        const stats = fs.statSync(logFile);
        const fileSizeKB = stats.size / 1024;
        if (fileSizeKB > MAX_LOG_SIZE_KB) {
          // Truncate to last MAX_LOG_LINES_ROTATE lines in-place
          exec('tail -n ' + MAX_LOG_LINES_ROTATE + ' "' + logFile + '" > "' + logFile + '.tmp" && mv "' + logFile + '.tmp" "' + logFile + '"', {
            timeout: 5000
          }, function() { /* ignore result */ });
        }
      } catch (e) { /* ignore rotation errors */ }
    };

    // Also rotate other log files that might grow
    const rotateAllLogs = () => {
      rotateLogFile();
      // Rotate embedding log
      const embeddingLog = path.join(self.projectPath, 'specmem', 'sockets', 'embedding-autostart.log');
      try {
        if (fs.existsSync(embeddingLog) && fs.statSync(embeddingLog).size > MAX_LOG_SIZE_KB * 1024) {
          exec('tail -n 100 "' + embeddingLog + '" > "' + embeddingLog + '.tmp" && mv "' + embeddingLog + '.tmp" "' + embeddingLog + '"', {
            timeout: 5000
          }, function() {});
        }
      } catch (e) {}
      // Rotate COT log
      const cotLog = path.join(self.projectPath, 'specmem', 'sockets', 'cot-stream.log');
      try {
        if (fs.existsSync(cotLog) && fs.statSync(cotLog).size > MAX_LOG_SIZE_KB * 1024) {
          exec('tail -n 100 "' + cotLog + '" > "' + cotLog + '.tmp" && mv "' + cotLog + '.tmp" "' + cotLog + '"', {
            timeout: 5000
          }, function() {});
        }
      } catch (e) {}
      // Rotate MCP tool calls log
      const mcpLog = path.join(self.projectPath, 'specmem', 'sockets', 'mcp-tool-calls.log');
      try {
        if (fs.existsSync(mcpLog) && fs.statSync(mcpLog).size > MAX_LOG_SIZE_KB * 1024) {
          exec('tail -n 100 "' + mcpLog + '" > "' + mcpLog + '.tmp" && mv "' + mcpLog + '.tmp" "' + mcpLog + '"', {
            timeout: 5000
          }, function() {});
        }
      } catch (e) {}
    };

    // Initial rotation and start interval
    rotateAllLogs();
    logRotationInterval = setInterval(rotateAllLogs, LOG_ROTATION_INTERVAL);

    // Claude session tracking - sync with class-level state
    // The class maintains claudeSessions array and activeSessionIndex
    // Local variables provide backward compatibility with existing code
    let claudeSessions = self.claudeSessions.map(s => s.controller.claudeSession);
    let currentSessionIndex = Math.max(0, self.activeSessionIndex);

    // Helper to get all Claude sessions for this project (also syncs class state)
    const getClaudeSessions = () => {
      // Defensive: ensure projectId is defined
      const safeProjectId = self.projectId || 'unknown-project';
      try {
        const output = execSync('screen -ls 2>/dev/null || true', { encoding: 'utf8' });
        const sessions = [];
        const lines = output.split('\n');
        for (const line of lines) {
          const match = line.match(/^\s*(\d+)\.([^\s]+)\s+\(([^)]+)\)/);
          if (match) {
            const name = match[2];
            // Include all claude sessions for this project
            if (name.startsWith(`claude-${safeProjectId}`)) {
              sessions.push(name);
            }
          }
        }
        return sessions.length > 0 ? sessions : [`claude-${safeProjectId}`];
      } catch (e) {
        return [`claude-${safeProjectId}`];
      }
    };

    // Get active Claude session name from class-level tracking
    const getActiveSessionName = () => {
      // First try class-level session tracking
      const activeSession = self.getActiveSession();
      if (activeSession && activeSession.controller && activeSession.controller.claudeSession) {
        return activeSession.controller.claudeSession;
      }
      // Fallback to local tracking (for legacy/untracked sessions)
      claudeSessions = getClaudeSessions();
      if (currentSessionIndex >= claudeSessions.length) {
        currentSessionIndex = 0;
      }
      // Return actual session name or null if none exists
      // Don't return fake session name that would cause screen capture failures
      const sessionName = claudeSessions[currentSessionIndex];
      if (sessionName && screenExists(sessionName)) {
        return sessionName;
      }
      // Also check self.claude as fallback (single-session mode)
      if (self.claude && self.claude.claudeSession && screenExists(self.claude.claudeSession)) {
        return self.claude.claudeSession;
      }
      return null;  // No valid session - let caller handle gracefully
    };

    // Get enhanced Claude Preview title with session info
    // Format: "🤖 Claude #1 [alias] ●" where ● = running, ○ = stopped
    const getClaudePreviewTitle = () => {
      const activeSession = self.getActiveSession();
      if (!activeSession) {
        return `${icons.robot} Claude Preview`;
      }

      const num = activeSession.sessionNum;
      const alias = self.getAliasForSession ? self.getAliasForSession(num) : null;
      const isRunning = screenExists(activeSession.controller.claudeSession);
      const status = isRunning ? `${c.green}${icons.dot}${c.reset}` : `${c.dim}${icons.circle}${c.reset}`;

      let title = `${icons.robot} Claude #${num}`;
      if (alias) {
        title += ` [${alias}]`;
      }
      title += ` ${status}`;

      return title;
    };

    // Initialize MCP tool panel
    const mcpToolPanel = new MCPToolPanel(self.projectPath, self.projectId);
    if (self.pool) {
      mcpToolPanel.setPool(self.pool);
    }

    const getSize = () => ({
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24
    });

    /**
     * Parse claude-screen.log for MCP tool_use patterns
     * Returns array of tool call info
     */
    const parseMCPToolCalls = (logContent) => {
      const toolCalls = [];
      const lines = logContent.split('\n');

      // Look for tool_use blocks in the log - matches <invoke name="tool_name">
      const toolUsePattern = /<invoke name="([^"]+)">/g;

      for (const line of lines) {
        let match;
        while ((match = toolUsePattern.exec(line)) !== null) {
          const toolName = match[1];
          // Extract timestamp from line if available, otherwise use current time
          toolCalls.push({
            name: toolName,
            timestamp: new Date()
          });
        }
      }

      // Keep last 10 unique tool calls
      const uniqueTools = [];
      const seen = new Set();
      for (let i = toolCalls.length - 1; i >= 0 && uniqueTools.length < 10; i--) {
        const key = `${toolCalls[i].name}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueTools.unshift(toolCalls[i]);
        }
      }

      return uniqueTools;
    };

    // ============================================================
    // Phase 2: SpecMem Command Parser
    // ============================================================

    /**
     * Execute a SpecMem command from the SPECMEM input mode
     * Commands: find, code, broadcast, team, help, dashboard, start, stop, status
     */
    const executeSpecmemCommand = async (cmd) => {
      const parts = cmd.trim().split(/\s+/);
      const command = parts[0]?.toLowerCase();
      const args = parts.slice(1).join(' ');

      const addToHistory = (msg, type = 'info') => {
        const color = type === 'error' ? c.red :
                      type === 'success' ? c.green :
                      type === 'warning' ? c.yellow : c.cyan;
        const prefix = type === 'error' ? '[ERROR]' :
                       type === 'success' ? '[OK]' :
                       type === 'warning' ? '[WARN]' : '[SPECMEM]';
        const entry = color + prefix + c.reset + ' ' + msg + ' ' + c.dim + '(' + new Date().toLocaleTimeString() + ')' + c.reset;
        commandHistory.push(entry);
        if (commandHistory.length > maxCommandHistory) {
          commandHistory.shift();
        }
      };

      switch (command) {
        case 'find':
        case 'f':
          if (!args) {
            addToHistory('Usage: find <query> - Search memories', 'warning');
            return;
          }
          addToHistory('Searching memories: ' + args);
          // call MCP tool via socket (future implementation)
          try {
            addToHistory('find_memory(' + args + ') - MCP call pending', 'info');
          } catch (e) {
            addToHistory('Failed to search: ' + e.message, 'error');
          }
          break;

        case 'code':
        case 'c':
          if (!args) {
            addToHistory('Usage: code <query> - Search code', 'warning');
            return;
          }
          addToHistory('Searching code: ' + args);
          try {
            addToHistory('find_code_pointers(' + args + ') - MCP call pending', 'info');
          } catch (e) {
            addToHistory('Failed to search: ' + e.message, 'error');
          }
          break;

        case 'broadcast':
        case 'b':
          if (!args) {
            addToHistory('Usage: broadcast <message> - Send team broadcast', 'warning');
            return;
          }
          addToHistory('Broadcasting: ' + args);
          try {
            addToHistory('broadcast_to_team(' + args + ') - MCP call pending', 'info');
          } catch (e) {
            addToHistory('Failed to broadcast: ' + e.message, 'error');
          }
          break;

        case 'team':
        case 't':
          addToHistory('Fetching team status...');
          try {
            addToHistory('get_team_status() - MCP call pending', 'info');
          } catch (e) {
            addToHistory('Failed to get status: ' + e.message, 'error');
          }
          break;

        case 'webdashboard':
        case 'web':
        case 'w':
          // Handle subcommands (renamed from 'dashboard' - we're already in dashboard mode)
          if (args.startsWith('set password ')) {
            const newPass = args.replace('set password ', '');
            addToHistory('Setting dashboard password...', 'info');
            await setDashboardPassword(newPass, addToHistory);
          } else if (args.startsWith('set mode ')) {
            const mode = args.replace('set mode ', '');
            addToHistory('Setting dashboard mode: ' + mode, 'info');
            await setDashboardMode(mode, addToHistory);
          } else if (args === 'open') {
            await openDashboard(addToHistory);
          } else {
            await showDashboardInfo(addToHistory);
          }
          break;

        case 'start':
        case 'restart':
          addToHistory('Starting embedding server...', 'info');
          // embedding_start MCP call pending
          addToHistory('embedding_start() - MCP call pending', 'info');
          break;

        case 'stop':
          addToHistory('Stopping embedding server...', 'info');
          // embedding_stop MCP call pending
          addToHistory('embedding_stop() - MCP call pending', 'info');
          break;

        case 'status':
          addToHistory('Fetching embedding status...', 'info');
          // embedding_status MCP call pending
          addToHistory('embedding_status() - MCP call pending', 'info');
          break;

        case 'claude':
        case 'cl':
          if (args.startsWith('send ')) {
            const txt = args.slice(5);
            if (!txt.trim()) { addToHistory('Usage: claude send <text>', 'warning'); return; }
            const ses = getActiveSessionName();
            if (!ses || ses === 'claude-undefined') { addToHistory('No active Claude session', 'error'); return; }
            const ok = screenSend(ses, txt, true);
            addToHistory(ok ? 'Sent: ' + txt.substring(0, 50) : 'Send failed', ok ? 'success' : 'error');
          } else if (args === 'interrupt' || args === 'stop') {
            const ses = getActiveSessionName();
            if (!ses || ses === 'claude-undefined') { addToHistory('No active session', 'error'); return; }
            screenKey(ses, 'ctrl-c'); addToHistory('Interrupt sent', 'success');
          } else if (args === 'enter') {
            const ses = getActiveSessionName();
            if (!ses || ses === 'claude-undefined') { addToHistory('No active session', 'error'); return; }
            screenKey(ses, 'enter'); addToHistory('Enter sent', 'success');
          } else if (args === 'esc') {
            const ses = getActiveSessionName();
            if (!ses || ses === 'claude-undefined') { addToHistory('No active session', 'error'); return; }
            screenKey(ses, 'esc'); addToHistory('Escape sent', 'success');
          } else if (args === 'yes' || args === 'y') {
            const ses = getActiveSessionName();
            if (!ses || ses === 'claude-undefined') { addToHistory('No active session', 'error'); return; }
            screenKey(ses, 'enter'); addToHistory('Accepted', 'success');
          } else if (args === 'no' || args === 'n') {
            const ses = getActiveSessionName();
            if (!ses || ses === 'claude-undefined') { addToHistory('No active session', 'error'); return; }
            screenKey(ses, 'down'); execSync('sleep 0.1'); screenKey(ses, 'down'); execSync('sleep 0.1');
            screenKey(ses, 'enter'); addToHistory('Denied', 'success');
          } else {
            addToHistory('claude send <text> | interrupt | enter | esc | yes | no', 'info');
            addToHistory('> <text> shortcut sends text directly', 'info');
          }
          break;

        // ═══════════════════════════════════════════════════════════════
        // Session Management Commands
        // ═══════════════════════════════════════════════════════════════
        case 'sessions':
        case 'claudes': {
          if (self.claudeSessions.length === 0) {
            addToHistory('No Claude sessions running.', 'info');
          } else {
            addToHistory('Running Claude Sessions:', 'info');
            for (const sess of self.claudeSessions) {
              const isActive = self.getActiveSession() === sess;
              const alias = self.getAliasForSession ? self.getAliasForSession(sess.sessionNum) : null;
              const stat = screenExists(sess.controller.claudeSession) ? 'running' : 'stopped';
              const marker = isActive ? '>' : ' ';
              const aliasStr = alias ? ' "' + alias + '"' : '';
              addToHistory(marker + ' [' + sess.sessionNum + ']' + aliasStr + ' - ' + stat, stat === 'running' ? 'success' : 'warning');
            }
          }
          break;
        }

        case 'switch': {
          if (!args) { addToHistory('Usage: switch <number|alias>', 'warning'); break; }
          const switchSess = self.getSessionByIdentifier ? self.getSessionByIdentifier(args) : null;
          if (switchSess) {
            const idx = self.claudeSessions.indexOf(switchSess);
            if (idx !== -1) { self.activeSessionIndex = idx; addToHistory('Switched to Claude ' + switchSess.sessionNum, 'success'); }
          } else { addToHistory('Session not found', 'error'); }
          break;
        }

        case 'attach': {
          let attachSess = args ? (self.getSessionByIdentifier ? self.getSessionByIdentifier(args) : null) : self.getActiveSession();
          if (!attachSess) { addToHistory('No session to attach', 'error'); break; }
          addToHistory('Attaching to Claude ' + attachSess.sessionNum + ' (Ctrl+A+D to detach)...', 'info');
          try { execSync('screen -r ' + attachSess.controller.claudeSession, { stdio: 'inherit' }); } catch (e) { addToHistory('Failed: ' + e.message, 'error'); }
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // Permission Handling Commands
        // ═══════════════════════════════════════════════════════════════
        case 'accept': {
          let acceptSess = args ? (self.getSessionByIdentifier ? self.getSessionByIdentifier(args) : null) : self.getActiveSession();
          if (!acceptSess) {
            if (self.claude.accept()) { addToHistory('Accepted', 'success'); } else { addToHistory('Failed', 'error'); }
            break;
          }
          if (acceptSess.controller.accept()) { addToHistory('Accepted on Claude ' + acceptSess.sessionNum, 'success'); } else { addToHistory('Failed', 'error'); }
          break;
        }

        case 'allow': {
          let allowSess = args ? (self.getSessionByIdentifier ? self.getSessionByIdentifier(args) : null) : self.getActiveSession();
          if (!allowSess) {
            if (self.claude.allowAlways()) { addToHistory('Allowed always', 'success'); } else { addToHistory('Failed', 'error'); }
            break;
          }
          if (allowSess.controller.allowAlways()) { addToHistory('Allowed on Claude ' + allowSess.sessionNum, 'success'); } else { addToHistory('Failed', 'error'); }
          break;
        }

        case 'deny': {
          let denySess = args ? (self.getSessionByIdentifier ? self.getSessionByIdentifier(args) : null) : self.getActiveSession();
          if (!denySess) {
            if (self.claude.deny()) { addToHistory('Denied', 'success'); } else { addToHistory('Failed', 'error'); }
            break;
          }
          if (denySess.controller.deny()) { addToHistory('Denied on Claude ' + denySess.sessionNum, 'success'); } else { addToHistory('Failed', 'error'); }
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // AutoClaude Command
        // ═══════════════════════════════════════════════════════════════
        case 'autoclaude': {
          if (!args) { addToHistory('Usage: autoclaude <prompt> [duration]', 'warning'); break; }
          const acParts = args.split(/\s+/);
          let acDuration = '0:30', acPrompt = args;
          if (/^\d+:\d+$/.test(acParts[acParts.length - 1])) { acDuration = acParts.pop(); acPrompt = acParts.join(' '); }
          addToHistory('Starting AutoClaude: ' + acPrompt + ' (' + acDuration + ')', 'info');
          try {
            const ac = spawn('node', [path.join(__dirname, 'specmem-autoclaude.cjs'), self.projectPath, acPrompt, acDuration], { stdio: 'ignore', detached: true });
            ac.unref();
            addToHistory('AutoClaude started', 'success');
          } catch (e) { addToHistory('Failed: ' + e.message, 'error'); }
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // Cleanup Commands
        // ═══════════════════════════════════════════════════════════════
        case 'cleanup': {
          const cleanupCmd = args.split(/\s+/)[0]?.toLowerCase() || 'list';
          const projectScreens = self.getProjectScreens ? self.getProjectScreens() : [];
          if (cleanupCmd === 'list' || cleanupCmd === 'ls') {
            if (projectScreens.length === 0) { addToHistory('No active screens', 'info'); }
            else { addToHistory('Active screens:', 'info'); projectScreens.forEach((s, i) => addToHistory('  ' + (i+1) + '. ' + s.name + ' (' + s.status + ')', 'info')); }
          } else if (cleanupCmd === 'all') {
            for (const scr of projectScreens) { scr.name.startsWith('claude-') ? self.claude.stop() : screenKill(scr.name); addToHistory('Stopped: ' + scr.name, 'success'); }
          } else if (cleanupCmd === 'claude') {
            projectScreens.filter(s => s.name.startsWith('claude-')).forEach(s => { self.claude.stop(); addToHistory('Stopped: ' + s.name, 'success'); });
          } else if (cleanupCmd === 'brain') {
            projectScreens.filter(s => s.name.startsWith('specmem-')).forEach(s => { screenKill(s.name); addToHistory('Stopped: ' + s.name, 'success'); });
          } else { addToHistory('cleanup: list|all|claude|brain|<n>', 'warning'); }
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // Recovery, Health, Monitor Commands
        // ═══════════════════════════════════════════════════════════════
        case 'recover':
          addToHistory('Recovering...', 'info');
          const recovered = self.recoverFromCrash();
          addToHistory(recovered ? 'Recovery completed' : 'No crash log found', recovered ? 'success' : 'warning');
          break;

        case 'health': {
          const healthChk = self.claude.checkHealth ? self.claude.checkHealth() : { status: 'unknown', message: 'N/A' };
          addToHistory(healthChk.status.toUpperCase() + ': ' + healthChk.message, healthChk.status === 'healthy' ? 'success' : 'warning');
          break;
        }

        case 'monitor': {
          const monArg = args.split(/\s+/)[0]?.toLowerCase();
          if (monArg === 'stop') { self.stopHealthMonitor(); addToHistory('Monitor stopped', 'success'); }
          else { self.startHealthMonitor((parseInt(monArg) || 30) * 1000); addToHistory('Monitor started', 'success'); }
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // Terminal, Project, Shutdown Commands
        // ═══════════════════════════════════════════════════════════════
        case 'terminal':
        case 'term': {
          const termCmd = args.split(/\s+/)[0]?.toLowerCase() || 'info';
          if (termCmd === 'info') { addToHistory('TERM: ' + (process.env.TERM || 'N/A') + ', Colors: ' + (termCaps.hasColors ? 'Y' : 'N'), 'info'); }
          else if (termCmd === 'test') { addToHistory('Icons: ' + icons.success + ' ' + icons.error + ' ' + icons.warning, 'info'); }
          else { addToHistory('terminal: info|test', 'info'); }
          break;
        }

        case 'init':
          addToHistory('Running init...', 'info');
          try { execSync('node "' + path.join(__dirname, '..', 'scripts', 'specmem-init.cjs') + '"', { cwd: self.projectPath, stdio: 'ignore' }); addToHistory('Done', 'success'); }
          catch (e) { addToHistory('Failed: ' + e.message, 'error'); }
          break;

        case 'screens':
          const scrList = listScreens ? listScreens() : null;
          if (scrList) { scrList.split('\n').slice(0, 10).forEach(l => l.trim() && addToHistory('  ' + l, 'info')); }
          else { addToHistory('No screens', 'info'); }
          break;

        case 'die':
        case 'kill':
        case 'nuke':
          addToHistory('SHUTDOWN - Stopping all components...', 'warning');
          await self.handleDieCommand();
          break;

        case 'agents':
        case 'tasks': {
          if (!self.trackedAgents || self.trackedAgents.size === 0) { addToHistory('No agents', 'info'); break; }
          addToHistory('Tracked Agents:', 'info');
          for (const [id, info] of self.trackedAgents.entries()) {
            const elapsed = Math.round((Date.now() - info.startTime) / 1000);
            const elapsedStr = Math.floor(elapsed/60) + 'm ' + (elapsed%60) + 's';
            addToHistory('  ' + id.substring(0,16) + ' - ' + info.status + ' (' + elapsedStr + ')', info.status === 'running' ? 'success' : 'info');
          }
          break;
        }

        // ═══════════════════════════════════════════════════════════════
        // Help Command (comprehensive)
        // ═══════════════════════════════════════════════════════════════
        case 'help':
        case 'h':
        case '?':
          addToHistory('SpecMem Dashboard Commands:', 'info');
          addToHistory('MEMORY: find/code <query>', 'info');
          addToHistory('TEAM: broadcast <msg>, team', 'info');
          addToHistory('CLAUDE: claude send|interrupt|enter|esc|yes|no', 'info');
          addToHistory('SESSIONS: sessions, switch <n>, attach [n]', 'info');
          addToHistory('PERMS: accept, allow, deny [n]', 'info');
          addToHistory('AUTO: autoclaude <prompt> [h:mm]', 'info');
          addToHistory('MGMT: cleanup, recover, health, monitor', 'info');
          addToHistory('SYS: webdashboard, init, screens, agents, die', 'info');
          addToHistory('SHORTCUT: > <text> - send to Claude', 'info');
          break;

        case 'debug':
          debugKeyPresses = !debugKeyPresses;
          addToHistory('Debug mode: ' + (debugKeyPresses ? 'ON - keypresses logged' : 'OFF'), debugKeyPresses ? 'success' : 'warning');
          break;

        default:
          if (command && command.startsWith('>')) {
            let txt = command.slice(1); if (args) txt += ' ' + args; txt = txt.trim();
            if (!txt) { addToHistory('Usage: > <text>', 'warning'); return; }
            const ses = getActiveSessionName();
            if (!ses || ses === 'claude-undefined') { addToHistory('No active Claude session', 'error'); return; }
            const ok = screenSend(ses, txt, true);
            addToHistory(ok ? '> ' + txt.substring(0, 50) : 'Failed', ok ? 'success' : 'error');
          } else if (command) {
            addToHistory('Unknown command: ' + command + ' (try "help")', 'error');
          }
      }
    };

    /**
     * Get dashboard port from ports.json
     */
    const getDashboardPort = () => {
      const portsFile = path.join(self.projectPath, '.specmem/ports.json');
      try {
        const ports = JSON.parse(fs.readFileSync(portsFile, 'utf8'));
        return ports.ports?.dashboard || 8585;
      } catch {
        return 8585;
      }
    };

    /**
     * Show web dashboard connection info
     */
    const showDashboardInfo = async (addToHistory) => {
      const port = getDashboardPort();

      // Get local IP
      const nets = os.networkInterfaces();
      let localIp = '127.0.0.1';
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (net.family === 'IPv4' && !net.internal) {
            localIp = net.address;
            break;
          }
        }
      }

      addToHistory('Web Dashboard:', 'success');
      addToHistory('  URL:  http://localhost:' + port, 'info');
      addToHistory('  LAN:  http://' + localIp + ':' + port, 'info');
      addToHistory('  Open: dashboard open', 'info');
    };

    /**
     * Set web dashboard password
     */
    const setDashboardPassword = async (newPassword, addToHistory) => {
      if (!newPassword || newPassword.length < 8) {
        addToHistory('Password must be at least 8 characters', 'error');
        return;
      }

      const port = getDashboardPort();
      try {
        const currentPassword = process.env.SPECMEM_PASSWORD || 'specmem';
        const http = require('http');

        const postData = JSON.stringify({ currentPassword, newPassword });
        const options = {
          hostname: 'localhost',
          port: port,
          path: '/api/setup/password',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        };

        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              if (result.success) {
                addToHistory('Dashboard password updated', 'success');
              } else {
                addToHistory('Failed: ' + (result.message || result.error), 'error');
              }
            } catch {
              addToHistory('Failed to parse response', 'error');
            }
          });
        });

        req.on('error', (e) => {
          addToHistory('Request failed: ' + e.message, 'error');
        });

        req.write(postData);
        req.end();
      } catch (e) {
        addToHistory('Failed to set password: ' + e.message, 'error');
      }
    };

    /**
     * Set web dashboard access mode
     */
    const setDashboardMode = async (mode, addToHistory) => {
      const validModes = ['public', 'private', 'lan'];
      if (!validModes.includes(mode.toLowerCase())) {
        addToHistory('Invalid mode. Use: ' + validModes.join(', '), 'error');
        return;
      }

      const port = getDashboardPort();
      try {
        const http = require('http');
        const body = { mode: mode.toLowerCase(), hotReload: true };

        if (mode.toLowerCase() === 'public') {
          body.currentPassword = process.env.SPECMEM_PASSWORD || 'specmem';
        }

        const postData = JSON.stringify(body);
        const options = {
          hostname: 'localhost',
          port: port,
          path: '/api/setup/mode',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        };

        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              if (result.success) {
                addToHistory('Dashboard mode set to: ' + mode, 'success');
                if (result.requiresRestart) {
                  addToHistory('Server restart required', 'warning');
                }
              } else {
                addToHistory('Failed: ' + (result.message || result.error), 'error');
              }
            } catch {
              addToHistory('Failed to parse response', 'error');
            }
          });
        });

        req.on('error', (e) => {
          addToHistory('Request failed: ' + e.message, 'error');
        });

        req.write(postData);
        req.end();
      } catch (e) {
        addToHistory('Failed to set mode: ' + e.message, 'error');
      }
    };

    /**
     * Open web dashboard in browser
     */
    const openDashboard = async (addToHistory) => {
      const port = getDashboardPort();
      const url = 'http://localhost:' + port;

      const cmd = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';

      try {
        exec(cmd + ' ' + url);
        addToHistory('Opening ' + url + ' in browser...', 'success');
      } catch (e) {
        addToHistory('Failed to open browser: ' + e.message, 'error');
      }
    };

    /**
     * Get Pythia/MiniCOT status display line
     */
    const updatePythiaDisplay = (maxWidth) => {
      try {
        // Check if MiniCOT is running by looking for its socket or process
        const miniCotSocket = path.join(self.projectPath, 'specmem/sockets/minicot.sock');
        const isRunning = fs.existsSync(miniCotSocket);

        if (isRunning) {
          return `${c.green}${icons.check} Pythia COT: Online${c.reset}`;
        } else {
          return `${c.dim}${icons.circle} Pythia COT: Offline${c.reset}`;
        }
      } catch (e) {
        return `${c.red}${icons.cross} Pythia COT: Error${c.reset}`;
      }
    };

    // ============================================================
    // REGISTER DASHBOARD MODULES
    // Each module handles its own update/render logic
    // ============================================================
    const { cols: initCols, rows: initRows } = getSize();
    const initQuadHeight = Math.floor((initRows - 2 - BOTTOM_STRIP_HEIGHT - 3) / 2);
    const initQuadWidth = Math.floor(initCols / 2);

    // Claude Preview Module (TOP LEFT)
    const claudeModule = new ClaudePreviewModule(null, {
      width: initQuadWidth,
      height: initQuadHeight,
      colors: c,
      icons: icons,
      projectPath: self.projectPath,
      getActiveSession: () => getActiveSessionName(),
      screenReadFn: (session, lines) => screenReadNonBlocking(session, lines),
      logFile: logFile
    });
    moduleManager.register('topLeft', claudeModule);

    // Pythia COT Module (TOP RIGHT)
    const pythiaModule = new PythiaCOTModule(null, {
      width: initQuadWidth,
      height: initQuadHeight,
      colors: c,
      icons: icons,
      projectPath: self.projectPath,
      getCotLines: () => cotLines
    });
    moduleManager.register('topRight', pythiaModule);

    // Command Console Module (BOTTOM LEFT)
    const consoleModule = new CommandConsoleModule(null, {
      width: initQuadWidth,
      height: initQuadHeight,
      colors: c,
      icons: icons,
      projectPath: self.projectPath,
      getInputMode: () => inputMode,
      getInputBuffer: () => inputMode === 'specmem' ? specmemInputBuffer : claudeInputBuffer,
      getCommandHistory: () => commandHistory
    });
    moduleManager.register('bottomLeft', consoleModule);

    // MCP Tools Module (BOTTOM RIGHT)
    const mcpModule = new MCPToolsModule(null, {
      width: initQuadWidth,
      height: initQuadHeight,
      colors: c,
      icons: icons,
      projectPath: self.projectPath,
      mcpToolPanel: mcpToolPanel,
      getToolHistory: () => toolHistory
    });
    moduleManager.register('bottomRight', mcpModule);

    const draw = async () => {
      if (!running) return;
      // Race condition fix: prevent overlapping async draws from setInterval
      if (isDrawing) return;
      isDrawing = true;
      try {
        const { cols, rows } = getSize();

        // Create quadrant renderer - subtract 2 for header/footer, BOTTOM_STRIP_HEIGHT for embedding/COT strip
        const renderer = new QuadrantRenderer(cols, rows - 2 - BOTTOM_STRIP_HEIGHT);

      // Calculate quadrant dimensions - must match QuadrantRenderer
      // rows-2 for header/footer, -BOTTOM_STRIP_HEIGHT for bottom strip, -3 for borders (top, middle, bottom)
      const quadHeight = Math.floor((rows - 2 - BOTTOM_STRIP_HEIGHT - 3) / 2);
      const quadWidth = Math.floor(cols / 2);

      // SHARED VARIABLES - accessible to all quadrants
      let screenContent = '';
      const activeSession = getActiveSessionName();

      // Update module dimensions (terminal may have resized)
      claudeModule.width = quadWidth;
      claudeModule.height = quadHeight;
      pythiaModule.width = quadWidth;
      pythiaModule.height = quadHeight;
      consoleModule.width = quadWidth;
      consoleModule.height = quadHeight;
      mcpModule.width = quadWidth;
      mcpModule.height = quadHeight;

      // ============================================================
      // TOP LEFT: Claude screen preview (from ACTIVE session)
      // Always poll screen - user needs live updates regardless of focus
      // ============================================================
      const claudeLines = [];

      try {
      // Check if we have a valid session first
      if (!activeSession) {
        // No valid Claude session - show helpful message
        claudeLines.push('');
        claudeLines.push(c.yellow + '  No Claude session running' + c.reset);
        claudeLines.push('');
        claudeLines.push(c.dim + '  Press ' + c.reset + c.cyan + 'n' + c.reset + c.dim + ' to start a new Claude session' + c.reset);
        claudeLines.push(c.dim + '  Or run: ' + c.reset + c.cyan + 'claude start' + c.reset + c.dim + ' from terminal' + c.reset);
        claudeLines.push('');
      } else {
        // ALWAYS poll screen content - user needs to see live updates regardless of focus
        // Non-blocking screen read with more lines for scrollback
        const screenResult = screenReadNonBlocking(activeSession, 100); // Get last 100 lines
        if (screenResult && screenResult.content && screenResult.content.trim()) {
          screenContent = screenResult.content;
          lastClaudeContent = screenContent;
          lastClaudeTime = Date.now();
        } else {
          // Fallback to cached content
          screenContent = lastClaudeContent;
        }
        // Fallback to log file if still empty
        if (!screenContent.trim()) {
          const logContent = readLastLines(logFile, quadHeight - 1) || '';
          if (logContent.trim()) {
            screenContent = logContent;
            lastClaudeContent = screenContent;
          }
        }

        // Process content for display - show LAST lines (most recent), WRAP to fit
        if (screenContent.trim()) {
          const claudeContentLines = screenContent.split('\n');
          const maxDisplayWidth = quadWidth - 4;
          const maxLines = quadHeight - 1;

          // Process ALL lines first, then take the LAST ones to show most recent content
          const processedLines = [];
          for (let i = 0; i < claudeContentLines.length; i++) {
            // Clean up any garbled/control characters but KEEP ANSI codes (\x1b = 0x1B)
            let line = claudeContentLines[i] || '';
            line = line.replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g, '');

            // Filter out MCP protocol XML noise from Claude preview
            line = line.replace(/<\/?antml:[^>]*>/g, '');
            line = line.replace(/<\/?function_calls>/g, '');
            line = line.replace(/<\/?invoke[^>]*>/g, '');
            line = line.replace(/<\/?parameter[^>]*>/g, '');
            line = line.replace(/<\/?result>/g, '');
            line = line.replace(/<\/?output>/g, '');
            line = line.replace(/<name>.*?<\/name>/g, '');

            // Skip lines that are just whitespace after filtering
            if (!line.trim()) continue;

            // Wrap long lines to fit quadrant (don't clip!)
            const wrappedLines = wrapAnsiSafe(line, maxDisplayWidth);
            for (const wrappedLine of wrappedLines) {
              processedLines.push(wrappedLine);
            }
          }

          // Take LAST maxLines lines to show most recent content
          const startIdx = Math.max(0, processedLines.length - maxLines);
          for (let i = startIdx; i < processedLines.length; i++) {
            claudeLines.push(processedLines[i]);
          }
        } else {
          // Session exists but no output yet
          claudeLines.push('');
          claudeLines.push(c.dim + '  Session: ' + c.cyan + activeSession + c.reset);
          claudeLines.push(c.dim + '  Waiting for output...' + c.reset);
        }
      }  // end of activeSession check

      } catch (quadErr) {
        claudeLines.push(`${c.red}[Error: ${quadErr.message}]${c.reset}`);
      }
      renderer.setTopLeft(claudeLines);

      // ============================================================
      // BOTTOM LEFT: Command console with history / Direct input
      // ============================================================
      const consoleLines = [];
      try {

      if (inputMode === 'claude') {
        // Show claude mode indicator
        consoleLines.push(`${c.bgGreen}${c.black} CLAUDE MODE ${c.reset} ${c.dim}(ESC+ESC to exit)${c.reset}`);
        consoleLines.push('');
        // Show direct input indicator
        const bufferLine = `${c.cyan}>${c.reset} ${c.dim}[typing directly into Claude]${c.reset}`;
        consoleLines.push(truncateAnsiSafe(bufferLine, quadWidth - 4));
        consoleLines.push('');
        consoleLines.push(`${c.dim}All keystrokes sent directly to Claude${c.reset}`);
        consoleLines.push(`${c.dim}Ctrl+C=interrupt | Arrows/Tab/Backspace work${c.reset}`);
      } else if (inputMode === 'specmem') {
        // Show specmem mode indicator and input buffer
        consoleLines.push(`${c.bgMagenta}${c.white} SPECMEM MODE ${c.reset} ${c.dim}(Q to exit)${c.reset}`);
        consoleLines.push('');
        // Show the input buffer with prompt and cursor (use || '' to ensure never undefined)
        const bufferLine = `${c.magenta}specmem>${c.reset} ${specmemInputBuffer || ''}${c.bgWhite} ${c.reset}`;
        consoleLines.push(truncateAnsiSafe(bufferLine, quadWidth - 4));

        // Show command history/output if any (leave room for input)
        if (commandHistory.length > 0) {
          consoleLines.push('');
          const maxHistoryLines = Math.min(commandHistory.length, quadHeight - 6);
          const startIdx = Math.max(0, commandHistory.length - maxHistoryLines);
          for (let i = startIdx; i < commandHistory.length; i++) {
            const cmd = commandHistory[i];
            consoleLines.push(truncateAnsiSafe(cmd, quadWidth - 4));
          }
        } else {
          // Only show help if no history
          consoleLines.push('');
          consoleLines.push(`${c.dim}Commands: find, code, broadcast, team, help${c.reset}`);
          consoleLines.push(`${c.dim}start, stop, status${c.reset}`);
        }
      } else if (commandHistory.length === 0) {
        // Empty state with helpful onboarding
        consoleLines.push(`${c.dim}${icons.circle} Ready for commands${c.reset}`);
        consoleLines.push('');
        consoleLines.push(`${c.cyan}${icons.arrow}${c.reset} ${c.white}Quick Start:${c.reset}`);
        consoleLines.push(`  ${c.brightCyan}i${c.reset} ${c.dim}${icons.line_h}${c.reset} Chat with Claude`);
        consoleLines.push(`  ${c.brightCyan}n${c.reset} ${c.dim}${icons.line_h}${c.reset} New session`);
        consoleLines.push(`  ${c.brightCyan}h${c.reset} ${c.dim}${icons.line_h}${c.reset} All shortcuts`);
      } else {
        const displayCount = Math.min(commandHistory.length, quadHeight - 3);
        const startIdx = Math.max(0, commandHistory.length - displayCount);

        for (let i = startIdx; i < commandHistory.length; i++) {
          const cmd = commandHistory[i];
          consoleLines.push(truncateAnsiSafe(cmd, quadWidth - 4));
        }
      }

      // Update title based on mode - include icons for consistency
      if (inputMode === 'claude') {
        renderer.bottomLeftTitle = `${icons.play} Claude Input`;
      } else if (inputMode === 'specmem') {
        renderer.bottomLeftTitle = `${icons.brain} SpecMem Input`;
      } else {
        renderer.bottomLeftTitle = `${icons.arrow} Command Console`;
      }
      } catch (quadErr) {
        consoleLines.push(`${c.red}[Error: ${quadErr.message}]${c.reset}`);
      }
      renderer.setBottomLeft(consoleLines);

      // ============================================================
      // TOP RIGHT: Pythia COT (chain of thought reasoning) - next to Claude
      // ============================================================
      const cotQuadrantLines = [];
      try {

      // Phase 5: Update COT from screen content (look for reasoning patterns)
      updateCotFromContent(screenContent);

      // Add Pythia status line first
      const pythiaDisplayLine = updatePythiaDisplay(quadWidth - 6);
      cotQuadrantLines.push(truncateAnsiSafe(pythiaDisplayLine, quadWidth - 4));
      cotQuadrantLines.push('');

      // Add COT content (from cot-stream.log or parsed from screen)
      if (cotLines.length > 0) {
        for (let i = 0; i < Math.min(cotLines.length, quadHeight - 3); i++) {
          cotQuadrantLines.push(truncateAnsiSafe(cotLines[i] || '', quadWidth - 4));
        }
      } else {
        cotQuadrantLines.push(c.dim + '[No active reasoning]' + c.reset);
        cotQuadrantLines.push('');
        cotQuadrantLines.push(c.dim + 'COT appears here when' + c.reset);
        cotQuadrantLines.push(c.dim + 'Claude is thinking...' + c.reset);
      }

      } catch (quadErr) {
        cotQuadrantLines.push(`${c.red}[Error: ${quadErr.message}]${c.reset}`);
      }
      renderer.setTopRight(cotQuadrantLines);

      // ============================================================
      // BOTTOM RIGHT: MCP tool calls (with persistent history)
      // ============================================================
      const mcpLines = [];
      try {

      // Detect new tool calls from log content (persists to toolHistory)
      detectNewToolCalls(screenContent);

      // Try to fetch from database first
      try {
        await mcpToolPanel.fetchMCPCalls(10);
      } catch (e) {
        // Silent fail, will use log parsing / history
      }

      if (mcpToolPanel.calls && mcpToolPanel.calls.length > 0) {
        for (const call of mcpToolPanel.calls.slice(0, quadHeight - 1)) {
          const formatted = mcpToolPanel.formatCall(call, quadWidth - 4);
          mcpLines.push(formatted);
        }
      } else {
        // Use persistent tool history (survives screen refreshes)
        if (toolHistory.length > 0) {
          for (let i = 0; i < Math.min(toolHistory.length, quadHeight - 1); i++) {
            const tool = toolHistory[i];
            const time = tool.timestamp.toLocaleTimeString().slice(0, 8);
            const line = `${c.dim}${time}${c.reset} ${c.brightCyan}${tool.name}${c.reset}`;
            mcpLines.push(truncateAnsiSafe(line, quadWidth - 4));
          }
        } else {
          // Empty state for MCP Tools
          mcpLines.push(`${c.dim}${icons.circle} No tool activity${c.reset}`);
          mcpLines.push('');
          mcpLines.push(`${c.dim}Tools appear here when Claude${c.reset}`);
          mcpLines.push(`${c.dim}calls MCP tools or functions${c.reset}`);
        }
      }

      } catch (quadErr) {
        mcpLines.push(`${c.red}[Error: ${quadErr.message}]${c.reset}`);
      }
      renderer.setBottomRight(mcpLines);

      // ============================================================
      // Render the frame
      // ============================================================
      let frame = '';
      if (termCaps.hasColors) frame += '\x1b[2J\x1b[H';

      // Update Claude session list (activeSession already defined above)
      claudeSessions = getClaudeSessions();
      // Get session indicator from class-level tracking
      const sessionIndicator = self.getSessionIndicator();
      // Mode name for header display - Phase 1 tri-mode system
      const modeName = inputMode === 'claude' ? 'CLAUDE' : inputMode === 'specmem' ? 'SPECMEM' : 'COMMAND';

      // Header with mode and session info
      // Format: "SPECMEM DASHBOARD - {project} | Claude {n} "alias" [total] | {COMMAND/CLAUDE/SPECMEM} | {agents}"
      const runningAgents = self.getRunningAgentCount();
      const agentIndicator = runningAgents > 0 ? ` | ${c.yellow}${runningAgents} agents${c.reset}` : '';
      const header = ` ${icons.brain} SPECMEM DASHBOARD - ${self.projectId} | ${sessionIndicator} | ${modeName}${agentIndicator}`;
      // Header background color matches mode
      const headerBg = inputMode === 'claude' ? c.bgGreen : inputMode === 'specmem' ? c.bgMagenta : c.bgCyan;
      frame += `${headerBg}${c.black}${header.padEnd(cols)}${c.reset}\n`;

      // Update Claude Preview quadrant title with enhanced session info
      renderer.topLeftTitle = getClaudePreviewTitle();

      // Set active quadrant for border highlighting
      renderer.activeQuadrant = inputMode === 'claude' ? 'topLeft' : inputMode === 'specmem' ? 'bottomLeft' : null;

      // Quadrants - strip bottom border so we can add bottom strip
      const quadrantOutput = renderer.render();
      const quadrantLines = quadrantOutput.split('\n');
      quadrantLines.pop(); // Remove bottom border (╰...┴...╯)
      frame += quadrantLines.join('\n');

      // Phase 5: Bottom strip with embedding and COT preview
      frame += '\n' + renderBottomStrip(cols);

      // Bottom border for the entire frame (quadrants + strip)
      const halfWidth = Math.floor(cols / 2);
      frame += '\n\u2570' + '\u2500'.repeat(halfWidth - 2) + '\u2534' + '\u2500'.repeat(halfWidth - 2) + '\u256f';

      // Footer: Phase 1 - Clean, minimal, only essential shortcuts
      // Shows current mode + 3 essential navigation shortcuts
      let footer;
      const modeIcon = inputMode === 'claude' ? `${c.green}CLAUDE${c.reset}` :
                       inputMode === 'specmem' ? `${c.magenta}SPECMEM${c.reset}` : `${c.cyan}COMMAND${c.reset}`;
      if (inputMode === 'claude' || inputMode === 'specmem') {
        // Input modes - show how to exit and mode toggle
        footer = ` ${modeIcon} ${c.dim}|${c.reset} Ctrl+Shift+${icons.arrow_u}${icons.arrow_d}=Mode ${c.dim}|${c.reset} Ctrl+Shift+${icons.arrow_l}${icons.arrow_r}=Claude ${c.dim}|${c.reset} Ctrl+Shift+H=Exit`;
      } else {
        // Command mode - show essential shortcuts only
        footer = ` ${modeIcon} ${c.dim}|${c.reset} Ctrl+Shift+${icons.arrow_u}${icons.arrow_d}=Mode ${c.dim}|${c.reset} Ctrl+Shift+${icons.arrow_l}${icons.arrow_r}=Claude ${c.dim}|${c.reset} ${c.white}n${c.reset}=New ${c.dim}|${c.reset} ${c.white}h${c.reset}=Help`;
      }
      frame += `\n${footer}`;

      // Help overlay (render on top of frame if active)
      if (showHelp) {
        const helpLines = [
          `${c.bold}${c.cyan}KEYBOARD SHORTCUTS${c.reset}`,
          '',
          `${c.yellow}Mode Switching:${c.reset}`,
          '  Ctrl+Shift+Up    SPECMEM mode (memory commands)',
          '  Ctrl+Shift+Down  CLAUDE mode (screen input)',
          '  ESC ESC          Exit to COMMAND mode',
          '  i                Enter CLAUDE mode (shortcut)',
          '',
          `${c.yellow}Navigation:${c.reset}`,
          '  Ctrl+Shift+Left  Previous Claude session',
          '  Ctrl+Shift+Right Next Claude session',
          '  1-9              Switch to Claude #N',
          '',
          `${c.yellow}Actions:${c.reset}`,
          '  n   New Claude session',
          '  a   Accept permission prompt',
          '  x   Reject permission prompt',
          '  s   Stop active Claude',
          '  q   Quit dashboard',
          '  Ctrl+Shift+H    Exit to CLI',
          '',
          `${c.yellow}SpecMem Commands (in SPECMEM mode):${c.reset}`,
          '  find <query>      Search memories',
          '  code <query>      Search code',
          '  broadcast <msg>   Team broadcast',
          '  dashboard         Show web dashboard info',
          '',
          `${c.dim}Press h or ? to close${c.reset}`
        ];

        // Build help box with border
        const boxWidth = 38;
        const boxHeight = helpLines.length + 2;
        const startX = Math.floor((cols - boxWidth) / 2);
        const startY = Math.floor((rows - boxHeight) / 2);

        // Build help overlay
        let helpBox = '';
        helpBox += `${c.bgBlue}${c.white}${''.padEnd(boxWidth)}${c.reset}\n`;
        for (const line of helpLines) {
          // Strip ANSI for length calculation but keep for display
          const plainLine = line.replace(/\x1b\[[0-9;]*m/g, '');
          const padding = boxWidth - visibleLength(line) - 2;
          helpBox += `${c.bgBlue}${c.white} ${line}${' '.repeat(Math.max(0, padding))} ${c.reset}\n`;
        }
        helpBox += `${c.bgBlue}${c.white}${''.padEnd(boxWidth)}${c.reset}`;

        // Insert help box into frame by overlaying at center position
        const frameLines = frame.split('\n');
        const helpBoxLines = helpBox.split('\n');

        for (let i = 0; i < helpBoxLines.length && (startY + i) < frameLines.length; i++) {
          if (startY + i >= 0) {
            const frameLine = frameLines[startY + i] || '';
            // Strip ANSI codes to get real character positions
            const plainFrameLine = frameLine.replace(/\x1b\[[0-9;]*m/g, '');
            const before = frameLine.substring(0, startX);
            const after = plainFrameLine.length > startX + boxWidth
              ? frameLine.substring(frameLine.length - (plainFrameLine.length - startX - boxWidth))
              : '';
            frameLines[startY + i] = before + helpBoxLines[i] + after;
          }
        }
        frame = frameLines.join('\n');
      }

      // Use differential rendering - only update changed lines
      writeDiffFrame(frame);
      } finally {
        isDrawing = false;
      }
    };

    // Initial draw - force full redraw first time
    previousFrameLines = [];
    try {
      draw();
    } catch (initialDrawErr) {
      // Log error but don't crash - dashboard will recover on next refresh
      const errorMsg = `[INIT ERROR] ${initialDrawErr.message || initialDrawErr}`;
      commandHistory.push(`${c.red}${errorMsg}${c.reset}`);
    }

    // PTY MEMORY POLLING - Visibility-aware to reduce resource usage
    // Active: 500ms polling, Background: paused (no CPU usage)
    let lastPollContent = '';
    let pollDebounceTimer = null;
    let isVisible = true; // Track if dashboard is in foreground
    let refreshInterval = null;
    const POLL_INTERVAL_ACTIVE = 500;  // Active polling interval
    const POLL_INTERVAL_PAUSED = 5000; // Background polling (minimal)

    const smartDraw = () => {
      // Skip expensive operations when backgrounded
      if (!isVisible) return;

      try {
        // Only draw if content has changed (prevents unnecessary redraws)
        const activeSession = getActiveSessionName();
        if (activeSession) {
          const buffer = getPTYBuffer(activeSession);
          const currentContent = buffer.getContent();
          if (currentContent !== lastPollContent) {
            lastPollContent = currentContent;
            draw();
          }
        } else {
          // No active session, just draw status
          draw();
        }
      } catch (smartDrawErr) {
        // Log error but don't crash - will retry on next poll
        const errorMsg = `[DRAW ERROR] ${smartDrawErr.message || smartDrawErr}`;
        commandHistory.push(`${c.red}${errorMsg}${c.reset}`);
        if (commandHistory.length > maxCommandHistory) commandHistory.shift();
      }
    };

    // VISIBILITY DETECTION - Pause polling when terminal is backgrounded
    // SIGTSTP = terminal stop (Ctrl+Z), SIGCONT = continue
    const handleSuspend = () => {
      isVisible = false;
      if (refreshInterval) clearInterval(refreshInterval);
      refreshInterval = setInterval(smartDraw, POLL_INTERVAL_PAUSED);
    };

    const handleResume = () => {
      isVisible = true;
      if (refreshInterval) clearInterval(refreshInterval);
      refreshInterval = setInterval(smartDraw, POLL_INTERVAL_ACTIVE);
      draw(); // Immediate redraw on resume
    };

    // Listen for terminal background/foreground signals
    process.on('SIGTSTP', handleSuspend);
    process.on('SIGCONT', handleResume);

    // Also track window visibility via SIGWINCH (resize often happens when refocusing)
    let lastResizeTime = 0;
    const handleResize = () => {
      lastResizeTime = Date.now();
      if (!isVisible) {
        isVisible = true;
        if (refreshInterval) clearInterval(refreshInterval);
        refreshInterval = setInterval(smartDraw, POLL_INTERVAL_ACTIVE);
      }
      draw();
    };

    // Start with active polling
    refreshInterval = setInterval(smartDraw, POLL_INTERVAL_ACTIVE);
    process.stdout.on('resize', handleResize);

    // MED-05 fix: use safeSetRawMode for proper error recovery
    safeSetRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const keyHandler = (key) => {
      // Debug logging - shows keypress escape sequences when enabled via 'debug' command
      if (debugKeyPresses) {
        const hexKey = Buffer.from(key).toString('hex');
        const escSeq = key.replace(/\x1b/g, '\\x1b').replace(/[\x00-\x1f]/g, function(c) { return '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'); });
        const debugMsg = '[DEBUG] key=' + escSeq + ' hex=' + hexKey + ' mode=' + inputMode + ' len=' + key.length;
        commandHistory.push(c.dim + debugMsg + c.reset);
        if (commandHistory.length > maxCommandHistory) commandHistory.shift();
      }

      // Ctrl+Shift+Up (\x1b[1;6A) - cycle mode forward: COMMAND → SPECMEM → CLAUDE → COMMAND
      if (key === '\x1b[1;6A') {
        if (inputMode === 'command') {
          inputMode = 'specmem';
          specmemInputBuffer = '';
        } else if (inputMode === 'specmem') {
          inputMode = 'claude';
          claudeInputBuffer = '';
        } else if (inputMode === 'claude') {
          inputMode = 'command';
          claudeInputBuffer = '';
          specmemInputBuffer = '';
        }
        draw();
        return;
      }

      // Ctrl+Shift+Down (\x1b[1;6B) - cycle mode backward: COMMAND → CLAUDE → SPECMEM → COMMAND
      if (key === '\x1b[1;6B') {
        if (inputMode === 'command') {
          inputMode = 'claude';
          claudeInputBuffer = '';
        } else if (inputMode === 'claude') {
          inputMode = 'specmem';
          specmemInputBuffer = '';
        } else if (inputMode === 'specmem') {
          inputMode = 'command';
          claudeInputBuffer = '';
          specmemInputBuffer = '';
        }
        draw();
        return;
      }

      // Ctrl+Shift+H - UNIVERSAL EXIT DASHBOARD (works from ANY mode)
      // Various terminal encodings for Ctrl+Shift+H:
      // - CSI u extended: \x1b[104;6u (h=104, 6=Ctrl+Shift)
      // - CSI u uppercase: \x1b[72;6u (H=72)
      // - xterm modifyOtherKeys: \x1b[27;6;104~ and \x1b[27;6;72~
      // - kitty keyboard protocol: \x1b[104;6:3u
      // - Also handle Ctrl+Shift+Tab as fallback for terminals without H support
      // Note: \x08 is plain Ctrl+H (backspace), NOT Ctrl+Shift+H - not included
      const isCtrlShiftH = key === '\x1b[104;6u' ||
                           key === '\x1b[72;6u' ||
                           key === '\x1b[27;6;104~' ||
                           key === '\x1b[27;6;72~' ||
                           key === '\x1b[104;6:3u' ||  // kitty protocol
                           key === '\x1b[72;6:3u';     // kitty uppercase

      const isCtrlShiftTab = key === '\x1b[9;6u' ||
                             key === '\x1b[27;6;9~' ||
                             key === '\x1b[1;6Z';

      if (isCtrlShiftH || isCtrlShiftTab) {
        running = false;
        // cleanup() handles all terminal restoration - don't duplicate here
        cleanup();
        return;
      }

      // Ctrl+Up (\x1b[1;5A) - toggle to COMMAND mode (legacy behavior)
      if (key === '\x1b[1;5A') {
        inputMode = 'command';
        claudeInputBuffer = '';
        specmemInputBuffer = '';
        draw();
        return;
      }

      // Ctrl+Down (\x1b[1;5B) - toggle to CLAUDE mode (legacy behavior)
      if (key === '\x1b[1;5B') {
        inputMode = 'claude';
        claudeInputBuffer = '';
        draw();
        return;
      }

      // In SPECMEM mode - input goes to SpecMem command buffer (Phase 2)
      if (inputMode === 'specmem') {
        // ESC key handling for exiting specmem mode (double-ESC required)
        if (key === '\x1b') {
          escPressCount++;
          if (escTimeout) clearTimeout(escTimeout);
          if (escPressCount >= 2) {
            // Double ESC - exit to command mode
            inputMode = 'command';
            specmemInputBuffer = '';
            escPressCount = 0;
            draw();
          } else {
            // Wait for second ESC
            escTimeout = setTimeout(() => {
              escPressCount = 0;
            }, 300);
          }
          return;
        }

        // Reset ESC counter on any other key
        escPressCount = 0;
        if (escTimeout) {
          clearTimeout(escTimeout);
          escTimeout = null;
        }

        // Enter - execute command
        if (key === '\r' || key === '\n') {
          if (specmemInputBuffer.trim()) {
            executeSpecmemCommand(specmemInputBuffer.trim());
          }
          specmemInputBuffer = '';
          draw();
          return;
        }

        // Backspace - remove from buffer
        if (key === '\x7f' || key === '\b') {
          specmemInputBuffer = specmemInputBuffer.slice(0, -1);
          draw();
          return;
        }

        // Ctrl+C in specmem mode - clear buffer (don't interfere with Claude)
        if (key === '\x03') {
          specmemInputBuffer = '';
          draw();
          return;
        }

        // Ctrl+Shift+C - exit dashboard (various terminal encodings)
        if (key === '\x1b[67;6u' || key === '\x1b[99;6u' || key === 'Q') {
          running = false;
          cleanup();  // Fix: properly restore terminal state
          return;
        }

        // Printable characters - add to buffer
        if (key.length === 1 && key.charCodeAt(0) >= 32) {
          specmemInputBuffer += key;
          draw();
          return;
        }

        // Multi-character paste - add to buffer
        if (key.length > 1 && !key.startsWith('\x1b')) {
          specmemInputBuffer += key;
          draw();
          return;
        }

        return; // Ignore other escape sequences in specmem mode
      }

      // In CLAUDE mode - all input goes to Claude
      if (inputMode === 'claude') {
        const activeSession = getActiveSessionName();

        // ESC key handling for exiting claude mode (double-ESC required)
        // Note: Arrow keys start with \x1b[ so we check for standalone ESC
        if (key === '\x1b') {
          escPressCount++;
          if (escTimeout) clearTimeout(escTimeout);
          if (escPressCount >= 2) {
            // Double ESC - exit to command mode
            inputMode = 'command';
            claudeInputBuffer = '';
            escPressCount = 0;
            draw();
          } else {
            // Wait for second ESC, or send single ESC to Claude after timeout
            escTimeout = setTimeout(() => {
              if (escPressCount === 1) {
                // Single ESC timed out - send it to Claude
                screenKey(activeSession, 'esc');
              }
              escPressCount = 0;
            }, 300);
          }
          return;
        }

        // Reset ESC counter and cancel pending ESC timeout on any other key
        // This prevents ESC from being sent to Claude after user types something else
        escPressCount = 0;
        if (escTimeout) {
          clearTimeout(escTimeout);
          escTimeout = null;
        }

        // Arrow keys - Up/Down scroll preview, Left/Right go to Claude
        if (key === '\x1b[A') { // Up arrow - scroll preview up
          if (claudeScrollOffset < totalClaudeLines) {
            claudeScrollOffset++;
          }
          draw();
          return;
        }
        if (key === '\x1b[B') { // Down arrow - scroll preview down
          if (claudeScrollOffset > 0) {
            claudeScrollOffset--;
          }
          draw();
          return;
        }
        if (key === '\x1b[C') { // Right arrow - send to Claude
          screenKey(activeSession, 'right');
          draw();
          return;
        }
        if (key === '\x1b[D') { // Left arrow - send to Claude
          screenKey(activeSession, 'left');
          draw();
          return;
        }

        // Home key - jump to top of preview
        if (key === '\x1b[H' || key === '\x1b[1~') {
          const displayHeight = Math.floor((getSize().rows - 2 - 6 - 3) / 2) - 1;
          claudeScrollOffset = Math.max(0, totalClaudeLines - displayHeight);
          draw();
          return;
        }

        // End key - jump to bottom of preview (auto-scroll)
        if (key === '\x1b[F' || key === '\x1b[4~') {
          claudeScrollOffset = 0;
          draw();
          return;
        }

        // Page Up - scroll up one screen
        if (key === '\x1b[5~') {
          const displayHeight = Math.floor((getSize().rows - 2 - 6 - 3) / 2) - 1;
          claudeScrollOffset = Math.min(totalClaudeLines, claudeScrollOffset + displayHeight);
          draw();
          return;
        }

        // Page Down - scroll down one screen
        if (key === '\x1b[6~') {
          const displayHeight = Math.floor((getSize().rows - 2 - 6 - 3) / 2) - 1;
          claudeScrollOffset = Math.max(0, claudeScrollOffset - displayHeight);
          draw();
          return;
        }

        // Tab key - send directly to Claude
        if (key === '\t') {
          screenKey(activeSession, 'tab');
          draw();
          return;
        }

        // Shift+Tab - send directly to Claude
        if (key === '\x1b[Z') {
          screenKey(activeSession, 'shift-tab');
          draw();
          return;
        }

        // Home key - send directly to Claude
        if (key === '\x1b[H' || key === '\x1b[1~') {
          screenKey(activeSession, 'home');
          draw();
          return;
        }

        // End key - send directly to Claude
        if (key === '\x1b[F' || key === '\x1b[4~') {
          screenKey(activeSession, 'end');
          draw();
          return;
        }

        // Delete key - send directly to Claude
        if (key === '\x1b[3~') {
          screenKey(activeSession, 'delete');
          draw();
          return;
        }

        // Page Up - send directly to Claude
        if (key === '\x1b[5~') {
          screenKey(activeSession, 'page-up');
          draw();
          return;
        }

        // Page Down - send directly to Claude
        if (key === '\x1b[6~') {
          screenKey(activeSession, 'page-down');
          draw();
          return;
        }

        // Enter - send directly to Claude
        if (key === '\r' || key === '\n') {
          screenKey(activeSession, 'enter');
          draw();
          return;
        }

        // Backspace - send directly to Claude
        if (key === '\x7f' || key === '\b') {
          screenKey(activeSession, 'backspace');
          draw();
          return;
        }

        // Ctrl+C in claude mode - send to Claude (interrupt running command)
        if (key === '\x03') {
          screenKey(activeSession, 'ctrl-c');
          const cmd = `${c.yellow}[CTRL+C]${c.reset} Interrupt sent ${c.dim}(${new Date().toLocaleTimeString()})${c.reset}`;
          commandHistory.push(cmd);
          if (commandHistory.length > maxCommandHistory) commandHistory.shift();
          draw();
          return;
        }

        // Ctrl+D - send to Claude (EOF)
        if (key === '\x04') {
          screenKey(activeSession, 'ctrl-d');
          draw();
          return;
        }

        // Printable characters - send directly to Claude
        if (key.length === 1 && key.charCodeAt(0) >= 32) {
          screenSend(activeSession, key, false);
          draw();
          return;
        }

        // Multi-character paste - send directly to Claude
        if (key.length > 1 && !key.startsWith('\x1b')) {
          screenSend(activeSession, key, false);
          draw();
          return;
        }

        return; // Ignore other escape sequences in claude mode
      }

      // COMMAND mode - normal dashboard controls
      // q, Q, Ctrl+C, or Ctrl+Shift+C to exit (various terminal encodings for Ctrl+Shift+C)
      if (key === 'q' || key === 'Q' || key === '\x03' || key === '\x1b[67;6u' || key === '\x1b[99;6u') {
        running = false;
        cleanup();
      } else if (key === 'i') {
        // Enter claude mode (like vim insert mode)
        inputMode = 'claude';
        claudeInputBuffer = '';
        draw();
      } else if (key === 'u' || key === '\x1b[A') {
        if (self.teamCommsPanel) {
          self.teamCommsPanel.scrollUp();
          draw();
        }
      } else if (key === 'd' || key === '\x1b[B') {
        if (self.teamCommsPanel) {
          self.teamCommsPanel.scrollDown();
          draw();
        }
      } else if (key === 'r') {
        if (self.teamCommsPanel) self.teamCommsPanel.poll();
        draw();
      } else if (key === 'n') {
        // Spawn new Claude session using class-level session management
        // Uses numbered session names: claude-{projectId}-1, claude-{projectId}-2, etc.
        const newSession = self.createClaudeSession();
        if (newSession) {
          // Update local tracking to match class state
          claudeSessions = getClaudeSessions();
          currentSessionIndex = self.activeSessionIndex;
          const cmd = `${c.yellow}[NEW CLAUDE]${c.reset} ${newSession.controller.claudeSession} ${c.dim}(${new Date().toLocaleTimeString()})${c.reset}`;
          commandHistory.push(cmd);
          if (commandHistory.length > maxCommandHistory) {
            commandHistory.shift();
          }
        } else {
          const cmd = `${c.red}[ERROR]${c.reset} Failed to start new Claude session ${c.dim}(${new Date().toLocaleTimeString()})${c.reset}`;
          commandHistory.push(cmd);
          if (commandHistory.length > maxCommandHistory) {
            commandHistory.shift();
          }
        }
        draw();
      } else if (key === '\x1b[1;6D' || key === '<' || key === ',') {
        // Ctrl+Shift+Left or < or , - switch to previous Claude session
        if (self.switchToPreviousSession()) {
          // Sync local tracking with class state
          claudeSessions = getClaudeSessions();
          currentSessionIndex = self.activeSessionIndex;
          draw();
        }
      } else if (key === '\x1b[1;6C' || key === '>' || key === '.') {
        // Ctrl+Shift+Right or > or . - switch to next Claude session
        if (self.switchToNextSession()) {
          // Sync local tracking with class state
          claudeSessions = getClaudeSessions();
          currentSessionIndex = self.activeSessionIndex;
          draw();
        }
      } else if (key === 'c') {
        // Add a sample command to history for demo
        const cmd = `${c.cyan}>${c.reset} find_memory "query" ${c.dim}(${new Date().toLocaleTimeString()})${c.reset}`;
        commandHistory.push(cmd);
        if (commandHistory.length > maxCommandHistory) {
          commandHistory.shift();
        }
        draw();
      } else if (key === 'h' || key === '?') {
        // Toggle help overlay
        showHelp = !showHelp;
        draw();
      } else if (key === 't') {
        // Clear tool history (persisted in local toolHistory array)
        toolHistory.length = 0;
        lastLogPosition = 0;
        const cmd = `${c.cyan}[TOOLS]${c.reset} History cleared ${c.dim}(${new Date().toLocaleTimeString()})${c.reset}`;
        commandHistory.push(cmd);
        if (commandHistory.length > maxCommandHistory) commandHistory.shift();
        draw();
      } else if (key >= '1' && key <= '9') {
        // Number keys 1-9 to switch to Claude session by number
        const targetNum = parseInt(key);
        const session = self.claudeSessions.find(s => s.sessionNum === targetNum);
        if (session) {
          const idx = self.claudeSessions.indexOf(session);
          self.activeSessionIndex = idx;
          // Sync local tracking with class state
          claudeSessions = getClaudeSessions();
          currentSessionIndex = self.activeSessionIndex;
          const cmd = `${c.cyan}[SWITCH]${c.reset} Claude ${targetNum} ${c.dim}(${new Date().toLocaleTimeString()})${c.reset}`;
          commandHistory.push(cmd);
          if (commandHistory.length > maxCommandHistory) commandHistory.shift();
        } else {
          const cmd = `${c.yellow}[SWITCH]${c.reset} No session #${targetNum} ${c.dim}(${new Date().toLocaleTimeString()})${c.reset}`;
          commandHistory.push(cmd);
          if (commandHistory.length > maxCommandHistory) commandHistory.shift();
        }
        draw();
      } else if (key === 'a') {
        // Accept permission on active Claude (send 'y' + Enter)
        const session = self.getActiveSession();
        if (session && session.controller) {
          const sent = screenSend(session.controller.claudeSession, 'y');
          const cmd = sent
            ? `${c.green}[ACCEPT]${c.reset} Permission accepted on Claude ${session.sessionNum} ${c.dim}(${new Date().toLocaleTimeString()})${c.reset}`
            : `${c.red}[ACCEPT FAILED]${c.reset} Screen send failed on Claude ${session.sessionNum} ${c.dim}(${new Date().toLocaleTimeString()})${c.reset}`;
          commandHistory.push(cmd);
          if (commandHistory.length > maxCommandHistory) commandHistory.shift();
        } else {
          const cmd = `${c.yellow}[ACCEPT]${c.reset} No active session ${c.dim}(${new Date().toLocaleTimeString()})${c.reset}`;
          commandHistory.push(cmd);
          if (commandHistory.length > maxCommandHistory) commandHistory.shift();
        }
        draw();
      } else if (key === 'x') {
        // Reject permission on active Claude (send 'n' + Enter)
        const session = self.getActiveSession();
        if (session && session.controller) {
          const sent = screenSend(session.controller.claudeSession, 'n');
          const cmd = sent
            ? `${c.red}[REJECT]${c.reset} Permission rejected on Claude ${session.sessionNum} ${c.dim}(${new Date().toLocaleTimeString()})${c.reset}`
            : `${c.red}[REJECT FAILED]${c.reset} Screen send failed on Claude ${session.sessionNum} ${c.dim}(${new Date().toLocaleTimeString()})${c.reset}`;
          commandHistory.push(cmd);
          if (commandHistory.length > maxCommandHistory) commandHistory.shift();
        } else {
          const cmd = `${c.yellow}[REJECT]${c.reset} No active session ${c.dim}(${new Date().toLocaleTimeString()})${c.reset}`;
          commandHistory.push(cmd);
          if (commandHistory.length > maxCommandHistory) commandHistory.shift();
        }
        draw();
      } else if (key === 's') {
        // Stop active Claude session
        const session = self.getActiveSession();
        if (session && session.controller) {
          screenKill(session.controller.claudeSession);
          const cmd = `${c.yellow}[STOP]${c.reset} Claude ${session.sessionNum} stopped ${c.dim}(${new Date().toLocaleTimeString()})${c.reset}`;
          commandHistory.push(cmd);
          if (commandHistory.length > maxCommandHistory) commandHistory.shift();
          // BUG FIX: Use centralized removal with proper index adjustment
          self.removeSessionFromTracking(session);
          claudeSessions = getClaudeSessions();
          currentSessionIndex = self.activeSessionIndex;
        } else {
          const cmd = `${c.yellow}[STOP]${c.reset} No active session ${c.dim}(${new Date().toLocaleTimeString()})${c.reset}`;
          commandHistory.push(cmd);
          if (commandHistory.length > maxCommandHistory) commandHistory.shift();
        }
        draw();
      }
      // Note: 't' key is handled earlier in this function to clear toolHistory array
    };

    process.stdin.on('data', keyHandler);

    const cleanup = () => {
      self.stopAgentMonitoring();
      clearInterval(refreshInterval);
      if (logRotationInterval) clearInterval(logRotationInterval); // Stop log rotation
      if (pollDebounceTimer) clearTimeout(pollDebounceTimer);
      if (escTimeout) clearTimeout(escTimeout);
      stopEmbeddingLogTail(); // Phase 5: Stop embedding log tail process
      stopCotLogTail();       // Stop COT log tail process
      detachAllPTY();         // Detach all PTY processes for screen capture
      process.stdout.removeListener('resize', handleResize);
      process.stdin.removeListener('data', keyHandler);
      // Remove signal handlers for visibility tracking
      process.removeListener('SIGTSTP', handleSuspend);
      process.removeListener('SIGCONT', handleResume);
      if (self.teamCommsPanel) self.teamCommsPanel.stop();

      // FULL terminal restore - prevent "busted terminal" state
      // 1. Exit raw mode first (single consolidated call)
      safeSetRawMode(false);

      // 2. Exit alternate buffer FIRST (before other escape sequences)
      if (useAltBuffer) {
        process.stdout.write('\x1b[?1049l'); // Exit alternate buffer
      }

      // 3. Restore terminal state (consolidated - single write for efficiency)
      process.stdout.write('\x1b[?25h\x1b[0m\x1b[?7h');  // Show cursor + reset attrs + enable wrap

      // 4. Clear screen and move to top
      process.stdout.write('\x1b[2J\x1b[H');

      // 5. Reset terminal (stty sane equivalent)
      try {
        execSync('stty sane 2>/dev/null', { stdio: 'ignore' });
      } catch (e) { /* ignore if stty not available */ }

      console.log(''); // Add spacing
      console.log(`${c.dim}Exited dashboard mode${c.reset}`);
      console.log(''); // Add spacing

      // NOTE: Do NOT resume stdin here - wait until readline is recreated
      // This prevents race condition where keystrokes go to stale handler

      // Ensure readline is in cooked mode (not raw) and prompt is shown
      // Increased timeout to 300ms for better stability
      setTimeout(() => {
        // Suppress close handler during recreation
        self.suppressRlClose = true;

        // Close existing readline cleanly
        if (self.rl) {
          try { self.rl.close(); } catch (e) {}
        }

        // Get fresh TTY streams
        const ttyStreams = getTTYStreams();

        // Ensure cooked mode before creating readline
        if (ttyStreams.isTTY && ttyStreams.input.setRawMode) {
          try { ttyStreams.input.setRawMode(false); } catch (e) {}
        }

        // Create new readline interface
        self.rl = readline.createInterface({
          input: ttyStreams.input,
          output: ttyStreams.output,
          terminal: ttyStreams.isTTY
        });

        // NOW resume input - after readline is ready
        ttyStreams.input.resume();

        // Re-enable close handler
        self.suppressRlClose = false;

        // Setup readline prompt handlers
        self.rl.on('line', (line) => self.handleCommand(line.trim()));
        self.rl.on('close', () => {
          if (!self.suppressRlClose) {
            console.log(`\n${c.dim}Goodbye!${c.reset}`);
            process.exit(0);
          }
        });
        self.rl.on('SIGINT', () => {
          console.log(`\n${c.dim}Press Ctrl+D or type 'exit' to quit${c.reset}`);
          self.rl.prompt();
        });

        // Print banner and show prompt
        self.printBanner().then(() => {
          self.rl.prompt();
        }).catch(() => {
          // Fallback if banner fails
          self.rl.prompt();
        });
      }, 300);
    };
  }

  async start() {
    checkScreenDependency();

    // Get correct TTY streams (handles screen session stdin capture issue)
    const ttyStreams = getTTYStreams();
    this.ttyCleanup = ttyStreams.cleanup;

    // Ensure cooked mode for readline (not raw mode)
    if (ttyStreams.isTTY && ttyStreams.input.setRawMode) {
      ttyStreams.input.setRawMode(false);
    }
    ttyStreams.input.resume();

    await this.printBanner();

    this.rl = readline.createInterface({
      input: ttyStreams.input,
      output: ttyStreams.output,
      terminal: ttyStreams.isTTY
    });

    // Handle SIGINT gracefully
    this.rl.on('SIGINT', () => {
      console.log(`\n${c.dim}Use 'exit' to quit${c.reset}`);
      this.rl.prompt();
    });

    // Handle close - clean up TTY resources if used
    this.rl.on('close', () => {
      // Only exit if not intentionally closing to recreate
      if (!this.suppressRlClose) {
        this.running = false;
        console.log(`\n${c.dim}Goodbye!${c.reset}`);
        // Clean up TTY streams
        if (this.ttyCleanup) this.ttyCleanup();
        process.exit(0);
      }
    });

    const prompt = () => {
      if (!this.running) {
        this.rl.close();
        return;
      }
      this.rl.question(`${c.brightCyan}specmem${c.reset}${c.dim}>${c.reset} `, async (input) => {
        try {
          await this.executeCommand(input);
        } catch (err) {
          console.log(`${c.red}${icons.error} Error: ${err.message}${c.reset}`);
        }
        if (this.running) {
          prompt();
        } else {
          this.rl.close();
        }
      });
    };

    prompt();
  }
}

// ============================================================================
// MAIN
// ============================================================================

const projectPath = process.argv[2] || process.cwd();

// Check if running in screen
const inScreen = !!process.env.STY;

if (!inScreen && process.argv.includes('--screen')) {
  // Launch in a screen session
  checkScreenDependency();
  const projectId = getProjectId(projectPath);
  const sessionName = `specmem-${projectId}`;

  if (screenExists(sessionName)) {
    console.log(`${c.yellow}${icons.warning} SpecMem console already running: ${sessionName}${c.reset}`);
    console.log(`${c.dim}Attach with: screen -r ${sessionName}${c.reset}`);
    process.exit(0);
  }

  console.log(`${c.cyan}Launching SpecMem console in screen: ${sessionName}${c.reset}`);
  execSync(`screen -dmS ${sessionName} node "${__filename}" "${projectPath}"`, { stdio: 'ignore' });
  console.log(`${c.green}${icons.success} Started. Attach with: screen -r ${sessionName}${c.reset}`);
  process.exit(0);
}

// Run console
const console_ = new SpecMemConsole(projectPath);
console_.start();
