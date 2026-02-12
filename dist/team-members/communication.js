/**
 * Team Member Communication Protocol
 *
 * Defines the message format and communication methods for AI team members
 * to communicate with each other via SpecMem.
 *
 * Messages are stored as memories with special tags for routing.
 */
import { createSpecMemClient } from './workers/specmemClient.js';
import { TEAM_MEMBER_MESSAGING } from '../constants.js';
// Default expiration time in milliseconds (uses centralized constant)
export const DEFAULT_MESSAGE_EXPIRATION_MS = TEAM_MEMBER_MESSAGING.DEFAULT_EXPIRATION_MS;
/**
 * Calculate expiration time for a message
 * @param customMs - Custom expiration time in milliseconds (optional)
 * @returns Date object representing when the message expires
 */
export function calculateExpiration(customMs) {
    const expirationMs = customMs ?? DEFAULT_MESSAGE_EXPIRATION_MS;
    return new Date(Date.now() + expirationMs);
}
/**
 * Create tags for a team member message
 * @param from - Sender team member ID
 * @param to - Target team member ID or 'all' for broadcast
 * @param messageType - Type of message
 * @param options - Optional priority and expiration settings
 */
export function createMessageTags(from, to, messageType, options = {}) {
    const tags = [
        'team-member-message',
        `from:${from}`,
        `to:${to}`,
        `type:${messageType}`,
    ];
    // Add priority tag (default: medium)
    const priority = options.priority || 'medium';
    tags.push(`priority:${priority}`);
    // Add expiration tag
    const expiresAt = options.expiresAt || calculateExpiration();
    tags.push(`expires:${expiresAt.toISOString()}`);
    return tags;
}
/**
 * Parse tags from a memory to extract message info
 */
export function parseMessageTags(tags) {
    const result = { isTeamMemberMessage: false };
    for (const tag of tags) {
        if (tag === 'team-member-message') {
            result.isTeamMemberMessage = true;
        }
        else if (tag.startsWith('from:')) {
            result.from = tag.substring(5);
        }
        else if (tag.startsWith('to:')) {
            result.to = tag.substring(3);
        }
        else if (tag.startsWith('type:')) {
            result.messageType = tag.substring(5);
        }
        else if (tag.startsWith('priority:')) {
            result.priority = tag.substring(9);
        }
        else if (tag.startsWith('expires:')) {
            result.expiresAt = tag.substring(8);
        }
    }
    return result;
}
/**
 * Check if a message has expired
 */
export function isMessageExpired(expiresAt) {
    if (!expiresAt)
        return false;
    const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
    return expiry < new Date();
}
/**
 * Convert memory to team member message
 */
