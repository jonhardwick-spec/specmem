/**
 * DimensionService - Centralized embedding dimension management
 *
 * DEPRECATED: This service is now largely obsolete.
 *
 * Embedding dimensions are now AUTO-DETECTED from the database pgvector column.
 * The SPECMEM_EMBEDDING_DIMENSIONS environment variable is DEPRECATED and ignored.
 * The database pg_attribute table is the single source of truth for dimensions.
 *
 * The Frankenstein embedding model outputs 384-dim embeddings, and the system
 * dynamically detects this from the actual embeddings and the database schema.
 *
 * This service remains for backwards compatibility but should NOT be used for
 * new code. Use the projectionLayer.ts getTargetDimension() function instead.
 *
 * @author specmem team
 * @deprecated Use projectionLayer.ts for dimension detection
 */
import { logger } from '../utils/logger.js';
// DEPRECATED: Environment-based dimension configuration
// Dimensions are now auto-detected from the database pg_attribute table
const DIMENSION_ENV_VAR = 'SPECMEM_EMBEDDING_DIMENSIONS'; // DEPRECATED - DO NOT USE
const DEFAULT_DIMENSION = 384; // Frankenstein native dimension (was 1536)
/**
 * DimensionService provides centralized management of embedding vector dimensions.
 *
 * DEPRECATED: This service is now largely obsolete.
 * Dimensions are auto-detected from the database pg_attribute table.
 * Use projectionLayer.ts getTargetDimension() for new code.
 *
 * @deprecated
 */
