-- PROCESSED TRAINING DATA
-- Stores data that has been embedded, analyzed, and compacted
--
-- =============================================================================
-- EMBEDDING DIMENSION NOTE
-- =============================================================================
-- DEPRECATED: SPECMEM_EMBEDDING_DIMENSIONS is no longer used.
--
-- Embedding dimensions are now AUTO-DETECTED from the database pgvector column.
-- The database pg_attribute table is the single source of truth for dimensions.
-- The Frankenstein embedding model outputs 384-dim embeddings natively.
--
-- This table uses 128-dim for lightweight training data (different from main memories).
-- The system auto-migrates when dimension mismatch is detected at startup.
-- WARNING: Changing dimensions requires clearing existing embeddings!
-- =============================================================================

CREATE TABLE IF NOT EXISTS processed_training (
    id BIGSERIAL PRIMARY KEY,
    data_hash VARCHAR(64) NOT NULL UNIQUE,  -- SHA256 for ACK checking
    data_type VARCHAR(50) NOT NULL,         -- violation, visitor, codebase, memory
    content TEXT NOT NULL,
    keywords TEXT,                           -- Comma-separated keywords
    -- NOTE: Training data intentionally uses 128-dim for lightweight storage
    -- This is separate from the main memory embeddings (384-dim)
    embedding vector(128),                   -- Lightweight 128-dim vector for training data
    relevance FLOAT,                         -- COT relevance score (0-1)
    reasoning TEXT,                          -- COT reasoning
    compacted_content TEXT,                  -- Compressed content for upchain
    processed_at TIMESTAMPTZ DEFAULT NOW(),

    -- Indexes
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for ACK checking
CREATE INDEX IF NOT EXISTS idx_processed_training_hash ON processed_training(data_hash);

-- Index for type filtering
CREATE INDEX IF NOT EXISTS idx_processed_training_type ON processed_training(data_type);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_processed_training_time ON processed_training(processed_at);

-- Vector index for similarity search
CREATE INDEX IF NOT EXISTS idx_processed_training_embedding
ON processed_training USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Storage management: Auto-delete processed data older than 90 days
CREATE OR REPLACE FUNCTION cleanup_old_processed_training()
RETURNS void AS $$
BEGIN
    DELETE FROM processed_training
    WHERE processed_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- Schedule cleanup (call this periodically from cron/scheduler)
-- Example: SELECT cleanup_old_processed_training();
