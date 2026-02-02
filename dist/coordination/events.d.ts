/**
 * events.ts - TeamMember Coordination Event Types
 *
 * Defines all event types for inter-team member communication through the
 * LWJEB-inspired event bus. Enables sub-10ms event propagation for
 * real-time team member coordination.
 *
 * @author hardwicksoftwareservices
 */
/**
 * TeamMember states
 */
export type TeamMemberState = 'initializing' | 'ready' | 'working' | 'waiting_permission' | 'blocked' | 'completed' | 'error' | 'disconnected';
/**
 * TeamMember priority levels
 */
export type TeamMemberPriority = 'low' | 'normal' | 'high' | 'critical';
/**
 * Base coordination event interface
 */
export interface BaseCoordinationEvent {
    type: string;
    timestamp: number;
    teamMemberId: string;
    correlationId?: string;
}
/**
 * TeamMember registration information
 */
export interface TeamMemberInfo {
    teamMemberId: string;
    name: string;
    type: string;
    capabilities: string[];
    priority: TeamMemberPriority;
    metadata?: Record<string, unknown>;
}
/**
 * TeamMember registered - TeamMember joins the coordination system
 */
export interface TeamMemberRegisteredEvent extends BaseCoordinationEvent {
    type: 'teamMember:registered';
    teamMember: TeamMemberInfo;
}
/**
 * TeamMember heartbeat - Periodic health check
 */
export interface TeamMemberHeartbeatEvent extends BaseCoordinationEvent {
    type: 'teamMember:heartbeat';
    state: TeamMemberState;
    uptime: number;
    memoryUsage?: number;
    cpuUsage?: number;
    lastActivity?: number;
}
/**
 * TeamMember disconnected - TeamMember left the coordination system
 */
export interface TeamMemberDisconnectedEvent extends BaseCoordinationEvent {
    type: 'teamMember:disconnected';
    reason: 'normal' | 'timeout' | 'error' | 'kicked';
    lastState?: TeamMemberState;
}
/**
 * TeamMember progress - Report task progress
 */
export interface TeamMemberProgressEvent extends BaseCoordinationEvent {
    type: 'teamMember:progress';
    taskId: string;
    progress: number;
    message?: string;
    estimatedCompletion?: number;
    subtasks?: {
        completed: number;
        total: number;
    };
}
/**
 * TeamMember waiting for permission - Blocked on user approval
 */
export interface TeamMemberWaitingPermissionEvent extends BaseCoordinationEvent {
    type: 'teamMember:waiting_permission';
    taskId: string;
    permissionType: string;
    description: string;
    requiredApprovals?: number;
    timeout?: number;
}
/**
 * TeamMember handoff - Passing work to another team member
 */
export interface TeamMemberHandoffEvent extends BaseCoordinationEvent {
    type: 'teamMember:handoff';
    fromTeamMemberId: string;
    toTeamMemberId: string;
    taskId: string;
    context: Record<string, unknown>;
    priority?: TeamMemberPriority;
}
/**
 * TeamMember completed - Task finished successfully
 */
export interface TeamMemberCompletedEvent extends BaseCoordinationEvent {
    type: 'teamMember:completed';
    taskId: string;
    result?: unknown;
    duration: number;
    metrics?: {
        tokensUsed?: number;
        toolCalls?: number;
        errors?: number;
    };
}
/**
 * TeamMember error - Error encountered
 */
export interface TeamMemberErrorEvent extends BaseCoordinationEvent {
    type: 'teamMember:error';
    taskId?: string;
    error: {
        code: string;
        message: string;
        stack?: string;
        recoverable: boolean;
    };
    severity: 'warning' | 'error' | 'critical';
}
/**
 * Broadcast message to all team members
 */
export interface BroadcastEvent extends BaseCoordinationEvent {
    type: 'coordination:broadcast';
    message: string;
    data?: unknown;
    priority: TeamMemberPriority;
}
/**
 * Direct message to specific team member
 */
export interface DirectMessageEvent extends BaseCoordinationEvent {
    type: 'coordination:direct';
    targetTeamMemberId: string;
    message: string;
    data?: unknown;
    requiresAck?: boolean;
}
/**
 * Permission granted event
 */
export interface PermissionGrantedEvent extends BaseCoordinationEvent {
    type: 'coordination:permission_granted';
    permissionId: string;
    taskId: string;
    grantedBy: string;
}
/**
 * Permission denied event
 */
