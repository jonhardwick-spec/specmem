/**
 * settings.ts - Dashboard Settings API
 *
 * Handles dashboard configuration including password management
 * and dashboard mode/binding configuration with persistence.
 */
import { Router, Request, Response, NextFunction } from 'express';
export declare function createSettingsRouter(requireAuth: (req: Request, res: Response, next: NextFunction) => void): Router;
export default createSettingsRouter;
//# sourceMappingURL=settings.d.ts.map