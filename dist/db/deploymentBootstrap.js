/**
 * SpecMem Deployment Bootstrap
 *
 * Auto-creates database users, databases, and schemas on first run.
 * Handles the "cold start" problem where SpecMem needs to set up its own infrastructure.
 *
 * This runs BEFORE the main database initialization and ensures:
 * 1. The database user exists (creates if not)
 * 2. The database exists (creates if not)
 * 3. pgvector extension is installed
 * 4. Schema is ready for table creation
 */
// @ts-ignore - pg types not installed
import pg from 'pg';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../config.js';
const { Client } = pg;
/**
 * Try to connect to PostgreSQL as a superuser.
 * Attempts common superuser configurations.
 */
async function getSuperuserConnection(host, port) {
    // Common superuser configurations to try
    const superuserConfigs = [
        // Try postgres user with no password (common in Docker/local dev)
        { user: 'postgres', password: '', database: 'postgres' },
        // Try postgres user with common passwords
        { user: 'postgres', password: 'postgres', database: 'postgres' },
        // Try from environment
        { user: process.env['PGUSER'] || 'postgres', password: process.env['PGPASSWORD'] || '', database: 'postgres' },
        // Try with SPECMEM superuser password if set
        { user: 'postgres', password: process.env['SPECMEM_SUPERUSER_PASSWORD'] || '', database: 'postgres' },
    ];
    for (const config of superuserConfigs) {
        const client = new Client({
            host,
            port,
            database: config.database,
            user: config.user,
            password: config.password,
            connectionTimeoutMillis: 5000,
        });
        try {
            await client.connect();
            // Check if we have superuser privileges
            const result = await client.query('SELECT current_setting(\'is_superuser\') as is_super');
            if (result.rows[0]?.is_super === 'on') {
                logger.debug({ user: config.user }, 'Connected as superuser for bootstrap');
                return client;
            }
            await client.end();
        }
        catch (err) {
            // Try next configuration
            try {
                await client.end();
            }
            catch { }
        }
    }
    return null;
}
/**
 * Check if a database user exists
 */
async function userExists(client, username) {
    const result = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [username]);
    return result.rows.length > 0;
}
/**
 * Check if a database exists
 */
async function databaseExists(client, dbName) {
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    return result.rows.length > 0;
}
/**
 * Create a database user if it doesn't exist
 */
async function createUserIfNotExists(client, username, password) {
    if (await userExists(client, username)) {
        logger.debug({ username }, 'User already exists');
        return false;
    }
    // Create the user with login privilege
    // Use double-dollar quoting to avoid SQL injection from password
    await client.query(`
    CREATE USER "${username}" WITH
      LOGIN
      PASSWORD '${password.replace(/'/g, "''")}'
      CREATEDB
  `);
    logger.info({ username }, 'Created database user');
    return true;
}
/**
 * Create a database if it doesn't exist
 */
async function createDatabaseIfNotExists(client, dbName, owner) {
    if (await databaseExists(client, dbName)) {
        logger.debug({ dbName }, 'Database already exists');
        return false;
    }
    // Create the database
    await client.query(`CREATE DATABASE "${dbName}" OWNER "${owner}"`);
    logger.info({ dbName, owner }, 'Created database');
    return true;
}
/**
 * Install extensions in a database
 */
async function installExtensions(host, port, dbName, user, password) {
    const client = new Client({
        host,
        port,
        database: dbName,
        user,
        password,
        connectionTimeoutMillis: 5000,
    });
    try {
        await client.connect();
        // Install pgvector
        await client.query('CREATE EXTENSION IF NOT EXISTS vector');
        // Install pg_trgm for fuzzy search
        await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
        // Install btree_gin for combined indexes
        await client.query('CREATE EXTENSION IF NOT EXISTS btree_gin');
        logger.info({ dbName }, 'Installed PostgreSQL extensions');
        return true;
    }
    catch (err) {
        logger.warn({ err, dbName }, 'Failed to install some extensions');
        return false;
    }
    finally {
        try {
            await client.end();
        }
        catch { }
    }
}
/**
 * Fix vector columns that don't have dimensions set.
 * pgvector 0.7+ requires dimensions on vector columns for IVFFlat indexes.
 */
