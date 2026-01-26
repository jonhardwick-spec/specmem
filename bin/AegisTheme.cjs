'use strict';

// ============================================================================
// AEGIS THEME - Centralized Theme Module for SpecMem TUI
// ============================================================================
//
// All TUI files should import from this module instead of defining inline colors.
//
// Usage:
//   const { AegisTheme, AEGIS_COLORS, AEGIS_ICONS } = require('./AegisTheme.cjs');
//
//   // Quick styling
//   console.log(AegisTheme.title + 'Hello World' + AegisTheme.reset);
//
//   // Truecolor foreground/background
//   console.log(AegisTheme.fg('cyan') + 'Cyan text' + AegisTheme.reset);
//   console.log(AegisTheme.bg('surface') + 'Dark bg' + AegisTheme.reset);
//
//   // Combined style
//   console.log(AegisTheme.style('cyan', 'bg') + 'Cyan on dark' + AegisTheme.reset);
//
//   // Terminal-safe (auto-detects capabilities)
//   const theme = AegisTheme.safeInstance();
//   console.log(theme.title + 'Works everywhere' + theme.reset);
//
// ============================================================================

// ---------------------------------------------------------------------------
// AEGIS Color Palette
// ---------------------------------------------------------------------------
// Truecolor ANSI: \x1b[38;2;R;G;Bm (foreground) \x1b[48;2;R;G;Bm (background)

const AEGIS_COLORS = {
  // Backgrounds (use as BG colors)
  bg:           { hex: '#0a0e14', r: 10,  g: 14,  b: 20  }, // Darkest navy-black
  surface:      { hex: '#131924', r: 19,  g: 25,  b: 36  }, // Panel backgrounds
  raised:       { hex: '#1a2233', r: 26,  g: 34,  b: 51  }, // Hover/active states
  border:       { hex: '#2a3a4a', r: 42,  g: 58,  b: 74  }, // Subtle borders
  highlight:    { hex: '#2a3a4a', r: 42,  g: 58,  b: 74  }, // Highlight areas

  // Primary accent colors (use as FG colors)
  cyan:         { hex: '#00d4ff', r: 0,   g: 212, b: 255 }, // PRIMARY - titles, active elements
  cyanDark:     { hex: '#0099bb', r: 0,   g: 153, b: 187 }, // Darker variant
  cyanLight:    { hex: '#66e5ff', r: 102, g: 229, b: 255 }, // Lighter variant
  green:        { hex: '#00ff88', r: 0,   g: 255, b: 136 }, // Success/completed
  yellow:       { hex: '#ffd700', r: 255, g: 215, b: 0   }, // Warning/DeltaNet
  red:          { hex: '#ff4444', r: 255, g: 68,  b: 68  }, // Error/critical
  magenta:      { hex: '#cc66ff', r: 204, g: 102, b: 255 }, // Special/LoRA
  orange:       { hex: '#ff8800', r: 255, g: 136, b: 0   }, // Orange accent

  // Text colors
  text:         { hex: '#d4dae4', r: 212, g: 218, b: 228 }, // Primary text
  textDim:      { hex: '#6a7a8a', r: 106, g: 122, b: 138 }, // Dimmed text
  textMuted:    { hex: '#4a5a6a', r: 74,  g: 90,  b: 106 }, // Muted text

  // Memory type colors
  episodic:     { hex: '#FF6B6B', r: 255, g: 107, b: 107 },
  semantic:     { hex: '#4ECDC4', r: 78,  g: 205, b: 196 },
  procedural:   { hex: '#45B7D1', r: 69,  g: 183, b: 209 },
  working:      { hex: '#96CEB4', r: 150, g: 206, b: 180 },
  consolidated: { hex: '#DDA0DD', r: 221, g: 160, b: 221 },
};

// ---------------------------------------------------------------------------
// AEGIS Icon Set (with ASCII fallbacks)
// ---------------------------------------------------------------------------

const AEGIS_ICONS = {
  // Status
  success:       '\u2713',     successAscii:   '[OK]',
  error:         '\u2717',     errorAscii:     '[X]',
  warning:       '\u26A0',     warningAscii:   '[!]',
  info:          '\u2139',     infoAscii:      '[i]',

  // UI
  bullet:        '\u2022',     bulletAscii:    '*',
  arrow:         '\u2192',     arrowAscii:     '->',
  arrowUp:       '\u2191',     arrowUpAscii:   '^',
  arrowDown:     '\u2193',     arrowDownAscii: 'v',

  // Blocks for progress bars
  blockFull:     '\u2588',
  blockLight:    '\u2591',
  blockMedium:   '\u2592',
  blockHeavy:    '\u2593',

  // Box chars for inline decorators
  dot:           '\u25CF',
  circle:        '\u25CB',
  diamond:       '\u25C6',
  star:          '\u2605',

  // Braille for mini charts (from AEGIS)
  braille:       '\u2800\u2801\u2802\u2803\u2804\u2805\u2806\u2807\u2840\u2841\u2842\u2843\u2844\u2845\u2846\u2847',
};

