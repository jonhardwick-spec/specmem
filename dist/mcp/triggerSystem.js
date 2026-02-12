/**
 * triggerSystem.ts -  Trigger System for MCP Sampling
 *
 * Manages trigger actions that request  to perform tasks via MCP sampling.
 * Includes support for immediate triggers, scheduled triggers, and confirmation flow.
 *
 * Phase 6 Implementation - MCP ->  Control Flow
 */
import { logger } from '../utils/logger.js';
import { executePrompt } from './promptExecutor.js';
// ============================================================================
// Action Templates
// ============================================================================
const ACTION_TEMPLATES = {
    'fix-error': {
        systemPrompt: `You are an expert debugging assistant. Analyze the error and provide a clear, actionable fix.
Focus on:
1. Understanding the root cause
2. Providing specific code changes
3. Explaining why the fix works
4. Suggesting preventive measures`,
        promptPrefix: 'Please analyze and fix the following error:\n\n'
    },
    'consolidate': {
        systemPrompt: `You are a memory consolidation specialist. Your task is to identify similar or redundant memories
and suggest how they can be merged while preserving important information.
Consider:
1. Semantic similarity
2. Temporal relationships
3. Information overlap
4. Importance levels`,
        promptPrefix: 'Analyze the following memories for consolidation:\n\n'
    },
    'deploy-team-member': {
        systemPrompt: `You are a team member deployment coordinator. Your task is to initialize and configure a team member
based on the given requirements.
Ensure:
1. Clear task definition
2. Appropriate permissions
3. Resource limits
4. Success criteria`,
        promptPrefix: 'Initialize a team member for the following task:\n\n'
    },
    'analyze-codebase': {
        systemPrompt: `You are a code analysis expert. Analyze the codebase and provide insights on:
1. Architecture patterns
2. Potential issues
3. Optimization opportunities
4. Best practice recommendations`,
        promptPrefix: 'Analyze the following code/codebase:\n\n'
    },
    'summarize-session': {
        systemPrompt: `You are a session summarizer. Create a concise but comprehensive summary of the session.
Include:
1. Key activities performed
2. Important decisions made
3. Outcomes and results
4. Pending items or next steps`,
        promptPrefix: 'Summarize the following session:\n\n'
    },
    'custom': {
        systemPrompt: `You are , an AI assistant. Help with the following request.`,
        promptPrefix: ''
    }
};
// ============================================================================
//  Trigger System
// ============================================================================
export class TriggerSystem {
    scheduledJobs = new Map();
    triggerLog = [];
    maxLogSize = 100;
    constructor() {
        logger.info(' Trigger System initialized');
    }
    /**
     * Execute a trigger action via MCP sampling
     */
    async triggerAction(action) {
        const startTime = Date.now();
        logger.info({
            triggerId: action.id,
            action: action.action,
            promptLength: action.prompt.length
        }, 'Executing trigger action');
        try {
            // Get action template
            const template = ACTION_TEMPLATES[action.action] || ACTION_TEMPLATES.custom;
            // Build the full prompt
            const fullPrompt = this.buildPrompt(action, template);
            // Build the system prompt
            const systemPrompt = action.config.systemPrompt || template.systemPrompt;
            // Execute via MCP sampling
            const promptParams = {
                prompt: fullPrompt,
                config: {
                    maxTokens: action.config.maxTokens || 4096,
                    intelligencePriority: action.config.intelligencePriority || 0.9,
                    speedPriority: action.config.speedPriority || 0.5,
                    costPriority: action.config.costPriority || 0.3,
                    systemPrompt
                }
            };
            const response = await executePrompt(promptParams);
            const duration = Date.now() - startTime;
            // Log the trigger
            this.logTrigger(action.id, action.action, true, duration);
            logger.info({
                triggerId: action.id,
                duration,
                tokensUsed: response.tokensUsed
            }, 'Trigger action completed successfully');
            return {
                success: true,
                response: response.content,
                tokensUsed: response.tokensUsed,
                duration,
                model: response.model
            };
        }
        catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            // Log the failure
            this.logTrigger(action.id, action.action, false, duration);
            logger.error({
                triggerId: action.id,
                error: errorMessage,
                duration
            }, 'Trigger action failed');
            return {
                success: false,
                error: errorMessage,
                duration
            };
        }
    }
    /**
     * Build the full prompt from action and template
     */
    buildPrompt(action, template) {
        let prompt = template.promptPrefix + action.prompt;
        // Add context information
        if (action.context) {
            const contextParts = [];
            if (action.context.errorMessage) {
                contextParts.push(`Error Message:\n${action.context.errorMessage}`);
            }
            if (action.context.filePath) {
                contextParts.push(`File Path: ${action.context.filePath}`);
            }
            if (action.context.memoryIds && action.context.memoryIds.length > 0) {
                contextParts.push(`Related Memory IDs: ${action.context.memoryIds.join(', ')}`);
            }
            if (action.context.sessionId) {
                contextParts.push(`Session ID: ${action.context.sessionId}`);
            }
            if (contextParts.length > 0) {
                prompt += '\n\n---\nContext:\n' + contextParts.join('\n');
            }
        }
        return prompt;
    }
    /**
     * Schedule a recurring action
     */
    async scheduleAction(scheduleId, action, schedule) {
        // Cancel existing schedule if any
        this.cancelScheduledAction(scheduleId);
        const job = {
            id: scheduleId,
            action,
            schedule,
            runCount: 0
        };
        // Calculate next run
        if (schedule.runAt) {
            const runTime = new Date(schedule.runAt);
            const delay = runTime.getTime() - Date.now();
            if (delay > 0) {
                job.nextRun = runTime;
                job.timer = setTimeout(() => this.executeScheduledJob(scheduleId), delay);
            }
        }
        else if (schedule.intervalMinutes) {
            const intervalMs = schedule.intervalMinutes * 60 * 1000;
            job.nextRun = new Date(Date.now() + intervalMs);
            job.timer = setInterval(() => this.executeScheduledJob(scheduleId), intervalMs);
        }
        else if (schedule.cron) {
            // For cron expressions, we'd use node-cron
            // Simplified implementation - just log for now
            logger.info({ scheduleId, cron: schedule.cron }, 'Cron scheduling not fully implemented');
        }
        this.scheduledJobs.set(scheduleId, job);
        logger.info({
            scheduleId,
            action: action.action,
            nextRun: job.nextRun
        }, 'Action scheduled');
    }
    /**
     * Execute a scheduled job
     */
    async executeScheduledJob(scheduleId) {
        const job = this.scheduledJobs.get(scheduleId);
        if (!job)
            return;
        logger.info({ scheduleId, action: job.action.action }, 'Executing scheduled job');
        job.lastRun = new Date();
        job.runCount++;
        // Calculate next run for interval-based schedules
        if (job.schedule.intervalMinutes) {
            job.nextRun = new Date(Date.now() + job.schedule.intervalMinutes * 60 * 1000);
        }
        // Execute the action
        const result = await this.triggerAction(job.action);
        // Notify if there was an error
        if (!result.success) {
            logger.warn({
                scheduleId,
                error: result.error
            }, 'Scheduled job failed');
        }
        // For one-time schedules (runAt), remove after execution
        if (job.schedule.runAt) {
            this.cancelScheduledAction(scheduleId);
        }
    }
    /**
     * Cancel a scheduled action
     */
    cancelScheduledAction(scheduleId) {
        const job = this.scheduledJobs.get(scheduleId);
        if (!job)
            return;
        if (job.timer) {
            clearTimeout(job.timer);
            clearInterval(job.timer);
        }
        this.scheduledJobs.delete(scheduleId);
        logger.info({ scheduleId }, 'Scheduled action cancelled');
    }
    /**
     * Get all scheduled jobs
     */
    getScheduledJobs() {
        return Array.from(this.scheduledJobs.values()).map(job => ({
            ...job,
            timer: undefined // Don't expose timer object
        }));
    }
    /**
     * Log a trigger execution
     */
    logTrigger(id, action, success, duration) {
        this.triggerLog.unshift({
            id,
            action,
            timestamp: new Date(),
            success,
            duration
        });
        // Trim log
        if (this.triggerLog.length > this.maxLogSize) {
            this.triggerLog.pop();
        }
    }
    /**
     * Get trigger execution log
     */
    getTriggerLog() {
        return [...this.triggerLog];
    }
    /**
     * Get trigger statistics
     */
    getStats() {
        const successful = this.triggerLog.filter(t => t.success).length;
        const failed = this.triggerLog.filter(t => !t.success).length;
        const durations = this.triggerLog
            .filter(t => t.duration !== undefined)
            .map(t => t.duration);
        const avgDuration = durations.length > 0
            ? durations.reduce((a, b) => a + b, 0) / durations.length
            : 0;
        return {
            totalTriggers: this.triggerLog.length,
            successfulTriggers: successful,
            failedTriggers: failed,
            averageDuration: Math.round(avgDuration),
            activeSchedules: this.scheduledJobs.size
        };
    }
    /**
     * Request user confirmation for an action
     */
    async requestUserConfirmation(action) {
        // In a real implementation, this would:
        // 1. Send a notification to the dashboard
        // 2. Wait for user response
        // 3. Return true/false based on response
        logger.info({
            triggerId: action.id,
            action: action.action
        }, 'User confirmation requested (auto-approving for now)');
        // For now, auto-approve all confirmations
        // The API layer handles the actual confirmation flow
        return true;
    }
    /**
     * Notify user about a trigger result
     */
    async notifyUser(action, result) {
        // In a real implementation, this would:
        // 1. Send a notification via WebSocket
        // 2. Log to the dashboard
        // 3. Optionally send email/SMS for critical actions
        logger.info({
            triggerId: action.id,
            action: action.action,
            success: result.success
        }, 'User notification sent');
    }
    /**
     * Shutdown the trigger system
     */
    shutdown() {
        // Cancel all scheduled jobs
        for (const [id] of Array.from(this.scheduledJobs)) {
            this.cancelScheduledAction(id);
        }
        logger.info(' Trigger System shut down');
    }
}
// ============================================================================
// Singleton Instance
// ============================================================================
let triggerSystemInstance = null;
/**
 * Get or create the  trigger system
 */
export function getTriggerSystem() {
    if (!triggerSystemInstance) {
        triggerSystemInstance = new TriggerSystem();
    }
    return triggerSystemInstance;
}
/**
 * Reset the trigger system (for testing)
 */
export function resetTriggerSystem() {
    if (triggerSystemInstance) {
        triggerSystemInstance.shutdown();
        triggerSystemInstance = null;
    }
}
export default {
    TriggerSystem,
    getTriggerSystem,
    resetTriggerSystem
};
//# sourceMappingURL=triggerSystem.js.map