export function memoryToMessage(memory) {
    const parsed = parseMessageTags(memory.tags || []);
    if (!parsed.isTeamMemberMessage || !parsed.from || !parsed.to) {
        return null;
    }
    // Parse expiration from tags or metadata
    let expiresAt;
    if (parsed.expiresAt) {
        expiresAt = new Date(parsed.expiresAt);
    }
    else if (memory.metadata?.expiresAt) {
        expiresAt = new Date(memory.metadata.expiresAt);
    }
    // Parse readBy from metadata
    const readBy = memory.metadata?.readBy || [];
    return {
        from: parsed.from,
        to: parsed.to,
        content: memory.content,
        timestamp: new Date(memory.created_at),
        messageType: parsed.messageType || 'direct',
        messageId: memory.id,
        expiresAt,
        priority: parsed.priority || 'medium',
        readBy,
    };
}
// ============================================================================
// TeamMemberCommunicator Class
// ============================================================================
export class TeamMemberCommunicator {
    client;
    teamMemberId;
    lastMessageCheck;
    cleanupInterval = null;
    static CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    constructor(teamMemberId, client) {
        this.teamMemberId = teamMemberId;
        this.client = client || createSpecMemClient({ teamMemberId });
        this.lastMessageCheck = new Date();
        // MED-10 FIX: Start periodic cleanup of expired messages on insert
        this.startExpirationCleanup();
    }
    /**
     * MED-10 FIX: Periodic cleanup job for expired messages
     * Runs every 5 minutes to remove expired messages from storage
     * This prevents unbounded growth of expired messages in the database
     */
    startExpirationCleanup() {
        // Avoid duplicate intervals
        if (this.cleanupInterval)
            return;
        this.cleanupInterval = setInterval(async () => {
            try {
                await this.cleanupExpiredMessages();
            }
            catch (err) {
                console.error(`[TeamMember ${this.teamMemberId}] Cleanup error:`, err);
            }
        }, TeamMemberCommunicator.CLEANUP_INTERVAL_MS);
        // Don't block process exit
        if (this.cleanupInterval.unref) {
            this.cleanupInterval.unref();
        }
    }
    /**
     * MED-10 FIX: Clean up expired messages from storage
     * Deletes messages that have passed their expiration time
     */
    async cleanupExpiredMessages() {
        try {
            // Find expired team member messages
            const expiredMemories = await this.client.find('team-member-message expired', {
                limit: 100,
                tags: ['team-member-message'],
            });
            let deletedCount = 0;
            const now = new Date();
            for (const memory of expiredMemories) {
                const parsed = parseMessageTags(memory.tags || []);
                if (parsed.expiresAt && new Date(parsed.expiresAt) < now) {
                    await this.client.delete(memory.id);
                    deletedCount++;
                }
            }
            if (deletedCount > 0) {
                console.log(`[TeamMember ${this.teamMemberId}] Cleaned up ${deletedCount} expired messages`);
            }
            return deletedCount;
        }
        catch (err) {
            console.error(`[TeamMember ${this.teamMemberId}] Failed to cleanup expired messages:`, err);
            return 0;
        }
    }
    /**
     * Stop the cleanup interval (call when communicator is destroyed)
     */
    stopCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
    /**
     * Send a message to another team member or broadcast to all
     * @param message - The message content
     * @param to - Target team member ID or 'all' for broadcast (default: 'all')
     * @param options - Optional priority and expiration settings
     */
    async say(message, to = 'all', options = {}) {
        const expiresAt = calculateExpiration(options.expiresInMs);
        const priority = options.priority || (to === 'all' ? 'high' : 'medium');
        const messageType = to === 'all' ? 'broadcast' : 'direct';
        const tags = createMessageTags(this.teamMemberId, to, messageType, {
            priority,
            expiresAt,
        });
        const memory = await this.client.remember(message, {
            memoryType: 'episodic',
            importance: priority,
            tags,
            metadata: {
                teamMemberMessage: true,
                from: this.teamMemberId,
                to,
                timestamp: new Date().toISOString(),
                expiresAt: expiresAt.toISOString(),
                priority,
                readBy: [], // Initially no one has read this message
            },
        });
        if (memory) {
            console.log(`[TeamMember ${this.teamMemberId}] Message sent to ${to} (priority: ${priority}): "${message.substring(0, 50)}..."`);
            return true;
        }
        return false;
    }
    /**
     * Broadcast a status update to all team members
     */
    async broadcastStatus(status) {
        const tags = createMessageTags(this.teamMemberId, 'all', 'status');
        const memory = await this.client.remember(`[STATUS] ${status}`, {
            memoryType: 'episodic',
            importance: 'high',
            tags,
            metadata: {
                teamMemberStatus: true,
                from: this.teamMemberId,
                statusMessage: status,
                timestamp: new Date().toISOString(),
            },
        });
        return !!memory;
    }
    /**
     * Get messages for this team member (both direct and broadcasts)
     * @param since - Only get messages since this date
     * @param options - Options for filtering and sorting
     */
    async getMessages(since, options = {}) {
        const sinceDate = since || this.lastMessageCheck;
        const { includeExpired = false, sortByPriority = true } = options;
        // Search for team member messages
        const memories = await this.client.find('team-member-message', {
            limit: TEAM_MEMBER_MESSAGING.DEFAULT_FETCH_LIMIT,
            tags: ['team-member-message'],
        });
        const messages = [];
        for (const memory of memories) {
            const msg = memoryToMessage(memory);
            if (!msg)
                continue;
            // Filter expired messages (Team Member B addition)
            if (!includeExpired && isMessageExpired(msg.expiresAt)) {
                continue;
            }
            // Filter by date if needed
            if (sinceDate && msg.timestamp <= sinceDate)
                continue;
            // Include if:
            // 1. Message is to this team member specifically
            // 2. Message is a broadcast (to all)
            // 3. Message is from another team member (not self)
            if ((msg.to === this.teamMemberId || msg.to === 'all') && msg.from !== this.teamMemberId) {
                messages.push(msg);
            }
        }
        // Update last check time
        this.lastMessageCheck = new Date();
        // Sort messages: by priority first (high > medium > low), then by timestamp
        if (sortByPriority) {
            return messages.sort((a, b) => {
                const priorityA = TEAM_MEMBER_MESSAGING.PRIORITY_ORDER[a.priority || 'medium'];
                const priorityB = TEAM_MEMBER_MESSAGING.PRIORITY_ORDER[b.priority || 'medium'];
                if (priorityA !== priorityB) {
                    return priorityA - priorityB; // Higher priority first
                }
                return a.timestamp.getTime() - b.timestamp.getTime(); // Then by timestamp
            });
        }
        return messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    }
    /**
     * Listen for messages (shorthand for getMessages with no time filter)
     */
    async listen() {
        return this.getMessages();
    }
    /**
     * Send heartbeat to indicate team member is active
     * Deletes previous heartbeat to prevent duplicate spam
     */
    async sendHeartbeat(status = 'active') {
        const tags = [
            'team-member-heartbeat',
            `teamMember:${this.teamMemberId}`,
            `status:${status}`,
        ];
        // Delete any existing heartbeats for this team member to prevent duplicates
        try {
            const existingHeartbeats = await this.client.find('team-member-heartbeat', {
                limit: 10,
                tags: ['team-member-heartbeat', `teamMember:${this.teamMemberId}`],
            });
            // Delete old heartbeats (keep none - we'll create a fresh one)
            for (const hb of existingHeartbeats) {
                await this.client.delete(hb.id);
            }
        }
        catch (err) {
            // Ignore errors during cleanup - still send new heartbeat
        }
        const memory = await this.client.remember(`Heartbeat: ${this.teamMemberId} is ${status}`, {
            memoryType: 'working',
            importance: 'low',
            tags,
            metadata: {
                teamMemberId: this.teamMemberId,
                status,
                timestamp: new Date().toISOString(),
            },
        });
        return !!memory;
    }
    /**
     * Get list of active team members (those with recent heartbeats)
     */
    async getActiveTeamMembers(withinSeconds = TEAM_MEMBER_MESSAGING.HEARTBEAT_TIMEOUT_SECONDS) {
        const memories = await this.client.find('team-member-heartbeat', {
            limit: 100,
            tags: ['team-member-heartbeat'],
        });
        const teamMembers = new Map();
        const now = new Date();
        const cutoff = new Date(now.getTime() - withinSeconds * 1000);
        for (const memory of memories) {
            const timestamp = new Date(memory.created_at);
            if (timestamp < cutoff)
                continue;
            // Extract team member ID from tags
            let teamMemberId;
            let status = 'active';
            for (const tag of memory.tags || []) {
                if (tag.startsWith('teamMember:')) {
                    // HIGH-12 FIX: 'teamMember:'.length is 11, not 6
                    // Previously used substring(6) which returned partial prefix + ID
                    teamMemberId = tag.substring(11);
                }
                else if (tag.startsWith('status:')) {
                    status = tag.substring(7);
                }
            }
            if (teamMemberId && (!teamMembers.has(teamMemberId) || timestamp > teamMembers.get(teamMemberId).lastHeartbeat)) {
                teamMembers.set(teamMemberId, {
                    teamMemberId,
                    teamMemberName: memory.metadata?.teamMemberName,
                    teamMemberType: memory.metadata?.teamMemberType,
                    status,
                    lastHeartbeat: timestamp,
                });
            }
        }
        return Array.from(teamMembers.values());
    }
    /**
     * Register this team member as active
     */
    async registerTeamMember(name, type) {
        const tags = [
            'team-member-registration',
            `teamMember:${this.teamMemberId}`,
        ];
        const memory = await this.client.remember(`TeamMember ${this.teamMemberId} registered`, {
            memoryType: 'episodic',
            importance: 'high',
            tags,
            metadata: {
                teamMemberId: this.teamMemberId,
                teamMemberName: name,
                teamMemberType: type,
                registeredAt: new Date().toISOString(),
            },
        });
        if (memory) {
            // Send initial heartbeat
            await this.sendHeartbeat('active');
            return true;
        }
        return false;
    }
    /**
     * Get team member ID
     */
    getTeamMemberId() {
        return this.teamMemberId;
    }
    /**
     * Get underlying client
     */
    getClient() {
        return this.client;
    }
    // ==========================================================================
    // Typing Indicators (Team Member B addition)
    // ==========================================================================
    /**
     * Send a typing indicator to show this team member is composing a message
     * Typing indicators expire after 10 seconds by default
     * @param to - Target team member ID or 'all' for broadcast
     */
    async startTyping(to = 'all') {
        const tags = createMessageTags(this.teamMemberId, to, 'typing', {
            priority: 'low',
            expiresAt: new Date(Date.now() + TEAM_MEMBER_MESSAGING.TYPING_INDICATOR_EXPIRATION_MS),
        });
        const memory = await this.client.remember(`${this.teamMemberId} is typing...`, {
            memoryType: 'working',
            importance: 'low',
            tags,
            metadata: {
                teamMemberMessage: true,
                typingIndicator: true,
                from: this.teamMemberId,
                to,
                timestamp: new Date().toISOString(),
            },
        });
        return !!memory;
    }
    /**
     * Check which team members are currently typing
     * @param to - Filter by target (optional)
     * @returns List of team member IDs that are currently typing
     */
    async getTypingTeamMembers(to) {
        const memories = await this.client.find('typing indicator', {
            limit: 20,
            tags: ['team-member-message', 'type:typing'],
        });
        const typingTeamMembers = [];
        const now = new Date();
        for (const memory of memories) {
            const parsed = parseMessageTags(memory.tags || []);
            // Check if typing indicator is still valid (not expired)
            if (parsed.expiresAt && new Date(parsed.expiresAt) < now) {
                continue;
            }
            // Filter by target if specified
            if (to && parsed.to !== to && parsed.to !== 'all') {
                continue;
            }
            // Don't include self
            if (parsed.from && parsed.from !== this.teamMemberId) {
                typingTeamMembers.push(parsed.from);
            }
        }
        return Array.from(new Set(typingTeamMembers)); // Remove duplicates
    }
    // ==========================================================================
    // Read Receipts (Team Member B addition)
    // ==========================================================================
    /**
     * Mark a message as read by this team member
     * @param messageId - The ID of the message to mark as read
     */
    async markAsRead(messageId) {
        const tags = [
            'team-member-message',
            'read-receipt',
            `for:${messageId}`,
            `reader:${this.teamMemberId}`,
        ];
        const memory = await this.client.remember(`Message ${messageId} read by ${this.teamMemberId}`, {
            memoryType: 'working',
            importance: 'low',
            tags,
            metadata: {
                readReceipt: true,
                messageId,
                readBy: this.teamMemberId,
                readAt: new Date().toISOString(),
            },
        });
        return !!memory;
    }
    /**
     * Get list of teamMembers who have read a specific message
     * @param messageId - The ID of the message to check
     * @returns List of team member IDs that have read the message
     */
    async getReadReceipts(messageId) {
        const memories = await this.client.find(`read receipt ${messageId}`, {
            limit: 50,
            tags: ['read-receipt', `for:${messageId}`],
        });
        const readers = [];
        for (const memory of memories) {
            if (memory.metadata?.readBy) {
                readers.push(memory.metadata.readBy);
            }
            else {
                // Try to extract from tags
                for (const tag of memory.tags || []) {
                    if (tag.startsWith('reader:')) {
                        readers.push(tag.substring(7));
                    }
                }
            }
        }
        return Array.from(new Set(readers)); // Remove duplicates
    }
    /**
     * Mark all unread messages as read
     * @returns Number of messages marked as read
     */
    async markAllAsRead() {
        const messages = await this.getMessages();
        let count = 0;
        for (const msg of messages) {
            if (msg.messageId && (!msg.readBy || !msg.readBy.includes(this.teamMemberId))) {
                await this.markAsRead(msg.messageId);
                count++;
            }
        }
        return count;
    }
}
// ============================================================================
// Factory Functions
// ============================================================================
/**
 * Create a team member communicator
 */