// ---------------------------------------------------------------------------
// 16-Color ANSI Fallback Map
// ---------------------------------------------------------------------------
// Maps AEGIS color names to the closest basic 16-color ANSI codes

const FALLBACK_16 = {
  // Backgrounds
  bg:           { fg: '\x1b[30m',  bg: '\x1b[40m'  }, // black
  surface:      { fg: '\x1b[30m',  bg: '\x1b[40m'  }, // black
  raised:       { fg: '\x1b[90m',  bg: '\x1b[100m' }, // bright black
  border:       { fg: '\x1b[90m',  bg: '\x1b[100m' }, // bright black
  highlight:    { fg: '\x1b[90m',  bg: '\x1b[100m' }, // bright black

  // Accents
  cyan:         { fg: '\x1b[96m',  bg: '\x1b[46m'  }, // bright cyan
  cyanDark:     { fg: '\x1b[36m',  bg: '\x1b[46m'  }, // cyan
  cyanLight:    { fg: '\x1b[96m',  bg: '\x1b[106m' }, // bright cyan
  green:        { fg: '\x1b[92m',  bg: '\x1b[42m'  }, // bright green
  yellow:       { fg: '\x1b[93m',  bg: '\x1b[43m'  }, // bright yellow
  red:          { fg: '\x1b[91m',  bg: '\x1b[41m'  }, // bright red
  magenta:      { fg: '\x1b[95m',  bg: '\x1b[45m'  }, // bright magenta
  orange:       { fg: '\x1b[33m',  bg: '\x1b[43m'  }, // yellow (closest to orange)

  // Text
  text:         { fg: '\x1b[37m',  bg: '\x1b[47m'  }, // white
  textDim:      { fg: '\x1b[90m',  bg: '\x1b[100m' }, // bright black (gray)
  textMuted:    { fg: '\x1b[90m',  bg: '\x1b[100m' }, // bright black (gray)

  // Memory types
  episodic:     { fg: '\x1b[91m',  bg: '\x1b[41m'  }, // bright red
  semantic:     { fg: '\x1b[36m',  bg: '\x1b[46m'  }, // cyan
  procedural:   { fg: '\x1b[96m',  bg: '\x1b[46m'  }, // bright cyan
  working:      { fg: '\x1b[32m',  bg: '\x1b[42m'  }, // green
  consolidated: { fg: '\x1b[95m',  bg: '\x1b[45m'  }, // bright magenta
};

// ---------------------------------------------------------------------------
// 256-Color ANSI Fallback Map
// ---------------------------------------------------------------------------
// Uses closest 256-color index for each AEGIS color

const FALLBACK_256 = {
  bg:           { fg: '\x1b[38;5;233m', bg: '\x1b[48;5;233m' },
  surface:      { fg: '\x1b[38;5;234m', bg: '\x1b[48;5;234m' },
  raised:       { fg: '\x1b[38;5;236m', bg: '\x1b[48;5;236m' },
  border:       { fg: '\x1b[38;5;239m', bg: '\x1b[48;5;239m' },
  highlight:    { fg: '\x1b[38;5;239m', bg: '\x1b[48;5;239m' },

  cyan:         { fg: '\x1b[38;5;45m',  bg: '\x1b[48;5;45m'  },
  cyanDark:     { fg: '\x1b[38;5;37m',  bg: '\x1b[48;5;37m'  },
  cyanLight:    { fg: '\x1b[38;5;87m',  bg: '\x1b[48;5;87m'  },
  green:        { fg: '\x1b[38;5;48m',  bg: '\x1b[48;5;48m'  },
  yellow:       { fg: '\x1b[38;5;220m', bg: '\x1b[48;5;220m' },
  red:          { fg: '\x1b[38;5;203m', bg: '\x1b[48;5;203m' },
  magenta:      { fg: '\x1b[38;5;171m', bg: '\x1b[48;5;171m' },
  orange:       { fg: '\x1b[38;5;208m', bg: '\x1b[48;5;208m' },

  text:         { fg: '\x1b[38;5;252m', bg: '\x1b[48;5;252m' },
  textDim:      { fg: '\x1b[38;5;243m', bg: '\x1b[48;5;243m' },
  textMuted:    { fg: '\x1b[38;5;240m', bg: '\x1b[48;5;240m' },

  episodic:     { fg: '\x1b[38;5;203m', bg: '\x1b[48;5;203m' },
  semantic:     { fg: '\x1b[38;5;79m',  bg: '\x1b[48;5;79m'  },
  procedural:   { fg: '\x1b[38;5;74m',  bg: '\x1b[48;5;74m'  },
  working:      { fg: '\x1b[38;5;115m', bg: '\x1b[48;5;115m' },
  consolidated: { fg: '\x1b[38;5;182m', bg: '\x1b[48;5;182m' },
};

// ---------------------------------------------------------------------------
// No-Color Fallback (for dumb terminals / CI / piped output)
// ---------------------------------------------------------------------------

const FALLBACK_NONE = {};
// Dynamically populated: all color names map to { fg: '', bg: '' }
for (const key of Object.keys(AEGIS_COLORS)) {
  FALLBACK_NONE[key] = { fg: '', bg: '' };
}

