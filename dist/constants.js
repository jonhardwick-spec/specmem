/**
 * Constants - All the magic numbers in one place fr fr
 *
 * no more hardcoded values scattered everywhere like confetti
 * everything lives here now where we can see it no cap
 *
 * Per-project isolation: Uses SPECMEM_PROJECT_DIR_NAME for readable unique names
 * The dir name is sanitized and human-readable (e.g., "myproject" not "a1b2c3d4")
 */
import { getDashboardPort, getCoordinationPort, PORT_CONFIG } from './utils/portAllocator.js';
import * as path from 'path';
// ============================================================================
// Project Name - Used for per-project isolation (READABLE!)
// ============================================================================
/**
 * Get the project directory name for per-project isolation.
 * Uses SPECMEM_PROJECT_DIR_NAME env var (set by bootstrap.cjs) or derives from project path.
 * This is MUCH more readable than hashes! e.g., "myproject" instead of "a1b2c3d4e5f6"
 */
function getProjectDirName() {
    if (process.env['SPECMEM_PROJECT_DIR_NAME']) {
        return process.env['SPECMEM_PROJECT_DIR_NAME'];
    }
    // Derive from project path - sanitize to filesystem-safe name
    const projectPath = process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
    const dirName = path.basename(projectPath)
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'default';
    return dirName;
}
/**
 * DEPRECATED: Returns project directory name instead of hash.
 * NO MORE HASHES - use getProjectDirName() directly!
 * Kept for backwards compatibility - now just returns dir name.
 */
function getProjectHash() {
    if (process.env['SPECMEM_PROJECT_DIR_NAME']) {
        return process.env['SPECMEM_PROJECT_DIR_NAME'];
    }
    return getProjectDirName();
}
/**
 * Derive a port number from project name within a given range.
 * Uses a simple hash of the project dir name for deterministic port allocation.
 */
function derivePortFromName(basePort, rangeSize = 100) {
    const dirName = getProjectDirName();
    // Simple numeric hash from the dir name for port offset
    let hash = 0;
    for (let i = 0; i < dirName.length; i++) {
        hash = ((hash << 5) - hash) + dirName.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit integer
    }
    return basePort + (Math.abs(hash) % rangeSize);
}
/**
 * Derive a port number from project hash within a given range
 * DEPRECATED: Use derivePortFromName() for new code
 */
function derivePortFromHash(basePort, rangeSize = 100) {
    const hashNum = parseInt(getProjectHash().slice(0, 4), 16);
    return basePort + (hashNum % rangeSize);
}
// Export for use in other modules
export { getProjectDirName, getProjectHash, derivePortFromName, derivePortFromHash };
// ============================================================================
// Project Isolation Configuration - Centralized defaults
// ============================================================================
export const PROJECT_ISOLATION = {
    /**
     * Get the current project directory name (READABLE!)
     * Used as the basis for all per-project isolation
     * e.g., "myproject" instead of "a1b2c3d4e5f6"
     */
    get DIR_NAME() {
        return getProjectDirName();
    },
    /**
     * Get the current project hash (DEPRECATED - use DIR_NAME for readability)
     * Only use for backwards compatibility with existing database schemas
     */
    get HASH() {
        return getProjectHash();
    },
    /**
     * Get the project path being monitored
     */
    get PATH() {
        return process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
    },
    /**
     * Get the per-project database name
     * Format: specmem_{dirname} (human readable!)
     * Note: For existing DBs, may fall back to hash-based names
     */
    get DB_NAME() {
        if (process.env['SPECMEM_DB_NAME']) {
            return process.env['SPECMEM_DB_NAME'];
        }
        return `specmem_${getProjectDirName()}`;
    },
    /**
     * Get the per-project database port
     * Derived from project name, range 5500-5599
     */
    get DB_PORT() {
        if (process.env['SPECMEM_DB_PORT']) {
            return parseInt(process.env['SPECMEM_DB_PORT'], 10);
        }
        return derivePortFromName(5500, 100);
    },
    /**
     * Get the per-project dashboard port
     * Derived from project name, range 8500-8599
     */
    get DASHBOARD_PORT() {
        if (process.env['SPECMEM_DASHBOARD_PORT']) {
            return parseInt(process.env['SPECMEM_DASHBOARD_PORT'], 10);
        }
        return derivePortFromName(8500, 100);
    },
    /**
     * Get the per-project coordination port
     * Derived from project name, range 8600-8699
     */
    get COORDINATION_PORT() {
        if (process.env['SPECMEM_COORDINATION_PORT']) {
            return parseInt(process.env['SPECMEM_COORDINATION_PORT'], 10);
        }
        return derivePortFromName(8600, 100);
    },
    /**
     * Port ranges for different services
     */
    PORT_RANGES: {
        DATABASE: { BASE: 5500, SIZE: 100 }, // 5500-5599
        DASHBOARD: { BASE: 8500, SIZE: 100 }, // 8500-8599
        COORDINATION: { BASE: 8600, SIZE: 100 }, // 8600-8699
    },
};
// ============================================================================
// Port Configuration - all ports centralized here
// ============================================================================
/**
 * Port accessor functions for dynamic port allocation
 * These functions return the currently allocated ports, falling back to
 * environment variables or defaults if dynamic allocation hasn't occurred.
 */
