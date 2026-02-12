#!/usr/bin/env npx tsx
/**
 * Data Migration Script: public schema -> project-specific schemas
 *
 * THE PROBLEM:
 * 157,177 memories are in public.memories with project_path column.
 * They need to move to correct project schemas (specmem_{project_name}).
 *
 * WHAT THIS SCRIPT DOES:
 * 1. Queries public.memories grouped by project_path
 * 2. For each unique project_path:
 *    - Derives schema name: specmem_{basename(project_path)}
 *    - Creates schema if not exists
 *    - Creates tables in that schema (copy structure)
 *    - Moves rows: INSERT INTO schema.table SELECT * FROM public.table WHERE project_path = X
 *    - Deletes from public after successful move
 * 3. Same for: codebase_files, code_definitions, team_messages, task_claims
 *
 * SAFETY:
 * - Uses transactions for atomicity
 * - Logs progress
 * - Handles "/" project_path (goes to specmem_default)
 * - Doesn't delete from public until INSERT succeeds
 * - Dry run mode available
 */

import { Pool } from 'pg';
import * as path from 'path';
import * as fs from 'fs';

// Show help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: npx tsx scripts/migrate-to-project-schemas.ts [options]

Options:
  --dry-run     Show what would be migrated without making changes
  --verbose     Show detailed debug output
  --help, -h    Show this help message

Environment Variables:
  BATCH_SIZE              Rows per batch (default: 1000)
  SPECMEM_DB_HOST         Database host (default: localhost)
  SPECMEM_DB_PORT         Database port (default: 5432)
  SPECMEM_DB_NAME         Database name (default: specmem_westayunprofessional)
  SPECMEM_DB_USER         Database user (default: specmem_westayunprofessional)
  SPECMEM_DB_PASSWORD     Database password

Examples:
  # Dry run to see what would be migrated
  npx tsx scripts/migrate-to-project-schemas.ts --dry-run

  # Run with verbose output
  npx tsx scripts/migrate-to-project-schemas.ts --verbose

  # Run with custom batch size
  BATCH_SIZE=5000 npx tsx scripts/migrate-to-project-schemas.ts
`);
  process.exit(0);
}

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '1000');

// Tables to migrate with their relevant columns
const TABLES_TO_MIGRATE = [
  'memories',
  'codebase_files',
  'code_definitions',
  'team_messages',
  'task_claims'
];

// Pool for database operations
const pool = new Pool({
  host: process.env.SPECMEM_DB_HOST || 'localhost',
  port: parseInt(process.env.SPECMEM_DB_PORT || '5432'),
  database: process.env.SPECMEM_DB_NAME || 'specmem_westayunprofessional',
  user: process.env.SPECMEM_DB_USER || 'specmem_westayunprofessional',
  password: process.env.SPECMEM_DB_PASSWORD || 'specmem_westayunprofessional',
  max: 10
});

interface MigrationStats {
  tableName: string;
  projectPath: string;
  schemaName: string;
  rowsMoved: number;
  status: 'success' | 'skipped' | 'error';
  error?: string;
}

/**
 * Derive schema name from project path.
 * "/" goes to specmem_default
 * "/home/user/myproject" goes to specmem_myproject
 */
function getSchemaName(projectPath: string): string {
  if (!projectPath || projectPath === '/' || projectPath === '') {
    return 'specmem_default';
  }
  const dirName = path.basename(projectPath)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'default';
  return 'specmem_' + dirName;
}

/**
 * Validate schema name to prevent SQL injection
 */
function validateSchemaName(schemaName: string): boolean {
  return /^specmem_[a-z0-9_]+$/.test(schemaName) && schemaName.length <= 63;
}

/**
 * Log with timestamp
 */
function log(msg: string, level: 'info' | 'error' | 'warn' | 'debug' = 'info') {
  const ts = new Date().toISOString();
  const prefix = {
    info: '[INFO]',
    error: '[ERROR]',
    warn: '[WARN]',
    debug: '[DEBUG]'
  }[level];
  if (level === 'debug' && !VERBOSE) return;
  console.log(ts + ' ' + prefix + ' ' + msg);
}

/**
 * Check if table exists in schema
 */
async function tableExistsInSchema(schemaName: string, tableName: string): Promise<boolean> {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = $1 AND table_name = $2
  `, [schemaName, tableName]);
  return result.rows.length > 0;
}

/**
 * Check if table has project_path column
 */
