/**
 * terminalStream.ts - WebSocket Terminal Streaming API
 *
 * Provides WebSocket streaming of Claude Code terminal output with full
 * ANSI support (colors, formatting, cursor positioning, etc.)
 */
import { Router, Request, Response } from 'express';
import { WebSocket } from 'ws';
export declare function handleTerminalWebSocket(ws: WebSocket, req: Request): void;
export declare function createTerminalStreamRouter(requireAuth: (req: Request, res: Response, next: any) => void): Router;
export default createTerminalStreamRouter;
//# sourceMappingURL=terminalStream.d.ts.map