/**
 * Code Explanation System - Database Schema
 *
 * Tables:
 * - code_explanations: Store explanations for code locations
 * - code_prompt_links: Link code to conversation prompts/memories
 * - code_access_patterns: Track access patterns for learning
 *
 * EMBEDDING DIMENSION NOTE:
 * DEPRECATED: SPECMEM_EMBEDDING_DIMENSIONS is no longer used.
 * Embedding dimensions are AUTO-DETECTED from the database pgvector column.
 * The system auto-migrates when dimension mismatch is detected at startup.
 */
import { logger } from '../utils/logger.js';
/**
 * Initialize the code explanation schema
 * This creates all necessary tables for the active recall system
 */
export async function initializeCodeExplanationSchema(db) {
    logger.info('Initializing code explanation schema...');
    try {
        // Create code_explanations table
        await db.query(`
      CREATE TABLE IF NOT EXISTS code_explanations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code_id UUID REFERENCES codebase_files(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        line_start INTEGER,
        line_end INTEGER,
        code_snippet TEXT,
        explanation_text TEXT NOT NULL,
        explanation_type VARCHAR(50) DEFAULT 'general',
        -- NOTE: Dimension is auto-detected from memories table, unbounded initially
        embedding vector,
        quality_score FLOAT DEFAULT 0.5,
        use_count INTEGER DEFAULT 0,
        feedback_positive INTEGER DEFAULT 0,
        feedback_negative INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(100) DEFAULT 'assistant',
        metadata JSONB DEFAULT '{}',

        CONSTRAINT quality_score_range CHECK (quality_score >= 0 AND quality_score <= 1),
        CONSTRAINT line_range_valid CHECK (line_start IS NULL OR line_end IS NULL OR line_start <= line_end)
      )
    `);
        // Create indexes for code_explanations
        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_explanations_code_id
      ON code_explanations(code_id)
    `);
        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_explanations_file_path
      ON code_explanations(file_path)
    `);
        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_explanations_embedding
      ON code_explanations USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `);
        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_explanations_quality
      ON code_explanations(quality_score DESC)
    `);
        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_explanations_type
      ON code_explanations(explanation_type)
    `);
        logger.info('code_explanations table created');
        // Create code_prompt_links table
        await db.query(`
      CREATE TABLE IF NOT EXISTS code_prompt_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code_id UUID REFERENCES codebase_files(id) ON DELETE CASCADE,
        memory_id UUID REFERENCES memories(id) ON DELETE CASCADE,
        explanation_id UUID REFERENCES code_explanations(id) ON DELETE SET NULL,
        relationship_type VARCHAR(50) NOT NULL DEFAULT 'referenced',
        context TEXT,
        strength FLOAT DEFAULT 1.0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        metadata JSONB DEFAULT '{}',

        CONSTRAINT strength_range CHECK (strength >= 0 AND strength <= 1),
        CONSTRAINT unique_code_memory UNIQUE (code_id, memory_id, relationship_type)
      )
    `);
        // Create indexes for code_prompt_links
        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_prompt_links_code_id
      ON code_prompt_links(code_id)
    `);
        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_prompt_links_memory_id
      ON code_prompt_links(memory_id)
    `);
        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_prompt_links_relationship
      ON code_prompt_links(relationship_type)
    `);
        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_prompt_links_strength
      ON code_prompt_links(strength DESC)
    `);
        logger.info('code_prompt_links table created');
        // Create code_access_patterns table
        await db.query(`
      CREATE TABLE IF NOT EXISTS code_access_patterns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code_id UUID REFERENCES codebase_files(id) ON DELETE CASCADE,
        access_count INTEGER DEFAULT 1,
        last_accessed TIMESTAMPTZ DEFAULT NOW(),
        common_queries TEXT[] DEFAULT '{}',
        query_embeddings JSONB DEFAULT '[]',
        access_contexts TEXT[] DEFAULT '{}',
        hourly_access_pattern INTEGER[] DEFAULT ARRAY[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        daily_access_pattern INTEGER[] DEFAULT ARRAY[0,0,0,0,0,0,0],
        first_accessed TIMESTAMPTZ DEFAULT NOW(),
        metadata JSONB DEFAULT '{}',

        CONSTRAINT unique_code_pattern UNIQUE (code_id)
      )
    `);
        // Create indexes for code_access_patterns
        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_access_patterns_code_id
      ON code_access_patterns(code_id)
    `);
        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_access_patterns_access_count
      ON code_access_patterns(access_count DESC)
    `);
        await db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_access_patterns_last_accessed
      ON code_access_patterns(last_accessed DESC)
    `);
        logger.info('code_access_patterns table created');
        // Create trigger to update updated_at on code_explanations
        await db.query(`
      CREATE OR REPLACE FUNCTION update_code_explanation_modified()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
        await db.query(`
      DROP TRIGGER IF EXISTS code_explanations_updated_at ON code_explanations
    `);
        await db.query(`
      CREATE TRIGGER code_explanations_updated_at
        BEFORE UPDATE ON code_explanations
        FOR EACH ROW
        EXECUTE FUNCTION update_code_explanation_modified()
    `);
        // Create function to update quality score based on feedback
        await db.query(`
      CREATE OR REPLACE FUNCTION update_explanation_quality()
      RETURNS TRIGGER AS $$
      BEGIN
        -- Calculate quality based on positive vs negative feedback
        IF (NEW.feedback_positive + NEW.feedback_negative) > 0 THEN
          NEW.quality_score = NEW.feedback_positive::FLOAT /
            (NEW.feedback_positive + NEW.feedback_negative)::FLOAT;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
        await db.query(`
      DROP TRIGGER IF EXISTS explanation_quality_update ON code_explanations
    `);
        await db.query(`
      CREATE TRIGGER explanation_quality_update
        BEFORE UPDATE ON code_explanations
        FOR EACH ROW
        WHEN (OLD.feedback_positive IS DISTINCT FROM NEW.feedback_positive
              OR OLD.feedback_negative IS DISTINCT FROM NEW.feedback_negative)
        EXECUTE FUNCTION update_explanation_quality()
    `);
        logger.info('Code explanation schema initialized successfully');
    }
    catch (error) {
        logger.error({ error }, 'Failed to initialize code explanation schema');
        throw error;
    }
}
/**
 * Check if code explanation schema exists
 */
export async function schemaExists(db) {
    try {
        const result = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'code_explanations'
      ) as exists
    `);
        return result.rows[0]?.exists ?? false;
    }
    catch {
        return false;
    }
}
/**
 * Get schema statistics
 */
export async function getSchemaStats(db) {
    const [explanations, links, patterns] = await Promise.all([
        db.query('SELECT COUNT(*) as count FROM code_explanations'),
        db.query('SELECT COUNT(*) as count FROM code_prompt_links'),
        db.query('SELECT COUNT(*) as count FROM code_access_patterns')
    ]);
    return {
        explanations: parseInt(explanations.rows[0]?.count ?? '0', 10),
        links: parseInt(links.rows[0]?.count ?? '0', 10),
        patterns: parseInt(patterns.rows[0]?.count ?? '0', 10)
    };
}
//# sourceMappingURL=schema.js.map