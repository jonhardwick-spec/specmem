/**
 * Constants - All the magic numbers in one place fr fr
 *
 * no more hardcoded values scattered everywhere like confetti
 * everything lives here now where we can see it no cap
 *
 * Per-project isolation: Uses SPECMEM_PROJECT_DIR_NAME for readable unique names
 * The dir name is sanitized and human-readable (e.g., "myproject" not "a1b2c3d4")
 */
/**
 * Get the project directory name for per-project isolation.
 * Uses SPECMEM_PROJECT_DIR_NAME env var (set by bootstrap.cjs) or derives from project path.
 * This is MUCH more readable than hashes! e.g., "myproject" instead of "a1b2c3d4e5f6"
 */
declare function getProjectDirName(): string;
/**
 * DEPRECATED: Returns project directory name instead of hash.
 * NO MORE HASHES - use getProjectDirName() directly!
 * Kept for backwards compatibility - now just returns dir name.
 */
declare function getProjectHash(): string;
/**
 * Derive a port number from project name within a given range.
 * Uses a simple hash of the project dir name for deterministic port allocation.
 */
declare function derivePortFromName(basePort: number, rangeSize?: number): number;
/**
 * Derive a port number from project hash within a given range
 * DEPRECATED: Use derivePortFromName() for new code
 */
declare function derivePortFromHash(basePort: number, rangeSize?: number): number;
export { getProjectDirName, getProjectHash, derivePortFromName, derivePortFromHash };
export declare const PROJECT_ISOLATION: {
    /**
     * Get the current project directory name (READABLE!)
     * Used as the basis for all per-project isolation
     * e.g., "myproject" instead of "a1b2c3d4e5f6"
     */
    readonly DIR_NAME: string;
    /**
     * Get the current project hash (DEPRECATED - use DIR_NAME for readability)
     * Only use for backwards compatibility with existing database schemas
     */
    readonly HASH: string;
    /**
     * Get the project path being monitored
     */
    readonly PATH: string;
    /**
     * Get the per-project database name
     * Format: specmem_{dirname} (human readable!)
     * Note: For existing DBs, may fall back to hash-based names
     */
    readonly DB_NAME: string;
    /**
     * Get the per-project database port
     * Derived from project name, range 5500-5599
     */
    readonly DB_PORT: number;
    /**
     * Get the per-project dashboard port
     * Derived from project name, range 8500-8599
     */
    readonly DASHBOARD_PORT: number;
    /**
     * Get the per-project coordination port
     * Derived from project name, range 8600-8699
     */
    readonly COORDINATION_PORT: number;
    /**
     * Port ranges for different services
     */
    readonly PORT_RANGES: {
        readonly DATABASE: {
            readonly BASE: 5500;
            readonly SIZE: 100;
        };
        readonly DASHBOARD: {
            readonly BASE: 8500;
            readonly SIZE: 100;
        };
        readonly COORDINATION: {
            readonly BASE: 8600;
            readonly SIZE: 100;
        };
    };
};
/**
 * Port accessor functions for dynamic port allocation
 * These functions return the currently allocated ports, falling back to
 * environment variables or defaults if dynamic allocation hasn't occurred.
 */
