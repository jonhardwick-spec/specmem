-- TEAM COMMUNICATION SYSTEM
-- Enables team member communication for spawned task coordination
-- Like Slack channels for team member teams
--
-- PROJECT ISOLATION:
-- - Each message, claim, and help request is tagged with project_path
-- - project_path = '/' means global/cross-project (visible to all)
-- - Queries filter by project_path to ensure project isolation

-- Team communication channels (like Slack channels)
CREATE TABLE IF NOT EXISTS team_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    task_id VARCHAR(255),  -- Links to spawned task
    project_path TEXT NOT NULL DEFAULT '/',  -- Project isolation: path to project root
    created_at TIMESTAMPTZ DEFAULT NOW(),
    archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_team_channels_task ON team_channels(task_id);
CREATE INDEX IF NOT EXISTS idx_team_channels_project ON team_channels(project_path);
CREATE INDEX IF NOT EXISTS idx_team_channels_active ON team_channels(archived_at) WHERE archived_at IS NULL;

-- Messages between team members
-- project_path enables cross-instance isolation:
-- - Messages with project_path matching your project are visible
-- - Messages with project_path = '/' (global) are visible to ALL projects
CREATE TABLE IF NOT EXISTS team_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID REFERENCES team_channels(id) ON DELETE CASCADE,
    sender_id VARCHAR(255) NOT NULL,  -- team member ID
    sender_name VARCHAR(255),  -- display name
    message_type VARCHAR(50) DEFAULT 'message',  -- message, status, code_review, help_request
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    thread_id UUID REFERENCES team_messages(id) ON DELETE SET NULL,  -- For threading
    project_path TEXT NOT NULL DEFAULT '/',  -- Project isolation: '/' = global, else project root
    created_at TIMESTAMPTZ DEFAULT NOW(),
    read_by JSONB DEFAULT '[]'  -- Array of team member IDs who read it
);

CREATE INDEX IF NOT EXISTS idx_messages_channel ON team_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON team_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON team_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_type ON team_messages(message_type);
CREATE INDEX IF NOT EXISTS idx_messages_project_path ON team_messages(project_path);

-- Task claims (who's working on what)
-- project_path ensures claims are project-scoped (no cross-project conflicts)
CREATE TABLE IF NOT EXISTS task_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID REFERENCES team_channels(id) ON DELETE CASCADE,
    team_member_id VARCHAR(255) NOT NULL,
    task_description TEXT NOT NULL,
    file_paths TEXT[],  -- Files being worked on
    status VARCHAR(50) DEFAULT 'in_progress',  -- in_progress, completed, abandoned
    project_path TEXT NOT NULL DEFAULT '/',  -- Project isolation
    claimed_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_claims_channel ON task_claims(channel_id, status);
CREATE INDEX IF NOT EXISTS idx_claims_member ON task_claims(team_member_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON task_claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_files ON task_claims USING gin(file_paths);
CREATE INDEX IF NOT EXISTS idx_claims_project_path ON task_claims(project_path);

-- Help requests (team members asking for help)
-- project_path ensures help requests are project-scoped
CREATE TABLE IF NOT EXISTS help_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question TEXT NOT NULL,
    context TEXT,
    requested_by VARCHAR(255) NOT NULL,
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(50) DEFAULT 'open',  -- open, answered
    channel_id UUID REFERENCES team_channels(id) ON DELETE SET NULL,
    project_path TEXT NOT NULL DEFAULT '/',  -- Project isolation
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_help_requests_status ON help_requests(status);
CREATE INDEX IF NOT EXISTS idx_help_requests_project_path ON help_requests(project_path);

-- HELPER FUNCTIONS

-- Get all active claims for a project (what's being worked on)
-- Now project-scoped: only returns claims from the specified project
CREATE OR REPLACE FUNCTION get_project_claims(project_path_param TEXT)
RETURNS TABLE (
    claim_id UUID,
    member_id VARCHAR(255),
    description TEXT,
    files TEXT[],
    status VARCHAR(50),
    claimed_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        tc.id,
        tc.team_member_id,
        tc.task_description,
        tc.file_paths,
        tc.status,
        tc.claimed_at
    FROM task_claims tc
    WHERE tc.project_path = project_path_param
      AND tc.status = 'in_progress'
    ORDER BY tc.claimed_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Get all active claims for a channel (legacy - not project-scoped)
CREATE OR REPLACE FUNCTION get_channel_claims(channel_id_param UUID)
RETURNS TABLE (
    claim_id UUID,
    member_id VARCHAR(255),
    description TEXT,
    files TEXT[],
    status VARCHAR(50),
    claimed_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        tc.id,
        tc.team_member_id,
        tc.task_description,
        tc.file_paths,
        tc.status,
        tc.claimed_at
    FROM task_claims tc
    WHERE tc.channel_id = channel_id_param
      AND tc.status = 'in_progress'
    ORDER BY tc.claimed_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Get unread message count for a team member in a project
-- Now project-scoped: only counts messages from the specified project + global
CREATE OR REPLACE FUNCTION get_project_unread_count(
    project_path_param TEXT,
    member_id_param VARCHAR(255)
)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM team_messages
        WHERE (project_path = project_path_param OR project_path = '/')
          AND sender_id != member_id_param
          AND NOT (read_by @> to_jsonb(member_id_param))
    );
END;
$$ LANGUAGE plpgsql;

-- Get unread message count for a team member in a channel (legacy)
CREATE OR REPLACE FUNCTION get_unread_count(
    channel_id_param UUID,
    member_id_param VARCHAR(255)
)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM team_messages
        WHERE channel_id = channel_id_param
          AND sender_id != member_id_param
          AND NOT (read_by @> to_jsonb(member_id_param))
    );
END;
$$ LANGUAGE plpgsql;

-- Check if any active claims overlap with given file paths (project-scoped)
-- Only checks within the same project to prevent false conflicts across projects
CREATE OR REPLACE FUNCTION check_project_file_conflicts(
    project_path_param TEXT,
    file_paths_param TEXT[],
    exclude_member_id VARCHAR(255) DEFAULT NULL
)
RETURNS TABLE (
    conflicting_claim_id UUID,
    conflicting_member_id VARCHAR(255),
    conflicting_files TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        tc.id,
        tc.team_member_id,
        tc.file_paths & file_paths_param  -- Intersection of arrays
    FROM task_claims tc
    WHERE tc.project_path = project_path_param
      AND tc.status = 'in_progress'
      AND tc.file_paths && file_paths_param  -- Arrays overlap
      AND (exclude_member_id IS NULL OR tc.team_member_id != exclude_member_id);
END;
$$ LANGUAGE plpgsql;

-- Check if any active claims overlap with given file paths (legacy - channel-based)
CREATE OR REPLACE FUNCTION check_file_conflicts(
    channel_id_param UUID,
    file_paths_param TEXT[],
    exclude_member_id VARCHAR(255) DEFAULT NULL
)
RETURNS TABLE (
    conflicting_claim_id UUID,
    conflicting_member_id VARCHAR(255),
    conflicting_files TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        tc.id,
        tc.team_member_id,
        tc.file_paths & file_paths_param  -- Intersection of arrays
    FROM task_claims tc
    WHERE tc.channel_id = channel_id_param
      AND tc.status = 'in_progress'
      AND tc.file_paths && file_paths_param  -- Arrays overlap
      AND (exclude_member_id IS NULL OR tc.team_member_id != exclude_member_id);
END;
$$ LANGUAGE plpgsql;
