/**
 * Database Auto-Setup Module
 *
 * yo this handles automatic database creation and configuration
 * creates users, databases, enables extensions, all that good stuff
 */
// @ts-ignore - pg types not installed
import pg from 'pg';
import { logger } from '../utils/logger.js';
import { generateSecretSauce } from '../config/autoConfig.js';
const { Client } = pg;
/**
 * Test connection to PostgreSQL
 */
export async function testPostgresConnection(host, port, user, password, database = 'postgres') {
    try {
        const client = new Client({
            host,
            port,
            user,
            password,
            database,
            connectionTimeoutMillis: 5000
        });
        await client.connect();
        const result = await client.query('SELECT version()');
        const version = result.rows[0]?.version;
        await client.end();
        logger.info({ host, port, version }, 'postgres connection successful');
        return { connected: true, version };
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.warn({ host, port, error }, 'postgres connection failed');
        return { connected: false, error };
    }
}
/**
 * Detect PostgreSQL admin credentials
 */
export async function detectAdminCredentials(host, port) {
    // Only use environment variables for credentials - no hardcoded passwords
    // Note: password must be string, not undefined, for pg client
    const candidates = [
        // try environment variables (required for security)
        ...(process.env.PGUSER && process.env.PGPASSWORD
            ? [{ user: process.env.PGUSER, password: process.env.PGPASSWORD }]
            : []),
        // try system user with peer auth (no password needed for local connections)
        ...(process.env.USER ? [{ user: process.env.USER, password: '' }] : []),
        // try postgres superuser with peer auth (no password)
        { user: 'postgres', password: '' }
    ];
    for (const cred of candidates) {
        const result = await testPostgresConnection(host, port, cred.user, cred.password);
        if (result.connected) {
            logger.info({ user: cred.user }, 'detected admin credentials');
            return { ...cred, found: true };
        }
    }
    logger.warn('could not detect admin credentials');
    return { user: 'postgres', password: '', found: false };
}
/**
 * Check if database exists
 */
export async function checkDatabaseExists(client, dbName) {
    try {
        const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
        return result.rows.length > 0;
    }
    catch (err) {
        logger.error({ err, dbName }, 'error checking database existence');
        return false;
    }
}
/**
 * Check if user/role exists
 */
export async function checkUserExists(client, userName) {
    try {
        const result = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [userName]);
        return result.rows.length > 0;
    }
    catch (err) {
        logger.error({ err, userName }, 'error checking user existence');
        return false;
    }
}
/**
 * Create database
 */
export async function createDatabase(client, dbName) {
    try {
        // database names cannot be parameterized in DDL, validate strictly
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
            throw new Error('invalid database name: must match [a-zA-Z_][a-zA-Z0-9_]*');
        }
        // Additional length check for PostgreSQL identifier limits
        if (dbName.length > 63) {
            throw new Error('invalid database name: exceeds 63 character limit');
        }
        // Use quoted identifier for safety (double quotes escape the identifier)
        const quotedDbName = `"${dbName.replace(/"/g, '""')}"`;
        await client.query(`CREATE DATABASE ${quotedDbName}`);
        logger.info({ dbName }, 'database created successfully');
        return true;
    }
    catch (err) {
        logger.error({ err, dbName }, 'failed to create database');
        return false;
    }
}
/**
 * Create user/role
 */
export async function createUser(client, userName, password) {
    try {
        // validate username strictly
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(userName)) {
            throw new Error('invalid username: must match [a-zA-Z_][a-zA-Z0-9_]*');
        }
        // Additional length check for PostgreSQL identifier limits
        if (userName.length > 63) {
            throw new Error('invalid username: exceeds 63 character limit');
        }
        // Use quoted identifier for username (double quotes escape the identifier)
        const quotedUserName = `"${userName.replace(/"/g, '""')}"`;
        // Use PostgreSQL format() function with %L for literal escaping to prevent SQL injection
        // This is safer than manual escaping as it handles all edge cases
        await client.query(`DO $$ BEGIN EXECUTE format('CREATE USER ' || $1 || ' WITH PASSWORD %L LOGIN', $2); END $$`, [quotedUserName, password]);
        logger.info({ userName }, 'user created successfully');
        return true;
    }
    catch (err) {
        logger.error({ err, userName }, 'failed to create user');
        return false;
    }
}
/**
 * Update user password
 */
export async function updateUserPassword(client, userName, password) {
    try {
        // validate username strictly
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(userName)) {
            throw new Error('invalid username: must match [a-zA-Z_][a-zA-Z0-9_]*');
        }
        // Additional length check for PostgreSQL identifier limits
        if (userName.length > 63) {
            throw new Error('invalid username: exceeds 63 character limit');
        }
        // Use quoted identifier for username (double quotes escape the identifier)
        const quotedUserName = `"${userName.replace(/"/g, '""')}"`;
        // Use PostgreSQL format() function with %L for literal escaping to prevent SQL injection
        await client.query(`DO $$ BEGIN EXECUTE format('ALTER USER ' || $1 || ' WITH PASSWORD %L', $2); END $$`, [quotedUserName, password]);
        logger.info({ userName }, 'user password updated');
        return true;
    }
    catch (err) {
        logger.error({ err, userName }, 'failed to update user password');
        return false;
    }
}
/**
 * Grant privileges on database to user
 */
export async function grantPrivileges(client, dbName, userName) {
    try {
        // validate names
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName) || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(userName)) {
            throw new Error('invalid database or user name');
        }
        await client.query(`GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${userName}`);
        logger.info({ dbName, userName }, 'privileges granted');
        return true;
    }
    catch (err) {
        logger.error({ err, dbName, userName }, 'failed to grant privileges');
        return false;
    }
}
/**
 * Enable pgvector extension
 */
