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
import { Router } from 'express';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../../utils/logger.js';
// ============================================================================
// Configuration
// ============================================================================
const EXPORT_BASE_DIR = '/server/data/exports';
// Known SpecMem tables
const SPECMEM_TABLES = [
    'memories',
    'memory_relations',
    'tags',
    'memory_tags',
    'consolidation_history',
    'embedding_cache',
    'codebase_files',
    'code_chunks',
    'code_definitions',
    'code_dependencies',
    'dependency_history',
    'claude_code_history',
    '_specmem_migrations',
    'team_member_heartbeats',
    'team_member_messages',
    'skills',
    'claude_sessions',
];
// Materialized views
const MATERIALIZED_VIEWS = [
    'memory_stats',
    'codebase_stats',
    'claude_code_stats',
];
// ============================================================================
// Validation Schemas
// ============================================================================
const ExportTableSchema = z.object({
    format: z.enum(['json', 'jsonl']).default('json'),
    pretty: z.coerce.boolean().default(true),
    limit: z.coerce.number().int().min(0).max(1000000).optional(),
    includeMetadata: z.coerce.boolean().default(true),
});
const ExportMultipleSchema = z.object({
    tables: z.string().transform(s => s.split(',').map(t => t.trim().toLowerCase())),
    format: z.enum(['json', 'jsonl']).default('json'),
    pretty: z.coerce.boolean().default(true),
});
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Get timestamp for filenames
 */
function getTimestamp() {
    const now = new Date();
    return now.toISOString()
        .replace(/:/g, '')
        .replace(/\./g, '')
        .replace(/-/g, '')
        .replace('T', '_')
        .substring(0, 15);
}
/**
 * Create SHA256 checksum
 */
function createChecksum(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}
/**
 * Ensure export directory exists
 */
async function ensureExportDir() {
    await fs.mkdir(EXPORT_BASE_DIR, { recursive: true });
    return EXPORT_BASE_DIR;
}
/**
 * Process row data for JSON export (handle buffers, dates, vectors)
 */
