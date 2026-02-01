'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');

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

  // Helper: truncate string with ANSI awareness
  truncate(str, maxLen) {
    if (!str) return '';
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
    return result + '...';
  }

  // Helper: pad string to width
  pad(str, width) {
    const plain = (str || '').replace(/\x1b\[[0-9;]*m/g, '');
    const padding = Math.max(0, width - plain.length);
    return str + ' '.repeat(padding);
  }
}

/**
 * PreviewModule - TOP LEFT: Live  screen preview
 */
class PreviewModule extends DashboardModule {
  constructor(renderer, options = {}) {
    super('Preview', renderer, options);
    this.screenCache = '';
    this.lastContent = '';
    this.getActiveSession = options.getActiveSession || (() => null);
    this.screenReadFn = options.screenReadFn || (() => ({ content: '' }));
    this.logFile = options.logFile || '';
  }

  async update() {
    const { c, icons } = this;
    this.lines = [];

    try {
      const activeSession = this.getActiveSession();
      let screenContent = '';

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
        // Empty state
        this.lines.push('');
        this.lines.push(`${c.dim || ''}  No  session output${c.reset || ''}`);
        this.lines.push('');
        if (!activeSession) {
          this.lines.push(`${c.dim || ''}  Press ${c.cyan || ''}n${c.dim || ''} to start${c.reset || ''}`);
        } else {
          this.lines.push(`${c.dim || ''}  Session: ${c.cyan || ''}${activeSession}${c.reset || ''}`);
        }
      }
    } catch (err) {
      this.lines.push(`${c.red || ''}[Error: ${err.message}]${c.reset || ''}`);
    }

    this.lastUpdate = Date.now();
  }

  render() {
    return this.lines;
  }
}

/**
 * PythiaCOTModule - TOP RIGHT: Chain of thought reasoning display
 */
class PythiaCOTModule extends DashboardModule {
  constructor(renderer, options = {}) {
    super('PythiaCOT', renderer, options);
    this.cotLines = [];
    this.getCotLines = options.getCotLines || (() => []);
  }

  async update() {
    const { c, icons } = this;
    this.lines = [];

    try {
      // Check Pythia status
      const miniCotSocket = path.join(this.projectPath, 'specmem/sockets/minicot.sock');
      const isRunning = fs.existsSync(miniCotSocket);

      // Status line
      if (isRunning) {
        this.lines.push(`${c.green || ''}${icons.check || '✓'} Pythia COT: Online${c.reset || ''}`);
      } else {
        this.lines.push(`${c.dim || ''}${icons.circle || '○'} Pythia COT: Offline${c.reset || ''}`);
      }
      this.lines.push('');

      // COT content
      const cotContent = this.getCotLines();
      if (cotContent && cotContent.length > 0) {
        for (let i = 0; i < Math.min(cotContent.length, this.height - 3); i++) {
          this.lines.push(this.truncate(cotContent[i] || '', this.width - 4));
        }
      } else {
        this.lines.push(`${c.dim || ''}[No active reasoning]${c.reset || ''}`);
        this.lines.push('');
        this.lines.push(`${c.dim || ''}COT appears here when${c.reset || ''}`);
        this.lines.push(`${c.dim || ''} is thinking...${c.reset || ''}`);
      }
    } catch (err) {
      this.lines.push(`${c.red || ''}[Error: ${err.message}]${c.reset || ''}`);
    }

    this.lastUpdate = Date.now();
  }

  render() {
    return this.lines;
  }
}

/**
 * MCPToolsModule - BOTTOM RIGHT: MCP tool calls display
 */
class MCPToolsModule extends DashboardModule {
  constructor(renderer, options = {}) {
    super('MCPTools', renderer, options);
    this.toolHistory = [];
    this.mcpToolPanel = options.mcpToolPanel || null;
    this.getToolHistory = options.getToolHistory || (() => []);
  }

