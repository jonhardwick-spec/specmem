/**
 * hotReload.ts - Hot Reload Dashboard API
 *
 * Provides API endpoints for hot reload status monitoring and triggering
 * from the SpecMem web dashboard.
 *
 * Endpoints:
 *   GET  /api/reload/status  - Get current reload status and active calls
 *   POST /api/reload/trigger - Trigger a soft or graceful reload
 */
import { Router, Request, Response, NextFunction } from 'express';
export declare function createHotReloadRouter(requireAuth: (req: Request, res: Response, next: NextFunction) => void): Router;
export default createHotReloadRouter;
//# sourceMappingURL=hotReload.d.ts.map