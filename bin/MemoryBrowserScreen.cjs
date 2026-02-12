'use strict';

// ============================================================================
// MEMORY BROWSER SCREEN - Full-screen two-panel memory browser for TUI
// ============================================================================
//
// A full-screen Memory Browser tab styled like AEGIS Trainer's ModelBrowserScreen.
// Two-panel horizontal split: memory list on the left, detail view on the right.
//
// Features:
//   - Paginated memory list (25 per page) with colored type badges
//   - Arrow key navigation with AEGIS-style cursor highlighting
//   - Detail view with full content, tags, related memories, code pointers
//   - Inline search bar with debounced filtering
//   - MCP socket data source with graceful fallback
//   - Responsive layout adapting to terminal dimensions
//
// Usage:
//   const { MemoryBrowserScreen } = require('./MemoryBrowserScreen.cjs');
//   const screen = new MemoryBrowserScreen({ projectPath: '/my/project' });
//   screen.onActivate();
//   const lines = screen.render(120, 40);
//   screen.handleInput({ name: 'down' });
//
// NO external dependencies beyond project modules. CommonJS module.
// ============================================================================

// ---------------------------------------------------------------------------
// Imports (graceful fallback)
// ---------------------------------------------------------------------------

let AegisTheme, AEGIS_ICONS, AEGIS_COLORS;
try {
  const aegis = require('./AegisTheme.cjs');
  AegisTheme = aegis.AegisTheme;
  AEGIS_ICONS = aegis.AEGIS_ICONS;
  AEGIS_COLORS = aegis.AEGIS_COLORS;
} catch (_e) {
  // AegisTheme not available - will use fallback colors
}

let AnsiRenderer;
try {
  ({ AnsiRenderer } = require('./AnsiRenderer.cjs'));
} catch (_e) {
  // AnsiRenderer not available - will use basic string ops
}

