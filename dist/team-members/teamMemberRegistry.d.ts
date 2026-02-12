/**
 * Team Member Registry - Dynamic Team Member Registration & Discovery
 *
 * Maintains a registry of ALL active team members with:
 * - TeamMember metadata (ID, type, capabilities, status, load)
 * - Heartbeat-based lifecycle management
 * - Query interfaces for capability and load-based discovery
 *
 * PENDING TEAM REVIEW:
 * - Team Member 2: TeamMemberInfo interface, storage schema integration
 * - Team Member 3: Dashboard integration, query methods for TaskOrchestrator
 *
 * SpecMem Tag Schema:
 * ['team-member-registry', 'teamMember:{id}', 'status:{status}', 'capability:{cap}', 'load:{bucket}', 'type:{type}']
 */
import { SpecMemClient, Memory } from './workers/specmemClient.js';
import { EventEmitter } from 'events';
export type TeamMemberStatus = 'active' | 'idle' | 'busy' | 'offline';
export type LoadBucket = 'low' | 'medium' | 'high';
/**
 * TeamMemberInfo - Complete information about a registered team member
 *
 * DISCUSSION NEEDED with Team Member 2:
 * - Should capabilities be string[] or a more structured type?
 * - Should we add 'group' or 'team' field for channel integration?
 */
export interface TeamMemberInfo {
    id: string;
    name?: string;
    type: string;
    capabilities: string[];
    status: TeamMemberStatus;
    load: number;
    loadBucket: LoadBucket;
    lastHeartbeat: Date;
    registeredAt: Date;
    metadata: Record<string, any>;
}
/**
 * Input for registering a new team member (some fields auto-generated)
 */
export interface TeamMemberRegistrationInput {
    id: string;
    name?: string;
    type: string;
    capabilities: string[];
    status?: TeamMemberStatus;
    load?: number;
    metadata?: Record<string, any>;
}
/**
 * TeamMemberRegistry interface - for mock implementations and testing
 *
 * DISCUSSION NEEDED with Team Member 3:
 * - Are getIdleTeamMembersByCapability and getAvailableTeamMembersByCapability sufficient?
 * - Do you need additional query methods for TaskOrchestrator?
 */
export interface ITeamMemberRegistry {
    register(input: TeamMemberRegistrationInput): Promise<TeamMemberInfo>;
    unregister(teamMemberId: string): Promise<boolean>;
    getTeamMember(teamMemberId: string): Promise<TeamMemberInfo | null>;
    getAllTeamMembers(): Promise<TeamMemberInfo[]>;
    getTeamMembersByCapability(capability: string): Promise<TeamMemberInfo[]>;
    getTeamMembersByStatus(status: TeamMemberStatus): Promise<TeamMemberInfo[]>;
    getTeamMembersByType(type: string): Promise<TeamMemberInfo[]>;
    getIdleTeamMembersByCapability(capability: string): Promise<TeamMemberInfo[]>;
    getAvailableTeamMembersByCapability(capability: string, maxLoad?: number): Promise<TeamMemberInfo[]>;
    updateTeamMemberStatus(teamMemberId: string, status: TeamMemberStatus): Promise<boolean>;
    updateTeamMemberLoad(teamMemberId: string, load: number): Promise<boolean>;
    heartbeat(teamMemberId: string): Promise<boolean>;
    cleanupStaleTeamMembers(): Promise<string[]>;
    getTeamMemberCount(): Promise<number>;
    getTeamMemberCountByStatus(): Promise<Record<TeamMemberStatus, number>>;
}
export interface TeamMemberRegistryConfig {
    /** Heartbeat timeout in milliseconds - team members offline after this (default: 60000) */
    heartbeatTimeoutMs?: number;
    /** Cleanup interval in milliseconds (default: 120000) */
    cleanupIntervalMs?: number;
    /** Auto-cleanup stale team members (default: true) */
    autoCleanup?: boolean;
    /** SpecMem client (optional - will create default if not provided) */
    client?: SpecMemClient;
}
/**
 * Calculate load bucket from numeric load value
 */
