/**
 * triggerSystem.ts - Claude Trigger System for MCP Sampling
 *
 * Manages trigger actions that request Claude to perform tasks via MCP sampling.
 * Includes support for immediate triggers, scheduled triggers, and confirmation flow.
 *
 * Phase 6 Implementation - MCP -> Claude Control Flow
 */
export interface TriggerConfig {
    maxTokens?: number;
    intelligencePriority?: number;
    speedPriority?: number;
    costPriority?: number;
    systemPrompt?: string;
}
export interface TriggerContext {
    errorMessage?: string;
    filePath?: string;
    memoryIds?: string[];
    sessionId?: string;
    teamMemberType?: string;
    scope?: string;
    [key: string]: unknown;
}
export interface TriggerAction {
    id: string;
    action: 'fix-error' | 'consolidate' | 'deploy-team-member' | 'analyze-codebase' | 'summarize-session' | 'custom';
    prompt: string;
    config: TriggerConfig;
    context: TriggerContext;
    requireConfirmation: boolean;
}
export interface TriggerResult {
    success: boolean;
    response?: string;
    error?: string;
    tokensUsed?: number;
    duration?: number;
    model?: string;
}
export interface ScheduleConfig {
    cron?: string;
    intervalMinutes?: number;
    runAt?: string;
}
export interface ScheduledJob {
    id: string;
    action: TriggerAction;
    schedule: ScheduleConfig;
    timer?: NodeJS.Timeout;
    lastRun?: Date;
    nextRun?: Date;
    runCount: number;
}
export declare class ClaudeTriggerSystem {
    private scheduledJobs;
    private triggerLog;
    private maxLogSize;
    constructor();
    /**
     * Execute a trigger action via MCP sampling
     */
    triggerAction(action: TriggerAction): Promise<TriggerResult>;
    /**
     * Build the full prompt from action and template
     */
    private buildPrompt;
    /**
     * Schedule a recurring action
     */
    scheduleAction(scheduleId: string, action: TriggerAction, schedule: ScheduleConfig): Promise<void>;
    /**
     * Execute a scheduled job
     */
    private executeScheduledJob;
    /**
     * Cancel a scheduled action
     */
    cancelScheduledAction(scheduleId: string): void;
    /**
     * Get all scheduled jobs
     */
    getScheduledJobs(): ScheduledJob[];
    /**
     * Log a trigger execution
     */
    private logTrigger;
    /**
     * Get trigger execution log
     */
    getTriggerLog(): typeof this.triggerLog;
    /**
     * Get trigger statistics
     */
    getStats(): {
        totalTriggers: number;
        successfulTriggers: number;
        failedTriggers: number;
        averageDuration: number;
        activeSchedules: number;
    };
    /**
     * Request user confirmation for an action
     */
    requestUserConfirmation(action: TriggerAction): Promise<boolean>;
    /**
     * Notify user about a trigger result
     */
    notifyUser(action: TriggerAction, result: TriggerResult): Promise<void>;
    /**
     * Shutdown the trigger system
     */
    shutdown(): void;
}
/**
 * Get or create the Claude trigger system
 */
export declare function getClaudeTriggerSystem(): ClaudeTriggerSystem;
/**
 * Reset the trigger system (for testing)
 */
export declare function resetClaudeTriggerSystem(): void;
declare const _default: {
    ClaudeTriggerSystem: typeof ClaudeTriggerSystem;
    getClaudeTriggerSystem: typeof getClaudeTriggerSystem;
    resetClaudeTriggerSystem: typeof resetClaudeTriggerSystem;
};
export default _default;
//# sourceMappingURL=triggerSystem.d.ts.map