// ---------------------------------------------------------------------------
// SpecMem Banner ASCII Art
// ---------------------------------------------------------------------------

const BANNER_LINES = [
  '  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2557   \u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2557   \u2588\u2588\u2588\u2557',
  '  \u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2551',
  '  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551     \u2588\u2588\u2554\u2588\u2588\u2588\u2588\u2554\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2554\u2588\u2588\u2588\u2588\u2554\u2588\u2588\u2551',
  '  \u2554\u2550\u2550\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u255D \u2588\u2588\u2554\u2550\u2550\u255D  \u2588\u2588\u2551     \u2588\u2588\u2551\u255A\u2588\u2588\u2554\u255D\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u255D  \u2588\u2588\u2551\u255A\u2588\u2588\u2554\u255D\u2588\u2588\u2551',
  '  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551     \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551 \u255A\u2550\u255D \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551 \u255A\u2550\u255D \u2588\u2588\u2551',
  '  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u255D     \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u255D     \u255A\u2550\u255D\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u255D     \u255A\u2550\u255D',
];

const BANNER_SUBTITLE = 'Hardwick Software Services | Powered by AEGIS';

// Letter column ranges in the banner: [start, end] (0-indexed)
// S=0-7, P=8-16, E=17-25, C=26-33, M=34-45, E=46-53, M=54-65
const LETTER_RANGES = [
  [2, 9],   // S
  [10, 17], // P
  [18, 26], // E
  [27, 34], // C
  [35, 46], // M (first)
  [47, 54], // E
  [55, 66], // M (second)
];

// ---------------------------------------------------------------------------
// AegisTheme Class
// ---------------------------------------------------------------------------

class AegisTheme {
  /**
   * Cached terminal capabilities (lazily detected)
   * @private
   */
  static _capabilities = null;

  /**
   * Cached safe instance
   * @private
   */
  static _safeInstance = null;

  // =========================================================================
  // Terminal Capability Detection
  // =========================================================================

  /**
   * Detect terminal color and emoji capabilities.
   * Results are cached after first call.
   *
   * @returns {{ truecolor: boolean, color256: boolean, color16: boolean, emoji: boolean, unicode: boolean, isTTY: boolean }}
   */
  static detectCapabilities() {
    if (AegisTheme._capabilities) return AegisTheme._capabilities;

    const term = process.env.TERM || '';
    const colorterm = process.env.COLORTERM || '';
    const terminal = process.env.TERMINAL || '';
    const lang = process.env.LANG || '';
    const lcAll = process.env.LC_ALL || '';
    const isTTY = !!process.stdout.isTTY;

    // Force no-color mode
    if (process.env.NO_COLOR !== undefined || process.env.SPECMEM_SAFE_MODE === '1' || !isTTY || term === 'dumb' || term === '') {
      AegisTheme._capabilities = { truecolor: false, color256: false, color16: false, emoji: false, unicode: false, isTTY };
      return AegisTheme._capabilities;
    }

    // Truecolor detection
    const truecolor = colorterm === 'truecolor' || colorterm === '24bit' ||
                      term.includes('truecolor') ||
                      // Many modern terminals set COLORTERM=truecolor
                      // Also detect known truecolor-capable terminals
                      !!process.env.WT_SESSION ||           // Windows Terminal
                      !!process.env.KITTY_WINDOW_ID ||      // Kitty
                      !!process.env.WEZTERM_PANE ||          // WezTerm
                      !!process.env.ITERM_SESSION_ID;        // iTerm2

    // 256-color detection
    const color256 = truecolor || term.includes('256color') || term.includes('xterm');

    // Basic 16-color - almost any terminal supports this
    const color16 = color256 || term.includes('color') || term.includes('screen') ||
                    term.includes('tmux') || term.includes('vt100') || term.includes('linux');

    // Unicode support
    const unicode = lang.includes('UTF-8') || lcAll.includes('UTF-8');

    // Emoji support (more restrictive)
    const problematicTerminals = ['linux', 'vt100', 'vt220'];
    const isProblematicEmoji = problematicTerminals.some(t => term.toLowerCase() === t);
    const isXFCE = terminal.includes('xfce') || process.env.XDG_CURRENT_DESKTOP === 'XFCE';

    const modernTerminals = [
      process.env.WT_SESSION,
      process.env.KITTY_WINDOW_ID,
      process.env.WEZTERM_PANE,
      process.env.KONSOLE_VERSION,
      process.env.GNOME_TERMINAL_SCREEN,
      process.env.ITERM_SESSION_ID,
      process.env.ALACRITTY_WINDOW_ID,
      process.env.TERMINATOR_UUID,
      process.env.TILIX_ID,
      process.env.HYPER_VERSION,
    ].some(v => v !== undefined);

    const termProgram = (process.env.TERM_PROGRAM || '').toLowerCase();
    const emojiCapablePrograms = ['iterm.app', 'apple_terminal', 'vscode', 'hyper', 'tabby'];
    const isEmojiCapableProgram = emojiCapablePrograms.some(p => termProgram.includes(p));

    const emoji = unicode && !isProblematicEmoji && !isXFCE && (
      process.platform === 'darwin' ||
      process.env.SPECMEM_EMOJI === '1' ||
      modernTerminals ||
      isEmojiCapableProgram ||
      (truecolor && !isXFCE)
    );

    AegisTheme._capabilities = { truecolor, color256, color16, emoji, unicode, isTTY };
    return AegisTheme._capabilities;
  }

