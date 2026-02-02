#!/usr/bin/env node
/**
 * File Claim Enforcer Hook
 * ========================
 *
 * PreToolUse hook that DENIES Read/Edit/Write operations if the agent
 * hasn't claimed the file first via claim_task.
 *
 * Forces agents to use the workflow:
 * 1. claim_task({description: "reading X", files: ["path/to/file"]})
 * 2. THEN Read/Edit/Write the file
 *
 * IMPORTANT: Queries the ACTUAL team_comms database for claims,
 * not a separate cache file. Claims are stored in task_claims table.
 *
 * Hook Event: PreToolUse
 * Matcher: Read, Edit, Write
 */

const fs = require('fs');
const path = require('path');

// Use shared specmem-paths for Client (single connection) and getSchemaName
const { getClient, getSchemaName } = require('./specmem-paths.cjs');

/**
 * Query PostgreSQL for active claims
 * Returns array of claimed file paths
 */
async function loadClaimsFromDb() {
  const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();

  // DB connection from env (same as MCP server uses)
  const dbConfig = {
    host: process.env.SPECMEM_DB_HOST || 'localhost',
    port: parseInt(process.env.SPECMEM_DB_PORT || '5432', 10),
    database: process.env.SPECMEM_DB_NAME || 'specmem_westayunprofessional',
    user: process.env.SPECMEM_DB_USER || 'specmem_westayunprofessional',
    password: process.env.SPECMEM_DB_PASSWORD || 'specmem_westayunprofessional',
  };

  // Use shared Client getter from specmem-paths (for single-connection operations)
  const Client = getClient();
  if (!Client) {
    // pg not available, fall back to cache
    return loadClaimsFromCache();
  }

  const client = new Client(dbConfig);

  try {
    await client.connect();

    // Get project schema name using shared function from specmem-paths
    const schemaName = getSchemaName(projectPath);

    // Set search path to project schema using parameterized identifier
    // Note: Schema names can't use $1 params, but getSchemaName() sanitizes to [a-z0-9_]
    // which is safe for SQL identifiers
    await client.query(`SET search_path TO "${schemaName}", public`);

    // Query active claims for this project
    const result = await client.query(`
      SELECT files FROM task_claims
      WHERE status = 'active'
      AND (project_path = $1 OR project_path = '/')
    `, [projectPath]);

    // Flatten all claimed files into a Set
    const claimedFiles = new Set();
    for (const row of result.rows) {
      const files = row.files || [];
      for (const file of files) {
        claimedFiles.add(path.resolve(file));
      }
    }

    await client.end();
    return claimedFiles;

  } catch (e) {
    try { await client.end(); } catch (x) {}
    // DB query failed, fall back to cache
    return loadClaimsFromCache();
  }
}

/**
 * Get project-specific tmp directory
 * Matches the pattern used by team-comms-enforcer.cjs for consistency
 */
function getProjectTmpDir() {
  const crypto = require('crypto');
  const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
  const projectHash = crypto.createHash('sha256').update(path.resolve(projectPath)).digest('hex').slice(0, 12);
  return `/tmp/specmem-${projectHash}`;
}

/**
 * Fallback: Load claims from cache file (legacy)
 * Only used if DB query fails
 * Uses project-specific path to match team-comms-enforcer.cjs
 */
function loadClaimsFromCache() {
  const projectTmpDir = getProjectTmpDir();
  const claimsFile = path.join(projectTmpDir, 'active-claims.json');

  try {
    if (fs.existsSync(claimsFile)) {
      const data = fs.readFileSync(claimsFile, 'utf8');
      const claims = JSON.parse(data);
      const now = Date.now();
      const validFiles = new Set();

      // Claims have different structure than old cache format
      // Format: { claimId: { sessionId, files, createdAt, ... } }
      for (const [claimId, claim] of Object.entries(claims)) {
        // Check if claim is still valid (30 min expiry)
        if (claim.createdAt && (now - claim.createdAt < 30 * 60 * 1000)) {
          const files = claim.files || [];
          for (const file of files) {
            validFiles.add(path.resolve(file));
          }
        }
      }
      return validFiles;
    }
  } catch (e) {
    // Silent fail - DB should be primary source
  }
  return new Set();
}

