import { EventEmitter } from 'events';
export interface TeamMemberLimits {
    tokens_used: number;
    tokens_limit: number;
    memory_used: number;
    memory_limit: number;
    files_processed: number;
    files_limit: number;
    output_size: number;
    output_limit: number;
}
export type LimitType = 'token' | 'memory' | 'file' | 'output';
export type LimitLevel = 'warning' | 'critical' | 'exceeded';
export interface LimitWarning {
    type: LimitType;
    level: LimitLevel;
    current: number;
    limit: number;
    percentage: number;
    message: string;
    suggestion: string;
}
export interface LimitAcknowledgment {
    type: LimitType;
    action: string;
    timestamp: Date;
}
export interface TeamMemberLimitConfig {
    tokensLimit?: number;
    memoryLimit?: number;
    filesLimit?: number;
    outputLimit?: number;
}
export declare class TeamMemberLimitsMonitor extends EventEmitter {
    private limits;
    private acknowledgments;
    private lastWarnings;
    constructor();
    initializeTeamMember(teamMemberId: string, config?: TeamMemberLimitConfig): TeamMemberLimits;
    getLimits(teamMemberId: string): TeamMemberLimits | undefined;
    updateTokens(teamMemberId: string, tokens: number): LimitWarning | null;
    setTokens(teamMemberId: string, tokens: number): LimitWarning | null;
    updateMemory(teamMemberId: string, bytes: number): LimitWarning | null;
    updateFilesProcessed(teamMemberId: string, count: number): LimitWarning | null;
    updateOutputSize(teamMemberId: string, bytes: number): LimitWarning | null;
    private checkLimit;
    private formatMessage;
    checkAllLimits(teamMemberId: string): LimitWarning[];
    getLimitStatus(teamMemberId: string): {
        type: LimitType;
        percentage: number;
        level: LimitLevel | 'ok';
    }[];
    acknowledgeWarning(teamMemberId: string, type: LimitType, action: string): void;
    getAcknowledgments(teamMemberId: string): LimitAcknowledgment[];
    parseAcknowledgment(line: string): {
        type: LimitType;
        action: string;
    } | null;
    formatWarningForTeamMember(warning: LimitWarning): string;
    resetLimits(teamMemberId: string): void;
    removeTeamMember(teamMemberId: string): void;
    getAllTeamMemberLimits(): Map<string, TeamMemberLimits>;
}
export declare function getTeamMemberLimitsMonitor(): TeamMemberLimitsMonitor;
//# sourceMappingURL=teamMemberLimits.d.ts.map