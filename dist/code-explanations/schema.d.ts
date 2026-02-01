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
import { DatabaseManager } from '../database.js';
/**
 * Initialize the code explanation schema
 * This creates all necessary tables for the active recall system
 */
export declare function initializeCodeExplanationSchema(db: DatabaseManager): Promise<void>;
/**
 * Check if code explanation schema exists
 */
export declare function schemaExists(db: DatabaseManager): Promise<boolean>;
/**
 * Get schema statistics
 */
export declare function getSchemaStats(db: DatabaseManager): Promise<{
    explanations: number;
    links: number;
    patterns: number;
}>;
//# sourceMappingURL=schema.d.ts.map