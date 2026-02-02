/**
 * setup.ts - Dashboard Setup Backend API
 *
 * Provides endpoints for dashboard mode switching and password management
 * as part of the setup wizard flow.
 *
 * Endpoints:
 * - GET  /api/setup/status   - Get current setup (public, no auth)
 * - POST /api/setup/mode     - Change dashboard mode (auth for public mode)
 * - POST /api/setup/password - Change password (always requires current password)
 *
 * Security Model:
 * - Mode switch to public: Requires authentication
 * - Mode switch to private/lan: No auth required (relaxing security)
 * - Password change: Always requires current password verification
 * - Public mode: Validates password strength
 */
import { Router, Request, Response, NextFunction } from 'express';
export declare function createSetupRouter(requireAuth: (req: Request, res: Response, next: NextFunction) => void): Router;
export default createSetupRouter;
//# sourceMappingURL=setup.d.ts.map