export async function enablePgvector(client) {
    try {
        await client.query('CREATE EXTENSION IF NOT EXISTS vector');
        logger.info('pgvector extension enabled');
        return true;
    }
    catch (err) {
        logger.error({ err }, 'failed to enable pgvector extension');
        return false;
    }
}
/**
 * Grant schema privileges (needed for pgvector)
 */
export async function grantSchemaPrivileges(client, userName, schemaName = 'public') {
    try {
        // validate names
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(userName) || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName)) {
            throw new Error('invalid user or schema name');
        }
        await client.query(`GRANT ALL ON SCHEMA ${schemaName} TO ${userName}`);
        await client.query(`GRANT ALL ON ALL TABLES IN SCHEMA ${schemaName} TO ${userName}`);
        await client.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA ${schemaName} TO ${userName}`);
        await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaName} GRANT ALL ON TABLES TO ${userName}`);
        await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaName} GRANT ALL ON SEQUENCES TO ${userName}`);
        logger.info({ userName, schemaName }, 'schema privileges granted');
        return true;
    }
    catch (err) {
        logger.error({ err, userName, schemaName }, 'failed to grant schema privileges');
        return false;
    }
}
/**
 * Auto-setup database - full orchestration
 */
export async function autoSetupDatabase(config) {
    logger.info({ config: { ...config, adminPassword: '***', targetPassword: '***' } }, 'starting database auto-setup');
    const result = {
        success: false,
        dbExists: false,
        dbCreated: false,
        userExists: false,
        userCreated: false,
        pgvectorEnabled: false,
        connectionString: ''
    };
    let adminClient = null;
    try {
        // generate password if not provided
        const targetPassword = config.targetPassword || generateSecretSauce(32);
        // Step 1: Connect as admin user
        adminClient = new Client({
            host: config.host,
            port: config.port,
            user: config.adminUser,
            password: config.adminPassword,
            database: 'postgres',
            connectionTimeoutMillis: 5000
        });
        await adminClient.connect();
        logger.info('connected as admin user');
        // Step 2: Check and create database
        result.dbExists = await checkDatabaseExists(adminClient, config.targetDb);
        if (!result.dbExists) {
            logger.info({ dbName: config.targetDb }, 'database does not exist, creating...');
            result.dbCreated = await createDatabase(adminClient, config.targetDb);
            if (!result.dbCreated) {
                throw new Error('failed to create database');
            }
        }
        else {
            logger.info({ dbName: config.targetDb }, 'database already exists');
        }
        // Step 3: Check and create user
        result.userExists = await checkUserExists(adminClient, config.targetUser);
        if (!result.userExists) {
            logger.info({ userName: config.targetUser }, 'user does not exist, creating...');
            result.userCreated = await createUser(adminClient, config.targetUser, targetPassword);
            if (!result.userCreated) {
                throw new Error('failed to create user');
            }
        }
        else {
            logger.info({ userName: config.targetUser }, 'user already exists, updating password...');
            await updateUserPassword(adminClient, config.targetUser, targetPassword);
        }
        // Step 4: Grant privileges
        await grantPrivileges(adminClient, config.targetDb, config.targetUser);
        // Step 5: Connect to target database as admin to enable pgvector
        await adminClient.end();
        adminClient = null;
        adminClient = new Client({
            host: config.host,
            port: config.port,
            user: config.adminUser,
            password: config.adminPassword,
            database: config.targetDb,
            connectionTimeoutMillis: 5000
        });
        await adminClient.connect();
        logger.info('connected to target database as admin');
        // Step 6: Enable pgvector extension (requires superuser)
        result.pgvectorEnabled = await enablePgvector(adminClient);
        // Step 7: Grant schema privileges
        await grantSchemaPrivileges(adminClient, config.targetUser);
        // Step 8: Close admin connection
        await adminClient.end();
        adminClient = null;
        // Success!
        result.success = true;
        result.connectionString = `postgresql://${config.targetUser}:${targetPassword}@${config.host}:${config.port}/${config.targetDb}`;
        result.password = targetPassword;
        logger.info('database auto-setup completed successfully');
        return result;
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error({ err, error }, 'database auto-setup failed');
        result.error = error;
        return result;
    }
    finally {
        // cleanup connections
        if (adminClient !== null) {
            try {
                await adminClient.end();
            }
            catch (err) {
                logger.warn({ err }, 'error closing admin connection');
            }
        }
    }
}
/**
 * Quick database setup with auto-detection
 */
export async function quickSetupDatabase(host = 'localhost', port = 5432, targetDb = process.env['SPECMEM_DB_NAME'] || 'specmem_westayunprofessional', targetUser = process.env['SPECMEM_DB_USER'] || 'specmem_westayunprofessional') {
    logger.info({ host, port, targetDb, targetUser }, 'starting quick database setup');
    // try to detect admin credentials
    const adminCreds = await detectAdminCredentials(host, port);
    if (!adminCreds.found) {
        logger.error('could not detect admin credentials');
        return {
            success: false,
            dbExists: false,
            dbCreated: false,
            userExists: false,
            userCreated: false,
            pgvectorEnabled: false,
            connectionString: '',
            error: 'This needs root bozo xD - Could not detect PostgreSQL admin credentials. Run as postgres user or set PGUSER and PGPASSWORD environment variables.'
        };
    }
    // run auto-setup
    return autoSetupDatabase({
        host,
        port,
        adminUser: adminCreds.user,
        adminPassword: adminCreds.password,
        targetDb,
        targetUser
    });
}
//# sourceMappingURL=dbSetup.js.map