export interface PermissionDeniedEvent extends BaseCoordinationEvent {
    type: 'coordination:permission_denied';
    permissionId: string;
    taskId: string;
    deniedBy: string;
    reason?: string;
}
/**
 * Task assignment event
 */
export interface TaskAssignmentEvent extends BaseCoordinationEvent {
    type: 'coordination:task_assignment';
    taskId: string;
    assignedTo: string;
    task: {
        name: string;
        description: string;
        priority: TeamMemberPriority;
        deadline?: number;
        dependencies?: string[];
        context?: Record<string, unknown>;
    };
}
/**
 * Task cancellation event
 */
export interface TaskCancellationEvent extends BaseCoordinationEvent {
    type: 'coordination:task_cancelled';
    taskId: string;
    reason: string;
    cancelledBy: string;
}
/**
 * Server status event
 */
export interface ServerStatusEvent extends BaseCoordinationEvent {
    type: 'server:status';
    status: 'starting' | 'ready' | 'degraded' | 'shutting_down';
    connectedTeamMembers: number;
    uptime: number;
    metrics?: Record<string, number>;
}
/**
 * TeamMember sync request - Request full state sync
 */
export interface TeamMemberSyncRequestEvent extends BaseCoordinationEvent {
    type: 'server:sync_request';
    requestedTeamMemberIds?: string[];
}
/**
 * TeamMember sync response - Full state snapshot
 */
export interface TeamMemberSyncResponseEvent extends BaseCoordinationEvent {
    type: 'server:sync_response';
    teamMembers: TeamMemberInfo[];
    states: Record<string, TeamMemberState>;
    timestamp: number;
}
/**
 * Union of all coordination events
 */
export type CoordinationEvent = TeamMemberRegisteredEvent | TeamMemberHeartbeatEvent | TeamMemberDisconnectedEvent | TeamMemberProgressEvent | TeamMemberWaitingPermissionEvent | TeamMemberHandoffEvent | TeamMemberCompletedEvent | TeamMemberErrorEvent | BroadcastEvent | DirectMessageEvent | PermissionGrantedEvent | PermissionDeniedEvent | TaskAssignmentEvent | TaskCancellationEvent | ServerStatusEvent | TeamMemberSyncRequestEvent | TeamMemberSyncResponseEvent;
/**
 * All team member event types
 */
export declare const TEAM_MEMBER_EVENT_TYPES: readonly ["teamMember:registered", "teamMember:heartbeat", "teamMember:disconnected", "teamMember:progress", "teamMember:waiting_permission", "teamMember:handoff", "teamMember:completed", "teamMember:error"];
/**
 * All coordination control event types
 */
export declare const COORDINATION_EVENT_TYPES: readonly ["coordination:broadcast", "coordination:direct", "coordination:permission_granted", "coordination:permission_denied", "coordination:task_assignment", "coordination:task_cancelled"];
/**
 * All server event types
 */
export declare const SERVER_EVENT_TYPES: readonly ["server:status", "server:sync_request", "server:sync_response"];
/**
 * All event types
 */
export type CoordinationEventType = CoordinationEvent['type'];
export declare function isTeamMemberEvent(event: CoordinationEvent): boolean;
export declare function isCoordinationControlEvent(event: CoordinationEvent): boolean;
export declare function isServerEvent(event: CoordinationEvent): boolean;
export declare function isTeamMemberRegisteredEvent(event: CoordinationEvent): event is TeamMemberRegisteredEvent;
export declare function isTeamMemberHeartbeatEvent(event: CoordinationEvent): event is TeamMemberHeartbeatEvent;
export declare function isTeamMemberDisconnectedEvent(event: CoordinationEvent): event is TeamMemberDisconnectedEvent;
export declare function isTeamMemberProgressEvent(event: CoordinationEvent): event is TeamMemberProgressEvent;
export declare function isTeamMemberWaitingPermissionEvent(event: CoordinationEvent): event is TeamMemberWaitingPermissionEvent;
export declare function isTeamMemberHandoffEvent(event: CoordinationEvent): event is TeamMemberHandoffEvent;
export declare function isTeamMemberCompletedEvent(event: CoordinationEvent): event is TeamMemberCompletedEvent;
export declare function isTeamMemberErrorEvent(event: CoordinationEvent): event is TeamMemberErrorEvent;
/**
 * Create a base event with common fields
 */