  /**
   * Reset cached capabilities (useful for testing or after terminal resize)
   */
  static resetCapabilities() {
    AegisTheme._capabilities = null;
    AegisTheme._safeInstance = null;
  }

  // =========================================================================
  // Color Code Generation (Truecolor)
  // =========================================================================

  /**
   * Generate ANSI escape code for truecolor foreground.
   *
   * @param {string} colorName - Key from AEGIS_COLORS
   * @returns {string} ANSI escape sequence, e.g. '\x1b[38;2;0;212;255m'
   */
  static fg(colorName) {
    const c = AEGIS_COLORS[colorName];
    if (!c) return '';
    return `\x1b[38;2;${c.r};${c.g};${c.b}m`;
  }

  /**
   * Generate ANSI escape code for truecolor background.
   *
   * @param {string} colorName - Key from AEGIS_COLORS
   * @returns {string} ANSI escape sequence, e.g. '\x1b[48;2;10;14;20m'
   */
  static bgColor(colorName) {
    const c = AEGIS_COLORS[colorName];
    if (!c) return '';
    return `\x1b[48;2;${c.r};${c.g};${c.b}m`;
  }

  /**
   * Generate combined fg + optional bg ANSI escape sequence.
   *
   * @param {string} fgColor - Foreground color name
   * @param {string|null} [bgColorName=null] - Background color name (optional)
   * @returns {string} Combined ANSI escape sequence
   */
  static style(fgColor, bgColorName = null) {
    let result = AegisTheme.fg(fgColor);
    if (bgColorName) {
      result += AegisTheme.bgColor(bgColorName);
    }
    return result;
  }

  /**
   * Generate ANSI from raw RGB values.
   *
   * @param {number} r - Red (0-255)
   * @param {number} g - Green (0-255)
   * @param {number} b - Blue (0-255)
   * @param {boolean} [isBg=false] - True for background, false for foreground
   * @returns {string} ANSI escape sequence
   */
  static rgb(r, g, b, isBg = false) {
    const mode = isBg ? 48 : 38;
    return `\x1b[${mode};2;${r};${g};${b}m`;
  }

  // =========================================================================
  // ANSI Formatting Shortcuts
  // =========================================================================

  /** Reset all styles */
  static get reset()     { return '\x1b[0m'; }
  /** Bold text */
  static get bold()      { return '\x1b[1m'; }
  /** Dim text */
  static get dim()       { return '\x1b[2m'; }
  /** Italic text */
  static get italic()    { return '\x1b[3m'; }
  /** Underlined text */
  static get underline() { return '\x1b[4m'; }
  /** Inverse video */
  static get inverse()   { return '\x1b[7m'; }
  /** Strikethrough */
  static get strike()    { return '\x1b[9m'; }

  // =========================================================================
  // Pre-Built Style Strings for Common UI Elements
  // =========================================================================

  /** Titles: cyan + bold */
  static get title()     { return AegisTheme.fg('cyan') + '\x1b[1m'; }
  /** Subtitles: cyanDark */
  static get subtitle()  { return AegisTheme.fg('cyanDark'); }
  /** Labels: textDim */
  static get label()     { return AegisTheme.fg('textDim'); }
  /** Values: text (primary) */
  static get value()     { return AegisTheme.fg('text'); }
  /** Success: green + bold */
  static get success()   { return AegisTheme.fg('green') + '\x1b[1m'; }
  /** Warning: yellow + bold */
  static get warning()   { return AegisTheme.fg('yellow') + '\x1b[1m'; }
  /** Error: red + bold */
  static get error()     { return AegisTheme.fg('red') + '\x1b[1m'; }
  /** Muted text: textMuted */
  static get muted()     { return AegisTheme.fg('textMuted'); }
  /** Accent: cyan */
  static get accent()    { return AegisTheme.fg('cyan'); }
  /** Highlight: cyanLight + bold */
  static get highlight() { return AegisTheme.fg('cyanLight') + '\x1b[1m'; }

  // =========================================================================
  // Panel/Box Border Colors
  // =========================================================================

  /** Border color for unfocused box chars */
  static get borderColor()       { return AegisTheme.fg('border'); }
  /** Active/focused border color (cyan) */
  static get activeBorderColor() { return AegisTheme.fg('cyan'); }

  // =========================================================================
  // Semantic Color Helpers
  // =========================================================================

