/**
 * memoryEvolutionMigration.ts - Database migrations for human-like memory evolution
 *
 * This file contains the SQL migrations needed to support:
 * 1. Memory strength tracking (forgetting curves)
 * 2. Associative links between memories
 * 3. Memory chains for reasoning paths
 * 4. Quadrant-based spatial partitioning
 *
 * Run these migrations after the core SpecMem migrations.
 *
 * EMBEDDING DIMENSION NOTE:
 * DEPRECATED: SPECMEM_EMBEDDING_DIMENSIONS is no longer used.
 * Embedding dimensions are AUTO-DETECTED from the database pgvector column.
 * The database pg_attribute table is the single source of truth for dimensions.
 * The system auto-migrates when dimension mismatch is detected at startup.
 *
 * NO HARDCODED DIMENSIONS - runtime uses pg_attribute for actual dimension
 */
export const MEMORY_EVOLUTION_MIGRATIONS = {
    version: 26,
    name: 'create_memory_evolution_tables',
    up: `
    -- =====================================================
    -- MIGRATION 26: HUMAN-LIKE MEMORY EVOLUTION SYSTEM
    -- =====================================================
    -- This migration adds support for:
    -- 1. Memory strength tracking (Ebbinghaus forgetting curves)
    -- 2. Associative memory links (spreading activation)
    -- 3. Memory chains (reasoning paths)
    -- 4. Quadrant-based semantic partitioning

    -- =====================================================
    -- TABLE: memory_strength
    -- Tracks forgetting curve parameters for each memory
    -- =====================================================
    CREATE TABLE IF NOT EXISTS memory_strength (
      memory_id UUID PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,

      -- Forgetting curve parameters
      stability FLOAT NOT NULL DEFAULT 10.0,        -- Resistance to forgetting (1-100)
      retrievability FLOAT NOT NULL DEFAULT 1.0,    -- Current recall probability (0-1)
      ease_factor FLOAT NOT NULL DEFAULT 2.0,       -- How easy to recall (1.3-2.5, SM-2 algorithm)

      -- Review tracking
      last_review TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      review_count INTEGER NOT NULL DEFAULT 1,
      interval_days FLOAT NOT NULL DEFAULT 1.0,     -- Days until next optimal review

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Constraints
      CONSTRAINT valid_stability CHECK (stability >= 1 AND stability <= 100),
      CONSTRAINT valid_retrievability CHECK (retrievability >= 0 AND retrievability <= 1),
      CONSTRAINT valid_ease_factor CHECK (ease_factor >= 1.0 AND ease_factor <= 3.0)
    );

    -- Index for finding memories due for review
    CREATE INDEX IF NOT EXISTS idx_memory_strength_retrievability
      ON memory_strength(retrievability);
    CREATE INDEX IF NOT EXISTS idx_memory_strength_last_review
      ON memory_strength(last_review);

    -- Trigger to update updated_at
    DROP TRIGGER IF EXISTS memory_strength_updated_at ON memory_strength;
    CREATE TRIGGER memory_strength_updated_at
      BEFORE UPDATE ON memory_strength
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();

    -- =====================================================
    -- TABLE: memory_associations
    -- Stores bidirectional associative links between memories
    -- =====================================================
    CREATE TABLE IF NOT EXISTS memory_associations (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      source_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      target_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,

      -- Link properties
      link_type VARCHAR(50) NOT NULL DEFAULT 'contextual',
      strength FLOAT NOT NULL DEFAULT 0.3,          -- 0-1, how strong the association
      decay_rate FLOAT NOT NULL DEFAULT 0.1,        -- How fast this link weakens

      -- Co-activation tracking
      co_activation_count INTEGER NOT NULL DEFAULT 1,
      last_co_activation TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Constraints
      CONSTRAINT unique_association UNIQUE (source_id, target_id),
      CONSTRAINT no_self_association CHECK (source_id != target_id),
      CONSTRAINT valid_strength CHECK (strength >= 0 AND strength <= 1),
      CONSTRAINT valid_decay_rate CHECK (decay_rate >= 0 AND decay_rate <= 1),
      CONSTRAINT valid_link_type CHECK (
        link_type IN ('semantic', 'temporal', 'causal', 'contextual', 'user_defined')
      )
    );

    -- Indexes for association lookups
    CREATE INDEX IF NOT EXISTS idx_memory_associations_source
      ON memory_associations(source_id);
    CREATE INDEX IF NOT EXISTS idx_memory_associations_target
      ON memory_associations(target_id);
    CREATE INDEX IF NOT EXISTS idx_memory_associations_strength
      ON memory_associations(strength DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_associations_type
      ON memory_associations(link_type);
    CREATE INDEX IF NOT EXISTS idx_memory_associations_last_activation
      ON memory_associations(last_co_activation);

    -- Trigger for updated_at
    DROP TRIGGER IF EXISTS memory_associations_updated_at ON memory_associations;
    CREATE TRIGGER memory_associations_updated_at
      BEFORE UPDATE ON memory_associations
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();

    -- =====================================================
    -- TABLE: memory_chains
    -- Stores sequential reasoning paths through memories
    -- =====================================================
    CREATE TABLE IF NOT EXISTS memory_chains (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      -- Chain identification
      name VARCHAR(255) NOT NULL,
      description TEXT,
      chain_type VARCHAR(50) NOT NULL DEFAULT 'reasoning',
      importance importance_level NOT NULL DEFAULT 'medium',

      -- Chain contents (ordered array of memory IDs)
      memory_ids UUID[] NOT NULL DEFAULT '{}',

      -- Usage tracking
      access_count INTEGER NOT NULL DEFAULT 1,
      last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Flexible metadata
      metadata JSONB NOT NULL DEFAULT '{}',
      tags TEXT[] NOT NULL DEFAULT '{}',

      -- Constraints
      CONSTRAINT valid_chain_type CHECK (
        chain_type IN ('reasoning', 'implementation', 'debugging', 'exploration', 'conversation')
      ),
      CONSTRAINT chain_not_empty CHECK (array_length(memory_ids, 1) > 0 OR memory_ids = '{}')
    );

    -- Indexes for chain lookups
    CREATE INDEX IF NOT EXISTS idx_memory_chains_type
      ON memory_chains(chain_type);
    CREATE INDEX IF NOT EXISTS idx_memory_chains_importance
      ON memory_chains(importance);
    CREATE INDEX IF NOT EXISTS idx_memory_chains_last_accessed
      ON memory_chains(last_accessed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_chains_memory_ids
      ON memory_chains USING GIN(memory_ids);
    CREATE INDEX IF NOT EXISTS idx_memory_chains_tags
      ON memory_chains USING GIN(tags);
    CREATE INDEX IF NOT EXISTS idx_memory_chains_name
      ON memory_chains(name);

    -- Trigger for updated_at
    DROP TRIGGER IF EXISTS memory_chains_updated_at ON memory_chains;
    CREATE TRIGGER memory_chains_updated_at
      BEFORE UPDATE ON memory_chains
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();

    -- =====================================================
    -- TABLE: memory_quadrants
    -- Spatial/semantic partitioning for efficient search
    -- =====================================================
    CREATE TABLE IF NOT EXISTS memory_quadrants (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      -- Quadrant identification
      name VARCHAR(255) NOT NULL,
      level INTEGER NOT NULL DEFAULT 0,             -- 0=root, 1=domain, 2=subdomain, 3=leaf
      parent_id UUID REFERENCES memory_quadrants(id) ON DELETE CASCADE,
      child_ids UUID[] NOT NULL DEFAULT '{}',

      -- Semantic definition
      -- NOTE: Dimension is auto-detected, unbounded initially
      centroid vector,  -- Average embedding of all members
      radius FLOAT NOT NULL DEFAULT 0,              -- Max distance from centroid
      keywords TEXT[] NOT NULL DEFAULT '{}',        -- Representative keywords

      -- Statistics
      memory_count INTEGER NOT NULL DEFAULT 0,
      total_access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Thresholds for splitting/merging
      max_memories INTEGER NOT NULL DEFAULT 1000,
      min_memories INTEGER NOT NULL DEFAULT 50,
      max_radius FLOAT NOT NULL DEFAULT 0.5,

      -- Metadata
      memory_types memory_type[] NOT NULL DEFAULT '{}',
      tags TEXT[] NOT NULL DEFAULT '{}',
      metadata JSONB NOT NULL DEFAULT '{}',

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Constraints
      CONSTRAINT valid_level CHECK (level >= 0 AND level <= 10)
    );

    -- Indexes for quadrant lookups
    CREATE INDEX IF NOT EXISTS idx_memory_quadrants_level
      ON memory_quadrants(level);
    CREATE INDEX IF NOT EXISTS idx_memory_quadrants_parent
      ON memory_quadrants(parent_id)
      WHERE parent_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_memory_quadrants_memory_count
      ON memory_quadrants(memory_count DESC);

    -- HNSW index for centroid similarity search
    CREATE INDEX IF NOT EXISTS idx_memory_quadrants_centroid_hnsw
      ON memory_quadrants
      USING hnsw (centroid vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);

    -- Trigger for updated_at
    DROP TRIGGER IF EXISTS memory_quadrants_updated_at ON memory_quadrants;
    CREATE TRIGGER memory_quadrants_updated_at
      BEFORE UPDATE ON memory_quadrants
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();

    -- =====================================================
    -- TABLE: quadrant_assignments
    -- Tracks which quadrant each memory belongs to
    -- =====================================================
    CREATE TABLE IF NOT EXISTS quadrant_assignments (
      memory_id UUID PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
      quadrant_id UUID NOT NULL REFERENCES memory_quadrants(id) ON DELETE CASCADE,
      distance_to_centroid FLOAT NOT NULL DEFAULT 0,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Indexes for assignment lookups
    CREATE INDEX IF NOT EXISTS idx_quadrant_assignments_quadrant
      ON quadrant_assignments(quadrant_id);
    CREATE INDEX IF NOT EXISTS idx_quadrant_assignments_distance
      ON quadrant_assignments(quadrant_id, distance_to_centroid);

    -- =====================================================
    -- FUNCTION: decay_memory_retrievability
    -- Automatically decays memory strength over time
    -- =====================================================
    CREATE OR REPLACE FUNCTION decay_memory_retrievability()
    RETURNS void AS $$
    BEGIN
      -- Update retrievability using Ebbinghaus formula
      -- R(t) = e^(-t/S) where t is days since last review, S is stability
      UPDATE memory_strength
      SET retrievability = LEAST(1.0, GREATEST(0.0,
        exp(-EXTRACT(EPOCH FROM (NOW() - last_review)) / (86400 * stability))
      ));
    END;
    $$ LANGUAGE plpgsql;

    -- =====================================================
    -- FUNCTION: decay_association_strength
    -- Automatically decays association links over time
    -- =====================================================
    CREATE OR REPLACE FUNCTION decay_association_strength()
    RETURNS INTEGER AS $$
    DECLARE
      deleted_count INTEGER;
    BEGIN
      -- Decay associations that haven't been reinforced
      UPDATE memory_associations
      SET strength = strength * (1 - decay_rate)
      WHERE last_co_activation < NOW() - INTERVAL '7 days';

      -- Delete very weak associations
      DELETE FROM memory_associations WHERE strength < 0.05;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;

      RETURN deleted_count;
    END;
    $$ LANGUAGE plpgsql;

    -- =====================================================
    -- VIEW: memory_health_overview
    -- Shows overall health of the memory system
    -- =====================================================
    CREATE OR REPLACE VIEW memory_health_overview AS
    SELECT
      (SELECT COUNT(*) FROM memories WHERE expires_at IS NULL OR expires_at > NOW()) as total_memories,
      (SELECT COUNT(*) FROM memory_strength WHERE retrievability > 0.7) as strong_memories,
      (SELECT COUNT(*) FROM memory_strength WHERE retrievability < 0.3) as fading_memories,
      (SELECT COUNT(*) FROM memory_associations) as total_associations,
      (SELECT COUNT(*) FROM memory_chains) as total_chains,
      (SELECT COUNT(*) FROM memory_quadrants) as total_quadrants,
      (SELECT AVG(retrievability) FROM memory_strength) as avg_retrievability,
      (SELECT AVG(stability) FROM memory_strength) as avg_stability,
      NOW() as computed_at;

    -- =====================================================
    -- INDEX: Add relationship tracking to existing memories table
    -- =====================================================
    -- Add a column to track related memories if not exists
    DO $$ BEGIN
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS related_memories UUID[] DEFAULT '{}';
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

    -- Index for related memories lookup
    CREATE INDEX IF NOT EXISTS idx_memories_related
      ON memories USING GIN(related_memories)
      WHERE related_memories IS NOT NULL AND array_length(related_memories, 1) > 0;
  `,
    down: `
    -- Rollback migration 26

    -- Drop views first
    DROP VIEW IF EXISTS memory_health_overview;

    -- Drop functions
    DROP FUNCTION IF EXISTS decay_association_strength();
    DROP FUNCTION IF EXISTS decay_memory_retrievability();

    -- Drop triggers
    DROP TRIGGER IF EXISTS quadrant_assignments_updated_at ON quadrant_assignments;
    DROP TRIGGER IF EXISTS memory_quadrants_updated_at ON memory_quadrants;
    DROP TRIGGER IF EXISTS memory_chains_updated_at ON memory_chains;
    DROP TRIGGER IF EXISTS memory_associations_updated_at ON memory_associations;
    DROP TRIGGER IF EXISTS memory_strength_updated_at ON memory_strength;

    -- Drop tables in dependency order
    DROP TABLE IF EXISTS quadrant_assignments CASCADE;
    DROP TABLE IF EXISTS memory_quadrants CASCADE;
    DROP TABLE IF EXISTS memory_chains CASCADE;
    DROP TABLE IF EXISTS memory_associations CASCADE;
    DROP TABLE IF EXISTS memory_strength CASCADE;

    -- Remove added column from memories
    ALTER TABLE memories DROP COLUMN IF EXISTS related_memories;
  `,
    checksum: 'memory_evolution_v26_human_like'
};
/**
 * Get the SQL to run this migration
 */
export function getMemoryEvolutionMigrationSQL() {
    return MEMORY_EVOLUTION_MIGRATIONS.up;
}
/**
 * Get the SQL to rollback this migration
 */
export function getMemoryEvolutionRollbackSQL() {
    return MEMORY_EVOLUTION_MIGRATIONS.down;
}
export default MEMORY_EVOLUTION_MIGRATIONS;
//# sourceMappingURL=memoryEvolutionMigration.js.map