export declare function createBaseEvent(type: string, teamMemberId: string, correlationId?: string): BaseCoordinationEvent;
/**
 * Create a team member registered event
 */
export declare function createTeamMemberRegisteredEvent(teamMember: TeamMemberInfo): TeamMemberRegisteredEvent;
/**
 * Create a team member heartbeat event
 */
export declare function createTeamMemberHeartbeatEvent(teamMemberId: string, state: TeamMemberState, uptime: number, metrics?: {
    memoryUsage?: number;
    cpuUsage?: number;
    lastActivity?: number;
}): TeamMemberHeartbeatEvent;
/**
 * Create a team member progress event
 */
export declare function createTeamMemberProgressEvent(teamMemberId: string, taskId: string, progress: number, options?: {
    message?: string;
    estimatedCompletion?: number;
    subtasks?: {
        completed: number;
        total: number;
    };
    correlationId?: string;
}): TeamMemberProgressEvent;
/**
 * Create a team member completed event
 */
export declare function createTeamMemberCompletedEvent(teamMemberId: string, taskId: string, duration: number, options?: {
    result?: unknown;
    metrics?: {
        tokensUsed?: number;
        toolCalls?: number;
        errors?: number;
    };
    correlationId?: string;
}): TeamMemberCompletedEvent;
/**
 * Create a team member error event
 */
export declare function createTeamMemberErrorEvent(teamMemberId: string, error: Error, options?: {
    taskId?: string;
    severity?: 'warning' | 'error' | 'critical';
    recoverable?: boolean;
    correlationId?: string;
}): TeamMemberErrorEvent;
/**
 * Create a broadcast event
 */
export declare function createBroadcastEvent(teamMemberId: string, message: string, options?: {
    data?: unknown;
    priority?: TeamMemberPriority;
    correlationId?: string;
}): BroadcastEvent;
/**
 * Reload event type constants
 * Used for hot reload coordination across instances
 */
export declare const RELOAD_EVENTS: {
    /** Reload has been requested (broadcast initiated) */
    readonly RELOAD_REQUESTED: "reload:requested";
    /** Instances are draining active operations */
    readonly RELOAD_DRAINING: "reload:draining";
    /** Reload has completed on an instance */
    readonly RELOAD_COMPLETE: "reload:complete";
};
/**
 * Reload requested event - broadcast when hot reload is initiated
 */
export interface ReloadRequestedEvent extends BaseCoordinationEvent {
    type: typeof RELOAD_EVENTS.RELOAD_REQUESTED;
    /** Reason for the reload */
    reason: string;
    /** Signal being used (e.g., 'SIGUSR1') */
    signal: string;
}
/**
 * Reload draining event - instances are draining active tool calls
 */
export interface ReloadDrainingEvent extends BaseCoordinationEvent {
    type: typeof RELOAD_EVENTS.RELOAD_DRAINING;
    /** Number of instances signaled */
    instancesSignaled: number;
}
/**
 * Reload complete event - an instance has finished reloading
 */
export interface ReloadCompleteEvent extends BaseCoordinationEvent {
    type: typeof RELOAD_EVENTS.RELOAD_COMPLETE;
    /** PID of the instance that completed */
    pid: number;
    /** Duration of the reload in milliseconds */
    duration: number;
    /** Tier of reload performed (1=tools only, 2=MCP server, 3=full restart) */
    tier: number;
}
/**
 * All reload event types
 */
export declare const RELOAD_EVENT_TYPES: readonly ["reload:requested", "reload:draining", "reload:complete"];
/**
 * Type guard for reload events
 */
export declare function isReloadEvent(event: CoordinationEvent | {
    type: string;
}): boolean;
/**
 * Create a reload requested event
 */
export declare function createReloadRequestedEvent(reason: string, signal?: string, correlationId?: string): ReloadRequestedEvent;
/**
 * Create a reload draining event
 */
export declare function createReloadDrainingEvent(instancesSignaled: number, correlationId?: string): ReloadDrainingEvent;
/**
 * Create a reload complete event
 */
export declare function createReloadCompleteEvent(pid: number, duration: number, tier: number, correlationId?: string): ReloadCompleteEvent;
//# sourceMappingURL=events.d.ts.map