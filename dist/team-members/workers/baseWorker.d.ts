/**
 * Base TeamMember Worker - Lightweight process for team member tasks
 *
 * This runs as a separate Node process with memory limits.
 * Communicates via stdin/stdout with the main specmem process.
 *
 * Enhanced with SpecMem HTTP client integration for inter-team member communication.
 *
 * RAM usage: ~10-30MB per worker (vs 800MB+ for full Claude instance)
 */
import { SpecMemClient, Memory } from './specmemClient.js';
import { TeamMemberCommunicator, TeamMemberMessage, TeamMemberInfo } from '../communication.js';
export interface WorkerConfig {
    teamMemberId: string;
    teamMemberName: string;
    teamMemberType: 'worker' | 'overseer' | 'qa';
    tokensLimit?: number;
    memoryLimit?: number;
    specmemUrl?: string;
    specmemPassword?: string;
}
export declare abstract class BaseWorker {
    protected config: WorkerConfig;
    protected tokensUsed: number;
    protected taskProgress: number;
    private rl;
    private heartbeatInterval?;
    protected specmemClient: SpecMemClient;
    protected communicator: TeamMemberCommunicator;
    constructor(config: WorkerConfig);
    private setupInputListener;
    private startHeartbeat;
    protected abstract handleCommand(command: any): Promise<void>;
    protected abstract executeTask(task: any): Promise<void>;
    protected log(message: string): void;
    protected logError(message: string): void;
    protected reportTokens(tokens: number): void;
    protected reportProgress(progress: number): void;
    protected reportTask(task: {
        id?: string;
        name: string;
        progress: number;
    }): void;
    protected sendHeartbeat(): void;
    protected shareCode(code: {
        title: string;
        code: string;
        description?: string;
        language?: string;
        tags?: string[];
    }): void;
    protected giveFeedback(feedback: {
        code_id: string;
        type: 'positive' | 'negative' | 'question' | 'critique';
        message: string;
    }): void;
    protected sendMessage(message: {
        to: string;
        message: string;
    }): void;
    protected requestReview(request: {
        code_id: string;
        to: string[];
    }): void;
    protected reportFilesProcessed(count: number): void;
    protected reportMemoryUsage(): void;
    protected acknowledgeLimitWarning(type: string, action: string): void;
    start(): Promise<void>;
    protected abstract initialize(): Promise<void>;
    shutdown(): Promise<void>;
    protected abstract cleanup(): Promise<void>;
    /**
     * Store a memory in SpecMem
     */
    protected remember(content: string, tags?: string[]): Promise<Memory | null>;
    /**
     * Search for memories in SpecMem
     */
    protected find(query: string, limit?: number): Promise<Memory[]>;
    /**
     * Broadcast a message to all team members via SpecMem
     */
    protected say(message: string, to?: string): Promise<boolean>;
    /**
     * Listen for messages from other team members
     */
    protected listen(): Promise<TeamMemberMessage[]>;
    /**
     * Get list of active team members
     */
    protected getActiveTeamMembers(): Promise<TeamMemberInfo[]>;
    /**
     * Register this team member and send initial heartbeat via SpecMem
     */
    protected registerWithSpecMem(): Promise<boolean>;
    /**
     * Send heartbeat to SpecMem (for team member discovery)
     */
    protected sendSpecMemHeartbeat(status?: 'active' | 'idle' | 'busy'): Promise<boolean>;
}
//# sourceMappingURL=baseWorker.d.ts.map