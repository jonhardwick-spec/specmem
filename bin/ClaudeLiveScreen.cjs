'use strict';

// ============================================================================
// CLAUDE LIVE SCREEN - Full-Screen Claude Live View with ANSI Color Preservation
// ============================================================================
//
// The #1 most important feature of the SpecMem TUI. When the user presses Tab 2,
// they see Claude's terminal output in FULL SCREEN with ALL COLORS PRESERVED,
// and can interact with it directly (send keystrokes, accept/reject permissions,
// type prompts).
//
// Features:
//   - Full ANSI color passthrough (truecolor, 256-color, basic)
//   - Scrollback buffer with PgUp/PgDn navigation
//   - Auto-follow mode (scrolls with new output when at bottom)
//   - Interactive mode (forward all keystrokes to Claude's screen session)
//   - Quick accept/reject for permission prompts
//   - Session status indicator (alive/dead)
//   - Graceful resize handling
//   - AEGIS theme integration with fallback
//
// Usage:
//   const ClaudeLiveScreen = require('./ClaudeLiveScreen.cjs');
//   const screen = new ClaudeLiveScreen({
//     projectPath: '/path/to/project',
//     theme: aegisThemeInstance,  // optional
//     capture: liveScreenCaptureInstance  // optional, creates one if not provided
//   });
//   screen.onActivate();
//   const rows = screen.render(120, 40);
//   screen.handleInput(key);
//
// @author SpecMem TUI Team
// ============================================================================

// ---------------------------------------------------------------------------
// Imports with graceful fallbacks
// ---------------------------------------------------------------------------

let AegisTheme = null;
let AEGIS_COLORS = null;
let AEGIS_ICONS = null;
try {
  const aegis = require('./AegisTheme.cjs');
  AegisTheme = aegis.AegisTheme || null;
  AEGIS_COLORS = aegis.AEGIS_COLORS || null;
  AEGIS_ICONS = aegis.AEGIS_ICONS || null;
} catch (_err) {
  // AegisTheme not available - will fall back to basic ANSI colors
}

let LiveScreenCapture = null;
let filterMCPNoise = null;
try {
  const lsc = require('./LiveScreenCapture.cjs');
  LiveScreenCapture = lsc.LiveScreenCapture;
  filterMCPNoise = lsc.filterMCPNoise || null;
} catch (_err) {
  // LiveScreenCapture not available
}

