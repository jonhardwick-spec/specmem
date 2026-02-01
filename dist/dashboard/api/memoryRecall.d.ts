/**
 * memoryRecall.ts - Memory Recall API Endpoints
 *
 * Phase 1: Memory Recall Viewer Backend APIs
 *
 * Endpoints:
 * - GET /api/memory/recall/:id - Get specific memory by ID
 * - GET /api/memory/search - Search memories with pagination
 * - GET /api/memory/recent - Get recent memories
 * - GET /api/memory/by-tags - Filter memories by tags
 * - GET /api/memory/:id/related - Get related memories
 * - POST /api/memory/export - Export memories (JSON/CSV)
 * - DELETE /api/memory/:id - Delete a memory
 *
 * PROJECT ISOLATED: All operations are scoped to current project
 */
import { Router } from 'express';
import { DatabaseManager } from '../../database.js';
export declare function createMemoryRecallRouter(db: DatabaseManager): Router;
//# sourceMappingURL=memoryRecall.d.ts.map