'use strict';

// ============================================================================
// ANSI RENDERER - ANSI-aware text rendering with proper wrapping & truncation
// ============================================================================
//
// Provides AnsiString and AnsiRenderer classes for handling text that contains
// ANSI escape sequences. All width calculations exclude ANSI bytes, and all
// truncation/wrapping operations preserve ANSI state across line boundaries.
//
// Usage:
//   const { AnsiString, AnsiRenderer } = require('./AnsiRenderer.cjs');
//   const s = new AnsiString('\x1b[36mHello World\x1b[0m');
//   console.log(s.visibleLength); // 11
//   const lines = AnsiRenderer.renderInBounds(
//     ['\x1b[1mSome long colored text\x1b[0m'],
//     20, 5, { wrapMode: 'word' }
//   );
//
// NO external dependencies. CommonJS module.
// ============================================================================

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Regex matching a single ANSI escape sequence (CSI sequences)
// Covers: SGR (\x1b[...m), erase (\x1b[K, \x1b[2K), cursor movement, etc.
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

// SGR-only sequences (Select Graphic Rendition) - the ones that set colors/styles
const SGR_RE = /^\x1b\[([0-9;]*)m$/;

// Non-SGR CSI sequences (cursor movement, erase, etc.) - we strip these
const NON_SGR_CSI_RE = /^\x1b\[[0-9;]*[A-LN-Za-ln-z]$/;

// Reset sequence
const RESET = '\x1b[0m';

// ---------------------------------------------------------------------------
// Character width utilities
// ---------------------------------------------------------------------------

/**
 * Determine the display width of a single Unicode code point.
 * CJK ideographs and certain other characters occupy 2 columns.
 * Control characters and combining marks occupy 0 columns.
 *
 * @param {number} code - Unicode code point
 * @returns {number} 0, 1, or 2
 */
function charWidth(code) {
  // Control chars
  if (code < 0x20 || (code >= 0x7F && code < 0xA0)) return 0;

  // Combining marks (selected common ranges)
  if (
    (code >= 0x0300 && code <= 0x036F) || // Combining Diacritical Marks
    (code >= 0x1AB0 && code <= 0x1AFF) || // Combining Diacritical Marks Extended
    (code >= 0x1DC0 && code <= 0x1DFF) || // Combining Diacritical Marks Supplement
    (code >= 0x20D0 && code <= 0x20FF) || // Combining Diacritical Marks for Symbols
    (code >= 0xFE00 && code <= 0xFE0F) || // Variation Selectors
    (code >= 0xFE20 && code <= 0xFE2F) || // Combining Half Marks
    (code >= 0xE0100 && code <= 0xE01EF)  // Variation Selectors Supplement
  ) {
    return 0;
  }

  // Zero-width characters
  if (
    code === 0x200B || // ZERO WIDTH SPACE
    code === 0x200C || // ZERO WIDTH NON-JOINER
    code === 0x200D || // ZERO WIDTH JOINER
    code === 0x2060 || // WORD JOINER
    code === 0xFEFF    // ZERO WIDTH NO-BREAK SPACE (BOM)
  ) {
    return 0;
  }

  // Wide characters: CJK, Hangul, and certain symbol ranges
  if (
    (code >= 0x1100 && code <= 0x115F) ||   // Hangul Jamo
    (code >= 0x2E80 && code <= 0x303E) ||   // CJK Radicals, Kangxi, CJK Symbols
    (code >= 0x3041 && code <= 0x33BF) ||   // Hiragana, Katakana, Bopomofo, CJK Compat
    (code >= 0x3400 && code <= 0x4DBF) ||   // CJK Unified Ideographs Extension A
    (code >= 0x4E00 && code <= 0xA4CF) ||   // CJK Unified Ideographs, Yi
    (code >= 0xA960 && code <= 0xA97C) ||   // Hangul Jamo Extended-A
    (code >= 0xAC00 && code <= 0xD7A3) ||   // Hangul Syllables
    (code >= 0xF900 && code <= 0xFAFF) ||   // CJK Compatibility Ideographs
    (code >= 0xFE10 && code <= 0xFE19) ||   // Vertical forms
    (code >= 0xFE30 && code <= 0xFE6F) ||   // CJK Compatibility Forms
    (code >= 0xFF01 && code <= 0xFF60) ||   // Fullwidth Forms
    (code >= 0xFFE0 && code <= 0xFFE6) ||   // Fullwidth Sign
    (code >= 0x1F300 && code <= 0x1F9FF) || // Misc Symbols, Emoticons, etc.
    (code >= 0x1FA00 && code <= 0x1FA6F) || // Chess Symbols, Extended-A
    (code >= 0x1FA70 && code <= 0x1FAFF) || // Symbols and Pictographs Extended-A
    (code >= 0x20000 && code <= 0x2FFFD) || // CJK Unified Ideographs Extension B-F
    (code >= 0x30000 && code <= 0x3FFFD)    // CJK Unified Ideographs Extension G
  ) {
    return 2;
  }

  return 1;
}

/**
 * Compute the visible display width of a string (excluding ANSI sequences).
 * Handles wide characters, CJK, emoji, etc.
 *
 * @param {string} str
 * @returns {number}
 */
function visibleWidth(str) {
  if (!str) return 0;

  // Fast path: remove ANSI sequences first
  const clean = str.replace(ANSI_RE, '');
  let width = 0;

  for (let i = 0; i < clean.length; i++) {
    const code = clean.codePointAt(i);
    width += charWidth(code);
    // Skip low surrogate of surrogate pair
    if (code > 0xFFFF) i++;
  }

  return width;
}

// ---------------------------------------------------------------------------
// ANSI state tracking
// ---------------------------------------------------------------------------

/**
 * Represents the current ANSI graphic state (colors, styles).
 * Immutable-ish: methods return new objects.
 */
class AnsiState {
  constructor() {
    this.bold = false;
    this.dim = false;
    this.italic = false;
    this.underline = false;
    this.blink = false;
    this.inverse = false;
    this.hidden = false;
    this.strikethrough = false;
    this.fg = null;    // null = default, or array of SGR params e.g. [36] or [38,5,208] or [38,2,r,g,b]
    this.bg = null;    // same
  }

  /** Create a deep copy */
  clone() {
    const s = new AnsiState();
    s.bold = this.bold;
    s.dim = this.dim;
    s.italic = this.italic;
    s.underline = this.underline;
    s.blink = this.blink;
    s.inverse = this.inverse;
    s.hidden = this.hidden;
    s.strikethrough = this.strikethrough;
    s.fg = this.fg ? this.fg.slice() : null;
    s.bg = this.bg ? this.bg.slice() : null;
    return s;
  }

  /** Returns true if no styles are active */
  isEmpty() {
    return (
      !this.bold && !this.dim && !this.italic && !this.underline &&
      !this.blink && !this.inverse && !this.hidden && !this.strikethrough &&
      this.fg === null && this.bg === null
    );
  }

  /**
   * Apply an SGR parameter sequence to this state (mutates in place).
   * @param {number[]} params - e.g. [1], [38,5,208], [0]
   */
  applySgr(params) {
    if (params.length === 0) {
      // \x1b[m is equivalent to \x1b[0m
      this._reset();
      return;
    }

    let i = 0;
    while (i < params.length) {
      const p = params[i];

      if (p === 0) {
        this._reset();
      } else if (p === 1) {
        this.bold = true;
      } else if (p === 2) {
        this.dim = true;
      } else if (p === 3) {
        this.italic = true;
      } else if (p === 4) {
        this.underline = true;
      } else if (p === 5 || p === 6) {
        this.blink = true;
      } else if (p === 7) {
        this.inverse = true;
      } else if (p === 8) {
        this.hidden = true;
      } else if (p === 9) {
        this.strikethrough = true;
      } else if (p === 21) {
        // Double underline or bold off (varies by terminal)
        this.bold = false;
      } else if (p === 22) {
        this.bold = false;
        this.dim = false;
      } else if (p === 23) {
        this.italic = false;
      } else if (p === 24) {
        this.underline = false;
      } else if (p === 25) {
        this.blink = false;
      } else if (p === 27) {
        this.inverse = false;
      } else if (p === 28) {
        this.hidden = false;
      } else if (p === 29) {
        this.strikethrough = false;
      } else if (p >= 30 && p <= 37) {
        // Standard foreground color
        this.fg = [p];
      } else if (p === 38) {
        // Extended foreground color
        if (i + 1 < params.length && params[i + 1] === 5 && i + 2 < params.length) {
          // 256-color: 38;5;N
          this.fg = [38, 5, params[i + 2]];
          i += 2;
        } else if (i + 1 < params.length && params[i + 1] === 2 && i + 4 < params.length) {
          // Truecolor: 38;2;R;G;B
          this.fg = [38, 2, params[i + 2], params[i + 3], params[i + 4]];
          i += 4;
        }
      } else if (p === 39) {
        // Default foreground
        this.fg = null;
      } else if (p >= 40 && p <= 47) {
        // Standard background color
        this.bg = [p];
      } else if (p === 48) {
        // Extended background color
        if (i + 1 < params.length && params[i + 1] === 5 && i + 2 < params.length) {
          // 256-color: 48;5;N
          this.bg = [48, 5, params[i + 2]];
          i += 2;
        } else if (i + 1 < params.length && params[i + 1] === 2 && i + 4 < params.length) {
          // Truecolor: 48;2;R;G;B
          this.bg = [48, 2, params[i + 2], params[i + 3], params[i + 4]];
          i += 4;
        }
      } else if (p === 49) {
        // Default background
        this.bg = null;
      } else if (p >= 90 && p <= 97) {
        // Bright foreground color
        this.fg = [p];
      } else if (p >= 100 && p <= 107) {
        // Bright background color
        this.bg = [p];
      }
      // Ignore unknown SGR params

      i++;
    }
  }

  /** Reset all attributes */
  _reset() {
    this.bold = false;
    this.dim = false;
    this.italic = false;
    this.underline = false;
    this.blink = false;
    this.inverse = false;
    this.hidden = false;
    this.strikethrough = false;
    this.fg = null;
    this.bg = null;
  }

  /**
   * Build the ANSI escape sequence string that would apply this state.
   * Returns empty string if state is default.
   * @returns {string}
   */
  toAnsi() {
    if (this.isEmpty()) return '';

    const parts = [];

    if (this.bold) parts.push('1');
    if (this.dim) parts.push('2');
    if (this.italic) parts.push('3');
    if (this.underline) parts.push('4');
    if (this.blink) parts.push('5');
    if (this.inverse) parts.push('7');
    if (this.hidden) parts.push('8');
    if (this.strikethrough) parts.push('9');
    if (this.fg) parts.push(this.fg.join(';'));
    if (this.bg) parts.push(this.bg.join(';'));

    if (parts.length === 0) return '';
    return '\x1b[' + parts.join(';') + 'm';
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse a string into an array of segments: { type: 'text'|'ansi', value: string }
 * ANSI sequences and text alternate. Non-SGR CSI sequences are tagged as 'nonsgr'.
 *
 * @param {string} raw
 * @returns {Array<{type: string, value: string}>}
 */
function parseSegments(raw) {
  if (!raw) return [];

  const segments = [];
  let lastIndex = 0;

  // Reset the regex lastIndex
  ANSI_RE.lastIndex = 0;

  let match;
  while ((match = ANSI_RE.exec(raw)) !== null) {
    // Text before this ANSI sequence
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: raw.slice(lastIndex, match.index) });
    }

    const seq = match[0];
    if (SGR_RE.test(seq)) {
      segments.push({ type: 'ansi', value: seq });
    } else {
      // Non-SGR CSI (cursor movement, erase, etc.) - mark for stripping
      segments.push({ type: 'nonsgr', value: seq });
    }

    lastIndex = ANSI_RE.lastIndex;
  }

  // Trailing text
  if (lastIndex < raw.length) {
    segments.push({ type: 'text', value: raw.slice(lastIndex) });
  }

  return segments;
}

/**
 * Parse SGR parameters from an SGR sequence string.
 * @param {string} seq - e.g. '\x1b[38;5;208m'
 * @returns {number[]} - e.g. [38, 5, 208]
 */
function parseSgrParams(seq) {
  const m = SGR_RE.exec(seq);
  if (!m) return [];
  const paramStr = m[1];
  if (!paramStr || paramStr === '') return [0]; // \x1b[m === \x1b[0m
  return paramStr.split(';').map(Number);
}

// ---------------------------------------------------------------------------
// AnsiString class
// ---------------------------------------------------------------------------

class AnsiString {
  /**
   * @param {string} raw - Raw string possibly containing ANSI escape codes
   */
  constructor(raw) {
    this.raw = raw != null ? String(raw) : '';
    this._segments = null; // Lazy-parsed
    this._visibleLength = null; // Cached
  }

  /** Get parsed segments (lazy) */
  get segments() {
    if (this._segments === null) {
      this._segments = parseSegments(this.raw);
    }
    return this._segments;
  }

  /**
   * Get the visible length (display width) excluding ANSI sequences.
   * Accounts for wide characters.
   * @returns {number}
   */
  get visibleLength() {
    if (this._visibleLength === null) {
      this._visibleLength = visibleWidth(this.raw);
    }
    return this._visibleLength;
  }

  /**
   * Strip all ANSI escape sequences, returning plain text.
   * @returns {string}
   */
  stripAnsi() {
    return this.raw.replace(ANSI_RE, '');
  }

  /**
   * Get the ANSI state (active colors/styles) at a given visible character position.
   * @param {number} visiblePos - 0-based visible character position
   * @returns {AnsiState}
   */
  getStateAt(visiblePos) {
    const state = new AnsiState();
    let pos = 0;

    for (const seg of this.segments) {
      if (seg.type === 'ansi') {
        state.applySgr(parseSgrParams(seg.value));
      } else if (seg.type === 'text') {
        for (let i = 0; i < seg.value.length; i++) {
          const code = seg.value.codePointAt(i);
          const w = charWidth(code);
          if (pos + w > visiblePos) return state.clone();
          pos += w;
          if (pos > visiblePos) return state.clone();
          if (code > 0xFFFF) i++; // skip surrogate
        }
      }
      // nonsgr segments are skipped
    }

    return state.clone();
  }

  /**
   * Truncate to at most maxWidth visible columns, preserving ANSI state.
   * Appends ellipsis if truncation occurred (and ellipsis fits).
   *
   * @param {number} maxWidth - Maximum visible width
   * @param {string} [ellipsis='...'] - Ellipsis string to append (use '' to disable)
   * @returns {AnsiString}
   */
  truncate(maxWidth, ellipsis = '\u2026') {
    if (maxWidth < 0) maxWidth = 0;
    if (this.visibleLength <= maxWidth) return this;

    const ellipsisWidth = visibleWidth(ellipsis);
    const targetWidth = ellipsis ? Math.max(0, maxWidth - ellipsisWidth) : maxWidth;

    let result = '';
    let pos = 0;
    const state = new AnsiState();
    let truncated = false;

    for (const seg of this.segments) {
      if (truncated) break;

      if (seg.type === 'ansi') {
        state.applySgr(parseSgrParams(seg.value));
        result += seg.value;
      } else if (seg.type === 'text') {
        for (let i = 0; i < seg.value.length; i++) {
          const code = seg.value.codePointAt(i);
          const w = charWidth(code);

          if (pos + w > targetWidth) {
            truncated = true;
            break;
          }

          // Append the character (handle surrogate pairs)
          if (code > 0xFFFF) {
            result += seg.value[i] + seg.value[i + 1];
            i++; // skip low surrogate
          } else {
            result += seg.value[i];
          }
          pos += w;
        }
      }
      // nonsgr segments are stripped
    }

    // Add ellipsis if there was truncation and it fits
    if (truncated && ellipsis && maxWidth >= ellipsisWidth) {
      result += ellipsis;
    }

    // Always close with reset if any state was active
    if (!state.isEmpty()) {
      result += RESET;
    }

    return new AnsiString(result);
  }

  /**
   * Pad to exactly targetWidth visible columns.
   * If already wider, truncates. If shorter, pads with char.
   *
   * @param {number} targetWidth
   * @param {string} [char=' '] - Character to pad with (must be 1 column wide)
   * @returns {AnsiString}
   */
  pad(targetWidth, char = ' ') {
    if (targetWidth < 0) targetWidth = 0;

    const currentWidth = this.visibleLength;

    if (currentWidth > targetWidth) {
      return this.truncate(targetWidth, '');
    }

    if (currentWidth === targetWidth) {
      return this;
    }

    const needed = targetWidth - currentWidth;

    // Check if raw ends with reset; if not we need to reset before padding
    // to avoid coloring the padding characters
    let result = this.raw;

    // Check current state at end
    const endState = this.getStateAt(currentWidth);
    if (!endState.isEmpty()) {
      // Ensure we reset before padding so padding chars are not colored
      if (!result.endsWith(RESET)) {
        result += RESET;
      }
    }

    result += char.repeat(needed);
    return new AnsiString(result);
  }

  /**
   * Word-wrap to maxWidth visible columns, returning array of AnsiString.
   * ANSI state carries over across lines.
   *
   * @param {number} maxWidth
   * @returns {AnsiString[]}
   */
  wordWrap(maxWidth) {
    if (maxWidth < 1) maxWidth = 1;
    if (this.visibleLength <= maxWidth) return [this];

    const lines = [];
    let currentLine = '';
    let currentWidth = 0;
    let currentWord = '';
    let currentWordWidth = 0;
    const state = new AnsiState();
    let lineStartState = new AnsiState(); // State at start of current line

    /**
     * Flush the current word into the current line, wrapping if needed.
     */
    const flushWord = () => {
      if (currentWordWidth === 0 && currentWord === '') return;

      if (currentWidth + currentWordWidth > maxWidth) {
        // Word doesn't fit on current line
        if (currentWidth > 0) {
          // Finish current line
          lines.push(finishLine(currentLine, state));
          currentLine = state.toAnsi(); // Restore state for new line
          lineStartState = state.clone();
          currentWidth = 0;
        }

        // If single word is wider than maxWidth, force-break it
        if (currentWordWidth > maxWidth) {
          const broken = forceBreakWord(currentWord, maxWidth, currentWidth, state, lineStartState);
          for (let i = 0; i < broken.lines.length - 1; i++) {
            lines.push(broken.lines[i]);
          }
          // The last fragment becomes the start of a new line
          currentLine = broken.remainder;
          currentWidth = broken.remainderWidth;
          lineStartState = broken.remainderStartState;
          currentWord = '';
          currentWordWidth = 0;
          return;
        }
      }

      currentLine += currentWord;
      currentWidth += currentWordWidth;
      currentWord = '';
      currentWordWidth = 0;
    };

    for (const seg of this.segments) {
      if (seg.type === 'ansi') {
        state.applySgr(parseSgrParams(seg.value));
        currentWord += seg.value;
        // ANSI codes don't add width
      } else if (seg.type === 'text') {
        for (let i = 0; i < seg.value.length; i++) {
          const ch = seg.value[i];
          const code = seg.value.codePointAt(i);
          const w = charWidth(code);

          // Handle surrogate pairs
          let fullChar = ch;
          if (code > 0xFFFF) {
            fullChar = ch + seg.value[i + 1];
            i++;
          }

          if (ch === '\n') {
            // Explicit newline: flush word, finish line
            flushWord();
            lines.push(finishLine(currentLine, state));
            currentLine = state.toAnsi();
            lineStartState = state.clone();
            currentWidth = 0;
            continue;
          }

          // Space is a word boundary
          if (ch === ' ' || ch === '\t') {
            flushWord();

            // Check if adding this space would exceed width
            if (currentWidth + 1 > maxWidth) {
              lines.push(finishLine(currentLine, state));
              currentLine = state.toAnsi();
              lineStartState = state.clone();
              currentWidth = 0;
              // Drop leading space on new line
            } else {
              currentLine += ch;
              currentWidth += 1;
            }
          } else {
            currentWord += fullChar;
            currentWordWidth += w;
          }
        }
      }
      // nonsgr segments are stripped
    }

    // Flush remaining word and line
    flushWord();
    if (currentWidth > 0 || currentLine.length > 0) {
      lines.push(finishLine(currentLine, state));
    }

    // If we somehow produced nothing, return at least one empty line
    if (lines.length === 0) {
      lines.push(new AnsiString(''));
    }

    return lines;
  }

  /**
   * Slice by visible character positions (ANSI-aware substring).
   * Like str.substring(start, end) but operates on visible positions.
   *
   * @param {number} start - Start visible position (inclusive)
   * @param {number} [end] - End visible position (exclusive). Defaults to end of string.
   * @returns {AnsiString}
   */
  visibleSlice(start, end) {
    if (start < 0) start = 0;
    if (end === undefined || end === null) end = this.visibleLength;
    if (end < start) end = start;
    if (start >= this.visibleLength) return new AnsiString('');

    let result = '';
    let pos = 0;
    const state = new AnsiState();
    let startState = null;
    let inRange = false;

    for (const seg of this.segments) {
      if (pos >= end) break;

      if (seg.type === 'ansi') {
        state.applySgr(parseSgrParams(seg.value));
        if (inRange) {
          result += seg.value;
        }
      } else if (seg.type === 'text') {
        for (let i = 0; i < seg.value.length; i++) {
          if (pos >= end) break;

          const code = seg.value.codePointAt(i);
          const w = charWidth(code);

          let fullChar;
          if (code > 0xFFFF) {
            fullChar = seg.value[i] + seg.value[i + 1];
            i++;
          } else {
            fullChar = seg.value[i];
          }

          if (pos + w > start && pos < end) {
            if (!inRange) {
              // Entering the range - prepend state
              inRange = true;
              startState = state.clone();
              const stateStr = startState.toAnsi();
              if (stateStr) result += stateStr;
            }
            result += fullChar;
          }

          pos += w;
        }
      }
    }

    // Append reset if we had any state
    if (inRange && !state.isEmpty()) {
      result += RESET;
    }

    return new AnsiString(result);
  }

  /**
   * Returns the raw string representation.
   * @returns {string}
   */
  toString() {
    return this.raw;
  }
}

// ---------------------------------------------------------------------------
// AnsiString helpers (word wrapping internals)
// ---------------------------------------------------------------------------

/**
 * Finish a line: append reset if any ANSI state is active.
 * @param {string} line - The line content built so far
 * @param {AnsiState} state - Current ANSI state
 * @returns {AnsiString}
 */
function finishLine(line, state) {
  let result = line;
  if (!state.isEmpty()) {
    result += RESET;
  }
  return new AnsiString(result);
}

/**
 * Force-break a word that exceeds maxWidth by splitting it character-by-character.
 * Preserves ANSI state across the breaks.
 *
 * @param {string} word - The word content (may contain ANSI sequences within)
 * @param {number} maxWidth - Maximum visible width per line
 * @param {number} currentWidth - Current width already on the line
 * @param {AnsiState} state - Current ANSI state
 * @param {AnsiState} lineStartState - State at start of current line
 * @returns {{ lines: AnsiString[], remainder: string, remainderWidth: number, remainderStartState: AnsiState }}
 */
function forceBreakWord(word, maxWidth, currentWidth, state, lineStartState) {
  const lines = [];
  let line = lineStartState.toAnsi();
  let lineWidth = currentWidth;
  const localState = lineStartState.clone();

  // Parse the word into segments
  const segments = parseSegments(word);

  for (const seg of segments) {
    if (seg.type === 'ansi') {
      localState.applySgr(parseSgrParams(seg.value));
      line += seg.value;
    } else if (seg.type === 'text') {
      for (let i = 0; i < seg.value.length; i++) {
        const code = seg.value.codePointAt(i);
        const w = charWidth(code);

        let fullChar;
        if (code > 0xFFFF) {
          fullChar = seg.value[i] + seg.value[i + 1];
          i++;
        } else {
          fullChar = seg.value[i];
        }

        if (lineWidth + w > maxWidth) {
          // Wrap: finish current line
          lines.push(finishLine(line, localState));
          line = localState.toAnsi();
          lineWidth = 0;
        }

        line += fullChar;
        lineWidth += w;
      }
    }
  }

  return {
    lines,
    remainder: line,
    remainderWidth: lineWidth,
    remainderStartState: localState.clone()
  };
}

// ---------------------------------------------------------------------------
// AnsiRenderer class
// ---------------------------------------------------------------------------

class AnsiRenderer {
  /**
   * Render lines into a bounded rectangle, respecting ANSI codes.
   *
   * Returns an array of exactly `height` strings, each with exactly `width`
   * visible characters. All ANSI state is properly preserved and bounded.
   *
   * @param {string[]} lines - Input lines (may contain ANSI codes)
   * @param {number} width - Target visible width per line
   * @param {number} height - Target number of lines
   * @param {Object} [options={}]
   * @param {number} [options.scrollOffset=0] - Number of lines to skip (for scrollable content)
   * @param {'truncate'|'word'|'char'} [options.wrapMode='truncate'] - How to handle long lines
   * @param {string} [options.fillChar=' '] - Character to fill empty space
   * @param {string} [options.ellipsis='...'] - Ellipsis for truncated lines (only in truncate mode)
   * @param {string} [options.linePrefix=''] - ANSI string to prepend to each line (e.g. background color)
   * @returns {string[]}
   */
  static renderInBounds(lines, width, height, options = {}) {
    const {
      scrollOffset = 0,
      wrapMode = 'truncate',
      fillChar = ' ',
      ellipsis = '\u2026',
      linePrefix = ''
    } = options;

    if (width < 0) width = 0;
    if (height < 0) height = 0;
    if (height === 0) return [];

    // Step 1: Process lines according to wrap mode
    let processedLines;

    if (wrapMode === 'truncate') {
      processedLines = lines.map(line => {
        const as = new AnsiString(line);
        return as.truncate(width, ellipsis).pad(width, fillChar);
      });
    } else if (wrapMode === 'word') {
      processedLines = [];
      for (const line of lines) {
        const as = new AnsiString(line);
        const wrapped = as.wordWrap(width);
        for (const wl of wrapped) {
          processedLines.push(wl.pad(width, fillChar));
        }
      }
    } else if (wrapMode === 'char') {
      processedLines = [];
      for (const line of lines) {
        const as = new AnsiString(line);
        if (as.visibleLength <= width) {
          processedLines.push(as.pad(width, fillChar));
        } else {
          // Character-level wrapping: slice by width
          let pos = 0;
          while (pos < as.visibleLength) {
            const slice = as.visibleSlice(pos, pos + width);
            processedLines.push(slice.pad(width, fillChar));
            pos += width;
          }
        }
      }
    } else {
      // Fallback to truncate
      processedLines = lines.map(line => {
        const as = new AnsiString(line);
        return as.truncate(width, ellipsis).pad(width, fillChar);
      });
    }

    // Step 2: Apply scroll offset and take exactly `height` lines
    const startIdx = Math.max(0, Math.min(scrollOffset, processedLines.length));
    const visible = processedLines.slice(startIdx, startIdx + height);

    // Step 3: Build output - exactly `height` lines, each exactly `width` visible chars
    const output = [];
    const emptyLine = fillChar.repeat(width);

    for (let i = 0; i < height; i++) {
      if (i < visible.length) {
        const lineStr = visible[i].toString();
        output.push(linePrefix + lineStr);
      } else {
        output.push(linePrefix + emptyLine);
      }
    }

    return output;
  }

  /**
   * Measure the visible display width of a string (excluding ANSI sequences).
   * Handles wide characters (CJK, emoji, etc.).
   *
   * @param {string} str
   * @returns {number}
   */
  static visibleWidth(str) {
    return visibleWidth(str);
  }

  /**
   * Split a string into alternating text and ANSI segments.
   * Returns an array of objects: { type: 'text'|'ansi'|'nonsgr', value: string }
   *
   * @param {string} str
   * @returns {Array<{type: string, value: string}>}
   */
  static parseAnsi(str) {
    return parseSegments(str);
  }

  /**
   * Build an ANSI escape sequence string from a state object.
   * The state object can have: bold, dim, italic, underline, fg, bg, etc.
   *
   * @param {AnsiState|Object} state
   * @returns {string}
   */
  static buildAnsiState(state) {
    if (state instanceof AnsiState) {
      return state.toAnsi();
    }

    // Accept plain objects too
    const parts = [];

    if (state.bold) parts.push('1');
    if (state.dim) parts.push('2');
    if (state.italic) parts.push('3');
    if (state.underline) parts.push('4');
    if (state.blink) parts.push('5');
    if (state.inverse) parts.push('7');
    if (state.hidden) parts.push('8');
    if (state.strikethrough) parts.push('9');

    if (state.fg) {
      if (Array.isArray(state.fg)) {
        parts.push(state.fg.join(';'));
      } else if (typeof state.fg === 'number') {
        parts.push(String(state.fg));
      }
    }

    if (state.bg) {
      if (Array.isArray(state.bg)) {
        parts.push(state.bg.join(';'));
      } else if (typeof state.bg === 'number') {
        parts.push(String(state.bg));
      }
    }

    if (parts.length === 0) return '';
    return '\x1b[' + parts.join(';') + 'm';
  }

  /**
   * Create a new AnsiState tracker.
   * @returns {AnsiState}
   */
  static createState() {
    return new AnsiState();
  }

  /**
   * Strip all ANSI escape sequences from a string.
   * @param {string} str
   * @returns {string}
   */
  static stripAnsi(str) {
    if (!str) return '';
    return str.replace(ANSI_RE, '');
  }

  /**
   * Determine if a string contains any ANSI escape sequences.
   * @param {string} str
   * @returns {boolean}
   */
  static hasAnsi(str) {
    if (!str) return false;
    ANSI_RE.lastIndex = 0;
    return ANSI_RE.test(str);
  }

  /**
   * Truncate a raw string to maxWidth visible columns, preserving ANSI state.
   * Convenience method - wraps AnsiString.truncate().
   *
   * @param {string} str
   * @param {number} maxWidth
   * @param {string} [ellipsis='...']
   * @returns {string}
   */
  static truncate(str, maxWidth, ellipsis = '\u2026') {
    return new AnsiString(str).truncate(maxWidth, ellipsis).toString();
  }

  /**
   * Word-wrap a raw string to maxWidth visible columns, preserving ANSI state.
   * Convenience method - wraps AnsiString.wordWrap().
   *
   * @param {string} str
   * @param {number} maxWidth
   * @returns {string[]}
   */
  static wordWrap(str, maxWidth) {
    return new AnsiString(str).wordWrap(maxWidth).map(as => as.toString());
  }

  /**
   * Pad a raw string to exactly targetWidth visible columns.
   * Convenience method - wraps AnsiString.pad().
   *
   * @param {string} str
   * @param {number} targetWidth
   * @param {string} [char=' ']
   * @returns {string}
   */
  static pad(str, targetWidth, char = ' ') {
    return new AnsiString(str).pad(targetWidth, char).toString();
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { AnsiString, AnsiRenderer, AnsiState };