async function fixVectorDimensions(host, port, dbName, user, password, defaultDimension = 384) {
    const client = new Client({
        host,
        port,
        database: dbName,
        user,
        password,
        connectionTimeoutMillis: 5000,
    });
    try {
        await client.connect();
        // Find all vector columns without dimensions
        const result = await client.query(`
      SELECT
        c.relname as table_name,
        a.attname as column_name,
        a.atttypmod as dimension
      FROM pg_attribute a
      JOIN pg_class c ON a.attrelid = c.oid
      JOIN pg_type t ON a.atttypid = t.oid
      WHERE t.typname = 'vector'
        AND a.atttypmod = -1  -- -1 means no dimension specified
        AND c.relkind = 'r'   -- regular tables only
    `);
        for (const row of result.rows) {
            const { table_name, column_name } = row;
            // Check if there are any existing values
            const countResult = await client.query(`SELECT COUNT(*) as cnt FROM "${table_name}" WHERE "${column_name}" IS NOT NULL`);
            const existingCount = parseInt(countResult.rows[0]?.cnt || '0', 10);
            if (existingCount > 0) {
                // Get dimension from existing data
                const dimResult = await client.query(`SELECT vector_dims("${column_name}") as dim FROM "${table_name}" WHERE "${column_name}" IS NOT NULL LIMIT 1`);
                const existingDim = dimResult.rows[0]?.dim || defaultDimension;
                logger.info({ table_name, column_name, dimension: existingDim }, 'Fixing vector column dimension from existing data');
                await client.query(`ALTER TABLE "${table_name}" ALTER COLUMN "${column_name}" TYPE vector(${existingDim})`);
            }
            else {
                // No data, use default dimension
                logger.info({ table_name, column_name, dimension: defaultDimension }, 'Fixing vector column dimension with default');
                await client.query(`ALTER TABLE "${table_name}" ALTER COLUMN "${column_name}" TYPE vector(${defaultDimension})`);
            }
        }
        if (result.rows.length > 0) {
            logger.info({ fixedCount: result.rows.length }, 'Fixed vector column dimensions');
        }
        return true;
    }
    catch (err) {
        logger.warn({ err, dbName }, 'Failed to fix vector dimensions');
        return false;
    }
    finally {
        try {
            await client.end();
        }
        catch { }
    }
}
/**
 * Main bootstrap function - ensures database infrastructure is ready.
 *
 * Call this BEFORE creating the DatabaseManager.
 * It will:
 * 1. Connect as superuser
 * 2. Create the SpecMem user if needed
 * 3. Create the SpecMem database if needed
 * 4. Install required extensions
 * 5. Fix any vector dimension issues
 */
export async function bootstrapDatabase() {
    const config = loadConfig();
    const dbConfig = config.database;
    const result = {
        success: false,
        userCreated: false,
        databaseCreated: false,
        extensionsCreated: false,
        errors: [],
        config: {
            database: dbConfig.database,
            user: dbConfig.user,
            host: dbConfig.host,
            port: dbConfig.port,
        },
    };
    logger.info({
        database: dbConfig.database,
        user: dbConfig.user,
        host: dbConfig.host,
        port: dbConfig.port,
    }, 'Starting database bootstrap...');
    // Try to connect as superuser first
    const superClient = await getSuperuserConnection(dbConfig.host, dbConfig.port);
    if (!superClient) {
        // No superuser access - try to connect directly with configured credentials
        // This works if user/database were created manually
        logger.warn('No superuser access - attempting direct connection with configured credentials');
        const directClient = new Client({
            host: dbConfig.host,
            port: dbConfig.port,
            database: dbConfig.database,
            user: dbConfig.user,
            password: dbConfig.password,
            connectionTimeoutMillis: 5000,
        });
        try {
            await directClient.connect();
            logger.info('Direct connection successful - database/user already exist');
            // Still try to install extensions and fix dimensions
            result.extensionsCreated = await installExtensions(dbConfig.host, dbConfig.port, dbConfig.database, dbConfig.user, dbConfig.password);
            await fixVectorDimensions(dbConfig.host, dbConfig.port, dbConfig.database, dbConfig.user, dbConfig.password);
            result.success = true;
            await directClient.end();
            return result;
        }
        catch (err) {
            result.errors.push(`Cannot connect: ${err.message}`);
            result.errors.push('Neither superuser nor direct connection available');
            try {
                await directClient.end();
            }
            catch { }
            return result;
        }
    }
    try {
        // Create user if needed
        result.userCreated = await createUserIfNotExists(superClient, dbConfig.user, dbConfig.password);
        // Create database if needed
        result.databaseCreated = await createDatabaseIfNotExists(superClient, dbConfig.database, dbConfig.user);
        // Close superuser connection
        await superClient.end();
        // Install extensions in the new database
        result.extensionsCreated = await installExtensions(dbConfig.host, dbConfig.port, dbConfig.database, dbConfig.user, dbConfig.password);
        // Fix vector dimensions
        await fixVectorDimensions(dbConfig.host, dbConfig.port, dbConfig.database, dbConfig.user, dbConfig.password);
        result.success = true;
        logger.info({
            userCreated: result.userCreated,
            databaseCreated: result.databaseCreated,
            extensionsCreated: result.extensionsCreated,
        }, 'Database bootstrap complete');
    }
    catch (err) {
        result.errors.push(err.message);
        logger.error({ err }, 'Database bootstrap failed');
        try {
            await superClient.end();
        }
        catch { }
    }
    return result;
}
/**
 * Quick check if bootstrap is needed.
 * Returns true if we can't connect with configured credentials.
 */
export async function needsBootstrap() {
    const config = loadConfig();
    const dbConfig = config.database;
    const client = new Client({
        host: dbConfig.host,
        port: dbConfig.port,
        database: dbConfig.database,
        user: dbConfig.user,
        password: dbConfig.password,
        connectionTimeoutMillis: 3000,
    });
    try {
        await client.connect();
        await client.query('SELECT 1');
        await client.end();
        return false; // Connection works, no bootstrap needed
    }
    catch {
        try {
            await client.end();
        }
        catch { }
        return true; // Connection failed, needs bootstrap
    }
}
//# sourceMappingURL=deploymentBootstrap.js.map