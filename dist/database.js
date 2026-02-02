// @ts-ignore - pg types not installed
import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './utils/logger.js';
import { getCoordinator } from './coordination/integration.js';
import { loadConfig } from './config.js';
import { getDebugLogger } from './utils/debugLogger.js';
import { getDimensionService } from './services/DimensionService.js';
import { getProjectContext, getProjectPathForInsert } from './services/ProjectContext.js';
import { getProjectSchema, createProjectSchema, setProjectSearchPath, initializeProjectSchema } from './db/projectNamespacing.js';
const { Pool, types } = pg;
types.setTypeParser(1700, parseFloat);
types.setTypeParser(20, parseInt);
/**
 * High-performance PostgreSQL connection manager with intelligent pooling,
 * automatic reconnection, and health monitoring.
 *
 * Now integrated with LWJEB event bus for db:query:start, db:query:complete events
 */
export class DatabaseManager {
    pool;
    config;
    isInitialized = false;
    healthCheckInterval = null;
    queryCounter = 0;
    dimensionService = null;
    currentSchema = null;
    constructor(config) {
        // TASK #21 FIX: Validate database credentials early - fail fast with clear error
        this.validateCredentialsOrThrow(config);
        this.config = config;
        // DEBUG: Log EXACTLY what database we're connecting to (to stderr so it appears in logs)
        const timestamp = new Date().toISOString();
        process.stderr.write('[DB DEBUG ' + timestamp + '] DatabaseConfig: database="' + config.database + '" user="' + config.user + '" host="' + config.host + '" port=' + config.port + '\n');
        process.stderr.write('[DB DEBUG ' + timestamp + '] ENV: SPECMEM_DB_NAME="' + process.env['SPECMEM_DB_NAME'] + '" SPECMEM_DB_USER="' + process.env['SPECMEM_DB_USER'] + '"\n');
        this.pool = this.createPool();
        this.setupPoolEvents();
        // Log project-aware database connection info
        const projectHash = process.env['SPECMEM_PROJECT_HASH'] || 'default';
        logger.info({
            database: config.database,
            host: config.host,
            port: config.port,
            projectHash,
            expectedFormat: 'specmem_' + projectHash
        }, 'DatabaseManager initialized with project-scoped database');
    }
    /**
     * TASK #21 FIX: Validate database credentials before attempting connection.
     * Fail fast with clear error message if credentials are invalid.
     */
    validateCredentialsOrThrow(config) {
        const errors = [];
        // Validate host exists and is not empty
        if (!config.host || config.host.trim().length === 0) {
            errors.push('Database host is missing or empty');
        }
        // Validate port is valid number
        if (!config.port || config.port < 1 || config.port > 65535) {
            errors.push('Database port must be between 1 and 65535, got: ' + config.port);
        }
        // Validate database name exists and is valid format
        if (!config.database || config.database.trim().length === 0) {
            errors.push('Database name is missing or empty');
        }
        else if (config.database.length > 63) {
            errors.push('Database name too long (max 63 chars): ' + config.database.length + ' chars');
        }
        // Validate user exists and is valid format
        if (!config.user || config.user.trim().length === 0) {
            errors.push('Database user is missing or empty');
        }
        else if (config.user.length > 63) {
            errors.push('Database username too long (max 63 chars): ' + config.user.length + ' chars');
        }
        // Validate password exists (can be empty string but not undefined/null)
        if (config.password === undefined || config.password === null) {
            errors.push('Database password is undefined - check SPECMEM_PASSWORD env var');
        }
        else if (config.password.trim().length === 0) {
            // Empty password is allowed but log warning
            logger.warn('Database password is empty - this may cause authentication issues');
        }
        // Check for control characters in password
        if (config.password && /[\x00-\x1f]/.test(config.password)) {
            errors.push('Database password contains control characters (ASCII 0-31)');
        }
        // If any errors, throw with all error messages
        if (errors.length > 0) {
            const errorMsg = 'Database credential validation failed:\n  - ' + errors.join('\n  - ');
            logger.error({ errors, config: { host: config.host, port: config.port, database: config.database, user: config.user } }, errorMsg);
            throw new Error(errorMsg);
        }
        logger.debug({
            host: config.host,
            port: config.port,
            database: config.database,
            user: config.user,
            passwordLength: config.password?.length || 0
        }, 'Database credentials validated successfully');
    }
    /**
     * Get the current project schema name.
     * Returns null if schema isolation hasn't been initialized yet.
     */
    getCurrentSchema() {
        return this.currentSchema;
    }
    /**
     * Get the project schema name for the current project path.
     * Uses SPECMEM_PROJECT_PATH env var or defaults to 'specmem_default'.
     */
    getProjectSchemaName() {
        return getProjectSchema();
    }
    /**
     * Get the DimensionService for this database manager.
     * Lazily initializes the service on first access.
     */
    getDimensionService() {
        if (!this.dimensionService) {
            this.dimensionService = getDimensionService(this);
        }
        return this.dimensionService;
    }
    /**
     * Get the underlying pg.Pool for direct access
     * Used by team comms and other services that need raw pool access
     */
    getPool() {
        return this.pool;
    }
    /**
     * Generate unique query ID for event tracking
     */
    generateQueryId() {
        return `q_${Date.now()}_${++this.queryCounter}`;
    }
    /**
     * Detect query type from SQL text
     */
    detectQueryType(sql) {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('SELECT'))
            return 'SELECT';
        if (trimmed.startsWith('INSERT'))
            return 'INSERT';
        if (trimmed.startsWith('UPDATE'))
            return 'UPDATE';
        if (trimmed.startsWith('DELETE'))
            return 'DELETE';
        if (trimmed.startsWith('BEGIN') || trimmed.startsWith('COMMIT') || trimmed.startsWith('ROLLBACK'))
            return 'TRANSACTION';
        return 'OTHER';
    }
    /**
     * Extract table name from SQL (basic heuristic)
     */
    extractTableName(sql) {
        const patterns = [
            /FROM\s+(\w+)/i,
            /INTO\s+(\w+)/i,
            /UPDATE\s+(\w+)/i,
            /DELETE\s+FROM\s+(\w+)/i
        ];
        for (const pattern of patterns) {
            const match = sql.match(pattern);
            if (match && match[1])
                return match[1];
        }
        return undefined;
    }
    createPool() {
        return new Pool({
            host: this.config.host,
            port: this.config.port,
            database: this.config.database,
            user: this.config.user,
            password: this.config.password,
            max: this.config.maxConnections,
            idleTimeoutMillis: this.config.idleTimeout,
            connectionTimeoutMillis: this.config.connectionTimeout,
            ssl: this.config.ssl
        });
    }
    setupPoolEvents() {
        this.pool.on('error', (err) => {
            logger.error({ err }, 'Unexpected pool error');
        });
        // SCHEMA ISOLATION FIX: pool.on('connect') doesn't wait for async callbacks!
        // The client is returned to the caller before await completes.
        // We still set search_path here for defense-in-depth, but critical paths
        // must use ensureSearchPath() explicitly to guarantee isolation.
        this.pool.on('connect', (client) => {
            logger.debug('New client connected to pool');
            // If we have a current schema, set search_path on this new connection
            // NOTE: This is fire-and-forget because pg doesn't await connect handlers
            // Critical code paths should call ensureSearchPath() explicitly
            if (this.currentSchema) {
                // Use quoted identifier format for safety - prevents SQL injection
                client.query('SET search_path TO "' + this.currentSchema.replace(/"/g, '""') + '", public')
                    .then(() => {
                    logger.debug({ schema: this.currentSchema }, 'Set search_path on new pool connection');
                })
                    .catch((error) => {
                    // CRITICAL: Log error but continue - the connection may still work for public schema
                    // Callers using ensureSearchPath() will set it correctly
                    logger.error({ error, schema: this.currentSchema }, 'RACE: Failed to set search_path on new connection - critical queries must use ensureSearchPath()');
                });
            }
        });
        this.pool.on('remove', () => {
            logger.debug('Client removed from pool');
        });
    }
    async initialize() {
        if (this.isInitialized)
            return;
        let poolEnded = false; // HIGH-19 FIX: Track if pool was ended during error handling
        // CRITICAL FIX: Initialize schema isolation FIRST before acquiring ANY client
        // This ensures the pool's on('connect') hook has currentSchema set, so ALL
        // connections (including the first one) get proper search_path
        try {
            await this.initializeProjectSchemaIsolation();
        }
        catch (schemaError) {
            const errMsg = schemaError instanceof Error ? schemaError.message : String(schemaError);
            // HIGH-19 FIX: Check if error message indicates pool was already ended
            if (errMsg.includes('Pool ended') || errMsg.includes('Cannot use a pool after calling end')) {
                poolEnded = true;
            }
            // Check if this is a permission error (including ownership issues)
            if (errMsg.includes('permission denied') || errMsg.includes('CREATE') || errMsg.includes('must be owner')) {
                logger.warn({ error: errMsg }, 'Permission/ownership error during schema init - attempting auto-fix...');
                // HIGH-19 FIX: Recreate pool if it was ended
                if (poolEnded) {
                    this.pool = this.createPool();
                    this.setupPoolEvents();
                    poolEnded = false;
                }
                // Try to fix permissions automatically
                const fixed = await this.autoFixDatabasePermissions();
                if (fixed) {
                    logger.info('Permissions fixed, retrying schema initialization...');
                    await this.initializeProjectSchemaIsolation();
                }
                else {
                    throw schemaError; // Re-throw if we couldn't fix
                }
            }
            else {
                throw schemaError; // Not a permission error, re-throw
            }
        }
        // NOW acquire client - it will have search_path set from on('connect') hook
        const client = await this.pool.connect();
        try {
            await client.query('SELECT 1');
            // Extensions must be in public schema
            await this.ensureExtensions(client);
            // Create tables in the project schema
            try {
                await this.ensureSchema(client);
            }
            catch (ensureError) {
                const errMsg = ensureError instanceof Error ? ensureError.message : String(ensureError);
                // Check if this is an ownership error
                if (errMsg.includes('must be owner') || errMsg.includes('permission denied')) {
                    logger.warn({ error: errMsg }, 'Ownership/permission error during ensureSchema - attempting auto-fix...');
                    const fixed = await this.autoFixDatabasePermissions();
                    if (fixed) {
                        logger.info('Permissions/ownership fixed, retrying ensureSchema...');
                        await this.ensureSchema(client); // Retry after fix
                    }
                    else {
                        throw ensureError; // Re-throw if we couldn't fix
                    }
                }
                else {
                    throw ensureError; // Not a permission/ownership error, re-throw
                }
            }
            this.isInitialized = true;
            this.startHealthCheck();
            logger.info({
                schema: this.currentSchema,
                projectPath: process.env['SPECMEM_PROJECT_PATH'] || 'default'
            }, 'Database initialized successfully with project schema isolation');
        }
        finally {
            // HIGH-19 FIX: Only release client if pool wasn't ended during error handling
            if (!poolEnded) {
                try {
                    client.release();
                }
                catch (releaseErr) {
                    // Pool might have been ended - this is expected in some error paths
                    logger.debug({ releaseErr }, 'client.release() failed - pool may have been ended');
                }
            }
        }
    }
    /**
     * Attempt to automatically fix database permissions.
     * Uses sudo to grant necessary privileges via postgres superuser.
     *
     * This handles the case where specmem was installed but permissions
     * weren't properly set up, or when running multi-project isolation
     * for the first time.
     */
    async autoFixDatabasePermissions() {
        const { execSync } = await import('child_process');
        const dbName = this.config.database;
        const userName = this.config.user;
        logger.info({ dbName, userName }, 'Auto-fixing database permissions...');
        try {
            // Grant all privileges on the database
            execSync(`sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${userName};" 2>/dev/null`, {
                stdio: 'pipe',
                timeout: 10000
            });
            // Grant CREATE permission (needed for schema creation)
            execSync(`sudo -u postgres psql -d ${dbName} -c "GRANT CREATE ON DATABASE ${dbName} TO ${userName};" 2>/dev/null`, {
                stdio: 'pipe',
                timeout: 10000
            });
            // Grant schema privileges
            execSync(`sudo -u postgres psql -d ${dbName} -c "GRANT ALL ON SCHEMA public TO ${userName};" 2>/dev/null`, {
                stdio: 'pipe',
                timeout: 10000
            });
            // Grant CREATEDB for multi-project isolation
            execSync(`sudo -u postgres psql -c "ALTER USER ${userName} CREATEDB;" 2>/dev/null`, {
                stdio: 'pipe',
                timeout: 10000
            });
            // Grant ALL on ALL tables in public schema (for existing tables)
            execSync(`sudo -u postgres psql -d ${dbName} -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO ${userName};" 2>/dev/null`, {
                stdio: 'pipe',
                timeout: 10000
            });
            // Grant ALL on ALL sequences (needed for serial/identity columns)
            execSync(`sudo -u postgres psql -d ${dbName} -c "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${userName};" 2>/dev/null`, {
                stdio: 'pipe',
                timeout: 10000
            });
            // Set default privileges for future tables
            execSync(`sudo -u postgres psql -d ${dbName} -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${userName};" 2>/dev/null`, {
                stdio: 'pipe',
                timeout: 10000
            });
            execSync(`sudo -u postgres psql -d ${dbName} -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${userName};" 2>/dev/null`, {
                stdio: 'pipe',
                timeout: 10000
            });
            // CRITICAL: Reassign ownership of ALL tables to specmem user
            // This is required for DDL operations (ALTER TABLE) during schema migrations
            execSync(`sudo -u postgres psql -d ${dbName} -c "DO \\$\\$ DECLARE r RECORD; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' OWNER TO ${userName}'; END LOOP; END \\$\\$;" 2>/dev/null`, {
                stdio: 'pipe',
                timeout: 30000
            });
            // Reassign ownership of ALL sequences to specmem user
            execSync(`sudo -u postgres psql -d ${dbName} -c "DO \\$\\$ DECLARE r RECORD; BEGIN FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP EXECUTE 'ALTER SEQUENCE public.' || quote_ident(r.sequencename) || ' OWNER TO ${userName}'; END LOOP; END \\$\\$;" 2>/dev/null`, {
                stdio: 'pipe',
                timeout: 30000
            });
            // Set default owner for future objects created by postgres
            execSync(`sudo -u postgres psql -d ${dbName} -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO ${userName};" 2>/dev/null`, {
                stdio: 'pipe',
                timeout: 10000
            });
            logger.info('Database permissions AND ownership fixed successfully');
            return true;
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.warn({ error: errMsg }, 'Auto-fix failed - may need manual permission setup. Run: sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE specmem_westayunprofessional TO specmem_westayunprofessional; ALTER USER specmem_westayunprofessional CREATEDB;"');
            return false;
        }
    }
    /**
     * Initialize project schema isolation.
     * Creates the project-specific schema and sets search_path.
     *
     * This enables multi-instance support where each project has its own
     * isolated set of tables within a PostgreSQL schema.
     */
    async initializeProjectSchemaIsolation() {
        const projectPath = process.env['SPECMEM_PROJECT_PATH'];
        const schemaName = getProjectSchema(projectPath);
        logger.info({
            schemaName,
            projectPath: projectPath || 'default'
        }, 'Initializing project schema isolation');
        // Create schema if it doesn't exist
        const created = await createProjectSchema(this, schemaName);
        if (created) {
            logger.info({ schemaName }, 'Created new project schema');
        }
        // Set currentSchema FIRST so on('connect') handler can use it for new connections
        // This ensures ANY new connections created during initialization get correct search_path
        this.currentSchema = schemaName;
        // Set search_path to use the project schema first, then public
        await setProjectSearchPath(this, schemaName);
        // CRITICAL: Initialize tables in the schema
        // This runs projectSchemaInit.sql to create memories, code_pointers, etc.
        await initializeProjectSchema(this, projectPath);
        logger.debug({ schemaName }, 'Project schema isolation configured with tables');
    }
    /**
     * Ensure search_path is set for a specific connection.
     * CRITICAL: Call this when you need to GUARANTEE schema isolation for a query.
     * The pool.on('connect') handler is fire-and-forget, so this must be called
     * explicitly before any query that requires the correct schema.
     *
     * @param client - Optional pg.PoolClient to set path on, uses pool if not provided
     */
    async ensureSearchPath(client) {
        const schemaName = this.currentSchema || getProjectSchema();
        // Use quoted identifier format for safety - prevents SQL injection
        const safeSchema = '"' + schemaName.replace(/"/g, '""') + '"';
        if (client) {
            await client.query('SET search_path TO ' + safeSchema + ', public');
        }
        else {
            await this.query('SET search_path TO ' + safeSchema + ', public');
        }
        logger.trace({ schemaName }, 'search_path explicitly set');
    }
    /**
     * Check if database has been initialized
     * Used by startup timing to avoid double-init
     */
    isConnected() {
        return this.isInitialized;
    }
    async ensureExtensions(client) {
        await client.query('CREATE EXTENSION IF NOT EXISTS vector');
        await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
        await client.query('CREATE EXTENSION IF NOT EXISTS btree_gin');
    }
    async ensureSchema(client) {
        // CRITICAL: Ensure search_path is set BEFORE any DDL operations
        // The pool's on('connect') handler is async and may not complete before this runs
        // Without this, tables may be created in 'public' schema instead of project schema
        await this.ensureSearchPath(client);
        await client.query(`
      DO $$ BEGIN
        CREATE TYPE memory_type AS ENUM ('episodic', 'semantic', 'procedural', 'working', 'consolidated');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
        await client.query(`
      DO $$ BEGIN
        CREATE TYPE importance_level AS ENUM ('critical', 'high', 'medium', 'low', 'trivial');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
        // Check if memories table already exists and get its current dimension
        const existingDim = await this.getTableDimension('memories');
        if (existingDim !== null) {
            // Table exists with a dimension - ensure all columns exist (schema migrations)
            logger.debug({ existingDim }, 'memories table already exists with vector dimension');
            // Auto-add missing columns that may have been added in newer versions
            // Note: Cannot add NOT NULL columns without defaults via ALTER TABLE to existing data
            // Note: Cannot add GENERATED ALWAYS columns via simple ALTER TABLE (would need complex migration)
            await client.query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS memory_type memory_type DEFAULT 'semantic'`);
            await client.query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS importance importance_level DEFAULT 'medium'`);
            await client.query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'`);
            await client.query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`);
            await client.query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding vector(384)`);
            await client.query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS image_data BYTEA`);
            await client.query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS image_mime_type VARCHAR(50)`);
            await client.query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
            await client.query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
            await client.query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS access_count INTEGER DEFAULT 0`);
            await client.query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ`);
            await client.query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);
            await client.query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS consolidated_from UUID[] DEFAULT '{}'`);
            await client.query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS role VARCHAR(20)`);
            await client.query(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS project_path TEXT`);
            logger.info('Ensured all required columns exist in memories table');
        }
        else {
            // Table doesn't exist - create with a placeholder dimension
            // The actual dimension will be set on first embedding insert
            // Using a function to defer dimension until first use
            await client.query(`
        CREATE TABLE IF NOT EXISTS memories (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          content TEXT NOT NULL,
          content_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
          memory_type memory_type NOT NULL DEFAULT 'semantic',
          importance importance_level NOT NULL DEFAULT 'medium',
          tags TEXT[] NOT NULL DEFAULT '{}',
          metadata JSONB DEFAULT '{}',
          embedding vector(384),
          image_data BYTEA,
          image_mime_type VARCHAR(50),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          access_count INTEGER NOT NULL DEFAULT 0,
          last_accessed_at TIMESTAMPTZ,
          expires_at TIMESTAMPTZ,
          consolidated_from UUID[] DEFAULT '{}',
          role VARCHAR(20),
          project_path TEXT,
          CONSTRAINT content_length CHECK (length(content) <= 1000000),
          CONSTRAINT valid_image CHECK (
            (image_data IS NULL AND image_mime_type IS NULL) OR
            (image_data IS NOT NULL AND image_mime_type IS NOT NULL)
          )
        )
      `);
            logger.info('Created memories table with unbounded vector column (will be set on first insert)');
        }
        await client.query(`
      CREATE TABLE IF NOT EXISTS memory_relations (
        source_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        target_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        relation_type VARCHAR(50) DEFAULT 'related',
        strength FLOAT DEFAULT 1.0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (source_id, target_id),
        CONSTRAINT no_self_relation CHECK (source_id != target_id)
      )
    `);
        // Auto-add missing columns to memory_relations table (schema migration support)
        // Note: source_id and target_id are part of PRIMARY KEY, cannot be added via ALTER TABLE
        await client.query(`ALTER TABLE memory_relations ADD COLUMN IF NOT EXISTS relation_type VARCHAR(50) DEFAULT 'related'`);
        await client.query(`ALTER TABLE memory_relations ADD COLUMN IF NOT EXISTS strength FLOAT DEFAULT 1.0`);
        await client.query(`ALTER TABLE memory_relations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memories_content_tsv ON memories USING gin(content_tsv)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories USING gin(tags)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memories_expires ON memories(expires_at) WHERE expires_at IS NOT NULL`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memories_access ON memories(last_accessed_at DESC NULLS LAST)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memory_relations_target ON memory_relations(target_id)`);
        // HIGH-09 FIX: Add missing project_path index - this column was added but never indexed
        // Critical for cross-project queries and filtering by project
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memories_project_path ON memories(project_path)`);
        // Composite indexes for common project_path query patterns
        // These optimize the most frequent query combinations
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memories_project_path_created ON memories(project_path, created_at DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memories_project_path_importance ON memories(project_path, importance)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memories_project_path_type ON memories(project_path, memory_type)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memories_project_path_hash ON memories(project_path, content_hash)`);
        await client.query(`
      CREATE OR REPLACE FUNCTION update_modified_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
        await client.query(`
      DO $$ BEGIN
        CREATE TRIGGER memories_updated_at
          BEFORE UPDATE ON memories
          FOR EACH ROW
          EXECUTE FUNCTION update_modified_column();
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    }
    startHealthCheck() {
        this.healthCheckInterval = setInterval(async () => {
            try {
                await this.pool.query('SELECT 1');
            }
            catch (err) {
                logger.error({ err }, 'Health check failed');
            }
        }, 30_000);
    }
    async query(text, params) {
        const queryId = this.generateQueryId();
        const queryType = this.detectQueryType(text);
        const tableName = this.extractTableName(text);
        // Get coordinator lazily to avoid circular dependency during initialization
        let coordinator = null;
        try {
            coordinator = getCoordinator();
        }
        catch (e) {
            // Coordinator not yet initialized - skip events, this is expected during startup
        }
        // Emit db:query:start event via LWJEB
        coordinator?.emitDBQueryStart(queryId, queryType, tableName);
        const start = Date.now();
        let success = true;
        let errorMsg;
        let rowsAffected;
        try {
            const result = await this.pool.query(text, params);
            rowsAffected = result.rowCount ?? undefined;
            const duration = Date.now() - start;
            // Emit db:query:complete event via LWJEB
            coordinator?.emitDBQueryComplete(queryId, queryType, duration, true, rowsAffected);
            // Slow query threshold configurable via SPECMEM_SLOW_QUERY_MS (default 500ms)
            const slowQueryThreshold = parseInt(process.env['SPECMEM_SLOW_QUERY_MS'] || '500', 10);
            if (duration > slowQueryThreshold) {
                logger.warn({ duration, threshold: slowQueryThreshold, query: text.slice(0, 100) }, 'Slow query detected fr fr');
            }
            // Debug logging for all queries when enabled
            getDebugLogger().dbQuery(text, duration, true);
            return result;
        }
        catch (error) {
            success = false;
            errorMsg = error instanceof Error ? error.message : String(error);
            const duration = Date.now() - start;
            // Emit db:query:complete event with error via LWJEB
            coordinator?.emitDBQueryComplete(queryId, queryType, duration, false, undefined, errorMsg);
            throw error;
        }
    }
    /**
     * Execute query with GUARANTEED schema isolation.
     * Use this for queries where schema isolation is critical and cannot risk the
     * pool.on('connect') race condition.
     *
     * This acquires a dedicated client, sets search_path, runs the query, and releases.
     * Slightly more expensive than query() but guarantees correct schema.
     */
    async safeQuery(text, params) {
        const client = await this.pool.connect();
        try {
            await this.ensureSearchPath(client);
            return await client.query(text, params);
        }
        finally {
            client.release();
        }
    }
    async transaction(callback) {
        const queryId = this.generateQueryId();
        // Get coordinator lazily to avoid circular dependency during initialization
        let coordinator = null;
        try {
            coordinator = getCoordinator();
        }
        catch (e) {
            // Coordinator not yet initialized - skip events, this is expected during startup
        }
        // Emit db:query:start event for transaction via LWJEB
        coordinator?.emitDBQueryStart(queryId, 'TRANSACTION', undefined);
        const start = Date.now();
        const client = await this.pool.connect();
        try {
            // SCHEMA ISOLATION FIX: Ensure search_path BEFORE BEGIN to guarantee correct schema
            await this.ensureSearchPath(client);
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            const duration = Date.now() - start;
            // Emit db:query:complete event for transaction via LWJEB
            coordinator?.emitDBQueryComplete(queryId, 'TRANSACTION', duration, true);
            return result;
        }
        catch (err) {
            // HIGH-07 FIX: Wrap ROLLBACK in try-catch to preserve original error
            // If ROLLBACK throws, we still want to surface the original error that caused it
            try {
                await client.query('ROLLBACK');
            }
            catch (rollbackErr) {
                // Log rollback error separately but don't let it mask the original error
                logger.error({ rollbackErr, originalErr: err instanceof Error ? err.message : String(err) }, 'ROLLBACK failed - original error preserved, this is double cooked fr');
            }
            const duration = Date.now() - start;
            // Emit db:query:complete event for failed transaction via LWJEB
            coordinator?.emitDBQueryComplete(queryId, 'TRANSACTION', duration, false, undefined, err instanceof Error ? err.message : String(err));
            throw err;
        }
        finally {
            client.release();
        }
    }
    async batchInsert(memories) {
        if (memories.length === 0)
            return [];
        // Get the current table dimension (may be null if unbounded or table doesn't exist)
        const tableDim = await this.getTableDimension('memories');
        const dimService = this.getDimensionService();
        // Find the first memory with an embedding to determine expected dimension
        const firstWithEmbedding = memories.find(m => m.embedding && m.embedding.length > 0);
        const expectedDim = firstWithEmbedding?.embedding?.length;
        // If table is unbounded and we have embeddings, set the dimension now
        if (tableDim === null && expectedDim !== undefined) {
            await this.alterVectorColumnDimension('memories', 'embedding', expectedDim);
            logger.info({ dimension: expectedDim }, 'Set memories table vector dimension from first embedding');
        }
        const ids = [];
        const batchSize = 500;
        for (let i = 0; i < memories.length; i += batchSize) {
            const batch = memories.slice(i, i + batchSize);
            const batchIds = await this.transaction(async (client) => {
                const insertedIds = [];
                for (const memory of batch) {
                    // Prepare embedding with automatic dimension projection if needed
                    let embeddingStr = null;
                    if (memory.embedding && memory.embedding.length > 0) {
                        try {
                            const prepared = await dimService.validateAndPrepare('memories', memory.embedding, memory.content);
                            if (prepared.wasModified) {
                                logger.debug({
                                    action: prepared.action,
                                    originalDim: memory.embedding.length,
                                    newDim: prepared.embedding.length
                                }, 'Projected memory embedding to target dimension');
                            }
                            embeddingStr = `[${prepared.embedding.join(',')}]`;
                        }
                        catch (error) {
                            // Fallback to original embedding if projection fails
                            logger.warn({ error }, 'Failed to prepare embedding, using original');
                            embeddingStr = `[${memory.embedding.join(',')}]`;
                        }
                    }
                    const id = uuidv4();
                    // PROJECT ISOLATION: Get fresh project path at call time
                    const projectPath = getProjectPathForInsert();
                    await client.query(`INSERT INTO memories (id, content, memory_type, importance, tags, metadata, embedding, image_data, image_mime_type, expires_at, project_path)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [
                        id,
                        memory.content,
                        memory.memoryType,
                        memory.importance,
                        memory.tags,
                        memory.metadata ?? {},
                        embeddingStr,
                        memory.imageData ? Buffer.from(memory.imageData, 'base64') : null,
                        memory.imageMimeType ?? null,
                        memory.expiresAt ?? null,
                        projectPath
                    ]);
                    insertedIds.push(id);
                }
                return insertedIds;
            });
            ids.push(...batchIds);
        }
        return ids;
    }
    /**
     * Alter a vector column's dimension dynamically.
     * This will fail if there are existing embeddings with different dimensions.
     *
     * @param tableName - Table containing the vector column
     * @param columnName - Name of the vector column
     * @param dimension - New dimension to set
     */
    async alterVectorColumnDimension(tableName, columnName, dimension) {
        // Validate dimension is reasonable
        if (dimension < 1 || dimension > 10000) {
            throw new Error(`Invalid dimension ${dimension}: must be between 1 and 10000`);
        }
        try {
            await this.query(`ALTER TABLE ${tableName} ALTER COLUMN ${columnName} TYPE vector(${dimension})`);
            logger.info({ tableName, columnName, dimension }, 'Altered vector column dimension');
            // Invalidate dimension cache
            this.getDimensionService().invalidateTable(tableName);
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error({ error: errMsg, tableName, columnName, dimension }, 'Failed to alter vector column dimension');
            throw error;
        }
    }
    async getStats() {
        return {
            total: this.pool.totalCount,
            idle: this.pool.idleCount,
            waiting: this.pool.waitingCount
        };
    }
    /**
     * Get detailed pool metrics for /api/metrics/database endpoint
     */
    async getDetailedMetrics() {
        return {
            pool: await this.getStats(),
            config: {
                maxConnections: this.config.maxConnections,
                idleTimeout: this.config.idleTimeout,
                connectionTimeout: this.config.connectionTimeout
            },
            health: {
                isInitialized: this.isInitialized,
                queryCount: this.queryCounter
            }
        };
    }
    /**
     * Get the embedding vector dimension for a table.
     * Returns the actual dimension from pg_attribute (atttypmod for pgvector).
     * Returns null if table doesn't exist or doesn't have an embedding column.
     */
    async getTableDimension(tableName) {
        try {
            const result = await this.query(`SELECT atttypmod FROM pg_attribute
         WHERE attrelid = $1::regclass AND attname = 'embedding'`, [tableName]);
            if (result.rows.length === 0) {
                logger.warn({ tableName }, 'Table has no embedding column');
                return null;
            }
            const dim = result.rows[0].atttypmod;
            logger.debug({ tableName, dimension: dim }, 'Detected table embedding dimension');
            return dim;
        }
        catch (error) {
            logger.error({ error, tableName }, 'Failed to get table dimension');
            return null;
        }
    }
    async close() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        await this.pool.end();
        this.isInitialized = false;
        logger.info('Database connection closed');
    }
    // ============================================
    // PROJECT NAMESPACING HELPERS
    // ============================================
    /**
     * Get the ProjectContext singleton for this database manager.
     * Initializes the connection on first access.
     */
    getProjectContext() {
        const ctx = getProjectContext();
        ctx.setDatabase(this);
        return ctx;
    }
    /**
     * Execute a query with automatic project_id filtering.
     *
     * Automatically adds project_id filter to WHERE clause:
     * - If SQL has WHERE, adds "AND project_id = $N"
     * - If SQL has no WHERE, adds "WHERE project_id = $N"
     *
     * @param sql - The SQL query (SELECT, UPDATE, or DELETE)
     * @param params - Query parameters (project_id will be appended)
     * @returns Query result with rows filtered by current project
     *
     * @example
     * // Instead of:
     * db.query('SELECT * FROM memories WHERE tags @> $1', [['important']]);
     * // Use:
     * db.queryWithProject('SELECT * FROM memories WHERE tags @> $1', [['important']]);
     * // Becomes: SELECT * FROM memories WHERE tags @> $1 AND project_id = $2
     */
    async queryWithProject(sql, params = []) {
        const projectCtx = this.getProjectContext();
        const projectId = await projectCtx.getProjectId();
        // Clone params to avoid mutating the original
        const newParams = [...params];
        const paramIndex = newParams.length + 1;
        newParams.push(projectId);
        // Determine where to insert the project_id filter
        const modifiedSql = this.addProjectFilter(sql, paramIndex);
        logger.debug({
            originalSql: sql.slice(0, 100),
            modifiedSql: modifiedSql.slice(0, 150),
            projectId
        }, 'queryWithProject');
        return this.query(modifiedSql, newParams);
    }
    /**
     * Insert a record with automatic project_id inclusion.
     *
     * Automatically adds project_id to the insert data.
     *
     * @param table - Table name to insert into
     * @param data - Record data (project_id will be added automatically)
     * @returns The inserted record with generated fields (id, created_at, etc.)
     *
     * @example
     * // Instead of:
     * db.query('INSERT INTO memories (content, tags, project_id) VALUES ($1, $2, $3)', [content, tags, projectId]);
     * // Use:
     * db.insertWithProject('memories', { content, tags });
     */
    async insertWithProject(table, data) {
        const projectCtx = this.getProjectContext();
        const projectId = await projectCtx.getProjectId();
        // Add project_id to the data
        const dataWithProject = { ...data, project_id: projectId };
        // Build column and value lists
        const columns = Object.keys(dataWithProject);
        const values = Object.values(dataWithProject);
        const placeholders = columns.map((_, i) => `$${i + 1}`);
        const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
        logger.debug({
            table,
            columns,
            projectId
        }, 'insertWithProject');
        const result = await this.query(sql, values);
        return result.rows[0];
    }
    /**
     * Update records with automatic project_id filtering.
     *
     * Ensures updates only affect records in the current project.
     *
     * @param table - Table name to update
     * @param data - Fields to update
     * @param whereClause - Additional WHERE conditions (e.g., "id = $1")
     * @param whereParams - Parameters for the WHERE clause
     * @returns Number of rows affected
     *
     * @example
     * db.updateWithProject('memories', { importance: 'high' }, 'id = $1', [memoryId]);
     */
    async updateWithProject(table, data, whereClause, whereParams = []) {
        const projectCtx = this.getProjectContext();
        const projectId = await projectCtx.getProjectId();
        // Build SET clause
        const setEntries = Object.entries(data);
        const setClauses = setEntries.map((_, i) => {
            const colName = setEntries[i][0];
            return `${colName} = $${i + 1}`;
        });
        const setValues = setEntries.map(([_, v]) => v);
        // Calculate parameter offset for WHERE clause
        const whereOffset = setEntries.length;
        // Adjust WHERE clause parameter numbers
        const adjustedWhere = whereClause.replace(/\$(\d+)/g, (_, num) => {
            return `$${parseInt(num) + whereOffset}`;
        });
        // Add project_id filter
        const projectParamIndex = whereOffset + whereParams.length + 1;
        const finalWhere = `${adjustedWhere} AND project_id = $${projectParamIndex}`;
        const sql = `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${finalWhere}`;
        const allParams = [...setValues, ...whereParams, projectId];
        logger.debug({
            table,
            sql: sql.slice(0, 150),
            projectId
        }, 'updateWithProject');
        const result = await this.query(sql, allParams);
        return result.rowCount ?? 0;
    }
    /**
     * Delete records with automatic project_id filtering.
     *
     * Ensures deletes only affect records in the current project.
     *
     * @param table - Table name to delete from
     * @param whereClause - WHERE conditions (e.g., "id = $1")
     * @param whereParams - Parameters for the WHERE clause
     * @returns Number of rows deleted
     *
     * @example
     * db.deleteWithProject('memories', 'id = $1', [memoryId]);
     */
    async deleteWithProject(table, whereClause, whereParams = []) {
        const projectCtx = this.getProjectContext();
        const projectId = await projectCtx.getProjectId();
        // Add project_id filter
        const projectParamIndex = whereParams.length + 1;
        const finalWhere = `${whereClause} AND project_id = $${projectParamIndex}`;
        const sql = `DELETE FROM ${table} WHERE ${finalWhere}`;
        const allParams = [...whereParams, projectId];
        logger.debug({
            table,
            sql,
            projectId
        }, 'deleteWithProject');
        const result = await this.query(sql, allParams);
        return result.rowCount ?? 0;
    }
    /**
     * Add project_id filter to a SQL query.
     * Handles both queries with and without existing WHERE clause.
     *
     * @param sql - Original SQL query
     * @param paramIndex - Parameter index to use for project_id
     * @returns Modified SQL with project_id filter
     */
    addProjectFilter(sql, paramIndex) {
        const sqlUpper = sql.toUpperCase();
        const projectFilter = `project_id = $${paramIndex}`;
        // Find positions of key clauses
        const wherePos = sqlUpper.indexOf(' WHERE ');
        const groupByPos = sqlUpper.indexOf(' GROUP BY ');
        const orderByPos = sqlUpper.indexOf(' ORDER BY ');
        const limitPos = sqlUpper.indexOf(' LIMIT ');
        const havingPos = sqlUpper.indexOf(' HAVING ');
        // Find the first clause after WHERE (or end of query)
        const clausePositions = [groupByPos, orderByPos, limitPos, havingPos]
            .filter(pos => pos !== -1);
        const firstClauseAfterWhere = clausePositions.length > 0
            ? Math.min(...clausePositions)
            : sql.length;
        if (wherePos !== -1) {
            // Has WHERE - insert AND before the first clause after WHERE
            if (clausePositions.length > 0 && firstClauseAfterWhere > wherePos) {
                // Insert before GROUP BY, ORDER BY, LIMIT, or HAVING
                return sql.slice(0, firstClauseAfterWhere) +
                    ` AND ${projectFilter}` +
                    sql.slice(firstClauseAfterWhere);
            }
            else {
                // No clauses after WHERE - append to end
                return sql + ` AND ${projectFilter}`;
            }
        }
        else {
            // No WHERE - need to insert WHERE clause
            // Insert before GROUP BY, ORDER BY, LIMIT, or HAVING
            if (clausePositions.length > 0) {
                const insertPos = Math.min(...clausePositions);
                return sql.slice(0, insertPos) +
                    ` WHERE ${projectFilter}` +
                    sql.slice(insertPos);
            }
            else {
                // No clauses at all - append to end
                return sql + ` WHERE ${projectFilter}`;
            }
        }
    }
}
// nah fr we need per-project DB instances to prevent cross-project pollution
// each project gets its own DatabaseManager keyed by project path
const databaseManagers = new Map();
/**
 * Get current project path for database isolation.
 * Uses SPECMEM_PROJECT_PATH env var (set at MCP server start by bootstrap.cjs).
 */
function getDbProjectPath() {
    return process.env['SPECMEM_PROJECT_PATH'] || process.cwd() || '/';
}
/**
 * Get the DatabaseManager for the current project.
 *
 * MULTI-PROJECT ISOLATION: Each project gets its own DatabaseManager instance.
 * This prevents cross-project data pollution and ensures proper schema isolation.
 *
 * @param config - DatabaseConfig, required on first call for a project
 * @param projectPath - Optional explicit project path override (mainly for testing)
 * @returns DatabaseManager instance for the current/specified project
 */
export function getDatabase(config, projectPath) {
    const key = projectPath || getDbProjectPath();
    // yooo check if we already have an instance for this project
    const existing = databaseManagers.get(key);
    if (existing) {
        return existing;
    }
    // TASK #23 FIX: Auto-load config from loadConfig() when not provided
    // This enables graceful degradation - callers dont need to pass config every time
    if (!config) {
        logger.info({ projectPath: key }, 'No config provided, auto-loading from loadConfig().database');
        try {
            config = loadConfig().database;
        }
        catch (e) {
            // loadConfig failed - use sensible defaults that should work for most setups
            logger.warn({ projectPath: key, error: String(e) }, 'loadConfig() failed, using fallback defaults');
            // Use unified credential pattern - matches config.ts
            const unifiedCred = process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional';
            config = {
                host: process.env['SPECMEM_DB_HOST'] || 'localhost',
                port: parseInt(process.env['SPECMEM_DB_PORT'] || '5432', 10),
                database: process.env['SPECMEM_DB_NAME'] || unifiedCred,
                user: process.env['SPECMEM_DB_USER'] || unifiedCred,
                password: process.env['SPECMEM_DB_PASSWORD'] || unifiedCred,
                maxConnections: 20,
                idleTimeout: 30000,
                connectionTimeout: 5000,
                ssl: undefined
            };
        }
    }
    // create new instance for this project
    logger.info({ projectPath: key, database: config.database }, 'Creating new DatabaseManager for project');
    const newInstance = new DatabaseManager(config);
    databaseManagers.set(key, newInstance);
    return newInstance;
}
/**
 * Reset database instance for the current project.
 * Use for testing or when project context changes.
 *
 * @param projectPath - Optional explicit project path, defaults to current project
 */
export function resetDatabase(projectPath) {
    const key = projectPath || getDbProjectPath();
    const existing = databaseManagers.get(key);
    if (existing) {
        logger.debug({ projectPath: key }, 'Resetting DatabaseManager for project');
        databaseManagers.delete(key);
    }
}
/**
 * Reset ALL database instances across all projects.
 * Use ONLY for testing or complete shutdown scenarios.
 */
export function resetAllDatabases() {
    logger.warn({ instanceCount: databaseManagers.size }, 'Resetting ALL DatabaseManager instances');
    databaseManagers.clear();
}
/**
 * Get count of active database instances.
 * Useful for debugging multi-project scenarios.
 */
export function getDatabaseInstanceCount() {
    return databaseManagers.size;
}
/**
 * Get all active project paths with database instances.
 * Useful for debugging and monitoring.
 */
export function getActiveDbProjectPaths() {
    return Array.from(databaseManagers.keys());
}
//# sourceMappingURL=database.js.map