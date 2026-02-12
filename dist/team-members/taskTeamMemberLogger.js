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
import { logger, serializeError } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
/**
 * TaskTeamMemberLogger - Logs Task team member activity to database
 *
 * nah bruh this makes Task team members visible in the dashboard fr fr
 */
export class TaskTeamMemberLogger {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * logDeploymentStart - Log when a Task team member deployment begins
     *
     * yo call this RIGHT BEFORE deploying a Task team member
     * returns the team member ID to use for subsequent logging
     */
    async logDeploymentStart(params) {
        const teamMemberId = uuidv4();
        try {
            // Insert into team_member_sessions table
            await this.db.query(`
        INSERT INTO team_member_sessions (
          id,
          team_member_id,
          team_member_name,
          team_member_type,
          status,
          current_task,
          metadata,
          started_at,
          last_heartbeat,
          session_start
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
      `, [
                uuidv4(), // session id
                teamMemberId,
                params.name,
                params.teamMemberType,
                'running',
                params.description,
                JSON.stringify({
                    ...params.metadata,
                    isTaskTeamMember: true,
                    prompt: params.prompt,
                    deployedVia: 'claude-code-task-tool'
                })
            ]);
            // Also insert into team_member_deployments for compatibility
            await this.db.query(`
        INSERT INTO team_member_deployments (
          id,
          deployment_name,
          deployment_type,
          environment,
          status,
          started_at,
          task_description,
          metadata,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, NOW())
      `, [
                teamMemberId,
                params.name,
                params.teamMemberType,
                'task-tool',
                'running',
                params.description,
                JSON.stringify({
                    ...params.metadata,
                    isTaskTeamMember: true,
                    prompt: params.prompt
                })
            ]);
            logger.info({
                teamMemberId,
                name: params.name,
                teamMemberType: params.teamMemberType
            }, 'Task team member deployment logged - started');
            return teamMemberId;
        }
        catch (error) {
            logger.error({
                error: serializeError(error),
                name: params.name
            }, 'Failed to log Task team member deployment start');
            throw error;
        }
    }
    /**
     * logDeploymentComplete - Log when a Task team member completes
     *
     * yo call this AFTER Task team member finishes (success or failure)
     */
    async logDeploymentComplete(teamMemberId, params) {
        try {
            // Update team_member_sessions
            await this.db.query(`
        UPDATE team_member_sessions
        SET status = $1,
            ended_at = NOW(),
            session_end = NOW(),
            metadata = metadata || $2::jsonb
        WHERE team_member_id = $3
      `, [
                params.status === 'completed' ? 'terminated' : 'error',
                JSON.stringify({
                    result: params.result,
                    error: params.error,
                    completedAt: new Date().toISOString(),
                    ...params.metadata
                }),
                teamMemberId
            ]);
            // Update team_member_deployments
            await this.db.query(`
        UPDATE team_member_deployments
        SET status = $1,
            completed_at = NOW(),
            success = $2,
            result_summary = $3,
            error_message = $4,
            metadata = metadata || $5::jsonb
        WHERE id = $6
      `, [
                params.status,
                params.status === 'completed',
                params.result,
                params.error,
                JSON.stringify({
                    completedAt: new Date().toISOString(),
                    ...params.metadata
                }),
                teamMemberId
            ]);
            logger.info({
                teamMemberId,
                status: params.status
            }, 'Task team member deployment logged - completed');
        }
        catch (error) {
            logger.error({
                error: serializeError(error),
                teamMemberId
            }, 'Failed to log Task team member deployment completion');
        }
    }
    /**
     * addLog - Add a log entry for a Task team member
     *
     * yo use this to log important events during Task execution
     */
    async addLog(params) {
        try {
            await this.db.query(`
        INSERT INTO team_member_logs (
          id,
          team_member_id,
          level,
          message,
          metadata,
          created_at
        ) VALUES (
          gen_random_uuid(),
          (SELECT id FROM team_member_sessions WHERE team_member_id = $1 LIMIT 1),
          $2,
          $3,
          $4,
          NOW()
        )
      `, [
                params.teamMemberId,
                params.level,
                params.message,
                JSON.stringify(params.metadata || {})
            ]);
            // Update last_heartbeat
            await this.db.query(`
        UPDATE team_member_sessions
        SET last_heartbeat = NOW(),
            message_count = message_count + 1
        WHERE team_member_id = $1
      `, [params.teamMemberId]);
        }
        catch (error) {
            logger.error({
                error: serializeError(error),
                teamMemberId: params.teamMemberId
            }, 'Failed to add Task team member log');
        }
    }
    /**
     * updateProgress - Update team member progress/status
     */
    async updateProgress(teamMemberId, params) {
        try {
            const updates = [];
            const values = [];
            let paramIndex = 1;
            if (params.status) {
                updates.push(`status = $${paramIndex++}`);
                values.push(params.status);
            }
            if (params.currentTask) {
                updates.push(`current_task = $${paramIndex++}`);
                values.push(params.currentTask);
            }
            if (params.tokensUsed !== undefined) {
                updates.push(`tokens_used = $${paramIndex++}`);
                values.push(params.tokensUsed);
            }
            if (params.metadata) {
                updates.push(`metadata = metadata || $${paramIndex++}::jsonb`);
                values.push(JSON.stringify(params.metadata));
            }
            updates.push(`last_heartbeat = NOW()`);
            values.push(teamMemberId);
            if (updates.length > 1) { // More than just last_heartbeat
                await this.db.query(`
          UPDATE team_member_sessions
          SET ${updates.join(', ')}
          WHERE team_member_id = $${paramIndex}
        `, values);
            }
        }
        catch (error) {
            logger.error({
                error: serializeError(error),
                teamMemberId
            }, 'Failed to update Task team member progress');
        }
    }
    /**
     * logManualDeployment - Manually log a past Task team member deployment
     *
     * yo use this to retroactively add team members that already ran
     */
    async logManualDeployment(params) {
        const teamMemberId = uuidv4();
        const sessionId = uuidv4();
        try {
            // Insert session
            await this.db.query(`
        INSERT INTO team_member_sessions (
          id,
          team_member_id,
          team_member_name,
          team_member_type,
          status,
          current_task,
          started_at,
          ended_at,
          session_start,
          session_end,
          last_heartbeat,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
                sessionId,
                teamMemberId,
                params.name,
                params.teamMemberType,
                params.status === 'completed' ? 'terminated' : 'error',
                params.description,
                params.startedAt,
                params.completedAt,
                params.startedAt,
                params.completedAt,
                params.completedAt,
                JSON.stringify({
                    ...params.metadata,
                    isTaskTeamMember: true,
                    manuallyLogged: true,
                    result: params.result,
                    error: params.error
                })
            ]);
            // Insert deployment
            await this.db.query(`
        INSERT INTO team_member_deployments (
          id,
          deployment_name,
          deployment_type,
          environment,
          status,
          started_at,
          completed_at,
          success,
          task_description,
          result_summary,
          error_message,
          metadata,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
                teamMemberId,
                params.name,
                params.teamMemberType,
                'task-tool',
                params.status,
                params.startedAt,
                params.completedAt,
                params.status === 'completed',
                params.description,
                params.result,
                params.error,
                JSON.stringify({
                    ...params.metadata,
                    isTaskTeamMember: true,
                    manuallyLogged: true
                }),
                params.startedAt
            ]);
            // Insert logs if provided
            if (params.logs && params.logs.length > 0) {
                for (const log of params.logs) {
                    await this.db.query(`
            INSERT INTO team_member_logs (
              id,
              team_member_id,
              level,
              message,
              created_at
            ) VALUES (gen_random_uuid(), $1, $2, $3, $4)
          `, [sessionId, log.level, log.message, log.timestamp]);
                }
            }
            logger.info({
                teamMemberId,
                name: params.name,
                status: params.status
            }, 'Task team member manually logged');
            return teamMemberId;
        }
        catch (error) {
            logger.error({
                error: serializeError(error),
                name: params.name
            }, 'Failed to manually log Task team member');
            throw error;
        }
    }
    /**
     * getTaskTeamMembers - Get all Task team members from database
     */
    async getTaskTeamMembers(limit = 50) {
        try {
            const result = await this.db.query(`
        SELECT
          s.team_member_id,
          s.team_member_name,
          s.team_member_type,
          s.status,
          s.current_task,
          s.started_at,
          s.ended_at,
          s.metadata
        FROM team_member_sessions s
        WHERE s.metadata->>'isTaskTeamMember' = 'true'
        ORDER BY s.started_at DESC
        LIMIT $1
      `, [limit]);
            return result.rows.map(row => ({
                id: row.team_member_id,
                name: row.team_member_name,
                type: row.team_member_type,
                status: row.status,
                description: row.current_task,
                startedAt: row.started_at,
                completedAt: row.ended_at,
                metadata: row.metadata
            }));
        }
        catch (error) {
            logger.error({ error: serializeError(error) }, 'Failed to get Task team members');
            return [];
        }
    }
}
// ============================================================================
// Global Instance
// ============================================================================
let globalLogger = null;
/**
 * Get or create global TaskTeamMemberLogger
 */
