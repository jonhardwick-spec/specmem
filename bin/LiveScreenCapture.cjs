'use strict';

/**
 * LiveScreenCapture - Live terminal screen capture with full ANSI color preservation
 *
 * Replaces the old log-file-based screen reading approach that:
 *   - Stripped ANSI color codes
 *   - Caused RAM leaks from unbounded log growth
 *   - Had stale/cached content
 *   - No live interactivity
 *
 * This module provides:
 *   - PTY-based live capture with ANSI colors preserved
 *   - Efficient ring buffer (O(1) append, O(n) read) - no disk I/O
 *   - Demand-based polling - only captures when actively viewed
 *   - Keystroke forwarding to screen sessions
 *   - Graceful handling of dead/missing sessions
 *   - Automatic cleanup of orphaned processes
 *
 * Usage:
 *   const { LiveScreenCapture } = require('./LiveScreenCapture.cjs');
 *   const capture = new LiveScreenCapture({ sessionName: 'claude-abc123' });
 *   capture.startCapture();
 *   const { lines, timestamp } = capture.getContent(50);
 *   capture.sendInput('hello');
 *   capture.stopCapture();
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_LINES = 200;
const DEFAULT_POLL_INTERVAL = 500;       // ms between captures when polling
const PTY_COLS = 220;                     // wide enough for most terminals
const PTY_ROWS = 60;                      // tall enough for most terminals
const TMPFS_BASE = '/dev/shm/specmem';
const HARDCOPY_TIMEOUT = 2000;            // ms timeout for hardcopy commands
const SESSION_CHECK_INTERVAL = 5000;      // ms between session alive checks
const STALE_THRESHOLD = 100;              // ms - buffer data younger than this is "fresh"
const CTRL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g;

// Key map for sendKey - maps friendly names to screen stuff byte sequences
const KEY_MAP = {
  enter:      '\r',
  tab:        '\t',
  backspace:  '\x7f',
  'ctrl-c':   '\x03',
  'ctrl-d':   '\x04',
  'ctrl-z':   '\x1a',
  'ctrl-l':   '\x0c',
  'ctrl-a':   '\x01',
  'ctrl-e':   '\x05',
  'ctrl-u':   '\x15',
  'ctrl-k':   '\x0b',
  'ctrl-w':   '\x17',
  esc:        '\x1b',
  up:         '\x1b[A',
  down:       '\x1b[B',
  right:      '\x1b[C',
  left:       '\x1b[D',
  home:       '\x1b[H',
  end:        '\x1b[F',
  delete:     '\x1b[3~',
  'page-up':  '\x1b[5~',
  'page-down':'\x1b[6~',
  'shift-tab': '\x1b[Z',
  insert:     '\x1b[2~',
  f1:         '\x1bOP',
  f2:         '\x1bOQ',
  f3:         '\x1bOR',
  f4:         '\x1bOS',
  f5:         '\x1b[15~',
  f6:         '\x1b[17~',
  f7:         '\x1b[18~',
  f8:         '\x1b[19~',
  f9:         '\x1b[20~',
  f10:        '\x1b[21~',
  f11:        '\x1b[23~',
  f12:        '\x1b[24~'
};

// ---------------------------------------------------------------------------
// RingBuffer - Efficient circular buffer for terminal lines
// ---------------------------------------------------------------------------

/**
 * High-performance ring buffer for terminal output lines.
 * O(1) append, O(n) retrieval. Pure memory - zero disk I/O.
 * Preserves all ANSI escape sequences in stored content.
 */
