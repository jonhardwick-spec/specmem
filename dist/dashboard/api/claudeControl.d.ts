/**
 * claudeControl.ts - Claude Control API for SpecMem Dashboard
 *
 * Provides endpoints for triggering Claude actions via MCP sampling,
 * including auto-fix, memory consolidation, and team member orchestration.
 *
 * Phase 6 Implementation - MCP -> Claude Control Flow
 */
import { Router, Request, Response, NextFunction } from 'express';
import { DatabaseManager } from '../../database.js';
export interface TriggerHistoryEntry {
    id: string;
    action: string;
    prompt: string;
    config?: Record<string, unknown>;
    context?: Record<string, unknown>;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    result?: string;
    errorMessage?: string;
    confirmedBy?: string;
    confirmedAt?: Date;
    startedAt?: Date;
    completedAt?: Date;
    createdAt: Date;
}
export interface ScheduledTrigger {
    id: string;
    action: string;
    prompt: string;
    config?: Record<string, unknown>;
    schedule: {
        cron?: string;
        intervalMinutes?: number;
        runAt?: string;
    };
    enabled: boolean;
    lastRun?: Date;
    nextRun?: Date;
    runCount: number;
    createdAt: Date;
}
export declare function createClaudeControlRouter(db: DatabaseManager | null, requireAuth: (req: Request, res: Response, next: NextFunction) => void, broadcastUpdate?: (type: string, data: unknown) => void): Router;
export default createClaudeControlRouter;
//# sourceMappingURL=claudeControl.d.ts.map