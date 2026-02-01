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
import { createSpecMemClient } from './workers/specmemClient.js';
import { EventEmitter } from 'events';
import { getGlobalRegistry, } from './teamMemberRegistry.js';
// ============================================================================
// TeamMemberDiscovery Class
// ============================================================================
export class TeamMemberDiscovery extends EventEmitter {
    client;
    teamMemberId;
    teamMemberName;
    teamMemberType;
    heartbeatIntervalMs;
    teamMemberExpiryMs;
    cleanupIntervalMs;
    heartbeatTimer;
    cleanupTimer;
    isRunning = false;
    currentStatus = 'idle';
    currentTask;
    // Team Member 1 additions for registry integration
    capabilities;
    useRegistry;
    registry = null;
    constructor(teamMemberId, teamMemberName, teamMemberType, config = {}) {
        super();
        this.teamMemberId = teamMemberId;
        this.teamMemberName = teamMemberName;
        this.teamMemberType = teamMemberType;
        this.heartbeatIntervalMs = config.heartbeatIntervalMs || 30000;
        this.teamMemberExpiryMs = config.teamMemberExpiryMs || 60000;
        this.cleanupIntervalMs = config.cleanupIntervalMs || 120000;
        this.client = config.specmemClient || createSpecMemClient({ teamMemberId });
        // Team Member 1 additions
        this.capabilities = config.capabilities || [];
        this.useRegistry = config.useRegistry ?? false;
    }
    // ============================================================================
    // Lifecycle Methods
    // ============================================================================
    /**
     * Start the discovery service
     */
    async start() {
        if (this.isRunning) {
            console.log(`[TeamMemberDiscovery] Already running for team member ${this.teamMemberId}`);
            return true;
        }
        try {
            // Initialize registry if enabled (Team Member 1 addition)
            if (this.useRegistry) {
                this.registry = getGlobalRegistry();
                if (this.registry) {
                    // Register in the central registry
                    await this.registry.register({
                        id: this.teamMemberId,
                        name: this.teamMemberName,
                        type: this.teamMemberType,
                        capabilities: this.capabilities,
                        status: this.currentStatus,
                        load: 0,
                    });
                    console.log(`[TeamMemberDiscovery] Registered in TeamMemberRegistry with capabilities: ${this.capabilities.join(', ')}`);
                }
            }
            // Register this team member
            const registered = await this.registerTeamMember();
            if (!registered) {
                console.error(`[TeamMemberDiscovery] Failed to register team member ${this.teamMemberId}`);
                return false;
            }
            // Send initial heartbeat
            await this.sendHeartbeat();
            // Start periodic heartbeat
            this.heartbeatTimer = setInterval(async () => {
                await this.sendHeartbeat();
                // Also update registry heartbeat (Team Member 1 addition)
                if (this.registry) {
                    await this.registry.heartbeat(this.teamMemberId);
                }
            }, this.heartbeatIntervalMs);
            // Start periodic cleanup of stale team members
            this.cleanupTimer = setInterval(async () => {
                await this.cleanupStaleTeamMembers();
            }, this.cleanupIntervalMs);
            this.isRunning = true;
            console.log(`[TeamMemberDiscovery] Started for team member ${this.teamMemberId} (${this.teamMemberName})`);
            console.log(`  Heartbeat interval: ${this.heartbeatIntervalMs}ms`);
            console.log(`  TeamMember expiry: ${this.teamMemberExpiryMs}ms`);
            if (this.capabilities.length > 0) {
                console.log(`  Capabilities: ${this.capabilities.join(', ')}`);
            }
            this.emit('started', { teamMemberId: this.teamMemberId });
            return true;
        }
        catch (error) {
            console.error(`[TeamMemberDiscovery] Start error:`, error);
            return false;
        }
    }
    /**
     * Stop the discovery service
     */
    async stop() {
        if (!this.isRunning)
            return;
        // Clear timers
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
        // Mark team member as offline
        await this.setStatus('offline');
        this.isRunning = false;
        console.log(`[TeamMemberDiscovery] Stopped for team member ${this.teamMemberId}`);
        this.emit('stopped', { teamMemberId: this.teamMemberId });
    }
    // ============================================================================
    // Registration & Heartbeat
    // ============================================================================
    /**
     * Register this team member in the registry
     */
    async registerTeamMember() {
        const tags = [
            'team-member-registration',
            `teamMember:${this.teamMemberId}`,
            `type:${this.teamMemberType}`,
        ];
        const memory = await this.client.remember(`TeamMember ${this.teamMemberName} (${this.teamMemberId}) registered as ${this.teamMemberType}`, {
            memoryType: 'episodic',
            importance: 'high',
            tags,
            metadata: {
                teamMemberId: this.teamMemberId,
                teamMemberName: this.teamMemberName,
                teamMemberType: this.teamMemberType,
                registeredAt: new Date().toISOString(),
            },
        });
        if (memory) {
            console.log(`[TeamMemberDiscovery] TeamMember ${this.teamMemberId} registered successfully`);
            return true;
        }
        return false;
    }
    /**
     * Send a heartbeat to indicate this team member is alive
     *
     * NOTE: Heartbeats are NOT stored as SpecMem memories to prevent memory pollution.
     * TeamMember discovery is handled via team-member-message memories created during communication.
     * Heartbeats only emit events for local listeners.
     */
    async sendHeartbeat() {
        const payload = {
            teamMemberId: this.teamMemberId,
            teamMemberName: this.teamMemberName,
            teamMemberType: this.teamMemberType,
            status: this.currentStatus,
            currentTask: this.currentTask,
            timestamp: new Date(),
        };
        // Emit heartbeat event for local listeners (no memory storage)
        this.emit('heartbeat', payload);
        return true;
    }
    /**
     * Update team member status
     */
    async setStatus(status, task) {
        this.currentStatus = status;
        this.currentTask = task;
        // Send immediate heartbeat with new status
        if (this.isRunning && status !== 'offline') {
            await this.sendHeartbeat();
        }
        this.emit('statusChanged', { status, task });
    }
    // ============================================================================
    // Discovery Methods
    // ============================================================================
    /**
     * Get all active team members (those with recent heartbeats)
     */
    async getActiveTeamMembers(withinMs) {
        const expiryMs = withinMs || this.teamMemberExpiryMs;
        const cutoffTime = new Date(Date.now() - expiryMs);
        // Search for recent heartbeats
        const memories = await this.client.find('team-member-heartbeat', {
            limit: 100,
            tags: ['team-member-heartbeat'],
        });
        const teamMemberMap = new Map();
        for (const memory of memories) {
            const heartbeatTime = new Date(memory.created_at);
            if (heartbeatTime < cutoffTime)
                continue;
            // Extract team member info from tags and metadata
            let teamMemberId;
            let status = 'active';
            for (const tag of memory.tags || []) {
                if (tag.startsWith('teamMember:')) {
                    teamMemberId = tag.substring(6);
                }
                else if (tag.startsWith('status:')) {
                    status = tag.substring(7);
                }
            }
            if (!teamMemberId)
                continue;
            // Keep most recent heartbeat per team member
            const existing = teamMemberMap.get(teamMemberId);
            if (!existing || heartbeatTime > existing.lastHeartbeat) {
                teamMemberMap.set(teamMemberId, {
                    teamMemberId,
                    teamMemberName: memory.metadata?.teamMemberName,
                    teamMemberType: memory.metadata?.teamMemberType,
                    status,
                    lastHeartbeat: heartbeatTime,
                    metadata: memory.metadata,
                });
            }
        }
        return Array.from(teamMemberMap.values()).sort((a, b) => b.lastHeartbeat.getTime() - a.lastHeartbeat.getTime());
    }
    /**
     * Check if a specific team member is online
     */
    async isTeamMemberOnline(targetTeamMemberId) {
        const teamMembers = await this.getActiveTeamMembers();
        return teamMembers.some(a => a.teamMemberId === targetTeamMemberId);
    }
    /**
     * Get detailed info about a specific team member
     */
    async getTeamMemberInfo(targetTeamMemberId) {
        const teamMembers = await this.getActiveTeamMembers();
        return teamMembers.find(a => a.teamMemberId === targetTeamMemberId) || null;
    }
    /**
     * Get team members by type
     */
    async getTeamMembersByType(type) {
        const teamMembers = await this.getActiveTeamMembers();
        return teamMembers.filter(a => a.teamMemberType === type);
    }
    /**
     * Get team members by status
     */
    async getTeamMembersByStatus(status) {
        const teamMembers = await this.getActiveTeamMembers();
        return teamMembers.filter(a => a.status === status);
    }
    // ============================================================================
    // Capability-Based Discovery (Team Member 1 additions)
    // ============================================================================
    /**
     * Get team members by capability
     * Requires useRegistry: true in config
     * @param capability The capability to search for
     */
    async getTeamMembersByCapability(capability) {
        if (!this.registry) {
            console.warn('[TeamMemberDiscovery] getTeamMembersByCapability requires useRegistry: true');
            return [];
        }
        return this.registry.getTeamMembersByCapability(capability);
    }
    /**
     * Get idle team members with a specific capability
     * Requires useRegistry: true in config
     * @param capability The capability to search for
     */
    async getIdleTeamMembersByCapability(capability) {
        if (!this.registry) {
            console.warn('[TeamMemberDiscovery] getIdleTeamMembersByCapability requires useRegistry: true');
            return [];
        }
        return this.registry.getIdleTeamMembersByCapability(capability);
    }
    /**
     * Get available team members (idle or low load) with a specific capability
     * Requires useRegistry: true in config
     * @param capability The capability to search for
     * @param maxLoad Maximum load percentage (default: 50)
     */
    async getAvailableTeamMembersByCapability(capability, maxLoad = 50) {
        if (!this.registry) {
            console.warn('[TeamMemberDiscovery] getAvailableTeamMembersByCapability requires useRegistry: true');
            return [];
        }
        return this.registry.getAvailableTeamMembersByCapability(capability, maxLoad);
    }
    /**
     * Update this team member's load in the registry
     * @param load Load percentage (0-100)
     */
    async updateLoad(load) {
        if (!this.registry) {
            return false;
        }
        return this.registry.updateTeamMemberLoad(this.teamMemberId, load);
    }
    /**
     * Get the underlying TeamMemberRegistry (if available)
     */
    getRegistry() {
        return this.registry;
    }
    // ============================================================================
    // Cleanup Methods
    // ============================================================================
    /**
     * Clean up stale team member heartbeats from database
     * This prevents the database from growing indefinitely
     */
    async cleanupStaleTeamMembers() {
        // For now, we rely on the query filtering to exclude stale heartbeats
        // A more sophisticated implementation could delete old heartbeat records
        // But since specmem is designed for memory, we'll let memories persist
        // Emit event for monitoring
        const staleTeamMembers = await this.getStaleTeamMembers();
        if (staleTeamMembers.length > 0) {
            this.emit('staleTeamMembersDetected', { teamMembers: staleTeamMembers });
        }
    }
    /**
     * Get list of teamMembers with stale heartbeats
     */
    async getStaleTeamMembers() {
        const memories = await this.client.find('team-member-heartbeat', {
            limit: 100,
            tags: ['team-member-heartbeat'],
        });
        const now = Date.now();
        const cutoffTime = new Date(now - this.teamMemberExpiryMs);
        const staleTeamMembers = [];
        const seenTeamMembers = new Set();
        for (const memory of memories) {
            const heartbeatTime = new Date(memory.created_at);
            let teamMemberId;
            for (const tag of memory.tags || []) {
                if (tag.startsWith('teamMember:')) {
                    teamMemberId = tag.substring(6);
                    break;
                }
            }
            if (!teamMemberId || seenTeamMembers.has(teamMemberId))
                continue;
            seenTeamMembers.add(teamMemberId);
            if (heartbeatTime < cutoffTime) {
                staleTeamMembers.push({
                    teamMemberId,
                    teamMemberName: memory.metadata?.teamMemberName,
                    teamMemberType: memory.metadata?.teamMemberType,
                    status: 'offline',
                    lastHeartbeat: heartbeatTime,
                });
            }
        }
        return staleTeamMembers;
    }
    // ============================================================================
    // Utility Methods
    // ============================================================================
    /**
     * Get current team member ID
     */
    getTeamMemberId() {
        return this.teamMemberId;
    }
    /**
     * Get current status
     */
    getStatus() {
        return this.currentStatus;
    }
    /**
     * Check if discovery service is running
     */
    isActive() {
        return this.isRunning;
    }
    /**
     * Get underlying SpecMem client
     */
    getClient() {
        return this.client;
    }
}
// ============================================================================
// Factory Function
// ============================================================================
/**
 * Create an TeamMemberDiscovery instance
 */
export function createTeamMemberDiscovery(teamMemberId, teamMemberName, teamMemberType, config) {
    return new TeamMemberDiscovery(teamMemberId, teamMemberName, teamMemberType, config);
}
// ============================================================================
// Global Registry (for dashboard use)
// ============================================================================
let globalDiscoveryService = null;
/**
 * Get or create global discovery service for the main process
 */
export function getGlobalDiscoveryService() {
    return globalDiscoveryService;
}
/**
 * Initialize global discovery service (called at startup)
 */
export async function initializeGlobalDiscovery(teamMemberId, teamMemberName, teamMemberType = 'overseer', config) {
    if (globalDiscoveryService) {
        await globalDiscoveryService.stop();
    }
    globalDiscoveryService = createTeamMemberDiscovery(teamMemberId, teamMemberName, teamMemberType, config);
    await globalDiscoveryService.start();
    return globalDiscoveryService;
}
/**
 * Shutdown global discovery service
 */
export async function shutdownGlobalDiscovery() {
    if (globalDiscoveryService) {
        await globalDiscoveryService.stop();
        globalDiscoveryService = null;
    }
}
//# sourceMappingURL=teamMemberDiscovery.js.map