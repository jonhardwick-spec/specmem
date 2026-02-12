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
import type { DatabaseManager } from '../database.js';
export interface TeamChannel {
    id: string;
    name: string;
    taskId: string | null;
    projectPath: string | null;
    createdAt: Date;
    archivedAt: Date | null;
}
export type MessageType = 'message' | 'status' | 'code_review' | 'help_request';
export interface TeamMessage {
    id: string;
    channelId: string;
    senderId: string;
    senderName: string | null;
    messageType: MessageType;
    content: string;
    metadata: Record<string, unknown>;
    threadId: string | null;
    createdAt: Date;
    readBy: string[];
}
export type ClaimStatus = 'in_progress' | 'completed' | 'abandoned';
export interface TaskClaim {
    id: string;
    channelId: string;
    teamMemberId: string;
    taskDescription: string;
    filePaths: string[];
    status: ClaimStatus;
    claimedAt: Date;
    completedAt: Date | null;
}
export interface FileConflict {
    claimId: string;
    memberId: string;
    conflictingFiles: string[];
}
export declare class TeamCommsDbService {
    private db;
    constructor(db: DatabaseManager);
    /**
     * Initialize team communication tables.
     * Call this during database setup.
     */
    initialize(): Promise<void>;
    /**
     * Create a new team communication channel.
     *
     * @param taskId - Optional ID of the spawned task this channel is for
     * @param projectPath - Optional path to the project being worked on
     * @param name - Optional channel name (defaults to task ID or "team-channel")
     * @returns The created channel
     */
    createChannel(taskId?: string, projectPath?: string, name?: string): Promise<TeamChannel>;
    /**
     * Get a channel by ID.
     */
    getChannel(channelId: string): Promise<TeamChannel | null>;
    /**
     * Get a channel by task ID.
     */
    getChannelByTaskId(taskId: string): Promise<TeamChannel | null>;
    /**
     * Archive a channel (soft delete).
     */
    archiveChannel(channelId: string): Promise<void>;
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
    sendMessage(channelId: string, senderId: string, content: string, type?: MessageType, options?: {
        senderName?: string;
        metadata?: Record<string, unknown>;
        threadId?: string;
    }): Promise<TeamMessage>;
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
    getMessages(channelId: string, since?: Date, limit?: number, options?: {
        includeGlobalBroadcasts?: boolean;
    }): Promise<TeamMessage[]>;
    /**
     * Get thread replies for a message.
     */
    getThreadReplies(threadId: string, limit?: number): Promise<TeamMessage[]>;
    /**
     * Mark a message as read by a teamMember.
     *
     * @param messageId - Message to mark
     * @param memberId - Team member who read it
     */
    markAsRead(messageId: string, memberId: string): Promise<void>;
    /**
     * Mark all messages in a channel as read by a teamMember.
     */
    markAllAsRead(channelId: string, memberId: string): Promise<number>;
    /**
     * Get unread message count for a member in a channel.
     */
    getUnreadCount(channelId: string, memberId: string): Promise<number>;
    /**
     * Claim a task (announce what you're working on).
     *
     * @param channelId - Channel to claim in
     * @param memberId - Team member making the claim
     * @param description - Description of the task
     * @param files - Files being worked on
     * @returns The created claim, or null if files conflict with existing claims
     */
    claimTask(channelId: string, memberId: string, description: string, files?: string[]): Promise<{
        claim: TaskClaim;
        conflicts: FileConflict[];
    }>;
    /**
     * Release a task claim (mark as completed or abandoned).
     *
     * @param claimId - Claim to release
     * @param status - New status (completed or abandoned)
     */
    releaseClaim(claimId: string, status?: 'completed' | 'abandoned'): Promise<void>;
    /**
     * Get active claims for a channel.
     */
    getActiveClaims(channelId: string): Promise<TaskClaim[]>;
    /**
     * Get all claims for a teamMember.
     */
    getMemberClaims(memberId: string, activeOnly?: boolean): Promise<TaskClaim[]>;
    /**
     * Check if any active claims conflict with given file paths.
     */
    checkFileConflicts(channelId: string, filePaths: string[], excludeMemberId?: string): Promise<FileConflict[]>;
    /**
     * Send a status update message.
     */
    sendStatus(channelId: string, senderId: string, status: string, senderName?: string): Promise<TeamMessage>;
    /**
     * Request code review.
     */
    requestCodeReview(channelId: string, senderId: string, description: string, files: string[], senderName?: string): Promise<TeamMessage>;
    /**
     * Request help from team.
     */
    requestHelp(channelId: string, senderId: string, question: string, context?: Record<string, unknown>, senderName?: string): Promise<TeamMessage>;
    /**
     * Get channel summary (messages, claims, activity).
     */
    getChannelSummary(channelId: string): Promise<{
        channel: TeamChannel | null;
        recentMessages: TeamMessage[];
        activeClaims: TaskClaim[];
        memberCount: number;
    }>;
}
/**
 * Get the TeamCommsDbService for the current project.
 * Lazily initializes on first call.
 */
export declare function getTeamCommsDbService(db: DatabaseManager, projectPath?: string): TeamCommsDbService;
/**
 * Reset the service for a specific project (for testing).
 */
export declare function resetTeamCommsDbService(projectPath?: string): void;
/**
 * Reset all project instances (for testing).
 */
export declare function resetAllTeamCommsDbServices(): void;
//# sourceMappingURL=TeamCommsDbService.d.ts.map