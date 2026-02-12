/**
 * Team Member Channels - Group Communication System
 *
 * Provides Slack-like channels for multi-team member communication.
 * Supports public/private/direct channels, @mentions, and message history.
 *
 * @status DRAFT - Awaiting team review
 */
import { createSpecMemClient } from './workers/specmemClient.js';
// ============================================================================
// Constants
// ============================================================================
/** Maximum members per channel (configurable) */
export const DEFAULT_MAX_MEMBERS = 100;
/** Default message fetch limit */
export const DEFAULT_MESSAGE_LIMIT = 50;
/** Channel name validation regex */
export const CHANNEL_NAME_REGEX = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$|^[a-z0-9]$/;
// ============================================================================
// TeamMemberChannelManager Class
// ============================================================================
/**
 * Manages team member channels and channel messaging
 */
export class TeamMemberChannelManager {
    client;
    teamMemberId;
    constructor(teamMemberId, client) {
        this.teamMemberId = teamMemberId;
        this.client = client || createSpecMemClient({ teamMemberId });
    }
    // ==========================================================================
    // Channel Management
    // ==========================================================================
    /**
     * Create a new channel
     * @param name - Channel name (lowercase, alphanumeric with hyphens)
     * @param options - Channel creation options
     * @returns Created channel or null if failed
     */
    async createChannel(name, options = {}) {
        // Validate channel name
        if (!CHANNEL_NAME_REGEX.test(name)) {
            console.error(`[TeamMemberChannels] Nah bruh that channel name "${name}" is wack. Make it lowercase letters/numbers/hyphens, 1-50 chars.`);
            return null;
        }
        // Check for duplicate channel name
        const existing = await this.getChannelByName(name);
        if (existing) {
            console.error(`[TeamMemberChannels] Channel "${name}" already exists.`);
            return null;
        }
        const channelId = `channel-${name}-${Date.now()}`;
        const channelType = options.type || 'public';
        const channel = {
            id: channelId,
            name,
            description: options.description,
            type: channelType,
            members: [this.teamMemberId], // Creator is automatically a member
            admins: [this.teamMemberId], // Creator is automatically an admin
            createdBy: this.teamMemberId,
            createdAt: new Date(),
            metadata: {
                ...options.metadata,
                maxMembers: options.maxMembers || DEFAULT_MAX_MEMBERS,
            },
        };
        // Store channel in SpecMem
        const tags = [
            'team-member-channel',
            `channel:${channelId}`,
            `name:${name}`,
            `type:${channelType}`,
            `creator:${this.teamMemberId}`,
        ];
        const memory = await this.client.remember(JSON.stringify(channel), {
            memoryType: 'episodic',
            importance: 'high',
            tags,
            metadata: {
                channelData: channel,
                timestamp: new Date().toISOString(),
            },
        });
        if (memory) {
            console.log(`[TeamMemberChannels] Channel "${name}" is live fr fr (ID: ${channelId})`);
            return channel;
        }
        console.error(`[TeamMemberChannels] Channel "${name}" ain't happening lmao`);
        return null;
    }
    /**
     * Delete a channel (only admins can delete)
     * @param channelId - Channel ID to delete
     */
    async deleteChannel(channelId) {
        const channel = await this.getChannel(channelId);
        if (!channel) {
            console.error(`[TeamMemberChannels] Channel not found: ${channelId}`);
            return false;
        }
        // Check admin permissions
        if (!channel.admins.includes(this.teamMemberId)) {
            console.error(`[TeamMemberChannels] Permission denied: ${this.teamMemberId} is not an admin of ${channelId}`);
            return false;
        }
        // Mark channel as deleted (store deletion record)
        const tags = [
            'team-member-channel',
            'channel-deleted',
            `channel:${channelId}`,
        ];
        const memory = await this.client.remember(`Channel ${channelId} deleted by ${this.teamMemberId}`, {
            memoryType: 'episodic',
            importance: 'medium',
            tags,
            metadata: {
                channelId,
                deletedBy: this.teamMemberId,
                deletedAt: new Date().toISOString(),
            },
        });
        if (memory) {
            console.log(`[TeamMemberChannels] Channel ${channelId} deleted`);
            return true;
        }
        return false;
    }
    /**
     * Get channel by ID
     */
    async getChannel(channelId) {
        const memories = await this.client.find(`channel ${channelId}`, {
            limit: 10,
            tags: ['team-member-channel', `channel:${channelId}`],
        });
        // Find the most recent non-deleted channel data
        for (const memory of memories) {
            if (memory.tags?.includes('channel-deleted')) {
                return null; // Channel was deleted
            }
            if (memory.metadata?.channelData) {
                const channel = memory.metadata.channelData;
                channel.createdAt = new Date(channel.createdAt);
                return channel;
            }
            // Try to parse from content
            try {
                const channel = JSON.parse(memory.content);
                channel.createdAt = new Date(channel.createdAt);
                return channel;
            }
            catch {
                continue;
            }
        }
        return null;
    }
    /**
     * Get channel by name
     */
    async getChannelByName(name) {
        const memories = await this.client.find(`channel name ${name}`, {
            limit: 10,
            tags: ['team-member-channel', `name:${name}`],
        });
        for (const memory of memories) {
            if (memory.tags?.includes('channel-deleted')) {
                continue;
            }
            if (memory.metadata?.channelData) {
                const channel = memory.metadata.channelData;
                channel.createdAt = new Date(channel.createdAt);
                return channel;
            }
        }
        return null;
    }
    /**
     * List all channels (optionally filter by type)
     */
    async listChannels(type) {
        const tags = type
            ? ['team-member-channel', `type:${type}`]
            : ['team-member-channel'];
        const memories = await this.client.find('list channels', {
            limit: 100,
            tags,
        });
        const channels = [];
        const seenIds = new Set();
        for (const memory of memories) {
            if (memory.tags?.includes('channel-deleted')) {
                // Track deleted channel IDs
                const channelTag = memory.tags.find(t => t.startsWith('channel:'));
                if (channelTag) {
                    seenIds.add(channelTag.substring(8));
                }
                continue;
            }
            if (memory.metadata?.channelData) {
                const channel = memory.metadata.channelData;
                if (!seenIds.has(channel.id)) {
                    channel.createdAt = new Date(channel.createdAt);
                    channels.push(channel);
                    seenIds.add(channel.id);
                }
            }
        }
        return channels;
    }
    // ==========================================================================
    // Channel Membership
    // ==========================================================================
    /**
     * Join a channel
     */
    async joinChannel(channelId) {
        const channel = await this.getChannel(channelId);
        if (!channel) {
            console.error(`[TeamMemberChannels] Channel not found: ${channelId}`);
            return false;
        }
        // Check if already a member
        if (channel.members.includes(this.teamMemberId)) {
            console.log(`[TeamMemberChannels] ${this.teamMemberId} is already a member of ${channelId}`);
            return true;
        }
        // Check channel type permissions
        if (channel.type === 'private' && !channel.admins.includes(this.teamMemberId)) {
            console.error(`[TeamMemberChannels] Cannot join private channel without invite`);
            return false;
        }
        // Check member limit
        const maxMembers = channel.metadata?.maxMembers || DEFAULT_MAX_MEMBERS;
        if (channel.members.length >= maxMembers) {
            console.error(`[TeamMemberChannels] Channel ${channelId} has reached max members (${maxMembers})`);
            return false;
        }
        // HIGH-14 FIX: Update the channel object with new member, not just create membership memory
        // Previously only created a membership memory but didn't update Channel.members array
        // Add member to channel
        channel.members.push(this.teamMemberId);
        // Persist updated channel data
        const channelTags = [
            'team-member-channel',
            `channel:${channelId}`,
            `name:${channel.name}`,
            `type:${channel.type}`,
            `creator:${channel.createdBy}`,
        ];
        const channelMemory = await this.client.remember(JSON.stringify(channel), {
            memoryType: 'episodic',
            importance: 'high',
            tags: channelTags,
            metadata: {
                channelData: channel,
                timestamp: new Date().toISOString(),
            },
        });
        if (!channelMemory) {
            console.error(`[TeamMemberChannels] Failed to update channel ${channelId} with new member`);
            return false;
        }
        // Also store membership event for audit trail
        const membershipTags = [
            'channel-membership',
            `channel:${channelId}`,
            `teamMember:${this.teamMemberId}`,
            'action:join',
        ];
        await this.client.remember(`${this.teamMemberId} joined channel ${channelId}`, {
            memoryType: 'episodic',
            importance: 'medium',
            tags: membershipTags,
            metadata: {
                channelId,
                teamMemberId: this.teamMemberId,
                action: 'join',
                timestamp: new Date().toISOString(),
            },
        });
        console.log(`[TeamMemberChannels] ${this.teamMemberId} joined channel ${channelId}`);
        return true;
    }
    /**
     * Leave a channel
     */
    async leaveChannel(channelId) {
        const channel = await this.getChannel(channelId);
        if (!channel) {
            console.error(`[TeamMemberChannels] Channel not found: ${channelId}`);
            return false;
        }
        if (!channel.members.includes(this.teamMemberId)) {
            console.log(`[TeamMemberChannels] ${this.teamMemberId} is not a member of ${channelId}`);
            return true;
        }
        // Store membership update
        const tags = [
            'channel-membership',
            `channel:${channelId}`,
            `teamMember:${this.teamMemberId}`,
            'action:leave',
        ];
        const memory = await this.client.remember(`${this.teamMemberId} left channel ${channelId}`, {
            memoryType: 'episodic',
            importance: 'medium',
            tags,
            metadata: {
                channelId,
                teamMemberId: this.teamMemberId,
                action: 'leave',
                timestamp: new Date().toISOString(),
            },
        });
        if (memory) {
            console.log(`[TeamMemberChannels] ${this.teamMemberId} left channel ${channelId}`);
            return true;
        }
        return false;
    }
    /**
     * Get list of channel members
     */
    async getChannelMembers(channelId) {
        const channel = await this.getChannel(channelId);
        if (!channel) {
            return [];
        }
        // Get membership updates
        const memories = await this.client.find(`channel membership ${channelId}`, {
            limit: 200,
            tags: ['channel-membership', `channel:${channelId}`],
        });
        // Build current member list
        const members = new Set(channel.members);
        // Process membership changes in order
        const sortedMemories = memories.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        for (const memory of sortedMemories) {
            const teamMemberId = memory.metadata?.teamMemberId;
            const action = memory.metadata?.action;
            if (teamMemberId && action) {
                if (action === 'join') {
                    members.add(teamMemberId);
                }
                else if (action === 'leave') {
                    members.delete(teamMemberId);
                }
            }
        }
        return Array.from(members);
    }
    /**
     * Invite a team member to a private channel (admin only)
     */
    async inviteToChannel(channelId, teamMemberId) {
        const channel = await this.getChannel(channelId);
        if (!channel) {
            console.error(`[TeamMemberChannels] Channel not found: ${channelId}`);
            return false;
        }
        if (!channel.admins.includes(this.teamMemberId)) {
            console.error(`[TeamMemberChannels] Permission denied: only admins can invite`);
            return false;
        }
        const tags = [
            'channel-invite',
            `channel:${channelId}`,
            `invitee:${teamMemberId}`,
            `inviter:${this.teamMemberId}`,
        ];
        const memory = await this.client.remember(`${this.teamMemberId} invited ${teamMemberId} to ${channelId}`, {
            memoryType: 'episodic',
            importance: 'medium',
            tags,
            metadata: {
                channelId,
                invitee: teamMemberId,
                inviter: this.teamMemberId,
                timestamp: new Date().toISOString(),
            },
        });
        if (memory) {
            console.log(`[TeamMemberChannels] ${teamMemberId} invited to channel ${channelId}`);
            return true;
        }
        return false;
    }
    // ==========================================================================
    // Channel Messaging
    // ==========================================================================
    /**
     * Send a message to a channel
     */
    async sendToChannel(channelId, content, options = {}) {
        const members = await this.getChannelMembers(channelId);
        if (!members.includes(this.teamMemberId)) {
            console.error(`[TeamMemberChannels] Cannot send to channel: not a member of ${channelId}`);
            return null;
        }
        // Parse @mentions from content
        const mentions = this.parseMentions(content);
        const message = {
            channelId,
            from: this.teamMemberId,
            content,
            mentions,
            replyTo: options.replyTo,
            priority: options.priority || 'medium',
            timestamp: new Date(),
            metadata: options.metadata,
        };
        const tags = [
            'channel-message',
            `channel:${channelId}`,
            `from:${this.teamMemberId}`,
            `priority:${message.priority}`,
        ];
        // Add mention tags for filtering
        for (const mention of mentions) {
            tags.push(`mention:${mention}`);
        }
        // Add reply tag if threading
        if (options.replyTo) {
            tags.push(`reply-to:${options.replyTo}`);
        }
        const memory = await this.client.remember(content, {
            memoryType: 'episodic',
            importance: message.priority,
            tags,
            metadata: {
                channelMessage: message,
                timestamp: new Date().toISOString(),
            },
        });
        if (memory) {
            message.id = memory.id;
            console.log(`[TeamMemberChannels] Message sent to ${channelId} (ID: ${memory.id})`);
            return message;
        }
        console.error(`[TeamMemberChannels] Message to ${channelId} didn't send, shit broke`);
        return null;
    }
    /**
     * Get messages from a channel
     */
    async getChannelMessages(channelId, options = {}) {
        const limit = options.limit || DEFAULT_MESSAGE_LIMIT;
        const memories = await this.client.find(`channel messages ${channelId}`, {
            limit,
            tags: ['channel-message', `channel:${channelId}`],
        });
        const messages = [];
        for (const memory of memories) {
            if (memory.metadata?.channelMessage) {
                const msg = memory.metadata.channelMessage;
                msg.id = memory.id;
                msg.timestamp = new Date(msg.timestamp);
                // Apply date filters
                if (options.since && msg.timestamp <= options.since)
                    continue;
                if (options.before && msg.timestamp >= options.before)
                    continue;
                // Skip thread replies if not requested
                if (!options.includeThreads && msg.replyTo)
                    continue;
                messages.push(msg);
            }
        }
        // Sort by timestamp (newest first)
        return messages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }
    /**
     * Get messages where this team member is mentioned
     */
    async getMentions(limit = 20) {
        const memories = await this.client.find(`mentions ${this.teamMemberId}`, {
            limit,
            tags: ['channel-message', `mention:${this.teamMemberId}`],
        });
        const messages = [];
        for (const memory of memories) {
            if (memory.metadata?.channelMessage) {
                const msg = memory.metadata.channelMessage;
                msg.id = memory.id;
                msg.timestamp = new Date(msg.timestamp);
                messages.push(msg);
            }
        }
        return messages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }
    /**
     * Get thread replies for a message
     */
    async getThreadReplies(messageId) {
        const memories = await this.client.find(`thread ${messageId}`, {
            limit: 100,
            tags: ['channel-message', `reply-to:${messageId}`],
        });
        const replies = [];
        for (const memory of memories) {
            if (memory.metadata?.channelMessage) {
                const msg = memory.metadata.channelMessage;
                msg.id = memory.id;
                msg.timestamp = new Date(msg.timestamp);
                replies.push(msg);
            }
        }
        return replies.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    }
    // ==========================================================================
    // Reactions
    // ==========================================================================
    /**
     * Add a reaction to a message
     */
    async addReaction(messageId, emoji) {
        const tags = [
            'message-reaction',
            `message:${messageId}`,
            `emoji:${emoji}`,
            `teamMember:${this.teamMemberId}`,
        ];
        const memory = await this.client.remember(`${this.teamMemberId} reacted with ${emoji} to ${messageId}`, {
            memoryType: 'working',
            importance: 'low',
            tags,
            metadata: {
                messageId,
                emoji,
                teamMemberId: this.teamMemberId,
                timestamp: new Date().toISOString(),
            },
        });
        return !!memory;
    }
    /**
     * Get reactions for a message
     */
    async getReactions(messageId) {
        const memories = await this.client.find(`reactions ${messageId}`, {
            limit: 100,
            tags: ['message-reaction', `message:${messageId}`],
        });
        const reactions = [];
        for (const memory of memories) {
            if (memory.metadata?.emoji && memory.metadata?.teamMemberId) {
                reactions.push({
                    emoji: memory.metadata.emoji,
                    teamMemberId: memory.metadata.teamMemberId,
                    timestamp: new Date(memory.created_at),
                });
            }
        }
        return reactions;
    }
    // ==========================================================================
    // Direct Messages (DMs)
    // ==========================================================================
    /**
     * Create or get a DM channel between two team members
     */
    async getOrCreateDM(otherTeamMemberId) {
        // DM channel name is sorted team member IDs to ensure consistency
        const teamMembers = [this.teamMemberId, otherTeamMemberId].sort();
        const dmName = `dm-${teamMembers.join('-')}`;
        // Check if DM already exists
        let dm = await this.getChannelByName(dmName);
        if (dm) {
            return dm;
        }
        // Create new DM channel
        dm = await this.createChannel(dmName, {
            type: 'direct',
            description: `Direct messages between ${teamMembers[0]} and ${teamMembers[1]}`,
            maxMembers: 2,
        });
        // Add the other team member to the DM
        if (dm) {
            const tags = [
                'channel-membership',
                `channel:${dm.id}`,
                `teamMember:${otherTeamMemberId}`,
                'action:join',
            ];
            await this.client.remember(`${otherTeamMemberId} added to DM ${dm.id}`, {
                memoryType: 'episodic',
                importance: 'medium',
                tags,
                metadata: {
                    channelId: dm.id,
                    teamMemberId: otherTeamMemberId,
                    action: 'join',
                    timestamp: new Date().toISOString(),
                },
            });
        }
        return dm;
    }
    /**
     * Send a direct message to another team member
     */
    async sendDM(toTeamMemberId, content, options = {}) {
        const dm = await this.getOrCreateDM(toTeamMemberId);
        if (!dm) {
            console.error(`[TeamMemberChannels] Couldn't get DM going with ${toTeamMemberId}, rip`);
            return null;
        }
        return this.sendToChannel(dm.id, content, options);
    }
    // ==========================================================================
    // Utilities
    // ==========================================================================
    /**
     * Parse @mentions from message content
     * Matches @team-member-id patterns
     */
    parseMentions(content) {
        const mentionRegex = /@([a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9])/gi;
        const matches = content.match(mentionRegex) || [];
        return [...new Set(matches.map(m => m.substring(1).toLowerCase()))];
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
}
/**
 * Get channel snapshot for dashboard
 * Converts Channel to ChannelSnapshot format
 */
export async function getChannelSnapshot(manager, channel) {
    const members = await manager.getChannelMembers(channel.id);
    const messages = await manager.getChannelMessages(channel.id, { limit: 100 });
    const lastMessage = messages[0];
    const isActive = lastMessage
        ? (Date.now() - lastMessage.timestamp.getTime()) < 5 * 60 * 1000 // Active if message in last 5 mins
        : false;
    return {
        id: channel.id,
        name: channel.name,
        memberCount: members.length,
        messageCount: messages.length,
        lastActivity: lastMessage?.timestamp || channel.createdAt,
        isActive,
    };
}
/**
 * Get activity stats for a channel
 */
export async function getChannelActivityStats(manager, channelId) {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const allMessages = await manager.getChannelMessages(channelId, { limit: 500 });
    const messagesLastHour = allMessages.filter(m => m.timestamp >= oneHourAgo).length;
    const messagesLastDay = allMessages.filter(m => m.timestamp >= oneDayAgo).length;
    // Count unique senders in last day as active members
    const activeSenders = new Set(allMessages
        .filter(m => m.timestamp >= oneDayAgo)
        .map(m => m.from));
    return {
        messagesLastHour,
        messagesLastDay,
        activeMembers: activeSenders.size,
    };
}
// ============================================================================
// Factory Functions
// ============================================================================
/**
 * Create a team member channel manager
 */
export function createTeamMemberChannelManager(teamMemberId, client) {
    return new TeamMemberChannelManager(teamMemberId, client);
}
//# sourceMappingURL=teamMemberChannels.js.map