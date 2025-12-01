/**
 * claudeCodeMigration.ts - Database migrations for Claude code tracking
 *
 * yooo this migration lets Claude REMEMBER what it wrote
 * no more massive explores because Claude will KNOW
 * what code it created and WHY
 *
 * EMBEDDING DIMENSION NOTE:
 * DEPRECATED: SPECMEM_EMBEDDING_DIMENSIONS is no longer used.
 * Embedding dimensions are AUTO-DETECTED from the database pgvector column.
 * The system auto-migrates when dimension mismatch is detected at startup.
 */
import { logger } from '../utils/logger.js';
/**
 * Migration to create claude_code_history table
 *
 * fr fr tracking everything Claude writes so it never forgets
 */
export const claudeCodeHistoryMigration = {
    version: 15,
    name: 'create_claude_code_history',
    up: `
    -- yooo Claude about to remember EVERYTHING it writes
    -- no more massive explores needed fr

    -- main table for tracking Claude's code
    CREATE TABLE IF NOT EXISTS claude_code_history (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      -- what did Claude write?
      file_path TEXT NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      code_content TEXT NOT NULL,
      code_hash VARCHAR(64) GENERATED ALWAYS AS (
        encode(sha256(code_content::bytea), 'hex')
      ) STORED,

      -- why did Claude write it?
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
      -- NOTE: Dimension is auto-detected from memories table, unbounded initially
      embedding vector,

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
    checksum: 'claude_code_history_v15'
};
/**
 * Run the migration using a connection pool
 */
export async function runClaudeCodeMigration(client) {
    logger.info('running claude_code_history migration - Claude about to remember EVERYTHING');
    const start = Date.now();
    try {
        await client.query(claudeCodeHistoryMigration.up);
        const duration = Date.now() - start;
        logger.info({ duration }, 'claude_code_history migration complete - WE DID IT');
    }
    catch (error) {
        logger.error({ error }, 'claude_code_history migration FAILED');
        throw error;
    }
}
/**
 * Check if migration has been applied
 */
export async function isClaudeCodeMigrationApplied(client) {
    try {
        const result = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'claude_code_history'
      ) as exists
    `);
        return result.rows[0]?.exists ?? false;
    }
    catch (e) {
        // Database not connected or table check failed - assume no history exists
        return false;
    }
}
//# sourceMappingURL=claudeCodeMigration.js.map