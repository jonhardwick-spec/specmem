/**
 * promptSend.ts - Direct Prompting API for SpecMem Dashboard
 *
 * Provides endpoints for sending prompts to  via MCP sampling,
 * with support for context injection (memories, files, codebase).
 *
 * Phase 4 Implementation - Direct Prompting Interface
 */
import { Router, Request, Response, NextFunction } from 'express';
import { DatabaseManager } from '../../database.js';
export interface PromptHistoryEntry {
    id: string;
    prompt: string;
    response: string;
    context?: {
        memoryIds?: string[];
        filePaths?: string[];
        includeCodebase?: boolean;
    };
    config?: {
        maxTokens?: number;
        intelligencePriority?: number;
        speedPriority?: number;
    };
    tokensUsed?: number;
    duration?: number;
    status: 'success' | 'error' | 'pending';
    errorMessage?: string;
    createdAt: Date;
}
export declare function createPromptSendRouter(db: DatabaseManager | null, requireAuth: (req: Request, res: Response, next: NextFunction) => void): Router;
export default createPromptSendRouter;
//# sourceMappingURL=promptSend.d.ts.map