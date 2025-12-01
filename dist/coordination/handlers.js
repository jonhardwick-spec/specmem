/**
 * handlers.ts - Event Handlers for TeamMember Coordination
 *
 * Implements all event handlers for the coordination system.
 * Uses LWJEB event bus for sub-10ms event propagation.
 *
 * @author hardwicksoftwareservices
 */
import { isTeamMemberRegisteredEvent, isTeamMemberHeartbeatEvent, isTeamMemberDisconnectedEvent, isTeamMemberProgressEvent, isTeamMemberWaitingPermissionEvent, isTeamMemberHandoffEvent, isTeamMemberCompletedEvent, isTeamMemberErrorEvent } from './events.js';
import { createPublisher } from '../events/Publisher.js';
import { ConfigProfiles } from '../events/config.js';
import { logger } from '../utils/logger.js';
// ============================================================================
// Individual Event Handlers
// ============================================================================
/**
 * Handle team member registration
 */
export const handleTeamMemberRegistered = async (event, context) => {
    const { teamMember } = event;
    const startTime = performance.now();
    try {
        // Check if already registered (reconnection)
        const existing = context.registry.get(teamMember.teamMemberId);
        if (existing) {
            // Update existing registration
            context.registry.update(teamMember.teamMemberId, { teamMember });
            context.registry.setState(teamMember.teamMemberId, 'ready');
            logger.info({ teamMemberId: teamMember.teamMemberId }, 'Team Member reconnected');
        }
        else {
            // New registration - handled by registry
            context.registry.setState(teamMember.teamMemberId, 'ready');
        }
        // Broadcast registration to other team members
        context.broadcast(event, teamMember.teamMemberId);
        const duration = performance.now() - startTime;
        logger.debug({ teamMemberId: teamMember.teamMemberId, duration }, 'Team Member registration handled');
    }
    catch (error) {
        logger.error({ error, teamMemberId: teamMember.teamMemberId }, 'Error handling team member registration');
        throw error;
    }
};
/**
 * Handle team member heartbeat
 */
export const handleTeamMemberHeartbeat = async (event, context) => {
    const { teamMemberId, state } = event;
    const entry = context.registry.heartbeat(teamMemberId, state);
    if (!entry) {
        logger.warn({ teamMemberId }, 'Heartbeat from unregistered team member');
        return;
    }
    // Update state if provided and different
    if (state && entry.state !== state) {
        context.registry.setState(teamMemberId, state);
    }
};
/**
 * Handle team member disconnection
 */
export const handleTeamMemberDisconnected = async (event, context) => {
    const { teamMemberId, reason } = event;
    // Registry handles the actual removal via its own event emission
    // Just broadcast to other team members
    context.broadcast(event, teamMemberId);
    logger.info({ teamMemberId, reason }, 'Team Member disconnected - notified other team members');
};
/**
 * Handle team member progress report
 */
export const handleTeamMemberProgress = async (event, context) => {
    const { teamMemberId, taskId, progress, message } = event;
    // Update team member state to working if not already
    const entry = context.registry.get(teamMemberId);
    if (entry && entry.state !== 'working') {
        context.registry.setState(teamMemberId, 'working');
    }
    // Record activity
    context.registry.recordEventProcessed(teamMemberId);
    // Broadcast progress to interested parties
    context.broadcast(event);
    logger.debug({
        teamMemberId,
        taskId,
        progress,
        message
    }, 'Team Member progress reported');
};
/**
 * Handle team member waiting for permission
 */
export const handleTeamMemberWaitingPermission = async (event, context) => {
    const { teamMemberId, taskId, permissionType, description } = event;
    // Update team member state
    context.registry.setState(teamMemberId, 'waiting_permission');
    // Broadcast to all (UI/coordinator will handle the permission request)
    context.broadcast(event);
    logger.info({
        teamMemberId,
        taskId,
        permissionType,
        description
    }, 'Team Member waiting for permission');
};
/**
 * Handle team member handoff
 */
