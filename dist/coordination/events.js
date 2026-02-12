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
 * All team member event types
 */
export const TEAM_MEMBER_EVENT_TYPES = [
    'teamMember:registered',
    'teamMember:heartbeat',
    'teamMember:disconnected',
    'teamMember:progress',
    'teamMember:waiting_permission',
    'teamMember:handoff',
    'teamMember:completed',
    'teamMember:error'
];
/**
 * All coordination control event types
 */
export const COORDINATION_EVENT_TYPES = [
    'coordination:broadcast',
    'coordination:direct',
    'coordination:permission_granted',
    'coordination:permission_denied',
    'coordination:task_assignment',
    'coordination:task_cancelled'
];
/**
 * All server event types
 */
export const SERVER_EVENT_TYPES = [
    'server:status',
    'server:sync_request',
    'server:sync_response'
];
// ============================================================================
// Type Guards
// ============================================================================
export function isTeamMemberEvent(event) {
    return event.type.startsWith('teamMember:');
}
export function isCoordinationControlEvent(event) {
    return event.type.startsWith('coordination:');
}
export function isServerEvent(event) {
    return event.type.startsWith('server:');
}
export function isTeamMemberRegisteredEvent(event) {
    return event.type === 'teamMember:registered';
}
export function isTeamMemberHeartbeatEvent(event) {
    return event.type === 'teamMember:heartbeat';
}
export function isTeamMemberDisconnectedEvent(event) {
    return event.type === 'teamMember:disconnected';
}
export function isTeamMemberProgressEvent(event) {
    return event.type === 'teamMember:progress';
}
export function isTeamMemberWaitingPermissionEvent(event) {
    return event.type === 'teamMember:waiting_permission';
}
export function isTeamMemberHandoffEvent(event) {
    return event.type === 'teamMember:handoff';
}
export function isTeamMemberCompletedEvent(event) {
    return event.type === 'teamMember:completed';
}
export function isTeamMemberErrorEvent(event) {
    return event.type === 'teamMember:error';
}
// ============================================================================
// Event Factory Functions
// ============================================================================
/**
 * Create a base event with common fields
 */
export function createBaseEvent(type, teamMemberId, correlationId) {
    return {
        type,
        timestamp: Date.now(),
        teamMemberId,
        correlationId
    };
}
/**
 * Create a team member registered event
 */
export function createTeamMemberRegisteredEvent(teamMember) {
    return {
        ...createBaseEvent('teamMember:registered', teamMember.teamMemberId),
        type: 'teamMember:registered',
        teamMember
    };
}
/**
 * Create a team member heartbeat event
 */
export function createTeamMemberHeartbeatEvent(teamMemberId, state, uptime, metrics) {
    return {
        ...createBaseEvent('teamMember:heartbeat', teamMemberId),
        type: 'teamMember:heartbeat',
        state,
        uptime,
        ...metrics
    };
}
/**
 * Create a team member progress event
 */
export function createTeamMemberProgressEvent(teamMemberId, taskId, progress, options) {
    return {
        ...createBaseEvent('teamMember:progress', teamMemberId, options?.correlationId),
        type: 'teamMember:progress',
        taskId,
        progress,
        message: options?.message,
        estimatedCompletion: options?.estimatedCompletion,
        subtasks: options?.subtasks
    };
}
/**
 * Create a team member completed event
 */
export function createTeamMemberCompletedEvent(teamMemberId, taskId, duration, options) {
    return {
        ...createBaseEvent('teamMember:completed', teamMemberId, options?.correlationId),
        type: 'teamMember:completed',
        taskId,
        duration,
        result: options?.result,
        metrics: options?.metrics
    };
}
/**
 * Create a team member error event
 */
export function createTeamMemberErrorEvent(teamMemberId, error, options) {
    return {
        ...createBaseEvent('teamMember:error', teamMemberId, options?.correlationId),
        type: 'teamMember:error',
        taskId: options?.taskId,
        error: {
            code: error.name,
            message: error.message,
            stack: error.stack,
            recoverable: options?.recoverable ?? false
        },
        severity: options?.severity ?? 'error'
    };
}
/**
 * Create a broadcast event
 */
export function createBroadcastEvent(teamMemberId, message, options) {
    return {
        ...createBaseEvent('coordination:broadcast', teamMemberId, options?.correlationId),
        type: 'coordination:broadcast',
        message,
        data: options?.data,
        priority: options?.priority ?? 'normal'
    };
}
// ============================================================================
// Hot Reload Events
// ============================================================================
/**
 * Reload event type constants
 * Used for hot reload coordination across instances
 */
export const RELOAD_EVENTS = {
    /** Reload has been requested (broadcast initiated) */
    RELOAD_REQUESTED: 'reload:requested',
    /** Instances are draining active operations */
    RELOAD_DRAINING: 'reload:draining',
    /** Reload has completed on an instance */
    RELOAD_COMPLETE: 'reload:complete',
};
/**
 * All reload event types
 */
export const RELOAD_EVENT_TYPES = [
    RELOAD_EVENTS.RELOAD_REQUESTED,
    RELOAD_EVENTS.RELOAD_DRAINING,
    RELOAD_EVENTS.RELOAD_COMPLETE,
];
/**
 * Type guard for reload events
 */
export function isReloadEvent(event) {
    return event.type.startsWith('reload:');
}
/**
 * Create a reload requested event
 */
export function createReloadRequestedEvent(reason, signal = 'SIGUSR1', correlationId) {
    return {
        ...createBaseEvent(RELOAD_EVENTS.RELOAD_REQUESTED, 'hot-reload-manager', correlationId),
        type: RELOAD_EVENTS.RELOAD_REQUESTED,
        reason,
        signal,
    };
}
/**
 * Create a reload draining event
 */
export function createReloadDrainingEvent(instancesSignaled, correlationId) {
    return {
        ...createBaseEvent(RELOAD_EVENTS.RELOAD_DRAINING, 'hot-reload-manager', correlationId),
        type: RELOAD_EVENTS.RELOAD_DRAINING,
        instancesSignaled,
    };
}
/**
 * Create a reload complete event
 */
export function createReloadCompleteEvent(pid, duration, tier, correlationId) {
    return {
        ...createBaseEvent(RELOAD_EVENTS.RELOAD_COMPLETE, 'hot-reload-manager', correlationId),
        type: RELOAD_EVENTS.RELOAD_COMPLETE,
        pid,
        duration,
        tier,
    };
}
//# sourceMappingURL=events.js.map