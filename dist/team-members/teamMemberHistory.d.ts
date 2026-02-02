import { EventEmitter } from 'events';
import { TeamMemberStatus, TeamMemberLog } from './teamMemberTracker.js';
export interface SessionTask {
    id: string;
    name: string;
    description: string;
    status: TeamMemberStatus;
    startedAt?: Date;
    completedAt?: Date;
}
export interface TeamMemberSession {
    id: string;
    teamMemberId: string;
    teamMemberName: string;
    teamMemberType: 'worker' | 'overseer' | 'qa';
    sessionStart: Date;
    sessionEnd?: Date;
    tasksCompleted: SessionTask[];
    codeSharedIds: string[];
    feedbackGivenIds: string[];
    messagesSentIds: string[];
    tokensUsed: number;
    status: 'running' | 'completed' | 'failed' | 'interrupted';
    summary?: string;
    createdAt: Date;
}
export interface SessionWithCounts {
    id: string;
    teamMemberId: string;
    teamMemberName: string;
    teamMemberType: string;
    sessionStart: Date;
    sessionEnd?: Date;
    taskCount: number;
    codeCount: number;
    feedbackCount: number;
    messageCount: number;
    tokensUsed: number;
    status: string;
    summary?: string;
}
export interface TeamMemberWithSessionCount {
    id: string;
    name: string;
    type: string;
    sessionCount: number;
    lastSessionDate?: Date;
    totalTokensUsed: number;
}
export declare class TeamMemberHistoryManager extends EventEmitter {
    private dbPool;
    private sessionsByTeamMember;
    private activeSessionsByTeamMember;
    private tracker;
    constructor();
    private setupEventListeners;
    setDatabase(pool: any): void;
    private ensureSchema;
    private startSession;
    private endSession;
    private generateSessionSummary;
    private persistSession;
    private recordTaskUpdate;
    private recordCodeShared;
    private recordFeedbackGiven;
    private recordMessageSent;
    private updateSessionTokens;
    getTeamMembersWithSessionCounts(): Promise<TeamMemberWithSessionCount[]>;
    getSessionsForTeamMember(teamMemberId: string, limit?: number, offset?: number): Promise<SessionWithCounts[]>;
    getSessionDetails(sessionId: string): Promise<TeamMemberSession | null>;
    getSessionLogs(sessionId: string, limit?: number, offset?: number): Promise<TeamMemberLog[]>;
    getSessionLogCount(sessionId: string): Promise<number>;
    getActiveSession(teamMemberId: string): TeamMemberSession | undefined;
    private toSessionWithCounts;
    private rowToSessionWithCounts;
    private rowToSession;
    shutdown(): Promise<void>;
}
export declare function getTeamMemberHistoryManager(): TeamMemberHistoryManager;
//# sourceMappingURL=teamMemberHistory.d.ts.map