class RingBuffer {
  /**
   * @param {number} capacity - Maximum number of lines to store
   */
  constructor(capacity = DEFAULT_MAX_LINES) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0;       // Next write position
    this.count = 0;      // Number of lines currently stored
    this.lastUpdate = 0; // Timestamp of last write
    this.totalAppended = 0; // Total lines ever appended (for stats)
  }

  /**
   * Append a single line to the buffer
   * @param {string} line - Line to append (ANSI preserved)
   */
  push(line) {
    this.buffer[this.head] = line;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    this.lastUpdate = Date.now();
    this.totalAppended++;
  }

  /**
   * Append raw data that may contain multiple lines.
   * Handles partial lines by joining with the previous line when data
   * does not end with a newline.
   * @param {string} data - Raw data to append
   */
  appendData(data) {
    if (!data) return;

    const lines = data.split('\n');

    // If we have existing content and this data doesn't start with newline,
    // the first segment belongs to the last line (partial line continuation)
    if (this.count > 0 && lines.length > 0 && !data.startsWith('\n')) {
      const lastIdx = (this.head - 1 + this.capacity) % this.capacity;
      this.buffer[lastIdx] = (this.buffer[lastIdx] || '') + lines[0];
      this.lastUpdate = Date.now();

      // Append remaining lines (skip the first which was merged)
      for (let i = 1; i < lines.length; i++) {
        this.push(lines[i]);
      }
    } else {
      for (let i = 0; i < lines.length; i++) {
        this.push(lines[i]);
      }
    }
  }

  /**
   * Retrieve the last N lines from the buffer
   * @param {number} n - Number of lines to retrieve (clamped to available)
   * @returns {string[]} Array of lines with ANSI codes intact
   */
  getLastLines(n) {
    const count = Math.min(n || this.count, this.count);
    if (count === 0) return [];

    const result = new Array(count);
    const start = (this.head - count + this.capacity) % this.capacity;

    for (let i = 0; i < count; i++) {
      const idx = (start + i) % this.capacity;
      result[i] = this.buffer[idx] || '';
    }

    return result;
  }

  /**
   * Get all stored lines
   * @returns {string[]} All lines in order
   */
  getAll() {
    return this.getLastLines(this.count);
  }

  /**
   * Clear the buffer
   */
  clear() {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }

  /**
   * Check if buffer has fresh content (updated recently)
   * @param {number} maxAge - Maximum age in ms to consider fresh
   * @returns {boolean}
   */
  isFresh(maxAge = STALE_THRESHOLD) {
    return this.count > 0 && (Date.now() - this.lastUpdate) < maxAge;
  }

  /**
   * Get buffer statistics
   * @returns {{ count: number, capacity: number, lastUpdate: number, totalAppended: number }}
   */
  stats() {
    return {
      count: this.count,
      capacity: this.capacity,
      lastUpdate: this.lastUpdate,
      totalAppended: this.totalAppended,
      utilizationPct: this.capacity > 0 ? Math.round((this.count / this.capacity) * 100) : 0
    };
  }
}

// ---------------------------------------------------------------------------
// LiveScreenCapture - Main capture class
// ---------------------------------------------------------------------------

/**
 * Live screen capture with full ANSI color preservation.
 *
 * Capture priority (tried in order):
 *   1. PTY attachment via node-pty (best: live, colored, efficient)
 *   2. Screen hardcopy to tmpfs (fallback: snapshot, no colors)
 *   3. Screen log toggle on tmpfs (last resort: brief log capture)
 *
 * @fires LiveScreenCapture#data        - New data captured
 * @fires LiveScreenCapture#sessionDead  - Session no longer exists
 * @fires LiveScreenCapture#error        - Capture error occurred
 * @fires LiveScreenCapture#started      - Capture started
 * @fires LiveScreenCapture#stopped      - Capture stopped
 */
