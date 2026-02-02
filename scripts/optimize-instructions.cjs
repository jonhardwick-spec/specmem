#!/usr/bin/env node
/**
 * TOKEN OPTIMIZE INSTRUCTIONS - SpecMem Init Stage
 * =================================================
 *
 * HELLA GOOD LOADING BARS EDITION
 *
 * Features:
 * - Per-file progress with real-time savings
 * - Animated spinners during compression
 * - Color-coded savings indicators
 * - Live character/token counters
 * - Beautiful box-drawing UI
 *
 * @author hardwicksoftwareservices
 * @website https://justcalljon.pro
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Import token compressor
const { compress, getStats, COMPRESSION_WARNING } = require('../claude-hooks/token-compressor.cjs');

// Configuration
const BATCH_SIZE = 2;           // Process 2 files at a time
const MIN_DELAY_MS = 500;       // 500ms minimum between batches
const SPINNER_INTERVAL = 80;    // Spinner animation speed

// Quiet mode - reduced output when called from specmem-init
const QUIET_MODE = process.env.SPECMEM_QUIET === '1' || process.argv.includes('--quiet');

// Paths
const SPECMEM_ROOT = path.dirname(__dirname);
const SOURCE_COMMANDS_DIR = path.join(SPECMEM_ROOT, 'commands');
const GLOBAL_COMMANDS_DIR = path.join(os.homedir(), '.claude', 'commands');

// ANSI colors and styles
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  blink: '\x1b[5m',

  // Colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Bright colors
  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Backgrounds
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m'
};

// Spinner frames (braille dots for smooth animation)
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const CHECK = '✓';
const CROSS = '✗';
const ARROW = '→';
const BULLET = '•';

/**
 * Create a fancy progress bar
 */
function progressBar(current, total, width = 30, showPercent = true) {
  const percent = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * width);
  const empty = width - filled;

  // Gradient effect using different characters
  let bar = '';
  for (let i = 0; i < width; i++) {
    if (i < filled) {
      if (i < filled * 0.3) bar += '█';
      else if (i < filled * 0.7) bar += '▓';
      else bar += '▒';
    } else {
      bar += '░';
    }
  }

  if (showPercent) {
    return `${C.cyan}${bar}${C.reset} ${C.bold}${percent}%${C.reset}`;
  }
  return `${C.cyan}${bar}${C.reset}`;
}

/**
 * Format bytes nicely
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

/**
 * Get savings color based on percentage
 */
function getSavingsColor(percent) {
  if (percent >= 30) return C.brightGreen;
  if (percent >= 20) return C.green;
  if (percent >= 10) return C.yellow;
  if (percent > 0) return C.brightYellow;
  return C.dim;
}

/**
 * Compress a command file's content
 */
function compressCommandFile(content) {
  const lines = content.split('\n');
  let inCodeBlock = false;
  let anyCompressed = false;
  let linesCompressed = 0;
  let charsSaved = 0;

  const compressedLines = lines.map(line => {
    // Track code blocks
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      return line;
    }

    // Don't compress code blocks
    if (inCodeBlock) return line;

    // Don't compress headers
    if (line.startsWith('#')) return line;

    // Don't compress short lines
    if (line.length < 20) return line;

    // Don't compress tool references
    if (line.includes('mcp__specmem__')) return line;

    // Don't compress JSON-like content
    if (line.trim().startsWith('{') || line.trim().startsWith('"')) return line;

    // Don't compress table rows
    if (line.includes('|') && line.trim().startsWith('|')) return line;

    // Compress prose/descriptions
    if (line.replace(/[^\w\s]/g, '').length > line.length * 0.5) {
      const compressed = compress(line);
      if (compressed !== line) {
        anyCompressed = true;
        linesCompressed++;
        charsSaved += line.length - compressed.length;
        return compressed;
      }
    }

    return line;
  });

  return {
    content: compressedLines.join('\n'),
    wasCompressed: anyCompressed,
    linesCompressed,
    charsSaved
  };
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Clear current line
 */
function clearLine() {
  process.stdout.write('\r\x1b[K');
}

/**
 * Move cursor up N lines
 */
function moveUp(n = 1) {
  process.stdout.write(`\x1b[${n}A`);
}

