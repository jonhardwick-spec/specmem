'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');

// AEGIS Theme integration (graceful fallback)
let AegisTheme, AEGIS_ICONS;
try {
  ({ AegisTheme, AEGIS_ICONS } = require('./AegisTheme.cjs'));
} catch (e) {
  AegisTheme = null; // Fallback to basic ANSI
}

// LiveScreenCapture for Preview panel (graceful fallback)
let LiveScreenCapture;
try {
  LiveScreenCapture = require('./LiveScreenCapture.cjs');
} catch (e) {
  LiveScreenCapture = null;
}

// AnsiRenderer for ANSI-aware text operations (graceful fallback)
let AnsiRenderer;
try {
  ({ AnsiRenderer } = require('./AnsiRenderer.cjs'));
} catch (e) {
  AnsiRenderer = null;
}

/**
 * DashboardModule - Base class for all dashboard quadrant modules
 * Minecraft-style module management - each "cheat" is its own isolated module
 */
class DashboardModule {
  constructor(name, renderer, options = {}) {
    this.name = name;
    this.renderer = renderer;
    this.width = options.width || 40;
    this.height = options.height || 10;
    this.lines = [];
    this.enabled = true;
    this.focused = false; // Track if this tile is selected/focused
    this.lastUpdate = 0;
    this.updateInterval = options.updateInterval || 1000;
    this.c = options.colors || {};
    this.icons = options.icons || {};
    this.projectPath = options.projectPath || process.cwd();
    this.theme = options.theme || AegisTheme || null;
  }

  // Set focus state - modules can skip expensive operations when not focused
  setFocused(isFocused) {
    this.focused = isFocused;
  }

  // Override in subclass - refresh module data
  async update() {
    throw new Error(`${this.name}: update() not implemented`);
  }

  // Override in subclass - return lines array for rendering
  render() {
    return this.lines;
  }

  // Override in subclass - handle input, return true if consumed
  handleInput(key) {
    return false;
  }

  /**
   * getColor - Retrieve a named color using AegisTheme when available,
   * falling back to basic ANSI escape codes.
   * @param {string} name - Color name (e.g., 'green', 'cyan', 'dim', 'reset', 'red', 'magenta', 'white', 'bgGreen', 'bgMagenta', 'bgCyan')
   * @returns {string} ANSI escape sequence
   */
  getColor(name) {
    // Try AegisTheme first for truecolor support
    if (this.theme) {
      const themeColors = {
        green: this.theme.colors?.success || this.theme.colors?.green || '\x1b[32m',
        red: this.theme.colors?.error || this.theme.colors?.red || '\x1b[31m',
        cyan: this.theme.colors?.accent || this.theme.colors?.cyan || '\x1b[36m',
        magenta: this.theme.colors?.magenta || this.theme.colors?.purple || '\x1b[35m',
        white: this.theme.colors?.text || this.theme.colors?.white || '\x1b[37m',
        dim: this.theme.colors?.muted || this.theme.colors?.dim || '\x1b[2m',
        bold: '\x1b[1m',
        reset: '\x1b[0m',
        brightCyan: this.theme.colors?.highlight || this.theme.colors?.brightCyan || '\x1b[96m',
        black: '\x1b[30m',
        yellow: this.theme.colors?.warning || this.theme.colors?.yellow || '\x1b[33m',
        bgGreen: this.theme.colors?.bgSuccess || '\x1b[42m',
        bgMagenta: this.theme.colors?.bgMagenta || '\x1b[45m',
        bgCyan: this.theme.colors?.bgCyan || '\x1b[46m',
        bgWhite: '\x1b[47m',
      };
      if (themeColors[name] !== undefined) return themeColors[name];
    }

    // Fallback to this.c (basic ANSI passed via options)
    if (this.c[name]) return this.c[name];

    // Last resort: basic ANSI codes
    const basicAnsi = {
      green: '\x1b[32m',
      red: '\x1b[31m',
      cyan: '\x1b[36m',
      magenta: '\x1b[35m',
      white: '\x1b[37m',
      dim: '\x1b[2m',
      bold: '\x1b[1m',
      reset: '\x1b[0m',
      brightCyan: '\x1b[96m',
      black: '\x1b[30m',
      yellow: '\x1b[33m',
      bgGreen: '\x1b[42m',
      bgMagenta: '\x1b[45m',
      bgCyan: '\x1b[46m',
      bgWhite: '\x1b[47m',
    };
    return basicAnsi[name] || '';
  }

