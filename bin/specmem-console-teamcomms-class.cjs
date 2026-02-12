// ============================================================================
// TEAM COMMS PANEL - Real-time team message display
// ============================================================================
// Updated with AEGIS Theme truecolor support

// Graceful fallback: Import AegisTheme if available, otherwise use basic ANSI
let AegisTheme = null;
let AEGIS_COLORS = null;
try {
  const aegis = require('./AegisTheme.cjs');
  AegisTheme = aegis.AegisTheme;
  AEGIS_COLORS = aegis.AEGIS_COLORS;
} catch (_err) {
  // AegisTheme not available - will fall back to basic ANSI colors via `c` object
}

// ============================================================================
// AEGIS TRUECOLOR HELPERS
// ============================================================================

/**
 * Convert a hex color string to ANSI truecolor foreground escape sequence.
 * @param {string} hex - Hex color like '#00d4ff'
 * @returns {string} ANSI escape sequence, or empty string on failure
 */
function _hexFg(hex) {
  if (!hex || typeof hex !== 'string') return '';
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '';
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Convert a hex color string to ANSI truecolor background escape sequence.
 * @param {string} hex - Hex color like '#00d4ff'
 * @returns {string} ANSI escape sequence, or empty string on failure
 */
function _hexBg(hex) {
  if (!hex || typeof hex !== 'string') return '';
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '';
  return `\x1b[48;2;${r};${g};${b}m`;
}

// ============================================================================
// AEGIS COLOR CONSTANTS (truecolor with ANSI fallbacks)
// ============================================================================
// These resolve to truecolor escapes when available, or fall back to basic ANSI
// color names via the `c` object from the parent scope.

const AEGIS = {
  // Foreground colors
  cyan:       _hexFg('#00d4ff'),    // Primary accent - sender names, active borders
  cyanLight:  _hexFg('#66e5ff'),    // New message flash effect
  textDim:    _hexFg('#6a7a8a'),    // Timestamps, muted text
  yellow:     _hexFg('#ffd700'),    // High priority
  red:        _hexFg('#ff4444'),    // Urgent priority
  textPrimary: _hexFg('#e0e8f0'),   // Normal text
  textMuted:  _hexFg('#4a5a6a'),    // Low priority, scroll hints
  surface:    _hexFg('#1a2a3a'),    // Surface/dark text for badges
  border:     _hexFg('#2a3a4a'),    // Panel border color

  // Background colors
  bgCyan:     _hexBg('#00d4ff'),    // Unread badge background
  bgSurface:  _hexBg('#0d1520'),    // Panel header background (normal)

  // Reset
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m'
};

// Check if truecolor is usable (all values resolved to non-empty strings)
const _useAegis = AEGIS.cyan !== '' && AEGIS.red !== '';

/**
 * Get an AEGIS truecolor escape, falling back to a basic ANSI `c` color.
 * @param {string} aegisColor - AEGIS truecolor escape
 * @param {string} fallbackKey - Key from the `c` object (e.g. 'cyan', 'brightRed')
 * @returns {string} Resolved color escape
 */
function _color(aegisColor, fallbackKey) {
  if (_useAegis && aegisColor) return aegisColor;
  // Fallback to `c` object from parent scope
  try {
    return c[fallbackKey] || '';
  } catch (_e) {
    return '';
  }
}

/**
 * Format an AEGIS-style section header: "-- TITLE ------..."
 * Uses AEGIS cyan for the title, border color for the dashes.
 * @param {string} title - Header title text
 * @param {number} width - Total width of the header line
 * @returns {string} Formatted header string
 */
function _sectionHeader(title, width) {
  const rst = _color(AEGIS.reset, 'reset');
  const borderClr = _color(AEGIS.border, 'dim');
  const titleClr = _color(AEGIS.cyan, 'cyan');
  const bld = _color(AEGIS.bold, 'bold');

  const prefix = '\u2500\u2500 '; // "-- "
  const suffix = ' ';
  const titlePart = `${borderClr}${prefix}${rst}${titleClr}${bld}${title}${rst}${borderClr}${suffix}`;
  // Calculate remaining dash fill (title + prefix + suffix visible length)
  const usedWidth = 3 + title.length + 1; // "-- " + title + " "
  const remainingDashes = Math.max(0, width - usedWidth);
  return `${titlePart}${'\u2500'.repeat(remainingDashes)}${rst}`;
}

/**
 * TeamCommsPanel - Terminal-based UI for displaying team messages
 * Features:
 * - Polls team_messages table every 5 seconds using existing database pool
 * - Shows messages from last 60 seconds with sender, time, priority coloring
 * - Highlights new messages with 2-second flash effect (AEGIS cyanLight #66e5ff)
 * - Auto-scrolls to newest, allows manual scroll with up/down when focused
 * - Shows unread count badge (AEGIS cyan bg + dark text)
 * - Priority-based coloring: urgent=red (#ff4444), high=yellow (#ffd700), normal=white, low=dim
 * - AEGIS theme truecolor support with graceful fallback to basic ANSI
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
    this.messageRetentionSeconds = 60; // Query messages from last 60 seconds
    this.pollIntervalMs = 5000; // Poll every 5 seconds
  }

  /**
   * Start polling for team messages
   */
  start() {
    if (this.pollInterval) return; // Already running

    // Immediate poll on start
    this.poll();
    // Then poll every 5 seconds
    this.pollInterval = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  /**
   * Stop polling
   */
  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Fetch latest messages from database
   * Queries team_messages from last 60 seconds
   */
  async poll() {
    if (!this.pool) return;

    try {
      const client = await this.pool.connect();
      try {
        // Get messages from last 60 seconds, sorted by most recent first
        // Note: This query is project-aware via search_path in team comms DB
        const result = await client.query(`
          SELECT
            id, sender_id, sender_name, content, message_type, priority,
            created_at, mentions
          FROM team_messages
          WHERE created_at > NOW() - INTERVAL '60 seconds'
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

      } finally {
        client.release();
      }
    } catch (error) {
      // Silently fail - database might not be available yet
      // Panel will just show last cached messages
    }
  }

  /**
   * Get AEGIS truecolor escape for priority level.
   * Falls back to basic ANSI via `c` if AEGIS is unavailable.
   */
  getPriorityColor(priority) {
    const p = priority?.toLowerCase();
    switch (p) {
      case 'urgent': return _color(AEGIS.red, 'brightRed');        // #ff4444
      case 'high':   return _color(AEGIS.yellow, 'brightYellow');   // #ffd700
      case 'low':    return _color(AEGIS.textMuted, 'gray');        // #4a5a6a
      case 'normal':
      default:       return _color(AEGIS.textPrimary, 'white');     // #e0e8f0
    }
  }

  /**
   * Get visual icon for priority level with AEGIS coloring
   */
  getPriorityIcon(priority) {
    const rst = _color(AEGIS.reset, 'reset');
    const p = priority?.toLowerCase();
    switch (p) {
      case 'urgent': return _color(AEGIS.red, 'brightRed') + '!' + rst;
      case 'high':   return _color(AEGIS.yellow, 'brightYellow') + '\u2191' + rst;
      case 'low':    return _color(AEGIS.textMuted, 'dim') + '\u2193' + rst;
      case 'normal':
      default:       return _color(AEGIS.textDim, 'dim') + '\u2022' + rst;
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
   * AEGIS Theme Colors:
   * - Header: section header style ("-- TEAM COMMS ----")
   * - Unread badge: cyan bg (#00d4ff) + dark text (#1a2a3a)
   * - Sender names: cyan (#00d4ff)
   * - Timestamps: textDim (#6a7a8a)
   * - Priority urgent: red (#ff4444)
   * - Priority high: yellow (#ffd700)
   * - New message flash: cyanLight (#66e5ff)
   * - Border/separator: border (#2a3a4a), active: cyan (#00d4ff)
   *
   * Layout:
   * -- TEAM COMMS [2 unread] ------
   * \u2502 \u2022 Sender        HH:MM:SS Message \u2502
   * \u2502 \u2022 Sender        HH:MM:SS Message \u2502
   * \u2502 (scroll hints)                   \u2502
   * \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   */
  render(width = 60, height = 10) {
    const lines = [];
    const rst = _color(AEGIS.reset, 'reset');
    const borderClr = _color(AEGIS.border, 'dim');
    const cyanClr = _color(AEGIS.cyan, 'cyan');
    const dimClr = _color(AEGIS.textDim, 'dim');

    // Header: AEGIS section header style with optional unread badge
    let badgeStr = '';
    if (this.unreadCount > 0) {
      // Unread badge: AEGIS cyan bg + dark surface text
      const badgeBg = _useAegis ? AEGIS.bgCyan : (typeof c !== 'undefined' ? c.bgCyan : '\x1b[46m');
      const badgeFg = _useAegis ? _hexFg('#0d1520') : (typeof c !== 'undefined' ? c.black : '\x1b[30m');
      badgeStr = ` ${badgeBg}${badgeFg} ${this.unreadCount} unread ${rst}`;
    }

    // Use AEGIS-style section header: "-- TEAM COMMS [badge] ------"
    const headerTitle = `TEAM COMMS${badgeStr ? '' : ''}`;
    const headerLine = _sectionHeader(headerTitle, width) + badgeStr;
    lines.push(headerLine);

    // Separator line using AEGIS border color
    const activeBorderClr = this.focused ? cyanClr : borderClr;
    lines.push(activeBorderClr + '\u2500'.repeat(width) + rst);

    // Message display area (most recent at top)
    const contentHeight = Math.max(3, height - 4);
    const displayCount = Math.min(this.messages.length, contentHeight);
    const startIdx = this.scrollOffset;
    const endIdx = Math.min(startIdx + displayCount, this.messages.length);

    if (this.messages.length === 0) {
      // Empty state
      lines.push(dimClr + '  (no messages in last 60s)' + rst);
      for (let i = 1; i < contentHeight; i++) {
        lines.push('');
      }
    } else {
      // Render message lines
      for (let i = startIdx; i < endIdx; i++) {
        const msg = this.messages[i];
        const priorityIcon = this.getPriorityIcon(msg.priority);

        // Timestamp in AEGIS textDim (#6a7a8a)
        const timeStr = dimClr + this.formatTime(msg.timestamp) + rst;

        // Truncate sender name to 12 chars for alignment
        const senderName = msg.sender.substring(0, 12).padEnd(12);

        // Sender name in AEGIS cyan (#00d4ff)
        const senderDisplay = cyanClr + senderName + rst;

        // Use flash color for new messages, otherwise priority color
        let contentColor = this.getPriorityColor(msg.priority);
        if (msg.isFlashing) {
          // Flash effect: AEGIS cyanLight (#66e5ff) + bold
          contentColor = _color(AEGIS.cyanLight, 'brightCyan') + _color(AEGIS.bold, 'bold');
        }

        // Truncate message content to fit width
        const contentMaxLen = Math.max(1, width - 30);
        const truncatedContent = msg.content.substring(0, contentMaxLen);
        const contentDisplay = truncatedContent.length < msg.content.length
          ? truncatedContent + '...'
          : truncatedContent;

        const msgLine = `  ${priorityIcon} ${senderDisplay} ${timeStr} ${contentColor}${contentDisplay}${rst}`;
        lines.push(msgLine);
      }

      // Pad remaining content lines
      const displayedLines = Math.min(displayCount, this.messages.length);
      for (let i = displayedLines; i < contentHeight; i++) {
        lines.push('');
      }
    }

    // Footer separator using AEGIS border color (active = cyan when focused)
    lines.push(activeBorderClr + '\u2500'.repeat(width) + rst);

    // Footer with scroll instructions in AEGIS textDim
    let scrollHint = dimClr + '(auto-scroll enabled)' + rst;
    if (this.scrollOffset > 0) {
      scrollHint = dimClr + '(scrolled, press down to return to auto-scroll)' + rst;
    } else if (this.messages.length > displayCount) {
      scrollHint = dimClr + '(press up to scroll, down to auto-scroll)' + rst;
    }
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

  /**
   * Check if AEGIS theme truecolor is active for this panel
   * @returns {boolean} True if AEGIS truecolor colors are being used
   */
  static isAegisActive() {
    return _useAegis;
  }
}
