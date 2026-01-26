/**
 * Team Communication MCP Tools (PostgreSQL-backed)
 *
 * REPLACES HTTP-BASED TEAM_MEMBER COMMUNICATION with MCP tool-based communication.
 * All inter-team-member communication MUST go through these MCP tools.
 *
 * This is the Slack-like communication system for team members (formerly team members).
 * Messages are stored in PostgreSQL with channel/threading support.
 *
 * Tools:
 * - send_team_message: Send messages to team channel (replaces HTTP POST)
 * - read_team_messages: Read messages from team channels (replaces HTTP GET)
 * - claim_task: Claim a task/file to work on
 * - release_task: Release a claimed task
 * - get_team_status: Show what everyone is working on
 * - request_help: Broadcast help request to team
 * - respond_to_help: Respond to help requests
 * - broadcast_to_team: Broadcast status/progress to all
 *
 * Database tables:
 * - team_channels: Slack-like channels (by task_id or project)
 * - team_messages: Messages with threading support
 * - task_claims: Active file/task claims
 * - help_requests: Open help requests
 *
 * @author hardwicksoftwareservices
 */
import { logger } from '../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getProjectPathForInsert } from '../../services/ProjectContext.js';
import { getFileCommsTransport } from '../../comms/fileCommsTransport.js';
import { smartCompress } from '../../utils/tokenCompressor.js';
// yooo gotta import schema helpers for proper project isolation no cap
import { getProjectSchema } from '../../db/projectNamespacing.js';
import { stripNewlines } from '../../utils/compactXmlResponse.js';
// ============================================================================
// PER-PROJECT CHANNEL IDs - Each project gets isolated channels
// ============================================================================
/**
 * Generate a deterministic UUID for the default team channel based on project path.
 * This ensures each project gets its own isolated team channel.
 */
