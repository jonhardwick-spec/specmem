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
-- END - Core data uses PUBLIC schema with project_path filtering
-- ============================================================================
