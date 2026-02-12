/**
 * memoryEvolutionMigration.ts - Database migrations for human-like memory evolution
 *
 * This file contains the SQL migrations needed to support:
 * 1. Memory strength tracking (forgetting curves)
 * 2. Associative links between memories
 * 3. Memory chains for reasoning paths
 * 4. Quadrant-based spatial partitioning
 *
 * Run these migrations after the core SpecMem migrations.
 *
 * EMBEDDING DIMENSION NOTE:
 * DEPRECATED: SPECMEM_EMBEDDING_DIMENSIONS is no longer used.
 * Embedding dimensions are AUTO-DETECTED from the database pgvector column.
 * The database pg_attribute table is the single source of truth for dimensions.
 * The system auto-migrates when dimension mismatch is detected at startup.
 *
 * NO HARDCODED DIMENSIONS - runtime uses pg_attribute for actual dimension
 */
export declare const MEMORY_EVOLUTION_MIGRATIONS: {
    version: number;
    name: string;
    up: string;
    down: string;
    checksum: string;
};
/**
 * Get the SQL to run this migration
 */
export declare function getMemoryEvolutionMigrationSQL(): string;
/**
 * Get the SQL to rollback this migration
 */
export declare function getMemoryEvolutionRollbackSQL(): string;
export default MEMORY_EVOLUTION_MIGRATIONS;
//# sourceMappingURL=memoryEvolutionMigration.d.ts.map