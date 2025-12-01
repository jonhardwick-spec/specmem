/**
 * syncDimensions.ts - Sync embedding dimensions across all tables
 *
 * DEPRECATED: This migration script is now largely obsolete.
 *
 * Embedding dimensions are now AUTO-DETECTED from the database pgvector column.
 * The SPECMEM_EMBEDDING_DIMENSIONS environment variable is DEPRECATED and ignored.
 * The database pg_attribute table is the single source of truth for dimensions.
 *
 * The system auto-migrates when dimension mismatch is detected at startup.
 * See src/dashboard/standalone.ts for auto-migration logic.
 *
 * This script remains for backwards compatibility and manual migration needs.
 *
 * Usage:
 *   npx tsx src/migrations/syncDimensions.ts
 *   npx tsx src/migrations/syncDimensions.ts --dry-run
 *   npx tsx src/migrations/syncDimensions.ts --force
 *
 * @author specmem team
 * @deprecated Dimensions are now auto-detected from database
 */
export {};
//# sourceMappingURL=syncDimensions.d.ts.map