let MCPSocketClient;
try {
  ({ MCPSocketClient } = require('./mcp-socket-client.cjs'));
} catch (_e) {
  // MCPSocketClient not available - will show empty state
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const UNDERLINE = '\x1b[4m';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;
const DATA_REFRESH_MS = 30000; // Refresh data every 30s
const LEFT_PANEL_RATIO = 0.35; // Left panel takes 35% of width
const MIN_LEFT_WIDTH = 30;
const MIN_RIGHT_WIDTH = 40;

// Box drawing characters (rounded style)
const BOX = {
  tl: '\u256D', tr: '\u256E', bl: '\u2570', br: '\u256F',
  h: '\u2500', v: '\u2502',
  teeL: '\u251C', teeR: '\u2524'
};

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

/**
 * Convert hex color (#RRGGBB) to ANSI truecolor foreground escape sequence.
 * @param {string} hex
 * @returns {string}
 */
function hexFg(hex) {
  if (!hex || typeof hex !== 'string') return '';
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '';
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Convert hex color (#RRGGBB) to ANSI truecolor background escape sequence.
 * @param {string} hex
 * @returns {string}
 */
function hexBg(hex) {
  if (!hex || typeof hex !== 'string') return '';
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '';
  return `\x1b[48;2;${r};${g};${b}m`;
}

// AEGIS color palette
const COLORS = {
  // Memory type colors
  episodic:     '#FF6B6B',
  semantic:     '#4ECDC4',
  procedural:   '#45B7D1',
  working:      '#96CEB4',
  consolidated: '#DDA0DD',

  // UI colors
  cyan:        '#00D4FF',
  cyanDim:     '#0088AA',
  border:      '#2a3a4a',
  borderActive:'#00D4FF',
  selectedBg:  '#1a2233',
  selectedFg:  '#00D4FF',
  title:       '#00D4FF',
  dim:         '#5a6a7a',
  dimText:     '#6a7a8a',
  text:        '#c0d0e0',
  white:       '#e0e8f0',
  warning:     '#FFD93D',
  error:       '#FF6B6B',
  success:     '#4ECDC4',
  tagColor:    '#7a8a9a',
  star:        '#FFD700',
  headerBg:    '#0d1520',
  panelBg:     '#111a25'
};

// Build ANSI escape strings from the palette
const C = {};
for (const [key, hex] of Object.entries(COLORS)) {
  C[key] = hexFg(hex);
  C[key + 'Bg'] = hexBg(hex);
}

// Memory type display config
const TYPE_CONFIG = {
  episodic:     { color: C.episodic,     label: 'episodic',     icon: '\u25CF' },
  semantic:     { color: C.semantic,     label: 'semantic',     icon: '\u25C6' },
  procedural:   { color: C.procedural,   label: 'procedural',   icon: '\u25B6' },
  working:      { color: C.working,      label: 'working',      icon: '\u25A0' },
  consolidated: { color: C.consolidated, label: 'consolidated', icon: '\u2605' }
};

// Importance to stars mapping
const IMPORTANCE_STARS = {
  critical: '\u2605\u2605\u2605\u2605\u2605',
  high:     '\u2605\u2605\u2605\u2605',
  medium:   '\u2605\u2605\u2605',
  low:      '\u2605\u2605',
  trivial:  '\u2605'
};

// ---------------------------------------------------------------------------
// String utilities
// ---------------------------------------------------------------------------

/**
 * Get visible width of a string (excluding ANSI escape sequences).
 * Uses AnsiRenderer if available, otherwise a simple regex strip.
 * @param {string} str
 * @returns {number}
 */
function vWidth(str) {
  if (!str) return 0;
  if (AnsiRenderer && typeof AnsiRenderer.visibleWidth === 'function') {
    return AnsiRenderer.visibleWidth(str);
  }
  // Fallback: strip ANSI and measure
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').length;
}

/**
 * Truncate a string to maxWidth visible columns, preserving ANSI.
 * @param {string} str
 * @param {number} maxWidth
 * @param {string} [ellipsis='\u2026']
 * @returns {string}
 */
function truncate(str, maxWidth, ellipsis = '\u2026') {
  if (!str) return '';
  if (AnsiRenderer && typeof AnsiRenderer.truncate === 'function') {
    return AnsiRenderer.truncate(str, maxWidth, ellipsis);
  }
  // Fallback: simple strip
  const plain = str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  if (plain.length <= maxWidth) return str;
  return plain.substring(0, maxWidth - 1) + ellipsis;
}

/**
 * Pad a string to exactly targetWidth visible columns.
 * @param {string} str
 * @param {number} targetWidth
 * @returns {string}
 */
function pad(str, targetWidth) {
  if (!str) str = '';
  if (AnsiRenderer && typeof AnsiRenderer.pad === 'function') {
    return AnsiRenderer.pad(str, targetWidth);
  }
  const currentWidth = vWidth(str);
  if (currentWidth >= targetWidth) return truncate(str, targetWidth, '');
  return str + ' '.repeat(targetWidth - currentWidth);
}

/**
 * Word-wrap a string to maxWidth.
 * @param {string} str
 * @param {number} maxWidth
 * @returns {string[]}
 */
function wordWrap(str, maxWidth) {
  if (!str) return [''];
  if (AnsiRenderer && typeof AnsiRenderer.wordWrap === 'function') {
    return AnsiRenderer.wordWrap(str, maxWidth);
  }
  // Simple fallback word wrap
  const words = str.split(/\s+/);
  const lines = [];
  let currentLine = '';
  for (const word of words) {
    if (currentLine.length + word.length + 1 > maxWidth) {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? currentLine + ' ' + word : word;
    }
  }
  if (currentLine) lines.push(currentLine);
  if (lines.length === 0) lines.push('');
  return lines;
}

/**
 * Format a date for display.
 * @param {string|Date} date
 * @returns {string}
 */
function formatDate(date) {
  if (!date) return 'unknown';
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return String(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${mins}`;
  } catch (_e) {
    return String(date);
  }
}

/**
 * Format a relative time from now.
 * @param {string|Date} date
 * @returns {string}
 */
function relativeTime(date) {
  if (!date) return '';
  try {
    const d = new Date(date);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 0) return 'just now';
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  } catch (_e) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// MemoryBrowserScreen
// ---------------------------------------------------------------------------

class MemoryBrowserScreen {
  /**
   * @param {Object} options
   * @param {Object} [options.theme] - AegisTheme instance (optional)
   * @param {string} [options.projectPath] - Path to project root
   * @param {Function} [options.dbQuery] - Custom database query function
   * @param {Object} [options.mcpClient] - Pre-existing MCPSocketClient instance
   */
  constructor(options = {}) {
    this.theme = options.theme || AegisTheme || null;
    this.projectPath = options.projectPath || process.cwd();
    this.dbQuery = options.dbQuery || null;
    this.mcpClient = options.mcpClient || null;

    // State
    this._memories = [];           // Currently loaded memories
    this._filteredMemories = [];   // After search filter
    this._totalCount = 0;          // Total memory count from DB
    this._selectedIndex = 0;       // Cursor position in list
    this._page = 0;                // Current page (0-based)
    this._totalPages = 0;
    this._activePanel = 'list';    // 'list' or 'detail'
    this._detailScrollOffset = 0;  // Scroll position in detail view
    this._searchActive = false;    // Whether search input is active
    this._searchQuery = '';        // Current search text
    this._searchDebounceTimer = null;
    this._loading = false;
    this._error = null;
    this._lastRefresh = 0;
    this._active = false;          // Whether this screen is currently shown

    // Cache for detail view
    this._selectedMemory = null;   // Full memory detail for selected item
    this._relatedMemories = [];    // Related memories for selected
    this._detailLines = [];        // Pre-rendered detail lines

    // Data source initialization
    this._dataSourceReady = false;
    this._dataSourceError = null;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Called when this screen tab becomes active/visible.
   * Initializes data source and loads initial data.
   */
  async onActivate() {
    this._active = true;
    this._error = null;

    // Initialize data source if not ready
    if (!this._dataSourceReady) {
      await this._initDataSource();
    }

    // Load initial data
    await this.update();
  }

  /**
   * Called when switching away from this screen tab.
   */
  onDeactivate() {
    this._active = false;
    if (this._searchDebounceTimer) {
      clearTimeout(this._searchDebounceTimer);
      this._searchDebounceTimer = null;
    }
  }

  // =========================================================================
  // Data Source
  // =========================================================================

  /**
   * Initialize the data source (MCP socket or direct DB query).
   * @private
   */
  async _initDataSource() {
    // If a custom dbQuery was provided, use that
    if (this.dbQuery) {
      this._dataSourceReady = true;
      return;
    }

    // Try connecting via MCP socket
    if (MCPSocketClient && this.projectPath) {
      try {
        if (!this.mcpClient) {
          this.mcpClient = new MCPSocketClient(this.projectPath);
        }
        await this.mcpClient.connect();
        this._dataSourceReady = true;
      } catch (err) {
        this._dataSourceError = err.message;
        this._dataSourceReady = false;
      }
    } else {
      this._dataSourceError = 'No data source available. MCPSocketClient not found.';
      this._dataSourceReady = false;
    }
  }

  /**
   * Fetch memories from the data source.
   * @param {Object} [queryOptions]
   * @param {string} [queryOptions.search] - Search query
   * @param {number} [queryOptions.offset] - Pagination offset
   * @param {number} [queryOptions.limit] - Items per page
   * @returns {Promise<{memories: Array, total: number}>}
   * @private
   */
  async _fetchMemories(queryOptions = {}) {
    const { search = '', offset = 0, limit = PAGE_SIZE } = queryOptions;

    // Custom database query function
    if (this.dbQuery) {
      try {
        const result = await this.dbQuery({ search, offset, limit });
        return {
          memories: result.memories || result.items || [],
          total: result.total || result.count || 0
        };
      } catch (err) {
        this._error = 'Query failed: ' + err.message;
        return { memories: [], total: 0 };
      }
    }

    // MCP socket query
    if (this.mcpClient && this._dataSourceReady) {
      try {
        if (search) {
          // Use find_memory for search
          const result = await this.mcpClient.callTool('find_memory', {
            query: search,
            limit: limit,
            summarize: false,
            maxContentLength: 0,
            cameraRollMode: false
          });
          const memories = this._parseMCPResult(result);
          return { memories, total: memories.length };
        } else {
          // Use get_memory for browsing (paginated)
          const result = await this.mcpClient.callTool('get_memory', {
            limit: limit,
            offset: offset,
            orderBy: 'created',
            orderDirection: 'desc',
            summarize: false
          });
          const memories = this._parseMCPResult(result);
          // Try to get total count
          const countResult = await this.mcpClient.callTool('show_me_the_stats', {
            includeTypeDistribution: true,
            includeCacheStats: false,
            includeEmbeddingServerStatus: false
          });
          const total = this._extractTotalCount(countResult) || memories.length;
          return { memories, total };
        }
      } catch (err) {
        this._error = 'MCP query failed: ' + err.message;
        return { memories: [], total: 0 };
      }
    }

    // No data source
    return { memories: [], total: 0 };
  }

  /**
   * Parse MCP tool result into memory objects array.
   * @param {*} result
   * @returns {Array}
   * @private
   */
  _parseMCPResult(result) {
    if (!result) return [];

    // MCP results come in content array format
    if (result.content && Array.isArray(result.content)) {
      for (const block of result.content) {
        if (block.type === 'text' && block.text) {
          try {
            const parsed = JSON.parse(block.text);
            if (Array.isArray(parsed)) return parsed;
            if (parsed.memories) return parsed.memories;
            if (parsed.results) return parsed.results;
            if (parsed.items) return parsed.items;
            return [parsed];
          } catch (_e) {
            // Not JSON, try to extract from formatted text
            return this._parseFormattedText(block.text);
          }
        }
      }
    }

    // Direct array
    if (Array.isArray(result)) return result;

    // Object with memories/results
    if (result.memories) return result.memories;
    if (result.results) return result.results;
    if (result.items) return result.items;

    return [];
  }

  /**
   * Parse formatted text output from MCP tools into memory objects.
   * @param {string} text
   * @returns {Array}
   * @private
   */
  _parseFormattedText(text) {
    // Try to extract structured data from formatted MCP output
    const memories = [];
    const blocks = text.split(/\n(?=ID:|Memory ID:|\u2500{3,}|\u250C)/);

    for (const block of blocks) {
      const memory = {};
      const idMatch = block.match(/(?:ID|Memory ID):\s*([a-f0-9-]+)/i);
      if (idMatch) memory.id = idMatch[1];

      const typeMatch = block.match(/Type:\s*(\w+)/i);
      if (typeMatch) memory.memoryType = typeMatch[1].toLowerCase();

      const importanceMatch = block.match(/Importance:\s*(\w+)/i);
      if (importanceMatch) memory.importance = importanceMatch[1].toLowerCase();

      const contentMatch = block.match(/Content:\s*(.+?)(?:\n(?:Tags|Type|Importance|Created|ID):|$)/is);
      if (contentMatch) memory.content = contentMatch[1].trim();

      const tagsMatch = block.match(/Tags:\s*(.+)/i);
      if (tagsMatch) {
        memory.tags = tagsMatch[1].split(/[,\s]+/).filter(t => t.length > 0).map(t => t.replace('#', ''));
      }

      const dateMatch = block.match(/Created:\s*(.+)/i);
      if (dateMatch) memory.created_at = dateMatch[1].trim();

      if (memory.id || memory.content) {
        memories.push(memory);
      }
    }

    return memories;
  }

  /**
   * Extract total memory count from stats result.
   * @param {*} result
   * @returns {number}
   * @private
   */
  _extractTotalCount(result) {
    if (!result) return 0;
    try {
      if (result.content && Array.isArray(result.content)) {
        for (const block of result.content) {
          if (block.text) {
            const match = block.text.match(/total[:\s]*(\d+)/i);
            if (match) return parseInt(match[1], 10);
            // Try type distribution totals
            const countMatches = block.text.match(/(\d+)\s*(?:memories|total)/i);
            if (countMatches) return parseInt(countMatches[1], 10);
          }
        }
      }
      if (typeof result.total === 'number') return result.total;
      if (typeof result.count === 'number') return result.count;
    } catch (_e) {
      // ignore
    }
    return 0;
  }

  // =========================================================================
  // Update / Refresh
  // =========================================================================

  /**
   * Refresh data from the data source.
   * Called periodically and on page changes.
   */
  async update() {
    if (this._loading) return;

    this._loading = true;
    this._error = null;

    try {
      const offset = this._page * PAGE_SIZE;
      const { memories, total } = await this._fetchMemories({
        search: this._searchQuery,
        offset: offset,
        limit: PAGE_SIZE
      });

      this._memories = memories;
      this._filteredMemories = memories; // Search is done server-side
      this._totalCount = total;
      this._totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      this._lastRefresh = Date.now();

      // Clamp selection
      if (this._selectedIndex >= this._filteredMemories.length) {
        this._selectedIndex = Math.max(0, this._filteredMemories.length - 1);
      }

      // Update selected memory detail
      this._updateSelectedDetail();
    } catch (err) {
      this._error = 'Failed to load memories: ' + err.message;
    } finally {
      this._loading = false;
    }
  }

  /**
   * Update the detail view for the currently selected memory.
   * @private
   */
  _updateSelectedDetail() {
    const memories = this._filteredMemories;
    if (memories.length === 0 || this._selectedIndex >= memories.length) {
      this._selectedMemory = null;
      this._relatedMemories = [];
      this._detailLines = [];
      this._detailScrollOffset = 0;
      return;
    }

    this._selectedMemory = memories[this._selectedIndex];
    this._detailScrollOffset = 0;
    // Detail lines will be rendered lazily in _renderDetailPanel
  }

  // =========================================================================
  // Input Handling
  // =========================================================================

  /**
   * Handle keyboard input.
   * @param {Object|string} key - Key event object or key name string
   * @returns {string|null} Action result or null
   */
  handleInput(key) {
    const keyName = typeof key === 'string' ? key : (key && key.name) || '';
    const ctrl = typeof key === 'object' && key.ctrl;
    const ch = typeof key === 'string' ? key : (key && key.sequence) || '';

    // Search mode input handling
    if (this._searchActive) {
      return this._handleSearchInput(keyName, ch, ctrl);
    }

    // Normal mode
    switch (keyName) {
      case 'up':
        return this._moveCursor(-1);
      case 'down':
        return this._moveCursor(1);
      case 'pageup':
        return this._changePage(-1);
      case 'pagedown':
        return this._changePage(1);
      case 'home':
        this._selectedIndex = 0;
        this._updateSelectedDetail();
        return 'navigate';
      case 'end':
        this._selectedIndex = Math.max(0, this._filteredMemories.length - 1);
        this._updateSelectedDetail();
        return 'navigate';
      case 'return':
      case 'enter':
        return this._togglePanel();
      case 'tab':
        return this._togglePanel();
      case 'escape':
        if (this._activePanel === 'detail') {
          this._activePanel = 'list';
          return 'panel_switch';
        }
        return 'back';
      case 'd':
        if (!ctrl) return this._requestDelete();
        break;
      case 'r':
        if (!ctrl) {
          this.update();
          return 'refresh';
        }
        break;
      default:
        // Check for '/' to activate search
        if (ch === '/') {
          this._searchActive = true;
          this._searchQuery = '';
          return 'search_activate';
        }

        // Detail panel scrolling when in detail view
        if (this._activePanel === 'detail') {
          if (keyName === 'up' || keyName === 'k') {
            this._detailScrollOffset = Math.max(0, this._detailScrollOffset - 1);
            return 'detail_scroll';
          }
          if (keyName === 'down' || keyName === 'j') {
            this._detailScrollOffset++;
            return 'detail_scroll';
          }
        }
        break;
    }

    return null;
  }

  /**
   * Handle input while search bar is active.
   * @private
   */
  _handleSearchInput(keyName, ch, ctrl) {
    if (keyName === 'escape') {
      this._searchActive = false;
      if (this._searchQuery === '') {
        // If search was empty, just close
        return 'search_close';
      }
      return 'search_close';
    }

    if (keyName === 'return' || keyName === 'enter') {
      this._searchActive = false;
      // Trigger search with current query
      this._page = 0;
      this._selectedIndex = 0;
      this.update();
      return 'search_submit';
    }

    if (keyName === 'backspace') {
      if (this._searchQuery.length > 0) {
        this._searchQuery = this._searchQuery.slice(0, -1);
        this._scheduleSearch();
      } else {
        // Backspace on empty clears search entirely
        this._searchActive = false;
        this._searchQuery = '';
        this._page = 0;
        this._selectedIndex = 0;
        this.update();
        return 'search_clear';
      }
      return 'search_input';
    }

    if (ctrl && ch === 'u') {
      this._searchQuery = '';
      this._scheduleSearch();
      return 'search_clear_line';
    }

    // Printable character
    if (ch && ch.length === 1 && ch.charCodeAt(0) >= 32) {
      this._searchQuery += ch;
      this._scheduleSearch();
      return 'search_input';
    }

    return null;
  }

  /**
   * Schedule a debounced search.
   * @private
   */
  _scheduleSearch() {
    if (this._searchDebounceTimer) {
      clearTimeout(this._searchDebounceTimer);
    }
    this._searchDebounceTimer = setTimeout(() => {
      this._page = 0;
      this._selectedIndex = 0;
      this.update();
    }, SEARCH_DEBOUNCE_MS);
  }

  /**
   * Move cursor up/down in the list.
   * @param {number} delta - Direction (-1 up, +1 down)
   * @returns {string}
   * @private
   */
  _moveCursor(delta) {
    const maxIndex = this._filteredMemories.length - 1;
    if (maxIndex < 0) return 'navigate';

    const newIndex = this._selectedIndex + delta;

    if (newIndex < 0) {
      // Wrap or stay at top
      if (this._page > 0) {
        this._page--;
        this._selectedIndex = PAGE_SIZE - 1;
        this.update();
      }
      return 'navigate';
    }

    if (newIndex > maxIndex) {
      // Advance to next page if available
      if (this._page < this._totalPages - 1) {
        this._page++;
        this._selectedIndex = 0;
        this.update();
      }
      return 'navigate';
    }

    this._selectedIndex = newIndex;
    this._updateSelectedDetail();
    return 'navigate';
  }

  /**
   * Change page.
   * @param {number} delta - Direction (-1 prev, +1 next)
   * @returns {string}
   * @private
   */
  _changePage(delta) {
    const newPage = this._page + delta;
    if (newPage < 0 || newPage >= this._totalPages) return 'page_bounds';

    this._page = newPage;
    this._selectedIndex = 0;
    this.update();
    return 'page_change';
  }

  /**
   * Toggle between list and detail panels.
   * @returns {string}
   * @private
   */
  _togglePanel() {
    this._activePanel = this._activePanel === 'list' ? 'detail' : 'list';
    this._detailScrollOffset = 0;
    return 'panel_switch';
  }

  /**
   * Request deletion of the currently selected memory.
   * Returns a delete action for the parent to confirm.
   * @returns {string}
   * @private
   */
  _requestDelete() {
    if (!this._selectedMemory) return null;
    return 'delete_request:' + (this._selectedMemory.id || '');
  }

  // =========================================================================
  // Rendering
  // =========================================================================

  /**
   * Render the full screen as an array of ANSI-colored strings.
   * @param {number} width - Terminal width in columns
   * @param {number} height - Terminal height in rows
   * @returns {string[]} Array of strings, one per row
   */
  render(width, height) {
    if (width < 40 || height < 10) {
      return this._renderTooSmall(width, height);
    }

    const lines = [];

    // Layout calculation
    const headerHeight = 1;
    const footerHeight = 1;
    const contentHeight = height - headerHeight - footerHeight;
    const innerWidth = width - 2; // 1 char border on each side

    // Panel widths
    let leftWidth = Math.max(MIN_LEFT_WIDTH, Math.floor(innerWidth * LEFT_PANEL_RATIO));
    let rightWidth = innerWidth - leftWidth - 1; // -1 for separator
    if (rightWidth < MIN_RIGHT_WIDTH) {
      rightWidth = MIN_RIGHT_WIDTH;
      leftWidth = innerWidth - rightWidth - 1;
    }
    if (leftWidth < MIN_LEFT_WIDTH) {
      leftWidth = MIN_LEFT_WIDTH;
    }

    // 1. Header
    lines.push(this._renderHeader(width));

    // 2. Content area (left + right panels side by side)
    const leftLines = this._renderLeftPanel(leftWidth, contentHeight);
    const rightLines = this._renderRightPanel(rightWidth, contentHeight);

    for (let i = 0; i < contentHeight; i++) {
      const left = leftLines[i] || pad('', leftWidth);
      const right = rightLines[i] || pad('', rightWidth);
      const sep = C.border + BOX.v + RESET;
      lines.push(left + sep + right);
    }

    // 3. Footer
    lines.push(this._renderFooter(width));

    return lines;
  }

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------

  /**
   * Render the header bar.
   * @param {number} width
   * @returns {string}
   * @private
   */
  _renderHeader(width) {
    const titleText = ' Memory Browser ';
    const countText = this._totalCount > 0
      ? ` ${this._totalCount.toLocaleString()} memories `
      : ' 0 memories ';

    // Search field
    let searchText = '';
    if (this._searchActive) {
      const cursor = '\u2588'; // Block cursor
      searchText = ` Search: [${C.white}${this._searchQuery}${cursor}${RESET}${C.dim}] `;
    } else if (this._searchQuery) {
      searchText = ` Search: [${C.white}${this._searchQuery}${RESET}${C.dim}] `;
    }

    // Loading indicator
    const loadingText = this._loading ? ` ${C.warning}\u25CF loading${RESET}` : '';

    // Build header
    const prefix = `${C.border}${BOX.tl}${BOX.h}${BOX.h}`;
    const title = `${BOLD}${C.cyan}${titleText}${RESET}`;
    const count = `${C.dim}${BOX.h}${BOX.h}${countText}${RESET}`;
    const search = searchText ? `${C.dim}${BOX.h}${BOX.h}${searchText}${RESET}` : '';

    const contentWidth = vWidth(prefix) + vWidth(titleText) + vWidth(countText)
      + (searchText ? vWidth(searchText) + 2 : 0)
      + vWidth(loadingText);

    const fillCount = Math.max(0, width - contentWidth - 2);
    const fill = `${C.border}${BOX.h.repeat(fillCount)}${BOX.tr}${RESET}`;

    return `${prefix}${title}${count}${search}${loadingText}${fill}`;
  }

  // -------------------------------------------------------------------------
  // Footer
  // -------------------------------------------------------------------------

  /**
   * Render the footer bar with key hints.
   * @param {number} width
   * @returns {string}
   * @private
   */
  _renderFooter(width) {
    const hints = [
      { key: '/', desc: 'Search' },
      { key: '\u2191\u2193', desc: 'Navigate' },
      { key: 'Enter', desc: 'View' },
      { key: 'd', desc: 'Delete' },
      { key: 'r', desc: 'Refresh' },
      { key: 'PgUp/Dn', desc: 'Page' },
      { key: 'Tab', desc: 'Panel' },
      { key: 'ESC', desc: 'Back' }
    ];

    let hintStr = '';
    for (const hint of hints) {
      hintStr += ` ${C.cyan}[${hint.key}]${RESET}${C.dim}${hint.desc}${RESET}`;
    }

    const prefix = `${C.border}${BOX.bl}${BOX.h}${BOX.h}`;
    const hintWidth = vWidth(hintStr);
    const fillCount = Math.max(0, width - 4 - hintWidth - 1);
    const fill = `${C.border}${BOX.h.repeat(fillCount)}${BOX.br}${RESET}`;

    return `${prefix}${hintStr} ${fill}`;
  }

  // -------------------------------------------------------------------------
  // Left Panel (Memory List)
  // -------------------------------------------------------------------------

  /**
   * Render the left panel (memory list).
   * @param {number} panelWidth
   * @param {number} panelHeight
   * @returns {string[]}
   * @private
   */
  _renderLeftPanel(panelWidth, panelHeight) {
    const lines = [];
    const isActive = this._activePanel === 'list';
    const borderColor = isActive ? C.borderActive : C.border;

    // Panel title bar
    const titleBarText = ` Memories `;
    const pageInfo = this._totalPages > 1
      ? `Pg ${this._page + 1}/${this._totalPages} `
      : '';
    const titleFill = Math.max(0, panelWidth - vWidth(titleBarText) - vWidth(pageInfo) - 4);
    lines.push(
      `${borderColor}${BOX.tl}${BOX.h}${RESET}` +
      `${BOLD}${C.cyan}${titleBarText}${RESET}` +
      `${borderColor}${BOX.h.repeat(titleFill)}${RESET}` +
      `${C.dim}${pageInfo}${RESET}` +
      `${borderColor}${BOX.tr}${RESET}`
    );

    const contentWidth = panelWidth - 2; // borders
    const contentHeight = panelHeight - 2; // title + bottom border

    if (!this._dataSourceReady && !this.dbQuery) {
      // Empty state: no data source
      const emptyLines = this._renderEmptyState(contentWidth, contentHeight);
      for (const line of emptyLines) {
        lines.push(`${borderColor}${BOX.v}${RESET}${line}${borderColor}${BOX.v}${RESET}`);
      }
    } else if (this._error) {
      // Error state
      const errorLines = this._renderErrorState(contentWidth, contentHeight);
      for (const line of errorLines) {
        lines.push(`${borderColor}${BOX.v}${RESET}${line}${borderColor}${BOX.v}${RESET}`);
      }
    } else if (this._filteredMemories.length === 0) {
      // No results
      const noResultLines = this._renderNoResults(contentWidth, contentHeight);
      for (const line of noResultLines) {
        lines.push(`${borderColor}${BOX.v}${RESET}${line}${borderColor}${BOX.v}${RESET}`);
      }
    } else {
      // Memory list rows
      for (let i = 0; i < contentHeight; i++) {
        if (i < this._filteredMemories.length) {
          const memory = this._filteredMemories[i];
          const isSelected = i === this._selectedIndex;
          const row = this._renderMemoryRow(memory, contentWidth, isSelected);
          lines.push(`${borderColor}${BOX.v}${RESET}${row}${borderColor}${BOX.v}${RESET}`);
        } else {
          // Empty row
          lines.push(`${borderColor}${BOX.v}${RESET}${pad('', contentWidth)}${borderColor}${BOX.v}${RESET}`);
        }
      }
    }

    // Bottom border
    const bottomFill = Math.max(0, panelWidth - 2);
    lines.push(`${borderColor}${BOX.bl}${BOX.h.repeat(bottomFill)}${BOX.br}${RESET}`);

    // Pad to exact height
    while (lines.length < panelHeight) {
      lines.push(pad('', panelWidth));
    }

    return lines.slice(0, panelHeight);
  }

  /**
   * Render a single memory row in the list.
   * @param {Object} memory
   * @param {number} width
   * @param {boolean} isSelected
   * @returns {string}
   * @private
   */
  _renderMemoryRow(memory, width, isSelected) {
    const type = (memory.memoryType || memory.type || 'semantic').toLowerCase();
    const config = TYPE_CONFIG[type] || TYPE_CONFIG.semantic;
    const importance = (memory.importance || 'medium').toLowerCase();

    // Type badge: [type]
    const badge = `${config.color}[${config.label}]${RESET}`;
    const badgeWidth = config.label.length + 2;

    // Importance stars
    const stars = IMPORTANCE_STARS[importance] || '\u2605';
    const starsStr = `${C.star}${stars}${RESET}`;
    const starsWidth = stars.length;

    // Content preview
    const content = (memory.content || memory.summary || '(no content)')
      .replace(/[\n\r\t]+/g, ' ')
      .trim();

    const previewWidth = Math.max(0, width - badgeWidth - starsWidth - 3); // spaces
    const preview = truncate(content, previewWidth);

    // Build the row
    let row;
    if (isSelected) {
      const selectedBg = C.selectedBgBg || hexBg(COLORS.selectedBg);
      const selectedFg = C.selectedFg || hexFg(COLORS.selectedFg);
      row = `${selectedBg}${selectedFg} ${badge}${selectedBg}${selectedFg} ${preview}${RESET}${selectedBg} ${starsStr}${RESET}`;
    } else {
      row = ` ${badge} ${C.text}${preview}${RESET} ${starsStr}`;
    }

    return pad(row, width);
  }

  // -------------------------------------------------------------------------
  // Right Panel (Detail View)
  // -------------------------------------------------------------------------

  /**
   * Render the right panel (detail view).
   * @param {number} panelWidth
   * @param {number} panelHeight
   * @returns {string[]}
   * @private
   */
  _renderRightPanel(panelWidth, panelHeight) {
    const lines = [];
    const isActive = this._activePanel === 'detail';
    const borderColor = isActive ? C.borderActive : C.border;

    // Panel title bar
    const titleBarText = ' Detail ';
    const titleFill = Math.max(0, panelWidth - vWidth(titleBarText) - 4);
    lines.push(
      `${borderColor}${BOX.tl}${BOX.h}${RESET}` +
      `${BOLD}${C.cyan}${titleBarText}${RESET}` +
      `${borderColor}${BOX.h.repeat(titleFill)}${BOX.tr}${RESET}`
    );

    const contentWidth = panelWidth - 2; // borders
    const contentHeight = panelHeight - 2; // title + bottom border

    if (!this._selectedMemory) {
      // No selection
      const emptyLines = this._renderDetailEmpty(contentWidth, contentHeight);
      for (const line of emptyLines) {
        lines.push(`${borderColor}${BOX.v}${RESET}${line}${borderColor}${BOX.v}${RESET}`);
      }
    } else {
      // Render detail content
      const detailContent = this._buildDetailContent(this._selectedMemory, contentWidth);

      // Apply scroll offset
      const scrolled = detailContent.slice(this._detailScrollOffset);
      for (let i = 0; i < contentHeight; i++) {
        if (i < scrolled.length) {
          lines.push(`${borderColor}${BOX.v}${RESET}${pad(scrolled[i], contentWidth)}${borderColor}${BOX.v}${RESET}`);
        } else {
          lines.push(`${borderColor}${BOX.v}${RESET}${pad('', contentWidth)}${borderColor}${BOX.v}${RESET}`);
        }
      }
    }

    // Bottom border with scroll indicator
    let bottomContent = '';
    if (this._selectedMemory) {
      const detailContent = this._buildDetailContent(this._selectedMemory, contentWidth);
      if (detailContent.length > contentHeight) {
        const scrollPct = Math.round((this._detailScrollOffset / Math.max(1, detailContent.length - contentHeight)) * 100);
        bottomContent = ` ${C.dim}${Math.min(100, scrollPct)}% ${RESET}`;
      }
    }
    const bottomContentWidth = vWidth(bottomContent);
    const bottomFill = Math.max(0, panelWidth - 2 - bottomContentWidth);
    lines.push(`${borderColor}${BOX.bl}${BOX.h.repeat(bottomFill)}${RESET}${bottomContent}${borderColor}${BOX.br}${RESET}`);

    // Pad to exact height
    while (lines.length < panelHeight) {
      lines.push(pad('', panelWidth));
    }

    return lines.slice(0, panelHeight);
  }

  /**
   * Build the detail content lines for a memory.
   * @param {Object} memory
   * @param {number} width
   * @returns {string[]}
   * @private
   */
  _buildDetailContent(memory, width) {
    const lines = [];
    const labelWidth = 12;
    const valueWidth = width - labelWidth - 1;

    // ID
    const id = memory.id || memory.memoryId || 'unknown';
    lines.push(` ${C.dim}ID:${RESET}         ${C.text}${truncate(id, valueWidth)}${RESET}`);

    // Type with colored badge
    const type = (memory.memoryType || memory.type || 'semantic').toLowerCase();
    const config = TYPE_CONFIG[type] || TYPE_CONFIG.semantic;
    lines.push(` ${C.dim}Type:${RESET}       ${config.color}${config.icon} ${config.label}${RESET}`);

    // Created date
    const created = memory.created_at || memory.createdAt || memory.timestamp;
    const dateStr = formatDate(created);
    const relStr = relativeTime(created);
    lines.push(` ${C.dim}Created:${RESET}    ${C.text}${dateStr}${RESET} ${C.dim}(${relStr})${RESET}`);

    // Updated date (if different from created)
    const updated = memory.updated_at || memory.updatedAt;
    if (updated && updated !== created) {
      lines.push(` ${C.dim}Updated:${RESET}    ${C.text}${formatDate(updated)}${RESET} ${C.dim}(${relativeTime(updated)})${RESET}`);
    }

    // Importance with stars
    const importance = (memory.importance || 'medium').toLowerCase();
    const stars = IMPORTANCE_STARS[importance] || '\u2605';
    lines.push(` ${C.dim}Importance:${RESET} ${C.star}${stars}${RESET} ${C.text}${importance}${RESET}`);

    // Tags
    const tags = memory.tags || [];
    if (tags.length > 0) {
      const tagStr = tags.map(t => `${C.tagColor}#${t}${RESET}`).join('  ');
      const tagLines = wordWrap(tagStr, valueWidth);
      lines.push(` ${C.dim}Tags:${RESET}       ${tagLines[0] || ''}`);
      for (let i = 1; i < tagLines.length; i++) {
        lines.push(`${' '.repeat(labelWidth)}${tagLines[i]}`);
      }
    } else {
      lines.push(` ${C.dim}Tags:${RESET}       ${C.dim}(none)${RESET}`);
    }

    // Access count
    if (memory.access_count != null || memory.accessCount != null) {
      const accessCount = memory.access_count || memory.accessCount || 0;
      lines.push(` ${C.dim}Accessed:${RESET}   ${C.text}${accessCount} times${RESET}`);
    }

    // Separator
    lines.push('');
    lines.push(` ${C.border}${BOX.h.repeat(width - 2)}${RESET}`);
    lines.push('');

    // Content section
    lines.push(` ${BOLD}${C.cyan}Content${RESET}`);
    lines.push('');

    const content = memory.content || memory.summary || '(no content)';
    const contentLines = wordWrap(content, width - 2);
    for (const line of contentLines) {
      lines.push(` ${C.text}${line}${RESET}`);
    }

    // Code pointers section
    const codePointers = memory.code_pointers || memory.codePointers || [];
    if (codePointers.length > 0) {
      lines.push('');
      lines.push(` ${C.border}${BOX.h.repeat(width - 2)}${RESET}`);
      lines.push('');
      lines.push(` ${BOLD}${C.cyan}Code Pointers${RESET}`);
      lines.push('');

      for (const pointer of codePointers) {
        const file = pointer.file || pointer.filePath || pointer.path || '';
        const lineNum = pointer.line || pointer.lineNumber || '';
        const func = pointer.function || pointer.functionName || '';

        let pointerStr = `  ${C.procedural}\u2192${RESET} ${C.text}${file}${RESET}`;
        if (lineNum) pointerStr += `${C.dim}:${lineNum}${RESET}`;
        if (func) pointerStr += ` ${C.dim}(${func})${RESET}`;

        lines.push(truncate(pointerStr, width - 1));
      }
    }

    // Related memories section
    const related = memory.related || memory.relatedMemories || this._relatedMemories || [];
    if (related.length > 0) {
      lines.push('');
      lines.push(` ${C.border}${BOX.h.repeat(width - 2)}${RESET}`);
      lines.push('');
      lines.push(` ${BOLD}${C.cyan}Related${RESET}`);
      lines.push('');

      for (const rel of related.slice(0, 10)) {
        const relContent = (rel.content || rel.summary || 'untitled').replace(/[\n\r]+/g, ' ').trim();
        const score = rel.similarity || rel.score || rel.strength || 0;
        const scoreStr = typeof score === 'number' ? `(${score.toFixed(2)})` : '';
        const relPreview = truncate(relContent, width - 10);
        lines.push(`  ${C.semantic}\u2192${RESET} ${C.text}${relPreview}${RESET} ${C.dim}${scoreStr}${RESET}`);
      }
    }

    // Metadata section
    const metadata = memory.metadata || {};
    const metaKeys = Object.keys(metadata).filter(k => k !== 'content' && k !== 'tags');
    if (metaKeys.length > 0) {
      lines.push('');
      lines.push(` ${C.border}${BOX.h.repeat(width - 2)}${RESET}`);
      lines.push('');
      lines.push(` ${BOLD}${C.cyan}Metadata${RESET}`);
      lines.push('');

      for (const key of metaKeys.slice(0, 15)) {
        const val = String(metadata[key]).replace(/[\n\r]+/g, ' ').trim();
        const valTrunc = truncate(val, width - key.length - 6);
        lines.push(`  ${C.dim}${key}:${RESET} ${C.text}${valTrunc}${RESET}`);
      }
    }

    return lines;
  }

  // -------------------------------------------------------------------------
  // Empty / Error States
  // -------------------------------------------------------------------------

  /**
   * Render empty state (no data source).
   * @param {number} width
   * @param {number} height
   * @returns {string[]}
   * @private
   */
  _renderEmptyState(width, height) {
    const lines = [];
    const center = (text) => {
      const tw = vWidth(text);
      const leftPad = Math.max(0, Math.floor((width - tw) / 2));
      return ' '.repeat(leftPad) + text;
    };

    lines.push(pad('', width));
    lines.push(pad('', width));
    lines.push(pad(center(`${C.dim}\u2500\u2500\u2500 No Data Source \u2500\u2500\u2500${RESET}`), width));
    lines.push(pad('', width));
    lines.push(pad(center(`${C.text}SpecMem MCP server not connected.${RESET}`), width));
    lines.push(pad('', width));

    if (this._dataSourceError) {
      const errLines = wordWrap(this._dataSourceError, width - 4);
      for (const line of errLines) {
        lines.push(pad(`  ${C.error}${line}${RESET}`, width));
      }
      lines.push(pad('', width));
    }

    lines.push(pad(center(`${C.dim}To start the MCP server:${RESET}`), width));
    lines.push(pad(`  ${C.cyan}specmem start${RESET}`, width));
    lines.push(pad('', width));
    lines.push(pad(center(`${C.dim}Or provide a dbQuery function${RESET}`), width));
    lines.push(pad(center(`${C.dim}in the constructor options.${RESET}`), width));

    while (lines.length < height) {
      lines.push(pad('', width));
    }
    return lines.slice(0, height);
  }

  /**
   * Render error state.
   * @param {number} width
   * @param {number} height
   * @returns {string[]}
   * @private
   */
  _renderErrorState(width, height) {
    const lines = [];
    lines.push(pad('', width));
    lines.push(pad(`  ${C.error}\u26A0 Error${RESET}`, width));
    lines.push(pad('', width));

    if (this._error) {
      const errLines = wordWrap(this._error, width - 4);
      for (const line of errLines) {
        lines.push(pad(`  ${C.text}${line}${RESET}`, width));
      }
    }

    lines.push(pad('', width));
    lines.push(pad(`  ${C.dim}Press 'r' to retry${RESET}`, width));

    while (lines.length < height) {
      lines.push(pad('', width));
    }
    return lines.slice(0, height);
  }

  /**
   * Render no-results state.
   * @param {number} width
   * @param {number} height
   * @returns {string[]}
   * @private
   */
  _renderNoResults(width, height) {
    const lines = [];
    lines.push(pad('', width));
    lines.push(pad(`  ${C.dim}\u2500\u2500\u2500 No Memories Found \u2500\u2500\u2500${RESET}`, width));
    lines.push(pad('', width));

    if (this._searchQuery) {
      lines.push(pad(`  ${C.text}No results for: "${this._searchQuery}"${RESET}`, width));
      lines.push(pad('', width));
      lines.push(pad(`  ${C.dim}Try a different search term${RESET}`, width));
      lines.push(pad(`  ${C.dim}or press ESC to clear search.${RESET}`, width));
    } else {
      lines.push(pad(`  ${C.text}No memories stored yet.${RESET}`, width));
      lines.push(pad('', width));
      lines.push(pad(`  ${C.dim}Use SpecMem to save memories:${RESET}`, width));
      lines.push(pad(`  ${C.cyan}save_memory({content: "..."})${RESET}`, width));
    }

    while (lines.length < height) {
      lines.push(pad('', width));
    }
    return lines.slice(0, height);
  }

  /**
   * Render empty detail panel (no selection).
   * @param {number} width
   * @param {number} height
   * @returns {string[]}
   * @private
   */
  _renderDetailEmpty(width, height) {
    const lines = [];
    const center = (text) => {
      const tw = vWidth(text);
      const leftPad = Math.max(0, Math.floor((width - tw) / 2));
      return ' '.repeat(leftPad) + text;
    };

    const emptyHeight = Math.floor(height / 2) - 1;
    for (let i = 0; i < emptyHeight; i++) {
      lines.push(pad('', width));
    }

    lines.push(pad(center(`${C.dim}Select a memory to view details${RESET}`), width));
    lines.push(pad('', width));
    lines.push(pad(center(`${C.dim}Use \u2191\u2193 to navigate, Enter to focus${RESET}`), width));

    while (lines.length < height) {
      lines.push(pad('', width));
    }
    return lines.slice(0, height);
  }

  /**
   * Render "terminal too small" message.
   * @param {number} width
   * @param {number} height
   * @returns {string[]}
   * @private
   */
  _renderTooSmall(width, height) {
    const lines = [];
    for (let i = 0; i < height; i++) {
      if (i === Math.floor(height / 2)) {
        const msg = 'Terminal too small';
        const truncMsg = msg.substring(0, width);
        lines.push(truncMsg + ' '.repeat(Math.max(0, width - truncMsg.length)));
      } else {
        lines.push(' '.repeat(width));
      }
    }
    return lines;
  }

  // =========================================================================
  // Public API helpers
  // =========================================================================

  /**
   * Get the currently selected memory object.
   * @returns {Object|null}
   */
  getSelectedMemory() {
    return this._selectedMemory;
  }

  /**
   * Get current state for external use (e.g., status bar).
   * @returns {Object}
   */
  getState() {
    return {
      page: this._page + 1,
      totalPages: this._totalPages,
      totalMemories: this._totalCount,
      selectedIndex: this._selectedIndex,
      searchQuery: this._searchQuery,
      searchActive: this._searchActive,
      activePanel: this._activePanel,
      loading: this._loading,
      error: this._error,
      dataSourceReady: this._dataSourceReady
    };
  }

  /**
   * Set the search query programmatically.
   * @param {string} query
   */
  setSearchQuery(query) {
    this._searchQuery = query || '';
    this._page = 0;
    this._selectedIndex = 0;
    this.update();
  }

  /**
   * Navigate to a specific page.
   * @param {number} page - 1-based page number
   */
  goToPage(page) {
    const targetPage = Math.max(0, Math.min((page || 1) - 1, this._totalPages - 1));
    if (targetPage !== this._page) {
      this._page = targetPage;
      this._selectedIndex = 0;
      this.update();
    }
  }

  /**
   * Get the screen name for tab display.
   * @returns {string}
   */
  getName() {
    return 'Memory Browser';
  }

  /**
   * Get the short name for tab bar.
   * @returns {string}
   */
  getShortName() {
    return 'Memories';
  }

  /**
   * Check if the screen needs a refresh.
   * @returns {boolean}
   */
  needsRefresh() {
    return this._active && (Date.now() - this._lastRefresh > DATA_REFRESH_MS);
  }

  /**
   * Delete a memory by ID (called after confirmation by parent).
   * @param {string} memoryId
   * @returns {Promise<boolean>}
   */
  async deleteMemory(memoryId) {
    if (!memoryId) return false;

    try {
      if (this.mcpClient && this._dataSourceReady) {
        await this.mcpClient.callTool('remove_memory', { id: memoryId });
        await this.update();
        return true;
      }
      if (this.dbQuery) {
        // Custom delete via dbQuery
        await this.dbQuery({ action: 'delete', id: memoryId });
        await this.update();
        return true;
      }
    } catch (err) {
      this._error = 'Delete failed: ' + err.message;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { MemoryBrowserScreen };