export declare function calculateLoadBucket(load: number): LoadBucket;
/**
 * Create registry tags for a team member
 */
export declare function createRegistryTags(teamMember: TeamMemberInfo): string[];
/**
 * Parse team member info from memory
 */
export declare function parseTeamMemberFromMemory(memory: Memory): TeamMemberInfo | null;
export declare class TeamMemberRegistry extends EventEmitter implements ITeamMemberRegistry {
    private client;
    private heartbeatTimeoutMs;
    private cleanupIntervalMs;
    private autoCleanup;
    private cleanupTimer?;
    private localCache;
    private isRunning;
    constructor(config?: TeamMemberRegistryConfig);
    /**
     * Start the registry service
     */
    start(): Promise<void>;
    /**
     * Stop the registry service
     */
    stop(): Promise<void>;
    /**
     * Register a new team member
     */
    register(input: TeamMemberRegistrationInput): Promise<TeamMemberInfo>;
    /**
     * Unregister a team member
     */
    unregister(teamMemberId: string): Promise<boolean>;
    /**
     * Get a specific team member by ID
     */
    getTeamMember(teamMemberId: string): Promise<TeamMemberInfo | null>;
    /**
     * Get all registered team members
     */
    getAllTeamMembers(): Promise<TeamMemberInfo[]>;
    /**
     * Get team members by capability
     */
    getTeamMembersByCapability(capability: string): Promise<TeamMemberInfo[]>;
    /**
     * Get team members by status
     */
    getTeamMembersByStatus(status: TeamMemberStatus): Promise<TeamMemberInfo[]>;
    /**
     * Get team members by type
     */
    getTeamMembersByType(type: string): Promise<TeamMemberInfo[]>;
    /**
     * Get idle team members with a specific capability
     */
    getIdleTeamMembersByCapability(capability: string): Promise<TeamMemberInfo[]>;
    /**
     * Get available team members (idle or active with low load) with a specific capability
     */
    getAvailableTeamMembersByCapability(capability: string, maxLoad?: number): Promise<TeamMemberInfo[]>;
    /**
     * Update team member status
     */
    updateTeamMemberStatus(teamMemberId: string, status: TeamMemberStatus): Promise<boolean>;
    /**
     * Update team member load
     */
    updateTeamMemberLoad(teamMemberId: string, load: number): Promise<boolean>;
    /**
     * Send heartbeat for a team member
     */
    heartbeat(teamMemberId: string): Promise<boolean>;
    /**
     * Clean up stale team members (no heartbeat within timeout)
     */
    cleanupStaleTeamMembers(): Promise<string[]>;
    /**
     * Get total number of registered team members (not offline)
     */
    getTeamMemberCount(): Promise<number>;
    /**
     * Get count of teamMembers by status
     */
    getTeamMemberCountByStatus(): Promise<Record<TeamMemberStatus, number>>;
    /**
     * Refresh local cache from SpecMem
     */
    private refreshCache;
    /**
     * Parse unique team members from memories (keeping most recent)
     */
    private parseUniqueTeamMembers;
}
/**
 * Create a new TeamMemberRegistry instance
 */
export declare function createTeamMemberRegistry(config?: TeamMemberRegistryConfig): TeamMemberRegistry;
/**
 * Get the global registry instance
 */
export declare function getGlobalRegistry(): TeamMemberRegistry;
/**
 * Initialize and start the global registry
 */
export declare function initializeGlobalRegistry(config?: TeamMemberRegistryConfig): Promise<TeamMemberRegistry>;
/**
 * Shutdown the global registry
 */
export declare function shutdownGlobalRegistry(): Promise<void>;
//# sourceMappingURL=teamMemberRegistry.d.ts.map