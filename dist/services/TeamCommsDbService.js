/**
 * TEAM COMMUNICATION DATABASE SERVICE
 *
 * PostgreSQL-backed persistent storage for team communication.
 * Complements the in-memory TeamCommsService in team-members/ with
 * durable database storage for:
 * - Team channels (Slack-like channels for task coordination)
 * - Team messages (status updates, code reviews, help requests)
 * - Task claims (who's working on what files)
 *
 * Use this service when you need:
 * - Persistent storage across restarts
 * - Complex queries (e.g., unread counts, file conflicts)
 * - Historical data retention
 *
 * Architecture:
 *   Channel → Messages (threaded) + Claims (task ownership)
 */
import { logger } from '../utils/logger.js';
import { getProjectPathForInsert } from './ProjectContext.js';
// ============================================================================
// SERVICE
// ============================================================================
export class TeamCommsDbService {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Initialize team communication tables.
     * Call this during database setup.
     */
    async initialize() {
        // Team channels table
        await this.db.query(`
      CREATE TABLE IF NOT EXISTS team_channels (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        task_id VARCHAR(255),
        project_path TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        archived_at TIMESTAMPTZ
      )
    `);
        // Team messages table
        await this.db.query(`
      CREATE TABLE IF NOT EXISTS team_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        channel_id UUID REFERENCES team_channels(id) ON DELETE CASCADE,
        sender_id VARCHAR(255) NOT NULL,
        sender_name VARCHAR(255),
        message_type VARCHAR(50) DEFAULT 'message',
        content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        thread_id UUID REFERENCES team_messages(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        read_by JSONB DEFAULT '[]'
      )
    `);
        // Task claims table
        await this.db.query(`
      CREATE TABLE IF NOT EXISTS task_claims (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        channel_id UUID REFERENCES team_channels(id) ON DELETE CASCADE,
        team_member_id VARCHAR(255) NOT NULL,
        task_description TEXT NOT NULL,
        file_paths TEXT[],
        status VARCHAR(50) DEFAULT 'in_progress',
        claimed_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `);
        // Create indexes
        await this.db.query(`CREATE INDEX IF NOT EXISTS idx_team_channels_task ON team_channels(task_id)`);
        await this.db.query(`CREATE INDEX IF NOT EXISTS idx_messages_channel ON team_messages(channel_id, created_at DESC)`);
        await this.db.query(`CREATE INDEX IF NOT EXISTS idx_messages_thread ON team_messages(thread_id)`);
        await this.db.query(`CREATE INDEX IF NOT EXISTS idx_claims_channel ON task_claims(channel_id, status)`);
        logger.info('[TeamCommsDbService] Initialized team communication tables');
    }
    // ==========================================================================
    // CHANNEL OPERATIONS
    // ==========================================================================
    /**
     * Create a new team communication channel.
     *
     * @param taskId - Optional ID of the spawned task this channel is for
     * @param projectPath - Optional path to the project being worked on
     * @param name - Optional channel name (defaults to task ID or "team-channel")
     * @returns The created channel
     */
    async createChannel(taskId, projectPath, name) {
        const channelName = name || taskId || 'team-channel';
        const result = await this.db.query(`
      INSERT INTO team_channels (name, task_id, project_path)
      VALUES ($1, $2, $3)
      RETURNING id, name, task_id, project_path, created_at, archived_at
    `, [channelName, taskId || null, projectPath || null]);
        const row = result.rows[0];
        logger.info({ channelId: row.id, taskId, projectPath }, '[TeamCommsDbService] Created channel');
        return {
            id: row.id,
            name: row.name,
            taskId: row.task_id,
            projectPath: row.project_path,
            createdAt: row.created_at,
            archivedAt: row.archived_at
        };
    }
    /**
     * Get a channel by ID.
     */
    async getChannel(channelId) {
        const result = await this.db.query(`
      SELECT id, name, task_id, project_path, created_at, archived_at
      FROM team_channels
      WHERE id = $1
    `, [channelId]);
        if (result.rows.length === 0)
            return null;
        const row = result.rows[0];
        return {
            id: row.id,
            name: row.name,
            taskId: row.task_id,
            projectPath: row.project_path,
            createdAt: row.created_at,
            archivedAt: row.archived_at
        };
    }
    /**
     * Get a channel by task ID.
     */
    async getChannelByTaskId(taskId) {
        const result = await this.db.query(`
      SELECT id, name, task_id, project_path, created_at, archived_at
      FROM team_channels
      WHERE task_id = $1 AND archived_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `, [taskId]);
        if (result.rows.length === 0)
            return null;
        const row = result.rows[0];
        return {
            id: row.id,
            name: row.name,
            taskId: row.task_id,
            projectPath: row.project_path,
            createdAt: row.created_at,
            archivedAt: row.archived_at
        };
    }
    /**
     * Archive a channel (soft delete).
     */
    async archiveChannel(channelId) {
        await this.db.query(`
      UPDATE team_channels
      SET archived_at = NOW()
      WHERE id = $1
    `, [channelId]);
        logger.info({ channelId }, '[TeamCommsDbService] Archived channel');
    }
    // ==========================================================================
    // MESSAGE OPERATIONS
    // ==========================================================================
    /**
     * Send a message to a channel.
     *
     * @param channelId - Channel to send to
     * @param senderId - ID of the sending team member
     * @param content - Message content
     * @param type - Message type (message, status, code_review, help_request)
     * @param options - Additional options (senderName, metadata, threadId)
     * @returns The created message
     */
    async sendMessage(channelId, senderId, content, type = 'message', options) {
        const result = await this.db.query(`
      INSERT INTO team_messages (channel_id, sender_id, sender_name, message_type, content, metadata, thread_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, channel_id, sender_id, sender_name, message_type, content, metadata, thread_id, created_at, read_by
    `, [
            channelId,
            senderId,
            options?.senderName || null,
            type,
            content,
            options?.metadata || {},
            options?.threadId || null
        ]);
        const row = result.rows[0];
        logger.debug({ messageId: row.id, channelId, senderId, type }, '[TeamCommsDbService] Sent message');
        return {
            id: row.id,
            channelId: row.channel_id,
            senderId: row.sender_id,
            senderName: row.sender_name,
            messageType: row.message_type,
            content: row.content,
            metadata: row.metadata,
            threadId: row.thread_id,
            createdAt: row.created_at,
            readBy: row.read_by
        };
    }
    /**
     * Get messages from a channel.
     *
     * NOTE: This function is project-scoped by default. Messages from other projects
     * are filtered out unless they are global broadcasts (project_path = '/').
     *
     * @param channelId - Channel to fetch from
     * @param since - Optional timestamp to get messages after
     * @param limit - Maximum number of messages to return (default 50)
     * @param options - Additional options for filtering
     * @returns Array of messages, newest first
     */
    async getMessages(channelId, since, limit = 50, options) {
        const projectPath = getProjectPathForInsert();
        const includeGlobal = options?.includeGlobalBroadcasts ?? true;
        // Filter by project path: show messages from this project + global broadcasts
        const projectFilter = includeGlobal
            ? `(m.project_path = $2 OR m.project_path = '/')`
            : `m.project_path = $2`;
        let query = `
      SELECT id, channel_id, sender_id, sender_name, message_type, content, metadata, thread_id, created_at, read_by
      FROM team_messages m
      WHERE channel_id = $1 AND ${projectFilter}
    `;
        const params = [channelId, projectPath];
        if (since) {
            query += ` AND created_at > $${params.length + 1}`;
            params.push(since);
        }
        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
        params.push(limit);
        const result = await this.db.query(query, params);
        return result.rows.map(row => ({
            id: row.id,
            channelId: row.channel_id,
            senderId: row.sender_id,
            senderName: row.sender_name,
            messageType: row.message_type,
            content: row.content,
            metadata: row.metadata,
            threadId: row.thread_id,
            createdAt: row.created_at,
            readBy: row.read_by
        }));
    }
    /**
     * Get thread replies for a message.
     */
    async getThreadReplies(threadId, limit = 50) {
        const result = await this.db.query(`
      SELECT id, channel_id, sender_id, sender_name, message_type, content, metadata, thread_id, created_at, read_by
      FROM team_messages
      WHERE thread_id = $1
      ORDER BY created_at ASC
      LIMIT $2
    `, [threadId, limit]);
        return result.rows.map(row => ({
            id: row.id,
            channelId: row.channel_id,
            senderId: row.sender_id,
            senderName: row.sender_name,
            messageType: row.message_type,
            content: row.content,
            metadata: row.metadata,
            threadId: row.thread_id,
            createdAt: row.created_at,
            readBy: row.read_by
        }));
    }
    /**
     * Mark a message as read by a teamMember.
     *
     * @param messageId - Message to mark
     * @param memberId - Team member who read it
     */
    async markAsRead(messageId, memberId) {
        await this.db.query(`
      UPDATE team_messages
      SET read_by = read_by || to_jsonb($2::text)
      WHERE id = $1
        AND NOT (read_by @> to_jsonb($2::text))
    `, [messageId, memberId]);
    }
    /**
     * Mark all messages in a channel as read by a teamMember.
     */
    async markAllAsRead(channelId, memberId) {
        const result = await this.db.query(`
      UPDATE team_messages
      SET read_by = read_by || to_jsonb($2::text)
      WHERE channel_id = $1
        AND sender_id != $2
        AND NOT (read_by @> to_jsonb($2::text))
    `, [channelId, memberId]);
        return result.rowCount || 0;
    }
    /**
     * Get unread message count for a member in a channel.
     */
    async getUnreadCount(channelId, memberId) {
        const result = await this.db.query(`
      SELECT COUNT(*)::text as count
      FROM team_messages
      WHERE channel_id = $1
        AND sender_id != $2
        AND NOT (read_by @> to_jsonb($2::text))
    `, [channelId, memberId]);
        return parseInt(result.rows[0]?.count || '0', 10);
    }
    // ==========================================================================
    // TASK CLAIM OPERATIONS
    // ==========================================================================
    /**
     * Claim a task (announce what you're working on).
     *
     * @param channelId - Channel to claim in
     * @param memberId - Team member making the claim
     * @param description - Description of the task
     * @param files - Files being worked on
     * @returns The created claim, or null if files conflict with existing claims
     */
    async claimTask(channelId, memberId, description, files) {
        const filePaths = files || [];
        // Check for file conflicts
        const conflicts = await this.checkFileConflicts(channelId, filePaths, memberId);
        // Create the claim even if there are conflicts (let the caller decide)
        const result = await this.db.query(`
      INSERT INTO task_claims (channel_id, team_member_id, task_description, file_paths)
      VALUES ($1, $2, $3, $4)
      RETURNING id, channel_id, team_member_id, task_description, file_paths, status, claimed_at, completed_at
    `, [channelId, memberId, description, filePaths]);
        const row = result.rows[0];
        logger.info({ claimId: row.id, channelId, memberId, files: filePaths }, '[TeamCommsDbService] Created task claim');
        return {
            claim: {
                id: row.id,
                channelId: row.channel_id,
                teamMemberId: row.team_member_id,
                taskDescription: row.task_description,
                filePaths: row.file_paths || [],
                status: row.status,
                claimedAt: row.claimed_at,
                completedAt: row.completed_at
            },
            conflicts
        };
    }
    /**
     * Release a task claim (mark as completed or abandoned).
     *
     * @param claimId - Claim to release
     * @param status - New status (completed or abandoned)
     */
    async releaseClaim(claimId, status = 'completed') {
        await this.db.query(`
      UPDATE task_claims
      SET status = $2, completed_at = NOW()
      WHERE id = $1
    `, [claimId, status]);
        logger.info({ claimId, status }, '[TeamCommsDbService] Released task claim');
    }
    /**
     * Get active claims for a channel.
     */
    async getActiveClaims(channelId) {
        const result = await this.db.query(`
      SELECT id, channel_id, team_member_id, task_description, file_paths, status, claimed_at, completed_at
      FROM task_claims
      WHERE channel_id = $1 AND status = 'in_progress'
      ORDER BY claimed_at DESC
    `, [channelId]);
        return result.rows.map(row => ({
            id: row.id,
            channelId: row.channel_id,
            teamMemberId: row.team_member_id,
            taskDescription: row.task_description,
            filePaths: row.file_paths || [],
            status: row.status,
            claimedAt: row.claimed_at,
            completedAt: row.completed_at
        }));
    }
    /**
     * Get all claims for a teamMember.
     */
    async getMemberClaims(memberId, activeOnly = true) {
        let query = `
      SELECT id, channel_id, team_member_id, task_description, file_paths, status, claimed_at, completed_at
      FROM task_claims
      WHERE team_member_id = $1
    `;
        if (activeOnly) {
            query += ` AND status = 'in_progress'`;
        }
        query += ` ORDER BY claimed_at DESC`;
        const result = await this.db.query(query, [memberId]);
        return result.rows.map(row => ({
            id: row.id,
            channelId: row.channel_id,
            teamMemberId: row.team_member_id,
            taskDescription: row.task_description,
            filePaths: row.file_paths || [],
            status: row.status,
            claimedAt: row.claimed_at,
            completedAt: row.completed_at
        }));
    }
    /**
     * Check if any active claims conflict with given file paths.
     */
    async checkFileConflicts(channelId, filePaths, excludeMemberId) {
        if (!filePaths || filePaths.length === 0) {
            return [];
        }
        let query = `
      SELECT id, team_member_id, file_paths
      FROM task_claims
      WHERE channel_id = $1
        AND status = 'in_progress'
        AND file_paths && $2
    `;
        const params = [channelId, filePaths];
        if (excludeMemberId) {
            query += ` AND team_member_id != $3`;
            params.push(excludeMemberId);
        }
        const result = await this.db.query(query, params);
        return result.rows.map(row => {
            // Calculate intersection of file paths
            const conflictingFiles = row.file_paths.filter(f => filePaths.includes(f));
            return {
                claimId: row.id,
                memberId: row.team_member_id,
                conflictingFiles
            };
        });
    }
    // ==========================================================================
    // CONVENIENCE METHODS
    // ==========================================================================
    /**
     * Send a status update message.
     */
    async sendStatus(channelId, senderId, status, senderName) {
        return this.sendMessage(channelId, senderId, status, 'status', { senderName });
    }
    /**
     * Request code review.
     */
    async requestCodeReview(channelId, senderId, description, files, senderName) {
        return this.sendMessage(channelId, senderId, description, 'code_review', {
            senderName,
            metadata: { files }
        });
    }
    /**
     * Request help from team.
     */
    async requestHelp(channelId, senderId, question, context, senderName) {
        return this.sendMessage(channelId, senderId, question, 'help_request', {
            senderName,
            metadata: context || {}
        });
    }
    /**
     * Get channel summary (messages, claims, activity).
     */
    async getChannelSummary(channelId) {
        const [channel, recentMessages, activeClaims, memberCount] = await Promise.all([
            this.getChannel(channelId),
            this.getMessages(channelId, undefined, 10),
            this.getActiveClaims(channelId),
            this.db.query(`
        SELECT COUNT(DISTINCT sender_id)::text as count
        FROM team_messages
        WHERE channel_id = $1
      `, [channelId])
        ]);
        return {
            channel,
            recentMessages,
            activeClaims,
            memberCount: parseInt(memberCount.rows[0]?.count || '0', 10)
        };
    }
}
// ============================================================================
// PER-PROJECT INSTANCE MANAGEMENT (Map pattern for project isolation)
// ============================================================================
import { getProjectPath } from '../config.js';
const teamCommsDbByProject = new Map();
/**
 * Get the TeamCommsDbService for the current project.
 * Lazily initializes on first call.
 */
export function getTeamCommsDbService(db, projectPath) {
    const targetProject = projectPath || getProjectPath();
    if (!teamCommsDbByProject.has(targetProject)) {
        teamCommsDbByProject.set(targetProject, new TeamCommsDbService(db));
    }
    return teamCommsDbByProject.get(targetProject);
}
/**
 * Reset the service for a specific project (for testing).
 */
export function resetTeamCommsDbService(projectPath) {
    if (projectPath) {
        teamCommsDbByProject.delete(projectPath);
    }
    else {
        const targetProject = getProjectPath();
        teamCommsDbByProject.delete(targetProject);
    }
}
/**
 * Reset all project instances (for testing).
 */
export function resetAllTeamCommsDbServices() {
    teamCommsDbByProject.clear();
}
//# sourceMappingURL=TeamCommsDbService.js.map