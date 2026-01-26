'use strict';

// ============================================================================
// TAB MANAGER - Tab/Screen Management System for SpecMem TUI
// ============================================================================
//
// Inspired by AEGIS Trainer's TabbedContent system. Provides:
//   - 8 switchable full-screen tabs (keys 1-8)
//   - Responsive tab bar with AEGIS-style box-drawing borders
//   - Status bar with mode badge, inline stats, and key hints
//   - Instant tab switching with activate/deactivate lifecycle
//   - Terminal resize handling (SIGWINCH)
//
// Tabs:
//   1. Dashboard    - 4-quadrant overview (QuadrantRenderer)
//   2. Claude Live  - Full-screen live Claude preview with ANSI colors
//   3. Memories     - Memory browser/search
//   4. Team         - Team member status and communication
//   5. Tools        - MCP tool call history
//   6. Sessions     - Claude session manager
//   7. Logs         - System logs viewer
//   8. Config       - Settings and configuration
//
// Usage:
//   const { TabManager, Tab, StatusBar } = require('./TabManager.cjs');
//   const mgr = new TabManager({ width: 120, height: 40 });
//   mgr.addTab(new Tab({ id: 'dashboard', label: 'Dashboard', key: '1', ... }));
//   mgr.switchTab('1');
//
// @author SpecMem TUI Team
// ============================================================================

// Try to import AegisTheme (built by another agent), fall back to inline defaults
let AegisTheme, AEGIS_ICONS;
try {
  const aegis = require('./AegisTheme.cjs');
  AegisTheme = aegis.AegisTheme;
  AEGIS_ICONS = aegis.AEGIS_ICONS;
} catch (_e) {
  // Fallback theme when AegisTheme.cjs is not yet available
  AegisTheme = null;
  AEGIS_ICONS = null;
}

