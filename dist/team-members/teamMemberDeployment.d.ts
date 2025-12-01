import { EventEmitter } from 'events';
import { TeamMember } from './teamMemberTracker.js';
import { TeamMemberLimits } from './teamMemberLimits.js';
export interface DeploymentConfig {
    name: string;
    type: 'worker' | 'overseer' | 'qa';
    workerType: 'test' | 'repair' | 'ai' | 'codeReview' | 'custom';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    tokensLimit?: number;
    memoryLimit?: number;
    filesLimit?: number;
    outputLimit?: number;
    autoRestart?: boolean;
    maxRestarts?: number;
    aiConfig?: {
        model?: 'opus' | 'sonnet' | 'haiku';
        apiKey?: string;
        systemPrompt?: string;
        maxTokens?: number;
    };
}
export declare class TeamMemberDeployment extends EventEmitter {
    private tracker;
    private limitsMonitor;
    private processes;
    private shutdownInProgress;
    constructor();
    private setupLimitsListener;
    private sendLimitWarning;
    getTeamMemberLimits(teamMemberId: string): TeamMemberLimits | undefined;
    getTeamMemberLimitStatus(teamMemberId: string): {
        type: string;
        percentage: number;
        level: string;
    }[];
    deploy(config: DeploymentConfig): Promise<TeamMember>;
    private startProcess;
    private parseTeamMemberOutput;
    stop(teamMemberId: string, force?: boolean): Promise<boolean>;
    restart(teamMemberId: string): Promise<boolean>;
    sendInput(teamMemberId: string, input: string): Promise<boolean>;
    /**
     * Send a JSON command to a team member via stdin and optionally wait for response.
     * Commands are formatted as JSON and sent via stdin.
     * The team member can respond via stdout with RESPONSE: prefix.
     */
    sendCommand(teamMemberId: string, command: Record<string, unknown>): Promise<{
        success: boolean;
        response?: object;
        queued?: boolean;
    }>;
    getRunningTeamMemberIds(): string[];
    isRunning(teamMemberId: string): boolean;
    shutdown(): Promise<void>;
}
export declare function getTeamMemberDeployment(): TeamMemberDeployment;
//# sourceMappingURL=teamMemberDeployment.d.ts.map