export const handleTeamMemberHandoff = async (event, context) => {
    const { fromTeamMemberId, toTeamMemberId, taskId, context: taskContext, priority } = event;
    // Verify target team member exists and is available
    const targetEntry = context.registry.get(toTeamMemberId);
    if (!targetEntry) {
        logger.error({ toTeamMemberId }, 'Handoff target team member not found');
        // Emit error back to source teamMember
        context.sendToTeamMember(fromTeamMemberId, {
            type: 'teamMember:error',
            timestamp: Date.now(),
            teamMemberId: fromTeamMemberId,
            taskId,
            error: {
                code: 'HANDOFF_TARGET_NOT_FOUND',
                message: `Target team member ${toTeamMemberId} not found`,
                recoverable: true
            },
            severity: 'error'
        });
        return;
    }
    if (targetEntry.state !== 'ready') {
        logger.warn({ toTeamMemberId, state: targetEntry.state }, 'Handoff target not ready');
    }
    // Update source team member state
    context.registry.setState(fromTeamMemberId, 'ready');
    context.registry.recordTaskCompletion(fromTeamMemberId);
    // Send task assignment to target
    const assignment = {
        type: 'coordination:task_assignment',
        timestamp: Date.now(),
        teamMemberId: 'coordinator',
        taskId,
        assignedTo: toTeamMemberId,
        task: {
            name: `Handoff from ${fromTeamMemberId}`,
            description: `Task handed off from team member ${fromTeamMemberId}`,
            priority: priority ?? 'normal',
            context: {
                ...taskContext,
                handoffFrom: fromTeamMemberId,
                handoffTimestamp: Date.now()
            }
        }
    };
    context.sendToTeamMember(toTeamMemberId, assignment);
    // Broadcast handoff event
    context.broadcast(event);
    logger.info({
        fromTeamMemberId,
        toTeamMemberId,
        taskId
    }, 'Team Member handoff processed');
};
/**
 * Handle team member completion
 */
export const handleTeamMemberCompleted = async (event, context) => {
    const { teamMemberId, taskId, duration, metrics } = event;
    // Update team member state
    context.registry.setState(teamMemberId, 'completed');
    context.registry.recordTaskCompletion(teamMemberId);
    // Broadcast completion
    context.broadcast(event);
    logger.info({
        teamMemberId,
        taskId,
        duration,
        metrics
    }, 'Team Member completed task');
    // After a delay, set state back to ready
    setTimeout(() => {
        const entry = context.registry.get(teamMemberId);
        if (entry && entry.state === 'completed') {
            context.registry.setState(teamMemberId, 'ready');
        }
    }, 1000);
};
/**
 * Handle team member error
 */
export const handleTeamMemberError = async (event, context) => {
    const { teamMemberId, error, severity, taskId } = event;
    // Record error
    context.registry.recordError(teamMemberId);
    // Update state based on severity
    if (severity === 'critical' && !error.recoverable) {
        context.registry.setState(teamMemberId, 'error');
    }
    else if (error.recoverable) {
        // Keep current state for recoverable errors
        logger.warn({ teamMemberId, error, taskId }, 'Team Member encountered recoverable error');
    }
    else {
        context.registry.setState(teamMemberId, 'blocked');
    }
    // Broadcast error to interested parties
    context.broadcast(event);
    logger.error({
        teamMemberId,
        taskId,
        error: error.message,
        code: error.code,
        severity,
        recoverable: error.recoverable
    }, 'Team Member error reported');
};
/**
 * Handle broadcast message
 */
export const handleBroadcast = async (event, context) => {
    // Simply rebroadcast to all team members
    context.broadcast(event, event.teamMemberId);
    logger.debug({
        from: event.teamMemberId,
        message: event.message,
        priority: event.priority
    }, 'Broadcast message relayed');
};
/**
 * Handle direct message
 */
export const handleDirectMessage = async (event, context) => {
    const { targetTeamMemberId, message, requiresAck } = event;
    const success = context.sendToTeamMember(targetTeamMemberId, event);
    if (!success) {
        logger.warn({ targetTeamMemberId, from: event.teamMemberId }, 'Direct message failed - target not found');
        // Notify sender of failure
        context.sendToTeamMember(event.teamMemberId, {
            type: 'teamMember:error',
            timestamp: Date.now(),
            teamMemberId: event.teamMemberId,
            error: {
                code: 'DIRECT_MESSAGE_FAILED',
                message: `Failed to deliver message to ${targetTeamMemberId}`,
                recoverable: true
            },
            severity: 'warning'
        });
    }
    else {
        logger.debug({ from: event.teamMemberId, to: targetTeamMemberId }, 'Direct message delivered');
    }
};
// ============================================================================
// Handler Registry
// ============================================================================
/**
 * All built-in handlers
 */
