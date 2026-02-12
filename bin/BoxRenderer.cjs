'use strict';

// ============================================================================
// BOX RENDERER - Advanced Box Drawing with Rounded Corners, Shadows, and Nesting
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
  // AegisTheme not available - will fall back to basic ANSI color names
}

/**
 * BoxRenderer: Utility class for advanced box drawing with multiple styles
 * Features:
 *   - Rounded corners using Unicode characters (...)
 *   - Double-line boxes for focused panels (...)
 *   - Single-line boxes, ASCII boxes, heavy weight boxes
 *   - Shadow effect option with offset darker characters
 *   - Title centering in top border
 *   - Support for nested boxes with proper layering
 *   - AEGIS theme truecolor integration (with graceful fallback)
 *   - Resource bars, separators, and AEGIS-styled panels
 *
 * Usage:
 *   const BoxRenderer = require('./BoxRenderer.cjs');
 *   const renderer = new BoxRenderer(dashboardInstance);
 *   renderer.drawRoundedBox('regionName', { title: 'My Box', shadow: true });
 *   renderer.drawAegisPanel('regionName', 'SYSTEM', { focused: true });
 */
class BoxRenderer {
  static BOX_CHARS = {
    rounded: { tl: '\u256D', tr: '\u256E', bl: '\u2570', br: '\u256F', h: '\u2500', v: '\u2502', name: 'rounded' },
    double:  { tl: '\u2554', tr: '\u2557', bl: '\u255A', br: '\u255D', h: '\u2550', v: '\u2551', name: 'double' },
    single:  { tl: '\u250C', tr: '\u2510', bl: '\u2514', br: '\u2518', h: '\u2500', v: '\u2502', name: 'single' },
    ascii:   { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', name: 'ascii' },
    heavy:   { tl: '\u250F', tr: '\u2513', bl: '\u2517', br: '\u251B', h: '\u2501', v: '\u2503', name: 'heavy' }
  };

  // T-junction chars for separators
  static TEE_CHARS = {
    rounded: { left: '\u251C', right: '\u2524', h: '\u2500' },
    double:  { left: '\u2560', right: '\u2563', h: '\u2550' },
    single:  { left: '\u251C', right: '\u2524', h: '\u2500' },
    heavy:   { left: '\u2523', right: '\u252B', h: '\u2501' },
    ascii:   { left: '+', right: '+', h: '-' }
  };

  static SHADOW_CHARS = {
    dark: '\u2591',   // Light shade
    medium: '\u2592', // Medium shade
    light: '\u2593'   // Dark shade
  };

  // Resource bar characters
  static BAR_CHARS = {
    filled: '\u2588',  // Full block
    empty: '\u2591',   // Light shade
    half: '\u2584'     // Lower half block
  };

  /**
   * Constructor
   * @param {DashboardRenderer} dashboardRenderer - The dashboard renderer instance
   */
  constructor(dashboardRenderer) {
    this.dashboard = dashboardRenderer;
    this.nestingStack = [];
    this._theme = AegisTheme || null;
  }

  /**
   * Resolve a color name to a truecolor ANSI escape sequence.
   * If AegisTheme is available and the color name is an AEGIS color key,
   * returns the truecolor foreground escape. Otherwise returns the color
   * name as-is for basic ANSI handling downstream.
   * @param {string} color - Color name or AEGIS color key
   * @returns {string} Resolved color string
   */
  _resolveColor(color) {
    if (!color || color === 'reset') return 'reset';

    // If AegisTheme is available, attempt to resolve via truecolor
    if (AegisTheme && typeof AegisTheme.fg === 'function') {
      try {
        const resolved = AegisTheme.fg(color);
        if (resolved && resolved !== color) return resolved;
      } catch (_e) {
        // Fall through to return color as-is
      }
    }

    // If AEGIS_COLORS is available, check direct hex lookup
    if (AEGIS_COLORS && AEGIS_COLORS[color]) {
      const hex = AEGIS_COLORS[color];
      return BoxRenderer._hexToAnsi256Fg(hex);
    }

    // Fallback: return color name as-is (basic ANSI)
    return color;
  }

  /**
   * Convert a hex color string to ANSI truecolor foreground escape
   * @param {string} hex - Hex color like '#00d4ff'
   * @returns {string} ANSI escape sequence
   */
  static _hexToAnsi256Fg(hex) {
    if (!hex || typeof hex !== 'string') return 'reset';
    const clean = hex.replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return 'reset';
    return `\x1b[38;2;${r};${g};${b}m`;
  }

  /**
   * Draw a box with full customization
   * @param {string} regionName - Name of region to draw box in
   * @param {Object} options - Configuration options
   */
  drawBox(regionName, options = {}) {
    const { style = 'single', title = null, focused = false, shadow = false,
            shadowOffset = { x: 1, y: 1 }, shadowColor = 'dark', color = 'reset',
            nested = false, borderPadding = 1, nesting = 0 } = options;

    const region = this.dashboard.regions.get(regionName);
    if (!region) throw new Error(`Region ${regionName} not found`);

    const boxStyle = focused ? 'double' : style;
    const chars = BoxRenderer.BOX_CHARS[boxStyle] || BoxRenderer.BOX_CHARS['single'];

    // Resolve color through AEGIS theme if available
    const resolvedColor = this._resolveColor(color);

    if (shadow) this._drawShadow(region, shadowOffset, shadowColor);

    this._drawCorner(region, region.x, region.y, chars.tl, resolvedColor);
    this._drawCorner(region, region.x + region.width - 1, region.y, chars.tr, resolvedColor);
    this._drawCorner(region, region.x, region.y + region.height - 1, chars.bl, resolvedColor);
    this._drawCorner(region, region.x + region.width - 1, region.y + region.height - 1, chars.br, resolvedColor);

    this._drawHorizontalEdge(region, region.y, chars.h, chars.tl, chars.tr, title, resolvedColor);
    this._drawHorizontalEdge(region, region.y + region.height - 1, chars.h, chars.bl, chars.br, null, resolvedColor);

    this._drawVerticalEdge(region, region.x, chars.v, resolvedColor);
    this._drawVerticalEdge(region, region.x + region.width - 1, chars.v, resolvedColor);

    this.dashboard.dirty = true;
    return this;
  }

  /**
   * Draw a focused box (double-line style)
   * @param {string} regionName - Name of region
   * @param {Object} options - Configuration options
   */
  drawFocusedBox(regionName, options = {}) {
    return this.drawBox(regionName, { ...options, focused: true, style: 'double' });
  }

  /**
   * Draw a rounded box
   * @param {string} regionName - Name of region
   * @param {Object} options - Configuration options
   */
  drawRoundedBox(regionName, options = {}) {
    return this.drawBox(regionName, { ...options, style: 'rounded' });
  }

  /**
   * Draw nested boxes
   * @param {string} parentRegion - Parent region name
   * @param {string} childRegion - Child region name
   * @param {Object} options - Configuration options
   */
  drawNestedBox(parentRegion, childRegion, options = {}) {
    const parentInfo = this.dashboard.getRegionInfo(parentRegion);
    const childInfo = this.dashboard.getRegionInfo(childRegion);

    if (childInfo.x <= parentInfo.x || childInfo.y <= parentInfo.y ||
        childInfo.x + childInfo.width >= parentInfo.x + parentInfo.width ||
        childInfo.y + childInfo.height >= parentInfo.y + parentInfo.height) {
      throw new Error(`Child region ${childRegion} must be contained within parent ${parentRegion}`);
    }

    const nestingDepth = this.nestingStack.length;
    this.nestingStack.push({ parent: parentRegion, child: childRegion });

    const parentStyle = options.parentStyle || 'single';
    this.drawBox(parentRegion, { ...options, style: parentStyle, nesting: nestingDepth });

    const childStyle = options.childStyle || (parentStyle === 'single' ? 'rounded' : 'single');
    this.drawBox(childRegion, { ...options, style: childStyle, nesting: nestingDepth + 1 });

    this.nestingStack.pop();
    return this;
  }

  /**
   * Draw a box with title centered in top border
   * @param {string} regionName - Region name
   * @param {string} title - Title text
   * @param {Object} options - Configuration options
   */
  drawTitledBox(regionName, title, options = {}) {
    return this.drawBox(regionName, { ...options, title });
  }

  /**
   * Draw box with shadow effect for depth
   * @param {string} regionName - Region name
   * @param {Object} options - Configuration options
   */
  drawShadowBox(regionName, options = {}) {
    return this.drawBox(regionName, { ...options, shadow: true,
      shadowOffset: options.shadowOffset || { x: 2, y: 1 } });
  }

  // ========================================================================
  // AEGIS-Specific Box Methods
  // ========================================================================

  /**
   * Draw a panel with AEGIS header styling
   * Rounded box with AEGIS-formatted title: "-- TITLE ------"
   * Border uses AEGIS border color (#2a3a4a), active/focused uses cyan (#00d4ff)
   *
   * @param {string} regionName - Name of region to draw panel in
   * @param {string} title - Panel title text
   * @param {Object} options - Configuration options
   * @param {boolean} options.focused - If true, use bright cyan border
   * @param {boolean} options.shadow - If true, add shadow effect
   * @param {string} options.titleColor - Override title color (default: 'cyan')
   */
  drawAegisPanel(regionName, title, options = {}) {
    const { focused = false, shadow = false, titleColor = 'cyan' } = options;

    const region = this.dashboard.regions.get(regionName);
    if (!region) throw new Error(`Region ${regionName} not found`);

    // Determine border color based on focus state
    const borderColor = focused ? 'cyanLight' : 'border';
    const resolvedBorderColor = this._resolveColor(borderColor);
    const resolvedTitleColor = this._resolveColor(titleColor);

    const chars = BoxRenderer.BOX_CHARS['rounded'];

    if (shadow) {
      this._drawShadow(region, { x: 2, y: 1 }, 'dark');
    }

    // Draw the box frame
    this._drawCorner(region, region.x, region.y, chars.tl, resolvedBorderColor);
    this._drawCorner(region, region.x + region.width - 1, region.y, chars.tr, resolvedBorderColor);
    this._drawCorner(region, region.x, region.y + region.height - 1, chars.bl, resolvedBorderColor);
    this._drawCorner(region, region.x + region.width - 1, region.y + region.height - 1, chars.br, resolvedBorderColor);

    // Draw top edge with AEGIS-style title: "-- TITLE ------"
    if (title) {
      this._drawAegisTitle(region, region.y, chars, title, resolvedBorderColor, resolvedTitleColor);
    } else {
      this._drawHorizontalEdge(region, region.y, chars.h, chars.tl, chars.tr, null, resolvedBorderColor);
    }

    // Draw bottom edge
    this._drawHorizontalEdge(region, region.y + region.height - 1, chars.h, chars.bl, chars.br, null, resolvedBorderColor);

    // Draw vertical edges
    this._drawVerticalEdge(region, region.x, chars.v, resolvedBorderColor);
    this._drawVerticalEdge(region, region.x + region.width - 1, chars.v, resolvedBorderColor);

    this.dashboard.dirty = true;
    return this;
  }

  /**
   * Internal: Draw AEGIS-style title in top border
   * Format: "-- TITLE ------" (left-aligned with dash separators)
   */
  _drawAegisTitle(region, y, chars, title, borderColor, titleColor) {
    if (y < 0 || y >= this.dashboard.height) return;

    const startX = region.x;
    const endX = region.x + region.width - 1;

    // Draw start corner
    if (startX < this.dashboard.width) {
      this.dashboard.backBuffer[y][startX] = { char: chars.tl, fg: borderColor, bg: 'reset', bold: false };
    }

    // Draw "-- " before title
    const prefixChars = [chars.h, chars.h, ' '];
    for (let i = 0; i < prefixChars.length; i++) {
      const x = startX + 1 + i;
      if (x < endX && x < this.dashboard.width) {
        this.dashboard.backBuffer[y][x] = { char: prefixChars[i], fg: borderColor, bg: 'reset', bold: false };
      }
    }

    // Draw title in bold with title color
    const titleStartX = startX + 1 + prefixChars.length;
    for (let i = 0; i < title.length; i++) {
      const x = titleStartX + i;
      if (x < endX && x < this.dashboard.width) {
        this.dashboard.backBuffer[y][x] = { char: title[i], fg: titleColor, bg: 'reset', bold: true };
      }
    }

    // Draw " " after title, then fill with dashes
    const afterTitleX = titleStartX + title.length;
    if (afterTitleX < endX && afterTitleX < this.dashboard.width) {
      this.dashboard.backBuffer[y][afterTitleX] = { char: ' ', fg: borderColor, bg: 'reset', bold: false };
    }
    for (let x = afterTitleX + 1; x < endX; x++) {
      if (x < this.dashboard.width) {
        this.dashboard.backBuffer[y][x] = { char: chars.h, fg: borderColor, bg: 'reset', bold: false };
      }
    }

    // Draw end corner
    if (endX < this.dashboard.width) {
      this.dashboard.backBuffer[y][endX] = { char: chars.tr, fg: borderColor, bg: 'reset', bold: false };
    }
  }

  /**
   * Draw a resource bar inside a box region
   * Format: [LABEL xxxxxxxx.... NN%]
   * Color changes by threshold: green (0-50), yellow (50-70), orange (70-85), red (85-100)
   *
   * @param {string} regionName - Name of region containing the bar
   * @param {string} label - Bar label (e.g., 'CPU', 'MEM')
   * @param {number} percent - Value 0-100
   * @param {number} y - Y coordinate (absolute) for the bar
   * @param {Object} options - Optional overrides
   * @param {number} options.startX - Override start X position
   * @param {number} options.width - Override bar width
   */
  drawResourceBar(regionName, label, percent, y, options = {}) {
    const region = this.dashboard.regions.get(regionName);
    if (!region) throw new Error(`Region ${regionName} not found`);

    const clampedPercent = Math.max(0, Math.min(100, Math.round(percent)));

    // Determine color by threshold
    let barColorName;
    if (clampedPercent < 50) barColorName = 'green';
    else if (clampedPercent < 70) barColorName = 'yellow';
    else if (clampedPercent < 85) barColorName = 'orange';
    else barColorName = 'red';

    const barColor = this._resolveColor(barColorName);
    const dimColor = this._resolveColor('border');
    const labelColor = this._resolveColor('cyan');

    // Calculate positions
    const startX = options.startX || (region.x + 1);
    const totalWidth = options.width || (region.width - 2);

    if (y < 0 || y >= this.dashboard.height) return this;

    // Label portion: "LABEL "
    const labelStr = label + ' ';
    for (let i = 0; i < labelStr.length; i++) {
      const x = startX + i;
      if (x < this.dashboard.width) {
        this.dashboard.backBuffer[y][x] = { char: labelStr[i], fg: labelColor, bg: 'reset', bold: true };
      }
    }

    // Percentage text: " NN%"
    const percentStr = ' ' + clampedPercent + '%';
    const percentStartX = startX + totalWidth - percentStr.length;

    // Bar portion
    const barStartX = startX + labelStr.length;
    const barWidth = percentStartX - barStartX;
    const filledCount = Math.round((clampedPercent / 100) * barWidth);

    for (let i = 0; i < barWidth; i++) {
      const x = barStartX + i;
      if (x < this.dashboard.width) {
        const isFilled = i < filledCount;
        this.dashboard.backBuffer[y][x] = {
          char: isFilled ? BoxRenderer.BAR_CHARS.filled : BoxRenderer.BAR_CHARS.empty,
          fg: isFilled ? barColor : dimColor,
          bg: 'reset',
          bold: false
        };
      }
    }

    // Draw percentage text
    for (let i = 0; i < percentStr.length; i++) {
      const x = percentStartX + i;
      if (x < this.dashboard.width) {
        this.dashboard.backBuffer[y][x] = { char: percentStr[i], fg: barColor, bg: 'reset', bold: true };
      }
    }

    this.dashboard.dirty = true;
    return this;
  }

  /**
   * Draw a horizontal separator line within a box
   * Uses T-junction characters on the left and right edges
   * Format: +------------+
   *
   * @param {string} regionName - Name of region
   * @param {number} y - Y coordinate for the separator
   * @param {string} style - Box style to match ('single', 'rounded', 'double', 'heavy', 'ascii')
   * @param {Object} options - Optional overrides
   * @param {string} options.color - Override separator color
   */
  drawSeparator(regionName, y, style = 'single', options = {}) {
    const region = this.dashboard.regions.get(regionName);
    if (!region) throw new Error(`Region ${regionName} not found`);

    if (y < 0 || y >= this.dashboard.height) return this;

    const teeChars = BoxRenderer.TEE_CHARS[style] || BoxRenderer.TEE_CHARS['single'];
    const color = this._resolveColor(options.color || 'border');

    // Draw left T-junction
    const leftX = region.x;
    if (leftX >= 0 && leftX < this.dashboard.width) {
      this.dashboard.backBuffer[y][leftX] = { char: teeChars.left, fg: color, bg: 'reset', bold: false };
    }

    // Draw horizontal line
    for (let x = region.x + 1; x < region.x + region.width - 1; x++) {
      if (x < this.dashboard.width) {
        this.dashboard.backBuffer[y][x] = { char: teeChars.h, fg: color, bg: 'reset', bold: false };
      }
    }

    // Draw right T-junction
    const rightX = region.x + region.width - 1;
    if (rightX < this.dashboard.width) {
      this.dashboard.backBuffer[y][rightX] = { char: teeChars.right, fg: color, bg: 'reset', bold: false };
    }

    this.dashboard.dirty = true;
    return this;
  }

  // ========================================================================
  // Internal Drawing Methods
  // ========================================================================

  /**
   * Internal: Draw a single corner character
   */
  _drawCorner(region, x, y, char, color) {
    if (y >= 0 && y < this.dashboard.height && x >= 0 && x < this.dashboard.width) {
      this.dashboard.backBuffer[y][x] = { char, fg: color, bg: 'reset', bold: false };
    }
  }

  /**
   * Internal: Draw horizontal edge with title support
   */
  _drawHorizontalEdge(region, y, hChar, startChar, endChar, title, color) {
    if (y < 0 || y >= this.dashboard.height) return;

    this.dashboard.backBuffer[y][region.x] = { char: startChar, fg: color, bg: 'reset', bold: false };

    if (title) {
      const availableWidth = region.width - 2;
      const titleLength = title.length;

      if (titleLength < availableWidth) {
        const leftPad = Math.floor((availableWidth - titleLength) / 2);
        const titleStartX = region.x + 1 + leftPad;

        // Draw left padding
        for (let x = region.x + 1; x < titleStartX; x++) {
          if (x < this.dashboard.width) {
            this.dashboard.backBuffer[y][x] = { char: hChar, fg: color, bg: 'reset', bold: false };
          }
        }

        // Draw title with bold formatting
        for (let i = 0; i < titleLength && titleStartX + i < this.dashboard.width; i++) {
          this.dashboard.backBuffer[y][titleStartX + i] = {
            char: title[i], fg: color, bg: 'reset', bold: true };
        }

        // Draw right padding
        const rightStartX = titleStartX + titleLength;
        for (let x = rightStartX; x < region.x + region.width - 1; x++) {
          if (x < this.dashboard.width) {
            this.dashboard.backBuffer[y][x] = { char: hChar, fg: color, bg: 'reset', bold: false };
          }
        }
      } else {
        // Title too long, just draw line
        for (let x = region.x + 1; x < region.x + region.width - 1; x++) {
          if (x < this.dashboard.width) {
            this.dashboard.backBuffer[y][x] = { char: hChar, fg: color, bg: 'reset', bold: false };
          }
        }
      }
    } else {
      // No title, draw full line
      for (let x = region.x + 1; x < region.x + region.width - 1; x++) {
        if (x < this.dashboard.width) {
          this.dashboard.backBuffer[y][x] = { char: hChar, fg: color, bg: 'reset', bold: false };
        }
      }
    }

    // Draw end corner
    const endX = region.x + region.width - 1;
    if (endX < this.dashboard.width) {
      this.dashboard.backBuffer[y][endX] = { char: endChar, fg: color, bg: 'reset', bold: false };
    }
  }

  /**
   * Internal: Draw vertical edge
   */
  _drawVerticalEdge(region, x, vChar, color) {
    if (x < 0 || x >= this.dashboard.width) return;
    for (let y = region.y + 1; y < region.y + region.height - 1; y++) {
      if (y < this.dashboard.height) {
        this.dashboard.backBuffer[y][x] = { char: vChar, fg: color, bg: 'reset', bold: false };
      }
    }
  }

  /**
   * Internal: Draw shadow effect behind box
   */
  _drawShadow(region, offset, shadowLevel) {
    const shadowChar = BoxRenderer.SHADOW_CHARS[shadowLevel] || BoxRenderer.SHADOW_CHARS['dark'];
    const shadowX = region.x + offset.x;
    const shadowY = region.y + offset.y;

    for (let y = shadowY; y < shadowY + region.height; y++) {
      for (let x = shadowX; x < shadowX + region.width; x++) {
        // Skip cells already occupied by box
        if (y < this.dashboard.height && x < this.dashboard.width && y >= region.y && x >= region.x) {
          continue;
        }
        if (y < this.dashboard.height && x < this.dashboard.width) {
          this.dashboard.backBuffer[y][x] = { char: shadowChar, fg: 'gray', bg: 'reset', bold: false };
        }
      }
    }
  }

  // ========================================================================
  // Static Utility Methods
  // ========================================================================

  /**
   * Get available box styles
   */
  static getAvailableStyles() {
    return Object.keys(BoxRenderer.BOX_CHARS);
  }

  /**
   * Get a preset configuration
   * Available presets: 'panel', 'focused', 'error', 'success', 'warning', 'info',
   *                    'surface', 'nested', 'shadow', 'modal'
   * @param {string} presetName - Name of the preset
   * @returns {Object} Preset configuration object
   */
  static getPreset(presetName) {
    const presets = {
      panel:   { style: 'rounded', color: 'cyan', borderPadding: 1 },
      focused: { style: 'double', color: 'cyanLight', focused: true, borderPadding: 1 },
      error:   { style: 'double', color: 'red', focused: false, borderPadding: 1 },
      success: { style: 'rounded', color: 'green', borderPadding: 1 },
      warning: { style: 'rounded', color: 'yellow', borderPadding: 1 },
      info:    { style: 'rounded', color: 'cyan', borderPadding: 1 },
      surface: { style: 'rounded', color: 'border', borderPadding: 1 },
      nested:  { style: 'single', color: 'cyan', nested: true, borderPadding: 1 },
      shadow:  { style: 'rounded', shadow: true, shadowOffset: { x: 2, y: 1 }, color: 'cyanLight', borderPadding: 1 },
      modal:   { style: 'double', shadow: true, shadowOffset: { x: 3, y: 2 }, color: 'cyanLight', focused: true, borderPadding: 1 }
    };
    return presets[presetName] || presets['panel'];
  }

  /**
   * Check if AEGIS theme is available
   * @returns {boolean} True if AegisTheme was loaded successfully
   */
  static isAegisAvailable() {
    return AegisTheme !== null;
  }
}

module.exports = BoxRenderer;