export function createTeamMemberCommunicator(teamMemberId, client) {
    return new TeamMemberCommunicator(teamMemberId, client);
}
/**
 * Quick function to send a message (for testing)
 */
export async function sendTeamMemberMessage(from, message, to = 'all') {
    const communicator = createTeamMemberCommunicator(from);
    return communicator.say(message, to);
}
/**
 * Quick function to receive messages (for testing)
 */
export async function receiveTeamMemberMessages(teamMemberId) {
    const communicator = createTeamMemberCommunicator(teamMemberId);
    return communicator.listen();
}
// ============================================================================
// @Mention Parsing Utilities (Team Member 2 addition)
// ============================================================================
/**
 * Parse @mentions from message content
 * Matches @team-member-id patterns (lowercase alphanumeric with hyphens)
 * @param content - Message content to parse
 * @returns Array of mentioned team member IDs (without @ prefix)
 */
export function parseMentions(content) {
    const mentionRegex = /@([a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9])/gi;
    const matches = content.match(mentionRegex) || [];
    return [...new Set(matches.map(m => m.substring(1).toLowerCase()))];
}
/**
 * Check if a message mentions a specific team member
 * @param content - Message content
 * @param teamMemberId - TeamMember ID to check for
 * @returns True if the team member is mentioned
 */