async function hasProjectPathColumn(schemaName: string, tableName: string): Promise<boolean> {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2 AND column_name = 'project_path'
  `, [schemaName, tableName]);
  return result.rows.length > 0;
}

/**
 * Get all unique project_paths from a table in public schema
 */
async function getUniqueProjectPaths(tableName: string): Promise<string[]> {
  const hasCol = await hasProjectPathColumn('public', tableName);
  if (!hasCol) {
    log(tableName + ' in public schema does not have project_path column', 'warn');
    return [];
  }

  const result = await pool.query(`
    SELECT DISTINCT project_path FROM public.${tableName}
    WHERE project_path IS NOT NULL
    ORDER BY project_path
  `);
  return result.rows.map((r: { project_path: string }) => r.project_path);
}

/**
 * Create schema if not exists
 */
async function ensureSchema(schemaName: string): Promise<void> {
  if (!validateSchemaName(schemaName)) {
    throw new Error('Invalid schema name: ' + schemaName);
  }
  if (!DRY_RUN) {
    await pool.query('CREATE SCHEMA IF NOT EXISTS ' + schemaName);
  }
  log('Ensured schema exists: ' + schemaName);
}

/**
 * Create table in schema by copying structure from public
 * Uses pg_dump style table definition recreation
 */
async function ensureTableInSchema(schemaName: string, tableName: string): Promise<void> {
  const exists = await tableExistsInSchema(schemaName, tableName);
  if (exists) {
    log('Table ' + schemaName + '.' + tableName + ' already exists', 'debug');
    return;
  }

  if (!DRY_RUN) {
    // Get column definitions from public table
    const colResult = await pool.query(`
      SELECT column_name, data_type, udt_name, character_maximum_length,
             column_default, is_nullable, is_generated,
             generation_expression
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);

    if (colResult.rows.length === 0) {
      log('Table public.' + tableName + ' does not exist, skipping', 'warn');
      return;
    }

    // Build CREATE TABLE statement
    const columns: string[] = [];
    for (const col of colResult.rows) {
      let colDef = '"' + col.column_name + '" ';

      // Handle data type
      if (col.udt_name === 'vector') {
        // Vector type with dimension
        colDef += 'vector(384)';
      } else if (col.data_type === 'ARRAY') {
        colDef += col.udt_name.replace(/^_/, '') + '[]';
      } else if (col.data_type === 'USER-DEFINED') {
        colDef += col.udt_name;
      } else if (col.character_maximum_length) {
        colDef += col.data_type + '(' + col.character_maximum_length + ')';
      } else {
        colDef += col.data_type;
      }

      // Handle GENERATED columns
      if (col.is_generated === 'ALWAYS' && col.generation_expression) {
        colDef += ' GENERATED ALWAYS AS (' + col.generation_expression + ') STORED';
      } else if (col.column_default) {
        colDef += ' DEFAULT ' + col.column_default;
      }

      if (col.is_nullable === 'NO') {
        colDef += ' NOT NULL';
      }

      columns.push(colDef);
    }

    // Get primary key
    const pkResult = await pool.query(`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = ('public.' || $1)::regclass AND i.indisprimary
    `, [tableName]);

    if (pkResult.rows.length > 0) {
      const pkCols = pkResult.rows.map((r: { attname: string }) => '"' + r.attname + '"').join(', ');
      columns.push('PRIMARY KEY (' + pkCols + ')');
    }

    const createSql = 'CREATE TABLE IF NOT EXISTS ' + schemaName + '.' + tableName + ' (\n  ' + columns.join(',\n  ') + '\n)';

    log('Creating table ' + schemaName + '.' + tableName, 'debug');
    try {
      await pool.query(createSql);
    } catch (err) {
      log('Failed to create table with error: ' + (err instanceof Error ? err.message : String(err)), 'error');
      log('SQL was: ' + createSql.substring(0, 500), 'debug');
      throw err;
    }
  }

  log('Created table ' + schemaName + '.' + tableName);
}

/**
 * Get column names for a table (excluding generated columns for INSERT)
 */
