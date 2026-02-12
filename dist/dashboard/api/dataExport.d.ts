/**
 * dataExport.ts - Database Export API
 *
 * Provides API endpoints for exporting PostgreSQL tables to JSON.
 * Used for backup, migration, and data analysis purposes.
 *
 * Features:
 * - Export individual tables or all tables
 * - List available tables with row counts
 * - Download exported files
 * - Stream large exports
 *
 * @author worker-8-export-system
 */
import { Router, Request, Response, NextFunction } from 'express';
import { DatabaseManager } from '../../database.js';
declare const EXPORT_BASE_DIR = "/server/data/exports";
declare const SPECMEM_TABLES: string[];
declare const MATERIALIZED_VIEWS: string[];
export declare function createDataExportRouter(requireAuth: (req: Request, res: Response, next: NextFunction) => void, db: DatabaseManager | null): Router;
export default createDataExportRouter;
export { SPECMEM_TABLES, MATERIALIZED_VIEWS, EXPORT_BASE_DIR };
//# sourceMappingURL=dataExport.d.ts.map