export function isMentioned(content, teamMemberId) {
    const mentions = parseMentions(content);
    return mentions.includes(teamMemberId.toLowerCase());
}
/**
 * Highlight mentions in content (for display)
 * @param content - Message content
 * @returns Content with mentions wrapped in markers
 */
export function highlightMentions(content) {
    return content.replace(/@([a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9])/gi, '**@$1**');
}
/**
 * Create tags for a channel message
 * @param from - Sender team member ID
 * @param channelId - Channel ID
 * @param options - Message options including mentions
 */
export function createChannelMessageTags(from, channelId, options = {}) {
    const tags = [
        'channel-message',
        `channel:${channelId}`,
        `from:${from}`,
    ];
    // Add priority tag
    const priority = options.priority || 'medium';
    tags.push(`priority:${priority}`);
    // Add expiration tag
    const expiresAt = options.expiresAt || calculateExpiration();
    tags.push(`expires:${expiresAt.toISOString()}`);
    // Add mention tags for filtering
    if (options.mentions) {
        for (const mention of options.mentions) {
            tags.push(`mention:${mention}`);
        }
    }
    // Add reply tag for threading
    if (options.replyTo) {
        tags.push(`reply-to:${options.replyTo}`);
    }
    return tags;
}
/**
 * Parse channel message tags
 */
export function parseChannelMessageTags(tags) {
    const result = {
        isChannelMessage: false,
        mentions: [],
    };
    for (const tag of tags) {
        if (tag === 'channel-message') {
            result.isChannelMessage = true;
        }
        else if (tag.startsWith('channel:')) {
            result.channelId = tag.substring(8);
        }
        else if (tag.startsWith('from:')) {
            result.from = tag.substring(5);
        }
        else if (tag.startsWith('priority:')) {
            result.priority = tag.substring(9);
        }
        else if (tag.startsWith('mention:')) {
            result.mentions.push(tag.substring(8));
        }
        else if (tag.startsWith('reply-to:')) {
            result.replyTo = tag.substring(9);
        }
        else if (tag.startsWith('expires:')) {
            result.expiresAt = tag.substring(8);
        }
    }
    return result;
}
//# sourceMappingURL=communication.js.map