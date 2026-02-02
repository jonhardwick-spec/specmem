import { getDatabase } from '../database.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
async function runMigrations() {
    logger.info('Starting database migrations...');
    const db = getDatabase(config.database);
    try {
        await db.initialize();
        logger.info('Database schema created/updated successfully');
        const stats = await db.getStats();
        logger.info({ stats }, 'Connection pool status');
        const result = await db.query('SELECT COUNT(*) as count FROM memories');
        logger.info({ memoryCount: result.rows[0]?.count }, 'Current memory count');
    }
    catch (error) {
        logger.error({ error }, 'Migration failed');
        process.exit(1);
    }
    finally {
        await db.close();
    }
    logger.info('Migrations completed successfully');
}
runMigrations();
//# sourceMappingURL=run.js.map