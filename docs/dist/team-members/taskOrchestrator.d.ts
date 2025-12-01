/**
 * Task Orchestrator - Smart Work Distribution System
 *
 * Provides intelligent task distribution to teamMembers:
 * - Task queue with priority management
 * - Capability-based task matching
 * - Load balancing across team members
 * - Automatic failover and task reassignment
 * - Task lifecycle tracking (pending -> assigned -> in_progress -> completed/failed)
 */
import { SpecMemClient } from './workers/specmemClient.js';
import { EventEmitter } from 'events';
export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export interface Task {
    id: string;
    type: string;
    payload: any;
    requiredCapabilities: string[];
    priority: TaskPriority;
    assignedTo?: string;
    status: TaskStatus;
    createdAt: Date;
    assignedAt?: Date;
    startedAt?: Date;
    completedAt?: Date;
    result?: any;
    error?: string;
    retryCount: number;
    maxRetries: number;
    metadata?: Record<string, any>;
}
export interface TaskSubmission {
    type: string;
    payload: any;
    requiredCapabilities?: string[];
    priority?: TaskPriority;
    maxRetries?: number;
    metadata?: Record<string, any>;
}
export interface TeamMemberInfo {
    id: string;
    capabilities: string[];
    status: 'active' | 'idle' | 'busy' | 'offline';
    load: number;
    currentTasks: number;
    maxConcurrentTasks: number;
}
export interface TaskOrchestratorConfig {
    maxQueueSize?: number;
    defaultMaxRetries?: number;
    taskExpiryMs?: number;
    checkIntervalMs?: number;
    specmemClient?: SpecMemClient;
    teamMemberId?: string;
}
export interface TaskMetrics {
    totalSubmitted: number;
    totalCompleted: number;
    totalFailed: number;
    totalReassigned: number;
    averageCompletionTimeMs: number;
    tasksByPriority: Record<TaskPriority, number>;
    tasksByStatus: Record<TaskStatus, number>;
}
export declare class TaskOrchestrator extends EventEmitter {
    private client;
    private teamMemberId;
    private taskQueue;
    private maxQueueSize;
    private defaultMaxRetries;
    private taskExpiryMs;
    private checkIntervalMs;
    private checkTimer?;
    private isRunning;
    private metrics;
    private completionTimes;
    constructor(config?: TaskOrchestratorConfig);
    /**
     * Start the task orchestrator
     */
    start(): Promise<boolean>;
    /**
     * Stop the task orchestrator
     */
    stop(): Promise<void>;
    /**
     * Submit a new task for processing
     * @returns Task ID
     */
    submitTask(submission: TaskSubmission): Promise<string>;
    /**
     * Assign a task to a specific team member
     */
    assignTask(taskId: string, teamMemberId: string): Promise<void>;
    /**
     * Find best team member for a task based on capabilities and load
     *
     * NOTE: Team Member 1 - I need getTeamMembersByCapability() method to implement this!
     * This method should return team members that have ALL required capabilities.
     *
     * @param task - The task to assign
     * @param availableTeamMembers - List of available team members (from Team Member Registry)
     * @returns Best team member ID or null if none available
     */
    findBestTeamMember(task: Task, availableTeamMembers: TeamMemberInfo[]): string | null;
    /**
     * Auto-assign pending tasks to available team members
     * Call this with team members from Team Member 1's registry
     */
    autoAssignTasks(availableTeamMembers: TeamMemberInfo[]): Promise<number>;
    /**
     * Mark a task as in progress
     */
    startTask(taskId: string): Promise<void>;
    /**
     * Complete a task with result
     */
    completeTask(taskId: string, result: any): Promise<void>;
    /**
     * Fail a task with error
     */
    failTask(taskId: string, error: string): Promise<void>;
    /**
     * Reassign a task from one team member to another
     */
    reassignTask(taskId: string, fromTeamMember: string, toTeamMember: string): Promise<void>;
    /**
     * Handle team member failure - reassign all tasks from failed teamMember
     * This is called when Team Member 1's registry detects a team member going offline
     */
    handleTeamMemberFailure(teamMemberId: string, availableTeamMembers: TeamMemberInfo[]): Promise<number>;
    /**
     * Get task by ID
     */
    getTask(taskId: string): Task | undefined;
    /**
     * Get task status
     */
    getTaskStatus(taskId: string): TaskStatus | null;
    /**
     * Get all tasks for a team member
     */
    getTeamMemberTasks(teamMemberId: string): Task[];
    /**
     * Get all pending tasks
     */
    getPendingTasks(): Task[];
    /**
     * Get tasks by status
     */
    getTasksByStatus(status: TaskStatus): Task[];
    /**
     * Get tasks by priority
     */
    getTasksByPriority(priority: TaskPriority): Task[];
    /**
     * Get all tasks
     */
    getAllTasks(): Task[];
    /**
     * Get queue size
     */
    getQueueSize(): number;
    /**
     * Get metrics
     */
    getMetrics(): TaskMetrics;
    /**
     * Check for stale tasks (assigned but not progressing)
     */
    private checkStaleTasks;
    /**
     * Persist a task to SpecMem
     */
    private persistTask;
    /**
     * Load tasks from SpecMem storage
     */
    private loadTasksFromStorage;
    /**
     * Persist all tasks to storage
     */
    private persistTasksToStorage;
    /**
     * Generate a unique task ID
     */
    private generateTaskId;
    /**
     * Update status metrics
     */
    private updateStatusMetrics;
    /**
     * Check if orchestrator is running
     */
    isActive(): boolean;
}
/**
 * Create a TaskOrchestrator instance
 */
export declare function createTaskOrchestrator(config?: TaskOrchestratorConfig): TaskOrchestrator;
/**
 * Interface that matches Team Member 1's TeamMemberRegistry for orchestrator integration.
 *
 * Team Member 1 has implemented the ITeamMemberRegistry interface with these methods:
 * - getTeamMembersByCapability(capability: string): Promise<TeamMemberInfo[]>
 * - getAvailableTeamMembersByCapability(capability: string, maxLoad?: number): Promise<TeamMemberInfo[]>
 * - getIdleTeamMembersByCapability(capability: string): Promise<TeamMemberInfo[]>
 * - updateTeamMemberLoad(teamMemberId: string, load: number): Promise<boolean>
 * - updateTeamMemberStatus(teamMemberId: string, status: TeamMemberStatus): Promise<boolean>
 *
 * The TaskOrchestrator can use any registry implementing ITeamMemberRegistry
 * via dependency injection.
 *
 * NOTE: The TeamMemberInfo interface in this file is compatible with Team Member 1's
 * TeamMemberInfo but adds currentTasks/maxConcurrentTasks for capacity tracking.
 */
export interface RegistryIntegration {
    getTeamMembersByCapability(capability: string): Promise<TeamMemberInfo[]>;
    getAvailableTeamMembersByCapability(capability: string, maxLoad?: number): Promise<TeamMemberInfo[]>;
    updateTeamMemberLoad(teamMemberId: string, load: number): Promise<boolean>;
    onTeamMemberOffline?(callback: (teamMemberId: string) => void): void;
}
//# sourceMappingURL=taskOrchestrator.d.ts.map