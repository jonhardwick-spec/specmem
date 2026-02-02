/**
 * Team Member Discovery System
 *
 * Provides robust team member discovery and registry management:
 * - Heartbeat mechanism with configurable intervals
 * - Team member registry with automatic cleanup of stale team members
 * - Query active team members within specified timeframes
 * - Team member status tracking (active, idle, busy, offline)
 *
 * UPDATED by Team Member 1 (Dynamic Multi-Team-Member System):
 * - Added integration with TeamMemberRegistry for capability-based discovery
 * - Added getTeamMembersByCapability and getAvailableTeamMembers methods
 */
import { SpecMemClient } from './workers/specmemClient.js';
import { EventEmitter } from 'events';
import { TeamMemberRegistry, TeamMemberInfo } from './teamMemberRegistry.js';
export type TeamMemberStatus = 'active' | 'idle' | 'busy' | 'offline';
export interface DiscoveredTeamMember {
    teamMemberId: string;
    teamMemberName?: string;
    teamMemberType?: 'worker' | 'overseer' | 'qa';
    status: TeamMemberStatus;
    lastHeartbeat: Date;
    registeredAt?: Date;
    metadata?: Record<string, any>;
}
export interface HeartbeatPayload {
    teamMemberId: string;
    teamMemberName?: string;
    teamMemberType?: string;
    status: TeamMemberStatus;
    currentTask?: string;
    tokensUsed?: number;
    memoryUsed?: number;
    timestamp: Date;
}
export interface DiscoveryConfig {
    heartbeatIntervalMs?: number;
    teamMemberExpiryMs?: number;
    cleanupIntervalMs?: number;
    specmemClient?: SpecMemClient;
    /** Optional capabilities for this team member (Team Member 1 addition) */
    capabilities?: string[];
    /** Use TeamMemberRegistry for advanced queries (Team Member 1 addition) */
    useRegistry?: boolean;
}
export declare class TeamMemberDiscovery extends EventEmitter {
    private client;
    private teamMemberId;
    private teamMemberName;
    private teamMemberType;
    private heartbeatIntervalMs;
    private teamMemberExpiryMs;
    private cleanupIntervalMs;
    private heartbeatTimer?;
    private cleanupTimer?;
    private isRunning;
    private currentStatus;
    private currentTask?;
    private capabilities;
    private useRegistry;
    private registry;
    constructor(teamMemberId: string, teamMemberName: string, teamMemberType: string, config?: DiscoveryConfig);
    /**
     * Start the discovery service
     */
    start(): Promise<boolean>;
    /**
     * Stop the discovery service
     */
    stop(): Promise<void>;
    /**
     * Register this team member in the registry
     */
    private registerTeamMember;
    /**
     * Send a heartbeat to indicate this team member is alive
     *
     * NOTE: Heartbeats are NOT stored as SpecMem memories to prevent memory pollution.
     * TeamMember discovery is handled via team-member-message memories created during communication.
     * Heartbeats only emit events for local listeners.
     */
    sendHeartbeat(): Promise<boolean>;
    /**
     * Update team member status
     */
    setStatus(status: TeamMemberStatus, task?: string): Promise<void>;
    /**
     * Get all active team members (those with recent heartbeats)
     */
    getActiveTeamMembers(withinMs?: number): Promise<DiscoveredTeamMember[]>;
    /**
     * Check if a specific team member is online
     */
    isTeamMemberOnline(targetTeamMemberId: string): Promise<boolean>;
    /**
     * Get detailed info about a specific team member
     */
    getTeamMemberInfo(targetTeamMemberId: string): Promise<DiscoveredTeamMember | null>;
    /**
     * Get team members by type
     */
    getTeamMembersByType(type: 'worker' | 'overseer' | 'qa'): Promise<DiscoveredTeamMember[]>;
    /**
     * Get team members by status
     */
    getTeamMembersByStatus(status: TeamMemberStatus): Promise<DiscoveredTeamMember[]>;
    /**
     * Get team members by capability
     * Requires useRegistry: true in config
     * @param capability The capability to search for
     */
    getTeamMembersByCapability(capability: string): Promise<TeamMemberInfo[]>;
    /**
     * Get idle team members with a specific capability
     * Requires useRegistry: true in config
     * @param capability The capability to search for
     */
    getIdleTeamMembersByCapability(capability: string): Promise<TeamMemberInfo[]>;
    /**
     * Get available team members (idle or low load) with a specific capability
     * Requires useRegistry: true in config
     * @param capability The capability to search for
     * @param maxLoad Maximum load percentage (default: 50)
     */
    getAvailableTeamMembersByCapability(capability: string, maxLoad?: number): Promise<TeamMemberInfo[]>;
    /**
     * Update this team member's load in the registry
     * @param load Load percentage (0-100)
     */
    updateLoad(load: number): Promise<boolean>;
    /**
     * Get the underlying TeamMemberRegistry (if available)
     */
    getRegistry(): TeamMemberRegistry | null;
    /**
     * Clean up stale team member heartbeats from database
     * This prevents the database from growing indefinitely
     */
    private cleanupStaleTeamMembers;
    /**
     * Get list of teamMembers with stale heartbeats
     */
    private getStaleTeamMembers;
    /**
     * Get current team member ID
     */
    getTeamMemberId(): string;
    /**
     * Get current status
     */
    getStatus(): TeamMemberStatus;
    /**
     * Check if discovery service is running
     */
    isActive(): boolean;
    /**
     * Get underlying SpecMem client
     */
    getClient(): SpecMemClient;
}
/**
 * Create an TeamMemberDiscovery instance
 */
export declare function createTeamMemberDiscovery(teamMemberId: string, teamMemberName: string, teamMemberType: string, config?: DiscoveryConfig): TeamMemberDiscovery;
/**
 * Get or create global discovery service for the main process
 */
export declare function getGlobalDiscoveryService(): TeamMemberDiscovery | null;
/**
 * Initialize global discovery service (called at startup)
 */
export declare function initializeGlobalDiscovery(teamMemberId: string, teamMemberName: string, teamMemberType?: string, config?: DiscoveryConfig): Promise<TeamMemberDiscovery>;
/**
 * Shutdown global discovery service
 */
export declare function shutdownGlobalDiscovery(): Promise<void>;
//# sourceMappingURL=teamMemberDiscovery.d.ts.map