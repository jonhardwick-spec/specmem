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
// @ts-ignore - express-session types not installed
import { Store } from 'express-session';
import { logger } from '../utils/logger.js';
import { getProjectSchema } from '../db/projectNamespacing.js';
/**
 * PostgreSQL Session Store
 *
 * Implements express-session Store interface to persist
 * sessions to PostgreSQL database.
 */
// LOW-37 FIX: Validate table name to prevent SQL injection
// Only allow alphanumeric characters and underscores
const VALID_TABLE_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function validateTableName(tableName) {
    if (!VALID_TABLE_NAME_REGEX.test(tableName)) {
        throw new Error(`Invalid table name: "${tableName}" - only alphanumeric characters and underscores allowed`);
    }
    if (tableName.length > 63) {
        throw new Error(`Table name too long: "${tableName}" - max 63 characters`);
    }
    return tableName;
}
export class PgSessionStore extends Store {
    db;
    tableName;
    cleanupInterval = null;
    cleanupIntervalMs;
    isInitialized = false;
    constructor(config) {
        super();
        this.db = config.db;
        // LOW-37 FIX: Validate table name at construction time
        this.tableName = validateTableName(config.tableName ?? 'sessions');
        this.cleanupIntervalMs = config.cleanupIntervalMs ?? 15 * 60 * 1000;
    }
    /**
     * Initialize the session store
     * Creates table if not exists and starts cleanup interval
     */
    async initialize(pruneOnStart = true) {
        if (this.isInitialized)
            return;
        try {
            // CRITICAL: Set search_path BEFORE creating table to ensure
            // it's created in the correct project schema, not public
            const schemaName = getProjectSchema();
            await this.db.query(`SET search_path TO ${schemaName}, public`);
            logger.debug({ schemaName, tableName: this.tableName }, 'Search path set for session store initialization');
            // Create sessions table if not exists
            await this.db.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          sid VARCHAR(255) PRIMARY KEY,
          sess JSON NOT NULL,
          expire TIMESTAMPTZ NOT NULL
        )
      `);
            // Create index on expire for efficient cleanup
            await this.db.query(`
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_expire
        ON ${this.tableName}(expire)
      `);
            // Prune expired sessions on startup
            if (pruneOnStart) {
                const result = await this.db.query(`
          DELETE FROM ${this.tableName}
          WHERE expire < NOW()
          RETURNING sid
        `);
                if (result.rowCount && result.rowCount > 0) {
                    logger.info({ pruned: result.rowCount }, 'Pruned expired sessions on startup');
                }
            }
            // Start cleanup interval
            this.startCleanupInterval();
            this.isInitialized = true;
            logger.info({ tableName: this.tableName }, 'PostgreSQL session store initialized');
        }
        catch (error) {
            logger.error({ error }, 'Failed to initialize PostgreSQL session store');
            throw error;
        }
    }
    /**
     * Start the cleanup interval to prune expired sessions
     */
    startCleanupInterval() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.cleanupInterval = setInterval(async () => {
            try {
                const result = await this.db.query(`
          DELETE FROM ${this.tableName}
          WHERE expire < NOW()
          RETURNING sid
        `);
                if (result.rowCount && result.rowCount > 0) {
                    logger.debug({ pruned: result.rowCount }, 'Pruned expired sessions');
                }
            }
            catch (error) {
                logger.error({ error }, 'Error pruning expired sessions');
            }
        }, this.cleanupIntervalMs);
        // Allow process to exit even if interval is running
        if (this.cleanupInterval.unref) {
            this.cleanupInterval.unref();
        }
    }
    /**
     * Get a session from the store
     */
    get = (sid, callback) => {
        this.db.query(`SELECT sess FROM ${this.tableName} WHERE sid = $1 AND expire > NOW()`, [sid]).then(result => {
            if (result.rows.length === 0) {
                return callback(null, null);
            }
            try {
                const sess = typeof result.rows[0].sess === 'string'
                    ? JSON.parse(result.rows[0].sess)
                    : result.rows[0].sess;
                callback(null, sess);
            }
            catch (error) {
                logger.error({ error, sid }, 'Error parsing session data');
                callback(error);
            }
        }).catch(error => {
            logger.error({ error, sid }, 'Error getting session');
            callback(error);
        });
    };
    /**
     * Set/update a session in the store
     */
    set = (sid, sess, callback) => {
        const maxAge = sess.cookie?.maxAge ?? 24 * 60 * 60 * 1000; // Default 24 hours
        const expire = new Date(Date.now() + maxAge);
        this.db.query(`INSERT INTO ${this.tableName} (sid, sess, expire)
       VALUES ($1, $2, $3)
       ON CONFLICT (sid) DO UPDATE
       SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`, [sid, JSON.stringify(sess), expire]).then(() => {
            callback?.();
        }).catch(error => {
            logger.error({ error, sid }, 'Error setting session');
            callback?.(error);
        });
    };
    /**
     * Destroy a session
     */
    destroy = (sid, callback) => {
        this.db.query(`DELETE FROM ${this.tableName} WHERE sid = $1`, [sid]).then(() => {
            callback?.();
        }).catch(error => {
            logger.error({ error, sid }, 'Error destroying session');
            callback?.(error);
        });
    };
    /**
     * Touch a session to extend its expiration
     */
    touch = (sid, sess, callback) => {
        const maxAge = sess.cookie?.maxAge ?? 24 * 60 * 60 * 1000;
        const expire = new Date(Date.now() + maxAge);
        this.db.query(`UPDATE ${this.tableName} SET expire = $1 WHERE sid = $2`, [expire, sid]).then(() => {
            callback?.();
        }).catch(error => {
            logger.error({ error, sid }, 'Error touching session');
            callback?.(error);
        });
    };
    /**
     * Get all sessions (for admin purposes)
     */
    all = (callback) => {
        this.db.query(`SELECT sid, sess FROM ${this.tableName} WHERE expire > NOW()`).then(result => {
            const sessions = {};
            for (const row of result.rows) {
                try {
                    sessions[row.sid] = typeof row.sess === 'string'
                        ? JSON.parse(row.sess)
                        : row.sess;
                }
                catch (error) {
                    logger.error({ error, sid: row.sid }, 'Error parsing session data');
                }
            }
            callback(null, sessions);
        }).catch(error => {
            logger.error({ error }, 'Error getting all sessions');
            callback(error);
        });
    };
    /**
     * Get count of active sessions
     */
    length = (callback) => {
        this.db.query(`SELECT COUNT(*) as count FROM ${this.tableName} WHERE expire > NOW()`).then(result => {
            callback(null, parseInt(result.rows[0]?.count ?? '0', 10));
        }).catch(error => {
            logger.error({ error }, 'Error getting session count');
            callback(error);
        });
    };
    /**
     * Clear all sessions
     */
    clear = (callback) => {
        this.db.query(`DELETE FROM ${this.tableName}`)
            .then(() => {
            callback?.();
        }).catch(error => {
            logger.error({ error }, 'Error clearing sessions');
            callback?.(error);
        });
    };
    /**
     * Shutdown the session store
     */
    async shutdown() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        logger.info('PostgreSQL session store shut down');
    }
}
/**
 * Create a PostgreSQL session store
 * Falls back to memory store if database is not available
 */
export async function createSessionStore(db, options) {
    if (!db) {
        logger.warn('Database not available - using in-memory session store (not recommended for production)');
        return undefined; // Use default memory store
    }
    try {
        const store = new PgSessionStore({ db, ...options });
        await store.initialize();
        return store;
    }
    catch (error) {
        logger.error({ error }, 'Failed to create PostgreSQL session store - falling back to memory store');
        return undefined;
    }
}
//# sourceMappingURL=sessionStore.js.map