/**
 * specmemTools.ts - HTTP API that calls ACTUAL MCP Tools
 *
 * These endpoints invoke the real MCP tool classes (FindWhatISaid, RememberThisShit, etc.)
 * so HTTP clients get the SAME output as MCP tool calls - including embeddings,
 * semantic search, similarity scores, etc.
 *
 * PROJECT ISOLATED: All destructive operations are scoped to current project
 */
import { Router, Request, Response, NextFunction } from 'express';
import { DatabaseManager } from '../../database.js';
export declare function createSpecmemToolsRouter(getDb: () => DatabaseManager | null, requireAuth: (req: Request, res: Response, next: NextFunction) => void, getEmbeddingProvider?: () => any): Router;
export default createSpecmemToolsRouter;
//# sourceMappingURL=specmemTools.d.ts.map