/**
 * handlers.ts - Event Handlers for TeamMember Coordination
 *
 * Implements all event handlers for the coordination system.
 * Uses LWJEB event bus for sub-10ms event propagation.
 *
 * @author hardwicksoftwareservices
 */
import { CoordinationEvent, TeamMemberRegisteredEvent, TeamMemberHeartbeatEvent, TeamMemberDisconnectedEvent, TeamMemberProgressEvent, TeamMemberWaitingPermissionEvent, TeamMemberHandoffEvent, TeamMemberCompletedEvent, TeamMemberErrorEvent, BroadcastEvent, DirectMessageEvent } from './events.js';
import { TeamMemberRegistry } from './TeamMemberRegistry.js';
import { EventPublisher } from '../events/Publisher.js';
/**
 * Handler context for dependency injection
 */
export interface HandlerContext {
    registry: TeamMemberRegistry;
    publisher: EventPublisher<CoordinationEvent>;
    broadcast: (event: CoordinationEvent, excludeTeamMemberId?: string) => void;
    sendToTeamMember: (teamMemberId: string, event: CoordinationEvent) => boolean;
}
/**
 * Event handler function type
 */
export type CoordinationEventHandler<E extends CoordinationEvent = CoordinationEvent> = (event: E, context: HandlerContext) => void | Promise<void>;
/**
 * Handler registration
 */
export interface HandlerRegistration {
    eventType: string;
    handler: CoordinationEventHandler;
    priority?: number;
}
/**
 * Handle team member registration
 */
export declare const handleTeamMemberRegistered: CoordinationEventHandler<TeamMemberRegisteredEvent>;
/**
 * Handle team member heartbeat
 */
export declare const handleTeamMemberHeartbeat: CoordinationEventHandler<TeamMemberHeartbeatEvent>;
/**
 * Handle team member disconnection
 */
export declare const handleTeamMemberDisconnected: CoordinationEventHandler<TeamMemberDisconnectedEvent>;
/**
 * Handle team member progress report
 */
export declare const handleTeamMemberProgress: CoordinationEventHandler<TeamMemberProgressEvent>;
/**
 * Handle team member waiting for permission
 */
export declare const handleTeamMemberWaitingPermission: CoordinationEventHandler<TeamMemberWaitingPermissionEvent>;
/**
 * Handle team member handoff
 */
export declare const handleTeamMemberHandoff: CoordinationEventHandler<TeamMemberHandoffEvent>;
/**
 * Handle team member completion
 */
export declare const handleTeamMemberCompleted: CoordinationEventHandler<TeamMemberCompletedEvent>;
/**
 * Handle team member error
 */
export declare const handleTeamMemberError: CoordinationEventHandler<TeamMemberErrorEvent>;
/**
 * Handle broadcast message
 */
export declare const handleBroadcast: CoordinationEventHandler<BroadcastEvent>;
/**
 * Handle direct message
 */
export declare const handleDirectMessage: CoordinationEventHandler<DirectMessageEvent>;
/**
 * All built-in handlers
 */
export declare const BUILT_IN_HANDLERS: HandlerRegistration[];
/**
 * CoordinationEventDispatcher - Manages event routing and handler execution
 *
 * Integrates with LWJEB event bus for fast event propagation.
 */
export declare class CoordinationEventDispatcher {
    private publisher;
    private context;
    private customHandlers;
    constructor(registry: TeamMemberRegistry, broadcast: (event: CoordinationEvent, excludeTeamMemberId?: string) => void, sendToTeamMember: (teamMemberId: string, event: CoordinationEvent) => boolean);
    /**
     * Register built-in handlers with the event bus
     */
    private registerBuiltInHandlers;
    /**
     * Register a custom handler
     */
    registerHandler(eventType: string, handler: CoordinationEventHandler, priority?: number): void;
    /**
     * Dispatch an event through the event bus
     */
    dispatch(event: CoordinationEvent): Promise<void>;
    /**
     * Dispatch an event asynchronously (fire and forget)
     */
    dispatchAsync(event: CoordinationEvent): void;
    /**
     * Get dispatch metrics
     */
    getMetrics(): import("../events/metrics.js").MetricStats;
    /**
     * Shutdown the dispatcher
     */
    shutdown(): Promise<void>;
}
/**
 * Route an event to the appropriate handler based on type
 */
export declare function routeEvent(event: CoordinationEvent, context: HandlerContext): void | Promise<void>;
//# sourceMappingURL=handlers.d.ts.map