  /**
   * Return a colored status dot based on status name.
   *
   * @param {'online'|'offline'|'idle'|'error'|'warning'|'busy'|'active'} status
   * @returns {string} Colored Unicode dot with reset
   */
  static statusDot(status) {
    const caps = AegisTheme.detectCapabilities();
    const filled = (caps.unicode) ? '\u25CF' : '*';
    const hollow = (caps.unicode) ? '\u25CB' : 'o';

    const map = {
      online:  AegisTheme.fg('green')   + filled + AegisTheme.reset,
      active:  AegisTheme.fg('green')   + filled + AegisTheme.reset,
      offline: AegisTheme.fg('textDim') + hollow + AegisTheme.reset,
      idle:    AegisTheme.fg('yellow')  + filled + AegisTheme.reset,
      busy:    AegisTheme.fg('orange')  + filled + AegisTheme.reset,
      error:   AegisTheme.fg('red')     + filled + AegisTheme.reset,
      warning: AegisTheme.fg('yellow')  + filled + AegisTheme.reset,
    };

    return map[status] || (AegisTheme.fg('textMuted') + hollow + AegisTheme.reset);
  }

  /**
   * Return ANSI foreground color for a memory type.
   *
   * @param {'episodic'|'semantic'|'procedural'|'working'|'consolidated'} type
   * @returns {string} ANSI escape sequence
   */
  static memoryType(type) {
    const validTypes = ['episodic', 'semantic', 'procedural', 'working', 'consolidated'];
    if (validTypes.includes(type)) {
      return AegisTheme.fg(type);
    }
    return AegisTheme.fg('textDim');
  }

  /**
   * Return a colored label for a memory type (color + type name + reset).
   *
   * @param {'episodic'|'semantic'|'procedural'|'working'|'consolidated'} type
   * @returns {string} Colored type label
   */
  static memoryTypeLabel(type) {
    return AegisTheme.memoryType(type) + type + AegisTheme.reset;
  }

  /**
   * Return threshold-based resource color for system monitors.
   * green < 60%, yellow < 80%, orange < 90%, red >= 90%
   *
   * @param {number} percent - Resource usage percentage (0-100)
   * @returns {string} ANSI foreground escape sequence
   */
  static resourceColor(percent) {
    if (percent < 60) return AegisTheme.fg('green');
    if (percent < 80) return AegisTheme.fg('yellow');
    if (percent < 90) return AegisTheme.fg('orange');
    return AegisTheme.fg('red');
  }

  /**
   * Build a mini resource bar string.
   *
   * @param {number} percent - 0-100
   * @param {number} [width=10] - Bar width in characters
   * @returns {string} Colored progress bar with reset
   */
  static resourceBar(percent, width = 10) {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    const color = AegisTheme.resourceColor(percent);
    return color + '\u2588'.repeat(filled) + AegisTheme.fg('border') + '\u2591'.repeat(empty) + AegisTheme.reset;
  }

  // =========================================================================
  // UI Formatting Helpers
  // =========================================================================

  /**
   * Format a keyboard shortcut hint, e.g. "[n] New Session"
   *
   * @param {string} key - The key (e.g. 'n', 'q', 'Tab')
   * @param {string} description - What the key does
   * @returns {string} Styled string with reset
   */
  static keyHint(key, description) {
    return AegisTheme.fg('cyan') + '\x1b[1m' + '[' + key + ']' + AegisTheme.reset + ' ' +
           AegisTheme.fg('textDim') + description + AegisTheme.reset;
  }

  /**
   * Format a section header with horizontal rule decorators.
   *
   * Example output: "\u2500\u2500\u2500\u2500 MY HEADER \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"
   *
   * @param {string} text - Header text (will be uppercased)
   * @param {number} [width=40] - Total width of the header line
   * @returns {string} Styled header string with reset
   */
  static sectionHeader(text, width = 40) {
    const caps = AegisTheme.detectCapabilities();
    const hChar = caps.unicode ? '\u2500' : '-';
    const label = ' ' + text.toUpperCase() + ' ';
    const prefixLen = 4;
    const suffixLen = Math.max(1, width - prefixLen - label.length);
    const prefix = hChar.repeat(prefixLen);
    const suffix = hChar.repeat(suffixLen);

    return AegisTheme.fg('border') + prefix +
           AegisTheme.fg('cyan') + '\x1b[1m' + label +
           AegisTheme.fg('border') + suffix +
           AegisTheme.reset;
  }

  /**
   * Create a horizontal divider line.
   *
   * @param {number} [width=40] - Width of divider
   * @param {'single'|'double'|'heavy'|'dotted'} [style='single'] - Divider style
   * @returns {string} Styled divider string with reset
   */
  static divider(width = 40, style = 'single') {
    const chars = {
      single: '\u2500',
      double: '\u2550',
      heavy:  '\u2501',
      dotted: '\u2508',
    };
    const c = chars[style] || chars.single;
    return AegisTheme.fg('border') + c.repeat(width) + AegisTheme.reset;
  }

  /**
   * Wrap text with a style and automatic reset.
   *
   * @param {string} text - Text to style
   * @param {string} styleName - A pre-built style getter name (e.g. 'title', 'error', 'success')
   * @returns {string} Styled text with reset appended
   */
  static styled(text, styleName) {
    const styleMap = {
      title:     AegisTheme.title,
      subtitle:  AegisTheme.subtitle,
      label:     AegisTheme.label,
      value:     AegisTheme.value,
      success:   AegisTheme.success,
      warning:   AegisTheme.warning,
      error:     AegisTheme.error,
      muted:     AegisTheme.muted,
      accent:    AegisTheme.accent,
      highlight: AegisTheme.highlight,
    };
    const prefix = styleMap[styleName] || '';
    return prefix + text + AegisTheme.reset;
  }

