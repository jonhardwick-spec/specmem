-- Minimal schema for codebase search
-- Uses 384 dimensions (MiniLM model)

-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Codebase files table
CREATE TABLE IF NOT EXISTS codebase_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_path TEXT NOT NULL,
    absolute_path TEXT,
    file_name VARCHAR(255),
    extension VARCHAR(50),
    language_id VARCHAR(50) DEFAULT 'unknown',
    language_name VARCHAR(100) DEFAULT 'Unknown',
    content TEXT,
    content_hash VARCHAR(64),
    size_bytes INTEGER DEFAULT 0,
    line_count INTEGER DEFAULT 0,
    embedding vector(384),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    project_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_codebase_files_path ON codebase_files(file_path);
CREATE INDEX IF NOT EXISTS idx_codebase_files_language ON codebase_files(language_id);
CREATE INDEX IF NOT EXISTS idx_codebase_files_project ON codebase_files(project_path);

-- Code definitions table (functions, classes, etc.)
CREATE TABLE IF NOT EXISTS code_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_id UUID REFERENCES codebase_files(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    name VARCHAR(500) NOT NULL,
    qualified_name VARCHAR(1000),
    definition_type VARCHAR(50) NOT NULL,
    start_line INTEGER,
    end_line INTEGER,
    start_column INTEGER,
    end_column INTEGER,
    signature TEXT,
    docstring TEXT,
    return_type VARCHAR(255),
    visibility VARCHAR(50) DEFAULT 'public',
    is_exported BOOLEAN DEFAULT false,
    is_async BOOLEAN DEFAULT false,
    is_static BOOLEAN DEFAULT false,
    is_abstract BOOLEAN DEFAULT false,
    parent_definition_id UUID REFERENCES code_definitions(id) ON DELETE CASCADE,
    parameters JSONB DEFAULT '[]',
    language VARCHAR(50),
    decorators TEXT[],
    metadata JSONB DEFAULT '{}',
    project_path TEXT,
    embedding vector(384),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_code_definitions_file_id ON code_definitions(file_id);
CREATE INDEX IF NOT EXISTS idx_code_definitions_file_path ON code_definitions(file_path);
CREATE INDEX IF NOT EXISTS idx_code_definitions_name ON code_definitions(name);
CREATE INDEX IF NOT EXISTS idx_code_definitions_type ON code_definitions(definition_type);
CREATE INDEX IF NOT EXISTS idx_code_definitions_language ON code_definitions(language);
CREATE INDEX IF NOT EXISTS idx_code_definitions_project ON code_definitions(project_path);

-- HNSW index for semantic search (only after dimension is set!)
CREATE INDEX IF NOT EXISTS idx_code_definitions_embedding_hnsw
    ON code_definitions USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Code dependencies table
CREATE TABLE IF NOT EXISTS code_dependencies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_file_id UUID REFERENCES codebase_files(id) ON DELETE CASCADE,
    source_file_path TEXT NOT NULL,
    target_path TEXT,
    resolved_path TEXT,
    import_type VARCHAR(50),
    import_statement TEXT,
    imported_names TEXT[],
    imported_as VARCHAR(255),
    is_default_import BOOLEAN DEFAULT false,
    is_namespace_import BOOLEAN DEFAULT false,
    is_type_import BOOLEAN DEFAULT false,
    is_side_effect_import BOOLEAN DEFAULT false,
    line_number INTEGER,
    column_number INTEGER,
    is_external BOOLEAN DEFAULT false,
    is_builtin BOOLEAN DEFAULT false,
    is_relative BOOLEAN DEFAULT false,
    is_absolute BOOLEAN DEFAULT false,
    is_dynamic BOOLEAN DEFAULT false,
    package_name VARCHAR(255),
    package_version VARCHAR(100),
    language VARCHAR(50),
    metadata JSONB DEFAULT '{}',
    project_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_code_deps_source ON code_dependencies(source_file_id);
CREATE INDEX IF NOT EXISTS idx_code_deps_target ON code_dependencies(target_path);
CREATE INDEX IF NOT EXISTS idx_code_deps_project ON code_dependencies(project_path);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    CREATE TRIGGER code_definitions_updated_at
        BEFORE UPDATE ON code_definitions
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER codebase_files_updated_at
        BEFORE UPDATE ON codebase_files
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Verify
SELECT
    'code_definitions' as table_name,
    COUNT(*) as row_count
FROM code_definitions
UNION ALL
SELECT
    'codebase_files',
    COUNT(*)
FROM codebase_files;