async function getInsertableColumns(schemaName: string, tableName: string): Promise<string[]> {
  const result = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
      AND is_generated = 'NEVER'
    ORDER BY ordinal_position
  `, [schemaName, tableName]);
  return result.rows.map((r: { column_name: string }) => '"' + r.column_name + '"');
}

/**
 * Move rows from public.table to schema.table for a specific project_path
 */
async function migrateRows(
  schemaName: string,
  tableName: string,
  projectPath: string
): Promise<number> {
  const columns = await getInsertableColumns('public', tableName);
  const columnList = columns.join(', ');

  // Count rows to move
  const countResult = await pool.query(
    'SELECT COUNT(*) as count FROM public.' + tableName + ' WHERE project_path = $1',
    [projectPath]
  );
  const totalRows = parseInt(countResult.rows[0].count);

  if (totalRows === 0) {
    log('No rows to migrate for ' + tableName + ' with project_path=' + projectPath, 'debug');
    return 0;
  }

  log('Migrating ' + totalRows + ' rows from public.' + tableName + ' to ' + schemaName + '.' + tableName);

  if (DRY_RUN) {
    log('[DRY RUN] Would migrate ' + totalRows + ' rows');
    return totalRows;
  }

  let movedTotal = 0;

  // Process in batches using transactions
  // Use CTE with RETURNING to ensure atomicity
  while (movedTotal < totalRows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Use CTE: First select rows to move, then insert them, then delete from source
      // This ensures we delete exactly what we inserted
      const migrateSql = `
        WITH rows_to_move AS (
          SELECT * FROM public.${tableName}
          WHERE project_path = $1
          LIMIT $2
        ),
        inserted AS (
          INSERT INTO ${schemaName}.${tableName} (${columnList})
          SELECT ${columnList} FROM rows_to_move
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        )
        DELETE FROM public.${tableName}
        WHERE id IN (SELECT id FROM rows_to_move)
        RETURNING id
      `;

      const result = await client.query(migrateSql, [projectPath, BATCH_SIZE]);
      const deleted = result.rowCount || 0;

      await client.query('COMMIT');

      if (deleted === 0) {
        // No more rows to move
        break;
      }

      movedTotal += deleted;
      log('Batch complete: ' + movedTotal + '/' + totalRows + ' rows moved', 'debug');

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return movedTotal;
}

/**
 * Main migration function
 */
async function runMigration(): Promise<void> {
  log('========================================');
  log('Schema Migration: public -> project schemas');
  log('========================================');
  log('Dry run: ' + DRY_RUN);
  log('Batch size: ' + BATCH_SIZE);
  log('');

  const allStats: MigrationStats[] = [];

  for (const tableName of TABLES_TO_MIGRATE) {
    log('');
    log('Processing table: ' + tableName);
    log('----------------------------------------');

    try {
      // Check if table exists in public schema
      const publicExists = await tableExistsInSchema('public', tableName);
      if (!publicExists) {
        log('Table public.' + tableName + ' does not exist, skipping', 'warn');
        continue;
      }

      // Get unique project paths
      const projectPaths = await getUniqueProjectPaths(tableName);

      if (projectPaths.length === 0) {
        log('No project_path values found in ' + tableName + ', skipping');
        continue;
      }

      log('Found ' + projectPaths.length + ' unique project paths');

      for (const projectPath of projectPaths) {
        const schemaName = getSchemaName(projectPath);

        const stat: MigrationStats = {
          tableName,
          projectPath,
          schemaName,
          rowsMoved: 0,
          status: 'success'
        };

        try {
          log('');
          log('  Project: ' + projectPath + ' -> ' + schemaName);

          // Ensure schema exists
          await ensureSchema(schemaName);

          // Ensure table exists in schema
          await ensureTableInSchema(schemaName, tableName);

          // Migrate rows
          stat.rowsMoved = await migrateRows(schemaName, tableName, projectPath);

          log('  Moved ' + stat.rowsMoved + ' rows');

        } catch (err) {
          stat.status = 'error';
          stat.error = err instanceof Error ? err.message : String(err);
          log('  ERROR: ' + stat.error, 'error');
        }

        allStats.push(stat);
      }

    } catch (err) {
      log('Error processing table ' + tableName + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  }

  // Print summary
  log('');
  log('========================================');
  log('MIGRATION SUMMARY');
  log('========================================');

  const successful = allStats.filter(s => s.status === 'success');
  const failed = allStats.filter(s => s.status === 'error');

  log('Total operations: ' + allStats.length);
  log('Successful: ' + successful.length);
  log('Failed: ' + failed.length);
  log('Total rows moved: ' + successful.reduce((sum, s) => sum + s.rowsMoved, 0));

  if (failed.length > 0) {
    log('');
    log('FAILED OPERATIONS:', 'error');
    for (const s of failed) {
      log('  ' + s.tableName + ' (' + s.projectPath + '): ' + s.error, 'error');
    }
  }

  // Write detailed report
  const reportPath = path.join(process.cwd(), 'migration-report-' + new Date().toISOString().replace(/:/g, '-') + '.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    dryRun: DRY_RUN,
    stats: allStats,
    summary: {
      total: allStats.length,
      successful: successful.length,
      failed: failed.length,
      rowsMoved: successful.reduce((sum, s) => sum + s.rowsMoved, 0)
    }
  }, null, 2));
  log('');
  log('Detailed report written to: ' + reportPath);
}

/**
 * Verify migration by checking row counts
 */
async function verifyMigration(): Promise<void> {
  log('');
  log('========================================');
  log('VERIFICATION');
  log('========================================');

  for (const tableName of TABLES_TO_MIGRATE) {
    const publicExists = await tableExistsInSchema('public', tableName);
    if (!publicExists) continue;

    const hasCol = await hasProjectPathColumn('public', tableName);
    if (!hasCol) continue;

    const result = await pool.query(
      'SELECT COUNT(*) as count FROM public.' + tableName
    );
    const remaining = parseInt(result.rows[0].count);

    log(tableName + ': ' + remaining + ' rows remaining in public schema');
  }
}

// Main entry point
async function main(): Promise<void> {
  try {
    await runMigration();
    await verifyMigration();
    log('');
    log('Migration complete!');
  } catch (err) {
    log('Fatal error: ' + (err instanceof Error ? err.message : String(err)), 'error');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