/**
 * Move cursor down N lines
 */
function moveDown(n = 1) {
  process.stdout.write(`\x1b[${n}B`);
}

/**
 * Hide cursor
 */
function hideCursor() {
  process.stdout.write('\x1b[?25l');
}

/**
 * Show cursor
 */
function showCursor() {
  process.stdout.write('\x1b[?25h');
}

/**
 * Animated spinner class
 */
class Spinner {
  constructor(text) {
    this.text = text;
    this.frame = 0;
    this.interval = null;
  }

  start() {
    hideCursor();
    this.interval = setInterval(() => {
      clearLine();
      process.stdout.write(`  ${C.cyan}${SPINNER[this.frame]}${C.reset} ${this.text}`);
      this.frame = (this.frame + 1) % SPINNER.length;
    }, SPINNER_INTERVAL);
  }

  update(text) {
    this.text = text;
  }

  success(text) {
    clearInterval(this.interval);
    clearLine();
    console.log(`  ${C.green}${CHECK}${C.reset} ${text}`);
    showCursor();
  }

  fail(text) {
    clearInterval(this.interval);
    clearLine();
    console.log(`  ${C.red}${CROSS}${C.reset} ${text}`);
    showCursor();
  }
}

/**
 * Draw fancy header box
 */
function drawHeader() {
  if (QUIET_MODE) return;
  console.log();
  console.log(`${C.magenta}${C.bold}  ╔════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.magenta}${C.bold}  ║${C.reset}  ${C.cyan}${C.bold}⚡ TOKEN OPTIMIZING INSTRUCTIONS${C.reset}                               ${C.magenta}${C.bold}║${C.reset}`);
  console.log(`${C.magenta}${C.bold}  ║${C.reset}  ${C.dim}Compressing commands with Traditional Chinese encoding${C.reset}        ${C.magenta}${C.bold}║${C.reset}`);
  console.log(`${C.magenta}${C.bold}  ╚════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log();
}

/**
 * Draw section header
 */
function drawSection(title) {
  if (QUIET_MODE) return;
  console.log(`  ${C.dim}───────────────────────────────────────────────────────────${C.reset}`);
  console.log(`  ${C.bold}${title}${C.reset}`);
  console.log(`  ${C.dim}───────────────────────────────────────────────────────────${C.reset}`);
}

/**
 * Main optimization function
 */
async function optimizeInstructions(options = {}) {
  const {
    projectPath = process.cwd(),
    verbose = false,
    dryRun = false
  } = options;

  drawHeader();

  // Find all command files
  if (!fs.existsSync(SOURCE_COMMANDS_DIR)) {
    console.error(`  ${C.yellow}⚠ Source commands directory not found${C.reset}`);
    return { success: false, error: 'Source directory not found' };
  }

  const commandFiles = fs.readdirSync(SOURCE_COMMANDS_DIR)
    .filter(f => f.endsWith('.md') && f.startsWith('specmem'))
    .sort();

  if (commandFiles.length === 0) {
    console.log(`  ${C.yellow}⚠ No command files found${C.reset}`);
    return { success: true, optimized: 0, skipped: 0 };
  }

  // Create target directories
  const projectCommandsDir = path.join(projectPath, '.claude', 'commands');

  if (!dryRun) {
    if (!fs.existsSync(GLOBAL_COMMANDS_DIR)) {
      fs.mkdirSync(GLOBAL_COMMANDS_DIR, { recursive: true });
    }
    if (!fs.existsSync(projectCommandsDir)) {
      fs.mkdirSync(projectCommandsDir, { recursive: true });
    }
  }

  // Stats
  let totalOriginalBytes = 0;
  let totalCompressedBytes = 0;
  let totalCharsSaved = 0;
  let totalLinesCompressed = 0;
  let optimized = 0;
  let skipped = 0;
  const results = [];

  // Print file list header
  if (!QUIET_MODE) {
    console.log(`  ${C.dim}Found ${commandFiles.length} command files${C.reset}\n`);
  }

  // Process each file with visual feedback
  for (let i = 0; i < commandFiles.length; i++) {
    const file = commandFiles[i];
    const fileNum = String(i + 1).padStart(2, '0');
    const shortName = file.replace('specmem-', '').replace('.md', '');

    // Start spinner (only in verbose mode)
    let spinner = null;
    if (!QUIET_MODE) {
      spinner = new Spinner(`${C.dim}[${fileNum}/${commandFiles.length}]${C.reset} ${shortName}`);
      spinner.start();
    }

    // Artificial delay for visual effect (min 300ms per file) - skip in quiet mode
    const startTime = Date.now();

    // Read and compress
    const srcPath = path.join(SOURCE_COMMANDS_DIR, file);
    const content = fs.readFileSync(srcPath, 'utf-8');
    const originalSize = content.length;

    const { content: compressed, wasCompressed, linesCompressed, charsSaved } = compressCommandFile(content);
    const compressedSize = compressed.length;

    // Calculate savings
    const savings = originalSize - compressedSize;
    const savingsPercent = Math.round((savings / originalSize) * 100);

    // Deploy if not dry run
    if (!dryRun) {
      const globalPath = path.join(GLOBAL_COMMANDS_DIR, file);
      fs.writeFileSync(globalPath, wasCompressed ? compressed : content);

      const projectFilePath = path.join(projectCommandsDir, file);
      fs.writeFileSync(projectFilePath, wasCompressed ? compressed : content);
    }

    // Ensure minimum display time (only in verbose mode)
    if (!QUIET_MODE) {
      const elapsed = Date.now() - startTime;
      if (elapsed < 300) {
        await sleep(300 - elapsed);
      }
    }

    // Update stats
    totalOriginalBytes += originalSize;
    totalCompressedBytes += compressedSize;
    totalCharsSaved += charsSaved;
    totalLinesCompressed += linesCompressed;

    results.push({
      file: shortName,
      originalSize,
      compressedSize,
      savings,
      savingsPercent,
      linesCompressed,
      charsSaved,
      wasCompressed
    });

    // Complete spinner with details
    if (spinner) {
      const savingsColor = getSavingsColor(savingsPercent);
      if (wasCompressed) {
        optimized++;
        spinner.success(
          `${C.dim}[${fileNum}/${commandFiles.length}]${C.reset} ${shortName.padEnd(25)} ` +
          `${savingsColor}-${savingsPercent}%${C.reset} ` +
          `${C.dim}(${formatBytes(savings)} saved, ${linesCompressed} lines)${C.reset}`
        );
      } else {
        skipped++;
        spinner.success(
          `${C.dim}[${fileNum}/${commandFiles.length}]${C.reset} ${shortName.padEnd(25)} ` +
          `${C.dim}optimal${C.reset}`
        );
      }
    } else {
      if (wasCompressed) optimized++;
      else skipped++;
    }
  }

  // Final summary
  const overallPercent = Math.round((totalCharsSaved / totalOriginalBytes) * 100);

  if (QUIET_MODE) {
    // Minimal output for quiet mode - just one line
    console.log(`  ${C.green}${CHECK}${C.reset} Tokens: ${commandFiles.length} files, ${C.green}-${overallPercent}%${C.reset} (${formatBytes(totalCharsSaved)} saved)`);
  } else {
    console.log();
    drawSection('OPTIMIZATION SUMMARY');
    console.log();

    // Overall progress bar
    console.log(`  ${C.bold}Overall Compression${C.reset}`);
    console.log(`  ${progressBar(overallPercent, 100, 40)}`);
    console.log();

    // Stats in two columns
    const col1Width = 25;
    const col2Width = 25;

    console.log(`  ${C.cyan}┌${'─'.repeat(col1Width)}┬${'─'.repeat(col2Width)}┐${C.reset}`);
    console.log(`  ${C.cyan}│${C.reset} ${'Files Processed'.padEnd(col1Width - 2)} ${C.cyan}│${C.reset} ${String(commandFiles.length).padStart(col2Width - 2)} ${C.cyan}│${C.reset}`);
    console.log(`  ${C.cyan}│${C.reset} ${'Files Optimized'.padEnd(col1Width - 2)} ${C.cyan}│${C.reset} ${C.green}${String(optimized).padStart(col2Width - 2)}${C.reset} ${C.cyan}│${C.reset}`);
    console.log(`  ${C.cyan}│${C.reset} ${'Already Optimal'.padEnd(col1Width - 2)} ${C.cyan}│${C.reset} ${C.dim}${String(skipped).padStart(col2Width - 2)}${C.reset} ${C.cyan}│${C.reset}`);
    console.log(`  ${C.cyan}├${'─'.repeat(col1Width)}┼${'─'.repeat(col2Width)}┤${C.reset}`);
    console.log(`  ${C.cyan}│${C.reset} ${'Original Size'.padEnd(col1Width - 2)} ${C.cyan}│${C.reset} ${formatBytes(totalOriginalBytes).padStart(col2Width - 2)} ${C.cyan}│${C.reset}`);
    console.log(`  ${C.cyan}│${C.reset} ${'Compressed Size'.padEnd(col1Width - 2)} ${C.cyan}│${C.reset} ${formatBytes(totalCompressedBytes).padStart(col2Width - 2)} ${C.cyan}│${C.reset}`);
    console.log(`  ${C.cyan}│${C.reset} ${'Characters Saved'.padEnd(col1Width - 2)} ${C.cyan}│${C.reset} ${C.green}${formatBytes(totalCharsSaved).padStart(col2Width - 2)}${C.reset} ${C.cyan}│${C.reset}`);
    console.log(`  ${C.cyan}│${C.reset} ${'Lines Compressed'.padEnd(col1Width - 2)} ${C.cyan}│${C.reset} ${C.green}${String(totalLinesCompressed).padStart(col2Width - 2)}${C.reset} ${C.cyan}│${C.reset}`);
    console.log(`  ${C.cyan}│${C.reset} ${'Savings %'.padEnd(col1Width - 2)} ${C.cyan}│${C.reset} ${C.brightGreen}${C.bold}${String(overallPercent + '%').padStart(col2Width - 2)}${C.reset} ${C.cyan}│${C.reset}`);
    console.log(`  ${C.cyan}└${'─'.repeat(col1Width)}┴${'─'.repeat(col2Width)}┘${C.reset}`);
    console.log();

    // Deployment targets
    console.log(`  ${C.bold}Deployed To${C.reset}`);
    console.log(`  ${C.green}${ARROW}${C.reset} ${C.dim}${GLOBAL_COMMANDS_DIR}${C.reset} ${C.brightBlack}(global)${C.reset}`);
    console.log(`  ${C.green}${ARROW}${C.reset} ${C.dim}${projectCommandsDir}${C.reset} ${C.brightBlack}(per-project)${C.reset}`);
    console.log();

    // Top savers (if any with significant savings)
    const topSavers = results
      .filter(r => r.savingsPercent >= 15)
      .sort((a, b) => b.savingsPercent - a.savingsPercent)
      .slice(0, 5);

    if (topSavers.length > 0) {
      console.log(`  ${C.bold}Top Token Savers${C.reset}`);
      for (const r of topSavers) {
        const savingsColor = getSavingsColor(r.savingsPercent);
        console.log(`  ${C.dim}${BULLET}${C.reset} ${r.file.padEnd(28)} ${savingsColor}${C.bold}-${r.savingsPercent}%${C.reset}`);
      }
      console.log();
    }

    console.log(`  ${C.green}${C.bold}${CHECK} Token optimization complete!${C.reset}\n`);
  }

  return {
    success: true,
    optimized,
    skipped,
    totalOriginalBytes,
    totalCompressedBytes,
    totalCharsSaved,
    totalLinesCompressed,
    overallPercent,
    results
  };
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const verbose = args.includes('-v') || args.includes('--verbose');
  const dryRun = args.includes('--dry-run');
  const projectPath = args.find(a => !a.startsWith('-')) || process.cwd();

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    showCursor();
    console.log(`\n  ${C.yellow}Interrupted${C.reset}\n`);
    process.exit(0);
  });

  optimizeInstructions({ projectPath, verbose, dryRun })
    .then(result => {
      if (!result.success) {
        process.exit(1);
      }
    })
    .catch(err => {
      showCursor();
      console.error(`  ${C.red}Error: ${err.message}${C.reset}`);
      process.exit(1);
    });
}

module.exports = {
  optimizeInstructions,
  compressCommandFile
};