export declare const PORTS: {
    /** Coordination server port (teamMember coordination websocket) */
    readonly COORDINATION: number;
    /** Dashboard web server port */
    readonly DASHBOARD: number;
    /** Default database port */
    readonly DATABASE: number;
    /** Default ports (before dynamic allocation) */
    readonly DEFAULTS: {
        readonly DASHBOARD: 8595;
        readonly COORDINATION: 8596;
        readonly POSTGRES: 5432;
    };
    /** Port range configuration */
    readonly RANGE: {
        readonly MIN: 8595;
        readonly MAX: 8720;
    };
};
export declare const TIMING: {
    /** Slow query threshold - queries slower than this get logged as warnings */
    readonly SLOW_QUERY_THRESHOLD_MS: number;
    /** Database health check interval */
    readonly DB_HEALTH_CHECK_MS: 30000;
    /** Coordination heartbeat interval */
    readonly HEARTBEAT_INTERVAL_MS: 10000;
    /** Coordination heartbeat timeout */
    readonly HEARTBEAT_TIMEOUT_MS: 180000;
    /** WebSocket reconnect delay base */
    readonly WS_RECONNECT_BASE_MS: 2000;
    /** File watcher debounce */
    readonly WATCHER_DEBOUNCE_MS: number;
    /** Stats refresh interval for dashboard */
    readonly STATS_REFRESH_MS: 5000;
    /** Memory check interval */
    readonly MEMORY_CHECK_INTERVAL_MS: 5000;
    /** Debug log auto-clear interval (30 minutes) */
    readonly DEBUG_LOG_CLEAR_MS: number;
    /** Startup retry delay */
    readonly STARTUP_RETRY_DELAY_MS: 1000;
};
export declare const MEMORY: {
    /** Default max heap size in bytes (configurable via SPECMEM_MAX_HEAP_MB) */
    readonly DEFAULT_MAX_HEAP_BYTES: number;
    /** Warning threshold percentage */
    readonly WARNING_THRESHOLD: 0.7;
    /** Critical threshold percentage */
    readonly CRITICAL_THRESHOLD: 0.8;
    /** Emergency threshold percentage */
    readonly EMERGENCY_THRESHOLD: 0.9;
    /** Max cache entries */
    readonly MAX_CACHE_ENTRIES: 1000;
    /** Embedding batch size */
    readonly EMBEDDING_BATCH_SIZE: 100;
};
export declare const DATABASE: {
    /** Default max connections in pool */
    readonly DEFAULT_MAX_CONNECTIONS: 20;
    /** Default idle timeout */
    readonly DEFAULT_IDLE_TIMEOUT_MS: 180000;
    /** Default connection timeout */
    readonly DEFAULT_CONNECTION_TIMEOUT_MS: 30000;
    /** Batch size for bulk operations */
    readonly BATCH_SIZE: 100;
    /** Max query preview length for logs */
    readonly QUERY_PREVIEW_LENGTH: 100;
    /**
     * Get project-specific database name
     * Uses SPECMEM_PROJECT_DIR_NAME for per-project isolation (READABLE!)
     * Format: specmem_{projectDirName}
     */
    readonly PROJECT_DB_NAME: string;
    /**
     * Get project-specific database port
     * Derived from SPECMEM_PROJECT_DIR_NAME, range 5500-5599
     */
    readonly PROJECT_DB_PORT: number;
    /** Port range for embedded postgres */
    readonly EMBEDDED_PORT_RANGE: {
        readonly MIN: 5500;
        readonly MAX: 5599;
    };
};
export declare const LIMITS: {
    /** Max message size for WebSocket */
    readonly MAX_WS_MESSAGE_SIZE: number;
    /** Max image size for storage */
    readonly MAX_IMAGE_SIZE_BYTES: 10485760;
    /** Max file size for watcher processing */
    readonly MAX_FILE_SIZE_BYTES: 1048576;
    /** Max startup port attempts */
    readonly MAX_PORT_ATTEMPTS: 10;
    /** Max startup retries per port */
    readonly MAX_STARTUP_RETRIES: 3;
    /** Max WebSocket reconnect attempts */
    readonly MAX_WS_RECONNECT_ATTEMPTS: 5;
    /** Session secret length */
    readonly SESSION_SECRET_LENGTH: 32;
};
export declare const CONSOLIDATION: {
    /** Default interval in minutes */
    readonly DEFAULT_INTERVAL_MINUTES: 60;
    /** Min memories for consolidation */
    readonly MIN_MEMORIES: 5;
    /** Similarity query limit */
    readonly SIMILARITY_LIMIT: 1000;
    /** Temporal query limit */
    readonly TEMPORAL_LIMIT: 500;
    /** Tag-based query limit */
    readonly TAG_LIMIT: 50;
    /** Importance query limit */
    readonly IMPORTANCE_LIMIT: 200;
};
export declare const PROCESS_MANAGEMENT: {
    /** PID file name - project-scoped in LOCAL_DIR */
    readonly PID_FILE: "specmem.pid";
    /** Unix socket file for instance locking - project-scoped */
    readonly LOCK_SOCKET_FILE: "specmem.sock";
    /** Instance state file - contains project hash and derived config */
    readonly INSTANCE_STATE_FILE: "instance.json";
    /** Local directory for project-specific files */
    readonly LOCAL_DIR: ".specmem";
    /** Graceful shutdown timeout in ms */
    readonly SHUTDOWN_TIMEOUT_MS: 10000;
    /** Max restart attempts before giving up */
    readonly MAX_RESTART_ATTEMPTS: 5;
    /** Restart cooldown in ms */
    readonly RESTART_COOLDOWN_MS: 60000;
    /** Health check interval in ms */
    readonly HEALTH_CHECK_INTERVAL_MS: 30000;
    /** Health check timeout in ms */
    readonly HEALTH_CHECK_TIMEOUT_MS: 5000;
    /**
     * Get project-specific instance directory
     * Format: {PROJECT_DIR}/specmem/ - FULLY LOCALIZED
     * User requirement: "EVERYTHING LOCALIZED WITHIN THE PROJECT"
     */
    readonly PROJECT_INSTANCE_DIR: string;
};
export declare const LOG_MANAGEMENT: {
    /** Max log file size before rotation (10MB) */
    readonly MAX_SIZE_BYTES: number;
    /** Number of rotated files to keep */
    readonly RETAIN_COUNT: 10;
    /** Compress rotated logs */
    readonly COMPRESS: true;
    /** Date format for rotated file names */
    readonly DATE_FORMAT: "YYYY-MM-DD_HH-mm-ss";
    /** Log directory (relative to project root) */
    readonly LOG_DIR: "logs";
    /** Error log file name */
    readonly ERROR_FILE: "specmem-error.log";
    /** Combined log file name */
    readonly COMBINED_FILE: "specmem-combined.log";
};
export declare const HTTP: {
    /** Default host to bind to */
    readonly DEFAULT_HOST: "127.0.0.1";
    /** CORS allowed origins (built from port config) */
    readonly ALLOWED_ORIGINS: string[];
    /** Maximum number of retry attempts for failed requests */
    readonly MAX_RETRIES: 3;
    /** Initial delay in milliseconds before first retry */
    readonly INITIAL_RETRY_DELAY_MS: 1000;
    /** Maximum delay in milliseconds between retries */
    readonly MAX_RETRY_DELAY_MS: 30000;
    /** Multiplier for exponential backoff (delay = initialDelay * multiplier^attempt) */
    readonly BACKOFF_MULTIPLIER: 2;
    /** HTTP status codes that should trigger a retry */
    readonly RETRYABLE_STATUS_CODES: readonly number[];
    /** Request timeout in milliseconds - configurable via SPECMEM_HTTP_REQUEST_TIMEOUT_MS */
    readonly REQUEST_TIMEOUT_MS: number;
};
export declare const SKILLS: {
    /** Default skills directory name */
    readonly DEFAULT_DIR: "skills";
    /** Valid skill file extensions */
    readonly VALID_EXTENSIONS: readonly [".md", ".markdown"];
    /** Max skill file size to process */
    readonly MAX_SKILL_SIZE_BYTES: number;
};
export declare const CODEBASE: {
    /** Default exclude patterns */
    readonly DEFAULT_EXCLUDES: readonly ["node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__", ".pytest_cache", ".mypy_cache", "venv", ".venv", "*.pyc", "*.pyo", "*.log", "package-lock.json", "yarn.lock"];
    /** Max files to index in a single batch */
    readonly INDEX_BATCH_SIZE: 50;
    /** Queue max size for file watcher */
    readonly QUEUE_MAX_SIZE: 10000;
};
export declare const TEXT_LIMITS: {
    /** Max content length for embedding text generation
     *  Used in: ingestion.ts, codebaseIndexer.ts
     *  Keeps embedding input size reasonable for vector models */
    readonly EMBEDDING_CONTENT_MAX: 8000;
    /** Max content length for memory storage before chunking
     *  Used in: rememberThisShit.ts
     *  Postgres can handle more but this prevents huge single records */
    readonly MEMORY_STORAGE_MAX: 50000;
    /** Content slice for language detection heuristics
     *  Used in: languageDetection.ts
     *  Only need first part of file to detect language */
    readonly LANGUAGE_DETECTION_SLICE: 2000;
    /** Default max content length for search result display
     *  Used in: findWhatISaid.ts, whatDidIMean.ts
     *  Balance between context and token usage */
    readonly SEARCH_RESULT_CONTENT: 1000;
    /** Short snippet length for previews/summaries
     *  Used in: findWhatISaid.ts, drillDown.ts, smartSearch.ts */
    readonly SNIPPET_SHORT: 300;
    /** Medium preview length for content previews
     *  Used in: codebaseTools.ts, findCodePointers.ts */
    readonly PREVIEW_MEDIUM: 500;
    /** Chunk overlap for memory chunking
     *  Used in: rememberThisShit.ts splitContent() */
    readonly CHUNK_OVERLAP: 100;
};
export declare const ENV_VARS: {
    readonly REQUIRED: readonly [];
    readonly PROJECT_ISOLATION: readonly ["SPECMEM_PROJECT_PATH", "SPECMEM_PROJECT_DIR_NAME", "SPECMEM_PROJECT_HASH"];
    readonly OPTIONAL: readonly ["SPECMEM_DB_HOST", "SPECMEM_DB_PORT", "SPECMEM_DB_NAME", "SPECMEM_DB_USER", "SPECMEM_DB_PASSWORD", "SPECMEM_DB_MAX_CONNECTIONS", "SPECMEM_DB_IDLE_TIMEOUT", "SPECMEM_DB_CONNECTION_TIMEOUT", "SPECMEM_DB_SSL", "SPECMEM_EMBEDDING_MODEL", "SPECMEM_EMBEDDING_BATCH_SIZE", "SPECMEM_COORDINATION_PORT", "SPECMEM_COORDINATION_ENABLED", "SPECMEM_DASHBOARD_PORT", "SPECMEM_DASHBOARD_HOST", "SPECMEM_DASHBOARD_ENABLED", "SPECMEM_DASHBOARD_PASSWORD", "SPECMEM_LOG_LEVEL", "SPECMEM_LOG_PRETTY", "SPECMEM_SKILLS_ENABLED", "SPECMEM_SKILLS_PATH", "SPECMEM_SKILLS_AUTO_RELOAD", "SPECMEM_CODEBASE_ENABLED", "SPECMEM_CODEBASE_PATH", "SPECMEM_CODEBASE_WATCH", "SPECMEM_CODEBASE_EXCLUDE_PATTERNS", "SPECMEM_MAX_HEAP_MB", "SPECMEM_SLOW_QUERY_MS", "SPECMEM_DEBUG", "SPECMEM_SESSION_SECRET", "SPECMEM_SESSION_SECRET_FILE"];
    /**
     * Loading order for env vars:
     * 1. specmem.env from current working directory
     * 2. specmem.env from project root (relative to src)
     * 3. specmem.env from dist directory
     * 4. .env file (won't override existing values)
     *
     * Note: Existing process.env values are never overridden
     */
    readonly LOADING_ORDER: readonly ["process.env (pre-existing)", "specmem.env (cwd)", "specmem.env (project root)", "specmem.env (dist)", ".env (fallback)"];
};
export declare const TEAM_MEMBER_MESSAGING: {
    /** Default message expiration in milliseconds (24 hours) */
    readonly DEFAULT_EXPIRATION_MS: number;
    /** Typing indicator expiration in milliseconds (10 seconds) */
    readonly TYPING_INDICATOR_EXPIRATION_MS: number;
    /** Short message expiration for ephemeral content (1 hour) */
    readonly SHORT_EXPIRATION_MS: number;
    /** Long message expiration for important content (7 days) */
    readonly LONG_EXPIRATION_MS: number;
    /** Maximum messages to fetch in a single query */
    readonly MAX_FETCH_LIMIT: 100;
    /** Default messages to fetch */
    readonly DEFAULT_FETCH_LIMIT: 50;
    /** TeamMember heartbeat timeout - consider team member offline after this (60 seconds) */
    readonly HEARTBEAT_TIMEOUT_SECONDS: 60;
    /** Priority levels for message sorting */
    readonly PRIORITY_ORDER: {
        readonly high: 0;
        readonly medium: 1;
        readonly low: 2;
    };
    /** Valid priority levels */
    readonly VALID_PRIORITIES: readonly ["high", "medium", "low"];
    /** Valid message types */
    readonly VALID_MESSAGE_TYPES: readonly ["broadcast", "direct", "status", "heartbeat", "typing", "read-receipt"];
};
export declare const ERROR_MESSAGES: {
    readonly DB_NOT_INITIALIZED: "Database not initialized bruh. Provide config on first call fr fr";
    readonly DB_CONNECTION_FAILED: "Database connection yeeted itself no cap";
    readonly DB_QUERY_FAILED: "Query caught these hands and failed";
    readonly DB_POOL_EXHAUSTED: "Connection pool full af, everyone waiting smh";
    readonly MCP_TOOL_NOT_FOUND: "Tool not found fam, check your tool names";
    readonly MCP_INVALID_PARAMS: "Invalid params bruh, fix your inputs";
    readonly MCP_EXECUTION_FAILED: "Tool execution went brr but wrong direction";
    readonly MEMORY_LIMIT_EXCEEDED: "Memory limit exceeded no cap, time to yeet some stuff";
    readonly MEMORY_EMERGENCY: "MEMORY EMERGENCY bruh we cooked fr fr";
    readonly SKILL_NOT_FOUND: "Skill not found fam, check if it exists";
    readonly SKILL_LOAD_FAILED: "Skill failed to load, probably corrupted ngl";
    readonly FILE_NOT_FOUND: "File not found bruh, path probably wrong";
    readonly INDEX_FAILED: "Indexing failed harder than expected";
    readonly MISSING_ENV_VAR: (varName: string) => string;
    readonly INVALID_PORT: (port: number) => string;
    readonly INVALID_CONFIG: (field: string) => string;
    readonly AUTH_FAILED: "Authentication failed no cap, check your password";
    readonly SESSION_EXPIRED: "Session expired fam, login again";
    readonly DASHBOARD_PASSWORD_REQUIRED: "Dashboard password is required in production fr fr";
};
//# sourceMappingURL=constants.d.ts.map