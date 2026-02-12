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
import { Router } from 'express';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../utils/logger.js';
import { getSpecmemRoot } from '../../config.js';
import { getCurrentProjectPath } from '../../services/ProjectContext.js';
// ============================================================================
// Validation Schemas
// ============================================================================
const BrowseQuerySchema = z.object({
    path: z.string().default('/'),
    search: z.string().optional()
});
const AddToCodebaseSchema = z.object({
    paths: z.array(z.string()).min(1).max(100)
});
const RemoveFromCodebaseSchema = z.object({
    paths: z.array(z.string()).min(1).max(100)
});
const CodebaseStatusQuerySchema = z.object({
    paths: z.string().optional() // Comma-separated paths to check
});
// ============================================================================
// Security Helpers
// ============================================================================
/**
 * Validate and normalize path to prevent directory traversal attacks
 */
function validatePath(inputPath) {
    // Normalize the path and resolve any .. or .
    const normalized = path.normalize(inputPath);
    // Ensure the path is absolute
    if (!path.isAbsolute(normalized)) {
        return path.resolve('/', normalized);
    }
    return normalized;
}
/**
 * Check if a path should be excluded from browsing
 */
function shouldExclude(name) {
    // Allow hidden files in browsing (user can see them)
    // But exclude some system files
    const excludedNames = [
        '.git',
        'node_modules',
        '.DS_Store',
        'Thumbs.db',
        '__pycache__',
        '.pytest_cache'
    ];
    return excludedNames.includes(name);
}
// ============================================================================
// File Manager Router Factory
// ============================================================================
export function createFileManagerRouter(getDb, requireAuth) {
    const router = Router();
    /**
     * GET /api/file-manager/browse
     * List directory contents with file stats
     */
    router.get('/browse', requireAuth, async (req, res) => {
        try {
            const parseResult = BrowseQuerySchema.safeParse(req.query);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Invalid query parameters',
                    details: parseResult.error.issues
                });
                return;
            }
            const { path: requestedPath, search } = parseResult.data;
            const targetPath = validatePath(requestedPath);
            // Read directory contents directly - avoids stat-then-read race condition
            let dirents;
            try {
                dirents = await fs.readdir(targetPath, { withFileTypes: true });
            }
            catch (err) {
                if (err.code === 'ENOENT') {
                    res.status(404).json({ error: 'Directory not found' });
                    return;
                }
                if (err.code === 'ENOTDIR') {
                    res.status(400).json({ error: 'Path is not a directory' });
                    return;
                }
                throw err;
            }
            // Get database for codebase status check
            const db = getDb();
            let indexedPaths = new Set();
            if (db) {
                try {
                    const projectPath = getCurrentProjectPath();
                    const result = await db.query('SELECT absolute_path FROM codebase_files WHERE project_path = $1', [projectPath]);
                    indexedPaths = new Set(result.rows.map(r => r.absolute_path));
                }
                catch (dbErr) {
                    logger.warn({ error: dbErr }, 'Could not fetch codebase status');
                }
            }
            // Build file entries
            const entries = [];
            for (const dirent of dirents) {
                // Skip excluded directories
                if (shouldExclude(dirent.name)) {
                    continue;
                }
                // Apply search filter if provided
                if (search && !dirent.name.toLowerCase().includes(search.toLowerCase())) {
                    continue;
                }
                const fullPath = path.join(targetPath, dirent.name);
                try {
                    const stats = await fs.stat(fullPath);
                    entries.push({
                        name: dirent.name,
                        path: fullPath,
                        type: dirent.isDirectory() ? 'directory' : 'file',
                        size: stats.size,
                        modified: stats.mtime.toISOString(),
                        extension: dirent.isDirectory() ? '' : path.extname(dirent.name).toLowerCase(),
                        isInCodebase: indexedPaths.has(fullPath),
                        isHidden: dirent.name.startsWith('.')
                    });
                }
                catch (statErr) {
                    // Skip files we can't stat (permission issues, etc.)
                    logger.debug({ path: fullPath, error: statErr }, 'Could not stat file');
                }
            }
            // Sort: directories first, then by name
            entries.sort((a, b) => {
                if (a.type === 'directory' && b.type !== 'directory')
                    return -1;
                if (a.type !== 'directory' && b.type === 'directory')
                    return 1;
                return a.name.localeCompare(b.name);
            });
            // Build breadcrumbs
            const breadcrumbs = [];
            let currentBreadcrumb = targetPath;
            while (currentBreadcrumb !== '/') {
                breadcrumbs.unshift({
                    name: path.basename(currentBreadcrumb) || 'Root',
                    path: currentBreadcrumb
                });
                currentBreadcrumb = path.dirname(currentBreadcrumb);
            }
            // Add root
            breadcrumbs.unshift({ name: '/', path: '/' });
            // Calculate parent path
            const parentPath = targetPath === '/' ? null : path.dirname(targetPath);
            const result = {
                currentPath: targetPath,
                parentPath,
                entries,
                breadcrumbs
            };
            res.json(result);
        }
        catch (error) {
            logger.error({ error }, 'Error browsing filesystem');
            res.status(500).json({ error: 'Failed to browse directory' });
        }
    });
    /**
     * POST /api/file-manager/add-to-codebase
     * Add paths to the codebase indexer
     */
    router.post('/add-to-codebase', requireAuth, async (req, res) => {
        try {
            const parseResult = AddToCodebaseSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Invalid request body',
                    details: parseResult.error.issues
                });
                return;
            }
            const { paths: requestedPaths } = parseResult.data;
            const db = getDb();
            if (!db) {
                res.status(503).json({ error: 'Database not connected' });
                return;
            }
            const results = [];
            for (const filePath of requestedPaths) {
                const validatedPath = validatePath(filePath);
                try {
                    // Check if path exists
                    const stats = await fs.stat(validatedPath);
                    if (stats.isDirectory()) {
                        // For directories, we add all files recursively
                        const addedFiles = await addDirectoryToCodebase(db, validatedPath);
                        results.push({
                            path: validatedPath,
                            status: 'added',
                            message: `Added ${addedFiles} files from directory`
                        });
                    }
                    else {
                        // For files, add directly
                        const wasAdded = await addFileToCodebase(db, validatedPath, stats);
                        results.push({
                            path: validatedPath,
                            status: wasAdded ? 'added' : 'exists'
                        });
                    }
                }
                catch (err) {
                    results.push({
                        path: validatedPath,
                        status: 'error',
                        message: err instanceof Error ? err.message : 'Unknown error'
                    });
                }
            }
            const added = results.filter(r => r.status === 'added').length;
            const exists = results.filter(r => r.status === 'exists').length;
            const errors = results.filter(r => r.status === 'error').length;
            res.json({
                success: true,
                summary: { added, exists, errors },
                results
            });
        }
        catch (error) {
            logger.error({ error }, 'Error adding to codebase');
            res.status(500).json({ error: 'Failed to add to codebase' });
        }
    });
    /**
     * POST /api/file-manager/remove-from-codebase
     * Remove paths from the codebase indexer
     * Uses transaction isolation for atomic multi-table deletion
     */
    router.post('/remove-from-codebase', requireAuth, async (req, res) => {
        try {
            const parseResult = RemoveFromCodebaseSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Invalid request body',
                    details: parseResult.error.issues
                });
                return;
            }
            const { paths: requestedPaths } = parseResult.data;
            const db = getDb();
            if (!db) {
                res.status(503).json({ error: 'Database not connected' });
                return;
            }
            const results = [];
            for (const filePath of requestedPaths) {
                const validatedPath = validatePath(filePath);
                // Use transaction for atomic multi-table deletion
                try {
                    await db.query('BEGIN');
                    // Check if it's a directory pattern or a file
                    const stats = await fs.stat(validatedPath).catch(() => null);
                    const isDirectory = stats?.isDirectory();
                    const pathPattern = isDirectory ? validatedPath + '/%' : validatedPath;
                    const pathOperator = isDirectory ? 'LIKE' : '=';
                    // Remove from codebase_files
                    const deleteResult = await db.query(`DELETE FROM codebase_files WHERE absolute_path ${pathOperator} $1 RETURNING id`, [pathPattern]);
                    // Clean up related data atomically (tables may not exist, so catch errors)
                    await db.query(`DELETE FROM code_chunks WHERE file_path ${pathOperator} $1`, [pathPattern]).catch(() => { });
                    await db.query(`DELETE FROM code_definitions WHERE file_path ${pathOperator} $1`, [pathPattern]).catch(() => { });
                    await db.query(`DELETE FROM code_dependencies WHERE source_file_path ${pathOperator} $1`, [pathPattern]).catch(() => { });
                    await db.query(`DELETE FROM code_complexity WHERE file_path ${pathOperator} $1`, [pathPattern]).catch(() => { });
                    await db.query('COMMIT');
                    results.push({
                        path: validatedPath,
                        status: deleteResult.rows.length > 0 ? 'removed' : 'not_found',
                        filesRemoved: deleteResult.rows.length
                    });
                }
                catch (err) {
                    // Rollback on any error within the transaction
                    await db.query('ROLLBACK').catch(() => { });
                    results.push({
                        path: validatedPath,
                        status: 'error'
                    });
                }
            }
            const removed = results.filter(r => r.status === 'removed').length;
            const notFound = results.filter(r => r.status === 'not_found').length;
            const totalFilesRemoved = results.reduce((sum, r) => sum + (r.filesRemoved || 0), 0);
            res.json({
                success: true,
                summary: { removed, notFound, totalFilesRemoved },
                results
            });
        }
        catch (error) {
            logger.error({ error }, 'Error removing from codebase');
            res.status(500).json({ error: 'Failed to remove from codebase' });
        }
    });
    /**
     * GET /api/file-manager/codebase-status
     * Check which paths are indexed in the codebase
     */
    router.get('/codebase-status', requireAuth, async (req, res) => {
        try {
            const parseResult = CodebaseStatusQuerySchema.safeParse(req.query);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Invalid query parameters',
                    details: parseResult.error.issues
                });
                return;
            }
            const db = getDb();
            if (!db) {
                res.status(503).json({ error: 'Database not connected' });
                return;
            }
            const { paths } = parseResult.data;
            const projectPath = getCurrentProjectPath();
            if (paths) {
                // Check specific paths
                const pathList = paths.split(',').map(p => validatePath(p.trim()));
                const placeholders = pathList.map((_, i) => `$${i + 2}`).join(', ');
                const result = await db.query(`SELECT absolute_path FROM codebase_files WHERE project_path = $1 AND absolute_path IN (${placeholders})`, [projectPath, ...pathList]);
                const indexed = new Set(result.rows.map(r => r.absolute_path));
                const status = pathList.map(p => ({
                    path: p,
                    isIndexed: indexed.has(p)
                }));
                res.json({ status });
            }
            else {
                // Return overall codebase status
                const countResult = await db.query('SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as total_size FROM codebase_files WHERE project_path = $1', [projectPath]);
                const pathsResult = await db.query('SELECT DISTINCT absolute_path FROM codebase_files WHERE project_path = $1 ORDER BY absolute_path LIMIT 1000', [projectPath]);
                res.json({
                    totalFiles: parseInt(countResult.rows[0]?.count || '0'),
                    totalSize: parseInt(countResult.rows[0]?.total_size || '0'),
                    indexedPaths: pathsResult.rows.map(r => r.absolute_path)
                });
            }
        }
        catch (error) {
            logger.error({ error }, 'Error fetching codebase status');
            res.status(500).json({ error: 'Failed to fetch codebase status' });
        }
    });
    // ==========================================================================
    // WATCHED PATHS CRUD - Dynamic directory watching configuration
    // ==========================================================================
    /**
     * GET /api/file-manager/watched-paths
     * List all watched paths (directories being monitored for changes)
     */
    router.get('/watched-paths', requireAuth, async (req, res) => {
        try {
            const db = getDb();
            if (!db) {
                res.status(503).json({ error: 'Database not connected' });
                return;
            }
            const projectPath = getCurrentProjectPath();
            const result = await db.query(`
        SELECT * FROM watched_paths
        WHERE project_path = $1
        ORDER BY created_at DESC
      `, [projectPath]);
            res.json({
                success: true,
                paths: result.rows.map(row => ({
                    id: row.id,
                    path: row.path,
                    label: row.label || path.basename(row.path),
                    isActive: row.is_active,
                    indexOnAdd: row.index_on_add,
                    watchForChanges: row.watch_for_changes,
                    ignorePatterns: row.ignore_patterns || [],
                    fileCount: row.file_count,
                    lastIndexedAt: row.last_indexed_at,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at
                }))
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching watched paths');
            res.status(500).json({ error: 'Failed to fetch watched paths' });
        }
    });
    /**
     * POST /api/file-manager/watched-paths
     * Add a new watched path
     */
    router.post('/watched-paths', requireAuth, async (req, res) => {
        try {
            const db = getDb();
            if (!db) {
                res.status(503).json({ error: 'Database not connected' });
                return;
            }
            const { path: watchPath, label, indexOnAdd = true, watchForChanges = true, ignorePatterns = [] } = req.body;
            if (!watchPath) {
                res.status(400).json({ error: 'Path is required' });
                return;
            }
            const validatedPath = validatePath(watchPath);
            // Verify path is a directory by attempting readdir - avoids stat-then-read race condition
            try {
                await fs.readdir(validatedPath);
            }
            catch (err) {
                if (err.code === 'ENOENT') {
                    res.status(404).json({ error: 'Directory not found' });
                    return;
                }
                if (err.code === 'ENOTDIR') {
                    res.status(400).json({ error: 'Path must be a directory' });
                    return;
                }
                throw err;
            }
            const projectPath = getCurrentProjectPath();
            // Atomic upsert - INSERT or UPDATE in single query to prevent race conditions
            const upsertResult = await db.query(`INSERT INTO watched_paths (path, label, is_active, index_on_add, watch_for_changes, ignore_patterns, project_path)
         VALUES ($1, $2, true, $3, $4, $5, $6)
         ON CONFLICT (path, project_path) DO UPDATE SET
           label = COALESCE($2, watched_paths.label),
           is_active = true,
           index_on_add = $3,
           watch_for_changes = $4,
           ignore_patterns = $5,
           updated_at = NOW()
         RETURNING id, (xmax <> 0) AS is_update`, [validatedPath, label || null, indexOnAdd, watchForChanges, ignorePatterns, projectPath]);
            const pathId = upsertResult.rows[0].id;
            const isUpdate = upsertResult.rows[0].is_update;
            // If indexOnAdd, trigger indexing
            let filesIndexed = 0;
            if (indexOnAdd) {
                filesIndexed = await addDirectoryToCodebase(db, validatedPath);
                await db.query('UPDATE watched_paths SET file_count = $1, last_indexed_at = NOW() WHERE id = $2', [filesIndexed, pathId]);
            }
            res.json({
                success: true,
                id: pathId,
                path: validatedPath,
                filesIndexed,
                updated: isUpdate
            });
        }
        catch (error) {
            logger.error({ error }, 'Error adding watched path');
            res.status(500).json({ error: 'Failed to add watched path' });
        }
    });
    /**
     * PUT /api/file-manager/watched-paths/:id
     * Update a watched path
     */
    router.put('/watched-paths/:id', requireAuth, async (req, res) => {
        try {
            const db = getDb();
            if (!db) {
                res.status(503).json({ error: 'Database not connected' });
                return;
            }
            const { id } = req.params;
            const { label, isActive, indexOnAdd, watchForChanges, ignorePatterns } = req.body;
            const updates = [];
            const values = [];
            let paramIndex = 1;
            if (label !== undefined) {
                updates.push(`label = $${paramIndex++}`);
                values.push(label);
            }
            if (isActive !== undefined) {
                updates.push(`is_active = $${paramIndex++}`);
                values.push(isActive);
            }
            if (indexOnAdd !== undefined) {
                updates.push(`index_on_add = $${paramIndex++}`);
                values.push(indexOnAdd);
            }
            if (watchForChanges !== undefined) {
                updates.push(`watch_for_changes = $${paramIndex++}`);
                values.push(watchForChanges);
            }
            if (ignorePatterns !== undefined) {
                updates.push(`ignore_patterns = $${paramIndex++}`);
                values.push(ignorePatterns);
            }
            if (updates.length === 0) {
                res.status(400).json({ error: 'No updates provided' });
                return;
            }
            updates.push(`updated_at = NOW()`);
            values.push(id);
            const projectPath = getCurrentProjectPath();
            values.push(projectPath);
            const result = await db.query(`UPDATE watched_paths SET ${updates.join(', ')} WHERE id = $${paramIndex} AND project_path = $${paramIndex + 1} RETURNING *`, values);
            if (result.rows.length === 0) {
                res.status(404).json({ error: 'Watched path not found' });
                return;
            }
            res.json({ success: true, path: result.rows[0] });
        }
        catch (error) {
            logger.error({ error }, 'Error updating watched path');
            res.status(500).json({ error: 'Failed to update watched path' });
        }
    });
    /**
     * DELETE /api/file-manager/watched-paths/:id
     * Remove a watched path
     * Uses transaction isolation for atomic delete with optional file cleanup
     */
    router.delete('/watched-paths/:id', requireAuth, async (req, res) => {
        try {
            const db = getDb();
            if (!db) {
                res.status(503).json({ error: 'Database not connected' });
                return;
            }
            const { id } = req.params;
            const { removeIndexedFiles } = req.query;
            const projectPath = getCurrentProjectPath();
            // Use transaction for atomic delete with optional file cleanup
            try {
                await db.query('BEGIN');
                // Atomically delete and return the path in one query using DELETE ... RETURNING
                // This is more efficient than SELECT FOR UPDATE + DELETE as it's a single atomic operation
                const deletePathResult = await db.query('DELETE FROM watched_paths WHERE id = $1 AND project_path = $2 RETURNING path', [id, projectPath]);
                if (deletePathResult.rows.length === 0) {
                    await db.query('ROLLBACK');
                    res.status(404).json({ error: 'Watched path not found' });
                    return;
                }
                const watchedPath = deletePathResult.rows[0].path;
                // Optionally remove indexed files (within same transaction)
                let filesRemoved = 0;
                if (removeIndexedFiles === 'true') {
                    const deleteResult = await db.query('DELETE FROM codebase_files WHERE absolute_path LIKE $1 RETURNING id', [watchedPath + '%']);
                    filesRemoved = deleteResult.rows.length;
                }
                await db.query('COMMIT');
                res.json({ success: true, filesRemoved });
            }
            catch (err) {
                await db.query('ROLLBACK').catch(() => { });
                throw err;
            }
        }
        catch (error) {
            logger.error({ error }, 'Error deleting watched path');
            res.status(500).json({ error: 'Failed to delete watched path' });
        }
    });
    /**
     * POST /api/file-manager/watched-paths/:id/reindex
     * Trigger reindexing of a watched path
     * Uses transaction isolation for atomic clear-reindex-update operations
     */
    router.post('/watched-paths/:id/reindex', requireAuth, async (req, res) => {
        try {
            const db = getDb();
            if (!db) {
                res.status(503).json({ error: 'Database not connected' });
                return;
            }
            const { id } = req.params;
            const projectPath = getCurrentProjectPath();
            // Use transaction for atomic reindex operation
            try {
                await db.query('BEGIN');
                // Get the path with FOR UPDATE lock
                const pathResult = await db.query('SELECT path FROM watched_paths WHERE id = $1 AND project_path = $2 FOR UPDATE', [id, projectPath]);
                if (pathResult.rows.length === 0) {
                    await db.query('ROLLBACK');
                    res.status(404).json({ error: 'Watched path not found' });
                    return;
                }
                const watchedPath = pathResult.rows[0].path;
                // Clear existing files from this path
                await db.query('DELETE FROM codebase_files WHERE absolute_path LIKE $1', [watchedPath + '%']);
                // Reindex (this happens outside transaction for performance,
                // but the delete and update are atomic)
                await db.query('COMMIT');
                // Perform reindex outside transaction to avoid long-held locks
                const filesIndexed = await addDirectoryToCodebase(db, watchedPath);
                // Update the record in a separate quick transaction
                await db.query('BEGIN');
                await db.query('UPDATE watched_paths SET file_count = $1, last_indexed_at = NOW(), updated_at = NOW() WHERE id = $2', [filesIndexed, id]);
                await db.query('COMMIT');
                res.json({ success: true, filesIndexed });
            }
            catch (err) {
                await db.query('ROLLBACK').catch(() => { });
                throw err;
            }
        }
        catch (error) {
            logger.error({ error }, 'Error reindexing watched path');
            res.status(500).json({ error: 'Failed to reindex watched path' });
        }
    });
    return router;
}
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Add a single file to the codebase
 */
async function addFileToCodebase(db, absolutePath, stats) {
    const { v4: uuidv4 } = await import('uuid');
    const crypto = await import('crypto');
    // Skip files that are too large (>1MB)
    if (stats.size > 1024 * 1024) {
        logger.debug({ path: absolutePath }, 'Skipping large file');
        return false;
    }
    // Read file content first (before any DB operations)
    const content = await fs.readFile(absolutePath, 'utf-8').catch(() => null);
    if (content === null) {
        return false; // Binary or unreadable file
    }
    // Detect language
    const ext = path.extname(absolutePath).toLowerCase();
    const fileName = path.basename(absolutePath);
    const language = detectLanguage(ext, fileName);
    const languageType = getLanguageType(language);
    // Calculate hash
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    // Calculate relative path from specmem root (portable path detection)
    const specmemRoot = getSpecmemRoot();
    const rootWithSlash = specmemRoot.endsWith('/') ? specmemRoot : specmemRoot + '/';
    const relativePath = absolutePath.startsWith(rootWithSlash)
        ? absolutePath.substring(rootWithSlash.length)
        : absolutePath;
    // Use UPSERT to atomically insert or skip if already exists
    // This eliminates the TOCTOU race condition from separate SELECT + INSERT
    const result = await db.query(`INSERT INTO codebase_files (
      id, file_path, absolute_path, file_name, extension,
      language_id, language_name, language_type,
      content, size_bytes, line_count, char_count,
      last_modified, content_hash
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
    )
    ON CONFLICT (absolute_path) DO NOTHING
    RETURNING id`, [
        uuidv4(),
        relativePath,
        absolutePath,
        fileName,
        ext,
        language.toLowerCase(),
        language.charAt(0).toUpperCase() + language.slice(1),
        languageType,
        content,
        stats.size,
        content.split('\n').length,
        content.length,
        stats.mtime,
        contentHash
    ]);
    // Returns true if inserted, false if already existed (conflict)
    return result.rowCount > 0;
}
/**
 * Add all files from a directory to the codebase recursively
 */
async function addDirectoryToCodebase(db, dirPath, depth = 0) {
    if (depth > 20)
        return 0; // Max depth protection
    let added = 0;
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            if (shouldExclude(entry.name))
                continue;
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                added += await addDirectoryToCodebase(db, fullPath, depth + 1);
            }
            else if (entry.isFile() && isIndexableFile(entry.name)) {
                try {
                    const stats = await fs.stat(fullPath);
                    const wasAdded = await addFileToCodebase(db, fullPath, stats);
                    if (wasAdded)
                        added++;
                }
                catch (err) {
                    // Skip files with errors
                }
            }
        }
    }
    catch (err) {
        logger.warn({ dirPath, error: err }, 'Error reading directory');
    }
    return added;
}
/**
 * Check if a file should be indexed based on extension
 */