class LiveScreenCapture extends EventEmitter {
  /**
   * @param {Object} options
   * @param {string} [options.sessionName]  - GNU Screen session name to capture
   * @param {number} [options.maxLines=200] - Ring buffer capacity
   * @param {number} [options.pollInterval=500] - Milliseconds between poll captures
   * @param {string} [options.projectPath]  - Project path (for session discovery)
   * @param {number} [options.ptyCols=220]  - PTY column width
   * @param {number} [options.ptyRows=60]   - PTY row height
   */
  constructor(options = {}) {
    super();

    this.sessionName = options.sessionName || null;
    this.maxLines = options.maxLines || DEFAULT_MAX_LINES;
    this.pollInterval = options.pollInterval || DEFAULT_POLL_INTERVAL;
    this.projectPath = options.projectPath || process.cwd();
    this.ptyCols = options.ptyCols || PTY_COLS;
    this.ptyRows = options.ptyRows || PTY_ROWS;

    // Internal state
    this._ringBuffer = new RingBuffer(this.maxLines);
    this._ptyProcess = null;
    this._pty = null;           // node-pty module reference
    this._pollTimer = null;
    this._sessionCheckTimer = null;
    this._capturing = false;
    this._captureMethod = 'none'; // 'pty', 'hardcopy', 'log-toggle', 'none'
    this._paused = false;
    this._lastCaptureTime = 0;
    this._captureCount = 0;
    this._errorCount = 0;
    this._destroyed = false;

    // Try to load node-pty
    try {
      this._pty = require('node-pty');
    } catch (e) {
      // node-pty not available - will use fallback methods
      this._pty = null;
    }

    // Ensure tmpfs directory exists
    this._ensureTmpfs();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Start capturing from a screen session.
   * Attempts PTY attachment first, falls back to polling.
   *
   * @param {string} [sessionName] - Session name (overrides constructor option)
   * @returns {boolean} True if capture started successfully
   */
  startCapture(sessionName) {
    if (this._destroyed) return false;

    if (sessionName) {
      this.sessionName = sessionName;
    }

    if (!this.sessionName) {
      this.emit('error', new Error('No session name provided'));
      return false;
    }

    // Stop any existing capture
    if (this._capturing) {
      this.stopCapture();
    }

    // Verify session exists before attempting capture
    if (!this.isSessionAlive()) {
      this.emit('error', new Error('Screen session not found: ' + this.sessionName));
      return false;
    }

    this._capturing = true;

    // Try PTY attachment first (preserves ANSI colors)
    const ptyAttached = this._attachPTY();

    if (ptyAttached) {
      this._captureMethod = 'pty';
    } else {
      // Fallback to polling via hardcopy
      this._captureMethod = 'hardcopy';
      this._startPolling();
    }

    // Start periodic session alive checks
    this._sessionCheckTimer = setInterval(() => {
      if (!this.isSessionAlive()) {
        this.emit('sessionDead', this.sessionName);
        this.stopCapture();
      }
    }, SESSION_CHECK_INTERVAL);

    // Prevent timer from keeping process alive
    if (this._sessionCheckTimer && this._sessionCheckTimer.unref) {
      this._sessionCheckTimer.unref();
    }

    this.emit('started', {
      sessionName: this.sessionName,
      method: this._captureMethod
    });

    return true;
  }

  /**
   * Stop capturing. Cleans up PTY processes and timers.
   */
  stopCapture() {
    this._capturing = false;

    // Kill PTY process
    this._detachPTY();

    // Stop polling timer
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }

    // Stop session check timer
    if (this._sessionCheckTimer) {
      clearInterval(this._sessionCheckTimer);
      this._sessionCheckTimer = null;
    }

    this._captureMethod = 'none';
    this.emit('stopped', { sessionName: this.sessionName });
  }

  /**
   * Get current visible content from the ring buffer.
   * All ANSI escape sequences are preserved.
   *
   * @param {number} [numLines] - Number of lines to return (default: all)
   * @returns {{ lines: string[], timestamp: number, sessionName: string, method: string, stats: Object }}
   */
  getContent(numLines) {
    const lines = numLines
      ? this._ringBuffer.getLastLines(numLines)
      : this._ringBuffer.getAll();

    // If using hardcopy and buffer is stale, do an on-demand capture
    if (this._capturing && this._captureMethod === 'hardcopy' && !this._ringBuffer.isFresh(this.pollInterval * 2)) {
      this._captureHardcopy();
      // Return freshly captured content
      const freshLines = numLines
        ? this._ringBuffer.getLastLines(numLines)
        : this._ringBuffer.getAll();
      return {
        lines: freshLines,
        timestamp: this._ringBuffer.lastUpdate,
        sessionName: this.sessionName,
        method: this._captureMethod,
        stats: this._ringBuffer.stats()
      };
    }

    return {
      lines,
      timestamp: this._ringBuffer.lastUpdate,
      sessionName: this.sessionName,
      method: this._captureMethod,
      stats: this._ringBuffer.stats()
    };
  }

