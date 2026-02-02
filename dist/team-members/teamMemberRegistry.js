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
import { createSpecMemClient } from './workers/specmemClient.js';
import { EventEmitter } from 'events';
// ============================================================================
// Utility Functions
// ============================================================================
/**
 * Calculate load bucket from numeric load value
 */
export function calculateLoadBucket(load) {
    if (load <= 33)
        return 'low';
    if (load <= 66)
        return 'medium';
    return 'high';
}
/**
 * Create registry tags for a team member
 */
export function createRegistryTags(teamMember) {
    const tags = [
        'team-member-registry',
        `teamMember:${teamMember.id}`,
        `status:${teamMember.status}`,
        `type:${teamMember.type}`,
        `load:${teamMember.loadBucket}`,
    ];
    // Add capability tags
    for (const cap of teamMember.capabilities) {
        tags.push(`capability:${cap}`);
    }
    return tags;
}
/**
 * Parse team member info from memory
 */
export function parseTeamMemberFromMemory(memory) {
    if (!memory.metadata?.teamMemberId)
        return null;
    // Extract status from tags
    let status = 'active';
    let type = 'worker';
    let loadBucket = 'low';
    const capabilities = [];
    for (const tag of memory.tags || []) {
        if (tag.startsWith('status:')) {
            status = tag.substring(7);
        }
        else if (tag.startsWith('type:')) {
            type = tag.substring(5);
        }
        else if (tag.startsWith('load:')) {
            loadBucket = tag.substring(5);
        }
        else if (tag.startsWith('capability:')) {
            capabilities.push(tag.substring(11));
        }
    }
    return {
        id: memory.metadata.teamMemberId,
        name: memory.metadata.teamMemberName,
        type: memory.metadata.teamMemberType || type,
        capabilities: memory.metadata.capabilities || capabilities,
        status: memory.metadata.status || status,
        load: memory.metadata.load ?? 0,
        loadBucket: memory.metadata.loadBucket || loadBucket,
        lastHeartbeat: new Date(memory.metadata.lastHeartbeat || memory.created_at),
        registeredAt: new Date(memory.metadata.registeredAt || memory.created_at),
        metadata: memory.metadata.customMetadata || {},
    };
}
// ============================================================================
// TeamMemberRegistry Implementation
// ============================================================================
export class TeamMemberRegistry extends EventEmitter {
    client;
    heartbeatTimeoutMs;
    cleanupIntervalMs;
    autoCleanup;
    cleanupTimer;
    localCache = new Map();
    isRunning = false;
    constructor(config = {}) {
        super();
        this.heartbeatTimeoutMs = config.heartbeatTimeoutMs ?? 60000;
        this.cleanupIntervalMs = config.cleanupIntervalMs ?? 120000;
        this.autoCleanup = config.autoCleanup ?? true;
        this.client = config.client ?? createSpecMemClient({ teamMemberId: 'team-member-registry' });
    }
    // ==========================================================================
    // Lifecycle
    // ==========================================================================
    /**
     * Start the registry service
     */
    async start() {
        if (this.isRunning)
            return;
        console.log('[TeamMemberRegistry] Starting...');
        // Load existing team members into cache
        await this.refreshCache();
        // Start auto-cleanup if enabled
        if (this.autoCleanup) {
            this.cleanupTimer = setInterval(async () => {
                const staleIds = await this.cleanupStaleTeamMembers();
                if (staleIds.length > 0) {
                    console.log(`[TeamMemberRegistry] Cleaned up ${staleIds.length} stale team members`);
                }
            }, this.cleanupIntervalMs);
        }
        this.isRunning = true;
        console.log('[TeamMemberRegistry] Started');
        this.emit('started');
    }
    /**
     * Stop the registry service
     */
    async stop() {
        if (!this.isRunning)
            return;
        console.log('[TeamMemberRegistry] Stopping...');
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
        this.localCache.clear();
        this.isRunning = false;
        console.log('[TeamMemberRegistry] Stopped');
        this.emit('stopped');
    }
    // ==========================================================================
    // Registration
    // ==========================================================================
    /**
     * Register a new team member
     */
    async register(input) {
        const now = new Date();
        const load = input.load ?? 0;
        const teamMember = {
            id: input.id,
            name: input.name,
            type: input.type,
            capabilities: input.capabilities,
            status: input.status ?? 'active',
            load,
            loadBucket: calculateLoadBucket(load),
            lastHeartbeat: now,
            registeredAt: now,
            metadata: input.metadata ?? {},
        };
        const tags = createRegistryTags(teamMember);
        const memory = await this.client.remember(`TeamMember ${teamMember.name || teamMember.id} registered (${teamMember.type})`, {
            memoryType: 'episodic',
            importance: 'high',
            tags,
            metadata: {
                teamMemberId: teamMember.id,
                teamMemberName: teamMember.name,
                teamMemberType: teamMember.type,
                capabilities: teamMember.capabilities,
                status: teamMember.status,
                load: teamMember.load,
                loadBucket: teamMember.loadBucket,
                lastHeartbeat: now.toISOString(),
                registeredAt: now.toISOString(),
                customMetadata: teamMember.metadata,
            },
        });
        if (!memory) {
            throw new Error(`Failed to register team member ${teamMember.id}`);
        }
        // Update local cache
        this.localCache.set(teamMember.id, teamMember);
        console.log(`[TeamMemberRegistry] TeamMember ${teamMember.id} registered`);
        this.emit('teamMemberRegistered', teamMember);
        return teamMember;
    }
    /**
     * Unregister a team member
     */
    async unregister(teamMemberId) {
        // Mark team member as offline in SpecMem
        const teamMember = await this.getTeamMember(teamMemberId);
        if (!teamMember) {
            return false;
        }
        // Update status to offline
        await this.updateTeamMemberStatus(teamMemberId, 'offline');
        // Remove from cache
        this.localCache.delete(teamMemberId);
        console.log(`[TeamMemberRegistry] TeamMember ${teamMemberId} unregistered`);
        this.emit('teamMemberUnregistered', teamMemberId);
        return true;
    }
    // ==========================================================================
    // Single TeamMember Queries
    // ==========================================================================
    /**
     * Get a specific team member by ID
     */
    async getTeamMember(teamMemberId) {
        // Check cache first
        const cached = this.localCache.get(teamMemberId);
        if (cached) {
            return cached;
        }
        // Query SpecMem
        const memories = await this.client.find(`team member registry ${teamMemberId}`, {
            limit: 10,
            tags: ['team-member-registry', `teamMember:${teamMemberId}`],
        });
        if (memories.length === 0) {
            return null;
        }
        // Get most recent registration
        const sorted = memories.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        const teamMember = parseTeamMemberFromMemory(sorted[0]);
        if (teamMember) {
            this.localCache.set(teamMemberId, teamMember);
        }
        return teamMember;
    }
    // ==========================================================================
    // Bulk Queries
    // ==========================================================================
    /**
     * Get all registered team members
     */
    async getAllTeamMembers() {
        const memories = await this.client.find('team member registry', {
            limit: 1000,
            tags: ['team-member-registry'],
        });
        const teamMemberMap = new Map();
        // Keep only most recent record per team member
        for (const memory of memories) {
            const teamMemberId = memory.metadata?.teamMemberId;
            if (!teamMemberId)
                continue;
            const timestamp = new Date(memory.created_at);
            const existing = teamMemberMap.get(teamMemberId);
            if (!existing || timestamp > existing.timestamp) {
                teamMemberMap.set(teamMemberId, { memory, timestamp });
            }
        }
        const teamMembers = [];
        const now = new Date();
        for (const { memory } of teamMemberMap.values()) {
            const teamMember = parseTeamMemberFromMemory(memory);
            if (!teamMember)
                continue;
            // Check if team member is stale
            const timeSinceHeartbeat = now.getTime() - teamMember.lastHeartbeat.getTime();
            if (timeSinceHeartbeat > this.heartbeatTimeoutMs && teamMember.status !== 'offline') {
                teamMember.status = 'offline';
            }
            // Update cache
            this.localCache.set(teamMember.id, teamMember);
            teamMembers.push(teamMember);
        }
        return teamMembers;
    }
    /**
     * Get team members by capability
     */
    async getTeamMembersByCapability(capability) {
        const memories = await this.client.find(`team member registry capability ${capability}`, {
            limit: 100,
            tags: ['team-member-registry', `capability:${capability}`],
        });
        return this.parseUniqueTeamMembers(memories);
    }
    /**
     * Get team members by status
     */
    async getTeamMembersByStatus(status) {
        const memories = await this.client.find(`team member registry status ${status}`, {
            limit: 100,
            tags: ['team-member-registry', `status:${status}`],
        });
        return this.parseUniqueTeamMembers(memories);
    }
    /**
     * Get team members by type
     */
    async getTeamMembersByType(type) {
        const memories = await this.client.find(`team member registry type ${type}`, {
            limit: 100,
            tags: ['team-member-registry', `type:${type}`],
        });
        return this.parseUniqueTeamMembers(memories);
    }
    // ==========================================================================
    // Smart Queries (for Team Member 3's TaskOrchestrator)
    // ==========================================================================
    /**
     * Get idle team members with a specific capability
     */
    async getIdleTeamMembersByCapability(capability) {
        const teamMembers = await this.getTeamMembersByCapability(capability);
        return teamMembers.filter(a => a.status === 'idle');
    }
    /**
     * Get available team members (idle or active with low load) with a specific capability
     */
    async getAvailableTeamMembersByCapability(capability, maxLoad = 50) {
        const teamMembers = await this.getTeamMembersByCapability(capability);
        return teamMembers.filter(a => (a.status === 'idle' || a.status === 'active') && a.load < maxLoad);
    }
    // ==========================================================================
    // Status Updates
    // ==========================================================================
    /**
     * Update team member status
     */
    async updateTeamMemberStatus(teamMemberId, status) {
        const teamMember = await this.getTeamMember(teamMemberId);
        if (!teamMember) {
            return false;
        }
        const oldStatus = teamMember.status;
        teamMember.status = status;
        teamMember.lastHeartbeat = new Date();
        const tags = createRegistryTags(teamMember);
        const memory = await this.client.remember(`TeamMember ${teamMember.name || teamMember.id} status updated: ${oldStatus} -> ${status}`, {
            memoryType: 'working',
            importance: 'medium',
            tags,
            metadata: {
                teamMemberId: teamMember.id,
                teamMemberName: teamMember.name,
                teamMemberType: teamMember.type,
                capabilities: teamMember.capabilities,
                status: teamMember.status,
                load: teamMember.load,
                loadBucket: teamMember.loadBucket,
                lastHeartbeat: teamMember.lastHeartbeat.toISOString(),
                registeredAt: teamMember.registeredAt.toISOString(),
                customMetadata: teamMember.metadata,
            },
        });
        if (memory) {
            this.localCache.set(teamMember.id, teamMember);
            this.emit('teamMemberStatusChanged', teamMemberId, oldStatus, status);
            return true;
        }
        return false;
    }
    /**
     * Update team member load
     */
    async updateTeamMemberLoad(teamMemberId, load) {
        const teamMember = await this.getTeamMember(teamMemberId);
        if (!teamMember) {
            return false;
        }
        teamMember.load = Math.max(0, Math.min(100, load));
        teamMember.loadBucket = calculateLoadBucket(teamMember.load);
        teamMember.lastHeartbeat = new Date();
        const tags = createRegistryTags(teamMember);
        const memory = await this.client.remember(`TeamMember ${teamMember.name || teamMember.id} load updated: ${teamMember.load}% (${teamMember.loadBucket})`, {
            memoryType: 'working',
            importance: 'low',
            tags,
            metadata: {
                teamMemberId: teamMember.id,
                teamMemberName: teamMember.name,
                teamMemberType: teamMember.type,
                capabilities: teamMember.capabilities,
                status: teamMember.status,
                load: teamMember.load,
                loadBucket: teamMember.loadBucket,
                lastHeartbeat: teamMember.lastHeartbeat.toISOString(),
                registeredAt: teamMember.registeredAt.toISOString(),
                customMetadata: teamMember.metadata,
            },
        });
        if (memory) {
            this.localCache.set(teamMember.id, teamMember);
            this.emit('teamMemberLoadChanged', teamMemberId, load);
            return true;
        }
        return false;
    }
    // ==========================================================================
    // Heartbeat
    // ==========================================================================
    /**
     * Send heartbeat for a team member
     */
    async heartbeat(teamMemberId) {
        const teamMember = await this.getTeamMember(teamMemberId);
        if (!teamMember) {
            return false;
        }
        teamMember.lastHeartbeat = new Date();
        // If team member was offline, mark as active
        if (teamMember.status === 'offline') {
            teamMember.status = 'active';
        }
        const tags = createRegistryTags(teamMember);
        const memory = await this.client.remember(`Heartbeat: ${teamMember.name || teamMember.id} (${teamMember.status}, load: ${teamMember.load}%)`, {
            memoryType: 'working',
            importance: 'low',
            tags,
            metadata: {
                teamMemberId: teamMember.id,
                teamMemberName: teamMember.name,
                teamMemberType: teamMember.type,
                capabilities: teamMember.capabilities,
                status: teamMember.status,
                load: teamMember.load,
                loadBucket: teamMember.loadBucket,
                lastHeartbeat: teamMember.lastHeartbeat.toISOString(),
                registeredAt: teamMember.registeredAt.toISOString(),
                customMetadata: teamMember.metadata,
            },
        });
        if (memory) {
            this.localCache.set(teamMember.id, teamMember);
            return true;
        }
        return false;
    }
    // ==========================================================================
    // Lifecycle Management
    // ==========================================================================
    /**
     * Clean up stale team members (no heartbeat within timeout)
     */
    async cleanupStaleTeamMembers() {
        const teamMembers = await this.getAllTeamMembers();
        const now = new Date();
        const staleIds = [];
        for (const teamMember of teamMembers) {
            if (teamMember.status === 'offline')
                continue;
            const timeSinceHeartbeat = now.getTime() - teamMember.lastHeartbeat.getTime();
            if (timeSinceHeartbeat > this.heartbeatTimeoutMs) {
                await this.updateTeamMemberStatus(teamMember.id, 'offline');
                staleIds.push(teamMember.id);
                this.emit('teamMemberStale', teamMember.id);
            }
        }
        return staleIds;
    }
    // ==========================================================================
    // Statistics
    // ==========================================================================
    /**
     * Get total number of registered team members (not offline)
     */
    async getTeamMemberCount() {
        const teamMembers = await this.getAllTeamMembers();
        return teamMembers.filter(a => a.status !== 'offline').length;
    }
    /**
     * Get count of teamMembers by status
     */
    async getTeamMemberCountByStatus() {
        const teamMembers = await this.getAllTeamMembers();
        const counts = {
            active: 0,
            idle: 0,
            busy: 0,
            offline: 0,
        };
        for (const teamMember of teamMembers) {
            counts[teamMember.status]++;
        }
        return counts;
    }
    // ==========================================================================
    // Private Methods
    // ==========================================================================
    /**
     * Refresh local cache from SpecMem
     */
    async refreshCache() {
        this.localCache.clear();
        await this.getAllTeamMembers();
    }
    /**
     * Parse unique team members from memories (keeping most recent)
     */
    parseUniqueTeamMembers(memories) {
        const teamMemberMap = new Map();
        for (const memory of memories) {
            const teamMemberId = memory.metadata?.teamMemberId;
            if (!teamMemberId)
                continue;
            const timestamp = new Date(memory.created_at);
            const existing = teamMemberMap.get(teamMemberId);
            if (!existing || timestamp > existing.timestamp) {
                teamMemberMap.set(teamMemberId, { memory, timestamp });
            }
        }
        const teamMembers = [];
        const now = new Date();
        for (const { memory } of teamMemberMap.values()) {
            const teamMember = parseTeamMemberFromMemory(memory);
            if (!teamMember)
                continue;
            // Check if team member is stale
            const timeSinceHeartbeat = now.getTime() - teamMember.lastHeartbeat.getTime();
            if (timeSinceHeartbeat > this.heartbeatTimeoutMs && teamMember.status !== 'offline') {
                teamMember.status = 'offline';
            }
            this.localCache.set(teamMember.id, teamMember);
            teamMembers.push(teamMember);
        }
        return teamMembers;
    }
}
// ============================================================================
// Factory Functions
// ============================================================================
/**
 * Create a new TeamMemberRegistry instance
 */
export function createTeamMemberRegistry(config) {
    return new TeamMemberRegistry(config);
}
// ============================================================================
// Global Registry (singleton pattern for shared use)
// ============================================================================
let globalRegistry = null;
/**
 * Get the global registry instance
 */
export function getGlobalRegistry() {
    if (!globalRegistry) {
        globalRegistry = createTeamMemberRegistry();
    }
    return globalRegistry;
}
/**
 * Initialize and start the global registry
 */
export async function initializeGlobalRegistry(config) {
    if (globalRegistry) {
        await globalRegistry.stop();
    }
    globalRegistry = createTeamMemberRegistry(config);
    await globalRegistry.start();
    return globalRegistry;
}
/**
 * Shutdown the global registry
 */
export async function shutdownGlobalRegistry() {
    if (globalRegistry) {
        await globalRegistry.stop();
        globalRegistry = null;
    }
}
//# sourceMappingURL=teamMemberRegistry.js.map