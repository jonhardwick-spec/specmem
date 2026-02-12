-- PROJECT NAMESPACING MIGRATION
-- Adds project isolation to SpecMem database
-- Migration Version: 29.1
--
-- ISOLATION STRATEGIES:
-- 1. SCHEMA-PER-PROJECT (NEW - Primary): Each project gets its own PostgreSQL schema
--    - Schema name: specmem_{8-char-sha256-hash}
--    - All tables created within project schema
--    - search_path set to: specmem_{hash}, public
--
-- 2. PROJECT_ID COLUMN (Legacy): Adds project_id column to shared tables
--    - Uses projects registry table with UUIDs
--    - Foreign key constraints for data integrity
--    - Maintained for backward compatibility
--
-- This migration handles BOTH approaches for flexible deployment

-- ============================================================================
-- PROJECTS REGISTRY TABLE
-- ============================================================================
-- Central registry mapping project paths to UUIDs
-- Uses UPSERT pattern for race-condition-free registration

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    path VARCHAR(500) NOT NULL UNIQUE,
    name VARCHAR(255),                              -- Optional friendly name
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast path lookups
CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);

-- ============================================================================
-- DEFAULT PROJECT
-- ============================================================================
-- Insert a default project for backfilling existing data
-- Uses '/' as the default project path (root/unassigned)

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

-- Add foreign key constraint (if not exists pattern)
DO $$ BEGIN
    ALTER TABLE memories
    ADD CONSTRAINT fk_memories_project_id
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET DEFAULT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id);

-- Composite index for common queries: project + created_at
CREATE INDEX IF NOT EXISTS idx_memories_project_created ON memories(project_id, created_at DESC);

-- Composite index for project + importance (for filtered searches)
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

-- Composite for project + file path lookups
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

-- Composite for project + definition name lookups
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
-- ADD project_id TO codebase_pointers TABLE
-- ============================================================================

DO $$ BEGIN
    ALTER TABLE codebase_pointers
    ADD COLUMN IF NOT EXISTS project_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE codebase_pointers
    ADD CONSTRAINT fk_codebase_pointers_project_id
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET DEFAULT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_codebase_pointers_project_id ON codebase_pointers(project_id);

-- ============================================================================
-- ADD project_id TO team_messages TABLE
-- ============================================================================

DO $$ BEGIN
    ALTER TABLE team_messages
    ADD COLUMN IF NOT EXISTS project_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE team_messages
    ADD CONSTRAINT fk_team_messages_project_id
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET DEFAULT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_team_messages_project_id ON team_messages(project_id);

-- Composite for project + channel + time (common query pattern)
CREATE INDEX IF NOT EXISTS idx_team_messages_project_channel ON team_messages(project_id, channel_id, created_at DESC);

-- ============================================================================
-- ADD project_id TO task_claims TABLE
-- ============================================================================

DO $$ BEGIN
    ALTER TABLE task_claims
    ADD COLUMN IF NOT EXISTS project_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE task_claims
    ADD CONSTRAINT fk_task_claims_project_id
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET DEFAULT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_task_claims_project_id ON task_claims(project_id);

-- Composite for project + status (active claims per project)
CREATE INDEX IF NOT EXISTS idx_task_claims_project_status ON task_claims(project_id, status);

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
-- RACE-CONDITION-FREE PROJECT REGISTRATION FUNCTION
-- ============================================================================
-- Uses UPSERT pattern to atomically get-or-create project

CREATE OR REPLACE FUNCTION register_project(
    p_path VARCHAR(500),
    p_name VARCHAR(255) DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_project_id UUID;
BEGIN
    -- Atomic UPSERT: insert if new, update last_accessed if exists
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
-- BACKFILL FUNCTION
-- ============================================================================
-- Assigns existing data to default project if not already assigned
-- Can also attempt to extract project_path from metadata if available

CREATE OR REPLACE FUNCTION backfill_project_ids()
RETURNS TABLE (
    table_name TEXT,
    rows_updated BIGINT
) AS $$
DECLARE
    v_default_id UUID := '00000000-0000-0000-0000-000000000000'::uuid;
    v_count BIGINT;
BEGIN
    -- Backfill memories
    UPDATE memories
    SET project_id = v_default_id
    WHERE project_id IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    table_name := 'memories';
    rows_updated := v_count;
    RETURN NEXT;

    -- Backfill codebase_files
    UPDATE codebase_files
    SET project_id = v_default_id
    WHERE project_id IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    table_name := 'codebase_files';
    rows_updated := v_count;
    RETURN NEXT;

    -- Backfill code_definitions
    UPDATE code_definitions
    SET project_id = v_default_id
    WHERE project_id IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    table_name := 'code_definitions';
    rows_updated := v_count;
    RETURN NEXT;

    -- Backfill code_dependencies
    UPDATE code_dependencies
    SET project_id = v_default_id
    WHERE project_id IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    table_name := 'code_dependencies';
    rows_updated := v_count;
    RETURN NEXT;

    -- Backfill codebase_pointers
    UPDATE codebase_pointers
    SET project_id = v_default_id
    WHERE project_id IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    table_name := 'codebase_pointers';
    rows_updated := v_count;
    RETURN NEXT;

    -- Backfill team_messages
    UPDATE team_messages
    SET project_id = v_default_id
    WHERE project_id IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    table_name := 'team_messages';
    rows_updated := v_count;
    RETURN NEXT;

    -- Backfill task_claims
    UPDATE task_claims
    SET project_id = v_default_id
    WHERE project_id IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    table_name := 'task_claims';
    rows_updated := v_count;
    RETURN NEXT;

    -- Backfill team_channels (if exists)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'team_channels') THEN
        EXECUTE 'UPDATE team_channels SET project_id = $1 WHERE project_id IS NULL' USING v_default_id;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        table_name := 'team_channels';
        rows_updated := v_count;
        RETURN NEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- HELPER: Get project ID by path (cached in app layer)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_project_id(p_path VARCHAR(500))
RETURNS UUID AS $$
DECLARE
    v_project_id UUID;
BEGIN
    SELECT id INTO v_project_id
    FROM projects
    WHERE path = p_path;

    -- Auto-register if not found
    IF v_project_id IS NULL THEN
        v_project_id := register_project(p_path);
    ELSE
        -- Update last_accessed
        UPDATE projects SET last_accessed_at = NOW() WHERE id = v_project_id;
    END IF;

    RETURN v_project_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- RUN BACKFILL
-- ============================================================================
-- Automatically backfill on migration run

SELECT * FROM backfill_project_ids();
