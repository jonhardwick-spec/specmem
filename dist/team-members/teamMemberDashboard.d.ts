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
import { SpecMemClient } from './workers/specmemClient.js';
import { TaskOrchestrator, TaskStatus, TaskPriority } from './taskOrchestrator.js';
import { ChannelSnapshot, ChannelActivityStats, ChannelIntegration } from './teamMemberChannels.js';
import { EventEmitter } from 'events';
export type TeamMemberStatus = 'active' | 'idle' | 'busy' | 'offline';
export type HealthStatus = 'healthy' | 'degraded' | 'critical' | 'unknown';
export interface TeamMemberSnapshot {
    id: string;
    name?: string;
    type?: string;
    status: TeamMemberStatus;
    load: number;
    currentTasks: number;
    completedTasks: number;
    failedTasks: number;
    capabilities: string[];
    lastHeartbeat: Date;
    uptime?: number;
}
export interface TaskQueueSnapshot {
    pending: number;
    assigned: number;
    inProgress: number;
    completed: number;
    failed: number;
    byPriority: Record<TaskPriority, number>;
    recentTasks: TaskSummary[];
}
export interface TaskSummary {
    id: string;
    type: string;
    status: TaskStatus;
    priority: TaskPriority;
    assignedTo?: string;
    createdAt: Date;
    duration?: number;
}
export interface SystemMetrics {
    totalTeamMembers: number;
    activeTeamMembers: number;
    totalChannels: number;
    activeChannels: number;
    tasksPerMinute: number;
    averageTaskDuration: number;
    errorRate: number;
    systemLoad: number;
}
export interface DashboardSnapshot {
    timestamp: Date;
    health: HealthStatus;
    teamMembers: TeamMemberSnapshot[];
    channels: ChannelSnapshot[];
    taskQueue: TaskQueueSnapshot;
    metrics: SystemMetrics;
    alerts: Alert[];
}
export interface Alert {
    id: string;
    type: 'warning' | 'error' | 'critical';
    message: string;
    source: string;
    timestamp: Date;
    resolved: boolean;
}
export interface DashboardConfig {
    refreshIntervalMs?: number;
    alertThresholds?: AlertThresholds;
    specmemClient?: SpecMemClient;
    orchestrator?: TaskOrchestrator;
}
export interface AlertThresholds {
    maxTeamMemberLoad?: number;
    maxPendingTasks?: number;
    maxTaskAge?: number;
    minActiveTeamMembers?: number;
    maxErrorRate?: number;
}
export declare class TeamMemberDashboard extends EventEmitter {
    private client;
    private orchestrator?;
    private refreshIntervalMs;
    private thresholds;
    private refreshTimer?;
    private isRunning;
    private teamMembers;
    private channels;
    private alerts;
    private taskHistory;
    private metricsHistory;
    private currentHealth;
    private lastUpdate;
    constructor(config?: DashboardConfig);
    /**
     * Start the dashboard
     */
    start(): Promise<boolean>;
    /**
     * Stop the dashboard
     */
    stop(): Promise<void>;
    /**
     * Set the task orchestrator
     */
    setOrchestrator(orchestrator: TaskOrchestrator): void;
    /**
     * Refresh all dashboard data
     */
    refresh(): Promise<DashboardSnapshot>;
    /**
     * Refresh team member data from registry
     * NOTE: Team Member 1 - I need to fetch team member data from your registry!
     */
    private refreshTeamMembers;
    /**
     * Refresh channel data
     * NOTE: Team Member 2 - I need to integrate with your channel system!
     */
    private refreshChannels;
    /**
     * Refresh task queue data from orchestrator
     */
    private refreshTaskQueue;
    /**
     * Check for alert conditions
     */
    private checkAlerts;
    /**
     * Create a new alert
     */
    private createAlert;
    /**
     * Resolve an alert
     */
    resolveAlert(alertId: string): boolean;
    /**
     * Clear resolved alerts
     */
    clearResolvedAlerts(): number;
    /**
     * Update system health status
     */
    private updateHealth;
    /**
     * Handle task events from orchestrator
     */
    private onTaskEvent;
    /**
     * Get current dashboard snapshot
     */
    getSnapshot(): DashboardSnapshot;
    /**
     * Get task queue snapshot
     */
    private getTaskQueueSnapshot;
    /**
     * Get system metrics
     */
    private getSystemMetrics;
    /**
     * Get all team members
     */
    getTeamMembers(): TeamMemberSnapshot[];
    /**
     * Get team member by ID
     */
    getTeamMember(teamMemberId: string): TeamMemberSnapshot | undefined;
    /**
     * Get all channels
     */
    getChannels(): ChannelSnapshot[];
    /**
     * Get channel by ID
     */
    getChannel(channelId: string): ChannelSnapshot | undefined;
    /**
     * Get all alerts (optionally including resolved)
     */
    getAlerts(includeResolved?: boolean): Alert[];
    /**
     * Get health status
     */
    getHealth(): HealthStatus;
    /**
     * Check if dashboard is running
     */
    isActive(): boolean;
    /**
     * Generate a text summary of the dashboard
     */
    generateSummary(): string;
    /**
     * Print dashboard to console
     */
    print(): void;
}
/**
 * Create an TeamMemberDashboard instance
 */
export declare function createTeamMemberDashboard(config?: DashboardConfig): TeamMemberDashboard;
/**
 * Team Member 2 has already implemented ChannelIntegration interface in teamMemberChannels.ts.
 * The dashboard uses:
 * - ChannelSnapshot - for channel display
 * - ChannelActivityStats - for activity metrics
 * - ChannelIntegration - for event callbacks
 *
 * All interfaces are imported from './teamMemberChannels.js'
 *
 * Re-export for convenience:
 */
export { ChannelSnapshot, ChannelActivityStats, ChannelIntegration };
//# sourceMappingURL=teamMemberDashboard.d.ts.map