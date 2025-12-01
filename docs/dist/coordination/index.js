/**
 * coordination/index.ts - TeamMember Coordination Module Exports
 *
 * Provides inter-team member communication via HTTP/WebSocket with
 * LWJEB event bus integration for sub-10ms event propagation.
 *
 * @author hardwicksoftwareservices
 */
// Event types
export { 
// Event type constants
TEAM_MEMBER_EVENT_TYPES, COORDINATION_EVENT_TYPES, SERVER_EVENT_TYPES, 
// Type guards
isTeamMemberEvent, isCoordinationControlEvent, isServerEvent, isTeamMemberRegisteredEvent, isTeamMemberHeartbeatEvent, isTeamMemberDisconnectedEvent, isTeamMemberProgressEvent, isTeamMemberWaitingPermissionEvent, isTeamMemberHandoffEvent, isTeamMemberCompletedEvent, isTeamMemberErrorEvent, 
// Event factories
createBaseEvent, createTeamMemberRegisteredEvent, createTeamMemberHeartbeatEvent, createTeamMemberProgressEvent, createTeamMemberCompletedEvent, createTeamMemberErrorEvent, createBroadcastEvent, 
// Hot Reload events
RELOAD_EVENTS, RELOAD_EVENT_TYPES, isReloadEvent, createReloadRequestedEvent, createReloadDrainingEvent, createReloadCompleteEvent } from './events.js';
// Team member registry
export { TeamMemberRegistry, getTeamMemberRegistry, resetTeamMemberRegistry } from './TeamMemberRegistry.js';
// Event handlers
export { CoordinationEventDispatcher, BUILT_IN_HANDLERS, handleTeamMemberRegistered, handleTeamMemberHeartbeat, handleTeamMemberDisconnected, handleTeamMemberProgress, handleTeamMemberWaitingPermission, handleTeamMemberHandoff, handleTeamMemberCompleted, handleTeamMemberError, handleBroadcast, handleDirectMessage, routeEvent } from './handlers.js';
// Server
export { CoordinationServer, createCoordinationServer, getCoordinationServer, resetCoordinationServer, 
// Lazy initialization (preferred for on-demand startup)
configureLazyCoordinationServer, disableLazyCoordinationServer, isCoordinationServerRunning, isCoordinationServerAvailable, getLazyCoordinationServer, resetLazyCoordinationServer, getLazyCoordinationServerStatus, requireCoordinationServer, executeLazyShutdownHandlers, registerLazyShutdownHandler, } from './server.js';
// Integration (Central Event Hub)
export { 
// Coordinator
SpecMemCoordinator, getCoordinator, resetCoordinator } from './integration.js';
//# sourceMappingURL=index.js.map