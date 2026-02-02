/**
 * TeamMemberRegistry.ts - TeamMember State Management
 *
 * Tracks active teamMembers, their states, and connection health.
 * Provides fast lookup and state management for coordinated team members.
 *
 * @author hardwicksoftwareservices
 */
import { EventEmitter } from 'events';
import { TeamMemberInfo, TeamMemberState, TeamMemberPriority } from './events.js';
/**
 * Team member registry entry with full state information
 */
export interface TeamMemberEntry {
    teamMember: TeamMemberInfo;
    state: TeamMemberState;
    registeredAt: number;
    lastHeartbeat: number;
    lastActivity: number;
    connectionId?: string;
    metrics: {
        heartbeatsReceived: number;
        eventsProcessed: number;
        errorsEncountered: number;
        tasksCompleted: number;
    };
}
/**
 * Registry configuration
 */
export interface TeamMemberRegistryConfig {
    /** Heartbeat timeout in milliseconds (default: 30000) */
    heartbeatTimeoutMs: number;
    /** Cleanup interval in milliseconds (default: 10000) */
    cleanupIntervalMs: number;
    /** Maximum team members allowed (default: 100) */
    maxTeamMembers: number;
    /** Enable automatic cleanup of stale team members */
    autoCleanup: boolean;
}
/**
 * TeamMemberRegistry - In-memory team member state management
 *
 * Features:
 * - Fast O(1) team member lookup by ID
 * - Heartbeat monitoring with automatic cleanup
 * - State transitions with event emission
 * - Connection tracking
 */
export declare class TeamMemberRegistry extends EventEmitter {
    private teamMembers;
    private connectionToTeamMember;
    private config;
    private cleanupInterval;
    private startTime;
    constructor(config?: Partial<TeamMemberRegistryConfig>);
    /**
     * Register a new team member
     */
    register(teamMember: TeamMemberInfo, connectionId?: string): TeamMemberEntry;
    /**
     * Unregister a team member
     */
    unregister(teamMemberId: string, reason?: 'normal' | 'timeout' | 'error' | 'kicked'): boolean;
    /**
     * Update team member entry
     */
    update(teamMemberId: string, updates: Partial<Omit<TeamMemberEntry, 'metrics'>>): TeamMemberEntry;
    /**
     * Record a heartbeat from a team member
     */
    heartbeat(teamMemberId: string, state?: TeamMemberState): TeamMemberEntry | null;
    /**
     * Update team member state
     */
    setState(teamMemberId: string, state: TeamMemberState): boolean;
    /**
     * Record an error for a team member
     */
    recordError(teamMemberId: string): void;
    /**
     * Record task completion for a team member
     */
    recordTaskCompletion(teamMemberId: string): void;
    /**
     * Record event processed for a team member
     */
    recordEventProcessed(teamMemberId: string): void;
    /**
     * Get team member by ID
     */
    get(teamMemberId: string): TeamMemberEntry | undefined;
    /**
     * Get team member by connection ID
     */
    getByConnection(connectionId: string): TeamMemberEntry | undefined;
    /**
     * Check if team member exists
     */
    has(teamMemberId: string): boolean;
    /**
     * Get all team members
     */
    getAll(): TeamMemberEntry[];
    /**
     * Get all team member IDs
     */
    getTeamMemberIds(): string[];
    /**
     * Get team members by state
     */
    getByState(state: TeamMemberState): TeamMemberEntry[];
    /**
     * Get team members by type
     */
    getByType(type: string): TeamMemberEntry[];
    /**
     * Get team members by priority
     */
    getByPriority(priority: TeamMemberPriority): TeamMemberEntry[];
    /**
     * Get team members with specific capability
     */
    getByCapability(capability: string): TeamMemberEntry[];
    /**
     * Get active team members (not disconnected or error)
     */
    getActive(): TeamMemberEntry[];
    /**
     * Get stale team members (missed heartbeat)
     */
    getStale(): TeamMemberEntry[];
    /**
     * Get team member count
     */
    get size(): number;
    /**
     * Get registry statistics
     */
    getStats(): {
        totalTeamMembers: number;
        activeTeamMembers: number;
        staleTeamMembers: number;
        byState: Record<TeamMemberState, number>;
        byType: Record<string, number>;
        uptime: number;
    };
    /**
     * Clean up stale team members
     */
    cleanupStale(): string[];
    /**
     * Start automatic cleanup interval
     */
    private startCleanupInterval;
    /**
     * Stop automatic cleanup
     */
    stopCleanup(): void;
    /**
     * Clear all team members
     */
    clear(): void;
    /**
     * Shutdown the registry
     */
    shutdown(): void;
    /**
     * Export registry state (for sync)
     */
    exportState(): {
        teamMembers: TeamMemberInfo[];
        states: Record<string, TeamMemberState>;
        timestamp: number;
    };
    /**
     * Import registry state (for sync)
     */
    importState(state: {
        teamMembers: TeamMemberInfo[];
        states: Record<string, TeamMemberState>;
    }): void;
}
/**
 * Get the global team member registry
 */
export declare function getTeamMemberRegistry(config?: Partial<TeamMemberRegistryConfig>): TeamMemberRegistry;
/**
 * Reset the global registry (for testing)
 */
export declare function resetTeamMemberRegistry(): void;
//# sourceMappingURL=TeamMemberRegistry.d.ts.map