import { EventEmitter } from 'events';
export type TeamMemberStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
export type FeedbackType = 'positive' | 'negative' | 'question' | 'critique';
export interface SharedCode {
    id: string;
    teamMemberId: string;
    title: string;
    description: string;
    code?: string;
    codePreview: string;
    codeSize: number;
    isChunked: boolean;
    totalChunks?: number;
    filePath?: string;
    language: string;
    tags: string[];
    createdAt: Date;
}
export interface CodeFeedback {
    id: string;
    sharedCodeId: string;
    fromTeamMemberId: string;
    feedbackType: FeedbackType;
    message: string;
    createdAt: Date;
}
export interface TeamMemberMessage {
    id: string;
    fromTeamMemberId: string;
    toTeamMemberId: string;
    message: string;
    metadata?: Record<string, unknown>;
    read: boolean;
    createdAt: Date;
}
export interface TeamMemberLog {
    id: string;
    teamMemberId: string;
    timestamp: Date;
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    metadata?: Record<string, unknown>;
}
export interface TeamMemberTask {
    id: string;
    name: string;
    description: string;
    progress: number;
    status: TeamMemberStatus;
    startedAt?: Date;
    completedAt?: Date;
}
export interface TeamMember {
    id: string;
    name: string;
    type: 'worker' | 'overseer' | 'qa';
    status: TeamMemberStatus;
    currentTask?: TeamMemberTask;
    tokensUsed: number;
    tokensLimit: number;
    createdAt: Date;
    startedAt?: Date;
    stoppedAt?: Date;
    lastHeartbeat?: Date;
    metadata?: Record<string, unknown>;
}
export interface TeamMemberStats {
    totalTeamMembers: number;
    runningTeamMembers: number;
    completedTeamMembers: number;
    failedTeamMembers: number;
    totalTokensUsed: number;
    avgTaskProgress: number;
}
export declare class TeamMemberTracker extends EventEmitter {
    private teamMembers;
    private teamMemberLogs;
    private dbPool;
    private overflowEnabled;
    private totalOverflowed;
    private sharedCode;
    private feedback;
    private messages;
    private feedbackByCode;
    private messagesByTeamMember;
    constructor();
    setDatabase(pool: any): void;
    private ensureSchema;
    registerTeamMember(teamMember: Omit<TeamMember, 'createdAt' | 'tokensUsed'>): Promise<TeamMember>;
    updateTeamMemberStatus(teamMemberId: string, status: TeamMemberStatus, metadata?: Record<string, unknown>): Promise<void>;
    updateTaskProgress(teamMemberId: string, task: Partial<TeamMemberTask>): Promise<void>;
    addTokenUsage(teamMemberId: string, tokens: number): Promise<void>;
    heartbeat(teamMemberId: string): Promise<void>;
    addLog(teamMemberId: string, level: TeamMemberLog['level'], message: string, metadata?: Record<string, unknown>): Promise<void>;
    getTeamMember(teamMemberId: string): Promise<TeamMember | undefined>;
    getAllTeamMembers(): Promise<TeamMember[]>;
    getTeamMembersByStatus(status: TeamMemberStatus): Promise<TeamMember[]>;
    getLogs(teamMemberId: string, limit?: number, offset?: number): Promise<TeamMemberLog[]>;
    streamLogs(teamMemberId: string, callback: (log: TeamMemberLog) => void): Promise<() => void>;
    getStats(): TeamMemberStats;
    private estimateTeamMemberSize;
    private persistTeamMember;
    private persistLogs;
    private loadTeamMemberFromDb;
    private rowToTeamMember;
    shareCode(teamMemberId: string, data: {
        title: string;
        description: string;
        code: string;
        filePath?: string;
        language?: string;
        tags?: string[];
    }): Promise<SharedCode>;
    getCodeChunk(codeId: string, chunkIndex: number): Promise<{
        data: string;
        index: number;
        size: number;
    } | null>;
    getFullCode(codeId: string): Promise<string | null>;
    giveFeedback(fromTeamMemberId: string, sharedCodeId: string, feedbackType: FeedbackType, message: string): Promise<CodeFeedback>;
    sendMessage(fromTeamMemberId: string, toTeamMemberId: string, message: string, metadata?: Record<string, unknown>): Promise<TeamMemberMessage>;
    getSharedCode(codeId: string): Promise<SharedCode | undefined>;
    getAllSharedCode(limit?: number, offset?: number): Promise<SharedCode[]>;
    getSharedCodeByTeamMember(teamMemberId: string, limit?: number): Promise<SharedCode[]>;
    getFeedbackForCode(sharedCodeId: string, limit?: number): Promise<CodeFeedback[]>;
    getMessagesForTeamMember(teamMemberId: string, limit?: number, unreadOnly?: boolean): Promise<TeamMemberMessage[]>;
    markMessageRead(messageId: string): Promise<void>;
    getUnreadMessageCount(teamMemberId: string): Promise<number>;
    getPendingReviewsForTeamMember(teamMemberId: string): Promise<SharedCode[]>;
    getSuggestedReviewers(sharedCodeId: string): Promise<TeamMember[]>;
    getCollaborationStats(): {
        totalSharedCode: number;
        totalFeedback: number;
        totalMessages: number;
        positiveRatio: number;
    };
    private detectLanguage;
    private persistSharedCode;
    private persistFeedback;
    private persistMessages;
    private loadSharedCodeFromDb;
    private rowToSharedCode;
    private rowToFeedback;
    private rowToMessage;
    shutdown(): Promise<void>;
}
export declare function getTeamMemberTracker(): TeamMemberTracker;
//# sourceMappingURL=teamMemberTracker.d.ts.map