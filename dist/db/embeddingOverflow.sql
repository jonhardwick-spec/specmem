-- Embedding Overflow Database Schema
-- Stores violation/security data when AI models are paused
-- Max 10GB storage, 90-day retention (configurable)
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
-- The system auto-migrates when dimension mismatch is detected at startup.
-- WARNING: Changing dimensions requires clearing existing embeddings!
-- =============================================================================

CREATE TABLE IF NOT EXISTS embedding_overflow (
    id BIGSERIAL PRIMARY KEY,

    -- Data identification
    data_hash VARCHAR(64) NOT NULL UNIQUE,  -- SHA256 hash for ACK checking
    data_type VARCHAR(50) NOT NULL,         -- 'violation', 'security_event', etc.

    -- Content (the actual data to be embedded)
    content TEXT NOT NULL,
    content_json JSONB,                      -- Original structured data

    -- Metadata
    source_ip INET,
    user_agent TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    priority INTEGER DEFAULT 2,              -- 0=critical, 1=high, 2=normal, 3=low

    -- Processing status
    status VARCHAR(20) DEFAULT 'pending',    -- pending, processing, completed, failed
    -- NOTE: Dimension is auto-detected at runtime, unbounded initially
    embedding_vector vector,                  -- pgvector for semantic search (lightweight for overflow)
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,

    -- Storage management
    data_size_bytes INTEGER,                 -- Track size for 10GB limit
    expires_at TIMESTAMPTZ,                  -- Auto-expire old data

    -- Indexes for performance
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_overflow_status ON embedding_overflow(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_overflow_hash ON embedding_overflow(data_hash);
CREATE INDEX IF NOT EXISTS idx_overflow_expires ON embedding_overflow(expires_at);
CREATE INDEX IF NOT EXISTS idx_overflow_type ON embedding_overflow(data_type, status);
CREATE INDEX IF NOT EXISTS idx_overflow_timestamp ON embedding_overflow(timestamp DESC);

-- Embedding vector index for semantic search (when embeddings are generated)
CREATE INDEX IF NOT EXISTS idx_overflow_embedding
ON embedding_overflow
USING ivfflat (embedding_vector vector_cosine_ops)
WITH (lists = 100);

-- Configuration table for overflow system
CREATE TABLE IF NOT EXISTS embedding_overflow_config (
    id INTEGER PRIMARY KEY DEFAULT 1,

    -- Storage limits
    max_storage_gb DECIMAL(5,2) DEFAULT 10.0,
    current_storage_gb DECIMAL(5,2) DEFAULT 0.0,

    -- Retention policy
    retention_days INTEGER DEFAULT 90,
    auto_purge_enabled BOOLEAN DEFAULT true,
    purge_batch_size INTEGER DEFAULT 1000,

    -- Processing limits
    catchup_batch_size INTEGER DEFAULT 50,
    catchup_rps_limit DECIMAL(4,2) DEFAULT 2.0,

    -- Statistics
    total_queued BIGINT DEFAULT 0,
    total_processed BIGINT DEFAULT 0,
    total_failed BIGINT DEFAULT 0,
    total_purged BIGINT DEFAULT 0,

    last_catchup_at TIMESTAMPTZ,
    last_purge_at TIMESTAMPTZ,

    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT only_one_config CHECK (id = 1)
);

-- Initialize config
INSERT INTO embedding_overflow_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Function to calculate total storage size
CREATE OR REPLACE FUNCTION update_overflow_storage_size()
RETURNS DECIMAL AS $$
DECLARE
    total_bytes BIGINT;
    total_gb DECIMAL;
BEGIN
    SELECT COALESCE(SUM(data_size_bytes), 0) INTO total_bytes
    FROM embedding_overflow;

    total_gb := total_bytes / 1024.0 / 1024.0 / 1024.0;

    UPDATE embedding_overflow_config
    SET current_storage_gb = total_gb,
        updated_at = NOW()
    WHERE id = 1;

    RETURN total_gb;
END;
$$ LANGUAGE plpgsql;

-- Function to purge old data
CREATE OR REPLACE FUNCTION purge_old_overflow_data()
RETURNS INTEGER AS $$
DECLARE
    config_row embedding_overflow_config%ROWTYPE;
    deleted_count INTEGER;
    cutoff_date TIMESTAMPTZ;
BEGIN
    -- Get config
    SELECT * INTO config_row FROM embedding_overflow_config WHERE id = 1;

    IF NOT config_row.auto_purge_enabled THEN
        RETURN 0;
    END IF;

    -- Calculate cutoff date
    cutoff_date := NOW() - (config_row.retention_days || ' days')::INTERVAL;

    -- Delete old completed/failed records
    WITH deleted AS (
        DELETE FROM embedding_overflow
        WHERE status IN ('completed', 'failed')
        AND created_at < cutoff_date
        RETURNING id
    )
    SELECT COUNT(*) INTO deleted_count FROM deleted;

    -- Update stats
    UPDATE embedding_overflow_config
    SET total_purged = total_purged + deleted_count,
        last_purge_at = NOW(),
        updated_at = NOW()
    WHERE id = 1;

    -- Update storage size
    PERFORM update_overflow_storage_size();

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to check if storage limit exceeded and purge if needed
CREATE OR REPLACE FUNCTION enforce_storage_limit()
RETURNS BOOLEAN AS $$
DECLARE
    config_row embedding_overflow_config%ROWTYPE;
    current_gb DECIMAL;
    deleted_count INTEGER;
BEGIN
    SELECT * INTO config_row FROM embedding_overflow_config WHERE id = 1;
    current_gb := update_overflow_storage_size();

    IF current_gb > config_row.max_storage_gb THEN
        -- Emergency purge: delete oldest completed/failed records
        WITH deleted AS (
            DELETE FROM embedding_overflow
            WHERE status IN ('completed', 'failed')
            AND id IN (
                SELECT id FROM embedding_overflow
                WHERE status IN ('completed', 'failed')
                ORDER BY created_at ASC
                LIMIT config_row.purge_batch_size
            )
            RETURNING id
        )
        SELECT COUNT(*) INTO deleted_count FROM deleted;

        -- Update stats
        UPDATE embedding_overflow_config
        SET total_purged = total_purged + deleted_count,
            updated_at = NOW()
        WHERE id = 1;

        PERFORM update_overflow_storage_size();

        RETURN true;  -- Purge performed
    END IF;

    RETURN false;  -- No purge needed
END;
$$ LANGUAGE plpgsql;

-- Trigger to update storage size on insert/delete
CREATE OR REPLACE FUNCTION trigger_update_storage()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM update_overflow_storage_size();
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_storage_on_change
AFTER INSERT OR DELETE ON embedding_overflow
FOR EACH STATEMENT
EXECUTE FUNCTION trigger_update_storage();

-- Comments
COMMENT ON TABLE embedding_overflow IS 'Stores security/violation data waiting for AI model embedding. Max 10GB, auto-purge after 90 days.';
COMMENT ON COLUMN embedding_overflow.data_hash IS 'SHA256 hash for ACK checking - prevents duplicate embeddings';
COMMENT ON COLUMN embedding_overflow.status IS 'pending=waiting for model, processing=being embedded, completed=done, failed=error';
COMMENT ON TABLE embedding_overflow_config IS 'Configuration for overflow system - editable from SpecMem dashboard';