/**
 * Check if a file path is claimed
 */
function isFileClaimed(filePath, claimedFiles) {
  const normalized = path.resolve(filePath);

  // Check exact match
  if (claimedFiles.has(normalized)) return true;

  // Check if any parent directory is claimed or if file is under claimed dir
  for (const claimedPath of claimedFiles) {
    if (normalized.startsWith(claimedPath + '/')) return true;
    if (claimedPath.startsWith(normalized + '/')) return true;
  }

  return false;
}

/**
 * Files that don't need claims (system/temp files)
 */
function isExemptFile(filePath) {
  const exemptPatterns = [
    /^\/tmp\//,
    /^\/dev\//,
    /node_modules/,
    /\.git\//,
    /package-lock\.json$/,
    /\.log$/,
    /\.pid$/,
    /\.lock$/,
    /\.sock$/,
    /\/scratchpad\//,
  ];

  return exemptPatterns.some(pattern => pattern.test(filePath));
}

/**
 * Read stdin with timeout
 */
function readStdinWithTimeout(timeoutMs = 5000) {
  return new Promise((resolve) => {
    let input = '';
    const timer = setTimeout(() => {
      process.stdin.destroy();
      resolve(input);
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(input);
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      resolve(input);
    });
  });
}

/**
 * Check if we're running as an agent (subagent from Task tool)
 * Main  sessions should NOT be restricted
 *
 * IMPORTANT: Only explicit agent indicators count!
 * Screen sessions (STY) and process trees are NOT reliable because
 * main  also runs in screen sessions via specmem-init.
 */
function isAgent() {
  // ONLY use explicit env vars set by agent spawning code
  // These are set by deployTeamMember or Task tool when spawning agents
  if (process.env.SPECMEM_AGENT_MODE === '1') return true;
  if (process.env.SPECMEM_TEAM_MEMBER_ID) return true;
  if (process.env.CLAUDE_SUBAGENT === '1') return true;
  if (process.env.CLAUDE_AGENT_ID) return true;

  // Check if this is a team member screen session (has specmem-tm- prefix)
  // Regular  screens are claude-<project>, not specmem-tm-
  if (process.env.STY && process.env.STY.includes('specmem-tm-')) return true;

  // Check working directory for agent-specific paths
  try {
    const cwd = process.cwd();
    // Only agent scratchpads, not main project
    if (cwd.includes('/tmp/claude/') && cwd.includes('/scratchpad/')) {
      return true;
    }
  } catch (e) {}

  // Default: NOT an agent (main  session gets unrestricted access)
  return false;
}

async function main() {
  const inputData = await readStdinWithTimeout(5000);

  try {
    const hookData = JSON.parse(inputData);
    const toolName = hookData.tool_name || '';
    const toolInput = hookData.tool_input || {};

    // Only enforce on agents, not main  session
    if (!isAgent()) {
      process.exit(0);
    }

    // Only enforce on Read, Edit, Write
    if (!['Read', 'Edit', 'Write'].includes(toolName)) {
      process.exit(0);
    }

    // Get the file path from tool input
    const filePath = toolInput.file_path || toolInput.path || '';

    if (!filePath) {
      process.exit(0);
    }

    // Check if exempt
    if (isExemptFile(filePath)) {
      process.exit(0);
    }

    // Load claims from database (falls back to cache if DB unavailable)
    const claimedFiles = await loadClaimsFromDb();

    // Check if file is claimed
    if (isFileClaimed(filePath, claimedFiles)) {
      process.exit(0);
    }

    // File NOT claimed - DENY with helpful message
    const shortPath = filePath.length > 40
      ? '...' + filePath.slice(-37)
      : filePath;

    const actionType = toolName === 'Read' ? 'reading' : 'editing';

    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `⚠️ CLAIM REQUIRED: Before ${actionType} "${shortPath}", you must claim it first:
mcp__specmem__claim_task({description: "${actionType} ${path.basename(filePath)}", files: ["${filePath}"]})

This prevents merge conflicts with other devs. Claim it, then retry your ${toolName} operation.`
      }
    }));

    process.exit(0);

  } catch (error) {
    // On error, allow operation (fail open)
    process.exit(0);
  }
}

main().catch(() => process.exit(0));
