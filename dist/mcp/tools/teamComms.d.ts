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
import { MCPTool } from '../toolRegistry.js';
import pg from 'pg';
type TeamMessageType = 'status' | 'question' | 'update' | 'broadcast' | 'help_request' | 'help_response';
type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';
/**
 * Get the session start timestamp.
 * Returns the time when initTeamCommsDB was called for this session.
 * If not initialized, returns epoch (includes all messages).
 */
export declare function getSessionStartTime(): Date;
/**
 * Reset session start time (useful for testing or explicit session restart).
 * Call this before deploying new agents to ensure they start fresh.
 */
export declare function resetSessionStartTime(): void;
/**
 * Initialize the team communications database schema
 * Creates tables for channels, messages, claims, and help requests
 *
 * CRITICAL: Sets search_path to project schema FIRST to avoid polluting public schema!
 * This ensures all tables are created in the correct project-isolated schema.
 */
export declare function initTeamCommsDB(pool: pg.Pool): Promise<void>;
interface SendTeamMessageInput {
    message: string;
    type?: TeamMessageType;
    priority?: MessagePriority;
    channel?: string;
    task_id?: string;
    project_id?: string;
    thread_id?: string;
    sender_name?: string;
}
interface SendTeamMessageOutput {
    [key: string]: any;
}
export declare class SendTeamMessage implements MCPTool<SendTeamMessageInput, SendTeamMessageOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            message: {
                type: string;
                description: string;
            };
            type: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
            priority: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
            channel: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
            task_id: {
                type: string;
                description: string;
            };
            project_id: {
                type: string;
                description: string;
            };
            thread_id: {
                type: string;
                description: string;
            };
            sender_name: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute(params: SendTeamMessageInput): Promise<SendTeamMessageOutput>;
}
interface ReadTeamMessagesInput {
    limit?: number;
    since?: string;
    channel?: string;
    task_id?: string;
    project_id?: string;
    mentions_only?: boolean;
    unread_only?: boolean;
    include_broadcasts?: boolean;
    include_main?: boolean;
    include_swarms?: boolean;
    compress?: boolean;
}
interface ReadTeamMessagesOutput {
    [key: string]: any;
}
export declare class ReadTeamMessages implements MCPTool<ReadTeamMessagesInput, ReadTeamMessagesOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            limit: {
                type: string;
                description: string;
                default: number;
            };
            since: {
                type: string;
                description: string;
            };
            task_id: {
                type: string;
                description: string;
            };
            project_id: {
                type: string;
                description: string;
            };
            mentions_only: {
                type: string;
                description: string;
                default: boolean;
            };
            unread_only: {
                type: string;
                description: string;
                default: boolean;
            };
            include_broadcasts: {
                type: string;
                description: string;
                default: boolean;
            };
            include_swarms: {
                type: string;
                description: string;
                default: boolean;
            };
            channel: {
                type: string;
                enum: string[];
                description: string;
            };
            compress: {
                type: string;
                description: string;
                default: boolean;
            };
        };
        required: any[];
    };
    execute(params: ReadTeamMessagesInput): Promise<ReadTeamMessagesOutput>;
}
interface BroadcastToTeamInput {
    message: string;
    broadcast_type?: 'status' | 'progress' | 'announcement';
    priority?: MessagePriority;
    metadata?: Record<string, unknown>;
    /** If true, broadcast to ALL projects (use sparingly for system-wide announcements) */
    cross_project?: boolean;
}
interface BroadcastToTeamOutput {
    content?: Array<{
        type: string;
        text: string;
    }>;
    _REMINDER?: string;
    success?: boolean;
    messageId?: string;
    timestamp?: string;
    channel?: string;
}
export declare class BroadcastToTeam implements MCPTool<BroadcastToTeamInput, BroadcastToTeamOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            message: {
                type: string;
                description: string;
            };
            broadcast_type: {
                type: string;
                enum: string[];
                description: string;
            };
            priority: {
                type: string;
                enum: string[];
                description: string;
            };
            metadata: {
                type: string;
                description: string;
            };
            cross_project: {
                type: string;
                description: string;
                default: boolean;
            };
        };
        required: string[];
    };
    execute(params: BroadcastToTeamInput): Promise<BroadcastToTeamOutput>;
}
interface ClaimTaskInput {
    description: string;
    files?: string[];
}
interface ClaimTaskOutput {
    _REMINDER?: string;
    success: boolean;
    claimId: string;
    description: string;
    files: string[];
    timestamp: string;
    warnings: string[];
}
export declare class ClaimTask implements MCPTool<ClaimTaskInput, ClaimTaskOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            description: {
                type: string;
                description: string;
            };
            files: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
        };
        required: string[];
    };
    execute(params: ClaimTaskInput): Promise<ClaimTaskOutput>;
}
interface ReleaseTaskInput {
    claimId: string;
    files?: string[];
}
interface ReleaseTaskOutput {
    _REMINDER?: string;
    success: boolean;
    releasedClaims: string[];
    message: string;
}
export declare class ReleaseTask implements MCPTool<ReleaseTaskInput, ReleaseTaskOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            claimId: {
                type: string;
                description: string;
            };
            files: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
        };
        required: string[];
    };
    execute(params: ReleaseTaskInput): Promise<ReleaseTaskOutput>;
}
interface GetTeamStatusInput {
}
interface GetTeamStatusOutput {
    [key: string]: any;
}
export declare class GetTeamStatus implements MCPTool<GetTeamStatusInput, GetTeamStatusOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {};
        required: any[];
    };
    execute(_params: GetTeamStatusInput): Promise<GetTeamStatusOutput>;
}
interface RequestHelpInput {
    question: string;
    context?: string;
    skills_needed?: string[];
}
interface RequestHelpOutput {
    _REMINDER?: string;
    success: boolean;
    requestId: string;
    timestamp: string;
    message: string;
}
export declare class RequestHelp implements MCPTool<RequestHelpInput, RequestHelpOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            question: {
                type: string;
                description: string;
            };
            context: {
                type: string;
                description: string;
            };
            skills_needed: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
        };
        required: string[];
    };
    execute(params: RequestHelpInput): Promise<RequestHelpOutput>;
}
interface RespondToHelpInput {
    requestId: string;
    response: string;
}
interface RespondToHelpOutput {
    _REMINDER?: string;
    success: boolean;
    responseId: string;
    requestId: string;
    timestamp: string;
    message: string;
}
export declare class RespondToHelp implements MCPTool<RespondToHelpInput, RespondToHelpOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            requestId: {
                type: string;
                description: string;
            };
            response: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute(params: RespondToHelpInput): Promise<RespondToHelpOutput>;
}
interface ClearTeamMessagesInput {
    confirm: boolean;
    older_than_minutes?: number;
    clear_claims?: boolean;
    clear_help_requests?: boolean;
}
interface ClearTeamMessagesOutput {
    _REMINDER?: string;
    success: boolean;
    messagesDeleted: number;
    claimsCleared: number;
    helpRequestsCleared: number;
    message: string;
}
export declare class ClearTeamMessages implements MCPTool<ClearTeamMessagesInput, ClearTeamMessagesOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            confirm: {
                type: string;
                description: string;
            };
            older_than_minutes: {
                type: string;
                description: string;
            };
            clear_claims: {
                type: string;
                description: string;
                default: boolean;
            };
            clear_help_requests: {
                type: string;
                description: string;
                default: boolean;
            };
        };
        required: string[];
    };
    execute(params: ClearTeamMessagesInput): Promise<ClearTeamMessagesOutput>;
}
export declare const teamCommTools: (typeof BroadcastToTeam | typeof ClaimTask | typeof ReleaseTask | typeof GetTeamStatus | typeof RequestHelp | typeof RespondToHelp | typeof ClearTeamMessages)[];
/**
 * Create instances of all team communication tools
 */
export declare function createTeamCommTools(): MCPTool[];
/**
 * Initialize team comms with database pool and return tools
 */
export declare function createTeamCommToolsWithDB(pool: pg.Pool): Promise<MCPTool[]>;
export {};
//# sourceMappingURL=teamComms.d.ts.map