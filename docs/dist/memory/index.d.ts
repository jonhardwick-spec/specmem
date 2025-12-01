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
export { HumanLikeMemorySystem, type MemoryStrength, type AssociativeLink, type MemoryChain, type ContextWindow } from './humanLikeMemory.js';
export { QuadrantSearchSystem, type Quadrant, type QuadrantSearchResult, type QuadrantAssignment } from './quadrantSearch.js';
export { MEMORY_EVOLUTION_MIGRATIONS, getMemoryEvolutionMigrationSQL, getMemoryEvolutionRollbackSQL } from './memoryEvolutionMigration.js';
export type { Memory, MemoryType, ImportanceLevelType, SearchResult } from '../types/index.js';
//# sourceMappingURL=index.d.ts.map