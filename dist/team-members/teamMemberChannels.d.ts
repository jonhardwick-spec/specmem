/**
 * Team Member Channels - Group Communication System
 *
 * Provides Slack-like channels for multi-team member communication.
 * Supports public/private/direct channels, @mentions, and message history.
 *
 * @status DRAFT - Awaiting team review
 */
import { SpecMemClient } from './workers/specmemClient.js';
export type ChannelType = 'public' | 'private' | 'direct';
export type MessagePriority = 'low' | 'medium' | 'high';
/**
 * Channel definition
 */
export interface Channel {
    id: string;
    name: string;
    description?: string;
    type: ChannelType;
    members: string[];
    admins: string[];
    createdBy: string;
    createdAt: Date;
    metadata?: Record<string, any>;
}
/**
 * Message sent to a channel
 */
export interface ChannelMessage {
    id?: string;
    channelId: string;
    from: string;
    content: string;
    mentions?: string[];
    replyTo?: string;
    priority: MessagePriority;
    timestamp: Date;
    reactions?: MessageReaction[];
    metadata?: Record<string, any>;
}
/**
 * Reaction to a message (emoji reactions)
 */
export interface MessageReaction {
    emoji: string;
    teamMemberId: string;
    timestamp: Date;
}
/**
 * Options for creating a channel
 */
export interface CreateChannelOptions {
    description?: string;
    type?: ChannelType;
    maxMembers?: number;
    metadata?: Record<string, any>;
}
/**
 * Options for sending messages
 */
export interface SendMessageOptions {
    priority?: MessagePriority;
    replyTo?: string;
    metadata?: Record<string, any>;
}
/**
 * Options for getting messages
 */
export interface GetMessagesOptions {
    limit?: number;
    since?: Date;
    before?: Date;
    includeThreads?: boolean;
}
/** Maximum members per channel (configurable) */
export declare const DEFAULT_MAX_MEMBERS = 100;
/** Default message fetch limit */
export declare const DEFAULT_MESSAGE_LIMIT = 50;
/** Channel name validation regex */
export declare const CHANNEL_NAME_REGEX: RegExp;
/**
 * Manages team member channels and channel messaging
 */
export declare class TeamMemberChannelManager {
    private client;
    private teamMemberId;
    constructor(teamMemberId: string, client?: SpecMemClient);
    /**
     * Create a new channel
     * @param name - Channel name (lowercase, alphanumeric with hyphens)
     * @param options - Channel creation options
     * @returns Created channel or null if failed
     */
    createChannel(name: string, options?: CreateChannelOptions): Promise<Channel | null>;
    /**
     * Delete a channel (only admins can delete)
     * @param channelId - Channel ID to delete
     */
    deleteChannel(channelId: string): Promise<boolean>;
    /**
     * Get channel by ID
     */
    getChannel(channelId: string): Promise<Channel | null>;
    /**
     * Get channel by name
     */
    getChannelByName(name: string): Promise<Channel | null>;
    /**
     * List all channels (optionally filter by type)
     */
    listChannels(type?: ChannelType): Promise<Channel[]>;
    /**
     * Join a channel
     */
    joinChannel(channelId: string): Promise<boolean>;
    /**
     * Leave a channel
     */
    leaveChannel(channelId: string): Promise<boolean>;
    /**
     * Get list of channel members
     */
    getChannelMembers(channelId: string): Promise<string[]>;
    /**
     * Invite a team member to a private channel (admin only)
     */
    inviteToChannel(channelId: string, teamMemberId: string): Promise<boolean>;
    /**
     * Send a message to a channel
     */
    sendToChannel(channelId: string, content: string, options?: SendMessageOptions): Promise<ChannelMessage | null>;
    /**
     * Get messages from a channel
     */
    getChannelMessages(channelId: string, options?: GetMessagesOptions): Promise<ChannelMessage[]>;
    /**
     * Get messages where this team member is mentioned
     */
    getMentions(limit?: number): Promise<ChannelMessage[]>;
    /**
     * Get thread replies for a message
     */
    getThreadReplies(messageId: string): Promise<ChannelMessage[]>;
    /**
     * Add a reaction to a message
     */
    addReaction(messageId: string, emoji: string): Promise<boolean>;
    /**
     * Get reactions for a message
     */
    getReactions(messageId: string): Promise<MessageReaction[]>;
    /**
     * Create or get a DM channel between two team members
     */
    getOrCreateDM(otherTeamMemberId: string): Promise<Channel | null>;
    /**
     * Send a direct message to another team member
     */
    sendDM(toTeamMemberId: string, content: string, options?: SendMessageOptions): Promise<ChannelMessage | null>;
    /**
     * Parse @mentions from message content
     * Matches @team-member-id patterns
     */
    parseMentions(content: string): string[];
    /**
     * Get team member ID
     */
    getTeamMemberId(): string;
    /**
     * Get underlying client
     */
    getClient(): SpecMemClient;
}
/**
 * ChannelSnapshot - Dashboard-friendly view of a channel
 * This matches the interface expected by Team Member 3's TeamMemberDashboard
 */
export interface ChannelSnapshot {
    id: string;
    name: string;
    memberCount: number;
    messageCount: number;
    lastActivity: Date;
    isActive: boolean;
}
/**
 * ChannelActivityStats - Activity statistics for a channel
 */
export interface ChannelActivityStats {
    messagesLastHour: number;
    messagesLastDay: number;
    activeMembers: number;
}
/**
 * ChannelIntegration - Interface for dashboard integration
 * Team Member 3's dashboard uses this to display channel activity
 */
export interface ChannelIntegration {
    getChannelSnapshots(): Promise<ChannelSnapshot[]>;
    getChannelActivity(channelId: string): Promise<ChannelActivityStats>;
    onMessageSent(callback: (channelId: string, from: string) => void): void;
    onChannelCreated(callback: (channel: ChannelSnapshot) => void): void;
}
/**
 * Get channel snapshot for dashboard
 * Converts Channel to ChannelSnapshot format
 */
export declare function getChannelSnapshot(manager: TeamMemberChannelManager, channel: Channel): Promise<ChannelSnapshot>;
/**
 * Get activity stats for a channel
 */
export declare function getChannelActivityStats(manager: TeamMemberChannelManager, channelId: string): Promise<ChannelActivityStats>;
/**
 * Create a team member channel manager
 */
export declare function createTeamMemberChannelManager(teamMemberId: string, client?: SpecMemClient): TeamMemberChannelManager;
//# sourceMappingURL=teamMemberChannels.d.ts.map