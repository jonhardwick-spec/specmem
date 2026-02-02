/**
 * Database Module Exports
 *
 * Provides embedded PostgreSQL initialization and management for per-project instances.
 *
 * Two implementations are available:
 * 1. initEmbeddedPostgres.ts - Full initialization with migrations (used by TypeScript server)
 * 2. embeddedPostgres.ts - Lightweight manager (used standalone or by external callers)
 */
export { initializeEmbeddedPostgres, initializeDatabase, installExtensions, runMigrations, verifyDatabase, getDefaultBaseDir, stopEmbeddedPostgres, getEmbeddedPostgresStatus, type EmbeddedPostgresConfig as InitEmbeddedPostgresConfig, type InitResult } from './initEmbeddedPostgres.js';
export { EmbeddedPostgresManager, getEmbeddedPostgres, initEmbeddedPostgres, stopEmbeddedPostgres as stopEmbeddedPostgresManager, isEmbeddedPostgresRunning, } from './embeddedPostgres.js';
//# sourceMappingURL=index.d.ts.map