export function getTaskTeamMemberLogger(db) {
    if (!globalLogger && db) {
        globalLogger = new TaskTeamMemberLogger(db);
    }
    if (!globalLogger) {
        throw new Error('TaskTeamMemberLogger not initialized - pass DatabaseManager on first call');
    }
    return globalLogger;
}
/**
 * Initialize global TaskTeamMemberLogger
 */
export function initializeTaskTeamMemberLogger(db) {
    globalLogger = new TaskTeamMemberLogger(db);
    return globalLogger;
}
// ============================================================================
// Convenience Wrapper Functions
// ============================================================================
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
export async function deployTaskTeamMemberWithLogging(params) {
    const logger = getTaskTeamMemberLogger();
    // Log deployment start
    const teamMemberId = await logger.logDeploymentStart({
        name: params.name,
        teamMemberType: params.teamMemberType,
        description: params.description,
        prompt: params.prompt,
        metadata: params.metadata
    });
    try {
        // Execute the task
        const taskResult = await params.taskFn(teamMemberId, logger);
        // Log completion
        await logger.logDeploymentComplete(teamMemberId, {
            status: taskResult.success ? 'completed' : 'failed',
            result: taskResult.result,
            error: taskResult.error
        });
        return {
            teamMemberId,
            success: taskResult.success,
            result: taskResult.result,
            error: taskResult.error
        };
    }
    catch (error) {
        // Log failure
        await logger.logDeploymentComplete(teamMemberId, {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error)
        });
        return {
            teamMemberId,
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
//# sourceMappingURL=taskTeamMemberLogger.js.map