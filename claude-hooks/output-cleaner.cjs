#!/usr/bin/env node
/**
 * OUTPUT CLEANER - Compacts bloated Claude agent output files
 *
 * Transforms verbose JSON lines into minimal format:
 * FROM: {parentUuid, isSidechain, userType, cwd, sessionId, version, gitBranch,
 *        agentId, type, message: {model, id, type, role, content, stop_reason,
 *        stop_sequence, usage: {...}}, uuid, timestamp, requestId}
 * TO:   {r: "user"|"assistant", c: "content", t: [...tool calls]}
 *
 * Usage:
 *   node output-cleaner.js <file.output>           # Clean single file
 *   node output-cleaner.js --all                   # Clean all output files
 *   node output-cleaner.js --older-than 1h        # Clean files older than 1 hour
 *
 * Can also be used as PostToolUse hook for Task tool
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// CLEANER LOGIC
// ============================================================================

/**
 * Extract useful content from a verbose output line
 *
 * CRITICAL: thinking and redacted_thinking blocks MUST be preserved exactly!
 * The API will reject any modification to these blocks.
 *
 * IMPORTANT: Uses READABLE key names (role, content, tools, thinking) to match
 * agent-output-fader.cjs format. Both files must use the same format!
 */
function cleanLine(jsonLine) {
  try {
    const obj = JSON.parse(jsonLine);
    const msg = obj.message || {};
    const role = msg.role || obj.type || 'unknown';
    const content = msg.content;

    // Build minimal output with READABLE keys (matches agent-output-fader.cjs)
    const clean = { role: role[0] }; // 'u' for user, 'a' for assistant

    // Handle content - could be string or array of content blocks
    if (typeof content === 'string') {
      clean.content = content;
    } else if (Array.isArray(content)) {
      // Extract text and tool calls
      const texts = [];
      const tools = [];
      const thinkingBlocks = [];

      for (const block of content) {
        // CRITICAL: Preserve thinking blocks EXACTLY as-is
        // API error if modified: "thinking or redacted_thinking blocks cannot be modified"
        if (block.type === 'thinking' || block.type === 'redacted_thinking') {
          thinkingBlocks.push(block);
        } else if (block.type === 'text' && block.text) {
          texts.push(block.text);
        } else if (block.type === 'tool_use') {
          // Compact tool call: name + truncated input (matches fader format)
          tools.push({
            name: block.name,
            input: JSON.stringify(block.input || {}).slice(0, 100)
          });
        } else if (block.type === 'tool_result') {
          // Skip tool results - they're verbose and redundant
        }
      }

      if (texts.length) clean.content = texts.join('\n');
      if (tools.length) clean.tools = tools;
      // Preserve thinking blocks exactly - no modification
      if (thinkingBlocks.length) clean.thinking = thinkingBlocks;
    }

    return clean;
  } catch (e) {
    return null;
  }
}

/**
 * Check if file is already in cleaned format
 * Recognizes both old format (r/c/t) and new consistent format (role/content/tools)
 */
function isAlreadyCleaned(firstLine) {
  try {
    const obj = JSON.parse(firstLine);
    const keys = Object.keys(obj);
    // Old format keys
    const oldFormatKeys = ['r', 'c', 't', 'th'];
    // New consistent format keys (matches agent-output-fader.cjs)
    const newFormatKeys = ['role', 'content', 'tools', 'thinking'];

    // Check if all keys are from one of the cleaned formats
    const isOldFormat = keys.every(k => oldFormatKeys.includes(k));
    const isNewFormat = keys.every(k => newFormatKeys.includes(k));

    // Also check that it's not the verbose original format (has parentUuid, message, etc)
    const hasVerboseKeys = obj.parentUuid || obj.message || obj.sessionId || obj.requestId;

    return (isOldFormat || isNewFormat) && !hasVerboseKeys;
  } catch (e) {
    return false;
  }
}

/**
 * Clean an output file in place
 * Returns: { original: bytes, cleaned: bytes, ratio: % }
 */
function cleanFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { error: 'File not found' };
  }

  const originalContent = fs.readFileSync(filePath, 'utf8');
  const originalSize = Buffer.byteLength(originalContent, 'utf8');

  // Skip if already cleaned or too small
  if (originalSize < 50) {
    return { skipped: true, reason: 'too small' };
  }

  const lines = originalContent.trim().split('\n').filter(l => l.trim());

  // Check if already cleaned
  if (lines.length > 0 && isAlreadyCleaned(lines[0])) {
    return { skipped: true, reason: 'already cleaned' };
  }

  const cleanedLines = [];

  for (const line of lines) {
    const cleaned = cleanLine(line);
    // Check for content or tools using new key names
    if (cleaned && (cleaned.content || cleaned.tools)) {
      cleanedLines.push(JSON.stringify(cleaned));
    }
  }

  // Don't write if we got nothing useful
  if (cleanedLines.length === 0) {
    return { skipped: true, reason: 'no useful content' };
  }

  const cleanedContent = cleanedLines.join('\n') + '\n';
  const cleanedSize = Buffer.byteLength(cleanedContent, 'utf8');

  // Write cleaned content
  fs.writeFileSync(filePath, cleanedContent);

  return {
    original: originalSize,
    cleaned: cleanedSize,
    ratio: Math.round((1 - cleanedSize / originalSize) * 100),
    lines: cleanedLines.length
  };
}