  // =========================================================================
  // Terminal-Adaptive Color Generation
  // =========================================================================

  /**
   * Get a full set of color escape codes appropriate for the detected terminal.
   * Falls back gracefully from truecolor -> 256-color -> 16-color -> no color.
   *
   * @param {{ truecolor: boolean, color256: boolean, color16: boolean }} [capabilities]
   *   Terminal capabilities (defaults to auto-detected)
   * @returns {Object} Object with same keys as AEGIS_COLORS, each having { fg, bg } strings
   */
  static getColors(capabilities) {
    const caps = capabilities || AegisTheme.detectCapabilities();

    if (caps.truecolor) {
      // Build truecolor map on the fly
      const result = {};
      for (const [name, c] of Object.entries(AEGIS_COLORS)) {
        result[name] = {
          fg: `\x1b[38;2;${c.r};${c.g};${c.b}m`,
          bg: `\x1b[48;2;${c.r};${c.g};${c.b}m`,
        };
      }
      return result;
    }

    if (caps.color256) {
      return { ...FALLBACK_256 };
    }

    if (caps.color16) {
      return { ...FALLBACK_16 };
    }

    return { ...FALLBACK_NONE };
  }

  /**
   * Get an icon with automatic ASCII fallback based on terminal capabilities.
   *
   * @param {string} iconName - Key from AEGIS_ICONS (e.g. 'success', 'arrow')
   * @returns {string} Unicode icon or ASCII fallback
   */
  static icon(iconName) {
    const caps = AegisTheme.detectCapabilities();
    if (caps.unicode && AEGIS_ICONS[iconName]) {
      return AEGIS_ICONS[iconName];
    }
    // Try ASCII fallback
    const asciiKey = iconName + 'Ascii';
    if (AEGIS_ICONS[asciiKey]) {
      return AEGIS_ICONS[asciiKey];
    }
    return AEGIS_ICONS[iconName] || '';
  }

  // =========================================================================
  // Safe Instance (capability-aware wrapper)
  // =========================================================================

  /**
   * Create a capability-aware theme instance that auto-degrades colors.
   * Provides the same API surface as static AegisTheme but respects terminal limits.
   *
   * @returns {Object} Object with title, error, success, etc. as pre-built strings
   */
  static safeInstance() {
    if (AegisTheme._safeInstance) return AegisTheme._safeInstance;

    const caps = AegisTheme.detectCapabilities();
    const colors = AegisTheme.getColors(caps);
    const noColor = !caps.color16;

    const R = noColor ? '' : '\x1b[0m';
    const B = noColor ? '' : '\x1b[1m';
    const D = noColor ? '' : '\x1b[2m';
    const I = noColor ? '' : '\x1b[3m';
    const U = noColor ? '' : '\x1b[4m';

    const fgSafe = (name) => (colors[name] && colors[name].fg) || '';
    const bgSafe = (name) => (colors[name] && colors[name].bg) || '';

    AegisTheme._safeInstance = {
      // Core ANSI
      reset: R,
      bold: B,
      dim: D,
      italic: I,
      underline: U,

      // Foreground helper
      fg: fgSafe,
      // Background helper
      bgColor: bgSafe,
      // Combined style
      style: (fgName, bgName) => fgSafe(fgName) + (bgName ? bgSafe(bgName) : ''),

      // Pre-built semantic styles
      title:     fgSafe('cyan') + B,
      subtitle:  fgSafe('cyanDark'),
      label:     fgSafe('textDim'),
      value:     fgSafe('text'),
      success:   fgSafe('green') + B,
      warning:   fgSafe('yellow') + B,
      error:     fgSafe('red') + B,
      muted:     fgSafe('textMuted'),
      accent:    fgSafe('cyan'),
      highlight: fgSafe('cyanLight') + B,

      // Borders
      borderColor:       fgSafe('border'),
      activeBorderColor: fgSafe('cyan'),

      // All raw colors
      colors,
      capabilities: caps,
    };

    return AegisTheme._safeInstance;
  }

  // =========================================================================
  // Banner Rendering
  // =========================================================================

