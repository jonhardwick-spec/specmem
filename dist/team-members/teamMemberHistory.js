import { EventEmitter } from 'events';
import { gzipSync, gunzipSync } from 'zlib';
import { logger } from '../utils/logger.js';
import { getTeamMemberTracker } from './teamMemberTracker.js';
const MAX_SESSIONS_IN_MEMORY = 10;
export class TeamMemberHistoryManager extends EventEmitter {
    dbPool = null;
    sessionsByTeamMember = new Map();
    activeSessionsByTeamMember = new Map();
    tracker;
    constructor() {
        super();
        this.tracker = getTeamMemberTracker();
        this.setupEventListeners();
    }
    setupEventListeners() {
        this.tracker.on('team-member:registered', (teamMember) => {
            this.startSession(teamMember);
        });
        this.tracker.on('team-member:status', ({ teamMemberId, status, teamMember }) => {
            if (status === 'completed' || status === 'failed' || status === 'stopped') {
                this.endSession(teamMemberId, status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'interrupted');
            }
        });
        this.tracker.on('team-member:task', ({ teamMemberId, task }) => {
            this.recordTaskUpdate(teamMemberId, task);
        });
        this.tracker.on('code:shared', (shared) => {
            this.recordCodeShared(shared.teamMemberId, shared.id);
        });
        this.tracker.on('feedback:given', (feedback) => {
            this.recordFeedbackGiven(feedback.fromTeamMemberId, feedback.id);
        });
        this.tracker.on('message:sent', (message) => {
            this.recordMessageSent(message.fromTeamMemberId, message.id);
        });
        this.tracker.on('team-member:tokens', ({ teamMemberId, tokensUsed }) => {
            this.updateSessionTokens(teamMemberId, tokensUsed);
        });
    }
    setDatabase(pool) {
        this.dbPool = pool;
        this.ensureSchema().catch(err => logger.error({ err }, 'Failed to create team_member_sessions schema'));
    }
    async ensureSchema() {
        if (!this.dbPool)
            return;
        await this.dbPool.query(`
      CREATE TABLE IF NOT EXISTS team_member_sessions (
        id UUID PRIMARY KEY,
        team_member_id UUID NOT NULL,
        team_member_name VARCHAR(255) NOT NULL,
        team_member_type VARCHAR(50) NOT NULL,
        session_start TIMESTAMPTZ NOT NULL,
        session_end TIMESTAMPTZ,
        tasks_completed JSONB DEFAULT '[]'::jsonb,
        code_shared_ids UUID[] DEFAULT '{}',
        feedback_given_ids UUID[] DEFAULT '{}',
        messages_sent_ids UUID[] DEFAULT '{}',
        tokens_used INTEGER DEFAULT 0,
        status VARCHAR(50) NOT NULL,
        summary TEXT,
        logs_compressed BYTEA,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
        await this.dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_team_member_sessions_team_member ON team_member_sessions(team_member_id)
    `);
        await this.dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_team_member_sessions_start ON team_member_sessions(session_start DESC)
    `);
        await this.dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_team_member_sessions_status ON team_member_sessions(status)
    `);
    }
    async startSession(teamMember) {
        const session = {
            id: crypto.randomUUID(),
            teamMemberId: teamMember.id,
            teamMemberName: teamMember.name,
            teamMemberType: teamMember.type,
            sessionStart: new Date(),
            tasksCompleted: [],
            codeSharedIds: [],
            feedbackGivenIds: [],
            messagesSentIds: [],
            tokensUsed: 0,
            status: 'running',
            createdAt: new Date()
        };
        this.activeSessionsByTeamMember.set(teamMember.id, session);
        logger.debug({ teamMemberId: teamMember.id, sessionId: session.id }, 'Started team member session');
    }
    async endSession(teamMemberId, status) {
        const session = this.activeSessionsByTeamMember.get(teamMemberId);
        if (!session) {
            logger.debug({ teamMemberId }, 'No active session found for team member');
            return;
        }
        session.sessionEnd = new Date();
        session.status = status;
        session.summary = this.generateSessionSummary(session);
        this.activeSessionsByTeamMember.delete(teamMemberId);
        if (!this.sessionsByTeamMember.has(teamMemberId)) {
            this.sessionsByTeamMember.set(teamMemberId, []);
        }
        const sessions = this.sessionsByTeamMember.get(teamMemberId);
        sessions.unshift(session);
        if (sessions.length > MAX_SESSIONS_IN_MEMORY) {
            sessions.pop();
        }
        if (this.dbPool) {
            await this.persistSession(session, teamMemberId);
        }
        this.emit('session:ended', session);
        logger.info({ teamMemberId, sessionId: session.id, status }, 'Team Member session ended');
    }
    generateSessionSummary(session) {
        const duration = session.sessionEnd
            ? Math.round((session.sessionEnd.getTime() - session.sessionStart.getTime()) / 1000)
            : 0;
        const completedTasks = session.tasksCompleted.filter(t => t.status === 'completed').length;
        const totalTasks = session.tasksCompleted.length;
        return `Session ran for ${duration}s. Completed ${completedTasks}/${totalTasks} tasks. ` +
            `Shared ${session.codeSharedIds.length} code snippets, gave ${session.feedbackGivenIds.length} feedback, ` +
            `sent ${session.messagesSentIds.length} messages. Used ${session.tokensUsed} tokens.`;
    }
    async persistSession(session, teamMemberId) {
        if (!this.dbPool)
            return;
        try {
            const logs = await this.tracker.getLogs(teamMemberId, 1000, 0);
            const logsJson = JSON.stringify(logs);
            const logsCompressed = gzipSync(Buffer.from(logsJson));
            await this.dbPool.query(`
        INSERT INTO team_member_sessions (
          id, team_member_id, team_member_name, team_member_type, session_start, session_end,
          tasks_completed, code_shared_ids, feedback_given_ids, messages_sent_ids,
          tokens_used, status, summary, logs_compressed, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `, [
                session.id,
                session.teamMemberId,
                session.teamMemberName,
                session.teamMemberType,
                session.sessionStart,
                session.sessionEnd,
                JSON.stringify(session.tasksCompleted),
                session.codeSharedIds,
                session.feedbackGivenIds,
                session.messagesSentIds,
                session.tokensUsed,
                session.status,
                session.summary,
                logsCompressed,
                session.createdAt
            ]);
        }
        catch (err) {
            logger.error({ err, sessionId: session.id }, 'Failed to persist session');
        }
    }
    recordTaskUpdate(teamMemberId, task) {
        const session = this.activeSessionsByTeamMember.get(teamMemberId);
        if (!session)
            return;
        const existingIndex = session.tasksCompleted.findIndex(t => t.id === task.id);
        const taskRecord = {
            id: task.id,
            name: task.name || 'Unknown Task',
            description: task.description || '',
            status: task.status,
            startedAt: task.startedAt ? new Date(task.startedAt) : undefined,
            completedAt: task.completedAt ? new Date(task.completedAt) : undefined
        };
        if (existingIndex >= 0) {
            session.tasksCompleted[existingIndex] = taskRecord;
        }
        else {
            session.tasksCompleted.push(taskRecord);
        }
    }
    recordCodeShared(teamMemberId, codeId) {
        const session = this.activeSessionsByTeamMember.get(teamMemberId);
        if (!session)
            return;
        session.codeSharedIds.push(codeId);
    }
    recordFeedbackGiven(teamMemberId, feedbackId) {
        const session = this.activeSessionsByTeamMember.get(teamMemberId);
        if (!session)
            return;
        session.feedbackGivenIds.push(feedbackId);
    }
    recordMessageSent(teamMemberId, messageId) {
        const session = this.activeSessionsByTeamMember.get(teamMemberId);
        if (!session)
            return;
        session.messagesSentIds.push(messageId);
    }
    updateSessionTokens(teamMemberId, tokensUsed) {
        const session = this.activeSessionsByTeamMember.get(teamMemberId);
        if (!session)
            return;
        session.tokensUsed = tokensUsed;
    }
    async getTeamMembersWithSessionCounts() {
        if (!this.dbPool) {
            return Array.from(this.sessionsByTeamMember.entries()).map(([teamMemberId, sessions]) => {
                const latest = sessions[0];
                const totalTokens = sessions.reduce((sum, s) => sum + s.tokensUsed, 0);
                return {
                    id: teamMemberId,
                    name: latest?.teamMemberName || 'Unknown',
                    type: latest?.teamMemberType || 'worker',
                    sessionCount: sessions.length,
                    lastSessionDate: latest?.sessionStart,
                    totalTokensUsed: totalTokens
                };
            });
        }
        try {
            const result = await this.dbPool.query(`
        SELECT
          team_member_id as id,
          team_member_name as name,
          team_member_type as type,
          COUNT(*) as session_count,
          MAX(session_start) as last_session_date,
          SUM(tokens_used) as total_tokens_used
        FROM team_member_sessions
        GROUP BY team_member_id, team_member_name, team_member_type
        ORDER BY last_session_date DESC
      `);
            return result.rows.map((row) => ({
                id: row.id,
                name: row.name,
                type: row.type,
                sessionCount: parseInt(row.session_count, 10),
                lastSessionDate: row.last_session_date ? new Date(row.last_session_date) : undefined,
                totalTokensUsed: parseInt(row.total_tokens_used || '0', 10)
            }));
        }
        catch (err) {
            logger.error({ err }, 'Failed to get team members with session counts');
            return [];
        }
    }
    async getSessionsForTeamMember(teamMemberId, limit = 10, offset = 0) {
        if (!this.dbPool) {
            const cached = this.sessionsByTeamMember.get(teamMemberId) || [];
            return cached.slice(offset, offset + limit).map(s => this.toSessionWithCounts(s));
        }
        try {
            const result = await this.dbPool.query(`
        SELECT
          id, team_member_id, team_member_name, team_member_type, session_start, session_end,
          tasks_completed, code_shared_ids, feedback_given_ids, messages_sent_ids,
          tokens_used, status, summary
        FROM team_member_sessions
        WHERE team_member_id = $1
        ORDER BY session_start DESC
        LIMIT $2 OFFSET $3
      `, [teamMemberId, limit, offset]);
            return result.rows.map((row) => this.rowToSessionWithCounts(row));
        }
        catch (err) {
            logger.error({ err, teamMemberId }, 'Failed to get sessions for team member');
            return [];
        }
    }
    async getSessionDetails(sessionId) {
        for (const sessions of Array.from(this.sessionsByTeamMember.values())) {
            const found = sessions.find(s => s.id === sessionId);
            if (found)
                return found;
        }
        for (const session of Array.from(this.activeSessionsByTeamMember.values())) {
            if (session.id === sessionId)
                return session;
        }
        if (!this.dbPool)
            return null;
        try {
            const result = await this.dbPool.query(`
        SELECT * FROM team_member_sessions WHERE id = $1
      `, [sessionId]);
            if (result.rows.length === 0)
                return null;
            return this.rowToSession(result.rows[0]);
        }
        catch (err) {
            logger.error({ err, sessionId }, 'Failed to get session details');
            return null;
        }
    }
    async getSessionLogs(sessionId, limit = 100, offset = 0) {
        if (!this.dbPool) {
            return [];
        }
        try {
            const result = await this.dbPool.query(`
        SELECT logs_compressed FROM team_member_sessions WHERE id = $1
      `, [sessionId]);
            if (result.rows.length === 0 || !result.rows[0].logs_compressed) {
                return [];
            }
            const compressed = result.rows[0].logs_compressed;
            const decompressed = gunzipSync(compressed);
            const logs = JSON.parse(decompressed.toString());
            return logs.slice(offset, offset + limit);
        }
        catch (err) {
            logger.error({ err, sessionId }, 'Failed to get session logs');
            return [];
        }
    }
    async getSessionLogCount(sessionId) {
        if (!this.dbPool)
            return 0;
        try {
            const result = await this.dbPool.query(`
        SELECT logs_compressed FROM team_member_sessions WHERE id = $1
      `, [sessionId]);
            if (result.rows.length === 0 || !result.rows[0].logs_compressed) {
                return 0;
            }
            const compressed = result.rows[0].logs_compressed;
            const decompressed = gunzipSync(compressed);
            const logs = JSON.parse(decompressed.toString());
            return logs.length;
        }
        catch (err) {
            logger.error({ err, sessionId }, 'Failed to get session log count');
            return 0;
        }
    }
    getActiveSession(teamMemberId) {
        return this.activeSessionsByTeamMember.get(teamMemberId);
    }
    toSessionWithCounts(session) {
        return {
            id: session.id,
            teamMemberId: session.teamMemberId,
            teamMemberName: session.teamMemberName,
            teamMemberType: session.teamMemberType,
            sessionStart: session.sessionStart,
            sessionEnd: session.sessionEnd,
            taskCount: session.tasksCompleted.length,
            codeCount: session.codeSharedIds.length,
            feedbackCount: session.feedbackGivenIds.length,
            messageCount: session.messagesSentIds.length,
            tokensUsed: session.tokensUsed,
            status: session.status,
            summary: session.summary
        };
    }
    rowToSessionWithCounts(row) {
        let tasks = row.tasks_completed;
        if (typeof tasks === 'string') {
            try {
                tasks = JSON.parse(tasks);
            }
            catch {
                tasks = [];
            }
        }
        return {
            id: row.id,
            teamMemberId: row.team_member_id,
            teamMemberName: row.team_member_name,
            teamMemberType: row.team_member_type,
            sessionStart: new Date(row.session_start),
            sessionEnd: row.session_end ? new Date(row.session_end) : undefined,
            taskCount: Array.isArray(tasks) ? tasks.length : 0,
            codeCount: (row.code_shared_ids || []).length,
            feedbackCount: (row.feedback_given_ids || []).length,
            messageCount: (row.messages_sent_ids || []).length,
            tokensUsed: row.tokens_used || 0,
            status: row.status,
            summary: row.summary
        };
    }
    rowToSession(row) {
        let tasks = row.tasks_completed;
        if (typeof tasks === 'string') {
            try {
                tasks = JSON.parse(tasks);
            }
            catch {
                tasks = [];
            }
        }
        return {
            id: row.id,
            teamMemberId: row.team_member_id,
            teamMemberName: row.team_member_name,
            teamMemberType: row.team_member_type,
            sessionStart: new Date(row.session_start),
            sessionEnd: row.session_end ? new Date(row.session_end) : undefined,
            tasksCompleted: tasks || [],
            codeSharedIds: row.code_shared_ids || [],
            feedbackGivenIds: row.feedback_given_ids || [],
            messagesSentIds: row.messages_sent_ids || [],
            tokensUsed: row.tokens_used || 0,
            status: row.status,
            summary: row.summary,
            createdAt: new Date(row.created_at)
        };
    }
    async shutdown() {
        for (const teamMemberId of Array.from(this.activeSessionsByTeamMember.keys())) {
            await this.endSession(teamMemberId, 'interrupted');
        }
        logger.info('TeamMemberHistoryManager shutdown complete');
    }
}
let globalHistoryManager = null;
export function getTeamMemberHistoryManager() {
    if (!globalHistoryManager) {
        globalHistoryManager = new TeamMemberHistoryManager();
    }
    return globalHistoryManager;
}
//# sourceMappingURL=teamMemberHistory.js.map