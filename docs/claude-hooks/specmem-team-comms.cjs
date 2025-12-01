#!/usr/bin/env node
/**
 * STANDALONE TEAM COMMS - Works without MCP
 *
 * This script provides team communication functionality by connecting directly
 * to PostgreSQL, bypassing the MCP server entirely. Use this when MCP is down.
 *
 * USAGE (CLI):
 *   node specmem-team-comms.cjs send "your message here"
 *   node specmem-team-comms.cjs read [--limit 10] [--since 5m]
 *   node specmem-team-comms.cjs status
 *   node specmem-team-comms.cjs clear --confirm
 *
 * USAGE (as Hook - reads from stdin):
 *   echo '{"action":"send","message":"hello"}' | node specmem-team-comms.cjs --hook
 *
 * ENVIRONMENT:
 *   SPECMEM_PROJECT_PATH - Project path for isolation
 *   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE - PostgreSQL connection
 */

const { Client } = require('pg');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// CONFIG
// ============================================================================

function getProjectPath() {
  return process.env.SPECMEM_PROJECT_PATH || process.cwd();
}

function getProjectSchema() {
  const projectPath = getProjectPath();
  const dirName = path.basename(projectPath).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return `specmem_${dirName}`;
}

function getDefaultChannel() {
  const projectPath = getProjectPath();
  const dirName = path.basename(projectPath).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return `team-${dirName}`;
}

async function getClient() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'specmem',
  });

  await client.connect();

  // Set search_path for project isolation
  const schemaName = getProjectSchema();
  const safeSchema = '"' + schemaName.replace(/"/g, '""') + '"';
  await client.query(`SET search_path TO ${safeSchema}, public`);

  return client;
}

// ============================================================================
// TEAM COMMS OPERATIONS
// ============================================================================

