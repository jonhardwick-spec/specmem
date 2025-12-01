/**
 * sessionStore.ts - PostgreSQL Session Store for Express-Session
 *
 * Production-ready session store that persists sessions to PostgreSQL
 * instead of memory. Prevents memory leaks and enables scaling.
 *
 * Features:
 * - Automatic session table creation
 * - Session expiration/cleanup
 * - Concurrent access handling
 * - Configurable cleanup interval
 *
 * @author hardwicksoftwareservices
 */
import { SessionData, Store } from 'express-session';
import { DatabaseManager } from '../database.js';
/**
 * Configuration for PostgreSQL session store
 */
export interface PgSessionStoreConfig {
    /** Database manager instance */
    db: DatabaseManager;
    /** Table name for sessions (default: 'sessions') */
    tableName?: string;
    /** Cleanup interval in ms (default: 900000 = 15 min) */
    cleanupIntervalMs?: number;
    /** Prune expired sessions on startup (default: true) */
    pruneOnStart?: boolean;
}
export declare class PgSessionStore extends Store {
    private db;
    private tableName;
    private cleanupInterval;
    private cleanupIntervalMs;
    private isInitialized;
    constructor(config: PgSessionStoreConfig);
    /**
     * Initialize the session store
     * Creates table if not exists and starts cleanup interval
     */
    initialize(pruneOnStart?: boolean): Promise<void>;
    /**
     * Start the cleanup interval to prune expired sessions
     */
    private startCleanupInterval;
    /**
     * Get a session from the store
     */
    get: (sid: string, callback: (err: unknown, session?: SessionData | null) => void) => void;
    /**
     * Set/update a session in the store
     */
    set: (sid: string, sess: SessionData, callback?: (err?: unknown) => void) => void;
    /**
     * Destroy a session
     */
    destroy: (sid: string, callback?: (err?: unknown) => void) => void;
    /**
     * Touch a session to extend its expiration
     */
    touch: (sid: string, sess: SessionData, callback?: (err?: unknown) => void) => void;
    /**
     * Get all sessions (for admin purposes)
     */
    all: (callback: (err: unknown, sessions?: {
        [sid: string]: SessionData;
    } | null) => void) => void;
    /**
     * Get count of active sessions
     */
    length: (callback: (err: unknown, length?: number) => void) => void;
    /**
     * Clear all sessions
     */
    clear: (callback?: (err?: unknown) => void) => void;
    /**
     * Shutdown the session store
     */
    shutdown(): Promise<void>;
}
/**
 * Create a PostgreSQL session store
 * Falls back to memory store if database is not available
 */
export declare function createSessionStore(db: DatabaseManager | null, options?: Omit<PgSessionStoreConfig, 'db'>): Promise<Store | undefined>;
//# sourceMappingURL=sessionStore.d.ts.map