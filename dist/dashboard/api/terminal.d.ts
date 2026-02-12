/**
 * terminal.ts - Terminal Output API for SpecMem Dashboard
 *
 * Provides REST endpoints for terminal history management and
 * webhook endpoint for hook-based output capture.
 *
 * Phase 5 Implementation - Live Terminal Output Streaming
 */
import { Router, Request, Response, NextFunction } from 'express';
export declare function createTerminalRouter(requireAuth: (req: Request, res: Response, next: NextFunction) => void): Router;
export default createTerminalRouter;
//# sourceMappingURL=terminal.d.ts.map