  /**
   * Get content as a single string (convenience method).
   * @param {number} [numLines] - Number of lines
   * @returns {string} Content with newlines
   */
  getContentString(numLines) {
    const { lines } = this.getContent(numLines);
    return lines.join('\n');
  }

  /**
   * Send text input to the screen session.
   *
   * @param {string} text - Text to send
   * @param {boolean} [pressEnter=true] - Whether to press Enter after text
   * @returns {boolean} True if input was sent successfully
   */
  sendInput(text, pressEnter = true) {
    if (!this.sessionName) return false;

    try {
      // Escape characters for screen's stuff command
      const escaped = text
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`');
      const payload = pressEnter ? escaped + '\\r' : escaped;

      execSync(
        'screen -S ' + this._shellEscape(this.sessionName) + ' -p 0 -X stuff "' + payload + '"',
        { stdio: 'ignore', timeout: 3000 }
      );
      return true;
    } catch (e) {
      this.emit('error', e);
      return false;
    }
  }

  /**
   * Send a special key to the screen session.
   *
   * Supported keys: enter, tab, backspace, ctrl-c, ctrl-d, ctrl-z, ctrl-l,
   * ctrl-a, ctrl-e, ctrl-u, ctrl-k, ctrl-w, esc, up, down, left, right,
   * home, end, delete, page-up, page-down, shift-tab, insert, f1-f12
   *
   * @param {string} keyName - Key name from KEY_MAP
   * @returns {boolean} True if key was sent successfully
   */
  sendKey(keyName) {
    if (!this.sessionName) return false;

    const keySeq = KEY_MAP[keyName];
    if (!keySeq) {
      this.emit('error', new Error('Unknown key: ' + keyName));
      return false;
    }

    try {
      // For screen stuff command, we need to use the $'...' bash syntax
      // to send literal escape sequences
      const escapedSeq = this._escapeForStuff(keySeq);

      execSync(
        'screen -S ' + this._shellEscape(this.sessionName) + ' -p 0 -X stuff ' + escapedSeq,
        { stdio: 'ignore', timeout: 3000 }
      );
      return true;
    } catch (e) {
      this.emit('error', e);
      return false;
    }
  }

  /**
   * Check if the screen session is still alive.
   * @returns {boolean}
   */
  isSessionAlive() {
    if (!this.sessionName) return false;

    try {
      const output = execSync('screen -ls 2>/dev/null || true', {
        encoding: 'utf8',
        timeout: 3000
      });

      // Match exact session name to avoid partial matches
      // Screen -ls format: \t<pid>.<name>\t<date>\t<state>
      const escapedName = this.sessionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp('\\s+\\d+\\.' + escapedName + '\\s+');
      return pattern.test(output);
    } catch (e) {
      return false;
    }
  }

  /**
   * Pause capture (stops polling/processing but keeps PTY attached).
   * Useful when the dashboard panel is not visible.
   */
  pause() {
    this._paused = true;
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /**
   * Resume capture after pause.
   */
  resume() {
    this._paused = false;
    if (this._capturing && this._captureMethod === 'hardcopy' && !this._pollTimer) {
      this._startPolling();
    }
  }

  /**
   * Clear the capture buffer.
   */
  clearBuffer() {
    this._ringBuffer.clear();
  }

  /**
   * Switch to a different screen session.
   * @param {string} newSessionName - New session to capture
   * @returns {boolean} True if switch was successful
   */
  switchSession(newSessionName) {
    const wasCapturing = this._capturing;
    this.stopCapture();
    this._ringBuffer.clear();
    this.sessionName = newSessionName;
    if (wasCapturing) {
      return this.startCapture();
    }
    return true;
  }

  /**
   * Get capture statistics.
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      sessionName: this.sessionName,
      capturing: this._capturing,
      method: this._captureMethod,
      paused: this._paused,
      captureCount: this._captureCount,
      errorCount: this._errorCount,
      buffer: this._ringBuffer.stats(),
      hasPty: this._pty !== null,
      ptyAttached: this._ptyProcess !== null
    };
  }

  /**
   * Destroy the capture instance. Cleans up all resources.
   * After destroy(), the instance cannot be reused.
   */
  destroy() {
    this._destroyed = true;
    this.stopCapture();
    this._ringBuffer.clear();
    this.removeAllListeners();
  }

  // -------------------------------------------------------------------------
  // Static methods
  // -------------------------------------------------------------------------

  /**
   * List all active GNU Screen sessions.
   * @returns {Array<{ pid: string, name: string, date: string, state: string }>}
   */
  static listSessions() {
    try {
      const output = execSync('screen -ls 2>/dev/null || true', {
        encoding: 'utf8',
        timeout: 5000
      });

      const sessions = [];
      const lines = output.split('\n');

      for (const line of lines) {
        // Parse format: \t<pid>.<name>\t(<date>)\t(<state>)
        const match = line.match(/^\s+(\d+)\.(\S+)\s+\(([^)]*)\)\s+\((\w+)\)/);
        if (match) {
          sessions.push({
            pid: match[1],
            name: match[2],
            date: match[3],
            state: match[4]
          });
        }
      }

      return sessions;
    } catch (e) {
      return [];
    }
  }

  /**
   * Find Claude sessions matching a project path or pattern.
   * Claude sessions are typically named 'claude-<hash>' or 'claude-<projectId>'.
   *
   * @param {string} [pattern] - Optional pattern to filter by (substring match)
   * @returns {Array<{ pid: string, name: string, date: string, state: string }>}
   */
  static findClaudeSessions(pattern) {
    const sessions = LiveScreenCapture.listSessions();
    return sessions.filter(s => {
      if (pattern) {
        return s.name.includes('claude') && s.name.includes(pattern);
      }
      return s.name.includes('claude');
    });
  }

  /**
   * Check if a session exists by name.
   * @param {string} sessionName - Session name to check
   * @returns {boolean}
   */
  static sessionExists(sessionName) {
    if (!sessionName) return false;
    try {
      const output = execSync('screen -ls 2>/dev/null || true', {
        encoding: 'utf8',
        timeout: 3000
      });
      const escapedName = sessionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp('\\s+\\d+\\.' + escapedName + '\\s+');
      return pattern.test(output);
    } catch (e) {
      return false;
    }
  }

  /**
   * Get the list of supported special key names for sendKey().
   * @returns {string[]}
   */
  static getSupportedKeys() {
    return Object.keys(KEY_MAP);
  }

  // -------------------------------------------------------------------------
  // Private methods - PTY capture
  // -------------------------------------------------------------------------

  /**
   * Attach a PTY to the screen session for live colored capture.
   * Uses node-pty to spawn a read-only screen attachment.
   * @returns {boolean} True if attachment succeeded
   * @private
   */
  _attachPTY() {
    if (!this._pty || !this.sessionName) return false;

    // Already attached
    if (this._ptyProcess) return true;

    try {
      const termName = process.env.TERM || 'xterm-256color';

      // Use screen -x for shared read-only attachment
      // -x attaches to an already attached session (non-exclusive)
      this._ptyProcess = this._pty.spawn('screen', ['-x', this.sessionName], {
        name: termName,
        cols: this.ptyCols,
        rows: this.ptyRows,
        cwd: this.projectPath,
        env: Object.assign({}, process.env, { TERM: termName })
      });

      // Wire up data handler - all ANSI sequences preserved
      this._ptyProcess.onData((data) => {
        if (this._paused) return;

        this._ringBuffer.appendData(data);
        this._captureCount++;
        this._lastCaptureTime = Date.now();
        this.emit('data', data);
      });

      // Handle PTY exit
      this._ptyProcess.onExit((exitInfo) => {
        this._ptyProcess = null;

        // If we were supposed to be capturing, try fallback
        if (this._capturing && !this._destroyed) {
          this._captureMethod = 'hardcopy';
          this._startPolling();
          this.emit('error', new Error(
            'PTY exited (code ' + (exitInfo ? exitInfo.exitCode : '?') + '), falling back to hardcopy'
          ));
        }
      });

      return true;
    } catch (e) {
      this._ptyProcess = null;
      this.emit('error', e);
      return false;
    }
  }

  /**
   * Detach and kill the PTY process.
   * @private
   */
  _detachPTY() {
    if (this._ptyProcess) {
      try {
        this._ptyProcess.kill();
      } catch (e) {
        // Process may already be dead
      }
      this._ptyProcess = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private methods - Hardcopy fallback capture
  // -------------------------------------------------------------------------

  /**
   * Start polling via hardcopy for sessions where PTY is unavailable.
   * @private
   */
  _startPolling() {
    if (this._pollTimer) return;

    // Do an immediate capture
    this._captureHardcopy();

    this._pollTimer = setInterval(() => {
      if (!this._paused && this._capturing) {
        this._captureHardcopy();
      }
    }, this.pollInterval);

    // Prevent timer from keeping process alive
    if (this._pollTimer && this._pollTimer.unref) {
      this._pollTimer.unref();
    }
  }

  /**
   * Capture screen content via hardcopy command.
   * Uses tmpfs (RAM disk) to minimize disk I/O.
   * Note: hardcopy does NOT preserve ANSI colors - this is the fallback.
   * @private
   */
  _captureHardcopy() {
    if (!this.sessionName) return;

    const timestamp = Date.now();
    const tmpFile = path.join(TMPFS_BASE, 'capture-' + process.pid + '-' + timestamp + '.txt');

    try {
      // Use hardcopy -h to include scrollback buffer
      execSync(
        'screen -S ' + this._shellEscape(this.sessionName) + ' -p 0 -X hardcopy -h ' + tmpFile,
        { stdio: 'ignore', timeout: HARDCOPY_TIMEOUT }
      );

      // Brief wait for file creation (screen writes async)
      let retries = 0;
      while (!fs.existsSync(tmpFile) && retries < 5) {
        this._busyWait(20);
        retries++;
      }

      if (!fs.existsSync(tmpFile)) {
        this._errorCount++;
        return;
      }

      const content = fs.readFileSync(tmpFile, 'utf8');

      // Clean up temp file immediately
      try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }

      if (!content || !content.trim()) return;

      // Process content: remove trailing blank lines, clean control chars
      const rawLines = content.split('\n');

      // Trim trailing empty lines
      while (rawLines.length > 0 && !rawLines[rawLines.length - 1].trim()) {
        rawLines.pop();
      }

      // Clean control chars but preserve ANSI escape sequences (ESC = \x1b)
      const cleanedLines = rawLines.map(function(line) {
        return line.replace(CTRL_CHAR_RE, '');
      });

      // For hardcopy, we replace the entire buffer since it's a full snapshot
      this._ringBuffer.clear();
      for (const line of cleanedLines) {
        this._ringBuffer.push(line);
      }

      this._captureCount++;
      this._lastCaptureTime = timestamp;
      this.emit('data', cleanedLines.join('\n'));

    } catch (e) {
      this._errorCount++;
      // Clean up temp file on error
      try { fs.unlinkSync(tmpFile); } catch (ue) { /* ignore */ }

      // Try the log-toggle method as last resort
      this._captureLogToggle();
    }
  }

  /**
   * Last-resort capture: briefly enable screen logging, capture, disable.
   * Uses tmpfs to avoid disk writes.
   * @private
   */
  _captureLogToggle() {
    if (!this.sessionName) return;

    const logFile = path.join(TMPFS_BASE, 'log-capture-' + process.pid + '.log');
    const sessionArg = this._shellEscape(this.sessionName);

    try {
      // Set logfile path to tmpfs
      execSync(
        'screen -S ' + sessionArg + ' -p 0 -X logfile ' + logFile,
        { stdio: 'ignore', timeout: 1000 }
      );

      // Enable logging briefly
      execSync(
        'screen -S ' + sessionArg + ' -p 0 -X log on',
        { stdio: 'ignore', timeout: 1000 }
      );

      // Wait for some output to accumulate
      this._busyWait(100);

      // Disable logging
      execSync(
        'screen -S ' + sessionArg + ' -p 0 -X log off',
        { stdio: 'ignore', timeout: 1000 }
      );

      // Read captured content
      if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf8');
        try { fs.unlinkSync(logFile); } catch (e) { /* ignore */ }

        if (content && content.trim()) {
          this._ringBuffer.appendData(content);
          this._captureCount++;
          this._lastCaptureTime = Date.now();
          this._captureMethod = 'log-toggle';
        }
      }
    } catch (e) {
      this._errorCount++;
      // Clean up log file on error
      try { fs.unlinkSync(logFile); } catch (ue) { /* ignore */ }
    }
  }

  // -------------------------------------------------------------------------
  // Private methods - Utilities
  // -------------------------------------------------------------------------

  /**
   * Ensure the tmpfs directory exists for temp file operations.
   * @private
   */
  _ensureTmpfs() {
    try {
      if (fs.existsSync('/dev/shm')) {
        fs.mkdirSync(TMPFS_BASE, { recursive: true, mode: 0o755 });
      }
    } catch (e) {
      // Not fatal - hardcopy will use /tmp instead
    }
  }

  /**
   * Escape a string for safe use in shell commands.
   * @param {string} str - String to escape
   * @returns {string} Shell-escaped string
   * @private
   */
  _shellEscape(str) {
    if (!str) return "''";
    // If the string is already safe (alphanumeric, dash, underscore, dot), no escaping needed
    if (/^[a-zA-Z0-9._-]+$/.test(str)) return str;
    // Otherwise, single-quote it with proper escaping
    return "'" + str.replace(/'/g, "'\\''") + "'";
  }

  /**
   * Escape a byte sequence for screen's stuff command.
   * Uses $'...' bash syntax for literal escape sequences.
   * @param {string} seq - The byte sequence to escape
   * @returns {string} Escaped string suitable for screen -X stuff
   * @private
   */
  _escapeForStuff(seq) {
    // Convert each character to its escaped form for $'...' syntax
    let escaped = '';
    for (let i = 0; i < seq.length; i++) {
      const code = seq.charCodeAt(i);
      if (code === 0x1b) {
        escaped += '\\033';        // ESC
      } else if (code === 0x0d || code === 0x0a) {
        escaped += '\\r';          // CR / LF
      } else if (code === 0x09) {
        escaped += '\\t';          // TAB
      } else if (code === 0x7f) {
        escaped += '\\177';        // DEL (backspace)
      } else if (code < 0x20) {
        // Control characters: convert to octal
        escaped += '\\0' + code.toString(8).padStart(2, '0');
      } else if (seq[i] === "'" || seq[i] === '\\') {
        escaped += '\\' + seq[i];
      } else {
        escaped += seq[i];
      }
    }
    return "$'" + escaped + "'";
  }

  /**
   * Synchronous busy-wait. Used sparingly for hardcopy file creation.
   * @param {number} ms - Milliseconds to wait
   * @private
   */
  _busyWait(ms) {
    try {
      execSync('sleep ' + (ms / 1000).toFixed(3), { stdio: 'ignore' });
    } catch (e) {
      // Ignore
    }
  }
}

// ---------------------------------------------------------------------------
// MCP Content Filter - Strips MCP/XML noise from captured output
// ---------------------------------------------------------------------------

/**
 * Filter MCP XML noise from screen content while preserving ANSI colors.
 * Useful for cleaning up captured output before display.
 *
 * @param {string} line - Raw line from capture
 * @returns {string} Cleaned line
 */
function filterMCPNoise(line) {
  if (!line) return '';

  return line
    .replace(/<\/?antml:[^>]*>/g, '')
    .replace(/<\/?function_calls>/g, '')
    .replace(/<\/?invoke[^>]*>/g, '')
    .replace(/<\/?parameter[^>]*>/g, '')
    .replace(/<\/?result>/g, '')
    .replace(/<\/?output>/g, '')
    .replace(/<name>.*?<\/name>/g, '');
}

/**
 * Filter an array of lines, removing MCP noise and empty lines.
 *
 * @param {string[]} lines - Array of captured lines
 * @returns {string[]} Filtered lines
 */
function filterMCPLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map(filterMCPNoise)
    .filter(line => line.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  LiveScreenCapture,
  RingBuffer,
  filterMCPNoise,
  filterMCPLines,
  KEY_MAP,
  DEFAULT_MAX_LINES,
  DEFAULT_POLL_INTERVAL
};