// ============================================================================
// ANSI Color Constants (fallback when AegisTheme unavailable)
// ============================================================================
const ANSI = {
  reset:       '\x1b[0m',
  bold:        '\x1b[1m',
  dim:         '\x1b[2m',
  italic:      '\x1b[3m',
  underline:   '\x1b[4m',
  inverse:     '\x1b[7m',
  // Foreground
  black:       '\x1b[30m',
  red:         '\x1b[31m',
  green:       '\x1b[32m',
  yellow:      '\x1b[33m',
  blue:        '\x1b[34m',
  magenta:     '\x1b[35m',
  cyan:        '\x1b[36m',
  white:       '\x1b[37m',
  gray:        '\x1b[90m',
  // Bright foreground
  brightRed:    '\x1b[91m',
  brightGreen:  '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue:   '\x1b[94m',
  brightMagenta:'\x1b[95m',
  brightCyan:   '\x1b[96m',
  brightWhite:  '\x1b[97m',
  // Background
  bgBlack:     '\x1b[40m',
  bgRed:       '\x1b[41m',
  bgGreen:     '\x1b[42m',
  bgYellow:    '\x1b[43m',
  bgBlue:      '\x1b[44m',
  bgMagenta:   '\x1b[45m',
  bgCyan:      '\x1b[46m',
  bgWhite:     '\x1b[47m',
  bgGray:      '\x1b[100m',
  bgBrightCyan: '\x1b[106m',
  // 256-color
  orange:       '\x1b[38;5;208m',
  bgOrange:     '\x1b[48;5;208m',
  // Truecolor AEGIS palette
  aegisCyan:    '\x1b[38;2;0;255;255m',
  aegisOrange:  '\x1b[38;2;255;165;0m',
  aegisMagenta: '\x1b[38;2;200;100;255m',
  aegisGold:    '\x1b[38;2;255;215;0m',
  aegisDim:     '\x1b[38;2;100;100;120m',
  bgAegisDark:  '\x1b[48;2;15;15;25m',
};

// ============================================================================
// Default Icons
// ============================================================================
const DEFAULT_ICONS = {
  dashboard:   '\u25C8',  // diamond with dot
  claudeLive:  '\u25C6',  // filled diamond
  memories:    '\u25CB',  // circle
  team:        '\u25A0',  // filled square
  tools:       '\u2699',  // gear
  sessions:    '\u25B6',  // play triangle
  logs:        '\u2261',  // triple bar
  config:      '\u2630',  // trigram
  active:      '\u25CF',  // filled circle (active tab indicator)
  inactive:    '\u25C7',  // hollow diamond (inactive tab indicator)
  separator:   '\u2502',  // vertical line
  hLine:       '\u2500',  // horizontal line
  cornerTL:    '\u256D',  // rounded top-left
  cornerTR:    '\u256E',  // rounded top-right
  cornerBL:    '\u2570',  // rounded bottom-left
  cornerBR:    '\u256F',  // rounded bottom-right
};

// ============================================================================
// Helper: strip ANSI escape codes for visible length calculation
// ============================================================================
function stripAnsi(str) {
  if (!str) return '';
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLength(str) {
  return stripAnsi(str).length;
}

// Pad a string (ANSI-aware) to a given visible width
function padRight(str, width) {
  const vLen = visibleLength(str);
  if (vLen >= width) return str;
  return str + ' '.repeat(width - vLen);
}

// Center a string (ANSI-aware) within a given visible width
function centerStr(str, width) {
  const vLen = visibleLength(str);
  if (vLen >= width) return str;
  const leftPad = Math.floor((width - vLen) / 2);
  const rightPad = width - vLen - leftPad;
  return ' '.repeat(leftPad) + str + ' '.repeat(rightPad);
}

// Truncate string (ANSI-aware) to maxLen visible characters
function truncateAnsi(str, maxLen) {
  if (!str) return '';
  const plain = stripAnsi(str);
  if (plain.length <= maxLen) return str;

  let visibleLen = 0;
  let result = '';
  let i = 0;
  while (i < str.length && visibleLen < maxLen - 1) {
    if (str[i] === '\x1b') {
      const end = str.indexOf('m', i);
      if (end !== -1) {
        result += str.substring(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    result += str[i];
    visibleLen++;
    i++;
  }
  return result + '\u2026' + ANSI.reset; // ellipsis
}


// ============================================================================
// TAB CLASS
// ============================================================================

/**
 * Tab - Represents a single tab/screen in the TUI.
 *
 * Each tab has its own render function, input handler, and lifecycle hooks.
 * Tabs are registered with TabManager and switched via number keys 1-8.
 */
class Tab {
  /**
   * @param {Object} options
   * @param {string} options.id             - Unique identifier (e.g. 'dashboard', 'claude-live')
   * @param {string} options.label          - Display name shown in tab bar
   * @param {string} options.key            - Keyboard shortcut ('1' through '8')
   * @param {string} [options.icon]         - Unicode icon character
   * @param {Function} options.render       - function(width, height) -> string[] (array of lines)
   * @param {Function} [options.handleInput]- function(key) -> boolean (true if consumed)
   * @param {Function} [options.onActivate] - Called when tab becomes active
   * @param {Function} [options.onDeactivate] - Called when tab loses focus
   * @param {number} [options.updateInterval] - Refresh interval in ms (default 1000)
   * @param {Function} [options.update]     - async function() to refresh tab data
   * @param {boolean} [options.fullScreen]  - Whether tab uses full screen (no quadrants)
   */
  constructor(options) {
    if (!options || !options.id) {
      throw new Error('Tab requires at least an id');
    }

    this.id = options.id;
    this.label = options.label || options.id;
    this.key = options.key || '0';
    this.icon = options.icon || DEFAULT_ICONS.inactive;
    this.render = options.render || (() => []);
    this.handleInput = options.handleInput || (() => false);
    this.onActivate = options.onActivate || (() => {});
    this.onDeactivate = options.onDeactivate || (() => {});
    this.updateInterval = options.updateInterval || 1000;
    this.update = options.update || (async () => {});
    this.fullScreen = options.fullScreen !== undefined ? options.fullScreen : true;

    // Internal state
    this._active = false;
    this._lastUpdate = 0;
    this._dirty = true;
    this._cachedLines = [];
    this._errorState = null;
  }

  /**
   * Check if this tab needs a data refresh based on updateInterval.
   * @returns {boolean}
   */
  needsUpdate() {
    return Date.now() - this._lastUpdate >= this.updateInterval;
  }

  /**
   * Mark this tab as needing re-render.
   */
  markDirty() {
    this._dirty = true;
  }

  /**
   * Safely run the update function, catching errors.
   */
  async safeUpdate() {
    try {
      await this.update();
      this._lastUpdate = Date.now();
      this._errorState = null;
      this._dirty = true;
    } catch (err) {
      this._errorState = err.message || String(err);
    }
  }

  /**
   * Safely render content, catching errors and returning error display.
   * @param {number} width
   * @param {number} height
   * @returns {string[]}
   */
  safeRender(width, height) {
    try {
      if (this._errorState) {
        return this._renderError(width, height);
      }
      const lines = this.render(width, height);
      this._cachedLines = Array.isArray(lines) ? lines : [];
      this._dirty = false;
      return this._cachedLines;
    } catch (err) {
      this._errorState = err.message || String(err);
      return this._renderError(width, height);
    }
  }

  /**
   * Render an error state for this tab.
   * @param {number} width
   * @param {number} height
   * @returns {string[]}
   */
  _renderError(width, height) {
    const lines = [];
    const emptyLine = ' '.repeat(width);
    const topPad = Math.max(0, Math.floor(height / 2) - 3);

    for (let i = 0; i < topPad; i++) {
      lines.push(emptyLine);
    }

    const errTitle = `${ANSI.bold}${ANSI.red}  Error in ${this.label}  ${ANSI.reset}`;
    lines.push(centerStr(errTitle, width));
    lines.push(emptyLine);

    const errMsg = truncateAnsi(this._errorState || 'Unknown error', width - 10);
    lines.push(centerStr(`${ANSI.dim}${errMsg}${ANSI.reset}`, width));
    lines.push(emptyLine);
    lines.push(centerStr(`${ANSI.dim}Press the tab key to retry${ANSI.reset}`, width));

    while (lines.length < height) {
      lines.push(emptyLine);
    }

    return lines.slice(0, height);
  }
}


// ============================================================================
// TAB MANAGER CLASS
// ============================================================================

/**
 * TabManager - Manages multiple tabs, handles switching, rendering, and input routing.
 *
 * Renders a tab bar at the top, the active tab's content in the middle,
 * and a status bar at the bottom. Handles terminal resize via SIGWINCH.
 */
class TabManager {
  /**
   * @param {Object} options
   * @param {number} [options.width]     - Terminal width (default: process.stdout.columns)
   * @param {number} [options.height]    - Terminal height (default: process.stdout.rows)
   * @param {Object} [options.theme]     - AegisTheme instance (optional)
   * @param {StatusBar} [options.statusBar] - StatusBar instance (optional, created if not provided)
   * @param {boolean} [options.showTabBar] - Whether to show tab bar (default: true)
   * @param {boolean} [options.showStatusBar] - Whether to show status bar (default: true)
   */
  constructor(options = {}) {
    this.width = options.width || (process.stdout.columns || 120);
    this.height = options.height || (process.stdout.rows || 40);
    this.theme = options.theme || null;
    this.showTabBar = options.showTabBar !== undefined ? options.showTabBar : true;
    this.showStatusBar = options.showStatusBar !== undefined ? options.showStatusBar : true;

    /** @type {Map<string, Tab>} tabs indexed by ID */
    this._tabs = new Map();

    /** @type {string[]} tab IDs in insertion order */
    this._tabOrder = [];

    /** @type {Map<string, string>} key -> tab ID mapping */
    this._keyMap = new Map();

    /** @type {string|null} currently active tab ID */
    this._activeTabId = null;

    /** @type {StatusBar} */
    this.statusBar = options.statusBar || new StatusBar({
      theme: this.theme,
    });

    /** @type {number|null} SIGWINCH listener reference */
    this._resizeHandler = null;

    /** @type {Function|null} callback when tab changes */
    this._onTabChange = options.onTabChange || null;

    /** @type {number|null} update timer ID */
    this._updateTimer = null;

    /** @type {boolean} whether the manager is running */
    this._running = false;

    // Bind resize handler
    this._handleResize = this._handleResize.bind(this);
  }

  // --------------------------------------------------------------------------
  // Tab Registration
  // --------------------------------------------------------------------------

  /**
   * Register a tab with the manager.
   * @param {Tab} tab - Tab instance to register
   * @returns {TabManager} this (for chaining)
   */
  addTab(tab) {
    if (!(tab instanceof Tab)) {
      throw new Error('addTab requires a Tab instance');
    }
    if (this._tabs.has(tab.id)) {
      throw new Error(`Tab with id '${tab.id}' already registered`);
    }

    this._tabs.set(tab.id, tab);
    this._tabOrder.push(tab.id);
    this._keyMap.set(tab.key, tab.id);

    // Auto-activate first tab
    if (this._activeTabId === null) {
      this._activeTabId = tab.id;
      tab._active = true;
      try { tab.onActivate(); } catch (_e) { /* swallow */ }
    }

    return this;
  }

  /**
   * Remove a tab by ID.
   * @param {string} id
   * @returns {boolean} whether the tab was found and removed
   */
  removeTab(id) {
    const tab = this._tabs.get(id);
    if (!tab) return false;

    if (tab._active) {
      try { tab.onDeactivate(); } catch (_e) { /* swallow */ }
    }

    this._tabs.delete(id);
    this._tabOrder = this._tabOrder.filter(tid => tid !== id);
    this._keyMap.delete(tab.key);

    // If we removed the active tab, switch to first available
    if (this._activeTabId === id) {
      this._activeTabId = this._tabOrder.length > 0 ? this._tabOrder[0] : null;
      if (this._activeTabId) {
        const newActive = this._tabs.get(this._activeTabId);
        if (newActive) {
          newActive._active = true;
          try { newActive.onActivate(); } catch (_e) { /* swallow */ }
        }
      }
    }

    return true;
  }

  /**
   * Get a tab by ID.
   * @param {string} id
   * @returns {Tab|undefined}
   */
  getTab(id) {
    return this._tabs.get(id);
  }

  /**
   * Get all registered tabs in order.
   * @returns {Tab[]}
   */
  getAllTabs() {
    return this._tabOrder.map(id => this._tabs.get(id)).filter(Boolean);
  }

  /**
   * Get the number of registered tabs.
   * @returns {number}
   */
  getTabCount() {
    return this._tabs.size;
  }

  // --------------------------------------------------------------------------
  // Tab Switching
  // --------------------------------------------------------------------------

  /**
   * Switch to a tab by ID or key number.
   * @param {string} idOrKey - Tab ID (e.g. 'dashboard') or key (e.g. '1')
   * @returns {boolean} whether the switch was successful
   */
  switchTab(idOrKey) {
    // Resolve key to ID if it's a number key
    let targetId = idOrKey;
    if (this._keyMap.has(idOrKey)) {
      targetId = this._keyMap.get(idOrKey);
    }

    const targetTab = this._tabs.get(targetId);
    if (!targetTab) return false;

    // Already active? No-op
    if (this._activeTabId === targetId) return true;

    // Deactivate current
    const currentTab = this._tabs.get(this._activeTabId);
    if (currentTab) {
      currentTab._active = false;
      try { currentTab.onDeactivate(); } catch (_e) { /* swallow */ }
    }

    // Activate new
    this._activeTabId = targetId;
    targetTab._active = true;
    targetTab._dirty = true;
    try { targetTab.onActivate(); } catch (_e) { /* swallow */ }

    // Update status bar mode
    this.statusBar.setMode(this._getModeForTab(targetId));

    // Fire callback
    if (this._onTabChange) {
      try { this._onTabChange(targetId, targetTab); } catch (_e) { /* swallow */ }
    }

    return true;
  }

  /**
   * Switch to the next tab (wraps around).
   * @returns {boolean}
   */
  nextTab() {
    if (this._tabOrder.length === 0) return false;
    const currentIdx = this._tabOrder.indexOf(this._activeTabId);
    const nextIdx = (currentIdx + 1) % this._tabOrder.length;
    return this.switchTab(this._tabOrder[nextIdx]);
  }

  /**
   * Switch to the previous tab (wraps around).
   * @returns {boolean}
   */
  prevTab() {
    if (this._tabOrder.length === 0) return false;
    const currentIdx = this._tabOrder.indexOf(this._activeTabId);
    const prevIdx = (currentIdx - 1 + this._tabOrder.length) % this._tabOrder.length;
    return this.switchTab(this._tabOrder[prevIdx]);
  }

  /**
   * Get the currently active tab.
   * @returns {Tab|null}
   */
  getActiveTab() {
    return this._tabs.get(this._activeTabId) || null;
  }

  /**
   * Get the active tab's ID.
   * @returns {string|null}
   */
  getActiveTabId() {
    return this._activeTabId;
  }

  /**
   * Map tab IDs to status bar mode names.
   * @param {string} tabId
   * @returns {string}
   */
  _getModeForTab(tabId) {
    const modeMap = {
      'dashboard':   'SPECMEM',
      'claude-live': 'CLAUDE',
      'memories':    'SPECMEM',
      'team':        'TEAM',
      'tools':       'TOOLS',
      'sessions':    'CLAUDE',
      'logs':        'LOGS',
      'config':      'CONFIG',
    };
    return modeMap[tabId] || 'COMMAND';
  }

  // --------------------------------------------------------------------------
  // Rendering: Tab Bar
  // --------------------------------------------------------------------------

  /**
   * Render the tab bar (top of screen).
   *
   * Full width:
   *   ╭─ [1]●Dashboard ─ [2]◆Claude ─ [3]◆Memories ─ ... ─╮
   *
   * Narrow width (icons only):
   *   ╭─ 1● 2◆ 3◆ 4◆ 5◆ 6◆ 7◆ 8◆ ─╮
   *
   * @param {number} [width] - Override width
   * @returns {string} Single rendered line with ANSI codes
   */
  renderTabBar(width) {
    const w = width || this.width;
    const icons = this._getIcons();

    // Build tab entries
    const tabEntries = [];
    for (const tabId of this._tabOrder) {
      const tab = this._tabs.get(tabId);
      if (!tab) continue;

      const isActive = tab.id === this._activeTabId;
      tabEntries.push({
        tab,
        isActive,
      });
    }

    if (tabEntries.length === 0) {
      // No tabs: just draw an empty bar
      const emptyBar = icons.cornerTL + icons.hLine.repeat(Math.max(0, w - 2)) + icons.cornerTR;
      return `${ANSI.dim}${emptyBar}${ANSI.reset}`;
    }

    // Calculate if we need compact mode
    // Full mode: " [1]●Dashboard " per tab = ~16 chars each + borders
    const fullEntryWidths = tabEntries.map(e => ` [${e.tab.key}]${e.isActive ? icons.active : icons.inactive}${e.tab.label} `);
    const fullTotalWidth = fullEntryWidths.reduce((sum, s) => sum + s.length, 0) + 4; // +4 for corners and padding

    // Compact mode: " 1● " per tab = ~4 chars each
    const compactEntryWidths = tabEntries.map(e => ` ${e.tab.key}${e.isActive ? icons.active : icons.inactive} `);
    const compactTotalWidth = compactEntryWidths.reduce((sum, s) => sum + s.length, 0) + 4;

    // Medium mode: " [1]●Dash " per tab (truncated labels)
    const useCompact = fullTotalWidth > w;
    const useUltraCompact = compactTotalWidth > w;

    // Build the bar content
    let barContent = '';
    const barContentParts = [];

    for (let i = 0; i < tabEntries.length; i++) {
      const entry = tabEntries[i];
      const tab = entry.tab;
      const isActive = entry.isActive;

      const indicator = isActive ? icons.active : icons.inactive;
      let part;

      if (useUltraCompact) {
        // Ultra compact: just number + dot
        if (isActive) {
          part = `${ANSI.bold}${ANSI.brightCyan}${tab.key}${indicator}${ANSI.reset}`;
        } else {
          part = `${ANSI.dim}${tab.key}${indicator}${ANSI.reset}`;
        }
      } else if (useCompact) {
        // Compact: [key]indicator + abbreviated label
        const shortLabel = tab.label.substring(0, 4);
        if (isActive) {
          part = `${ANSI.bold}${ANSI.brightCyan}[${tab.key}]${indicator}${shortLabel}${ANSI.reset}`;
        } else {
          part = `${ANSI.dim}[${tab.key}]${indicator}${shortLabel}${ANSI.reset}`;
        }
      } else {
        // Full: [key]indicator + label
        if (isActive) {
          part = `${ANSI.bold}${ANSI.brightCyan}[${tab.key}]${indicator}${tab.label}${ANSI.reset}`;
        } else {
          part = `${ANSI.dim}[${tab.key}]${indicator}${tab.label}${ANSI.reset}`;
        }
      }

      barContentParts.push(part);
    }

    // Join with separators
    const separator = ` ${ANSI.dim}${icons.hLine}${ANSI.reset} `;
    barContent = barContentParts.join(separator);

    // Calculate visible content length for padding
    const contentVisible = visibleLength(barContent);

    // Build full bar with corners
    const leftBorder = `${ANSI.dim}${icons.cornerTL}${icons.hLine}${ANSI.reset} `;
    const rightBorderBase = ` ${ANSI.dim}`;
    const leftBorderLen = 3; // cornerTL + hLine + space
    const rightBorderMinLen = 2; // space + cornerTR

    const remainingWidth = w - leftBorderLen - contentVisible - rightBorderMinLen;
    const fillChars = Math.max(0, remainingWidth);
    const rightBorder = `${rightBorderBase}${icons.hLine.repeat(fillChars)}${icons.cornerTR}${ANSI.reset}`;

    return leftBorder + barContent + rightBorder;
  }

  // --------------------------------------------------------------------------
  // Rendering: Tab Content
  // --------------------------------------------------------------------------

  /**
   * Render the active tab's content area.
   * @param {number} [width]  - Override width
   * @param {number} [height] - Override height (content area only, excluding bars)
   * @returns {string[]} Array of rendered lines
   */
  renderContent(width, height) {
    const w = width || this.width;
    const h = height || this._getContentHeight();

    const activeTab = this.getActiveTab();
    if (!activeTab) {
      return this._renderEmptyContent(w, h);
    }

    const lines = activeTab.safeRender(w, h);

    // Ensure we have exactly h lines, each padded/truncated to width
    const result = [];
    for (let i = 0; i < h; i++) {
      if (i < lines.length && lines[i] != null) {
        const line = String(lines[i]);
        const vLen = visibleLength(line);
        if (vLen < w) {
          result.push(line + ' '.repeat(w - vLen));
        } else if (vLen > w) {
          result.push(truncateAnsi(line, w));
        } else {
          result.push(line);
        }
      } else {
        result.push(' '.repeat(w));
      }
    }

    return result;
  }

  /**
   * Render empty/no-tab content.
   * @param {number} w
   * @param {number} h
   * @returns {string[]}
   */
  _renderEmptyContent(w, h) {
    const lines = [];
    const empty = ' '.repeat(w);
    const topPad = Math.max(0, Math.floor(h / 2) - 2);

    for (let i = 0; i < topPad; i++) lines.push(empty);

    lines.push(centerStr(`${ANSI.dim}No tabs registered${ANSI.reset}`, w));
    lines.push(empty);
    lines.push(centerStr(`${ANSI.dim}Use addTab() to register screens${ANSI.reset}`, w));

    while (lines.length < h) lines.push(empty);
    return lines.slice(0, h);
  }

  /**
   * Calculate content area height (total height minus tab bar and status bar).
   * @returns {number}
   */
  _getContentHeight() {
    let reserved = 0;
    if (this.showTabBar) reserved += 1;     // Tab bar takes 1 line
    if (this.showStatusBar) reserved += 1;  // Status bar takes 1 line
    return Math.max(1, this.height - reserved);
  }

  // --------------------------------------------------------------------------
  // Rendering: Full Screen Composition
  // --------------------------------------------------------------------------

  /**
   * Render the complete screen: tab bar + content + status bar.
   * @param {number} [width]  - Override width
   * @param {number} [height] - Override height
   * @returns {string[]} Array of all lines for the full screen
   */
  renderFullScreen(width, height) {
    const w = width || this.width;
    const h = height || this.height;

    const output = [];

    // 1. Tab bar (1 line)
    if (this.showTabBar) {
      output.push(this.renderTabBar(w));
    }

    // 2. Content area
    const contentHeight = h - (this.showTabBar ? 1 : 0) - (this.showStatusBar ? 1 : 0);
    const contentLines = this.renderContent(w, contentHeight);
    for (const line of contentLines) {
      output.push(line);
    }

    // 3. Status bar (1 line)
    if (this.showStatusBar) {
      output.push(this.statusBar.render(w));
    }

    return output;
  }

  /**
   * Render full screen as a single string (for direct terminal output).
   * @param {number} [width]
   * @param {number} [height]
   * @returns {string}
   */
  renderFullScreenString(width, height) {
    return this.renderFullScreen(width, height).join('\n');
  }

  // --------------------------------------------------------------------------
  // Input Handling
  // --------------------------------------------------------------------------

  /**
   * Route keyboard input. Checks for tab-switch keys first, then delegates
   * to the active tab's handleInput.
   *
   * @param {string|Buffer} key - Key or key sequence
   * @param {Object} [keyInfo] - Optional key info object from readline
   * @returns {boolean} true if the input was consumed
   */
  handleInput(key, keyInfo) {
    const keyStr = typeof key === 'string' ? key : (key ? key.toString() : '');

    // Tab switching via number keys 1-9 (only if active tab doesn't consume it first)
    // We check tab switching AFTER the active tab to allow tabs to override number keys
    // But typically, number keys should always switch tabs (AEGIS behavior)

    // Check for tab navigation keys first (AEGIS pattern: number keys always switch)
    if (keyStr.length === 1 && keyStr >= '1' && keyStr <= '9') {
      if (this._keyMap.has(keyStr)) {
        return this.switchTab(keyStr);
      }
    }

    // Tab/Shift+Tab for sequential navigation
    if (keyInfo && keyInfo.name === 'tab') {
      if (keyInfo.shift) {
        return this.prevTab();
      }
      return this.nextTab();
    }

    // Delegate to active tab
    const activeTab = this.getActiveTab();
    if (activeTab && activeTab.handleInput) {
      try {
        return activeTab.handleInput(keyStr, keyInfo);
      } catch (_e) {
        return false;
      }
    }

    return false;
  }

  // --------------------------------------------------------------------------
  // Update Loop
  // --------------------------------------------------------------------------

  /**
   * Update the active tab's data if it needs refreshing.
   * Call this from your main event loop or use startUpdateLoop().
   */
  async update() {
    const activeTab = this.getActiveTab();
    if (activeTab && activeTab.needsUpdate()) {
      await activeTab.safeUpdate();
    }
  }

  /**
   * Start an automatic update loop that refreshes the active tab.
   * @param {number} [intervalMs=500] - How often to check for updates
   * @returns {TabManager} this
   */
  startUpdateLoop(intervalMs) {
    const interval = intervalMs || 500;
    this.stopUpdateLoop();
    this._running = true;

    const tick = async () => {
      if (!this._running) return;
      try {
        await this.update();
      } catch (_e) { /* swallow */ }
      if (this._running) {
        this._updateTimer = setTimeout(tick, interval);
      }
    };

    this._updateTimer = setTimeout(tick, interval);
    return this;
  }

  /**
   * Stop the automatic update loop.
   * @returns {TabManager} this
   */
  stopUpdateLoop() {
    this._running = false;
    if (this._updateTimer) {
      clearTimeout(this._updateTimer);
      this._updateTimer = null;
    }
    return this;
  }

  // --------------------------------------------------------------------------
  // Terminal Resize
  // --------------------------------------------------------------------------

  /**
   * Handle terminal resize. Updates dimensions and marks active tab dirty.
   */
  _handleResize() {
    this.width = process.stdout.columns || 120;
    this.height = process.stdout.rows || 40;

    // Mark active tab dirty so it re-renders at new dimensions
    const activeTab = this.getActiveTab();
    if (activeTab) {
      activeTab.markDirty();
    }
  }

  /**
   * Start listening for terminal resize events.
   * @returns {TabManager} this
   */
  listenForResize() {
    if (process.stdout.isTTY) {
      process.stdout.on('resize', this._handleResize);
    }
    // Also handle SIGWINCH directly for robustness
    try {
      process.on('SIGWINCH', this._handleResize);
    } catch (_e) { /* may not be available on all platforms */ }
    return this;
  }

  /**
   * Stop listening for terminal resize events.
   * @returns {TabManager} this
   */
  stopListeningForResize() {
    if (process.stdout.isTTY) {
      process.stdout.removeListener('resize', this._handleResize);
    }
    try {
      process.removeListener('SIGWINCH', this._handleResize);
    } catch (_e) { /* swallow */ }
    return this;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Start the tab manager (resize listener + update loop).
   * @param {number} [updateIntervalMs=500]
   * @returns {TabManager} this
   */
  start(updateIntervalMs) {
    this.listenForResize();
    this.startUpdateLoop(updateIntervalMs);
    return this;
  }

  /**
   * Stop the tab manager and clean up.
   * @returns {TabManager} this
   */
  stop() {
    this.stopUpdateLoop();
    this.stopListeningForResize();

    // Deactivate current tab
    const activeTab = this.getActiveTab();
    if (activeTab) {
      activeTab._active = false;
      try { activeTab.onDeactivate(); } catch (_e) { /* swallow */ }
    }

    return this;
  }

  /**
   * Set the terminal dimensions explicitly.
   * @param {number} width
   * @param {number} height
   * @returns {TabManager} this
   */
  setDimensions(width, height) {
    this.width = width;
    this.height = height;
    const activeTab = this.getActiveTab();
    if (activeTab) activeTab.markDirty();
    return this;
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Get icon characters, preferring AegisTheme/AEGIS_ICONS if available.
   * @returns {Object}
   */
  _getIcons() {
    if (AEGIS_ICONS) {
      return Object.assign({}, DEFAULT_ICONS, AEGIS_ICONS);
    }
    return DEFAULT_ICONS;
  }

  /**
   * Get a color from the theme or fallback to ANSI constants.
   * @param {string} name - Color name (e.g. 'cyan', 'aegisCyan')
   * @returns {string} ANSI escape code
   */
  _getColor(name) {
    if (this.theme && typeof this.theme.getColor === 'function') {
      const c = this.theme.getColor(name);
      if (c) return c;
    }
    return ANSI[name] || ANSI.reset;
  }
}


// ============================================================================
// STATUS BAR CLASS
// ============================================================================

/**
 * StatusBar - Renders a status bar at the bottom of the TUI screen.
 *
 * Layout:
 *   [MODE] | status message | session info | key hints
 *
 * Mode badge colors:
 *   CLAUDE  -> green background
 *   SPECMEM -> magenta background
 *   COMMAND -> blue background
 *   TEAM    -> cyan background
 *   TOOLS   -> orange/yellow background
 *   LOGS    -> gray background
 *   CONFIG  -> blue background
 */
class StatusBar {
  /**
   * @param {Object} [options]
   * @param {Object} [options.theme]     - AegisTheme instance
   * @param {string} [options.mode]      - Initial mode ('COMMAND')
   * @param {string} [options.status]    - Initial status text
   * @param {string} [options.info]      - Initial info text (right side)
   * @param {string} [options.version]   - Version string
   * @param {Array}  [options.keyHints]  - Array of {key, label} for key hints
   */
  constructor(options = {}) {
    this.theme = options.theme || null;
    this._mode = options.mode || 'COMMAND';
    this._status = options.status || '';
    this._info = options.info || '';
    this._version = options.version || 'SpecMem v2.5.0';
    this._keyHints = options.keyHints || [
      { key: '\u2191\u2193', label: 'Navigate' },
      { key: 'h', label: 'Help' },
      { key: 'q', label: 'Quit' },
    ];
    this._stats = {};
    this._visible = true;
  }

  // --------------------------------------------------------------------------
  // Setters
  // --------------------------------------------------------------------------

  /**
   * Set the mode indicator.
   * @param {string} mode - Mode name (e.g. 'COMMAND', 'CLAUDE', 'SPECMEM')
   */
  setMode(mode) {
    this._mode = mode || 'COMMAND';
  }

  /**
   * Set the center status text.
   * @param {string} text
   */
  setStatus(text) {
    this._status = text || '';
  }

  /**
   * Set the right-side info text.
   * @param {string} text
   */
  setInfo(text) {
    this._info = text || '';
  }

  /**
   * Set the version string.
   * @param {string} version
   */
  setVersion(version) {
    this._version = version || '';
  }

  /**
   * Set key hints displayed on the right.
   * @param {Array<{key: string, label: string}>} hints
   */
  setKeyHints(hints) {
    this._keyHints = Array.isArray(hints) ? hints : [];
  }

  /**
   * Set inline stats (e.g. RAM usage, memory count).
   * @param {Object} stats - Key-value pairs to display
   */
  setStats(stats) {
    this._stats = stats || {};
  }

  /**
   * Set visibility.
   * @param {boolean} visible
   */
  setVisible(visible) {
    this._visible = visible;
  }

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------

  /**
   * Render the status bar as a single line.
   *
   * Format:
   *   " MODE | SpecMem v2.5.0 | status | info | stat1 | stat2 | key hints "
   *
   * @param {number} width - Available width
   * @returns {string} Rendered line with ANSI codes
   */
  render(width) {
    if (!this._visible) return ' '.repeat(width);

    const sep = `${ANSI.dim} \u2502 ${ANSI.reset}`;
    const sepLen = 3; // ' | '

    // 1. Mode badge
    const modeBadge = this._renderModeBadge();
    const modeBadgeLen = visibleLength(modeBadge);

    // 2. Version
    const versionPart = this._version ? `${ANSI.dim}${this._version}${ANSI.reset}` : '';
    const versionLen = visibleLength(versionPart);

    // 3. Status message
    const statusPart = this._status ? `${ANSI.dim}${this._status}${ANSI.reset}` : '';
    const statusLen = visibleLength(statusPart);

    // 4. Info
    const infoPart = this._info ? `${ANSI.dim}${this._info}${ANSI.reset}` : '';
    const infoLen = visibleLength(infoPart);

    // 5. Inline stats
    const statsParts = [];
    for (const [key, value] of Object.entries(this._stats)) {
      statsParts.push(`${ANSI.dim}${key}: ${ANSI.reset}${ANSI.brightCyan}${value}${ANSI.reset}`);
    }
    const statsStr = statsParts.join(sep);
    const statsLen = statsParts.length > 0
      ? statsParts.reduce((sum, s) => sum + visibleLength(s), 0) + (statsParts.length - 1) * sepLen
      : 0;

    // 6. Key hints
    const hintParts = [];
    for (const hint of this._keyHints) {
      hintParts.push(`${ANSI.brightCyan}${hint.key}${ANSI.reset} ${ANSI.dim}${hint.label}${ANSI.reset}`);
    }
    const hintsStr = hintParts.join(`${ANSI.dim} \u2502 ${ANSI.reset}`);
    const hintsLen = hintParts.length > 0
      ? hintParts.reduce((sum, s) => sum + visibleLength(s), 0) + (hintParts.length - 1) * sepLen
      : 0;

    // Build segments with separators
    const segments = [];
    const segLens = [];

    // Always include mode badge
    segments.push(modeBadge);
    segLens.push(modeBadgeLen);

    if (versionPart) {
      segments.push(versionPart);
      segLens.push(versionLen);
    }
    if (statusPart) {
      segments.push(statusPart);
      segLens.push(statusLen);
    }
    if (infoPart) {
      segments.push(infoPart);
      segLens.push(infoLen);
    }
    if (statsStr) {
      segments.push(statsStr);
      segLens.push(statsLen);
    }
    if (hintsStr) {
      segments.push(hintsStr);
      segLens.push(hintsLen);
    }

    // Calculate total visible length
    const totalLen = segLens.reduce((a, b) => a + b, 0) + (segments.length - 1) * sepLen + 2; // +2 for edge padding

    // If it fits, join with separators
    if (totalLen <= width) {
      const joined = ' ' + segments.join(sep) + ' ';
      const joinedLen = visibleLength(joined);
      const padding = Math.max(0, width - joinedLen);
      return joined + ' '.repeat(padding);
    }

    // Too wide: progressively drop segments from the middle
    // Always keep mode badge and key hints
    const essentialSegments = [modeBadge];
    const essentialLens = [modeBadgeLen];
    let essentialTotal = modeBadgeLen + 2; // edge padding

    // Try to fit version
    if (versionPart && essentialTotal + versionLen + sepLen <= width - hintsLen - sepLen) {
      essentialSegments.push(versionPart);
      essentialLens.push(versionLen);
      essentialTotal += versionLen + sepLen;
    }

    // Try to fit status
    if (statusPart && essentialTotal + statusLen + sepLen <= width - hintsLen - sepLen) {
      essentialSegments.push(statusPart);
      essentialLens.push(statusLen);
      essentialTotal += statusLen + sepLen;
    }

    // Add hints at the end if they fit
    if (hintsStr && essentialTotal + hintsLen + sepLen <= width) {
      essentialSegments.push(hintsStr);
      essentialLens.push(hintsLen);
      essentialTotal += hintsLen + sepLen;
    }

    const result = ' ' + essentialSegments.join(sep) + ' ';
    const resultLen = visibleLength(result);
    const pad = Math.max(0, width - resultLen);
    return result + ' '.repeat(pad);
  }

  /**
   * Render the mode badge with colored background.
   * @returns {string}
   */
  _renderModeBadge() {
    const modeColors = {
      'COMMAND':  { bg: ANSI.bgBlue,    fg: ANSI.brightWhite },
      'CLAUDE':   { bg: ANSI.bgGreen,   fg: ANSI.black },
      'SPECMEM':  { bg: ANSI.bgMagenta, fg: ANSI.brightWhite },
      'TEAM':     { bg: ANSI.bgCyan,    fg: ANSI.black },
      'TOOLS':    { bg: ANSI.bgYellow,  fg: ANSI.black },
      'LOGS':     { bg: ANSI.bgGray,    fg: ANSI.brightWhite },
      'CONFIG':   { bg: ANSI.bgBlue,    fg: ANSI.brightWhite },
    };

    const colors = modeColors[this._mode] || modeColors['COMMAND'];
    return `${colors.bg}${colors.fg}${ANSI.bold} ${this._mode} ${ANSI.reset}`;
  }
}


// ============================================================================
// TAB FACTORY - Convenience method for creating default SpecMem tabs
// ============================================================================

/**
 * Create the default set of 8 SpecMem tabs.
 * Each tab is created with a placeholder render function that can be replaced
 * by the actual screen implementations (ClaudeLiveScreen, MemoryBrowserScreen, etc.)
 *
 * @param {Object} [options]
 * @param {Object} [options.renderers] - Map of tab ID to {render, update, handleInput} overrides
 * @returns {Tab[]}
 */
function createDefaultTabs(options = {}) {
  const renderers = options.renderers || {};

  const tabDefs = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      key: '1',
      icon: DEFAULT_ICONS.dashboard,
      updateInterval: 2000,
      fullScreen: false, // Dashboard uses quadrant layout
    },
    {
      id: 'claude-live',
      label: 'Claude',
      key: '2',
      icon: DEFAULT_ICONS.claudeLive,
      updateInterval: 500,  // Fast refresh for live preview
      fullScreen: true,
    },
    {
      id: 'memories',
      label: 'Memories',
      key: '3',
      icon: DEFAULT_ICONS.memories,
      updateInterval: 3000,
      fullScreen: true,
    },
    {
      id: 'team',
      label: 'Team',
      key: '4',
      icon: DEFAULT_ICONS.team,
      updateInterval: 2000,
      fullScreen: true,
    },
    {
      id: 'tools',
      label: 'Tools',
      key: '5',
      icon: DEFAULT_ICONS.tools,
      updateInterval: 1000,
      fullScreen: true,
    },
    {
      id: 'sessions',
      label: 'Sessions',
      key: '6',
      icon: DEFAULT_ICONS.sessions,
      updateInterval: 5000,
      fullScreen: true,
    },
    {
      id: 'logs',
      label: 'Logs',
      key: '7',
      icon: DEFAULT_ICONS.logs,
      updateInterval: 1000,
      fullScreen: true,
    },
    {
      id: 'config',
      label: 'Config',
      key: '8',
      icon: DEFAULT_ICONS.config,
      updateInterval: 10000,
      fullScreen: true,
    },
  ];

  return tabDefs.map(def => {
    const overrides = renderers[def.id] || {};

    return new Tab({
      id: def.id,
      label: def.label,
      key: def.key,
      icon: def.icon,
      updateInterval: def.updateInterval,
      fullScreen: def.fullScreen,
      render: overrides.render || _createPlaceholderRender(def),
      update: overrides.update || (async () => {}),
      handleInput: overrides.handleInput || (() => false),
      onActivate: overrides.onActivate || (() => {}),
      onDeactivate: overrides.onDeactivate || (() => {}),
    });
  });
}

/**
 * Create a placeholder render function for tabs not yet implemented.
 * Shows the tab name and a "coming soon" message.
 * @param {Object} tabDef
 * @returns {Function}
 */
function _createPlaceholderRender(tabDef) {
  return function placeholderRender(width, height) {
    const lines = [];
    const empty = ' '.repeat(width);
    const topPad = Math.max(0, Math.floor(height / 2) - 3);

    for (let i = 0; i < topPad; i++) lines.push(empty);

    const icon = tabDef.icon || DEFAULT_ICONS.inactive;
    const title = `${ANSI.bold}${ANSI.brightCyan}${icon} ${tabDef.label}${ANSI.reset}`;
    lines.push(centerStr(title, width));
    lines.push(empty);

    const subtitle = `${ANSI.dim}Press [${tabDef.key}] to activate this tab${ANSI.reset}`;
    lines.push(centerStr(subtitle, width));
    lines.push(empty);

    const hint = `${ANSI.dim}Screen not yet connected. Register a renderer via TabManager.${ANSI.reset}`;
    lines.push(centerStr(hint, width));

    while (lines.length < height) lines.push(empty);
    return lines.slice(0, height);
  };
}


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  Tab,
  TabManager,
  StatusBar,
  createDefaultTabs,
  // Utilities exported for use by tab screen implementations
  ANSI,
  DEFAULT_ICONS,
  stripAnsi,
  visibleLength,
  padRight,
  centerStr,
  truncateAnsi,
};