async function sendMessage(message, options = {}) {
  const client = await getClient();
  const projectPath = getProjectPath();
  const messageId = crypto.randomUUID().slice(0, 8);

  try {
    // First ensure the main channel exists
    const channelName = options.channel || getDefaultChannel();

    // Check if channel exists, create if not
    let channelResult = await client.query(
      `SELECT id FROM team_channels WHERE name = $1 AND (project_path = $2 OR project_path IS NULL) LIMIT 1`,
      [channelName, projectPath]
    );

    let channelId;
    if (channelResult.rows.length === 0) {
      // Create channel
      const createResult = await client.query(
        `INSERT INTO team_channels (name, project_path) VALUES ($1, $2) RETURNING id`,
        [channelName, projectPath]
      );
      channelId = createResult.rows[0].id;
    } else {
      channelId = channelResult.rows[0].id;
    }

    // Insert message
    const senderId = options.senderId || `cli-${process.pid}`;
    const senderName = options.senderName || 'CLI';
    const messageType = options.type || 'message';

    const result = await client.query(
      `INSERT INTO team_messages (channel_id, sender_id, sender_name, message_type, content, metadata, project_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [channelId, senderId, senderName, messageType, message, JSON.stringify(options.metadata || {}), projectPath]
    );

    return {
      success: true,
      messageId: result.rows[0].id,
      timestamp: result.rows[0].created_at,
      channel: channelName
    };
  } finally {
    await client.end();
  }
}

async function readMessages(options = {}) {
  const client = await getClient();
  const projectPath = getProjectPath();

  try {
    const limit = options.limit || 10;
    const channelName = options.channel || getDefaultChannel();

    // Get channel ID first
    const channelResult = await client.query(
      `SELECT id FROM team_channels WHERE name = $1 AND (project_path = $2 OR project_path IS NULL) LIMIT 1`,
      [channelName, projectPath]
    );

    if (channelResult.rows.length === 0) {
      return { success: true, messages: [], count: 0, channel: channelName };
    }

    const channelId = channelResult.rows[0].id;

    // Build query
    let query = `
      SELECT id, sender_id, sender_name, message_type, content, metadata, created_at
      FROM team_messages
      WHERE channel_id = $1 AND (project_path = $2 OR project_path = '/' OR project_path IS NULL)
    `;
    const params = [channelId, projectPath];

    if (options.since) {
      const sinceMs = parseDuration(options.since);
      if (sinceMs) {
        const sinceDate = new Date(Date.now() - sinceMs);
        query += ` AND created_at > $${params.length + 1}`;
        params.push(sinceDate);
      }
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await client.query(query, params);

    const messages = result.rows.map(row => ({
      id: row.id,
      senderId: row.sender_id,
      senderName: row.sender_name,
      type: row.message_type,
      content: row.content,
      metadata: row.metadata,
      createdAt: row.created_at
    }));

    return {
      success: true,
      messages: messages.reverse(), // Oldest first for display
      count: messages.length,
      channel: channelName
    };
  } finally {
    await client.end();
  }
}

async function getStatus() {
  const client = await getClient();
  const projectPath = getProjectPath();

  try {
    // Count channels
    const channelResult = await client.query(
      `SELECT COUNT(*)::int as count FROM team_channels WHERE project_path = $1 OR project_path IS NULL`,
      [projectPath]
    );

    // Count messages in last hour
    const msgResult = await client.query(
      `SELECT COUNT(*)::int as count FROM team_messages WHERE created_at > NOW() - INTERVAL '1 hour' AND (project_path = $1 OR project_path = '/' OR project_path IS NULL)`,
      [projectPath]
    );

    // Count active claims
    const claimResult = await client.query(
      `SELECT COUNT(*)::int as count FROM task_claims WHERE status = 'in_progress'`
    );

    return {
      success: true,
      channels: channelResult.rows[0].count,
      messagesLastHour: msgResult.rows[0].count,
      activeClaims: claimResult.rows[0].count,
      projectPath,
      schema: getProjectSchema()
    };
  } finally {
    await client.end();
  }
}

async function clearMessages(options = {}) {
  if (!options.confirm) {
    return { success: false, error: 'Must pass --confirm to clear messages' };
  }

  const client = await getClient();
  const projectPath = getProjectPath();

  try {
    const channelName = options.channel || getDefaultChannel();

    // Get channel ID
    const channelResult = await client.query(
      `SELECT id FROM team_channels WHERE name = $1 AND (project_path = $2 OR project_path IS NULL) LIMIT 1`,
      [channelName, projectPath]
    );

    if (channelResult.rows.length === 0) {
      return { success: true, deleted: 0, message: 'No channel found' };
    }

    const channelId = channelResult.rows[0].id;

    // Delete messages
    const deleteResult = await client.query(
      `DELETE FROM team_messages WHERE channel_id = $1 AND (project_path = $2 OR project_path IS NULL)`,
      [channelId, projectPath]
    );

    return {
      success: true,
      deleted: deleteResult.rowCount,
      channel: channelName
    };
  } finally {
    await client.end();
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(s|m|h|d)?$/);
  if (!match) return null;

  const num = parseInt(match[1]);
  const unit = match[2] || 's';

  switch (unit) {
    case 's': return num * 1000;
    case 'm': return num * 60 * 1000;
    case 'h': return num * 60 * 60 * 1000;
    case 'd': return num * 24 * 60 * 60 * 1000;
    default: return num * 1000;
  }
}

function formatMessage(msg) {
  const time = new Date(msg.createdAt).toLocaleTimeString();
  const sender = msg.senderName || msg.senderId;
  const type = msg.type !== 'message' ? `[${msg.type}] ` : '';
  return `[${time}] ${sender}: ${type}${msg.content}`;
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Hook mode - read JSON from stdin
  if (args.includes('--hook')) {
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      input += chunk;
    }

    try {
      const data = JSON.parse(input);
      let result;

      switch (data.action) {
        case 'send':
          result = await sendMessage(data.message, data);
          break;
        case 'read':
          result = await readMessages(data);
          break;
        case 'status':
          result = await getStatus();
          break;
        case 'clear':
          result = await clearMessages(data);
          break;
        default:
          result = { error: `Unknown action: ${data.action}` };
      }

      console.log(JSON.stringify(result));
    } catch (err) {
      console.log(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // CLI mode
  const command = args[0];

  try {
    switch (command) {
      case 'send': {
        const message = args.slice(1).join(' ');
        if (!message) {
          console.error('Usage: node specmem-team-comms.cjs send "your message"');
          process.exit(1);
        }
        const result = await sendMessage(message);
        console.log(`[OK] Message sent to ${result.channel} (${result.messageId})`);
        break;
      }

      case 'read': {
        const options = {};
        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--limit' && args[i + 1]) {
            options.limit = parseInt(args[++i]);
          } else if (args[i] === '--since' && args[i + 1]) {
            options.since = args[++i];
          } else if (args[i] === '--channel' && args[i + 1]) {
            options.channel = args[++i];
          }
        }

        const result = await readMessages(options);
        console.log(`\n=== Team Messages (${result.channel}) ===\n`);
        if (result.messages.length === 0) {
          console.log('  No messages found');
        } else {
          result.messages.forEach(msg => {
            console.log(formatMessage(msg));
          });
        }
        console.log(`\nTotal: ${result.count} messages\n`);
        break;
      }

      case 'status': {
        const result = await getStatus();
        console.log('\n=== Team Comms Status ===\n');
        console.log(`  Project: ${result.projectPath}`);
        console.log(`  Schema: ${result.schema}`);
        console.log(`  Channels: ${result.channels}`);
        console.log(`  Messages (1h): ${result.messagesLastHour}`);
        console.log(`  Active Claims: ${result.activeClaims}`);
        console.log('');
        break;
      }

      case 'clear': {
        const confirm = args.includes('--confirm');
        const result = await clearMessages({ confirm });
        if (result.success) {
          console.log(`[OK] Cleared ${result.deleted} messages from ${result.channel}`);
        } else {
          console.error(`[ERROR] ${result.error}`);
        }
        break;
      }

      default:
        console.log(`
SPECMEM TEAM COMMS (Standalone - No MCP Required)

USAGE:
  node specmem-team-comms.cjs send "your message"
  node specmem-team-comms.cjs read [--limit 10] [--since 5m]
  node specmem-team-comms.cjs status
  node specmem-team-comms.cjs clear --confirm

OPTIONS:
  --limit N     Number of messages to read (default: 10)
  --since X     Read messages from last X (e.g., 5m, 1h, 1d)
  --channel X   Use specific channel name
  --confirm     Required for clear command

HOOK MODE:
  echo '{"action":"send","message":"hi"}' | node specmem-team-comms.cjs --hook

ENVIRONMENT:
  SPECMEM_PROJECT_PATH   Project path for isolation
  PGHOST/PGPORT/etc      PostgreSQL connection
`);
    }
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
