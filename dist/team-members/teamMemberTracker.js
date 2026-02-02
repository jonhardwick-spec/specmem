import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { LRUCache } from '../utils/memoryManager.js';
const MAX_LOGS_PER_TEAM_MEMBER = 100;
const MAX_TEAM_MEMBERS_IN_MEMORY = 50;
const MAX_SHARED_CODE_IN_MEMORY = 100;
const MAX_FEEDBACK_IN_MEMORY = 500;
const MAX_MESSAGES_IN_MEMORY = 500;
const MAX_CODE_SIZE_IN_MEMORY = 50 * 1024;
const CODE_PREVIEW_SIZE = 1024;
const CODE_CHUNK_SIZE = 50 * 1024;
export class TeamMemberTracker extends EventEmitter {
    teamMembers;
    teamMemberLogs;
    dbPool = null;
    overflowEnabled = false;
    totalOverflowed = 0;
    sharedCode;
    feedback = [];
    messages = [];
    feedbackByCode = new Map();
    messagesByTeamMember = new Map();
    constructor() {
        super();
        this.teamMembers = new LRUCache(MAX_TEAM_MEMBERS_IN_MEMORY);
        this.teamMemberLogs = new Map();
        this.sharedCode = new LRUCache(MAX_SHARED_CODE_IN_MEMORY);
    }
    setDatabase(pool) {
        this.dbPool = pool;
        this.overflowEnabled = true;
        this.ensureSchema().catch(err => logger.error({ err }, 'Failed to create team member schema'));
    }
    async ensureSchema() {
        if (!this.dbPool)
            return;
        await this.dbPool.query(`
      CREATE TABLE IF NOT EXISTS team_member_deployments (
        id UUID PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL,
        tokens_used INTEGER DEFAULT 0,
        tokens_limit INTEGER DEFAULT 20000,
        current_task JSONB,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        stopped_at TIMESTAMPTZ,
        last_heartbeat TIMESTAMPTZ
      )
    `);
        await this.dbPool.query(`
      CREATE TABLE IF NOT EXISTS team_member_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        team_member_id UUID NOT NULL REFERENCES team_member_deployments(id) ON DELETE CASCADE,
        level VARCHAR(20) NOT NULL,
        message TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
        await this.dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_team_member_logs_team_member ON team_member_logs(team_member_id)
    `);
        await this.dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_team_member_logs_created ON team_member_logs(created_at DESC)
    `);
        await this.dbPool.query(`
      CREATE TABLE IF NOT EXISTS team_member_shared_code (
        id UUID PRIMARY KEY,
        team_member_id UUID REFERENCES team_member_deployments(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        code TEXT,
        code_preview TEXT NOT NULL,
        code_size INTEGER NOT NULL DEFAULT 0,
        is_chunked BOOLEAN NOT NULL DEFAULT FALSE,
        total_chunks INTEGER DEFAULT 0,
        file_path VARCHAR(500),
        language VARCHAR(50) DEFAULT 'text',
        tags TEXT[],
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
        await this.dbPool.query(`
      CREATE TABLE IF NOT EXISTS team_member_code_chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shared_code_id UUID NOT NULL REFERENCES team_member_shared_code(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        chunk_data TEXT NOT NULL,
        chunk_size INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
        await this.dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_code_chunks_code ON team_member_code_chunks(shared_code_id, chunk_index)
    `);
        await this.dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_shared_code_team_member ON team_member_shared_code(team_member_id)
    `);
        await this.dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_shared_code_created ON team_member_shared_code(created_at DESC)
    `);
        await this.dbPool.query(`
      CREATE TABLE IF NOT EXISTS team_member_feedback (
        id UUID PRIMARY KEY,
        shared_code_id UUID REFERENCES team_member_shared_code(id) ON DELETE CASCADE,
        from_team_member_id UUID REFERENCES team_member_deployments(id) ON DELETE SET NULL,
        feedback_type VARCHAR(20) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
        await this.dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_feedback_code ON team_member_feedback(shared_code_id)
    `);
        await this.dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_feedback_team_member ON team_member_feedback(from_team_member_id)
    `);
        await this.dbPool.query(`
      CREATE TABLE IF NOT EXISTS team_member_to_team_member_messages (
        id UUID PRIMARY KEY,
        from_team_member_id UUID REFERENCES team_member_deployments(id) ON DELETE SET NULL,
        to_team_member_id UUID REFERENCES team_member_deployments(id) ON DELETE SET NULL,
        message TEXT NOT NULL,
        metadata JSONB,
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
        await this.dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_a2a_messages_to ON team_member_to_team_member_messages(to_team_member_id)
    `);
        await this.dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_a2a_messages_from ON team_member_to_team_member_messages(from_team_member_id)
    `);
        await this.dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_a2a_messages_unread ON team_member_to_team_member_messages(to_team_member_id, read) WHERE read = FALSE
    `);
    }
    async registerTeamMember(teamMember) {
        const fullTeamMember = {
            ...teamMember,
            tokensUsed: 0,
            createdAt: new Date()
        };
        this.teamMembers.set(teamMember.id, fullTeamMember, this.estimateTeamMemberSize(fullTeamMember));
        this.teamMemberLogs.set(teamMember.id, []);
        if (this.overflowEnabled) {
            await this.persistTeamMember(fullTeamMember);
        }
        this.emit('teamMember:registered', fullTeamMember);
        logger.info({ teamMemberId: teamMember.id, name: teamMember.name }, 'Team Member registered');
        return fullTeamMember;
    }
    async updateTeamMemberStatus(teamMemberId, status, metadata) {
        let teamMember = this.teamMembers.get(teamMemberId);
        if (!teamMember && this.overflowEnabled) {
            teamMember = await this.loadTeamMemberFromDb(teamMemberId);
        }
        if (!teamMember) {
            logger.warn({ teamMemberId }, 'Team Member not found for status update');
            return;
        }
        teamMember.status = status;
        if (status === 'running' && !teamMember.startedAt) {
            teamMember.startedAt = new Date();
        }
        if (status === 'stopped' || status === 'completed' || status === 'failed') {
            teamMember.stoppedAt = new Date();
        }
        if (metadata) {
            teamMember.metadata = { ...teamMember.metadata, ...metadata };
        }
        this.teamMembers.set(teamMemberId, teamMember, this.estimateTeamMemberSize(teamMember));
        if (this.overflowEnabled) {
            await this.persistTeamMember(teamMember);
        }
        this.emit('teamMember:status', { teamMemberId, status, teamMember });
    }
    async updateTaskProgress(teamMemberId, task) {
        let teamMember = this.teamMembers.get(teamMemberId);
        if (!teamMember && this.overflowEnabled) {
            teamMember = await this.loadTeamMemberFromDb(teamMemberId);
        }
        if (!teamMember)
            return;
        if (!teamMember.currentTask && task.id) {
            teamMember.currentTask = {
                id: task.id,
                name: task.name || 'Unknown Task',
                description: task.description || '',
                progress: task.progress || 0,
                status: task.status || 'pending'
            };
        }
        else if (teamMember.currentTask) {
            Object.assign(teamMember.currentTask, task);
        }
        this.teamMembers.set(teamMemberId, teamMember, this.estimateTeamMemberSize(teamMember));
        if (this.overflowEnabled) {
            await this.persistTeamMember(teamMember);
        }
        this.emit('teamMember:task', { teamMemberId, task: teamMember.currentTask });
    }
    async addTokenUsage(teamMemberId, tokens) {
        let teamMember = this.teamMembers.get(teamMemberId);
        if (!teamMember && this.overflowEnabled) {
            teamMember = await this.loadTeamMemberFromDb(teamMemberId);
        }
        if (!teamMember)
            return;
        teamMember.tokensUsed += tokens;
        this.teamMembers.set(teamMemberId, teamMember, this.estimateTeamMemberSize(teamMember));
        if (this.overflowEnabled) {
            await this.persistTeamMember(teamMember);
        }
        this.emit('teamMember:tokens', { teamMemberId, tokensUsed: teamMember.tokensUsed, tokensLimit: teamMember.tokensLimit });
    }
    async heartbeat(teamMemberId) {
        let teamMember = this.teamMembers.get(teamMemberId);
        if (!teamMember && this.overflowEnabled) {
            teamMember = await this.loadTeamMemberFromDb(teamMemberId);
        }
        if (!teamMember)
            return;
        teamMember.lastHeartbeat = new Date();
        this.teamMembers.set(teamMemberId, teamMember, this.estimateTeamMemberSize(teamMember));
    }
    async addLog(teamMemberId, level, message, metadata) {
        const log = {
            id: crypto.randomUUID(),
            teamMemberId,
            timestamp: new Date(),
            level,
            message,
            metadata
        };
        let logs = this.teamMemberLogs.get(teamMemberId);
        if (!logs) {
            logs = [];
            this.teamMemberLogs.set(teamMemberId, logs);
        }
        logs.push(log);
        if (logs.length > MAX_LOGS_PER_TEAM_MEMBER) {
            const overflow = logs.splice(0, logs.length - MAX_LOGS_PER_TEAM_MEMBER);
            if (this.overflowEnabled) {
                await this.persistLogs(overflow);
            }
        }
        this.emit('teamMember:log', log);
    }
    async getTeamMember(teamMemberId) {
        let teamMember = this.teamMembers.get(teamMemberId);
        if (!teamMember && this.overflowEnabled) {
            teamMember = await this.loadTeamMemberFromDb(teamMemberId);
        }
        return teamMember;
    }
    async getAllTeamMembers() {
        const cached = this.teamMembers.getAllEntries().map(e => e.value);
        if (this.overflowEnabled) {
            const result = await this.dbPool.query(`
        SELECT * FROM team_member_deployments ORDER BY created_at DESC LIMIT 100
      `);
            const dbTeamMembers = result.rows.map(this.rowToTeamMember.bind(this));
            const ids = new Set(cached.map(a => a.id));
            return [...cached, ...dbTeamMembers.filter((a) => !ids.has(a.id))];
        }
        return cached;
    }
    async getTeamMembersByStatus(status) {
        const all = await this.getAllTeamMembers();
        return all.filter(a => a.status === status);
    }
    async getLogs(teamMemberId, limit = 50, offset = 0) {
        const inMemory = this.teamMemberLogs.get(teamMemberId) || [];
        if (offset < inMemory.length) {
            const slice = inMemory.slice(Math.max(0, inMemory.length - limit - offset), inMemory.length - offset);
            if (slice.length >= limit)
                return slice.reverse();
        }
        if (this.overflowEnabled) {
            const result = await this.dbPool.query(`
        SELECT id, team_member_id, level, message, metadata, created_at as timestamp
        FROM team_member_logs WHERE team_member_id = $1
        ORDER BY created_at DESC LIMIT $2 OFFSET $3
      `, [teamMemberId, limit, offset]);
            return result.rows.map((r) => ({
                id: r.id,
                teamMemberId: r.team_member_id,
                timestamp: r.timestamp,
                level: r.level,
                message: r.message,
                metadata: r.metadata
            }));
        }
        return inMemory.slice(-limit).reverse();
    }
    async streamLogs(teamMemberId, callback) {
        const handler = (log) => {
            if (log.teamMemberId === teamMemberId)
                callback(log);
        };
        this.on('teamMember:log', handler);
        return () => this.off('teamMember:log', handler);
    }
    getStats() {
        const teamMembers = this.teamMembers.getAllEntries().map(e => e.value);
        const running = teamMembers.filter(a => a.status === 'running');
        const completed = teamMembers.filter(a => a.status === 'completed');
        const failed = teamMembers.filter(a => a.status === 'failed');
        let totalProgress = 0;
        let progressCount = 0;
        for (const teamMember of teamMembers) {
            if (teamMember.currentTask) {
                totalProgress += teamMember.currentTask.progress;
                progressCount++;
            }
        }
        return {
            totalTeamMembers: teamMembers.length,
            runningTeamMembers: running.length,
            completedTeamMembers: completed.length,
            failedTeamMembers: failed.length,
            totalTokensUsed: teamMembers.reduce((sum, a) => sum + a.tokensUsed, 0),
            avgTaskProgress: progressCount > 0 ? totalProgress / progressCount : 0
        };
    }
    estimateTeamMemberSize(teamMember) {
        return JSON.stringify(teamMember).length * 2;
    }
    async persistTeamMember(teamMember) {
        if (!this.dbPool)
            return;
        try {
            await this.dbPool.query(`
        INSERT INTO team_member_deployments (id, name, type, status, tokens_used, tokens_limit, current_task, metadata, created_at, started_at, stopped_at, last_heartbeat)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          tokens_used = EXCLUDED.tokens_used,
          current_task = EXCLUDED.current_task,
          metadata = EXCLUDED.metadata,
          started_at = EXCLUDED.started_at,
          stopped_at = EXCLUDED.stopped_at,
          last_heartbeat = EXCLUDED.last_heartbeat
      `, [
                teamMember.id,
                teamMember.name,
                teamMember.type,
                teamMember.status,
                teamMember.tokensUsed,
                teamMember.tokensLimit,
                JSON.stringify(teamMember.currentTask || null),
                JSON.stringify(teamMember.metadata || {}),
                teamMember.createdAt,
                teamMember.startedAt || null,
                teamMember.stoppedAt || null,
                teamMember.lastHeartbeat || null
            ]);
        }
        catch (err) {
            logger.error({ err, teamMemberId: teamMember.id }, 'Failed to persist team member');
        }
    }
    async persistLogs(logs) {
        if (!this.dbPool || logs.length === 0)
            return;
        try {
            // HIGH-10 FIX: Use fully parameterized queries to prevent SQL injection
            // Previously used string interpolation for id, teamMemberId, level, timestamp
            const paramsPerLog = 6;
            const values = logs.map((_, i) => {
                const base = i * paramsPerLog;
                return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
            });
            const params = logs.flatMap(l => [
                l.id,
                l.teamMemberId,
                l.level,
                l.message,
                JSON.stringify(l.metadata || {}),
                l.timestamp.toISOString()
            ]);
            await this.dbPool.query(`
        INSERT INTO team_member_logs (id, team_member_id, level, message, metadata, created_at)
        VALUES ${values.join(', ')}
        ON CONFLICT DO NOTHING
      `, params);
            this.totalOverflowed += logs.length;
        }
        catch (err) {
            logger.error({ err }, 'Failed to persist logs');
        }
    }
    async loadTeamMemberFromDb(teamMemberId) {
        if (!this.dbPool)
            return undefined;
        try {
            const result = await this.dbPool.query('SELECT * FROM team_member_deployments WHERE id = $1', [teamMemberId]);
            if (result.rows.length === 0)
                return undefined;
            return this.rowToTeamMember(result.rows[0]);
        }
        catch (err) {
            logger.error({ err, teamMemberId }, 'Failed to load team member from db');
            return undefined;
        }
    }
    rowToTeamMember(row) {
        let currentTask = row.current_task;
        if (typeof currentTask === 'string') {
            try {
                currentTask = JSON.parse(currentTask);
            }
            catch {
                currentTask = undefined;
            }
        }
        return {
            id: row.id,
            name: row.name,
            type: row.type,
            status: row.status,
            tokensUsed: row.tokens_used || 0,
            tokensLimit: row.tokens_limit || 20000,
            currentTask: currentTask || undefined,
            metadata: row.metadata || {},
            createdAt: new Date(row.created_at),
            startedAt: row.started_at ? new Date(row.started_at) : undefined,
            stoppedAt: row.stopped_at ? new Date(row.stopped_at) : undefined,
            lastHeartbeat: row.last_heartbeat ? new Date(row.last_heartbeat) : undefined
        };
    }
    async shareCode(teamMemberId, data) {
        const codeBytes = Buffer.byteLength(data.code, 'utf-8');
        const isChunked = codeBytes > MAX_CODE_SIZE_IN_MEMORY;
        const codePreview = data.code.substring(0, CODE_PREVIEW_SIZE);
        const totalChunks = isChunked ? Math.ceil(codeBytes / CODE_CHUNK_SIZE) : 0;
        const shared = {
            id: crypto.randomUUID(),
            teamMemberId,
            title: data.title,
            description: data.description,
            code: isChunked ? undefined : data.code,
            codePreview,
            codeSize: codeBytes,
            isChunked,
            totalChunks: isChunked ? totalChunks : undefined,
            filePath: data.filePath,
            language: data.language || this.detectLanguage(data.filePath || data.code),
            tags: data.tags || [],
            createdAt: new Date()
        };
        const memorySize = JSON.stringify({ ...shared, code: undefined }).length + (isChunked ? 0 : codeBytes);
        this.sharedCode.set(shared.id, shared, memorySize);
        if (this.overflowEnabled) {
            await this.persistSharedCode(shared, isChunked ? data.code : undefined);
        }
        this.emit('code:shared', shared);
        const logInfo = { teamMemberId, codeId: shared.id, title: shared.title, isChunked, codeSize: codeBytes };
        logger.info(logInfo, 'Team Member shared code');
        return shared;
    }
    async getCodeChunk(codeId, chunkIndex) {
        if (!this.dbPool)
            return null;
        try {
            const result = await this.dbPool.query(`
        SELECT chunk_data, chunk_index, chunk_size FROM team_member_code_chunks
        WHERE shared_code_id = $1 AND chunk_index = $2
      `, [codeId, chunkIndex]);
            if (result.rows.length === 0)
                return null;
            const row = result.rows[0];
            return { data: row.chunk_data, index: row.chunk_index, size: row.chunk_size };
        }
        catch (err) {
            logger.error({ err, codeId, chunkIndex }, 'Failed to get code chunk');
            return null;
        }
    }
    async getFullCode(codeId) {
        const code = await this.getSharedCode(codeId);
        if (!code)
            return null;
        if (!code.isChunked && code.code)
            return code.code;
        if (!this.dbPool)
            return null;
        try {
            const result = await this.dbPool.query(`
        SELECT chunk_data FROM team_member_code_chunks
        WHERE shared_code_id = $1 ORDER BY chunk_index ASC
      `, [codeId]);
            if (result.rows.length === 0) {
                const directResult = await this.dbPool.query('SELECT code FROM team_member_shared_code WHERE id = $1', [codeId]);
                if (directResult.rows.length > 0 && directResult.rows[0].code) {
                    return directResult.rows[0].code;
                }
                return null;
            }
            return result.rows.map((r) => r.chunk_data).join('');
        }
        catch (err) {
            logger.error({ err, codeId }, 'Failed to get full code');
            return null;
        }
    }
    async giveFeedback(fromTeamMemberId, sharedCodeId, feedbackType, message) {
        const fb = {
            id: crypto.randomUUID(),
            sharedCodeId,
            fromTeamMemberId,
            feedbackType,
            message,
            createdAt: new Date()
        };
        this.feedback.push(fb);
        if (!this.feedbackByCode.has(sharedCodeId)) {
            this.feedbackByCode.set(sharedCodeId, []);
        }
        this.feedbackByCode.get(sharedCodeId).push(fb);
        // MED-19 FIX: Only persist once - either with overflow batch OR as single item
        // Previously, when overflow occurred, feedback was persisted twice:
        // 1. With the overflow batch (lines 651-653)
        // 2. As new feedback (lines 656-658)
        if (this.feedback.length > MAX_FEEDBACK_IN_MEMORY) {
            const overflow = this.feedback.splice(0, this.feedback.length - MAX_FEEDBACK_IN_MEMORY);
            if (this.overflowEnabled) {
                // Include the new feedback in the overflow batch if it's part of overflow
                const needsToPersistNew = !overflow.includes(fb);
                await this.persistFeedback(overflow);
                // Only persist new feedback separately if it wasn't already in overflow
                if (needsToPersistNew) {
                    await this.persistFeedback([fb]);
                }
            }
        }
        else if (this.overflowEnabled) {
            // No overflow, just persist the new feedback
            await this.persistFeedback([fb]);
        }
        this.emit('feedback:given', fb);
        logger.info({ fromTeamMemberId, sharedCodeId, type: feedbackType }, 'Team Member gave feedback');
        return fb;
    }
    async sendMessage(fromTeamMemberId, toTeamMemberId, message, metadata) {
        const msg = {
            id: crypto.randomUUID(),
            fromTeamMemberId,
            toTeamMemberId,
            message,
            metadata,
            read: false,
            createdAt: new Date()
        };
        this.messages.push(msg);
        if (!this.messagesByTeamMember.has(toTeamMemberId)) {
            this.messagesByTeamMember.set(toTeamMemberId, []);
        }
        this.messagesByTeamMember.get(toTeamMemberId).push(msg);
        if (this.messages.length > MAX_MESSAGES_IN_MEMORY) {
            const overflow = this.messages.splice(0, this.messages.length - MAX_MESSAGES_IN_MEMORY);
            if (this.overflowEnabled) {
                await this.persistMessages(overflow);
            }
        }
        if (this.overflowEnabled) {
            await this.persistMessages([msg]);
        }
        this.emit('message:sent', msg);
        logger.info({ fromTeamMemberId, toTeamMemberId }, 'Team Member sent message');
        return msg;
    }
    async getSharedCode(codeId) {
        let code = this.sharedCode.get(codeId);
        if (!code && this.overflowEnabled) {
            code = await this.loadSharedCodeFromDb(codeId);
        }
        return code;
    }
    async getAllSharedCode(limit = 50, offset = 0) {
        const cached = this.sharedCode.getAllEntries().map(e => e.value);
        if (this.overflowEnabled) {
            const result = await this.dbPool.query(`
        SELECT * FROM team_member_shared_code ORDER BY created_at DESC LIMIT $1 OFFSET $2
      `, [limit, offset]);
            const dbCodes = result.rows.map(this.rowToSharedCode.bind(this));
            const ids = new Set(cached.map(c => c.id));
            return [...cached, ...dbCodes.filter((c) => !ids.has(c.id))].slice(0, limit);
        }
        return cached.slice(offset, offset + limit);
    }
    async getSharedCodeByTeamMember(teamMemberId, limit = 50) {
        if (this.overflowEnabled) {
            const result = await this.dbPool.query(`
        SELECT * FROM team_member_shared_code WHERE team_member_id = $1 ORDER BY created_at DESC LIMIT $2
      `, [teamMemberId, limit]);
            return result.rows.map(this.rowToSharedCode.bind(this));
        }
        return this.sharedCode.getAllEntries().map(e => e.value).filter(c => c.teamMemberId === teamMemberId).slice(0, limit);
    }
    async getFeedbackForCode(sharedCodeId, limit = 50) {
        const inMemory = this.feedbackByCode.get(sharedCodeId) || [];
        if (inMemory.length >= limit)
            return inMemory.slice(-limit);
        if (this.overflowEnabled) {
            const result = await this.dbPool.query(`
        SELECT * FROM team_member_feedback WHERE shared_code_id = $1 ORDER BY created_at DESC LIMIT $2
      `, [sharedCodeId, limit]);
            return result.rows.map(this.rowToFeedback.bind(this));
        }
        return inMemory.slice(-limit);
    }
    async getMessagesForTeamMember(teamMemberId, limit = 50, unreadOnly = false) {
        if (this.overflowEnabled) {
            const query = unreadOnly
                ? 'SELECT * FROM team_member_to_team_member_messages WHERE to_team_member_id = $1 AND read = FALSE ORDER BY created_at DESC LIMIT $2'
                : 'SELECT * FROM team_member_to_team_member_messages WHERE to_team_member_id = $1 ORDER BY created_at DESC LIMIT $2';
            const result = await this.dbPool.query(query, [teamMemberId, limit]);
            return result.rows.map(this.rowToMessage.bind(this));
        }
        const inMemory = this.messagesByTeamMember.get(teamMemberId) || [];
        const filtered = unreadOnly ? inMemory.filter(m => !m.read) : inMemory;
        return filtered.slice(-limit);
    }
    async markMessageRead(messageId) {
        const msg = this.messages.find(m => m.id === messageId);
        if (msg)
            msg.read = true;
        if (this.overflowEnabled) {
            await this.dbPool.query('UPDATE team_member_messages SET read = TRUE WHERE id = $1', [messageId]);
        }
    }
    async getUnreadMessageCount(teamMemberId) {
        if (this.overflowEnabled) {
            const result = await this.dbPool.query('SELECT COUNT(*) as count FROM team_member_to_team_member_messages WHERE to_team_member_id = $1 AND read = FALSE', [teamMemberId]);
            return parseInt(result.rows[0]?.count || '0', 10);
        }
        return (this.messagesByTeamMember.get(teamMemberId) || []).filter(m => !m.read).length;
    }
    async getPendingReviewsForTeamMember(teamMemberId) {
        if (this.overflowEnabled) {
            const result = await this.dbPool.query(`
        SELECT sc.* FROM team_member_shared_code sc
        LEFT JOIN team_member_feedback af ON sc.id = af.shared_code_id AND af.from_team_member_id = $1
        WHERE sc.team_member_id != $1 AND af.id IS NULL
        ORDER BY sc.created_at DESC LIMIT 20
      `, [teamMemberId]);
            return result.rows.map(this.rowToSharedCode.bind(this));
        }
        const allCode = this.sharedCode.getAllEntries().map(e => e.value);
        const reviewedIds = new Set(this.feedback.filter(f => f.fromTeamMemberId === teamMemberId).map(f => f.sharedCodeId));
        return allCode.filter(c => c.teamMemberId !== teamMemberId && !reviewedIds.has(c.id)).slice(0, 20);
    }
    async getSuggestedReviewers(sharedCodeId) {
        const code = await this.getSharedCode(sharedCodeId);
        if (!code)
            return [];
        const allTeamMembers = await this.getTeamMembersByStatus('running');
        return allTeamMembers.filter(a => a.id !== code.teamMemberId).slice(0, 5);
    }
    getCollaborationStats() {
        const positive = this.feedback.filter(f => f.feedbackType === 'positive').length;
        const total = this.feedback.length;
        return {
            totalSharedCode: this.sharedCode.size,
            totalFeedback: this.feedback.length,
            totalMessages: this.messages.length,
            positiveRatio: total > 0 ? positive / total : 0
        };
    }
    detectLanguage(input) {
        const ext = input.includes('.') ? input.split('.').pop()?.toLowerCase() : '';
        const langMap = {
            ts: 'typescript', js: 'javascript', py: 'python', rs: 'rust',
            go: 'go', java: 'java', cpp: 'cpp', c: 'c', rb: 'ruby',
            php: 'php', sql: 'sql', sh: 'bash', yaml: 'yaml', json: 'json',
            md: 'markdown', html: 'html', css: 'css', tsx: 'typescript', jsx: 'javascript'
        };
        return langMap[ext || ''] || 'text';
    }
    async persistSharedCode(code, fullCodeForChunks) {
        if (!this.dbPool)
            return;
        try {
            await this.dbPool.query(`
        INSERT INTO team_member_shared_code (id, team_member_id, title, description, code, code_preview, code_size, is_chunked, total_chunks, file_path, language, tags, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO NOTHING
      `, [
                code.id, code.teamMemberId, code.title, code.description,
                code.isChunked ? null : code.code,
                code.codePreview, code.codeSize, code.isChunked, code.totalChunks || 0,
                code.filePath, code.language, code.tags, code.createdAt
            ]);
            if (code.isChunked && fullCodeForChunks) {
                const chunks = [];
                let offset = 0;
                while (offset < fullCodeForChunks.length) {
                    chunks.push(fullCodeForChunks.substring(offset, offset + CODE_CHUNK_SIZE));
                    offset += CODE_CHUNK_SIZE;
                }
                for (let i = 0; i < chunks.length; i++) {
                    await this.dbPool.query(`
            INSERT INTO team_member_code_chunks (shared_code_id, chunk_index, chunk_data, chunk_size)
            VALUES ($1, $2, $3, $4)
          `, [code.id, i, chunks[i], Buffer.byteLength(chunks[i], 'utf-8')]);
                }
                logger.info({ codeId: code.id, chunks: chunks.length }, 'Stored code in chunks');
            }
        }
        catch (err) {
            logger.error({ err, codeId: code.id }, 'Failed to persist shared code');
        }
    }
    async persistFeedback(feedbacks) {
        if (!this.dbPool || feedbacks.length === 0)
            return;
        try {
            for (const fb of feedbacks) {
                await this.dbPool.query(`
          INSERT INTO team_member_feedback (id, shared_code_id, from_team_member_id, feedback_type, message, created_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO NOTHING
        `, [fb.id, fb.sharedCodeId, fb.fromTeamMemberId, fb.feedbackType, fb.message, fb.createdAt]);
            }
        }
        catch (err) {
            logger.error({ err }, 'Failed to persist feedback');
        }
    }
    async persistMessages(messages) {
        if (!this.dbPool || messages.length === 0)
            return;
        try {
            for (const msg of messages) {
                await this.dbPool.query(`
          INSERT INTO team_member_to_team_member_messages (id, from_team_member_id, to_team_member_id, message, metadata, read, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO NOTHING
        `, [msg.id, msg.fromTeamMemberId, msg.toTeamMemberId, msg.message, JSON.stringify(msg.metadata || {}), msg.read, msg.createdAt]);
            }
        }
        catch (err) {
            logger.error({ err }, 'Failed to persist messages');
        }
    }
    async loadSharedCodeFromDb(codeId) {
        if (!this.dbPool)
            return undefined;
        try {
            const result = await this.dbPool.query('SELECT * FROM team_member_shared_code WHERE id = $1', [codeId]);
            if (result.rows.length === 0)
                return undefined;
            return this.rowToSharedCode(result.rows[0]);
        }
        catch (err) {
            logger.error({ err, codeId }, 'Failed to load shared code from db');
            return undefined;
        }
    }
    rowToSharedCode(row) {
        return {
            id: row.id,
            teamMemberId: row.team_member_id,
            title: row.title,
            description: row.description || '',
            code: row.is_chunked ? undefined : row.code,
            codePreview: row.code_preview || (row.code ? row.code.substring(0, CODE_PREVIEW_SIZE) : ''),
            codeSize: row.code_size || (row.code ? Buffer.byteLength(row.code, 'utf-8') : 0),
            isChunked: row.is_chunked || false,
            totalChunks: row.total_chunks || undefined,
            filePath: row.file_path,
            language: row.language || 'text',
            tags: row.tags || [],
            createdAt: new Date(row.created_at)
        };
    }
    rowToFeedback(row) {
        return {
            id: row.id,
            sharedCodeId: row.shared_code_id,
            fromTeamMemberId: row.from_team_member_id,
            feedbackType: row.feedback_type,
            message: row.message,
            createdAt: new Date(row.created_at)
        };
    }
    rowToMessage(row) {
        return {
            id: row.id,
            fromTeamMemberId: row.from_team_member_id,
            toTeamMemberId: row.to_team_member_id,
            message: row.message,
            metadata: row.metadata || {},
            read: row.read,
            createdAt: new Date(row.created_at)
        };
    }
    async shutdown() {
        const teamMembers = this.teamMembers.getAllEntries().map(e => e.value);
        for (const teamMember of teamMembers) {
            if (teamMember.status === 'running') {
                await this.updateTeamMemberStatus(teamMember.id, 'stopped');
            }
        }
        for (const [teamMemberId, logs] of this.teamMemberLogs) {
            if (logs.length > 0) {
                await this.persistLogs(logs);
            }
        }
        this.teamMemberLogs.clear();
        this.teamMembers.clear();
        logger.info('TeamMemberTracker shutdown complete');
    }
}
let globalTracker = null;
export function getTeamMemberTracker() {
    if (!globalTracker) {
        globalTracker = new TeamMemberTracker();
    }
    return globalTracker;
}
//# sourceMappingURL=teamMemberTracker.js.map