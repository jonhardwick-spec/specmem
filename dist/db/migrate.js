#!/usr/bin/env node
// ayo this is the migration CLI
// run this to setup/update your database schema
// usage: npm run migrate | npm run migrate:rollback | npm run migrate:status
import { loadConfig } from '../config.js';
import { ConnectionPoolGoBrrr } from './connectionPoolGoBrrr.js';
import { BigBrainMigrations } from './bigBrainMigrations.js';
import { logger } from '../utils/logger.js';
import { getProjectSchema } from './projectNamespacing.js';
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] ?? 'up';
    logger.info({ command }, 'starting migration CLI');
    const config = loadConfig();
    const pool = new ConnectionPoolGoBrrr(config.database);
    try {
        await pool.wakeUp();
        // schema isolation - create schema and set search_path BEFORE migrations
        const schemaName = getProjectSchema();
        const safeSchema = '"' + schemaName.replace(/"/g, '""') + '"';
        await pool.queryWithSwag('CREATE SCHEMA IF NOT EXISTS ' + safeSchema);
        await pool.queryWithSwag('SET search_path TO ' + safeSchema + ', public');
        logger.info({ schemaName }, 'Schema isolation: using project schema');
        const migrations = new BigBrainMigrations(pool);
        switch (command) {
            case 'up':
            case '--up':
                // run all pending migrations
                await migrations.runAllMigrations();
                break;
            case 'rollback':
            case '--rollback':
                // rollback the last migration
                await migrations.rollbackLast();
                break;
            case 'status':
            case '--status':
                // show migration status
                const status = await migrations.getStatus();
                logger.info('=== Migration Status ===');
                logger.info('Applied migrations:');
                if (status.applied.length === 0) {
                    logger.info('  (none)');
                }
                else {
                    for (const m of status.applied) {
                        logger.info({ version: m.version, name: m.name, executedAt: m.executedAt.toISOString() }, `  v${m.version}: ${m.name} (${m.executedAt.toISOString()})`);
                    }
                }
                logger.info('Pending migrations:');
                if (status.pending.length === 0) {
                    logger.info('  (none - schema is up to date)');
                }
                else {
                    for (const m of status.pending) {
                        logger.info({ version: m.version, name: m.name }, `  v${m.version}: ${m.name}`);
                    }
                }
                break;
            case 'validate':
            case '--validate':
                // validate migration checksums
                const validation = await migrations.validateMigrations();
                if (validation.valid) {
                    logger.info('All migrations are valid!');
                }
                else {
                    logger.error('Migration validation FAILED:');
                    for (const issue of validation.issues) {
                        logger.error({ issue }, `  - ${issue}`);
                    }
                    process.exit(1);
                }
                break;
            default:
                logger.info(`
Usage: npm run migrate [command]

Commands:
  up (default)    Run all pending migrations
  rollback        Rollback the last migration
  status          Show migration status
  validate        Validate migration checksums
        `);
                break;
        }
    }
    catch (err) {
        logger.error({ err }, 'migration failed');
        process.exit(1);
    }
    finally {
        await pool.shutdown();
    }
}
main();
//# sourceMappingURL=migrate.js.map