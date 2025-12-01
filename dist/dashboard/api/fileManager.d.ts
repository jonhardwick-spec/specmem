/**
 * fileManager.ts - FTP-Style File Manager API for Codebase Tab
 *
 * Provides filesystem browsing and codebase management endpoints:
 * - GET  /api/file-manager/browse?path=/server     - List directory contents with stats
 * - POST /api/file-manager/add-to-codebase         - Add paths to codebase indexer
 * - POST /api/file-manager/remove-from-codebase    - Remove from codebase indexer
 * - GET  /api/file-manager/codebase-status         - Check which paths are indexed
 *
 * Security: READ-ONLY filesystem browsing, no upload/download/delete
 */
import { Router, Request, Response, NextFunction } from 'express';
import { DatabaseManager } from '../../database.js';
export interface FileEntry {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size: number;
    modified: string;
    extension: string;
    isInCodebase: boolean;
    isHidden: boolean;
}
export interface BrowseResult {
    currentPath: string;
    parentPath: string | null;
    entries: FileEntry[];
    breadcrumbs: {
        name: string;
        path: string;
    }[];
}
export interface CodebaseStatus {
    indexedPaths: string[];
    totalFiles: number;
    totalSize: number;
}
export declare function createFileManagerRouter(getDb: () => DatabaseManager | null, requireAuth: (req: Request, res: Response, next: NextFunction) => void): Router;
//# sourceMappingURL=fileManager.d.ts.map