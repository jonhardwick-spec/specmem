/**
 * Team Member Communication Protocol
 *
 * Defines the message format and communication methods for AI team members
 * to communicate with each other via SpecMem.
 *
 * Messages are stored as memories with special tags for routing.
 */
import { SpecMemClient, Memory } from './workers/specmemClient.js';
export type MessageType = 'broadcast' | 'direct' | 'status' | 'heartbeat' | 'typing' | 'read-receipt';
export type MessagePriority = 'low' | 'medium' | 'high';
export declare const DEFAULT_MESSAGE_EXPIRATION_MS: number;
/**
 * Calculate expiration time for a message
 * @param customMs - Custom expiration time in milliseconds (optional)
 * @returns Date object representing when the message expires
 */
export declare function calculateExpiration(customMs?: number): Date;
export interface TeamMemberMessage {
    from: string;
    to: string | 'all';
    content: string;
    timestamp: Date;
    messageType: MessageType;
    messageId?: string;
    expiresAt?: Date;
    priority?: MessagePriority;
    readBy?: string[];
}
export interface TeamMemberInfo {
    teamMemberId: string;
    teamMemberName?: string;
    teamMemberType?: string;
    status: 'active' | 'idle' | 'busy';
    lastHeartbeat: Date;
}
export interface ParsedMessageTags {
    isTeamMemberMessage: boolean;
    from?: string;
    to?: string;
    messageType?: MessageType;
    priority?: MessagePriority;
    expiresAt?: string;
}
export interface CreateMessageTagsOptions {
    priority?: MessagePriority;
    expiresAt?: Date;
}
/**
 * Create tags for a team member message
 * @param from - Sender team member ID
 * @param to - Target team member ID or 'all' for broadcast
 * @param messageType - Type of message
 * @param options - Optional priority and expiration settings
 */
export declare function createMessageTags(from: string, to: string | 'all', messageType: MessageType, options?: CreateMessageTagsOptions): string[];
/**
 * Parse tags from a memory to extract message info
 */
export declare function parseMessageTags(tags: string[]): ParsedMessageTags;
/**
 * Check if a message has expired
 */
export declare function isMessageExpired(expiresAt?: Date | string): boolean;
/**
 * Convert memory to team member message
 */
