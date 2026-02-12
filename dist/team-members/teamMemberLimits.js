import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
const THRESHOLDS = {
    warning: 70,
    critical: 85,
    exceeded: 100
};
const SUGGESTIONS = {
    token: 'Consider chunking your analysis into smaller tasks',
    memory: 'Flush logs to database, reduce in-memory caching',
    file: 'Process files in batches of 10',
    output: 'Stream output instead of buffering'
};
const WARNING_MESSAGES = {
    token: {
        warning: 'Token limit 70% reached',
        critical: 'Token limit 85% reached',
        exceeded: 'Token limit exceeded'
    },
    memory: {
        warning: 'Memory limit 70% reached',
        critical: 'Memory limit 85% reached',
        exceeded: 'Memory limit exceeded'
    },
    file: {
        warning: 'File limit 70% reached',
        critical: 'File limit 85% reached',
        exceeded: 'File limit exceeded'
    },
    output: {
        warning: 'Output limit 70% reached',
        critical: 'Output limit 85% reached',
        exceeded: 'Output limit exceeded'
    }
};
// TEAM_MEMBER 3 FIX: Set UNLIMITED defaults for everything!
const DEFAULT_LIMITS = {
    tokensLimit: Number.MAX_SAFE_INTEGER, // UNLIMITED tokens!
    memoryLimit: 1024 * 1024 * 1024, // 1GB - effectively unlimited for most cases
    filesLimit: Number.MAX_SAFE_INTEGER, // UNLIMITED files!
    outputLimit: Number.MAX_SAFE_INTEGER // UNLIMITED output!
};
export class TeamMemberLimitsMonitor extends EventEmitter {
    limits = new Map();
    acknowledgments = new Map();
    lastWarnings = new Map();
    constructor() {
        super();
    }
    initializeTeamMember(teamMemberId, config = {}) {
        const teamMemberLimits = {
            tokens_used: 0,
            tokens_limit: config.tokensLimit ?? DEFAULT_LIMITS.tokensLimit,
            memory_used: 0,
            memory_limit: config.memoryLimit ?? DEFAULT_LIMITS.memoryLimit,
            files_processed: 0,
            files_limit: config.filesLimit ?? DEFAULT_LIMITS.filesLimit,
            output_size: 0,
            output_limit: config.outputLimit ?? DEFAULT_LIMITS.outputLimit
        };
        this.limits.set(teamMemberId, teamMemberLimits);
        this.acknowledgments.set(teamMemberId, []);
        this.lastWarnings.set(teamMemberId, new Map());
        logger.debug({ teamMemberId, limits: teamMemberLimits }, 'Team Member limits initialized');
        return teamMemberLimits;
    }
    getLimits(teamMemberId) {
        return this.limits.get(teamMemberId);
    }
    updateTokens(teamMemberId, tokens) {
        const limits = this.limits.get(teamMemberId);
        if (!limits)
            return null;
        limits.tokens_used += tokens;
        return this.checkLimit(teamMemberId, 'token', limits.tokens_used, limits.tokens_limit);
    }
    setTokens(teamMemberId, tokens) {
        const limits = this.limits.get(teamMemberId);
        if (!limits)
            return null;
        limits.tokens_used = tokens;
        return this.checkLimit(teamMemberId, 'token', limits.tokens_used, limits.tokens_limit);
    }
    updateMemory(teamMemberId, bytes) {
        const limits = this.limits.get(teamMemberId);
        if (!limits)
            return null;
        limits.memory_used = bytes;
        return this.checkLimit(teamMemberId, 'memory', limits.memory_used, limits.memory_limit);
    }
    updateFilesProcessed(teamMemberId, count) {
        const limits = this.limits.get(teamMemberId);
        if (!limits)
            return null;
        limits.files_processed += count;
        return this.checkLimit(teamMemberId, 'file', limits.files_processed, limits.files_limit);
    }
    updateOutputSize(teamMemberId, bytes) {
        const limits = this.limits.get(teamMemberId);
        if (!limits)
            return null;
        limits.output_size += bytes;
        return this.checkLimit(teamMemberId, 'output', limits.output_size, limits.output_limit);
    }
    checkLimit(teamMemberId, type, current, limit) {
        const percentage = (current / limit) * 100;
        let level = null;
        if (percentage >= THRESHOLDS.exceeded) {
            level = 'exceeded';
        }
        else if (percentage >= THRESHOLDS.critical) {
            level = 'critical';
        }
        else if (percentage >= THRESHOLDS.warning) {
            level = 'warning';
        }
        if (!level)
            return null;
        const lastWarningMap = this.lastWarnings.get(teamMemberId);
        if (!lastWarningMap)
            return null;
        const lastLevel = lastWarningMap.get(type);
        if (lastLevel === level) {
            return null;
        }
        lastWarningMap.set(type, level);
        const warning = {
            type,
            level,
            current,
            limit,
            percentage: Math.round(percentage * 10) / 10,
            message: this.formatMessage(type, level, percentage),
            suggestion: SUGGESTIONS[type]
        };
        this.emit('limit:warning', { teamMemberId, warning });
        logger.info({ teamMemberId, warning }, 'Team Member limit warning triggered');
        return warning;
    }
    formatMessage(type, level, percentage) {
        const baseMessage = WARNING_MESSAGES[type][level];
        const icon = level === 'exceeded' ? '!!!' : level === 'critical' ? '!!' : '!';
        return `${icon} ${baseMessage} (${Math.round(percentage)}%)`;
    }
    checkAllLimits(teamMemberId) {
        const limits = this.limits.get(teamMemberId);
        if (!limits)
            return [];
        const warnings = [];
        const types = [
            { type: 'token', current: limits.tokens_used, limit: limits.tokens_limit },
            { type: 'memory', current: limits.memory_used, limit: limits.memory_limit },
            { type: 'file', current: limits.files_processed, limit: limits.files_limit },
            { type: 'output', current: limits.output_size, limit: limits.output_limit }
        ];
        for (const { type, current, limit } of types) {
            const warning = this.checkLimit(teamMemberId, type, current, limit);
            if (warning) {
                warnings.push(warning);
            }
        }
        return warnings;
    }
    getLimitStatus(teamMemberId) {
        const limits = this.limits.get(teamMemberId);
        if (!limits)
            return [];
        return [
            { type: 'token', current: limits.tokens_used, limit: limits.tokens_limit },
            { type: 'memory', current: limits.memory_used, limit: limits.memory_limit },
            { type: 'file', current: limits.files_processed, limit: limits.files_limit },
            { type: 'output', current: limits.output_size, limit: limits.output_limit }
        ].map(({ type, current, limit }) => {
            const percentage = (current / limit) * 100;
            let level = 'ok';
            if (percentage >= THRESHOLDS.exceeded)
                level = 'exceeded';
            else if (percentage >= THRESHOLDS.critical)
                level = 'critical';
            else if (percentage >= THRESHOLDS.warning)
                level = 'warning';
            return { type, percentage: Math.round(percentage * 10) / 10, level };
        });
    }
    acknowledgeWarning(teamMemberId, type, action) {
        const acks = this.acknowledgments.get(teamMemberId);
        if (!acks)
            return;
        const ack = {
            type,
            action,
            timestamp: new Date()
        };
        acks.push(ack);
        this.emit('limit:acknowledged', { teamMemberId, acknowledgment: ack });
        logger.info({ teamMemberId, ack }, 'Team Member acknowledged limit warning');
    }
    getAcknowledgments(teamMemberId) {
        return this.acknowledgments.get(teamMemberId) || [];
    }
    parseAcknowledgment(line) {
        if (!line.startsWith('LIMIT_ACK:'))
            return null;
        try {
            const data = JSON.parse(line.replace('LIMIT_ACK:', '').trim());
            if (data.type && data.action) {
                return { type: data.type, action: data.action };
            }
        }
        catch {
            logger.debug({ line }, 'Failed to parse LIMIT_ACK');
        }
        return null;
    }
    formatWarningForTeamMember(warning) {
        return JSON.stringify({
            type: 'LIMIT_WARNING',
            warning: {
                type: warning.type,
                level: warning.level,
                current: warning.current,
                limit: warning.limit,
                percentage: warning.percentage,
                message: warning.message,
                suggestion: warning.suggestion
            }
        });
    }
    resetLimits(teamMemberId) {
        const limits = this.limits.get(teamMemberId);
        if (limits) {
            limits.tokens_used = 0;
            limits.memory_used = 0;
            limits.files_processed = 0;
            limits.output_size = 0;
        }
        const lastWarningMap = this.lastWarnings.get(teamMemberId);
        if (lastWarningMap) {
            lastWarningMap.clear();
        }
        logger.debug({ teamMemberId }, 'Team Member limits reset');
    }
    removeTeamMember(teamMemberId) {
        this.limits.delete(teamMemberId);
        this.acknowledgments.delete(teamMemberId);
        this.lastWarnings.delete(teamMemberId);
    }
    getAllTeamMemberLimits() {
        return new Map(this.limits);
    }
}
let globalLimitsMonitor = null;
export function getTeamMemberLimitsMonitor() {
    if (!globalLimitsMonitor) {
        globalLimitsMonitor = new TeamMemberLimitsMonitor();
    }
    return globalLimitsMonitor;
}
//# sourceMappingURL=teamMemberLimits.js.map