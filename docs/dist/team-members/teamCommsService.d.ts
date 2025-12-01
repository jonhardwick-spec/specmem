/**
 * Team Communications Service (MCP-Based)
 *
 * Provides team-based communication for spawned team members.
 * All communication uses MCP tools (NOT HTTP/REST).
 *
 * NEW MCP-Based Features:
 * - MCP tools for all inter-team-member communication
 * - PostgreSQL-backed message storage (Slack-like)
 * - Channel/threading support via MCP
 * - Replaces HTTP-based team member communication
 *
 * Legacy Features (still supported via MCP):
 * - Auto-channel creation for parent tasks
 * - Team member ID generation and tracking
 * - Dev team pre-prompt injection
 * - Task claim/release management
 * - Completion notifications
 *
 * @author SpecMem Team
 */
import { EventEmitter } from 'events';
import { TeamMemberChannelManager, ChannelMessage } from './teamMemberChannels.js';
import { SpecMemClient } from './workers/specmemClient.js';
export type TeamMemberStatus = 'spawning' | 'working' | 'idle' | 'completed' | 'failed';
export interface TeamMember {
    id: string;
    name: string;
    parentTaskId: string;
    channelId: string;
    status: TeamMemberStatus;
    spawnedAt: Date;
    completedAt?: Date;
    claimedTasks: string[];
    metadata?: Record<string, any>;
}
export interface TeamChannel {
    id: string;
    name: string;
    parentTaskId: string;
    members: string[];
    createdAt: Date;
    archivedAt?: Date;
    isArchived: boolean;
    messageCount: number;
}
export interface SpawnTeamMemberConfig {
    /** The ID of the parent task that spawned this team member */
    parentTaskId: string;
    /** Optional name for the team member */
    name?: string;
    /** Original prompt to enhance with team context */
    prompt: string;
    /** Tools available to the team member */
    tools?: string[];
    /** Additional metadata */
    metadata?: Record<string, any>;
}
export interface SpawnTeamMemberResult {
    /** Generated team member ID */
    memberId: string;
    /** Team channel ID */
    channelId: string;
    /** Enhanced prompt with team context */
    enhancedPrompt: string;
    /** Enhanced tools list with team communication tools */
    tools: string[];
    /** The team member record */
    teamMember: TeamMember;
}
export interface TeamCommsServiceConfig {
    /** TeamMember ID for the service (default: 'team-comms-service') */
    teamMemberId?: string;
    /** SpecMem client (optional) */
    client?: SpecMemClient;
    /** Auto-archive channels when all members complete (default: true) */
    autoArchiveOnCompletion?: boolean;
}
/**
 * Get the dev team framing/pre-prompt for spawned team members
 *
 * NOTE: All team communication now uses MCP tools (NOT HTTP/REST).
 * The tools below are the new MCP-based communication system.
 */
export declare function getDevTeamFraming(): string;
/**
 * Get the list of team communication tool names (MCP-based)
 *
 * These are the new MCP-based tools that REPLACE HTTP team member communication.
 */
export declare function getTeamCommunicationToolNames(): string[];
export declare class TeamCommsService extends EventEmitter {
    private client;
    private teamMemberId;
    private channelManager;
    private autoArchiveOnCompletion;
    private teamMembers;
    private teamChannels;
    private taskToChannel;
    private claimedTasks;
    constructor(config?: TeamCommsServiceConfig);
    /**
     * Generate a unique team member ID
     */
    generateTeamMemberId(): string;
    /**
     * Get or create a team channel for a parent task
     */
    getOrCreateChannel(parentTaskId: string): Promise<TeamChannel>;
    /**
     * Generate a channel name from parent task ID
     */
    private generateChannelName;
    /**
     * Convert Channel to TeamChannel
     */
    private channelToTeamChannel;
    /**
     * Prepare for spawning a team member
     * This sets up the channel, generates IDs, and enhances the prompt
     */
    prepareTeamMemberSpawn(config: SpawnTeamMemberConfig): Promise<SpawnTeamMemberResult>;
    /**
     * Inject team context into prompt
     */
    injectTeamContext(prompt: string, context: {
        channelId: string;
        memberId: string;
        teamPrePrompt: string;
    }): string;
    /**
     * Update team member status
     */
    updateMemberStatus(memberId: string, status: TeamMemberStatus): Promise<boolean>;
    /**
     * Get team member by ID
     */
    getTeamMember(memberId: string): TeamMember | undefined;
    /**
     * Get all team members for a channel
     */
    getChannelMembers(channelId: string): TeamMember[];
    /**
     * Get team status for a parent task
     */
    getTeamStatus(parentTaskId: string): Promise<{
        channel: TeamChannel | undefined;
        members: TeamMember[];
        activeTasks: string[];
        completedCount: number;
        failedCount: number;
        workingCount: number;
    }>;
    /**
     * Claim a task for a team member
     */
    claimTask(memberId: string, taskId: string): Promise<boolean>;
    /**
     * Release a claimed task
     */
    releaseTask(memberId: string, taskId: string): Promise<boolean>;
    /**
     * Release all tasks for a member (on completion/failure)
     */
    releaseAllTasks(memberId: string): Promise<number>;
    /**
     * Handle team member completion
     */
    handleMemberCompletion(memberId: string, result: {
        success: boolean;
        message?: string;
        error?: string;
    }): Promise<void>;
    /**
     * Check if all members in a channel are done and archive if needed
     */
    private checkChannelCompletion;
    /**
     * Archive a team channel
     */
    archiveChannel(channelId: string): Promise<boolean>;
    /**
     * Send a message to a team channel
     */
    sendToChannel(channelId: string, content: string, options?: {
        priority?: 'low' | 'medium' | 'high';
        replyTo?: string;
    }): Promise<ChannelMessage | null>;
    /**
     * Get messages from a team channel
     */
    getChannelMessages(channelId: string, options?: {
        limit?: number;
        since?: Date;
    }): Promise<ChannelMessage[]>;
    private persistTeamMember;
    private persistTeamChannel;
    private persistTaskClaim;
    getChannelManager(): TeamMemberChannelManager;
    getClient(): SpecMemClient;
    getTeamMemberId(): string;
    getAllTeamMembers(): TeamMember[];
    getAllTeamChannels(): TeamChannel[];
}
/**
 * Create a TeamCommsService instance
 */
export declare function createTeamCommsService(config?: TeamCommsServiceConfig): TeamCommsService;
/**
 * Get the global TeamCommsService instance
 */
export declare function getTeamCommsService(): TeamCommsService;
/**
 * Initialize the global TeamCommsService with custom config
 */
export declare function initializeTeamCommsService(config?: TeamCommsServiceConfig): TeamCommsService;
/**
 * Shutdown the global TeamCommsService
 */
export declare function shutdownTeamCommsService(): Promise<void>;
//# sourceMappingURL=teamCommsService.d.ts.map