// ============================================================================
// TEAM COMMS PANEL - Real-time team message display
// ============================================================================

/**
 * TeamCommsPanel - Terminal-based UI for displaying team messages
 * Features:
 * - Polls team_messages table every 5 seconds using existing database pool
 * - Shows messages from last 60 seconds with sender, time, priority coloring
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
      case 'high': return c.brightYellow + '↑' + c.reset;
      case 'low': return c.dim + '↓' + c.reset;
      case 'normal':
      default: return c.dim + '•' + c.reset;
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
      // Empty state
      lines.push(c.dim + '  (no messages in last 60s)' + c.reset);
      for (let i = 1; i < contentHeight; i++) {
        lines.push('');
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
