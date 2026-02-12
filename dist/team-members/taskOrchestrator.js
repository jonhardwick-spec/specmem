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
import { createSpecMemClient } from './workers/specmemClient.js';
import { EventEmitter } from 'events';
// Priority weights for sorting (lower = higher priority)
const PRIORITY_ORDER = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
};
// ============================================================================
// TaskOrchestrator Class
// ============================================================================
export class TaskOrchestrator extends EventEmitter {
    client;
    teamMemberId;
    taskQueue = new Map();
    maxQueueSize;
    defaultMaxRetries;
    taskExpiryMs;
    checkIntervalMs;
    checkTimer;
    isRunning = false;
    // Metrics tracking
    metrics = {
        totalSubmitted: 0,
        totalCompleted: 0,
        totalFailed: 0,
        totalReassigned: 0,
        averageCompletionTimeMs: 0,
        tasksByPriority: { low: 0, medium: 0, high: 0, critical: 0 },
        tasksByStatus: { pending: 0, assigned: 0, in_progress: 0, completed: 0, failed: 0 },
    };
    // Completion times for average calculation
    completionTimes = [];
    constructor(config = {}) {
        super();
        this.teamMemberId = config.teamMemberId || 'task-orchestrator';
        this.client = config.specmemClient || createSpecMemClient({ teamMemberId: this.teamMemberId });
        this.maxQueueSize = config.maxQueueSize || 10000;
        this.defaultMaxRetries = config.defaultMaxRetries || 3;
        this.taskExpiryMs = config.taskExpiryMs || 24 * 60 * 60 * 1000; // 24 hours
        this.checkIntervalMs = config.checkIntervalMs || 10000; // 10 seconds
    }
    // ============================================================================
    // Lifecycle Methods
    // ============================================================================
    /**
     * Start the task orchestrator
     */
    async start() {
        if (this.isRunning) {
            console.log('[TaskOrchestrator] Already running');
            return true;
        }
        try {
            // Load existing tasks from SpecMem
            await this.loadTasksFromStorage();
            // Start periodic check for stale tasks
            this.checkTimer = setInterval(async () => {
                await this.checkStaleTasks();
            }, this.checkIntervalMs);
            this.isRunning = true;
            console.log('[TaskOrchestrator] Started successfully');
            this.emit('started');
            return true;
        }
        catch (error) {
            console.error('[TaskOrchestrator] Start error:', error);
            return false;
        }
    }
    /**
     * Stop the task orchestrator
     */
    async stop() {
        if (!this.isRunning)
            return;
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = undefined;
        }
        // Persist current queue to storage
        await this.persistTasksToStorage();
        this.isRunning = false;
        console.log('[TaskOrchestrator] Stopped');
        this.emit('stopped');
    }
    // ============================================================================
    // Task Submission
    // ============================================================================
    /**
     * Submit a new task for processing
     * @returns Task ID
     */
    async submitTask(submission) {
        if (this.taskQueue.size >= this.maxQueueSize) {
            throw new Error('Task queue is full');
        }
        const taskId = this.generateTaskId();
        const task = {
            id: taskId,
            type: submission.type,
            payload: submission.payload,
            requiredCapabilities: submission.requiredCapabilities || [],
            priority: submission.priority || 'medium',
            status: 'pending',
            createdAt: new Date(),
            retryCount: 0,
            maxRetries: submission.maxRetries ?? this.defaultMaxRetries,
            metadata: submission.metadata,
        };
        this.taskQueue.set(taskId, task);
        this.metrics.totalSubmitted++;
        this.metrics.tasksByPriority[task.priority]++;
        this.updateStatusMetrics();
        // Persist to SpecMem
        await this.persistTask(task);
        console.log(`[TaskOrchestrator] Task ${taskId} submitted (priority: ${task.priority})`);
        this.emit('taskSubmitted', task);
        return taskId;
    }
    // ============================================================================
    // Task Assignment
    // ============================================================================
    /**
     * Assign a task to a specific team member
     */
    async assignTask(taskId, teamMemberId) {
        const task = this.taskQueue.get(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }
        if (task.status !== 'pending') {
            throw new Error(`Task ${taskId} is not pending (current status: ${task.status})`);
        }
        task.assignedTo = teamMemberId;
        task.status = 'assigned';
        task.assignedAt = new Date();
        await this.persistTask(task);
        this.updateStatusMetrics();
        console.log(`[TaskOrchestrator] Task ${taskId} assigned to team member ${teamMemberId}`);
        this.emit('taskAssigned', { task, teamMemberId });
    }
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
    findBestTeamMember(task, availableTeamMembers) {
        // Filter team members that have all required capabilities
        const capableTeamMembers = availableTeamMembers.filter(teamMember => {
            // Must be online (not offline)
            if (teamMember.status === 'offline')
                return false;
            // Must have capacity
            if (teamMember.currentTasks >= teamMember.maxConcurrentTasks)
                return false;
            // Must have all required capabilities
            return task.requiredCapabilities.every(cap => teamMember.capabilities.includes(cap));
        });
        if (capableTeamMembers.length === 0)
            return null;
        // Sort by load (lowest first), then by current tasks
        capableTeamMembers.sort((a, b) => {
            // Prefer idle team members
            if (a.status === 'idle' && b.status !== 'idle')
                return -1;
            if (b.status === 'idle' && a.status !== 'idle')
                return 1;
            // Then by load
            if (a.load !== b.load)
                return a.load - b.load;
            // Then by current tasks
            return a.currentTasks - b.currentTasks;
        });
        return capableTeamMembers[0].id;
    }
    /**
     * Auto-assign pending tasks to available team members
     * Call this with team members from Team Member 1's registry
     */
    async autoAssignTasks(availableTeamMembers) {
        const pendingTasks = this.getPendingTasks();
        let assigned = 0;
        // Sort by priority
        pendingTasks.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
        for (const task of pendingTasks) {
            const bestTeamMember = this.findBestTeamMember(task, availableTeamMembers);
            if (bestTeamMember) {
                await this.assignTask(task.id, bestTeamMember);
                // Update team member's load in our view (Team Member 1 should also be notified)
                const teamMember = availableTeamMembers.find(a => a.id === bestTeamMember);
                if (teamMember) {
                    teamMember.currentTasks++;
                    teamMember.load = Math.min(100, teamMember.load + (100 / teamMember.maxConcurrentTasks));
                }
                assigned++;
            }
        }
        return assigned;
    }
    // ============================================================================
    // Task Status Updates
    // ============================================================================
    /**
     * Mark a task as in progress
     */
    async startTask(taskId) {
        const task = this.taskQueue.get(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }
        task.status = 'in_progress';
        task.startedAt = new Date();
        await this.persistTask(task);
        this.updateStatusMetrics();
        console.log(`[TaskOrchestrator] Task ${taskId} started`);
        this.emit('taskStarted', task);
    }
    /**
     * Complete a task with result
     */
    async completeTask(taskId, result) {
        const task = this.taskQueue.get(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }
        task.status = 'completed';
        task.result = result;
        task.completedAt = new Date();
        // Track completion time
        if (task.startedAt) {
            const completionTime = task.completedAt.getTime() - task.startedAt.getTime();
            this.completionTimes.push(completionTime);
            // Keep last 100 completion times for average
            if (this.completionTimes.length > 100) {
                this.completionTimes.shift();
            }
            this.metrics.averageCompletionTimeMs =
                this.completionTimes.reduce((a, b) => a + b, 0) / this.completionTimes.length;
        }
        this.metrics.totalCompleted++;
        await this.persistTask(task);
        this.updateStatusMetrics();
        console.log(`[TaskOrchestrator] Task ${taskId} completed`);
        this.emit('taskCompleted', { task, result });
    }
    /**
     * Fail a task with error
     */
    async failTask(taskId, error) {
        const task = this.taskQueue.get(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }
        task.error = error;
        task.retryCount++;
        // Check if we should retry
        if (task.retryCount < task.maxRetries) {
            task.status = 'pending';
            task.assignedTo = undefined;
            task.assignedAt = undefined;
            task.startedAt = undefined;
            console.log(`[TaskOrchestrator] Task ${taskId} failed, queuing for retry (${task.retryCount}/${task.maxRetries})`);
            this.emit('taskRetrying', { task, error });
        }
        else {
            task.status = 'failed';
            task.completedAt = new Date();
            this.metrics.totalFailed++;
            console.log(`[TaskOrchestrator] Task ${taskId} failed permanently: ${error}`);
            this.emit('taskFailed', { task, error });
        }
        await this.persistTask(task);
        this.updateStatusMetrics();
    }
    // ============================================================================
    // Task Reassignment
    // ============================================================================
    /**
     * Reassign a task from one team member to another
     */
    async reassignTask(taskId, fromTeamMember, toTeamMember) {
        const task = this.taskQueue.get(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }
        if (task.assignedTo !== fromTeamMember) {
            throw new Error(`Task ${taskId} is not assigned to ${fromTeamMember}`);
        }
        const previousStatus = task.status;
        task.assignedTo = toTeamMember;
        task.status = 'assigned';
        task.assignedAt = new Date();
        task.startedAt = undefined;
        this.metrics.totalReassigned++;
        await this.persistTask(task);
        this.updateStatusMetrics();
        console.log(`[TaskOrchestrator] Task ${taskId} reassigned from ${fromTeamMember} to ${toTeamMember}`);
        this.emit('taskReassigned', { task, fromTeamMember, toTeamMember, previousStatus });
    }
    /**
     * Handle team member failure - reassign all tasks from failed teamMember
     * This is called when Team Member 1's registry detects a team member going offline
     */
    async handleTeamMemberFailure(teamMemberId, availableTeamMembers) {
        const teamMemberTasks = this.getTeamMemberTasks(teamMemberId);
        let reassigned = 0;
        for (const task of teamMemberTasks) {
            // Reset task to pending
            task.status = 'pending';
            task.assignedTo = undefined;
            task.assignedAt = undefined;
            task.startedAt = undefined;
            // Try to find a new team member
            const newTeamMember = this.findBestTeamMember(task, availableTeamMembers);
            if (newTeamMember) {
                await this.assignTask(task.id, newTeamMember);
                reassigned++;
            }
        }
        console.log(`[TaskOrchestrator] Reassigned ${reassigned}/${teamMemberTasks.length} tasks from failed team member ${teamMemberId}`);
        this.emit('teamMemberFailureHandled', { teamMemberId, reassigned, total: teamMemberTasks.length });
        return reassigned;
    }
    // ============================================================================
    // Task Queries
    // ============================================================================
    /**
     * Get task by ID
     */
    getTask(taskId) {
        return this.taskQueue.get(taskId);
    }
    /**
     * Get task status
     */
    getTaskStatus(taskId) {
        const task = this.taskQueue.get(taskId);
        return task?.status || null;
    }
    /**
     * Get all tasks for a team member
     */
    getTeamMemberTasks(teamMemberId) {
        return Array.from(this.taskQueue.values())
            .filter(task => task.assignedTo === teamMemberId);
    }
    /**
     * Get all pending tasks
     */
    getPendingTasks() {
        return Array.from(this.taskQueue.values())
            .filter(task => task.status === 'pending');
    }
    /**
     * Get tasks by status
     */
    getTasksByStatus(status) {
        return Array.from(this.taskQueue.values())
            .filter(task => task.status === status);
    }
    /**
     * Get tasks by priority
     */
    getTasksByPriority(priority) {
        return Array.from(this.taskQueue.values())
            .filter(task => task.priority === priority);
    }
    /**
     * Get all tasks
     */
    getAllTasks() {
        return Array.from(this.taskQueue.values());
    }
    /**
     * Get queue size
     */
    getQueueSize() {
        return this.taskQueue.size;
    }
    /**
     * Get metrics
     */
    getMetrics() {
        return { ...this.metrics };
    }
    // ============================================================================
    // Stale Task Management
    // ============================================================================
    /**
     * Check for stale tasks (assigned but not progressing)
     */
    async checkStaleTasks() {
        const now = Date.now();
        const staleThresholdMs = 5 * 60 * 1000; // 5 minutes
        for (const task of this.taskQueue.values()) {
            // Check for stale assigned tasks
            if (task.status === 'assigned' && task.assignedAt) {
                const assignedTime = task.assignedAt.getTime();
                if (now - assignedTime > staleThresholdMs) {
                    console.log(`[TaskOrchestrator] Task ${task.id} is stale (assigned but not started)`);
                    this.emit('taskStale', { task, reason: 'not_started' });
                }
            }
            // Check for stale in_progress tasks
            if (task.status === 'in_progress' && task.startedAt) {
                const startedTime = task.startedAt.getTime();
                if (now - startedTime > this.taskExpiryMs) {
                    console.log(`[TaskOrchestrator] Task ${task.id} has expired`);
                    await this.failTask(task.id, 'Task expired');
                }
            }
            // Check for expired tasks
            if (task.status === 'pending') {
                const createdTime = task.createdAt.getTime();
                if (now - createdTime > this.taskExpiryMs) {
                    console.log(`[TaskOrchestrator] Pending task ${task.id} has expired`);
                    await this.failTask(task.id, 'Task expired while pending');
                }
            }
        }
    }
    // ============================================================================
    // Storage Methods
    // ============================================================================
    /**
     * Persist a task to SpecMem
     */
    async persistTask(task) {
        const tags = [
            'task-orchestrator',
            `task:${task.id}`,
            `type:${task.type}`,
            `status:${task.status}`,
            `priority:${task.priority}`,
        ];
        if (task.assignedTo) {
            tags.push(`assigned:${task.assignedTo}`);
        }
        for (const cap of task.requiredCapabilities) {
            tags.push(`capability:${cap}`);
        }
        await this.client.remember(JSON.stringify(task), {
            memoryType: 'episodic',
            importance: task.priority === 'critical' ? 'high' : task.priority === 'high' ? 'high' : 'medium',
            tags,
            metadata: {
                taskId: task.id,
                taskType: task.type,
                status: task.status,
                priority: task.priority,
                assignedTo: task.assignedTo,
                createdAt: task.createdAt.toISOString(),
            },
        });
    }
    /**
     * Load tasks from SpecMem storage
     */
    async loadTasksFromStorage() {
        try {
            const memories = await this.client.find('task-orchestrator', {
                limit: 1000,
                tags: ['task-orchestrator'],
            });
            // Group by task ID and take most recent
            const taskMap = new Map();
            for (const memory of memories) {
                const taskIdTag = memory.tags?.find(t => t.startsWith('task:'));
                if (!taskIdTag)
                    continue;
                const taskId = taskIdTag.substring(5);
                const existing = taskMap.get(taskId);
                if (!existing || new Date(memory.created_at) > new Date(existing.created_at)) {
                    taskMap.set(taskId, memory);
                }
            }
            // Parse and load tasks
            for (const memory of taskMap.values()) {
                try {
                    const task = JSON.parse(memory.content);
                    // Convert date strings back to Date objects
                    task.createdAt = new Date(task.createdAt);
                    if (task.assignedAt)
                        task.assignedAt = new Date(task.assignedAt);
                    if (task.startedAt)
                        task.startedAt = new Date(task.startedAt);
                    if (task.completedAt)
                        task.completedAt = new Date(task.completedAt);
                    // Only load active tasks (not completed/failed)
                    if (task.status !== 'completed' && task.status !== 'failed') {
                        this.taskQueue.set(task.id, task);
                    }
                }
                catch (e) {
                    console.error(`[TaskOrchestrator] Failed to parse task: ${e}`);
                }
            }
            console.log(`[TaskOrchestrator] Loaded ${this.taskQueue.size} active tasks from storage`);
            this.updateStatusMetrics();
        }
        catch (error) {
            console.error('[TaskOrchestrator] Failed to load tasks:', error);
        }
    }
    /**
     * Persist all tasks to storage
     */
    async persistTasksToStorage() {
        for (const task of this.taskQueue.values()) {
            await this.persistTask(task);
        }
        console.log(`[TaskOrchestrator] Persisted ${this.taskQueue.size} tasks to storage`);
    }
    // ============================================================================
    // Helper Methods
    // ============================================================================
    /**
     * Generate a unique task ID
     */
    generateTaskId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `task-${timestamp}-${random}`;
    }
    /**
     * Update status metrics
     */
    updateStatusMetrics() {
        const statusCounts = {
            pending: 0,
            assigned: 0,
            in_progress: 0,
            completed: 0,
            failed: 0,
        };
        for (const task of this.taskQueue.values()) {
            statusCounts[task.status]++;
        }
        this.metrics.tasksByStatus = statusCounts;
    }
    /**
     * Check if orchestrator is running
     */
    isActive() {
        return this.isRunning;
    }
}
// ============================================================================
// Factory Function
// ============================================================================
/**
 * Create a TaskOrchestrator instance
 */
export function createTaskOrchestrator(config) {
    return new TaskOrchestrator(config);
}
//# sourceMappingURL=taskOrchestrator.js.map