function processRow(row) {
    const processed = {};
    for (const [key, value] of Object.entries(row)) {
        if (Buffer.isBuffer(value)) {
            processed[key] = {
                _type: 'buffer',
                _encoding: 'base64',
                _data: value.toString('base64'),
            };
        }
        else if (value instanceof Date) {
            processed[key] = value.toISOString();
        }
        else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'number') {
            // Vector/embedding array
            processed[key] = {
                _type: 'vector',
                _dimensions: value.length,
                _data: value,
            };
        }
        else {
            processed[key] = value;
        }
    }
    return processed;
}
// ============================================================================
// Router Factory
// ============================================================================
export function createDataExportRouter(requireAuth, db) {
    const router = Router();
    /**
     * GET /api/admin/export/tables
     * List all available tables with row counts
     */
    router.get('/tables', requireAuth, async (req, res) => {
        try {
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not connected' });
                return;
            }
            // Get current project schema name
            const schemaName = db.getProjectSchemaName();
            // Get tables from project schema
            const tablesResult = await db.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `, [schemaName]);
            // Get materialized views from project schema
            const viewsResult = await db.query(`
        SELECT matviewname as view_name
        FROM pg_matviews
        WHERE schemaname = $1
        ORDER BY matviewname
      `, [schemaName]);
            // Get row counts for each table
            const tables = [];
            for (const row of tablesResult.rows) {
                const tableName = row.table_name;
                try {
                    const countResult = await db.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
                    tables.push({
                        name: tableName,
                        rows: parseInt(countResult.rows[0].count),
                        type: 'table',
                    });
                }
                catch {
                    tables.push({ name: tableName, rows: 0, type: 'table' });
                }
            }
            for (const row of viewsResult.rows) {
                const viewName = row.view_name;
                try {
                    const countResult = await db.query(`SELECT COUNT(*) as count FROM "${viewName}"`);
                    tables.push({
                        name: viewName,
                        rows: parseInt(countResult.rows[0].count),
                        type: 'materialized_view',
                    });
                }
                catch {
                    tables.push({ name: viewName, rows: 0, type: 'materialized_view' });
                }
            }
            res.json({
                success: true,
                tables,
                totalTables: tablesResult.rows.length,
                totalViews: viewsResult.rows.length,
                knownSpecmemTables: SPECMEM_TABLES,
                knownViews: MATERIALIZED_VIEWS,
            });
        }
        catch (error) {
            logger.error({ error }, 'Error listing tables for export');
            res.status(500).json({ success: false, error: 'Failed to list tables' });
        }
    });
    /**
     * GET /api/admin/export/:table
     * Export a specific table to JSON
     */
    router.get('/:table', requireAuth, async (req, res) => {
        try {
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not connected' });
                return;
            }
            const tableName = req.params.table.toLowerCase();
            // Validate table name (prevent SQL injection)
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
                res.status(400).json({ success: false, error: 'Invalid table name' });
                return;
            }
            // Parse options
            const parseResult = ExportTableSchema.safeParse(req.query);
            if (!parseResult.success) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid query parameters',
                    details: parseResult.error.errors,
                });
                return;
            }
            const { format, pretty, limit, includeMetadata } = parseResult.data;
            // Get current project schema name
            const schemaName = db.getProjectSchemaName();
            // Check if table exists in project schema
            const existsResult = await db.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = $1 AND table_name = $2
        ) OR EXISTS (
          SELECT 1 FROM pg_matviews
          WHERE schemaname = $1 AND matviewname = $2
        ) as exists
      `, [schemaName, tableName]);
            if (!existsResult.rows[0].exists) {
                res.status(404).json({ success: false, error: `Table '${tableName}' not found` });
                return;
            }
            // Build query
            let query = `SELECT * FROM "${tableName}"`;
            if (limit) {
                query += ` LIMIT ${limit}`;
            }
            const result = await db.query(query);
            const rows = result.rows.map(row => processRow(row));
            // Build response
            const timestamp = getTimestamp();
            if (format === 'jsonl') {
                // Stream JSONL format
                res.setHeader('Content-Type', 'application/x-ndjson');
                res.setHeader('Content-Disposition', `attachment; filename="${tableName}_${timestamp}.jsonl"`);
                if (includeMetadata) {
                    res.write(JSON.stringify({
                        _metadata: {
                            table: tableName,
                            exportedAt: new Date().toISOString(),
                            rowCount: rows.length,
                            format: 'jsonl',
                        }
                    }) + '\n');
                }
                for (const row of rows) {
                    res.write(JSON.stringify(row) + '\n');
                }
                res.end();
            }
            else {
                // JSON format
                const exportData = {};
                if (includeMetadata) {
                    exportData._metadata = {
                        table: tableName,
                        exportedAt: new Date().toISOString(),
                        rowCount: rows.length,
                        checksum: createChecksum(JSON.stringify(rows)),
                        version: '1.0',
                    };
                }
                exportData.rows = rows;
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="${tableName}_${timestamp}.json"`);
                if (pretty) {
                    res.send(JSON.stringify(exportData, null, 2));
                }
                else {
                    res.json(exportData);
                }
            }
        }
        catch (error) {
            logger.error({ error, table: req.params.table }, 'Error exporting table');
            res.status(500).json({ success: false, error: 'Failed to export table' });
        }
    });
    /**
     * POST /api/admin/export/all
     * Export all tables to files and return manifest
     */
    router.post('/all', requireAuth, async (req, res) => {
        try {
            if (!db) {
                res.status(503).json({ success: false, error: 'Database not connected' });
                return;
            }
            await ensureExportDir();
            const timestamp = getTimestamp();
            // Get current project schema name
            const schemaName = db.getProjectSchemaName();
            // Get all tables from project schema
            const tablesResult = await db.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `, [schemaName]);
            // Get materialized views from project schema
            const viewsResult = await db.query(`
        SELECT matviewname as view_name
        FROM pg_matviews
        WHERE schemaname = $1
        ORDER BY matviewname
      `, [schemaName]);
            const allTables = [
                ...tablesResult.rows.map(r => ({ name: r.table_name, type: 'table' })),
                ...viewsResult.rows.map(r => ({ name: r.view_name, type: 'view' })),
            ];
            const results = [];
            let totalRows = 0;
            let totalSizeKB = 0;
            for (const { name: tableName, type } of allTables) {
                try {
                    const result = await db.query(`SELECT * FROM "${tableName}"`);
                    if (result.rows.length === 0) {
                        results.push({ name: tableName, type, rows: 0, skipped: true });
                        continue;
                    }
                    const rows = result.rows.map(row => processRow(row));
                    const exportData = {
                        _metadata: {
                            table: tableName,
                            type,
                            exportedAt: new Date().toISOString(),
                            rowCount: rows.length,
                            checksum: createChecksum(JSON.stringify(rows)),
                            version: '1.0',
                        },
                        rows,
                    };
                    const content = JSON.stringify(exportData, null, 2);
                    const filename = `${tableName}_${timestamp}.json`;
                    const filepath = path.join(EXPORT_BASE_DIR, filename);
                    await fs.writeFile(filepath, content, 'utf8');
                    const sizeKB = Buffer.byteLength(content, 'utf8') / 1024;
                    results.push({
                        name: tableName,
                        type,
                        rows: rows.length,
                        filepath,
                        filesize: Math.round(sizeKB * 100) / 100,
                        checksum: exportData._metadata.checksum,
                    });
                    totalRows += rows.length;
                    totalSizeKB += sizeKB;
                }
                catch (err) {
                    const errorMessage = err instanceof Error ? err.message : String(err);
                    results.push({ name: tableName, type, rows: 0, error: errorMessage });
                }
            }
            // Create manifest
            const manifest = {
                exportId: timestamp,
                createdAt: new Date().toISOString(),
                summary: {
                    totalTables: results.filter(r => !r.error && !r.skipped).length,
                    totalRows,
                    totalSizeKB: Math.round(totalSizeKB * 100) / 100,
                    errors: results.filter(r => r.error).length,
                    skipped: results.filter(r => r.skipped).length,
                },
                tables: results,
                exportDirectory: EXPORT_BASE_DIR,
            };
            const manifestPath = path.join(EXPORT_BASE_DIR, `MANIFEST_${timestamp}.json`);
            await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
            logger.info({
                totalTables: manifest.summary.totalTables,
                totalRows,
                totalSizeKB: manifest.summary.totalSizeKB,
            }, 'Full database export completed');
            res.json({
                success: true,
                message: 'Export completed successfully',
                manifest,
                manifestPath,
            });
        }
        catch (error) {
            logger.error({ error }, 'Error exporting all tables');
            res.status(500).json({ success: false, error: 'Failed to export database' });
        }
    });
    /**
     * GET /api/admin/export/files
     * List existing export files
     */
    router.get('/files/list', requireAuth, async (req, res) => {
        try {
            await ensureExportDir();
            const files = await fs.readdir(EXPORT_BASE_DIR);
            const exportFiles = [];
            for (const file of files) {
                if (!file.endsWith('.json') && !file.endsWith('.jsonl'))
                    continue;
                const filepath = path.join(EXPORT_BASE_DIR, file);
                const stats = await fs.stat(filepath);
                exportFiles.push({
                    filename: file,
                    filepath,
                    size: stats.size,
                    created: stats.birthtime,
                    isManifest: file.startsWith('MANIFEST_'),
                });
            }
            // Sort by creation date descending
            exportFiles.sort((a, b) => b.created.getTime() - a.created.getTime());
            res.json({
                success: true,
                files: exportFiles,
                directory: EXPORT_BASE_DIR,
                count: exportFiles.length,
            });
        }
        catch (error) {
            logger.error({ error }, 'Error listing export files');
            res.status(500).json({ success: false, error: 'Failed to list export files' });
        }
    });
    /**
     * GET /api/admin/export/download/:filename
     * Download a specific export file
     */
    router.get('/download/:filename', requireAuth, async (req, res) => {
        try {
            const { filename } = req.params;
            // Validate filename (prevent path traversal)
            if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
                res.status(400).json({ success: false, error: 'Invalid filename' });
                return;
            }
            const filepath = path.join(EXPORT_BASE_DIR, filename);
            try {
                await fs.access(filepath);
            }
            catch {
                res.status(404).json({ success: false, error: 'File not found' });
                return;
            }
            const content = await fs.readFile(filepath, 'utf8');
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(content);
        }
        catch (error) {
            logger.error({ error, filename: req.params.filename }, 'Error downloading export file');
            res.status(500).json({ success: false, error: 'Failed to download file' });
        }
    });
    /**
     * DELETE /api/admin/export/files/:filename
     * Delete an export file
     */
    router.delete('/files/:filename', requireAuth, async (req, res) => {
        try {
            const { filename } = req.params;
            // Validate filename
            if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
                res.status(400).json({ success: false, error: 'Invalid filename' });
                return;
            }
            const filepath = path.join(EXPORT_BASE_DIR, filename);
            try {
                await fs.access(filepath);
            }
            catch {
                res.status(404).json({ success: false, error: 'File not found' });
                return;
            }
            await fs.unlink(filepath);
            logger.info({ filename }, 'Export file deleted');
            res.json({
                success: true,
                message: `File ${filename} deleted successfully`,
            });
        }
        catch (error) {
            logger.error({ error, filename: req.params.filename }, 'Error deleting export file');
            res.status(500).json({ success: false, error: 'Failed to delete file' });
        }
    });
    return router;
}
export default createDataExportRouter;
export { SPECMEM_TABLES, MATERIALIZED_VIEWS, EXPORT_BASE_DIR };
//# sourceMappingURL=dataExport.js.map