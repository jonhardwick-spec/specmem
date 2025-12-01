/**
 * liveSessionStream.ts - LIVE Claude Code Session Streaming API
 *
 * Team Member 2's MASTERPIECE - Real-time streaming of Claude Code sessions!
 *
 * This watches the history.jsonl file for changes and streams new entries
 * via SSE (Server-Sent Events) to the Console Live Viewer.
 *
 * Features:
 * - File watcher for history.jsonl - detects new entries in real-time
 * - SSE endpoint for live streaming
 * - Clean formatting - transforms JSON to human-readable format
 * - Extracts thinking blocks from responses
 * - Auto-scroll to latest content
 */
import { Router, Request, Response, NextFunction } from 'express';
export declare function createLiveSessionRouter(requireAuth: (req: Request, res: Response, next: NextFunction) => void): Router;
export default createLiveSessionRouter;
//# sourceMappingURL=liveSessionStream.d.ts.map