/**
 * Database Module Exports
 *
 * Provides embedded PostgreSQL initialization and management for per-project instances.
 *
 * Two implementations are available:
 * 1. initEmbeddedPostgres.ts - Full initialization with migrations (used by TypeScript server)
 * 2. embeddedPostgres.ts - Lightweight manager (used standalone or by external callers)
 */
// Export from initEmbeddedPostgres.ts (comprehensive initialization)
export { 
// Main initialization function
initializeEmbeddedPostgres, 
// Individual step functions (for fine-grained control)
initializeDatabase, installExtensions, runMigrations, verifyDatabase, 
// Utility functions
getDefaultBaseDir, stopEmbeddedPostgres, getEmbeddedPostgresStatus } from './initEmbeddedPostgres.js';
// Export from embeddedPostgres.ts (lightweight manager for per-project instances)
export { EmbeddedPostgresManager, getEmbeddedPostgres, initEmbeddedPostgres, stopEmbeddedPostgres as stopEmbeddedPostgresManager, isEmbeddedPostgresRunning, } from './embeddedPostgres.js';
//# sourceMappingURL=index.js.map