export const PORTS = {
    /** Coordination server port (teamMember coordination websocket) */
    get COORDINATION() {
        return getCoordinationPort();
    },
    /** Dashboard web server port */
    get DASHBOARD() {
        return getDashboardPort();
    },
    /** Default database port */
    DATABASE: parseInt(process.env['SPECMEM_DB_PORT'] || '5432', 10),
    /** Default ports (before dynamic allocation) */
    DEFAULTS: PORT_CONFIG.DEFAULTS,
    /** Port range configuration */
    RANGE: {
        MIN: PORT_CONFIG.MIN_PORT,
        MAX: PORT_CONFIG.MAX_PORT,
    },
};
// ============================================================================
// Timing Constants - all the millisecond magic
// ============================================================================
export const TIMING = {
    /** Slow query threshold - queries slower than this get logged as warnings */
    SLOW_QUERY_THRESHOLD_MS: parseInt(process.env['SPECMEM_SLOW_QUERY_MS'] || '500', 10),
    /** Database health check interval */
    DB_HEALTH_CHECK_MS: 30000,
    /** Coordination heartbeat interval */
    HEARTBEAT_INTERVAL_MS: 10000,
    /** Coordination heartbeat timeout */
    HEARTBEAT_TIMEOUT_MS: 180000,
    /** WebSocket reconnect delay base */
    WS_RECONNECT_BASE_MS: 2000,
    /** File watcher debounce */
    WATCHER_DEBOUNCE_MS: parseInt(process.env['SPECMEM_WATCHER_DEBOUNCE_MS'] || '1000', 10),
    /** Stats refresh interval for dashboard */
    STATS_REFRESH_MS: 5000,
    /** Memory check interval */
    MEMORY_CHECK_INTERVAL_MS: 5000,
    /** Debug log auto-clear interval (30 minutes) */
    DEBUG_LOG_CLEAR_MS: 30 * 60 * 1000,
    /** Startup retry delay */
    STARTUP_RETRY_DELAY_MS: 1000,
};
// ============================================================================
// Memory Configuration
// ============================================================================
export const MEMORY = {
    /** Default max heap size in bytes (configurable via SPECMEM_MAX_HEAP_MB) */
    DEFAULT_MAX_HEAP_BYTES: parseInt(process.env['SPECMEM_MAX_HEAP_MB'] || '200', 10) * 1024 * 1024,
    /** Warning threshold percentage */
    WARNING_THRESHOLD: 0.7,
    /** Critical threshold percentage */
    CRITICAL_THRESHOLD: 0.8,
    /** Emergency threshold percentage */
    EMERGENCY_THRESHOLD: 0.9,
    /** Max cache entries */
    MAX_CACHE_ENTRIES: 1000,
    /** Embedding batch size */
    EMBEDDING_BATCH_SIZE: 100,
};
// ============================================================================
// Database Configuration - Per-project isolation
// ============================================================================
export const DATABASE = {
    /** Default max connections in pool */
    DEFAULT_MAX_CONNECTIONS: 20,
    /** Default idle timeout */
    DEFAULT_IDLE_TIMEOUT_MS: 180000,
    /** Default connection timeout */
    DEFAULT_CONNECTION_TIMEOUT_MS: 30000,
    /** Batch size for bulk operations */
    BATCH_SIZE: 100,
    /** Max query preview length for logs */
    QUERY_PREVIEW_LENGTH: 100,
    /**
     * Get project-specific database name
     * Uses SPECMEM_PROJECT_DIR_NAME for per-project isolation (READABLE!)
     * Format: specmem_{projectDirName}
     */
    get PROJECT_DB_NAME() {
        if (process.env['SPECMEM_DB_NAME']) {
            return process.env['SPECMEM_DB_NAME'];
        }
        return `specmem_${getProjectDirName()}`;
    },
    /**
     * Get project-specific database port
     * Derived from SPECMEM_PROJECT_DIR_NAME, range 5500-5599
     */
    get PROJECT_DB_PORT() {
        if (process.env['SPECMEM_DB_PORT']) {
            return parseInt(process.env['SPECMEM_DB_PORT'], 10);
        }
        return derivePortFromName(5500, 100);
    },
    /** Port range for embedded postgres */
    EMBEDDED_PORT_RANGE: {
        MIN: 5500,
        MAX: 5599,
    },
};
// ============================================================================
// Limits and Sizes
// ============================================================================
export const LIMITS = {
    /** Max message size for WebSocket */
    MAX_WS_MESSAGE_SIZE: 1024 * 1024, // 1MB
    /** Max image size for storage */
    MAX_IMAGE_SIZE_BYTES: 10485760, // 10MB
    /** Max file size for watcher processing */
    MAX_FILE_SIZE_BYTES: 1048576, // 1MB
    /** Max startup port attempts */
    MAX_PORT_ATTEMPTS: 10,
    /** Max startup retries per port */
    MAX_STARTUP_RETRIES: 3,
    /** Max WebSocket reconnect attempts */
    MAX_WS_RECONNECT_ATTEMPTS: 5,
    /** Session secret length */
    SESSION_SECRET_LENGTH: 32,
};
// ============================================================================
// Consolidation Settings
// ============================================================================
export const CONSOLIDATION = {
    /** Default interval in minutes */
    DEFAULT_INTERVAL_MINUTES: 60,
    /** Min memories for consolidation */
    MIN_MEMORIES: 5,
    /** Similarity query limit */
    SIMILARITY_LIMIT: 1000,
    /** Temporal query limit */
    TEMPORAL_LIMIT: 500,
    /** Tag-based query limit */
    TAG_LIMIT: 50,
    /** Importance query limit */
    IMPORTANCE_LIMIT: 200,
};
// ============================================================================
// Native Process Management Configuration - Per-project isolation
// ============================================================================
export const PROCESS_MANAGEMENT = {
    /** PID file name - project-scoped in LOCAL_DIR */
    PID_FILE: 'specmem.pid',
    /** Unix socket file for instance locking - project-scoped */
    LOCK_SOCKET_FILE: 'specmem.sock',
    /** Instance state file - contains project hash and derived config */
    INSTANCE_STATE_FILE: 'instance.json',
    /** Local directory for project-specific files */
    LOCAL_DIR: '.specmem',
    /** Graceful shutdown timeout in ms */
    SHUTDOWN_TIMEOUT_MS: 10000,
    /** Max restart attempts before giving up */
    MAX_RESTART_ATTEMPTS: 5,
    /** Restart cooldown in ms */
    RESTART_COOLDOWN_MS: 60000,
    /** Health check interval in ms */
    HEALTH_CHECK_INTERVAL_MS: 30000,
    /** Health check timeout in ms */
    HEALTH_CHECK_TIMEOUT_MS: 5000,
    /**
     * Get project-specific instance directory
     * Format: {PROJECT_DIR}/specmem/ - FULLY LOCALIZED
     * User requirement: "EVERYTHING LOCALIZED WITHIN THE PROJECT"
     */
    get PROJECT_INSTANCE_DIR() {
        const { getProjectPath } = require('./config.js');
        const path = require('path');
        return path.join(getProjectPath(), 'specmem');
    },
};
// ============================================================================
// Native Log Management Configuration
// ============================================================================
export const LOG_MANAGEMENT = {
    /** Max log file size before rotation (10MB) */
    MAX_SIZE_BYTES: 10 * 1024 * 1024,
    /** Number of rotated files to keep */
    RETAIN_COUNT: 10,
    /** Compress rotated logs */
    COMPRESS: true,
    /** Date format for rotated file names */
    DATE_FORMAT: 'YYYY-MM-DD_HH-mm-ss',
    /** Log directory (relative to project root) */
    LOG_DIR: 'logs',
    /** Error log file name */
    ERROR_FILE: 'specmem-error.log',
    /** Combined log file name */
    COMBINED_FILE: 'specmem-combined.log',
};
// ============================================================================
// HTTP/API Settings
// ============================================================================
export const HTTP = {
    /** Default host to bind to */
    DEFAULT_HOST: '127.0.0.1',
    /** CORS allowed origins (built from port config) */
    get ALLOWED_ORIGINS() {
        return [
            `http://localhost:${PORTS.COORDINATION}`,
            `http://127.0.0.1:${PORTS.COORDINATION}`,
            `http://localhost:${PORTS.DASHBOARD}`,
            `http://127.0.0.1:${PORTS.DASHBOARD}`,
        ];
    },
    // Retry configuration for HTTP client calls
    /** Maximum number of retry attempts for failed requests */
    MAX_RETRIES: 3,
    /** Initial delay in milliseconds before first retry */
    INITIAL_RETRY_DELAY_MS: 1000,
    /** Maximum delay in milliseconds between retries */
    MAX_RETRY_DELAY_MS: 30000,
    /** Multiplier for exponential backoff (delay = initialDelay * multiplier^attempt) */
    BACKOFF_MULTIPLIER: 2,
    /** HTTP status codes that should trigger a retry */
    RETRYABLE_STATUS_CODES: [408, 429, 500, 502, 503, 504],
    /** Request timeout in milliseconds - configurable via SPECMEM_HTTP_REQUEST_TIMEOUT_MS */
    REQUEST_TIMEOUT_MS: parseInt(process.env['SPECMEM_HTTP_REQUEST_TIMEOUT_MS'] || '60000', 10),
};
// ============================================================================
// Skill Scanner Settings
// ============================================================================
export const SKILLS = {
    /** Default skills directory name */
    DEFAULT_DIR: 'skills',
    /** Valid skill file extensions */
    VALID_EXTENSIONS: ['.md', '.markdown'],
    /** Max skill file size to process */
    MAX_SKILL_SIZE_BYTES: 100 * 1024, // 100KB
};
// ============================================================================
// Codebase Indexer Settings
// ============================================================================
export const CODEBASE = {
    /** Default exclude patterns */
    DEFAULT_EXCLUDES: [
        'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
        '__pycache__', '.pytest_cache', '.mypy_cache', 'venv', '.venv',
        '*.pyc', '*.pyo', '*.log', 'package-lock.json', 'yarn.lock'
    ],
    /** Max files to index in a single batch */
    INDEX_BATCH_SIZE: 50,
    /** Queue max size for file watcher */
    QUEUE_MAX_SIZE: 10000,
};
// ============================================================================
// Text Truncation Limits - Standardized across all indexing
// ============================================================================
export const TEXT_LIMITS = {
    /** Max content length for embedding text generation
     *  Used in: ingestion.ts, codebaseIndexer.ts
     *  Keeps embedding input size reasonable for vector models */
    EMBEDDING_CONTENT_MAX: 8000,
    /** Max content length for memory storage before chunking
     *  Used in: rememberThisShit.ts
     *  Postgres can handle more but this prevents huge single records */
    MEMORY_STORAGE_MAX: 50000,
    /** Content slice for language detection heuristics
     *  Used in: languageDetection.ts
     *  Only need first part of file to detect language */
    LANGUAGE_DETECTION_SLICE: 2000,
    /** Default max content length for search result display
     *  Used in: findWhatISaid.ts, whatDidIMean.ts
     *  Balance between context and token usage */
    SEARCH_RESULT_CONTENT: 1000,
    /** Short snippet length for previews/summaries
     *  Used in: findWhatISaid.ts, drillDown.ts, smartSearch.ts */
    SNIPPET_SHORT: 300,
    /** Medium preview length for content previews
     *  Used in: codebaseTools.ts, findCodePointers.ts */
    PREVIEW_MEDIUM: 500,
    /** Chunk overlap for memory chunking
     *  Used in: rememberThisShit.ts splitContent() */
    CHUNK_OVERLAP: 100,
};
// ============================================================================
// Environment Variable Names (for documentation/validation)
// ============================================================================
export const ENV_VARS = {
    // Required for production
    REQUIRED: [], // DB password has default for zero-config
    // Per-project isolation variables (set by bootstrap.cjs)
    PROJECT_ISOLATION: [
        'SPECMEM_PROJECT_PATH', // Absolute path to the project being monitored
        'SPECMEM_PROJECT_DIR_NAME', // Sanitized directory name (human readable!) e.g., "myproject"
        'SPECMEM_PROJECT_HASH', // 12-char hash (DEPRECATED - kept for backwards compat)
    ],
    // Optional with defaults
    OPTIONAL: [
        'SPECMEM_DB_HOST',
        'SPECMEM_DB_PORT', // Override project-derived port (default: 5500 + hash % 100)
        'SPECMEM_DB_NAME', // Override project-derived name (default: specmem_{hash})
        'SPECMEM_DB_USER',
        'SPECMEM_DB_PASSWORD',
        'SPECMEM_DB_MAX_CONNECTIONS',
        'SPECMEM_DB_IDLE_TIMEOUT',
        'SPECMEM_DB_CONNECTION_TIMEOUT',
        'SPECMEM_DB_SSL',
        // DEPRECATED: SPECMEM_EMBEDDING_DIMENSIONS is no longer used
        // Dimensions are auto-detected from the database pgvector column
        // 'SPECMEM_EMBEDDING_DIMENSIONS',  // REMOVED - auto-detected from database
        'SPECMEM_EMBEDDING_MODEL',
        'SPECMEM_EMBEDDING_BATCH_SIZE',
        'SPECMEM_COORDINATION_PORT', // Override project-derived port (default: 8600 + hash % 100)
        'SPECMEM_COORDINATION_ENABLED',
        'SPECMEM_DASHBOARD_PORT', // Override project-derived port (default: 8500 + hash % 100)
        'SPECMEM_DASHBOARD_HOST',
        'SPECMEM_DASHBOARD_ENABLED',
        'SPECMEM_DASHBOARD_PASSWORD',
        'SPECMEM_LOG_LEVEL',
        'SPECMEM_LOG_PRETTY',
        'SPECMEM_SKILLS_ENABLED',
        'SPECMEM_SKILLS_PATH',
        'SPECMEM_SKILLS_AUTO_RELOAD',
        'SPECMEM_CODEBASE_ENABLED',
        'SPECMEM_CODEBASE_PATH',
        'SPECMEM_CODEBASE_WATCH',
        'SPECMEM_CODEBASE_EXCLUDE_PATTERNS',
        'SPECMEM_MAX_HEAP_MB',
        'SPECMEM_SLOW_QUERY_MS',
        'SPECMEM_DEBUG',
        'SPECMEM_SESSION_SECRET',
        'SPECMEM_SESSION_SECRET_FILE',
    ],
    /**
     * Loading order for env vars:
     * 1. specmem.env from current working directory
     * 2. specmem.env from project root (relative to src)
     * 3. specmem.env from dist directory
     * 4. .env file (won't override existing values)
     *
     * Note: Existing process.env values are never overridden
     */
    LOADING_ORDER: [
        'process.env (pre-existing)',
        'specmem.env (cwd)',
        'specmem.env (project root)',
        'specmem.env (dist)',
        '.env (fallback)',
    ],
};
// ============================================================================
// TeamMember Messaging Configuration (Team Member B addition)
// ============================================================================
export const TEAM_MEMBER_MESSAGING = {
    /** Default message expiration in milliseconds (24 hours) */
    DEFAULT_EXPIRATION_MS: 24 * 60 * 60 * 1000,
    /** Typing indicator expiration in milliseconds (10 seconds) */
    TYPING_INDICATOR_EXPIRATION_MS: 10 * 1000,
    /** Short message expiration for ephemeral content (1 hour) */
    SHORT_EXPIRATION_MS: 60 * 60 * 1000,
    /** Long message expiration for important content (7 days) */
    LONG_EXPIRATION_MS: 7 * 24 * 60 * 60 * 1000,
    /** Maximum messages to fetch in a single query */
    MAX_FETCH_LIMIT: 100,
    /** Default messages to fetch */
    DEFAULT_FETCH_LIMIT: 50,
    /** TeamMember heartbeat timeout - consider team member offline after this (60 seconds) */
    HEARTBEAT_TIMEOUT_SECONDS: 60,
    /** Priority levels for message sorting */
    PRIORITY_ORDER: {
        high: 0,
        medium: 1,
        low: 2,
    },
    /** Valid priority levels */
    VALID_PRIORITIES: ['high', 'medium', 'low'],
    /** Valid message types */
    VALID_MESSAGE_TYPES: ['broadcast', 'direct', 'status', 'heartbeat', 'typing', 'read-receipt'],
};
// ============================================================================
// Error Message Templates (unprofessional style fr fr)
// ============================================================================
export const ERROR_MESSAGES = {
    // Database errors
    DB_NOT_INITIALIZED: 'Database not initialized bruh. Provide config on first call fr fr',
    DB_CONNECTION_FAILED: 'Database connection yeeted itself no cap',
    DB_QUERY_FAILED: 'Query caught these hands and failed',
    DB_POOL_EXHAUSTED: 'Connection pool full af, everyone waiting smh',
    // MCP errors
    MCP_TOOL_NOT_FOUND: 'Tool not found fam, check your tool names',
    MCP_INVALID_PARAMS: 'Invalid params bruh, fix your inputs',
    MCP_EXECUTION_FAILED: 'Tool execution went brr but wrong direction',
    // Memory errors
    MEMORY_LIMIT_EXCEEDED: 'Memory limit exceeded no cap, time to yeet some stuff',
    MEMORY_EMERGENCY: 'MEMORY EMERGENCY bruh we cooked fr fr',
    // Skills errors
    SKILL_NOT_FOUND: 'Skill not found fam, check if it exists',
    SKILL_LOAD_FAILED: 'Skill failed to load, probably corrupted ngl',
    // Codebase errors
    FILE_NOT_FOUND: 'File not found bruh, path probably wrong',
    INDEX_FAILED: 'Indexing failed harder than expected',
    // Validation errors
    MISSING_ENV_VAR: (varName) => `Missing env var ${varName} bruh, set it up`,
    INVALID_PORT: (port) => `Port ${port} is invalid ngl, use something between 1-65535`,
    INVALID_CONFIG: (field) => `Config field ${field} is sus, check it`,
    // Auth errors
    AUTH_FAILED: 'Authentication failed no cap, check your password',
    SESSION_EXPIRED: 'Session expired fam, login again',
    DASHBOARD_PASSWORD_REQUIRED: 'Dashboard password is required in production fr fr',
};
//# sourceMappingURL=constants.js.map