// ============================================================================
// BOX RENDERER - Advanced Box Drawing with Rounded Corners, Shadows, and Nesting
// ============================================================================

/**
 * BoxRenderer: Utility class for advanced box drawing with multiple styles
 * Features:
 *   - Rounded corners using Unicode characters (╭╮╰╯)
 *   - Double-line boxes for focused panels (╔╗╚╝)
 *   - Single-line boxes (┌┐└┘), ASCII boxes, heavy weight boxes
 *   - Shadow effect option with offset darker characters
 *   - Title centering in top border
 *   - Support for nested boxes with proper layering
 *
 * Usage:
 *   const BoxRenderer = require('./BoxRenderer.cjs');
 *   const renderer = new BoxRenderer(dashboardInstance);
 *   renderer.drawRoundedBox('regionName', { title: 'My Box', shadow: true });
 */
class BoxRenderer {
  static BOX_CHARS = {
    rounded: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', name: 'rounded' },
    double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║', name: 'double' },
    single: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│', name: 'single' },
    ascii: { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', name: 'ascii' },
    heavy: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃', name: 'heavy' }
  };

  static SHADOW_CHARS = {
    dark: '░',   // Light shade
    medium: '▒', // Medium shade
    light: '▓'   // Dark shade
  };

  /**
   * Constructor
   * @param {DashboardRenderer} dashboardRenderer - The dashboard renderer instance
   */
  constructor(dashboardRenderer) {
    this.dashboard = dashboardRenderer;
    this.nestingStack = [];
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

    if (shadow) this._drawShadow(region, shadowOffset, shadowColor);

    this._drawCorner(region, region.x, region.y, chars.tl, color);
    this._drawCorner(region, region.x + region.width - 1, region.y, chars.tr, color);
    this._drawCorner(region, region.x, region.y + region.height - 1, chars.bl, color);
    this._drawCorner(region, region.x + region.width - 1, region.y + region.height - 1, chars.br, color);

    this._drawHorizontalEdge(region, region.y, chars.h, chars.tl, chars.tr, title, color);
    this._drawHorizontalEdge(region, region.y + region.height - 1, chars.h, chars.bl, chars.br, null, color);

    this._drawVerticalEdge(region, region.x, chars.v, color);
    this._drawVerticalEdge(region, region.x + region.width - 1, chars.v, color);

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

  /**
   * Get available box styles
   */
  static getAvailableStyles() {
    return Object.keys(BoxRenderer.BOX_CHARS);
  }

  /**
   * Get a preset configuration
   * Available presets: 'panel', 'focused', 'error', 'success', 'nested', 'shadow', 'modal'
   */
  static getPreset(presetName) {
    const presets = {
      panel: { style: 'single', color: 'cyan', borderPadding: 1 },
      focused: { style: 'double', color: 'brightCyan', focused: true, borderPadding: 1 },
      error: { style: 'double', color: 'red', focused: true, borderPadding: 1 },
      success: { style: 'rounded', color: 'green', borderPadding: 1 },
      nested: { style: 'single', color: 'cyan', nested: true, borderPadding: 1 },
      shadow: { style: 'rounded', shadow: true, shadowOffset: { x: 2, y: 1 }, color: 'brightCyan', borderPadding: 1 },
      modal: { style: 'double', shadow: true, shadowOffset: { x: 3, y: 2 }, color: 'brightWhite', focused: true, borderPadding: 1 }
    };
    return presets[presetName] || presets['panel'];
  }
}

module.exports = BoxRenderer;