  // Helper: truncate string with ANSI awareness
  truncate(str, maxLen) {
    if (!str) return '';

    // Use AnsiRenderer when available for proper ANSI-aware truncation
    if (AnsiRenderer && typeof AnsiRenderer.truncate === 'function') {
      try {
        return AnsiRenderer.truncate(str, maxLen);
      } catch (e) {
        // Fall through to manual truncation
      }
    }

    // Strip ANSI for length calc
    const plain = str.replace(/\x1b\[[0-9;]*m/g, '');
    if (plain.length <= maxLen) return str;

    // Truncate preserving ANSI codes
    let visibleLen = 0;
    let result = '';
    let i = 0;
    while (i < str.length && visibleLen < maxLen - 3) {
      if (str[i] === '\x1b') {
        // ANSI sequence - copy until 'm'
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
    return result + '...\x1b[0m';
  }

  // Helper: pad string to width
  pad(str, width) {
    // Use AnsiRenderer when available for proper ANSI-aware padding
    if (AnsiRenderer && typeof AnsiRenderer.pad === 'function') {
      try {
        return AnsiRenderer.pad(str, width);
      } catch (e) {
        // Fall through to manual padding
      }
    }

    const plain = (str || '').replace(/\x1b\[[0-9;]*m/g, '');
    const padding = Math.max(0, width - plain.length);
    return str + ' '.repeat(padding);
  }
}

/**
 * PreviewModule - TOP LEFT: Live screen preview
 * Uses LiveScreenCapture when available for ANSI color preservation
 */
class PreviewModule extends DashboardModule {
  constructor(renderer, options = {}) {
    super('Preview', renderer, options);
    this.screenCache = '';
    this.lastContent = '';
    this.getActiveSession = options.getActiveSession || (() => null);
    this.screenReadFn = options.screenReadFn || (() => ({ content: '' }));
    this.logFile = options.logFile || '';

    // Use LiveScreenCapture instead of log file reading (preserves ANSI colors)
    this.capture = null;
    if (LiveScreenCapture) {
      try {
        this.capture = new LiveScreenCapture({
          projectPath: this.projectPath,
          maxLines: 200,
          pollInterval: 500
        });
      } catch (e) {
        this.capture = null;
      }
    }
  }

  async update() {
    this.lines = [];

    try {
      const activeSession = this.getActiveSession();
      let screenContent = '';
      let usedLiveCapture = false;

      // PRIORITY 1: Try LiveScreenCapture (preserves ANSI colors!)
      if (this.capture && this.focused) {
        try {
          if (!this.capture.isCapturing || this.capture.sessionName !== activeSession) {
            if (activeSession) {
              this.capture.startCapture(activeSession);
            }
          }
          if (activeSession && this.capture.isCapturing) {
            const content = this.capture.getContent(this.height - 1);
            if (content && content.lines && content.lines.length > 0) {
              // Use AnsiRenderer to fit content in bounds WITH colors preserved
              if (AnsiRenderer && typeof AnsiRenderer.renderInBounds === 'function') {
                this.lines = AnsiRenderer.renderInBounds(
                  content.lines, this.width - 4, this.height - 1,
                  { wrapMode: 'truncate' }
                );
              } else {
                // Fallback: basic truncation (still preserve ANSI)
                for (const line of content.lines.slice(0, this.height - 1)) {
                  this.lines.push(this.truncate(line, this.width - 4));
                }
              }
              this.lastContent = this.lines.join('\n');
              usedLiveCapture = true;
            }
          }
        } catch (e) {
          // LiveScreenCapture failed, fall through to legacy methods
        }
      }

      // PRIORITY 2: Legacy screen read function (original behavior)
      if (!usedLiveCapture) {
        // PERFORMANCE: Only poll screen when this tile is focused (selected)
        // When not focused, use cached content to save CPU/I/O
        if (this.focused) {
          // Non-blocking screen read - only when focused
          const screenResult = this.screenReadFn(activeSession, this.height - 1);
          if (screenResult && screenResult.content && screenResult.content.trim()) {
            screenContent = screenResult.content;
            this.lastContent = screenContent;
          } else {
            screenContent = this.lastContent;
          }
        } else {
          // Not focused - use cached content, no polling
          screenContent = this.lastContent;
        }

        // Fallback to log file
        if (!screenContent.trim() && this.logFile) {
          try {
            const logContent = fs.readFileSync(this.logFile, 'utf8')
              .split('\n').slice(-this.height).join('\n');
            if (logContent.trim()) {
              screenContent = logContent;
              this.lastContent = screenContent;
            }
          } catch (e) { /* ignore */ }
        }

        // Process content for display
        if (screenContent.trim()) {
          const contentLines = screenContent.split('\n');
          for (let i = 0; i < Math.min(contentLines.length, this.height - 1); i++) {
            let line = contentLines[i] || '';
            // Clean control chars but keep ANSI
            line = line.replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g, '');
            // Filter MCP XML noise
            line = line.replace(/<\/?antml:[^>]*>/g, '');
            line = line.replace(/<\/?function_calls>/g, '');
            line = line.replace(/<\/?invoke[^>]*>/g, '');
            line = line.replace(/<\/?parameter[^>]*>/g, '');
            line = line.replace(/<\/?result>/g, '');
            line = line.replace(/<\/?output>/g, '');
            line = line.replace(/<name>.*?<\/name>/g, '');

            if (line.trim()) {
              this.lines.push(this.truncate(line, this.width - 4));
            }
          }
        } else {
          // Empty state with AEGIS styling
          const dim = this.getColor('dim');
          const cyan = this.getColor('cyan');
          const reset = this.getColor('reset');

          this.lines.push('');
          this.lines.push(`${dim}  No session output${reset}`);
          this.lines.push('');
          if (!activeSession) {
            this.lines.push(`${dim}  Press ${cyan}n${dim} to start${reset}`);
          } else {
            this.lines.push(`${dim}  Session: ${cyan}${activeSession}${reset}`);
          }
        }
      }
    } catch (err) {
      const red = this.getColor('red');
      const reset = this.getColor('reset');
      this.lines.push(`${red}[Error: ${err.message}]${reset}`);
    }

    this.lastUpdate = Date.now();
  }

  render() {
    return this.lines;
  }

  // Cleanup LiveScreenCapture when module is destroyed
  destroy() {
    if (this.capture && typeof this.capture.stopCapture === 'function') {
      try { this.capture.stopCapture(); } catch (e) { /* ignore */ }
    }
  }
}

/**
 * PythiaCOTModule - TOP RIGHT: Chain of thought reasoning display
 * Uses AEGIS colors: status indicator in green/red, section headers in cyan
 */
class PythiaCOTModule extends DashboardModule {
  constructor(renderer, options = {}) {
    super('PythiaCOT', renderer, options);
    this.cotLines = [];
    this.getCotLines = options.getCotLines || (() => []);
  }

  async update() {
    this.lines = [];

    try {
      // Check Pythia status
      const miniCotSocket = path.join(this.projectPath, 'specmem/sockets/minicot.sock');
      const isRunning = fs.existsSync(miniCotSocket);

      const green = this.getColor('green');
      const red = this.getColor('red');
      const dim = this.getColor('dim');
      const cyan = this.getColor('cyan');
      const brightCyan = this.getColor('brightCyan');
      const bold = this.getColor('bold');
      const reset = this.getColor('reset');
      const yellow = this.getColor('yellow');

      const checkIcon = (AEGIS_ICONS && AEGIS_ICONS.check) || this.icons.check || '\u2713';
      const circleIcon = (AEGIS_ICONS && AEGIS_ICONS.circle) || this.icons.circle || '\u25CB';
      const brainIcon = (AEGIS_ICONS && AEGIS_ICONS.brain) || '\u{1F9E0}';

      // Status line with AEGIS styling
      if (isRunning) {
        this.lines.push(`${green}${bold}${checkIcon}${reset} ${cyan}${bold}Pythia COT:${reset} ${green}Online${reset}`);
      } else {
        this.lines.push(`${dim}${circleIcon}${reset} ${dim}Pythia COT: Offline${reset}`);
      }
      this.lines.push('');

      // COT content with AEGIS formatting
      const cotContent = this.getCotLines();
      if (cotContent && cotContent.length > 0) {
        for (let i = 0; i < Math.min(cotContent.length, this.height - 3); i++) {
          let line = cotContent[i] || '';
          // Style section headers in cyan
          if (line.startsWith('#') || line.startsWith('##') || line.match(/^[A-Z][A-Z ]+:/)) {
            line = `${cyan}${bold}${line}${reset}`;
          } else if (line.startsWith('>') || line.startsWith('  >')) {
            // Quoted/thinking lines in dim
            line = `${dim}${line}${reset}`;
          } else if (line.match(/^\s*[-*]\s/)) {
            // Bullet points with cyan bullet
            line = line.replace(/^(\s*)([-*])(\s)/, `$1${brightCyan}$2${reset}$3`);
          }
          this.lines.push(this.truncate(line, this.width - 4));
        }
      } else {
        this.lines.push(`${dim}[No active reasoning]${reset}`);
        this.lines.push('');
        this.lines.push(`${dim}COT appears here when${reset}`);
        this.lines.push(`${dim}Claude is thinking...${reset}`);
      }
    } catch (err) {
      const red = this.getColor('red');
      const reset = this.getColor('reset');
      this.lines.push(`${red}[Error: ${err.message}]${reset}`);
    }

    this.lastUpdate = Date.now();
  }

  render() {
    return this.lines;
  }
}

/**
 * MCPToolsModule - BOTTOM RIGHT: MCP tool calls display
 * Tool names in cyan bold, timestamps in dim/muted, AEGIS status colors for success/error
 */
class MCPToolsModule extends DashboardModule {
  constructor(renderer, options = {}) {
    super('MCPTools', renderer, options);
    this.toolHistory = [];
    this.mcpToolPanel = options.mcpToolPanel || null;
    this.getToolHistory = options.getToolHistory || (() => []);
  }

  async update() {
    this.lines = [];

    try {
      const dim = this.getColor('dim');
      const cyan = this.getColor('cyan');
      const brightCyan = this.getColor('brightCyan');
      const bold = this.getColor('bold');
      const green = this.getColor('green');
      const red = this.getColor('red');
      const yellow = this.getColor('yellow');
      const reset = this.getColor('reset');

      const circleIcon = (AEGIS_ICONS && AEGIS_ICONS.circle) || this.icons.circle || '\u25CB';
      const checkIcon = (AEGIS_ICONS && AEGIS_ICONS.check) || this.icons.check || '\u2713';
      const crossIcon = (AEGIS_ICONS && AEGIS_ICONS.cross) || this.icons.cross || '\u2717';
      const toolIcon = (AEGIS_ICONS && AEGIS_ICONS.tool) || '\u{1F527}';

      // Try database fetch first
      let hasDbCalls = false;
      if (this.mcpToolPanel) {
        try {
          await this.mcpToolPanel.fetchMCPCalls(10);
          if (this.mcpToolPanel.calls && this.mcpToolPanel.calls.length > 0) {
            hasDbCalls = true;
            for (const call of this.mcpToolPanel.calls.slice(0, this.height - 1)) {
              const formatted = this.mcpToolPanel.formatCall(call, this.width - 4);
              this.lines.push(formatted);
            }
          }
        } catch (e) { /* ignore */ }
      }

      if (!hasDbCalls) {
        // Use tool history with AEGIS styling
        const history = this.getToolHistory();
        if (history && history.length > 0) {
          for (let i = 0; i < Math.min(history.length, this.height - 1); i++) {
            const tool = history[i];
            const time = tool.timestamp ? tool.timestamp.toLocaleTimeString().slice(0, 8) : '';

            // Status color based on success/error
            let statusIndicator = '';
            if (tool.status === 'success' || tool.success === true) {
              statusIndicator = `${green}${checkIcon}${reset} `;
            } else if (tool.status === 'error' || tool.error === true) {
              statusIndicator = `${red}${crossIcon}${reset} `;
            }

            // Timestamp in dim, tool name in cyan bold
            const line = `${dim}${time}${reset} ${statusIndicator}${cyan}${bold}${tool.name}${reset}`;
            this.lines.push(this.truncate(line, this.width - 4));
          }
        } else {
          // Empty state with AEGIS styling
          this.lines.push(`${dim}${circleIcon} No tool activity${reset}`);
          this.lines.push('');
          this.lines.push(`${dim}Tools appear here when Claude${reset}`);
          this.lines.push(`${dim}calls MCP tools or functions${reset}`);
        }
      }
    } catch (err) {
      const red = this.getColor('red');
      const reset = this.getColor('reset');
      this.lines.push(`${red}[Error: ${err.message}]${reset}`);
    }

    this.lastUpdate = Date.now();
  }

  render() {
    return this.lines;
  }
}

/**
 * CommandConsoleModule - BOTTOM LEFT: Command input and history
 * Mode badges: CLAUDE (green), SPECMEM (magenta), COMMAND (cyan)
 * Key hints formatted with AegisTheme.keyHint(), prompt in AEGIS accent
 */
class CommandConsoleModule extends DashboardModule {
  constructor(renderer, options = {}) {
    super('CommandConsole', renderer, options);
    this.inputMode = 'command';
    this.inputBuffer = '';
    this.commandHistory = [];
    this.getInputMode = options.getInputMode || (() => 'command');
    this.getInputBuffer = options.getInputBuffer || (() => '');
    this.getCommandHistory = options.getCommandHistory || (() => []);
  }

  /**
   * Format a key hint using AegisTheme when available, or fallback to basic styling
   */
  _keyHint(key, desc) {
    if (this.theme && typeof this.theme.keyHint === 'function') {
      return this.theme.keyHint(key, desc);
    }
    const brightCyan = this.getColor('brightCyan');
    const dim = this.getColor('dim');
    const reset = this.getColor('reset');
    return `  ${brightCyan}${key}${reset} ${dim}-${reset} ${desc}`;
  }

  /**
   * Create a mode badge with appropriate AEGIS background color
   */
  _modeBadge(label, bgColorName) {
    if (this.theme && typeof this.theme.badge === 'function') {
      return this.theme.badge(label, bgColorName);
    }
    const bg = this.getColor(bgColorName);
    const black = this.getColor('black');
    const white = this.getColor('white');
    const reset = this.getColor('reset');
    // Use black text on bright backgrounds, white on dark
    const textColor = (bgColorName === 'bgGreen' || bgColorName === 'bgCyan') ? black : white;
    return `${bg}${textColor} ${label} ${reset}`;
  }

  async update() {
    this.lines = [];

    try {
      const inputMode = this.getInputMode();
      const inputBuffer = this.getInputBuffer();
      const history = this.getCommandHistory();

      const dim = this.getColor('dim');
      const cyan = this.getColor('cyan');
      const magenta = this.getColor('magenta');
      const brightCyan = this.getColor('brightCyan');
      const white = this.getColor('white');
      const reset = this.getColor('reset');
      const bgWhite = this.getColor('bgWhite');

      const circleIcon = (AEGIS_ICONS && AEGIS_ICONS.circle) || this.icons.circle || '\u25CB';
      const arrowIcon = (AEGIS_ICONS && AEGIS_ICONS.arrow) || this.icons.arrow || '\u2192';

      if (inputMode === 'claude') {
        // CLAUDE mode - green badge
        const badge = this._modeBadge('CLAUDE MODE', 'bgGreen');
        this.lines.push(`${badge} ${dim}(ESC+ESC to exit)${reset}`);
        this.lines.push('');
        this.lines.push(`${cyan}>${reset} ${dim}[typing directly into Claude]${reset}`);
        this.lines.push('');
        this.lines.push(`${dim}All keystrokes sent directly to Claude${reset}`);
        this.lines.push(`${dim}Ctrl+C=interrupt | Arrows/Tab work${reset}`);
      } else if (inputMode === 'specmem') {
        // SPECMEM mode - magenta badge
        const badge = this._modeBadge('SPECMEM MODE', 'bgMagenta');
        this.lines.push(`${badge} ${dim}(Q to exit)${reset}`);
        this.lines.push('');
        // Prompt in AEGIS accent color (cyan/magenta)
        this.lines.push(`${magenta}specmem>${reset} ${inputBuffer || ''}${bgWhite} ${reset}`);

        if (history.length > 0) {
          this.lines.push('');
          const maxLines = Math.min(history.length, this.height - 6);
          const startIdx = Math.max(0, history.length - maxLines);
          for (let i = startIdx; i < history.length; i++) {
            this.lines.push(this.truncate(history[i], this.width - 4));
          }
        } else {
          this.lines.push('');
          this.lines.push(`${dim}Commands: find, code, broadcast, team${reset}`);
        }
      } else if (history.length === 0) {
        // Empty state with AEGIS-styled help
        this.lines.push(`${dim}${circleIcon} Ready for commands${reset}`);
        this.lines.push('');
        this.lines.push(`${cyan}${arrowIcon}${reset} ${white}Quick Start:${reset}`);
        this.lines.push(this._keyHint('i', 'Chat with Claude'));
        this.lines.push(this._keyHint('n', 'New session'));
        this.lines.push(this._keyHint('h', 'All shortcuts'));
      } else {
        // Show command history
        const displayCount = Math.min(history.length, this.height - 3);
        const startIdx = Math.max(0, history.length - displayCount);
        for (let i = startIdx; i < history.length; i++) {
          this.lines.push(this.truncate(history[i], this.width - 4));
        }
      }
    } catch (err) {
      const red = this.getColor('red');
      const reset = this.getColor('reset');
      this.lines.push(`${red}[Error: ${err.message}]${reset}`);
    }

    this.lastUpdate = Date.now();
  }

  render() {
    return this.lines;
  }

  handleInput(key) {
    // Input handling is managed by parent dashboard
    return false;
  }
}

/**
 * ModuleManager - Orchestrates all dashboard modules
 * Supports AEGIS theme get/set and passes theme to all modules on creation
 */
class ModuleManager {
  constructor(options = {}) {
    this.modules = new Map();
    this.activeModule = null;
    this.renderer = options.renderer;
    this.c = options.colors || {};
    this.icons = options.icons || {};
    this.projectPath = options.projectPath || process.cwd();
    this.theme = options.theme || AegisTheme || null;
  }

  /**
   * Get the current AEGIS theme (or null if not available)
   * @returns {Object|null}
   */
  getTheme() {
    return this.theme;
  }

  /**
   * Set the AEGIS theme and propagate to all registered modules
   * @param {Object} theme - AegisTheme instance or compatible theme object
   */
  setTheme(theme) {
    this.theme = theme;
    // Propagate to all registered modules
    for (const [pos, mod] of this.modules) {
      mod.theme = theme;
    }
  }

  register(position, module) {
    // Ensure module has the current theme
    if (this.theme && !module.theme) {
      module.theme = this.theme;
    }
    this.modules.set(position, module);
    return this;
  }

  get(position) {
    return this.modules.get(position);
  }

  async updateAll() {
    const updates = [];
    for (const [pos, mod] of this.modules) {
      if (mod.enabled) {
        updates.push(mod.update().catch(err => {
          console.error(`[${mod.name}] Update error:`, err.message);
        }));
      }
    }
    await Promise.all(updates);
  }

  renderAll() {
    const result = {};
    for (const [pos, mod] of this.modules) {
      if (mod.enabled) {
        result[pos] = mod.render();
      }
    }
    return result;
  }

  handleInput(key) {
    // Route to active module first
    if (this.activeModule && this.activeModule.handleInput(key)) {
      return true;
    }
    // Try all modules
    for (const [pos, mod] of this.modules) {
      if (mod.handleInput(key)) {
        return true;
      }
    }
    return false;
  }

  setActive(position) {
    this.activeModule = this.modules.get(position) || null;
  }

  /**
   * Destroy all modules (cleanup resources like LiveScreenCapture)
   */
  destroy() {
    for (const [pos, mod] of this.modules) {
      if (typeof mod.destroy === 'function') {
        mod.destroy();
      }
    }
  }
}

module.exports = {
  DashboardModule,
  PreviewModule,
  PythiaCOTModule,
  MCPToolsModule,
  CommandConsoleModule,
  ModuleManager
};
