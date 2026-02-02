/**
 * teamComms.ts - Team Communication Tables Migration
 *
 * Creates the database schema for team member communication:
 * - team_channels: Slack-like channels for task coordination
 * - team_messages: Messages with threading support
 * - task_claims: Track who's working on what files
 *
 * Usage:
 *   npx tsx src/migrations/teamComms.ts
 *   npx tsx src/migrations/teamComms.ts --dry-run
 *
 * @author specmem team
 */
import { getDatabase } from '../database.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
async function migrateTeamComms(options) {
    logger.info('='.repeat(60));
    logger.info('TEAM COMMUNICATION MIGRATION');
    logger.info('='.repeat(60));
    if (options.dryRun) {
        logger.info('DRY RUN MODE - No changes will be made');
    }
    const db = getDatabase(config.database);
    try {
        await db.initialize();
        // Check if tables already exist in the current project schema
        const schemaName = db.getProjectSchemaName();
        // yooo CRITICAL: explicitly set search_path before creating tables
        // this ensures tables go into the project schema, not public
        // (pool connections might not preserve search_path between queries)
        logger.info({ schemaName }, '[TeamComms Migration] Setting search_path for project schema isolation');
        await db.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
        await db.query(`SET search_path TO ${schemaName}, public`);
        const existingTables = await db.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = $1
        AND tablename IN ('team_channels', 'team_messages', 'task_claims')
    `, [schemaName]);
        const existing = new Set(existingTables.rows.map(r => r.tablename));
        if (existing.size === 3) {
            logger.info('All team communication tables already exist');
            return;
        }
        logger.info({ existing: Array.from(existing) }, 'Existing tables');
        if (options.dryRun) {
            const toCreate = ['team_channels', 'team_messages', 'task_claims'].filter(t => !existing.has(t));
            logger.info({ toCreate }, 'Would create tables');
            logger.info('Run without --dry-run to apply changes');
            return;
        }
        // Create team_channels table
        if (!existing.has('team_channels')) {
            await db.query(`
        CREATE TABLE team_channels (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255) NOT NULL,
          task_id VARCHAR(255),
          project_path TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          archived_at TIMESTAMPTZ
        )
      `);
            await db.query(`CREATE INDEX idx_team_channels_task ON team_channels(task_id)`);
            await db.query(`CREATE INDEX idx_team_channels_project ON team_channels(project_path)`);
            await db.query(`CREATE INDEX idx_team_channels_active ON team_channels(archived_at) WHERE archived_at IS NULL`);
            logger.info('Created team_channels table');
        }
        // Create team_messages table
        if (!existing.has('team_messages')) {
            await db.query(`
        CREATE TABLE team_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          channel_id UUID REFERENCES team_channels(id) ON DELETE CASCADE,
          sender_id VARCHAR(255) NOT NULL,
          sender_name VARCHAR(255),
          message_type VARCHAR(50) DEFAULT 'message',
          content TEXT NOT NULL,
          metadata JSONB DEFAULT '{}',
          thread_id UUID REFERENCES team_messages(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          read_by JSONB DEFAULT '[]'
        )
      `);
            await db.query(`CREATE INDEX idx_messages_channel ON team_messages(channel_id, created_at DESC)`);
            await db.query(`CREATE INDEX idx_messages_thread ON team_messages(thread_id)`);
            await db.query(`CREATE INDEX idx_messages_sender ON team_messages(sender_id)`);
            await db.query(`CREATE INDEX idx_messages_type ON team_messages(message_type)`);
            logger.info('Created team_messages table');
        }
        // Create task_claims table
        if (!existing.has('task_claims')) {
            await db.query(`
        CREATE TABLE task_claims (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          channel_id UUID REFERENCES team_channels(id) ON DELETE CASCADE,
          team_member_id VARCHAR(255) NOT NULL,
          task_description TEXT NOT NULL,
          file_paths TEXT[],
          status VARCHAR(50) DEFAULT 'in_progress',
          claimed_at TIMESTAMPTZ DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        )
      `);
            await db.query(`CREATE INDEX idx_claims_channel ON task_claims(channel_id, status)`);
            await db.query(`CREATE INDEX idx_claims_member ON task_claims(team_member_id)`);
            await db.query(`CREATE INDEX idx_claims_status ON task_claims(status)`);
            await db.query(`CREATE INDEX idx_claims_files ON task_claims USING gin(file_paths)`);
            logger.info('Created task_claims table');
        }
        // Create helper functions
        await db.query(`
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
      $$ LANGUAGE plpgsql
    `);
        await db.query(`
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
      $$ LANGUAGE plpgsql
    `);
        await db.query(`
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
          tc.file_paths & file_paths_param
        FROM task_claims tc
        WHERE tc.channel_id = channel_id_param
          AND tc.status = 'in_progress'
          AND tc.file_paths && file_paths_param
          AND (exclude_member_id IS NULL OR tc.team_member_id != exclude_member_id);
      END;
      $$ LANGUAGE plpgsql
    `);
        logger.info('Created helper functions');
        logger.info('='.repeat(60));
        logger.info('MIGRATION COMPLETE');
        logger.info('='.repeat(60));
    }
    catch (error) {
        logger.error({ error }, 'Team comms migration failed');
        process.exit(1);
    }
    finally {
        await db.close();
    }
}
// Parse CLI arguments
function parseArgs() {
    const args = process.argv.slice(2);
    return {
        dryRun: args.includes('--dry-run')
    };
}
// Run
const options = parseArgs();
migrateTeamComms(options).then(() => {
    logger.info('Team comms migration script finished');
    process.exit(0);
}).catch((error) => {
    logger.error({ error }, 'Script failed');
    process.exit(1);
});
//# sourceMappingURL=teamComms.js.map