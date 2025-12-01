/**
 * TeamMemberRegistry.ts - TeamMember State Management
 *
 * Tracks active teamMembers, their states, and connection health.
 * Provides fast lookup and state management for coordinated team members.
 *
 * @author hardwicksoftwareservices
 */
import { EventEmitter } from 'events';
import { createTeamMemberRegisteredEvent, createTeamMemberHeartbeatEvent } from './events.js';
import { logger } from '../utils/logger.js';
/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
    heartbeatTimeoutMs: 30000,
    cleanupIntervalMs: 10000,
    maxTeamMembers: 100,
    autoCleanup: true
};
/**
 * TeamMemberRegistry - In-memory team member state management
 *
 * Features:
 * - Fast O(1) team member lookup by ID
 * - Heartbeat monitoring with automatic cleanup
 * - State transitions with event emission
 * - Connection tracking
 */
export class TeamMemberRegistry extends EventEmitter {
    teamMembers = new Map();
    connectionToTeamMember = new Map();
    config;
    cleanupInterval = null;
    startTime;
    constructor(config) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.startTime = Date.now();
        if (this.config.autoCleanup) {
            this.startCleanupInterval();
        }
        logger.info({ config: this.config }, 'TeamMemberRegistry initialized');
    }
    /**
     * Register a new team member
     */
    register(teamMember, connectionId) {
        // Check capacity
        if (this.teamMembers.size >= this.config.maxTeamMembers) {
            throw new Error(`Maximum team member capacity reached (${this.config.maxTeamMembers})`);
        }
        // Check for duplicate
        if (this.teamMembers.has(teamMember.teamMemberId)) {
            logger.warn({ teamMemberId: teamMember.teamMemberId }, 'Team Member already registered, updating');
            return this.update(teamMember.teamMemberId, { teamMember, connectionId });
        }
        const now = Date.now();
        const entry = {
            teamMember,
            state: 'initializing',
            registeredAt: now,
            lastHeartbeat: now,
            lastActivity: now,
            connectionId,
            metrics: {
                heartbeatsReceived: 0,
                eventsProcessed: 0,
                errorsEncountered: 0,
                tasksCompleted: 0
            }
        };
        this.teamMembers.set(teamMember.teamMemberId, entry);
        if (connectionId) {
            this.connectionToTeamMember.set(connectionId, teamMember.teamMemberId);
        }
        // Emit registration event
        const event = createTeamMemberRegisteredEvent(teamMember);
        this.emit('teamMember:registered', event);
        logger.info({
            teamMemberId: teamMember.teamMemberId,
            name: teamMember.name,
            type: teamMember.type,
            connectionId
        }, 'Team Member registered');
        return entry;
    }
    /**
     * Unregister a team member
     */
    unregister(teamMemberId, reason = 'normal') {
        const entry = this.teamMembers.get(teamMemberId);
        if (!entry) {
            return false;
        }
        // Remove connection mapping
        if (entry.connectionId) {
            this.connectionToTeamMember.delete(entry.connectionId);
        }
        this.teamMembers.delete(teamMemberId);
        // Emit disconnected event
        this.emit('teamMember:disconnected', {
            type: 'teamMember:disconnected',
            timestamp: Date.now(),
            teamMemberId,
            reason,
            lastState: entry.state
        });
        logger.info({ teamMemberId, reason, lastState: entry.state }, 'Team Member unregistered');
        return true;
    }
    /**
     * Update team member entry
     */
    update(teamMemberId, updates) {
        const entry = this.teamMembers.get(teamMemberId);
        if (!entry) {
            throw new Error(`TeamMember not found: ${teamMemberId}`);
        }
        // Handle connection ID change
        if (updates.connectionId !== undefined && updates.connectionId !== entry.connectionId) {
            if (entry.connectionId) {
                this.connectionToTeamMember.delete(entry.connectionId);
            }
            if (updates.connectionId) {
                this.connectionToTeamMember.set(updates.connectionId, teamMemberId);
            }
        }
        Object.assign(entry, updates);
        entry.lastActivity = Date.now();
        return entry;
    }
    /**
     * Record a heartbeat from a team member
     */
    heartbeat(teamMemberId, state) {
        const entry = this.teamMembers.get(teamMemberId);
        if (!entry) {
            logger.warn({ teamMemberId }, 'Heartbeat from unknown team member');
            return null;
        }
        const now = Date.now();
        entry.lastHeartbeat = now;
        entry.lastActivity = now;
        entry.metrics.heartbeatsReceived++;
        if (state && state !== entry.state) {
            const oldState = entry.state;
            entry.state = state;
            this.emit('teamMember:state_changed', { teamMemberId, oldState, newState: state });
        }
        // Emit heartbeat event
        const uptime = now - entry.registeredAt;
        const event = createTeamMemberHeartbeatEvent(teamMemberId, entry.state, uptime);
        this.emit('teamMember:heartbeat', event);
        return entry;
    }
    /**
     * Update team member state
     */
    setState(teamMemberId, state) {
        const entry = this.teamMembers.get(teamMemberId);
        if (!entry) {
            return false;
        }
        const oldState = entry.state;
        entry.state = state;
        entry.lastActivity = Date.now();
        if (oldState !== state) {
            this.emit('teamMember:state_changed', { teamMemberId, oldState, newState: state });
            logger.debug({ teamMemberId, oldState, newState: state }, 'Team Member state changed');
        }
        return true;
    }
    /**
     * Record an error for a team member
     */
    recordError(teamMemberId) {
        const entry = this.teamMembers.get(teamMemberId);
        if (entry) {
            entry.metrics.errorsEncountered++;
        }
    }
    /**
     * Record task completion for a team member
     */
    recordTaskCompletion(teamMemberId) {
        const entry = this.teamMembers.get(teamMemberId);
        if (entry) {
            entry.metrics.tasksCompleted++;
        }
    }
    /**
     * Record event processed for a team member
     */
    recordEventProcessed(teamMemberId) {
        const entry = this.teamMembers.get(teamMemberId);
        if (entry) {
            entry.metrics.eventsProcessed++;
        }
    }
    /**
     * Get team member by ID
     */
    get(teamMemberId) {
        return this.teamMembers.get(teamMemberId);
    }
    /**
     * Get team member by connection ID
     */
    getByConnection(connectionId) {
        const teamMemberId = this.connectionToTeamMember.get(connectionId);
        return teamMemberId ? this.teamMembers.get(teamMemberId) : undefined;
    }
    /**
     * Check if team member exists
     */
    has(teamMemberId) {
        return this.teamMembers.has(teamMemberId);
    }
    /**
     * Get all team members
     */
    getAll() {
        return Array.from(this.teamMembers.values());
    }
    /**
     * Get all team member IDs
     */
    getTeamMemberIds() {
        return Array.from(this.teamMembers.keys());
    }
    /**
     * Get team members by state
     */
    getByState(state) {
        return this.getAll().filter(entry => entry.state === state);
    }
    /**
     * Get team members by type
     */
    getByType(type) {
        return this.getAll().filter(entry => entry.teamMember.type === type);
    }
    /**
     * Get team members by priority
     */
    getByPriority(priority) {
        return this.getAll().filter(entry => entry.teamMember.priority === priority);
    }
    /**
     * Get team members with specific capability
     */
    getByCapability(capability) {
        return this.getAll().filter(entry => entry.teamMember.capabilities.includes(capability));
    }
    /**
     * Get active team members (not disconnected or error)
     */
    getActive() {
        return this.getAll().filter(entry => entry.state !== 'disconnected' && entry.state !== 'error');
    }
    /**
     * Get stale team members (missed heartbeat)
     */
    getStale() {
        const now = Date.now();
        const threshold = this.config.heartbeatTimeoutMs;
        return this.getAll().filter(entry => (now - entry.lastHeartbeat) > threshold);
    }
    /**
     * Get team member count
     */
    get size() {
        return this.teamMembers.size;
    }
    /**
     * Get registry statistics
     */
    getStats() {
        const teamMembers = this.getAll();
        const staleTeamMembers = this.getStale();
        const byState = {
            initializing: 0,
            ready: 0,
            working: 0,
            waiting_permission: 0,
            blocked: 0,
            completed: 0,
            error: 0,
            disconnected: 0
        };
        const byType = {};
        for (const entry of teamMembers) {
            byState[entry.state]++;
            byType[entry.teamMember.type] = (byType[entry.teamMember.type] || 0) + 1;
        }
        return {
            totalTeamMembers: teamMembers.length,
            activeTeamMembers: teamMembers.length - staleTeamMembers.length,
            staleTeamMembers: staleTeamMembers.length,
            byState,
            byType,
            uptime: Date.now() - this.startTime
        };
    }
    /**
     * Clean up stale team members
     */
    cleanupStale() {
        const staleTeamMembers = this.getStale();
        const cleaned = [];
        for (const entry of staleTeamMembers) {
            this.unregister(entry.teamMember.teamMemberId, 'timeout');
            cleaned.push(entry.teamMember.teamMemberId);
        }
        if (cleaned.length > 0) {
            logger.info({ cleanedTeamMembers: cleaned }, 'Cleaned up stale team members');
        }
        return cleaned;
    }
    /**
     * Start automatic cleanup interval
     */
    startCleanupInterval() {
        this.cleanupInterval = setInterval(() => {
            this.cleanupStale();
        }, this.config.cleanupIntervalMs);
        // Allow process to exit
        if (this.cleanupInterval.unref) {
            this.cleanupInterval.unref();
        }
    }
    /**
     * Stop automatic cleanup
     */
    stopCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
    /**
     * Clear all team members
     */
    clear() {
        const teamMemberIds = this.getTeamMemberIds();
        for (const teamMemberId of teamMemberIds) {
            this.unregister(teamMemberId, 'kicked');
        }
        this.teamMembers.clear();
        this.connectionToTeamMember.clear();
        logger.info('TeamMemberRegistry cleared');
    }
    /**
     * Shutdown the registry
     */
    shutdown() {
        this.stopCleanup();
        this.clear();
        this.removeAllListeners();
        logger.info('TeamMemberRegistry shut down');
    }
    /**
     * Export registry state (for sync)
     */
    exportState() {
        const teamMembers = [];
        const states = {};
        for (const [teamMemberId, entry] of this.teamMembers) {
            teamMembers.push(entry.teamMember);
            states[teamMemberId] = entry.state;
        }
        return {
            teamMembers,
            states,
            timestamp: Date.now()
        };
    }
    /**
     * Import registry state (for sync)
     */
    importState(state) {
        for (const teamMember of state.teamMembers) {
            if (!this.has(teamMember.teamMemberId)) {
                const entry = this.register(teamMember);
                if (state.states[teamMember.teamMemberId]) {
                    entry.state = state.states[teamMember.teamMemberId];
                }
            }
        }
    }
}
// ============================================================================
// Singleton Instance
// ============================================================================
let globalRegistry = null;
/**
 * Get the global team member registry
 */
export function getTeamMemberRegistry(config) {
    if (!globalRegistry) {
        globalRegistry = new TeamMemberRegistry(config);
    }
    return globalRegistry;
}
/**
 * Reset the global registry (for testing)
 */
export function resetTeamMemberRegistry() {
    if (globalRegistry) {
        globalRegistry.shutdown();
        globalRegistry = null;
    }
}
//# sourceMappingURL=TeamMemberRegistry.js.map