let AnsiRenderer = null;
let AnsiString = null;
try {
  const ar = require('./AnsiRenderer.cjs');
  AnsiRenderer = ar.AnsiRenderer;
  AnsiString = ar.AnsiString;
} catch (_err) {
  // AnsiRenderer not available
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const UNDERLINE = '\x1b[4m';
const INVERSE = '\x1b[7m';

// Basic ANSI color fallbacks (used when AegisTheme is not available)
const COLORS = {
  cyan:       '\x1b[36m',
  cyanBright: '\x1b[96m',
  green:      '\x1b[32m',
  greenBright:'\x1b[92m',
  red:        '\x1b[31m',
  redBright:  '\x1b[91m',
  yellow:     '\x1b[33m',
  white:      '\x1b[37m',
  gray:       '\x1b[90m',
  magenta:    '\x1b[35m',
  blue:       '\x1b[34m',
  blackBg:    '\x1b[40m',
  greenBg:    '\x1b[42m',
  redBg:      '\x1b[41m',
  cyanBg:     '\x1b[46m'
};

// AEGIS color palette (hex fallbacks for truecolor terminals)
const AEGIS_HEX = {
  cyan:       '#00d4ff',
  cyanDark:   '#0099cc',
  green:      '#00ff88',
  greenDark:  '#00cc66',
  red:        '#ff3366',
  yellow:     '#ffaa00',
  orange:     '#ff6633',
  magenta:    '#cc33ff',
  text:       '#c8d6e5',
  textDim:    '#6b7b8d',
  bg:         '#0a0f1a',
  bgSurface:  '#131924',
  border:     '#2a3a4a',
  borderFocus:'#00d4ff'
};

// Box-drawing characters
const BOX = {
  tl: '\u256D', tr: '\u256E', bl: '\u2570', br: '\u256F',
  h: '\u2500', v: '\u2502',
  // T-junctions
  teeL: '\u251C', teeR: '\u2524'
};

// Scroll indicators
const SCROLL_UP   = '\u25B2'; // Black up-pointing triangle
const SCROLL_DOWN = '\u25BC'; // Black down-pointing triangle
const SCROLL_THUMB = '\u2588'; // Full block (for scrollbar thumb)
const SCROLL_TRACK = '\u2591'; // Light shade (for scrollbar track)

// Default scroll page size
const DEFAULT_PAGE_SIZE = 20;

// Double-ESC exit detection timeout (ms)
const DOUBLE_ESC_TIMEOUT = 300;

// Default capture poll intervals
const ACTIVE_POLL_MS = 250;   // When tab is active
const INACTIVE_POLL_MS = 2000; // When tab is inactive (reduced frequency)

// Default ring buffer capacity for scrollback
const DEFAULT_SCROLLBACK = 2000;

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Convert a hex color (#RRGGBB) to truecolor foreground ANSI escape.
 * @param {string} hex - Hex color e.g. '#00d4ff'
 * @returns {string} ANSI escape sequence
 */
function hexFg(hex) {
  if (AegisTheme && typeof AegisTheme.fg === 'function') {
    try {
      const resolved = AegisTheme.fg(hex);
      if (resolved && resolved !== hex) return resolved;
    } catch (_e) { /* fall through */ }
  }
  if (!hex || typeof hex !== 'string' || hex.length < 7) return '';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '';
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Convert a hex color (#RRGGBB) to truecolor background ANSI escape.
 * @param {string} hex - Hex color e.g. '#131924'
 * @returns {string} ANSI escape sequence
 */
function hexBg(hex) {
  if (AegisTheme && typeof AegisTheme.bg === 'function') {
    try {
      const resolved = AegisTheme.bg(hex);
      if (resolved && resolved !== hex) return resolved;
    } catch (_e) { /* fall through */ }
  }
  if (!hex || typeof hex !== 'string' || hex.length < 7) return '';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '';
  return `\x1b[48;2;${r};${g};${b}m`;
}

/**
 * Get the visible (display) width of a string, excluding ANSI escapes.
 * Uses AnsiRenderer if available, otherwise a simple regex strip.
 * @param {string} str
 * @returns {number}
 */
function visWidth(str) {
  if (!str) return 0;
  if (AnsiRenderer && typeof AnsiRenderer.visibleWidth === 'function') {
    return AnsiRenderer.visibleWidth(str);
  }
  // Fallback: strip ANSI and return length (does not handle CJK/emoji)
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').length;
}

/**
 * Pad or truncate a string to exactly targetWidth visible columns.
 * Preserves ANSI color codes.
 * @param {string} str - Input string
 * @param {number} targetWidth - Desired visible width
 * @param {string} [padChar=' '] - Character to pad with
 * @returns {string}
 */
function fitWidth(str, targetWidth, padChar = ' ') {
  if (AnsiRenderer) {
    const truncated = AnsiRenderer.truncate(str || '', targetWidth, '');
    return AnsiRenderer.pad(truncated, targetWidth, padChar);
  }
  // Fallback: simple approach (strips ANSI for measurement)
  const plain = (str || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  if (plain.length >= targetWidth) {
    return (str || '').slice(0, targetWidth);
  }
  return (str || '') + padChar.repeat(targetWidth - plain.length);
}

/**
 * Format a timestamp as HH:MM:SS.
 * @param {number} ts - Unix timestamp in ms
 * @returns {string}
 */
function formatTime(ts) {
  if (!ts) return '--:--:--';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Format a date-time as YYYY-MM-DD HH:MM.
 * @param {number} [ts] - Unix timestamp in ms (defaults to now)
 * @returns {string}
 */
function formatDateTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  const yyyy = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mo}-${dd} ${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// ClaudeLiveScreen Class
// ---------------------------------------------------------------------------

class ClaudeLiveScreen {
  /**
   * @param {Object} options
   * @param {string} [options.projectPath]  - Project working directory
   * @param {Object} [options.theme]        - AegisTheme instance (optional)
   * @param {Object} [options.capture]      - LiveScreenCapture instance (optional; creates one if not provided)
   * @param {string} [options.sessionName]  - Screen session name to attach to
   * @param {number} [options.scrollback]   - Max scrollback lines (default: 2000)
   * @param {boolean} [options.filterMcp]   - Whether to filter MCP XML noise (default: true)
   */
  constructor(options = {}) {
    this.projectPath = options.projectPath || process.cwd();
    this.theme = options.theme || AegisTheme || null;
    this.sessionName = options.sessionName || null;
    this.scrollback = options.scrollback || DEFAULT_SCROLLBACK;
    this.filterMcp = options.filterMcp !== false;

    // Capture instance
    this._capture = options.capture || null;
    this._ownCapture = false; // Whether we created the capture (and should destroy it)

    // Content state
    this._lines = [];           // All captured lines (scrollback buffer)
    this._scrollOffset = 0;     // Lines scrolled up from bottom (0 = at bottom)
    this._autoFollow = true;    // Auto-scroll when new content arrives
    this._lastLineCount = 0;    // For detecting new content

    // Interactive mode state
    this._interactive = false;
    this._lastEscTime = 0;      // For double-ESC exit detection

    // Session state
    this._sessionAlive = false;
    this._lastUpdateTime = 0;
    this._captureMethod = 'none';
    this._activated = false;

    // Render cache (avoid re-rendering when nothing changed)
    this._lastRenderWidth = 0;
    this._lastRenderHeight = 0;
    this._lastRenderLineCount = 0;
    this._lastRenderScroll = -1;
    this._lastRenderInteractive = false;
    this._cachedRows = null;

    // Input buffer for interactive mode prompt
    this._inputBuffer = '';

    // Session discovery
    this._discoveredSession = null;
    this._lastDiscoveryTime = 0;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Called when this tab becomes active.
   * Starts or resumes capture, enables auto-follow.
   */
  onActivate() {
    this._activated = true;

    // Auto-discover session if none set
    if (!this.sessionName) {
      this._discoverSession();
    }

    // Create capture instance if needed
    if (!this._capture && LiveScreenCapture && this.sessionName) {
      this._capture = new LiveScreenCapture({
        sessionName: this.sessionName,
        maxLines: this.scrollback,
        pollInterval: ACTIVE_POLL_MS,
        projectPath: this.projectPath
      });
      this._ownCapture = true;

      // Wire up event handlers
      this._capture.on('data', () => {
        this._onNewData();
      });
      this._capture.on('sessionDead', () => {
        this._sessionAlive = false;
      });
      this._capture.on('error', () => {
        // Silently handle capture errors (session not found, PTY failures, etc.)
        // The UI will show "Offline" status instead of crashing
      });

      // Attempt to start capture (may fail if session doesn't exist yet)
      try {
        this._capture.startCapture();
      } catch (_e) {
        // Session may not exist yet - that's fine, we'll show offline status
      }
    } else if (this._capture) {
      // Resume existing capture at active poll rate
      this._capture.resume();
      if (this._capture.pollInterval !== ACTIVE_POLL_MS) {
        this._capture.pollInterval = ACTIVE_POLL_MS;
      }
    }

    // Check session status
    this._checkSessionAlive();

    // Invalidate render cache
    this._invalidateCache();
  }

  /**
   * Called when this tab loses focus.
   * Reduces capture frequency to save resources.
   */
  onDeactivate() {
    this._activated = false;

    // Exit interactive mode if active
    if (this._interactive) {
      this.exitInteractiveMode();
    }

    // Reduce capture frequency (don't stop completely - we still want data)
    if (this._capture) {
      if (this._capture.pollInterval !== INACTIVE_POLL_MS) {
        this._capture.pollInterval = INACTIVE_POLL_MS;
      }
      this._capture.pause();
    }
  }

  /**
   * Destroy this screen and clean up resources.
   */
  destroy() {
    this._activated = false;
    if (this._ownCapture && this._capture) {
      this._capture.destroy();
      this._capture = null;
    }
    this._lines = [];
    this._cachedRows = null;
  }

  // =========================================================================
  // Rendering
  // =========================================================================

  /**
   * Render the full screen view.
   * Returns an array of strings (one per terminal row), with ANSI colors.
   *
   * Layout:
   *   Row 0:              Header bar with session info
   *   Rows 1 to height-2: Claude output content (ANSI colors preserved)
   *   Row height-1:       Footer bar with keybindings
   *
   * @param {number} width  - Terminal width in columns
   * @param {number} height - Terminal height in rows
   * @returns {string[]} Array of exactly `height` strings
   */
  render(width, height) {
    if (width < 10) width = 10;
    if (height < 5) height = 5;

    // Update content from capture
    this.update();

    // Check if we can use cached render
    if (this._cachedRows &&
        this._lastRenderWidth === width &&
        this._lastRenderHeight === height &&
        this._lastRenderLineCount === this._lines.length &&
        this._lastRenderScroll === this._scrollOffset &&
        this._lastRenderInteractive === this._interactive) {
      return this._cachedRows;
    }

    const rows = new Array(height);

    // Row 0: Header bar
    rows[0] = this._renderHeader(width);

    // Rows 1 to height-2: Content area
    const contentHeight = height - 2;
    const contentRows = this._renderContent(width, contentHeight);
    for (let i = 0; i < contentHeight; i++) {
      rows[i + 1] = contentRows[i] || '';
    }

    // Last row: Footer bar
    rows[height - 1] = this._renderFooter(width);

    // Cache the result
    this._cachedRows = rows;
    this._lastRenderWidth = width;
    this._lastRenderHeight = height;
    this._lastRenderLineCount = this._lines.length;
    this._lastRenderScroll = this._scrollOffset;
    this._lastRenderInteractive = this._interactive;

    return rows;
  }

  /**
   * Render the header bar.
   * Format: +-- Claude Live -- session: <name> -- . Online -- YYYY-MM-DD HH:MM --+
   * @param {number} width - Available width
   * @returns {string}
   */
  _renderHeader(width) {
    const innerWidth = width - 2; // Account for border chars

    // Colors
    const borderColor = hexFg(AEGIS_HEX.border) || COLORS.gray;
    const cyanColor = hexFg(AEGIS_HEX.cyan) || COLORS.cyanBright;
    const textColor = hexFg(AEGIS_HEX.text) || COLORS.white;
    const dimColor = hexFg(AEGIS_HEX.textDim) || COLORS.gray;

    // Status dot
    let statusDot, statusLabel;
    if (this._sessionAlive) {
      const greenColor = hexFg(AEGIS_HEX.green) || COLORS.greenBright;
      statusDot = `${greenColor}\u25CF${RESET}`;
      statusLabel = `${greenColor}Online${RESET}`;
    } else {
      const redColor = hexFg(AEGIS_HEX.red) || COLORS.redBright;
      statusDot = `${redColor}\u25CF${RESET}`;
      statusLabel = `${redColor}Offline${RESET}`;
    }

    // Session name display
    const sessionDisplay = this.sessionName || 'no session';

    // Timestamp
    const timeStr = formatDateTime();

    // Capture method indicator
    const methodStr = this._captureMethod !== 'none'
      ? ` ${dimColor}[${this._captureMethod}]${RESET}`
      : '';

    // Build title segments
    const titleParts = [
      `${BOX.h}${BOX.h} `,
      `${cyanColor}${BOLD}Claude Live${RESET}`,
      ` ${borderColor}${BOX.h}${BOX.h}${RESET} `,
      `${textColor}${sessionDisplay}${RESET}`,
      ` ${borderColor}${BOX.h}${BOX.h}${RESET} `,
      `${statusDot} ${statusLabel}`,
      methodStr,
      ` ${borderColor}${BOX.h}${BOX.h}${RESET} `,
      `${dimColor}${timeStr}${RESET}`,
      ` `
    ];

    // Calculate visible width of title content
    let titleContent = titleParts.join('');
    let titleVisWidth = visWidth(titleContent);

    // If title is wider than available space, truncate it
    if (titleVisWidth > innerWidth) {
      if (AnsiRenderer) {
        titleContent = AnsiRenderer.truncate(titleContent, innerWidth, '');
      }
      titleVisWidth = visWidth(titleContent);
    }

    // Fill remaining with horizontal line
    const fillCount = Math.max(0, innerWidth - titleVisWidth);
    const fill = `${borderColor}${BOX.h.repeat(fillCount)}${RESET}`;

    return `${borderColor}${BOX.tl}${RESET}${titleContent}${fill}${borderColor}${BOX.tr}${RESET}`;
  }

  /**
   * Render the content area (Claude output with ANSI colors preserved).
   * @param {number} width  - Available width (including border columns)
   * @param {number} height - Number of content rows
   * @returns {string[]} Array of content row strings
   */
  _renderContent(width, height) {
    const borderColor = hexFg(AEGIS_HEX.border) || COLORS.gray;
    const innerWidth = width - 2; // Left border + Right border
    const rows = new Array(height);

    // Determine which lines to show
    const totalLines = this._lines.length;
    let startLine;

    if (totalLines <= height) {
      // All content fits on screen - show everything from the top
      startLine = 0;
      this._scrollOffset = 0;
    } else if (this._autoFollow) {
      // Auto-follow: show the latest lines
      startLine = totalLines - height;
      this._scrollOffset = 0;
    } else {
      // Manual scroll position
      startLine = Math.max(0, totalLines - height - this._scrollOffset);
    }

    // Are we at the very bottom?
    const atBottom = (startLine + height >= totalLines) || totalLines <= height;
    // Are we at the very top?
    const atTop = startLine === 0;

    // Render visible lines
    for (let i = 0; i < height; i++) {
      const lineIdx = startLine + i;
      let lineContent;

      if (lineIdx < totalLines) {
        // Get the raw line with ANSI colors intact
        lineContent = this._lines[lineIdx] || '';

        // Fit to inner width, preserving ANSI
        lineContent = fitWidth(lineContent, innerWidth);
      } else {
        // Empty line (beyond content)
        lineContent = ' '.repeat(innerWidth);
      }

      // Add scroll indicators on the right border
      let rightBorder = `${borderColor}${BOX.v}${RESET}`;

      if (totalLines > height && !atBottom) {
        // Show scroll indicators when scrolled up from bottom
        if (i === 0 && !atTop) {
          // Top indicator: more content above
          rightBorder = `${borderColor}${SCROLL_UP}${RESET}`;
        } else if (i === height - 1) {
          // Bottom indicator: more content below
          rightBorder = `${borderColor}${SCROLL_DOWN}${RESET}`;
        }
      } else if (totalLines > height && !atTop && atBottom) {
        // At bottom but scrollable content above
        if (i === 0) {
          rightBorder = `${borderColor}${SCROLL_UP}${RESET}`;
        }
      }

      // Scrollbar track (optional - when content is scrollable)
      if (totalLines > height && height > 4) {
        const scrollbarHeight = Math.max(1, Math.floor((height / totalLines) * height));
        const scrollbarPos = Math.floor(((startLine) / Math.max(1, totalLines - height)) * (height - scrollbarHeight));

        if (i >= scrollbarPos && i < scrollbarPos + scrollbarHeight) {
          // Scrollbar thumb
          const thumbColor = hexFg(AEGIS_HEX.cyanDark) || COLORS.cyan;
          rightBorder = `${thumbColor}${SCROLL_THUMB}${RESET}`;
        }
      }

      rows[i] = `${borderColor}${BOX.v}${RESET}${lineContent}${RESET}${rightBorder}`;
    }

    return rows;
  }

  /**
   * Render the footer bar with keybindings.
   * Changes when in interactive mode.
   * @param {number} width - Available width
   * @returns {string}
   */
  _renderFooter(width) {
    const innerWidth = width - 2;
    const borderColor = hexFg(AEGIS_HEX.border) || COLORS.gray;
    const cyanColor = hexFg(AEGIS_HEX.cyan) || COLORS.cyanBright;
    const dimColor = hexFg(AEGIS_HEX.textDim) || COLORS.gray;
    const greenColor = hexFg(AEGIS_HEX.green) || COLORS.greenBright;

    let footerContent;

    if (this._interactive) {
      // Interactive mode footer
      const greenBg = hexBg('#004422') || COLORS.greenBg;
      const brightText = hexFg('#ffffff') || COLORS.white;
      const modeLabel = `${greenBg}${brightText}${BOLD} INTERACTIVE MODE ${RESET}`;
      const hint = `${dimColor}All keys sent to Claude${RESET}`;
      const exitHint = `${cyanColor}[ESC+ESC]${RESET}${dimColor}Exit${RESET}`;

      footerContent = ` ${modeLabel} ${borderColor}${BOX.h}${BOX.h}${RESET} ${hint} ${borderColor}${BOX.h}${BOX.h}${RESET} ${exitHint} `;
    } else {
      // Normal mode footer - build key hints that fit within width
      // Full set of key hints, progressively reduced if too wide
      const allKeys = [
        { key: 'i', label: 'Interactive' },
        { key: 'a', label: 'Accept' },
        { key: 'x', label: 'Reject' },
        { key: 'PgUp/PgDn', label: 'Scroll' },
        { key: 'Home', label: 'Top' },
        { key: 'End', label: 'Bottom' },
        { key: 'ESC', label: 'Back' }
      ];

      // Compact set for narrow terminals
      const compactKeys = [
        { key: 'i', label: 'Type' },
        { key: 'a', label: 'Yes' },
        { key: 'x', label: 'No' },
        { key: '\u2191\u2193', label: 'Scroll' },
        { key: 'ESC', label: 'Back' }
      ];

      // Scroll position indicator
      let scrollInfo = '';
      if (this._lines.length > 0) {
        const totalLines = this._lines.length;
        if (this._autoFollow) {
          scrollInfo = ` ${dimColor}${totalLines}L${RESET}`;
        } else {
          const viewBottom = totalLines - this._scrollOffset;
          const viewTop = Math.max(1, viewBottom - 20); // approximate
          scrollInfo = ` ${dimColor}${viewTop}-${viewBottom}/${totalLines}${RESET}`;
        }
      }

      // Try full keys first, fall back to compact
      let keys = allKeys;
      let keyHints = keys.map(k =>
        `${cyanColor}[${k.key}]${RESET}${dimColor}${k.label}${RESET}`
      ).join(' ');
      let testContent = ` ${keyHints}${scrollInfo} `;

      if (visWidth(testContent) > innerWidth) {
        keys = compactKeys;
        keyHints = keys.map(k =>
          `${cyanColor}[${k.key}]${RESET}${dimColor}${k.label}${RESET}`
        ).join(' ');
        testContent = ` ${keyHints}${scrollInfo} `;
      }

      footerContent = testContent;
    }

    // Calculate fill - if content is wider than innerWidth, truncate
    let contentVisWidth = visWidth(footerContent);
    if (contentVisWidth > innerWidth) {
      // Truncate using AnsiRenderer if available
      if (AnsiRenderer) {
        footerContent = AnsiRenderer.truncate(footerContent, innerWidth, '');
      } else {
        // Simple truncation fallback
        footerContent = footerContent.slice(0, innerWidth);
      }
      contentVisWidth = visWidth(footerContent);
    }
    const fillCount = Math.max(0, innerWidth - contentVisWidth);
    const fill = `${borderColor}${BOX.h.repeat(fillCount)}${RESET}`;

    return `${borderColor}${BOX.bl}${RESET}${footerContent}${fill}${borderColor}${BOX.br}${RESET}`;
  }

  // =========================================================================
  // Content Update
  // =========================================================================

  /**
   * Pull the latest content from the LiveScreenCapture instance.
   * Called automatically during render(), but can also be called manually.
   */
  update() {
    if (!this._capture) {
      // No capture instance - try to discover and connect
      if (this._activated && !this.sessionName) {
        this._discoverSession();
      }
      return;
    }

    // Get content from capture (all ANSI codes preserved)
    const content = this._capture.getContent();

    if (content && content.lines) {
      // Optionally filter MCP noise
      let lines = content.lines;
      if (this.filterMcp && filterMCPNoise) {
        lines = lines.map(line => filterMCPNoise(line));
      }

      // Detect new content
      const newLineCount = lines.length;
      const hadNewContent = newLineCount !== this._lastLineCount;

      // Store all lines
      this._lines = lines;
      this._lastLineCount = newLineCount;
      this._lastUpdateTime = content.timestamp || Date.now();
      this._captureMethod = content.method || 'unknown';

      // If new content arrived and auto-follow is on, stay at bottom
      if (hadNewContent && this._autoFollow) {
        this._scrollOffset = 0;
      }

      // Invalidate render cache when content changes
      if (hadNewContent) {
        this._invalidateCache();
      }
    }

    // Check session status periodically
    this._checkSessionAlive();
  }

  /**
   * Handle new data event from capture.
   * @private
   */
  _onNewData() {
    if (this._autoFollow) {
      this._scrollOffset = 0;
    }
    this._invalidateCache();
  }

  // =========================================================================
  // Keyboard Input Handling
  // =========================================================================

  /**
   * Handle keyboard input.
   * Returns true if the key was consumed by this screen.
   *
   * Normal mode keybindings:
   *   'i'       - Enter interactive mode
   *   'a'       - Send 'y' + Enter (accept permission)
   *   'x'       - Send 'n' + Enter (reject permission)
   *   PageUp    - Scroll up one page
   *   PageDown  - Scroll down one page
   *   Up arrow  - Scroll up one line
   *   Down arrow- Scroll down one line
   *   Home      - Scroll to top
   *   End       - Scroll to bottom (resume auto-follow)
   *   ESC       - Exit back to tab bar (return false to let parent handle)
   *
   * Interactive mode keybindings:
   *   ESC+ESC   - Exit interactive mode (double-tap ESC within 300ms)
   *   All other keys are forwarded to the screen session
   *
   * @param {string|Object} key - Key string or key object from readline
   * @returns {boolean} True if the key was consumed
   */
  handleInput(key) {
    // Normalize key input
    const keyInfo = this._normalizeKey(key);

    if (this._interactive) {
      return this._handleInteractiveInput(keyInfo);
    }

    return this._handleNormalInput(keyInfo);
  }

  /**
   * Handle input in normal (non-interactive) mode.
   * @param {Object} keyInfo - Normalized key info
   * @returns {boolean}
   * @private
   */
  _handleNormalInput(keyInfo) {
    const { name, ch, ctrl, meta, shift, sequence } = keyInfo;

    // Single character commands
    if (!ctrl && !meta) {
      switch (name || ch) {
        case 'i':
          this.enterInteractiveMode();
          return true;

        case 'a':
          // Accept permission: send 'y' + Enter
          this._sendToSession('y', true);
          return true;

        case 'x':
          // Reject permission: send 'n' + Enter
          this._sendToSession('n', true);
          return true;

        case 'pageup':
          this.scrollUp(DEFAULT_PAGE_SIZE);
          return true;

        case 'pagedown':
          this.scrollDown(DEFAULT_PAGE_SIZE);
          return true;

        case 'up':
          this.scrollUp(1);
          return true;

        case 'down':
          this.scrollDown(1);
          return true;

        case 'home':
          this.scrollToTop();
          return true;

        case 'end':
          this.scrollToBottom();
          return true;

        case 'escape':
          // ESC in normal mode - let parent handle (switch tab/exit)
          return false;

        case 'c':
          // Ctrl+C in normal mode should be forwarded if shift held
          if (ctrl) {
            this._sendKeyToSession('ctrl-c');
            return true;
          }
          return false;
      }
    }

    // Space bar scrolls down a page
    if (ch === ' ' && !ctrl && !meta) {
      this.scrollDown(DEFAULT_PAGE_SIZE);
      return true;
    }

    // Ctrl+Home / Ctrl+End for top/bottom
    if (ctrl && name === 'home') {
      this.scrollToTop();
      return true;
    }
    if (ctrl && name === 'end') {
      this.scrollToBottom();
      return true;
    }

    return false;
  }

  /**
   * Handle input in interactive mode.
   * All keys are forwarded to the screen session except double-ESC to exit.
   * @param {Object} keyInfo - Normalized key info
   * @returns {boolean}
   * @private
   */
  _handleInteractiveInput(keyInfo) {
    const { name, ch, ctrl, sequence } = keyInfo;
    const now = Date.now();

    // Double-ESC detection to exit interactive mode
    if (name === 'escape' || sequence === '\x1b') {
      if (now - this._lastEscTime < DOUBLE_ESC_TIMEOUT) {
        // Double-ESC: exit interactive mode
        this._lastEscTime = 0;
        this.exitInteractiveMode();
        return true;
      }
      this._lastEscTime = now;
      // Don't send the first ESC yet - wait to see if it's a double
      // We'll send it on the next non-ESC key or after timeout
      return true;
    }

    // If we had a pending single ESC (timed out), send it first
    if (this._lastEscTime > 0 && now - this._lastEscTime >= DOUBLE_ESC_TIMEOUT) {
      this._sendKeyToSession('esc');
      this._lastEscTime = 0;
    }

    // Forward special keys
    if (ctrl && ch) {
      const ctrlKey = 'ctrl-' + ch;
      this._sendKeyToSession(ctrlKey);
      return true;
    }

    // Forward named keys
    if (name) {
      switch (name) {
        case 'return':
          this._sendKeyToSession('enter');
          return true;
        case 'backspace':
          this._sendKeyToSession('backspace');
          return true;
        case 'delete':
          this._sendKeyToSession('delete');
          return true;
        case 'tab':
          this._sendKeyToSession('tab');
          return true;
        case 'up':
          this._sendKeyToSession('up');
          return true;
        case 'down':
          this._sendKeyToSession('down');
          return true;
        case 'left':
          this._sendKeyToSession('left');
          return true;
        case 'right':
          this._sendKeyToSession('right');
          return true;
        case 'home':
          this._sendKeyToSession('home');
          return true;
        case 'end':
          this._sendKeyToSession('end');
          return true;
        case 'pageup':
          this._sendKeyToSession('page-up');
          return true;
        case 'pagedown':
          this._sendKeyToSession('page-down');
          return true;
        case 'insert':
          this._sendKeyToSession('insert');
          return true;
        case 'f1': case 'f2': case 'f3': case 'f4':
        case 'f5': case 'f6': case 'f7': case 'f8':
        case 'f9': case 'f10': case 'f11': case 'f12':
          this._sendKeyToSession(name);
          return true;
      }
    }

    // Forward printable characters as text
    if (ch && ch.length === 1 && ch.charCodeAt(0) >= 32) {
      this._sendToSession(ch, false);
      return true;
    }

    // Forward raw sequence if available
    if (sequence && sequence.length > 0) {
      this._sendToSession(sequence, false);
      return true;
    }

    return true; // Consume everything in interactive mode
  }

  /**
   * Normalize key input from various sources.
   * Handles both string input and readline-style key objects.
   * @param {string|Object} key
   * @returns {Object} Normalized key info: { name, ch, ctrl, meta, shift, sequence }
   * @private
   */
  _normalizeKey(key) {
    if (typeof key === 'string') {
      // Raw string input - interpret common sequences
      if (key === '\x1b') return { name: 'escape', ch: '', ctrl: false, meta: false, shift: false, sequence: '\x1b' };
      if (key === '\r' || key === '\n') return { name: 'return', ch: '', ctrl: false, meta: false, shift: false, sequence: key };
      if (key === '\x7f' || key === '\b') return { name: 'backspace', ch: '', ctrl: false, meta: false, shift: false, sequence: key };
      if (key === '\t') return { name: 'tab', ch: '', ctrl: false, meta: false, shift: false, sequence: key };
      if (key === ' ') return { name: '', ch: ' ', ctrl: false, meta: false, shift: false, sequence: key };

      // Arrow keys and special sequences
      if (key === '\x1b[A') return { name: 'up', ch: '', ctrl: false, meta: false, shift: false, sequence: key };
      if (key === '\x1b[B') return { name: 'down', ch: '', ctrl: false, meta: false, shift: false, sequence: key };
      if (key === '\x1b[C') return { name: 'right', ch: '', ctrl: false, meta: false, shift: false, sequence: key };
      if (key === '\x1b[D') return { name: 'left', ch: '', ctrl: false, meta: false, shift: false, sequence: key };
      if (key === '\x1b[5~') return { name: 'pageup', ch: '', ctrl: false, meta: false, shift: false, sequence: key };
      if (key === '\x1b[6~') return { name: 'pagedown', ch: '', ctrl: false, meta: false, shift: false, sequence: key };
      if (key === '\x1b[H' || key === '\x1b[1~') return { name: 'home', ch: '', ctrl: false, meta: false, shift: false, sequence: key };
      if (key === '\x1b[F' || key === '\x1b[4~') return { name: 'end', ch: '', ctrl: false, meta: false, shift: false, sequence: key };
      if (key === '\x1b[3~') return { name: 'delete', ch: '', ctrl: false, meta: false, shift: false, sequence: key };
      if (key === '\x1b[2~') return { name: 'insert', ch: '', ctrl: false, meta: false, shift: false, sequence: key };

      // Ctrl+key (ASCII 1-26)
      const code = key.charCodeAt(0);
      if (code >= 1 && code <= 26) {
        return {
          name: '',
          ch: String.fromCharCode(code + 96), // ctrl-a = 1 -> 'a'
          ctrl: true,
          meta: false,
          shift: false,
          sequence: key
        };
      }

      // Regular printable character
      return { name: '', ch: key, ctrl: false, meta: false, shift: false, sequence: key };
    }

    // Object key input (readline-style)
    if (key && typeof key === 'object') {
      return {
        name: key.name || '',
        ch: key.ch || key.character || '',
        ctrl: !!key.ctrl,
        meta: !!key.meta,
        shift: !!key.shift,
        sequence: key.sequence || ''
      };
    }

    return { name: '', ch: '', ctrl: false, meta: false, shift: false, sequence: '' };
  }

  // =========================================================================
  // Scroll Control
  // =========================================================================

  /**
   * Scroll up by the given number of lines.
   * Disables auto-follow when scrolling up.
   * @param {number} [lines=1] - Number of lines to scroll
   */
  scrollUp(lines = 1) {
    if (lines < 1) return;
    this._autoFollow = false;
    this._scrollOffset = Math.min(
      this._scrollOffset + lines,
      Math.max(0, this._lines.length - 1) // Don't scroll beyond top
    );
    this._invalidateCache();
  }

  /**
   * Scroll down by the given number of lines.
   * Re-enables auto-follow when reaching the bottom.
   * @param {number} [lines=1] - Number of lines to scroll
   */
  scrollDown(lines = 1) {
    if (lines < 1) return;
    this._scrollOffset = Math.max(0, this._scrollOffset - lines);
    if (this._scrollOffset === 0) {
      this._autoFollow = true;
    }
    this._invalidateCache();
  }

  /**
   * Scroll to the very top of the buffer.
   */
  scrollToTop() {
    this._autoFollow = false;
    this._scrollOffset = Math.max(0, this._lines.length - 1);
    this._invalidateCache();
  }

  /**
   * Scroll to the bottom and resume auto-follow.
   */
  scrollToBottom() {
    this._scrollOffset = 0;
    this._autoFollow = true;
    this._invalidateCache();
  }

  // =========================================================================
  // Interactive Mode
  // =========================================================================

  /**
   * Enter interactive mode.
   * All subsequent keystrokes are forwarded to the screen session.
   */
  enterInteractiveMode() {
    this._interactive = true;
    this._lastEscTime = 0;
    this._inputBuffer = '';

    // Ensure we're at the bottom and following
    this.scrollToBottom();
    this._invalidateCache();
  }

  /**
   * Exit interactive mode.
   * Keystrokes resume normal TUI navigation.
   */
  exitInteractiveMode() {
    this._interactive = false;
    this._lastEscTime = 0;
    this._inputBuffer = '';
    this._invalidateCache();
  }

  /**
   * Check if interactive mode is currently active.
   * @returns {boolean}
   */
  isInteractive() {
    return this._interactive;
  }

  // =========================================================================
  // Session Management
  // =========================================================================

  /**
   * Set the screen session to attach to.
   * @param {string} sessionName - GNU Screen session name
   */
  setSession(sessionName) {
    if (this.sessionName === sessionName) return;

    this.sessionName = sessionName;
    this._lines = [];
    this._scrollOffset = 0;
    this._autoFollow = true;

    if (this._capture) {
      this._capture.switchSession(sessionName);
    }

    this._checkSessionAlive();
    this._invalidateCache();
  }

  /**
   * Get the current session name.
   * @returns {string|null}
   */
  getSessionName() {
    return this.sessionName;
  }

  /**
   * Check if the screen session is alive.
   * @returns {boolean}
   */
  isSessionAlive() {
    return this._sessionAlive;
  }

  /**
   * Get session and capture statistics.
   * @returns {Object}
   */
  getStats() {
    const captureStats = this._capture ? this._capture.getStats() : null;
    return {
      sessionName: this.sessionName,
      sessionAlive: this._sessionAlive,
      interactive: this._interactive,
      autoFollow: this._autoFollow,
      scrollOffset: this._scrollOffset,
      totalLines: this._lines.length,
      captureMethod: this._captureMethod,
      lastUpdate: this._lastUpdateTime,
      capture: captureStats
    };
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Send text to the screen session.
   * @param {string} text - Text to send
   * @param {boolean} [pressEnter=false] - Whether to append Enter
   * @returns {boolean}
   * @private
   */
  _sendToSession(text, pressEnter = false) {
    if (!this._capture) return false;
    return this._capture.sendInput(text, pressEnter);
  }

  /**
   * Send a special key to the screen session.
   * @param {string} keyName - Key name from LiveScreenCapture.KEY_MAP
   * @returns {boolean}
   * @private
   */
  _sendKeyToSession(keyName) {
    if (!this._capture) return false;
    return this._capture.sendKey(keyName);
  }

  /**
   * Check if the session is alive and update status.
   * @private
   */
  _checkSessionAlive() {
    if (this._capture && typeof this._capture.isSessionAlive === 'function') {
      this._sessionAlive = this._capture.isSessionAlive();
    } else if (LiveScreenCapture && this.sessionName) {
      this._sessionAlive = LiveScreenCapture.sessionExists(this.sessionName);
    } else {
      this._sessionAlive = false;
    }
  }

  /**
   * Auto-discover a Claude screen session for the current project.
   * @private
   */
  _discoverSession() {
    const now = Date.now();
    // Rate-limit discovery to once every 5 seconds
    if (now - this._lastDiscoveryTime < 5000) return;
    this._lastDiscoveryTime = now;

    if (!LiveScreenCapture) return;

    // Look for Claude sessions
    const sessions = LiveScreenCapture.findClaudeSessions();

    if (sessions.length > 0) {
      // Prefer a session matching the project path
      const projectName = this.projectPath.split('/').filter(Boolean).pop();
      let bestSession = sessions[0];

      for (const s of sessions) {
        if (projectName && s.name.includes(projectName)) {
          bestSession = s;
          break;
        }
      }

      this._discoveredSession = bestSession.name;
      this.setSession(bestSession.name);
    }
  }

  /**
   * Invalidate the render cache, forcing a re-render on next call.
   * @private
   */
  _invalidateCache() {
    this._cachedRows = null;
    this._lastRenderScroll = -1;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = ClaudeLiveScreen;