export const BUILT_IN_HANDLERS = [
    { eventType: 'teamMember:registered', handler: handleTeamMemberRegistered, priority: 100 },
    { eventType: 'teamMember:heartbeat', handler: handleTeamMemberHeartbeat, priority: 50 },
    { eventType: 'teamMember:disconnected', handler: handleTeamMemberDisconnected, priority: 100 },
    { eventType: 'teamMember:progress', handler: handleTeamMemberProgress, priority: 50 },
    { eventType: 'teamMember:waiting_permission', handler: handleTeamMemberWaitingPermission, priority: 100 },
    { eventType: 'teamMember:handoff', handler: handleTeamMemberHandoff, priority: 100 },
    { eventType: 'teamMember:completed', handler: handleTeamMemberCompleted, priority: 100 },
    { eventType: 'teamMember:error', handler: handleTeamMemberError, priority: 100 },
    { eventType: 'coordination:broadcast', handler: handleBroadcast, priority: 50 },
    { eventType: 'coordination:direct', handler: handleDirectMessage, priority: 50 }
];
/**
 * CoordinationEventDispatcher - Manages event routing and handler execution
 *
 * Integrates with LWJEB event bus for fast event propagation.
 */
export class CoordinationEventDispatcher {
    publisher;
    context;
    customHandlers = new Map();
    constructor(registry, broadcast, sendToTeamMember) {
        // Create high-performance publisher
        this.publisher = createPublisher({
            ...ConfigProfiles.highPerformance(),
            identifier: 'coordination-dispatcher',
            maxLatencyMs: 10 // Sub-10ms target
        });
        this.context = {
            registry,
            publisher: this.publisher,
            broadcast,
            sendToTeamMember
        };
        // Register built-in handlers
        this.registerBuiltInHandlers();
        logger.info('CoordinationEventDispatcher initialized');
    }
    /**
     * Register built-in handlers with the event bus
     */
    registerBuiltInHandlers() {
        for (const { eventType, handler, priority } of BUILT_IN_HANDLERS) {
            this.publisher.subscribe(eventType, (event) => handler(event, this.context), { priority: priority ?? 0 });
        }
    }
    /**
     * Register a custom handler
     */
    registerHandler(eventType, handler, priority) {
        // Track custom handlers
        const handlers = this.customHandlers.get(eventType) ?? [];
        handlers.push(handler);
        this.customHandlers.set(eventType, handlers);
        // Register with publisher
        this.publisher.subscribe(eventType, (event) => handler(event, this.context), { priority });
        logger.debug({ eventType }, 'Custom handler registered');
    }
    /**
     * Dispatch an event through the event bus
     */
    async dispatch(event) {
        const startTime = performance.now();
        const result = this.publisher.post(event);
        const dispatchResult = await result.dispatch();
        const duration = performance.now() - startTime;
        if (duration > 10) {
            logger.warn({
                eventType: event.type,
                duration,
                handlers: dispatchResult.handlersInvoked
            }, 'Event dispatch exceeded 10ms target');
        }
        if (dispatchResult.errors.length > 0) {
            logger.error({
                eventType: event.type,
                errors: dispatchResult.errors.map(e => e.message)
            }, 'Errors during event dispatch');
        }
    }
    /**
     * Dispatch an event asynchronously (fire and forget)
     */
    dispatchAsync(event) {
        const result = this.publisher.post(event);
        result.async();
    }
    /**
     * Get dispatch metrics
     */
    getMetrics() {
        return this.publisher.getMetrics().getStats();
    }
    /**
     * Shutdown the dispatcher
     */
    async shutdown() {
        await this.publisher.shutdownGracefully(5000);
        logger.info('CoordinationEventDispatcher shut down');
    }
}
// ============================================================================
// Event Router Helper
// ============================================================================
/**
 * Route an event to the appropriate handler based on type
 */
export function routeEvent(event, context) {
    if (isTeamMemberRegisteredEvent(event)) {
        return handleTeamMemberRegistered(event, context);
    }
    if (isTeamMemberHeartbeatEvent(event)) {
        return handleTeamMemberHeartbeat(event, context);
    }
    if (isTeamMemberDisconnectedEvent(event)) {
        return handleTeamMemberDisconnected(event, context);
    }
    if (isTeamMemberProgressEvent(event)) {
        return handleTeamMemberProgress(event, context);
    }
    if (isTeamMemberWaitingPermissionEvent(event)) {
        return handleTeamMemberWaitingPermission(event, context);
    }
    if (isTeamMemberHandoffEvent(event)) {
        return handleTeamMemberHandoff(event, context);
    }
    if (isTeamMemberCompletedEvent(event)) {
        return handleTeamMemberCompleted(event, context);
    }
    if (isTeamMemberErrorEvent(event)) {
        return handleTeamMemberError(event, context);
    }
    if (event.type === 'coordination:broadcast') {
        return handleBroadcast(event, context);
    }
    if (event.type === 'coordination:direct') {
        return handleDirectMessage(event, context);
    }
    logger.warn({ eventType: event.type }, 'No handler for event type');
}
//# sourceMappingURL=handlers.js.map