  /**
   * Render the SpecMem banner centered to a given width, styled in AEGIS cyan.
   *
   * @param {number} [width] - Target width (defaults to terminal width or 80)
   * @returns {string} Multi-line banner string (ready to print)
   */
  static renderBanner(width) {
    const termWidth = width || process.stdout.columns || 80;
    const caps = AegisTheme.detectCapabilities();
    const cyanFg = caps.truecolor
      ? `\x1b[38;2;${AEGIS_COLORS.cyan.r};${AEGIS_COLORS.cyan.g};${AEGIS_COLORS.cyan.b}m`
      : caps.color256
        ? '\x1b[38;5;45m'
        : caps.color16
          ? '\x1b[96m'
          : '';
    const cyanDarkFg = caps.truecolor
      ? `\x1b[38;2;${AEGIS_COLORS.cyanDark.r};${AEGIS_COLORS.cyanDark.g};${AEGIS_COLORS.cyanDark.b}m`
      : caps.color256
        ? '\x1b[38;5;37m'
        : caps.color16
          ? '\x1b[36m'
          : '';
    const textDimFg = caps.truecolor
      ? `\x1b[38;2;${AEGIS_COLORS.textDim.r};${AEGIS_COLORS.textDim.g};${AEGIS_COLORS.textDim.b}m`
      : caps.color256
        ? '\x1b[38;5;243m'
        : caps.color16
          ? '\x1b[90m'
          : '';
    const R = caps.color16 ? '\x1b[0m' : '';
    const B = caps.color16 ? '\x1b[1m' : '';

    const lines = [];

    // Empty line before banner
    lines.push('');

    // Banner lines in AEGIS cyan
    for (const bannerLine of BANNER_LINES) {
      const stripped = bannerLine.replace(/\x1b\[[0-9;]*m/g, '');
      const pad = Math.max(0, Math.floor((termWidth - stripped.length) / 2));
      lines.push(' '.repeat(pad) + cyanFg + B + bannerLine + R);
    }

    // Subtitle line
    const subPad = Math.max(0, Math.floor((termWidth - BANNER_SUBTITLE.length) / 2));
    lines.push(' '.repeat(subPad) + cyanDarkFg + BANNER_SUBTITLE + R);

    // Version line (try to read from package.json)
    let version = '';
    try {
      const pkgPath = require('path').join(__dirname, '..', 'package.json');
      version = 'v' + require(pkgPath).version;
    } catch (_e) {
      version = '';
    }
    if (version) {
      const verPad = Math.max(0, Math.floor((termWidth - version.length) / 2));
      lines.push(' '.repeat(verPad) + textDimFg + version + R);
    }

    // Empty line after banner
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Animate the SpecMem banner with a left-to-right cyan sweep effect.
   * Each letter lights up in bright cyan, then settles to standard cyan,
   * producing a "wave" animation similar to the original red sweep.
   *
   * This function writes directly to stdout and returns a Promise
   * that resolves when the animation completes.
   *
   * @param {Object} [options] - Animation options
   * @param {number} [options.frameDelay=80] - Milliseconds between frames
   * @param {number} [options.width] - Target width (defaults to terminal width)
   * @param {boolean} [options.skipAnimation=false] - If true, prints static banner
   * @returns {Promise<void>}
   */
  static async animateBanner(options = {}) {
    const { frameDelay = 80, width, skipAnimation = false } = options;
    const termWidth = width || process.stdout.columns || 80;

    // If not a TTY or animation skipped, just print static banner
    if (skipAnimation || !process.stdout.isTTY) {
      process.stdout.write(AegisTheme.renderBanner(termWidth) + '\n');
      return;
    }

    const caps = AegisTheme.detectCapabilities();
    if (!caps.color16) {
      // No color support, just print plain
      for (const line of BANNER_LINES) {
        const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
        const pad = Math.max(0, Math.floor((termWidth - stripped.length) / 2));
        process.stdout.write(' '.repeat(pad) + stripped + '\n');
      }
      return;
    }

    // Color helpers based on capabilities
    const cyanBright = caps.truecolor
      ? `\x1b[38;2;${AEGIS_COLORS.cyanLight.r};${AEGIS_COLORS.cyanLight.g};${AEGIS_COLORS.cyanLight.b}m`
      : caps.color256 ? '\x1b[38;5;87m' : '\x1b[96m';
    const cyanNormal = caps.truecolor
      ? `\x1b[38;2;${AEGIS_COLORS.cyan.r};${AEGIS_COLORS.cyan.g};${AEGIS_COLORS.cyan.b}m`
      : caps.color256 ? '\x1b[38;5;45m' : '\x1b[36m';
    const dimColor = caps.truecolor
      ? `\x1b[38;2;${AEGIS_COLORS.border.r};${AEGIS_COLORS.border.g};${AEGIS_COLORS.border.b}m`
      : caps.color256 ? '\x1b[38;5;239m' : '\x1b[90m';
    const R = '\x1b[0m';
    const B = '\x1b[1m';

    const HIDE_CURSOR = '\x1b[?25l';
    const SHOW_CURSOR = '\x1b[?25h';

    const bannerHeight = BANNER_LINES.length;
    const LETTERS = LETTER_RANGES.length; // 7

    // Reserve space
    process.stdout.write(HIDE_CURSOR);
    for (let i = 0; i < bannerHeight; i++) {
      process.stdout.write('\n');
    }
    // Move cursor back up
    process.stdout.write(`\x1b[${bannerHeight}A`);

    /**
     * Colorize a single banner line for the sweep animation.
     * @param {string} line - Raw banner line
     * @param {number} highlightIdx - Which letter is currently sweeping (bright)
     * @param {number} fadeIdx - Letters < fadeIdx are "lit" (normal cyan)
     * @returns {string}
     */
    function colorizeLine(line, highlightIdx, fadeIdx) {
      const chars = [...line]; // Handle multi-byte chars
      let result = '';

      for (let i = 0; i < chars.length; i++) {
        let color = dimColor; // Default: dim border color

        for (let letterIdx = 0; letterIdx < LETTER_RANGES.length; letterIdx++) {
          const [start, end] = LETTER_RANGES[letterIdx];
          if (i >= start && i < end) {
            if (letterIdx === highlightIdx) {
              color = cyanBright + B; // Currently sweeping: bright
            } else if (letterIdx < fadeIdx) {
              color = cyanNormal; // Already passed: normal cyan
            }
            break;
          }
        }

        result += color + chars[i];
      }

      return result + R;
    }

    // Animation loop: sweep through each letter
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    for (let step = 0; step <= LETTERS; step++) {
      // Move cursor to start of banner block
      if (step > 0) {
        process.stdout.write(`\x1b[${bannerHeight}A`);
      }

      for (let i = 0; i < bannerHeight; i++) {
        const line = BANNER_LINES[i];
        const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
        const pad = Math.max(0, Math.floor((termWidth - stripped.length) / 2));
        const colored = colorizeLine(line, step < LETTERS ? step : -1, step);
        process.stdout.write('\x1b[2K' + ' '.repeat(pad) + colored + '\n');
      }

      if (step < LETTERS) {
        await sleep(frameDelay);
      }
    }

    // Print subtitle
    const cyanDarkFg = caps.truecolor
      ? `\x1b[38;2;${AEGIS_COLORS.cyanDark.r};${AEGIS_COLORS.cyanDark.g};${AEGIS_COLORS.cyanDark.b}m`
      : caps.color256 ? '\x1b[38;5;37m' : '\x1b[36m';
    const subPad = Math.max(0, Math.floor((termWidth - BANNER_SUBTITLE.length) / 2));
    process.stdout.write(' '.repeat(subPad) + cyanDarkFg + BANNER_SUBTITLE + R + '\n');

    process.stdout.write(SHOW_CURSOR);
  }

  // =========================================================================
  // Utility: ANSI String Helpers
  // =========================================================================

  /**
   * Strip all ANSI escape codes from a string.
   *
   * @param {string} str - String possibly containing ANSI codes
   * @returns {string} Plain text string
   */
  static stripAnsi(str) {
    if (!str) return '';
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  /**
   * Calculate the visible (non-ANSI) length of a string.
   *
   * @param {string} str - String possibly containing ANSI codes
   * @returns {number} Visible character count
   */
  static visibleLength(str) {
    return AegisTheme.stripAnsi(str).length;
  }

  /**
   * Pad a string (ANSI-aware) to a given visible width.
   *
   * @param {string} str - String to pad
   * @param {number} width - Target visible width
   * @param {string} [padChar=' '] - Character to pad with
   * @param {'right'|'left'|'center'} [align='right'] - Padding alignment
   * @returns {string} Padded string
   */
  static pad(str, width, padChar = ' ', align = 'right') {
    const visible = AegisTheme.visibleLength(str);
    const needed = Math.max(0, width - visible);

    if (needed === 0) return str;

    if (align === 'left') {
      return padChar.repeat(needed) + str;
    }
    if (align === 'center') {
      const left = Math.floor(needed / 2);
      const right = needed - left;
      return padChar.repeat(left) + str + padChar.repeat(right);
    }
    // Default: right-pad
    return str + padChar.repeat(needed);
  }

  /**
   * Truncate a string (ANSI-aware) to a maximum visible length.
   *
   * @param {string} str - String to truncate
   * @param {number} maxLen - Maximum visible length
   * @param {string} [suffix='...'] - Suffix to append if truncated
   * @returns {string} Truncated string with ANSI codes preserved
   */
  static truncate(str, maxLen, suffix = '...') {
    if (!str) return '';
    const plain = AegisTheme.stripAnsi(str);
    if (plain.length <= maxLen) return str;

    let visibleLen = 0;
    let result = '';
    let i = 0;
    const targetLen = maxLen - suffix.length;

    while (i < str.length && visibleLen < targetLen) {
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

    return result + suffix + '\x1b[0m';
  }

  // =========================================================================
  // Importance Level Colors
  // =========================================================================

  /**
   * Return ANSI color for a memory importance level.
   *
   * @param {'critical'|'high'|'medium'|'low'|'trivial'} importance
   * @returns {string} ANSI foreground escape
   */
  static importanceColor(importance) {
    const map = {
      critical: AegisTheme.fg('red'),
      high:     AegisTheme.fg('orange'),
      medium:   AegisTheme.fg('yellow'),
      low:      AegisTheme.fg('green'),
      trivial:  AegisTheme.fg('textDim'),
    };
    return map[importance] || AegisTheme.fg('textDim');
  }

  /**
   * Return a colored importance label.
   *
   * @param {'critical'|'high'|'medium'|'low'|'trivial'} importance
   * @returns {string} Colored label string with reset
   */
  static importanceLabel(importance) {
    return AegisTheme.importanceColor(importance) + importance + AegisTheme.reset;
  }
}

// ---------------------------------------------------------------------------
// Module Exports
// ---------------------------------------------------------------------------

module.exports = { AegisTheme, AEGIS_COLORS, AEGIS_ICONS };
