/**
 * syncDimensions.ts - Sync embedding dimensions across all tables
 *
 * DEPRECATED: This migration script is now largely obsolete.
 *
 * Embedding dimensions are now AUTO-DETECTED from the database pgvector column.
 * The SPECMEM_EMBEDDING_DIMENSIONS environment variable is DEPRECATED and ignored.
 * The database pg_attribute table is the single source of truth for dimensions.
 *
 * The system auto-migrates when dimension mismatch is detected at startup.
 * See src/dashboard/standalone.ts for auto-migration logic.
 *
 * This script remains for backwards compatibility and manual migration needs.
 *
 * Usage:
 *   npx tsx src/migrations/syncDimensions.ts
 *   npx tsx src/migrations/syncDimensions.ts --dry-run
 *   npx tsx src/migrations/syncDimensions.ts --force
 *
 * @author specmem team
 * @deprecated Dimensions are now auto-detected from database
 */
import { getDatabase } from '../database.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { DimensionService } from '../db/dimensionService.js';
async function syncDimensions(options) {
    const targetDim = DimensionService.getDimension();
    logger.info('='.repeat(60));
    logger.info('EMBEDDING DIMENSION SYNC');
    logger.info('='.repeat(60));
    logger.info({ targetDimension: targetDim }, 'Target dimension from config');
    if (options.dryRun) {
        logger.info('DRY RUN MODE - No changes will be made');
    }
    const db = getDatabase(config.database);
    try {
        await db.initialize();
        // Get current table dimensions
        const tables = await DimensionService.getTableDimensions(db);
        if (tables.length === 0) {
            logger.info('No tables with vector columns found');
            return;
        }
        logger.info({ tableCount: tables.length }, 'Found tables with vector columns');
        logger.info('-'.repeat(60));
        // Report current state
        const needsUpdate = [];
        const upToDate = [];
        for (const table of tables) {
            if (table.dimension !== targetDim) {
                needsUpdate.push(table);
                logger.warn({ table: table.table, column: table.column, current: table.dimension, target: targetDim }, 'NEEDS UPDATE');
            }
            else {
                upToDate.push(table);
                logger.info({ table: table.table, column: table.column, dimension: table.dimension }, 'OK');
            }
        }
        logger.info('-'.repeat(60));
        logger.info({
            upToDate: upToDate.length,
            needsUpdate: needsUpdate.length
        }, 'Summary');
        if (needsUpdate.length === 0) {
            logger.info('All tables are up to date! No changes needed.');
            return;
        }
        if (options.dryRun) {
            logger.info('DRY RUN - Would update the following tables:');
            for (const table of needsUpdate) {
                logger.info(`  - ${table.table}.${table.column}: ${table.dimension} -> ${targetDim}`);
            }
            logger.info('Run without --dry-run to apply changes');
            return;
        }
        // Confirm if not forced
        if (!options.force) {
            logger.warn('='.repeat(60));
            logger.warn('WARNING: This operation will CLEAR existing embeddings!');
            logger.warn('Tables affected:');
            for (const table of needsUpdate) {
                logger.warn(`  - ${table.table}.${table.column}`);
            }
            logger.warn('Run with --force to proceed');
            logger.warn('='.repeat(60));
            return;
        }
        // Perform sync
        logger.info('Starting dimension sync...');
        const result = await DimensionService.syncAllTables(db);
        logger.info('='.repeat(60));
        logger.info('SYNC COMPLETE');
        logger.info('='.repeat(60));
        logger.info({
            total: result.total,
            altered: result.altered,
            skipped: result.skipped,
            errors: result.errors.length
        }, 'Results');
        if (result.errors.length > 0) {
            logger.error('Errors occurred:');
            for (const err of result.errors) {
                logger.error({ table: err.table, error: err.error });
            }
        }
        // Remind about re-indexing
        if (result.altered > 0) {
            logger.warn('='.repeat(60));
            logger.warn('IMPORTANT: You need to re-create HNSW/IVFFlat indexes!');
            logger.warn('Run your embedding pipeline to repopulate vectors.');
            logger.warn('='.repeat(60));
        }
    }
    catch (error) {
        logger.error({ error }, 'Dimension sync failed');
        process.exit(1);
    }
    finally {
        await db.close();
    }
}
// Parse CLI arguments
function parseArgs() {
    const args = process.argv.slice(2);
    return {
        dryRun: args.includes('--dry-run'),
        force: args.includes('--force')
    };
}
// Run
const options = parseArgs();
syncDimensions(options).then(() => {
    logger.info('Dimension sync script finished');
    process.exit(0);
}).catch((error) => {
    logger.error({ error }, 'Script failed');
    process.exit(1);
});
//# sourceMappingURL=syncDimensions.js.map