export class DimensionService {
    static cachedDimension = null;
    /**
     * Get the configured embedding dimension.
     *
     * DEPRECATED: Dimensions are now auto-detected from the database.
     * This method only provides a fallback value for legacy compatibility.
     *
     * The database pg_attribute table is the single source of truth.
     * Use projectionLayer.ts getTargetDimension() for new code.
     *
     * Common dimensions (for reference only):
     * - 384: all-MiniLM-L6-v2 (Frankenstein)
     * - 768: all-mpnet-base-v2
     * - 1024: Cohere embed-english-v3.0
     * - 1536: OpenAI text-embedding-3-small, Ada-002
     * - 3072: OpenAI text-embedding-3-large
     *
     * @deprecated Use projectionLayer.ts getTargetDimension()
     */
    static getDimension() {
        if (this.cachedDimension !== null) {
            return this.cachedDimension;
        }
        const envValue = process.env[DIMENSION_ENV_VAR];
        if (envValue) {
            const parsed = parseInt(envValue, 10);
            if (!isNaN(parsed) && parsed > 0 && parsed <= 10000) {
                this.cachedDimension = parsed;
                return parsed;
            }
            logger.warn({ envValue, default: DEFAULT_DIMENSION }, `Invalid ${DIMENSION_ENV_VAR} value, using default`);
        }
        this.cachedDimension = DEFAULT_DIMENSION;
        return DEFAULT_DIMENSION;
    }
    /**
     * Get the SQL column definition for a vector column.
     * Use this in CREATE TABLE statements.
     *
     * @example
     * const sql = `CREATE TABLE foo (
     *   embedding ${DimensionService.getVectorColumnDef()}
     * )`;
     */
    static getVectorColumnDef() {
        return `vector(${this.getDimension()})`;
    }
    /**
     * Get the SQL column definition with NOT NULL constraint.
     */
    static getVectorColumnDefNotNull() {
        return `vector(${this.getDimension()}) NOT NULL`;
    }
    /**
     * Generate SQL to alter a table's embedding column dimension.
     *
     * WARNING: This requires dropping and recreating the column,
     * which means data loss. Use syncTableDimensionSafe for production.
     *
     * @param tableName Table name
     * @param columnName Column name (default: 'embedding')
     */
    static getAlterDimensionSQL(tableName, columnName = 'embedding') {
        const dim = this.getDimension();
        return `
      -- WARNING: This drops and recreates the column, losing existing data!
      -- Dimension managed by DimensionService: ${dim}
      -- To change dimensions without data loss, use migration with temp column

      DO $$
      DECLARE
        current_dim INTEGER;
      BEGIN
        -- Get current dimension
        SELECT atttypmod INTO current_dim
        FROM pg_attribute
        WHERE attrelid = '${tableName}'::regclass
          AND attname = '${columnName}';

        -- Only alter if dimension differs
        IF current_dim != ${dim} THEN
          RAISE NOTICE 'Altering ${tableName}.${columnName} from % to ${dim} dimensions', current_dim;

          -- Drop dependent indexes
          DROP INDEX IF EXISTS idx_${tableName}_${columnName};
          DROP INDEX IF EXISTS idx_${tableName}_${columnName}_hnsw;
          DROP INDEX IF EXISTS idx_${tableName}_${columnName}_ivfflat;

          -- Alter column type
          ALTER TABLE ${tableName}
          ALTER COLUMN ${columnName} TYPE vector(${dim})
          USING NULL; -- Clears data - cannot convert between dimensions

          RAISE NOTICE 'Column ${tableName}.${columnName} altered to ${dim} dimensions';
        END IF;
      END $$;
    `;
    }
    /**
     * Sync a table's embedding column to the configured dimension.
     * This is a DESTRUCTIVE operation that clears existing embeddings.
     *
     * @param db Database manager instance
     * @param tableName Table to sync
     * @param columnName Column name (default: 'embedding')
     * @returns true if altered, false if already correct dimension
     */
    static async syncTableDimension(db, tableName, columnName = 'embedding') {
        const targetDim = this.getDimension();
        try {
            // Get current dimension
            const result = await db.query(`SELECT atttypmod FROM pg_attribute
         WHERE attrelid = $1::regclass AND attname = $2`, [tableName, columnName]);
            if (result.rows.length === 0) {
                logger.warn({ tableName, columnName }, 'Column not found');
                return { altered: false, newDim: targetDim };
            }
            const currentDim = result.rows[0].atttypmod;
            if (currentDim === targetDim) {
                logger.debug({ tableName, columnName, dimension: targetDim }, 'Dimension already correct');
                return { altered: false, newDim: targetDim };
            }
            logger.info({ tableName, columnName, from: currentDim, to: targetDim }, 'Syncing embedding dimension');
            await db.query(this.getAlterDimensionSQL(tableName, columnName));
            return { altered: true, previousDim: currentDim, newDim: targetDim };
        }
        catch (error) {
            logger.error({ error, tableName, columnName }, 'Failed to sync dimension');
            throw error;
        }
    }
    /**
     * Get all tables with embedding columns and their current dimensions.
     * Useful for debugging and migration planning.
     */
    static async getTableDimensions(db) {
        const result = await db.query(`
      SELECT
        c.relname as table_name,
        a.attname as column_name,
        a.atttypmod as dimension
      FROM pg_attribute a
      JOIN pg_class c ON a.attrelid = c.oid
      JOIN pg_type t ON a.atttypid = t.oid
      WHERE t.typname = 'vector'
        AND c.relkind = 'r'
        AND NOT c.relname LIKE 'pg_%'
      ORDER BY c.relname, a.attname
    `);
        return result.rows.map((row) => ({
            table: row.table_name,
            column: row.column_name,
            dimension: row.dimension
        }));
    }
    /**
     * Sync ALL tables to the configured dimension.
     * This is a DESTRUCTIVE operation - use with caution!
     *
     * @param db Database manager
     * @returns Summary of changes
     */
    static async syncAllTables(db) {
        const tables = await this.getTableDimensions(db);
        const targetDim = this.getDimension();
        const result = {
            total: tables.length,
            altered: 0,
            skipped: 0,
            errors: []
        };
        for (const table of tables) {
            if (table.dimension === targetDim) {
                result.skipped++;
                continue;
            }
            try {
                await this.syncTableDimension(db, table.table, table.column);
                result.altered++;
            }
            catch (error) {
                result.errors.push({
                    table: table.table,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
        logger.info(result, 'Dimension sync complete');
        return result;
    }
    /**
     * Clear the cached dimension.
     * Useful for testing or when config changes at runtime.
     */
    static clearCache() {
        this.cachedDimension = null;
    }
    /**
     * Generate a comment for SQL files explaining the dynamic dimension.
     * Add this to all SQL files with vector columns.
     *
     * DEPRECATED: Dimensions are now auto-detected from the database.
     */
    static getSQLComment() {
        return `
-- =============================================================================
-- EMBEDDING DIMENSION NOTE
-- =============================================================================
-- DEPRECATED: SPECMEM_EMBEDDING_DIMENSIONS is no longer used.
--
-- Embedding dimensions are now AUTO-DETECTED from the database pgvector column.
-- The database pg_attribute table is the single source of truth for dimensions.
-- The Frankenstein embedding model outputs 384-dim embeddings natively.
--
-- To change dimensions:
--   1. The system auto-migrates when dimension mismatch is detected at startup
--   2. Or manually: ALTER TABLE memories ALTER COLUMN embedding TYPE vector(NEW_DIM)
--
-- WARNING: Changing dimensions requires clearing existing embeddings!
-- =============================================================================
`;
    }
}
// Export singleton access for convenience
export const getDimension = () => DimensionService.getDimension();
export const getVectorColumnDef = () => DimensionService.getVectorColumnDef();
export default DimensionService;
//# sourceMappingURL=dimensionService.js.map