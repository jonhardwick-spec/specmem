/**
 * terminalInject.ts - Terminal Prompt Injection API
 *
 * Injects prompts directly into the running Claude Code terminal session.
 *
 * Features:
 * - STY-based session detection (reliable current session identification)
 * - screen -X stuff injection with Enter key support
 * - Auto-discovery of Claude process PID and TTY
 *
 * Primary method: Use STY env var + screen -X stuff
 * Fallback: TIOCSTI ioctl (when not in screen session)
 */
import { Router, Request, Response } from 'express';
export declare function createTerminalInjectRouter(requireAuth: (req: Request, res: Response, next: any) => void): Router;
export default createTerminalInjectRouter;
//# sourceMappingURL=terminalInject.d.ts.map