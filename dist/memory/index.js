/**
 * memory/index.ts - Human-Like Memory Evolution System
 *
 * This module exports all components for SpecMem's evolved memory architecture:
 *
 * 1. HumanLikeMemorySystem - Core system with forgetting curves, associations, chains
 * 2. QuadrantSearchSystem - Spatial/semantic partitioning for fast search
 * 3. Migration utilities - Database schema for evolution features
 *
 * The goal is to make Claude's memory more natural and intelligent,
 * supporting human-like patterns of:
 * - Forgetting (Ebbinghaus curves)
 * - Association (spreading activation)
 * - Reasoning chains (sequential paths)
 * - Adaptive context (dynamic windows)
 * - Spatial organization (quadrants)
 */
// Core human-like memory system
export { HumanLikeMemorySystem } from './humanLikeMemory.js';
// Quadrant-based search system
export { QuadrantSearchSystem } from './quadrantSearch.js';
// Database migrations
export { MEMORY_EVOLUTION_MIGRATIONS, getMemoryEvolutionMigrationSQL, getMemoryEvolutionRollbackSQL } from './memoryEvolutionMigration.js';
//# sourceMappingURL=index.js.map