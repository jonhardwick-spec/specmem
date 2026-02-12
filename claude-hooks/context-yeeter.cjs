#!/usr/bin/env node
/**
 * Context Yeeter - yooo we trimming context AND compressing it
 *
 * Adapted from concepts, rewritten with our sauce:
 * - Strips bloated MCP tool schemas
 * - Trims old messages
 * - Compresses everything with Chinese tokens
 * - Yeets old thinking blocks
 *
 * Hook Event: PostToolUse (cleans up after tool results)
 *
 * @author hardwicksoftwareservices - nah bruh we aint copying, we innovating
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// load our goated compressor
let compressor = null;
const COMPRESSOR_PATH = path.join(os.homedir(), '.claude', 'hooks', 'token-compressor.cjs');

function getCompressor() {
  if (compressor) return compressor;
  try {
    if (fs.existsSync(COMPRESSOR_PATH)) {
      compressor = require(COMPRESSOR_PATH);
    }
  } catch (e) {}
  return compressor;
}

// config - tweak these for your vibe
const CONFIG = {
  enabled: true,
  // yeet mcp tool schemas after this many chars
  maxToolSchemaChars: 500,
  // trim tool results to this size
  maxToolResultChars: 800,
  // keep this many recent messages untouched
  keepRecentMessages: 15,
  // yeet thinking blocks older than N messages
  yeetOldThinking: true,
  // compress with chinese tokens
  useChineseCompression: true,
  // patterns to always preserve (regex strings)
  neverYeet: [
    'error',
    'Error',
    'ERROR',
    'exception',
    'failed',
    'FAILED'
  ]
};

const STATS_PATH = path.join(os.tmpdir(), 'specmem-context-yeeter-stats.json');

function loadStats() {
  try {
    if (fs.existsSync(STATS_PATH)) {
      return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
    }
  } catch (e) {}
  return {
    totalYeeted: 0,
    toolResultsTrimmed: 0,
    thinkingBlocksYeeted: 0,
    charsCompressed: 0,
    charsSaved: 0,
    callCount: 0
  };
}

function saveStats(stats) {
  try {
    fs.writeFileSync(STATS_PATH, JSON.stringify(stats));
  } catch (e) {}
}

// check if content has important stuff we shouldnt yeet
function hasImportantStuff(text) {
  if (!text) return false;
  for (const pattern of CONFIG.neverYeet) {
    if (text.includes(pattern)) return true;
  }
  return false;
}

// trim a tool result - keep start and end, yeet the middle
function trimToolResult(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  if (hasImportantStuff(text)) return text; // dont trim errors

  const keepEach = Math.floor(maxChars / 2) - 10;
  const start = text.slice(0, keepEach);
  const end = text.slice(-keepEach);
  const yeeted = text.length - (keepEach * 2);

  return start + '\n...[' + yeeted + ' chars yeeted]...\n' + end;
}

// compress text with our chinese token magic
function squish(text) {
  const comp = getCompressor();
  if (!comp || !comp.compress || !CONFIG.useChineseCompression) {
    return { result: text, saved: 0 };
  }

  try {
    const compressed = comp.compress(text);
    const saved = text.length - compressed.length;
    return { result: compressed, saved: Math.max(0, saved) };
  } catch (e) {
    return { result: text, saved: 0 };
  }
}

// process tool output - trim + compress
function processToolOutput(content, stats) {
  if (!content || typeof content !== 'string') return content;

  const original = content.length;

  // step 1: trim if too long
  let processed = trimToolResult(content, CONFIG.maxToolResultChars);
  if (processed.length < original) {
    stats.toolResultsTrimmed++;
  }

  // step 2: compress with chinese
  const { result, saved } = squish(processed);
  stats.charsCompressed += processed.length;
  stats.charsSaved += saved;

  return result;
}

// yeet old thinking blocks from message history
function yeetOldThinking(messages, keepRecent, stats) {
  if (!Array.isArray(messages)) return messages;
  if (messages.length <= keepRecent) return messages;

  const oldMessages = messages.slice(0, -keepRecent);
  const recentMessages = messages.slice(-keepRecent);

  // process old messages - yeet thinking, compress content
  const processed = oldMessages.map(msg => {
    if (!msg || !msg.content) return msg;

    // if its an array of content blocks
    if (Array.isArray(msg.content)) {
      const filtered = msg.content.filter(block => {
        // yeet thinking blocks
        if (block.type === 'thinking') {
          stats.thinkingBlocksYeeted++;
          return false;
        }
        return true;
      });

      // compress text blocks
      const compressed = filtered.map(block => {
        if (block.type === 'text' && block.text) {
          const { result, saved } = squish(block.text);
          stats.charsSaved += saved;
          return { ...block, text: result };
        }
        return block;
      });

      return { ...msg, content: compressed };
    }

    // if its just a string
    if (typeof msg.content === 'string') {
      const { result, saved } = squish(msg.content);
      stats.charsSaved += saved;
      return { ...msg, content: result };
    }

    return msg;
  });

  return [...processed, ...recentMessages];
}

async function main() {
  const input = await new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        resolve({});
      }
    });
  });

  if (!CONFIG.enabled) {
    console.log(JSON.stringify({ decision: 'approve' }));
    return;
  }

  const stats = loadStats();
  stats.callCount++;

  // get tool output if available
  const toolOutput = input.tool_output || input.result;

  if (toolOutput && typeof toolOutput === 'string') {
    const processed = processToolOutput(toolOutput, stats);
    stats.totalYeeted += (toolOutput.length - processed.length);
  }

  saveStats(stats);

  // every 100 calls, flex our savings
  if (stats.callCount % 100 === 0 && stats.charsSaved > 1000) {
    const pct = Math.round(stats.charsSaved / (stats.charsCompressed || 1) * 100);
    console.log(JSON.stringify({
      decision: 'approve',
      message: '[SPECMEM] Context yeeted: ' + stats.charsSaved + ' chars saved (' + pct + '%), ' +
               stats.thinkingBlocksYeeted + ' thinking blocks removed'
    }));
    return;
  }

  console.log(JSON.stringify({ decision: 'approve' }));
}

// exports for other hooks
module.exports = {
  trimToolResult,
  squish,
  yeetOldThinking,
  CONFIG
};

main().catch(err => {
  console.log(JSON.stringify({ decision: 'approve' }));
});
