/**
 * Team Member Dashboard - Real-time Monitoring System
 *
 * Provides comprehensive monitoring for the multi-team-member system:
 * - Real-time team member status and load visualization
 * - Channel activity monitoring (coordinates with Team Member 2)
 * - Task queue visualization
 * - Performance metrics and statistics
 * - Health checks and alerts
 */
import { createSpecMemClient } from './workers/specmemClient.js';
import { EventEmitter } from 'events';
// Default thresholds
const DEFAULT_THRESHOLDS = {
    maxTeamMemberLoad: 80,
    maxPendingTasks: 1000,
    maxTaskAge: 30 * 60 * 1000, // 30 minutes
    minActiveTeamMembers: 1,
    maxErrorRate: 0.1, // 10%
};
// ============================================================================
// TeamMemberDashboard Class
// ============================================================================
export class TeamMemberDashboard extends EventEmitter {
    client;
    orchestrator;
    refreshIntervalMs;
    thresholds;
    refreshTimer;
    isRunning = false;
    // Cached data
    teamMembers = new Map();
    channels = new Map();
    alerts = new Map();
    taskHistory = [];
    metricsHistory = [];
    // System state
    currentHealth = 'unknown';
    lastUpdate = new Date();
    constructor(config = {}) {
        super();
        this.client = config.specmemClient || createSpecMemClient({ teamMemberId: 'team-member-dashboard' });
        this.orchestrator = config.orchestrator;
        this.refreshIntervalMs = config.refreshIntervalMs || 5000; // 5 seconds
        this.thresholds = { ...DEFAULT_THRESHOLDS, ...config.alertThresholds };
    }
    // ============================================================================
    // Lifecycle Methods
    // ============================================================================
    /**
     * Start the dashboard
     */
    async start() {
        if (this.isRunning) {
            console.log('[TeamMemberDashboard] Already running');
            return true;
        }
        try {
            // Initial data fetch
            await this.refresh();
            // Start periodic refresh
            this.refreshTimer = setInterval(async () => {
                await this.refresh();
            }, this.refreshIntervalMs);
            this.isRunning = true;
            console.log('[TeamMemberDashboard] Started successfully');
            this.emit('started');
            return true;
        }
        catch (error) {
            console.error('[TeamMemberDashboard] Start error:', error);
            return false;
        }
    }
    /**
     * Stop the dashboard
     */
    async stop() {
        if (!this.isRunning)
            return;
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
        this.isRunning = false;
        console.log('[TeamMemberDashboard] Stopped');
        this.emit('stopped');
    }
    /**
     * Set the task orchestrator
     */
    setOrchestrator(orchestrator) {
        this.orchestrator = orchestrator;
        // Listen for orchestrator events
        orchestrator.on('taskSubmitted', (task) => this.onTaskEvent('submitted', task));
        orchestrator.on('taskCompleted', ({ task }) => this.onTaskEvent('completed', task));
        orchestrator.on('taskFailed', ({ task }) => this.onTaskEvent('failed', task));
        orchestrator.on('taskReassigned', ({ task }) => this.onTaskEvent('reassigned', task));
    }
    // ============================================================================
    // Data Refresh
    // ============================================================================
    /**
     * Refresh all dashboard data
     */
    async refresh() {
        const startTime = Date.now();
        try {
            // Fetch data in parallel
            await Promise.all([
                this.refreshTeamMembers(),
                this.refreshChannels(),
                this.refreshTaskQueue(),
            ]);
            // Check for alerts
            this.checkAlerts();
            // Update health status
            this.updateHealth();
            this.lastUpdate = new Date();
            const snapshot = this.getSnapshot();
            this.emit('refresh', snapshot);
            console.log(`[TeamMemberDashboard] Refresh completed in ${Date.now() - startTime}ms`);
            return snapshot;
        }
        catch (error) {
            console.error('[TeamMemberDashboard] Refresh error:', error);
            this.createAlert('error', 'Dashboard refresh failed', 'dashboard');
            return this.getSnapshot();
        }
    }
    /**
     * Refresh team member data from registry
     * NOTE: Team Member 1 - I need to fetch team member data from your registry!
     */
    async refreshTeamMembers() {
        try {
            // Fetch heartbeats from SpecMem
            const memories = await this.client.find('team-member-heartbeat', {
                limit: 100,
                tags: ['team-member-heartbeat'],
            });
            const now = Date.now();
            const cutoffMs = 60000; // 60 seconds
            // Process heartbeats
            for (const memory of memories) {
                const heartbeatTime = new Date(memory.created_at);
                if (now - heartbeatTime.getTime() > cutoffMs)
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
                // Get or create team member snapshot
                const existing = this.teamMembers.get(teamMemberId);
                const snapshot = {
                    id: teamMemberId,
                    name: memory.metadata?.teamMemberName || existing?.name,
                    type: memory.metadata?.teamMemberType || existing?.type,
                    status,
                    load: memory.metadata?.load ?? existing?.load ?? 0,
                    currentTasks: memory.metadata?.currentTasks ?? existing?.currentTasks ?? 0,
                    completedTasks: existing?.completedTasks ?? 0,
                    failedTasks: existing?.failedTasks ?? 0,
                    capabilities: memory.metadata?.capabilities || existing?.capabilities || [],
                    lastHeartbeat: heartbeatTime,
                    uptime: existing?.uptime,
                };
                this.teamMembers.set(teamMemberId, snapshot);
            }
            // Mark stale team members as offline
            for (const [id, teamMember] of this.teamMembers) {
                if (now - teamMember.lastHeartbeat.getTime() > cutoffMs) {
                    teamMember.status = 'offline';
                }
            }
        }
        catch (error) {
            console.error('[TeamMemberDashboard] Failed to refresh teamMembers:', error);
        }
    }
    /**
     * Refresh channel data
     * NOTE: Team Member 2 - I need to integrate with your channel system!
     */
    async refreshChannels() {
        try {
            // Fetch channel data from SpecMem
            // Team Member 2 should store channels with 'team-member-channel' tag
            const memories = await this.client.find('team-member-channel', {
                limit: 100,
                tags: ['team-member-channel'],
            });
            const now = Date.now();
            const activeThresholdMs = 5 * 60 * 1000; // 5 minutes
            for (const memory of memories) {
                let channelId;
                let channelName;
                for (const tag of memory.tags || []) {
                    if (tag.startsWith('channel:')) {
                        channelId = tag.substring(8);
                    }
                    else if (tag.startsWith('name:')) {
                        channelName = tag.substring(5);
                    }
                }
                if (!channelId)
                    continue;
                const lastActivity = new Date(memory.created_at);
                const snapshot = {
                    id: channelId,
                    name: channelName || channelId,
                    memberCount: memory.metadata?.memberCount || 0,
                    messageCount: memory.metadata?.messageCount || 0,
                    lastActivity,
                    isActive: now - lastActivity.getTime() < activeThresholdMs,
                };
                this.channels.set(channelId, snapshot);
            }
        }
        catch (error) {
            console.error('[TeamMemberDashboard] Failed to refresh channels:', error);
        }
    }
    /**
     * Refresh task queue data from orchestrator
     */
    async refreshTaskQueue() {
        if (!this.orchestrator)
            return;
        // Get metrics from orchestrator
        const metrics = this.orchestrator.getMetrics();
        // Get recent tasks
        const allTasks = this.orchestrator.getAllTasks();
        const recentTasks = allTasks
            .slice(-20)
            .map(task => ({
            id: task.id,
            type: task.type,
            status: task.status,
            priority: task.priority,
            assignedTo: task.assignedTo,
            createdAt: task.createdAt,
            duration: task.completedAt && task.startedAt
                ? task.completedAt.getTime() - task.startedAt.getTime()
                : undefined,
        }));
        this.taskHistory = recentTasks;
        // Track throughput for tasks per minute
        this.metricsHistory.push({
            timestamp: new Date(),
            count: metrics.totalCompleted,
        });
        // Keep last 60 entries (1 minute at 1-second intervals)
        if (this.metricsHistory.length > 60) {
            this.metricsHistory.shift();
        }
    }
    // ============================================================================
    // Alert Management
    // ============================================================================
    /**
     * Check for alert conditions
     */
    checkAlerts() {
        // Check team member load
        for (const teamMember of this.teamMembers.values()) {
            if (teamMember.status !== 'offline' && teamMember.load > (this.thresholds.maxTeamMemberLoad || 80)) {
                this.createAlert('warning', `TeamMember ${teamMember.id} has high load: ${teamMember.load}%`, `teamMember:${teamMember.id}`);
            }
        }
        // Check pending tasks
        if (this.orchestrator) {
            const pending = this.orchestrator.getPendingTasks().length;
            if (pending > (this.thresholds.maxPendingTasks || 1000)) {
                this.createAlert('warning', `High number of pending tasks: ${pending}`, 'orchestrator');
            }
        }
        // Check active team members
        const activeCount = Array.from(this.teamMembers.values())
            .filter(a => a.status !== 'offline').length;
        if (activeCount < (this.thresholds.minActiveTeamMembers || 1)) {
            this.createAlert('critical', `Low number of active teamMembers: ${activeCount}`, 'system');
        }
        // Check error rate
        if (this.orchestrator) {
            const metrics = this.orchestrator.getMetrics();
            const total = metrics.totalCompleted + metrics.totalFailed;
            if (total > 0) {
                const errorRate = metrics.totalFailed / total;
                if (errorRate > (this.thresholds.maxErrorRate || 0.1)) {
                    this.createAlert('error', `High error rate: ${(errorRate * 100).toFixed(1)}%`, 'orchestrator');
                }
            }
        }
    }
    /**
     * Create a new alert
     */
    createAlert(type, message, source) {
        const alertId = `${source}-${type}-${message.substring(0, 20)}`;
        // Don't create duplicate alerts
        if (this.alerts.has(alertId)) {
            return;
        }
        const alert = {
            id: alertId,
            type,
            message,
            source,
            timestamp: new Date(),
            resolved: false,
        };
        this.alerts.set(alertId, alert);
        console.log(`[TeamMemberDashboard] Alert: [${type}] ${message}`);
        this.emit('alert', alert);
    }
    /**
     * Resolve an alert
     */
    resolveAlert(alertId) {
        const alert = this.alerts.get(alertId);
        if (alert) {
            alert.resolved = true;
            this.emit('alertResolved', alert);
            return true;
        }
        return false;
    }
    /**
     * Clear resolved alerts
     */
    clearResolvedAlerts() {
        let cleared = 0;
        for (const [id, alert] of this.alerts) {
            if (alert.resolved) {
                this.alerts.delete(id);
                cleared++;
            }
        }
        return cleared;
    }
    // ============================================================================
    // Health Status
    // ============================================================================
    /**
     * Update system health status
     */
    updateHealth() {
        const criticalAlerts = Array.from(this.alerts.values())
            .filter(a => !a.resolved && a.type === 'critical').length;
        const errorAlerts = Array.from(this.alerts.values())
            .filter(a => !a.resolved && a.type === 'error').length;
        const warningAlerts = Array.from(this.alerts.values())
            .filter(a => !a.resolved && a.type === 'warning').length;
        const activeTeamMembers = Array.from(this.teamMembers.values())
            .filter(a => a.status !== 'offline').length;
        if (criticalAlerts > 0 || activeTeamMembers === 0) {
            this.currentHealth = 'critical';
        }
        else if (errorAlerts > 0) {
            this.currentHealth = 'degraded';
        }
        else if (warningAlerts > 2) {
            this.currentHealth = 'degraded';
        }
        else {
            this.currentHealth = 'healthy';
        }
    }
    // ============================================================================
    // Event Handlers
    // ============================================================================
    /**
     * Handle task events from orchestrator
     */
    onTaskEvent(eventType, task) {
        // Update team member task counts
        if (task.assignedTo) {
            const teamMember = this.teamMembers.get(task.assignedTo);
            if (teamMember) {
                if (eventType === 'completed') {
                    teamMember.completedTasks++;
                }
                else if (eventType === 'failed') {
                    teamMember.failedTasks++;
                }
            }
        }
        // Add to task history
        const summary = {
            id: task.id,
            type: task.type,
            status: task.status,
            priority: task.priority,
            assignedTo: task.assignedTo,
            createdAt: task.createdAt,
            duration: task.completedAt && task.startedAt
                ? task.completedAt.getTime() - task.startedAt.getTime()
                : undefined,
        };
        this.taskHistory.push(summary);
        if (this.taskHistory.length > 100) {
            this.taskHistory.shift();
        }
    }
    // ============================================================================
    // Snapshot Methods
    // ============================================================================
    /**
     * Get current dashboard snapshot
     */
    getSnapshot() {
        return {
            timestamp: this.lastUpdate,
            health: this.currentHealth,
            teamMembers: Array.from(this.teamMembers.values()),
            channels: Array.from(this.channels.values()),
            taskQueue: this.getTaskQueueSnapshot(),
            metrics: this.getSystemMetrics(),
            alerts: Array.from(this.alerts.values()).filter(a => !a.resolved),
        };
    }
    /**
     * Get task queue snapshot
     */
    getTaskQueueSnapshot() {
        if (!this.orchestrator) {
            return {
                pending: 0,
                assigned: 0,
                inProgress: 0,
                completed: 0,
                failed: 0,
                byPriority: { low: 0, medium: 0, high: 0, critical: 0 },
                recentTasks: [],
            };
        }
        const metrics = this.orchestrator.getMetrics();
        return {
            pending: metrics.tasksByStatus.pending,
            assigned: metrics.tasksByStatus.assigned,
            inProgress: metrics.tasksByStatus.in_progress,
            completed: metrics.tasksByStatus.completed,
            failed: metrics.tasksByStatus.failed,
            byPriority: metrics.tasksByPriority,
            recentTasks: this.taskHistory.slice(-10),
        };
    }
    /**
     * Get system metrics
     */
    getSystemMetrics() {
        const teamMembers = Array.from(this.teamMembers.values());
        const channels = Array.from(this.channels.values());
        // Calculate tasks per minute
        let tasksPerMinute = 0;
        if (this.metricsHistory.length >= 2) {
            const oldest = this.metricsHistory[0];
            const newest = this.metricsHistory[this.metricsHistory.length - 1];
            const timeDiffMinutes = (newest.timestamp.getTime() - oldest.timestamp.getTime()) / 60000;
            if (timeDiffMinutes > 0) {
                tasksPerMinute = (newest.count - oldest.count) / timeDiffMinutes;
            }
        }
        // Calculate error rate
        let errorRate = 0;
        if (this.orchestrator) {
            const metrics = this.orchestrator.getMetrics();
            const total = metrics.totalCompleted + metrics.totalFailed;
            if (total > 0) {
                errorRate = metrics.totalFailed / total;
            }
        }
        // Calculate system load (average team member load)
        const activeTeamMembers = teamMembers.filter(a => a.status !== 'offline');
        const systemLoad = activeTeamMembers.length > 0
            ? activeTeamMembers.reduce((sum, a) => sum + a.load, 0) / activeTeamMembers.length
            : 0;
        return {
            totalTeamMembers: teamMembers.length,
            activeTeamMembers: activeTeamMembers.length,
            totalChannels: channels.length,
            activeChannels: channels.filter(c => c.isActive).length,
            tasksPerMinute,
            averageTaskDuration: this.orchestrator?.getMetrics().averageCompletionTimeMs || 0,
            errorRate,
            systemLoad,
        };
    }
    // ============================================================================
    // Query Methods
    // ============================================================================
    /**
     * Get all team members
     */
    getTeamMembers() {
        return Array.from(this.teamMembers.values());
    }
    /**
     * Get team member by ID
     */
    getTeamMember(teamMemberId) {
        return this.teamMembers.get(teamMemberId);
    }
    /**
     * Get all channels
     */
    getChannels() {
        return Array.from(this.channels.values());
    }
    /**
     * Get channel by ID
     */
    getChannel(channelId) {
        return this.channels.get(channelId);
    }
    /**
     * Get all alerts (optionally including resolved)
     */
    getAlerts(includeResolved = false) {
        const alerts = Array.from(this.alerts.values());
        return includeResolved ? alerts : alerts.filter(a => !a.resolved);
    }
    /**
     * Get health status
     */
    getHealth() {
        return this.currentHealth;
    }
    /**
     * Check if dashboard is running
     */
    isActive() {
        return this.isRunning;
    }
    // ============================================================================
    // Display Methods (for console/text output)
    // ============================================================================
    /**
     * Generate a text summary of the dashboard
     */
    generateSummary() {
        const snapshot = this.getSnapshot();
        const lines = [];
        lines.push('='.repeat(60));
        lines.push('MULTI-TEAM-MEMBER SYSTEM DASHBOARD');
        lines.push(`Last Updated: ${snapshot.timestamp.toISOString()}`);
        lines.push(`System Health: ${snapshot.health.toUpperCase()}`);
        lines.push('='.repeat(60));
        // TeamMembers Section
        lines.push('\n--- TEAM_MEMBERS ---');
        lines.push(`Total: ${snapshot.metrics.totalTeamMembers} | Active: ${snapshot.metrics.activeTeamMembers}`);
        for (const teamMember of snapshot.teamMembers) {
            const statusIcon = {
                active: '[ACTIVE]',
                idle: '[IDLE]  ',
                busy: '[BUSY]  ',
                offline: '[OFFLINE]',
            }[teamMember.status];
            lines.push(`  ${statusIcon} ${teamMember.id} - Load: ${teamMember.load}% | Tasks: ${teamMember.currentTasks}`);
        }
        // Channels Section
        lines.push('\n--- CHANNELS ---');
        lines.push(`Total: ${snapshot.metrics.totalChannels} | Active: ${snapshot.metrics.activeChannels}`);
        for (const channel of snapshot.channels) {
            const activeIcon = channel.isActive ? '[*]' : '[ ]';
            lines.push(`  ${activeIcon} ${channel.name} - Members: ${channel.memberCount} | Messages: ${channel.messageCount}`);
        }
        // Task Queue Section
        lines.push('\n--- TASK QUEUE ---');
        lines.push(`Pending: ${snapshot.taskQueue.pending} | In Progress: ${snapshot.taskQueue.inProgress}`);
        lines.push(`Completed: ${snapshot.taskQueue.completed} | Failed: ${snapshot.taskQueue.failed}`);
        lines.push(`Throughput: ${snapshot.metrics.tasksPerMinute.toFixed(1)} tasks/min`);
        // Alerts Section
        if (snapshot.alerts.length > 0) {
            lines.push('\n--- ALERTS ---');
            for (const alert of snapshot.alerts) {
                const icon = { warning: '[!]', error: '[!!]', critical: '[!!!]' }[alert.type];
                lines.push(`  ${icon} ${alert.message}`);
            }
        }
        lines.push('\n' + '='.repeat(60));
        return lines.join('\n');
    }
    /**
     * Print dashboard to console
     */
    print() {
        console.log(this.generateSummary());
    }
}
// ============================================================================
// Factory Function
// ============================================================================
/**
 * Create an TeamMemberDashboard instance
 */
export function createTeamMemberDashboard(config) {
    return new TeamMemberDashboard(config);
}
//# sourceMappingURL=teamMemberDashboard.js.map