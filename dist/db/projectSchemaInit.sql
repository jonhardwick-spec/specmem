-- PROJECT SCHEMA INITIALIZATION v30.1
-- Creates project-specific coordination tables
-- Core data (memories, codebase_files, code_definitions) stays in PUBLIC schema
-- with project_path column for filtering
-- ============================================================================

-- ============================================================================
-- DASHBOARD SESSIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS dashboard_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_type VARCHAR(50) NOT NULL,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'
);

-- ============================================================================
-- EMBEDDING QUEUE TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS embedding_queue (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    content_hash VARCHAR(64) UNIQUE,
    source_type VARCHAR(50) NOT NULL,
    source_id TEXT,
    priority INTEGER DEFAULT 5,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_embedding_queue_status ON embedding_queue(status, priority DESC, created_at);

-- ============================================================================
-- CODE DEFINITIONS TABLE
-- Stores parsed function/class definitions for semantic code search
-- ============================================================================
CREATE TABLE IF NOT EXISTS code_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    qualified_name TEXT,
    definition_type VARCHAR(50) NOT NULL,  -- function, class, method, interface, etc
    language VARCHAR(50) NOT NULL,
    file_path TEXT NOT NULL,
    start_line INTEGER,
    end_line INTEGER,
    content TEXT NOT NULL,
    signature TEXT,
    docstring TEXT,
    is_exported BOOLEAN DEFAULT false,
    embedding vector(384),
    project_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    project_path VARCHAR(500) DEFAULT '/',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_code_definitions_file_path ON code_definitions(file_path);
CREATE INDEX IF NOT EXISTS idx_code_definitions_name ON code_definitions(name);
CREATE INDEX IF NOT EXISTS idx_code_definitions_type ON code_definitions(definition_type);
CREATE INDEX IF NOT EXISTS idx_code_definitions_project_path ON code_definitions(project_path);

-- ============================================================================
-- CODEBASE POINTERS TABLE
-- Links memories to actual code files/functions/classes
-- ============================================================================
CREATE TABLE IF NOT EXISTS codebase_pointers (
    id BIGSERIAL PRIMARY KEY,
    memory_id UUID NOT NULL,
    file_path TEXT NOT NULL,
    line_start INTEGER,
    line_end INTEGER,
    function_name TEXT,
    class_name TEXT,
    pointer_type TEXT,
    embedding vector(384),
    project_path VARCHAR(500) DEFAULT '/',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_codebase_pointers_memory_id ON codebase_pointers(memory_id);
CREATE INDEX IF NOT EXISTS idx_codebase_pointers_file_path ON codebase_pointers(file_path);
CREATE INDEX IF NOT EXISTS idx_codebase_pointers_project_path ON codebase_pointers(project_path);

-- ============================================================================
-- TEAM MEMBER TABLES (match newserver pattern)
-- ============================================================================

CREATE TABLE IF NOT EXISTS team_member_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_member_id VARCHAR(255) NOT NULL,
    team_member_type VARCHAR(100),
    prompt TEXT,
    status VARCHAR(50) DEFAULT 'running',
    screen_session VARCHAR(255),
    output_file TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS team_member_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_member_id VARCHAR(255) NOT NULL,
    session_type VARCHAR(50),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS team_member_logs (
    id BIGSERIAL PRIMARY KEY,
    team_member_id VARCHAR(255) NOT NULL,
    log_type VARCHAR(50) DEFAULT 'info',
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_member_logs_agent ON team_member_logs(team_member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS team_member_shared_code (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_member_id VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    content TEXT,
    language VARCHAR(50),
    shared_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS team_member_code_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_member_id VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    chunk_index INTEGER DEFAULT 0,
    content TEXT NOT NULL,
    embedding vector(384),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_member_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_member_id VARCHAR(255) NOT NULL,
    feedback_type VARCHAR(50) NOT NULL,
    content TEXT,
    rating INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_member_to_team_member_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_team_member_id UUID REFERENCES team_member_deployments(id) ON DELETE SET NULL,
    to_team_member_id UUID REFERENCES team_member_deployments(id) ON DELETE SET NULL,
    message TEXT NOT NULL,
    metadata JSONB,
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_a2a_messages_to ON team_member_to_team_member_messages(to_team_member_id);
CREATE INDEX IF NOT EXISTS idx_a2a_messages_from ON team_member_to_team_member_messages(from_team_member_id);
CREATE INDEX IF NOT EXISTS idx_a2a_messages_unread ON team_member_to_team_member_messages(to_team_member_id, read) WHERE read = FALSE;

-- ============================================================================
-- TEAM COMMS TABLES (channels, messages, claims, help requests)
-- ============================================================================

CREATE TABLE IF NOT EXISTS team_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    channel_type VARCHAR(50) NOT NULL DEFAULT 'default',
    task_id VARCHAR(255),
    project_id VARCHAR(255),
    project_path VARCHAR(500) NOT NULL DEFAULT '/',
    members TEXT[] NOT NULL DEFAULT '{}',
    created_by VARCHAR(255) NOT NULL DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS team_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES team_channels(id) ON DELETE CASCADE,
    sender_id VARCHAR(255) NOT NULL,
    sender_name VARCHAR(255) NOT NULL DEFAULT 'Unknown',
    content TEXT NOT NULL,
    message_type VARCHAR(50) NOT NULL DEFAULT 'update',
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    thread_id UUID,
    mentions TEXT[] NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',
    project_path VARCHAR(500) NOT NULL DEFAULT '/',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_by TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS task_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    description TEXT NOT NULL,
    files TEXT[] NOT NULL DEFAULT '{}',
    claimed_by VARCHAR(255) NOT NULL,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}',
    project_path VARCHAR(500) NOT NULL DEFAULT '/'
);

CREATE TABLE IF NOT EXISTS help_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question TEXT NOT NULL,
    context TEXT,
    requested_by VARCHAR(255) NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    channel_id UUID REFERENCES team_channels(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    project_path VARCHAR(500) NOT NULL DEFAULT '/'
);

-- MIGRATION: Add project_path column to existing tables if missing
-- This handles upgrades from older schema versions
DO $$
BEGIN
    -- help_requests
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'help_requests' AND column_name = 'project_path' AND table_schema = current_schema()) THEN
        ALTER TABLE help_requests ADD COLUMN project_path VARCHAR(500) NOT NULL DEFAULT '/';
    END IF;
    -- team_channels
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'team_channels' AND column_name = 'project_path' AND table_schema = current_schema()) THEN
        ALTER TABLE team_channels ADD COLUMN project_path VARCHAR(500) NOT NULL DEFAULT '/';
    END IF;
    -- team_messages
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'team_messages' AND column_name = 'project_path' AND table_schema = current_schema()) THEN
        ALTER TABLE team_messages ADD COLUMN project_path VARCHAR(500) NOT NULL DEFAULT '/';
    END IF;
    -- task_claims
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'task_claims' AND column_name = 'project_path' AND table_schema = current_schema()) THEN
        ALTER TABLE task_claims ADD COLUMN project_path VARCHAR(500) NOT NULL DEFAULT '/';
    END IF;