export declare function memoryToMessage(memory: Memory): TeamMemberMessage | null;
export interface SayOptions {
    priority?: MessagePriority;
    expiresInMs?: number;
}
export interface GetMessagesOptions {
    includeExpired?: boolean;
    sortByPriority?: boolean;
}
export declare class TeamMemberCommunicator {
    private client;
    private teamMemberId;
    private lastMessageCheck;
    private cleanupInterval;
    private static readonly CLEANUP_INTERVAL_MS;
    constructor(teamMemberId: string, client?: SpecMemClient);
    /**
     * MED-10 FIX: Periodic cleanup job for expired messages
     * Runs every 5 minutes to remove expired messages from storage
     * This prevents unbounded growth of expired messages in the database
     */
    private startExpirationCleanup;
    /**
     * MED-10 FIX: Clean up expired messages from storage
     * Deletes messages that have passed their expiration time
     */
    private cleanupExpiredMessages;
    /**
     * Stop the cleanup interval (call when communicator is destroyed)
     */
    stopCleanup(): void;
    /**
     * Send a message to another team member or broadcast to all
     * @param message - The message content
     * @param to - Target team member ID or 'all' for broadcast (default: 'all')
     * @param options - Optional priority and expiration settings
     */
    say(message: string, to?: string, options?: SayOptions): Promise<boolean>;
    /**
     * Broadcast a status update to all team members
     */
    broadcastStatus(status: string): Promise<boolean>;
    /**
     * Get messages for this team member (both direct and broadcasts)
     * @param since - Only get messages since this date
     * @param options - Options for filtering and sorting
     */
    getMessages(since?: Date, options?: GetMessagesOptions): Promise<TeamMemberMessage[]>;
    /**
     * Listen for messages (shorthand for getMessages with no time filter)
     */
    listen(): Promise<TeamMemberMessage[]>;
    /**
     * Send heartbeat to indicate team member is active
     * Deletes previous heartbeat to prevent duplicate spam
     */
    sendHeartbeat(status?: 'active' | 'idle' | 'busy'): Promise<boolean>;
    /**
     * Get list of active team members (those with recent heartbeats)
     */
    getActiveTeamMembers(withinSeconds?: number): Promise<TeamMemberInfo[]>;
    /**
     * Register this team member as active
     */
    registerTeamMember(name?: string, type?: string): Promise<boolean>;
    /**
     * Get team member ID
     */
    getTeamMemberId(): string;
    /**
     * Get underlying client
     */
    getClient(): SpecMemClient;
    /**
     * Send a typing indicator to show this team member is composing a message
     * Typing indicators expire after 10 seconds by default
     * @param to - Target team member ID or 'all' for broadcast
     */
    startTyping(to?: string): Promise<boolean>;
    /**
     * Check which team members are currently typing
     * @param to - Filter by target (optional)
     * @returns List of team member IDs that are currently typing
     */
    getTypingTeamMembers(to?: string): Promise<string[]>;
    /**
     * Mark a message as read by this team member
     * @param messageId - The ID of the message to mark as read
     */
    markAsRead(messageId: string): Promise<boolean>;
    /**
     * Get list of teamMembers who have read a specific message
     * @param messageId - The ID of the message to check
     * @returns List of team member IDs that have read the message
     */
    getReadReceipts(messageId: string): Promise<string[]>;
    /**
     * Mark all unread messages as read
     * @returns Number of messages marked as read
     */
    markAllAsRead(): Promise<number>;
}
/**
 * Create a team member communicator
 */
export declare function createTeamMemberCommunicator(teamMemberId: string, client?: SpecMemClient): TeamMemberCommunicator;
/**
 * Quick function to send a message (for testing)
 */
export declare function sendTeamMemberMessage(from: string, message: string, to?: string): Promise<boolean>;
/**
 * Quick function to receive messages (for testing)
 */
export declare function receiveTeamMemberMessages(teamMemberId: string): Promise<TeamMemberMessage[]>;
/**
 * Parse @mentions from message content
 * Matches @team-member-id patterns (lowercase alphanumeric with hyphens)
 * @param content - Message content to parse
 * @returns Array of mentioned team member IDs (without @ prefix)
 */
export declare function parseMentions(content: string): string[];
/**
 * Check if a message mentions a specific team member
 * @param content - Message content
 * @param teamMemberId - TeamMember ID to check for
 * @returns True if the team member is mentioned
 */
export declare function isMentioned(content: string, teamMemberId: string): boolean;
/**
 * Highlight mentions in content (for display)
 * @param content - Message content
 * @returns Content with mentions wrapped in markers
 */
export declare function highlightMentions(content: string): string;
/**
 * Extended message type that includes channel info
 */
export interface ChannelAwareMessage extends TeamMemberMessage {
    channelId?: string;
    mentions?: string[];
    replyTo?: string;
}
/**
 * Extended message tags options with channel support
 */
export interface ExtendedMessageTagsOptions extends CreateMessageTagsOptions {
    channelId?: string;
    mentions?: string[];
    replyTo?: string;
}
/**
 * Create tags for a channel message
 * @param from - Sender team member ID
 * @param channelId - Channel ID
 * @param options - Message options including mentions
 */
export declare function createChannelMessageTags(from: string, channelId: string, options?: ExtendedMessageTagsOptions): string[];
/**
 * Parse channel message tags
 */
export declare function parseChannelMessageTags(tags: string[]): {
    isChannelMessage: boolean;
    channelId?: string;
    from?: string;
    priority?: MessagePriority;
    mentions?: string[];
    replyTo?: string;
    expiresAt?: string;
};
//# sourceMappingURL=communication.d.ts.map