function getProjectDefaultChannelId() {
    const projectPath = getProjectPathForInsert();
    const hash = createHash('sha256').update(`team-default:${projectPath}`).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
/**
 * Generate a deterministic UUID for the broadcast channel based on project path.
 */
function getProjectBroadcastChannelId() {
    const projectPath = getProjectPathForInsert();
    const hash = createHash('sha256').update(`team-broadcast:${projectPath}`).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
/**
 * Generate a deterministic UUID for a swarm channel based on project path and swarm number.
 * Swarm channels (1-5) allow agent pairs to communicate privately while still seeing main channel.
 */
function getSwarmChannelId(swarmNum) {
    const projectPath = getProjectPathForInsert();
    const hash = createHash('sha256').update(`team-swarm-${swarmNum}:${projectPath}`).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
/**
 * Get channel ID from channel name (main, swarm-1, swarm-2, etc.)
 */
function getChannelIdByName(channelName) {
    if (!channelName || channelName === 'main' || channelName === 'default') {
        return getProjectDefaultChannelId();
    }
    if (channelName === 'broadcast') {
        return getProjectBroadcastChannelId();
    }
    // Check for swarm-N pattern
    const swarmMatch = channelName.match(/^swarm-(\d+)$/);
    if (swarmMatch) {
        const swarmNum = parseInt(swarmMatch[1], 10);
        if (swarmNum >= 1 && swarmNum <= 5) {
            return getSwarmChannelId(swarmNum);
        }
    }
    // Default to main channel
    return getProjectDefaultChannelId();
}
/**
 * Get the per-project channel name.
 */
function getProjectChannelName() {
    const projectPath = getProjectPathForInsert();
    const projectName = projectPath.split('/').filter(Boolean).pop() || 'default';
    return `team-${projectName}`;
}
// Legacy constants (kept for backwards compatibility, but tools use per-project functions)
const DEFAULT_CHANNEL_ID = '00000000-0000-0000-0000-000000000001';
const BROADCAST_CHANNEL_ID = '00000000-0000-0000-0000-000000000002';
const DEFAULT_CHANNEL = 'team-main';
// ============================================================================
// REMINDERS - Compact hints for team members on how to use tools
// ============================================================================
// Ultra-compact reminders - minimal tokens
const TEAM_COMMS_REMINDER = ``;
const READ_MESSAGES_REMINDER = ``;
const SEND_MESSAGE_REMINDER = ``;
const CLAIM_TASK_REMINDER = ``;
const TEAM_STATUS_REMINDER = ``;
const HELP_REQUEST_REMINDER = ``;
const CLEAR_MESSAGES_REMINDER = ``;
// Database pool - will be set by initTeamCommsDB
let dbPool = null;
// Session start timestamp - messages before this are filtered out
// This prevents agents from seeing stale messages from previous sessions
let sessionStartTime = null;
/**
 * Get the session start timestamp.
 * Returns the time when initTeamCommsDB was called for this session.
 * If not initialized, returns epoch (includes all messages).
 */
export function getSessionStartTime() {
    return sessionStartTime || new Date(0);
}
/**
 * Reset session start time (useful for testing or explicit session restart).
 * Call this before deploying new agents to ensure they start fresh.
 */
export function resetSessionStartTime() {
    sessionStartTime = new Date();
    logger.info({ sessionStartTime: sessionStartTime.toISOString() }, '[TeamComms] Session start time reset');
}
// Fallback in-memory stores (used when DB is not available)
const teamMessagesMemory = new Map();
const taskClaimsMemory = new Map();
const helpRequestsMemory = new Map();
// ============================================================================
// Database Initialization
// ============================================================================
/**
 * Initialize the team communications database schema
 * Creates tables for channels, messages, claims, and help requests
 *
 * CRITICAL: Sets search_path to project schema FIRST to avoid polluting public schema!
 * This ensures all tables are created in the correct project-isolated schema.
 */
export async function initTeamCommsDB(pool) {
    dbPool = pool;
    // Record session start time - all messages before this will be filtered out
    // This ensures agents don't see stale messages from previous sessions
    sessionStartTime = new Date();
    logger.info({ sessionStartTime: sessionStartTime.toISOString() }, '[TeamComms] Session started - old messages will be filtered');
    const client = await pool.connect();
    try {
        // yooo gotta set search_path FIRST or tables end up in public schema bruh
        // this is the key fix for project isolation - each project gets its own schema
        const schemaName = getProjectSchema();
        logger.info({ schemaName }, '[TeamComms] Setting search_path for project schema isolation');
        // Create the project schema if it doesn't exist (schema names are safe - generated by getProjectSchema)
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
        // Set search_path so all subsequent CREATE TABLE statements go to the project schema
        await client.query(`SET search_path TO ${schemaName}, public`);
        // Create team_channels table
        await client.query(`
      CREATE TABLE IF NOT EXISTS team_channels (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        channel_type VARCHAR(50) NOT NULL DEFAULT 'task',
        task_id VARCHAR(255),
        project_id VARCHAR(255),
        project_path VARCHAR(500) NOT NULL DEFAULT '/',
        members TEXT[] NOT NULL DEFAULT '{}',
        created_by VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        metadata JSONB NOT NULL DEFAULT '{}',
        CONSTRAINT valid_channel_type CHECK (channel_type IN ('task', 'project', 'direct', 'broadcast', 'default'))
      )
    `);
        // Add project_path column if it doesn't exist (migration for existing tables)
        await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'team_channels' AND column_name = 'project_path') THEN
          ALTER TABLE team_channels ADD COLUMN project_path VARCHAR(500) NOT NULL DEFAULT '/';
        END IF;
      END $$;
    `);
        // MIGRATION: Add missing columns to team_channels for older schemas
        // This fixes the "column X does not exist" errors when indexes try to reference them
        await client.query(`
      DO $$
      BEGIN
        -- Add channel_type if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'team_channels' AND column_name = 'channel_type') THEN
          ALTER TABLE team_channels ADD COLUMN channel_type VARCHAR(50) DEFAULT 'default';
        END IF;
        -- Add project_id if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'team_channels' AND column_name = 'project_id') THEN
          ALTER TABLE team_channels ADD COLUMN project_id VARCHAR(255);
        END IF;
        -- Add members if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'team_channels' AND column_name = 'members') THEN
          ALTER TABLE team_channels ADD COLUMN members TEXT[] DEFAULT '{}';
        END IF;
        -- Add created_by if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'team_channels' AND column_name = 'created_by') THEN
          ALTER TABLE team_channels ADD COLUMN created_by VARCHAR(255) DEFAULT 'system';
        END IF;
        -- Add last_activity if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'team_channels' AND column_name = 'last_activity') THEN
          ALTER TABLE team_channels ADD COLUMN last_activity TIMESTAMPTZ DEFAULT NOW();
        END IF;
        -- Add metadata if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'team_channels' AND column_name = 'metadata') THEN
          ALTER TABLE team_channels ADD COLUMN metadata JSONB DEFAULT '{}';
        END IF;
      END $$;
    `);
        // Create team_messages table
        await client.query(`
      CREATE TABLE IF NOT EXISTS team_messages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        channel_id UUID NOT NULL REFERENCES team_channels(id) ON DELETE CASCADE,
        sender_id VARCHAR(255) NOT NULL,
        sender_name VARCHAR(255) NOT NULL DEFAULT 'Unknown',
        content TEXT NOT NULL,
        message_type VARCHAR(50) NOT NULL DEFAULT 'update',
        priority VARCHAR(20) NOT NULL DEFAULT 'normal',
        thread_id UUID,
        mentions TEXT[] NOT NULL DEFAULT '{}',
        metadata JSONB NOT NULL DEFAULT '{}',
        project_path VARCHAR(500) NOT NULL DEFAULT '/',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        read_by TEXT[] NOT NULL DEFAULT '{}',
        CONSTRAINT valid_message_type CHECK (message_type IN ('status', 'question', 'update', 'broadcast', 'help_request', 'help_response')),
        CONSTRAINT valid_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent'))
      )
    `);
        // Add project_path column to team_messages if it doesn't exist
        await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'team_messages' AND column_name = 'project_path') THEN
          ALTER TABLE team_messages ADD COLUMN project_path VARCHAR(500) NOT NULL DEFAULT '/';
        END IF;
      END $$;
    `);
        // Create task_claims table
        await client.query(`
      CREATE TABLE IF NOT EXISTS task_claims (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        description TEXT NOT NULL,
        files TEXT[] NOT NULL DEFAULT '{}',
        claimed_by VARCHAR(255) NOT NULL,
        claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        metadata JSONB NOT NULL DEFAULT '{}',
        project_path VARCHAR(500) NOT NULL DEFAULT '/',
        CONSTRAINT valid_claim_status CHECK (status IN ('active', 'released'))
      )
    `);
        // Add project_path column to task_claims if it doesn't exist
        await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'task_claims' AND column_name = 'project_path') THEN
          ALTER TABLE task_claims ADD COLUMN project_path VARCHAR(500) NOT NULL DEFAULT '/';
        END IF;
      END $$;
    `);
        // Create help_requests table
        await client.query(`
      CREATE TABLE IF NOT EXISTS help_requests (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        question TEXT NOT NULL,
        context TEXT,
        requested_by VARCHAR(255) NOT NULL,
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        channel_id UUID REFERENCES team_channels(id) ON DELETE SET NULL,
        metadata JSONB NOT NULL DEFAULT '{}',
        project_path VARCHAR(500) NOT NULL DEFAULT '/',
        CONSTRAINT valid_help_status CHECK (status IN ('open', 'answered'))
      )
    `);
        // Add project_path column to help_requests if it doesn't exist
        await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'help_requests' AND column_name = 'project_path') THEN
          ALTER TABLE help_requests ADD COLUMN project_path VARCHAR(500) NOT NULL DEFAULT '/';
        END IF;
      END $$;
    `);
        // Create indexes for efficient queries
        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_team_messages_channel_id ON team_messages(channel_id);
      CREATE INDEX IF NOT EXISTS idx_team_messages_sender_id ON team_messages(sender_id);
      CREATE INDEX IF NOT EXISTS idx_team_messages_created_at ON team_messages(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_team_messages_thread_id ON team_messages(thread_id) WHERE thread_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_team_messages_mentions ON team_messages USING GIN(mentions);
      CREATE INDEX IF NOT EXISTS idx_team_messages_project_path ON team_messages(project_path);
      CREATE INDEX IF NOT EXISTS idx_team_channels_task_id ON team_channels(task_id) WHERE task_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_team_channels_project_id ON team_channels(project_id) WHERE project_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_team_channels_project_path ON team_channels(project_path);
      CREATE INDEX IF NOT EXISTS idx_task_claims_status ON task_claims(status) WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS idx_task_claims_files ON task_claims USING GIN(files) WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS idx_task_claims_project_path ON task_claims(project_path);
      CREATE INDEX IF NOT EXISTS idx_help_requests_status ON help_requests(status) WHERE status = 'open';
      CREATE INDEX IF NOT EXISTS idx_help_requests_project_path ON help_requests(project_path);
    `);
        // Create per-project default channel if it doesn't exist
        const projectDefaultChannelId = getProjectDefaultChannelId();
        const projectDefaultChannelName = getProjectChannelName();
        await client.query(`
      INSERT INTO team_channels (id, name, channel_type, created_by, project_path)
      VALUES ($1, $2, 'default', 'system', $3)
      ON CONFLICT (id) DO NOTHING
    `, [projectDefaultChannelId, projectDefaultChannelName, getProjectPathForInsert()]);
        // Create per-project broadcast channel if it doesn't exist
        const projectBroadcastChannelId = getProjectBroadcastChannelId();
        await client.query(`
      INSERT INTO team_channels (id, name, channel_type, created_by, project_path)
      VALUES ($1, $2, 'broadcast', 'system', $3)
      ON CONFLICT (id) DO NOTHING
    `, [projectBroadcastChannelId, `${projectDefaultChannelName}-broadcast`, getProjectPathForInsert()]);
        // FIX: Create swarm channels (swarm-1 through swarm-5) if they don't exist
        // Previously, swarm channels were never created, causing messages to fail
        // when agents tried to send/read from swarm-specific channels
        const projectPath = getProjectPathForInsert();
        for (let swarmNum = 1; swarmNum <= 5; swarmNum++) {
            const swarmChannelId = getSwarmChannelId(swarmNum);
            const swarmChannelName = `${projectDefaultChannelName}-swarm-${swarmNum}`;
            await client.query(`
        INSERT INTO team_channels (id, name, channel_type, created_by, project_path)
        VALUES ($1, $2, 'default', 'system', $3)
        ON CONFLICT (id) DO NOTHING
      `, [swarmChannelId, swarmChannelName, projectPath]);
        }
        logger.info({ schemaName }, 'Team communications database schema initialized in project schema - POSTGRES MODE ACTIVATED no cap');
    }
    catch (error) {
        logger.error({ error }, 'Failed to initialize team communications database schema');
        throw error;
    }
    finally {
        client.release();
    }
}
/**
 * Check if database is available
 */
function isDBAvailable() {
    return dbPool !== null;
}
/**
 * Set search_path for project isolation on a client connection.
 * MUST be called after acquiring a client from pool, before any queries.
 * This ensures tables are accessed from the correct project schema.
 */
async function setClientSearchPath(client) {
    const schemaName = getProjectSchema();
    await client.query(`SET search_path TO ${schemaName}, public`);
    return schemaName;
}
// ============================================================================
// Utility Functions
// ============================================================================
function generateId() {
    return uuidv4();
}
function getMemberId() {
    // Get team member ID from environment or generate one
    return process.env['SPECMEM_MEMBER_ID'] || process.env['SPECMEM_TEAM_MEMBER_ID'] || `member-${process.pid}`;
}
function getMemberName() {
    return process.env['SPECMEM_MEMBER_NAME'] || process.env['SPECMEM_TEAM_MEMBER_NAME'] || getMemberId();
}
function parseMentions(content) {
    const mentionRegex = /@([a-z0-9][a-z0-9_-]*)/gi;
    const matches = content.match(mentionRegex) || [];
    return [...new Set(matches.map(m => m.substring(1).toLowerCase()))];
}
function logToTeamChannel(action, details) {
    logger.info({ channel: getProjectChannelName(), action, ...details }, 'Team channel activity');
}
export class SendTeamMessage {
    name = 'send_team_message';
    description = `Send a message to the team channel via MCP (NOT HTTP).

This is the PRIMARY tool for team member communication. Use this instead of
any HTTP/REST endpoints for inter-team communication.

Use this to:
- Share status updates with the team
- Ask questions to team members
- Post updates about your work progress
- Reply to messages in a thread

Supports @mentions - use @member-id to notify specific team members.

Message types:
- status: Current work status (what you're doing)
- question: Asking the team for input
- update: General updates about progress or findings

Examples:
- "Starting work on authentication module" (status)
- "@backend-team can you review my API changes?" (question with mention)
- "Completed the database migration, moving to testing" (update)`;
    inputSchema = {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'The message content to send (supports @mentions)'
            },
            type: {
                type: 'string',
                enum: ['status', 'question', 'update', 'broadcast', 'help_request', 'help_response'],
                description: 'Type of message (default: update)',
                default: 'update'
            },
            priority: {
                type: 'string',
                enum: ['low', 'normal', 'high', 'urgent'],
                description: 'Message priority (default: normal)',
                default: 'normal'
            },
            channel: {
                type: 'string',
                enum: ['main', 'swarm-1', 'swarm-2', 'swarm-3', 'swarm-4', 'swarm-5'],
                description: 'Team channel: main (all agents), swarm-1 through swarm-5 (private swarm pairs)',
                default: 'main'
            },
            task_id: {
                type: 'string',
                description: 'Optional task ID to send to task-specific channel'
            },
            project_id: {
                type: 'string',
                description: 'Optional project ID to send to project-specific channel'
            },
            thread_id: {
                type: 'string',
                description: 'Optional thread ID for replies'
            },
            sender_name: {
                type: 'string',
                description: 'Optional display name for sender'
            }
        },
        required: ['message']
    };
    async execute(params) {
        const { message, type = 'update', priority = 'normal', channel = 'main', task_id, project_id, thread_id, sender_name } = params;
        // Validate input
        if (!message || message.trim().length === 0) {
            throw new Error('Message content cannot be empty');
        }
        // ════════════════════════════════════════════════════════════════════════
        // CHANNEL ENFORCEMENT - Agents can only post to their assigned channel
        // ════════════════════════════════════════════════════════════════════════
        // Check for agent channel assignment from file (written by agent-loading-hook)
        // Agents can post to:
        //   1. Their assigned channel (e.g., swarm-1)
        //   2. The main channel (for broadcasts visible to everyone)
        // Agents CANNOT post to other swarm channels (prevents crosstalk).
        const requestedChannel = channel || 'main';
        let assignedChannel = null;
        let agentId = null;
        // Check for agent ID in the current context (set by hook via prompt injection)
        // Also check environment as fallback
        const projectPath = getProjectPathForInsert();
        const projectHash = createHash('sha256').update(projectPath).digest('hex').slice(0, 12);
        const channelEnforcementDir = `/tmp/specmem-${projectHash}/agent-channels`;
        // Try to find this agent's channel assignment
        // The agent ID is extracted from process context or recent files
        try {
            if (fs.existsSync(channelEnforcementDir)) {
                const files = fs.readdirSync(channelEnforcementDir);
                // Find the most recent assignment file (likely this agent)
                // In practice, the agent-loading-hook injects the ID into the prompt
                let latestFile = null;
                let latestTime = 0;
                for (const file of files) {
                    if (file.endsWith('.json')) {
                        const stat = fs.statSync(`${channelEnforcementDir}/${file}`);
                        if (stat.mtimeMs > latestTime) {
                            latestTime = stat.mtimeMs;
                            latestFile = file;
                        }
                    }
                }
                if (latestFile && Date.now() - latestTime < 300000) { // Only use if <5 min old
                    const assignment = JSON.parse(fs.readFileSync(`${channelEnforcementDir}/${latestFile}`, 'utf8'));
                    assignedChannel = assignment.channel;
                    agentId = assignment.agentId;
                }
            }
        }
        catch (e) {
            // Silently continue - enforcement relaxed if can't read
        }
        if (assignedChannel && assignedChannel !== 'main') {
            const normalizedAssigned = assignedChannel.toLowerCase().trim();
            const normalizedRequested = requestedChannel.toLowerCase().trim();
            // Allowed: main, broadcast, or their assigned channel
            const allowedChannels = ['main', 'default', 'broadcast', normalizedAssigned];
            if (!allowedChannels.includes(normalizedRequested)) {
                // Agent is trying to post to a channel they're not assigned to
                logger.warn({
                    agentId,
                    assigned: normalizedAssigned,
                    attempted: normalizedRequested,
                    blocked: true
                }, 'Channel enforcement: Agent attempted to post to unauthorized channel');
                throw new Error(`Channel access denied. You're assigned to "${normalizedAssigned}" but tried to post to "${normalizedRequested}". ` +
                    `Agents can only post to their assigned channel or "main". ` +
                    `If you need to communicate with another swarm, post to "main" and @mention them.`);
            }
            // Log successful channel access for debugging
            logger.debug({
                agentId,
                assigned: normalizedAssigned,
                posting: normalizedRequested,
                allowed: true
            }, 'Channel enforcement: Agent posting to authorized channel');
        }
        // ════════════════════════════════════════════════════════════════════════
        const messageId = generateId();
        const timestamp = new Date().toISOString();
        const sender = getMemberId();
        const senderDisplayName = sender_name || getMemberName();
        const mentions = parseMentions(message);
        // Determine channel ID based on channel param - use per-project channels
        // Route to the correct channel (main, swarm-1, swarm-2, etc.)
        let channelId = getChannelIdByName(requestedChannel);
        let channelName = requestedChannel === 'main' || !requestedChannel
            ? getProjectChannelName()
            : `${getProjectChannelName()}-${requestedChannel}`;
        // projectPath already defined above for channel enforcement
        if (isDBAvailable()) {
            // Use PostgreSQL
            const client = await dbPool.connect();
            try {
                // CRITICAL: Set search_path for project isolation
                await setClientSearchPath(client);
                // Get or create appropriate channel
                if (task_id) {
                    const channelResult = await client.query(`
            INSERT INTO team_channels (name, channel_type, task_id, created_by, project_path)
            VALUES ($1, 'task', $2, $3, $4)
            ON CONFLICT (task_id) WHERE task_id IS NOT NULL
            DO UPDATE SET last_activity = NOW()
            RETURNING id, name
          `, [`task-${task_id}`, task_id, sender, projectPath]);
                    if (channelResult.rows.length > 0) {
                        channelId = channelResult.rows[0].id;
                        channelName = channelResult.rows[0].name;
                    }
                }
                else if (project_id) {
                    const channelResult = await client.query(`
            INSERT INTO team_channels (name, channel_type, project_id, created_by, project_path)
            VALUES ($1, 'project', $2, $3, $4)
            ON CONFLICT (project_id) WHERE project_id IS NOT NULL
            DO UPDATE SET last_activity = NOW()
            RETURNING id, name
          `, [`project-${project_id}`, project_id, sender, projectPath]);
                    if (channelResult.rows.length > 0) {
                        channelId = channelResult.rows[0].id;
                        channelName = channelResult.rows[0].name;
                    }
                }
                // Insert message
                await client.query(`
          INSERT INTO team_messages (
            id, channel_id, sender_id, sender_name, content,
            message_type, priority, thread_id, mentions, metadata, project_path
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
                    messageId,
                    channelId,
                    sender,
                    senderDisplayName,
                    message,
                    type,
                    priority,
                    thread_id || null,
                    mentions,
                    JSON.stringify({ timestamp }),
                    projectPath
                ]);
                // Update channel last_activity
                await client.query(`
          UPDATE team_channels SET last_activity = NOW() WHERE id = $1
        `, [channelId]);
            }
            finally {
                client.release();
            }
        }
        else {
            // FALLBACK MODE: In-memory storage with file-based cross-process communication
            // LIMITATION: In-memory Map is process-local - messages won't be visible to other processes
            // unless the file fallback succeeds. For full cross-process visibility, ensure PostgreSQL is running.
            // See: https://specmem.dev/docs/team-comms-limitations
            const teamMessage = {
                id: messageId,
                sender,
                sender_name: senderDisplayName,
                content: message,
                type,
                priority,
                timestamp,
                channel_id: channelId,
                thread_id,
                mentions,
                read_by: [],
                metadata: {}
            };
            teamMessagesMemory.set(messageId, teamMessage);
            // File-based fallback for cross-process visibility when DB is unavailable
            // NOTE: This is a best-effort fallback - file I/O may fail or race under high load
            try {
                const fileComms = getFileCommsTransport(sender);
                const fileType = type === 'broadcast' ? 'broadcast' : type === 'status' ? 'status' : 'message';
                const filePriority = priority === 'urgent' ? 'urgent' : priority === 'high' ? 'high' : 'medium';
                fileComms.send('all', `[${senderDisplayName}] ${message}`, {
                    type: fileType,
                    priority: filePriority
                });
            }
            catch (fileErr) {
                // File fallback failed - message only in this process memory
                // WARNING: Other team members won't see this message without DB or file transport
                logger.warn({ error: fileErr }, '[TeamComms] File fallback failed - message only visible in current process');
            }
        }
        // Write latest team message to statusbar state file for live display
        try {
            const statusFile = path.join(projectPath, 'specmem', 'sockets', 'team-comms-latest.json');
            const commsState = { sender: senderDisplayName, message: message.slice(0, 80), timestamp, channel: channel || 'main' };
            fs.writeFileSync(statusFile, JSON.stringify(commsState));
        }
        catch (_e) { /* non-fatal */ }
        logToTeamChannel('send_message', {
            messageId,
            type,
            priority,
            sender,
            mentions,
            messageLength: message.length,
            storage: isDBAvailable() ? 'postgresql' : 'memory'
        });
        // Human-readable response
        return {
            content: [{
                    type: 'text',
                    text: `[SENT] Message sent (id: ${messageId.slice(0, 8)}, type: ${type})`
                }]
        };
    }
}
export class ReadTeamMessages {
    name = 'read_team_messages';
    description = `Read messages from team communication channels via MCP (NOT HTTP).

This is the PRIMARY tool for reading team messages. Use this instead of
any HTTP/REST endpoints for retrieving inter-team communication.

Use this to:
- Check for updates from other team members
- See recent questions that need answers
- Stay informed about team activity
- Check messages where you are mentioned

Returns messages sorted by newest first.`;
    inputSchema = {
        type: 'object',
        properties: {
            limit: {
                type: 'number',
                description: 'Maximum number of messages to return (default: 10, max: 100)',
                default: 10
            },
            since: {
                type: 'string',
                description: 'Only return messages after this timestamp (ISO 8601 format)'
            },
            task_id: {
                type: 'string',
                description: 'Filter to messages from specific task channel'
            },
            project_id: {
                type: 'string',
                description: 'Filter to messages from specific project channel'
            },
            mentions_only: {
                type: 'boolean',
                description: 'Only show messages where you are mentioned',
                default: false
            },
            unread_only: {
                type: 'boolean',
                description: 'Only show unread messages',
                default: false
            },
            include_broadcasts: {
                type: 'boolean',
                description: 'Include broadcast messages (default: true)',
                default: true
            },
            include_swarms: {
                type: 'boolean',
                description: 'Also include messages from all swarm channels (swarm-1 through swarm-5). Use this to see private channel activity.',
                default: false
            },
            channel: {
                type: 'string',
                enum: ['main', 'swarm-1', 'swarm-2', 'swarm-3', 'swarm-4', 'swarm-5', 'all'],
                description: 'Filter to specific channel: main, swarm-1 through swarm-5, or "all" for all channels'
            },
            compress: {
                type: 'boolean',
                description: 'Enable Chinese token compression for compact output (default: true). Uses round-trip verified compression.',
                default: true
            }
        },
        required: []
    };
    async execute(params) {
        const { limit = 10, // Default to 10 for token efficiency
        since, channel, task_id, project_id, mentions_only = false, unread_only = false, include_broadcasts = true, include_swarms = false, compress = true } = params;
        const memberId = getMemberId();
        // Get current project path for filtering
        const projectPath = getProjectPathForInsert();
        let messages = [];
        let channelName = getProjectChannelName();
        if (isDBAvailable()) {
            // Use PostgreSQL
            const client = await dbPool.connect();
            try {
                // CRITICAL: Set search_path for project isolation
                await setClientSearchPath(client);
                // MED-20 FIX: Restructure query to avoid OR conditions that prevent index usage
                // Previously: WHERE (project_path = $2 OR project_path = '/') AND (channel_id = X OR ...)
                // This prevented idx_team_messages_project_path from being used effectively
                //
                // New approach: Use UNION ALL to let each subquery use indexes independently
                // PostgreSQL can use idx_team_messages_project_path for each branch separately
                // Build channel ID array for IN clause (more index-friendly than multiple ORs)
                // FIX: Use the channel parameter to filter by the requested channel
                // Previously this was ignored, causing all messages to be returned regardless of channel param
                const channelIds = [];
                // Handle channel parameter - 'all' means all channels, otherwise filter to specific channel
                if (channel === 'all') {
                    // Include main channel
                    channelIds.push(getProjectDefaultChannelId());
                    // Include all swarm channels (1-5)
                    for (let i = 1; i <= 5; i++) {
                        channelIds.push(getSwarmChannelId(i));
                    }
                }
                else if (channel && channel !== 'main') {
                    // Specific channel requested (e.g., swarm-1, swarm-2)
                    channelIds.push(getChannelIdByName(channel));
                    // Also include main channel for visibility (agents need to see main + their swarm)
                    channelIds.push(getProjectDefaultChannelId());
                }
                else {
                    // Default: main channel only
                    channelIds.push(getProjectDefaultChannelId());
                }
                // Handle include_swarms flag - adds all swarm channels to the list
                if (include_swarms && channel !== 'all') {
                    for (let i = 1; i <= 5; i++) {
                        const swarmId = getSwarmChannelId(i);
                        if (!channelIds.includes(swarmId)) {
                            channelIds.push(swarmId);
                        }
                    }
                }
                // Always include broadcasts if requested
                if (include_broadcasts) {
                    channelIds.push(getProjectBroadcastChannelId());
                }
                // Build dynamic filters
                const extraFilters = [];
                const queryParams = [memberId, projectPath, channelIds];
                let paramIndex = 4;
                // Task/project channel filters require join conditions
                let taskChannelJoin = '';
                let projectChannelJoin = '';
                if (task_id) {
                    taskChannelJoin = ` OR c.task_id = $${paramIndex}`;
                    queryParams.push(task_id);
                    paramIndex++;
                }
                if (project_id) {
                    projectChannelJoin = ` OR c.project_id = $${paramIndex}`;
                    queryParams.push(project_id);
                    paramIndex++;
                }
                // Time filter - user-specified "since" parameter
                if (since) {
                    extraFilters.push(`m.created_at > $${paramIndex}`);
                    queryParams.push(since);
                    paramIndex++;
                }
                // Session start filter - DISABLED for now
                // BUG: Each MCP instance has its own sessionStartTime, causing agents to not see
                // each other's messages. Until we have a shared session timestamp, disable this filter.
                // TODO: Use a file-based or DB-based shared session start time
                // const sessionStart = getSessionStartTime();
                // extraFilters.push(`m.created_at >= $${paramIndex}`);
                // queryParams.push(sessionStart.toISOString());
                // paramIndex++;
                // Mentions filter
                if (mentions_only) {
                    extraFilters.push(`$${paramIndex} = ANY(m.mentions)`);
                    queryParams.push(memberId.toLowerCase());
                    paramIndex++;
                }
                // Unread filter
                if (unread_only) {
                    extraFilters.push(`NOT ($1 = ANY(m.read_by))`);
                }
                const extraFilterClause = extraFilters.length > 0
                    ? ' AND ' + extraFilters.join(' AND ')
                    : '';
                const channelFilter = `(c.id = ANY($3)${taskChannelJoin}${projectChannelJoin})`;
                // MED-20 FIX: Use UNION ALL for project_path filtering
                // Each branch can use idx_team_messages_project_path independently
                // Then merge results and apply ORDER BY / LIMIT
                const query = `
          SELECT * FROM (
            -- Branch 1: Messages from current project
            SELECT
              m.id, m.sender_id as sender, m.sender_name, m.content,
              m.message_type as type, m.priority, m.created_at as timestamp,
              m.mentions, m.thread_id,
              NOT ($1 = ANY(m.read_by)) as is_unread,
              c.name as channel_name
            FROM team_messages m
            JOIN team_channels c ON m.channel_id = c.id
            WHERE m.project_path = $2
              AND ${channelFilter}${extraFilterClause}

            UNION ALL

            -- Branch 2: Global broadcasts (project_path = '/')
            SELECT
              m.id, m.sender_id as sender, m.sender_name, m.content,
              m.message_type as type, m.priority, m.created_at as timestamp,
              m.mentions, m.thread_id,
              NOT ($1 = ANY(m.read_by)) as is_unread,
              c.name as channel_name
            FROM team_messages m
            JOIN team_channels c ON m.channel_id = c.id
            WHERE m.project_path = '/'
              AND ${channelFilter}${extraFilterClause}
          ) combined
          ORDER BY timestamp DESC
          LIMIT $${paramIndex}
        `;
                queryParams.push(limit);
                const result = await client.query(query, queryParams);
                messages = result.rows.map((row) => {
                    // Apply Chinese token compression if enabled
                    const content = compress && row.content && row.content.length > 30
                        ? smartCompress(row.content, { threshold: 0.75 }).result
                        : row.content;
                    return {
                        id: row.id,
                        sender: row.sender,
                        sender_name: row.sender_name,
                        content,
                        type: row.type,
                        priority: row.priority,
                        timestamp: row.timestamp.toISOString(),
                        mentions: row.mentions || [],
                        is_unread: row.is_unread,
                        thread_id: row.thread_id || undefined
                    };
                });
                if (result.rows.length > 0) {
                    channelName = result.rows[0].channel_name;
                }
                // Mark messages as read
                if (messages.length > 0) {
                    const messageIds = messages.map(m => m.id);
                    await client.query(`
            UPDATE team_messages
            SET read_by = array_append(read_by, $1)
            WHERE id = ANY($2) AND NOT ($1 = ANY(read_by))
          `, [memberId, messageIds]);
                }
            }
            finally {
                client.release();
            }
        }
        else {
            // Fallback to in-memory
            const sessionStart = getSessionStartTime();
            // FIX: Build channel ID list for in-memory filtering (mirrors DB logic above)
            const memChannelIds = [];
            if (channel === 'all') {
                memChannelIds.push(getProjectDefaultChannelId());
                for (let i = 1; i <= 5; i++) {
                    memChannelIds.push(getSwarmChannelId(i));
                }
            }
            else if (channel && channel !== 'main') {
                memChannelIds.push(getChannelIdByName(channel));
                memChannelIds.push(getProjectDefaultChannelId());
            }
            else {
                memChannelIds.push(getProjectDefaultChannelId());
            }
            if (include_swarms && channel !== 'all') {
                for (let i = 1; i <= 5; i++) {
                    const swarmId = getSwarmChannelId(i);
                    if (!memChannelIds.includes(swarmId)) {
                        memChannelIds.push(swarmId);
                    }
                }
            }
            if (include_broadcasts) {
                memChannelIds.push(getProjectBroadcastChannelId());
            }
            let memMessages = Array.from(teamMessagesMemory.values())
                .filter(msg => memChannelIds.includes(msg.channel_id))
                // Session start filter - exclude messages from before current session
                .filter(msg => new Date(msg.timestamp) >= sessionStart);
            if (since) {
                const sinceDate = new Date(since);
                memMessages = memMessages.filter(msg => new Date(msg.timestamp) > sinceDate);
            }
            if (mentions_only) {
                memMessages = memMessages.filter(msg => msg.mentions.includes(memberId.toLowerCase()));
            }
            if (unread_only) {
                memMessages = memMessages.filter(msg => !msg.read_by.includes(memberId));
            }
            memMessages.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            messages = memMessages.slice(0, limit).map(msg => {
                // Apply Chinese token compression if enabled
                const content = compress && msg.content && msg.content.length > 30
                    ? smartCompress(msg.content, { threshold: 0.75 }).result
                    : msg.content;
                return {
                    id: msg.id,
                    sender: msg.sender,
                    sender_name: msg.sender_name,
                    content,
                    type: msg.type,
                    priority: msg.priority,
                    timestamp: msg.timestamp,
                    mentions: msg.mentions,
                    is_unread: !msg.read_by.includes(memberId),
                    thread_id: msg.thread_id
                };
            });
            // Mark as read
            for (const msg of messages) {
                const original = teamMessagesMemory.get(msg.id);
                if (original && !original.read_by.includes(memberId)) {
                    original.read_by.push(memberId);
                }
            }
        }
        const unreadCount = messages.filter(m => m.is_unread).length;
        logToTeamChannel('read_messages', {
            count: messages.length,
            unreadCount,
            limit,
            since,
            storage: isDBAvailable() ? 'postgresql' : 'memory'
        });
        // Human-readable format like find_memory/Read tool
        const typeEmoji = {
            status: '🔄',
            question: '❓',
            update: '📝',
            broadcast: '📢',
            help_request: '🆘',
            help_response: '💡'
        };
        const formatTimeAgo = (date) => {
            const now = Date.now();
            const then = new Date(date).getTime();
            const diffSec = Math.floor((now - then) / 1000);
            if (diffSec < 60) return `${diffSec}s ago`;
            const diffMin = Math.floor(diffSec / 60);
            if (diffMin < 60) return `${diffMin}m ago`;
            const diffHr = Math.floor(diffMin / 60);
            if (diffHr < 24) return `${diffHr}h ago`;
            return `${Math.floor(diffHr / 24)}d ago`;
        };
        const formatMessage = (m, idx) => {
            const emoji = typeEmoji[m.type] || '💬';
            const unread = m.is_unread ? ' ★ NEW' : '';
            const time = formatTimeAgo(m.created_at);
            const from = m.sender_name || 'unknown';
            // Compress content with smartCompress for token savings
            const rawContent = m.content.slice(0, 400);
            const { result: compressedContent } = smartCompress(rawContent, { threshold: 0.6 });
            const content = compressedContent.replace(/\n/g, '\n│   ');
            const truncated = m.content.length > 400 ? '...' : '';
            return `┌─${unread}────────────────────────────────────
│ ${emoji} ${from}  •  ${m.type}  •  ${time}
│   ${content}${truncated}
└──────────────────────────────────────────`;
        };
        // Use [SPECMEM-*] tag format for consistency with other tools
        const header = `[SPECMEM-TEAM-MESSAGES]
📬 ${messages.length} messages • ${unreadCount} unread`;
        const msgList = messages.map((m, i) => formatMessage(m, i)).join('\n');
        const footer = `\n💬 send_team_message({message}) 回覆
[/SPECMEM-TEAM-MESSAGES]`;
        const output = messages.length > 0
            ? `${header}\n${msgList}${footer}`
            : `${header}\n  無訊息\n${footer}`;
        return { content: [{ type: 'text', text: output }] };
    }
}
export class BroadcastToTeam {
    name = 'broadcast_to_team';
    description = `Broadcast a status or progress update to ALL team members via MCP.

Use this to:
- Share progress updates: "Completed 75% of database migration"
- Announce important status changes: "API endpoints ready for testing"
- Notify about blockers or issues: "Waiting on external service"
- Celebrate milestones: "Feature X is complete and tested"

By default, broadcasts only reach team members in the SAME PROJECT.
Use cross_project: true for system-wide announcements (use sparingly).`;
    inputSchema = {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'The broadcast message'
            },
            broadcast_type: {
                type: 'string',
                enum: ['status', 'progress', 'announcement'],
                description: 'Type of broadcast (default: status)'
            },
            priority: {
                type: 'string',
                enum: ['low', 'normal', 'high', 'urgent'],
                description: 'Broadcast priority (default: normal)'
            },
            metadata: {
                type: 'object',
                description: 'Optional metadata (e.g., { progress: 75 })'
            },
            cross_project: {
                type: 'boolean',
                description: 'If true, broadcast to ALL projects (use sparingly for system-wide announcements)',
                default: false
            }
        },
        required: ['message']
    };
    async execute(params) {
        const { message, broadcast_type = 'status', priority = 'normal', metadata = {}, cross_project = false } = params;
        if (!message || message.trim().length === 0) {
            throw new Error('Broadcast message cannot be empty');
        }
        const messageId = generateId();
        const timestamp = new Date().toISOString();
        const sender = getMemberId();
        const senderName = getMemberName();
        // Get current project path for filtering
        // Use '/' (root) for cross-project broadcasts to make them visible everywhere
        const projectPath = cross_project ? '/' : getProjectPathForInsert();
        if (isDBAvailable()) {
            const client = await dbPool.connect();
            try {
                // CRITICAL: Set search_path for project isolation
                await setClientSearchPath(client);
                await client.query(`
          INSERT INTO team_messages (
            id, channel_id, sender_id, sender_name, content,
            message_type, priority, metadata, project_path
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
                    messageId,
                    getProjectBroadcastChannelId(),
                    sender,
                    senderName,
                    `[${broadcast_type.toUpperCase()}]${cross_project ? ' [GLOBAL]' : ''} ${message}`,
                    'broadcast',
                    priority,
                    JSON.stringify({ ...metadata, broadcast_type, cross_project }),
                    projectPath
                ]);
                await client.query(`
          UPDATE team_channels SET last_activity = NOW() WHERE id = $1
        `, [getProjectBroadcastChannelId()]);
            }
            finally {
                client.release();
            }
        }
        else {
            const teamMessage = {
                id: messageId,
                sender,
                sender_name: senderName,
                content: `[${broadcast_type.toUpperCase()}] ${message}`,
                type: 'broadcast',
                priority,
                timestamp,
                channel_id: getProjectBroadcastChannelId(),
                mentions: [],
                read_by: [],
                metadata: { ...metadata, broadcast_type }
            };
            teamMessagesMemory.set(messageId, teamMessage);
        }
        // Write latest broadcast to statusbar state file for live display
        try {
            const broadcastProjectPath = cross_project ? (process.env.SPECMEM_PROJECT_PATH || process.cwd()) : projectPath;
            const statusFile = path.join(broadcastProjectPath, 'specmem', 'sockets', 'team-comms-latest.json');
            const commsState = { sender: senderName, message: message.slice(0, 80), timestamp, channel: 'broadcast' };
            fs.writeFileSync(statusFile, JSON.stringify(commsState));
        }
        catch (_e) { /* non-fatal */ }
        logToTeamChannel('broadcast', {
            messageId,
            broadcast_type,
            priority,
            sender,
            storage: isDBAvailable() ? 'postgresql' : 'memory'
        });
        // Human-readable response
        return {
            content: [{
                    type: 'text',
                    text: `[BROADCAST] ${broadcast_type} sent to team (id: ${messageId.slice(0, 8)})`
                }]
        };
    }
}
export class ClaimTask {
    name = 'claim_task';
    description = `Claim a specific task or file to work on.

Use this to:
- Declare what you're working on to avoid conflicts
- Prevent duplicate work on the same files
- Coordinate with other team members

If the files you want to claim are already claimed by another member,
you'll receive a warning but the claim will still be created.

Best practice: Always claim before starting work on a task.`;
    inputSchema = {
        type: 'object',
        properties: {
            description: {
                type: 'string',
                description: 'Description of the task you are claiming'
            },
            files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional array of file paths you will be working on'
            }
        },
        required: ['description']
    };
    async execute(params) {
        const { description, files = [] } = params;
        if (!description || description.trim().length === 0) {
            throw new Error('Task description cannot be empty');
        }
        const claimId = generateId();
        const claimedBy = getMemberId();
        const claimedAt = new Date().toISOString();
        const warnings = [];
        // Get current project path for filtering
        const projectPath = getProjectPathForInsert();
        if (isDBAvailable()) {
            const client = await dbPool.connect();
            try {
                // CRITICAL: Set search_path for project isolation
                await setClientSearchPath(client);
                // Check for file conflicts (within same project)
                if (files.length > 0) {
                    const conflictResult = await client.query(`
            SELECT id, claimed_by, files
            FROM task_claims
            WHERE status = 'active' AND claimed_by != $1 AND files && $2 AND project_path = $3
          `, [claimedBy, files, projectPath]);
                    for (const row of conflictResult.rows) {
                        const conflictingFiles = files.filter(f => row.files.includes(f));
                        for (const file of conflictingFiles) {
                            warnings.push(`File "${file}" is already claimed by ${row.claimed_by} (claim: ${row.id})`);
                        }
                    }
                }
                // Insert claim
                await client.query(`
          INSERT INTO task_claims (id, description, files, claimed_by, claimed_at, status, project_path)
          VALUES ($1, $2, $3, $4, $5, 'active', $6)
        `, [claimId, description, files, claimedBy, claimedAt, projectPath]);
            }
            finally {
                client.release();
            }
        }
        else {
            // Check for conflicts in memory
            const activeClaims = Array.from(taskClaimsMemory.values()).filter(c => c.status === 'active');
            for (const existingClaim of activeClaims) {
                if (existingClaim.claimedBy === claimedBy)
                    continue;
                for (const file of files) {
                    if (existingClaim.files.includes(file)) {
                        warnings.push(`File "${file}" is already claimed by ${existingClaim.claimedBy} (claim: ${existingClaim.id})`);
                    }
                }
            }
            const claim = {
                id: claimId,
                description,
                files,
                claimedBy,
                claimedAt,
                status: 'active'
            };
            taskClaimsMemory.set(claimId, claim);
        }
        // Broadcast claim to team
        const sendMessage = new SendTeamMessage();
        const fileList = files.length > 0 ? ` (files: ${files.join(', ')})` : '';
        await sendMessage.execute({
            message: `[CLAIM] ${description}${fileList}`,
            type: 'status',
            priority: 'normal'
        });
        logToTeamChannel('claim_task', {
            claimId,
            description,
            files,
            claimedBy,
            warnings,
            storage: isDBAvailable() ? 'postgresql' : 'memory'
        });
        // Ultra-compact return
        return {
            success: true,
            claimId: claimId.slice(0, 8),
            description: stripNewlines(description).slice(0, 50),
            files,
            timestamp: claimedAt,
            warnings
        };
    }
}
export class ReleaseTask {
    name = 'release_task';
    description = `Release files or entire task claims.

Use this to:
- Release specific files: release_task({claimId: "abc", files: ["src/foo.ts"]}) - releases just those files, keeps claim active
- Release entire claim: release_task({claimId: "abc"}) - releases all files in that claim
- Release everything: release_task({claimId: "all"}) - releases ALL your active claims

Best practice: Release files as you finish them, release entire claim when task is complete.`;
    inputSchema = {
        type: 'object',
        properties: {
            claimId: {
                type: 'string',
                description: 'The claim ID to release, or "all" to release all your claims'
            },
            files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional: Release only these specific files from the claim (keeps claim active for remaining files)'
            }
        },
        required: ['claimId']
    };
    async execute(params) {
        const { claimId, files } = params;
        const memberId = getMemberId();
        const releasedClaims = [];
        const releasedFiles = [];
        if (isDBAvailable()) {
            const client = await dbPool.connect();
            try {
                // CRITICAL: Set search_path for project isolation
                await setClientSearchPath(client);
                if (claimId === 'all') {
                    // FIX HIGH-13: Add project_path filter to prevent releasing claims from other projects
                    const projectPath = getProjectPathForInsert();
                    const result = await client.query(`
            UPDATE task_claims
            SET status = 'released'
            WHERE claimed_by = $1 AND status = 'active' AND project_path = $2
            RETURNING id
          `, [memberId, projectPath]);
                    releasedClaims.push(...result.rows.map((r) => r.id));
                }
                else if (files && files.length > 0) {
                    // PARTIAL RELEASE: Remove specific files from claim
                    const claimResult = await client.query(`
            SELECT claimed_by, files FROM task_claims WHERE id = $1 AND status = 'active'
          `, [claimId]);
                    if (claimResult.rows.length === 0) {
                        throw new Error(`Active claim not found: ${claimId}`);
                    }
                    if (claimResult.rows[0].claimed_by !== memberId) {
                        throw new Error(`Cannot modify claim owned by another member`);
                    }
                    const currentFiles = claimResult.rows[0].files || [];
                    const remainingFiles = currentFiles.filter(f => !files.includes(f));
                    releasedFiles.push(...files.filter(f => currentFiles.includes(f)));
                    if (remainingFiles.length === 0) {
                        // No files left, release entire claim
                        await client.query(`UPDATE task_claims SET status = 'released' WHERE id = $1`, [claimId]);
                        releasedClaims.push(claimId);
                    }
                    else {
                        // Update claim with remaining files
                        await client.query(`UPDATE task_claims SET files = $1 WHERE id = $2`, [remainingFiles, claimId]);
                    }
                }
                else {
                    // FULL RELEASE: Release entire claim
                    const claimResult = await client.query(`
            SELECT claimed_by FROM task_claims WHERE id = $1
          `, [claimId]);
                    if (claimResult.rows.length === 0) {
                        throw new Error(`Claim not found: ${claimId}`);
                    }
                    if (claimResult.rows[0].claimed_by !== memberId) {
                        throw new Error(`Cannot release claim owned by another member: ${claimResult.rows[0].claimed_by}`);
                    }
                    await client.query(`UPDATE task_claims SET status = 'released' WHERE id = $1`, [claimId]);
                    releasedClaims.push(claimId);
                }
            }
            finally {
                client.release();
            }
        }
        else {
            if (claimId === 'all') {
                for (const [id, claim] of taskClaimsMemory.entries()) {
                    if (claim.claimedBy === memberId && claim.status === 'active') {
                        claim.status = 'released';
                        releasedClaims.push(id);
                    }
                }
            }
            else if (files && files.length > 0) {
                // PARTIAL RELEASE (memory fallback)
                const claim = taskClaimsMemory.get(claimId);
                if (!claim || claim.status !== 'active') {
                    throw new Error(`Active claim not found: ${claimId}`);
                }
                if (claim.claimedBy !== memberId) {
                    throw new Error(`Cannot modify claim owned by another member`);
                }
                releasedFiles.push(...files.filter(f => claim.files.includes(f)));
                claim.files = claim.files.filter(f => !files.includes(f));
                if (claim.files.length === 0) {
                    claim.status = 'released';
                    releasedClaims.push(claimId);
                }
            }
            else {
                const claim = taskClaimsMemory.get(claimId);
                if (!claim) {
                    throw new Error(`Claim not found: ${claimId}`);
                }
                if (claim.claimedBy !== memberId) {
                    throw new Error(`Cannot release claim owned by another member: ${claim.claimedBy}`);
                }
                if (claim.status === 'released') {
                    throw new Error(`Claim already released: ${claimId}`);
                }
                claim.status = 'released';
                releasedClaims.push(claimId);
            }
        }
        // Broadcast release
        const sendMessage = new SendTeamMessage();
        if (releasedFiles.length > 0 && releasedClaims.length === 0) {
            // Partial file release
            await sendMessage.execute({
                message: `[FILE-RELEASE] Released files: ${releasedFiles.join(', ')} (claim still active)`,
                type: 'status',
                priority: 'low'
            });
        }
        else if (releasedClaims.length > 0) {
            await sendMessage.execute({
                message: `[RELEASE] Released ${releasedClaims.length} claim(s): ${releasedClaims.map(c => c.slice(0, 8)).join(', ')}`,
                type: 'status',
                priority: 'low'
            });
        }
        logToTeamChannel('release_task', {
            claimId,
            releasedClaims,
            memberId,
            storage: isDBAvailable() ? 'postgresql' : 'memory'
        });
        // Ultra-compact
        const message = releasedClaims.length === 1
            ? `Released claim ${releasedClaims[0].slice(0, 8)}`
            : `Released ${releasedClaims.length} claims`;
        return {
            success: true,
            releasedClaims: releasedClaims.map(id => id.slice(0, 8)),
            message
        };
    }
}
export class GetTeamStatus {
    name = 'get_team_status';
    description = `Show what each team member is working on.

Returns:
- Active task claims from all team members
- Recent team activity (messages, claims, help requests)
- Number of open help requests

Use this to:
- Understand current team workload
- Avoid working on claimed tasks
- See if anyone needs help`;
    inputSchema = {
        type: 'object',
        properties: {},
        required: []
    };
    async execute(_params) {
        // Get current project path for filtering
        const projectPath = getProjectPathForInsert();
        let activeClaims = [];
        let recentActivity = [];
        let openHelpRequests = 0;
        if (isDBAvailable()) {
            const client = await dbPool.connect();
            try {
                // CRITICAL: Set search_path for project isolation
                await setClientSearchPath(client);
                // Get active claims (filtered by project)
                const claimsResult = await client.query(`
          SELECT id, description, files, claimed_by, claimed_at
          FROM task_claims
          WHERE status = 'active' AND project_path = $1
          ORDER BY claimed_at DESC
          LIMIT 5
        `, [projectPath]);
                activeClaims = claimsResult.rows.map((row) => ({
                    claimId: row.id.substring(0, 8), // Short ID
                    description: row.description.substring(0, 50),
                    claimedBy: row.claimed_by
                }));
                // Get recent activity - just 3 most recent
                const activityResult = await client.query(`
          SELECT sender_id, content, message_type
          FROM team_messages
          WHERE project_path = $1
          ORDER BY created_at DESC
          LIMIT 3
        `, [projectPath]);
                recentActivity = activityResult.rows.map((row) => ({
                    who: row.sender_id.substring(7, 13), // Just ID suffix
                    msg: row.content.substring(0, 40)
                }));
                // Count open help requests (filtered by project)
                const helpResult = await client.query(`
          SELECT COUNT(*) as count FROM help_requests WHERE status = 'open' AND project_path = $1
        `, [projectPath]);
                openHelpRequests = parseInt(helpResult.rows[0].count);
            }
            finally {
                client.release();
            }
        }
        else {
            activeClaims = Array.from(taskClaimsMemory.values())
                .filter(c => c.status === 'active')
                .slice(0, 5)
                .map(c => ({
                claimId: c.id.substring(0, 8),
                description: c.description.substring(0, 50),
                claimedBy: c.claimedBy
            }));
            recentActivity = Array.from(teamMessagesMemory.values())
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                .slice(0, 3)
                .map(msg => ({
                who: msg.sender.substring(7, 13),
                msg: msg.content.substring(0, 40)
            }));
            openHelpRequests = Array.from(helpRequestsMemory.values())
                .filter(h => h.status === 'open').length;
        }
        logToTeamChannel('get_status', {
            activeClaims: activeClaims.length,
            openHelpRequests,
            storage: isDBAvailable() ? 'postgresql' : 'memory'
        });
        // Human-readable format like find_memory
        const lines = ['[TEAM-STATUS]'];
        lines.push(`Claims: ${activeClaims.length} | Help requests: ${openHelpRequests} | Recent: ${recentActivity.length}`);
        if (activeClaims.length > 0) {
            lines.push('Active claims:');
            activeClaims.forEach((c, i) => {
                lines.push(`  [${i + 1}] ${c.claimedBy || 'unknown'}: ${c.description}`);
            });
        }
        if (recentActivity.length > 0) {
            lines.push('Recent activity:');
            recentActivity.forEach((a) => {
                lines.push(`  • ${a.who}: ${a.msg}`);
            });
        }
        lines.push('[/TEAM-STATUS]');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
}
export class RequestHelp {
    name = 'request_help';
    description = `Broadcast a help request to the team via MCP.

Use this when you:
- Are stuck on a problem
- Need input from team members with specific expertise
- Want a second opinion on an approach

The help request will be visible to all team members and they can
respond using the respond_to_help tool.`;
    inputSchema = {
        type: 'object',
        properties: {
            question: {
                type: 'string',
                description: 'The question or issue you need help with'
            },
            context: {
                type: 'string',
                description: 'Optional additional context about the problem'
            },
            skills_needed: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional list of skills needed (e.g., ["database", "typescript"])'
            }
        },
        required: ['question']
    };
    async execute(params) {
        const { question, context, skills_needed = [] } = params;
        if (!question || question.trim().length === 0) {
            throw new Error('Question cannot be empty');
        }
        const requestId = generateId();
        const requestedBy = getMemberId();
        const requestedAt = new Date().toISOString();
        // Get current project path for filtering
        const projectPath = getProjectPathForInsert();
        if (isDBAvailable()) {
            const client = await dbPool.connect();
            try {
                // CRITICAL: Set search_path for project isolation
                await setClientSearchPath(client);
                await client.query(`
          INSERT INTO help_requests (id, question, context, requested_by, requested_at, status, metadata, project_path)
          VALUES ($1, $2, $3, $4, $5, 'open', $6, $7)
        `, [requestId, question, context || null, requestedBy, requestedAt, JSON.stringify({ skills_needed }), projectPath]);
            }
            finally {
                client.release();
            }
        }
        else {
            const helpRequest = {
                id: requestId,
                question,
                context,
                requestedBy,
                requestedAt,
                status: 'open'
            };
            helpRequestsMemory.set(requestId, helpRequest);
        }
        // Broadcast help request with high priority
        const contextStr = context ? `\nContext: ${context}` : '';
        const skillsStr = skills_needed.length > 0 ? `\nSkills needed: ${skills_needed.join(', ')}` : '';
        const broadcast = new BroadcastToTeam();
        await broadcast.execute({
            message: `HELP NEEDED: ${question}${contextStr}${skillsStr}\n(Request ID: ${requestId})`,
            broadcast_type: 'announcement',
            priority: 'high',
            metadata: { request_id: requestId, skills_needed }
        });
        logToTeamChannel('request_help', {
            requestId,
            requestedBy,
            questionLength: question.length,
            skills_needed,
            storage: isDBAvailable() ? 'postgresql' : 'memory'
        });
        // Ultra-compact
        return {
            success: true,
            requestId: requestId.slice(0, 8),
            timestamp: requestedAt,
            message: 'Help request broadcasted to team'
        };
    }
}
export class RespondToHelp {
    name = 'respond_to_help';
    description = `Respond to a help request from another team member via MCP.

Use this to:
- Answer questions from team members
- Provide suggestions or guidance
- Share relevant knowledge

Your response will be attached to the help request and the requester
will be notified.`;
    inputSchema = {
        type: 'object',
        properties: {
            requestId: {
                type: 'string',
                description: 'The ID of the help request you are responding to'
            },
            response: {
                type: 'string',
                description: 'Your response or answer to the help request'
            }
        },
        required: ['requestId', 'response']
    };
    async execute(params) {
        const { requestId, response } = params;
        if (!response || response.trim().length === 0) {
            throw new Error('Response cannot be empty');
        }
        const responseId = generateId();
        const respondedBy = getMemberId();
        const respondedAt = new Date().toISOString();
        let requester = 'unknown';
        let questionSummary = '';
        if (isDBAvailable()) {
            const client = await dbPool.connect();
            try {
                // CRITICAL: Set search_path for project isolation
                await setClientSearchPath(client);
                // Get the help request
                const helpResult = await client.query(`
          SELECT requested_by, question FROM help_requests WHERE id = $1
        `, [requestId]);
                if (helpResult.rows.length === 0) {
                    throw new Error(`Help request not found: ${requestId}`);
                }
                requester = helpResult.rows[0].requested_by;
                questionSummary = helpResult.rows[0].question.substring(0, 30);
                // Store response as a message
                // FIX MED-11: Add project_path to INSERT for proper isolation
                const projectPath = getProjectPathForInsert();
                await client.query(`
          INSERT INTO team_messages (
            id, channel_id, sender_id, sender_name, content,
            message_type, priority, metadata, project_path
          )
          VALUES ($1, $2, $3, $4, $5, 'help_response', 'high', $6, $7)
        `, [
                    responseId,
                    getProjectBroadcastChannelId(),
                    respondedBy,
                    getMemberName(),
                    `[HELP RESPONSE] Re: "${questionSummary}..."\n${response}`,
                    JSON.stringify({ request_id: requestId }),
                    projectPath
                ]);
                // Mark request as answered if this is the first response
                await client.query(`
          UPDATE help_requests SET status = 'answered' WHERE id = $1 AND status = 'open'
        `, [requestId]);
            }
            finally {
                client.release();
            }
        }
        else {
            const helpRequest = helpRequestsMemory.get(requestId);
            if (!helpRequest) {
                throw new Error(`Help request not found: ${requestId}`);
            }
            requester = helpRequest.requestedBy;
            questionSummary = helpRequest.question.substring(0, 30);
            helpRequest.status = 'answered';
            // Store as message
            const teamMessage = {
                id: responseId,
                sender: respondedBy,
                sender_name: getMemberName(),
                content: `[HELP RESPONSE] Re: "${questionSummary}..."\n${response}`,
                type: 'help_response',
                priority: 'high',
                timestamp: respondedAt,
                channel_id: getProjectBroadcastChannelId(),
                mentions: [requester],
                read_by: [],
                metadata: { request_id: requestId }
            };
            teamMessagesMemory.set(responseId, teamMessage);
        }
        // Also send direct notification
        const sendMessage = new SendTeamMessage();
        await sendMessage.execute({
            message: `@${requester} Response to your help request: ${response.substring(0, 100)}${response.length > 100 ? '...' : ''}`,
            type: 'help_response',
            priority: 'high'
        });
        logToTeamChannel('respond_to_help', {
            requestId,
            responseId,
            respondedBy,
            storage: isDBAvailable() ? 'postgresql' : 'memory'
        });
        // Ultra-compact
        return {
            success: true,
            responseId: responseId.slice(0, 8),
            requestId: requestId.slice(0, 8),
            timestamp: respondedAt,
            message: `Response sent to ${requester}`
        };
    }
}
export class ClearTeamMessages {
    name = 'clear_team_messages';
    description = `Clear old team messages before deploying new team members.

Use this to:
- Wipe the slate clean before new deployments
- Prevent new team members from seeing old noise/context
- Clean up after a deployment session ends

IMPORTANT: Call this BEFORE spawning new team members to ensure they
start fresh without being spammed by old messages.

NOTE: This also resets the session start timestamp, so even if DB delete fails,
read_team_messages will not return any pre-existing messages. New session = clean slate.

Options:
- confirm: Must be true to actually delete (safety check)
- older_than_minutes: Only delete messages older than N minutes (default: all)
- clear_claims: Also clear task claims (default: true)
- clear_help_requests: Also clear help requests (default: true)

Example: clear_team_messages({confirm: true}) - wipes everything
Example: clear_team_messages({confirm: true, older_than_minutes: 60}) - only old messages`;
    inputSchema = {
        type: 'object',
        properties: {
            confirm: {
                type: 'boolean',
                description: 'Must be true to actually delete (safety check)'
            },
            older_than_minutes: {
                type: 'number',
                description: 'Only delete messages older than N minutes (optional - default: all)'
            },
            clear_claims: {
                type: 'boolean',
                description: 'Also clear task claims (default: true)',
                default: true
            },
            clear_help_requests: {
                type: 'boolean',
                description: 'Also clear help requests (default: true)',
                default: true
            }
        },
        required: ['confirm']
    };
    async execute(params) {
        const { confirm, older_than_minutes, clear_claims = true, clear_help_requests = true } = params;
        if (!confirm) {
            return {
                success: false,
                messagesDeleted: 0,
                claimsCleared: 0,
                helpRequestsCleared: 0,
                message: 'Aborted: confirm must be true to delete messages'
            };
        }
        // Reset session start time - this ensures read_team_messages won't return
        // any messages that existed before this clear operation, even if DB delete fails
        // Critical for clean agent coordination - clearing = fresh start
        resetSessionStartTime();
        // Get current project path for filtering
        const projectPath = getProjectPathForInsert();
        let messagesDeleted = 0;
        let claimsCleared = 0;
        let helpRequestsCleared = 0;
        if (isDBAvailable()) {
            const client = await dbPool.connect();
            try {
                // CRITICAL: Set search_path for project isolation
                await setClientSearchPath(client);
                // Build time filter if specified
                let timeFilter = '';
                const timeParams = [projectPath];
                if (older_than_minutes !== undefined) {
                    timeFilter = ` AND created_at < NOW() - INTERVAL '${older_than_minutes} minutes'`;
                }
                // Delete messages
                const msgResult = await client.query(`
          DELETE FROM team_messages
          WHERE project_path = $1${timeFilter}
          RETURNING id
        `, timeParams);
                messagesDeleted = msgResult.rowCount || 0;
                // Clear claims if requested
                if (clear_claims) {
                    const claimTimeFilter = older_than_minutes !== undefined
                        ? ` AND claimed_at < NOW() - INTERVAL '${older_than_minutes} minutes'`
                        : '';
                    const claimResult = await client.query(`
            DELETE FROM task_claims
            WHERE project_path = $1${claimTimeFilter}
            RETURNING id
          `, [projectPath]);
                    claimsCleared = claimResult.rowCount || 0;
                }
                // Clear help requests if requested
                if (clear_help_requests) {
                    const helpTimeFilter = older_than_minutes !== undefined
                        ? ` AND requested_at < NOW() - INTERVAL '${older_than_minutes} minutes'`
                        : '';
                    const helpResult = await client.query(`
            DELETE FROM help_requests
            WHERE project_path = $1${helpTimeFilter}
            RETURNING id
          `, [projectPath]);
                    helpRequestsCleared = helpResult.rowCount || 0;
                }
            }
            finally {
                client.release();
            }
        }
        else {
            // In-memory cleanup
            const cutoffTime = older_than_minutes
                ? new Date(Date.now() - older_than_minutes * 60 * 1000)
                : null;
            // Clear messages
            for (const [id, msg] of teamMessagesMemory.entries()) {
                if (!cutoffTime || new Date(msg.timestamp) < cutoffTime) {
                    teamMessagesMemory.delete(id);
                    messagesDeleted++;
                }
            }
            // Clear claims
            if (clear_claims) {
                for (const [id, claim] of taskClaimsMemory.entries()) {
                    if (!cutoffTime || new Date(claim.claimedAt) < cutoffTime) {
                        taskClaimsMemory.delete(id);
                        claimsCleared++;
                    }
                }
            }
            // Clear help requests
            if (clear_help_requests) {
                for (const [id, req] of helpRequestsMemory.entries()) {
                    if (!cutoffTime || new Date(req.requestedAt) < cutoffTime) {
                        helpRequestsMemory.delete(id);
                        helpRequestsCleared++;
                    }
                }
            }
        }
        const timeInfo = older_than_minutes
            ? ` (older than ${older_than_minutes} minutes)`
            : '';
        logToTeamChannel('clear_messages', {
            messagesDeleted,
            claimsCleared,
            helpRequestsCleared,
            older_than_minutes,
            storage: isDBAvailable() ? 'postgresql' : 'memory'
        });
        // Ultra-compact: just counts
        const message = `Cleared ${messagesDeleted} messages, ${claimsCleared} claims, ${helpRequestsCleared} help requests${timeInfo}`;
        return {
            success: true,
            messagesDeleted,
            claimsCleared,
            helpRequestsCleared,
            message
        };
    }
}
// ============================================================================
// Export all tools
// ============================================================================
export const teamCommTools = [
    SendTeamMessage,
    ReadTeamMessages,
    BroadcastToTeam,
    ClaimTask,
    ReleaseTask,
    GetTeamStatus,
    RequestHelp,
    RespondToHelp,
    ClearTeamMessages
];
/**
 * Create instances of all team communication tools
 */
export function createTeamCommTools() {
    return [
        new SendTeamMessage(),
        new ReadTeamMessages(),
        new BroadcastToTeam(),
        new ClaimTask(),
        new ReleaseTask(),
        new GetTeamStatus(),
        new RequestHelp(),
        new RespondToHelp(),
        new ClearTeamMessages()
    ];
}
/**
 * Initialize team comms with database pool and return tools
 */
export async function createTeamCommToolsWithDB(pool) {
    await initTeamCommsDB(pool);
    return createTeamCommTools();
}
//# sourceMappingURL=teamComms.js.map