  async update() {
    const { c, icons } = this;
    this.lines = [];

    try {
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
        // Use tool history
        const history = this.getToolHistory();
        if (history && history.length > 0) {
          for (let i = 0; i < Math.min(history.length, this.height - 1); i++) {
            const tool = history[i];
            const time = tool.timestamp ? tool.timestamp.toLocaleTimeString().slice(0, 8) : '';
            const line = `${c.dim || ''}${time}${c.reset || ''} ${c.brightCyan || ''}${tool.name}${c.reset || ''}`;
            this.lines.push(this.truncate(line, this.width - 4));
          }
        } else {
          // Empty state
          this.lines.push(`${c.dim || ''}${icons.circle || '○'} No tool activity${c.reset || ''}`);
          this.lines.push('');
          this.lines.push(`${c.dim || ''}Tools appear here when ${c.reset || ''}`);
          this.lines.push(`${c.dim || ''}calls MCP tools or functions${c.reset || ''}`);
        }
      }
    } catch (err) {
      this.lines.push(`${c.red || ''}[Error: ${err.message}]${c.reset || ''}`);
    }

    this.lastUpdate = Date.now();
  }

  render() {
    return this.lines;
  }
}

/**
 * CommandConsoleModule - BOTTOM LEFT: Command input and history
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

  async update() {
    const { c, icons } = this;
    this.lines = [];

    try {
      const inputMode = this.getInputMode();
      const inputBuffer = this.getInputBuffer();
      const history = this.getCommandHistory();

      if (inputMode === 'claude') {
        this.lines.push(`${c.bgGreen || ''}${c.black || ''} CLAUDE MODE ${c.reset || ''} ${c.dim || ''}(ESC+ESC to exit)${c.reset || ''}`);
        this.lines.push('');
        this.lines.push(`${c.cyan || ''}>${c.reset || ''} ${c.dim || ''}[typing directly into ]${c.reset || ''}`);
        this.lines.push('');
        this.lines.push(`${c.dim || ''}All keystrokes sent directly to ${c.reset || ''}`);
        this.lines.push(`${c.dim || ''}Ctrl+C=interrupt | Arrows/Tab work${c.reset || ''}`);
      } else if (inputMode === 'specmem') {
        this.lines.push(`${c.bgMagenta || ''}${c.white || ''} SPECMEM MODE ${c.reset || ''} ${c.dim || ''}(Q to exit)${c.reset || ''}`);
        this.lines.push('');
        this.lines.push(`${c.magenta || ''}specmem>${c.reset || ''} ${inputBuffer || ''}${c.bgWhite || ''} ${c.reset || ''}`);

        if (history.length > 0) {
          this.lines.push('');
          const maxLines = Math.min(history.length, this.height - 6);
          const startIdx = Math.max(0, history.length - maxLines);
          for (let i = startIdx; i < history.length; i++) {
            this.lines.push(this.truncate(history[i], this.width - 4));
          }
        } else {
          this.lines.push('');
          this.lines.push(`${c.dim || ''}Commands: find, code, broadcast, team${c.reset || ''}`);
        }
      } else if (history.length === 0) {
        // Empty state with help
        this.lines.push(`${c.dim || ''}${icons.circle || '○'} Ready for commands${c.reset || ''}`);
        this.lines.push('');
        this.lines.push(`${c.cyan || ''}${icons.arrow || '→'}${c.reset || ''} ${c.white || ''}Quick Start:${c.reset || ''}`);
        this.lines.push(`  ${c.brightCyan || ''}i${c.reset || ''} ${c.dim || ''}-${c.reset || ''} Chat with `);
        this.lines.push(`  ${c.brightCyan || ''}n${c.reset || ''} ${c.dim || ''}-${c.reset || ''} New session`);
        this.lines.push(`  ${c.brightCyan || ''}h${c.reset || ''} ${c.dim || ''}-${c.reset || ''} All shortcuts`);
      } else {
        // Show command history
        const displayCount = Math.min(history.length, this.height - 3);
        const startIdx = Math.max(0, history.length - displayCount);
        for (let i = startIdx; i < history.length; i++) {
          this.lines.push(this.truncate(history[i], this.width - 4));
        }
      }
    } catch (err) {
      this.lines.push(`${c.red || ''}[Error: ${err.message}]${c.reset || ''}`);
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
 */
class ModuleManager {
  constructor(options = {}) {
    this.modules = new Map();
    this.activeModule = null;
    this.renderer = options.renderer;
    this.c = options.colors || {};
    this.icons = options.icons || {};
    this.projectPath = options.projectPath || process.cwd();
  }

  register(position, module) {
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
}

module.exports = {
  DashboardModule,
  PreviewModule,
  PythiaCOTModule,
  MCPToolsModule,
  CommandConsoleModule,
  ModuleManager
};