function isIndexableFile(fileName) {
    const indexableExtensions = [
        '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
        '.py', '.pyi',
        '.json',
        '.md', '.markdown', '.rst', '.txt',
        '.yaml', '.yml',
        '.toml', '.ini', '.cfg',
        '.sh', '.bash', '.zsh',
        '.css', '.scss', '.sass', '.less',
        '.html', '.htm', '.xml',
        '.sql',
        '.go',
        '.rs',
        '.java', '.kt', '.scala',
        '.rb',
        '.php',
        '.c', '.cpp', '.h', '.hpp',
        '.swift'
    ];
    const ext = path.extname(fileName).toLowerCase();
    return indexableExtensions.includes(ext) || fileName.toLowerCase() === 'dockerfile';
}
/**
 * Detect programming language from file extension
 */
function detectLanguage(ext, fileName) {
    const languageMap = {
        '.js': 'javascript',
        '.mjs': 'javascript',
        '.cjs': 'javascript',
        '.ts': 'typescript',
        '.jsx': 'javascript-react',
        '.tsx': 'typescript-react',
        '.py': 'python',
        '.pyi': 'python',
        '.json': 'json',
        '.md': 'markdown',
        '.markdown': 'markdown',
        '.yaml': 'yaml',
        '.yml': 'yaml',
        '.toml': 'toml',
        '.sh': 'bash',
        '.bash': 'bash',
        '.zsh': 'zsh',
        '.css': 'css',
        '.scss': 'scss',
        '.sass': 'sass',
        '.html': 'html',
        '.xml': 'xml',
        '.sql': 'sql',
        '.go': 'go',
        '.rs': 'rust',
        '.java': 'java',
        '.kt': 'kotlin',
        '.rb': 'ruby',
        '.php': 'php',
        '.c': 'c',
        '.cpp': 'cpp',
        '.h': 'c-header',
        '.hpp': 'cpp-header',
        '.swift': 'swift'
    };
    if (fileName.toLowerCase() === 'dockerfile')
        return 'dockerfile';
    if (fileName.toLowerCase() === 'makefile')
        return 'makefile';
    return languageMap[ext] || 'unknown';
}
/**
 * Get language type category
 */
function getLanguageType(language) {
    const programmingLangs = [
        'javascript', 'typescript', 'python', 'java', 'go', 'rust',
        'c', 'cpp', 'swift', 'kotlin', 'ruby', 'php', 'scala'
    ];
    const markupLangs = ['html', 'xml', 'markdown'];
    const dataLangs = ['json', 'yaml', 'toml'];
    const configLangs = ['ini', 'cfg', 'bash', 'zsh', 'dockerfile'];
    const lower = language.toLowerCase();
    if (programmingLangs.some(l => lower.includes(l)))
        return 'programming';
    if (markupLangs.some(l => lower.includes(l)))
        return 'markup';
    if (dataLangs.some(l => lower.includes(l)))
        return 'data';
    if (configLangs.some(l => lower.includes(l)))
        return 'config';
    return 'data';
}
//# sourceMappingURL=fileManager.js.map