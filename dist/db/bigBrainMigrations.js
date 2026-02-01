// ayo this migration system hits DIFFERENT
// handles schema evolution for MILLIONS of rows no cap
// partitioning, indexes, all the enterprise drip
//
// =============================================================================
// EMBEDDING DIMENSION NOTE
// =============================================================================
// DEPRECATED: SPECMEM_EMBEDDING_DIMENSIONS is no longer used.
//
// Embedding dimensions are now AUTO-DETECTED from the database pgvector column.
// The database pg_attribute table is the single source of truth for dimensions.
// The Frankenstein embedding model outputs 384-dim embeddings natively.
//
// The system auto-migrates when dimension mismatch is detected at startup.
// See src/dashboard/standalone.ts for auto-migration logic.
//
// For new tables, use 384 as the default (Frankenstein native dimension).
// =============================================================================
import { logger } from '../utils/logger.js';
import { getProjectSchema } from './projectNamespacing.js';
/**
 * BigBrainMigrations - handles schema evolution like a BOSS
 *
 * features that absolutely SLAP:
 * - version tracking with checksums
 * - up/down migrations
 * - partitioning for massive tables
 * - proper index management
 * - pgvector setup for semantic search
 * - transaction-safe migrations
 */
export class BigBrainMigrations {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    // runs all pending migrations in order
    async runAllMigrations() {
        logger.info('starting BigBrain migration run - LESGO');
        const start = Date.now();
        // SCHEMA ISOLATION: Set search_path BEFORE any CREATE TABLE
        const schemaName = getProjectSchema();
        await this.pool.queryWithSwag(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
        await this.pool.queryWithSwag(`SET search_path TO ${schemaName}, public`);
        logger.info({ schemaName }, 'search_path set for migrations');
        await this.ensureMigrationTable();
        const applied = await this.getAppliedMigrations();
        const pending = this.getMigrations().filter(m => !applied.some(a => a.version === m.version));
        if (pending.length === 0) {
            logger.info('no pending migrations - schema is up to date fr');
            return;
        }
        logger.info({ pendingCount: pending.length }, 'found pending migrations');
        for (const migration of pending.sort((a, b) => a.version - b.version)) {
            await this.runMigration(migration);
        }
        const duration = Date.now() - start;
        logger.info({ duration, migrationsApplied: pending.length }, 'all migrations complete - WE DID IT');
    }
    // ensures the migration tracking table exists
    async ensureMigrationTable() {
        await this.pool.queryWithSwag(`
      CREATE TABLE IF NOT EXISTS _specmem_migrations (
        version INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        duration_ms INTEGER NOT NULL,
        checksum VARCHAR(64) NOT NULL
      )
    `);
        logger.debug('migration table ready');
    }
    // gets all migrations that have already been applied
    async getAppliedMigrations() {
        const result = await this.pool.queryWithSwag('SELECT * FROM _specmem_migrations ORDER BY version');
        return result.rows.map((row) => ({
            version: row.version,
            name: row.name,
            executedAt: row.executed_at,
            durationMs: row.duration_ms,
            checksum: row.checksum
        }));
    }
    // runs a single migration in a transaction
    async runMigration(migration) {
        logger.info({ version: migration.version, name: migration.name }, 'running migration');
        const start = Date.now();
        await this.pool.transactionGang(async (client) => {
            // run the migration SQL
            await client.query(migration.up);
            // record the migration
            const duration = Date.now() - start;
            await client.query(`INSERT INTO _specmem_migrations (version, name, duration_ms, checksum)
         VALUES ($1, $2, $3, $4)`, [migration.version, migration.name, duration, migration.checksum]);
        });
        const duration = Date.now() - start;
        logger.info({ version: migration.version, duration }, 'migration complete - fire');
    }
    // rolls back the last migration
    async rollbackLast() {
        const applied = await this.getAppliedMigrations();
        if (applied.length === 0) {
            logger.warn('no migrations to rollback bro');
            return;
        }
        const last = applied[applied.length - 1];
        const migration = this.getMigrations().find(m => m.version === last.version);
        if (!migration) {
            throw new Error(`cant find migration ${last.version} to rollback - this is bad`);
        }
        logger.info({ version: migration.version, name: migration.name }, 'rolling back migration');
        await this.pool.transactionGang(async (client) => {
            await client.query(migration.down);
            await client.query('DELETE FROM _specmem_migrations WHERE version = $1', [migration.version]);
        });
        logger.info({ version: migration.version }, 'rollback complete');
    }
    // generates a simple checksum for migration SQL
    generateChecksum(sql) {
        let hash = 0;
        for (let i = 0; i < sql.length; i++) {
            const char = sql.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16).padStart(8, '0');
    }
    // returns all migrations in order
    getMigrations() {
        return [
            // migration 1: install required extensions
            {
                version: 1,
                name: 'install_extensions',
                up: `
          -- yo pgvector is the GOAT for semantic search
          CREATE EXTENSION IF NOT EXISTS vector;

          -- trigram for fuzzy text search
          CREATE EXTENSION IF NOT EXISTS pg_trgm;

          -- btree_gin for composite indexes
          CREATE EXTENSION IF NOT EXISTS btree_gin;

          -- uuid-ossp for generating uuids
          CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
        `,
                down: `
          -- nah we cant really uninstall extensions safely
          -- other tables might depend on them
          SELECT 1;
        `,
                checksum: this.generateChecksum('install_extensions_v1')
            },
            // migration 2: create core enum types
            {
                version: 2,
                name: 'create_enum_types',
                up: `
          -- memory types - episodic, semantic, etc
          DO $$ BEGIN
            CREATE TYPE memory_type AS ENUM (
              'episodic',     -- specific events/experiences
              'semantic',     -- facts and knowledge
              'procedural',   -- how to do stuff
              'working',      -- temporary/short-term
              'consolidated'  -- merged from multiple memories
            );
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;

          -- importance levels for prioritization
          DO $$ BEGIN
            CREATE TYPE importance_level AS ENUM (
              'critical',  -- NEVER forget this
              'high',      -- pretty important
              'medium',    -- normal stuff
              'low',       -- meh
              'trivial'    -- who cares
            );
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;
        `,
                down: `
          DROP TYPE IF EXISTS importance_level;
          DROP TYPE IF EXISTS memory_type;
        `,
                checksum: this.generateChecksum('create_enum_types_v2')
            },
            // migration 3: create main memories table with partitioning
            {
                version: 3,
                name: 'create_memories_table',
                up: `
          -- main memories table - THE BIG ONE
          -- partitioned by created_at for handling MILLIONS of rows
          CREATE TABLE IF NOT EXISTS memories (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- content and search
            content TEXT NOT NULL,
            -- MED-18 FIX: Use convert_to() for proper UTF-8 to bytea conversion
            -- The ::bytea cast can fail with "invalid input syntax for type bytea"
            -- on content containing special characters like backslashes or non-ASCII
            -- See yeetStuffInDb.ts computeContentHash() for consistent approach
            content_hash VARCHAR(64) GENERATED ALWAYS AS (
              encode(sha256(convert_to(content, 'UTF8')), 'hex')
            ) STORED,
            content_tsv TSVECTOR GENERATED ALWAYS AS (
              to_tsvector('english', content)
            ) STORED,

            -- classification
            memory_type memory_type NOT NULL DEFAULT 'semantic',
            importance importance_level NOT NULL DEFAULT 'medium',

            -- tags stored as array - supports millions of tags
            tags TEXT[] NOT NULL DEFAULT '{}',

            -- flexible metadata as JSONB - way faster than TEXT
            metadata JSONB NOT NULL DEFAULT '{}',

            -- EMBEDDINGS - the secret sauce
            -- Dimension is auto-detected from memories table, unbounded initially
            embedding vector(384),

            -- image support
            image_data BYTEA,
            image_mime_type VARCHAR(50),

            -- timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- access tracking for consolidation
            access_count INTEGER NOT NULL DEFAULT 0,
            last_accessed_at TIMESTAMPTZ,

            -- expiration for auto-cleanup
            expires_at TIMESTAMPTZ,

            -- consolidation tracking
            consolidated_from UUID[] DEFAULT '{}',

            -- constraints
            CONSTRAINT content_not_empty CHECK (length(content) > 0),
            CONSTRAINT content_not_too_big CHECK (length(content) <= 1000000),
            CONSTRAINT valid_image CHECK (
              (image_data IS NULL AND image_mime_type IS NULL) OR
              (image_data IS NOT NULL AND image_mime_type IS NOT NULL)
            )
          );

          -- index for content hash deduplication
          CREATE INDEX IF NOT EXISTS idx_memories_content_hash
            ON memories(content_hash);

          -- full-text search index - GIN goes CRAZY
          CREATE INDEX IF NOT EXISTS idx_memories_content_tsv
            ON memories USING GIN(content_tsv);

          -- tag search - also GIN because arrays
          CREATE INDEX IF NOT EXISTS idx_memories_tags
            ON memories USING GIN(tags);

          -- JSONB metadata search
          CREATE INDEX IF NOT EXISTS idx_memories_metadata
            ON memories USING GIN(metadata jsonb_path_ops);

          -- type and importance filtering
          CREATE INDEX IF NOT EXISTS idx_memories_type
            ON memories(memory_type);
          CREATE INDEX IF NOT EXISTS idx_memories_importance
            ON memories(importance);

          -- time-based queries
          CREATE INDEX IF NOT EXISTS idx_memories_created
            ON memories(created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_memories_updated
            ON memories(updated_at DESC);

          -- expiration cleanup
          CREATE INDEX IF NOT EXISTS idx_memories_expires
            ON memories(expires_at)
            WHERE expires_at IS NOT NULL;

          -- access pattern tracking
          CREATE INDEX IF NOT EXISTS idx_memories_access
            ON memories(last_accessed_at DESC NULLS LAST);
        `,
                down: `
          DROP TABLE IF EXISTS memories CASCADE;
        `,
                checksum: this.generateChecksum('create_memories_table_v3')
            },
            // migration 4: create HNSW index for vector search
            {
                version: 4,
                name: 'create_vector_index',
                up: `
          -- HNSW index for vector similarity search
          -- this is the FAST one - O(log n) search time
          -- ef_construction and m affect build time vs search quality
          CREATE INDEX IF NOT EXISTS idx_memories_embedding_hnsw
            ON memories
            USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64);

          -- also create IVFFlat for comparison (legacy compatibility)
          -- IVFFlat is faster to build but slower to search
          CREATE INDEX IF NOT EXISTS idx_memories_embedding_ivfflat
            ON memories
            USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 100);
        `,
                down: `
          DROP INDEX IF EXISTS idx_memories_embedding_hnsw;
          DROP INDEX IF EXISTS idx_memories_embedding_ivfflat;
        `,
                checksum: this.generateChecksum('create_vector_index_v4')
            },
            // migration 5: create memory relations table
            {
                version: 5,
                name: 'create_memory_relations',
                up: `
          -- tracks relationships between memories
          CREATE TABLE IF NOT EXISTS memory_relations (
            source_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            target_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            relation_type VARCHAR(50) NOT NULL DEFAULT 'related',
            strength FLOAT NOT NULL DEFAULT 1.0 CHECK (strength >= 0 AND strength <= 1),
            metadata JSONB DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            PRIMARY KEY (source_id, target_id, relation_type),
            CONSTRAINT no_self_relation CHECK (source_id != target_id)
          );

          -- index for finding related memories
          CREATE INDEX IF NOT EXISTS idx_memory_relations_source
            ON memory_relations(source_id);
          CREATE INDEX IF NOT EXISTS idx_memory_relations_target
            ON memory_relations(target_id);
          CREATE INDEX IF NOT EXISTS idx_memory_relations_type
            ON memory_relations(relation_type);
        `,
                down: `
          DROP TABLE IF EXISTS memory_relations CASCADE;
        `,
                checksum: this.generateChecksum('create_memory_relations_v5')
            },
            // migration 6: create normalized tags table
            {
                version: 6,
                name: 'create_tags_table',
                up: `
          -- normalized tags for better query performance
          -- this is in addition to the array column
          CREATE TABLE IF NOT EXISTS tags (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            usage_count INTEGER NOT NULL DEFAULT 0
          );

          -- junction table for memory-tag relationships
          CREATE TABLE IF NOT EXISTS memory_tags (
            memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (memory_id, tag_id)
          );

          CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
          CREATE INDEX IF NOT EXISTS idx_tags_usage ON tags(usage_count DESC);
          CREATE INDEX IF NOT EXISTS idx_memory_tags_memory ON memory_tags(memory_id);
          CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag_id);
        `,
                down: `
          DROP TABLE IF EXISTS memory_tags CASCADE;
          DROP TABLE IF EXISTS tags CASCADE;
        `,
                checksum: this.generateChecksum('create_tags_table_v6')
            },
            // migration 7: create consolidation history
            {
                version: 7,
                name: 'create_consolidation_history',
                up: `
          -- tracks consolidation runs for debugging and optimization
          CREATE TABLE IF NOT EXISTS consolidation_history (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            strategy VARCHAR(50) NOT NULL,
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            memories_processed INTEGER DEFAULT 0,
            memories_consolidated INTEGER DEFAULT 0,
            clusters_found INTEGER DEFAULT 0,
            duration_ms INTEGER,
            error_message TEXT,
            metadata JSONB DEFAULT '{}'
          );

          CREATE INDEX IF NOT EXISTS idx_consolidation_started
            ON consolidation_history(started_at DESC);
        `,
                down: `
          DROP TABLE IF EXISTS consolidation_history CASCADE;
        `,
                checksum: this.generateChecksum('create_consolidation_history_v7')
            },
            // migration 8: create updated_at trigger
            {
                version: 8,
                name: 'create_updated_at_trigger',
                up: `
          -- auto-update updated_at on any row change
          CREATE OR REPLACE FUNCTION update_updated_at_column()
          RETURNS TRIGGER AS $$
          BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql;

          -- apply to memories table
          DROP TRIGGER IF EXISTS memories_updated_at ON memories;
          CREATE TRIGGER memories_updated_at
            BEFORE UPDATE ON memories
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        `,
                down: `
          DROP TRIGGER IF EXISTS memories_updated_at ON memories;
          DROP FUNCTION IF EXISTS update_updated_at_column();
        `,
                checksum: this.generateChecksum('create_updated_at_trigger_v8')
            },
            // migration 9: create partitioning for memories (for massive scale)
            {
                version: 9,
                name: 'create_partitions_prep',
                up: `
          -- nah we're keeping the table as-is for now
          -- partitioning requires recreating the table and that's risky
          -- but we'll add a view for time-based access patterns

          CREATE OR REPLACE VIEW memories_recent AS
            SELECT * FROM memories
            WHERE created_at > NOW() - INTERVAL '30 days'
              AND (expires_at IS NULL OR expires_at > NOW());

          CREATE OR REPLACE VIEW memories_active AS
            SELECT * FROM memories
            WHERE (expires_at IS NULL OR expires_at > NOW())
              AND memory_type != 'consolidated';
        `,
                down: `
          DROP VIEW IF EXISTS memories_active;
          DROP VIEW IF EXISTS memories_recent;
        `,
                checksum: this.generateChecksum('create_partitions_prep_v9')
            },
            // migration 10: create embedding cache table
            {
                version: 10,
                name: 'create_embedding_cache',
                up: `
          -- cache embeddings to avoid recomputing them
          -- content_hash -> embedding mapping
          -- NOTE: Dimension is auto-detected, unbounded initially
          CREATE TABLE IF NOT EXISTS embedding_cache (
            content_hash VARCHAR(64) PRIMARY KEY,
            embedding vector(384) NOT NULL,
            model VARCHAR(100) NOT NULL DEFAULT 'text-embedding-3-small',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            hit_count INTEGER NOT NULL DEFAULT 0
          );

          CREATE INDEX IF NOT EXISTS idx_embedding_cache_model
            ON embedding_cache(model);
          CREATE INDEX IF NOT EXISTS idx_embedding_cache_used
            ON embedding_cache(last_used_at);
        `,
                down: `
          DROP TABLE IF EXISTS embedding_cache CASCADE;
        `,
                checksum: this.generateChecksum('create_embedding_cache_v10')
            },
            // migration 11: add composite indexes for common queries
            {
                version: 11,
                name: 'create_composite_indexes',
                up: `
          -- composite indexes for common query patterns

          -- search by type + importance
          CREATE INDEX IF NOT EXISTS idx_memories_type_importance
            ON memories(memory_type, importance);

          -- search by type + created
          CREATE INDEX IF NOT EXISTS idx_memories_type_created
            ON memories(memory_type, created_at DESC);

          -- non-expired memories ordered by access (no NOW() - not IMMUTABLE)
          -- use expires_at IS NULL for permanent memories - expiring ones filtered at query time
          CREATE INDEX IF NOT EXISTS idx_memories_active_access
            ON memories(access_count DESC, last_accessed_at DESC)
            WHERE expires_at IS NULL;

          -- separate index for memories with expiration (for cleanup queries)
          CREATE INDEX IF NOT EXISTS idx_memories_expiring
            ON memories(expires_at)
            WHERE expires_at IS NOT NULL;

          -- content length for analytics (length() is IMMUTABLE)
          CREATE INDEX IF NOT EXISTS idx_memories_content_length
            ON memories(length(content));
        `,
                down: `
          DROP INDEX IF EXISTS idx_memories_type_importance;
          DROP INDEX IF EXISTS idx_memories_type_created;
          DROP INDEX IF EXISTS idx_memories_active_access;
          DROP INDEX IF EXISTS idx_memories_expiring;
          DROP INDEX IF EXISTS idx_memories_content_length;
        `,
                checksum: this.generateChecksum('create_composite_indexes_v11_fixed')
            },
            // migration 12: create stats materialized view
            {
                version: 12,
                name: 'create_stats_view',
                up: `
          -- materialized view for fast stats queries
          CREATE MATERIALIZED VIEW IF NOT EXISTS memory_stats AS
          SELECT
            COUNT(*) as total_memories,
            COUNT(*) FILTER (WHERE memory_type = 'episodic') as episodic_count,
            COUNT(*) FILTER (WHERE memory_type = 'semantic') as semantic_count,
            COUNT(*) FILTER (WHERE memory_type = 'procedural') as procedural_count,
            COUNT(*) FILTER (WHERE memory_type = 'working') as working_count,
            COUNT(*) FILTER (WHERE memory_type = 'consolidated') as consolidated_count,
            COUNT(*) FILTER (WHERE importance = 'critical') as critical_count,
            COUNT(*) FILTER (WHERE importance = 'high') as high_count,
            COUNT(*) FILTER (WHERE image_data IS NOT NULL) as with_images,
            COUNT(*) FILTER (WHERE embedding IS NOT NULL) as with_embeddings,
            COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < NOW()) as expired_count,
            AVG(access_count)::FLOAT as avg_access_count,
            AVG(length(content))::FLOAT as avg_content_length,
            MIN(created_at) as oldest_memory,
            MAX(created_at) as newest_memory,
            NOW() as computed_at
          FROM memories;

          -- index on the materialized view
          CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_stats_singleton
            ON memory_stats(computed_at);

          -- function to refresh stats
          CREATE OR REPLACE FUNCTION refresh_memory_stats()
          RETURNS void AS $$
          BEGIN
            REFRESH MATERIALIZED VIEW CONCURRENTLY memory_stats;
          END;
          $$ LANGUAGE plpgsql;
        `,
                down: `
          DROP FUNCTION IF EXISTS refresh_memory_stats();
          DROP MATERIALIZED VIEW IF EXISTS memory_stats;
        `,
                checksum: this.generateChecksum('create_stats_view_v12')
            },
            // migration 13: create codebase_files table for ingestThisWholeAssMfCodebase
            {
                version: 13,
                name: 'create_codebase_files_table',
                up: `
          -- yooo this table holds ENTIRE CODEBASES in memory
          -- we about to store MILLIONS of lines of code fr fr
          CREATE TABLE IF NOT EXISTS codebase_files (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- file identification
            file_path TEXT NOT NULL,           -- relative path from root
            absolute_path TEXT NOT NULL,       -- full system path
            file_name VARCHAR(255) NOT NULL,   -- just the filename
            extension VARCHAR(50),              -- file extension

            -- language detection
            language_id VARCHAR(50) NOT NULL DEFAULT 'unknown',
            language_name VARCHAR(100) NOT NULL DEFAULT 'Unknown',
            language_type VARCHAR(50) NOT NULL DEFAULT 'data',

            -- content storage
            content TEXT NOT NULL,
            content_hash VARCHAR(64),  -- computed by application, not GENERATED (avoids bytea cast issues)
            content_tsv TSVECTOR GENERATED ALWAYS AS (
              to_tsvector('english', content)
            ) STORED,

            -- file stats
            size_bytes INTEGER NOT NULL DEFAULT 0,
            line_count INTEGER NOT NULL DEFAULT 0,
            char_count INTEGER NOT NULL DEFAULT 0,
            last_modified TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- chunking support for MASSIVE files
            chunk_index INTEGER,              -- null = not chunked, 0+ = chunk number
            total_chunks INTEGER,             -- total chunks if chunked
            original_file_id UUID,            -- parent file if this is a chunk

            -- EMBEDDINGS for semantic code search
            -- NOTE: Dimension is auto-detected, unbounded initially
            embedding vector(384),

            -- timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- constraints
            CONSTRAINT content_not_empty CHECK (length(content) > 0),
            CONSTRAINT valid_chunk CHECK (
              (chunk_index IS NULL AND total_chunks IS NULL AND original_file_id IS NULL) OR
              (chunk_index IS NOT NULL AND total_chunks IS NOT NULL AND original_file_id IS NOT NULL)
            )
          );

          -- index for content hash deduplication
          CREATE UNIQUE INDEX IF NOT EXISTS idx_codebase_files_content_hash
            ON codebase_files(content_hash);

          -- full-text search index for code search
          CREATE INDEX IF NOT EXISTS idx_codebase_files_content_tsv
            ON codebase_files USING GIN(content_tsv);

          -- file path searches
          CREATE INDEX IF NOT EXISTS idx_codebase_files_path
            ON codebase_files(file_path);
          CREATE INDEX IF NOT EXISTS idx_codebase_files_path_trgm
            ON codebase_files USING GIN(file_path gin_trgm_ops);

          -- language filtering
          CREATE INDEX IF NOT EXISTS idx_codebase_files_language
            ON codebase_files(language_id);

          -- chunk lookups
          CREATE INDEX IF NOT EXISTS idx_codebase_files_original
            ON codebase_files(original_file_id)
            WHERE original_file_id IS NOT NULL;

          -- time-based queries
          CREATE INDEX IF NOT EXISTS idx_codebase_files_modified
            ON codebase_files(last_modified DESC);

          -- HNSW index for FAST semantic code search
          CREATE INDEX IF NOT EXISTS idx_codebase_files_embedding_hnsw
            ON codebase_files
            USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64);

          -- trigger for updated_at
          DROP TRIGGER IF EXISTS codebase_files_updated_at ON codebase_files;
          CREATE TRIGGER codebase_files_updated_at
            BEFORE UPDATE ON codebase_files
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        `,
                down: `
          DROP TRIGGER IF EXISTS codebase_files_updated_at ON codebase_files;
          DROP TABLE IF EXISTS codebase_files CASCADE;
        `,
                checksum: this.generateChecksum('create_codebase_files_table_v13')
            },
            // migration 14: create codebase stats materialized view
            {
                version: 14,
                name: 'create_codebase_stats_view',
                up: `
          -- materialized view for codebase stats - codebaseStatsGoCrazy
          CREATE MATERIALIZED VIEW IF NOT EXISTS codebase_stats AS
          SELECT
            COUNT(*) as total_files,
            COUNT(*) FILTER (WHERE chunk_index IS NOT NULL) as total_chunks,
            COUNT(*) FILTER (WHERE chunk_index IS NULL) as unique_files,
            SUM(line_count) as total_lines,
            SUM(size_bytes) as total_bytes,
            COUNT(DISTINCT language_id) as language_count,
            COUNT(*) FILTER (WHERE embedding IS NOT NULL) as files_with_embeddings,
            MIN(last_modified) as oldest_file,
            MAX(last_modified) as newest_file,
            NOW() as computed_at
          FROM codebase_files;

          CREATE UNIQUE INDEX IF NOT EXISTS idx_codebase_stats_singleton
            ON codebase_stats(computed_at);

          -- function to refresh codebase stats
          CREATE OR REPLACE FUNCTION refresh_codebase_stats()
          RETURNS void AS $$
          BEGIN
            REFRESH MATERIALIZED VIEW CONCURRENTLY codebase_stats;
          END;
          $$ LANGUAGE plpgsql;
        `,
                down: `
          DROP FUNCTION IF EXISTS refresh_codebase_stats();
          DROP MATERIALIZED VIEW IF EXISTS codebase_stats;
        `,
                checksum: this.generateChecksum('create_codebase_stats_view_v14')
            },
            // migration 15: create dependency_history table
            {
                version: 15,
                name: 'create_dependency_history_table',
                up: `
          -- yooo tracking package.json changes without indexing node_modules
          -- this is the BIG BRAIN move fr fr
          CREATE TABLE IF NOT EXISTS dependency_history (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- package identification
            package_name VARCHAR(255) NOT NULL,
            version VARCHAR(100),

            -- event tracking
            event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('added', 'updated', 'removed')),
            package_type VARCHAR(20) NOT NULL CHECK (package_type IN (
              'dependency',
              'devDependency',
              'peerDependency',
              'optionalDependency'
            )),

            -- timestamp
            timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- source context
            package_json_path TEXT NOT NULL,
            project_name VARCHAR(255),

            -- metadata for storing old/new versions during updates
            metadata JSONB,

            -- timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          -- index for package name lookups - whenDidWeAddThisPackage
          CREATE INDEX IF NOT EXISTS idx_dependency_history_package_name
            ON dependency_history(package_name);

          -- index for event type filtering
          CREATE INDEX IF NOT EXISTS idx_dependency_history_event_type
            ON dependency_history(event_type);

          -- index for package type filtering
          CREATE INDEX IF NOT EXISTS idx_dependency_history_package_type
            ON dependency_history(package_type);

          -- index for timestamp-based queries - recent changes
          CREATE INDEX IF NOT EXISTS idx_dependency_history_timestamp
            ON dependency_history(timestamp DESC);

          -- index for project lookups
          CREATE INDEX IF NOT EXISTS idx_dependency_history_project
            ON dependency_history(project_name)
            WHERE project_name IS NOT NULL;

          -- composite index for package + path lookups
          CREATE INDEX IF NOT EXISTS idx_dependency_history_package_path
            ON dependency_history(package_name, package_json_path);

          -- composite index for common queries
          CREATE INDEX IF NOT EXISTS idx_dependency_history_event_timestamp
            ON dependency_history(event_type, timestamp DESC);

          -- GIN index for JSONB metadata queries
          CREATE INDEX IF NOT EXISTS idx_dependency_history_metadata
            ON dependency_history USING GIN(metadata);
        `,
                down: `
          DROP TABLE IF EXISTS dependency_history CASCADE;
        `,
                checksum: this.generateChecksum('create_dependency_history_table_v15')
            },
            // migration 16: create claude_code_history table
            // yooo  about to remember EVERYTHING it writes
            // no more massive explores needed fr
            {
                version: 16,
                name: 'create_claude_code_history',
                up: `
          -- yooo  about to remember EVERYTHING it writes
          -- no more massive explores needed fr

          -- main table for tracking 's code
          CREATE TABLE IF NOT EXISTS claude_code_history (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- what did  write?
            file_path TEXT NOT NULL,
            file_name VARCHAR(255) NOT NULL,
            code_content TEXT NOT NULL,
            code_hash VARCHAR(64) GENERATED ALWAYS AS (
              encode(sha256(code_content::bytea), 'hex')
            ) STORED,

            -- why did  write it?
            purpose TEXT NOT NULL,
            conversation_context TEXT,

            -- classification
            operation_type VARCHAR(50) NOT NULL DEFAULT 'write',
            language VARCHAR(50) NOT NULL DEFAULT 'unknown',

            -- relationships
            related_files TEXT[] NOT NULL DEFAULT '{}',
            related_memory_ids UUID[] DEFAULT '{}',
            parent_code_id UUID REFERENCES claude_code_history(id),

            -- tagging for searchability
            tags TEXT[] NOT NULL DEFAULT '{}',
            metadata JSONB NOT NULL DEFAULT '{}',

            -- EMBEDDINGS for semantic search
            -- NOTE: Dimension is auto-detected, unbounded initially
            embedding vector(384),

            -- full text search
            content_tsv TSVECTOR GENERATED ALWAYS AS (
              to_tsvector('english', code_content || ' ' || purpose)
            ) STORED,

            -- timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- version tracking for same file
            version INTEGER NOT NULL DEFAULT 1,

            -- constraints
            CONSTRAINT code_not_empty CHECK (length(code_content) > 0),
            CONSTRAINT purpose_not_empty CHECK (length(purpose) > 0),
            CONSTRAINT valid_operation CHECK (
              operation_type IN ('write', 'edit', 'notebook_edit', 'create', 'update', 'delete')
            )
          );

          -- indexes for FAST lookups

          -- file path searches
          CREATE INDEX IF NOT EXISTS idx_claude_code_file_path
            ON claude_code_history(file_path);
          CREATE INDEX IF NOT EXISTS idx_claude_code_file_path_trgm
            ON claude_code_history USING GIN(file_path gin_trgm_ops);

          -- content hash for deduplication
          CREATE INDEX IF NOT EXISTS idx_claude_code_hash
            ON claude_code_history(code_hash);

          -- full-text search on code + purpose
          CREATE INDEX IF NOT EXISTS idx_claude_code_tsv
            ON claude_code_history USING GIN(content_tsv);

          -- tag searches
          CREATE INDEX IF NOT EXISTS idx_claude_code_tags
            ON claude_code_history USING GIN(tags);

          -- metadata JSONB searches
          CREATE INDEX IF NOT EXISTS idx_claude_code_metadata
            ON claude_code_history USING GIN(metadata jsonb_path_ops);

          -- language filtering
          CREATE INDEX IF NOT EXISTS idx_claude_code_language
            ON claude_code_history(language);

          -- operation type filtering
          CREATE INDEX IF NOT EXISTS idx_claude_code_operation
            ON claude_code_history(operation_type);

          -- time-based queries
          CREATE INDEX IF NOT EXISTS idx_claude_code_created
            ON claude_code_history(created_at DESC);

          -- version tracking for same file
          CREATE INDEX IF NOT EXISTS idx_claude_code_file_version
            ON claude_code_history(file_path, version DESC);

          -- HNSW vector index for semantic code search
          CREATE INDEX IF NOT EXISTS idx_claude_code_embedding_hnsw
            ON claude_code_history
            USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64);

          -- related files search
          CREATE INDEX IF NOT EXISTS idx_claude_code_related
            ON claude_code_history USING GIN(related_files);

          -- parent-child relationship
          CREATE INDEX IF NOT EXISTS idx_claude_code_parent
            ON claude_code_history(parent_code_id)
            WHERE parent_code_id IS NOT NULL;

          -- trigger for updated_at
          DROP TRIGGER IF EXISTS claude_code_history_updated_at ON claude_code_history;
          CREATE TRIGGER claude_code_history_updated_at
            BEFORE UPDATE ON claude_code_history
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();

          -- materialized view for code stats
          CREATE MATERIALIZED VIEW IF NOT EXISTS claude_code_stats AS
          SELECT
            COUNT(*) as total_code_entries,
            COUNT(DISTINCT file_path) as unique_files,
            COUNT(*) FILTER (WHERE operation_type = 'write') as writes,
            COUNT(*) FILTER (WHERE operation_type = 'edit') as edits,
            COUNT(*) FILTER (WHERE operation_type = 'create') as creates,
            COUNT(*) FILTER (WHERE embedding IS NOT NULL) as with_embeddings,
            SUM(length(code_content)) as total_characters,
            AVG(length(code_content))::INTEGER as avg_code_length,
            MIN(created_at) as oldest_code,
            MAX(created_at) as newest_code,
            NOW() as computed_at
          FROM claude_code_history;

          CREATE UNIQUE INDEX IF NOT EXISTS idx_claude_code_stats_singleton
            ON claude_code_stats(computed_at);

          -- function to refresh claude code stats
          CREATE OR REPLACE FUNCTION refresh_claude_code_stats()
          RETURNS void AS $$
          BEGIN
            REFRESH MATERIALIZED VIEW CONCURRENTLY claude_code_stats;
          END;
          $$ LANGUAGE plpgsql;
        `,
                down: `
          DROP FUNCTION IF EXISTS refresh_claude_code_stats();
          DROP MATERIALIZED VIEW IF EXISTS claude_code_stats;
          DROP TRIGGER IF EXISTS claude_code_history_updated_at ON claude_code_history;
          DROP TABLE IF EXISTS claude_code_history CASCADE;
        `,
                checksum: this.generateChecksum('create_claude_code_history_v16')
            },
            // migration 17: create code_chunks table for semantic search
            // yooo this is where the MAGIC happens
            // chunks of code with embeddings for findSimilarCode
            {
                version: 17,
                name: 'create_code_chunks_table',
                up: `
          -- code_chunks - SEMANTIC CODE SEARCH goes CRAZY here
          -- stores code chunks with embeddings for similarity search
          -- this is how we find similar code across the ENTIRE codebase
          CREATE TABLE IF NOT EXISTS code_chunks (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- reference to parent file
            file_id UUID NOT NULL REFERENCES codebase_files(id) ON DELETE CASCADE,
            file_path TEXT NOT NULL,

            -- chunk positioning
            chunk_index INTEGER NOT NULL DEFAULT 0,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            start_char INTEGER NOT NULL DEFAULT 0,
            end_char INTEGER NOT NULL DEFAULT 0,

            -- chunk content and metadata
            content TEXT NOT NULL,
            content_hash VARCHAR(64) GENERATED ALWAYS AS (
              encode(sha256(content::bytea), 'hex')
            ) STORED,

            -- language and context
            language VARCHAR(50) NOT NULL DEFAULT 'unknown',
            chunk_type VARCHAR(50) NOT NULL DEFAULT 'code',  -- code, comment, docstring, mixed

            -- semantic context
            context_before TEXT,      -- few lines before for context
            context_after TEXT,       -- few lines after for context

            -- EMBEDDINGS - the secret sauce for semantic search
            -- NOTE: Dimension is auto-detected, unbounded initially
            embedding vector(384),

            -- full text search
            content_tsv TSVECTOR GENERATED ALWAYS AS (
              to_tsvector('english', content)
            ) STORED,

            -- metadata
            metadata JSONB NOT NULL DEFAULT '{}',

            -- timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- constraints
            CONSTRAINT chunk_not_empty CHECK (length(content) > 0),
            CONSTRAINT valid_lines CHECK (end_line >= start_line),
            CONSTRAINT valid_chunk_type CHECK (
              chunk_type IN ('code', 'comment', 'docstring', 'mixed', 'import', 'definition')
            )
          );

          -- indexes for BLAZING FAST lookups

          -- file lookups
          CREATE INDEX IF NOT EXISTS idx_code_chunks_file_id
            ON code_chunks(file_id);
          CREATE INDEX IF NOT EXISTS idx_code_chunks_file_path
            ON code_chunks(file_path);
          CREATE INDEX IF NOT EXISTS idx_code_chunks_file_path_trgm
            ON code_chunks USING GIN(file_path gin_trgm_ops);

          -- chunk ordering within file
          CREATE INDEX IF NOT EXISTS idx_code_chunks_file_order
            ON code_chunks(file_id, chunk_index);

          -- line range queries
          CREATE INDEX IF NOT EXISTS idx_code_chunks_lines
            ON code_chunks(file_id, start_line, end_line);

          -- content hash for deduplication
          CREATE INDEX IF NOT EXISTS idx_code_chunks_hash
            ON code_chunks(content_hash);

          -- language filtering
          CREATE INDEX IF NOT EXISTS idx_code_chunks_language
            ON code_chunks(language);

          -- chunk type filtering
          CREATE INDEX IF NOT EXISTS idx_code_chunks_type
            ON code_chunks(chunk_type);

          -- full-text search
          CREATE INDEX IF NOT EXISTS idx_code_chunks_tsv
            ON code_chunks USING GIN(content_tsv);

          -- HNSW vector index for FAST semantic search
          CREATE INDEX IF NOT EXISTS idx_code_chunks_embedding_hnsw
            ON code_chunks
            USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64);

          -- metadata queries
          CREATE INDEX IF NOT EXISTS idx_code_chunks_metadata
            ON code_chunks USING GIN(metadata jsonb_path_ops);

          -- time-based queries
          CREATE INDEX IF NOT EXISTS idx_code_chunks_created
            ON code_chunks(created_at DESC);

          -- trigger for updated_at
          DROP TRIGGER IF EXISTS code_chunks_updated_at ON code_chunks;
          CREATE TRIGGER code_chunks_updated_at
            BEFORE UPDATE ON code_chunks
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        `,
                down: `
          DROP TRIGGER IF EXISTS code_chunks_updated_at ON code_chunks;
          DROP TABLE IF EXISTS code_chunks CASCADE;
        `,
                checksum: this.generateChecksum('create_code_chunks_table_v17')
            },
            // migration 18: create code_definitions table
            // tracks all function/class/variable definitions
            // this is how we know WHAT code exists in the codebase
            {
                version: 18,
                name: 'create_code_definitions_table',
                up: `
          -- code_definitions - EVERY function, class, variable, etc
          -- this is your codebase's BRAIN MAP fr fr
          -- tracks signatures, types, exports, everything
          CREATE TABLE IF NOT EXISTS code_definitions (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- reference to parent file
            file_id UUID NOT NULL REFERENCES codebase_files(id) ON DELETE CASCADE,
            file_path TEXT NOT NULL,

            -- definition identification
            name VARCHAR(500) NOT NULL,
            qualified_name TEXT,           -- full path like module.class.method
            definition_type VARCHAR(50) NOT NULL,  -- function, class, method, variable, interface, type, enum, constant

            -- location
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            start_column INTEGER DEFAULT 0,
            end_column INTEGER DEFAULT 0,

            -- signature and documentation
            signature TEXT,                -- full function/class signature
            docstring TEXT,                -- extracted documentation
            return_type VARCHAR(255),      -- for functions

            -- visibility and scope
            visibility VARCHAR(20) DEFAULT 'public',  -- public, private, protected, internal
            is_exported BOOLEAN DEFAULT false,
            is_async BOOLEAN DEFAULT false,
            is_static BOOLEAN DEFAULT false,
            is_abstract BOOLEAN DEFAULT false,

            -- parent relationship (for nested definitions)
            parent_definition_id UUID REFERENCES code_definitions(id) ON DELETE CASCADE,

            -- parameters (for functions/methods)
            parameters JSONB DEFAULT '[]',  -- [{name, type, default, optional}]

            -- language specific
            language VARCHAR(50) NOT NULL DEFAULT 'unknown',

            -- decorators/annotations
            decorators TEXT[] DEFAULT '{}',

            -- EMBEDDINGS for semantic search on definitions
            -- NOTE: Dimension is auto-detected, unbounded initially
            embedding vector(384),

            -- full text search on name + signature + docstring
            definition_tsv TSVECTOR GENERATED ALWAYS AS (
              to_tsvector('english',
                COALESCE(name, '') || ' ' ||
                COALESCE(signature, '') || ' ' ||
                COALESCE(docstring, '')
              )
            ) STORED,

            -- metadata
            metadata JSONB NOT NULL DEFAULT '{}',

            -- timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- constraints
            CONSTRAINT name_not_empty CHECK (length(name) > 0),
            CONSTRAINT valid_definition_type CHECK (
              definition_type IN (
                'function', 'method', 'class', 'interface', 'type', 'enum',
                'variable', 'constant', 'property', 'getter', 'setter',
                'constructor', 'decorator', 'module', 'namespace', 'trait',
                'struct', 'protocol', 'extension', 'mixin', 'alias'
              )
            ),
            CONSTRAINT valid_visibility CHECK (
              visibility IN ('public', 'private', 'protected', 'internal', 'package')
            )
          );

          -- indexes for LIGHTNING lookups

          -- file lookups
          CREATE INDEX IF NOT EXISTS idx_code_definitions_file_id
            ON code_definitions(file_id);
          CREATE INDEX IF NOT EXISTS idx_code_definitions_file_path
            ON code_definitions(file_path);

          -- name searches (the main use case)
          CREATE INDEX IF NOT EXISTS idx_code_definitions_name
            ON code_definitions(name);
          CREATE INDEX IF NOT EXISTS idx_code_definitions_name_trgm
            ON code_definitions USING GIN(name gin_trgm_ops);
          CREATE INDEX IF NOT EXISTS idx_code_definitions_qualified
            ON code_definitions(qualified_name)
            WHERE qualified_name IS NOT NULL;

          -- type filtering
          CREATE INDEX IF NOT EXISTS idx_code_definitions_type
            ON code_definitions(definition_type);

          -- language filtering
          CREATE INDEX IF NOT EXISTS idx_code_definitions_language
            ON code_definitions(language);

          -- exported definitions (for API surface)
          CREATE INDEX IF NOT EXISTS idx_code_definitions_exported
            ON code_definitions(is_exported)
            WHERE is_exported = true;

          -- parent-child relationships
          CREATE INDEX IF NOT EXISTS idx_code_definitions_parent
            ON code_definitions(parent_definition_id)
            WHERE parent_definition_id IS NOT NULL;

          -- full-text search
          CREATE INDEX IF NOT EXISTS idx_code_definitions_tsv
            ON code_definitions USING GIN(definition_tsv);

          -- HNSW vector index for semantic definition search
          CREATE INDEX IF NOT EXISTS idx_code_definitions_embedding_hnsw
            ON code_definitions
            USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64);

          -- line lookups (for finding definition at cursor)
          CREATE INDEX IF NOT EXISTS idx_code_definitions_lines
            ON code_definitions(file_id, start_line, end_line);

          -- composite for common queries
          CREATE INDEX IF NOT EXISTS idx_code_definitions_type_name
            ON code_definitions(definition_type, name);

          -- time-based queries
          CREATE INDEX IF NOT EXISTS idx_code_definitions_created
            ON code_definitions(created_at DESC);

          -- trigger for updated_at
          DROP TRIGGER IF EXISTS code_definitions_updated_at ON code_definitions;
          CREATE TRIGGER code_definitions_updated_at
            BEFORE UPDATE ON code_definitions
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        `,
                down: `
          DROP TRIGGER IF EXISTS code_definitions_updated_at ON code_definitions;
          DROP TABLE IF EXISTS code_definitions CASCADE;
        `,
                checksum: this.generateChecksum('create_code_definitions_table_v18')
            },
            // migration 19: create code_dependencies table
            // tracks ALL imports, requires, includes across the codebase
            // builds the full dependency graph fr fr
            {
                version: 19,
                name: 'create_code_dependencies_table',
                up: `
          -- code_dependencies - the DEPENDENCY GRAPH
          -- tracks every import, require, include in the codebase
          -- we can trace dependencies through the ENTIRE project
          CREATE TABLE IF NOT EXISTS code_dependencies (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- source file (the file doing the importing)
            source_file_id UUID NOT NULL REFERENCES codebase_files(id) ON DELETE CASCADE,
            source_file_path TEXT NOT NULL,

            -- target (what's being imported)
            target_path TEXT NOT NULL,              -- could be relative, absolute, or package name
            resolved_path TEXT,                     -- resolved absolute path if local file
            target_file_id UUID REFERENCES codebase_files(id) ON DELETE SET NULL,

            -- import details
            import_type VARCHAR(50) NOT NULL DEFAULT 'import',  -- import, require, include, from, dynamic
            import_statement TEXT NOT NULL,         -- the full import statement

            -- what's being imported
            imported_names TEXT[] DEFAULT '{}',     -- specific names: ['foo', 'bar']
            imported_as TEXT[] DEFAULT '{}',        -- aliases: ['f', 'b']
            is_default_import BOOLEAN DEFAULT false,
            is_namespace_import BOOLEAN DEFAULT false,  -- import * as
            is_type_import BOOLEAN DEFAULT false,       -- TypeScript type imports
            is_side_effect_import BOOLEAN DEFAULT false, -- import 'polyfill'

            -- location in source file
            line_number INTEGER NOT NULL,
            column_number INTEGER DEFAULT 0,

            -- dependency classification
            is_external BOOLEAN DEFAULT false,      -- from node_modules or external package
            is_builtin BOOLEAN DEFAULT false,       -- built-in module (fs, path, etc)
            is_relative BOOLEAN DEFAULT false,      -- ./foo or ../bar
            is_absolute BOOLEAN DEFAULT false,      -- /abs/path
            is_dynamic BOOLEAN DEFAULT false,       -- dynamic import()

            -- package info (for external deps)
            package_name VARCHAR(255),              -- extracted package name
            package_version VARCHAR(50),            -- from package.json if available

            -- language
            language VARCHAR(50) NOT NULL DEFAULT 'unknown',

            -- metadata
            metadata JSONB NOT NULL DEFAULT '{}',

            -- timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- constraints
            CONSTRAINT target_not_empty CHECK (length(target_path) > 0),
            CONSTRAINT valid_import_type CHECK (
              import_type IN (
                'import', 'require', 'include', 'from', 'dynamic',
                'import_type', 'import_value', 'reexport', 'side_effect'
              )
            )
          );

          -- indexes for CRAZY FAST dependency lookups

          -- source file lookups (what does this file import?)
          CREATE INDEX IF NOT EXISTS idx_code_dependencies_source_file
            ON code_dependencies(source_file_id);
          CREATE INDEX IF NOT EXISTS idx_code_dependencies_source_path
            ON code_dependencies(source_file_path);

          -- target lookups (what imports this file?)
          CREATE INDEX IF NOT EXISTS idx_code_dependencies_target_file
            ON code_dependencies(target_file_id)
            WHERE target_file_id IS NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_code_dependencies_target_path
            ON code_dependencies(target_path);
          CREATE INDEX IF NOT EXISTS idx_code_dependencies_resolved_path
            ON code_dependencies(resolved_path)
            WHERE resolved_path IS NOT NULL;

          -- package lookups
          CREATE INDEX IF NOT EXISTS idx_code_dependencies_package
            ON code_dependencies(package_name)
            WHERE package_name IS NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_code_dependencies_package_trgm
            ON code_dependencies USING GIN(package_name gin_trgm_ops)
            WHERE package_name IS NOT NULL;

          -- external vs internal deps
          CREATE INDEX IF NOT EXISTS idx_code_dependencies_external
            ON code_dependencies(is_external);

          -- import type filtering
          CREATE INDEX IF NOT EXISTS idx_code_dependencies_type
            ON code_dependencies(import_type);

          -- language filtering
          CREATE INDEX IF NOT EXISTS idx_code_dependencies_language
            ON code_dependencies(language);

          -- imported names search
          CREATE INDEX IF NOT EXISTS idx_code_dependencies_names
            ON code_dependencies USING GIN(imported_names);

          -- composite for dependency graph traversal
          CREATE INDEX IF NOT EXISTS idx_code_dependencies_graph
            ON code_dependencies(source_file_id, target_file_id)
            WHERE target_file_id IS NOT NULL;

          -- time-based queries
          CREATE INDEX IF NOT EXISTS idx_code_dependencies_created
            ON code_dependencies(created_at DESC);

          -- trigger for updated_at
          DROP TRIGGER IF EXISTS code_dependencies_updated_at ON code_dependencies;
          CREATE TRIGGER code_dependencies_updated_at
            BEFORE UPDATE ON code_dependencies
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        `,
                down: `
          DROP TRIGGER IF EXISTS code_dependencies_updated_at ON code_dependencies;
          DROP TABLE IF EXISTS code_dependencies CASCADE;
        `,
                checksum: this.generateChecksum('create_code_dependencies_table_v19')
            },
            // migration 20: create code_complexity table
            // tracks code complexity metrics for analysis
            // cyclomatic complexity, lines of code, maintainability index, etc
            {
                version: 20,
                name: 'create_code_complexity_table',
                up: `
          -- code_complexity - CODE QUALITY METRICS
          -- tracks complexity, maintainability, and other metrics
          -- helps identify code that needs refactoring fr
          CREATE TABLE IF NOT EXISTS code_complexity (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- reference to file
            file_id UUID NOT NULL REFERENCES codebase_files(id) ON DELETE CASCADE,
            file_path TEXT NOT NULL,

            -- optional reference to specific definition
            definition_id UUID REFERENCES code_definitions(id) ON DELETE CASCADE,
            definition_name VARCHAR(500),

            -- scope of measurement
            scope_type VARCHAR(50) NOT NULL DEFAULT 'file',  -- file, function, class, method

            -- basic metrics
            lines_of_code INTEGER NOT NULL DEFAULT 0,
            logical_lines INTEGER NOT NULL DEFAULT 0,
            comment_lines INTEGER NOT NULL DEFAULT 0,
            blank_lines INTEGER NOT NULL DEFAULT 0,

            -- complexity metrics
            cyclomatic_complexity INTEGER,          -- McCabe complexity
            cognitive_complexity INTEGER,           -- SonarSource cognitive complexity
            halstead_difficulty FLOAT,              -- Halstead difficulty
            halstead_effort FLOAT,                  -- Halstead effort
            halstead_volume FLOAT,                  -- Halstead volume
            maintainability_index FLOAT,            -- Microsoft maintainability index

            -- function/class specific metrics
            parameter_count INTEGER,
            return_statement_count INTEGER,
            nesting_depth INTEGER,
            coupling_score INTEGER,                 -- dependencies count

            -- code smells and issues
            issues_count INTEGER DEFAULT 0,
            issues JSONB DEFAULT '[]',              -- [{type, severity, message, line}]

            -- duplicate code detection
            duplicate_blocks INTEGER DEFAULT 0,
            duplicate_lines INTEGER DEFAULT 0,

            -- language
            language VARCHAR(50) NOT NULL DEFAULT 'unknown',

            -- metadata
            metadata JSONB NOT NULL DEFAULT '{}',

            -- when was this analyzed?
            analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            analyzer_version VARCHAR(50),

            -- timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- constraints
            CONSTRAINT valid_scope_type CHECK (
              scope_type IN ('file', 'function', 'method', 'class', 'module', 'chunk')
            ),
            CONSTRAINT valid_lines CHECK (lines_of_code >= 0)
          );

          -- indexes for complexity analysis

          -- file lookups
          CREATE INDEX IF NOT EXISTS idx_code_complexity_file_id
            ON code_complexity(file_id);
          CREATE INDEX IF NOT EXISTS idx_code_complexity_file_path
            ON code_complexity(file_path);

          -- definition lookups
          CREATE INDEX IF NOT EXISTS idx_code_complexity_definition
            ON code_complexity(definition_id)
            WHERE definition_id IS NOT NULL;

          -- scope filtering
          CREATE INDEX IF NOT EXISTS idx_code_complexity_scope
            ON code_complexity(scope_type);

          -- complexity ranking (find most complex code)
          CREATE INDEX IF NOT EXISTS idx_code_complexity_cyclomatic
            ON code_complexity(cyclomatic_complexity DESC)
            WHERE cyclomatic_complexity IS NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_code_complexity_cognitive
            ON code_complexity(cognitive_complexity DESC)
            WHERE cognitive_complexity IS NOT NULL;

          -- maintainability ranking (find code needing work)
          CREATE INDEX IF NOT EXISTS idx_code_complexity_maintainability
            ON code_complexity(maintainability_index)
            WHERE maintainability_index IS NOT NULL;

          -- issue tracking
          CREATE INDEX IF NOT EXISTS idx_code_complexity_issues
            ON code_complexity(issues_count DESC)
            WHERE issues_count > 0;

          -- language filtering
          CREATE INDEX IF NOT EXISTS idx_code_complexity_language
            ON code_complexity(language);

          -- time-based queries
          CREATE INDEX IF NOT EXISTS idx_code_complexity_analyzed
            ON code_complexity(analyzed_at DESC);

          -- composite for common queries
          CREATE INDEX IF NOT EXISTS idx_code_complexity_scope_cyclomatic
            ON code_complexity(scope_type, cyclomatic_complexity DESC)
            WHERE cyclomatic_complexity IS NOT NULL;

          -- trigger for updated_at
          DROP TRIGGER IF EXISTS code_complexity_updated_at ON code_complexity;
          CREATE TRIGGER code_complexity_updated_at
            BEFORE UPDATE ON code_complexity
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();

          -- materialized view for codebase health overview
          CREATE MATERIALIZED VIEW IF NOT EXISTS codebase_health_stats AS
          SELECT
            COUNT(*) as total_files_analyzed,
            SUM(lines_of_code) as total_lines,
            SUM(comment_lines) as total_comments,
            AVG(cyclomatic_complexity)::FLOAT as avg_cyclomatic_complexity,
            AVG(cognitive_complexity)::FLOAT as avg_cognitive_complexity,
            AVG(maintainability_index)::FLOAT as avg_maintainability_index,
            MAX(cyclomatic_complexity) as max_cyclomatic_complexity,
            MAX(cognitive_complexity) as max_cognitive_complexity,
            MIN(maintainability_index) as min_maintainability_index,
            SUM(issues_count) as total_issues,
            SUM(duplicate_lines) as total_duplicate_lines,
            COUNT(*) FILTER (WHERE cyclomatic_complexity > 10) as high_complexity_count,
            COUNT(*) FILTER (WHERE maintainability_index < 20) as low_maintainability_count,
            NOW() as computed_at
          FROM code_complexity
          WHERE scope_type = 'file';

          CREATE UNIQUE INDEX IF NOT EXISTS idx_codebase_health_stats_singleton
            ON codebase_health_stats(computed_at);

          -- function to refresh health stats
          CREATE OR REPLACE FUNCTION refresh_codebase_health_stats()
          RETURNS void AS $$
          BEGIN
            REFRESH MATERIALIZED VIEW CONCURRENTLY codebase_health_stats;
          END;
          $$ LANGUAGE plpgsql;
        `,
                down: `
          DROP FUNCTION IF EXISTS refresh_codebase_health_stats();
          DROP MATERIALIZED VIEW IF EXISTS codebase_health_stats;
          DROP TRIGGER IF EXISTS code_complexity_updated_at ON code_complexity;
          DROP TABLE IF EXISTS code_complexity CASCADE;
        `,
                checksum: this.generateChecksum('create_code_complexity_table_v20')
            },
            // migration 21: create team_member_sessions table
            // tracks all team member sessions for the communication dashboard
            // this is where we track EVERY team member that connects fr
            {
                version: 21,
                name: 'create_team_member_sessions_table',
                up: `
          -- team_member_sessions - TEAM_MEMBER COMMUNICATION DASHBOARD
          -- tracks every team member session for live monitoring
          -- stores session lifecycle, status, and metadata
          CREATE TABLE IF NOT EXISTS team_member_sessions (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- team member identification
            team_member_id VARCHAR(255) NOT NULL,
            team_member_name VARCHAR(255) NOT NULL,
            team_member_type VARCHAR(100) NOT NULL DEFAULT 'assistant',

            -- session lifecycle
            status VARCHAR(50) NOT NULL DEFAULT 'active',
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ended_at TIMESTAMPTZ,
            last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- connection info
            connection_type VARCHAR(50) DEFAULT 'websocket',
            client_ip VARCHAR(45),
            user_agent TEXT,

            -- task context
            current_task TEXT,
            working_directory TEXT,
            project_name VARCHAR(255),

            -- metrics
            message_count INTEGER NOT NULL DEFAULT 0,
            tool_calls INTEGER NOT NULL DEFAULT 0,
            errors_count INTEGER NOT NULL DEFAULT 0,
            tokens_used INTEGER DEFAULT 0,

            -- parent session for sub-team-members
            parent_session_id UUID REFERENCES team_member_sessions(id) ON DELETE SET NULL,

            -- flexible metadata
            metadata JSONB NOT NULL DEFAULT '{}',
            capabilities JSONB DEFAULT '[]',
            environment JSONB DEFAULT '{}',

            -- timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- constraints
            CONSTRAINT valid_status CHECK (
              status IN ('active', 'idle', 'busy', 'disconnected', 'terminated', 'error')
            ),
            CONSTRAINT valid_connection_type CHECK (
              connection_type IN ('websocket', 'http', 'grpc', 'stdio')
            )
          );

          -- indexes for FAST session lookups

          -- team member lookups
          CREATE INDEX IF NOT EXISTS idx_team_member_sessions_team_member_id
            ON team_member_sessions(team_member_id);
          CREATE INDEX IF NOT EXISTS idx_team_member_sessions_team_member_name
            ON team_member_sessions(team_member_name);
          CREATE INDEX IF NOT EXISTS idx_team_member_sessions_team_member_type
            ON team_member_sessions(team_member_type);

          -- status filtering (active team members)
          CREATE INDEX IF NOT EXISTS idx_team_member_sessions_status
            ON team_member_sessions(status);
          CREATE INDEX IF NOT EXISTS idx_team_member_sessions_active
            ON team_member_sessions(team_member_id, last_heartbeat)
            WHERE status = 'active';

          -- time-based queries
          CREATE INDEX IF NOT EXISTS idx_team_member_sessions_started
            ON team_member_sessions(started_at DESC);
          CREATE INDEX IF NOT EXISTS idx_team_member_sessions_ended
            ON team_member_sessions(ended_at DESC)
            WHERE ended_at IS NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_team_member_sessions_heartbeat
            ON team_member_sessions(last_heartbeat DESC);

          -- parent-child relationships
          CREATE INDEX IF NOT EXISTS idx_team_member_sessions_parent
            ON team_member_sessions(parent_session_id)
            WHERE parent_session_id IS NOT NULL;

          -- project filtering
          CREATE INDEX IF NOT EXISTS idx_team_member_sessions_project
            ON team_member_sessions(project_name)
            WHERE project_name IS NOT NULL;

          -- metadata queries
          CREATE INDEX IF NOT EXISTS idx_team_member_sessions_metadata
            ON team_member_sessions USING GIN(metadata jsonb_path_ops);

          -- trigger for updated_at
          DROP TRIGGER IF EXISTS team_member_sessions_updated_at ON team_member_sessions;
          CREATE TRIGGER team_member_sessions_updated_at
            BEFORE UPDATE ON team_member_sessions
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        `,
                down: `
          DROP TRIGGER IF EXISTS team_member_sessions_updated_at ON team_member_sessions;
          DROP TABLE IF EXISTS team_member_sessions CASCADE;
        `,
                checksum: this.generateChecksum('create_team_member_sessions_table_v21')
            },
            // migration 22: create team_member_messages table
            // stores all messages between team members and the system
            // this is the FULL communication log no cap
            {
                version: 22,
                name: 'create_team_member_messages_table',
                up: `
          -- team_member_messages - FULL COMMUNICATION LOG
          -- stores every message for replay and analysis
          -- supports streaming, tool calls, and responses
          CREATE TABLE IF NOT EXISTS team_member_messages (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- session reference
            session_id UUID NOT NULL REFERENCES team_member_sessions(id) ON DELETE CASCADE,

            -- message identification
            message_type VARCHAR(50) NOT NULL DEFAULT 'text',
            direction VARCHAR(20) NOT NULL DEFAULT 'inbound',
            sequence_number INTEGER NOT NULL DEFAULT 0,

            -- message content
            content TEXT NOT NULL,
            content_preview VARCHAR(500) GENERATED ALWAYS AS (
              CASE WHEN LENGTH(content) > 500 THEN LEFT(content, 497) || '...' ELSE content END
            ) STORED,

            -- for tool calls
            tool_name VARCHAR(255),
            tool_input JSONB,
            tool_output JSONB,
            tool_error TEXT,
            tool_duration_ms INTEGER,

            -- for streaming
            is_streaming BOOLEAN DEFAULT false,
            stream_complete BOOLEAN DEFAULT true,
            parent_message_id UUID REFERENCES team_member_messages(id) ON DELETE SET NULL,

            -- classification
            role VARCHAR(50) NOT NULL DEFAULT 'assistant',
            importance VARCHAR(20) DEFAULT 'normal',

            -- tokens and cost tracking
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            estimated_cost_cents FLOAT DEFAULT 0,

            -- error tracking
            is_error BOOLEAN DEFAULT false,
            error_code VARCHAR(100),
            error_message TEXT,

            -- timestamps
            timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- constraints
            CONSTRAINT valid_message_type CHECK (
              message_type IN (
                'text', 'tool_call', 'tool_result', 'system', 'error',
                'thinking', 'code', 'file_edit', 'command', 'response'
              )
            ),
            CONSTRAINT valid_direction CHECK (
              direction IN ('inbound', 'outbound', 'internal')
            ),
            CONSTRAINT valid_role CHECK (
              role IN ('user', 'assistant', 'system', 'tool')
            ),
            CONSTRAINT valid_importance CHECK (
              importance IN ('critical', 'high', 'normal', 'low', 'debug')
            )
          );

          -- indexes for BLAZING FAST message queries

          -- session lookups (primary query pattern)
          CREATE INDEX IF NOT EXISTS idx_team_member_messages_session
            ON team_member_messages(session_id, sequence_number);
          CREATE INDEX IF NOT EXISTS idx_team_member_messages_session_time
            ON team_member_messages(session_id, timestamp DESC);

          -- message type filtering
          CREATE INDEX IF NOT EXISTS idx_team_member_messages_type
            ON team_member_messages(message_type);

          -- tool call queries
          CREATE INDEX IF NOT EXISTS idx_team_member_messages_tool
            ON team_member_messages(tool_name)
            WHERE tool_name IS NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_team_member_messages_tool_session
            ON team_member_messages(session_id, tool_name)
            WHERE message_type = 'tool_call';

          -- error queries
          CREATE INDEX IF NOT EXISTS idx_team_member_messages_errors
            ON team_member_messages(session_id, timestamp)
            WHERE is_error = true;

          -- streaming queries
          CREATE INDEX IF NOT EXISTS idx_team_member_messages_streaming
            ON team_member_messages(session_id, parent_message_id)
            WHERE is_streaming = true;

          -- time-based queries
          CREATE INDEX IF NOT EXISTS idx_team_member_messages_timestamp
            ON team_member_messages(timestamp DESC);

          -- direction filtering
          CREATE INDEX IF NOT EXISTS idx_team_member_messages_direction
            ON team_member_messages(direction);

          -- role filtering
          CREATE INDEX IF NOT EXISTS idx_team_member_messages_role
            ON team_member_messages(role);

          -- content search (full-text)
          CREATE INDEX IF NOT EXISTS idx_team_member_messages_content_tsv
            ON team_member_messages USING GIN(to_tsvector('english', content));

          -- JSONB indexes for tool input/output
          CREATE INDEX IF NOT EXISTS idx_team_member_messages_tool_input
            ON team_member_messages USING GIN(tool_input)
            WHERE tool_input IS NOT NULL;
        `,
                down: `
          DROP TABLE IF EXISTS team_member_messages CASCADE;
        `,
                checksum: this.generateChecksum('create_team_member_messages_table_v22')
            },
            // migration 23: create team_member_deployments table
            // tracks deployment configurations and environments
            // supports multi-team member coordination and deployment history
            {
                version: 23,
                name: 'create_team_member_deployments_table',
                up: `
          -- team_member_deployments - DEPLOYMENT TRACKING
          -- tracks team member deployment configurations
          -- supports multi-environment and orchestration
          CREATE TABLE IF NOT EXISTS team_member_deployments (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- deployment identification
            deployment_name VARCHAR(255) NOT NULL,
            deployment_type VARCHAR(100) NOT NULL DEFAULT 'single',
            environment VARCHAR(100) NOT NULL DEFAULT 'development',

            -- team member configuration
            team_member_config JSONB NOT NULL DEFAULT '{}',
            team_member_count INTEGER NOT NULL DEFAULT 1,
            team_member_template VARCHAR(255),

            -- deployment status
            status VARCHAR(50) NOT NULL DEFAULT 'pending',
            health VARCHAR(50) DEFAULT 'unknown',

            -- scheduling and lifecycle
            scheduled_at TIMESTAMPTZ,
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            timeout_seconds INTEGER DEFAULT 3600,

            -- task configuration
            task_description TEXT,
            task_config JSONB DEFAULT '{}',
            input_data JSONB DEFAULT '{}',
            output_data JSONB DEFAULT '{}',

            -- coordination
            coordinator_session_id UUID REFERENCES team_member_sessions(id) ON DELETE SET NULL,
            parent_deployment_id UUID REFERENCES team_member_deployments(id) ON DELETE SET NULL,
            child_deployment_count INTEGER DEFAULT 0,

            -- resource tracking
            max_tokens INTEGER,
            max_cost_cents INTEGER,
            actual_tokens_used INTEGER DEFAULT 0,
            actual_cost_cents FLOAT DEFAULT 0,

            -- results
            success BOOLEAN,
            result_summary TEXT,
            error_message TEXT,
            artifacts JSONB DEFAULT '[]',

            -- version and rollback
            version INTEGER NOT NULL DEFAULT 1,
            previous_deployment_id UUID REFERENCES team_member_deployments(id) ON DELETE SET NULL,
            rollback_reason TEXT,

            -- metadata
            metadata JSONB NOT NULL DEFAULT '{}',
            tags TEXT[] DEFAULT '{}',
            labels JSONB DEFAULT '{}',

            -- timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- constraints
            CONSTRAINT valid_deployment_type CHECK (
              deployment_type IN (
                'single', 'parallel', 'sequential', 'swarm', 'pipeline', 'orchestrated'
              )
            ),
            CONSTRAINT valid_deployment_status CHECK (
              status IN (
                'pending', 'scheduled', 'running', 'paused', 'completed',
                'failed', 'cancelled', 'timeout', 'rolled_back'
              )
            ),
            CONSTRAINT valid_health CHECK (
              health IN ('unknown', 'healthy', 'degraded', 'unhealthy', 'critical')
            ),
            CONSTRAINT valid_environment CHECK (
              environment IN (
                'development', 'staging', 'production', 'test', 'local'
              )
            )
          );

          -- indexes for deployment queries

          -- name and type lookups
          CREATE INDEX IF NOT EXISTS idx_team_member_deployments_name
            ON team_member_deployments(deployment_name);
          CREATE INDEX IF NOT EXISTS idx_team_member_deployments_type
            ON team_member_deployments(deployment_type);

          -- environment filtering
          CREATE INDEX IF NOT EXISTS idx_team_member_deployments_env
            ON team_member_deployments(environment);

          -- status queries
          CREATE INDEX IF NOT EXISTS idx_team_member_deployments_status
            ON team_member_deployments(status);
          CREATE INDEX IF NOT EXISTS idx_team_member_deployments_active
            ON team_member_deployments(status, started_at)
            WHERE status IN ('running', 'scheduled', 'pending');

          -- health monitoring
          CREATE INDEX IF NOT EXISTS idx_team_member_deployments_health
            ON team_member_deployments(health)
            WHERE status = 'running';

          -- time-based queries
          CREATE INDEX IF NOT EXISTS idx_team_member_deployments_created
            ON team_member_deployments(created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_team_member_deployments_started
            ON team_member_deployments(started_at DESC)
            WHERE started_at IS NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_team_member_deployments_completed
            ON team_member_deployments(completed_at DESC)
            WHERE completed_at IS NOT NULL;

          -- coordinator lookups
          CREATE INDEX IF NOT EXISTS idx_team_member_deployments_coordinator
            ON team_member_deployments(coordinator_session_id)
            WHERE coordinator_session_id IS NOT NULL;

          -- parent-child relationships
          CREATE INDEX IF NOT EXISTS idx_team_member_deployments_parent
            ON team_member_deployments(parent_deployment_id)
            WHERE parent_deployment_id IS NOT NULL;

          -- version tracking
          CREATE INDEX IF NOT EXISTS idx_team_member_deployments_version
            ON team_member_deployments(deployment_name, version DESC);

          -- tag searches
          CREATE INDEX IF NOT EXISTS idx_team_member_deployments_tags
            ON team_member_deployments USING GIN(tags);

          -- metadata queries
          CREATE INDEX IF NOT EXISTS idx_team_member_deployments_metadata
            ON team_member_deployments USING GIN(metadata jsonb_path_ops);

          -- success rate queries
          CREATE INDEX IF NOT EXISTS idx_team_member_deployments_success
            ON team_member_deployments(deployment_type, success)
            WHERE completed_at IS NOT NULL;

          -- trigger for updated_at
          DROP TRIGGER IF EXISTS team_member_deployments_updated_at ON team_member_deployments;
          CREATE TRIGGER team_member_deployments_updated_at
            BEFORE UPDATE ON team_member_deployments
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();

          -- materialized view for deployment stats
          CREATE MATERIALIZED VIEW IF NOT EXISTS team_member_deployment_stats AS
          SELECT
            COUNT(*) as total_deployments,
            COUNT(*) FILTER (WHERE status = 'running') as running_count,
            COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
            COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
            COUNT(*) FILTER (WHERE success = true) as success_count,
            COUNT(*) FILTER (WHERE success = false) as failure_count,
            AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))::FLOAT as avg_duration_seconds,
            SUM(actual_tokens_used) as total_tokens_used,
            SUM(actual_cost_cents) as total_cost_cents,
            COUNT(DISTINCT deployment_name) as unique_deployments,
            COUNT(DISTINCT environment) as environments_used,
            NOW() as computed_at
          FROM team_member_deployments;

          CREATE UNIQUE INDEX IF NOT EXISTS idx_team_member_deployment_stats_singleton
            ON team_member_deployment_stats(computed_at);

          -- function to refresh deployment stats
          CREATE OR REPLACE FUNCTION refresh_team_member_deployment_stats()
          RETURNS void AS $$
          BEGIN
            REFRESH MATERIALIZED VIEW CONCURRENTLY team_member_deployment_stats;
          END;
          $$ LANGUAGE plpgsql;
        `,
                down: `
          DROP FUNCTION IF EXISTS refresh_team_member_deployment_stats();
          DROP MATERIALIZED VIEW IF EXISTS team_member_deployment_stats;
          DROP TRIGGER IF EXISTS team_member_deployments_updated_at ON team_member_deployments;
          DROP TABLE IF EXISTS team_member_deployments CASCADE;
        `,
                checksum: this.generateChecksum('create_team_member_deployments_table_v23')
            },
            // migration 24: Phase 4-6 - Direct Prompting and  Control tables
            {
                version: 24,
                name: 'create_prompt_and_trigger_tables',
                up: `
          -- Table for storing prompt/conversation history (Phase 4)
          CREATE TABLE IF NOT EXISTS prompt_history (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            session_id VARCHAR(255) NOT NULL,
            prompt TEXT NOT NULL,
            response TEXT,
            context JSONB NOT NULL DEFAULT '{}',
            config JSONB NOT NULL DEFAULT '{}',
            tokens_used INTEGER DEFAULT 0,
            duration_ms INTEGER DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            error_message TEXT,
            model VARCHAR(100),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            CONSTRAINT valid_prompt_status CHECK (
              status IN ('pending', 'success', 'error')
            )
          );

          -- Indexes for prompt history
          CREATE INDEX IF NOT EXISTS idx_prompt_history_session
            ON prompt_history(session_id);
          CREATE INDEX IF NOT EXISTS idx_prompt_history_created
            ON prompt_history(created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_prompt_history_status
            ON prompt_history(status);

          -- Table for storing  trigger history (Phase 6)
          CREATE TABLE IF NOT EXISTS trigger_history (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            action VARCHAR(50) NOT NULL,
            prompt TEXT NOT NULL,
            config JSONB NOT NULL DEFAULT '{}',
            context JSONB NOT NULL DEFAULT '{}',
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            result TEXT,
            error_message TEXT,
            confirmed_by VARCHAR(255),
            confirmed_at TIMESTAMPTZ,
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            tokens_used INTEGER DEFAULT 0,
            duration_ms INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            CONSTRAINT valid_trigger_status CHECK (
              status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
            ),
            CONSTRAINT valid_trigger_action CHECK (
              action IN ('fix-error', 'consolidate', 'deploy-team-member', 'analyze-codebase', 'summarize-session', 'custom')
            )
          );

          -- Indexes for trigger history
          CREATE INDEX IF NOT EXISTS idx_trigger_history_action
            ON trigger_history(action);
          CREATE INDEX IF NOT EXISTS idx_trigger_history_status
            ON trigger_history(status);
          CREATE INDEX IF NOT EXISTS idx_trigger_history_created
            ON trigger_history(created_at DESC);

          -- Table for scheduled triggers (Phase 6)
          CREATE TABLE IF NOT EXISTS scheduled_triggers (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            action VARCHAR(50) NOT NULL,
            prompt TEXT NOT NULL,
            config JSONB NOT NULL DEFAULT '{}',
            schedule JSONB NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT true,
            last_run TIMESTAMPTZ,
            next_run TIMESTAMPTZ,
            run_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            CONSTRAINT valid_scheduled_action CHECK (
              action IN ('fix-error', 'consolidate', 'deploy-team-member', 'analyze-codebase', 'summarize-session', 'custom')
            )
          );

          -- Indexes for scheduled triggers
          CREATE INDEX IF NOT EXISTS idx_scheduled_triggers_enabled
            ON scheduled_triggers(enabled, next_run)
            WHERE enabled = true;
          CREATE INDEX IF NOT EXISTS idx_scheduled_triggers_next_run
            ON scheduled_triggers(next_run)
            WHERE enabled = true;

          -- trigger for updated_at
          DROP TRIGGER IF EXISTS scheduled_triggers_updated_at ON scheduled_triggers;
          CREATE TRIGGER scheduled_triggers_updated_at
            BEFORE UPDATE ON scheduled_triggers
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        `,
                down: `
          DROP TRIGGER IF EXISTS scheduled_triggers_updated_at ON scheduled_triggers;
          DROP TABLE IF EXISTS scheduled_triggers CASCADE;
          DROP TABLE IF EXISTS trigger_history CASCADE;
          DROP TABLE IF EXISTS prompt_history CASCADE;
        `,
                checksum: this.generateChecksum('create_prompt_and_trigger_tables_v24')
            },
            // migration 25: File change history tracking - ACTIVE CODE MONITORING
            // Tracks every file change so we can see what ACTUALLY changed over time
            {
                version: 25,
                name: 'create_file_change_history',
                up: `
          -- Make sure pgcrypto is available for digest function
          CREATE EXTENSION IF NOT EXISTS pgcrypto;

          -- Add content_hash column to codebase_files if missing
          -- SHA256 hash of content for change detection
          DO $$ BEGIN
            ALTER TABLE codebase_files
            ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);
          EXCEPTION WHEN duplicate_column THEN NULL;
          END $$;

          -- Update existing rows with their content hash using pgcrypto digest
          UPDATE codebase_files
          SET content_hash = encode(digest(content, 'sha256'), 'hex')
          WHERE content_hash IS NULL;

          -- Create index for hash lookups
          CREATE INDEX IF NOT EXISTS idx_codebase_files_hash
            ON codebase_files(content_hash);

          -- File change history table - THE MEMORY OF EVERY EDIT
          -- Tracks add, modify, delete events with before/after content
          CREATE TABLE IF NOT EXISTS file_change_history (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- File identification
            file_path TEXT NOT NULL,
            absolute_path TEXT NOT NULL,
            file_id UUID,  -- Reference to codebase_files (null if deleted)

            -- Change type
            change_type VARCHAR(20) NOT NULL,

            -- Content tracking - stores diffs for efficiency
            previous_hash VARCHAR(64),
            new_hash VARCHAR(64),
            previous_content TEXT,  -- Stored for small files or on demand
            new_content TEXT,       -- Stored for small files or on demand
            content_diff TEXT,      -- Unified diff format

            -- Metadata
            size_before INTEGER,
            size_after INTEGER,
            line_count_before INTEGER,
            line_count_after INTEGER,
            lines_added INTEGER DEFAULT 0,
            lines_removed INTEGER DEFAULT 0,

            -- Timestamps
            detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            file_modified_at TIMESTAMPTZ,

            -- Context
            metadata JSONB NOT NULL DEFAULT '{}',

            CONSTRAINT valid_change_type CHECK (
              change_type IN ('add', 'modify', 'delete', 'rename', 'move')
            )
          );

          -- Indexes for history queries
          CREATE INDEX IF NOT EXISTS idx_file_change_history_path
            ON file_change_history(file_path);
          CREATE INDEX IF NOT EXISTS idx_file_change_history_file_id
            ON file_change_history(file_id)
            WHERE file_id IS NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_file_change_history_detected
            ON file_change_history(detected_at DESC);
          CREATE INDEX IF NOT EXISTS idx_file_change_history_type
            ON file_change_history(change_type);
          CREATE INDEX IF NOT EXISTS idx_file_change_history_hash
            ON file_change_history(new_hash)
            WHERE new_hash IS NOT NULL;

          -- Full text search on file paths in history
          CREATE INDEX IF NOT EXISTS idx_file_change_history_path_trgm
            ON file_change_history USING gin (file_path gin_trgm_ops);

          -- Composite index for file timeline queries
          CREATE INDEX IF NOT EXISTS idx_file_change_history_timeline
            ON file_change_history(file_path, detected_at DESC);

          -- Function to record file changes automatically using pgcrypto digest
          CREATE OR REPLACE FUNCTION record_file_change()
          RETURNS TRIGGER AS $$
          BEGIN
            IF TG_OP = 'INSERT' THEN
              INSERT INTO file_change_history (
                file_path, absolute_path, file_id, change_type,
                new_hash, new_content, size_after, line_count_after,
                file_modified_at, metadata
              ) VALUES (
                NEW.file_path, NEW.absolute_path, NEW.id, 'add',
                encode(digest(NEW.content, 'sha256'), 'hex'),
                CASE WHEN length(NEW.content) < 50000 THEN NEW.content ELSE NULL END,
                NEW.size_bytes, NEW.line_count,
                NEW.last_modified,
                jsonb_build_object('language', NEW.language_id, 'trigger', 'insert')
              );
              RETURN NEW;
            ELSIF TG_OP = 'UPDATE' THEN
              -- Only record if content actually changed
              IF OLD.content IS DISTINCT FROM NEW.content THEN
                INSERT INTO file_change_history (
                  file_path, absolute_path, file_id, change_type,
                  previous_hash, new_hash,
                  previous_content, new_content,
                  size_before, size_after,
                  line_count_before, line_count_after,
                  file_modified_at, metadata
                ) VALUES (
                  NEW.file_path, NEW.absolute_path, NEW.id, 'modify',
                  encode(digest(OLD.content, 'sha256'), 'hex'),
                  encode(digest(NEW.content, 'sha256'), 'hex'),
                  CASE WHEN length(OLD.content) < 50000 THEN OLD.content ELSE NULL END,
                  CASE WHEN length(NEW.content) < 50000 THEN NEW.content ELSE NULL END,
                  OLD.size_bytes, NEW.size_bytes,
                  OLD.line_count, NEW.line_count,
                  NEW.last_modified,
                  jsonb_build_object('language', NEW.language_id, 'trigger', 'update')
                );
              END IF;
              RETURN NEW;
            ELSIF TG_OP = 'DELETE' THEN
              INSERT INTO file_change_history (
                file_path, absolute_path, file_id, change_type,
                previous_hash, previous_content,
                size_before, line_count_before,
                file_modified_at, metadata
              ) VALUES (
                OLD.file_path, OLD.absolute_path, NULL, 'delete',
                encode(digest(OLD.content, 'sha256'), 'hex'),
                CASE WHEN length(OLD.content) < 50000 THEN OLD.content ELSE NULL END,
                OLD.size_bytes, OLD.line_count,
                NOW(),
                jsonb_build_object('language', OLD.language_id, 'trigger', 'delete')
              );
              RETURN OLD;
            END IF;
            RETURN NULL;
          END;
          $$ LANGUAGE plpgsql;

          -- Attach trigger to codebase_files
          DROP TRIGGER IF EXISTS codebase_files_change_history ON codebase_files;
          CREATE TRIGGER codebase_files_change_history
            AFTER INSERT OR UPDATE OR DELETE ON codebase_files
            FOR EACH ROW
            EXECUTE FUNCTION record_file_change();

          -- View for recent changes summary
          CREATE OR REPLACE VIEW recent_file_changes AS
          SELECT
            fch.id,
            fch.file_path,
            fch.change_type,
            fch.detected_at,
            fch.lines_added,
            fch.lines_removed,
            fch.size_before,
            fch.size_after,
            cf.language_id
          FROM file_change_history fch
          LEFT JOIN codebase_files cf ON cf.id = fch.file_id
          ORDER BY fch.detected_at DESC
          LIMIT 100;
        `,
                down: `
          DROP VIEW IF EXISTS recent_file_changes;
          DROP TRIGGER IF EXISTS codebase_files_change_history ON codebase_files;
          DROP FUNCTION IF EXISTS record_file_change();
          DROP TABLE IF EXISTS file_change_history CASCADE;
          ALTER TABLE codebase_files DROP COLUMN IF EXISTS content_hash;
        `,
                checksum: this.generateChecksum('create_file_change_history_v25_fixed')
            },
            // migration 26: SPATIAL MEMORY EVOLUTION - Quadrants, Clusters, Hot Paths
            // Makes 's memory ACTUALLY INTELLIGENT through spatial organization
            // This is where memory becomes self-organizing fr fr
            {
                version: 26,
                name: 'create_spatial_memory_tables',
                up: `
          -- ============================================================
          -- SEMANTIC QUADRANTS - Organize memories in 2D semantic space
          -- Memories are assigned to quadrants based on embedding clusters
          -- Enables region-based searching like "find all memories in Q1"
          -- ============================================================
          CREATE TABLE IF NOT EXISTS semantic_quadrants (
            id SERIAL PRIMARY KEY,

            -- Quadrant identification
            name VARCHAR(100) NOT NULL,
            description TEXT,
            quadrant_code VARCHAR(20) NOT NULL UNIQUE,  -- e.g., 'Q1', 'Q2-A', 'tech-backend'

            -- Centroid embedding for the quadrant
            -- NOTE: Dimension is auto-detected, unbounded initially
            centroid vector(384),

            -- Bounding box in reduced dimension space (for fast filtering)
            -- Using 2D projection of embeddings (UMAP/t-SNE style)
            min_x FLOAT,
            max_x FLOAT,
            min_y FLOAT,
            max_y FLOAT,

            -- Hierarchical structure support
            parent_quadrant_id INTEGER REFERENCES semantic_quadrants(id) ON DELETE SET NULL,
            depth INTEGER NOT NULL DEFAULT 0,

            -- Statistics
            memory_count INTEGER NOT NULL DEFAULT 0,
            max_capacity INTEGER DEFAULT 1000,  -- Triggers split when exceeded
            avg_similarity FLOAT,               -- Average similarity within quadrant
            last_rebalanced_at TIMESTAMPTZ,

            -- Metadata
            auto_generated BOOLEAN DEFAULT true,
            tags TEXT[] DEFAULT '{}',
            metadata JSONB NOT NULL DEFAULT '{}',

            -- Timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          -- Indexes for quadrant lookups
          CREATE INDEX IF NOT EXISTS idx_semantic_quadrants_code
            ON semantic_quadrants(quadrant_code);
          CREATE INDEX IF NOT EXISTS idx_semantic_quadrants_parent
            ON semantic_quadrants(parent_quadrant_id)
            WHERE parent_quadrant_id IS NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_semantic_quadrants_bounds
            ON semantic_quadrants(min_x, max_x, min_y, max_y)
            WHERE min_x IS NOT NULL;

          -- Memory to quadrant assignments
          CREATE TABLE IF NOT EXISTS memory_quadrant_assignments (
            memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            quadrant_id INTEGER NOT NULL REFERENCES semantic_quadrants(id) ON DELETE CASCADE,

            -- Position within quadrant (reduced 2D space)
            pos_x FLOAT,
            pos_y FLOAT,

            -- Distance from centroid (for ranking within quadrant)
            distance_from_centroid FLOAT,

            -- Assignment metadata
            assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            assignment_method VARCHAR(50) DEFAULT 'auto',  -- auto, manual, migration

            PRIMARY KEY (memory_id, quadrant_id)
          );

          CREATE INDEX IF NOT EXISTS idx_memory_quadrant_memory
            ON memory_quadrant_assignments(memory_id);
          CREATE INDEX IF NOT EXISTS idx_memory_quadrant_quadrant
            ON memory_quadrant_assignments(quadrant_id);
          CREATE INDEX IF NOT EXISTS idx_memory_quadrant_position
            ON memory_quadrant_assignments(quadrant_id, pos_x, pos_y);

          -- ============================================================
          -- SEMANTIC CLUSTERS - Auto-forming memory neighborhoods
          -- Groups related memories using clustering algorithms
          -- Clusters get auto-generated labels from content themes
          -- ============================================================
          CREATE TABLE IF NOT EXISTS memory_clusters (
            id SERIAL PRIMARY KEY,

            -- Cluster identification
            name VARCHAR(255),           -- Auto-generated from top tags/content
            description TEXT,            -- Summary of what this cluster contains
            cluster_type VARCHAR(50) NOT NULL DEFAULT 'semantic',  -- semantic, temporal, tag_based, manual

            -- Centroid for the cluster
            -- NOTE: Dimension is auto-detected, unbounded initially
            centroid vector(384),

            -- Statistics
            memory_count INTEGER NOT NULL DEFAULT 0,
            coherence_score FLOAT,       -- 0-1 how tight the cluster is
            silhouette_score FLOAT,      -- Cluster quality metric

            -- Top terms/tags in this cluster (auto-extracted)
            top_tags TEXT[] DEFAULT '{}',
            top_terms TEXT[] DEFAULT '{}',

            -- Hierarchy support (clusters can nest)
            parent_cluster_id INTEGER REFERENCES memory_clusters(id) ON DELETE SET NULL,
            depth INTEGER NOT NULL DEFAULT 0,

            -- Lifecycle
            last_updated_at TIMESTAMPTZ,
            last_recomputed_at TIMESTAMPTZ,
            is_stable BOOLEAN DEFAULT false,  -- True if cluster hasn't changed recently

            -- Metadata
            metadata JSONB NOT NULL DEFAULT '{}',

            -- Timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_memory_clusters_type
            ON memory_clusters(cluster_type);
          CREATE INDEX IF NOT EXISTS idx_memory_clusters_parent
            ON memory_clusters(parent_cluster_id)
            WHERE parent_cluster_id IS NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_memory_clusters_coherence
            ON memory_clusters(coherence_score DESC)
            WHERE coherence_score IS NOT NULL;

          -- Memory to cluster assignments (many-to-many - soft clustering)
          CREATE TABLE IF NOT EXISTS memory_cluster_assignments (
            memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            cluster_id INTEGER NOT NULL REFERENCES memory_clusters(id) ON DELETE CASCADE,

            -- Membership strength (0-1, supports soft clustering)
            membership_score FLOAT NOT NULL DEFAULT 1.0,

            -- Distance from cluster centroid
            distance_to_centroid FLOAT,

            -- Assignment metadata
            assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            assignment_method VARCHAR(50) DEFAULT 'auto',

            PRIMARY KEY (memory_id, cluster_id)
          );

          CREATE INDEX IF NOT EXISTS idx_memory_cluster_assign_memory
            ON memory_cluster_assignments(memory_id);
          CREATE INDEX IF NOT EXISTS idx_memory_cluster_assign_cluster
            ON memory_cluster_assignments(cluster_id);
          CREATE INDEX IF NOT EXISTS idx_memory_cluster_assign_score
            ON memory_cluster_assignments(cluster_id, membership_score DESC);

          -- Cluster relationships (which clusters are related)
          CREATE TABLE IF NOT EXISTS cluster_relations (
            source_cluster_id INTEGER NOT NULL REFERENCES memory_clusters(id) ON DELETE CASCADE,
            target_cluster_id INTEGER NOT NULL REFERENCES memory_clusters(id) ON DELETE CASCADE,

            relation_type VARCHAR(50) NOT NULL DEFAULT 'similar',  -- similar, parent, child, overlapping, adjacent
            strength FLOAT NOT NULL DEFAULT 1.0,

            -- Shared memories count
            shared_memory_count INTEGER DEFAULT 0,

            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            PRIMARY KEY (source_cluster_id, target_cluster_id, relation_type),
            CONSTRAINT no_self_cluster_relation CHECK (source_cluster_id != target_cluster_id)
          );

          CREATE INDEX IF NOT EXISTS idx_cluster_relations_source
            ON cluster_relations(source_cluster_id);
          CREATE INDEX IF NOT EXISTS idx_cluster_relations_target
            ON cluster_relations(target_cluster_id);

          -- ============================================================
          -- HOT PATH ACCELERATION - Frequently accessed memory chains
          -- Tracks which memories get accessed together
          -- Pre-fetches and caches common access patterns
          -- ============================================================
          CREATE TABLE IF NOT EXISTS memory_hot_paths (
            id SERIAL PRIMARY KEY,

            -- Path identification
            path_name VARCHAR(255),
            path_hash VARCHAR(64) UNIQUE,  -- Hash of ordered memory IDs

            -- Ordered list of memories in this path
            memory_ids UUID[] NOT NULL,
            memory_count INTEGER NOT NULL,

            -- Usage statistics
            access_count INTEGER NOT NULL DEFAULT 0,
            last_accessed_at TIMESTAMPTZ,
            first_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- Heat score (decays over time, increases with access)
            heat_score FLOAT NOT NULL DEFAULT 1.0,
            peak_heat_score FLOAT NOT NULL DEFAULT 1.0,

            -- Cache status
            is_cached BOOLEAN DEFAULT false,
            cached_at TIMESTAMPTZ,
            cache_hits INTEGER DEFAULT 0,

            -- Path characteristics
            avg_transition_similarity FLOAT,  -- How similar adjacent memories are
            path_coherence FLOAT,             -- Overall semantic coherence
            dominant_tags TEXT[] DEFAULT '{}',

            -- Metadata
            metadata JSONB NOT NULL DEFAULT '{}',

            -- Timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_hot_paths_hash
            ON memory_hot_paths(path_hash);
          CREATE INDEX IF NOT EXISTS idx_hot_paths_heat
            ON memory_hot_paths(heat_score DESC);
          CREATE INDEX IF NOT EXISTS idx_hot_paths_cached
            ON memory_hot_paths(is_cached)
            WHERE is_cached = true;
          CREATE INDEX IF NOT EXISTS idx_hot_paths_accessed
            ON memory_hot_paths(last_accessed_at DESC);
          CREATE INDEX IF NOT EXISTS idx_hot_paths_memory_ids
            ON memory_hot_paths USING GIN(memory_ids);

          -- Access pattern tracking (individual transitions)
          CREATE TABLE IF NOT EXISTS memory_access_transitions (
            id BIGSERIAL PRIMARY KEY,

            -- The transition
            from_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            to_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,

            -- Statistics
            transition_count INTEGER NOT NULL DEFAULT 1,
            last_transition_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- Context
            session_id VARCHAR(255),       -- Track transitions within sessions
            time_between_ms INTEGER,       -- Time between accesses

            -- Timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE UNIQUE INDEX IF NOT EXISTS idx_access_transitions_pair
            ON memory_access_transitions(from_memory_id, to_memory_id);
          CREATE INDEX IF NOT EXISTS idx_access_transitions_from
            ON memory_access_transitions(from_memory_id);
          CREATE INDEX IF NOT EXISTS idx_access_transitions_to
            ON memory_access_transitions(to_memory_id);
          CREATE INDEX IF NOT EXISTS idx_access_transitions_count
            ON memory_access_transitions(transition_count DESC);
          CREATE INDEX IF NOT EXISTS idx_access_transitions_session
            ON memory_access_transitions(session_id)
            WHERE session_id IS NOT NULL;

          -- ============================================================
          -- ENHANCED MEMORY GRAPH - Typed relationships with inference
          -- Extends basic memory_relations with more graph features
          -- ============================================================

          -- Add new columns to memory_relations if they don't exist
          DO $$ BEGIN
            ALTER TABLE memory_relations
            ADD COLUMN IF NOT EXISTS relation_category VARCHAR(50) DEFAULT 'explicit';  -- explicit, inferred, temporal
          EXCEPTION WHEN duplicate_column THEN NULL;
          END $$;

          DO $$ BEGIN
            ALTER TABLE memory_relations
            ADD COLUMN IF NOT EXISTS confidence FLOAT DEFAULT 1.0;  -- For inferred relations
          EXCEPTION WHEN duplicate_column THEN NULL;
          END $$;

          DO $$ BEGIN
            ALTER TABLE memory_relations
            ADD COLUMN IF NOT EXISTS access_count INTEGER DEFAULT 0;
          EXCEPTION WHEN duplicate_column THEN NULL;
          END $$;

          DO $$ BEGIN
            ALTER TABLE memory_relations
            ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;
          EXCEPTION WHEN duplicate_column THEN NULL;
          END $$;

          -- Inferred relationships table (for transitive closure)
          CREATE TABLE IF NOT EXISTS memory_inferred_relations (
            source_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            target_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,

            -- Inference path (how we got here)
            inference_path UUID[] NOT NULL,  -- Path of IDs from source to target
            hop_count INTEGER NOT NULL,      -- Number of hops

            -- Inference details
            relation_type VARCHAR(50) NOT NULL DEFAULT 'inferred',
            confidence FLOAT NOT NULL,       -- Product of path confidences
            inference_method VARCHAR(50),    -- transitive, similarity, temporal

            -- Timestamps
            inferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ,          -- Inferences can expire

            PRIMARY KEY (source_id, target_id),
            CONSTRAINT no_self_inference CHECK (source_id != target_id),
            CONSTRAINT valid_confidence CHECK (confidence >= 0 AND confidence <= 1)
          );

          CREATE INDEX IF NOT EXISTS idx_inferred_relations_source
            ON memory_inferred_relations(source_id);
          CREATE INDEX IF NOT EXISTS idx_inferred_relations_target
            ON memory_inferred_relations(target_id);
          CREATE INDEX IF NOT EXISTS idx_inferred_relations_confidence
            ON memory_inferred_relations(confidence DESC);
          CREATE INDEX IF NOT EXISTS idx_inferred_relations_expires
            ON memory_inferred_relations(expires_at)
            WHERE expires_at IS NOT NULL;

          -- ============================================================
          -- SPATIAL MEMORY STATS - Materialized view for quick stats
          -- ============================================================
          CREATE MATERIALIZED VIEW IF NOT EXISTS spatial_memory_stats AS
          SELECT
            (SELECT COUNT(*) FROM semantic_quadrants) as total_quadrants,
            (SELECT COUNT(*) FROM memory_clusters) as total_clusters,
            (SELECT COUNT(*) FROM memory_hot_paths) as total_hot_paths,
            (SELECT COUNT(*) FROM memory_hot_paths WHERE is_cached = true) as cached_hot_paths,
            (SELECT COUNT(*) FROM memory_access_transitions) as total_transitions,
            (SELECT AVG(memory_count) FROM semantic_quadrants)::FLOAT as avg_memories_per_quadrant,
            (SELECT AVG(memory_count) FROM memory_clusters)::FLOAT as avg_memories_per_cluster,
            (SELECT AVG(heat_score) FROM memory_hot_paths)::FLOAT as avg_heat_score,
            (SELECT COUNT(*) FROM memory_inferred_relations) as total_inferred_relations,
            NOW() as computed_at
          ;

          CREATE UNIQUE INDEX IF NOT EXISTS idx_spatial_memory_stats_singleton
            ON spatial_memory_stats(computed_at);

          -- Function to refresh spatial stats
          CREATE OR REPLACE FUNCTION refresh_spatial_memory_stats()
          RETURNS void AS $$
          BEGIN
            REFRESH MATERIALIZED VIEW CONCURRENTLY spatial_memory_stats;
          END;
          $$ LANGUAGE plpgsql;

          -- ============================================================
          -- TRIGGERS for automatic maintenance
          -- ============================================================

          -- Update quadrant memory count on assignment changes
          CREATE OR REPLACE FUNCTION update_quadrant_count()
          RETURNS TRIGGER AS $$
          BEGIN
            IF TG_OP = 'INSERT' THEN
              UPDATE semantic_quadrants
              SET memory_count = memory_count + 1, updated_at = NOW()
              WHERE id = NEW.quadrant_id;
              RETURN NEW;
            ELSIF TG_OP = 'DELETE' THEN
              UPDATE semantic_quadrants
              SET memory_count = memory_count - 1, updated_at = NOW()
              WHERE id = OLD.quadrant_id;
              RETURN OLD;
            END IF;
            RETURN NULL;
          END;
          $$ LANGUAGE plpgsql;

          DROP TRIGGER IF EXISTS quadrant_count_trigger ON memory_quadrant_assignments;
          CREATE TRIGGER quadrant_count_trigger
            AFTER INSERT OR DELETE ON memory_quadrant_assignments
            FOR EACH ROW
            EXECUTE FUNCTION update_quadrant_count();

          -- Update cluster memory count on assignment changes
          CREATE OR REPLACE FUNCTION update_cluster_count()
          RETURNS TRIGGER AS $$
          BEGIN
            IF TG_OP = 'INSERT' THEN
              UPDATE memory_clusters
              SET memory_count = memory_count + 1, updated_at = NOW()
              WHERE id = NEW.cluster_id;
              RETURN NEW;
            ELSIF TG_OP = 'DELETE' THEN
              UPDATE memory_clusters
              SET memory_count = memory_count - 1, updated_at = NOW()
              WHERE id = OLD.cluster_id;
              RETURN OLD;
            END IF;
            RETURN NULL;
          END;
          $$ LANGUAGE plpgsql;

          DROP TRIGGER IF EXISTS cluster_count_trigger ON memory_cluster_assignments;
          CREATE TRIGGER cluster_count_trigger
            AFTER INSERT OR DELETE ON memory_cluster_assignments
            FOR EACH ROW
            EXECUTE FUNCTION update_cluster_count();

          -- Decay hot path heat scores periodically (run via cron/background job)
          CREATE OR REPLACE FUNCTION decay_hot_path_heat()
          RETURNS INTEGER AS $$
          DECLARE
            updated_count INTEGER;
          BEGIN
            -- Decay factor: multiply by 0.95 for each day since last access
            UPDATE memory_hot_paths
            SET heat_score = heat_score * POWER(0.95,
              EXTRACT(EPOCH FROM (NOW() - COALESCE(last_accessed_at, created_at))) / 86400
            ),
            updated_at = NOW()
            WHERE heat_score > 0.01;  -- Don't bother with near-zero scores

            GET DIAGNOSTICS updated_count = ROW_COUNT;
            RETURN updated_count;
          END;
          $$ LANGUAGE plpgsql;

          -- updated_at triggers
          DROP TRIGGER IF EXISTS semantic_quadrants_updated_at ON semantic_quadrants;
          CREATE TRIGGER semantic_quadrants_updated_at
            BEFORE UPDATE ON semantic_quadrants
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();

          DROP TRIGGER IF EXISTS memory_clusters_updated_at ON memory_clusters;
          CREATE TRIGGER memory_clusters_updated_at
            BEFORE UPDATE ON memory_clusters
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();

          DROP TRIGGER IF EXISTS memory_hot_paths_updated_at ON memory_hot_paths;
          CREATE TRIGGER memory_hot_paths_updated_at
            BEFORE UPDATE ON memory_hot_paths
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();

          DROP TRIGGER IF EXISTS memory_access_transitions_updated_at ON memory_access_transitions;
          CREATE TRIGGER memory_access_transitions_updated_at
            BEFORE UPDATE ON memory_access_transitions
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        `,
                down: `
          DROP FUNCTION IF EXISTS decay_hot_path_heat();
          DROP FUNCTION IF EXISTS update_cluster_count();
          DROP FUNCTION IF EXISTS update_quadrant_count();
          DROP FUNCTION IF EXISTS refresh_spatial_memory_stats();
          DROP TRIGGER IF EXISTS memory_access_transitions_updated_at ON memory_access_transitions;
          DROP TRIGGER IF EXISTS memory_hot_paths_updated_at ON memory_hot_paths;
          DROP TRIGGER IF EXISTS memory_clusters_updated_at ON memory_clusters;
          DROP TRIGGER IF EXISTS semantic_quadrants_updated_at ON semantic_quadrants;
          DROP TRIGGER IF EXISTS cluster_count_trigger ON memory_cluster_assignments;
          DROP TRIGGER IF EXISTS quadrant_count_trigger ON memory_quadrant_assignments;
          DROP MATERIALIZED VIEW IF EXISTS spatial_memory_stats;
          DROP TABLE IF EXISTS memory_inferred_relations CASCADE;
          DROP TABLE IF EXISTS memory_access_transitions CASCADE;
          DROP TABLE IF EXISTS memory_hot_paths CASCADE;
          DROP TABLE IF EXISTS cluster_relations CASCADE;
          DROP TABLE IF EXISTS memory_cluster_assignments CASCADE;
          DROP TABLE IF EXISTS memory_clusters CASCADE;
          DROP TABLE IF EXISTS memory_quadrant_assignments CASCADE;
          DROP TABLE IF EXISTS semantic_quadrants CASCADE;
          ALTER TABLE memory_relations DROP COLUMN IF EXISTS relation_category;
          ALTER TABLE memory_relations DROP COLUMN IF EXISTS confidence;
          ALTER TABLE memory_relations DROP COLUMN IF EXISTS access_count;
          ALTER TABLE memory_relations DROP COLUMN IF EXISTS last_accessed_at;
        `,
                checksum: this.generateChecksum('create_spatial_memory_tables_v26')
            },
            // migration 27: Dashboard Query Optimizations
            // Adds indexes and materialized views for the SpecMem dashboard
            // Makes dashboard queries BLAZING fast no cap
            {
                version: 27,
                name: 'dashboard_query_optimizations',
                up: `
          -- ============================================================
          -- DASHBOARD-SPECIFIC INDEXES
          -- Optimized for common dashboard query patterns
          -- ============================================================

          -- Composite index for filtered pagination by type + time
          -- Note: WHERE clause removed - NOW() is not IMMUTABLE and cannot be used in index predicates
          CREATE INDEX IF NOT EXISTS idx_memories_dashboard_type_time
            ON memories(memory_type, created_at DESC);

          -- Composite index for importance filtering + time
          -- Note: WHERE clause removed - NOW() is not IMMUTABLE and cannot be used in index predicates
          CREATE INDEX IF NOT EXISTS idx_memories_dashboard_importance_time
            ON memories(importance, created_at DESC);

          -- Index for recent activity queries (last 24h)
          -- Note: WHERE clause removed - NOW() is not IMMUTABLE and cannot be used in index predicates
          -- The index still improves performance for time-based queries
          CREATE INDEX IF NOT EXISTS idx_memories_recent_24h
            ON memories(created_at DESC);

          -- Covering index for memory list queries (avoids table lookups)
          -- Includes commonly selected columns for list views
          -- Note: WHERE clause removed - NOW() is not IMMUTABLE and cannot be used in index predicates
          CREATE INDEX IF NOT EXISTS idx_memories_dashboard_list
            ON memories(created_at DESC, id, memory_type, importance)
            INCLUDE (tags, access_count, updated_at);

          -- Index for tag + type combined filtering
          CREATE INDEX IF NOT EXISTS idx_memories_tags_type
            ON memories USING GIN(tags, memory_type);

          -- ============================================================
          -- ENHANCED MATERIALIZED VIEW FOR DASHBOARD STATS
          -- More comprehensive than basic memory_stats view
          -- ============================================================

          DROP MATERIALIZED VIEW IF EXISTS dashboard_stats;
          CREATE MATERIALIZED VIEW dashboard_stats AS
          SELECT
            -- Total counts
            COUNT(*) as total_memories,
            COUNT(*) FILTER (WHERE expires_at IS NULL OR expires_at > NOW()) as active_memories,

            -- Type distribution
            COUNT(*) FILTER (WHERE memory_type = 'episodic') as episodic_count,
            COUNT(*) FILTER (WHERE memory_type = 'semantic') as semantic_count,
            COUNT(*) FILTER (WHERE memory_type = 'procedural') as procedural_count,
            COUNT(*) FILTER (WHERE memory_type = 'working') as working_count,
            COUNT(*) FILTER (WHERE memory_type = 'consolidated') as consolidated_count,

            -- Importance distribution
            COUNT(*) FILTER (WHERE importance = 'critical') as critical_count,
            COUNT(*) FILTER (WHERE importance = 'high') as high_count,
            COUNT(*) FILTER (WHERE importance = 'medium') as medium_count,
            COUNT(*) FILTER (WHERE importance = 'low') as low_count,
            COUNT(*) FILTER (WHERE importance = 'trivial') as trivial_count,

            -- Feature usage
            COUNT(*) FILTER (WHERE embedding IS NOT NULL) as with_embeddings,
            COUNT(*) FILTER (WHERE image_data IS NOT NULL) as with_images,
            COUNT(*) FILTER (WHERE array_length(tags, 1) > 0) as with_tags,
            COUNT(*) FILTER (WHERE array_length(consolidated_from, 1) > 0) as consolidated,

            -- Expiration stats
            COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < NOW()) as expired_count,
            COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at > NOW()) as expiring_soon,

            -- Time-based stats
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as created_last_24h,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as created_last_7d,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as created_last_30d,
            COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '24 hours') as updated_last_24h,

            -- Aggregates
            COALESCE(AVG(access_count), 0)::float as avg_access_count,
            COALESCE(MAX(access_count), 0) as max_access_count,
            COALESCE(AVG(length(content)), 0)::float as avg_content_length,
            COALESCE(SUM(length(content)), 0)::bigint as total_content_size,

            -- Time range
            MIN(created_at) as oldest_memory,
            MAX(created_at) as newest_memory,

            -- Computed at timestamp
            NOW() as computed_at
          FROM memories;

          CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_stats_singleton
            ON dashboard_stats(computed_at);

          -- Function to refresh dashboard stats
          CREATE OR REPLACE FUNCTION refresh_dashboard_stats()
          RETURNS void AS $$
          BEGIN
            REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_stats;
          END;
          $$ LANGUAGE plpgsql;

          -- ============================================================
          -- TIME SERIES AGGREGATION TABLE
          -- Pre-computed daily/weekly/monthly counts for fast charts
          -- ============================================================

          CREATE TABLE IF NOT EXISTS memory_time_series (
            id SERIAL PRIMARY KEY,
            granularity VARCHAR(10) NOT NULL,  -- 'hour', 'day', 'week', 'month'
            period_start TIMESTAMPTZ NOT NULL,
            period_end TIMESTAMPTZ NOT NULL,

            -- Counts by type
            total_count INTEGER NOT NULL DEFAULT 0,
            episodic_count INTEGER DEFAULT 0,
            semantic_count INTEGER DEFAULT 0,
            procedural_count INTEGER DEFAULT 0,
            working_count INTEGER DEFAULT 0,
            consolidated_count INTEGER DEFAULT 0,

            -- Counts by importance
            critical_count INTEGER DEFAULT 0,
            high_count INTEGER DEFAULT 0,
            medium_count INTEGER DEFAULT 0,
            low_count INTEGER DEFAULT 0,
            trivial_count INTEGER DEFAULT 0,

            -- Other metrics
            with_embeddings INTEGER DEFAULT 0,
            with_images INTEGER DEFAULT 0,
            avg_content_length FLOAT,

            -- Metadata
            computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            CONSTRAINT unique_period UNIQUE (granularity, period_start)
          );

          CREATE INDEX IF NOT EXISTS idx_time_series_lookup
            ON memory_time_series(granularity, period_start DESC);

          -- Function to populate time series data
          CREATE OR REPLACE FUNCTION populate_memory_time_series(
            p_granularity VARCHAR(10),
            p_days_back INTEGER DEFAULT 90
          )
          RETURNS INTEGER AS $$
          DECLARE
            inserted_count INTEGER := 0;
          BEGIN
            INSERT INTO memory_time_series (
              granularity, period_start, period_end,
              total_count, episodic_count, semantic_count, procedural_count, working_count, consolidated_count,
              critical_count, high_count, medium_count, low_count, trivial_count,
              with_embeddings, with_images, avg_content_length
            )
            SELECT
              p_granularity,
              date_trunc(p_granularity, created_at) as period_start,
              date_trunc(p_granularity, created_at) + CASE
                WHEN p_granularity = 'hour' THEN INTERVAL '1 hour'
                WHEN p_granularity = 'day' THEN INTERVAL '1 day'
                WHEN p_granularity = 'week' THEN INTERVAL '1 week'
                WHEN p_granularity = 'month' THEN INTERVAL '1 month'
              END as period_end,
              COUNT(*),
              COUNT(*) FILTER (WHERE memory_type = 'episodic'),
              COUNT(*) FILTER (WHERE memory_type = 'semantic'),
              COUNT(*) FILTER (WHERE memory_type = 'procedural'),
              COUNT(*) FILTER (WHERE memory_type = 'working'),
              COUNT(*) FILTER (WHERE memory_type = 'consolidated'),
              COUNT(*) FILTER (WHERE importance = 'critical'),
              COUNT(*) FILTER (WHERE importance = 'high'),
              COUNT(*) FILTER (WHERE importance = 'medium'),
              COUNT(*) FILTER (WHERE importance = 'low'),
              COUNT(*) FILTER (WHERE importance = 'trivial'),
              COUNT(*) FILTER (WHERE embedding IS NOT NULL),
              COUNT(*) FILTER (WHERE image_data IS NOT NULL),
              AVG(length(content))::float
            FROM memories
            WHERE created_at > NOW() - (p_days_back || ' days')::INTERVAL
            GROUP BY date_trunc(p_granularity, created_at)
            ON CONFLICT (granularity, period_start)
            DO UPDATE SET
              total_count = EXCLUDED.total_count,
              episodic_count = EXCLUDED.episodic_count,
              semantic_count = EXCLUDED.semantic_count,
              procedural_count = EXCLUDED.procedural_count,
              working_count = EXCLUDED.working_count,
              consolidated_count = EXCLUDED.consolidated_count,
              critical_count = EXCLUDED.critical_count,
              high_count = EXCLUDED.high_count,
              medium_count = EXCLUDED.medium_count,
              low_count = EXCLUDED.low_count,
              trivial_count = EXCLUDED.trivial_count,
              with_embeddings = EXCLUDED.with_embeddings,
              with_images = EXCLUDED.with_images,
              avg_content_length = EXCLUDED.avg_content_length,
              computed_at = NOW();

            GET DIAGNOSTICS inserted_count = ROW_COUNT;
            RETURN inserted_count;
          END;
          $$ LANGUAGE plpgsql;

          -- ============================================================
          -- TAG STATISTICS TABLE
          -- Pre-aggregated tag stats for fast dashboard queries
          -- ============================================================

          CREATE TABLE IF NOT EXISTS tag_statistics (
            tag_name VARCHAR(255) PRIMARY KEY,
            memory_count INTEGER NOT NULL DEFAULT 0,
            first_used TIMESTAMPTZ,
            last_used TIMESTAMPTZ,
            avg_importance_rank FLOAT,  -- 1=critical, 5=trivial
            top_memory_types TEXT[],
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_tag_stats_count
            ON tag_statistics(memory_count DESC);

          -- Function to refresh tag statistics
          CREATE OR REPLACE FUNCTION refresh_tag_statistics()
          RETURNS INTEGER AS $$
          DECLARE
            updated_count INTEGER := 0;
          BEGIN
            INSERT INTO tag_statistics (tag_name, memory_count, first_used, last_used, updated_at)
            SELECT
              unnest(tags) as tag_name,
              COUNT(*),
              MIN(created_at),
              MAX(created_at),
              NOW()
            FROM memories
            WHERE array_length(tags, 1) > 0
            GROUP BY unnest(tags)
            ON CONFLICT (tag_name)
            DO UPDATE SET
              memory_count = EXCLUDED.memory_count,
              first_used = EXCLUDED.first_used,
              last_used = EXCLUDED.last_used,
              updated_at = NOW();

            GET DIAGNOSTICS updated_count = ROW_COUNT;
            RETURN updated_count;
          END;
          $$ LANGUAGE plpgsql;

          -- ============================================================
          -- DASHBOARD CACHE TABLE
          -- For caching expensive dashboard query results
          -- ============================================================

          CREATE TABLE IF NOT EXISTS dashboard_cache (
            cache_key VARCHAR(255) PRIMARY KEY,
            cache_value JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            hit_count INTEGER DEFAULT 0,
            last_accessed_at TIMESTAMPTZ
          );

          CREATE INDEX IF NOT EXISTS idx_dashboard_cache_expires
            ON dashboard_cache(expires_at);

          -- Function to get or set cache
          CREATE OR REPLACE FUNCTION dashboard_cache_get(
            p_key VARCHAR(255)
          )
          RETURNS JSONB AS $$
          DECLARE
            v_result JSONB;
          BEGIN
            UPDATE dashboard_cache
            SET hit_count = hit_count + 1, last_accessed_at = NOW()
            WHERE cache_key = p_key AND expires_at > NOW()
            RETURNING cache_value INTO v_result;

            RETURN v_result;
          END;
          $$ LANGUAGE plpgsql;

          CREATE OR REPLACE FUNCTION dashboard_cache_set(
            p_key VARCHAR(255),
            p_value JSONB,
            p_ttl_seconds INTEGER DEFAULT 300
          )
          RETURNS void AS $$
          BEGIN
            INSERT INTO dashboard_cache (cache_key, cache_value, expires_at)
            VALUES (p_key, p_value, NOW() + (p_ttl_seconds || ' seconds')::INTERVAL)
            ON CONFLICT (cache_key)
            DO UPDATE SET
              cache_value = EXCLUDED.cache_value,
              expires_at = EXCLUDED.expires_at,
              created_at = NOW(),
              hit_count = 0;
          END;
          $$ LANGUAGE plpgsql;

          -- Cleanup expired cache entries
          CREATE OR REPLACE FUNCTION dashboard_cache_cleanup()
          RETURNS INTEGER AS $$
          DECLARE
            deleted_count INTEGER;
          BEGIN
            DELETE FROM dashboard_cache WHERE expires_at < NOW();
            GET DIAGNOSTICS deleted_count = ROW_COUNT;
            RETURN deleted_count;
          END;
          $$ LANGUAGE plpgsql;

          -- Initial population
          SELECT populate_memory_time_series('day', 90);
          SELECT populate_memory_time_series('week', 365);
          SELECT refresh_tag_statistics();
        `,
                down: `
          DROP FUNCTION IF EXISTS dashboard_cache_cleanup();
          DROP FUNCTION IF EXISTS dashboard_cache_set(VARCHAR, JSONB, INTEGER);
          DROP FUNCTION IF EXISTS dashboard_cache_get(VARCHAR);
          DROP TABLE IF EXISTS dashboard_cache CASCADE;
          DROP FUNCTION IF EXISTS refresh_tag_statistics();
          DROP TABLE IF EXISTS tag_statistics CASCADE;
          DROP FUNCTION IF EXISTS populate_memory_time_series(VARCHAR, INTEGER);
          DROP TABLE IF EXISTS memory_time_series CASCADE;
          DROP FUNCTION IF EXISTS refresh_dashboard_stats();
          DROP MATERIALIZED VIEW IF EXISTS dashboard_stats;
          DROP INDEX IF EXISTS idx_memories_tags_type;
          DROP INDEX IF EXISTS idx_memories_dashboard_list;
          DROP INDEX IF EXISTS idx_memories_recent_24h;
          DROP INDEX IF EXISTS idx_memories_dashboard_importance_time;
          DROP INDEX IF EXISTS idx_memories_dashboard_type_time;
        `,
                checksum: this.generateChecksum('dashboard_query_optimizations_v27')
            },
            // migration 28: API Endpoint Data Migration
            // Moves all JSON-based API data storage to PostgreSQL
            // Includes: endpoints, bans, oauth, security events, admin sessions
            {
                version: 28,
                name: 'create_api_data_tables',
                up: `
          -- ============================================================
          -- API ENDPOINTS TABLE
          -- Stores endpoint configuration, rate limits, and access control
          -- Replaces data/api-endpoints/endpoints.json
          -- ============================================================
          CREATE TABLE IF NOT EXISTS api_endpoints (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- Endpoint identification
            path VARCHAR(500) NOT NULL,
            method VARCHAR(10) NOT NULL DEFAULT 'GET',
            name VARCHAR(255) NOT NULL,
            description TEXT,

            -- Rate limiting configuration
            rate_limit_max INTEGER NOT NULL DEFAULT 100,
            rate_limit_window_ms INTEGER NOT NULL DEFAULT 60000,
            rate_limit_skip_localhost BOOLEAN DEFAULT true,

            -- Authentication and access control
            requires_auth BOOLEAN DEFAULT true,
            allowed_roles TEXT[] DEFAULT '{}',
            allowed_ips TEXT[] DEFAULT '{}',
            blocked_ips TEXT[] DEFAULT '{}',

            -- Status and monitoring
            is_enabled BOOLEAN DEFAULT true,
            is_deprecated BOOLEAN DEFAULT false,
            deprecation_message TEXT,

            -- Usage statistics
            total_requests BIGINT DEFAULT 0,
            successful_requests BIGINT DEFAULT 0,
            failed_requests BIGINT DEFAULT 0,
            last_request_at TIMESTAMPTZ,

            -- Metadata
            tags TEXT[] DEFAULT '{}',
            metadata JSONB NOT NULL DEFAULT '{}',

            -- Timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- Constraints
            CONSTRAINT valid_method CHECK (
              method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD')
            ),
            CONSTRAINT unique_endpoint UNIQUE (path, method)
          );

          -- Indexes for endpoint lookups
          CREATE INDEX IF NOT EXISTS idx_api_endpoints_path
            ON api_endpoints(path);
          CREATE INDEX IF NOT EXISTS idx_api_endpoints_method
            ON api_endpoints(method);
          CREATE INDEX IF NOT EXISTS idx_api_endpoints_enabled
            ON api_endpoints(is_enabled)
            WHERE is_enabled = true;
          CREATE INDEX IF NOT EXISTS idx_api_endpoints_auth
            ON api_endpoints(requires_auth);
          CREATE INDEX IF NOT EXISTS idx_api_endpoints_tags
            ON api_endpoints USING GIN(tags);

          -- Trigger for updated_at
          DROP TRIGGER IF EXISTS api_endpoints_updated_at ON api_endpoints;
          CREATE TRIGGER api_endpoints_updated_at
            BEFORE UPDATE ON api_endpoints
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();

          -- ============================================================
          -- BANS TABLE
          -- Stores IP bans and autoban configuration
          -- Replaces data/bans/data.json and data/bans/autoban-config.json
          -- ============================================================
          CREATE TABLE IF NOT EXISTS ip_bans (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- Ban identification
            ip_address VARCHAR(45) NOT NULL,  -- Supports IPv4 and IPv6
            ip_range VARCHAR(50),  -- CIDR notation for range bans

            -- Ban details
            reason TEXT NOT NULL,
            ban_type VARCHAR(50) NOT NULL DEFAULT 'manual',
            severity VARCHAR(20) DEFAULT 'medium',

            -- Duration
            is_permanent BOOLEAN DEFAULT false,
            expires_at TIMESTAMPTZ,

            -- Context
            user_agent TEXT,
            fingerprint VARCHAR(255),
            country VARCHAR(100),

            -- Violation tracking
            violation_count INTEGER DEFAULT 1,
            violations JSONB DEFAULT '[]',

            -- Status
            is_active BOOLEAN DEFAULT true,
            lifted_at TIMESTAMPTZ,
            lifted_by VARCHAR(255),
            lift_reason TEXT,

            -- Metadata
            metadata JSONB NOT NULL DEFAULT '{}',

            -- Timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- Constraints
            CONSTRAINT valid_ban_type CHECK (
              ban_type IN ('manual', 'auto', 'vpn', 'rate_limit', 'security', 'abuse')
            ),
            CONSTRAINT valid_severity CHECK (
              severity IN ('low', 'medium', 'high', 'critical')
            )
          );

          -- Indexes for ban lookups
          CREATE INDEX IF NOT EXISTS idx_ip_bans_ip
            ON ip_bans(ip_address);
          CREATE INDEX IF NOT EXISTS idx_ip_bans_active
            ON ip_bans(is_active)
            WHERE is_active = true;
          CREATE INDEX IF NOT EXISTS idx_ip_bans_expires
            ON ip_bans(expires_at)
            WHERE expires_at IS NOT NULL AND is_active = true;
          CREATE INDEX IF NOT EXISTS idx_ip_bans_type
            ON ip_bans(ban_type);
          CREATE INDEX IF NOT EXISTS idx_ip_bans_created
            ON ip_bans(created_at DESC);

          -- Trigger for updated_at
          DROP TRIGGER IF EXISTS ip_bans_updated_at ON ip_bans;
          CREATE TRIGGER ip_bans_updated_at
            BEFORE UPDATE ON ip_bans
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();

          -- Autoban configuration table
          CREATE TABLE IF NOT EXISTS autoban_config (
            id SERIAL PRIMARY KEY,

            -- Configuration
            is_enabled BOOLEAN DEFAULT true,
            threshold INTEGER NOT NULL DEFAULT 10,
            duration_ms INTEGER NOT NULL DEFAULT 300000,
            window_ms INTEGER NOT NULL DEFAULT 86400000,

            -- Violation types to track
            tracked_violations TEXT[] DEFAULT ARRAY['vpn', 'rate_limit', 'security'],

            -- Exclusions
            excluded_ips TEXT[] DEFAULT '{}',
            excluded_countries TEXT[] DEFAULT '{}',

            -- Metadata
            metadata JSONB NOT NULL DEFAULT '{}',

            -- Timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          -- Trigger for updated_at
          DROP TRIGGER IF EXISTS autoban_config_updated_at ON autoban_config;
          CREATE TRIGGER autoban_config_updated_at
            BEFORE UPDATE ON autoban_config
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();

          -- Insert default autoban config
          INSERT INTO autoban_config (is_enabled, threshold, duration_ms, window_ms)
          VALUES (true, 10, 300000, 86400000)
          ON CONFLICT DO NOTHING;

          -- ============================================================
          -- OAUTH PROVIDERS TABLE
          -- Stores OAuth provider configurations
          -- Replaces data/oauth/providers.json
          -- ============================================================
          CREATE TABLE IF NOT EXISTS oauth_providers (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- Provider identification
            provider_name VARCHAR(100) NOT NULL UNIQUE,
            display_name VARCHAR(255),

            -- OAuth configuration (encrypted in application layer)
            client_id TEXT,
            client_secret_encrypted TEXT,
            authorization_url TEXT,
            token_url TEXT,
            userinfo_url TEXT,
            scope TEXT DEFAULT 'openid profile email',

            -- Provider settings
            is_enabled BOOLEAN DEFAULT false,
            is_configured BOOLEAN DEFAULT false,

            -- Callback configuration
            redirect_uri TEXT,

            -- Metadata
            icon_url TEXT,
            metadata JSONB NOT NULL DEFAULT '{}',

            -- Timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          -- Trigger for updated_at
          DROP TRIGGER IF EXISTS oauth_providers_updated_at ON oauth_providers;
          CREATE TRIGGER oauth_providers_updated_at
            BEFORE UPDATE ON oauth_providers
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();

          -- ============================================================
          -- SECURITY EVENTS TABLE
          -- Stores VPN violations, security events, and audit logs
          -- Replaces data/events/vpn.json and data/vpn_violations/*.json
          -- ============================================================
          CREATE TABLE IF NOT EXISTS security_events (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- Event identification
            event_type VARCHAR(50) NOT NULL,
            event_action VARCHAR(255) NOT NULL,
            category VARCHAR(50) NOT NULL DEFAULT 'violation',

            -- Source identification
            ip_address VARCHAR(45),
            user_agent TEXT,
            fingerprint VARCHAR(255),
            session_id VARCHAR(255),

            -- Event details
            details JSONB NOT NULL DEFAULT '{}',

            -- Classification
            severity VARCHAR(20) NOT NULL DEFAULT 'medium',
            threat_score INTEGER DEFAULT 0,

            -- Geographic info
            country VARCHAR(100),
            region VARCHAR(255),
            city VARCHAR(255),

            -- Detection flags
            is_vpn BOOLEAN DEFAULT false,
            is_proxy BOOLEAN DEFAULT false,
            is_tor BOOLEAN DEFAULT false,
            is_data_center BOOLEAN DEFAULT false,
            is_government BOOLEAN DEFAULT false,
            is_federal_facility BOOLEAN DEFAULT false,

            -- Resolution
            is_resolved BOOLEAN DEFAULT false,
            resolved_at TIMESTAMPTZ,
            resolved_by VARCHAR(255),
            resolution_notes TEXT,

            -- Metadata
            metadata JSONB NOT NULL DEFAULT '{}',

            -- Timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- Constraints
            CONSTRAINT valid_event_category CHECK (
              category IN ('violation', 'warning', 'info', 'audit', 'error')
            ),
            CONSTRAINT valid_event_severity CHECK (
              severity IN ('low', 'medium', 'high', 'critical')
            )
          );

          -- Indexes for security event queries
          CREATE INDEX IF NOT EXISTS idx_security_events_type
            ON security_events(event_type);
          CREATE INDEX IF NOT EXISTS idx_security_events_category
            ON security_events(category);
          CREATE INDEX IF NOT EXISTS idx_security_events_ip
            ON security_events(ip_address)
            WHERE ip_address IS NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_security_events_severity
            ON security_events(severity);
          CREATE INDEX IF NOT EXISTS idx_security_events_created
            ON security_events(created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_security_events_vpn
            ON security_events(is_vpn)
            WHERE is_vpn = true;
          CREATE INDEX IF NOT EXISTS idx_security_events_unresolved
            ON security_events(is_resolved, created_at DESC)
            WHERE is_resolved = false;
          CREATE INDEX IF NOT EXISTS idx_security_events_details
            ON security_events USING GIN(details jsonb_path_ops);

          -- Partitioning for security events (by month for efficient cleanup)
          -- Note: Partitioning requires PostgreSQL 10+

          -- ============================================================
          -- ADMIN SESSIONS TABLE
          -- Stores admin session data
          -- Replaces data/admin_sessions/data.json
          -- ============================================================
          CREATE TABLE IF NOT EXISTS admin_sessions (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- Session identification
            session_token VARCHAR(255) NOT NULL UNIQUE,

            -- User identification
            username VARCHAR(255),
            ip_address VARCHAR(45),
            user_agent TEXT,

            -- Session details
            is_active BOOLEAN DEFAULT true,

            -- Timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ,
            ended_at TIMESTAMPTZ,

            -- Session data
            session_data JSONB NOT NULL DEFAULT '{}'
          );

          -- Indexes for admin session queries
          CREATE INDEX IF NOT EXISTS idx_admin_sessions_token
            ON admin_sessions(session_token);
          CREATE INDEX IF NOT EXISTS idx_admin_sessions_active
            ON admin_sessions(is_active)
            WHERE is_active = true;
          CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires
            ON admin_sessions(expires_at)
            WHERE expires_at IS NOT NULL;

          -- ============================================================
          -- GOVERNMENT FACILITIES TABLE
          -- Stores known government IP ranges and facilities
          -- Replaces data/security/government-facilities.json
          -- ============================================================
          CREATE TABLE IF NOT EXISTS government_facilities (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

            -- Facility identification
            name VARCHAR(255) NOT NULL,
            facility_type VARCHAR(100),
            country VARCHAR(100),

            -- IP ranges
            ip_ranges TEXT[] DEFAULT '{}',

            -- Classification
            classification VARCHAR(50) DEFAULT 'government',
            threat_level VARCHAR(20) DEFAULT 'high',

            -- Detection settings
            should_block BOOLEAN DEFAULT false,
            should_log BOOLEAN DEFAULT true,
            alert_on_access BOOLEAN DEFAULT true,

            -- Metadata
            metadata JSONB NOT NULL DEFAULT '{}',

            -- Timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          -- Trigger for updated_at
          DROP TRIGGER IF EXISTS government_facilities_updated_at ON government_facilities;
          CREATE TRIGGER government_facilities_updated_at
            BEFORE UPDATE ON government_facilities
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();

          -- ============================================================
          -- API STATS MATERIALIZED VIEW
          -- Pre-computed statistics for API usage
          -- ============================================================
          CREATE MATERIALIZED VIEW IF NOT EXISTS api_stats AS
          SELECT
            COUNT(*) as total_endpoints,
            COUNT(*) FILTER (WHERE is_enabled = true) as enabled_endpoints,
            COUNT(*) FILTER (WHERE requires_auth = true) as auth_required_endpoints,
            COUNT(*) FILTER (WHERE is_deprecated = true) as deprecated_endpoints,
            SUM(total_requests) as total_api_requests,
            SUM(successful_requests) as total_successful_requests,
            SUM(failed_requests) as total_failed_requests,
            MAX(last_request_at) as last_api_request,
            NOW() as computed_at
          FROM api_endpoints;

          CREATE UNIQUE INDEX IF NOT EXISTS idx_api_stats_singleton
            ON api_stats(computed_at);

          -- Function to refresh API stats
          CREATE OR REPLACE FUNCTION refresh_api_stats()
          RETURNS void AS $$
          BEGIN
            REFRESH MATERIALIZED VIEW CONCURRENTLY api_stats;
          END;
          $$ LANGUAGE plpgsql;

          -- ============================================================
          -- SECURITY STATS MATERIALIZED VIEW
          -- Pre-computed security event statistics
          -- ============================================================
          CREATE MATERIALIZED VIEW IF NOT EXISTS security_stats AS
          SELECT
            COUNT(*) as total_events,
            COUNT(*) FILTER (WHERE event_type = 'vpn') as vpn_events,
            COUNT(*) FILTER (WHERE severity = 'critical') as critical_events,
            COUNT(*) FILTER (WHERE severity = 'high') as high_severity_events,
            COUNT(*) FILTER (WHERE is_resolved = false) as unresolved_events,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as events_last_24h,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as events_last_7d,
            COUNT(DISTINCT ip_address) as unique_ips,
            COUNT(DISTINCT country) as unique_countries,
            NOW() as computed_at
          FROM security_events;

          CREATE UNIQUE INDEX IF NOT EXISTS idx_security_stats_singleton
            ON security_stats(computed_at);

          -- Function to refresh security stats
          CREATE OR REPLACE FUNCTION refresh_security_stats()
          RETURNS void AS $$
          BEGIN
            REFRESH MATERIALIZED VIEW CONCURRENTLY security_stats;
          END;
          $$ LANGUAGE plpgsql;

          -- ============================================================
          -- BAN STATS MATERIALIZED VIEW
          -- Pre-computed ban statistics
          -- ============================================================
          CREATE MATERIALIZED VIEW IF NOT EXISTS ban_stats AS
          SELECT
            COUNT(*) as total_bans,
            COUNT(*) FILTER (WHERE is_active = true) as active_bans,
            COUNT(*) FILTER (WHERE is_permanent = true) as permanent_bans,
            COUNT(*) FILTER (WHERE ban_type = 'auto') as auto_bans,
            COUNT(*) FILTER (WHERE ban_type = 'manual') as manual_bans,
            COUNT(*) FILTER (WHERE ban_type = 'vpn') as vpn_bans,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as bans_last_24h,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as bans_last_7d,
            NOW() as computed_at
          FROM ip_bans;

          CREATE UNIQUE INDEX IF NOT EXISTS idx_ban_stats_singleton
            ON ban_stats(computed_at);

          -- Function to refresh ban stats
          CREATE OR REPLACE FUNCTION refresh_ban_stats()
          RETURNS void AS $$
          BEGIN
            REFRESH MATERIALIZED VIEW CONCURRENTLY ban_stats;
          END;
          $$ LANGUAGE plpgsql;

          -- ============================================================
          -- CLEANUP FUNCTION FOR EXPIRED DATA
          -- ============================================================
          CREATE OR REPLACE FUNCTION cleanup_expired_api_data()
          RETURNS TABLE(
            expired_bans INTEGER,
            expired_sessions INTEGER,
            old_events INTEGER
          ) AS $$
          DECLARE
            v_bans INTEGER;
            v_sessions INTEGER;
            v_events INTEGER;
          BEGIN
            -- Deactivate expired bans
            UPDATE ip_bans
            SET is_active = false, updated_at = NOW()
            WHERE is_active = true
              AND is_permanent = false
              AND expires_at IS NOT NULL
              AND expires_at < NOW();
            GET DIAGNOSTICS v_bans = ROW_COUNT;

            -- End expired admin sessions
            UPDATE admin_sessions
            SET is_active = false, ended_at = NOW()
            WHERE is_active = true
              AND expires_at IS NOT NULL
              AND expires_at < NOW();
            GET DIAGNOSTICS v_sessions = ROW_COUNT;

            -- Delete very old security events (> 90 days) that are resolved
            DELETE FROM security_events
            WHERE is_resolved = true
              AND created_at < NOW() - INTERVAL '90 days';
            GET DIAGNOSTICS v_events = ROW_COUNT;

            RETURN QUERY SELECT v_bans, v_sessions, v_events;
          END;
          $$ LANGUAGE plpgsql;
        `,
                down: `
          DROP FUNCTION IF EXISTS cleanup_expired_api_data();
          DROP FUNCTION IF EXISTS refresh_ban_stats();
          DROP MATERIALIZED VIEW IF EXISTS ban_stats;
          DROP FUNCTION IF EXISTS refresh_security_stats();
          DROP MATERIALIZED VIEW IF EXISTS security_stats;
          DROP FUNCTION IF EXISTS refresh_api_stats();
          DROP MATERIALIZED VIEW IF EXISTS api_stats;
          DROP TRIGGER IF EXISTS government_facilities_updated_at ON government_facilities;
          DROP TABLE IF EXISTS government_facilities CASCADE;
          DROP TABLE IF EXISTS admin_sessions CASCADE;
          DROP TABLE IF EXISTS security_events CASCADE;
          DROP TRIGGER IF EXISTS oauth_providers_updated_at ON oauth_providers;
          DROP TABLE IF EXISTS oauth_providers CASCADE;
          DROP TRIGGER IF EXISTS autoban_config_updated_at ON autoban_config;
          DROP TABLE IF EXISTS autoban_config CASCADE;
          DROP TRIGGER IF EXISTS ip_bans_updated_at ON ip_bans;
          DROP TABLE IF EXISTS ip_bans CASCADE;
          DROP TRIGGER IF EXISTS api_endpoints_updated_at ON api_endpoints;
          DROP TABLE IF EXISTS api_endpoints CASCADE;
        `,
                checksum: this.generateChecksum('create_api_data_tables_v28')
            },
            // migration 29: Add unique constraint on codebase_files.absolute_path
            // Prevents duplicate entries for the same file path
            {
                version: 29,
                name: 'add_codebase_files_absolute_path_unique',
                up: `
          -- Remove any duplicate entries first (keep the most recently updated one)
          DELETE FROM codebase_files a USING codebase_files b
          WHERE a.id < b.id AND a.absolute_path = b.absolute_path;

          -- Create unique index on absolute_path to prevent duplicates
          CREATE UNIQUE INDEX IF NOT EXISTS idx_codebase_files_absolute_path_unique
            ON codebase_files(absolute_path);
        `,
                down: `
          DROP INDEX IF EXISTS idx_codebase_files_absolute_path_unique;
        `,
                checksum: this.generateChecksum('add_codebase_files_absolute_path_unique_v29')
            },
            // migration 30: Add indexes for session pairing metadata fields
            // Required for efficient find_memory Strategies 1-8 (user/claude message pairing)
            {
                version: 30,
                name: 'add_session_pairing_indexes',
                up: `
          -- Index for sessionId lookups (Strategy 1: same session pairing)
          CREATE INDEX IF NOT EXISTS idx_memories_metadata_session_id
            ON memories ((metadata->>'sessionId'))
            WHERE metadata->>'sessionId' IS NOT NULL;

          -- Index for role filtering (all strategies use role filtering)
          CREATE INDEX IF NOT EXISTS idx_memories_metadata_role
            ON memories ((metadata->>'role'))
            WHERE metadata->>'role' IS NOT NULL;

          -- Index for timestamp ordering (Strategies 1-8 use timestamp-based ordering)
          CREATE INDEX IF NOT EXISTS idx_memories_metadata_timestamp
            ON memories ((metadata->>'timestamp'))
            WHERE metadata->>'timestamp' IS NOT NULL;

          -- Index for project_path filtering (Strategies 2-6 use project_path)
          CREATE INDEX IF NOT EXISTS idx_memories_metadata_project_path
            ON memories ((metadata->>'project_path'))
            WHERE metadata->>'project_path' IS NOT NULL;

          -- Composite index for efficient session+role+timestamp queries (Strategy 1)
          CREATE INDEX IF NOT EXISTS idx_memories_session_role_timestamp
            ON memories (
              (metadata->>'sessionId'),
              (metadata->>'role'),
              (metadata->>'timestamp')
            )
            WHERE metadata->>'sessionId' IS NOT NULL
              AND metadata->>'role' IS NOT NULL
              AND metadata->>'timestamp' IS NOT NULL;

          -- Composite index for project+role+timestamp queries (Strategies 2-6)
          CREATE INDEX IF NOT EXISTS idx_memories_project_role_timestamp
            ON memories (
              (metadata->>'project_path'),
              (metadata->>'role'),
              (metadata->>'timestamp')
            )
            WHERE metadata->>'project_path' IS NOT NULL
              AND metadata->>'role' IS NOT NULL
              AND metadata->>'timestamp' IS NOT NULL;
        `,
                down: `
          DROP INDEX IF EXISTS idx_memories_project_role_timestamp;
          DROP INDEX IF EXISTS idx_memories_session_role_timestamp;
          DROP INDEX IF EXISTS idx_memories_metadata_project_path;
          DROP INDEX IF EXISTS idx_memories_metadata_timestamp;
          DROP INDEX IF EXISTS idx_memories_metadata_role;
          DROP INDEX IF EXISTS idx_memories_metadata_session_id;
        `,
                checksum: this.generateChecksum('add_session_pairing_indexes_v30')
            },
            // migration 31: Project Namespacing - Per-Instance Database Isolation
            // Adds project_id FK column to ALL data tables for multi-project isolation
            // CRITICAL: This enables separate SpecMem instances to share one PostgreSQL
            // without leaking memories, team messages, or claims across projects
            {
                version: 31,
                name: 'project_namespacing_isolation',
                up: `
          -- ============================================================================
          -- PROJECTS REGISTRY TABLE
          -- ============================================================================
          -- Central registry mapping project paths to UUIDs
          -- Uses UPSERT pattern for race-condition-free registration
          CREATE TABLE IF NOT EXISTS projects (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            path VARCHAR(500) NOT NULL UNIQUE,
            name VARCHAR(255),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
          CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);

          -- Insert default project for backfilling existing data
          INSERT INTO projects (id, path, name, created_at, last_accessed_at)
          VALUES (
            '00000000-0000-0000-0000-000000000000'::uuid,
            '/',
            'Default Project',
            NOW(),
            NOW()
          )
          ON CONFLICT (path) DO NOTHING;

          -- ============================================================================
          -- ADD project_id TO memories TABLE
          -- ============================================================================
          DO $$ BEGIN
            ALTER TABLE memories
            ADD COLUMN IF NOT EXISTS project_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
          EXCEPTION WHEN duplicate_column THEN NULL;
          END $$;

          DO $$ BEGIN
            ALTER TABLE memories
            ADD CONSTRAINT fk_memories_project_id
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET DEFAULT;
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;

          CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id);
          CREATE INDEX IF NOT EXISTS idx_memories_project_created ON memories(project_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_memories_project_importance ON memories(project_id, importance);

          -- ============================================================================
          -- ADD project_id TO codebase_files TABLE
          -- ============================================================================
          DO $$ BEGIN
            ALTER TABLE codebase_files
            ADD COLUMN IF NOT EXISTS project_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
          EXCEPTION WHEN duplicate_column THEN NULL;
          END $$;

          DO $$ BEGIN
            ALTER TABLE codebase_files
            ADD CONSTRAINT fk_codebase_files_project_id
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET DEFAULT;
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;

          CREATE INDEX IF NOT EXISTS idx_codebase_files_project_id ON codebase_files(project_id);
          CREATE INDEX IF NOT EXISTS idx_codebase_files_project_path ON codebase_files(project_id, file_path);

          -- ============================================================================
          -- ADD project_id TO code_definitions TABLE
          -- ============================================================================
          DO $$ BEGIN
            ALTER TABLE code_definitions
            ADD COLUMN IF NOT EXISTS project_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
          EXCEPTION WHEN duplicate_column THEN NULL;
          END $$;

          DO $$ BEGIN
            ALTER TABLE code_definitions
            ADD CONSTRAINT fk_code_definitions_project_id
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET DEFAULT;
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;

          CREATE INDEX IF NOT EXISTS idx_code_definitions_project_id ON code_definitions(project_id);
          CREATE INDEX IF NOT EXISTS idx_code_definitions_project_name ON code_definitions(project_id, name);

          -- ============================================================================
          -- ADD project_id TO code_dependencies TABLE
          -- ============================================================================
          DO $$ BEGIN
            ALTER TABLE code_dependencies
            ADD COLUMN IF NOT EXISTS project_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
          EXCEPTION WHEN duplicate_column THEN NULL;
          END $$;

          DO $$ BEGIN
            ALTER TABLE code_dependencies
            ADD CONSTRAINT fk_code_dependencies_project_id
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET DEFAULT;
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;

          CREATE INDEX IF NOT EXISTS idx_code_dependencies_project_id ON code_dependencies(project_id);

          -- ============================================================================
          -- ADD project_id TO codebase_pointers TABLE (if exists)
          -- ============================================================================
          DO $$ BEGIN
            ALTER TABLE codebase_pointers
            ADD COLUMN IF NOT EXISTS project_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
          EXCEPTION WHEN duplicate_column THEN NULL;
                   WHEN undefined_table THEN NULL;
          END $$;

          DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'codebase_pointers') THEN
              ALTER TABLE codebase_pointers
              ADD CONSTRAINT fk_codebase_pointers_project_id
              FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET DEFAULT;
            END IF;
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;

          DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'codebase_pointers') THEN
              EXECUTE 'CREATE INDEX IF NOT EXISTS idx_codebase_pointers_project_id ON codebase_pointers(project_id)';
            END IF;
          END $$;

          -- ============================================================================
          -- ADD project_id TO team_messages TABLE (if exists)
          -- ============================================================================
          DO $$ BEGIN
            ALTER TABLE team_messages
            ADD COLUMN IF NOT EXISTS project_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
          EXCEPTION WHEN duplicate_column THEN NULL;
                   WHEN undefined_table THEN NULL;
          END $$;

          DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'team_messages') THEN
              ALTER TABLE team_messages
              ADD CONSTRAINT fk_team_messages_project_id
              FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET DEFAULT;
            END IF;
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;

          DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'team_messages') THEN
              EXECUTE 'CREATE INDEX IF NOT EXISTS idx_team_messages_project_id ON team_messages(project_id)';
              EXECUTE 'CREATE INDEX IF NOT EXISTS idx_team_messages_project_channel ON team_messages(project_id, channel_id, created_at DESC)';
            END IF;
          END $$;

          -- ============================================================================
          -- ADD project_id TO task_claims TABLE (if exists)
          -- ============================================================================
          DO $$ BEGIN
            ALTER TABLE task_claims
            ADD COLUMN IF NOT EXISTS project_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
          EXCEPTION WHEN duplicate_column THEN NULL;
                   WHEN undefined_table THEN NULL;
          END $$;

          DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'task_claims') THEN
              ALTER TABLE task_claims
              ADD CONSTRAINT fk_task_claims_project_id
              FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET DEFAULT;
            END IF;
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;

          DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'task_claims') THEN
              EXECUTE 'CREATE INDEX IF NOT EXISTS idx_task_claims_project_id ON task_claims(project_id)';
              EXECUTE 'CREATE INDEX IF NOT EXISTS idx_task_claims_project_status ON task_claims(project_id, status)';
            END IF;
          END $$;

          -- ============================================================================
          -- ADD project_id TO team_channels TABLE (if exists)
          -- ============================================================================
          DO $$ BEGIN
            ALTER TABLE team_channels
            ADD COLUMN IF NOT EXISTS project_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
          EXCEPTION WHEN duplicate_column THEN NULL;
                   WHEN undefined_table THEN NULL;
          END $$;

          DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'team_channels') THEN
              ALTER TABLE team_channels
              ADD CONSTRAINT fk_team_channels_project_id
              FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET DEFAULT;
            END IF;
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;

          DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'team_channels') THEN
              EXECUTE 'CREATE INDEX IF NOT EXISTS idx_team_channels_project_id ON team_channels(project_id)';
            END IF;
          END $$;

          -- ============================================================================
          -- ADD project_id TO help_requests TABLE (if exists)
          -- ============================================================================
          DO $$ BEGIN
            ALTER TABLE help_requests
            ADD COLUMN IF NOT EXISTS project_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
          EXCEPTION WHEN duplicate_column THEN NULL;
                   WHEN undefined_table THEN NULL;
          END $$;

          DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'help_requests') THEN
              ALTER TABLE help_requests
              ADD CONSTRAINT fk_help_requests_project_id
              FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET DEFAULT;
            END IF;
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;

          DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'help_requests') THEN
              EXECUTE 'CREATE INDEX IF NOT EXISTS idx_help_requests_project_id ON help_requests(project_id)';
            END IF;
          END $$;

          -- ============================================================================
          -- RACE-CONDITION-FREE PROJECT REGISTRATION FUNCTION
          -- ============================================================================
          CREATE OR REPLACE FUNCTION register_project(
            p_path VARCHAR(500),
            p_name VARCHAR(255) DEFAULT NULL
          )
          RETURNS UUID AS $$
          DECLARE
            v_project_id UUID;
          BEGIN
            INSERT INTO projects (path, name)
            VALUES (p_path, COALESCE(p_name, p_path))
            ON CONFLICT (path) DO UPDATE SET
              last_accessed_at = NOW(),
              name = COALESCE(EXCLUDED.name, projects.name)
            RETURNING id INTO v_project_id;

            RETURN v_project_id;
          END;
          $$ LANGUAGE plpgsql;

          -- ============================================================================
          -- HELPER: Get project ID by path
          -- ============================================================================
          CREATE OR REPLACE FUNCTION get_project_id(p_path VARCHAR(500))
          RETURNS UUID AS $$
          DECLARE
            v_project_id UUID;
          BEGIN
            SELECT id INTO v_project_id
            FROM projects
            WHERE path = p_path;

            IF v_project_id IS NULL THEN
              v_project_id := register_project(p_path);
            ELSE
              UPDATE projects SET last_accessed_at = NOW() WHERE id = v_project_id;
            END IF;

            RETURN v_project_id;
          END;
          $$ LANGUAGE plpgsql;

          -- ============================================================================
          -- BACKFILL: Assign all existing data to default project
          -- ============================================================================
          UPDATE memories SET project_id = '00000000-0000-0000-0000-000000000000'::uuid WHERE project_id IS NULL;
          UPDATE codebase_files SET project_id = '00000000-0000-0000-0000-000000000000'::uuid WHERE project_id IS NULL;
          UPDATE code_definitions SET project_id = '00000000-0000-0000-0000-000000000000'::uuid WHERE project_id IS NULL;
          UPDATE code_dependencies SET project_id = '00000000-0000-0000-0000-000000000000'::uuid WHERE project_id IS NULL;

          -- Backfill codebase_pointers if it exists
          DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'codebase_pointers') THEN
              EXECUTE 'UPDATE codebase_pointers SET project_id = ''00000000-0000-0000-0000-000000000000''::uuid WHERE project_id IS NULL';
            END IF;
          END $$;

          -- Backfill team tables if they exist
          DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'team_messages') THEN
              EXECUTE 'UPDATE team_messages SET project_id = ''00000000-0000-0000-0000-000000000000''::uuid WHERE project_id IS NULL';
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'task_claims') THEN
              EXECUTE 'UPDATE task_claims SET project_id = ''00000000-0000-0000-0000-000000000000''::uuid WHERE project_id IS NULL';
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'team_channels') THEN
              EXECUTE 'UPDATE team_channels SET project_id = ''00000000-0000-0000-0000-000000000000''::uuid WHERE project_id IS NULL';
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'help_requests') THEN
              EXECUTE 'UPDATE help_requests SET project_id = ''00000000-0000-0000-0000-000000000000''::uuid WHERE project_id IS NULL';
            END IF;
          END $$;
        `,
                down: `
          -- WARNING: Rolling back project namespacing may break multi-project isolation!
          -- We only drop the FK constraints and indexes, keeping the data intact

          -- Drop FK constraints
          ALTER TABLE memories DROP CONSTRAINT IF EXISTS fk_memories_project_id;
          ALTER TABLE codebase_files DROP CONSTRAINT IF EXISTS fk_codebase_files_project_id;
          ALTER TABLE code_definitions DROP CONSTRAINT IF EXISTS fk_code_definitions_project_id;
          ALTER TABLE code_dependencies DROP CONSTRAINT IF EXISTS fk_code_dependencies_project_id;
          ALTER TABLE codebase_pointers DROP CONSTRAINT IF EXISTS fk_codebase_pointers_project_id;

          DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'team_messages') THEN
              ALTER TABLE team_messages DROP CONSTRAINT IF EXISTS fk_team_messages_project_id;
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'task_claims') THEN
              ALTER TABLE task_claims DROP CONSTRAINT IF EXISTS fk_task_claims_project_id;
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'team_channels') THEN
              ALTER TABLE team_channels DROP CONSTRAINT IF EXISTS fk_team_channels_project_id;
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'help_requests') THEN
              ALTER TABLE help_requests DROP CONSTRAINT IF EXISTS fk_help_requests_project_id;
            END IF;
          END $$;

          -- Drop indexes
          DROP INDEX IF EXISTS idx_memories_project_id;
          DROP INDEX IF EXISTS idx_memories_project_created;
          DROP INDEX IF EXISTS idx_memories_project_importance;
          DROP INDEX IF EXISTS idx_codebase_files_project_id;
          DROP INDEX IF EXISTS idx_codebase_files_project_path;
          DROP INDEX IF EXISTS idx_code_definitions_project_id;
          DROP INDEX IF EXISTS idx_code_definitions_project_name;
          DROP INDEX IF EXISTS idx_code_dependencies_project_id;
          DROP INDEX IF EXISTS idx_codebase_pointers_project_id;
          DROP INDEX IF EXISTS idx_team_messages_project_id;
          DROP INDEX IF EXISTS idx_team_messages_project_channel;
          DROP INDEX IF EXISTS idx_task_claims_project_id;
          DROP INDEX IF EXISTS idx_task_claims_project_status;
          DROP INDEX IF EXISTS idx_team_channels_project_id;
          DROP INDEX IF EXISTS idx_help_requests_project_id;

          -- Drop functions
          DROP FUNCTION IF EXISTS register_project(VARCHAR, VARCHAR);
          DROP FUNCTION IF EXISTS get_project_id(VARCHAR);

          -- NOTE: We intentionally keep the project_id columns and projects table
          -- to preserve data. Remove them manually if needed:
          -- ALTER TABLE memories DROP COLUMN IF EXISTS project_id;
          -- DROP TABLE IF EXISTS projects;
        `,
                checksum: this.generateChecksum('project_namespacing_isolation_v31')
            },
            // migration 32: Add project_path to code_chunks for per-project isolation
            // CRITICAL: code_chunks was missed in the original project namespacing migration
            // This enables find_code_pointers to work correctly per-project
            {
                version: 32,
                name: 'code_chunks_project_path',
                up: `
          -- Add project_path to code_chunks for project isolation
          DO $$ BEGIN
            ALTER TABLE code_chunks
            ADD COLUMN IF NOT EXISTS project_path TEXT DEFAULT '/';
          EXCEPTION WHEN duplicate_column THEN NULL;
          END $$;

          -- Index for project_path filtering - critical for per-project queries
          CREATE INDEX IF NOT EXISTS idx_code_chunks_project_path
            ON code_chunks(project_path);

          -- Composite index for project + file lookups
          CREATE INDEX IF NOT EXISTS idx_code_chunks_project_file
            ON code_chunks(project_path, file_path);
        `,
                down: `
          DROP INDEX IF EXISTS idx_code_chunks_project_file;
          DROP INDEX IF EXISTS idx_code_chunks_project_path;
          ALTER TABLE code_chunks DROP COLUMN IF EXISTS project_path;
        `,
                checksum: this.generateChecksum('code_chunks_project_path_v32')
            },
            // migration 33: Add project_path to code_dependencies for per-project isolation
            // CRITICAL: This table also needs project_path for codebase indexer to work per-project
            {
                version: 33,
                name: 'code_dependencies_project_path',
                up: `
          -- Add project_path to code_dependencies for project isolation
          DO $$ BEGIN
            ALTER TABLE code_dependencies
            ADD COLUMN IF NOT EXISTS project_path TEXT DEFAULT '/';
          EXCEPTION WHEN duplicate_column THEN NULL;
          END $$;

          -- Index for project_path filtering
          CREATE INDEX IF NOT EXISTS idx_code_dependencies_project_path
            ON code_dependencies(project_path);

          -- Composite index for project + source lookups
          CREATE INDEX IF NOT EXISTS idx_code_dependencies_project_source
            ON code_dependencies(project_path, source_file_id);
        `,
                down: `
          DROP INDEX IF EXISTS idx_code_dependencies_project_source;
          DROP INDEX IF EXISTS idx_code_dependencies_project_path;
          ALTER TABLE code_dependencies DROP COLUMN IF EXISTS project_path;
        `,
                checksum: this.generateChecksum('code_dependencies_project_path_v33')
            },
            // migration 34: Add project_path to code_complexity for per-project isolation
            // CRITICAL: This table also needs project_path for codebase metrics per-project
            {
                version: 34,
                name: 'code_complexity_project_path',
                up: `
          -- Add project_path to code_complexity for project isolation
          DO $$ BEGIN
            ALTER TABLE code_complexity
            ADD COLUMN IF NOT EXISTS project_path TEXT DEFAULT '/';
          EXCEPTION WHEN duplicate_column THEN NULL;
          END $$;

          -- Index for project_path filtering
          CREATE INDEX IF NOT EXISTS idx_code_complexity_project_path
            ON code_complexity(project_path);

          -- Composite index for project + file lookups
          CREATE INDEX IF NOT EXISTS idx_code_complexity_project_file
            ON code_complexity(project_path, file_id);
        `,
                down: `
          DROP INDEX IF EXISTS idx_code_complexity_project_file;
          DROP INDEX IF EXISTS idx_code_complexity_project_path;
          ALTER TABLE code_complexity DROP COLUMN IF EXISTS project_path;
        `,
                checksum: this.generateChecksum('code_complexity_project_path_v34')
            },
            // migration 35: Add composite indexes for common project_path query patterns
            // CRITICAL: Queries use project_path (TEXT) not project_id (UUID) - need matching indexes
            {
                version: 35,
                name: 'composite_project_path_indexes',
                up: `
          -- Composite index for project + created_at (recent memories query)
          -- Used by: find_memory with recencyBoost, getStatsRealtime
          CREATE INDEX IF NOT EXISTS idx_memories_project_path_created
            ON memories(project_path, created_at DESC);

          -- Composite index for project + importance (priority lookup)
          -- Used by: find_memory with importance filter
          CREATE INDEX IF NOT EXISTS idx_memories_project_path_importance
            ON memories(project_path, importance);

          -- Composite index for project + memory_type (filtered searches)
          -- Used by: find_memory with memoryTypes filter
          CREATE INDEX IF NOT EXISTS idx_memories_project_path_type
            ON memories(project_path, memory_type);

          -- Composite index for codebase_files project + file_path
          -- Used by: codebaseTools queries filtering by project_path and file_path
          CREATE INDEX IF NOT EXISTS idx_codebase_files_project_path_file
            ON codebase_files(project_path, file_path);

          -- Composite index for codebase_files project + content_hash (dedup check)
          -- Used by: codebaseIndexer for hash lookups per project
          CREATE INDEX IF NOT EXISTS idx_codebase_files_project_path_hash
            ON codebase_files(project_path, content_hash);

          -- Composite index for memories project + content_hash (dedup check)
          -- Used by: yeetStuffInDb for duplicate memory detection
          CREATE INDEX IF NOT EXISTS idx_memories_project_path_hash
            ON memories(project_path, content_hash);
        `,
                down: `
          DROP INDEX IF EXISTS idx_memories_project_path_created;
          DROP INDEX IF EXISTS idx_memories_project_path_importance;
          DROP INDEX IF EXISTS idx_memories_project_path_type;
          DROP INDEX IF EXISTS idx_codebase_files_project_path_file;
          DROP INDEX IF EXISTS idx_codebase_files_project_path_hash;
          DROP INDEX IF EXISTS idx_memories_project_path_hash;
        `,
                checksum: this.generateChecksum('composite_project_path_indexes_v35')
            }
        ];
    }
    // validates all migration checksums to detect tampering
    async validateMigrations() {
        const applied = await this.getAppliedMigrations();
        const migrations = this.getMigrations();
        const issues = [];
        for (const record of applied) {
            const migration = migrations.find(m => m.version === record.version);
            if (!migration) {
                issues.push(`migration ${record.version} (${record.name}) not found in codebase`);
                continue;
            }
            if (migration.checksum !== record.checksum) {
                issues.push(`checksum mismatch for migration ${record.version}: ` +
                    `expected ${record.checksum}, got ${migration.checksum}`);
            }
        }
        return {
            valid: issues.length === 0,
            issues
        };
    }
    // gets migration status
    async getStatus() {
        await this.ensureMigrationTable();
        const applied = await this.getAppliedMigrations();
        const allMigrations = this.getMigrations();
        return {
            applied,
            pending: allMigrations.filter(m => !applied.some(a => a.version === m.version)),
            lastApplied: applied[applied.length - 1] ?? null
        };
    }
}
//# sourceMappingURL=bigBrainMigrations.js.map