/**
 * SpecMem HTTP Client - REST API wrapper for SpecMem
 *
 * Provides typed interfaces and methods for all SpecMem API endpoints.
 * Handles authentication, session management, and error handling.
 *
 * Features:
 * - Automatic retry with exponential backoff for transient failures
 * - Structured logging with configurable levels
 * - Input validation for all parameters
 * - TypeScript strict types throughout
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
interface Logger {
    debug: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
}
declare function createLogger(prefix: string, minLevel?: LogLevel): Logger;
interface RetryOptions {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffMultiplier?: number;
    retryableStatusCodes?: readonly number[];
    logger?: Logger;
}
declare class RetryableError extends Error {
    readonly statusCode?: number;
    readonly isRetryable: boolean;
    constructor(message: string, statusCode?: number, isRetryable?: boolean);
}
/**
 * ValidationError - Thrown when input validation fails
 */
declare class ValidationError extends Error {
    readonly fieldName: string;
    readonly receivedValue: unknown;
    constructor(message: string, fieldName: string, receivedValue: unknown);
}
declare function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>;
/**
 * Check if this shit aint empty or something
 * @yeets {ValidationError} if it looks sus
 */
declare function stringLooksAightOrNah(value: unknown, whatTheThing: string): string;
/**
 * Validate that a value is a positive number, with optional default
 * @throws {ValidationError} if validation fails
 */
declare function validatePositiveNumber(value: unknown, fieldName: string, defaultValue: number): number;
/** Valid memory types for SpecMem */
declare const VALID_MEMORY_TYPES: readonly ["episodic", "semantic", "procedural", "working", "consolidated"];
/** Valid importance levels */
declare const VALID_IMPORTANCE_LEVELS: readonly ["low", "medium", "high"];
/**
 * Validate memory type
 * @throws {ValidationError} if validation fails
 */
declare function validateMemoryType(value: unknown): RememberOptions['memoryType'];
/**
 * Validate importance level
 * @throws {ValidationError} if validation fails
 */
declare function validateImportance(value: unknown): RememberOptions['importance'];
/**
 * Validate an array of tags
 */
declare function validateTags(value: unknown): string[];
export interface SpecMemConfig {
    baseUrl: string;
    password: string;
    teamMemberId?: string;
    /** Log level for client operations (default: 'info') */
    logLevel?: LogLevel;
    /** Maximum number of retry attempts (default: from HTTP constants) */
    maxRetries?: number;
    /** Request timeout in milliseconds (default: from HTTP constants) */
    requestTimeout?: number;
}
export interface Memory {
    id: string;
    content: string;
    memory_type: string;
    importance: string;
    tags: string[];
    metadata?: Record<string, any>;
    created_at: string;
    updated_at?: string;
}
export interface RememberOptions {
    memoryType?: 'episodic' | 'semantic' | 'procedural' | 'working' | 'consolidated';
    importance?: 'low' | 'medium' | 'high';
    tags?: string[];
    metadata?: Record<string, any>;
}
export interface FindOptions {
    limit?: number;
    memoryType?: string;
    tags?: string[];
}
export interface MemoryStats {
    database: {
        total_memories: string;
        memory_types: string;
        importance_levels: string;
        table_size: string;
    };
    memory: {
        heapUsedMB: number;
        heapTotalMB: number;
        rssMB: number;
    };
}
export interface ApiResponse<T> {
    success: boolean;
    message?: string;
    error?: string;
    memory?: Memory;
    memories?: Memory[];
    count?: number;
    database?: any;
}
export declare class SpecMemClient {
    private config;
    private sessionCookie;
    private authenticated;
    private readonly logger;
    private readonly maxRetries;
    private readonly requestTimeout;
    constructor(config: SpecMemConfig);
    /**
     * Login to SpecMem and store session cookie
     * Implements retry logic for transient failures
     */
    login(): Promise<boolean>;
    /**
     * Make an authenticated request with retry logic
     */
    private request;
    /**
     * Store a memory with validation
     */
    remember(content: string, options?: RememberOptions): Promise<Memory | null>;
    /**
     * Search for memories with validation
     */
    find(query: string, options?: FindOptions): Promise<Memory[]>;
    /**
     * Semantic search (context-aware) with validation
     */
    semanticSearch(query: string, limit?: number): Promise<Memory[]>;
    /**
     * Delete a memory by ID with validation
     */
    delete(id: string): Promise<boolean>;
    /**
     * Get memory statistics
     */
    getStats(): Promise<MemoryStats | null>;
    /**
     * Link two memories together with validation
     */
    linkMemories(sourceId: string, targetId: string, relationType?: string): Promise<boolean>;
    /**
     * Check if client is authenticated
     */
    isAuthenticated(): boolean;
    /**
     * Get current config
     */
    getConfig(): SpecMemConfig;
}
export declare function createSpecMemClient(config?: Partial<SpecMemConfig>): SpecMemClient;
export { createLogger, withRetry, RetryableError, ValidationError };
export type { Logger, LogLevel, RetryOptions };
export { stringLooksAightOrNah, validatePositiveNumber, validateMemoryType, validateImportance, validateTags, VALID_MEMORY_TYPES, VALID_IMPORTANCE_LEVELS, };
//# sourceMappingURL=specmemClient.d.ts.map