END $$;

-- Team comms indexes
CREATE INDEX IF NOT EXISTS idx_team_messages_channel_id ON team_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_team_messages_created_at ON team_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_messages_project_path ON team_messages(project_path);
CREATE INDEX IF NOT EXISTS idx_team_channels_project_path ON team_channels(project_path);
CREATE INDEX IF NOT EXISTS idx_task_claims_status ON task_claims(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_task_claims_project_path ON task_claims(project_path);
CREATE INDEX IF NOT EXISTS idx_help_requests_status ON help_requests(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_help_requests_project_path ON help_requests(project_path);

-- Default channels (main + swarm-1 through swarm-5)
-- These get created per-project with deterministic UUIDs based on project path
-- The actual channel IDs are generated by getChannelIdByName() in teamComms.js
-- Here we just ensure a basic main channel exists
INSERT INTO team_channels (name, channel_type, created_by, project_path)
SELECT 'team-main', 'default', 'system', '/'
WHERE NOT EXISTS (SELECT 1 FROM team_channels WHERE name = 'team-main' AND channel_type = 'default');

INSERT INTO team_channels (name, channel_type, created_by, project_path)
SELECT 'team-broadcast', 'broadcast', 'system', '/'
WHERE NOT EXISTS (SELECT 1 FROM team_channels WHERE name = 'team-broadcast' AND channel_type = 'broadcast');

-- ============================================================================
-- TEAM MEMBER CONVERSATIONS TABLE
-- Stores the conversation context that spawned a memory
-- Required by MemoryDrilldown.js for getMemoryFull / drill_down
-- ============================================================================
CREATE TABLE IF NOT EXISTS team_member_conversations (
    id BIGSERIAL PRIMARY KEY,
    memory_id UUID NOT NULL,
    team_member_id VARCHAR(255) NOT NULL,
    team_member_name VARCHAR(255),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    summary TEXT,
    full_transcript TEXT,
    message_count INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_member_conversations_memory ON team_member_conversations(memory_id);
CREATE INDEX IF NOT EXISTS idx_team_member_conversations_team_member ON team_member_conversations(team_member_id);
CREATE INDEX IF NOT EXISTS idx_team_member_conversations_time ON team_member_conversations(timestamp);

-- ============================================================================
-- END - Core data uses PUBLIC schema with project_path filtering
-- ============================================================================
