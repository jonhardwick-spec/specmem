-- MEMORY DRILLDOWN SYSTEM
-- Enables Claude to drill down from memory snippets → full code + conversation

-- CODEBASE POINTERS
-- Links memories to actual code files/functions/classes
CREATE TABLE IF NOT EXISTS codebase_pointers (
    id BIGSERIAL PRIMARY KEY,
    memory_id UUID NOT NULL,              -- UUID to match memories table
    file_path TEXT NOT NULL,              -- Relative to codebase root
    line_start INTEGER,                   -- Optional: specific line range
    line_end INTEGER,
    function_name TEXT,                   -- Optional: specific function
    class_name TEXT,                      -- Optional: specific class
    pointer_type TEXT,                    -- Type: modification, reference, discussion
    embedding vector(384),                -- Embedding for semantic search on file context
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_codebase_pointers_memory ON codebase_pointers(memory_id);
CREATE INDEX IF NOT EXISTS idx_codebase_pointers_file ON codebase_pointers(file_path);

-- ADD COLUMNS IF THEY DON'T EXIST (for existing installations)
DO $$ BEGIN
    ALTER TABLE codebase_pointers ADD COLUMN IF NOT EXISTS pointer_type TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE codebase_pointers ADD COLUMN IF NOT EXISTS embedding vector(384);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Vector index for semantic search on file modification context
CREATE INDEX IF NOT EXISTS idx_codebase_pointers_embedding
ON codebase_pointers USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- TEAM MEMBER CONVERSATIONS
-- Stores the conversation context that spawned a memory
CREATE TABLE IF NOT EXISTS team_member_conversations (
    id BIGSERIAL PRIMARY KEY,
    memory_id UUID NOT NULL,              -- UUID to match memories table
    team_member_id VARCHAR(255) NOT NULL,       -- Which team member created this
    team_member_name VARCHAR(255),               -- Human-readable team member name
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    summary TEXT,                          -- Short summary of conversation
    full_transcript TEXT,                  -- Full conversation (optional, can be large)

    -- Metadata
    message_count INTEGER,                 -- How many messages in conversation
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_member_conversations_memory ON team_member_conversations(memory_id);
CREATE INDEX IF NOT EXISTS idx_team_member_conversations_team_member ON team_member_conversations(team_member_id);
CREATE INDEX IF NOT EXISTS idx_team_member_conversations_time ON team_member_conversations(timestamp);

-- HELPER FUNCTIONS

-- Get memory with all drill-down context
CREATE OR REPLACE FUNCTION get_memory_full(memory_id_param VARCHAR)
RETURNS TABLE (
    memory_content TEXT,
    memory_keywords TEXT,
    code_files TEXT[],
    conversation_summary TEXT,
    related_memory_ids TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.content,
        m.keywords,
        ARRAY(
            SELECT file_path
            FROM codebase_pointers
            WHERE memory_id = memory_id_param
        ),
        (
            SELECT summary
            FROM team_member_conversations
            WHERE memory_id = memory_id_param
            ORDER BY timestamp DESC
            LIMIT 1
        ),
        ARRAY(
            SELECT id::TEXT
            FROM memories
            WHERE id != memory_id_param
            ORDER BY embedding <=> (SELECT embedding FROM memories WHERE id = memory_id_param)
            LIMIT 5
        )
    FROM memories m
    WHERE m.id = memory_id_param;
END;
$$ LANGUAGE plpgsql;

-- Example usage:
-- SELECT * FROM get_memory_full('mem_12345');