/**
 * Find all output files - checks both /tmp/claude symlinks AND real .claude/projects locations
 */
function findOutputFiles(olderThanMs = 0) {
  const files = [];
  const searchDirs = [
    '/tmp/claude',
    path.join(process.env.HOME || '/root', '.claude', 'projects')
  ];

  for (const baseDir of searchDirs) {
    if (!fs.existsSync(baseDir)) continue;

    // Recursively find .output and .jsonl files
    function scan(dir) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            scan(fullPath);
          } else if (entry.isSymbolicLink()) {
            // Follow symlink to real file
            try {
              const realPath = fs.realpathSync(fullPath);
              if (realPath.endsWith('.jsonl') || realPath.endsWith('.output')) {
                addFileIfValid(realPath, olderThanMs, files);
              }
            } catch (e) {}
          } else if (entry.name.endsWith('.jsonl') && fullPath.includes('subagents')) {
            // Direct .jsonl files in subagents folder
            addFileIfValid(fullPath, olderThanMs, files);
          }
        }
      } catch (e) {
        // Permission denied or similar
      }
    }

    scan(baseDir);
  }

  // Deduplicate (symlinks might point to same file)
  return [...new Set(files)];
}

function addFileIfValid(filePath, olderThanMs, files) {
  try {
    if (olderThanMs > 0) {
      const stat = fs.statSync(filePath);
      const age = Date.now() - stat.mtimeMs;
      if (age >= olderThanMs) {
        files.push(filePath);
      }
    } else {
      files.push(filePath);
    }
  } catch (e) {}
}

/**
 * Parse duration string like "1h", "30m", "2d"
 */
function parseDuration(str) {
  const match = str.match(/^(\d+)([smhd])$/);
  if (!match) return 0;

  const num = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's': return num * 1000;
    case 'm': return num * 60 * 1000;
    case 'h': return num * 60 * 60 * 1000;
    case 'd': return num * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}

// ============================================================================
// HOOK MODE - PostToolUse handler
// ============================================================================

async function hookMode() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';
    const toolResult = data.tool_result || {};

    // Only handle Task tool completions
    if (toolName !== 'Task') {
      process.exit(0);
    }

    // Extract agent ID from result
    const resultStr = JSON.stringify(toolResult);
    const agentMatch = resultStr.match(/agent[_-]?id['":\s]+([a-f0-9]+)/i) ||
                       resultStr.match(/task[_-]?id['":\s]+([a-f0-9]+)/i);

    if (!agentMatch) {
      process.exit(0);
    }

    const agentId = agentMatch[1];

    // Find and clean the output file
    const outputFiles = findOutputFiles();
    const targetFile = outputFiles.find(f => f.includes(agentId));

    if (targetFile) {
      const result = cleanFile(targetFile);
      if (!result.error) {
        // Log to stderr so user sees it
        console.error(`🧹 Cleaned ${agentId.slice(0,8)}.output: ${result.original}→${result.cleaned} bytes (${result.ratio}% smaller)`);
      }
    }

    process.exit(0);
  } catch (e) {
    process.exit(0);
  }
}

// ============================================================================
// CLI MODE
// ============================================================================

async function cliMode() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node output-cleaner.js <file.output>     Clean single file');
    console.log('  node output-cleaner.js --all             Clean all output files');
    console.log('  node output-cleaner.js --older-than 1h   Clean files older than duration');
    console.log('  (pipe hook JSON to stdin for PostToolUse mode)');
    process.exit(0);
  }

  let files = [];

  if (args[0] === '--all') {
    files = findOutputFiles();
  } else if (args[0] === '--older-than' && args[1]) {
    const ms = parseDuration(args[1]);
    files = findOutputFiles(ms);
  } else {
    files = [args[0]];
  }

  if (files.length === 0) {
    console.log('No output files found');
    process.exit(0);
  }

  let totalOriginal = 0;
  let totalCleaned = 0;

  let skipped = 0;
  for (const file of files) {
    const result = cleanFile(file);
    if (result.error) {
      console.log(`❌ ${path.basename(file)}: ${result.error}`);
    } else if (result.skipped) {
      skipped++;
      // Silent skip - don't spam output
    } else {
      totalOriginal += result.original;
      totalCleaned += result.cleaned;
      console.log(`✅ ${path.basename(file)}: ${result.original}→${result.cleaned} bytes (${result.ratio}% smaller)`);
    }
  }

  if (skipped > 0) {
    console.log(`⏭️  Skipped ${skipped} files (already clean or empty)`);
  }

  if (files.length > 1) {
    const totalRatio = Math.round((1 - totalCleaned / totalOriginal) * 100);
    console.log(`\n📊 Total: ${totalOriginal}→${totalCleaned} bytes (${totalRatio}% smaller across ${files.length} files)`);
  }
}

// ============================================================================
// MAIN - Detect mode based on args
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // CLI mode if we have args
  if (args.length > 0) {
    await cliMode();
  } else if (!process.stdin.isTTY) {
    // Hook mode if stdin has data
    await hookMode();
  } else {
    // No args, no stdin - show usage
    await cliMode();
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
