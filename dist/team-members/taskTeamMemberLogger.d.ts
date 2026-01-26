/**
 * taskTeamMemberLogger.ts - Logs  Code Task team member activity to SpecMem database
 *
 * yo fr fr this bridges the gap between  Code's Task tool and SpecMem tracking
 *
 * Problem: Task-deployed team members are invisible to SpecMem dashboard
 * Solution: Log team member activity before/after Task deployment
 *
 * Features:
 * - Pre-deployment logging (creates session in database)
 * - Post-deployment logging (updates status, logs, results)
 * - Manual logging for past deployments
 * - Extracts team member activity from  history
 */
import { DatabaseManager } from '../database.js';
export interface TaskTeamMemberDeployment {
    id: string;
    name: string;
    teamMemberType: 'worker' | 'overseer' | 'qa';
    description: string;
    prompt: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    startedAt?: Date;
    completedAt?: Date;
    result?: string;
    error?: string;
    metadata?: Record<string, any>;
}
export interface TaskTeamMemberLog {
    teamMemberId: string;
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    metadata?: Record<string, any>;
    timestamp: Date;
}
/**
 * TaskTeamMemberLogger - Logs Task team member activity to database
 *
 * nah bruh this makes Task team members visible in the dashboard fr fr
 */
export declare class TaskTeamMemberLogger {
    private db;
    constructor(db: DatabaseManager);
    /**
     * logDeploymentStart - Log when a Task team member deployment begins
     *
     * yo call this RIGHT BEFORE deploying a Task team member
     * returns the team member ID to use for subsequent logging
     */
    logDeploymentStart(params: {
        name: string;
        teamMemberType: 'worker' | 'overseer' | 'qa';
        description: string;
        prompt: string;
        metadata?: Record<string, any>;
    }): Promise<string>;
    /**
     * logDeploymentComplete - Log when a Task team member completes
     *
     * yo call this AFTER Task team member finishes (success or failure)
     */
    logDeploymentComplete(teamMemberId: string, params: {
        status: 'completed' | 'failed';
        result?: string;
        error?: string;
        metadata?: Record<string, any>;
    }): Promise<void>;
    /**
     * addLog - Add a log entry for a Task team member
     *
     * yo use this to log important events during Task execution
     */
    addLog(params: {
        teamMemberId: string;
        level: 'info' | 'warn' | 'error' | 'debug';
        message: string;
        metadata?: Record<string, any>;
    }): Promise<void>;
    /**
     * updateProgress - Update team member progress/status
     */
    updateProgress(teamMemberId: string, params: {
        status?: string;
        currentTask?: string;
        tokensUsed?: number;
        metadata?: Record<string, any>;
    }): Promise<void>;
    /**
     * logManualDeployment - Manually log a past Task team member deployment
     *
     * yo use this to retroactively add team members that already ran
     */
    logManualDeployment(params: {
        name: string;
        teamMemberType: 'worker' | 'overseer' | 'qa';
        description: string;
        status: 'completed' | 'failed';
        startedAt: Date;
        completedAt: Date;
        result?: string;
        error?: string;
        logs?: Array<{
            level: 'info' | 'warn' | 'error' | 'debug';
            message: string;
            timestamp: Date;
        }>;
        metadata?: Record<string, any>;
    }): Promise<string>;
    /**
     * getTaskTeamMembers - Get all Task team members from database
     */
    getTaskTeamMembers(limit?: number): Promise<any[]>;
}
/**
 * Get or create global TaskTeamMemberLogger
 */
export declare function getTaskTeamMemberLogger(db?: DatabaseManager): TaskTeamMemberLogger;
/**
 * Initialize global TaskTeamMemberLogger
 */
export declare function initializeTaskTeamMemberLogger(db: DatabaseManager): TaskTeamMemberLogger;
/**
 * deployTaskTeamMemberWithLogging - Wrapper that logs before/after Task deployment
 *
 * yo fr fr use this instead of raw Task tool calls
 *
 * Example:
 * const result = await deployTaskTeamMemberWithLogging({
 *   name: 'Frontend Builder',
 *   teamMemberType: 'worker',
 *   description: 'Build split-screen console UI',
 *   prompt: 'Build a split-screen console...',
 *   taskFn: async (teamMemberId) => {
 *     // Your Task tool deployment here
 *     // Can log progress: await logger.addLog({ teamMemberId, level: 'info', message: '...' })
 *     return { success: true, result: '...' };
 *   }
 * });
 */
export declare function deployTaskTeamMemberWithLogging(params: {
    name: string;
    teamMemberType: 'worker' | 'overseer' | 'qa';
    description: string;
    prompt: string;
    metadata?: Record<string, any>;
    taskFn: (teamMemberId: string, logger: TaskTeamMemberLogger) => Promise<{
        success: boolean;
        result?: string;
        error?: string;
    }>;
}): Promise<{
    teamMemberId: string;
    success: boolean;
    result?: string;
    error?: string;
}>;
//# sourceMappingURL=taskTeamMemberLogger.d.ts.map